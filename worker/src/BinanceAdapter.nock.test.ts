// Money-path integration test (T3b) — the REAL BinanceAdapter driving REAL ccxt over HTTP,
// intercepted by `nock` against a faithful Binance-testnet stub. Unlike the unit tests (which
// jest.mock('ccxt')), this exercises ccxt's genuine request-building, signing, response-parsing,
// and the adapter's error-class mapping end to end — the layer mocks skip.
//
// Scope note (honest): nock does NOT validate the HMAC signature — it matches the path/query and
// returns a canned Binance response. Real signature ACCEPTANCE is proven separately by the
// on-demand Binance-testnet run (T3c / ops runbook). This test proves everything up to the wire:
// URL/params, parsing, and error mapping. Deterministic, offline, no secrets. isProduction=false
// (sandbox) => the adapter talks to testnet.binance.vision, which is what nock intercepts.
import nock from 'nock'
import { BinanceAdapter } from './BinanceAdapter'
import {
  ExchangeRejectedError, ExchangeAuthError,
  type SecretsProvider, type ExchangeCredentials,
} from './types'

const HOST = 'https://testnet.binance.vision'

// Minimal-but-faithful exchangeInfo for BTCUSDT (ccxt builds the BTC/USDT market from this).
const EXCHANGE_INFO = {
  timezone: 'UTC', serverTime: 1,
  symbols: [{
    symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT',
    baseAssetPrecision: 8, quoteAssetPrecision: 8, quotePrecision: 8,
    orderTypes: ['LIMIT', 'MARKET'],
    filters: [
      { filterType: 'LOT_SIZE', minQty: '0.00001000', maxQty: '9000.00000000', stepSize: '0.00001000' },
      { filterType: 'PRICE_FILTER', minPrice: '0.01000000', maxPrice: '1000000.00000000', tickSize: '0.01000000' },
      { filterType: 'NOTIONAL', minNotional: '5.00000000', maxNotional: '9000000.00000000', applyMinToMarket: true, applyMaxToMarket: true },
    ],
    permissions: ['SPOT'],
  }],
}

// ccxt's binance loadMarkets() (in sandbox) fetches exchangeInfo for ALL market types — spot,
// USD-M futures, and COIN-M delivery. Only spot carries BTCUSDT; the other two are empty. All
// three must be stubbed or loadMarkets fails on the first unstubbed host.
const FUTURES_HOST = 'https://testnet.binancefuture.com'
const EMPTY_INFO = { timezone: 'UTC', serverTime: 1, symbols: [], assets: [], rateLimits: [] }

const FAKE_CREDS: ExchangeCredentials = { apiKey: 'test-key', apiSecret: 'test-secret' }
const secretsProvider: SecretsProvider = { getExchangeCredentials: async () => ({ ...FAKE_CREDS }) }

// A sandbox (isProduction=false) adapter — no proxy/native egress needed off the production path.
function adapter(): BinanceAdapter {
  return new BinanceAdapter(secretsProvider, 'vault-secret-id', false)
}

// Persist the three exchangeInfo endpoints loadMarkets hits (a new adapter call = a fresh
// ccxt instance = another loadMarkets), so every operation resolves markets.
function stubMarkets(): void {
  nock(HOST).persist().get('/api/v3/exchangeInfo').query(true).reply(200, EXCHANGE_INFO)
  nock(FUTURES_HOST).persist().get('/fapi/v1/exchangeInfo').query(true).reply(200, EMPTY_INFO)
  nock(FUTURES_HOST).persist().get('/dapi/v1/exchangeInfo').query(true).reply(200, EMPTY_INFO)
}

beforeAll(() => { nock.disableNetConnect() })
afterAll(() => { nock.enableNetConnect(); nock.restore() })
beforeEach(() => { stubMarkets() })
afterEach(() => { nock.cleanAll(); BinanceAdapter.clearMarketRulesCache() })

describe('BinanceAdapter money-path integration (real ccxt via nock)', () => {
  test('getMarketRules parses LOT_SIZE / NOTIONAL filters from exchangeInfo', async () => {
    const rules = await adapter().getMarketRules('BTC/USDT')
    expect(rules.symbol).toBe('BTC/USDT')
    expect(rules.stepSize).toBeCloseTo(0.00001, 8)
    expect(rules.minQty).toBeCloseTo(0.00001, 8)
    expect(rules.minNotional).toBeCloseTo(5, 8)
  })

  test('fetchPrice returns the last price from the ticker', async () => {
    nock(HOST).get('/api/v3/ticker/24hr').query(true).reply(200, {
      symbol: 'BTCUSDT', lastPrice: '50000.00', bidPrice: '49999.00', askPrice: '50001.00',
      highPrice: '51000.00', lowPrice: '49000.00', openPrice: '49500.00', volume: '100.0', quoteVolume: '5000000.0',
    })
    const price = await adapter().fetchPrice('BTC/USDT')
    expect(price).toBeCloseTo(50000, 2)
  })

  test('fetchBalance maps account balances', async () => {
    nock(HOST).get('/api/v3/account').query(true).reply(200, {
      makerCommission: 0, balances: [
        { asset: 'USDT', free: '1000.00000000', locked: '0.00000000' },
        { asset: 'BTC', free: '0.50000000', locked: '0.10000000' },
      ],
    })
    const bal = await adapter().fetchBalance()
    expect(bal.USDT.free).toBeCloseTo(1000, 2)
    expect(bal.BTC.total).toBeCloseTo(0.6, 8)
  })

  test('createOrder sends a real signed POST with the correct params and maps the filled order', async () => {
    let sent = ''       // captured outgoing path + body (ccxt puts signed params in either)
    let apiKey = ''
    nock(HOST).post('/api/v3/order').query(true).reply(function (uri, body) {
      sent = uri + '|' + (typeof body === 'string' ? body : JSON.stringify(body))
      apiKey = String(this.req.headers['x-mbx-apikey'] ?? '')
      return [200, {
        symbol: 'BTCUSDT', orderId: 123, clientOrderId: 'PRX_abc', transactTime: 1700000000000,
        status: 'FILLED', type: 'MARKET', side: 'BUY',
        executedQty: '0.00100000', cummulativeQuoteQty: '50.00000000',
        fills: [{ price: '50000.00', qty: '0.00100000', commission: '0.05', commissionAsset: 'USDT' }],
      }]
    })
    const order = await adapter().createOrder({
      symbol: 'BTC/USDT', side: 'buy', type: 'market', quantity: 0.001, clientOrderId: 'PRX_abc',
    })
    // The OUTGOING request must carry the exact order intent — a serialization bug that sent the
    // wrong side/type/quantity/clientId would otherwise pass green (the failure mode T3 exists to catch).
    expect(sent).toContain('symbol=BTCUSDT')
    expect(sent).toContain('side=BUY')
    expect(sent).toContain('type=MARKET')
    expect(sent).toContain('quantity=0.001')            // prefix-matches ccxt's 0.00100000 too
    expect(sent).toContain('newClientOrderId=PRX_abc')
    expect(apiKey).toBe('test-key')                     // the credential actually reached the header
    // The response must parse into the mapped domain order.
    expect(order.id).toBe('123')
    expect(order.status).toBe('filled')
    expect(order.filled).toBeCloseTo(0.001, 8)
  })

  test('fetchOrder maps a filled order and requests the correct order id', async () => {
    let sentPath = ''
    nock(HOST).get('/api/v3/order').query(true).reply(function (uri) {
      sentPath = uri
      return [200, {
        symbol: 'BTCUSDT', orderId: 123, clientOrderId: 'PRX_abc', status: 'FILLED', type: 'MARKET', side: 'BUY',
        executedQty: '0.00100000', cummulativeQuoteQty: '50.00000000', price: '0.00000000', time: 1700000000000,
      }]
    })
    const order = await adapter().fetchOrder({ exchangeOrderId: '123', symbol: 'BTC/USDT' })
    expect(sentPath).toContain('orderId=123')   // the requested id was actually sent
    expect(sentPath).toContain('symbol=BTCUSDT')
    expect(order).not.toBeNull()
    expect(order!.id).toBe('123')
    expect(order!.status).toBe('filled')
  })

  // ── error mapping (the adapter must translate ccxt errors to Praxis domain errors) ──

  test('createOrder → ExchangeRejectedError on a filter/InvalidOrder rejection (400 -1013)', async () => {
    nock(HOST).post('/api/v3/order').query(true).reply(400, { code: -1013, msg: 'Filter failure: LOT_SIZE' })
    await expect(adapter().createOrder({
      symbol: 'BTC/USDT', side: 'buy', type: 'market', quantity: 0.001, clientOrderId: 'PRX_x',
    })).rejects.toBeInstanceOf(ExchangeRejectedError)
  })

  test('fetchOrder → null when the exchange reports the order does not exist (400 -2013)', async () => {
    nock(HOST).get('/api/v3/order').query(true).reply(400, { code: -2013, msg: 'Order does not exist.' })
    const order = await adapter().fetchOrder({ exchangeOrderId: '999', symbol: 'BTC/USDT' })
    expect(order).toBeNull()
  })

  test('createOrder → ExchangeAuthError on an auth rejection (401 -2015)', async () => {
    nock(HOST).post('/api/v3/order').query(true).reply(401, { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' })
    await expect(adapter().createOrder({
      symbol: 'BTC/USDT', side: 'buy', type: 'market', quantity: 0.001, clientOrderId: 'PRX_y',
    })).rejects.toBeInstanceOf(ExchangeAuthError)
  })
})
