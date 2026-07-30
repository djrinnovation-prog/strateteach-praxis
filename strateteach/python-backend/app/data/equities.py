"""Equity and commodity OHLCV data fetcher using yfinance."""
from __future__ import annotations
import logging
from typing import Optional
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

_BATCH_CHUNK = 100   # symbols per yfinance download call


# ── Stooq fallback (free, no API key) ────────────────────────────────────────
# yfinance is the primary equity source; when it returns empty/None or raises we
# fall back to Stooq so a single flaky source can't fail an otherwise-valid
# symbol. Stooq is daily-only, so the fallback only applies to daily ("1d") data.

def _stooq_symbol(symbol: str) -> Optional[str]:
    """Map a yfinance ticker to a Stooq symbol, or None when no reliable mapping
    exists (so the caller can skip the fallback and still surface the real error).

    US stocks/ETFs map to ``<ticker>.us``. Futures (``=F``), indices (``^``),
    forex/odd tickers, and dotted/dashed symbols are NOT reliably mapped on Stooq
    — best-effort means: skip them rather than fetch the wrong instrument.
    """
    s = (symbol or "").strip()
    if not s:
        return None
    # Plain alphanumeric tickers only (AAPL, MSFT, SPY). Anything with =, ^, ., -
    # (futures, indices, class shares, forex) has an unreliable Stooq mapping.
    if not s.isalnum():
        return None
    return f"{s.lower()}.us"


def _stooq_csv(stooq_symbol: str) -> Optional[pd.DataFrame]:
    """Direct CSV download from Stooq (used when ``pandas_datareader`` is absent).

    Returns a raw DataFrame indexed by ``Date`` with Open/High/Low/Close/Volume
    columns, or None on any error / empty response.
    """
    import urllib.request
    from io import StringIO

    url = f"https://stooq.com/q/d/l/?s={stooq_symbol}&i=d"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        logger.debug("Stooq CSV fetch failed for %s: %s", stooq_symbol, exc)
        return None
    # Stooq returns "No data" / an HTML page when the symbol is unknown.
    if not data or "Date" not in data.splitlines()[0]:
        return None
    try:
        df = pd.read_csv(StringIO(data))
    except Exception:  # noqa: BLE001
        return None
    if df.empty or "Date" not in df.columns:
        return None
    return df.set_index("Date")


def _fetch_stooq_ohlcv(
    symbol: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> Optional[pd.DataFrame]:
    """Fetch daily OHLCV from Stooq, normalized to the same shape yfinance yields
    (DatetimeIndex, lowercase open/high/low/close/volume). None if unavailable."""
    stq = _stooq_symbol(symbol)
    if stq is None:
        return None

    raw = None
    # Prefer pandas_datareader when installed; otherwise the direct CSV endpoint.
    try:
        from pandas_datareader import data as pdr  # type: ignore

        got = pdr.DataReader(stq, "stooq", start=start_date, end=end_date)
        if got is not None and not got.empty:
            raw = got
    except Exception as exc:  # noqa: BLE001 — not installed / network / bad symbol
        logger.debug("pandas_datareader stooq failed for %s (%s): %s", symbol, stq, exc)
    if raw is None:
        raw = _stooq_csv(stq)
    if raw is None or raw.empty:
        return None

    df = raw.copy()
    df.columns = [str(c).lower() for c in df.columns]
    for col in ("open", "high", "low", "close"):
        if col not in df.columns:
            return None  # not a usable OHLC frame
    if "volume" not in df.columns:
        df["volume"] = 0.0
    df = df[["open", "high", "low", "close", "volume"]]

    df.index = pd.to_datetime(df.index, errors="coerce")
    df = df[df.index.notna()]
    if getattr(df.index, "tz", None) is not None:
        df.index = df.index.tz_localize(None)
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="first")].dropna(how="all")

    if start_date:
        df = df[df.index >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df.index <= pd.to_datetime(end_date)]
    return df if not df.empty else None


def fetch_equity_batch_ohlcv(
    symbols: list[str],
    start_date: str = "2024-01-01",
) -> dict[str, pd.DataFrame]:
    """
    Batch-download daily OHLCV for a list of equity/ETF/futures symbols.
    Returns a dict {symbol: DataFrame}. Missing or invalid symbols are skipped.
    Uses chunked yfinance.download for speed (one network round-trip per 100 tickers).
    """
    result: dict[str, pd.DataFrame] = {}

    for i in range(0, len(symbols), _BATCH_CHUNK):
        chunk = symbols[i : i + _BATCH_CHUNK]
        try:
            raw = yf.download(
                chunk,
                start=start_date,
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
            if raw is None or raw.empty:
                continue

            # When chunk has a single ticker yfinance drops the ticker level
            if len(chunk) == 1:
                sym = chunk[0]
                try:
                    df = raw.rename(columns=str.lower)
                    if df.index.tz is not None:
                        df.index = df.index.tz_localize(None)
                    df = df[["open", "high", "low", "close", "volume"]].dropna(how="all")
                    if len(df) >= 60:
                        result[sym] = df
                except Exception as exc:
                    logger.debug("Single-ticker parse failed %s: %s", sym, exc)
            else:
                for sym in chunk:
                    try:
                        df = raw[sym].rename(columns=str.lower)
                        if df.index.tz is not None:
                            df.index = df.index.tz_localize(None)
                        df = df[["open", "high", "low", "close", "volume"]].dropna(how="all")
                        if len(df) >= 60:
                            result[sym] = df
                    except Exception:
                        pass  # symbol not in batch result

        except Exception as exc:
            logger.warning("Batch download chunk[%d] failed: %s", i, exc)

    # Stooq fallback for symbols yfinance returned nothing usable for. Best-effort
    # and per-symbol: a mappable US stock/ETF that yfinance dropped (flaky source,
    # transient block) can still come back via Stooq. Unmappable symbols (futures,
    # indices) are simply skipped — the scan handles a missing symbol as before.
    missing = [s for s in symbols if s not in result]
    for sym in missing:
        try:
            df = _fetch_stooq_ohlcv(sym, start_date=start_date)
            if df is not None and len(df) >= 60:
                result[sym] = df
        except Exception as exc:  # noqa: BLE001 — never let the fallback fail the batch
            logger.debug("Stooq fallback failed for %s: %s", sym, exc)

    return result

TIMEFRAME_MAP = {
    "1d": "1d",
    "4h": "1h",  # yfinance doesn't have 4h, use 1h and resample
}


def fetch_equity_ohlcv(
    symbol: str,
    timeframe: str = "1d",
    start_date: Optional[str] = "2015-01-01",
    end_date: Optional[str] = None,
    raise_errors: bool = False,
) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV data for stocks, ETFs, and commodity futures using yfinance,
    falling back to Stooq (free, no API key) when yfinance returns nothing usable.

    Stooq is daily-only, so the fallback only applies to ``timeframe="1d"``.
    ``raise_errors=True`` re-raises the REAL underlying error when BOTH sources
    fail, so the backtest can report it per symbol instead of collapsing every
    failure to a generic "Insufficient data". Default (``False``) preserves the
    swallow-to-None behavior the daily scan relies on.
    """
    yf_error: Optional[Exception] = None
    try:
        tf = TIMEFRAME_MAP.get(timeframe, "1d")
        ticker = yf.Ticker(symbol)

        kwargs: dict = {"interval": tf, "auto_adjust": True}
        if start_date:
            kwargs["start"] = start_date
        if end_date:
            kwargs["end"] = end_date

        df = ticker.history(**kwargs)
        if df is not None and not df.empty:
            df.columns = [c.lower() for c in df.columns]
            df = df[["open", "high", "low", "close", "volume"]].dropna()

            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)

            # Resample 1h → 4h if needed
            if timeframe == "4h" and tf == "1h":
                df = df.resample("4h").agg({
                    "open": "first", "high": "max",
                    "low": "min", "close": "last", "volume": "sum"
                }).dropna()

            df = df.sort_index()
            df = df[~df.index.duplicated(keep="first")]
            if not df.empty:
                return df
    except Exception as e:
        yf_error = e
        logger.warning(f"yfinance fetch failed for {symbol}: {e}")

    # yfinance returned empty/None or raised → try the Stooq fallback (daily only).
    if timeframe == "1d":
        try:
            sdf = _fetch_stooq_ohlcv(symbol, start_date=start_date, end_date=end_date)
        except Exception as exc:  # noqa: BLE001
            sdf = None
            logger.debug("Stooq fallback errored for %s: %s", symbol, exc)
        if sdf is not None and not sdf.empty:
            logger.info("Equity %s served from Stooq fallback", symbol)
            return sdf

    # Both sources failed. Surface the REAL yfinance error when asked; otherwise
    # keep the historical swallow-to-None contract for the daily scan.
    if raise_errors and yf_error is not None:
        raise yf_error
    return None
