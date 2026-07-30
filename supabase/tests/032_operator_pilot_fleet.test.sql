-- ============================================================================
-- LOCAL-ONLY test for migration 032 — operator_pilot_fleet() read-only cockpit fleet.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..032 applied locally
-- (`supabase db reset` applies them). Drives auth.uid() via the request.jwt.claims GUC.
-- One transaction, ROLLS BACK.
--   supabase db query --file supabase/tests/032_operator_pilot_fleet.test.sql   (or psql -f)
-- ============================================================================

begin;

-- Seed: one operator + one bot on a valid mainnet credential + tiny caps.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'op032@test.local');
update public.profiles set is_operator = true where id = '00000000-0000-0000-0000-0000000000e1';

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'binance-t032', 'Binance Test 032', 'binancet032');
insert into public.user_exchange_credentials
  (id, user_id, exchange_id, vault_secret_id, exchange_environment, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000a1', 'vs-placeholder-000', 'mainnet', 'valid');

insert into public.bots
  (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled, credential_id,
   sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled)
values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'fleet-032', 'BTCUSDT', 'x',
   'paused', false, '00000000-0000-0000-0000-0000000000f1',
   'fixed_notional', 12, 13, 13, false);

-- An order.blocked audit row for that bot (last_block_reason source).
insert into public.audit_logs (entity_type, entity_id, event_type, after_state) values
  ('bot', '00000000-0000-0000-0000-0000000000e2', 'order.blocked',
   jsonb_build_object('reason', 'insufficient_quote_balance'));

-- Call as the operator.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
declare v jsonb; b jsonb;
begin
  v := public.operator_pilot_fleet();
  assert jsonb_typeof(v) = 'array', '032: returns a jsonb array';

  b := v->0;
  assert (b->>'id') = '00000000-0000-0000-0000-0000000000e2',      '032: bot id present';
  assert (b->>'trading_pair') = 'BTCUSDT',                          '032: trading_pair';
  assert (b->>'bot_status') = 'paused',                             '032: bot_status';
  assert (b->>'trading_enabled') = 'false',                         '032: trading_enabled';
  assert (b->>'exchange_environment') = 'mainnet',                  '032: exchange_environment';
  assert (b->>'credential_fingerprint') = '00000000',              '032: fingerprint = left-8 of credential_id (NOT vault_secret_id)';
  assert (b->>'fixed_notional_usdt') = '12',                        '032: fixed cap';
  assert (b->>'max_order_notional_usdt') = '13',                    '032: max cap';
  assert (b->>'daily_notional_cap_usdt') = '13',                    '032: daily cap';
  assert (b->>'sell_enabled') = 'false',                            '032: sell_enabled';
  assert (b->>'last_block_reason') = 'insufficient_quote_balance',  '032: last_block_reason from audit_logs';

  -- No secrets anywhere in the payload.
  assert not (v::text ~* '(webhook_secret_hash|vault_secret_id|api_key|api_secret|service_role|pepper|token)'),
                                                                    '032: no secret substrings in payload';
end $$;
select set_config('request.jwt.claims', '', true);

-- Authz: null uid → 42501 (deny-by-default).
do $$
begin
  begin
    perform public.operator_pilot_fleet();
    raise exception '032: expected 42501 for null-uid caller';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;

-- Authz: a NON-operator authenticated user → 42501.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e9', 'nonop032@test.local');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e9","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.operator_pilot_fleet();
    raise exception '032: expected 42501 for non-operator';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;
select set_config('request.jwt.claims', '', true);

do $$ begin raise notice 'ALL 032 TESTS PASSED'; end $$;

rollback;
