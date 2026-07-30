import { describe, test, expect, vi } from 'vitest'
import { loadUserDashboard, pauseOwnBot, type UserDashboardBot } from './userDashboard'
import type { SupabaseClient } from '@supabase/supabase-js'

function mockClient(rpcImpl: () => Promise<{ data: unknown; error: unknown }>): SupabaseClient {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient
}

const BOT: UserDashboardBot = {
  id: 'b1', name: 'My BTC', trading_pair: 'BTCUSDT', bot_status: 'paused', trading_enabled: false,
  sizing_mode: 'fixed_notional', fixed_notional_usdt: 12, max_order_notional_usdt: 13, daily_notional_cap_usdt: 13,
  sell_enabled: false, exchange_environment: 'mainnet', credential_status: 'valid',
  open_qty: 0, cost_basis_usdt: 0, last_block_reason: 'insufficient_quote_balance', recent_trades: [],
}

describe('loadUserDashboard', () => {
  test('returns rows', async () => {
    const client = mockClient(() => Promise.resolve({ data: [BOT], error: null }))
    expect(await loadUserDashboard(client)).toEqual([BOT])
  })
  test('null → []', async () => {
    const client = mockClient(() => Promise.resolve({ data: null, error: null }))
    expect(await loadUserDashboard(client)).toEqual([])
  })
  test('throws on error', async () => {
    const client = mockClient(() => Promise.resolve({ data: null, error: { code: '42501' } }))
    await expect(loadUserDashboard(client)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('pauseOwnBot', () => {
  test('calls user_pause_own_bot with p_bot_id and returns result', async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: { ok: true, bot_id: 'b1', status: 'paused', trading_enabled: false }, error: null }))
    const client = { rpc } as unknown as SupabaseClient
    const res = await pauseOwnBot(client, 'b1')
    expect(rpc).toHaveBeenCalledWith('user_pause_own_bot', { p_bot_id: 'b1' })
    expect(res.ok).toBe(true)
  })
  test('throws on error', async () => {
    const client = mockClient(() => Promise.resolve({ data: null, error: { code: '42501' } }))
    await expect(pauseOwnBot(client, 'x')).rejects.toMatchObject({ code: '42501' })
  })
})
