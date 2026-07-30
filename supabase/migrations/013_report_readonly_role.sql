-- 013_report_readonly_role.sql
-- ============================================================================
-- S4-2 evidence — least-privilege read-only role `praxis_report_ro`
-- ============================================================================
-- Purpose: a dedicated, SELECT-only Postgres role for the Sprint-4 evidence
-- reporter (worker/tools/reporter/sprint4-evidence.ts, `npm run sprint4:evidence`).
-- It can answer EXACTLY the reporter's read-only queries (campaign counts,
-- duplicate checks, DLQ/queue_failed/stuck/reconciliation snapshots, queue
-- length via a wrapper) and NOTHING that mutates or reads beyond those columns.
--
-- This role is intentionally BROADER than `praxis_alert_ro` (011): the reporter
-- needs ALL trades (every status, for by-status/per-symbol/dup/distinct counts)
-- and reconciliation_jobs by status — neither of which the alert role can see.
-- That is WHY a separate role exists: the alert role stays minimal; the report
-- role gets exactly the evidence surface, still read-only and column-scoped.
--
-- ADDITIVE and ORTHOGONAL to Migration 009 (frozen): creates ONE new role, one
-- SECURITY DEFINER count wrapper, and grants/policies scoped EXCLUSIVELY to that
-- role. Does NOT modify service_role / anon / authenticated / praxis_edge /
-- praxis_alert_ro, any existing policy, function, or table structure. 009 frozen.
--
-- ── APPLY DISCIPLINE (read before applying) ─────────────────────────────────
--  - NOT auto-applied; committing implies no `db push`.
--  - Migration-history exception (010/011/012 applied surgically, NOT in
--    supabase_migrations): apply 013 EITHER surgically via direct SQL (idempotent;
--    track the written exception) OR reconcile history first — separate gated approval.
--    A naive `db push` would attempt to re-apply 010/011/012.
--
-- ── ROLE CREDENTIAL PROVISIONING (separate, operator-controlled) ────────────
--  - Created with LOGIN but WITHOUT a password (secret hygiene). Provision out of
--    band:  ALTER ROLE praxis_report_ro PASSWORD '<secret>';  (store in Doppler as
--    the password behind PRAXIS_REPORT_DSN; never in git / this file).
--  - Applying this migration does NOT make the reporter operational until the
--    password is provisioned AND a session-capable DSN (:5432 / session pooler,
--    NOT the :6543 transaction pooler — the reporter issues session SETs) is wired.
-- ============================================================================

-- 1. Role: login-capable, no privileges of its own, subject to RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'praxis_report_ro') THEN
    CREATE ROLE praxis_report_ro WITH
      LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
END$$;

COMMENT ON ROLE praxis_report_ro IS
  'S4-2 evidence reporter: SELECT-only role (column-scoped). No password here
   (operator-provisioned out-of-band; secret in Doppler behind PRAXIS_REPORT_DSN).
   No service_role membership, NOBYPASSRLS. See migration 013.';

-- 2. Schema usage — required to reference public.* objects at all. (NOT pgmq:
--    queue length is read via the SECURITY DEFINER wrapper in §5, so the role
--    never gets direct access to pgmq internal tables.)
GRANT USAGE ON SCHEMA public TO praxis_report_ro;

-- 3. Column-level SELECT — ONLY the columns the reporter reads.
--    trades: every status is counted, so by-status/per-symbol/dup/distinct/stuck
--      need these 8 columns. NOT granted: bot_id, user_id, side, quantity,
--      price_at_signal, price_at_execution, error_reason, last_attempt_at,
--      filled_at, updated_at (PII / not read by the reporter).
GRANT SELECT (id, signal_id, client_order_id, trading_pair, exchange_order_id, status, created_at, deleted_at)
  ON public.trades            TO praxis_report_ro;

-- trades_dlq: COUNT only. count(*) needs no column privilege (only RLS row-visibility); granting
--   created_at is harmless, exposes no DLQ contents, and future-proofs a minimal read column.
GRANT SELECT (created_at)     ON public.trades_dlq        TO praxis_report_ro;

-- webhook_logs: queue_failed COUNT only → status column only.
GRANT SELECT (status)         ON public.webhook_logs      TO praxis_report_ro;

-- reconciliation_jobs: COUNT BY status only → status column only. NOT granted:
--   trade_id, resolution, notes, resolved_at, id (no per-job detail to the role).
GRANT SELECT (status)         ON public.reconciliation_jobs TO praxis_report_ro;

-- 4. RLS read policies scoped TO praxis_report_ro (RLS is ENABLED on all four
--    tables; a NOBYPASSRLS direct connection has auth.uid()=NULL → WITHOUT these
--    the role would see ZERO rows and every count would be a silent 0). Each is
--    scoped to the role, so existing user/service policies are untouched.
--    reconciliation_jobs currently has only `recon_no_user_access USING(FALSE)`;
--    this adds a role-scoped SELECT policy alongside it. DROP IF EXISTS → idempotent.

-- trades: the reporter needs ALL rows (every status) for the campaign counts.
--   Row scope is all-rows BY DESIGN (evidence reporter); least-privilege is held
--   at the COLUMN layer (§3) — no bot_id/user_id/quantity/price/error_reason.
DROP POLICY IF EXISTS report_ro_trades_select       ON public.trades;
CREATE POLICY report_ro_trades_select       ON public.trades
  FOR SELECT TO praxis_report_ro
  USING (true);

-- trades_dlq: all rows (count); column scope = created_at only.
DROP POLICY IF EXISTS report_ro_dlq_select          ON public.trades_dlq;
CREATE POLICY report_ro_dlq_select          ON public.trades_dlq
  FOR SELECT TO praxis_report_ro
  USING (true);

-- webhook_logs: ONLY queue_failed rows (the only ones the reporter counts).
DROP POLICY IF EXISTS report_ro_webhook_select      ON public.webhook_logs;
CREATE POLICY report_ro_webhook_select      ON public.webhook_logs
  FOR SELECT TO praxis_report_ro
  USING (status = 'queue_failed');

-- reconciliation_jobs: all rows (count by status); column scope = status only.
DROP POLICY IF EXISTS report_ro_recon_select        ON public.reconciliation_jobs;
CREATE POLICY report_ro_recon_select        ON public.reconciliation_jobs
  FOR SELECT TO praxis_report_ro
  USING (true);

-- 5. Queue length WITHOUT granting pgmq access. Mirrors the 007 pattern (pgmq's
--    own functions are not exposed; public SECURITY DEFINER wrappers are). This
--    wrapper returns ONLY a count for a named queue; the role never touches the
--    pgmq schema. STABLE + hardened search_path; EXECUTE granted to the role only.
-- search_path = '' (house pattern, cf. 007): everything referenced is fully schema-qualified, so a
-- writable schema is never on the definer's path. The function owner (the surgical-apply admin role)
-- must be able to read pgmq; confirm at apply time (see runbook).
CREATE OR REPLACE FUNCTION public.pgmq_queue_length(p_queue_name text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.queue_length FROM pgmq.metrics(p_queue_name) AS m;
$$;

COMMENT ON FUNCTION public.pgmq_queue_length(text) IS
  'S4-2 evidence: returns pgmq queue_length for a named queue. SECURITY DEFINER so
   praxis_report_ro reads queue depth WITHOUT direct pgmq access. Count only — no
   message contents. See migration 013.';

REVOKE ALL ON FUNCTION public.pgmq_queue_length(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pgmq_queue_length(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgmq_queue_length(text) TO praxis_report_ro;

-- ── INTENTIONALLY EXCLUDED ──────────────────────────────────────────────────
--   * No INSERT/UPDATE/DELETE/TRUNCATE on any table (writes fail 42501).
--   * No direct pgmq schema access (queue length via the wrapper only).
--   * No service_role membership / inheritance.
--   * No grants on bots, user_exchange_credentials, audit_logs, bot_events,
--     profiles, exchanges, Vault, or sequences.
--   * No BYPASSRLS / SUPERUSER / CREATEDB / CREATEROLE / REPLICATION.

-- ── VERIFICATION (run after apply; read-only + induced negatives) ───────────
--   1. As praxis_report_ro: every reporter query returns rows/counts (no error),
--      including SELECT public.pgmq_queue_length('trade_signals').
--   2. As praxis_report_ro: INSERT/UPDATE/DELETE on each table → 42501.
--   3. Column overreach: SELECT quantity/user_id FROM trades,
--      raw_payload FROM webhook_logs, notes FROM reconciliation_jobs → 42501.
--   4. Table overreach: SELECT * FROM user_exchange_credentials / bots / audit_logs → 42501.
--   5. pgmq isolation: SELECT * FROM pgmq.q_trade_signals AS praxis_report_ro → denied
--      (the wrapper is the only path).
--   6. No elevated attrs: pg_roles row → rolsuper/rolbypassrls/rolcreatedb/
--      rolcreaterole/rolreplication all false; pg_auth_members → no membership.
--   7. RLS: as the role, count(*) on trades = ALL trades; webhook_logs = queue_failed only.
