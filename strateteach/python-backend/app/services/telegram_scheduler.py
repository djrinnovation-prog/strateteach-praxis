"""Telegram daily digest scheduler.

A minute-polling background loop: when the saved Telegram config has
``scheduleEnabled`` on, it sends the daily digest once per day at the configured
``scheduleTime`` (HH:MM, interpreted in Israel time, falling back to UTC).

What it sends honours the per-config toggles:
  - notifySignals    → today's breakout/trend signals (from the cached daily scan)
  - notifyExcelDaily → the latest (or pinned) backtest run as an Excel file

Mirrors the daily_scan/demo_reminders loop pattern — no extra scheduler dep.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app import database as db
from app.services import telegram as tg

logger = logging.getLogger("algo770")


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Asia/Jerusalem")
    except Exception:  # noqa: BLE001 — tzdata missing → fall back to UTC
        return timezone.utc


def _parse_hhmm(s: str | None) -> tuple[int, int]:
    try:
        h, m = (s or "08:00").split(":")
        return max(0, min(23, int(h))), max(0, min(59, int(m)))
    except (TypeError, ValueError):
        return 8, 0


async def send_daily() -> dict:
    """Send the configured daily digest now. Returns a small summary."""
    cfg = db.get_telegram_config()
    if not cfg.get("botToken") or not cfg.get("chatId"):
        return {"ok": False, "message": "Not configured."}
    sent = []
    if cfg.get("notifySignals", True):
        try:
            scan = db.get_daily_scan() or {}
            r = await tg.notify_signals(scan.get("signals") or [])
            sent.append({"signals": r.get("ok"), "msg": r.get("message")})
        except Exception as exc:  # noqa: BLE001
            sent.append({"signals": False, "msg": str(exc)[:120]})
    if cfg.get("notifyExcelDaily", True):
        try:
            r = await tg.send_excel_to_telegram(cfg["botToken"], cfg["chatId"], cfg.get("runIdOverride"))
            db.update_telegram_send_status(r.get("ok", False), r.get("message", ""))
            sent.append({"excel": r.get("ok"), "msg": r.get("message")})
        except Exception as exc:  # noqa: BLE001
            sent.append({"excel": False, "msg": str(exc)[:120]})
    return {"ok": True, "sent": sent}


async def _reconcile_live_closes(cap: int = 25) -> None:
    """Detect exchange-side (OCO / manual) closes for open live runs so the hourly
    report's LIVE-closes section is current. READ-ONLY and best-effort — any hiccup is
    swallowed so it can never delay or break the digest."""
    try:
        from fastapi.concurrency import run_in_threadpool
        from app.services import live_reconcile
        seen: list[str] = []
        for r in db.list_open_live_runs():
            un = r.get("username")
            if un and un not in seen:
                seen.append(un)
        for un in seen[:cap]:
            try:
                await run_in_threadpool(live_reconcile.reconcile_user, un)
            except Exception:  # noqa: BLE001
                pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("live-close reconcile skipped: %s", str(exc)[:160])


async def telegram_status_loop() -> None:
    """Send the admin status report at startup, then once an hour — but each time
    only when it actually changed (the signature dedupe keeps deploy restarts from
    spamming an identical report)."""
    from app.services import telegram_admin
    first = True
    while True:
        if first:
            # A short grace so the DB bootstrap + first sessions are in place; then
            # send immediately instead of waiting a full hour after a deploy.
            await asyncio.sleep(15)
            first = False
        else:
            await asyncio.sleep(3600)
        try:
            cfg = db.get_telegram_config()
            if not cfg.get("botToken") or not cfg.get("chatId"):
                continue
            # Freshen live closes first: run the READ-ONLY exchange reconcile for every
            # user with an open live run so stop-loss / take-profit OCO fills are detected
            # and stamped into runs_log BEFORE the report reads it. Best-effort, bounded,
            # off the event loop; places/cancels nothing (it's rate-limited internally).
            await _reconcile_live_closes()
            text, sig = telegram_admin.build_status_report()
            if db._get_singleton("telegram_status_sig", None) == sig:
                continue  # nothing changed since last send — stay quiet
            await tg.send_message(cfg["botToken"], cfg["chatId"], text)
            db._set_singleton("telegram_status_sig", sig)
            logger.info("Sent Telegram hourly status report.")
        except Exception as exc:  # noqa: BLE001
            logger.warning("telegram status loop error: %s", str(exc)[:200])


async def telegram_daily_loop() -> None:
    """Poll once a minute; fire the daily digest at the configured HH:MM."""
    tz = _tz()
    while True:
        await asyncio.sleep(60)
        try:
            cfg = db.get_telegram_config()
            if not cfg.get("scheduleEnabled") or not cfg.get("botToken") or not cfg.get("chatId"):
                continue
            hh, mm = _parse_hhmm(cfg.get("scheduleTime"))
            now = datetime.now(tz)
            today = now.date().isoformat()
            if db._get_singleton("telegram_daily_last", None) == today:
                continue  # already sent today
            # Fire once when we're AT or PAST the scheduled time and haven't sent
            # today. Exact-minute matching used to miss the whole day whenever the
            # process wasn't alive at that precise minute (e.g. a deploy/restart);
            # this catches up on the next poll instead.
            scheduled = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if now < scheduled:
                continue  # not yet time today
            await send_daily()
            db._set_singleton("telegram_daily_last", today)
            logger.info("Sent Telegram daily digest (%s).", today)
        except Exception as exc:  # noqa: BLE001
            logger.warning("telegram daily loop error: %s", str(exc)[:200])
