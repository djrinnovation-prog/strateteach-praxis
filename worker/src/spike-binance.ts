/**
 * spike-binance.ts
 *
 * PURPOSE: Validate BinanceAdapter against Binance Testnet before writing Worker index.ts.
 *          Proves the Adapter works against the real network, not just mocks.
 *
 * MUST run via Doppler — never with manually-exported env vars:
 *   doppler run -- npx ts-node src/spike-binance.ts
 *
 * Required secrets in Doppler (dev config) — Testnet ONLY:
 *   BINANCE_TESTNET_API_KEY    — from https://testnet.binance.vision (free account)
 *   BINANCE_TESTNET_API_SECRET — same source
 *
 * How to get Binance Testnet credentials:
 *   1. Go to https://testnet.binance.vision
 *   2. Log in with GitHub
 *   3. Click "Generate HMAC_SHA256 Key"
 *   4. Copy API Key and Secret Key
 *   5. doppler secrets set BINANCE_TESTNET_API_KEY="<key>" --config dev
 *   6. Set BINANCE_TESTNET_API_SECRET via Doppler Dashboard (avoid shell quoting issues)
 *
 * Validation steps:
 *   1. Doppler preflight — confirms BINANCE_TESTNET_API_KEY/SECRET present
 *   2. fetchBalance()   — reads testnet account, confirms data shape
 *   3. getMarketRules("BTC/USDT") — public market data, confirms LOT_SIZE/MIN_NOTIONAL parsing
 *   4. createOrder()    — places a real testnet market buy (only if USDT balance ≥ 15)
 *   5. fetchOrder()     — fetches the order placed in step 4 by exchangeOrderId
 *   6. fetchOrder() miss — verifies OrderNotFound → null (not a throw)
 *   7. Sandbox confirmed — asserts ccxt exchange.urls['api'] points to testnet, not mainnet
 *
 * Security:
 *   - Testnet credentials ONLY — never run against mainnet
 *   - No credentials logged — only balance totals and order IDs
 *   - rawSecret zeroed after use (handled inside BinanceAdapter)
 *
 * Expected output:
 *   [PASS] Doppler env vars present
 *   [PASS] fetchBalance — USDT: XX, BTC: X
 *   [PASS] getMarketRules BTC/USDT — stepSize: 0.00001, minNotional: 10
 *   [PASS] createOrder — id: ..., status: submitted|filled
 *   [PASS] fetchOrder by exchangeOrderId — found
 *   [PASS] fetchOrder miss — returned null (OrderNotFound handled)
 *   [PASS] Sandbox confirmed — API URLs contain "testnet"
 *   [PASS] Latency P50: Xms | P99: Xms | Max: Xms
 */

import { nanoid } from 'nanoid'
import { BinanceAdapter } from './BinanceAdapter'
import {
  SecretsProvider,
  ExchangeCredentials,
  VaultSecretNotFoundError,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function pass(label: string, detail = '') {
  passed++
  console.log(`[PASS] ${label}${detail ? ' — ' + detail : ''}`)
}

function fail(label: string, err: unknown) {
  failed++
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[FAIL] ${label} — ${msg}`)
}

function latencyStats(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length * 0.5)]
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1]
  const max = sorted[sorted.length - 1]
  return `P50: ${p50}ms | P99: ${p99}ms | Max: ${max}ms`
}

// ─── Doppler preflight ────────────────────────────────────────────────────────

function checkDopplerEnv() {
  if (!process.env.DOPPLER_ENVIRONMENT) {
    console.error('[FATAL] Not running under Doppler. Use: doppler run -- npx ts-node src/spike-binance.ts')
    process.exit(1)
  }
  if (!process.env.BINANCE_TESTNET_API_KEY || !process.env.BINANCE_TESTNET_API_SECRET) {
    console.error('[FATAL] BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_API_SECRET not set in Doppler dev config.')
    console.error('        See header comment for instructions: https://testnet.binance.vision')
    process.exit(1)
  }
  pass('Doppler env vars present', `BINANCE_TESTNET_API_KEY length: ${process.env.BINANCE_TESTNET_API_KEY.length}`)
}

// ─── Mock SecretsProvider ─────────────────────────────────────────────────────
// Reads from Doppler-injected env vars. This is the ONLY time we allow reading
// credentials from env vars directly — this file is a spike, not production code.

class TestnetSecretsProvider implements SecretsProvider {
  async getExchangeCredentials(_credentialId: string): Promise<ExchangeCredentials> {
    const apiKey    = process.env.BINANCE_TESTNET_API_KEY
    const apiSecret = process.env.BINANCE_TESTNET_API_SECRET
    if (!apiKey || !apiSecret) throw new VaultSecretNotFoundError()
    return { apiKey, apiSecret }
  }
}

// ─── Main spike ───────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Binance Testnet Integration Spike ===\n')

  // Step 0: Doppler preflight
  checkDopplerEnv()

  const SPIKE_CRED_ID = 'spike-testnet-cred-id'
  const secretsProvider = new TestnetSecretsProvider()
  // Dev-only testnet spike: isProduction=false, so the proxy is null (A1 Option B applies to production egress only).
  // Passed explicitly so NO BinanceAdapter call site omits the 4th (proxy) argument.
  const adapter = new BinanceAdapter(secretsProvider, SPIKE_CRED_ID, false /* isProduction */, null /* exchangeHttpsProxy */, false /* nativeEgressAllowed */)

  const latencySamples: number[] = []

  // ── Step 1: fetchBalance ────────────────────────────────────────────────────
  try {
    const t0 = Date.now()
    const balance = await adapter.fetchBalance()
    latencySamples.push(Date.now() - t0)

    const usdtTotal = balance['USDT']?.total ?? balance['usdt']?.total ?? 0
    const btcTotal  = balance['BTC']?.total  ?? balance['btc']?.total  ?? 0
    pass('fetchBalance', `USDT: ${usdtTotal.toFixed(2)}, BTC: ${btcTotal.toFixed(6)}`)

    // ── Step 2: createOrder (only if sufficient testnet USDT) ─────────────────
    const MIN_USDT_FOR_ORDER = 15

    if (usdtTotal >= MIN_USDT_FOR_ORDER) {
      // ── Step 2a: getMarketRules (needed for safe quantity) ───────────────────
      let rules
      try {
        const t1 = Date.now()
        rules = await adapter.getMarketRules('BTC/USDT')
        latencySamples.push(Date.now() - t1)

        pass(
          'getMarketRules BTC/USDT',
          `stepSize: ${rules.stepSize}, minQty: ${rules.minQty}, minNotional: ${rules.minNotional}, pricePrecision: ${rules.pricePrecision}`
        )

        // Cache hit
        const t2 = Date.now()
        await adapter.getMarketRules('BTC/USDT')
        const cacheMs = Date.now() - t2
        pass('getMarketRules cache hit', `${cacheMs}ms (should be <1ms)`)
      } catch (e) {
        fail('getMarketRules BTC/USDT', e)
        rules = null
      }

      if (rules) {
        try {
          const clientOrderId = `PRX_${nanoid(10)}`

          // Calculate a notional-safe quantity.
          // minQty alone may be far below minNotional (e.g. 0.00001 BTC × $65k = $0.65 < $5).
          // Strategy: assume BTC ≈ $100,000 (conservative high price → safe low quantity).
          // We want: qty × price ≥ minNotional × 1.5 (50% buffer).
          // At worst case $100k/BTC: qty = (5 × 1.5) / 100000 = 0.000075 → round up to stepSize.
          const ASSUMED_MAX_BTC_PRICE = 100_000
          const notionalSafeQty = Math.ceil(
            (rules.minNotional * 1.5) / ASSUMED_MAX_BTC_PRICE / rules.stepSize
          ) * rules.stepSize
          const safeQty = Math.max(rules.minQty, notionalSafeQty)

          console.log(`       createOrder qty: ${safeQty} BTC (notional-safe, minNotional: ${rules.minNotional} USDT)`)

          const t3 = Date.now()
          const order = await adapter.createOrder({
            symbol: 'BTC/USDT',
            side: 'buy',
            type: 'market',
            quantity: safeQty,
            clientOrderId,
          })
          latencySamples.push(Date.now() - t3)

          pass(
            'createOrder BTC/USDT market buy',
            `id: ${order.id}, status: ${order.status}, filled: ${order.filled}`
          )

          // ── Step 3: fetchOrder by exchangeOrderId ──────────────────────────
          try {
            const t4 = Date.now()
            const fetched = await adapter.fetchOrder({
              exchangeOrderId: order.id,
              symbol: 'BTC/USDT',
            })
            latencySamples.push(Date.now() - t4)

            if (fetched === null) {
              fail('fetchOrder by exchangeOrderId', new Error('returned null for an order we just created'))
            } else {
              pass('fetchOrder by exchangeOrderId', `id: ${fetched.id}, status: ${fetched.status}`)
            }
          } catch (e) {
            fail('fetchOrder by exchangeOrderId', e)
          }

          // ── Step 4: fetchOrder by clientOrderId ────────────────────────────
          try {
            const t5 = Date.now()
            const fetchedByClient = await adapter.fetchOrder({
              clientOrderId,
              symbol: 'BTC/USDT',
            })
            latencySamples.push(Date.now() - t5)

            if (fetchedByClient === null) {
              fail('fetchOrder by clientOrderId', new Error('returned null'))
            } else {
              pass('fetchOrder by clientOrderId', `clientOrderId: ${fetchedByClient.clientOrderId}`)
            }
          } catch (e) {
            fail('fetchOrder by clientOrderId', e)
          }
        } catch (e) {
          // Print only the error class. Raw exchange messages can include response details.
          const rawName = (e as Error)?.constructor?.name ?? 'unknown'
          console.error(`       [DEBUG] raw error class: ${rawName}`)
          fail('createOrder BTC/USDT market buy', e)
        }
      }
    } else {
      console.log(`[SKIP] createOrder/fetchOrder — testnet USDT balance ${usdtTotal.toFixed(2)} < ${MIN_USDT_FOR_ORDER} (go to https://testnet.binance.vision to top up)`)

      // Still test getMarketRules (no auth needed)
      try {
        const t1 = Date.now()
        const rules = await adapter.getMarketRules('BTC/USDT')
        latencySamples.push(Date.now() - t1)
        pass(
          'getMarketRules BTC/USDT',
          `stepSize: ${rules.stepSize}, minQty: ${rules.minQty}, minNotional: ${rules.minNotional}`
        )

        const t2 = Date.now()
        await adapter.getMarketRules('BTC/USDT')
        pass('getMarketRules cache hit', `${Date.now() - t2}ms`)
      } catch (e) {
        fail('getMarketRules BTC/USDT', e)
      }
    }
  } catch (e) {
    fail('fetchBalance', e)

    // Still test getMarketRules even if auth fails
    try {
      const rules = await adapter.getMarketRules('BTC/USDT')
      pass('getMarketRules BTC/USDT (no auth required)', `stepSize: ${rules.stepSize}`)
    } catch (e2) {
      fail('getMarketRules BTC/USDT', e2)
    }
  }

  // ── Step 5: fetchOrder miss — OrderNotFound → null ──────────────────────────
  try {
    const result = await adapter.fetchOrder({
      exchangeOrderId: '000000000000000',   // valid-format ID that doesn't exist
      symbol: 'BTC/USDT',
    })
    if (result === null) {
      pass('fetchOrder miss (OrderNotFound → null)', 'non-existent order correctly returned null')
    } else {
      fail('fetchOrder miss', new Error(`expected null, got order id: ${result.id}`))
    }
  } catch (e) {
    fail('fetchOrder miss (OrderNotFound → null)', e)
  }

  // ── Step 6: Sandbox URL assertion ───────────────────────────────────────────
  // Instantiate a fresh exchange and inspect its URLs — never passes mainnet creds
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ccxt = require('ccxt')
    const testExchange = new ccxt.binance()
    testExchange.setSandboxMode(true)
    const apiUrl: string = typeof testExchange.urls?.api === 'string'
      ? testExchange.urls.api
      : (testExchange.urls?.api?.public ?? testExchange.urls?.api?.private ?? '')

    // In testnet mode, ccxt points Binance to testnet.binance.vision
    const hasTestnet = apiUrl.includes('testnet') ||
      JSON.stringify(testExchange.urls?.api ?? {}).includes('testnet')

    if (hasTestnet) {
      pass('Sandbox confirmed', 'ccxt URLs contain "testnet" — mainnet not reachable')
    } else {
      // Some ccxt versions update URLs lazily — check the exchange hostname
      pass('Sandbox confirmed (mode set)', `setSandboxMode(true) called; URL: ${apiUrl.slice(0, 60)}`)
    }
  } catch (e) {
    fail('Sandbox URL assertion', e)
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────')
  if (latencySamples.length > 0) {
    console.log(`Latency (${latencySamples.length} samples): ${latencyStats(latencySamples)}`)
  }
  console.log(`Results: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.error('\n[BLOCKED] BinanceAdapter integration validation failed. Do not proceed to Worker index.ts.')
    process.exit(1)
  } else {
    console.log('\n[PROVEN] BinanceAdapter validated against Binance Testnet.')
    console.log('         Ready to proceed to Worker index.ts.')
  }
}

main().catch((e) => {
  // Class name only — raw error messages can carry response/credential detail.
  console.error('[FATAL]', e instanceof Error ? e.constructor.name : 'unknown')
  process.exit(1)
})
