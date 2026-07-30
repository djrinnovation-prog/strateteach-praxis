import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { App } from './App'

function mockClient(session: unknown): SupabaseClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    rpc: vi.fn(),
  } as unknown as SupabaseClient
}

describe('App auth gate', () => {
  test('unauthenticated (no session) → renders Login', async () => {
    render(<App client={mockClient(null)} />)
    expect(await screen.findByLabelText('operator-login')).toBeInTheDocument()
    expect(screen.getByLabelText('Operator email')).toBeInTheDocument()
  })

  function authedClient() {
    const client = mockClient({ user: { id: 'u1' } })
    ;(client.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { bots: [], enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, worker_status: null },
      error: null,
    })
    return client
  }

  test('authenticated, kill flag OFF (default) → read-only console, NO kill button', async () => {
    render(<App client={authedClient()} />)   // killEnabled defaults to env flag → OFF in tests
    expect(await screen.findByText(/Operator Console \(read-only\)/)).toBeInTheDocument()
    expect(screen.queryByLabelText('operator-login')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kill-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kill-controls')).not.toBeInTheDocument()
  })

  test('authenticated, kill flag ON → kill control wired, header not read-only', async () => {
    render(<App client={authedClient()} killEnabled />)
    expect(await screen.findByTestId('kill-button')).toBeInTheDocument()
    expect(screen.getByText('Praxis — Operator Console')).toBeInTheDocument()
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('operator-login')).not.toBeInTheDocument()
  })

  test('harness flag OFF (default) → no harness panel; kill flag behavior unchanged', async () => {
    render(<App client={authedClient()} />)
    await screen.findByText(/Operator Console/)
    expect(screen.queryByTestId('harness-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kill-button')).not.toBeInTheDocument()   // kill still OFF by default
  })

  test('harness flag ON → harness panel present (independent of kill flag)', async () => {
    render(<App client={authedClient()} harnessEnabled />)
    expect(await screen.findByTestId('harness-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('kill-button')).not.toBeInTheDocument()   // kill flag still OFF
  })

  test('pilot flag OFF (default) → no Pilot cockpit tab', async () => {
    render(<App client={authedClient()} />)
    await screen.findByText(/Operator Console/)
    expect(screen.queryByRole('button', { name: 'Pilot cockpit' })).not.toBeInTheDocument()
  })

  // With pilot routing, an OPERATOR (operator_status succeeds) keeps the operator shell + cockpit tab.
  test('pilot flag ON + operator → operator shell with Pilot cockpit tab (renders cockpit)', async () => {
    const client = mockClient({ user: { id: 'op1' } })
    ;(client.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
      name === 'operator_pilot_fleet'
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({
            data: { bots: [], enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, worker_status: null },
            error: null,
          }),
    )
    render(<App client={client} pilotEnabled />)
    const tab = await screen.findByRole('button', { name: 'Pilot cockpit' })
    fireEvent.click(tab)
    expect(await screen.findByLabelText('pilot-cockpit')).toBeInTheDocument()
    expect(screen.queryByLabelText('user-dashboard')).not.toBeInTheDocument()
  })

  // A NON-operator (operator_status → 42501) sees ONLY the user dashboard — never the operator console.
  test('pilot flag ON + non-operator → ONLY user dashboard, no operator console', async () => {
    const client = mockClient({ user: { id: 'u1' } })
    ;(client.rpc as unknown as ReturnType<typeof vi.fn>).mockImplementation((name: string) =>
      name === 'user_bot_dashboard'
        ? Promise.resolve({ data: [], error: null })
        : Promise.resolve({ data: null, error: { code: '42501', message: 'forbidden' } }),
    )
    render(<App client={client} pilotEnabled />)
    expect(await screen.findByLabelText('user-dashboard')).toBeInTheDocument()
    expect(screen.getByText('StrateTeach — My bots')).toBeInTheDocument()
    expect(screen.queryByText(/Operator Console/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pilot cockpit' })).not.toBeInTheDocument()
  })
})
