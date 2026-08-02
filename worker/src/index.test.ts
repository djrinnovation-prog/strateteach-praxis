/**
 * index.test.ts
 *
 * Unit tests for validateEnv and processMessage (worker/src/index.ts).
 *
 * Test matrix:
 *   validateEnv
 *     returns supabaseUrl, serviceRoleKey, isProduction when all vars set
 *     isProduction=true when PRAXIS_IS_PRODUCTION="true"
 *     isProduction=false when PRAXIS_IS_PRODUCTION="false"
 *     logs DOPPLER_ENVIRONMENT name when set (not a secret)
 *     does NOT exit when DOPPLER_ENVIRONMENT absent — Railway-safe
 *     logs startup_env with environment=unknown when DOPPLER_ENVIRONMENT absent
 *     exits(1) + missing_env_vars when SUPABASE_URL absent
 *     exits(1) + missing_env_vars when SUPABASE_SERVICE_ROLE_KEY absent
 *     exits(1) + missing_env_vars when PRAXIS_IS_PRODUCTION absent
 *     exits(1) + invalid_env_var when PRAXIS_IS_PRODUCTION is not "true"|"false"
 *     never logs SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY values
 *
 *   Step 3.5 — unknown trade guard
 *     returns ack=false when an unresolved unknown trade exists for this bot
 *     does not insert a trade or call createOrder when blocked
 *
 *   Step 2.5 — null credential guard
 *     disables bot and returns ack=true when credential_id is null
 *
 *   Step 4a — credential resolution (F-01)
 *     happy: queried by credential_id, adapter receives vault_secret_id
 *     regression guard: adapter NEVER receives the credentials row id
 *     missing / deleted / not-valid row → bot error, credential untouched, ack
 *     malformed / empty vault_secret_id → bot error (config fault), ack
 *     credential fetch infra error → ack=false, zero writes
 *
 *   Branch 1 — ExchangeAuthError in createOrder
 *     marks trade failed, DLQ inserted, credential+bot disabled, ack=true
 *     does NOT increment consecutive_failures (no threshold)
 *
 *   Branch 1 — VaultSecretNotFoundError in createOrder
 *     marks trade failed, DLQ inserted, credential+bot disabled, ack=true
 *     does NOT increment consecutive_failures
 *
 *   Branch 1 — auth error in fetchBalance (SELL, Step 6)
 *     VaultSecretNotFoundError: disables credential+bot, ack=true, no trade created
 *     ExchangeAuthError: disables credential+bot, ack=true, no trade created
 *
 *   Branch 3 — Option B inline fetchOrder
 *     Case A: createOrder timeout → fetchOrder filled → trade filled, ack=true
 *     Case A (failures>0): resets consecutive_failures on inline-resolved fill
 *     Case B (H-5): createOrder timeout → fetchOrder null → trade UNKNOWN + recon_job (not terminal failed), ack=true
 *     Case C: createOrder timeout → fetchOrder timeout → trade unknown + recon_job, ack=true
 *
 *   ENG-008 — circuit breaker reset
 *     does NOT reset consecutive_failures when order resolves as cancelled
 *     resets consecutive_failures to 0 when order resolves as filled
 *
 *   DLQ insert failure
 *     logs dlq_insert_error safely and returns ack=true — non-fatal
 *
 * Mock strategy:
 *   - jest.mock('./BinanceAdapter'), jest.mock('./VaultSecretsProvider')
 *   - Supabase: position-ordered queue via makeSupabase() — throws "queue exhausted"
 *     if more from() calls are made than chains provided, acting as an implicit
 *     assertion that no unexpected DB calls occurred.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { processMessage, validateEnv, preflightQueue, pollOnce, runWorker } from './index'
import type { PgmqMessage } from './index'
import { BinanceAdapter } from './BinanceAdapter'
import {
  ExchangeAuthError,
  ExchangeTimeoutError,
  ExchangeUnavailableError,
  VaultSecretNotFoundError,
} from './types'

jest.mock('./BinanceAdapter')
jest.mock('./VaultSecretsProvider')

// ─── Supabase mock helpers ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Chain = Record<string, any>
type ChainResult = { data: unknown; error: unknown; count?: number | null }

/**
 * Creates a mock Supabase query chain that is:
 *   - Chainable: all builder methods (select, insert, update, upsert, eq, is, …)
 *     return `this` so arbitrary method chains compile and execute.
 *   - Thenable: .then/.catch/.finally forward to an internal Promise that resolves
 *     to `result` — supports direct `await supabase.from(…).update(…).eq(…)`.
 *   - Terminal: .single() and .maybeSingle() resolve to `result` separately —
 *     supports `await …single()` destructuring patterns.
 */
function sbChain(result: ChainResult): Chain {
  const p = Promise.resolve(result)
  const chain: Chain = {}
  const self = (): Chain => chain
  chain.select      = jest.fn().mockImplementation(self)
  chain.insert      = jest.fn().mockImplementation(self)
  chain.update      = jest.fn().mockImplementation(self)
  chain.upsert      = jest.fn().mockImplementation(self)
  chain.delete      = jest.fn().mockImplementation(self)
  chain.eq          = jest.fn().mockImplementation(self)
  chain.is          = jest.fn().mockImplementation(self)
  chain.in          = jest.fn().mockImplementation(self)
  chain.or          = jest.fn().mockImplementation(self)
  chain.lt          = jest.fn().mockImplementation(self)
  chain.gte         = jest.fn().mockImplementation(self)
  chain.single      = jest.fn().mockResolvedValue(result)
  chain.maybeSingle = jest.fn().mockResolvedValue(result)
  chain.then        = p.then.bind(p)
  chain.catch       = p.catch.bind(p)
  chain.finally     = p.finally.bind(p)
  return chain
}

/** Successful no-data response — the common case for insert/update/upsert. */
const sbOk = (data: unknown = null): Chain => sbChain({ data, error: null })

/** Failed response with a Postgres error code. */
const sbErr = (code: string): Chain => sbChain({ data: null, error: { code } })

/** Count query response (Step 3.5). */
const sbCount = (n: number | null, hasError = false): Chain =>
  sbChain({ count: n, data: null, error: hasError ? { code: 'COUNT_ERR' } : null })

/**
 * Creates a Supabase mock whose from() method pops chains from a FIFO queue.
 * Throws a descriptive error if from() is called more times than chains were
 * provided — this acts as an assertion that no unexpected DB calls occurred.
 */
function makeSupabase(...chains: Chain[]): SupabaseClient {
  const queue = [...chains]
  const from  = jest.fn().mockImplementation((): Chain => {
    const c = queue.shift()
    if (!c) throw new Error('supabase.from() called more times than expected — queue exhausted')
    return c
  })
  // H-2: processMessage reserves the pending trade via rpc('insert_pending_trade_atomic'). Default to a
  // SUCCESSFUL reservation (returns TRADE_ID) so happy paths reach createOrder; blocked/rejection tests
  // override via rpcOf(supabase).mockResolvedValue(...). A table-returning fn yields an array of rows.
  const rpc = jest.fn().mockResolvedValue({ data: [{ trade_id: TRADE_ID, rejected_reason: null }], error: null })
  return { from, rpc } as unknown as SupabaseClient
}

/** The reservation rpc mock on a makeSupabase() client (for arg assertions / overrides). */
const rpcOf = (supabase: SupabaseClient): jest.Mock => (supabase as unknown as { rpc: jest.Mock }).rpc
/** RPC result shapes for insert_pending_trade_atomic. */
const reserveOk = (tradeId = TRADE_ID) => ({ data: [{ trade_id: tradeId, rejected_reason: null }], error: null })
const reserveRejected = (reason: string) => ({ data: [{ trade_id: null, rejected_reason: reason }], error: null })
const reserveRpcError = (code = 'PGRST202') => ({ data: null, error: { code } })

// ─── BinanceAdapter mock ──────────────────────────────────────────────────────

const MockAdapter = BinanceAdapter as jest.MockedClass<typeof BinanceAdapter>

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BOT_ID    = 'bot-uuid-0001'
const SIGNAL_ID = 'sig-uuid-0002'
const TRADE_ID  = 'trade-uuid-0003'
const CRED_ID   = 'cred-uuid-0004'

/** Vault pointer — must satisfy UUID_RE (F-01); deliberately ≠ CRED_ID. */
const VAULT_SECRET_ID = '7e57ed00-aaaa-bbbb-cccc-123456789abc'

/** Default healthy credential row returned by the Step 4a resolution (F-01). */
const EXCHANGE_ID = 'exch-uuid-binance'
const VALID_CRED = {
  vault_secret_id:      VAULT_SECRET_ID,
  status:               'valid',
  deleted_at:           null,
  exchange_environment: 'testnet',   // matches the test default isProduction=false (testnet sandbox)
  user_id:              'user-uuid-0005',   // A8-H3 W1: matches DEFAULT_BOT.user_id (owned by the bot's user)
  exchange_id:          EXCHANGE_ID,  // EP1b: FK to exchanges — resolved + gated in Step 4a.6
}
// EP1b: the exchanges-row lookup result for Step 4a.6. Active + binance ⇒ both fail-closed gates pass.
const VALID_EXCHANGE = { ccxt_id: 'binance', is_active: true }

const DEFAULT_BOT = {
  id:                   BOT_ID,
  user_id:              'user-uuid-0005',
  credential_id:        CRED_ID,
  trading_pair:         'BTCUSDT',
  account_type:         'spot',
  status:               'active',
  consecutive_failures: 0,
  // S5-A3/B4 sizing + risk config — fully configured + enabled by default (happy path)
  sizing_mode:             'percent_of_balance',
  position_size_pct:       10,
  fixed_notional_usdt:     null,
  max_order_notional_usdt: 1_000,
  daily_notional_cap_usdt: 5_000,
  trading_enabled:         true,
  sell_enabled:            false,
  sell_size_pct:           null,
}

const DEFAULT_MARKET_RULES = {
  symbol:         'BTC/USDT',   // ccxt unified — always slash-separated (ENG-009)
  minNotional:    10,
  stepSize:       0.00001,
  minQty:         0.00001,
  pricePrecision: 2,
  qtyPrecision:   5,
}

const DEFAULT_BALANCE = {
  BTC:  { free: 0.1,  used: 0, total: 0.1  },
  USDT: { free: 1000, used: 0, total: 1000 },
}

/** Default live BUY price (USDT). 10% of 1000 USDT free = 100 notional → 100/50000 = 0.002 BTC. */
const BUY_PRICE = 50_000

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id:            'ex-order-id-001',
    clientOrderId: 'PRX_testorder01',
    symbol:        'BTC/USDT',
    side:          'buy',
    type:          'market',
    status:        'filled',
    quantity:      0.00015,
    filled:        0.00015,
    price:         65000,
    cost:          9.75,
    timestamp:     1748736000000,
    ...overrides,
  }
}

function makeMsg(
  overrides: Partial<{ schema_version: string; bot_id: string; signal_id: string; side: 'buy' | 'sell' }> = {}
): PgmqMessage {
  return {
    msg_id:  42,
    read_ct: 1,   // pgmq: 1 = first delivery (WB7 redelivery counter)
    message: { schema_version: '1.0', bot_id: BOT_ID, signal_id: SIGNAL_ID, side: 'buy', ...overrides },
  }
}

// ─── from() chain prefixes ────────────────────────────────────────────────────

/**
 * Returns the 5 from() chains for Steps 1 – 7a of a BUY path that successfully reaches createOrder.
 * H-2: the daily-cap query and the pending INSERT are gone — reservation is a single rpc call
 * (`insert_pending_trade_atomic`), which makeSupabase() mocks as a SUCCESSFUL reservation by default.
 *   1.  bots.single()                → DEFAULT_BOT (+ botOverrides)
 *   2.  trades.maybeSingle()         → null (no existing trade for this signal)
 *   3.  trades count (Step 3.5)      → 0   (no unresolved unknowns)
 *   4.  credentials.maybeSingle()    → VALID_CRED (Step 4a — F-01)
 *   [rpc insert_pending_trade_atomic → { trade_id: TRADE_ID } — default success from makeSupabase]
 *   5.  audit_logs.insert            → null (trade.created)
 */
function buyPrefix(botOverrides: Partial<typeof DEFAULT_BOT> = {}): Chain[] {
  return [
    sbChain({ data: { ...DEFAULT_BOT, ...botOverrides }, error: null }), // 1. bots
    sbChain({ data: null, error: null }),                                 // 2. trades maybeSingle
    sbCount(0),                                                          // 3. trades count (3.5)
    sbChain({ data: { ...VALID_CRED }, error: null }),                   // 4. credentials maybeSingle (4a)
    sbChain({ data: { ...VALID_EXCHANGE }, error: null }),               // 4a.6 exchanges maybeSingle (EP1b venue gate)
    sbOk(),                                                              // 5. audit_logs trade.created (post-reservation)
  ]
}

/**
 * Returns the 4 from() chains for Steps 1 – 4a only (no trade insert).
 * Used for SELL paths that abort before Step 7 (e.g. fetchBalance auth error).
 */
function activePrefix(botOverrides: Partial<typeof DEFAULT_BOT> = {}): Chain[] {
  return [
    sbChain({ data: { ...DEFAULT_BOT, ...botOverrides }, error: null }), // 1. bots
    sbChain({ data: null, error: null }),                                 // 2. trades maybeSingle
    sbCount(0),                                                          // 3. trades count (3.5)
    sbChain({ data: { ...VALID_CRED }, error: null }),                   // 4. credentials maybeSingle (4a)
    sbChain({ data: { ...VALID_EXCHANGE }, error: null }),               // 4a.6 exchanges maybeSingle (EP1b venue gate)
  ]
}

/**
 * Returns the 3 from() chains emitted by disableCredentialAndBot()
 * when bot.credential_id is non-null:
 *   user_exchange_credentials update → bots update → audit_logs insert
 */
function disableChains(): Chain[] {
  return [
    sbOk(),   // user_exchange_credentials → status: 'invalid'
    sbOk(),   // bots → status: 'error'
    sbOk(),   // audit_logs bot.disabled_credential_invalid
  ]
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let mockAdapter: {
  getMarketRules: jest.Mock
  fetchBalance:   jest.Mock
  fetchPrice:     jest.Mock
  createOrder:    jest.Mock
  fetchOrder:     jest.Mock
}

let consoleErrorSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  // Plan v1.1 · 1.2 — default the mainnet master-switch ON for tests so the mainnet-production gate tests
  // (egress/audit, which use a mainnet credential + PRAXIS_IS_PRODUCTION=true) reach the gate they target.
  // The dedicated switch-OFF test overrides this locally.
  process.env.PRAXIS_MAINNET_ENABLED = 'true'
  jest.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

  mockAdapter = {
    getMarketRules: jest.fn().mockResolvedValue(DEFAULT_MARKET_RULES),
    fetchBalance:   jest.fn().mockResolvedValue(DEFAULT_BALANCE),
    fetchPrice:     jest.fn().mockResolvedValue(BUY_PRICE),
    createOrder:    jest.fn().mockResolvedValue(makeOrder()),
    fetchOrder:     jest.fn().mockResolvedValue(makeOrder()),
  }
  MockAdapter.mockImplementation(() => mockAdapter as unknown as BinanceAdapter)
})

afterEach(() => {
  delete process.env.PRAXIS_MAINNET_ENABLED
  jest.restoreAllMocks()
})

// ─── Step 0 — schema_version gate (WB1 v1.0, F-02) ───────────────────────────

describe('Step 0 — schema_version gate (WB1 v1.0, F-02)', () => {
  test('acks and skips when schema_version is missing — zero DB calls', async () => {
    const supabase = makeSupabase() // empty queue — ANY from() call would throw

    const msg = {
      msg_id:  42,
      message: { bot_id: BOT_ID, signal_id: SIGNAL_ID, side: 'buy' },
    } as unknown as PgmqMessage

    const result = await processMessage(supabase, msg)

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
  })

  test('acks and skips when schema_version is not "1.0" — logged with the offending version', async () => {
    const supabase = makeSupabase()

    const result = await processMessage(supabase, makeMsg({ schema_version: '2.0' }))

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()

    const errorLogs = consoleErrorSpy.mock.calls.flatMap((args: unknown[]) => {
      try   { return [JSON.parse(String(args[0]))] }
      catch { return []                            }
    }) as Array<Record<string, unknown>>
    const gateLog = errorLogs.find(
      e => e.event === 'invalid_message_shape' && e.reason === 'unsupported_schema_version',
    )
    expect(gateLog).toBeDefined()
    expect(gateLog?.schema_version).toBe('2.0')
  })

  test('processes normally when schema_version is exactly "1.0"', async () => {
    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(), // trades update (filled)
      sbOk(), // audit_logs trade.filled
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)
  })
})

// ─── Step 3.5 — unknown trade guard ──────────────────────────────────────────

describe('Step 3.5 — unknown trade guard', () => {
  test('returns ack=false when an unresolved unknown trade exists for this bot', async () => {
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }), // 1. bots
      sbChain({ data: null, error: null }),                // 2. trades maybeSingle (no match for THIS signal)
      sbCount(1),                                         // 3. trades count → 1 unknown for this bot
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(false)
  })

  test('does not insert a trade or call createOrder when blocked', async () => {
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }),
      sbChain({ data: null, error: null }),
      sbCount(1),
    )

    await processMessage(supabase, makeMsg())

    // createOrder was never reached
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    // makeSupabase has exactly 3 chains — any from('trades').insert() call would throw
  })

  // H-1: the guard must also block on a crash-orphaned STALE 'pending' (not just 'unknown'), else a
  // different signal within the boot-recon window could place a SECOND real order → double position.
  test('H-1: the Step 3.5 query blocks on unknown OR stale pending (filter carries both + a cutoff)', async () => {
    const countChain = sbCount(1)
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }), // 1. bots
      sbChain({ data: null, error: null }),                // 2. trades maybeSingle (no row for THIS signal)
      countChain,                                          // 3. Step 3.5 count → 1 blocking trade
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(false) // blocked — message stays queued
    // The blocking query is a single .or() covering unknown + stale-pending with a time cutoff.
    const orArg = (countChain.or as jest.Mock).mock.calls[0][0] as string
    expect(orArg).toContain('status.eq.unknown')
    expect(orArg).toContain('status.eq.pending')
    expect(orArg).toContain('created_at.lt.') // stale cutoff present (a fresh pending is NOT blocked)
  })
})

// ─── Step 3 — duplicate-signal idempotency (4C re-enqueue safety) ─────────────
//
// A 4C requeue (webhook dedup-branch or sweeper) can place a SECOND copy of the same (bot_id, signal_id)
// message on the queue. These tests prove the worker collapses it to a single trade — the safety
// foundation the whole no-silent-loss design rests on (packet §5 tests 10-12).
describe('Step 3 — duplicate-signal idempotency (re-enqueue safety)', () => {
  test('a re-enqueued signal whose trade is already terminal ⇒ ack, NO adapter, NO second order', async () => {
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }),                  // 1. bots (active)
      sbChain({ data: { id: TRADE_ID, status: 'filled' }, error: null }), // 2. trades maybeSingle → terminal
      // No further chains: reaching Step 3.5 count / adapter / createOrder would throw "queue exhausted".
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)                       // deduped, not reprocessed
    expect(MockAdapter).not.toHaveBeenCalled()          // no ccxt instance
    expect(mockAdapter.createOrder).not.toHaveBeenCalled() // no second executable order
  })
})

// ─── Step 2.5 — null credential guard ────────────────────────────────────────

describe('Step 2.5 — null credential guard', () => {
  test('disables bot and returns ack=true when credential_id is null', async () => {
    const botUpdateChain = sbOk()

    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, credential_id: null }, error: null }), // 1. bots
      botUpdateChain,                                                           // 2. bots update → error
      sbOk(),                                                                   // 3. audit_logs bot.misconfigured
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(botUpdateChain.update).toHaveBeenCalledWith({ status: 'error' })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
  })
})

// ─── Step 4a — credential resolution (F-01) ──────────────────────────────────

describe('Step 4a — credential resolution (F-01)', () => {
  test('happy resolution: adapter receives vault_secret_id, queried by credential_id', async () => {
    const credChain = sbChain({ data: { ...VALID_CRED }, error: null })

    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }), // 1. bots
      sbChain({ data: null, error: null }),                // 2. trades maybeSingle
      sbCount(0),                                         // 3. trades count (3.5)
      credChain,                                          // 4. credentials maybeSingle (4a)
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
      sbChain({ data: [], error: null }),                 // 4b. daily-cap query (S5-A3/B4)
      sbChain({ data: { id: TRADE_ID }, error: null }),   // 5. trades insert
      sbOk(),                                             // 6. audit_logs trade.created
      sbOk(),                                             // 7. trades update (filled)
      sbOk(),                                             // 8. audit_logs trade.filled
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(credChain.select).toHaveBeenCalledWith('vault_secret_id, status, deleted_at, exchange_environment, user_id, exchange_id')
    expect(credChain.eq).toHaveBeenCalledWith('id', CRED_ID)
    expect(MockAdapter).toHaveBeenCalledWith(expect.anything(), VAULT_SECRET_ID, expect.any(Boolean), null, expect.any(Boolean), 'binance')
  })

  test('regression guard: get_decrypted_secret path NEVER receives the credentials row id', async () => {
    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(), // trades update (filled)
      sbOk(), // audit_logs trade.filled
    )

    await processMessage(supabase, makeMsg())

    expect(MockAdapter).toHaveBeenCalledTimes(1)
    const adapterSecondArg = MockAdapter.mock.calls[0][1]
    expect(adapterSecondArg).toBe(VAULT_SECRET_ID)
    expect(adapterSecondArg).not.toBe(CRED_ID)
  })

  test('missing credential row: bot → error, credential untouched, ack=true, no adapter', async () => {
    const botUpdateChain = sbOk()
    const auditChain     = sbOk()

    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),                 // 1–3
      sbChain({ data: null, error: null }),          // 4. credentials maybeSingle → no row
      botUpdateChain,                                // 5. bots update → error
      auditChain,                                    // 6. audit_logs bot.misconfigured
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(botUpdateChain.update).toHaveBeenCalledWith({ status: 'error' })
    // never the credential-invalidation verdict
    expect(botUpdateChain.update).not.toHaveBeenCalledWith({ status: 'invalid' })
    expect(auditChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type:  'bot.misconfigured',
      after_state: expect.objectContaining({ reason: 'credential_row_missing' }),
    }))
    // Queue had exactly 6 chains — a credential UPDATE would exhaust it and throw.
  })

  test('soft-deleted credential row: bot → error, credential untouched, ack=true', async () => {
    const botUpdateChain = sbOk()
    const auditChain     = sbOk()

    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      sbChain({ data: { ...VALID_CRED, deleted_at: '2026-06-10T00:00:00Z' }, error: null }),
      botUpdateChain,
      auditChain,
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(botUpdateChain.update).toHaveBeenCalledWith({ status: 'error' })
    expect(auditChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_state: expect.objectContaining({ reason: 'credential_deleted' }),
    }))
  })

  // ── A8-H3 W1: credential ownership fail-closed ─────────────────────────────
  test('ownership mismatch (cred.user_id != bot.user_id): fail closed — no adapter, only this bot disabled, ack=true, no secret logged', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const botUpdateChain = sbOk()
    const auditChain     = sbOk()

    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      // valid+not-deleted credential, but owned by a DIFFERENT user than the bot
      sbChain({ data: { ...VALID_CRED, user_id: 'user-uuid-OTHER' }, error: null }),  // 4. credentials (4a)
      botUpdateChain,                                                                  // 5. bots update → error
      auditChain,                                                                      // 6. audit_logs bot.misconfigured
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()                       // no adapter → no decrypt, no exchange call
    expect(botUpdateChain.update).toHaveBeenCalledWith({ status: 'error' })
    expect(botUpdateChain.update).not.toHaveBeenCalledWith({ status: 'invalid' })  // credential row NOT touched
    expect(auditChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type:  'bot.misconfigured',
      after_state: expect.objectContaining({ reason: 'credential_owner_mismatch' }),
    }))
    // No secret/vault_secret_id value in any log or in the audit payload.
    const logged = [...errSpy.mock.calls, ...logSpy.mock.calls].map(c => String(c[0])).join('\n')
    expect(logged).not.toContain(VAULT_SECRET_ID)
    expect(JSON.stringify(auditChain.insert.mock.calls)).not.toContain(VAULT_SECRET_ID)
    // Queue had exactly 6 chains — a credential UPDATE or a Vault delete would exhaust it and throw.
    errSpy.mockRestore(); logSpy.mockRestore()
  })

  test('not-valid credential row (pending_validation): bot → error, reason carries status', async () => {
    const botUpdateChain = sbOk()
    const auditChain     = sbOk()

    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      sbChain({ data: { ...VALID_CRED, status: 'pending_validation' }, error: null }),
      botUpdateChain,
      auditChain,
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(auditChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_state: expect.objectContaining({ reason: 'credential_status_pending_validation' }),
    }))
  })

  test('malformed vault_secret_id: bot → error (config fault), credential untouched, ack=true', async () => {
    const botUpdateChain = sbOk()
    const auditChain     = sbOk()

    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      sbChain({ data: { ...VALID_CRED, vault_secret_id: 'not-a-uuid' }, error: null }),
      botUpdateChain,
      auditChain,
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(botUpdateChain.update).toHaveBeenCalledWith({ status: 'error' })
    expect(botUpdateChain.update).not.toHaveBeenCalledWith({ status: 'invalid' })
    expect(auditChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_state: expect.objectContaining({ reason: 'vault_secret_id_malformed' }),
    }))
  })

  test('empty vault_secret_id: treated as malformed — bot → error, ack=true', async () => {
    const auditChain = sbOk()

    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      sbChain({ data: { ...VALID_CRED, vault_secret_id: '' }, error: null }),
      sbOk(),      // bots update → error
      auditChain,  // audit_logs
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(auditChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_state: expect.objectContaining({ reason: 'vault_secret_id_malformed' }),
    }))
  })

  test('infra error on credential fetch: ack=false, zero writes, nothing disabled', async () => {
    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      sbErr('57014'),  // 4. credentials maybeSingle → query error (e.g. timeout)
      // Queue ends here — ANY write (bots/credentials/audit) would throw queue-exhausted.
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(false)
    expect(MockAdapter).not.toHaveBeenCalled()

    const errorLogs = consoleErrorSpy.mock.calls.flatMap((args: unknown[]) => {
      try   { return [JSON.parse(String(args[0]))] }
      catch { return []                            }
    }) as Array<Record<string, unknown>>
    const fetchErr = errorLogs.find(e => e.event === 'credential_fetch_error')
    expect(fetchErr).toBeDefined()
    expect(fetchErr?.error).toBe('57014')
  })
})

// ─── Step 4a.6 — exchange venue gate (EP1b): DB is_active AND worker allowlist ───────────────

describe('Step 4a.6 — exchange venue gate (EP1b)', () => {
  // A VALID credential resolves (Step 4a passes); the exchanges row then governs whether an adapter
  // may be built at all. TWO independent gates must BOTH pass — exchanges.is_active === true (the
  // operator's per-venue switch) AND ccxt_id ∈ SUPPORTED_EXCHANGES (the worker's code-proven set) —
  // else the bot fail-closes as misconfigured (ack, credential row untouched, NO adapter built).

  /** bot/trades/count + VALID cred + the exchanges lookup under test + disableBotMisconfigured's
   *  two writes (bots update → error, audit). For the fail-closed cases. */
  function exchangeGateChains(exchangeData: unknown, exchangeError: string | null = null) {
    const botUpdate = sbOk()
    const audit     = sbOk()
    const supabase  = makeSupabase(
      ...activePrefix().slice(0, 3),                          // 1-3 bots, trades, count
      sbChain({ data: { ...VALID_CRED }, error: null }),     // 4   credentials (valid → Step 4a passes)
      exchangeError                                          // 4a.6 exchanges lookup (UNDER TEST)
        ? sbErr(exchangeError)
        : sbChain({ data: exchangeData, error: null }),
      botUpdate,                                             // 5   bots update → error (disableBotMisconfigured)
      audit,                                                 // 6   audit_logs bot.misconfigured
    )
    return { supabase, botUpdate, audit }
  }

  test('exchange INACTIVE (is_active=false) → fail-closed, bot disabled, credential untouched, no adapter, ack', async () => {
    const { supabase, botUpdate, audit } = exchangeGateChains({ ccxt_id: 'binance', is_active: false })
    const result = await processMessage(supabase, makeMsg())
    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(botUpdate.update).toHaveBeenCalledWith({ status: 'error' })
    expect(botUpdate.update).not.toHaveBeenCalledWith({ status: 'invalid' }) // credential row NOT touched
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type:  'bot.misconfigured',
      after_state: expect.objectContaining({ reason: 'exchange_inactive' }),
    }))
  })

  test('exchange ACTIVE but NOT in the worker allowlist (bybit) → fail-closed, exchange_unsupported', async () => {
    // Proves the SECOND gate: even an operator-activated venue is refused until the worker has
    // code-validated it (SUPPORTED_EXCHANGES). Belt to the DB is_active suspenders.
    const { supabase, audit } = exchangeGateChains({ ccxt_id: 'bybit', is_active: true })
    const result = await processMessage(supabase, makeMsg())
    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_state: expect.objectContaining({ reason: 'exchange_unsupported' }),
    }))
  })

  test('exchange row missing (null) → fail-closed, exchange_row_missing', async () => {
    const { supabase, audit } = exchangeGateChains(null)
    const result = await processMessage(supabase, makeMsg())
    expect(result.ack).toBe(true)
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_state: expect.objectContaining({ reason: 'exchange_row_missing' }),
    }))
  })

  test('the exchanges lookup is keyed by the credential exchange_id and selects only ccxt_id,is_active', async () => {
    const exChain = sbChain({ data: { ccxt_id: 'binance', is_active: true }, error: null })
    const supabase = makeSupabase(
      ...activePrefix().slice(0, 3),
      sbChain({ data: { ...VALID_CRED }, error: null }),   // 4   credentials
      exChain,                                             // 4a.6 exchanges (active binance → passes)
      sbOk(), sbOk(), sbOk(),                              // 5-7 audit trade.created, fill update, audit trade.filled
    )
    await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(exChain.select).toHaveBeenCalledWith('ccxt_id, is_active')
    expect(exChain.eq).toHaveBeenCalledWith('id', EXCHANGE_ID)
    expect(MockAdapter).toHaveBeenCalledWith(expect.anything(), VAULT_SECRET_ID, expect.any(Boolean), null, expect.any(Boolean), 'binance')
  })

  test('infra error on exchange fetch → transient ack:false, nothing disabled, no adapter', async () => {
    const { supabase } = exchangeGateChains(null, '57014')
    const result = await processMessage(supabase, makeMsg())
    expect(result.ack).toBe(false)                                     // retry — venue truth unknown, invent nothing
    expect(MockAdapter).not.toHaveBeenCalled()
    const errorLogs = consoleErrorSpy.mock.calls.flatMap((args: unknown[]) => {
      try   { return [JSON.parse(String(args[0]))] }
      catch { return []                            }
    }) as Array<Record<string, unknown>>
    const exErr = errorLogs.find(e => e.event === 'exchange_fetch_error')
    expect(exErr).toBeDefined()
    expect(exErr?.error).toBe('57014')
  })
})

// ─── Step 5 — market-rules error surfaces non-secret detail (WB6) ────────────

describe('Step 5 — market_rules_error surfaces detail (WB6)', () => {
  test('logs the original-cause detail and returns ack=false (transient)', async () => {
    // 1-4: bots, idempotency, unknown-count, credential resolve — then getMarketRules throws.
    const supabase = makeSupabase(...activePrefix())
    mockAdapter.getMarketRules.mockRejectedValue(
      new ExchangeUnavailableError('ExchangeNotAvailable:http_451'),
    )

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(false)                       // transient -> not acked (message retried)
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()

    const errs = consoleErrorSpy.mock.calls.flatMap((a: unknown[]) => {
      try { return [JSON.parse(String(a[0]))] } catch { return [] }
    }) as Array<Record<string, unknown>>
    const log = errs.find(e => e.event === 'market_rules_error')
    expect(log).toBeDefined()
    expect(log?.error).toBe('ExchangeUnavailableError')
    expect(log?.detail).toBe('ExchangeNotAvailable:http_451')   // the previously-swallowed cause
  })
})

// ─── Step 6 — BUY sizing/risk wired into processMessage (S5-A3/B4 slice 2b-1) ──
// The per-symbol price floors (S4A) were removed; BUY sizing now comes from bot config + live
// price via sizingRisk.computeBuyQuantity (unit-tested in sizingRisk.test.ts). These tests assert
// the WIRING of the happy path through processMessage. Blocked paths land in slice 2b-2.

describe('Step 6 — BUY sizing/risk wired into processMessage (S5-A3/B4 slice 2b-1)', () => {
  // percent_of_balance: 10% × 1000 USDT free = 100 notional; 100 / BUY_PRICE(50000) = 0.002 BTC.
  const EXPECTED_QTY = 0.002
  const EXPECTED_REQUESTED_NOTIONAL = 100

  /** Full happy-BUY chain set with references to the chains we assert on. */
  function happyBuyChains() {
    const fill     = sbOk()                                      // fill update
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }), // 1  bots
      sbChain({ data: null, error: null }),               // 2  trades maybeSingle
      sbCount(0),                                         // 3  trades count (3.5)
      sbChain({ data: { ...VALID_CRED }, error: null }),  // 4  credentials (4a)
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
      // [rpc insert_pending_trade_atomic → success (default from makeSupabase)]
      sbOk(),                                             // 5  audit trade.created
      fill,                                               // 6  trades update (fill)
      sbOk(),                                             // 7  audit trade.filled
    )
    return { supabase, fill }
  }

  test('happy percent_of_balance BUY → createOrder receives the config-derived quantity', async () => {
    const { supabase } = happyBuyChains()

    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(result).toEqual({ ack: true })
    expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)
    expect(mockAdapter.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT', side: 'buy', type: 'market', quantity: EXPECTED_QTY,
    }))
    // sizing reads live price + free quote (never the removed per-symbol floor)
    expect(mockAdapter.fetchPrice).toHaveBeenCalledWith('BTC/USDT')
    expect(mockAdapter.fetchBalance).toHaveBeenCalled()
  })

  test('H-2: reservation RPC receives quantity + requested_notional (daily-cap basis) and the config caps', async () => {
    const { supabase } = happyBuyChains()

    await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(rpcOf(supabase)).toHaveBeenCalledWith('insert_pending_trade_atomic', expect.objectContaining({
      p_bot_id:             BOT_ID,
      p_user_id:            DEFAULT_BOT.user_id,
      p_signal_id:          SIGNAL_ID,
      p_side:               'buy',
      p_trading_pair:       DEFAULT_BOT.trading_pair,
      p_quantity:           EXPECTED_QTY,
      p_requested_notional: EXPECTED_REQUESTED_NOTIONAL,
      p_max_order_notional: DEFAULT_BOT.max_order_notional_usdt, // cap enforcement moved into the atomic RPC
      p_daily_cap:          DEFAULT_BOT.daily_notional_cap_usdt,
    }))
  })

  test('fill update stores executed_notional_usdt from order.cost', async () => {
    const { supabase, fill } = happyBuyChains() // createOrder → makeOrder() with cost 9.75

    await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(fill.update).toHaveBeenCalledWith(expect.objectContaining({
      status:                 'filled',
      executed_notional_usdt: 9.75,
    }))
  })

  test('H-2: exactly ONE reservation RPC call per BUY (atomic; no separate daily-cap query)', async () => {
    const { supabase } = happyBuyChains()

    await processMessage(supabase, makeMsg({ side: 'buy' }))

    const reserveCalls = rpcOf(supabase).mock.calls.filter((c) => c[0] === 'insert_pending_trade_atomic')
    expect(reserveCalls).toHaveLength(1) // the cap check + insert are one atomic RPC, not a read-then-insert
  })

  // ── Blocked paths (S5-A3/B4 slice 2b-2): every policy/risk block → ack, NO createOrder, NO
  //    pending trade, and an auditable bot-scoped 'order.blocked' row with a non-secret reason. ──
  // No trades.insert chain is ever provided in these tests, so any attempt to write a pending
  // trade would throw "supabase.from() called more times than expected" — proving no pending row.

  /** Pre-fetch gate block (Step 4b): bot, idempotency, count, credential, then the audit insert.
   *  Blocks before the adapter is built — no daily-cap query, no Exchange call. */
  function gateBlockChains(botOverrides: Record<string, unknown> = {}, credOverrides: Record<string, unknown> = {}) {
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, ...botOverrides }, error: null }), // 1 bots
      sbChain({ data: null, error: null }),                                 // 2 trades maybeSingle
      sbCount(0),                                                          // 3 trades count (3.5)
      sbChain({ data: { ...VALID_CRED, ...credOverrides }, error: null }), // 4 credentials (4a)
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }),               // 4a.6 exchanges (EP1b venue gate)
      audit,                                                              // 5 audit_logs order.blocked
    )
    return { supabase, audit }
  }

  /** Post-fetch sizing block (Step 6, throws in computeBuyQuantity BEFORE the daily-cap query):
   *  prefix + audit. fetchBalance/fetchPrice run; createOrder must not. */
  function sizingBlockChains(botOverrides: Record<string, unknown> = {}) {
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, ...botOverrides }, error: null }), // 1 bots
      sbChain({ data: null, error: null }),                                 // 2 trades maybeSingle
      sbCount(0),                                                          // 3 count
      sbChain({ data: { ...VALID_CRED }, error: null }),                   // 4 credentials
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }),               // 4a.6 exchanges (EP1b venue gate)
      audit,                                                              // 5 audit_logs order.blocked
    )
    return { supabase, audit }
  }

  /** Post-fetch risk block (Step 6, throws in enforceRiskLimits AFTER the daily-cap query):
   *  prefix + daily-cap + audit. */
  // H-2: the per-order/daily cap block now comes from the atomic RPC returning a rejected_reason
  // (not a thrown enforceRiskLimits). Chains: prefix + the order.blocked audit; RPC set to reject.
  function riskBlockChains(reason: string, botOverrides: Record<string, unknown> = {}) {
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, ...botOverrides }, error: null }), // 1 bots
      sbChain({ data: null, error: null }),                                 // 2 trades maybeSingle
      sbCount(0),                                                          // 3 count
      sbChain({ data: { ...VALID_CRED }, error: null }),                   // 4 credentials
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }),               // 4a.6 exchanges (EP1b venue gate)
      audit,                                                              // 5 audit_logs order.blocked (post-rejection)
    )
    rpcOf(supabase).mockResolvedValue(reserveRejected(reason))
    return { supabase, audit }
  }

  function expectNoExchangeTouchAfterGates() {
    // gates run in Step 4b — BEFORE the adapter is built, so no Exchange call happens at all.
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(mockAdapter.getMarketRules).not.toHaveBeenCalled()
    expect(mockAdapter.fetchBalance).not.toHaveBeenCalled()
    expect(mockAdapter.fetchPrice).not.toHaveBeenCalled()
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
  }

  function expectBlockedAudit(audit: Chain, reason: string) {
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'bot',
      entity_id:   BOT_ID,
      event_type:  'order.blocked',
      after_state: expect.objectContaining({ reason }),
    }))
  }

  // ── Pre-fetch policy gates (block before the adapter is built) ──

  test('trading_disabled → blocked + audited; adapter never built', async () => {
    const { supabase, audit } = gateBlockChains({ trading_enabled: false })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expectNoExchangeTouchAfterGates()
    expectBlockedAudit(audit, 'trading_disabled')
  })

  test('config_incomplete (missing sizing_mode) → blocked + audited; adapter never built', async () => {
    const { supabase, audit } = gateBlockChains({ sizing_mode: null })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expectNoExchangeTouchAfterGates()
    expectBlockedAudit(audit, 'config_incomplete')
  })

  test('env_missing (credential exchange_environment null) → blocked + audited', async () => {
    const { supabase, audit } = gateBlockChains({}, { exchange_environment: null })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expectNoExchangeTouchAfterGates()
    expectBlockedAudit(audit, 'env_missing')
  })

  test('env mismatch: testnet worker + mainnet credential → blocked + audited', async () => {
    const { supabase, audit } = gateBlockChains({}, { exchange_environment: 'mainnet' })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expectNoExchangeTouchAfterGates()
    expectBlockedAudit(audit, 'env_mismatch_testnet_with_mainnet_credential')
  })

  test('env mismatch: production worker + testnet credential → blocked + audited', async () => {
    const prev = process.env.PRAXIS_IS_PRODUCTION
    process.env.PRAXIS_IS_PRODUCTION = 'true'
    try {
      const { supabase, audit } = gateBlockChains({}, { exchange_environment: 'testnet' })
      expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
      expectNoExchangeTouchAfterGates()
      expectBlockedAudit(audit, 'env_mismatch_production_with_testnet_credential')
    } finally {
      if (prev === undefined) delete process.env.PRAXIS_IS_PRODUCTION
      else process.env.PRAXIS_IS_PRODUCTION = prev
    }
  })

  // ── Plan v1.1 · 1.2 — mainnet GLOBAL master-switch (runtime kill for real-money execution) ──

  test('production + mainnet credential + master-switch OFF → blocked at mainnet_master_switch_off, no adapter', async () => {
    const prevProd = process.env.PRAXIS_IS_PRODUCTION
    process.env.PRAXIS_IS_PRODUCTION = 'true'
    delete process.env.PRAXIS_MAINNET_ENABLED   // engage the global mainnet kill (beforeEach set it 'true')
    try {
      const { supabase, audit } = gateBlockChains({}, { exchange_environment: 'mainnet' })
      expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
      expectNoExchangeTouchAfterGates()          // fail-closed BEFORE the adapter — no ccxt instance, no order
      expectBlockedAudit(audit, 'mainnet_master_switch_off')
    } finally {
      if (prevProd === undefined) delete process.env.PRAXIS_IS_PRODUCTION; else process.env.PRAXIS_IS_PRODUCTION = prevProd
    }
  })

  // ── A1 (B0): production egress must be EXPLICITLY configured (proxy OR native) for every order path ──

  test('production BUY + egress UNCONFIGURED (no proxy, no native) → blocked BEFORE adapter construction + audited', async () => {
    const prevProd  = process.env.PRAXIS_IS_PRODUCTION
    const prevProxy = process.env.EXCHANGE_HTTPS_PROXY
    const prevMode  = process.env.EXCHANGE_EGRESS_MODE
    process.env.PRAXIS_IS_PRODUCTION = 'true'
    delete process.env.EXCHANGE_HTTPS_PROXY  // no proxy
    delete process.env.EXCHANGE_EGRESS_MODE  // and not native → unconfigured
    try {
      // mainnet credential so the env guard passes and the egress gate is the blocker.
      const { supabase, audit } = gateBlockChains({}, { exchange_environment: 'mainnet' })
      expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
      expectNoExchangeTouchAfterGates()                 // MockAdapter never constructed → no ccxt instance
      expectBlockedAudit(audit, 'exchange_egress_unconfigured')
    } finally {
      if (prevProd  === undefined) delete process.env.PRAXIS_IS_PRODUCTION; else process.env.PRAXIS_IS_PRODUCTION = prevProd
      if (prevProxy === undefined) delete process.env.EXCHANGE_HTTPS_PROXY; else process.env.EXCHANGE_HTTPS_PROXY = prevProxy
      if (prevMode  === undefined) delete process.env.EXCHANGE_EGRESS_MODE; else process.env.EXCHANGE_EGRESS_MODE = prevMode
    }
  })

  test('B0: production BUY + NATIVE egress (no proxy) → NOT blocked; adapter IS constructed', async () => {
    const prevProd  = process.env.PRAXIS_IS_PRODUCTION
    const prevProxy = process.env.EXCHANGE_HTTPS_PROXY
    const prevMode  = process.env.EXCHANGE_EGRESS_MODE
    process.env.PRAXIS_IS_PRODUCTION = 'true'
    delete process.env.EXCHANGE_HTTPS_PROXY
    process.env.EXCHANGE_EGRESS_MODE = 'native'  // explicit native egress → production allowed, no proxy
    try {
      // Full happy-BUY chain (mirrors happyBuyChains) but with a MAINNET credential so the production
      // env guard passes and the egress gate is the only thing that could block.
      const supabase = makeSupabase(
        sbChain({ data: { ...DEFAULT_BOT }, error: null }),                                  // 1 bots
        sbChain({ data: null, error: null }),                                                // 2 trades maybeSingle
        sbCount(0),                                                                          // 3 trades count (3.5)
        sbChain({ data: { ...VALID_CRED, exchange_environment: 'mainnet' }, error: null }),  // 4 credentials (MAINNET)
        sbChain({ data: { ...VALID_EXCHANGE }, error: null }),                               // 4a.6 exchanges (EP1b venue gate)
        // [rpc insert_pending_trade_atomic → default success from makeSupabase]
        sbOk(),                                                                              // 5 audit trade.created
        sbOk(),                                                                              // 6 trades update (fill)
        sbOk(),                                                                              // 7 audit trade.filled
      )
      mockAdapter.getMarketRules.mockResolvedValue(DEFAULT_MARKET_RULES)
      mockAdapter.fetchBalance.mockResolvedValue(DEFAULT_BALANCE)
      mockAdapter.fetchPrice.mockResolvedValue(BUY_PRICE)
      mockAdapter.createOrder.mockResolvedValue(makeOrder())

      const result = await processMessage(supabase, makeMsg({ side: 'buy' }))

      expect(result.ack).toBe(true)
      // The egress gate did NOT block: the adapter was constructed with native egress (5th arg true).
      expect(MockAdapter).toHaveBeenCalledWith(expect.anything(), VAULT_SECRET_ID, true, null, true, 'binance')
      expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)
    } finally {
      if (prevProd  === undefined) delete process.env.PRAXIS_IS_PRODUCTION; else process.env.PRAXIS_IS_PRODUCTION = prevProd
      if (prevProxy === undefined) delete process.env.EXCHANGE_HTTPS_PROXY; else process.env.EXCHANGE_HTTPS_PROXY = prevProxy
      if (prevMode  === undefined) delete process.env.EXCHANGE_EGRESS_MODE; else process.env.EXCHANGE_EGRESS_MODE = prevMode
    }
  })

  test('production SELL + egress UNCONFIGURED → blocked at the egress gate BEFORE adapter construction; no ccxt instance', async () => {
    // EP3: SELL now runs the SAME Step 4b gates as BUY. In production with neither a proxy nor native
    // egress, the egress gate fail-closes BEFORE any adapter is built — proving no SELL path can
    // construct a ccxt instance proxy-less (the safety property the old v1 fail-closed used to give).
    const prevProd  = process.env.PRAXIS_IS_PRODUCTION
    const prevProxy = process.env.EXCHANGE_HTTPS_PROXY
    const prevMode  = process.env.EXCHANGE_EGRESS_MODE
    process.env.PRAXIS_IS_PRODUCTION = 'true'
    delete process.env.EXCHANGE_HTTPS_PROXY  // no proxy
    delete process.env.EXCHANGE_EGRESS_MODE  // and not native → unconfigured
    try {
      const { supabase, audit } = gateBlockChains({}, { exchange_environment: 'mainnet' })
      expect(await processMessage(supabase, makeMsg({ side: 'sell' }))).toEqual({ ack: true })
      expect(MockAdapter).not.toHaveBeenCalled()        // no ccxt instance on the SELL path
      expectBlockedAudit(audit, 'exchange_egress_unconfigured')
    } finally {
      if (prevProd  === undefined) delete process.env.PRAXIS_IS_PRODUCTION; else process.env.PRAXIS_IS_PRODUCTION = prevProd
      if (prevProxy === undefined) delete process.env.EXCHANGE_HTTPS_PROXY; else process.env.EXCHANGE_HTTPS_PROXY = prevProxy
      if (prevMode  === undefined) delete process.env.EXCHANGE_EGRESS_MODE; else process.env.EXCHANGE_EGRESS_MODE = prevMode
    }
  })

  // ── Post-fetch sizing blocks (fetch ran; block before the daily-cap query) ──

  test('insufficient_quote_balance (fixed_notional > free quote) → blocked + audited; no createOrder', async () => {
    const { supabase, audit } = sizingBlockChains({ sizing_mode: 'fixed_notional', fixed_notional_usdt: 2_000 })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expectBlockedAudit(audit, 'insufficient_quote_balance')
  })

  test('below_min_notional (fixed_notional under minNotional) → blocked + audited; no createOrder', async () => {
    const { supabase, audit } = sizingBlockChains({ sizing_mode: 'fixed_notional', fixed_notional_usdt: 6 })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expectBlockedAudit(audit, 'below_min_notional')
  })

  test('below_min_qty (notional rounds below minQty) → blocked + audited; no createOrder', async () => {
    const { supabase, audit } = sizingBlockChains({ sizing_mode: 'fixed_notional', fixed_notional_usdt: 0.1 })
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expectBlockedAudit(audit, 'below_min_qty')
  })

  // ── Post-fetch risk-cap blocks (fetch + daily-cap query ran) ──

  test('per_order_max_notional (RPC rejects) → blocked + audited; no createOrder', async () => {
    const { supabase, audit } = riskBlockChains('per_order_max_notional')
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expectBlockedAudit(audit, 'per_order_max_notional')
  })

  test('daily_notional_cap (RPC rejects atomically) → blocked + audited; no createOrder', async () => {
    const { supabase, audit } = riskBlockChains('daily_notional_cap')
    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expectBlockedAudit(audit, 'daily_notional_cap')
  })

  // ── Transient (NOT a policy block — retry, no audit, no order) ──

  test('price unavailable → transient ack:false; no createOrder; no audit', async () => {
    const auditTrap = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }), // 1 bots
      sbChain({ data: null, error: null }),               // 2 trades maybeSingle
      sbCount(0),                                         // 3 count
      sbChain({ data: { ...VALID_CRED }, error: null }),  // 4 credentials
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
      auditTrap,                                          // would-be audit — must NOT run
    )
    mockAdapter.fetchPrice.mockRejectedValue(new ExchangeUnavailableError('no_last_price'))

    expect(await processMessage(supabase, makeMsg({ side: 'buy' }))).toEqual({ ack: false })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(auditTrap.insert).not.toHaveBeenCalled() // transient is not an auditable decision
  })

  test('no old floor fallback: quantity is the config-derived 0.002, not the removed BTC floor (0.0006)', async () => {
    const { supabase } = happyBuyChains()

    await processMessage(supabase, makeMsg({ side: 'buy' }))

    const qty = mockAdapter.createOrder.mock.calls[0][0].quantity
    expect(qty).toBe(EXPECTED_QTY)
    expect(qty).not.toBe(0.0006) // the old per-symbol BTC floor result must not resurface
  })
})

// ─── H-2 — atomic reservation wiring (insert_pending_trade_atomic) ─────────────
// The worker reserves the pending trade via ONE atomic RPC (per-bot advisory lock + cap re-check +
// insert), replacing the non-atomic read-day-sum → enforceRiskLimits → insert. These tests cover every
// reservation outcome and prove NO exchange order is ever placed on a rejection.
describe('H-2 — atomic reservation wiring', () => {
  // Steps 1-4 gates pass; the reservation is the RPC (default success from makeSupabase). No 5th chain
  // here — callers append the audit chain only when the path writes one.
  const resPrefix = (): Chain[] => [
    sbChain({ data: { ...DEFAULT_BOT }, error: null }), // 1 bots
    sbChain({ data: null, error: null }),               // 2 trades maybeSingle
    sbCount(0),                                         // 3 count (3.5)
    sbChain({ data: { ...VALID_CRED }, error: null }),  // 4 credentials (4a)
    sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
  ]

  test('below min notional → blocked in computeBuyQuantity BEFORE the RPC; reservation NEVER called; no order', async () => {
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 6 }, error: null }), // 1 bots — 6 < minNotional 10
      sbChain({ data: null, error: null }),               // 2 trades maybeSingle
      sbCount(0),                                         // 3 count (3.5)
      sbChain({ data: { ...VALID_CRED }, error: null }),  // 4 credentials (4a)
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
      audit,                                             // 5 order.blocked audit (from onSizingError)
    )

    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(result).toEqual({ ack: true })
    expect(rpcOf(supabase)).not.toHaveBeenCalled()          // min-size check runs BEFORE the reservation RPC
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'order.blocked', after_state: expect.objectContaining({ reason: 'below_min_notional' }),
    }))
  })

  test('successful reservation → createOrder placed with the reserved trade', async () => {
    const supabase = makeSupabase(...resPrefix(), sbOk(), sbOk(), sbOk()) // trade.created, fill, trade.filled
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: true })
    expect(rpcOf(supabase)).toHaveBeenCalledWith('insert_pending_trade_atomic', expect.any(Object))
    expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)
  })

  test('per-order cap rejection → order.blocked + ack; NO exchange order', async () => {
    const audit = sbOk()
    const supabase = makeSupabase(...resPrefix(), audit)
    rpcOf(supabase).mockResolvedValue(reserveRejected('per_order_max_notional'))
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'order.blocked', after_state: expect.objectContaining({ reason: 'per_order_max_notional' }),
    }))
  })

  test('daily cap rejection → order.blocked + ack; NO exchange order', async () => {
    const audit = sbOk()
    const supabase = makeSupabase(...resPrefix(), audit)
    rpcOf(supabase).mockResolvedValue(reserveRejected('daily_notional_cap'))
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'order.blocked', after_state: expect.objectContaining({ reason: 'daily_notional_cap' }),
    }))
  })

  test('duplicate signal → ack, NO exchange order, NO order.blocked audit (dedup log only)', async () => {
    // No 5th chain: the duplicate path acks WITHOUT writing an audit row — an extra from() would throw.
    const supabase = makeSupabase(...resPrefix())
    rpcOf(supabase).mockResolvedValue(reserveRejected('duplicate_signal'))
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    const errs = consoleErrorSpy.mock.calls.flatMap((a: unknown[]) => { try { return [JSON.parse(String(a[0]))] } catch { return [] } }) as Array<Record<string, unknown>>
    expect(errs.some((e) => e.event === 'duplicate_signal_race')).toBe(true)
  })

  test('RPC infra error → transient ack:false; NO exchange order', async () => {
    // No 5th chain: the transient path returns before any audit — an extra from() would throw.
    const supabase = makeSupabase(...resPrefix())
    rpcOf(supabase).mockResolvedValue(reserveRpcError('PGRST202'))
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: false })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    const errs = consoleErrorSpy.mock.calls.flatMap((a: unknown[]) => { try { return [JSON.parse(String(a[0]))] } catch { return [] } }) as Array<Record<string, unknown>>
    expect(errs.some((e) => e.event === 'reservation_rpc_error')).toBe(true)
  })
})

// ─── Branch 1 — ExchangeAuthError in createOrder ─────────────────────────────

describe('Branch 1 — ExchangeAuthError in createOrder', () => {
  test('marks trade failed, inserts DLQ, disables credential and bot, ack=true', async () => {
    const tradeFailChain  = sbOk()
    const dlqChain        = sbOk()
    const credChain       = sbOk()
    const botDisableChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),     // 1–5
      tradeFailChain,     // 6.  trades update → status: 'failed'
      sbOk(),             // 7.  audit_logs trade.failed
      dlqChain,           // 8.  trades_dlq insert
      credChain,          // 9.  user_exchange_credentials update → 'invalid'
      botDisableChain,    // 10. bots update → 'error'
      sbOk(),             // 11. audit_logs bot.disabled_credential_invalid
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeAuthError())

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)

    expect(tradeFailChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error_reason: 'ExchangeAuthError' })
    )
    expect(dlqChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        trade_id:       TRADE_ID,
        failure_reason: 'ExchangeAuthError',
        retry_count:    0,
      })
    )
    expect(credChain.update).toHaveBeenCalledWith({ status: 'invalid' })
    expect(botDisableChain.update).toHaveBeenCalledWith({ status: 'error' })
  })

  test('does NOT increment consecutive_failures — no threshold for auth errors', async () => {
    // If Branch 1 accidentally incremented failures it would call from('bots').update
    // with a consecutive_failures value — the botDisableChain below captures every
    // update() call on that chain so we can assert it was never called that way.
    const botDisableChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(),           // trades update failed
      sbOk(),           // audit_logs trade.failed
      sbOk(),           // trades_dlq
      sbOk(),           // user_exchange_credentials
      botDisableChain,  // bots update — should be { status: 'error' } only
      sbOk(),           // audit_logs bot.disabled
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeAuthError())

    await processMessage(supabase, makeMsg())

    // The only bots.update call must be the status='error' from disableCredentialAndBot
    expect(botDisableChain.update).toHaveBeenCalledWith({ status: 'error' })
    expect(botDisableChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ consecutive_failures: expect.any(Number) })
    )
  })
})

// ─── Branch 1 — VaultSecretNotFoundError in createOrder ──────────────────────

describe('Branch 1 — VaultSecretNotFoundError in createOrder', () => {
  test('marks trade failed, inserts DLQ with correct failure_reason, ack=true', async () => {
    const dlqChain        = sbOk()
    const botDisableChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(),           // trades update failed
      sbOk(),           // audit_logs trade.failed
      dlqChain,         // trades_dlq
      sbOk(),           // user_exchange_credentials
      botDisableChain,  // bots update
      sbOk(),           // audit_logs bot.disabled
    )
    mockAdapter.createOrder.mockRejectedValue(new VaultSecretNotFoundError())

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(dlqChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ failure_reason: 'VaultSecretNotFoundError' })
    )
    expect(botDisableChain.update).toHaveBeenCalledWith({ status: 'error' })
  })

  test('does NOT increment consecutive_failures — no threshold for vault errors', async () => {
    const botDisableChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(), sbOk(), sbOk(), sbOk(),
      botDisableChain,
      sbOk(),
    )
    mockAdapter.createOrder.mockRejectedValue(new VaultSecretNotFoundError())

    await processMessage(supabase, makeMsg())

    expect(botDisableChain.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ consecutive_failures: expect.any(Number) })
    )
  })
})

// ─── Branch 1 — auth error in fetchBalance (BUY, Step 6) ─────────────────────
// (Was a SELL path; SELL is now blocked fail-closed in Step 4b, so the same credential-invalid
// handling is exercised via the BUY fetchBalance, which throws before fetchPrice.)

describe('Branch 1 — auth error in fetchBalance (BUY, Step 6)', () => {
  test('VaultSecretNotFoundError: disables credential+bot, ack=true, no trade created', async () => {
    const credChain       = sbOk()
    const botDisableChain = sbOk()

    const supabase = makeSupabase(
      ...activePrefix(),  // 1–3: bot, idempotency, count
      credChain,          // 4. user_exchange_credentials → invalid
      botDisableChain,    // 5. bots → error
      sbOk(),             // 6. audit_logs bot.disabled
    )
    mockAdapter.fetchBalance.mockRejectedValue(new VaultSecretNotFoundError())

    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(result.ack).toBe(true)
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(credChain.update).toHaveBeenCalledWith({ status: 'invalid' })
    expect(botDisableChain.update).toHaveBeenCalledWith({ status: 'error' })
  })

  test('ExchangeAuthError: disables credential+bot, ack=true, no trade created', async () => {
    const supabase = makeSupabase(
      ...activePrefix(),
      ...disableChains(),  // 4–6
    )
    mockAdapter.fetchBalance.mockRejectedValue(new ExchangeAuthError())

    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(result.ack).toBe(true)
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
  })
})

// ─── SELL blocked fail-closed before the adapter (S5-A3/B4 v1 — SELL off) ────

describe('SELL / exit path (EP3) — per-bot opt-in, same gates as BUY, cap-exempt', () => {
  test('sell_enabled=false (default) → blocked at Step 4b BEFORE the adapter; ack; no Exchange call; no trade', async () => {
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }),    // 1 bots (sell_enabled=false)
      sbChain({ data: null, error: null }),                  // 2 trades maybeSingle
      sbCount(0),                                            // 3 trades count (3.5)
      sbChain({ data: { ...VALID_CRED }, error: null }),     // 4 credentials (4a)
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
      audit,                                                 // 5 audit_logs order.blocked
      // NO trade insert chain — a pending write would throw "queue exhausted".
    )

    const result = await processMessage(supabase, makeMsg({ side: 'sell' }))

    expect(result).toEqual({ ack: true })
    // Blocked BEFORE the adapter is even constructed → no Exchange touch, no pending trade.
    expect(MockAdapter).not.toHaveBeenCalled()
    expect(mockAdapter.getMarketRules).not.toHaveBeenCalled()
    expect(mockAdapter.fetchBalance).not.toHaveBeenCalled()
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      entity_type: 'bot',
      entity_id:   BOT_ID,
      event_type:  'order.blocked',
      after_state: expect.objectContaining({ reason: 'sell_not_enabled' }),
    }))
  })

  test('sell_enabled=true, sufficient base → market SELL placed for sell_size_pct% of free base; cap-exempt idempotent insert', async () => {
    const tradeInsert = sbChain({ data: { id: TRADE_ID }, error: null })
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, sell_enabled: true, sell_size_pct: 50 }, error: null }), // 1 bots
      sbChain({ data: null, error: null }),                  // 2 trades maybeSingle
      sbCount(0),                                            // 3 count
      sbChain({ data: { ...VALID_CRED }, error: null }),     // 4 credentials
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges
      tradeInsert,                                           // 5 SELL idempotent pending INSERT (no RPC)
      sbOk(),                                                // 6 audit trade.created
      sbOk(),                                                // 7 trades update (fill)
      sbOk(),                                                // 8 audit trade.filled
    )
    mockAdapter.createOrder.mockResolvedValue(makeOrder({ status: 'filled' }))

    const result = await processMessage(supabase, makeMsg({ side: 'sell' }))

    expect(result.ack).toBe(true)
    // 50% of free base (0.1 BTC) rounded to step = 0.05, sent as a MARKET sell.
    expect(mockAdapter.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      side: 'sell', type: 'market', quantity: 0.05,
    }))
    // The pending row is a plain idempotent insert (NOT the BUY reservation RPC), side=sell, with a
    // NULL requested_notional so it neither counts toward nor consumes the daily BUY cap.
    expect(tradeInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
      side: 'sell', requested_notional_usdt: null, status: 'pending',
    }))
    expect(rpcOf(supabase)).not.toHaveBeenCalledWith('insert_pending_trade_atomic', expect.anything())
  })

  test('no sellable position (rounds below minQty) → order.skipped, ack, no createOrder, no trade', async () => {
    mockAdapter.fetchBalance.mockResolvedValue({
      BTC:  { free: 0.000001, used: 0, total: 0.000001 }, // 50% = 0.0000005 → rounds to 0 < minQty
      USDT: { free: 0,        used: 0, total: 0 },
    })
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, sell_enabled: true, sell_size_pct: 50 }, error: null }),
      sbChain({ data: null, error: null }),
      sbCount(0),
      sbChain({ data: { ...VALID_CRED }, error: null }),
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }),
      audit,                                                 // order.skipped (no insert chain follows)
    )

    const result = await processMessage(supabase, makeMsg({ side: 'sell' }))

    expect(result).toEqual({ ack: true })
    expect(mockAdapter.createOrder).not.toHaveBeenCalled()
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type:  'order.skipped',
      after_state: expect.objectContaining({ reason: 'no_sellable_position' }),
    }))
  })
})

// ─── Branch 3 — Option B inline fetchOrder ───────────────────────────────────

describe('Branch 3 — Option B inline fetchOrder', () => {
  test('Case A: createOrder timeout → fetchOrder returns filled → trade updated filled, ack=true', async () => {
    const tradeUpdateChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),     // 1–5
      tradeUpdateChain,   // 6. trades update → resolved status
      sbOk(),             // 7. audit_logs trade.filled
      // No chain 8 — consecutive_failures=0 means no reset call
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeTimeoutError())
    mockAdapter.fetchOrder.mockResolvedValue(makeOrder({ status: 'filled', id: 'ex-resolved-001' }))

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(mockAdapter.fetchOrder).toHaveBeenCalledTimes(1)
    expect(tradeUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status:            'filled',
        exchange_order_id: 'ex-resolved-001',
      })
    )
  })

  test('Case A: resets consecutive_failures when inline-resolved order is filled', async () => {
    const botResetChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix({ consecutive_failures: 2 }),  // 1–5 (bot has 2 failures)
      sbOk(),        // 6. trades update
      sbOk(),        // 7. audit_logs
      botResetChain, // 8. bots update → consecutive_failures: 0
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeTimeoutError())
    mockAdapter.fetchOrder.mockResolvedValue(makeOrder({ status: 'filled' }))

    await processMessage(supabase, makeMsg())

    expect(botResetChain.update).toHaveBeenCalledWith({ consecutive_failures: 0 })
  })

  test('Case B (H-5): createOrder timeout → fetchOrder null → trade UNKNOWN + recon_job (never terminal failed), ack=true', async () => {
    const tradeUnknownChain = sbOk()
    const reconChain        = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),
      tradeUnknownChain, // 6. trades update → unknown (NOT failed — OrderNotFound-after-timeout is uncertain)
      sbOk(),            // 7. audit_logs trade.unknown
      reconChain,        // 8. reconciliation_jobs upsert
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeTimeoutError())
    mockAdapter.fetchOrder.mockResolvedValue(null)

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    // H-5: must NOT write a terminal 'failed' — a live-but-lagged fill would be silently dropped.
    expect(tradeUnknownChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status:       'unknown',
        error_reason: 'order_not_found_after_timeout',
      })
    )
    // A reconciliation job is opened so the resolver re-checks with fresh propagation time.
    expect(reconChain.upsert).toHaveBeenCalledWith(
      { trade_id: TRADE_ID },
      expect.objectContaining({ onConflict: 'trade_id' }),
    )
  })

  test('Case B (H-5/S4A): trade_uncertain_order_not_found log includes original_error_detail from the wrapped cause', async () => {
    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(), // 6. trades update → unknown
      sbOk(), // 7. audit_logs trade.unknown
      sbOk(), // 8. reconciliation_jobs upsert
    )
    // createOrder wraps the unknown ccxt cause as ExchangeUnavailableError WITH a non-secret detail.
    mockAdapter.createOrder.mockRejectedValue(new ExchangeUnavailableError('ExchangeNotAvailable:http_451'))
    mockAdapter.fetchOrder.mockResolvedValue(null)   // OrderNotFound → Case B

    const result = await processMessage(supabase, makeMsg())
    expect(result.ack).toBe(true)

    const errs = consoleErrorSpy.mock.calls.flatMap((a: unknown[]) => {
      try { return [JSON.parse(String(a[0]))] } catch { return [] }
    }) as Array<Record<string, unknown>>
    const log = errs.find(e => e.event === 'trade_uncertain_order_not_found')
    expect(log).toBeDefined()
    expect(log?.original_error).toBe('ExchangeUnavailableError')
    expect(log?.original_error_detail).toBe('ExchangeNotAvailable:http_451')   // previously swallowed
  })

  test('Case C: createOrder timeout → fetchOrder timeout → trade unknown, recon_job upserted, ack=true', async () => {
    const tradeUnknownChain = sbOk()
    const reconChain        = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),
      tradeUnknownChain, // 6. trades update → unknown
      sbOk(),            // 7. audit_logs trade.unknown
      reconChain,        // 8. reconciliation_jobs upsert
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeTimeoutError())
    mockAdapter.fetchOrder.mockRejectedValue(new ExchangeTimeoutError())

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
    expect(tradeUnknownChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unknown' })
    )
    expect(reconChain.upsert).toHaveBeenCalledWith(
      { trade_id: TRADE_ID },
      expect.objectContaining({ onConflict: 'trade_id' }),
    )
  })

  test('H-3: success-path unknown status upserts a reconciliation_job (createOrder resolves unknown)', async () => {
    const tradeUpdate = sbOk()
    const reconChain  = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix(),    // 1-6 (through audit trade.created)
      tradeUpdate,       // 7. trades update → status unknown
      sbOk(),            // 8. audit_logs trade.unknown
      reconChain,        // 9. reconciliation_jobs upsert (H-3)
    )
    // createOrder SUCCEEDS but returns a status ccxt maps to 'unknown' (not a throw → not Case C).
    mockAdapter.createOrder.mockResolvedValue(makeOrder({ status: 'unknown' }))

    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))

    expect(result.ack).toBe(true)
    expect(tradeUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'unknown' }),
    )
    // H-3 fix: the success-path unknown branch now hands off to reconciliation (was missing).
    expect(reconChain.upsert).toHaveBeenCalledWith(
      { trade_id: TRADE_ID },
      expect.objectContaining({ onConflict: 'trade_id' }),
    )
  })
})

// ─── ENG-008 — circuit breaker reset ─────────────────────────────────────────

describe('ENG-008 — circuit breaker reset', () => {
  test('does NOT reset consecutive_failures when order resolves as cancelled', async () => {
    // Queue has exactly 8 chains (6 prefix + 2). If the code erroneously called
    // from('bots').update({consecutive_failures:0}), the 9th call would throw
    // "queue exhausted" and fail the test.
    const supabase = makeSupabase(
      ...buyPrefix({ consecutive_failures: 2 }),
      sbOk(), // 6. trades update → cancelled
      sbOk(), // 7. audit_logs trade.cancelled
    )
    mockAdapter.createOrder.mockResolvedValue(makeOrder({ status: 'cancelled' }))

    const result = await processMessage(supabase, makeMsg())

    expect(result.ack).toBe(true)
  })

  test('resets consecutive_failures to 0 when order resolves as filled', async () => {
    const botResetChain = sbOk()

    const supabase = makeSupabase(
      ...buyPrefix({ consecutive_failures: 3 }),
      sbOk(),        // 6. trades update
      sbOk(),        // 7. audit_logs
      botResetChain, // 8. bots update
    )
    mockAdapter.createOrder.mockResolvedValue(makeOrder({ status: 'filled' }))

    await processMessage(supabase, makeMsg())

    expect(botResetChain.update).toHaveBeenCalledWith({ consecutive_failures: 0 })
  })
})

// ─── DLQ insert failure ───────────────────────────────────────────────────────

describe('DLQ insert failure', () => {
  test('logs dlq_insert_error and returns ack=true — DLQ failure is non-fatal', async () => {
    const supabase = makeSupabase(
      ...buyPrefix(),
      sbOk(),                              // 6.  trades update failed
      sbOk(),                              // 7.  audit_logs trade.failed
      sbErr('TRADES_DLQ_UNIQUE'),          // 8.  trades_dlq insert → ERROR
      sbOk(),                              // 9.  user_exchange_credentials
      sbOk(),                              // 10. bots update error
      sbOk(),                              // 11. audit_logs bot.disabled
    )
    mockAdapter.createOrder.mockRejectedValue(new ExchangeAuthError())

    const result = await processMessage(supabase, makeMsg())

    // DLQ failure must not change the ack outcome
    expect(result.ack).toBe(true)

    // dlq_insert_error must be logged with trade_id and error code
    const errorLogs = consoleErrorSpy.mock.calls.flatMap((args: unknown[]) => {
      try   { return [JSON.parse(String(args[0]))] }
      catch { return []                            }
    }) as Array<Record<string, unknown>>

    const dlqLog = errorLogs.find(e => e.event === 'dlq_insert_error')
    expect(dlqLog).toBeDefined()
    expect(dlqLog?.trade_id).toBe(TRADE_ID)
    expect(dlqLog?.error).toBe('TRADES_DLQ_UNIQUE')
  })
})

// ─── validateEnv ─────────────────────────────────────────────────────────────

describe('validateEnv', () => {
  // Save and restore the four env vars this suite touches.
  const TOUCHED_KEYS = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PRAXIS_IS_PRODUCTION',
    'DOPPLER_ENVIRONMENT',
    'QUEUE_ENABLED',
  ] as const

  let savedEnv: Partial<Record<typeof TOUCHED_KEYS[number], string | undefined>>

  // Valid baseline — all required vars present, DOPPLER absent (Railway-like).
  const VALID_ENV = {
    SUPABASE_URL:              'https://sentinel.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sentinel-svc-key',
    PRAXIS_IS_PRODUCTION:      'false',
  }

  beforeEach(() => {
    // Save originals
    savedEnv = Object.fromEntries(TOUCHED_KEYS.map(k => [k, process.env[k]]))

    // Set baseline
    process.env.SUPABASE_URL              = VALID_ENV.SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = VALID_ENV.SUPABASE_SERVICE_ROLE_KEY
    process.env.PRAXIS_IS_PRODUCTION      = VALID_ENV.PRAXIS_IS_PRODUCTION
    delete process.env.DOPPLER_ENVIRONMENT
    delete process.env.QUEUE_ENABLED

    // Mock process.exit so it throws instead of killing the process.
    jest.spyOn(process, 'exit').mockImplementation(
      (_code?: string | number | null | undefined): never => {
        throw new Error('process.exit called')
      }
    )
  })

  afterEach(() => {
    // Restore originals key-by-key
    for (const key of TOUCHED_KEYS) {
      const val = savedEnv[key]
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function parsedLogs(spy: jest.SpyInstance): Array<Record<string, unknown>> {
    return spy.mock.calls.flatMap((args: unknown[]) => {
      try   { return [JSON.parse(String(args[0])) as Record<string, unknown>] }
      catch { return [] }
    })
  }

  // ── Happy path ───────────────────────────────────────────────────────────────

  test('returns supabaseUrl, serviceRoleKey, isProduction when all required vars set', () => {
    const result = validateEnv()

    expect(result.supabaseUrl).toBe(VALID_ENV.SUPABASE_URL)
    // serviceRoleKey value not asserted — no secret values in test output
    expect(typeof result.serviceRoleKey).toBe('string')
    expect(result.isProduction).toBe(false)
  })

  test('isProduction=true when PRAXIS_IS_PRODUCTION="true"', () => {
    process.env.PRAXIS_IS_PRODUCTION = 'true'
    const result = validateEnv()
    expect(result.isProduction).toBe(true)
  })

  test('isProduction=false when PRAXIS_IS_PRODUCTION="false"', () => {
    process.env.PRAXIS_IS_PRODUCTION = 'false'
    const result = validateEnv()
    expect(result.isProduction).toBe(false)
  })

  // ── DOPPLER_ENVIRONMENT handling ─────────────────────────────────────────────

  test('logs DOPPLER_ENVIRONMENT name when set — does not exit', () => {
    process.env.DOPPLER_ENVIRONMENT = 'dev'

    expect(() => validateEnv()).not.toThrow()

    const logs = parsedLogs(jest.mocked(console.log))
    const envLog = logs.find(e => e.event === 'startup_env')
    expect(envLog?.environment).toBe('dev')
  })

  test('does NOT exit when DOPPLER_ENVIRONMENT is absent — Railway-safe', () => {
    // DOPPLER_ENVIRONMENT is absent (as in Railway Doppler integration)
    expect(() => validateEnv()).not.toThrow()
    expect(process.exit).not.toHaveBeenCalled()
  })

  test('logs environment=unknown when DOPPLER_ENVIRONMENT is absent', () => {
    validateEnv()

    const logs = parsedLogs(jest.mocked(console.log))
    const envLog = logs.find(e => e.event === 'startup_env')
    expect(envLog?.environment).toBe('unknown')
  })

  // ── Missing required vars ─────────────────────────────────────────────────────

  test('exits(1) with missing_env_vars when SUPABASE_URL is absent', () => {
    delete process.env.SUPABASE_URL
    expect(() => validateEnv()).toThrow('process.exit called')

    const errors = parsedLogs(consoleErrorSpy)
    const err = errors.find(e => e.reason === 'missing_env_vars')
    expect(err?.missing).toContain('SUPABASE_URL')
  })

  test('exits(1) with missing_env_vars when SUPABASE_SERVICE_ROLE_KEY is absent', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => validateEnv()).toThrow('process.exit called')

    const errors = parsedLogs(consoleErrorSpy)
    const err = errors.find(e => e.reason === 'missing_env_vars')
    expect(err?.missing).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  test('exits(1) with missing_env_vars when PRAXIS_IS_PRODUCTION is absent', () => {
    delete process.env.PRAXIS_IS_PRODUCTION
    expect(() => validateEnv()).toThrow('process.exit called')

    const errors = parsedLogs(consoleErrorSpy)
    const err = errors.find(e => e.reason === 'missing_env_vars')
    expect(err?.missing).toContain('PRAXIS_IS_PRODUCTION')
  })

  // ── Invalid value ─────────────────────────────────────────────────────────────

  test('exits(1) with invalid_env_var when PRAXIS_IS_PRODUCTION is not "true" or "false"', () => {
    process.env.PRAXIS_IS_PRODUCTION = 'yes'
    expect(() => validateEnv()).toThrow('process.exit called')

    const errors = parsedLogs(consoleErrorSpy)
    const err = errors.find(e => e.reason === 'invalid_env_var')
    expect(err?.var).toBe('PRAXIS_IS_PRODUCTION')
  })

  // ── QUEUE_ENABLED parsing ─────────────────────────────────────────────────────

  test('queueEnabled defaults to false when QUEUE_ENABLED is absent', () => {
    // baseline beforeEach deletes QUEUE_ENABLED
    const result = validateEnv()
    expect(result.queueEnabled).toBe(false)
    expect(process.exit).not.toHaveBeenCalled()
  })

  test('queueEnabled=true when QUEUE_ENABLED="true"', () => {
    process.env.QUEUE_ENABLED = 'true'
    const result = validateEnv()
    expect(result.queueEnabled).toBe(true)
  })

  test('queueEnabled=false when QUEUE_ENABLED="false"', () => {
    process.env.QUEUE_ENABLED = 'false'
    const result = validateEnv()
    expect(result.queueEnabled).toBe(false)
  })

  test('exits(1) with invalid_env_var when QUEUE_ENABLED is not "true"|"false"', () => {
    process.env.QUEUE_ENABLED = 'yes'
    expect(() => validateEnv()).toThrow('process.exit called')

    const errors = parsedLogs(consoleErrorSpy)
    const err = errors.find(e => e.reason === 'invalid_env_var' && e.var === 'QUEUE_ENABLED')
    expect(err).toBeDefined()
  })

  // ── Security: no secret values in logs ───────────────────────────────────────

  test('never logs SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY values', () => {
    validateEnv()

    const allOutput = [
      ...jest.mocked(console.log).mock.calls,
      ...consoleErrorSpy.mock.calls,
    ].map(args => String(args[0])).join('\n')

    // Values must not appear in any log output
    expect(allOutput).not.toContain(VALID_ENV.SUPABASE_URL)
    expect(allOutput).not.toContain(VALID_ENV.SUPABASE_SERVICE_ROLE_KEY)
  })
})

// ─── QUEUE_ENABLED runtime behavior (runWorker / preflightQueue) ──────────────
//
// Regression guard for the PGRST202 every-poll spam observed on Railway:
//   - QUEUE_ENABLED=false → poll loop never runs → pgmq_read never called
//   - QUEUE_ENABLED=true + missing pgmq_read → fail fast (startup_error), once,
//     NOT a repeated queue_read_error per poll interval.

describe('QUEUE_ENABLED runtime behavior', () => {
  // Supabase mock exposing the from() chain boot reconciliation needs plus an
  // rpc() spy so we can assert whether pgmq_read was (not) called.
  function makeSupabaseWithRpc(rpc: jest.Mock): SupabaseClient {
    return {
      // boot reconciliation: trades.select().in().lt().is() → no stuck trades
      from: jest.fn().mockImplementation(() => sbOk([])),
      rpc,
    } as unknown as SupabaseClient
  }

  afterEach(() => {
    // runWorker registers process.once('SIGTERM'|'SIGINT'); clear any that did
    // not fire so listeners never leak across tests.
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  test('QUEUE_ENABLED=false: never calls pgmq_read, logs worker_queue_disabled once', async () => {
    const rpc = jest.fn()
    const supabase = makeSupabaseWithRpc(rpc)

    const p = runWorker(supabase, false)

    // Let boot reconciliation resolve and the disabled branch reach keep-alive.
    await new Promise(resolve => setImmediate(resolve))

    // pgmq_read must never be probed when the queue is disabled.
    expect(rpc).not.toHaveBeenCalled()

    const logs = jest.mocked(console.log).mock.calls
      .flatMap((args: unknown[]) => {
        try   { return [JSON.parse(String(args[0])) as Record<string, unknown>] }
        catch { return [] }
      })
    const disabledLogs = logs.filter(e => e.event === 'worker_queue_disabled')
    expect(disabledLogs).toHaveLength(1)

    // Unblock the keep-alive and let the worker exit cleanly.
    process.emit('SIGTERM')
    await p
  })

  test('QUEUE_ENABLED=true + missing pgmq_read (PGRST202): fails fast, never enters poll loop', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(
      (_code?: string | number | null | undefined): never => {
        throw new Error('process.exit called')
      },
    )
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    const supabase = makeSupabaseWithRpc(rpc)

    // preflightQueue calls process.exit(1) → mocked to throw → propagates.
    await expect(runWorker(supabase, true)).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(1)
    // Preflight probed exactly once — not a per-poll loop.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('pgmq_read', expect.objectContaining({ qty: 0 }))

    const errors = consoleErrorSpy.mock.calls
      .flatMap((args: unknown[]) => {
        try   { return [JSON.parse(String(args[0])) as Record<string, unknown>] }
        catch { return [] }
      })
    const startupErr = errors.find(
      e => e.event === 'startup_error' && e.reason === 'queue_rpc_unavailable',
    )
    expect(startupErr).toBeDefined()
  })

  test('PGRST202 is never logged as a repeated queue_read_error', async () => {
    jest.spyOn(process, 'exit').mockImplementation(
      (_code?: string | number | null | undefined): never => {
        throw new Error('process.exit called')
      },
    )
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    const supabase = makeSupabaseWithRpc(rpc)

    await expect(runWorker(supabase, true)).rejects.toThrow('process.exit called')

    const errorEvents = consoleErrorSpy.mock.calls
      .flatMap((args: unknown[]) => {
        try   { return [JSON.parse(String(args[0])) as Record<string, unknown>] }
        catch { return [] }
      })
      .map(e => e.event)

    // The whole point of the redesign: a missing RPC surfaces as ONE startup_error,
    // never as queue_read_error spammed every poll interval.
    expect(errorEvents).not.toContain('queue_read_error')
    expect(errorEvents.filter(e => e === 'startup_error')).toHaveLength(1)
  })
})

// ─── WB7 instrumentation — processing_duration_ms + redelivery counter ───────
//
// Static/unit coverage for the WB7 measurement instrumentation. This does NOT
// perform the gated measured WB7 run (real queue + VT timing on Railway); it only
// proves pollOnce emits the two signals that run will aggregate:
//   1. processing_duration_ms — a non-negative number, per processed message
//   2. read_ct — pgmq's redelivery counter, surfaced verbatim (1 = first delivery,
//      >1 = redelivered → the zero-duplicate-redelivery evidence channel).

describe('WB7 instrumentation — processing_duration_ms + redelivery counter', () => {
  // from()-chain FIFO mock (as makeSupabase) PLUS an rpc() spy for pgmq_read/pgmq_delete.
  function makeSupabaseRpcAndChains(rpc: jest.Mock, ...chains: Chain[]): SupabaseClient {
    const queue = [...chains]
    const from  = jest.fn().mockImplementation((): Chain => {
      const c = queue.shift()
      if (!c) throw new Error('supabase.from() called more times than expected — queue exhausted')
      return c
    })
    return { from, rpc } as unknown as SupabaseClient
  }

  // pgmq_read returns the given message(s); pgmq_delete (ack) succeeds.
  function rpcFor(messages: unknown[]): jest.Mock {
    return jest.fn().mockImplementation((name: string) =>
      name === 'pgmq_read'
        ? Promise.resolve({ data: messages, error: null })
        : Promise.resolve({ data: true, error: null }),
    )
  }

  // Shortest full-processMessage ack path: active bot + terminal existing trade
  // → duplicate_signal → ack:true. Exactly 2 from() chains.
  function duplicateAckChains(): Chain[] {
    return [
      sbChain({ data: { ...DEFAULT_BOT }, error: null }),                  // 1. bots (active)
      sbChain({ data: { id: TRADE_ID, status: 'filled' }, error: null }), // 2. trades (terminal)
    ]
  }

  function parsedLogs(): Array<Record<string, unknown>> {
    return jest.mocked(console.log).mock.calls.flatMap((a: unknown[]) => {
      try   { return [JSON.parse(String(a[0])) as Record<string, unknown>] }
      catch { return [] }
    })
  }

  test('ack path: logs message_processed with numeric processing_duration_ms and read_ct', async () => {
    const msg = makeMsg()
    const rpc = rpcFor([msg])
    const supabase = makeSupabaseRpcAndChains(rpc, ...duplicateAckChains())

    await pollOnce(supabase)

    const logs = parsedLogs()

    const received = logs.find(e => e.event === 'message_received')
    expect(received?.read_ct).toBe(1)

    const processed = logs.find(e => e.event === 'message_processed')
    expect(processed).toBeDefined()
    expect(processed?.ack).toBe(true)
    expect(processed?.read_ct).toBe(1)
    expect(typeof processed?.processing_duration_ms).toBe('number')
    expect(processed?.processing_duration_ms as number).toBeGreaterThanOrEqual(0)

    // Ack path deletes (acks) the message.
    expect(rpc).toHaveBeenCalledWith('pgmq_delete', expect.objectContaining({ msg_id: msg.msg_id }))
  })

  test('redelivery: surfaces read_ct > 1 verbatim in both log lines', async () => {
    const msg = { ...makeMsg(), read_ct: 2 }
    const rpc = rpcFor([msg])
    const supabase = makeSupabaseRpcAndChains(rpc, ...duplicateAckChains())

    await pollOnce(supabase)

    const logs = parsedLogs()
    expect(logs.find(e => e.event === 'message_received')?.read_ct).toBe(2)
    expect(logs.find(e => e.event === 'message_processed')?.read_ct).toBe(2)
  })

  test('empty queue: no message_processed and no duration emitted', async () => {
    const rpc = rpcFor([])
    const supabase = makeSupabaseRpcAndChains(rpc)

    await pollOnce(supabase)

    const logs = parsedLogs()
    expect(logs.find(e => e.event === 'message_received')).toBeUndefined()
    expect(logs.find(e => e.event === 'message_processed')).toBeUndefined()
  })
})

// ─── 4A — order-lifecycle audit fail-closed (live tier + flag) ────────────────
describe('4A — order-lifecycle audit fail-closed', () => {
  const MAINNET_CRED = { ...VALID_CRED, exchange_environment: 'mainnet' }

  function setEnv(overrides: Record<string, string | undefined>): () => void {
    const prev: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(overrides)) {
      prev[k] = process.env[k]
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
    return () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v
      }
    }
  }
  const prodFailClosed = () => setEnv({
    PRAXIS_IS_PRODUCTION:      'true',
    AUDIT_FAIL_CLOSED_ENABLED: 'true',
    EXCHANGE_HTTPS_PROXY:      'http://proxy.test:8080',
  })
  // chains 1-4: gates (prod, mainnet credential); H-2: the pending reservation is the default-success
  // rpc from makeSupabase (no daily-cap query, no separate insert chain).
  const prodPrefix = (): Chain[] => [
    sbChain({ data: { ...DEFAULT_BOT }, error: null }),   // 1 bots
    sbChain({ data: null, error: null }),                 // 2 trades maybeSingle
    sbCount(0),                                           // 3 count (3.5)
    sbChain({ data: { ...MAINNET_CRED }, error: null }),  // 4 credentials (4a)
    sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges (EP1b venue gate)
    // [rpc insert_pending_trade_atomic → success (default)]
  ]
  const errEvents = () => consoleErrorSpy.mock.calls
    .map((c) => { try { return JSON.parse(String(c[0])) as Record<string, unknown> } catch { return {} } })

  test('HB-A: prod+fail-closed + trade.created audit fails ⇒ NO order, PRE-ORDER BLOCK (not a failure), alert, ack', async () => {
    const restore = prodFailClosed()
    try {
      const blockMark = sbOk()
      const supabase = makeSupabase(
        ...prodPrefix(),
        sbChain({ data: null, error: { code: 'AUDITFAIL' } }), // 6 audit trade.created → FAIL
        blockMark,                                             // 7 trades update → pre-order block
      )
      const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
      expect(result).toEqual({ ack: true })
      expect(mockAdapter.createOrder).not.toHaveBeenCalled()   // no order was ever sent to the exchange
      // Recorded as a PRE-ORDER SAFETY BLOCK, not an ordinary exchange/order failure.
      expect(blockMark.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'cancelled', error_reason: 'audit_blocked_before_order' }),
      )
      expect(blockMark.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
      expect(blockMark.update).not.toHaveBeenCalledWith(expect.objectContaining({ error_reason: 'audit_write_failed' }))
      // Block terminology in the evidence event; terminal status ⇒ a retry dedups cleanly (Step 3), no ambiguity.
      expect(errEvents().some((e) => e.event === 'order_blocked_audit_unavailable')).toBe(true)
      expect(errEvents().some((e) => e.event === 'order_aborted_audit_unavailable')).toBe(false)
    } finally { restore() }
  })

  test('HB-A: prod+fail-closed + trade.created audit succeeds ⇒ order proceeds', async () => {
    const restore = prodFailClosed()
    try {
      const supabase = makeSupabase(
        ...prodPrefix(),
        sbOk(), // 6 audit trade.created OK
        sbOk(), // 7 trades update (fill)
        sbOk(), // 8 audit trade.filled
      )
      const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
      expect(result).toEqual({ ack: true })
      expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)
    } finally { restore() }
  })

  test('HB-B: prod+fail-closed + post-order fill audit fails ⇒ alert, trade NOT reverted, ack', async () => {
    const restore = prodFailClosed()
    try {
      const fill = sbOk()
      const supabase = makeSupabase(
        ...prodPrefix(),
        sbOk(),                                                // 6 audit trade.created OK
        fill,                                                  // 7 trades update (fill)
        sbChain({ data: null, error: { code: 'AUDITFAIL' } }), // 8 audit trade.filled → FAIL
      )
      const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
      expect(result).toEqual({ ack: true })
      expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)          // order was placed
      expect(fill.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'filled' })) // NOT reverted
      expect(errEvents().some((e) => e.event === 'audit_write_failed_post_order')).toBe(true)
    } finally { restore() }
  })

  test('testnet: trade.created audit fails ⇒ order STILL proceeds (non-fatal; ergonomics preserved)', async () => {
    // testnet default (isProduction=false) → auditFailClosed=false. Testnet credential, no proxy.
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT }, error: null }),
      sbChain({ data: null, error: null }),
      sbCount(0),
      sbChain({ data: { ...VALID_CRED }, error: null }),      // testnet cred
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }),  // 4a.6 exchanges (EP1b venue gate)
      sbChain({ data: [], error: null }),
      sbChain({ data: { id: TRADE_ID }, error: null }),
      sbChain({ data: null, error: { code: 'AUDITFAIL' } }),  // audit trade.created → FAIL (non-fatal)
      sbOk(),                                                 // trades update (fill)
      sbOk(),                                                 // audit trade.filled
    )
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: true })
    expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1) // order proceeds despite audit failure
  })

  test('prod + flag OFF ⇒ trade.created audit failure is non-fatal (dark default; order proceeds)', async () => {
    const restore = setEnv({
      PRAXIS_IS_PRODUCTION:      'true',
      AUDIT_FAIL_CLOSED_ENABLED: undefined, // flag OFF
      EXCHANGE_HTTPS_PROXY:      'http://proxy.test:8080',
    })
    try {
      const supabase = makeSupabase(
        ...prodPrefix(),
        sbChain({ data: null, error: { code: 'AUDITFAIL' } }), // audit trade.created → FAIL
        sbOk(),                                                // trades update (fill)
        sbOk(),                                                // audit trade.filled
      )
      const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
      expect(result).toEqual({ ack: true })
      expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1) // no abort when flag off
    } finally { restore() }
  })
})

// ─── EP7 — latency instrumentation (trade_timing) ──────────────────────────────────────────────────
describe('EP7 — trade_timing latency log', () => {
  test('a successful BUY emits trade_timing with per-stage ms + the venue (logging-only)', async () => {
    // Deterministic injected clock: each now() advances 5ms, so stage deltas are positive + finite.
    let clock = 1000
    const now = () => { clock += 5; return clock }
    mockAdapter.createOrder.mockResolvedValue(makeOrder({ status: 'filled' }))
    const supabase = makeSupabase(
      ...buyPrefix(),   // 1-6 (bot, trades, count, cred, exchanges, audit trade.created)
      sbOk(),           // trades update (fill)
      sbOk(),           // audit trade.filled
    )
    await processMessage(supabase, makeMsg({ side: 'buy' }), { now })

    const logs = (console.log as unknown as jest.Mock).mock.calls
      .map((c) => { try { return JSON.parse(String(c[0])) } catch { return null } })
      .filter(Boolean) as Array<Record<string, unknown>>
    const timing = logs.find((e) => e.event === 'trade_timing')
    expect(timing).toBeDefined()
    expect(timing!.exchange).toBe('binance')
    expect(timing!.side).toBe('buy')
    const ms = timing!.ms as Record<string, number>
    for (const k of ['setup', 'pre_order', 'order', 'total']) {
      expect(typeof ms[k]).toBe('number')
      expect(ms[k]).toBeGreaterThanOrEqual(0)
    }
    expect(ms.total).toBeGreaterThanOrEqual(ms.order) // total spans the order round-trip
  })
})

// ─── EP4 futures cage — worker fail-closes on any non-spot account_type ─────────────────────────────
describe('EP4 futures cage — non-spot account_type is refused (never mis-executed as spot)', () => {
  test('account_type=futures → blocked at Step 4b BEFORE the adapter; ack; no order; audited', async () => {
    const audit = sbOk()
    const supabase = makeSupabase(
      sbChain({ data: { ...DEFAULT_BOT, account_type: 'futures' }, error: null }), // 1 bots
      sbChain({ data: null, error: null }),                  // 2 trades maybeSingle
      sbCount(0),                                            // 3 count
      sbChain({ data: { ...VALID_CRED }, error: null }),     // 4 credentials
      sbChain({ data: { ...VALID_EXCHANGE }, error: null }), // 4a.6 exchanges
      audit,                                                 // 5 order.blocked
    )
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result).toEqual({ ack: true })
    expect(MockAdapter).not.toHaveBeenCalled()               // never built an adapter for a futures bot
    expect(audit.insert).toHaveBeenCalledWith(expect.objectContaining({
      event_type:  'order.blocked',
      after_state: expect.objectContaining({ reason: 'account_type_not_supported' }),
    }))
  })

  test('account_type=spot (and legacy null) still proceed to a normal spot order', async () => {
    // spot: full happy BUY runs to createOrder (proves the gate does not block spot).
    mockAdapter.createOrder.mockResolvedValue(makeOrder({ status: 'filled' }))
    const supabase = makeSupabase(...buyPrefix(), sbOk(), sbOk())
    const result = await processMessage(supabase, makeMsg({ side: 'buy' }))
    expect(result.ack).toBe(true)
    expect(mockAdapter.createOrder).toHaveBeenCalledTimes(1)
  })
})
