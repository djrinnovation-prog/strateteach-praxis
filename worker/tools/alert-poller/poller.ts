// worker/tools/alert-poller/poller.ts
//
// Poller skeleton for the S4-1 alerting layer (signals 1–3). It wires evidence IN, de-dup state
// THROUGH the pure criteria engine (./criteria), and alert decisions OUT. This module:
//   - does NOT connect to a DB, send HTTP/Telegram, read secrets, or import worker runtime code
//   - is offline/fixture-first: evidence + state arrive via INJECTED interfaces (no I/O here)
//   - is orchestration ONLY — all alert logic lives in evaluatePoll (pure)
//
// DB-fetch wiring: SqlEvidenceSource maps the read-only SQL templates (../lib/readonly-sql) to
// PollEvidence via an injected `ReadonlyRunner`. That runner is the SINGLE seam where a real,
// approved read-only DB client would later plug in. None is provided here — running against a real
// database is a separate, explicitly-approved step. Tests supply a fixture runner.
//
// Persistence safety (runbook §7): de-dup state advances only by persisting `nextState`. We persist
// BEFORE reporting the poll committed and treat ANY save failure as fail-loud (PollerError) — so an
// alert is never marked handled while persistence is uncertain; it re-fires next poll instead
// (at-least-once, never silently dropped).

import {
  evaluatePoll,
  INITIAL_STATE,
  type AlertDecision,
  type PollContext,
  type PollEvidence,
  type PollerState,
} from './criteria';
import {
  assertReadOnly,
  dlqSince,
  queueFailedSince,
  stuckTrades,
  STUCK_THRESHOLD_SECONDS_DEFAULT,
  type ReadonlyQuery,
} from '../lib/readonly-sql';

/** Watermark used the first time a signal is polled (no prior state). A valid timestamptz. */
export const EPOCH_WATERMARK = '1970-01-01T00:00:00Z';

/** A source of already-scoped poll evidence. Receives prior state so watermarks can bind the query. */
export interface EvidenceSource {
  fetch(prev: PollerState): PollEvidence | Promise<PollEvidence>;
}

/** Persists de-dup state between polls. `load` returns null when no prior state exists. */
export interface StateStore {
  load(): PollerState | null | Promise<PollerState | null>;
  save(state: PollerState): void | Promise<void>;
}

/**
 * Poller-layer fault (source / state-store failure, malformed row shape, uncertain persistence). The
 * underlying cause is NOT retained — a wrapped error (e.g. a driver/state-store error) could embed a
 * secret, and a retained `cause` would leak through `console.error(err)`, `util.inspect`, or any
 * serializer that walks `.cause`. We keep ONLY the cause's type name (`causeName`, e.g. "Error"),
 * never its message or the object itself.
 */
export class PollerError extends Error {
  /** The TYPE name of the underlying cause (safe class identifier), never its message/value. */
  readonly causeName?: string;

  constructor(message: string, cause?: unknown) {
    // Intentionally do NOT forward `cause` to super({ cause }) — that would re-attach the raw object.
    super(`alert-poller: ${message}`);
    this.name = 'PollerError';
    this.causeName = PollerError.safeCauseName(cause);
  }

  /** Extract only a non-sensitive type label from a thrown cause. Never returns its message/value. */
  private static safeCauseName(cause: unknown): string | undefined {
    if (cause === undefined || cause === null) return undefined;
    if (cause instanceof Error) return cause.name || cause.constructor?.name || 'Error';
    // Non-Error throwable: report only the primitive type, never the value (which may be a secret).
    return typeof cause;
  }
}

export interface RunPollResult {
  alerts: AlertDecision[];
  nextState: PollerState;
  /** true ONLY after nextState was durably saved — i.e. the alerts may be treated as handled. */
  committed: boolean;
}

// ── State serialization (offline/fixture-first) ──────────────────────────────

/** Serialize de-dup state to a JSON string (only the three known fields). Pure. */
export function serializeState(state: PollerState): string {
  return JSON.stringify({
    dlqWatermark: state.dlqWatermark,
    queueFailedWatermark: state.queueFailedWatermark,
    stuckActive: state.stuckActive,
  });
}

/**
 * Parse a stored state string. Throws PollerError on invalid JSON / non-object — fail loud on a
 * corrupt store. The DEEP shape (watermark types, timestamp-likeness, boolean flag) is validated by
 * evaluatePoll when the state is used, which throws MalformedEvidenceError.
 */
export function deserializeState(raw: string): PollerState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PollerError('corrupt stored state — not valid JSON', e);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PollerError(`corrupt stored state — expected an object (got ${JSON.stringify(parsed)})`);
  }
  return parsed as PollerState;
}

/**
 * In-memory state store that round-trips through a JSON string — exercising serialize/deserialize
 * exactly as a real (file / bounded-state) store would, but with NO I/O. `load` deserializes a
 * corrupt string into a fail-loud PollerError.
 */
export class InMemoryStateStore implements StateStore {
  private serialized: string | null;
  constructor(initial: PollerState | null = null) {
    this.serialized = initial === null ? null : serializeState(initial);
  }
  load(): PollerState | null {
    return this.serialized === null ? null : deserializeState(this.serialized);
  }
  save(state: PollerState): void {
    this.serialized = serializeState(state);
  }
  /** Raw stored form — for assertions/inspection in tests. */
  peek(): string | null {
    return this.serialized;
  }
}

// ── Evidence sources ─────────────────────────────────────────────────────────

/** Evidence source backed by a fixed in-memory value (offline/fixture-first; deterministic). */
export class FixtureEvidenceSource implements EvidenceSource {
  constructor(private readonly evidence: PollEvidence) {}
  fetch(): PollEvidence {
    return this.evidence;
  }
}

/** One row from a read-only query. Only scalar columns are expected. */
export type ReadonlyRow = Record<string, string | number | null | undefined>;

/**
 * Executes a vetted read-only query with bound params and returns rows. This is the ONLY seam that
 * would touch a database; it is injected, never implemented here. Offline tests pass a fixture.
 */
export type ReadonlyRunner = (
  query: ReadonlyQuery,
  params: ReadonlyArray<string | number>,
) => ReadonlyRow[] | Promise<ReadonlyRow[]>;

export interface SqlEvidenceOptions {
  runner: ReadonlyRunner;
  /** Stuck-trade threshold (seconds). Defaults to the readonly-sql default. */
  thresholdSeconds?: number;
}

/**
 * Builds PollEvidence by running the three alerting queries through an injected read-only runner,
 * binding watermarks from prior state. Every query is re-asserted read-only before it reaches the
 * runner (defense-in-depth), and each result row's shape is validated (fail loud on a bad row).
 * No DB client, no network, no secrets in this layer — the runner is the plug-in point.
 */
export class SqlEvidenceSource implements EvidenceSource {
  private readonly runner: ReadonlyRunner;
  private readonly thresholdSeconds: number;
  constructor(opts: SqlEvidenceOptions) {
    this.runner = opts.runner;
    this.thresholdSeconds = opts.thresholdSeconds ?? STUCK_THRESHOLD_SECONDS_DEFAULT;
  }

  async fetch(prev: PollerState): Promise<PollEvidence> {
    const dlqRow = await this.runOne(dlqSince, [prev.dlqWatermark ?? EPOCH_WATERMARK]);
    const qfRow = await this.runOne(queueFailedSince, [prev.queueFailedWatermark ?? EPOCH_WATERMARK]);
    const stuckRow = await this.runOne(stuckTrades, [this.thresholdSeconds]);
    return {
      dlq: { n: intColumn(dlqRow, 'n', dlqSince), newest: tsColumn(dlqRow, 'newest', dlqSince) },
      queueFailed: {
        n: intColumn(qfRow, 'n', queueFailedSince),
        newest: tsColumn(qfRow, 'newest', queueFailedSince),
      },
      stuck: { n: intColumn(stuckRow, 'n', stuckTrades), thresholdSeconds: this.thresholdSeconds },
    };
  }

  private async runOne(query: ReadonlyQuery, params: ReadonlyArray<string | number>): Promise<ReadonlyRow> {
    assertReadOnly(query); // the seam refuses anything that is not a single read-only SELECT
    const rows = await this.runner(query, params);
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw new PollerError(
        `query "${query.name}" must return exactly one row (got ${Array.isArray(rows) ? `${rows.length} rows` : typeof rows})`,
      );
    }
    return rows[0];
  }
}

function intColumn(row: ReadonlyRow, key: string, query: ReadonlyQuery): number {
  const v = row[key];
  if (typeof v !== 'number') {
    throw new PollerError(`query "${query.name}" column "${key}" must be a number (got ${JSON.stringify(v)})`);
  }
  return v;
}

function tsColumn(row: ReadonlyRow, key: string, query: ReadonlyQuery): string | null {
  // A MISSING column (absent key / undefined) means a broken query/runner/parser — fail loud, do
  // NOT coerce to null. SQL null (e.g. max() over no rows = "no new rows") is a valid, distinct
  // result and is the ONLY non-string value allowed through here.
  if (!(key in row) || row[key] === undefined) {
    throw new PollerError(`query "${query.name}" is missing expected column "${key}"`);
  }
  const v = row[key];
  if (v === null) return null;
  if (typeof v === 'string') return v; // timestamp-likeness enforced downstream by evaluatePoll
  throw new PollerError(
    `query "${query.name}" column "${key}" must be a timestamp string or null (got ${JSON.stringify(v)})`,
  );
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface RunPollOptions {
  source: EvidenceSource;
  store: StateStore;
  context: PollContext;
}

/**
 * Run one poll cycle:
 *   1. load prior de-dup state (INITIAL_STATE if none)
 *   2. fetch evidence (fixture/typed or the SQL seam), scoped by the prior watermarks
 *   3. evaluatePoll — validates evidence + state, fails loud on malformed input, never leaks
 *   4. persist nextState BEFORE reporting committed; a save failure is fail-loud (PollerError) so
 *      the alerts are NOT treated as handled and will re-fire on the next poll.
 *
 * Throws: PollerError (source/state-store/persistence faults), MalformedEvidenceError (bad
 * evidence/state), ForbiddenFieldError (a secret-looking context value). Never silently drops.
 */
export async function runPoll(opts: RunPollOptions): Promise<RunPollResult> {
  const { source, store, context } = opts;

  let prev: PollerState;
  try {
    prev = (await store.load()) ?? INITIAL_STATE;
  } catch (e) {
    if (e instanceof PollerError) throw e;
    throw new PollerError('state load failed', e);
  }

  let evidence: PollEvidence;
  try {
    evidence = await source.fetch(prev);
  } catch (e) {
    if (e instanceof PollerError) throw e;
    throw new PollerError('evidence source failed', e);
  }

  // Pure engine — throws MalformedEvidenceError on bad evidence/state, ForbiddenFieldError on a leak.
  // (Not wrapped: these are not poller-layer faults and must surface with their own types.)
  const { alerts, nextState } = evaluatePoll(evidence, prev, context);

  // Persist BEFORE declaring committed. If this throws we fail loud and never report the alerts as
  // handled (state was not advanced → they re-fire next poll).
  try {
    await store.save(nextState);
  } catch (e) {
    throw new PollerError('state persistence failed — alerts NOT marked handled', e);
  }

  return { alerts, nextState, committed: true };
}
