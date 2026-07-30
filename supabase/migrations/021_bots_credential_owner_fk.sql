-- Migration 021: A8-H3 Slice H3-1a — S2 credential OWNERSHIP guard (composite FK).
--
-- Enforces invariant I2: a bot's referenced credential must belong to the bot's owner
-- (user_exchange_credentials.user_id = bots.user_id). Today nothing ties them; a bot could
-- point at another user's credential. This replaces the single-column FK on bots.credential_id
-- with a COMPOSITE FK on (credential_id, user_id) → user_exchange_credentials(id, user_id),
-- so a cross-user reference is rejected at write time.
--
-- Nullable credential_id is preserved: the composite FK uses MATCH SIMPLE, so a row with
-- credential_id IS NULL (uncredentialed bot) is exempt (the worker still fail-closes on a
-- null credential for a bot that needs execution — ENG-007). This does NOT enforce single-use
-- (I1/S1b) — that is Slice H3-2, blocked on the shared testnet credential.
--
-- Apply SURGICALLY (transaction-wrapped `supabase db query --linked --file`), NOT via `db push`.
-- GATED: apply LOCAL for tests (supabase/tests/021_bots_credential_owner_fk.test.sql); apply
-- LINKED only on explicit operator approval + read-back; then record 021 in schema_migrations.
-- Transaction-wrapped: any PRE/POST guard RAISE ⇒ the whole thing ROLLS BACK (nothing committed).

begin;

-- ---- PRE-INSERT GUARDS (fail-closed) ---------------------------------------------------------
do $$
begin
  -- I2 must already be clean: no live bot may reference a credential owned by a different user.
  if exists (
    select 1 from public.bots b
    join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.user_id <> b.user_id
  ) then
    raise exception 'H3-1a S2 PRE: cross-user credential reference exists — resolve before enforcing ownership';
  end if;
  -- The exact FK we are replacing must exist (verified live: bots_credential_id_fkey).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bots'::regclass and contype = 'f' and conname = 'bots_credential_id_fkey'
  ) then
    raise exception 'H3-1a S2 PRE: expected FK bots_credential_id_fkey not found';
  end if;
end $$;

-- 1) Supporting unique so (id, user_id) is FK-referenceable. `id` is PK (unique alone), so this pair is
--    trivially unique; Postgres still REQUIRES an explicit unique on exactly the referenced columns.
alter table public.user_exchange_credentials
  add constraint uec_id_user_key unique (id, user_id);

-- 2) Replace the single-column FK with the ownership-composite FK (ON DELETE RESTRICT preserved).
alter table public.bots
  drop constraint bots_credential_id_fkey,
  add  constraint bots_credential_owner_fkey
    foreign key (credential_id, user_id)
    references public.user_exchange_credentials (id, user_id) on delete restrict;

-- ---- POST-VERIFY (same txn; RAISE ⇒ ROLLBACK) ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.bots'::regclass and conname = 'bots_credential_owner_fkey' and contype = 'f') then
    raise exception 'H3-1a S2 POST: ownership FK bots_credential_owner_fkey not created';
  end if;
  if exists (select 1 from pg_constraint
             where conrelid = 'public.bots'::regclass and conname = 'bots_credential_id_fkey') then
    raise exception 'H3-1a S2 POST: old single-col FK bots_credential_id_fkey still present';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.user_exchange_credentials'::regclass and conname = 'uec_id_user_key' and contype = 'u') then
    raise exception 'H3-1a S2 POST: supporting unique uec_id_user_key missing';
  end if;
  raise notice 'H3-1a S2 OK: ownership FK enforced (credential_id, user_id); nullable credential_id preserved.';
end $$;

commit;
