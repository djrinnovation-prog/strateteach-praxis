"""Recurring scheduled reports — delivered over the app's real notify/WhatsApp path.

Four background jobs, all on the same plain-asyncio pattern as ``daily_scan`` /
``leaderboard`` (a ``while True`` that computes its next fire time and sleeps to
it). Every time here is **Israel time (Asia/Jerusalem)**, DST-aware via zoneinfo
with a fixed UTC+3 fallback — identical to ``leaderboard.py``.

  1. Breakouts report      — daily 09:00 IL → opted-in users + the team (owners).
                             Real Bot-8 breakout scan (the cached ``daily_scan``,
                             the same snapshot ``run_breakout_scan(["crypto"])``
                             produces at 00:05 UTC).
  2. Users + portfolio     — EVERY 3 HOURS (IL-aligned) → owners. Mirrors the Telegram admin
                             report (``telegram_admin.build_status_report``): who's
                             online, new requests/signups, live + demo P&L today,
                             open positions, demo testers expiring. Real data,
                             de-duped by content signature like the Telegram one.
  3. Open requests         — daily 12:00 IL → owners. Currently-open Requests-Portal
                             tickets (count + subject / user / age).
  4. Closed-today requests — daily 00:05 IL → owners. Requests resolved during the
                             Israel day that just ended.

Delivery is via ``notify.notify_user`` — strictly per-user (each recipient's own
notif prefs + WhatsApp number + 24h-window/template logic). Nothing here holds
per-user data in a global; the only singletons used are scheduler bookkeeping
flags (``*_last`` dates / dedupe signatures), exactly like ``leaderboard_last``
and ``telegram_status_sig``.

DORMANT UNTIL KEYS: ``notify_user`` → ``sms.send_whatsapp`` is a safe no-op until
the Twilio env vars (TWILIO_SID / TWILIO_TOKEN / TWILIO_WHATSAPP_FROM) are set on
the server, so these jobs run and log but send nothing until then.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone

from app import database as db
from app.core import security
from app.services import notify

logger = logging.getLogger("algo770")

try:  # DST-aware Israel time when the tz database is present (normal on Linux)
    from zoneinfo import ZoneInfo
    _IL = ZoneInfo("Asia/Jerusalem")
except Exception:  # noqa: BLE001 — fall back to a fixed offset (IDT, UTC+3)
    _IL = timezone(timedelta(hours=3))


# ── scheduling helpers (all in Israel time) ──────────────────────────────────

def _next_daily_il(hour: int, minute: int, now_utc: datetime) -> datetime:
    """The next HH:MM Israel time at/after ``now``, returned in UTC (DST-aware)."""
    now_il = now_utc.astimezone(_IL)
    target = now_il.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now_il:
        target += timedelta(days=1)
    return target.astimezone(timezone.utc)


async def _sleep_until(target_utc: datetime) -> None:
    now = datetime.now(timezone.utc)
    await asyncio.sleep(max(30.0, (target_utc - now).total_seconds()))


def _parse(ts) -> datetime | None:
    if not ts:
        return None
    try:
        if isinstance(ts, datetime):
            return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
        d = datetime.fromisoformat(str(ts))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        return None


def _safe(fn, default):
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return default


# ── recipients ───────────────────────────────────────────────────────────────

def owner_usernames() -> list[str]:
    """The product OWNERS that currently have an account, resolved through the same
    ``security.is_owner`` gate the Requests portal uses (main admin + the
    OWNER_USERNAMES/OWNER_EMAILS allowlist). Per-user — no global recipient list."""
    try:
        return [u["username"] for u in db.list_users()
                if u.get("username") and security.is_owner(u.get("username"))]
    except Exception as exc:  # noqa: BLE001
        logger.warning("owner_usernames failed: %s", exc)
        return []


# Extra owner-report recipients delivered by SMS ONLY. These are report recipients,
# NOT app users: nothing about them is written to any per-user table, so there is no
# per-user-isolation surface. SMS is deliberate — it has no WhatsApp 24h-window /
# template dependency and needs no sandbox join, so it's reliable for numbers (Rafi)
# that never joined the WhatsApp sandbox. Carried by the deploy as source (idempotent,
# no boot DB seed, no SSH) and sent through the SAME sms.send_sms path Dan already
# uses — Dan's own per-user delivery is untouched. Edit this list to change who gets
# the owner reports + new-request alerts.
EXTRA_SMS_RECIPIENTS: list[tuple[str, str]] = [
    ("Yoav", "+19179694093"),
    ("Rafi", "+18434504783"),
]


def _extra_sms(text: str) -> int:
    """SMS an owner message to the fixed extra recipients (Yoav, Rafi).

    Deduped against any owner USER who already receives SMS on the same number, so a
    recipient is never texted twice. Safe no-op when Twilio SMS isn't configured
    (``sms.send_sms`` returns False). Returns how many extra numbers were queued."""
    from app.services import sms
    already: set[str] = set()
    try:  # numbers an owner user already gets SMS on — skip to avoid a double text
        for uname in owner_usernames():
            p = db.get_notif_prefs(uname)
            num = (p.get("phone") or "").strip()
            if p.get("sms") and num:
                already.add(num)
    except Exception:  # noqa: BLE001 — dedupe is best-effort, never block the send
        pass
    sent = 0
    for _name, number in EXTRA_SMS_RECIPIENTS:
        number = (number or "").strip()
        if not number or number in already:
            continue
        try:
            if sms.send_sms(number, text):
                sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("extra owner SMS to %s failed: %s", number, exc)
    return sent


def _notify_owners(text: str, sms_text: str | None = None) -> int:
    """Send ``text`` to every owner over their enabled channels (WhatsApp/SMS/email
    per their own prefs), PLUS the fixed extra SMS recipients (Yoav, Rafi).
    ``kind=None`` → operational owner report, never gated by a per-alert-type opt-in.

    ``sms_text`` (optional) is a SHORT, length-safe body used for the SMS channel ONLY
    (WhatsApp + email keep the full ``text``). A long multi-section report cannot be
    delivered over SMS — Hebrew + emojis force UCS-2 (~67 chars/segment) and it blows past
    the SMS limits, so the send silently fails. Callers of a long report pass a compact
    summary + link here. When None, SMS uses ``text`` (unchanged for the short reports).
    Returns how many recipients had a channel queued."""
    sent = 0
    for uname in owner_usernames():
        try:
            if notify.notify_user(uname, text, sms_text=sms_text):
                sent += 1
        except Exception as exc:  # noqa: BLE001 — one owner must never break the loop
            logger.warning("owner report notify failed for %s: %s", uname, exc)
    sent += _extra_sms(sms_text if sms_text is not None else text)
    return sent


def notify_owners_new_request(subject: str, who: str) -> int:
    """Owner alert for a NEW user request/feedback, delivered by SMS to the extra
    owner-report recipients (Yoav, Rafi). Kept separate from Dan's existing Telegram
    alert: it only ADDS the extra SMS recipients and changes no owner user's channels.
    Best-effort; returns how many extra numbers were queued."""
    now_il = datetime.now(_IL)
    subj = ((subject or "—").strip()[:120]) or "—"
    text = (f"📩 Strateteach — בקשה חדשה מ-{(who or '?').strip()}\n{subj}\n"
            f"· {now_il.strftime('%d/%m %H:%M')} (שעון ישראל)")
    return _extra_sms(text)


# ── formatting helpers ───────────────────────────────────────────────────────

def _fmt_price(v) -> str:
    v = float(v or 0)
    if v >= 1000:
        return f"${v:,.0f}"
    if v >= 1:
        return f"${v:,.2f}"
    if v > 0:
        return ("$" + f"{v:.6f}".rstrip("0").rstrip("."))
    return "$0"


def _age_str(ts, now_utc: datetime) -> str:
    d = _parse(ts)
    if not d:
        return "—"
    secs = max(0.0, (now_utc - d).total_seconds())
    if secs < 3600:
        return f"{int(secs // 60)} דק׳"
    if secs < 48 * 3600:
        return f"{int(secs // 3600)} שע׳"
    return f"{int(secs // 86400)} ימים"


# ── 1) Breakouts report (daily 09:00 IL) ─────────────────────────────────────

_TIER_HE = {
    "breaking_out": "פורץ",
    "near_breakout": "לקראת פריצה",
    "in_uptrend": "במגמת עלייה",
    "building": "מתבסס",
    "neutral": "ניטרלי",
}
_TIER_RANK = {"breaking_out": 0, "near_breakout": 1, "in_uptrend": 2, "building": 3}


def _breakout_rank_key(s: dict):
    return (_TIER_RANK.get(s.get("tier"), 9), -abs(float(s.get("changeTodayPct") or 0)))


def _fmt_breakout_line(i: int, s: dict) -> str:
    sym = s.get("symbol") or "?"
    tier = _TIER_HE.get(s.get("tier"), s.get("tier") or "—")
    chg = float(s.get("changeTodayPct") or 0)
    arrow = "▲" if chg >= 0 else "▼"
    price = _fmt_price(s.get("currentPrice"))
    ptg = s.get("pctToGreen")
    above = ""
    if s.get("stillGreen") and isinstance(ptg, (int, float)):
        above = f" · {abs(float(ptg)):.1f}% מעל הרצועה"
    bd = s.get("breakoutDate")
    since = f" · פורץ מאז {bd}" if bd else ""
    return f"{i}. {sym} · {tier} · שינוי היום {arrow}{abs(chg):.1f}%{above} · {price}{since}"


def build_breakouts_report(top: int = 10) -> str | None:
    """The real Bot-8 breakout scan (top movers) — same source as
    ``run_breakout_scan(["crypto"], ...)``, read from the cached ``daily_scan``
    snapshot. Returns None if no scan is cached yet."""
    scan = db.get_daily_scan() or {}
    signals = scan.get("signals") or []
    if not signals:
        return None
    ranked = sorted(signals, key=_breakout_rank_key)[:top]
    now_il = datetime.now(_IL)
    lines = [f"📈 Strateteach — סריקת פריצות Bot-8 · {now_il.strftime('%d/%m %H:%M')} (שעון ישראל)", ""]
    for i, s in enumerate(ranked, 1):
        lines.append(_fmt_breakout_line(i, s))
    return "\n".join(lines)[:1400]


def _send_breakouts(text: str) -> int:
    """Owners (the team) always; every other user only if they opted into
    ``breakout`` alerts. Owners are sent with no ``kind`` so the team receives it
    regardless of their per-alert-type toggle; de-duplicated so an owner who also
    opted in isn't messaged twice."""
    owners = set(owner_usernames())
    sent = _notify_owners(text)
    for u in _safe(db.list_users, []):
        uname = u.get("username")
        if not uname or uname in owners:
            continue
        try:
            if notify.notify_user(uname, text, kind="breakout"):
                sent += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("breakout report notify failed for %s: %s", uname, exc)
    return sent


async def breakouts_report_loop() -> None:
    """Daily 09:00 Israel time; de-duped per Israel calendar day across restarts."""
    while True:
        await _sleep_until(_next_daily_il(9, 0, datetime.now(timezone.utc)))
        try:
            today_il = datetime.now(_IL).date().isoformat()
            if db._get_singleton("breakouts_report_last", None) == today_il:
                continue
            text = build_breakouts_report()
            if not text:
                logger.warning("breakouts report: no cached scan signals yet; skipping today")
                continue
            n = _send_breakouts(text)
            db._set_singleton("breakouts_report_last", today_il)
            logger.info("breakouts report (09:00 IL) queued to %d recipient(s)", n)
        except Exception as exc:  # noqa: BLE001 — never let a send crash the loop
            logger.warning("breakouts report loop error: %s", str(exc)[:200])


# ── 2) Users + portfolio report (HOURLY) ─────────────────────────────────────

def build_owner_portfolio_report() -> tuple[str, str, str]:
    """The comprehensive HOURLY owner digest — one section per product surface, every
    figure FRESHLY queried against its real source and bounded to the Israel day.

    Sections: 👥 users · ⚙️ Trading Engine (live auto runs + breakout scan) · 🤖
    AutoPilots (SIMULATION only) · 📡 Signal Bots · 💰 LIVE real money · 🧪 DEMO ·
    📌 open positions (live/demo split) · 🆕 new requests & signups · ✅ completed
    tasks + launch progress · ⏳ expiring demo testers.

    HONESTY INVARIANTS (do not regress):
      • The 💰 LIVE section reflects GENUINE real money ONLY — orders logged with
        environment='live' (see ``db.live_realmoney_report_stats``). Testnet/paper
        exchange orders (the default) are excluded, so while nobody trades real money
        it honestly reads $0 / 0 trades. This is the fix for the old "$0 P&L but 87
        trades" bug (that paired today's P&L with an ALL-TIME trade count AND counted
        testnet orders as real money).
      • AutoPilots are SIMULATION only while the master gate is off — sim P&L is
        clearly labelled "סימולציה", never presented as real money, and live pilots
        show $0.
      • Every "today" figure rolls at Israel midnight (``_il_day_start_iso``); trade
        COUNTS and P&L are both today-scoped so a count is never mislabelled "today".

    Returns (text, sms_summary, signature): ``text`` is the full multi-section report for
    email/WhatsApp/Telegram/web; ``sms_summary`` is a SHORT, GSM-7-friendly digest for the
    SMS channel (the full report is far past SMS length limits and would silently fail to
    deliver — see ``_notify_owners``); the signature dedupes an unchanged hour."""
    from app.services import telegram_admin as ta  # reuse its online/demos/expiring helpers

    online = _safe(lambda: ta._online(60), [])
    pending = _safe(lambda: db.list_signup_requests("pending"), [])
    new_demos = _safe(lambda: ta._recent_demos(1), [])
    expiring = _safe(lambda: ta._expiring(24), [])
    users = _safe(lambda: db.users_activity_report_stats(), {})
    pe = _safe(lambda: db.profit_engine_report_stats(), {})
    scan = _safe(lambda: db.get_daily_scan(), {})
    ap = _safe(lambda: db.autopilot_report_stats(), {})
    sb = _safe(lambda: db.signal_bots_report_stats(), {})
    live = _safe(lambda: db.live_realmoney_report_stats(), {})
    demo = _safe(lambda: db.demo_realized_report_stats(), {})
    running = _safe(lambda: db.count_running_sessions(is_admin=True), 0)
    split = _safe(lambda: db.open_positions_split(), {})
    tasks = _safe(lambda: db.pm_tasks_report_stats(), {})

    now_il = datetime.now(_IL)
    lines = [f"📊 Strateteach — דוח שעתי מקיף · {now_il.strftime('%H:%M · %d/%m')} (שעון ישראל)", ""]

    # 1) USERS ─────────────────────────────────────────────────────────────────
    lines.append("👥 משתמשים")
    lines.append(f"מחוברים כעת ({len(online)}): " + (", ".join(online) if online else "—"))
    lines.append(f"רשומים: {int(users.get('total') or 0)} · בודקי דמו: {int(users.get('demo') or 0)}")
    lines.append(f"נכנסו היום: {int(users.get('activeToday') or 0)} · נרשמו היום: {int(users.get('signupsToday') or 0)}")

    # 2) TRADING ENGINE ────────────────────────────────────────────────────────
    lines.append("")
    lines.append("⚙️ מנוע מסחר (Trading Engine)")
    lines.append(f"LIVE (אמיתי · ריצות auto): P&L היום ${float(pe.get('pnlToday') or 0):,.2f} · "
                 f"{int(pe.get('closedToday') or 0)} נסגרו היום · סה״כ {int(pe.get('closedAll') or 0)}")
    signals = scan.get("signals") or []
    if signals:
        breaking = [s for s in signals if s.get("tier") in ("breaking_out", "near_breakout")]
        top3 = sorted(signals, key=_breakout_rank_key)[:3]
        top_str = ", ".join(
            f"{s.get('symbol')} {'▲' if float(s.get('changeTodayPct') or 0) >= 0 else '▼'}"
            f"{abs(float(s.get('changeTodayPct') or 0)):.1f}%" for s in top3)
        lines.append(f"סריקת פריצות: {len(signals)} נסרקו · {len(breaking)} פורצים → {top_str}")
    else:
        lines.append("סריקת פריצות: אין סריקה במטמון עדיין")

    # 3) AUTOPILOTS — SIMULATION ONLY ──────────────────────────────────────────
    lines.append("")
    lines.append("🤖 טייסים אוטומטיים (AutoPilots) — סימולציה בלבד")
    pilots = ap.get("pilots") or []
    pilots_str = f" ({', '.join(pilots)})" if pilots else ""
    lines.append(f"טעונים: {int(ap.get('loaded') or 0)}{pilots_str} · פוזיציות סים פתוחות: {int(ap.get('openPositions') or 0)}")
    lines.append(f"P&L סים היום: ${float(ap.get('simPnlToday') or 0):,.2f} · סה״כ סים: ${float(ap.get('simPnl') or 0):,.2f}")
    lines.append(f"💡 מסחר אמת חסום (gate off) → טייסים אמיתיים: {int(ap.get('live') or 0)} · כסף אמיתי $0")

    # 4) SIGNAL BOT ────────────────────────────────────────────────────────────
    lines.append("")
    lines.append("📡 סיגנל בוט (Signal Bot)")
    lines.append(f"בוטים פעילים: {int(sb.get('activeBots') or 0)}/{int(sb.get('totalBots') or 0)} · "
                 f"פוזיציות פתוחות: {int(sb.get('open') or 0)}")
    lines.append(f"עסקאות היום: {int(sb.get('closedToday') or 0)} · P&L היום: ${float(sb.get('pnlToday') or 0):,.2f} · "
                 f"סה״כ P&L: ${float(sb.get('pnl') or 0):,.2f}")

    # 5) LIVE — real money ONLY ────────────────────────────────────────────────
    live_today = float(live.get("today") or 0)
    live_today_tr = int(live.get("todayTrades") or 0)
    live_total = float(live.get("total") or 0)
    live_all_tr = int(live.get("trades") or 0)
    lines.append("")
    lines.append("💰 LIVE — כסף אמיתי בלבד (היום)")
    lines.append(f"P&L: ${live_today:,.2f} · {live_today_tr} עסקאות שנסגרו היום")
    if live_all_tr == 0:
        lines.append("אין מסחר בכסף אמיתי — כל הפעילות דמו/טסטנט")
    else:
        lines.append(f"(סה״כ אי־פעם: ${live_total:,.2f} · {live_all_tr} עסקאות)")

    # 6) DEMO / paper ──────────────────────────────────────────────────────────
    demo_today = float(demo.get("today") or 0)
    demo_today_tr = int(demo.get("todayTrades") or 0)
    demo_total = float(demo.get("total") or 0)
    demo_all_tr = int(demo.get("trades") or 0)
    lines.append("")
    lines.append("🧪 DEMO / נייר (היום)")
    lines.append(f"P&L: ${demo_today:,.2f} · {demo_today_tr} עסקאות שנסגרו היום · {running} סשנים פעילים")
    lines.append(f"(סה״כ: ${demo_total:,.2f} · {demo_all_tr} עסקאות)")

    # 7) OPEN POSITIONS (live/demo split) ──────────────────────────────────────
    lines.append("")
    lines.append(f"📌 פוזיציות פתוחות ({int(split.get('total') or 0)})")
    lines.append(f"דמו: {int(split.get('demo') or 0)} · אמת: {int(split.get('live') or 0)}")

    # 8) NEW REQUESTS & SIGNUPS ────────────────────────────────────────────────
    lines.append("")
    lines.append("🆕 בקשות והרשמות חדשות")
    if pending:
        for r in pending[:8]:
            contact = r.get("email") or r.get("phone") or ""
            lines.append(f"• {r.get('name', '?')} — {contact} (#{r.get('id')})")
        if len(pending) > 8:
            lines.append(f"…ועוד {len(pending) - 8}")
    if new_demos:
        lines.append(f"✅ דמו חדשים: {', '.join(new_demos)}")
    if not pending and not new_demos:
        lines.append("—")

    # 9) COMPLETED TASKS + launch progress ─────────────────────────────────────
    done_total = int(tasks.get("doneTotal") or 0)
    total_tasks = int(tasks.get("total") or 0)
    pct = round(done_total / total_tasks * 100) if total_tasks else 0
    lines.append("")
    lines.append("✅ משימות שהושלמו")
    lines.append(f"ב-24 שעות: {int(tasks.get('doneRecent') or 0)} · סה״כ הושלמו: {done_total} · פתוחות: {int(tasks.get('open') or 0)}")
    lines.append(f"התקדמות להשקה: {pct}% ({done_total}/{total_tasks})")

    # 10) EXPIRING DEMO TESTERS (24h) ──────────────────────────────────────────
    lines.append("")
    lines.append("⏳ בודקי דמו שפגים (24 שעות)")
    if expiring:
        for name, exp in expiring[:10]:
            lines.append(f"• {name} — {exp.astimezone(_IL).strftime('%d/%m %H:%M')}")
    else:
        lines.append("—")

    text = "\n".join(lines)
    sig_src = "|".join([
        ",".join(sorted(online)),
        ",".join(str(r.get("id")) for r in pending),
        ",".join(sorted(new_demos)),
        str(users.get("total")), str(users.get("activeToday")), str(users.get("signupsToday")),
        f"{float(pe.get('pnlToday') or 0):.2f}", str(pe.get("closedToday")), str(pe.get("closedAll")),
        str(len(signals)),
        str(ap.get("loaded")), str(ap.get("openPositions")), f"{float(ap.get('simPnlToday') or 0):.2f}",
        str(sb.get("activeBots")), str(sb.get("closedToday")), f"{float(sb.get('pnlToday') or 0):.2f}",
        f"{live_today:.2f}", str(live_today_tr), str(live_all_tr),
        f"{demo_today:.2f}", str(demo_today_tr), str(running),
        str(split.get("total")), str(split.get("live")),
        str(done_total), str(tasks.get("doneRecent")), str(total_tasks),
        ",".join(n for n, _ in expiring),
    ])
    sig = hashlib.sha1(sig_src.encode()).hexdigest()

    # ── SHORT SMS digest ──────────────────────────────────────────────────────
    # SMS can't carry the full report above (Hebrew + the section emojis force UCS-2 at
    # ~67 chars/segment; the multi-section body runs past the SMS segment/1600-char limit
    # → Twilio rejects/never delivers, which is why the report SMS stopped arriving). This
    # is a handful of KEY lines only, ASCII/GSM-7 friendly (no emojis, no "·"/"•" which are
    # UCS-2), so it stays 1–2 segments regardless of how the full report grows. The caller
    # appends a token-gated link to the full live report; email/WhatsApp/Telegram/web keep
    # the comprehensive format. Every field here is a COUNT/number (bounded), so length is
    # bounded; a final clamp guarantees it never balloons.
    breaking_ct = len([s for s in signals if s.get("tier") in ("breaking_out", "near_breakout")])
    sms_lines = [
        f"Strateteach owner report {now_il.strftime('%H:%M %d/%m')}",
        f"Users online: {len(online)} (registered {int(users.get('total') or 0)})",
        f"LIVE today: ${live_today:,.2f} ({live_today_tr} trades)",
        f"Breakouts: {breaking_ct}/{len(signals)}",
        f"Open positions: {int(split.get('total') or 0)} "
        f"(live {int(split.get('live') or 0)}, demo {int(split.get('demo') or 0)})",
    ]
    sms_summary = "\n".join(sms_lines)[:480]
    return text, sms_summary, sig


async def owner_portfolio_loop() -> None:
    """Send the owner users+portfolio report at startup, then EVERY 3 HOURS, aligned to
    the Israel clock (00:00 / 03:00 / 06:00 / 09:00 / 12:00 / 15:00 / 18:00 / 21:00 IL) —
    but only when the content actually changed (signature dedupe stops deploy restarts
    and quiet blocks from re-sending an identical report). Owners only.

    Aligning to Israel 3-hour boundaries (rather than sleeping 3h from process start)
    keeps sends on tidy wall-clock times and makes them survive restarts: after a redeploy
    the loop resumes at the next boundary, not at "3h from now". DST-safe because the
    next boundary is built in Asia/Jerusalem local time then converted to UTC."""
    first = True
    while True:
        if first:
            await asyncio.sleep(20)  # small grace so the DB/first sessions are up
            first = False
        else:
            # Next Israel-local hour that is a multiple of 3, strictly in the future.
            now_il = datetime.now(_IL)
            next_block_hour = (now_il.hour // 3 + 1) * 3  # 3,6,…,24 (24 → 00:00 next day)
            nxt_il = now_il.replace(minute=0, second=0, microsecond=0) + timedelta(
                hours=next_block_hour - now_il.hour)
            await _sleep_until(nxt_il.astimezone(timezone.utc))
        try:
            text, sms_summary, sig = build_owner_portfolio_report()
            if db._get_singleton("owner_portfolio_sig", None) == sig:
                continue  # nothing changed since last send — stay quiet
            # SMS gets the short digest + a token-gated link to the full live report; the
            # full multi-section text still goes to email/WhatsApp (they have no SMS length
            # cap). Mint the view token only now (post-dedupe) so we don't leak tokens on
            # every quiet cycle. Best-effort: if no PUBLIC_BASE_URL, SMS is the summary alone.
            sms_text = sms_summary
            try:
                from app.services import owners_report as orr
                link = orr._report_link(orr.mint_report_token())
                if link:
                    sms_text = f"{sms_summary}\nFull report: {link}"
            except Exception as exc:  # noqa: BLE001 — link is best-effort
                logger.warning("owner portfolio SMS link mint failed: %s", str(exc)[:120])
            n = _notify_owners(text, sms_text=sms_text)
            db._set_singleton("owner_portfolio_sig", sig)
            logger.info("owner portfolio report (every 3h, IL-aligned) queued to %d owner(s)", n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("owner portfolio loop error: %s", str(exc)[:200])


# ── 3) Open requests report (daily 12:00 IL) ─────────────────────────────────

# Everything that is not resolved is still open (new → in_progress → answered).
_OPEN_STATUSES = ("new", "in_progress", "answered")


def build_open_requests_report() -> str:
    """Currently-open Requests-Portal tickets (user requests, not owner notes):
    count + subject / user / age."""
    reqs = _safe(lambda: db.list_requests(category="user_request", limit=500), [])
    open_reqs = [r for r in reqs if (r.get("status") or "new") in _OPEN_STATUSES]
    now_utc = datetime.now(timezone.utc)
    now_il = datetime.now(_IL)
    lines = [f"📋 Strateteach — בקשות פתוחות · {now_il.strftime('%d/%m %H:%M')} (שעון ישראל)",
             f"סה״כ פתוחות: {len(open_reqs)}"]
    if not open_reqs:
        lines.append("— אין בקשות פתוחות —")
    for r in open_reqs[:20]:
        who = r.get("display_name") or r.get("user_id") or "?"
        subj = ((r.get("subject") or r.get("body") or "—").strip() or "—")[:60]
        age = _age_str(r.get("created_at"), now_utc)
        lines.append(f"• #{r.get('id')} {subj} — {who} · {r.get('status')} · {age}")
    if len(open_reqs) > 20:
        lines.append(f"…ועוד {len(open_reqs) - 20}")
    return "\n".join(lines)[:1400]


async def open_requests_loop() -> None:
    """Daily 12:00 Israel time; de-duped per Israel calendar day. Owners only."""
    while True:
        await _sleep_until(_next_daily_il(12, 0, datetime.now(timezone.utc)))
        try:
            today_il = datetime.now(_IL).date().isoformat()
            if db._get_singleton("open_requests_report_last", None) == today_il:
                continue
            text = build_open_requests_report()
            n = _notify_owners(text)
            db._set_singleton("open_requests_report_last", today_il)
            logger.info("open requests report (12:00 IL) queued to %d owner(s)", n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("open requests loop error: %s", str(exc)[:200])


# ── 4) Closed-today requests report (daily 00:05 IL) ─────────────────────────

def _closed_target_day():
    """The Israel calendar day this 00:05 run summarises. Fired just after midnight,
    it reports the day that JUST ENDED (stepping back a couple of hours lands
    firmly on the previous IL date even if the job runs a little late)."""
    return (datetime.now(_IL) - timedelta(hours=2)).date()


def build_closed_today_requests_report() -> str:
    """Requests resolved during the target Israel day (count + subject / user)."""
    reqs = _safe(lambda: db.list_requests(category="user_request", status="resolved", limit=500), [])
    day = _closed_target_day()
    closed = []
    for r in reqs:
        d = _parse(r.get("updated_at"))
        if d and d.astimezone(_IL).date() == day:
            closed.append(r)
    lines = [f"✅ Strateteach — בקשות שנסגרו · {day.strftime('%d/%m')} (שעון ישראל)",
             f"סה״כ נסגרו: {len(closed)}"]
    if not closed:
        lines.append("— לא נסגרו בקשות ביום זה —")
    for r in closed[:20]:
        who = r.get("display_name") or r.get("user_id") or "?"
        subj = ((r.get("subject") or r.get("body") or "—").strip() or "—")[:60]
        lines.append(f"• #{r.get('id')} {subj} — {who}")
    if len(closed) > 20:
        lines.append(f"…ועוד {len(closed) - 20}")
    return "\n".join(lines)[:1400]


async def closed_requests_loop() -> None:
    """Daily 00:05 Israel time; de-duped per target Israel day. Owners only."""
    while True:
        await _sleep_until(_next_daily_il(0, 5, datetime.now(timezone.utc)))
        try:
            day_key = _closed_target_day().isoformat()
            if db._get_singleton("closed_requests_report_last", None) == day_key:
                continue
            text = build_closed_today_requests_report()
            n = _notify_owners(text)
            db._set_singleton("closed_requests_report_last", day_key)
            logger.info("closed-today requests report (00:05 IL) queued to %d owner(s)", n)
        except Exception as exc:  # noqa: BLE001
            logger.warning("closed requests loop error: %s", str(exc)[:200])
