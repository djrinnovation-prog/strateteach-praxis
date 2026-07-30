"""Twilio Verify — SMS one-time codes for login 2FA.

Uses the account's TWILIO_SID / TWILIO_TOKEN. The Verify Service SID can be set
explicitly via TWILIO_VERIFY_SID; otherwise we create a service named "ALGO770"
on first use and cache its SID in the DB singletons table, so no manual console
step is needed.
"""
from __future__ import annotations

import logging
import os

from app import database as db

logger = logging.getLogger("algo770")

_SINGLETON_KEY = "twilio_verify_sid"
_PENDING_KEY = "twilio_verify_pending"   # {phone: verification_sid} of the latest pending code
_BASE = "https://verify.twilio.com/v2/Services"

_LAST_ERROR = {"msg": ""}


def last_error() -> str:
    return _LAST_ERROR.get("msg", "")


def is_configured() -> bool:
    """Verify works whenever the base Twilio credentials are present."""
    return bool(os.environ.get("TWILIO_SID") and os.environ.get("TWILIO_TOKEN"))


def _auth():
    return (os.environ["TWILIO_SID"], os.environ["TWILIO_TOKEN"])


def get_service_sid() -> str | None:
    """Return the Verify Service SID, creating + caching one if needed."""
    sid = os.environ.get("TWILIO_VERIFY_SID")
    if sid:
        return sid
    cached = db._get_singleton(_SINGLETON_KEY, None)
    if cached:
        return cached
    if not is_configured():
        return None
    try:
        import httpx
        r = httpx.post(_BASE, data={"FriendlyName": "ALGO770"}, auth=_auth(), timeout=15)
        if r.status_code < 300:
            sid = r.json().get("sid")
            if sid:
                db._set_singleton(_SINGLETON_KEY, sid)
                logger.info("Created Twilio Verify service %s", sid)
                return sid
        logger.warning("verify service create failed: %s %s", r.status_code, r.text[:200])
    except Exception as exc:  # noqa: BLE001
        logger.warning("verify service create error: %s", exc)
    return None


def _pending() -> dict:
    return db._get_singleton(_PENDING_KEY, {}) or {}


def _cancel_pending(sid: str, to: str) -> None:
    """Cancel the previous pending verification for this number so a NEW code is issued.

    Twilio Verify otherwise RESENDS the same code on repeated requests until it
    expires — which is why users saw the identical code several times. Canceling
    first guarantees a fresh code each time."""
    pend = _pending()
    vsid = pend.get(to)
    if not vsid:
        return
    try:
        import httpx
        httpx.post(f"{_BASE}/{sid}/Verifications/{vsid}", data={"Status": "canceled"}, auth=_auth(), timeout=10)
    except Exception:  # noqa: BLE001 — already approved/expired/canceled is fine
        pass
    pend.pop(to, None)
    db._set_singleton(_PENDING_KEY, pend)


def start(to: str, channel: str = "sms") -> bool:
    """Send a FRESH verification code to ``to``. Returns whether it was accepted."""
    sid = get_service_sid()
    if not sid or not to:
        return False
    _cancel_pending(sid, to)
    try:
        import httpx
        r = httpx.post(f"{_BASE}/{sid}/Verifications",
                       data={"To": to, "Channel": channel}, auth=_auth(), timeout=15)
        if r.status_code < 300:
            _LAST_ERROR["msg"] = ""
            vsid = r.json().get("sid")
            if vsid:
                pend = _pending()
                pend[to] = vsid
                db._set_singleton(_PENDING_KEY, pend)
            return True
        _LAST_ERROR["msg"] = f"{r.status_code}: {r.text[:240]}"
        logger.warning("verify start failed: %s %s", r.status_code, r.text[:200])
    except Exception as exc:  # noqa: BLE001
        _LAST_ERROR["msg"] = str(exc)[:240]
        logger.warning("verify start error: %s", exc)
    return False


def check(to: str, code: str) -> bool:
    """Check a code the user entered. Returns True only if Twilio says 'approved'."""
    sid = get_service_sid()
    if not sid or not to or not code:
        return False
    try:
        import httpx
        r = httpx.post(f"{_BASE}/{sid}/VerificationCheck",
                       data={"To": to, "Code": str(code).strip()}, auth=_auth(), timeout=15)
        if r.status_code < 300:
            return r.json().get("status") == "approved"
        logger.warning("verify check failed: %s %s", r.status_code, r.text[:200])
    except Exception as exc:  # noqa: BLE001
        logger.warning("verify check error: %s", exc)
    return False
