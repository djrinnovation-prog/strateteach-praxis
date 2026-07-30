// actions.ts — Operator Console MUTATION helpers (A8-H2). Kept SEPARATE from the read-only status.ts.
// The ONLY mutation exposed to the console is the audited one-click kill: operator_kill_all (migration 019).
// No service_role/Vault/exchange keys in the browser — the RPC enforces operator authz server-side
// (auth.uid() + profiles.is_operator) and writes its own mandatory audit row. This helper never re-arms.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Mirrors the operator_kill_all() jsonb response contract (migration 019 §2a). Telemetry fields
 * (queue_length, worker_state, worker_updated_at) are NULL when the RPC's telemetry read-back failed;
 * a null there means "cleanliness unverified" → requires_attention=true (never a clean ok).
 */
export interface KillResult {
  ok: boolean
  kill_applied: boolean
  requires_attention: boolean
  operational_state: 'SAFE' | 'ATTENTION'
  enabled_bots_after: number
  open_trades: number
  queue_length: number | null
  worker_state: string | null
  worker_updated_at: string | null
  audit_id: string
  message: string
}

/** PostgREST raises 22023 (invalid_parameter_value) when p_reason is malformed (>500 / control chars). */
export function isInvalidReasonError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === '22023') return true
  return typeof e.message === 'string' && /invalid reason/i.test(e.message)
}

/**
 * Fire the audited one-click kill. Defaults p_hard_lock=true (disable trading AND pause all bots).
 * Throws the PostgrestError on denial (42501 — non-operator) or bad input (22023 — invalid reason).
 * Returns the raw-read-back KillResult; the caller must render ATTENTION (not a clean OK) whenever
 * requires_attention is true. This helper does NOT re-arm — re-enable is a separate guarded flow.
 */
export async function operatorKillAll(
  client: SupabaseClient,
  opts: { reason?: string; hardLock?: boolean } = {},
): Promise<KillResult> {
  const { data, error } = await client.rpc('operator_kill_all', {
    p_reason: opts.reason && opts.reason.length > 0 ? opts.reason : null,
    p_hard_lock: opts.hardLock ?? true,
  })
  if (error) throw error
  return data as KillResult
}
