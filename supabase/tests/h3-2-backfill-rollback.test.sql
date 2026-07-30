-- ============================================================================
-- LOCAL-ONLY test for the H3-2 rollback (docs/sql/h3-2-backfill-rollback.sql) — POSITIVE.
-- Seeds the expected POST-backfill state (297dddb9 kept on SHARED_CRED; the 4
-- MOVED bots on 4 h3-2-* creds), runs a COPY of the rollback body (identical to
-- the packet, sans begin/commit), and asserts the pre-backfill state is restored.
-- One txn, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/h3-2-backfill-rollback.test.sql
-- ============================================================================

begin;

-- Indexes added AFTER this test (023/030 single-use + vault-unique) forbid the shared pre-state this
-- test reconstructs. Drop them INSIDE this transaction only; the `rollback;` restores them (Postgres
-- DDL is transactional) so the production constraints are never weakened. LOCAL test DB only.
drop index if exists public.bots_credential_single_use_uidx;
drop index if exists public.credentials_vault_secret_id_live_uidx;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-0000000000fb', 'binance-rb', 'Binance RB', 'binance-rb');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000fb', 'urb@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'a0000000-0000-0000-0000-0000000000fb', 'e0000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000aa', 'shared', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fb01', 'a0000000-0000-0000-0000-0000000000fb', 'e0000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m1', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fb02', 'a0000000-0000-0000-0000-0000000000fb', 'e0000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m2', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fb03', 'a0000000-0000-0000-0000-0000000000fb', 'e0000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m3', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-00000000fb04', 'a0000000-0000-0000-0000-0000000000fb', 'e0000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000aa', 'h3-2-m4', 'valid', 'testnet');
-- 297dddb9 kept on SHARED_CRED; the 4 MOVED bots on the 4 h3-2-* creds.
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('297dddb9-965b-49ff-abd8-e3e8e88fa4fc', 'a0000000-0000-0000-0000-0000000000fb', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'rb0', 'Q0USDT', 'x', 'active', false),
  ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2', 'a0000000-0000-0000-0000-0000000000fb', 'c0000000-0000-0000-0000-00000000fb01', 'rb1', 'Q1USDT', 'x', 'active', false),
  ('36b46eb3-9384-4e05-a79b-1246e9b85119', 'a0000000-0000-0000-0000-0000000000fb', 'c0000000-0000-0000-0000-00000000fb02', 'rb2', 'Q2USDT', 'x', 'active', false),
  ('5acc84c9-edd2-4c9f-87dd-fd928f8b62cd', 'a0000000-0000-0000-0000-0000000000fb', 'c0000000-0000-0000-0000-00000000fb03', 'rb3', 'Q3USDT', 'x', 'active', false),
  ('c8913354-8b7e-4d8d-8b3d-fb8b8f8248df', 'a0000000-0000-0000-0000-0000000000fb', 'c0000000-0000-0000-0000-00000000fb04', 'rb4', 'Q4USDT', 'x', 'active', false);

-- ==== INLINED rollback body (mirrors docs/sql/h3-2-backfill-rollback.sql) ====
-- PRE-GUARDS
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  v_moved uuid[] := array['2dcaddba-b62d-47e1-87a7-7f7b759f38d2','36b46eb3-9384-4e05-a79b-1246e9b85119',
    '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df']::uuid[];
  v_live int; v_h32 int; v_enabled int; v_nontestnet int; v_bots_on_h32 uuid[]; v_maxref int;
begin
  select count(*) into v_live from public.bots where deleted_at is null;
  if v_live <> 5 then raise exception 'rollback PRE: expected 5 live bots, found %', v_live; end if;
  select count(*) into v_h32 from public.user_exchange_credentials c
    where c.user_id = (select user_id from public.user_exchange_credentials where id = v_shared)
      and c.exchange_id = (select exchange_id from public.user_exchange_credentials where id = v_shared)
      and c.label like 'h3-2-%';
  if v_h32 <> 4 then raise exception 'rollback PRE: expected 4 h3-2-* rows, found %', v_h32; end if;
  select array_agg(b.id order by b.id) into v_bots_on_h32
    from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.label like 'h3-2-%';
  if v_bots_on_h32 is distinct from v_moved then raise exception 'rollback PRE: unexpected bot set on h3-2-* rows'; end if;
  select coalesce(max(cnt),0) into v_maxref from (
    select b.credential_id, count(*) cnt from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
      where b.deleted_at is null and c.label like 'h3-2-%' group by b.credential_id) t;
  if v_maxref > 1 then raise exception 'rollback PRE: an h3-2-* row shared by >1 live bot'; end if;
  select count(*) into v_enabled from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled <> 0 then raise exception 'rollback PRE: enabled bot(s)'; end if;
  select count(*) into v_nontestnet from public.user_exchange_credentials c
    where (c.id = v_shared or c.label like 'h3-2-%')
      and c.user_id = (select user_id from public.user_exchange_credentials where id = v_shared)
      and c.exchange_environment is distinct from 'testnet';
  if v_nontestnet <> 0 then raise exception 'rollback PRE: non-testnet credential involved'; end if;
end $$;
drop index if exists public.bots_credential_single_use_uidx;
do $$
declare v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b'; r record; v_reverted int := 0;
begin
  for r in select b.id as bot_id, b.credential_id as new_cred
           from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
           where b.deleted_at is null and c.label like 'h3-2-%' loop
    update public.bots set credential_id = v_shared where id = r.bot_id;
    delete from public.user_exchange_credentials where id = r.new_cred and label like 'h3-2-%';
    v_reverted := v_reverted + 1;
  end loop;
  if v_reverted <> 4 then raise exception 'rollback: expected to revert 4, reverted %', v_reverted; end if;
end $$;
do $$
declare v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b'; v_on_shared int; v_h32 int;
begin
  select count(*) into v_on_shared from public.bots where credential_id = v_shared and deleted_at is null;
  if v_on_shared <> 5 then raise exception 'rollback POST: expected 5 on SHARED_CRED, found %', v_on_shared; end if;
  select count(*) into v_h32 from public.user_exchange_credentials where label like 'h3-2-%';
  if v_h32 <> 0 then raise exception 'rollback POST: h3-2-* rows remain'; end if;
end $$;
-- ==== end inlined body ====

do $$ begin raise notice 'ALL H3-2 ROLLBACK TESTS PASSED'; end $$;

rollback;
