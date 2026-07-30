# S5-A3/B4 — Operator Execution Packet (apply 014 + config-ready)

**Status:** DESIGN / DOC ONLY. Nothing here has been executed.
**Goal:** take the five dev/testnet bots to **config-ready** — migration 014 applied + sizing/risk
config set — with the **kill switch off**. This packet stops at config-ready; it does **NOT** enable
any bot and does **NOT** arm. The full rationale lives in
`docs/sprint5-s5-a3-b4-migration-014-apply-runbook.md` and `docs/sprint5-s5-a3-b4-bot-config-packet.md`;
this is the ordered, copy-paste sequence with the **approved values baked in**.

**Approved decisions (2026-06-30):** `sizing_mode=fixed_notional`, `fixed_notional_usdt=20`,
`max_order_notional_usdt=25`, `daily_notional_cap_usdt=100`, **uniform across all 5 bots**,
`sell_enabled=false`, `trading_enabled=false` (config-ready). Credential env = `testnet`.

**Standing gates:** agent runs no DB mutation; every step is operator-executed on explicit approval.
**Migration 009 frozen. No `db push`. No §6b enable. No arm. `QUEUE_ENABLED` stays false throughout.**
Run the steps in order; a STOP at any step means do not proceed.

---

## Step 1 — Verify migration history (read-only, E2)
```bash
supabase migration list --linked
```
**Expected:** `001`–`008` Local = Remote · `009` no local file (frozen) · `010`–`013` Local **not** Remote
(surgical, untracked) · `014_bot_sizing_risk` Local **only**.
**STOP** if anything differs — especially do **not** continue toward any `db push` (it would re-run
`010`–`013`). Record the output (E2).

---

## Step 2 — Apply 014 atomically (operator approval: "apply 014 now")
Build a transaction-wrapped copy and apply **that** (never the raw file — it has no `BEGIN/COMMIT`):
```bash
{
  echo "BEGIN;"
  cat supabase/migrations/014_bot_sizing_risk.sql
  echo "COMMIT;"
} > /tmp/014_bot_sizing_risk.transaction.sql

supabase db query --linked --file /tmp/014_bot_sizing_risk.transaction.sql
rm -f /tmp/014_bot_sizing_risk.transaction.sql
```
**STOP** on any error: the transaction rolls back (schema untouched), fix the cause, retry. Then log
the written exception ("014 applied surgically via direct SQL, not in `supabase_migrations`") in
`DECISIONS.md` / Current Status, exactly as for `010`–`013`.

---

## Step 3 — Verify schema (E2)
```sql
-- (a) all 11 new columns present with intended type / nullability / default
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND (
     (table_name='bots' AND column_name IN ('sizing_mode','position_size_pct','fixed_notional_usdt',
        'max_order_notional_usdt','daily_notional_cap_usdt','trading_enabled','sell_enabled','sell_size_pct'))
  OR (table_name='trades' AND column_name IN ('requested_notional_usdt','executed_notional_usdt'))
  OR (table_name='user_exchange_credentials' AND column_name='exchange_environment'))
ORDER BY table_name, column_name;
-- expect 11 rows; trading_enabled/sell_enabled = boolean NOT NULL default true/false; rest nullable, no default.

-- (b) CHECK constraints (sizing_mode enum, env enum, positivity)
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid IN ('public.bots'::regclass,'public.trades'::regclass,'public.user_exchange_credentials'::regclass)
  AND contype='c'
  AND pg_get_constraintdef(oid) ~* 'sizing_mode|notional|position_size_pct|sell_size_pct|exchange_environment'
ORDER BY conname;
-- expect: sizing_mode IN (percent_of_balance,fixed_notional); exchange_environment IN (testnet,mainnet); the >0 / >=0 checks.

-- (c) fail-closed confirmation: every bot is unconfigured immediately after apply
SELECT count(*) AS total_bots, count(*) FILTER (WHERE sizing_mode IS NULL) AS unconfigured FROM public.bots;
-- expect unconfigured = total_bots.
```
**STOP** if any column is missing / wrong nullability / missing CHECK. Record (E2).

---

## Step 4 — Apply config (env once + 5-bot batch; trading_enabled stays false)
**4a. Credential environment (once — all 5 bots share credential `2b5c038a`):**
```sql
UPDATE public.user_exchange_credentials
SET exchange_environment = 'testnet'
WHERE id = '2b5c038a-a4a7-4be5-b2fe-90d32f67781b'
RETURNING id, exchange_environment;
```
Expect 1 row, `exchange_environment='testnet'`.

**4b. All 5 bots in one statement (identical approved values; kill switch OFF):**
```sql
UPDATE public.bots SET
  sizing_mode             = 'fixed_notional',
  fixed_notional_usdt     = 20,
  position_size_pct       = NULL,
  max_order_notional_usdt = 25,
  daily_notional_cap_usdt = 100,
  sell_enabled            = false,
  trading_enabled         = false
WHERE id IN (
  '2dcaddba-b62d-47e1-87a7-7f7b759f38d2',   -- BTCUSDT
  'c8913354-8b7e-4d8d-8b3d-fb8b8f8248df',   -- ETHUSDT
  '36b46eb3-9384-4e05-a79b-1246e9b85119',   -- BNBUSDT
  '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',   -- SOLUSDT
  '297dddb9-965b-49ff-abd8-e3e8e88fa4fc'    -- XRPUSDT
)
RETURNING id, trading_pair, sizing_mode, fixed_notional_usdt,
          max_order_notional_usdt, daily_notional_cap_usdt, sell_enabled, trading_enabled;
```
**`RETURNING` must return exactly 5 rows.** Anything else = a bot_id didn't match → **STOP**, reconcile
against Step 5(b) before proceeding. Capture the 5 rows (E2).

---

## Step 5 — Verify config-ready (E2)
```sql
SELECT b.trading_pair, b.id, b.sizing_mode, b.fixed_notional_usdt,
       b.max_order_notional_usdt, b.daily_notional_cap_usdt,
       b.sell_enabled, b.trading_enabled, c.exchange_environment
FROM public.bots b
JOIN public.user_exchange_credentials c ON c.id = b.credential_id
WHERE b.id IN (
  '2dcaddba-b62d-47e1-87a7-7f7b759f38d2','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df',
  '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
  '297dddb9-965b-49ff-abd8-e3e8e88fa4fc')
ORDER BY b.trading_pair;
```
**PASS = 5 rows, each:** `sizing_mode=fixed_notional`, `fixed_notional_usdt=20`,
`max_order_notional_usdt=25`, `daily_notional_cap_usdt=100`, `sell_enabled=false`,
**`trading_enabled=false`**, `exchange_environment=testnet`. This is **config-ready** — the worker
would now size a BUY correctly but the kill switch keeps every bot blocked (`trading_disabled`).

---

## Step 6 — Confirm QUEUE_ENABLED=false (no arm)
`QUEUE_ENABLED` is a non-secret feature flag (Doppler is source of record). Confirm it is **false** so
no signal is processed even though bots are config-ready:
```bash
doppler secrets get QUEUE_ENABLED --plain    # expect: false  (flag, not a secret)
```
**STOP / escalate** if it is anything but `false` — that would mean the system is (or is about to be)
processing signals; this packet must end at config-ready, not armed.

---

## Done = config-ready (NOT armed)
On completion: 014 applied (Step 2, exception logged), schema verified (Step 3), 5 bots configured with
the kill switch off (Steps 4–5), `QUEUE_ENABLED=false` (Step 6). Record outcomes in `DECISIONS.md` /
Current Status / Kanban.

**Explicitly NOT done here (separate, Oren-approved arm step):**
- §6b per-bot enable (`trading_enabled=true`, mode-specific + env-checked guard — see apply runbook §6b).
- Re-enabling the queue (`QUEUE_ENABLED=true`) + a controlled first-fire plan.

Until both happen, the system stays fail-closed.
