-- ============================================================================
-- LOCAL-ONLY test for migration 021 — S2 credential OWNERSHIP composite FK.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..021 applied locally
-- (`supabase db reset`). Runs as the DB owner. One transaction, ROLLS BACK.
--   supabase db query --file supabase/tests/021_bots_credential_owner_fk.test.sql   (or psql -f)
-- ============================================================================

begin;

-- ---- Fixture: 1 exchange, 2 users, 1 credential per user (correct owner) --------------------
insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000001', 'binance-t021', 'Binance T021', 'binance-t021');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'u1-021@test.local'),
  ('a0000000-0000-0000-0000-000000000002', 'u2-021@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, status, exchange_environment) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'valid', 'testnet'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'valid', 'testnet');

-- ---- Constraint shape assertions ------------------------------------------------------------
do $$
begin
  assert exists (select 1 from pg_constraint where conrelid='public.bots'::regclass
                 and conname='bots_credential_owner_fkey' and contype='f'),
    '021: composite ownership FK bots_credential_owner_fkey present';
  assert not exists (select 1 from pg_constraint where conrelid='public.bots'::regclass
                     and conname='bots_credential_id_fkey'),
    '021: old single-col FK bots_credential_id_fkey removed';
  assert exists (select 1 from pg_constraint where conrelid='public.user_exchange_credentials'::regclass
                 and conname='uec_id_user_key' and contype='u'),
    '021: supporting unique uec_id_user_key present';
end $$;

-- ---- CASE A: matching owner → ALLOWED -------------------------------------------------------
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'ok-owner', 'BTCUSDT', 'x', 'active');

-- ---- CASE B: cross-user reference → REJECTED (FK violation) ---------------------------------
do $$
begin
  begin
    insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
      ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'cross-user', 'ETHUSDT', 'x', 'active');
    raise exception '021: expected cross-user FK rejection (bot u1 -> cred u2)';
  exception when foreign_key_violation then null;   -- expected
  end;
end $$;

-- ---- CASE C: NULL credential_id → ALLOWED (MATCH SIMPLE exemption) --------------------------
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', NULL, 'null-cred', 'SOLUSDT', 'x', 'active');

-- ---- CASE D: ON DELETE RESTRICT still holds (cred referenced by a live bot) -----------------
do $$
begin
  begin
    delete from public.user_exchange_credentials where id = 'c0000000-0000-0000-0000-000000000001';
    raise exception '021: expected ON DELETE RESTRICT on a referenced credential';
  exception when foreign_key_violation then null;   -- expected
  end;
end $$;

-- ---- CASE E: update a bot to a cross-user credential → REJECTED -----------------------------
do $$
begin
  begin
    update public.bots set credential_id = 'c0000000-0000-0000-0000-000000000002'
      where id = 'b0000000-0000-0000-0000-000000000001';
    raise exception '021: expected cross-user FK rejection on UPDATE';
  exception when foreign_key_violation then null;   -- expected
  end;
end $$;

do $$ begin raise notice 'ALL 021 TESTS PASSED'; end $$;

rollback;
