// PilotCockpit.tsx — StrateTeach ST-1 operator read-only pilot cockpit.
// READ-ONLY: no mutation, no secrets (fingerprints only). Reuses operator_status() for the runtime/arming
// header (worker tier/queue/state + age + DEGRADED) and operator_pilot_fleet() for the enriched fleet table
// (caps, last trade, last block reason, credential fingerprint). Gated by VITE_STRATETEACH_PILOT in App.
import { useEffect, useState } from 'react'
import { computeDegraded, isForbiddenError, type OperatorStatus } from '../lib/status'
import { friendlyBlockReason, type PilotBot } from '../lib/pilot'

type View =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error' }
  | { kind: 'ok'; status: OperatorStatus; fleet: PilotBot[] }

export interface PilotCockpitProps {
  loadStatus: () => Promise<OperatorStatus>
  loadFleet: () => Promise<PilotBot[]>
  /** Injectable clock for deterministic staleness/age in tests. */
  now?: () => number
}

function fmtAge(updatedAt: string | undefined, nowMs: number): string {
  if (!updatedAt) return 'unknown'
  const t = Date.parse(updatedAt)
  if (Number.isNaN(t)) return 'unknown'
  return `${Math.max(0, Math.round((nowMs - t) / 1000))}s`
}

export function PilotCockpit({ loadStatus, loadFleet, now = () => Date.now() }: PilotCockpitProps) {
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    Promise.all([loadStatus(), loadFleet()])
      .then(([status, fleet]) => { if (alive) setView({ kind: 'ok', status, fleet }) })
      .catch(err => { if (alive) setView({ kind: isForbiddenError(err) ? 'forbidden' : 'error' }) })
    return () => { alive = false }
  }, [loadStatus, loadFleet])

  if (view.kind === 'loading') return <p role="status">Loading cockpit…</p>
  if (view.kind === 'forbidden') return <p role="alert">Operator access required — your account is not an operator.</p>
  if (view.kind === 'error') return <p role="alert">DEGRADED — cockpit unavailable (read error).</p>

  const { status, fleet } = view
  const ws = status.worker_status
  const degraded = computeDegraded(ws, now())
  const live = ws?.is_production === true

  return (
    <section aria-label="pilot-cockpit">
      <h2>Pilot cockpit</h2>

      {degraded && (
        <p role="alert" data-testid="cockpit-degraded">
          DEGRADED — worker status missing or stale (&gt; 180s). Verify worker_status directly; do not trust queue/worker state.
        </p>
      )}

      {/* Arming-verification header — the Doppler↔Railway drift guard, on screen. */}
      <ul aria-label="runtime-header">
        <li data-testid="tier-badge">
          tier: <strong>{ws ? (live ? 'LIVE (real funds)' : 'TESTNET') : 'unknown'}</strong>
        </li>
        <li>queue_enabled: {String(ws?.queue_enabled ?? 'unknown')}</li>
        <li>worker_state: {ws?.worker_state ?? 'unknown'}</li>
        <li data-testid="worker-age">worker age: {fmtAge(ws?.updated_at, now())}</li>
        <li>queue_length: {status.queue_length}</li>
      </ul>

      <h3>Fleet</h3>
      <table>
        <thead>
          <tr>
            <th>Pair</th><th>User</th><th>Status</th><th>Trading</th><th>Env</th><th>Cred</th>
            <th>Caps (fix/max/daily)</th><th>Sell</th><th>Last trade</th><th>Last block</th>
          </tr>
        </thead>
        <tbody>
          {fleet.map(b => (
            <tr key={b.id}>
              <td>{b.trading_pair}</td>
              <td>{b.user_id.slice(0, 8)}</td>
              <td>{b.bot_status}</td>
              <td>{String(b.trading_enabled)}</td>
              <td>{b.exchange_environment ?? '—'}</td>
              <td>{b.credential_fingerprint ?? '—'}</td>
              <td>
                {b.fixed_notional_usdt ?? '—'}/{b.max_order_notional_usdt ?? '—'}/{b.daily_notional_cap_usdt ?? '—'}
              </td>
              <td>{String(b.sell_enabled)}</td>
              <td>{b.last_trade_status ?? '—'}</td>
              <td>{friendlyBlockReason(b.last_block_reason) ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fleet.length === 0 && <p data-testid="cockpit-empty">No pilot bots.</p>}
    </section>
  )
}
