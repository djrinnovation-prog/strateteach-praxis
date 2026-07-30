import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import { BotSetupWizard, type TvWiring } from './BotSetupWizard'
import type { BotStatus } from '../lib/status'
import type { UserBot } from '../lib/tradingview'

const USER_BOTS: UserBot[] = [
  { id: '11111111-1111-4111-8111-111111111111', trading_pair: 'BTCUSDT', status: 'active' },
  { id: '22222222-2222-4222-8222-222222222222', trading_pair: 'ETHUSDT', status: 'paused' },
]
function tvWiring(over: Partial<TvWiring> = {}): TvWiring {
  return {
    enabled: true,
    webhookBase: 'https://example.supabase.co',
    bots: USER_BOTS,
    rotate: vi.fn().mockResolvedValue({ ok: true, new_fp: 'aaaaaaaa..bbbbbbbb' }),
    ...over,
  }
}

describe('BotSetupWizard (locked setup shell)', () => {
  test('renders all 6 steps, each locked', () => {
    render(<BotSetupWizard />)
    for (let n = 1; n <= 6; n++) {
      expect(screen.getByTestId(`wizard-step-${n}`)).toBeInTheDocument()
      expect(screen.getByTestId(`step-lock-${n}`)).toHaveTextContent('Locked')
    }
  })

  test('renders NO secret input field (no inputs at all in the shell)', () => {
    const { container } = render(<BotSetupWizard />)
    expect(container.querySelectorAll('input').length).toBe(0)
    expect(container.querySelectorAll('input[type="password"]').length).toBe(0)
  })

  test('activate control is disabled and cannot execute', () => {
    render(<BotSetupWizard />)
    const btn = screen.getByTestId('activate-button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-disabled', 'true')
  })

  test('connect-exchange step states the secret is never entered in the browser', () => {
    render(<BotSetupWizard />)
    expect(screen.getByTestId('step-unlock-2')).toHaveTextContent(/never entered in the browser/i)
  })

  test('review step discloses mainnet activation is locked behind the gates', () => {
    render(<BotSetupWizard />)
    expect(screen.getByTestId('step-unlock-6')).toHaveTextContent(/A1\/A4\/4A\/4C\/A11/)
  })

  test('optional read-only bots summary renders when provided (still no inputs)', () => {
    const bots: BotStatus[] = [{
      id: 'b1', trading_pair: 'BTCUSDT', bot_status: 'active', trading_enabled: false, sizing_mode: null,
      exchange_environment: 'testnet', credential_status: 'valid', credential_ok: true,
      credential_shared: false, shared_with_count: 0, config_ready: true, execution_ready: false,
    }]
    const { container } = render(<BotSetupWizard bots={bots} />)
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument()
    expect(container.querySelectorAll('input').length).toBe(0)
  })
})

describe('BotSetupWizard — live TradingView step (UI-3a, flag-gated)', () => {
  test('flag OFF → Step 4 stays LOCKED even with bots', () => {
    render(<BotSetupWizard tv={tvWiring({ enabled: false })} />)
    expect(screen.getByTestId('step-lock-4')).toHaveTextContent('Locked')
    expect(screen.queryByTestId('tradingview-connect')).not.toBeInTheDocument()
  })

  test('flag ON but NO bots → Step 4 stays LOCKED', () => {
    render(<BotSetupWizard tv={tvWiring({ bots: [] })} />)
    expect(screen.getByTestId('step-lock-4')).toHaveTextContent('Locked')
    expect(screen.queryByTestId('tradingview-connect')).not.toBeInTheDocument()
  })

  test('flag ON + bots → Step 4 mounts TradingViewConnect (with a bot selector for >1 bot)', () => {
    render(<BotSetupWizard tv={tvWiring()} />)
    expect(screen.getByTestId('tradingview-connect')).toBeInTheDocument()
    expect(screen.queryByTestId('step-lock-4')).not.toBeInTheDocument() // step 4 no longer locked
    expect(screen.getByTestId('tv-bot-select')).toBeInTheDocument()      // 2 bots → selector
    // Other steps remain locked.
    expect(screen.getByTestId('step-lock-1')).toHaveTextContent('Locked')
    expect(screen.getByTestId('step-lock-6')).toHaveTextContent('Locked')
  })

  test('rotate is wired to G-TVR: rotate→warn→confirm calls tv.rotate with (botId, a TOKEN_RE token), token shown once', async () => {
    const tv = tvWiring()
    render(<BotSetupWizard tv={tv} />)
    // Existing bots always have a token (hash NOT NULL) → the action is a ROTATE (warns first).
    fireEvent.click(screen.getByTestId('tv-generate'))
    fireEvent.click(screen.getByTestId('tv-warn-confirm'))
    await waitFor(() => expect(tv.rotate).toHaveBeenCalledTimes(1))
    const [botId, token] = (tv.rotate as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(botId).toBe(USER_BOTS[0].id)
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)          // client-generated, server TOKEN_RE shape
    // Revealed once; the value must be the plaintext just generated (component memory only).
    await waitFor(() => expect(screen.getByTestId('tv-token-value')).toHaveTextContent(token))
  })

  test('test-signal is stubbed/disabled (no safe backend wired)', () => {
    render(<BotSetupWizard tv={tvWiring()} />)
    expect(screen.getByTestId('tv-test')).toBeDisabled()
  })
})
