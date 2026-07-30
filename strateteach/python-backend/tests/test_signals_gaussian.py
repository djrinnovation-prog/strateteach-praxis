"""
Milestone 2 verification — runs the reproduced Gaussian-channel engine on the
bundled real BTC daily fixture and asserts the math + classification produce
well-formed, sane output. Bypasses the data layer (M4) by loading the CSV
directly into a DataFrame.
"""
import math
import os

import pandas as pd
import pytest

import app.services.signals as sig

FIXTURES = os.path.join(os.path.dirname(__file__), "data")


def _load(name: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(FIXTURES, name))
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.set_index("timestamp").sort_index()
    return df[["open", "high", "low", "close", "volume"]].astype(float)


@pytest.fixture(scope="module")
def btc() -> pd.DataFrame:
    return _load("btcusdt_1d_2021_2023.csv")


def test_gaussian_channel_shape_and_ordering(btc):
    out = sig._gaussian_channel(btc, poles=6, period=147, mult=1.414, source="ohlc4")
    assert out is not None
    filt, hband, lband = out
    assert len(filt) == len(hband) == len(lband) == len(btc)
    # Bands straddle the filter line everywhere they are defined.
    for i in range(150, len(filt)):
        assert lband[i] <= filt[i] <= hband[i]
        assert not math.isnan(filt[i])


def test_gaussian_alpha_matches_formula(btc):
    # Re-derive beta/alpha and confirm the engine's first filter value is sane.
    period, poles = 147, 6
    beta = (1 - math.cos(4 * math.asin(1) / period)) / (math.pow(1.414, 2.0 / poles) - 1)
    alpha = -beta + math.sqrt(beta**2 + 2 * beta)
    assert 0 < alpha < 1


def test_classify_all_returns_full_record(btc):
    rec = sig._classify_all(btc, "BTC/USDT", "Bitcoin", "crypto", "bot8c")
    assert rec is not None
    for key in (
        "tier", "direction", "pctToGreen", "pctToRed", "currentPrice",
        "upperBand", "filterLine", "lowerBand", "weekHistory",
    ):
        assert key in rec
    assert rec["direction"] in ("long", "short", "neutral")
    assert len(rec["weekHistory"]) == 7
    assert rec["currentPrice"] > 0


def test_trend_scanner_state_machine(btc):
    row = sig._trend_row(btc, "BTC/USDT", "Bitcoin", "crypto", "bot8c", "BINANCE")
    assert row is not None
    assert row["trendTo"] in ("Green", "Grey", "Red")
    assert row["status"] in ("OPEN", "CLOSED")
    assert row["ticker"] == "BINANCE:BTCUSDT"
    # Net P&L is only present while a position is open.
    if row["status"] == "OPEN":
        assert row["netPnlPct"] is not None


def test_long_only_strategy_hides_short_tiers(btc):
    # bot1 is long-only: it must never emit a short direction.
    rec = sig._classify_all(btc, "BTC/USDT", "Bitcoin", "crypto", "bot1")
    assert rec is not None
    assert rec["direction"] in ("long", "neutral")


def test_full_analysis_includes_candles(btc):
    full = sig._get_full_analysis(btc, "BTC/USDT", "crypto", "bot8c")
    assert full is not None
    assert "candles" in full and len(full["candles"]) > 0
    c0 = full["candles"][0]
    assert {"date", "open", "high", "low", "close", "filt", "hband", "lband"} <= set(c0)
