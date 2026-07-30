"""
Port of the BOT(8C)-770 (LONG+SHORT) Pine Script strategy.
Implements the Gaussian Gaussian channel filter with N poles plus ADX/SMA filters.

This module now produces the *signal columns* consumed by the vendored
TradingView-matching backtest engine (``engine``); trade execution and KPI
computation live in the engine, not here. The signal math is unchanged.
"""
from __future__ import annotations
import math
from math import comb
from typing import Tuple
import numpy as np
import pandas as pd

from app.models import StrategyConfig


def _nz(val: float, default: float = 0.0) -> float:
    if val is None or math.isnan(val) or math.isinf(val):
        return default
    return val


def _compute_pole(series: np.ndarray, pole_n: int, alpha: float) -> np.ndarray:
    """
    Recursive IIR filter for `pole_n` poles.

    Recurrence (derived from Pine's f_filt9x binomial expansion):
      f[t] = alpha^n * s[t]
             + C(n,1)*(1-a)^1 * f[t-1]
             - C(n,2)*(1-a)^2 * f[t-2]
             + C(n,3)*(1-a)^3 * f[t-3]
             ...
    """
    n = len(series)
    f = np.zeros(n)
    x = 1.0 - alpha
    a_pow = alpha ** pole_n

    binomial = [comb(pole_n, k) for k in range(pole_n + 1)]
    x_pows = [x ** k for k in range(pole_n + 1)]

    for t in range(n):
        val = a_pow * _nz(series[t])
        for k in range(1, pole_n + 1):
            prev_idx = t - k
            prev_f = f[prev_idx] if prev_idx >= 0 else 0.0
            sign = 1 if (k % 2 == 1) else -1
            val += sign * binomial[k] * x_pows[k] * prev_f
        f[t] = val
    return f


def compute_true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    n = len(close)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        prev_close = close[i - 1]
        tr[i] = max(high[i] - low[i], abs(high[i] - prev_close), abs(low[i] - prev_close))
    return tr


def compute_sma(series: np.ndarray, period: int) -> np.ndarray:
    result = np.full(len(series), np.nan)
    for i in range(period - 1, len(series)):
        result[i] = np.mean(series[i - period + 1: i + 1])
    return result


def compute_adx(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                period: int = 14) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Compute ADX, +DI, -DI using Wilder smoothing."""
    n = len(close)
    adx = np.zeros(n)
    di_plus = np.zeros(n)
    di_minus = np.zeros(n)

    if n < period + 1:
        return adx, di_plus, di_minus

    tr = compute_true_range(high, low, close)

    dm_plus = np.zeros(n)
    dm_minus = np.zeros(n)
    for i in range(1, n):
        up = high[i] - high[i - 1]
        down = low[i - 1] - low[i]
        dm_plus[i] = up if (up > down and up > 0) else 0
        dm_minus[i] = down if (down > up and down > 0) else 0

    # Wilder smoothing
    smooth_tr = np.zeros(n)
    smooth_dmp = np.zeros(n)
    smooth_dmm = np.zeros(n)

    smooth_tr[period] = np.sum(tr[1: period + 1])
    smooth_dmp[period] = np.sum(dm_plus[1: period + 1])
    smooth_dmm[period] = np.sum(dm_minus[1: period + 1])

    for i in range(period + 1, n):
        smooth_tr[i] = smooth_tr[i - 1] - smooth_tr[i - 1] / period + tr[i]
        smooth_dmp[i] = smooth_dmp[i - 1] - smooth_dmp[i - 1] / period + dm_plus[i]
        smooth_dmm[i] = smooth_dmm[i - 1] - smooth_dmm[i - 1] / period + dm_minus[i]

    dx = np.zeros(n)
    for i in range(period, n):
        if smooth_tr[i] > 0:
            dip = 100 * smooth_dmp[i] / smooth_tr[i]
            dim = 100 * smooth_dmm[i] / smooth_tr[i]
            di_plus[i] = dip
            di_minus[i] = dim
            if dip + dim > 0:
                dx[i] = 100 * abs(dip - dim) / (dip + dim)

    # Smooth DX into ADX
    adx[2 * period - 1] = np.mean(dx[period: 2 * period])
    for i in range(2 * period, n):
        adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period

    return adx, di_plus, di_minus


def crossover(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """True where a crosses above b (a[t-1] <= b[t-1] and a[t] > b[t])."""
    prev_a = np.roll(a, 1)
    prev_b = np.roll(b, 1)
    result = (prev_a <= prev_b) & (a > b)
    result[0] = False
    return result


def crossunder(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """True where a crosses below b (a[t-1] >= b[t-1] and a[t] < b[t])."""
    prev_a = np.roll(a, 1)
    prev_b = np.roll(b, 1)
    result = (prev_a >= prev_b) & (a < b)
    result[0] = False
    return result


def build_signals(df: pd.DataFrame, config: StrategyConfig) -> pd.DataFrame:
    """
    Compute the BOT(8C)-770 entry/exit signals on OHLCV data.

    Returns a DataFrame indexed by date with the engine's required columns:
    ``Open``, ``High``, ``Low``, ``Close`` plus boolean
    ``long_entry`` / ``long_exit`` / ``short_entry`` / ``short_exit``.

    Signals are NOT date-masked here — the engine restricts trading to
    ``config.startDate..endDate`` while still using earlier bars for indicator
    warmup. The underlying signal math is identical to the original port.
    """
    open_ = df["open"].values.astype(float)
    high = df["high"].values.astype(float)
    low = df["low"].values.astype(float)
    close = df["close"].values.astype(float)
    dates = df.index

    n = len(close)

    # ohlc4 source
    src = (open_ + high + low + close) / 4.0

    # Gaussian filter coefficients
    per = config.samplingPeriod
    N = config.poles
    mult = config.ftrMultiplier

    beta = (1 - math.cos(4 * math.asin(1) / per)) / (math.pow(1.414, 2.0 / N) - 1)
    alpha = -beta + math.sqrt(beta ** 2 + 2 * beta)
    lag = int(round((per - 1) / (2.0 * N)))

    # Apply reduced lag transformation
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

    # Compute N-pole filter
    filtn = _compute_pole(srcdata, N, alpha)

    if config.fastResponse:
        filt1 = _compute_pole(srcdata, 1, alpha)
        filt = (filtn + filt1) / 2.0
    else:
        filt = filtn

    filttrn = _compute_pole(trdata, N, alpha)
    if config.fastResponse:
        filttr1 = _compute_pole(trdata, 1, alpha)
        filttr = (filttrn + filttr1) / 2.0
    else:
        filttr = filttrn

    hband = filt + filttr * mult
    lband = filt - filttr * mult

    # Indicators
    sma200 = compute_sma(close, 200)
    adx_arr, di_plus, di_minus = compute_adx(high, low, close, config.adxLength)

    # Signal conditions (close-confirmed)
    long_cond = crossover(close, hband)
    if config.useAdxFilter:
        long_cond = long_cond & (adx_arr > config.adxThreshold)
    if config.useSmaFilter:
        long_cond = long_cond & (close > sma200)

    exit_long_cond = crossunder(close, hband)
    if config.allowCloseBelowSma:
        exit_long_cond = exit_long_cond | (close < sma200)

    short_cond = np.zeros(n, dtype=bool)
    if config.enableShorts:
        short_cond = crossunder(close, filt)
        filt_prev = np.roll(filt, 1)
        if config.shortUseTrendFilter:
            short_cond = short_cond & (filt < filt_prev)
        if config.shortUseAdxFilter:
            short_cond = short_cond & (adx_arr > config.shortAdxThreshold)
        if config.shortUseSmaFilter:
            short_cond = short_cond & (close < sma200)
        short_cond[0] = False

    exit_short_cond = crossover(close, lband)
    if config.shortAllowExitAboveSma:
        exit_short_cond = exit_short_cond | (close > sma200)

    return pd.DataFrame(
        {
            "Open": open_,
            "High": high,
            "Low": low,
            "Close": close,
            "long_entry": long_cond.astype(bool),
            "long_exit": exit_long_cond.astype(bool),
            "short_entry": short_cond.astype(bool),
            "short_exit": exit_short_cond.astype(bool),
        },
        index=dates,
    )
