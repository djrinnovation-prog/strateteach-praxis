-- 002_owner_only_grants.sql — the Oren boundary, enforced at the database.
--
-- Spec §7: the execution operator sees the whole execution plane (exec_bots,
-- exec_signals, exec_orders, exec_state, exec_credentials refs, caps,
-- reconciliation) but NOT the owners' fund, its movements, or the 3-of-3
-- approvals. Code-level checks are the first line; these grants are the line
-- that holds when code has a bug.
--
-- Two roles:
--   exec_operator_role — the execution plane + read-only audit.
--   exec_owner_role    — everything, including owner_fund / owner_approvals.
--
-- Wrapped in exception handlers: on a managed Postgres where the migration
-- user cannot create roles, this migration NOTICEs and moves on rather than
-- blocking the scaffold. In that case the boundary rests on code alone
-- (exec_service/access.py) — a known gap, tracked in the README, to close
-- before any real key or real money exists.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exec_operator_role') THEN
        CREATE ROLE exec_operator_role NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'exec_owner_role') THEN
        CREATE ROLE exec_owner_role NOLOGIN;
    END IF;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'execution-service: cannot create roles here; owner-only boundary rests on code (see README).';
END
$$;

DO $$
BEGIN
    -- Execution plane: the operator runs the machine.
    GRANT SELECT, INSERT, UPDATE ON exec_bots, exec_signals, exec_orders, exec_state TO exec_operator_role;
    -- Credential ROWS are refs, not secrets; the operator may see that a ref
    -- exists and which env it belongs to. Resolving the ref is the worker's
    -- job, against the vault, with its own separate credentials.
    GRANT SELECT ON exec_credentials TO exec_operator_role;
    -- Audit is readable by the operator and written by the service; nobody
    -- updates or deletes it (the trigger in 001 rejects both regardless).
    GRANT SELECT, INSERT ON audit_log TO exec_operator_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO exec_operator_role;

    -- OWNER-ONLY: explicitly revoked from the operator, granted to owners.
    REVOKE ALL ON owner_fund, owner_approvals FROM exec_operator_role;
    GRANT SELECT, INSERT, UPDATE ON owner_fund, owner_approvals TO exec_owner_role;

    -- Owners see everything the operator sees, too.
    GRANT exec_operator_role TO exec_owner_role;
EXCEPTION
    WHEN insufficient_privilege OR undefined_object THEN
        RAISE NOTICE 'execution-service: grants skipped (insufficient privilege); boundary rests on code (see README).';
END
$$;

COMMIT;
