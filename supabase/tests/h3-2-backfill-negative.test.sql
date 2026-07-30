-- ============================================================================
-- LOCAL-ONLY NEGATIVE test: the H3-2 backfill PRE-guard ABORTS if the fleet
-- changed since discovery (one expected bot id missing / an unexpected id present).
-- Seeds 4 of the 5 expected ids + 1 UNEXPECTED id on SHARED_CRED (5 total, but the
-- id set differs) and asserts the exact-id guard raises. One txn, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/h3-2-backfill-negative.test.sql
-- ============================================================================

begin;

drop index public.bots_credential_single_use_uidx;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-0000000000ba', 'binance-ba', 'Binance BA', 'binance-ba');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000ba', 'uba@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'a0000000-0000-0000-0000-0000000000ba', 'e0000000-0000-0000-0000-0000000000ba', '00000000-0000-0000-0000-0000000000aa', 'shared', 'valid', 'testnet');
-- 4 EXPECTED ids + 1 UNEXPECTED id (dddddddd…) → count is 5 but the id SET differs.
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('297dddb9-965b-49ff-abd8-e3e8e88fa4fc', 'a0000000-0000-0000-0000-0000000000ba', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b1', 'P1USDT', 'x', 'active', false),
  ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2', 'a0000000-0000-0000-0000-0000000000ba', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b2', 'P2USDT', 'x', 'active', false),
  ('36b46eb3-9384-4e05-a79b-1246e9b85119', 'a0000000-0000-0000-0000-0000000000ba', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b3', 'P3USDT', 'x', 'active', false),
  ('5acc84c9-edd2-4c9f-87dd-fd928f8b62cd', 'a0000000-0000-0000-0000-0000000000ba', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b4', 'P4USDT', 'x', 'active', false),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'a0000000-0000-0000-0000-0000000000ba', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'bX', 'PXUSDT', 'x', 'active', false);

-- Run the exact-id guard (copied) and assert it RAISES.
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  v_expected uuid[] := array['297dddb9-965b-49ff-abd8-e3e8e88fa4fc','2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
    '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df']::uuid[];
  v_ids uuid[]; v_raised boolean := false;
begin
  begin
    select array_agg(id order by id) into v_ids from public.bots where credential_id = v_shared and deleted_at is null;
    if v_ids is distinct from v_expected then
      raise exception 'H3-2 backfill PRE: fleet changed';
    end if;
  exception when others then
    v_raised := true;
  end;
  assert v_raised, 'NEGATIVE backfill: exact-id PRE-guard must ABORT when the fleet id set differs';
end $$;

do $$ begin raise notice 'ALL H3-2 BACKFILL-NEGATIVE TESTS PASSED'; end $$;

rollback;
