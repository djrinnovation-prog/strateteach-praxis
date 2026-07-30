"""
Port of BOT1-770 Pine Script strategy.
Gaussian channel, LONG-only, dynamic thresholds from reductionLevel,
confirmBars, RSI/Volume filters, optional trailing stop.

This module now produces the *signal columns* consumed by the vendored
TradingView-matching backtest engine. Trade execution and KPIs live in the
engine; the signal math is unchanged.

Key differences vs BOT8C:
- Source: hlc3 (not ohlc4)
- Default period: 143
- No shorts
- reductionLevel drives ADX/RSI thresholds automatically
- Exit: crossunder(close, hband) — price drops below upper band
- confirmBars: entry delayed N-1 bars after crossover

Note: BOT1's optional ATR **trailing stop** depends on the running extreme
since entry and cannot be expressed as a precomputed per-bar column, so it is
omitted here — exits come from the crossunder/SMA signal. (See task notes.)
"""
from __future__ import annotations
import math
from typing import Tuple
import numpy as np
import pandas as pd

from app.models import StrategyConfig
from app.strategies.base import (
    _compute_pole,
    compute_true_range,
    compute_sma,
    compute_adx,
    crossover,
    crossunder,
)
from app.strategies.bot4 import _compute_rsi


def _bot1_thresholds(reduction_level: str) -> Tuple[float, float]:
    """Returns (adxThreshold, rsiThreshold) driven by reduction level."""
    if reduction_level == "High":
        return 35.0, 60.0
    if reduction_level == "Medium":
        return 25.0, 70.0
    return 20.0, 80.0          # Low


def build_signals_bot1(df: pd.DataFrame, config: StrategyConfig) -> pd.DataFrame:
    """
    Compute BOT1-770 (long-only) entry/exit signals on OHLCV data.

    Returns a DataFrame indexed by date with the engine columns
    (``Open/High/Low/Close`` + ``long_entry/long_exit`` and all-False
    ``short_entry/short_exit``). Signals are not date-masked (the engine windows
    trading by ``config.startDate..endDate``).
    """
    open_ = df["open"].values.astype(float)
    high = df["high"].values.astype(float)
    low = df["low"].values.astype(float)
    close = df["close"].values.astype(float)
    volume = df["volume"].values.astype(float) if "volume" in df.columns else np.ones(len(close))
    dates = df.index

    n = len(close)

    # ── Source: hlc3 (not ohlc4) ─────────────────────────────────────────────
    src = (high + low + close) / 3.0

    # ── Gaussian channel ──────────────────────────────────────────────────────
    per = config.samplingPeriod   # BOT1 default: 143
    N = config.poles              # default: 6
    mult = config.ftrMultiplier   # default: 1.414

    beta = (1 - math.cos(4 * math.asin(1) / per)) / (math.pow(1.414, 2.0 / N) - 1)
    alpha = -beta + math.sqrt(beta ** 2 + 2 * beta)
    lag = int(round((per - 1) / (2.0 * N)))

    if config.reducedLag and lag > 0:
        shifted_src = np.concatenate([np.full(lag, src[0]), src[:-lag]])
        srcdata = src + (src - shifted_src)
    else:
        srcdata = src.copy()

    tr = compute_true_range(high, low, close)
    if config.reducedLag and lag > 0:
        shifted_tr = np.concatenate([np.full(lag, tr[0]), tr[:-lag]])
        trdata = tr + (tr - shifted_tr)
    else:
        trdata = tr.copy()

    filtn = _compute_pole(srcdata, N, alpha)
    filttrn = _compute_pole(trdata, N, alpha)

    if config.fastResponse:
        filt1 = _compute_pole(srcdata, 1, alpha)
        filttr1 = _compute_pole(trdata, 1, alpha)
        filt = (filtn + filt1) / 2.0
        filttr = (filttrn + filttr1) / 2.0
    else:
        filt = filtn
        filttr = filttrn

    hband = filt + filttr * mult
    # lband = filt - filttr * mult  # not used for exits in BOT1

    # ── Indicators ────────────────────────────────────────────────────────────
    sma200 = compute_sma(close, 200)
    adx_arr, _, _ = compute_adx(high, low, close, config.adxLength)
    rsi_arr = _compute_rsi(close, config.rsiLength)
    volume_ma = compute_sma(volume, config.volumeMaLength)

    # ── Dynamic thresholds from reductionLevel ────────────────────────────────
    adx_thr, rsi_thr = _bot1_thresholds(config.reductionLevel)

    # ── Crossover of close above hband ────────────────────────────────────────
    co_hband = crossover(close, hband)   # shape (n,)

    # ── confirmBars: entry N-1 bars after crossover ───────────────────────────
    confirm = config.confirmBarsLong     # 1 → same bar, 2 → 1 bar later, etc.
    entry_signal = np.zeros(n, dtype=bool)
    for t in range(n):
        trigger_idx = t - (confirm - 1)
        if trigger_idx >= 0 and co_hband[trigger_idx]:
            entry_signal[t] = True

    # Apply long filters
    if config.useAdxFilter:
        entry_signal = entry_signal & (adx_arr > adx_thr)
    if config.useSmaFilter:
        entry_signal = entry_signal & (close > sma200)
    if config.useRsiFilter:
        entry_signal = entry_signal & (rsi_arr < rsi_thr)
    if config.useVolumeFilter:
        entry_signal = entry_signal & (volume > volume_ma)

    # ── Exit: close crosses below upper band ──────────────────────────────────
    exit_signal = crossunder(close, hband)
    if config.allowCloseBelowSma:
        exit_signal = exit_signal | (close < sma200)

    # ── Shorts: symmetric mirror of the long logic on the LOWER band ──────────
    # BOT1 was long-only historically. When config.enableShorts is set, it now
    # also shorts: enter on a crossunder of the lower Gaussian band (mirror of the
    # long upper-band crossover), with the same filters inverted, and exit when
    # price crosses back above the lower band. Gated so enableShorts=False keeps
    # the original long-only behaviour exactly (all-False short columns).
    short_entry_sig = np.zeros(n, dtype=bool)
    short_exit_sig = np.zeros(n, dtype=bool)
    if config.enableShorts:
        lband = filt - filttr * mult
        cu_lband = crossunder(close, lband)          # price breaks below lower band
        confirm_s = config.confirmBarsShort
        for t in range(n):
            trig = t - (confirm_s - 1)
            if trig >= 0 and cu_lband[trig]:
                short_entry_sig[t] = True
        # Mirror of the long filters (trend strength applies both ways; SMA/RSI flip).
        if config.useAdxFilter:
            short_entry_sig = short_entry_sig & (adx_arr > adx_thr)
        if config.useSmaFilter:
            short_entry_sig = short_entry_sig & (close < sma200)
        if config.useRsiFilter:
            short_entry_sig = short_entry_sig & (rsi_arr > (100.0 - rsi_thr))
        if config.useVolumeFilter:
            short_entry_sig = short_entry_sig & (volume > volume_ma)
        # Exit short when price crosses back above the lower band (mirror of long exit).
        short_exit_sig = crossover(close, lband)
        if config.allowCloseBelowSma:
            short_exit_sig = short_exit_sig | (close > sma200)

    return pd.DataFrame(
        {
            "Open": open_,
            "High": high,
            "Low": low,
            "Close": close,
            "long_entry": entry_signal.astype(bool),
            "long_exit": exit_signal.astype(bool),
            "short_entry": short_entry_sig.astype(bool),
            "short_exit": short_exit_sig.astype(bool),
        },
        index=dates,
    )
