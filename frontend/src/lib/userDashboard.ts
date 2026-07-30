// userDashboard.ts — StrateTeach ST-2 user dashboard types + loaders (mostly read-only).
// No React, no client creation, no env read (safe to import in tests). Mirrors user_bot_dashboard() /
// user_pause_own_bot() (migration 033) — NON-SECRET fields only. NEVER carries vault_secret_id /
// webhook_secret_hash / keys / tokens.
import type { SupabaseClient } from '@supabase/supabase-js'

export { friendlyBlockReason } from './pilot'

export interface RecentTrade {
  side: string
  status: string
  requested_notional_usdt: number | null
  executed_notional_usdt: number | null
  created_at: string
  filled_at: string | null
}

export interface UserDashboardBot {
  id: string
  name: string
  trading_pair: string
  bot_status: string
  trading_enabled: boolean
  sizing_mode: string | null
  fixed_notional_usdt: number | null
  max_order_notional_usdt: number | null
  daily_notional_cap_usdt: number | null
  sell_enabled: boolean
  exchange_environment: string | null
  credential_status: string | null
  open_qty: number
  cost_basis_usdt: number
  last_block_reason: string | null
  recent_trades: RecentTrade[]
}

export interface PauseResult { ok: boolean; bot_id: string; status: string; trading_enabled: boolean }

/** Read-only: the caller's own bots (RLS/auth.uid()-scoped in the RPC). Throws PostgrestError (42501) on denial. */
export async function loadUserDashboard(client: SupabaseClient): Promise<UserDashboardBot[]> {
  const { data, error } = await client.rpc('user_bot_dashboard')
  if (error) throw error
  return (data ?? []) as UserDashboardBot[]
}

/** The ONLY user mutation: pause + disable the caller's OWN bot. Never enables/activates. */
export async function pauseOwnBot(client: SupabaseClient, botId: string): Promise<PauseResult> {
  const { data, error } = await client.rpc('user_pause_own_bot', { p_bot_id: botId })
  if (error) throw error
  return data as PauseResult
}
