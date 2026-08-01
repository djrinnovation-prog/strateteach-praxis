-- 043 — service_role table grants (cloud parity).
--
-- On a FRESH Supabase CLOUD project, migration-created public tables did NOT automatically receive the
-- service_role DML grants that local `supabase start` grants broadly. Result: the Edge functions (which run
-- as service_role) silently failed to INSERT/SELECT on several tables — e.g. `strateteach_user_link` had only
-- TRUNCATE/REFERENCES/TRIGGER, so provision-user returned `provision_link_failed` (createUser succeeded, the
-- link insert did not). The same gap affected `bots` (no INSERT → create-bot), `user_exchange_credentials`
-- (no INSERT → connect-credential), `exchanges` (no SELECT → venue gate), and `provisioning_audit` (no INSERT).
--
-- service_role is the trusted server-side backend role (it BYPASSES RLS by design); granting it full DML on
-- the public schema is the standard Supabase posture and does NOT widen anon/authenticated access (those stay
-- RLS-restricted + explicitly revoked where sensitive). This migration restores that posture explicitly so it
-- is reproducible on any environment, and sets DEFAULT PRIVILEGES so future public tables inherit it.
--
-- Idempotent (GRANT is repeatable). Safe to re-run.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Future tables created in public inherit the same service_role DML (matches the local default).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT                  ON SEQUENCES TO service_role;
