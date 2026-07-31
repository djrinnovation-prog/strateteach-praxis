/**
 * credentialValidation.ts — M8-validate: read-only credential validation.
 *
 * A user connects an exchange API key (connect-credential → credential status 'pending_validation').
 * Before a bot may be ARMED the key must be PROVEN to authenticate. This module performs that proof
 * OUT-OF-BAND from the trade path: it drains a DEDICATED pgmq queue (`credential_validations`,
 * physically isolated from the frozen trade_signals contract — migration 042), builds the SAME
 * adapter the trade path builds, and calls fetchBalance() — the minimal authenticated, READ-ONLY
 * call. There is NO createOrder anywhere in this file: a validation can never place a trade.
 *
 *   fetchBalance succeeds          → credential status → 'valid'    (audit credential.validated)
 *   ExchangeAuthError / secret gone→ credential status → 'invalid'  (audit credential.validation_failed)
 *   transient (timeout / outage)   → status UNTOUCHED, ack:false → retried via visibility timeout
 *   config fault (ownership / venue→ status UNTOUCHED, ack:true, logged — NEVER blame the user's key
 *     / env / egress / vault ptr)     for a server-side misconfiguration; operator investigates.
 *
 * Every non-status-changing gate is fail-closed and INHERITED from the trade path: credential
 * ownership (A8-H3 W1), venue is_active + SUPPORTED_EXCHANGES (EP1b), testnet/mainnet env guard,
 * and production egress (A1/B0). The ONE gate this module deliberately does NOT apply is
 * `status === 'valid'` — validation is exactly what DECIDES that, so it accepts a
 * 'pending_validation' or (re-validated) 'invalid'/'valid' credential; that is why it cannot reuse
 * reconciliation.defaultAdapterFor (which fail-closes on any non-'valid' credential).
 *
 * Operational contract is identical to reconciliationScan: flag-gated (default OFF / dark launch),
 * unref'd interval (never keeps the process alive on its own), in-flight guard against overlap,
 * cleared on shutdown, and NEVER throws (throttled-logged, swallowed). Dependency-injected for tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { BinanceAdapter } from './BinanceAdapter'
import { VaultSecretsProvider } from './VaultSecretsProvider'
import { SUPPORTED_EXCHANGES } from './supportedExchanges'
import { credentialOwnershipOk } from './credentialOwnership'
import { assertExchangeEnvironment } from './sizingRisk'
import { resolveEgress, productionEgressOk, type EgressConfig } from './egress'
import {
  type ExchangeAdapter,
  ExchangeAuthError,
  VaultSecretNotFoundError,
} from './types'

/** Dedicated queue — isolated from the frozen trade_signals contract (migration 042). */
export const CREDENTIAL_VALIDATION_QUEUE = 'credential_validations'
/** Frozen envelope version for validate requests (mirrors the trade contract's '1.0'). */
export const VALIDATION_SCHEMA_VERSION = '1.0'
/** Message discriminator — a validate request is never a trade and vice versa. */
export const VALIDATION_KIND = 'validate_credential'

/**
 * Visibility timeout (s) for a validate message. A single fetchBalance round-trip is far shorter,
 * but this must exceed worst-case processing so a crash mid-validate re-exposes the message rather
 * than losing it. Well under the trade path's timeout — validation does only ONE exchange call.
 */
export const VALIDATION_VISIBILITY_TIMEOUT_S = 30
/** Poll cadence — short, because a user is waiting on the result in the UI. */
export const VALIDATION_INTERVAL_MS_DEFAULT = 3_000
/**
 * Dead-letter cap: give up on a message after this many deliveries (pgmq read_ct). Without it, a
 * persistently-transient condition (a DB write that keeps erroring, an exchange stuck 5xx) would re-poll
 * forever and the user's UI would sit at pending_validation indefinitely. On give-up the message is
 * ACKed (removed) and logged as a dead-letter — the credential status is left UNTOUCHED (never a false
 * 'invalid' from an infra fault); the user can re-validate.
 */
export const MAX_VALIDATION_ATTEMPTS = 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Columns read from user_exchange_credentials — never selects a secret value. */
interface ValidationCredentialRow {
  vault_secret_id:      string | null
  status:               string
  deleted_at:           string | null
  exchange_environment: 'testnet' | 'mainnet' | null
  user_id:              string
  exchange_id:          string
}

/** pgmq message envelope (subset of pgmq.message_record). */
interface QueueMessage {
  msg_id:      number
  read_ct:     number
  message:     unknown
}

type IntervalHandle = { unref?: () => void }
type SetIntervalLike = (handler: () => void, ms: number) => IntervalHandle
type ClearIntervalLike = (handle: IntervalHandle) => void

/** Build the read-only adapter for a validation, or null to fail-closed (config fault). */
export type ValidationAdapterFactory = (args: {
  vaultSecretId: string
  ccxtId:        string
  isProduction:  boolean
  egress:        EgressConfig
  supabase:      SupabaseClient
}) => ExchangeAdapter

const defaultAdapterFactory: ValidationAdapterFactory = ({ vaultSecretId, ccxtId, isProduction, egress, supabase }) =>
  new BinanceAdapter(new VaultSecretsProvider(supabase), vaultSecretId, isProduction, egress.proxy, egress.nativeAllowed, ccxtId)

export interface StartCredentialValidationOptions {
  supabase: SupabaseClient
  /** Master switch — default OFF. When false: no interval, validateOnce is a no-op. */
  enabled: boolean
  isProduction: boolean
  /** Egress config (proxy/native). Defaults to resolveEgress(process.env). Injectable for tests. */
  egress?: EgressConfig
  intervalMs?: number
  visibilityTimeoutS?: number
  adapterFactory?: ValidationAdapterFactory
  setIntervalImpl?: SetIntervalLike
  clearIntervalImpl?: ClearIntervalLike
}

export interface CredentialValidationHandle {
  /** Clear the timer. Never throws. */
  stop(): void
  /** Drain one validate message (respecting the in-flight guard). Never throws. Exposed for tests. */
  validateOnce(): Promise<void>
}

/** Terminal (ack — remove from queue) vs transient (leave — retry via visibility timeout). */
type Outcome = { ack: boolean }
const ACK: Outcome = { ack: true }
const RETRY: Outcome = { ack: false }

export function startCredentialValidation(opts: StartCredentialValidationOptions): CredentialValidationHandle {
  const {
    supabase,
    enabled,
    isProduction,
    egress = resolveEgress(process.env),
    intervalMs = VALIDATION_INTERVAL_MS_DEFAULT,
    visibilityTimeoutS = VALIDATION_VISIBILITY_TIMEOUT_S,
    adapterFactory = defaultAdapterFactory,
    setIntervalImpl = ((handler, ms) => setInterval(handler, ms)) as SetIntervalLike,
    clearIntervalImpl = (handle => clearInterval(handle as ReturnType<typeof setInterval>)) as ClearIntervalLike,
  } = opts

  let inFlight = false
  let consecutiveFailures = 0
  const onFailure = (detail: string | undefined): void => {
    consecutiveFailures += 1
    if (consecutiveFailures === 1) {
      console.error(JSON.stringify({
        event: 'credential_validation_error',
        error: detail,
        note:  'validation poll only — worker health unaffected; repeats suppressed until recovery',
      }))
    }
  }
  const onSuccess = (): void => {
    if (consecutiveFailures > 0) {
      console.log(JSON.stringify({ event: 'credential_validation_recovered', failed_polls: consecutiveFailures }))
      consecutiveFailures = 0
    }
  }

  // Write an auditable, NON-SECRET row for the provisioning trail. Never carries a key, balance, or
  // vault_secret_id. Best-effort — an audit-insert failure must not change the validation outcome.
  const audit = async (
    credentialId: string,
    eventType:    string,
    after:        Record<string, unknown>,
  ): Promise<void> => {
    const { error } = await supabase.from('audit_logs').insert({
      entity_type:  'credential',
      entity_id:    credentialId,
      event_type:   eventType,
      before_state: {},
      after_state:  after,
      actor_type:   'worker',
    })
    if (error) {
      console.error(JSON.stringify({ event: 'validation_audit_insert_error', entity_id: credentialId, event_type: eventType, error: error.code }))
    }
  }

  // Flip credential status, guarded so a deleted / out-of-band credential is never resurrected, and
  // only the three real provisioning statuses are transitioned. Returns a THREE-way result so the caller
  // can tell a DB fault (retry — the validation result must not be lost) from a legitimate 0-row match
  // (deleted/out-of-band credential — nothing to do, ack). Conflating them (audit finding) would ACK and
  // DROP a proven verdict on a transient Postgres error, stranding the user's UI at pending_validation.
  const setStatus = async (credentialId: string, newStatus: 'valid' | 'invalid'): Promise<'error' | 'changed' | 'nomatch'> => {
    const { data, error } = await supabase
      .from('user_exchange_credentials')
      .update({ status: newStatus })
      .eq('id', credentialId)
      .is('deleted_at', null)
      .in('status', ['pending_validation', 'valid', 'invalid'])
      .select('id')
    if (error) {
      console.error(JSON.stringify({ event: 'validation_status_update_error', entity_id: credentialId, error: error.code }))
      return 'error'
    }
    return Array.isArray(data) && data.length > 0 ? 'changed' : 'nomatch'
  }

  // A credential just proved INVALID (key revoked/wrong-permissions or secret gone). Proactively disarm
  // any of its bots that are still armed, so a stray signal can't ride a now-dead key. Defense-in-depth:
  // the trade path already fail-closes (processMessage disables a bot whose credential.status !== 'valid'),
  // but disarming here removes the armed state immediately rather than on the next signal. Best-effort +
  // ownership-scoped to the SAME user (never disarm across users); a failure only logs (non-fatal).
  const disarmBotsForInvalidCredential = async (credentialId: string, ownerUserId: string): Promise<void> => {
    // Fully swallow BOTH a returned {error} AND a thrown client error (e.g. a network throw): the invalid
    // verdict is already persisted before this runs, so disarm must never propagate and skip the caller's
    // ACK — that would redeliver the message and re-run the whole validation until the read_ct cap.
    try {
      const { data, error } = await supabase
        .from('bots')
        .update({ trading_enabled: false, status: 'paused' })
        .eq('credential_id', credentialId)
        .eq('user_id', ownerUserId)
        .eq('trading_enabled', true)
        .select('id')
      if (error) {
        console.error(JSON.stringify({ event: 'validation_disarm_error', entity_id: credentialId, error: error.code }))
        return
      }
      const n = Array.isArray(data) ? data.length : 0
      if (n > 0) console.log(JSON.stringify({ event: 'validation_disarmed_bots', credential_id: credentialId, count: n }))
    } catch (e) {
      console.error(JSON.stringify({ event: 'validation_disarm_threw', entity_id: credentialId, error: e instanceof Error ? e.constructor.name : 'unknown' }))
    }
  }

  /**
   * Validate ONE request. Returns ack (remove) vs retry (leave). Pure decision logic + DB writes;
   * NEVER places an order (no createOrder import in this file). `request_id` is a non-secret label
   * threaded into logs so an operator can correlate a UI validate click with a worker outcome.
   */
  const handleValidate = async (botId: string, credentialId: string, requestId: string | null, readCt: number): Promise<Outcome> => {
    // Bounded retry: a transient condition retries via the visibility timeout, but only up to
    // MAX_VALIDATION_ATTEMPTS deliveries — then we give up (ACK + dead-letter log), status untouched.
    const retryOrGiveUp = (reason: string): Outcome => {
      if (readCt >= MAX_VALIDATION_ATTEMPTS) {
        console.error(JSON.stringify({ event: 'validate_dead_letter', credential_id: credentialId, request_id: requestId, read_ct: readCt, reason }))
        return ACK
      }
      return RETRY
    }
    // 1. Bot — establishes the ownership anchor + must still point at THIS credential.
    const { data: bot, error: botErr } = await supabase
      .from('bots')
      .select('id, credential_id, user_id')
      .eq('id', botId)
      .maybeSingle()
    if (botErr) return retryOrGiveUp('bot_fetch_error') // infra fault — truth unknown, bounded retry
    if (!bot) {
      console.log(JSON.stringify({ event: 'validate_bot_missing', bot_id: botId, request_id: requestId }))
      return ACK
    }
    if (bot.credential_id !== credentialId) {
      // The bot's credential changed since the request was enqueued — the request is stale. Do NOT
      // touch any credential's status off a stale pointer.
      console.log(JSON.stringify({ event: 'validate_credential_stale', bot_id: botId, request_id: requestId }))
      return ACK
    }

    // 2. Credential row (never selects a secret value).
    const { data: credData, error: credErr } = await supabase
      .from('user_exchange_credentials')
      .select('vault_secret_id, status, deleted_at, exchange_environment, user_id, exchange_id')
      .eq('id', credentialId)
      .maybeSingle()
    if (credErr) return retryOrGiveUp('credential_fetch_error')
    const cred = credData as ValidationCredentialRow | null
    if (!cred || cred.deleted_at !== null) {
      console.log(JSON.stringify({ event: 'validate_credential_gone', credential_id: credentialId, request_id: requestId }))
      return ACK
    }

    // 3. Ownership (A8-H3 W1) — fail closed, NO status change, NO adapter, NO decrypt. Non-secret log.
    if (!credentialOwnershipOk(cred.user_id, bot.user_id)) {
      console.error(JSON.stringify({ event: 'validate_owner_mismatch', bot_id: botId, credential_id: credentialId, request_id: requestId }))
      return ACK
    }

    // 4. Vault pointer sanity — a malformed pointer is a SERVER-side config fault, not a bad key.
    //    Leave status untouched (never mark the user's key invalid for our bug); log; ack (no retry loop).
    if (typeof cred.vault_secret_id !== 'string' || !UUID_RE.test(cred.vault_secret_id)) {
      console.error(JSON.stringify({ event: 'validate_vault_ptr_malformed', credential_id: credentialId, request_id: requestId }))
      return ACK
    }

    // 5. Venue double-gate (EP1b): exchanges.is_active AND SUPPORTED_EXCHANGES. Fetch error = infra → retry.
    const { data: ex, error: exErr } = await supabase
      .from('exchanges')
      .select('ccxt_id, is_active')
      .eq('id', cred.exchange_id)
      .maybeSingle()
    if (exErr) return retryOrGiveUp('exchange_fetch_error')
    if (!ex || ex.is_active !== true || !SUPPORTED_EXCHANGES.has(ex.ccxt_id)) {
      console.error(JSON.stringify({ event: 'validate_venue_gate', credential_id: credentialId, request_id: requestId }))
      return ACK // config fault — status untouched
    }

    // 6. Env guard (testnet/mainnet) + production egress — same fail-closed rails as the trade path.
    //    A mismatch/unconfigured egress is a config fault: status untouched, ack (operator fixes config).
    try {
      assertExchangeEnvironment(isProduction, cred.exchange_environment)
    } catch {
      console.error(JSON.stringify({ event: 'validate_env_mismatch', credential_id: credentialId, request_id: requestId }))
      return ACK
    }
    if (!productionEgressOk(isProduction, egress)) {
      console.error(JSON.stringify({ event: 'validate_egress_unconfigured', credential_id: credentialId, request_id: requestId }))
      return ACK
    }

    // 7. Build the read-only adapter + fetchBalance — the authentication proof. NO order, ever.
    const adapter = adapterFactory({
      vaultSecretId: cred.vault_secret_id,
      ccxtId:        ex.ccxt_id,
      isProduction,
      egress,
      supabase,
    })
    // NOTE (mainnet, latent): Binance returns AuthenticationError/PermissionDenied (ccxt) for BOTH a
    // genuinely bad key AND error -2015 "invalid IP" when a good, IP-allowlisted key is called from an
    // egress IP not yet on its allowlist. Today this path is testnet-only (the Edge fences mainnet), and
    // testnet keys are not IP-bound, so a good key is never mis-stamped. BEFORE the mainnet gate opens
    // (A4), the -2015 IP sub-case MUST be distinguished (operator-actionable/transient), never a permanent
    // 'invalid'. Tracked for mainnet hardening. Also: 'valid' proves READ auth only — it does NOT prove
    // trade-scope / no-withdrawal / correct IP-scope (arm still fail-closes on the first real order).
    try {
      await adapter.fetchBalance()
    } catch (e) {
      if (e instanceof ExchangeAuthError || e instanceof VaultSecretNotFoundError) {
        // Proven-bad credential: key invalid/revoked/wrong-permissions, or the secret is gone.
        const r = await setStatus(credentialId, 'invalid')
        if (r === 'error') return retryOrGiveUp('status_write_error_invalid') // don't lose the verdict on a DB fault
        if (r === 'changed') {
          await audit(credentialId, 'credential.validation_failed', { status: 'invalid', reason: e.constructor.name })
          await disarmBotsForInvalidCredential(credentialId, cred.user_id) // pull any armed bot off a dead key
        }
        console.log(JSON.stringify({ event: 'credential_validated', result: 'invalid', credential_id: credentialId, request_id: requestId, reason: e.constructor.name }))
        return ACK
      }
      // Transient (timeout / exchange or vault outage / unknown) — truth unknown. Bounded retry via VT; no status change.
      console.error(JSON.stringify({ event: 'validate_transient', credential_id: credentialId, request_id: requestId, error: e instanceof Error ? e.constructor.name : 'unknown' }))
      return retryOrGiveUp('fetch_balance_transient')
    }

    // Success: the exchange ACCEPTED the signed, authenticated read → the key works.
    const r = await setStatus(credentialId, 'valid')
    if (r === 'error') return retryOrGiveUp('status_write_error_valid') // don't lose a good verdict on a DB fault
    if (r === 'changed') await audit(credentialId, 'credential.validated', { status: 'valid' })
    console.log(JSON.stringify({ event: 'credential_validated', result: 'valid', credential_id: credentialId, request_id: requestId }))
    return ACK
  }

  const validateOnce = async (): Promise<void> => {
    if (!enabled) return
    if (inFlight) return
    inFlight = true
    try {
      const { data, error } = await supabase.rpc('pgmq_read', {
        queue_name: CREDENTIAL_VALIDATION_QUEUE,
        vt:         visibilityTimeoutS,
        qty:        1,
      })
      if (error) { onFailure(error.code); return }
      onSuccess()

      const rows = (data ?? []) as QueueMessage[]
      if (rows.length === 0) return
      const row = rows[0]
      const body = row.message as Record<string, unknown> | null

      // Malformed / non-validate message: it can NEVER be a trade (wrong queue + no side field), so
      // there is nothing safe to do but drop it. Ack so it does not wedge the queue.
      const okShape =
        body !== null &&
        body.schema_version === VALIDATION_SCHEMA_VERSION &&
        body.kind === VALIDATION_KIND &&
        typeof body.bot_id === 'string' &&
        typeof body.credential_id === 'string'
      if (!okShape) {
        console.error(JSON.stringify({ event: 'validate_malformed_message', msg_id: row.msg_id }))
        await supabase.rpc('pgmq_delete', { queue_name: CREDENTIAL_VALIDATION_QUEUE, msg_id: row.msg_id })
        return
      }

      const requestId = typeof body.request_id === 'string' ? body.request_id : null
      const readCt = typeof row.read_ct === 'number' ? row.read_ct : 1 // pgmq redelivery counter (dead-letter cap)
      const { ack } = await handleValidate(body.bot_id as string, body.credential_id as string, requestId, readCt)
      if (ack) {
        await supabase.rpc('pgmq_delete', { queue_name: CREDENTIAL_VALIDATION_QUEUE, msg_id: row.msg_id })
      }
    } catch (e) {
      onFailure(e instanceof Error ? e.constructor.name : 'unknown')
    } finally {
      inFlight = false
    }
  }

  if (!enabled) {
    return { stop: () => {}, validateOnce }
  }

  const handle = setIntervalImpl(() => { void validateOnce() }, intervalMs)
  handle.unref?.()

  return {
    stop: () => { clearIntervalImpl(handle) },
    validateOnce,
  }
}
