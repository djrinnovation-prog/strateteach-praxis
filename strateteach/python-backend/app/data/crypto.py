"""Crypto OHLCV data fetcher using CCXT (Binance, with geo-block fallback)."""
from __future__ import annotations
import logging
from typing import Optional
import pandas as pd

logger = logging.getLogger(__name__)

TIMEFRAME_MAP = {
    "1d": "1d",
    "4h": "4h",
}


def _page_ohlcv(exchange, symbol: str, tf: str, since: Optional[int]) -> list:
    """Page through OHLCV bars from a single built exchange client.

    Returns the (possibly empty) list of raw bar rows. Any exchange error
    propagates to the caller so the fallback cascade can move to the next source.

    Each outbound request passes the shared aggregate rate gate so concurrent scan
    threads don't collectively hammer the exchange into throttling (the per-client
    ccxt rate limiter can't see the other threads).
    """
    from app.data.market_exchange import rate_gate

    all_bars: list = []
    since_cursor = since
    while True:
        rate_gate()
        bars = exchange.fetch_ohlcv(symbol, tf, since=since_cursor, limit=1000)
        if not bars:
            break
        all_bars.extend(bars)
        if len(bars) < 1000:
            break
        since_cursor = bars[-1][0] + 1
        if len(all_bars) >= 5000:
            break
    return all_bars


def fetch_crypto_ohlcv(
    symbol: str,
    timeframe: str = "1d",
    start_date: Optional[str] = None,
    limit: int = 1000,
    raise_errors: bool = False,
) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV data for a crypto pair using CCXT, with a per-symbol fallback
    cascade across exchanges. Symbol format: "BTC/USDT".

    The coin universe is cached for 24h but the resolved exchange is re-probed
    every 30 min, so the two drift: a symbol that exists in the cached universe
    can be ABSENT on the currently-resolved exchange and would otherwise fail.
    To fix that lockstep drift we try the resolved/primary exchange first and
    then fall through the remaining reachable exchanges (the existing
    ``market_exchange`` priority list) until one returns bars. Built clients are
    briefly cached per thread to avoid rebuilding one per symbol.

    ``raise_errors=True`` re-raises the underlying exception instead of swallowing
    it to None — but ONLY after every fallback has failed (used by the caller-side
    retry so a transient rate-limit/timeout can be retried, and by
    /signals/scan-diag to surface the real error string). When the symbol is
    simply absent everywhere (no bars, no error) we return None even under
    ``raise_errors`` — same as before.
    """
    from app.data.market_exchange import fallback_exchange_ids, get_cached_exchange

    tf = TIMEFRAME_MAP.get(timeframe, "1d")
    ex_ids = fallback_exchange_ids()
    if not ex_ids:
        logger.warning("No reachable crypto exchange for %s", symbol)
        return None

    last_exc: Optional[Exception] = None
    for ex_id in ex_ids:
        exchange = get_cached_exchange(ex_id)
        if exchange is None:
            continue
        try:
            since = None
            if start_date:
                since = exchange.parse8601(f"{start_date}T00:00:00Z")
            all_bars = _page_ohlcv(exchange, symbol, tf, since)
        except Exception as e:  # noqa: BLE001 — try the next exchange in the cascade
            last_exc = e
            logger.warning("CCXT fetch failed for %s on %s: %s", symbol, ex_id, e)
            continue

        if not all_bars:
            # Symbol absent / no bars on this source — fall through to the next.
            continue

        df = pd.DataFrame(all_bars, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df = df.set_index("timestamp").sort_index()
        df.index = df.index.tz_localize(None)
        df = df[~df.index.duplicated(keep="first")]
        return df[["open", "high", "low", "close", "volume"]]

    # Every fallback exhausted. Surface the real error if one occurred and the
    # caller asked for it; otherwise (symbol simply absent everywhere) return None.
    if raise_errors and last_exc is not None:
        raise last_exc
    return None
