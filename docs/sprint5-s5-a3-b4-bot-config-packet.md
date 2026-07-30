# S5-A3/B4 — Bot Sizing/Risk Config Packet (dev/testnet)

**Status:** DESIGN / DOC ONLY. No DB mutation, no apply, no arm has been performed.
**Purpose:** the concrete, reviewable policy values for the §6a config step of
`docs/sprint5-s5-a3-b4-migration-014-apply-runbook.md` — so 014 apply + bot config run with
**approved** values, not improvised ones.
**Gate:** the agent runs no DB mutation. The `UPDATE`s below are operator-executed, and only
**after** migration 014 is applied (§3 of the apply runbook) — the columns must exist first.
**Apply ≠ arm:** every bot here is set `trading_enabled = false` (config-ready, NOT armed). The
per-bot enable (§6b of the apply runbook) and re-enabling the queue are a separate Oren-approved
arm step, out of scope for this packet.

---

## 1. Scope — bots + credential (read-only verified 2026-06-30)
A read-only `bots ⋈ user_exchange_credentials` check (existing columns only, no secrets) confirmed
all five dev/testnet bots are `spot`, `active`, and share **one** credential
`2b5c038a-a4a7-4be5-b2fe-90d32f67781b` (`status=valid`, not deleted):

| trading_pair | bot_id | credential_id |
|---|---|---|
| BTCUSDT | `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` | `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` |
| ETHUSDT | `c8913354-8b7e-4d8d-8b3d-fb8b8f8248df` | `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` |
| BNBUSDT | `36b46eb3-9384-4e05-a79b-1246e9b85119` | `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` |
| SOLUSDT | `5acc84c9-edd2-4c9f-87dd-fd928f8b62cd` | `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` |
| XRPUSDT | `297dddb9-965b-49ff-abd8-e3e8e88fa4fc` | `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` |

Because the credential is shared, the environment is set **once** for all five.

---

## 2. Sizing-mode decision — recommend `fixed_notional` for testnet
The design's v1 primary is `percent_of_balance`, but for a **dev/testnet** first config `fixed_notional`
is the safer, more predictable choice:
- `percent_of_balance` notional = `position_size_pct% × free USDT`, so the order size depends on the
  **live testnet balance** (which we have not read — reading it is an Exchange call, out of scope here).
  If the balance is low, the order can fall **under minNotional** → the worker fail-closes
  `below_min_notional`; if it is high, a small percent can still be larger than intended.
- `fixed_notional` is a flat, balance-independent USDT order that we can set safely above minNotional
  (Binance spot minNotional ≈ $5–10) and below a tight per-order cap — deterministic on testnet.

Both modes are fully supported by the merged worker. **Operator/Codex decide;** §4 gives a row for
each mode so the choice is a one-line switch.

---

## 3. Recommended values (conservative dev/testnet) — OPERATOR TO CONFIRM
These are **proposed policy values**, not hardcoded business logic (the code is the guardrail; these
live in DB config). All five bots are identical because they draw on one shared testnet account.

| field | recommended (fixed_notional) | recommended (percent_of_balance alt) | rationale |
|---|---|---|---|
| `sizing_mode` | `fixed_notional` | `percent_of_balance` | testnet predictability vs design v1 default |
| `fixed_notional_usdt` | `20` | — (null) | ≈2–4× minNotional → clears it with margin, still tiny |
| `position_size_pct` | — (null) | `2` | 2% of free USDT per BUY |
| `max_order_notional_usdt` | `25` | `25` | per-order ceiling ≥ the order notional |
| `daily_notional_cap_usdt` | `100` | `100` | ≈5 orders/day on testnet |
| `sell_enabled` | `false` | `false` | v1: SELL off (worker blocks SELL regardless) |
| `trading_enabled` | `false` | `false` | config-ready, NOT armed (enable = §6b, arm-time) |
| credential `exchange_environment` | `testnet` | `testnet` | matches the dev worker (`PRAXIS_IS_PRODUCTION` ≠ 'true') |

Notes:
- Keep `fixed_notional_usdt ≤ max_order_notional_usdt` (20 ≤ 25) or the order self-blocks `per_order_max_notional`.
- `max_order_notional_usdt ≤ daily_notional_cap_usdt` so at least one order can pass the daily cap.
- For `percent_of_balance`, confirm `2% × free USDT ≥ minNotional` for the account, else use `fixed_notional`.

---

## 4. Config statements (run AFTER 014 applied; operator-executed; trading_enabled stays false)
This is §6a of the apply runbook with concrete values. **Pick one `UPDATE` per bot** (fixed_notional
shown; the percent alternative is commented). Run the credential `UPDATE` once.

**4a. Credential environment (once, covers all five bots):**
```sql
UPDATE public.user_exchange_credentials
SET exchange_environment = 'testnet'           -- 'mainnet' only for a production worker
WHERE id = '2b5c038a-a4a7-4be5-b2fe-90d32f67781b'
RETURNING id, exchange_environment;
```

**4b. Bot config — all five at once (values are identical; one statement avoids copy/paste errors).**
`fixed_notional`, `trading_enabled=false`:
```sql
UPDATE public.bots SET
  sizing_mode             = 'fixed_notional',
  fixed_notional_usdt     = 20,
  position_size_pct       = NULL,
  max_order_notional_usdt = 25,
  daily_notional_cap_usdt = 100,
  sell_enabled            = false,
  trading_enabled         = false      -- config-ready; enable is §6b (arm-time, separate approval)
WHERE id IN (
  '2dcaddba-b62d-47e1-87a7-7f7b759f38d2',   -- BTCUSDT
  'c8913354-8b7e-4d8d-8b3d-fb8b8f8248df',   -- ETHUSDT
  '36b46eb3-9384-4e05-a79b-1246e9b85119',   -- BNBUSDT
  '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',   -- SOLUSDT
  '297dddb9-965b-49ff-abd8-e3e8e88fa4fc'    -- XRPUSDT
)
RETURNING id, trading_pair, sizing_mode, fixed_notional_usdt, position_size_pct,
          max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled, trading_enabled;
```
**`RETURNING` must return exactly 5 rows** — anything else means a bot_id didn't match (stop and reconcile against §1/§5 before proceeding). Capture the 5 rows as E2 evidence.

```sql
-- percent_of_balance alternative (use INSTEAD of the block above if chosen; same WHERE id IN list):
-- UPDATE public.bots SET
--   sizing_mode             = 'percent_of_balance',
--   position_size_pct       = 2,
--   fixed_notional_usdt     = NULL,
--   max_order_notional_usdt = 25,
--   daily_notional_cap_usdt = 100,
--   sell_enabled            = false,
--   trading_enabled         = false
-- WHERE id IN ( ...the same five bot_ids as above... )
-- RETURNING id, trading_pair, sizing_mode, position_size_pct, fixed_notional_usdt,
--           max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled, trading_enabled;
```

---

## 5. Pre-config read-only verification (before running §4)
```sql
-- 1) 014 is applied (the columns exist) — else §4 errors:
SELECT count(*) AS sizing_cols
FROM information_schema.columns
WHERE table_schema='public' AND table_name='bots'
  AND column_name IN ('sizing_mode','fixed_notional_usdt','position_size_pct',
    'max_order_notional_usdt','daily_notional_cap_usdt','trading_enabled','sell_enabled');
-- expect 7

-- 2) the five bots + shared credential still match §1 (no secrets selected):
SELECT b.id, b.trading_pair, b.status, b.credential_id, c.status AS cred_status
FROM public.bots b
JOIN public.user_exchange_credentials c ON c.id = b.credential_id
WHERE b.id IN ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df',
  '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
  '297dddb9-965b-49ff-abd8-e3e8e88fa4fc')
ORDER BY b.trading_pair;
```

**Post-config readiness re-check (§6a of the apply runbook):** confirm each bot reports all fields set
and **`trading_enabled = false`** (config-ready, not armed).

---

## 6. What this packet is NOT
- **Not an apply.** Migration 014 is applied per the apply runbook §3 first; these `UPDATE`s need the columns.
- **Not arm.** Every bot stays `trading_enabled = false`. The per-bot enable (§6b, mode-specific +
  env-checked guard) and re-enabling the queue are a separate Oren-approved step.
- **Not SELL.** `sell_enabled = false`; the worker blocks SELL fail-closed in v1 regardless.

---

## 7. Open decisions (operator / Codex)
1. **Mode:** `fixed_notional` (recommended for testnet) or `percent_of_balance` (design v1 default)?
2. **Numbers:** confirm/adjust `fixed_notional_usdt=20`, `max_order_notional_usdt=25`, `daily_notional_cap_usdt=100`.
3. **Uniform vs per-bot:** all five identical (proposed), or different caps per symbol?
4. If `percent_of_balance`: confirm `2% × free testnet USDT ≥ minNotional`, else fall back to `fixed_notional`.
