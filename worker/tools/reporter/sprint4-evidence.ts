// worker/tools/reporter/sprint4-evidence.ts
//
// Read-ONLY Sprint 4 evidence reporter CLI (`npm run sprint4:evidence`). Snapshots the S4-2 campaign
// state from the DB and prints a secret-safe report + GO/NO-GO gates for Phase 0 / Phase A / full S4-2.
//
// Boundaries (enforced, not by convention):
//   - READ-ONLY: every query is a single SELECT (isReadOnlySelect guard) AND the session is forced
//     `default_transaction_read_only = on`, so even a write-capable role cannot mutate. No writes ever.
//   - NO execution on import; NO connection unless runOnce()/the CLI is invoked.
//   - SECRET-SAFE: the DSN lives only in ReportConfig (redacted on describe); output is counts /
//     statuses / symbols / order-refs + a redacted DSN descriptor — never the DSN/password.
//   - Requires a DEDICATED report DSN: PRAXIS_REPORT_DSN (a read role with SELECT on the report tables,
//     incl. reconciliation_jobs / pgmq). Fails loud if it is missing — it does NOT fall back to the
//     narrow `praxis_alert_ro` alert role (that role intentionally cannot see reconciliation_jobs/pgmq,
//     which would silently make key S4-2 metrics "unavailable" right before a campaign). Metrics the
//     report role still cannot read degrade to "unavailable" with a SQLSTATE label — never a crash.
//
// No live DB in this slice — tests inject a fixture runner; the operator runs the CLI later.

import { isReadOnlySelect } from '../lib/readonly-sql';
import {
  redactDsn,
  defaultClientFactory,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  type ClientFactory,
  type PgLikeClient,
} from '../alert-poller/pg-readonly-runner';

export const REPORT_ENV = {
  DSN: 'PRAXIS_REPORT_DSN',
  STUCK_THRESHOLD_SECONDS: 'PRAXIS_ALERT_STUCK_THRESHOLD_SECONDS',
} as const;

export const DEFAULT_STUCK_THRESHOLD_SECONDS = 300;
const APPLICATION_NAME = 'praxis-sprint4-evidence';

export class ReportError extends Error {
  constructor(message: string) {
    super(`sprint4-evidence: ${message}`);
    this.name = 'ReportError';
  }
}

function parsePositiveIntEnv(raw: string | undefined, dflt: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return dflt;
  const t = raw.trim();
  // NEVER echo the raw value — name + expected shape only.
  if (!/^\d+$/.test(t)) throw new ReportError(`${name} must be a positive integer`);
  const n = Number(t);
  if (n <= 0) throw new ReportError(`${name} must be a positive integer`);
  return n;
}

const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');

/** Redacted, password-free view of the config — safe to log/serialize. */
export interface RedactedReportConfig {
  db: string; // redacted DSN (password masked, query params stripped)
  statementTimeoutMs: number;
  thresholdSeconds: number;
}

/**
 * Read-only report config. The DSN is a JS #private field — NOT an own property at runtime, so it is
 * invisible to JSON.stringify / util.inspect / console.log / Object.keys|values / own-property walks.
 * It can ONLY leave via connectionString() (for the driver). Every other accessor is redacted, and
 * toString/toJSON/[inspect.custom] all return the redacted form — logging a config can never leak the password.
 */
export class ReportConfig {
  readonly #dsn: string;
  /** Redacted DSN string (password masked) — safe to expose/serialize. */
  readonly redacted: string;
  readonly statementTimeoutMs: number;
  readonly thresholdSeconds: number;

  private constructor(dsn: string, statementTimeoutMs: number, thresholdSeconds: number) {
    this.#dsn = dsn;
    this.redacted = redactDsn(dsn);
    this.statementTimeoutMs = statementTimeoutMs;
    this.thresholdSeconds = thresholdSeconds;
  }

  static fromEnv(env: NodeJS.ProcessEnv): ReportConfig {
    // REQUIRE a dedicated report DSN — no fallback to the narrow alert role (see header).
    const dsn = (env[REPORT_ENV.DSN] ?? '').trim();
    if (!dsn) throw new ReportError(`${REPORT_ENV.DSN} is not set (a dedicated read DSN is required; no fallback)`);
    let url: URL;
    try {
      url = new URL(dsn);
    } catch {
      throw new ReportError('report DSN is not a valid connection URL'); // never echo the DSN
    }
    const proto = url.protocol.toLowerCase();
    if (proto !== 'postgres:' && proto !== 'postgresql:') {
      throw new ReportError('report DSN has an unsupported scheme (expected postgres:// or postgresql://)');
    }
    if (!url.password) throw new ReportError('report DSN is missing a password');
    if (!url.hostname) throw new ReportError('report DSN is missing a host');
    if (!url.pathname.replace(/^\//, '')) throw new ReportError('report DSN is missing a database name');
    const thresholdSeconds = parsePositiveIntEnv(
      env[REPORT_ENV.STUCK_THRESHOLD_SECONDS],
      DEFAULT_STUCK_THRESHOLD_SECONDS,
      REPORT_ENV.STUCK_THRESHOLD_SECONDS,
    );
    return new ReportConfig(dsn, DEFAULT_STATEMENT_TIMEOUT_MS, thresholdSeconds);
  }

  /** The full connection string. ONLY the runner/client factory should read this; never log it. */
  connectionString(): string {
    return this.#dsn;
  }
  /** Redacted one-line descriptor (password masked, query params stripped). Safe to log. */
  describe(): string {
    return this.redacted;
  }
  toString(): string {
    return this.describe();
  }
  /** JSON form is the redacted, password-free descriptor — JSON.stringify(config) is safe. */
  toJSON(): RedactedReportConfig {
    return { db: this.redacted, statementTimeoutMs: this.statementTimeoutMs, thresholdSeconds: this.thresholdSeconds };
  }
  [INSPECT_CUSTOM](): string {
    return `ReportConfig(${this.describe()})`;
  }
}

// ── Queries (all single read-only SELECTs) ──────────────────────────────────────────────────────
// EVERY column MUST be cast in-SQL to a scalar: counts `::int`, timestamps `::text`. ReportRunner.run
// returns raw driver rows and does NOT normalize Date objects (unlike the alert poller's runner), so an
// uncast `timestamptz` would surface a Date into operator output / JSON. Keep all columns cast here.

export interface ReportQuery {
  name: string;
  sql: string;
}
export interface BoundQuery {
  query: ReportQuery;
  params: ReadonlyArray<string | number>;
}

export function reportQueries(thresholdSeconds: number): BoundQuery[] {
  const stuck = `status IN ('pending','unknown') AND created_at < now() - make_interval(secs => $1) AND deleted_at IS NULL`;
  return [
    // Queue depth via the SECURITY DEFINER wrapper (migration 013) — the report role has no direct
    // pgmq access. Returns "unavailable" if the wrapper/role is not provisioned yet.
    { query: { name: 'queue_length', sql: "SELECT public.pgmq_queue_length('trade_signals')::int AS n" }, params: [] },
    {
      query: { name: 'trades_by_status', sql: 'SELECT status, count(*)::int AS n FROM public.trades WHERE deleted_at IS NULL GROUP BY status ORDER BY status' },
      params: [],
    },
    {
      query: { name: 'filled_by_symbol', sql: "SELECT trading_pair, count(*)::int AS n FROM public.trades WHERE status='filled' AND deleted_at IS NULL GROUP BY trading_pair ORDER BY trading_pair" },
      params: [],
    },
    {
      // distinct_filled_signal_id binds the DoD "50 distinct signals" to FILLED trades only — a plain
      // distinct over all statuses would let failed/unknown/induced trades inflate the count (P2-C).
      query: { name: 'signal_totals', sql: "SELECT count(*)::int AS total_trades, count(DISTINCT signal_id)::int AS distinct_signal_id, count(DISTINCT signal_id) FILTER (WHERE status='filled')::int AS distinct_filled_signal_id FROM public.trades WHERE deleted_at IS NULL" },
      params: [],
    },
    {
      query: { name: 'dup_signal_id', sql: 'SELECT signal_id, count(*)::int AS n FROM public.trades WHERE deleted_at IS NULL AND signal_id IS NOT NULL GROUP BY signal_id HAVING count(*) > 1 ORDER BY n DESC LIMIT 20' },
      params: [],
    },
    {
      // deleted_at IS NULL: a soft-deleted retry sharing an exchange_order_id must NOT be counted —
      // omitting it both false-NO-GOs (deleted dup) and could hide a real dup if dedup soft-deletes one.
      query: { name: 'dup_exchange_order_id', sql: 'SELECT exchange_order_id, count(*)::int AS n FROM public.trades WHERE exchange_order_id IS NOT NULL AND deleted_at IS NULL GROUP BY exchange_order_id HAVING count(*) > 1 ORDER BY n DESC LIMIT 20' },
      params: [],
    },
    { query: { name: 'dlq_total', sql: 'SELECT count(*)::int AS n FROM public.trades_dlq' }, params: [] },
    {
      // webhook_logs: report role's RLS (migration 013) scopes visibility to status='queue_failed'; this
      // count therefore reflects ONLY queue_failed rows (it cannot observe other webhook statuses).
      query: { name: 'queue_failed_total', sql: "SELECT count(*)::int AS n FROM public.webhook_logs WHERE status='queue_failed'" },
      params: [],
    },
    { query: { name: 'stuck_total', sql: `SELECT count(*)::int AS n FROM public.trades WHERE ${stuck}` }, params: [thresholdSeconds] },
    {
      query: { name: 'recon_jobs_by_status', sql: 'SELECT status, count(*)::int AS n FROM public.reconciliation_jobs GROUP BY status ORDER BY status' },
      params: [],
    },
    {
      query: { name: 'pending_unknown_old', sql: `SELECT id::text AS id, status, trading_pair, client_order_id, (created_at)::text AS created_at FROM public.trades WHERE ${stuck} ORDER BY created_at LIMIT 20` },
      params: [thresholdSeconds],
    },
    {
      query: { name: 'filled_path_candidates', sql: "SELECT count(*)::int AS n FROM public.trades WHERE status='filled' AND client_order_id IS NOT NULL AND exchange_order_id IS NOT NULL AND deleted_at IS NULL" },
      params: [],
    },
  ];
}

// ── Runner (role-agnostic, read-only enforced; reuses the pg client factory) ─────────────────────

export interface ReportRunnerLike {
  connect(): Promise<void>;
  run(query: ReportQuery, params?: ReadonlyArray<string | number>): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

const SESSION_READONLY_SQL = 'SET default_transaction_read_only = on';

export class ReportRunner implements ReportRunnerLike {
  private client: PgLikeClient | null = null;
  constructor(
    private readonly config: ReportConfig,
    private readonly clientFactory: ClientFactory = defaultClientFactory,
  ) {}

  async connect(): Promise<void> {
    if (this.client) throw new ReportError('already connected');
    const client = this.clientFactory({
      connectionString: this.config.connectionString(),
      applicationName: APPLICATION_NAME,
      statementTimeoutMs: this.config.statementTimeoutMs,
    });
    try {
      await client.connect();
      await client.query(SESSION_READONLY_SQL); // server-enforced read-only, even for a write-capable role
      await client.query(`SET statement_timeout = ${this.config.statementTimeoutMs}`);
    } catch {
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      throw new ReportError(`connect failed for ${this.config.describe()}`); // redacted; never the DSN
    }
    this.client = client;
  }

  async run(query: ReportQuery, params: ReadonlyArray<string | number> = []): Promise<Record<string, unknown>[]> {
    if (!this.client) throw new ReportError('not connected — call connect() first');
    if (!isReadOnlySelect(query.sql)) throw new ReportError(`query "${query.name}" is not a single read-only SELECT`);
    const res = await this.client.query(query.sql, params);
    return res.rows;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    await c.end();
  }
}

// ── Collect (graceful per-metric degradation) ────────────────────────────────────────────────────

export interface MetricResult {
  ok: boolean;
  rows: Record<string, unknown>[];
  error?: string; // SQLSTATE / error class only (e.g. "42501") — never a value
}
export type RawReport = Record<string, MetricResult>;

function errClass(e: unknown): string {
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && code) return code; // pg SQLSTATE, e.g. 42501 — not secret
  const name = (e as { name?: unknown }).name;
  return typeof name === 'string' && name ? name : 'error';
}

export async function collect(runner: ReportRunnerLike, thresholdSeconds: number): Promise<RawReport> {
  const raw: RawReport = {};
  for (const { query, params } of reportQueries(thresholdSeconds)) {
    try {
      raw[query.name] = { ok: true, rows: await runner.run(query, params) };
    } catch (e) {
      raw[query.name] = { ok: false, rows: [], error: errClass(e) };
    }
  }
  return raw;
}

// ── Parse + gate evaluation ──────────────────────────────────────────────────────────────────────

const UNAVAILABLE = 'unavailable' as const;
type Maybe<T> = T | typeof UNAVAILABLE;

function asNum(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function asStr(v: unknown): string | null {
  return typeof v === 'string' ? v : v === null || v === undefined ? null : String(v);
}
function scalarN(m: MetricResult | undefined): Maybe<number> {
  if (!m || !m.ok) return UNAVAILABLE;
  const n = asNum(m.rows[0]?.n);
  return n === null ? UNAVAILABLE : n;
}
function rowCount(m: MetricResult | undefined): Maybe<number> {
  return !m || !m.ok ? UNAVAILABLE : m.rows.length;
}
function byKey(m: MetricResult | undefined, key: string): Maybe<Record<string, number>> {
  if (!m || !m.ok) return UNAVAILABLE;
  const out: Record<string, number> = {};
  for (const r of m.rows) {
    const s = asStr(r[key]);
    const n = asNum(r.n);
    if (s !== null && n !== null) out[s] = n;
  }
  return out;
}

export interface Sprint4Report {
  thresholdSeconds: number;
  queueLength: Maybe<number>;
  tradesByStatus: Maybe<Record<string, number>>;
  filledTotal: Maybe<number>;
  filledBySymbol: Maybe<Record<string, number>>;
  symbolCount: Maybe<number>;
  totalTrades: Maybe<number>;
  distinctSignalId: Maybe<number>;
  distinctFilledSignalId: Maybe<number>;
  dupSignalIdCount: Maybe<number>;
  dupExchangeOrderIdCount: Maybe<number>;
  dlqTotal: Maybe<number>;
  queueFailedTotal: Maybe<number>;
  stuckTotal: Maybe<number>;
  reconJobsByStatus: Maybe<Record<string, number>>;
  reconResolved: Maybe<number>;
  pendingUnknownOld: Maybe<Record<string, unknown>[]>;
  filledPathCandidates: Maybe<number>;
  unavailable: { metric: string; error: string }[];
}

export function parseReport(raw: RawReport, thresholdSeconds: number): Sprint4Report {
  const tradesByStatus = byKey(raw.trades_by_status, 'status');
  const filledBySymbol = byKey(raw.filled_by_symbol, 'trading_pair');
  const signalTotals = raw.signal_totals;
  const reconJobs = byKey(raw.recon_jobs_by_status, 'status');

  const filledTotal: Maybe<number> =
    tradesByStatus === UNAVAILABLE ? UNAVAILABLE : tradesByStatus.filled ?? 0;
  const symbolCount: Maybe<number> = filledBySymbol === UNAVAILABLE ? UNAVAILABLE : Object.keys(filledBySymbol).length;
  const distinctSignalId: Maybe<number> =
    signalTotals && signalTotals.ok ? asNum(signalTotals.rows[0]?.distinct_signal_id) ?? UNAVAILABLE : UNAVAILABLE;
  const totalTrades: Maybe<number> =
    signalTotals && signalTotals.ok ? asNum(signalTotals.rows[0]?.total_trades) ?? UNAVAILABLE : UNAVAILABLE;
  const distinctFilledSignalId: Maybe<number> =
    signalTotals && signalTotals.ok ? asNum(signalTotals.rows[0]?.distinct_filled_signal_id) ?? UNAVAILABLE : UNAVAILABLE;
  const reconResolved: Maybe<number> = reconJobs === UNAVAILABLE ? UNAVAILABLE : reconJobs.resolved ?? 0;

  const unavailable = Object.entries(raw)
    .filter(([, m]) => !m.ok)
    .map(([metric, m]) => ({ metric, error: m.error ?? 'error' }));

  return {
    thresholdSeconds,
    queueLength: scalarN(raw.queue_length),
    tradesByStatus,
    filledTotal,
    filledBySymbol,
    symbolCount,
    totalTrades,
    distinctSignalId,
    distinctFilledSignalId,
    dupSignalIdCount: rowCount(raw.dup_signal_id),
    dupExchangeOrderIdCount: rowCount(raw.dup_exchange_order_id),
    dlqTotal: scalarN(raw.dlq_total),
    queueFailedTotal: scalarN(raw.queue_failed_total),
    stuckTotal: scalarN(raw.stuck_total),
    reconJobsByStatus: reconJobs,
    reconResolved,
    pendingUnknownOld: raw.pending_unknown_old?.ok ? raw.pending_unknown_old.rows : UNAVAILABLE,
    filledPathCandidates: scalarN(raw.filled_path_candidates),
    unavailable,
  };
}

export type Verdict = 'GO' | 'NO-GO' | 'INDETERMINATE';

export interface Gates {
  phase0Ready: Verdict; // baseline clean enough to start firing
  phaseA: Verdict; // volume in progress, no integrity breach
  fullS4_2: Verdict; // DoD met (auto-checkable parts)
  checks: Record<string, boolean | typeof UNAVAILABLE>;
  manual: string[]; // qualitative gates the reporter cannot decide
}

// true iff every input is a number and the predicate holds; UNAVAILABLE if any input is unavailable.
function gate(values: Maybe<number>[], pred: (ns: number[]) => boolean): Verdict {
  if (values.some((v) => v === UNAVAILABLE)) return 'INDETERMINATE';
  return pred(values as number[]) ? 'GO' : 'NO-GO';
}

export function evaluateGates(r: Sprint4Report): Gates {
  const noDupSignal = gate([r.dupSignalIdCount], ([n]) => n === 0);
  const noDupOrder = gate([r.dupExchangeOrderIdCount], ([n]) => n === 0);
  const dlqClear = gate([r.dlqTotal], ([n]) => n === 0);
  const qfClear = gate([r.queueFailedTotal], ([n]) => n === 0);
  const stuckClear = gate([r.stuckTotal], ([n]) => n === 0);

  // Phase 0: safe to start firing only if the baseline is clean — the queue must be EMPTY and there
  // are no dups, no DLQ/queue_failed/stuck.
  const phase0Ready = gate(
    [r.queueLength, r.dupSignalIdCount, r.dupExchangeOrderIdCount, r.dlqTotal, r.queueFailedTotal, r.stuckTotal],
    ([ql, ds, deo, dlq, qf, st]) => ql === 0 && ds === 0 && deo === 0 && dlq === 0 && qf === 0 && st === 0,
  );

  // Phase A: volume underway and no integrity breach (no dup trades, no DLQ/queue_failed).
  const phaseA = gate(
    [r.dupSignalIdCount, r.dupExchangeOrderIdCount, r.dlqTotal, r.queueFailedTotal],
    ([ds, deo, dlq, qf]) => ds === 0 && deo === 0 && dlq === 0 && qf === 0,
  );

  // Direct "no open positions" check from trades_by_status — does NOT depend on the 300s stuck
  // window, so a freshly-induced unknown/pending can't slip past a too-soon snapshot (P1-4).
  const pendingOrUnknown: Maybe<number> =
    r.tradesByStatus === UNAVAILABLE
      ? UNAVAILABLE
      : (r.tradesByStatus.pending ?? 0) + (r.tradesByStatus.unknown ?? 0);

  const checks: Record<string, boolean | typeof UNAVAILABLE> = {
    filled_ge_50: r.filledTotal === UNAVAILABLE ? UNAVAILABLE : r.filledTotal >= 50,
    symbols_ge_5: r.symbolCount === UNAVAILABLE ? UNAVAILABLE : r.symbolCount >= 5,
    distinct_filled_signals_ge_50: r.distinctFilledSignalId === UNAVAILABLE ? UNAVAILABLE : r.distinctFilledSignalId >= 50,
    no_duplicate_signal_id: noDupSignal === 'INDETERMINATE' ? UNAVAILABLE : noDupSignal === 'GO',
    no_duplicate_exchange_order_id: noDupOrder === 'INDETERMINATE' ? UNAVAILABLE : noDupOrder === 'GO',
    dlq_clear: dlqClear === 'INDETERMINATE' ? UNAVAILABLE : dlqClear === 'GO',
    queue_failed_clear: qfClear === 'INDETERMINATE' ? UNAVAILABLE : qfClear === 'GO',
    stuck_clear: stuckClear === 'INDETERMINATE' ? UNAVAILABLE : stuckClear === 'GO',
    no_open_pending_or_unknown: pendingOrUnknown === UNAVAILABLE ? UNAVAILABLE : pendingOrUnknown === 0,
    // NOTE: reconciled-unknowns count is INTENTIONALLY NOT an auto-gate here. reconciliation_jobs
    // resolved is a CUMULATIVE all-time count (incl. prior E1 jobs), so it cannot prove "3 reconciled
    // THIS campaign". That is a manual campaign-delta gate (see `manual` below). (P1-2)
  };

  const values = Object.values(checks);
  let fullS4_2: Verdict;
  if (values.some((v) => v === UNAVAILABLE)) fullS4_2 = 'INDETERMINATE';
  else if (values.every((v) => v === true)) fullS4_2 = 'GO';
  else fullS4_2 = 'NO-GO';

  return {
    phase0Ready,
    phaseA,
    fullS4_2,
    checks,
    manual: [
      'reconciled unknowns (>=3 THIS campaign): reconciliation_jobs.resolved is CUMULATIVE — compute the DELTA vs the pre-campaign baseline snapshot; the raw count is NOT proof.',
      'S4-3a filled-path: >=1 reconciliation_resolved with resolved_status=filled from a real campaign fill — verify the log line + DB by hand',
      'recovered bot-error (1): bot.misconfigured audit + error log + bots.status=error, then valid+active recovery + a later fill — verify by hand',
      'zero SILENT failures: every failure has an observable artifact (DLQ/queue_failed/failed/alert/log)',
      'snapshot timing: take the final snapshot >300s after the last induced unknown/restart so no open trade hides under the stuck window',
    ],
  };
}

// ── Secret-safe formatting ─────────────────────────────────────────────────────────────────────

function show(v: Maybe<number>): string {
  return v === UNAVAILABLE ? 'unavailable' : String(v);
}

export function formatReport(config: ReportConfig, r: Sprint4Report, g: Gates): string[] {
  const lines: string[] = [];
  const p = (s: string) => lines.push(`[sprint4:evidence] ${s}`);
  p(`db=${config.describe()} · stuckThresholdSeconds=${r.thresholdSeconds}`);
  p(`queue_length=${show(r.queueLength)}`);
  p(`trades_by_status=${r.tradesByStatus === UNAVAILABLE ? 'unavailable' : JSON.stringify(r.tradesByStatus)}`);
  p(`filled_total=${show(r.filledTotal)} · symbols=${show(r.symbolCount)} · filled_by_symbol=${r.filledBySymbol === UNAVAILABLE ? 'unavailable' : JSON.stringify(r.filledBySymbol)}`);
  p(`total_trades=${show(r.totalTrades)} · distinct_signal_id=${show(r.distinctSignalId)} · distinct_filled_signal_id=${show(r.distinctFilledSignalId)}`);
  p(`duplicate_signal_id=${show(r.dupSignalIdCount)} · duplicate_exchange_order_id=${show(r.dupExchangeOrderIdCount)}`);
  p(`dlq_total=${show(r.dlqTotal)} · queue_failed_total=${show(r.queueFailedTotal)} · stuck_total=${show(r.stuckTotal)}`);
  p(`reconciliation_jobs_by_status=${r.reconJobsByStatus === UNAVAILABLE ? 'unavailable' : JSON.stringify(r.reconJobsByStatus)}`);
  p(`pending_unknown_old=${r.pendingUnknownOld === UNAVAILABLE ? 'unavailable' : String(r.pendingUnknownOld.length)} · filled_path_candidates=${show(r.filledPathCandidates)}`);
  if (r.pendingUnknownOld !== UNAVAILABLE) {
    for (const row of r.pendingUnknownOld) {
      // non-secret identifiers (trade id / symbol / status / age) so the operator sees WHICH trades are stuck
      p(`  stuck_trade id=${asStr(row.id) ?? '?'} pair=${asStr(row.trading_pair) ?? '?'} status=${asStr(row.status) ?? '?'} created_at=${asStr(row.created_at) ?? '?'}`);
    }
  }
  if (r.unavailable.length) p(`unavailable_metrics=${JSON.stringify(r.unavailable)}`);
  p(`GATES · phase0_ready=${g.phase0Ready} · phaseA=${g.phaseA} · full_s4_2=${g.fullS4_2}`);
  p(`full_s4_2_checks=${JSON.stringify(g.checks)}`);
  for (const m of g.manual) p(`manual_check: ${m}`);
  return lines;
}

// ── Orchestration + CLI ──────────────────────────────────────────────────────────────────────────

export interface RunReportResult {
  report: Sprint4Report;
  gates: Gates;
}

/** Connect (read-only), collect every metric, parse + evaluate gates, always close. */
export async function runReport(config: ReportConfig, runner: ReportRunnerLike): Promise<RunReportResult> {
  await runner.connect();
  try {
    const raw = await collect(runner, config.thresholdSeconds);
    const report = parseReport(raw, config.thresholdSeconds);
    const gates = evaluateGates(report);
    return { report, gates };
  } finally {
    await runner.close();
  }
}

/** Map any thrown error to a SAFE one-line message — our own error is already redacted; others get a type label. */
export function safeErrorLine(err: unknown): string {
  if (err instanceof ReportError) return err.message;
  const name = (err as { name?: string })?.name;
  return `unexpected error (${typeof name === 'string' && name ? name : 'Error'})`;
}

/* istanbul ignore next -- CLI wiring; exercised by operators, not unit tests (no live DB here). */
async function main(): Promise<void> {
  const env = process.env;
  const config = ReportConfig.fromEnv(env);
  const runner = new ReportRunner(config);
  const { report, gates } = await runReport(config, runner);
  for (const line of formatReport(config, report, gates)) process.stdout.write(`${line}\n`);
}

/* istanbul ignore next -- only true when executed directly, never on import or under jest. */
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[sprint4:evidence] FAILED: ${safeErrorLine(err)}\n`);
    process.exitCode = 1;
  });
}
