// HarnessPanel.tsx — Ops Harness Slice A4. READ-ONLY operator panel. Renders preflight + verifier/disarmed
// read-backs and client-side download/copy controls. It imports ONLY the pure harness generators + buildinfo
// + status types — never actions.ts / any mutation RPC. No button mutates anything; downloads/copies are
// client-side. Rendered by App ONLY when the default-OFF VITE_OPERATOR_HARNESS_ENABLED flag is on.
import { useCallback, useEffect, useState } from 'react'
import { isForbiddenError, type OperatorStatus } from '../lib/status'
import { getBuildInfo, type BuildInfo } from '../lib/buildinfo'
import {
  buildPreflight, captureBaseline, verifyAgainst, verifyDisarmed, generateEvidence, generateRestoreDraft,
  type PreflightResult, type Baseline, type VerifyResult, type DisarmedResult,
} from '../lib/harness'

export interface HarnessPanelProps {
  loadStatus: () => Promise<OperatorStatus>
  /** Injectable build-info reader (defaults to the self-reading getBuildInfo). */
  getBuild?: () => Promise<BuildInfo>
  /** Injectable clock for deterministic run_id/captured_at in tests. */
  now?: () => number
}

type View = 'loading' | 'forbidden' | 'error' | 'ready'

// Client-side text download; a no-op where the platform lacks it (e.g. jsdom) — never throws.
function downloadText(filename: string, text: string): void {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  } catch { /* download unavailable — no-op */ }
}

export function HarnessPanel({ loadStatus, getBuild = getBuildInfo, now = () => Date.now() }: HarnessPanelProps) {
  const [view, setView] = useState<View>('loading')
  const [status, setStatus] = useState<OperatorStatus | null>(null)
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [disarmed, setDisarmed] = useState<DisarmedResult | null>(null)
  const [draft, setDraft] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([loadStatus(), getBuild()])
      setStatus(s)
      setPreflight(buildPreflight(s, b))
      setView('ready')
    } catch (err) {
      setView(isForbiddenError(err) ? 'forbidden' : 'error')
    }
  }, [loadStatus, getBuild])

  useEffect(() => { void refresh() }, [refresh])

  if (view === 'loading') return <p role="status">Loading harness…</p>
  if (view === 'forbidden') return <p role="alert">Operator access required — harness unavailable.</p>
  if (view === 'error') return <p role="alert">Harness read-back unavailable (read error).</p>

  const s = status as OperatorStatus
  // Evidence is only meaningful once a run artifact exists — prevents copying/downloading empty/stale evidence.
  const hasEvidence = Boolean(baseline || verify || disarmed)

  const evidence = () => generateEvidence({
    run_id: baseline?.run_id ?? 'OPS-adhoc',
    preflight: preflight ?? undefined,
    baseline: baseline ?? undefined,
    verify: verify ?? undefined,
    disarmed: disarmed ?? undefined,
  })

  function onCaptureBaseline() {
    const capturedAt = new Date(now()).toISOString()
    setBaseline(captureBaseline(s, { runId: `OPS-${capturedAt}`, capturedAt }))
  }
  function onVerify() {
    if (!baseline) return
    setVerify(verifyAgainst(s, {
      enabled_bots: baseline.enabled_bots,
      bot_ids: baseline.bots.map(x => x.id),
      bot_statuses: Object.fromEntries(baseline.bots.map(x => [x.id, x.status])),
      bot_trading_enabled: Object.fromEntries(baseline.bots.map(x => [x.id, x.trading_enabled])),
    }))
  }
  function onCheckDisarmed() { setDisarmed(verifyDisarmed(s)) }
  function onGenerateDraft() { if (baseline) setDraft(generateRestoreDraft(baseline, s)) }
  function onCopyEvidence() { void navigator.clipboard?.writeText?.(evidence().markdown) }
  function onDownloadEvidence() { downloadText(`evidence-${baseline?.run_id ?? 'adhoc'}.json`, evidence().json) }
  function onDownloadDraft() { if (draft) downloadText(`restore-DRAFT-${baseline?.run_id ?? 'adhoc'}.txt`, draft) }

  return (
    <section aria-label="harness" data-testid="harness-panel">
      <h2>Ops harness (read-only)</h2>

      <div role="group" aria-label="harness-controls">
        <button type="button" data-testid="h-refresh"   onClick={() => { void refresh() }}>Refresh read-back</button>
        <button type="button" data-testid="h-baseline"  onClick={onCaptureBaseline}>Capture baseline</button>
        <button type="button" data-testid="h-verify"    onClick={onVerify}    disabled={!baseline}>Verify</button>
        <button type="button" data-testid="h-disarmed"  onClick={onCheckDisarmed}>Check disarmed</button>
        <button type="button" data-testid="h-gen-draft" onClick={onGenerateDraft} disabled={!baseline}>Generate restore draft</button>
        <button type="button" data-testid="h-copy-ev"   onClick={onCopyEvidence}    disabled={!hasEvidence}>Copy evidence</button>
        <button type="button" data-testid="h-dl-ev"     onClick={onDownloadEvidence} disabled={!hasEvidence}>Download evidence</button>
        <button type="button" data-testid="h-dl-draft"  onClick={onDownloadDraft} disabled={!draft}>Download restore draft</button>
      </div>

      {preflight && (
        <div data-testid="h-preflight">
          <p role={preflight.verdict === 'PASS' ? 'status' : 'alert'}>Preflight: {preflight.verdict}</p>
          <div data-testid="h-deploy">
            <p data-testid="h-kill-flag">
              kill UI flag: <strong>{preflight.deploy.flag_kill_enabled ? 'ON' : 'OFF'}</strong>
              {preflight.deploy.flag_kill_enabled ? ' — ATTENTION: kill UI armed (safe resting state is OFF)' : ''}
            </p>
            <p>harness flag: {preflight.deploy.flag_harness_enabled ? 'ON' : 'OFF'}</p>
            <p>deployed bundle: {preflight.deploy.deployed_bundle}</p>
            <p>built commit: {preflight.deploy.built_commit} · expected: {preflight.deploy.expected_commit}</p>
          </div>
          <ul>
            {preflight.checklist.map((c, i) => (
              <li key={i} data-testid="h-check">{c.item}: {c.status}{c.note ? ` (${c.note})` : ''}</li>
            ))}
          </ul>
        </div>
      )}

      {baseline && <p data-testid="h-baseline-info">baseline {baseline.run_id}: {baseline.bots.length} bot(s)</p>}
      {verify && <p role="status" data-testid="h-verify-result">verify: {verify.verdict}</p>}
      {disarmed && <p role="status" data-testid="h-disarmed-result">disarmed: {disarmed.verdict}</p>}
      {draft && <pre data-testid="h-draft">{draft}</pre>}
    </section>
  )
}
