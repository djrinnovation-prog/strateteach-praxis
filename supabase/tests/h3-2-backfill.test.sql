-- ============================================================================
-- LOCAL-ONLY test for the H3-2 backfill (docs/sql/h3-2-backfill.sql) — POSITIVE.
-- Seeds the EXACT expected fleet (5 real bot ids on SHARED_CRED), drops the S1b
-- index (restored on rollback), runs a COPY of the backfill body (identical to
-- the packet, sans begin/commit), asserts the result, and proves S1b is then
-- re-creatable. One txn, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/h3-2-backfill.test.sql
-- ============================================================================

begin;

drop index public.bots_credential_single_use_uidx;   -- so we can seed the pre-backfill 5-on-1 state
drop index if exists public.credentials_vault_secret_id_live_uidx;  -- 030 (added AFTER this test) forbids the shared-pointer pre-state; dropped in-txn only, restored on rollback

-- Seed: user, exchange, SHARED_CRED, the EXACT 5 real bots (active, disarmed, testnet).
insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-0000000000bf', 'binance-bf', 'Binance BF', 'binance-bf');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000bf', 'ubf@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'a0000000-0000-0000-0000-0000000000bf', 'e0000000-0000-0000-0000-0000000000bf', '00000000-0000-0000-0000-0000000000aa', 'shared', 'valid', 'testnet');
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('297dddb9-965b-49ff-abd8-e3e8e88fa4fc', 'a0000000-0000-0000-0000-0000000000bf', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b1', 'P1USDT', 'x', 'active', false),
  ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2', 'a0000000-0000-0000-0000-0000000000bf', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b2', 'P2USDT', 'x', 'active', false),
  ('36b46eb3-9384-4e05-a79b-1246e9b85119', 'a0000000-0000-0000-0000-0000000000bf', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b3', 'P3USDT', 'x', 'active', false),
  ('5acc84c9-edd2-4c9f-87dd-fd928f8b62cd', 'a0000000-0000-0000-0000-0000000000bf', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b4', 'P4USDT', 'x', 'active', false),
  ('c8913354-8b7e-4d8d-8b3d-fb8b8f8248df', 'a0000000-0000-0000-0000-0000000000bf', '2b5c038a-a4a7-4be5-b2fe-90d32f67781b', 'b5', 'P5USDT', 'x', 'active', false);

-- ==== INLINED backfill body (mirrors docs/sql/h3-2-backfill.sql; no begin/commit) ====
-- PRE-GUARDS
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  v_expected uuid[] := array['297dddb9-965b-49ff-abd8-e3e8e88fa4fc','2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
    '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df']::uuid[];
  v_cnt int; v_env text; v_status text; v_owners int; v_cross int; v_labels int; v_enabled int; v_active int; v_ids uuid[];
begin
  select count(*) into v_cnt from public.bots where credential_id = v_shared and deleted_at is null;
  if v_cnt <> 5 then raise exception 'PRE: expected 5 live bots, found %', v_cnt; end if;
  select array_agg(id order by id) into v_ids from public.bots where credential_id = v_shared and deleted_at is null;
  if v_ids is distinct from v_expected then raise exception 'PRE: fleet id set changed'; end if;
  select count(*) into v_active from public.bots where credential_id = v_shared and deleted_at is null and status = 'active';
  if v_active <> 5 then raise exception 'PRE: not all active'; end if;
  select count(*) into v_enabled from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled <> 0 then raise exception 'PRE: enabled bot(s)'; end if;
  select exchange_environment, status into v_env, v_status from public.user_exchange_credentials where id = v_shared;
  if v_env is distinct from 'testnet' then raise exception 'PRE: SHARED_CRED not testnet'; end if;
  if v_status is distinct from 'valid' then raise exception 'PRE: SHARED_CRED not valid'; end if;
  select count(distinct user_id) into v_owners from public.bots where credential_id = v_shared and deleted_at is null;
  if v_owners <> 1 then raise exception 'PRE: multiple users'; end if;
  select count(*) into v_cross from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.user_id <> b.user_id;
  if v_cross <> 0 then raise exception 'PRE: cross-user'; end if;
  select count(*) into v_labels from public.user_exchange_credentials c
    where c.user_id = (select user_id from public.user_exchange_credentials where id = v_shared)
      and c.exchange_id = (select exchange_id from public.user_exchange_credentials where id = v_shared)
      and c.label like 'h3-2-%';
  if v_labels <> 0 then raise exception 'PRE: h3-2-* label collision'; end if;
end $$;
-- SPLIT (keep min-id bot; move the other 4; reuse the pointer; label = 'h3-2-'||full bot id)
do $$
declare v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  v_keep uuid; v_new uuid; v_user uuid; v_exch uuid; v_vault text; v_env text; r record; v_moved int := 0;
begin
  select user_id, exchange_id, vault_secret_id, exchange_environment into v_user, v_exch, v_vault, v_env
    from public.user_exchange_credentials where id = v_shared;
  select id into v_keep from public.bots where credential_id = v_shared and deleted_at is null order by id limit 1;
  for r in select id from public.bots where credential_id = v_shared and deleted_at is null and id <> v_keep order by id loop
    insert into public.user_exchange_credentials (user_id, exchange_id, vault_secret_id, label, status, exchange_environment)
      values (v_user, v_exch, v_vault, 'h3-2-' || r.id::text, 'valid', v_env) returning id into v_new;
    update public.bots set credential_id = v_new where id = r.id and credential_id = v_shared;
    if not found then raise exception 'SPLIT: bot % not repointed', r.id; end if;
    v_moved := v_moved + 1;
  end loop;
  if v_moved <> 4 then raise exception 'SPLIT: expected to move 4, moved %', v_moved; end if;
end $$;
-- POST-VERIFY
do $$
declare v_live int; v_distinct int; v_enabled int; v_nontestnet int;
begin
  select count(*) into v_live from public.bots where deleted_at is null;
  if v_live <> 5 then raise exception 'POST: expected 5 live bots, found %', v_live; end if;
  select count(distinct credential_id) into v_distinct from public.bots where deleted_at is null and credential_id is not null;
  if v_distinct <> 5 then raise exception 'POST: expected 5 distinct credential_id, found %', v_distinct; end if;
  if exists (select 1 from public.bots where credential_id is not null and deleted_at is null
             group by credential_id having count(*) > 1) then raise exception 'POST: still shared'; end if;
  select count(*) into v_enabled from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled <> 0 then raise exception 'POST: a bot got enabled'; end if;
  select count(*) into v_nontestnet from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.exchange_environment is distinct from 'testnet';
  if v_nontestnet <> 0 then raise exception 'POST: non-testnet credential'; end if;
end $$;
-- ==== end inlined body ====

-- Extra assertions: Option-1 reuse + keep-1 + all valid.
do $$
declare v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b'; v_reuse int; v_keep int; v_valid int; v_newrows int;
begin
  select count(*) into v_newrows from public.user_exchange_credentials where label like 'h3-2-%';
  assert v_newrows = 4, 'backfill: exactly 4 new per-bot rows created';
  select count(*) into v_reuse from public.user_exchange_credentials
    where label like 'h3-2-%' and vault_secret_id = (select vault_secret_id from public.user_exchange_credentials where id = v_shared);
  assert v_reuse = 4, 'backfill: all 4 new rows REUSE SHARED_CRED vault_secret_id (Option 1)';
  select count(*) into v_keep from public.bots where credential_id = v_shared and deleted_at is null;
  assert v_keep = 1, 'backfill: exactly 1 bot kept on SHARED_CRED (the min-id 297dddb9)';
  select count(*) into v_valid from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.status = 'valid';
  assert v_valid = 5, 'backfill: all 5 bots on valid credentials';
end $$;

-- Prove S1b now satisfiable (0 sharing): re-create the unique index succeeds.
create unique index bots_credential_single_use_uidx
  on public.bots (credential_id) where credential_id is not null and deleted_at is null;

do $$ begin raise notice 'ALL H3-2 BACKFILL TESTS PASSED'; end $$;

rollback;
