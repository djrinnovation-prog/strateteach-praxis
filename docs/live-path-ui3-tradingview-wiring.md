# LIVE-PATH — UI-3a TradingView token wiring

How the in-product TradingView token step (`TradingViewConnect`) is wired into the Bot Setup UI, and the
feature flag that gates it. (The `.env.example` file is gitignored, so this tracked doc is the canonical
reference for the flag; `frontend/src/App.tsx` also carries the inline comment.)

## Feature flag

| | |
|---|---|
| **Name** | `VITE_TV_CONNECT_ENABLED` (Vite build-time env; browser-exposed like all `VITE_*`) |
| **Default** | **OFF** — unset, or any value `!== 'true'` |
| **Where read** | `frontend/src/App.tsx` → passed as `tv.enabled` into `BotSetupWizard` |

## Behavior

**While OFF (default):**
- Bot Setup Step 4 ("Connect TradingView") stays the **locked preview** card.
- `TradingViewConnect` is **not mounted**; no user-bots read runs; **no token rotation can be triggered**
  from the UI. Dev/CI/local runs are inert by design.

**While ON:**
- Step 4 mounts the live `TradingViewConnect` **only if the signed-in user has ≥1 bot** (an RLS-scoped
  `loadUserBots` read; non-secret columns only — never `webhook_secret_hash`). With >1 bot a selector is shown.
- Because `bots.webhook_secret_hash` is `NOT NULL`, every existing bot already has a token, so the action is
  always a **rotate** (the UI warns that rotating invalidates existing TradingView alerts).
- The client generates the plaintext token; it is sent **once** to the deployed owner-gated
  `rotate-bot-webhook-token` Edge function (`rotateWebhookToken` in `frontend/src/lib/tradingview.ts`),
  which stores only the HMAC hash and returns a **fingerprint**. The token lives in component memory only,
  is shown once, and is never written to localStorage/sessionStorage/console.
- The **test-signal** button is a stub/disabled — there is no reviewed test-send backend (G-TVT) yet.

## Deploy / run requirement to enable

Enable the flag ONLY after:
1. `rotate-bot-webhook-token` Edge function is **deployed** (done — `supabase functions deploy
   rotate-bot-webhook-token`, ACTIVE v1) and Codex-reviewed.
2. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set (the webhook base + auth).
3. An operator sets `VITE_TV_CONNECT_ENABLED=true` in the frontend build env and redeploys the frontend.

Turning the flag on is an explicit operator action; it does not arm any trading, place any order, or touch
mainnet. Rotating a token invalidates that bot's existing TradingView alerts (expected).
