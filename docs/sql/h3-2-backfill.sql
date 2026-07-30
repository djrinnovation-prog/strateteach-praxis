-- ============================================================================
-- h3-2-backfill.sql — A8-H3 H3-2 per-bot credential split (DATA; testnet only).
--
-- OPERATOR-RUN, surgical:  supabase db query --linked --file <this file>
-- **NEVER `db push`.**  Splits the ONE shared testnet credential (SHARED_CRED)
-- referenced by 5 live bots into per-bot credential rows: KEEP 1 bot on
-- SHARED_CRED, ADD 4 new per-bot rows for the other 4 and repoint them.
--
-- Option 1 (testnet-only shortcut): the 4 new rows REUSE SHARED_CRED's existing
-- `vault_secret_id` (read from the DB via subquery — its VALUE is NEVER written
-- in this file). status='valid' (reuses an already-validated testnet key).
-- This achieves per-bot credential-ROW isolation + per-bot reversible LOCK; it
-- is NOT Vault-secret-custody isolation and MUST NEVER be used for mainnet (A4
-- provisions distinct per-bot secrets). Transaction-wrapped: any guard RAISE =>
-- whole thing ROLLS BACK. Run AFTER Codex PASS; run migration 023 (S1b) AFTER
-- this verifies 0 sharing. Rollback: docs/sql/h3-2-backfill-rollback.sql.
-- ============================================================================

begin;

-- ---- PRE-GUARDS (fail-closed) — verify the EXACT current fleet; abort if it changed since discovery
do $$
declare
  v_shared   uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';   -- credential ROW id (non-secret), not a Vault value
  -- EXACT expected fleet (discovery 2026-07-12), sorted by id — this packet is a ONE-TIME backfill for THIS fleet.
  v_expected uuid[] := array[
    '297dddb9-965b-49ff-abd8-e3e8e88fa4fc',
    '2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
    '36b46eb3-9384-4e05-a79b-1246e9b85119',
    '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
    'c8913354-8b7e-4d8d-8b3d-fb8b8f8248df'
  ]::uuid[];
  v_cnt int; v_env text; v_status text; v_owners int; v_cross int; v_labels int; v_enabled int;
  v_active int; v_nontestnet int; v_ids uuid[];
begin
  select count(*) into v_cnt from public.bots where credential_id = v_shared and deleted_at is null;
  if v_cnt <> 5 then raise exception 'H3-2 backfill PRE: expected 5 live bots on SHARED_CRED, found %', v_cnt; end if;

  -- exact 5 bot ids (abort if the fleet changed since discovery — added/removed/repointed)
  select array_agg(id order by id) into v_ids
    from public.bots where credential_id = v_shared and deleted_at is null;
  if v_ids is distinct from v_expected then
    raise exception 'H3-2 backfill PRE: live bots on SHARED_CRED do not match the expected 5 discovery ids (fleet changed)';
  end if;

  -- all 5 status='active'
  select count(*) into v_active from public.bots where credential_id = v_shared and deleted_at is null and status = 'active';
  if v_active <> 5 then raise exception 'H3-2 backfill PRE: not all 5 bots are status=active (found % active)', v_active; end if;

  -- all 5 trading_enabled=false
  select count(*) into v_enabled from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled <> 0 then raise exception 'H3-2 backfill PRE: % enabled bot(s) — must be fully disarmed', v_enabled; end if;

  -- shared credential status/env expected
  select exchange_environment, status into v_env, v_status
    from public.user_exchange_credentials where id = v_shared;
  if v_env is distinct from 'testnet' then raise exception 'H3-2 backfill PRE: SHARED_CRED not testnet'; end if;
  if v_status is distinct from 'valid' then raise exception 'H3-2 backfill PRE: SHARED_CRED not valid'; end if;

  -- all 5 bots reach testnet THROUGH their credential's environment
  select count(*) into v_nontestnet from public.bots b
    join public.user_exchange_credentials c on c.id = b.credential_id
    where b.credential_id = v_shared and b.deleted_at is null and c.exchange_environment is distinct from 'testnet';
  if v_nontestnet <> 0 then raise exception 'H3-2 backfill PRE: a bot is not testnet through its credential'; end if;

  -- exactly one owner
  select count(distinct user_id) into v_owners from public.bots where credential_id = v_shared and deleted_at is null;
  if v_owners <> 1 then raise exception 'H3-2 backfill PRE: bots on SHARED_CRED span multiple users'; end if;

  -- 0 cross-user mismatches (global)
  select count(*) into v_cross from public.bots b
    join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.user_id <> b.user_id;
  if v_cross <> 0 then raise exception 'H3-2 backfill PRE: cross-user credential reference exists'; end if;

  -- target labels do not already exist (no collision with UNIQUE(user_id, exchange_id, label))
  select count(*) into v_labels from public.user_exchange_credentials c
    where c.user_id     = (select user_id     from public.user_exchange_credentials where id = v_shared)
      and c.exchange_id = (select exchange_id from public.user_exchange_credentials where id = v_shared)
      and c.label like 'h3-2-%';
  if v_labels <> 0 then raise exception 'H3-2 backfill PRE: h3-2-* labels already exist (collision)'; end if;
end $$;

-- ---- SPLIT: keep 1 bot on SHARED_CRED; move the other 4 to new per-bot rows --
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  v_keep uuid; v_new uuid; v_user uuid; v_exch uuid; v_vault text; v_env text; r record; v_moved int := 0;
begin
  -- read SHARED_CRED's owner/exchange/env + the Vault POINTER (value never written to this file)
  select user_id, exchange_id, vault_secret_id, exchange_environment
    into v_user, v_exch, v_vault, v_env
    from public.user_exchange_credentials where id = v_shared;

  -- keep the lexicographically-first bot on SHARED_CRED
  select id into v_keep from public.bots
    where credential_id = v_shared and deleted_at is null order by id limit 1;

  -- move the other 4: new per-bot credential row (REUSE the pointer) + repoint
  for r in select id from public.bots
             where credential_id = v_shared and deleted_at is null and id <> v_keep order by id loop
    insert into public.user_exchange_credentials
        (user_id, exchange_id, vault_secret_id, label, status, exchange_environment)
      values (v_user, v_exch, v_vault, 'h3-2-' || r.id::text, 'valid', v_env)   -- full bot id => unique label
      returning id into v_new;
    update public.bots set credential_id = v_new where id = r.id and credential_id = v_shared;
    if not found then raise exception 'H3-2 backfill: bot % not repointed (unexpected)', r.id; end if;
    v_moved := v_moved + 1;
  end loop;
  if v_moved <> 4 then raise exception 'H3-2 backfill: expected to move 4 bots, moved %', v_moved; end if;
end $$;

-- ---- POST-VERIFY (same txn; RAISE => ROLLBACK) ------------------------------
do $$
declare v_live int; v_distinct int; v_enabled int; v_nontestnet int;
begin
  select count(*) into v_live from public.bots where deleted_at is null;
  if v_live <> 5 then raise exception 'H3-2 backfill POST: expected 5 live bots, found %', v_live; end if;

  select count(distinct credential_id) into v_distinct
    from public.bots where deleted_at is null and credential_id is not null;
  if v_distinct <> 5 then raise exception 'H3-2 backfill POST: expected 5 distinct credential_id, found %', v_distinct; end if;

  if exists (select 1 from public.bots where credential_id is not null and deleted_at is null
             group by credential_id having count(*) > 1) then
    raise exception 'H3-2 backfill POST: a credential is still shared by >1 live bot';
  end if;

  select count(*) into v_enabled from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled <> 0 then raise exception 'H3-2 backfill POST: a bot got enabled'; end if;

  select count(*) into v_nontestnet from public.bots b
    join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.exchange_environment is distinct from 'testnet';
  if v_nontestnet <> 0 then raise exception 'H3-2 backfill POST: a bot references a non-testnet credential'; end if;

  raise notice 'H3-2 backfill OK: 5 live bots, 5 distinct credentials, 0 sharing, disarmed, testnet.';
end $$;

commit;

-- Post-run (read-only, after commit): each live bot has a distinct credential_id; the 4 new rows carry
-- label 'h3-2-<bot8>' and REUSE SHARED_CRED's vault_secret_id (confirm via md5 fingerprint, never the value).
