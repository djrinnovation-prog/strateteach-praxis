"""Trend Scanner: breakout/trend scans, per-symbol charts, and ad-hoc Telegram
push of a signal list. Scan results are cached in ``app.core.cache``.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app import database as db
from app.core import cache
from app.core.security import current_user, require_admin
from app.data.symbols import BUCKET_MAP
from app.services import signals as sig_scanner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["signals"])


class SignalsTelegramInput(BaseModel):
    signals: List[dict] = []


def ensure_strategy(strategy: str) -> bool:
    """True if the strategy id is runnable. Base strategies are always valid;
    user-saved strategies (``saved_<id>``) are loaded from the DB and registered
    with the scanner on demand."""
    if strategy in sig_scanner.STRATEGY_PARAMS or strategy in sig_scanner.SAVED_STRATEGY_PARAMS:
        return True
    if strategy and strategy.startswith("saved_"):
        try:
            sid = int(strategy.split("_", 1)[1])
        except (ValueError, IndexError):
            return False
        row = db.get_saved_strategy(sid)
        if row:
            cfg = dict(row["config"] or {})
            cfg.setdefault("label", row.get("name"))
            sig_scanner.register_saved_strategy(strategy, cfg)
            return True
    return False


@router.get("/signals/breakouts")
async def signals_breakouts(
    buckets: str = "crypto,stocks,metals,commodities",
    crypto_limit: int = Query(default=10, ge=1, le=1000),
    stock_limit: int = Query(default=10, ge=1, le=1000),
    metal_limit: int = Query(default=1000, ge=1, le=1000),
    commodity_limit: int = Query(default=1000, ge=1, le=1000),
    strategy: str = Query(default=sig_scanner.DEFAULT_STRATEGY),
    force: bool = False,
    username: str = Depends(current_user),
):
    bucket_list = [b.strip() for b in buckets.split(",") if b.strip() in BUCKET_MAP]
    if not bucket_list:
        raise HTTPException(400, "No valid buckets specified.")
    if not ensure_strategy(strategy):
        raise HTTPException(400, f"Unknown strategy: {strategy}")

    # ── Tier gate: cap how many breakout rows this user may see ──
    from app.services import plans
    ent = plans.entitlements(db.get_user(username))
    visible = ent.get("breakoutsVisible")  # None = full universe (Pro/admin)

    key = f"{','.join(sorted(bucket_list))}|cl={crypto_limit}|sl={stock_limit}|ml={metal_limit}|cdl={commodity_limit}|st={strategy}"
    now = time.time()
    if not force and key in cache.scan_cache and now - cache.scan_cache[key]["ts"] < cache.SCAN_CACHE_TTL:
        signals = cache.scan_cache[key]["data"]
    else:
        signals = await sig_scanner.run_breakout_scan(
            bucket_list, crypto_limit=crypto_limit, stock_limit=stock_limit,
            metal_limit=metal_limit, commodity_limit=commodity_limit, strategy=strategy,
        )
        cache.scan_cache[key] = {"data": signals, "ts": now}

    if visible is not None and isinstance(signals, list) and len(signals) > visible:
        return signals[:visible]
    return signals


@router.get("/signals/daily")
def signals_daily(_: str = Depends(current_user)):
    """The cached daily breakout scan: when it ran, when it runs next, and the
    top-10 tradeable longs that feed the Profit Engine. ``scanning`` reflects
    whether a (manual or scheduled) re-scan is in flight right now, so the UI can
    show immediate "scanning…" feedback and fast-poll until it completes."""
    from app.services.daily_scan import is_scanning
    d = db.get_daily_scan()
    sigs = d.get("signals", []) or []
    longs = [s for s in sigs if s.get("direction") == "long" and float(s.get("currentPrice") or 0) > 0]
    return {
        "lastScanAt": d.get("ranAt"),
        "nextScanAt": d.get("nextAt"),
        "scanning": is_scanning(),
        "count": len(sigs),
        "longCount": len(longs),
        "top10": longs[:10],
        # FULL ordered long list (not just the top 10) so the Daily Scan card can
        # render the complete, filtered/ordered results table at the bottom — the
        # `top10` cap above is only the highlight strip, never the whole list.
        "results": longs,
    }


@router.get("/signals/compare")
async def signals_compare(
    buckets: str = "crypto",
    strategies: str = "bot8c,bot4,bot1",
    crypto_limit: int = Query(default=100, ge=1, le=1000),
    stock_limit: int = Query(default=0, ge=0, le=1000),
    metal_limit: int = Query(default=0, ge=0, le=1000),
    commodity_limit: int = Query(default=0, ge=0, le=1000),
    top: int = Query(default=100, ge=1, le=100),
    force: bool = False,
    username: str = Depends(current_user),
):
    """Compare several strategies' breakout rankings side by side. Returns, per
    strategy, its OWN top-``top`` ranked long list. OHLCV is fetched once and
    re-classified per strategy (see ``run_compare_scan``), and the whole result is
    cached like the other scans so re-opening the view is instant."""
    bucket_list = [b.strip() for b in buckets.split(",") if b.strip() in BUCKET_MAP]
    if not bucket_list:
        raise HTTPException(400, "No valid buckets specified.")

    strat_list: List[str] = []
    for s in strategies.split(","):
        s = s.strip()
        if s and ensure_strategy(s) and s not in strat_list:
            strat_list.append(s)
    if not strat_list:
        raise HTTPException(400, "No valid strategies specified.")

    # Tier gate: cap how many rows per strategy this user may see (same as breakouts).
    from app.services import plans
    ent = plans.entitlements(db.get_user(username))
    visible = ent.get("breakoutsVisible")  # None = full universe (Pro/admin)

    key = (
        f"compare|{','.join(sorted(bucket_list))}|cl={crypto_limit}|sl={stock_limit}"
        f"|ml={metal_limit}|cdl={commodity_limit}|st={','.join(strat_list)}|top={top}"
    )
    now = time.time()
    if not force and key in cache.scan_cache and now - cache.scan_cache[key]["ts"] < cache.SCAN_CACHE_TTL:
        result = cache.scan_cache[key]["data"]
    else:
        result = await sig_scanner.run_compare_scan(
            bucket_list, strat_list, crypto_limit=crypto_limit, stock_limit=stock_limit,
            metal_limit=metal_limit, commodity_limit=commodity_limit, top=top,
        )
        cache.scan_cache[key] = {"data": result, "ts": now}

    strategies_out = []
    for strat in strat_list:
        rows = result.get(strat, []) or []
        if visible is not None and len(rows) > visible:
            rows = rows[:visible]
        strategies_out.append({
            "id": strat,
            "label": sig_scanner._params(strat).get("label", strat),
            "results": rows,
        })
    return {"strategies": strategies_out}


# In-process cache for the price board. Each Binance hit is ~2-3s, so we serve
# the cached value INSTANTLY (stale-while-revalidate): a fresh-enough hit is
# returned as-is, a stale hit is still returned immediately while a single
# background task refreshes it. Only a truly cold cache pays the fetch latency
# (once per symbol-set). This keeps the live board from ever blocking the UI —
# the previous behaviour re-paid the ~3s fetch on every poll once the TTL lapsed.
_PRICE_CACHE: dict[str, tuple[float, dict]] = {}
_PRICE_TTL = 25.0          # seconds before a cached entry is considered stale
_PRICE_REFRESHING: set[str] = set()  # symbol-sets with an in-flight refresh


def _fetch_price_map(pairs: list[str], bases: list[str]) -> dict[str, float]:
    """Blocking exchange fetch → {BASE: price}. Run via threadpool."""
    from app.services import exchange as ex
    px = ex.fetch_prices(pairs)
    out: dict[str, float] = {}
    for b, pair in zip(bases, pairs):
        v = px.get(pair)
        if v:
            out[b] = float(v)
    return out


async def _refresh_prices(key: str, bases: list[str], pairs: list[str]) -> None:
    """Background refresh of one symbol-set; updates the cache, never raises."""
    from fastapi.concurrency import run_in_threadpool
    try:
        out = await run_in_threadpool(_fetch_price_map, pairs, bases)
        if out:
            _PRICE_CACHE[key] = (time.time(), out)
    except Exception:  # noqa: BLE001 — best-effort; keep serving the stale value
        pass
    finally:
        _PRICE_REFRESHING.discard(key)


@router.get("/signals/prices")
async def signals_prices(symbols: str = Query(""), _: str = Depends(current_user)):
    """Real last prices for a comma-separated list of crypto bases (e.g. BTC,ETH).
    Returns {"prices": {"BTC": 67000.0, ...}} via the public exchange ticker.
    Stale-while-revalidate: cached value returned instantly; refreshed in the
    background when stale so the live board never blocks on the exchange."""
    from fastapi.concurrency import run_in_threadpool
    bases = [s.strip().upper() for s in (symbols or "").split(",") if s.strip()][:40]
    if not bases:
        return {"prices": {}}
    key = ",".join(sorted(bases))
    pairs = [f"{b}/USDT" for b in bases]
    hit = _PRICE_CACHE.get(key)
    if hit:
        # Serve cached immediately; kick a single background refresh if stale.
        if (time.time() - hit[0]) >= _PRICE_TTL and key not in _PRICE_REFRESHING:
            _PRICE_REFRESHING.add(key)
            asyncio.create_task(_refresh_prices(key, bases, pairs))
        return {"prices": hit[1]}
    # Cold cache: pay the fetch once so the first caller still gets real numbers.
    try:
        out = await run_in_threadpool(_fetch_price_map, pairs, bases)
    except Exception:  # noqa: BLE001
        out = {}
    if out:
        _PRICE_CACHE[key] = (time.time(), out)
    return {"prices": out}


@router.post("/signals/daily/run")
async def signals_daily_run(_: str = Depends(current_user)):
    """Manual "+" trigger: kick off a fresh scan in the BACKGROUND and return
    immediately, so a slow/heavy scan never blocks or 502s the request."""
    import asyncio
    from app.services.daily_scan import run_scan_now
    asyncio.create_task(run_scan_now())
    return {"started": True, **signals_daily()}


@router.get("/signals/trends")
async def signals_trends(
    buckets: str = "crypto,stocks,metals,commodities",
    crypto_limit: int = Query(default=10, ge=1, le=1000),
    stock_limit: int = Query(default=10, ge=1, le=1000),
    metal_limit: int = Query(default=1000, ge=1, le=1000),
    commodity_limit: int = Query(default=1000, ge=1, le=1000),
    strategy: str = Query(default=sig_scanner.DEFAULT_STRATEGY),
    force: bool = False,
    _: str = Depends(current_user),
):
    """3-color Trend Scanner: per-symbol trend rows + daily Green/Grey/Red history."""
    bucket_list = [b.strip() for b in buckets.split(",") if b.strip() in BUCKET_MAP]
    if not bucket_list:
        raise HTTPException(400, "No valid buckets specified.")
    if not ensure_strategy(strategy):
        raise HTTPException(400, f"Unknown strategy: {strategy}")

    key = f"{','.join(sorted(bucket_list))}|cl={crypto_limit}|sl={stock_limit}|ml={metal_limit}|cdl={commodity_limit}|st={strategy}"
    now = time.time()
    if not force and key in cache.trend_cache and now - cache.trend_cache[key]["ts"] < cache.SCAN_CACHE_TTL:
        return cache.trend_cache[key]["data"]

    data = await sig_scanner.run_trend_scan(
        bucket_list, crypto_limit=crypto_limit, stock_limit=stock_limit,
        metal_limit=metal_limit, commodity_limit=commodity_limit, strategy=strategy,
    )
    cache.trend_cache[key] = {"data": data, "ts": now}
    return data


@router.get("/signals/chart/{bucket}/{symbol:path}")
async def signals_chart(
    bucket: str,
    symbol: str,
    strategy: str = Query(default=sig_scanner.DEFAULT_STRATEGY),
    force: bool = False,
    _: str = Depends(current_user),
):
    if bucket not in BUCKET_MAP:
        raise HTTPException(400, f"Unknown bucket: {bucket}")
    if not ensure_strategy(strategy):
        raise HTTPException(400, f"Unknown strategy: {strategy}")

    key = f"{bucket}:{symbol}:{strategy}"
    now = time.time()
    if not force and key in cache.chart_cache and now - cache.chart_cache[key]["ts"] < cache.CHART_CACHE_TTL:
        return cache.chart_cache[key]["data"]

    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, sig_scanner.get_signal_chart, symbol, bucket, strategy)
    if data is None:
        raise HTTPException(404, f"No data available for {symbol}")
    cache.chart_cache[key] = {"data": data, "ts": now}
    return data


@router.post("/signals/send-telegram")
async def signals_send_telegram(body: SignalsTelegramInput, background_tasks: BackgroundTasks):
    cfg = db.get_telegram_config()
    if not cfg.get("botToken") or not cfg.get("chatId"):
        raise HTTPException(400, "Telegram not configured.")

    async def _send():
        sigs = body.signals
        if not sigs:
            return
        lines = ["📊 *Today's Breakout Signals*\n"]
        tier_emojis = {"breaking_out": "🚀", "near_breakout": "⚡", "in_uptrend": "✅", "building": "📈"}
        for s in sigs:
            em = tier_emojis.get(s.get("tier", ""), "•")
            lines.append(
                f"{em} *{s.get('name', s.get('symbol', '?'))}* ({s.get('bucket', '')})\n"
                f"   {s.get('desc', '')} — {abs(s.get('pctToGreen', 0)):.1f}% "
                f"{'above' if s.get('pctToGreen', 0) <= 0 else 'from'} green zone\n"
            )
        lines.append(f"\n_Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_")
        msg = "\n".join(lines)
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{cfg['botToken']}/sendMessage",
                json={"chat_id": cfg["chatId"], "text": msg, "parse_mode": "Markdown"},
            )
        ok = resp.json().get("ok", False)
        db.update_telegram_send_status(ok, "Signals message sent" if ok else resp.json().get("description", "error"))

    background_tasks.add_task(_send)
    return {"ok": True, "message": "Sending signals to Telegram in background."}


# ─────────────────────────────────────────────────────────────────────────────
# TEMPORARY DIAGNOSTIC — admin-only. REMOVE once the root cause is found.
#
# The daily breakout scan has been failing *before save* on the production VPS
# since 2026-06-25 20:44. We can't read the VPS logs from here, so this endpoint
# runs the failing path SYNCHRONOUSLY on the server and returns the result (incl.
# the full traceback) as JSON. Reachable via the existing /signals/* proxy.
# Read-only probes only — NO money/trade actions. Delete this route afterwards.
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/signals/scan-cache")
def signals_scan_cache(_: str = Depends(require_admin)):
    """INSTANT (<1s), read-only diagnostic — NO live probe, NO fetch. Returns the
    snapshot of the LAST real daily scan pass (resolved exchange, attempted vs
    fetched, a few failure reasons) persisted by run_scan_now, plus the current
    cached-scan meta. This is the safe way to read the numbers when the full
    live probe (/signals/scan-diag?probe=1) exceeds the reverse-proxy timeout
    under prod degradation and 502s. Empty until the first scan runs after deploy;
    a manual "+" scan populates it with the full-500 pass immediately."""
    from app.services.daily_scan import (is_scanning, CRYPTO_LIMIT,
                                          DAILY_PER_SYMBOL_TIMEOUT, DAILY_OVERALL_TIMEOUT)
    from app.data import market_exchange as mx
    snap = db._get_singleton("scan_diag_last", None)
    d = db.get_daily_scan() or {}
    cached_sigs = d.get("signals", []) or []
    longs = [s for s in cached_sigs
             if s.get("direction") == "long" and float(s.get("currentPrice") or 0) > 0]
    # Live in-memory snapshot too (this process's last pass) — may be fresher than
    # the persisted one if a scan just ran; both are shown so nothing is hidden.
    try:
        live = dict(sig_scanner._LAST_CRYPTO_FETCH)
    except Exception:  # noqa: BLE001
        live = None
    # Echo the LIVE fetch-tuning knobs so a re-tune can be CONFIRMED deployed before
    # spending minutes on a scan (each iteration changes these). Read straight from
    # the running modules — if these match the just-pushed values, the new code is
    # live; if not, the deploy hasn't recreated the container yet.
    tuning = {
        "universe": CRYPTO_LIMIT,
        "concurrency": sig_scanner.CRYPTO_FETCH_CONCURRENCY,
        "fetchTimeoutMs": mx._FETCH_TIMEOUT_MS,
        "rateGateIntervalSec": mx._MIN_REQUEST_INTERVAL,
        "dailyPerSymbolTimeout": DAILY_PER_SYMBOL_TIMEOUT,
        "dailyOverallTimeout": DAILY_OVERALL_TIMEOUT,
    }
    return {
        "targetUniverse": CRYPTO_LIMIT,
        "tuning": tuning,                 # live fetch-tuning knobs (confirm deploy)
        "lastDailyFetch": snap,          # persisted (survives restart)
        "liveMemSnapshot": live,          # this process, since last restart
        "cache": {
            "lastScanAt": d.get("ranAt"),
            "nextScanAt": d.get("nextAt"),
            "scanning": is_scanning(),
            "signals": len(cached_sigs),
            "longCount": len(longs),
        },
    }


@router.get("/signals/scan-diag")
async def signals_scan_diag(probe: bool = False, _: str = Depends(require_admin)):
    """Admin diagnostic for the crypto data layer.

    DEFAULT (``probe=false``): INSTANT — returns ONLY cached data (same as
    /signals/scan-cache), NO live probe, so it can never 502. Pass ``?probe=1``
    to additionally run the HARD-BOUNDED live probe + sample fetch below (each
    step carries its own deadline; anything past it is reported as a timeout).
    The live probe is opt-in precisely because under prod degradation it can still
    approach the reverse-proxy timeout."""
    import asyncio
    import traceback
    from fastapi.concurrency import run_in_threadpool
    from app.data import market_exchange as mx

    # Always-instant cached view first (never 502s). The live probe only augments
    # this when explicitly requested.
    if not probe:
        result = {"probe": False}
        result["lastDailyFetch"] = db._get_singleton("scan_diag_last", None)
        try:
            result["liveMemSnapshot"] = dict(sig_scanner._LAST_CRYPTO_FETCH)
        except Exception:  # noqa: BLE001
            result["liveMemSnapshot"] = None
        from app.services.daily_scan import is_scanning
        d = db.get_daily_scan() or {}
        cs = d.get("signals", []) or []
        result["cache"] = {"lastScanAt": d.get("ranAt"), "nextScanAt": d.get("nextAt"),
                           "scanning": is_scanning(), "signals": len(cs)}
        return result

    def _probe_exchanges() -> dict:
        """Per-exchange reachability + resolver pick. Blocking → run in threadpool.

        Each exchange gets its OWN try/except so one failure can't abort the rest.
        We do ONE cheap public call (fetch_ticker BTC/USDT) on a fresh client with
        a short timeout — the same public-data path the real scan exercises."""
        out: dict = {"exchanges": [], "resolved": None}
        import ccxt

        for ex_id in mx._EXCHANGE_PRIORITY:
            rec = {"exchange": ex_id, "ok": False, "error": None}
            try:
                klass = getattr(ccxt, ex_id)
                # Short 4s timeout so 5 down exchanges still total ~20s worst case.
                ex = klass({"enableRateLimit": True, "timeout": 4000})
                ex.fetch_ticker("BTC/USDT")
                rec["ok"] = True
            except Exception as exc:  # noqa: BLE001 — capture, never abort the loop
                rec["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
            out["exchanges"].append(rec)

        # Which exchange the data layer actually picks (force a fresh probe).
        try:
            out["resolved"] = mx.resolve_market_exchange_id(force=True)
        except Exception as exc:  # noqa: BLE001
            out["resolved"] = f"{type(exc).__name__}: {str(exc)[:300]}"
        return out

    # Bound the (blocking) probe so a hanging exchange can't stall the request.
    try:
        result = await asyncio.wait_for(run_in_threadpool(_probe_exchanges), timeout=35.0)
    except asyncio.TimeoutError:
        result = {"exchanges": [], "resolved": "timeout (probe deadline)",
                  "probeTimedOut": True}

    # Sample fetch at a MODERATE limit under the live concurrency, so we can see
    # how many bulk OHLCV fetches succeed vs fail and the distinct error strings
    # behind the failures. A healthy layer shows fetchOk≈attempted; the degraded
    # mode shows attempted≫fetchOk with throttling/timeout errors. diag_crypto_fetch
    # is itself hard-bounded, so this can't hang.
    scan = {"ok": False, "count": 0, "error": None,
            "attempted": 0, "fetchOk": 0, "fetchFail": 0, "fetchErrors": [],
            "concurrency": None, "timedOut": False}
    try:
        fetch = await sig_scanner.diag_crypto_fetch(
            limit=40, per_symbol_timeout=8.0, overall_timeout=30.0)
        scan["attempted"] = fetch["attempted"]
        scan["fetchOk"] = fetch["ok"]
        scan["fetchFail"] = fetch["fail"]
        scan["fetchErrors"] = fetch["errors"]
        scan["concurrency"] = fetch["concurrency"]
        scan["timedOut"] = fetch.get("timedOut", False)
        scan["ok"] = True
        scan["count"] = fetch["ok"]
    except Exception:  # noqa: BLE001 — surface the real cause, don't swallow it
        scan["error"] = traceback.format_exc()
    result["scan"] = scan
    # The live daily scan's last-pass snapshot (attempted/ok/fail + resolved
    # exchange + a couple of failure reasons) — the SAME numbers the daily logger
    # emits, so the full-universe pass is visible here too, not just this sample.
    try:
        result["lastDailyFetch"] = dict(sig_scanner._LAST_CRYPTO_FETCH)
    except Exception:  # noqa: BLE001
        result["lastDailyFetch"] = None

    # Current cached daily-scan meta (read-only).
    from app.services.daily_scan import is_scanning
    d = db.get_daily_scan() or {}
    cached_sigs = d.get("signals", []) or []
    longs = [s for s in cached_sigs
             if s.get("direction") == "long" and float(s.get("currentPrice") or 0) > 0]
    result["cache"] = {
        "lastScanAt": d.get("ranAt"),
        "ranAt": d.get("ranAt"),
        "nextAt": d.get("nextAt"),
        "scanning": is_scanning(),
        "signals": len(cached_sigs),
        "top10": len(longs[:10]),
    }
    return result
