/**
 * webhookRequeueSweeper.test.ts — Slice 4C recovery sweeper unit tests.
 *
 * All I/O mocked — no network, no real Supabase, no exchange. Asserts:
 *   - claim -> per-row pgmq_send -> status='queued' (success) / last_requeue_error (failure)
 *   - disabled = no-op (no timer, no RPC)
 *   - claim error swallowed + throttled
 *   - invalid stored side never enqueued
 *   - exhausted count reported (observable), never dropped
 *   - correct claim params (batch/stale/max)
 *   - NO exchange call / only webhook_logs touched
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  startWebhookRequeueSweeper,
  WEBHOOK_REQUEUE_MAX_ATTEMPTS_DEFAULT,
} from './webhookRequeueSweeper'

interface Cfg {
  claim?: { data?: unknown; error?: { code: string } | null }
  send?: Array<{ error?: { code: string } | null }>
  exhaustedCount?: number
}

function makeSupabase(cfg: Cfg = {}) {
  const updateCalls: Array<{ payload: Record<string, unknown>; filters: Record<string, unknown> }> = []
  let sendIdx = 0

  const rpc = jest.fn((name: string, _params?: unknown) => {
    if (name === 'claim_webhook_requeue') return Promise.resolve(cfg.claim ?? { data: [], error: null })
    if (name === 'pgmq_send') return Promise.resolve(cfg.send?.[sendIdx++] ?? { error: null })
    return Promise.resolve({ data: null, error: null })
  })

  const fromTables: string[] = []
  const from = jest.fn((table: string) => {
    fromTables.push(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      _mode: 'update' as 'update' | 'count',
      _payload: undefined as unknown,
      _filters: {} as Record<string, unknown>,
      update(payload: Record<string, unknown>) { this._mode = 'update'; this._payload = payload; return this },
      select(_col: string, opts?: { count?: string; head?: boolean }) { this._mode = opts?.count ? 'count' : 'update'; return this },
      eq(k: string, v: unknown) { this._filters[k] = v; return this },
      in(k: string, v: unknown) { this._filters[`${k}__in`] = v; return this },
      gte(k: string, v: unknown) { this._filters[`${k}__gte`] = v; return this },
      then(resolve: (val: unknown) => void) {
        if (this._mode === 'count') { resolve({ count: cfg.exhaustedCount ?? 0, error: null }); return }
        updateCalls.push({ payload: this._payload as Record<string, unknown>, filters: this._filters })
        resolve({ error: null })
      },
    }
    return b
  })

  return { supabase: { rpc, from } as unknown as SupabaseClient, rpc, from, updateCalls, fromTables }
}

let errSpy: jest.SpyInstance
let logSpy: jest.SpyInstance
beforeEach(() => {
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { errSpy.mockRestore(); logSpy.mockRestore() })

describe('startWebhookRequeueSweeper', () => {
  test('disabled ⇒ no timer, sweepOnce is a no-op (no RPC)', async () => {
    const setIntervalImpl = jest.fn()
    const t = makeSupabase()
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: false, setIntervalImpl })
    const r = await h.sweepOnce()
    expect(r).toEqual({ claimed: 0, requeued: 0, failed: 0 })
    expect(t.rpc).not.toHaveBeenCalled()
    expect(setIntervalImpl).not.toHaveBeenCalled()
  })

  test('enabled ⇒ schedules an unref\'d interval; stop() clears it', () => {
    const handle = { unref: jest.fn() }
    const setIntervalImpl = jest.fn(() => handle)
    const clearIntervalImpl = jest.fn()
    const t = makeSupabase()
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl, clearIntervalImpl })
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
    expect(handle.unref).toHaveBeenCalledTimes(1)
    h.stop()
    expect(clearIntervalImpl).toHaveBeenCalledWith(handle)
  })

  test('claims + re-enqueues each row, flips to queued on success', async () => {
    const t = makeSupabase({
      claim: { data: [
        { bot_id: 'b1', signal_id: 's1', side: 'buy' },
        { bot_id: 'b2', signal_id: 's2', side: 'sell' },
      ], error: null },
      send: [{ error: null }, { error: null }],
    })
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl: jest.fn(() => ({ unref() {} })) })
    const r = await h.sweepOnce()
    expect(r).toEqual({ claimed: 2, requeued: 2, failed: 0 })
    // two pgmq_send calls with the correct wire shape
    const sends = t.rpc.mock.calls.filter(c => c[0] === 'pgmq_send')
    expect(sends).toHaveLength(2)
    expect(sends[0][1]).toEqual({ queue_name: 'trade_signals', message: { schema_version: '1.0', bot_id: 'b1', signal_id: 's1', side: 'buy' } })
    // both rows flipped to queued (CAS filter present)
    const queuedUpdates = t.updateCalls.filter(u => u.payload.status === 'queued')
    expect(queuedUpdates).toHaveLength(2)
    expect(queuedUpdates[0].filters['status__in']).toEqual(['queue_failed', 'accepted'])
  })

  test('pgmq_send failure ⇒ failed count + sanitized last_requeue_error, no queued flip', async () => {
    const t = makeSupabase({
      claim: { data: [{ bot_id: 'b1', signal_id: 's1', side: 'buy' }], error: null },
      send: [{ error: { code: 'PGRST_TIMEOUT' } }],
    })
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl: jest.fn(() => ({ unref() {} })) })
    const r = await h.sweepOnce()
    expect(r).toEqual({ claimed: 1, requeued: 0, failed: 1 })
    expect(t.updateCalls.some(u => u.payload.status === 'queued')).toBe(false)
    const errUpdate = t.updateCalls.find(u => 'last_requeue_error' in u.payload)
    expect(errUpdate?.payload.last_requeue_error).toBe('PGRST_TIMEOUT')
  })

  test('invalid stored side is never enqueued (marked invalid_action)', async () => {
    const t = makeSupabase({
      claim: { data: [{ bot_id: 'b1', signal_id: 's1', side: 'HOLD' }], error: null },
    })
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl: jest.fn(() => ({ unref() {} })) })
    const r = await h.sweepOnce()
    expect(r).toEqual({ claimed: 1, requeued: 0, failed: 1 })
    expect(t.rpc.mock.calls.some(c => c[0] === 'pgmq_send')).toBe(false)
    expect(t.updateCalls.find(u => 'last_requeue_error' in u.payload)?.payload.last_requeue_error).toBe('invalid_action')
  })

  test('claim RPC error is swallowed + throttled; returns zeros', async () => {
    const t = makeSupabase({ claim: { data: null, error: { code: 'PGRST500' } } })
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl: jest.fn(() => ({ unref() {} })) })
    const r = await h.sweepOnce()
    expect(r).toEqual({ claimed: 0, requeued: 0, failed: 0 })
    expect(errSpy).toHaveBeenCalledTimes(1) // first failure logged
    await h.sweepOnce()
    expect(errSpy).toHaveBeenCalledTimes(1) // repeat suppressed
  })

  test('exhausted rows are reported (observable), never dropped', async () => {
    const t = makeSupabase({ claim: { data: [], error: null }, exhaustedCount: 3 })
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl: jest.fn(() => ({ unref() {} })) })
    await h.sweepOnce()
    const exhausted = errSpy.mock.calls.map(c => JSON.parse(c[0] as string)).find(o => o.event === 'webhook_requeue_exhausted')
    expect(exhausted).toMatchObject({ count: 3, max_attempts: WEBHOOK_REQUEUE_MAX_ATTEMPTS_DEFAULT })
  })

  test('passes batch/stale/max params to the claim RPC', async () => {
    const t = makeSupabase()
    const h = startWebhookRequeueSweeper({
      supabase: t.supabase, enabled: true, batch: 7, staleSeconds: 90, maxAttempts: 4,
      setIntervalImpl: jest.fn(() => ({ unref() {} })),
    })
    await h.sweepOnce()
    const claim = t.rpc.mock.calls.find(c => c[0] === 'claim_webhook_requeue')
    expect(claim?.[1]).toEqual({ p_batch: 7, p_stale_seconds: 90, p_max_attempts: 4 })
  })

  test('touches ONLY webhook_logs + the two RPCs — no exchange / other table', async () => {
    const t = makeSupabase({
      claim: { data: [{ bot_id: 'b1', signal_id: 's1', side: 'buy' }], error: null },
      send: [{ error: null }],
    })
    const h = startWebhookRequeueSweeper({ supabase: t.supabase, enabled: true, setIntervalImpl: jest.fn(() => ({ unref() {} })) })
    await h.sweepOnce()
    // only these two RPCs
    for (const c of t.rpc.mock.calls) expect(['claim_webhook_requeue', 'pgmq_send']).toContain(c[0])
    // only the webhook_logs table
    for (const tbl of t.fromTables) expect(tbl).toBe('webhook_logs')
  })
})
