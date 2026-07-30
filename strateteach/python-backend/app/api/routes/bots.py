"""Signal Automated Bots — server-stored TRADE-ONLY per-bot keys + TradingView
webhooks.

A bot holds Fernet-encrypted exchange credentials (same scheme as the exchange
singleton). TradingView (or any source) POSTs a JSON alert to the bot's PUBLIC,
token-gated webhook; we size + clamp the order against the bot's risk caps and
place it server-side through the SAME ``services.exchange.place_order`` chokepoint
the manual path uses, then log it to runs_log + activity_log WITH ``bot_id``.

Safeguards:
  • Decrypted keys are NEVER returned by any endpoint (mask_bot strips them).
  • The webhook is the ONLY public route — token-gated, size-capped, status-gated,
    duplicate-guarded, and wrapped so a bad alert can never 500 the endpoint.
  • Paused bots ignore signals. Risk caps (max_quote per order, max_open positions)
    are enforced before every real order.
  • The manual /exchange/order path and order/trade math are untouched.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user
from app.services import exchange as ex
from app.services import notify
from app.services import telegram as tg
from app.services.plans import entitlements

logger = logging.getLogger("algo770")

router = APIRouter(tags=["bots"])

# Largest inbound webhook body we will read (TradingView alerts are tiny JSON).
_MAX_WEBHOOK_BYTES = 8192

# Fee/slippage buffer for a 100%-of-balance market BUY: spend this fraction LESS than
# the full free quote balance so the order can't fail on taker fees / a tick of slippage
# (Binance spot taker ≈ 0.1%; 0.5% is a safe margin). SPOT LONG-ONLY sizing only.
_SIZE_BUFFER = 0.005  # 0.5%

# Quote suffixes used to split a TradingView ticker like "BTCUSDT" → "BTC/USDT".
_QUOTES = ("USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP", "DAI", "USD", "BTC", "ETH", "EUR")

# In-process replay guard: token → (monotonic_ts, signature). Drops an identical
# alert that arrives < 2s after the previous one (TradingView occasionally
# double-fires). Best-effort only — not a durable idempotency store.
_RECENT: "dict[str, tuple]" = {}


# ── input models ─────────────────────────────────────────────────────────────
class BotCreateInput(BaseModel):
    label: Optional[str] = None
    key: str
    secret: str
    passphrase: Optional[str] = None
    exchange: str
    market: str = "spot"                 # 'spot' | 'futures'
    subAccount: Optional[str] = None
    maxQuote: Optional[float] = None      # per-order risk cap (max quote/USDT per signal)
    maxOpen: Optional[int] = None         # max concurrent open positions
    # Order-size mode: 'fixed' (maxQuote / alert quote) or 'balance_pct' (size a BUY off
    # sizePct% of the free quote balance — SPOT LONG-ONLY). Default keeps today's behaviour.
    sizeMode: Optional[str] = "fixed"
    sizePct: Optional[float] = 100.0      # % of free quote balance to spend on a BUY (balance_pct)


class BotUpdateInput(BaseModel):
    label: Optional[str] = None
    status: Optional[str] = None          # 'active' | 'paused'
    maxQuote: Optional[float] = None
    maxOpen: Optional[int] = None
    sizeMode: Optional[str] = None
    sizePct: Optional[float] = None
    # Optional re-key / reconfigure (all kept ciphertext-only):
    key: Optional[str] = None
    secret: Optional[str] = None
    passphrase: Optional[str] = None
    exchange: Optional[str] = None
    market: Optional[str] = None
    subAccount: Optional[str] = None


# ── helpers ──────────────────────────────────────────────────────────────────
_TRADE_ONLY_NOTE = (
    "IMPORTANT: use a TRADE-ONLY API key with WITHDRAWALS DISABLED (and, where the "
    "exchange supports it, IP-restricted to this server). This bot places REAL orders."
)


def _webhook_url(token: str) -> str:
    """Absolute inbound webhook URL for a bot token, using the app's public base."""
    try:
        base = (tg.app_url() or "").rstrip("/")
    except Exception:  # noqa: BLE001
        base = ""
    return f"{base}/signals/webhook/{token}"


def _alert_template() -> str:
    """The copy-paste TradingView alert Message. The bot is identified by the webhook URL
    token, so the body only needs ``action`` (buy|sell|close) + ``symbol``/``ticker`` —
    it does NOT read a body ``token``/``bot_id``/``qty``. A ``"quote": <usdt>`` line is
    optional; omit it to use the bot's per-order max (``maxQuote``). The ``position`` field
    (``{{strategy.market_position}}``) is included to FUTURE-PROOF users' TradingView alerts
    but is currently IGNORED by the webhook parser — position-aware (spot/futures)
    interpretation is a separate pending build. This returns the SAME canonical JSON the
    frontend shows (SignalBots.tsx ``ALERT_JSON``), so the guide, the create-success screen
    and each bot card stay consistent."""
    return (
        "{\n"
        '  "action": "{{strategy.order.action}}",\n'
        '  "ticker": "{{ticker}}",\n'
        '  "position": "{{strategy.market_position}}"\n'
        "}"
    )


def _num(v) -> Optional[float]:
    try:
        if v in (None, ""):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _balance_buy_quote(free_quote, size_pct, buffer: float = _SIZE_BUFFER) -> float:
    """Quote (e.g. USDT) to spend on a 100%-of-balance style market BUY:
    ``size_pct`` % of the FREE quote balance, minus a fee/slippage ``buffer`` so the
    order can't fail on taker fees / a tick of slippage. Pure + deterministic so the
    sizing math is unit-tested without touching an exchange. SPOT LONG-ONLY.

    ``size_pct`` is clamped to [0, 100]; ``buffer`` to [0, 0.9]. Any non-positive or
    invalid input returns ``0.0`` (the caller then reports "insufficient balance").
    """
    try:
        fq = float(free_quote or 0.0)
        pct = max(0.0, min(float(size_pct if size_pct is not None else 100.0), 100.0))
        buf = max(0.0, min(float(buffer if buffer is not None else 0.0), 0.9))
    except (TypeError, ValueError):
        return 0.0
    if fq <= 0 or pct <= 0:
        return 0.0
    return fq * (pct / 100.0) * (1.0 - buf)


def _norm_symbol(sym: str) -> str:
    """Normalise a TradingView ticker to ccxt unified form (BTCUSDT → BTC/USDT)."""
    s = (sym or "").strip().upper()
    if not s:
        return s
    if ":" in s:                      # strip an exchange prefix e.g. BINANCE:BTCUSDT
        s = s.split(":")[-1]
    if "/" in s:
        return s
    for q in _QUOTES:
        if s.endswith(q) and len(s) > len(q):
            return f"{s[:-len(q)]}/{q}"
    return s


def _owned_bot_or_404(bot_id: int, user: str) -> dict:
    bot = db.get_bot(bot_id)
    if not bot or bot.get("username") != user:
        raise HTTPException(404, "Bot not found.")
    return bot


def _is_replay(token: str, signature: str) -> bool:
    now = time.monotonic()
    prev = _RECENT.get(token)
    _RECENT[token] = (now, signature)
    return bool(prev and prev[1] == signature and (now - prev[0]) < 2.0)


# ── bot CRUD (owner-only) ────────────────────────────────────────────────────
@router.post("/bots")
async def bots_create(body: BotCreateInput, user: str = Depends(current_user)):
    u = db.get_user(user)
    ent = entitlements(u)
    if not ent.get("signalBots"):
        raise HTTPException(403, "Signal Bots aren't included in your plan. Upgrade to enable automated bots.")
    cap = ent.get("bots")
    if cap is not None and db.count_bots(user) >= int(cap):
        raise HTTPException(402, f"You've reached your bot limit ({cap}). Upgrade your plan or add bot credits to create more.")
    if body.exchange not in ex.SUPPORTED_EXCHANGES:
        raise HTTPException(400, f"Unsupported exchange: {body.exchange}")
    market = (body.market or "spot").lower()
    if market not in ("spot", "futures"):
        raise HTTPException(400, "market must be 'spot' or 'futures'.")
    if not (body.key or "").strip() or not (body.secret or "").strip():
        raise HTTPException(400, "API key and secret are required.")
    size_mode = (body.sizeMode or "fixed")
    if size_mode not in ("fixed", "balance_pct"):
        raise HTTPException(400, "sizeMode must be 'fixed' or 'balance_pct'.")
    size_pct = max(0.0, min(float(body.sizePct if body.sizePct is not None else 100.0), 100.0))

    bot = db.create_bot(
        username=user,
        label=((body.label or "").strip() or None),
        exchange=body.exchange,
        market=market,
        enc_key=ex.encrypt(body.key.strip()),
        enc_secret=ex.encrypt(body.secret.strip()),
        enc_passphrase=(ex.encrypt(body.passphrase.strip()) if (body.passphrase or "").strip() else ""),
        sub_account=((body.subAccount or "").strip() or None),
        max_quote=(float(body.maxQuote) if (body.maxQuote and body.maxQuote > 0) else None),
        max_open=(int(body.maxOpen) if (body.maxOpen and body.maxOpen > 0) else None),
        size_mode=size_mode,
        size_pct=size_pct,
    )
    masked = db.mask_bot(bot)
    logger.info("bot.create user=%s id=%s exchange=%s market=%s", user, masked.get("id"), body.exchange, market)
    return {
        "ok": True,
        "bot": masked,
        "webhookUrl": _webhook_url(bot["webhook_token"]),
        "alertTemplate": _alert_template(),
        "note": _TRADE_ONLY_NOTE,
    }


@router.get("/bots")
async def bots_list(user: str = Depends(current_user)):
    bots = db.list_bots(user)
    pnl = {p["botId"]: p for p in db.bot_pnl_summary(user)}
    for b in bots:
        s = pnl.get(b["id"]) or {}
        b["pnl"] = s.get("pnl", 0.0)
        b["trades"] = s.get("trades", 0)
        b["openPositions"] = s.get("open", 0)
        b["webhookUrl"] = _webhook_url(b["webhookToken"])
    return {"ok": True, "bots": bots}


@router.get("/bots/dashboard")
async def bots_dashboard(user: str = Depends(current_user)):
    """Aggregate per-bot P&L / counts for the user (grouped from runs_log by bot_id)."""
    bots = db.list_bots(user)
    pnl = {p["botId"]: p for p in db.bot_pnl_summary(user)}
    out = []
    total = 0.0
    for b in bots:
        s = pnl.get(b["id"]) or {}
        p = float(s.get("pnl") or 0.0)
        total += p
        out.append({
            "id": b["id"], "label": b["label"], "status": b["status"],
            "exchange": b["exchange"], "market": b["market"],
            "pnl": round(p, 2), "trades": s.get("trades", 0), "openPositions": s.get("open", 0),
        })
    return {"ok": True, "bots": out, "totalPnl": round(total, 2), "count": len(out)}


@router.patch("/bots/{bot_id}")
async def bots_update(bot_id: int, body: BotUpdateInput, user: str = Depends(current_user)):
    _owned_bot_or_404(bot_id, user)
    fields: dict = {}
    if body.label is not None:
        fields["label"] = (body.label.strip() or None)
    if body.status is not None:
        if body.status not in ("active", "paused"):
            raise HTTPException(400, "status must be 'active' or 'paused'.")
        fields["status"] = body.status
    if body.maxQuote is not None:
        fields["max_quote"] = (float(body.maxQuote) if body.maxQuote > 0 else None)
    if body.maxOpen is not None:
        fields["max_open"] = (int(body.maxOpen) if body.maxOpen > 0 else None)
    if body.sizeMode is not None:
        if body.sizeMode not in ("fixed", "balance_pct"):
            raise HTTPException(400, "sizeMode must be 'fixed' or 'balance_pct'.")
        fields["size_mode"] = body.sizeMode
    if body.sizePct is not None:
        fields["size_pct"] = max(0.0, min(float(body.sizePct), 100.0))
    if body.exchange is not None:
        if body.exchange not in ex.SUPPORTED_EXCHANGES:
            raise HTTPException(400, f"Unsupported exchange: {body.exchange}")
        fields["exchange"] = body.exchange
    if body.market is not None:
        m = (body.market or "spot").lower()
        if m not in ("spot", "futures"):
            raise HTTPException(400, "market must be 'spot' or 'futures'.")
        fields["market"] = m
    if body.subAccount is not None:
        fields["sub_account"] = (body.subAccount.strip() or None)
    if body.key and body.key.strip():
        fields["enc_key"] = ex.encrypt(body.key.strip())
    if body.secret and body.secret.strip():
        fields["enc_secret"] = ex.encrypt(body.secret.strip())
    if body.passphrase is not None:
        fields["enc_passphrase"] = (ex.encrypt(body.passphrase.strip()) if body.passphrase.strip() else "")

    updated = db.update_bot(bot_id, fields, username=user)
    return {"ok": True, "bot": db.mask_bot(updated)}


@router.delete("/bots/{bot_id}")
async def bots_delete(bot_id: int, user: str = Depends(current_user)):
    if not db.delete_bot(bot_id, user):
        raise HTTPException(404, "Bot not found.")
    logger.info("bot.delete user=%s id=%s", user, bot_id)
    return {"ok": True}


@router.post("/bots/{bot_id}/kill")
async def bots_kill(bot_id: int, user: str = Depends(current_user)):
    """Kill-switch: pause the bot so it ignores all new signals immediately.

    MVP pauses only; existing open positions are left as-is.
    TODO(flatten): optionally close every open position for this bot on kill."""
    _owned_bot_or_404(bot_id, user)
    db.update_bot(bot_id, {"status": "paused"}, username=user)
    logger.info("bot.kill user=%s id=%s", user, bot_id)
    return {
        "ok": True,
        "status": "paused",
        "message": "Bot paused — it will ignore new signals. Open positions are left as-is (flatten-on-kill is a TODO).",
    }


@router.get("/bots/{bot_id}/logs")
async def bots_logs(bot_id: int, user: str = Depends(current_user)):
    _owned_bot_or_404(bot_id, user)
    return {"ok": True, "logs": db.list_bot_runs(bot_id)}


# ── inbound TradingView webhook (PUBLIC — token-gated; see auth_gate allowlist) ─
@router.post("/signals/webhook/{bot_token}")
async def signal_webhook(bot_token: str, request: Request):
    """PUBLIC inbound alert. Token-gated, size-capped, status-gated. Everything is
    wrapped so a malformed/hostile alert returns a clean JSON error, never a 500."""
    try:
        raw = await request.body()
        if raw and len(raw) > _MAX_WEBHOOK_BYTES:
            return {"ok": False, "error": "payload too large"}
        try:
            payload = json.loads(raw or b"{}")
        except Exception:  # noqa: BLE001
            payload = {}
        if not isinstance(payload, dict):
            payload = {}

        bot = db.get_bot_by_token(bot_token)
        if not bot:
            raise HTTPException(404, "Unknown bot token.")
        if (bot.get("status") or "active") != "active":
            return {"ok": True, "ignored": True, "reason": "bot_paused"}

        # Optional shared-secret double-check (if the owner set one on the alert).
        # The token itself is the primary gate; this is belt-and-suspenders.
        # (No secret column in MVP; accepted leniently and ignored if absent.)

        action = str(payload.get("action") or payload.get("side") or "").strip().lower()
        symbol_raw = str(payload.get("symbol") or payload.get("ticker") or "").strip()
        # Normalise common synonyms.
        if action in ("long", "open", "entry"):
            action = "buy"
        elif action in ("short",):
            action = "sell"
        elif action in ("exit", "flat", "close_all"):
            action = "close"
        if action not in ("buy", "sell", "close") or not symbol_raw:
            return {"ok": False, "error": "alert must include action ∈ buy|sell|close and a symbol"}

        signature = f"{action}:{symbol_raw}:{payload.get('quote')}:{payload.get('qty')}"
        if _is_replay(bot_token, signature):
            return {"ok": True, "ignored": True, "reason": "duplicate"}

        sym = _norm_symbol(symbol_raw)
        market_type = (bot.get("market") or "spot")
        max_quote = (float(bot["max_quote"]) if bot.get("max_quote") is not None else None)
        max_open = (int(bot["max_open"]) if bot.get("max_open") is not None else None)
        cfg = db._bot_creds(bot)

        # Resolve the requested quote (USDT) size, then CLAMP to the bot's per-order cap.
        # (FIXED-mode sizing; also used for a SELL that carries an explicit size.)
        req_quote = _num(payload.get("quote"))
        quote_amt = req_quote if (req_quote and req_quote > 0) else max_quote
        if max_quote is not None and quote_amt is not None and quote_amt > max_quote:
            quote_amt = max_quote

        size_mode = (bot.get("size_mode") or "fixed")

        if action == "buy":
            # Compliance guard (BTC-only): no-op unless the owners turned the flag on;
            # then a restricted client's bot may only OPEN Bitcoin positions. SELL/close
            # are never blocked (flattening an existing holding must always work).
            from app.core.compliance import is_btc_pair, is_restricted_client
            if db.get_btc_only_cached() and is_restricted_client(bot.get("username")) and not is_btc_pair(sym):
                return {"ok": False, "error": "trading is limited to Bitcoin (BTC) pairs"}
            # max_open guard — refuse a NEW opening order once the cap is reached.
            if max_open is not None and db.count_bot_open_runs(bot["id"]) >= max_open:
                return {"ok": False, "error": "max_open reached", "maxOpen": max_open}

            buy_quote = quote_amt
            # 100%-of-balance BUY (SPOT LONG-ONLY): size off the FREE quote balance minus a
            # fee/slippage buffer. An explicit alert `quote` still wins (honour the override).
            if size_mode == "balance_pct" and not (req_quote and req_quote > 0):
                quote_ccy = sym.split("/")[1] if "/" in sym else "USDT"
                fq = await run_in_threadpool(ex.get_free_quote, cfg, quote_ccy)
                if not fq.get("ok"):
                    return {"ok": False, "error": f"could not read {quote_ccy} balance: {fq.get('message') or 'unavailable'}"}
                free_quote = float(fq.get("free") or 0.0)
                buy_quote = _balance_buy_quote(free_quote, bot.get("size_pct"))
                if buy_quote <= 0:
                    return {"ok": False, "error": f"insufficient {quote_ccy} balance to buy (free {free_quote:.2f} {quote_ccy})"}

            if not buy_quote or buy_quote <= 0:
                return {"ok": False, "error": "no order size — set the bot's maxQuote or send 'quote' in the alert"}
            # place_order enforces the exchange MIN-NOTIONAL and returns a clean message if
            # the sized order is below it — it does NOT place the order in that case.
            result = await run_in_threadpool(
                ex.place_order, cfg, sym, "buy", 0.0, "market", None, market_type, 1.0, buy_quote, 0.0, 0.0)
        elif action == "sell":
            if quote_amt and quote_amt > 0:
                result = await run_in_threadpool(
                    ex.place_order, cfg, sym, "sell", 0.0, "market", None, market_type, 1.0, quote_amt, 0.0, 0.0)
            else:
                # No size → treat as a full close (sell 100% of the base holding).
                result = await run_in_threadpool(
                    ex.place_order, cfg, sym, "sell", 100.0, "market", None, market_type, 1.0, None, 0.0, 0.0)
        else:  # close → fully flatten the spot holding (sell 100% of the base)
            result = await run_in_threadpool(
                ex.place_order, cfg, sym, "sell", 100.0, "market", None, market_type, 1.0, None, 0.0, 0.0)

        ts = datetime.now(timezone.utc).isoformat()
        if not result.get("ok"):
            logger.info("signal.webhook bot=%s %s %s -> rejected: %s", bot["id"], action, sym, result.get("message"))
            return {"ok": False, "error": result.get("message") or "order rejected"}

        o = result.get("order") or {}
        amount = _num(o.get("amount")) or 0.0
        price = _num(o.get("price")) or 0.0
        c = o.get("cost")
        cost = float(c) if (c not in (None, "") and float(c or 0) > 0) else (amount * price if (amount and price) else None)
        o_sym = o.get("symbol") or sym
        o_side = str(o.get("side") or ("buy" if action == "buy" else "sell")).lower()

        # Log the real order to activity_log + runs_log WITH bot_id (best-effort).
        try:
            db.add_activity("live", "order", o_sym, side=o_side, qty=amount, price=price, cost=cost,
                            environment="live", ts=ts, username=bot.get("username"), bot_id=bot["id"])
        except Exception:  # noqa: BLE001
            pass
        try:
            if o_side == "buy":
                db.log_run_open(username=bot.get("username"), mode="live", symbol=o_sym, side="buy",
                                entry_price=(price or None), qty=(amount or None), opened_at=ts,
                                source="auto", bot_id=bot["id"])
            else:
                db.log_run_close(username=bot.get("username"), mode="live", symbol=o_sym,
                                 exit_price=(price or None), status="closed", closed_at=ts, bot_id=bot["id"])
        except Exception:  # noqa: BLE001
            pass

        logger.info("signal.webhook bot=%s %s %s ok: %s", bot["id"], action, o_sym, result.get("message"))

        # Alert the bot's OWNER on their enabled channels (incl. WhatsApp) that their
        # Signal Bot just executed a live order. Per-user (never global); best-effort.
        try:
            bot_name = bot.get("name") or f"bot #{bot['id']}"
            side_word = "bought" if o_side == "buy" else "sold"
            bits = [f"🤖 {bot_name}: {side_word} {o_sym}"]
            if amount:
                bits.append(f"{amount:g}")
            if price:
                bits.append(f"@ {price:g}")
            notify.notify_user(bot.get("username"), " ".join(bits), kind="botTrade")
        except Exception as exc:  # never let a notify failure affect the webhook
            logger.warning("bot notify failed: %s", exc)

        return {"ok": True, "action": action, "symbol": o_sym, "order": o, "message": result.get("message")}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — a bad signal must NEVER 500 the endpoint
        logger.warning("signal.webhook error token=%s err=%s", (bot_token or "")[:6], str(exc)[:200])
        return {"ok": False, "error": "internal error"}
