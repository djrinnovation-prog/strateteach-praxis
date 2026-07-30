# WB9 Execution Checklist — E2E dev proof (single controlled fire)

Fast runsheet. Rationale + pass/fail live in [wb9-runbook.md](wb9-runbook.md).

- Proves end-to-end: **webhook simulator → Edge (auth+log) → pgmq → Railway worker → Binance
  Testnet fill → trades → audit chain → ack → DLQ/recon clean.**
- **One real testnet order.** Arm/fire is operator-gated. `scripts/wb6-e1-fire.sh` is the
  **TradingView webhook simulator** — NOT live TradingView.
- Bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` (active, BTCUSDT, credential `2b5c038a` valid).

---

## 0. Set RUN_ID (once)
```bash
RUN_ID="WB9R-$(date +%Y%m%d-%H%M)-railway"; echo "$RUN_ID"   # e.g. WB9R-20260617-1530-railway
```
Substitute the literal RUN_ID into every `<RUN_ID>` below. signal_id = `${RUN_ID}-buy`.

## 1. Pre-run baseline (read-only)
```sql
SELECT count(*) AS wl_pre FROM webhook_logs WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS tr_pre FROM trades       WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT b.status AS bot_status, b.credential_id, c.status AS cred_status, c.deleted_at
  FROM bots b LEFT JOIN user_exchange_credentials c ON c.id=b.credential_id
  WHERE b.id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
SELECT queue_length FROM pgmq.metrics('trade_signals');
SELECT count(*) AS global_stuck FROM trades WHERE status IN ('pending','unknown') AND deleted_at IS NULL;
```
Required: `wl_pre=0`, `tr_pre=0`, `bot_status=active`, `cred_status=valid` & `deleted_at=null`,
`queue_length=0`, `global_stuck=0`.

## 2. Pre-arm Railway safety gate (REQUIRED — no arm if any fail)
Latest `worker_starting` line (+ the idle log after):
- `queue_enabled:false` **and** `worker_queue_disabled` present
- **`is_production:false`** (hard gate — ABORT if true)
- `doppler_environment:dev`
- `boot_reconciliation_complete stuck_count:0`
- Operator authorization for one real testnet fill.

## 3. Arm + redeploy verification (operator-only)
Doppler (`dev`): set `QUEUE_ENABLED=true` → redeploy/restart Railway. Confirm, in order:
- `worker_starting queue_enabled:true`, `is_production:false`, `doppler_environment:dev`
- `boot_reconciliation_complete stuck_count:0`
- `queue_preflight_ok`
- `worker_running`

**Do NOT fire until `queue_enabled:true` + `queue_preflight_ok` confirmed.**

## 4. Single fire (exactly once)
```bash
[ -n "$RUN_ID" ] || { echo "RUN_ID unset — aborting"; exit 1; }
echo "$RUN_ID"
scripts/wb6-e1-fire.sh "${RUN_ID}-buy"
```
Expect HTTP 200 + `{"ok":true}`. Hidden token prompt; do not cache to env.

## 5. Expected logs (hop-by-hop)
**Edge (fn:webhook):** `webhook_accepted {bot_id, signal_id, side:"buy"}` (auth ok, webhook_logs written, enqueued).
**Worker:**
- `message_received {msg_id, read_ct:1, side:"buy"}`
- `trade_pending {trade_id, side:"buy", quantity, trading_pair:"BTCUSDT"}`
- (audit) `trade.created` → (fill) `trade.filled` + trades update `status:filled, exchange_order_id, filled_at`
- `message_processed {ack:true, read_ct:1, processing_duration_ms}`
- `message_acked {msg_id}`

None of: `webhook_reject` / `webhook_queue_failed` / `duplicate_signal*` / `*_error` / `reconciliation_job_*`.

## 6. Post-run verification (read-only; hop-by-hop, exact RUN_ID)
```sql
-- a) Edge: one accepted, none rejected/queue_failed
SELECT status, count(*) FROM webhook_logs
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' GROUP BY status;
-- b) one trade, filled, real exchange order; no duplicate
SELECT signal_id, status, exchange_order_id, quantity, filled_at FROM trades
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS trades, count(DISTINCT exchange_order_id) AS distinct_exch
FROM trades WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
-- c) audit chain trade.created → trade.filled
SELECT a.event_type, a.actor_type, a.created_at
FROM audit_logs a JOIN trades t ON t.id=a.entity_id AND a.entity_type='trade'
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%' ORDER BY a.created_at;
-- d) ack + clean tail
SELECT queue_length FROM pgmq.metrics('trade_signals');
SELECT count(*) AS dlq FROM trades_dlq
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS recon FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
```
PASS (all): (a) `accepted=1`, no rejected/queue_failed; (b) 1 trade `filled`, non-null
`exchange_order_id`, `filled_at` set, `trades=1=distinct_exch`; (c) `trade.created` then
`trade.filled`, `actor_type=worker`; (d) `queue_length=0`, `dlq=0`, `recon=0`.

## 7. Disarm (MANDATORY at end and on any stop condition — operator-only)
Doppler (`dev`): set `QUEUE_ENABLED=false` → redeploy/restart Railway.
Confirm: `worker_starting queue_enabled:false` → `worker_queue_disabled`; `queue_length=0`.
**Never leave WB9 armed.**

## 8. Stop conditions (any one → STOP, disarm §7, preserve logs + §6 outputs, escalate)
- `is_production:true`, or `queue_enabled` not as expected.
- `webhook_reject` / `webhook_queue_failed` / non-200 from the fire.
- More than one trade for the RUN_ID, or `trades > distinct_exch` (duplicate order).
- Trade `unknown`/`failed`, or any `reconciliation_job`/DLQ row for the RUN_ID.
- `message_processed` `read_ct > 1`, or `processing_duration_ms ≥ 30000` (≥ VT).
- Queue not draining, or any `*_error` event.
- `ExchangeUnavailable` / HTTP 451 (egress regressed).

## 9. Caveats
- **Webhook simulator, NOT real TradingView connectivity** — proves Edge + pipeline only; a
  live TradingView alert integration is a separate, out-of-scope step.
- **Testnet only**, single fire — not live/mainnet, not the 50-trade production gate.
- **No DB cleanup of the WB9 trade** — it's a real testnet order and the proof artifact;
  retained as evidence (like WB6/WB7). Do not delete trades/webhook_logs/audit rows. Only
  teardown is disarm.
- **Migration 009 frozen.**

---
**Gated:** no execution, no arm/fire, no Doppler/Railway change, DB read-only only, canon
untouched, Migration 009 frozen. After the run: hand back Edge+worker logs + §6 outputs →
agent verifies PASS/FAIL and drafts the WB9 closure for review.
