// worker/tools/alert-poller/criteria.ts
//
// Pure alert-evaluation engine for the S4-1 poller (signals 1–3). It receives already-fetched,
// typed evidence + prior de-dup state and returns alert decisions (secret-safe payloads via
// ../lib/safe-payload) + next state. This module:
//   - does NOT connect to a DB, send HTTP/Telegram, read secrets, or import worker runtime code
//   - is pure/deterministic: the caller passes `now` (no Date.now here)
// De-dup is modeled in memory; the poller persists the returned state (see runbook §7 caveat).

import { buildSafeAlert, type SafeAlert } from '../lib/safe-payload';

export type AlertSignal = 'dlq' | 'queue_failed' | 'stuck';

// ── Evidence (already scoped by the readonly-sql queries) ───────────────────

export interface DlqEvidence {
  /** rows with created_at > state.dlqWatermark. */
  n: number;
  /** max(created_at) of those rows (ISO); required (non-empty) when n > 0. */
  newest: string | null;
}
export interface QueueFailedEvidence {
  /** queue_failed rows with received_at > state.queueFailedWatermark. */
  n: number;
  newest: string | null;
}
export interface StuckEvidence {
  /** pending/unknown trades older than thresholdSeconds. */
  n: number;
  thresholdSeconds: number;
}
export interface PollEvidence {
  dlq: DlqEvidence;
  queueFailed: QueueFailedEvidence;
  stuck: StuckEvidence;
}

/** Non-secret context stamped onto payloads (poller supplies; env-derived, non-secret). */
export interface PollContext {
  now: string; // ISO timestamp — passed in for purity/determinism
  environment: string; // e.g. 'dev'
  deployId?: string; // e.g. Railway deploy id
}

/** De-dup state persisted between polls (runbook §7). */
export interface PollerState {
  dlqWatermark: string | null;
  queueFailedWatermark: string | null;
  stuckActive: boolean;
}

export const INITIAL_STATE: PollerState = {
  dlqWatermark: null,
  queueFailedWatermark: null,
  stuckActive: false,
};

export interface AlertDecision {
  signal: AlertSignal;
  payload: SafeAlert;
}

export interface PollResult {
  alerts: AlertDecision[];
  nextState: PollerState;
}

export class MalformedEvidenceError extends Error {
  constructor(message: string) {
    super(`alert-criteria: malformed evidence — ${message}`);
    this.name = 'MalformedEvidenceError';
  }
}

// ── Validation — fail loud on missing/invalid evidence ──────────────────────

// Accept ISO-8601 / Postgres timestamptz: date + time, optional fractional seconds, optional
// zone. Separator may be 'T' or ' '; zone may be Z, +HH, +HH:MM, or +HHMM. Pure structural +
// numeric-range check — no Date parsing (engine-independent, deterministic).
const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** True iff `s` is a well-formed ISO-8601 / timestamptz string with in-range fields. Pure. */
export function isTimestampLike(s: unknown): s is string {
  if (typeof s !== 'string' || s === '') return false;
  const m = TIMESTAMP_RE.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const se = Number(m[6]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h <= 23 && mi <= 59 && se <= 60;
}

function assertCount(n: unknown, where: string): asserts n is number {
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new MalformedEvidenceError(`${where}.n must be a non-negative integer (got ${JSON.stringify(n)})`);
  }
}
function assertNewest(newest: unknown, n: number, where: string): asserts newest is string | null {
  if (newest !== null && typeof newest !== 'string') {
    throw new MalformedEvidenceError(`${where}.newest must be string|null (got ${JSON.stringify(newest)})`);
  }
  if (n > 0 && (newest === null || newest === '')) {
    throw new MalformedEvidenceError(`${where}.newest is required (non-empty) when n > 0`);
  }
  // Any non-null watermark value (incl. the required one when n>0) must be a valid timestamp:
  // it is persisted as the next watermark, so a malformed value must fail loud, not stick.
  if (newest !== null && !isTimestampLike(newest)) {
    throw new MalformedEvidenceError(`${where}.newest must be an ISO/timestamptz string (got ${JSON.stringify(newest)})`);
  }
}

function validate(ev: PollEvidence, ctx: PollContext): void {
  if (!ev || typeof ev !== 'object') throw new MalformedEvidenceError('evidence object missing');
  for (const k of ['dlq', 'queueFailed', 'stuck'] as const) {
    if (!ev[k] || typeof ev[k] !== 'object') throw new MalformedEvidenceError(`evidence.${k} missing`);
  }
  assertCount(ev.dlq.n, 'dlq');
  assertNewest(ev.dlq.newest, ev.dlq.n, 'dlq');
  assertCount(ev.queueFailed.n, 'queueFailed');
  assertNewest(ev.queueFailed.newest, ev.queueFailed.n, 'queueFailed');
  assertCount(ev.stuck.n, 'stuck');
  const t = ev.stuck.thresholdSeconds;
  if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0) {
    throw new MalformedEvidenceError(`stuck.thresholdSeconds must be a positive integer (got ${JSON.stringify(t)})`);
  }
  if (!ctx || typeof ctx.now !== 'string' || ctx.now === '') {
    throw new MalformedEvidenceError('context.now (ISO timestamp) required');
  }
  if (!isTimestampLike(ctx.now)) {
    throw new MalformedEvidenceError(`context.now must be an ISO/timestamptz string (got ${JSON.stringify(ctx.now)})`);
  }
  if (typeof ctx.environment !== 'string' || ctx.environment === '') {
    throw new MalformedEvidenceError('context.environment required');
  }
}

// Validate the prior de-dup state. The poller loads this from a local state file / bounded-state
// layer between polls, so a corrupted watermark or flag must fail loud — never silently suppress
// an alert (e.g. a bogus future watermark would mask new DLQ rows).
function validatePrevState(prev: PollerState): void {
  if (!prev || typeof prev !== 'object') {
    throw new MalformedEvidenceError('prevState object missing');
  }
  for (const k of ['dlqWatermark', 'queueFailedWatermark'] as const) {
    const w = prev[k];
    if (w !== null && typeof w !== 'string') {
      throw new MalformedEvidenceError(`prevState.${k} must be string|null (got ${JSON.stringify(w)})`);
    }
    if (w !== null && !isTimestampLike(w)) {
      throw new MalformedEvidenceError(`prevState.${k} must be an ISO/timestamptz string (got ${JSON.stringify(w)})`);
    }
  }
  if (typeof prev.stuckActive !== 'boolean') {
    throw new MalformedEvidenceError(`prevState.stuckActive must be boolean (got ${JSON.stringify(prev.stuckActive)})`);
  }
}

// ── Engine ──────────────────────────────────────────────────────────────────

function base(ctx: PollContext): Record<string, unknown> {
  return { environment: ctx.environment, deploy_id: ctx.deployId, timestamp: ctx.now };
}

/**
 * Evaluate one poll. Pure: (evidence, prevState, ctx) -> { alerts, nextState }.
 *   - DLQ / queue_failed: watermark de-dup — alert iff n > 0 (new rows since the watermark), then
 *     advance the watermark to `newest`. n == 0 -> no alert, watermark unchanged.
 *   - stuck: active-flag de-dup — alert only on a clear->firing transition (n > 0 && !active);
 *     a still-firing condition does not re-alert; n == 0 re-arms.
 * Throws MalformedEvidenceError on missing/invalid evidence; ForbiddenFieldError (from
 * buildSafeAlert) if any context value is secret-looking — payloads can never leak.
 */
export function evaluatePoll(evidence: PollEvidence, prev: PollerState, ctx: PollContext): PollResult {
  validate(evidence, ctx);
  validatePrevState(prev);

  const alerts: AlertDecision[] = [];
  const next: PollerState = { ...prev };

  // 1. DLQ — alert on any new row since the watermark.
  if (evidence.dlq.n > 0) {
    alerts.push({
      signal: 'dlq',
      payload: buildSafeAlert({
        ...base(ctx),
        event: 'dlq_alert',
        table: 'trades_dlq',
        count: evidence.dlq.n,
        newest: evidence.dlq.newest ?? undefined,
      }),
    });
    next.dlqWatermark = evidence.dlq.newest;
  }

  // 2. queue_failed — alert on any new queue_failed row since the watermark.
  if (evidence.queueFailed.n > 0) {
    alerts.push({
      signal: 'queue_failed',
      payload: buildSafeAlert({
        ...base(ctx),
        event: 'queue_failed_alert',
        table: 'webhook_logs',
        count: evidence.queueFailed.n,
        newest: evidence.queueFailed.newest ?? undefined,
      }),
    });
    next.queueFailedWatermark = evidence.queueFailed.newest;
  }

  // 3. stuck — alert only on the clear->firing transition.
  if (evidence.stuck.n > 0) {
    if (!prev.stuckActive) {
      alerts.push({
        signal: 'stuck',
        payload: buildSafeAlert({
          ...base(ctx),
          event: 'stuck_trades_alert',
          table: 'trades',
          count: evidence.stuck.n,
          age_seconds: evidence.stuck.thresholdSeconds,
        }),
      });
    }
    next.stuckActive = true;
  } else {
    next.stuckActive = false;
  }

  return { alerts, nextState: next };
}
