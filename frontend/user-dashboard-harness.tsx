// DEV HARNESS (uncommitted) — visually verify the ST-2 UserDashboard with MOCKED read/pause RPCs.
// No network. Run: `npm run dev` → open /user-dashboard-harness.html. Outside src/ so it never affects
// tsc (include=["src"]), vitest, or build.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './src/styles.css'
import { UserDashboard } from './src/components/UserDashboard'
import type { UserDashboardBot } from './src/lib/userDashboard'

const bots: UserDashboardBot[] = [
  { id: 'b1', name: 'My BTC strategy', trading_pair: 'BTCUSDT', bot_status: 'paused', trading_enabled: false,
    sizing_mode: 'fixed_notional', fixed_notional_usdt: 12, max_order_notional_usdt: 13, daily_notional_cap_usdt: 13,
    sell_enabled: false, exchange_environment: 'mainnet', credential_status: 'valid',
    open_qty: 0, cost_basis_usdt: 0, last_block_reason: 'insufficient_quote_balance',
    recent_trades: [
      { side: 'buy', status: 'failed', requested_notional_usdt: 12, executed_notional_usdt: null,
        created_at: '2026-07-16 12:03Z', filled_at: null },
    ] },
]

createRoot(document.getElementById('user-root')!).render(
  <StrictMode>
    <div className="app-shell" style={{ padding: 16, maxWidth: 820, margin: '0 auto' }}>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        MOCK HARNESS — read/pause RPCs stubbed (no network). Visual check of ST-2 UserDashboard only.
      </p>
      <UserDashboard
        loadBots={() => Promise.resolve(bots)}
        pause={async (id) => { console.log('mock pause', id); return { ok: true } }}
      />
    </div>
  </StrictMode>,
)
