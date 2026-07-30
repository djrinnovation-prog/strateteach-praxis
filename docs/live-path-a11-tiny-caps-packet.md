# LIVE-PATH — A11 tiny risk caps (execution packet)

Set bot `2dcaddba-…` to tiny, one-order-only mainnet caps. **DO NOT EXECUTE until separately approved.**
Changes ONLY sizing/risk columns. Keeps `status='paused'` and `trading_enabled=false`. No activation, no
tier flip, no signal, no order.

## Current vs target
| Column | Current | Target (tiny) |
|---|---|---|
| `sizing_mode` | fixed_notional | fixed_notional (unchanged) |
| `fixed_notional_usdt` | 20 | **12** |
| `position_size_pct` | null | null (unchanged) |
| `max_order_notional_usdt` | 25 | **13** |
| `daily_notional_cap_usdt` | 100 | **13** |
| `sell_enabled` | false | false (unchanged) |

**One-order guarantee (via the H-2 atomic reservation RPC):** a fixed_notional of 12 reserves `requested=12`.
Order #1: `0 + 12 = 12 ≤ 13` → reserved. Order #2: `12 + 12 = 24 > 13` → **rejected `daily_notional_cap`**.
And `12 ≤ max_order 13`. So the caps permit exactly ONE ~$12 order and hard-block a second.

**Binance minNotional:** BTCUSDT spot minNotional is ~$5 (confirm the live filter). $12 clears it comfortably
even after round-down to stepSize. If the live min were higher than the post-round notional, the order would
fail-closed `below_min_notional` (safe) — so confirm the current min before arming; bump `fixed_notional`
(and `max_order`/`daily_cap` by the same delta, keeping `daily_cap` just above one order) if needed.

## 1. PRE read-back (read-only — ABORT on mismatch)
```sql
select status, trading_enabled, credential_id, sizing_mode,
       fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt
from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect: status='paused', trading_enabled=false, credential_id='1164c49b-…', sizing_mode='fixed_notional',
--         and the CURRENT caps (20/25/100) — i.e. not already tiny.
```

## 2. Mutation (approval-gated) — sizing/risk columns ONLY; CAS-guarded
```sql
update public.bots set
  sizing_mode              = 'fixed_notional',
  fixed_notional_usdt      = 12,
  position_size_pct        = null,
  max_order_notional_usdt  = 13,
  daily_notional_cap_usdt  = 13
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  and user_id = '66e1b075-930e-4a20-9289-ca8668699eea'
  and status = 'paused'                 -- only while paused
  and trading_enabled = false           -- only while disabled
returning id, sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, status, trading_enabled;
```
- Changes ONLY sizing/risk columns. `status`/`trading_enabled`/`credential_id` are NOT in the SET (stay
  paused/false/1164c49b). WHERE guards (owner + paused + disabled) → expect exactly 1 row.

## 3. POST read-back
```sql
select sizing_mode, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt,
       status, trading_enabled, credential_id
from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect: fixed_notional, 12, 13, 13, status='paused', trading_enabled=false, credential_id='1164c49b-…'
```

## 4. Rollback (only if needed)
```sql
update public.bots set fixed_notional_usdt=20, max_order_notional_usdt=25, daily_notional_cap_usdt=100
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' and user_id='66e1b075-930e-4a20-9289-ca8668699eea'
  and status='paused' and trading_enabled=false;
```
Restores the prior caps. Nothing else changes.

## Boundaries
Packet only, not executed. Sets tiny caps ONLY. **No activation · no trading enable · no tier flip · no
signal · no order · no A11 execution.** The bot stays `paused` + `trading_enabled=false` on the valid mainnet
credential.
