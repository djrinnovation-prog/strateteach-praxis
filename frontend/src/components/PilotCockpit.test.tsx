import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PilotCockpit } from './PilotCockpit'
import type { OperatorStatus } from '../lib/status'
import type { PilotBot } from '../lib/pilot'

const NOW = 1_750_000_000_000

function status(overrides: Partial<OperatorStatus> = {}): OperatorStatus {
  return {
    bots: [], enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, kill_rpc_present: true,
    worker_status: { queue_enabled: true, is_production: true, worker_state: 'running',
                     boot_stuck_count: 0, updated_at: new Date(NOW - 20_000).toISOString() },
    ...overrides,
  }
}

function fleet(): PilotBot[] {
  return [{
    id: 'bot-btc', user_id: '66e1b075-aaaa-bbbb', trading_pair: 'BTCUSDT', bot_status: 'paused',
    trading_enabled: false, exchange_environment: 'mainnet', credential_fingerprint: '1164c49b',
    fixed_notional_usdt: 12, max_order_notional_usdt: 13, daily_notional_cap_usdt: 13,
    sell_enabled: false, last_trade_at: null, last_trade_status: 'filled',
    last_block_reason: 'insufficient_quote_balance',
  }]
}

describe('PilotCockpit', () => {
  test('renders LIVE tier + fleet with caps + friendly block reason + worker age', async () => {
    render(<PilotCockpit loadStatus={() => Promise.resolve(status())} loadFleet={() => Promise.resolve(fleet())} now={() => NOW} />)
    expect(await screen.findByText('BTCUSDT')).toBeInTheDocument()
    expect(screen.getByTestId('tier-badge')).toHaveTextContent('LIVE (real funds)')
    expect(screen.getByText('12/13/13')).toBeInTheDocument()
    expect(screen.getByText('insufficient balance')).toBeInTheDocument()
    expect(screen.getByTestId('worker-age')).toHaveTextContent('20s')
    expect(screen.queryByTestId('cockpit-degraded')).not.toBeInTheDocument()
  })

  test('TESTNET tier badge when not production + empty fleet notice', async () => {
    const s = status({ worker_status: { queue_enabled: false, is_production: false, worker_state: 'disabled',
      boot_stuck_count: 0, updated_at: new Date(NOW - 5_000).toISOString() } })
    render(<PilotCockpit loadStatus={() => Promise.resolve(s)} loadFleet={() => Promise.resolve([])} now={() => NOW} />)
    expect(await screen.findByTestId('tier-badge')).toHaveTextContent('TESTNET')
    expect(screen.getByTestId('cockpit-empty')).toBeInTheDocument()
  })

  test('stale worker_status → DEGRADED banner', async () => {
    const s = status({ worker_status: { queue_enabled: true, is_production: true, worker_state: 'running',
      boot_stuck_count: 0, updated_at: new Date(NOW - 200_000).toISOString() } })
    render(<PilotCockpit loadStatus={() => Promise.resolve(s)} loadFleet={() => Promise.resolve(fleet())} now={() => NOW} />)
    expect(await screen.findByTestId('cockpit-degraded')).toBeInTheDocument()
  })

  test('42501 → forbidden notice (no fleet rendered)', async () => {
    render(<PilotCockpit loadStatus={() => Promise.reject({ code: '42501', message: 'forbidden' })}
      loadFleet={() => Promise.resolve([])} now={() => NOW} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Operator access required/)
  })

  test('never renders any secret substring', async () => {
    const { container } = render(<PilotCockpit loadStatus={() => Promise.resolve(status())} loadFleet={() => Promise.resolve(fleet())} now={() => NOW} />)
    await screen.findByText('BTCUSDT')
    expect(container.innerHTML).not.toMatch(/vault_secret_id|webhook_secret_hash|api_key|api_secret|service_role|pepper/i)
  })
})
