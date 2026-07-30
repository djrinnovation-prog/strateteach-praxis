"""In-app auto-run scheduler for the Profit Engine.

A minute-polling background loop (mirrors the daily_scan / telegram loops). For
each user who turned auto-run on, it:
  - marks their runs to market (which auto-closes any run that hit its target), then
  - opens a fresh run when due, honouring their mode (interval / count), the
    "only if capital is available" guard, and "reinvest" (compounding).

No external token or browser is needed — this replaces the external scheduled task.
All work is best-effort and wrapped so one user (or one bad tick) can never crash
the loop or the app.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app import database as db

logger = logging.getLogger("algo770")

POLL_SECONDS = 60


def _il_now() -> datetime:
    """Current time in Israel (for the admin daily-reset boundary)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Asia/Jerusalem"))
    except Exception:  # noqa: BLE001 — tzdata missing → fall back to UTC
        return datetime.now(timezone.utc)


def _parse(ts):
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(str(ts))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _final_value(sid: int, capital: float) -> float:
    """A closed run's resulting capital = base capital + realized P&L."""
    try:
        closed = db.list_paper_positions("closed", session_id=sid)
        realized = sum(float(p.get("realizedPnl") or 0.0) for p in closed)
        return float(capital) + realized
    except Exception:  # noqa: BLE001
        return float(capital)


async def _tick_user(entry: dict) -> None:
    # Lazy import to avoid a circular import at module load time.
    from app.api.routes.paper import _open_run, _build_paper_sessions

    username = entry["username"]
    cfg = entry["autorun"]
    if not cfg.get("enabled"):
        return

    # 1. Mark this user's runs to market — this is what triggers auto-close on target.
    try:
        await _build_paper_sessions(username, False)
    except Exception as exc:  # noqa: BLE001
        logger.warning("autorun: mark failed for %s: %s", username, exc)

    # Re-read sessions + config (the mark may have just closed a run).
    sessions = [s for s in db.list_paper_sessions() if s.get("owner") == username]
    cfg = db.get_autorun(username)
    if not cfg.get("enabled"):
        return

    def _is_auto(s):
        return str(s.get("label") or "").startswith("Auto ")

    auto_running = [s for s in sessions if _is_auto(s) and s.get("status") == "running"]

    user = db.get_user(username)
    is_admin = bool(user and user.get("role") == "admin")

    # 1b. Daily reset (ADMIN-only): once a day, after 00:01 Israel time, close
    #     yesterday's auto-runs and let fresh ones open — a clean daily cycle.
    if cfg.get("dailyReset") and is_admin:
        il = _il_now()
        today = il.strftime("%Y-%m-%d")
        if not cfg.get("lastResetDay"):
            db.set_autorun(username, {"lastResetDay": today}, internal=True)  # baseline, no close
            cfg["lastResetDay"] = today
        elif cfg.get("lastResetDay") != today and il.hour == 0 and il.minute >= 1:
            from app.api.routes.paper import _force_close_run
            closed = 0
            for s in auto_running:
                try:
                    await _force_close_run(int(s["id"]), "daily_reset")
                    closed += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("autorun daily-reset close failed (%s): %s", s.get("id"), exc)
            db.set_autorun(username, {"lastResetDay": today, "bank": 0.0, "lastSid": None,
                                      "lastOpenedAt": None}, internal=True)
            cfg.update({"lastResetDay": today, "bank": 0.0, "lastSid": None, "lastOpenedAt": None})
            auto_running = []
            try:
                from app.services import telegram as tg
                tg.notify_admin(f"🌅 <b>Auto-run daily reset</b>\nClosed {closed} run(s); reopening fresh for {today}. app.strateteach.com")
            except Exception:  # noqa: BLE001
                pass

    # 2. Reinvest: once our last auto-run has closed, compound its result into the bank.
    last_sid = cfg.get("lastSid")
    if cfg.get("reinvest") and last_sid:
        last = db.get_paper_session_by_id(int(last_sid))
        if last and last.get("status") != "running":
            new_bank = _final_value(int(last_sid), float(last.get("capital") or cfg.get("capital") or 0.0))
            db.set_autorun(username, {"bank": round(new_bank, 2), "lastSid": None}, internal=True)
            cfg["bank"] = round(new_bank, 2)
            cfg["lastSid"] = None

    # 3. "Only if capital available": don't stack a new run while one is still open.
    if cfg.get("onlyIfCapitalAvailable") and auto_running:
        return

    # 4. Is a new run due?
    now = datetime.now(timezone.utc)
    mode = cfg.get("mode") or "interval"
    if mode == "count":
        due = int(cfg.get("count") or 0) > 0
    else:
        last_open = _parse(cfg.get("lastOpenedAt"))
        interval = max(1, int(cfg.get("intervalMinutes") or 60))
        due = last_open is None or (now - last_open).total_seconds() >= interval * 60
    if not due:
        return

    # 5. Capital to deploy (reinvest → grown bank; otherwise the configured base).
    capital = float(cfg.get("capital") or 1000.0)
    if cfg.get("reinvest") and float(cfg.get("bank") or 0.0) > 0:
        capital = float(cfg.get("bank"))
    if capital < 1.0:
        return  # no capital available

    # 6. Entitlement guard — free users keep their per-day cap / invest cap; admins unlimited.
    try:
        from app.services import plans
        ent = plans.entitlements(user)
        if not ent.get("profitEngine"):
            return
        if not is_admin:
            if db.get_usage(username, "profit_run") >= (ent.get("profitRunsPerDay") or 0):
                return
            inv_cap = ent.get("profitInvestCap")
            if inv_cap is not None and capital > float(inv_cap):
                capital = float(inv_cap)
    except Exception as exc:  # noqa: BLE001
        logger.warning("autorun: entitlement check failed for %s: %s", username, exc)
        return

    # 7. Open the run.
    behavior = "stop" if cfg.get("autoCloseOnTarget", True) else "ask"
    label = "Auto " + now.strftime("%H:%M")
    try:
        sid = await _open_run(
            username, capital=capital, daily_target=float(cfg.get("dailyTarget") or 0.0),
            behavior=behavior, tiers=cfg.get("tiers") or ["breaking_out", "near_breakout"],
            max_positions=int(cfg.get("maxPositions") or 5), strategy=cfg.get("strategy") or "bot8c",
            buckets=cfg.get("buckets") or ["crypto"],
            stop_loss_enabled=bool(cfg.get("stopLossEnabled")),
            stop_loss_mode=cfg.get("stopLossMode") or "amount",
            stop_loss_value=float(cfg.get("stopLossValue") or 0.0),
            label=label,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("autorun: open failed for %s: %s", username, exc)
        return
    if not sid:
        return  # no tradeable signals right now — try again next tick

    patch = {"lastOpenedAt": now.isoformat(), "lastSid": sid}
    if cfg.get("reinvest"):
        patch["bank"] = round(capital, 2)
    if mode == "count":
        remaining = int(cfg.get("count") or 0) - 1
        patch["count"] = max(0, remaining)
        if remaining <= 0:
            patch["enabled"] = False  # finished the requested batch
    db.set_autorun(username, patch, internal=True)
    logger.info("autorun: opened run %s for %s (capital %.2f, %s)", sid, username, capital, behavior)
    # Telegram alert (admin's own auto-runs) so the admin can follow it live.
    if is_admin:
        try:
            from app.services import telegram as tg
            tg.notify_admin(f"🔁 <b>Auto-run opened</b> — {label} · capital ${capital:,.2f}"
                            f"{' · auto-close at target' if behavior == 'stop' else ''}. app.strateteach.com")
        except Exception:  # noqa: BLE001
            pass


async def autorun_loop() -> None:
    logger.info("autorun loop started (poll %ss)", POLL_SECONDS)
    while True:
        try:
            for entry in db.list_autorun_enabled():
                try:
                    await _tick_user(entry)
                except Exception as exc:  # noqa: BLE001 — one user must not break the loop
                    logger.warning("autorun: tick failed for %s: %s", entry.get("username"), exc)
                await asyncio.sleep(2)  # space out work across users
        except Exception as exc:  # noqa: BLE001
            logger.warning("autorun loop error: %s", exc)
        await asyncio.sleep(POLL_SECONDS)


# How often the server re-evaluates open DEMO runs on its own. Tighter than the
# autorun loop (60s) because a stop-loss should not wait a full minute, but not so
# tight that it hammers the price cache (cached_prices has a 20s TTL).
STOP_MONITOR_SECONDS = 30


async def stop_monitor_loop() -> None:
    """DEMO-only safety net: re-evaluate every RUNNING paper run server-side on a short
    interval so a per-position stop-loss (and daily-target auto-close) fires even when
    nobody is watching the screen and auto-run is OFF.

    Why this exists — the bug it fixes: the per-position stop-loss is only ever evaluated
    as a *side effect* of a client state-read (GET /exchange/paper/sessions, polled ~18s
    and PAUSED by the browser whenever the tab is backgrounded). The only server-side
    evaluator was the autorun loop, which iterates *auto-run-enabled users only*. A manual
    run with auto-run disabled therefore had NO server-side evaluation — a position could
    fall well past its 2% stop and never close until the owner re-opened the screen.

    This loop closes that gap for ALL owners with a running run. It reuses
    ``_build_paper_sessions(owner, False)``, which marks the owner's runs to market and
    runs the existing stop-loss / target logic. It is paper-only: it never calls the
    exchange and never places a live order (LIVE positions are not auto-closed here).
    """
    from app.api.routes.paper import _build_paper_sessions
    logger.info("paper stop-monitor loop started (poll %ss)", STOP_MONITOR_SECONDS)
    while True:
        try:
            owners = sorted({
                s.get("owner") for s in db.list_paper_sessions()
                if s.get("status") == "running" and not s.get("hidden") and s.get("owner")
            })
            for owner in owners:
                try:
                    await _build_paper_sessions(owner, False)  # marks + runs the stop/target
                except Exception as exc:  # noqa: BLE001 — one owner must not break the loop
                    logger.warning("stop-monitor: mark failed for %s: %s", owner, exc)
                await asyncio.sleep(1)  # space out work across owners
        except Exception as exc:  # noqa: BLE001
            logger.warning("stop-monitor loop error: %s", exc)
        await asyncio.sleep(STOP_MONITOR_SECONDS)
