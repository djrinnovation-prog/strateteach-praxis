-- ============================================================================
-- LOCAL-ONLY test for migration 022 — operator_status() S1a credential_shared/shared_with_count.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..022 applied locally
-- (`supabase db reset`). Drives auth.uid() via the request.jwt.claims GUC. One txn, ROLLS BACK.
--   supabase db query --file supabase/tests/022_operator_status_credential_shared.test.sql   (or psql -f)
-- ============================================================================

begin;

-- This test predates the single-use index (023/030), which forbids two LIVE bots sharing one
-- credential. Its whole purpose is to prove operator_status still REPORTS that shared state
-- (defense-in-depth for any legacy row), so we must reconstruct it. Drop the index INSIDE this
-- transaction only — Postgres DDL is transactional, so the `rollback;` at the end restores it and the
-- production constraint is never weakened. (LOCAL test DB only; never --linked.)
drop index if exists public.bots_credential_single_use_uidx;

-- ---- Fixture: 1 operator/user, 1 exchange, 2 credentials (shared + single-use) --------------
insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000022', 'binance-t022', 'Binance T022', 'binance-t022');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000022', 'op022@test.local');
update public.profiles set is_operator = true where id = 'a0000000-0000-0000-0000-000000000022';
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0022', 'a0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000022', '33333333-3333-3333-3333-333333333333', 'shared', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-0000000c0023', 'a0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000022', '44444444-4444-4444-4444-444444444444', 'single', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-0000000c0024', 'a0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000022', '55555555-5555-5555-5555-555555555555', 'five',   'valid', 'testnet'); -- LIVE-SHAPE: 5 bots share this

-- Bots: b1 + b2 share cred SHARED (both live); b3 single-use; b4 null credential; b5 shares SHARED but SOFT-DELETED.
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, deleted_at) values
  ('b0000000-0000-0000-0000-0000000b0001', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0022', 'shared-1', 'AAAUSDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000b0002', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0022', 'shared-2', 'BBBUSDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000b0003', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0023', 'single',   'CCCUSDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000b0004', 'a0000000-0000-0000-0000-000000000022', NULL,                                    'nullcred', 'DDDUSDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000b0005', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0022', 'soft-del', 'EEEUSDT', 'x', 'active', now());

-- LIVE-SHAPE case: 5 live bots all share ONE credential (mirrors the current linked-DB fleet). Each must
-- report credential_shared=true and shared_with_count=4 (the OTHER four).
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, deleted_at) values
  ('b0000000-0000-0000-0000-0000000f0001', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0024', 'five-1', 'F01USDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000f0002', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0024', 'five-2', 'F02USDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000f0003', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0024', 'five-3', 'F03USDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000f0004', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0024', 'five-4', 'F04USDT', 'x', 'active', NULL),
  ('b0000000-0000-0000-0000-0000000f0005', 'a0000000-0000-0000-0000-000000000022', 'c0000000-0000-0000-0000-0000000c0024', 'five-5', 'F05USDT', 'x', 'active', NULL);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000022","role":"authenticated"}', true);

do $$
declare
  v jsonb;
  b jsonb;
begin
  v := public.operator_status();

  -- Soft-deleted bot b5 is NOT listed (outer deleted_at IS NULL filter).
  assert (select count(*) from jsonb_array_elements(v->'bots') e where e->>'trading_pair' = 'EEEUSDT') = 0,
    '022: soft-deleted bot excluded from operator_status.bots';
  -- Exactly the 9 live bots are present (b1..b4 + five-1..five-5; b5 soft-deleted excluded).
  assert jsonb_array_length(v->'bots') = 9, '022: exactly 9 live bots listed (soft-deleted excluded)';

  -- LIVE-SHAPE: each of the 5 bots sharing one credential → credential_shared=true, shared_with_count=4.
  assert (select count(*) from jsonb_array_elements(v->'bots') e
          where e->>'trading_pair' like 'F0%USDT'
            and (e->>'credential_shared')::boolean = true
            and (e->>'shared_with_count')::int = 4) = 5,
    '022: 5 bots sharing one credential each report credential_shared=true + shared_with_count=4';

  -- b1 (shared, live): credential_shared=true, shared_with_count=1 (b2 only; b5 soft-deleted excluded).
  b := (select e from jsonb_array_elements(v->'bots') e where e->>'trading_pair' = 'AAAUSDT');
  assert (b->>'credential_shared')::boolean = true,  '022: b1 credential_shared = true';
  assert (b->>'shared_with_count')::int    = 1,      '022: b1 shared_with_count = 1 (soft-deleted peer excluded)';

  -- b2 (shared, live): mirror of b1.
  b := (select e from jsonb_array_elements(v->'bots') e where e->>'trading_pair' = 'BBBUSDT');
  assert (b->>'credential_shared')::boolean = true,  '022: b2 credential_shared = true';
  assert (b->>'shared_with_count')::int    = 1,      '022: b2 shared_with_count = 1';

  -- b3 (single-use): false / 0.
  b := (select e from jsonb_array_elements(v->'bots') e where e->>'trading_pair' = 'CCCUSDT');
  assert (b->>'credential_shared')::boolean = false, '022: b3 credential_shared = false';
  assert (b->>'shared_with_count')::int    = 0,      '022: b3 shared_with_count = 0';

  -- b4 (null credential): false / 0 (NOT null).
  b := (select e from jsonb_array_elements(v->'bots') e where e->>'trading_pair' = 'DDDUSDT');
  assert (b ? 'credential_shared'),                  '022: b4 credential_shared key present';
  assert (b->'credential_shared') <> 'null'::jsonb,  '022: b4 credential_shared is not null';
  assert (b->>'credential_shared')::boolean = false, '022: b4 credential_shared = false (null credential)';
  assert (b->>'shared_with_count')::int    = 0,      '022: b4 shared_with_count = 0 (null credential)';

  -- Existing 020 shape preserved (spot-check).
  assert (v->'bots'->0) ? 'id' and (v->'bots'->0) ? 'execution_ready' and (v ? 'kill_rpc_present'),
    '022: existing operator_status shape preserved';

  -- No secrets in the payload.
  assert not (v::text ~* '(webhook_secret_hash|token|secret|vault|password|service_role)'),
    '022: no secret substrings in payload';
end $$;
select set_config('request.jwt.claims', '', true);

-- Authz preserved: non-operator / null uid → 42501.
do $$
begin
  begin
    perform public.operator_status();
    raise exception '022: expected 42501 for null-uid caller';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;

do $$ begin raise notice 'ALL 022 TESTS PASSED'; end $$;

rollback;
