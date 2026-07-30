# LIVE-PATH — `create_vault_secret` migration packet (031)

The missing **Vault WRITE** wrapper that operator provisioning + the future `connect-exchange` Edge fn need.
Mirrors the existing read (`get_decrypted_secret`, 004) and delete (`delete_vault_secret`, 005) wrappers.
**Packet only — NOT written to `supabase/migrations/`, NOT executed, NOT applied. No Vault secret created.**

## Design
- New `public.create_vault_secret(secret_value text, secret_name text, secret_description text)` →
  wraps `vault.create_secret(...)` and returns the new secret's **uuid** (= the `vault_secret_id`).
- **SECURITY DEFINER** + `SET search_path = ''` (so the definer's vault privileges are used; caller needs no
  direct vault access — exactly like 004/005). Owned by the migration superuser (has vault access).
- **service_role-only**: revoke PUBLIC/anon/authenticated, grant EXECUTE to service_role.
- **Returns ONLY the uuid** — never the secret, never the name/description echoed.
- **No secret logging**: the body contains no RAISE/log of `secret_value`; PostgREST call is over TLS,
  service_role-only.
- **Fail-closed on duplicate name**: `vault.secrets.name` is unique, so a re-run with the same name raises
  `unique_violation` (propagates to the caller) — no silent duplicate secret.

## Migration SQL (proposed `031_create_vault_secret_function.sql`)
```sql
-- Migration 031: create_vault_secret() — Vault WRITE wrapper (mirrors 004 read / 005 delete).
-- SECURITY DEFINER, service_role ONLY. Returns the new vault_secret_id (uuid). Never logs the secret.
-- Used by operator provisioning + the future connect-exchange Edge fn to store an exchange key in Vault so
-- the DB holds only the pointer (vault_secret_id). Apply SURGICALLY (db query --linked --file), NEVER db push.

create or replace function public.create_vault_secret(
  secret_value       text,
  secret_name        text,
  secret_description text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- vault.create_secret(new_secret, new_name, new_description) returns the new secret's uuid.
  -- The plaintext is written straight into Vault; it is NEVER logged or returned by this function.
  select vault.create_secret(secret_value, secret_name, secret_description) into v_id;
  return v_id;
end;
$$;

-- service_role only — never anon/authenticated/PUBLIC (mirrors 004/005).
revoke all on function public.create_vault_secret(text, text, text) from public;
revoke all on function public.create_vault_secret(text, text, text) from anon;
revoke all on function public.create_vault_secret(text, text, text) from authenticated;
grant execute on function public.create_vault_secret(text, text, text) to service_role;
```

## Local test (proposed `supabase/tests/031_create_vault_secret.test.sql`) — transaction-rollback, LOCAL only
Proves the write→read round-trip and the grants. Runs as postgres; the throwaway test secret is created and
then **rolled back** (never persisted); it is a fake value, never the real Binance key.
```sql
begin;

-- Positive: write a fake secret, get a uuid, and read it back byte-for-byte via get_decrypted_secret.
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
```

## Local validation plan (NEXT, separate — NOT run now)
On Codex PASS: materialize `031_create_vault_secret_function.sql` + the test file → `supabase db reset`
(applies 001..031 locally) → run `031_create_vault_secret.test.sql` via psql (rolls back). This creates only
a **throwaway LOCAL** test secret that is rolled back — it never touches the real mainnet Binance secret and
never runs against the linked DB.

## Linked apply packet (LATER, separate approval)
Surgical apply to the linked DB (`db query --linked --file 031_…sql`) → read-back
(`select 1 from pg_proc where proname='create_vault_secret'` + grant check) → record 031 in
`schema_migrations`. Only after that does operator provisioning (Doppler→Vault) become runnable.

## Boundaries
No file written to `supabase/migrations/` yet. No execution, no `db reset`, no linked apply, no deploy. **No
Vault secret created. No credential row. No secret read or printed. No mainnet order.** Nothing until Codex PASS.
