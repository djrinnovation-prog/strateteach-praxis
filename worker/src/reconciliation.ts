// worker/src/reconciliation.ts
//
// S4-3a — reconciliation RESOLUTION. Turns a stuck `pending`/`unknown` trade into its true terminal
// status by calling `fetchOrder` (READ-ONLY on the exchange) and updating the trade +
// `reconciliation_jobs` idempotently. It NEVER calls `createOrder` — the resolver can never place,
// re-place, or duplicate an order. Wired into boot reconciliation ONLY (the runtime
// `setInterval(60s)` scan — S4-3b — is deferred and would reuse `resolveStuckTrade` unchanged).
//
// Enum default (b): `reconciliation_jobs.resolution` has no `failed` value, so for failed /
// order_not_found we set `resolution = NULL` + `notes`, and let `trades.status='failed'` carry the
// precise truth. No migration 013.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExchangeAdapter } from './types'
import { ExchangeAuthError } from './types'
import { VaultSecretsProvider } from './VaultSecretsProvider'
import { BinanceAdapter } from './BinanceAdapter'
import { credentialOwnershipOk } from './credentialOwnership'
import { SUPPORTED_EXCHANGES } from './supportedExchanges'

export const RECONCILIATION_RESOLVE_THRESHOLD_SECONDS = 60
export const RECONCILIATION_RESOLVE_CAP = 10

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The stuck-trade columns the resolver needs. */
export interface StuckTrade {
  id: string
  bot_id: string
  signal_id: string
  status: string
  client_order_id: string
  trading_pair: string
  exchange_order_id: string | null
}

export type ResolveAction =
  | 'resolved_filled'
  | 'resolved_cancelled'
  | 'resolved_failed' // failed or order_not_found
  | 'left_open' // open on exchange — NOT terminal; trade left pending/unknown for a later boot
  | 'left_pending_unknown' // exchange itself returned 'unknown'
  | 'left_pending_transient' // timeout / unavailable / unexpected — nothing changed
  | 'job_failed_auth' // credential problem — job failed for triage, trade untouched
  | 'noop_not_stuck' // entry guard: trade already terminal
  | 'noop_race' // conditional UPDATE matched 0 rows (another path resolved it)
  | 'job_update_failed' // trade reached terminal but the reconciliation_job could not be resolved (orphan → repair)

export interface ResolveResult {
  trade_id: string
  action: ResolveAction
  trade_status: string
}

function log(event: string, trade: StuckTrade, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, trade_id: trade.id, bot_id: trade.bot_id, status: trade.status, ...extra }));
}

/**
 * M-6: the fill fields a reconciliation-resolved terminal trade must persist so the trade record is
 * complete (P&L computable, order traceable). All optional — only present values are written.
 */
export interface ReconciledFill {
  exchangeOrderId?: string | null;
  price?: number | null;
  executedNotional?: number | null;
  filledAt?: string | null;
}

/** Conditional UPDATE on trades — only rows still `pending`/`unknown`. Returns affected row count. */
async function updateTradeStatus(
  supabase: SupabaseClient,
  tradeId: string,
  newStatus: string,
  errorReason?: string,
  fill?: ReconciledFill,
): Promise<number> {
  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
  if (errorReason) patch.error_reason = errorReason;
  // M-6: persist the fill so a reconciled 'filled' trade is not left with NULL price / order id (no P&L,
  // untraceable for dispute/audit). Only defined values are written; the `.in(['pending','unknown'])`
  // guard below still applies, so this can never overwrite an already-terminal trade.
  if (fill) {
    if (fill.exchangeOrderId != null) patch.exchange_order_id = fill.exchangeOrderId;
    if (fill.price != null) patch.price_at_execution = fill.price;
    if (fill.executedNotional != null) patch.executed_notional_usdt = fill.executedNotional;
    if (fill.filledAt != null) patch.filled_at = fill.filledAt;
  }
  const { data, error } = await supabase
    .from('trades')
    .update(patch)
    .eq('id', tradeId)
    .in('status', ['pending', 'unknown'])
    .select('id');
  if (error) {
    console.error(JSON.stringify({ event: 'reconciliation_trade_update_error', trade_id: tradeId, error: error.code }));
    return 0; // treat as no-op → leave job pending → safe retry
  }
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Conditional UPDATE on the reconciliation_job — only while it is still `pending`. Returns the number
 * of rows ACTUALLY updated (0 on error OR on a 0-row match). A PostgREST UPDATE that matches no rows
 * returns NO error, so a 0-row update must be detected via `.select(...)` — callers must NOT treat 0
 * as success.
 */
async function updateJob(supabase: SupabaseClient, tradeId: string, patch: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabase
    .from('reconciliation_jobs')
    .update(patch)
    .eq('trade_id', tradeId)
    .eq('status', 'pending')
    .select('trade_id');
  if (error) {
    console.error(JSON.stringify({ event: 'reconciliation_job_update_error', trade_id: tradeId, error: error.code }));
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

async function insertAudit(
  supabase: SupabaseClient,
  tradeId: string,
  eventType: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    entity_type: 'trade',
    entity_id: tradeId,
    event_type: eventType,
    before_state: before,
    after_state: after,
    actor_type: 'worker',
  });
  if (error) {
    console.error(JSON.stringify({ event: 'reconciliation_audit_error', trade_id: tradeId, error: error.code }));
  }
}

async function finalizeTerminal(
  supabase: SupabaseClient,
  trade: StuckTrade,
  tradeStatus: string,
  resolution: 'filled' | 'cancelled' | null,
  notes: string,
  action: ResolveAction,
  fill?: ReconciledFill,
): Promise<ResolveResult> {
  const rows = await updateTradeStatus(supabase, trade.id, tradeStatus, tradeStatus === 'failed' ? notes : undefined, fill);
  if (rows === 0) {
    // Lost the race — another path already moved this trade to terminal. No-op.
    log('reconciliation_resolve_race_noop', trade, { intended: tradeStatus });
    return { trade_id: trade.id, action: 'noop_race', trade_status: trade.status };
  }
  // The trade transition really happened — mark the job resolved, then audit the transition.
  const jobRows = await updateJob(supabase, trade.id, { status: 'resolved', resolution, notes, resolved_at: new Date().toISOString() });
  await insertAudit(supabase, trade.id, `trade.${tradeStatus}`, { status: trade.status }, { status: tradeStatus });
  if (jobRows !== 1) {
    // The trade is now terminal but EXACTLY ONE pending reconciliation_job was NOT updated (0 rows
    // matched, a DB error, or an unexpected count). Since the resolver only re-selects pending/unknown
    // trades, such a job would be orphaned (never reprocessed). Surface it LOUDLY for repair and do
    // NOT claim 'resolved_*'.
    console.error(JSON.stringify({ event: 'reconciliation_job_orphaned', trade_id: trade.id, trade_status: tradeStatus, job_rows: jobRows }));
    return { trade_id: trade.id, action: 'job_update_failed', trade_status: tradeStatus };
  }
  log('reconciliation_resolved', trade, { resolved_status: tradeStatus, action });
  return { trade_id: trade.id, action, trade_status: tradeStatus };
}

/**
 * Resolve ONE stuck trade. `fetchOrder` only — NEVER `createOrder`. Idempotent + race-safe via the
 * conditional UPDATE guards. Returns what it did.
 */
export async function resolveStuckTrade(
  supabase: SupabaseClient,
  adapter: ExchangeAdapter,
  trade: StuckTrade,
): Promise<ResolveResult> {
  // Entry guard: only act on genuinely-stuck trades (never touch a terminal trade).
  if (trade.status !== 'pending' && trade.status !== 'unknown') {
    return { trade_id: trade.id, action: 'noop_not_stuck', trade_status: trade.status };
  }

  let order: Awaited<ReturnType<ExchangeAdapter['fetchOrder']>>;
  try {
    // READ-ONLY exchange lookup by clientOrderId (always present; exchange_order_id may be null).
    order = await adapter.fetchOrder({ clientOrderId: trade.client_order_id, symbol: trade.trading_pair });
  } catch (e) {
    if (e instanceof ExchangeAuthError) {
      // Credential problem — mark the job failed for triage; do NOT force a terminal trade status.
      // Only claim 'job_failed_auth' if a pending job was ACTUALLY updated (exactly one row). If zero
      // rows matched, the trade is left pending/unknown and will be retried on a later boot — do not
      // falsely claim the job was failed.
      const authJobRows = await updateJob(supabase, trade.id, { status: 'failed', notes: 'auth_error', resolved_at: new Date().toISOString() });
      log('reconciliation_resolve_auth_error', trade, { job_rows: authJobRows });
      return {
        trade_id: trade.id,
        action: authJobRows === 1 ? 'job_failed_auth' : 'left_pending_transient',
        trade_status: trade.status,
      };
    }
    // Transient (timeout/unavailable) or unexpected → leave trade + job pending for the next cycle.
    log('reconciliation_resolve_transient', trade, { error: e instanceof Error ? e.constructor.name : 'unknown' });
    return { trade_id: trade.id, action: 'left_pending_transient', trade_status: trade.status };
  }

  // OrderNotFound → the order never reached the exchange → failed.
  if (order === null) {
    return finalizeTerminal(supabase, trade, 'failed', null, 'order_not_found', 'resolved_failed');
  }

  switch (order.status) {
    case 'filled':
      // M-6: persist the fill (order id / price / executed notional / filled_at) so the reconciled
      // trade is complete — no NULL-price filled rows, P&L computable, order traceable for audit.
      return finalizeTerminal(supabase, trade, 'filled', 'filled', 'filled', 'resolved_filled', {
        exchangeOrderId: order.id,
        price: order.price,
        executedNotional: order.cost,
        filledAt: new Date().toISOString(),
      });
    case 'cancelled':
      // M-6: persist whatever the exchange reported (a cancelled market order may carry a partial fill).
      return finalizeTerminal(supabase, trade, 'cancelled', 'cancelled', 'cancelled', 'resolved_cancelled', {
        exchangeOrderId: order.id,
        price: order.price,
        executedNotional: order.cost,
      });
    case 'failed':
      return finalizeTerminal(supabase, trade, 'failed', null, 'order_failed', 'resolved_failed');
    case 'submitted':
      // Open on the exchange — NOT terminal. Leave the trade `pending`/`unknown` so a LATER boot
      // re-selects and re-checks it (the resolver only re-selects pending/unknown trades); only
      // annotate the still-pending job. Moving the trade to `submitted` here would orphan the
      // pending job — it would never be re-selected. [S4-3a P1 fix]
      await updateJob(supabase, trade.id, { notes: 'order_open' });
      log('reconciliation_resolve_open', trade);
      return { trade_id: trade.id, action: 'left_open', trade_status: trade.status };
    case 'unknown':
    default:
      // The exchange itself reports unknown — leave pending, annotate, retry next cycle.
      await updateJob(supabase, trade.id, { notes: 'exchange_unknown' });
      log('reconciliation_resolve_exchange_unknown', trade);
      return { trade_id: trade.id, action: 'left_pending_unknown', trade_status: trade.status };
  }
}

// ── Boot-time orchestration ───────────────────────────────────────────────────

export interface ResolveDeps {
  isProduction: boolean;
  /** A1 Option B: fixed-IP exchange-egress proxy URL, or null. Threaded to the adapter. */
  exchangeHttpsProxy?: string | null;
  /** A1 Option A (B0): true iff EXCHANGE_EGRESS_MODE=native — production may egress directly via static IPs. */
  nativeEgressAllowed?: boolean;
  cap?: number;
  thresholdSeconds?: number;
  /** Build an adapter for a trade; null → skip (leave the job pending). Injectable for tests. */
  adapterFor?: (trade: StuckTrade) => Promise<ExchangeAdapter | null>;
}

/**
 * Default adapter builder: resolve the trade's credential (F-01 chain) → BinanceAdapter, or null (fail-closed).
 * Exported for W1 ownership tests. A `null` return means the resolver leaves the trade pending (no exchange call).
 */
export async function defaultAdapterFor(
  supabase: SupabaseClient,
  trade: StuckTrade,
  isProduction: boolean,
  exchangeHttpsProxy: string | null = null,
  nativeEgressAllowed: boolean = false,
): Promise<ExchangeAdapter | null> {
  // A1 (B0): in production, egress must be configured — a proxy OR native static egress. Neither ⇒ fail-closed
  // (return null: no adapter, no exchange call, trade left pending). Mirrors the other null-adapter paths.
  if (isProduction && !exchangeHttpsProxy && !nativeEgressAllowed) return null;

  const { data: bot, error: botErr } = await supabase
    .from('bots')
    .select('credential_id, user_id')
    .eq('id', trade.bot_id)
    .single();
  if (botErr || !bot || typeof bot.credential_id !== 'string') return null;

  const { data: cred, error: credErr } = await supabase
    .from('user_exchange_credentials')
    .select('vault_secret_id, status, deleted_at, user_id, exchange_id')
    .eq('id', bot.credential_id)
    .single();
  if (credErr || !cred) return null;
  if (cred.status !== 'valid' || cred.deleted_at !== null) return null;
  // A8-H3 W1: fail closed on ownership mismatch — return null (leave the trade pending; NO exchange call,
  // NO decrypt, NO adapter, NO Vault delete; no other bot touched). Mirrors the existing null-adapter path.
  // Observable (no DB mutation — reconciliation has no per-trade audit-status model): a NO-SECRET log with
  // only ids (never vault_secret_id, keys, or the owner uuids' values) so the mismatch is not silent.
  if (!credentialOwnershipOk(cred.user_id, bot.user_id)) {
    console.error(JSON.stringify({
      event:    'reconciliation_credential_owner_mismatch',
      trade_id: trade.id,
      bot_id:   trade.bot_id,
    }));
    return null;
  }
  if (typeof cred.vault_secret_id !== 'string' || !UUID_RE.test(cred.vault_secret_id)) return null;

  // EP1b: resolve + double-gate the venue with the SAME two gates as the live order path
  // (exchanges.is_active AND SUPPORTED_EXCHANGES), so both adapter factories agree on which venues
  // are permitted. A stuck trade can only exist for a venue that was active+supported when placed;
  // if that ever ceases to hold — venue deactivated, or not (yet) in the worker allowlist — fail
  // closed to null (leave the trade pending, no exchange call) rather than reconcile a trade against
  // the WRONG exchange. Mirrors the other null-adapter fail-closed paths above.
  const { data: ex, error: exErr } = await supabase
    .from('exchanges')
    .select('ccxt_id, is_active')
    .eq('id', cred.exchange_id)
    .single();
  if (exErr || !ex || ex.is_active !== true || !SUPPORTED_EXCHANGES.has(ex.ccxt_id)) return null;

  return new BinanceAdapter(new VaultSecretsProvider(supabase), cred.vault_secret_id, isProduction, exchangeHttpsProxy, nativeEgressAllowed, ex.ccxt_id);
}

/**
 * Boot-time reconciliation resolution: find stuck `pending`/`unknown` trades and resolve up to `cap`
 * of them via `resolveStuckTrade`. Read-only on the exchange; never places orders. Logs the
 * remainder (no silent truncation). Each trade is isolated — one failure never aborts the batch.
 */
export async function resolvePendingReconciliations(
  supabase: SupabaseClient,
  deps: ResolveDeps,
): Promise<ResolveResult[]> {
  const cap = deps.cap ?? RECONCILIATION_RESOLVE_CAP;
  const thresholdSeconds = deps.thresholdSeconds ?? RECONCILIATION_RESOLVE_THRESHOLD_SECONDS;
  const adapterFor = deps.adapterFor ?? ((t: StuckTrade) => defaultAdapterFor(supabase, t, deps.isProduction, deps.exchangeHttpsProxy ?? null, deps.nativeEgressAllowed ?? false));

  const threshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from('trades')
    .select('id, bot_id, signal_id, status, client_order_id, trading_pair, exchange_order_id')
    .in('status', ['pending', 'unknown'])
    .lt('created_at', threshold)
    .is('deleted_at', null);
  if (error) {
    console.error(JSON.stringify({ event: 'reconciliation_resolve_query_error', error: error.code }));
    return [];
  }

  const all = (Array.isArray(data) ? data : []) as StuckTrade[];
  const batch = all.slice(0, cap);
  console.log(
    JSON.stringify({
      event: 'reconciliation_resolve_start',
      eligible: all.length,
      processing: batch.length,
      deferred: all.length - batch.length,
    }),
  );

  const results: ResolveResult[] = [];
  for (const trade of batch) {
    let adapter: ExchangeAdapter | null = null;
    try {
      adapter = await adapterFor(trade);
    } catch {
      adapter = null;
    }
    if (!adapter) {
      console.log(JSON.stringify({ event: 'reconciliation_resolve_skip_no_adapter', trade_id: trade.id }));
      results.push({ trade_id: trade.id, action: 'left_pending_transient', trade_status: trade.status });
      continue;
    }
    try {
      results.push(await resolveStuckTrade(supabase, adapter, trade));
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'reconciliation_resolve_unexpected',
          trade_id: trade.id,
          error: e instanceof Error ? e.constructor.name : 'unknown',
        }),
      );
      results.push({ trade_id: trade.id, action: 'left_pending_transient', trade_status: trade.status });
    }
  }

  const resolved = results.filter((r) => r.action.startsWith('resolved')).length;
  console.log(JSON.stringify({ event: 'reconciliation_resolve_complete', total: results.length, resolved }));
  return results;
}
