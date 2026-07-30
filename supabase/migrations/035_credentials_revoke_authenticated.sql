-- Migration 035 — T6 / C-1 residual: revoke ALL authenticated + anon access to
-- user_exchange_credentials (the exchange-key pointer table).
--
-- WHY (residual after 026/030/031/034):
--   026 added a cross-user owner-binding trigger and 034 locked columns on `bots` — but
--   nothing revoked the *role-level* access to user_exchange_credentials itself. Via
--   Supabase's platform default `GRANT ALL … TO authenticated`, an authenticated user
--   still held table-level SELECT/INSERT/UPDATE on their own rows (RLS `credentials_*`
--   policies, 001:491-504 / 028), so they could read AND set `vault_secret_id` — the exact
--   pointer 026's header said "the client should never set … it must be server-set".
--   A COLUMN-level revoke would be a no-op while the table-level grant stands, so this is a
--   TABLE-level revoke.
--
-- WHY IT IS SAFE (verified from code, this snapshot):
--   - No authenticated/anon code path touches this table: the frontend never references it
--     (it reads only via SECURITY DEFINER RPCs — 032 operator fleet, 033 user dashboard —
--     which run as the function owner and already redact vault_secret_id), and no edge
--     function does either.
--   - Credential provisioning runs as service_role (worker/scripts/provision-tiny-live.mjs →
--     create_vault_secret RPC (031, service_role) + service_role INSERT).
--   - service_role is a SEPARATE role (BYPASSRLS + its own grants, migration 006 +
--     platform defaults) and is UNTOUCHED by a revoke FROM authenticated/anon.
--   - The DEFINER RPCs (031 create_vault_secret, 032/033 dashboards) execute with the
--     function owner's privileges, so they keep working; the 032/033 tests (run after all
--     migrations apply) transitively confirm the dashboards are not broken.
--   The dormant RLS policies are left in place (harmless with no grant) as defense in depth:
--   if a grant is ever re-added, ownership scoping still applies.
--
-- FORWARD-LOOKING (do not reintroduce the hole): if a future connect-exchange edge function
--   is added, it MUST run as service_role or via a SECURITY DEFINER insert RPC — never a
--   direct INSERT under the end-user's authenticated JWT (that path is revoked here).

revoke all on public.user_exchange_credentials from authenticated;
revoke all on public.user_exchange_credentials from anon;
-- PUBLIC too: authenticated/anon INHERIT PUBLIC grants, so a table grant to PUBLIC would
-- back-door access even after the revokes above. No-op when PUBLIC already holds nothing.
revoke all on public.user_exchange_credentials from public;
