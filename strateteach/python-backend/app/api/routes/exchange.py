"""Live exchange (ccxt) config + trading, plus the Profit Engine.

Every money-moving route is PIN-gated via the ``X-Exchange-Pin`` header
(see :func:`_require_pin`). The PIN helpers here are private to this module.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user, require_owner, assert_legacy_engine_enabled
from app.services.auth import verify_password
from app.services import exchange as ex
from app.services import profit_engine as pe
from app.services import signals as sig_scanner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["exchange"])


# ── input models ─────────────────────────────────────────────────────────────
class PinSetInput(BaseModel):
    newPin: str
    currentPin: Optional[str] = None


class PinVerifyInput(BaseModel):
    pin: str


class PinResetInput(BaseModel):
    """Self-service 'forgot PIN' — set a NEW PIN by proving the ACCOUNT PASSWORD (instead of
    the current PIN). Keeps the PIN a real second factor: a hijacked session without the
    password can't reset it."""
    password: str
    newPin: str


class PinAdminResetInput(BaseModel):
    username: Optional[str] = None   # whose row triggered it (audit only; the PIN is install-wide)


class ExchangeConfigInput(BaseModel):
    exchange: str
    environment: str = "testnet"
    subAccount: Optional[str] = ""
    apiKey: Optional[str] = ""
    apiSecret: Optional[str] = ""
    apiPassphrase: Optional[str] = ""
    defaultPct: float = 5.0


class ExchangeOrderInput(BaseModel):
    symbol: str
    side: str
    pct: float = 0.0
    orderType: str = "market"
    targetPrice: Optional[float] = None
    market: str = "spot"          # "spot" | "futures"
    leverage: float = 1.0
    quoteAmount: Optional[float] = None   # USDT notional; overrides pct when set
    stopLossPct: float = 0.0              # >0 → also place a native protective stop after a spot buy
    takeProfitPct: float = 0.0            # >0 → also place a take-profit sell after a spot buy (OCO with the stop)


class WithdrawInput(BaseModel):
    currency: str
    amount: float
    address: str
    tag: Optional[str] = None
    confirm: bool = False


class ProfitConfigInput(BaseModel):
    enabled: bool = False
    targetMode: str = "daily"
    dailyTarget: float = 0.0
    weeklyTarget: float = 0.0
    tiers: List[str] = ["breaking_out", "near_breakout"]
    maxPositions: int = 5
    deployPct: float = 50.0
    autoScan: bool = False
    scheduleTime: str = "09:00"
    profitPctEnabled: bool = False
    profitPctPerPosition: float = 5.0
    investAmount: float = 0.0


# ── helpers ──────────────────────────────────────────────────────────────────
def _is_masked(value: Optional[str]) -> bool:
    """A masked or empty secret means 'keep the stored value unchanged'."""
    return (not value) or ("•" in value)


def _require_pin(username: str, pin_header: Optional[str]) -> None:
    """Gate money-moving endpoints with THIS user's own protection code (PIN)."""
    stored = db.get_exchange_pin_hash(username)
    if not stored:
        raise HTTPException(403, "Set a protection code first (POST /exchange/pin).")
    if not pin_header or not ex.verify_pin(pin_header, stored):
        raise HTTPException(401, "Missing or invalid protection code.")


def _require_pin_if_set(username: str, pin_header: Optional[str]) -> None:
    """If THIS user has a protection code configured, require it even in non-custodial
    (browser-cred) mode. Closes the gap where header creds bypassed the PIN on
    high-risk routes. No PIN set → allowed (so users aren't locked out)."""
    stored = db.get_exchange_pin_hash(username)
    if stored and (not pin_header or not ex.verify_pin(pin_header, stored)):
        raise HTTPException(401, "Missing or invalid protection code (PIN).")


def exchange_creds(
    x_exchange_key: Optional[str] = Header(None, alias="X-Exchange-Key"),
    x_exchange_secret: Optional[str] = Header(None, alias="X-Exchange-Secret"),
    x_exchange_passphrase: Optional[str] = Header(None, alias="X-Exchange-Passphrase"),
    x_exchange_name: Optional[str] = Header(None, alias="X-Exchange-Name"),
    x_exchange_env: Optional[str] = Header(None, alias="X-Exchange-Env"),
) -> dict:
    """Collect browser-supplied (non-custodial) exchange credentials, if any.

    These let the keys live only in the user's browser and travel per-request —
    never written to our database. See the non-custodial design in PRR §0.
    """
    return {
        "key": x_exchange_key, "secret": x_exchange_secret,
        "passphrase": x_exchange_passphrase, "name": x_exchange_name, "env": x_exchange_env,
    }


def _header_cfg(creds: dict) -> Optional[dict]:
    """Build an ephemeral exchange config from browser-supplied (non-custodial) creds."""
    if creds and creds.get("key") and creds.get("secret"):
        return {
            "exchange": creds.get("name") or "binance",
            "environment": creds.get("env") or "testnet",
            "subAccount": "",
            "apiKeyEnc": ex.encrypt(creds["key"]),
            "apiSecretEnc": ex.encrypt(creds["secret"]),
            "apiPassphraseEnc": ex.encrypt(creds["passphrase"]) if creds.get("passphrase") else "",
            "defaultPct": 5.0, "lastTestAt": None, "lastTestStatus": None, "lastTestMessage": None,
        }
    return None


def _resolve_cfg(username: str, pin: Optional[str], creds: dict) -> dict:
    """Pick the credential source for a money route.

    Browser-only mode: if the client supplied API key + secret as headers, build an
    ephemeral config and use it transiently — no DB read, no server PIN required
    (the user is actively holding their own keys). Otherwise fall back to the
    PIN-gated, server-stored config (this user's own PIN).
    """
    hc = _header_cfg(creds)
    if hc:
        return hc
    _require_pin(username, pin)
    cfg = db.get_exchange_config()
    if not ex.decrypt(cfg["apiKeyEnc"]) or not ex.decrypt(cfg["apiSecretEnc"]):
        raise HTTPException(400, "Exchange not configured.")
    return cfg


def _public_exchange_config(username: str) -> dict:
    """Exchange config safe to return to the client — secrets masked, never raw.
    `pinSet` is per-user (this caller's own protection code)."""
    cfg = db.get_exchange_config()
    return {
        "exchange": cfg["exchange"], "environment": cfg["environment"],
        "subAccount": cfg["subAccount"], "defaultPct": cfg["defaultPct"],
        "apiKeyMasked": ex.mask(ex.decrypt(cfg["apiKeyEnc"])),
        "apiSecretMasked": ex.mask(ex.decrypt(cfg["apiSecretEnc"])),
        "apiPassphraseMasked": ex.mask(ex.decrypt(cfg["apiPassphraseEnc"])),
        "hasApiKey": bool(cfg["apiKeyEnc"]),
        "hasApiSecret": bool(cfg["apiSecretEnc"]),
        "hasApiPassphrase": bool(cfg["apiPassphraseEnc"]),
        "pinSet": bool(db.get_exchange_pin_hash(username)),
        "lastTestAt": cfg["lastTestAt"], "lastTestStatus": cfg["lastTestStatus"],
        "lastTestMessage": cfg["lastTestMessage"],
        "supportedExchanges": sorted(ex.SUPPORTED_EXCHANGES),
    }


async def _build_profit_plan(cfg: dict, ex_cfg: Optional[dict] = None) -> dict:
    """Scan crypto signals + read the live free quote balance, then build a plan.
    Read-only with respect to the exchange — never places orders.

    ``ex_cfg`` may be an ephemeral config built from browser-supplied (non-custodial)
    keys; if omitted it falls back to the server-stored config.
    """
    ex_cfg = ex_cfg or db.get_exchange_config()
    quote, free_quote = "USDT", 0.0
    if ex.decrypt(ex_cfg["apiKeyEnc"]) and ex.decrypt(ex_cfg["apiSecretEnc"]):
        bal = await run_in_threadpool(ex.get_free_quote, ex_cfg, quote)
        if bal.get("ok"):
            free_quote = float(bal.get("free") or 0.0)
    max_positions = int(cfg.get("maxPositions") or 5)
    # Prefer the cached daily scan (the day's breakouts) so the engine reads the
    # same snapshot shown on screen. Fall back to a live scan only if empty.
    # Cache-only — read the background daily scan (build_plan handles empty safely).
    signals = db.get_daily_scan().get("signals") or []
    # Only propose coins the connected exchange can actually trade — drop picks not
    # listed on the user's Binance so the plan never includes un-executable symbols.
    if ex.decrypt(ex_cfg["apiKeyEnc"]) and ex.decrypt(ex_cfg["apiSecretEnc"]):
        mk = await run_in_threadpool(ex.get_market_symbols, ex_cfg)
        syms = mk.get("symbols") or []
        if mk.get("ok") and syms:
            tradeable: set = set()
            for s in syms:
                full = s.get("symbol") or ""
                tradeable.update({full, full.split("/")[0], full.replace("/", "")})
            def _tradeable(sig: dict) -> bool:
                x = str(sig.get("symbol") or "")
                return x in tradeable or x.split("/")[0] in tradeable or x.replace("/", "") in tradeable
            signals = [s for s in signals if _tradeable(s)]
    return pe.build_plan(cfg, free_quote, quote, signals)


def _reschedule_profit(cfg: dict) -> None:
    """Auto-scan scheduling (APScheduler) is wired in M9; manual build works now."""
    logger.debug("profit auto-scan scheduling deferred to M9 (autoScan=%s)", cfg.get("autoScan"))


# ── exchange config + connection ─────────────────────────────────────────────
@router.get("/exchange/config")
async def exchange_config(user: str = Depends(current_user)):
    return _public_exchange_config(user)


@router.post("/exchange/pin")
async def exchange_set_pin(body: PinSetInput, user: str = Depends(current_user)):
    """Set/change THIS user's own PIN. First PIN needs no current PIN; changing verifies it."""
    new_pin = (body.newPin or "").strip()
    if len(new_pin) < 4:
        raise HTTPException(400, "Protection code must be at least 4 characters.")
    stored = db.get_exchange_pin_hash(user)
    if stored and (not body.currentPin or not ex.verify_pin(body.currentPin, stored)):
        raise HTTPException(401, "Current protection code is incorrect.")
    db.set_exchange_pin_hash(user, ex.hash_pin(new_pin))
    return {"ok": True, "message": "Protection code saved."}


@router.post("/exchange/pin/verify")
async def exchange_verify_pin(body: PinVerifyInput, user: str = Depends(current_user)):
    stored = db.get_exchange_pin_hash(user)
    if not stored:
        raise HTTPException(400, "No protection code set.")
    if not ex.verify_pin(body.pin or "", stored):
        raise HTTPException(401, "Invalid protection code.")
    return {"ok": True}


# ── PIN RESET (identity-verified) ────────────────────────────────────────────────
# The exchange PIN is a real-money second factor, kept STRICTLY PER USER. Both reset paths
# VERIFY identity first, so the PIN stays a real factor:
#   • self-service: prove the caller's own ACCOUNT PASSWORD → set their own PIN,
#   • admin: only the MAIN admin may clear a TARGET user's PIN (matches user-management).
@router.post("/exchange/pin/reset")
async def exchange_pin_reset(body: PinResetInput, username: str = Depends(current_user)):
    """Forgot-PIN self-service: set the CALLER's own new PIN after verifying their ACCOUNT PASSWORD."""
    new_pin = (body.newPin or "").strip()
    if len(new_pin) < 4:
        raise HTTPException(400, "Protection code must be at least 4 characters.")
    user = db.get_user(username)
    if not user or not verify_password(body.password or "", user.get("password_hash") or ""):
        raise HTTPException(401, "Account password is incorrect.")
    db.set_exchange_pin_hash(username, ex.hash_pin(new_pin))
    logger.info("exchange.pin.reset.self by=%s", username)
    return {"ok": True, "message": "Protection code reset."}


@router.post("/exchange/pin/admin-reset")
async def exchange_pin_admin_reset(body: PinAdminResetInput, admin: str = Depends(require_owner)):
    """Admin clear: the MAIN admin wipes a TARGET user's PIN (pinSet → False) so they can set a
    fresh one. Requires a valid target username (the PIN is per-user)."""
    target = (body.username or "").strip()
    if not target or not db.get_user(target):
        raise HTTPException(404, "Unknown user.")
    db.clear_exchange_pin(target)
    logger.info("exchange.pin.reset.admin by=%s target=%s", admin, target)
    return {"ok": True, "pinSet": False, "message": f"{target}'s exchange PIN cleared — they can now set a fresh one."}


@router.post("/exchange/config", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_set_config(
    body: ExchangeConfigInput,
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    user: str = Depends(current_user),
):
    _require_pin(user, x_exchange_pin)
    if body.exchange not in ex.SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {body.exchange}")
    if body.environment not in ("testnet", "live"):
        raise HTTPException(400, "environment must be 'testnet' or 'live'.")
    existing = db.get_exchange_config()
    api_key_enc = existing["apiKeyEnc"] if _is_masked(body.apiKey) else ex.encrypt(body.apiKey)
    api_secret_enc = existing["apiSecretEnc"] if _is_masked(body.apiSecret) else ex.encrypt(body.apiSecret)
    api_pass_enc = existing["apiPassphraseEnc"] if _is_masked(body.apiPassphrase) else ex.encrypt(body.apiPassphrase)
    pct = max(0.1, min(100.0, float(body.defaultPct or 5.0)))
    db.save_exchange_config(
        exchange=body.exchange, environment=body.environment,
        sub_account=body.subAccount or "", api_key_enc=api_key_enc,
        api_secret_enc=api_secret_enc, api_passphrase_enc=api_pass_enc, default_pct=pct,
    )
    return {"ok": True, "message": "Exchange settings saved."}


@router.post("/exchange/test", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_test(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    result = await run_in_threadpool(ex.test_connection, cfg)
    if not creds.get("key"):  # only persist status for the stored-config path
        db.update_exchange_test_status(result["ok"], result["message"])
    return result


@router.get("/exchange/balance", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_balance(
    market: str = "spot",
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    return await run_in_threadpool(ex.get_balances, cfg, market)


@router.get("/exchange/positions", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_positions(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    return await run_in_threadpool(ex.get_positions, cfg)


@router.get("/exchange/protective-orders", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_protective_orders(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Read-only: the resting stop-loss / OCO / take-profit sell orders on the
    account, so a user can SEE their protective stop is active and waiting."""
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    return await run_in_threadpool(ex.get_protective_orders, cfg)


@router.get("/exchange/symbols", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: builds an authed client from header creds
async def exchange_symbols(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Live list of tradeable spot symbols on the connected exchange (USDT pairs)."""
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    return await run_in_threadpool(ex.get_market_symbols, cfg)


@router.get("/exchange/engine-live-pnl")  # M7: keyless local-DB read — intentionally NOT retired (historical P&L display)
async def exchange_engine_live_pnl(user: str = Depends(current_user)):
    """LIVE Trading Engine realized P&L — ALL the engine's OWN live closes (runs_log
    mode='live', NOT a signal bot: bot_id IS NULL), fired manually or by the auto-batch,
    incl. stop/TP OCO closes. Read-only, no exchange creds/PIN needed. Used by the Home LIVE
    bucket so the engine figure never double-counts bots or open positions' unrealized P&L."""
    return {"ok": True, **db.profit_engine_live_stats(user)}


@router.get("/exchange/live-pnl", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_live_pnl(
    tzOffset: int = 0,
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Real spot P&L from the order log: current holdings value (marked to live
    price) + total sell proceeds − total buy cost. Plus net invested (cost basis).

    Order-log reads and the day-baseline snapshot are scoped to the authenticated
    ``user`` so one user's live orders / baseline never bleed into another's."""
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    bal = await run_in_threadpool(ex.get_balances, cfg, "spot")
    balances = (bal or {}).get("balances") or []
    free_usdt = next((float(b.get("free") or 0) for b in balances if str(b.get("asset") or "").upper() == "USDT"), 0.0)
    holds = [b for b in balances if str(b.get("asset") or "").upper() != "USDT" and float(b.get("total") or 0) > 0]
    prices: dict = {}
    if holds:
        syms = [f"{str(b['asset']).upper()}/USDT" for b in holds]
        prices = await run_in_threadpool(ex.fetch_prices, syms) or {}
    holdings_value = sum(float(b.get("total") or 0) * float(prices.get(f"{str(b['asset']).upper()}/USDT", 0) or 0) for b in holds)

    acts = db.list_activity(limit=5000, mode="live", username=user)
    orders = [a for a in acts if a.get("kind") == "order"]
    # NET realized P&L: attach real per-order Binance fees (read-only fetch_my_trades, cached ~5min)
    # so replay_orders below returns realized NET of fees. Best-effort — falls back to GROSS.
    try:
        from app.services import live_reconcile
        orders = await run_in_threadpool(live_reconcile.enrich_orders_with_fees, user, cfg, orders)
    except Exception:  # noqa: BLE001
        pass
    buy = sum(float(a.get("cost") or 0) for a in orders if (a.get("side") or "").lower() == "buy")
    sell = sum(float(a.get("cost") or 0) for a in orders if (a.get("side") or "").lower() == "sell")
    total_pnl = holdings_value + sell - buy

    # Per-symbol cost basis from the order log via a MOVING-AVERAGE tracker that
    # ACCOUNTS FOR SELLS (shared with close-profitable-spot so they agree 1:1). The old
    # code summed BUYS ONLY (Σbuycost/Σbuyqty), so for any asset traded in-and-out it
    # averaged in the cost of coins ALREADY SOLD — the "entry" no longer matched the
    # currently-held lot, and per-position P&L (and its sum) were wrong RELATIVE TO
    # PURCHASE TIME. avg_cost_basis() replays orders oldest-first and decrements cost on
    # sells → the true cost basis of the coins the user holds now.
    _rep = ex.replay_orders(orders)
    basis_map = _rep["basis"]
    realized_pnl = float(_rep.get("realized") or 0.0)   # closed-trade P&L (sell-aware)
    positions = []
    for b in holds:
        base = str(b.get("asset")).upper()
        qty = float(b.get("total") or 0)
        px = float(prices.get(f"{base}/USDT", 0) or 0)
        value = qty * px
        # Average ENTRY = remaining tracked cost / remaining tracked qty — the real cost
        # basis of the held lot (None when there's no buy record for this asset).
        bm = basis_map.get(base) or {}
        avg = (bm["cost"] / bm["qty"]) if bm.get("qty", 0.0) > 1e-12 else None
        basis = (avg * qty) if avg else None
        pnl = (value - basis) if basis is not None else None
        pnl_pct = (pnl / basis * 100.0) if (basis and basis > 0 and pnl is not None) else None
        positions.append({
            "symbol": f"{base}/USDT", "asset": base, "qty": qty, "price": round(px, 8),
            "value": round(value, 2), "avgCost": (round(avg, 8) if avg else None),
            "pnl": (round(pnl, 2) if pnl is not None else None),
            "pnlPct": (round(pnl_pct, 2) if pnl_pct is not None else None),
        })
    positions.sort(key=lambda x: x["value"], reverse=True)
    # Total P&L = sum of each REAL (non-dust) position's P&L. Sub-$1 crumbs left by
    # sells are excluded so a flat account reads $0, not noise from rounding.
    positions_pnl = round(sum((p.get("pnl") or 0) for p in positions if p.get("pnl") is not None and (p.get("value") or 0) >= 1), 2)
    non_dust = sum(1 for p in positions if (p.get("value") or 0) >= 1)
    # Total P&L as a percent of the cost basis of the real (non-dust) positions —
    # so the headline can show "+$X (+Y%)" consistent with each position's pnlPct.
    pnl_basis = sum(
        ((p.get("avgCost") or 0) * (p.get("qty") or 0))
        for p in positions
        if p.get("avgCost") is not None and (p.get("value") or 0) >= 1
    )
    positions_pnl_pct = round((positions_pnl / pnl_basis * 100.0), 2) if pnl_basis > 0 else None
    total_value = free_usdt + holdings_value
    # Deposit-aware baseline: on a LIVE wallet, fetch read-only net deposits so the
    # first-day baseline is the user's cost basis (a $250 deposit → value $270 reads
    # +$20/+8%, not +$0) and same-day cash moves never count as profit. Read-only:
    # only deposit/withdrawal HISTORY — never moves funds. Any failure (e.g. the key
    # lacks history permission) falls back to the snapshot baseline; the card never
    # breaks. Testnet keeps the pure-snapshot baseline (no real deposits to honour).
    deposit_events = None
    net_deposits_total = None
    if str(cfg.get("environment") or "").lower() == "live":
        try:
            nd = await run_in_threadpool(ex.get_net_deposits, cfg)
            if nd.get("ok"):
                deposit_events = nd.get("events") or []
                net_deposits_total = nd.get("total")
        except Exception:  # noqa: BLE001
            deposit_events = None
    # Account-value change over today / month / year on local-time boundaries,
    # snapshotted PER (user, env=live) so the baseline is this user's own. A
    # manually-set "deposited capital" (cost basis) takes priority over the
    # auto-fetched net deposits for the first-day baseline (see _baseline).
    cost_basis = db.get_cost_basis(user, "live")
    period = db.record_and_compute_value_pnl(
        total_value, tzOffset, username=user, env="live", deposit_events=deposit_events,
        cost_basis=cost_basis,
    )
    # ── HEADLINE METRIC: portfolio GROWTH vs. NET DEPOSITED CAPITAL ──────────────
    # What the user actually cares about: how much the whole sub-account grew relative
    # to the money they put in — NOT a cost-basis sum over a bot that recycles the same
    # base capital through thousands of dollars of churn. deposit_base = the user's
    # manually-set "deposited capital" (reliable; e.g. $250 here) if set, ELSE the
    # exchange's net-deposit history when it's actually populated (>0). Growth =
    # current total value − deposit_base. Example: $250 → $280 = +$30 (+12%).
    manual_base = cost_basis if (cost_basis is not None and float(cost_basis) > 0) else None
    exch_base = net_deposits_total if (net_deposits_total is not None and float(net_deposits_total) > 0) else None
    deposit_base = manual_base if manual_base is not None else exch_base
    deposit_source = "manual" if manual_base is not None else ("exchange" if exch_base is not None else None)
    growth_pnl = round(total_value - deposit_base, 2) if deposit_base else None
    growth_pct = round((growth_pnl / deposit_base) * 100.0, 2) if (deposit_base and deposit_base > 0 and growth_pnl is not None) else None
    # Secondary/legacy measures (kept for admin/debug; retired from the user headline):
    #   totalPnl/Pct = unrealized on held positions; realized/lifetime = cost-basis churn.
    unrealized_pnl = positions_pnl
    lifetime_pnl = round(realized_pnl + unrealized_pnl, 2)
    return {
        "ok": True,
        # Primary headline the UI shows:
        "growthPnl": growth_pnl,
        "growthPct": growth_pct,
        "depositBase": (round(float(deposit_base), 2) if deposit_base else None),
        "depositSource": deposit_source,
        # Per-position unrealized (real, per row) — the aggregate is NO LONGER the headline:
        "totalPnl": positions_pnl,
        "totalPnlPct": positions_pnl_pct,
        "unrealizedPnl": round(unrealized_pnl, 2),
        # Cost-basis churn — retained for admin/debug only, not user-facing:
        "realizedPnl": round(realized_pnl, 2),
        "lifetimePnl": lifetime_pnl,
        "totalValue": round(total_value, 2),
        "count": non_dust,
        "period": period,
        "costBasis": cost_basis,
        "netDeposits": (round(net_deposits_total, 2) if net_deposits_total is not None else None),
        "invested": round(max(0.0, buy - sell), 2),
        "holdingsValue": round(holdings_value, 2),
        "available": round(free_usdt, 2),
        "buyCost": round(buy, 2),
        "sellProceeds": round(sell, 2),
        "positions": positions,
    }


class CostBasisInput(BaseModel):
    env: str = "live"
    value: float = 0.0


class ExchangeCredsBackupInput(BaseModel):
    """The user's exchange connection, pushed for the encrypted server-side backup.
    Same shape as the browser's non-custodial creds (name/env/key/secret/passphrase)."""
    name: Optional[str] = "binance"          # exchange id (binance / bybit / coinbase)
    env: Optional[str] = "testnet"           # 'live' | 'testnet'
    subAccount: Optional[str] = ""
    key: str
    secret: str
    passphrase: Optional[str] = ""


@router.get("/exchange/cost-basis")
async def exchange_get_cost_basis(env: str = "live", user: str = Depends(current_user)):
    """Read the authenticated user's deposited capital (cost basis) for an env
    ∈ {live, demo}. Per-user only — no PIN (it's a personal setting, not a money
    move). ``costBasis`` is null when unset."""
    return {"ok": True, "env": (env or "live"), "costBasis": db.get_cost_basis(user, env)}


@router.post("/exchange/cost-basis")
async def exchange_set_cost_basis(body: CostBasisInput, user: str = Depends(current_user)):
    """Set (or clear, with value ≤ 0) the authenticated user's deposited capital
    for an env ∈ {live, demo}. Stored PER user — used as the Home-card baseline."""
    res = db.set_cost_basis(user, body.env, body.value)
    return {"env": (body.env or "live"), **res}


# ── Encrypted exchange-key backup (cross-device / survives cache-clear) ─────────
# The keys still live in the browser as the fast path (non-custodial). This is an
# OPT-IN encrypted-at-rest copy so a user who clears site-data or signs in on a new
# device gets their connection back. Ciphertext-at-rest (Fernet / SESSION_SECRET —
# the SAME scheme the Signal Bots use). Strict per-user isolation: every route keys
# on the authenticated caller's own username; a user can only ever touch their own row.
@router.post("/exchange/creds-backup", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_save_creds_backup(body: ExchangeCredsBackupInput, user: str = Depends(current_user)):
    """Save (encrypt at rest) the authenticated user's exchange creds for cross-device
    restore. Plaintext keys are encrypted here and NEVER stored in the clear."""
    key = (body.key or "").strip()
    secret = (body.secret or "").strip()
    if not key or not secret:
        raise HTTPException(400, "API key and secret are required.")
    db.save_exchange_creds_backup(
        username=user,
        exchange=(body.name or "binance"),
        environment=(body.env or "testnet"),
        sub_account=((body.subAccount or "").strip() or None),
        enc_key=ex.encrypt(key),
        enc_secret=ex.encrypt(secret),
        enc_passphrase=(ex.encrypt(body.passphrase.strip()) if (body.passphrase or "").strip() else ""),
    )
    logger.info("exchange.creds-backup.save user=%s exchange=%s env=%s", user, body.name, body.env)
    return {"ok": True}


@router.get("/exchange/creds-backup")
async def exchange_get_creds_backup(user: str = Depends(current_user)):
    """Restore the authenticated OWNER's encrypted creds (decrypted only here, only
    to the owner, over HTTPS). Returns hasBackup:false when nothing is stored."""
    row = db.get_exchange_creds_backup(user)
    if not row:
        return {"ok": True, "hasBackup": False}
    key = ex.decrypt(row.get("enc_key") or "")
    secret = ex.decrypt(row.get("enc_secret") or "")
    if not key or not secret:
        # Stale/undecryptable ciphertext (e.g. SESSION_SECRET rotated) — treat as no backup.
        return {"ok": True, "hasBackup": False}
    return {
        "ok": True,
        "hasBackup": True,
        "creds": {
            "name": row.get("exchange") or "binance",
            "env": row.get("environment") or "testnet",
            "subAccount": row.get("sub_account") or "",
            "key": key,
            "secret": secret,
            "passphrase": ex.decrypt(row.get("enc_passphrase") or ""),
        },
        "updatedAt": row.get("updated_at"),
    }


@router.delete("/exchange/creds-backup")
async def exchange_delete_creds_backup(user: str = Depends(current_user)):
    """Delete the authenticated user's server-side backup (on explicit disconnect)."""
    db.delete_exchange_creds_backup(user)
    logger.info("exchange.creds-backup.delete user=%s", user)
    return {"ok": True}


@router.post("/exchange/order", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_order(
    body: ExchangeOrderInput,
    request: Request,
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    # Compliance guard (BTC-only): no-op unless the owners turned the flag on; then
    # a restricted client may only trade Bitcoin pairs. Owners are exempt.
    from app.core.compliance import assert_btc_only_ok
    assert_btc_only_ok(user, body.symbol)
    result = await run_in_threadpool(
        ex.place_order, cfg, body.symbol, body.side, body.pct, body.orderType, body.targetPrice,
        body.market, body.leverage, body.quoteAmount, body.stopLossPct, body.takeProfitPct,
    )
    logger.info("Exchange order (%s %s %s %s): %s", body.market, body.side, body.symbol,
                cfg["environment"], result.get("message"))
    if result.get("ok"):
        o = result.get("order") or {}
        amount = float(o.get("amount") or 0.0)
        price = float(o.get("price") or 0.0)
        # Prefer the exchange's filled cost (real proceeds/spend); market sells
        # report null price, so amount*price would log $0 and break P&L.
        c = o.get("cost")
        cost = float(c) if c not in (None, "") and float(c or 0) > 0 else (amount * price if amount and price else None)
        sym = o.get("symbol") or body.symbol
        ts = datetime.now(timezone.utc).isoformat()
        uname = getattr(request.state, "username", None)
        db.add_activity(
            "live", "order", sym,
            side=(o.get("side") or body.side), qty=amount, price=price, cost=cost,
            environment=cfg.get("environment"), ts=ts, username=uname,
        )
        # Observational runs-log (best-effort; never affects the order): buy opens a
        # live run, sell closes the latest matching open one.
        try:
            sd = str(o.get("side") or body.side or "").lower()
            if sd == "buy":
                db.log_run_open(username=uname, mode="live", symbol=sym, side="buy",
                                entry_price=price or None, qty=amount or None, opened_at=ts, source="manual")
            elif sd == "sell":
                # NET-of-fees P&L for a MANUAL live close (was gross): pair to the open run for its
                # entry, then net = gross − (this sell fill's real fee + the buy fee at the observed
                # rate) via the SAME helper reconcile uses. Read-only; no fee data → gross fallback.
                run_pnl = run_pnl_pct = None
                try:
                    from app.services import live_reconcile as _lr
                    opens = [r for r in db.list_open_live_runs(uname) if str(r.get("symbol")) == sym]
                    if opens and price:
                        r0 = opens[-1]
                        entry_px = float(r0.get("entry_price") or 0) or None
                        cqty = float(r0.get("qty") or amount or 0)
                        if entry_px and cqty:
                            run_pnl, run_pnl_pct = _lr.net_close_pnl(
                                entry_px, float(price), cqty, o, sym.split("/")[0].upper(), {})
                except Exception:  # noqa: BLE001 — netting is best-effort; never block the close log
                    run_pnl = run_pnl_pct = None
                db.log_run_close(username=uname, mode="live", symbol=sym, exit_price=price or None,
                                 pnl=run_pnl, pnl_pct=run_pnl_pct, status="closed", closed_at=ts)
        except Exception:  # noqa: BLE001
            pass
    return result


@router.post("/exchange/withdraw", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_withdraw(
    body: WithdrawInput,
    request: Request,
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Withdraw to an external address. Requires explicit confirmation. Audited."""
    if not body.confirm:
        raise HTTPException(400, "Withdrawal must be explicitly confirmed (confirm=true).")
    if not (body.address or "").strip():
        raise HTTPException(400, "Destination address is required.")
    _require_pin_if_set(user, x_exchange_pin)  # withdraw always honors this user's PIN, even with browser creds
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    result = await run_in_threadpool(ex.withdraw, cfg, body.currency, body.amount, body.address, body.tag)
    actor = getattr(request.state, "username", None)
    ts = datetime.now(timezone.utc).isoformat()
    db.add_audit("exchange.withdraw", actor=actor, ip=(request.client.host if request.client else None),
                 detail={"currency": body.currency, "amount": body.amount,
                         "address": body.address, "ok": result.get("ok"), "env": cfg.get("environment")})
    if result.get("ok"):
        db.add_activity("live", "withdraw", body.currency, qty=float(body.amount or 0), price=0.0,
                        environment=cfg.get("environment"), ts=ts, username=actor)
    logger.info("Withdraw (%s %s -> %s…, %s): %s", body.amount, body.currency,
                (body.address or "")[:8], cfg.get("environment"), result.get("message"))
    return result


@router.post("/exchange/close-profitable", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_close_profitable(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Close every open position currently in profit in one batch.

    Covers BOTH account types so the button always acts on what the UI shows:
      • derivative/futures positions in profit (reduce-only market close), and
      • SPOT holdings in profit (sold back to USDT, using the same order-log cost
        basis as live-pnl — this is the path that was missing).
    """
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    fut = await run_in_threadpool(ex.close_profitable_positions, cfg)
    # Spot winners: pass THIS user's live order log so the cost basis matches
    # live-pnl 1:1 (scoped per user — never another user's orders).
    orders = [a for a in db.list_activity(limit=5000, mode="live", username=user) if a.get("kind") == "order"]
    spot = await run_in_threadpool(ex.close_profitable_spot, cfg, orders)

    closed = (fut.get("closed") or []) + (spot.get("closed") or [])
    errors = (fut.get("errors") or []) + (spot.get("errors") or [])
    realized = float(fut.get("realized") or 0.0) + float(spot.get("realized") or 0.0)
    # ok unless a connection/auth call genuinely failed with nothing closed.
    ok = (bool(fut.get("ok", True)) and bool(spot.get("ok", True))) or len(closed) > 0
    if closed:
        message = f"Closed {len(closed)} position(s) in profit."
        if errors:
            message += f" {len(errors)} failed to close."
    elif errors:
        message = f"Nothing closed — {len(errors)} failed. Try again or close manually."
    else:
        message = "No positions are currently in profit."
    result = {"ok": ok, "closed": closed, "errors": errors, "realized": round(realized, 2),
              "closedCount": len(closed), "message": message}

    logger.info("Close-profitable (%s): %s", cfg["environment"], message)
    ts = datetime.now(timezone.utc).isoformat()
    for c in closed:
        db.add_activity(
            "live", "order", c.get("symbol"),
            side=("sell" if (c.get("side") or "").lower() == "long" else "buy"),
            qty=float(c.get("contracts") or 0.0), price=0.0,
            pnl=float(c.get("unrealizedPnl") or 0.0),
            environment=cfg.get("environment"), ts=ts, username=user,
        )
    return result


@router.post("/exchange/close-spot", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_close_spot(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Sell every non-USDT spot holding back to USDT (fully flatten each)."""
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    result = await run_in_threadpool(ex.close_all_spot, cfg)
    logger.info("Close-spot (%s): %s", cfg["environment"], result.get("message"))
    ts = datetime.now(timezone.utc).isoformat()
    for c in result.get("closed", []):
        amt = float(c.get("amount") or 0.0)
        px = float(c.get("price") or 0.0)
        cc = c.get("cost")
        cost = float(cc) if cc not in (None, "") and float(cc or 0) > 0 else (amt * px if amt and px else None)
        db.add_activity(
            "live", "order", c.get("symbol"), side="sell",
            qty=amt, price=px, cost=cost,
            environment=cfg.get("environment"), ts=ts, username=user,
        )
    return result


@router.post("/exchange/clean-dust", dependencies=[Depends(assert_legacy_engine_enabled)])  # M7: legacy engine retired
async def exchange_clean_dust(
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    creds: dict = Depends(exchange_creds),
    user: str = Depends(current_user),
):
    """Sell only sub-$5 'dust' leftovers (non-USDT) back to USDT; real holdings stay."""
    cfg = _resolve_cfg(user, x_exchange_pin, creds)
    result = await run_in_threadpool(ex.clean_dust_spot, cfg)
    logger.info("Clean-dust (%s) by %s: %s | details=%s", cfg["environment"], user,
                result.get("message"), result.get("details"))
    ts = datetime.now(timezone.utc).isoformat()
    for c in result.get("closed", []):
        amt = float(c.get("amount") or 0.0)
        px = float(c.get("price") or 0.0)
        cc = c.get("cost")
        cost = float(cc) if cc not in (None, "") and float(cc or 0) > 0 else (amt * px if amt and px else None)
        db.add_activity(
            "live", "order", c.get("symbol"), side="sell",
            qty=amt, price=px, cost=cost,
            environment=cfg.get("environment"), ts=ts, username=user,
        )
    return result


@router.post("/exchange/live-stats-reset")
async def exchange_live_stats_reset():
    """Zero the live realized-P&L dashboard counters from now on (non-destructive:
    the order log is kept, but only trades after this moment count toward the card)."""
    since = await run_in_threadpool(db.set_live_stats_baseline)
    return {"ok": True, "since": since}


@router.post("/exchange/day-start")
async def exchange_set_day_start(value: float, tzOffset: int = 0, user: str = Depends(current_user)):
    """Anchor today's opening total funds (local time) so "profit today" reads
    current − this value. Used to seed the day's start when no automatic
    start-of-day snapshot exists yet. Scoped to the authenticated user."""
    return await run_in_threadpool(db.set_day_open, value, tzOffset, user, "live")


# ── profit engine ────────────────────────────────────────────────────────────
@router.get("/exchange/profit-config")
async def profit_config():
    # No secrets or balance amounts — safe to read without the PIN.
    return db.get_profit_config()


@router.post("/exchange/profit-config")
async def profit_set_config(body: ProfitConfigInput):
    # Config holds no secrets — no PIN required (auth already applies).
    if body.targetMode not in ("daily", "weekly"):
        raise HTTPException(400, "targetMode must be 'daily' or 'weekly'.")
    tiers = [t for t in body.tiers if t in pe.TRADEABLE_TIERS] or list(pe.DEFAULT_TIERS)
    t = (body.scheduleTime or "09:00").strip()
    try:
        hh, mm = t.split(":")
        if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(400, "scheduleTime must be HH:MM (24h).")
    db.save_profit_config(
        enabled=body.enabled, target_mode=body.targetMode,
        daily_target=max(0.0, float(body.dailyTarget or 0.0)),
        weekly_target=max(0.0, float(body.weeklyTarget or 0.0)),
        tiers=tiers, max_positions=max(1, min(50, int(body.maxPositions or 5))),
        deploy_pct=max(1.0, min(100.0, float(body.deployPct or 50.0))),
        auto_scan=body.autoScan, schedule_time=t,
        profit_pct_enabled=body.profitPctEnabled,
        profit_pct_per_position=max(0.1, min(1000.0, float(body.profitPctPerPosition or 5.0))),
        invest_amount=max(0.0, float(body.investAmount or 0.0)),
    )
    _reschedule_profit(db.get_profit_config())
    return {"ok": True, "message": "Trading engine settings saved."}


@router.post("/exchange/profit-plan/build")
async def profit_plan_build(creds: dict = Depends(exchange_creds)):
    # Live mode: browser keys (if present) provide the balance. Demo mode: no keys —
    # the plan is sized purely from the invest amount + signals (no exchange call).
    ex_cfg = _header_cfg(creds)
    cfg = db.get_profit_config()
    plan = await _build_profit_plan(cfg, ex_cfg=ex_cfg)
    db.save_profit_plan(plan)
    logger.info("Profit-engine plan built on demand: %d trades", plan.get("nTrades", 0))
    return plan


@router.get("/exchange/profit-plan")
async def profit_plan(x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin")):
    cfg = db.get_profit_config()
    return {"plan": db.get_profit_plan(), "builtAt": cfg.get("lastBuiltAt")}
