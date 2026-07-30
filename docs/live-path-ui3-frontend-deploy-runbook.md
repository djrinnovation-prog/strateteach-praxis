# LIVE-PATH — UI-3a frontend deploy: operator click-by-click runbook

Operator-run on Railway. Enables the TradingView token flow by rebuilding+redeploying the console at
`681b4dd` with the build flag on. **No code changes. No token rotation.** Deploy only when you decide to go
live. Service = **`praxis-operator-console-production`** (the static frontend; NOT the worker `praxis-platform`).

> KEY FACT: `VITE_TV_CONNECT_ENABLED` is inlined at **build time**. A plain "Redeploy" of the existing image
> will NOT pick it up — you must trigger a **rebuild** (adding/changing the variable does this). The bundle
> hash changing (Step 3) is your proof the rebuild actually happened.

---

## 1. Where to set `VITE_TV_CONNECT_ENABLED=true`
1. Go to **railway.app** → open the Praxis **project**.
2. Click the service **`praxis-operator-console-production`**.
3. Open the **Variables** tab.
4. Click **+ New Variable** (or "Raw Editor").
   - **Name:** `VITE_TV_CONNECT_ENABLED`
   - **Value:** `true`
5. Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are already present in the same list (do not change them).
6. Click **Add / Update**. Railway stages the change and shows a **"Deploy"** / **"Apply N changes"** button.

## 2. How to trigger the rebuild/redeploy
1. Click that **Deploy / Apply changes** button → Railway starts a **new deployment that rebuilds from source**
   (Nixpacks re-runs `npm run build`, re-inlining `VITE_*`).
2. Confirm the build is from the right commit: open the **Deployments** tab → the new (top) deployment should
   show commit **`681b4dd`** on branch **main**. If the service auto-deployed an earlier `681b4dd` build with
   the flag OFF, this new build is the flag-ON one.
3. Wait for the deployment to reach **Success** (watch **Build Logs** → **Deploy Logs**).
   - ⚠️ Do NOT use **"Redeploy"** on an *older* deployment to enable the flag — that reuses the old image
     (flag still OFF). Use the variable-triggered build above, or **Deploy** the latest `main`.

*(Optional safer two-phase: first deploy `681b4dd` with the variable still OFF and confirm the console is
unchanged + Step 4 stays Locked; then do Steps 1–2 to flip the flag.)*

## 3. How to verify the new bundle is live
1. In **Deployments**, the top entry = **Success**, commit `681b4dd`, and is marked **Active**.
2. Open the live console URL in your browser. Open **DevTools → Network**, tick **Disable cache**, hard-reload.
3. Find the main script request `assets/index-<hash>.js` — note the `<hash>`. It must **differ** from the
   previous deploy's hash (a flag-ON build differs from the flag-OFF build). Same hash ⇒ the rebuild did not
   happen — recheck Step 2.
4. (Optional) In **DevTools → Console** paste (read-only, no change):
   `fetch('/index.html').then(r=>r.text()).then(t=>console.log(t.match(/index-[^"']+\.js/)?.[0]))`
   → prints the served bundle filename.

## 4. Exact non-mutating UI check (no rotation)
1. On the live console, **sign in**.
2. Click the **Bot setup** tab (top nav).
3. Scroll to **Step 4 "Connect TradingView"**. For an account that has at least one bot it must now show a
   **"Rotate webhook token"** button (idle) instead of a "Locked" badge. Steps 1–3, 5, 6 stay **Locked**;
   the **"Activate bot"** button stays disabled.
4. **DevTools → Application → Storage:** open **Local Storage** and **Session Storage** for the site →
   confirm there is **no webhook token** stored. **Console** tab → no errors.
5. **STOP. Do NOT click "Rotate webhook token."** A real rotate changes the bot's stored token and invalidates
   its existing TradingView alerts — that is a separate, deliberate step done only when you want a fresh token.

## 5. Rollback
- **Disable the flow:** Service **Variables** → set `VITE_TV_CONNECT_ENABLED` to `false` (or delete it) →
  **Deploy / Apply changes** (this rebuilds) → Step 4 returns to the **Locked** preview.
- **Or revert the whole bundle:** **Deployments** tab → find the previous known-good deployment →
  **⋯ → Redeploy** (restores the prior image; flag effectively OFF).
- Nothing else to undo — this deploy changes no database, Edge function, or worker.

---

**Boundaries:** operator actions only; enabling the flag makes rotation *possible* but none happens until a
user clicks Rotate; owner-gated; **no order, no bot activation, no mainnet.**
