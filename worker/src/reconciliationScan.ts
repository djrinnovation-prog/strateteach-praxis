/**
 * reconciliationScan.ts — S4-3b runtime periodic reconciliation scan.
 *
 * Periodically resolves stuck `pending`/`unknown` trades by delegating to the SAME
 * read-only orchestrator the boot scan uses: resolvePendingReconciliations →
 * resolveStuckTrade → fetchOrder. It therefore NEVER places, cancels, or duplicates an
 * order (resolveStuckTrade only ever calls fetchOrder), and it inherits every rail from
 * defaultAdapterFor: production-egress fail-closed (no proxy/native ⇒ null adapter ⇒ no
 * exchange call) + credential-ownership. This module adds NO new query and NO new adapter
 * builder — it only schedules the existing, reviewed resolver.
 *
 * Race / idempotency safety: resolution uses conditional UPDATEs on trade status, so a
 * runtime tick converging with the boot scan (or another tick) on the same trade is a
 * no-op race, never a double-order. The default staleness threshold (60s) is ≥ the queue
 * visibility timeout (45s), so a message still legitimately in-flight is not reconciled
 * out from under the poll loop. An in-flight guard also prevents overlapping ticks.
 *
 * STRICTLY out-of-band from the poll loop: flag-gated (default OFF / dark launch), unref'd
 * interval (never keeps the process alive on its own), cleared on shutdown, and never
 * throws (throttled-logged, swallowed). Dependency-injected for tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolvePendingReconciliations,
  RECONCILIATION_RESOLVE_THRESHOLD_SECONDS,
  type ResolveDeps,
} from './reconciliation'

// Interval between runtime scans. Boot reconciliation already runs once at startup;
// this backstops long-lived workers between restarts.
export const RECONCILIATION_SCAN_INTERVAL_MS_DEFAULT = 60_000

// Safety margin (seconds) the staleness threshold must keep ABOVE the queue visibility
// timeout, so a message still legitimately in-flight (invisible up to the timeout) is
// never reconciled out from under the poll loop.
export const RECONCILIATION_SCAN_VISIBILITY_MARGIN_S = 15

type IntervalHandle = { unref?: () => void }
type SetIntervalLike = (handler: () => void, ms: number) => IntervalHandle
type ClearIntervalLike = (handle: IntervalHandle) => void

export interface StartReconciliationScanOptions {
  supabase: SupabaseClient
  /** Master switch — default OFF. When false the scan is a no-op (no interval, scanOnce does nothing). */
  enabled: boolean
  isProduction: boolean
  /** A1 Option B: fixed-IP exchange-egress proxy URL, or null. Threaded to the resolver/adapter. */
  exchangeHttpsProxy?: string | null
  /** A1 Option A (B0): true iff EXCHANGE_EGRESS_MODE=native. */
  nativeEgressAllowed?: boolean
  cap?: number
  thresholdSeconds?: number
  /** Queue visibility timeout (s). The effective staleness threshold is clamped to at least
   *  this + RECONCILIATION_SCAN_VISIBILITY_MARGIN_S, enforcing the threshold ≥ visibility
   *  invariant in code even if an operator raises QUEUE_VISIBILITY_TIMEOUT_S. */
  visibilityTimeoutS?: number
  intervalMs?: number
  /** Injectable for tests: substitute the (read-only) resolver and the timer functions. */
  resolveImpl?: (supabase: SupabaseClient, deps: ResolveDeps) => Promise<unknown>
  setIntervalImpl?: SetIntervalLike
  clearIntervalImpl?: ClearIntervalLike
}

export interface ReconciliationScanHandle {
  /** Clear the timer. Never throws. */
  stop(): void
  /** Run one scan, respecting the in-flight guard. Never throws. Exposed for tests. */
  scanOnce(): Promise<void>
}

export function startReconciliationScan(opts: StartReconciliationScanOptions): ReconciliationScanHandle {
  const {
    supabase,
    enabled,
    isProduction,
    exchangeHttpsProxy = null,
    nativeEgressAllowed = false,
    cap,
    thresholdSeconds,
    visibilityTimeoutS = 0,
    intervalMs = RECONCILIATION_SCAN_INTERVAL_MS_DEFAULT,
    resolveImpl = resolvePendingReconciliations,
    setIntervalImpl = ((handler, ms) => setInterval(handler, ms)) as SetIntervalLike,
    clearIntervalImpl = (handle => clearInterval(handle as ReturnType<typeof setInterval>)) as ClearIntervalLike,
  } = opts

  // Enforce (in code) the threshold ≥ visibility-timeout invariant: a still-in-flight message
  // must age past the visibility window (+ margin) before the read-only scan can touch its trade.
  const effectiveThresholdSeconds = Math.max(
    thresholdSeconds ?? RECONCILIATION_RESOLVE_THRESHOLD_SECONDS,
    visibilityTimeoutS + RECONCILIATION_SCAN_VISIBILITY_MARGIN_S,
  )

  // Prevents overlapping ticks: a scan that outruns the interval must not stack.
  let inFlight = false

  // Log throttle: log only the FIRST failure in a run; on the next success, log recovery.
  let consecutiveFailures = 0
  const onFailure = (detail: string | undefined): void => {
    consecutiveFailures += 1
    if (consecutiveFailures === 1) {
      console.error(JSON.stringify({
        event: 'reconciliation_scan_error',
        error: detail,
        note: 'runtime reconciliation scan only — worker health unaffected; repeats suppressed until recovery',
      }))
    }
  }
  const onSuccess = (): void => {
    if (consecutiveFailures > 0) {
      console.log(JSON.stringify({ event: 'reconciliation_scan_recovered', failed_scans: consecutiveFailures }))
      consecutiveFailures = 0
    }
  }

  const scanOnce = async (): Promise<void> => {
    if (!enabled) return
    if (inFlight) return
    inFlight = true
    try {
      await resolveImpl(supabase, {
        isProduction,
        exchangeHttpsProxy,
        nativeEgressAllowed,
        cap,
        thresholdSeconds: effectiveThresholdSeconds,
      })
      onSuccess()
    } catch (e) {
      onFailure(e instanceof Error ? e.constructor.name : 'unknown')
    } finally {
      inFlight = false
    }
  }

  if (!enabled) {
    // Dark launch: no timer, no work.
    return { stop: () => {}, scanOnce }
  }

  const handle = setIntervalImpl(() => { void scanOnce() }, intervalMs)
  handle.unref?.()

  return {
    stop: () => { clearIntervalImpl(handle) },
    scanOnce,
  }
}
