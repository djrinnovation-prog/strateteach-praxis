// tradingview.ts — browser-side helpers for the in-product TradingView token flow (UI-3a wiring).
// SAFETY: anon key + RLS only; NEVER service_role/Vault/exchange keys in the browser. The plaintext
// webhook token is generated in the component, sent ONCE to the owner-gated Edge function, and never
// persisted or logged here — this module only forwards it to the function and returns a fingerprint.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RotateResult {
  ok: boolean
  /** Non-secret fingerprint of the new stored hash (never the token, never the full hash). */
  new_fp?: string
  error?: string
}

/** The signed-in user's own bot (RLS-scoped). Non-secret fields only — never the webhook hash. */
export interface UserBot {
  id: string
  trading_pair: string
  status: string
}

/**
 * OWNER-gated webhook-token rotation via the deployed `rotate-bot-webhook-token` Edge function.
 * The client-generated `token` is sent to the function over TLS with the user's JWT (attached by
 * supabase-js); the server stores ONLY the HMAC hash and returns a fingerprint. This never stores or
 * logs the token. A non-2xx (403/409/503) surfaces as `{ ok: false }` — the caller shows a retry.
 */
export async function rotateWebhookToken(
  client: SupabaseClient,
  botId: string,
  token: string,
): Promise<RotateResult> {
  const { data, error } = await client.functions.invoke('rotate-bot-webhook-token', {
    body: { bot_id: botId, token },
  })
  if (error) return { ok: false, error: 'rotate_failed' }
  const d = data as { ok?: boolean; new_fp?: string; error?: string } | null
  if (!d?.ok) return { ok: false, error: d?.error ?? 'rotate_failed' }
  return { ok: true, new_fp: d.new_fp }
}

/**
 * Load the signed-in user's own bots for the setup selector. RLS scopes `bots` to
 * `user_id = auth.uid()`, so this returns only the caller's bots; soft-deleted rows are excluded.
 * Selects non-secret columns only (never `webhook_secret_hash`).
 */
export async function loadUserBots(client: SupabaseClient): Promise<UserBot[]> {
  const { data, error } = await client
    .from('bots')
    .select('id, trading_pair, status')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as UserBot[]
}
