"""User-facing notifications — routes a message to a user's enabled channels.

Respects per-user preferences (db.get_notif_prefs):
  - channels: sms / whatsapp / email (opt-in, default OFF, strictly per-user)
  - alert types: breakout / takeProfit / stopLoss / digest

Safe no-op if the user has no phone/email or the channel isn't configured on the
server. All sends are non-blocking (each service uses daemon threads).

Opt-out model: the SMS sender is an alphanumeric ID ("Strateteach"), which is
one-way — "reply STOP" does NOT work. The real opt-out is the in-app toggle
(turning a channel OFF here stops all sends). Alert messages carry a short
"manage/stop in the app" note so recipients know how to opt out.
"""
from __future__ import annotations

import logging

from app import database as db
from app.services import sms
from app.services import email as email_svc

logger = logging.getLogger("algo770")

# Alert types that carry a compliance opt-out note (skip chat/test — those are
# conversational and already user-initiated).
_ALERT_KINDS = {"breakout", "takeProfit", "stopLoss", "botTrade", "digest", "team_message"}

# Short SMS/WhatsApp footer — sender is one-way, so opt-out is in the app, not STOP.
_SMS_OPTOUT = " — Manage or stop alerts in the app."
_EMAIL_FOOTER = (
    "\n\n—\nYou're receiving this because alerts are enabled on your Strateteach "
    "account. Manage or turn off alerts anytime in the app (Settings → Notifications). "
    "Standard message rates may apply for SMS."
)

# Human subject line per alert kind for the email channel.
_EMAIL_SUBJECTS = {
    "breakout": "Strateteach — price breakout",
    "takeProfit": "Strateteach — take-profit hit",
    "stopLoss": "Strateteach — stop-loss triggered",
    "botTrade": "Strateteach — Signal Bot order",
    "digest": "Strateteach — daily scan digest",
    "chat": "Strateteach — new message",
    "team_message": "Strateteach — message from the team",
}


def _sms_body(text: str, kind: str | None) -> str:
    """Append a short opt-out note to alert messages (one-way sender — no STOP)."""
    if kind in _ALERT_KINDS and "in the app" not in (text or ""):
        return (text + _SMS_OPTOUT)[:1000]
    return text


def _send_whatsapp_windowed(username: str, wa: str, body: str) -> bool:
    """Deliver a WhatsApp message respecting the 24h session window.

    In-window (the user messaged us within 24h) → free-form send. Out-of-window
    (business-initiated) → prefer a Twilio Content template if TWILIO_WA_TEMPLATE_SID
    is configured (the 63016-compliant path). If NO template is configured we still
    make a best-effort free-form attempt rather than dropping the alert silently:
    alerts are inherently business-initiated (the user rarely messages us first), so
    a silent skip means WhatsApp alerts never fire at all. On the Twilio sandbox a
    joined recipient receives it; a genuinely out-of-window send just errors (63016)
    and is logged — never affecting the other channels. Configure the template SID
    for the fully compliant business-initiated path.
    """
    if db.wa_in_window(username):
        return sms.send_whatsapp(wa, body)
    if sms.wa_template_configured():
        # Generic single-variable notification template ({{1}} = the message body).
        return sms.send_whatsapp_template(wa, variables={"1": (body or "")[:900]})
    logger.info(
        "whatsapp to %s: outside 24h window and no TWILIO_WA_TEMPLATE_SID — "
        "attempting best-effort free-form send", username,
    )
    return sms.send_whatsapp(wa, body)


def notify_user(username: str, text: str, kind: str | None = None,
                *, subject: str | None = None, channels: set[str] | None = None,
                require_consent: bool = True, sms_text: str | None = None) -> bool:
    """Send ``text`` to ``username`` on their enabled channels.

    If ``kind`` is given (e.g. 'breakout', 'takeProfit', 'stopLoss', 'digest')
    the send is skipped unless the user opted into that alert type.
    ``channels`` optionally restricts delivery to a subset of {'sms','whatsapp',
    'email'} (used when another path handles a channel — e.g. the two-way WhatsApp
    reply sends the real text itself).
    ``require_consent`` (default True) keeps the per-channel opt-in gate. Pass False
    ONLY for internal owner/staff sends (e.g. the Owners-Portal team report) where a
    contact on file is sufficient — the recipient still needs the number/address, just
    not the marketing consent toggle.
    ``sms_text`` (optional) is a SHORT, length-safe body used for the SMS channel ONLY
    (WhatsApp + email keep the full ``text``). SMS has a hard 1600-char cap and Hebrew +
    emojis force UCS-2 (~67 chars/segment), so a long multi-section report silently fails
    to deliver over SMS — the caller passes a compact summary + a link instead. When it's
    None, SMS uses ``text`` (unchanged behaviour). Returns True if at least one channel queued.
    """
    try:
        prefs = db.get_notif_prefs(username)
    except Exception as exc:  # noqa: BLE001
        logger.warning("notify_user prefs error for %s: %s", username, exc)
        return False

    if kind and not prefs.get(kind, True):
        return False

    def _want(ch: str) -> bool:
        return channels is None or ch in channels

    def _consented(ch: str) -> bool:
        return bool(prefs.get(ch)) or not require_consent

    phone = prefs.get("phone") or ""
    sent = False
    if _want("sms") and _consented("sms") and phone:
        # SMS carries the short, length-safe body when the caller provided one; WhatsApp +
        # email below keep the full ``text``.
        sms_payload = sms_text if sms_text is not None else text
        sent = sms.send_sms(phone, _sms_body(sms_payload, kind)) or sent
    if _want("whatsapp") and _consented("whatsapp"):
        wa = prefs.get("whatsappTo") or phone
        if wa:
            sent = _send_whatsapp_windowed(username, wa, _sms_body(text, kind)) or sent
    if _want("email") and _consented("email"):
        addr = prefs.get("emailTo") or ""
        if addr:
            subj = subject or _EMAIL_SUBJECTS.get(kind or "", "Strateteach alert")
            sent = email_svc.send_email_async(addr, subj, (text or "") + _EMAIL_FOOTER) or sent
    return sent


def notify_many(usernames: list[str], text: str, kind: str | None = None) -> int:
    """Notify a list of users; returns how many had a channel queued."""
    return sum(1 for u in usernames if notify_user(u, text, kind))


def send_whatsapp_reply(username: str, text: str) -> dict:
    """Deliver an owner's Requests-Portal reply to ``username`` over WhatsApp.

    Two-way support for the help desk: if the user has WhatsApp enabled and is
    inside their 24h window, send free-form; outside the window it needs a Content
    template. Returns a status dict so the caller can flag when a template is
    required:
      {enabled, inWindow, queued, needsTemplate}
    """
    status = {"enabled": False, "inWindow": False, "queued": False, "needsTemplate": False}
    try:
        prefs = db.get_notif_prefs(username)
    except Exception as exc:  # noqa: BLE001
        logger.warning("send_whatsapp_reply prefs error for %s: %s", username, exc)
        return status
    wa = prefs.get("whatsappTo") or prefs.get("phone") or ""
    if not (prefs.get("whatsapp") and wa):
        return status
    status["enabled"] = True
    body = _sms_body(text, "team_message")
    if db.wa_in_window(username):
        status["inWindow"] = True
        status["queued"] = sms.send_whatsapp(wa, body)
    elif sms.wa_template_configured():
        status["queued"] = sms.send_whatsapp_template(wa, variables={"1": (body or "")[:900]})
        status["needsTemplate"] = not status["queued"]
    else:
        # Out of window and no template on file — cannot business-initiate yet.
        status["needsTemplate"] = True
    return status
