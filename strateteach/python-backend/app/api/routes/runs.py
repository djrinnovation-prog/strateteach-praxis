"""Backtest runs, their results/exports, and the dashboard summary."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from app import database as db
from app.backtest import runner
from app.core.security import current_user
from app.data.symbols import BUCKET_MAP
from app.services import exchange as ex
from app.services import paper_trading as paper
from app.models import (
    CsvExport,
    DashboardSummary,
    Run,
    RunInput,
    RunProgress,
    SymbolDetail,
)

router = APIRouter()


@router.get("/runs", response_model=List[Run], tags=["runs"])
def list_runs(_: str = Depends(current_user)):
    return db.list_runs()


@router.post("/runs", response_model=Run, status_code=201, tags=["runs"])
async def create_run(body: RunInput, username: str = Depends(current_user)):
    # "all" → run the backtest across EVERY asset class at once (the launcher's
    # "All assets" choice). Expand to the full bucket set, then validate.
    if any((b or "").lower() == "all" for b in body.buckets):
        body.buckets = list(BUCKET_MAP.keys())
    if not body.buckets:
        raise HTTPException(400, "At least one bucket is required.")
    for b in body.buckets:
        if b not in BUCKET_MAP:
            raise HTTPException(400, f"Unknown bucket: {b}")

    # ── Tier gate: backtest access + daily limit + per-run asset cap ──
    # Product OWNERS (Dan / Rafi / Yoav) are exempt: they need to validate strategies
    # and demo the product without burning a customer plan's quota.
    from app.core.security import is_owner
    from app.services import plans
    owner = is_owner(username)
    ent = plans.entitlements(db.get_user(username))
    if not owner and not ent.get("backtest"):
        raise HTTPException(403, "Backtesting is available on the Middle and Pro plans. Upgrade to run backtests.")
    per_day = ent.get("backtestPerDay") or 0
    used = db.get_usage(username, "backtest")
    if not owner and used >= per_day:
        raise HTTPException(429, f"Daily backtest limit reached ({per_day}/day on your plan). Buy credits or upgrade for more.")
    asset_cap = ent.get("backtestAssetCap")
    if not owner and asset_cap is not None and asset_cap > 0:
        body.symbolLimit = min(int(body.symbolLimit or 20), int(asset_cap))
        # An explicit symbol list bypasses symbolLimit, so cap it too.
        if body.symbols:
            body.symbols = body.symbols[:int(asset_cap)]

    # Backstop: clear stale ephemeral (unsaved) runs so they never accumulate, even
    # if a client closed the tab without saving/discarding. Only touches finished
    # unsaved runs older than the cutoff — never a saved run or an in-flight one.
    try:
        db.purge_unsaved_runs()
    except Exception:  # noqa: BLE001 — best-effort cleanup must never block a run
        pass

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    run = Run(
        id=run_id, name=body.name or f"Run {now[:10]}", status="pending",
        buckets=body.buckets, config=body.config, createdAt=now,
        completedSymbols=0, failedSymbols=0,
    )
    # Ephemeral by default — only persisted into the saved history when the user
    # explicitly hits "Save run" (POST /runs/{id}/save). It's still in the DB
    # transiently so progress/results/export work; the purge above discards it
    # if the user never saves.
    db.save_run(run)
    db.incr_usage(username, "backtest")
    db.add_loyalty(username, "backtest_run", 5)  # gamification: reward running backtests
    runner.start_run(run_id, body)
    return run


@router.get("/runs/{run_id}", response_model=Run, tags=["runs"])
def get_run(run_id: str, _: str = Depends(current_user)):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    return run


@router.post("/runs/{run_id}/save", response_model=Run, tags=["runs"])
def save_run_endpoint(run_id: str, _: str = Depends(current_user)):
    """Explicitly KEEP this run: flip it from ephemeral to saved so it appears in
    the history list and survives the unsaved-run purge. Idempotent."""
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    db.mark_run_saved(run_id)
    return db.get_run(run_id)


@router.delete("/runs/{run_id}", status_code=204, tags=["runs"])
def delete_run(run_id: str, _: str = Depends(current_user)):
    if not db.get_run(run_id):
        raise HTTPException(404, "Run not found.")
    runner.cancel_run(run_id)
    db.delete_run(run_id)


@router.get("/runs/{run_id}/results", tags=["results"])
def run_results(
    run_id: str,
    bucket: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("cagr"),
    sort_dir: Optional[str] = Query("desc"),
    _: str = Depends(current_user),
):
    if not db.get_run(run_id):
        raise HTTPException(404, "Run not found.")
    return db.get_results(run_id, bucket=bucket, sort_by=sort_by or "cagr", sort_dir=sort_dir or "desc")


@router.get("/runs/{run_id}/results/{symbol:path}", response_model=SymbolDetail, tags=["results"])
def symbol_result(run_id: str, symbol: str, _: str = Depends(current_user)):
    detail = db.get_symbol_detail(run_id, symbol)
    if not detail:
        raise HTTPException(404, "Symbol result not found.")
    result, equity_curve, trades = detail
    return SymbolDetail(symbol=symbol, result=result, equityCurve=equity_curve, trades=trades)


@router.get("/runs/{run_id}/progress", response_model=RunProgress, tags=["runs"])
def run_progress(run_id: str, _: str = Depends(current_user)):
    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    completed = run.completedSymbols or 0
    total = run.totalSymbols or 0
    return RunProgress(
        runId=run_id, status=run.status, totalSymbols=total,
        completedSymbols=completed, failedSymbols=run.failedSymbols or 0,
        currentSymbol=runner.get_current_symbol(run_id),
        estimatedSecondsRemaining=runner.get_estimated_remaining(run_id, completed, total),
    )


@router.get("/runs/{run_id}/export", response_model=CsvExport, tags=["results"])
def export_csv(run_id: str, bucket: Optional[str] = Query(None), _: str = Depends(current_user)):
    if not db.get_run(run_id):
        raise HTTPException(404, "Run not found.")
    results = db.get_results(run_id, bucket=bucket, sort_by="cagr", sort_dir="desc")
    if not results:
        raise HTTPException(404, "No results to export.")
    lines = ["Symbol,Name,Bucket,Total Return %,CAGR %,Max Drawdown %,Win Rate %,Sharpe,Trade Count"]
    for r in results:
        lines.append(
            f"{r.symbol},{r.name or ''},{r.bucket},{r.totalReturn:.2f},{r.cagr:.2f},"
            f"{r.maxDrawdown:.2f},{r.winRate:.2f},{r.sharpe:.4f},{r.tradeCount}"
        )
    return CsvExport(filename=f"run_{run_id[:8]}_{bucket or 'all'}.csv", data="\n".join(lines))


@router.get("/runs/{run_id}/export/xlsx", tags=["results"])
def export_xlsx(run_id: str, _: str = Depends(current_user)):
    from urllib.parse import quote

    from fastapi.responses import Response as FastAPIResponse

    run = db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    xlsx_bytes = _build_run_xlsx(run_id)
    if not xlsx_bytes:
        raise HTTPException(404, "No results to export.")

    filename = f"770_TD_{(run.name or run_id[:8]).replace(' ', '_').replace('/', '-')}.xlsx"
    ascii_name = "".join(
        c for c in filename.encode("ascii", "ignore").decode("ascii")
        if c.isprintable() and c not in '"\\;'
    ).strip("_") or f"770_TD_{run_id[:8]}.xlsx"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
    return FastAPIResponse(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disposition},
    )


def _build_run_xlsx(run_id: str) -> Optional[bytes]:
    """Multi-sheet workbook, one tab per bucket. Returns None if no results."""
    import io

    from openpyxl import Workbook

    results = db.get_results(run_id, sort_by="cagr", sort_dir="desc")
    if not results:
        return None
    by_bucket: dict[str, list] = {}
    for r in results:
        by_bucket.setdefault(r.bucket, []).append(r)

    wb = Workbook()
    wb.remove(wb.active)
    header = ["Symbol", "Name", "Total Return %", "CAGR %", "Max Drawdown %",
              "Win Rate %", "Sharpe", "Trade Count"]
    for bucket, rows in by_bucket.items():
        ws = wb.create_sheet(title=bucket[:31])
        ws.append(header)
        for r in rows:
            ws.append([r.symbol, r.name or "", round(r.totalReturn, 2), round(r.cagr, 2),
                       round(r.maxDrawdown, 2), round(r.winRate, 2), round(r.sharpe, 4), r.tradeCount])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/dashboard/summary", response_model=DashboardSummary, tags=["dashboard"])
def dashboard_summary(_: str = Depends(current_user)):
    return DashboardSummary(**db.get_dashboard_summary())


@router.get("/dashboard/live", tags=["dashboard"])
async def dashboard_live(tzOffset: int = 0, user: str = Depends(current_user)):
    """Live operational stats: active backtest runs, running demo sessions, and
    demo P&L by day/month/year.

    This is a PERSONAL card: demo P&L and live realized stats are ALWAYS scoped to
    the signed-in user — even for an admin — so an admin's own card never aggregates
    every user's P&L (the aggregate admin dashboards are separate surfaces).

    The demo P&L folds the *current unrealized* P&L of open positions into each
    bucket, so the headline matches the per-position view (a freshly green
    position moves the total). This is a read-only mark-to-market — it never
    closes, opens, or persists anything. ``open`` is exposed separately and
    ``pct`` is the P&L as a percent of invested basis for display.

    For the Home card we also expose a today-vs-00:01 view of the user's own demo
    portfolio VALUE (paper-account equity, not cumulative P&L): ``todayChange`` =
    current demo value − that value at the Israel day's first read, with
    ``dayStart`` the baseline and ``todayPct`` the % change. The baseline is
    snapshotted per (user, env=demo), independent of the live one, on the
    Israel-time (Asia/Jerusalem) day boundary.
    """
    u = db.get_user(user)
    is_admin = bool(u and u.get("role") == "admin")
    # Personal card → never aggregate, even for an admin (fixes the admin-card leak).
    demo = db.demo_pnl_stats(user, is_admin=False)
    demo = await _fold_open_demo_pnl(demo, user, is_admin=False)
    # Home DEMO line shows the user's demo TODAY P&L (realized + unrealized delta
    # for the Israel-time day) — NOT a portfolio-value snapshot. Commit 8aafc6a
    # tried a value-based "today" metric, but its "value" was cumulative trade
    # TURNOVER (Σ of every closed trade's capital, ~$5.46M), so V_now − dayStart
    # produced a multi-million-dollar garbage headline. todayChange is simply
    # demo["today"] (which already folds open positions' unrealized P&L). The %
    # base is left null pending a product decision on the correct denominator —
    # null beats wrong. The Israel-time day boundary (_il_now in database.py) is
    # unchanged and still governs the live REAL line's rollover.
    demo["todayChange"] = round(float(demo.get("today") or 0.0), 2)
    # % base: if the user has set a demo "deposited capital" (cost basis), show
    # their gain on that capital — demo total P&L (folds open unrealized) over the
    # cost basis. The base is the user's chosen denominator, NOT a turnover-derived
    # "value" (the 8aafc6a bug). If unset, todayPct stays null (null beats wrong).
    demo_cost_basis = db.get_cost_basis(user, "demo")
    demo["todayPct"] = (
        round((float(demo.get("total") or 0.0) / demo_cost_basis) * 100.0, 2)
        if demo_cost_basis and demo_cost_basis > 0 else None
    )
    # Echo the demo deposited capital (per user) so the Home card can prefill the
    # "set deposited capital" editor; null when unset. Per-user only (no aggregate).
    demo["costBasis"] = demo_cost_basis
    return {
        "activeRuns": db.count_running_runs(),
        # PERSONAL Home dashboard → the USER'S OWN running engines, even for admins.
        # (Passing is_admin here returned the GLOBAL count of everyone's sessions — the
        # owner saw "15 engines" that weren't his. The admin/telegram reports keep the
        # global count via their own is_admin=True calls; this per-user field is the fix.)
        "runningSessions": db.count_running_sessions(user, is_admin=False),
        "demo": demo,
        "live": db.live_realized_stats(username=user),
    }


async def _fold_open_demo_pnl(demo: dict, user: str, is_admin: bool) -> dict:
    """Add the current unrealized P&L of open demo positions into the realized
    buckets so the dashboard headline stays consistent with the per-position view.
    Pure display/aggregation — fetches public prices read-only and never mutates
    state. On any failure it falls back to the realized-only figures unchanged."""
    open_pnl = 0.0
    open_cost = 0.0
    try:
        open_pos = db.list_open_demo_positions(user, is_admin)
        if open_pos:
            syms = [p.get("symbol") for p in open_pos if p.get("symbol")]
            prices = await run_in_threadpool(ex.fetch_prices, syms)
            marked = paper.mark_to_market(open_pos, prices)
            open_pnl = float(marked.get("totalPnl") or 0.0)
            open_cost = float(marked.get("totalCost") or 0.0)
    except Exception:
        open_pnl = 0.0
        open_cost = 0.0
    realized_cost = float(demo.get("cost") or 0.0)
    out = dict(demo)
    out["open"] = round(open_pnl, 2)
    # Open positions are live now → their unrealized belongs to today/month/year/all.
    for k in ("total", "today", "month", "year"):
        out[k] = round(float(demo.get(k) or 0.0) + open_pnl, 2)
    # % is P&L relative to the capital actually at work — the demo analog of
    # "starting capital" (= currentValue − P&L). The OLD basis summed the capital
    # of every CLOSED trade ever opened, which double-counts reused capital (and,
    # for an admin, every user's deployments), so the base ballooned and a real
    # loss read as ≈0%. Use the capital currently invested (open positions);
    # fall back to the realized cost only when nothing is open. Guard a 0 base.
    basis = open_cost if open_cost > 0 else realized_cost
    out["pct"] = round((out["total"] / basis * 100.0), 2) if basis > 0 else 0.0
    # NOTE: 8aafc6a added out["value"] = (realized_cost + open_cost) + total as a
    # "portfolio value" here, but realized_cost + open_cost is cumulative trade
    # TURNOVER (every closed trade's capital summed), NOT account equity, so it
    # ballooned into the millions (~$5.46M) and produced a garbage Home headline.
    # It has been removed — the Home DEMO line uses demo["today"] (today's P&L),
    # never a value snapshot. Do not reintroduce a turnover-based "value".
    return out
