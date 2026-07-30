"""Twilio messaging — fire-and-forget SMS + WhatsApp alerts.

Configured via env vars (set in the server's .env):
  TWILIO_SID            – Account SID (starts with AC...)
  TWILIO_TOKEN          – Auth Token
  TWILIO_FROM           – the Twilio phone number to SMS from (e.g. +1415...)
  TWILIO_WHATSAPP_FROM  – the WhatsApp sender, e.g. "whatsapp:+14155238886"
                          (Twilio's shared sandbox number works for testing)
  TWILIO_WA_TEMPLATE_SID – (optional) a Twilio Content template SID (HX...) used to
                          send business-INITIATED WhatsApp messages OUTSIDE the 24h
                          window (Twilio 63016 otherwise). Created in the Twilio
                          console once WhatsApp is production-approved. Until it's
                          set, out-of-window sends are safely skipped (logged).

If the needed vars are missing, the matching send_*() is a safe no-op, so the
app runs fine without messaging configured. Sends happen on a daemon thread so
they never block or fail a request.
"""
from __future__ import annotations

import logging
import os
import threading

logger = logging.getLogger("algo770")


# ---------------------------------------------------------------- config checks
def _sms_channel_enabled() -> bool:
    """KILL SWITCH for outbound SMS (reports/alerts/reminders). Default OFF.

    Dan was getting a report SMS every ~5 minutes over Twilio (real cost) and asked to
    turn report/SMS off. Every ``send_sms`` caller is a report/alert/reminder — NONE is
    login/2FA (login OTP uses free Telegram → email, and the SMS-of-last-resort uses Twilio
    VERIFY via services.verify, a different path). So gating here stops the spend without
    touching auth. Re-enable by setting ``SMS_ALERTS_ENABLED=1`` in the server .env.
    WhatsApp/Telegram/email channels are unaffected."""
    return os.environ.get("SMS_ALERTS_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


def is_configured() -> bool:
    """True if plain SMS can be sent (creds present AND the channel is enabled)."""
    return bool(
        _sms_channel_enabled()
        and os.environ.get("TWILIO_SID")
        and os.environ.get("TWILIO_TOKEN")
        and os.environ.get("TWILIO_FROM")
    )


def whatsapp_configured() -> bool:
    """True if WhatsApp can be sent (SID + token + a whatsapp: sender)."""
    return bool(
        os.environ.get("TWILIO_SID")
        and os.environ.get("TWILIO_TOKEN")
        and os.environ.get("TWILIO_WHATSAPP_FROM")
    )


def wa_template_sid() -> str:
    """The configured Content template SID for out-of-window WhatsApp, or ''."""
    return (os.environ.get("TWILIO_WA_TEMPLATE_SID") or "").strip()


def wa_template_configured() -> bool:
    """True if business-initiated (out-of-24h-window) WhatsApp can be sent."""
    return whatsapp_configured() and bool(wa_template_sid())


def channel_configured(channel: str) -> bool:
    return whatsapp_configured() if channel == "whatsapp" else is_configured()


# ---------------------------------------------------------------- low-level send
def _post(frm: str, to: str, body: str) -> None:
    try:
        import httpx
        sid = os.environ["TWILIO_SID"]
        tok = os.environ["TWILIO_TOKEN"]
        r = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            data={"From": frm, "To": to, "Body": (body or "")[:1000]},
            auth=(sid, tok),
            timeout=12,
        )
        if r.status_code >= 300:
            logger.warning("Twilio send to %s failed: %s %s", to, r.status_code, r.text[:200])
        else:
            try:
                sid_out = r.json().get("sid", "?")
            except Exception:  # noqa: BLE001
                sid_out = "?"
            logger.info("Twilio send to %s ok: %s (sid=%s)", to, r.status_code, sid_out)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Twilio send error: %s", exc)


def _post_content(frm: str, to: str, content_sid: str, variables: dict | None) -> None:
    """Send a WhatsApp Content-template message (business-initiated, out-of-window).

    Uses Twilio's ContentSid + ContentVariables so it clears the 24h-window rule
    (free-form would be rejected with error 63016 outside the window).
    """
    try:
        import json
        import httpx
        sid = os.environ["TWILIO_SID"]
        tok = os.environ["TWILIO_TOKEN"]
        data = {"From": frm, "To": to, "ContentSid": content_sid}
        if variables:
            # Twilio expects a JSON object of {"1": "...", "2": "..."} string vars.
            data["ContentVariables"] = json.dumps({str(k): str(v) for k, v in variables.items()})
        r = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            data=data,
            auth=(sid, tok),
            timeout=12,
        )
        if r.status_code >= 300:
            logger.warning("Twilio template send to %s failed: %s %s", to, r.status_code, r.text[:200])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Twilio template send error: %s", exc)


def _norm_wa(num: str) -> str:
    """Ensure a WhatsApp address has the whatsapp: prefix."""
    num = (num or "").strip()
    if not num:
        return num
    return num if num.startswith("whatsapp:") else f"whatsapp:{num}"


# ---------------------------------------------------------------- public senders
def send_sms(to: str, body: str) -> bool:
    """Queue an SMS (non-blocking). False if SMS isn't configured or no number."""
    if not is_configured() or not to:
        return False
    frm = os.environ["TWILIO_FROM"]
    threading.Thread(target=_post, args=(frm, to, body), daemon=True).start()
    return True


def send_whatsapp(to: str, body: str) -> bool:
    """Queue a WhatsApp message (non-blocking). False if not configured / no number."""
    if not whatsapp_configured() or not to:
        logger.info("whatsapp send skipped: configured=%s to=%r", whatsapp_configured(), to)
        return False
    frm = _norm_wa(os.environ["TWILIO_WHATSAPP_FROM"])
    dest = _norm_wa(to)
    # Confirm the attempt in prod logs (Twilio POST fires on the daemon thread next).
    logger.info("whatsapp send → to=%s from=%s (%d chars)", dest, frm, len(body or ""))
    threading.Thread(target=_post, args=(frm, dest, body), daemon=True).start()
    return True


def send_whatsapp_template(to: str, content_sid: str | None = None,
                           variables: dict | None = None) -> bool:
    """Queue a business-initiated WhatsApp Content-template message (non-blocking).

    For messages sent OUTSIDE the recipient's 24h window, where free-form is not
    allowed. ``content_sid`` defaults to the TWILIO_WA_TEMPLATE_SID env slot. Returns
    False (a safe no-op) if WhatsApp/template isn't configured or there's no number.
    """
    if not whatsapp_configured() or not to:
        return False
    sid = (content_sid or wa_template_sid()).strip()
    if not sid:
        logger.info("send_whatsapp_template: no template SID configured — skipping out-of-window send")
        return False
    frm = _norm_wa(os.environ["TWILIO_WHATSAPP_FROM"])
    threading.Thread(target=_post_content, args=(frm, _norm_wa(to), sid, variables), daemon=True).start()
    return True


def send(channel: str, to: str, body: str) -> bool:
    """Send on a named channel ('sms' | 'whatsapp'). Returns whether it was queued."""
    if channel == "whatsapp":
        return send_whatsapp(to, body)
    return send_sms(to, body)
