"""Login one-time codes over FREE channels (Telegram → email), replacing the
paid Twilio Verify SMS path.

Why this exists
---------------
Login 2FA used to send the code via Twilio Verify (SMS), which bills per message
and was running up a real cost. This module generates the code OURSELVES and
delivers it over channels we already pay ~nothing for:

  1. the user's personal Telegram bot connection  (free)
  2. the admin bot → the user's known Telegram chat (free)
  3. email via SendGrid/SMTP                         (near-free)

Only the DELIVERY channel changes — the security is kept at Twilio-Verify parity:

  * 6-digit numeric code, cryptographically random (``secrets``)
  * 10-minute expiry (matches Twilio Verify's default TTL)
  * max 5 wrong attempts, then the code is burned
  * a resend cooldown + a per-code send cap (anti-spam / anti-abuse)
  * the code is stored HASHED (sha256 + per-code salt), never in the clear, and
    compared in constant time; it is single-use (deleted on success)

SMS is NOT used by default. An owner can flip ``LOGIN_OTP_SMS_LAST_RESORT=1`` to
re-enable Twilio Verify as an ABSOLUTE last resort for the (near-impossible) user
who has neither Telegram nor an email on file — so nobody is ever locked out
without the owner explicitly opting back into the cost.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time

from app import database as db
from app.services import email as mailer
from app.services import telegram as tg

logger = logging.getLogger("algo770")

# ── Security parameters (Twilio-Verify parity) ───────────────────────────────
CODE_TTL_SECS = 600        # 10 minutes, matches Twilio Verify's default
MAX_ATTEMPTS = 5           # wrong tries before the code is burned
RESEND_COOLDOWN_SECS = 20  # min gap between two sends of a live code
MAX_SENDS = 5              # total sends allowed for one code's lifetime

_STORE_KEY = "login_otp_codes"   # singleton: {"<username>:<purpose>": {...}}


# ── code store (hashed, per-user+purpose) ────────────────────────────────────

def _key(username: str, purpose: str) -> str:
    return f"{username}:{purpose}"


def _all() -> dict:
    return dict(db._get_singleton(_STORE_KEY, {}) or {})


def _hash(code: str, salt: str) -> str:
    return hashlib.sha256((salt + ":" + code).encode("utf-8")).hexdigest()


def _put(username: str, purpose: str, rec: dict | None) -> None:
    store = _all()
    k = _key(username, purpose)
    if rec is None:
        store.pop(k, None)
    else:
        store[k] = rec
    db._set_singleton(_STORE_KEY, store)


def _get(username: str, purpose: str) -> dict | None:
    return _all().get(_key(username, purpose))


# ── channel resolution ───────────────────────────────────────────────────────

def _mask_email(addr: str) -> str:
    addr = (addr or "").strip()
    if "@" not in addr:
        return "your email"
    name, _, domain = addr.partition("@")
    head = (name[:2] if len(name) >= 2 else name)
    return f"{head}···@{domain}"


def _candidates(username: str, user: dict) -> list[dict]:
    """Ordered list of ways we can deliver a code to this user, cheapest first.

    Each entry is ``{"kind": "telegram"|"email", "hint": <human hint>, ...}``.
    Telegram (free) is tried before email (near-free). SMS is never a candidate
    here — see ``_sms_last_resort``.
    """
    out: list[dict] = []

    # 1) the user's OWN Telegram bot connection
    c = db.get_user_telegram(username) or {}
    if c.get("enabled") and c.get("botToken") and c.get("chatId"):
        out.append({"kind": "telegram", "token": c["botToken"], "chat": str(c["chatId"]),
                    "hint": "Telegram"})

    # 2) the admin bot → a chat the user has messaged us from
    chat = db.get_telegram_chat_for_user(username)
    if chat:
        admin = db.get_telegram_config() or {}
        atoken = admin.get("botToken")
        if atoken:
            out.append({"kind": "telegram", "token": atoken, "chat": str(chat),
                        "hint": "Telegram"})

    # 3) email
    email = (user.get("email") or "").strip()
    if email and mailer.email_configured():
        out.append({"kind": "email", "to": email, "hint": _mask_email(email)})

    return out


def is_available(username: str, user: dict) -> bool:
    """True if we have any free channel to deliver a login code to this user."""
    return bool(_candidates(username, user))


def channel_hint(username: str, user: dict) -> str | None:
    cands = _candidates(username, user)
    return cands[0]["hint"] if cands else None


# ── delivery ─────────────────────────────────────────────────────────────────

def _message(code: str) -> tuple[str, str, str]:
    """Return (telegram_text, email_subject, email_body) for a code."""
    tg_text = (f"<b>ALGO770</b> login code: <b>{code}</b>\n"
               f"It expires in 10 minutes. If you didn't try to sign in, ignore this.")
    subject = "ALGO770 — your login code"
    body = (f"Your ALGO770 login code is: {code}\n\n"
            f"It expires in 10 minutes. If you didn't try to sign in, you can ignore this email.")
    return tg_text, subject, body


def _deliver(code: str, cand: dict) -> bool:
    tg_text, subject, body = _message(code)
    if cand["kind"] == "telegram":
        return tg.send_text_result(cand["token"], cand["chat"], tg_text)
    if cand["kind"] == "email":
        res = mailer.send_email(cand["to"], subject, body)
        return bool(res.get("ok"))
    return False


def _sms_last_resort(user: dict) -> bool:
    """Absolute fallback: Twilio Verify SMS, only if the owner opted back in via
    LOGIN_OTP_SMS_LAST_RESORT and the user has a phone. Off by default → no cost.
    Returns whether an SMS code was accepted for sending (the code lives on
    Twilio, so ``check`` must route back through the verifier for this user)."""
    if os.environ.get("LOGIN_OTP_SMS_LAST_RESORT", "0").lower() not in ("1", "true", "yes"):
        return False
    phone = (user.get("phone") or "").strip()
    if not phone:
        return False
    try:
        from app.services import verify as verifier
        if verifier.is_configured() and verifier.start(phone, "sms"):
            return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_otp sms last-resort error: %s", exc)
    return False


# ── public API ───────────────────────────────────────────────────────────────

def start(username: str, user: dict, purpose: str = "login") -> dict:
    """Generate + deliver a fresh login code over the best free channel.

    Returns ``{ok, channel, hint, reason}``:
      * ok=True  → a code was delivered; ``channel`` ∈ {telegram, email, sms},
                   ``hint`` is a human channel hint for the UI.
      * ok=False, reason="cooldown" → a live code was sent moments ago; the
                   caller should still require it (``hint`` is the live channel).
      * ok=False, reason="no_channel" → the user has no Telegram and no email
                   (and SMS last-resort is off / unavailable). Caller must not
                   fail-open.
    """
    now = time.time()
    existing = _get(username, purpose)

    # Resend throttle: if a live code went out very recently, don't spam.
    if existing and existing.get("exp", 0) > now:
        if now - existing.get("lastSendAt", 0) < RESEND_COOLDOWN_SECS:
            return {"ok": False, "reason": "cooldown", "channel": existing.get("channel"),
                    "hint": existing.get("hint")}
        if existing.get("sends", 0) >= MAX_SENDS:
            return {"ok": False, "reason": "cooldown", "channel": existing.get("channel"),
                    "hint": existing.get("hint")}

    cands = _candidates(username, user)

    # No free channel — optional, owner-gated SMS last resort so no one is locked out.
    if not cands:
        if _sms_last_resort(user):
            _put(username, purpose, None)  # code lives on Twilio, not here
            return {"ok": True, "channel": "sms", "hint": _mask_phone(user.get("phone", ""))}
        return {"ok": False, "reason": "no_channel"}

    code = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_hex(8)

    # Try each free channel in order until one delivers, so a flaky Telegram
    # send still falls through to email — nobody gets stranded.
    for cand in cands:
        if _deliver(code, cand):
            _put(username, purpose, {
                "hash": _hash(code, salt), "salt": salt, "exp": now + CODE_TTL_SECS,
                "attempts": 0, "sends": (existing.get("sends", 0) + 1) if existing else 1,
                "lastSendAt": now, "channel": cand["kind"], "hint": cand["hint"],
            })
            return {"ok": True, "channel": cand["kind"], "hint": cand["hint"]}

    # Every free channel failed to deliver → last-resort SMS if the owner allows.
    if _sms_last_resort(user):
        _put(username, purpose, None)
        return {"ok": True, "channel": "sms", "hint": _mask_phone(user.get("phone", ""))}
    return {"ok": False, "reason": "no_channel"}


def check(username: str, code: str, user: dict | None = None, purpose: str = "login") -> bool:
    """Validate a submitted code. Single-use, constant-time, attempt-capped.

    If this user's code was sent over the SMS last-resort path (nothing stored
    locally) we route the check back through Twilio Verify for that user only."""
    code = (code or "").strip()
    if not code:
        return False

    rec = _get(username, purpose)
    if rec is None:
        # Possibly an SMS-last-resort code, whose truth lives on Twilio.
        if user is not None and os.environ.get("LOGIN_OTP_SMS_LAST_RESORT", "0").lower() in ("1", "true", "yes"):
            phone = (user.get("phone") or "").strip()
            if phone:
                try:
                    from app.services import verify as verifier
                    return bool(verifier.check(phone, code))
                except Exception:  # noqa: BLE001
                    return False
        return False

    now = time.time()
    if rec.get("exp", 0) <= now:
        _put(username, purpose, None)
        return False

    attempts = rec.get("attempts", 0) + 1
    if attempts > MAX_ATTEMPTS:
        _put(username, purpose, None)  # burn the code after too many wrong tries
        return False

    if secrets.compare_digest(rec.get("hash", ""), _hash(code, rec.get("salt", ""))):
        _put(username, purpose, None)  # single-use success
        return True

    rec["attempts"] = attempts
    _put(username, purpose, rec)
    return False


def _mask_phone(phone: str) -> str:
    p = (phone or "").strip()
    return ("•••• " + p[-4:]) if len(p) >= 4 else "your phone"
