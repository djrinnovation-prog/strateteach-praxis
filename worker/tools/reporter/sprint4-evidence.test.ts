// worker/tools/reporter/sprint4-evidence.test.ts
//
// Offline tests for the Sprint 4 evidence reporter. NO real DB, NO real secrets: the runner is an
// injected fixture (or a fake pg client), every DSN is a fake value. Focus areas:
//   1. config validation (requires explicit PRAXIS_REPORT_DSN — no fallback)
//   2. secret redaction (no DSN/password in describe or formatted output)
//   3. read-only execution boundary (non-SELECT rejected before the driver; session hardened)
//   4. graceful per-metric degradation (a denied query → "unavailable", report still produced)
//   5. parse + GO/NO-GO gates (phase0 / phaseA / full S4-2) incl. INDETERMINATE on unavailable

import {
  ReportConfig,
  ReportError,
  ReportRunner,
  reportQueries,
  collect,
  parseReport,
  evaluateGates,
  formatReport,
  runReport,
  safeErrorLine,
  REPORT_ENV,
  type ReportRunnerLike,
  type ReportQuery,
} from './sprint4-evidence';
import type { PgLikeClient } from '../alert-poller/pg-readonly-runner';

const FAKE_PW = 'sk_live_REPORT_dsn_SECRET_321';
const REPORT_DSN = `postgresql://reporter_ro:${FAKE_PW}@db.internal:5432/postgres?sslmode=require`;

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { [REPORT_ENV.DSN]: REPORT_DSN, ...overrides } as NodeJS.ProcessEnv;
}

// ── Fixture runner: canned rows per query name; can throw a 42501 for chosen metrics ────────────

class FixtureRunner implements ReportRunnerLike {
  connects = 0;
  closes = 0;
  constructor(
    private readonly rowsByQuery: Record<string, Record<string, unknown>[]> = {},
    private readonly denyFor: Set<string> = new Set(),
  ) {}
  async connect(): Promise<void> {
    this.connects++;
  }
  async run(query: ReportQuery): Promise<Record<string, unknown>[]> {
    if (this.denyFor.has(query.name)) {
      const e = new Error('permission denied') as Error & { code?: string };
      e.code = '42501';
      throw e;
    }
    return this.rowsByQuery[query.name] ?? [];
  }
  async close(): Promise<void> {
    this.closes++;
  }
}

// A healthy "full DoD met" snapshot.
function fullDoDRows(): Record<string, Record<string, unknown>[]> {
  return {
    queue_length: [{ n: 0 }],
    trades_by_status: [{ status: 'filled', n: 52 }, { status: 'failed', n: 2 }],
    filled_by_symbol: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'].map((s) => ({ trading_pair: s, n: 10 })),
    signal_totals: [{ total_trades: 54, distinct_signal_id: 54, distinct_filled_signal_id: 52 }],
    dup_signal_id: [],
    dup_exchange_order_id: [],
    dlq_total: [{ n: 0 }],
    queue_failed_total: [{ n: 0 }],
    stuck_total: [{ n: 0 }],
    recon_jobs_by_status: [{ status: 'resolved', n: 3 }],
    pending_unknown_old: [],
    filled_path_candidates: [{ n: 52 }],
  };
}

// A clean pre-campaign baseline (nothing fired yet).
function cleanBaselineRows(): Record<string, Record<string, unknown>[]> {
  return {
    queue_length: [{ n: 0 }],
    trades_by_status: [],
    filled_by_symbol: [],
    signal_totals: [{ total_trades: 0, distinct_signal_id: 0, distinct_filled_signal_id: 0 }],
    dup_signal_id: [],
    dup_exchange_order_id: [],
    dlq_total: [{ n: 0 }],
    queue_failed_total: [{ n: 0 }],
    stuck_total: [{ n: 0 }],
    recon_jobs_by_status: [],
    pending_unknown_old: [],
    filled_path_candidates: [{ n: 0 }],
  };
}

async function reportFrom(
  rows: Record<string, Record<string, unknown>[]>,
  deny: Set<string> = new Set(),
): Promise<ReturnType<typeof parseReport>> {
  const raw = await collect(new FixtureRunner(rows, deny), 300);
  return parseReport(raw, 300);
}

// ── 1. Config validation ────────────────────────────────────────────────────────

describe('ReportConfig.fromEnv', () => {
  it('loads from PRAXIS_REPORT_DSN and defaults the threshold', () => {
    const c = ReportConfig.fromEnv(env());
    expect(c.thresholdSeconds).toBe(300);
    expect(c.connectionString()).toBe(REPORT_DSN);
  });

  it('does NOT fall back to PRAXIS_ALERT_RO_DSN — requires PRAXIS_REPORT_DSN explicitly', () => {
    // only the narrow alert DSN is present → must still fail loud (no silent degrade from alert role)
    expect(() => ReportConfig.fromEnv({ PRAXIS_ALERT_RO_DSN: REPORT_DSN } as NodeJS.ProcessEnv)).toThrow(
      /PRAXIS_REPORT_DSN is not set/,
    );
  });

  it('fails loud when the DSN is unset / scheme bad / password missing', () => {
    expect(() => ReportConfig.fromEnv({} as NodeJS.ProcessEnv)).toThrow(/is not set/);
    expect(() => ReportConfig.fromEnv(env({ [REPORT_ENV.DSN]: 'mysql://reporter_ro:pw@h/db' }))).toThrow(
      /unsupported scheme/,
    );
    expect(() => ReportConfig.fromEnv(env({ [REPORT_ENV.DSN]: 'postgresql://reporter_ro@h:5432/db' }))).toThrow(
      /missing a password/,
    );
  });

  it('rejects a non-positive-integer threshold without echoing it', () => {
    try {
      ReportConfig.fromEnv(env({ [REPORT_ENV.STUCK_THRESHOLD_SECONDS]: FAKE_PW }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ReportError);
      expect((e as Error).message).not.toContain(FAKE_PW);
    }
  });
});

// ── 2. Secret redaction ──────────────────────────────────────────────────────────

describe('secret redaction', () => {
  it('describe() masks the password; formatted output never contains the DSN password', async () => {
    const config = ReportConfig.fromEnv(env());
    expect(config.describe()).toBe('postgresql://reporter_ro:***@db.internal:5432/postgres');
    expect(config.describe()).not.toContain(FAKE_PW);

    const report = await reportFrom(fullDoDRows());
    const lines = formatReport(config, report, evaluateGates(report));
    for (const line of lines) expect(line).not.toContain(FAKE_PW);
    // the descriptor line is present + redacted
    expect(lines[0]).toContain('reporter_ro:***@');
  });

  it('the raw DSN/password never leaks via String/JSON/inspect/own-property walk (P1)', () => {
    const config = ReportConfig.fromEnv(env());
    const util = require('util') as typeof import('util');
    const surfaces: string[] = [
      config.describe(),
      String(config),
      `${config}`,
      JSON.stringify(config),
      JSON.stringify({ nested: config }),
      util.inspect(config, { depth: null }),
      util.inspect(config, { depth: null, showHidden: true }),
    ];
    // own-property walk (enumerable + non-enumerable), every value stringified
    for (const k of Object.getOwnPropertyNames(config)) {
      const v = (config as unknown as Record<string, unknown>)[k];
      surfaces.push(typeof v === 'string' ? v : JSON.stringify(v ?? ''));
    }
    for (const s of surfaces) expect(s).not.toContain(FAKE_PW);
    // the DSN is a #private field → not an own property anywhere
    expect(Object.keys(config)).not.toContain('dsn');
    expect(Object.getOwnPropertyNames(config)).not.toContain('dsn');
    // the full DSN is reachable ONLY via connectionString(); toString/toJSON are redacted
    expect(config.connectionString()).toContain(FAKE_PW);
    expect(String(config)).toBe('postgresql://reporter_ro:***@db.internal:5432/postgres');
    expect(JSON.stringify(config)).toContain('reporter_ro:***@');
  });

  it('a connect-style ReportError + safeErrorLine carry only the redacted DSN', () => {
    const config = ReportConfig.fromEnv(env());
    const e = new ReportError(`connect failed for ${config.describe()}`);
    expect(e.message).not.toContain(FAKE_PW);
    expect(safeErrorLine(e)).not.toContain(FAKE_PW);
    expect(safeErrorLine(e)).toContain('reporter_ro:***@');
  });

  it('safeErrorLine surfaces only our redacted message, else a type label', () => {
    expect(safeErrorLine(new ReportError('bad dsn'))).toContain('bad dsn');
    expect(safeErrorLine(new Error(`boom ${FAKE_PW}`))).not.toContain(FAKE_PW);
  });
});

// ── 3. Read-only execution boundary ───────────────────────────────────────────────

class FakePgClient implements PgLikeClient {
  queries: string[] = [];
  ended = false;
  constructor(private readonly rows: Record<string, unknown>[] = []) {}
  async connect(): Promise<void> {}
  async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push(text);
    return { rows: /^SET\b/i.test(text) ? [] : this.rows };
  }
  async end(): Promise<void> {
    this.ended = true;
  }
}

describe('ReportRunner — read-only boundary', () => {
  it('connect() hardens the session read-only, then run() executes a vetted SELECT', async () => {
    const client = new FakePgClient([{ n: 7 }]);
    const runner = new ReportRunner(ReportConfig.fromEnv(env()), () => client);
    await runner.connect();
    expect(client.queries).toEqual([
      'SET default_transaction_read_only = on',
      'SET statement_timeout = 5000',
    ]);
    const rows = await runner.run({ name: 'dlq_total', sql: 'SELECT count(*)::int AS n FROM public.trades_dlq' });
    expect(rows).toEqual([{ n: 7 }]);
    await runner.close();
    expect(client.ended).toBe(true);
  });

  it('run() refuses a non-SELECT BEFORE the driver is called', async () => {
    const client = new FakePgClient();
    const runner = new ReportRunner(ReportConfig.fromEnv(env()), () => client);
    await runner.connect();
    const before = client.queries.length; // the two SET statements
    await expect(
      runner.run({ name: 'evil', sql: 'UPDATE public.trades SET status=$1' }),
    ).rejects.toThrow(/not a single read-only SELECT/);
    expect(client.queries.length).toBe(before); // nothing new sent
  });

  it('every built-in report query passes the read-only guard', () => {
    const { isReadOnlySelect } = require('../lib/readonly-sql') as typeof import('../lib/readonly-sql');
    for (const { query } of reportQueries(300)) expect(isReadOnlySelect(query.sql)).toBe(true);
  });

  it('every trades-population query excludes soft-deleted rows (deleted_at IS NULL) — P1/P2-5', () => {
    const byName = Object.fromEntries(reportQueries(300).map(({ query }) => [query.name, query.sql]));
    // the integrity/duplicate/candidate queries must not count soft-deleted trades
    for (const name of ['trades_by_status', 'filled_by_symbol', 'signal_totals', 'dup_signal_id', 'dup_exchange_order_id', 'stuck_total', 'pending_unknown_old', 'filled_path_candidates']) {
      expect(byName[name]).toMatch(/deleted_at IS NULL/);
    }
  });
});

// ── 4. Graceful per-metric degradation ────────────────────────────────────────────

describe('collect — graceful degradation', () => {
  it('a denied metric becomes "unavailable" with its SQLSTATE; the report still builds', async () => {
    const report = await reportFrom(fullDoDRows(), new Set(['queue_length', 'recon_jobs_by_status']));
    expect(report.queueLength).toBe('unavailable');
    expect(report.reconJobsByStatus).toBe('unavailable');
    expect(report.reconResolved).toBe('unavailable');
    expect(report.unavailable).toEqual(
      expect.arrayContaining([
        { metric: 'queue_length', error: '42501' },
        { metric: 'recon_jobs_by_status', error: '42501' },
      ]),
    );
    // available metrics still parsed
    expect(report.filledTotal).toBe(52);
  });
});

// ── 5. Parse + GO/NO-GO gates ──────────────────────────────────────────────────────

describe('parseReport + evaluateGates', () => {
  it('full DoD snapshot → all gates GO and every full_s4_2 check true', async () => {
    const report = await reportFrom(fullDoDRows());
    expect(report.filledTotal).toBe(52);
    expect(report.symbolCount).toBe(5);
    expect(report.distinctSignalId).toBe(54);
    expect(report.reconResolved).toBe(3);
    const g = evaluateGates(report);
    expect(g.phase0Ready).toBe('GO');
    expect(g.phaseA).toBe('GO');
    expect(g.fullS4_2).toBe('GO');
    expect(Object.values(g.checks).every((v) => v === true)).toBe(true);
    expect(g.manual.length).toBeGreaterThan(0); // qualitative gates always flagged
  });

  it('an open pending/unknown trade fails full S4-2 even with 50 fills (no_open_pending_or_unknown)', async () => {
    const rows = { ...fullDoDRows(), trades_by_status: [{ status: 'filled', n: 52 }, { status: 'unknown', n: 1 }] };
    const report = await reportFrom(rows);
    const g = evaluateGates(report);
    expect(g.checks.no_open_pending_or_unknown).toBe(false);
    expect(g.fullS4_2).toBe('NO-GO');
  });

  it('binds the 50-distinct DoD to FILLED signals, not all trades (P2-C)', async () => {
    // 60 distinct signals overall but only 48 distinct FILLED → must NO-GO
    const rows = { ...fullDoDRows(), signal_totals: [{ total_trades: 60, distinct_signal_id: 60, distinct_filled_signal_id: 48 }] };
    const g = evaluateGates(await reportFrom(rows));
    expect(g.checks.distinct_filled_signals_ge_50).toBe(false);
    expect(Object.keys(g.checks)).not.toContain('distinct_signals_ge_50');
    expect(g.fullS4_2).toBe('NO-GO');
  });

  it('a denied signal_totals → distinct_filled_signals_ge_50 INDETERMINATE, never a false GO (P2-4)', async () => {
    const report = await reportFrom(fullDoDRows(), new Set(['signal_totals']));
    expect(report.distinctFilledSignalId).toBe('unavailable');
    const g = evaluateGates(report);
    expect(g.checks.distinct_filled_signals_ge_50).toBe('unavailable');
    expect(g.fullS4_2).toBe('INDETERMINATE');
  });

  it('does NOT auto-gate on cumulative reconciled count — it is a manual campaign-delta gate (P1-2)', async () => {
    // fullDoD has recon resolved=3; remove it and full S4-2 must STILL be GO (recon is not an auto-check)
    const rows = { ...fullDoDRows(), recon_jobs_by_status: [] };
    const g = evaluateGates(await reportFrom(rows));
    expect(Object.keys(g.checks)).not.toContain('reconciled_resolved_ge_3');
    expect(g.fullS4_2).toBe('GO');
    expect(g.manual.join(' ')).toMatch(/reconciled unknowns .*THIS campaign/);
  });

  it('clean pre-campaign baseline → phase0 GO but full S4-2 NO-GO', async () => {
    const report = await reportFrom(cleanBaselineRows());
    const g = evaluateGates(report);
    expect(g.phase0Ready).toBe('GO');
    expect(g.fullS4_2).toBe('NO-GO'); // nothing filled yet
    expect(g.checks.filled_ge_50).toBe(false);
  });

  it('a duplicate signal_id blocks phase0 and phaseA (NO-GO)', async () => {
    const rows = { ...cleanBaselineRows(), dup_signal_id: [{ signal_id: 'X', n: 2 }] };
    const report = await reportFrom(rows);
    expect(report.dupSignalIdCount).toBe(1);
    const g = evaluateGates(report);
    expect(g.phase0Ready).toBe('NO-GO');
    expect(g.phaseA).toBe('NO-GO');
  });

  it('a non-empty queue blocks phase0 (NO-GO) even when everything else is clean', async () => {
    const report = await reportFrom({ ...cleanBaselineRows(), queue_length: [{ n: 5 }] });
    expect(report.queueLength).toBe(5);
    expect(evaluateGates(report).phase0Ready).toBe('NO-GO');
  });

  it('an unavailable queue_length makes phase0 INDETERMINATE (never a false GO)', async () => {
    const report = await reportFrom(cleanBaselineRows(), new Set(['queue_length']));
    expect(report.queueLength).toBe('unavailable');
    expect(evaluateGates(report).phase0Ready).toBe('INDETERMINATE');
  });

  it('an unavailable integrity metric makes the gate INDETERMINATE, not a false PASS', async () => {
    const report = await reportFrom(cleanBaselineRows(), new Set(['dlq_total']));
    const g = evaluateGates(report);
    expect(report.dlqTotal).toBe('unavailable');
    expect(g.phase0Ready).toBe('INDETERMINATE');
    expect(g.fullS4_2).toBe('INDETERMINATE');
    expect(g.checks.dlq_clear).toBe('unavailable');
  });
});

// ── 6. Orchestration (fixture; no live DB) ─────────────────────────────────────────

describe('runReport', () => {
  it('connects, collects, and always closes the runner', async () => {
    const runner = new FixtureRunner(fullDoDRows());
    const config = ReportConfig.fromEnv(env());
    const { report, gates } = await runReport(config, runner);
    expect(runner.connects).toBe(1);
    expect(runner.closes).toBe(1);
    expect(gates.fullS4_2).toBe('GO');
    expect(report.symbolCount).toBe(5);
  });
});
