-- ============================================================================
-- LOCAL-ONLY test for migration 030 — C-1 live partial unique index on vault_secret_id.
-- LOCAL Supabase ONLY (never --linked). Requires 001..030 applied locally
-- (`supabase db reset`; 030's pre-guard passes on the empty table, so the index exists). ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/030_c1_vault_pointer_unique_index.test.sql
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000030', 'binance-t030', 'Binance T030', 'binance-t030');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000030', 'ua030@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0301', 'a0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000030', 'vault-0301', 'c1', 'valid', 'testnet');

-- Index present, unique + partial.
do $$
begin
  assert exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
                 where c.relname='credentials_vault_secret_id_live_uidx' and i.indisunique and i.indpred is not null),
    '030: live partial unique index present (unique + partial)';
end $$;

-- NEGATIVE: a 2nd LIVE credential (same user) on the same pointer → REJECTED by the unique index.
do $$
begin
  begin
    insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
      ('c0000000-0000-0000-0000-0000000c0302', 'a0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000030', 'vault-0301', 'dup-live', 'valid', 'testnet');
    raise exception '030: expected 2nd LIVE row on same pointer to be REJECTED';
  exception when unique_violation then null;  -- expected
  end;
end $$;

-- POSITIVE: after SOFT-DELETING the old row, the same pointer may be re-used LIVE (rotation history) — index is live-only.
update public.user_exchange_credentials set deleted_at = now() where id='c0000000-0000-0000-0000-0000000c0301';
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0303', 'a0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000030', 'vault-0301', 'c2', 'valid', 'testnet');
do $$
begin
  assert exists (select 1 from public.user_exchange_credentials where id='c0000000-0000-0000-0000-0000000c0303' and deleted_at is null),
    '030: re-point onto the same pointer after soft-delete must be ALLOWED (index is live-only)';
  raise notice '030 PASS: 2nd live pointer rejected; re-point after soft-delete allowed.';
end $$;

rollback;
