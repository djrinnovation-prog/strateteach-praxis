/**
 * BinanceAdapter.test.ts
 *
 * Unit tests for BinanceAdapter.
 * All ccxt calls are mocked — no real Binance, no real network.
 * All Vault calls use a mock SecretsProvider.
 *
 * Test matrix:
 *
 *   fetchBalance
 *     Happy path              — ccxt Balances mapped to domain Balance
 *     Meta keys stripped      — info/timestamp/datetime/free/used/total not in result
 *     Timeout                 → ExchangeTimeoutError
 *     Network error           → ExchangeUnavailableError
 *     Credentials zeroed      — exchange.apiKey/secret = '' in finally
 *     Sandbox mode set        — non-production calls setSandboxMode(true)
 *     Mainnet not called      — non-production never sets mainnet URLs
 *
 *   getMarketRules
 *     Cache miss              — fetches from exchange, returns rules
 *     Cache hit               — second call returns cached rules, no second loadMarkets
 *     Cache TTL expired       — stale cache triggers re-fetch
 *     Lot size filters        — LOT_SIZE filter → stepSize, minQty, qtyPrecision
 *     MIN_NOTIONAL filter     — minNotional correctly extracted
 *     Unknown symbol          — market() returns undefined → ExchangeUnavailableError
 *     Timeout                 → ExchangeTimeoutError
 *
 *   createOrder
 *     Happy path              — market order mapped to domain Order
 *     clientOrderId forwarded — newClientOrderId param passed to ccxt
 *     Status mapping          — closed→filled, open→submitted, canceled→cancelled,
 *                               rejected→failed, expired→failed, unknown→unknown
 *     Partial fill            — open + filled > 0 → submitted (MVP limitation)
 *     Price/cost null         — price=0 and cost=0 map to null
 *     InvalidOrder            → ExchangeRejectedError
 *     InsufficientFunds       → ExchangeRejectedError
 *     BadSymbol               → ExchangeRejectedError
 *     Timeout                 → ExchangeTimeoutError
 *     Network error           → ExchangeUnavailableError
 *     Credentials zeroed      — exchange.apiKey/secret = '' in finally
 *
 *   fetchOrder
 *     By exchangeOrderId      — fetches with exchange ID
 *     By clientOrderId        — fetches with origClientOrderId param
 *     No identifier           → ExchangeUnavailableError
 *     OrderNotFound           → null (not an error)
 *     Timeout                 → ExchangeTimeoutError
 *     Network error           → ExchangeUnavailableError
 *     Credentials zeroed      — exchange.apiKey/secret = '' in finally
 */

import * as ccxt from 'ccxt'
import { inspect } from 'util'
import { BinanceAdapter } from './BinanceAdapter'
import {
  SecretsProvider,
  ExchangeCredentials,
  ExchangeAuthError,
  ExchangeAuthIpError,
  ExchangeRejectedError,
  ExchangeTimeoutError,
  ExchangeUnavailableError,
} from './types'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Second ctor arg is the VAULT secret id (user_exchange_credentials.vault_secret_id),
// resolved by the worker Step 4a — never the credentials row id. (F-01)
const VAULT_SECRET_ID = 'vault-secret-uuid-1234'
const MOCK_CREDENTIALS: ExchangeCredentials = {
  apiKey: 'test-api-key',
  apiSecret: 'test-api-secret',
}

function makeSecretsProvider(creds = MOCK_CREDENTIALS): jest.Mocked<SecretsProvider> {
  return {
    getExchangeCredentials: jest.fn().mockResolvedValue(creds),
  }
}

// ─── ccxt mock factory ────────────────────────────────────────────────────────

// We mock the ccxt.binance constructor so we can intercept exchange instances.
// The mock is module-level so all tests share the same jest.fn() references.

const mockExchangeInstance = {
  setSandboxMode: jest.fn(),
  fetchBalance: jest.fn(),
  loadMarkets: jest.fn(),
  market: jest.fn(),
  createOrder: jest.fn(),
  createOrderWithTakeProfitAndStopLoss: jest.fn(), // EP-protective (venues where has.* is true)
  fetchOrder: jest.fn(),
  fetchTicker: jest.fn(),
  setLeverage: jest.fn(),                          // EP4 futures primitives
  setMarginMode: jest.fn(),
  fetchPositions: jest.fn(),
  precisionMode: 4,  // ccxt.TICK_SIZE — parseMarketRules guard
  has: {} as Record<string, unknown>,              // EP-protective / EP4 per-venue capability flags
  apiKey: 'test-api-key',
  secret: 'test-api-secret',
}

// Records the options object passed to each `new ccxt.binance(opts)` — so tests can assert httpsProxy (A1 B1).
const binanceCtorOpts: Array<Record<string, unknown>> = []

jest.mock('ccxt', () => {
  const actual = jest.requireActual<typeof ccxt>('ccxt')

  // Returning an object from a constructor makes `new` use that object instead of `this`.
  // This means exchange === mockExchangeInstance, so exchange.apiKey = '' mutates it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function MockBinance(opts?: object): any {
    binanceCtorOpts.push((opts ?? {}) as Record<string, unknown>)
    return mockExchangeInstance
  }

  return {
    ...actual,
    binance: MockBinance,
    // EP2: intercept a SECOND venue with the same mock instance so the generic adapter can be driven
    // with exchangeId='bybit' against a non-Binance (ccxt-unified) market/order shape, without a network.
    bybit: MockBinance,
  }
})

// ─── ccxt Order builder ───────────────────────────────────────────────────────

function makeOrder(overrides: Partial<ccxt.Order> = {}): ccxt.Order {
  return {
    id: 'exchange-order-id',
    clientOrderId: 'PRX_abc123',
    datetime: '2026-06-01T00:00:00Z',
    timestamp: 1748736000000,
    lastTradeTimestamp: 0,
    status: 'closed',
    symbol: 'BTC/USDT',
    type: 'market',
    side: 'buy',
    price: 65000,
    amount: 0.001,
    filled: 0.001,
    remaining: 0,
    cost: 65,
    trades: [],
    fee: { cost: 0, currency: 'USDT' },
    reduceOnly: false,
    postOnly: false,
    info: {},
    ...overrides,
  } as ccxt.Order
}

// ─── Balances builder ─────────────────────────────────────────────────────────

function makeBalances(): ccxt.Balances {
  return {
    info: { rawData: 'ignored' },
    BTC: { free: 0.5, used: 0.1, total: 0.6 },
    USDT: { free: 1000, used: 50, total: 1050 },
    // ccxt metadata shape — should be stripped
    free: { BTC: 0.5, USDT: 1000 },
    used: { BTC: 0.1, USDT: 50 },
    total: { BTC: 0.6, USDT: 1050 },
  } as unknown as ccxt.Balances
}

// ─── Market builder ───────────────────────────────────────────────────────────

function makeMarket(overrides: Partial<ccxt.MarketInterface> & { info?: object } = {}): ccxt.Market {
  return {
    id: 'BTCUSDT',
    symbol: 'BTC/USDT',
    base: 'BTC',
    quote: 'USDT',
    baseId: 'BTC',
    quoteId: 'USDT',
    active: true,
    type: 'spot',
    spot: true,
    margin: false,
    swap: false,
    future: false,
    option: false,
    contract: false,
    settle: undefined,
    settleId: undefined,
    contractSize: undefined,
    linear: undefined,
    inverse: undefined,
    expiry: undefined,
    expiryDatetime: undefined,
    strike: undefined,
    optionType: undefined,
    precision: {
      amount: 5,    // 5 decimal places fallback
      price: 2,
    },
    limits: {
      amount: { min: 0.00001, max: 9000 },
      cost:   { min: 10,      max: undefined },
    },
    info: {
      filters: [
        { filterType: 'LOT_SIZE',     stepSize: '0.00001', minQty: '0.00001', maxQty: '9000' },
        { filterType: 'MIN_NOTIONAL', minNotional: '10' },
        { filterType: 'PRICE_FILTER', tickSize: '0.01' },
      ],
    },
    ...overrides,
  } as ccxt.Market
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// A1 B1: a non-secret test proxy URL. Production adapters MUST be built with a proxy
// (ctor invariant), so default one in when isProduction — testnet stays proxy-less.
const TEST_PROXY_URL = 'http://proxy.test.internal:8080'

function makeAdapter(
  sp?: jest.Mocked<SecretsProvider>,
  isProduction = false,
  exchangeHttpsProxy: string | null = isProduction ? TEST_PROXY_URL : null,
  nativeEgressAllowed = false,
): BinanceAdapter {
  return new BinanceAdapter(sp ?? makeSecretsProvider(), VAULT_SECRET_ID, isProduction, exchangeHttpsProxy, nativeEgressAllowed)
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // Reset mutable properties that get zeroed in finally blocks
  mockExchangeInstance.apiKey = 'test-api-key'
  mockExchangeInstance.secret = 'test-api-secret'
  // Cache is process-wide (static, F-03) — isolate tests from each other.
  BinanceAdapter.clearMarketRulesCache()
})

// ─── fetchBalance ─────────────────────────────────────────────────────────────

describe('BinanceAdapter.fetchBalance', () => {
  test('maps ccxt Balances to domain Balance (happy path)', async () => {
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    const adapter = makeAdapter()

    const balance = await adapter.fetchBalance()

    expect(balance).toEqual({
      BTC:  { free: 0.5, used: 0.1, total: 0.6 },
      USDT: { free: 1000, used: 50, total: 1050 },
    })
  })

  test('strips ccxt metadata keys (info, timestamp, datetime, free, used, total)', async () => {
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    const adapter = makeAdapter()

    const balance = await adapter.fetchBalance()

    expect(balance).not.toHaveProperty('info')
    expect(balance).not.toHaveProperty('timestamp')
    expect(balance).not.toHaveProperty('datetime')
    expect(balance).not.toHaveProperty('free')
    expect(balance).not.toHaveProperty('used')
    expect(balance).not.toHaveProperty('total')
  })

  test('throws ExchangeTimeoutError on RequestTimeout', async () => {
    mockExchangeInstance.fetchBalance.mockRejectedValue(new ccxt.RequestTimeout('timeout'))
    const adapter = makeAdapter()

    await expect(adapter.fetchBalance()).rejects.toThrow(ExchangeTimeoutError)
    await expect(adapter.fetchBalance()).rejects.not.toThrow(ExchangeUnavailableError)
  })

  test('throws ExchangeUnavailableError on generic network error', async () => {
    mockExchangeInstance.fetchBalance.mockRejectedValue(new Error('ECONNREFUSED'))
    const adapter = makeAdapter()

    await expect(adapter.fetchBalance()).rejects.toThrow(ExchangeUnavailableError)
  })

  // Plan v1.1 · 1.1 — Binance -2015 disambiguation (arms the mainnet A4 path; latent on testnet).
  test('maps Binance -2015 (invalid key, IP, or permissions) to ExchangeAuthIpError — never ExchangeAuthError', async () => {
    mockExchangeInstance.fetchBalance.mockRejectedValue(
      new ccxt.AuthenticationError('binance {"code":-2015,"msg":"Invalid API-key, IP, or permissions for action."}'),
    )
    const adapter = makeAdapter()

    await expect(adapter.fetchBalance()).rejects.toThrow(ExchangeAuthIpError)
    await expect(adapter.fetchBalance()).rejects.not.toThrow(ExchangeAuthError)
  })

  test('maps a non-2015 auth error (genuinely bad/revoked key) to ExchangeAuthError', async () => {
    mockExchangeInstance.fetchBalance.mockRejectedValue(
      new ccxt.AuthenticationError('binance {"code":-2014,"msg":"API-key format invalid."}'),
    )
    const adapter = makeAdapter()

    await expect(adapter.fetchBalance()).rejects.toThrow(ExchangeAuthError)
    await expect(adapter.fetchBalance()).rejects.not.toThrow(ExchangeAuthIpError)
  })

  test('zeros exchange.apiKey and exchange.secret in finally after success', async () => {
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    const adapter = makeAdapter()

    await adapter.fetchBalance()

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('zeros exchange.apiKey and exchange.secret in finally after error', async () => {
    mockExchangeInstance.fetchBalance.mockRejectedValue(new Error('fail'))
    const adapter = makeAdapter()

    await expect(adapter.fetchBalance()).rejects.toThrow()

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('sets sandbox mode for non-production', async () => {
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    const adapter = makeAdapter(undefined, false)

    await adapter.fetchBalance()

    expect(mockExchangeInstance.setSandboxMode).toHaveBeenCalledWith(true)
  })

  test('does not set sandbox mode for production', async () => {
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    const adapter = makeAdapter(undefined, true)

    await adapter.fetchBalance()

    expect(mockExchangeInstance.setSandboxMode).not.toHaveBeenCalled()
  })
})

// ─── getMarketRules ───────────────────────────────────────────────────────────

describe('BinanceAdapter.getMarketRules', () => {
  test('returns MarketRules parsed from Binance LOT_SIZE and MIN_NOTIONAL filters', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter()

    const rules = await adapter.getMarketRules('BTC/USDT')

    expect(rules).toEqual({
      symbol:          'BTC/USDT',
      stepSize:        0.00001,
      minQty:          0.00001,
      minNotional:     10,
      pricePrecision:  2,
      qtyPrecision:    5,
    })
  })

  test('returns cached rules on second call without re-fetching', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter()

    const first  = await adapter.getMarketRules('BTC/USDT')
    const second = await adapter.getMarketRules('BTC/USDT')

    expect(first).toBe(second) // same reference — from cache
    expect(mockExchangeInstance.loadMarkets).toHaveBeenCalledTimes(1)
  })

  test('re-fetches when cache TTL has expired', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter()

    // Populate cache
    await adapter.getMarketRules('BTC/USDT')

    // Force cache to appear stale by manipulating the private STATIC cache entry (F-03)
    const cache = (BinanceAdapter as unknown as { marketRulesCache: Map<string, { rules: object; cachedAt: number }> })
      .marketRulesCache
    const entry = cache.get('binance:BTC/USDT')!
    cache.set('binance:BTC/USDT', { ...entry, cachedAt: Date.now() - 13 * 60 * 60 * 1000 })

    await adapter.getMarketRules('BTC/USDT')

    expect(mockExchangeInstance.loadMarkets).toHaveBeenCalledTimes(2)
  })

  test('F-03: cache is shared ACROSS adapter instances — per-message adapters stay warm', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())

    // The worker builds a fresh adapter per queue message (Step 4). The whole
    // point of F-03: the second message must NOT pay another loadMarkets().
    const first  = await makeAdapter().getMarketRules('BTC/USDT')
    const second = await makeAdapter().getMarketRules('BTC/USDT')

    expect(first).toBe(second) // same reference — served from the shared cache
    expect(mockExchangeInstance.loadMarkets).toHaveBeenCalledTimes(1)
  })

  test('derives qtyPrecision from stepSize (LOT_SIZE filter)', async () => {
    const market = makeMarket()
    ;((market as unknown as { info: object }).info as { filters: object[] }).filters = [
      { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '1000' },
      { filterType: 'MIN_NOTIONAL', minNotional: '5' },
    ]
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(market)
    const adapter = makeAdapter()

    const rules = await adapter.getMarketRules('ETH/USDT')

    expect(rules.stepSize).toBe(0.001)
    expect(rules.qtyPrecision).toBe(3)
  })

  test('converts pricePrecision from TICK_SIZE to decimal places (Binance ccxt mode)', async () => {
    // ccxt returns Binance price precision as a tick size (e.g. 0.01),
    // not as decimal places (e.g. 2). Spike confirmed: real Binance returns 0.01.
    const market = makeMarket()
    ;(market as unknown as { precision: object }).precision = {
      amount: 0.00001, // step size for qty
      price:  0.01,    // tick size for price — ccxt TICK_SIZE mode
    }
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(market)
    const adapter = makeAdapter()

    const rules = await adapter.getMarketRules('BTC/USDT')

    // 0.01 tick → 2 decimal places
    expect(rules.pricePrecision).toBe(2)
    // 0.00001 step → 5 decimal places
    expect(rules.qtyPrecision).toBe(5)
  })

  test('throws ExchangeUnavailableError when market() returns undefined', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(undefined)
    const adapter = makeAdapter()

    await expect(adapter.getMarketRules('UNKNOWN/USDT')).rejects.toThrow(ExchangeUnavailableError)
  })

  // ─── H-3: poisoned exchange filters must be rejected (and never cached) ───────
  test('H-3: LOT_SIZE stepSize "0.00000000" → rejected (ExchangeUnavailableError), NOT cached', async () => {
    const market = makeMarket()
    ;((market as unknown as { info: { filters: object[] } }).info).filters = [
      { filterType: 'LOT_SIZE', stepSize: '0.00000000', minQty: '0.00001', maxQty: '9000' },
      { filterType: 'MIN_NOTIONAL', minNotional: '10' },
    ]
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(market)
    const adapter = makeAdapter()

    await expect(adapter.getMarketRules('BTC/USDT')).rejects.toThrow(ExchangeUnavailableError)
    // Not cached — a second call re-fetches (bad rules were never stored for 12h).
    await expect(adapter.getMarketRules('BTC/USDT')).rejects.toThrow(ExchangeUnavailableError)
    expect(mockExchangeInstance.loadMarkets).toHaveBeenCalledTimes(2)
  })

  test('H-3: LOT_SIZE stepSize that parses to NaN → rejected', async () => {
    const market = makeMarket()
    ;((market as unknown as { info: { filters: object[] } }).info).filters = [
      { filterType: 'LOT_SIZE', stepSize: 'not-a-number', minQty: '0.00001', maxQty: '9000' },
      { filterType: 'MIN_NOTIONAL', minNotional: '10' },
    ]
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(market)

    await expect(makeAdapter().getMarketRules('BTC/USDT')).rejects.toThrow(ExchangeUnavailableError)
  })

  test('H-3: MIN_NOTIONAL that parses to NaN → rejected', async () => {
    const market = makeMarket()
    ;((market as unknown as { info: { filters: object[] } }).info).filters = [
      { filterType: 'LOT_SIZE', stepSize: '0.00001', minQty: '0.00001', maxQty: '9000' },
      { filterType: 'MIN_NOTIONAL', minNotional: 'oops' },
    ]
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(market)

    await expect(makeAdapter().getMarketRules('BTC/USDT')).rejects.toThrow(ExchangeUnavailableError)
  })

  test('throws ExchangeTimeoutError on loadMarkets timeout', async () => {
    mockExchangeInstance.loadMarkets.mockRejectedValue(new ccxt.RequestTimeout('timeout'))
    const adapter = makeAdapter()

    await expect(adapter.getMarketRules('BTC/USDT')).rejects.toThrow(ExchangeTimeoutError)
  })

  test('sets sandbox mode for non-production market data calls', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter(undefined, false)

    await adapter.getMarketRules('BTC/USDT')

    expect(mockExchangeInstance.setSandboxMode).toHaveBeenCalledWith(true)
  })

  test('does not set sandbox mode for production market data calls', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter(undefined, true)

    await adapter.getMarketRules('BTC/USDT')

    expect(mockExchangeInstance.setSandboxMode).not.toHaveBeenCalled()
  })
})

// ─── fetchPrice ─────────────────────────────────────────────────────────────────

describe('BinanceAdapter.fetchPrice', () => {
  test('returns the ticker last price (public market data)', async () => {
    mockExchangeInstance.fetchTicker.mockResolvedValue({ last: 59_000 } as unknown as ccxt.Ticker)
    const adapter = makeAdapter()

    expect(await adapter.fetchPrice('BTC/USDT')).toBe(59_000)
    expect(mockExchangeInstance.fetchTicker).toHaveBeenCalledWith('BTC/USDT')
  })

  test('throws ExchangeUnavailableError(no_last_price) when last is missing', async () => {
    mockExchangeInstance.fetchTicker.mockResolvedValue({ last: undefined } as unknown as ccxt.Ticker)
    const adapter = makeAdapter()

    await expect(adapter.fetchPrice('BTC/USDT')).rejects.toMatchObject({
      name: 'ExchangeUnavailableError', detail: 'no_last_price',
    })
  })

  test('throws ExchangeUnavailableError(no_last_price) when last <= 0', async () => {
    mockExchangeInstance.fetchTicker.mockResolvedValue({ last: 0 } as unknown as ccxt.Ticker)
    const adapter = makeAdapter()

    await expect(adapter.fetchPrice('BTC/USDT')).rejects.toMatchObject({ detail: 'no_last_price' })
  })

  test('throws ExchangeTimeoutError on RequestTimeout', async () => {
    mockExchangeInstance.fetchTicker.mockRejectedValue(new ccxt.RequestTimeout('timeout'))
    const adapter = makeAdapter()

    await expect(adapter.fetchPrice('BTC/USDT')).rejects.toThrow(ExchangeTimeoutError)
  })

  test('maps ccxt ExchangeNotAvailable(httpStatus=451) → ExchangeUnavailableError non-secret detail', async () => {
    const orig = new ccxt.ExchangeNotAvailable('blocked')
    ;(orig as unknown as { httpStatus: number }).httpStatus = 451
    mockExchangeInstance.fetchTicker.mockRejectedValue(orig)
    const adapter = makeAdapter()

    await expect(adapter.fetchPrice('BTC/USDT')).rejects.toMatchObject({
      name: 'ExchangeUnavailableError', detail: 'ExchangeNotAvailable:http_451',
    })
  })

  test('uses the public (sandbox in non-production) exchange', async () => {
    mockExchangeInstance.fetchTicker.mockResolvedValue({ last: 1 } as unknown as ccxt.Ticker)
    const adapter = makeAdapter()

    await adapter.fetchPrice('BTC/USDT')
    expect(mockExchangeInstance.setSandboxMode).toHaveBeenCalledWith(true)
  })
})

// ─── createOrder ──────────────────────────────────────────────────────────────

describe('BinanceAdapter.createOrder', () => {
  const ORDER_PARAMS = {
    symbol: 'BTC/USDT',
    side: 'buy' as const,
    type: 'market' as const,
    quantity: 0.001,
    clientOrderId: 'PRX_abc12345',
  }

  test('maps ccxt Order to domain Order (happy path)', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(
      makeOrder({ status: 'closed', price: 65000, cost: 65 })
    )
    const adapter = makeAdapter()

    const order = await adapter.createOrder(ORDER_PARAMS)

    expect(order.id).toBe('exchange-order-id')
    expect(order.clientOrderId).toBe('PRX_abc123')
    expect(order.symbol).toBe('BTC/USDT')
    expect(order.side).toBe('buy')
    expect(order.type).toBe('market')
    expect(order.quantity).toBe(0.001)
    expect(order.filled).toBe(0.001)
    expect(order.price).toBe(65000)
    expect(order.cost).toBe(65)
  })

  test('passes clientOrderId as newClientOrderId to ccxt createOrder', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(makeOrder())
    const adapter = makeAdapter()

    await adapter.createOrder(ORDER_PARAMS)

    expect(mockExchangeInstance.createOrder).toHaveBeenCalledWith(
      'BTC/USDT',
      'market',
      'buy',
      0.001,
      undefined,
      { newClientOrderId: 'PRX_abc12345' },
    )
  })

  test.each([
    ['closed',    'filled'],
    ['open',      'submitted'],
    ['canceled',  'cancelled'],
    ['cancelled', 'cancelled'],
    ['rejected',  'failed'],
    ['expired',   'failed'],
    ['unknown',   'unknown'],
  ])('maps ccxt status "%s" → domain status "%s"', async (ccxtStatus, domainStatus) => {
    mockExchangeInstance.createOrder.mockResolvedValue(
      makeOrder({ status: ccxtStatus as ccxt.Order['status'] })
    )
    const adapter = makeAdapter()

    const order = await adapter.createOrder(ORDER_PARAMS)

    expect(order.status).toBe(domainStatus)
  })

  test('maps partial fill (open + filled > 0) to submitted — MVP limitation', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(
      makeOrder({ status: 'open', filled: 0.0005, amount: 0.001 })
    )
    const adapter = makeAdapter()

    const order = await adapter.createOrder(ORDER_PARAMS)

    expect(order.status).toBe('submitted')
  })

  test('maps price=0 to null', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(
      makeOrder({ status: 'open', price: 0, cost: 0 })
    )
    const adapter = makeAdapter()

    const order = await adapter.createOrder(ORDER_PARAMS)

    expect(order.price).toBeNull()
    expect(order.cost).toBeNull()
  })

  test('throws ExchangeRejectedError on InvalidOrder', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.InvalidOrder('bad order'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toThrow(ExchangeRejectedError)
  })

  test('throws ExchangeRejectedError on InsufficientFunds', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.InsufficientFunds('no funds'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toThrow(ExchangeRejectedError)
  })

  test('throws ExchangeRejectedError on BadSymbol', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.BadSymbol('bad symbol'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toThrow(ExchangeRejectedError)
  })

  test('throws ExchangeTimeoutError on RequestTimeout', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.RequestTimeout('timeout'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toThrow(ExchangeTimeoutError)
  })

  test('throws ExchangeUnavailableError on generic error', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new Error('ECONNRESET'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toThrow(ExchangeUnavailableError)
  })

  test('S4A: ccxt ExchangeNotAvailable(httpStatus=451) → ExchangeUnavailableError detail "ExchangeNotAvailable:http_451"', async () => {
    const orig = new ccxt.ExchangeNotAvailable('upstream blocked')
    ;(orig as unknown as { httpStatus: number }).httpStatus = 451
    mockExchangeInstance.createOrder.mockRejectedValue(orig)
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toMatchObject({
      name:   'ExchangeUnavailableError',
      detail: 'ExchangeNotAvailable:http_451',
    })
  })

  test('S4A: detail falls back to class name only when no httpStatus is present', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.ExchangeNotAvailable('down'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toMatchObject({ detail: 'ExchangeNotAvailable' })
  })

  test('S4A: original error message / credentials never leak through the wrapped error', async () => {
    const orig = new ccxt.ExchangeNotAvailable('api_key=AKIASECRET123&signature=DEADBEEFCAFE')
    ;(orig as unknown as { httpStatus: number }).httpStatus = 451
    mockExchangeInstance.createOrder.mockRejectedValue(orig)
    const adapter = makeAdapter()

    let caught: unknown
    try { await adapter.createOrder(ORDER_PARAMS) } catch (e) { caught = e }

    expect(caught).toBeInstanceOf(ExchangeUnavailableError)
    const err = caught as ExchangeUnavailableError
    expect(err.message).toBe('Exchange: service unavailable')   // static — not the original message
    expect(err.detail).toBe('ExchangeNotAvailable:http_451')    // class/status only
    // Walk every serialization surface — no secret-like token from the original error survives.
    const surfaces = [
      err.message,
      String(err),
      err.detail ?? '',
      JSON.stringify(err),
      JSON.stringify({ ...err }),
      inspect(err, { showHidden: true, depth: null }),
      Object.values(err).join(' '),
    ]
    for (const s of surfaces) {
      expect(s).not.toContain('AKIASECRET123')
      expect(s).not.toContain('DEADBEEFCAFE')
      expect(s).not.toContain('api_key')
      expect(s).not.toContain('signature')
    }
  })

  test('zeros exchange.apiKey and exchange.secret in finally after success', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(makeOrder())
    const adapter = makeAdapter()

    await adapter.createOrder(ORDER_PARAMS)

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('zeros exchange.apiKey and exchange.secret in finally after error', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.InvalidOrder('bad'))
    const adapter = makeAdapter()

    await expect(adapter.createOrder(ORDER_PARAMS)).rejects.toThrow()

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('instanceof check: ExchangeRejectedError is not ExchangeUnavailableError', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.InvalidOrder('bad'))
    const adapter = makeAdapter()

    try {
      await adapter.createOrder(ORDER_PARAMS)
      fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ExchangeRejectedError)
      expect(e).not.toBeInstanceOf(ExchangeUnavailableError)
    }
  })
})

// ─── fetchOrder ───────────────────────────────────────────────────────────────

describe('BinanceAdapter.fetchOrder', () => {
  test('fetches by exchangeOrderId when provided', async () => {
    mockExchangeInstance.fetchOrder.mockResolvedValue(makeOrder())
    const adapter = makeAdapter()

    const order = await adapter.fetchOrder({
      exchangeOrderId: 'exchange-order-id',
      symbol: 'BTC/USDT',
    })

    expect(mockExchangeInstance.fetchOrder).toHaveBeenCalledWith('exchange-order-id', 'BTC/USDT')
    expect(order).not.toBeNull()
    expect(order!.id).toBe('exchange-order-id')
  })

  test('fetches by clientOrderId using origClientOrderId param', async () => {
    mockExchangeInstance.fetchOrder.mockResolvedValue(makeOrder())
    const adapter = makeAdapter()

    await adapter.fetchOrder({
      clientOrderId: 'PRX_abc12345',
      symbol: 'BTC/USDT',
    })

    expect(mockExchangeInstance.fetchOrder).toHaveBeenCalledWith(
      'PRX_abc12345',
      'BTC/USDT',
      { origClientOrderId: 'PRX_abc12345' },
    )
  })

  test('prefers exchangeOrderId over clientOrderId when both are provided', async () => {
    mockExchangeInstance.fetchOrder.mockResolvedValue(makeOrder())
    const adapter = makeAdapter()

    await adapter.fetchOrder({
      exchangeOrderId: 'ex-id',
      clientOrderId: 'PRX_abc',
      symbol: 'BTC/USDT',
    })

    // Should use fetchOrder(exchangeOrderId, symbol) — the 2-arg form
    expect(mockExchangeInstance.fetchOrder).toHaveBeenCalledWith('ex-id', 'BTC/USDT')
  })

  test('returns null when OrderNotFound (not an error)', async () => {
    mockExchangeInstance.fetchOrder.mockRejectedValue(new ccxt.OrderNotFound('not found'))
    const adapter = makeAdapter()

    const result = await adapter.fetchOrder({
      exchangeOrderId: 'unknown-id',
      symbol: 'BTC/USDT',
    })

    expect(result).toBeNull()
  })

  test('throws ExchangeUnavailableError when neither identifier is provided', async () => {
    const adapter = makeAdapter()

    await expect(adapter.fetchOrder({ symbol: 'BTC/USDT' })).rejects.toThrow(ExchangeUnavailableError)
  })

  test('throws ExchangeTimeoutError on RequestTimeout', async () => {
    mockExchangeInstance.fetchOrder.mockRejectedValue(new ccxt.RequestTimeout('timeout'))
    const adapter = makeAdapter()

    await expect(
      adapter.fetchOrder({ exchangeOrderId: 'ex-id', symbol: 'BTC/USDT' })
    ).rejects.toThrow(ExchangeTimeoutError)
  })

  test('throws ExchangeUnavailableError on generic error', async () => {
    mockExchangeInstance.fetchOrder.mockRejectedValue(new Error('ECONNREFUSED'))
    const adapter = makeAdapter()

    await expect(
      adapter.fetchOrder({ exchangeOrderId: 'ex-id', symbol: 'BTC/USDT' })
    ).rejects.toThrow(ExchangeUnavailableError)
  })

  test('S4A: ccxt ExchangeNotAvailable(httpStatus=451) → ExchangeUnavailableError detail "ExchangeNotAvailable:http_451"', async () => {
    const orig = new ccxt.ExchangeNotAvailable('upstream blocked')
    ;(orig as unknown as { httpStatus: number }).httpStatus = 451
    mockExchangeInstance.fetchOrder.mockRejectedValue(orig)
    const adapter = makeAdapter()

    await expect(
      adapter.fetchOrder({ exchangeOrderId: 'ex-id', symbol: 'BTC/USDT' })
    ).rejects.toMatchObject({ name: 'ExchangeUnavailableError', detail: 'ExchangeNotAvailable:http_451' })
  })

  test('zeros exchange.apiKey and exchange.secret in finally after success', async () => {
    mockExchangeInstance.fetchOrder.mockResolvedValue(makeOrder())
    const adapter = makeAdapter()

    await adapter.fetchOrder({ exchangeOrderId: 'ex-id', symbol: 'BTC/USDT' })

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('zeros exchange.apiKey and exchange.secret in finally after error', async () => {
    mockExchangeInstance.fetchOrder.mockRejectedValue(new ccxt.RequestTimeout('timeout'))
    const adapter = makeAdapter()

    await expect(
      adapter.fetchOrder({ exchangeOrderId: 'ex-id', symbol: 'BTC/USDT' })
    ).rejects.toThrow()

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('zeros exchange credentials even when OrderNotFound returns null', async () => {
    mockExchangeInstance.fetchOrder.mockRejectedValue(new ccxt.OrderNotFound('not found'))
    const adapter = makeAdapter()

    await adapter.fetchOrder({ exchangeOrderId: 'ex-id', symbol: 'BTC/USDT' })

    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })
})

// ─── A1 Option B — exchange egress proxy (httpsProxy) wiring ────────────────────
//
// Invariants under test (see docs/production-a1-b1-proxy-wiring-packet.md):
//   • production + missing proxy → fails closed BEFORE any ccxt instance is constructed
//   • production + proxy set     → httpsProxy passed to the AUTHENTICATED ccxt instance
//   • production + proxy set     → httpsProxy passed to the PUBLIC ccxt instance
//   • testnet + no proxy         → no httpsProxy on any ccxt instance (unchanged behaviour)
//   • proxy error                → ExchangeUnavailableError, never a proxy-less direct retry
//   • proxy URL                  → never surfaces in return values, thrown errors, or console output

describe('BinanceAdapter — A1 exchange egress proxy (httpsProxy)', () => {
  const authCtorOpts = () => binanceCtorOpts.filter((o) => 'apiKey' in o)
  const publicCtorOpts = () => binanceCtorOpts.filter((o) => !('apiKey' in o))
  const PROXY_HOST = 'proxy.test.internal'

  test('production + NO proxy + NO native egress → fails closed BEFORE constructing any ccxt instance (B0)', () => {
    binanceCtorOpts.length = 0

    expect(() => new BinanceAdapter(makeSecretsProvider(), VAULT_SECRET_ID, true, null, false)).toThrow(
      /egress unconfigured in production/i,
    )
    // Ctor threw before any factory ran → no ccxt.binance was ever built.
    expect(binanceCtorOpts).toHaveLength(0)
  })

  test('B0: production + native egress (no proxy) → constructs, and NO httpsProxy on any ccxt instance (direct)', async () => {
    binanceCtorOpts.length = 0
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter(undefined, true, null, true) // production, no proxy, native egress ALLOWED

    await adapter.fetchBalance()
    await adapter.getMarketRules('BTC/USDT')

    expect(binanceCtorOpts.length).toBeGreaterThan(0)
    for (const opts of binanceCtorOpts) {
      expect(opts).not.toHaveProperty('httpsProxy') // native = DIRECT egress via the static IPs, no proxy
    }
  })

  test('B0: production + proxy set STILL takes precedence (proxy mode) even if native flag is false', () => {
    // sanity: proxy path unchanged; ctor does not throw with a proxy.
    expect(() => new BinanceAdapter(makeSecretsProvider(), VAULT_SECRET_ID, true, TEST_PROXY_URL, false)).not.toThrow()
  })

  test('production + proxy set → httpsProxy passed to the authenticated ccxt instance', async () => {
    binanceCtorOpts.length = 0
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    const adapter = makeAdapter(undefined, true, TEST_PROXY_URL)

    await adapter.fetchBalance() // authenticated call

    expect(authCtorOpts().length).toBeGreaterThan(0)
    for (const opts of authCtorOpts()) {
      expect(opts.httpsProxy).toBe(TEST_PROXY_URL)
    }
  })

  test('production + proxy set → httpsProxy passed to the public ccxt instance', async () => {
    binanceCtorOpts.length = 0
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter(undefined, true, TEST_PROXY_URL)

    await adapter.getMarketRules('BTC/USDT') // public (market-data) call

    expect(publicCtorOpts().length).toBeGreaterThan(0)
    for (const opts of publicCtorOpts()) {
      expect(opts.httpsProxy).toBe(TEST_PROXY_URL)
    }
  })

  test('testnet + no proxy → no httpsProxy on any ccxt instance (unchanged)', async () => {
    binanceCtorOpts.length = 0
    mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    const adapter = makeAdapter(undefined, false) // testnet, proxy unset

    await adapter.fetchBalance()
    await adapter.getMarketRules('BTC/USDT')

    expect(binanceCtorOpts.length).toBeGreaterThan(0)
    for (const opts of binanceCtorOpts) {
      expect(opts).not.toHaveProperty('httpsProxy')
    }
  })

  test('proxy error surfaces as ExchangeUnavailableError with NO proxy-less direct retry', async () => {
    binanceCtorOpts.length = 0
    mockExchangeInstance.fetchBalance.mockRejectedValue(new Error('ECONNREFUSED'))
    const adapter = makeAdapter(undefined, true, TEST_PROXY_URL)

    await expect(adapter.fetchBalance()).rejects.toThrow(ExchangeUnavailableError)

    // Every ccxt instance built during the failed call carried the proxy — no direct (proxy-less) fallback.
    expect(binanceCtorOpts.length).toBeGreaterThan(0)
    for (const opts of binanceCtorOpts) {
      expect(opts.httpsProxy).toBe(TEST_PROXY_URL)
    }
  })

  test('proxy URL never appears in return values, thrown errors, or console output', async () => {
    binanceCtorOpts.length = 0
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => undefined),
    )
    try {
      // Success path — proxy must not leak into the mapped return value.
      mockExchangeInstance.fetchBalance.mockResolvedValue(makeBalances())
      const okAdapter = makeAdapter(undefined, true, TEST_PROXY_URL)
      const balance = await okAdapter.fetchBalance()
      expect(JSON.stringify(balance)).not.toContain(PROXY_HOST)

      // Error path — proxy must not leak into the thrown error (message/detail/serialised form).
      mockExchangeInstance.fetchBalance.mockRejectedValue(new Error(`connect ECONNREFUSED ${PROXY_HOST}:8080`))
      const errAdapter = makeAdapter(undefined, true, TEST_PROXY_URL)
      let caught: unknown
      await errAdapter.fetchBalance().catch((e) => {
        caught = e
      })
      expect(caught).toBeInstanceOf(ExchangeUnavailableError)
      const err = caught as Error & { detail?: string }
      expect(err.message).not.toContain(PROXY_HOST)
      expect(err.detail ?? '').not.toContain(PROXY_HOST)

      // No console sink saw the proxy host.
      for (const spy of consoleSpies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(PROXY_HOST)
        }
      }
    } finally {
      consoleSpies.forEach((s) => s.mockRestore())
    }
  })
})

// ─── EP2 — the generic adapter on a NON-Binance venue (Bybit), via the ccxt-unified path ────────
// Proves the SINGLE generic ccxt adapter serves a second venue WITHOUT a bespoke class: market
// rules come from ccxt's UNIFIED precision/limits (TICK_SIZE mode, as every venue uses), the raw
// Binance LOT_SIZE fast-path is NOT taken, and errors map via ccxt's unified exception classes.
// The ccxt mock intercepts `bybit` with the same instance as `binance` (see jest.mock above).
// NOTE: the real Bybit testnet run (nock + on-demand) is the OPERATOR activation gate before
// 'bybit' joins SUPPORTED_EXCHANGES — this suite proves the code is ready for that step.
describe('EP2 — generic adapter on Bybit (ccxt-unified path)', () => {
  const BYBIT_ORDER = {
    symbol: 'BTC/USDT',
    side: 'buy' as const,
    type: 'market' as const,
    quantity: 0.001,
    clientOrderId: 'PRX_bybit0001',
  }

  const makeBybitAdapter = () =>
    new BinanceAdapter(makeSecretsProvider(), VAULT_SECRET_ID, false, null, false, 'bybit')

  // A Bybit-shaped ccxt market: TICK_SIZE precision (amount/price ARE the ticks), unified limits,
  // and NO Binance-style info.filters.
  const bybitMarket = () => makeMarket({
    id:        'BTCUSDT',
    symbol:    'BTC/USDT',
    precision: { amount: 0.001, price: 0.01 },                              // TICK_SIZE ticks
    limits:    { amount: { min: 0.001, max: 100 }, cost: { min: 5, max: undefined } },
    info:      {},                                                         // no Binance filters
  })

  beforeEach(() => {
    mockExchangeInstance.setSandboxMode.mockClear()
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(bybitMarket())
  })

  test('constructs a ccxt bybit instance and applies testnet sandbox in non-production', async () => {
    await makeBybitAdapter().getMarketRules('BTC/USDT')
    expect(mockExchangeInstance.setSandboxMode).toHaveBeenCalledWith(true)
  })

  test('getMarketRules uses ccxt-unified precision/limits (tick-size), not the Binance filter path', async () => {
    const rules = await makeBybitAdapter().getMarketRules('BTC/USDT')
    expect(rules.stepSize).toBeCloseTo(0.001, 12)   // the tick itself, NOT Math.pow(10,-0.001)≈1
    expect(rules.qtyPrecision).toBe(3)              // 0.001 → 3 d.p.
    expect(rules.pricePrecision).toBe(2)            // 0.01  → 2 d.p.
    expect(rules.minQty).toBeCloseTo(0.001, 12)
    expect(rules.minNotional).toBe(5)
  })

  test('a stray Binance-style LOT_SIZE filter on a Bybit market is IGNORED (fast-path gated on exchangeId)', async () => {
    mockExchangeInstance.market.mockReturnValue(makeMarket({
      symbol:    'BTC/USDT',
      precision: { amount: 0.001, price: 0.01 },
      limits:    { amount: { min: 0.001, max: 100 }, cost: { min: 5, max: undefined } },
      info:      { filters: [{ filterType: 'LOT_SIZE', stepSize: '0.00001', minQty: '0.00001' }] },
    }))
    const rules = await makeBybitAdapter().getMarketRules('BTC/USDT')
    expect(rules.stepSize).toBeCloseTo(0.001, 12)   // unified 0.001, NOT the stray filter's 0.00001
    expect(rules.minQty).toBeCloseTo(0.001, 12)
  })

  test('createOrder maps a filled order identically for bybit', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(makeOrder())
    const order = await makeBybitAdapter().createOrder(BYBIT_ORDER)
    expect(order.id).toBe('exchange-order-id')
    expect(order.filled).toBe(0.001)
  })

  test('error mapping is venue-agnostic: a bybit InvalidOrder → ExchangeRejectedError', async () => {
    mockExchangeInstance.createOrder.mockRejectedValue(new ccxt.InvalidOrder('bybit rejected'))
    await expect(makeBybitAdapter().createOrder(BYBIT_ORDER)).rejects.toThrow(ExchangeRejectedError)
  })

  test('secret zeroing still runs for bybit (apiKey/secret cleared after createOrder)', async () => {
    mockExchangeInstance.createOrder.mockResolvedValue(makeOrder())
    mockExchangeInstance.apiKey = 'k'; mockExchangeInstance.secret = 's'
    await makeBybitAdapter().createOrder(BYBIT_ORDER)
    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })
})

// ─── EP-protective — limit orders + native attached protective legs (per-venue fail-closed) ────────
// Limit orders are universal (all venues). Attached protective legs (stop-loss / take-profit) use
// ccxt's createOrderWithTakeProfitAndStopLoss and FAIL-CLOSED on any venue whose has.* flag is false
// (binance/kraken/gate/coinbase) so a requested protection is never silently dropped to a naked entry.
describe('EP-protective — limit + native protective legs', () => {
  const PARAMS = { symbol: 'BTC/USDT', side: 'buy' as const, quantity: 0.001, clientOrderId: 'PRX_prot0001' }

  beforeEach(() => {
    mockExchangeInstance.has = {}
    mockExchangeInstance.createOrder.mockResolvedValue(makeOrder())
    mockExchangeInstance.createOrderWithTakeProfitAndStopLoss.mockResolvedValue(makeOrder())
  })

  test('market, no price/protective/reduceOnly → byte-identical plain createOrder (regression)', async () => {
    await makeAdapter().createOrder({ ...PARAMS, type: 'market' })
    expect(mockExchangeInstance.createOrder).toHaveBeenCalledWith(
      'BTC/USDT', 'market', 'buy', 0.001, undefined, { newClientOrderId: 'PRX_prot0001' },
    )
  })

  test('limit order threads type + price into ccxt.createOrder', async () => {
    await makeAdapter().createOrder({ ...PARAMS, type: 'limit', price: 65000 })
    expect(mockExchangeInstance.createOrder).toHaveBeenCalledWith(
      'BTC/USDT', 'limit', 'buy', 0.001, 65000, { newClientOrderId: 'PRX_prot0001' },
    )
  })

  test('limit order with missing / non-positive price → ExchangeRejectedError; nothing placed', async () => {
    await expect(makeAdapter().createOrder({ ...PARAMS, type: 'limit' })).rejects.toThrow(ExchangeRejectedError)
    await expect(makeAdapter().createOrder({ ...PARAMS, type: 'limit', price: 0 })).rejects.toThrow(ExchangeRejectedError)
    await expect(makeAdapter().createOrder({ ...PARAMS, type: 'limit', price: -5 })).rejects.toThrow(ExchangeRejectedError)
    expect(mockExchangeInstance.createOrder).not.toHaveBeenCalled()
    expect(mockExchangeInstance.createOrderWithTakeProfitAndStopLoss).not.toHaveBeenCalled()
  })

  test('protective legs on a SUPPORTED venue → createOrderWithTakeProfitAndStopLoss(tp, sl); not the plain path', async () => {
    mockExchangeInstance.has = { createOrderWithTakeProfitAndStopLoss: true }
    await makeAdapter().createOrder({ ...PARAMS, type: 'market', stopLossPrice: 60000, takeProfitPrice: 70000 })
    expect(mockExchangeInstance.createOrderWithTakeProfitAndStopLoss).toHaveBeenCalledWith(
      'BTC/USDT', 'market', 'buy', 0.001, undefined, 70000, 60000, { newClientOrderId: 'PRX_prot0001' },
    )
    expect(mockExchangeInstance.createOrder).not.toHaveBeenCalled()
  })

  test('protective legs on an UNSUPPORTED venue (has=false) → ExchangeRejectedError; never a naked entry', async () => {
    mockExchangeInstance.has = {} // createOrderWithTakeProfitAndStopLoss falsy
    await expect(makeAdapter().createOrder({ ...PARAMS, type: 'market', stopLossPrice: 60000 }))
      .rejects.toThrow(ExchangeRejectedError)
    expect(mockExchangeInstance.createOrder).not.toHaveBeenCalled()
    expect(mockExchangeInstance.createOrderWithTakeProfitAndStopLoss).not.toHaveBeenCalled()
  })

  test('reduceOnly is threaded into the ccxt params only when set (EP4 exits; spot ignores)', async () => {
    await makeAdapter().createOrder({ ...PARAMS, type: 'market', reduceOnly: true })
    expect(mockExchangeInstance.createOrder).toHaveBeenCalledWith(
      'BTC/USDT', 'market', 'buy', 0.001, undefined, { newClientOrderId: 'PRX_prot0001', reduceOnly: true },
    )
  })
})

// ─── EP4 — futures primitives (FOUNDATION; dormant, per-venue fail-closed) ─────────────────────────
// setLeverage / setMarginMode / fetchPositions each run authenticated, zero the credentials, and
// FAIL-CLOSED (ExchangeRejectedError) when the venue's ccxt lacks the capability. NOT yet called by
// the order path — the futures money-path wiring is a separate follow-on; futures is NOT armed.
describe('EP4 — futures primitives (foundation)', () => {
  beforeEach(() => {
    mockExchangeInstance.has = {}
    mockExchangeInstance.apiKey = 'k'; mockExchangeInstance.secret = 's'
    mockExchangeInstance.setLeverage.mockResolvedValue(undefined)
    mockExchangeInstance.setMarginMode.mockResolvedValue(undefined)
    mockExchangeInstance.fetchPositions.mockResolvedValue([])
  })

  test('setLeverage on a supported venue → ccxt.setLeverage(leverage, symbol); credentials zeroed', async () => {
    mockExchangeInstance.has = { setLeverage: true }
    await makeAdapter().setLeverage('BTC/USDT:USDT', 5)
    expect(mockExchangeInstance.setLeverage).toHaveBeenCalledWith(5, 'BTC/USDT:USDT')
    expect(mockExchangeInstance.apiKey).toBe('')
    expect(mockExchangeInstance.secret).toBe('')
  })

  test('setLeverage with invalid leverage (0 / NaN / <1) → ExchangeRejectedError; no call', async () => {
    mockExchangeInstance.has = { setLeverage: true }
    for (const bad of [0, 0.5, NaN, -3]) {
      await expect(makeAdapter().setLeverage('BTC/USDT:USDT', bad)).rejects.toThrow(ExchangeRejectedError)
    }
    expect(mockExchangeInstance.setLeverage).not.toHaveBeenCalled()
  })

  test('setLeverage on an UNSUPPORTED venue (has=false, e.g. kraken/coinbase) → ExchangeRejectedError; no call', async () => {
    mockExchangeInstance.has = {}
    await expect(makeAdapter().setLeverage('BTC/USDT:USDT', 5)).rejects.toThrow(ExchangeRejectedError)
    expect(mockExchangeInstance.setLeverage).not.toHaveBeenCalled()
  })

  test('setMarginMode(isolated) on a supported venue → ccxt.setMarginMode; unsupported → ExchangeRejectedError', async () => {
    mockExchangeInstance.has = { setMarginMode: true }
    await makeAdapter().setMarginMode('BTC/USDT:USDT', 'isolated')
    expect(mockExchangeInstance.setMarginMode).toHaveBeenCalledWith('isolated', 'BTC/USDT:USDT')

    mockExchangeInstance.has = {}
    await expect(makeAdapter().setMarginMode('BTC/USDT:USDT', 'isolated')).rejects.toThrow(ExchangeRejectedError)
  })

  test('fetchPositions on a supported venue → normalized Position[]; unsupported → ExchangeRejectedError', async () => {
    mockExchangeInstance.has = { fetchPositions: true }
    mockExchangeInstance.fetchPositions.mockResolvedValue([
      { symbol: 'BTC/USDT:USDT', side: 'long', contracts: 0.01, notional: 650, entryPrice: 65000, leverage: 5, marginMode: 'isolated' },
      { symbol: 'ETH/USDT:USDT', side: 'short', contracts: -2,  notional: 6000, entryPrice: 3000,  leverage: 3, marginMode: 'cross' },
    ])
    const positions = await makeAdapter().fetchPositions()
    expect(positions).toEqual([
      { symbol: 'BTC/USDT:USDT', side: 'long', contracts: 0.01, notional: 650, entryPrice: 65000, leverage: 5, marginMode: 'isolated' },
      { symbol: 'ETH/USDT:USDT', side: 'short', contracts: 2,   notional: 6000, entryPrice: 3000,  leverage: 3, marginMode: 'cross' }, // abs()
    ])
    expect(mockExchangeInstance.apiKey).toBe('')  // credentials zeroed

    mockExchangeInstance.has = {}
    await expect(makeAdapter().fetchPositions()).rejects.toThrow(ExchangeRejectedError)
  })
})

// ─── Audit hardening: constructor unknown-venue + market-rules precisionMode guard ─────────────────
describe('audit hardening', () => {
  test('constructor rejects an unknown exchangeId BEFORE any Vault fetch', () => {
    const sp = makeSecretsProvider()
    expect(() => new BinanceAdapter(sp, VAULT_SECRET_ID, false, null, false, 'nosuchvenue'))
      .toThrow(/unsupported exchange/)
    expect(sp.getExchangeCredentials).not.toHaveBeenCalled()   // no key fetched on the reject path
  })

  test('getMarketRules fail-closes on a non-TICK_SIZE precisionMode venue', async () => {
    mockExchangeInstance.loadMarkets.mockResolvedValue({})
    mockExchangeInstance.market.mockReturnValue(makeMarket())
    mockExchangeInstance.precisionMode = 2   // DECIMAL_PLACES — must be refused
    const adapter = new BinanceAdapter(makeSecretsProvider(), VAULT_SECRET_ID, false, null, false)
    await expect(adapter.getMarketRules('BTCUSDT')).rejects.toThrow(ExchangeUnavailableError)
    mockExchangeInstance.precisionMode = 4   // restore TICK_SIZE for other tests
  })
})
