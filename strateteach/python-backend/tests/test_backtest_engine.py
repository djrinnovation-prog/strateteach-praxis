# NOTE: these fixtures assert parity with TradingView goldens, which were produced
# with ZERO slippage — so they pin slippageTicks=0. Product defaults apply real
# slippage (see apply_slippage in engine.py); that is deliberate, not a regression.
"""
Milestone 3 golden-master regression — runs the backtest engine on the bundled
fixtures and pins KPIs/trade counts. Per the project rules, if an *intended*
engine/signal change moves these, regenerate the goldens deliberately; never
tweak the engine just to make this pass.
"""
import os

import pandas as pd
import pytest

from app.backtest.engine_adapter import run_engine_backtest
from app.models import StrategyConfig

FIXTURES = os.path.join(os.path.dirname(__file__), "data")

# (fixture, strategyId) -> {totalReturn, tradeCount}
GOLDEN = {
    ("btcusdt_1d_2021_2023.csv", "bot8c"): {"ret": 94.10, "trades": 11},
    ("aapl_1d_2021_2023.csv", "bot4"):     {"ret": 17.85, "trades": 15},
    ("goldfut_1d_2021_2023.csv", "bot1"):  {"ret": 6.01, "trades": 9},
    ("crudeoil_1d_2021_2023.csv", "bot8c"): {"ret": -6.32, "trades": 15},
}


def _load(name: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(FIXTURES, name))
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.set_index("timestamp").sort_index()[["open", "high", "low", "close", "volume"]].astype(float)


@pytest.mark.parametrize("fixture,strat", list(GOLDEN.keys()))
def test_backtest_kpis_match_golden(fixture, strat):
    out = run_engine_backtest(_load(fixture), StrategyConfig(strategyId=strat, slippageTicks=0), initial_capital=1000.0)
    g = GOLDEN[(fixture, strat)]
    assert out.tradeCount == g["trades"], f"{fixture}/{strat}: trade count drifted"
    assert abs(out.totalReturn - g["ret"]) < 0.05, f"{fixture}/{strat}: return drifted to {out.totalReturn}"
    assert len(out.equityCurve) > 0
    assert out.maxDrawdown >= 0


def test_bot1_is_long_only():
    out = run_engine_backtest(_load("goldfut_1d_2021_2023.csv"), StrategyConfig(strategyId="bot1", slippageTicks=0), 1000.0)
    assert all(t.side == "LONG" for t in out.trades)
