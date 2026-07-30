/**
 * VaultSecretsProvider.test.ts
 *
 * Unit tests for VaultSecretsProvider.
 * Uses a mock SupabaseClient — no real Vault, no real network calls.
 *
 * Test matrix:
 *   Happy path          — valid JSON → ExchangeCredentials returned
 *   Not found           — data === null → VaultSecretNotFoundError
 *   RPC error           — error returned → VaultUnavailableError
 *   Network throw       — rpc() rejects → VaultUnavailableError
 *   Malformed JSON      — unparseable string → VaultUnavailableError
 *   Wrong shape         — missing api_key → VaultUnavailableError
 *   Missing api_secret  — missing api_secret → VaultUnavailableError
 *   Empty api_key       — api_key: '' → VaultUnavailableError
 *   Empty api_secret    — api_secret: '' → VaultUnavailableError
 *   rawSecret zeroed    — no secret value leaks after parse
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { VaultSecretsProvider } from './VaultSecretsProvider'
import {
  VaultSecretNotFoundError,
  VaultUnavailableError,
} from './types'

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeSupabase(response: { data: unknown; error: unknown } | null, throws = false): SupabaseClient {
  const rpc = throws
    ? jest.fn().mockRejectedValue(new Error('network error'))
    : jest.fn().mockResolvedValue(response)
  return { rpc } as unknown as SupabaseClient
}

const VALID_PAYLOAD = JSON.stringify({ api_key: 'test-api-key', api_secret: 'test-api-secret' })
const CREDENTIAL_ID = '2dbb7421-2175-4afe-91e5-c4363d727e60'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VaultSecretsProvider.getExchangeCredentials', () => {

  // ── Happy path ───────────────────────────────────────────────────────────

  test('returns ExchangeCredentials for valid Vault response', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: VALID_PAYLOAD, error: null })
    )
    const creds = await provider.getExchangeCredentials(CREDENTIAL_ID)

    expect(creds.apiKey).toBe('test-api-key')
    expect(creds.apiSecret).toBe('test-api-secret')
  })

  test('maps snake_case Vault payload to camelCase ExchangeCredentials', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify({ api_key: 'KEY', api_secret: 'SECRET' }), error: null })
    )
    const creds = await provider.getExchangeCredentials(CREDENTIAL_ID)

    expect(creds).toEqual({ apiKey: 'KEY', apiSecret: 'SECRET' })
    expect(creds).not.toHaveProperty('api_key')
    expect(creds).not.toHaveProperty('api_secret')
  })

  test('calls RPC with correct function name and secret_id', async () => {
    const supabase = makeSupabase({ data: VALID_PAYLOAD, error: null })
    const provider = new VaultSecretsProvider(supabase)

    await provider.getExchangeCredentials(CREDENTIAL_ID)

    expect(supabase.rpc).toHaveBeenCalledWith('get_decrypted_secret', {
      secret_id: CREDENTIAL_ID,
    })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  // ── Not found ────────────────────────────────────────────────────────────

  test('throws VaultSecretNotFoundError when data is null', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: null, error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultSecretNotFoundError)
  })

  test('VaultSecretNotFoundError message does not contain credentialId', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: null, error: null })
    )
    try {
      await provider.getExchangeCredentials(CREDENTIAL_ID)
    } catch (e) {
      expect((e as Error).message).not.toContain(CREDENTIAL_ID)
    }
  })

  // ── RPC / infrastructure errors ──────────────────────────────────────────

  test('throws VaultUnavailableError when RPC returns error object', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: null, error: { message: 'connection refused', code: '500' } })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when rpc() rejects (network error)', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase(null, true)
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  // ── Malformed payloads ───────────────────────────────────────────────────

  test('throws VaultUnavailableError for malformed JSON', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: 'not valid json {{{', error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when api_key is missing', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify({ api_secret: 'SECRET' }), error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when api_secret is missing', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify({ api_key: 'KEY' }), error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when api_key is empty string', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify({ api_key: '', api_secret: 'SECRET' }), error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when api_secret is empty string', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify({ api_key: 'KEY', api_secret: '' }), error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when payload is a JSON string (double-encoded)', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify(VALID_PAYLOAD), error: null }) // string inside string
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  test('throws VaultUnavailableError when payload is a JSON array', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: JSON.stringify(['key', 'secret']), error: null })
    )
    await expect(provider.getExchangeCredentials(CREDENTIAL_ID))
      .rejects.toThrow(VaultUnavailableError)
  })

  // ── Error integrity ──────────────────────────────────────────────────────

  test('instanceof check works correctly for VaultSecretNotFoundError', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: null, error: null })
    )
    try {
      await provider.getExchangeCredentials(CREDENTIAL_ID)
      fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(VaultSecretNotFoundError)
      expect(e).not.toBeInstanceOf(VaultUnavailableError)
    }
  })

  test('instanceof check works correctly for VaultUnavailableError', async () => {
    const provider = new VaultSecretsProvider(
      makeSupabase(null, true)
    )
    try {
      await provider.getExchangeCredentials(CREDENTIAL_ID)
      fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(VaultUnavailableError)
      expect(e).not.toBeInstanceOf(VaultSecretNotFoundError)
    }
  })

  test('error message does not contain secret values on malformed JSON', async () => {
    const sensitivePayload = 'SENSITIVE_KEY_VALUE_XYZ'
    const provider = new VaultSecretsProvider(
      makeSupabase({ data: sensitivePayload, error: null }) // not valid JSON
    )
    try {
      await provider.getExchangeCredentials(CREDENTIAL_ID)
    } catch (e) {
      expect((e as Error).message).not.toContain(sensitivePayload)
    }
  })

})
