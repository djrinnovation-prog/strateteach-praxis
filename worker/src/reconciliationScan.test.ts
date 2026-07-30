import { startReconciliationScan, RECONCILIATION_SCAN_INTERVAL_MS_DEFAULT } from './reconciliationScan'
import type { SupabaseClient } from '@supabase/supabase-js'

const fakeSupabase = {} as SupabaseClient
const okInterval = () => jest.fn().mockReturnValue({ unref: jest.fn() })

describe('startReconciliationScan (S4-3b runtime reconciliation scan)', () => {
  afterEach(() => jest.restoreAllMocks())

  test('disabled (default OFF): no timer, scanOnce is a no-op, stop is safe', async () => {
    const resolveImpl = jest.fn().mockResolvedValue([])
    const setIntervalImpl = jest.fn()
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: false, isProduction: false,
      resolveImpl, setIntervalImpl,
    })
    expect(setIntervalImpl).not.toHaveBeenCalled()
    await h.scanOnce()
    expect(resolveImpl).not.toHaveBeenCalled()
    expect(() => h.stop()).not.toThrow()
  })

  test('enabled: schedules an unref\'d interval at the configured cadence', () => {
    const unref = jest.fn()
    const setIntervalImpl = jest.fn().mockReturnValue({ unref })
    startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: false,
      resolveImpl: jest.fn().mockResolvedValue([]), setIntervalImpl,
    })
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
    expect(setIntervalImpl.mock.calls[0][1]).toBe(RECONCILIATION_SCAN_INTERVAL_MS_DEFAULT)
    expect(unref).toHaveBeenCalledTimes(1) // must not keep the process alive on its own
  })

  test('scanOnce delegates to the resolver with the egress/production deps', async () => {
    const resolveImpl = jest.fn().mockResolvedValue([])
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: true,
      exchangeHttpsProxy: 'http://proxy:8080', nativeEgressAllowed: false,
      cap: 7, thresholdSeconds: 90,
      resolveImpl, setIntervalImpl: okInterval(),
    })
    await h.scanOnce()
    expect(resolveImpl).toHaveBeenCalledTimes(1)
    expect(resolveImpl).toHaveBeenCalledWith(fakeSupabase, {
      isProduction: true,
      exchangeHttpsProxy: 'http://proxy:8080',
      nativeEgressAllowed: false,
      cap: 7,
      thresholdSeconds: 90,
    })
  })

  test('clamps staleness threshold to ≥ visibility timeout + margin (invariant enforced in code)', async () => {
    const resolveImpl = jest.fn().mockResolvedValue([])
    // Operator raised visibility to 120 → effective threshold must exceed it (120 + 15),
    // NOT stay at the 60s default, or an in-flight message could be reconciled prematurely.
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: false,
      visibilityTimeoutS: 120,
      resolveImpl, setIntervalImpl: okInterval(),
    })
    await h.scanOnce()
    expect(resolveImpl.mock.calls[0][1].thresholdSeconds).toBe(135)
  })

  test('default 60s threshold wins when it already exceeds visibility + margin', async () => {
    const resolveImpl = jest.fn().mockResolvedValue([])
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: false,
      visibilityTimeoutS: 45, // 45 + 15 = 60 == default → not lowered below 60
      resolveImpl, setIntervalImpl: okInterval(),
    })
    await h.scanOnce()
    expect(resolveImpl.mock.calls[0][1].thresholdSeconds).toBe(60)
  })

  test('in-flight guard: overlapping ticks never stack (one resolver call at a time)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const resolveImpl = jest.fn().mockImplementation(() => gate)
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: false,
      resolveImpl, setIntervalImpl: okInterval(),
    })
    const first = h.scanOnce()   // starts, blocks on the gate
    const second = h.scanOnce()  // must return immediately — inFlight
    await second
    expect(resolveImpl).toHaveBeenCalledTimes(1)
    release()
    await first
    await h.scanOnce()           // guard released → runs again
    expect(resolveImpl).toHaveBeenCalledTimes(2)
  })

  test('never throws: a resolver rejection is swallowed and logged once (throttled)', async () => {
    const resolveImpl = jest.fn().mockRejectedValue(new Error('boom'))
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: false,
      resolveImpl, setIntervalImpl: okInterval(),
    })
    await expect(h.scanOnce()).resolves.toBeUndefined()
    await expect(h.scanOnce()).resolves.toBeUndefined()
    const scanErrors = errSpy.mock.calls.filter((c) => String(c[0]).includes('reconciliation_scan_error'))
    expect(scanErrors).toHaveLength(1) // first failure logs; repeats suppressed until recovery
  })

  test('stop clears the timer handle', () => {
    const handle = { unref: jest.fn() }
    const clearIntervalImpl = jest.fn()
    const h = startReconciliationScan({
      supabase: fakeSupabase, enabled: true, isProduction: false,
      resolveImpl: jest.fn().mockResolvedValue([]),
      setIntervalImpl: jest.fn().mockReturnValue(handle),
      clearIntervalImpl,
    })
    h.stop()
    expect(clearIntervalImpl).toHaveBeenCalledWith(handle)
  })

  test('default (no injected resolver) uses the real READ-ONLY resolver — first action is a SELECT on trades', async () => {
    // Guards the wiring: the scan must delegate to resolvePendingReconciliations, whose only
    // trade access is a read (`.from('trades').select(...)`). If a future change points the default
    // at anything that mutates or places orders, this expectation breaks.
    const chain = {
      in: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      is: jest.fn().mockResolvedValue({ data: [], error: null }),
    }
    const select = jest.fn().mockReturnValue(chain)
    const from = jest.fn().mockReturnValue({ select })
    const supa = { from } as unknown as SupabaseClient
    const h = startReconciliationScan({
      supabase: supa, enabled: true, isProduction: false,
      setIntervalImpl: okInterval(),
    })
    await h.scanOnce()
    expect(from).toHaveBeenCalledWith('trades')
    expect(select).toHaveBeenCalledTimes(1)
  })
})
