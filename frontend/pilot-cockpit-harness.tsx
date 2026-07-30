// DEV HARNESS (uncommitted) — visually verify the ST-1 PilotCockpit with MOCKED read RPCs.
// No network, NO live operator_status / operator_pilot_fleet. Run: `npm run dev` → open
// /pilot-cockpit-harness.html. Outside src/ so it never affects tsc (include=["src"]), vitest, or build.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './src/styles.css'
import { PilotCockpit } from './src/components/PilotCockpit'
import type { OperatorStatus } from './src/lib/status'
import type { PilotBot } from './src/lib/pilot'

const NOW = Date.now()

// Mocked operator_status() — worker cold (matches the current stood-down posture).
const status: OperatorStatus = {
  bots: [], enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, kill_rpc_present: true,
  worker_status: {
    queue_enabled: false, is_production: false, worker_state: 'disabled',
    boot_stuck_count: 0, updated_at: new Date(NOW - 18_000).toISOString(),
  },
}

// Mocked operator_pilot_fleet() — fingerprints only, no secrets.
const fleet: PilotBot[] = [
  { id: 'bot-btc', user_id: '66e1b075-930e-4a20', trading_pair: 'BTCUSDT', bot_status: 'paused',
    trading_enabled: false, exchange_environment: 'mainnet', credential_fingerprint: '1164c49b',
    fixed_notional_usdt: 12, max_order_notional_usdt: 13, daily_notional_cap_usdt: 13, sell_enabled: false,
    last_trade_at: null, last_trade_status: 'filled', last_block_reason: 'insufficient_quote_balance' },
  { id: 'bot-eth', user_id: 'aa11bb22-cccc', trading_pair: 'ETHUSDT', bot_status: 'active',
    trading_enabled: true, exchange_environment: 'testnet', credential_fingerprint: '5085363c',
    fixed_notional_usdt: 20, max_order_notional_usdt: 25, daily_notional_cap_usdt: 100, sell_enabled: false,
    last_trade_at: null, last_trade_status: 'filled', last_block_reason: null },
]

createRoot(document.getElementById('cockpit-root')!).render(
  <StrictMode>
    <div className="app-shell" style={{ padding: 16, maxWidth: 960, margin: '0 auto' }}>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        MOCK HARNESS — read RPCs stubbed (no network). Visual check of ST-1 PilotCockpit only.
      </p>
      <PilotCockpit loadStatus={() => Promise.resolve(status)} loadFleet={() => Promise.resolve(fleet)} />
    </div>
  </StrictMode>,
)
