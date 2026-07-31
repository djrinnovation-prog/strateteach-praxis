"""AutoPilots — REAL-MONEY (Bybit / Binance) executor. HEAVILY SAFEGUARDED · MASTER-GATED · OWNER-ONLY.

═══════════════════════════════════════════════════════════════════════════════════════
  READ BEFORE ENABLING. This is the ONLY module in the app that can place a real
  AutoPilot order. It ships GATED OFF and must be reviewed before it is ever used live.
═══════════════════════════════════════════════════════════════════════════════════════

MASTER GATE (ultimate safeguard):
  No real order is EVER placed unless the environment variable ``AUTOPILOT_LIVE_ENABLED``
  is truthy on the server. It defaults OFF. So even if an owner completes the whole
  multi-step GO-LIVE flow, the executor no-ops (and audits "skipped") until an operator
  (Dan) explicitly flips this env var AFTER reviewing this code. This makes it safe to
  ship the structure without any risk of an accidental real order.

EVERY order additionally requires ALL of these to hold (checked per action):
  1. master gate ON (env AUTOPILOT_LIVE_ENABLED)
  2. the pilot's mode == 'live'  (owner completed the GO-LIVE multi-step confirm)
  3. the owner has connected exchange keys — Bybit OR Binance (encrypted, server-side, never logged)
  4. spend ≤ the owner-set live_cap AND ≤ the remaining live budget for that pilot
  5. the order clears the exchange's min-notional (else SKIPPED + audited — never silent)

SCOPE OF LIVE v1 (conservative on purpose):
  SPOT · LONG-ONLY. No shorts, no futures, no leverage — regardless of the pilot's
  simulated direction. Long entry → real spot BUY; exit signal → real spot SELL to close.
  Sizing = the pilot's per-trade % of the live_cap, bounded by the remaining budget, the
  free USDT balance (enforced inside exchange.place_order), and min-notional.

KEY STORAGE: the owner's exchange key+secret (Bybit or Binance) are Fernet-encrypted
(SESSION_SECRET-derived, the SAME scheme as the main exchange creds) and stored in
autopilot_exchange_keys, alongside which exchange they belong to. They
are NEVER returned raw to the client and NEVER written to logs or the audit trail — only a
masked hint (last 4 chars) is ever surfaced.

AUDIT: every live action (keys connect/disconnect, go-live, stop-live, order
attempt/placed/failed/skipped) is appended to autopilot_live_audit with NON-SECRET detail.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Optional

from app import database as db
from app.services import exchange as ex

logger = logging.getLogger(__name__)

# ── Caps / limits (env-overridable; conservative defaults) ──────────────────────────────
# The MANDATORY first-live-run capital cap the owner sets must fall in [MIN, MAX]. MAX is
# deliberately LOW; raise it only deliberately via env once the flow is trusted.
LIVE_CAP_MIN_USD = float(os.environ.get("AUTOPILOT_LIVE_CAP_MIN", "10"))
LIVE_CAP_MAX_USD = float(os.environ.get("AUTOPILOT_LIVE_CAP_MAX", "250"))
# The exact string the owner must type to confirm going live.
GO_LIVE_PHRASE = "GO LIVE"
# Only these exchanges are allowed for the AutoPilots live path. Bybit and Binance are both
# supported (spot · long-only); the owner picks one when connecting keys. exchange.place_order
# already speaks both (Binance spot incl. native OCO), and get_balances reads both spot wallets.
ALLOWED_EXCHANGES = {"bybit", "binance"}


def live_master_enabled() -> bool:
    """The ultimate gate for the legacy autopilot LIVE executor. OFF by default.

    M7 (full retirement): this whole path — including the BACKGROUND autopilot loop that can
    reach ``apply_pilot_live`` for a live-mode pilot — is retired while the legacy engine is
    retired. Execution lives ONLY in Praxis now. So the gate is hard-OFF unless BOTH the legacy
    engine is explicitly re-enabled AND the operator sets AUTOPILOT_LIVE_ENABLED. With the legacy
    flag unset (the default), no stored autopilot key can ever place a real order, regardless of
    AUTOPILOT_LIVE_ENABLED — closing the one live path that is NOT behind an HTTP route."""
    if os.environ.get("STRATETEACH_LEGACY_ENGINE_ENABLED", "false").strip().lower() != "true":
        return False
    return os.environ.get("AUTOPILOT_LIVE_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


# ── Key management (owner enters own keys; encrypted at rest; never logged/returned) ─────

def _cfg_from_keys(row: dict) -> dict:
    """Build an exchange.place_order-compatible cfg from a stored (ciphertext) keys row.
    The *Enc fields are the SAME Fernet ciphertext exchange._decrypt_config expects, so no
    plaintext is ever handled here — decryption happens inside the exchange client factory."""
    return {
        "exchange": row.get("exchange") or "bybit",
        "environment": row.get("environment") or "testnet",
        "subAccount": "",
        "apiKeyEnc": row.get("enc_key") or "",
        "apiSecretEnc": row.get("enc_secret") or "",
        "apiPassphraseEnc": "",
        "defaultPct": 0.0,
    }


def connect_keys(username: str, api_key: str, api_secret: str, environment: str = "testnet",
                 exchange: str = "bybit") -> dict:
    """Owner connects THEIR OWN exchange keys (Bybit or Binance — their choice). Encrypts +
    stores server-side. NEVER logs the raw values; audit records only a masked hint, the
    exchange, and the environment."""
    # Phase 2B · M4: in the unified app StrateTeach holds NO exchange keys. Refuse to store one unless the
    # legacy engine is explicitly armed — users connect their key straight to Praxis (connect-credential).
    if not ex._engine_enabled():
        return {"ok": False,
                "message": "strateteach_engine_disabled: connect your exchange key to Praxis, not StrateTeach."}
    exchange = (exchange or "bybit").strip().lower()
    api_key = (api_key or "").strip()
    api_secret = (api_secret or "").strip()
    environment = "live" if (environment or "").strip().lower() == "live" else "testnet"
    if not api_key or not api_secret:
        return {"ok": False, "message": "API key and secret are required."}
    if exchange not in ALLOWED_EXCHANGES:
        allowed = " or ".join(sorted(e.capitalize() for e in ALLOWED_EXCHANGES))
        return {"ok": False, "message": f"Only {allowed} are supported for AutoPilots live."}
    enc_key = ex.encrypt(api_key)
    enc_secret = ex.encrypt(api_secret)
    db.save_autopilot_keys(username=username, exchange=exchange, environment=environment,
                           enc_key=enc_key, enc_secret=enc_secret)
    db.log_autopilot_live_audit(username=username, pilot_id=None, action="keys_connected",
                                detail={"exchange": exchange, "environment": environment,
                                        "keyHint": ex.mask(api_key)})
    return keys_status(username)


def keys_status(username: str) -> dict:
    """Connection status — masked ONLY, never raw. Safe to return to the client."""
    row = db.get_autopilot_keys(username)
    if not row or not row.get("connected"):
        return {"connected": False, "exchange": "bybit", "environment": "testnet",
                "keyHint": "", "lastTestAt": None, "lastTestOk": None, "lastTestMsg": None}
    # Decrypt-then-mask (same safe pattern as the main exchange config's public view).
    hint = ex.mask(ex.decrypt(row.get("enc_key") or ""))
    return {
        "connected": True,
        "exchange": row.get("exchange") or "bybit",
        "environment": row.get("environment") or "testnet",
        "keyHint": hint,
        "lastTestAt": row.get("last_test_at"),
        "lastTestOk": row.get("last_test_ok"),
        "lastTestMsg": row.get("last_test_msg"),
    }


def test_keys(username: str) -> dict:
    """READ-ONLY connectivity check (fetch_balance). Places NO order. Records the result."""
    row = db.get_autopilot_keys(username)
    if not row or not row.get("connected"):
        return {"ok": False, "message": "No keys connected."}
    res = ex.test_connection(_cfg_from_keys(row))
    db.set_autopilot_keys_test(username, bool(res.get("ok")), str(res.get("message") or ""))
    # Never echo balances detail back through here beyond ok/message.
    return {"ok": bool(res.get("ok")), "message": res.get("message") or ""}


_STABLES = {"USDT", "USDC", "USD", "BUSD", "DAI", "TUSD", "FDUSD"}


def wallet_balance(username: str) -> dict:
    """READ-ONLY spot wallet balance via CCXT fetch_balance (NO trading), for whichever
    exchange the owner connected (Bybit or Binance). Returns a USD estimate (stablecoins at
    face value + other holdings valued at live prices) plus the per-asset breakdown and free
    USDT. Never places an order; never returns keys. get_balances handles the Bybit
    UNIFIED/SPOT/FUND wallet probe and the plain Binance-spot read transparently."""
    row = db.get_autopilot_keys(username)
    if not row or not row.get("connected"):
        return {"ok": False, "connected": False, "message": "No exchange keys connected."}
    cfg = _cfg_from_keys(row)
    res = ex.get_balances(cfg, "spot")   # {ok, balances:[{asset,free,total}], message}
    if not res.get("ok"):
        return {"ok": False, "connected": True, "environment": row.get("environment"),
                "message": res.get("message") or "Balance query failed."}
    balances = res.get("balances") or []
    stable_usd = sum(float(b.get("total") or 0) for b in balances if str(b.get("asset", "")).upper() in _STABLES)
    total_usd = stable_usd
    nonstable = [b for b in balances if str(b.get("asset", "")).upper() not in _STABLES]
    if nonstable:
        try:  # value other holdings at live prices — best-effort, never fatal
            from app.services.exchange import fetch_prices
            prices = fetch_prices([f"{b['asset']}/USDT" for b in nonstable]) or {}
            for b in nonstable:
                px = prices.get(f"{b['asset']}/USDT")
                if px:
                    total_usd += float(b.get("total") or 0) * float(px)
        except Exception as exc:  # noqa: BLE001
            logger.warning("autopilot balance valuation failed user=%s: %s", username, exc)
    free_usdt = 0.0
    try:
        fq = ex.get_free_quote(cfg, "USDT")
        free_usdt = float(fq.get("free") or 0) if fq.get("ok") else 0.0
    except Exception:  # noqa: BLE001
        pass
    return {
        "ok": True, "connected": True, "environment": row.get("environment") or "testnet",
        "exchange": row.get("exchange") or "bybit",
        # For Bybit: which wallet the balance resolved to (UNIFIED for a UTA account, SPOT/FUND
        # for a Standard subaccount). For Binance spot this is None (plain single read). Surfaced
        # for transparency/debugging.
        "accountType": res.get("accountType"),
        "totalUsd": round(total_usd, 2), "stableUsd": round(stable_usd, 2), "freeUsdt": round(free_usdt, 2),
        "balances": [{"asset": b.get("asset"), "free": round(float(b.get("free") or 0), 8),
                      "total": round(float(b.get("total") or 0), 8)} for b in balances[:8]],
    }


def disconnect_keys(username: str) -> dict:
    """Remove stored keys. Also forces every one of the owner's pilots back to simulation
    (belt-and-suspenders: no live pilot can exist without keys)."""
    for a in db.list_autopilot_armed(username):
        if (a.get("mode") or "simulation") == "live":
            db.set_autopilot_mode(username, a["pilot_id"], "simulation")
            db.log_autopilot_live_audit(username=username, pilot_id=a["pilot_id"], action="stop_live",
                                        detail={"reason": "keys disconnected"})
    db.delete_autopilot_keys(username)
    db.log_autopilot_live_audit(username=username, pilot_id=None, action="keys_disconnected", detail={})
    return {"ok": True, **keys_status(username)}


# ── Go-live / kill-switch ────────────────────────────────────────────────────────────────

def go_live(username: str, pilot_id: str, cap: float, typed_confirm: str, ack_real: bool) -> dict:
    """Flip ONE pilot to live — ONLY when every multi-step guard passes:
      · the pilot is armed
      · Bybit keys are connected
      · a mandatory starting-capital cap within [MIN, MAX] is provided
      · the owner typed the exact GO-LIVE phrase and acknowledged real-money risk
    Sets mode='live' + stores the cap. (Real orders still require the MASTER gate at
    run time — this only records the owner's intent.)"""
    # Phase 2B · M4: the legacy live engine is retired in the unified app — live trading runs through
    # Praxis, not StrateTeach. Refuse to arm live here unless the engine is explicitly re-enabled.
    if not ex._engine_enabled():
        return {"ok": False,
                "message": "strateteach_engine_disabled: live trading runs through Praxis in the unified app."}
    armed = db.get_autopilot_armed(username, pilot_id)
    if not armed:
        return {"ok": False, "message": "That pilot is not loaded."}
    # DR Stocks (mean-reversion, market=stocks) is SIMULATION-only — no crypto exchange executes
    # equities, so it can never go live here. (DR-Crypto + the tier crypto pilots ARE live-capable.)
    from app.services.autopilot_sim import _is_mr
    if _is_mr(pilot_id):
        return {"ok": False, "message": "This pilot trades stocks — it is simulation-only and cannot go live on a crypto exchange."}
    keys = db.get_autopilot_keys(username)
    if not keys or not keys.get("connected"):
        return {"ok": False, "message": "Connect your Bybit keys first."}
    if not ack_real:
        return {"ok": False, "message": "You must acknowledge the real-money risk."}
    if (typed_confirm or "").strip().upper() != GO_LIVE_PHRASE:
        return {"ok": False, "message": f'Type "{GO_LIVE_PHRASE}" exactly to confirm.'}
    try:
        cap_f = float(cap)
    except (TypeError, ValueError):
        return {"ok": False, "message": "A starting-capital cap is required."}
    if cap_f < LIVE_CAP_MIN_USD or cap_f > LIVE_CAP_MAX_USD:
        return {"ok": False, "message": f"Cap must be between ${LIVE_CAP_MIN_USD:.0f} and ${LIVE_CAP_MAX_USD:.0f} for the first live run."}
    db.set_autopilot_mode(username, pilot_id, "live", live_cap=cap_f)
    db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="go_live",
                                detail={"cap": cap_f, "environment": keys.get("environment"),
                                        "masterGate": live_master_enabled()})
    return {"ok": True, "message": "Pilot set to LIVE.", "masterGate": live_master_enabled()}


def stop_live(username: str, pilot_id: str) -> dict:
    """KILL-SWITCH — instantly flip a pilot back to simulation so NO new live order is
    placed. Existing open positions are NOT auto-liquidated here (that would itself be a
    real order); the owner closes them from the exchange or via a separate explicit action."""
    armed = db.get_autopilot_armed(username, pilot_id)
    if not armed:
        return {"ok": False, "message": "That pilot is not loaded."}
    db.set_autopilot_mode(username, pilot_id, "simulation")
    db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="stop_live",
                                detail={"reason": "owner kill-switch"})
    return {"ok": True, "message": "LIVE stopped. Pilot is back in simulation."}


# ── Eligibility + budget ─────────────────────────────────────────────────────────────────

def live_eligible(username: str, armed: dict) -> tuple[bool, str]:
    """ALL gates that must hold before ANY real order for this pilot."""
    # Compliance freeze (owner-approved 2026-07-18): a restricted CLIENT's
    # autopilot is frozen by default (the highest regulatory-exposure path).
    # Owners are exempt. This is checked FIRST, ahead of the master gate.
    from app.core.compliance import client_autopilot_frozen
    if client_autopilot_frozen(username):
        return False, "client autopilot frozen (compliance)"
    if not live_master_enabled():
        return False, "master gate OFF (AUTOPILOT_LIVE_ENABLED not set)"
    if (armed.get("mode") or "simulation") != "live":
        return False, "pilot not in live mode"
    row = db.get_autopilot_keys(username)
    if not row or not row.get("connected"):
        return False, "no Bybit keys connected"
    if (row.get("exchange") or "bybit") not in ALLOWED_EXCHANGES:
        return False, "unsupported exchange"
    return True, "ok"


def _live_positions(username: str, pilot_id: str, status: Optional[str] = None) -> list[dict]:
    """Open/closed positions for this pilot that were opened LIVE (mode='live')."""
    rows = db.list_autopilot_positions(username, pilot_id, status=status)
    return [p for p in rows if (p.get("mode") or "simulation") == "live"]


def live_budget_used(username: str, pilot_id: str) -> float:
    """USD notional currently deployed across the pilot's OPEN live positions (entry basis)."""
    return sum(float(p.get("entry_price") or 0) * float(p.get("qty") or 0)
               for p in _live_positions(username, pilot_id, status="open"))


# ── Pilot-aware live selection — scan source + SPOT-LONG entry/exit predicates ──────────
# DR-Crypto is live-capable exactly like the tier pilots (spot · long-only), but trades on ITS
# OWN scan (daily_scan_dr_crypto) with the Donchian/Chandelier signals. The tier pilots use the
# crypto daily scan + Gaussian-tier signals. Everything else in the executor (gate, keys, cap,
# budget, min-notional, approval, audit, spot-long-only) is identical and unchanged.

def _is_dr_pilot(pilot_id: str) -> bool:
    try:
        from app.services import dr_strategies as dr
        return pilot_id in dr.DR_PILOTS
    except Exception:  # noqa: BLE001
        return False


def _live_scan(pilot_id: str, passed_scan: dict) -> dict:
    """DR-Crypto trades on its OWN daily scan; the tier pilots use the passed crypto daily scan."""
    if _is_dr_pilot(pilot_id):
        return db.get_daily_scan_dr_crypto() or {}
    return passed_scan or {}


def _live_entry_ok(pilot_id: str, s: dict) -> bool:
    """SPOT-LONG entry: DR = Donchian breakout above the 200-SMA (scan `entry` flag); tier pilots =
    fresh Gaussian breakout, long + stillGreen. (No shorts — long-only spot in every case.)"""
    if _is_dr_pilot(pilot_id):
        return bool(s.get("entry"))
    from app.services.autopilot_sim import LONG_ENTRY_TIERS
    return bool(s.get("tier") in LONG_ENTRY_TIERS and s.get("direction") == "long" and s.get("stillGreen"))


def _live_should_exit(pilot_id: str, sig: "Optional[dict]") -> bool:
    """Exit a HELD long: DR = rolling-Chandelier / 200-SMA break (dr.snapshot_exit); tier pilots =
    exit tier or lost the green zone. Only on a fresh signal (sig present)."""
    if sig is None:
        return False
    if _is_dr_pilot(pilot_id):
        from app.services import dr_strategies as dr
        px = sig.get("currentPrice")
        done, _reason = dr.snapshot_exit(float(px) if px else None, sig)
        return bool(done)
    from app.services.autopilot_sim import LONG_EXIT_TIERS
    return bool((sig.get("tier") in LONG_EXIT_TIERS) or (not sig.get("stillGreen")))


# ── The executor — places REAL orders (only when every gate passes) ─────────────────────

def apply_pilot_live(username: str, armed: dict, scan: dict, approved_keys: "Optional[set]" = None) -> dict:
    """Run ONE real-money pass for a live pilot. Closes live positions on exit signals and
    opens new SPOT-LONG positions on fresh breakouts, capped by live_cap + budget +
    min-notional. Every step is audited. Returns a summary. Safe no-op when not eligible.

    APPROVAL GATE: ``approved_keys`` = None → execute EVERY proposed action (the daily
    auto-batch, unchanged). Otherwise ONLY the approved 'exit:<sym>'/'enter:<sym>' items
    place an order — an exit the owner did NOT approve leaves the position OPEN, and an
    unapproved entry is skipped. This is what makes the manual "Run now" a review-then-
    approve gate: nothing hits Bybit until the owner ticks it. EVERY other safeguard
    (master gate, mode=live, keys, cap, budget, min-notional, max positions, long-only
    spot) is UNCHANGED and still re-checked per action below."""
    pilot_id = armed["pilot_id"]
    approve_all = approved_keys is None
    ok, reason = live_eligible(username, armed)
    if not ok:
        db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_skipped",
                                    detail={"reason": reason})
        return {"pilotId": pilot_id, "live": False, "reason": reason, "opened": 0, "closed": 0,
                "placed": 0, "skippedCount": 0, "skips": []}

    from app.services.autopilot_sim import _meta

    keys_row = db.get_autopilot_keys(username)
    cfg = _cfg_from_keys(keys_row)
    meta = _meta(pilot_id)
    max_positions = int(meta.get("maxPositions", 8))
    cap = float(armed.get("live_cap") or 0.0)
    pct = float(armed.get("per_trade_pct") or 0.0)

    # DR-Crypto trades its OWN scan; tier pilots use the passed crypto daily scan.
    scan = _live_scan(pilot_id, scan)
    signals = (scan or {}).get("signals") or []
    sig_by_symbol = {s.get("symbol"): s for s in signals if s.get("symbol")}

    opened = 0
    closed = 0
    # Per-order outcomes for HONEST UI feedback (display-only — this list changes nothing
    # about execution). Each skipped/failed entry records why, so the panel can say
    # "0 placed — no free USDT" instead of closing silently.
    skips: list[dict] = []

    # 1) EXIT — close open LIVE positions whose symbol now flags an exit (real spot SELL).
    held: set[str] = set()
    for pos in _live_positions(username, pilot_id, status="open"):
        sym = pos["symbol"]
        sig = sig_by_symbol.get(sym)
        should_close = _live_should_exit(pilot_id, sig)
        # Approval gate: an exit signal the owner did NOT approve leaves the position OPEN.
        if not should_close or not (approve_all or f"exit:{sym}" in approved_keys):
            held.add(sym)
            continue
        db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_attempt",
                                    detail={"side": "sell", "symbol": sym, "reason": "exit signal"})
        try:
            # Sell 100% of this holding back to the quote (real order via the owner's keys).
            res = ex.place_order(cfg, sym, "sell", pct=100.0, order_type="market", market_type="spot")
        except Exception as exc:  # never let one order break the pass
            db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_failed",
                                        detail={"side": "sell", "symbol": sym, "error": str(exc)[:200]})
            held.add(sym)  # still held — couldn't close
            continue
        if not res.get("ok"):
            db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_failed",
                                        detail={"side": "sell", "symbol": sym, "error": (res.get("message") or "")[:200]})
            held.add(sym)
            continue
        order = res.get("order") or {}
        exit_px = float(order.get("price") or order.get("average") or pos.get("last_price") or pos.get("entry_price") or 0)
        entry = float(pos["entry_price"]); qty = float(pos["qty"])
        realized = (exit_px - entry) * qty
        db.close_autopilot_position(pos["id"], exit_px, realized)
        db.log_autopilot_activity(username=username, pilot_id=pilot_id, kind="close", symbol=sym,
                                  side="long", price=exit_px, qty=qty, pnl=realized, note="live exit")
        db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_placed",
                                    detail={"side": "sell", "symbol": sym, "price": exit_px, "qty": qty,
                                            "orderId": order.get("id"), "realizedPnl": round(realized, 2)})
        closed += 1

    open_count = len(held)

    # 2) ENTER — open new SPOT-LONG positions on fresh breakouts, capped by budget + min-notional.
    remaining = max(0.0, cap - live_budget_used(username, pilot_id))
    per_trade_usd = min(cap * pct / 100.0, remaining) if (cap > 0 and pct > 0) else 0.0
    for s in signals:
        if open_count >= max_positions:
            break
        if per_trade_usd < LIVE_CAP_MIN_USD or remaining < LIVE_CAP_MIN_USD:
            db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_skipped",
                                        detail={"reason": "live budget exhausted", "remaining": round(remaining, 2)})
            skips.append({"symbol": None, "reason": "cap budget exhausted"})
            break
        sym = s.get("symbol"); price = s.get("currentPrice")
        if not sym or sym in held or not price or float(price) <= 0:
            continue
        # LONG-ONLY spot, fresh breakout only (pilot-aware). Shorts are NEVER taken live.
        if not _live_entry_ok(pilot_id, s):
            continue
        # Approval gate: only place a real BUY for an entry the owner ticked (or the
        # auto-batch, approve_all). Unapproved proposals are simply not bought.
        if not (approve_all or f"enter:{sym}" in approved_keys):
            continue
        spend = min(per_trade_usd, remaining)
        db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_attempt",
                                    detail={"side": "buy", "symbol": sym, "spendUsd": round(spend, 2)})
        try:
            # Spend an exact USD amount; place_order enforces free-balance + min-notional.
            res = ex.place_order(cfg, sym, "buy", pct=0.0, order_type="market",
                                 market_type="spot", quote_amount=spend)
        except Exception as exc:
            db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_failed",
                                        detail={"side": "buy", "symbol": sym, "error": str(exc)[:200]})
            skips.append({"symbol": sym, "reason": str(exc)[:140]})
            continue
        if not res.get("ok"):
            # e.g. below min-notional / no free USDT — SKIPPED, not silent.
            db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_skipped",
                                        detail={"side": "buy", "symbol": sym, "reason": (res.get("message") or "")[:200]})
            skips.append({"symbol": sym, "reason": (res.get("message") or "order not accepted")[:140]})
            continue
        order = res.get("order") or {}
        fill_px = float(order.get("price") or order.get("average") or price)
        filled_qty = float(order.get("filled") or order.get("amount") or (spend / fill_px if fill_px else 0))
        if fill_px <= 0 or filled_qty <= 0:
            db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_failed",
                                        detail={"side": "buy", "symbol": sym, "error": "empty fill"})
            skips.append({"symbol": sym, "reason": "empty fill from exchange"})
            continue
        db.open_autopilot_position(username=username, pilot_id=pilot_id, symbol=sym, side="long",
                                   entry_price=fill_px, qty=filled_qty, mode="live",
                                   order_id=str(order.get("id") or ""))
        db.log_autopilot_activity(username=username, pilot_id=pilot_id, kind="open", symbol=sym,
                                  side="long", price=fill_px, qty=filled_qty, note="live entry")
        db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="order_placed",
                                    detail={"side": "buy", "symbol": sym, "price": fill_px, "qty": filled_qty,
                                            "orderId": order.get("id"), "spendUsd": round(fill_px * filled_qty, 2)})
        held.add(sym)
        open_count += 1
        opened += 1
        notional = fill_px * filled_qty
        remaining = max(0.0, remaining - notional)
        per_trade_usd = min(per_trade_usd, remaining)

    # Stamp run times (reuse the sim scheduler for the next-run time).
    from app.services.autopilot_sim import _next_run_iso
    db.set_autopilot_run_stamps(username, pilot_id, db.now_iso(), _next_run_iso())
    db.log_autopilot_live_audit(username=username, pilot_id=pilot_id, action="mark",
                                detail={"opened": opened, "closed": closed, "openCount": open_count,
                                        "budgetUsed": round(live_budget_used(username, pilot_id), 2), "cap": cap})
    return {"pilotId": pilot_id, "live": True, "opened": opened, "closed": closed, "open": open_count,
            "placed": opened + closed, "skippedCount": len(skips), "skips": skips[:12]}


def run_pilot_live(username: str, armed: dict, scan: dict) -> dict:
    """Daily auto-batch / legacy path: apply EVERY proposed live action (no per-item
    approval). Every real-money gate is still enforced inside apply_pilot_live."""
    return apply_pilot_live(username, armed, scan, approved_keys=None)


def plan_pilot_live(username: str, armed: dict, scan: dict) -> dict:
    """READ-ONLY: the reviewable real-money plan — eligibility + budget + the SPOT-LONG
    exits/entries this pass WOULD place, with NO order and NO write. Mirrors the executor's
    selection logic exactly (long-only, budget/min-notional/cap/max-positions bounded) so
    the review panel shows precisely what Approve would attempt. When the pilot is not
    live-eligible (master gate off, no keys, not in live mode) `eligible` is False and the
    panel says so — but the proposed entries/exits are still shown for transparency."""
    pilot_id = armed["pilot_id"]
    ok, reason = live_eligible(username, armed)
    from app.services.autopilot_sim import _meta

    meta = _meta(pilot_id)
    max_positions = int(meta.get("maxPositions", 8))
    cap = float(armed.get("live_cap") or 0.0)
    pct = float(armed.get("per_trade_pct") or 0.0)

    scan = _live_scan(pilot_id, scan)   # DR-Crypto trades its own scan; tier pilots use the crypto daily scan
    signals = (scan or {}).get("signals") or []
    sig_by_symbol = {s.get("symbol"): s for s in signals if s.get("symbol")}

    budget_used = live_budget_used(username, pilot_id)
    remaining = max(0.0, cap - budget_used)
    per_trade_usd = min(cap * pct / 100.0, remaining) if (cap > 0 and pct > 0) else 0.0

    # Proposed EXITS — open live positions whose signal now flags an exit (real spot SELL).
    exits: list[dict] = []
    held: set[str] = set()
    for pos in _live_positions(username, pilot_id, status="open"):
        sym = pos["symbol"]
        sig = sig_by_symbol.get(sym)
        should_close = _live_should_exit(pilot_id, sig)
        if should_close:
            entry = float(pos["entry_price"]); qty = float(pos["qty"])
            last = float((sig or {}).get("currentPrice") or pos.get("last_price") or entry)
            exits.append({"key": f"exit:{sym}", "action": "exit", "positionId": pos["id"],
                          "symbol": sym, "side": "long", "entryPrice": entry, "price": last,
                          "qty": qty, "estPnl": round((last - entry) * qty, 2),
                          "reason": "exit signal (spot SELL)"})
        else:
            held.add(sym)
    open_count = len(held)

    # Proposed ENTRIES — fresh SPOT-LONG breakouts, tentatively reserved against the budget
    # so the plan never proposes more than the cap/min-notional would allow.
    entries: list[dict] = []
    rem = remaining
    ptu = per_trade_usd
    for s in signals:
        if open_count + len(entries) >= max_positions:
            break
        if ptu < LIVE_CAP_MIN_USD or rem < LIVE_CAP_MIN_USD:
            break
        sym = s.get("symbol"); price = s.get("currentPrice")
        if not sym or sym in held or not price or float(price) <= 0:
            continue
        if not _live_entry_ok(pilot_id, s):    # pilot-aware SPOT-LONG entry (DR = Donchian breakout)
            continue
        spend = min(ptu, rem)
        entries.append({"key": f"enter:{sym}", "action": "enter", "symbol": sym, "side": "long",
                        "price": float(price), "qty": (spend / float(price)) if price else 0.0,
                        "spendUsd": round(spend, 2), "tier": s.get("tier"),
                        "reason": "entry signal (spot BUY)"})
        rem = max(0.0, rem - spend)
        ptu = min(ptu, rem)

    # REAL Bybit free USDT (READ-ONLY balance read — places nothing). Surfaced next to the
    # internal cap so the owner sees the TRUE spendable amount before approving: the app's
    # "budget free" is the cap, but a spot BUY needs actual free USDT on the exchange.
    free_usdt = None
    try:
        krow = db.get_autopilot_keys(username)
        if krow and krow.get("connected"):
            fq = ex.get_free_quote(_cfg_from_keys(krow), "USDT")
            if fq.get("ok"):
                free_usdt = round(float(fq.get("free") or 0), 2)
    except Exception as exc:  # never let a balance read break the plan
        logger.warning("autopilot plan free-USDT read failed user=%s: %s", username, exc)

    return {
        "pilotId": pilot_id, "mode": "live", "eligible": ok, "reason": reason,
        "assetsEvaluated": len(signals), "exits": exits, "entries": entries,
        "cap": round(cap, 2), "budgetUsed": round(budget_used, 2), "remaining": round(remaining, 2),
        "perTradeUsd": round(per_trade_usd, 2), "minNotionalUsd": LIVE_CAP_MIN_USD,
        "freeUsdt": free_usdt,
        "masterGate": live_master_enabled(),
    }
