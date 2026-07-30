-- ============================================================================
-- LOCAL-ONLY test for migration 031 — create_vault_secret() Vault WRITE wrapper.
-- LOCAL Supabase ONLY (never --linked). Requires 001..031 applied locally
-- (`supabase db reset`). One transaction, ROLLS BACK — the throwaway test secret is
-- created and rolled back (never persisted); values are FAKE, never a real key.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/031_create_vault_secret.test.sql
-- ============================================================================

begin;

-- Positive: write a FAKE secret, get a uuid, and read it back byte-for-byte via get_decrypted_secret.
do $$
declare
  v_id uuid;
  v_json text := '{"api_key":"AK_TEST_031","api_secret":"SK_TEST_031"}';
  v_read text;
begin
  v_id := public.create_vault_secret(v_json, 'test/031/roundtrip', 'local test');
  assert v_id is not null, '031: create_vault_secret must return a uuid';
  v_read := public.get_decrypted_secret(v_id);
  assert v_read = v_json, '031: round-trip via get_decrypted_secret must equal what was written';
  assert exists (select 1 from vault.secrets where id = v_id and name = 'test/031/roundtrip'),
    '031: vault.secrets row present with the given name';
end $$;

-- Fail-closed: a duplicate name raises unique_violation.
do $$
declare v_id uuid;
begin
  v_id := public.create_vault_secret('{"api_key":"x","api_secret":"y"}', 'test/031/dup', 'first');
  begin
    v_id := public.create_vault_secret('{"api_key":"a","api_secret":"b"}', 'test/031/dup', 'second');
    raise exception '031: expected duplicate name to be REJECTED';
  exception when unique_violation then null;  -- expected
  end;
end $$;

-- Grants: service_role EXECUTE; anon/authenticated/PUBLIC NOT.
do $$
declare v_oid oid := 'public.create_vault_secret(text,text,text)'::regprocedure;
begin
  assert has_function_privilege('service_role', v_oid, 'EXECUTE'), '031: service_role MUST execute';
  assert not has_function_privilege('anon', v_oid, 'EXECUTE'), '031: anon must NOT execute';
  assert not has_function_privilege('authenticated', v_oid, 'EXECUTE'), '031: authenticated must NOT execute';
  raise notice '031 PASS: write->read round-trip + duplicate-name reject + service_role-only grants.';
end $$;

rollback;
