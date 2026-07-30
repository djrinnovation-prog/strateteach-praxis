"""Paper (demo) trading: virtual sessions scanned from live crypto signals and
marked to market. Money never moves, so these routes are not PIN-gated.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user
from app.services import exchange as ex
from app.services import paper_trading as paper
from app.services import signals as sig_scanner
from app.services import notify

logger = logging.getLogger("algo770")

router = APIRouter(tags=["exchange"])


# ── per-user scoping ──────────────────────────────────────────────────────────
def viewer(authorization: Optional[str] = Header(default=None)) -> tuple[str, bool]:
    """Resolve (username, is_admin) so demo sessions can be scoped per user.

    Admins see every session; a regular user sees only the sessions they opened.
    """
    username = current_user(authorization)
    user = db.get_user(username)
    return username, bool(user and user.get("role") == "admin")


def _require_owned(session_id: int, username: str, is_admin: bool) -> dict:
    """Fetch a session and ensure the caller may act on it (owner or admin)."""
    session = db.get_paper_session_by_id(session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    if not is_admin and session.get("owner") != username:
        raise HTTPException(403, "This session belongs to another user.")
    return session


# ── input models ─────────────────────────────────────────────────────────────
class PaperPreviewInput(BaseModel):
    tiers: List[str] = ["breaking_out", "near_breakout"]
    maxPositions: int = 5
    strategy: str = "bot8c"
    buckets: List[str] = ["crypto"]


class PaperStartInput(BaseModel):
    capital: float = 1000.0
    dailyTarget: float = 0.0
    targetBehavior: str = "ask"
    takeProfitEnabled: bool = False
    takeProfitPct: float = 5.0
    tiers: List[str] = ["breaking_out", "near_breakout"]
    maxPositions: int = 5
    symbols: Optional[List[str]] = None
    strategy: str = "bot8c"
    label: Optional[str] = None
    buckets: List[str] = ["crypto"]
    stopLossEnabled: bool = False
    stopLossMode: str = "amount"   # "amount" | "pct"
    stopLossValue: float = 0.0


async def _signals_for_buckets(buckets: Optional[List[str]], strategy: str) -> list:
    """Signals for the chosen scan domains. Crypto comes from the fast background
    cache; other markets (stocks/metals/commodities) are scanned on demand
    (best-effort, modest limits) so the domain picker actually works."""
    from app.data.symbols import BUCKET_MAP
    picked = [b for b in (buckets or []) if b in BUCKET_MAP] or ["crypto"]
    sigs: list = []
    if "crypto" in picked:
        sigs.extend(db.get_daily_scan().get("signals") or [])
    others = [b for b in picked if b != "crypto"]
    if others:
        try:
            extra = await sig_scanner.run_breakout_scan(
                others, crypto_limit=0, stock_limit=40, metal_limit=40,
                commodity_limit=40, strategy=strategy,
            )
            sigs.extend(extra or [])
        except Exception as exc:  # noqa: BLE001
            logger.warning("on-demand multi-bucket scan failed: %s", exc)
    return sigs


class PaperCloseInput(BaseModel):
    sessionId: Optional[int] = None
    id: Optional[int] = None
    all: Optional[bool] = False  # manual "close all in profit" ignores the take-profit gate


class PaperDecisionInput(BaseModel):
    sessionId: Optional[int] = None
    action: str = "continue"


class PaperDeleteInput(BaseModel):
    sessionId: Optional[int] = None


# ── orchestration helpers ────────────────────────────────────────────────────
def _close_paper_positions(marked_positions: List[dict], reason: str = "manual") -> float:
    """Persist a close for each marked position; return total realized PnL.

    ``reason`` is stamped on each closed position (stop_loss | take_profit | target_hit |
    manual | daily_reset) so the closed-positions log can show WHY it closed."""
    closed_at = paper.now_iso()
    total = 0.0
    for p in marked_positions:
        if p.get("status") != "open":
            continue
        pnl = float(p.get("pnl") or 0.0)
        total += pnl
        close_price = float(p.get("currentPrice") or 0.0)
        qty = float(p.get("qty") or 0.0)
        db.close_paper_position(p["id"], close_price, pnl, closed_at, reason=reason)
        db.add_activity(
            "demo", "close", p.get("symbol"), name=p.get("name"), tier=p.get("tier"),
            direction="long", qty=qty, price=close_price,
            cost=(qty * close_price if qty and close_price else None), pnl=pnl, ts=closed_at,
        )
    return total


def _notify_owner(session: dict, kind: str, text: str) -> None:
    """Best-effort alert to a session's owner (respects their notif prefs)."""
    owner = session.get("owner")
    if owner:
        try:
            notify.notify_user(owner, text, kind=kind)
        except Exception as exc:  # never let a notify failure break trading
            logger.warning("notify (%s) failed: %s", kind, exc)


def _record_target_event(session: dict, marked: dict, session_id: Optional[int] = None):
    started = session.get("startedAt")
    secs = paper.runtime_seconds(started)
    assets = ", ".join(p.get("symbol") for p in marked.get("positions", []) if p.get("symbol"))
    profit = float(marked.get("totalPnl") or 0.0)
    db.add_target_event(
        mode="demo", hit_at=paper.now_iso(), started_at=started, seconds_to_target=secs,
        target=float(session.get("dailyTarget") or 0.0), profit=profit,
        assets=assets,
        detail={"positions": [{"symbol": p.get("symbol"), "pnl": p.get("pnl"), "pnlPct": p.get("pnlPct")}
                              for p in marked.get("positions", [])]},
        session_id=session_id,
    )
    _notify_owner(session, "takeProfit",
                  f"🎯 ALGO770: take-profit hit! Your run reached ${profit:,.2f} ({assets or 'positions'}). app.strateteach.com")
    # Admin awareness ping (best-effort) — so the admin sees target hits as they happen.
    try:
        from app.services import telegram as tg
        owner = db.display_name(session.get("owner") or "?")
        tg.notify_admin(f"🎯 <b>Target hit</b>\n{owner}'s run reached ${profit:,.2f} "
                        f"({assets or 'positions'}). app.strateteach.com")
        # The owning admin's own Telegram (their data only).
        tg.notify_user(session.get("owner") or "",
                       f"🎯 <b>Target hit</b>\nYour run reached ${profit:,.2f} ({assets or 'positions'}). app.strateteach.com")
    except Exception:
        pass


async def _build_paper_state(viewer_user: Optional[str] = None, is_admin: bool = False) -> dict:
    """Aggregate the caller's running demo sessions for the demo indicator."""
    data = await _build_paper_sessions(viewer_user, is_admin)
    sessions = data["sessions"]
    running = [s for s in sessions if s.get("status") == "running"]
    open_positions = [p for s in running for p in s.get("positions", []) if p.get("status") == "open"]
    total_cost = sum(float(s.get("totalCost") or 0.0) for s in running)
    total_value = sum(float(s.get("totalValue") or 0.0) for s in running)
    total_pnl = sum(float(s.get("totalPnl") or 0.0) for s in running)
    starts = [s.get("startedAt") for s in running if s.get("startedAt")]
    started_at = min(starts) if starts else None
    runtime = paper.runtime_seconds(started_at) if started_at else 0.0
    pending = any(s.get("pendingDecision") for s in running)
    return {
        "session": {"status": "running" if running else "idle", "startedAt": started_at,
                    "runningCount": len(running), "sessionCount": len(sessions)},
        "positions": open_positions,
        "totalCost": round(total_cost, 2), "totalValue": round(total_value, 2),
        "totalPnl": round(total_pnl, 2),
        "totalPnlPct": round((total_pnl / total_cost * 100.0) if total_cost > 0 else 0.0, 2),
        "runtimeSeconds": round(runtime, 0), "pendingDecision": pending,
        "runningCount": len(running), "sessionCount": len(sessions),
    }


async def _build_one_session_state(session: dict, prices: Optional[dict] = None) -> dict:
    """Mark one demo session to market and evaluate its daily target (never auto-closes).

    ``prices`` may be a shared price map (fetched once for all sessions); if omitted
    this session fetches its own.
    """
    sid = session["id"]
    strat = session.get("strategy") or sig_scanner.DEFAULT_STRATEGY
    strat_label = sig_scanner.STRATEGY_PARAMS.get(strat, {}).get("label", strat)
    open_positions = db.list_paper_positions("open", session_id=sid)
    if prices is None:
        prices = {}
        if open_positions:
            prices = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in open_positions])
    marked = paper.mark_to_market(open_positions, prices)

    # ── Stop-loss ───────────────────────────────────────────────────────────────
    # PERCENT mode = PER-POSITION (per Dan): each OPEN position is closed the moment it is
    #   >= stopLossValue% underwater from ITS OWN entry/cost-basis — independent of the rest
    #   of the run (mirrors the per-position take-profit). Survivors keep running; if the stop
    #   drains every position, the run is marked stopped.
    # AMOUNT mode = WHOLE-RUN: close the entire run if its aggregate USDT loss hits the cap
    #   (unchanged legacy behaviour).
    if session.get("status") == "running" and bool(session.get("stopLossEnabled")) and open_positions:
        sl_value = float(session.get("stopLossValue") or 0.0)
        mode = session.get("stopLossMode") or "amount"
        if sl_value > 0 and mode == "pct":
            breached = [p for p in marked["positions"]
                        if p.get("status") == "open" and float(p.get("pnlPct") or 0.0) <= -sl_value]
            if breached:
                _close_paper_positions(breached, reason="stop_loss")  # simulated close of the losers only
                open_positions = db.list_paper_positions("open", session_id=sid)
                if open_positions:
                    marked = paper.mark_to_market(open_positions, prices)  # re-mark the survivors
                else:  # the stop closed the last position → the run is done
                    db.update_paper_session_row(sid, status="stopped", pending_decision=False,
                                                closed_at=paper.now_iso(), stoppedReason="stop_loss")
                    session = db.get_paper_session_by_id(sid) or session
        elif sl_value > 0:  # amount mode → whole-run aggregate USDT-loss stop
            closed_pos = db.list_paper_positions("closed", session_id=sid)
            realized = sum(float(p.get("realizedPnl") or 0.0) for p in closed_pos)
            run_pnl = float(marked.get("totalPnl") or 0.0) + realized
            if run_pnl <= -sl_value:
                _close_paper_positions(marked["positions"], reason="stop_loss")
                db.update_paper_session_row(sid, status="stopped", pending_decision=False,
                                            closed_at=paper.now_iso(), stoppedReason="stop_loss")
                session = db.get_paper_session_by_id(sid) or session
                open_positions = []

    tp_enabled = bool(session.get("takeProfitEnabled"))
    tp_pct = float(session.get("takeProfitPct") or 5.0)
    target = float(session.get("dailyTarget") or 0.0)
    if tp_enabled:
        reached = bool(open_positions) and any(float(p.get("pnlPct") or 0.0) >= tp_pct for p in marked["positions"])
    else:
        reached = target > 0 and bool(open_positions) and marked["totalPnl"] >= target
    pending = session.get("pendingDecision", False)
    acknowledged = session.get("acknowledged", False)

    if reached and session.get("status") == "running":
        if not session.get("targetHitAt"):
            db.update_paper_session_row(
                sid, target_hit_at=paper.now_iso(),
                seconds_to_target=round(paper.runtime_seconds(session.get("startedAt")), 0),
            )
        if str(session.get("targetBehavior")) == "stop":
            # Auto-close the WHOLE run the moment its target is hit ("bank it").
            _record_target_event(session, marked, sid)
            _close_paper_positions(marked["positions"], reason="target_hit")
            db.update_paper_session_row(sid, status="stopped", pending_decision=False,
                                        closed_at=paper.now_iso(), stoppedReason="target_hit")
            session = db.get_paper_session_by_id(sid) or session
            open_positions = []
            pending = False
        elif not pending and not acknowledged:
            db.update_paper_session_row(sid, pending_decision=True)
            pending = True
    elif not reached and acknowledged:
        db.update_paper_session_row(sid, acknowledged=False)
        acknowledged = False

    session = db.get_paper_session_by_id(sid) or session
    runtime = paper.session_runtime(session.get("startedAt"), session.get("closedAt"))
    all_positions = db.list_paper_positions(session_id=sid)
    rows: List[dict] = []
    total_cost = total_value = 0.0
    for p in all_positions:
        cost = float(p.get("capital") or 0.0)
        if p.get("status") == "open":
            cur = float(prices.get(p["symbol"]) or 0.0) or float(p["entryPrice"])
            value = float(p["qty"]) * cur
        else:
            cur = p.get("closePrice")
            value = cost + float(p.get("realizedPnl") or 0.0)
        pnl = value - cost
        total_cost += cost
        total_value += value
        rows.append({**p, "currentPrice": (round(cur, 6) if cur is not None else None),
                     "value": round(value, 2), "pnl": round(pnl, 2),
                     "pnlPct": round((pnl / cost * 100.0) if cost > 0 else 0.0, 2)})
    total_pnl = total_value - total_cost
    history = db.list_target_events(session_id=sid)
    stats = paper.history_stats(history)
    assets = sorted({p["symbol"] for p in all_positions if p.get("symbol")})
    return {
        **session, "strategyLabel": strat_label, "positions": rows, "assets": assets,
        "totalCost": round(total_cost, 2), "totalValue": round(total_value, 2),
        "totalPnl": round(total_pnl, 2),
        "totalPnlPct": round((total_pnl / total_cost * 100.0) if total_cost > 0 else 0.0, 2),
        "runtimeSeconds": round(runtime, 0), "targetReached": reached, "justStopped": False,
        "pendingDecision": pending, "history": history, "stats": stats,
    }


async def _build_paper_sessions(viewer_user: Optional[str] = None, is_admin: bool = False) -> dict:
    """Demo sessions (running + closed), each marked to market.

    Scoped per user: an admin sees every session; a regular user sees only the
    sessions they opened. Legacy sessions with no owner are visible to admins
    only. Prices for every open position across the visible sessions are fetched
    ONCE (a single batch ticker call) and shared.
    """
    sessions = db.list_paper_sessions()
    sessions = [s for s in sessions if not s.get("hidden")]  # deleted = hidden, totals kept
    if not is_admin:
        sessions = [s for s in sessions if s.get("owner") == viewer_user]
    symbols = set()
    for s in sessions:
        for p in db.list_paper_positions("open", session_id=s["id"]):
            if p.get("symbol"):
                symbols.add(p["symbol"])
    # Cached (stale-while-revalidate) prices: this list endpoint is polled ~every
    # 18s and marks every position to market, so a fresh ~2-3s exchange call here
    # made the dashboard crawl. Display tolerates a few seconds of staleness;
    # execution paths (open/close/force-close) still call fetch_prices fresh.
    prices = await ex.cached_prices(list(symbols)) if symbols else {}
    built = [await _build_one_session_state(s, prices) for s in sessions]
    return {"sessions": built}


# ── routes ───────────────────────────────────────────────────────────────────
@router.get("/exchange/paper/state")
async def paper_state(who: tuple[str, bool] = Depends(viewer)):
    return await _build_paper_state(who[0], who[1])


@router.get("/exchange/paper/sessions")
async def paper_sessions(who: tuple[str, bool] = Depends(viewer)):
    return await _build_paper_sessions(who[0], who[1])


@router.post("/exchange/paper/delete-closed")
async def paper_delete_closed(who: tuple[str, bool] = Depends(viewer)):
    """Clean up: hide every closed/stopped run the caller owns (totals are kept)."""
    username, is_admin = who
    sessions = [s for s in db.list_paper_sessions() if not s.get("hidden")]
    if not is_admin:
        sessions = [s for s in sessions if s.get("owner") == username]
    n = 0
    for s in sessions:
        if s.get("status") != "running":
            db.update_paper_session_row(s["id"], hidden=True)
            n += 1
    return {**(await _build_paper_sessions(username, is_admin)), "deleted": n}


@router.get("/exchange/paper/daily-pnl")
async def paper_daily_pnl(who: tuple[str, bool] = Depends(viewer)):
    """Per-day realized P&L (from closed positions), scoped to the caller, for the
    activity calendar + month/year totals + day drill-down."""
    username, is_admin = who
    sessions = [s for s in db.list_paper_sessions() if not s.get("hidden")]
    if not is_admin:
        sessions = [s for s in sessions if s.get("owner") == username]
    days: dict[str, dict] = {}
    for s in sessions:
        label = s.get("label") or f"#{s['id']}"
        for p in db.list_paper_positions("closed", session_id=s["id"]):
            ca = p.get("closedAt")
            if not ca:
                continue
            day = str(ca)[:10]
            d = days.setdefault(day, {"pnl": 0.0, "trades": []})
            pnl = float(p.get("realizedPnl") or 0.0)
            cap = float(p.get("capital") or 0.0)
            d["pnl"] += pnl
            d["trades"].append({"symbol": p.get("symbol"), "pnl": round(pnl, 2),
                                "pnlPct": round((pnl / cap * 100.0) if cap > 0 else 0.0, 2),
                                "closedAt": ca, "session": label})
    out = [{"day": k, "pnl": round(v["pnl"], 2), "trades": v["trades"]} for k, v in sorted(days.items())]
    return {"days": out}


@router.get("/exchange/paper/closed-log")
async def paper_closed_log(
    limit: int = 500,
    who: tuple[str, bool] = Depends(viewer),
    # NON-CUSTODIAL keys: the client sends the exchange key/secret as headers on /exchange/* routes
    # (they live in the browser, nothing is stored). We pass them to the reconcile so it can read
    # the exchange's CLOSED orders — otherwise the ENGINE's live OCO stop/take-profit fills are
    # never detected server-side (the stored config is empty in this mode) and the log shows 0 live.
    x_exchange_key: Optional[str] = Header(None, alias="X-Exchange-Key"),
    x_exchange_secret: Optional[str] = Header(None, alias="X-Exchange-Secret"),
    x_exchange_passphrase: Optional[str] = Header(None, alias="X-Exchange-Passphrase"),
    x_exchange_name: Optional[str] = Header(None, alias="X-Exchange-Name"),
    x_exchange_env: Optional[str] = Header(None, alias="X-Exchange-Env"),
):
    """Read-only history of CLOSED positions for review after a close: per position the
    asset, close time, entry/exit price, %P&L, and WHY it closed (stop-loss / take-profit /
    target / manual). DEMO rows come from the paper engine (exact, with reason). LIVE rows are
    the closes the app performed/logged AND the exchange-side OCO auto-fills detected by the
    read-only reconcile below (stop-loss / take-profit). Places/cancels NOTHING."""
    username, is_admin = who
    lim = max(1, min(3000, int(limit or 500)))
    # READ-ONLY exchange reconcile: detect any live position (Trading Engine / Signal Bot) that
    # closed on the exchange — an OCO stop/take-profit auto-fill or a manual sell — and record it
    # with reason + %P&L + order id. Places/cancels NOTHING. Best-effort — the log renders even if
    # it hiccups. When the caller holds NON-CUSTODIAL keys (in the browser), we pass them through so
    # the reconcile can read closed orders (force=True bypasses the 45s cache for this explicit,
    # keys-in-hand open); otherwise it falls back to the stored config (custodial users).
    try:
        from app.services import live_reconcile
        creds = {"key": x_exchange_key, "secret": x_exchange_secret, "passphrase": x_exchange_passphrase,
                 "name": x_exchange_name, "env": x_exchange_env}
        rcfg = live_reconcile.cfg_from_creds(creds)
        await run_in_threadpool(live_reconcile.reconcile_user, username, force=bool(rcfg), cfg=rcfg)
    except Exception:  # noqa: BLE001
        pass
    # HISTORY log: include HIDDEN ("cleaned") runs too — their closes (incl. stop-loss) are part
    # of the record and must not disappear from the log just because the running view was
    # decluttered via delete-closed. (delete-closed only hides; the positions are kept.)
    sessions = db.list_paper_sessions()
    if not is_admin:
        sessions = [s for s in sessions if s.get("owner") == username]
    label_by_id = {s["id"]: (s.get("label") or f"#{s['id']}") for s in sessions}
    rows: List[dict] = []
    for s in sessions:
        for p in db.list_paper_positions("closed", session_id=s["id"]):
            if not p.get("closedAt"):
                continue
            cap = float(p.get("capital") or 0.0)
            pnl = float(p.get("realizedPnl") or 0.0)
            rows.append({
                "source": "engine",  # Trading Engine (demo paper session)
                "mode": "demo", "symbol": p.get("symbol"), "name": p.get("name"),
                "entryPrice": p.get("entryPrice"), "closePrice": p.get("closePrice"),
                "capital": round(cap, 2), "pnl": round(pnl, 2),
                "pnlPct": round((pnl / cap * 100.0) if cap > 0 else 0.0, 2),
                "closedAt": p.get("closedAt"),
                "reason": p.get("closeReason") or "manual",
                "session": label_by_id.get(s["id"]),
            })
    # LIVE closes the app performed/logged (best-effort; OCO auto-fills not yet reconciled).
    try:
        for r in db.list_runs_log(username=username, mode="live", status="closed", limit=lim):
            if not r.get("closed_at"):
                continue
            # %P&L / amount for EVERY live row (winners AND losers). The manual-sell path logs
            # exit price without pnl, so derive both from entry→exit when they're missing.
            ep, xp, qy = r.get("entry_price"), r.get("exit_price"), r.get("qty")
            pnl_v, pct_v = r.get("pnl"), r.get("pnl_pct")
            try:
                if pct_v is None and ep and xp:
                    pct_v = (float(xp) - float(ep)) / float(ep) * 100.0
                if pnl_v is None and ep and xp and qy:
                    pnl_v = (float(xp) - float(ep)) * float(qy)
            except (TypeError, ValueError, ZeroDivisionError):
                pass
            rows.append({
                # A live runs_log row is a Signal Bot close when it carries a bot_id; otherwise
                # it's a Trading Engine live close (manual buy / promoted run).
                "source": ("signal_bot" if r.get("bot_id") is not None else "engine"),
                "mode": "live", "symbol": r.get("symbol"), "name": None,
                "entryPrice": ep, "closePrice": xp,
                "capital": None,
                "pnl": (round(float(pnl_v), 2) if pnl_v is not None else None),
                "pnlPct": (round(float(pct_v), 2) if pct_v is not None else None),
                "closedAt": r.get("closed_at"),
                # reason from the exchange reconcile (stop_loss | take_profit | manual); "live"
                # for older rows the app closed before reconcile existed. orderId = the matched fill.
                "reason": (r.get("close_reason") or "live"),
                "orderId": r.get("close_order_id"),
                "session": (r.get("source") or "live"),
            })
    except Exception:  # noqa: BLE001 — the demo log must render even if the live log read hiccups
        pass
    # AUTOPILOTS ("טיסים") — closed pilot positions (sim + live) across all the user's pilots.
    try:
        for a in db.list_closed_autopilot_positions(username, limit=lim):
            if not a.get("closed_at"):
                continue
            ep, xp, qy = a.get("entry_price"), a.get("exit_price"), a.get("qty")
            pnl_v = a.get("realized_pnl")
            pct_v = None
            try:
                if ep and xp:
                    pct_v = (float(xp) - float(ep)) / float(ep) * 100.0
                if pnl_v is None and ep and xp and qy:
                    pnl_v = (float(xp) - float(ep)) * float(qy)
            except (TypeError, ValueError, ZeroDivisionError):
                pass
            rows.append({
                "source": "autopilot",
                # a pilot position is 'live' only when it was a real fill; sim → demo bucket.
                "mode": ("live" if str(a.get("mode")) == "live" else "demo"),
                "symbol": a.get("symbol"), "name": a.get("pilot_id"),
                "entryPrice": ep, "closePrice": xp, "capital": None,
                "pnl": (round(float(pnl_v), 2) if pnl_v is not None else None),
                "pnlPct": (round(float(pct_v), 2) if pct_v is not None else None),
                "closedAt": a.get("closed_at"),
                "reason": "autopilot",
                "session": a.get("pilot_id"),
            })
    except Exception:  # noqa: BLE001 — autopilot read must never break the log
        pass
    rows.sort(key=lambda x: str(x.get("closedAt") or ""), reverse=True)
    return {"rows": rows[:lim]}


async def _force_close_run(sid: int, reason: str = "daily_reset") -> float:
    """Close a whole run now at market (used by the daily-reset cycle). Returns realized P&L."""
    session = db.get_paper_session_by_id(sid)
    if not session or session.get("status") != "running":
        return 0.0
    open_positions = db.list_paper_positions("open", session_id=sid)
    pnl = 0.0
    if open_positions:
        prices = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in open_positions])
        marked = paper.mark_to_market(open_positions, prices)
        pnl = float(marked.get("totalPnl") or 0.0)
        _close_paper_positions(marked["positions"], reason=reason)
    db.update_paper_session_row(sid, status="stopped", pending_decision=False,
                                closed_at=paper.now_iso(), stoppedReason=reason)
    return pnl


async def _open_run(owner: str, *, capital: float, daily_target: float, behavior: str,
                    tiers: list, max_positions: int, strategy: str, buckets: list,
                    stop_loss_enabled: bool = False, stop_loss_mode: str = "amount",
                    stop_loss_value: float = 0.0, label: Optional[str] = None,
                    symbols: Optional[List[str]] = None) -> Optional[int]:
    """Open one demo run for ``owner`` and return its session id, or None if no
    tradeable signals are available right now. Shared by the manual start endpoint
    and the auto-run scheduler. Does NOT check entitlements — callers do that."""
    behavior = behavior if behavior in ("stop", "ask") else "ask"
    tiers = [t for t in (tiers or []) if t in paper.TRADEABLE_TIERS] or list(paper.DEFAULT_TIERS)
    capital = max(1.0, float(capital or 1000.0))
    max_positions = max(1, min(20, int(max_positions or 5)))
    strat = strategy if strategy in sig_scanner.STRATEGY_PARAMS else sig_scanner.DEFAULT_STRATEGY
    signals = await _signals_for_buckets(buckets, strat)
    if not signals:
        return None
    pool = paper.select_picks(signals, tiers, max(max_positions, paper.PREVIEW_LIMIT))
    if symbols:
        wanted = set(symbols)
        picks = [s for s in pool if s.get("symbol") in wanted]
    else:
        picks = pool[:max_positions]
    if not picks:
        return None
    # Open STRICTLY at fresh live prices from the same source the position is later
    # marked against — the daily-scan close can be hours old, which would otherwise
    # show as instant fake unrealized profit. A pick we can't price live is skipped
    # (never opened at a stale scan close).
    try:
        fresh = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in picks])
    except Exception:  # noqa: BLE001
        fresh = {}
    picks = [p for p in picks if float(fresh.get(p.get("symbol")) or 0.0) > 0]
    if not picks:
        return None
    # Seed the display cache with these exact open-time prices so the FIRST
    # dashboard mark equals entry (zero P&L, no stale-cache jitter).
    ex.seed_prices({p["symbol"]: fresh[p["symbol"]] for p in picks})
    opened_at = paper.now_iso()
    run_label = (label or "").strip() or sig_scanner.STRATEGY_PARAMS.get(strat, {}).get("label", strat)
    sid = db.create_paper_session(
        label=run_label, strategy=strat, capital=capital,
        daily_target=max(0.0, float(daily_target or 0.0)), target_behavior=behavior,
        tiers=tiers, max_positions=max_positions, started_at=opened_at,
        take_profit_enabled=False, take_profit_pct=5.0, owner=owner,
        stop_loss_enabled=bool(stop_loss_enabled),
        stop_loss_mode=(stop_loss_mode if stop_loss_mode in ("amount", "pct") else "amount"),
        stop_loss_value=max(0.0, float(stop_loss_value or 0.0)),
    )
    positions = paper.size_positions(capital, picks, opened_at, entry_prices=fresh)
    db.insert_paper_positions(positions, session_id=sid)
    for p in positions:
        db.add_activity("demo", "open", p["symbol"], name=p.get("name"), tier=p.get("tier"),
                        direction="long", qty=float(p["qty"]), price=float(p["entryPrice"]),
                        cost=float(p["capital"]), ts=opened_at)
    db.incr_usage(owner, "profit_run")
    db.add_loyalty(owner, "profit_run", 3)
    logger.info("Auto/Manual paper run %d opened for %s (%s): %d positions, capital %.2f",
                sid, owner, strat, len(positions), capital)
    return sid


@router.post("/exchange/paper/start")
async def paper_start(body: PaperStartInput, who: tuple[str, bool] = Depends(viewer)):
    """Open a NEW demo session in parallel with any existing ones (no reset)."""
    # ── Tier gate: Profit Engine access + runs/day + invest cap ──
    from app.services import plans
    ent = plans.entitlements(db.get_user(who[0]))
    if not ent.get("profitEngine"):
        raise HTTPException(403, "The Trading Engine is included with Pro, or unlock full access with a one-time purchase.")
    runs_per_day = ent.get("profitRunsPerDay") or 0
    if not who[1]:  # admins are unlimited
        used = db.get_usage(who[0], "profit_run")
        if used >= runs_per_day:
            raise HTTPException(429, f"Daily Trading Engine limit reached ({runs_per_day}/day). Upgrade or unlock for more.")
        cap = ent.get("profitInvestCap")
        if cap is not None and float(body.capital or 0) > float(cap):
            raise HTTPException(403, f"Your plan caps a run at ${int(cap):,}. Unlock full access (one-time $500) to invest more.")

    behavior = body.targetBehavior if body.targetBehavior in ("stop", "ask") else "ask"
    tiers = [t for t in body.tiers if t in paper.TRADEABLE_TIERS] or list(paper.DEFAULT_TIERS)
    capital = max(1.0, float(body.capital or 1000.0))
    max_positions = max(1, min(20, int(body.maxPositions or 5)))
    strat = body.strategy if body.strategy in sig_scanner.STRATEGY_PARAMS else sig_scanner.DEFAULT_STRATEGY
    # Crypto comes from the fast background cache; other domains are scanned on
    # demand (best-effort) so the domain picker works.
    signals = await _signals_for_buckets(body.buckets, strat)
    if not signals:
        raise HTTPException(400, "Daily scan isn't ready yet — tap + to run it, then try again in a moment.")
    pool = paper.select_picks(signals, tiers, max(max_positions, paper.PREVIEW_LIMIT))
    if body.symbols:
        wanted = set(body.symbols)
        picks = [s for s in pool if s.get("symbol") in wanted]
    else:
        picks = pool[:max_positions]
    # Compliance guard (BTC-only): no-op unless the owners turned the flag on; then a
    # restricted client's DEMO session is limited to Bitcoin picks too (so the demo
    # reflects the same scope as live). Owners are exempt.
    from app.core.compliance import is_btc_pair, is_restricted_client
    if db.get_btc_only_cached() and is_restricted_client(who[0]):
        picks = [s for s in picks if is_btc_pair(s.get("symbol"))]
    if not picks:
        raise HTTPException(400, "No tradeable crypto signals found for the chosen tiers right now.")
    # Open STRICTLY at fresh live prices from the same source the position is later
    # marked against — the cached scan close can be hours old, which would otherwise
    # show as instant fake unrealized profit. A pick we can't price live is skipped
    # (never opened at a stale scan close).
    try:
        fresh = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in picks])
    except Exception:  # noqa: BLE001
        fresh = {}
    picks = [p for p in picks if float(fresh.get(p.get("symbol")) or 0.0) > 0]
    if not picks:
        raise HTTPException(503, "Couldn't fetch live prices to open at right now — try again in a moment.")
    # Seed the display cache with these exact open-time prices so the FIRST
    # dashboard mark equals entry (zero P&L, no stale-cache jitter).
    ex.seed_prices({p["symbol"]: fresh[p["symbol"]] for p in picks})
    opened_at = paper.now_iso()
    label = (body.label or "").strip() or sig_scanner.STRATEGY_PARAMS.get(strat, {}).get("label", strat)
    sid = db.create_paper_session(
        label=label, strategy=strat, capital=capital,
        daily_target=max(0.0, float(body.dailyTarget or 0.0)), target_behavior=behavior,
        tiers=tiers, max_positions=max_positions, started_at=opened_at,
        take_profit_enabled=body.takeProfitEnabled,
        take_profit_pct=max(0.1, min(1000.0, float(body.takeProfitPct or 5.0))),
        owner=who[0],
        stop_loss_enabled=bool(body.stopLossEnabled),
        stop_loss_mode=(body.stopLossMode if body.stopLossMode in ("amount", "pct") else "amount"),
        stop_loss_value=max(0.0, float(body.stopLossValue or 0.0)),
    )
    positions = paper.size_positions(capital, picks, opened_at, entry_prices=fresh)
    db.insert_paper_positions(positions, session_id=sid)
    for p in positions:
        db.add_activity("demo", "open", p["symbol"], name=p.get("name"), tier=p.get("tier"),
                        direction="long", qty=float(p["qty"]), price=float(p["entryPrice"]),
                        cost=float(p["capital"]), ts=opened_at)
    db.incr_usage(who[0], "profit_run")
    db.add_loyalty(who[0], "profit_run", 3)  # gamification: reward running the engine
    logger.info("Paper session %d started by %s (%s): %d positions, capital %.2f", sid, who[0], strat, len(positions), capital)
    return await _build_paper_sessions(who[0], who[1])


@router.get("/exchange/paper/autorun")
async def paper_autorun_get(who: tuple[str, bool] = Depends(viewer)):
    """The caller's in-app auto-run config (the Profit Engine scheduler)."""
    return {"config": db.get_autorun(who[0])}


@router.post("/exchange/paper/autorun")
async def paper_autorun_set(body: dict, who: tuple[str, bool] = Depends(viewer)):
    """Save the caller's auto-run config. Only user-settable keys are accepted;
    the scheduler maintains its own runtime state (bank, lastOpenedAt)."""
    cfg = db.set_autorun(who[0], body or {})
    return {"config": cfg}


@router.post("/exchange/paper/preview")
async def paper_preview(body: PaperPreviewInput):
    """Scan today's crypto signals and return top candidates (no positions opened)."""
    tiers = [t for t in body.tiers if t in paper.TRADEABLE_TIERS] or list(paper.DEFAULT_TIERS)
    max_positions = max(1, min(20, int(body.maxPositions or 5)))
    strat = body.strategy if body.strategy in sig_scanner.STRATEGY_PARAMS else sig_scanner.DEFAULT_STRATEGY
    signals = await _signals_for_buckets(body.buckets, strat)
    if not signals:
        return {"candidates": [], "maxPositions": max_positions, "tiers": tiers, "strategy": strat, "buckets": body.buckets, "notReady": True}
    candidates = paper.recommend_picks(signals, tiers, max_positions)
    return {"candidates": candidates, "maxPositions": max_positions, "tiers": tiers, "strategy": strat, "buckets": body.buckets, "notReady": False}


@router.post("/exchange/paper/close")
async def paper_close(body: PaperCloseInput, who: tuple[str, bool] = Depends(viewer)):
    """Close one position (by id) or the whole session. Never auto — user only."""
    if body.sessionId is None:
        raise HTTPException(400, "sessionId is required.")
    _require_owned(body.sessionId, who[0], who[1])
    open_positions = db.list_paper_positions("open", session_id=body.sessionId)
    if not open_positions:
        return await _build_paper_sessions(who[0], who[1])
    prices = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in open_positions])
    marked = paper.mark_to_market(open_positions, prices)
    targets = ([p for p in marked["positions"] if p["id"] == body.id] if body.id is not None
               else marked["positions"])
    _close_paper_positions(targets, reason="manual")
    if not db.list_paper_positions("open", session_id=body.sessionId):
        db.update_paper_session_row(body.sessionId, status="stopped", pending_decision=False, closed_at=paper.now_iso())
    return await _build_paper_sessions(who[0], who[1])


@router.post("/exchange/paper/close-profitable")
async def paper_close_profitable(body: PaperCloseInput, who: tuple[str, bool] = Depends(viewer)):
    """Close open positions currently in profit (or at their take-profit %), in one batch."""
    if body.sessionId is None:
        raise HTTPException(400, "sessionId is required.")
    session = _require_owned(body.sessionId, who[0], who[1])
    open_positions = db.list_paper_positions("open", session_id=body.sessionId)
    if not open_positions:
        return {**(await _build_paper_sessions(who[0], who[1])), "closedCount": 0}
    prices = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in open_positions])
    marked = paper.mark_to_market(open_positions, prices)
    tp_enabled = bool((session or {}).get("takeProfitEnabled"))
    tp_pct = float((session or {}).get("takeProfitPct") or 5.0)
    if tp_enabled and not body.all:
        # auto-harvest mode: only positions that reached their take-profit target
        winners = [p for p in marked["positions"]
                   if float(p.get("pnl") or 0.0) > 0 and float(p.get("pnlPct") or 0.0) >= tp_pct]
    else:
        # manual "close all in profit": every position currently in the green
        winners = [p for p in marked["positions"] if float(p.get("pnl") or 0.0) > 0]
    if winners:
        _close_paper_positions(winners, reason="take_profit")
    if not db.list_paper_positions("open", session_id=body.sessionId):
        db.update_paper_session_row(body.sessionId, status="stopped", pending_decision=False, closed_at=paper.now_iso())
    return {**(await _build_paper_sessions(who[0], who[1])), "closedCount": len(winners)}


@router.post("/exchange/paper/close-profitable-all")
async def paper_close_profitable_all(who: tuple[str, bool] = Depends(viewer)):
    """Close every in-profit position across the caller's running sessions, in one batch.

    Fetches prices once and rebuilds state once — so closing returns in about a
    second regardless of how many sessions are running, instead of one price
    fetch + full state rebuild per session. Scoped per user: an admin closes
    across all sessions; a regular user only across the sessions they own.
    """
    username, is_admin = who
    own_sessions = db.list_paper_sessions()
    if not is_admin:
        own_sessions = [s for s in own_sessions if s.get("owner") == username]
    own_ids = {s["id"] for s in own_sessions}
    open_positions = [p for p in db.list_paper_positions("open") if p.get("sessionId") in own_ids]
    if not open_positions:
        return {**(await _build_paper_sessions(username, is_admin)), "closedCount": 0}
    symbols = list({p["symbol"] for p in open_positions})
    prices = await run_in_threadpool(ex.fetch_prices, symbols)
    marked = paper.mark_to_market(open_positions, prices)
    winners = [p for p in marked["positions"] if float(p.get("pnl") or 0.0) > 0]
    if winners:
        _close_paper_positions(winners, reason="take_profit")
    # Stop any of the caller's running sessions that now have no open positions left.
    for s in own_sessions:
        if s.get("status") == "running" and not db.list_paper_positions("open", session_id=s["id"]):
            db.update_paper_session_row(s["id"], status="stopped", pending_decision=False, closed_at=paper.now_iso())
    return {**(await _build_paper_sessions(username, is_admin)), "closedCount": len(winners)}


@router.post("/exchange/paper/close-all-active")
async def paper_close_all_active(who: tuple[str, bool] = Depends(viewer)):
    """Close EVERY open position (winners AND losers) across the caller's OWN
    running sessions, then stop the emptied sessions. Owner-scoped even for an
    admin — never touches another user's run. User-initiated only (never auto).
    Mirrors close-profitable-all but without the in-profit filter."""
    username, is_admin = who
    own_sessions = [s for s in db.list_paper_sessions() if s.get("owner") == username]
    own_ids = {s["id"] for s in own_sessions}
    open_positions = [p for p in db.list_paper_positions("open") if p.get("sessionId") in own_ids]
    if not open_positions:
        return {**(await _build_paper_sessions(username, is_admin)), "closedCount": 0}
    symbols = list({p["symbol"] for p in open_positions})
    prices = await run_in_threadpool(ex.fetch_prices, symbols)
    marked = paper.mark_to_market(open_positions, prices)
    _close_paper_positions(marked["positions"], reason="manual")
    for s in own_sessions:
        if s.get("status") == "running" and not db.list_paper_positions("open", session_id=s["id"]):
            db.update_paper_session_row(s["id"], status="stopped", pending_decision=False, closed_at=paper.now_iso())
    return {**(await _build_paper_sessions(username, is_admin)), "closedCount": len(marked["positions"])}


@router.post("/exchange/paper/promote-intent")
async def paper_promote_intent(body: PaperCloseInput, who: tuple[str, bool] = Depends(viewer)):
    """Awareness only — the user is about to take this run live and will place the real
    orders themselves on their exchange. This NEVER trades; it just pings the admin so
    they know a live promotion is happening."""
    if body.sessionId is None:
        raise HTTPException(400, "sessionId is required.")
    session = _require_owned(body.sessionId, who[0], who[1])
    open_positions = db.list_paper_positions("open", session_id=body.sessionId)
    syms = ", ".join(p.get("symbol") for p in open_positions if p.get("symbol"))
    try:
        from app.services import telegram as tg
        tg.notify_admin(f"🚀 <b>Promote to live</b>\n{db.display_name(who[0])} is taking run "
                        f"#{body.sessionId} live ({syms or 'no open positions'}). "
                        f"Orders are placed manually on the exchange. app.strateteach.com")
        # The acting admin's own Telegram.
        tg.notify_user(who[0], f"🚀 <b>Promote to live</b>\nYour run #{body.sessionId} ({syms or 'no open positions'}) — "
                               f"place the orders on the Exchange screen. app.strateteach.com")
    except Exception:
        pass
    return {"ok": True}


@router.post("/exchange/paper/decision")
async def paper_decision(body: PaperDecisionInput, who: tuple[str, bool] = Depends(viewer)):
    """Resolve a pending 'target reached — stop or keep going?' decision."""
    if body.sessionId is None:
        raise HTTPException(400, "sessionId is required.")
    session = _require_owned(body.sessionId, who[0], who[1])
    open_positions = db.list_paper_positions("open", session_id=body.sessionId)
    if body.action == "stop":
        if open_positions:
            prices = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in open_positions])
            marked = paper.mark_to_market(open_positions, prices)
            _record_target_event(session, marked, body.sessionId)
            _close_paper_positions(marked["positions"], reason="target_hit")
        db.update_paper_session_row(body.sessionId, status="stopped", pending_decision=False, closed_at=paper.now_iso())
    else:
        if open_positions:
            prices = await run_in_threadpool(ex.fetch_prices, [p["symbol"] for p in open_positions])
            marked = paper.mark_to_market(open_positions, prices)
            _record_target_event(session, marked, body.sessionId)
        db.update_paper_session_row(body.sessionId, pending_decision=False, acknowledged=True)
    return await _build_paper_sessions(who[0], who[1])


@router.post("/exchange/paper/delete")
async def paper_delete(body: PaperDeleteInput, who: tuple[str, bool] = Depends(viewer)):
    """Hide one demo session from the user's list. We DON'T hard-delete it: its
    realized P&L stays counted in the dashboard totals (the data the user/admin
    needs is kept) — the session is just marked hidden so it leaves the list."""
    if body.sessionId is None:
        raise HTTPException(400, "sessionId is required.")
    _require_owned(body.sessionId, who[0], who[1])
    db.update_paper_session_row(body.sessionId, hidden=True)
    return await _build_paper_sessions(who[0], who[1])


@router.post("/exchange/paper/reset")
async def paper_reset(who: tuple[str, bool] = Depends(viewer)):
    """Clear demo sessions. A regular user clears only their own; an admin clears all."""
    username, is_admin = who
    if is_admin:
        db.reset_paper()
    else:
        for s in db.list_paper_sessions():
            if s.get("owner") == username:
                db.delete_paper_session(s["id"])
    return await _build_paper_sessions(username, is_admin)


@router.get("/exchange/paper/history")
async def paper_history():
    history = db.list_target_events()
    return {"history": history, "stats": paper.history_stats(history)}
