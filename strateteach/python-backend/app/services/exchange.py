"""
Exchange connectivity + manual trading.

Wraps ccxt for Binance / Bybit / Coinbase. Responsibilities:
- Encrypt/decrypt API credentials at rest (Fernet key derived from SESSION_SECRET).
- Build a ccxt client (sandbox/testnet mode when configured).
- Test the connection (read-only balance fetch).
- Place market (immediate) or limit (target) orders, sized as a percent of the
  available balance.

This module performs blocking network I/O via ccxt; callers in async FastAPI
routes must run these functions in a threadpool.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
from typing import Optional

import ccxt

logger = logging.getLogger(__name__)

SUPPORTED_EXCHANGES = {"binance", "bybit", "coinbase"}


# ── Phase 2B · M4 — the permanent one-way boundary ───────────────────────────────
# In the unified app Praxis is the SOLE executor. StrateTeach's own direct-exchange engine is OFF by
# default: every authenticated-order path (buy/sell/close/withdraw/dust) fails CLOSED here unless an
# operator deliberately sets STRATETEACH_ENGINE_ENABLED=true. This is a single GLOBAL gate over ALL
# credentials — stronger than, and independent of, the per-credential M3 cutover flag; it is removed
# together with the engine in the final teardown. Read-only/public helpers (prices, market symbols) are
# unaffected — this gates money movement only.

def _engine_enabled() -> bool:
    """True only if the LEGACY direct-exchange engine is explicitly armed (STRATETEACH_ENGINE_ENABLED).
    Defaults OFF, so the unified app cannot place a direct order unless someone turns this on."""
    return os.environ.get("STRATETEACH_ENGINE_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def _engine_off_result(op: str = "order") -> dict:
    return {"ok": False,
            "message": f"strateteach_engine_disabled: Praxis is the sole executor; direct {op} is disabled in the unified app."}


# ── Encryption ──────────────────────────────────────────────────────────────────

def _fernet():
    from cryptography.fernet import Fernet
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        raise RuntimeError("SESSION_SECRET is not set; cannot encrypt credentials.")
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


def mask(value: str) -> str:
    """Mask a secret for display: keep the last 4 characters."""
    if not value:
        return ""
    if len(value) <= 4:
        return "•" * len(value)
    return "•" * (len(value) - 4) + value[-4:]


# ── Protection code (PIN) ─────────────────────────────────────────────────────

_PIN_ITERATIONS = 200_000


def hash_pin(pin: str) -> str:
    """Salted PBKDF2-SHA256 hash for the exchange protection code."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", (pin or "").encode("utf-8"), salt, _PIN_ITERATIONS)
    return f"pbkdf2_sha256${_PIN_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    """Constant-time verification of a protection code against its stored hash."""
    if not stored:
        return False
    try:
        algo, iters, salt_hex, hash_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", (pin or "").encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:  # noqa: BLE001
        return False


# ── ccxt client ──────────────────────────────────────────────────────────────────

def _decrypt_config(cfg: dict) -> dict:
    """Given a db.get_exchange_config() row, return plaintext credentials."""
    return {
        "exchange": cfg.get("exchange", "binance"),
        "environment": cfg.get("environment", "testnet"),
        "subAccount": cfg.get("subAccount", ""),
        "apiKey": decrypt(cfg.get("apiKeyEnc", "")),
        "apiSecret": decrypt(cfg.get("apiSecretEnc", "")),
        "apiPassphrase": decrypt(cfg.get("apiPassphraseEnc", "")),
        "defaultPct": cfg.get("defaultPct", 5.0),
    }


def _build_client(exchange: str, api_key: str, api_secret: str,
                  api_passphrase: str, environment: str,
                  default_type: str = "spot"):
    if exchange not in SUPPORTED_EXCHANGES:
        raise ValueError(f"Unsupported exchange: {exchange}")
    if not api_key or not api_secret:
        raise ValueError("API key and secret are required.")
    klass = getattr(ccxt, exchange)
    params = {
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
    }
    if api_passphrase:
        params["password"] = api_passphrase
    if default_type == "futures":
        # USDT-margined perpetuals. ccxt binance uses "future"; most other
        # venues use the unified "swap" type for perpetual contracts.
        params["options"] = {"defaultType": "future" if exchange == "binance" else "swap"}
    client = klass(params)
    if environment == "testnet":
        # ccxt unified sandbox/testnet switch
        client.set_sandbox_mode(True)
    return client


def _client_from_config(cfg: dict, default_type: str = "spot"):
    plain = _decrypt_config(cfg)
    return _build_client(
        plain["exchange"], plain["apiKey"], plain["apiSecret"],
        plain["apiPassphrase"], plain["environment"], default_type,
    ), plain


def _resolve_symbol(client, symbol: str, futures: bool) -> str:
    """Map a display symbol (e.g. BTC/USDT) to the venue's contract symbol.

    On futures, linear perpetuals are usually quoted as BTC/USDT:USDT in ccxt;
    fall back to that when the plain spot symbol isn't a futures market."""
    if symbol in client.markets:
        return symbol
    if futures and "/" in symbol and ":" not in symbol:
        quote = symbol.split("/")[1]
        cand = f"{symbol}:{quote}"
        if cand in client.markets:
            return cand
    return symbol


def _nonzero_balances(balance: dict, limit: int = 12) -> list:
    out = []
    totals = (balance or {}).get("total", {}) or {}
    frees = (balance or {}).get("free", {}) or {}
    for asset, total in totals.items():
        try:
            total_f = float(total)
        except (TypeError, ValueError):
            continue
        if total_f and total_f > 0:
            out.append({
                "asset": asset,
                "free": float(frees.get(asset, 0) or 0),
                "total": total_f,
            })
    out.sort(key=lambda b: b["total"], reverse=True)
    return out[:limit]


def test_connection(cfg: dict) -> dict:
    """Verify credentials by fetching the account balance (read-only)."""
    try:
        client, _ = _client_from_config(cfg)
        balance = client.fetch_balance()
        return {
            "ok": True,
            "message": "Connected successfully.",
            "balances": _nonzero_balances(balance),
        }
    except ccxt.AuthenticationError as e:
        return {"ok": False, "message": f"Authentication failed: {e}", "balances": []}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"Connection error: {e}", "balances": []}


# Bybit wallet types, in the order we probe them for a SPOT read. UNIFIED FIRST so the
# main Unified Trading Account (UTA) reads exactly as before; SPOT/FUND cover a Standard
# (non-UTA) subaccount, whose holdings live in the classic SPOT / Funding wallet — NOT the
# UNIFIED wallet ccxt defaults to (which reads $0 for it).
_BYBIT_ACCOUNT_TYPES = ("UNIFIED", "SPOT", "FUND")


def get_balances(cfg: dict, market_type: str = "spot") -> dict:
    try:
        client, plain = _client_from_config(cfg, "futures" if market_type == "futures" else "spot")
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "balances": [], "market": market_type, "message": str(e)}

    exchange = str(plain.get("exchange") or "").lower()
    # Bybit SPOT read: a plain fetch_balance() resolves to the UNIFIED wallet, which is
    # EMPTY for a Standard (non-UTA) subaccount → the balance modal shows $0.00 even
    # though the subaccount holds funds in its SPOT/FUND wallet. Probe each accountType
    # and use the FIRST that returns holdings. UNIFIED first → the main UTA account is
    # unchanged; a type Bybit rejects for this account just errors and we try the next.
    # READ-ONLY: fetch_balance places no order and moves nothing.
    if exchange == "bybit" and market_type != "futures":
        last_err = ""
        succeeded = False
        for acct in _BYBIT_ACCOUNT_TYPES:
            try:
                balance = client.fetch_balance(params={"accountType": acct})
            except Exception as e:  # noqa: BLE001 — type unsupported for this account; try the next
                last_err = str(e)
                continue
            succeeded = True
            bals = _nonzero_balances(balance)
            if bals:
                return {"ok": True, "balances": bals, "market": market_type,
                        "accountType": acct, "message": ""}
        # Every type either errored or was genuinely empty. If at least one call
        # succeeded, that's an honest empty wallet (ok); otherwise surface the error.
        return {"ok": succeeded, "balances": [], "market": market_type,
                "accountType": None, "message": "" if succeeded else last_err}

    # Non-bybit (or futures): the original single read.
    try:
        balance = client.fetch_balance()
        return {"ok": True, "balances": _nonzero_balances(balance), "market": market_type, "message": ""}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "balances": [], "market": market_type, "message": str(e)}


def get_free_quote(cfg: dict, quote: str) -> dict:
    """Return the exact free balance of a single quote asset (e.g. USDT).

    Reads the raw balance map directly so it is not limited to the top-N assets
    surfaced by ``get_balances``; the profit-engine sizing depends on the true
    free quote amount.
    """
    try:
        client, _ = _client_from_config(cfg)
        balance = client.fetch_balance()
        free = (balance or {}).get("free", {}) or {}
        return {"ok": True, "free": float(free.get(quote, 0) or 0), "message": ""}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "free": 0.0, "message": str(e)}


# Stablecoins counted 1:1 with USD; everything else is valued via fetch_prices.
_STABLE = {"USDT", "USDC", "BUSD", "USD", "DAI", "TUSD", "FDUSD", "USDP"}


def get_net_deposits(cfg: dict) -> dict:
    """Read-only NET DEPOSITS (deposits − withdrawals) from the exchange, valued
    in USD. Used to seed the live day-baseline so a real deposit reads as cost
    basis — a gain over it, never profit in itself.

    Strictly read-only: only fetches deposit/withdrawal HISTORY, never moves a
    cent. Each returned event is ``{"ts": epoch_ms, "amount": usd_signed,
    "currency": CODE}`` (+deposit / −withdrawal). Only completed ('ok') transfers
    count; non-stable assets are marked to the public USDT price (an asset that
    can't be priced is skipped, conservatively).

    Failure is graceful: if the key lacks deposit/withdrawal-history permission or
    the calls error, returns ``{"ok": False, ...}`` so the caller falls back to
    the snapshot baseline and the card never crashes.
    """
    try:
        client, _ = _client_from_config(cfg, "spot")
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "total": 0.0, "events": [], "message": str(e)}

    ok_dep = ok_wd = True
    err = ""
    try:
        deposits = client.fetch_deposits() or []
    except Exception as e:  # noqa: BLE001
        ok_dep, deposits, err = False, [], str(e)
    try:
        withdrawals = client.fetch_withdrawals() or []
    except Exception as e:  # noqa: BLE001
        ok_wd, withdrawals, err = False, [], str(e)
    if not ok_dep and not ok_wd:
        # Both history calls failed → almost always a missing permission. Signal
        # not-ok so the caller keeps the existing snapshot baseline.
        return {"ok": False, "total": 0.0, "events": [], "message": err or "deposit history unavailable"}

    def _is_completed(t: dict) -> bool:
        st = str((t or {}).get("status") or "").lower()
        return st in ("ok", "completed", "success", "done", "")

    raw = [(t, 1) for t in deposits if _is_completed(t)] + \
          [(t, -1) for t in withdrawals if _is_completed(t)]

    # Price every non-stable asset once (public, keyless, read-only).
    need = set()
    for t, _sign in raw:
        cur = str((t or {}).get("currency") or t.get("code") or "").upper()
        if cur and cur not in _STABLE:
            need.add(f"{cur}/USDT")
    prices = fetch_prices(sorted(need)) if need else {}

    events = []
    for t, sign in raw:
        cur = str((t or {}).get("currency") or t.get("code") or "").upper()
        try:
            amt = float(t.get("amount") or 0.0)
        except (TypeError, ValueError):
            continue
        if amt <= 0 or not cur:
            continue
        if cur in _STABLE:
            usd = amt
        else:
            px = float(prices.get(f"{cur}/USDT", 0) or 0)
            if px <= 0:
                continue  # can't value reliably → skip rather than guess
            usd = amt * px
        ts = t.get("timestamp")
        events.append({
            "ts": (float(ts) if ts not in (None, "") else None),
            "amount": round(sign * usd, 8),
            "currency": cur,
        })
    total = round(sum(e["amount"] for e in events), 2)
    return {"ok": True, "total": total, "events": events, "message": ""}


_MARKETS_CACHE: dict = {}  # exchange id -> (ts, [{symbol,name}])
_MARKETS_TTL = 3600.0


def get_market_symbols(cfg: dict) -> dict:
    """Live list of tradeable SPOT symbols (quote = USDT) on the connected
    exchange, so pickers/plans only ever use coins the user can actually trade.
    Cached per exchange for an hour."""
    import time as _time
    try:
        client, plain = _client_from_config(cfg, "spot")
        key = str(plain.get("exchange") or "binance")
        hit = _MARKETS_CACHE.get(key)
        if hit and (_time.time() - hit[0]) < _MARKETS_TTL:
            return {"ok": True, "symbols": hit[1], "message": ""}
        markets = client.load_markets()
        out = []
        for sym, m in (markets or {}).items():
            try:
                if (m.get("quote") == "USDT" and (m.get("spot", True)) and (m.get("active", True))
                        and "/" in sym and ":" not in sym):
                    out.append({"symbol": sym, "name": m.get("base") or sym})
            except Exception:  # noqa: BLE001
                continue
        out.sort(key=lambda x: x["symbol"])
        _MARKETS_CACHE[key] = (_time.time(), out)
        return {"ok": True, "symbols": out, "message": ""}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "symbols": [], "message": str(e)}


def _get_public_client():
    """A keyless public ccxt client for read-only market data (paper mode).

    Uses the geo-aware market-exchange resolver (the same source the daily
    scanner uses) rather than a hardcoded binance.com client, which is HTTP 451
    geo-blocked in the published app's region. Returns a FRESH instance each call
    (the resolver caches only the exchange id), or None if nothing is reachable.
    """
    from app.data.market_exchange import get_market_exchange

    return get_market_exchange()


def fetch_prices(symbols) -> dict:
    """Return {symbol: last_price} for crypto symbols via the public exchange.

    Keyless and read-only — used to mark paper (demo) positions to market. Missing
    or failed symbols are simply omitted (callers fall back to the entry price).
    """
    out: dict = {}
    syms = [s for s in (symbols or []) if s]
    if not syms:
        return out
    client = _get_public_client()
    if client is None:
        return out
    try:
        tickers = client.fetch_tickers(syms)
        for s in syms:
            t = tickers.get(s) or {}
            px = t.get("last") or t.get("close")
            if px:
                out[s] = float(px)
    except Exception:  # noqa: BLE001
        for s in syms:
            try:
                t = client.fetch_ticker(s)
                px = t.get("last") or t.get("close")
                if px:
                    out[s] = float(px)
            except Exception:  # noqa: BLE001
                continue
    return out


# ── Cached prices for DISPLAY (dashboard mark-to-market) ────────────────────
# Each exchange ticker call is ~2-3s. The paper-sessions list marks every open
# position to market and is polled ~every 18s, so calling fetch_prices fresh each
# time made the dashboard crawl. Stale-while-revalidate: serve the cached map
# instantly, refresh in the background when stale. Display can be a few seconds
# stale; trade EXECUTION paths must still call fetch_prices directly (fresh).
_PX_CACHE: dict = {}            # "sym,sym" -> (epoch, {symbol: price})
_PX_TTL = 20.0                  # seconds before a cached entry is refreshed
_PX_REFRESHING: set = set()
_PX_SEED: dict = {}            # symbol -> (epoch, price): open-time live prices


def seed_prices(prices: dict) -> None:
    """Seed open-time live prices keyed per symbol.

    A demo position is opened at the live price returned by ``fetch_prices`` and
    then marked to market via ``cached_prices``. Seeding those exact prices here
    makes the FIRST dashboard mark equal the entry exactly (zero unrealized P&L,
    no stale-cache jitter). Seeds are short-lived: they only override the display
    price for ``_PX_TTL`` seconds, after which live ticks flow through normally.
    """
    import time as _t
    now = _t.time()
    for s, px in (prices or {}).items():
        if s and px:
            _PX_SEED[s] = (now, float(px))


def _apply_seed(out: dict, syms: list) -> None:
    """Overlay any still-fresh open-time seed prices onto a display price map."""
    import time as _t
    now = _t.time()
    for s in syms:
        seed = _PX_SEED.get(s)
        if seed:
            if (now - seed[0]) < _PX_TTL:
                out[s] = seed[1]
            else:
                _PX_SEED.pop(s, None)


async def _refresh_px(key: str, syms: list) -> None:
    import time as _t
    from fastapi.concurrency import run_in_threadpool
    try:
        out = await run_in_threadpool(fetch_prices, syms)
        if out:
            _PX_CACHE[key] = (_t.time(), out)
    except Exception:  # noqa: BLE001
        pass
    finally:
        _PX_REFRESHING.discard(key)


async def cached_prices(symbols) -> dict:
    """Stale-while-revalidate prices for display. Cached value returned instantly;
    a single background refresh kicks off when stale. Cold cache pays one fetch."""
    import time as _t
    import asyncio as _asyncio
    from fastapi.concurrency import run_in_threadpool
    syms = sorted({s for s in (symbols or []) if s})
    if not syms:
        return {}
    key = ",".join(syms)
    hit = _PX_CACHE.get(key)
    if hit:
        if (_t.time() - hit[0]) >= _PX_TTL and key not in _PX_REFRESHING:
            _PX_REFRESHING.add(key)
            _asyncio.create_task(_refresh_px(key, syms))
        out = dict(hit[1])
    else:
        out = await run_in_threadpool(fetch_prices, syms)
        if out:
            _PX_CACHE[key] = (_t.time(), out)
    _apply_seed(out, syms)
    return out


def _base_fee_in_base(order: dict, base: str) -> float:
    """Total trading fee charged in the BASE asset for a filled order (0 if the fee was
    paid in the quote asset or BNB). A spot market BUY that pays its fee in the base asset
    credits fewer coins than ``filled`` — so a protective SELL for the full ``filled`` qty
    would exceed the free balance and be rejected. We prefer the order-level fee summary
    (``fees`` list, else the single ``fee``) and only fall back to per-trade fees so the
    same fee is never counted twice."""
    total = 0.0

    def _add(f: Optional[dict]) -> bool:
        nonlocal total
        if f and f.get("currency") == base and f.get("cost") not in (None, ""):
            total += float(f.get("cost") or 0.0)
            return True
        return False

    counted = False
    for f in (order.get("fees") or []):
        counted = _add(f) or counted
    if not counted:
        counted = _add(order.get("fee")) or counted
    if not counted:  # no order-level summary → sum the granular per-trade fees
        for tr in (order.get("trades") or []):
            added = False
            for f in (tr.get("fees") or []):
                added = _add(f) or added
            if not added:
                _add(tr.get("fee"))
    return total


def _sellable_base_qty(client, symbol: str, base: str, order: dict, filled_qty: float) -> float:
    """The base quantity actually free to back a protective SELL after a BUY fill.

    = (filled − base-denominated fee), then capped by the post-buy FREE base balance (so it
    can never exceed what the exchange will let us sell), floored to the market's LOT_SIZE
    step via ``amount_to_precision`` (which truncates). This is what prevents the OCO from
    being silently rejected for "insufficient balance" and leaving the position unprotected."""
    received = max(0.0, filled_qty - _base_fee_in_base(order, base))
    try:
        free_after = float((client.fetch_balance().get("free") or {}).get(base) or 0.0)
    except Exception:  # noqa: BLE001 — best-effort; the fill-based figure is already safe
        free_after = 0.0
    sellable = min(received, free_after) if free_after > 0 else received
    qty = float(client.amount_to_precision(symbol, sellable))
    # Guard against a venue whose amount_to_precision rounds UP past the free balance.
    if free_after > 0 and qty > free_after and received > 0:
        qty = float(client.amount_to_precision(symbol, min(sellable, free_after) * (1 - 1e-9)))
    return qty


def place_order(cfg: dict, symbol: str, side: str, pct: float,
                order_type: str = "market",
                target_price: Optional[float] = None,
                market_type: str = "spot",
                leverage: float = 1.0,
                quote_amount: Optional[float] = None,
                stop_loss_pct: float = 0.0,
                take_profit_pct: float = 0.0) -> dict:
    """Place a buy/sell order sized as a percent of available balance.

    Spot:
    - BUY uses pct% of the free *quote* balance (e.g. USDT) to compute the amount.
    - SELL uses pct% of the free *base* balance (e.g. BTC).

    Futures (market_type="futures"):
    - BUY opens/increases a LONG, SELL opens/increases a SHORT (one-way mode).
    - Sized off pct% of the free USDT margin in the futures wallet, times leverage.
    - order_type "limit" requires target_price; "market" uses the last price to
      size the order.
    """
    side = (side or "").lower()
    order_type = (order_type or "market").lower()
    if side not in ("buy", "sell"):
        return {"ok": False, "message": "side must be 'buy' or 'sell'."}
    # ── Phase 2B · M3 (CUTOVER) / M2 (SHADOW) ──────────────────────────────────────────────────────
    # If this credential is CUT OVER, Praxis is the SOLE executor: route the intent to Praxis and return
    # WITHOUT ever placing a direct order. Fail-CLOSED — a route miss/failure returns ok=False, never a
    # direct trade and never a double (route_to_praxis makes a single attempt). If NOT cut over, mirror
    # the signal to Praxis (fire-and-forget) and continue on the direct path. A cut-over bot can never
    # fall through to client.create_order below. Entirely a no-op unless the PRAXIS_* flags are set.
    try:
        from . import praxis_relay
    except Exception:
        praxis_relay = None  # noqa: E501 — handled below; import of this pure module effectively never fails
    if os.getenv("PRAXIS_CUTOVER_ENABLED", "false").lower() == "true":
        if praxis_relay is None:
            return {"ok": False, "message": "cutover_failclosed: praxis_relay unavailable; refusing direct order."}
        routed = praxis_relay.maybe_route(cfg, symbol, side)
        if routed is not None:
            return routed  # cut over → Praxis handled it; NEVER place a direct order
    # M4 boundary: a NON-cutover signal has no safe direct path in the unified app. Refuse unless the
    # legacy engine is explicitly armed. (Cutover routing above already returned, so a cut-over signal
    # still reaches Praxis regardless of this gate.)
    if not _engine_enabled():
        return _engine_off_result("order")
    if praxis_relay is not None:
        try:
            praxis_relay.send_shadow(cfg, symbol, side, source="place_order")
        except Exception:
            pass
    if order_type not in ("market", "limit"):
        return {"ok": False, "message": "orderType must be 'market' or 'limit'."}
    qa = float(quote_amount or 0)
    if qa <= 0 and (not pct or pct <= 0 or pct > 100):
        return {"ok": False, "message": "pct must be between 0 and 100."}
    if order_type == "limit" and (not target_price or target_price <= 0):
        return {"ok": False, "message": "A target price is required for a limit order."}

    futures = market_type == "futures"
    lev = max(1, int(leverage or 1))
    try:
        client, plain = _client_from_config(cfg, "futures" if futures else "spot")
        client.load_markets()
        symbol = _resolve_symbol(client, symbol, futures)
        if symbol not in client.markets:
            return {"ok": False, "message": f"Unknown symbol {symbol} on {plain['exchange']}."}

        market = client.market(symbol)
        base, quote = market["base"], market["quote"]
        balance = client.fetch_balance()
        free = (balance or {}).get("free", {}) or {}

        ticker = client.fetch_ticker(symbol)
        last_price = float(ticker.get("last") or ticker.get("close") or 0)
        price = float(target_price) if order_type == "limit" else last_price
        if not price or price <= 0:
            return {"ok": False, "message": "Could not determine a price for sizing."}

        if futures:
            # Both directions are sized off the free USDT margin in the futures
            # wallet; SELL opens a short in one-way mode.
            free_quote = float(free.get(quote, 0) or 0)
            if free_quote <= 0:
                return {"ok": False, "message": f"No free {quote} margin in the futures wallet. Transfer USDT to Futures first."}
            try:
                client.set_leverage(lev, symbol)
            except Exception:  # noqa: BLE001 — best-effort; account default applies otherwise
                pass
            margin = min(qa, free_quote) if qa > 0 else free_quote * (pct / 100.0)
            amount = (margin * lev) / price
        elif side == "buy":
            free_quote = float(free.get(quote, 0) or 0)
            if free_quote <= 0:
                return {"ok": False, "message": f"No free {quote} balance to buy with."}
            spend = min(qa, free_quote) if qa > 0 else free_quote * (pct / 100.0)
            amount = spend / price
        else:
            # Spot SELL: free any base locked in resting orders first so a 100%
            # close actually flattens the whole holding (no leftover remainder).
            if not futures:
                try:
                    for o in (client.fetch_open_orders(symbol) or []):
                        try:
                            client.cancel_order(o.get("id"), symbol)
                        except Exception:  # noqa: BLE001
                            pass
                    free = (client.fetch_balance() or {}).get("free", {}) or {}
                except Exception:  # noqa: BLE001
                    pass
            free_base = float(free.get(base, 0) or 0)
            if free_base <= 0:
                return {"ok": False, "message": f"No free {base} balance to sell."}
            amount = min(free_base, qa / price) if qa > 0 else free_base * (pct / 100.0)

        amount = float(client.amount_to_precision(symbol, amount))
        if amount <= 0:
            return {"ok": False, "message": "Computed order size is too small for this market."}
        try:
            min_cost = ((market.get("limits") or {}).get("cost") or {}).get("min")
        except Exception:  # noqa: BLE001
            min_cost = None
        if min_cost and (amount * price) < float(min_cost):
            return {"ok": False, "message": f"Order ≈${amount * price:.2f} is below the {symbol} minimum of ${float(min_cost):.2f} — increase the size."}

        if order_type == "limit":
            price = float(client.price_to_precision(symbol, price))
            order = client.create_order(symbol, "limit", side, amount, price)
        else:
            order = client.create_order(symbol, "market", side, amount)

        # Optional native protective stop: after a SPOT BUY, place a STOP_LOSS_LIMIT
        # sell on the exchange so it auto-sells if price falls stop_loss_pct below
        # the fill — protecting you even when the app is closed. Best-effort: if the
        # exchange/region doesn't allow spot stops, we report it but keep the buy.
        # When BOTH a stop-loss and take-profit are requested we place an OCO
        # (one-cancels-the-other) so the same coins back both legs; if OCO is
        # unavailable we fall back to a stop only (never two full-size sells that
        # would double-lock the balance). One-sided requests place that order alone.
        stop_info = None
        sl = float(stop_loss_pct or 0); tp = float(take_profit_pct or 0)
        if (not futures) and side == "buy" and (sl > 0 or tp > 0):
            try:
                filled_qty = float(order.get("filled") or order.get("amount") or amount)
                fill_px = float(order.get("average") or order.get("price") or last_price)
                # Fee gotcha: source the protective SELL qty from the coins ACTUALLY received
                # (filled − base fee), capped by free balance, floored to LOT_SIZE — NOT the
                # theoretical filled qty (which an in-base fee makes unsellable → OCO rejected).
                sell_qty = _sellable_base_qty(client, symbol, base, order, filled_qty)
                if sell_qty > 0 and fill_px > 0:
                    if sl > 0 and tp > 0:
                        # Real OCO: a LIMIT take-profit above the fill AND a STOP_LOSS_LIMIT
                        # below it, one-cancels-the-other on the SAME coins (never double-locks).
                        tp_px = float(client.price_to_precision(symbol, fill_px * (1 + tp / 100.0)))
                        stop_px = float(client.price_to_precision(symbol, fill_px * (1 - sl / 100.0)))
                        stop_limit = float(client.price_to_precision(symbol, stop_px * 0.997))
                        try:
                            oco = client.private_post_order_oco({
                                "symbol": market["id"], "side": "SELL",
                                "quantity": client.amount_to_precision(symbol, sell_qty),
                                "price": client.price_to_precision(symbol, tp_px),
                                "stopPrice": client.price_to_precision(symbol, stop_px),
                                "stopLimitPrice": client.price_to_precision(symbol, stop_limit),
                                "stopLimitTimeInForce": "GTC",
                            })
                            reports = (oco or {}).get("orderReports") or []
                            order_ids = [r.get("orderId") for r in reports if r.get("orderId") is not None]
                            stop_info = {"ok": True, "type": "oco", "qty": sell_qty,
                                         "stopPrice": stop_px, "takeProfitPrice": tp_px,
                                         "slPct": sl, "tpPct": tp,
                                         "ocoId": (oco or {}).get("orderListId"), "orderIds": order_ids,
                                         "message": f"OCO placed on exchange: take-profit +{tp}% @ {tp_px} / stop −{sl}% @ {stop_px}."}
                        except Exception as oe:  # noqa: BLE001 — OCO may be unavailable; keep a stop only
                            try:
                                so = client.create_order(symbol, "STOP_LOSS_LIMIT", "sell", sell_qty, stop_limit,
                                                         {"stopPrice": stop_px, "timeInForce": "GTC"})
                                stop_info = {"ok": True, "type": "stop_only", "qty": sell_qty,
                                             "stopPrice": stop_px, "takeProfitPrice": None,
                                             "slPct": sl, "tpPct": tp, "orderIds": [so.get("id")],
                                             "message": f"Stop −{sl}% @ {stop_px} placed, but TAKE-PROFIT was NOT attached (OCO unavailable): {str(oe)[:110]}"}
                            except Exception as se2:  # noqa: BLE001
                                stop_info = {"ok": False, "type": "none",
                                             "message": f"Buy ok, but BOTH protective orders were REJECTED: {str(se2)[:140]}"}
                    elif sl > 0:
                        stop_px = float(client.price_to_precision(symbol, fill_px * (1 - sl / 100.0)))
                        limit_px = float(client.price_to_precision(symbol, stop_px * 0.997))  # a touch below so it fills
                        so = client.create_order(symbol, "STOP_LOSS_LIMIT", "sell", sell_qty, limit_px,
                                                 {"stopPrice": stop_px, "timeInForce": "GTC"})
                        stop_info = {"ok": True, "type": "stop_only", "qty": sell_qty, "id": so.get("id"),
                                     "orderIds": [so.get("id")], "stopPrice": stop_px, "takeProfitPrice": None,
                                     "slPct": sl, "tpPct": 0,
                                     "message": f"Protective stop −{sl}% @ {stop_px} placed on exchange."}
                    else:  # take-profit only
                        tp_px = float(client.price_to_precision(symbol, fill_px * (1 + tp / 100.0)))
                        to = client.create_order(symbol, "limit", "sell", sell_qty, tp_px, {"timeInForce": "GTC"})
                        stop_info = {"ok": True, "type": "tp_only", "qty": sell_qty, "id": to.get("id"),
                                     "orderIds": [to.get("id")], "stopPrice": None, "takeProfitPrice": tp_px,
                                     "slPct": 0, "tpPct": tp,
                                     "message": f"Take-profit +{tp}% @ {tp_px} placed on exchange."}
                else:
                    stop_info = {"ok": False, "type": "none",
                                 "message": "Buy ok, but no sellable base qty after fees to back a protective order — position is UNPROTECTED."}
            except Exception as se:  # noqa: BLE001 — region/exchange may not allow spot protective orders
                stop_info = {"ok": False, "type": "none",
                             "message": f"Buy ok, but the protective order was REJECTED — position is UNPROTECTED: {str(se)[:160]}"}

        return {
            "ok": True,
            "message": f"{side.upper()} {order_type} order placed for {amount} {base}."
                       + (" " + stop_info["message"] if stop_info else ""),
            "stopOrder": stop_info,
            "order": {
                "id": order.get("id"),
                "symbol": order.get("symbol", symbol),
                "side": order.get("side", side),
                "type": order.get("type", order_type),
                # filled base qty; market orders report it under "filled".
                "amount": order.get("filled") or order.get("amount") or amount,
                # Fill price: market orders leave "price" null — the real average
                # is in "average". Fall back to the pre-trade price for sizing only.
                "price": order.get("average") or order.get("price") or (price if order_type == "limit" else last_price),
                # Filled quote value (proceeds for a sell / spend for a buy). This
                # is the source of truth for P&L; never derive it from price alone.
                "cost": order.get("cost"),
                "average": order.get("average"),
                "filled": order.get("filled"),
                "status": order.get("status"),
                # Real trading fee(s) from the fill, so realized P&L can be netted (a manual live
                # close reads these to record a NET runs_log P&L). May be None if the venue didn't
                # populate them on this response → P&L falls back to gross.
                "fee": order.get("fee"),
                "fees": order.get("fees"),
            },
        }
    except ccxt.AuthenticationError as e:
        return {"ok": False, "message": f"Authentication failed: {e}"}
    except ccxt.InsufficientFunds as e:
        return {"ok": False, "message": f"Insufficient funds: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"Order failed: {e}"}


def withdraw(cfg: dict, code: str, amount: float, address: str,
             tag: Optional[str] = None) -> dict:
    """Withdraw crypto to an external address via ccxt.

    The caller is responsible for confirmation and for ensuring the destination is
    a whitelisted address. Withdrawal also requires that the user has enabled
    withdrawal permission (and, ideally, an address whitelist) on the exchange itself.
    """
    # Phase 2B · M4: the legacy direct-exchange engine is OFF by default — refuse outright unless armed.
    if not _engine_enabled():
        return _engine_off_result("order")
    # Phase 2B · M3: a CUT-OVER credential is managed SOLELY by Praxis — refuse any direct order here
    # (no 1:1 Praxis intent for a bulk close/withdraw; Praxis owns exits via reconciliation/flatten).
    if os.getenv("PRAXIS_CUTOVER_ENABLED", "false").lower() == "true":
        try:
            from . import praxis_relay
            _blocked = praxis_relay.is_credential_cutover(cfg)
        except Exception:
            _blocked = True  # cutover globally on but relay unavailable → fail CLOSED
        if _blocked:
            return {"ok": False, "message": "cutover_direct_disabled: Praxis is the sole executor for this credential."}
    code = (code or "").upper().strip()
    address = (address or "").strip()
    if not code:
        return {"ok": False, "message": "Currency code is required."}
    if not address:
        return {"ok": False, "message": "Destination address is required."}
    try:
        amount = float(amount)
    except (TypeError, ValueError):
        return {"ok": False, "message": "Amount must be a number."}
    if amount <= 0:
        return {"ok": False, "message": "Amount must be greater than zero."}

    try:
        client, plain = _client_from_config(cfg)
        params = {"tag": tag} if tag else {}
        result = client.withdraw(code, amount, address, tag, params)
        return {
            "ok": True,
            "message": f"Withdrawal of {amount} {code} submitted.",
            "withdrawal": {
                "id": (result or {}).get("id"),
                "currency": code, "amount": amount, "address": address,
                "status": (result or {}).get("status"),
                "environment": plain.get("environment"),
            },
        }
    except ccxt.AuthenticationError as e:
        return {"ok": False, "message": f"Authentication failed: {e}"}
    except ccxt.InsufficientFunds as e:
        return {"ok": False, "message": f"Insufficient funds: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"Withdrawal failed: {e}"}


def _extract_positions(raw) -> tuple:
    """Normalize ccxt fetch_positions output → (positions list, total uPnL)."""
    def _num(v) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    positions = []
    total = 0.0
    for p in raw or []:
        contracts = _num(p.get("contracts"))
        notional = _num(p.get("notional"))
        if contracts == 0.0 and notional == 0.0:
            continue
        upnl = p.get("unrealizedPnl")
        try:
            upnl_f = float(upnl) if upnl is not None else 0.0
        except (TypeError, ValueError):
            upnl_f = 0.0
        total += upnl_f
        positions.append({
            "symbol": p.get("symbol"),
            "side": p.get("side"),
            "contracts": contracts,
            "notional": notional,
            "entryPrice": p.get("entryPrice"),
            "markPrice": p.get("markPrice"),
            "unrealizedPnl": upnl_f,
            "percentage": p.get("percentage"),
            "leverage": p.get("leverage"),
        })

    positions.sort(key=lambda x: abs(x["unrealizedPnl"]), reverse=True)
    return positions, total


def get_positions(cfg: dict) -> dict:
    """Return open derivative positions and their total unrealized PnL.

    Spot-only accounts have no positions concept; in that case (or when the
    exchange/account does not expose fetchPositions) we return an empty list with
    supported=False so the UI can show an honest "no open positions" state rather
    than inventing a number.
    """
    try:
        client, _ = _client_from_config(cfg, "futures")
        if not client.has.get("fetchPositions"):
            return {"ok": True, "supported": False, "positions": [], "totalUnrealized": 0.0,
                    "message": "This account does not expose open positions."}
        raw = client.fetch_positions()
    except ccxt.AuthenticationError as e:
        return {"ok": False, "supported": True, "positions": [], "totalUnrealized": 0.0,
                "message": f"Authentication failed: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "supported": True, "positions": [], "totalUnrealized": 0.0,
                "message": str(e)}

    positions, total = _extract_positions(raw)
    return {"ok": True, "supported": True, "positions": positions,
            "totalUnrealized": total, "message": ""}


def get_protective_orders(cfg: dict) -> dict:
    """List the RESTING protective sell orders on the connected spot account —
    the exchange-native stop-loss / OCO / take-profit legs placed after a buy.

    Read-only: it fetches open orders and classifies each so the UI can show the
    user "your stop IS active, waiting at $X" instead of leaving them to assume a
    stop 'isn't working' when it simply hasn't been triggered. Never cancels or
    places anything."""
    try:
        client, _ = _client_from_config(cfg, "spot")
        raw = client.fetch_open_orders() or []
    except ccxt.AuthenticationError as e:
        return {"ok": False, "orders": [], "message": f"Authentication failed: {e}"}
    except Exception as e:  # noqa: BLE001 — some venues need a symbol; degrade gracefully
        return {"ok": True, "orders": [], "supported": False, "message": str(e)[:140]}

    out = []
    for o in raw:
        typ = str(o.get("type") or "").lower()
        info = o.get("info") or {}
        stop_px = o.get("stopPrice") or info.get("stopPrice")
        is_stop = ("stop" in typ) or bool(stop_px)
        is_sell = str(o.get("side") or "").lower() == "sell"
        if not is_sell:
            continue  # protective legs on a spot LONG are sells
        kind = "stop" if is_stop else ("take_profit" if typ in ("limit", "take_profit_limit", "limit_maker") else "other")
        out.append({
            "symbol": o.get("symbol"),
            "kind": kind,
            "price": float(o.get("price") or 0) or None,
            "stopPrice": float(stop_px) if stop_px else None,
            "qty": float(o.get("amount") or o.get("remaining") or 0) or None,
            "id": o.get("id"),
        })
    return {"ok": True, "supported": True, "orders": out, "message": ""}


def close_profitable_positions(cfg: dict) -> dict:
    """Close every open position currently in profit, in one batch.

    Flattens each derivative position whose unrealized PnL is positive with a
    reduce-only market order; losing/flat positions are left untouched. Spot-only
    accounts have no positions concept, so nothing is sold and we say so honestly
    rather than blindly dumping holdings we cannot attribute to a known entry.
    """
    # Phase 2B · M4: the legacy direct-exchange engine is OFF by default — refuse outright unless armed.
    if not _engine_enabled():
        return _engine_off_result("order")
    # Phase 2B · M3: a CUT-OVER credential is managed SOLELY by Praxis — refuse any direct order here
    # (no 1:1 Praxis intent for a bulk close/withdraw; Praxis owns exits via reconciliation/flatten).
    if os.getenv("PRAXIS_CUTOVER_ENABLED", "false").lower() == "true":
        try:
            from . import praxis_relay
            _blocked = praxis_relay.is_credential_cutover(cfg)
        except Exception:
            _blocked = True  # cutover globally on but relay unavailable → fail CLOSED
        if _blocked:
            return {"ok": False, "message": "cutover_direct_disabled: Praxis is the sole executor for this credential."}
    try:
        client, _ = _client_from_config(cfg)
        if not client.has.get("fetchPositions"):
            return {"ok": True, "supported": False, "closed": [], "errors": [], "realized": 0.0,
                    "message": "This account has no tracked open positions to close."}
        client.load_markets()
        raw = client.fetch_positions()
    except ccxt.AuthenticationError as e:
        return {"ok": False, "supported": True, "closed": [], "errors": [], "realized": 0.0,
                "message": f"Authentication failed: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "supported": True, "closed": [], "errors": [], "realized": 0.0,
                "message": f"Could not connect: {e}"}

    positions, _total = _extract_positions(raw)
    winners = [p for p in positions if float(p.get("unrealizedPnl") or 0.0) > 0]
    if not winners:
        return {"ok": True, "supported": True, "closed": [], "errors": [], "realized": 0.0,
                "message": "No open positions are currently in profit."}

    closed: list = []
    errors: list = []
    realized = 0.0
    for p in winners:
        symbol = p.get("symbol")
        side = (p.get("side") or "").lower()
        contracts = abs(float(p.get("contracts") or 0.0))
        upnl = float(p.get("unrealizedPnl") or 0.0)
        if not symbol or contracts <= 0:
            continue
        close_side = "sell" if side == "long" else "buy"
        try:
            amount = float(client.amount_to_precision(symbol, contracts))
            if amount <= 0:
                continue
            order = client.create_order(symbol, "market", close_side, amount, None,
                                        {"reduceOnly": True})
            realized += upnl
            closed.append({
                "symbol": symbol, "side": side, "contracts": amount,
                "unrealizedPnl": upnl, "orderId": order.get("id"),
            })
        except Exception as e:  # noqa: BLE001
            errors.append({"symbol": symbol, "message": str(e)})

    ok = len(closed) > 0 or len(errors) == 0
    msg = f"Closed {len(closed)} position(s) in profit."
    if errors:
        msg += f" {len(errors)} failed to close."
    return {"ok": ok, "supported": True, "closed": closed, "errors": errors,
            "realized": realized, "message": msg}


def order_fees_usdt(cfg: dict, orders: list) -> dict:
    """READ-ONLY real fees for the app's own live order log, keyed by the order row's id, as
    ``{id: {"feeUsdt": <non-base fee in USDT>, "baseFeeQty": <base-asset fee = coins NOT received>}}``.

    Binance charges a trading fee per fill (fetch_my_trades carries fee.cost + fee.currency). We
    sum the real fees per symbol split by side, then APPORTION each side's total across the app's
    own buy/sell orders by qty — so the TOTAL fee subtracted from realized P&L is exact (per-order
    is proportional; the app log has no exchange order id to match 1:1). Fee-currency handling:
      • USDT/quote  → USDT 1:1 (subtracted directly),
      • BASE asset  → a qty reduction (you received fewer coins) — NOT a USDT cost,
      • BNB / other → converted at <ccy>/USDT (unknown/unpriced currency is skipped → that fee
        stays gross rather than crashing or being wrongly zeroed).
    Best-effort + read-only: only fetch_my_trades / load_markets — never places/cancels an order.
    A symbol with no trade/fee data simply contributes nothing (P&L falls back to GROSS for it)."""
    from collections import defaultdict
    out: dict = {}
    if not orders:
        return out
    try:
        client, _ = _client_from_config(cfg, "spot")
        client.load_markets()
    except Exception as exc:  # noqa: BLE001 — never break P&L on a client build failure
        logger.info("order fees: client unavailable: %s", str(exc)[:120])
        return out
    by_sym: dict = defaultdict(lambda: {"buy": [], "sell": []})
    for o in orders:
        sym = str(o.get("symbol") or "")
        side = (o.get("side") or "").lower()
        if sym and side in ("buy", "sell") and o.get("id") is not None:
            by_sym[sym][side].append(o)
    px_cache: dict = {}

    def _ccy_usdt(ccy: str) -> Optional[float]:
        ccy = (ccy or "").upper()
        if ccy in ("USDT", "USD", "BUSD", "USDC", "FDUSD", "TUSD"):
            return 1.0
        if ccy not in px_cache:
            try:
                px_cache[ccy] = float(fetch_prices([f"{ccy}/USDT"]).get(f"{ccy}/USDT") or 0) or None
            except Exception:  # noqa: BLE001
                px_cache[ccy] = None
        return px_cache[ccy]

    for sym, sides in by_sym.items():
        base = sym.split("/")[0].upper()
        try:
            trades = client.fetch_my_trades(sym, limit=500)  # READ-ONLY
        except Exception as exc:  # noqa: BLE001 — one symbol failing must not stop the rest
            logger.info("order fees: fetch_my_trades %s skipped: %s", sym, str(exc)[:100])
            continue
        buy_fee_usdt = sell_fee_usdt = buy_base_fee = 0.0
        for t in (trades or []):
            tside = (t.get("side") or "").lower()
            fee_entries = t.get("fees") if t.get("fees") else ([t.get("fee")] if t.get("fee") else [])
            for f in fee_entries:
                fccy = str((f or {}).get("currency") or "").upper()
                fcost = float((f or {}).get("cost") or 0.0)
                if fcost <= 0 or not fccy:
                    continue
                if fccy == base:
                    if tside == "buy":
                        buy_base_fee += fcost          # base-asset fee on a buy → fewer coins received
                    # a base-asset fee on a SELL is unusual; ignore (already out of the position)
                else:
                    up = _ccy_usdt(fccy)
                    if not up:
                        continue                        # unpriced currency → leave that fee gross
                    if tside == "buy":
                        buy_fee_usdt += fcost * up
                    elif tside == "sell":
                        sell_fee_usdt += fcost * up
        for side, tot_fee, tot_base in (("buy", buy_fee_usdt, buy_base_fee), ("sell", sell_fee_usdt, 0.0)):
            ords = sides[side]
            tq = sum(float(o.get("qty") or 0.0) for o in ords)
            if tq <= 0:
                continue
            for o in ords:
                share = float(o.get("qty") or 0.0) / tq
                rec = out.setdefault(o["id"], {"feeUsdt": 0.0, "baseFeeQty": 0.0})
                rec["feeUsdt"] += tot_fee * share
                rec["baseFeeQty"] += tot_base * share
    return out


def realized_pnl_by_order(orders: list) -> dict:
    """PER-ORDER realized P&L for the live trades table, keyed by the order's activity id, NET of
    real trading fees when the orders carry ``feeUsdt`` / ``baseFeeQty`` (see order_fees_usdt) —
    otherwise GROSS (graceful fallback, so a missing-fee symbol never breaks or zeroes out).

    Same moving-average, sell-aware replay as ``replay_orders``: a BUY re-averages the held lot;
    its base-asset fee reduces the coins actually received and its USDT/BNB fee is amortised INTO
    the cost basis, so later sells inherit it. Each SELL realizes ``(sell_price − running_avg) ×
    qty_sold`` MINUS its own USDT fee. Buys get no entry ("—"); a sell with no tracked buy is
    skipped rather than shown wrong. Read-only.
    """
    from collections import defaultdict
    pos_qty: dict = defaultdict(float)
    pos_cost: dict = defaultdict(float)
    out: dict = {}
    for a in sorted(orders or [], key=lambda x: x.get("id") or 0):
        base = str(a.get("symbol") or "").split("/")[0].upper()
        if not base:
            continue
        side = (a.get("side") or "").lower()
        oqty = float(a.get("qty") or 0)
        ocost = float(a.get("cost") or 0)
        fee_usdt = float(a.get("feeUsdt") or 0.0)
        base_fee = float(a.get("baseFeeQty") or 0.0)
        if side == "buy":
            pos_qty[base] += max(0.0, oqty - base_fee)      # coins actually received (after base fee)
            pos_cost[base] += ocost + fee_usdt              # amortise the USDT/BNB fee into the basis
        elif side == "sell":
            held = pos_qty[base]
            if held > 1e-12 and oqty > 0:
                avg_now = pos_cost[base] / held
                sold = oqty if oqty <= held else held
                sell_price = ocost / oqty if oqty > 0 else 0.0
                if a.get("id") is not None:
                    out[a["id"]] = round((sell_price - avg_now) * sold - fee_usdt, 2)   # NET gain/loss
                pos_qty[base] = held - sold
                pos_cost[base] -= avg_now * sold
            if pos_qty[base] <= 1e-9:                        # flat → reset for a clean re-buy
                pos_qty[base] = 0.0
                pos_cost[base] = 0.0
    return out


def replay_orders(orders: list) -> dict:
    """SINGLE moving-average replay of a LIVE order log, ACCOUNTING FOR SELLS. Returns:
      • ``basis``:    ``{BASE: {"qty", "cost"}}`` — cost basis of the currently-held lot
                      (buys re-average; sells remove cost at the running average; a flat
                      position resets so a re-buy starts clean).
      • ``realized``: total REALIZED P&L across every sell = Σ (sell_price − running_avg)
                      × qty_sold — the honest closed-trade P&L (handles round-trips).
      • ``realizedByAsset``: ``{BASE: realized}``.

    A buy-only average (Σbuycost/Σbuyqty) was wrong for any asset traded in-and-out (it
    averaged in the cost of coins already sold). Orders are replayed OLDEST-FIRST
    (id ASC = insertion order). Shared by live-pnl (basis + realized) AND
    close-profitable-spot (basis) so every P&L figure comes from ONE path.
    """
    from collections import defaultdict
    pos_qty: dict = defaultdict(float)
    pos_cost: dict = defaultdict(float)
    realized_by: dict = defaultdict(float)
    for a in sorted(orders or [], key=lambda x: x.get("id") or 0):
        base = str(a.get("symbol") or "").split("/")[0].upper()
        if not base:
            continue
        side = (a.get("side") or "").lower()
        oqty = float(a.get("qty") or 0)
        ocost = float(a.get("cost") or 0)
        # NET of real fees when the order carries them (order_fees_usdt); else 0 → GROSS.
        fee_usdt = float(a.get("feeUsdt") or 0.0)
        base_fee = float(a.get("baseFeeQty") or 0.0)
        if side == "buy":
            pos_qty[base] += max(0.0, oqty - base_fee)       # coins actually received (after base fee)
            pos_cost[base] += ocost + fee_usdt               # amortise the USDT/BNB fee into the basis
        elif side == "sell":
            held = pos_qty[base]
            if held > 1e-12 and oqty > 0:
                avg_now = pos_cost[base] / held
                sold = oqty if oqty <= held else held      # never oversell the tracked lot
                sell_price = ocost / oqty if oqty > 0 else 0.0
                realized_by[base] += (sell_price - avg_now) * sold - fee_usdt   # NET closed-trade P&L
                pos_qty[base] = held - sold
                pos_cost[base] -= avg_now * sold
            if pos_qty[base] <= 1e-9:                       # flat → reset for a clean re-buy
                pos_qty[base] = 0.0
                pos_cost[base] = 0.0
    bases = set(pos_qty) | set(realized_by)
    return {
        "basis": {b: {"qty": pos_qty.get(b, 0.0), "cost": pos_cost.get(b, 0.0)} for b in bases},
        "realized": sum(realized_by.values()),
        "realizedByAsset": {b: realized_by[b] for b in realized_by},
    }


def avg_cost_basis(orders: list) -> dict:
    """Backward-compatible wrapper: just the sell-aware cost-basis map
    ``{BASE: {"qty", "cost"}}`` from replay_orders() (used by close-profitable-spot)."""
    return replay_orders(orders)["basis"]


def close_profitable_spot(cfg: dict, orders: list) -> dict:
    """Sell every SPOT holding currently in profit (per the order-log cost basis)
    back to USDT — mirrors the live-pnl per-symbol P&L so it closes EXACTLY what the
    UI shows as 'in profit'. This is what was missing: the UI's profitable
    "positions" are spot holdings, but the old close path only flattened derivative
    positions, so on a spot account the button closed nothing.

    Skips: USDT, holdings with unknown cost basis (can't prove profit), sub-$1
    dust, and anything not in profit. ``orders`` is the live order log (passed in
    from the route, which owns DB access) so the cost basis matches live-pnl 1:1.
    """
    # Phase 2B · M4: the legacy direct-exchange engine is OFF by default — refuse outright unless armed.
    if not _engine_enabled():
        return _engine_off_result("order")
    # Phase 2B · M3: a CUT-OVER credential is managed SOLELY by Praxis — refuse any direct order here
    # (no 1:1 Praxis intent for a bulk close/withdraw; Praxis owns exits via reconciliation/flatten).
    if os.getenv("PRAXIS_CUTOVER_ENABLED", "false").lower() == "true":
        try:
            from . import praxis_relay
            _blocked = praxis_relay.is_credential_cutover(cfg)
        except Exception:
            _blocked = True  # cutover globally on but relay unavailable → fail CLOSED
        if _blocked:
            return {"ok": False, "message": "cutover_direct_disabled: Praxis is the sole executor for this credential."}
    from collections import defaultdict
    try:
        client, _ = _client_from_config(cfg, "spot")
        client.load_markets()
        bal = client.fetch_balance()
    except ccxt.AuthenticationError as e:
        return {"ok": False, "closed": [], "errors": [], "realized": 0.0, "message": f"Authentication failed: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "closed": [], "errors": [], "realized": 0.0, "message": f"Could not connect: {e}"}

    totals = (bal or {}).get("total", {}) or {}
    # Same moving-average cost basis (sell-aware) live-pnl uses → we close EXACTLY the
    # holdings the UI marks "in profit".
    basis_map = avg_cost_basis(orders or [])

    closed: list = []
    errors: list = []
    realized = 0.0
    for asset, total in totals.items():
        base = str(asset).upper()
        if base == "USDT":
            continue
        try:
            qty = float(total or 0)
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue
        bm = basis_map.get(base) or {}
        avg = (bm["cost"] / bm["qty"]) if bm.get("qty", 0.0) > 1e-12 else None
        if not avg:
            continue  # unknown cost basis → can't prove it's in profit → leave it
        symbol = f"{base}/USDT"
        if symbol not in client.markets:
            continue
        try:
            tk = client.fetch_ticker(symbol)
            px = float(tk.get("last") or tk.get("close") or 0)
            if px <= 0:
                continue
            value = qty * px
            if value < 1:      # dust
                continue
            pnl = value - avg * qty
            if pnl <= 0:       # only winners
                continue
            # free any locked base (resting orders) so the full qty is sellable
            for o in (client.fetch_open_orders(symbol) or []):
                try:
                    client.cancel_order(o.get("id"), symbol)
                except Exception:  # noqa: BLE001
                    pass
            free_amt = float((client.fetch_balance() or {}).get("free", {}).get(base, 0) or 0)
            amt = float(client.amount_to_precision(symbol, free_amt))
            if amt <= 0:
                continue
            min_cost = ((client.market(symbol).get("limits") or {}).get("cost") or {}).get("min")
            if min_cost and amt * px < float(min_cost):
                errors.append({"symbol": symbol, "message": f"below min notional (${float(min_cost):.2f})"})
                continue
            order = client.create_order(symbol, "market", "sell", amt)
            realized += pnl
            # same shape as the derivative path so the route logs it uniformly
            closed.append({"symbol": symbol, "side": "long", "contracts": amt,
                           "unrealizedPnl": pnl, "orderId": order.get("id")})
        except Exception as e:  # noqa: BLE001
            errors.append({"symbol": symbol, "message": str(e)})

    msg = f"Sold {len(closed)} spot holding(s) in profit."
    if errors:
        msg += f" {len(errors)} failed."
    return {"ok": len(closed) > 0 or len(errors) == 0, "closed": closed,
            "errors": errors, "realized": realized, "message": msg}


def close_all_spot(cfg: dict) -> dict:
    """Sell every non-USDT SPOT holding back to USDT (market), fully flattening
    each. Cancels any resting orders for the symbol first so locked base is freed.

    Spot has no per-position cost basis, so this closes *all* holdings (it can't
    isolate 'profitable' ones) — the UI labels it accordingly.
    """
    # Phase 2B · M4: the legacy direct-exchange engine is OFF by default — refuse outright unless armed.
    if not _engine_enabled():
        return _engine_off_result("order")
    # Phase 2B · M3: a CUT-OVER credential is managed SOLELY by Praxis — refuse any direct order here
    # (no 1:1 Praxis intent for a bulk close/withdraw; Praxis owns exits via reconciliation/flatten).
    if os.getenv("PRAXIS_CUTOVER_ENABLED", "false").lower() == "true":
        try:
            from . import praxis_relay
            _blocked = praxis_relay.is_credential_cutover(cfg)
        except Exception:
            _blocked = True  # cutover globally on but relay unavailable → fail CLOSED
        if _blocked:
            return {"ok": False, "message": "cutover_direct_disabled: Praxis is the sole executor for this credential."}
    try:
        client, _ = _client_from_config(cfg, "spot")
        client.load_markets()
        balance = client.fetch_balance()
    except ccxt.AuthenticationError as e:
        return {"ok": False, "closed": [], "errors": [], "message": f"Authentication failed: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "closed": [], "errors": [], "message": f"Could not connect: {e}"}

    totals = (balance or {}).get("total", {}) or {}
    closed: list = []
    errors: list = []
    for asset, total in totals.items():
        a = str(asset).upper()
        if a == "USDT":
            continue
        try:
            if float(total) <= 0:
                continue
        except (TypeError, ValueError):
            continue
        symbol = f"{a}/USDT"
        if symbol not in client.markets:
            continue
        try:
            for o in (client.fetch_open_orders(symbol) or []):
                try:
                    client.cancel_order(o.get("id"), symbol)
                except Exception:  # noqa: BLE001
                    pass
            free = (client.fetch_balance() or {}).get("free", {}) or {}
            amt = float(client.amount_to_precision(symbol, float(free.get(a, 0) or 0)))
            if amt <= 0:
                continue
            tk = client.fetch_ticker(symbol)
            px = float(tk.get("last") or tk.get("close") or 0)
            min_cost = ((client.market(symbol).get("limits") or {}).get("cost") or {}).get("min")
            if px and min_cost and amt * px < float(min_cost):
                errors.append({"symbol": symbol, "message": f"below min notional (${float(min_cost):.2f})"})
                continue
            order = client.create_order(symbol, "market", "sell", amt)
            fill = float(order.get("average") or px or 0)
            proceeds = order.get("cost")
            proceeds = float(proceeds) if proceeds not in (None, "") and float(proceeds or 0) > 0 else (amt * fill if amt and fill else None)
            closed.append({"symbol": symbol, "amount": amt, "price": fill, "cost": proceeds, "orderId": order.get("id")})
        except Exception as e:  # noqa: BLE001
            errors.append({"symbol": symbol, "message": str(e)})

    msg = f"Closed {len(closed)} spot holding(s) to USDT." + (f" {len(errors)} failed." if errors else "")
    return {"ok": len(errors) == 0 or len(closed) > 0, "closed": closed, "errors": errors, "message": msg}


def _dust_bnb_eligible(client) -> set:
    """Ask Binance which currently-held small balances it will convert to BNB right now
    (POST /sapi/v1/asset/dustBtc). Returns the set of eligible asset codes (UPPER).

    This is the authoritative list — a token NOT here can never be swept by the dust
    endpoint, so we won't waste a call on it and can tell the user exactly why. Logs the
    raw response so we can see what the exchange actually reported.
    """
    fn = getattr(client, "sapiPostAssetDustBtc", None) or getattr(client, "sapi_post_asset_dust_btc", None)
    if fn is None:
        return set()
    try:
        res = fn() or {}
    except Exception as e:  # noqa: BLE001
        logger.warning("clean-dust: dustBtc eligibility query failed: %s", e)
        return set()
    elig = {str(r.get("asset") or "").upper() for r in (res.get("details") or []) if r.get("asset")}
    logger.info("clean-dust: Binance dust→BNB eligible now = %s (raw=%s)", sorted(elig), res)
    return elig


def _sweep_to_bnb(client, assets: list) -> tuple:
    """Convert each eligible dust asset to BNB via POST /sapi/v1/asset/dust — PER ASSET
    (so the ``asset`` param encodes unambiguously and one bad coin can't sink the rest).
    Returns ``(converted, errors)``; logs each raw response.
    """
    fn = getattr(client, "sapiPostAssetDust", None) or getattr(client, "sapi_post_asset_dust", None)
    converted: list = []
    errors: list = []
    if fn is None:
        return [], [{"asset": a, "symbol": f"{a}/BNB", "message": "dust→BNB endpoint unavailable in this ccxt build"} for a in assets]
    for a in assets:
        try:
            res = fn({"asset": a}) or {}
            logger.info("clean-dust: dust→BNB %s raw=%s", a, res)
            rows = res.get("transferResult") or []
            if rows:
                for r in rows:
                    converted.append({"asset": a, "to": "BNB", "bnb": r.get("transferedAmount"), "amount": r.get("amount")})
            else:
                errors.append({"asset": a, "symbol": f"{a}/BNB", "message": "Binance accepted the request but transferred nothing"})
        except Exception as e:  # noqa: BLE001
            logger.warning("clean-dust: dust→BNB %s failed: %s", a, e)
            errors.append({"asset": a, "symbol": f"{a}/BNB", "message": f"dust→BNB failed: {str(e)[:140]}"})
    return converted, errors


def _convert_to_usdt(client, asset: str, qty: float) -> tuple:
    """Try Binance Convert (getQuote → acceptQuote) to turn a dust balance directly into
    USDT — the 'to dollar' the user actually wants. Returns ``(row, None)`` on success or
    ``(None, reason)`` on failure (e.g. below Binance Convert's per-pair minimum). Logs raw.
    """
    getq = getattr(client, "sapiPostConvertGetQuote", None)
    acc = getattr(client, "sapiPostConvertAcceptQuote", None)
    if getq is None or acc is None:
        return None, "Binance Convert unavailable in this ccxt build"
    sym = f"{asset}/USDT"
    try:
        amt = client.amount_to_precision(sym, qty) if sym in client.markets else ("%.8f" % qty)
    except Exception:  # noqa: BLE001
        amt = "%.8f" % qty
    try:
        q = getq({"fromAsset": asset, "toAsset": "USDT", "fromAmount": amt, "walletType": "SPOT"}) or {}
        logger.info("clean-dust: convert quote %s→USDT raw=%s", asset, q)
        qid = q.get("quoteId")
        if not qid:
            return None, "no quote returned (likely below Binance Convert minimum)"
        r = acc({"quoteId": qid}) or {}
        logger.info("clean-dust: convert accept %s→USDT raw=%s", asset, r)
        status = str(r.get("orderStatus") or r.get("status") or "").upper()
        if r.get("orderId") or status in ("PROCESS", "SUCCESS", "ACCEPT_SUCCESS"):
            return {"asset": asset, "to": "USDT", "usdt": q.get("toAmount"), "amount": q.get("fromAmount")}, None
        return None, f"convert not accepted (status={status or 'unknown'})"
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        logger.warning("clean-dust: convert %s→USDT failed: %s", asset, msg)
        low = msg.lower()
        if any(k in low for k in ("minimum", "too small", "min amount", "-3502", "-4059", "quantity", "precision")):
            return None, "below Binance Convert minimum"
        if "permission" in low or "-2015" in low or "invalid api" in low:
            return None, "the API key lacks Convert/Spot-trade permission"
        return None, f"convert failed: {msg[:120]}"


# Kept for backward-compat callers; the new pipeline lives inline in clean_dust_spot.
def _convert_dust_to_bnb(client, assets: list, exchange_id: str, environment: str) -> tuple:
    if not assets:
        return [], []
    if exchange_id != "binance" or environment != "live":
        return [], [{"asset": a, "symbol": f"{a}/USDT", "message": "dust→BNB is Binance-live only"} for a in assets]
    elig = _dust_bnb_eligible(client)
    return _sweep_to_bnb(client, [a for a in assets if a in elig])


def clean_dust_spot(cfg: dict, max_value: float = 5.0) -> dict:
    """Clear DUST — tiny non-USDT spot leftovers worth LESS than ``max_value`` (default
    $5) — so the wallet reads clean. Three mechanisms, in order, per token:

      1. **Market-sell to USDT** any dust still *above* the pair's minimum notional.
      2. **Binance native dust→BNB sweep** (POST /sapi/v1/asset/dust) for tokens Binance
         lists as dust-convertible (queried live via /sapi/v1/asset/dustBtc).
      3. **Binance Convert → USDT** (getQuote/acceptQuote) for the rest — the direct
         'to dollar' path, which reaches many tokens the dust sweep won't.

    Real holdings (value ≥ threshold), USDT and BNB are left untouched. EVERY token gets
    a per-token entry in ``details`` (action + reason), and anything still un-clearable is
    reported with the exchange's reason — never a silent no-op. The user fires this
    explicitly (route is PIN/creds-gated + the UI confirms); we never sweep on our own.

    Efficiency: balance + all held prices are fetched ONCE (a single fetch_tickers), so an
    account with dozens of dust tokens doesn't stall on per-token network calls.
    """
    # Phase 2B · M4: the legacy direct-exchange engine is OFF by default — refuse outright unless armed.
    if not _engine_enabled():
        return _engine_off_result("order")
    # Phase 2B · M3: a CUT-OVER credential is managed SOLELY by Praxis — refuse any direct order here
    # (no 1:1 Praxis intent for a bulk close/withdraw; Praxis owns exits via reconciliation/flatten).
    if os.getenv("PRAXIS_CUTOVER_ENABLED", "false").lower() == "true":
        try:
            from . import praxis_relay
            _blocked = praxis_relay.is_credential_cutover(cfg)
        except Exception:
            _blocked = True  # cutover globally on but relay unavailable → fail CLOSED
        if _blocked:
            return {"ok": False, "message": "cutover_direct_disabled: Praxis is the sole executor for this credential."}
    try:
        client, plain = _client_from_config(cfg, "spot")
        client.load_markets()
        balance = client.fetch_balance()
    except ccxt.AuthenticationError as e:
        return {"ok": False, "closed": [], "convertedUsdt": [], "convertedBnb": [], "errors": [], "details": [], "skipped": 0, "message": f"Authentication failed: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "closed": [], "convertedUsdt": [], "convertedBnb": [], "errors": [], "details": [], "skipped": 0, "message": f"Could not connect: {e}"}

    exchange_id = str(plain.get("exchange") or "binance").lower()
    environment = str(plain.get("environment") or "testnet").lower()
    totals = (balance or {}).get("total", {}) or {}
    free_map = (balance or {}).get("free", {}) or {}   # fetched ONCE, reused below

    # Held non-cash assets (qty > 0). Price them all in ONE fetch_tickers call.
    held: list = []
    for asset, total in totals.items():
        a = str(asset).upper()
        if a in ("USDT", "BNB"):
            continue
        try:
            qty = float(total or 0)
        except (TypeError, ValueError):
            continue
        if qty > 0:
            held.append((a, qty))
    price_syms = [f"{a}/USDT" for a, _ in held if f"{a}/USDT" in client.markets]
    prices: dict = {}
    if price_syms:
        try:
            tks = client.fetch_tickers(price_syms)
            for s, tk in (tks or {}).items():
                prices[s] = float((tk or {}).get("last") or (tk or {}).get("close") or 0)
        except Exception as e:  # noqa: BLE001
            logger.warning("clean-dust: batch ticker fetch failed (%s) — treating unpriced as dust", e)

    closed: list = []            # market-sold to USDT (logged as activity by the route)
    converted_usdt: list = []    # Binance Convert → USDT
    converted_bnb: list = []     # native dust → BNB
    errors: list = []            # un-clearable, with reason
    details: list = []           # per-token breakdown (action + reason) — shown to the user
    stuck: list = []             # (asset, qty, value) below min → sweep/convert
    skipped = 0                  # real holdings left alone

    for a, qty in held:
        symbol = f"{a}/USDT"
        px = prices.get(symbol, 0.0)
        value = (qty * px) if px > 0 else None
        if value is not None and value >= max_value:   # a real holding, not dust → leave it
            skipped += 1
            continue
        # 1) Market-sell to USDT when the dust is actually above the pair minimum.
        if symbol in client.markets and px > 0:
            min_cost = ((client.market(symbol).get("limits") or {}).get("cost") or {}).get("min")
            free_amt = float(free_map.get(a, 0) or 0)
            try:
                amt = float(client.amount_to_precision(symbol, free_amt))
            except Exception:  # noqa: BLE001
                amt = free_amt
            if amt > 0 and not (min_cost and amt * px < float(min_cost)):
                try:
                    for o in (client.fetch_open_orders(symbol) or []):
                        try:
                            client.cancel_order(o.get("id"), symbol)
                        except Exception:  # noqa: BLE001
                            pass
                    order = client.create_order(symbol, "market", "sell", amt)
                    fill = float(order.get("average") or px or 0)
                    proceeds = order.get("cost")
                    proceeds = float(proceeds) if proceeds not in (None, "") and float(proceeds or 0) > 0 else (amt * fill if amt and fill else None)
                    closed.append({"symbol": symbol, "amount": amt, "price": fill, "cost": proceeds, "orderId": order.get("id")})
                    details.append({"asset": a, "action": "sold_usdt", "value": value, "reason": "market-sold to USDT"})
                    continue
                except Exception as e:  # noqa: BLE001 — fall through to sweep/convert
                    logger.warning("clean-dust: market-sell %s failed: %s", symbol, e)
        # 2/3) Below the pair minimum → sweep/convert candidate.
        stuck.append((a, qty, value))

    if stuck:
        if exchange_id == "binance" and environment == "live":
            elig = _dust_bnb_eligible(client)
            # dust→BNB for the eligible ones (batch of tiny sub-Convert-min coins)…
            bnb_assets = [a for (a, q, v) in stuck if a in elig]
            if bnb_assets:
                cvd, errs = _sweep_to_bnb(client, bnb_assets)
                converted_bnb.extend(cvd)
                for c in cvd:
                    details.append({"asset": c["asset"], "action": "swept_bnb", "reason": f"converted to BNB ({c.get('bnb')} BNB)"})
                for er in errs:
                    errors.append(er)
                    details.append({"asset": er["asset"], "action": "error", "reason": er["message"]})
            # …and Binance Convert → USDT for everything else (the 'to dollar' path).
            done = {c["asset"] for c in converted_bnb} | {e["asset"] for e in errors}
            for (a, q, v) in stuck:
                if a in done:
                    continue
                row, reason = _convert_to_usdt(client, a, q)
                if row:
                    converted_usdt.append(row)
                    details.append({"asset": a, "action": "converted_usdt", "value": v, "reason": f"converted to USDT ({row.get('usdt')} USDT)"})
                else:
                    errors.append({"asset": a, "symbol": f"{a}/USDT", "message": reason})
                    details.append({"asset": a, "action": "skipped", "value": v, "reason": reason})
        else:
            reason = ("below Binance's minimum — dust→BNB/Convert is live-only (not on testnet)"
                      if exchange_id == "binance"
                      else "below the exchange minimum — this exchange has no API dust-convert")
            for (a, q, v) in stuck:
                errors.append({"asset": a, "symbol": f"{a}/USDT", "message": reason})
                details.append({"asset": a, "action": "skipped", "value": v, "reason": reason})

    n_usdt = len(closed) + len(converted_usdt)
    n_bnb = len(converted_bnb)
    n_left = len(errors)
    cleared = n_usdt + n_bnb

    parts = []
    if n_usdt:
        parts.append(f"{n_usdt} converted to USDT")
    if n_bnb:
        parts.append(f"{n_bnb} swept to BNB")
    if cleared:
        msg = "Dust cleaned: " + ", ".join(parts) + "."
        if n_left:
            msg += f" {n_left} left — below Binance's minimum; convert them manually in Binance (Wallet → Convert)."
    elif n_left:
        msg = (f"Couldn't convert {n_left} tiny balance(s): they're below Binance's minimum trade size and not "
               f"eligible for Binance's automatic dust conversion via the API. Convert them manually in the Binance "
               f"app: Wallet → Convert Small Balances.")
    else:
        msg = "No dust found."
    logger.info("clean-dust (%s/%s): %s | details=%s", exchange_id, environment, msg, details)
    ok = cleared > 0 or n_left == 0
    return {"ok": ok, "closed": closed, "convertedUsdt": converted_usdt, "convertedBnb": converted_bnb,
            "converted": converted_bnb + converted_usdt, "errors": errors, "details": details,
            "skipped": skipped, "message": msg}
