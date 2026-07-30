"""Self-signup approval logic — shared by the HTTP admin routes and the Telegram
admin bot, so a request can be approved/denied from either place."""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

from app import database as db
from app.services import sms as smssvc
from app.services import email as mailer
from app.services.auth import hash_password

_DEMO_MINUTES = 7 * 24 * 60  # 1 week
DEFAULT_PASSWORD = "demo@1234"


def _app_url() -> str:
    base = os.environ.get("APP_URL") or os.environ.get("DOMAIN") or "app.strateteach.com"
    return base if base.startswith("http") else f"https://{base}"


def approve(req_id: int, handled_by: str) -> dict:
    """Create a 1-week demo account for a pending request and message the login.
    Returns {ok, username, ...} or {ok:False, error}."""
    req = db.get_signup_request(req_id)
    if not req:
        return {"ok": False, "error": "not_found"}
    if req.get("status") != "pending":
        # Idempotent: report the already-created username if present.
        return {"ok": False, "error": "already_handled", "status": req.get("status"), "username": req.get("username")}

    username = db.unique_username(req.get("email") or req.get("name") or "user")
    db.create_user(username, hash_password(DEFAULT_PASSWORD), role="user", email=req.get("email"), created_by=handled_by)
    if req.get("phone"):
        db.set_phone(username, req["phone"])
    expires = (datetime.now(timezone.utc) + timedelta(minutes=_DEMO_MINUTES)).isoformat()
    db.mark_demo_user(username, expires, plan="pro")
    db.join_suggestions_group(username)
    db.set_signup_request_status(req_id, "approved", handled_by, username)
    db.add_audit("signup.approve", actor=handled_by, target=username)

    base = _app_url()
    name = req.get("name") or username
    text = (f"Hi {name}! Your ALGO770 access is approved ✅\n"
            f"Log in at {base}\nUser: {username}\nPassword: {DEFAULT_PASSWORD}\nWelcome aboard! \U0001F48E")
    if req.get("phone"):
        smssvc.send_sms(req["phone"], text)
    if req.get("email"):
        html = (f"<p>Hi {name},</p><p>Your <b>ALGO770</b> access is approved ✅</p>"
                f"<p>Log in at <a href=\"{base}\">{base}</a><br>User: <b>{username}</b><br>"
                f"Password: <b>{DEFAULT_PASSWORD}</b></p><p>Welcome aboard! \U0001F48E</p>")
        mailer.send_email(req["email"], "Your ALGO770 access is ready", text, body_html=html)
    return {"ok": True, "username": username, "name": name, "sentSms": bool(req.get("phone")), "sentEmail": bool(req.get("email"))}


def deny(req_id: int, handled_by: str) -> dict:
    req = db.get_signup_request(req_id)
    if not req:
        return {"ok": False, "error": "not_found"}
    db.set_signup_request_status(req_id, "denied", handled_by)
    db.add_audit("signup.deny", actor=handled_by, detail={"id": req_id})
    return {"ok": True, "name": req.get("name")}
