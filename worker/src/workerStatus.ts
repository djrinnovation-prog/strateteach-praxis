/**
 * workerStatus.ts — Operator Console worker runtime status writer (S5 Slice 1a).
 *
 * Upserts the single-row `public.worker_status` on start + every intervalMs (default 60s), and writes
 * one best-effort `worker_state='stopping'` row on shutdown, so the operator console can show
 * worker-OBSERVED runtime state (queue_enabled, is_production, worker_state, boot_stuck_count,
 * updated_at). STRICTLY out-of-band from trading:
 *   - non-fatal: a write failure is swallowed — never thrown into boot, the poll loop, or shutdown.
 *   - **log throttle:** the first failure logs `worker_status_write_error` (or `_exception`); repeats are
 *     suppressed until a write succeeds, which logs `worker_status_write_recovered`. So a temporary
 *     missing table (e.g. before migration 015 is applied) is NOT 60s of noise and is clearly a
 *     status-writer issue, never worker-health failure.
 *   - the interval is unref()'d: it can never keep the process alive or delay shutdown.
 *   - WRITE-ONLY status; NO secrets (only operational flags/counts); cannot affect processMessage, the
 *     poll loop, or any trade.
 *
 * Dependency injection (for tests): supabase, setIntervalImpl/clearIntervalImpl, nowImpl, intervalMs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const WORKER_STATUS_INTERVAL_MS_DEFAULT = 60_000

export type WorkerState = 'running' | 'disabled' | 'stopping'

export interface WorkerStatusFields {
  queueEnabled: boolean
  isProduction: boolean
  bootStuckCount: number | null
  workerState: WorkerState
}

type IntervalHandle = { unref?: () => void }
type SetIntervalLike = (handler: () => void, ms: number) => IntervalHandle
type ClearIntervalLike = (handle: IntervalHandle) => void

export interface StartWorkerStatusOptions {
  supabase: SupabaseClient
  fields: WorkerStatusFields
  intervalMs?: number
  setIntervalImpl?: SetIntervalLike
  clearIntervalImpl?: ClearIntervalLike
  /** Returns an ISO timestamp; injectable for tests. */
  nowImpl?: () => string
}

export interface WorkerStatusHandle {
  /** Best-effort write of worker_state='stopping', then clear the timer. Never rejects. */
  stop(): Promise<void>
  /** Perform one status upsert now (default state, or an override). Exposed for tests. Never rejects. */
  writeOnce(stateOverride?: WorkerState): Promise<void>
}

/**
 * Start the periodic worker-status writer. Writes immediately, then every intervalMs; on stop() writes
 * one `stopping` row before clearing the timer. All writes are non-fatal (throttled-logged, swallowed).
 */
export function startWorkerStatus(opts: StartWorkerStatusOptions): WorkerStatusHandle {
  const {
    supabase,
    fields,
    intervalMs = WORKER_STATUS_INTERVAL_MS_DEFAULT,
    setIntervalImpl = ((handler, ms) => setInterval(handler, ms)) as SetIntervalLike,
    clearIntervalImpl = (handle => clearInterval(handle as ReturnType<typeof setInterval>)) as ClearIntervalLike,
    nowImpl = () => new Date().toISOString(),
  } = opts

  // Log throttle: log only the FIRST failure in a run of failures; on the next success, log recovery.
  let consecutiveFailures = 0
  const onFailure = (event: string, detail: string | undefined): void => {
    consecutiveFailures += 1
    if (consecutiveFailures === 1) {
      console.error(JSON.stringify({
        event,
        error: detail,
        note: 'status-writer only — worker health unaffected; repeats suppressed until recovery',
      }))
    }
  }
  const onSuccess = (): void => {
    if (consecutiveFailures > 0) {
      console.log(JSON.stringify({ event: 'worker_status_write_recovered', failed_writes: consecutiveFailures }))
      consecutiveFailures = 0
    }
  }

  const writeOnce = async (stateOverride?: WorkerState): Promise<void> => {
    try {
      const { error } = await supabase
        .from('worker_status')
        .upsert(
          {
            singleton:        true,
            queue_enabled:    fields.queueEnabled,
            is_production:    fields.isProduction,
            worker_state:     stateOverride ?? fields.workerState,
            boot_stuck_count: fields.bootStuckCount,
            updated_at:       nowImpl(),
          },
          { onConflict: 'singleton' },
        )
      if (error) {
        onFailure('worker_status_write_error', error.code)
        return
      }
      onSuccess()
    } catch (e) {
      // Non-fatal: status is best-effort and must never affect the worker. Constructor name only.
      onFailure('worker_status_write_exception', e instanceof Error ? e.constructor.name : 'unknown')
    }
  }

  // Initial write — fire-and-forget; the caller never awaits it.
  void writeOnce()

  const handle = setIntervalImpl(() => { void writeOnce() }, intervalMs)
  handle.unref?.()

  return {
    stop: async () => {
      // Best-effort final state, then stop the timer (clear first so no tick races the final write
      // after we've decided to stop).
      clearIntervalImpl(handle)
      await writeOnce('stopping')
    },
    writeOnce,
  }
}
