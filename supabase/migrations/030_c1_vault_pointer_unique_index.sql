-- Migration 030: C-1 defense-in-depth — LIVE partial unique index on vault_secret_id.
--
-- Split out of migration 026 (AUDIT-OPS pre-flight): 026 installs the cross-user owner-binding TRIGGER
-- (which closes the actual C-1 exploit). THIS migration adds the belt-and-suspenders control: no two
-- LIVE credential rows may share a vault_secret_id (same-user rotate/soft-delete history stays allowed).
--
-- ⚠ GATED ON THE PER-BOT SECRET SPLIT (A4 / rotation R2): the linked testnet setup has multiple LIVE
-- credentials sharing ONE Vault secret (Option-1 shortcut). This index CANNOT coexist with that state.
-- The PRE-GUARD below fails closed if ANY live vault_secret_id is still shared — so 030 will refuse to
-- apply on the linked project until each bot has a DISTINCT per-bot Vault secret (the "never the
-- shortcut" work). On a fresh/empty database (local `db reset`) there is nothing shared, so it applies.
--
-- GATED: apply LOCAL for tests; apply LINKED only AFTER the per-bot split, on explicit operator approval
-- + read-back; then record 030 in schema_migrations. Apply SURGICALLY (`db query --linked --file`),
-- NEVER `db push`.

begin;

-- ---- PRE-GUARD (fail-closed): refuse until NO live vault_secret_id is shared by >1 row --------------
do $$
begin
  if exists (
    select 1 from public.user_exchange_credentials
    where deleted_at is null
    group by vault_secret_id
    having count(*) > 1
  ) then
    raise exception '030 PRE: a vault_secret_id is still shared by >1 LIVE credential — complete the per-bot secret split (A4/R2) before applying the unique index';
  end if;
end $$;

-- ---- Partial unique index — two LIVE credentials can never share a pointer -------------------------
create unique index if not exists credentials_vault_secret_id_live_uidx
  on public.user_exchange_credentials (vault_secret_id)
  where deleted_at is null;

-- ---- POST-VERIFY (same txn; RAISE => ROLLBACK) -------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'credentials_vault_secret_id_live_uidx' and i.indisunique and i.indpred is not null
  ) then
    raise exception '030 POST: partial unique index not created / not unique+partial';
  end if;
  raise notice '030 OK: live partial unique index on vault_secret_id enforced (post per-bot split).';
end $$;

commit;
