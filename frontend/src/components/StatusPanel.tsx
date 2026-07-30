// StatusPanel.tsx — operator status (S5 Slice 1c) + the A8-H2 audited one-click kill (optional).
// Read-only status by default: renders the operator_status() payload, a forbidden notice for
// non-operators (RPC 42501), and a DEGRADED banner when worker_status is stale/missing or the read errors.
// When (and ONLY when) a `killAll` prop is supplied, it also renders a guarded emergency-kill control.
// The kill NEVER re-arms; re-enable is a separate guarded flow.
import { useEffect, useState } from 'react'
import { computeDegraded, isForbiddenError, type OperatorStatus } from '../lib/status'
import { isInvalidReasonError, type KillResult } from '../lib/actions'

type View =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error' }
  | { kind: 'ok'; data: OperatorStatus }

export interface StatusPanelProps {
  loadStatus: () => Promise<OperatorStatus>
  /** Optional: when provided, renders the guarded one-click kill (A8-H2). Omit for a pure read-only panel. */
  killAll?: (reason: string) => Promise<KillResult>
  /** Injectable clock for deterministic staleness in tests. */
  now?: () => number
}

export function StatusPanel({ loadStatus, killAll, now = () => Date.now() }: StatusPanelProps) {
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    loadStatus()
      .then(data => { if (alive) setView({ kind: 'ok', data }) })
      .catch(err => { if (alive) setView({ kind: isForbiddenError(err) ? 'forbidden' : 'error' }) })
    return () => { alive = false }
  }, [loadStatus])

  if (view.kind === 'loading') return <p role="status">Loading status…</p>
  if (view.kind === 'forbidden') {
    return <p role="alert">Operator access required — your account is not an operator.</p>
  }
  if (view.kind === 'error') {
    return <p role="alert">DEGRADED — status unavailable (read error). Worker state cannot be confirmed.</p>
  }

  const { data } = view
  const degraded = computeDegraded(data.worker_status, now())

  return (
    <section aria-label="operator-status">
      {degraded && (
        <p role="alert" data-testid="degraded-banner">
          DEGRADED — worker status missing or stale (&gt; 180s). Do not trust queue/worker state.
        </p>
      )}

      {killAll && <KillControls killAll={killAll} />}

      <h2>System</h2>
      <ul>
        <li>QUEUE_ENABLED (worker-observed): {String(data.worker_status?.queue_enabled ?? 'unknown')}</li>
        <li>worker_state: {data.worker_status?.worker_state ?? 'unknown'}</li>
        <li>is_production: {String(data.worker_status?.is_production ?? 'unknown')}</li>
        <li>enabled_bots: {data.enabled_bots}</li>
        <li>open_trades: {data.open_trades}</li>
        <li>dlq: {data.dlq}</li>
        <li>open_recon: {data.open_recon}</li>
        <li>queue_length: {data.queue_length}</li>
      </ul>

      <h2>Bots</h2>
      <table>
        <thead>
          <tr>
            <th>Pair</th><th>Bot status</th><th>Trading enabled</th><th>Env</th>
            <th>Credential OK</th><th>Config ready</th><th>Execution ready</th>
          </tr>
        </thead>
        <tbody>
          {data.bots.map(b => (
            <tr key={b.trading_pair}>
              <td>{b.trading_pair}</td>
              <td>{b.bot_status}</td>
              <td>{String(b.trading_enabled)}</td>
              <td>{b.exchange_environment ?? '—'}</td>
              <td>{String(b.credential_ok)}</td>
              <td>{String(b.config_ready)}</td>
              <td>{String(b.execution_ready)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// ---- A8-H2 audited one-click kill (guarded) --------------------------------
type KillState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'killing' }
  | { kind: 'result'; result: KillResult }
  | { kind: 'denied' }
  | { kind: 'invalid' }
  | { kind: 'failed'; message: string }

/**
 * Guarded emergency kill: idle → strong typed-"KILL" confirmation → in-progress → result (SAFE or
 * ATTENTION). Handles 42501 (denied) and 22023 (invalid reason). Renders the full response contract.
 * Never re-arms — there is deliberately no re-enable control here.
 */
function KillControls({ killAll }: { killAll: (reason: string) => Promise<KillResult> }) {
  const [state, setState] = useState<KillState>({ kind: 'idle' })
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')

  const confirmed = confirmText.trim() === 'KILL'

  async function fire() {
    setState({ kind: 'killing' })
    try {
      const result = await killAll(reason.trim())
      setState({ kind: 'result', result })
    } catch (err) {
      if (isForbiddenError(err)) setState({ kind: 'denied' })
      else if (isInvalidReasonError(err)) setState({ kind: 'invalid' })
      else setState({ kind: 'failed', message: (err as { message?: string })?.message ?? 'unknown error' })
    }
  }

  return (
    <section aria-label="kill-controls" data-testid="kill-controls">
      <h2>Emergency kill</h2>

      {state.kind === 'idle' && (
        <button
          type="button"
          data-testid="kill-button"
          onClick={() => { setConfirmText(''); setReason(''); setState({ kind: 'confirming' }) }}
        >
          Kill all trading
        </button>
      )}

      {state.kind === 'confirming' && (
        <div role="group" aria-label="kill-confirm">
          <p role="alert">
            This immediately stops ALL trading (trading_enabled=false and every bot paused). It does NOT cancel
            already-submitted exchange orders, unwind positions, or purge the queue. Re-arming is a separate guarded
            action — not available here.
          </p>
          <label>
            Reason (optional):{' '}
            <input
              type="text" data-testid="kill-reason" value={reason} maxLength={500}
              onChange={e => setReason(e.target.value)}
            />
          </label>
          <label>
            Type <strong>KILL</strong> to confirm:{' '}
            <input
              type="text" data-testid="kill-confirm-input" value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
            />
          </label>
          <button type="button" data-testid="kill-confirm" disabled={!confirmed} onClick={() => { void fire() }}>
            Confirm kill all trading
          </button>
          <button type="button" data-testid="kill-cancel" onClick={() => setState({ kind: 'idle' })}>
            Cancel
          </button>
        </div>
      )}

      {state.kind === 'killing' && (
        <p role="status" data-testid="kill-in-progress" aria-busy="true">Killing… stopping all trading.</p>
      )}

      {state.kind === 'denied' && (
        <p role="alert" data-testid="kill-denied">Operator access required — kill denied (your account is not an operator).</p>
      )}
      {state.kind === 'invalid' && (
        <p role="alert" data-testid="kill-invalid">Kill not sent — invalid reason (max 500 single-line printable characters).</p>
      )}
      {state.kind === 'failed' && (
        <p role="alert" data-testid="kill-failed">
          Kill FAILED — {state.message}. Trading state unchanged; retry, or use an operational stop (Railway).
        </p>
      )}

      {state.kind === 'result' && (
        <KillResultView result={state.result} onDismiss={() => setState({ kind: 'idle' })} />
      )}
    </section>
  )
}

/** Renders the KillResult contract — clean SAFE vs ATTENTION, with open-trade/queue/telemetry detail. */
function KillResultView({ result, onDismiss }: { result: KillResult; onDismiss: () => void }) {
  const queueTelemetryFailed = result.queue_length === null
  const workerTelemetryFailed = result.worker_state === null

  return (
    <div data-testid="kill-result" aria-label="kill-result">
      {result.ok ? (
        <p role="status" data-testid="kill-clean">
          ✓ Kill applied — SAFE. All trading stopped and every bot paused; no open trades, no queued messages.
        </p>
      ) : (
        <p role="alert" data-testid="kill-attention">
          ⚠ Kill applied — ATTENTION (operational_state={result.operational_state}). New execution is stopped, but the
          system is NOT fully safe.
        </p>
      )}
      <ul>
        <li data-testid="kr-kill-applied">kill_applied: {String(result.kill_applied)}</li>
        <li data-testid="kr-enabled-after">enabled_bots_after: {result.enabled_bots_after}</li>
        <li data-testid="kr-open-trades">open_trades: {result.open_trades}</li>
        <li data-testid="kr-queue">
          queue_length: {queueTelemetryFailed ? 'read failed (telemetry)' : result.queue_length}
        </li>
        <li data-testid="kr-worker">
          worker_state: {workerTelemetryFailed ? 'unavailable (telemetry)' : result.worker_state}
        </li>
        <li data-testid="kr-audit">audit_id: {result.audit_id}</li>
      </ul>
      <p data-testid="kr-message">{result.message}</p>
      <p><em>Re-arm is a separate guarded action — not available from this button.</em></p>
      <button type="button" data-testid="kill-dismiss" onClick={onDismiss}>Dismiss</button>
    </div>
  )
}
