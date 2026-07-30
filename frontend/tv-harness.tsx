// DEV HARNESS (uncommitted) — visually verify the UI-3a TradingView step with a MOCKED rotate.
// No network, NO live G-TVR, NO real token rotation. Run: `npm run dev` → open /tv-harness.html
// Outside src/ so it never affects tsc (include=["src"]), vitest, or `vite build` (single-entry index.html).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './src/styles.css'
import { BotSetupWizard } from './src/components/BotSetupWizard'
import type { RotateResult } from './src/lib/tradingview'

// Mocked owner-gated rotate — returns a fingerprint only, after a short delay. Never hits the network.
const mockRotate = async (_botId: string, _token: string): Promise<RotateResult> => {
  await new Promise((r) => setTimeout(r, 120))
  return { ok: true, new_fp: '1a2b3c4d..5e6f7a8b' }
}

const bots = [{ id: '11111111-1111-4111-8111-111111111111', trading_pair: 'BTCUSDT', status: 'active' }]

createRoot(document.getElementById('tv-root')!).render(
  <StrictMode>
    <div className="app-shell" style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        MOCK HARNESS — rotate is stubbed (no network, no real token). Visual check of UI-3a Step 4 only.
      </p>
      <BotSetupWizard tv={{ enabled: true, webhookBase: 'https://demo.supabase.co', bots, rotate: mockRotate }} />
    </div>
  </StrictMode>,
)
