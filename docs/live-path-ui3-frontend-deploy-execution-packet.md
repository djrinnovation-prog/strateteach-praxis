# LIVE-PATH — UI-3a frontend deploy EXECUTION packet

Enable the in-product TradingView token flow by deploying the frontend that carries commit `681b4dd`.
**All steps are operator-run on Railway (two approval boundaries: set the build var, then deploy).**
This packet prepares only — nothing is deployed, no token is rotated, no alert is activated.

## Flag confirmation (required)
`VITE_TV_CONNECT_ENABLED=true` **must be set in the FRONTEND build env**. It is a **build-time** flag:
`frontend/src/App.tsx:42` reads `import.meta.env.VITE_TV_CONNECT_ENABLED`, and Vite **inlines every `VITE_*`
at build time** — it is NOT a runtime toggle. So the value must be present in the environment of the build
that gets deployed. While unset / `!== 'true'`, Bot Setup Step 4 stays the locked preview and **no rotation
can be triggered**.

## Exact Railway service
- **Frontend (this deploy):** static service **`praxis-operator-console-production`** — serves the console +
  Bot Setup UI. Build = `npm run build` (`tsc && vite build` → `dist/`), served statically.
- **NOT** the worker service `praxis-platform` (unrelated; do not touch).

## Pre-checks (before any deploy)
1. `681b4dd` is on `origin/main`. ✅ (confirmed pushed)
2. Frontend build env already has `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. (Existing — verify present.)
3. G-TVR Edge fn `rotate-bot-webhook-token` is ACTIVE (v1). ✅
4. Local build/tests green: `cd frontend && npm ci && npm run build && npx vitest run` → build ok, 123 tests pass, tsc clean.
5. CORS: `rotate-bot-webhook-token` allows the console origin (currently `Access-Control-Allow-Origin: *`).
6. There is ≥1 bot for the signed-in user (Step 4 only renders live when the user has a bot).

## Deploy steps (operator, Railway)
**Recommended two-phase (safer): deploy inert first, then flip the flag.**

**Phase 1 — deploy `681b4dd` with the flag OFF (regression-safe, zero user-visible change):**
1. Deploy service `praxis-operator-console-production` at commit `681b4dd` (push-triggered build, or Railway "Redeploy" pinned to `681b4dd`) with `VITE_TV_CONNECT_ENABLED` **unset**.
2. Verify (below) that the operator console is unchanged and Step 4 is still **Locked**.

**Phase 2 — enable the flow:**
3. Railway → service `praxis-operator-console-production` → **Variables** → add `VITE_TV_CONNECT_ENABLED=true`.
4. **Rebuild + redeploy** the service (a variable change alone does not rebuild the inlined bundle — a fresh build is required).
5. Wait for the build to complete. (Railway exposes `RAILWAY_GIT_COMMIT_SHA` at build → mapped to `VITE_BUILD_COMMIT` for verification.)

*(Single-phase is possible — set the var + deploy in one go — but two-phase isolates "new bundle" from "flag on".)*

## Post-deploy NON-MUTATING check (no real rotation)
1. **New bundle live:** load the console; the served `/assets/index-<hash>.js` filename differs from the
   prior deploy (a flag-ON build differs from the local flag-OFF `index-DqnyUhqZ.js`). Confirm via DevTools
   Network or `fetchDeployedBundleHash()` (buildinfo.ts). If `VITE_BUILD_COMMIT` is mapped, `readBuildCommit()` == `681b4dd`; else operator attests the deployed commit.
2. **Sign in → "Bot setup" tab.** For a user with a bot, **Step 4 shows the live "Rotate webhook token"** (idle
   state). Steps 1–3, 5, 6 remain **Locked**; "Activate bot" stays disabled.
3. **No secret at rest:** DevTools → Application → localStorage **and** sessionStorage contain **no** webhook
   token; Console shows no errors.
4. **STOP HERE.** Do **NOT** click "Rotate webhook token" — a real rotate mutates the bot's
   `webhook_secret_hash` and invalidates its existing TradingView alerts. That is the separate, intentional
   token-action step, done only when you want a fresh token for the alert.

## Rollback
- **Disable the flow:** set `VITE_TV_CONNECT_ENABLED` to unset/`false` in the service Variables → rebuild +
  redeploy → Step 4 reverts to the locked preview. (Or redeploy the prior build.)
- No DB/schema/Edge change is part of this deploy, so there is nothing else to undo.

## Risk & boundaries
Medium. Enabling the flag only makes a rotation *possible* from the UI — none occurs until a user clicks
Rotate. Owner-gated (G-TVR enforces `bots.user_id == auth.uid()`). **No order, no bot activation, no
mainnet.** Two operator approval points: (a) set `VITE_TV_CONNECT_ENABLED=true`, (b) rebuild+redeploy
`praxis-operator-console-production`.

## Next live-path step (separate approval, after this)
Rotate a testnet bot's token via Bot Setup Step 4 (token action) → copy the real webhook URL into the
TradingView alert (replaces the placeholder) → fire the 4C fixture → read `webhook_logs.status='queued'`.
