# Deploy Runbook — Railway + Supabase Cloud (TESTNET)

Executable steps to deploy the unified app so a partner can test on **Binance testnet**.
Decisions: all app services on **Railway**, Praxis on **Supabase Cloud**, secrets in **Railway variables**
+ Supabase secrets, Railway-generated domains to start. **Real-funds NO-GO — testnet only.**

Legend: **[OP]** = operator must do it (accounts/secrets/DNS/clicks — I cannot). **[CC]** = artifact I provide.

---

## P0 — Praxis Supabase (cloud)

1. **[OP]** Create a NEW Supabase project (note the **project ref** `<ref>` and DB password). This is SEPARATE
   from the old `praxis-platform` project.
2. **[OP]** `supabase login` then from repo root: `supabase link --project-ref <ref>`.
3. **[OP]** Push schema + functions:
   ```
   supabase db push                       # applies migrations 001..042
   supabase functions deploy              # deploys all Edge functions (incl. validate-credential)
   ```
4. **[OP]** Set Praxis function secrets (Supabase → Project → Edge Functions → Secrets, or `supabase secrets set`):
   - `WEBHOOK_SECRET_PEPPER` (generate once, base64url) · `PRAXIS_PROVISION_ENABLED=true`
   - `CONNECT_ALLOWED_ORIGIN=https://<your-app-origin>` (the Caddy public URL from P3)
5. **[OP]** Confirm Vault is enabled + note `SUPABASE_URL` (`https://<ref>.supabase.co`) and the
   **service_role** key (Project → API). Keep the service_role secret — never in the browser/frontend.

Verify: `supabase functions list` shows `validate-credential`, `connect-credential`, `create-bot`,
`arm-bot`, `bot-status`, `pause-bot`, `provision-user`.

## P1 — Praxis worker (Railway)

1. **[OP]** New Railway service from the repo, root = `worker/` (NIXPACKS via `worker/railway.json`, `npm start`).
2. **[OP]** Set Railway variables: `SUPABASE_URL=https://<ref>.supabase.co`,
   `SUPABASE_SERVICE_ROLE_KEY=<service_role>`, `PRAXIS_IS_PRODUCTION=false`, `QUEUE_ENABLED=true`,
   `CREDENTIAL_VALIDATION_ENABLED=true`, `POLL_INTERVAL_MS=2000`, `QUEUE_VISIBILITY_TIMEOUT_S=45`.
   (Static outbound IPs are a mainnet/A1 concern — NOT needed for testnet.)
3. Verify logs show `worker_starting` → `queue_preflight_ok` → `worker_running`.

## P2 — StrateTeach backend + DB (Railway)

1. **[OP]** Add a Railway **Postgres** plugin (the `algo770` DB). Note its `DATABASE_URL`.
2. **[OP]** New Railway service from `strateteach/`, Docker = `strateteach/python-backend/Dockerfile`.
3. **[OP]** Variables: `DATABASE_URL=<railway pg>`, `PRAXIS_PROVISION_KEY_HEX=<hex(HMAC(pepper,'praxis.provision.ticket.v1'))>`,
   `PRAXIS_WEBHOOK_BASE=https://<ref>.supabase.co`, `PRAXIS_SHADOW_ENABLED=true`.
   **Leave `STRATETEACH_LEGACY_ENGINE_ENABLED` UNSET** (retired — M7) and `STRATETEACH_ENGINE_ENABLED` UNSET.
4. First boot builds the schema (`_SCHEMA`). Verify `/healthz` responds.

> `PRAXIS_PROVISION_KEY_HEX` derivation (operator, offline): it is `hex(HMAC_SHA256(base64url_decode(PEPPER), "praxis.provision.ticket.v1"))`. I provide a one-off script if wanted.

## P3 — Frontend + single-origin proxy (Railway, Caddy)

1. **[CC]** `strateteach/Caddyfile` now proxies `/pfn/*` → Praxis functions and `/praxis/*` → backend (single origin).
2. **[OP]** Deploy `strateteach/docker-compose.yml`'s `caddy` + `frontend` + `backend` as the app service(s), or
   a Railway service running Caddy in front. Set Caddy variables:
   - `DOMAIN=<railway-generated-or-custom>` · `PRAXIS_FUNCTIONS_HOST=<ref>.supabase.co`
3. **[OP]** Frontend build args (Dockerfile ARG): `VITE_API_BASE=""`, `VITE_PRAXIS_FUNCTIONS_BASE="/pfn"`.
4. **[OP]** Set the Praxis `CONNECT_ALLOWED_ORIGIN` (P0.4) to this final public origin.

Verify: browsing the public URL loads the SPA; `POST /pfn/bot-status` (no body) returns a JSON error from
Praxis (not a CORS/404) — proves the browser→Praxis single-origin path works.

## P4 — Deployed smoke test (MUST pass before the partner gets access)

Re-run the exact proven flow, but on the deployed env:
1. Log in, open `/praxis-connect`, create a bot, connect a **Binance testnet** key (via the UI → Praxis Vault).
2. Click **Validate key** → status flips to `valid`.
3. Click **Arm** → active.
4. Fire one testnet signal → the worker fills one order. Then **KILL**.

Only if P4 is green is it safe to hand out a login. (**[CC]** I'll provide a scripted version of P4.)

## P5 — Partner access

**[OP]** Create the partner a user; share the URL. They connect **their own** Binance testnet key. Zero
real-money risk (mainnet is fenced in code + `PRAXIS_IS_PRODUCTION=false`).

---

## Guardrails (unchanged by deployment)

- `PRAXIS_IS_PRODUCTION=false` on the worker — testnet endpoints only.
- Mainnet fenced in Edge (connect/validate/arm refuse mainnet) — a partner cannot connect a mainnet key.
- Legacy engine retired (M7): `STRATETEACH_LEGACY_ENGINE_ENABLED` unset → StrateTeach holds no keys, no order/withdraw.
- Real-funds path (A4/A11/double-gate/pentest/operator-tiny-live) is a LATER milestone, not this deploy.
