/**
 * Typed API client for the 770 Trend Diamonds backend (Milestone 5).
 *
 * One small class: holds the bearer token + (optional) exchange PIN, and exposes
 * a typed method per endpoint group. The React dashboard uses this directly; a
 * generated TanStack-Query layer can wrap it later.
 *
 *   const api = new Api("https://yourdomain");
 *   await api.login("admin", "admin");
 *   const signals = await api.breakouts(["crypto"]);
 */
import type {
  ActivityRow, BacktestResult, DashboardSummary, ExchangePublicConfig, ProfitConfig,
  ProfitPlan, PaperSession, Run, RunProgress, SavedStrategy, SignalRow, StrategyConfig,
  SymbolDetail, TelegramConfig, TrendScanResponse,
} from "./types";
import { LoginResponse } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type ExchangeCreds = { key?: string; secret?: string; passphrase?: string; name?: string; env?: string };

// ── Layout / location editor ──
// An arrangement is which buttons/tiles show + their order for one screen:
// `order` is an id ordering (ids not listed sort to the end), `hidden` marks ids
// the user chose to hide. Safety-locked ids are force-shown at render regardless.
export type LayoutArrangement = { order: string[]; hidden: string[] };
export type LayoutScope = "user" | "role" | "default";
export type LayoutResolved = {
  screen: string;
  arrangement: LayoutArrangement | null;   // null → render the code's built-in order
  source: "user" | "role" | "default" | "code";
  canEditShared: boolean;                    // owners may write default / role scopes
  role: string | null;
  scopes: { user: LayoutArrangement | null; role: LayoutArrangement | null; default: LayoutArrangement | null };
};

// ── Home Guide — animated mascot overlay config (server-backed, owner/admin-editable) ──
export type GuideGesture = "wave" | "point" | "cheer" | "talk";
export type GuideAnchor = "ticker" | "tools" | "engine" | "signal" | "portfolio" | "bottom" | null;
export type GuidePoses = {
  talk: string; mouthAh: string; mouthOo: string; blink: string;
  point: string; wave: string; cheer: string;
};
export type GuideStep = {
  id: string;
  anchor: GuideAnchor;
  gesture: GuideGesture;
  dur: number;                 // fallback seconds if audio.onended never fires
  audio: string | null;        // per-step voice url (default = EN ElevenLabs line)
  audioHe: string | null;      // optional HE voice url (uploaded later); falls back to `audio`
  captionEn: string;
  captionHe: string;
  enabled: boolean;
};
export type GuideConfig = {
  enabled: boolean;
  autoOfferFirstVisit: boolean;
  characterScale: number;
  poses: GuidePoses;
  steps: GuideStep[];
  updatedAt: string | null;
  updatedBy: string | null;
};
export type GuideConfigResolved = { config: GuideConfig; assetKeys: string[]; canManage: boolean };

// ── Review board (Phase 2) — multi-user Review-Mode submissions + Dan's mini-portal ──
// On SUBMIT `files` are image data-URLs; on READ they're file TOKENS (→ reviewFileUrl()).
export type ReviewNote = { screen: string; route: string; text: string; code?: string; ts?: string; files?: string[]; truncated?: boolean };
export type ReviewSubmission = { id: number; fromUser: string; fromName: string; notes: ReviewNote[]; prompt: string; createdAt: string };
export type ReviewReport = { from: string | null; to: string | null; count: number; taskCount: number; submissions: ReviewSubmission[]; markdown: string };
// A named + timestamped checkpoint of the working prompt (owner-scoped; restore = reload content).
export type ReviewSnapshot = { id: number; name: string; content: string; createdAt: string };

// ── AutoPilots — SIMULATION / dry-run state (owners-only) ──
export type ApSimPosition = {
  symbol: string; side: "long" | "short"; entryPrice: number; exitPrice: number | null; qty: number;
  lastPrice: number | null; unrealizedPnl: number; realizedPnl: number;
  status: string; openedAt: string; closedAt: string | null;
  mode?: "simulation" | "live"; orderId?: string | null;
};
export type ApSimActivity = {
  kind: "open" | "close" | "run"; symbol: string | null; side: string | null;
  price: number | null; qty: number | null; pnl: number | null; note: string | null; at: string;
};
export type ApEquityPoint = { d: string; v: number };
export type ApSimPilot = {
  pilotId: string; armedAt: string; accountLabel: string | null; nav: number; capital: number; perTradePct: number;
  direction: string; status: "simulation"; lastRunAt: string | null; nextRunAt: string | null;
  realizedPnl: number; unrealizedPnl: number; totalPnl: number; openCount: number; tradeCount: number;
  waiting: boolean; hasRun: boolean;
  // Real-money mode — 'simulation' (default/fallback) or 'live' (gated). liveCap = the
  // owner-set starting-capital cap for the first live run.
  mode?: "simulation" | "live"; liveCap?: number | null; liveStartedAt?: string | null;
  // P&L split by POSITION mode (livePnl + simPnl == totalPnl) — keeps LIVE strictly real.
  livePnl?: number; simPnl?: number; liveOpenCount?: number; simOpenCount?: number;
  equityCurve: ApEquityPoint[]; positions: ApSimPosition[]; closedPositions: ApSimPosition[]; activity: ApSimActivity[];
};
// Masked-only Bybit key status (never carries the raw secret).
export type ApBybitStatus = {
  connected: boolean; exchange: string; environment: string; keyHint: string;
  lastTestAt: string | null; lastTestOk: boolean | null; lastTestMsg: string | null;
};
export type ApLiveInfo = { masterEnabled: boolean; capMin: number; capMax: number; goLivePhrase: string };
// READ-ONLY Bybit wallet balance (fetch_balance only — no trading).
export type ApBybitBalance = {
  ok: boolean; connected: boolean; environment?: string; exchange?: string; message?: string;
  totalUsd?: number; stableUsd?: number; freeUsdt?: number;
  balances?: { asset: string; free: number; total: number }[];
};
// Live scan telemetry for the AutoPilots screen (countdown + "scanning now" pulse).
export type ApScanStatus = {
  lastScanAt: string | null; nextScanAt: string | null; scanInProgress: boolean;
  symbolCount: number; pilotBatchOffsetMin: number;
};
export type ApSimState = {
  ok: boolean; pilots: ApSimPilot[]; scanRanAt: string | null; hasScan: boolean; mode: string;
  scan?: ApScanStatus; live?: ApLiveInfo; bybit?: ApBybitStatus;
};
// ── Run-plan review gate (Run now → plan → approve) ──
// A single proposed trade in a run plan. `key` ('enter:<sym>'/'exit:<sym>') is what the
// approve call sends back for the ones the owner ticks.
export type ApPlanTrade = {
  key: string; action: "enter" | "exit"; symbol: string; side: string;
  price: number; qty?: number; spendUsd?: number; estPnl?: number; entryPrice?: number;
  positionId?: number; tier?: string; reason?: string;
};
export type ApRunPlan = {
  pilotId: string; mode: "simulation" | "live"; eligible: boolean; reason?: string;
  assetsEvaluated: number; exits: ApPlanTrade[]; entries: ApPlanTrade[];
  // live-only fields
  cap?: number; budgetUsed?: number; remaining?: number; perTradeUsd?: number;
  minNotionalUsd?: number; masterGate?: boolean;
  freeUsdt?: number | null;  // REAL Bybit free USDT (the true spendable amount)
};
export type ApApproveItem = { action: "enter" | "exit"; symbol: string };
// Outcome of an approve — placed vs skipped, with per-order reasons for honest feedback.
export type ApApproveResult = {
  opened: number; closed: number; open?: number; live?: boolean; reason?: string;
  placed?: number; skippedCount?: number; skips?: { symbol: string | null; reason: string }[];
};
export type ApArmInput = { pilotId: string; direction?: string; market?: string; nav: number; perTradePct: number; accountLabel?: string | null };
export type ApGoLiveInput = { pilotId: string; cap: number; confirm: string; ackReal: boolean };
// A legal text (privacy/terms/risk/demo/exchange_keys …) — bilingual, markdown body.
// `published`/`updatedBy` are present only on the admin (Legal Console) responses.
export type LegalText = { key: string; titleHe: string; titleEn: string; bodyHe: string; bodyEn: string; sort: number; updatedAt: string | null; published?: boolean; updatedBy?: string | null };
export type LegalCopyBlock = { block: string; he: string; en: string; approved: boolean; updatedBy?: string | null; updatedAt?: string | null };
// Daily audit (Oren/Raz/Dan)
export type AuditItem = { id: number; domain: string; section: string; title: string; whereWeAre: string; prompt: string; baseline: string; status: string; doneNote: string; sentAt: string | null; lastRunId: number | null; updatedBy?: string | null; updatedAt?: string | null; canWrite?: boolean };
export type AuditRun = { id: number; itemId: number; runAt: string | null; promptSnapshot: string; resultText: string; status: string; approvedBy?: string | null; approvedAt?: string | null };
export type AuditItemsResp = { sections: { section: string; items: AuditItem[] }[]; writeDomains: string[]; viewDomains: string[] };
// A user row for the Team-roles picker (main-admin access management).
export type TeamRoleUser = { username: string; role: string; isMain: boolean; legalEditor: boolean; contentEditor: boolean; owner: boolean; itEditor: boolean; bizEditor: boolean };
// ── Legal Portal (Raz ↔ owners) · a titled section holding a note thread ──
export type LegalNote = { id: number; sectionId: number; authorId: string | null; authorName: string; body: string; createdAt: string | null };
export type LegalSection = { id: number; title: string; body: string; status: "open" | "resolved"; createdBy: string | null; createdName: string; sort: number; createdAt: string | null; updatedAt: string | null; noteCount: number; lastNoteAt: string | null };
// A message in the portal's private chat room (collaborator ↔ owners). `mine` is set by the server.
export type LegalChatMsg = { id: number; authorId: string | null; authorName: string; body: string; createdAt: string | null; mine: boolean };
// Collaborator-portal domain: 'legal' (Raz) → /legal/portal/*, 'it' (Oren) → /it/portal/*,
// 'biz' (Raful) → /biz/portal/*.
export type PortalDomain = "legal" | "it" | "biz";
// IT portal "ניהול ועריכה" store — editable docs + "link your system to us" entries.
export type ItDoc = { id: number; title: string; body: string; updated_at?: string | null; updated_by?: string | null };
export type ItLink = { id: number; label: string; url: string; note: string; updated_at?: string | null };
// Biz-dev portal "מסמכים וחומרים" store — a doc PLUS an optional uploaded file (PDF/image/deck).
// The list carries file METADATA only (has_file/name/type/size); the bytes come from the download
// route. `ItLink` is reused for biz "קישורים ומקורות" (identical label/url/note shape).
export type BizDoc = {
  id: number; title: string; body: string;
  file_name?: string; file_type?: string; file_size?: number; has_file?: boolean;
  updated_at?: string | null; updated_by?: string | null;
};

// ── Owners Portal · project-management (Phase 2) ──
export type PmStatus = "todo" | "in_progress" | "blocked" | "done";
export type PmSubtask = { id: number; title: string; done: boolean };
export type PmTask = {
  id: number; key?: string | null; titleHe: string; titleEn: string;
  assignee?: string | null; partner?: string | null; partners?: string[]; status: PmStatus; progress: number;
  notes: string; detail?: string; subtasks?: PmSubtask[]; implStatus: string; phase?: string | null; category?: string | null;
  priority?: string; sort: number; updatedAt?: string | null; updatedBy?: string | null;
};
export type PmGoal = { partner: string; goalHe: string; goalEn: string; updatedAt?: string | null; updatedBy?: string | null };
// A comment/note on a task — owners give direction on any task; the assignee replies on theirs.
export type PmTaskComment = { id: number; author: string | null; authorName: string; text: string; createdAt: string | null; isOwner: boolean; mine: boolean };
export type PmProgress = { overall: number; byPhase: Record<string, number>; counts: Record<string, number>; total: number };

// ── Owners Portal · VOTING (Phase 3) ──
// Screens/tasks are judged approve/change/reject; DECISIONS are a real option-pick
// (vote='option' + a `choice` id) — the tally carries per-option counts + the winner.
export type VoteChoiceKey = "approve" | "change" | "reject";
export type VoteKind = VoteChoiceKey | "option" | "abstain";
export type VoteVoter = { voter: string; vote: VoteKind; choice?: string | null; comment: string; updatedAt?: string | null };
export type VoteTally = {
  itemKey: string; itemType: string; approve: number; change: number; reject: number; abstain: number;
  total: number; approvalPct: number; voters: VoteVoter[]; consensus?: VoteChoiceKey | null;
  byOption: Record<string, number>; top?: string | null; topPct: number; picks: number;
};
export type VoteTaskItem = { key: string; itemType: "task"; taskId: number; titleHe: string; titleEn: string; partner?: string | null; status?: string };
export type VoteMine = { vote: VoteKind; choice?: string | null; comment: string };
export type VotesData = {
  tallies: Record<string, VoteTally>;
  mine: Record<string, VoteMine>;
  taskItems: VoteTaskItem[]; linked: Record<string, number>; canVote: boolean;
};
export type VoteResults = {
  items: VoteTally[];
  overall: { approvalPct: number; totalVotes: number; itemsVoted: number; decisionsCount: number; needsWorkCount: number };
  decisions: VoteTally[]; needsWork: VoteTally[]; linked: Record<string, number>;
};

// ── Owners Portal · DAILY summary (Phase 4) ──
export type DailyAttention = {
  kind: "blocked" | "vote_needswork" | "near_done" | "open_priority";
  itemKey: string; target: "board" | "vote"; titleHe: string; titleEn: string;
  change?: number; reject?: number; progress?: number; taskId?: number;
};
export type DailyPulseDecision = { itemKey: string; top?: string | null; topPct: number; picks: number; lastAt?: string };
export type DailyPartner = { partner: string; name: string; openCount: number; avgProgress: number; goalHe: string; goalEn: string };
export type DailyRecent = { kind: "task" | "vote"; itemKey: string; target: "board" | "vote"; titleHe: string; titleEn: string; updatedAt?: string; by?: string | null };
export type DailyData = {
  date: string; dateEn: string; dateHe: string; generatedAt: string;
  overall: number; counts: Record<string, number>;
  attention: DailyAttention[];
  votingPulse: { decisions: DailyPulseDecision[]; contested: DailyPulseDecision[]; screensFlagged: { itemKey: string; change: number; reject: number }[] };
  partners: DailyPartner[]; recent: DailyRecent[];
  summary: { he: string; en: string };
};

// ── Owners Portal · SEND REPORT (Part C2) — team-only, dry-run by default ──
export type ReportRecipient = { partner: string; name: string; account: string | null; hasAccount: boolean; hasEmail?: boolean; emailConsent?: boolean; emailOk?: boolean; hasPhone?: boolean; hasWhatsappNumber?: boolean; smsOk?: boolean; waOk?: boolean; isStaff?: boolean; messageHe: string; messageEn: string };
export type ReportPreview = { dryRun: true; channel: string; scope: string; recipients: ReportRecipient[]; count: number; sendable: number; emailConfigured?: boolean };
export type ReportResult = { partner: string; name: string; ok: boolean; status: string; error?: string };
export type ReportSendResult = { dryRun: false; channel: string; results: ReportResult[]; sent: number; total: number };

// ── Owners Portal · FINANCE (owner-only) ──
export type FinKind = "budget" | "expenses" | "wallets" | "revenue" | "investments";
export type FinBudgetLine = { id: number; scope: "month" | "forward"; period: string; category: string; label: string; planned: number; actual: number; currency: string; notes: string; sort: number; updatedAt?: string; updatedBy?: string };
export type FinExpense = { id: number; name: string; amount: number; category: string; currency: string; dueDate: string; status: "planned" | "pending" | "paid" | "overdue" | "cancelled"; recurring: string; notes: string; updatedAt?: string; updatedBy?: string };
export type FinWallet = { id: number; name: string; balance: number; currency: string; kind: string; notes: string; sort: number; updatedAt?: string; updatedBy?: string };
export type FinRevenue = { id: number; period: string; label: string; amount: number; currency: string; notes: string; sort: number; updatedAt?: string; updatedBy?: string };
export type FinInvestmentPurpose = "working_capital" | "owner_loan" | "initial_shares" | "equity" | "company" | "ongoing" | "other";
export type FinInvestment = { id: number; amount: number; kind: "initial" | "additional"; source: string; date: string; owner: string; currency: string; purpose: FinInvestmentPurpose; priority?: string; notes: string; sort: number; updatedAt?: string; updatedBy?: string };
export type FinOwnerOpt = { id: string; name: string };
export type FinCashRow = { month: string; in: number; out: number; net: number; cumulative: number };
export type PayrollRow = { id: number; name: string; amount: number; category: string; currency: string; dueDate: string; status: "paid" | "pending"; employee: string; employeeName: string; ptype: string; virtual: boolean };
export type PayrollSummary = { paid: number; pending: number; monthly: number; thisMonthPaid: number; byEmployee: Record<string, { paid: number; pending: number }>; count: number };
export type FinSummary = { thisMonth: string; investedTotal: number; investedByOwner: Record<string, number>; investedByPurpose: Record<string, number>; budgetPlannedMonth: number; budgetActualMonth: number; budgetPlannedForward: number; budgetPlannedTotal: number; budgetActualTotal: number; budgetRemaining: number; walletTotal: number; openExpenses: number; paidExpenses: number; revenueTotal: number; revenueThisMonth: number; expensesThisMonth: number; netThisMonth: number; projectedNet: number; runwayNet: number; payroll: PayrollSummary };
// ── Management console (SheraCore pattern) · P2.2 ──
export type MgmtScope = { projectId: number; scopeRole: "operator" | "editor" | "viewer" };
export type MgmtMember = { username: string; scopeRole: "operator" | "editor" | "viewer"; grantedBy: string };
export type MgmtProject = {
  id: number; slug: string; nameHe: string; nameEn: string; description: string;
  status: "active" | "paused" | "archived"; ownerOnly: boolean; members: MgmtMember[];
};
export type MgmtTeamRow = { username: string; layer: "3_owner" | "2a_execution_operator" | "2b_team" | "1_client"; scopes: MgmtScope[] };
export type MgmtConsole = { projects: MgmtProject[]; team: MgmtTeamRow[] };
export type MgmtApproval = {
  ref: string; action: string; payload: Record<string, unknown>;
  requestedBy: string; requestedAt: string | null; expiresAt: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "executed";
  approvals: { owner: string; at: string; note?: string }[]; approvers: string[];
};
export type MgmtApprovals = { available: boolean; requests: MgmtApproval[]; actions: string[] };
export type MgmtCompliance = { btcOnly: boolean; clientAutopilotFrozen: boolean };

// ── Shared fund (P3) — owners' proportional stake + NAV ──
export type SharedFundOwner = { owner: string; name: string; contributed: number; ownershipPct: number };
export type SharedFund = { navUsd: number; contributedTotal: number; pnlNet: number; byOwner: SharedFundOwner[]; currency: string; note: string };

export type FinanceOverview = { budget: FinBudgetLine[]; expenses: FinExpense[]; wallets: FinWallet[]; revenue: FinRevenue[]; investments: FinInvestment[]; owners: FinOwnerOpt[]; payroll: PayrollRow[]; cashflow: FinCashRow[]; summary: FinSummary; currency: string; canEdit?: boolean };

// ── Employee Management ──
export type EmployeeStatus = "active" | "onboarding" | "paused";
export type EmployeePaymentType = "salary" | "bonus" | "expense" | "addition";
export type EmployeePayment = { id: number; username: string; type: EmployeePaymentType; amount: number; currency: string; date: string; status: "paid" | "pending"; note: string };
export type OnboardInfo = { username: string; name: string; role: string; workDomains: string[]; hasPortal: boolean; team: { name: string; role_he: string; role_en: string }[] };
export type BonusProgramStatus = "none" | "requested" | "active" | "paused";
export type BonusProgram = { status: BonusProgramStatus; initialDeposit: number; bonusAccrued: number; capital: number; tradingPnl: number; totalValue: number; bonusHistory: EmployeePayment[]; depositInvestmentId: number | null };
// Owner-editable bilingual bonus-program presentation (the "how it works" story shown to employees).
export type BonusProgramStep = { icon?: string; titleHe: string; titleEn: string; bodyHe: string; bodyEn: string };
export type BonusProgramDef = {
  titleHe: string; titleEn: string; introHe: string; introEn: string;
  steps: BonusProgramStep[]; benefitHe: string; benefitEn: string; termsHe: string; termsEn: string;
  updatedAt?: string | null; updatedBy?: string | null;
};
export type Employee = {
  username: string; name: string; fullName?: string; avatar?: string; role: string; workDomains: string[];
  status: EmployeeStatus; joinDate: string; birthday: string; contact: string; subaccountDetails: string;
  monthlySalary: number; bonusAccount: boolean; hasPortal: boolean; walletAddress: string;
  bonusProgramStatus: BonusProgramStatus; initialDeposit: number; tradingPnl: number; depositInvestmentId: number | null;
  payments: { count: number; paid: number; pending: number }; program: BonusProgram; taskCount: number; portalDomain?: "legal" | "it" | "biz" | null;
};

export type Entitlements = {
  plan: "basic" | "middle" | "pro";
  planLabel: string;
  role: string;
  isAdmin: boolean;
  scanCap: number | null;
  breakoutsVisible: number | null;
  bots: number;
  signalBots?: boolean;
  strategies: number;
  backtest: boolean;
  backtestPerDay: number;
  backtestAssetCap: number;
  profitEngine: boolean;
  profitRunsPerDay: number;
  profitInvestCap: number | null;
  profitUnlocked: boolean;
  features: string[];
  credits: Record<string, number>;
  loyaltyPoints: number;
  subscriptionStatus: string | null;
  subscriptionPeriodEnd: string | null;
  onboarded: boolean;
  badge: "starter" | "trader" | "strategist" | "pro" | null;
  isDemo: boolean;
  demoExpires: string | null;
  testerScore?: number;
};

export type DemoTester = { username: string; active: boolean; minutesLeft: number; score?: number; expires: string | null; link: string; plan?: "basic" | "middle" | "pro" };

export type RunRow = { id: number; username: string | null; mode: string; symbol: string | null; side: string | null; opened_at: string | null; closed_at: string | null; duration_seconds: number | null; entry_price: number | null; exit_price: number | null; qty: number | null; pnl: number | null; pnl_pct: number | null; status: string; source: string | null; created_at: string };

export type AuditRow = { id: number; ts: string; actor: string | null; action: string; target: string | null; ip: string | null; detail: any };
export type UserDetail = {
  account: { username: string; role: string; isMain: boolean; createdAt: string | null; createdBy: string | null; email: string | null; phone: string | null; nickname: string | null; plan: string; profitEngineUnlocked: boolean; isDemo: boolean; demoExpires: string | null; onboarded: boolean; badge: string | null; loyaltyPoints: number; subscriptionStatus: string | null };
  access: { locked: string[] };
  logins: { since: string | null; last_seen: string | null; sessions: number };
  audit: AuditRow[];
  runs: RunRow[];
  demo: { score: number | null; pnl: number | null } | null;
};

export type LeaderRow = { username: string; name: string; createdAt: string | null; tenureDays: number | null; pnl: number; pnlPct: number; trades: number; wins: number; winRate: number | null; score: number };

export type SignupReq = { id: number; name: string; email: string | null; phone: string | null; note: string | null; status: string; created_at: string; username: string | null };
export type PasswordResetReq = { id: number; username: string; contact: string | null; note: string | null; status: string; created_at: string; handled_by: string | null; handled_at: string | null };

export type ChannelConsent = { ts: string; version: string; channel: string };
export type NotifPrefs = {
  sms: boolean; whatsapp: boolean; email: boolean; whatsappTo: string;
  breakout: boolean; takeProfit: boolean; stopLoss: boolean; botTrade: boolean; digest: boolean; chat: boolean;
  phone?: string; emailTo?: string;
  consent?: Record<string, ChannelConsent>;
};

export type FeaturePromo = {
  title: string;
  body: string;
  route: string;
  cta: string;
  active: boolean;
  createdAt: string;
};

export type PlanInfo = {
  id: "basic" | "middle" | "pro";
  label: string;
  price: number;
  scanCap: number | null;
  bots: number;
  strategies: number;
  backtestPerDay: number;
  backtestAssetCap: number;
  profitEngine: boolean;
  profitRunsPerDay: number;
};

export type OnboardingStep = { key: string; path: string; titleEn: string; titleHe: string; descEn: string; descHe: string };
export type OnboardingProfile = {
  answers?: Record<string, string>;
  stratScore: number;
  level: "beginner" | "intermediate" | "advanced";
  levelLabelEn: string; levelLabelHe: string;
  headlineEn: string; headlineHe: string;
  recommendedPlan: "basic" | "middle" | "pro";
  steps: OnboardingStep[];
  computedAt?: string;
};

export type GrantSpec = {
  all?: boolean; none?: boolean;
  plan?: "basic" | "middle" | "pro";
  profitUnlock?: boolean;
  credits?: Record<string, number>;
  sections?: "all" | "none";
};
export type Coupon = {
  code: string; grant: GrantSpec; summary: string;
  maxUses: number; usedCount: number; expiresAt: string | null;
  note: string | null; active: boolean; createdAt?: string;
};
export type AccessRequest = {
  id: number; username: string; message: string | null;
  status: string; handled_by: string | null; handled_at: string | null; created_at: string;
};

export type CreditPack = { kind: string; label: string; price: number; units: number };

// Admin safety-dashboard rollup (Item 6) — aggregate counts only, no identities.
export type SafetyBreakdown = { key: string; n: number };
export type AnalyticsSafety = {
  days: number;
  blocked_by_reason: SafetyBreakdown[];
  blocked_by_action: SafetyBreakdown[];
  validation_by_screen: SafetyBreakdown[];
  go_live: { attempts: number; confirmed: number; blocked: number; kill_switch: number };
  volumes: { scanner_runs: number; backtests: number };
};
export type BillingConfig = {
  configured: boolean;
  plans: PlanInfo[];
  profitUnlockPrice: number;
  creditPacks: CreditPack[];
};

/** A Reels learning lesson (admin-managed). `video_url` is a hosted link
 * (e.g. a HeyGen export) or a base64 data URL for direct uploads. */
export interface ReelsLesson {
  id: number;
  title_he: string;
  title_en: string;
  caption_he: string;   // bilingual caption shown under the title in the player
  caption_en: string;
  description: string;   // legacy longer text (kept for back-compat)
  video_url: string | null;
  free_preview_seconds: number;
  position: number;
  published: boolean;
  created_at: string;
  updated_at: string;
}

/** Fields an admin can send when creating/updating a lesson. */
export interface ReelsLessonInput {
  title_he?: string;
  title_en?: string;
  caption_he?: string;
  caption_en?: string;
  description?: string;
  video_url?: string | null;
  free_preview_seconds?: number;
  position?: number;
  published?: boolean;
}

/** A University / Learn content item (content_editor-managed). `section` groups it:
 * getting_started (a step) · concepts (a card: icon + title + body) · glossary (term + def). */
export type UniSection = "getting_started" | "concepts" | "glossary";
export interface UniItem {
  id: number; section: UniSection; icon: string;
  titleHe: string; titleEn: string; bodyHe: string; bodyEn: string;
  position: number; published: boolean; updatedAt?: string | null; updatedBy?: string | null;
}
/** Snake_case input the CRUD + import endpoints accept. */
export interface UniItemInput {
  section?: string; icon?: string; title_he?: string; title_en?: string;
  body_he?: string; body_en?: string; position?: number; published?: boolean;
}

// ── Signal Automated Bots (server-stored trade-only keys + TradingView webhooks) ──
// A user's own bot: keys are NEVER returned (only the has* flags); the engine
// places REAL orders on the connected account when a TradingView alert hits the
// per-bot webhook. `webhookUrl` + `alertTemplate` are what the user pastes into
// their TradingView alert.
export type Bot = {
  id: number | string;
  label: string;
  status: "active" | "paused" | string;
  exchange: string;
  market: string | null;
  subAccount: string | null;
  maxQuote: number | null;
  maxOpen: number | null;
  // Order-size mode: 'fixed' (per-order maxQuote / alert quote) or 'balance_pct' (size a
  // BUY off sizePct% of the free quote balance — SPOT LONG-ONLY). sizePct defaults to 100.
  sizeMode?: "fixed" | "balance_pct" | string;
  sizePct?: number | null;
  hasKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
  createdAt: string | null;
  webhookToken?: string;
  webhookUrl?: string;
  pnl: number;
  trades: number;
  openPositions: number;
};
export type BotCreatePayload = {
  label: string; key: string; secret: string; passphrase?: string;
  exchange: string; market?: string; subAccount?: string;
  maxQuote?: number; maxOpen?: number;
  sizeMode?: "fixed" | "balance_pct"; sizePct?: number;
};
export type BotPatch = Partial<Pick<Bot, "label" | "status" | "maxQuote" | "maxOpen" | "exchange" | "market" | "subAccount" | "sizeMode" | "sizePct">>
  & { key?: string; secret?: string; passphrase?: string };
export type BotCreateResult = { ok: boolean; bot: Bot; webhookUrl: string; alertTemplate: string; note?: string };
// A runs_log row as returned by GET /bots/{id}/logs (a closed/open trade the bot took).
export type BotLog = {
  symbol: string | null; side: string | null;
  opened_at: string | null; closed_at: string | null;
  pnl: number | null; pnl_pct: number | null; status: string;
  [k: string]: any;
};

// ── Owner / Requests portal (help-desk: user requests + internal owner notes) ──
export type RequestStatus = "new" | "in_progress" | "answered" | "resolved";
export type RequestCategory = "user_request" | "owner_note";
export type RequestReply = {
  id: number; authorId: string | null; authorName: string | null;
  text: string; createdAt: string;
};
export type RequestRow = {
  id: number; userId: string | null; displayName: string | null;
  category: RequestCategory; subject: string | null; body: string;
  media: string | null; route: string | null; status: RequestStatus;
  createdAt: string; updatedAt: string | null; replyCount: number;
};
export type RequestDetail = RequestRow & { replies: RequestReply[] };

// ── Admin "Reply to users" inbox ──
export type AdminInboxThread = {
  userId: string; displayName: string; latestTs?: string | null; snippet: string;
  needsReply: boolean; sources: ("chat" | "feedback")[];
};
export type AdminInboxItem = {
  ts?: string | null; text: string; fromUser: boolean; author?: string | null;
  source: "chat" | "feedback"; requestId?: number; status?: string;
};

export class Api {
  private token: string | null = null;
  private pin: string | null = null;
  private exCreds: ExchangeCreds | null = null;
  // In-flight GET coalescing: when several components ask for the SAME thing during
  // one load (e.g. /auth/me from App + the password-change gate), they share ONE
  // round-trip instead of each firing its own. Entries live only while the request
  // is in flight (removed on settle) — this is NOT a result cache, so it never
  // changes what data a caller sees, only collapses duplicate concurrent fetches.
  private inflight = new Map<string, Promise<unknown>>();

  constructor(public baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  setToken(token: string | null) { this.token = token; }
  /** The exchange protection code; sent as X-Exchange-Pin on money-moving routes. */
  setPin(pin: string | null) { this.pin = pin; }
  /** Non-custodial exchange keys; held in the browser, sent as transient headers. */
  setExchangeCreds(creds: ExchangeCreds | null) { this.exCreds = creds; }

  private async request<T>(
    method: string, path: string,
    opts: { body?: unknown; auth?: boolean; pin?: boolean; creds?: ExchangeCreds; timeoutMs?: number } = {},
  ): Promise<T> {
    const { body, auth = true, pin = false, timeoutMs } = opts;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (pin && this.pin) headers["X-Exchange-Pin"] = this.pin;
    // Per-call creds override (opts.creds) lets us query a specific sub-account
    // without disturbing the globally-active account.
    const ex = opts.creds ?? this.exCreds;
    const exApplies = !!ex && (path.startsWith("/exchange") || path.startsWith("/portfolio"));
    if (exApplies) {
      const c = ex!;
      if (c.key) headers["X-Exchange-Key"] = c.key;
      if (c.secret) headers["X-Exchange-Secret"] = c.secret;
      if (c.passphrase) headers["X-Exchange-Passphrase"] = c.passphrase;
      if (c.name) headers["X-Exchange-Name"] = c.name;
      if (c.env) headers["X-Exchange-Env"] = c.env;
    }

    // Coalesce only idempotent GETs. The key folds in everything that changes the
    // response (path + bearer token + exchange PIN + the per-account creds), so two
    // calls only share when they would hit the identical resource as the identical
    // caller. Mutations (POST/PUT/PATCH/DELETE) are never coalesced.
    const dedupe = method === "GET";
    const key = dedupe
      ? [method, path, (auth && this.token) ? this.token : "",
         (pin && this.pin) ? this.pin : "",
         exApplies ? [ex!.key, ex!.secret, ex!.passphrase, ex!.name, ex!.env].join("|") : ""].join("\n")
      : "";
    if (dedupe) {
      const existing = this.inflight.get(key);
      if (existing) return existing as Promise<T>;
    }

    const exec = (async (): Promise<T> => {
      // Optional hard timeout: a slow/blocked endpoint (e.g. the heavy /signals/compare
      // scan) must REJECT so the UI can show an error instead of spinning forever.
      // fetch has no native timeout, so we drive it with an AbortController.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let signal: AbortSignal | undefined;
      if (timeoutMs && timeoutMs > 0) {
        const ctrl = new AbortController();
        signal = ctrl.signal;
        timer = setTimeout(() => ctrl.abort(), timeoutMs);
      }
      let res: Response;
      try {
        res = await fetch(this.baseUrl + path, {
          method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal,
        });
      } catch (e) {
        if (signal?.aborted) throw new ApiError(0, `${method} ${path} timed out after ${Math.round((timeoutMs as number) / 1000)}s`);
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
      let data: unknown = null;
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) {
        // 503 = the backend maintenance gate cut this (non-admin) client off. Tell the
        // app so it flips to the MaintenanceScreen even if THIS build's local gate is
        // stale (old cached PWA) — the server is the source of truth, not the client.
        if (res.status === 503) {
          try { window.dispatchEvent(new CustomEvent("algo770-maintenance")); } catch { /* SSR/no-window */ }
        }
        const detail = (data as { detail?: string } | null)?.detail;
        throw new ApiError(res.status, detail || `${method} ${path} failed (${res.status})`);
      }
      return data as T;
    })();

    if (dedupe) {
      this.inflight.set(key, exec);
      // Drop the entry the instant the request settles (success OR error) so the
      // next call after this one always re-fetches — we never serve a cached body.
      exec.then(() => { if (this.inflight.get(key) === exec) this.inflight.delete(key); },
                () => { if (this.inflight.get(key) === exec) this.inflight.delete(key); });
    }
    return exec;
  }

  // ── system / auth ──
  health() { return this.request<{ status: string }>("GET", "/healthz", { auth: false }); }
  resync() { return this.request<{ ok: boolean }>("POST", "/system/resync"); }
  // Global maintenance / "under development" gate. Status is per-user (includes
  // isAdmin so the client can bypass the splash); setting it is admin-only.
  maintenanceStatus() { return this.request<{ maintenance: boolean; isAdmin: boolean }>("GET", "/system/maintenance"); }
  setMaintenance(on: boolean) { return this.request<{ ok: boolean; maintenance: boolean }>("POST", "/system/maintenance", { body: { on } }); }
  me() { return this.request<{ username: string; role: string; isMain?: boolean; isOwner?: boolean; isLegalEditor?: boolean; isItEditor?: boolean; isBizEditor?: boolean; isContentEditor?: boolean; mustChangePassword?: boolean }>("GET", "/auth/me"); }
  // ── Layout / location editor — resolved per (user, screen); server is the source of truth ──
  layoutGet(screen: string) { return this.request<LayoutResolved>("GET", `/auth/layout/${encodeURIComponent(screen)}`); }
  layoutSave(screen: string, scope: LayoutScope, arrangement: LayoutArrangement) {
    return this.request<{ ok: boolean; screen: string; scope: string; arrangement: LayoutArrangement | null; source: string }>("PUT", `/auth/layout/${encodeURIComponent(screen)}`, { body: { scope, arrangement } });
  }
  layoutReset(screen: string, scope: LayoutScope = "user") {
    return this.request<{ ok: boolean; screen: string; arrangement: LayoutArrangement | null; source: string }>("DELETE", `/auth/layout/${encodeURIComponent(screen)}?scope=${scope}`);
  }
  // ── Home Guide (mascot overlay) config — read by anyone to PLAY; saved by owner/admin ──
  guideConfigGet() { return this.request<GuideConfigResolved>("GET", "/auth/guide/config"); }
  guideConfigSave(config: Partial<GuideConfig>) {
    return this.request<{ ok: boolean; config: GuideConfig; assetKeys: string[] }>("PUT", "/auth/guide/config", { body: config });
  }
  // The uploaded-asset URL a plain <img>/<audio> tag can load (public read; ?v busts cache).
  guideAssetUrl(key: string, v?: string | number) { return `${this.baseUrl}/auth/guide/asset/${encodeURIComponent(key)}${v != null ? `?v=${v}` : ""}`; }
  // Raw-body upload (Content-Type = the file's mime) — not via request() (which JSON-encodes).
  async guideAssetUpload(key: string, file: File | Blob) {
    const res = await fetch(`${this.baseUrl}/auth/guide/asset/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        "Content-Type": (file as File).type || "application/octet-stream",
      },
      body: file,
    });
    if (!res.ok) throw new ApiError(res.status, (await res.text().catch(() => "")) || `upload failed (${res.status})`);
    return (await res.json()) as { ok: boolean; key: string; mime: string; url: string };
  }
  guideAssetDelete(key: string) { return this.request<{ ok: boolean; key: string }>("DELETE", `/auth/guide/asset/${encodeURIComponent(key)}`); }
  // ── Review board (Phase 2) — gated to owners + it_editor server-side ──
  reviewSubmit(notes: ReviewNote[], prompt: string, fromName?: string) {
    return this.request<{ ok: boolean; submission: ReviewSubmission }>("POST", "/auth/review/submit", { body: { notes, prompt, fromName } });
  }
  reviewSubmissions() { return this.request<{ submissions: ReviewSubmission[] }>("GET", "/auth/review/submissions"); }
  // The served URL for one attached review file token (public read; an <img> tag loads it).
  reviewFileUrl(token: string) { return `${this.baseUrl}/auth/review/file/${encodeURIComponent(token)}`; }
  reviewDeleteSubmission(id: number) { return this.request<{ ok: boolean; id: number }>("DELETE", `/auth/review/submissions/${id}`); }
  reviewReport(from?: string, to?: string) {
    const qs = new URLSearchParams(); if (from) qs.set("from", from); if (to) qs.set("to", to);
    return this.request<ReviewReport>("GET", `/auth/review/report${qs.toString() ? `?${qs.toString()}` : ""}`);
  }
  reviewReportEmail(from?: string, to?: string, email?: string) {
    return this.request<{ ok: boolean; to: string; count: number }>("POST", "/auth/review/report/send", { body: { from, to, email } });
  }
  // ── Prompt snapshots (per-reviewer save/restore checkpoints of the working prompt) ──
  reviewSnapshots() { return this.request<{ snapshots: ReviewSnapshot[] }>("GET", "/auth/review/snapshots"); }
  reviewSaveSnapshot(name: string, content: string) {
    return this.request<{ ok: boolean; snapshot: ReviewSnapshot }>("POST", "/auth/review/snapshots", { body: { name, content } });
  }
  reviewDeleteSnapshot(id: number) { return this.request<{ ok: boolean; id: number }>("DELETE", `/auth/review/snapshots/${id}`); }
  // ── Team roles (main-admin only) — assign partners access via a user picker ──
  teamRoles() { return this.request<{ users: TeamRoleUser[] }>("GET", "/auth/team-roles"); }
  setTeamRole(username: string, role: "admin" | "legal_editor" | "content_editor" | "owner" | "it_editor" | "biz_editor", enabled: boolean) {
    return this.request<{ ok: boolean }>("POST", "/auth/team-roles", { body: { username, role, enabled } });
  }
  // ── Owners Portal · project-management board (Phase 2) ──
  pmBoard() { return this.request<{ tasks: PmTask[]; goals: PmGoal[]; progress: PmProgress; partners: string[] }>("GET", "/auth/pm/board"); }
  pmMine() { return this.request<{ partner: string | null; tasks: PmTask[]; goal: PmGoal | null; progress: PmProgress }>("GET", "/auth/pm/mine"); }
  // Task comments — owners give direction on ANY task (incl. Raz/Oren's); the assignee replies.
  pmTaskComments(taskId: number) { return this.request<{ comments: PmTaskComment[] }>("GET", `/auth/pm/tasks/${taskId}/comments`); }
  pmTaskAddComment(taskId: number, text: string) { return this.request<{ comment: PmTaskComment }>("POST", `/auth/pm/tasks/${taskId}/comments`, { body: { text } }); }
  pmTaskDeleteComment(taskId: number, commentId: number) { return this.request<{ ok: boolean }>("DELETE", `/auth/pm/tasks/${taskId}/comments/${commentId}`); }
  pmPartner(partner: string) { return this.request<{ partner: string; tasks: PmTask[]; goal: PmGoal | null; progress: PmProgress }>("GET", `/auth/pm/partner/${encodeURIComponent(partner)}`); }
  pmCreateTask(body: Partial<PmTask>) { return this.request<{ task: PmTask }>("POST", "/auth/pm/tasks", { body }); }
  pmUpdateTask(id: number, body: Partial<PmTask>) { return this.request<{ task: PmTask }>("POST", `/auth/pm/tasks/${id}`, { body }); }
  pmDeleteTask(id: number) { return this.request<{ ok: boolean }>("DELETE", `/auth/pm/tasks/${id}`); }
  pmAddSubtask(taskId: number, title: string) { return this.request<{ task: PmTask }>("POST", `/auth/pm/tasks/${taskId}/subtasks`, { body: { title } }); }
  pmUpdateSubtask(taskId: number, subId: number, body: { title?: string; done?: boolean }) { return this.request<{ task: PmTask }>("POST", `/auth/pm/tasks/${taskId}/subtasks/${subId}`, { body }); }
  pmDeleteSubtask(taskId: number, subId: number) { return this.request<{ task: PmTask }>("DELETE", `/auth/pm/tasks/${taskId}/subtasks/${subId}`); }
  pmSetGoal(partner: string, goalHe: string, goalEn: string) { return this.request<{ goal: PmGoal }>("POST", `/auth/pm/goals/${encodeURIComponent(partner)}`, { body: { goalHe, goalEn } }); }
  // ── Owners Portal · voting (Phase 3) — cast is owners/admin; reads open to partners ──
  votesData() { return this.request<VotesData>("GET", "/auth/pm/votes"); }
  voteResults() { return this.request<VoteResults>("GET", "/auth/pm/votes/results"); }
  castVote(body: { itemKey: string; itemType: string; vote: VoteKind; choice?: string | null; comment?: string }) {
    return this.request<{ vote: VoteVoter; tally: VoteTally | null }>("POST", "/auth/pm/votes", { body });
  }
  withdrawVote(itemKey: string) { return this.request<{ ok: boolean; tally: VoteTally | null }>("DELETE", `/auth/pm/votes/${encodeURIComponent(itemKey)}`); }
  promoteVote(body: { itemKey: string; itemType: string; titleHe?: string; titleEn?: string; partner?: string | null }) {
    return this.request<{ task: PmTask; linked: boolean; created: boolean }>("POST", "/auth/pm/votes/promote", { body });
  }
  // ── Owners Portal · daily morning summary (Phase 4) ──
  daily() { return this.request<DailyData>("GET", "/auth/pm/daily"); }
  // ── Owners Portal · send report (Part C2). dryRun=true previews without sending. ──
  // ── Management console (SheraCore pattern) · P2.2 — READ-ONLY, owner-only ──
  mgmtConsole() { return this.request<MgmtConsole>("GET", "/auth/mgmt/console"); }
  // ── 3-of-3 approvals (P2.4) — governance records only; nothing executes ──
  mgmtApprovals() { return this.request<MgmtApprovals>("GET", "/auth/mgmt/approvals"); }
  mgmtApprovalCreate(body: { action: string; payload?: Record<string, unknown>; expiresHours?: number }) {
    return this.request<{ request: MgmtApproval }>("POST", "/auth/mgmt/approvals", { body });
  }
  mgmtApprovalApprove(ref: string, note?: string) {
    return this.request<{ request: MgmtApproval }>("POST", `/auth/mgmt/approvals/${encodeURIComponent(ref)}/approve`, { body: { note: note || "" } });
  }
  mgmtApprovalReject(ref: string, note?: string) {
    return this.request<{ request: MgmtApproval }>("POST", `/auth/mgmt/approvals/${encodeURIComponent(ref)}/reject`, { body: { note: note || "" } });
  }
  // ── Scope grants (owner-only): assign a user to a project with a role ──
  mgmtScopeGrant(body: { username: string; projectId: number; scopeRole: string }) {
    return this.request<MgmtConsole>("POST", "/auth/mgmt/scope", { body });
  }
  mgmtScopeRevoke(username: string, projectId: number) {
    return this.request<MgmtConsole>("DELETE", `/auth/mgmt/scope?username_q=${encodeURIComponent(username)}&project_id=${projectId}`);
  }
  // ── Compliance switches (owner-only): BTC-only + client-autopilot freeze ──
  mgmtCompliance() { return this.request<MgmtCompliance>("GET", "/auth/mgmt/compliance"); }
  mgmtComplianceSet(body: { btcOnly?: boolean; clientAutopilotFrozen?: boolean }) {
    return this.request<MgmtCompliance>("POST", "/auth/mgmt/compliance", { body });
  }
  // ── Owners Portal · SHARED FUND (owner-only, P3) ──
  sharedFund() { return this.request<SharedFund>("GET", "/auth/finance/fund"); }
  // ── Owners Portal · FINANCE (owner-only) ──
  financeOverview() { return this.request<FinanceOverview>("GET", "/auth/finance/overview"); }
  financeCreate(kind: FinKind, body: Record<string, unknown>) { return this.request<{ row: any }>("POST", `/auth/finance/${kind}`, { body }); }
  financeUpdate(kind: FinKind, id: number, body: Record<string, unknown>) { return this.request<{ row: any }>("POST", `/auth/finance/${kind}/${id}`, { body }); }
  financeDelete(kind: FinKind, id: number) { return this.request<{ ok: boolean }>("DELETE", `/auth/finance/${kind}/${id}`); }
  // ── Employee Management (owner-only) ──
  employees() { return this.request<{ employees: Employee[] }>("GET", "/auth/employees"); }
  employee(username: string) { return this.request<{ employee: Employee; payments: EmployeePayment[]; tasks: PmTask[] }>("GET", `/auth/employees/${username}`); }
  employeeUpdate(username: string, body: Partial<Employee>) { return this.request<{ employee: Employee }>("POST", `/auth/employees/${username}`, { body }); }
  employeeDelete(username: string) { return this.request<{ ok: boolean }>("DELETE", `/auth/employees/${username}`); }
  employeeAddPayment(username: string, body: { type?: string; amount?: number; date?: string; status?: string; note?: string; currency?: string }) { return this.request<{ payment: EmployeePayment }>("POST", `/auth/employees/${username}/payments`, { body }); }
  employeeUpdatePayment(id: number, body: Partial<EmployeePayment>) { return this.request<{ payment: EmployeePayment }>("POST", `/auth/employee-payments/${id}`, { body }); }
  employeeDeletePayment(id: number) { return this.request<{ ok: boolean }>("DELETE", `/auth/employee-payments/${id}`); }
  employeeRecordDeposit(username: string, body: { amount: number; date?: string }) { return this.request<{ employee: Employee; investmentId: number }>("POST", `/auth/employees/${username}/program/deposit`, { body }); }
  employeeCreate(body: { username: string; fullName?: string; role?: string; workDomains?: string[]; monthlySalary?: number; createPortal?: boolean; joinDate?: string }) {
    return this.request<{ employee: Employee; onboardToken: string; onboardUrl: string }>("POST", "/auth/employees", { body });
  }
  onboardInfo(token: string) { return this.request<OnboardInfo>("GET", `/auth/onboard?t=${encodeURIComponent(token)}`); }
  // ── employee self-service (their OWN record) ──
  myEmployee() { return this.request<{ employee: Employee | null; payments: EmployeePayment[] }>("GET", "/auth/me/employee"); }
  myEmployeeUpdate(body: { birthday?: string; contact?: string; subaccountDetails?: string }) { return this.request<{ employee: Employee }>("POST", "/auth/me/employee", { body }); }
  myEmployeeWallet(walletAddress: string) { return this.request<{ ok: boolean; employee: Employee }>("POST", "/auth/me/employee/wallet", { body: { walletAddress } }); }
  // ── Bonus-program DEFINITION (owner-editable, bilingual) — read by employees + owners ──
  bonusProgramDef() { return this.request<{ definition: BonusProgramDef }>("GET", "/auth/bonus-program/definition"); }
  bonusProgramDefSave(body: Partial<BonusProgramDef>) { return this.request<{ definition: BonusProgramDef }>("POST", "/auth/bonus-program/definition", { body }); }
  reportSend(body: { scope: string | string[]; channel: string; lang: string; dryRun: boolean }) {
    return this.request<ReportPreview | ReportSendResult>("POST", "/auth/pm/report/send", { body });
  }
  // ── Owners DAILY REPORT (branded bilingual PDF + HTML web view) ──
  // Fresh device-independent view links (token in the URL — openable in a new tab).
  ownersReportLink() { return this.request<{ token: string; html: string; pdf: string }>("GET", "/auth/pm/report/link"); }
  // Manual test trigger: render + send the daily report (email PDF+link, SMS link, Telegram PDF+link) now.
  ownersReportDailySend() { return this.request<{ date?: string; sent?: number; total?: number; smsSent?: number; smsTotal?: number; tgSent?: number; tgTotal?: number; link?: string; recipients?: { name: string; email: string; ok: boolean; message?: string }[]; smsRecipients?: { name: string; phone: string; ok: boolean; message?: string }[]; tgRecipients?: { name: string; account: string; ok: boolean; message?: string }[]; error?: string; skipped?: string }>("POST", "/auth/pm/report/daily-send", { body: {} }); }
  // Daily 09:00 auto-send flag (default OFF until Dan approves the design).
  ownersReportStatus() { return this.request<{ autoEnabled: boolean }>("GET", "/auth/pm/report/status"); }
  ownersReportAutosend(enabled: boolean) { return this.request<{ autoEnabled: boolean }>("POST", "/auth/pm/report/autosend", { body: { enabled } }); }
  // ── Legal texts (editable legal copy + the Legal Console) ──
  legalList() { return this.request<{ texts: LegalText[] }>("GET", "/legal", { auth: false }); }
  legalGet(key: string) { return this.request<LegalText>("GET", `/legal/${encodeURIComponent(key)}`, { auth: false }); }
  legalAdminList() { return this.request<{ texts: LegalText[] }>("GET", "/legal/admin/all"); }
  legalSave(key: string, body: { titleHe: string; titleEn: string; bodyHe: string; bodyEn: string; published: boolean; sort?: number }) {
    return this.request<{ ok: boolean; text: LegalText }>("PUT", `/legal/${encodeURIComponent(key)}`, { body });
  }
  legalEditors() { return this.request<{ editors: { username: string; role: string; isMain: boolean; legalEditor: boolean }[] }>("GET", "/legal/editors"); }
  legalSetEditor(username: string, enabled: boolean) { return this.request<{ ok: boolean }>("POST", "/legal/editors", { body: { username, enabled } }); }
  // Legal COPY blocks (Raz edits + approves the 4 analytics/safety blocks). GET is public.
  legalCopyList() { return this.request<{ blocks: LegalCopyBlock[] }>("GET", "/legal/copy", { auth: false }); }
  legalCopySave(block: string, he: string, en: string) { return this.request<{ ok: boolean; block: LegalCopyBlock }>("PUT", `/legal/copy/${encodeURIComponent(block)}`, { body: { he, en } }); }
  legalCopyApprove(block: string) { return this.request<{ ok: boolean; block: LegalCopyBlock }>("POST", `/legal/copy/${encodeURIComponent(block)}/approve`); }
  legalCopyUnapprove(block: string) { return this.request<{ ok: boolean; block: LegalCopyBlock }>("POST", `/legal/copy/${encodeURIComponent(block)}/unapprove`); }
  // ── Daily AUDIT (Oren/Raz/Dan) — DB store + role-gated edit/approve. ──
  auditItems() { return this.request<AuditItemsResp>("GET", "/audit/items"); }
  // OWNER-ONLY: copy Oren's control-panel/audit-board items ({it,product} he last edited) into
  // his IT pm_tasks. Copy-only + idempotent + reversible. dryRun=true returns just the count.
  auditMoveToPm(dryRun?: boolean) { return this.request<{ ok: boolean; dryRun?: boolean; candidates: number; copied?: number; skipped?: number; failed?: number }>("POST", "/audit/move-to-pm", { body: { dryRun } }); }
  auditCreateItem(body: { title: string; prompt?: string; domain: string; section?: string; baseline?: string; status?: string }) { return this.request<{ ok: boolean; item: AuditItem }>("POST", "/audit/items", { body }); }
  auditSaveItem(id: number, body: { prompt?: string; doneNote?: string }) { return this.request<{ ok: boolean; item: AuditItem }>("PUT", `/audit/items/${id}`, { body }); }
  auditSetStatus(id: number, status: string) { return this.request<{ ok: boolean; item: AuditItem }>("POST", `/audit/items/${id}/status`, { body: { status } }); }
  auditRun(id: number, resultText?: string) { return this.request<{ ok: boolean; run: AuditRun; item: AuditItem }>("POST", `/audit/items/${id}/run`, { body: { resultText } }); }
  auditSaveRun(runId: number, resultText: string) { return this.request<{ ok: boolean; run: AuditRun }>("PUT", `/audit/runs/${runId}`, { body: { resultText } }); }
  auditRuns(id: number) { return this.request<{ runs: AuditRun[] }>("GET", `/audit/items/${id}/runs`); }
  auditApproveRun(runId: number) { return this.request<{ ok: boolean; run: AuditRun; item: AuditItem }>("POST", `/audit/runs/${runId}/approve`); }
  auditDailyPrompt(domain?: string) { return this.request<{ text: string; count: number; itemIds: number[] }>("POST", "/audit/daily-prompt", { body: { domain } }); }
  // ── Collaborator portals (private, collaborator ↔ the 3 owners) — ONE domain-parameterised
  //    surface: domain 'legal' → /legal/portal/* (Raz), domain 'it' → /it/portal/* (Oren). ──
  portalSections(domain: PortalDomain, status?: "open" | "resolved") {
    return this.request<{ sections: LegalSection[] }>("GET", `/${domain}/portal/sections` + (status ? `?status=${status}` : ""));
  }
  portalCreateSection(domain: PortalDomain, body: { title: string; body: string }) {
    return this.request<{ ok: boolean; section: LegalSection }>("POST", `/${domain}/portal/sections`, { body });
  }
  portalSection(domain: PortalDomain, id: number) {
    return this.request<{ section: LegalSection; notes: LegalNote[] }>("GET", `/${domain}/portal/sections/${id}`);
  }
  portalUpdateSection(domain: PortalDomain, id: number, body: { title?: string; body?: string; status?: "open" | "resolved"; sort?: number }) {
    return this.request<{ ok: boolean; section: LegalSection | null }>("POST", `/${domain}/portal/sections/${id}`, { body });
  }
  portalDeleteSection(domain: PortalDomain, id: number) { return this.request<{ ok: boolean }>("DELETE", `/${domain}/portal/sections/${id}`); }
  portalAddNote(domain: PortalDomain, sectionId: number, body: string) {
    return this.request<{ ok: boolean; notes: LegalNote[] }>("POST", `/${domain}/portal/sections/${sectionId}/notes`, { body: { body } });
  }
  portalDeleteNote(domain: PortalDomain, noteId: number) { return this.request<{ ok: boolean }>("DELETE", `/${domain}/portal/notes/${noteId}`); }
  portalChat(domain: PortalDomain, sinceId = 0) { return this.request<{ messages: LegalChatMsg[]; lastId: number }>("GET", `/${domain}/portal/chat?since_id=${sinceId}`); }
  portalChatSend(domain: PortalDomain, body: string) { return this.request<{ ok: boolean; id: number }>("POST", `/${domain}/portal/chat`, { body: { body } }); }
  portalTasks(domain: PortalDomain) { return this.request<{ partner: string; tasks: PmTask[]; goal: PmGoal | null; progress: PmProgress }>("GET", `/${domain}/portal/tasks`); }
  // Full task editing INSIDE the portal — same pm_tasks system, portal-gated, scoped to the domain partner.
  portalCreateTask(domain: PortalDomain, body: { titleHe?: string; titleEn?: string; detail?: string; status?: string; progress?: number; phase?: string | null; partners?: string[]; assignee?: string | null; priority?: string }) {
    return this.request<{ task: PmTask }>("POST", `/${domain}/portal/tasks`, { body });
  }
  portalUpdateTask(domain: PortalDomain, id: number, body: Partial<PmTask>) { return this.request<{ task: PmTask }>("POST", `/${domain}/portal/tasks/${id}`, { body }); }
  portalDeleteTask(domain: PortalDomain, id: number) { return this.request<{ ok: boolean }>("DELETE", `/${domain}/portal/tasks/${id}`); }
  portalAddSubtask(domain: PortalDomain, taskId: number, title: string) { return this.request<{ task: PmTask }>("POST", `/${domain}/portal/tasks/${taskId}/subtasks`, { body: { title } }); }
  portalUpdateSubtask(domain: PortalDomain, taskId: number, subId: number, body: { title?: string; done?: boolean }) { return this.request<{ task: PmTask }>("POST", `/${domain}/portal/tasks/${taskId}/subtasks/${subId}`, { body }); }
  portalDeleteSubtask(domain: PortalDomain, taskId: number, subId: number) { return this.request<{ task: PmTask }>("DELETE", `/${domain}/portal/tasks/${taskId}/subtasks/${subId}`); }
  // IT "ניהול ועריכה" / Biz "מסמכים וחומרים" store — editable docs + links (mounted for it & biz).
  // For biz, a doc may carry an uploaded file: pass fileData as a base64 data-URL (fileData ''
  // clears it, omitted/undefined leaves it unchanged), plus fileName/fileType.
  portalDocs(domain: PortalDomain) { return this.request<{ docs: (ItDoc & BizDoc)[] }>("GET", `/${domain}/portal/docs`); }
  portalDocUpsert(domain: PortalDomain, body: { id?: number; title: string; body: string; fileName?: string; fileType?: string; fileData?: string | null }) { return this.request<{ doc: ItDoc & BizDoc }>("POST", `/${domain}/portal/docs`, { body }); }
  portalDocDelete(domain: PortalDomain, id: number) { return this.request<{ ok: boolean }>("DELETE", `/${domain}/portal/docs/${id}`); }
  /** Download a biz doc's uploaded file as a Blob (gated — fetched with the bearer token, then
   * saved client-side). Returns the Blob + best-effort filename from the Content-Disposition. */
  async portalDocFile(domain: PortalDomain, id: number): Promise<{ blob: Blob; filename: string }> {
    const res = await fetch(`${this.baseUrl}/${domain}/portal/docs/${id}/file`, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename="?([^"]+)"?/.exec(cd);
    return { blob: await res.blob(), filename: m ? m[1] : `document-${id}` };
  }
  portalLinks(domain: PortalDomain) { return this.request<{ links: ItLink[] }>("GET", `/${domain}/portal/links`); }
  portalLinkUpsert(domain: PortalDomain, body: { id?: number; label: string; url: string; note: string }) { return this.request<{ link: ItLink }>("POST", `/${domain}/portal/links`, { body }); }
  portalLinkDelete(domain: PortalDomain, id: number) { return this.request<{ ok: boolean }>("DELETE", `/${domain}/portal/links/${id}`); }
  portalReportLink(domain: PortalDomain) { return this.request<{ token: string; html: string; pdf: string }>("GET", `/${domain}/portal/report/link`); }
  portalReportSend(domain: PortalDomain) { return this.request<{ sent: number; total: number; smsSent: number; smsTotal: number; recipients: { name: string; email: string; emailOk: boolean | null; phone: string; smsOk: boolean | null; message?: string }[]; link: string | null; error?: string }>("POST", `/${domain}/portal/report/send`); }
  /** Forced set-new-password (no old password) — used by the gate the user is
   * routed to after an admin reset with "force change on next login". */
  setNewPassword(newPassword: string) { return this.request<{ ok: boolean }>("POST", "/auth/me/set-new-password", { body: { newPassword } }); }
  async login(username: string, password: string) {
    const raw: any = await this.request("POST", "/auth/login", { body: { username, password }, auth: false });
    if (raw && raw.twofa) {
      return {
        twofa: true as const,
        username: String(raw.username || username),
        // "totp" = authenticator app (primary); "otp" = Telegram/email code.
        method: (raw.method as string | undefined) || "otp",
        // For otp: free-channel delivery "telegram" | "email" | "sms" + a hint.
        channel: raw.channel as string | undefined,
        channelHint: raw.channelHint as string | undefined,
        // For totp: whether a lost-device recovery code can be sent.
        recoveryAvailable: !!raw.recoveryAvailable,
      };
    }
    const out = LoginResponse.parse(raw);
    this.token = out.token;
    return out;
  }
  async loginVerify(username: string, password: string, code: string) {
    const out = LoginResponse.parse(
      await this.request("POST", "/auth/login/verify", { body: { username, password, code }, auth: false }),
    );
    this.token = out.token;
    return out;
  }
  /** Lost-authenticator recovery: send a one-time code over Telegram/email. */
  loginRecovery(username: string, password: string) {
    return this.request<{ ok: boolean; channel?: string; channelHint?: string }>(
      "POST", "/auth/login/recovery", { body: { username, password }, auth: false });
  }
  // ── channel-OTP 2FA (code delivered over Telegram → email, not SMS) ──
  get2fa() { return this.request<{ enabled: boolean; phone: string | null; available: boolean; channelHint: string | null }>("GET", "/auth/me/2fa"); }
  start2fa() { return this.request<{ ok: boolean; channelHint?: string }>("POST", "/auth/me/2fa/start", { body: {} }); }
  enable2fa(code: string) { return this.request<{ ok: boolean; enabled: boolean }>("POST", "/auth/me/2fa/enable", { body: { code } }); }
  disable2fa() { return this.request<{ ok: boolean; enabled: boolean }>("POST", "/auth/me/2fa/disable", { body: {} }); }
  // ── TOTP authenticator-app 2FA (RFC 6238) — primary, zero-cost ──
  getTotp() { return this.request<{ enabled: boolean; available: boolean; recoveryAvailable: boolean; recoveryHint: string | null }>("GET", "/auth/me/totp"); }
  startTotp() { return this.request<{ ok: boolean; secret: string; otpauthUrl: string; qrSvg: string }>("POST", "/auth/me/totp/start", { body: {} }); }
  enableTotp(code: string) { return this.request<{ ok: boolean; enabled: boolean }>("POST", "/auth/me/totp/enable", { body: { code } }); }
  disableTotp() { return this.request<{ ok: boolean; enabled: boolean }>("POST", "/auth/me/totp/disable", { body: {} }); }
  // ── privacy-policy acknowledgement ──
  getPrivacyAck() { return this.request<{ acked: string | null }>("GET", "/auth/me/privacy"); }
  acceptPrivacy(version: string) { return this.request<{ ok: boolean; acked: string }>("POST", "/auth/me/privacy/accept", { body: { version } }); }

  // ── user management (admin) + account ──
  listUsers() { return this.request<{ username: string; role: string; created_at: string; email: string | null; phone: string | null }[]>("GET", "/auth/users"); }
  addUser(username: string, password: string, role: string, email?: string, demo?: boolean) {
    return this.request<{ username: string; role: string; email: string | null; demo?: boolean; demoExpires?: string | null }>("POST", "/auth/users", { body: { username, password, role, email, demo } });
  }
  setUserRole(username: string, role: string) { return this.request<{ ok: boolean }>("PATCH", `/auth/users/${encodeURIComponent(username)}`, { body: { role } }); }
  setUserPassword(username: string, password: string) { return this.request<{ ok: boolean }>("PATCH", `/auth/users/${encodeURIComponent(username)}`, { body: { password } }); }
  setUserEmail(username: string, email: string) { return this.request<{ ok: boolean }>("PATCH", `/auth/users/${encodeURIComponent(username)}`, { body: { email } }); }
  // Admin/owner: set (or clear) a user's phone. Persists to users.phone AND whatsappTo — the
  // fields the owners-report eligibility reads — so SMS/WhatsApp rows flip to "will send".
  setUserPhone(username: string, phone: string) { return this.request<{ ok: boolean }>("PATCH", `/auth/users/${encodeURIComponent(username)}`, { body: { phone } }); }
  deleteUser(username: string) { return this.request<{ ok: boolean }>("DELETE", `/auth/users/${encodeURIComponent(username)}`); }
  unlockUser(username: string) { return this.request<{ ok: boolean }>("POST", `/auth/users/${encodeURIComponent(username)}/unlock`); }
  resetLink(username: string) { return this.request<{ username: string; token: string; expiresAt: string; path: string; link: string; emailed: boolean; email: string | null }>("POST", `/auth/users/${encodeURIComponent(username)}/reset-link`); }
  /** Admin sets a NEW password for a user directly (the admin types it). When
   * forceChange is true the user is sent to a set-new-password screen next login. */
  resetUserPassword(username: string, password: string, forceChange = true) { return this.request<{ ok: boolean; username: string; forceChange: boolean }>("POST", `/auth/users/${encodeURIComponent(username)}/reset-password`, { body: { password, forceChange } }); }
  emailTest(to: string) { return this.request<{ ok: boolean; message: string }>("POST", "/auth/email-test", { body: { to } }); }
  auditLog(limit = 200) { return this.request<{ id: number; ts: string; actor: string | null; action: string; target: string | null; ip: string | null; detail: any }[]>("GET", `/auth/audit?limit=${limit}`); }
  listSessions() { return this.request<{ username: string; since: string; last_seen: string; sessions: number }[]>("GET", "/auth/sessions"); }
  emailData(body: { subject: string; text?: string; html?: string; recipients?: "all" | string[] }) {
    return this.request<{ ok: boolean; sent: number; recipients: number }>("POST", "/auth/email-data", { body });
  }
  changePassword(oldPassword: string, newPassword: string) { return this.request<{ ok: boolean }>("POST", "/auth/change-password", { body: { oldPassword, newPassword } }); }
  exportMyData() { return this.request<any>("GET", "/auth/me/export"); }
  deleteMyAccount(password: string) { return this.request<{ ok: boolean }>("POST", "/auth/me/delete", { body: { password } }); }
  // Item 7 — SOFT deletion REQUEST (marks account + notifies owners; no hard delete).
  myDataStatus() { return this.request<{ deletionRequestedAt: string | null }>("GET", "/auth/me/data-status"); }
  requestMyDeletion(reason?: string) { return this.request<{ ok: boolean; deletionRequestedAt: string | null }>("POST", "/auth/me/delete-request", { body: { reason } }); }
  withdrawMyDeletion() { return this.request<{ ok: boolean; deletionRequestedAt: string | null }>("POST", "/auth/me/delete-request", { body: { undo: true } }); }
  protectionStatus() { return this.request<{ set: boolean }>("GET", "/auth/me/protection"); }
  setProtection(code: string, currentCode = "") { return this.request<{ ok: boolean; cleared?: boolean }>("POST", "/auth/me/protection", { body: { code, currentCode } }); }
  // profile: nickname + win-rate target
  myProfile() { return this.request<{ username: string; nickname: string; winTarget: number; role: string; avatar?: string | null; email?: string | null; phone?: string | null; smsConfigured?: boolean }>("GET", "/auth/me/profile"); }
  setMyPhone(phone: string) { return this.request<{ ok: boolean; phone: string | null }>("POST", "/auth/me/phone", { body: { phone } }); }
  setMyEmail(email: string) { return this.request<{ ok: boolean; email: string | null }>("POST", "/auth/me/email", { body: { email } }); }
  changeMyPassword(currentPassword: string, newPassword: string) { return this.request<{ ok: boolean }>("POST", "/auth/me/password", { body: { currentPassword, newPassword } }); }
  setNickname(nickname: string) { return this.request<{ ok: boolean; nickname: string }>("POST", "/auth/me/nickname", { body: { nickname } }); }
  setAvatar(avatar: string | null) { return this.request<{ ok: boolean }>("POST", "/auth/me/avatar", { body: { avatar } }); }
  setWinTarget(target: number) { return this.request<{ ok: boolean; winTarget: number }>("POST", "/auth/me/win-target", { body: { target } }); }
  myAnalytics() { return this.request<any>("GET", "/auth/me/analytics"); }

  // ── tiers / entitlements / billing (Stage 1) ──
  // Paths live under /auth/* so the production Caddy (fixed proxy allowlist) routes them.
  entitlements() { return this.request<Entitlements>("GET", "/auth/me/entitlements"); }
  plans() { return this.request<PlanInfo[]>("GET", "/auth/plans"); }
  markOnboarded() { return this.request<{ ok: boolean }>("POST", "/auth/me/onboarded"); }
  setBadge(badge: string) { return this.request<{ ok: boolean; badge: string }>("POST", "/auth/me/badge", { body: { badge } }); }
  getMusic() { return this.request<{ music: string | null }>("GET", "/auth/me/music"); }
  setMusic(music: string | null) { return this.request<{ ok: boolean }>("POST", "/auth/me/music", { body: { music } }); }
  demoFeatures() { return this.request<{ features: string[] }>("GET", "/auth/demos"); }
  getDemo(feature: string) { return this.request<{ feature: string; video: string | null }>("GET", `/auth/demos/${encodeURIComponent(feature)}`); }
  setDemo(feature: string, video: string | null) { return this.request<{ ok: boolean }>("POST", `/auth/demos/${encodeURIComponent(feature)}`, { body: { video } }); }
  // ── demo testers + feedback ──
  async demoLogin(token: string) {
    const out = await this.request<{ token: string; username: string; role: string; demoMinutes: number }>("POST", "/auth/demo-login", { body: { token }, auth: false });
    this.token = out.token; return out;
  }
  // Welcome link: super-admin mints a one-time passwordless link into an existing
  // account; welcomeLogin redeems it (public) and returns a session token.
  welcomeLink(username: string) { return this.request<{ ok: boolean; username: string; token: string; link: string; expiresAt: string }>("POST", "/auth/welcome-link", { body: { username } }); }
  welcomeLogin(token: string) { return this.request<{ token: string; username: string; role: string }>("POST", "/auth/welcome-login", { body: { token }, auth: false }); }
  createDemoUser() { return this.request<DemoTester>("POST", "/auth/demo-users", { body: {} }); }
  listDemoUsers() { return this.request<DemoTester[]>("GET", "/auth/demo-users"); }
  demoLeaderboard() { return this.request<{ rows: LeaderRow[] }>("GET", "/auth/demo-leaderboard"); }
  leaderboardMessage() { return this.request<{ text: string }>("GET", "/auth/demo-leaderboard/message"); }
  adminRuns(p: { user?: string; mode?: string; status?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (p.user) q.set("user", p.user); if (p.mode) q.set("mode", p.mode);
    if (p.status) q.set("status", p.status); if (p.limit) q.set("limit", String(p.limit));
    const qs = q.toString();
    return this.request<{ runs: RunRow[] }>("GET", `/auth/admin/runs${qs ? `?${qs}` : ""}`);
  }
  adminUserDetail(username: string) { return this.request<UserDetail>("GET", `/auth/admin/user/${encodeURIComponent(username)}`); }
  // Signal Bots — PRIVACY-SCOPED admin view: count + limit only (never keys/funds/bot rows).
  adminUserBots(username: string) { return this.request<{ ok: boolean; count: number; limit: number }>("GET", `/auth/admin/user/${encodeURIComponent(username)}/bots`); }
  adminSetUserBotLimit(username: string, limit: number) { return this.request<{ ok: boolean; limit: number }>("POST", `/auth/admin/user/${encodeURIComponent(username)}/bot-limit`, { body: { limit } }); }
  extendDemo(username: string) { return this.request<{ ok: boolean }>("POST", `/auth/demo-users/${encodeURIComponent(username)}/extend`); }
  revokeDemo(username: string) { return this.request<{ ok: boolean }>("POST", `/auth/demo-users/${encodeURIComponent(username)}/revoke`); }
  // `image` is the legacy small-screenshot data URL (kept for existing callers).
  // `media` is a user-attached photo OR video data URL (Service Hub feedback) —
  // forwarded to the admin's Telegram as a real photo/video; `mediaName` is the
  // original filename used for the Telegram caption / document name.
  submitFeedback(text: string, route?: string, image?: string | null, media?: string | null, mediaName?: string | null) { return this.request<{ ok: boolean; id: number; telegram?: { ok: boolean; reason?: string; message?: string } }>("POST", "/auth/feedback", { body: { text, route, image, media, mediaName } }); }
  // Privacy-safe product analytics (Part F / Item 2). Fire-and-forget from lib/analytics.ts.
  // Both paths carry a client session_id + are consent-gated & sanitized server-side.
  trackEvent(event: string, props?: Record<string, unknown>, sessionId?: string) { return this.request<{ ok: boolean; stored?: boolean }>("POST", "/analytics/event", { body: { event, props: props || {}, session_id: sessionId } }); }
  collectEvent(event: string, props?: Record<string, unknown>, sessionId?: string) { return this.request<{ ok: boolean; stored?: boolean }>("POST", "/analytics/collect", { body: { event, props: props || {}, session_id: sessionId } }); }
  getAnalyticsConsent() { return this.request<{ consent: boolean; decided: boolean }>("GET", "/analytics/consent"); }
  setAnalyticsConsent(consent: boolean) { return this.request<{ ok: boolean; consent: boolean }>("POST", "/analytics/consent", { body: { consent } }); }
  analyticsSummary(days = 14) { return this.request<{ days: number; total: number; counts: Record<string, { n: number; users: number }>; trend: { day: string; n: number }[] }>("GET", `/analytics/summary?days=${days}`); }
  analyticsSafety(days = 14) { return this.request<AnalyticsSafety>("GET", `/analytics/safety?days=${days}`); }
  listFeedback() { return this.request<{ id: number; username: string; text: string; route: string | null; image?: string | null; handled: boolean; created_at: string }[]>("GET", "/auth/feedback"); }
  // ── notifications + messaging (SMS / WhatsApp) ──
  myNotifications() { return this.request<{ prefs: NotifPrefs; smsConfigured: boolean; whatsappConfigured: boolean; emailConfigured: boolean }>("GET", "/auth/me/notifications"); }
  setMyNotifications(prefs: Partial<NotifPrefs>) { return this.request<{ ok: boolean; prefs: NotifPrefs }>("PUT", "/auth/me/notifications", { body: { prefs } }); }
  testMyNotification() { return this.request<{ ok: boolean }>("POST", "/auth/me/notifications/test", { body: {} }); }
  broadcast(text: string, channel: "sms" | "whatsapp", target: string) { return this.request<{ ok: boolean; sent: number; skipped: string[]; total: number; channel: string }>("POST", "/auth/broadcast", { body: { text, channel, target } }); }
  // Owner-only: one-call setup of a WhatsApp alert recipient (phone + enable WhatsApp + all alerts).
  setWhatsappRecipient(username: string, phone: string, allAlerts = true) { return this.request<{ ok: boolean; username: string; phone: string; whatsappTo: string; whatsapp: boolean; whatsappConfigured: boolean }>("POST", "/auth/whatsapp/recipient", { body: { username, phone, allAlerts } }); }
  getAnnouncement() { return this.request<{ promo: FeaturePromo | null }>("GET", "/auth/announcement"); }
  setAnnouncement(p: { title: string; body: string; route: string; cta?: string; sms?: boolean; channel?: "sms" | "whatsapp"; target?: string }) { return this.request<{ ok: boolean; promo: FeaturePromo; sms: { sent: number; skipped: string[]; total: number; channel: string } | null }>("POST", "/auth/announcement", { body: p }); }
  clearAnnouncement() { return this.request<{ ok: boolean }>("DELETE", "/auth/announcement"); }
  sendDemoReminders() { return this.request<{ ok: boolean; sent: number }>("POST", "/auth/demo-reminders", { body: {} }); }
  // ── public self-signup → admin approval ──
  signupRequest(name: string, email: string, phone: string, note?: string) { return this.request<{ ok: boolean; id: number }>("POST", "/auth/signup-request", { body: { name, email, phone, note }, auth: false }); }
  // Instant self-registration (universal /join link): creates a 1-week demo account
  // with the user's own username + password and returns a session token to log in.
  // `website` is an anti-bot honeypot: the form keeps it hidden + empty for humans,
  // so any non-empty value means a bot auto-filled it → the server silently drops it.
  selfSignup(b: { name: string; email: string; phone: string; username: string; password: string; website?: string }) { return this.request<{ ok: boolean; token: string; username: string; role: string }>("POST", "/auth/self-signup", { body: b, auth: false }); }
  listSignupRequests() { return this.request<SignupReq[]>("GET", "/auth/signup-requests"); }
  approveSignup(id: number) { return this.request<{ ok: boolean; username: string; sentSms: boolean; sentEmail: boolean }>("POST", `/auth/signup-requests/${id}/approve`, { body: {} }); }
  denySignup(id: number) { return this.request<{ ok: boolean }>("POST", `/auth/signup-requests/${id}/deny`, { body: {} }); }
  // ── self-service "can't log in / forgot password" → admin approval → passwordless renewal ──
  // PUBLIC: file a reset request (never reveals whether the username exists).
  // `website` is an anti-bot honeypot (hidden + empty for humans); a filled value is
  // silently rejected server-side.
  requestPasswordReset(username: string, contact?: string, website?: string) { return this.request<{ ok: boolean }>("POST", "/auth/password-reset-request", { body: { username, contact, website }, auth: false }); }
  // PUBLIC: once approved, log straight into the set-new-password screen with just the username (no old password).
  resetApprovedLogin(username: string) { return this.request<{ token: string; username: string; role: string; mustChangePassword: boolean }>("POST", "/auth/reset-approved-login", { body: { username }, auth: false }); }
  // admin
  listPasswordResetRequests(status = "pending") { return this.request<PasswordResetReq[]>("GET", `/auth/password-reset-requests${status ? `?status=${status}` : ""}`); }
  approvePasswordReset(id: number) { return this.request<{ ok: boolean; username: string }>("POST", `/auth/password-reset-requests/${id}/approve`, { body: {} }); }
  rejectPasswordReset(id: number) { return this.request<{ ok: boolean }>("POST", `/auth/password-reset-requests/${id}/reject`, { body: {} }); }
  enableTelegramApprovals() { return this.request<{ ok: boolean }>("POST", "/telegram/enable-approvals", { body: {} }); }
  billingConfig() { return this.request<BillingConfig>("GET", "/auth/billing/config"); }
  billingCheckout(plan: string) { return this.request<{ url: string }>("POST", "/auth/billing/checkout", { body: { plan } }); }
  billingProfitUnlock() { return this.request<{ url: string }>("POST", "/auth/billing/profit-unlock"); }
  billingCredits(kind: string, packs = 1) { return this.request<{ url: string }>("POST", "/auth/billing/credits", { body: { kind, packs } }); }
  billingPortal() { return this.request<{ url: string }>("POST", "/auth/billing/portal"); }

  // ── onboarding (AI-agent quiz) ──
  submitOnboarding(answers: Record<string, string>) { return this.request<OnboardingProfile>("POST", "/auth/me/onboarding", { body: { answers } }); }
  getOnboarding() { return this.request<OnboardingProfile | {}>("GET", "/auth/me/onboarding"); }

  // ── access codes + requests ──
  redeemCode(code: string) { return this.request<{ ok: boolean; summary: string }>("POST", "/auth/redeem", { body: { code } }); }
  requestAccess(message?: string) { return this.request<{ ok: boolean; id: number }>("POST", "/auth/access-request", { body: { message } }); }
  // admin
  listCoupons() { return this.request<Coupon[]>("GET", "/auth/coupons"); }
  createCoupon(body: { grant: GrantSpec; code?: string; maxUses?: number; expiresAt?: string; note?: string }) { return this.request<Coupon>("POST", "/auth/coupons", { body }); }
  disableCoupon(code: string) { return this.request<{ ok: boolean }>("POST", `/auth/coupons/${encodeURIComponent(code)}/disable`); }
  listAccessRequests(status?: string) { return this.request<AccessRequest[]>("GET", `/auth/access-requests${status ? `?status=${status}` : ""}`); }
  grantAccessRequest(id: number, grant?: GrantSpec) { return this.request<{ ok: boolean; summary: string }>("POST", `/auth/access-requests/${id}/grant`, { body: { grant } }); }
  denyAccessRequest(id: number, requirePayment = false) { return this.request<{ ok: boolean; status: string }>("POST", `/auth/access-requests/${id}/deny`, { body: { requirePayment } }); }
  adminGrantUser(target: string, grant: GrantSpec) { return this.request<{ ok: boolean; summary: string }>("POST", `/auth/users/${encodeURIComponent(target)}/grant`, { body: { grant } }); }
  sectionAccess() { return this.request<{ locked: string[]; isAdmin: boolean }>("GET", "/auth/section-access"); }
  setSectionAccess(locked: string[]) { return this.request<{ ok: boolean; locked: string[] }>("POST", "/auth/section-access", { body: { locked } }); }
  userAccess(u: string) { return this.request<{ username: string; locked: string[] }>("GET", `/auth/users/${encodeURIComponent(u)}/access`); }
  setUserAccess(u: string, locked: string[]) { return this.request<{ ok: boolean; username: string; locked: string[] }>("POST", `/auth/users/${encodeURIComponent(u)}/access`, { body: { locked } }); }
  // in-app chat
  chatContacts() { return this.request<{ contacts: any[] }>("GET", "/auth/chat/contacts"); }
  chatSend(to: string | null, body: string, groupId?: number | null) { return this.request<{ ok: boolean; message: any }>("POST", "/auth/chat/send", { body: { to, body, groupId } }); }
  chatPoll(since = 0) { return this.request<{ messages: any[] }>("GET", `/auth/chat/poll?since=${since}`); }
  // ── admin "Reply to users" inbox (inbound DMs + Service-Hub feedback, grouped by user) ──
  adminInbox() { return this.request<{ threads: AdminInboxThread[]; count: number; needsReplyCount: number }>("GET", "/auth/admin/inbox"); }
  adminInboxThread(user: string) { return this.request<{ userId: string; displayName: string; items: AdminInboxItem[] }>("GET", `/auth/admin/inbox/${encodeURIComponent(user)}`); }
  adminInboxReply(to: string, text: string) { return this.request<{ ok: boolean; message: any }>("POST", "/auth/admin/inbox/reply", { body: { to, text } }); }
  // ── team messages (admin → user inbox) ──
  // An admin replies to one user with a branded, stored message; the user reads it
  // in their "Messages from the team" inbox. Title is optional (sent only when set).
  sendAdminMessage(to: string, title: string, body: string) { return this.request<{ ok: boolean; id: number }>("POST", "/auth/admin/message", { body: { to, title: title || undefined, body } }); }
  myMessages() { return this.request<{ messages: { id: number; sender: string; title: string | null; body: string; createdAt: string; read: boolean }[] }>("GET", "/auth/my-messages"); }
  markMessageRead(id: number) { return this.request<{ ok: boolean }>("POST", `/auth/my-messages/${id}/read`); }
  myMessagesUnreadCount() { return this.request<{ count: number }>("GET", "/auth/my-messages/unread-count"); }
  // friends + groups
  friends() { return this.request<{ friends: string[]; incoming: string[]; outgoing: string[] }>("GET", "/auth/friends"); }
  friendRequest(to: string) { return this.request<{ ok: boolean }>("POST", "/auth/friends/request", { body: { to } }); }
  friendAccept(from: string) { return this.request<{ ok: boolean }>("POST", "/auth/friends/accept", { body: { from } }); }
  friendRemove(user: string) { return this.request<{ ok: boolean }>("POST", "/auth/friends/remove", { body: { user } }); }
  groups() { return this.request<{ groups: any[] }>("GET", "/auth/groups"); }
  createGroup(name: string, members: string[]) { return this.request<{ ok: boolean; id: number }>("POST", "/auth/groups", { body: { name, members } }); }
  addGroupMembers(groupId: number, members: string[]) { return this.request<{ ok: boolean; added: string[] }>("POST", `/auth/groups/${groupId}/members`, { body: { members } }); }
  sendReward(to: string | null, kind = "confetti") { return this.request<{ ok: boolean; id: number }>("POST", "/auth/rewards", { body: { to, kind } }); }
  rewards(since = 0) { return this.request<{ rewards: any[] }>("GET", `/auth/rewards?since=${since}`); }
  chatDelete(opts: { with?: string; groupId?: number | null }) { return this.request<{ ok: boolean }>("POST", "/auth/chat/delete", { body: opts }); }
  // admin screen capture
  screenRequest(user: string) { return this.request<{ ok: boolean; requestId: number }>("POST", "/auth/screen/request", { body: { user } }); }
  screenPending() { return this.request<{ capture: boolean; requestId: number | null }>("GET", "/auth/screen/pending"); }
  screenActive() { return this.request<{ watched: boolean }>("GET", "/auth/screen/active"); }
  screenUpload(requestId: number, image: string, route: string) { return this.request<{ ok: boolean }>("POST", "/auth/screen/upload", { body: { requestId, image, route } }); }
  screenCaptures() { return this.request<{ captures: any[] }>("GET", "/auth/screen/captures"); }
  screenCapture(id: number) { return this.request<any>("GET", `/auth/screen/capture/${id}`); }

  // ── signals ──
  dailyScan() { return this.request<{ lastScanAt: string | null; nextScanAt: string | null; scanning?: boolean; count: number; longCount: number; top10: any[]; results: any[] }>("GET", "/signals/daily"); }
  tickerPrices(syms: string[]) { return this.request<{ prices: Record<string, number> }>("GET", `/signals/prices?symbols=${encodeURIComponent(syms.join(","))}`); }
  runDailyScan() { return this.request<{ started?: boolean; lastScanAt: string | null; nextScanAt: string | null; scanning?: boolean; count: number; longCount: number; top10: any[]; results: any[] }>("POST", "/signals/daily/run"); }
  breakouts(buckets: string[], cryptoLimit = 20, stockLimit = 0) {
    const q = new URLSearchParams({ buckets: buckets.join(","), crypto_limit: String(cryptoLimit), stock_limit: String(stockLimit) });
    return this.request<SignalRow[]>("GET", `/signals/breakouts?${q}`);
  }
  trends(buckets: string[]) {
    return this.request<SignalRow[]>("GET", `/signals/trends?buckets=${buckets.join(",")}`);
  }
  /** Full 3-color trend scan: per-symbol rows + daily Green/Grey/Red history. */
  trendScan(opts: { buckets?: string[]; cryptoLimit?: number; strategy?: string; force?: boolean } = {}) {
    const p = new URLSearchParams({
      buckets: (opts.buckets ?? ["crypto", "stocks", "metals", "commodities"]).join(","),
      crypto_limit: String(opts.cryptoLimit ?? 10),
      stock_limit: "10", metal_limit: "14", commodity_limit: "23",
      strategy: opts.strategy ?? "bot8c",
    });
    if (opts.force) p.set("force", "true");
    return this.request<TrendScanResponse>("GET", `/signals/trends?${p}`);
  }
  sendSignalsTelegram(signals: SignalRow[]) {
    return this.request<{ ok: boolean; message: string }>("POST", "/signals/send-telegram", { body: { signals } });
  }
  /** Compare several strategies' breakout rankings: each strategy's own top-N list.
   *  One fetch on the backend; re-classified per strategy. */
  compareStrategies(opts: { buckets?: string[]; strategies?: string[]; cryptoLimit?: number; top?: number; force?: boolean } = {}) {
    const p = new URLSearchParams({
      buckets: (opts.buckets ?? ["crypto"]).join(","),
      strategies: (opts.strategies ?? ["bot8c", "bot4", "bot1"]).join(","),
      crypto_limit: String(opts.cryptoLimit ?? 100),
      top: String(opts.top ?? 100),
    });
    if (opts.force) p.set("force", "true");
    // Hard client timeout (above the backend's bounded budget) so a stuck scan
    // surfaces as an error instead of an endless spinner.
    return this.request<{ strategies: { id: string; label: string; results: any[] }[] }>("GET", `/signals/compare?${p}`, { timeoutMs: 90_000 });
  }
  symbols(bucket: string, limit?: number) { return this.request<{ symbol: string; name: string; bucket: string }[]>("GET", `/symbols/${bucket}${limit ? `?limit=${limit}` : ""}`); }

  // ── strategy ──
  // The backend returns a WRAPPER ({ valid, strategyId, applied, recognized,
  // warnings }) where the recognized engine params (poles / samplingPeriod /
  // ftrMultiplier / filters …) live nested under `applied`. Callers spread the
  // result straight into the run/preview/save config, and the backend's
  // StrategyConfig silently drops unknown keys — so spreading the wrapper sent
  // `applied` nested and the engine always ran with DEFAULT params. Flatten
  // `applied` onto strategyId here so callers get a real, flat StrategyConfig.
  async parsePine(source: string): Promise<StrategyConfig> {
    const r = await this.request<any>("POST", "/strategy/parse-pine", { body: { source } });
    return { strategyId: r?.strategyId, ...(r?.applied || {}) } as StrategyConfig;
  }
  previewTop10(config: StrategyConfig, limit = 10) {
    return this.request<{ generatedAt: string; results: BacktestResult[] }>("POST", "/strategy/preview-top10", { body: { config, limit } });
  }
  savedStrategies() { return this.request<SavedStrategy[]>("GET", "/strategy/saved"); }
  saveStrategy(name: string, config: StrategyConfig, pineSource?: string) {
    return this.request<SavedStrategy>("POST", "/strategy/saved", { body: { name, config, pineSource } });
  }
  deleteSavedStrategy(id: number) { return this.request<{ ok: boolean }>("DELETE", `/strategy/saved/${id}`); }
  updateSavedStrategy(id: number, body: { name?: string; config?: any; pineSource?: string }) { return this.request<SavedStrategy>("PATCH", `/strategy/saved/${id}`, { body }); }
  // Strategy help requests (user → admin)
  submitHelp(source: string, message: string) { return this.request<{ id: number }>("POST", "/strategy/help", { body: { source, message } }); }
  listHelp() { return this.request<any[]>("GET", "/strategy/help"); }
  myHelp() { return this.request<any[]>("GET", "/strategy/help/mine"); }
  answerHelp(id: number, answer: string) { return this.request<{ ok: boolean }>("POST", `/strategy/help/${id}/answer`, { body: { answer } }); }

  // ── runs / results / dashboard ──
  listRuns() { return this.request<Run[]>("GET", "/runs"); }
  createRun(buckets: string[], config: StrategyConfig, symbolLimit?: number, name?: string, symbols?: string[]) {
    return this.request<Run>("POST", "/runs", { body: { buckets, config, symbolLimit, name, symbols } });
  }
  /** Explicitly KEEP an (ephemeral) run — adds it to the saved history. */
  saveRun(id: string) { return this.request<Run>("POST", `/runs/${id}/save`); }
  getRun(id: string) { return this.request<Run>("GET", `/runs/${id}`); }
  deleteRun(id: string) { return this.request<void>("DELETE", `/runs/${id}`); }
  runProgress(id: string) { return this.request<RunProgress>("GET", `/runs/${id}/progress`); }
  results(id: string, bucket?: string, sortBy = "cagr", sortDir = "desc") {
    const q = new URLSearchParams({ sort_by: sortBy, sort_dir: sortDir });
    if (bucket) q.set("bucket", bucket);
    return this.request<BacktestResult[]>("GET", `/runs/${id}/results?${q}`);
  }
  symbolDetail(id: string, symbol: string) {
    return this.request<SymbolDetail>("GET", `/runs/${id}/results/${encodeURIComponent(symbol)}`);
  }
  exportCsv(id: string, bucket?: string) {
    return this.request<{ filename: string; data: string }>("GET", `/runs/${id}/export${bucket ? `?bucket=${bucket}` : ""}`);
  }
  dashboardSummary() { return this.request<DashboardSummary>("GET", "/dashboard/summary"); }
  dashboardLive() {
    // local-time offset (minutes to add to UTC) so the demo today-vs-00:01 baseline
    // resets at the user's midnight, matching the REAL line.
    const off = -new Date().getTimezoneOffset();
    return this.request<{ activeRuns: number; runningSessions: number; demo: { trades: number; total: number; today: number; month: number; year: number; pct?: number | null; todayChange?: number; todayPct?: number | null; dayStart?: number | null; costBasis?: number | null }; live: { trades: number; total: number; today: number; month: number; year: number } }>("GET", `/dashboard/live?tzOffset=${off}`);
  }

  // ── exchange (PIN-gated) ──
  exchangeConfig() { return this.request<ExchangePublicConfig>("GET", "/exchange/config"); }
  setPinCode(newPin: string, currentPin?: string) {
    return this.request<{ ok: boolean }>("POST", "/exchange/pin", { body: { newPin, currentPin } });
  }
  verifyPin(pin: string) { return this.request<{ ok: boolean }>("POST", "/exchange/pin/verify", { body: { pin } }); }
  // Self-service "forgot PIN": set a new PIN by proving the ACCOUNT PASSWORD (bypasses the current PIN).
  resetPinCode(password: string, newPin: string) { return this.request<{ ok: boolean; message?: string }>("POST", "/exchange/pin/reset", { body: { password, newPin } }); }
  // Admin (main-admin) clear: wipe the exchange PIN so a fresh one can be set. `username` is audit-only.
  adminResetPin(username?: string) { return this.request<{ ok: boolean; pinSet: boolean; message?: string }>("POST", "/exchange/pin/admin-reset", { body: { username } }); }
  saveExchangeConfig(body: Record<string, unknown>) { return this.request<{ ok: boolean }>("POST", "/exchange/config", { body, pin: true }); }
  testExchange() { return this.request<{ ok: boolean; message: string }>("POST", "/exchange/test", { pin: true }); }
  balance(market?: string) { return this.request<unknown>("GET", "/exchange/balance" + (market ? `?market=${encodeURIComponent(market)}` : ""), { pin: true }); }
  positions() { return this.request<unknown>("GET", "/exchange/positions", { pin: true }); }
  // Read-only: resting stop-loss / OCO / take-profit sell orders on the account,
  // so the user can SEE their protective stop is active and waiting at a price.
  protectiveOrders() { return this.request<{ ok: boolean; supported?: boolean; orders: { symbol: string; kind: string; price: number | null; stopPrice: number | null; qty: number | null; id: string }[]; message: string }>("GET", "/exchange/protective-orders", { pin: true }); }
  exchangeSymbols() { return this.request<{ ok: boolean; symbols: { symbol: string; name: string }[] }>("GET", "/exchange/symbols", { pin: true }); }
  livePnl(creds?: ExchangeCreds) {
    // local-time offset (minutes to add to UTC) so today/month/year reset at the user's midnight
    const off = -new Date().getTimezoneOffset();
    // Pass `creds` to query a specific sub-account (used by the all-accounts roll-up).
    return this.request<{ ok: boolean; totalPnl: number; totalValue?: number; invested: number; holdingsValue: number; available: number; count: number; positions: any[]; costBasis?: number | null; netDeposits?: number | null; period?: { today: number | null; month: number | null; year: number | null; dayStart: number | null } }>("GET", `/exchange/live-pnl?tzOffset=${off}`, { pin: true, creds });
  }
  // LIVE Trading Engine realized P&L — engine-only real auto-runs (no PIN/creds needed).
  engineLivePnl() { return this.request<{ ok: boolean; realizedPnl: number; closed: number }>("GET", "/exchange/engine-live-pnl"); }
  placeOrder(body: Record<string, unknown>) { return this.request<unknown>("POST", "/exchange/order", { body, pin: true }); }
  closeProfitable() { return this.request<unknown>("POST", "/exchange/close-profitable", { pin: true }); }
  closeSpot() { return this.request<{ ok: boolean; message: string; closed?: any[]; errors?: any[] }>("POST", "/exchange/close-spot", { pin: true }); }
  cleanDust() { return this.request<{ ok: boolean; message: string; closed?: any[]; convertedUsdt?: any[]; convertedBnb?: any[]; converted?: any[]; errors?: any[]; details?: any[]; skipped?: number }>("POST", "/exchange/clean-dust", { pin: true }); }
  resetLiveStats() { return this.request<{ ok: boolean; since: string }>("POST", "/exchange/live-stats-reset", { pin: true }); }
  setDayStart(value: number) { const off = -new Date().getTimezoneOffset(); return this.request<{ ok: boolean; date: string; open: number }>("POST", `/exchange/day-start?value=${value}&tzOffset=${off}`, { pin: true }); }
  // ── deposited capital (cost basis), per (user, env ∈ {live,demo}) — the Home-card
  // baseline. Personal setting, not a money move → no PIN. costBasis is null when unset. ──
  getCostBasis(env: "live" | "demo" = "live") { return this.request<{ ok: boolean; env: string; costBasis: number | null }>("GET", `/exchange/cost-basis?env=${env}`); }
  setCostBasis(env: "live" | "demo", value: number) { return this.request<{ ok: boolean; env: string; costBasis: number | null }>("POST", "/exchange/cost-basis", { body: { env, value } }); }
  // Per-user "deposited capital" (cost basis) for the Home-card baseline. Per env
  // (live/demo); no PIN — it's a personal setting, not a money move.
  getCostBasis(env: "live" | "demo" = "live") { return this.request<{ ok: boolean; env: string; costBasis: number | null }>("GET", `/exchange/cost-basis?env=${env}`); }
  setCostBasis(env: "live" | "demo", value: number) { return this.request<{ ok: boolean; env: string; costBasis: number | null }>("POST", "/exchange/cost-basis", { body: { env, value } }); }
  withdraw(body: { currency: string; amount: number; address: string; tag?: string; confirm: boolean }) {
    return this.request<{ ok: boolean; message: string; withdrawal?: any }>("POST", "/exchange/withdraw", { body, pin: true });
  }
  // ── Encrypted exchange-key backup (cross-device / survives cache-clear). The keys
  // stay in the browser as the fast path; this is an at-rest encrypted copy so a user
  // who clears site-data or signs in on a new device gets their connection back. No
  // PIN — it's keyed strictly to the authenticated user (server encrypts at rest). ──
  saveExchangeBackup(body: { name?: string; env?: string; subAccount?: string; key: string; secret: string; passphrase?: string }) {
    return this.request<{ ok: boolean }>("POST", "/exchange/creds-backup", { body });
  }
  getExchangeBackup() {
    return this.request<{ ok: boolean; hasBackup: boolean; creds?: { name: string; env: string; subAccount?: string; key: string; secret: string; passphrase?: string }; updatedAt?: string }>("GET", "/exchange/creds-backup");
  }
  deleteExchangeBackup() {
    return this.request<{ ok: boolean }>("DELETE", "/exchange/creds-backup");
  }

  // ── trading engine ──
  profitConfig() { return this.request<ProfitConfig>("GET", "/exchange/profit-config"); }
  saveProfitConfig(body: Partial<ProfitConfig>) { return this.request<{ ok: boolean }>("POST", "/exchange/profit-config", { body, pin: true }); }
  buildProfitPlan() { return this.request<ProfitPlan>("POST", "/exchange/profit-plan/build", { pin: true }); }
  profitPlan() { return this.request<{ plan: ProfitPlan | null; builtAt: string | null }>("GET", "/exchange/profit-plan", { pin: true }); }

  // ── paper trading (demo) ──
  paperState() { return this.request<unknown>("GET", "/exchange/paper/state"); }
  paperSessions() { return this.request<{ sessions: PaperSession[] }>("GET", "/exchange/paper/sessions"); }
  paperPreview(body: Record<string, unknown>) { return this.request<unknown>("POST", "/exchange/paper/preview", { body }); }
  paperStart(body: Record<string, unknown>) { return this.request<{ sessions: PaperSession[] }>("POST", "/exchange/paper/start", { body }); }
  paperDailyPnl() { return this.request<{ days: { day: string; pnl: number; trades: { symbol: string; pnl: number; closedAt: string; session: string }[] }[] }>("GET", "/exchange/paper/daily-pnl"); }
  paperClosedLog() { return this.request<{ rows: { source: string; mode: string; symbol: string; name?: string; entryPrice?: number; closePrice?: number; capital?: number; pnl?: number; pnlPct?: number; closedAt: string; reason: string; orderId?: string; session?: string }[] }>("GET", "/exchange/paper/closed-log"); }
  paperDeleteClosed() { return this.request<{ sessions: PaperSession[]; deleted: number }>("POST", "/exchange/paper/delete-closed"); }
  paperClose(sessionId: number, id?: number) { return this.request<{ sessions: PaperSession[] }>("POST", "/exchange/paper/close", { body: { sessionId, id } }); }
  paperCloseProfitable(sessionId: number, all = true) { return this.request<{ sessions: PaperSession[]; closedCount: number }>("POST", "/exchange/paper/close-profitable", { body: { sessionId, all } }); }
  // Awareness ping only — tells the admin a user is taking a run live (no trading happens server-side).
  paperPromoteIntent(sessionId: number) { return this.request<{ ok: boolean }>("POST", "/exchange/paper/promote-intent", { body: { sessionId } }); }
  // In-app auto-run scheduler config (per user).
  paperAutorunGet() { return this.request<{ config: Record<string, any> }>("GET", "/exchange/paper/autorun"); }
  paperAutorunSave(config: Record<string, any>) { return this.request<{ config: Record<string, any> }>("POST", "/exchange/paper/autorun", { body: config }); }
  // Close every in-profit position across ALL running sessions in one fast batch.
  paperCloseProfitableAll() { return this.request<{ sessions: PaperSession[]; closedCount: number }>("POST", "/exchange/paper/close-profitable-all", { body: {} }); }
  // Close EVERY open position (winners + losers) across the caller's own sessions.
  paperCloseAllActive() { return this.request<{ sessions: PaperSession[]; closedCount: number }>("POST", "/exchange/paper/close-all-active", { body: {} }); }
  paperDecision(sessionId: number, action: "stop" | "continue") { return this.request<{ sessions: PaperSession[] }>("POST", "/exchange/paper/decision", { body: { sessionId, action } }); }
  paperDelete(sessionId: number) { return this.request<{ sessions: PaperSession[] }>("POST", "/exchange/paper/delete", { body: { sessionId } }); }
  paperReset() { return this.request<{ sessions: PaperSession[] }>("POST", "/exchange/paper/reset", { body: {} }); }
  paperHistory() { return this.request<unknown>("GET", "/exchange/paper/history"); }

  // ── telegram ──
  telegramConfig() { return this.request<TelegramConfig>("GET", "/telegram/config"); }
  saveTelegramConfig(body: Record<string, unknown>) { return this.request<{ ok: boolean }>("POST", "/telegram/config", { body }); }
  telegramDetect(botToken: string) { return this.request<unknown>("POST", "/telegram/detect", { body: { botToken } }); }
  telegramSend(runId?: string) { return this.request<{ ok: boolean; message: string }>("POST", "/telegram/send", { body: { runId } }); }
  telegramTest(chatId: string) { return this.request<{ ok: boolean; message: string }>("POST", "/telegram/test", { body: { botToken: "", chatId } }); }
  // Per-admin Telegram (each admin connects their own bot + chat)
  myTelegram() { return this.request<{ chatId: string; configured: boolean; connected: boolean; tokenSet: boolean; chatIdSet: boolean; lastTestOk: boolean; botTokenMasked: string }>("GET", "/telegram/my-config"); }
  saveMyTelegram(botToken: string, chatId: string) { return this.request<{ ok: boolean; message: string }>("POST", "/telegram/my-config", { body: { botToken, chatId } }); }
  testMyTelegram() { return this.request<{ ok: boolean; message: string }>("POST", "/telegram/my-test", { body: {} }); }
  disconnectMyTelegram() { return this.request<{ ok: boolean }>("POST", "/telegram/my-disconnect", { body: {} }); }
  telegramDisconnect() { return this.request<{ ok: boolean }>("POST", "/telegram/disconnect", { body: {} }); }

  // ── portfolio ──
  activity(limit = 1000, mode?: "demo" | "live") {
    const q = new URLSearchParams({ limit: String(limit) });
    if (mode) q.set("mode", mode);
    return this.request<{ events: ActivityRow[]; liveLocked: boolean }>("GET", `/portfolio/activity?${q}`, { pin: true });
  }

  // ── reels lessons (learning videos) — paths under /auth/* for the Caddy allowlist ──
  reelsLessons() { return this.request<{ lessons: ReelsLesson[] }>("GET", "/auth/reels"); }
  reelsLessonsAdmin() { return this.request<{ lessons: ReelsLesson[] }>("GET", "/auth/reels/admin"); }
  createReelsLesson(body: ReelsLessonInput) { return this.request<{ lesson: ReelsLesson }>("POST", "/auth/reels/admin", { body }); }
  updateReelsLesson(id: number, body: ReelsLessonInput) { return this.request<{ lesson: ReelsLesson }>("PATCH", `/auth/reels/admin/${id}`, { body }); }
  deleteReelsLesson(id: number) { return this.request<{ ok: boolean }>("DELETE", `/auth/reels/admin/${id}`); }
  reorderReelsLessons(order: number[]) { return this.request<{ lessons: ReelsLesson[] }>("POST", "/auth/reels/admin/reorder", { body: { order } }); }
  // In-app "90-second tour" link the Reels·course screen embeds — read by any user, set by an editor.
  reelsTour() { return this.request<{ url: string }>("GET", "/auth/reels/tour"); }
  setReelsTour(url: string) { return this.request<{ url: string }>("PATCH", "/auth/reels/admin/tour", { body: { url } }); }
  // ── University / Learn content (content_editor-managed; mirrors reels) ──
  universityContent() { return this.request<{ hasContent: boolean; sections: Record<string, UniItem[]> }>("GET", "/auth/university"); }
  universityAdmin() { return this.request<{ hasContent: boolean; items: UniItem[] }>("GET", "/auth/university/admin"); }
  createUniversityItem(body: UniItemInput) { return this.request<{ item: UniItem }>("POST", "/auth/university/admin", { body }); }
  updateUniversityItem(id: number, body: UniItemInput) { return this.request<{ item: UniItem }>("PATCH", `/auth/university/admin/${id}`, { body }); }
  deleteUniversityItem(id: number) { return this.request<{ ok: boolean }>("DELETE", `/auth/university/admin/${id}`); }
  importUniversityItems(items: UniItemInput[]) { return this.request<{ ok: boolean; imported: number; hasContent: boolean }>("POST", "/auth/university/admin/import", { body: { items } }); }

  // ── Signal Automated Bots (the user's OWN bots only — current_user scoped) ──
  // These place REAL orders, so the UI shows real-money warnings. Keys are stored
  // server-side and never returned; the create call hands back the per-bot webhook
  // URL + the TradingView alert JSON template to paste into the alert.
  listBots() { return this.request<{ ok: boolean; bots: Bot[] }>("GET", "/bots"); }
  botsDashboard() { return this.request<{ ok: boolean; bots: Bot[]; totalPnl: number; count: number }>("GET", "/bots/dashboard"); }
  createBot(payload: BotCreatePayload) { return this.request<BotCreateResult>("POST", "/bots", { body: payload }); }
  updateBot(id: number | string, patch: BotPatch) { return this.request<{ ok: boolean; bot: Bot }>("PATCH", `/bots/${id}`, { body: patch }); }
  deleteBot(id: number | string) { return this.request<{ ok: boolean }>("DELETE", `/bots/${id}`); }
  killBot(id: number | string) { return this.request<{ ok: boolean; status: string }>("POST", `/bots/${id}/kill`); }
  botLogs(id: number | string) { return this.request<{ ok: boolean; logs: BotLog[] }>("GET", `/bots/${id}/logs`); }

  // ── Owner / Requests portal (help-desk) — paths under /auth/* for the Caddy allowlist ──
  // Admins/owners get ALL requests (both categories); a regular user gets ONLY
  // their own user_requests. Reply delivery to the user reuses the Team Message path.
  listRequests(p: { category?: RequestCategory; status?: RequestStatus } = {}) {
    const q = new URLSearchParams();
    if (p.category) q.set("category", p.category);
    if (p.status) q.set("status", p.status);
    const qs = q.toString();
    return this.request<{ requests: RequestRow[]; isAdmin: boolean; isOwner: boolean }>("GET", `/auth/requests${qs ? `?${qs}` : ""}`);
  }
  getRequest(id: number) { return this.request<{ request: RequestDetail; isAdmin: boolean; isOwner: boolean }>("GET", `/auth/requests/${id}`); }
  replyRequest(id: number, text: string) { return this.request<{ ok: boolean }>("POST", `/auth/requests/${id}/replies`, { body: { text } }); }
  setRequestStatus(id: number, status: RequestStatus) { return this.request<{ ok: boolean; status: RequestStatus }>("POST", `/auth/requests/${id}/status`, { body: { status } }); }
  createOwnerNote(subject: string, body: string) { return this.request<{ ok: boolean; id: number }>("POST", "/auth/requests", { body: { subject, body } }); }
  backfillRequests() { return this.request<{ ok: boolean; imported: number }>("POST", "/auth/requests/backfill"); }

  // ── AutoPilots — SIMULATION / dry-run (owners-only). No real orders, no money. ──
  autopilotsState() { return this.request<ApSimState>("GET", "/autopilots/state"); }
  // DR-Crypto operational risk mode (aggressive/smooth/safe) — SIM sizing only, no live/order impact.
  autopilotDrModeGet() { return this.request<{ mode: string }>("GET", "/autopilots/dr-mode"); }
  autopilotDrModeSet(mode: string) { return this.request<{ ok: boolean; mode: string }>("POST", "/autopilots/dr-mode", { body: { mode } }); }
  autopilotArm(body: ApArmInput) { return this.request<ApSimState>("POST", "/autopilots/arm", { body }); }
  autopilotDisarm(pilotId: string) { return this.request<ApSimState>("POST", "/autopilots/disarm", { body: { pilotId } }); }
  // Change ONLY the sizing capital (nav) of a loaded pilot — no disarm/reload; per-trade $ re-derives.
  autopilotEditCapital(body: { pilotId: string; nav: number }) { return this.request<ApSimState>("POST", "/autopilots/edit-capital", { body }); }
  autopilotRun(pilotId?: string) { return this.request<ApSimState>("POST", "/autopilots/run", { body: { pilotId: pilotId ?? null } }); }
  // Review gate: compute the read-only run plan (no execution), then approve a subset.
  autopilotPlan(pilotId: string) { return this.request<{ ok: boolean; plan: ApRunPlan }>("POST", "/autopilots/plan", { body: { pilotId } }); }
  autopilotApprove(pilotId: string, approved: ApApproveItem[]) { return this.request<ApSimState & { result?: ApApproveResult }>("POST", "/autopilots/approve", { body: { pilotId, approved } }); }

  // ── AutoPilots REAL-MONEY (Bybit) — owner-only, heavily-safeguarded, GATED. ──
  // No client call places an order; these connect keys / record go-live intent / kill-switch.
  autopilotKeysStatus() { return this.request<{ ok: boolean } & ApBybitStatus>("GET", "/autopilots/keys"); }
  autopilotConnectKeys(body: { apiKey: string; apiSecret: string; environment: string; exchange?: string }) {
    return this.request<{ ok: boolean } & ApBybitStatus>("POST", "/autopilots/keys", { body }); }
  autopilotTestKeys() { return this.request<{ ok: boolean; message: string }>("POST", "/autopilots/keys/test"); }
  autopilotBalance() { return this.request<ApBybitBalance>("GET", "/autopilots/balance"); }
  autopilotDisconnectKeys() { return this.request<{ ok: boolean } & ApBybitStatus>("DELETE", "/autopilots/keys"); }
  autopilotGoLive(body: ApGoLiveInput) { return this.request<ApSimState & { message?: string; masterGate?: boolean }>("POST", "/autopilots/go-live", { body }); }
  autopilotStopLive(pilotId: string) { return this.request<ApSimState & { message?: string }>("POST", "/autopilots/stop-live", { body: { pilotId } }); }
  autopilotAudit() { return this.request<{ ok: boolean; audit: any[] }>("GET", "/autopilots/audit"); }
}
