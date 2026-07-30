"""READ-ONLY live-close auto-detection for the closed-positions log.

When the app opens a LIVE position it logs an OPEN row in ``runs_log`` (mode='live'); the
actual close usually happens ON THE EXCHANGE — a native OCO leg fills (stop-loss or
take-profit) or the user sells manually. Nothing tells the app. This module reconciles that:
for each open live run it fetches the account's recent CLOSED orders for that symbol
(``fetch_closed_orders``), finds the SELL fill that flattened the position, computes the
realised %P&L versus the logged entry, and INFERS the close reason from the order type
(STOP_LOSS_LIMIT → stop_loss, LIMIT/LIMIT_MAKER take-profit leg → take_profit, market → manual).
It then records the close in ``runs_log`` with the exchange order id (which also dedupes).

STRICTLY READ-ONLY: it only calls fetch_closed_orders / load_markets. It NEVER places, cancels,
or modifies an order, and never trades. Cached per-caller (~45s) so opening the log repeatedly
doesn't hammer the exchange.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from app import database as db
from app.services import exchange as ex

logger = logging.getLogger("algo770")

_RECONCILE_TTL = 45.0            # min seconds between reconciles per caller (rate-limit guard)
_MAX_SYMBOLS = 25               # cap fetches per reconcile so a big history never stalls the log


def _iso_to_ms(iso: Optional[str]) -> Optional[float]:
    if not iso:
        return None
    try:
        d = datetime.fromisoformat(str(iso))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp() * 1000.0
    except (TypeError, ValueError):
        return None


def _ms_to_iso(ms: Optional[float]) -> Optional[str]:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(float(ms) / 1000.0, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError):
        return None


def _infer_reason(order: dict) -> str:
    """Map an exchange SELL order to a close reason from its (order) type. Binance reports
    the executed OCO leg as STOP_LOSS_LIMIT (stop) or LIMIT_MAKER (take-profit); a manual
    close is a plain market/limit sell."""
    info = order.get("info") or {}
    blob = f"{order.get('type') or ''} {info.get('type') or ''}".upper()
    if "STOP" in blob:
        return "stop_loss"
    if "LIMIT_MAKER" in blob or "TAKE_PROFIT" in blob:
        return "take_profit"
    if "MARKET" in blob:
        return "manual"
    if "LIMIT" in blob:
        return "take_profit"   # a resting limit sell above entry = a take-profit
    return "manual"


def _px_usdt(ccy: str, px_cache: dict) -> Optional[float]:
    """<ccy>/USDT price for fee conversion (1.0 for st, cached, None if unpriced)."""
    ccy = (ccy or "").upper()
    if ccy in ("USDT", "USD", "BUSD", "USDC", "FDUSD", "TUSD"):
        return 1.0
    if ccy not in px_cache:
        try:
            px_cache[ccy] = float(ex.fetch_prices([f"{ccy}/USDT"]).get(f"{ccy}/USDT") or 0) or None
        except Exception:  # noqa: BLE001
            px_cache[ccy] = None
    return px_cache[ccy]


def _order_fee_usdt(order: dict, base: str, ref_px: Optional[float], px_cache: dict) -> float:
    """Convert an exchange order's real fee(s) to USDT — same currency rules as the order-log path:
    quote/stablecoin → 1:1, BASE asset → × ref_px (value the coins at the fill), BNB/other → ×
    <ccy>/USDT. An unpriced currency contributes nothing (that fee stays gross)."""
    total = 0.0
    fee_entries = order.get("fees") if order.get("fees") else ([order.get("fee")] if order.get("fee") else [])
    for f in fee_entries:
        ccy = str((f or {}).get("currency") or "").upper()
        cost = float((f or {}).get("cost") or 0.0)
        if cost <= 0 or not ccy:
            continue
        if ccy == base:
            if ref_px:
                total += cost * float(ref_px)
        else:
            up = _px_usdt(ccy, px_cache)
            if up:
                total += cost * up
    return total


def net_close_pnl(entry: float, exit_px: float, qty: float, sell_order: dict, base: str,
                  px_cache: dict) -> tuple:
    """Realized P&L for one live close, NET of real fees. Returns (pnl, pnl_pct).

    gross = (exit − entry) × qty. Subtracts the SELL fill's real fee (from the exchange order) PLUS
    the BUY fee estimated at the SAME observed rate (real rate from this fill applied to the entry
    notional — the buy order isn't in this ledger). If the fill carries no fee data, falls back to
    GROSS (never crash/zero). fee-currency handling matches the order-log path."""
    gross = (exit_px - entry) * qty
    cost_basis = entry * qty
    exit_notional = exit_px * qty
    sell_fee = _order_fee_usdt(sell_order, base, exit_px, px_cache) if sell_order else 0.0
    fee_total = 0.0
    if sell_fee > 0 and exit_notional > 0:
        rate = sell_fee / exit_notional                    # real taker rate observed on the fill
        fee_total = sell_fee + cost_basis * rate           # sell fee + buy fee at the same rate
    pnl = round(gross - fee_total, 2)
    pnl_pct = round((pnl / cost_basis * 100.0), 2) if cost_basis > 0 else round(((exit_px - entry) / entry * 100.0), 2)
    return pnl, pnl_pct


_FEE_TTL = 300.0                # per-user fee-map cache (~5min) so the live-pnl poll doesn't refetch


def enrich_orders_with_fees(user: str, cfg: dict, orders: list, *, force: bool = False) -> list:
    """Attach real per-order fees (feeUsdt, baseFeeQty) to the order dicts IN PLACE so
    ex.replay_orders / ex.realized_pnl_by_order net them out. Cached per user (~5min). READ-ONLY
    (fetch_my_trades only). On ANY failure the orders keep feeUsdt=0 → GROSS — never crashes,
    never zeroes the P&L."""
    if not orders:
        return orders
    key = f"order_fees_{user}"
    now = time.time()
    fee_map = None
    if not force:
        try:
            c = db._get_singleton(key, None)
            if isinstance(c, dict) and (now - float(c.get("ts") or 0)) < _FEE_TTL:
                fee_map = c.get("map") or {}
        except (TypeError, ValueError):
            fee_map = None
    if fee_map is None:
        try:
            fee_map = ex.order_fees_usdt(cfg, orders)
        except Exception as exc:  # noqa: BLE001
            logger.info("fee enrich failed: %s", str(exc)[:120])
            fee_map = {}
        try:
            db._set_singleton(key, {"ts": now, "map": fee_map})
        except Exception:  # noqa: BLE001
            pass
    for o in orders:
        # singleton JSON turns int keys into strings → look up both.
        f = fee_map.get(o.get("id")) or fee_map.get(str(o.get("id"))) or {}
        o["feeUsdt"] = float(f.get("feeUsdt") or 0.0)
        o["baseFeeQty"] = float(f.get("baseFeeQty") or 0.0)
    return orders


def cfg_from_creds(creds: Optional[dict]) -> Optional[dict]:
    """Build an ephemeral (encrypted) exchange cfg from browser-supplied NON-CUSTODIAL creds
    (X-Exchange-Key/Secret headers), so the on-open reconcile can read closed orders even when the
    keys live only in the user's browser and nothing is stored server-side. Mirrors the order
    route's header-cfg. READ-ONLY use only (fetch_closed_orders). None when no creds were sent."""
    if not (creds and creds.get("key") and creds.get("secret")):
        return None
    return {
        "exchange": creds.get("name") or "binance",
        "environment": creds.get("env") or "testnet",
        "subAccount": "",
        "apiKeyEnc": ex.encrypt(creds["key"]),
        "apiSecretEnc": ex.encrypt(creds["secret"]),
        "apiPassphraseEnc": ex.encrypt(creds["passphrase"]) if creds.get("passphrase") else "",
        "defaultPct": 5.0,
    }


def reconcile_user(username: str, *, force: bool = False, cfg: Optional[dict] = None) -> int:
    """Detect and record exchange-side closes for ``username``'s open live runs. Returns how
    many were reconciled. Best-effort + cached; any exchange hiccup is swallowed so the log
    still renders. READ-ONLY — places/cancels nothing.

    ``cfg`` lets a caller pass an explicit exchange config — used for the NON-CUSTODIAL case where
    the keys live in the browser and arrive as headers on the log-open request (the background loop
    and server-key users pass None → the stored singleton config)."""
    cache_key = f"live_reconcile_{username}"
    now = time.time()
    if not force:
        try:
            last = float(db._get_singleton(cache_key, 0) or 0)
            if now - last < _RECONCILE_TTL:
                return 0
        except (TypeError, ValueError):
            pass

    open_runs = db.list_open_live_runs(username)
    if not open_runs:
        db._set_singleton(cache_key, now)
        return 0

    if cfg is None:
        cfg = db.get_exchange_config()
    if not (ex.decrypt(cfg.get("apiKeyEnc") or "") and ex.decrypt(cfg.get("apiSecretEnc") or "")):
        # No usable keys on THIS pass — e.g. non-custodial keys live in the browser and weren't
        # supplied (the background loop can't see them). DON'T cache the miss, so a later on-open
        # call that DOES carry the browser creds still runs instead of hitting the 45s cache.
        return 0

    try:
        client, _ = ex._client_from_config(cfg, "spot")
        client.load_markets()
    except Exception as exc:  # noqa: BLE001 — never break the log on a client build failure
        logger.info("live reconcile: client unavailable: %s", str(exc)[:120])
        return 0

    # Group open runs by symbol so we fetch each symbol's history at most once.
    by_symbol: dict[str, list] = {}
    for r in open_runs:
        sym = r.get("symbol")
        if sym:
            by_symbol.setdefault(sym, []).append(r)

    reconciled = 0
    fee_px_cache: dict = {}                     # <ccy>/USDT prices for fee conversion (shared)
    for symbol in list(by_symbol.keys())[:_MAX_SYMBOLS]:
        base = str(symbol).split("/")[0].upper()
        runs = sorted(by_symbol[symbol], key=lambda r: str(r.get("opened_at") or ""))
        try:
            closed = client.fetch_closed_orders(symbol, limit=50)  # READ-ONLY
        except Exception as exc:  # noqa: BLE001 — one symbol failing must not stop the rest
            logger.info("live reconcile fetch skipped %s: %s", symbol, str(exc)[:100])
            continue
        sells = [o for o in (closed or [])
                 if str(o.get("side") or "").lower() == "sell"
                 and str(o.get("status") or "").lower() in ("closed", "filled")
                 and float(o.get("filled") or 0) > 0]
        sells.sort(key=lambda o: float(o.get("timestamp") or 0))
        for run in runs:
            entry = float(run.get("entry_price") or 0) or None
            opened_ms = _iso_to_ms(run.get("opened_at"))
            for o in sells:
                oid = str(o.get("id") or (o.get("info") or {}).get("orderId") or "")
                if not oid or db.live_close_order_seen(oid):
                    continue
                ots = float(o.get("timestamp") or 0)
                if opened_ms and ots and ots < opened_ms - 60000:
                    continue  # this sell predates our buy (minus 1-min skew) → not ours
                exit_px = float(o.get("average") or o.get("price") or 0) or None
                pnl = pnl_pct = None
                if entry and exit_px:
                    qty = float(run.get("qty") or o.get("filled") or 0)
                    if qty:
                        # NET of real fees (sell fill's fee + buy fee at the observed rate); the
                        # runs_log P&L drives the Home card engine figure + the closed-log LIVE rows.
                        pnl, pnl_pct = net_close_pnl(entry, exit_px, qty, o, base, fee_px_cache)
                    else:
                        pnl_pct = round((exit_px - entry) / entry * 100.0, 2)
                db.reconcile_live_run_close(
                    int(run["id"]), exit_price=exit_px, pnl=pnl, pnl_pct=pnl_pct,
                    closed_at=(_ms_to_iso(ots) or datetime.now(timezone.utc).isoformat()),
                    reason=_infer_reason(o), order_id=oid,
                )
                reconciled += 1
                break  # one close per open run

    db._set_singleton(cache_key, now)
    if reconciled:
        logger.info("live reconcile: recorded %d live close(s) for %s", reconciled, username)
    return reconciled


# Background pass cadence. Longer than reconcile_user's 45s per-user cache, so the loop never
# double-fetches and an on-open reconcile in between is a cache hit — gentle on the exchange.
RECONCILE_LOOP_SECONDS = 120


async def reconcile_loop() -> None:
    """Background: periodically reconcile live closes for users who have OPEN live runs, so an
    OCO stop/take-profit fill appears in the closed-log WITHOUT the user opening it.

    READ-ONLY — delegates to reconcile_user (fetch_closed_orders only; never places/cancels an
    order). Rate-friendly: only users with actually-open live runs (usually few — live pilots are
    master-gated off), reconcile_user's ~45s per-user cache throttles repeats, ≤25 symbols each,
    and users are spaced out. Best-effort: one user (or a bad cycle) never breaks the loop."""
    from fastapi.concurrency import run_in_threadpool
    logger.info("live reconcile loop started (poll %ss)", RECONCILE_LOOP_SECONDS)
    while True:
        try:
            open_runs = db.list_open_live_runs(None)  # every user's open live runs
            users = sorted({r.get("username") for r in open_runs if r.get("username")})
            for u in users:
                try:
                    await run_in_threadpool(reconcile_user, u)  # blocking ccxt read → threadpool
                except Exception as exc:  # noqa: BLE001 — one user must not break the loop
                    logger.info("reconcile loop: %s failed: %s", u, str(exc)[:100])
                await asyncio.sleep(2)  # space users out — gentle on the exchange
        except Exception as exc:  # noqa: BLE001
            logger.warning("reconcile loop error: %s", str(exc)[:160])
        await asyncio.sleep(RECONCILE_LOOP_SECONDS)
