/**
 * Typed contract for the 770 Trend Diamonds API (Milestone 5).
 *
 * Mirrors python-backend/models.py. Zod schemas are provided for the responses
 * the dashboard validates at runtime; the rest are compile-time interfaces.
 * Generated equivalents (Orval) can replace this once the API's OpenAPI doc is
 * pulled from a running backend; until then this is hand-kept in sync.
 */
import { z } from "zod";

// ── Strategies ───────────────────────────────────────────────────────────────
export type StrategyId = "bot8c" | "bot4" | "bot1" | (string & {});

export interface StrategyConfig {
  strategyId: StrategyId;
  timeframe?: string;
  startDate?: string;
  endDate?: string;
  poles?: number;
  period?: number;
  multiplier?: number;
  source?: string;
  label?: string;
  [k: string]: unknown;
}

// ── Auth ───────────────────────────────────────────────────────────────────
export const LoginResponse = z.object({
  token: z.string(),
  username: z.string(),
  role: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponse>;

// ── Signals ──────────────────────────────────────────────────────────────────
export type Tier =
  | "breaking_out" | "near_breakout" | "in_uptrend" | "building"
  | "in_downtrend" | "near_breakdown" | "breaking_down" | "neutral";

export const SignalRow = z.object({
  symbol: z.string(),
  name: z.string().nullable().optional(),
  bucket: z.string(),
  tier: z.string(),
  direction: z.string(),
  currentPrice: z.number().nullable().optional(),
  pctToGreen: z.number().nullable().optional(),
  desc: z.string().nullable().optional(),
});
export type SignalRow = z.infer<typeof SignalRow>;

// ── Trend scanner (3-color model: scanner rows + daily history) ───────────────
export type TrendColor = "Green" | "Grey" | "Red";

export interface TrendRow {
  asset: string; symbol: string; ticker: string; bucket: string;
  trendFrom: TrendColor; trendTo: TrendColor; trendChanged: string;
  range: string | null; status: "OPEN" | "CLOSED"; openDate: string | null;
  netPnlPct: number | null; currentPrice: number; timeframe: string;
}
export interface HistoryPoint { date: string; green: number; grey: number; red: number; total: number; }
export interface TrendScanResponse { scanner: TrendRow[]; history: HistoryPoint[]; }

// ── Backtest runs + results ───────────────────────────────────────────────────
export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export const Run = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  buckets: z.array(z.string()),
  totalSymbols: z.number().nullable().optional(),
  completedSymbols: z.number().nullable().optional(),
  failedSymbols: z.number().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});
export type Run = z.infer<typeof Run>;

export const RunProgress = z.object({
  runId: z.string(),
  status: z.string(),
  totalSymbols: z.number(),
  completedSymbols: z.number(),
  failedSymbols: z.number(),
  currentSymbol: z.string().nullable().optional(),
  estimatedSecondsRemaining: z.number().nullable().optional(),
});
export type RunProgress = z.infer<typeof RunProgress>;

export const BacktestResult = z.object({
  symbol: z.string(),
  name: z.string().nullable().optional(),
  bucket: z.string(),
  totalReturn: z.number(),
  cagr: z.number(),
  maxDrawdown: z.number(),
  winRate: z.number(),
  sharpe: z.number(),
  tradeCount: z.number(),
  initialCapital: z.number().optional(),
  isReturnOutlier: z.boolean().optional(),
  isDrawdownOutlier: z.boolean().optional(),
  errorMessage: z.string().nullable().optional(),
});
export type BacktestResult = z.infer<typeof BacktestResult>;

export const EquityCurvePoint = z.object({ date: z.string(), value: z.number() });
export type EquityCurvePoint = z.infer<typeof EquityCurvePoint>;

export const Trade = z.object({
  entryDate: z.string(),
  exitDate: z.string().nullable().optional(),
  side: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number().nullable().optional(),
  returnPct: z.number().nullable().optional(),
  // Per-trade dollar P&L + position size (from the engine). Optional: trades
  // run before the backend surfaced these come back without them.
  pnl: z.number().nullable().optional(),
  qty: z.number().nullable().optional(),
});
export type Trade = z.infer<typeof Trade>;

export const SymbolDetail = z.object({
  symbol: z.string(),
  result: BacktestResult,
  equityCurve: z.array(EquityCurvePoint),
  trades: z.array(Trade),
});
export type SymbolDetail = z.infer<typeof SymbolDetail>;

export const BucketBreakdown = z.object({
  bucket: z.string(),
  symbolCount: z.number(),
  avgReturn: z.number(),
  avgSharpe: z.number(),
  startingAmount: z.number(),
  endingValue: z.number(),
});
export const DashboardSummary = z.object({
  totalRuns: z.number(),
  completedRuns: z.number(),
  totalSymbolsTested: z.number(),
  bestPerformer: z.string().nullable(),
  bestPerformerReturn: z.number().nullable(),
  worstDrawdown: z.string().nullable(),
  worstDrawdownPct: z.number().nullable(),
  avgSharpe: z.number().nullable(),
  bucketBreakdown: z.array(BucketBreakdown),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;

export interface SavedStrategy {
  id: number;
  name: string;
  strategyId: StrategyId;
  config: StrategyConfig;
  pineSource?: string | null;
  createdAt?: string;
}

// ── Trading: exchange / profit / paper / telegram ──────────────────────────────
export interface ExchangePublicConfig {
  exchange: string; environment: string; subAccount: string; defaultPct: number;
  apiKeyMasked: string; apiSecretMasked: string; apiPassphraseMasked: string;
  hasApiKey: boolean; hasApiSecret: boolean; hasApiPassphrase: boolean;
  pinSet: boolean; lastTestAt: string | null; lastTestStatus: string | null;
  lastTestMessage: string | null; supportedExchanges: string[];
}
export interface ProfitConfig {
  enabled: boolean; targetMode: "daily" | "weekly"; dailyTarget: number; weeklyTarget: number;
  tiers: string[]; maxPositions: number; deployPct: number; autoScan: boolean;
  scheduleTime: string; profitPctEnabled: boolean; profitPctPerPosition: number;
  investAmount: number; lastBuiltAt: string | null;
}
export interface ProfitPlanItem {
  symbol: string; name?: string; capitalPerTrade: number; suggestedQty: number;
  takeProfitPrice: number; requiredMovePct: number; expectedProfit: number;
}
export interface ProfitPlan {
  generatedAt: string; candidates: number; nTrades: number; deployable: number;
  totalExpectedProfit: number; items: ProfitPlanItem[];
}
export interface PaperPosition {
  id: number; sessionId: number; symbol: string; name?: string; tier?: string;
  qty: number; entryPrice: number; capital: number; status: "open" | "closed";
  currentPrice?: number | null; value?: number; pnl?: number; pnlPct?: number;
  closePrice?: number | null; realizedPnl?: number | null;
}
export interface PaperSession {
  id: number; label: string; strategy: StrategyId; strategyLabel?: string;
  capital: number; dailyTarget: number; status: "running" | "stopped";
  startedAt: string; closedAt?: string | null; positions: PaperPosition[];
  totalCost: number; totalValue: number; totalPnl: number; totalPnlPct: number;
  runtimeSeconds: number; targetReached: boolean; pendingDecision: boolean;
  takeProfitEnabled: boolean; takeProfitPct: number;
}
export interface TelegramConfig {
  botTokenMasked: string; chatId: string; scheduleTime: string; scheduleEnabled: boolean;
  configured: boolean; approvalsEnabled: boolean; notifyExcelDaily: boolean; notifyRunFinished: boolean;
  notifyProfitEngine: boolean; notifySignals: boolean; notifyAssistant: boolean;
  lastSentAt: string | null; lastSendStatus: string | null; lastSendMessage: string | null;
}
export interface ActivityRow {
  id: number; ts: string; mode: string; kind: string; symbol?: string; name?: string;
  tier?: string; direction?: string; side?: string; qty?: number | null;
  price?: number | null; cost?: number | null; pnl?: number | null; environment?: string | null;
}
