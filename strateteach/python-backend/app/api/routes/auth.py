"""Authentication, RBAC-gated user management, lockout, audit, and password reset."""
from __future__ import annotations

import html
import logging
import os
import re
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app import database as db
from app.core.security import (
    current_user, require_admin, require_owner, assert_can_manage_user,
    block_nonadmin_during_maintenance, is_owner,
)
from pydantic import BaseModel
from app.services import email as mailer
from app.services import login_otp
from app.services import totp as totp_svc
from app.services.auth import bearer_from_header, hash_password, new_token, verify_password

logger = logging.getLogger("algo770")

router = APIRouter(tags=["auth"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post("/auth/login")
def login(body: dict, request: Request):
    username = (body or {}).get("username", "")
    password = (body or {}).get("password", "")
    ip = _ip(request)

    # Brute-force protection: a locked account is refused before any hash check.
    if db.lock_status(username):
        db.add_audit("login.locked", actor=username, ip=ip)
        raise HTTPException(status_code=429, detail="Account temporarily locked. Try again later.")

    user = db.get_user(username)
    if not user or not verify_password(password, user["password_hash"]):
        if user:
            db.record_failed_login(username)
        db.add_audit("login.failed", actor=username, ip=ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Maintenance gate: credentials are valid, but only admins may obtain a token
    # while the app is in maintenance (mirrors the middleware that gates every
    # already-authenticated request). Raises 503 for non-admins.
    block_nonadmin_during_maintenance(user)

    # Login 2FA. Admins are exempt (never lock an admin out on a delivery hiccup).
    if user.get("role") != "admin":
        # PRIMARY factor: TOTP authenticator app (RFC 6238), if the user set it up.
        # Nothing is SENT — the user reads the code from their app — so this path
        # has zero cost and works offline. The Telegram/email code is offered only
        # as a lost-device RECOVERY option (see /auth/login/recovery).
        if user.get("totp_enabled") and user.get("totp_secret"):
            db.add_audit("login.2fa_totp_prompt", actor=username, ip=ip)
            return {"twofa": True, "username": username, "method": "totp",
                    "recoveryAvailable": login_otp.is_available(username, user)}

        # Otherwise, channel-OTP 2FA: generate a one-time code and deliver it over
        # a FREE channel (Telegram if linked, else email) — NOT paid SMS.
        if user.get("twofa_enabled"):
            res = login_otp.start(username, user, purpose="login")
            if res.get("ok") or res.get("reason") == "cooldown":
                # cooldown = a live code went out moments ago; still require it.
                db.add_audit("login.2fa_sent", actor=username, ip=ip, detail={"channel": res.get("channel")})
                return {"twofa": True, "username": username, "method": "otp",
                        "channel": res.get("channel"), "channelHint": res.get("hint")}
            # No Telegram and no email on file (and SMS last-resort is off): we can't
            # deliver a code. Fail CLOSED — never downgrade a 2FA account to
            # password-only — but say exactly why so support can fix the channel.
            db.add_audit("login.2fa_no_channel", actor=username, ip=ip)
            raise HTTPException(
                status_code=503,
                detail="We couldn't send your login code — no Telegram or email is on file "
                       "for this account. Please contact support to add one.")

    db.clear_failed_login(username)
    token = new_token()
    db.create_session(token, username)
    db.add_audit("login.success", actor=username, ip=ip)
    return {"token": token, "username": username, "role": user["role"],
            "mustChangePassword": bool(user.get("must_change_password"))}


@router.post("/auth/login/verify")
def login_verify(body: dict, request: Request):
    """Second step of 2FA login: re-check password + the one-time code, then issue a token."""
    username = (body or {}).get("username", "")
    password = (body or {}).get("password", "")
    code = ((body or {}).get("code") or "").strip()
    ip = _ip(request)

    if db.lock_status(username):
        raise HTTPException(status_code=429, detail="Account temporarily locked. Try again later.")
    user = db.get_user(username)
    if not user or not verify_password(password, user["password_hash"]):
        db.add_audit("login.failed", actor=username, ip=ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Accept the factor the account uses. When TOTP is on, the authenticator code
    # is primary; a Telegram/email RECOVERY code (only issued after the user asks
    # via /auth/login/recovery) is also honoured so a lost device can't lock them
    # out. Otherwise it's the channel-OTP. record_failed_login + the top-of-handler
    # lock_status give brute-force protection to every branch.
    ok = False
    if code:
        if user.get("totp_enabled") and user.get("totp_secret"):
            ok = totp_svc.verify(username, user, code) or \
                login_otp.check(username, code, user=user, purpose="recovery")
        else:
            ok = login_otp.check(username, code, user=user, purpose="login")
    if not ok:
        db.record_failed_login(username)
        db.add_audit("login.2fa_failed", actor=username, ip=ip)
        raise HTTPException(status_code=401, detail="Invalid or expired code")

    # Maintenance gate: non-admins can't complete login while maintenance is ON.
    block_nonadmin_during_maintenance(user)

    db.clear_failed_login(username)
    token = new_token()
    db.create_session(token, username)
    db.add_audit("login.success", actor=username, ip=ip)
    return {"token": token, "username": username, "role": user["role"],
            "mustChangePassword": bool(user.get("must_change_password"))}


@router.post("/auth/login/recovery")
def login_recovery(body: dict, request: Request):
    """Lost-authenticator RECOVERY: for a TOTP account, send a one-time code over
    the user's free channel (Telegram, else email). Re-checks the password first
    so an attacker can't spray recovery codes at accounts. The code is single-use
    and validated back in /auth/login/verify."""
    username = (body or {}).get("username", "")
    password = (body or {}).get("password", "")
    ip = _ip(request)

    if db.lock_status(username):
        raise HTTPException(status_code=429, detail="Account temporarily locked. Try again later.")
    user = db.get_user(username)
    if not user or not verify_password(password, user["password_hash"]):
        db.record_failed_login(username)
        db.add_audit("login.failed", actor=username, ip=ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="Recovery is only for authenticator-app accounts.")

    res = login_otp.start(username, user, purpose="recovery")
    if res.get("ok") or res.get("reason") == "cooldown":
        db.add_audit("login.recovery_sent", actor=username, ip=ip, detail={"channel": res.get("channel")})
        return {"ok": True, "channel": res.get("channel"), "channelHint": res.get("hint")}
    db.add_audit("login.recovery_no_channel", actor=username, ip=ip)
    raise HTTPException(
        status_code=503,
        detail="No Telegram or email is on file to send a recovery code. Please contact support.")


# ── channel-OTP 2FA (Telegram/email): enable / disable ───────────────────────

@router.get("/auth/me/2fa")
def get_2fa(username: str = Depends(current_user)):
    u = db.get_user(username) or {}
    return {
        "enabled": bool(u.get("twofa_enabled")),
        "phone": u.get("phone"),
        # 2FA is now available whenever we can deliver a code for FREE (Telegram
        # if linked, else email) — no phone / paid SMS required.
        "available": login_otp.is_available(username, u),
        "channelHint": login_otp.channel_hint(username, u),
    }


@router.post("/auth/me/2fa/start")
def start_2fa(username: str = Depends(current_user)):
    """Send a confirmation code over a free channel before turning 2FA on."""
    u = db.get_user(username) or {}
    res = login_otp.start(username, u, purpose="enable2fa")
    if not res.get("ok"):
        if res.get("reason") == "cooldown":
            return {"ok": True, "channelHint": res.get("hint")}
        raise HTTPException(
            status_code=400,
            detail="Link your Telegram or add an email address first — we send the "
                   "confirmation code there (no SMS).")
    return {"ok": True, "channelHint": res.get("hint")}


@router.post("/auth/me/2fa/enable")
def enable_2fa(body: dict, username: str = Depends(current_user)):
    """Confirm the code, then enable 2FA."""
    u = db.get_user(username) or {}
    code = ((body or {}).get("code") or "").strip()
    if not code or not login_otp.check(username, code, user=u, purpose="enable2fa"):
        raise HTTPException(status_code=400, detail="Invalid or expired code.")
    db.set_twofa(username, True)
    return {"ok": True, "enabled": True}


@router.post("/auth/me/2fa/disable")
def disable_2fa(username: str = Depends(current_user)):
    db.set_twofa(username, False)
    return {"ok": True, "enabled": False}


# ── TOTP authenticator-app 2FA (RFC 6238) — PRIMARY, zero-cost factor ─────────

@router.get("/auth/me/totp")
def get_totp(username: str = Depends(current_user)):
    u = db.get_user(username) or {}
    return {
        "enabled": bool(u.get("totp_enabled")),
        "available": totp_svc.is_available(),
        # Whether a lost-device recovery code could be delivered (Telegram/email).
        "recoveryAvailable": login_otp.is_available(username, u),
        "recoveryHint": login_otp.channel_hint(username, u),
    }


@router.post("/auth/me/totp/start")
def start_totp(username: str = Depends(current_user)):
    """Begin authenticator setup: generate a fresh secret (NOT yet enabled) and
    return it plus a QR to scan. The secret only becomes active once the user
    confirms a code via /auth/me/totp/enable."""
    u = db.get_user(username) or {}
    if u.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="Authenticator is already enabled. Disable it first to re-scan.")
    secret = totp_svc.new_secret()
    db.set_totp_secret(username, secret)  # stored but inert until confirmed
    uri = totp_svc.provisioning_uri(username, secret)
    return {"ok": True, "secret": secret, "otpauthUrl": uri, "qrSvg": totp_svc.qr_svg_data_uri(uri)}


@router.post("/auth/me/totp/enable")
def enable_totp(body: dict, username: str = Depends(current_user)):
    """Confirm a code from the authenticator against the pending secret, then
    turn TOTP on as the primary login factor."""
    u = db.get_user(username) or {}
    code = ((body or {}).get("code") or "").strip()
    secret = u.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="Start authenticator setup first.")
    if not totp_svc.verify_setup(secret, code):
        raise HTTPException(status_code=400, detail="That code didn't match. Check your authenticator app and try again.")
    db.set_totp_enabled(username, True)
    db.add_audit("2fa.totp_enabled", actor=username)
    return {"ok": True, "enabled": True}


@router.post("/auth/me/totp/disable")
def disable_totp(username: str = Depends(current_user)):
    """Turn TOTP off and wipe the secret (a re-enable must scan a new QR)."""
    db.set_totp_enabled(username, False)
    db.add_audit("2fa.totp_disabled", actor=username)
    return {"ok": True, "enabled": False}


# ── Privacy-policy acknowledgement (one-time per user, re-prompts on new version) ──

@router.get("/auth/me/privacy")
def get_privacy_ack(username: str = Depends(current_user)):
    u = db.get_user(username) or {}
    return {"acked": u.get("privacy_ack")}


@router.post("/auth/me/privacy/accept")
def accept_privacy(body: dict, username: str = Depends(current_user)):
    version = ((body or {}).get("version") or "").strip()
    if not version:
        raise HTTPException(status_code=400, detail="version required")
    db.set_privacy_ack(username, version)
    return {"ok": True, "acked": version}


@router.get("/auth/me")
def me(username: str = Depends(current_user)):
    user = db.get_user(username)
    owner = is_owner(username)
    return {"username": username, "role": user["role"] if user else "user",
            "isMain": bool(user.get("is_main")) if user else False,
            # Product-owner flag (Dan/Rafi/Yoav) — EQUAL top tier: full admin + Owners Portal
            # + Finance + every former main-admin power. Drives owner-only UI + gates.
            "isOwner": owner,
            # Team-role flags — gate the Legal Console + the content editors. An OWNER always
            # qualifies (they have everything); otherwise a per-user grant (legal_editor /
            # content_editor) from the Team-roles panel, or any full admin for content.
            "isLegalEditor": owner or db.is_legal_editor(username),
            # Legal-COPY writer — stricter than isLegalEditor: only Raz (legal_editor grant)
            # or the main admin may EDIT/APPROVE the 4 legal-copy blocks; other owners are
            # read-only. Drives the read-only vs read/write UI in the Legal-copy editor.
            "isLegalCopyWriter": db.is_legal_editor(username),
            # IT-editor flag — gates the IT portal (Oren). An OWNER always qualifies; otherwise a
            # per-user it_editor grant from the Team-roles panel. Same shape as isLegalEditor.
            "isItEditor": owner or db.is_it_editor(username),
            # Biz-dev-editor flag — gates the Business-Development portal (Raful). Owner qualifies.
            "isBizEditor": owner or db.is_biz_editor(username),
            "isContentEditor": owner or bool(user and user.get("role") == "admin") or db.is_content_editor(username),
            "mustChangePassword": bool(user.get("must_change_password")) if user else False}


# NOTE: these live under /auth/* (not /me, /plans) so the production Caddy —
# which only proxies a fixed allowlist of prefixes and doesn't reload its config
# on deploy — routes them to the backend without a Caddyfile change.
@router.get("/auth/me/entitlements")
def my_entitlements(username: str = Depends(current_user)):
    """Effective limits for the current user (plan + credits + unlocks + role).
    The frontend uses this to hide/lock gated features and show upgrade prompts."""
    from app.services import plans
    user = db.get_user(username)
    ent = plans.entitlements(user)
    # Demo testers get a live "tester score" (actual use + demo profit).
    try:
        if user and user.get("is_demo"):
            ent["testerScore"] = db.tester_score(username)["score"]
    except Exception:
        pass
    return ent


@router.get("/auth/plans")
def list_plans(_: str = Depends(current_user)):
    """Public plan catalog for the pricing/upgrade screen."""
    from app.services import plans
    return plans.plans_public()


@router.post("/auth/me/onboarded")
def mark_onboarded(username: str = Depends(current_user)):
    """Mark first-run onboarding as complete (re-openable from Help)."""
    db.set_onboarded(username, True)
    return {"ok": True}


@router.post("/auth/me/onboarding")
def submit_onboarding(body: dict, username: str = Depends(current_user)):
    """Score the AI-agent quiz, persist the strat profile, flag onboarded."""
    from app.services import onboarding
    answers = (body or {}).get("answers") or {}
    profile = onboarding.build_profile(answers)
    db.save_onboarding(username, profile)
    return profile


@router.get("/auth/me/onboarding")
def get_my_onboarding(username: str = Depends(current_user)):
    """Saved strat profile (for re-opening the plan from Help). May be null."""
    return db.get_onboarding(username) or {}


# ── Background music (user-uploaded MP3, C8) ────────────────────────────────
_MUSIC_MAX_CHARS = 9_500_000  # base64 data URL cap (~7MB MP3) to protect the DB


@router.get("/auth/me/music")
def get_my_music(username: str = Depends(current_user)):
    return {"music": db.get_music(username)}


# ── Demo videos (admin-uploaded per feature, played in 'How it works') ──────
_DEMO_MAX_CHARS = 24_000_000  # ~17MB mp4 as base64; admin-only, a handful of rows


@router.get("/auth/demos")
def list_demos(_: str = Depends(current_user)):
    """Which features have a demo video uploaded."""
    return {"features": db.list_demo_features()}


@router.get("/auth/demos/{feature}")
def get_demo(feature: str, _: str = Depends(current_user)):
    return {"feature": feature, "video": db.get_demo_video(feature)}


@router.post("/auth/demos/{feature}")
def set_demo(feature: str, body: dict, admin: str = Depends(require_admin)):
    """Admin uploads (or clears) a feature's demo video as a base64 data URL."""
    video = (body or {}).get("video")
    if video in (None, ""):
        db.set_demo_video(feature, None)
        return {"ok": True, "cleared": True}
    if not isinstance(video, str) or not video.startswith("data:video"):
        raise HTTPException(400, "Expected a video data URL.")
    if len(video) > _DEMO_MAX_CHARS:
        raise HTTPException(413, "That clip is too large — keep it under ~17MB (a short screen recording).")
    db.set_demo_video(feature, video)
    return {"ok": True}


@router.post("/auth/me/music")
def set_my_music(body: dict, username: str = Depends(current_user)):
    """Upload (or clear) a background-music MP3 as a base64 data URL. The frontend
    enforces the ≤5-minute length; here we enforce a size + type sanity check."""
    music = (body or {}).get("music")
    if music in (None, ""):
        db.set_music(username, None)
        return {"ok": True, "cleared": True}
    if not isinstance(music, str) or not music.startswith("data:audio"):
        raise HTTPException(400, "Expected an audio data URL.")
    if len(music) > _MUSIC_MAX_CHARS:
        raise HTTPException(413, "That file is too large — keep it under ~7MB (a short MP3).")
    db.set_music(username, music)
    return {"ok": True}


_BADGE_RANK = {"starter": 1, "trader": 2, "strategist": 3, "pro": 4}


@router.post("/auth/me/badge")
def set_my_badge(body: dict, username: str = Depends(current_user)):
    """Award the earned badge. The top 'pro' badge is only valid for Pro/admin
    (they pay) — anyone else is clamped to at most 'strategist'. The frontend
    only calls this once all steps are done and an exchange is connected."""
    from app.services import plans
    badge = (body or {}).get("badge")
    if badge not in _BADGE_RANK:
        raise HTTPException(400, "Unknown badge.")
    ent = plans.entitlements(db.get_user(username))
    is_pro = ent.get("isAdmin") or ent.get("plan") == "pro"
    if badge == "pro" and not is_pro:
        badge = "strategist"  # can't earn Pro badge without being Pro
    db.set_badge(username, badge)
    return {"ok": True, "badge": badge}


@router.post("/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    token = bearer_from_header(authorization)
    if token:
        db.delete_session(token)
    return {"ok": True}


# ── User management (admin only) ──────────────────────────────────────────────

@router.get("/auth/users")
def get_users(_: str = Depends(require_admin)):
    return db.list_users()


# ── Team roles (main-admin only) — assign partners their access via a user picker ──
class TeamRoleInput(BaseModel):
    username: str
    role: str            # "admin" | "legal_editor" | "content_editor" | "owner" | "it_editor" | "biz_editor"
    enabled: bool = True


@router.get("/auth/team-roles")
def team_roles(_: str = Depends(require_owner)):
    """EVERY user + their team flags — the single source the Team-roles picker reads (so the
    exact username is always selectable and never 'not found')."""
    return {"users": [
        {"username": r.get("username"), "role": r.get("role"),
         "isMain": bool(r.get("is_main")), "legalEditor": bool(r.get("legal_editor")),
         "contentEditor": bool(r.get("content_editor")), "owner": bool(r.get("owner_flag")),
         "itEditor": bool(r.get("it_editor")), "bizEditor": bool(r.get("biz_editor"))}
        for r in db.list_team_roles()
    ]}


@router.post("/auth/team-roles")
def set_team_role(body: TeamRoleInput, actor: str = Depends(require_owner)):
    """Grant/revoke a team role for an existing user. Main-admin only, per-user isolated.
    role: 'admin' (full), 'legal_editor' (Legal Console), 'content_editor' (content editors),
    'owner' (product owner — the Owners Portal + full Requests portal), 'it_editor' (IT portal)."""
    target = (body.username or "").strip()
    user = db.get_user(target)
    if not target or not user:
        raise HTTPException(404, "No such user.")
    if bool(user.get("is_main")):
        raise HTTPException(400, "The main admin's roles can't be changed here.")
    if body.role == "admin":
        db.set_user_role(target, "admin" if body.enabled else "user")
    elif body.role == "legal_editor":
        db.set_legal_editor(target, body.enabled)
    elif body.role == "content_editor":
        db.set_content_editor(target, body.enabled)
    elif body.role == "owner":
        db.set_owner(target, body.enabled)
    elif body.role == "it_editor":
        db.set_it_editor(target, body.enabled)
    elif body.role == "biz_editor":
        db.set_biz_editor(target, body.enabled)
    else:
        raise HTTPException(400, "Unknown role.")
    logger.info("team-role.set target=%s role=%s enabled=%s by=%s", target, body.role, body.enabled, actor)
    return {"ok": True}


@router.post("/auth/users")
def add_user(body: dict, request: Request, admin: str = Depends(require_admin)):
    username = (body or {}).get("username", "").strip()
    password = (body or {}).get("password", "")
    role = (body or {}).get("role", "user")
    email = ((body or {}).get("email") or "").strip() or None
    if role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="role must be 'user' or 'admin'")
    assert_can_manage_user(admin, None, new_role=role)  # only the super-admin may create an admin
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password required")
    if db.get_user(username):
        raise HTTPException(status_code=409, detail="user exists")
    # Limits: 50 users total; the root admin is unlimited, other admins get 5 each.
    if db.count_users() >= 50:
        raise HTTPException(status_code=400, detail="User limit reached (50 total).")
    if admin != "admin" and db.count_users_created_by(admin) >= 5:
        raise HTTPException(status_code=400, detail="You can create up to 5 users.")
    demo = bool((body or {}).get("demo"))
    db.create_user(username, hash_password(password), role=role, email=email, created_by=admin)
    demo_expires = None
    if demo and role != "admin":
        from datetime import datetime, timezone, timedelta
        demo_expires = (datetime.now(timezone.utc) + timedelta(minutes=_DEMO_MINUTES)).isoformat()
        db.mark_demo_user(username, demo_expires, plan="pro")  # full Pro features, 1 week
        db.join_suggestions_group(username)
    db.add_audit("user.create", actor=admin, target=username, ip=_ip(request), detail={"role": role, "demo": demo})
    return {"username": username, "role": role, "email": email, "demo": demo, "demoExpires": demo_expires}


@router.patch("/auth/users/{username}")
def edit_user(username: str, body: dict, request: Request, admin: str = Depends(require_admin)):
    if not db.get_user(username):
        raise HTTPException(status_code=404, detail="not found")
    # Secondary admins may edit regular users only — never an admin/super-admin, and
    # never promote anyone TO admin (new_role check). The super-admin bypasses both.
    assert_can_manage_user(admin, username, new_role=(body or {}).get("role"))
    if "role" in (body or {}):
        if body["role"] not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="role must be 'user' or 'admin'")
        if username == "admin" and body["role"] != "admin":
            raise HTTPException(status_code=400, detail="cannot demote the root admin")
        db.update_user_role(username, body["role"])
        db.add_audit("user.role_change", actor=admin, target=username, ip=_ip(request),
                     detail={"role": body["role"]})
    if (body or {}).get("password"):
        db.update_user_password(username, hash_password(body["password"]))
        db.clear_failed_login(username)
        db.add_audit("user.password_set", actor=admin, target=username, ip=_ip(request))
    if "email" in (body or {}):
        db.update_user_email(username, (body.get("email") or "").strip() or None)
        db.add_audit("user.email_set", actor=admin, target=username, ip=_ip(request))
    if "phone" in (body or {}):
        # Set/clear a user's phone. Light E.164-ish normalization: keep a single leading
        # '+', strip everything else to digits. Persists to BOTH users.phone AND the
        # WhatsApp field (notif_prefs.whatsappTo) — the exact fields the owners-report
        # eligibility reads (hasPhone / hasWhatsappNumber). It does NOT flip on the WhatsApp
        # channel or any consent — owners bypass consent for the report, and we never
        # silently opt a user into a marketing channel.
        raw = str((body or {}).get("phone") or "").strip()
        phone = None
        if raw:
            digits = re.sub(r"\D", "", raw)
            if not digits or len(digits) > 20:
                raise HTTPException(status_code=400, detail="Enter a valid phone, e.g. +972501234567")
            phone = ("+" + digits) if raw.startswith("+") else digits
        db.set_phone(username, phone)
        db.set_notif_prefs(username, {"whatsappTo": phone or ""})
        db.add_audit("user.phone_set", actor=admin, target=username, ip=_ip(request), detail={"phone": phone})
    return {"ok": True}


@router.delete("/auth/users/{username}")
def remove_user(username: str, request: Request, admin: str = Depends(require_admin)):
    if username == "admin":
        raise HTTPException(status_code=400, detail="cannot delete admin")
    assert_can_manage_user(admin, username)  # secondary admins can't delete an admin/super-admin
    try:
        db.delete_user(username)
    except db.ProvisionedAccountError:
        raise HTTPException(status_code=409, detail="This account is linked to a Praxis trading identity; deprovision it (revoke keys) before deletion.")
    db.add_audit("user.delete", actor=admin, target=username, ip=_ip(request))
    return {"ok": True}


@router.post("/auth/users/{username}/unlock")
def unlock_user(username: str, request: Request, admin: str = Depends(require_admin)):
    if not db.get_user(username):
        raise HTTPException(status_code=404, detail="not found")
    assert_can_manage_user(admin, username)  # not on an admin/super-admin
    db.clear_failed_login(username)
    db.add_audit("user.unlock", actor=admin, target=username, ip=_ip(request))
    return {"ok": True}


# ── Password reset (admin issues a one-time link; the user redeems it) ─────────

@router.post("/auth/users/{username}/reset-link")
def issue_reset_link(username: str, request: Request, admin: str = Depends(require_admin)):
    """Admin generates a one-time reset token to hand to the user (copy/paste).

    Email delivery comes later; for now the admin copies the returned code.
    """
    user = db.get_user(username)
    if not user:
        raise HTTPException(status_code=404, detail="not found")
    assert_can_manage_user(admin, username)  # no resetting an admin's/super-admin's password
    token = secrets.token_urlsafe(24)
    expires = db.create_password_reset(username, token)
    base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
    link = f"{base}/reset?token={token}"

    emailed = False
    email = user.get("email")
    if email and mailer.email_configured():
        res = mailer.send_email(
            email, "ALGO770 — password reset",
            f"A password reset was requested for your ALGO770 account ({username}).\n\n"
            f"Open this link to set a new password (valid 24h):\n{link}\n\n"
            f"If you didn't request this, you can ignore this email.",
            body_html=f"<p>A password reset was requested for <b>{username}</b>.</p>"
                      f"<p><a href=\"{link}\">Set a new password</a> (valid 24 hours).</p>"
                      f"<p style=\"color:#888\">If you didn't request this, ignore this email.</p>",
        )
        emailed = bool(res.get("ok"))
    db.add_audit("password.reset_issued", actor=admin, target=username, ip=_ip(request),
                 detail={"emailed": emailed})
    return {"username": username, "token": token, "expiresAt": expires,
            "path": f"/reset?token={token}", "link": link, "emailed": emailed, "email": email}


@router.post("/auth/users/{username}/reset-password")
def reset_password(username: str, body: dict, request: Request, admin: str = Depends(require_admin)):
    """Admin directly sets a NEW password for any user (the admin types it).

    The simplest path: no link to copy, no email round-trip. We hash the password
    with the same pbkdf2 helper login verifies against, clear any lockout, and —
    when `forceChange` is true (the default) — flag the account so the user is
    taken straight to a 'set a new password' screen on their next login. The
    plaintext is never logged or returned.
    """
    user = db.get_user(username)
    if not user:
        raise HTTPException(status_code=404, detail="not found")
    assert_can_manage_user(admin, username)  # no resetting an admin's/super-admin's password
    new_pw = (body or {}).get("password", "")
    if not new_pw or len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    force = (body or {}).get("forceChange", True)
    db.update_user_password(username, hash_password(new_pw))
    db.clear_failed_login(username)
    db.set_must_change_password(username, bool(force))
    db.add_audit("password.admin_reset", actor=admin, target=username, ip=_ip(request),
                 detail={"forceChange": bool(force)})
    return {"ok": True, "username": username, "forceChange": bool(force)}


@router.post("/auth/email-test")
def email_test(body: dict, _: str = Depends(require_admin)):
    """Admin: send a test email to verify the install's SMTP settings."""
    to = ((body or {}).get("to") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="recipient 'to' required")
    if not mailer.email_configured():
        raise HTTPException(status_code=400, detail="Email is not configured (set SENDGRID_API_KEY + SENDGRID_FROM, or SMTP_HOST + SMTP_FROM).")
    res = mailer.send_email(to, "ALGO770 test email",
                            "This is a test email from your ALGO770 install. Email is working.")
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res.get("message") or "send failed")
    return res


@router.post("/auth/reset")
def redeem_reset(body: dict, request: Request):
    """Public: redeem a reset token + set a new password. No auth required."""
    token = (body or {}).get("token", "")
    new_pw = (body or {}).get("newPassword", "")
    if not token or not new_pw:
        raise HTTPException(status_code=400, detail="token and newPassword required")
    username = db.consume_password_reset(token)
    if not username:
        raise HTTPException(status_code=400, detail="invalid or expired token")
    db.update_user_password(username, hash_password(new_pw))
    db.clear_failed_login(username)
    db.add_audit("password.reset_redeemed", actor=username, ip=_ip(request))
    return {"ok": True, "username": username}


# ── Self-service data rights (GDPR: export + delete) ──────────────────────────

@router.get("/auth/me/export")
def export_me(username: str = Depends(current_user)):
    """Download everything we hold about the current user (GDPR data export, Item 7):
    profile, settings, their audit trail, and their OWN analytics events (found via the
    pseudonym). Exchange API keys are intentionally absent — they are non-custodial and
    live only in the user's browser, never on the server; secrets/hashes are never
    included.
    """
    user = db.get_user(username) or {}
    return {
        "exportedAt": db.now_iso(),
        "profile": {
            "username": username, "role": user.get("role"),
            "email": user.get("email"), "phone": user.get("phone"),
            "nickname": user.get("nickname"), "createdAt": user.get("created_at"),
        },
        "settings": {
            "plan": user.get("plan"), "lockedSections": user.get("locked_sections"),
            "analyticsConsent": bool(user.get("analytics_consent")),
            "analyticsConsentAt": user.get("analytics_consent_at"),
            "deletionRequestedAt": user.get("deletion_requested_at"),
        },
        "analyticsEvents": db.list_user_analytics_events(username),
        "auditEntries": db.list_audit_for(username),
        "note": "Exchange API keys are stored only in your browser and are not held on the server. "
                "Analytics events are keyed by a pseudonym, never your username.",
    }


@router.get("/auth/me/data-status")
def my_data_status(username: str = Depends(current_user)):
    """State for the My-Data settings section: whether a deletion request is pending."""
    return {"deletionRequestedAt": db.get_deletion_requested(username)}


@router.post("/auth/me/delete-request")
def request_my_deletion(body: dict, request: Request, username: str = Depends(current_user)):
    """File a SOFT account-deletion REQUEST (Item 7). Marks the account for deletion +
    files a request in the owners' requests portal + notifies an owner — it does NOT
    delete any data (that is an owner-actioned follow-up). Withdrawable via undo=true."""
    withdraw = bool((body or {}).get("undo"))
    if withdraw:
        db.set_deletion_requested(username, False)
        db.add_audit("account.delete_request.withdraw", actor=username, target=username, ip=_ip(request))
        return {"ok": True, "deletionRequestedAt": None}
    reason = str((body or {}).get("reason") or "")[:500]
    ts = db.set_deletion_requested(username, True)
    db.add_audit("account.delete_request", actor=username, target=username, ip=_ip(request))
    # Surface it to the owners: a request-portal row + a best-effort Telegram ping.
    try:
        db.create_request(
            user_id=username, display_name=db.display_name(username), category="user_request",
            subject="Account deletion request", route="/me",
            body=("User requested account deletion (soft — pending owner action)." +
                  (f"\nReason: {reason}" if reason else "")),
        )
    except Exception:  # noqa: BLE001 — never block the user's request on a portal hiccup
        logger.warning("delete-request: could not file portal request for %s", username)
    try:
        from app.services import telegram as tg
        tg.notify_admin(f"🗑️ <b>Account deletion request</b>\n{html.escape(db.display_name(username))}"
                        + (f"\nReason: {html.escape(reason)}" if reason else ""))
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "deletionRequestedAt": ts}


@router.post("/auth/me/delete")
def delete_me(body: dict, request: Request, username: str = Depends(current_user)):
    """Delete the current user's own account (GDPR right to erasure). Password-confirmed."""
    password = (body or {}).get("password", "")
    user = db.get_user(username)
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=403, detail="wrong password")
    if username == "admin":
        raise HTTPException(status_code=400, detail="The root admin account cannot self-delete.")
    if user.get("role") == "admin" and db.count_admins() <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin account.")
    try:
        db.delete_user(username)  # sessions + reset tokens cascade
    except db.ProvisionedAccountError:
        raise HTTPException(status_code=409, detail="Your account is linked to a live trading identity; it must be deprovisioned (keys revoked) before deletion.")
    db.add_audit("account.delete", actor=username, target=username, ip=_ip(request))
    return {"ok": True}


@router.get("/auth/me/protection")
def protection_status(username: str = Depends(current_user)):
    user = db.get_user(username) or {}
    return {"set": bool(user.get("protection_hash"))}


@router.post("/auth/me/protection")
def set_protection(body: dict, request: Request, username: str = Depends(current_user)):
    """Each user sets their OWN protection code (per-user, not global). Empty = clear."""
    new = (body or {}).get("code", "")
    current = (body or {}).get("currentCode", "")
    user = db.get_user(username)
    existing = (user or {}).get("protection_hash")
    if existing and not verify_password(current, existing):
        raise HTTPException(status_code=403, detail="wrong current protection code")
    if not new:
        db.set_user_protection(username, None)
        db.add_audit("protection.cleared", actor=username, ip=_ip(request))
        return {"ok": True, "cleared": True}
    if len(new) < 4:
        raise HTTPException(status_code=400, detail="protection code must be at least 4 characters")
    db.set_user_protection(username, hash_password(new))
    db.add_audit("protection.set", actor=username, ip=_ip(request))
    return {"ok": True}


@router.post("/auth/me/protection/verify")
def verify_protection(body: dict, username: str = Depends(current_user)):
    user = db.get_user(username) or {}
    h = user.get("protection_hash")
    if not h:
        return {"ok": True, "set": False}
    if not verify_password((body or {}).get("code", ""), h):
        raise HTTPException(status_code=401, detail="wrong protection code")
    return {"ok": True, "set": True}


@router.post("/auth/change-password")
def change_password(body: dict, request: Request, username: str = Depends(current_user)):
    old = (body or {}).get("oldPassword", "")
    new = (body or {}).get("newPassword", "")
    user = db.get_user(username)
    if not user or not verify_password(old, user["password_hash"]):
        raise HTTPException(status_code=403, detail="wrong current password")
    if not new:
        raise HTTPException(status_code=400, detail="newPassword required")
    db.update_user_password(username, hash_password(new))
    db.add_audit("password.change", actor=username, ip=_ip(request))
    return {"ok": True}


@router.post("/auth/me/set-new-password")
def set_new_password(body: dict, request: Request, username: str = Depends(current_user)):
    """Forced set-new-password (no old password needed) — the screen the user is
    routed to right after an admin reset with 'force change on next login'.

    Only callable while the account is in that forced state (must_change_password
    is TRUE); otherwise normal callers must use /auth/change-password, which still
    requires the current password. Updates THEIR OWN password and clears the flag.
    """
    user = db.get_user(username)
    if not user or not user.get("must_change_password"):
        # Not in the forced state — don't allow a no-old-password change here.
        raise HTTPException(status_code=400, detail="No password change is required.")
    new = (body or {}).get("newPassword", "")
    if not new or len(new) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    db.update_user_password(username, hash_password(new))
    db.set_must_change_password(username, False)
    db.set_reset_approved(username, False)  # burn the one-time "approved reset" marker
    db.clear_failed_login(username)
    db.add_audit("password.force_changed", actor=username, ip=_ip(request))
    return {"ok": True}


# ── Audit log (admin only) ────────────────────────────────────────────────────

@router.get("/auth/audit")
def get_audit(limit: int = 200, _: str = Depends(require_admin)):
    return db.list_audit(min(max(limit, 1), 1000))


# ── Connected users + admin email-out (admin only) ────────────────────────────

@router.get("/auth/sessions")
def get_sessions(_: str = Depends(require_admin)):
    """Who is currently logged in, since when, and last activity."""
    return db.list_sessions()


@router.post("/auth/email-data")
def email_data(body: dict, request: Request, admin: str = Depends(require_admin)):
    """Admin: email a block of data to users (those who have an email address).

    recipients: "all" (default) or a list of usernames.
    """
    if not mailer.email_configured():
        raise HTTPException(status_code=400, detail="Email is not configured on this server.")
    subject = ((body or {}).get("subject") or "ALGO770 — data").strip()
    text = (body or {}).get("text") or "See the data below."
    html = (body or {}).get("html")
    recipients = (body or {}).get("recipients")

    targets = [u for u in db.list_users() if u.get("email")]
    if isinstance(recipients, list):
        targets = [u for u in targets if u["username"] in recipients]
    if not targets:
        raise HTTPException(status_code=400, detail="No users with an email address to send to.")

    sent = 0
    for u in targets:
        res = mailer.send_email(u["email"], subject, text, body_html=html)
        if res.get("ok"):
            sent += 1
    db.add_audit("email.data_sent", actor=admin, ip=_ip(request),
                 detail={"subject": subject, "sent": sent, "targets": len(targets)})
    return {"ok": True, "sent": sent, "recipients": len(targets)}


# ── Coupons (admin-generated access codes) ──────────────────────────────────

@router.get("/auth/coupons")
def coupons_list(_: str = Depends(require_admin)):
    from app.services import access
    out = []
    for c in db.list_coupons():
        out.append({
            "code": c["code"], "grant": c["grant_data"], "summary": access.describe_grant(c["grant_data"]),
            "maxUses": c["max_uses"], "usedCount": c["used_count"], "expiresAt": c["expires_at"],
            "note": c["note"], "active": c["active"], "createdAt": c["created_at"],
        })
    return out


@router.post("/auth/coupons")
def coupons_create(body: dict, request: Request, admin: str = Depends(require_admin)):
    from app.services import access
    grant = access.normalize_grant((body or {}).get("grant"))
    if not grant:
        raise HTTPException(400, "Specify what the code unlocks (e.g. all access, a plan, or credits).")
    code = ((body or {}).get("code") or "").strip().upper() or access.generate_code()
    if db.get_coupon(code):
        raise HTTPException(409, "That code already exists.")
    max_uses = int((body or {}).get("maxUses") or 0)
    expires_at = (body or {}).get("expiresAt") or None
    note = (body or {}).get("note") or None
    c = db.create_coupon(code, grant, max_uses=max_uses, expires_at=expires_at, note=note, created_by=admin)
    db.add_audit("coupon.create", actor=admin, ip=_ip(request), detail={"code": code, "grant": grant})
    return {"code": c["code"], "grant": c["grant_data"], "summary": access.describe_grant(grant),
            "maxUses": c["max_uses"], "usedCount": 0, "expiresAt": c["expires_at"], "note": c["note"], "active": True}


@router.post("/auth/coupons/{code}/disable")
def coupons_disable(code: str, admin: str = Depends(require_admin)):
    if not db.get_coupon(code):
        raise HTTPException(404, "No such code.")
    db.set_coupon_active(code, False)
    return {"ok": True}


@router.post("/auth/redeem")
def redeem(body: dict, username: str = Depends(current_user)):
    """A user redeems an access code generated by the admin."""
    from app.services import access
    code = ((body or {}).get("code") or "").strip().upper()
    if not code:
        raise HTTPException(400, "Enter a code.")
    res = db.redeem_coupon(code, username)
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "Invalid code")
    access.apply_grant(username, res["grant"])
    db.add_audit("coupon.redeem", actor=username, detail={"code": code})
    return {"ok": True, "summary": access.describe_grant(res["grant"])}


# ── Access requests ("contact admin for access") ────────────────────────────

@router.post("/auth/access-request")
def access_request(body: dict, username: str = Depends(current_user)):
    msg = (body or {}).get("message")
    rid = db.create_access_request(username, msg)
    # Instant admin alert (best-effort) — don't wait for the hourly digest.
    try:
        from app.services import telegram as tg
        # Telegram is sent with parse_mode=HTML — escape every user-controlled value
        # so a crafted display name / message can't inject markup into the alert.
        who = html.escape(db.display_name(username))
        lines = ["🔑 <b>Access request</b>", f"<b>{who}</b> is asking for access."]
        if msg:
            lines.append(f"“{html.escape(str(msg)[:300])}”")
        lines.append("Grant it in Admin → Help &amp; discussions.")
        tg.notify_admin("\n".join(lines))
    except Exception:  # never let a notify failure break the request
        pass
    return {"ok": True, "id": rid}


@router.get("/auth/access-requests")
def access_requests(status: str | None = None, _: str = Depends(require_admin)):
    return db.list_access_requests(status)


@router.post("/auth/access-requests/{req_id}/grant")
def access_request_grant(req_id: int, body: dict, admin: str = Depends(require_admin)):
    """Admin grants access for a request (free). Default grant = full access."""
    from app.services import access
    req = db.get_access_request(req_id)
    if not req:
        raise HTTPException(404, "No such request.")
    grant = access.normalize_grant((body or {}).get("grant") or {"all": True}) or {"all": True}
    access.apply_grant(req["username"], grant)
    db.set_access_request_status(req_id, "granted", admin)
    db.add_audit("access.grant", actor=admin, detail={"user": req["username"], "grant": grant})
    # Tell the user their request came through (best-effort, their enabled channels).
    try:
        from app.services import notify
        notify.notify_user(req["username"],
                           f"✅ Your ALGO770 access is now active: {access.describe_grant(grant)}. app.strateteach.com")
    except Exception:
        pass
    return {"ok": True, "summary": access.describe_grant(grant)}


@router.post("/auth/access-requests/{req_id}/deny")
def access_request_deny(req_id: int, body: dict, admin: str = Depends(require_admin)):
    """Admin requires payment instead (status='payment') or denies."""
    req = db.get_access_request(req_id)
    if not req:
        raise HTTPException(404, "No such request.")
    status = "payment" if (body or {}).get("requirePayment") else "denied"
    db.set_access_request_status(req_id, status, admin)
    return {"ok": True, "status": status}


# ── Demo testers (one-tap timed access) + feedback ──────────────────────────
# Demo testers get full PRO features (never admin), for one week, with a live
# countdown shown in-app. Change here to adjust the trial length.
_DEMO_MINUTES = 7 * 24 * 60  # 1 week


def _demo_status(u: dict) -> dict:
    from datetime import datetime, timezone
    exp = u.get("demo_expires")
    active, mins_left = False, 0
    if exp:
        try:
            dt = datetime.fromisoformat(exp)
            left = (dt - datetime.now(timezone.utc)).total_seconds()
            active = left > 0
            mins_left = max(0, int(left // 60))
        except Exception:
            pass
    base = os.environ.get("APP_URL") or os.environ.get("DOMAIN") or "app.strateteach.com"
    if not base.startswith("http"):
        base = f"https://{base}"
    try:
        score = db.tester_score(u["username"])["score"]
    except Exception:
        score = 0
    # Guarantee a real one-tap token (backfills legacy demo users that had none, so
    # the invite link is never the broken "?demo=None").
    token = u.get("demo_token") or db.ensure_demo_token(u["username"])
    return {"username": u["username"], "active": active, "minutesLeft": mins_left, "score": score,
            "expires": exp, "plan": (u.get("plan") or "basic"),
            "link": (f"{base.rstrip('/')}/?demo={token}" if token else None)}


@router.post("/auth/demo-users")
def create_demo(body: dict, admin: str = Depends(require_admin)):
    """Mint a one-tap demo tester (Pro features, demo money only)."""
    token = secrets.token_urlsafe(16)
    username = "demo-" + secrets.token_hex(3)
    db.create_demo_user(username, token, plan="pro")
    db.join_suggestions_group(username)
    db.add_audit("demo.create", actor=admin, detail={"username": username})
    u = db.get_user(username) or {"username": username, "demo_token": token}
    return _demo_status(u)


@router.get("/auth/demo-users")
def list_demos(_: str = Depends(require_admin)):
    return [_demo_status(u) for u in db.list_demo_users()]


@router.get("/auth/demo-leaderboard")
def demo_leaderboard(_: str = Depends(require_admin)):
    """Ranked demo-tester leaderboard (username, tenure, score, demo P&L %/$, trades).

    Admin-only. Ranked by the gamified score (always ≥0). The admin can broadcast
    it to all users via the existing in-app chat broadcast + SMS/WhatsApp blast
    (nothing auto-sends here; the daily 18:00 IL auto-send lives in services)."""
    return {"rows": db.demo_leaderboard()}


@router.get("/auth/demo-leaderboard/message")
def demo_leaderboard_message(_: str = Depends(require_admin)):
    """The canonical leaderboard broadcast text (rank + score for everyone, profit
    $ for the top 10 only, + the incentive note). Used to prefill the admin panel
    so the manual send matches the daily 18:00 auto-send exactly."""
    from app.services.leaderboard import build_message
    return {"text": build_message()}


@router.get("/auth/admin/runs")
def admin_runs(user: str | None = None, mode: str | None = None, status: str | None = None,
               limit: int = 500, _: str = Depends(require_admin)):
    """All logged runs/positions (live + demo), newest first, with optional filters
    (user / mode / status). Read-only observational log — see db.runs_log."""
    return {"runs": db.list_runs_log(
        username=(user or None), mode=(mode or None), status=(status or None),
        limit=min(2000, max(1, int(limit or 500))),
    )}


@router.get("/auth/admin/user/{username}")
def admin_user_detail(username: str, _: str = Depends(require_admin)):
    """One user's aggregated profile: account + access + logins + audit timeline +
    runs + demo stats. Read-only."""
    d = db.user_detail(username)
    if d is None:
        raise HTTPException(404, "No such user.")
    return d


# ── Signal Bots: admin sees ONLY the count + the limit (privacy-scoped) ──────
# The admin can see HOW MANY Signal Bots a user has and set their create LIMIT.
# Everything else (keys, funds, balances, bot rows) stays PRIVATE to the user —
# these endpoints never read or return any of it.

@router.get("/auth/admin/user/{username}/bots")
def admin_user_bot_count(username: str, admin: str = Depends(require_admin)):
    """Count of a user's Signal Bots + their effective create limit. Returns ONLY
    {ok, count, limit} — never keys, funds, balances, or bot details."""
    from app.services.plans import entitlements
    user = db.get_user(username)
    if not user:
        raise HTTPException(404, "No such user.")
    assert_can_manage_user(admin, username)
    return {"ok": True, "count": db.count_user_bots(username), "limit": entitlements(user)["bots"]}


@router.post("/auth/admin/user/{username}/bot-limit")
def admin_set_user_bot_limit(username: str, body: dict, request: Request,
                             admin: str = Depends(require_admin)):
    """Set a per-user override for the Signal-Bots create cap (stored in
    users.credits["bots_limit"]; entitlements() respects it). Returns ONLY
    {ok, limit} — the effective cap — never any of the user's bot details."""
    from app.services.plans import entitlements
    user = db.get_user(username)
    if not user:
        raise HTTPException(404, "No such user.")
    assert_can_manage_user(admin, username)
    try:
        limit = int((body or {}).get("limit"))
    except (TypeError, ValueError):
        raise HTTPException(400, "limit must be a number.")
    if limit < 0 or limit > 9999:
        raise HTTPException(400, "limit must be between 0 and 9999.")
    db.set_user_bots_limit(username, limit)
    db.add_audit("bots.limit_set", actor=admin, target=username, ip=_ip(request),
                 detail={"limit": limit})
    return {"ok": True, "limit": entitlements(db.get_user(username))["bots"]}


@router.post("/auth/demo-users/{username}/extend")
def extend_demo(username: str, _: str = Depends(require_admin)):
    from datetime import datetime, timezone, timedelta
    db.set_demo_expires(username, (datetime.now(timezone.utc) + timedelta(minutes=_DEMO_MINUTES)).isoformat())
    return {"ok": True}


@router.post("/auth/demo-users/{username}/revoke")
def revoke_demo(username: str, _: str = Depends(require_admin)):
    from datetime import datetime, timezone
    db.set_demo_expires(username, datetime.now(timezone.utc).isoformat())  # expire immediately
    return {"ok": True}


@router.post("/auth/demo-login")
def demo_login(body: dict):
    """PUBLIC: a one-tap demo link logs the tester in for a fresh 30 minutes."""
    from datetime import datetime, timezone, timedelta
    token = (body or {}).get("token", "")
    row = db.get_user_by_demo_token(token) if token else None
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired demo link")
    username = row["username"]
    # Demo testers are never admins → maintenance shuts the one-tap demo door too.
    block_nonadmin_during_maintenance(db.get_user(username))
    db.set_demo_expires(username, (datetime.now(timezone.utc) + timedelta(minutes=_DEMO_MINUTES)).isoformat())
    db.join_suggestions_group(username)
    sess = new_token()
    db.create_session(sess, username)
    user = db.get_user(username)
    return {"token": sess, "username": username, "role": user["role"] if user else "user",
            "demoMinutes": _DEMO_MINUTES}


@router.post("/auth/self-signup")
def self_signup(body: dict, request: Request):
    """PUBLIC: instant self-registration from the universal /join link. Creates a
    DEMO account with the user's OWN username + password (so they can return),
    marks it onboarded, stores email/phone for follow-up, and logs them straight
    in. No admin approval — it's a 1-week demo; upgrades go through the normal
    access-request flow (the "Request upgrade" button → /auth/access-request)."""
    from datetime import datetime, timezone, timedelta
    # Self-signup only ever mints a NON-admin demo account — closed during maintenance.
    block_nonadmin_during_maintenance(None)
    # Anti-bot honeypot: a hidden form field humans never see. A non-empty value means
    # a bot auto-filled the form → silently drop it (respond ok, create nothing).
    if ((body or {}).get("website") or "").strip():
        db.add_audit("signup.bot_blocked", actor="bot", ip=_ip(request))
        return {"ok": True}
    name = ((body or {}).get("name") or "").strip()
    email = ((body or {}).get("email") or "").strip() or None
    phone = ((body or {}).get("phone") or "").strip() or None
    username = ((body or {}).get("username") or "").strip()
    password = (body or {}).get("password") or ""
    if not name:
        raise HTTPException(400, "Name is required.")
    if not email and not phone:
        raise HTTPException(400, "Add an email or phone so we can reach you.")
    if email and ("@" not in email or "." not in email or len(email) > 200):
        raise HTTPException(400, "Enter a valid email.")
    if phone and (len(phone) > 24 or not phone.replace("+", "").replace("-", "").replace(" ", "").isdigit()):
        raise HTTPException(400, "Enter a valid phone, e.g. +972501234567")
    if len(username) < 3 or len(username) > 32 or not username.replace("_", "").replace(".", "").isalnum():
        raise HTTPException(400, "Username must be 3–32 letters or digits.")
    if len(password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")
    if db.get_user(username):
        raise HTTPException(409, "That username is taken — pick another.")

    db.create_user(username, hash_password(password), role="user", email=email)
    if phone:
        db.set_phone(username, phone)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    db.mark_demo_user(username, expires, plan="pro")  # 1-week demo, same as the admin testers
    db.set_onboarded(username, True)
    db.join_suggestions_group(username)
    db.add_audit("signup.self", actor=username, detail={"name": name, "email": email, "phone": phone}, ip=_ip(request))

    token = new_token()
    db.create_session(token, username)
    return {"ok": True, "token": token, "username": username, "role": "user"}


# ── Welcome link: super-admin mints a one-time passwordless link into an EXISTING
#    account; the landing shows a branded notice + captures a phone number. ───────

@router.post("/auth/welcome-link")
def welcome_link(body: dict, request: Request, admin: str = Depends(require_owner)):
    """Super-admin: mint a one-time, 48h passwordless 'welcome' link for an existing
    user. Opening it logs into THAT account and shows the branded notice screen."""
    username = ((body or {}).get("username") or "").strip()
    if not db.get_user(username):
        raise HTTPException(404, "No such user.")
    out = db.create_welcome_token(username, ttl_minutes=48 * 60)
    base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
    link = f"{base}/?welcome={out['token']}"
    db.add_audit("welcome.mint", actor=admin, target=username, ip=_ip(request))
    return {"ok": True, "username": username, "token": out["token"], "link": link, "expiresAt": out["expires"]}


@router.post("/auth/welcome-login")
def welcome_login(body: dict):
    """PUBLIC: redeem a one-time welcome token → passwordless session for that user."""
    token = ((body or {}).get("token") or "").strip()
    username = db.redeem_welcome_token(token) if token else None
    user = db.get_user(username) if username else None
    if not user:
        raise HTTPException(401, "This link is invalid or has already been used.")
    # A welcome link can target any account; only let admins through in maintenance.
    block_nonadmin_during_maintenance(user)
    sess = new_token()
    db.create_session(sess, username)
    db.add_audit("welcome.login", actor=username)
    return {"token": sess, "username": username, "role": user["role"]}


# ── Public self-signup → admin approval → demo access ───────────────────────

@router.post("/auth/signup-request")
def signup_request(body: dict):
    """PUBLIC: a prospective tester asks for access; an admin approves later."""
    # Anti-bot honeypot (hidden field): silently drop bot-filled submissions.
    if ((body or {}).get("website") or "").strip():
        return {"ok": True, "id": 0}
    name = ((body or {}).get("name") or "").strip()
    email = ((body or {}).get("email") or "").strip() or None
    phone = ((body or {}).get("phone") or "").strip() or None
    note = ((body or {}).get("note") or "").strip() or None
    if not name:
        raise HTTPException(400, "Name is required.")
    if not email and not phone:
        raise HTTPException(400, "Add an email or phone so we can reach you.")
    if email and ("@" not in email or "." not in email or len(email) > 200):
        raise HTTPException(400, "Enter a valid email.")
    if phone and (len(phone) > 24 or not phone.replace("+", "").replace("-", "").replace(" ", "").isdigit()):
        raise HTTPException(400, "Enter a valid phone, e.g. +972501234567")
    rid = db.create_signup_request(name, email, phone, note)
    db.add_audit("signup.request", actor=name, detail={"email": email, "phone": phone})
    # Ping the admin's Telegram with Approve/Deny buttons (best-effort, non-blocking).
    try:
        from app.services import telegram as tg
        tg.notify_signup_request(rid, name, " · ".join([c for c in [phone, email] if c]), note)
    except Exception:
        pass
    return {"ok": True, "id": rid}


@router.get("/auth/signup-requests")
def get_signup_requests(status: str | None = "pending", _: str = Depends(require_admin)):
    return db.list_signup_requests(status)


@router.post("/auth/signup-requests/{req_id}/approve")
def approve_signup(req_id: int, admin: str = Depends(require_admin)):
    from app.services import signup as signup_svc
    res = signup_svc.approve(req_id, admin)
    if not res.get("ok"):
        raise HTTPException(404 if res.get("error") == "not_found" else 400, "This request can't be approved.")
    return res


@router.post("/auth/signup-requests/{req_id}/deny")
def deny_signup(req_id: int, admin: str = Depends(require_admin)):
    from app.services import signup as signup_svc
    res = signup_svc.deny(req_id, admin)
    if not res.get("ok"):
        raise HTTPException(404, "Request not found.")
    return res


# ── Self-service "can't log in / forgot password" → admin approval → renewal ──
# Mirrors the signup-request → admin-approval pattern: the user files a PENDING
# request from the login screen (no SMS/email needed), an admin approves it, and
# the user then renews their password from the login screen WITHOUT the old one.

@router.post("/auth/password-reset-request")
def password_reset_request(body: dict, request: Request):
    """PUBLIC: a user who can't log in asks an admin to approve a password reset.

    Security: never reveals whether the username exists — it ALWAYS responds the
    same {ok: true}. A request row is recorded only for a real account (so the
    queue can't be flooded with junk usernames), and db.create_password_reset_request
    dedupes a pending request per user (basic anti-spam)."""
    # Anti-bot honeypot (hidden field): silently drop bot-filled submissions, matching
    # the always-{ok:true} non-enumerating response below.
    if ((body or {}).get("website") or "").strip():
        return {"ok": True}
    username = ((body or {}).get("username") or "").strip()
    contact = ((body or {}).get("contact") or "").strip() or None
    if not username:
        raise HTTPException(status_code=400, detail="Enter your username.")
    if contact and len(contact) > 200:
        raise HTTPException(status_code=400, detail="Contact is too long.")
    try:
        if db.get_user(username):  # silently no-op for unknown users (no enumeration)
            db.create_password_reset_request(username, contact)
            db.add_audit("password.reset_requested", actor=username, ip=_ip(request),
                         detail={"contact": contact})
            try:  # best-effort instant admin ping — don't block the request
                from app.services import telegram as tg
                # parse_mode=HTML → escape user-controlled values to block markup injection.
                who = html.escape(db.display_name(username))
                lines = ["🔓 <b>Password reset request</b>",
                         f"<b>{who}</b> can't log in and is asking to reset their password."]
                if contact:
                    lines.append(f"Contact: {html.escape(str(contact)[:200])}")
                lines.append("Approve it in Admin → Users &amp; access → Access &amp; support.")
                tg.notify_admin("\n".join(lines))
            except Exception:
                pass
    except Exception:  # never leak an internal error (would hint the user exists)
        pass
    return {"ok": True}


@router.post("/auth/reset-approved-login")
def reset_approved_login(body: dict, request: Request):
    """PUBLIC: once an admin has APPROVED a reset, the user enters just their
    username here and gets a session that lands straight on the set-new-password
    screen — no old password anywhere in this path.

    Returns an identical 400 whether the account is missing OR simply not approved,
    so it can't be used to probe usernames. The renewal is single-use: setting the
    new password (via /auth/me/set-new-password) clears both must_change_password
    and reset_approved, closing this path."""
    username = ((body or {}).get("username") or "").strip()
    user = db.get_user(username) if username else None
    if not user or not user.get("reset_approved") or not user.get("must_change_password"):
        raise HTTPException(status_code=400,
                            detail="No approved password reset for this account yet. Send a request and wait for the admin.")
    block_nonadmin_during_maintenance(user)
    token = new_token()
    db.create_session(token, username)
    db.add_audit("password.reset_session", actor=username, ip=_ip(request))
    return {"token": token, "username": username, "role": user["role"], "mustChangePassword": True}


@router.get("/auth/password-reset-requests")
def list_password_reset_requests(status: str | None = "pending", _: str = Depends(require_admin)):
    return db.list_password_reset_requests(status)


@router.post("/auth/password-reset-requests/{req_id}/approve")
def approve_password_reset(req_id: int, request: Request, admin: str = Depends(require_admin)):
    """Admin approves a 'can't log in' request: flag the account so the user can
    renew WITHOUT the old password (must_change_password + reset_approved) and
    clear any lockout. No old password required anywhere in this path."""
    req = db.get_password_reset_request(req_id)
    if not req:
        raise HTTPException(status_code=404, detail="No such request.")
    username = req["username"]
    user = db.get_user(username)
    if not user:
        db.set_password_reset_request_status(req_id, "rejected", admin)
        raise HTTPException(status_code=404, detail="That account no longer exists.")
    assert_can_manage_user(admin, username)  # no resetting an admin's/super-admin's password
    db.set_must_change_password(username, True)
    db.set_reset_approved(username, True)
    db.clear_failed_login(username)  # clear any lockout so they can get in to renew
    db.set_password_reset_request_status(req_id, "approved", admin)
    db.add_audit("password.reset_approved", actor=admin, target=username, ip=_ip(request))
    try:  # let the user know (best-effort, their enabled channels)
        from app.services import notify
        notify.notify_user(username,
                           "✅ אישרנו איפוס סיסמה. במסך הכניסה בחר/י 'שכחתי סיסמה', הזן/י את שם המשתמש "
                           "ובחר/י סיסמה חדשה — בלי הסיסמה הישנה. app.strateteach.com")
    except Exception:
        pass
    return {"ok": True, "username": username}


@router.post("/auth/password-reset-requests/{req_id}/reject")
def reject_password_reset(req_id: int, request: Request, admin: str = Depends(require_admin)):
    """Admin rejects a reset request — no account change."""
    req = db.get_password_reset_request(req_id)
    if not req:
        raise HTTPException(status_code=404, detail="No such request.")
    db.set_password_reset_request_status(req_id, "rejected", admin)
    db.add_audit("password.reset_rejected", actor=admin, target=req.get("username"), ip=_ip(request))
    return {"ok": True}


@router.post("/auth/feedback")
def submit_feedback(body: dict, username: str = Depends(current_user)):
    text = ((body or {}).get("text") or "").strip()
    image = (body or {}).get("image")
    # `media` is the Service-Hub attachment (a photo OR video data URL). It is
    # forwarded to the admin's Telegram as a real photo/video below; only SMALL
    # images are persisted inline (a 20MB video would bloat the DB), so video
    # lands in Telegram only — which is where Dan reviews it.
    media = (body or {}).get("media")
    media_name = ((body or {}).get("mediaName") or "").strip() or None
    route = (body or {}).get("route")
    if not text and not image and not media:
        raise HTTPException(400, "Empty suggestion.")
    is_video = isinstance(media, str) and media.startswith("data:video")
    db_image = image
    if not db_image and isinstance(media, str) and media.startswith("data:image/") and len(media) < 1_500_000:
        db_image = media
    rid = db.add_feedback(username, text, route, db_image)
    # Route every Service-Hub feedback into the Owner / Requests portal as a
    # user_request row (status='new') so it surfaces in the help-desk. Best-effort —
    # a portal hiccup must never break feedback submission (the Telegram forward +
    # suggestions/assistant mirrors below still run).
    try:
        subject = (text or ("🎬 video" if is_video else "📎 photo/screenshot"))[:120].strip() or "Feedback"
        db.create_request(
            username, db.display_name(username) if hasattr(db, "display_name") else username,
            "user_request", subject, text or "", media=db_image, route=route,
            status="new", feedback_id=rid,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("feedback requests-portal mirror error: %s", str(exc)[:200])
    # Alert the extra owner-report recipients (Yoav, Rafi) by SMS about the new
    # request — reliable delivery with no WhatsApp-window dependency. Best-effort;
    # Dan's existing Telegram alert below is untouched.
    try:
        from app.services import scheduled_reports as _sr
        subj = (text or ("🎬 video" if is_video else "📎 photo/screenshot"))[:120].strip() or "Feedback"
        who = db.display_name(username) if hasattr(db, "display_name") else username
        _sr.notify_owners_new_request(subj, who)
    except Exception as exc:  # noqa: BLE001
        logger.warning("owner new-request SMS notify error: %s", str(exc)[:200])
    msg = text or ""
    if route:
        msg = (msg + f"  ·  ({route})").strip()
    if image or media:
        marker = "🎬 video attached" if is_video else "📎 photo/screenshot attached"
        msg = (msg + "  " + marker).strip()
    # Mirror into the "Suggestions" chat channel (admin + demo users see it there).
    try:
        gid = db.ensure_suggestions_group()
        db.add_group_member(gid, username)
        db.chat_send(username, None, msg[:1000] or "📎 screenshot", group_id=gid)
    except Exception as exc:  # noqa: BLE001
        logger.warning("feedback suggestions-group mirror error: %s", str(exc)[:200])
    # Drop it into the Assistant inbox too, so an admin can reply from the dashboard
    # and the reply is delivered back to this user (in-app, + Telegram if they have it).
    try:
        db.ensure_assistant_user()
        db.chat_send(username, "assistant", (msg[:2000] or "📎 screenshot"))
    except Exception as exc:  # noqa: BLE001
        logger.warning("feedback assistant-inbox mirror error: %s", str(exc)[:200])
    # Alert the admin's Telegram (gated by the 2-way assistant toggle). Done
    # SYNCHRONOUSLY with a returned status so a delivery failure is SURFACED
    # (logged + returned to the caller) instead of being silently swallowed by a
    # fire-and-forget daemon thread — that swallowing is exactly why a submitted
    # feedback could reach Dan's Telegram with no message and no trace. The most
    # common cause is CONFIG: the admin Telegram (bot token + chat id) was never
    # connected in the Telegram screen, so the alert was a silent no-op.
    tg_status: dict = {"ok": False, "reason": "skipped"}
    try:
        from app.services import telegram as tg
        if not db.get_telegram_config().get("notifyAssistant", True):
            tg_status = {"ok": False, "reason": "disabled",
                         "message": "Feedback→Telegram alerts are turned off (notifyAssistant)."}
        else:
            # parse_mode=HTML → escape the user's name + suggestion text + route.
            who = html.escape(db.display_name(username) if hasattr(db, "display_name") else username)
            body_txt = html.escape((text or ("🎬 video" if is_video else "📎 photo"))[:400])
            route_txt = html.escape(str(route)) if route else None
            tg_status = tg.notify_admin_sync(
                f"💡 <b>New feedback</b> from {who}\n{body_txt}" + (f"\n({route_txt})" if route_txt else ""))
            # Forward the actual photo/video to the admin's Telegram immediately,
            # captioned with the sender + note so it stands alone in the chat. The
            # caption is sent as plain text (no parse_mode) so it needs no escaping.
            if isinstance(media, str) and media.startswith("data:"):
                sender = db.display_name(username) if hasattr(db, "display_name") else username
                cap = f"💡 Feedback from {sender}"
                if text:
                    cap = (cap + "\n" + text)[:1000]
                tg.send_media_to_admin(media, cap, media_name)
        if not tg_status.get("ok"):
            logger.warning("feedback telegram alert NOT delivered (id=%s): reason=%s msg=%s",
                           rid, tg_status.get("reason"), tg_status.get("message", ""))
    except Exception as exc:  # noqa: BLE001
        tg_status = {"ok": False, "reason": "exception", "message": str(exc)[:200]}
        logger.warning("feedback telegram alert error: %s", str(exc)[:200])
    # Return the Telegram delivery status so the failure is visible end-to-end
    # (the client logs/surfaces it) instead of vanishing. Feedback itself is still
    # saved + mirrored regardless, so ok stays True.
    return {"ok": True, "id": rid, "telegram": tg_status}


@router.get("/auth/feedback")
def get_feedback(_: str = Depends(require_admin)):
    return db.list_feedback()


@router.post("/auth/users/{target}/grant")
def admin_grant_user(target: str, body: dict, admin: str = Depends(require_admin)):
    """Admin directly sets a user's access (all / none / specific)."""
    from app.services import access
    if not db.get_user(target):
        raise HTTPException(404, "No such user.")
    assert_can_manage_user(admin, target)  # only the super-admin may grant to an admin account
    grant = access.normalize_grant((body or {}).get("grant"))
    if not grant:
        raise HTTPException(400, "Specify a grant.")
    access.apply_grant(target, grant)
    db.add_audit("access.admin_grant", actor=admin, detail={"user": target, "grant": grant})
    return {"ok": True, "summary": access.describe_grant(grant)}
