// UserDashboard.tsx — StrateTeach ST-2 pilot USER view. Read-only per-bot cards for the caller's OWN bots
// (RLS/auth.uid()-scoped in the RPC), plus ONE scoped action: pause my bot. No secrets, no key entry, no
// activation, no cap edits — those are operator-managed. Gated by VITE_STRATETEACH_PILOT in App.
import { useCallback, useEffect, useState } from 'react'
import { isForbiddenError } from '../lib/status'
import { friendlyBlockReason, type UserDashboardBot } from '../lib/userDashboard'

type View =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error' }
  | { kind: 'ok'; bots: UserDashboardBot[] }

export interface UserDashboardProps {
  loadBots: () => Promise<UserDashboardBot[]>
  pause: (botId: string) => Promise<unknown>
}

export function UserDashboard({ loadBots, pause }: UserDashboardProps) {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setView({ kind: 'loading' })
    loadBots()
      .then(bots => setView({ kind: 'ok', bots }))
      .catch(err => setView({ kind: isForbiddenError(err) ? 'forbidden' : 'error' }))
  }, [loadBots])

  useEffect(() => { refresh() }, [refresh])

  async function onPause(botId: string) {
    setBusy(botId)
    try { await pause(botId); refresh() } finally { setBusy(null) }
  }

  if (view.kind === 'loading') return <p role="status">Loading your bots…</p>
  if (view.kind === 'forbidden') return <p role="alert">Please sign in to view your bots.</p>
  if (view.kind === 'error') return <p role="alert">Unable to load your bots right now.</p>

  if (view.bots.length === 0) {
    return (
      <section aria-label="user-dashboard">
        <h2>My bots</h2>
        <p data-testid="user-empty">No bots yet — your operator will set one up for you.</p>
      </section>
    )
  }

  return (
    <section aria-label="user-dashboard">
      <h2>My bots</h2>
      {view.bots.map(b => {
        const live = b.exchange_environment === 'mainnet'
        const canPause = b.bot_status !== 'paused' || b.trading_enabled
        return (
          <article key={b.id} aria-label={`bot-${b.trading_pair}`} data-testid={`bot-${b.id}`}>
            <h3>{b.name} — {b.trading_pair}</h3>
            <ul>
              <li>status: {b.bot_status}{b.trading_enabled ? ' (trading enabled)' : ''}</li>
              <li data-testid="env-badge">
                environment: <strong>{live ? 'LIVE (real funds)' : (b.exchange_environment ?? 'unknown')}</strong>
              </li>
              <li>caps (per-order / daily): {b.max_order_notional_usdt ?? '—'} / {b.daily_notional_cap_usdt ?? '—'} USDT</li>
              <li>position: {b.open_qty} (cost basis {b.cost_basis_usdt} USDT)</li>
              {b.last_block_reason && (
                <li data-testid="block-reason">last blocked: {friendlyBlockReason(b.last_block_reason)}</li>
              )}
            </ul>

            <table>
              <thead><tr><th>Side</th><th>Status</th><th>Notional (USDT)</th><th>When</th></tr></thead>
              <tbody>
                {b.recent_trades.map((t, i) => (
                  <tr key={i}>
                    <td>{t.side}</td>
                    <td>{t.status}</td>
                    <td>{t.executed_notional_usdt ?? t.requested_notional_usdt ?? '—'}</td>
                    <td>{t.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {canPause && (
              <button
                type="button" data-testid={`pause-${b.id}`} disabled={busy === b.id}
                onClick={() => { void onPause(b.id) }}
              >
                {busy === b.id ? 'Pausing…' : 'Pause my bot'}
              </button>
            )}
          </article>
        )
      })}
    </section>
  )
}
