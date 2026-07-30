// flatten.ts — EP5: emergency close-all executor (operator-only, kill-INDEPENDENT, adapter-only).
//
// DORMANT: nothing auto-invokes this. An operator triggers a flatten for a specific bot; the trigger
// itself (an owner-gated RPC / CLI that enqueues or directly calls flattenBot) is a thin follow-on,
// as is multi-worker DB-level single-flight. Given a bot, flatten reads the live position from the
// EXCHANGE (the source of truth) and places REDUCE-ONLY closing orders through the adapter, auditing
// every action.
//
// KILL-INDEPENDENT BY DESIGN: flatten deliberately does NOT check bots.trading_enabled. The kill
// switch (operator_kill_all) sets trading_enabled=false to STOP NEW entries; flatten is what then
// CLOSES what is already open, so it must keep working after a kill. This is the ONLY path allowed to
// act on a kill-disabled bot, and only because it is operator-invoked, reduce-only, and audited.
//
// SPOT: the "position" is the free BASE balance of the pair → a market SELL of 100% of it (selling
// base IS reducing exposure; spot has no reduceOnly flag). FUTURES: fetchPositions → a reduce-only
// market order opposite each open position (uses the EP4 primitives; dormant while futures is unarmed).
//
// Every exchange call goes through the SAME gated adapter as the live path (egress / sandbox / secret
// zeroing / venue is_active + SUPPORTED_EXCHANGES), never raw ccxt.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExchangeAdapter, MarketRules } from './types'
import { VaultSecretNotFoundError, ExchangeAuthError } from './types'
import { VaultSecretsProvider } from './VaultSecretsProvider'
import { BinanceAdapter } from './BinanceAdapter'
import { credentialOwnershipOk } from './credentialOwnership'
import { SUPPORTED_EXCHANGES } from './supportedExchanges'
import { resolveEgress } from './egress'
import { nanoid } from 'nanoid'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Round a quantity DOWN to the exchange step and fix to qtyPrecision (mirrors sizingRisk). */
function roundDownToStep(value: number, step: number, qtyPrecision: number): number {
  if (!(isFinite(value) && isFinite(step) && step > 0)) return NaN
  return parseFloat((Math.floor(value / step) * step).toFixed(qtyPrecision))
}

export interface ClosedOrder {
  symbol:   string
  side:     'buy' | 'sell'
  quantity: number
  orderId:  string | null
}

export type FlattenOutcome =
  | 'flattened'          // at least one closing order placed
  | 'nothing_to_close'   // no position / below min size — benign no-op
  | 'skipped_locked'     // a flatten for this bot is already in flight (single-flight)
  | 'skipped_no_adapter' // bot/credential/venue resolution fail-closed (nothing touched)
  | 'error'              // an exchange/infra error mid-flatten (partial close possible — see closedOrders)

export interface FlattenResult {
  botId:        string
  outcome:      FlattenOutcome
  closedOrders: ClosedOrder[]
  reason:       string
}

export interface FlattenDeps {
  isProduction?: boolean
  /** Test seam: supply the adapter (+ bot context) instead of resolving from the DB. */
  adapterFor?: (botId: string) => Promise<{ adapter: ExchangeAdapter; tradingPair: string; accountType: string } | null>
}

// In-process single-flight: never run two flattens for the SAME bot concurrently in this worker.
// (Multi-worker DB-level single-flight — a claim row — is a documented follow-on with the trigger.)
const inFlight = new Set<string>()

/** Resolve bot → credential → venue-gated authenticated adapter, fail-closed (null). Mirrors the
 *  reconciliation resolver, but keyed by bot_id and WITHOUT any trading_enabled check (kill-independent),
 *  and additionally returns the trading pair + account type the flatten needs. */
async function resolveAdapterForBot(
  supabase: SupabaseClient,
  botId: string,
  isProduction: boolean,
  exchangeHttpsProxy: string | null,
  nativeEgressAllowed: boolean,
): Promise<{ adapter: ExchangeAdapter; tradingPair: string; accountType: string } | null> {
  if (isProduction && !exchangeHttpsProxy && !nativeEgressAllowed) return null; // egress fail-closed (A1)

  const { data: bot, error: botErr } = await supabase
    .from('bots')
    .select('credential_id, user_id, trading_pair, account_type, deleted_at')
    .eq('id', botId)
    .single();
  if (botErr || !bot || bot.deleted_at !== null) return null;
  if (typeof bot.credential_id !== 'string' || typeof bot.trading_pair !== 'string') return null;

  const { data: cred, error: credErr } = await supabase
    .from('user_exchange_credentials')
    .select('vault_secret_id, status, deleted_at, user_id, exchange_id')
    .eq('id', bot.credential_id)
    .single();
  if (credErr || !cred) return null;
  if (cred.status !== 'valid' || cred.deleted_at !== null) return null;
  if (!credentialOwnershipOk(cred.user_id, bot.user_id)) return null;         // A8-H3 W1 ownership
  if (typeof cred.vault_secret_id !== 'string' || !UUID_RE.test(cred.vault_secret_id)) return null;

  // Same two-layer venue gate as the live path (EP1b): DB is_active AND worker allowlist.
  const { data: ex, error: exErr } = await supabase
    .from('exchanges')
    .select('ccxt_id, is_active')
    .eq('id', cred.exchange_id)
    .single();
  if (exErr || !ex || ex.is_active !== true || !SUPPORTED_EXCHANGES.has(ex.ccxt_id)) return null;

  const adapter = new BinanceAdapter(
    new VaultSecretsProvider(supabase), cred.vault_secret_id, isProduction, exchangeHttpsProxy, nativeEgressAllowed, ex.ccxt_id,
  );
  return { adapter, tradingPair: bot.trading_pair, accountType: (bot.account_type as string) ?? 'spot' };
}

/** Write a bot-scoped flatten audit row (never throws — audit failure must not abort a close). */
async function auditFlatten(
  supabase: SupabaseClient, botId: string, event: string, detail: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({
      entity_type: 'bot', entity_id: botId, event_type: event, before_state: {}, after_state: detail,
    });
  } catch {
    // best-effort — the close itself is the state-of-record; a dropped audit must not stop flatten.
  }
}

/**
 * Flatten (close-all) for one bot. Operator-only (caller supplies a non-empty reason), kill-independent,
 * reduce-only, adapter-only, single-flight, audited. Returns a structured result; never throws.
 */
export async function flattenBot(
  supabase: SupabaseClient,
  botId: string,
  reason: string,
  deps: FlattenDeps = {},
): Promise<FlattenResult> {
  const result: FlattenResult = { botId, outcome: 'nothing_to_close', closedOrders: [], reason };

  // Operator context is mandatory — a flatten with no reason is not an operator action.
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    result.outcome = 'error';
    return result;
  }

  // Single-flight (in-process): a second concurrent flatten for the same bot is a no-op.
  if (inFlight.has(botId)) { result.outcome = 'skipped_locked'; return result; }
  inFlight.add(botId);

  try {
    const isProduction = deps.isProduction ?? (process.env.PRAXIS_IS_PRODUCTION === 'true');
    const egress = resolveEgress(process.env);

    const resolved = deps.adapterFor
      ? await deps.adapterFor(botId)
      : await resolveAdapterForBot(supabase, botId, isProduction, egress.proxy, egress.nativeAllowed);

    if (!resolved) {
      await auditFlatten(supabase, botId, 'bot.flatten_skipped', { reason, cause: 'no_adapter' });
      result.outcome = 'skipped_no_adapter';
      return result;
    }
    const { adapter, tradingPair, accountType } = resolved;

    let rules: MarketRules;
    try {
      rules = await adapter.getMarketRules(tradingPair);
    } catch {
      await auditFlatten(supabase, botId, 'bot.flatten_error', { reason, stage: 'market_rules' });
      result.outcome = 'error';
      return result;
    }

    try {
      if (accountType === 'futures') {
        // FUTURES: close each open position with a reduce-only market order opposite the position.
        // Uses the EP4 primitives; dormant while futures is unarmed (no futures bot can exist yet).
        const positions = adapter.fetchPositions ? await adapter.fetchPositions([tradingPair]) : [];
        for (const pos of positions) {
          if (!(pos.contracts > 0)) continue;
          const side = pos.side === 'long' ? 'sell' : 'buy';         // opposite → reduces
          const order = await adapter.createOrder({
            symbol: pos.symbol, side, type: 'market', quantity: pos.contracts,
            clientOrderId: `PRX_${nanoid(10)}`, reduceOnly: true,
          });
          result.closedOrders.push({ symbol: pos.symbol, side, quantity: pos.contracts, orderId: order.id ?? null });
        }
      } else {
        // SPOT: sell 100% of the free BASE balance of the pair (rounded down to step). No position
        // (or below min size) ⇒ benign no-op. Selling base reduces exposure — spot has no reduceOnly.
        const baseAsset = rules.symbol.split('/')[0];
        const balance = await adapter.fetchBalance();
        const freeBase = balance[baseAsset]?.free ?? 0;
        const qty = roundDownToStep(freeBase, rules.stepSize, rules.qtyPrecision);
        if (isFinite(qty) && qty >= rules.minQty && qty > 0) {
          const order = await adapter.createOrder({
            symbol: rules.symbol, side: 'sell', type: 'market', quantity: qty,
            clientOrderId: `PRX_${nanoid(10)}`,
          });
          result.closedOrders.push({ symbol: rules.symbol, side: 'sell', quantity: qty, orderId: order.id ?? null });
        }
      }
    } catch (e) {
      // A credential-permanent error vs a transient one both leave flatten incomplete — record loudly.
      const cause = e instanceof VaultSecretNotFoundError || e instanceof ExchangeAuthError ? 'credential_invalid' : 'exchange_error';
      await auditFlatten(supabase, botId, 'bot.flatten_error', { reason, stage: 'close', cause, closed: result.closedOrders.length });
      result.outcome = 'error';
      return result;
    }

    result.outcome = result.closedOrders.length > 0 ? 'flattened' : 'nothing_to_close';
    await auditFlatten(supabase, botId, 'bot.flattened', {
      reason, account_type: accountType, closed_count: result.closedOrders.length,
      closed: result.closedOrders,
    });
    return result;
  } finally {
    inFlight.delete(botId);
  }
}
