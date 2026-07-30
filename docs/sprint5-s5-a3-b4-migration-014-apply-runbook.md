# S5-A3/B4 — Migration 014 Apply & Bot-Config Runbook (sizing + risk)

**Status:** DESIGN / DOC ONLY. Nothing in this runbook has been executed.
**Target:** `supabase/migrations/014_bot_sizing_risk.sql` (committed `25c85c5`, **not applied**).
**Gate:** every step that mutates the DB requires explicit operator approval at the moment of running. The agent does **not** run `db push`, direct SQL, or any DB mutation; does **not** touch Doppler/Railway. **Migration 009 remains frozen.**
**This applies schema only. It does NOT arm trading.** Applying 014 + configuring bots makes the already-merged worker code (`fdae77b`) *able* to size/gate orders — it does not enable processing. Arming = re-enabling the queue, which is a **separate** Oren-approved step.

This runbook is what makes the apply safe given the **migration history exception**: `010`–`013` were applied surgically via direct SQL and are **not** recorded in `supabase_migrations`. Read it end-to-end before running anything. See `docs/sprint5-s5-a3-b4-sizing-risk-design.md` for the model ("the code is the guardrail; the DB config is the policy").

---

## 0. Preconditions
- `014_bot_sizing_risk.sql` is committed and pushed (`25c85c5`); the worker code that reads the new columns is merged (`fdae77b` on `origin/main`).
- Operator has a privileged session to the linked project (e.g. `postgres` / `supabase_admin`) for catalog checks and the apply.
- `QUEUE_ENABLED=false` (no messages processed). Confirm this before and after — applying 014 must not coincide with arming.
- Applying 014 does **not** make any bot trade: all business columns default `NULL` (and `exchange_environment` is `NULL`) → the worker **fail-closes every BUY before any order** until the credential environment + bot sizing/risk config are explicitly set (§6). Depending on which field is missing the block surfaces as `env_missing`, `config_incomplete`, or `trading_disabled` — all are no-order, ack, audited.

---

## 1. Pre-check — migration history (read-only, E2)
```bash
supabase migration list --linked
```
**Expected, given the history exception:**
- `001`–`008` show **Local = Remote**.
- `009` has **no local file** (frozen, never created) — confirm it does not appear as a Local migration and creates no gap the tooling would try to fill.
- `010`, `011`, `012`, `013` appear **Local but not Remote** (each applied surgically, never tracked).
- `014_bot_sizing_risk` appears **Local only** (never applied).

Record the exact output as E2 evidence (command + output + date). Do **not** proceed to any push if the history is not understood.

---

## 2. Decision point — do NOT naive `db push`
Because `010`–`013` are missing from the remote `supabase_migrations` history, a naive `supabase db push` would attempt to apply **`010`, `011`, `012`, `013`, AND `014`** in one shot. Re-running `010`–`013` is exactly the risk the history exception warns about (some are not safely idempotent on a populated DB), and it couples this apply to a history-reconcile that has **not** been approved.

**Rule:** do **not** run `supabase db push` unless the `010`–`013` history has first been reconciled under a **separate** explicit approval.

Two acceptable paths (operator chooses, with approval):
- **Path A (RECOMMENDED) — surgical direct SQL.** Apply `014` exactly as `010`–`013` were applied: run the file's SQL directly against the linked DB **inside one transaction**, then log a written exception ("014 applied surgically via direct SQL, not in `supabase_migrations`"). Lowest blast radius; touches only the new columns.
- **Path B — reconcile history, then push.** First reconcile/repair the migration history so `010`–`014` are correctly represented, then `db push`. More moving parts; only if the operator wants the history fully back in sync. Must be its own approved step (§4).

---

## 3. Recommended apply path (Path A — surgical, in a transaction, explicit approval)
**Run only on explicit "apply 014 now" approval.**

`014` is **additive DDL** (`ALTER TABLE … ADD COLUMN` on `bots`, `trades`, `user_exchange_credentials`). Two facts drive the apply method:
1. Plain `ADD COLUMN` is **not idempotent** — re-running fails with "column already exists". Apply exactly once.
2. Postgres DDL is **transactional** — wrapping the whole file in one `BEGIN … COMMIT` makes the apply **atomic**: a mid-apply error rolls back every column so the schema is left untouched and the apply is cleanly retryable.

The project habit is `supabase db query --linked --file …`. Running the migration file **raw** that way would execute it without a transaction — so build a wrapped copy first and apply *that*, never the raw file. Atomic copy-paste (no secrets involved):
```bash
{
  echo "BEGIN;"
  cat supabase/migrations/014_bot_sizing_risk.sql
  echo "COMMIT;"
} > /tmp/014_bot_sizing_risk.transaction.sql

supabase db query --linked --file /tmp/014_bot_sizing_risk.transaction.sql   # run only on "apply 014 now" approval
rm -f /tmp/014_bot_sizing_risk.transaction.sql
```
A mid-apply error rolls the whole transaction back (schema untouched, cleanly retryable). Then capture §5 verification (E2) and log the written exception (Path A) in `DECISIONS.md` / Current Status, exactly as for `010`–`013`.

> Optional hardening (separate, gated edit — not required for a one-time apply): change `014` to `ADD COLUMN IF NOT EXISTS …` to make it re-runnable. Do **not** edit the committed migration as part of this apply; the transaction wrap already gives atomic safety.

---

## 4. (If Path B chosen) history reconcile
Out of scope to detail here — must be its own gated step with its own approval and evidence, covering `010`–`013` as well as `014`. Do not improvise a `db push` mid-apply. If unsure, use Path A.

---

## 5. E2 verification — columns present with the intended types / constraints / defaults
Privileged session. PASS = each query returns exactly the expected rows.

**(1) `bots` — 8 new columns:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'bots'
  AND column_name IN ('sizing_mode','position_size_pct','fixed_notional_usdt',
    'max_order_notional_usdt','daily_notional_cap_usdt','trading_enabled',
    'sell_enabled','sell_size_pct')
ORDER BY column_name;
```
Expected: all 8 present. `trading_enabled` / `sell_enabled` → `boolean`, `is_nullable=NO`, defaults `true` / `false`. The 5 numeric + `sizing_mode` → nullable, no default.

**(2) `trades` — 2 new columns:**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='trades'
  AND column_name IN ('requested_notional_usdt','executed_notional_usdt')
ORDER BY column_name;
```
Expected: both present, `numeric`, nullable.

**(3) `user_exchange_credentials` — environment column:**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='user_exchange_credentials'
  AND column_name='exchange_environment';
```
Expected: present, `text`, nullable.

**(4) CHECK constraints exist (sizing_mode enum, env enum, positivity):**
```sql
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid IN ('public.bots'::regclass,'public.trades'::regclass,
                   'public.user_exchange_credentials'::regclass)
  AND contype='c'
  AND pg_get_constraintdef(oid) ~* 'sizing_mode|notional|position_size_pct|sell_size_pct|exchange_environment'
ORDER BY conname;
```
Expected: `sizing_mode IN ('percent_of_balance','fixed_notional')`; `exchange_environment IN ('testnet','mainnet')`; the `> 0` / `>= 0` checks on the numerics.

**(5) Fail-closed confirmation — existing bots are unconfigured:**
```sql
SELECT count(*) AS total_bots,
       count(*) FILTER (WHERE sizing_mode IS NULL) AS unconfigured
FROM public.bots;
```
Expected: `unconfigured = total_bots` immediately after apply → every bot fail-closes before any order until §6 (the block surfaces as `env_missing` / `config_incomplete` / `trading_disabled` depending on which field is still missing).

Record all outcomes as E2 (catalog reads).

---

## 6. Bot / credential configuration (fail-closed until done)
These are **policy values, not secrets** — they may appear in chat/SQL (unlike the Vault pointer or any key). Each bot that should trade needs an explicit sizing/risk config; each credential needs `exchange_environment`.

> **Recommended arm-prep safety (defense in depth):** immediately after §3, explicitly set the kill switch OFF on all existing bots, then flip it on per-bot only as the deliberate final "enable this bot" step. `trading_enabled` defaults `TRUE`, so without this a bot becomes tradeable the instant its sizing config is filled in.
> ```sql
> UPDATE public.bots SET trading_enabled = false;   -- explicit kill until each bot is reviewed
> ```

**Per credential** (environment must match the worker's `PRAXIS_IS_PRODUCTION`; dev = `testnet`):
```sql
UPDATE public.user_exchange_credentials
SET exchange_environment = 'testnet'        -- 'mainnet' only for a production worker
WHERE id = '<credential-uuid>';
```

**Step 6a — CONFIG (sets policy, NOT enable).** `trading_enabled` stays `false`: a fully-configured bot with the kill switch off is **config-ready, not armed**. Choose the policy numbers deliberately; v1 keeps SELL off.
```sql
UPDATE public.bots SET
  sizing_mode             = 'percent_of_balance',  -- or 'fixed_notional'
  position_size_pct       = <pct 0–100>,           -- required for percent_of_balance
  -- fixed_notional_usdt  = <usdt>,                -- required instead, for fixed_notional
  max_order_notional_usdt = <per-order cap usdt>,  -- required
  daily_notional_cap_usdt = <daily cap usdt>,      -- required
  sell_enabled            = false,                 -- v1: SELL off (worker blocks SELL regardless)
  trading_enabled         = false                  -- still OFF — enabling is a separate arm-time step (6b)
WHERE id = '<bot-uuid>'
RETURNING id, sizing_mode, position_size_pct, fixed_notional_usdt,
          max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled, trading_enabled;
```

**Readiness re-check (E2)** — confirm a configured bot reports no missing fields (still with the kill switch off):
```sql
SELECT b.id, b.sizing_mode, b.position_size_pct, b.fixed_notional_usdt,
       b.max_order_notional_usdt, b.daily_notional_cap_usdt,
       b.trading_enabled, b.sell_enabled, c.exchange_environment
FROM public.bots b
JOIN public.user_exchange_credentials c ON c.id = b.credential_id
WHERE b.id = '<bot-uuid>';
```
PASS = sizing_mode set, the matching size field set, both caps set, `exchange_environment` set and matching the worker environment, **`trading_enabled = false`**. (This mirrors `isBotConfigReady` — the worker still re-validates server-side on every signal.) Config-ready ends here.

**Step 6b — ENABLE (ARM-TIME ONLY).** Do **not** run as part of this apply. This flips the kill switch on and belongs with arming (§7) — only after 6a readiness PASS *and* the separate Oren-approved arm decision. The guard is **mode-specific** and also checks the credential environment, so it refuses to enable any bot the worker would still block (`config_incomplete` / `env_missing` / mismatch). Below is the **dev/testnet** form — for production change only `c.exchange_environment = 'mainnet'`:
```sql
UPDATE public.bots b
SET trading_enabled = true
FROM public.user_exchange_credentials c
WHERE b.id = '<bot-uuid>'
  AND c.id = b.credential_id
  AND c.exchange_environment = 'testnet'      -- 'mainnet' for a production worker
  AND b.sizing_mode IN ('percent_of_balance', 'fixed_notional')
  AND (
    (b.sizing_mode = 'percent_of_balance' AND b.position_size_pct   IS NOT NULL)
    OR
    (b.sizing_mode = 'fixed_notional'     AND b.fixed_notional_usdt IS NOT NULL)
  )
  AND b.max_order_notional_usdt IS NOT NULL
  AND b.daily_notional_cap_usdt IS NOT NULL
  AND b.sell_enabled = false
RETURNING b.id, b.trading_enabled, b.sizing_mode, c.exchange_environment;
```
PASS (at arm time) = one row returned with `trading_enabled = true`. Zero rows = the bot is not fully configured for its mode, or the credential environment is missing/mismatched → fix §6a first (the guard intentionally enables nothing in that case). Even after this, no order flows until the queue is re-enabled (§7).

---

## 7. Deploy ordering + arm gate
- The merged worker (`fdae77b`) **SELECTs the new columns** in `processMessage`. Boot reconciliation does **not** touch them, so the worker boots cleanly even before 014 is applied.
- With `QUEUE_ENABLED=false`, `processMessage` is never invoked, so a "column does not exist" error cannot occur in practice pre-apply. **Still: apply 014 (and configure bots) BEFORE re-enabling the queue.**
- **Applying 014 ≠ arming.** Arming = the per-bot enable (§6b, `trading_enabled = true`) **and** re-enabling the queue so signals are processed. Both are gated on Oren's approval (Governance v1.0), and only after: 014 applied (§5 PASS), target bots configured + readiness-confirmed with the kill switch still off (§6a), `exchange_environment` matching the worker, and a controlled first-fire plan. Until then the system stays fail-closed.

---

## 8. "Schema applied + configured" criteria (distinct from armed)
This work item is **schema-applied + config-ready** (NOT armed) when **all** hold:
1. `014` applied surgically in a transaction (Path A), written exception logged like `010`–`013`.
2. §5 verification all PASS (E2) — recorded.
3. Each target bot configured + readiness-confirmed (§6a, E2); the kill switch deliberately **remains `trading_enabled = false`** for config-ready — it is set `true` only in the separate §6b arm-time enable (config-ready never includes enabling).
4. `QUEUE_ENABLED=false` still in effect; no signal processed.
Arming is tracked separately and requires Oren's approval (§7).

---

## 9. Stop conditions (abort immediately, leave DB untouched)
- Any attempt to **apply without explicit approval** at the moment of running.
- Any `supabase db push` **without** the history pre-check (§1) and an approved reconcile (§2/§4) — a push here would also re-run `010`–`013`.
- `db push` attempting to run any **unexpected/older migration**.
- The apply run **outside** a single `BEGIN … COMMIT` (loses atomic rollback on partial failure).
- Any change touching **Migration 009** (frozen).
- Any §5 verification anomaly: a column missing, wrong nullability/default, or a missing CHECK constraint.
- Re-enabling the queue / arming as part of this apply (it is explicitly out of scope — §7).
- Any DB/Doppler/Railway change beyond the scoped 014 apply + the bot/credential config in §6.

---

## 10. Rollback / cleanup
`014` is additive (11 columns across 3 tables). To fully undo (privileged session, explicit approval, one transaction):
```sql
BEGIN;
ALTER TABLE public.user_exchange_credentials DROP COLUMN IF EXISTS exchange_environment;
ALTER TABLE public.trades
  DROP COLUMN IF EXISTS requested_notional_usdt,
  DROP COLUMN IF EXISTS executed_notional_usdt;
ALTER TABLE public.bots
  DROP COLUMN IF EXISTS sizing_mode,
  DROP COLUMN IF EXISTS position_size_pct,
  DROP COLUMN IF EXISTS fixed_notional_usdt,
  DROP COLUMN IF EXISTS max_order_notional_usdt,
  DROP COLUMN IF EXISTS daily_notional_cap_usdt,
  DROP COLUMN IF EXISTS trading_enabled,
  DROP COLUMN IF EXISTS sell_enabled,
  DROP COLUMN IF EXISTS sell_size_pct;
COMMIT;
```
Notes:
- `DROP COLUMN` cascades the column's CHECK constraints automatically.
- Rollback is only needed if apply or verification fails. On success there is no cleanup — the columns are the deliverable. Once the worker is armed against these columns, a rollback would re-break the worker's `processMessage` select; treat post-arm rollback as an incident, not routine cleanup.
