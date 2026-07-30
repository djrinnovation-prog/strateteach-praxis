"""Demo-tester auto-reminders.

Once a day, text each active demo tester how much time is left on their week
and their current tester score (to nudge usage + feedback). Mirrors the
daily_scan background-loop pattern — plain asyncio, no extra scheduler dep.

Safe no-op if SMS isn't configured or a tester has no phone.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app import database as db
from app.services import sms
from app.services import email as email_svc

logger = logging.getLogger("algo770")

APP_URL = "app.strateteach.com"
RUN_HOUR_UTC = 9  # ~daily late morning Israel time


def _time_left(expires_iso: str | None):
    """Return (days, hours) left, or None if expired/invalid."""
    if not expires_iso:
        return None
    try:
        exp = datetime.fromisoformat(expires_iso)
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    secs = (exp - datetime.now(timezone.utc)).total_seconds()
    if secs <= 0:
        return None
    return int(secs // 86400), int((secs % 86400) // 3600)


def send_demo_reminders() -> int:
    """Send one daily reminder to each active demo tester with time left, over the
    channels available: SMS (to their phone) AND — additively, consent-gated — EMAIL
    (to testers who opted into the email channel). Both are safe no-ops when their
    provider key is missing, so this runs fine with only one (or neither) configured.
    Returns how many testers had at least one channel queued."""
    sms_on = sms.is_configured()
    email_on = email_svc.email_configured()
    if not (sms_on or email_on):
        return 0
    sent = 0
    for d in db.list_demo_users():
        username = d.get("username")
        left = _time_left(d.get("demo_expires"))
        if not username or not left:
            continue
        days, hours = left
        try:
            score = db.tester_score(username)["score"]
        except Exception:  # noqa: BLE001
            score = 0
        user = db.get_user(username) or {}
        name = db.display_name(username)
        text = (
            f"Hi {name}! Your ALGO770 demo has {days}d {hours}h left. "
            f"Tester score: {score}/100 — keep using the app and sharing feedback to raise it. "
            f"{APP_URL}"
        )
        delivered = False
        # SMS — unchanged behaviour (needs a phone + a configured SMS sender).
        phone = user.get("phone")
        if sms_on and phone and sms.send_sms(phone, text):
            delivered = True
        # EMAIL — additive + STRICTLY consent-gated (only testers who enabled the email
        # channel + have an address on file). send_email_async is a no-op without a key.
        try:
            prefs = db.get_notif_prefs(username)
            if email_on and prefs.get("email") and prefs.get("emailTo"):
                if email_svc.send_email_async(prefs["emailTo"], "Strateteach — your demo access", text):
                    delivered = True
        except Exception as exc:  # noqa: BLE001 — one tester's email must never break the loop
            logger.warning("demo reminder email failed for %s: %s", username, exc)
        if delivered:
            sent += 1
    return sent


def _next_run(now: datetime) -> datetime:
    target = now.replace(hour=RUN_HOUR_UTC, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


async def demo_reminder_loop() -> None:
    """Fire once a day at RUN_HOUR_UTC; dedupe per calendar day across restarts."""
    while True:
        now = datetime.now(timezone.utc)
        await asyncio.sleep(max(60.0, (_next_run(now) - now).total_seconds()))
        try:
            today = datetime.now(timezone.utc).date().isoformat()
            if db._get_singleton("demo_reminder_last", None) == today:
                continue
            n = send_demo_reminders()
            db._set_singleton("demo_reminder_last", today)
            if n:
                logger.info("Sent %d demo reminder(s).", n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("demo reminder loop error: %s", str(exc)[:200])
