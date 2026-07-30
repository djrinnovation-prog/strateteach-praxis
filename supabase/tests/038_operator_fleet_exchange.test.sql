-- ============================================================================
-- LOCAL-ONLY test for migration 038 — EP7: operator_pilot_fleet() carries the venue.
-- LOCAL Supabase ONLY (never --linked). Requires 001..038 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/038_operator_fleet_exchange.test.sql
--
-- Asserts the fleet row now exposes the non-secret venue name ('exchange') resolved via the
-- credential's exchange_id → exchanges, that the operator gate + no-secret guarantees are intact,
-- and that a null-uid caller is still denied (42501).
-- ============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'op038@test.local');
update public.profiles set is_operator = true where id = '00000000-0000-0000-0000-0000000000e1';

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'binance-t038', 'Binance Test 038', 'binancet038');
insert into public.user_exchange_credentials
  (id, user_id, exchange_id, vault_secret_id, exchange_environment, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-0000000000a1', 'vs-placeholder-038', 'mainnet', 'valid');

insert into public.bots
  (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled, credential_id,
   sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled)
values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'fleet-038', 'BTCUSDT', 'x',
   'paused', false, '00000000-0000-0000-0000-0000000000f1',
   'fixed_notional', 12, 13, 13, false);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
declare v jsonb; b jsonb;
begin
  v := public.operator_pilot_fleet();
  assert jsonb_typeof(v) = 'array', '038: returns a jsonb array';
  b := v->0;
  assert (b->>'id') = '00000000-0000-0000-0000-0000000000e2', '038: bot id present';
  -- EP7: the venue name is exposed, resolved via credential.exchange_id → exchanges.name.
  assert (b->>'exchange') = 'binance-t038',                   '038: exchange (venue name) present';
  -- Regression: the pre-existing fields still resolve.
  assert (b->>'exchange_environment') = 'mainnet',            '038: exchange_environment retained';
  assert (b->>'credential_fingerprint') = '00000000',        '038: credential fingerprint retained';
  -- No secrets anywhere in the payload.
  assert not (v::text ~* '(webhook_secret_hash|vault_secret_id|api_key|api_secret|service_role|pepper|token)'),
                                                              '038: no secret substrings in payload';
end $$;
select set_config('request.jwt.claims', '', true);

-- Authz: null uid → 42501 (deny-by-default) still holds.
do $$
begin
  begin
    perform public.operator_pilot_fleet();
    raise exception '038: expected 42501 for null-uid caller';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;

rollback;
