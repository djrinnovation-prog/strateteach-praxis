/**
 * webhookRequeueSweeper.ts — Slice 4C (pgmq no-silent-loss) recovery sweeper.
 *
 * Periodically re-enqueues webhook_logs rows that were never durably queued:
 *   - status='queue_failed'  (pgmq_send failed at ingest or on a prior sweep), or
 *   - status='accepted' older than STALE_ACCEPTED_SECONDS (crash between the webhook_logs commit and the
 *     enqueue — the catch-all that recovers a row even when our own status write failed).
 *
 * Concurrency-safe: rows are claimed via the claim_webhook_requeue RPC (FOR UPDATE SKIP LOCKED + a
 * backoff lease + attempt increment), so two sweepers never fight over a row and a failing row backs off.
 * Bounded: the RPC never claims a row at/over max attempts — those stay queue_failed, observable, and are
 * reported via a throttled `webhook_requeue_exhausted` count (never silently dropped).
 *
 * Duplicate-order safety: a re-enqueue can at worst put a second copy of a (bot_id, signal_id) message on
 * the queue; the worker dedups on trades UNIQUE(bot_id, signal_id) (index.ts step 3) → one trade. So the
 * sweeper is always safe to run.
 *
 * STRICTLY out-of-band from trading: no exchange call, no secret, non-fatal (throttled-logged, swallowed),
 * unref'd interval, flag-gated (default OFF). Dependency-injected for tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const WEBHOOK_REQUEUE_INTERVAL_MS_DEFAULT = 60_000
export const WEBHOOK_REQUEUE_BATCH_DEFAULT = 50
export const WEBHOOK_REQUEUE_STALE_SECONDS_DEFAULT = 60
export const WEBHOOK_REQUEUE_MAX_ATTEMPTS_DEFAULT = 5

const QUEUE_NAME = 'trade_signals'
const SCHEMA_VERSION = '1.0'

interface ClaimedRow { bot_id: string; signal_id: string; side: string | null }

export interface SweepResult { claimed: number; requeued: number; failed: number }

type IntervalHandle = { unref?: () => void }
type SetIntervalLike = (handler: () => void, ms: number) => IntervalHandle
type ClearIntervalLike = (handle: IntervalHandle) => void

export interface StartSweeperOptions {
  supabase: SupabaseClient
  /** Master switch — default OFF. When false the sweeper is a no-op (no interval, sweepOnce does nothing). */
  enabled: boolean
  batch?: number
  staleSeconds?: number
  maxAttempts?: number
  intervalMs?: number
  setIntervalImpl?: SetIntervalLike
  clearIntervalImpl?: ClearIntervalLike
}

export interface SweeperHandle {
  /** Clear the timer. Never throws. */
  stop(): void
  /** Claim + re-enqueue one batch, then report the exhausted count. Never throws. Exposed for tests. */
  sweepOnce(): Promise<SweepResult>
}

export function startWebhookRequeueSweeper(opts: StartSweeperOptions): SweeperHandle {
  const {
    supabase,
    enabled,
    batch = WEBHOOK_REQUEUE_BATCH_DEFAULT,
    staleSeconds = WEBHOOK_REQUEUE_STALE_SECONDS_DEFAULT,
    maxAttempts = WEBHOOK_REQUEUE_MAX_ATTEMPTS_DEFAULT,
    intervalMs = WEBHOOK_REQUEUE_INTERVAL_MS_DEFAULT,
    setIntervalImpl = ((handler, ms) => setInterval(handler, ms)) as SetIntervalLike,
    clearIntervalImpl = (handle => clearInterval(handle as ReturnType<typeof setInterval>)) as ClearIntervalLike,
  } = opts

  // Log throttle: log only the FIRST failure in a run; on the next success, log recovery.
  let consecutiveFailures = 0
  const onFailure = (event: string, detail: string | undefined): void => {
    consecutiveFailures += 1
    if (consecutiveFailures === 1) {
      console.error(JSON.stringify({ event, error: detail, note: 'requeue sweeper only — worker health unaffected; repeats suppressed until recovery' }))
    }
  }
  const onSuccess = (): void => {
    if (consecutiveFailures > 0) {
      console.log(JSON.stringify({ event: 'webhook_requeue_sweeper_recovered', failed_sweeps: consecutiveFailures }))
      consecutiveFailures = 0
    }
  }

  // Sanitized error detail — class/code only, NEVER a driver message, URL, payload, or secret.
  const markQueued = async (r: ClaimedRow): Promise<void> => {
    // CAS on status so we never clobber a row a concurrent delivery already advanced.
    await supabase.from('webhook_logs')
      .update({ status: 'queued', last_requeue_error: null })
      .eq('bot_id', r.bot_id).eq('signal_id', r.signal_id)
      .in('status', ['queue_failed', 'accepted'])
  }
  const markError = async (r: ClaimedRow, code: string): Promise<void> => {
    // next_retry_at + attempt increment were already set atomically by the claim RPC.
    await supabase.from('webhook_logs')
      .update({ last_requeue_error: code })
      .eq('bot_id', r.bot_id).eq('signal_id', r.signal_id)
  }

  const reportExhausted = async (): Promise<void> => {
    const { count, error } = await supabase
      .from('webhook_logs')
      .select('bot_id', { count: 'exact', head: true })
      .eq('status', 'queue_failed')
      .gte('requeue_attempts', maxAttempts)
    if (error) return // best-effort observability; never fail the sweep on the count
    if ((count ?? 0) > 0) {
      console.error(JSON.stringify({ event: 'webhook_requeue_exhausted', count, max_attempts: maxAttempts, note: 'not dropped — observable dead-letter; needs human triage' }))
    }
  }

  const sweepOnce = async (): Promise<SweepResult> => {
    if (!enabled) return { claimed: 0, requeued: 0, failed: 0 }
    try {
      const { data: rows, error } = await supabase.rpc('claim_webhook_requeue', {
        p_batch: batch, p_stale_seconds: staleSeconds, p_max_attempts: maxAttempts,
      })
      if (error) { onFailure('webhook_requeue_claim_error', error.code); return { claimed: 0, requeued: 0, failed: 0 } }

      const claimed = (rows ?? []) as ClaimedRow[]
      let requeued = 0
      let failed = 0
      for (const r of claimed) {
        const side = r.side === 'buy' || r.side === 'sell' ? r.side : null
        if (!side) {
          // Corrupt/legacy stored action — never enqueue blindly.
          failed += 1
          await markError(r, 'invalid_action')
          continue
        }
        const { error: sendErr } = await supabase.rpc('pgmq_send', {
          queue_name: QUEUE_NAME,
          message: { schema_version: SCHEMA_VERSION, bot_id: r.bot_id, signal_id: r.signal_id, side },
        })
        if (sendErr) { failed += 1; await markError(r, sendErr.code ?? 'pgmq_send_error') }
        else { requeued += 1; await markQueued(r) }
      }

      await reportExhausted()
      onSuccess()
      if (claimed.length > 0) {
        console.log(JSON.stringify({ event: 'webhook_requeue_swept', claimed: claimed.length, requeued, failed }))
      }
      return { claimed: claimed.length, requeued, failed }
    } catch (e) {
      onFailure('webhook_requeue_sweep_exception', e instanceof Error ? e.constructor.name : 'unknown')
      return { claimed: 0, requeued: 0, failed: 0 }
    }
  }

  if (!enabled) {
    // Dark launch: no timer, no work.
    return { stop: () => {}, sweepOnce }
  }

  const handle = setIntervalImpl(() => { void sweepOnce() }, intervalMs)
  handle.unref?.()

  return {
    stop: () => { clearIntervalImpl(handle) },
    sweepOnce,
  }
}
