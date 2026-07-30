"""Mean-Reversion paper-sim engine (Phase 2b). ⚠️ SIMULATION ONLY — no orders, no capital.

The Bollinger mean-reversion stocks pilot runs here, NOT through the crypto tier engine in
autopilot_sim._compute_sim_plan. It reads ONLY the dedicated ``daily_scan_stocks_mr`` singleton
(never the live crypto scan), applies the canonical Bollinger(20,2)+200-SMA rules from
``mr_strategies`` (the same code the CP3 paper-sim validated), and NETS FEES into the P&L.

MONEY-SAFETY: this module places no orders and never imports autopilot_live. autopilot_sim
routes MR pilots here BEFORE any live-mode check, so an MR pilot can never reach a real order
path — even if a 'live' mode were ever set on it, it stays paper here.

Shapes mirror autopilot_sim._compute_sim_plan / _apply_sim_plan so the review diff is obvious;
the only substantive differences are (1) the MR scan source, (2) the mean-reversion entry/exit
rules, and (3) fees netted into realized + unrealized P&L.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from app import database as db
from app.services import mr_strategies as mr

logger = logging.getLogger(__name__)

# 0.1%/side = 0.2% round-trip, netted into every MR trade's P&L (consistent with the
# app-wide net-of-fees work and the CP3 paper-sim numbers). Slippage is NOT modeled in the
# forward sim (honestly labeled in the UI) — the CP3 replay measured it separately.
FEE_SIDE = 0.001


def is_mr_pilot(pilot_id: "Optional[str]") -> bool:
    return bool(pilot_id) and pilot_id in mr.MR_PILOTS


def _strategy_key(pilot_id: str) -> str:
    return mr.MR_PILOTS.get(pilot_id, {}).get("strategy", "bb")


def round_trip_fee(entry_price: float, exit_price: float, qty: float) -> float:
    """Round-trip commission on a position (entry side + exit side), in account currency."""
    return FEE_SIDE * float(entry_price) * float(qty) + FEE_SIDE * float(exit_price) * float(qty)


def _held_bars(opened_at: "Optional[str]") -> int:
    """Approximate daily bars held = US business days since the position opened (the paper
    sim runs once per trading day). Used only for the canonical 10-bar time-stop."""
    if not opened_at:
        return 0
    try:
        d0 = datetime.fromisoformat(str(opened_at).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        return 0
    today = datetime.now(timezone.utc).date()
    if today <= d0:
        return 0
    return int(np.busday_count(d0, today))


def compute_mr_plan(username: str, armed: dict) -> dict:
    """READ-ONLY plan for an MR pilot against the CURRENT stocks-MR scan snapshot. Exits =
    held positions whose canonical mean-reversion exit fired (target back to the band mid, or
    the 10-bar time-stop); entries = fresh qualifying signals up to the position cap. estPnl
    is NET of the round-trip fee. Writes nothing."""
    pilot_id = armed["pilot_id"]
    meta = mr.MR_PILOTS.get(pilot_id, {})
    skey = _strategy_key(pilot_id)
    max_positions = int(meta.get("maxPositions", 8))
    nav = float(armed.get("nav") or 0.0)
    pct = float(armed.get("per_trade_pct") or 0.0)
    per_trade_usd = nav * pct / 100.0

    scan = db.get_daily_scan_stocks_mr()
    signals = (scan or {}).get("signals") or []
    sig_by_symbol = {s.get("symbol"): s for s in signals if s.get("symbol")}

    exits: list[dict] = []
    held: set[str] = set()
    for pos in db.list_autopilot_positions(username, pilot_id, status="open"):
        sym = pos["symbol"]; entry = float(pos["entry_price"]); qty = float(pos["qty"])
        sig = sig_by_symbol.get(sym)
        last = float(sig["currentPrice"]) if (sig and sig.get("currentPrice")) else float(pos.get("last_price") or entry)
        should_close, reason = mr.snapshot_exit(skey, last, sig, _held_bars(pos.get("opened_at")))
        # Only act on a symbol we actually have a fresh signal for (or a hard time-stop).
        if should_close and (sig is not None or reason == "time"):
            gross = (last - entry) * qty
            net = gross - round_trip_fee(entry, last, qty)
            exits.append({"key": f"exit:{sym}", "action": "exit", "positionId": pos["id"],
                          "symbol": sym, "side": "long", "entryPrice": entry, "price": last,
                          "qty": qty, "estPnl": round(net, 2), "reason": f"MR exit · {reason}"})
        else:
            held.add(sym)

    open_count = len(held)
    entries: list[dict] = []
    if per_trade_usd > 0:
        for s in signals:
            if open_count + len(entries) >= max_positions:
                break
            sym = s.get("symbol"); price = s.get("currentPrice")
            if not sym or sym in held or not price or float(price) <= 0:
                continue
            if not (s.get("entry") or {}).get(skey):     # canonical entry flag from the MR scan
                continue
            entries.append({"key": f"enter:{sym}", "action": "enter", "symbol": sym, "side": "long",
                            "price": float(price), "qty": per_trade_usd / float(price),
                            "spendUsd": round(per_trade_usd, 2), "tier": f"MR·{skey}", "reason": "MR entry signal"})
    return {"pilotId": pilot_id, "mode": "simulation", "eligible": True, "reason": "ok",
            "strategy": skey, "assetsEvaluated": len(signals), "exits": exits, "entries": entries}


def apply_mr_plan(username: str, armed: dict, approved_keys: "Optional[set]" = None) -> dict:
    """Apply an MR pass. ``approved_keys=None`` → apply everything (daily batch). Realized and
    unrealized P&L are NET of the round-trip fee. NO orders — sim tables only."""
    pilot_id = armed["pilot_id"]
    nav = float(armed.get("nav") or 0.0)
    plan = compute_mr_plan(username, armed)
    approve_all = approved_keys is None
    exit_syms = {e["symbol"]: e for e in plan["exits"]}
    scan = db.get_daily_scan_stocks_mr()
    sig_by_symbol = {s.get("symbol"): s for s in ((scan or {}).get("signals") or []) if s.get("symbol")}

    opened = closed = 0
    for pos in db.list_autopilot_positions(username, pilot_id, status="open"):
        sym = pos["symbol"]; entry = float(pos["entry_price"]); qty = float(pos["qty"])
        ex_item = exit_syms.get(sym)
        do_close = ex_item is not None and (approve_all or ex_item["key"] in approved_keys)
        if do_close:
            last = float(ex_item["price"])
            realized = (last - entry) * qty - round_trip_fee(entry, last, qty)   # NET of fees
            db.close_autopilot_position(pos["id"], last, realized)
            db.log_autopilot_activity(username=username, pilot_id=pilot_id, kind="close",
                                      symbol=sym, side="long", price=last, qty=qty, pnl=realized,
                                      note="MR sim exit (net of fees)")
            closed += 1
        else:
            sig = sig_by_symbol.get(sym)
            last = float(sig["currentPrice"]) if (sig and sig.get("currentPrice")) else float(pos.get("last_price") or entry)
            unrl = (last - entry) * qty - round_trip_fee(entry, last, qty)       # NET of fees
            db.mark_autopilot_position(pos["id"], last, unrl)

    max_positions = int(mr.MR_PILOTS.get(pilot_id, {}).get("maxPositions", 8))
    open_count = len(db.list_autopilot_positions(username, pilot_id, status="open"))
    for e in plan["entries"]:
        if open_count >= max_positions:
            break
        if not (approve_all or e["key"] in approved_keys):
            continue
        db.open_autopilot_position(username=username, pilot_id=pilot_id, symbol=e["symbol"],
                                   side="long", entry_price=float(e["price"]), qty=float(e["qty"]))
        db.log_autopilot_activity(username=username, pilot_id=pilot_id, kind="open",
                                  symbol=e["symbol"], side="long", price=float(e["price"]),
                                  qty=float(e["qty"]), note="MR sim entry")
        open_count += 1
        opened += 1

    db.set_autopilot_run_stamps(username, pilot_id, db.now_iso(), _next_run_iso())
    _append_equity_point(username, pilot_id, nav)
    return {"pilotId": pilot_id, "opened": opened, "closed": closed, "open": open_count,
            "placed": opened + closed, "skippedCount": 0, "skips": []}


# Reuse the shared run-stamp + equity helpers from autopilot_sim (imported lazily to avoid a
# module cycle) so the MR pilot's status payload assembles identically to the other pilots.
def _next_run_iso() -> str:
    from app.services.autopilot_sim import _next_run_iso as f
    return f()


def _append_equity_point(username: str, pilot_id: str, nav: float) -> None:
    from app.services.autopilot_sim import _append_equity_point as f
    f(username, pilot_id, nav)
