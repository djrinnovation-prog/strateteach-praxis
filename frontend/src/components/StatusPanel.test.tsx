import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StatusPanel } from './StatusPanel'
import type { OperatorStatus } from '../lib/status'
import type { KillResult } from '../lib/actions'

const NOW = 1_750_000_000_000

function payload(overrides: Partial<OperatorStatus> = {}): OperatorStatus {
  return {
    bots: [
      { id: 'bot-btc', trading_pair: 'BTCUSDT', bot_status: 'active', trading_enabled: false,
        sizing_mode: 'fixed_notional', exchange_environment: 'testnet', credential_status: 'valid',
        credential_ok: true, credential_shared: false, shared_with_count: 0,
        config_ready: true, execution_ready: false },
    ],
    enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, kill_rpc_present: true,
    worker_status: { queue_enabled: false, is_production: false, worker_state: 'disabled',
                     boot_stuck_count: 0, updated_at: new Date(NOW - 5_000).toISOString() },
    ...overrides,
  }
}

describe('StatusPanel', () => {
  test('operator payload (fresh) → renders bots + counts + execution_ready, no DEGRADED banner', async () => {
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} now={() => NOW} />)
    expect(await screen.findByText('BTCUSDT')).toBeInTheDocument()
    expect(screen.getByText(/enabled_bots: 0/)).toBeInTheDocument()
    // execution_ready cell present (false) — readiness is surfaced
    expect(screen.getByRole('table')).toHaveTextContent('Execution ready')
    expect(screen.queryByTestId('degraded-banner')).not.toBeInTheDocument()
  })

  test('stale worker_status → DEGRADED banner', async () => {
    const stale = payload({ worker_status: { queue_enabled: false, is_production: false,
      worker_state: 'disabled', boot_stuck_count: 0, updated_at: new Date(NOW - 200_000).toISOString() } })
    render(<StatusPanel loadStatus={() => Promise.resolve(stale)} now={() => NOW} />)
    expect(await screen.findByTestId('degraded-banner')).toBeInTheDocument()
  })

  test('missing worker_status → DEGRADED banner', async () => {
    render(<StatusPanel loadStatus={() => Promise.resolve(payload({ worker_status: null }))} now={() => NOW} />)
    expect(await screen.findByTestId('degraded-banner')).toBeInTheDocument()
  })

  test('RPC rejects 42501 → "operator access required", no data rows', async () => {
    render(<StatusPanel loadStatus={() => Promise.reject({ code: '42501', message: 'operator_status: forbidden' })} />)
    expect(await screen.findByText(/operator access required/i)).toBeInTheDocument()
    expect(screen.queryByText('BTCUSDT')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('RPC network error → DEGRADED/error state, no crash, no data', async () => {
    render(<StatusPanel loadStatus={() => Promise.reject(new Error('Failed to fetch'))} />)
    expect(await screen.findByText(/DEGRADED — status unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText('BTCUSDT')).not.toBeInTheDocument()
  })

  test('read-only variant (no killAll) → no kill control, no buttons at all', async () => {
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} now={() => NOW} />)
    await screen.findByText('BTCUSDT')
    expect(screen.queryByTestId('kill-controls')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

const killResult = (o: Partial<KillResult> = {}): KillResult => ({
  ok: true, kill_applied: true, requires_attention: false, operational_state: 'SAFE',
  enabled_bots_after: 0, open_trades: 0, queue_length: 0, worker_state: 'disabled',
  worker_updated_at: new Date(NOW).toISOString(), audit_id: 'aud-1', message: 'clean', ...o,
})

describe('StatusPanel — guarded kill', () => {
  test('kill button appears only when killAll is provided; confirm disabled until "KILL" typed', async () => {
    const killAll = vi.fn().mockResolvedValue(killResult())
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    const confirm = screen.getByTestId('kill-confirm') as HTMLButtonElement
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'nope' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'KILL' } })
    expect(confirm).toBeEnabled()
    expect(killAll).not.toHaveBeenCalled()   // nothing fired before confirm
  })

  test('confirmed clean kill → SAFE result, passes typed reason, defaulting handled by helper', async () => {
    const killAll = vi.fn().mockResolvedValue(killResult())
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    fireEvent.change(screen.getByTestId('kill-reason'), { target: { value: 'ops drill' } })
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'KILL' } })
    fireEvent.click(screen.getByTestId('kill-confirm'))
    expect(await screen.findByTestId('kill-clean')).toBeInTheDocument()
    expect(killAll).toHaveBeenCalledWith('ops drill')
    expect(screen.getByTestId('kr-enabled-after')).toHaveTextContent('enabled_bots_after: 0')
  })

  test('ATTENTION result (open trades + queue) → alert, ok=false surfaced, details rendered', async () => {
    const killAll = vi.fn().mockResolvedValue(killResult({
      ok: false, requires_attention: true, operational_state: 'ATTENTION',
      open_trades: 2, queue_length: 3, message: 'ATTENTION: 2 open trade(s); 3 queued message(s)',
    }))
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'KILL' } })
    fireEvent.click(screen.getByTestId('kill-confirm'))
    const attn = await screen.findByTestId('kill-attention')
    expect(attn).toHaveTextContent(/ATTENTION/)
    expect(screen.queryByTestId('kill-clean')).not.toBeInTheDocument()
    expect(screen.getByTestId('kr-open-trades')).toHaveTextContent('open_trades: 2')
    expect(screen.getByTestId('kr-queue')).toHaveTextContent('queue_length: 3')
  })

  test('telemetry failure (queue_length null, worker_state null) → shows read-failed / unavailable', async () => {
    const killAll = vi.fn().mockResolvedValue(killResult({
      ok: false, requires_attention: true, operational_state: 'ATTENTION',
      queue_length: null, worker_state: null, message: 'Telemetry incomplete',
    }))
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'KILL' } })
    fireEvent.click(screen.getByTestId('kill-confirm'))
    await screen.findByTestId('kill-attention')
    expect(screen.getByTestId('kr-queue')).toHaveTextContent(/read failed/i)
    expect(screen.getByTestId('kr-worker')).toHaveTextContent(/unavailable/i)
  })

  test('42501 denial → operator access required, no result', async () => {
    const killAll = vi.fn().mockRejectedValue({ code: '42501', message: 'operator_kill_all: forbidden' })
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'KILL' } })
    fireEvent.click(screen.getByTestId('kill-confirm'))
    expect(await screen.findByTestId('kill-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('kill-result')).not.toBeInTheDocument()
  })

  test('22023 invalid reason → invalid notice, no result', async () => {
    const killAll = vi.fn().mockRejectedValue({ code: '22023', message: 'operator_kill_all: invalid reason' })
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    fireEvent.change(screen.getByTestId('kill-confirm-input'), { target: { value: 'KILL' } })
    fireEvent.click(screen.getByTestId('kill-confirm'))
    expect(await screen.findByTestId('kill-invalid')).toBeInTheDocument()
  })

  test('cancel from confirm returns to idle (no kill fired)', async () => {
    const killAll = vi.fn().mockResolvedValue(killResult())
    render(<StatusPanel loadStatus={() => Promise.resolve(payload())} killAll={killAll} now={() => NOW} />)
    fireEvent.click(await screen.findByTestId('kill-button'))
    fireEvent.click(screen.getByTestId('kill-cancel'))
    expect(await screen.findByTestId('kill-button')).toBeInTheDocument()
    expect(killAll).not.toHaveBeenCalled()
  })
})
