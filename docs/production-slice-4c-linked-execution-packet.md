# Slice 4C — linked-execution packet (per-action, gated) — **Rev 2**

**Status:** EXECUTION RUNBOOK — **nothing is executed by this doc.** Each action is an **operator action requiring its own explicit approval**; Claude performs **read-backs only**. Testnet only. Surgical `db query --linked --file` only — **never `db push`**. No real funds.

**Rev 2 change (per Codex):** **schema apply and migration tracking are now separate actions** (A apply 024 → B track 024 → C apply 025 → D track 025 → E deploy webhook → F enable sweeper). Never "apply + track" in one step. Adds partial-failure handling, a tracking↔schema reconcile stop condition, and P0/validation clarifications.

---

## P0 — pre-checks (read-only; no approval)

Claude confirms all before any action:
1. **Local repo has the migration files** `supabase/migrations/024_webhook_status_queued.sql` and `025_webhook_requeue_recovery.sql`.
2. **4C code present** — `origin/main` at commit **`732ebfb` or newer** (contains the webhook state machine, `_shared/queue-recovery.ts`, `024`/`025`, `webhookRequeueSweeper.ts`).
3. **Migrations not yet applied AND not tracked:**
   ```sql
   select version from supabase_migrations.schema_migrations where version in ('024','025');  -- expect 0 rows
   ```
   and the enum/columns/RPC do not yet exist (per-action PRE-guards below).
4. **Sweeper OFF** — `WEBHOOK_REQUEUE_SWEEPER_ENABLED` unset/false on the worker.
5. **Disarmed / testnet** — `worker_status.is_production=false`, `queue_enabled=false`; real funds NO-GO.
6. **PITR available.**
Any failure → STOP.

*(A separate P0-class check — "deployed webhook is still pre-4C" — is verified immediately before Action E; see E.)*

---

## Action sequence (strict order; A → B → C → D → E → F)

### Action A — apply migration 024 (enum `queued`) ONLY *(APPROVAL REQUIRED: linked DB apply)*
- **PRE-guard (read-back):** `queued` absent —
  ```sql
  select not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                     where t.typname='webhook_log_status' and e.enumlabel='queued') as queued_absent;  -- true
  ```
- **Apply (operator):** `supabase db query --linked --file supabase/migrations/024_webhook_status_queued.sql`
- **POST read-back (Claude):**
  ```sql
  select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
  where t.typname='webhook_log_status' and e.enumlabel='queued';  -- expect 1 row
  ```
- **NO tracking insert in this action.**

### Action B — track 024 ONLY *(APPROVAL REQUIRED: linked DB metadata insert)*
- **Metadata-only insert (operator):**
  ```sql
  insert into supabase_migrations.schema_migrations (version, name)
  values ('024','webhook_status_queued') on conflict (version) do nothing;
  ```
- **Read-back (Claude):** `024` present in `schema_migrations`; `supabase migration list --linked` shows 024 tracked (025 still shows **local-only/pending** — expected until C+D). No schema/data change here — tracking metadata only.

### Action C — apply migration 025 (columns + recovery index + claim RPC) ONLY *(APPROVAL REQUIRED: linked DB apply)*
- **Precondition:** A + B done (024 applied **and** tracked).
- **PRE-guard (read-back):** columns + RPC absent —
  ```sql
  select
    not exists (select 1 from information_schema.columns where table_schema='public'
                and table_name='webhook_logs' and column_name='requeue_attempts') as cols_absent,
    not exists (select 1 from pg_proc where proname='claim_webhook_requeue') as rpc_absent;  -- true, true
  ```
- **Apply (operator):** `supabase db query --linked --file supabase/migrations/025_webhook_requeue_recovery.sql`
- **POST read-back (Claude):**
  ```sql
  select
    (select count(*) from information_schema.columns where table_schema='public' and table_name='webhook_logs'
       and column_name in ('requeue_attempts','next_retry_at','last_requeue_error')) as cols,          -- 3
    exists (select 1 from pg_indexes where schemaname='public' and tablename='webhook_logs'
            and indexname='webhook_logs_recovery_idx') as idx,                                          -- true
    exists (select 1 from pg_proc where proname='claim_webhook_requeue') as rpc;                        -- true
  ```
- **NO tracking insert in this action.**

### Action D — track 025 ONLY *(APPROVAL REQUIRED: linked DB metadata insert)*
- **Metadata-only insert (operator):**
  ```sql
  insert into supabase_migrations.schema_migrations (version, name)
  values ('025','webhook_requeue_recovery') on conflict (version) do nothing;
  ```
- **Read-back (Claude):** `025` present in `schema_migrations`; `supabase migration list --linked` → **Local == Remote / nothing pending**.

### Action E — deploy the webhook Edge function *(APPROVAL REQUIRED: Supabase Edge deploy)*
- **Precondition:** A + B + C + D all PASS (schema present **and** tracked, Local == Remote). **AND** verify the **currently-deployed webhook is still pre-4C** before deploying (a signed testnet fixture against the live function shows the old behavior — no `queued` transition — or confirm via the function's deployed version/timestamp). If it is already 4C, STOP and reconcile.
- **Deploy (operator):** `supabase functions deploy webhook`
- **Validation (testnet; see "Validation" note — prefer a signed fixture, no TradingView live required):** a signed testnet signal → row `accepted`→**`queued`**, 200; an injected `pgmq_send` failure → **`queue_failed`** (`rejection_reason='pgmq_send_failed'`, `next_retry_at` set), 503; no secret/token in logs.

### Action F — enable the worker sweeper flag *(APPROVAL REQUIRED: Doppler/Railway var change + redeploy)*
- **Precondition:** E PASS.
- **Enable (operator):** set `WEBHOOK_REQUEUE_SWEEPER_ENABLED=true` (Doppler → Railway → worker redeploy; the code is already deployed).
- **Validation (testnet):** seed a `queue_failed` row and a stale `accepted` row (received_at > 60s, not enqueued) → within one sweep both → **`queued`**; the worker produces **exactly one trade** per `signal_id` (dedup via `trades UNIQUE(bot_id,signal_id)`) — no duplicate order; persistent failure → `requeue_attempts` increments with backoff, at `MAX` stays `queue_failed` + `webhook_requeue_exhausted` (never dropped); sweeper makes no exchange call, logs no secret.

---

## Deploy order + why code-before-schema cannot happen
Order **A → B → C → D → E → F**, never reversed. The 4C code writes `queued`/`next_retry_at` (webhook) and calls `claim_webhook_requeue` (sweeper) — all created **only by A + C**. Actions E (webhook) and F (sweeper) are **never approved until A+B+C+D have passed** (schema present *and* tracked). If the code deployed before the schema, `queue_failed` marking would fail on a missing column → a recoverable state would become an unrecoverable stuck `accepted` row → silent loss (the exact failure 4C closes). The ordering + the tracking↔schema reconcile stop condition prevent this.

## Rollback / partial-failure handling
- **A pass / B fail** (schema 024 exists, untracked): **benign** — no code writes `queued` until E/F. **Re-run B** (idempotent insert). **Do NOT roll back the enum** (`ADD VALUE` is additive; leaving it is safe).
- **C pass / D fail** (schema 025 exists, untracked): **re-run D**; **or**, if stopping the slice, **roll back 025** — `drop function claim_webhook_requeue(int,int,int); drop index webhook_logs_recovery_idx; alter table webhook_logs drop column requeue_attempts, drop column next_retry_at, drop column last_requeue_error;` (no data loss — new/empty columns). Do not proceed to E while tracking ≠ schema.
- **E fail:** roll back the webhook deploy (redeploy the previous function version). DB schema remains (benign; safe for `queued` rows). Do not proceed to F.
- **F fail:** set `WEBHOOK_REQUEUE_SWEEPER_ENABLED=false` (sweeper inert). No state to undo.

## Stop conditions
- Any pre-check fails; any read-back ≠ expected (an empty/unchanged read is a **failure**, never success).
- **Tracking does not match actual schema state** (e.g. schema present but untracked, or tracked but absent) → **STOP and reconcile tracking before any deploy (E/F).**
- `db push` (must be surgical `db query --linked --file`); any unreviewed metadata mutation beyond the two tracking inserts.
- Applying `025` before `024` is applied **and** tracked; deploying webhook/sweeper (E/F) before A+B+C+D PASS; deploying E when the live webhook is already 4C.
- Any real-funds / mainnet action; any secret/token printed.

## Validation note (TradingView not required)
- The E/F testnet validations should use a **local/test signed webhook fixture** — a POST to the webhook with a valid HMAC token for a **testnet** bot (signed against the testnet pepper) — **not** a real TradingView live alert. A signed fixture proves the `accepted`→`queued`/`queue_failed` transitions without any TradingView activation.
- **If** a real TradingView alert is used instead, it must be **testnet only** (a testnet bot), and **no mainnet**.

## Close condition
4C is "in force" **only after A + B + C + D + E + F** and green testnet validations. Hard real-funds precondition (audit CR-2), alongside A1 (done) / 4A / A4 / A11.

## Approval boundaries (each separate)
A (apply 024) · B (track 024) · C (apply 025) · D (track 025) · E (deploy webhook) · F (enable sweeper). **Nothing here is executed by this doc.**

*Prepared for Codex review at Oren request. Testnet only; no real funds.*
