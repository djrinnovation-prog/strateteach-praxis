/**
 * types.ts
 *
 * Core type definitions for the Praxis Worker.
 *
 * Design contracts (Decision Log 2026-05-31):
 * - ExchangeCredentials: in-memory only. NEVER log, NEVER include in errors.
 *   Zero after every use: credentials = null + exchange.apiKey/apiSecret = ''
 * - SecretsProvider: abstraction over Vault. BinanceAdapter never touches Vault.
 * - ExchangeAdapter: interface for all exchange operations.
 *
 * Secret JSON contract:
 *   Vault storage : { "api_key": string, "api_secret": string }  ← snake_case
 *   In-memory     : { apiKey: string, apiSecret: string }        ← camelCase (ccxt)
 *   Mapping       : VaultSecretsProvider responsibility
 *
 * Logging policy (Decision Log 2026-05-31):
 *   FORBIDDEN: apiKey, apiSecret, ExchangeCredentials object, ccxt exchange object,
 *              any string from Vault decrypted_secret.
 *   ALLOWED  : vaultSecretId, credentialId, botId, exchange name, symbol, error.code.
 *   ERROR RULE: thrown Error messages must be static strings only — no dynamic values.
 */

// ─── Credentials ─────────────────────────────────────────────────────────────
// NEVER log. NEVER include in Error.message. Zero after use.

export interface ExchangeCredentials {
  readonly apiKey: string
  readonly apiSecret: string
}

// ─── Secrets Provider ─────────────────────────────────────────────────────────

export interface SecretsProvider {
  /**
   * Fetch exchange credentials from the secret store.
   * @param vaultSecretId - the Vault secret id (vault.secrets.id), i.e.
   *   user_exchange_credentials.vault_secret_id — NEVER the credentials row id.
   *   The worker resolves credential_id → vault_secret_id first (Step 4a, F-01).
   * @throws {VaultSecretNotFoundError} if secret does not exist in Vault
   * @throws {VaultUnavailableError} if Vault is unreachable or returns an error
   */
  getExchangeCredentials(vaultSecretId: string): Promise<ExchangeCredentials>
}

// ─── Trade Status ─────────────────────────────────────────────────────────────
// Matches DB trade_status enum exactly.

export type TradeStatus =
  | 'pending'    // inserted before exchange call — Worker-internal only
  | 'submitted'  // sent to exchange, awaiting fill (ccxt: 'open')
  | 'filled'     // successfully filled (ccxt: 'closed')
  | 'failed'     // exchange rejected or unrecoverable error (ccxt: 'rejected'|'expired')
  | 'cancelled'  // cancelled by user or system (ccxt: 'canceled')
  | 'unknown'    // timeout or crash — requires reconciliation

/**
 * Statuses that an exchange can actually return.
 * Excludes 'pending' — that is set by the Worker before the exchange call,
 * the exchange never reports a trade as 'pending'.
 */
export type ExchangeReturnedStatus = Exclude<TradeStatus, 'pending'>

// ─── Market Data ──────────────────────────────────────────────────────────────

export interface AssetBalance {
  free: number   // available to trade
  used: number   // locked in open orders
  total: number  // free + used
}

/** Keyed by asset symbol, e.g. { USDT: { free: 100, used: 0, total: 100 } } */
export type Balance = Record<string, AssetBalance>

export interface MarketRules {
  symbol: string
  minNotional: number    // minimum order value in quote currency (e.g. USDT)
  stepSize: number       // lot size step — quantity must be a multiple of this
  minQty: number         // minimum order quantity
  pricePrecision: number // decimal places for price
  qtyPrecision: number   // decimal places for quantity
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export type OrderSide = 'buy' | 'sell'

/**
 * EP-protective: 'market' (the original MVP) or 'limit'. A 'limit' order REQUIRES a finite price > 0
 * (validated fail-closed in the adapter). ccxt exposes limit orders uniformly on every venue.
 */
export type OrderType = 'market' | 'limit'

export interface OrderParams {
  symbol: string
  side: OrderSide
  type: OrderType
  /** Already rounded DOWN to stepSize (Decision Log 2026-05-20: round down always) */
  quantity: number
  /** Format: PRX_<nanoid(10)> — generated before exchange call, stored in trades row */
  clientOrderId: string
  /** REQUIRED when type === 'limit' (finite, > 0); ignored for 'market'. */
  price?: number
  /**
   * EP-protective: optional native protective legs attached to the entry (a protective STOP-LOSS
   * trigger and/or TAKE-PROFIT trigger, absolute prices). When either is set the adapter places the
   * order via ccxt's createOrderWithTakeProfitAndStopLoss — and FAIL-CLOSES (places nothing) on any
   * venue whose ccxt `has.createOrderWithTakeProfitAndStopLoss` is false (e.g. binance/kraken/gate/
   * coinbase), so a requested protection is never silently dropped to leave a naked position. Full
   * Binance-native protective (separate createStopOrder + OCO lifecycle) is a follow-on.
   */
  stopLossPrice?: number
  takeProfitPrice?: number
  /** EP4 (futures exits): reduce-only. Ignored by spot venues. */
  reduceOnly?: boolean
}

export interface FetchOrderParams {
  clientOrderId?: string
  exchangeOrderId?: string
  symbol: string
}

export interface Order {
  id: string                      // exchange-assigned order ID
  clientOrderId: string           // PRX_<nanoid(10)> — Praxis-generated
  symbol: string
  side: OrderSide
  type: string
  status: ExchangeReturnedStatus  // Praxis domain status — never 'pending'
  quantity: number                // requested quantity
  filled: number                  // actually filled quantity
  price: number | null            // execution price (null while open)
  cost: number | null             // filled * price
  timestamp: number               // Unix ms — exchange timestamp
}

/**
 * EP4: an open derivatives position (futures/perp), normalized from ccxt's unified position shape.
 * Spot has no positions — this is only populated for futures venues.
 */
export interface Position {
  symbol:     string
  side:       'long' | 'short'
  contracts:  number                          // absolute position size (base/contracts)
  notional:   number | null                   // position notional in quote, when reported
  entryPrice: number | null
  leverage:   number | null
  marginMode: 'isolated' | 'cross' | null
}

// ─── Exchange Adapter ─────────────────────────────────────────────────────────

export interface ExchangeAdapter {
  /** Fetch current account balances. */
  fetchBalance(): Promise<Balance>

  /**
   * Fetch market trading rules for a symbol. EP1/EP2: the adapter is exchange-parameterized; rules
   * come from ccxt's unified precision/limits for every venue (Binance additionally uses its raw
   * LOT_SIZE/NOTIONAL filters — see parseMarketRules).
   */
  getMarketRules(symbol: string): Promise<MarketRules>

  /**
   * Fetch the current live price (last trade) for a symbol — read-only, PUBLIC market data.
   * Used by BUY sizing (notional → quantity). No credentials required.
   * @returns the last price (> 0)
   * @throws {ExchangeTimeoutError} if the exchange does not respond in time
   * @throws {ExchangeUnavailableError} if the exchange is unreachable or no usable price exists
   */
  fetchPrice(symbol: string): Promise<number>

  /**
   * Place a market order.
   * Precondition: INSERT trades(pending) must happen BEFORE calling this.
   * @throws {ExchangeRejectedError} if exchange rejects the order
   * @throws {ExchangeTimeoutError} if exchange does not respond in time
   * @throws {ExchangeUnavailableError} if exchange is unreachable
   */
  createOrder(params: OrderParams): Promise<Order>

  /**
   * Fetch order status from exchange.
   * Used by reconciliation worker and crash-recovery path.
   * @returns Order if found, null if exchange reports order does not exist
   * @throws {ExchangeTimeoutError} if exchange does not respond in time
   * @throws {ExchangeUnavailableError} if exchange is unreachable
   */
  fetchOrder(params: FetchOrderParams): Promise<Order | null>

  // ── EP4: futures/perp primitives (FOUNDATION — dormant; the safety-critical money-path wiring
  //    that MUST call these before any futures order — per-order setLeverage, isolated margin,
  //    reduce-only exits, exposure-based caps, separate futures testnet, master flag + per-bot
  //    opt-in — is a SEPARATE follow-on slice. Futures is NOT armed until that lands.) ────────────
  //
  // Each fail-closes (ExchangeRejectedError) on a venue whose ccxt lacks the capability — probed:
  // setLeverage/setMarginMode are ABSENT on kraken & coinbase (setMarginMode also on gate), so a
  // futures/leverage bot on those venues can never be armed. Optional so the spot path is unaffected.

  /** Set per-symbol leverage. MUST be called per-order by the futures wiring (never inherit account
   *  leverage). Fail-closed if the venue has no ccxt setLeverage. */
  setLeverage?(symbol: string, leverage: number): Promise<void>

  /** Force ISOLATED margin (never cross) for a symbol. Fail-closed if the venue has no setMarginMode. */
  setMarginMode?(symbol: string, marginMode: 'isolated'): Promise<void>

  /** Read open positions (futures) — the source of truth for exposure caps + flatten (EP5). */
  fetchPositions?(symbols?: string[]): Promise<Position[]>
}

// ─── Errors ───────────────────────────────────────────────────────────────────
// Error.message is ALWAYS a static string — no dynamic values, ever.
// Structured metadata may ride as non-message properties (VaultUnavailableError.code)
// so callers can log it; ids/codes still never enter the message itself. (F-14)
// Log credentialId/botId as structured metadata at the call site, not here.

export class VaultSecretNotFoundError extends Error {
  constructor() {
    super('Vault: secret not found')
    this.name = 'VaultSecretNotFoundError'
    Object.setPrototypeOf(this, VaultSecretNotFoundError.prototype)
  }
}

export class VaultUnavailableError extends Error {
  /**
   * @param code - optional PostgREST/Postgres error code (e.g. PGRST202, 42501)
   *   for structured logging — distinguishes permanent config faults from real
   *   outages. NEVER concatenated into Error.message. (F-14)
   */
  constructor(readonly code?: string) {
    super('Vault: service unavailable')
    this.name = 'VaultUnavailableError'
    Object.setPrototypeOf(this, VaultUnavailableError.prototype)
  }
}

export class ExchangeRejectedError extends Error {
  constructor() {
    super('Exchange: order rejected')
    this.name = 'ExchangeRejectedError'
    Object.setPrototypeOf(this, ExchangeRejectedError.prototype)
  }
}

export class ExchangeTimeoutError extends Error {
  constructor() {
    super('Exchange: request timed out')
    this.name = 'ExchangeTimeoutError'
    Object.setPrototypeOf(this, ExchangeTimeoutError.prototype)
  }
}

export class ExchangeUnavailableError extends Error {
  /**
   * @param detail optional NON-SECRET diagnostic for the caller to log: the original
   *   error class, optionally suffixed `:http_<status>`, or 'symbol_not_found'.
   *   NEVER a message/URL/query/header/body/signature -> no secret can leak. (WB6)
   */
  constructor(readonly detail?: string) {
    super('Exchange: service unavailable')
    this.name = 'ExchangeUnavailableError'
    Object.setPrototypeOf(this, ExchangeUnavailableError.prototype)
  }
}

/**
 * Thrown when ccxt reports AuthenticationError or PermissionDenied.
 * Indicates the API key is invalid, revoked, or has insufficient permissions.
 * This is a permanent failure — retrying cannot succeed.
 * Triggers immediate bot disable + credential invalidation (no threshold).
 * See ENG-002 (Decision Log 2026-06-02).
 */
export class ExchangeAuthError extends Error {
  constructor() {
    super('Exchange: authentication failed — credential invalid or revoked')
    this.name = 'ExchangeAuthError'
    Object.setPrototypeOf(this, ExchangeAuthError.prototype)
  }
}

/**
 * Binance error -2015 ("Invalid API-key, IP, or permissions for action") — DELIBERATELY DISTINCT from
 * ExchangeAuthError. -2015 is AMBIGUOUS: Binance returns it for a genuinely bad/revoked key AND for a GOOD,
 * IP-allowlisted key called from an egress IP not (yet) on its allowlist AND for a key missing a required
 * permission. On mainnet these are indistinguishable from the response alone (A4), so the worker must NOT
 * brand the credential a permanent 'invalid' (that would disable a good key on an infra/allowlist condition)
 * NOR retry forever (a truly bad key would loop). Callers treat this as OPERATOR-ACTIONABLE: fail-closed
 * (never trade), leave credential.status untouched, and surface a clear reason (verify the key's IP allowlist
 * + trade permission). Latent today — testnet keys are not IP-bound so -2015 never fires; this arms the
 * mainnet path (Plan v1.1 · 1.1).
 */
export class ExchangeAuthIpError extends Error {
  constructor() {
    super('Exchange: -2015 invalid key, IP, or permissions — verify IP allowlist + trade permission')
    this.name = 'ExchangeAuthIpError'
    Object.setPrototypeOf(this, ExchangeAuthIpError.prototype)
  }
}

// ─── Sizing + risk config (S5-A3/B4) ──────────────────────────────────────────
// DB-configured policy; the worker is the guardrail, the DB config is the policy.

export type SizingMode = 'percent_of_balance' | 'fixed_notional'
export type ExchangeEnvironment = 'testnet' | 'mainnet'

/**
 * Bot sizing + risk configuration, sourced from the `bots` row (migration 014).
 * NULL = unconfigured → fail-closed (no order). No business value is ever defaulted in code.
 */
export interface BotSizingConfig {
  sizing_mode:             SizingMode | null
  position_size_pct:       number | null   // used when sizing_mode='percent_of_balance'
  fixed_notional_usdt:     number | null    // used when sizing_mode='fixed_notional'
  max_order_notional_usdt: number | null    // per-order cap (always required to trade)
  daily_notional_cap_usdt: number | null    // per-bot daily cap (always required to trade)
  trading_enabled:         boolean          // server-side kill switch
  sell_enabled:            boolean          // v1 default false
  sell_size_pct:           number | null    // used when sell_enabled=true
}

/**
 * Sizing could not produce a valid order from config + market data (missing/invalid config,
 * unavailable price/balance, below minQty/minNotional). The `reason` is a NON-SECRET label only.
 */
export class SizingUnavailableError extends Error {
  constructor(readonly reason: string) {
    super('Sizing unavailable')
    this.name = 'SizingUnavailableError'
    Object.setPrototypeOf(this, SizingUnavailableError.prototype)
  }
}

/**
 * A server-side risk gate blocked the order (per-order max, daily cap, environment guard).
 * The `reason` is a NON-SECRET label only.
 */
export class RiskLimitExceededError extends Error {
  constructor(readonly reason: string) {
    super('Risk limit exceeded')
    this.name = 'RiskLimitExceededError'
    Object.setPrototypeOf(this, RiskLimitExceededError.prototype)
  }
}
