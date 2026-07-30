"""Profile (nickname + win target), in-app chat, performance analytics, and the
admin screen-capture feature. All paths live under /auth/* so the existing Caddy
reverse-proxy rule already routes them to the backend (no proxy change needed).
"""
from __future__ import annotations

import html
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app import database as db
from app.core.security import current_user, require_admin, assert_can_manage_user, require_owner, is_owner
from app.services.auth import hash_password, verify_password
from app.services import sms, notify
from app.services import email as email_svc

logger = logging.getLogger("algo770")

router = APIRouter(tags=["social"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _mirror_chat_to_telegram(sender_username: str, header: str, text: str) -> None:
    """Mirror an in-app chat message to the admin's Telegram (best-effort).

    Skips the admin's own messages so the admin doesn't get an echo of what they
    just typed in the app.
    """
    try:
        if (db.get_user(sender_username) or {}).get("role") == "admin":
            return
        from app.services import telegram as tg
        # Mirrored with parse_mode=HTML — escape the (user-controlled) header (sender
        # nickname / group name / recipient) and the chat body so a message like
        # "<img src=x onerror=…>" or "</b>…" can't inject markup into the alert.
        tg.notify_admin(f"💬 <b>{html.escape(header)}</b>\n{html.escape((text or '')[:400])}")
    except Exception:  # noqa: BLE001
        pass


# ── Profile: nickname + win-rate target ─────────────────────────────────────

@router.get("/auth/me/profile")
def my_profile(username: str = Depends(current_user)):
    u = db.get_user(username) or {}
    return {
        "username": username,
        "nickname": u.get("nickname") or username,
        "winTarget": float(u.get("win_target") or 60),
        "role": u.get("role"),
        "avatar": u.get("avatar"),
        "email": u.get("email"),
        "phone": u.get("phone"),
        "smsConfigured": sms.is_configured(),
        "whatsappConfigured": sms.whatsapp_configured(),
    }


@router.post("/auth/me/phone")
def set_my_phone(body: dict, username: str = Depends(current_user)):
    """Set the caller's phone number for SMS alerts (or clear it)."""
    phone = ((body or {}).get("phone") or "").strip() or None
    if phone and (len(phone) > 24 or not phone.replace("+", "").replace("-", "").replace(" ", "").isdigit()):
        raise HTTPException(status_code=400, detail="Enter a valid phone number, e.g. +14155551234")
    db.set_phone(username, phone)
    return {"ok": True, "phone": phone}


# ── Notification preferences (channels + alert types) ───────────────────────

@router.get("/auth/me/notifications")
def get_my_notifications(username: str = Depends(current_user)):
    prefs = db.get_notif_prefs(username)
    return {
        "prefs": prefs,
        "smsConfigured": sms.is_configured(),
        "whatsappConfigured": sms.whatsapp_configured(),
        "emailConfigured": email_svc.email_configured(),
    }


@router.put("/auth/me/notifications")
def set_my_notifications(body: dict, username: str = Depends(current_user)):
    prefs = (body or {}).get("prefs") if isinstance(body, dict) and "prefs" in body else body
    if not isinstance(prefs, dict):
        raise HTTPException(status_code=400, detail="Invalid preferences.")
    wa = (prefs.get("whatsappTo") or "").strip()
    if wa and (len(wa) > 24 or not wa.replace("+", "").replace("-", "").replace(" ", "").replace("whatsapp:", "").isdigit()):
        raise HTTPException(status_code=400, detail="Enter a valid WhatsApp number, e.g. +14155551234")
    saved = db.set_notif_prefs(username, prefs)
    return {"ok": True, "prefs": saved}


@router.post("/auth/me/notifications/test")
def test_my_notification(body: dict, username: str = Depends(current_user)):
    """Send the caller a test message on their currently-enabled channels."""
    name = db.display_name(username)
    text = f"✅ ALGO770: test alert for {name}. Your notifications are working!"
    sent = notify.notify_user(username, text)
    if not sent:
        raise HTTPException(status_code=400, detail="No channel enabled, or no phone/email set. Add a phone or email and enable SMS / WhatsApp / Email first.")
    return {"ok": True}


# ── Owner: add a WhatsApp alert recipient (one-call setup) ───────────────────

@router.post("/auth/whatsapp/recipient")
def set_whatsapp_recipient_portal(body: dict, owner: str = Depends(require_owner)):
    """OWNER: turn an existing user into a WhatsApp alert recipient in one call —
    set their phone, point the WhatsApp channel at it, enable WhatsApp, and (by
    default) turn on every alert type. body: { username, phone, allAlerts?=true }.

    Note: the recipient must have sent the sandbox join code (e.g. "join edge-year")
    from that WhatsApp number before Twilio's sandbox will deliver to them.
    """
    target = ((body or {}).get("username") or "").strip()
    phone = ((body or {}).get("phone") or "").strip()
    all_alerts = bool((body or {}).get("allAlerts", True))
    if not target:
        raise HTTPException(status_code=400, detail="username is required.")
    if not db.get_user(target):
        raise HTTPException(status_code=404, detail=f"No such user: {target}")
    if phone and not phone.startswith("+"):
        raise HTTPException(status_code=400, detail="Phone must be E.164 (start with +, e.g. +972538821770).")
    prefs = db.set_whatsapp_recipient(target, phone, all_alerts=all_alerts)
    return {
        "ok": True, "username": target, "phone": prefs.get("phone"),
        "whatsappTo": prefs.get("whatsappTo"), "whatsapp": prefs.get("whatsapp"),
        "whatsappConfigured": sms.whatsapp_configured(),
    }


# ── Admin broadcast (SMS / WhatsApp blast) ──────────────────────────────────

@router.post("/auth/broadcast")
def admin_broadcast(body: dict, admin: str = Depends(require_admin)):
    """Send an SMS or WhatsApp blast.

    body: { text, channel: 'sms'|'whatsapp', target: 'all'|'demo'|'u1,u2' }
    """
    text = ((body or {}).get("text") or "").strip()
    channel = ((body or {}).get("channel") or "sms").strip().lower()
    target = ((body or {}).get("target") or "all").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message text is required.")
    if channel not in ("sms", "whatsapp"):
        raise HTTPException(status_code=400, detail="Channel must be sms or whatsapp.")
    if not sms.channel_configured(channel):
        raise HTTPException(status_code=400, detail=f"{channel.upper()} is not configured on the server.")

    recipients = db.broadcast_recipients(target)
    sent, skipped = 0, []
    for r in recipients:
        to = r["whatsappTo"] if channel == "whatsapp" else r["phone"]
        if not to:
            skipped.append(r["username"])
            continue
        if sms.send(channel, to, text):
            sent += 1
        else:
            skipped.append(r["username"])
    return {"ok": True, "sent": sent, "skipped": skipped, "total": len(recipients), "channel": channel}


# ── Feature promo — the home "NEW" widget (+ optional SMS blast) ─────────────

@router.get("/auth/announcement")
def get_announcement(_: str = Depends(current_user)):
    """Current active promo for the home-page NEW widget (or null)."""
    return {"promo": db.get_feature_promo()}


@router.post("/auth/announcement")
def set_announcement(body: dict, admin: str = Depends(require_admin)):
    """Publish a feature promo to the home NEW widget, optionally blasting SMS.

    body: { title, body, route, cta, sms?: bool, channel?: 'sms'|'whatsapp', target?: str }
    """
    title = ((body or {}).get("title") or "").strip()
    text = ((body or {}).get("body") or "").strip()
    # Empty route = text-only announcement (no link / no CTA). A non-empty route
    # links the home banner to that screen, exactly as before (back-compatible).
    route = ((body or {}).get("route") or "").strip()
    cta = ((body or {}).get("cta") or "").strip()
    if not title and not text:
        raise HTTPException(status_code=400, detail="Add a title or some text for the promo.")
    promo = db.set_feature_promo(title, text, route, cta)

    result = {"ok": True, "promo": promo, "sms": None}
    if (body or {}).get("sms"):
        channel = ((body or {}).get("channel") or "sms").strip().lower()
        target = ((body or {}).get("target") or "all").strip()
        if channel not in ("sms", "whatsapp"):
            raise HTTPException(status_code=400, detail="Channel must be sms or whatsapp.")
        if not sms.channel_configured(channel):
            raise HTTPException(status_code=400, detail=f"{channel.upper()} is not configured on the server.")
        msg = " ".join(p for p in [("🚀 " + title) if title else "", text] if p).strip() or title
        recipients = db.broadcast_recipients(target)
        sent, skipped = 0, []
        for r in recipients:
            to = r["whatsappTo"] if channel == "whatsapp" else r["phone"]
            if not to:
                skipped.append(r["username"]); continue
            if sms.send(channel, to, msg):
                sent += 1
            else:
                skipped.append(r["username"])
        result["sms"] = {"sent": sent, "skipped": skipped, "total": len(recipients), "channel": channel}
    return result


@router.delete("/auth/announcement")
def clear_announcement(admin: str = Depends(require_admin)):
    """Take the home NEW widget down."""
    db.clear_feature_promo()
    return {"ok": True}


@router.post("/auth/demo-reminders")
def send_demo_reminders_now(admin: str = Depends(require_admin)):
    """Manually fire the daily demo-tester reminder blast (time left + score)."""
    from app.services.demo_reminders import send_demo_reminders
    return {"ok": True, "sent": send_demo_reminders()}


@router.post("/auth/me/email")
def set_my_email(body: dict, username: str = Depends(current_user)):
    """Update the caller's own email."""
    email = ((body or {}).get("email") or "").strip() or None
    if email and ("@" not in email or "." not in email or len(email) > 200):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    db.update_user_email(username, email)
    return {"ok": True, "email": email}


@router.post("/auth/me/password")
def change_my_password(body: dict, username: str = Depends(current_user)):
    """Change the caller's own password (requires the current password)."""
    cur = (body or {}).get("currentPassword") or ""
    new = (body or {}).get("newPassword") or ""
    if len(new) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters.")
    u = db.get_user(username)
    if not u or not verify_password(cur, u["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    db.update_user_password(username, hash_password(new))
    return {"ok": True}


@router.post("/auth/me/avatar")
def set_avatar(body: dict, username: str = Depends(current_user)):
    """Set the caller's profile picture (a small data:image/... URL) or clear it."""
    data = ((body or {}).get("avatar") or "").strip()
    if data and not data.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="avatar must be a data:image URL")
    if len(data) > 700_000:  # client should downscale; keeps the DB small
        raise HTTPException(status_code=400, detail="Image too large — pick a smaller picture.")
    db.set_avatar(username, data or None)
    return {"ok": True}


@router.post("/auth/me/nickname")
def set_nickname(body: dict, username: str = Depends(current_user)):
    nick = ((body or {}).get("nickname") or "").strip()
    if len(nick) > 32:
        raise HTTPException(status_code=400, detail="Nickname too long (max 32).")
    db.set_nickname(username, nick or None)
    return {"ok": True, "nickname": nick or username}


@router.post("/auth/me/win-target")
def set_win_target(body: dict, username: str = Depends(current_user)):
    try:
        target = float((body or {}).get("target"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="target must be a number 0-100")
    db.set_win_target(username, target)
    return {"ok": True, "winTarget": max(0.0, min(100.0, target))}


@router.get("/auth/section-access")
def section_access(username: str = Depends(current_user)):
    """The CURRENT user's locked section paths + whether the caller is admin."""
    u = db.get_user(username) or {}
    return {"locked": db.get_user_locked(username), "isAdmin": u.get("role") == "admin"}


@router.post("/auth/section-access")
def set_section_access(body: dict, request: Request, admin: str = Depends(require_admin)):
    """Set the GLOBAL default locked sections (applies to users without an override)."""
    locked = (body or {}).get("locked") or []
    if not isinstance(locked, list):
        locked = []
    db.set_section_access(locked)
    db.add_audit("section_access.set", actor=admin, ip=_ip(request), detail={"locked": locked})
    return {"ok": True, "locked": db.get_section_access().get("locked", [])}


@router.get("/auth/users/{target}/access")
def get_user_access(target: str, admin: str = Depends(require_admin)):
    if db.get_user(target) is None:
        raise HTTPException(status_code=404, detail="user not found")
    assert_can_manage_user(admin, target)  # secondary admins: regular users only, not admins
    return {"username": target, "locked": db.get_user_locked(target)}


@router.post("/auth/users/{target}/access")
def set_user_access(target: str, body: dict, request: Request, admin: str = Depends(require_admin)):
    """Set a SPECIFIC user's locked sections (per-user override)."""
    if db.get_user(target) is None:
        raise HTTPException(status_code=404, detail="user not found")
    assert_can_manage_user(admin, target)  # can't change an admin's/super-admin's access
    locked = (body or {}).get("locked") or []
    if not isinstance(locked, list):
        locked = []
    db.set_user_locked(target, locked)
    db.add_audit("user.access.set", actor=admin, target=target, ip=_ip(request), detail={"locked": locked})
    return {"ok": True, "username": target, "locked": db.get_user_locked(target)}


@router.get("/auth/me/analytics")
def my_analytics(username: str = Depends(current_user)):
    u = db.get_user(username) or {}
    stats = db.win_analytics()
    target = float(u.get("win_target") or 60)
    stats["winTarget"] = target
    stats["onTarget"] = stats["winRate"] >= target
    stats["gapToTarget"] = round(target - stats["winRate"], 1)
    return stats


# ── In-app chat ─────────────────────────────────────────────────────────────

@router.get("/auth/chat/contacts")
def chat_contacts(username: str = Depends(current_user)):
    return {"contacts": db.chat_contacts(username)}


@router.post("/auth/chat/send")
def chat_send(body: dict, username: str = Depends(current_user)):
    text = ((body or {}).get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty message")
    if len(text) > 2000:
        text = text[:2000]
    gid = (body or {}).get("groupId")
    if gid:
        gid = int(gid)
        if not db.group_member_ok(username, gid):
            raise HTTPException(status_code=403, detail="not a member of this group")
        msg = db.chat_send(username, None, text, group_id=gid)
        db.add_loyalty(username, "chat", 1)  # gamification: reward chat participation
        # Push the group message to each member's enabled channels (not the sender).
        sender = db.display_name(username)
        gname = (db.get_group(gid) or {}).get("name") or "group"
        for m in db.list_group_members(gid):
            if m != username:
                notify.notify_user(m, f"💬 {sender} in {gname}: {text[:140]}", kind="chat")
        _mirror_chat_to_telegram(username, f"{sender} in {gname}", text)
        return {"ok": True, "message": msg}
    to = (body or {}).get("to") or None
    if to in ("all", "everyone", ""):
        to = None
    if to is not None and db.get_user(to) is None:
        raise HTTPException(status_code=404, detail="recipient not found")
    msg = db.chat_send(username, to, text)
    db.add_loyalty(username, "chat", 1)  # gamification: reward chat participation
    # Push a DM to the recipient's enabled channels (SMS/WhatsApp), per their prefs.
    if to:
        notify.notify_user(to, f"💬 {db.display_name(username)} messaged you on ALGO770: {text[:140]}", kind="chat")
    _mirror_chat_to_telegram(username, f"{db.display_name(username)} → {db.display_name(to) if to else 'everyone'}", text)
    return {"ok": True, "message": msg}


@router.get("/auth/chat/poll")
def chat_poll(since: int = 0, username: str = Depends(current_user)):
    msgs = db.chat_poll(username, since_id=since)
    return {"messages": msgs}


# ── Built-in Assistant: inbox + reply (admin-driven auto-responder) ──────────

@router.get("/auth/assistant/inbox")
def get_assistant_inbox(_: str = Depends(require_admin)):
    """Unanswered messages sent to the Assistant, from the saved cursor onward."""
    db.ensure_assistant_user()
    cur = db.assistant_cursor()
    return {"cursor": cur, "messages": db.assistant_inbox(cur)}


@router.post("/auth/assistant/reply")
def assistant_reply(body: dict, _: str = Depends(require_admin)):
    """Post an Assistant reply to a user, and (optionally) advance the cursor."""
    to = ((body or {}).get("to") or "").strip()
    text = ((body or {}).get("text") or "").strip()
    ack_id = (body or {}).get("ackId")
    if not to or not text:
        raise HTTPException(status_code=400, detail="to and text are required.")
    db.ensure_assistant_user()
    msg = db.chat_send("assistant", to, text[:2000])  # delivered in-app via chat_poll
    if ack_id is not None:
        try:
            db.set_assistant_cursor(int(ack_id))
        except Exception:  # noqa: BLE001
            pass
    # Also push it to the user's enabled SMS/WhatsApp channels (their prefs decide).
    try:
        notify.notify_user(to, f"🤖 Assistant: {text[:140]}", kind="chat")
    except Exception:  # noqa: BLE001
        pass
    # Two-way bridge: if this user reached us via the Telegram bot, mirror the
    # reply straight back to that chat so the conversation is closed end-to-end.
    try:
        from app.services import telegram as tg
        cfg = db.get_telegram_config()
        token = cfg.get("botToken")
        chat_id = db.get_telegram_chat_for_user(to)
        if cfg.get("notifyAssistant", True) and token and chat_id:
            tg.send_to_chat(token, chat_id, f"🤖 <b>Assistant</b>\n{html.escape(text[:1000])}")
        # Mirror a copy to the admin chat too (visibility of what was answered).
        if cfg.get("notifyAssistant", True):
            tg.notify_admin(f"🤖 <b>Assistant → {html.escape(db.display_name(to))}</b>\n{html.escape(text[:400])}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("assistant_reply telegram mirror error: %s", str(exc)[:200])
    return {"ok": True, "message": msg}


# ── Admin → user messages (branded "reply to a user", read in-app) ───────────

@router.post("/auth/admin/message")
def admin_send_message(body: dict, admin: str = Depends(require_admin)):
    """Any admin sends a stored, branded message to a single user.

    body: { to, title?, body }. The user reads it in-app via /auth/my-messages.
    """
    to = ((body or {}).get("to") or "").strip()
    title = ((body or {}).get("title") or "").strip() or None
    text = ((body or {}).get("body") or "").strip()
    if not to or not text:
        raise HTTPException(status_code=400, detail="to and body are required.")
    # Canonicalize the recipient (case-insensitive username/nickname → canonical
    # username) so the stored `recipient` matches what the logged-in user's inbox
    # query (list_user_messages / count_unread_messages) reads — same as the chat path.
    canonical = db.resolve_user(to)
    if canonical is None:
        raise HTTPException(status_code=404, detail="recipient not found")
    to = canonical
    if title and len(title) > 200:
        title = title[:200]
    if len(text) > 8000:
        text = text[:8000]
    mid = db.create_admin_message(to, admin, title, text)
    # Ping the recipient on their enabled SMS/WhatsApp channels (same pattern as
    # chat_send). 'team_message' is an opt-in alert key; notify defaults to send.
    try:
        notify.notify_user(to, f"📩 הודעה חדשה מצוות Strateteach: {title or ''}".strip(), kind="team_message")
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "id": mid}


@router.get("/auth/my-messages")
def my_messages(username: str = Depends(current_user)):
    """The caller's received admin messages, newest first (read flag included)."""
    rows = db.list_user_messages(username)
    messages = [
        {
            "id": r["id"],
            "sender": r["sender"],
            "title": r["title"],
            "body": r["body"],
            "createdAt": r["created_at"],
            "read": bool(r["read"]),
        }
        for r in rows
    ]
    return {"messages": messages}


@router.post("/auth/my-messages/{message_id}/read")
def mark_my_message_read(message_id: int, username: str = Depends(current_user)):
    """Mark one of the caller's own messages as read (recipient-guarded in DB)."""
    db.mark_message_read(message_id, username)
    return {"ok": True}


@router.get("/auth/my-messages/unread-count")
def my_unread_message_count(username: str = Depends(current_user)):
    """Badge count of the caller's unread admin messages."""
    return {"count": db.count_unread_messages(username)}


# ── Admin "Reply to users" INBOX ─────────────────────────────────────────────
# A consolidated inbox that aggregates inbound user activity — direct DMs to an
# admin/assistant (chat_messages) AND Service-Hub feedback (requests, user_request) —
# grouped by user, so any admin can see who's waiting and reply inline. Replies reuse
# the existing chat_send (admin → user), delivered in-app via chat_poll (+ the user's
# notification channels). Admin-gated (require_admin); reuses existing infra only.

@router.get("/auth/admin/inbox")
def admin_inbox(_: str = Depends(require_admin)):
    """Inbound user threads (DMs + feedback) grouped by user, needs-reply first."""
    chat_peers = {p["userId"]: p for p in db.admin_chat_peers()}
    reqs = db.list_requests(category="user_request")          # newest-first
    latest_req: dict = {}
    req_needs: dict = {}
    for r in reqs:
        uid = r.get("user_id")
        if not uid:
            continue
        if uid not in latest_req:                             # first seen = latest
            latest_req[uid] = r
        if r.get("status") in ("new", "in_progress"):
            req_needs[uid] = True
    threads = []
    for uid in set(chat_peers) | set(latest_req):
        cp = chat_peers.get(uid)
        rq = latest_req.get(uid)
        cand = []
        if cp:
            cand.append((cp["ts"] or "", cp["body"] or "", cp["fromUser"]))
        if rq:
            snip = ((rq.get("subject") or "") + " — " if rq.get("subject") else "") + (rq.get("body") or "")
            cand.append(((rq.get("updated_at") or rq.get("created_at") or ""), snip, False))
        cand.sort(key=lambda x: x[0], reverse=True)
        latest = cand[0]
        needs = bool((cp and cp["fromUser"]) or req_needs.get(uid))
        threads.append({
            "userId": uid, "displayName": db.display_name(uid),
            "latestTs": latest[0], "snippet": (latest[1] or "").strip()[:160],
            "needsReply": needs,
            "sources": [s for s in (("chat" if cp else None), ("feedback" if rq else None)) if s],
        })
    threads.sort(key=lambda t: (t["needsReply"], t["latestTs"] or ""), reverse=True)
    return {"threads": threads, "count": len(threads),
            "needsReplyCount": sum(1 for t in threads if t["needsReply"])}


@router.get("/auth/admin/inbox/{user}")
def admin_inbox_thread(user: str, _: str = Depends(require_admin)):
    """One user's merged thread — their DMs with admins + their feedback + replies."""
    canonical = db.resolve_user(user) or user
    items = []
    for m in db.admin_user_chat_thread(canonical):
        items.append({"ts": m["ts"], "text": m["body"], "fromUser": m["fromUser"],
                      "author": m["author"], "source": "chat"})
    for r in db.list_requests(category="user_request", user_id=canonical):
        subj = r.get("subject")
        items.append({"ts": r.get("created_at"),
                      "text": (f"[{subj}] " if subj else "") + (r.get("body") or ""),
                      "fromUser": True, "author": db.display_name(canonical),
                      "source": "feedback", "requestId": r["id"], "status": r.get("status")})
        for rep in db.list_request_replies(r["id"]):
            items.append({"ts": rep.get("created_at"), "text": rep.get("text") or "",
                          "fromUser": (rep.get("author_id") == canonical),
                          "author": rep.get("author_name"), "source": "feedback"})
    items.sort(key=lambda x: x["ts"] or "")
    return {"userId": canonical, "displayName": db.display_name(canonical), "items": items}


@router.post("/auth/admin/inbox/reply")
def admin_inbox_reply(body: dict, admin: str = Depends(require_admin)):
    """Reply to a user, reusing chat_send (admin → user; delivered in-app + channels)."""
    to = ((body or {}).get("to") or "").strip()
    text = ((body or {}).get("text") or "").strip()
    if not to or not text:
        raise HTTPException(status_code=400, detail="to and text are required.")
    canonical = db.resolve_user(to)
    if not canonical:
        raise HTTPException(status_code=404, detail="recipient not found")
    if len(text) > 2000:
        text = text[:2000]
    msg = db.chat_send(admin, canonical, text)
    try:
        notify.notify_user(canonical, f"💬 {db.display_name(admin)} messaged you on ALGO770: {text[:140]}", kind="chat")
    except Exception:  # noqa: BLE001
        pass
    _mirror_chat_to_telegram(admin, f"{db.display_name(admin)} → {db.display_name(canonical)}", text)
    return {"ok": True, "message": msg}


# ── Owner / Requests portal (mini help-desk) ─────────────────────────────────
# A single management surface for user requests (every Service-Hub feedback lands
# here as a request row) + internal owner notes. Replies live in a per-request
# thread; an admin reply to a user_request is ALSO delivered to that user via the
# existing admin_messages "Team Message" path. Visibility: admins see EVERYTHING
# (both categories); a regular user sees ONLY their own user_requests.

def _request_json(r: dict) -> dict:
    return {
        "id": r["id"], "userId": r.get("user_id"), "displayName": r.get("display_name"),
        "category": r.get("category"), "subject": r.get("subject"), "body": r.get("body") or "",
        "media": r.get("media"), "route": r.get("route"), "status": r.get("status") or "new",
        "createdAt": r.get("created_at"), "updatedAt": r.get("updated_at"),
        "replyCount": int(r.get("reply_count") or 0),
    }


def _reply_json(r: dict) -> dict:
    return {"id": r["id"], "authorId": r.get("author_id"), "authorName": r.get("author_name"),
            "text": r.get("text") or "", "createdAt": r.get("created_at")}


@router.get("/auth/requests")
def list_requests_portal(category: str | None = None, status: str | None = None,
                         username: str = Depends(current_user)):
    """OWNERS (Dan/Rafi/Yoav) get ALL requests (both categories, filterable by
    category + status). Everyone else — incl. a NON-owner admin — gets ONLY their
    own user_requests (their support inbox; owner_notes are owner-only)."""
    owner = is_owner(username)
    st = status if status in db.REQUEST_STATUSES else None
    if owner:
        cat = category if category in db.REQUEST_CATEGORIES else None
        rows = db.list_requests(category=cat, status=st)
    else:
        rows = db.list_requests(category="user_request", status=st, user_id=username)
    # `isAdmin` is kept for back-compat; `isOwner` is the authoritative flag.
    return {"requests": [_request_json(r) for r in rows], "isAdmin": owner, "isOwner": owner}


@router.get("/auth/requests/{req_id}")
def get_request_portal(req_id: int, username: str = Depends(current_user)):
    """One request + its reply thread. A non-owner may open ONLY their own user_request."""
    owner = is_owner(username)
    req = db.get_request(req_id)
    if not req:
        raise HTTPException(404, "No such request.")
    if not owner and not (req.get("category") == "user_request" and req.get("user_id") == username):
        raise HTTPException(403, "Not your request.")
    replies = [_reply_json(x) for x in db.list_request_replies(req_id)]
    return {"request": {**_request_json(req), "replies": replies}, "isAdmin": owner, "isOwner": owner}


@router.post("/auth/requests/{req_id}/replies")
def reply_request_portal(req_id: int, body: dict, username: str = Depends(current_user)):
    """Post a reply. An admin/owner may answer any request (delivered to the user
    for a user_request, via the existing Team Message path). The owning user may
    append a follow-up to THEIR OWN user_request (re-opens it + pings the admin)."""
    owner = is_owner(username)
    req = db.get_request(req_id)
    if not req:
        raise HTTPException(404, "No such request.")
    is_owner_user = (req.get("category") == "user_request" and req.get("user_id") == username)
    if not owner and not is_owner_user:
        raise HTTPException(403, "Only an owner or the request owner can reply here.")
    text = ((body or {}).get("text") or "").strip()
    if not text:
        raise HTTPException(400, "Reply text is required.")
    if len(text) > 8000:
        text = text[:8000]
    author_name = db.display_name(username)
    db.add_request_reply(req_id, username, author_name, text)

    wa_status: dict | None = None
    if owner:
        # Deliver an admin/owner reply to the user (Team Message) for a user_request,
        # ping their channels, and mark it answered. owner_notes are internal — they
        # get the thread entry but no user delivery.
        if req.get("category") == "user_request" and req.get("user_id"):
            to = req["user_id"]
            subject = (req.get("subject") or "פנייה / Request")
            try:
                db.create_admin_message(to, username, f"↩︎ {subject}"[:200], text)
            except Exception:  # noqa: BLE001
                logger.warning("request reply: admin_message delivery failed")
            # Two-way: deliver the ACTUAL reply text over WhatsApp (window-aware; a
            # template is required outside the 24h window). SMS/email get the same
            # real reply text via notify_user (WhatsApp excluded here to avoid a
            # duplicate — send_whatsapp_reply owns that channel + returns its status).
            try:
                wa_status = notify.send_whatsapp_reply(to, text)
            except Exception:  # noqa: BLE001
                pass
            try:
                notify.notify_user(to, text, kind="team_message", channels={"sms", "email"})
            except Exception:  # noqa: BLE001
                pass
        db.set_request_status(req_id, "answered")
    else:
        # User follow-up on their own request → re-open if it was closed + ping admin.
        if req.get("status") in ("answered", "resolved"):
            db.set_request_status(req_id, "new")
        try:
            from app.services import telegram as tg
            tg.notify_admin(f"💬 <b>Request follow-up</b> from {html.escape(author_name)}\n{html.escape(text[:400])}")
        except Exception:  # noqa: BLE001
            pass
    resp: dict = {"ok": True}
    # Surface WhatsApp delivery status so the portal can flag when a template is
    # required (owner replied outside the user's 24h free-form window).
    if wa_status and wa_status.get("enabled"):
        resp["whatsapp"] = wa_status
        if wa_status.get("needsTemplate"):
            resp["whatsappNote"] = ("WhatsApp is outside the 24h window — a Twilio "
                                    "template is required to deliver this reply.")
    return resp


@router.post("/auth/requests/{req_id}/status")
def set_request_status_portal(req_id: int, body: dict, owner: str = Depends(require_owner)):
    """Owner updates a request's status (new/in_progress/answered/resolved)."""
    req = db.get_request(req_id)
    if not req:
        raise HTTPException(404, "No such request.")
    status = ((body or {}).get("status") or "").strip()
    if status not in db.REQUEST_STATUSES:
        raise HTTPException(400, "Invalid status.")
    db.set_request_status(req_id, status)
    return {"ok": True, "status": status}


@router.post("/auth/requests")
def create_owner_note(body: dict, owner: str = Depends(require_owner)):
    """Owner creates an internal owner_note (site structure / 'what's stuck')."""
    subject = ((body or {}).get("subject") or "").strip() or None
    text = ((body or {}).get("body") or "").strip()
    if not text and not subject:
        raise HTTPException(400, "Add a subject or a note.")
    rid = db.create_request(owner, db.display_name(owner), "owner_note", subject, text, status="new")
    return {"ok": True, "id": rid}


@router.post("/auth/requests/backfill")
def backfill_requests_portal(owner: str = Depends(require_owner)):
    """Owner: import any not-yet-mirrored feedback (the chat "suggestions") into the
    portal as user_requests. Idempotent + self-healing — preserves the original
    author + timestamp, and is safe to run repeatedly (it also runs once
    automatically on boot)."""
    n = db.backfill_feedback_into_requests()
    return {"ok": True, "imported": n}


# ── Friends + groups ────────────────────────────────────────────────────────

@router.get("/auth/friends")
def friends(username: str = Depends(current_user)):
    reqs = db.list_friend_requests(username)
    return {"friends": db.list_friends(username), "incoming": reqs["incoming"], "outgoing": reqs["outgoing"]}


@router.post("/auth/friends/request")
def friend_request(body: dict, username: str = Depends(current_user)):
    raw = ((body or {}).get("to") or "").strip()
    to = db.resolve_user(raw)  # accept username OR nickname, case-insensitive
    if not to:
        raise HTTPException(status_code=404, detail=f"No user found matching “{raw}”")
    if to == username:
        raise HTTPException(status_code=400, detail="That's you 🙂")
    db.friend_request(username, to)
    phone = (db.get_user(to) or {}).get("phone")
    if phone:
        who = db.display_name(username)
        sms.send_sms(phone, f"{who} sent you a friend request on ALGO770 — open the app to approve.")
    try:
        from app.services import telegram as tg
        tg.notify_admin(f"🤝 <b>Friend request</b>\n{html.escape(db.display_name(username))} → {html.escape(db.display_name(to))}")
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "to": to}


@router.post("/auth/friends/accept")
def friend_accept(body: dict, username: str = Depends(current_user)):
    frm = ((body or {}).get("from") or "").strip()
    if not frm:
        raise HTTPException(status_code=400, detail="missing 'from'")
    db.friend_accept(username, frm)
    return {"ok": True}


@router.post("/auth/friends/remove")
def friend_remove(body: dict, username: str = Depends(current_user)):
    other = ((body or {}).get("user") or "").strip()
    if other:
        db.friend_remove(username, other)
    return {"ok": True}


@router.get("/auth/groups")
def groups(username: str = Depends(current_user)):
    return {"groups": db.list_groups(username)}


@router.post("/auth/groups")
def create_group(body: dict, username: str = Depends(current_user)):
    name = ((body or {}).get("name") or "").strip()[:60]
    if not name:
        raise HTTPException(status_code=400, detail="group name required")
    members = [m for m in ((body or {}).get("members") or []) if db.get_user(m)]
    gid = db.create_group(name, username, members)
    return {"ok": True, "id": gid}


@router.post("/auth/groups/{group_id}/members")
def add_group_member(group_id: int, body: dict, username: str = Depends(current_user)):
    """Add a user to an existing group. Any current member may add others."""
    if not db.group_member_ok(username, group_id):
        raise HTTPException(status_code=403, detail="not a member of this group")
    to_add = [m for m in ((body or {}).get("members") or []) if db.get_user(m)]
    if not to_add:
        raise HTTPException(status_code=400, detail="no valid users to add")
    for m in to_add:
        db.add_group_member(group_id, m)
    return {"ok": True, "added": to_add}


# ── Rewards (admin → users) + chat deletion ─────────────────────────────────

@router.post("/auth/rewards")
def send_reward(body: dict, request: Request, admin: str = Depends(require_admin)):
    """Admin sends a celebration (e.g. flying confetti) to a user or everyone."""
    to = (body or {}).get("to") or None
    if to in ("all", "everyone", ""):
        to = None
    if to is not None and db.get_user(to) is None:
        raise HTTPException(status_code=404, detail="user not found")
    kind = (body or {}).get("kind") or "confetti"
    rid = db.add_reward(admin, to, kind)
    db.add_audit("reward.send", actor=admin, target=to or "everyone", ip=_ip(request), detail={"kind": kind})
    return {"ok": True, "id": rid}


@router.get("/auth/rewards")
def my_rewards(since: int = 0, username: str = Depends(current_user)):
    return {"rewards": db.pending_rewards(username, since_id=since)}


@router.post("/auth/chat/delete")
def chat_delete(body: dict, username: str = Depends(current_user)):
    gid = (body or {}).get("groupId")
    if gid:
        gid = int(gid)
        g = db.get_group(gid)
        u = db.get_user(username) or {}
        if not g or (g.get("created_by") != username and u.get("role") != "admin"):
            raise HTTPException(status_code=403, detail="only the group creator or an admin can clear a group")
        db.delete_group_messages(gid)
        return {"ok": True}
    other = (body or {}).get("with")
    if other:
        db.delete_dm(username, other)
        return {"ok": True}
    u = db.get_user(username) or {}
    if u.get("role") != "admin":
        raise HTTPException(status_code=403, detail="only an admin can clear the everyone chat")
    db.delete_broadcast_messages()
    return {"ok": True}


# ── Admin screen-capture ────────────────────────────────────────────────────

@router.post("/auth/screen/request")
def screen_request(body: dict, request: Request, admin: str = Depends(require_admin)):
    target = (body or {}).get("user") or ""
    if db.get_user(target) is None:
        raise HTTPException(status_code=404, detail="user not found")
    req = db.screen_request(target, admin)
    db.add_audit("screen.request", actor=admin, target=target, ip=_ip(request))
    return {"ok": True, "requestId": req["id"]}


@router.get("/auth/screen/pending")
def screen_pending(username: str = Depends(current_user)):
    """The user's browser polls this; if a request is pending it captures + uploads."""
    pend = db.screen_pending_for(username)
    return {"capture": bool(pend), "requestId": pend["id"] if pend else None}


@router.get("/auth/screen/active")
def screen_active(username: str = Depends(current_user)):
    """Drives the 'an admin is viewing your screen' banner on the user side."""
    return {"watched": db.screen_is_watched(username)}


@router.post("/auth/screen/upload")
def screen_upload(body: dict, username: str = Depends(current_user)):
    rid = (body or {}).get("requestId")
    image = (body or {}).get("image") or ""
    route = (body or {}).get("route")
    if not rid:
        raise HTTPException(status_code=400, detail="requestId required")
    # Guard: only fulfil a request that actually targets this user.
    pend = db.screen_capture_image(int(rid))
    if not pend or pend.get("target_user") != username:
        raise HTTPException(status_code=403, detail="not your capture request")
    db.screen_upload(int(rid), image, route)
    return {"ok": True}


@router.get("/auth/screen/captures")
def screen_captures(admin: str = Depends(require_admin)):
    return {"captures": db.screen_captures()}


@router.get("/auth/screen/capture/{capture_id}")
def screen_capture(capture_id: int, admin: str = Depends(require_admin)):
    cap = db.screen_capture_image(capture_id)
    if not cap:
        raise HTTPException(status_code=404, detail="not found")
    return cap
