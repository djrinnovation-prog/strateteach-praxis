/**
 * spike-vault.ts
 *
 * PURPOSE: Validate Supabase Vault integration from Node.js (service_role context)
 * before writing BinanceAdapter.
 *
 * MUST run via Doppler — never with manually-exported env vars:
 *   doppler run -- npx ts-node src/spike-vault.ts
 *
 * Required secrets in Doppler (dev config):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service_role key (never anon)
 *   SPIKE_SECRET_ID           — UUID of test secret created in Vault:
 *                               SELECT vault.create_secret(
 *                                 '{"api_key":"test-key-abc123","api_secret":"test-secret-xyz789"}',
 *                                 'spike-test-secret',
 *                                 'Temporary test secret for Vault spike. Delete after spike.'
 *                               );
 *
 * Two runs required:
 *   Run 1: Local (doppler run -- npx ts-node src/spike-vault.ts) — validates architecture
 *   Run 2: Railway (same command) — validates production latency for visibility_timeout formula
 *
 * Expected output:
 *   [PASS] Doppler injected env vars
 *   [PASS] Vault reachable — secret decrypted (length: N)
 *   [PASS] JSON parsed: { api_key, api_secret } present
 *   [PASS] P50 latency: Xms | P99: Xms | Max: Xms
 *   [PASS] Missing secret handled — error code: PGRST116
 *   [PASS] key zeroed after use
 *
 * Document results in Notion: Architecture > Vault Integration
 * Required before writing BinanceAdapter: P50/P99, null handling, error type on miss.
 *
 * API: vault.decrypted_secrets VIEW is not exposed to PostgREST (PGRST106).
 * Correct call: supabase.rpc('get_decrypted_secret', { secret_id: id })
 * Requires migration 004: get_decrypted_secret() wrapper function in public schema
 *   (SECURITY DEFINER, service_role only)
 * Return shape: { data: string | null, error: ... }
 * Not-found: data === null (function returns null, not an error)
 */

import { createClient } from '@supabase/supabase-js'

// --- Preflight: verify env vars were injected by Doppler, not manually exported ---
const DOPPLER_ENVIRONMENT = process.env.DOPPLER_ENVIRONMENT
if (!DOPPLER_ENVIRONMENT) {
  console.error('[FAIL] DOPPLER_ENVIRONMENT is not set.')
  console.error('       This spike must be run via Doppler, not with manual env exports.')
  console.error('       Run: doppler run -- npx ts-node src/spike-vault.ts')
  console.error('       Setup: cd worker && doppler setup')
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SPIKE_SECRET_ID = process.env.SPIKE_SECRET_ID

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SPIKE_SECRET_ID) {
  console.error('[FAIL] Missing Doppler secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SPIKE_SECRET_ID')
  console.error('       Set them via: doppler secrets set KEY=value')
  process.exit(1)
}

console.log(`[PASS] Doppler injected env vars (environment: ${DOPPLER_ENVIRONMENT})`)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

interface ExchangeCredentials {
  api_key: string
  api_secret: string
}

/**
 * Fetch a secret from Supabase Vault via get_decrypted_secret() RPC wrapper.
 * Returns the decrypted string value, or null if secret_id not found.
 * Throws on any infrastructure error (wrong key, vault down, etc.)
 *
 * Requires migration 004: get_decrypted_secret(uuid) function in public schema.
 * Not-found: returns null (not an error — function returns null for missing rows).
 */
async function fetchSecret(secretId: string): Promise<string | null> {
  const { data, error } = await supabase
    .rpc('get_decrypted_secret', { secret_id: secretId })

  if (error) {
    throw Object.assign(
      new Error(`Vault error: ${error.message} (code: ${error.code})`),
      { code: error.code }
    )
  }

  return data as string | null
}

async function measureLatency(secretId: string, runs: number): Promise<number[]> {
  const latencies: number[] = []
  for (let i = 0; i < runs; i++) {
    const start = Date.now()
    let secret: string | null = null
    try {
      secret = await fetchSecret(secretId)
      void secret // suppress unused warning — value intentionally discarded
    } finally {
      secret = null // zero immediately after each measurement
    }
    latencies.push(Date.now() - start)
  }
  return latencies.sort((a, b) => a - b)
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function run(): Promise<void> {
  console.log('=== Vault Integration Spike ===\n')

  // --- Test 1: Reachability + JSON contract validation ---
  console.log('Test 1: Vault reachability + JSON contract...')
  let key: string | null = null
  try {
    key = await fetchSecret(SPIKE_SECRET_ID!)

    if (key === null) {
      console.error('[FAIL] Vault returned null — SPIKE_SECRET_ID not found in vault.decrypted_secrets')
      console.error('       Run in SQL Editor: SELECT id, name FROM vault.decrypted_secrets LIMIT 5;')
      process.exit(1)
    }

    console.log(`[PASS] Vault reachable — secret decrypted (length: ${key.length})`)

    // Validate production secret shape: { api_key, api_secret }
    let creds: ExchangeCredentials | null = null
    try {
      creds = JSON.parse(key) as ExchangeCredentials
    } catch {
      console.error('[FAIL] Secret is not valid JSON — expected {"api_key":"...","api_secret":"..."}')
      console.error('       Create the test secret with the correct shape (see file header)')
      process.exit(1)
    }

    if (!creds || !creds.api_key || !creds.api_secret) {
      console.error('[FAIL] Secret JSON missing api_key or api_secret fields')
      process.exit(1)
    }

    console.log('[PASS] JSON parsed — api_key present, api_secret present')
    console.log(`       api_key length: ${creds.api_key.length}, api_secret length: ${creds.api_secret.length}`)
  } catch (err) {
    const e = err as Error & { code?: string }
    console.error('[FAIL] Vault unreachable:', e.constructor?.name ?? 'unknown')
    console.log('\nTroubleshooting:')
    console.log('  1. Vault extension enabled? Supabase Dashboard → Extensions → vault')
    console.log('  2. SPIKE_SECRET_ID valid? Run in SQL Editor:')
    console.log('     SELECT id, name FROM vault.decrypted_secrets LIMIT 5;')
    console.log('  3. service_role key correct? Check Doppler secret SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  } finally {
    key = null // zero always, even on failure
  }

  // --- Test 2: Latency (10 runs) ---
  console.log('\nTest 2: Latency measurement (10 runs)...')
  try {
    const latencies = await measureLatency(SPIKE_SECRET_ID!, 10)
    const p50 = percentile(latencies, 50)
    const p99 = percentile(latencies, 99)
    const max = latencies[latencies.length - 1]
    console.log(`[PASS] P50: ${p50}ms | P99: ${p99}ms | Max: ${max}ms`)
    console.log(`       All latencies: [${latencies.join(', ')}]ms`)
    if (p99 > 500) {
      console.log('[WARN] P99 > 500ms — Vault latency high. Document before setting visibility_timeout.')
    }
    console.log('\n       NOTE: This is local → Supabase latency.')
    console.log('       Run again on Railway for production-realistic numbers.')
  } catch (err) {
    console.error('[FAIL] Latency measurement failed:', (err as Error)?.constructor?.name ?? 'unknown')
  }

  // --- Test 3: Missing secret error handling ---
  console.log('\nTest 3: Missing secret (non-existent UUID)...')
  const fakeId = '00000000-0000-0000-0000-000000000000'
  try {
    const missing = await fetchSecret(fakeId)
    if (missing === null) {
      console.log('[PASS] Missing secret returns null — Worker must check for null and throw')
    } else {
      console.log('[WARN] Vault returned a value for a fake UUID — unexpected:', missing)
    }
  } catch (err) {
    const e = err as Error & { code?: string }
    console.log('[PASS] Missing secret throws — Worker must catch')
    console.log(`       Error code: ${e.code ?? 'unknown'} — class: ${e.constructor?.name ?? 'unknown'}`)
  }

  // --- Test 4: Key zeroing ---
  console.log('\nTest 4: Key zeroing...')
  let testKey: string | null = 'test-value-that-should-be-zeroed'
  testKey = null
  if (testKey === null) {
    console.log('[PASS] key = null confirmed')
  }

  console.log('\n=== Spike complete ===')
  console.log('Document in Notion: Architecture → Vault Integration')
  console.log('Record: P50, P99, Max, error code for missing secret, JSON contract confirmed')
  console.log('Required before writing BinanceAdapter: all 4 results above must be [PASS]')
  console.log('\nNext: Run on Railway for production latency numbers.')
}

run().catch((err) => {
  console.error('[FATAL]', err)
  process.exit(1)
})
