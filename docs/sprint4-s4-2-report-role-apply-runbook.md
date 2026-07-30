# S4-2 — `praxis_report_ro` apply runbook (migration 013)

**Status:** DOC + MIGRATION FILE ONLY. Not applied. Read-only role provisioning for the Sprint-4
evidence reporter (`npm run sprint4:evidence`). **No `db push` implied · no arm/fire · no data change ·
Migration 009 frozen.** Mirrors the 011 apply discipline.

## 1. What it does
Migration `supabase/migrations/013_report_readonly_role.sql` (additive, role-scoped):
- Creates `praxis_report_ro` — LOGIN, `NOBYPASSRLS NOINHERIT`, no elevated attrs, **no password**.
- Column-scoped `SELECT`: `trades` (8 read columns), `trades_dlq` (created_at), `webhook_logs` (status),
  `reconciliation_jobs` (status).
- `report_ro_*` RLS SELECT policies (the role is `NOBYPASSRLS`, so without these it sees zero rows):
  `trades`/`trades_dlq`/`reconciliation_jobs` USING(true), `webhook_logs` USING(status='queue_failed').
- `public.pgmq_queue_length(text)` SECURITY DEFINER wrapper (queue depth without direct pgmq access);
  EXECUTE granted to the role only.
- Does **not** touch `service_role` / `anon` / `authenticated` / `praxis_alert_ro` / any existing policy /
  Migration 009.

## 2. Apply (operator, gated)
**Pre-step (verify the history exception, do not assume it):** confirm 010/011/012/013 are **absent** from
the remote migration history — the "apply surgically, don't `db push`" safety rests on this:
```sql
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;  -- expect: no 010/011/012/013
```
If any are present, STOP and reconcile history first (separate gated approval) — a `db push` would try to
re-apply them. Otherwise apply surgically (same path as 010/011/012):
```bash
supabase db query --linked --file supabase/migrations/013_report_readonly_role.sql
```
**Function owner:** `public.pgmq_queue_length` is SECURITY DEFINER and runs as its **owner** (the role that
applied it). That owner must be able to read `pgmq` (the admin/`db query --linked` role can). If 013 is ever
re-applied by a lower-privilege role, `CREATE OR REPLACE` will refuse (not same owner) — re-apply as the
original admin owner. Verify post-apply: `SELECT public.pgmq_queue_length('trade_signals');` returns a count.
Then provision the password out-of-band (never in chat/git/history) and store it as the password behind
`PRAXIS_REPORT_DSN`:
```sql
ALTER ROLE praxis_report_ro PASSWORD '<secret>';   -- or psql \password praxis_report_ro
```

## 3. Verify as the role (7-point — read-only + induced negatives)
Connect as `praxis_report_ro` on a **session-capable** endpoint (`:5432` direct/session — NOT the `:6543`
transaction pooler; the reporter issues session `SET`s):
1. every reporter query returns rows/counts (no error). Exercise the wrapper **the way the reporter does —
   as `praxis_report_ro`, inside a READ-ONLY transaction** (the reporter sets `default_transaction_read_only=on`):
   `BEGIN READ ONLY; SELECT public.pgmq_queue_length('trade_signals'); COMMIT;` → returns a count, no error.
   (A bare admin `SELECT` does NOT exercise the role + read-only-txn path, which is the path that matters.)
2. `INSERT/UPDATE/DELETE` on each table → `42501`.
3. column overreach (`quantity`/`user_id` on trades, `raw_payload` on webhook_logs, `notes` on
   reconciliation_jobs) → `42501`.
4. table overreach (`user_exchange_credentials`/`bots`/`audit_logs`) → `42501`.
5. `SELECT * FROM pgmq.q_trade_signals` as the role → **denied** (wrapper is the only path).
6. catalog (E2): `pg_roles` row → all of rolsuper/rolbypassrls/rolcreatedb/rolcreaterole/rolreplication
   false; `pg_auth_members` → no membership.
7. RLS: `count(*)` on `trades` = ALL trades; on `webhook_logs` = queue_failed only.

## 4. Then
`PRAXIS_REPORT_DSN=postgresql://praxis_report_ro:<pw>@db.<ref>.supabase.co:5432/postgres?sslmode=verify-full`
→ `npm run sprint4:evidence` for the **read-only pre-campaign baseline**. **Expect Phase 0 = GO** (queue
empty, no DLQ/queue_failed/stuck, no dups).
**STOP condition — do not skip the queue check:** if `queue_length=unavailable` (→ `phase0_ready=INDETERMINATE`),
**STOP and re-provision** the role/wrapper (or fix the DSN to a `:5432` session endpoint). Do **not** proceed
on the strength of the other 5 gates — the queue-empty check is the most safety-relevant Phase-0 input and
must be positively verified before any firing.

## 5. Stop conditions
Any write succeeds · any column/table overreach succeeds · the role has BYPASSRLS/elevated attrs · the
wrapper returns message contents (not just a count) · any change to Migration 009 → STOP, do not use the role.
