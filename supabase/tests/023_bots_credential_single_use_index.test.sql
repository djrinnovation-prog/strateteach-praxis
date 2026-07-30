-- ============================================================================
-- LOCAL-ONLY test for migration 023 — S1b single-use partial unique index.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..023 applied
-- locally (`supabase db reset`; 023 creates the index on the empty bots table).
-- One transaction, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/023_bots_credential_single_use_index.test.sql
-- ============================================================================

begin;

-- Fixture: 1 user, 1 exchange, 1 credential, 1 live bot on it.
insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000023', 'binance-t023', 'Binance T023', 'binance-t023');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000023', 'u023@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0231', 'a0000000-0000-0000-0000-000000000023', 'e0000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-0000000000aa', 'c1', 'valid', 'testnet');
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
  ('b0000000-0000-0000-0000-0000000b0231', 'a0000000-0000-0000-0000-000000000023', 'c0000000-0000-0000-0000-0000000c0231', 'bot1', 'AAAUSDT', 'x', 'active');

-- Index shape: exists, unique, partial.
do $$
begin
  assert exists (select 1 from pg_indexes where schemaname='public' and tablename='bots'
                 and indexname='bots_credential_single_use_uidx'), '023: index present';
  assert exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
                 where c.relname='bots_credential_single_use_uidx' and i.indisunique and i.indpred is not null),
    '023: index is unique + partial';
end $$;

-- NEGATIVE: a 2nd LIVE bot on the same credential → REJECTED (unique_violation).
do $$
begin
  begin
    insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
      ('b0000000-0000-0000-0000-0000000b0232', 'a0000000-0000-0000-0000-000000000023', 'c0000000-0000-0000-0000-0000000c0231', 'bot2', 'BBBUSDT', 'x', 'active');
    raise exception '023: expected unique_violation for a 2nd LIVE bot on the same credential';
  exception when unique_violation then null;   -- expected
  end;
end $$;

-- ALLOWED: a SOFT-DELETED 2nd bot on the same credential (excluded by the partial predicate).
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, deleted_at) values
  ('b0000000-0000-0000-0000-0000000b0233', 'a0000000-0000-0000-0000-000000000023', 'c0000000-0000-0000-0000-0000000c0231', 'bot3', 'CCCUSDT', 'x', 'active', now());

-- ALLOWED: multiple NULL-credential live bots (uncredentialed bots remain permitted).
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
  ('b0000000-0000-0000-0000-0000000b0234', 'a0000000-0000-0000-0000-000000000023', NULL, 'bot4', 'DDDUSDT', 'x', 'active'),
  ('b0000000-0000-0000-0000-0000000b0235', 'a0000000-0000-0000-0000-000000000023', NULL, 'bot5', 'EEEUSDT', 'x', 'active');

do $$ begin raise notice 'ALL 023 TESTS PASSED'; end $$;

rollback;
