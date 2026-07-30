import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import harnessPanelSource from './HarnessPanel.tsx?raw'   // raw source for the no-mutation-import check
import { HarnessPanel } from './HarnessPanel'
import type { OperatorStatus } from '../lib/status'
import type { BuildInfo } from '../lib/buildinfo'

const STATUS: OperatorStatus = {
  bots: [{ id: 'b1', trading_pair: 'BTCUSDT', bot_status: 'active', trading_enabled: false,
           sizing_mode: 'fixed_notional', exchange_environment: 'testnet', credential_status: 'valid',
           credential_ok: true, credential_shared: false, shared_with_count: 0,
           config_ready: true, execution_ready: false }],
  enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, kill_rpc_present: true,
  worker_status: { queue_enabled: false, is_production: false, worker_state: 'disabled', boot_stuck_count: 0,
                   updated_at: '2026-07-09T00:00:00Z' },
}
const BUILD: BuildInfo = { killEnabled: false, harnessEnabled: true, buildCommit: 'unknown', deployedBundle: 'index-x.js' }

function renderPanel(over: Partial<{ loadStatus: () => Promise<OperatorStatus> }> = {}) {
  return render(
    <HarnessPanel
      loadStatus={over.loadStatus ?? (() => Promise.resolve(STATUS))}
      getBuild={() => Promise.resolve(BUILD)}
      now={() => 0}
    />,
  )
}

const ALLOWED = new Set([
  'Refresh read-back', 'Capture baseline', 'Verify', 'Check disarmed',
  'Generate restore draft', 'Copy evidence', 'Download evidence', 'Download restore draft',
])

describe('HarnessPanel — read-only controls only', () => {
  const FORBIDDEN_EXACT = ['Restore', 'Run', 'Apply', 'Execute', 'Kill']

  test('every button is an allowed control; no EXACT action label (Restore/Run/Apply/Execute/Kill); draft labels allowed', async () => {
    renderPanel()
    const panel = await screen.findByTestId('harness-panel')
    const labels = within(panel).getAllByRole('button').map(b => b.textContent?.trim() ?? '')
    expect(labels.length).toBe(8)
    for (const l of labels) expect(ALLOWED.has(l)).toBe(true)               // whitelist
    // exact-label (not substring) rejection — the two approved draft labels are allowed:
    for (const f of FORBIDDEN_EXACT) expect(labels).not.toContain(f)
    expect(labels).toContain('Generate restore draft')
    expect(labels).toContain('Download restore draft')
  })

  test('preflight renders a verdict + surfaces the kill UI flag state', async () => {
    renderPanel()
    expect(await screen.findByTestId('h-preflight')).toHaveTextContent(/Preflight: (PASS|ATTENTION)/)
    expect(screen.getByTestId('h-kill-flag')).toHaveTextContent(/kill UI flag: OFF/)   // default build killEnabled=false
  })

  test('killEnabled=true (default expectations) → ATTENTION and kill flag visibly ON', async () => {
    render(
      <HarnessPanel
        loadStatus={() => Promise.resolve(STATUS)}
        getBuild={() => Promise.resolve({ ...BUILD, killEnabled: true })}
        now={() => 0}
      />,
    )
    expect(await screen.findByTestId('h-preflight')).toHaveTextContent('Preflight: ATTENTION')
    expect(screen.getByTestId('h-kill-flag')).toHaveTextContent(/kill UI flag: ON/)
    expect(screen.getByTestId('h-kill-flag')).toHaveTextContent(/ATTENTION: kill UI armed/)
  })

  test('Copy/Download evidence disabled until a run artifact exists (no silent empty copy)', async () => {
    renderPanel()
    await screen.findByTestId('harness-panel')
    expect(screen.getByTestId('h-copy-ev')).toBeDisabled()
    expect(screen.getByTestId('h-dl-ev')).toBeDisabled()
    fireEvent.click(screen.getByTestId('h-baseline'))       // now there is evidence
    expect(screen.getByTestId('h-copy-ev')).toBeEnabled()
    expect(screen.getByTestId('h-dl-ev')).toBeEnabled()
  })

  test('capture baseline → verify → check disarmed produce read-backs', async () => {
    renderPanel()
    await screen.findByTestId('harness-panel')
    fireEvent.click(screen.getByTestId('h-baseline'))
    expect(screen.getByTestId('h-baseline-info')).toHaveTextContent('1 bot(s)')
    fireEvent.click(screen.getByTestId('h-verify'))
    expect(screen.getByTestId('h-verify-result')).toHaveTextContent('verify: PASS')  // current == baseline
    fireEvent.click(screen.getByTestId('h-disarmed'))
    expect(screen.getByTestId('h-disarmed-result')).toHaveTextContent('disarmed: GREEN')
  })

  test('generate restore draft → rendered draft is NON-EXECUTABLE (watermark + review line + all lines commented)', async () => {
    renderPanel()
    await screen.findByTestId('harness-panel')
    fireEvent.click(screen.getByTestId('h-baseline'))
    fireEvent.click(screen.getByTestId('h-gen-draft'))
    const draft = screen.getByTestId('h-draft').textContent ?? ''
    expect(draft).toMatch(/NOT EXECUTABLE — TEMPLATE ONLY/)
    expect(draft).toMatch(/REQUIRES SEPARATE CODEX REVIEW BEFORE EXECUTION/)
    const nonBlank = draft.split('\n').filter(l => l.trim().length > 0)
    expect(nonBlank.filter(l => !l.trimStart().startsWith('--'))).toEqual([])   // structurally commented
  })

  test('verify / generate-draft disabled until a baseline is captured', async () => {
    renderPanel()
    await screen.findByTestId('harness-panel')
    expect(screen.getByTestId('h-verify')).toBeDisabled()
    expect(screen.getByTestId('h-gen-draft')).toBeDisabled()
  })

  test('42501 → operator access required, no panel', async () => {
    renderPanel({ loadStatus: () => Promise.reject({ code: '42501', message: 'operator_status: forbidden' }) })
    expect(await screen.findByText(/operator access required/i)).toBeInTheDocument()
    expect(screen.queryByTestId('harness-panel')).not.toBeInTheDocument()
  })
})

describe('HarnessPanel stays read-only', () => {
  test('source does not import actions.ts / any kill RPC', () => {
    expect(harnessPanelSource).not.toMatch(/from\s+['"]\.\.\/lib\/actions['"]/)
    expect(harnessPanelSource).not.toMatch(/operatorKillAll|operator_kill_all/)
  })
})
