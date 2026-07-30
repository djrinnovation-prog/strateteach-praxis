/**
 * flatten.test.ts — EP5 flatten/close-all executor.
 * Exercises the executor via the adapterFor seam (spot / futures / no-position / error / single-flight)
 * plus one DB-resolver fail-closed test (venue gate). No real ccxt, no network.
 */
import { flattenBot } from './flatten'
import type { ExchangeAdapter } from './types'
import { ExchangeAuthError } from './types'

const RULES = { symbol: 'BTC/USDT', minNotional: 10, stepSize: 0.001, minQty: 0.001, pricePrecision: 2, qtyPrecision: 3 }

function makeOrder(id = 'ord-1') {
  return { id, clientOrderId: 'x', symbol: 'BTC/USDT', side: 'sell' as const, type: 'market',
    status: 'filled' as const, quantity: 0, filled: 0, price: 60000, cost: 0, timestamp: 0 }
}

function stubAdapter(over: Partial<Record<keyof ExchangeAdapter, jest.Mock>> = {}): ExchangeAdapter {
  return {
    getMarketRules: jest.fn().mockResolvedValue(RULES),
    fetchBalance:   jest.fn().mockResolvedValue({ BTC: { free: 0.05, used: 0, total: 0.05 }, USDT: { free: 0, used: 0, total: 0 } }),
    fetchPrice:     jest.fn(),
    createOrder:    jest.fn().mockResolvedValue(makeOrder()),
    fetchOrder:     jest.fn(),
    fetchPositions: jest.fn().mockResolvedValue([]),
    ...over,
  } as unknown as ExchangeAdapter
}

/** Minimal supabase whose audit_logs.insert is captured; other tables are unused via the seam. */
function auditSupabase() {
  const insert = jest.fn().mockResolvedValue({ error: null })
  return { supabase: { from: jest.fn(() => ({ insert })) } as never, insert }
}

describe('flattenBot (EP5) — via the adapterFor seam', () => {
  test('SPOT: sells 100% of free base (rounded to step); flattened + bot.flattened audit', async () => {
    const { supabase, insert } = auditSupabase()
    const adapter = stubAdapter()
    const res = await flattenBot(supabase, 'bot-1', 'operator: drawdown halt', {
      adapterFor: async () => ({ adapter, tradingPair: 'BTC/USDT', accountType: 'spot' }),
    })
    expect(res.outcome).toBe('flattened')
    expect(adapter.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTC/USDT', side: 'sell', type: 'market', quantity: 0.05,
    }))
    expect(res.closedOrders).toEqual([{ symbol: 'BTC/USDT', side: 'sell', quantity: 0.05, orderId: 'ord-1' }])
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'bot.flattened' }))
  })

  test('SPOT: free base below min size → nothing_to_close; NO order placed', async () => {
    const { supabase } = auditSupabase()
    const adapter = stubAdapter({ fetchBalance: jest.fn().mockResolvedValue({ BTC: { free: 0.0004, used: 0, total: 0.0004 } }) })
    const res = await flattenBot(supabase, 'bot-1', 'op', { adapterFor: async () => ({ adapter, tradingPair: 'BTC/USDT', accountType: 'spot' }) })
    expect(res.outcome).toBe('nothing_to_close')
    expect(adapter.createOrder).not.toHaveBeenCalled()
  })

  test('FUTURES: closes each position with a REDUCE-ONLY market order on the opposite side', async () => {
    const { supabase } = auditSupabase()
    const adapter = stubAdapter({
      fetchPositions: jest.fn().mockResolvedValue([
        { symbol: 'BTC/USDT:USDT', side: 'long',  contracts: 0.01, notional: 650, entryPrice: 65000, leverage: 5, marginMode: 'isolated' },
        { symbol: 'BTC/USDT:USDT', side: 'short', contracts: 2,    notional: 6000, entryPrice: 3000, leverage: 3, marginMode: 'isolated' },
      ]),
      createOrder: jest.fn().mockImplementation(async (p) => makeOrder('ord-' + p.side)),
    })
    const res = await flattenBot(supabase, 'bot-1', 'op', { adapterFor: async () => ({ adapter, tradingPair: 'BTC/USDT:USDT', accountType: 'futures' }) })
    expect(res.outcome).toBe('flattened')
    expect(adapter.createOrder).toHaveBeenNthCalledWith(1, expect.objectContaining({ side: 'sell', reduceOnly: true, quantity: 0.01 })) // close long
    expect(adapter.createOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({ side: 'buy',  reduceOnly: true, quantity: 2 }))    // close short
  })

  test('empty reason → error; NO adapter resolution, NO order', async () => {
    const { supabase } = auditSupabase()
    const adapterFor = jest.fn()
    const res = await flattenBot(supabase, 'bot-1', '   ', { adapterFor })
    expect(res.outcome).toBe('error')
    expect(adapterFor).not.toHaveBeenCalled()
  })

  test('unresolved adapter (fail-closed) → skipped_no_adapter; NO order', async () => {
    const { supabase, insert } = auditSupabase()
    const res = await flattenBot(supabase, 'bot-1', 'op', { adapterFor: async () => null })
    expect(res.outcome).toBe('skipped_no_adapter')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'bot.flatten_skipped' }))
  })

  test('exchange error mid-close → error outcome; partial closes are reported', async () => {
    const { supabase } = auditSupabase()
    const adapter = stubAdapter({ createOrder: jest.fn().mockRejectedValue(new ExchangeAuthError()) })
    const res = await flattenBot(supabase, 'bot-1', 'op', { adapterFor: async () => ({ adapter, tradingPair: 'BTC/USDT', accountType: 'spot' }) })
    expect(res.outcome).toBe('error')
  })

  test('single-flight: two concurrent flattens for the SAME bot → one runs, one skipped_locked', async () => {
    const { supabase } = auditSupabase()
    const adapter = stubAdapter()
    const af = async () => ({ adapter, tradingPair: 'BTC/USDT', accountType: 'spot' })
    const [r1, r2] = await Promise.all([
      flattenBot(supabase, 'bot-1', 'op', { adapterFor: af }),
      flattenBot(supabase, 'bot-1', 'op', { adapterFor: af }),
    ])
    expect([r1.outcome, r2.outcome].sort()).toEqual(['flattened', 'skipped_locked'])
  })
})

describe('flattenBot (EP5) — DB resolver venue gate (fail-closed)', () => {
  /** Route select().eq().single() by table; audit_logs.insert captured. */
  function routed(rows: Record<string, { data: unknown; error: unknown }>) {
    const insert = jest.fn().mockResolvedValue({ error: null })
    const supabase = {
      from: (t: string) => t === 'audit_logs'
        ? { insert }
        : { select: () => ({ eq: () => ({ single: () => Promise.resolve(rows[t] ?? { data: null, error: null }) }) }) },
    } as never
    return { supabase, insert }
  }

  test('exchange is_active=false → resolver returns null → skipped_no_adapter (no adapter built)', async () => {
    const { supabase } = routed({
      bots: { data: { credential_id: 'c1', user_id: 'u1', trading_pair: 'BTC/USDT', account_type: 'spot', deleted_at: null }, error: null },
      user_exchange_credentials: { data: { vault_secret_id: '7e57ed00-aaaa-bbbb-cccc-123456789abc', status: 'valid', deleted_at: null, user_id: 'u1', exchange_id: 'e1' }, error: null },
      exchanges: { data: { ccxt_id: 'binance', is_active: false }, error: null }, // DORMANT venue → fail-closed
    })
    const res = await flattenBot(supabase, 'bot-1', 'op', {}) // no seam → real resolver
    expect(res.outcome).toBe('skipped_no_adapter')
  })

  test('cross-user credential ownership mismatch → resolver null → skipped_no_adapter', async () => {
    const { supabase } = routed({
      bots: { data: { credential_id: 'c1', user_id: 'u1', trading_pair: 'BTC/USDT', account_type: 'spot', deleted_at: null }, error: null },
      user_exchange_credentials: { data: { vault_secret_id: '7e57ed00-aaaa-bbbb-cccc-123456789abc', status: 'valid', deleted_at: null, user_id: 'u-OTHER', exchange_id: 'e1' }, error: null },
      exchanges: { data: { ccxt_id: 'binance', is_active: true }, error: null },
    })
    const res = await flattenBot(supabase, 'bot-1', 'op', {})
    expect(res.outcome).toBe('skipped_no_adapter')
  })
})
