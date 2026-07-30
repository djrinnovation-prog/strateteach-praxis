-- ============================================================================
-- LOCAL-ONLY test for migration 037 — EP1b: seed kucoin/bitget/gate (DORMANT).
-- LOCAL Supabase ONLY (never --linked). Requires 001..037 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/037_exchanges_seed_strateteach_venues.test.sql
--
-- Asserts the three new venues exist, are INACTIVE, spot-only, with canonical ccxt ids; that no
-- previously-seeded venue was activated as a side effect; and — the load-bearing invariant — that
-- BINANCE REMAINS THE ONLY ACTIVE EXCHANGE. If any of these fail-closed dormancy guarantees ever
-- regressed, a credential could be pointed at an unproven venue.
-- ============================================================================

begin;

do $$
declare
  active_count int;
begin
  -- The three new venues exist, dormant, spot-only, with canonical ccxt ids.
  assert exists (select 1 from public.exchanges
    where name = 'kucoin' and ccxt_id = 'kucoin' and is_active = false
      and supported_account_types = '{spot}'::account_type[]),
    '037: kucoin must exist, inactive, spot-only, ccxt_id=kucoin';
  assert exists (select 1 from public.exchanges
    where name = 'bitget' and ccxt_id = 'bitget' and is_active = false
      and supported_account_types = '{spot}'::account_type[]),
    '037: bitget must exist, inactive, spot-only, ccxt_id=bitget';
  assert exists (select 1 from public.exchanges
    where name = 'gate' and ccxt_id = 'gate' and is_active = false
      and supported_account_types = '{spot}'::account_type[]),
    '037: gate must exist, inactive, spot-only, ccxt_id=gate';

  -- The venues seeded in 001 that must stay inactive are still inactive (no accidental activation).
  assert not exists (select 1 from public.exchanges
    where name in ('bybit','okx','coinbase','kraken') and is_active = true),
    '037: bybit/okx/coinbase/kraken must remain inactive';

  -- Positive control + load-bearing invariant: binance is active, and it is the ONLY active venue.
  assert exists (select 1 from public.exchanges where name = 'binance' and is_active = true),
    '037: binance must remain active';
  select count(*) into active_count from public.exchanges where is_active = true;
  assert active_count = 1,
    format('037: exactly ONE active exchange (binance) expected, found %s', active_count);
end $$;

rollback;
