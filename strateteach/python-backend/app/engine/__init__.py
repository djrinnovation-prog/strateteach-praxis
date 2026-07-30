"""
Vendored TradingView-matching backtest engine (core simulator only).

Only the pure-Python simulator and KPI helpers are re-exported here. The
upstream package also ships data loaders (``engine.data``) that depend on
ccxt / tradingview-datafeed / openpyxl; the app has its own OHLCV fetchers,
so those loaders are intentionally NOT imported to avoid pulling in extra
third-party dependencies.
"""

from .engine import (
    __version__,
    BacktestConfig,
    Trade,
    run_backtest,
    run_backtest_long_short,
    compute_kpis,
)

__all__ = [
    "__version__",
    "BacktestConfig",
    "Trade",
    "run_backtest",
    "run_backtest_long_short",
    "compute_kpis",
]
