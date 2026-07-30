"""DR Crypto trend strategy — CANONICAL definitions (Phase 2c). ⚠️ NEW · SIMULATION-ONLY.

Provenance-clean, published TA implemented by us: a long-only trend-rider on the crypto universe —
Donchian(20) breakout entry + 200-SMA regime filter + a canonical ROLLING Chandelier(22, 3) trailing
stop (Chuck LeBeau). The rolling chandelier makes the exit STATELESS: the scan computes the current
stop level per symbol and the paper-sim just compares the live price to it (no per-position high-water
storage) — exactly the statelessness Pilot 6 (MR) has. This module is strategy MATH ONLY: it places no
orders, moves no money, and imports nothing from the live executor.

Validated (our engine, net of 0.2% RT fees + 5 bps/side slippage, 2018→now ~8.5y, 8-pos cap):
NET ≈ +527% · ~+24%/yr · maxDD ≈ −17% · ~540 trades · win ~36% (trend profile: few big winners).
Read ONLY the dedicated ``daily_scan_dr_crypto`` singleton; runs ONLY in the paper-sim (dr_sim.py).
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

# Published/canonical defaults — the only constants.
DONCH = 20        # Donchian breakout channel (classic Turtle entry)
SMA_REGIME = 200  # long-term trend regime gate
ATR_LEN = 22      # Chandelier ATR + lookback (LeBeau default)
CHAND_MULT = 3.0  # Chandelier multiplier (LeBeau default)
WARMUP_BARS = SMA_REGIME + 10


def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = ATR_LEN) -> np.ndarray:
    pc = np.roll(close, 1); pc[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - pc), np.abs(low - pc)))
    return pd.Series(tr).ewm(alpha=1 / period, adjust=False).mean().values


def compute_indicators(df: pd.DataFrame) -> dict:
    h = df["high"].values.astype(float); l = df["low"].values.astype(float); c = df["close"].values.astype(float)
    a14 = _atr(h, l, c, 14)
    return {
        "c": c,
        "donch": pd.Series(h).shift(1).rolling(DONCH).max().values,          # prior-20-day high (no lookahead)
        "sma200": pd.Series(c).rolling(SMA_REGIME).mean().values,
        "chand": pd.Series(h).rolling(ATR_LEN).max().values - CHAND_MULT * _atr(h, l, c),  # rolling Chandelier stop
        "atrpct": np.divide(a14, c, out=np.full_like(a14, 0.05), where=c > 0),   # ATR%/price — for vol-targeting
    }


# ── RISK MODES — the operational sizing/risk profile the sim engine (dr_sim) applies ─────────
# Modes differ ONLY in SIZING/risk (compound fraction, vol-target, drawdown-guard, exposure cap) —
# NOT in entry/exit signals — so all modes take the same trade set (dd-guard RESIZES, it does not
# pause, per the honest R&D: pause costs ~9x more return for ~1% less DD). Canonical, pre-specified.
TARGET_VOL = 0.05   # reference daily ATR% anchor for constant-risk vol-targeting
DR_DEFAULT_MODE = "smooth"
DR_MODE_CONFIGS: "dict[str, dict[str, Any]]" = {
    "aggressive": {"per_frac": 0.125, "vol_tgt": False, "dd_guard": None, "expo_cap": 1.0},
    "smooth":     {"per_frac": 0.125, "vol_tgt": True,  "dd_guard": 0.25, "expo_cap": 1.0},
    "safe":       {"per_frac": 0.08,  "vol_tgt": True,  "dd_guard": 0.25, "expo_cap": 0.70},
}


def mode_config(mode: "str | None") -> dict:
    return DR_MODE_CONFIGS.get(mode or DR_DEFAULT_MODE, DR_MODE_CONFIGS[DR_DEFAULT_MODE])


# ── DR PILOT registry — the strategy's own scan + entry/exit logic ───────────────────────────
# In SIMULATION mode DR-Crypto runs through the paper engine (dr_sim). It is now also
# LIVE-CAPABLE (spot · long-only) exactly like the tier pilots: when the owner arms it live +
# the master gate is ON + keys are connected, autopilot_live routes it through the full gated
# executor, reading THIS scan (daily_scan_dr_crypto). ``liveCapable`` is a marker only.
DR_PILOTS: "dict[str, dict[str, Any]]" = {
    "DR-Crypto-Trend": {
        "strategy": "dr_trend",
        "market": "crypto",
        "direction": "long-only",
        "maxPositions": 8,
        "liveCapable": True,   # spot · long-only, through the gated live executor (was paperSimOnly)
        "new": True,
    },
}


def snapshot_exit(current_price: float, sig: dict) -> "tuple[bool, str]":
    """Stateless trailing exit from the latest scan snapshot: exit when price breaks below the
    rolling Chandelier stop, or below the 200-SMA (regime lost). Single source of truth for the
    paper-sim engine."""
    if current_price is None or sig is None:
        return False, ""
    chand = sig.get("chandStop")
    if chand is not None and current_price < chand:
        return True, "chandelier"
    sma200 = sig.get("sma200")
    if sma200 is not None and current_price < sma200:
        return True, "regime"
    return False, ""


def latest_signal(df: pd.DataFrame, symbol: str, name: str, exch_id: "str | None" = None) -> "dict | None":
    """Per-symbol latest-bar snapshot the DR scan caches: price + entry flag (Donchian breakout above
    the 200-SMA) + the chandelier stop and 200-SMA for the stateless trailing exit. Returns None when
    there isn't enough history for a valid 200-SMA (no fabricated signal on thin data)."""
    if df is None or len(df) < WARMUP_BARS:
        return None
    ind = compute_indicators(df)
    i = len(ind["c"]) - 1
    c = ind["c"][i]; donch = ind["donch"][i]; sma200 = ind["sma200"][i]; chand = ind["chand"][i]
    if not (np.isfinite(c) and c > 0 and np.isfinite(sma200) and np.isfinite(donch)):
        return None
    return {
        "symbol": symbol,
        "name": name,
        "bucket": "crypto",
        "exchId": exch_id,
        "currentPrice": round(float(c), 8),
        "donchUp": round(float(donch), 8),
        "sma200": round(float(sma200), 8),
        "chandStop": round(float(chand), 8) if np.isfinite(chand) else None,
        "atrPct": round(float(ind["atrpct"][i]), 5) if np.isfinite(ind["atrpct"][i]) and ind["atrpct"][i] > 0 else 0.05,
        "aboveRegime": bool(c > sma200),
        # canonical entry flag: fresh Donchian breakout while above the long-term trend.
        "entry": bool(c > donch and c > sma200),
    }
