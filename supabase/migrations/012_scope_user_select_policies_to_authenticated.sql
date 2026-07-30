-- 012_scope_user_select_policies_to_authenticated.sql
-- ============================================================================
-- S4-1 fix — scope the end-user SELECT policies from PUBLIC to `authenticated`
-- ============================================================================
-- Problem (found by the 011 as-role verification):
--   The three end-user SELECT policies created in 001 are PERMISSIVE with
--   roles = {public} (no TO clause), so they ALSO apply to `praxis_alert_ro`.
--   Permissive policies for the same command are OR-combined and ALL evaluated,
--   so the role's query is filtered by `user_policy.qual OR alert_ro_*.qual`.
--   Two of those user policies reference OTHER tables in a subquery:
--     - webhook_logs_select : bot_id IN (SELECT id FROM bots  WHERE ...)
--     - trades_dlq_select   : trade_id IN (SELECT id FROM trades WHERE ...)
--   Evaluating those subqueries needs SELECT on bots / trades columns the role
--   does NOT have, so as `praxis_alert_ro` a SELECT over a NON-EMPTY table errors
--   `42501 permission denied for table bots` (webhook_logs, 25 rows) — and would
--   do the same for trades_dlq the moment it has a row (today it is empty, which
--   is why it appeared to pass). Only `trades` works, because `trades_select`
--   references its OWN columns only (same-table refs are not subject to the
--   querying role's column grants).
--
-- Fix (least-invasive, no new access for the alert role):
--   These policies were always meant for END USERS. Scope them to the
--   `authenticated` role so they no longer apply to `praxis_alert_ro`; the role
--   is then governed SOLELY by the alert_ro_* policies from 011. We do NOT grant
--   the role any access to bots/trades; we do NOT add SECURITY DEFINER functions.
--
-- Safety analysis (why scoping to `authenticated` is behaviour-preserving):
--   - authenticated : unchanged — they ARE authenticated; same policy applies.
--   - anon          : loses these policies, but anon has NO table SELECT grants,
--                     and with auth.uid()=NULL the policies already returned no
--                     rows — so no functional change.
--   - service_role  : BYPASSRLS (Supabase default) — RLS policies do not apply to
--                     it at all, so worker/Edge are unaffected. (Confirm at apply:
--                     `SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role';` → true.)
--   - praxis_alert_ro: now governed only by alert_ro_* — the intended outcome.
--
-- No new access granted; policy-scope NARROWING only (PUBLIC -> authenticated).
-- ORTHOGONAL to Migration 009 (frozen) and Migration 011: it does NOT edit the
-- 001 / 009 / 011 files; it ALTERs the ROLES of three live policies only. No
-- table/column grants change.
--
-- ── APPLY DISCIPLINE (read before applying) ─────────────────────────────────
--  - NOT auto-applied. No `db push` is implied by committing it.
--  - Migration-010/011 history exception: 010 and 011 are applied but NOT in
--    `supabase_migrations`. A naive `db push` would try to (re)apply them. Apply
--    012 the same surgical way (Path A: `supabase db query --linked --file ...`)
--    under explicit approval, and log the written exception — OR reconcile history
--    first. Do NOT `db push` without that decision.
-- ============================================================================

-- Scope the three end-user SELECT policies to `authenticated`. ALTER POLICY only
-- changes the roles the policy applies to; it does NOT touch the USING expression,
-- the table, or any grant. This is a security-sensitive fix, so a MISSING expected
-- policy must FAIL LOUD (RAISE EXCEPTION) and abort the whole migration — never a
-- silent skip. Re-running is naturally idempotent: `ALTER POLICY ... TO authenticated`
-- is repeatable.
DO $$
BEGIN
  -- Pre-flight: every target policy must exist, else abort (no silent skip).
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'webhook_logs'
                   AND policyname = 'webhook_logs_select') THEN
    RAISE EXCEPTION 'migration 012: expected policy webhook_logs_select on public.webhook_logs is missing — aborting (no silent skip)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'trades_dlq'
                   AND policyname = 'trades_dlq_select') THEN
    RAISE EXCEPTION 'migration 012: expected policy trades_dlq_select on public.trades_dlq is missing — aborting (no silent skip)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'trades'
                   AND policyname = 'trades_select') THEN
    RAISE EXCEPTION 'migration 012: expected policy trades_select on public.trades is missing — aborting (no silent skip)';
  END IF;

  -- All present → narrow each from PUBLIC to authenticated.
  ALTER POLICY webhook_logs_select ON public.webhook_logs TO authenticated;
  ALTER POLICY trades_dlq_select   ON public.trades_dlq   TO authenticated;
  ALTER POLICY trades_select       ON public.trades       TO authenticated;
END$$;

-- Note: the *_no_user_insert/update/delete policies are intentionally LEFT as
-- {public} — their qual is FALSE (deny writes for everyone, which is desired for
-- praxis_alert_ro too) and they reference no other table, so they do not break the
-- alert role. Only the SELECT policies are scoped.

-- ── INTENTIONALLY EXCLUDED ──────────────────────────────────────────────────
--   * No grant of bots / trades access to praxis_alert_ro.
--   * No SECURITY DEFINER functions.
--   * No change to any table/column GRANT, to the alert_ro_* policies (011),
--     to the write-deny policies, or to Migration 009 (frozen).

-- ── VERIFICATION (run after apply; see docs runbook) ────────────────────────
--   Catalog (E2):
--     SELECT tablename, policyname, roles FROM pg_policies
--      WHERE policyname IN ('webhook_logs_select','trades_dlq_select','trades_select');
--       -> roles now {authenticated} for all three.
--   As praxis_alert_ro (E1): the webhook_logs queue_failed SELECT now succeeds
--     (no 42501 over 25 rows); write-negatives still 42501; column/table overreach
--     (incl. bots) still 42501; visible counts = expected (trades 0, webhook 1, dlq 0).

-- ── ROLLBACK (privileged session, explicit approval) ────────────────────────
--   ALTER POLICY webhook_logs_select ON public.webhook_logs TO public;
--   ALTER POLICY trades_dlq_select   ON public.trades_dlq   TO public;
--   ALTER POLICY trades_select       ON public.trades       TO public;
--   (restores the prior {public} scope; no data is touched.)
