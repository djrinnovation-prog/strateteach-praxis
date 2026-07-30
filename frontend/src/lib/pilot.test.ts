import { describe, test, expect, vi } from 'vitest'
import { loadPilotFleet, friendlyBlockReason, type PilotBot } from './pilot'
import type { SupabaseClient } from '@supabase/supabase-js'

function mockClient(rpcImpl: () => Promise<{ data: unknown; error: unknown }>): SupabaseClient {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient
}

const ROW: PilotBot = {
  id: 'b1', user_id: 'u1', trading_pair: 'BTCUSDT', bot_status: 'paused', trading_enabled: false,
  exchange_environment: 'mainnet', credential_fingerprint: '1164c49b',
  fixed_notional_usdt: 12, max_order_notional_usdt: 13, daily_notional_cap_usdt: 13,
  sell_enabled: false, last_trade_at: null, last_trade_status: 'filled',
  last_block_reason: 'insufficient_quote_balance',
}

describe('loadPilotFleet', () => {
  test('returns the RPC rows', async () => {
    const client = mockClient(() => Promise.resolve({ data: [ROW], error: null }))
    expect(await loadPilotFleet(client)).toEqual([ROW])
  })

  test('null data → empty array', async () => {
    const client = mockClient(() => Promise.resolve({ data: null, error: null }))
    expect(await loadPilotFleet(client)).toEqual([])
  })

  test('throws on RPC error (e.g. 42501)', async () => {
    const client = mockClient(() => Promise.resolve({ data: null, error: { code: '42501', message: 'forbidden' } }))
    await expect(loadPilotFleet(client)).rejects.toMatchObject({ code: '42501' })
  })
})

describe('friendlyBlockReason', () => {
  test('maps known reasons', () => {
    expect(friendlyBlockReason('insufficient_quote_balance')).toBe('insufficient balance')
    expect(friendlyBlockReason('daily_notional_cap')).toBe('daily cap reached')
  })
  test('passes through unknown, returns null for null', () => {
    expect(friendlyBlockReason('weird_reason')).toBe('weird_reason')
    expect(friendlyBlockReason(null)).toBeNull()
  })
})
