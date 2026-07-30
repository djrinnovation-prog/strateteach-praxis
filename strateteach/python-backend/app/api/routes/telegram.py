"""Telegram delivery: config, chat auto-detect, manual send, test message, and
the admin bot (approve/deny signup requests via inline buttons + webhook)."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Header
from pydantic import BaseModel

from app import database as db
from app.core.security import require_admin
from fastapi import Depends
from app.services import telegram as tg

logger = logging.getLogger("algo770")

router = APIRouter(tags=["telegram"])


def _app_url() -> str:
    return tg.app_url()


@router.post("/telegram/enable-approvals")
async def telegram_enable_approvals(_: str = Depends(require_admin)):
    """Register the Telegram webhook so Approve/Deny buttons work, and confirm."""
    cfg = db.get_telegram_config()
    token, chat = cfg.get("botToken"), cfg.get("chatId")
    if not token or not chat:
        raise HTTPException(400, "Connect Telegram (bot token + chat) first.")
    base = _app_url()
    if not tg.is_public_https(base):
        # Telegram only delivers to a public https URL — refuse loudly rather than
        # register a dead localhost webhook that silently drops every reply.
        logger.warning("telegram.enable_approvals refused non_public_url=%s", base)
        raise HTTPException(
            400,
            f"Webhook URL '{base}' is not publicly reachable. Set APP_URL/DOMAIN to "
            "your real https domain (you're likely on the local dev override).",
        )
    secret = tg.webhook_secret()
    res = await tg.set_webhook(token, f"{base}/telegram/webhook", secret)
    if not res.get("ok"):
        logger.warning("telegram.enable_approvals setWebhook_failed err=%s", res.get("description"))
        raise HTTPException(502, f"Telegram setWebhook failed: {res.get('description', 'error')}")
    db.set_telegram_approvals_enabled(True)
    logger.info("telegram.enable_approvals ok url=%s/telegram/webhook", base)
    import httpx
    async with httpx.AsyncClient(timeout=10) as c:
        await c.post(tg.API.format(token=token, method="sendMessage"),
                     json={"chat_id": chat, "text": "✅ Admin approvals enabled. You'll get new access requests here with Approve/Deny buttons."})
    return {"ok": True}


class NotifyInput(BaseModel):
    text: str


@router.post("/telegram/notify")
async def telegram_notify(body: NotifyInput, _: str = Depends(require_admin)):
    """Admin: push a plain message to the admin's Telegram chat (used by automations)."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    tg.notify_admin(text[:3500])
    return {"ok": True}


@router.post("/telegram/disconnect")
async def telegram_disconnect(_: str = Depends(require_admin)):
    """Admin-only: forget the stored bot token + chat, remove the webhook, and
    turn approvals off — so the bot can be re-connected from scratch."""
    cfg = db.get_telegram_config()
    token = cfg.get("botToken")
    if token:
        await tg.delete_webhook(token)
    db.disconnect_telegram_config()
    return {"ok": True}


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, x_telegram_bot_api_secret_token: Optional[str] = Header(default=None)):
    """PUBLIC: Telegram calls this when a button is pressed. Verified by secret header."""
    if x_telegram_bot_api_secret_token != tg.webhook_secret():
        raise HTTPException(403, "bad secret")
    update = await request.json()
    cfg = db.get_telegram_config()
    token = cfg.get("botToken")

    # Text commands typed in the bot chat (/who, /pending, /stats, /broadcast …).
    msg_in = (update or {}).get("message") or {}
    txt = (msg_in.get("text") or "").strip()
    if txt and token:
        chat_in = str((msg_in.get("chat") or {}).get("id") or cfg.get("chatId") or "")
        is_admin_chat = bool(str(cfg.get("chatId") or "")) and chat_in == str(cfg.get("chatId"))
        if txt.startswith("/"):
            # Slash commands (/who, /pending, /stats, /broadcast …) — admin chat only.
            from app.services import telegram_admin
            if is_admin_chat:
                try:
                    await telegram_admin.handle_command(token, chat_in, txt)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("telegram.webhook command_error cmd=%r err=%s", txt[:40], str(exc)[:200])
            else:
                logger.info("telegram.webhook ignored_command from_chat=%s (not admin)", chat_in)
            return {"ok": True}
        # Free text from the admin → drop it into the Assistant inbox so it can be
        # answered from the dashboard; remember the chat so that reply mirrors back
        # here (see /auth/assistant/reply). The admin can just chat with the bot.
        if is_admin_chat:
            try:
                db.ensure_assistant_user()
                db.set_telegram_chat_for_user("admin", chat_in)
                db.chat_send("admin", "assistant", txt[:2000])
                await tg.send_message(token, chat_in, "📝 Got it — I'll reply right here shortly.")
                logger.info("telegram.webhook free_text queued len=%d", len(txt))
            except Exception as exc:  # noqa: BLE001
                logger.warning("telegram.webhook free_text_error err=%s", str(exc)[:200])
        else:
            logger.info("telegram.webhook ignored_text from_chat=%s (not admin)", chat_in)
        return {"ok": True}

    cb = (update or {}).get("callback_query")
    if not cb:
        return {"ok": True}
    data = (cb.get("data") or "")
    msg = cb.get("message") or {}
    chat_id = (msg.get("chat") or {}).get("id")
    message_id = msg.get("id") if "id" in msg else msg.get("message_id")
    from app.services import signup as signup_svc
    try:
        action, _, rid_s = data.partition(":")
        rid = int(rid_s)
    except Exception:  # noqa: BLE001
        if token:
            await tg.answer_callback(token, cb.get("id", ""), "Unknown action")
        return {"ok": True}

    if action == "approve":
        r = signup_svc.approve(rid, "telegram-admin")
        note = (f"✅ Approved → {r.get('username')}" if r.get("ok")
                else ("Already handled" if r.get("error") == "already_handled" else "Could not approve"))
    elif action == "deny":
        r = signup_svc.deny(rid, "telegram-admin")
        note = "✖ Denied" if r.get("ok") else "Not found"
    else:
        note = "Unknown action"

    if token:
        await tg.answer_callback(token, cb.get("id", ""), note)
        if chat_id and message_id:
            base = (msg.get("text") or "").split("\n\n—")[0]
            await tg.edit_message_text(token, str(chat_id), int(message_id), f"{base}\n\n— {note}")
    return {"ok": True}


class TelegramConfigInput(BaseModel):
    botToken: str
    chatId: str
    scheduleTime: str = "08:00"
    scheduleEnabled: bool = False
    runIdOverride: Optional[str] = None
    notifyExcelDaily: bool = True
    notifyRunFinished: bool = True
    notifyProfitEngine: bool = True
    notifySignals: bool = True
    notifyAssistant: bool = True


class TelegramSendInput(BaseModel):
    runId: Optional[str] = None


class TelegramDetectInput(BaseModel):
    botToken: str


def _resolve_bot_token(submitted: str) -> str:
    """GET /telegram/config returns the token masked; a blank or masked value
    means 'keep the stored token'. A genuine token never contains '•'."""
    if not submitted or "•" in submitted:
        return db.get_telegram_config().get("botToken", "")
    return submitted


def _reschedule_telegram(cfg: dict) -> None:
    """Scheduled daily Telegram send (APScheduler) is wired in M9."""
    logger.debug("telegram scheduling deferred to M9 (scheduleEnabled=%s)", cfg.get("scheduleEnabled"))


@router.get("/telegram/config")
async def telegram_config():
    cfg = db.get_telegram_config()
    # Mask the token — never return the raw token (these routes aren't bearer-gated client-side).
    token = cfg.get("botToken", "")
    cfg["botTokenMasked"] = ("•" * max(0, len(token) - 6) + token[-6:]) if token else ""
    cfg["configured"] = bool(token and cfg.get("chatId"))
    cfg["approvalsEnabled"] = db.telegram_approvals_enabled()
    cfg["botToken"] = ""
    return cfg


@router.post("/telegram/config")
async def telegram_set_config(body: TelegramConfigInput):
    token = _resolve_bot_token(body.botToken)
    db.save_telegram_config(
        bot_token=token, chat_id=body.chatId, schedule_time=body.scheduleTime,
        schedule_enabled=body.scheduleEnabled, run_id_override=body.runIdOverride or None,
        notify_excel_daily=body.notifyExcelDaily, notify_run_finished=body.notifyRunFinished,
        notify_profit_engine=body.notifyProfitEngine, notify_signals=body.notifySignals,
        notify_assistant=body.notifyAssistant,
    )
    _reschedule_telegram(db.get_telegram_config())
    return {"ok": True, "message": "Telegram config saved."}


# ── Per-admin Telegram: each admin connects their OWN bot + chat ───────────────
class MyTelegramInput(BaseModel):
    botToken: str = ""
    chatId: str = ""


@router.get("/telegram/my-config")
async def telegram_my_config(user: str = Depends(require_admin)):
    c = db.get_user_telegram(user)
    token = c.get("botToken", "")
    chat = c.get("chatId", "")
    connected = bool(token and chat)
    # Drive the UI from a saved token + chat ID. `connected` is the primary flag;
    # `lastTestOk` lets the panel additionally show "verified" after a Send-test.
    return {
        "chatId": chat,
        "configured": connected,
        "connected": connected,
        "tokenSet": bool(token),
        "chatIdSet": bool(chat),
        "lastTestOk": bool(c.get("lastTestOk")),
        "botTokenMasked": ("•" * max(0, len(token) - 6) + token[-6:]) if token else "",
    }


@router.post("/telegram/my-config")
async def telegram_my_set(body: MyTelegramInput, user: str = Depends(require_admin)):
    token = body.botToken
    if not token or "•" in token:  # blank/masked → keep the stored token
        token = db.get_user_telegram(user).get("botToken", "")
    if not token or not body.chatId:
        raise HTTPException(400, "botToken and chatId are required.")
    db.save_user_telegram(user, token, body.chatId)
    return {"ok": True, "message": "Your Telegram is connected."}


@router.post("/telegram/my-test")
async def telegram_my_test(user: str = Depends(require_admin)):
    c = db.get_user_telegram(user)
    token, chat = c.get("botToken"), c.get("chatId")
    if not token or not chat:
        raise HTTPException(400, "Connect your Telegram first.")
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": "✅ Strateteach — your admin Telegram is connected. You'll get your own alerts here."},
        )
    if resp.status_code != 200 or not (resp.json() or {}).get("ok"):
        db.mark_user_telegram_tested(user, False)
        raise HTTPException(502, "Telegram rejected the message — check the bot token and chat ID.")
    db.mark_user_telegram_tested(user, True)
    return {"ok": True, "message": "Test sent — check your Telegram."}


@router.post("/telegram/my-disconnect")
async def telegram_my_disconnect(user: str = Depends(require_admin)):
    db.disconnect_user_telegram(user)
    return {"ok": True}


@router.post("/telegram/detect")
async def telegram_detect(body: TelegramDetectInput):
    """Auto-detect the chats the bot can see (getUpdates) so the user can pick one."""
    token = _resolve_bot_token(body.botToken)
    if not token:
        raise HTTPException(400, "Bot token required.")
    return await tg.detect_chats(token)


@router.post("/telegram/send")
async def telegram_send(body: TelegramSendInput, background_tasks: BackgroundTasks):
    cfg = db.get_telegram_config()
    if not cfg.get("botToken") or not cfg.get("chatId"):
        raise HTTPException(400, "Telegram not configured. Set bot token and chat ID first.")

    async def _do_send():
        result = await tg.send_excel_to_telegram(
            cfg["botToken"], cfg["chatId"], body.runId or cfg.get("runIdOverride") or None
        )
        db.update_telegram_send_status(result["ok"], result["message"])
        logger.info("Manual Telegram send: %s", result["message"])

    background_tasks.add_task(_do_send)
    return {"ok": True, "message": "Sending in background — check status shortly."}


@router.post("/telegram/test")
async def telegram_test(body: TelegramConfigInput):
    """Send a plain test message to verify bot token + chat ID."""
    token = _resolve_bot_token(body.botToken)
    if not token or not body.chatId:
        raise HTTPException(400, "botToken and chatId are required.")
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": body.chatId, "text": "✅ Strateteach connected successfully!"},
        )
    data = resp.json()
    if data.get("ok"):
        return {"ok": True, "message": "Test message sent! Check your Telegram chat."}
    return {"ok": False, "message": data.get("description", "Unknown error")}
