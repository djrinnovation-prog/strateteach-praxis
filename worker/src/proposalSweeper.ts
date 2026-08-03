/**
 * proposalSweeper.ts — expire stale pending proposals (045, per-order approval).
 *
 * A LIVE-bot signal the user never approves must not linger as actionable forever. This marks any
 * proposed_trades row still 'pending' past its expires_at as 'expired'. NO order is ever placed — proposing
 * never touched the exchange, so expiring is purely a state cleanup + a fail-safe (a stale proposal can never
 * be approved into a now-irrelevant real order). Same operational contract as reconciliationScan /
 * credentialValidation: flag-gated (default OFF / dark launch), unref'd interval (never keeps the process
 * alive), in-flight guard against overlap, NEVER throws (logged + swallowed). Dependency-injected for tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const PROPOSAL_SWEEP_INTERVAL_MS_DEFAULT = 60_000

type IntervalHandle = { unref?: () => void }
type SetIntervalLike = (handler: () => void, ms: number) => IntervalHandle
type ClearIntervalLike = (handle: IntervalHandle) => void

export interface StartProposalSweeperOptions {
  supabase: SupabaseClient
  /** Master switch — default OFF. When false: no interval, sweepOnce is a no-op. */
  enabled: boolean
  intervalMs?: number
  setIntervalImpl?: SetIntervalLike
  clearIntervalImpl?: ClearIntervalLike
}

export interface ProposalSweeperHandle {
  stop(): void
  /** Expire stale pending proposals once (respecting the in-flight guard). Never throws. Exposed for tests. */
  sweepOnce(): Promise<void>
}

export function startProposalSweeper(opts: StartProposalSweeperOptions): ProposalSweeperHandle {
  const {
    supabase,
    enabled,
    intervalMs = PROPOSAL_SWEEP_INTERVAL_MS_DEFAULT,
    setIntervalImpl = ((handler, ms) => setInterval(handler, ms)) as SetIntervalLike,
    clearIntervalImpl = (handle => clearInterval(handle as ReturnType<typeof setInterval>)) as ClearIntervalLike,
  } = opts

  let inFlight = false

  const sweepOnce = async (): Promise<void> => {
    if (!enabled || inFlight) return
    inFlight = true
    try {
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('proposed_trades')
        .update({ status: 'expired', decided_at: nowIso })
        .eq('status', 'pending')
        .lt('expires_at', nowIso)
        .select('id')
      if (error) {
        console.error(JSON.stringify({ event: 'proposal_sweep_error', error: error.code }))
        return
      }
      const n = Array.isArray(data) ? data.length : 0
      if (n > 0) console.log(JSON.stringify({ event: 'proposals_expired', count: n }))
    } catch (e) {
      console.error(JSON.stringify({ event: 'proposal_sweep_threw', error: e instanceof Error ? e.constructor.name : 'unknown' }))
    } finally {
      inFlight = false
    }
  }

  if (!enabled) {
    return { stop: () => {}, sweepOnce }
  }

  const handle = setIntervalImpl(() => { void sweepOnce() }, intervalMs)
  handle.unref?.()
  return { stop: () => { clearIntervalImpl(handle) }, sweepOnce }
}
