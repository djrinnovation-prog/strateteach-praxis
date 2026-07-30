/**
 * VaultSecretsProvider.ts
 *
 * Implements SecretsProvider using Supabase Vault via get_decrypted_secret() RPC.
 * Requires migration 004 (supabase/migrations/004_vault_accessor_function.sql).
 *
 * Security rules (Decision Log 2026-05-31):
 * - NEVER include vaultSecretId in thrown Error.message — static strings only
 * - NEVER log inside this provider — caller logs with structured metadata
 * - rawSecret zeroed in finally after every parse attempt
 * - Malformed Vault payload → VaultUnavailableError (never expose raw value)
 * - Errors are typed: VaultSecretNotFoundError | VaultUnavailableError only
 *
 * Dependency injection: SupabaseClient passed via constructor (never created here).
 * Reason: SupabaseClient holds SUPABASE_SERVICE_ROLE_KEY — most privileged key
 * in the system. Must be owned by caller (Worker index.ts), not by this class.
 * Enables MockSecretsProvider substitution in tests without touching Vault.
 *
 * Vault JSON contract (Decision Log 2026-05-31):
 *   Stored : { "api_key": string, "api_secret": string }  ← snake_case
 *   Returns: { apiKey: string, apiSecret: string }        ← camelCase (ccxt)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  ExchangeCredentials,
  SecretsProvider,
  VaultSecretNotFoundError,
  VaultUnavailableError,
} from './types'

/** Raw shape stored in Vault. Internal to this module — not exported. */
interface VaultSecretPayload {
  api_key: string
  api_secret: string
}

/**
 * Runtime validation of Vault JSON payload.
 * Guards against: wrong type, missing fields, empty strings, null values.
 */
function isVaultSecretPayload(value: unknown): value is VaultSecretPayload {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.api_key === 'string' && v.api_key.length > 0 &&
    typeof v.api_secret === 'string' && v.api_secret.length > 0
  )
}

export class VaultSecretsProvider implements SecretsProvider {
  constructor(private readonly supabase: SupabaseClient) {}

  // vaultSecretId = user_exchange_credentials.vault_secret_id — the worker
  // resolves it from credential_id BEFORE calling (Step 4a, F-01). Passing the
  // credentials row id here can never resolve in vault.secrets.
  async getExchangeCredentials(vaultSecretId: string): Promise<ExchangeCredentials> {
    // ─── Step 1: Vault RPC call ───────────────────────────────────────────────
    let rawSecret: string | null = null

    try {
      const { data, error } = await this.supabase
        .rpc('get_decrypted_secret', { secret_id: vaultSecretId })

      // Carry the PostgREST/Postgres code as structured metadata (F-14):
      // PGRST202 (missing RPC) / 42501 (no grant) are permanent config faults —
      // the conservative transient classification stays, but logs can tell.
      if (error) throw new VaultUnavailableError(typeof error.code === 'string' ? error.code : undefined)

      rawSecret = data as string | null
    } catch (e) {
      // Re-throw typed errors as-is; wrap unexpected errors
      if (e instanceof VaultUnavailableError || e instanceof VaultSecretNotFoundError) {
        throw e
      }
      throw new VaultUnavailableError()
    }

    // null = secret_id exists in system but Vault has no matching row
    if (rawSecret === null) {
      throw new VaultSecretNotFoundError()
    }

    // ─── Step 2: Parse JSON ───────────────────────────────────────────────────
    let parsed: unknown
    try {
      parsed = JSON.parse(rawSecret)
    } catch {
      // Malformed JSON in Vault — do not expose rawSecret in any error or log
      throw new VaultUnavailableError()
    } finally {
      rawSecret = null // zero in all cases — success or failure
    }

    // ─── Step 3: Validate contract ────────────────────────────────────────────
    if (!isVaultSecretPayload(parsed)) {
      // Vault payload has wrong shape or empty credentials
      // Treat as unavailable — do not leak payload contents
      throw new VaultUnavailableError()
    }

    // ─── Step 4: Return mapped credentials ───────────────────────────────────
    // Caller is responsible for zeroing:
    //   credentials = null
    //   exchange.apiKey = ''; exchange.apiSecret = ''
    // after use (see Decision Log 2026-05-31: Memory Lifecycle)
    return {
      apiKey: parsed.api_key,
      apiSecret: parsed.api_secret,
    }
  }
}
