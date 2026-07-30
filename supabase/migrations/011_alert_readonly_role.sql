-- 011_alert_readonly_role.sql
-- ============================================================================
-- S4-1 alerting — least-privilege read-only role `praxis_alert_ro`
-- ============================================================================
-- Purpose: a dedicated, SELECT-only Postgres role for the external scheduled
-- alert poller (S4-1). It can answer EXACTLY the three alert queries
-- (worker/tools/lib/readonly-sql.ts) and nothing more.
--
-- This migration is ADDITIVE and ORTHOGONAL to Migration 009 (frozen):
-- it creates ONE new role and grants/policies scoped EXCLUSIVELY to that role.
-- It does not modify service_role / anon / authenticated / praxis_edge, any
-- existing policy, function, or table structure. 009 stays frozen.
--
-- ── APPLY DISCIPLINE (read before applying) ─────────────────────────────────
--  - This file is NOT auto-applied. No `db push` is implied by committing it.
--  - Migration-010 history exception: 010 was applied surgically via direct SQL
--    and is NOT recorded in supabase_migrations. A naive `db push` of 011 may
--    attempt to (re)apply 010. Apply 011 EITHER surgically via direct SQL like
--    010 (idempotent; track the written exception) OR reconcile 010 history
--    first — under a separate gated approval.
--
-- ── ROLE CREDENTIAL PROVISIONING (separate, operator-controlled) ────────────
--  - The role is created with LOGIN but WITHOUT a password. The password is
--    NEVER stored in this migration (secret hygiene).
--  - Credential provisioning is a SEPARATE operator-controlled step, run
--    out-of-band, e.g.:  ALTER ROLE praxis_alert_ro PASSWORD '<secret>';
--  - The secret is stored separately (Doppler / operator-managed secret store),
--    not in git and not in this file.
--  - Applying THIS migration does NOT make the poller operational: until the
--    password is provisioned separately AND wired to the poller, the role
--    exists but cannot authenticate.
--  - At apply time, CONFIRM that Supabase accepts and uses this custom LOGIN
--    role via the intended connection path (direct / session connection string;
--    verify behaviour through the pooler before relying on it).
-- ============================================================================

-- 1. Role: login-capable, but with no privileges of its own and subject to RLS.
--    NOBYPASSRLS + NOINHERIT + no role memberships ⇒ it has ONLY what is granted
--    below. No SUPERUSER / CREATEDB / CREATEROLE / REPLICATION.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'praxis_alert_ro') THEN
    CREATE ROLE praxis_alert_ro WITH
      LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
END$$;

COMMENT ON ROLE praxis_alert_ro IS
  'S4-1 alerting: SELECT-only poller role. No password here (operator-provisioned
   out-of-band, secret stored in Doppler/operator store). No service_role
   membership, NOBYPASSRLS. See migration 011.';

-- 2. Schema usage — required to reference public.* objects at all.
GRANT USAGE ON SCHEMA public TO praxis_alert_ro;

-- 3. Column-level SELECT — ONLY the columns the three alert queries read.
--    Column-level (not table-level) grants keep the role from reading anything
--    beyond what alerting needs.

-- trades_dlq: DLQ "any new row since watermark" alert.
--   COLUMN scope = created_at ONLY (for max(created_at) + WHERE created_at > $1;
--   count(*) runs off this column grant).
--   NOT granted (the other real columns, verified vs 001_initial_schema.sql):
--   trade_id, bot_id, signal_id, raw_payload, failure_reason, retry_count, id —
--   i.e. NO grant on any DLQ detail column beyond created_at. The role can
--   COUNT/MAX DLQ rows but CANNOT inspect DLQ contents beyond created_at.
GRANT SELECT (created_at)                     ON public.trades_dlq   TO praxis_alert_ro;

-- webhook_logs: queue_failed alert. status (filter the failure class) +
--   received_at (max + watermark). NOT granted: raw_payload, source_ip,
--   rejection_reason, bot_id, signal_id, id (PII / secret-surface).
GRANT SELECT (status, received_at)            ON public.webhook_logs TO praxis_alert_ro;

-- trades: stuck pending/unknown alert. status (state) + created_at (age) +
--   deleted_at (exclude soft-deleted). NOT granted: exchange_order_id, quantity,
--   price_*, user_id, client_order_id, error_reason, etc.
GRANT SELECT (status, created_at, deleted_at) ON public.trades       TO praxis_alert_ro;

-- 4. RLS read policies scoped to praxis_alert_ro.
--    RLS is ENABLED on all three tables and the existing SELECT policies are
--    auth.uid()-based (user-facing). A direct, NOBYPASSRLS connection has
--    auth.uid() = NULL, so WITHOUT these policies the role would see ZERO rows
--    and every alert count would be 0 (silent false-negatives). These policies
--    are named alert_ro_* and scoped TO praxis_alert_ro, so they do not alter
--    the existing user/authenticated policies. Each is a SUPERSET of its alert
--    query's row scope, so counts stay correct while the role cannot enumerate
--    healthy rows. DROP IF EXISTS first → idempotent.

-- trades_dlq: USING (true) — least-privilege is preserved at the COLUMN layer,
--   not the row layer:
--     * ROW scope is all rows BECAUSE every DLQ row is alert-relevant (the DLQ
--       should be empty in a healthy run; there is no benign subset to hide).
--     * COLUMN scope remains created_at ONLY (grant in §3) — no failure_reason,
--       no raw_payload, no bot_id, no signal_id, no trade_id, no retry_count.
--     * Net effect: the role can count/max DLQ rows but cannot read DLQ contents
--       beyond created_at. USING(true) here is NOT broad read access.
DROP POLICY IF EXISTS alert_ro_dlq_select     ON public.trades_dlq;
CREATE POLICY alert_ro_dlq_select     ON public.trades_dlq
  FOR SELECT TO praxis_alert_ro
  USING (true);

-- webhook_logs: tightened — the role sees ONLY queue_failed rows, never
--   accepted/rejected ingestion logs.
DROP POLICY IF EXISTS alert_ro_webhook_select ON public.webhook_logs;
CREATE POLICY alert_ro_webhook_select ON public.webhook_logs
  FOR SELECT TO praxis_alert_ro
  USING (status = 'queue_failed');

-- trades: tightened — the role sees ONLY live pending/unknown rows (stuck
--   candidates), never filled/failed/cancelled or soft-deleted trades.
DROP POLICY IF EXISTS alert_ro_trades_select  ON public.trades;
CREATE POLICY alert_ro_trades_select  ON public.trades
  FOR SELECT TO praxis_alert_ro
  USING (status IN ('pending','unknown') AND deleted_at IS NULL);

-- ── INTENTIONALLY EXCLUDED ──────────────────────────────────────────────────
--   * No INSERT/UPDATE/DELETE/TRUNCATE on any table (writes fail 42501).
--   * No pgmq access (queue health is inferred from webhook_logs.status +
--     trades_dlq; no direct queue introspection needed for Phase-1 alerting).
--   * No service_role membership / inheritance.
--   * No grants on bots, user_exchange_credentials, audit_logs,
--     reconciliation_jobs, bot_events, profiles, Vault, or sequences.
--   * No BYPASSRLS / SUPERUSER / CREATEDB / CREATEROLE / REPLICATION.

-- ── VERIFICATION (run after apply; read-only + induced negatives) ───────────
--   1. As praxis_alert_ro: the four readonly-sql queries return counts (no error).
--   2. As praxis_alert_ro: INSERT/UPDATE/DELETE/TRUNCATE on each table → 42501.
--   3. Column overreach: SELECT exchange_order_id FROM trades /
--      raw_payload FROM webhook_logs / failure_reason FROM trades_dlq → 42501.
--   4. Table overreach: SELECT * FROM user_exchange_credentials / bots /
--      reconciliation_jobs → 42501.
--   5. No service_role membership: pg_auth_members lookup for praxis_alert_ro → empty.
--   6. No elevated attrs: pg_roles row for praxis_alert_ro → rolsuper/rolbypassrls/
--      rolcreatedb/rolcreaterole/rolreplication all false.
--   7. RLS scoping: as praxis_alert_ro, count(*) on trades = pending/unknown count,
--      not the all-rows count.
