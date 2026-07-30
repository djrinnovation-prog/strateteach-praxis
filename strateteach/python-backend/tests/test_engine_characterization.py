"""
Characterization (golden) test for the backtest engine — the safety net for the
planned `run_backtest` / `run_backtest_long_short` de-duplication.

WHY THIS EXISTS
    The two backtest functions in app/engine/engine.py share ~180 identical
    lines. Consolidating them is worthwhile, but they sit on the money path, so
    a silent change to any KPI is unacceptable. This test pins the CURRENT
    output of both functions for a fixed, deterministic input. Run it BEFORE the
    refactor (it passes — that's the baseline) and AFTER (it must still pass). If
    any number moves, the refactor changed behavior and the test fails loudly.

NO FRAMEWORK REQUIRED
    Run directly:   python3 tests/test_engine_characterization.py
    Or under pytest if you prefer:   pytest tests/test_engine_characterization.py
    Only needs pandas + numpy (already engine deps).

IF YOU INTENTIONALLY CHANGE ENGINE MATH
    Re-baseline by running with --update, eyeball the diff, and commit the new
    golden values in the same commit as the math change.
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# --- load the REAL engine module the app uses (no package side effects) -------
ENGINE_PATH = Path(__file__).resolve().parent.parent / "app" / "engine" / "engine.py"


def load_engine():
    spec = importlib.util.spec_from_file_location("engine_under_test", ENGINE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --- deterministic input: trend + oscillation + seeded noise (whipsaws) -------
# Produces a realistic mix of winning AND losing trades so loss paths, drawdown,
# profit factor and consecutive-streak logic are all exercised. DO NOT change the
# seed or the math without re-baselining GOLDEN below — the numbers depend on it.
def make_signals_df(eng):
    n = 400
    idx = pd.date_range("2018-01-01", periods=n, freq="D")
    rng = np.random.default_rng(42)
    t = np.arange(n)
    base = 100 + 15 * np.sin(t / 9.0) + 8 * np.sin(t / 3.3) + t * 0.03
    noise = rng.normal(0, 1.5, n).cumsum() * 0.4
    close = np.round(np.maximum(base + noise, 5), 2)
    df = pd.DataFrame(
        {"Open": close, "High": close * 1.012, "Low": close * 0.988, "Close": close},
        index=idx,
    )
    df = eng.ema_cross_signals(df, 9, 21)          # long_entry / long_exit
    df["short_entry"] = df["long_exit"]            # symmetric scheme for LS path
    df["short_exit"] = df["long_entry"]
    return df


def config_for(eng, **overrides):
    cfg = eng.BacktestConfig()
    cfg.commission_pct = 0.1
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return cfg


# KPIs pinned by this test (scalar, deterministic). `trades`/`equity_curve` are
# intentionally excluded — these scalars fully characterize the run.
PINNED = [
    "total_pnl", "total_pnl_pct", "net_profit", "gross_profit", "gross_loss",
    "profit_factor", "max_drawdown_pct", "total_trades", "num_winning",
    "num_losing", "win_rate", "final_equity", "total_commission",
    "max_consec_wins", "max_consec_losses",
]

# Golden values captured from the current engine (pre-refactor baseline).
GOLDEN = {
    ("plain", "long_only"): {
        "total_pnl": -261.389986, "total_pnl_pct": -26.138999, "net_profit": -310.605751,
        "gross_profit": 70.370205, "gross_loss": -380.975956, "profit_factor": 0.18471,
        "max_drawdown_pct": -31.955892, "total_trades": 9, "num_winning": 2, "num_losing": 7,
        "win_rate": 22.222222, "final_equity": 738.610014, "total_commission": 15.168556,
        "max_consec_wins": 1, "max_consec_losses": 4,
    },
    ("plain", "long_short"): {
        "total_pnl": -522.633183, "total_pnl_pct": -52.263318, "net_profit": -554.441543,
        "gross_profit": 150.894073, "gross_loss": -705.335616, "profit_factor": 0.213932,
        "max_drawdown_pct": -56.022802, "total_trades": 18, "num_winning": 4, "num_losing": 14,
        "win_rate": 22.222222, "final_equity": 477.366817, "total_commission": 28.266881,
        "max_consec_wins": 2, "max_consec_losses": 8,
    },
    ("tpsl", "long_only"): {
        "total_pnl": 132.334695, "total_pnl_pct": 13.233469, "net_profit": 132.334695,
        "gross_profit": 294.727413, "gross_loss": -162.392718, "profit_factor": 1.814905,
        "max_drawdown_pct": -7.517855, "total_trades": 10, "num_winning": 5, "num_losing": 5,
        "win_rate": 50.0, "final_equity": 1132.334695, "total_commission": 20.275335,
        "max_consec_wins": 2, "max_consec_losses": 2,
    },
    ("tpsl", "long_short"): {
        "total_pnl": 341.993277, "total_pnl_pct": 34.199328, "net_profit": 341.993277,
        "gross_profit": 696.10957, "gross_loss": -354.116293, "profit_factor": 1.965765,
        "max_drawdown_pct": -7.508406, "total_trades": 19, "num_winning": 10, "num_losing": 9,
        "win_rate": 52.631579, "final_equity": 1341.993277, "total_commission": 43.698149,
        "max_consec_wins": 4, "max_consec_losses": 2,
    },
    # process_orders_on_close=True exercises the fill-at-Close settlement paths.
    ("poc", "long_only"): {
        "total_pnl": -15.314678, "total_pnl_pct": -1.531468, "net_profit": -115.140769,
        "gross_profit": 105.091813, "gross_loss": -220.232582, "profit_factor": 0.477186,
        "max_drawdown_pct": -16.101527, "total_trades": 9, "num_winning": 3, "num_losing": 6,
        "win_rate": 33.333333, "final_equity": 984.685322, "total_commission": 16.71574,
        "max_consec_wins": 1, "max_consec_losses": 2,
    },
    ("poc", "long_short"): {
        "total_pnl": -124.883892, "total_pnl_pct": -12.488389, "net_profit": -213.602002,
        "gross_profit": 237.340324, "gross_loss": -450.942326, "profit_factor": 0.526321,
        "max_drawdown_pct": -26.791696, "total_trades": 18, "num_winning": 6, "num_losing": 12,
        "win_rate": 33.333333, "final_equity": 875.116108, "total_commission": 34.07215,
        "max_consec_wins": 2, "max_consec_losses": 4,
    },
}

SCENARIOS = {
    "plain": {},
    "tpsl": {"take_profit_pct": 6.0, "stop_loss_pct": 3.0},
    "poc": {"process_orders_on_close": True},
}

TOL = 1e-4  # absolute tolerance; KPIs are O(1)–O(1000), platform float jitter << this


def run_one(eng, scenario, side):
    cfg = config_for(eng, **SCENARIOS[scenario])
    fn = eng.run_backtest_long_short if side == "long_short" else eng.run_backtest
    return fn(make_signals_df(eng), cfg)


def compare(scenario, side, kpis):
    """Return list of human-readable mismatches (empty == pass)."""
    expected = GOLDEN[(scenario, side)]
    fails = []
    for key in PINNED:
        got = kpis.get(key, "<missing>")
        want = expected[key]
        try:
            if not math.isclose(float(got), float(want), abs_tol=TOL, rel_tol=1e-6):
                fails.append(f"{scenario}/{side}.{key}: got {got!r}, want {want!r}")
        except (TypeError, ValueError):
            fails.append(f"{scenario}/{side}.{key}: got {got!r}, want {want!r}")
    return fails


# --- pytest entry points (one assert per case) --------------------------------
def test_run_backtest_long_only_plain():
    eng = load_engine()
    assert not compare("plain", "long_only", run_one(eng, "plain", "long_only"))


def test_run_backtest_long_only_tpsl():
    eng = load_engine()
    assert not compare("tpsl", "long_only", run_one(eng, "tpsl", "long_only"))


def test_run_backtest_long_short_plain():
    eng = load_engine()
    assert not compare("plain", "long_short", run_one(eng, "plain", "long_short"))


def test_run_backtest_long_short_tpsl():
    eng = load_engine()
    assert not compare("tpsl", "long_short", run_one(eng, "tpsl", "long_short"))


def test_run_backtest_long_only_poc():
    eng = load_engine()
    assert not compare("poc", "long_only", run_one(eng, "poc", "long_only"))


def test_run_backtest_long_short_poc():
    eng = load_engine()
    assert not compare("poc", "long_short", run_one(eng, "poc", "long_short"))


# --- framework-free runner ----------------------------------------------------
def _main(argv):
    eng = load_engine()
    if "--update" in argv:
        print("# Re-baselined GOLDEN (paste into this file):")
        for scenario in SCENARIOS:
            for side in ("long_only", "long_short"):
                k = run_one(eng, scenario, side)
                vals = {kk: (int(k[kk]) if kk in ("total_trades", "num_winning",
                        "num_losing", "max_consec_wins", "max_consec_losses")
                        else round(float(k[kk]), 6)) for kk in PINNED}
                print(f'    ("{scenario}", "{side}"): {vals},')
        return 0

    all_fails = []
    for scenario in SCENARIOS:
        for side in ("long_only", "long_short"):
            all_fails += compare(scenario, side, run_one(eng, scenario, side))

    if all_fails:
        print("FAIL — engine behavior changed vs baseline:")
        for f in all_fails:
            print("  -", f)
        return 1
    n = len(PINNED) * 2 * len(SCENARIOS)
    print(f"PASS — all {n} pinned KPIs match baseline across "
          f"{len(SCENARIOS)} scenarios x {{long_only, long_short}}.")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
