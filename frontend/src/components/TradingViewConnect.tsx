// TradingViewConnect.tsx — UI-3a: the in-product TradingView connection step (webhook token).
//
// SAFETY (hard, enforced here):
//   - The plaintext token exists ONLY in component state, is shown EXACTLY ONCE, and is wiped on
//     "I saved this token" / unmount. It is NEVER written to localStorage/sessionStorage/console/analytics.
//   - The browser never writes the DB and never calls Binance. Rotation/test go through injected callbacks
//     (real impls will be reviewed owner-gated RPCs/Edge fns — G-TVR / G-TVT / G-TVR-READ). Here they are
//     stubs by default (no network) so this slice is frontend-only.
//   - Existing tokens are non-recoverable (only a hash is stored server-side) — you can only ROTATE.
import { useCallback, useRef, useState } from 'react'

/** URL-safe token, >=32 chars — matches the server TOKEN_RE (^[A-Za-z0-9_-]{32,}$). */
export function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Static TradingView alert-message template (placeholders are TradingView's, not secrets). */
export const TV_PAYLOAD_TEMPLATE =
  '{"signal_id":"{{timenow}}","action":"buy","fire_time":"{{timenow}}","close":"{{close}}","volume":"{{volume}}"}'

export type TestOutcome = 'queued' | 'rejected' | 'error'

export interface TradingViewConnectProps {
  botId: string
  /** Whether a webhook token is already set (from a non-secret owner read; never the hash). */
  tokenSet: boolean
  /** Base URL of the Praxis functions host, e.g. https://<ref>.supabase.co */
  webhookBase?: string
  /** Owner-gated rotate (real impl = G-TVR Edge fn). Receives the client token; returns a fingerprint only. */
  rotate?: (botId: string, token: string) => Promise<{ ok: boolean; new_fp?: string; error?: string }>
  /** Owner-gated test signal + read-back (real impl = G-TVT + G-TVR-READ). Never needs the token. */
  sendTest?: (botId: string) => Promise<{ status: TestOutcome; detail?: string }>
}

const noopRotate: NonNullable<TradingViewConnectProps['rotate']> = async () => ({ ok: false, error: 'not_wired' })
const noopTest: NonNullable<TradingViewConnectProps['sendTest']> = async () => ({ status: 'error', detail: 'not_wired' })

type Phase = 'idle' | 'warn' | 'generating' | 'reveal'

export function TradingViewConnect({
  botId,
  tokenSet,
  webhookBase = 'https://<your-project>.supabase.co',
  rotate = noopRotate,
  sendTest = noopTest,
}: TradingViewConnectProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [hasToken, setHasToken] = useState(tokenSet)
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<{ status: TestOutcome; detail?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The plaintext token — component memory ONLY. Not persisted anywhere.
  const tokenRef = useRef<string | null>(null)
  const [tokenShown, setTokenShown] = useState<string | null>(null) // drives the reveal-once display

  const webhookUrl = tokenShown ? `${webhookBase}/functions/v1/webhook/${botId}/${tokenShown}` : ''

  const copy = useCallback((text: string) => {
    // Clipboard only — never logged.
    void navigator.clipboard?.writeText(text)
  }, [])

  const beginGenerate = useCallback(async () => {
    setError(null)
    setPhase('generating')
    const token = generateToken()
    tokenRef.current = token
    try {
      const res = await rotate(botId, token)
      if (!res.ok) {
        tokenRef.current = null
        setError(res.error ?? 'rotate_failed')
        setPhase('idle')
        return
      }
      setTokenShown(token) // reveal ONCE
      setSaved(false)
      setTestResult(null)
      setPhase('reveal')
    } catch {
      tokenRef.current = null
      setError('rotate_failed')
      setPhase('idle')
    }
  }, [botId, rotate])

  const onStart = useCallback(() => {
    if (hasToken) setPhase('warn') // rotating an existing token → warn first
    else void beginGenerate()
  }, [hasToken, beginGenerate])

  const dismissReveal = useCallback(() => {
    // Wipe the plaintext everywhere in memory. Nothing was ever persisted.
    tokenRef.current = null
    setTokenShown(null)
    setHasToken(true)
    setPhase('idle')
  }, [])

  const runTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await sendTest(botId)
      setTestResult(r)
    } catch {
      setTestResult({ status: 'error', detail: 'test_failed' })
    } finally {
      setTesting(false)
    }
  }, [botId, sendTest])

  return (
    <section aria-label="tradingview-connect" className="card" data-testid="tradingview-connect">
      <h2>Connect TradingView</h2>
      <p className="hint">
        Generate a webhook token, then paste the URL + alert template into a TradingView alert. The token is shown
        once and cannot be recovered — save it when it appears. Rotating creates a new token and invalidates old alerts.
      </p>

      {error && <p role="alert" className="banner warn" data-testid="tv-error">Could not rotate the token ({error}). Try again.</p>}

      {/* ── idle: generate or rotate ─────────────────────────────── */}
      {phase === 'idle' && (
        <div data-testid="tv-idle">
          <p className="hint" data-testid="tv-token-status">
            {hasToken ? 'A webhook token is set for this bot (its value is not recoverable).' : 'No webhook token yet.'}
          </p>
          <button type="button" className="btn" data-testid="tv-generate" onClick={onStart}>
            {hasToken ? 'Rotate webhook token' : 'Generate webhook token'}
          </button>

          {/* Test signal — enabled only after a token has been generated + saved this session. */}
          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn secondary" data-testid="tv-test" disabled={!saved || testing} onClick={() => void runTest()}>
              {testing ? 'Sending test…' : 'Send test signal'}
            </button>
            {!saved && <span className="hint" style={{ marginLeft: 10 }}>Generate + save a token to enable the test.</span>}
            {testResult && (
              <p
                data-testid="tv-test-result"
                className={testResult.status === 'queued' ? 'banner' : 'banner warn'}
                role={testResult.status === 'queued' ? 'status' : 'alert'}
                style={{ marginTop: 10 }}
              >
                Test result: <strong data-testid="tv-test-status">{testResult.status}</strong>
                {testResult.detail ? ` — ${testResult.detail}` : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── warn before rotating ─────────────────────────────────── */}
      {phase === 'warn' && (
        <div role="group" aria-label="rotate-warning" data-testid="tv-warn">
          <p role="alert" className="banner warn">
            Rotating generates a new token and <strong>invalidates any existing TradingView alerts</strong> that use the
            current token. You will need to update those alerts with the new token.
          </p>
          <button type="button" className="btn" data-testid="tv-warn-confirm" onClick={() => void beginGenerate()}>Rotate anyway</button>
          <button type="button" className="btn secondary" data-testid="tv-warn-cancel" onClick={() => setPhase('idle')} style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      )}

      {phase === 'generating' && <p role="status" data-testid="tv-generating">Generating…</p>}

      {/* ── reveal ONCE ──────────────────────────────────────────── */}
      {phase === 'reveal' && tokenShown && (
        <div data-testid="tv-reveal">
          <p role="alert" className="banner warn" data-testid="tv-once-warning">
            This token is shown <strong>once</strong> and cannot be recovered. Save it now.
          </p>

          <label className="hint">Webhook token (save this)</label>
          <div className="step" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code data-testid="tv-token-value" style={{ wordBreak: 'break-all', flex: 1 }}>{tokenShown}</code>
            <button type="button" className="btn secondary" data-testid="tv-copy-token" onClick={() => copy(tokenShown)}>Copy</button>
          </div>

          <label className="hint" style={{ marginTop: 10, display: 'block' }}>Webhook URL (for the TradingView alert)</label>
          <div className="step" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code data-testid="tv-webhook-url" style={{ wordBreak: 'break-all', flex: 1 }}>{webhookUrl}</code>
            <button type="button" className="btn secondary" data-testid="tv-copy-url" onClick={() => copy(webhookUrl)}>Copy</button>
          </div>

          <label className="hint" style={{ marginTop: 10, display: 'block' }}>Alert message template</label>
          <div className="step" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code data-testid="tv-template" style={{ wordBreak: 'break-all', flex: 1 }}>{TV_PAYLOAD_TEMPLATE}</code>
            <button type="button" className="btn secondary" data-testid="tv-copy-template" onClick={() => copy(TV_PAYLOAD_TEMPLATE)}>Copy</button>
          </div>

          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
            <input type="checkbox" data-testid="tv-saved-check" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I saved this token</span>
          </label>
          <button type="button" className="btn" data-testid="tv-done" disabled={!saved} onClick={dismissReveal} style={{ marginTop: 10 }}>
            Done
          </button>
        </div>
      )}
    </section>
  )
}
