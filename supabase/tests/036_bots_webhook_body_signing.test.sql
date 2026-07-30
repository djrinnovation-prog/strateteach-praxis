-- ============================================================================
-- LOCAL-ONLY test for migration 036 (T4) — webhook_body_signing_required is operator-locked.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..036 (`supabase db reset`).
-- The guard reads auth.uid() via the request.jwt.claims GUC (fires for the superuser test role
-- too, so it exercises guard_bot_user_field_lock directly). One transaction, ROLLS BACK.
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('00000000-0000-0000-0000-0000000000e4', 'binance-t036', 'Binance T036', 'binancet036');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ownere036@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'ope036@test.local');
update public.profiles set is_operator = true where id = '00000000-0000-0000-0000-0000000000e2';

insert into public.user_exchange_credentials
  (id, user_id, exchange_id, vault_secret_id, exchange_environment, status) values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000e4', 'vs-plc-036', 'mainnet', 'valid');

insert into public.bots
  (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled, credential_id,
   sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled) values
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e1', 'E-bot', 'BTCUSDT', 'x',
   'paused', false, '00000000-0000-0000-0000-0000000000e3', 'fixed_notional', 12, 13, 13, false);

-- Column exists and defaults to false (dormant — existing behavior unchanged).
do $$
declare v boolean;
begin
  select webhook_body_signing_required into v from public.bots where id = '00000000-0000-0000-0000-0000000000e5';
  assert v = false, '036: webhook_body_signing_required must default to false';
end $$;

-- OWNER (non-operator): toggling the signing flag is BLOCKED (42501).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
begin
  begin
    update public.bots set webhook_body_signing_required = true where id = '00000000-0000-0000-0000-0000000000e5';
    raise exception '036: expected 42501 blocking OWNER toggling webhook_body_signing_required';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;
select set_config('request.jwt.claims', '', true);

-- OPERATOR: toggling ALLOWED.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
do $$
declare v boolean;
begin
  update public.bots set webhook_body_signing_required = true where id = '00000000-0000-0000-0000-0000000000e5';
  select webhook_body_signing_required into v from public.bots where id = '00000000-0000-0000-0000-0000000000e5';
  assert v = true, '036: operator may enable webhook_body_signing_required';
end $$;
select set_config('request.jwt.claims', '', true);

-- service_role / privileged (auth.uid() NULL): toggling ALLOWED.
do $$
declare v boolean;
begin
  update public.bots set webhook_body_signing_required = false where id = '00000000-0000-0000-0000-0000000000e5';
  select webhook_body_signing_required into v from public.bots where id = '00000000-0000-0000-0000-0000000000e5';
  assert v = false, '036: service_role (null uid) may set webhook_body_signing_required';
end $$;

do $$ begin raise notice 'ALL 036 TESTS PASSED'; end $$;

rollback;
