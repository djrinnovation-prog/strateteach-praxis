"""Email sender — SendGrid API (preferred) with an SMTP fallback (stdlib).

Two ways to configure, checked in this order:

  1) Twilio SendGrid HTTP API (recommended):
       SENDGRID_API_KEY   your SendGrid API key (starts with "SG.")
       SENDGRID_FROM      verified sender, e.g. "ALGO770 <noreply@strateteach.com>"
                          (falls back to SMTP_FROM if unset)

  2) Plain SMTP (Resend / SendGrid SMTP / Gmail / Mailgun / ...):
       SMTP_HOST   smtp.sendgrid.net / smtp.gmail.com / ...
       SMTP_PORT   587 (STARTTLS, default) or 465 (implicit TLS)
       SMTP_USER   provider username ("apikey" for SendGrid, your gmail, ...)
       SMTP_PASS   provider password / API key / app password
       SMTP_FROM   the From address
       SMTP_TLS    "false" to disable STARTTLS (default on)

If neither is configured, send_email() returns a clear "not configured" result.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
import threading
from email.message import EmailMessage

logger = logging.getLogger("algo770")


def sendgrid_configured() -> bool:
    return bool(os.environ.get("SENDGRID_API_KEY") and (os.environ.get("SENDGRID_FROM") or os.environ.get("SMTP_FROM")))


def smtp_configured() -> bool:
    """True if the minimum SMTP settings are present to attempt a send."""
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_FROM"))


def email_configured() -> bool:
    """True if email can be sent by any configured provider."""
    return sendgrid_configured() or smtp_configured()


def _parse_from(raw: str) -> dict:
    """Turn "Name <addr@x>" or "addr@x" into SendGrid's {email,name} shape."""
    raw = (raw or "").strip()
    if "<" in raw and ">" in raw:
        name = raw.split("<", 1)[0].strip().strip('"')
        addr = raw.split("<", 1)[1].split(">", 1)[0].strip()
        return {"email": addr, "name": name} if name else {"email": addr}
    return {"email": raw}


def _sg_attachments(attachments: list | None) -> list:
    """Normalize attachments to SendGrid v3 shape: base64 content + filename + type.

    Accepts items with either ``content`` (already base64 str) or ``content_bytes``
    (raw bytes, base64-encoded here). ``disposition`` defaults to 'attachment'."""
    import base64
    out = []
    for a in (attachments or []):
        raw = a.get("content_bytes")
        content = a.get("content") or (base64.b64encode(raw).decode("ascii") if raw else "")
        if not content:
            continue
        out.append({
            "content": content,
            "filename": a.get("filename") or "attachment",
            "type": a.get("type") or "application/octet-stream",
            "disposition": a.get("disposition") or "attachment",
        })
    return out


def _send_sendgrid(to: str, subject: str, body_text: str, body_html: str | None,
                   attachments: list | None = None) -> dict:
    try:
        import httpx
        key = os.environ["SENDGRID_API_KEY"]
        sender = os.environ.get("SENDGRID_FROM") or os.environ.get("SMTP_FROM") or ""
        content = [{"type": "text/plain", "value": body_text or ""}]
        if body_html:
            content.append({"type": "text/html", "value": body_html})
        payload = {
            "personalizations": [{"to": [{"email": to}]}],
            "from": _parse_from(sender),
            "subject": subject,
            "content": content,
        }
        sg_atts = _sg_attachments(attachments)
        if sg_atts:
            payload["attachments"] = sg_atts
        r = httpx.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=payload,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=20,
        )
        if r.status_code < 300:
            logger.info("email.sent", extra={"path": "sendgrid", "client": to})
            return {"ok": True, "message": f"Email sent to {to}."}
        logger.warning("sendgrid error %s: %s", r.status_code, r.text[:200])
        return {"ok": False, "message": f"SendGrid failed ({r.status_code}): {r.text[:160]}"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("sendgrid.error: %s", exc)
        return {"ok": False, "message": f"SendGrid error: {exc}"}


def send_email(to: str, subject: str, body_text: str, body_html: str | None = None,
               attachments: list | None = None) -> dict:
    if not to:
        return {"ok": False, "message": "No recipient address."}

    # Preferred path: SendGrid HTTP API.
    if sendgrid_configured():
        return _send_sendgrid(to, subject, body_text, body_html, attachments)

    host = os.environ.get("SMTP_HOST")
    sender = os.environ.get("SMTP_FROM")
    if not host or not sender:
        return {"ok": False, "message": "Email is not configured (set SENDGRID_API_KEY + SENDGRID_FROM, or SMTP_HOST + SMTP_FROM)."}

    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    use_tls = os.environ.get("SMTP_TLS", "true").lower() != "false"

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    import base64 as _b64
    for a in (attachments or []):
        raw = a.get("content_bytes") or (_b64.b64decode(a["content"]) if a.get("content") else b"")
        if not raw:
            continue
        maintype, _, subtype = (a.get("type") or "application/octet-stream").partition("/")
        msg.add_attachment(raw, maintype=maintype, subtype=subtype or "octet-stream",
                           filename=a.get("filename") or "attachment")

    try:
        ctx = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as server:
                if user:
                    server.login(user, password or "")
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                if use_tls:
                    server.starttls(context=ctx)
                if user:
                    server.login(user, password or "")
                server.send_message(msg)
        logger.info("email.sent", extra={"path": "smtp", "client": to})
        return {"ok": True, "message": f"Email sent to {to}."}
    except Exception as exc:  # noqa: BLE001 — surface any SMTP error to the caller
        logger.warning("email.error: %s", exc)
        return {"ok": False, "message": f"Email failed: {exc}"}


def _send_safe(to: str, subject: str, body_text: str, body_html: str | None) -> None:
    try:
        send_email(to, subject, body_text, body_html)
    except Exception as exc:  # noqa: BLE001
        logger.warning("email async error: %s", exc)


def send_email_async(to: str, subject: str, body_text: str, body_html: str | None = None) -> bool:
    """Queue an email on a daemon thread (non-blocking, mirrors sms.send_sms).

    False if email isn't configured or there's no recipient — a safe no-op so the
    app runs fine without email configured.
    """
    if not to or not email_configured():
        return False
    threading.Thread(target=_send_safe, args=(to, subject, body_text, body_html), daemon=True).start()
    return True
