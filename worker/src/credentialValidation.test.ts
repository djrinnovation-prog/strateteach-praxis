import {
  startCredentialValidation,
  CREDENTIAL_VALIDATION_QUEUE,
  VALIDATION_INTERVAL_MS_DEFAULT,
  VALIDATION_VISIBILITY_TIMEOUT_S,
  type ValidationAdapterFactory,
} from './credentialValidation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ExchangeAuthError, ExchangeTimeoutError, VaultSecretNotFoundError } from './types'

const okInterval = () => jest.fn().mockReturnValue({ unref: jest.fn() })
const VALID_VAULT = '11111111-2222-3333-4444-555555555555'

// Adapter stub that DOES expose an order method (like the real BinanceAdapter). The safety tests assert
// the validation module NEVER calls createOrder on ANY path — proving the property on a realistic adapter,
// not on a stub that trivially lacks the method.
function makeAdapter(fetchBalance: jest.Mock) {
  return { fetchBalance, createOrder: jest.fn(), cancelOrder: jest.fn() }
}

interface SupaOpts {
  read?: { data: unknown; error: unknown }
  bot?: unknown; botErr?: unknown
  cred?: unknown; credErr?: unknown
  exchange?: unknown; exErr?: unknown
  updateResult?: { data: unknown; error: unknown }
}

function makeSupabase(opts: SupaOpts) {
  const calls = {
    rpc: [] as Array<{ name: string; params: any }>,
    updates: [] as Array<{ table: string; obj: any }>,
    inserts: [] as Array<{ table: string; obj: any }>,
  }
  const from = (table: string) => {
    const state: { updated: any; inserted: any } = { updated: null, inserted: null }
    const q: any = {}
    const cont = () => q
    q.select = jest.fn(cont)
    q.eq = jest.fn(cont)
    q.is = jest.fn(cont)
    q.in = jest.fn(cont)
    q.order = jest.fn(cont)
    q.update = jest.fn((obj: any) => { state.updated = obj; calls.updates.push({ table, obj }); return q })
    q.insert = jest.fn((obj: any) => { state.inserted = obj; calls.inserts.push({ table, obj }); return Promise.resolve({ error: null }) })
    const resolve = () => {
      if (table === 'bots') return { data: opts.bot ?? null, error: opts.botErr ?? null }
      if (table === 'exchanges') return { data: opts.exchange ?? null, error: opts.exErr ?? null }
      if (table === 'audit_logs') return { error: null }
      if (table === 'user_exchange_credentials') {
        if (state.updated) return opts.updateResult ?? { data: [{ id: 'cred-1' }], error: null }
        return { data: opts.cred ?? null, error: opts.credErr ?? null }
      }
      return { data: null, error: null }
    }
    q.maybeSingle = jest.fn(() => Promise.resolve(resolve()))
    q.then = (onF: any, onR: any) => Promise.resolve(resolve()).then(onF, onR)
    return q
  }
  const rpc = jest.fn((name: string, params: any) => {
    calls.rpc.push({ name, params })
    if (name === 'pgmq_read') return Promise.resolve(opts.read ?? { data: [], error: null })
    return Promise.resolve({ data: true, error: null }) // pgmq_delete
  })
  return { client: { from, rpc } as unknown as SupabaseClient, calls }
}

// A well-formed validate message on the dedicated queue.
const goodMsg = (over: Record<string, unknown> = {}) => ({
  data: [{ msg_id: 42, read_ct: 1, message: {
    schema_version: '1.0', kind: 'validate_credential',
    bot_id: 'bot-1', credential_id: 'cred-1', request_id: 'req-1', ...over,
  } }],
  error: null,
})
const bot = { id: 'bot-1', credential_id: 'cred-1', user_id: 'user-1' }
const cred = (over: Record<string, unknown> = {}) => ({
  vault_secret_id: VALID_VAULT, status: 'pending_validation', deleted_at: null,
  exchange_environment: 'testnet', user_id: 'user-1', exchange_id: 'ex-1', ...over,
})
const binance = { ccxt_id: 'binance', is_active: true }

const baseOpts = (fetchBalance: jest.Mock, over: SupaOpts = {}): SupaOpts => ({
  read: goodMsg(), bot, cred: cred(), exchange: binance, ...over,
})
const startWith = (supa: SupabaseClient, factory: ValidationAdapterFactory) =>
  startCredentialValidation({
    supabase: supa, enabled: true, isProduction: false,
    egress: { proxy: null, nativeAllowed: false },
    adapterFactory: factory, setIntervalImpl: okInterval(),
  })

describe('startCredentialValidation (M8-validate)', () => {
  afterEach(() => jest.restoreAllMocks())

  test('disabled (default OFF): no timer, validateOnce is a no-op, stop is safe', async () => {
    const setIntervalImpl = jest.fn()
    const { client } = makeSupabase({})
    const rpcSpy = (client.rpc as unknown as jest.Mock)
    const h = startCredentialValidation({ supabase: client, enabled: false, isProduction: false, setIntervalImpl })
    expect(setIntervalImpl).not.toHaveBeenCalled()
    await h.validateOnce()
    expect(rpcSpy).not.toHaveBeenCalled()
    expect(() => h.stop()).not.toThrow()
  })

  test('enabled: schedules an unref\'d interval at the configured cadence + queue', () => {
    const unref = jest.fn()
    const setIntervalImpl = jest.fn().mockReturnValue({ unref })
    const { client } = makeSupabase({})
    startCredentialValidation({ supabase: client, enabled: true, isProduction: false, setIntervalImpl })
    expect(setIntervalImpl).toHaveBeenCalledTimes(1)
    expect(setIntervalImpl.mock.calls[0][1]).toBe(VALIDATION_INTERVAL_MS_DEFAULT)
    expect(unref).toHaveBeenCalledTimes(1)
  })

  test('empty queue: reads with the right VT, does nothing else', async () => {
    const { client, calls } = makeSupabase({ read: { data: [], error: null } })
    const factory = jest.fn()
    const h = startWith(client, factory as unknown as ValidationAdapterFactory)
    await h.validateOnce()
    const read = calls.rpc.find(c => c.name === 'pgmq_read')!
    expect(read.params).toEqual({ queue_name: CREDENTIAL_VALIDATION_QUEUE, vt: VALIDATION_VISIBILITY_TIMEOUT_S, qty: 1 })
    expect(factory).not.toHaveBeenCalled()
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(false)
  })

  test('HAPPY PATH: fetchBalance succeeds → credential status set to valid + audited + message acked', async () => {
    const fetchBalance = jest.fn().mockResolvedValue({ USDT: { free: 100, used: 0, total: 100 } })
    const adapter = makeAdapter(fetchBalance)
    const factory = jest.fn().mockReturnValue(adapter)
    const { client, calls } = makeSupabase(baseOpts(fetchBalance))
    const h = startWith(client, factory)
    await h.validateOnce()

    expect(fetchBalance).toHaveBeenCalledTimes(1)
    // status → valid
    const upd = calls.updates.find(u => u.table === 'user_exchange_credentials')
    expect(upd?.obj).toEqual({ status: 'valid' })
    // audited
    expect(calls.inserts.some(i => i.table === 'audit_logs' && i.obj.event_type === 'credential.validated')).toBe(true)
    // acked (deleted) with the right msg_id
    const del = calls.rpc.find(c => c.name === 'pgmq_delete')
    expect(del?.params).toEqual({ queue_name: CREDENTIAL_VALIDATION_QUEUE, msg_id: 42 })
    // SAFETY: validation NEVER placed/cancelled an order, even though the adapter exposes those methods.
    expect(adapter.createOrder).not.toHaveBeenCalled()
    expect(adapter.cancelOrder).not.toHaveBeenCalled()
    // audit carries no secret
    const auditRow = calls.inserts.find(i => i.table === 'audit_logs')!.obj
    expect(JSON.stringify(auditRow)).not.toContain(VALID_VAULT)
  })

  test('INVALID key: ExchangeAuthError → status set to invalid + audited + acked', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new ExchangeAuthError())
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    const { client, calls } = makeSupabase(baseOpts(fetchBalance))
    const h = startWith(client, factory)
    await h.validateOnce()
    expect(calls.updates.find(u => u.table === 'user_exchange_credentials')?.obj).toEqual({ status: 'invalid' })
    expect(calls.inserts.some(i => i.obj.event_type === 'credential.validation_failed')).toBe(true)
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true) // terminal → acked
  })

  test('missing Vault secret: VaultSecretNotFoundError → status invalid + acked', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new VaultSecretNotFoundError())
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    const { client, calls } = makeSupabase(baseOpts(fetchBalance))
    await startWith(client, factory).validateOnce()
    expect(calls.updates.find(u => u.table === 'user_exchange_credentials')?.obj).toEqual({ status: 'invalid' })
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true)
  })

  test('TRANSIENT: ExchangeTimeoutError → status UNTOUCHED + NOT acked (retry via VT) + NO order', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new ExchangeTimeoutError())
    const adapter = makeAdapter(fetchBalance)
    const factory = jest.fn().mockReturnValue(adapter)
    const { client, calls } = makeSupabase(baseOpts(fetchBalance))
    await startWith(client, factory).validateOnce()
    expect(calls.updates.length).toBe(0)          // no status change
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(false) // left on the queue
    expect(adapter.createOrder).not.toHaveBeenCalled()
  })

  test('INVALID key ALSO disarms any armed bot on that credential (defense-in-depth)', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new ExchangeAuthError())
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    const { client, calls } = makeSupabase(baseOpts(fetchBalance))
    await startWith(client, factory).validateOnce()
    const disarm = calls.updates.find(u => u.table === 'bots')
    expect(disarm?.obj).toEqual({ trading_enabled: false, status: 'paused' })
  })

  test('DB error writing the VALID verdict → NOT acked (retry, verdict not lost)', async () => {
    const fetchBalance = jest.fn().mockResolvedValue({})
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    // status write returns a DB error; read_ct=1 (< cap) → must retry, not drop the result
    const { client, calls } = makeSupabase(baseOpts(fetchBalance, { updateResult: { data: null, error: { code: 'XX000' } } }))
    await startWith(client, factory).validateOnce()
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(false) // left on the queue → retried
    expect(calls.inserts.some(i => i.table === 'audit_logs')).toBe(false) // no audit on a failed write
  })

  test('DB error writing the INVALID verdict → NOT acked (retry, verdict not lost, no disarm)', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new ExchangeAuthError())
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    const { client, calls } = makeSupabase(baseOpts(fetchBalance, { updateResult: { data: null, error: { code: 'XX000' } } }))
    await startWith(client, factory).validateOnce()
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(false)       // retried
    expect(calls.inserts.some(i => i.table === 'audit_logs')).toBe(false)   // no audit on failed write
    expect(calls.updates.some(u => u.table === 'bots')).toBe(false)         // no disarm off an unwritten verdict
  })

  test('setStatus nomatch (0 rows, e.g. deleted mid-flight) → acked, NO audit, NO disarm', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new ExchangeAuthError())
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    // update matched 0 rows (credential deleted/out-of-band) → 'nomatch'
    const { client, calls } = makeSupabase(baseOpts(fetchBalance, { updateResult: { data: [], error: null } }))
    await startWith(client, factory).validateOnce()
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true)        // terminal → acked
    expect(calls.inserts.some(i => i.table === 'audit_logs')).toBe(false)   // nothing changed → no audit
    expect(calls.updates.some(u => u.table === 'bots')).toBe(false)         // nothing changed → no disarm
  })

  test('WORKER env guard: mainnet credential on a testnet worker → NO adapter, status untouched, acked', async () => {
    const factory = jest.fn()
    const { client, calls } = makeSupabase(baseOpts(jest.fn(), { cred: cred({ exchange_environment: 'mainnet' }) }))
    await startWith(client, factory as unknown as ValidationAdapterFactory).validateOnce()
    expect(factory).not.toHaveBeenCalled()        // env mismatch blocks before the adapter
    expect(calls.updates.length).toBe(0)          // never mark the user's key invalid for an env fault
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true)
  })

  test('DEAD-LETTER cap: a persistently-transient message is given up (acked) after MAX attempts', async () => {
    const fetchBalance = jest.fn().mockRejectedValue(new ExchangeTimeoutError())
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    const read = { data: [{ msg_id: 99, read_ct: 5, message: {
      schema_version: '1.0', kind: 'validate_credential', bot_id: 'bot-1', credential_id: 'cred-1', request_id: 'req-x',
    } }], error: null }
    const { client, calls } = makeSupabase({ read, bot, cred: cred(), exchange: binance })
    await startWith(client, factory).validateOnce()
    expect(calls.updates.length).toBe(0)                                  // status untouched (infra fault, not a bad key)
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true)      // given up → removed
  })

  test('OWNERSHIP mismatch: cred.user_id != bot.user_id → NO adapter, NO status change, acked', async () => {
    const factory = jest.fn()
    const { client, calls } = makeSupabase(baseOpts(jest.fn(), { cred: cred({ user_id: 'someone-else' }) }))
    await startWith(client, factory as unknown as ValidationAdapterFactory).validateOnce()
    expect(factory).not.toHaveBeenCalled()        // never built an adapter for a cross-user credential
    expect(calls.updates.length).toBe(0)
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true) // dropped (no retry loop)
  })

  test('VENUE gate: exchange inactive → NO adapter, NO status change, acked', async () => {
    const factory = jest.fn()
    const { client, calls } = makeSupabase(baseOpts(jest.fn(), { exchange: { ccxt_id: 'binance', is_active: false } }))
    await startWith(client, factory as unknown as ValidationAdapterFactory).validateOnce()
    expect(factory).not.toHaveBeenCalled()
    expect(calls.updates.length).toBe(0)
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true)
  })

  test('STALE request: bot now points at a different credential → NO adapter, NO status change, acked', async () => {
    const factory = jest.fn()
    const { client, calls } = makeSupabase(baseOpts(jest.fn(), { bot: { ...bot, credential_id: 'other-cred' } }))
    await startWith(client, factory as unknown as ValidationAdapterFactory).validateOnce()
    expect(factory).not.toHaveBeenCalled()
    expect(calls.updates.length).toBe(0)
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(true)
  })

  test('MALFORMED message (missing kind) → dropped (acked), no adapter, no status change', async () => {
    const factory = jest.fn()
    const read = { data: [{ msg_id: 7, read_ct: 1, message: { schema_version: '1.0', bot_id: 'b', credential_id: 'c' } }], error: null }
    const { client, calls } = makeSupabase({ read })
    await startWith(client, factory as unknown as ValidationAdapterFactory).validateOnce()
    expect(factory).not.toHaveBeenCalled()
    expect(calls.updates.length).toBe(0)
    const del = calls.rpc.find(c => c.name === 'pgmq_delete')
    expect(del?.params.msg_id).toBe(7)
  })

  test('infra fault reading the bot → transient (NOT acked), no status change', async () => {
    const factory = jest.fn()
    const { client, calls } = makeSupabase(baseOpts(jest.fn(), { bot: null, botErr: { code: 'XX000' } }))
    await startWith(client, factory as unknown as ValidationAdapterFactory).validateOnce()
    expect(factory).not.toHaveBeenCalled()
    expect(calls.rpc.some(c => c.name === 'pgmq_delete')).toBe(false)
  })

  test('never throws: a pgmq_read error is swallowed and logged once (throttled)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const client = {
      from: () => ({}),
      rpc: jest.fn().mockResolvedValue({ data: null, error: { code: 'BOOM' } }),
    } as unknown as SupabaseClient
    const h = startWith(client, jest.fn() as unknown as ValidationAdapterFactory)
    await expect(h.validateOnce()).resolves.toBeUndefined()
    await expect(h.validateOnce()).resolves.toBeUndefined()
    const errs = errSpy.mock.calls.filter(c => String(c[0]).includes('credential_validation_error'))
    expect(errs).toHaveLength(1)
  })

  test('in-flight guard: overlapping ticks never stack (no second queue read)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    // Gate fetchBalance so the first tick stays in-flight across the whole await chain.
    const fetchBalance = jest.fn().mockImplementation(() => gate.then(() => ({})))
    const factory = jest.fn().mockReturnValue(makeAdapter(fetchBalance))
    const { client, calls } = makeSupabase(baseOpts(fetchBalance))
    const h = startWith(client, factory)
    const first = h.validateOnce()
    const second = h.validateOnce() // must return immediately (inFlight) — NO second pgmq_read
    await second
    expect(calls.rpc.filter(c => c.name === 'pgmq_read')).toHaveLength(1)
    release()
    await first
    expect(fetchBalance).toHaveBeenCalledTimes(1)
    // guard released → a subsequent tick runs again
    await h.validateOnce()
    expect(calls.rpc.filter(c => c.name === 'pgmq_read')).toHaveLength(2)
  })

  test('stop clears the timer handle', () => {
    const handle = { unref: jest.fn() }
    const clearIntervalImpl = jest.fn()
    const { client } = makeSupabase({})
    const h = startCredentialValidation({
      supabase: client, enabled: true, isProduction: false,
      setIntervalImpl: jest.fn().mockReturnValue(handle), clearIntervalImpl,
    })
    h.stop()
    expect(clearIntervalImpl).toHaveBeenCalledWith(handle)
  })
})
