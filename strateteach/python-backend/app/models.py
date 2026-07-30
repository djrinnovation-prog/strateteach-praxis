"""
Pydantic data models for 770 Trend Diamonds (STRATETEACH / ALGO770).

This module is the API contract: every request/response shape the FastAPI
backend exposes is defined here, and the OpenAPI spec + TS client are generated
from it. Reproduced 1:1 from the original so the rebuilt frontend stays
binary-compatible with existing data.
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel

# Default starting capital per symbol when no per-bucket amount is supplied.
DEFAULT_BUCKET_AMOUNT = 1000.0


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Timeframe(str, Enum):
    daily = "1d"
    four_hour = "4h"


class Bucket(str, Enum):
    crypto = "crypto"
    metals = "metals"
    stocks = "stocks"
    commodities = "commodities"


class StrategyConfig(BaseModel):
    # Which engine to run: "bot8c" | "bot4"
    strategyId: str = "bot8c"

    startDate: str = "2018-01-01"
    endDate: str = "2069-12-31"
    timeframe: str = "1d"

    # ── Backtest properties (TradingView strategy() settings) ─────────
    commissionPct: float = 0.1     # per fill, e.g. 0.1 = 0.1%
    slippageTicks: int = 1         # slippage in ticks
    positionPct: float = 100.0     # order size: % of equity
    pyramiding: int = 1            # max concurrent entries in one direction

    # ── Long filters (both strategies) ────────────────────────────────
    useSmaFilter: bool = False
    allowCloseBelowSma: bool = False
    useAdxFilter: bool = False
    adxLength: int = 14
    adxThreshold: float = 25.0

    # BOT4 extra long filters
    useRsiFilter: bool = False
    rsiLength: int = 14
    useVolumeFilter: bool = False
    volumeMaLength: int = 50
    confirmBarsLong: int = 1

    # ── Short filters (both strategies) ───────────────────────────────
    enableShorts: bool = True
    shortQtyPct: float = 100.0
    shortUseSmaFilter: bool = False
    shortUseAdxFilter: bool = True
    shortAdxThreshold: float = 27.0
    shortAdxLength: int = 14
    shortUseTrendFilter: bool = True          # = requireFilterDownForShort in BOT4
    shortAllowExitAboveSma: bool = False
    allowReversal: bool = False

    # BOT4 extra short filters / regime
    requireFilterDownForShort: bool = True
    requireDiBearishForShort: bool = True
    shortRegimeMode: str = "SMA200 Down"      # "Off"|"Below SMA200"|"SMA200 Down"
    smaSlopeLen: int = 20
    shortEntryMode: str = "Filter"            # "Filter"|"Lower Band"
    shortExitMode: str = "Filter"             # "Filter"|"Lower Band"
    useRsiFilterShort: bool = False
    rsiLengthShort: int = 14
    useVolumeFilterShort: bool = False
    volumeMaLengthShort: int = 50
    confirmBarsShort: int = 1
    reductionLevel: str = "Medium"            # "Low"|"Medium"|"High"

    # ── Risk management (BOT4) ────────────────────────────────────────
    useHardStop: bool = True
    stopAtrLength: int = 30
    longStopMult: float = 2.0
    shortStopMult: float = 2.0
    useShortTP: bool = True
    shortTpMult: float = 4.0
    useLongTP: bool = False
    longTpMult: float = 6.0
    useTimeStopShort: bool = True
    shortMaxBars: int = 60
    useTrailingStop: bool = False
    trailAtrLength: int = 5
    trailAtrMult: float = 5.0

    # ── Gaussian filter (both strategies) ─────────────────────────────
    poles: int = 6
    samplingPeriod: int = 147
    ftrMultiplier: float = 1.414
    reducedLag: bool = False
    fastResponse: bool = False


class RunInput(BaseModel):
    name: Optional[str] = None
    buckets: List[str]
    config: StrategyConfig
    symbolLimit: Optional[int] = 20
    # Per-bucket starting capital. Missing buckets fall back to DEFAULT_BUCKET_AMOUNT.
    bucketAmounts: Optional[Dict[str, float]] = None
    # Single-/multi-symbol override: when set, the run backtests ONLY these exact
    # symbols (from the same universe the scan draws from) instead of the bucket's
    # top-N. Their bucket is buckets[0]. None/empty = the normal all-symbols run.
    symbols: Optional[List[str]] = None


class Run(BaseModel):
    id: str
    name: str
    status: str
    buckets: List[str]
    totalSymbols: Optional[int] = None
    completedSymbols: Optional[int] = None
    failedSymbols: Optional[int] = None
    createdAt: str
    completedAt: Optional[str] = None
    config: StrategyConfig
    errorMessage: Optional[str] = None
    # Runs are EPHEMERAL by default — only those the user explicitly "Save"s are
    # kept in the history list. False = ephemeral (auto-discarded), True = saved.
    saved: bool = False


class BacktestResult(BaseModel):
    symbol: str
    name: Optional[str] = None
    bucket: str
    totalReturn: float
    cagr: float
    maxDrawdown: float
    winRate: float
    sharpe: float
    tradeCount: int
    initialCapital: float = DEFAULT_BUCKET_AMOUNT
    isReturnOutlier: bool = False
    isDrawdownOutlier: bool = False
    errorMessage: Optional[str] = None


class Trade(BaseModel):
    entryDate: str
    exitDate: Optional[str] = None
    side: str
    entryPrice: float
    exitPrice: Optional[float] = None
    returnPct: float
    # Per-trade dollar P&L and position size, surfaced from the engine's Trade
    # (engine_adapter._map_trades). Optional so trades persisted before this
    # field existed still deserialize (Trade(**old_row) in database.py).
    pnl: Optional[float] = None
    qty: Optional[float] = None


class EquityCurvePoint(BaseModel):
    date: str
    value: float


class SymbolDetail(BaseModel):
    symbol: str
    result: BacktestResult
    equityCurve: List[EquityCurvePoint]
    trades: List[Trade]


class RunProgress(BaseModel):
    runId: str
    status: str
    totalSymbols: int
    completedSymbols: int
    failedSymbols: int
    currentSymbol: Optional[str] = None
    estimatedSecondsRemaining: Optional[float] = None


class CsvExport(BaseModel):
    filename: str
    data: str


class BucketStats(BaseModel):
    bucket: str
    symbolCount: int
    avgReturn: float
    avgSharpe: float
    startingAmount: float = 0.0
    endingValue: float = 0.0


class DashboardSummary(BaseModel):
    totalRuns: int
    completedRuns: int
    totalSymbolsTested: int
    bestPerformer: Optional[str] = None
    bestPerformerReturn: Optional[float] = None
    worstDrawdown: Optional[str] = None
    worstDrawdownPct: Optional[float] = None
    avgSharpe: Optional[float] = None
    bucketBreakdown: List[BucketStats] = []


class SymbolInfo(BaseModel):
    symbol: str
    name: str
    bucket: str
    rank: Optional[int] = None
