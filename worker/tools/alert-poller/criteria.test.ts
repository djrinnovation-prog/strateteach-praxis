// worker/tools/alert-poller/criteria.test.ts
import {
  evaluatePoll,
  INITIAL_STATE,
  MalformedEvidenceError,
  isTimestampLike,
  type PollEvidence,
  type PollContext,
} from './criteria';
import { findForbidden, ForbiddenFieldError } from '../lib/safe-payload';

const ctx: PollContext = { now: '2026-06-21T12:00:00Z', environment: 'dev', deployId: '1a872bdb' };

/** Clean (all-zero) evidence with optional per-signal overrides. */
function ev(over: Partial<PollEvidence> = {}): PollEvidence {
  return {
    dlq: { n: 0, newest: null },
    queueFailed: { n: 0, newest: null },
    stuck: { n: 0, thresholdSeconds: 300 },
    ...over,
  };
}

describe('criteria — each signal fires when n > 0', () => {
  test('DLQ fires', () => {
    const r = evaluatePoll(ev({ dlq: { n: 2, newest: '2026-06-21T11:59:00Z' } }), INITIAL_STATE, ctx);
    const a = r.alerts.find((x) => x.signal === 'dlq');
    expect(a).toBeDefined();
    expect(a!.payload).toMatchObject({ event: 'dlq_alert', table: 'trades_dlq', count: 2, environment: 'dev' });
    expect(r.nextState.dlqWatermark).toBe('2026-06-21T11:59:00Z');
  });

  test('queue_failed fires', () => {
    const r = evaluatePoll(ev({ queueFailed: { n: 1, newest: '2026-06-21T11:58:00Z' } }), INITIAL_STATE, ctx);
    const a = r.alerts.find((x) => x.signal === 'queue_failed');
    expect(a).toBeDefined();
    expect(a!.payload).toMatchObject({ event: 'queue_failed_alert', table: 'webhook_logs', count: 1 });
    expect(r.nextState.queueFailedWatermark).toBe('2026-06-21T11:58:00Z');
  });

  test('stuck fires', () => {
    const r = evaluatePoll(ev({ stuck: { n: 3, thresholdSeconds: 300 } }), INITIAL_STATE, ctx);
    const a = r.alerts.find((x) => x.signal === 'stuck');
    expect(a).toBeDefined();
    expect(a!.payload).toMatchObject({ event: 'stuck_trades_alert', table: 'trades', count: 3, age_seconds: 300 });
    expect(r.nextState.stuckActive).toBe(true);
  });

  test('all three fire together → 3 alerts', () => {
    const r = evaluatePoll(
      ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' }, queueFailed: { n: 2, newest: '2026-06-21T11:59:30Z' }, stuck: { n: 3, thresholdSeconds: 300 } }),
      INITIAL_STATE,
      ctx,
    );
    expect(r.alerts.map((a) => a.signal).sort()).toEqual(['dlq', 'queue_failed', 'stuck']);
  });
});

describe('criteria — clean baseline emits no alerts', () => {
  test('all-zero evidence → no alerts, state unchanged', () => {
    const r = evaluatePoll(ev(), INITIAL_STATE, ctx);
    expect(r.alerts).toEqual([]);
    expect(r.nextState).toEqual(INITIAL_STATE);
  });
});

describe('criteria — de-dup', () => {
  test('unchanged active stuck condition does not re-alert; re-arms when cleared', () => {
    const r1 = evaluatePoll(ev({ stuck: { n: 2, thresholdSeconds: 300 } }), INITIAL_STATE, ctx);
    expect(r1.alerts.map((a) => a.signal)).toContain('stuck');
    expect(r1.nextState.stuckActive).toBe(true);

    const r2 = evaluatePoll(ev({ stuck: { n: 2, thresholdSeconds: 300 } }), r1.nextState, ctx);
    expect(r2.alerts.map((a) => a.signal)).not.toContain('stuck'); // still firing → no re-alert

    const r3 = evaluatePoll(ev({ stuck: { n: 0, thresholdSeconds: 300 } }), r2.nextState, ctx);
    expect(r3.alerts).toEqual([]);
    expect(r3.nextState.stuckActive).toBe(false); // re-armed

    const r4 = evaluatePoll(ev({ stuck: { n: 1, thresholdSeconds: 300 } }), r3.nextState, ctx);
    expect(r4.alerts.map((a) => a.signal)).toContain('stuck'); // fires again
  });

  test('DLQ watermark: new rows alert, no-new-rows do not; watermark advances', () => {
    const t1 = '2026-06-21T11:59:00Z';
    const t2 = '2026-06-21T12:00:30Z';
    const r1 = evaluatePoll(ev({ dlq: { n: 1, newest: t1 } }), INITIAL_STATE, ctx);
    expect(r1.alerts.map((a) => a.signal)).toContain('dlq');
    expect(r1.nextState.dlqWatermark).toBe(t1);

    // next poll: the poller queried created_at > t1 and found none → n=0
    const r2 = evaluatePoll(ev({ dlq: { n: 0, newest: null } }), r1.nextState, ctx);
    expect(r2.alerts).toEqual([]);
    expect(r2.nextState.dlqWatermark).toBe(t1); // unchanged

    // next poll: a NEW row after t1
    const r3 = evaluatePoll(ev({ dlq: { n: 1, newest: t2 } }), r2.nextState, ctx);
    expect(r3.alerts.map((a) => a.signal)).toContain('dlq');
    expect(r3.nextState.dlqWatermark).toBe(t2); // advanced
  });
});

describe('criteria — fail loud on malformed/missing evidence', () => {
  test.each<[string, () => unknown]>([
    ['dlq.n negative', () => evaluatePoll(ev({ dlq: { n: -1, newest: null } }), INITIAL_STATE, ctx)],
    ['dlq.n non-integer', () => evaluatePoll(ev({ dlq: { n: 1.5, newest: 'T' } }), INITIAL_STATE, ctx)],
    ['dlq.newest null when n>0', () => evaluatePoll(ev({ dlq: { n: 1, newest: null } }), INITIAL_STATE, ctx)],
    ['dlq.newest malformed (not a timestamp) when n>0', () => evaluatePoll(ev({ dlq: { n: 1, newest: 'not-a-timestamp' } }), INITIAL_STATE, ctx)],
    ['queueFailed.newest empty when n>0', () => evaluatePoll(ev({ queueFailed: { n: 1, newest: '' } }), INITIAL_STATE, ctx)],
    ['ctx.now malformed (not a timestamp)', () => evaluatePoll(ev(), INITIAL_STATE, { now: 'nope', environment: 'dev' } as PollContext)],
    ['stuck.thresholdSeconds <= 0', () => evaluatePoll(ev({ stuck: { n: 0, thresholdSeconds: 0 } }), INITIAL_STATE, ctx)],
    ['missing stuck object', () =>
      evaluatePoll(
        { dlq: { n: 0, newest: null }, queueFailed: { n: 0, newest: null } } as unknown as PollEvidence,
        INITIAL_STATE,
        ctx,
      )],
    ['missing ctx.now', () => evaluatePoll(ev(), INITIAL_STATE, { now: '', environment: 'dev' } as PollContext)],
    ['missing ctx.environment', () =>
      evaluatePoll(ev(), INITIAL_STATE, { now: '2026-06-21T12:00:00Z', environment: '' } as PollContext)],
  ])('throws MalformedEvidenceError: %s', (_label, fn) => {
    expect(fn).toThrow(MalformedEvidenceError);
  });
});

describe('criteria — fail loud on malformed prevState', () => {
  test.each<[string, () => unknown]>([
    ['stuckActive is a string (not boolean)', () =>
      evaluatePoll(ev(), { dlqWatermark: null, queueFailedWatermark: null, stuckActive: 'true' } as unknown as typeof INITIAL_STATE, ctx)],
    ['dlqWatermark is a malformed timestamp string', () =>
      evaluatePoll(ev(), { dlqWatermark: 'not-a-timestamp', queueFailedWatermark: null, stuckActive: false } as unknown as typeof INITIAL_STATE, ctx)],
    ['queueFailedWatermark is a non-string, non-null value', () =>
      evaluatePoll(ev(), { dlqWatermark: null, queueFailedWatermark: 123, stuckActive: false } as unknown as typeof INITIAL_STATE, ctx)],
    ['missing state object', () =>
      evaluatePoll(ev(), undefined as unknown as typeof INITIAL_STATE, ctx)],
  ])('throws MalformedEvidenceError: %s', (_label, fn) => {
    expect(fn).toThrow(MalformedEvidenceError);
  });
});

describe('criteria — timestamp validation (isTimestampLike)', () => {
  test('accepts ISO and Postgres timestamptz formats', () => {
    expect(isTimestampLike('2026-06-21T12:00:00Z')).toBe(true);
    expect(isTimestampLike('2026-06-17 13:37:42.992867+00')).toBe(true); // Supabase db-query shape
    expect(isTimestampLike('2026-06-21T12:00:00.123+00:00')).toBe(true);
  });

  test('rejects malformed timestamp strings', () => {
    for (const bad of ['T1', 'T2', 'not-a-date', '', '2026-06-21', '2026-13-99T00:00:00Z', '99:99:99']) {
      expect(isTimestampLike(bad)).toBe(false);
    }
  });
});

describe('criteria — emitted payloads are secret-safe', () => {
  test('every payload passes findForbidden (no leaks)', () => {
    const r = evaluatePoll(
      ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' }, queueFailed: { n: 2, newest: '2026-06-21T11:59:30Z' }, stuck: { n: 3, thresholdSeconds: 300 } }),
      INITIAL_STATE,
      ctx,
    );
    expect(r.alerts).toHaveLength(3);
    for (const a of r.alerts) {
      expect(findForbidden(a.payload as Record<string, unknown>)).toEqual([]);
    }
  });

  test('a secret-looking deployId in context fails loud — payload cannot leak', () => {
    expect(() =>
      evaluatePoll(ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' } }), INITIAL_STATE, {
        now: '2026-06-21T12:00:00Z',
        environment: 'dev',
        deployId: 'https://leak.example/secret',
      }),
    ).toThrow(ForbiddenFieldError);
  });
});
