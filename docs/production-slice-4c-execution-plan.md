# Slice 4C — gated linked-apply + deploy execution plan (runbook)

**Status:** RUNBOOK / PLAN ONLY — no linked apply, no deploy, no Doppler/Railway change here. Every step below is an **operator action requiring explicit per-action approval**. Testnet only. Real funds NO-GO.

## Current 4C state (verified read-only)
- Code **committed + pushed**: `732ebfb` (webhook state machine, `_shared/queue-recovery.ts`, migrations `024`/`025`, `worker/src/webhookRequeueSweeper.ts`, tests). Local == origin/main.
- **Worker build** (Railway active, commit `308448d` > `732ebfb`): contains the sweeper *code*, but the flag `WEBHOOK_REQUEUE_SWEEPER_ENABLED` is **unset → sweeper is a no-op (inert)**.
- **Webhook Edge function**: the 4C changes are **NOT deployed** (no `supabase functions deploy webhook` has run) — the live webhook is still the pre-4C version.
- **Migrations `024`/`025`**: present in-repo, **NOT linked-applied** (not in `schema_migrations`).
- LOCAL validation already green: `supabase db reset` 001..025 clean + SQL claim-RPC test PASSED; node:test 12/12; worker jest (sweeper 9 + dup-order); `deno check` clean.

## The ordering invariant (audit CR-2 — do not violate)
**Migrations `024` then `025` must be linked-applied + tracked BEFORE the 4C webhook code is deployed or the sweeper is enabled.** If the code runs before the schema, the `queue_failed` marking references a non-existent column and fails → a recoverable state becomes an unrecoverable stuck `accepted` row → silent loss (the exact failure 4C closes). **Never code-before-schema.**

## Gated steps (each = a separate approval boundary)

**Step 1 — linked-apply migration `024` (enum `queued`).** *(Approval required: Supabase linked DB apply.)*
- Operator runs `supabase db query --linked --file supabase/migrations/024_webhook_status_queued.sql` (surgical; **never `db push`**).
- Claude read-back: `select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='webhook_log_status' and e.enumlabel='queued'` → present.
- Track: reviewed metadata insert of `024` into `supabase_migrations.schema_migrations` (A2 discipline).

**Step 2 — linked-apply migration `025` (columns + recovery index + claim RPC).** *(Approval required.)*
- After `024` committed. `supabase db query --linked --file supabase/migrations/025_webhook_requeue_recovery.sql`.
- Read-back: columns `requeue_attempts`/`next_retry_at`/`last_requeue_error` exist; index `webhook_logs_recovery_idx` exists; function `claim_webhook_requeue` exists. Track `025`.

**Step 3 — deploy the webhook Edge function (testnet).** *(Approval required: Supabase Edge deploy.)*
- `supabase functions deploy webhook` — ships the 4C webhook (accepted→queued/queue_failed, status-aware dedup re-enqueue, 503 on enqueue failure). Safe on its own: for a `queued` row it behaves as before; requires `024`/`025` (Step 1-2) to exist first.
- Read-back: a testnet signal → row transitions `accepted`→`queued`; a simulated `pgmq_send` failure → `queue_failed` + 503.

**Step 4 — enable the worker sweeper.** *(Approval required: Railway/Doppler variable change.)*
- Set `WEBHOOK_REQUEUE_SWEEPER_ENABLED=true` (Doppler → Railway; the worker already carries the code). **Only after Steps 1-2** (the claim RPC must exist, else the sweeper's claim call 404s).
- Read-back: inject a stuck `queue_failed` / stale-`accepted` row → the sweeper re-enqueues it within one sweep → `queued`; confirm the worker produced **exactly one trade** for the `signal_id` (no duplicate — `trades UNIQUE(bot_id,signal_id)`); confirm `webhook_requeue_exhausted` fires only past `MAX` attempts.

## Real-funds precondition (audit CR-2)
4C's no-silent-loss guarantee is **not in force** until **all four steps** are done (migrations tracked + webhook deployed + sweeper ON). This is a hard precondition for real funds, alongside A1 (done) / 4A / A4 / A11.

## Rollback (per step)
- Step 4: `WEBHOOK_REQUEUE_SWEEPER_ENABLED=false` (instant; sweeper inert).
- Step 3: redeploy the prior webhook function version.
- Step 2: `DROP` the index/columns/RPC (`025` is reversible); untrack `025`.
- Step 1: `ADD VALUE 'queued'` is additive/irreversible but **benign** (old code never writes `queued`); leave it.
- No data migration to undo at any step; nothing arms trading.

## Approval boundaries (summary)
1. Linked-apply `024` · 2. Linked-apply `025` · 3. `supabase functions deploy webhook` · 4. `WEBHOOK_REQUEUE_SWEEPER_ENABLED=true`.
**Nothing here is executed by this doc.** Each awaits an explicit Oren approval in the standard format.

*Prepared for Codex review at Oren request. Testnet only; no real funds.*
