"""Demo-leaderboard broadcast — the message everyone receives, the manual admin
send, and the daily auto-send at 18:00 Israel time.

The message is built in ONE place (``build_message``) so the manual send (prefilled
in the admin panel) and the daily auto-send are identical, and the gamified score
always appears (the earlier bug was the score never making it into the text).

Structure (Hebrew, the user-facing audience):
  • Header.
  • Every demo user, ranked by score, "name — N pts" so each user sees themselves.
  • Top 10 ALSO show their profit ($) — but only when positive (we never show a loss).
  • Below the top 10: score only + a "keep practising to climb" nudge.
  • A fixed incentive note: more points → a lifetime discount on the real account.

Channel: in-app broadcast to everyone (always). SMS/WhatsApp is opt-in only — a
daily paid blast would be expensive/spammy, so the auto-send is in-app by default.

Scheduling: 18:00 Asia/Jerusalem (DST-aware via zoneinfo; falls back to a fixed
UTC+3 offset if the tz database is unavailable). Mirrors the daily_scan loop.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from app import database as db

logger = logging.getLogger("algo770")

SEND_HOUR_IL = 18  # 18:00 local Israel time

try:  # DST-aware Israel time when the tz database is present (normal on Linux)
    from zoneinfo import ZoneInfo
    _IL = ZoneInfo("Asia/Jerusalem")
except Exception:  # noqa: BLE001 — fall back to a fixed offset (IDT, UTC+3)
    _IL = timezone(timedelta(hours=3))

# Exact incentive line requested — keep verbatim.
INCENTIVE_HE = "ככל שמשתמש דמו צובר יותר נקודות, החשבון האמיתי שלו יקבל הנחה לכל החיים…"

_MEDALS = {0: "🥇", 1: "🥈", 2: "🥉"}


def _fmt_usd0(v: float) -> str:
    return f"${abs(v):,.0f}"


def build_message() -> str:
    """The canonical leaderboard broadcast text (also used to prefill the admin
    panel, so manual + automatic sends are byte-identical)."""
    rows = db.demo_leaderboard()  # sorted by score desc
    lines = ["🏆 לוח התוצאות של ALGO770 (דמו)", "", "הדירוג שלכם לפי נקודות:"]
    if not rows:
        lines.append("— אין עדיין בודקי דמו —")
    for i, r in enumerate(rows):
        rank = _MEDALS.get(i, f"#{i + 1}")
        name = r.get("username") or "—"
        score = r.get("score") or 0
        if i < 10:
            # Top 10 also show profit ($) — but only when positive (never a loss).
            pnl = float(r.get("pnl") or 0)
            extra = f" · רווח +{_fmt_usd0(pnl)}" if pnl > 0 else ""
            lines.append(f"{rank} {name} — {score} נק׳{extra}")
        else:
            lines.append(f"{rank} {name} — {score} נק׳")
    if len(rows) > 10:
        lines.append("")
        lines.append("מקומות 11 ומטה: המשיכו לתרגל ולסחור בדמו כדי לעלות בדירוג 💪")
    lines.append("")
    lines.append(INCENTIVE_HE)
    return "\n".join(lines)


def _sender() -> str:
    """Username the in-app broadcast is posted as (the main admin if present)."""
    if db.get_user("admin"):
        return "admin"
    try:
        db.ensure_assistant_user()
    except Exception:  # noqa: BLE001
        pass
    return "assistant"


def send_leaderboard(*, sms: bool = False, channel: str = "sms", text: str | None = None) -> dict:
    """Broadcast the leaderboard to ALL users. In-app always; SMS/WhatsApp opt-in.

    ``text`` overrides the message (the admin may tweak it before a manual send);
    otherwise the canonical ``build_message`` text is used."""
    body = (text or "").strip() or build_message()
    db.chat_send(_sender(), None, body)  # in-app broadcast (to_user=None → everyone)
    result: dict = {"inApp": True, "sms": None}
    if sms:
        from app.services import sms as sms_svc
        if not sms_svc.channel_configured(channel):
            result["sms"] = {"sent": 0, "total": 0, "channel": channel, "error": "channel not configured"}
            return result
        recipients = db.broadcast_recipients("all")
        sent = 0
        for r in recipients:
            to = r["whatsappTo"] if channel == "whatsapp" else r["phone"]
            if to and sms_svc.send(channel, to, body):
                sent += 1
        result["sms"] = {"sent": sent, "total": len(recipients), "channel": channel}
    return result


def _next_run(now_utc: datetime) -> datetime:
    """The next 18:00 Israel time at/after ``now``, returned in UTC (DST-aware)."""
    now_il = now_utc.astimezone(_IL)
    target = now_il.replace(hour=SEND_HOUR_IL, minute=0, second=0, microsecond=0)
    if target <= now_il:
        target += timedelta(days=1)
    return target.astimezone(timezone.utc)


async def leaderboard_loop() -> None:
    """Fire once a day at 18:00 Israel time; dedupe per Israel calendar day across
    restarts. In-app broadcast only (a daily SMS/WhatsApp blast is too costly)."""
    while True:
        now = datetime.now(timezone.utc)
        await asyncio.sleep(max(60.0, (_next_run(now) - now).total_seconds()))
        try:
            today_il = datetime.now(_IL).date().isoformat()
            if db._get_singleton("leaderboard_last", None) == today_il:
                continue
            send_leaderboard(sms=False)
            db._set_singleton("leaderboard_last", today_il)
            logger.info("daily demo leaderboard broadcast sent (18:00 IL)")
        except Exception as exc:  # noqa: BLE001 — never let a send crash the loop
            logger.warning("leaderboard loop error: %s", str(exc)[:200])
