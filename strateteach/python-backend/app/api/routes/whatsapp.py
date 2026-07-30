"""Inbound WhatsApp webhook (Twilio) → Requests Portal.

Twilio POSTs an inbound WhatsApp message (application/x-www-form-urlencoded) to
this endpoint when a user replies in WhatsApp. We:

  1. VALIDATE the Twilio request signature (X-Twilio-Signature, HMAC-SHA1 over the
     request URL + sorted POST params, keyed by the account auth token). No SDK
     dependency — the algorithm is implemented inline.
  2. Map the sender ("whatsapp:+E.164") back to an app user by phone.
  3. File the message into the Requests Portal — appended to the user's most-recent
     open request, or a fresh user_request if none is open. Unknown senders still
     land as an ownerless request so an owner can triage them.
  4. Stamp the user's 24h free-form messaging window (so an owner reply can go back
     out free-form; see app.services.notify.send_whatsapp_reply).

The route is PUBLIC (no bearer) — it's allowlisted in core.security and gated by
the Twilio signature instead. It always returns 200 with empty TwiML so Twilio
does not retry / show an error to the sender.

Prod wiring (later, by Dan): point the Twilio sandbox "WHEN A MESSAGE COMES IN"
URL at  https://<host>/auth/whatsapp/inbound  (POST). If the reconstructed URL
ever mismatches behind the proxy, set TWILIO_INBOUND_URL to the exact console URL.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os

from fastapi import APIRouter, Request, Response

from app import database as db

logger = logging.getLogger("algo770")

router = APIRouter(tags=["whatsapp"])

# Empty TwiML — a valid "do nothing / no auto-reply" response Twilio accepts.
_EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


def _twiml(status: int = 200) -> Response:
    return Response(content=_EMPTY_TWIML, media_type="application/xml", status_code=status)


def _expected_signature(url: str, params: dict[str, str], token: str) -> str:
    """Twilio's scheme: base64(HMAC-SHA1(token, url + sorted(key+value)…))."""
    data = url
    for key in sorted(params.keys()):
        data += key + (params[key] or "")
    mac = hmac.new(token.encode("utf-8"), data.encode("utf-8"), hashlib.sha1)
    return base64.b64encode(mac.digest()).decode("ascii")


def _candidate_urls(request: Request) -> list[str]:
    """Exact URL strings Twilio might have signed. Behind a reverse proxy the app
    can't always see the public scheme/host, so we try a few forms and accept if
    ANY validates. An explicit TWILIO_INBOUND_URL override wins (safest for prod)."""
    path = request.url.path
    urls: list[str] = []
    override = (os.environ.get("TWILIO_INBOUND_URL") or "").strip()
    if override:
        urls.append(override)
    # Reconstruct from proxy-forwarded headers (Caddy sets X-Forwarded-Proto/Host).
    fwd_proto = request.headers.get("x-forwarded-proto")
    fwd_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    for proto in [p for p in (fwd_proto, "https", "http") if p]:
        if fwd_host:
            urls.append(f"{proto}://{fwd_host}{path}")
    # As a last resort, the raw URL FastAPI saw (may be the internal address).
    urls.append(str(request.url))
    # De-dup, preserve order.
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _valid_twilio_signature(request: Request, params: dict[str, str], signature: str) -> bool:
    token = (os.environ.get("TWILIO_TOKEN") or "").strip()
    if not token or not signature:
        return False
    for url in _candidate_urls(request):
        if hmac.compare_digest(_expected_signature(url, params, token), signature):
            return True
    return False


def _file_inbound(username: str | None, sender: str, body: str, media_count: int) -> None:
    """Append the inbound WhatsApp message into the Requests Portal.

    For a known user: append to their newest open user_request, else open a new
    one. For an unknown sender: open an ownerless user_request so an owner sees it.
    """
    text = (body or "").strip()
    if media_count and not text:
        text = f"[{media_count} media attachment(s)]"
    text = f"📱 WhatsApp: {text}"[:8000]

    if username:
        rid = db.latest_open_request_id(username)
        if rid:
            db.add_request_reply(rid, username, db.display_name(username), text)
            # Re-open if it had been answered/resolved so an owner notices the reply.
            req = db.get_request(rid)
            if req and req.get("status") in ("answered", "resolved"):
                db.set_request_status(rid, "new")
        else:
            db.create_request(username, db.display_name(username), "user_request",
                              "WhatsApp message", text, route="whatsapp")
    else:
        # Unknown sender — keep the raw address in the display name for triage.
        db.create_request(None, f"WhatsApp {sender}", "user_request",
                          "WhatsApp (unknown sender)", text, route="whatsapp")

    # Best-effort ping to the admin's Telegram so replies are noticed quickly.
    try:
        from app.services import telegram as tg
        import html
        who = db.display_name(username) if username else sender
        tg.notify_admin(f"📱 <b>WhatsApp</b> from {html.escape(who)}\n{html.escape(text[:400])}")
    except Exception:  # noqa: BLE001
        pass


@router.post("/auth/whatsapp/inbound")
async def whatsapp_inbound(request: Request):
    """Twilio inbound-WhatsApp webhook. Signature-validated; files into Requests."""
    try:
        form = await request.form()
    except Exception:  # noqa: BLE001
        return _twiml(200)
    params = {k: str(v) for k, v in form.items()}
    signature = request.headers.get("x-twilio-signature", "")

    if not _valid_twilio_signature(request, params, signature):
        # Reject unsigned / mis-signed callers. 403 so Twilio surfaces the config error.
        logger.warning("whatsapp inbound: bad/missing Twilio signature from %s",
                       request.client.host if request.client else "?")
        return _twiml(403)

    sender = params.get("From", "")            # "whatsapp:+E.164"
    body = params.get("Body", "")
    try:
        media_count = int(params.get("NumMedia", "0") or 0)
    except ValueError:
        media_count = 0

    username = None
    try:
        username = db.get_user_by_phone(sender)
    except Exception as exc:  # noqa: BLE001
        logger.warning("whatsapp inbound: phone lookup failed: %s", exc)

    if username:
        db.wa_mark_inbound(username)           # opens the 24h free-form window

    try:
        _file_inbound(username, sender, body, media_count)
    except Exception as exc:  # noqa: BLE001 — never fail Twilio's callback
        logger.warning("whatsapp inbound: filing failed: %s", exc)

    logger.info("whatsapp inbound from %s → user=%s (%d chars, %d media)",
                sender, username or "unknown", len(body or ""), media_count)
    return _twiml(200)
