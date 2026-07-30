-- ============================================================================
-- LOCAL-ONLY test for migration 033 — user_bot_dashboard() + user_pause_own_bot().
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..034 applied (`supabase db reset`).
-- Drives auth.uid() via the request.jwt.claims GUC. One transaction, ROLLS BACK.
--   psql "$LOCAL_DB_URL" -f supabase/tests/033_user_dashboard_rpcs.test.sql
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('00000000-0000-0000-0000-0000000000a3', 'binance-t033', 'Binance T033', 'binancet033');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'usera033@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'userb033@test.local');

insert into public.user_exchange_credentials
  (id, user_id, exchange_id, vault_secret_id, exchange_environment, status) values
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1',
   '00000000-0000-0000-0000-0000000000a3', 'vs-plc-033', 'mainnet', 'valid');

insert into public.bots
  (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled, credential_id,
   sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'A-bot', 'BTCUSDT', 'x',
   'active', true, '00000000-0000-0000-0000-0000000000c3', 'fixed_notional', 12, 13, 13, false);

insert into public.trades
  (bot_id, user_id, signal_id, client_order_id, trading_pair, side, quantity, status, requested_notional_usdt, executed_notional_usdt) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'sig-a-1', 'co-a-1', 'BTCUSDT', 'buy', 0.0003,
   'filled', 12, 12);

insert into public.audit_logs (entity_type, entity_id, event_type, after_state) values
  ('bot', '00000000-0000-0000-0000-0000000000a2', 'order.blocked',
   jsonb_build_object('reason', 'insufficient_quote_balance'));

-- As user A: own bot, caps, position, last block; NO secrets.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare v jsonb; b jsonb;
begin
  v := public.user_bot_dashboard();
  assert jsonb_array_length(v) = 1,                                 '033: user A sees exactly 1 bot';
  b := v->0;
  assert (b->>'trading_pair') = 'BTCUSDT',                          '033: A pair';
  assert (b->>'max_order_notional_usdt') = '13',                    '033: A caps';
  assert (b->>'exchange_environment') = 'mainnet',                  '033: A env';
  assert (b->>'credential_status') = 'valid',                       '033: A credential status';
  assert (b->>'cost_basis_usdt')::numeric = 12,                     '033: A cost basis from filled buy';
  assert (b->>'last_block_reason') = 'insufficient_quote_balance',  '033: A last block reason';
  assert jsonb_array_length(b->'recent_trades') = 1,               '033: A recent trades';
  assert not (v::text ~* '(webhook_secret_hash|vault_secret_id|api_key|api_secret|service_role|pepper|token)'),
                                                                    '033: no secret substrings';
end $$;

-- As user B: ZERO of A's bots (cross-user isolation — the key safety test).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  v := public.user_bot_dashboard();
  assert jsonb_array_length(v) = 0, '033: user B sees ZERO of A''s bots (isolation)';
end $$;

-- User B cannot pause A's bot.
do $$
begin
  begin
    perform public.user_pause_own_bot('00000000-0000-0000-0000-0000000000a2');
    raise exception '033: expected 42501 pausing a non-owned bot';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- User A pauses own bot → paused/disabled + audit row.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare r jsonb; s text; te boolean; n int;
begin
  r := public.user_pause_own_bot('00000000-0000-0000-0000-0000000000a2');
  assert (r->>'ok') = 'true', '033: pause ok';
  select status::text, trading_enabled into s, te from public.bots where id='00000000-0000-0000-0000-0000000000a2';
  assert s = 'paused' and te = false, '033: bot now paused + disabled';
  select count(*) into n from public.audit_logs
    where entity_id='00000000-0000-0000-0000-0000000000a2' and event_type='bot.user_paused';
  assert n = 1, '033: bot.user_paused audit row written';
end $$;
select set_config('request.jwt.claims', '', true);

-- null uid → 42501 (deny-by-default).
do $$
begin
  begin perform public.user_bot_dashboard(); raise exception '033: expected 42501 (null uid, dashboard)';
  exception when sqlstate '42501' then null; end;
end $$;

do $$ begin raise notice 'ALL 033 TESTS PASSED'; end $$;

rollback;
