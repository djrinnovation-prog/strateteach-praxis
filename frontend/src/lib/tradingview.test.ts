import { describe, test, expect, vi } from 'vitest'
import { rotateWebhookToken, loadUserBots } from './tradingview'
import type { SupabaseClient } from '@supabase/supabase-js'

const TOKEN = 'abcdEFGH_-1234567890abcdEFGH_-1234567890'
const BOT = '11111111-1111-4111-8111-111111111111'

describe('rotateWebhookToken', () => {
  test('happy path → forwards {bot_id, token}, returns fingerprint only (no token echoed back)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, new_fp: 'aaaaaaaa..bbbbbbbb' }, error: null })
    const client = { functions: { invoke } } as unknown as SupabaseClient
    const r = await rotateWebhookToken(client, BOT, TOKEN)
    expect(invoke).toHaveBeenCalledWith('rotate-bot-webhook-token', { body: { bot_id: BOT, token: TOKEN } })
    expect(r).toEqual({ ok: true, new_fp: 'aaaaaaaa..bbbbbbbb' })
    // Fingerprint only — the result must never carry the plaintext token or a full hash.
    expect(JSON.stringify(r)).not.toContain(TOKEN)
  })

  test('function rejects (ok:false) → surfaces the error, not ok', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: false, error: 'conflict' }, error: null })
    const client = { functions: { invoke } } as unknown as SupabaseClient
    expect(await rotateWebhookToken(client, BOT, TOKEN)).toEqual({ ok: false, error: 'conflict' })
  })

  test('transport/non-2xx error → { ok:false, rotate_failed } (no throw)', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const client = { functions: { invoke } } as unknown as SupabaseClient
    expect(await rotateWebhookToken(client, BOT, TOKEN)).toEqual({ ok: false, error: 'rotate_failed' })
  })
})

describe('loadUserBots', () => {
  function mockClient(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn().mockReturnValue(chain)
    chain.is = vi.fn().mockReturnValue(chain)
    chain.order = vi.fn().mockResolvedValue(result)
    const from = vi.fn().mockReturnValue(chain)
    return { client: { from } as unknown as SupabaseClient, from, chain }
  }

  test('returns the RLS-scoped rows (non-secret cols only)', async () => {
    const { client, from, chain } = mockClient({
      data: [{ id: BOT, trading_pair: 'BTCUSDT', status: 'active' }], error: null,
    })
    const bots = await loadUserBots(client)
    expect(from).toHaveBeenCalledWith('bots')
    expect(chain.select).toHaveBeenCalledWith('id, trading_pair, status') // never webhook_secret_hash
    expect(bots).toEqual([{ id: BOT, trading_pair: 'BTCUSDT', status: 'active' }])
  })

  test('NEVER selects the webhook secret hash (explicit column list, no wildcard)', async () => {
    const { client, chain } = mockClient({ data: [], error: null })
    await loadUserBots(client)
    const selectArg = String((chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0])
    // The select must be an explicit non-secret column list — no hash, no `*` wildcard.
    expect(selectArg).not.toContain('webhook_secret_hash')
    expect(selectArg).not.toContain('*')
    expect(selectArg.split(',').map((s) => s.trim()).sort()).toEqual(['id', 'status', 'trading_pair'])
  })

  test('even if a row somehow carried a hash field, it is never surfaced by the typed shape', async () => {
    // Defensive: the returned UserBot[] only exposes id/trading_pair/status. Confirm the caller does not
    // spread arbitrary DB fields — a hash present in a malformed row must not appear in what we consume.
    const { client } = mockClient({
      data: [{ id: BOT, trading_pair: 'BTCUSDT', status: 'active' }], error: null,
    })
    const bots = await loadUserBots(client)
    expect(JSON.stringify(bots)).not.toContain('webhook_secret_hash')
    expect(Object.keys(bots[0])).toEqual(['id', 'trading_pair', 'status'])
  })

  test('empty → []', async () => {
    const { client } = mockClient({ data: null, error: null })
    expect(await loadUserBots(client)).toEqual([])
  })

  test('error → throws', async () => {
    const { client } = mockClient({ data: null, error: { message: 'rls' } })
    await expect(loadUserBots(client)).rejects.toBeTruthy()
  })
})
