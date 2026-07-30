-- ============================================================================
-- LOCAL-ONLY test for migration 035 — T6 / C-1 residual.
-- LOCAL Supabase ONLY (never --linked). Requires 001..035 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/035_credentials_revoke_authenticated.test.sql
--
-- Asserts EFFECTIVE privilege via has_table_privilege() (NOT a role_table_grants row count).
-- has_table_privilege folds in PUBLIC + role inheritance and is immune to catalog-visibility
-- quirks (a platform default grant made by supabase_admin may not appear as a postgres-visible
-- grant row) — so it proves "authenticated genuinely cannot touch the table", not merely
-- "no direct grant row is visible". After 035, authenticated + anon have NO privilege;
-- service_role retains access.
-- ============================================================================

begin;

do $$
begin
  -- authenticated: NO effective privilege of any kind.
  assert not has_table_privilege('authenticated', 'public.user_exchange_credentials', 'SELECT'),
    '035: authenticated must NOT have SELECT on user_exchange_credentials';
  assert not has_table_privilege('authenticated', 'public.user_exchange_credentials', 'INSERT'),
    '035: authenticated must NOT have INSERT on user_exchange_credentials';
  assert not has_table_privilege('authenticated', 'public.user_exchange_credentials', 'UPDATE'),
    '035: authenticated must NOT have UPDATE on user_exchange_credentials';
  assert not has_table_privilege('authenticated', 'public.user_exchange_credentials', 'DELETE'),
    '035: authenticated must NOT have DELETE on user_exchange_credentials';

  -- anon: same — no access.
  assert not has_table_privilege('anon', 'public.user_exchange_credentials', 'SELECT'),
    '035: anon must NOT have SELECT on user_exchange_credentials';
  assert not has_table_privilege('anon', 'public.user_exchange_credentials', 'INSERT'),
    '035: anon must NOT have INSERT on user_exchange_credentials';
  assert not has_table_privilege('anon', 'public.user_exchange_credentials', 'UPDATE'),
    '035: anon must NOT have UPDATE on user_exchange_credentials';
  assert not has_table_privilege('anon', 'public.user_exchange_credentials', 'DELETE'),
    '035: anon must NOT have DELETE on user_exchange_credentials';

  -- Positive control: service_role (the worker path) RETAINS access.
  assert has_table_privilege('service_role', 'public.user_exchange_credentials', 'SELECT'),
    '035: service_role must RETAIN SELECT on user_exchange_credentials';
  assert has_table_privilege('service_role', 'public.user_exchange_credentials', 'UPDATE'),
    '035: service_role must RETAIN UPDATE on user_exchange_credentials';
end $$;

rollback;
