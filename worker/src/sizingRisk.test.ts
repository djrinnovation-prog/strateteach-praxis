/**
 * sizingRisk.test.ts — pure sizing/risk helper tests (S5-A3/B4 slice 1).
 * No DB / ccxt / secrets / network / wiring. Fail-closed behavior is asserted by THROWS,
 * never by a fallback number (the removed per-symbol price floors must not resurface).
 */
import {
  BotSizingConfig,
  MarketRules,
  ExchangeEnvironment,
  SizingUnavailableError,
  RiskLimitExceededError,
} from './types'
import {
  isBotConfigReady,
  assertExchangeEnvironment,
  assertTradingEnabled,
  computeRequestedNotional,
  computeBuyQuantity,
  computeSellQuantity,
  enforceRiskLimits,
} from './sizingRisk'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBot(o: Partial<BotSizingConfig> = {}): BotSizingConfig {
  return {
    sizing_mode:             'percent_of_balance',
    position_size_pct:       10,
    fixed_notional_usdt:     null,
    max_order_notional_usdt: 100,
    daily_notional_cap_usdt: 500,
    trading_enabled:         true,
    sell_enabled:            false,
    sell_size_pct:           null,
    ...o,
  }
}

function makeRules(o: Partial<MarketRules> = {}): MarketRules {
  return { symbol: 'BTC/USDT', minNotional: 5, stepSize: 0.00001, minQty: 0.00001, pricePrecision: 2, qtyPrecision: 5, ...o }
}

/** Assert a function throws a specific error CLASS with a specific non-secret `reason`. */
function expectThrows(fn: () => unknown, Cls: new (r: string) => Error, reason: string): void {
  let caught: unknown
  try { fn() } catch (e) { caught = e }
  expect(caught).toBeInstanceOf(Cls)
  expect((caught as { reason: string }).reason).toBe(reason)
}

// ─── percent_of_balance BUY sizing ──────────────────────────────────────────────

describe('computeBuyQuantity — percent_of_balance', () => {
  test('sizes from position_size_pct × free quote / live price, rounded down to stepSize', () => {
    // 10% of 1000 = 100 USDT notional; 100 / 50000 = 0.002 BTC
    expect(computeBuyQuantity(makeBot({ position_size_pct: 10 }), makeRules(), 50_000, 1_000)).toBe(0.002)
  })

  test('computeRequestedNotional returns pct × free quote', () => {
    expect(computeRequestedNotional(makeBot({ position_size_pct: 25 }), 400)).toBe(100)
  })
})

// ─── fixed_notional (supported correctly, not silently ignored) ─────────────────

describe('computeBuyQuantity — fixed_notional', () => {
  const fixedBot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 50 })

  test('sizes from fixed_notional_usdt (balance-independent)', () => {
    expect(computeRequestedNotional(fixedBot, 999_999)).toBe(50)            // ignores balance by design
    expect(computeBuyQuantity(fixedBot, makeRules(), 50_000, 1_000)).toBe(0.001) // 50/50000
  })

  test('fail-closed when fixed_notional_usdt missing', () => {
    expectThrows(
      () => computeRequestedNotional(makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: null }), 1000),
      SizingUnavailableError, 'missing_fixed_notional_usdt',
    )
  })

  test('fixed_notional larger than free quote → fail-closed BEFORE sizing (not bounced by the exchange)', () => {
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 500 })
    expectThrows(() => computeBuyQuantity(bot, makeRules(), 50_000, 100), SizingUnavailableError, 'insufficient_quote_balance')
  })
})

// ─── H-3 / L-2: non-finite quantity + rounding-epsilon safety ────────────────────

describe('computeBuyQuantity — H-3 non-finite quantity fail-closed', () => {
  const buyBot = () => makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 100 })

  test('stepSize = 0 → NaN quantity is REJECTED before the min guards (not passed to the exchange)', () => {
    // Pre-fix: notional/0 = Infinity, Infinity*0 = NaN; qty<minQty and qty*price<minNotional are both
    // false for NaN, so a NaN quantity slipped through. Now it must throw non_finite_quantity.
    expectThrows(() => computeBuyQuantity(buyBot(), makeRules({ stepSize: 0 }), 50_000, 1_000),
      SizingUnavailableError, 'non_finite_quantity')
  })

  test('stepSize = NaN → rejected (non_finite_quantity)', () => {
    expectThrows(() => computeBuyQuantity(buyBot(), makeRules({ stepSize: NaN }), 50_000, 1_000),
      SizingUnavailableError, 'non_finite_quantity')
  })

  test('negative stepSize → rejected (non_finite_quantity)', () => {
    expectThrows(() => computeBuyQuantity(buyBot(), makeRules({ stepSize: -0.001 }), 50_000, 1_000),
      SizingUnavailableError, 'non_finite_quantity')
  })
})

describe('roundDownToStep magnitude-scaled epsilon (L-2) — via computeBuyQuantity', () => {
  test('float-representation error still floors to the exact multiple (0.0095/0.00001 = 950 steps)', () => {
    // notional 0.0095 * price? Use fixed_notional so notional/price gives the classic float case.
    // 0.0095 / 0.00001 = 949.99999999… in IEEE-754 → must floor to 950 * step, not 949.
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 0.0095 })
    const rules = makeRules({ stepSize: 0.00001, minQty: 0.00001, minNotional: 0, qtyPrecision: 5 })
    // price 1 → notional/price = 0.0095 → 950 steps of 0.00001 = 0.0095
    expect(computeBuyQuantity(bot, rules, 1, 1_000)).toBe(0.0095)
  })

  test('never rounds a genuine sub-step remainder UP a full step (qty×price ≤ requested notional)', () => {
    // 0.00949 / 0.00001 = 949 exactly (plus a genuine remainder that must NOT bump to 950).
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 0.009495 })
    const rules = makeRules({ stepSize: 0.00001, minQty: 0.00001, minNotional: 0, qtyPrecision: 5 })
    const qty = computeBuyQuantity(bot, rules, 1, 1_000)
    expect(qty).toBe(0.00949)          // floored, not bumped to 0.0095
    expect(qty * 1).toBeLessThanOrEqual(0.009495) // never exceeds the requested notional
  })
})

// ─── minNotional / minQty / stepSize ────────────────────────────────────────────

describe('computeBuyQuantity — exchange-rule fail-closed', () => {
  test('below minNotional → fail-closed (no silent bump, no floor fallback)', () => {
    // notional 6 at price 50000 → qty 0.00012 (≥ minQty) but 6 < minNotional 10 → throw
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 6 })
    expectThrows(() => computeBuyQuantity(bot, makeRules({ minNotional: 10 }), 50_000, 1_000),
      SizingUnavailableError, 'below_min_notional')
  })

  test('below minQty → fail-closed', () => {
    // notional 0.1 at price 50000 → 0.000002 → rounds down to 0 (< minQty)
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 0.1 })
    expectThrows(() => computeBuyQuantity(bot, makeRules(), 50_000, 1_000),
      SizingUnavailableError, 'below_min_qty')
  })

  test('quantity is rounded DOWN to stepSize', () => {
    // 125 / 50000 = 0.0025 → step 0.001 → 0.002
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 125 })
    const rules = makeRules({ stepSize: 0.001, minQty: 0.001, qtyPrecision: 3 })
    expect(computeBuyQuantity(bot, rules, 50_000, 1_000)).toBe(0.002)
  })

  test('invalid/zero price → fail-closed', () => {
    expectThrows(() => computeBuyQuantity(makeBot(), makeRules(), 0, 1_000), SizingUnavailableError, 'invalid_price')
  })
})

// ─── missing sizing config ──────────────────────────────────────────────────────

describe('sizing config fail-closed', () => {
  test('missing sizing_mode → fail-closed throw + reported missing', () => {
    const bot = makeBot({ sizing_mode: null })
    expectThrows(() => computeBuyQuantity(bot, makeRules(), 50_000, 1_000),
      SizingUnavailableError, 'missing_or_unsupported_sizing_mode')
    expect(isBotConfigReady(bot, 'testnet').missing).toContain('sizing_mode')
  })

  test('missing position_size_pct in percent mode → fail-closed throw + reported missing', () => {
    const bot = makeBot({ position_size_pct: null })
    expectThrows(() => computeRequestedNotional(bot, 1_000), SizingUnavailableError, 'missing_position_size_pct')
    expect(isBotConfigReady(bot, 'testnet').missing).toContain('position_size_pct')
  })
})

// ─── risk limits ────────────────────────────────────────────────────────────────

describe('enforceRiskLimits', () => {
  test('per-order max notional → block', () => {
    expectThrows(() => enforceRiskLimits(makeBot({ max_order_notional_usdt: 100 }), 200, 0),
      RiskLimitExceededError, 'per_order_max_notional')
  })

  test('daily notional cap (using stored requested sum) → block', () => {
    expectThrows(() => enforceRiskLimits(makeBot({ max_order_notional_usdt: 1_000, daily_notional_cap_usdt: 100 }), 60, 60),
      RiskLimitExceededError, 'daily_notional_cap')
  })

  test('within both caps → no throw', () => {
    expect(() => enforceRiskLimits(makeBot({ max_order_notional_usdt: 100, daily_notional_cap_usdt: 500 }), 60, 60)).not.toThrow()
  })

  test('missing caps → fail-closed (config gap, not a breach)', () => {
    expectThrows(() => enforceRiskLimits(makeBot({ max_order_notional_usdt: null }), 10, 0),
      SizingUnavailableError, 'missing_risk_caps')
  })
})

// ─── kill switch / disabled ─────────────────────────────────────────────────────

describe('isBotConfigReady — disabled vs misconfigured', () => {
  test('trading_enabled=false → disabled, NOT misconfigured', () => {
    const r = isBotConfigReady(makeBot({ trading_enabled: false }), 'testnet')
    expect(r.disabled).toBe(true)
    expect(r.ready).toBe(true)       // config is complete
    expect(r.missing).toEqual([])    // disabled is not a missing-config reason
  })

  test('fully configured + enabled → ready, not disabled', () => {
    const r = isBotConfigReady(makeBot(), 'testnet')
    expect(r).toEqual({ ready: true, disabled: false, missing: [] })
  })
})

describe('assertTradingEnabled (kill switch)', () => {
  test('disabled bot: config is ready+disabled (not misconfigured) AND assertTradingEnabled blocks it', () => {
    const bot = makeBot({ trading_enabled: false })
    const r = isBotConfigReady(bot, 'testnet')
    expect(r.ready).toBe(true)       // config complete
    expect(r.disabled).toBe(true)    // kill switch on
    expect(r.missing).toEqual([])    // disabled is NOT a missing-config reason
    expectThrows(() => assertTradingEnabled(bot), RiskLimitExceededError, 'trading_disabled')
  })

  test('enabled bot → no throw', () => {
    expect(() => assertTradingEnabled(makeBot({ trading_enabled: true }))).not.toThrow()
  })
})

// ─── SELL ───────────────────────────────────────────────────────────────────────

describe('computeSellQuantity', () => {
  test('sell_enabled=false → fail loud (never silently ignore a SELL)', () => {
    expectThrows(() => computeSellQuantity(makeBot({ sell_enabled: false }), makeRules(), 1), SizingUnavailableError, 'sell_not_enabled')
  })

  test('sell_enabled=true → sell_size_pct × free base, rounded down', () => {
    const bot = makeBot({ sell_enabled: true, sell_size_pct: 95 })
    expect(computeSellQuantity(bot, makeRules(), 0.01)).toBe(0.0095)   // 95% of 0.01
  })

  test('result below minQty → null (no sellable position)', () => {
    const bot = makeBot({ sell_enabled: true, sell_size_pct: 95 })
    expect(computeSellQuantity(bot, makeRules({ minQty: 0.01 }), 0.001)).toBeNull()
  })
})

// ─── environment guard ──────────────────────────────────────────────────────────

describe('assertExchangeEnvironment', () => {
  test('missing → block', () => {
    expectThrows(() => assertExchangeEnvironment(false, null), RiskLimitExceededError, 'env_missing')
  })
  test('production worker + testnet credential → block', () => {
    expectThrows(() => assertExchangeEnvironment(true, 'testnet'), RiskLimitExceededError, 'env_mismatch_production_with_testnet_credential')
  })
  test('testnet worker + mainnet credential → block', () => {
    expectThrows(() => assertExchangeEnvironment(false, 'mainnet'), RiskLimitExceededError, 'env_mismatch_testnet_with_mainnet_credential')
  })
  test.each<[boolean, ExchangeEnvironment]>([[false, 'testnet'], [true, 'mainnet']])(
    'matching env (isProduction=%s, %s) → ok', (isProd, env) => {
      expect(() => assertExchangeEnvironment(isProd, env)).not.toThrow()
    })
})

// ─── no old-floor fallback (regression guard) ───────────────────────────────────

describe('no removed price-floor fallback', () => {
  test('an under-min BTC config THROWS — it does not return the old 0.00008 floor', () => {
    // The exact bug the floors masked: a tiny notional must fail-closed, not silently size.
    const bot = makeBot({ sizing_mode: 'fixed_notional', position_size_pct: null, fixed_notional_usdt: 1 })
    let result: unknown, threw = false
    try { result = computeBuyQuantity(bot, makeRules({ minNotional: 5 }), 50_000, 1_000) } catch { threw = true }
    expect(threw).toBe(true)
    expect(result).toBeUndefined()   // no number returned
  })
})
