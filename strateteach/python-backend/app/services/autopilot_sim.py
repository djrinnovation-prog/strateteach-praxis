"""AutoPilots — DRY-RUN / SIMULATION engine (owners-only feature).

STRICT MONEY-SAFETY: this module NEVER places an order and NEVER moves money. It has
no exchange-order calls of any kind. For each ARMED pilot it reads the app's LIVE daily
Trend Radar scan (``db.get_daily_scan()``) and computes the entries/exits the strategy
WOULD take, recording them as SIMULATED activity + positions + P&L in the
``autopilot_*`` tables. Everything here is a paper/dry-run approximation.

HONEST LOAD BEHAVIOUR: loading a pilot starts it FLAT — 0 positions, 0 P&L, equity = the
defined capital. At the load moment nothing is bought yet, so there is NO fabricated
pre-load history/profit (the old defined-capital "backfill" is removed). Positions open
only on the NEXT run after load (the daily scan or a manual run-now), and P&L accrues
only from those real (simulated) buys, marked to REAL live prices.

APPROXIMATION NOTE (surfaced to the user as "סימולציה · קירוב על הנתונים הזמינים"):
the exact B2S / top-100 strategies aren't built in this app yet, so we run the closest
available approximation — the Gaussian-channel (GC) breakout tiers from the daily
scanner — for every pilot. Long-short pilots may also open simulated shorts; long-only
pilots take longs only. Sizing uses the armed NAV × per-trade %.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app import database as db

logger = logging.getLogger(__name__)

# Per-pilot metadata used when the daily loop runs without a client. `direction` is also
# stored on the armed row (client sends it); this is the authoritative fallback.
PILOT_META: dict[str, dict[str, Any]] = {
    "TR-GC-Crypto-LS-9":      {"direction": "long-short", "market": "crypto", "maxPositions": 8},
    "TR-B2S-Crypto-17":       {"direction": "long-only",  "market": "crypto", "maxPositions": 8},
    "TR-B2S-Crypto-LS-13":    {"direction": "long-short", "market": "crypto", "maxPositions": 8},
    "TR-B2S-Crypto-LowDD-12": {"direction": "long-only",  "market": "crypto", "maxPositions": 5},
    # id retains the legacy "Stocks" token, but this pilot has always traded CRYPTO (Keltner
    # on the Curated-9 crypto scan) — `market` corrected stocks→crypto so the stored value is
    # truthful. Label-only: `market` is NOT gated on in the sim OR live engines today, so this
    # changes no behavior and no money path; it also keeps behavior correct if a market-gate is
    # ever merged. The real stocks pilot is MR-BB-Stocks below.
    "TR-B2S-Stocks-14":       {"direction": "long-only",  "market": "crypto", "maxPositions": 6},
    # Phase 2b · NEW mean-reversion pilot — SIMULATION ONLY. Provenance-clean published TA
    # (Bollinger(20,2)+200-SMA). Runs through mr_sim.py on the SEPARATE daily_scan_stocks_mr
    # feed, never the crypto tier engine or any live order path. `mr`/`simOnly` are markers
    # the dispatch uses to route it to the paper-sim engine.
    "MR-BB-Stocks":           {"direction": "long-only",  "market": "stocks", "maxPositions": 8,
                               "mr": True, "strategy": "bb", "simOnly": True},
    # Phase 2c · NEW crypto trend pilot ("DR Crypto") — SIMULATION ONLY. Provenance-clean
    # published TA (Donchian(20)+200-SMA+rolling Chandelier(22,3)). Runs through dr_sim.py on the
    # SEPARATE daily_scan_dr_crypto feed, never the crypto tier engine or any live order path.
    "DR-Crypto-Trend":        {"direction": "long-only",  "market": "crypto", "maxPositions": 8,
                               "dr": True, "strategy": "dr_trend", "simOnly": True},
}


def _is_mr(pilot_id: "Optional[str]") -> bool:
    """True for the Phase-2b mean-reversion pilot(s) — routed to the paper-sim mr_sim engine."""
    return bool(PILOT_META.get(pilot_id, {}).get("mr"))


def _is_dr(pilot_id: "Optional[str]") -> bool:
    """True for the Phase-2c DR crypto trend pilot(s) — routed to the paper-sim dr_sim engine."""
    return bool(PILOT_META.get(pilot_id, {}).get("dr"))

# GC breakout-tier taxonomy from the daily scanner (app/services/signals.py).
# Long entries: a FRESH breakout ("breaking_out") OR an established STRONG UPTREND
# ("in_uptrend", price at/above the upper Gaussian band). Both must still be long +
# stillGreen at the entry check. "in_uptrend" was added per Dan so a loaded pilot also
# takes positions on strong-uptrend days when nothing is freshly breaking out — an
# honest tier-set broadening only (no threshold tuning; exit/risk/sizing unchanged).
# "in_uptrend" is intentionally NOT in LONG_EXIT_TIERS and is stillGreen, so a held long
# in a strong uptrend stays open (no open/close thrash). "near_breakout" is kept for
# completeness but in practice never opens — its price sits below the green zone, so its
# stillGreen is False.
LONG_ENTRY_TIERS = {"breaking_out", "near_breakout", "in_uptrend"}
SHORT_ENTRY_TIERS = {"breaking_down", "near_breakdown"}
LONG_EXIT_TIERS = {"breaking_down", "near_breakdown", "in_downtrend", "falling", "downtrend"}
SHORT_EXIT_TIERS = {"breaking_out", "near_breakout", "in_uptrend"}


def initialize_pilot(username: str, armed: dict) -> dict:
    """On LOAD: reset to a FLAT start — 0 positions, 0 realized/unrealized P&L, equity =
    the defined capital. HONEST: at the load moment NOTHING is bought yet, so there is NO
    fabricated pre-load history/profit. Real (simulated) positions open only on the NEXT
    run after load (the daily scan, or a manual run-now)."""
    pilot_id = armed["pilot_id"]
    capital = float(armed.get("nav") or 0.0)
    db.clear_autopilot_sim(username, pilot_id)                 # wipe any prior sim state
    today = datetime.now(timezone.utc).date().isoformat()
    db.set_autopilot_equity(username, pilot_id, [{"d": today, "v": round(capital, 2)}])  # flat
    # last_run_at = None → "waiting for first buy"; next_run_at = next scheduled batch.
    db.set_autopilot_run_stamps(username, pilot_id, None, _next_run_iso())
    return {"pilotId": pilot_id, "open": 0, "trades": 0, "waiting": True}


def _append_equity_point(username: str, pilot_id: str, capital: float) -> None:
    """Append (or replace today's) point on the simulated P&L journey — the curve starts
    FLAT at load (= capital) and grows ONLY from real runs; no fabricated pre-load points."""
    positions = db.list_autopilot_positions(username, pilot_id)
    realized = sum(float(p.get("realized_pnl") or 0.0) for p in positions if p.get("status") == "closed")
    unreal = sum(float(p.get("unrealized_pnl") or 0.0) for p in positions if p.get("status") == "open")
    equity = round(capital + realized + unreal, 2)
    armed = db.get_autopilot_armed(username, pilot_id) or {}
    curve = list(armed.get("equity_curve") or [])
    today = datetime.now(timezone.utc).date().isoformat()
    if curve and curve[-1].get("d") == today:
        curve[-1] = {"d": today, "v": equity}
    else:
        curve.append({"d": today, "v": equity})
    db.set_autopilot_equity(username, pilot_id, curve[-90:])


def _next_run_iso(now: Optional[datetime] = None) -> str:
    """Next daily sim run — 00:10 UTC, just after the 00:05 UTC daily scan."""
    now = now or datetime.now(timezone.utc)
    nxt = now.replace(hour=0, minute=10, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return nxt.isoformat()


def _meta(pilot_id: str) -> dict[str, Any]:
    return PILOT_META.get(pilot_id, {"direction": "long-only", "market": "crypto", "maxPositions": 8})


def _compute_sim_plan(username: str, armed: dict, scan: dict) -> dict:
    """READ-ONLY: compute the exits/entries this sim pass WOULD take against the current
    scan snapshot. Writes NOTHING — this is the reviewable plan that feeds the run-plan
    panel. Exits are the open positions whose signal flipped; entries are fresh qualifying
    breakouts up to the pilot's remaining position cap. Keyed 'exit:<sym>' / 'enter:<sym>'
    so approval can match items exactly."""
    pilot_id = armed["pilot_id"]
    meta = _meta(pilot_id)
    direction = armed.get("direction") or meta["direction"]
    allow_short = direction == "long-short"
    max_positions = int(meta.get("maxPositions", 8))
    nav = float(armed.get("nav") or 0.0)
    pct = float(armed.get("per_trade_pct") or 0.0)
    per_trade_usd = nav * pct / 100.0

    signals = (scan or {}).get("signals") or []
    sig_by_symbol = {s.get("symbol"): s for s in signals if s.get("symbol")}

    exits: list[dict] = []
    held: set[str] = set()
    for pos in db.list_autopilot_positions(username, pilot_id, status="open"):
        sym = pos["symbol"]; side = pos["side"]
        entry = float(pos["entry_price"]); qty = float(pos["qty"])
        sig = sig_by_symbol.get(sym)
        last = float(sig["currentPrice"]) if (sig and sig.get("currentPrice")) else float(pos.get("last_price") or entry)
        tier = (sig or {}).get("tier")
        still_green = bool((sig or {}).get("stillGreen"))
        should_close = False
        if sig is not None:  # only flip on a fresh signal for this symbol
            should_close = (tier in LONG_EXIT_TIERS) or (not still_green) if side == "long" \
                else (tier in SHORT_EXIT_TIERS) or still_green
        if should_close:
            realized = (last - entry) * qty if side == "long" else (entry - last) * qty
            exits.append({"key": f"exit:{sym}", "action": "exit", "positionId": pos["id"],
                          "symbol": sym, "side": side, "entryPrice": entry, "price": last,
                          "qty": qty, "estPnl": round(realized, 2), "reason": "exit signal"})
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
            tier = s.get("tier"); sdir = s.get("direction")
            side = None
            if tier in LONG_ENTRY_TIERS and sdir == "long" and s.get("stillGreen"):
                side = "long"
            elif allow_short and tier in SHORT_ENTRY_TIERS and sdir == "short":
                side = "short"
            if not side:
                continue
            entries.append({"key": f"enter:{sym}", "action": "enter", "symbol": sym, "side": side,
                            "price": float(price), "qty": per_trade_usd / float(price),
                            "spendUsd": round(per_trade_usd, 2), "tier": tier, "reason": "entry signal"})
    return {"pilotId": pilot_id, "mode": "simulation", "eligible": True, "reason": "ok",
            "assetsEvaluated": len(signals), "exits": exits, "entries": entries}


def _apply_sim_plan(username: str, armed: dict, scan: dict, approved_keys: "Optional[set]" = None) -> dict:
    """Apply a sim pass. ``approved_keys`` = None → apply EVERYTHING (the daily auto-batch,
    unchanged behavior). Otherwise only the approved 'exit:<sym>'/'enter:<sym>' items are
    executed — a position whose exit is NOT approved stays open (just re-marked to market),
    and an unapproved entry is skipped. Recomputes from the CURRENT scan so the panel can
    never make the server execute anything its own fresh plan doesn't propose. NO real
    orders — sim tables only."""
    pilot_id = armed["pilot_id"]
    nav = float(armed.get("nav") or 0.0)
    plan = _compute_sim_plan(username, armed, scan)
    approve_all = approved_keys is None
    exit_syms = {e["symbol"]: e for e in plan["exits"]}
    # Fresh scan prices — held (non-closing) positions re-mark to these, exactly like the
    # original run_pilot_sim mark-to-market (not a stale last_price).
    sig_by_symbol = {s.get("symbol"): s for s in ((scan or {}).get("signals") or []) if s.get("symbol")}

    opened = 0
    closed = 0
    # 1) Re-mark every open position; CLOSE only approved (or all) proposed exits.
    for pos in db.list_autopilot_positions(username, pilot_id, status="open"):
        sym = pos["symbol"]; side = pos["side"]
        entry = float(pos["entry_price"]); qty = float(pos["qty"])
        ex_item = exit_syms.get(sym)
        do_close = ex_item is not None and (approve_all or ex_item["key"] in approved_keys)
        if do_close:
            last = float(ex_item["price"])
            realized = (last - entry) * qty if side == "long" else (entry - last) * qty
            db.close_autopilot_position(pos["id"], last, realized)
            db.log_autopilot_activity(username=username, pilot_id=pilot_id, kind="close",
                                      symbol=sym, side=side, price=last, qty=qty, pnl=realized,
                                      note="sim exit")
            closed += 1
        else:  # not closing (held, or exit proposed but not approved) → reprice only
            sig = sig_by_symbol.get(sym)
            last = float(sig["currentPrice"]) if (sig and sig.get("currentPrice")) else float(pos.get("last_price") or entry)
            unrl = (last - entry) * qty if side == "long" else (entry - last) * qty
            db.mark_autopilot_position(pos["id"], last, unrl)

    # 2) OPEN approved (or all) proposed entries, still bounded by the pilot's cap.
    meta = _meta(pilot_id)
    max_positions = int(meta.get("maxPositions", 8))
    open_count = len(db.list_autopilot_positions(username, pilot_id, status="open"))
    for e in plan["entries"]:
        if open_count >= max_positions:
            break
        if not (approve_all or e["key"] in approved_keys):
            continue
        db.open_autopilot_position(username=username, pilot_id=pilot_id, symbol=e["symbol"],
                                   side=e["side"], entry_price=float(e["price"]), qty=float(e["qty"]))
        db.log_autopilot_activity(username=username, pilot_id=pilot_id, kind="open",
                                  symbol=e["symbol"], side=e["side"], price=float(e["price"]),
                                  qty=float(e["qty"]), note="sim entry")
        open_count += 1
        opened += 1

    # 3) Stamp run times + append an equity point (a run occurred).
    db.set_autopilot_run_stamps(username, pilot_id, db.now_iso(), _next_run_iso())
    _append_equity_point(username, pilot_id, nav)
    return {"pilotId": pilot_id, "opened": opened, "closed": closed, "open": open_count,
            "placed": opened + closed, "skippedCount": 0, "skips": []}


def run_pilot_sim(username: str, armed: dict, scan: dict) -> dict:
    """Run ONE dry-run pass and apply EVERY proposed action (the auto-batch / legacy
    run-now path). NO real orders — every write lands in the autopilot_sim_* tables only."""
    return _apply_sim_plan(username, armed, scan, approved_keys=None)


def _dispatch_run(username: str, armed: dict, scan: dict) -> dict:
    """Auto-batch / "Run all" pass. SIM pilots run normally.

    MONEY-SAFETY (Dan-approved): a LIVE pilot is NEVER auto-executed here — the automatic
    00:10 UTC batch and the "Run all" button must not place real Bybit orders. Real orders
    fire ONLY through the owner's explicit per-trade approval in the Run-now review panel
    (/autopilots/approve → apply_pilot_live). So a live pilot in this path is a safe no-op
    for ORDER PLACEMENT (its open positions are still marked-to-market elsewhere via
    mark_positions_live / pilot_state). The skip is audited so it's visible, not silent."""
    if _is_mr(armed["pilot_id"]):                    # Phase-2b MR pilot → paper-sim engine
        from app.services import mr_sim
        return mr_sim.apply_mr_plan(username, armed, approved_keys=None)
    if _is_dr(armed["pilot_id"]) and (armed.get("mode") or "simulation") != "live":  # DR crypto in SIM → paper engine
        from app.services import dr_sim
        return dr_sim.apply_dr_plan(username, armed, approved_keys=None)
    # DR crypto in LIVE mode falls through to the live branch below (spot-long-only, gated) — same as pilots 1-2.
    if (armed.get("mode") or "simulation") == "live":
        db.log_autopilot_live_audit(
            username=username, pilot_id=armed["pilot_id"], action="order_skipped",
            detail={"reason": "auto-run gated OFF — live orders require the owner's approval "
                              "in the Run-now review panel"})
        return {"pilotId": armed["pilot_id"], "live": True, "autoSkipped": True, "opened": 0, "closed": 0}
    return run_pilot_sim(username, armed, scan)


def run_all_for_user(username: str) -> list[dict]:
    """Run a pass for every pilot the user has armed (on-arm / run-now)."""
    scan = db.get_daily_scan()
    out = []
    for a in db.list_autopilot_armed(username):
        try:
            out.append(_dispatch_run(username, a, scan))
        except Exception as exc:  # never let one pilot break the batch
            logger.warning("autopilot run failed user=%s pilot=%s: %s", username, a.get("pilot_id"), exc)
    return out


def run_one(username: str, pilot_id: str) -> Optional[dict]:
    """Run a pass for a single armed pilot (on-arm / run-now for one tile)."""
    armed = db.get_autopilot_armed(username, pilot_id)
    if not armed:
        return None
    return _dispatch_run(username, armed, db.get_daily_scan())


# ── Plan → approve → apply (the review gate behind the manual "Run now" panel) ──────────
# "Run now" computes a READ-ONLY plan (no writes, no orders); the panel shows it; the owner
# approves all or a chosen subset; ONLY then does apply execute the approved items. For a
# LIVE pilot the plan/apply route to autopilot_live (which keeps every real-money gate).

def _dispatch_plan(username: str, armed: dict, scan: dict) -> dict:
    """Compute the reviewable plan for one pilot — routes to the live planner for a live
    pilot (which reports eligibility/budget), else the sim planner. NO writes, NO orders."""
    if _is_mr(armed["pilot_id"]):                    # Phase-2b MR pilot → paper-sim planner
        from app.services import mr_sim
        return mr_sim.compute_mr_plan(username, armed)
    if _is_dr(armed["pilot_id"]) and (armed.get("mode") or "simulation") != "live":  # DR crypto in SIM → paper planner
        from app.services import dr_sim
        return dr_sim.compute_dr_plan(username, armed)
    if (armed.get("mode") or "simulation") == "live":   # incl. DR crypto LIVE → gated live planner (DR-aware)
        from app.services import autopilot_live as live  # lazy import avoids a cycle
        return live.plan_pilot_live(username, armed, scan)
    return _compute_sim_plan(username, armed, scan)


def _dispatch_apply(username: str, armed: dict, scan: dict, approved_keys: set) -> dict:
    """Execute ONLY the owner-approved items for one pilot. Live → real orders via the
    fully-gated executor; sim → paper writes. Recomputes from the current scan so nothing
    outside the server's own fresh plan can be executed."""
    if _is_mr(armed["pilot_id"]):                    # Phase-2b MR pilot → paper-sim apply
        from app.services import mr_sim
        return mr_sim.apply_mr_plan(username, armed, approved_keys=approved_keys)
    if _is_dr(armed["pilot_id"]) and (armed.get("mode") or "simulation") != "live":  # DR crypto in SIM → paper apply
        from app.services import dr_sim
        return dr_sim.apply_dr_plan(username, armed, approved_keys=approved_keys)
    if (armed.get("mode") or "simulation") == "live":   # incl. DR crypto LIVE → gated live executor (DR-aware)
        from app.services import autopilot_live as live  # lazy import avoids a cycle
        return live.apply_pilot_live(username, armed, scan, approved_keys)
    return _apply_sim_plan(username, armed, scan, approved_keys=approved_keys)


def plan_pilot_run(username: str, pilot_id: str) -> Optional[dict]:
    """READ-ONLY: the reviewable plan for a single armed pilot ("Run now" → panel)."""
    armed = db.get_autopilot_armed(username, pilot_id)
    if not armed:
        return None
    return _dispatch_plan(username, armed, db.get_daily_scan())


def apply_pilot_run(username: str, pilot_id: str, approved_keys: set) -> Optional[dict]:
    """Execute the owner-approved subset for a single armed pilot (panel → Approve)."""
    armed = db.get_autopilot_armed(username, pilot_id)
    if not armed:
        return None
    return _dispatch_apply(username, armed, db.get_daily_scan(), approved_keys or set())


def run_all() -> int:
    """Daily batch: run a dry-run pass for EVERY armed pilot across all users, then
    mark each user's open positions to REAL live prices."""
    scan = db.get_daily_scan()
    n = 0
    users = set()
    for a in db.list_autopilot_armed(None):
        try:
            _dispatch_run(a["username"], a, scan)
            users.add(a["username"])
            n += 1
        except Exception as exc:
            logger.warning("autopilot run failed user=%s pilot=%s: %s", a.get("username"), a.get("pilot_id"), exc)
    for u in users:
        try:
            mark_positions_live(u)
        except Exception as exc:
            logger.warning("autopilot live mark failed user=%s: %s", u, exc)
    return n


def _pos_dto(p: dict) -> dict:
    return {
        "symbol": p.get("symbol"), "side": p.get("side"),
        "entryPrice": p.get("entry_price"), "exitPrice": p.get("exit_price"), "qty": p.get("qty"),
        "lastPrice": p.get("last_price"),
        "unrealizedPnl": round(float(p.get("unrealized_pnl") or 0.0), 2),
        "realizedPnl": round(float(p.get("realized_pnl") or 0.0), 2),
        "status": p.get("status"), "openedAt": p.get("opened_at"), "closedAt": p.get("closed_at"),
        # 'simulation' (paper) vs 'live' (real Bybit fill, with the exchange order id).
        "mode": p.get("mode") or "simulation", "orderId": p.get("order_id"),
    }


# ── LIVE mark-to-market — REAL current market prices (still SIMULATION, no orders) ──
# Open positions are priced against the app's live market-data layer: CCXT public
# tickers for crypto (exchange.fetch_prices), yfinance/Stooq last close for stocks.
# ONLY the pricing + P&L are real; no order is placed and no money moves.
# Short shared price cache so repeated views (state is polled every ~30-45s) don't
# re-hit the market each time. TTL keeps prices fresh-enough for DISPLAY marks.
_PX_CACHE: dict = {}   # symbol -> (monotonic_ts, price)
_PX_TTL = 45.0


def _live_prices(symbols) -> dict:
    import time
    out: dict = {}
    syms = [s for s in {s for s in (symbols or []) if s}]
    if not syms:
        return out
    now = time.monotonic()
    miss: list = []
    for s in syms:
        c = _PX_CACHE.get(s)
        if c and (now - c[0]) < _PX_TTL:
            out[s] = c[1]
        else:
            miss.append(s)
    if not miss:
        return out
    fresh: dict = {}
    crypto = [s for s in miss if "/" in s]
    stocks = [s for s in miss if "/" not in s]
    if crypto:
        try:
            from app.services.exchange import fetch_prices
            fresh.update(fetch_prices(crypto) or {})
        except Exception as exc:
            logger.warning("autopilot live crypto prices failed: %s", exc)
    for s in stocks:
        try:
            from app.data.equities import fetch_equity_ohlcv
            df = fetch_equity_ohlcv(s, timeframe="1d", limit=3)
            if df is not None and len(df):
                fresh[s] = float(df["close"].iloc[-1])
        except Exception as exc:
            logger.warning("autopilot live stock price failed %s: %s", s, exc)
    for s, px in fresh.items():
        if px and px > 0:
            _PX_CACHE[s] = (now, float(px))
            out[s] = float(px)
    return out


def _open_positions_all(username: str, pilot_id: "Optional[str]" = None) -> list:
    pids = [pilot_id] if pilot_id else [a["pilot_id"] for a in db.list_autopilot_armed(username)]
    opens: list = []
    for pid in pids:
        opens.extend(db.list_autopilot_positions(username, pid, status="open"))
    return opens


def mark_positions_live(username: str, pilot_id: "Optional[str]" = None, prices: "Optional[dict]" = None) -> int:
    """Re-price a user's OPEN sim positions against REAL live prices; persist P&L.
    Returns how many were updated. NO orders — pricing only."""
    opens = _open_positions_all(username, pilot_id)
    if not opens:
        return 0
    if prices is None:
        prices = _live_prices([p["symbol"] for p in opens])
    n = 0
    for pos in opens:
        px = prices.get(pos["symbol"])
        if not px:
            continue
        entry = float(pos["entry_price"])
        qty = float(pos["qty"])
        unreal = (px - entry) * qty if pos["side"] == "long" else (entry - px) * qty
        # Phase-2b MR pilot displays P&L NET of the round-trip fee (consistent with its sim
        # engine + the CP3 net numbers). Other pilots are unchanged.
        if _is_mr(pos.get("pilot_id")):
            from app.services import mr_sim
            unreal -= mr_sim.round_trip_fee(entry, float(px), qty)
        elif _is_dr(pos.get("pilot_id")):            # Phase-2c DR pilot also displays P&L net of fees
            from app.services import dr_sim
            unreal -= dr_sim.round_trip_fee(entry, float(px), qty)
        db.mark_autopilot_position(pos["id"], float(px), unreal)
        n += 1
    return n


def _act_dto(a: dict) -> dict:
    return {
        "kind": a.get("kind"), "symbol": a.get("symbol"), "side": a.get("side"),
        "price": a.get("price"), "qty": a.get("qty"),
        "pnl": (round(float(a["pnl"]), 2) if a.get("pnl") is not None else None),
        "note": a.get("note"), "at": a.get("at"),
    }


def pilot_state(username: str, live: bool = False) -> dict:
    """Assemble the SIMULATED status payload for all of a user's armed pilots.
    When `live`, first mark all OPEN positions to REAL current market prices."""
    if live:
        try:
            mark_positions_live(username)
        except Exception as exc:
            logger.warning("autopilot live mark failed user=%s: %s", username, exc)
    scan = db.get_daily_scan()
    pilots = []
    for a in db.list_autopilot_armed(username):
        pid = a["pilot_id"]
        positions = db.list_autopilot_positions(username, pid)
        open_pos = [p for p in positions if p.get("status") == "open"]
        closed_pos = [p for p in positions if p.get("status") == "closed"]
        realized = sum(float(p.get("realized_pnl") or 0.0) for p in closed_pos)
        unreal = sum(float(p.get("unrealized_pnl") or 0.0) for p in open_pos)
        # Split P&L by POSITION mode, not pilot mode — so a live pilot that still holds
        # leftover simulation positions never leaks that sim P&L into the LIVE bucket (and
        # vice-versa). This is what guarantees "no demo positions in LIVE, ever".
        _is_live = lambda p: (p.get("mode") or "simulation") == "live"
        live_open = [p for p in open_pos if _is_live(p)]
        live_closed = [p for p in closed_pos if _is_live(p)]
        live_pnl = (sum(float(p.get("realized_pnl") or 0.0) for p in live_closed)
                    + sum(float(p.get("unrealized_pnl") or 0.0) for p in live_open))
        sim_pnl = round(realized + unreal, 2) - round(live_pnl, 2)
        pilots.append({
            "pilotId": pid,
            "armedAt": a.get("armed_at"),
            "accountLabel": a.get("account_label"),
            "nav": a.get("nav"),
            "capital": a.get("nav"),                 # NAV = the defined starting capital
            "perTradePct": a.get("per_trade_pct"),
            "direction": a.get("direction"),
            # Execution mode — 'simulation' (default/fallback) or 'live' (real Bybit orders,
            # gated). liveCap = the owner-set starting-capital cap for the first live run.
            "mode": a.get("mode") or "simulation",
            "liveCap": a.get("live_cap"),
            "liveStartedAt": a.get("live_started_at"),
            "status": "simulation",
            "lastRunAt": a.get("last_run_at"),
            "nextRunAt": a.get("next_run_at"),
            "realizedPnl": round(realized, 2),
            "unrealizedPnl": round(unreal, 2),
            "totalPnl": round(realized + unreal, 2),
            # P&L attributed by POSITION mode (livePnl + simPnl == totalPnl) so LIVE stays
            # STRICTLY real — no demo/sim position ever counts in the live bucket.
            "livePnl": round(live_pnl, 2),
            "simPnl": round(sim_pnl, 2),
            "liveOpenCount": len(live_open),
            "simOpenCount": len(open_pos) - len(live_open),
            "openCount": len(open_pos),
            "tradeCount": len(closed_pos),
            # WAITING = loaded but nothing bought yet (flat) — the honest post-load state.
            "waiting": (len(open_pos) == 0 and len(closed_pos) == 0),
            "hasRun": bool(a.get("last_run_at")),
            "equityCurve": (a.get("equity_curve") or []),
            "positions": [_pos_dto(p) for p in open_pos[:20]],
            "closedPositions": [_pos_dto(p) for p in closed_pos[:30]],
            "activity": [_act_dto(x) for x in db.list_autopilot_activity(username, pid, 30)],
        })
    # Live gate + the owner's Bybit key status (masked only) — so the UI can show the
    # real-money surface honestly. Lazy import avoids a module cycle.
    try:
        from app.services import autopilot_live as live
        bybit = live.keys_status(username)
        live_info = {
            "masterEnabled": live.live_master_enabled(),
            "capMin": live.LIVE_CAP_MIN_USD,
            "capMax": live.LIVE_CAP_MAX_USD,
            "goLivePhrase": live.GO_LIVE_PHRASE,
        }
    except Exception as exc:  # never let the live layer break the sim state
        logger.warning("autopilot live status failed user=%s: %s", username, exc)
        bybit = {"connected": False}
        live_info = {"masterEnabled": False, "capMin": 10.0, "capMax": 250.0, "goLivePhrase": "GO LIVE"}
    # Scan telemetry for the AutoPilots screen — drives the live countdown + the honest
    # "scanning now" pulse + last-scan/coverage. next_scan_at is computed LIVE from the
    # daily-scan schedule (not the stored nextAt, which only refreshes when a scan saves),
    # so the countdown stays correct even if a scan was slow or missed. is_scanning()
    # reflects the REAL in-flight state (a manual or scheduled run), not a decorative pulse.
    try:
        from app.services import daily_scan as _ds
        scan_next_at = _ds.next_run(datetime.now(timezone.utc)).isoformat()
        scan_in_progress = _ds.is_scanning()
    except Exception as exc:  # never let telemetry break the sim state
        logger.warning("autopilot scan telemetry failed user=%s: %s", username, exc)
        scan_next_at = None
        scan_in_progress = False
    scan_telemetry = {
        "lastScanAt": scan.get("ranAt"),
        "nextScanAt": scan_next_at,           # next 00:05 UTC daily scan (computed live)
        "scanInProgress": scan_in_progress,   # a real scan is running right now
        "symbolCount": len(scan.get("signals") or []),  # assets the last scan covered
        "pilotBatchOffsetMin": 5,             # pilots run ~5 min after the scan (00:10 UTC)
    }
    return {
        "pilots": pilots,
        "scanRanAt": scan.get("ranAt"),
        "hasScan": bool(scan.get("signals")),
        "scan": scan_telemetry,
        "mode": "simulation",
        "live": live_info,
        "bybit": bybit,
    }


async def autopilot_sim_loop() -> None:
    """Background loop: run the daily dry-run batch at 00:10 UTC (just after the scan)."""
    while True:
        try:
            now = datetime.now(timezone.utc)
            nxt = now.replace(hour=0, minute=10, second=0, microsecond=0)
            if nxt <= now:
                nxt += timedelta(days=1)
            await asyncio.sleep(max(60.0, (nxt - now).total_seconds()))
            n = run_all()
            logger.info("autopilot sim daily batch ran for %d armed pilot(s)", n)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("autopilot sim loop error: %s", exc)
            await asyncio.sleep(300)
