"""One-time generator for the frozen real-market OHLCV test snapshots.

This script fetches real daily candles for a few representative symbols — one per
asset class the product trades — and writes them to CSVs that are committed to the
repo and used by the regression harness (``tests/test_real_data_regression.py``
and ``tests/test_real_data_regression_assets.py``). Unlike the synthetic fixture
in ``tests/conftest.py``, these capture the gaps, volatility clustering, and
irregular crossovers of real price action so the backtest engine is exercised
against realistic data.

Why more than one asset class: equities/metals/commodities don't trade on the
crypto 24/7 calendar — they gap over weekends and market holidays, run different
volatility regimes, and (for stocks) get split/dividend back-adjusted. Those are
price shapes the BTC/USDT snapshot can't reproduce, so pinning one snapshot per
class catches engine drift the crypto snapshot would miss.

The snapshots are **frozen**: they span a fixed historical window (no moving
"today" endpoint) so the committed CSVs are stable test data. Regenerate them
deliberately, never auto-refresh — regenerating changes the pinned KPIs in the
tests and should be reviewed as such.

Reproducibility caveat: the crypto snapshot (via ccxt) reproduces byte-identical
on re-run. The equity snapshots (via yfinance, ``auto_adjust=True``) are
back-adjusted for later splits/dividends, so re-running this script months later
can shift a stock's historical prices slightly. That's fine for frozen test data
— it just means a regenerated equity snapshot must be re-pinned and reviewed.

Usage (from python-backend/):
    python3 -m data.snapshot_generator            # generate every snapshot
    python3 -m data.snapshot_generator crypto     # only the crypto snapshot
    python3 -m data.snapshot_generator assets      # only the equity snapshots

Network access is required to run this script; the committed CSVs mean the tests
themselves never hit the network.
"""
from __future__ import annotations

import os
import sys

import pandas as pd

from app.data.crypto import fetch_crypto_ohlcv
from app.data.equities import fetch_equity_ohlcv

# Fixed historical window shared by every snapshot. Three full calendar years
# (2021-2023) span a strong run, a sharp drawdown, and a choppy recovery; 2021
# acts as warmup so the trading window the tests use starts 2022-01-01.
TIMEFRAME = "1d"
FETCH_START = "2021-01-01"
FETCH_END = "2024-01-01"   # exclusive upper bound for yfinance
SNAPSHOT_START = "2021-01-01"
SNAPSHOT_END = "2023-12-31"

_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests",
    "data",
)

# Representative crypto symbol (24/7 calendar, fetched via ccxt).
CRYPTO_SYMBOL = "BTC/USDT"
CRYPTO_OUTPUT = os.path.join(_DATA_DIR, "btcusdt_1d_2021_2023.csv")

# One representative symbol per non-crypto bucket. These all trade on the
# exchange calendar (weekend/holiday gaps) and are fetched via yfinance.
EQUITY_SNAPSHOTS = [
    {"symbol": "AAPL", "filename": "aapl_1d_2021_2023.csv", "label": "Apple (stock)"},
    {"symbol": "GC=F", "filename": "goldfut_1d_2021_2023.csv", "label": "Gold Futures (metal)"},
    {"symbol": "CL=F", "filename": "crudeoil_1d_2021_2023.csv", "label": "Crude Oil WTI (commodity)"},
]


def _write_snapshot(df: pd.DataFrame, output_path: str, label: str) -> None:
    df = df.loc[SNAPSHOT_START:SNAPSHOT_END]
    if df.empty:
        raise SystemExit(f"Snapshot window is empty after slicing for {label}")
    df.index.name = "timestamp"
    df = df[["open", "high", "low", "close", "volume"]]
    df.to_csv(output_path, float_format="%.8f")
    print(f"Wrote {len(df)} bars ({df.index.min().date()}..{df.index.max().date()}) "
          f"for {label} to {output_path}")


def generate_crypto() -> None:
    df = fetch_crypto_ohlcv(CRYPTO_SYMBOL, TIMEFRAME, start_date=FETCH_START)
    if df is None or df.empty:
        raise SystemExit(f"Fetch returned no data for {CRYPTO_SYMBOL}")
    _write_snapshot(df, CRYPTO_OUTPUT, f"{CRYPTO_SYMBOL} (crypto)")


def generate_assets() -> None:
    for spec in EQUITY_SNAPSHOTS:
        df = fetch_equity_ohlcv(
            spec["symbol"], TIMEFRAME, start_date=FETCH_START, end_date=FETCH_END
        )
        if df is None or df.empty:
            raise SystemExit(f"Fetch returned no data for {spec['symbol']}")
        _write_snapshot(df, os.path.join(_DATA_DIR, spec["filename"]), spec["label"])


def generate() -> None:
    generate_crypto()
    generate_assets()


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "all"
    if target == "crypto":
        generate_crypto()
    elif target == "assets":
        generate_assets()
    else:
        generate()
