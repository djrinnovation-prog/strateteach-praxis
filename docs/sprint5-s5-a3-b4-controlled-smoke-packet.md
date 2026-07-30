# S5-A3/B4 — Controlled Enable + Smoke Packet (first live sizing/risk order)

**Status:** DESIGN / DOC ONLY. Nothing here has been executed.
**⚠️ THIS IS ARMING.** It enables one bot, opens the queue, and places **one real testnet order**
through the new sizing/risk path. **Explicit Oren approval is REQUIRED before ANY step below.**
Until then this is a plan, not an action.

**Smallest blast radius by design:** ONE bot, ONE signal, a narrow armed window, **immediate disarm
regardless of outcome**. Testnet only (`is_production=false`). The new code path is unchanged and
fail-closed; this packet only flips the two toggles (`bots.trading_enabled`, `QUEUE_ENABLED`)
briefly and reverts them.

**Two distinct toggles (both must be reverted at disarm):**
1. `bots.trading_enabled` — DB kill switch (§6b enable, per-bot).
2. `QUEUE_ENABLED` — worker queue (Doppler flag → Railway redeploy).

**RUN_ID:** `S5SMOKE-<YYYYMMDD-HHMM>` (UTC, operator-stamped, one per attempt). The fire's
`signal_id = ${RUN_ID}-BTCUSDT-01`; evidence is scoped by `signal_id LIKE '${RUN_ID}-%'` so prior
trades are never miscounted.

**Target bot (one only):** `BTCUSDT` = `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` (the existing
`scripts/wb6-e1-fire.sh` is already wired to it). Webhook base:
`https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook`.

**Expected order:** `fixed_notional_usdt=20` → `requested_notional_usdt=20`; `qty = roundDown(20 /
live_price, stepSize)`; at BTC ≈ $60k → ≈ 0.00033 BTC, notional ≈ $20 (clears minNotional ≈ $5–10,
under `max_order_notional_usdt=25`, under `daily_notional_cap_usdt=100`). One fill.

---

## Step 1 — Pre-arm verify (read-only, E2) — must ALL pass
```sql
-- (a) all 5 bots config-ready + kill switch OFF + env testnet
SELECT b.trading_pair, b.id, b.sizing_mode, b.fixed_notional_usdt, b.max_order_notional_usdt,
       b.daily_notional_cap_usdt, b.sell_enabled, b.trading_enabled, c.exchange_environment
FROM public.bots b JOIN public.user_exchange_credentials c ON c.id = b.credential_id
WHERE b.id IN ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df',
  '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
  '297dddb9-965b-49ff-abd8-e3e8e88fa4fc')
ORDER BY b.trading_pair;
-- expect 5 rows: fixed_notional=20, max=25, daily=100, sell=false, trading_enabled=FALSE, env=testnet.

-- (b) no in-flight work + clean queue/dlq/recon
SELECT
  (SELECT count(*) FROM public.trades WHERE status IN ('pending','submitted','unknown') AND deleted_at IS NULL) AS open_trades,
  (SELECT count(*) FROM public.trades_dlq) AS dlq,
  (SELECT count(*) FROM public.reconciliation_jobs WHERE status = 'pending') AS open_recon,
  (SELECT public.pgmq_queue_length('trade_signals')) AS queue_length;
-- expect 0 / 0 / 0 / 0.
```
Also confirm **`QUEUE_ENABLED=false`** explicitly (Doppler is source of record — non-secret flag):
```bash
doppler secrets get QUEUE_ENABLED --plain -p praxis-platform -c dev   # expect: false
```
and that the worker is in the disarmed state (last deploy logged `worker_queue_disabled`). **STOP**
if any check is off — do not arm on a dirty baseline.

---

## Step 2 — Enable ONE bot (§6b guarded UPDATE) — operator-executed, Oren-approved
Mode-specific + env-checked guard (refuses to enable a bot the worker would still block). Enables
**only** BTCUSDT; the other four stay `trading_enabled=false`.
```sql
UPDATE public.bots b
SET trading_enabled = true
FROM public.user_exchange_credentials c
WHERE b.id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  AND c.id = b.credential_id
  AND c.exchange_environment = 'testnet'
  AND b.sizing_mode = 'fixed_notional' AND b.fixed_notional_usdt IS NOT NULL
  AND b.max_order_notional_usdt IS NOT NULL
  AND b.daily_notional_cap_usdt IS NOT NULL
  AND b.sell_enabled = false
RETURNING b.id, b.trading_pair, b.trading_enabled;
```
**Must return exactly 1 row** with `trading_enabled=true`. Zero rows → the bot is not fully
configured → STOP. Then re-confirm the **other 4 are still false**:
```sql
SELECT count(*) AS still_enabled FROM public.bots WHERE trading_enabled = true;  -- expect 1
```

---

## Step 3 — Arm the queue (controlled window opens) — operator-executed
Set the worker queue flag on and redeploy (Doppler is source of record → Railway syncs):
- `QUEUE_ENABLED=true` in Doppler (non-secret flag) → trigger the Railway redeploy (or the
  established `scripts/wb6-e1-arm.sh`).
- **Confirm the new deploy boots armed + clean (E1):** `queue_enabled:true`, `is_production:false`,
  `boot_reconciliation_complete stuck_count:0`, `worker_running`.
- **If the arm deploy fails or cannot be confirmed:** the bot was already enabled in Step 2, so
  **immediately run the DB kill-switch disable (Step 6.2) BEFORE any investigation** — set
  `trading_enabled=false` on BTC and `QUEUE_ENABLED=false` if possible. Never leave a bot enabled
  while the queue state is unknown. Only then investigate.

The armed window is now open. Keep it as short as possible — fire immediately (Step 4), observe,
disarm (Step 6).

---

## Step 4 — Fire ONE signal — operator-executed
Use the hardened single-fire `scripts/wb6-e1-fire.sh` (webhook token read from a hidden prompt,
**never in argv/history/logs**; the operator holds the secret — it is never printed or pasted).
Fire **one** BUY with a fresh, unique `signal_id`:
- `signal_id = ${RUN_ID}-BTCUSDT-01` (e.g. `S5SMOKE-20260630-1200-BTCUSDT-01`).
- Exactly **one** POST. Do not repeat (a repeat `signal_id` is server-deduped → no second trade, but
  do not rely on it; one fire only).

---

## Step 5 — Observe (E1 logs + E2 DB) — one trade, expected happy path
**E1 (worker logs):** `message_received` → `trade_pending trade_id=… quantity=<≈0.00033> ` →
`trade_executed status=filled exchange_order_id=…` → `message_processed ack=true` → `message_acked`.
A misconfig instead surfaces as **`order_blocked reason=<…>`** (no order) — capture the reason.
```sql
-- E2: exactly one trade for this fire, sized + accounted from config
SELECT id, trading_pair, side, status, quantity,
       requested_notional_usdt, executed_notional_usdt, exchange_order_id, error_reason
FROM public.trades
WHERE signal_id = '${RUN_ID}-BTCUSDT-01' AND deleted_at IS NULL;
```
If the trade row is **absent**, the order was blocked — check the bot-scoped audit instead:
```sql
-- E2: blocked-path audit (only present if the order was blocked — no trade row exists)
SELECT entity_type, entity_id, event_type, after_state, created_at
FROM public.audit_logs
WHERE entity_type = 'bot'
  AND entity_id   = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  AND event_type  = 'order.blocked'
  AND after_state->>'signal_id' = '${RUN_ID}-BTCUSDT-01'
ORDER BY created_at DESC
LIMIT 1;
```

Two distinct outcomes — only the first is a smoke PASS:
- **SMOKE PASS (happy path):** 1 trade row, `side=buy`, `status=filled`, `requested_notional_usdt=20`,
  `executed_notional_usdt ≈ 20` (= order cost), `quantity = roundDown(20/price, stepSize)`,
  `exchange_order_id` set, `error_reason` null; audit chain `trade.created → trade.filled`. The live
  sizing/risk order is proven end-to-end.
- **SAFE STOP / BLOCKED OUTCOME (NOT a smoke PASS):** no trade row, **no** `createOrder`, a single
  `order.blocked` audit with a non-secret `reason`. This is the fail-closed path working correctly —
  but the smoke did **not** prove a live order. **Disarm (Step 6), then investigate the `reason`; do
  NOT re-fire or proceed as if the smoke passed.**
- **STOP / investigate (anomaly)** on anything else: >1 trade, wrong `requested_notional_usdt` (≠20),
  quantity not = `roundDown(20/price)`, a fill exceeding `max_order_notional_usdt`/`daily_notional_cap_usdt`,
  or any `createOrder` for a non-enabled bot.

---

## Step 6 — Immediate disarm (REGARDLESS of outcome) — operator-executed
Do this as soon as the one trade reaches a terminal state (or immediately on any STOP):
1. `QUEUE_ENABLED=false` in Doppler → Railway redeploy (or `scripts/wb6-e1-disarm.sh`). Confirm in
   Doppler (source of record) AND in the new deploy log:
   ```bash
   doppler secrets get QUEUE_ENABLED --plain -p praxis-platform -c dev   # expect: false
   ```
   plus `worker_queue_disabled` in the new deploy. Both must agree before considering the queue disarmed.
2. Kill switch back off:
   ```sql
   UPDATE public.bots SET trading_enabled = false
   WHERE id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
   RETURNING id, trading_enabled;
   ```
3. Confirm fully disarmed:
   ```sql
   SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled = true;  -- expect 0
   ```
Both toggles reverted → back to config-ready (NOT armed).

---

## Step 7 — Final evidence (E1/E2)
```sql
SELECT
  (SELECT count(*) FROM public.trades WHERE status IN ('pending','submitted','unknown') AND deleted_at IS NULL) AS open_trades,
  (SELECT count(*) FROM public.trades_dlq) AS dlq,
  (SELECT count(*) FROM public.reconciliation_jobs WHERE status = 'pending') AS open_recon,
  (SELECT count(*) FROM public.bots WHERE trading_enabled = true) AS enabled_bots,
  (SELECT public.pgmq_queue_length('trade_signals')) AS queue_length;
-- expect 0 / 0 / 0 / 0 / 0
```
The worker is disarmed (last deploy `worker_queue_disabled`). The one testnet fill is **retained as
evidence** (no cleanup), like prior campaigns. Record RUN_ID + outcomes; then log a DECISIONS.md
entry (live sizing/risk smoke PASS, re-disarmed) for review.

---

## Step 8 — STOP conditions (abort + disarm immediately)
**Any failure after Step 2 (the bot is enabled) MUST first disable the BTC bot
(`trading_enabled=false`, Step 6.2) and set `QUEUE_ENABLED=false` if possible — kill switch before
investigation. Never leave the bot enabled while diagnosing.** At ANY sign of these, jump straight to
Step 6 (disarm), then investigate:
- Pre-arm baseline dirty (Step 1 not all-pass) — do not arm at all.
- §6b enable returns 0 rows, or `still_enabled ≠ 1` (more than the one target bot enabled).
- Armed deploy logs any error, or boot reconciliation finds stuck trades.
- More than one trade created; any trade for a **non-enabled** bot; any `createOrder` for SELL.
- `requested_notional_usdt ≠ 20`, quantity not = `roundDown(20/price, stepSize)`, or a fill that
  exceeds `max_order_notional_usdt`/`daily_notional_cap_usdt`.
- Any secret printed/pasted (token, DSN, key) — never; the fire token stays in the hidden prompt only.
- Inability to disarm cleanly → treat as an incident (S5-A6 runbook); escalate to Oren.

---

## Step 9 — What this packet is NOT
- Not a campaign (that was S4-2). One bot, one signal.
- Not a config change (bots stay `fixed_notional` 20/25/100; only `trading_enabled` toggles, reverted).
- Not SELL (sell off; SELL is fail-closed in Step 4b).
- Not a standing armed state — the window is opened and closed within this packet. Any ongoing
  arming (multiple bots, scheduled fires, mainnet) is a separate, separately-approved decision.
