-- ============================================================================
-- LOCAL-ONLY test for migration 039 — M1 single-use provisioning-ticket ledger.
-- LOCAL Supabase ONLY. Requires 001..039 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/039_provision_tickets_used.test.sql
-- Asserts: the jti primary key enforces single-use (a duplicate insert fails), and the table is
-- service_role-only (anon/authenticated have NO privilege).
-- ============================================================================

begin;

do $$
begin
  -- single-use: the same jti cannot be claimed twice (primary-key conflict).
  insert into public.provision_tickets_used (jti) values ('jti-test-0001');
  begin
    insert into public.provision_tickets_used (jti) values ('jti-test-0001');
    raise exception '039: duplicate jti must have been rejected';
  exception when unique_violation then null;   -- expected
  end;

  -- service_role retains access; anon/authenticated have none.
  assert has_table_privilege('service_role', 'public.provision_tickets_used', 'INSERT'),
    '039: service_role must INSERT';
  assert not has_table_privilege('authenticated', 'public.provision_tickets_used', 'SELECT'),
    '039: authenticated must NOT SELECT';
  assert not has_table_privilege('anon', 'public.provision_tickets_used', 'INSERT'),
    '039: anon must NOT INSERT';
end $$;

rollback;
