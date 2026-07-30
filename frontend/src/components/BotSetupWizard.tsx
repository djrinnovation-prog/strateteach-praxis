// BotSetupWizard.tsx — user-facing bot setup SHELL (UI-1) + the live TradingView token step (UI-3a).
// Every step is rendered LOCKED/disabled with copy explaining which reviewed backend RPC/gate unlocks it,
// EXCEPT Step 4 (Connect TradingView), which mounts the live TradingViewConnect ONLY when `tv.enabled`
// (a default-OFF feature flag) AND the user has at least one bot. That path wires token rotation to the
// deployed owner-gated `rotate-bot-webhook-token` Edge fn.
// SAFETY (hard): still renders NO exchange-secret input field and makes NO Binance call; "Activate" is
// permanently disabled with no handler. When Step 4 is live, the webhook token is generated in
// TradingViewConnect, shown once, and never persisted (see that component); the test-signal is a stub.
import { useState } from 'react'
import type { BotStatus } from '../lib/status'
import { TradingViewConnect } from './TradingViewConnect'
import type { RotateResult, UserBot } from '../lib/tradingview'

/** Live wiring for the TradingView token step. When `enabled` is false (default) Step 4 stays locked. */
export interface TvWiring {
  enabled: boolean
  webhookBase: string
  bots: UserBot[]
  rotate: (botId: string, token: string) => Promise<RotateResult>
}

interface Step {
  n: number
  title: string
  body: string
  /** What must exist/pass before this step can do anything real. */
  unlock: string
}

const STEPS: Step[] = [
  { n: 1, title: 'Create Bot', body: 'Name the bot and choose a trading pair. A Praxis webhook token is issued server-side (shown once).', unlock: 'Needs the reviewed create_bot RPC (G1). Locked.' },
  { n: 2, title: 'Connect Exchange', body: 'Attach a trade-only, withdrawal-disabled exchange key, IP-restricted to the Praxis egress IPs.', unlock: 'The API secret is never entered in the browser — it goes to a server-side Vault path (G2, gated on A4). No secret field is shown here. Locked.' },
  { n: 3, title: 'Validate Credential', body: 'Praxis performs a server-side, read-only exchange check (no orders) and marks the credential valid.', unlock: 'Needs the reviewed start_credential_validation RPC (G3). Locked.' },
  { n: 4, title: 'Connect TradingView', body: 'Copy the Praxis webhook URL + alert-message template into a TradingView alert. No strategy edits.', unlock: 'Display-only preview; the one-time token comes from create_bot (G1). No live alert is activated here. Locked.' },
  { n: 5, title: 'Risk Limits', body: 'Set sizing (percent or fixed notional), per-order max, and a daily cap. Fail-closed if incomplete.', unlock: 'Needs the reviewed set_bot_risk_config RPC (G4). Locked.' },
  { n: 6, title: 'Review + Activate', body: 'Review the configuration and activate on testnet. Mainnet activation stays locked behind the gates.', unlock: 'Needs the guarded set_bot_status RPC (G5); mainnet activation is locked until A1/A4/4A/4C/A11. The activate control below is disabled and cannot execute. Locked.' },
]

export function BotSetupWizard({ bots, tv }: { bots?: BotStatus[]; tv?: TvWiring }) {
  // Live Step-4 wiring is active only when the flag is ON and the user actually has a bot to connect.
  const tvLive = !!tv?.enabled && tv.bots.length > 0
  const [tvBotId, setTvBotId] = useState<string>(tvLive ? tv!.bots[0].id : '')

  return (
    <section aria-label="bot-setup-wizard" className="card" data-testid="bot-setup-wizard">
      <h2>Bot setup</h2>
      <p className="hint">
        A guided setup: create a bot, connect your exchange and TradingView, set risk limits, then activate.
        This is a preview shell — each step unlocks only when its reviewed Praxis backend is in place. Nothing
        here calls the exchange, stores a secret, or can place an order.
      </p>

      {bots && bots.length > 0 && (
        <div style={{ margin: '10px 0 16px' }}>
          <h3>Your bots</h3>
          <table>
            <thead><tr><th>Pair</th><th>Status</th><th>Env</th><th>Credential OK</th><th>Config ready</th></tr></thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id}>
                  <td>{b.trading_pair}</td>
                  <td>{b.bot_status}</td>
                  <td>{b.exchange_environment ?? '—'}</td>
                  <td>{String(b.credential_ok)}</td>
                  <td>{String(b.config_ready)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="stepper" data-testid="wizard-steps">
        {STEPS.map((s) => {
          // Step 4 goes LIVE (TradingViewConnect) only when the flag is on AND the user has a bot.
          if (s.n === 4 && tvLive) {
            const selected = tv!.bots.find((b) => b.id === tvBotId) ?? tv!.bots[0]
            return (
              <div key={s.n} className="step" data-testid="wizard-step-4">
                <div className="step-head">
                  <span className="step-num">4</span>
                  <span className="step-title">{s.title}</span>
                </div>
                {tv!.bots.length > 1 && (
                  <label className="hint" style={{ display: 'block', margin: '8px 0' }}>
                    Bot&nbsp;
                    <select
                      data-testid="tv-bot-select"
                      value={selected.id}
                      onChange={(e) => setTvBotId(e.target.value)}
                    >
                      {tv!.bots.map((b) => (
                        <option key={b.id} value={b.id}>{b.trading_pair} ({b.status})</option>
                      ))}
                    </select>
                  </label>
                )}
                {/* tokenSet=true always: bots.webhook_secret_hash is NOT NULL, so this is always a ROTATE.
                    `rotate` is wired to G-TVR; `sendTest` is intentionally omitted → stub/disabled (no G-TVT yet). */}
                <TradingViewConnect
                  key={selected.id}
                  botId={selected.id}
                  tokenSet
                  webhookBase={tv!.webhookBase}
                  rotate={tv!.rotate}
                />
              </div>
            )
          }
          return (
            <div key={s.n} className="step locked" data-testid={`wizard-step-${s.n}`}>
              <div className="step-head">
                <span className="step-num">{s.n}</span>
                <span className="step-title">{s.title}</span>
                <span className="badge locked" data-testid={`step-lock-${s.n}`}>Locked</span>
              </div>
              <div className="step-body">{s.body}</div>
              <div className="lock-copy" data-testid={`step-unlock-${s.n}`}>{s.unlock}</div>
            </div>
          )
        })}
      </div>

      {/* Activate control is permanently disabled and has NO handler — it cannot execute anything. */}
      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn" data-testid="activate-button" disabled aria-disabled="true">
          Activate bot (locked)
        </button>
        <p className="hint" data-testid="activate-lock-copy" style={{ marginTop: 8 }}>
          Activation is disabled until the reviewed backend and the production gates (A1/A4/4A/4C/A11) are complete.
          Mainnet / real funds are NO-GO.
        </p>
      </div>
    </section>
  )
}
