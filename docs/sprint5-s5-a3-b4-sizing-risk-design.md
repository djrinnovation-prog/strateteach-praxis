# Sprint 5 · A3 + B4 — Real Order Sizing + Server-Enforced Risk Limits (DESIGN)

**Status:** DESIGN / DISCOVERY only — **no code / DB / Doppler / Railway / Supabase changes, no
arm/fire, no live orders.** Replaces the temporary per-symbol BUY price floors (`4f0cc0e`) with
production-grade server-side sizing (A3) + server-enforced risk controls (B4). Closes nothing —
A3/B4 remain open MUST gates. Grounding: `worker/src/index.ts`, `worker/src/BinanceAdapter.ts`,
`worker/src/types.ts`, `supabase/migrations/001_initial_schema.sql`,
`docs/production-readiness-gap-review.md`, DECISIONS (Trade quantity calculation · Signal wire
contract · Profile⊇Credential⊇Bot⊇Signal · Vault secret contract). **Testnet-first; Migration 009
frozen; no mainnet.**

## 1. Current behavior (as built)
- **BUY quantity** — `calculateBuyQuantity(rules)` (index.ts ~421): `ceil(minNotional × 1.5 /
  ASSUMED_MIN_PRICE_FLOOR_USDT[symbol] / stepSize) × stepSize`, then `max(minQty)`. Per-symbol
  **price floors** (BTC 25 000 · ETH 700 · BNB 200 · SOL 25 · XRP 0.40); **fail-loud** for an
  unconfigured symbol. **Does not read the live price or any balance.** Placeholder.
- **SELL quantity** — `calculateSellQuantity(rules, freeBalance)` (~441): `floor(freeBalance × 0.95 /
  stepSize) × stepSize`; returns `null` (skip) if `< minQty`. The `0.95` is a placeholder.
- **Call site** — `processMessage` BUY/SELL branch (~805 / ~857): `rules = getMarketRules(bot.trading_pair)`;
  SELL also `fetchBalance`. Then `adapter.createOrder({ symbol: rules.symbol, side, type:'market',
  quantity, clientOrderId })`.
- **Payload quantity is NOT accepted.** The pgmq message is `{schema_version, bot_id, signal_id,
  side}` only; symbol comes from `bots.trading_pair`, **never** the payload; quantity is computed
  server-side. The webhook reads only `signal_id` + `action` (buy/sell) — any payload `quantity`
  field is **ignored** (Signal wire contract).
- **DB fields today** — `bots(id,user_id,credential_id,name,trading_pair,account_type,
  webhook_secret_hash,status,consecutive_failures,…)`: **no sizing/risk columns.**
  `user_exchange_credentials(status,vault_secret_id,permissions_confirmed{can_trade,can_read},
  deleted_at,…)`. `profiles(subscription_status,…)`: **no risk fields.** Enums: `bot_status`,
  `credential_status`, `account_type`. Env: deployment-global `PRAXIS_IS_PRODUCTION` →
  `is_production` (BinanceAdapter `setSandboxMode(!isProduction)`).

## 2. Proposed sizing model (A3)
> **The code is the guardrail; the database config is the policy.** No business sizing/risk **values**
> are hardcoded in the worker — code enforces the policy; `bots`/`profiles` DB config stores it (and a
> later admin/UI edits that config, never the enforcement).

- **Sizing mode (hybrid, DB-driven):** `bots.sizing_mode` ∈ {`percent_of_balance`, `fixed_notional`}.
  - `percent_of_balance` → `position_size_pct` (% of free **quote** balance) is the source.
  - `fixed_notional` → `fixed_notional_usdt` (flat per-order notional) is the source.
  - **v1 executes `percent_of_balance`**; the schema + sizing interface stay **forward-compatible**
    with `fixed_notional` (addable later without migration churn). **Fail-closed** if `sizing_mode`
    is missing or unsupported — **no fallback to the old price floors, no default business value in code.**
- **Live-price BUY sizing:** notional = (per the mode) `position_size_pct% × free_quote` **or**
  `fixed_notional_usdt`; `qty = roundDown(notional / live_price, stepSize)`. Requires a **live price** →
  add a read-only `fetchPrice(symbol)` (ccxt `fetchTicker().last`) to the adapter (today only
  `getMarketRules`/`fetchBalance` exist).
- **minNotional / stepSize / minQty:** round qty **DOWN** to `stepSize`; then **require**
  `qty ≥ minQty` **and** `qty × live_price ≥ minNotional`. Below either → **FAIL-CLOSED** (no silent
  bump to minNotional, no fallback to the old floor). Surface an observable blocked artifact.
- **SELL:** **disabled by default in v1** (`bots.sell_enabled=false`). When enabled — position-based:
  `sell_size_pct% × free_base_balance`, round **DOWN** to stepSize, skip (ack) if `< minQty`; same
  risk caps (§3) using live price.
- **Fail-closed inputs:** if **any** of {`sizing_mode`, the mode's required size field, live price,
  market rules, balance, credential `can_trade`} is missing/invalid/stale → **no sizing, no order**;
  mark the trade observably (failed/blocked) + audit; **never** a default size or the old floor.

## 3. Proposed risk model (B4 — server-side ONLY)
Enforced in the worker **before `createOrder`**; the frontend may *display* limits but is **never**
the authority.
| Control | Source | Rule (reject → fail-closed, observable) |
|---|---|---|
| Per-order max notional | `bots.max_order_notional_usdt` | order notional > cap → block |
| Daily max notional (bot) | `bots.daily_notional_cap_usdt`; today's **stored** `trades.requested_notional_usdt` | Σ(today's `requested_notional_usdt` for the bot, non-rejected rows) + this order's requested > cap → block |
| Daily max notional (user) | `profiles.daily_notional_cap_usdt` (optional); today's stored requested across the user's bots | Σ + this > cap → block |
| Kill switch / disabled | `bots.trading_enabled` (+ `bots.status`) | `trading_enabled=false` or status not active/error → block (reported **disabled**, not misconfigured; observable, no silent ack) |
| Credential valid | `user_exchange_credentials.status='valid'` + not deleted + `can_trade` | invalid → block + bot→error (existing ENG-002 path) |
| Environment guard | `user_exchange_credentials.exchange_environment` (testnet\|mainnet) vs `is_production` | mismatch **or missing** → block (block matrix in §4) |

All checks re-derived server-side from DB + live data at execution time; UI values are advisory only.

**Daily-cap accounting (no historical recompute):** the running daily sum reserves against the
**stored** `requested_notional_usdt` (written at the sizing/risk decision, on the `pending` row);
**`executed_notional_usdt`** (from the exchange order `cost`, when available) is the final /
reporting figure. Historical notional is **never** recomputed from a later live price (price drifts).
Reservation rule: a row counts toward the daily sum from the moment it is sized (pending) and stays
counted unless it ends rejected/failed-before-submit; the cap check is `Σ stored requested + this
order's requested ≤ cap`.

## 4. Schema impact
- **New `bots` columns** (business config — **NULL/unset = fail-closed**, no silent default):
  `sizing_mode TEXT CHECK (sizing_mode IN ('percent_of_balance','fixed_notional'))`,
  `position_size_pct NUMERIC CHECK (> 0 AND <= 100)` — used when `sizing_mode='percent_of_balance'`,
  `fixed_notional_usdt NUMERIC CHECK (> 0)` — used when `sizing_mode='fixed_notional'` (v1 unused but schema-ready),
  `max_order_notional_usdt NUMERIC CHECK (> 0)` — always,
  `daily_notional_cap_usdt NUMERIC CHECK (> 0)` — always,
  `trading_enabled BOOLEAN NOT NULL DEFAULT true` — server-side kill switch,
  `sell_enabled BOOLEAN NOT NULL DEFAULT false` — v1: SELL off,
  `sell_size_pct NUMERIC CHECK (> 0 AND <= 100)` — used when `sell_enabled=true`.
  (Business **values** live only here, never in code — "code is the guardrail; DB config is the policy".)
- **Optional `profiles` column:** `daily_notional_cap_usdt NUMERIC` (user-wide cap).
- **New `trades` columns (daily-cap accounting):** `requested_notional_usdt NUMERIC` — the sized
  notional, written at the sizing/risk decision (on the `pending` row, before `createOrder`);
  `executed_notional_usdt NUMERIC` — optional, set from the exchange order `cost` on fill. Today
  `trades` stores only `quantity` + `price_at_execution` (no notional) — these columns make the
  daily cap auditable without ever recomputing historical notional from a later live price.
- **New `user_exchange_credentials` column (environment source of truth):** `exchange_environment` —
  enum/CHECK `('testnet','mainnet')`. **This is the environment SoT.** `account_type`
  (`spot`/`futures`) is a **market-type, NOT an environment** — insufficient for the guard. Worker
  **block matrix:** `is_production=false` + `mainnet` credential → block; `is_production=true` +
  `testnet` credential → block; `exchange_environment` missing → block.
- **Migration number:** next clean number is **`014_bot_sizing_risk.sql`** (009 frozen; 010–013
  applied **surgically**, not in `supabase_migrations`). 014 must follow the **same surgical apply +
  history-reconcile** process (do not `db push` blindly — it would re-apply 010–013).
- **RLS:** new columns inherit existing `bots` RLS (owner-scoped); the worker reads via
  `service_role` (bypasses RLS). No new policy needed. If a dashboard/read-only role must show
  limits, add explicit column grants then (not in this migration unless required).
- **Defaults for existing bots:** **NULL** → the worker treats unconfigured sizing/risk as
  **fail-closed** (no order) until explicitly set. **No auto-backfill** that could enable trading.
- **Backfill strategy:** none automatic. Each bot (incl. the testnet campaign bots) gets explicit
  config via a **gated** config step before it can trade post-migration.

### Config readiness (required before a bot may trade)
A bot is **trade-ready** only when its required config is non-NULL (anything NULL → **fail-closed**,
no order, observable block):
- `sizing_mode` — **always** required.
- `position_size_pct` — required **only when** `sizing_mode='percent_of_balance'`.
- `fixed_notional_usdt` — required **only when** `sizing_mode='fixed_notional'`.
- `max_order_notional_usdt` — **always** required.
- `daily_notional_cap_usdt` — **always** required.
- `sell_size_pct` — required **only when** `sell_enabled=true`.
- `user_exchange_credentials.exchange_environment` — **always** required (must match `is_production`).
- `trading_enabled=false` → reported as **disabled** (a deliberate kill-switch state), **not** misconfigured.

**E2 verify — list unconfigured bots (must be empty before arming):**
```sql
SELECT b.id, b.name, b.trading_pair, b.sizing_mode, b.trading_enabled,
       (b.sizing_mode IS NULL)                                                  AS missing_sizing_mode,
       (b.sizing_mode = 'percent_of_balance' AND b.position_size_pct  IS NULL)  AS missing_pct,
       (b.sizing_mode = 'fixed_notional'     AND b.fixed_notional_usdt IS NULL) AS missing_fixed,
       (b.max_order_notional_usdt IS NULL)                                      AS missing_max_notional,
       (b.daily_notional_cap_usdt IS NULL)                                      AS missing_daily_cap,
       (b.sell_enabled AND b.sell_size_pct IS NULL)                            AS missing_sell_pct,
       (c.exchange_environment IS NULL)                                         AS missing_env,
       (b.trading_enabled = false)                                             AS disabled_not_misconfigured
FROM public.bots b
LEFT JOIN public.user_exchange_credentials c ON c.id = b.credential_id
WHERE b.deleted_at IS NULL
  AND ( b.sizing_mode IS NULL
     OR (b.sizing_mode = 'percent_of_balance' AND b.position_size_pct  IS NULL)
     OR (b.sizing_mode = 'fixed_notional'     AND b.fixed_notional_usdt IS NULL)
     OR b.max_order_notional_usdt IS NULL
     OR b.daily_notional_cap_usdt IS NULL
     OR (b.sell_enabled AND b.sell_size_pct IS NULL)
     OR c.exchange_environment IS NULL );
-- trading_enabled=false is surfaced (disabled_not_misconfigured) but is NOT a missing-config row.
```
- **Gated config packet (post-migration, required):** existing + campaign bots are configured via a
  separate **gated** step (per-bot `position_size_pct`, `max_order_notional_usdt`,
  `daily_notional_cap_usdt`, `sell_size_pct` if SELL, and the credential's `exchange_environment`).
  **No silent defaults** — a bot trades only after it passes the readiness check above (E2 query empty
  for that bot).

## 5. Code impact
- `worker/src/types.ts` — add the `Bot` sizing/risk config fields to the bot type; new errors
  `SizingUnavailableError`, `RiskLimitExceededError` (secret-safe; no raw cause).
- `worker/src/BinanceAdapter.ts` — add read-only `fetchPrice(symbol)` (ccxt `fetchTicker().last`),
  same secret-safe error handling as the other adapter calls (`safeExchangeDetail`).
- `worker/src/index.ts` —
  - **Remove** `ASSUMED_MIN_PRICE_FLOOR_USDT` + the floor-based `calculateBuyQuantity`; **no silent
    fallback**.
  - New `computeBuyQuantity(bot, rules, price, freeQuote)` + `computeSellQuantity(bot, rules,
    freeBase)` (config + live price; fail-closed).
  - New `enforceRiskLimits(bot, profile, order, price, todayNotional)` called **after sizing, before
    `adapter.createOrder`**; on violation → mark trade `failed` + audit `trade.risk_blocked` + alert,
    `ack:true`, **no order**.
  - Extend the **bots select** (~623) + add the credential/profile fields the checks need; add a
    today-notional query that sums stored `trades.requested_notional_usdt`. **Persist
    `requested_notional_usdt` on the `pending` row at sizing time**, and set `executed_notional_usdt`
    from the exchange order `cost` on fill (daily cap reserves on requested; executed is final).
- **Audit/log of blocked orders:** new `risk_blocked` / `sizing_unavailable` log event + a
  `trade.risk_blocked` audit row (entity_type/entity_id set atomically). Observable, never silent.
- **Secret-safe logging:** log only `symbol, side, qty, notional, the limit hit, bot_id, signal_id`
  — never api keys, the decrypted credential, or full balances; reuse the existing redaction
  discipline.

## 6. Test plan
- **Unit:** `computeBuyQuantity` (notional = pct×quote; qty = roundDown(notional/price, stepSize);
  minNotional/minQty enforced; **fail-closed** when price/rules/balance/config missing) across all 5
  symbols + edge prices; `computeSellQuantity` (pct×base, round-down, skip < minQty);
  `enforceRiskLimits` (per-order max, daily cap, kill switch, credential invalid, env guard).
- **Integration-offline:** `processMessage` with mocked adapter+supabase — BUY/SELL produce correct
  qty and pass/block; a blocked order writes `trade.risk_blocked` + acks; no `createOrder` on block.
- **Testnet E1 smoke (gated, no mainnet):** configure one bot's `position_size_pct` + caps → armed
  1–2 fills within limits; an **over-cap** fire → **blocked** (audit/log artifact, no order, no
  fill). Disarm after.
- **Negative tests:** over per-order limit · over daily cap · missing `position_size_pct` (fail-closed)
  · stale/unavailable price (fail-closed) · invalid credential (fail-closed + bot→error) ·
  insufficient balance (fail-closed/skip). Each must produce an observable artifact — **zero silent
  failures**.

## 7. Backward compatibility
- **Existing testnet bots:** after 014 (NULL defaults) → **fail-closed** (no order) until
  `position_size_pct` + caps are set. Intentional — no silent sizing with real config absent.
- **Campaign bots (BTC/ETH/BNB/SOL/XRP):** **need explicit config** (gated) before any next campaign;
  the old per-symbol floors are gone.
- **TradingView / StrateTeach payload quantity:** still **ignored / non-authoritative** — the wire
  contract carries only `side`; quantity is server-derived. Document explicitly so no integrator
  assumes payload sizing.

## 8. Stop conditions
- **No mainnet / live funds** — testnet-first; mainnet only after the full A3+B4 MUST gate +
  credential isolation (A4) + egress (A1) + Oren.
- **No shared-credential production path** — A4 must precede any mainnet sizing/risk run.
- **No frontend authority over sizing/limits** — server-side enforcement only; UI is advisory.
- **No silent fallback to the old floors** — they are removed; missing config = fail-closed.
- **No order when any sizing/risk input is unavailable**; `QUEUE_ENABLED=false` until a gated run.

## 9. Decisions
**Decided (this amendment):**
- **Hybrid `sizing_mode`** schema: `percent_of_balance` | `fixed_notional`. **v1 execution starts with
  `percent_of_balance`**; `fixed_notional` is schema-/interface-forward-compatible (added later, no churn).
- **No hardcoded business limit values** — code enforces; DB config (`bots`/`profiles`) is the policy.
  **The code is the guardrail; the database config is the policy.**
- Kill switch = `bots.trading_enabled` (boolean); **SELL off by default in v1** (`sell_enabled=false`).
- Defaults = **NULL → fail-closed**; no auto-backfill; per-bot **gated config packet** required before trading.
- A later **frontend / admin UI edits the DB config**, but the **UI is never the enforcement
  authority** — the worker re-derives + enforces server-side at execution time.
- Environment SoT = `user_exchange_credentials.exchange_environment` (testnet|mainnet); daily-cap
  accounting uses stored `requested_notional_usdt` (+ `executed_notional_usdt` for final accounting).

**Still open (for Oren / Product):**
- Risk-cap scope: bot-level only (v1) vs also a profile-level user-wide cap (`profiles.daily_notional_cap_usdt`).
- Live-price source: ccxt `fetchTicker().last` (recommended) vs order-book mid.

---
**Design only — no implementation, no execution.** On approval of the §9 decisions, implementation
follows the gated design → review → approve → execute → evidence loop (migration 014 + worker
changes + tests), testnet-first. A3/B4 remain **open MUST** until E1/E2 evidence + Oren.
