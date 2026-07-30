import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserDashboard } from './UserDashboard'
import type { UserDashboardBot } from '../lib/userDashboard'

function bot(overrides: Partial<UserDashboardBot> = {}): UserDashboardBot {
  return {
    id: 'b1', name: 'My BTC', trading_pair: 'BTCUSDT', bot_status: 'active', trading_enabled: true,
    sizing_mode: 'fixed_notional', fixed_notional_usdt: 12, max_order_notional_usdt: 13, daily_notional_cap_usdt: 13,
    sell_enabled: false, exchange_environment: 'mainnet', credential_status: 'valid',
    open_qty: 0, cost_basis_usdt: 0, last_block_reason: 'insufficient_quote_balance',
    recent_trades: [{ side: 'buy', status: 'filled', requested_notional_usdt: 12, executed_notional_usdt: 12,
                      created_at: '2026-07-16T12:00:00Z', filled_at: '2026-07-16T12:00:01Z' }],
    ...overrides,
  }
}

describe('UserDashboard', () => {
  test('renders own bot with LIVE badge, caps, friendly block reason', async () => {
    render(<UserDashboard loadBots={() => Promise.resolve([bot()])} pause={vi.fn()} />)
    expect(await screen.findByText('My BTC — BTCUSDT')).toBeInTheDocument()
    expect(screen.getByTestId('env-badge')).toHaveTextContent('LIVE (real funds)')
    expect(screen.getByText(/13 \/ 13 USDT/)).toBeInTheDocument()
    expect(screen.getByTestId('block-reason')).toHaveTextContent('insufficient balance')
  })

  test('empty → friendly notice', async () => {
    render(<UserDashboard loadBots={() => Promise.resolve([])} pause={vi.fn()} />)
    expect(await screen.findByTestId('user-empty')).toBeInTheDocument()
  })

  test('42501 → sign-in notice', async () => {
    render(<UserDashboard loadBots={() => Promise.reject({ code: '42501' })} pause={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in/i)
  })

  test('Pause my bot calls pause with the bot id', async () => {
    const pause = vi.fn().mockResolvedValue({ ok: true })
    render(<UserDashboard loadBots={() => Promise.resolve([bot()])} pause={pause} />)
    fireEvent.click(await screen.findByTestId('pause-b1'))
    await waitFor(() => expect(pause).toHaveBeenCalledWith('b1'))
  })

  test('already paused+disabled bot → no pause button', async () => {
    render(<UserDashboard loadBots={() => Promise.resolve([bot({ bot_status: 'paused', trading_enabled: false })])} pause={vi.fn()} />)
    await screen.findByText('My BTC — BTCUSDT')
    expect(screen.queryByTestId('pause-b1')).not.toBeInTheDocument()
  })

  test('never renders secret substrings', async () => {
    const { container } = render(<UserDashboard loadBots={() => Promise.resolve([bot()])} pause={vi.fn()} />)
    await screen.findByText('My BTC — BTCUSDT')
    expect(container.innerHTML).not.toMatch(/vault_secret_id|webhook_secret_hash|api_key|api_secret|service_role|pepper/i)
  })
})
