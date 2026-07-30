/**
 * workerStatus.test.ts — Operator Console worker-status writer (S5 Slice 1a).
 * Pure unit tests with injected supabase / timers / clock. No real DB, no network, no real timer.
 */
import { startWorkerStatus, WorkerStatusFields, WORKER_STATUS_INTERVAL_MS_DEFAULT } from './workerStatus'
import type { SupabaseClient } from '@supabase/supabase-js'

const ISO = '2026-06-30T12:00:00.000Z'

const FIELDS: WorkerStatusFields = {
  queueEnabled:   false,
  isProduction:   false,
  bootStuckCount: 0,
  workerState:    'disabled',
}

function makeSupabase(upsertResult: unknown = { error: null }) {
  const upsert = jest.fn().mockResolvedValue(upsertResult)
  const from   = jest.fn().mockReturnValue({ upsert })
  return { client: { from } as unknown as SupabaseClient, from, upsert }
}

/** Injected timer fakes — capture handler + interval; return an unref-able handle. */
function makeTimers() {
  const handle = { unref: jest.fn() }
  let captured: (() => void) | null = null
  const setIntervalImpl = jest.fn((h: () => void, _ms: number) => { captured = h; return handle })
  const clearIntervalImpl = jest.fn()
  return { handle, setIntervalImpl, clearIntervalImpl, fire: () => captured?.() }
}

let errSpy: jest.SpyInstance
beforeEach(() => { errSpy = jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks() })

describe('startWorkerStatus', () => {
  test('writes immediately on start with the exact payload + onConflict singleton', async () => {
    const sb = makeSupabase()
    const t  = makeTimers()
    const h  = startWorkerStatus({
      supabase: sb.client,
      fields: { queueEnabled: true, isProduction: false, bootStuckCount: 3, workerState: 'running' },
      setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO,
    })
    await h.writeOnce() // flush

    expect(sb.from).toHaveBeenCalledWith('worker_status')
    expect(sb.upsert).toHaveBeenCalledWith(
      {
        singleton:        true,
        queue_enabled:    true,
        is_production:    false,
        worker_state:     'running',
        boot_stuck_count: 3,
        updated_at:       ISO,
      },
      { onConflict: 'singleton' },
    )
  })

  test('payload carries NO secret fields (only operational flags/counts)', async () => {
    const sb = makeSupabase()
    const t  = makeTimers()
    startWorkerStatus({ supabase: sb.client, fields: FIELDS, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO })
    await Promise.resolve()
    const payload = sb.upsert.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(
      ['boot_stuck_count', 'is_production', 'queue_enabled', 'singleton', 'updated_at', 'worker_state'],
    )
    const blob = JSON.stringify(payload).toLowerCase()
    for (const bad of ['token', 'secret', 'service_role', 'vault', 'password', 'dsn', 'apikey', 'api_key']) {
      expect(blob).not.toContain(bad)
    }
  })

  test('starts an unref()\'d interval at the default cadence; stop() clears it AND writes stopping', async () => {
    const sb = makeSupabase()
    const t  = makeTimers()
    const h  = startWorkerStatus({ supabase: sb.client, fields: FIELDS, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO })

    expect(t.setIntervalImpl).toHaveBeenCalledWith(expect.any(Function), WORKER_STATUS_INTERVAL_MS_DEFAULT)
    expect(t.handle.unref).toHaveBeenCalledTimes(1)

    await h.stop()
    expect(t.clearIntervalImpl).toHaveBeenCalledWith(t.handle)
    // best-effort final write carries worker_state='stopping'
    const lastPayload = sb.upsert.mock.calls[sb.upsert.mock.calls.length - 1][0]
    expect(lastPayload.worker_state).toBe('stopping')
  })

  test('log throttle: only the first failure logs; a later success logs recovery', async () => {
    const upsert = jest.fn()
      .mockResolvedValueOnce({ error: null })             // initial write succeeds (no log)
      .mockResolvedValueOnce({ error: { code: 'PGRST205' } }) // 1st failure → logs once
      .mockResolvedValueOnce({ error: { code: 'PGRST205' } }) // 2nd failure → SUPPRESSED
      .mockResolvedValueOnce({ error: null })             // success → recovery log
    const from   = jest.fn().mockReturnValue({ upsert })
    const client = { from } as unknown as SupabaseClient
    const t      = makeTimers()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const h = startWorkerStatus({ supabase: client, fields: FIELDS, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO })
    await new Promise(r => setImmediate(r)) // let the initial write settle (success, no log)
    await h.writeOnce() // 1st failure → logs
    await h.writeOnce() // 2nd failure → suppressed
    await h.writeOnce() // success → recovery

    const errBlob = errSpy.mock.calls.flat().join(' ')
    expect((errBlob.match(/worker_status_write_error/g) ?? []).length).toBe(1) // logged exactly once
    expect(logSpy.mock.calls.flat().join(' ')).toContain('worker_status_write_recovered')
  })

  test('the interval handler triggers another write', async () => {
    const sb = makeSupabase()
    const t  = makeTimers()
    startWorkerStatus({ supabase: sb.client, fields: FIELDS, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO })
    await Promise.resolve()
    expect(sb.upsert).toHaveBeenCalledTimes(1) // initial
    t.fire()
    await Promise.resolve()
    expect(sb.upsert).toHaveBeenCalledTimes(2) // interval tick
  })

  test('non-fatal: a PostgREST error is logged, not thrown', async () => {
    const sb = makeSupabase({ error: { code: 'PGRST205' } }) // e.g. table missing before 015 applied
    const t  = makeTimers()
    const h  = startWorkerStatus({ supabase: sb.client, fields: FIELDS, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO })

    await expect(h.writeOnce()).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('worker_status_write_error'))
  })

  test('non-fatal: a thrown error is caught + logged by constructor name, not thrown', async () => {
    const upsert = jest.fn().mockRejectedValue(new TypeError('boom'))
    const from   = jest.fn().mockReturnValue({ upsert })
    const client = { from } as unknown as SupabaseClient
    const t      = makeTimers()
    const h      = startWorkerStatus({ supabase: client, fields: FIELDS, setIntervalImpl: t.setIntervalImpl, clearIntervalImpl: t.clearIntervalImpl, nowImpl: () => ISO })

    await expect(h.writeOnce()).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('worker_status_write_exception'))
    // constructor name only — no message ("boom") leaked
    expect(errSpy.mock.calls.flat().join(' ')).not.toContain('boom')
  })
})
