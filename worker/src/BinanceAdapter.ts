/**
 * BinanceAdapter.ts
 *
 * Implements ExchangeAdapter for Binance via ccxt.
 *
 * Security rules (Decision Log 2026-05-31):
 * - ccxt exchange created per-operation — NEVER cached or held as class state
 * - exchange.apiKey and exchange.secret zeroed in finally after every authenticated call
 * - credentials local reference set to null immediately after exchange creation
 * - No console.log — caller logs with structured metadata
 * - All thrown Error messages are static strings only — no dynamic values
 *
 * MarketRules cache (Decision Log 2026-06-01; F-03 2026-06-11):
 * - Cached separately from exchange objects (exchange is never cached)
 * - Key: binance:{symbol}, TTL: 12 hours
 * - Uses unauthenticated exchange — public data, no credentials needed
 * - STATIC (process-wide): the worker builds a fresh adapter per message, so an
 *   instance cache would always be cold — adding a full loadMarkets() round-trip
 *   (up to the 5000ms timeout) to EVERY trade and silently invalidating the
 *   worst-case timing behind the visibility_timeout formula. Wiped on restart.
 *
 * Exchange timeout (Decision Log 2026-06-02):
 * - Explicit timeout: 5000ms on all exchange instances (authenticated + public)
 * - Required: inline fetchOrder (Step 8b) adds a second exchange call to worst-case path.
 *   worst_case = T_vault + 2 × timeout + T_db + overhead ≈ 10.4s at 5000ms
 *   visibility_timeout formula: worst_case + 15s buffer = 25.4s → 30s default ✅
 *   If timeout > 7300ms: worst_case > 15.1s → 30s VT insufficient ❌
 *
 * Testnet (Decision Log 2026-06-01):
 * - setSandboxMode(true) when isProduction === false
 * - Non-production exchange never targets Binance mainnet URLs
 *
 * ccxt status mapping (Decision Log 2026-06-01):
 *   closed               → filled
 *   canceled / cancelled → cancelled
 *   rejected / expired   → failed
 *   open (any fill amt)  → submitted  (partial fill = MVP limitation)
 *   unrecognized         → unknown
 *
 * ccxt error mapping:
 *   AuthenticationError / PermissionDenied        → ExchangeAuthError (all authenticated methods)
 *   RequestTimeout              → ExchangeTimeoutError
 *   InvalidOrder / InsufficientFunds / BadSymbol  → ExchangeRejectedError (createOrder only)
 *   OrderNotFound               → null (fetchOrder only)
 *   everything else             → ExchangeUnavailableError
 */

import * as ccxt from 'ccxt'
import {
  ExchangeAdapter,
  ExchangeCredentials,
  SecretsProvider,
  Balance,
  MarketRules,
  OrderParams,
  FetchOrderParams,
  Order,
  Position,
  ExchangeReturnedStatus,
  ExchangeAuthError,
  ExchangeRejectedError,
  ExchangeTimeoutError,
  ExchangeUnavailableError,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

const MARKET_RULES_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

// ─── Module-private types ─────────────────────────────────────────────────────

interface CachedMarketRules {
  rules: MarketRules
  cachedAt: number
}

// ─── Safe error detail ──────────────────────────────────────────────────────────

/**
 * Distill an unknown caught error into a NON-SECRET diagnostic string for
 * `ExchangeUnavailableError.detail`: the original error CLASS, suffixed `:http_<status>`
 * when an `httpStatus` number is present. Reads ONLY `constructor.name` and the numeric
 * `httpStatus` — NEVER the message/URL/query/headers/body/request/response/signature/
 * api key — so no credential or PII can leak through logs, JSON, or util.inspect. (WB6/S4A)
 */
function safeExchangeDetail(e: unknown): string {
  const cls    = e instanceof Error ? e.constructor.name : 'unknown'
  const status = (e as { httpStatus?: number } | null)?.httpStatus
  return typeof status === 'number' ? `${cls}:http_${status}` : cls
}

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * Maps ccxt order status → ExchangeReturnedStatus.
 * Decision Log 2026-06-01: partial fills ('open' + filled > 0) map to 'submitted' — MVP limitation.
 */
function mapCcxtStatus(order: ccxt.Order): ExchangeReturnedStatus {
  switch (order.status) {
    case 'closed':    return 'filled'
    case 'canceled':
    case 'cancelled': return 'cancelled'
    case 'rejected':
    case 'expired':   return 'failed'
    case 'open':      return 'submitted'
    default:          return 'unknown'
  }
}

// ─── Order mapping ────────────────────────────────────────────────────────────

function mapCcxtOrder(raw: ccxt.Order): Order {
  return {
    id:            raw.id,
    clientOrderId: raw.clientOrderId ?? '',
    symbol:        raw.symbol,
    side:          raw.side as 'buy' | 'sell',
    type:          raw.type ?? 'market',
    status:        mapCcxtStatus(raw),
    quantity:      raw.amount,
    filled:        raw.filled ?? 0,
    // Market orders return price=0 before fill — normalise to null
    price:         raw.price > 0 ? raw.price : null,
    cost:          raw.cost  > 0 ? raw.cost  : null,
    timestamp:     raw.timestamp ?? Date.now(),
  }
}

// ─── Balance mapping ──────────────────────────────────────────────────────────

/**
 * Maps ccxt Balances → domain Balance.
 * Filters ccxt metadata keys (info, timestamp, datetime, free, used, total).
 * Each per-asset entry has shape { free: number, used: number, total: number }.
 */
function mapCcxtBalances(raw: ccxt.Balances): Balance {
  const result: Balance = {}
  const META_KEYS = new Set(['info', 'timestamp', 'datetime', 'free', 'used', 'total'])

  for (const [asset, value] of Object.entries(raw)) {
    if (META_KEYS.has(asset)) continue
    if (
      value !== null &&
      typeof value === 'object' &&
      'free' in value &&
      'used' in value &&
      'total' in value
    ) {
      const v = value as { free: number | undefined; used: number | undefined; total: number | undefined }
      result[asset] = {
        free:  v.free  ?? 0,
        used:  v.used  ?? 0,
        total: v.total ?? 0,
      }
    }
  }
  return result
}

/** EP4: normalize a ccxt Position to the domain Position (defensive numeric coercion + null-safe). */
function mapCcxtPosition(raw: ccxt.Position): Position {
  const num = (x: unknown): number | null =>
    x == null ? null : (Number.isFinite(Number(x)) ? Number(x) : null)
  const marginMode: Position['marginMode'] =
    raw.marginMode === 'isolated' ? 'isolated' : raw.marginMode === 'cross' ? 'cross' : null
  return {
    symbol:     raw.symbol,
    side:       raw.side === 'short' ? 'short' : 'long',
    contracts:  Math.abs(num(raw.contracts) ?? 0),
    notional:   num(raw.notional),
    entryPrice: num(raw.entryPrice),
    leverage:   num(raw.leverage),
    marginMode,
  }
}

// ─── Market rules parsing ─────────────────────────────────────────────────────

/**
 * Extracts MarketRules from a ccxt Market using Binance-specific filter arrays,
 * with fallback to ccxt normalised limits when raw filters are unavailable.
 *
 * Symbol is read from market.symbol (ccxt unified 'BTC/USDT' format) — NOT from the
 * raw DB trading_pair input. This ensures MarketRules.symbol is always slash-separated,
 * regardless of whether the DB stores 'BTCUSDT' or 'BTC/USDT'. Callers must extract
 * baseAsset via rules.symbol.split('/')[0], never from bot.trading_pair directly.
 * See ENG-001 (Decision Log 2026-06-02).
 *
 * Binance filter types consumed:
 *   LOT_SIZE      → stepSize, minQty
 *   MIN_NOTIONAL  → minNotional (spot)
 *   NOTIONAL      → minNotional (USD-M futures)
 *
 * Precision derivation:
 *   qtyPrecision   = -log10(stepSize)  e.g. stepSize 0.001 → 3 d.p.
 *   pricePrecision = market.precision.price (ccxt decimal-places value for Binance)
 */
function parseMarketRules(market: NonNullable<ccxt.Market>, exchangeId: string): MarketRules {
  // Always use ccxt unified symbol (e.g. 'BTC/USDT'), never the raw DB value
  const symbol = market.symbol
  // EP2: Binance exposes raw LOT_SIZE / NOTIONAL filters in market.info that are authoritative, so we
  // prefer them FOR BINANCE ONLY. Every OTHER venue uses ccxt's UNIFIED precision/limits
  // (market.precision.* / market.limits.*), which ccxt normalizes across all exchanges — so no
  // per-venue raw-filter parsing is needed. Gating on exchangeId (rather than merely "the filter was
  // not found") makes the Binance specialization explicit and prevents a coincidental foreign
  // `filters` shape from ever being misread. market.info is the raw exchange object — untyped in ccxt.
  const info = exchangeId === 'binance'
    ? (market as unknown as { info?: { filters?: Array<Record<string, string>> } }).info
    : undefined
  const filters: Array<Record<string, string>> = Array.isArray(info?.filters)
    ? (info!.filters as Array<Record<string, string>>)
    : []

  const lotSize        = filters.find(f => f.filterType === 'LOT_SIZE')
  const notionalFilter = filters.find(
    f => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL'
  )

  // EP2: ccxt runs ALL our venues in TICK_SIZE precisionMode, so market.precision.amount IS the
  // amount step (e.g. 0.00001), NOT a decimal-place count. Use it directly. (The old fallback
  // Math.pow(10, -amount) assumed DECIMAL_PLACES mode — correct only if amount were a count; it was
  // never exercised for Binance, which always has LOT_SIZE filters, but is flat-wrong for any
  // TICK_SIZE venue that lacks Binance-style filters, e.g. Bybit.)
  const stepSize = lotSize !== undefined
    ? parseFloat(lotSize.stepSize)
    : (market.precision.amount ?? 0)

  const minQty = lotSize !== undefined
    ? parseFloat(lotSize.minQty)
    : (market.limits.amount?.min ?? 0)

  const minNotional = notionalFilter !== undefined
    ? parseFloat(notionalFilter.minNotional ?? notionalFilter.notional ?? '0')
    : (market.limits.cost?.min ?? 0)

  // H-3: reject a poisoned filter set BEFORE it is returned (and cached for 12h). A stepSize that
  // parses to 0 or NaN makes roundDownToStep produce NaN, which silently bypasses every min guard and
  // reaches createOrder with quantity=NaN. Fail closed: stepSize must be finite and > 0; minQty and
  // minNotional must be finite and ≥ 0. Throwing here means getMarketRules does NOT cache the bad
  // rules (the cache.set runs only on success), so a transient bad response cannot poison for 12h.
  if (!(isFinite(stepSize) && stepSize > 0)) {
    throw new ExchangeUnavailableError('invalid_market_rules_step_size')
  }
  if (!(isFinite(minQty) && minQty >= 0)) {
    throw new ExchangeUnavailableError('invalid_market_rules_min_qty')
  }
  if (!(isFinite(minNotional) && minNotional >= 0)) {
    throw new ExchangeUnavailableError('invalid_market_rules_min_notional')
  }

  // Derive integer decimal places from step/tick size (ccxt TICK_SIZE mode for all our venues:
  // e.g. 0.00001 not 5). Convert: value < 1 → -log10(value); value ≥ 1 → already decimal places
  // (tolerates a whole-unit tick like 1 → 0 d.p.). e.g. stepSize 0.00001 → 5 d.p. | price tick 0.01 → 2 d.p.
  const tickToDecimalPlaces = (tick: number): number =>
    tick > 0 && tick < 1 ? Math.round(-Math.log10(tick)) : Math.round(tick)

  // stepSize is guaranteed finite & > 0 by the guard above.
  const qtyPrecision   = tickToDecimalPlaces(stepSize)
  const pricePrecision = tickToDecimalPlaces(market.precision.price ?? 0)

  return { symbol, minNotional, stepSize, minQty, pricePrecision, qtyPrecision }
}

// ─── BinanceAdapter ───────────────────────────────────────────────────────────

export class BinanceAdapter implements ExchangeAdapter {
  // Process-wide — see "MarketRules cache" in the file header (F-03).
  private static readonly marketRulesCache = new Map<string, CachedMarketRules>()

  /** Test hook — clears the process-wide market-rules cache. */
  static clearMarketRulesCache(): void {
    BinanceAdapter.marketRulesCache.clear()
  }

  /**
   * @param secretsProvider - retrieves exchange credentials from Vault per call
   * @param vaultSecretId   - Vault secret id (user_exchange_credentials.vault_secret_id),
   *                          resolved by the worker (Step 4a, F-01) — NEVER the
   *                          credentials row id.
   * @param isProduction    - false → ccxt sandbox mode (Binance testnet); true → mainnet
   * @param exchangeHttpsProxy - A1 Option B: fixed-IP forward proxy URL for exchange egress, or null.
   *                          When set, it is passed to ccxt (`httpsProxy`) on BOTH the authenticated and public
   *                          Binance instances so ALL exchange traffic egresses via the static proxy IP. NEVER logged.
   * @param nativeEgressAllowed - A1 Option A (B0): true iff EXCHANGE_EGRESS_MODE=native — the worker egresses
   *                          DIRECTLY via Railway's static outbound IPs (no proxy). In production, egress must be
   *                          configured one way or the other: a proxy OR native. This constructor invariant is
   *                          defense-in-depth (primary gate is worker Step 4b) — no ccxt instance may be built in
   *                          production with neither a proxy nor native egress explicitly allowed.
   */
  constructor(
    private readonly secretsProvider: SecretsProvider,
    private readonly vaultSecretId: string,
    private readonly isProduction: boolean,
    private readonly exchangeHttpsProxy: string | null = null,
    private readonly nativeEgressAllowed: boolean = false,
    // EP1: the ccxt exchange id (binance/bybit/okx/kraken/kucoin/bitget/gate/coinbase). Defaults to
    // 'binance' so every existing call site is byte-identical. The real value is threaded from the
    // bot's `exchange` column in EP2.
    private readonly exchangeId: string = 'binance',
  ) {
    // Defense-in-depth: in production the mainnet path MUST egress via a configured route — a proxy OR native
    // static egress (Railway static outbound IPs). Neither ⇒ fail-closed. Applies to EVERY exchange.
    if (this.isProduction && !this.exchangeHttpsProxy && !this.nativeEgressAllowed) {
      throw new Error('BinanceAdapter: exchange egress unconfigured in production (need EXCHANGE_HTTPS_PROXY or EXCHANGE_EGRESS_MODE=native)')
    }
    // Audit hardening: fail-closed on an unknown venue AT CONSTRUCTION — before any Vault key is ever
    // fetched — so a bad exchangeId can never leave a just-fetched apiKey/secret un-zeroed on a later
    // build throw. buildExchange() re-checks (belt-and-suspenders).
    if (typeof (ccxt as unknown as Record<string, unknown>)[this.exchangeId] !== 'function') {
      throw new Error(`BinanceAdapter: unsupported exchange '${this.exchangeId}'`)
    }
  }

  // ── Private: exchange factories ───────────────────────────────────────────

  /**
   * Resolves the ccxt exchange constructor for this.exchangeId and applies the sandbox/egress
   * invariants that EVERY exchange instance must obey. This is the single choke-point through which
   * both the authenticated and public factories build their ccxt instance, so no future venue can
   * skip the invariants:
   *   - unknown exchange id ⇒ fail-closed (never silently fall back to a different venue),
   *   - non-production ⇒ setSandboxMode(true), which itself throws (fail-closed) on a venue that
   *     has no testnet — so we can never accidentally hit a mainnet endpoint in a testnet run.
   * Binance (the default) constructs byte-identically to the previous `new ccxt.binance(config)`.
   * CALLER MUST zero exchange.apiKey and exchange.secret in a finally block.
   */
  private buildExchange(config: Record<string, unknown>): ccxt.Exchange {
    const ExchangeClass = (ccxt as unknown as Record<string, unknown>)[this.exchangeId]
    if (typeof ExchangeClass !== 'function') {
      throw new Error(`BinanceAdapter: unsupported exchange '${this.exchangeId}'`)
    }
    const exchange = new (ExchangeClass as new (c: Record<string, unknown>) => ccxt.Exchange)(config)
    if (!this.isProduction) {
      exchange.setSandboxMode(true)   // throws (fail-closed) if the venue exposes no testnet sandbox
    }
    return exchange
  }

  /**
   * Creates a new authenticated ccxt exchange instance for this.exchangeId.
   * CALLER MUST zero exchange.apiKey and exchange.secret in a finally block.
   * Exchange is never stored as class state — caller holds the reference only.
   *
   * timeout: 5000ms — explicit cap required for visibility_timeout safety.
   * With inline fetchOrder (Step 8b), worst-case path = 2 × timeout + overhead.
   * At 5000ms: worst_case ≈ 10.4s, required visibility_timeout ≈ 25.4s (< 30s default).
   * ccxt default (10000ms) would require visibility_timeout ≥ 35.4s — exceeds current setting.
   * See Decision Log: "pgmq visibility_timeout — PENDING MEASUREMENT"
   */
  private createAuthenticatedExchange(credentials: ExchangeCredentials): ccxt.Exchange {
    return this.buildExchange({
      apiKey:  credentials.apiKey,
      secret:  credentials.apiSecret,   // ccxt field is 'secret', not 'apiSecret'
      timeout: 5000,                    // ms — must be kept ≤ 5000 for 30s visibility_timeout safety
      // A1 Option B: route exchange egress via the fixed-IP proxy when configured (verified ccxt option, v4.5.56).
      ...(this.exchangeHttpsProxy ? { httpsProxy: this.exchangeHttpsProxy } : {}),
    })
  }

  /**
   * Creates a new unauthenticated ccxt exchange instance for public market data.
   * Still applies sandbox mode in non-production to prevent accidental mainnet calls.
   * timeout: 5000ms — consistent with authenticated exchange; market data calls
   * are public but still constrained for predictable failure latency.
   */
  private createPublicExchange(): ccxt.Exchange {
    return this.buildExchange({
      timeout: 5000,
      // A1 Option B: public market-data calls MUST also egress via the proxy (no key-less bypass).
      ...(this.exchangeHttpsProxy ? { httpsProxy: this.exchangeHttpsProxy } : {}),
    })
  }

  // ── fetchBalance ──────────────────────────────────────────────────────────

  async fetchBalance(): Promise<Balance> {
    let credentials: ExchangeCredentials | null =
      await this.secretsProvider.getExchangeCredentials(this.vaultSecretId)

    const exchange = this.createAuthenticatedExchange(credentials)
    credentials = null // drop reference — exchange holds values; zeroed in finally below

    try {
      const raw = await exchange.fetchBalance()
      return mapCcxtBalances(raw)
    } catch (e) {
      if (e instanceof ccxt.AuthenticationError || e instanceof ccxt.PermissionDenied) throw new ExchangeAuthError()
      if (e instanceof ccxt.RequestTimeout) throw new ExchangeTimeoutError()
      // Carry the ORIGINAL ccxt error CLASS (+ httpStatus) as a NON-SECRET diagnostic so the caller can
      // log WHY the authenticated read failed (network vs geo-block vs clock-skew), class/status ONLY —
      // never the message/URL/query/headers/body/signature/credentials. See safeExchangeDetail. Matches
      // the same treatment already used by getMarketRules/createOrder/fetchOrder.
      throw new ExchangeUnavailableError(safeExchangeDetail(e))
    } finally {
      exchange.apiKey = ''
      exchange.secret = ''
    }
  }

  // ── getMarketRules ────────────────────────────────────────────────────────

  async getMarketRules(symbol: string): Promise<MarketRules> {
    const cacheKey = `binance:${symbol}`
    const cached = BinanceAdapter.marketRulesCache.get(cacheKey)

    if (cached !== undefined && Date.now() - cached.cachedAt < MARKET_RULES_TTL_MS) {
      return cached.rules
    }

    const rules = await this.fetchMarketRulesFromExchange(symbol)
    BinanceAdapter.marketRulesCache.set(cacheKey, { rules, cachedAt: Date.now() })
    return rules
  }

  // ── fetchPrice ────────────────────────────────────────────────────────────

  /**
   * Live last price for a symbol — read-only, PUBLIC market data (no credentials). Used by BUY
   * sizing (notional → quantity). On failure throws ExchangeTimeoutError / ExchangeUnavailableError
   * carrying only a NON-SECRET class/status detail (public path — no signature/credentials exist).
   */
  async fetchPrice(symbol: string): Promise<number> {
    const exchange = this.createPublicExchange()
    try {
      const ticker = await exchange.fetchTicker(symbol)
      const last = ticker.last
      if (typeof last !== 'number' || !isFinite(last) || last <= 0) {
        throw new ExchangeUnavailableError('no_last_price')
      }
      return last
    } catch (e) {
      if (e instanceof ExchangeUnavailableError) throw e
      if (e instanceof ccxt.RequestTimeout)     throw new ExchangeTimeoutError()
      throw new ExchangeUnavailableError(safeExchangeDetail(e))
    }
  }

  private async fetchMarketRulesFromExchange(symbol: string): Promise<MarketRules> {
    const exchange = this.createPublicExchange()
    try {
      await exchange.loadMarkets()
      // Audit hardening: parseMarketRules treats market.precision.amount as a TICK step, valid ONLY in
      // TICK_SIZE precisionMode. Every currently-allowlisted venue runs TICK_SIZE — but fail-closed if a
      // future venue (or a ccxt change) runs DECIMAL_PLACES, where precision.amount is a decimal-place
      // COUNT (e.g. 5) that would otherwise be mis-read as a literal step of 5 → silent mis-rounding.
      if (exchange.precisionMode !== (ccxt as unknown as { TICK_SIZE: number }).TICK_SIZE) {
        throw new ExchangeUnavailableError('unsupported_precision_mode')
      }
      const market = exchange.market(symbol)
      if (market === undefined) throw new ExchangeUnavailableError('symbol_not_found')
      return parseMarketRules(market, this.exchangeId)
    } catch (e) {
      if (e instanceof ExchangeUnavailableError) throw e
      if (e instanceof ccxt.RequestTimeout)     throw new ExchangeTimeoutError()
      // Surface the ORIGINAL ccxt error CLASS (+ httpStatus) as a NON-SECRET diagnostic so
      // the caller can log WHY market data was unavailable — class/status only, never the
      // message/URL/query/headers/body. See safeExchangeDetail.
      throw new ExchangeUnavailableError(safeExchangeDetail(e))
    }
  }

  // ── createOrder ───────────────────────────────────────────────────────────

  async createOrder(params: OrderParams): Promise<Order> {
    // EP-protective: validate order-type invariants BEFORE touching credentials/exchange (fail-closed).
    // A 'limit' order MUST carry a finite price > 0 — otherwise it is a naked/garbage order.
    if (params.type === 'limit' && !(typeof params.price === 'number' && isFinite(params.price) && params.price > 0)) {
      throw new ExchangeRejectedError()
    }
    const wantsProtective = params.stopLossPrice != null || params.takeProfitPrice != null
    const limitPrice = params.type === 'limit' ? params.price : undefined
    // ccxt extra params: the market path stays EXACTLY `{ newClientOrderId }` (byte-identical) when
    // nothing extra is requested; reduceOnly is added ONLY when explicitly set (EP4 futures exits —
    // spot venues ignore it).
    const extra: Record<string, unknown> = { newClientOrderId: params.clientOrderId }
    if (params.reduceOnly) extra.reduceOnly = true

    let credentials: ExchangeCredentials | null =
      await this.secretsProvider.getExchangeCredentials(this.vaultSecretId)

    const exchange = this.createAuthenticatedExchange(credentials)
    credentials = null

    try {
      let raw: ccxt.Order
      if (wantsProtective) {
        // Attach native protective legs (stop-loss / take-profit triggers) at entry. FAIL-CLOSED on
        // any venue whose ccxt cannot attach them in one call (has.createOrderWithTakeProfitAndStopLoss
        // === false — e.g. binance/kraken/gate/coinbase): never place the entry and silently drop the
        // requested protection, leaving a naked position. (Full Binance-native protective via separate
        // createStopOrder + OCO lifecycle is a documented follow-on.)
        const supported =
          (exchange.has as Record<string, unknown> | undefined)?.createOrderWithTakeProfitAndStopLoss === true
        if (!supported) throw new ExchangeRejectedError()
        raw = await exchange.createOrderWithTakeProfitAndStopLoss(
          params.symbol,
          params.type,
          params.side,
          params.quantity,
          limitPrice,
          params.takeProfitPrice,
          params.stopLossPrice,
          extra,
        )
      } else {
        raw = await exchange.createOrder(
          params.symbol,
          params.type,      // 'market' | 'limit'
          params.side,
          params.quantity,
          limitPrice,       // undefined for market; validated finite>0 for limit
          extra,
        )
      }
      return mapCcxtOrder(raw)
    } catch (e) {
      // EP-protective: a domain error we raised INSIDE the try (e.g. protective-unsupported venue →
      // ExchangeRejectedError) must propagate AS-IS — never be re-mapped by the ccxt mapping below.
      // The finally still zeroes the credentials.
      if (e instanceof ExchangeRejectedError) throw e
      if (e instanceof ccxt.AuthenticationError || e instanceof ccxt.PermissionDenied) throw new ExchangeAuthError()
      if (e instanceof ccxt.RequestTimeout)    throw new ExchangeTimeoutError()
      if (e instanceof ccxt.InvalidOrder)      throw new ExchangeRejectedError()
      if (e instanceof ccxt.InsufficientFunds) throw new ExchangeRejectedError()
      if (e instanceof ccxt.BadSymbol)         throw new ExchangeRejectedError()
      // Unknown failure (e.g. ExchangeNotAvailable / network / http_451): carry the original
      // ccxt error CLASS (+ httpStatus) as a NON-SECRET detail so the worker can log WHY the
      // order path failed. Authenticated path — class/status ONLY, never the message/URL/
      // query/headers/body/signature/credentials. See safeExchangeDetail.
      throw new ExchangeUnavailableError(safeExchangeDetail(e))
    } finally {
      exchange.apiKey = ''
      exchange.secret = ''
    }
  }

  // ── fetchOrder ────────────────────────────────────────────────────────────

  async fetchOrder(params: FetchOrderParams): Promise<Order | null> {
    let credentials: ExchangeCredentials | null =
      await this.secretsProvider.getExchangeCredentials(this.vaultSecretId)

    const exchange = this.createAuthenticatedExchange(credentials)
    credentials = null

    try {
      let raw: ccxt.Order

      if (params.exchangeOrderId !== undefined) {
        // Primary lookup: Binance exchange-assigned order ID
        raw = await exchange.fetchOrder(params.exchangeOrderId, params.symbol)
      } else if (params.clientOrderId !== undefined) {
        // Reconciliation path: Binance origClientOrderId parameter
        // ccxt Binance driver forwards this to GET /api/v3/order?origClientOrderId=...
        raw = await exchange.fetchOrder(
          params.clientOrderId,
          params.symbol,
          { origClientOrderId: params.clientOrderId },
        )
      } else {
        // Neither identifier provided — callers must supply at least one
        throw new ExchangeUnavailableError()
      }

      return mapCcxtOrder(raw)
    } catch (e) {
      if (e instanceof ccxt.AuthenticationError || e instanceof ccxt.PermissionDenied) throw new ExchangeAuthError()
      if (e instanceof ccxt.OrderNotFound)      return null
      if (e instanceof ccxt.RequestTimeout)     throw new ExchangeTimeoutError()
      if (e instanceof ExchangeUnavailableError) throw e
      // Unknown/unavailable: carry the original ccxt error CLASS (+ httpStatus) as a
      // NON-SECRET detail (class/status only; never message/URL/headers/body/credentials).
      throw new ExchangeUnavailableError(safeExchangeDetail(e))
    } finally {
      exchange.apiKey = ''
      exchange.secret = ''
    }
  }

  // ── EP4: futures/perp primitives (FOUNDATION — dormant) ─────────────────────
  // Each runs on a fresh authenticated ccxt instance and zeroes the credentials in finally, exactly
  // like createOrder. Each FAIL-CLOSES (ExchangeRejectedError) when the venue's ccxt lacks the
  // capability, so a futures/leverage bot can never be armed on an unsupported venue (kraken/coinbase
  // have no setLeverage; kraken/gate/coinbase have no setMarginMode). These are NOT yet called by the
  // order path — the futures money-path wiring (mandatory per-order leverage, isolated margin,
  // reduce-only exits, exposure caps, futures testnet, master flag) is a separate follow-on.

  /** Shared authenticated-call scaffold: build a fresh exchange, run fn, map errors like createOrder,
   *  and ALWAYS zero the credentials. A domain error thrown by fn propagates unchanged. */
  private async withAuthenticatedExchange<T>(fn: (exchange: ccxt.Exchange) => Promise<T>): Promise<T> {
    let credentials: ExchangeCredentials | null =
      await this.secretsProvider.getExchangeCredentials(this.vaultSecretId)
    const exchange = this.createAuthenticatedExchange(credentials)
    credentials = null
    try {
      return await fn(exchange)
    } catch (e) {
      if (e instanceof ExchangeRejectedError || e instanceof ExchangeAuthError
        || e instanceof ExchangeTimeoutError || e instanceof ExchangeUnavailableError) throw e
      if (e instanceof ccxt.AuthenticationError || e instanceof ccxt.PermissionDenied) throw new ExchangeAuthError()
      if (e instanceof ccxt.RequestTimeout) throw new ExchangeTimeoutError()
      if (e instanceof ccxt.InvalidOrder || e instanceof ccxt.InsufficientFunds || e instanceof ccxt.BadSymbol) throw new ExchangeRejectedError()
      throw new ExchangeUnavailableError(safeExchangeDetail(e))
    } finally {
      exchange.apiKey = ''
      exchange.secret = ''
    }
  }

  private static venueHas(exchange: ccxt.Exchange, capability: string): boolean {
    return (exchange.has as Record<string, unknown> | undefined)?.[capability] === true
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    // Invalid leverage is a config fault, not an exchange outage — fail-closed before any call.
    if (!(Number.isFinite(leverage) && leverage >= 1)) throw new ExchangeRejectedError()
    return this.withAuthenticatedExchange(async (exchange) => {
      if (!BinanceAdapter.venueHas(exchange, 'setLeverage')) throw new ExchangeRejectedError()
      await exchange.setLeverage(leverage, symbol)
    })
  }

  async setMarginMode(symbol: string, marginMode: 'isolated'): Promise<void> {
    return this.withAuthenticatedExchange(async (exchange) => {
      if (!BinanceAdapter.venueHas(exchange, 'setMarginMode')) throw new ExchangeRejectedError()
      await exchange.setMarginMode(marginMode, symbol)
    })
  }

  async fetchPositions(symbols?: string[]): Promise<Position[]> {
    return this.withAuthenticatedExchange(async (exchange) => {
      if (!BinanceAdapter.venueHas(exchange, 'fetchPositions')) throw new ExchangeRejectedError()
      const raw = await exchange.fetchPositions(symbols)
      return (raw ?? []).map(mapCcxtPosition)
    })
  }
}
