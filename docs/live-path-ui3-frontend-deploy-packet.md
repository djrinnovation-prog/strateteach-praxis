# LIVE-PATH — UI-3a frontend deploy packet (enable the TradingView token flow)

Deploys the frontend so the in-product TradingView token flow goes live. **Two approval boundaries**
(Doppler/Railway var change, then frontend deploy). No deploy is performed by preparing this packet.

## What this unlocks
With the flag ON, a signed-in user with ≥1 bot can rotate that bot's webhook token from Bot Setup Step 4
(owner-gated G-TVR). This is also the live-path unblock for **4C**: rotate a testnet bot to a fresh token
→ fire the 4C fixture → validate `queued`.

## Preconditions (verified)
- G-TVR Edge fn deployed + ACTIVE (v1) and reviewed. ✅
- UI wiring committed: `681b4dd`. ✅
- Frontend build green (`npm run build`), 123 tests pass, tsc clean. ✅
- `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` already set in the frontend build env (existing console).
- The `rotate-bot-webhook-token` CORS allows the frontend origin (currently `Access-Control-Allow-Origin: *`).

## Approval boundary 1 — set the build-time flag (Doppler/Railway var; Oren)
`VITE_TV_CONNECT_ENABLED=true` in the **frontend build env**. Vite inlines `VITE_*` at BUILD time, so this
must be set **before** the build that gets deployed (not a runtime toggle). While unset/`!=true`, Step 4
stays the locked preview — deploying with it OFF changes nothing user-visible.

## Approval boundary 2 — build + deploy the frontend (Oren)
Frontend is the Railway static site (`npm run build` → `dist/`). Deploy via the normal path (push/redeploy
that triggers the Railway build with the flag set). No worker/Edge/DB change is part of this.

## Post-deploy verification — NON-MUTATING (no real token rotation)
1. Load the app → sign in → **Bot setup** tab.
2. For a user with an existing bot, Step 4 shows the live **TradingViewConnect** with a **"Rotate webhook
   token"** button (idle state). Confirm the other steps remain locked and Activate is disabled.
3. Confirm no console errors and (DevTools → Application) **no token in localStorage/sessionStorage**.
4. **STOP there** — do NOT click through a real rotation as part of verification. A real rotate mutates a
   bot's `webhook_secret_hash` and invalidates its existing TradingView alerts (that is the separate,
   intentional token-action step in the live path, done when you actually want a fresh token).

## Rollback
Set `VITE_TV_CONNECT_ENABLED` back to unset/`false` and redeploy (Step 4 reverts to the locked preview), or
redeploy the prior build. No data/schema to undo.

## Risk
Medium. Enabling the flag makes a real rotation *possible* from the UI, but none occurs until a user
explicitly rotates. Owner-gated (G-TVR enforces `bots.user_id == auth.uid()`). No order, no activation, no
mainnet impact. A real rotation invalidates that bot's existing alerts (expected, warned in the UI).

## Next live-path step after this
Rotate a testnet bot's token via the UI (token action) → fire the 4C fixture → read
`webhook_logs.status='queued'` → then the sweeper-enable approval.
