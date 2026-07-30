import { describe, test, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { operatorKillAll, isInvalidReasonError, type KillResult } from './actions'

const okResult: KillResult = {
  ok: true, kill_applied: true, requires_attention: false, operational_state: 'SAFE',
  enabled_bots_after: 0, open_trades: 0, queue_length: 0, worker_state: 'disabled',
  worker_updated_at: '2026-07-08T00:00:00Z', audit_id: 'aud-1', message: 'clean',
}

function clientWithRpc(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient
}

describe('operatorKillAll', () => {
  test('defaults p_hard_lock=true and passes the reason', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: okResult, error: null })
    const r = await operatorKillAll(clientWithRpc(rpc), { reason: 'drill' })
    expect(rpc).toHaveBeenCalledWith('operator_kill_all', { p_reason: 'drill', p_hard_lock: true })
    expect(r.ok).toBe(true)
    expect(r.audit_id).toBe('aud-1')
  })

  test('omitted/empty reason → p_reason null; hardLock override honored', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: okResult, error: null })
    await operatorKillAll(clientWithRpc(rpc), { hardLock: false })
    expect(rpc).toHaveBeenLastCalledWith('operator_kill_all', { p_reason: null, p_hard_lock: false })
    await operatorKillAll(clientWithRpc(rpc), { reason: '' })
    // empty reason still coerces to null
    expect(rpc).toHaveBeenCalledWith('operator_kill_all', { p_reason: null, p_hard_lock: true })
  })

  test('throws the PostgrestError on 42501 denial', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'operator_kill_all: forbidden' } })
    await expect(operatorKillAll(clientWithRpc(rpc))).rejects.toMatchObject({ code: '42501' })
  })

  test('returns an ATTENTION result verbatim (does not coerce ok)', async () => {
    const attn: KillResult = { ...okResult, ok: false, requires_attention: true, operational_state: 'ATTENTION',
      open_trades: 2, queue_length: 3, message: 'ATTENTION' }
    const rpc = vi.fn().mockResolvedValue({ data: attn, error: null })
    const r = await operatorKillAll(clientWithRpc(rpc))
    expect(r.ok).toBe(false)
    expect(r.requires_attention).toBe(true)
    expect(r.operational_state).toBe('ATTENTION')
  })
})

describe('isInvalidReasonError', () => {
  test('22023 → true', () => { expect(isInvalidReasonError({ code: '22023' })).toBe(true) })
  test('message-based → true', () => {
    expect(isInvalidReasonError({ message: 'operator_kill_all: invalid reason (max 500 ...)' })).toBe(true)
  })
  test('42501 / null / other → false', () => {
    expect(isInvalidReasonError({ code: '42501' })).toBe(false)
    expect(isInvalidReasonError(null)).toBe(false)
    expect(isInvalidReasonError(new Error('Failed to fetch'))).toBe(false)
  })
})
