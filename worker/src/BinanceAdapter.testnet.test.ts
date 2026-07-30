// T3c — on-demand REAL Binance-testnet e2e. SKIPPED in CI and by default (no creds ⇒ describe.skip),
// so it never runs on every build and needs no secrets in CI. This is the layer nock CANNOT prove:
// REAL HMAC signature ACCEPTANCE by the real exchange. Read-only by default (signed fetchBalance is
// the signature proof); a tiny real order is an explicit, separate operator opt-in.
//
// Run (operator, with a TESTNET key — trade-only, IP-allowlisted; NEVER a mainnet key):
//   PRAXIS_TESTNET_E2E=1 BINANCE_TESTNET_KEY=... BINANCE_TESTNET_SECRET=... \
//     npx jest BinanceAdapter.testnet
//   # add PRAXIS_TESTNET_PLACE_ORDER=1 to ALSO place one smallest-allowed market buy on testnet.
import { BinanceAdapter } from './BinanceAdapter'
import type { SecretsProvider } from './types'

const KEY = process.env.BINANCE_TESTNET_KEY
const SECRET = process.env.BINANCE_TESTNET_SECRET
const ENABLED = process.env.PRAXIS_TESTNET_E2E === '1' && !!KEY && !!SECRET

// describe.skip when not explicitly enabled with creds — CI (no creds) loads the file but runs nothing,
// makes no network call, and needs no secret.
const d = ENABLED ? describe : describe.skip

d('BinanceAdapter REAL testnet e2e (on-demand, signature acceptance)', () => {
  const provider: SecretsProvider = {
    getExchangeCredentials: async () => ({ apiKey: KEY as string, apiSecret: SECRET as string }),
  }
  // isProduction=false ⇒ sandbox ⇒ real testnet.binance.vision. No proxy needed off the prod path.
  const adapter = () => new BinanceAdapter(provider, 'testnet-e2e', false)

  jest.setTimeout(20_000)

  test('getMarketRules (public market data)', async () => {
    const rules = await adapter().getMarketRules('BTC/USDT')
    expect(rules.stepSize).toBeGreaterThan(0)
    expect(rules.minNotional).toBeGreaterThan(0)
  })

  test('fetchPrice (public market data)', async () => {
    const price = await adapter().fetchPrice('BTC/USDT')
    expect(price).toBeGreaterThan(0)
  })

  test('fetchBalance (SIGNED — proves the real exchange ACCEPTS the HMAC signature)', async () => {
    const balance = await adapter().fetchBalance()
    expect(balance).toBeDefined()
    // A signed request that returns balances means the signature/timestamp/recvWindow were accepted.
  })

  const placeOrder = process.env.PRAXIS_TESTNET_PLACE_ORDER === '1'
  ;(placeOrder ? test : test.skip)('createOrder — smallest allowed market buy (SIGNED write)', async () => {
    const rules = await adapter().getMarketRules('BTC/USDT')
    const price = await adapter().fetchPrice('BTC/USDT')
    // Smallest quantity that clears both minQty and minNotional, rounded to stepSize.
    const byNotional = Math.ceil((rules.minNotional / price) / rules.stepSize) * rules.stepSize
    const qty = Math.max(rules.minQty, byNotional)
    const order = await adapter().createOrder({
      symbol: 'BTC/USDT', side: 'buy', type: 'market', quantity: qty,
      clientOrderId: `PRX_testnet_${Date.now()}`,
    })
    expect(order.id).toBeDefined()
    expect(['filled', 'submitted', 'unknown']).toContain(order.status)
  })
})
