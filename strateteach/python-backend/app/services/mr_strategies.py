"""Mean-Reversion sleeve — CANONICAL strategy definitions (Phase 2b). ⚠️ NEW · PAPER-SIM-ONLY.

STRICT MONEY / IP SAFETY
────────────────────────
This module defines strategy MATH ONLY. It places no orders, moves no money, touches no
live gate, and imports nothing from the live-capable AutoPilot engine (autopilot_live /
autopilot_sim). It is consumed exclusively by the dedicated stocks mean-reversion scan
(``mr_scan.py``) and its gated paper simulation. Nothing here is wired to real capital.

PROVENANCE — clean (this is why the sleeve exists)
──────────────────────────────────────────────────
Unlike the Trend-Radar pilots (reference-only exports of a colleague's Gaussian model),
every rule below is a PUBLISHED, canonical technical-analysis definition implemented BY US
from its public specification, with the author's canonical DEFAULTS and NO tune-to-target:

  • RSI(2) mean-reversion  — Larry Connors, "Short Term Trading Strategies That Work" (RSI-2).
  • Bollinger Bands(20, 2) — John Bollinger, "Bollinger on Bollinger Bands" (20-SMA ± 2σ).
  • 200-SMA regime filter  — the classic long-term trend gate (take longs only in an uptrend).

PHASE-2a FINDING THIS ENCODES
─────────────────────────────
RSI2 + Bollinger mean-reversion showed a REAL net-of-fee edge (win 61–67%, ~4-day holds),
best on STOCKS. Both strategies' only structural weakness was the 2022 bear (dip-buying into
a downtrend). The published fix — the 200-SMA regime guard, "longs only when price > 200-SMA"
— is applied to BOTH strategies here (Connors' RSI2 already prescribes it; per Dan we extend
the SAME published filter to Bollinger). This is a canonical filter, NOT target-tuning.

The entry/exit rules are copied VERBATIM from the Phase-2a backtest harness
(phase2a_analysis/sim2.py) so the paper sim measures the SAME strategy the research validated.
"""
from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd

# ── Published / canonical defaults — the ONLY constants, all from the source texts ──────────
RSI_PERIOD = 2          # Connors RSI-2
RSI_ENTRY = 10.0        # Connors: RSI(2) below 10 = oversold pullback in an uptrend
BB_PERIOD = 20          # Bollinger: 20-period SMA basis
BB_K = 2.0              # Bollinger: ±2 standard deviations
SMA_FAST = 5            # Connors RSI2 exit: close back above the 5-SMA
SMA_MID = 20            # Bollinger exit: close back to the middle band (20-SMA)
SMA_REGIME = 200        # 200-SMA long-term trend regime gate
TIME_STOP_BARS = 10     # Connors' canonical N-bar time-stop for both mean-reversion exits
WARMUP_BARS = SMA_REGIME + 10   # bars needed before any signal is valid (200-SMA warmup)


# ── Canonical indicators — verbatim from phase2a_analysis/sim2.py ───────────────────────────
def rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Wilder's RSI (EWM smoothing), matching the Phase-2a harness exactly."""
    d = np.diff(close, prepend=close[0])
    up = np.clip(d, 0, None)
    dn = np.clip(-d, 0, None)
    ru = pd.Series(up).ewm(alpha=1 / period, adjust=False).mean().values
    rd = pd.Series(dn).ewm(alpha=1 / period, adjust=False).mean().values
    rs = np.divide(ru, rd, out=np.full_like(ru, np.inf), where=rd != 0)
    return 100 - 100 / (1 + rs)


def sma(x: np.ndarray, n: int) -> np.ndarray:
    return pd.Series(x).rolling(n).mean().values


def bb_lower(close: np.ndarray, n: int = BB_PERIOD, k: float = BB_K) -> np.ndarray:
    """Bollinger lower band = SMA(n) − k·σ(n), population std (ddof=0), as in sim2.py."""
    basis = sma(close, n)
    sd = pd.Series(close).rolling(n).std(ddof=0).values
    return basis - k * sd


def compute_indicators(df: pd.DataFrame) -> dict:
    """Compute every array the mean-reversion strategies need from an OHLCV DataFrame
    (columns: open/high/low/close/volume). Returns None-safe numpy arrays."""
    c = df["close"].values.astype(float)
    return {
        "c": c,
        "rsi2": rsi(c, RSI_PERIOD),
        "sma5": sma(c, SMA_FAST),
        "sma20": sma(c, SMA_MID),
        "sma200": sma(c, SMA_REGIME),
        "bb_lo": bb_lower(c, BB_PERIOD, BB_K),
    }


# ── Strategy definitions — entry/exit closures, mirroring the pilot pattern ──────────────────
# Each strategy is a plain dict with entry(ind, i) and exit(ind, j, entry_idx, entry_price)
# — the SAME shape the Phase-2a harness used — so the paper-sim engine and any replay harness
# can drive them identically. All long-only. The 200-SMA regime guard is in BOTH entries.

def _rsi2_entry(a: dict, i: int) -> bool:
    # Connors: RSI(2) < 10 AND price above the 200-SMA (only dip-buy inside an uptrend).
    return bool((a["rsi2"][i] < RSI_ENTRY) and (a["c"][i] > a["sma200"][i]))


def _rsi2_exit(a: dict, j: int, ei: int, e: float) -> "tuple[bool, str]":
    if a["c"][j] >= a["sma5"][j]:
        return True, "target"          # closed back above the 5-SMA
    if j - ei >= TIME_STOP_BARS:
        return True, "time"            # canonical 10-bar time-stop
    return False, ""


def _bb_entry(a: dict, i: int) -> bool:
    # Bollinger lower-band reversion + the SAME 200-SMA regime guard (Dan-approved,
    # published filter — fixes the Phase-2a 2022-bear weakness; NOT target-tuning).
    return bool((a["c"][i] < a["bb_lo"][i]) and (a["c"][i] > a["sma200"][i]))


def _bb_exit(a: dict, j: int, ei: int, e: float) -> "tuple[bool, str]":
    if a["c"][j] >= a["sma20"][j]:
        return True, "target"          # reverted to the middle band (20-SMA)
    if j - ei >= TIME_STOP_BARS:
        return True, "time"
    return False, ""


# Strategy registry — the canonical mean-reversion pair carried forward from Phase 2a.
MR_STRATEGIES: "dict[str, dict[str, Any]]" = {
    "rsi2": {
        "key": "rsi2",
        "label": "RSI(2) Mean-Reversion",
        "labelHe": "היפוך ממוצע · RSI(2)",
        "kind": "oscillator mean-reversion",
        "source": "Connors RSI-2 (published)",
        "rule": "Buy RSI(2)<10 while price>200-SMA; exit close≥5-SMA or 10-bar time-stop.",
        "entry": _rsi2_entry,
        "exit": _rsi2_exit,
    },
    "bb": {
        "key": "bb",
        "label": "Bollinger(20,2) Reversion",
        "labelHe": "היפוך רצועות בולינגר(20,2)",
        "kind": "volatility-band reversion",
        "source": "Bollinger Bands (published) + 200-SMA regime guard",
        "rule": "Buy close<lower band while price>200-SMA; exit close≥20-SMA (mid) or 10-bar time-stop.",
        "entry": _bb_entry,
        "exit": _bb_exit,
    },
}


def strategy(key: str) -> "dict[str, Any]":
    return MR_STRATEGIES[key]


# ── Paper-sim PILOT registry ─────────────────────────────────────────────────────────────────
# SIMULATION-only pilots. They read ONLY the dedicated stocks-MR scan singleton
# (daily_scan_stocks_mr) and run through the paper-sim engine (mr_sim.py), never a live order
# path. ``paperSimOnly`` is a hard, explicit marker.
#
# RSI2 was DROPPED as a shippable pilot after Checkpoint 3 (its net-of-fees+slippage edge was
# too thin — near breakeven under stress slippage). The rsi2 STRATEGY math is retained above
# for provenance/parity tests, but it is intentionally NOT registered as a pilot here. Only
# Bollinger(20,2)+200-SMA — which survived fees + modeled slippage — ships.
MR_PILOTS: "dict[str, dict[str, Any]]" = {
    "MR-BB-Stocks": {
        "strategy": "bb",
        "market": "stocks",
        "direction": "long-only",
        "maxPositions": 8,
        "paperSimOnly": True,
        "new": True,
    },
}


def snapshot_exit(strategy_key: str, current_price: float, sig: dict, held_bars: int) -> "tuple[bool, str]":
    """Live-sim exit decision for a HELD position, from the latest scan snapshot + the
    position's age. Same canonical rule as ``exit`` above, expressed on today's values:
      • RSI2 → close ≥ 5-SMA (target)      • Bollinger → close ≥ 20-SMA / mid (target)
      • either → 10-bar time-stop.
    Single source of truth for both the paper-sim engine and the replay harness."""
    if current_price is not None:
        if strategy_key == "rsi2":
            mid = (sig or {}).get("sma5")
            if mid is not None and current_price >= mid:
                return True, "target"
        elif strategy_key == "bb":
            mid = (sig or {}).get("sma20")
            if mid is not None and current_price >= mid:
                return True, "target"
    if held_bars >= TIME_STOP_BARS:
        return True, "time"
    return False, ""


def latest_signal(df: pd.DataFrame, symbol: str, name: str) -> "dict | None":
    """Build the per-symbol snapshot the dedicated MR scan caches. Carries the latest bar's
    price + the indicator values BOTH strategies need (entry flags for opening; sma5/sma20/
    sma200 for the held-position exit checks). Returns None if there isn't enough history
    for a valid 200-SMA (no fabricated signal on thin data)."""
    if df is None or len(df) < WARMUP_BARS:
        return None
    ind = compute_indicators(df)
    i = len(ind["c"]) - 1
    c = ind["c"][i]
    sma200 = ind["sma200"][i]
    if not (np.isfinite(c) and c > 0 and np.isfinite(sma200)):
        return None
    return {
        "symbol": symbol,
        "name": name,
        "bucket": "stocks",
        "currentPrice": round(float(c), 6),
        "rsi2": round(float(ind["rsi2"][i]), 2) if np.isfinite(ind["rsi2"][i]) else None,
        "sma5": round(float(ind["sma5"][i]), 6) if np.isfinite(ind["sma5"][i]) else None,
        "sma20": round(float(ind["sma20"][i]), 6) if np.isfinite(ind["sma20"][i]) else None,
        "sma200": round(float(sma200), 6),
        "bbLower": round(float(ind["bb_lo"][i]), 6) if np.isfinite(ind["bb_lo"][i]) else None,
        "aboveRegime": bool(c > sma200),
        # Precomputed entry flags for each strategy (the scan is the single source of truth).
        "entry": {
            "rsi2": _rsi2_entry(ind, i),
            "bb": _bb_entry(ind, i),
        },
    }
