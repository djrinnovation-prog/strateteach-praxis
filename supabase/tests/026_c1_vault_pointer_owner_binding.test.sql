-- ============================================================================
-- LOCAL-ONLY test for migration 026 — C-1 cross-user owner-binding TRIGGER.
-- (The live partial unique index is migration 030 — see 030_*.test.sql.)
-- LOCAL Supabase ONLY (never --linked). Requires 001..030 applied locally
-- (`supabase db reset`). One transaction, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/026_c1_vault_pointer_owner_binding.test.sql
-- Runs as postgres (RLS bypassed); the 026 trigger is NOT auth.uid()-gated, so it fires for all roles.
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000026', 'binance-t026', 'Binance T026', 'binance-t026');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a6', 'ua026@test.local'),
  ('b0000000-0000-0000-0000-0000000000b6', 'ub026@test.local');
-- User A owns credential c1 pointing at vault pointer V.
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0261', 'a0000000-0000-0000-0000-0000000000a6', 'e0000000-0000-0000-0000-000000000026', 'vault-A-0261', 'c1', 'valid', 'testnet');

-- Trigger present (the index belongs to 030).
do $$
begin
  assert exists (select 1 from pg_trigger where tgname='trg_credential_vault_pointer_owner'), '026: owner-binding trigger present';
end $$;

-- NEGATIVE (the C-1 exploit): user B attaches a credential pointing at A's vault pointer → REJECTED by trigger.
do $$
begin
  begin
    insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
      ('c0000000-0000-0000-0000-0000000c0262', 'b0000000-0000-0000-0000-0000000000b6', 'e0000000-0000-0000-0000-000000000026', 'vault-A-0261', 'attack', 'valid', 'testnet');
    raise exception '026: expected cross-user vault_secret_id to be REJECTED';
  exception when insufficient_privilege then null;  -- expected (errcode 42501 from the trigger)
  end;
end $$;

-- POSITIVE: user B may attach a credential on a DIFFERENT pointer — the trigger only blocks cross-user REUSE.
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0263', 'b0000000-0000-0000-0000-0000000000b6', 'e0000000-0000-0000-0000-000000000026', 'vault-B-0263', 'b1', 'valid', 'testnet');
do $$
begin
  assert exists (select 1 from public.user_exchange_credentials where id='c0000000-0000-0000-0000-0000000c0263'),
    '026: a distinct-pointer credential for another user must be ALLOWED';
  raise notice '026 PASS: cross-user pointer reuse rejected; distinct-pointer attach allowed.';
end $$;

rollback;
