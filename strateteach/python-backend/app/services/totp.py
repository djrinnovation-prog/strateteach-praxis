"""TOTP (RFC 6238) authenticator-app login factor — high-security, ZERO cost.

The code is generated on the user's device by Google Authenticator / Authy /
1Password, so NOTHING is sent per login (no SMS, no Telegram, no email). It also
works offline and is phishing-resistant (the shared secret never travels after
the one-time QR scan).

When a user has TOTP enabled it is the PRIMARY login factor; the Telegram/email
one-time code (see ``login_otp``) becomes the lost-device RECOVERY path.

Security:
  * 6-digit codes on a 30-second step (pyotp defaults, standard for authenticators)
  * verify with a ±1 step window (clock drift tolerance) — same as every app
  * REPLAY GUARD: a code's 30s time-step is recorded once accepted; the same (or
    an older) step is refused, so a shoulder-surfed code can't be reused
  * brute-force is bounded by the existing account lockout (record_failed_login /
    lock_status in the login route) plus this module's replay guard
"""
from __future__ import annotations

import logging

import pyotp
import segno

from app import database as db

logger = logging.getLogger("algo770")

ISSUER = "ALGO770"
_STEP_SECS = 30


def is_available() -> bool:
    """TOTP needs no server config or third party — always available."""
    return True


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(username: str, secret: str) -> str:
    """otpauth:// URI an authenticator app imports (via QR or manual entry)."""
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=ISSUER)


def qr_svg_data_uri(uri: str) -> str:
    """Render the provisioning URI to a QR as an inline SVG data URI (pure
    Python, no image libs). The frontend drops it straight into <img src>."""
    return segno.make(uri, error="m").svg_data_uri(scale=5, border=2)


def _now_step() -> int:
    import time
    return int(time.time()) // _STEP_SECS


def verify(username: str, user: dict, code: str) -> bool:
    """Verify a submitted authenticator code for an ENABLED user.

    Uses the stored secret, tolerates ±1 step of clock drift, and enforces the
    single-use replay guard against ``totp_last_step``. Returns False for any
    non-6-digit input, a missing secret, a stale/replayed step, or a mismatch."""
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        return False
    secret = user.get("totp_secret")
    if not user.get("totp_enabled") or not secret:
        return False

    totp = pyotp.TOTP(secret)
    now = _now_step()
    last = int(user.get("totp_last_step") or 0)
    # Check this step and the immediate neighbours (drift), newest-first, and
    # only ACCEPT a step strictly newer than the last one we honoured.
    for offset in (0, -1, 1):
        step = now + offset
        if step <= last:
            continue
        if totp.verify(code, for_time=step * _STEP_SECS, valid_window=0):
            db.set_totp_last_step(username, step)
            return True
    return False


def verify_setup(secret: str, code: str) -> bool:
    """Confirm a code against a PENDING secret during enable (no replay guard yet —
    the secret isn't active until this succeeds). ±1 step drift tolerance."""
    code = (code or "").strip()
    if not secret or not code.isdigit() or len(code) != 6:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)
