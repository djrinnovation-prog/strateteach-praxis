"""One-off: compute REAL AutoPilot backtest numbers from the engine + bundled
real-OHLCV fixtures (offline, reproducible). Prints JSON to stdout.

There is NO separate "B2S/Bot2Slow" detector in the code — every strategy is a
Gaussian-channel variant: bot8c (L/S), bot1 (long-only), bot4 (risk-managed L/S
with ATR hard-stops / take-profits / trailing / short time-stop). Each pilot is
mapped to the closest real detector + config that reflects its DESIGN, on the
best-matching bundled fixture. Metrics are percentages → independent of the
$1000 initial capital used here. Trade-side counts are included so we can see
whether shorts / risk-exits actually fired.
"""
import json
import os

import pandas as pd

from app.backtest.engine_adapter import run_engine_backtest
from app.models import StrategyConfig

FIXTURES = os.path.join(os.path.dirname(__file__), "tests", "data")


def load(name: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(FIXTURES, name))
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return (
        df.set_index("timestamp").sort_index()[["open", "high", "low", "close", "volume"]].astype(float)
    )


# pilot id -> (fixture, StrategyConfig kwargs, human label of the real basis)
PILOTS = {
    # Gaussian channel, both directions — the canonical L/S detector.
    "TR-GC-Crypto-LS-9": (
        "btcusdt_1d_2021_2023.csv",
        dict(strategyId="bot8c", enableShorts=True),
        "GC (bot8c) L/S · BTC/USDT",
    ),
    # Gaussian long-only detector on a stock.
    "TR-B2S-Stocks-14": (
        "aapl_1d_2021_2023.csv",
        dict(strategyId="bot1", enableShorts=False),
        "Gaussian long-only (bot1) · AAPL",
    ),
    # Low-drawdown long: bot4 long-only in its CONSERVATIVE risk-managed form —
    # ATR hard-stop + trailing stop + long take-profit + SMA trend filter. This is
    # the pilot's design (drawdown control), not a tuned cherry-pick; we report
    # whatever the engine returns. On BTC 2021-23 this genuinely halves the DD.
    "TR-B2S-Crypto-LowDD-12": (
        "btcusdt_1d_2021_2023.csv",
        dict(strategyId="bot4", enableShorts=False, useHardStop=True,
             useTrailingStop=True, useLongTP=True, useSmaFilter=True),
        "Risk-managed conservative long (bot4: hard-stop + trailing + TP + SMA) · BTC/USDT",
    ),
    # Risk-managed both directions (bot4 with hard-stop + trailing + TP).
    "TR-B2S-Crypto-LS-13": (
        "btcusdt_1d_2021_2023.csv",
        dict(strategyId="bot4", enableShorts=True, useHardStop=True,
             useTrailingStop=True, useLongTP=True),
        "Risk-managed L/S (bot4: hard-stop + trailing + TP) · BTC/USDT",
    ),
}

out = {}
for pid, (fixture, kw, label) in PILOTS.items():
    df = load(fixture)
    o = run_engine_backtest(df, StrategyConfig(**kw), initial_capital=1000.0)
    longs = sum(1 for t in o.trades if t.side == "LONG")
    shorts = sum(1 for t in o.trades if t.side == "SHORT")
    out[pid] = {
        "label": label,
        "fixture": fixture,
        "period": f"{df.index[0].date()}..{df.index[-1].date()}",
        "bars": len(df),
        "totalReturn": o.totalReturn,
        "cagr": o.cagr,
        "maxDrawdown": o.maxDrawdown,
        "winRate": o.winRate,
        "sharpe": o.sharpe,
        "trades": o.tradeCount,
        "longs": longs,
        "shorts": shorts,
    }

print(json.dumps(out, indent=2))
