"""
Live breakout scanner — runs the Gaussian channel on current market data
and classifies every symbol as green (uptrend), red (downtrend), or gray (neutral).
"""
from __future__ import annotations
import asyncio
import logging
import math
import time as _time
from concurrent.futures import ThreadPoolExecutor
from math import comb
from typing import List, Optional, Tuple

import numpy as np
import pandas as pd

from app.data.crypto import fetch_crypto_ohlcv
from app.data.equities import fetch_equity_ohlcv
from app.data.symbols import BUCKET_MAP, COMMODITIES_SYMBOLS, METALS_SYMBOLS

logger = logging.getLogger(__name__)

# ── Hardcoded fallback / default symbols per bucket ───────────────────────────
# Stocks bucket uses the dynamic stock_universe — these are the fallback top-10.
SCAN_SYMBOLS: dict[str, list[tuple[str, str]]] = {
    "crypto": [
        ("BTC/USDT", "Bitcoin"),
        ("ETH/USDT", "Ethereum"),
        ("SOL/USDT", "Solana"),
        ("BNB/USDT", "BNB"),
        ("XRP/USDT", "XRP"),
        ("AVAX/USDT", "Avalanche"),
        ("LINK/USDT", "Chainlink"),
        ("ADA/USDT", "Cardano"),
        ("DOGE/USDT", "Dogecoin"),
        ("DOT/USDT", "Polkadot"),
    ],
    "stocks": [
        ("AAPL",  "Apple"),
        ("MSFT",  "Microsoft"),
        ("NVDA",  "NVIDIA"),
        ("GOOGL", "Alphabet"),
        ("AMZN",  "Amazon"),
        ("META",  "Meta"),
        ("TSLA",  "Tesla"),
        ("AVGO",  "Broadcom"),
        ("AMD",   "AMD"),
        ("JPM",   "JPMorgan Chase"),
    ],
    # Metals & commodities reference the SINGLE canonical universe defined in
    # app.data.symbols (METALS_SYMBOLS / COMMODITIES_SYMBOLS) — the SAME lists the
    # backtest draws from — so the live scan and the backtest always cover exactly
    # the same symbols (a symbol can never appear in one but be missing from the
    # other). Edit those lists in symbols.py to change both at once.
    "metals": METALS_SYMBOLS,
    "commodities": COMMODITIES_SYMBOLS,
}

# Stablecoins (and fiat-pegged tokens) whose base is pegged to a currency.
# A Gaussian-channel "breakout" on a ~$1 peg is meaningless, so these bases are
# excluded from the dynamic crypto universe — this single chokepoint feeds both
# the live daily scanner and the backtest crypto universe.
STABLECOIN_BASES: frozenset[str] = frozenset({
    "USDC", "BUSD", "DAI", "TUSD", "USDP", "USDD", "FDUSD", "GUSD", "FRAX",
    "LUSD", "USDN", "UST", "USTC", "PYUSD", "USDJ", "SUSD", "MIM", "USDE",
    "CUSD", "OUSD", "USDK", "HUSD", "GHO", "USD0", "USDX", "USDS", "XUSD",
    "CRVUSD", "USDT", "EURT", "EURS", "EURI", "AEUR", "EURC", "USDB", "USD1",
    # newer USD/EUR pegs seen in the wild
    "RLUSD", "BFUSD", "USDY", "USDR", "USDM", "USDG", "USDL", "USDF", "USDO",
    "USR", "SUSDE", "DEUSD", "USD0PP", "USDQ", "USDTB", "DOLA", "BOLD",
    "EURQ", "EUROE", "EURR", "VEUR", "VCHF", "XEUR",
})


def _is_stablecoin_base(base: str) -> bool:
    """True if the base asset of a /USDT pair is itself a stablecoin/fiat peg."""
    return base.upper() in STABLECOIN_BASES


# ── Dynamic crypto universe (loaded from Binance, cached 24 hr) ───────────────
_crypto_universe: list[tuple[str, str]] = []
_crypto_universe_ts: float = 0.0
_crypto_universe_exchange_id: str | None = None
_UNIVERSE_TTL = 24 * 3600


def clear_crypto_universe_cache() -> None:
    """Drop the cached crypto universe so the next scan rebuilds it from the
    freshly-resolved exchange. Used by the manual /system/resync endpoint."""
    global _crypto_universe, _crypto_universe_ts, _crypto_universe_exchange_id
    _crypto_universe = []
    _crypto_universe_ts = 0.0
    _crypto_universe_exchange_id = None


def _fetch_top_crypto_universe() -> list[tuple[str, str]]:
    """Return all USDT pairs sorted by 24-h quote volume, from the resolved
    market exchange. Cached 24 hr, but invalidated if the exchange source changes
    (so universe symbols always match the exchange used for OHLCV)."""
    global _crypto_universe, _crypto_universe_ts, _crypto_universe_exchange_id
    now = _time.time()
    try:
        from app.data.market_exchange import get_market_exchange, resolve_market_exchange_id
        ex_id = resolve_market_exchange_id()
        if ex_id is None:
            logger.warning("No reachable crypto exchange; using fallback universe")
            return SCAN_SYMBOLS["crypto"]
        if (
            _crypto_universe
            and now - _crypto_universe_ts < _UNIVERSE_TTL
            and _crypto_universe_exchange_id == ex_id
        ):
            return _crypto_universe
        exchange = get_market_exchange()
        if exchange is None:
            logger.warning("No reachable crypto exchange; using fallback universe")
            return SCAN_SYMBOLS["crypto"]
        tickers = exchange.fetch_tickers()
        usdt = [
            (sym, sym.replace("/USDT", ""))
            for sym, t in tickers.items()
            if sym.endswith("/USDT")
            and (t.get("quoteVolume") or 0) > 0
            and not _is_stablecoin_base(sym.replace("/USDT", ""))
        ]
        usdt.sort(key=lambda p: tickers[p[0]].get("quoteVolume", 0) or 0, reverse=True)
        if not usdt:
            logger.warning("Crypto universe empty from %s; using fallback", getattr(exchange, "id", "?"))
            return SCAN_SYMBOLS["crypto"]
        _crypto_universe = usdt
        _crypto_universe_ts = now
        _crypto_universe_exchange_id = ex_id
        logger.info("Loaded crypto universe: %d USDT pairs from %s", len(usdt), ex_id)
        return usdt
    except Exception as exc:
        logger.warning("Failed to load crypto universe: %s", exc)
        return SCAN_SYMBOLS["crypto"]


def get_crypto_symbols_for_limit(n: int) -> list[tuple[str, str]]:
    """Return up to `n` crypto symbols, using dynamic universe if n > fallback list size."""
    if n <= len(SCAN_SYMBOLS["crypto"]):
        return SCAN_SYMBOLS["crypto"][:n]
    universe = _fetch_top_crypto_universe()
    return universe[:n]


def get_top_crypto_by_volume(n: int) -> list[tuple[str, str]]:
    """Return the top `n` crypto symbols ranked by 24-h quote volume.

    Always uses the dynamic volume-ranked universe (falling back to the static
    list only when no exchange is reachable). Unlike ``get_crypto_symbols_for_limit``
    this never short-circuits to the static list for small `n`."""
    universe = _fetch_top_crypto_universe()
    return universe[:max(1, n)]


# ── Gaussian channel helpers ──────────────────────────────────────────────────
DEFAULT_POLES = 6
DEFAULT_PERIOD = 147
DEFAULT_MULT = 1.414

# ── Strategy variants for the daily scanner ──────────────────────────────────
# The scanner is its own (lightweight) source of truth. Each strategy mirrors the
# Gaussian-channel *indicator* of the matching backtest strategy (price source +
# sampling period) and whether it trades shorts. The heavy per-bar confirmation
# filters (ADX/RSI/regime) used by the backtests are intentionally omitted here so
# the scanner stays fast across large universes — consistent with the scanner
# already omitting bot8c's ADX/SMA filters.
#   • bot8c → strategy.py:        ohlc4 source, period 147, long+short
#   • bot4  → strategy_bot4.py:   hlc3  source, period 147, long+short
#   • bot1  → strategy_bot1.py:   hlc3  source, period 143, LONG-only
STRATEGY_PARAMS: dict[str, dict] = {
    "bot8c": {"source": "ohlc4", "period": 147, "allow_short": True,  "label": "BOT(8C)-770"},
    "bot4":  {"source": "hlc3",  "period": 147, "allow_short": True,  "label": "BOT4-770"},
    "bot1":  {"source": "hlc3",  "period": 143, "allow_short": False, "label": "BOT1-770"},
}
DEFAULT_STRATEGY = "bot8c"

# Dynamically-registered saved strategies (keyed by "saved_<id>"). These are
# user-defined bots saved from the Strategy Lab. They reuse the same Gaussian
# channel engine; only the params the engine supports (source/period/poles/mult
# and whether shorts are surfaced) are honored — any other Pine logic does not
# run. main.py populates this from the DB before a scan via register_saved_strategy.
SAVED_STRATEGY_PARAMS: dict[str, dict] = {}


def register_saved_strategy(key: str, config: dict) -> dict:
    """Map a saved-strategy config (StrategyConfig dump) → scanner params.

    Price source is not stored on saved configs, so it is derived from the base
    bot (bot8c→ohlc4, bot4/bot1→hlc3). period/poles/mult come from the saved
    config; shorts are surfaced when the saved config enables them.
    """
    base = config.get("strategyId") or DEFAULT_STRATEGY
    base_params = STRATEGY_PARAMS.get(base, STRATEGY_PARAMS[DEFAULT_STRATEGY])
    try:
        period = int(config.get("samplingPeriod") or base_params["period"])
    except (TypeError, ValueError):
        period = base_params["period"]
    try:
        poles = int(config.get("poles") or DEFAULT_POLES)
    except (TypeError, ValueError):
        poles = DEFAULT_POLES
    try:
        mult = float(config.get("ftrMultiplier") or DEFAULT_MULT)
    except (TypeError, ValueError):
        mult = DEFAULT_MULT
    params = {
        "source": base_params["source"],
        "period": period,
        "allow_short": bool(config.get("enableShorts", base_params["allow_short"])),
        "poles": poles,
        "mult": mult,
        "label": config.get("label") or base_params["label"],
    }
    SAVED_STRATEGY_PARAMS[key] = params
    return params


def _params(strat: str) -> dict:
    """Resolve params for a base or saved-strategy key."""
    return (
        STRATEGY_PARAMS.get(strat)
        or SAVED_STRATEGY_PARAMS.get(strat)
        or STRATEGY_PARAMS[DEFAULT_STRATEGY]
    )


def _resolve_strategy(strategy: Optional[str]) -> str:
    if strategy in STRATEGY_PARAMS or strategy in SAVED_STRATEGY_PARAMS:
        return strategy  # type: ignore[return-value]
    return DEFAULT_STRATEGY


def _compute_pole(series: np.ndarray, pole_n: int, alpha: float) -> np.ndarray:
    n = len(series)
    f = np.zeros(n)
    x = 1.0 - alpha
    a_pow = alpha ** pole_n
    binomial = [comb(pole_n, k) for k in range(pole_n + 1)]
    x_pows = [x ** k for k in range(pole_n + 1)]
    for t in range(n):
        val = a_pow * float(series[t]) if not math.isnan(series[t]) else 0.0
        for k in range(1, pole_n + 1):
            prev_idx = t - k
            prev_f = f[prev_idx] if prev_idx >= 0 else 0.0
            sign = 1 if (k % 2 == 1) else -1
            val += sign * binomial[k] * x_pows[k] * prev_f
        f[t] = val
    return f


def _gaussian_channel(
    df: pd.DataFrame,
    poles: int = DEFAULT_POLES,
    period: int = DEFAULT_PERIOD,
    mult: float = DEFAULT_MULT,
    source: str = "ohlc4",
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Returns (filt, hband, lband) arrays or None if not enough data."""
    if df is None or len(df) < 60:
        return None
    open_ = df["open"].values.astype(float)
    high  = df["high"].values.astype(float)
    low   = df["low"].values.astype(float)
    close = df["close"].values.astype(float)
    if source == "hlc3":
        src = (high + low + close) / 3.0
    else:
        src = (open_ + high + low + close) / 4.0

    n = len(close)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i-1]), abs(low[i] - close[i-1]))

    beta  = (1 - math.cos(4 * math.asin(1) / period)) / (math.pow(1.414, 2.0 / poles) - 1)
    alpha = -beta + math.sqrt(beta ** 2 + 2 * beta)

    filt   = _compute_pole(src, poles, alpha)
    filttr = _compute_pole(tr,  poles, alpha)
    hband  = filt + filttr * mult
    lband  = filt - filttr * mult
    return filt, hband, lband


# ── Day-state helper (for 7-day history dots) ─────────────────────────────────
def _day_state(
    ci: float, hi: float, fi: float, li: float,
    prev_ci: Optional[float], prev_hi: Optional[float], prev_li: Optional[float] = None,
) -> str:
    if ci >= hi:
        if prev_ci is not None and prev_hi is not None and prev_ci < prev_hi:
            return "breaking_out"
        return "uptrend"
    if ci <= li:
        if prev_ci is not None and prev_li is not None and prev_ci > prev_li:
            return "breaking_down"
        return "downtrend"
    pct = (hi - ci) / ci * 100 if ci > 0 else 999
    if pct <= 2.5 and ci > fi:
        return "near_breakout"
    if ci > fi:
        return "building"
    pct_low = (ci - li) / ci * 100 if ci > 0 else 999
    if pct_low <= 2.5 and ci < fi:
        return "near_breakdown"
    if ci < fi:
        return "falling"
    return "neutral"


# ── Classify ALL symbols (scan endpoint) ─────────────────────────────────────
def _classify_all(df: pd.DataFrame, symbol: str, name: str, bucket: str, strategy: Optional[str] = None) -> Optional[dict]:
    """
    Classify symbol into one of the long/short/neutral tiers for the signals list.
    Returns a dict for EVERY valid symbol — never returns None for neutral/downtrend.

    ``strategy`` selects the Gaussian-channel source/period and whether SHORT
    (breakdown) tiers are surfaced (long-only strategies collapse the downside to
    the informational ``neutral``/``downtrend`` tiers).
    """
    strat = _resolve_strategy(strategy)
    params = _params(strat)
    allow_short = params["allow_short"]

    result = _gaussian_channel(
        df,
        poles=params.get("poles", DEFAULT_POLES),
        period=params["period"],
        mult=params.get("mult", DEFAULT_MULT),
        source=params["source"],
    )
    if result is None:
        return None

    filt, hband, lband = result
    close = df["close"].values.astype(float)
    idx   = len(close) - 1

    c = close[idx]; h = hband[idx]; f = filt[idx]; l = lband[idx]
    if c <= 0 or h <= 0:
        return None

    pct_to_green = (h - c) / c * 100   # negative → already above upper band
    pct_to_red   = (c - l) / c * 100   # negative → already below lower band

    # Breakout date — scan back up to 365 bars
    breakout_date: Optional[str] = None
    for i in range(idx, max(0, idx - 365), -1):
        if i >= 1 and close[i-1] < hband[i-1] and close[i] >= hband[i]:
            breakout_date = str(df.index[i])[:10]
            break

    # Breakdown date — most recent crossunder of the lower band
    breakdown_date: Optional[str] = None
    for i in range(idx, max(0, idx - 365), -1):
        if i >= 1 and close[i-1] > lband[i-1] and close[i] <= lband[i]:
            breakdown_date = str(df.index[i])[:10]
            break

    # Consecutive bars above/below band
    bars_above = 0
    for i in range(idx, -1, -1):
        if close[i] >= hband[i]: bars_above += 1
        else: break

    bars_below = 0
    for i in range(idx, -1, -1):
        if close[i] <= lband[i]: bars_below += 1
        else: break

    # 7-day history dots
    week_history = []
    for i in range(max(0, idx - 6), idx + 1):
        pc = close[i-1] if i > 0 else None
        ph = hband[i-1] if i > 0 else None
        pl = lband[i-1] if i > 0 else None
        state = _day_state(close[i], hband[i], filt[i], lband[i], pc, ph, pl)
        if not allow_short and state in ("breaking_down", "near_breakdown", "falling"):
            state = "downtrend" if state == "breaking_down" else "neutral"
        week_history.append({
            "date": str(df.index[i])[:10],
            "state": state,
        })

    # Recent crossover above the upper band (fresh long breakout)
    bars_since_cross: Optional[int] = None
    for lb in range(1, 6):
        i = idx - lb + 1
        if i < 1: break
        if close[i-1] < hband[i-1] and close[i] >= hband[i]:
            bars_since_cross = lb
            break

    # Recent crossunder below the lower band (fresh short breakdown)
    bars_since_cross_down: Optional[int] = None
    for lb in range(1, 6):
        i = idx - lb + 1
        if i < 1: break
        if close[i-1] > lband[i-1] and close[i] <= lband[i]:
            bars_since_cross_down = lb
            break

    # Tier + direction
    direction = "long"
    if bars_since_cross is not None and bars_since_cross <= 3:
        tier = "breaking_out"
        desc = f"Crossed above channel {bars_since_cross} bar{'s' if bars_since_cross > 1 else ''} ago"
    elif pct_to_green <= 0:
        tier = "in_uptrend"
        desc = f"Price {abs(pct_to_green):.1f}% above upper band"
    elif pct_to_green <= 2.5 and c > f:
        tier = "near_breakout"
        desc = f"Only {pct_to_green:.1f}% below green zone"
    elif c > f:
        tier = "building"
        desc = f"Above midline, {pct_to_green:.1f}% from breakout"
    elif allow_short and bars_since_cross_down is not None and bars_since_cross_down <= 3:
        tier = "breaking_down"; direction = "short"
        desc = f"Crossed below channel {bars_since_cross_down} bar{'s' if bars_since_cross_down > 1 else ''} ago"
    elif allow_short and pct_to_red <= 0:
        tier = "in_downtrend"; direction = "short"
        desc = f"Price {abs(pct_to_red):.1f}% below lower band"
    elif allow_short and pct_to_red <= 2.5 and c < f:
        tier = "near_breakdown"; direction = "short"
        desc = f"Only {pct_to_red:.1f}% above red zone"
    elif allow_short and c < f:
        tier = "falling"; direction = "short"
        desc = f"Below midline, {pct_to_red:.1f}% from breakdown"
    elif pct_to_red <= 0:        # long-only: informational downtrend
        tier = "downtrend"; direction = "neutral"
        desc = f"Price {abs(pct_to_red):.1f}% below lower band"
    else:
        tier = "neutral"; direction = "neutral"
        desc = "Between bands"

    # Daily momentum + current green state — for the breakout detail tab
    chg_today = round((c - close[idx - 1]) / close[idx - 1] * 100, 2) if idx >= 1 and close[idx - 1] else 0.0
    chg_yest = round((close[idx - 1] - close[idx - 2]) / close[idx - 2] * 100, 2) if idx >= 2 and close[idx - 2] else 0.0
    still_green = bool(c >= h)

    return {
        "symbol": symbol, "name": name, "bucket": bucket,
        "tier": tier, "direction": direction, "desc": desc,
        "strategy": strat,
        "changeTodayPct": chg_today,
        "changeYesterdayPct": chg_yest,
        "stillGreen": still_green,
        "pctToGreen": round(pct_to_green, 2),
        "pctToRed":   round(pct_to_red,   2),
        "currentPrice": round(float(c), 6),
        "upperBand":    round(float(h), 6),
        "filterLine":   round(float(f), 6),
        "lowerBand":    round(float(l), 6),
        "barsSinceCross":      bars_since_cross,
        "barsSinceCrossDown":  bars_since_cross_down,
        "barsAboveUpperBand":  bars_above,
        "barsBelowLowerBand":  bars_below,
        "breakoutDate":   breakout_date,
        "breakdownDate":  breakdown_date,
        "weekHistory":    week_history,
    }


# ── Trend Scanner (3-color trend model: Green / Grey / Red) ───────────────────
# Mirrors the colleague's "Trend Scanner" export:
#   • Green = close at/above the upper Gaussian band (uptrend / trade active)
#   • Red   = close at/below the lower Gaussian band (downtrend / trade closed)
#   • Grey  = anywhere in between (hold)
# A long trade OPENS when the color turns Green, is HELD through Grey, and CLOSES
# when the color turns Red. Net P&L % is measured from the open price.
def _fmt_price(v: float) -> str:
    if v >= 1:
        return f"{v:,.2f}"
    if v >= 0.01:
        return f"{v:.4f}"
    return f"{v:.6f}"


def _format_ticker(symbol: str, bucket: str, exch_id: Optional[str]) -> str:
    """TradingView-style EXCHANGE:BASEQUOTE for crypto; raw symbol otherwise."""
    if bucket == "crypto" and "/" in symbol:
        base, quote = symbol.split("/")[:2]
        ex = (exch_id or "BINANCE").upper()
        return f"{ex}:{base}{quote}"
    return symbol


def _color_series(
    df: pd.DataFrame, params: dict
) -> Optional[Tuple[List[str], np.ndarray, List[Optional[str]]]]:
    """Per-bar trend color (Green/Grey/Red), skipping the filter warm-up region."""
    result = _gaussian_channel(
        df,
        poles=params.get("poles", DEFAULT_POLES),
        period=params["period"],
        mult=params.get("mult", DEFAULT_MULT),
        source=params["source"],
    )
    if result is None:
        return None
    filt, hband, lband = result
    close = df["close"].values.astype(float)
    n = len(close)
    warmup = min(params["period"], n - 1)
    dates = [str(df.index[i])[:10] for i in range(n)]
    colors: List[Optional[str]] = [None] * n
    for i in range(n):
        c = close[i]; h = hband[i]; l = lband[i]
        if i < warmup or not (c > 0) or math.isnan(h) or math.isnan(l):
            continue
        if c >= h:
            colors[i] = "Green"
        elif c <= l:
            colors[i] = "Red"
        else:
            colors[i] = "Grey"
    return dates, close, colors


def _trend_row(
    df: pd.DataFrame, symbol: str, name: str, bucket: str,
    strategy: Optional[str], exch_id: Optional[str],
) -> Optional[dict]:
    strat = _resolve_strategy(strategy)
    params = _params(strat)
    cs = _color_series(df, params)
    if cs is None:
        return None
    dates, close, colors = cs
    valid = [i for i in range(len(colors)) if colors[i] is not None]
    if not valid:
        return None

    last = valid[-1]
    current_color = colors[last]
    current_price = float(close[last])

    # Most recent color change → "Trend" transition + "Trend Changed" date.
    trend_from = current_color
    trend_changed = dates[valid[0]]
    for k in range(len(valid) - 1, 0, -1):
        i, j = valid[k], valid[k - 1]
        if colors[i] != colors[j]:
            trend_from = colors[j]
            trend_changed = dates[i]
            break

    # State machine: open on Green, hold on Grey, close on Red.
    position_open = False
    open_date: Optional[str] = None
    open_price: Optional[float] = None
    last_open_date: Optional[str] = None
    for k in valid:
        col = colors[k]
        if col == "Green" and not position_open:
            position_open = True
            open_date = dates[k]
            open_price = float(close[k])
            last_open_date = dates[k]
        elif col == "Red" and position_open:
            position_open = False

    status = "OPEN" if position_open else "CLOSED"
    if position_open and open_price and open_price > 0:
        net_pnl: Optional[float] = round((current_price - open_price) / open_price * 100, 2)
        open_date_out = open_date
    else:
        net_pnl = None
        open_date_out = last_open_date

    # Range tag while consolidating (Grey): tight band since the last trend change.
    range_str: Optional[str] = None
    if current_color == "Grey":
        streak = [float(close[i]) for i in valid if dates[i] >= trend_changed]
        if len(streak) >= 5:
            lo, hi = min(streak), max(streak)
            if lo > 0 and (hi - lo) / lo <= 0.30:
                range_str = f"Range ({_fmt_price(lo)}-{_fmt_price(hi)})"

    return {
        "asset": name,
        "symbol": symbol,
        "ticker": _format_ticker(symbol, bucket, exch_id),
        "bucket": bucket,
        "trendFrom": trend_from,
        "trendTo": current_color,
        "trendChanged": trend_changed,
        "range": range_str,
        "status": status,
        "openDate": open_date_out,
        "netPnlPct": net_pnl,
        "currentPrice": round(current_price, 6),
        "timeframe": "1D",
        "_series": [(dates[i], colors[i]) for i in valid[-50:]],
    }


# ── Full analysis with candles (chart endpoint) ───────────────────────────────
def _get_full_analysis(df: pd.DataFrame, symbol: str, bucket: str, strategy: Optional[str] = None) -> Optional[dict]:
    """Full analysis including candles for the chart pop-up. Handles all tiers."""
    strat = _resolve_strategy(strategy)
    params = _params(strat)
    base = _classify_all(df, symbol, symbol, bucket, strat)
    if base is None:
        return None

    # Append candle data (last 90 bars)
    open_  = df["open"].values.astype(float)
    high   = df["high"].values.astype(float)
    low_   = df["low"].values.astype(float)
    close  = df["close"].values.astype(float)
    result = _gaussian_channel(
        df,
        poles=params.get("poles", DEFAULT_POLES),
        period=params["period"],
        mult=params.get("mult", DEFAULT_MULT),
        source=params["source"],
    )
    if result is None:
        return None
    filt, hband, lband = result

    n = len(close)
    candles = []
    for i in range(max(0, n - 90), n):
        candles.append({
            "date":  str(df.index[i])[:10],
            "open":  round(float(open_[i]),  6),
            "high":  round(float(high[i]),   6),
            "low":   round(float(low_[i]),   6),
            "close": round(float(close[i]),  6),
            "filt":  round(float(filt[i]),   6),
            "hband": round(float(hband[i]),  6),
            "lband": round(float(lband[i]),  6),
        })

    return {**base, "candles": candles}


# ── Chart endpoint helper ─────────────────────────────────────────────────────
def get_signal_chart(symbol: str, bucket: str, strategy: Optional[str] = None) -> Optional[dict]:
    df = _fetch_symbol(symbol, bucket)
    if df is None:
        return None
    return _get_full_analysis(df, symbol, bucket, strategy)


# ── Data fetch ────────────────────────────────────────────────────────────────
def _fetch_symbol(symbol: str, bucket: str) -> Optional[pd.DataFrame]:
    try:
        if bucket == "crypto":
            return fetch_crypto_ohlcv(symbol, timeframe="1d", limit=220)
        else:
            return fetch_equity_ohlcv(symbol, timeframe="1d", start_date="2024-01-01")
    except Exception as e:
        logger.debug("fetch failed %s: %s", symbol, e)
        return None


# Concurrency cap for the bulk crypto OHLCV fetch.
#
# RAISED 4→12. Prod proved the fetch is LATENCY-bound, not throttle-bound: binance
# is reachable but slow, every failure was a per-symbol timeout (no 429s), and the
# result scaled WITH concurrency (8→49, 4→25). So more parallel in-flight requests
# = more of the slow binance responses land inside the window. 12 stays well under
# binance's low-weight OHLCV allowance (the loose rate gate is the safety cap). If
# 429s ever appear in the scan-cache errors, dial this back — but timeouts want the
# opposite of what throttling wants.
CRYPTO_FETCH_CONCURRENCY = 12
_CRYPTO_FETCH_ATTEMPTS = 3  # per-symbol retries to ride out transient throttling

# Diagnostic snapshot of the MOST RECENT crypto fetch pass, populated by
# _gather_symbol_dfs. Read by the daily-scan logger (and surfaced via
# /signals/scan-diag) so degradation is visible WITHOUT re-running a probe:
# which exchange the data layer resolved to, how many symbols were attempted vs
# actually fetched, and a couple of representative failure reasons. Best-effort
# and overwritten every scan — observability only, never a control input.
_LAST_CRYPTO_FETCH: dict = {"attempted": 0, "ok": 0, "fail": 0, "errors": [], "exchange": None}

# ── Compare-scan bounds ──────────────────────────────────────────────────────
# Unlike the daily/breakout scans (which run a SMALL universe, or run in the
# background off a cached result), Compare runs SYNCHRONOUSLY inside the HTTP
# request over a large (Top-100) universe. Without bounds, one slow/blocked symbol
# — or exchange throttling — made the whole request hang for minutes and the UI
# spun forever. So Compare caps the symbol count and puts BOTH a per-symbol and an
# overall timeout on the fetch: whatever has arrived by the deadline is ranked and
# returned, and a stuck symbol is dropped (None) instead of stalling the batch.
COMPARE_MAX_CRYPTO = 100          # never fetch more than this many crypto symbols
COMPARE_PER_SYMBOL_TIMEOUT = 12.0  # seconds; one stuck symbol is dropped, not awaited
COMPARE_OVERALL_TIMEOUT = 60.0     # seconds; hard ceiling on the whole crypto fetch


def _fetch_crypto_df(symbol: str, limit: int = 220) -> Optional[pd.DataFrame]:
    """Fetch one crypto symbol's daily OHLCV with a short paced retry.

    Under a large concurrent scan the exchange intermittently throttles (HTTP 429
    / read timeout); without a retry those symbols silently drop and a full scan
    can collapse to near-zero usable signals. We retry a few times with light
    backoff — the backoff doubles as pacing that lets the exchange recover."""
    for attempt in range(_CRYPTO_FETCH_ATTEMPTS):
        try:
            df = fetch_crypto_ohlcv(symbol, timeframe="1d", limit=limit, raise_errors=True)
            if df is not None:
                return df
        except Exception as e:
            logger.debug("fetch failed %s (attempt %d/%d): %s",
                         symbol, attempt + 1, _CRYPTO_FETCH_ATTEMPTS, e)
        if attempt + 1 < _CRYPTO_FETCH_ATTEMPTS:
            _time.sleep(0.4 * (attempt + 1))  # 0.4s, 0.8s — pace + let throttling clear
    return None


def _fetch_crypto_df_verbose(symbol: str, limit: int = 220) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
    """Like ``_fetch_crypto_df`` but returns (df, error_string) for diagnostics.
    A single attempt (no retry) so /signals/scan-diag measures the raw success/
    failure rate the live scan sees per pass."""
    try:
        df = fetch_crypto_ohlcv(symbol, timeframe="1d", limit=limit, raise_errors=True)
        if df is None:
            return None, "empty (no bars returned)"
        return df, None
    except Exception as exc:  # noqa: BLE001 — capture the real error for the diag
        return None, f"{type(exc).__name__}: {str(exc)[:160]}"


# ── Shared symbol/df gathering (breakout + trend scans) ──────────────────────
async def _gather_symbol_dfs(
    buckets: List[str],
    crypto_limit: int = 10,
    stock_limit: int = 10,
    metal_limit: int = 1000,
    commodity_limit: int = 1000,
    crypto_fetch_limit: int = 220,
    per_symbol_timeout: Optional[float] = None,
    overall_timeout: Optional[float] = None,
) -> List[Tuple[str, str, str, Optional[pd.DataFrame]]]:
    """Fetch OHLCV for every symbol in ``buckets`` → list of (symbol, name, bucket, df).

    When ``per_symbol_timeout`` is set (Compare scan), the crypto fetch is BOUNDED:
    each symbol is awaited at most ``per_symbol_timeout`` seconds and the whole crypto
    gather at most ``overall_timeout`` seconds. Symbols that miss the deadline come
    back as ``None`` instead of stalling the (synchronous) request. When it is None,
    behaviour is identical to before — the daily/breakout/trend scans are unaffected."""
    from app.data.equities import fetch_equity_batch_ohlcv
    from app.data.stock_universe import get_stock_symbols_for_limit

    crypto_tasks: List[Tuple[str, str, str]] = []
    equity_tasks: List[Tuple[str, str, str]] = []
    for bucket in buckets:
        if bucket == "crypto":
            crypto_tasks.extend((s, n, "crypto") for s, n in get_crypto_symbols_for_limit(crypto_limit))
        elif bucket == "stocks":
            equity_tasks.extend((s, n, bucket) for s, n in get_stock_symbols_for_limit(stock_limit))
        elif bucket == "metals":
            equity_tasks.extend((s, n, bucket) for s, n in SCAN_SYMBOLS.get(bucket, [])[:metal_limit])
        elif bucket == "commodities":
            equity_tasks.extend((s, n, bucket) for s, n in SCAN_SYMBOLS.get(bucket, [])[:commodity_limit])
        else:
            equity_tasks.extend((s, n, bucket) for s, n in SCAN_SYMBOLS.get(bucket, []))

    out: List[Tuple[str, str, str, Optional[pd.DataFrame]]] = []

    # Crypto — concurrent per-symbol CCXT fetch.
    if crypto_tasks:
        loop = asyncio.get_event_loop()
        max_workers = min(CRYPTO_FETCH_CONCURRENCY, len(crypto_tasks))
        # Best-effort capture of a few failure reasons for the diagnostic snapshot
        # (the bounded path otherwise swallows them). Appended on the event-loop
        # thread only, so no locking is needed.
        crypto_fetch_errors: List[str] = []
        if per_symbol_timeout is None:
            # Unbounded path — unchanged for the daily/breakout/trend scans.
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futs = [
                    loop.run_in_executor(pool, _fetch_crypto_df, sym, crypto_fetch_limit)
                    for sym, _n, _b in crypto_tasks
                ]
                dfs = await asyncio.gather(*futs, return_exceptions=True)
        else:
            # Bounded path (Compare): each symbol gets a hard per-symbol timeout and
            # the whole batch a hard overall deadline, so one slow/blocked symbol
            # (or exchange throttling) can't hang the synchronous request. The pool
            # is shut down WITHOUT waiting on any still-running fetch (cancel queued,
            # let in-flight threads finish in the background) so the request returns.
            pool = ThreadPoolExecutor(max_workers=max_workers)

            async def _bounded(sym: str) -> Optional[pd.DataFrame]:
                try:
                    return await asyncio.wait_for(
                        loop.run_in_executor(pool, _fetch_crypto_df, sym, crypto_fetch_limit),
                        timeout=per_symbol_timeout,
                    )
                except asyncio.TimeoutError:  # slow/blocked symbol → drop
                    if len(crypto_fetch_errors) < 3:
                        crypto_fetch_errors.append("timeout (per-symbol deadline)")
                    return None
                except Exception as exc:  # noqa: BLE001 — fetch error → drop symbol
                    if len(crypto_fetch_errors) < 3:
                        crypto_fetch_errors.append(f"{type(exc).__name__}: {str(exc)[:120]}")
                    return None

            tasks = [asyncio.ensure_future(_bounded(sym)) for sym, _n, _b in crypto_tasks]
            try:
                if overall_timeout is not None:
                    dfs = await asyncio.wait_for(
                        asyncio.gather(*tasks, return_exceptions=True), timeout=overall_timeout
                    )
                else:
                    dfs = await asyncio.gather(*tasks, return_exceptions=True)
            except asyncio.TimeoutError:
                # Overall deadline hit: keep whatever already resolved, drop the rest.
                dfs = []
                for tsk in tasks:
                    if tsk.done() and not tsk.cancelled():
                        try:
                            dfs.append(tsk.result())
                        except Exception:  # noqa: BLE001
                            dfs.append(None)
                    else:
                        tsk.cancel()
                        dfs.append(None)
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
        for (sym, name, bucket), df in zip(crypto_tasks, dfs):
            out.append((sym, name, bucket, None if isinstance(df, Exception) else df))

        # Record a diagnostic snapshot of this crypto fetch pass (attempted vs
        # fetched, plus a few failure reasons + the resolved exchange). Read by the
        # daily-scan logger and /signals/scan-diag. Wrapped so a diag hiccup can
        # never affect the scan itself.
        try:
            _c_ok = sum(1 for d in dfs if d is not None and not isinstance(d, Exception))
            errs = list(crypto_fetch_errors)
            if not errs and per_symbol_timeout is None:
                # Unbounded path keeps exceptions in dfs; surface a couple.
                for d in dfs:
                    if isinstance(d, Exception) and len(errs) < 3:
                        errs.append(f"{type(d).__name__}: {str(d)[:120]}")
            from app.data import market_exchange as _mx
            _LAST_CRYPTO_FETCH.update({
                "attempted": len(crypto_tasks),
                "ok": _c_ok,
                "fail": len(crypto_tasks) - _c_ok,
                "errors": errs,
                "exchange": _mx.market_exchange_id(),
            })
        except Exception:  # noqa: BLE001 — diagnostics must never break the scan
            pass

    # Equities / metals / commodities — chunked yfinance batch download.
    if equity_tasks:
        sym_list = [s for s, _n, _b in equity_tasks]
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor(max_workers=1) as pool:
            equity_df_map = await loop.run_in_executor(
                pool, fetch_equity_batch_ohlcv, sym_list, "2024-01-01"
            )
        for sym, name, bucket in equity_tasks:
            out.append((sym, name, bucket, equity_df_map.get(sym)))

    return out


# ── Main scan ─────────────────────────────────────────────────────────────────
async def run_breakout_scan(
    buckets: List[str],
    crypto_limit: int = 10,
    stock_limit: int = 10,
    strategy: Optional[str] = None,
    metal_limit: int = 1000,
    commodity_limit: int = 1000,
    per_symbol_timeout: Optional[float] = 12.0,
    overall_timeout: Optional[float] = 90.0,
) -> List[dict]:
    """
    Async scan — classifies ALL symbols into long / neutral / short tiers.
    • Crypto:   one-by-one via CCXT in a thread pool (already fast).
    • Equities: chunked yfinance batch download (one request per 100 tickers).
    Returns list sorted: long tiers first, then short tiers, neutral last.

    BOUNDED BY DEFAULT: the crypto fetch is now capped by ``per_symbol_timeout``
    (one stuck/geo-blocked symbol is dropped, not awaited) and ``overall_timeout``
    (hard ceiling on the whole crypto gather). This is what lets a LARGE (Top-100)
    universe complete reliably instead of hanging when the exchange throttles or a
    symbol's multi-exchange fallback cascade stalls — whatever has arrived by the
    deadline is classified and returned. Pass ``per_symbol_timeout=None`` to restore
    the old unbounded behaviour; the background daily scan raises ``overall_timeout``
    so it can gather the full universe.
    """
    strat = _resolve_strategy(strategy)

    TIER_ORDER = {
        # long (upside)
        "breaking_out": 0, "near_breakout": 1, "in_uptrend": 2, "building": 3,
        # short (downside)
        "breaking_down": 4, "near_breakdown": 5, "in_downtrend": 6, "falling": 7,
        # informational
        "neutral": 8, "downtrend": 9,
    }

    rows = await _gather_symbol_dfs(
        buckets, crypto_limit=crypto_limit, stock_limit=stock_limit,
        metal_limit=metal_limit, commodity_limit=commodity_limit,
        per_symbol_timeout=per_symbol_timeout, overall_timeout=overall_timeout,
    )

    # ── Classify all ──────────────────────────────────────────────────────────
    signals: List[dict] = []
    for sym, name, bucket, df in rows:
        if df is None:
            continue
        sig = _classify_all(df, sym, name, bucket, strat)
        if sig:
            signals.append(sig)

    # Within a tier, rank by closeness to the relevant band: longs by distance to
    # the upper band (pctToGreen asc), shorts by distance to the lower band
    # (pctToRed asc).
    def _rank(s: dict) -> Tuple[int, float]:
        secondary = s.get("pctToRed", 0) if s.get("direction") == "short" else s.get("pctToGreen", 0)
        return (TIER_ORDER.get(s["tier"], 99), secondary)

    signals.sort(key=_rank)
    return signals


# ── Compare strategies: one fetch, ranked per strategy ───────────────────────
async def run_compare_scan(
    buckets: List[str],
    strategies: List[str],
    crypto_limit: int = 100,
    stock_limit: int = 0,
    metal_limit: int = 0,
    commodity_limit: int = 0,
    top: int = 100,
) -> dict:
    """Run the breakout scan for SEVERAL strategies at once and return each one's
    own ranked top-``top`` long list, keyed by strategy id.

    OHLCV is fetched ONCE via ``_gather_symbol_dfs`` and re-classified under every
    strategy (classification is cheap; the fetch is the cost), so comparing N
    strategies costs ~1 scan's worth of network, not N. Ranking mirrors
    ``run_breakout_scan`` exactly so a single strategy here equals its breakout list.
    """
    strats: List[str] = []
    for s in strategies:
        rs = _resolve_strategy(s)
        if rs not in strats:
            strats.append(rs)
    if not strats:
        strats = [DEFAULT_STRATEGY]

    TIER_ORDER = {
        "breaking_out": 0, "near_breakout": 1, "in_uptrend": 2, "building": 3,
        "breaking_down": 4, "near_breakdown": 5, "in_downtrend": 6, "falling": 7,
        "neutral": 8, "downtrend": 9,
    }

    def _rank(s: dict) -> Tuple[int, float]:
        secondary = s.get("pctToRed", 0) if s.get("direction") == "short" else s.get("pctToGreen", 0)
        return (TIER_ORDER.get(s["tier"], 99), secondary)

    # Cap + bound the fetch: Compare runs synchronously in the request, so a stuck
    # symbol or exchange throttling must never hang it. Mirrors the daily scan's
    # reliable per-symbol fetch (_fetch_crypto_df, with its retry), just bounded.
    capped_crypto = min(crypto_limit, COMPARE_MAX_CRYPTO)
    rows = await _gather_symbol_dfs(
        buckets, crypto_limit=capped_crypto, stock_limit=stock_limit,
        metal_limit=metal_limit, commodity_limit=commodity_limit,
        per_symbol_timeout=COMPARE_PER_SYMBOL_TIMEOUT,
        overall_timeout=COMPARE_OVERALL_TIMEOUT,
    )

    out: dict = {}
    for strat in strats:
        sigs: List[dict] = []
        for sym, name, bucket, df in rows:
            if df is None:
                continue
            sig = _classify_all(df, sym, name, bucket, strat)
            if sig:
                sigs.append(sig)
        sigs.sort(key=_rank)
        # The comparison is about *breakout opportunities*, so we rank the long
        # (upside) tiers — same set the Scanner's breakouts panel surfaces.
        longs = [s for s in sigs if s.get("direction") == "long" and float(s.get("currentPrice") or 0) > 0]
        out[strat] = longs[: max(1, top)]
    return out


# ── Diagnostic: measure the bulk crypto OHLCV success/failure rate ───────────
async def diag_crypto_fetch(limit: int = 40, per_symbol_timeout: float = 8.0,
                            overall_timeout: float = 30.0) -> dict:
    """Concurrently fetch OHLCV for the top ``limit`` crypto symbols using the
    SAME concurrency the live scan uses, and report success/failure counts plus
    up to 3 distinct error strings. This is how /signals/scan-diag confirms the
    rate-limit hypothesis (and the fix): a healthy fix shows ok≈attempted.

    HARD-BOUNDED so the diagnostic itself can never hang past the reverse-proxy
    timeout (which was returning 502): each symbol gets ``per_symbol_timeout`` and
    the whole gather ``overall_timeout``. Whatever hasn't resolved by the deadline
    is counted as a ``timeout`` failure and the partial result is returned."""
    syms = get_top_crypto_by_volume(limit)
    attempted = len(syms)
    out = {"attempted": attempted, "ok": 0, "fail": 0, "errors": [],
           "concurrency": CRYPTO_FETCH_CONCURRENCY, "timedOut": False}
    if not syms:
        return out

    loop = asyncio.get_event_loop()
    max_workers = min(CRYPTO_FETCH_CONCURRENCY, attempted)
    pool = ThreadPoolExecutor(max_workers=max_workers)

    async def _one(sym: str):
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(pool, _fetch_crypto_df_verbose, sym, 220),
                timeout=per_symbol_timeout,
            )
        except asyncio.TimeoutError:
            return (None, "timeout (per-symbol deadline)")

    tasks = [asyncio.ensure_future(_one(sym)) for sym, _n in syms]
    try:
        results = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True), timeout=overall_timeout
        )
    except asyncio.TimeoutError:
        out["timedOut"] = True
        results = []
        for tsk in tasks:
            if tsk.done() and not tsk.cancelled():
                try:
                    results.append(tsk.result())
                except Exception as exc:  # noqa: BLE001
                    results.append(exc)
            else:
                tsk.cancel()
                results.append((None, "timeout (overall deadline)"))
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    errors: List[str] = []
    for res in results:
        if isinstance(res, Exception):
            df, err = None, f"{type(res).__name__}: {str(res)[:160]}"
        else:
            df, err = res
        if df is not None:
            out["ok"] += 1
            continue
        out["fail"] += 1
        msg = err or "unknown"
        if msg not in errors and len(errors) < 3:
            errors.append(msg)
    out["errors"] = errors
    return out


# ── Trend Scanner scan ───────────────────────────────────────────────────────
async def run_trend_scan(
    buckets: List[str],
    crypto_limit: int = 10,
    stock_limit: int = 10,
    strategy: Optional[str] = None,
    metal_limit: int = 1000,
    commodity_limit: int = 1000,
    per_symbol_timeout: Optional[float] = 12.0,
    overall_timeout: Optional[float] = 90.0,
) -> dict:
    """
    Async 3-color trend scan. Returns:
      { "scanner": [ ...per-symbol trend rows... ],
        "history": [ {date, green, grey, red, total} ... last ~45 days ] }

    BOUNDED BY DEFAULT (same as ``run_breakout_scan``): a stuck/geo-blocked symbol
    is dropped rather than hanging the whole (synchronous) request, so a large
    Top-100 crypto universe returns reliably instead of stalling the UI.
    """
    strat = _resolve_strategy(strategy)

    exch_id: Optional[str] = None
    if "crypto" in buckets:
        try:
            from app.data.market_exchange import market_exchange_id, resolve_market_exchange_id
            exch_id = market_exchange_id() or resolve_market_exchange_id()
        except Exception:
            exch_id = None

    # Crypto needs a longer window so still-open trades keep their true open date.
    rows = await _gather_symbol_dfs(
        buckets, crypto_limit=crypto_limit, stock_limit=stock_limit,
        metal_limit=metal_limit, commodity_limit=commodity_limit,
        crypto_fetch_limit=500,
        per_symbol_timeout=per_symbol_timeout, overall_timeout=overall_timeout,
    )

    scanner: List[dict] = []
    history_counts: dict[str, dict] = {}  # date → {Green, Grey, Red}
    for sym, name, bucket, df in rows:
        if df is None:
            continue
        row = _trend_row(df, sym, name, bucket, strat, exch_id)
        if row is None:
            continue
        for d, col in row.pop("_series", []):
            slot = history_counts.setdefault(d, {"Green": 0, "Grey": 0, "Red": 0})
            slot[col] += 1
        scanner.append(row)

    # OPEN positions first; within each group, most recently changed first.
    scanner.sort(key=lambda r: r.get("trendChanged") or "", reverse=True)
    scanner.sort(key=lambda r: 0 if r["status"] == "OPEN" else 1)

    history: List[dict] = []
    for d in sorted(history_counts.keys())[-45:]:
        c = history_counts[d]
        g, gr, rd = c["Green"], c["Grey"], c["Red"]
        history.append({"date": d, "green": g, "grey": gr, "red": rd, "total": g + gr + rd})

    return {"scanner": scanner, "history": history}
