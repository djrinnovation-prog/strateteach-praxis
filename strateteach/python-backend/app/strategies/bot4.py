"""
Port of the BOT4 - 770 SHORT+LONG Pine Script strategy.
Gaussian channel with hard ATR stops, take profits, time stops,
short regime gating, and trailing stops.

This module now produces the *signal columns* (and optional ATR stop/target
offset columns) consumed by the vendored TradingView-matching backtest engine.
Trade execution and KPIs live in the engine; the signal math is unchanged.

Risk-management mapping to the engine (see ``build_signals_bot4``):
- ATR **hard stops** → side-specific ``long_sl_offset`` / ``short_sl_offset``
  columns (distance from entry), so long and short use their own ATR multiple
  (``longStopMult`` / ``shortStopMult``).
- ATR **take-profits** → side-specific ``long_tp_offset`` / ``short_tp_offset``
  columns, each gated by its own enable flag (``useLongTP`` / ``useShortTP``)
  and multiplier — the short TP now fires in long+short runs.
- ATR **trailing stop** → ``long_trail_offset`` / ``short_trail_offset`` columns
  (per-bar distance); the engine tracks the running extreme since entry and
  merges the trail as the tighter stop.
- Short **time stop** (``shortMaxBars``) → engine config (``short_max_bars``),
  set by the adapter; forces a market exit at the bar Open after N bars held.
Still approximate: the engine recomputes each offset from the *current* bar's
ATR rather than freezing it at entry, so stops are volatility-following
approximations of the fixed-at-entry Pine stops.
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


def _compute_rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(close)
    rsi = np.full(n, np.nan)
    if n < period + 1:
        return rsi
    deltas = np.diff(close)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    for i in range(period, n - 1):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else 1e9
        rsi[i + 1] = 100 - (100 / (1 + rs))
    return rsi


def _compute_atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    tr = compute_true_range(high, low, close)
    n = len(tr)
    atr = np.zeros(n)
    if n < period:
        return atr
    atr[period - 1] = np.mean(tr[:period])
    for i in range(period, n):
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period
    return atr


def _adx_thresholds(reduction_level: str) -> Tuple[float, float, float]:
    """Returns (adxThreshold, rsiThreshLong, rsiThreshShort)."""
    if reduction_level == "High":
        return 35.0, 60.0, 40.0
    if reduction_level == "Medium":
        return 25.0, 70.0, 30.0
    return 20.0, 80.0, 20.0  # Low


def build_signals_bot4(df: pd.DataFrame, config: StrategyConfig) -> pd.DataFrame:
    """
    Compute BOT4 - 770 SHORT+LONG entry/exit signals plus ATR stop/target offsets.

    Returns a DataFrame indexed by date with the engine columns
    (``Open/High/Low/Close`` + ``long_entry/long_exit/short_entry/short_exit``)
    and, when applicable, the side-specific risk columns
    (``long_sl_offset`` / ``short_sl_offset`` / ``long_tp_offset`` /
    ``short_tp_offset`` / ``long_trail_offset`` / ``short_trail_offset``).
    Signals are not date-masked (the engine windows trading by
    ``config.startDate..endDate``). See the module docstring for the
    risk-management mapping and its limits.
    """
    open_ = df["open"].values.astype(float)
    high = df["high"].values.astype(float)
    low = df["low"].values.astype(float)
    close = df["close"].values.astype(float)
    volume = df["volume"].values.astype(float) if "volume" in df.columns else np.ones(len(close))
    dates = df.index

    n = len(close)

    # ── Gaussian channel ──────────────────────────────────────────────────────
    src = (high + low + close) / 3.0  # hlc3
    per = config.samplingPeriod
    N = config.poles
    mult = config.ftrMultiplier

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

    # ── Indicators ────────────────────────────────────────────────────────────
    adx_thr, rsi_thr_long, rsi_thr_short = _adx_thresholds(config.reductionLevel)

    sma200 = compute_sma(close, 200)

    # SMA200 slope gate: sma200 < sma200[smaSlopeLen]
    slope_len = config.smaSlopeLen
    sma200_shifted = np.concatenate([np.full(slope_len, sma200[0]), sma200[:-slope_len]])
    sma200_down = sma200 < sma200_shifted

    adx_len = config.adxLength if config.useAdxFilter else 14
    adx_arr, di_plus, di_minus = compute_adx(high, low, close, adx_len)

    adx_len_s = config.shortAdxLength if config.shortUseAdxFilter else 14
    if adx_len_s == adx_len:
        adx_arr_s, di_plus_s, di_minus_s = adx_arr, di_plus, di_minus
    else:
        adx_arr_s, di_plus_s, di_minus_s = compute_adx(high, low, close, adx_len_s)

    rsi_arr = _compute_rsi(close, config.rsiLength) if (config.useRsiFilter or config.useRsiFilterShort) else np.zeros(n)
    rsi_arr_s = _compute_rsi(close, config.rsiLengthShort) if config.useRsiFilterShort else np.zeros(n)

    vol_ma = compute_sma(volume, config.volumeMaLength) if config.useVolumeFilter else np.zeros(n)
    vol_ma_s = compute_sma(volume, config.volumeMaLengthShort) if config.useVolumeFilterShort else np.zeros(n)

    atr_stop = _compute_atr(high, low, close, config.stopAtrLength)

    # ── Entry/exit lines ──────────────────────────────────────────────────────
    short_entry_line = lband if config.shortEntryMode == "Lower Band" else filt
    short_exit_line = lband if config.shortExitMode == "Lower Band" else filt

    # ── Raw crossover signals ─────────────────────────────────────────────────
    raw_long_cross = crossover(close, hband)
    raw_short_cross = crossunder(close, short_entry_line)
    raw_exit_long = crossunder(close, hband)
    if config.allowCloseBelowSma:
        raw_exit_long = raw_exit_long | (close < sma200)
    raw_exit_short = crossover(close, short_exit_line)

    # ── Confirmed signals (shift by confirmBars - 1) ─────────────────────────
    def _confirm(arr: np.ndarray, bars: int) -> np.ndarray:
        if bars <= 1:
            return arr
        result = np.zeros(n, dtype=bool)
        result[bars - 1:] = arr[:n - bars + 1]
        return result

    long_cond = _confirm(raw_long_cross, config.confirmBarsLong)
    exit_long_cond = raw_exit_long  # no confirmation on exits

    # Long filters
    if config.useAdxFilter:
        long_cond = long_cond & (adx_arr > adx_thr)
    if config.useSmaFilter:
        long_cond = long_cond & (close > sma200)
    if config.useRsiFilter:
        long_cond = long_cond & (rsi_arr < rsi_thr_long)
    if config.useVolumeFilter:
        long_cond = long_cond & (volume > vol_ma)

    # Short regime gate
    if config.shortRegimeMode == "Off":
        regime_ok = np.ones(n, dtype=bool)
    elif config.shortRegimeMode == "Below SMA200":
        regime_ok = close < sma200
    else:  # "SMA200 Down"
        regime_ok = (close < sma200) & sma200_down

    filt_prev = np.roll(filt, 1)
    filt_prev[0] = filt[0]
    trend_ok = (filt < filt_prev) if config.requireFilterDownForShort else np.ones(n, dtype=bool)
    di_ok = (di_minus_s > di_plus_s) if config.requireDiBearishForShort else np.ones(n, dtype=bool)

    short_cond_raw = _confirm(raw_short_cross, config.confirmBarsShort) if config.enableShorts else np.zeros(n, dtype=bool)

    short_cond = short_cond_raw & regime_ok & trend_ok & di_ok
    if config.shortUseAdxFilter:
        short_cond = short_cond & (adx_arr_s > adx_thr)
    if config.shortUseSmaFilter:
        short_cond = short_cond & (close < sma200)
    if config.useRsiFilterShort:
        short_cond = short_cond & (rsi_arr_s > (100 - rsi_thr_short))
    if config.useVolumeFilterShort:
        short_cond = short_cond & (volume > vol_ma_s)

    exit_short_cond = raw_exit_short

    out = pd.DataFrame(
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

    # ── Risk management → engine offset columns ───────────────────────────────
    # Use the same per-bar ATR fallback as the original (price * 2% when ATR is
    # not yet warmed up) so an offset is never zero inside the trading window
    # (a zero offset would disable the level in the engine).
    cur_atr_stop = np.where(atr_stop > 0, atr_stop, close * 0.02)

    long_short = config.enableShorts  # bot4 runs long+short when shorts enabled

    # Side-asymmetric hard stops. The engine selects the column matching the open
    # side, so long and short get their own ATR multiple (longStopMult vs
    # shortStopMult) — no longer collapsed onto a single shared offset.
    if config.useHardStop:
        out["long_sl_offset"] = cur_atr_stop * config.longStopMult
        if long_short:
            out["short_sl_offset"] = cur_atr_stop * config.shortStopMult

    # Side-asymmetric take-profits (independent enable flags + multipliers). The
    # short TP now fires in long+short runs because it has its own column rather
    # than competing with the long side for a single shared tp_offset.
    if config.useLongTP:
        out["long_tp_offset"] = cur_atr_stop * config.longTpMult
    if long_short and config.useShortTP:
        out["short_tp_offset"] = cur_atr_stop * config.shortTpMult

    # Trailing stop: ATR(trailAtrLength) * trailAtrMult, trailing the running
    # extreme since entry (the engine tracks the extreme; this column only carries
    # the per-bar distance). Applies to whichever side is open.
    if config.useTrailingStop:
        atr_trail = _compute_atr(high, low, close, config.trailAtrLength)
        cur_atr_trail = np.where(atr_trail > 0, atr_trail, close * 0.02)
        trail_offset = cur_atr_trail * config.trailAtrMult
        out["long_trail_offset"] = trail_offset
        if long_short:
            out["short_trail_offset"] = trail_offset

    return out
