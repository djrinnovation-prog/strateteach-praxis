"""Telegram admin hub: an hourly status digest + on-demand bot commands.

The digest summarises who's connected, new access requests, today's trades/P&L,
and demo testers about to expire — and is only sent when something changed since
the previous hour (a signature is cached so identical hours are skipped).

Commands handled from the bot chat:
  /who        — who's connected right now
  /pending    — pending access requests (each with Approve/Deny buttons)
  /stats      — totals: users, demo testers, active sessions, today's P&L
  /broadcast  — send an SMS blast to all users: "/broadcast your message"
  /help       — list the commands
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone

from app import database as db
from app.services import telegram as tg

logger = logging.getLogger("algo770")


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


def _online(window_min: int = 60) -> list[str]:
    """Usernames seen within the last ``window_min`` minutes."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=window_min)
    out = []
    for s in db.list_sessions():
        seen = _parse(s.get("last_seen") or s.get("since"))
        if seen and seen >= cutoff:
            out.append(s.get("username") or "?")
    return out


def _online_display(usernames: list[str]) -> str:
    """Render online users as real people, not bare handles/roles. ``list_sessions``
    stores the login username (which can read like a role, e.g. "admin"), so resolve
    each to its nickname + role tag: "Nickname (@username) · owner". Never fabricates —
    an unknown user just shows "@username"."""
    if not usernames:
        return "—"
    parts = []
    for un in usernames:
        try:
            u = db.get_user(un) or {}
        except Exception:  # noqa: BLE001
            u = {}
        nick = (u.get("nickname") or "").strip()
        role = (u.get("role") or "").strip().lower()
        is_main = bool(u.get("is_main"))
        label = un if (not nick or nick == un) else f"{nick} (@{un})"
        tag = "owner" if (role == "admin" and is_main) else (role if role and role != "user" else "")
        if tag:
            label += f" · {tag}"
        parts.append(label)
    return ", ".join(parts)


# Map a runs_log close_reason → (emoji, label) for the recent-closes section.
_REASON_LABEL = {
    "stop_loss":   ("🛑", "stop-loss"),
    "take_profit": ("🎯", "take-profit"),
    "manual":      ("✋", "manual"),
    "target_hit":  ("🎯", "daily target"),
    "daily_reset": ("🔄", "daily reset"),
    "live":        ("•", "closed"),
}


def _fmt_close(r: dict) -> str:
    """One recent-close line: 🟢/🔴 SYMBOL ±x.xx% · <reason> · HH:MM · who."""
    sym = str(r.get("symbol") or "?")
    pct = r.get("pnl_pct")
    reason = str(r.get("close_reason") or "").lower()
    emoji, label = _REASON_LABEL.get(reason, ("•", reason or "closed"))
    ca = _parse(r.get("closed_at"))
    when = ca.strftime("%H:%M") if ca else ""
    who = ""
    un = r.get("username")
    if un:
        try:
            who = db.display_name(un)
        except Exception:  # noqa: BLE001
            who = str(un)
    try:
        pv = float(pct)
        pct_s = f"{pv:+.2f}%"
        sign = "🟢" if pv >= 0 else "🔴"
    except (TypeError, ValueError):
        pct_s = "—"
        sign = "•"
    tail = ""
    if when:
        tail += f" · {when}"
    if who:
        tail += f" · {who}"
    return f"{sign} <b>{sym}</b> {pct_s} · {emoji} {label}{tail}"


def _recent_closes(within_h: int = 24, limit: int = 8) -> tuple[list[dict], dict, int]:
    """Recent LIVE closes across all users from runs_log — the real-money positions
    that closed dynamically (stop-loss / take-profit) or manually, newest first. This
    is the same source the closed-log endpoint + live_reconcile populate. Returns
    (rows[:limit], reason_counts, total_in_window)."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=within_h)
    try:
        rows = db.list_runs_log(mode="live", status="closed", limit=300)
    except Exception:  # noqa: BLE001
        rows = []
    recent = []
    for r in rows:
        ca = _parse(r.get("closed_at"))
        if ca and ca >= cutoff:
            recent.append((ca, r))
    recent.sort(key=lambda x: x[0], reverse=True)
    ordered = [r for _, r in recent]
    counts = {"stop_loss": 0, "take_profit": 0, "manual": 0}
    for r in ordered:
        k = str(r.get("close_reason") or "").lower()
        if k in counts:
            counts[k] += 1
    return ordered[:limit], counts, len(ordered)


def _expiring(within_h: int = 24) -> list[tuple[str, datetime]]:
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=within_h)
    out = []
    for u in db.list_demo_users():
        exp = _parse(u.get("demo_expires"))
        if exp and now <= exp <= horizon:
            out.append((u.get("username") or "?", exp))
    out.sort(key=lambda x: x[1])
    return out


def _recent_demos(within_h: int = 1) -> list[str]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=within_h)
    out = []
    for u in db.list_demo_users():
        created = _parse(u.get("created_at"))
        if created and created >= cutoff:
            out.append(u.get("username") or "?")
    return out


def build_status_report() -> tuple[str, str]:
    """Return (html_text, signature). Signature dedupes unchanged hours."""
    online = _online(60)
    closes, close_reasons, closes_n = _recent_closes(24, 8)
    pending = db.list_signup_requests("pending")
    new_demos = _recent_demos(1)
    expiring = _expiring(24)
    try:
        demo = db.demo_pnl_stats(is_admin=True)
    except Exception:  # noqa: BLE001
        demo = {}
    try:
        live = db.live_realized_stats()
    except Exception:  # noqa: BLE001
        live = {}
    try:
        running = db.count_running_sessions(is_admin=True)
    except Exception:  # noqa: BLE001
        running = 0
    try:
        open_pos = db.count_open_positions(is_admin=True)
    except Exception:  # noqa: BLE001
        open_pos = 0
    # Expanded sections — real DB rollups (each degrades to zeros, never fabricated).
    ap = db.autopilot_report_stats()
    sb = db.signal_bots_report_stats()
    pe = db.profit_engine_report_stats()
    tasks = db.pm_tasks_report_stats()
    users = db.users_report_stats()

    demo_today = float(demo.get("today") or 0)
    demo_trades = int(demo.get("trades") or 0)
    live_today = float(live.get("today") or 0)
    live_trades = int(live.get("trades") or 0)

    now = datetime.now(timezone.utc)
    lines = [f"📊 <b>Strateteach hourly report</b> · {now.strftime('%H:%M UTC')}", ""]

    lines.append(f"👥 <b>Online now ({len(online)})</b>")
    lines.append(_online_display(online))

    lines.append("")
    lines.append(f"🆕 <b>New requests & signups</b>")
    if pending:
        for r in pending[:8]:
            contact = r.get("email") or r.get("phone") or ""
            lines.append(f"• {r.get('name','?')} — {contact} (#{r.get('id')})")
        if len(pending) > 8:
            lines.append(f"…and {len(pending) - 8} more")
    if new_demos:
        lines.append(f"✅ New demo users: {', '.join(new_demos)}")
    if not pending and not new_demos:
        lines.append("—")

    # Live vs demo P&L are kept on separate lines so real money is never mixed in
    # with paper results. "Open positions" is the count of live+demo positions
    # still open right now.
    lines.append("")
    lines.append("💰 <b>LIVE — real money · all sources (today)</b>")
    lines.append(f"P&amp;L: ${live_today:,.2f} · {live_trades} closed trades today")

    lines.append("")
    lines.append("🧪 <b>DEMO / paper (today)</b>")
    lines.append(f"P&amp;L: ${demo_today:,.2f} · {demo_trades} closed trades · {running} running")

    lines.append("")
    lines.append("📌 <b>Open positions</b>")
    lines.append(f"{open_pos} open right now")

    # ── Recent LIVE closes — real-money positions closed dynamically (stop-loss /
    # take-profit) or manually, from runs_log (populated by the engine + the read-only
    # live_reconcile OCO-close detection). This is what "what just closed and why" shows.
    lines.append("")
    lines.append("🔔 <b>Recent LIVE closes (24h)</b>")
    if closes_n:
        lines.append(f"{closes_n} closed · 🛑 {close_reasons['stop_loss']} stop-loss · "
                     f"🎯 {close_reasons['take_profit']} take-profit · ✋ {close_reasons['manual']} manual")
        for r in closes:
            lines.append("• " + _fmt_close(r))
        if closes_n > len(closes):
            lines.append(f"…and {closes_n - len(closes)} more")
    else:
        lines.append("— none in the last 24h")

    # ── AutoPilots (טייסים אוטומטיים) — loaded/live counts + sim & live P&L ──
    lines.append("")
    lines.append("🤖 <b>AutoPilots · טייסים אוטומטיים</b>")
    if ap["loaded"]:
        ap_line = f"{ap['loaded']} loaded · {ap['openPositions']} open · sim P&amp;L ${ap['simPnl']:,.2f}"
        if ap["live"]:
            ap_line += f" · 🔴 {ap['live']} LIVE · real P&amp;L ${ap['livePnl']:,.2f}"
        lines.append(ap_line)
    else:
        lines.append("— none loaded")

    # ── Signal Bots (סיגנל בוט) — active bots + P&L / activity ──
    lines.append("")
    lines.append("📡 <b>Signal Bots · סיגנל בוט</b>")
    if sb["totalBots"]:
        lines.append(f"{sb['activeBots']}/{sb['totalBots']} active · {sb['open']} open · "
                     f"{sb['trades']} trades · P&amp;L ${sb['pnl']:,.2f}")
    else:
        lines.append("— no bots")

    # ── Trading Engine (מנוע מסחר) — the engine's slice of LIVE: every live position
    # opened through the engine order path (manual + approved auto-batch), incl. its
    # stop-loss/take-profit OCO closes. A SUBSET of "LIVE — real money" above (Signal
    # Bots + AutoPilots have their own lines), so it's a lens, never a contradiction.
    lines.append("")
    lines.append("⚙️ <b>Trading Engine · מנוע מסחר</b> <i>(engine slice of LIVE)</i>")
    lines.append(f"Engine P&amp;L today: ${pe['pnlToday']:,.2f} · {pe['closedToday']} engine closes"
                 + (f" · all-time ${pe['pnlAll']:,.2f} ({pe['closedAll']})" if pe["closedAll"] else ""))

    # ── Users (משתמשים) — totals / active / new ──
    lines.append("")
    lines.append("👤 <b>Users · משתמשים</b>")
    lines.append(f"{users['total']} total · {len(online)} online · {users['new24h']} new (24h) · "
                 f"{users['demo']} demo")

    # ── Completed tasks (משימות שהושלמו) ──
    lines.append("")
    lines.append("✅ <b>Completed tasks · משימות שהושלמו</b>")
    lines.append(f"{tasks['doneRecent']} done (24h) · {tasks['doneTotal']} done total · {tasks['open']} open")

    lines.append("")
    lines.append("⏳ <b>Demo testers expiring (24h)</b>")
    if expiring:
        for name, exp in expiring[:10]:
            lines.append(f"• {name} — {exp.strftime('%b %d %H:%M')}")
    else:
        lines.append("—")

    text = "\n".join(lines)
    sig_src = "|".join([
        ",".join(sorted(online)),
        ",".join(str(r.get("id")) for r in pending),
        ",".join(sorted(new_demos)),
        f"{demo_today:.2f}", str(demo_trades),
        f"{live_today:.2f}", str(live_trades),
        str(running), str(open_pos),
        # recent LIVE closes — new close ids + reason tally so a fresh close re-sends
        ",".join(str(r.get("id")) for r in closes),
        f"{closes_n}/{close_reasons['stop_loss']}/{close_reasons['take_profit']}/{close_reasons['manual']}",
        ",".join(n for n, _ in expiring),
        # expanded sections
        f"{ap['loaded']}/{ap['live']}/{ap['openPositions']}/{ap['simPnl']:.2f}/{ap['livePnl']:.2f}",
        f"{sb['activeBots']}/{sb['totalBots']}/{sb['trades']}/{sb['pnl']:.2f}",
        f"{pe['pnlToday']:.2f}/{pe['closedToday']}/{pe['pnlAll']:.2f}",
        f"{users['total']}/{users['new24h']}/{users['demo']}",
        f"{tasks['doneRecent']}/{tasks['doneTotal']}/{tasks['open']}",
    ])
    sig = hashlib.sha1(sig_src.encode()).hexdigest()
    return text, sig


# ── on-demand commands ───────────────────────────────────────────────────────

def _cmd_who() -> str:
    online = _online(60)
    if not online:
        return "👥 Nobody connected in the last hour."
    return f"👥 <b>Online now ({len(online)})</b>\n" + _online_display(online)


def _cmd_stats() -> str:
    try:
        users = db.list_users()
    except Exception:  # noqa: BLE001
        users = []
    try:
        demos = db.list_demo_users()
    except Exception:  # noqa: BLE001
        demos = []
    try:
        pnl = db.demo_pnl_stats(is_admin=True)
    except Exception:  # noqa: BLE001
        pnl = {}
    try:
        live = db.live_realized_stats()
    except Exception:  # noqa: BLE001
        live = {}
    try:
        running = db.count_running_sessions(is_admin=True)
    except Exception:  # noqa: BLE001
        running = 0
    try:
        open_pos = db.count_open_positions(is_admin=True)
    except Exception:  # noqa: BLE001
        open_pos = 0
    online = _online(60)
    return (
        "📈 <b>Strateteach stats</b>\n"
        f"Users: {len(users)} · Demo testers: {len(demos)}\n"
        f"Online (1h): {len(online)} · Running: {running} · Open positions: {open_pos}\n"
        f"💰 LIVE today: ${float(live.get('today') or 0):,.2f} · "
        f"month: ${float(live.get('month') or 0):,.2f} · "
        f"all: ${float(live.get('total') or 0):,.2f}\n"
        f"🧪 DEMO today: ${float(pnl.get('today') or 0):,.2f} · "
        f"month: ${float(pnl.get('month') or 0):,.2f} · "
        f"all: ${float(pnl.get('total') or 0):,.2f}"
    )


def _cmd_broadcast(text: str) -> str:
    msg = (text or "").strip()
    if not msg:
        return "Usage: /broadcast your message here"
    from app.services import sms
    if not sms.channel_configured("sms"):
        return "SMS isn't configured on the server."
    recipients = db.broadcast_recipients("all")
    sent = 0
    for r in recipients:
        if r.get("phone") and sms.send_sms(r["phone"], msg):
            sent += 1
    return f"📣 Broadcast queued to {sent}/{len(recipients)} users by SMS."


def pending_button_messages() -> list[tuple[str, list]]:
    """Return (text, inline_keyboard) per pending request for /pending."""
    out = []
    for r in db.list_signup_requests("pending"):
        contact = r.get("email") or r.get("phone") or ""
        note = r.get("note")
        lines = ["🆕 <b>Access request</b>", f"<b>{r.get('name','?')}</b>", contact]
        if note:
            lines.append(f"“{note}”")
        text = "\n".join([l for l in lines if l])
        rid = r.get("id")
        buttons = [[{"text": "✅ Approve", "callback_data": f"approve:{rid}"},
                    {"text": "✖ Deny", "callback_data": f"deny:{rid}"}]]
        out.append((text, buttons))
    return out


HELP = (
    "🤖 <b>Strateteach bot</b>\n"
    "/who — who's connected now\n"
    "/pending — open access requests (Approve/Deny)\n"
    "/stats — users, sessions, P&amp;L\n"
    "/broadcast &lt;msg&gt; — SMS all users\n"
    "/report — send the status report now"
)


async def handle_command(token: str, chat_id: str, text: str) -> None:
    """Dispatch a /command typed in the bot chat."""
    raw = (text or "").strip()
    cmd, _, arg = raw.partition(" ")
    cmd = cmd.lstrip("/").lower().split("@")[0]  # tolerate /who@botname

    if cmd in ("start", "help"):
        await tg.send_message(token, chat_id, HELP)
    elif cmd == "who":
        await tg.send_message(token, chat_id, _cmd_who())
    elif cmd == "stats":
        await tg.send_message(token, chat_id, _cmd_stats())
    elif cmd == "report":
        text_out, _sig = build_status_report()
        await tg.send_message(token, chat_id, text_out)
    elif cmd == "broadcast":
        await tg.send_message(token, chat_id, _cmd_broadcast(arg))
    elif cmd == "pending":
        msgs = pending_button_messages()
        if not msgs:
            await tg.send_message(token, chat_id, "✅ No pending requests.")
        else:
            for t, buttons in msgs:
                tg.notify_admin(t, buttons)
    else:
        await tg.send_message(token, chat_id, "Unknown command. Send /help.")
