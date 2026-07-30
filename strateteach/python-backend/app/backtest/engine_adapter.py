"""Adapter that drives the vendored TradingView-matching engine.

Builds the per-strategy signal DataFrame, runs the engine (long-only or
long+short based on config), then maps the engine's KPIs and trades back into
the app's models. CAGR and Sharpe are derived from the engine's equity curve
since the engine itself does not emit them.
"""
from __future__ import annotations
import math
from typing import List, NamedTuple, Tuple

import numpy as np
import pandas as pd

from app.engine import BacktestConfig, run_backtest, run_backtest_long_short
from app.models import StrategyConfig, Trade, EquityCurvePoint
from app.strategies.base import build_signals
from app.strategies.bot4 import build_signals_bot4
from app.strategies.bot1 import build_signals_bot1

INITIAL_CAPITAL = 1000.0
COMMISSION_PCT = 0.1  # TradingView convention (0.1%)


class EngineOutcome(NamedTuple):
    totalReturn: float
    cagr: float
    maxDrawdown: float
    winRate: float
    sharpe: float
    tradeCount: int
    trades: List[Trade]
    equityCurve: List[EquityCurvePoint]


def _build_engine_config(config: StrategyConfig, initial_capital: float) -> BacktestConfig:
    # bot4's short time stop (close the short after N bars) is engine-side because
    # the bar count depends on when the engine fills the entry. It only applies to
    # the short side of a long+short bot4 run; other strategies leave it disabled.
    short_max_bars = 0
    if (
        config.strategyId == "bot4"
        and config.enableShorts
        and config.useTimeStopShort
    ):
        short_max_bars = config.shortMaxBars

    # Backtest properties driven by the strategy config (TradingView settings),
    # falling back to the standard defaults when not provided.
    def _f(name: str, default: float) -> float:
        v = getattr(config, name, None)
        try:
            return float(v) if v is not None else float(default)
        except (TypeError, ValueError):
            return float(default)

    def _i(name: str, default: int) -> int:
        v = getattr(config, name, None)
        try:
            return int(v) if v is not None else int(default)
        except (TypeError, ValueError):
            return int(default)

    return BacktestConfig(
        initial_capital=initial_capital,
        commission_pct=_f("commissionPct", COMMISSION_PCT),
        slippage_ticks=max(0, _i("slippageTicks", 1)),
        # The UI's "slippage" setting used to be inert — declared and never applied,
        # so every backtest assumed perfect fills. It now drives real market-fill
        # slippage, expressed in basis points (1 tick = 1 bp = 0.01%), applied
        # against the trader on entries, exits and stops.
        slippage_bps=float(max(0, _i("slippageTicks", 1))),
        qty_type="percent_of_equity",
        qty_value=_f("positionPct", 100.0),
        pyramiding=max(1, _i("pyramiding", 1)),
        start_date=config.startDate,
        end_date=config.endDate,
        process_orders_on_close=False,
        long_max_bars=0,
        short_max_bars=short_max_bars,
    )


def _build_signals(df: pd.DataFrame, config: StrategyConfig) -> pd.DataFrame:
    if config.strategyId == "bot4":
        return build_signals_bot4(df, config)
    if config.strategyId == "bot1":
        return build_signals_bot1(df, config)
    return build_signals(df, config)  # bot8c (default)


def _map_trades(engine_trades: list) -> List[Trade]:
    out: List[Trade] = []
    for t in engine_trades:
        exit_date = str(t.exit_date.date()) if t.exit_date is not None else None
        exit_price = round(t.exit_price, 8) if t.exit_price is not None else None
        ret_pct = round(t.pnl_pct, 4) if t.pnl_pct is not None else 0.0
        out.append(Trade(
            entryDate=str(t.entry_date.date()),
            exitDate=exit_date,
            side=t.direction.upper(),
            entryPrice=round(t.entry_price, 8),
            exitPrice=exit_price,
            returnPct=ret_pct,
            # Surface the engine's dollar P&L + position size so the trades table
            # can show "value + %" (open trades have pnl=None until they close).
            pnl=round(t.pnl, 2) if t.pnl is not None else None,
            qty=round(t.entry_qty, 8) if t.entry_qty is not None else None,
        ))
    return out


def _map_equity(equity_curve: list) -> List[EquityCurvePoint]:
    pts: List[EquityCurvePoint] = []
    for p in equity_curve:
        d = p["date"]
        date_str = str(d.date()) if hasattr(d, "date") else str(d)
        pts.append(EquityCurvePoint(date=date_str, value=round(float(p["equity"]), 4)))
    return pts


def _derive_cagr(equity_curve: list, initial: float) -> float:
    if len(equity_curve) < 2:
        return 0.0
    first = equity_curve[0]["date"]
    last = equity_curve[-1]["date"]
    final = float(equity_curve[-1]["equity"])
    years = (last - first).days / 365.25
    if years <= 0:
        return 0.0
    return ((final / initial) ** (1 / years) - 1) * 100


def _derive_sharpe(equity_curve: list, timeframe: str) -> float:
    if len(equity_curve) <= 2:
        return 0.0
    vals = np.array([float(p["equity"]) for p in equity_curve], dtype=float)
    if np.any(vals[:-1] == 0):
        return 0.0
    rets = np.diff(vals) / vals[:-1]
    std = float(np.std(rets))
    if len(rets) <= 1 or std <= 0:
        return 0.0
    ann_factor = 252 if timeframe == "1d" else 252 * 6
    return (float(np.mean(rets)) * ann_factor) / (std * math.sqrt(ann_factor))


def run_engine_backtest(
    df: pd.DataFrame,
    config: StrategyConfig,
    initial_capital: float = INITIAL_CAPITAL,
) -> EngineOutcome:
    """Run a single-symbol backtest through the engine and return app models."""
    signals = _build_signals(df, config)
    cfg = _build_engine_config(config, initial_capital)

    # bot1 is a port of the BOT1-770 Pine strategy, which is LONG-ONLY — its module
    # docstring, its name and the golden fixtures all say so. It had drifted to
    # follow `enableShorts` like the other bots, which made it open shorts the
    # published strategy never takes: the code stopped doing what it claimed, and
    # the bot1 golden broke. Behaviour is realigned to the claim (Oren readiness S4
    # — "does idea→signal do what it claims?"). bot4/bot8c keep the flag.
    long_short = config.enableShorts and config.strategyId != "bot1"
    kpis = run_backtest_long_short(signals, cfg) if long_short else run_backtest(signals, cfg)

    equity_curve = kpis.get("equity_curve", [])
    app_equity = _map_equity(equity_curve)

    # No trades executed → engine returns a sparse dict; report a flat result.
    if "error" in kpis:
        return EngineOutcome(0.0, 0.0, 0.0, 0.0, 0.0, 0, [], app_equity)

    total_return = float(kpis["total_pnl_pct"])
    cagr = _derive_cagr(equity_curve, cfg.initial_capital)
    max_dd = abs(float(kpis["max_drawdown_pct"]))
    win_rate = float(kpis["win_rate"])
    sharpe = _derive_sharpe(equity_curve, config.timeframe)
    trade_count = int(kpis["total_trades"])
    app_trades = _map_trades(kpis["trades"])

    return EngineOutcome(
        totalReturn=round(total_return, 4),
        cagr=round(cagr, 4),
        maxDrawdown=round(max_dd, 4),
        winRate=round(win_rate, 4),
        sharpe=round(sharpe, 4),
        tradeCount=trade_count,
        trades=app_trades,
        equityCurve=app_equity,
    )
