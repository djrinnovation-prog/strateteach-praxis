// worker/tools/alert-poller/poller.test.ts
import {
  runPoll,
  serializeState,
  deserializeState,
  InMemoryStateStore,
  FixtureEvidenceSource,
  SqlEvidenceSource,
  PollerError,
  EPOCH_WATERMARK,
  type StateStore,
  type ReadonlyRunner,
  type ReadonlyRow,
} from './poller';
import { INITIAL_STATE, MalformedEvidenceError, type PollEvidence, type PollContext, type PollerState } from './criteria';
import { findForbidden, ForbiddenFieldError } from '../lib/safe-payload';
import { isReadOnlySelect, dlqSince, queueFailedSince, stuckTrades, type ReadonlyQuery } from '../lib/readonly-sql';

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

describe('poller — runPoll happy path (fixture-first)', () => {
  test('fires DLQ, returns committed result, and advances persisted state', async () => {
    const store = new InMemoryStateStore();
    const source = new FixtureEvidenceSource(ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' } }));

    const r = await runPoll({ source, store, context: ctx });

    expect(r.committed).toBe(true);
    expect(r.alerts.map((a) => a.signal)).toEqual(['dlq']);
    expect(r.alerts[0].payload).toMatchObject({ event: 'dlq_alert', table: 'trades_dlq', count: 1 });
    expect(r.nextState.dlqWatermark).toBe('2026-06-21T11:59:00Z');
    // state durably saved
    expect(JSON.parse(store.peek()!).dlqWatermark).toBe('2026-06-21T11:59:00Z');
  });

  test('clean evidence → no alerts, committed, state persisted unchanged', async () => {
    const store = new InMemoryStateStore();
    const r = await runPoll({ source: new FixtureEvidenceSource(ev()), store, context: ctx });
    expect(r.alerts).toEqual([]);
    expect(r.committed).toBe(true);
    expect(deserializeState(store.peek()!)).toEqual(INITIAL_STATE);
  });
});

describe('poller — de-dup across polls (shared store)', () => {
  test('DLQ watermark suppresses no-new-rows; re-fires on a newer row', async () => {
    const store = new InMemoryStateStore();
    const t1 = '2026-06-21T11:59:00Z';
    const t2 = '2026-06-21T12:00:30Z';

    const r1 = await runPoll({ source: new FixtureEvidenceSource(ev({ dlq: { n: 1, newest: t1 } })), store, context: ctx });
    expect(r1.alerts.map((a) => a.signal)).toContain('dlq');
    expect(JSON.parse(store.peek()!).dlqWatermark).toBe(t1);

    // next poll: poller queried created_at > t1 and found none → n=0
    const r2 = await runPoll({ source: new FixtureEvidenceSource(ev({ dlq: { n: 0, newest: null } })), store, context: ctx });
    expect(r2.alerts).toEqual([]);
    expect(JSON.parse(store.peek()!).dlqWatermark).toBe(t1); // unchanged

    const r3 = await runPoll({ source: new FixtureEvidenceSource(ev({ dlq: { n: 1, newest: t2 } })), store, context: ctx });
    expect(r3.alerts.map((a) => a.signal)).toContain('dlq');
    expect(JSON.parse(store.peek()!).dlqWatermark).toBe(t2); // advanced
  });

  test('stuck re-arm (clear) is persisted even though it emits no alert', async () => {
    const store = new InMemoryStateStore();
    const r1 = await runPoll({ source: new FixtureEvidenceSource(ev({ stuck: { n: 2, thresholdSeconds: 300 } })), store, context: ctx });
    expect(r1.alerts.map((a) => a.signal)).toContain('stuck');
    expect(JSON.parse(store.peek()!).stuckActive).toBe(true);

    const r2 = await runPoll({ source: new FixtureEvidenceSource(ev({ stuck: { n: 0, thresholdSeconds: 300 } })), store, context: ctx });
    expect(r2.alerts).toEqual([]);
    expect(JSON.parse(store.peek()!).stuckActive).toBe(false); // re-armed + persisted
  });
});

describe('poller — persistence safety (never mark handled if save is uncertain)', () => {
  test('a save failure fails loud (PollerError), does not advance state, and the alert re-fires', async () => {
    const realStore = new InMemoryStateStore();
    const failingSave: StateStore = {
      load: () => realStore.load(),
      save: () => {
        throw new Error('disk full');
      },
    };
    const source = new FixtureEvidenceSource(ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' } }));

    await expect(runPoll({ source, store: failingSave, context: ctx })).rejects.toThrow(PollerError);
    expect(realStore.peek()).toBeNull(); // state NOT advanced

    // same evidence on a working store → the alert re-fires (was never marked handled)
    const r = await runPoll({ source, store: realStore, context: ctx });
    expect(r.committed).toBe(true);
    expect(r.alerts.map((a) => a.signal)).toContain('dlq');
  });
});

describe('poller — fail loud on malformed evidence / state', () => {
  test('malformed evidence (dlq.newest null when n>0) → MalformedEvidenceError', async () => {
    const source = new FixtureEvidenceSource(ev({ dlq: { n: 1, newest: null } }));
    await expect(runPoll({ source, store: new InMemoryStateStore(), context: ctx })).rejects.toThrow(MalformedEvidenceError);
  });

  test('malformed loaded state (stuckActive not boolean) → MalformedEvidenceError', async () => {
    const store: StateStore = {
      load: () => ({ dlqWatermark: null, queueFailedWatermark: null, stuckActive: 'yes' } as unknown as PollerState),
      save: () => undefined,
    };
    await expect(runPoll({ source: new FixtureEvidenceSource(ev()), store, context: ctx })).rejects.toThrow(MalformedEvidenceError);
  });

  test('malformed loaded state (non-timestamp watermark) → MalformedEvidenceError', async () => {
    const store = new InMemoryStateStore({ dlqWatermark: 'not-a-timestamp', queueFailedWatermark: null, stuckActive: false });
    await expect(runPoll({ source: new FixtureEvidenceSource(ev()), store, context: ctx })).rejects.toThrow(MalformedEvidenceError);
  });

  test('evidence source failure → PollerError', async () => {
    const source = {
      fetch: () => {
        throw new Error('fixture boom');
      },
    };
    await expect(runPoll({ source, store: new InMemoryStateStore(), context: ctx })).rejects.toThrow(PollerError);
  });
});

describe('poller — state serialization', () => {
  test('serialize/deserialize round-trips a state', () => {
    const s: PollerState = { dlqWatermark: '2026-06-21T11:59:00Z', queueFailedWatermark: null, stuckActive: true };
    expect(deserializeState(serializeState(s))).toEqual(s);
  });

  test('corrupt JSON → PollerError', () => {
    expect(() => deserializeState('{not json')).toThrow(PollerError);
  });

  test('valid JSON that is not an object → PollerError', () => {
    expect(() => deserializeState('42')).toThrow(PollerError);
    expect(() => deserializeState('[1,2]')).toThrow(PollerError);
    expect(() => deserializeState('null')).toThrow(PollerError);
  });
});

describe('poller — emitted payloads are secret-safe', () => {
  test('every alert payload passes findForbidden (no leaks)', async () => {
    const source = new FixtureEvidenceSource(
      ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' }, queueFailed: { n: 2, newest: '2026-06-21T11:59:30Z' }, stuck: { n: 3, thresholdSeconds: 300 } }),
    );
    const r = await runPoll({ source, store: new InMemoryStateStore(), context: ctx });
    expect(r.alerts).toHaveLength(3);
    for (const a of r.alerts) {
      expect(findForbidden(a.payload as Record<string, unknown>)).toEqual([]);
    }
  });

  test('a secret-looking deployId fails loud — payload cannot leak', async () => {
    const source = new FixtureEvidenceSource(ev({ dlq: { n: 1, newest: '2026-06-21T11:59:00Z' } }));
    await expect(
      runPoll({ source, store: new InMemoryStateStore(), context: { now: ctx.now, environment: 'dev', deployId: 'https://leak.example/secret' } }),
    ).rejects.toThrow(ForbiddenFieldError);
  });
});

describe('poller — SqlEvidenceSource (DB-fetch wiring, offline runner)', () => {
  /** A fixture runner returning one row per query from a small spec. No DB, no network. */
  function fixtureRunner(spec: { dlqN?: number; dlqNewest?: string | null; qfN?: number; qfNewest?: string | null; stuckN?: number }): ReadonlyRunner {
    return (q: ReadonlyQuery): ReadonlyRow[] => {
      switch (q.name) {
        case 'dlq_since':
          return [{ n: spec.dlqN ?? 0, newest: spec.dlqNewest ?? null }];
        case 'queue_failed_since':
          return [{ n: spec.qfN ?? 0, newest: spec.qfNewest ?? null }];
        case 'stuck_trades':
          return [{ n: spec.stuckN ?? 0 }];
        default:
          return [{}];
      }
    };
  }

  test('maps query rows into evidence and fires the right alerts', async () => {
    const source = new SqlEvidenceSource({ runner: fixtureRunner({ dlqN: 1, dlqNewest: '2026-06-21T11:59:00Z', stuckN: 4 }) });
    const r = await runPoll({ source, store: new InMemoryStateStore(), context: ctx });
    expect(r.alerts.map((a) => a.signal).sort()).toEqual(['dlq', 'stuck']);
    expect(r.alerts.find((a) => a.signal === 'stuck')!.payload).toMatchObject({ table: 'trades', count: 4, age_seconds: 300 });
  });

  test('only issues read-only SELECTs, for exactly the three alert queries', async () => {
    const seen: ReadonlyQuery[] = [];
    const runner: ReadonlyRunner = (q) => {
      seen.push(q);
      return q.name === 'stuck_trades' ? [{ n: 0 }] : [{ n: 0, newest: null }];
    };
    await runPoll({ source: new SqlEvidenceSource({ runner }), store: new InMemoryStateStore(), context: ctx });
    expect(seen.map((q) => q.name).sort()).toEqual(['dlq_since', 'queue_failed_since', 'stuck_trades']);
    for (const q of seen) expect(isReadOnlySelect(q.sql)).toBe(true);
  });

  test('binds prior watermarks as query params (EPOCH on first run, prev thereafter)', async () => {
    const calls: { name: string; params: ReadonlyArray<string | number> }[] = [];
    const runner: ReadonlyRunner = (q, params) => {
      calls.push({ name: q.name, params: [...params] });
      return q.name === 'stuck_trades' ? [{ n: 0 }] : [{ n: 0, newest: null }];
    };

    // first run: no prior state → EPOCH watermark bound
    await runPoll({ source: new SqlEvidenceSource({ runner }), store: new InMemoryStateStore(), context: ctx });
    expect(calls.find((c) => c.name === 'dlq_since')!.params[0]).toBe(EPOCH_WATERMARK);
    expect(calls.find((c) => c.name === 'queue_failed_since')!.params[0]).toBe(EPOCH_WATERMARK);
    expect(calls.find((c) => c.name === 'stuck_trades')!.params[0]).toBe(300);

    // with prior state → the stored watermark is bound
    calls.length = 0;
    const store = new InMemoryStateStore({ dlqWatermark: '2026-06-21T11:00:00Z', queueFailedWatermark: '2026-06-21T10:00:00Z', stuckActive: false });
    await runPoll({ source: new SqlEvidenceSource({ runner }), store, context: ctx });
    expect(calls.find((c) => c.name === 'dlq_since')!.params[0]).toBe('2026-06-21T11:00:00Z');
    expect(calls.find((c) => c.name === 'queue_failed_since')!.params[0]).toBe('2026-06-21T10:00:00Z');
  });

  test('fails loud on a malformed row (missing numeric column) → PollerError', async () => {
    const runner: ReadonlyRunner = (q) =>
      q.name === 'dlq_since' ? [{ newest: '2026-06-21T11:59:00Z' }] : q.name === 'stuck_trades' ? [{ n: 0 }] : [{ n: 0, newest: null }];
    await expect(runPoll({ source: new SqlEvidenceSource({ runner }), store: new InMemoryStateStore(), context: ctx })).rejects.toThrow(PollerError);
  });

  test('fails loud when a query does not return exactly one row → PollerError', async () => {
    const runner: ReadonlyRunner = () => [];
    await expect(runPoll({ source: new SqlEvidenceSource({ runner }), store: new InMemoryStateStore(), context: ctx })).rejects.toThrow(PollerError);
  });

  test('fails loud on a MISSING timestamp column (newest absent ≠ null) → PollerError', async () => {
    // dlq_since returns a row with no `newest` column — a broken query shape, not "no new rows".
    const runner: ReadonlyRunner = (q) =>
      q.name === 'dlq_since' ? [{ n: 0 }] : q.name === 'stuck_trades' ? [{ n: 0 }] : [{ n: 0, newest: null }];
    await expect(runPoll({ source: new SqlEvidenceSource({ runner }), store: new InMemoryStateStore(), context: ctx })).rejects.toThrow(PollerError);
  });
});

describe('PollerError — does not retain or expose a raw cause', () => {
  const SECRET = 'sk_live_pollererr_SECRET_777';

  test('keeps only a safe causeName; the raw cause never leaks through any surface', () => {
    const e = new PollerError(`boom ${SECRET}`, new Error(`underlying ${SECRET}`));

    // raw cause is not retained; only the type label is kept
    expect((e as unknown as { cause?: unknown }).cause).toBeUndefined();
    expect(e.causeName).toBe('Error');

    const util = require('util') as typeof import('util');
    const surfaces: string[] = [
      e.message,
      String(e),
      JSON.stringify(e),
      util.inspect(e, { depth: null }),
    ];
    for (const k of Object.getOwnPropertyNames(e)) {
      const v = (e as unknown as Record<string, unknown>)[k];
      surfaces.push(typeof v === 'string' ? v : JSON.stringify(v ?? ''));
    }
    // the underlying cause's secret message must appear in NONE of them
    for (const s of surfaces) expect(s).not.toContain('underlying ' + SECRET);
  });

  test('a non-Error cause is reduced to its primitive type, never its value', () => {
    const e = new PollerError('bad', { token: SECRET });
    expect((e as unknown as { cause?: unknown }).cause).toBeUndefined();
    expect(e.causeName).toBe('object');
    expect(JSON.stringify(e)).not.toContain(SECRET);
    const util = require('util') as typeof import('util');
    expect(util.inspect(e, { depth: null })).not.toContain(SECRET);
  });
});
