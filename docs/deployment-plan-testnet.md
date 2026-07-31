# Cloud Deployment Plan — Testnet (so a partner can test the full flow)

**Goal:** get the unified app off localhost onto hosted infra so an external partner (יזם) can log in
and run the full **connect → validate → arm → trade** flow on **Binance testnet**. This is the concrete
step that unblocks "send it to the partner."

**Hard scope guardrail:** TESTNET ONLY. Real-funds stays NO-GO — mainnet is fenced in code
(connect/validate/arm all refuse mainnet) and the mainnet gates (A1/A4/A11 + double-gate decision +
pentest + operator tiny-live) are NOT part of this milestone. Deploying does NOT change the real-money
posture; it only makes the testnet product reachable.

---

## 1. What gets hosted (4 components)

| # | Component | What it is | Recommended host |
|---|-----------|-----------|------------------|
| A | **Praxis Supabase** | Postgres + Edge functions + Vault + pgmq (identity, keys, execution brain) | **Supabase Cloud** (new project) |
| B | **Praxis worker** | the ts-node worker (polls pgmq → exchange) — the ONLY thing that talks to Binance | **Railway** (has `worker/railway.json`) |
| C | **StrateTeach backend** | FastAPI "brain/UI-API" (auth, tickets, learning) + its `algo770` Postgres | **Railway** (Docker) + Railway Postgres |
| D | **StrateTeach frontend** | React dashboard incl. `/praxis-connect` | Served behind the **single-origin proxy** (Caddy) so the browser talks to ONE origin |

**Data flow (unchanged from local, just hosted):**
browser → (single origin) → StrateTeach API for tickets, **and** → Praxis Edge functions for the key/validate/arm.
The exchange key goes browser → Praxis Vault; the worker (B) is the sole exchange egress. StrateTeach never
holds a key (M7).

---

## 2. Single-origin / CORS in production

Locally, nginx serves the SPA and proxies `/pfn/*` → Praxis functions + the API prefixes → backend, so the
browser only ever hits one origin (no CORS). Production needs the same: **one public origin** (e.g.
`app.<domain>`) that reverse-proxies:
- `/pfn/*` → the Praxis Supabase Functions URL (`https://<ref>.supabase.co/functions/v1/`)
- the StrateTeach API prefixes → the StrateTeach backend
- everything else → the built SPA

The existing `strateteach/Caddyfile` + `dashboard/nginx.conf` are the templates. I will produce the production
proxy config; the operator picks the domain.

---

## 3. Secrets / env matrix (OPERATOR-owned — I never see or set these)

| Secret | Used by | Notes |
|--------|---------|-------|
| `WEBHOOK_SECRET_PEPPER` | Praxis Edge + worker | Edge-only pepper; ticket key derives from it |
| `PRAXIS_PROVISION_KEY_HEX` | StrateTeach backend | = `hex(HMAC(pepper,'praxis.provision.ticket.v1'))` — mints tickets |
| `SUPABASE_SERVICE_ROLE_KEY` | worker + Edge | Praxis service role |
| `SUPABASE_URL` | worker + frontend proxy | Praxis project URL |
| StrateTeach `DATABASE_URL` | StrateTeach backend | Railway Postgres (algo770) |
| `PRAXIS_IS_PRODUCTION=false` | worker | **stays false** — testnet |
| `CREDENTIAL_VALIDATION_ENABLED=true`, `QUEUE_ENABLED=true` | worker | arm the validate + trade loops |
| `STRATETEACH_LEGACY_ENGINE_ENABLED` | backend | **leave UNSET** (retired — M7) |

Operator sets these in each platform's secret store (Supabase secrets / Railway variables / Doppler). I
provide `.env.example` templates with the NAMES only.

---

## 4. Phased rollout

- **P0 — Praxis Supabase (A):** operator creates a NEW Supabase cloud project → `supabase link` → push
  migrations (001..042) → deploy Edge functions → set function secrets (pepper, CONNECT_ALLOWED_ORIGIN,
  PRAXIS_PROVISION_ENABLED=true). I provide the exact `supabase db push` / `functions deploy` command list.
- **P1 — Praxis worker (B):** deploy `worker/` to Railway → set env (SUPABASE_URL/service-role,
  PRAXIS_IS_PRODUCTION=false, QUEUE_ENABLED=true, CREDENTIAL_VALIDATION_ENABLED=true). Confirm boot logs
  `worker_running`. (Static egress IPs are a mainnet/A1 concern — NOT needed for testnet.)
- **P2 — StrateTeach backend (C):** deploy the FastAPI Docker to Railway + attach Railway Postgres; set
  PRAXIS_PROVISION_KEY_HEX + Praxis function base + DATABASE_URL. Run the app once so `_SCHEMA` builds tables.
- **P3 — Frontend + single origin (D):** build the SPA with `VITE_PRAXIS_FUNCTIONS_BASE=/pfn` +
  `VITE_API_BASE=""`; deploy behind the production proxy (Caddy) at the public origin.
- **P4 — Deployed smoke test:** re-run the proven flow ON THE DEPLOYED ENV — create a testnet bot, connect a
  testnet key via `/praxis-connect`, validate → valid, arm, fire one signal → filled. Same as the local
  proof, but in the cloud. Only after this passes is it safe to hand the partner a login.
- **P5 — Partner access:** create the partner a user, share the URL. They test on **their own Binance
  testnet key**. Zero real-money risk.

---

## 5. Who does what

- **I (Claude) can:** write the production proxy config, `.env.example` templates, the exact deploy command
  runbooks, any code/Dockerfile tweaks needed for cloud, and the P4 smoke-test script. Verify configs.
- **Operator must (I cannot):** create the Supabase/Railway accounts + projects, enter every secret, buy/point
  the domain, click deploy, and approve each external step. Creating accounts + handling secrets + DNS are
  operator-only by policy.

---

## 6. Open decisions (need operator input before P0)

1. **Hosting:** confirm Supabase Cloud (A) + Railway (B, C) — or a different host for the StrateTeach
   backend/frontend (Render / Fly / Vercel for the SPA)?
2. **Domain:** what public origin (e.g. `app.strateteach.com` / a Railway-generated domain to start)?
3. **Secrets tool:** Railway variables directly, or Doppler (as the old app used)?

Once these are set, P0 starts. Everything remains testnet; real-funds NO-GO is unchanged.
