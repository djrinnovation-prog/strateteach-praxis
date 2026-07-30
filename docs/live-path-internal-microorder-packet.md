# LIVE-PATH — internal one-shot micro-order (real funds) — PACKET ONLY

Prove the **real order path today** by inserting ONE signal directly into the queue (bypassing
TradingView/webhook auth) and letting the **existing worker → queue → risk-caps → Binance mainnet →
audit** path execute exactly one tiny BUY. **NOTHING here is executed until each step is separately
approved.** This is the real-funds GO packet.

Target bot: `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` · user `66e1b075` · BTCUSDT · mainnet cred `1164c49b`.

---

## 0. Gravity + boundary (read first)
- This places a **real ~$12 BTCUSDT market BUY on Binance mainnet.** Withdrawals are OFF on the key, so
  funds cannot leave — but this is real money and a real fill.
- **Residual position:** after the BUY fills you hold ~$12 of BTC. `sell_enabled=false` (SELL is fail-closed
  in v1), so the worker will NOT close it — closing is a **manual Binance action** by the operator.
- **Claude cannot perform the order-causing steps.** Executing a financial trade (buying crypto) is off-limits
  for me even with your authorization. So the **bot-arm** and the **queue insert** (the steps that cause the
  buy) must be **run by you**; I provide exact commands, run **read-only monitoring**, and can run the
  **protective disarm** (pause/kill). Env flips + redeploy are yours on Railway regardless (no CLI in my shell).

## 1. How the internal path works (no webhook/token)
The webhook Edge fn normally does: validate token → `webhook_logs` dedup → `pgmq_send('trade_signals', msg)`.
The worker is **blind to the webhook** — it only reads the pgmq message and the bot row. So we skip the webhook
entirely and enqueue the **identical message shape** ourselves via the service-role RPC:

```
public.pgmq_send('trade_signals', { "schema_version":"1.0", "bot_id":..., "signal_id":..., "side":"buy" })
```
Worker path (worker/src/index.ts), per message:
1. **Step 0** `schema_version` must equal `'1.0'` (else discard).
2. Bot lookup; **`status` must be `'active'`**.
3. **Step 4b fail-closed gates:** SELL blocked (buy only) · `assertTradingEnabled` (kill switch) ·
   `assertExchangeEnvironment(isProduction, cred.env)` (prod worker ↔ mainnet cred must match) ·
   `productionEgressOk` (native egress) · `isBotConfigReady` (sizing/caps present).
4. **`insert_pending_trade_atomic`** (migration 029) reserves under advisory lock: `12 ≤ max_order 13` and
   `sum_today(0)+12 ≤ daily_cap 13` → reserved. `UNIQUE(bot_id,signal_id)` → duplicate signal rejected.
5. **Step 4A** (live + `AUDIT_FAIL_CLOSED_ENABLED`): never place an order without a durable `trade.created`
   audit row.
6. `BinanceAdapter(isProduction=true, proxy=unset, nativeAllowed=true)` places the real BUY → reconcile → fill.

## 2. PRE checks (read-only) — current state captured 2026-07-15
| Check | Current | Required |
|---|---|---|
| bot.status / trading_enabled | `paused` / `false` | arm to `active` / `true` (last) |
| bot credential | `1164c49b` mainnet **valid** | ✓ |
| caps (fixed/max/daily) | `12 / 13 / 13`, `sizing=fixed_notional`, `sell=false` | ✓ (one ~$12 order, 2nd → cap reject) |
| trades today | none (cap sum = 0) | ✓ |
| queue depth | `queue_length=0` (lifetime 88) | **0 before arming** |
| worker | `is_production=false, queue_enabled=false, state=disabled` | flip in §3 |
| **other active bots** | **4** ⚠️ | pause them, or verify testnet cred (fail-closed on prod worker) |
| **stale webhook_logs** | **40 `accepted`** ⚠️ | **sweeper OFF** entire test |

Re-run PRE immediately before arming (single JSON):
```sql
select json_build_object(
  'bot',(select row_to_json(x) from (select status,trading_enabled,credential_id,trading_pair,sizing_mode,fixed_notional_usdt,max_order_notional_usdt,daily_notional_cap_usdt,sell_enabled from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2') x),
  'cred',(select row_to_json(x) from (select status,exchange_environment from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082') x),
  'other_active_bots',(select count(*) from public.bots where status='active' and id<>'2dcaddba-b62d-47e1-87a7-7f7b759f38d2'),
  'worker',(select row_to_json(x) from (select is_production,queue_enabled,worker_state from public.worker_status order by updated_at desc limit 1) x),
  'queue',(select row_to_json(x) from (select queue_length,total_messages from pgmq.metrics('trade_signals')) x)
) as pre;
```
ABORT if: queue_length≠0, cred not valid/mainnet, caps not 12/13/13, or the sweeper flag is ON.

## 3. Arming steps (exact, ordered — minimize the live window)
**A. Safety pre-arm (approved).** Pause the 4 other active bots so the blast radius is exactly one order
(record their ids first to restore later):
```sql
-- capture, then pause (owner-scoped, protective):
select id,user_id,status,credential_id from public.bots where status='active' and id<>'2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
update public.bots set status='paused' where status='active' and id<>'2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
```
Confirm the 4C sweeper flag is **OFF** (`WEBHOOK_REQUEUE_SWEEPER*` unset/false on the worker).

**B. Worker tier flip (OPERATOR, Railway — causes redeploy).** Set on service `praxis-platform`:
`PRAXIS_IS_PRODUCTION=true`, `AUDIT_FAIL_CLOSED_ENABLED=true`, `QUEUE_ENABLED=true`. Keep
`EXCHANGE_EGRESS_MODE=native`, `EXCHANGE_HTTPS_PROXY` unset. Redeploy at `4e0d4e1`; wait Success/Active.

**C. Verify worker booted armed (read-only, Claude).** Railway `startup_env` shows
`is_production:true, queue_enabled:true, exchange_egress_mode:"native"`; pgmq_read preflight ok; no
`exchange_egress_unconfigured`. Bot still `paused` + queue empty ⇒ nothing trades yet.

**D. Arm the bot (OPERATOR runs — this is a real-trade enabling step).** Owner+state-guarded:
```sql
update public.bots set status='active', trading_enabled=true
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' and user_id='66e1b075-930e-4a20-9289-ca8668699eea'
  and status='paused' and trading_enabled=false and credential_id='1164c49b-bf7a-4593-802f-920d76669082'
returning id,status,trading_enabled;   -- expect exactly 1 row
```
Queue is still empty ⇒ still nothing until §4.

## 4. The one-shot insert (OPERATOR runs — this fires the real order)
Use a **unique** signal_id. This single row causes the buy:
```sql
select public.pgmq_send(
  'trade_signals',
  jsonb_build_object('schema_version','1.0',
    'bot_id','2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
    'signal_id','INTERNAL-TINYLIVE-2026-07-15-01',   -- must be unique per attempt
    'side','buy')
) as msg_id;   -- returns the new pgmq msg_id
```
The armed worker polls within ~1s (`POLL_INTERVAL_MS=1000`) → reserves → audits → places ~$12 BUY → fills.

## 5. Monitoring (read-only, Claude) — watch until fill or fail
```sql
select id,status,side,requested_notional_usdt,executed_notional_usdt,quantity,client_order_id,exchange_order_id,
       created_at,updated_at
from public.trades where bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' order by created_at desc limit 3;

select event_type,created_at,after_state
from public.audit_logs where entity_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' order by created_at desc limit 20;

select queue_length from pgmq.metrics('trade_signals');   -- returns to 0 after ack
```
Expect trade `pending → accepted → filled`; audits `trade.created`, order placed/filled; queue back to 0.
Railway worker log: message read, reservation ok, order placed, fill, ack/delete. **STOP-LOSS triggers** →
go to §6 immediately: any `error`/`failed` trade, an unexpected 2nd order, egress/auth error, or > ~$13 notional.

## 6. Immediate disarm (protective — run the instant the first order fills OR fails)
**D1. Kill the bot (Claude may run — protective):**
```sql
update public.bots set trading_enabled=false, status='paused'
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' returning id,status,trading_enabled;
```
**D2. Drain the queue** (should already be 0; delete any straggler so nothing re-processes):
```sql
select queue_length from pgmq.metrics('trade_signals');
-- if >0: read+delete each: select msg_id from pgmq.read('trade_signals',1,10);  then select pgmq_delete('trade_signals', <msg_id>);
```
**D3. De-arm the worker (OPERATOR, Railway):** set `QUEUE_ENABLED=false`, `PRAXIS_IS_PRODUCTION=false`,
`AUDIT_FAIL_CLOSED_ENABLED=false`; redeploy → idle/testnet.
**D4. Restore** the 4 bots paused in §3A to `active` (only if that was their prior state).

## 7. Fail-closed behaviors this test exercises
- Forgot §3B tier flip (worker testnet) + mainnet cred → `assertExchangeEnvironment` **fails closed**, no order.
- Egress unset → `productionEgressOk=false` → **fail closed**, no order.
- Audit write fails (4A) → **no order placed** (never an order without a durable `trade.created`).
- A 2nd signal → `insert_pending_trade_atomic` returns `daily_notional_cap` → **rejected** (proves the cap).
- Re-fire same signal_id → `duplicate_signal` → **rejected** (proves idempotency).

## 8. Rollback / what-if
- Order rejected by Binance (minNotional/filter) → trade `failed`, fail-closed, no funds moved; read the reason,
  bump caps by equal delta only if it was `below_min_notional`, retry once.
- Worker error loop → §6 disarm; the message is either acked (permanent) or redelivered (bounded by pgmq VT);
  drain in D2.
- The ~$12 BTC position persists (SELL disabled) → close manually on Binance if desired.

## Boundaries
Packet only — nothing armed, no env changed, no bot activated, no signal enqueued, no order. The order-causing
steps (§3D arm, §4 insert) are **operator-executed**; Claude runs read-only monitoring and the protective
disarm. Real funds — each step needs separate explicit approval.
