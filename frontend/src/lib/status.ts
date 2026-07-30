// status.ts — Operator Console read-only status types + helpers (S5 Slice 1c).
// No React, no client creation, no env read (safe to import in tests). Mirrors the operator_status()
// RPC payload (migration 016) — NON-SECRET fields only.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface BotStatus {
  id: string   // non-secret bot UUID (added by migration 020 — needed for baseline/restore)
  trading_pair: string
  bot_status: string
  trading_enabled: boolean
  sizing_mode: string | null
  exchange_environment: string | null
  credential_status: string | null
  credential_ok: boolean
  /** A8-H3 S1a (migration 022): is this bot's credential referenced by another live bot? boolean, never null. */
  credential_shared: boolean
  /** A8-H3 S1a (migration 022): count of OTHER live bots sharing this credential (>= 0). */
  shared_with_count: number
  config_ready: boolean
  execution_ready: boolean
}

export interface WorkerStatus {
  queue_enabled: boolean
  is_production: boolean
  worker_state: string
  boot_stuck_count: number | null
  updated_at: string
}

export interface OperatorStatus {
  bots: BotStatus[]
  enabled_bots: number
  open_trades: number
  dlq: number
  open_recon: number
  queue_length: number
  /** catalog boolean (migration 020): does public.operator_kill_all exist. Testnet ops-metadata only. */
  kill_rpc_present: boolean
  worker_status: WorkerStatus | null
}

/** worker_status older than this (ms) — or missing/unreadable — is DEGRADED (D3 = 180s). */
export const WORKER_STALE_MS = 180_000

/**
 * DEGRADED when worker_status is missing/null, its updated_at is unparseable, or it is older than
 * WORKER_STALE_MS relative to nowMs. (A read error is handled by the caller as DEGRADED too.)
 */
export function computeDegraded(ws: WorkerStatus | null | undefined, nowMs: number): boolean {
  if (!ws || !ws.updated_at) return true
  const updated = Date.parse(ws.updated_at)
  if (Number.isNaN(updated)) return true
  return nowMs - updated > WORKER_STALE_MS
}

/** Classify an operator_status() error: the RPC RAISEs 42501 for non-operators / unauthenticated. */
export function isForbiddenError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === '42501') return true
  return typeof e.message === 'string' && /forbidden|not authenticated/i.test(e.message)
}

/** Call the read-only operator_status() RPC; throws the PostgrestError (e.g. 42501) on denial. */
export async function loadOperatorStatus(client: SupabaseClient): Promise<OperatorStatus> {
  const { data, error } = await client.rpc('operator_status')
  if (error) throw error
  return data as OperatorStatus
}
