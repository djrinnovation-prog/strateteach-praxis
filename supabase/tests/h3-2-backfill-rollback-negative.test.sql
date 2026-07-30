-- ============================================================================
-- LOCAL-ONLY NEGATIVE test: the H3-2 rollback PRE-guard ABORTS if an UNEXPECTED
-- bot uses one of the h3-2-* credential rows (fleet changed since backfill).
-- Seeds a state where one h3-2-* row is used by a bot NOT in the expected 4 moved
-- ids, and asserts the guard raises. One txn, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/h3-2-backfill-rollback-negative.test.sql
-- ============================================================================

begin;

-- Indexes added AFTER this test (023/030 single-use + vault-unique) forbid the shared pre-state this
-- test reconstructs. Drop them INSIDE this transaction only; the `rollback;` restores them (Postgres
-- DDL is transactional) so the production constraints are never weakened. LOCAL test DB only.
drop index if exists public.bots_credential_single_use_uidx;
drop index if exists public.credentials_vault_secret_id_live_uidx;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-0000000000fc', 'binance-rc', 'Binance RC', 'binance-rc');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000fc', 'urc@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'a0000000-0000-0000-0000-0000000000fc', 'e0000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000aa', 'shared', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fc01', 'a0000000-0000-0000-0000-0000000000fc', 'e0000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m1', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fc02', 'a0000000-0000-0000-0000-0000000000fc', 'e0000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m2', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fc03', 'a0000000-0000-0000-0000-0000000000fc', 'e0000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m3', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fc04', 'a0000000-0000-0000-0000-0000000000fc', 'e0000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m4', 'valid', 'testnet');
-- 3 expected moved bots + 1 UNEXPECTED bot on an h3-2-* row (eeeeeeee… instead of c8913354…), + kept bot.
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('297dddb9-965b-49ff-abd8-e3e8e88fa4fc', 'a0000000-0000-0000-0000-0000000000fc', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'k0', 'Q0USDT', 'x', 'active', false),
  ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2', 'a0000000-0000-0000-0000-0000000000fc', 'c0000000-0000-0000-0000-00000000fc01', 'm1', 'Q1USDT', 'x', 'active', false),
  ('36b46eb3-9384-4e05-a79b-1246e9b85119', 'a0000000-0000-0000-0000-0000000000fc', 'c0000000-0000-0000-0000-00000000fc02', 'm2', 'Q2USDT', 'x', 'active', false),
  ('5acc84c9-edd2-4c9f-87dd-fd928f8b62cd', 'a0000000-0000-0000-0000-0000000000fc', 'c0000000-0000-0000-0000-00000000fc03', 'm3', 'Q3USDT', 'x', 'active', false),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'a0000000-0000-0000-0000-0000000000fc', 'c0000000-0000-0000-0000-00000000fc04', 'mX', 'QXUSDT', 'x', 'active', false);

-- Run the rollback exact-bot-set guard (copied) and assert it RAISES.
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  v_moved uuid[] := array['2dcaddba-b62d-47e1-87a7-7f7b759f38d2','36b46eb3-9384-4e05-a79b-1246e9b85119',
    '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df']::uuid[];
  v_bots_on_h32 uuid[]; v_raised boolean := false;
begin
  begin
    select array_agg(b.id order by b.id) into v_bots_on_h32
      from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
      where b.deleted_at is null and c.label like 'h3-2-%';
    if v_bots_on_h32 is distinct from v_moved then
      raise exception 'H3-2 rollback PRE: unexpected bot set on h3-2-* rows';
    end if;
  exception when others then
    v_raised := true;
  end;
  assert v_raised, 'NEGATIVE rollback: guard must ABORT when an unexpected bot uses an h3-2-* row';
end $$;

do $$ begin raise notice 'ALL H3-2 ROLLBACK-NEGATIVE TESTS PASSED'; end $$;

rollback;
