/**
 * sizingRisk.ts — pure order-sizing + server-side risk-limit helpers (S5-A3/B4).
 *
 * PURE: no DB, no ccxt, no secrets, no network, no createOrder, no processMessage wiring.
 * Inputs are plain values; outputs are numbers or thrown typed errors. Fail-closed throughout —
 * a missing/invalid input throws (never a default size, never a fallback to the removed price
 * floors). "The code is the guardrail; the database config is the policy" — no business value is
 * hardcoded here; sizes/caps come only from BotSizingConfig.
 *
 * Slice 1 (this module): helpers + tests only. Wiring into processMessage is a later slice.
 * See docs/sprint5-s5-a3-b4-sizing-risk-design.md.
 */
import {
  BotSizingConfig,
  MarketRules,
  ExchangeEnvironment,
  SizingUnavailableError,
  RiskLimitExceededError,
} from './types'

/**
 * Round a value DOWN to a multiple of `step` (Decision Log 2026-05-20: round down always).
 *
 * H-3: a non-finite / ≤0 `step` (poisoned exchange filter — stepSize "0" or NaN) would make the
 * quotient Infinity/NaN and silently produce a NaN quantity that bypasses every min guard. Guard it
 * here and return NaN so the caller's finite check fails closed (it never reaches createOrder).
 *
 * L-2: the float-error correction is scaled to the quotient's MAGNITUDE (a few ULPs, relative
 * ~1e-12) instead of a fixed `+1e-9` on the step COUNT. A fixed 1e-9 could bump a genuine value
 * that sits 1e-9 below a step boundary UP a full step (qty×price marginally over the requested
 * notional); a magnitude-relative tolerance only corrects true representation error
 * (e.g. 0.0095 / 0.00001 = 949.99999999… → 950) and never bumps a real sub-step remainder up.
 */
function roundDownToStep(value: number, step: number): number {
  if (!(typeof step === 'number' && isFinite(step) && step > 0)) return NaN
  const steps = value / step
  const tol = Math.max(Math.abs(steps), 1) * 1e-12
  return Math.floor(steps + tol) * step
}

function isNonNegativeFinite(n: number): boolean {
  return typeof n === 'number' && isFinite(n) && n >= 0
}

// ─── Config readiness ─────────────────────────────────────────────────────────

export interface ConfigReadiness {
  /** true only when every REQUIRED config field is present (independent of disabled). */
  ready: boolean
  /** trading_enabled=false — a deliberate kill-switch state, NOT a misconfiguration. */
  disabled: boolean
  /** names of missing required fields (empty when ready). */
  missing: string[]
}

/**
 * Which required config a bot is missing before it may trade. `disabled` (trading_enabled=false)
 * is reported separately and is NOT counted as missing/misconfigured.
 */
export function isBotConfigReady(
  bot: BotSizingConfig,
  exchangeEnvironment: ExchangeEnvironment | null,
): ConfigReadiness {
  const missing: string[] = []

  if (bot.sizing_mode === null) {
    missing.push('sizing_mode')
  } else if (bot.sizing_mode === 'percent_of_balance' && bot.position_size_pct == null) {
    missing.push('position_size_pct')
  } else if (bot.sizing_mode === 'fixed_notional' && bot.fixed_notional_usdt == null) {
    missing.push('fixed_notional_usdt')
  }

  if (bot.max_order_notional_usdt == null) missing.push('max_order_notional_usdt')
  if (bot.daily_notional_cap_usdt == null) missing.push('daily_notional_cap_usdt')
  if (bot.sell_enabled && bot.sell_size_pct == null) missing.push('sell_size_pct')
  if (exchangeEnvironment === null) missing.push('exchange_environment')

  return { ready: missing.length === 0, disabled: !bot.trading_enabled, missing }
}

// ─── Environment guard ──────────────────────────────────────────────────────────

/**
 * Block on testnet/mainnet mismatch (or a missing credential environment). Throws
 * RiskLimitExceededError; the `reason` is a non-secret label.
 */
export function assertExchangeEnvironment(
  isProduction: boolean,
  env: ExchangeEnvironment | null,
): void {
  if (env === null) throw new RiskLimitExceededError('env_missing')
  if (isProduction && env === 'testnet') throw new RiskLimitExceededError('env_mismatch_production_with_testnet_credential')
  if (!isProduction && env === 'mainnet') throw new RiskLimitExceededError('env_mismatch_testnet_with_mainnet_credential')
}

// ─── Sizing ─────────────────────────────────────────────────────────────────────

/**
 * The requested order notional (USDT) per the bot's sizing_mode:
 *   percent_of_balance → position_size_pct% × freeQuote
 *   fixed_notional     → fixed_notional_usdt
 * Throws SizingUnavailableError (fail-closed) on missing/unsupported mode or invalid input.
 */
export function computeRequestedNotional(bot: BotSizingConfig, freeQuote: number): number {
  if (bot.sizing_mode === 'percent_of_balance') {
    if (bot.position_size_pct == null) throw new SizingUnavailableError('missing_position_size_pct')
    if (!isNonNegativeFinite(freeQuote)) throw new SizingUnavailableError('invalid_free_quote')
    return (bot.position_size_pct / 100) * freeQuote
  }
  if (bot.sizing_mode === 'fixed_notional') {
    if (bot.fixed_notional_usdt == null) throw new SizingUnavailableError('missing_fixed_notional_usdt')
    return bot.fixed_notional_usdt
  }
  // null or any unexpected value → fail loud (never silently size / fall back to a floor).
  throw new SizingUnavailableError('missing_or_unsupported_sizing_mode')
}

/**
 * BUY base-asset quantity from config + live price + free quote balance.
 * Rounds DOWN to stepSize; requires qty ≥ minQty AND qty × price ≥ minNotional, else fail-closed.
 * No silent bump to minNotional, no fallback to the removed per-symbol price floors.
 */
export function computeBuyQuantity(
  bot: BotSizingConfig,
  rules: MarketRules,
  price: number,
  freeQuote: number,
): number {
  if (!(typeof price === 'number' && isFinite(price) && price > 0)) {
    throw new SizingUnavailableError('invalid_price')
  }
  if (!isNonNegativeFinite(freeQuote)) throw new SizingUnavailableError('invalid_free_quote')

  const notional = computeRequestedNotional(bot, freeQuote)
  if (!(notional > 0)) throw new SizingUnavailableError('non_positive_notional')
  // Fail-closed in-server, BEFORE createOrder: a fixed_notional larger than the available quote
  // balance must be blocked here, not bounced by the exchange as insufficient funds (B4).
  // (percent_of_balance can never exceed freeQuote, so this only ever fires for fixed_notional.)
  if (notional > freeQuote) throw new SizingUnavailableError('insufficient_quote_balance')

  const qty = parseFloat(roundDownToStep(notional / price, rules.stepSize).toFixed(rules.qtyPrecision))

  // H-3: reject a NON-FINITE quantity BEFORE the min guards. Both `qty < minQty` and
  // `qty * price < minNotional` evaluate FALSE for NaN, so without this a poisoned stepSize (0/NaN)
  // would slip a NaN-quantity order through every guard to createOrder. A genuine qty of 0 is NOT
  // caught here (isFinite(0) is true) — it correctly falls through to the below_min_qty guard.
  if (!isFinite(qty)) throw new SizingUnavailableError('non_finite_quantity')
  if (qty < rules.minQty) throw new SizingUnavailableError('below_min_qty')
  if (qty * price < rules.minNotional) throw new SizingUnavailableError('below_min_notional')
  return qty
}

/**
 * SELL base-asset quantity = sell_size_pct% × free base balance, rounded DOWN to stepSize.
 * Returns null (caller acks + skips) when below minQty (no sellable position). Throws
 * SizingUnavailableError when SELL is not enabled or its config is missing (fail loud — never
 * silently ignore a SELL).
 */
export function computeSellQuantity(
  bot: BotSizingConfig,
  rules: MarketRules,
  freeBase: number,
): number | null {
  if (!bot.sell_enabled) throw new SizingUnavailableError('sell_not_enabled')
  if (bot.sell_size_pct == null) throw new SizingUnavailableError('missing_sell_size_pct')
  if (!isNonNegativeFinite(freeBase)) throw new SizingUnavailableError('invalid_free_base')

  const qty = parseFloat(roundDownToStep((bot.sell_size_pct / 100) * freeBase, rules.stepSize).toFixed(rules.qtyPrecision))
  // H-3: a poisoned stepSize yields NaN — never emit a NaN SELL quantity; treat as no sellable position.
  return isFinite(qty) && qty >= rules.minQty ? qty : null
}

// ─── Kill switch ──────────────────────────────────────────────────────────────

/**
 * Block a disabled bot. `trading_enabled=false` is a deliberate kill-switch state (NOT a
 * misconfiguration — `isBotConfigReady` still reports it as ready/disabled, not missing). This is
 * the pure gate that actually stops a disabled bot from trading; the caller must call it before
 * sizing/ordering. Throws RiskLimitExceededError('trading_disabled').
 */
export function assertTradingEnabled(bot: BotSizingConfig): void {
  if (!bot.trading_enabled) throw new RiskLimitExceededError('trading_disabled')
}

// ─── Risk limits ────────────────────────────────────────────────────────────────

/**
 * Enforce the per-order max notional + the per-bot daily cap (reserved against stored
 * requested-notional). Missing caps → SizingUnavailableError (config gap, fail-closed); a breach →
 * RiskLimitExceededError. `todayRequestedNotionalSum` is computed by the caller from stored
 * trades.requested_notional_usdt (never recomputed from a later price).
 */
export function enforceRiskLimits(
  bot: BotSizingConfig,
  orderNotional: number,
  todayRequestedNotionalSum: number,
): void {
  if (bot.max_order_notional_usdt == null || bot.daily_notional_cap_usdt == null) {
    throw new SizingUnavailableError('missing_risk_caps')
  }
  if (!isNonNegativeFinite(orderNotional) || !isNonNegativeFinite(todayRequestedNotionalSum)) {
    throw new SizingUnavailableError('invalid_notional_input')
  }
  if (orderNotional > bot.max_order_notional_usdt) {
    throw new RiskLimitExceededError('per_order_max_notional')
  }
  if (todayRequestedNotionalSum + orderNotional > bot.daily_notional_cap_usdt) {
    throw new RiskLimitExceededError('daily_notional_cap')
  }
}
