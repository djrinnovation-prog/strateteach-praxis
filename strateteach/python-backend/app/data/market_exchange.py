"""Resolve a working public CCXT exchange for crypto market data.

Binance is the preferred source, but it returns HTTP 451 ("restricted location")
from some deployment regions (e.g. the published app's region). When that happens
the daily scanner has no crypto data and users see empty results. To stay resilient
we probe a prioritized list of public exchanges that all expose `BASE/USDT` spot
symbols + public tickers/OHLCV, and cache the *id* of the first reachable one.

We cache the resolved exchange **id** (a string), not a shared client instance:
each caller gets a FRESH instance via ``get_market_exchange()``. The scan fans out
crypto fetches across many threads, and a synchronous CCXT client is not a safe
shared object — a fresh instance per call mirrors the original behavior and avoids
cross-thread state/rate-limit contention.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Priority order. All expose unified "BASE/USDT" spot symbols + public data.
# - binance: preferred (full universe ~400+ USDT pairs), but geo-blocked (451)
#   from some deployment regions (e.g. the published app's region).
# - gate / kucoin: globally reachable AND broad coverage (gate ~2000, kucoin
#   ~900 USDT pairs), so when binance is blocked they best preserve the coin
#   universe the daily scanner ranks by volume.
# - binanceus: same symbol format and reachable from US regions, but a much
#   thinner universe (~200 USDT pairs) — kept only as a deeper fallback so prod
#   never collapses to its limited US listing while gate/kucoin are reachable.
# - kraken: last resort (very few USDT pairs).
#
# NOTE: the ccxt id for Gate.io is "gate" in this ccxt version — "gateio" raises
# "module 'ccxt' has no attribute 'gateio'" (confirmed via /signals/scan-diag),
# which silently broke the binance→gate fallback. Use "gate".
_EXCHANGE_PRIORITY = ["binance", "gate", "kucoin", "binanceus", "kraken"]

_RESOLVE_TTL = 30 * 60  # re-probe a healthy source at most every 30 min
_FAILURE_BACKOFF = 120  # after a total failure, suppress re-probing for 2 min

_lock = threading.Lock()
_resolved_id: Optional[str] = None
_resolved_ts: float = 0.0
_failed: bool = False  # True when the last resolution found nothing reachable

# Brief, THREAD-LOCAL cache of built CCXT clients keyed by exchange id. The
# per-symbol fallback cascade (see crypto.fetch_crypto_ohlcv) may touch several
# exchanges per symbol and many symbols per thread; caching avoids rebuilding a
# client for every (symbol, exchange) pair. It is thread-local on purpose — a
# synchronous CCXT client is NOT safe to share across threads (see module
# docstring), so each scan/backtest worker reuses only its own instances.
_CLIENT_TTL = 60  # seconds
_client_cache = threading.local()

# Per-request timeout for OHLCV fetch clients.
#
# RE-TUNED UP (was 8000): prod scan-cache proved binance is REACHABLE but SLOW —
# ~95% of fetches were "timeout (per-symbol deadline)", zero 429/connection errors.
# An 8s cut was BELOW binance's real per-request latency from prod's egress, so it
# killed slow-but-successful fetches (count fell 49→25). We give each request 20s
# to complete; the per-symbol deadline in the daily scan is raised above this so
# the client timeout — not the outer bound — governs. Resolver/load_markets keeps
# the 15s default (heavier one-off call, on its own path).
_FETCH_TIMEOUT_MS = 20000

# ── Shared aggregate rate gate ────────────────────────────────────────────────
# ccxt's enableRateLimit only paces requests within ONE client instance. The scan
# fans out across many worker threads, each with its OWN thread-local client, so N
# concurrent clients issue ~N× the intended rate and trip exchange-side throttling
# (HTTP 429 / read timeouts) — which is exactly what collapsed the prod scan to a
# ~49-of-500 partial fetch. This module-level gate enforces a MINIMUM interval
# between ANY two outbound market-data requests across ALL threads, so the
# aggregate rate is capped regardless of concurrency. Each caller is handed a
# spaced "slot" under the lock, then sleeps to it OUTSIDE the lock, so network I/O
# still overlaps — we cap the request RATE, not parallelism.
_RATE_LOCK = threading.Lock()
_rate_next_slot: float = 0.0
# ~20 requests/sec aggregate. LOOSENED (was 0.15 ≈ 7/s): prod showed the fetch is
# latency-bound, not throttle-bound (zero 429s), so a tight rate cap only starved
# throughput. This is now a light SAFETY ceiling (well under binance's low-weight
# OHLCV allowance) that won't bite at the current concurrency, kept only so a
# future concurrency bump can't accidentally hammer the exchange.
_MIN_REQUEST_INTERVAL = 0.05


def rate_gate() -> None:
    """Block until this thread's spaced request slot, capping the AGGREGATE
    outbound market-data request rate across all scan/backtest threads."""
    global _rate_next_slot
    with _RATE_LOCK:
        now = time.monotonic()
        slot = _rate_next_slot if _rate_next_slot > now else now
        _rate_next_slot = slot + _MIN_REQUEST_INTERVAL
    delay = slot - time.monotonic()
    if delay > 0:
        time.sleep(delay)


def _build(exchange_id: str, timeout_ms: int = 15000):
    import ccxt

    klass = getattr(ccxt, exchange_id)
    # Default 15s per-request timeout so a slow/blocked exchange can't hang a
    # worker; OHLCV fetch clients pass the shorter _FETCH_TIMEOUT_MS.
    return klass({"enableRateLimit": True, "timeout": timeout_ms})


def resolve_market_exchange_id(force: bool = False) -> Optional[str]:
    """Return the id of a reachable public exchange, or None if none work.

    Probes each candidate with ``load_markets()`` and caches the id of the first
    success for ``_RESOLVE_TTL``. A total failure is cached too, suppressing
    re-probes for ``_FAILURE_BACKOFF`` seconds so an outage can't cause a probe
    storm under the multi-threaded scan.
    """
    global _resolved_id, _resolved_ts, _failed
    now = time.time()
    with _lock:
        if not force:
            if _resolved_id is not None and now - _resolved_ts < _RESOLVE_TTL:
                return _resolved_id
            if _failed and now - _resolved_ts < _FAILURE_BACKOFF:
                return None

        for ex_id in _EXCHANGE_PRIORITY:
            try:
                ex = _build(ex_id)
                ex.load_markets()
                _resolved_id = ex_id
                _resolved_ts = now
                _failed = False
                logger.info("Crypto market data source resolved: %s", ex_id)
                return ex_id
            except Exception as exc:  # noqa: BLE001 - probe, any failure = skip
                logger.warning(
                    "Exchange %s unavailable: %s", ex_id, str(exc)[:160]
                )
                continue

        _resolved_id = None
        _resolved_ts = now
        _failed = True
        logger.error("No crypto market-data exchange is reachable")
        return None


def get_market_exchange(force: bool = False):
    """Return a FRESH reachable CCXT exchange instance, or None.

    The resolved exchange id is cached (see ``resolve_market_exchange_id``); only
    the lightweight instance construction happens per call. Callers must not share
    the returned instance across threads — request one per use.
    """
    ex_id = resolve_market_exchange_id(force=force)
    if ex_id is None:
        return None
    try:
        return _build(ex_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to build exchange %s: %s", ex_id, str(exc)[:160])
        return None


def get_cached_exchange(exchange_id: str):
    """Return a built CCXT client for ``exchange_id`` from a brief thread-local
    cache, or None if construction fails.

    Reuses a per-thread instance for up to ``_CLIENT_TTL`` seconds so the
    per-symbol crypto fallback cascade doesn't rebuild a client for every symbol.
    """
    store = getattr(_client_cache, "clients", None)
    if store is None:
        store = {}
        _client_cache.clients = store
    now = time.time()
    entry = store.get(exchange_id)
    if entry is not None:
        client, ts = entry
        if now - ts < _CLIENT_TTL:
            return client
    try:
        # Short fetch-timeout client (these instances only serve OHLCV fetches).
        client = _build(exchange_id, timeout_ms=_FETCH_TIMEOUT_MS)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to build exchange %s: %s", exchange_id, str(exc)[:160])
        return None
    store[exchange_id] = (client, now)
    return client


def fallback_exchange_ids() -> list[str]:
    """Priority-ordered exchange ids for the per-symbol crypto fallback cascade.

    The resolved/primary source comes first (so the happy path is identical to
    before — a symbol present on the resolved exchange returns its bars without
    ever touching a fallback), followed by the remaining exchanges from
    ``_EXCHANGE_PRIORITY``. Returns ``[]`` when nothing is reachable (or during
    the failure-backoff window), preserving the previous "no exchange → None"
    behavior and avoiding probe storms.
    """
    primary = resolve_market_exchange_id()
    if primary is None:
        return []
    ordered = [primary]
    ordered.extend(ex_id for ex_id in _EXCHANGE_PRIORITY if ex_id != primary)
    return ordered


def market_exchange_id() -> Optional[str]:
    """Id of the currently-resolved exchange without forcing a probe."""
    return _resolved_id
