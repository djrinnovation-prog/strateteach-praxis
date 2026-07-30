// pilot.ts — StrateTeach ST-1 operator cockpit fleet types + loader (read-only).
// No React, no client creation, no env read (safe to import in tests). Mirrors the operator_pilot_fleet()
// RPC payload (migration 032) — NON-SECRET fields only. NEVER carries vault_secret_id / webhook_secret_hash /
// keys / tokens; credential is represented ONLY by a non-secret row-id fingerprint.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PilotBot {
  id: string
  user_id: string
  trading_pair: string
  bot_status: string
  trading_enabled: boolean
  exchange_environment: string | null
  /** NON-SECRET credential ROW-id fingerprint (left-8 of credential_id) — never vault_secret_id. */
  credential_fingerprint: string | null
  fixed_notional_usdt: number | null
  max_order_notional_usdt: number | null
  daily_notional_cap_usdt: number | null
  sell_enabled: boolean
  last_trade_at: string | null
  last_trade_status: string | null
  last_block_reason: string | null
}

/** Call the read-only operator_pilot_fleet() RPC; throws the PostgrestError (42501) on denial. */
export async function loadPilotFleet(client: SupabaseClient): Promise<PilotBot[]> {
  const { data, error } = await client.rpc('operator_pilot_fleet')
  if (error) throw error
  return (data ?? []) as PilotBot[]
}

/** Map a raw fail-closed block reason to a short operator-friendly label (unknown reasons pass through). */
export function friendlyBlockReason(reason: string | null): string | null {
  if (!reason) return null
  const map: Record<string, string> = {
    insufficient_quote_balance: 'insufficient balance',
    sell_disabled_v1: 'sell disabled (v1)',
    exchange_egress_unconfigured: 'egress unconfigured',
    below_min_notional: 'below min notional',
    daily_notional_cap: 'daily cap reached',
  }
  return map[reason] ?? reason
}
