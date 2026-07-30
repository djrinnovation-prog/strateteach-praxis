-- ============================================================================
-- LOCAL-ONLY test for migration 029 — H-2 atomic notional-cap reservation RPC.
-- LOCAL Supabase ONLY (never --linked). Requires 001..029 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/029_h2_atomic_notional_cap.test.sql
-- Calls insert_pending_trade_atomic directly (SECURITY DEFINER); no jwt needed.
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000029', 'binance-t029', 'Binance T029', 'binance-t029');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000a9', 'ua029@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0291', 'a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000029', 'vault-0291', 'c1', 'valid', 'testnet');
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
  ('b0000000-0000-0000-0000-0000000b0291', 'a0000000-0000-0000-0000-0000000000a9', 'c0000000-0000-0000-0000-0000000c0291', 'bot1', 'AAAUSDT', 'x', 'active');

-- POSITIVE: first reservation under cap → returns a trade_id, no rejection, one pending row created.
do $$
declare r record;
begin
  select * into r from public.insert_pending_trade_atomic(
    'b0000000-0000-0000-0000-0000000b0291', 'a0000000-0000-0000-0000-0000000000a9',
    'sig-1', 'PRX_0000000001', 'buy', 'AAAUSDT', 0.001, 100, 1000, 1000);
  assert r.rejected_reason is null, format('029: expected no rejection, got %s', r.rejected_reason);
  assert r.trade_id is not null, '029: expected a trade_id';
  assert (select count(*) from public.trades where bot_id='b0000000-0000-0000-0000-0000000b0291' and signal_id='sig-1' and status='pending')=1,
    '029: one pending trade must exist';
end $$;

-- NEGATIVE: per-order ceiling — requested 2000 > max 1000 → rejected, NO trade.
do $$
declare r record;
begin
  select * into r from public.insert_pending_trade_atomic(
    'b0000000-0000-0000-0000-0000000b0291', 'a0000000-0000-0000-0000-0000000000a9',
    'sig-2', 'PRX_0000000002', 'buy', 'AAAUSDT', 0.02, 2000, 1000, 5000);
  assert r.rejected_reason = 'per_order_max_notional', format('029: expected per_order_max_notional, got %s', r.rejected_reason);
  assert r.trade_id is null, '029: no trade on per-order rejection';
  assert (select count(*) from public.trades where signal_id='sig-2')=0, '029: no row written for rejected per-order';
end $$;

-- NEGATIVE: daily cap — running sum 100 (sig-1) + a prior 850 filled today = 950; +100 > cap 1000 → rejected.
insert into public.trades (bot_id, user_id, signal_id, client_order_id, side, trading_pair, quantity, requested_notional_usdt, status)
  values ('b0000000-0000-0000-0000-0000000b0291','a0000000-0000-0000-0000-0000000000a9','sig-prior','PRX_prior','buy','AAAUSDT',0.008,850,'filled');
do $$
declare r record;
begin
  select * into r from public.insert_pending_trade_atomic(
    'b0000000-0000-0000-0000-0000000b0291', 'a0000000-0000-0000-0000-0000000000a9',
    'sig-3', 'PRX_0000000003', 'buy', 'AAAUSDT', 0.001, 100, 1000, 1000);
  assert r.rejected_reason = 'daily_notional_cap', format('029: expected daily_notional_cap, got %s', r.rejected_reason);
  assert r.trade_id is null, '029: no trade on daily-cap rejection';
end $$;

-- NEGATIVE: duplicate signal_id (sig-1 already reserved) → rejected duplicate_signal.
do $$
declare r record;
begin
  select * into r from public.insert_pending_trade_atomic(
    'b0000000-0000-0000-0000-0000000b0291', 'a0000000-0000-0000-0000-0000000000a9',
    'sig-1', 'PRX_0000000009', 'buy', 'AAAUSDT', 0.001, 100, 1000, 5000);
  assert r.rejected_reason = 'duplicate_signal', format('029: expected duplicate_signal, got %s', r.rejected_reason);
  assert r.trade_id is null, '029: no second trade for a duplicate signal';
  raise notice '029 PASS: reserves under cap; rejects per-order + daily-cap breach atomically; dedups duplicate signal.';
end $$;

rollback;
