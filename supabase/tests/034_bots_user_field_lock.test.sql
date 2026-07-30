-- ============================================================================
-- LOCAL-ONLY test for migration 034 (ST-2b) — guard_bot_user_field_lock trigger.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..034 applied (`supabase db reset`).
-- The trigger reads auth.uid() via the request.jwt.claims GUC (triggers fire even for the superuser test
-- role, so this exercises the guard directly). One transaction, ROLLS BACK.
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('00000000-0000-0000-0000-0000000000a4', 'binance-t034', 'Binance T034', 'binancet034');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'ownerd034@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'opd034@test.local');
update public.profiles set is_operator = true where id = '00000000-0000-0000-0000-0000000000d2';

insert into public.user_exchange_credentials
  (id, user_id, exchange_id, vault_secret_id, exchange_environment, status) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1',
   '00000000-0000-0000-0000-0000000000a4', 'vs-plc-034', 'mainnet', 'valid');

insert into public.bots
  (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled, credential_id,
   sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1', 'D-bot', 'BTCUSDT', 'x',
   'paused', false, '00000000-0000-0000-0000-0000000000d3', 'fixed_notional', 12, 13, 13, false);

-- OWNER (non-operator): editing caps is BLOCKED.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
do $$
begin
  begin
    update public.bots set max_order_notional_usdt = 9999 where id='00000000-0000-0000-0000-0000000000d4';
    raise exception '034: expected 42501 blocking OWNER cap edit';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;
-- OWNER may still edit a cosmetic field (name) — trigger does not block non-protected columns.
do $$
declare nm text;
begin
  update public.bots set name = 'renamed-by-owner' where id='00000000-0000-0000-0000-0000000000d4';
  select name into nm from public.bots where id='00000000-0000-0000-0000-0000000000d4';
  assert nm = 'renamed-by-owner', '034: owner may edit cosmetic name';
end $$;
select set_config('request.jwt.claims', '', true);

-- OPERATOR: cap edit ALLOWED.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
do $$
declare c numeric;
begin
  update public.bots set max_order_notional_usdt = 20 where id='00000000-0000-0000-0000-0000000000d4';
  select max_order_notional_usdt into c from public.bots where id='00000000-0000-0000-0000-0000000000d4';
  assert c = 20, '034: operator cap edit applied';
end $$;
select set_config('request.jwt.claims', '', true);

-- service_role / privileged (auth.uid() NULL): cap edit ALLOWED.
do $$
declare c numeric;
begin
  update public.bots set daily_notional_cap_usdt = 50 where id='00000000-0000-0000-0000-0000000000d4';
  select daily_notional_cap_usdt into c from public.bots where id='00000000-0000-0000-0000-0000000000d4';
  assert c = 50, '034: service_role (null uid) cap edit applied';
end $$;

do $$ begin raise notice 'ALL 034 TESTS PASSED'; end $$;

rollback;
