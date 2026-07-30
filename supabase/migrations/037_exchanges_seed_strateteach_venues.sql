-- Migration 037 (EP1b): seed the remaining StrateTeach-supported venues into `exchanges`,
-- DORMANT (is_active = FALSE).
--
-- Context: the `exchanges` table (001) was designed multi-exchange from day one and already seeds
-- binance (active) + bybit/okx/coinbase/kraken (inactive). StrateTeach's dashboard supports eight
-- venues (binance, bybit, okx, kraken, kucoin, bitget, gate, coinbase); three of them — kucoin,
-- bitget, gate — are not yet rows here. This migration adds ONLY those three, all is_active=FALSE.
--
-- SAFETY: purely additive reference data. is_active=FALSE means the worker's EP1b fail-closed gate
-- refuses to build an adapter for these venues — a credential could not be pointed at them and no
-- order could ever route there — until an operator flips is_active in a deliberate, separate step
-- (after that venue's adapter parity + testnet validation land, EP2). No existing row is touched;
-- binance stays the only active venue. ccxt_id values are the canonical ccxt exchange ids
-- (kucoin, bitget, gate) that EP1b threads into the adapter. supported_account_types stays '{spot}'
-- (futures is a later, separately-gated capability — EP4 — and is added per venue only when proven).
--
-- Apply LOCAL for tests (`supabase db reset`); a linked apply is a SEPARATE gated step — no db push.

begin;

insert into public.exchanges (name, display_name, ccxt_id, supported_account_types, is_active)
values
  ('kucoin', 'KuCoin', 'kucoin', '{spot}', false),
  ('bitget', 'Bitget', 'bitget', '{spot}', false),
  ('gate',   'Gate',   'gate',   '{spot}', false)
on conflict (name) do nothing;

commit;
