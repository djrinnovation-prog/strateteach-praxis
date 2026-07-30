-- Migration 026: C-1 (CRITICAL) — bind the Vault pointer to its owner (OWNER-BINDING TRIGGER only).
--
-- THREAT (audit v3 C-1): RLS on user_exchange_credentials only checks `user_id = auth.uid()` on INSERT.
-- Nothing binds `vault_secret_id` to an owner, so any signed-up user can INSERT a row for THEMSELVES
-- that points at ANOTHER user's Vault secret (a real pointer was leaked in docs — H-6), attach a bot,
-- and drive trades on the victim's exchange account. The worker's ownership check compares the
-- credential row's user_id to the bot's user_id (both attacker-owned), so it cannot detect this.
--
-- THIS MIGRATION closes the ACTUAL C-1 exploit: a cross-user binding guard trigger — a vault_secret_id
-- may never be associated with more than one user_id (any row state). A different user pointing a
-- credential at someone else's pointer is REJECTED. This is compatible with the current live data.
--
-- SPLIT NOTE (AUDIT-OPS pre-flight): the companion defense-in-depth control — a PARTIAL UNIQUE index on
-- live `vault_secret_id` — was MOVED to migration 030. Reason: the linked testnet setup has 5 live
-- credentials sharing ONE Vault secret (Option-1 shortcut), so the index cannot be created until those
-- are re-pointed to per-bot DISTINCT secrets (A4 / rotation R2). The trigger here does NOT depend on
-- that split, so C-1's exploit is closed now; 030 tightens the same-user shortcut afterwards.
--
-- FULL remediation (follow-up, NOT here): the client should never SET vault_secret_id at all — it must
-- be written only by a SECURITY DEFINER creation function / service_role at store time, and client
-- column-write on vault_secret_id revoked. Also ROTATE the leaked pointer + identifiers from H-6.
--
-- GATED: apply LOCAL for tests first, then LINKED only on explicit operator approval + read-back; then
-- record 026 in schema_migrations. Apply SURGICALLY (`db query --linked --file`), NEVER `db push`.

begin;

-- ---- PRE-GUARD (fail-closed): no vault_secret_id is already shared across DIFFERENT users -----------
do $$
begin
  if exists (
    select 1 from public.user_exchange_credentials
    group by vault_secret_id
    having count(distinct user_id) > 1
  ) then
    raise exception 'C-1 PRE: a vault_secret_id is already associated with >1 user — remediate before binding';
  end if;
end $$;

-- ---- Cross-user binding guard (applies to ALL roles; the pointer belongs to its first owner) --------
create or replace function public.guard_credential_vault_pointer_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A pointer may only ever belong to ONE user. If any other row (live or soft-deleted) already ties
  -- this vault_secret_id to a different user_id, refuse — this is the C-1 cross-user attach.
  if exists (
    select 1 from public.user_exchange_credentials c
    where c.vault_secret_id = new.vault_secret_id
      and c.user_id <> new.user_id
      and c.id <> new.id
  ) then
    raise exception 'vault_secret_id is owned by another user; cross-user credential pointers are forbidden (C-1)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_credential_vault_pointer_owner on public.user_exchange_credentials;
create trigger trg_credential_vault_pointer_owner
  before insert or update of vault_secret_id, user_id
  on public.user_exchange_credentials
  for each row
  execute function public.guard_credential_vault_pointer_owner();

-- ---- POST-VERIFY (same txn; RAISE => ROLLBACK) -------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_credential_vault_pointer_owner') then
    raise exception 'C-1 POST: owner-binding trigger not created';
  end if;
  raise notice 'C-1 OK: vault_secret_id cross-user owner-binding trigger enforced (live index deferred to 030).';
end $$;

commit;
