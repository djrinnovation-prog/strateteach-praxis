"""DR Crypto trend paper-sim engine (Phase 2c). ⚠️ SIMULATION ONLY — no orders, no capital.

The DR-Crypto trend pilot runs here, NOT through the crypto tier engine in autopilot_sim. It reads
ONLY the dedicated ``daily_scan_dr_crypto`` singleton (never the live crypto scan or the MR scan),
applies the Donchian+200-SMA+rolling-Chandelier rules from ``dr_strategies`` (the same code the
validation harness measured), and NETS FEES into the P&L.

MONEY-SAFETY: places no orders, never imports autopilot_live. autopilot_sim routes DR pilots here
BEFORE any live-mode check, so a DR pilot can never reach a real order path.

Shapes mirror mr_sim / autopilot_sim so the review diff is obvious; the only substantive differences
are the scan source and the trend entry/exit rules.
"""
from __future__ import annotations

import logging
from typing import Optional

from app import database as db
from app.services import dr_strategies as dr

logger = logging.getLogger(__name__)

FEE_SIDE = 0.001   # 0.1%/side = 0.2% round-trip, netted into every DR trade's P&L


def is_dr_pilot(pilot_id: "Optional[str]") -> bool:
    return bool(pilot_id) and pilot_id in dr.DR_PILOTS


def round_trip_fee(entry_price: float, exit_price: float, qty: float) -> float:
    return FEE_SIDE * float(entry_price) * float(qty) + FEE_SIDE * float(exit_price) * float(qty)


def compute_dr_plan(username: str, armed: dict) -> dict:
    """READ-ONLY plan for a DR pilot against the CURRENT crypto-trend scan snapshot. Exits = held
    positions whose trailing/regime exit fired; entries = fresh Donchian breakouts above the 200-SMA
    up to the position cap. estPnl is NET of the round-trip fee. Writes nothing."""
    pilot_id = armed["pilot_id"]
    meta = dr.DR_PILOTS.get(pilot_id, {})
    max_positions = int(meta.get("maxPositions", 8))
    nav = float(armed.get("nav") or 0.0)
    # Operational RISK MODE (aggressive / smooth / safe) — sets HOW this pilot sizes/risk-manages.
    # Paper-sim only; identical entry/exit signals across modes (modes differ in sizing/risk).
    mode = db.get_dr_mode(username)
    cfg = dr.mode_config(mode)

    scan = db.get_daily_scan_dr_crypto()
    signals = (scan or {}).get("signals") or []
    sig_by_symbol = {s.get("symbol"): s for s in signals if s.get("symbol")}

    exits: list[dict] = []
    held: set[str] = set()
    open_positions = db.list_autopilot_positions(username, pilot_id, status="open")
    for pos in open_positions:
        sym = pos["symbol"]; entry = float(pos["entry_price"]); qty = float(pos["qty"])
        sig = sig_by_symbol.get(sym)
        last = float(sig["currentPrice"]) if (sig and sig.get("currentPrice")) else float(pos.get("last_price") or entry)
        should_close, reason = dr.snapshot_exit(last, sig)
        if should_close and sig is not None:   # only act on a fresh signal for this symbol
            gross = (last - entry) * qty
            net = gross - round_trip_fee(entry, last, qty)
            exits.append({"key": f"exit:{sym}", "action": "exit", "positionId": pos["id"],
                          "symbol": sym, "side": "long", "entryPrice": entry, "price": last,
                          "qty": qty, "estPnl": round(net, 2), "reason": f"DR exit · {reason}"})
        else:
            held.add(sym)

    # ── Mode-based COMPOUNDING sizing (paper-sim) ──────────────────────────────────────────
    # equity = capital + realized + unrealized (compounds); size each new position from CURRENT
    # equity × per_frac, with optional vol-targeting, drawdown-guard (RESIZE), and exposure cap.
    all_positions = db.list_autopilot_positions(username, pilot_id)
    realized = sum(float(p.get("realized_pnl") or 0.0) for p in all_positions if p.get("status") == "closed")
    unreal = sum(float(p.get("unrealized_pnl") or 0.0) for p in open_positions)
    equity = max(1.0, nav + realized + unreal)
    curve = armed.get("equity_curve") or []
    peak = max([equity] + [float(pt.get("v") or 0.0) for pt in curve]) if curve else equity
    ddown = (equity / peak - 1.0) if peak > 0 else 0.0
    risk_mult = 0.5 if (cfg["dd_guard"] is not None and ddown < -float(cfg["dd_guard"])) else 1.0
    # capital deployed in the positions we're KEEPING (exits free their capital for new entries)
    deployed = sum(float(p.get("last_price") or p["entry_price"]) * float(p["qty"])
                   for p in open_positions if p["symbol"] in held)

    open_count = len(held)
    entries: list[dict] = []
    for s in signals:
        if open_count + len(entries) >= max_positions:
            break
        sym = s.get("symbol"); price = s.get("currentPrice")
        if not sym or sym in held or not price or float(price) <= 0:
            continue
        if not s.get("entry"):     # canonical Donchian-breakout entry flag from the DR scan
            continue
        base = cfg["per_frac"] * equity * risk_mult
        if cfg["vol_tgt"]:
            apct = float(s.get("atrPct") or 0.05) or 0.05
            base *= min(1.5, max(0.3, dr.TARGET_VOL / apct))     # constant-risk vol-targeting
        avail = cfg["expo_cap"] * equity - deployed              # exposure cap
        spend = min(base, avail, equity - deployed)              # bounded by free capital
        if spend < 1.0:
            continue
        entries.append({"key": f"enter:{sym}", "action": "enter", "symbol": sym, "side": "long",
                        "price": float(price), "qty": spend / float(price),
                        "spendUsd": round(spend, 2), "tier": f"DR·{mode}", "reason": "DR entry signal"})
        deployed += spend
    return {"pilotId": pilot_id, "mode": "simulation", "riskMode": mode, "eligible": True, "reason": "ok",
            "strategy": "dr_trend", "assetsEvaluated": len(signals), "exits": exits, "entries": entries}


def apply_dr_plan(username: str, armed: dict, approved_keys: "Optional[set]" = None) -> dict:
    """Apply a DR pass. ``approved_keys=None`` → apply everything (daily batch). Realized and
    unrealized P&L are NET of the round-trip fee. NO orders — sim tables only."""
    pilot_id = armed["pilot_id"]
    nav = float(armed.get("nav") or 0.0)
    plan = compute_dr_plan(username, armed)
    approve_all = approved_keys is None
    exit_syms = {e["symbol"]: e for e in plan["exits"]}
    scan = db.get_daily_scan_dr_crypto()
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
                                      note="DR sim exit (net of fees)")
            closed += 1
        else:
            sig = sig_by_symbol.get(sym)
            last = float(sig["currentPrice"]) if (sig and sig.get("currentPrice")) else float(pos.get("last_price") or entry)
            unrl = (last - entry) * qty - round_trip_fee(entry, last, qty)       # NET of fees
            db.mark_autopilot_position(pos["id"], last, unrl)

    max_positions = int(dr.DR_PILOTS.get(pilot_id, {}).get("maxPositions", 8))
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
                                  qty=float(e["qty"]), note="DR sim entry")
        open_count += 1
        opened += 1

    db.set_autopilot_run_stamps(username, pilot_id, db.now_iso(), _next_run_iso())
    _append_equity_point(username, pilot_id, nav)
    return {"pilotId": pilot_id, "opened": opened, "closed": closed, "open": open_count,
            "placed": opened + closed, "skippedCount": 0, "skips": []}


def _next_run_iso() -> str:
    from app.services.autopilot_sim import _next_run_iso as f
    return f()


def _append_equity_point(username: str, pilot_id: str, nav: float) -> None:
    from app.services.autopilot_sim import _append_equity_point as f
    f(username, pilot_id, nav)
