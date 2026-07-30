-- Migration 023: A8-H3 Slice H3-2 — S1b single-use enforcement (partial unique index).
--
-- Enforces invariant I1: among LIVE bots, each credential_id is referenced by AT MOST ONE bot
-- (no shared credential row). Soft-deleted bots (deleted_at NOT NULL) and NULL credential_id are
-- EXEMPT (repoint/rotation history; uncredentialed bots remain allowed — worker fail-closes at
-- execution, ENG-007).
--
-- MUST be applied AFTER the H3-2 backfill (docs/sql/h3-2-backfill.sql) has eliminated all sharing.
-- Plain `create unique index` (NOT CONCURRENTLY — CONCURRENTLY cannot run in a transaction; the
-- testnet bots table is tiny so the brief lock is negligible; revisit CONCURRENTLY-outside-txn only
-- for a larger/mainnet table). Apply SURGICALLY (`db query --linked --file`), NEVER `db push`.
-- GATED: apply LOCAL for tests (supabase/tests/023_bots_credential_single_use_index.test.sql); apply
-- LINKED only on explicit operator approval + read-back; then record 023 in schema_migrations.

begin;

-- ---- PRE-GUARD (fail-closed): 0 live shared credential_id ---------------------
do $$
begin
  if exists (
    select 1 from public.bots
    where credential_id is not null and deleted_at is null
    group by credential_id having count(*) > 1
  ) then
    raise exception 'H3-2 S1b PRE: a credential is still shared by >1 live bot — run the H3-2 backfill first';
  end if;
end $$;

-- ---- Partial unique index on LIVE bot credential usage ------------------------
create unique index bots_credential_single_use_uidx
  on public.bots (credential_id)
  where credential_id is not null and deleted_at is null;

-- ---- POST-VERIFY (same txn; RAISE => ROLLBACK) -------------------------------
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='bots'
                 and indexname='bots_credential_single_use_uidx') then
    raise exception 'H3-2 S1b POST: index bots_credential_single_use_uidx not created';
  end if;
  -- must be UNIQUE and PARTIAL (indpred not null) => duplicate live credential usage is impossible
  if not exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
                 where c.relname='bots_credential_single_use_uidx' and i.indisunique and i.indpred is not null) then
    raise exception 'H3-2 S1b POST: index not unique+partial';
  end if;
  raise notice 'H3-2 S1b OK: single-use partial unique index enforced (live bots, non-null credential_id).';
end $$;

commit;
