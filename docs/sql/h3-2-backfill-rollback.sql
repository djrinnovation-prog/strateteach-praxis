-- ============================================================================
-- h3-2-backfill-rollback.sql — reverse the H3-2 per-bot split (DATA; testnet).
--
-- OPERATOR-RUN, surgical.  **NEVER `db push`.**  Repoints the 4 moved bots back
-- to SHARED_CRED and removes the 4 new per-bot rows. Transaction-wrapped.
--
-- ORDER MATTERS: if the S1b unique index (migration 023) is present, it is
-- dropped FIRST (repointing 4 bots back onto SHARED_CRED would otherwise violate
-- it). The bot is repointed to SHARED_CRED BEFORE its new row is deleted (ON
-- DELETE RESTRICT blocks deleting a still-referenced credential).
-- **NEVER `delete_vault_secret`** — the shared testnet pointer is untouched.
-- ============================================================================

begin;

-- ---- PRE-GUARDS (fail-closed) — verify the expected post-backfill state before reverting
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  -- the 4 bots that were MOVED = the expected 5 minus the kept (min id 297dddb9…), sorted by id
  v_moved uuid[] := array[
    '2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
    '36b46eb3-9384-4e05-a79b-1246e9b85119',
    '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
    'c8913354-8b7e-4d8d-8b3d-fb8b8f8248df'
  ]::uuid[];
  v_live int; v_h32 int; v_enabled int; v_nontestnet int; v_bots_on_h32 uuid[]; v_maxref int;
begin
  select count(*) into v_live from public.bots where deleted_at is null;
  if v_live <> 5 then raise exception 'H3-2 rollback PRE: expected 5 live bots, found %', v_live; end if;

  -- exactly 4 h3-2-* credential rows (owner-scoped)
  select count(*) into v_h32 from public.user_exchange_credentials c
    where c.user_id     = (select user_id     from public.user_exchange_credentials where id = v_shared)
      and c.exchange_id = (select exchange_id from public.user_exchange_credentials where id = v_shared)
      and c.label like 'h3-2-%';
  if v_h32 <> 4 then raise exception 'H3-2 rollback PRE: expected 4 h3-2-* credential rows, found %', v_h32; end if;

  -- the 4 h3-2 rows are used ONLY by the 4 EXPECTED moved bots (no unexpected bot, no extra)
  select array_agg(b.id order by b.id) into v_bots_on_h32
    from public.bots b join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.label like 'h3-2-%';
  if v_bots_on_h32 is distinct from v_moved then
    raise exception 'H3-2 rollback PRE: h3-2-* rows are used by an unexpected bot set (fleet changed)';
  end if;
  -- and each h3-2 row is referenced by at most one live bot
  select coalesce(max(cnt),0) into v_maxref from (
    select b.credential_id, count(*) cnt from public.bots b
      join public.user_exchange_credentials c on c.id = b.credential_id
      where b.deleted_at is null and c.label like 'h3-2-%' group by b.credential_id) t;
  if v_maxref > 1 then raise exception 'H3-2 rollback PRE: an h3-2-* row is shared by >1 live bot'; end if;

  -- no bot enabled
  select count(*) into v_enabled from public.bots where trading_enabled = true and deleted_at is null;
  if v_enabled <> 0 then raise exception 'H3-2 rollback PRE: % enabled bot(s)', v_enabled; end if;

  -- no mainnet credential involved (SHARED_CRED + h3-2 rows all testnet)
  select count(*) into v_nontestnet from public.user_exchange_credentials c
    where (c.id = v_shared or c.label like 'h3-2-%')
      and c.user_id = (select user_id from public.user_exchange_credentials where id = v_shared)
      and c.exchange_environment is distinct from 'testnet';
  if v_nontestnet <> 0 then raise exception 'H3-2 rollback PRE: a non-testnet credential is involved'; end if;
end $$;

-- Drop S1b first (if present) so the bots can be repointed back onto one credential.
drop index if exists public.bots_credential_single_use_uidx;

-- ---- REVERT: repoint the 4 h3-2-* bots back to SHARED_CRED; delete the new rows
do $$
declare
  v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
  r record; v_reverted int := 0;
begin
  for r in
    select b.id as bot_id, b.credential_id as new_cred
    from public.bots b
    join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.label like 'h3-2-%'
  loop
    update public.bots set credential_id = v_shared where id = r.bot_id;   -- repoint back first
    delete from public.user_exchange_credentials where id = r.new_cred and label like 'h3-2-%';  -- now unreferenced
    v_reverted := v_reverted + 1;
  end loop;
  if v_reverted <> 4 then raise exception 'H3-2 rollback: expected to revert 4 bots, reverted %', v_reverted; end if;
end $$;

-- ---- POST-VERIFY ------------------------------------------------------------
do $$
declare v_shared uuid := '2b5c038a-a4a7-4be5-b2fe-90d32f67781b'; v_on_shared int; v_h32 int;
begin
  select count(*) into v_on_shared from public.bots where credential_id = v_shared and deleted_at is null;
  if v_on_shared <> 5 then raise exception 'H3-2 rollback POST: expected 5 live bots on SHARED_CRED, found %', v_on_shared; end if;
  select count(*) into v_h32 from public.user_exchange_credentials where label like 'h3-2-%';
  if v_h32 <> 0 then raise exception 'H3-2 rollback POST: h3-2-* rows remain'; end if;
  raise notice 'H3-2 rollback OK: 5 bots back on SHARED_CRED; new per-bot rows removed; S1b index dropped.';
end $$;

commit;
