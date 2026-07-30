# Operator Console — Slice 1 Apply/Deploy Runbook (read-only console)

**Status:** DESIGN / RUNBOOK ONLY — **no execution**. Gated for Codex review **before any action**.
**Date:** 2026-06-30 · **Author:** agent (gated) · **Authoritative canon:** Notion Decision Log + `docs/DECISIONS.md`.

> This document plans how to take Operator Console **Slice 1c** from *code-complete* to a *usable read-only
> console*, in controlled steps. It **does not** apply anything, deploy anything, or change any DB/Doppler/
> Railway state. Nothing here arms execution.

---

## 0. Precise terminology (correction of record)

"We built the UI" has been imprecise. Exactly two artifacts exist, and **neither is live**:

1. **Design mockup** — `docs/production-operator-console-mvp-design.md`. **Reference only.** Not deployed,
   not connected to any DB, not code.
2. **Frontend Slice 1c** — real code in the repo (`frontend/`, commit `c418275`): auth/login, `operator_status`
   read, read-only status panel, DEGRADED state; **tests + build pass** (17 tests · `tsc --noEmit` · `vite build`).

**Slice 1c is code-complete but NOT usable live**, because all of the following are still true:

- migration **015 (`worker_status`) NOT applied** to the live DB
- migration **016 (`operator_status` + `profiles.is_operator`) NOT applied** to the live DB
- `operator_status()` does **not exist** in the live DB
- `worker_status` **table does not exist** in the live DB
- frontend is **not deployed** (no host, no env wired)
- **no operator is provisioned** (`profiles.is_operator = true` for nobody)
- worker is **not deployed with the status writer** (live worker does not yet write `worker_status`)

The correct next step is therefore **not "deploy the UI"** — it is this gated apply/deploy runbook.

---

## 1. Scope & non-goals

**In scope (read-only enablement only):** apply 015 + 016, verify, provision **one** operator, deploy the
worker so it writes `worker_status`, deploy the frontend with **anon env only**, verify the console is
read-only and execution stays disarmed.

**Explicit non-goals (unchanged by this runbook):**
- ❌ no execution; ❌ **no DB apply until explicit approval**; ❌ no queue arm (`QUEUE_ENABLED` stays `false`)
- ❌ no fire / no order; ❌ no mainnet; ❌ no real funds; ❌ no `trading_enabled` change on any bot
- ❌ no new secret in the browser (anon key only); ❌ no `db push`; ❌ Migration 009 stays frozen
- ❌ this does **not** grant A11 (real funds) and does **not** close A1/A2/A4/A5/A10/A8

**Standing invariants asserted before and after every step:** `QUEUE_ENABLED=false` · all 5 bots
`trading_enabled=false` · testnet only (`PRAXIS_IS_PRODUCTION=false`) · nothing armed/fired · Migration 009 frozen.

---

## 2. Binding execution rules (apply when the runbook is later executed)

1. **Surgical apply only — never `supabase db push`.** Migrations 010–016 are applied out-of-band and are
   intentionally absent from `supabase_migrations`. `db push` would attempt the frozen 009 and the whole
   history → **forbidden**. Apply by running the migration file inside an **explicit transaction**
   (`BEGIN … COMMIT`) via `supabase db query --linked --file …`.
2. **Every DB mutation is verified by a RAW read-back.** (Binding lesson from the smoke Step-6 disarm anomaly:
   an empty / grep-filtered command output is **NOT evidence**. Read the actual rows / catalog entries.)
3. **Two-phase per DB step:** (a) apply in a transaction; (b) **independent** read-only SELECTs to confirm the
   objects/grants/RLS exist *as intended* before declaring the step done.
4. **Secret hygiene:** operator owns all secrets; the agent never prints/requests/inspects secret values.
   Frontend gets the **public anon key only** — never service_role / Vault / DSN / exchange / webhook tokens.
5. **Evidence:** DB/platform facts = **E2** (catalog read-back, verify script). Runtime facts (worker writes a
   row; UI renders read-only) = **E1** (cited command/observation + output + date).
6. **Executor split:** DB apply / verify / provision = `db query --linked` (privileged, `auth.uid()` NULL) —
   agent may run **after approval**. Worker deploy + frontend deploy + Doppler/Railway/Auth config = **operator**.

---

## 3. Pre-flight checks (read-only; run BEFORE requesting apply approval)

All read-only. None mutate. Each must produce a concrete observed value (not an assumption).

| # | Check | How (read-only) | Pass condition |
|---|-------|-----------------|----------------|
| P1 | DB is linked & reachable | `supabase db query --linked` `SELECT now()` | returns a row |
| P2 | 015/016 files == repo HEAD | `git show HEAD:supabase/migrations/015_worker_status.sql` / `…016_operator_status_rpc.sql` | byte-identical to the committed files at HEAD (015 from Slice 1a `1fe9e3a`, 016 from Slice 1b `f0c785f`) |
| P3 | `worker_status` absent today | `SELECT to_regclass('public.worker_status')` | `NULL` |
| P4 | `operator_status` absent today | `SELECT to_regprocedure('public.operator_status()')` | `NULL` |
| P5 | `profiles.is_operator` absent today | `information_schema.columns` where table=profiles, column=is_operator | 0 rows |
| P6 | **`pgmq_queue_length` dependency present** | `SELECT to_regprocedure('public.pgmq_queue_length(text)')` | non-NULL — created by **migration 007** (applied baseline, pre-009), and called by 016's RPC (`pgmq_queue_length('trade_signals')`). 016 does **not** ship it. If absent → **STOP**: resolve 007 first; do **not** patch the wrapper into 015/016 |
| P7 | profiles-row creation mechanism | inspect trigger on `auth.users` (e.g. `handle_new_user`) | confirmed how a profiles row appears for a new auth user |
| P8 | target operator identity | operator names ONE email; confirm they will have an `auth.users` row + `profiles` row | identity agreed, **no value printed** |
| P9 | Supabase Auth config for deploy | Site URL + Redirect allowlist + email provider (operator, dashboard) | deploy origin will be allowlisted; magic-link email deliverable |
| P10 | disarmed baseline (raw) | `SELECT count(*) FILTER (WHERE trading_enabled) AS enabled_bots …` | `enabled_bots=0`; `QUEUE_ENABLED=false`; queue length 0 |
| P11 | deploy targets decided | worker = existing Railway service (redeploy); frontend host = operator choice (static) | targets named; frontend internal-only intent confirmed |

**Gate G0:** present P1–P11 results. **Do not proceed to any apply without explicit approval.**

---

## 4. Steps (each: action · evidence · rollback)

> **Approval gate before Step 1.** Steps 1–4 are DB-only and reversible. Steps 5–6 are deploys (operator).
> Deploy ordering rationale in §5.

### Step 1 — apply 015 `worker_status` (DB)
- **Action:** in a transaction, run `015_worker_status.sql` via `db query --linked --file`.
- **Evidence (E2, raw read-back, independent SELECTs):**
  - `to_regclass('public.worker_status')` → non-NULL
  - columns/PK/CHECKs present (singleton boolean PK; `worker_state IN (running,disabled,stopping)`; `boot_stuck_count >= 0` nullable)
  - `rowsecurity = true` on the table; **no policies** (RLS on, deny-by-default)
  - grants: `service_role` has SELECT/INSERT/UPDATE; **anon/authenticated have none**
  - table is **empty** (no row yet — worker not redeployed)
- **Rollback:** `DROP TABLE public.worker_status;` (safe; nothing writes to it until Step 5).

### Step 2 — apply 016 `operator_status` + `is_operator` (DB)
- **Action:** in a transaction, run `016_operator_status_rpc.sql` via `db query --linked --file`.
- **Evidence (E2, raw read-back):**
  - `profiles.is_operator` exists, `NOT NULL DEFAULT false`
  - `guard_profiles_is_operator()` trigger present (BEFORE UPDATE), and `operator_status()` exists
  - `operator_status()` is `SECURITY DEFINER`, `search_path=''`; **REVOKE FROM PUBLIC**, **GRANT EXECUTE TO authenticated** only
  - depends-on check: `pgmq_queue_length(text)` resolvable (P6) — else flag before COMMIT
- **Rollback:** `DROP FUNCTION public.operator_status();` `DROP TRIGGER … ON public.profiles; DROP FUNCTION public.guard_profiles_is_operator(); ALTER TABLE public.profiles DROP COLUMN is_operator;`

### Step 3 — run the 016 verify script (DB, ROLLBACK-only)
- **Action:** run `sql/016_operator_status_verify.sql` (transaction + **ROLLBACK** — mutates nothing; it
  *exercises* `operator_status()` as a simulated operator, so it also validates the RPC body, not just its existence).
- **Apply-time caveat (per the script header):** the script INSERTs **one temp `auth.users` row** (rolled back).
  If the live `auth.users` requires additional NOT NULL columns, adjust **only that INSERT** — cases 1/2/6 do not depend on it.
- **Evidence (E2):** all 7 executable ASSERTs pass — unauthorized / no-profile / default-false denied (42501);
  self-assign blocked + read-back `is_operator=false`; operator payload returns expected keys; **no secret fields**;
  operator_* RPC performs **no mutation**.
- **Rollback:** none needed (script self-rolls-back).

### Step 4 — provision ONE operator (DB, privileged)
- **Action (privileged, `auth.uid()` NULL — the guard only blocks user-context self-assignment):**
  - confirm the target `auth.users` row exists and a `profiles` row exists for it (P7/P8); if no profiles row, create it per the established mechanism.
  - `UPDATE public.profiles SET is_operator = true WHERE id = '<operator-uuid>';`
- **Evidence (E2, RAW read-back — not empty/grep output):**
  - `SELECT id, is_operator FROM profiles WHERE id='<uuid>'` → `is_operator = true` (the actual row, read back)
  - `SELECT count(*) FROM profiles WHERE is_operator` → **exactly 1**
- **Rollback:** `UPDATE public.profiles SET is_operator=false WHERE id='<uuid>';` (read back → false).

### Step 5 — deploy worker with the status writer (operator · Railway)
- **Precondition:** Step 1 done (else writes are non-fatal errors, throttled — but we want a clean row).
- **Action (operator):** redeploy the worker at a commit that includes the Slice 1a status writer; env unchanged
  except confirm `PRAXIS_IS_PRODUCTION=false`, `QUEUE_ENABLED=false`. (Doppler→Railway sync; **no secret values handled by agent**.)
- **Evidence (E1, runtime):** after ≤ ~70s, RAW read-back of `worker_status`:
  - exactly **one** row; `worker_state='running'` or `'disabled'` (per `QUEUE_ENABLED`); `is_production=false`;
    `queue_enabled=false`; `updated_at` within the last 60–70s (fresh → not DEGRADED)
  - worker logs show no fatal status-writer error (writer is best-effort/non-fatal)
- **Rollback:** redeploy previous worker build. (Writer is additive + non-fatal; rollback is low-risk.)

### Step 6 — deploy frontend with anon env only (operator · static host)
- **Precondition:** Steps 2 + 4 done (else the logged-in operator sees 42501/empty).
- **Action (operator):** `npm ci && npm run build` in `frontend/`; deploy `dist/` to the chosen internal host.
  Set only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (**public anon key only**). Add the deploy origin to
  Supabase Auth Site URL + redirect allowlist (P9). **No service_role / secrets in the bundle or host env.**
- **Evidence (E2/E1):** built bundle contains the anon key only (operator confirms env names); deploy origin
  is allowlisted; site loads to the Login screen (unauthenticated).
- **Rollback:** take down the static deploy; remove the origin from the Auth allowlist.

### Step 7 — verify UI is read-only & operator-gated (E1, manual)
- Log in as the provisioned operator (magic link) → **read-only StatusPanel renders** (bots, counts, `worker_status`).
- Confirm a **non-operator** account → `operator_status()` returns **42501** → "Operator access required", **no data shown**.
- Confirm **DEGRADED** behavior: with the worker writing, no banner; simulate staleness (e.g. before Step 5, or stop worker) → DEGRADED banner appears (no healthy state shown on read error).
- Confirm **ZERO mutation controls** in the live DOM (no enable/disable/pause/arm/fire; only auth sign-out).

### Step 8 — confirm execution remains disarmed (E1/E2, closing assertion)
- RAW read-back: `enabled_bots=0`; every bot `trading_enabled=false`; `QUEUE_ENABLED=false`; queue length unchanged;
  no order/trade created during the whole runbook. **Nothing armed, nothing fired, no mainnet, no real funds.**

---

## 5. Deploy-ordering rationale (why this order is mandatory)

1. **015 before 016** — `operator_status()` SELECTs `public.worker_status`; if 015 is missing, the RPC errors.
2. **015 before worker redeploy (Step 5)** — the writer targets `worker_status`; applying 015 first yields a clean
   first row instead of (non-fatal) write errors.
3. **016 + provision (Steps 2,4) before frontend (Step 6)** — without the RPC + an operator, a logged-in user only
   gets 42501/empty; deploying the UI first would show a broken console.
4. **Provision is privileged (Step 4)** — the `guard_profiles_is_operator` trigger blocks `is_operator` changes in
   user context (`auth.uid()` not NULL); only a privileged connection (`auth.uid()` NULL) may set it. This is the
   intended self-assignment protection — do **not** weaken it to provision.

---

## 6. Approval gates

- **G0** — after §3 pre-flight: present results; **explicit approval required before any apply.**
- **G1** — before **Step 5** (worker deploy): confirm Steps 1–4 evidence green.
- **G2** — before **Step 6** (frontend deploy): confirm Auth allowlist + anon-only env + internal-only intent.
- Any deviation, unexpected read-back, or missing dependency (esp. **P6 `pgmq_queue_length`**) → **STOP**, report, do not COMMIT.

---

## 7. Evidence ledger (to fill at execution time)

| Step | Type | Command (cited) | Observed output | Date | Verdict |
|------|------|-----------------|-----------------|------|---------|
| P1–P11 | — | … | … | … | … |
| 1 | E2 | … | `to_regclass=…`, grants=…, rls=… | … | … |
| 2 | E2 | … | function/trigger/grants read-back | … | … |
| 3 | E2 | verify script | 7/7 ASSERT pass | … | … |
| 4 | E2 | … | `is_operator=true` (1 row); count=1 | … | … |
| 5 | E1 | … | worker_status 1 row, fresh updated_at | … | … |
| 6 | E2/E1 | … | anon-only env; login screen loads | … | … |
| 7 | E1 | … | read-only render; 42501 for non-op; DEGRADED works; 0 mutation controls | … | … |
| 8 | E1/E2 | … | enabled_bots=0; QUEUE_ENABLED=false; no orders | … | … |

---

## 8. Full rollback (clean teardown, in reverse)

1. Frontend: take down deploy; remove origin from Auth allowlist.
2. Worker: redeploy previous build (writer is additive/non-fatal; optional).
3. Step 4: `is_operator=false` for the provisioned uuid (read back false).
4. Step 2: drop `operator_status()`, the guard trigger+function, and the `is_operator` column.
5. Step 1: `DROP TABLE public.worker_status`.
6. Re-assert disarmed baseline (Step 8 checks). No code revert needed (frontend/worker code stays in repo).

---

## 9. What this runbook does NOT do

No execution until G0 approval · no `db push` · no queue arm · no fire · no order · no mainnet · no real funds ·
no `trading_enabled` change · no new browser secret · Migration 009 stays frozen · A1/A2/A4/A5/A10/A11/A8 remain
open. Outcome on success: **Slice 1c becomes a usable, read-only, operator-gated status console** — and nothing more.

---

## 10. Execution addendum — Steps 1–3 DONE; revised Steps 4–6 (R1–R5)

> Added 2026-06-30 after G0 PASS and Steps 1–3 execution. This addendum supersedes the §4 ordering of
> Steps 4–6 (per operator decision). All §1/§2/§9 invariants remain in force.

### 10.1 Status of Steps 1–3 (executed, gated)
- **Step 1 (015)**, **Step 2 (016)**, **Step 3 (verify)** — **PASS** (E2 raw read-backs, 2026-06-30 ~18:01 UTC).
  015/016 applied surgically (transaction-wrapped `db query --linked --file`, **not** `db push`); `supabase_migrations`
  untouched; 016 verify script → **ALL_7_CASES_PASS** (rolled back). Git mirror `docs/DECISIONS.md`, commit `79e40b6`.
- **Step 5 (worker writer) — already satisfied:** `worker_status` holds a **fresh** row (`queue_enabled=false`,
  `is_production=false`, `worker_state=disabled`, `boot_stuck_count=0`) → the live worker already runs the Slice 1a
  writer. **No worker deploy/change is required or permitted here** (optionally confirm the deployed commit SHA — non-blocking).

### 10.2 P8 result (read-only verification, 2026-06-30)
- `djrinnovation@gmail.com`: **`auth_user_exists=0`**, **`profile_exists=0`**, `is_operator=NO_PROFILE`.
- **Consequence:** because Slice 1c Login uses **`shouldCreateUser:false`**, the magic-link will **not** create the
  account — the operator **must be invited/created via Supabase Auth first**. `P7` confirms
  `on_auth_user_created → handle_new_user` then auto-creates the profile (`is_operator=false` default).

### 10.3 Revised order R1 → R5 (replaces §4 Steps 4/6 sequencing)

**R1 — Railway static frontend service → generated URL** *(operator)* — **DONE 2026-07-01**
- New Railway service, **separate from the worker**, serving built `dist/`; env = `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY` (**anon key only, no secrets**). Domain target port `8080`.
- **Build command = `npm run build`** (NOT `npm ci && npm run build` — Railpack already runs `npm ci` in its
  install step; a second `npm ci` fights Railpack's `node_modules/.vite` cache mount → `EBUSY` exit 240).
  **Start command = `npx --yes serve -s dist -l $PORT`**. Root Directory = `frontend`.
- Anon key = the **Publishable key** (`sb_publishable_…`); the legacy JWT `anon` key is disabled (June rotation).
- **Result:** URL = `https://praxis-operator-console-production.up.railway.app` — deploy success, Login screen
  renders, service separate from the worker. ✅
- **Evidence:** the **exact** generated URL captured verbatim; serves the Login screen; separate from the worker
  service. **STOP if** build fails / env missing / no stable URL.

**R2 — Supabase Auth Site URL + redirect allowlist** *(operator · dashboard)*
- **Site URL** = the exact R1 Railway URL. **Additional Redirect URLs:** `https://<svc>.up.railway.app` + `…/**`,
  and `http://localhost:5173` + `http://localhost:5173/**`. Confirm email provider (magic-link deliverable).
- **Evidence:** operator confirms saved values; the Railway entry **byte-matches** R1. (Dashboard state — not
  DB-readable; evidence = confirmation/screenshot.) **STOP if** URL mismatch vs R1 or no email provider.

**R3 — Invite/create operator auth user `djrinnovation@gmail.com`** *(operator · Auth → Users → Invite)*
- Per §10.2 the user does not exist → **invite/create**. The `handle_new_user` trigger creates the profile.
- **Evidence (RAW read-back — re-run the P8 check):** `auth_user_exists=1` (+ capture `auth_user_id`);
  **`profile_exists=1`**; `profile_is_operator=false`. **STOP if** `profile_exists=0` after creation (trigger did
  not fire) — investigate; do **not** hand-insert a profile row.

**R4 — Provision `profiles.is_operator=true` — PRIVILEGED ONLY** *(agent · `db query --linked`, `auth.uid()` NULL)*
- **Precondition (hard rule, §10.4):** R3 read-back green — `profile_exists=1`.
- `UPDATE public.profiles SET is_operator=true WHERE id='<auth_user_id from R3>';` (target the exact uuid).
- **Evidence (RAW read-back):** `SELECT id,is_operator … WHERE id='<uuid>'` → `true`; `SELECT count(*) … WHERE
  is_operator` → **exactly 1**. **STOP if** read-back ≠ true or count ≠ 1 (never infer from empty output).
  **Rollback:** set back to `false` (read back false).

**R5 — Frontend login / read-only verification** *(operator + agent assist)*
- Precondition: R1+R2+R3+R4 green.
- **Verify (E1):** login as `djrinnovation@gmail.com` → **read-only panel renders**; a **non-operator → 42501**
  "Operator access required", **no data**; **DEGRADED** works on stale/missing; **ZERO mutation controls** in the DOM
  (only sign-out); host/bundle env = **anon key only**.
- **Closing assertion:** RAW read-back — `enabled_bots=0`, `QUEUE_ENABLED=false` (worker_status), no orders.

### 10.4 Explicit rule (binding)
**No `is_operator=true` (R4) until the auth user AND profile exist and a RAW read-back confirms `profile_exists=1`.**
Provisioning is **privileged-only** (the guard blocks user-context changes); never weaken the guard to provision.

### 10.5 Invariants held across R1–R5
no queue arm · no fire · no mainnet · no real funds · no `trading_enabled` change · **no worker deploy/change**
(only the new frontend service) · **anon key only** in the browser · **raw read-back for every DB mutation** ·
**stop after each step with evidence** for explicit go. Migration 009 frozen; A1/A2/A4/A5/A10/A11/A8 remain open.
