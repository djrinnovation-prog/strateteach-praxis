import { describe, test, expect } from 'vitest'
import { computeDegraded, isForbiddenError, WORKER_STALE_MS, type WorkerStatus } from './status'

const NOW = 1_750_000_000_000 // fixed nowMs
const ws = (updated_at: string): WorkerStatus => ({
  queue_enabled: false, is_production: false, worker_state: 'disabled', boot_stuck_count: 0, updated_at,
})

describe('computeDegraded', () => {
  test('fresh worker_status → not degraded', () => {
    expect(computeDegraded(ws(new Date(NOW - 10_000).toISOString()), NOW)).toBe(false)
  })
  test('just under the 180s threshold → not degraded', () => {
    expect(computeDegraded(ws(new Date(NOW - (WORKER_STALE_MS - 1)).toISOString()), NOW)).toBe(false)
  })
  test('older than 180s → degraded', () => {
    expect(computeDegraded(ws(new Date(NOW - (WORKER_STALE_MS + 1)).toISOString()), NOW)).toBe(true)
  })
  test('missing / null worker_status → degraded', () => {
    expect(computeDegraded(null, NOW)).toBe(true)
    expect(computeDegraded(undefined, NOW)).toBe(true)
  })
  test('unparseable updated_at → degraded', () => {
    expect(computeDegraded(ws('not-a-date'), NOW)).toBe(true)
  })
})

describe('isForbiddenError', () => {
  test('PostgREST 42501 → forbidden', () => {
    expect(isForbiddenError({ code: '42501', message: 'operator_status: forbidden' })).toBe(true)
  })
  test('message-based forbidden / not authenticated → forbidden', () => {
    expect(isForbiddenError({ message: 'operator_status: not authenticated' })).toBe(true)
  })
  test('a network/other error → not forbidden', () => {
    expect(isForbiddenError(new Error('Failed to fetch'))).toBe(false)
    expect(isForbiddenError(null)).toBe(false)
  })
})
