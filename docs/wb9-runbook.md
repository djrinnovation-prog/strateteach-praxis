# WB9 Runbook — End-to-end dev proof (single controlled fire)

**Status:** PREP ONLY (no execution, no arm/fire yet).
**Goal:** one clean, hop-by-hop E2E observation of the full pipeline in dev/testnet:
**webhook simulator → Supabase Edge (auth + logging) → pgmq → Railway worker consume →
Binance Testnet fill → trades row → audit chain → queue ack → DLQ/recon clean.**
Canon: Sprint 3 Plan WB9 ("E1: full webhook→queue→worker→testnet→trades+audit_logs observed
end-to-end"). Closes on E1/E2.

**Relationship to prior work:** WB6 already proved the path from Railway (real fill
`d04f0c06`); WB7 fired 20 through it. WB9 is the **dedicated single-observation E2E proof**
with evidence captured at *every* hop. Canon does not require a count → **one fire** is
sufficient and lowest-risk.

**This run places ONE real Binance Testnet order. Operator-authorized, arm/fire gated.**
`scripts/wb6-e1-fire.sh` is the **TradingView webhook simulator** — it proves the Edge+queue
ingress, **not** live TradingView connectivity (see Caveats).

---

## 0. RUN_ID / signal_id convention
```bash
RUN_ID="WB9R-$(date +%Y%m%d-%H%M)-railway"; echo "$RUN_ID"   # e.g. WB9R-20260617-1530-railway
SIGNAL_ID="${RUN_ID}-buy"                                     # single fire
BOT=2dcaddba-b62d-47e1-87a7-7f7b759f38d2
```
Substitute the literal `<RUN_ID>` into every SQL below. Fresh per run (UNIQUE(bot_id, signal_id)).

## 1. Pre-run baseline (read-only; required clean state)
```sql
-- RUN_ID namespace empty
SELECT count(*) AS wl_pre FROM webhook_logs WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS tr_pre FROM trades       WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
-- fill-readiness (confirmed 2026-06-17: active / BTCUSDT / credential 2b5c038a valid / vault pointer present)
SELECT b.status AS bot_status, b.credential_id, c.status AS cred_status, c.deleted_at
FROM bots b LEFT JOIN user_exchange_credentials c ON c.id=b.credential_id
WHERE b.id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- queue empty + no global stuck (so this fire is the only thing processed)
SELECT queue_length FROM pgmq.metrics('trade_signals');
SELECT count(*) AS global_stuck FROM trades WHERE status IN ('pending','unknown') AND deleted_at IS NULL;
```
Required: `wl_pre=0`, `tr_pre=0`, `bot_status=active`, `cred_status=valid` & `deleted_at=null`,
`queue_length=0`, `global_stuck=0`.

## 2. Pre-arm safety gates (REQUIRED — do NOT arm if any fail)
From the latest Railway `worker_starting` line (+ the idle log that follows):
- `queue_enabled:false` (currently) **and** `worker_queue_disabled` present
- **`is_production:false`** (testnet enforced server-side — hard gate)
- `doppler_environment:dev`
- `boot_reconciliation_complete stuck_count:0`
- Operator authorization for one real testnet fill.
If `is_production:true` → **ABORT** (never fire against production here).

## 3. Arm + redeploy verification (operator-only)
Doppler (config `dev`): set `QUEUE_ENABLED=true` → redeploy/restart Railway.
Confirm on the armed boot, in order:
- `worker_starting queue_enabled:true`, `is_production:false`, `doppler_environment:dev`
- `boot_reconciliation_complete stuck_count:0`
- `queue_preflight_ok`
- `worker_running`
**Do NOT fire until `queue_enabled:true` + `queue_preflight_ok` confirmed.**

## 4. Single controlled fire
```bash
scripts/wb6-e1-fire.sh "${RUN_ID}-buy"
```
Expect HTTP 200 + `{"ok":true}`. Hidden token prompt; do not cache to env. **Fire exactly once.**

## 5. Expected logs (hop-by-hop)
**Edge (fn:webhook):**
- `webhook_accepted {bot_id, signal_id, side:"buy"}` — auth passed, `webhook_logs` row written, enqueued.

**Worker:**
- `message_received {msg_id, read_ct:1, side:"buy"}`
- `trade_pending {trade_id, side:"buy", quantity, trading_pair:"BTCUSDT"}`
- (audit) `trade.created`
- (fill) `trade.filled` audit + trades update `status:filled, exchange_order_id, filled_at`
- `message_processed {ack:true, read_ct:1, processing_duration_ms}`
- `message_acked {msg_id}`

No `webhook_reject` / `webhook_queue_failed` / `duplicate_signal*` / `*_error` / `reconciliation_job_*`.

## 6. Post-run verification (read-only; hop-by-hop, by exact RUN_ID)
```sql
-- a) Edge hop: exactly one accepted ingress, none rejected/queue_failed
SELECT status, count(*) FROM webhook_logs
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' GROUP BY status;
-- b) Worker/exchange hop: exactly one trade, filled, with a real exchange order
SELECT signal_id, status, exchange_order_id, quantity, filled_at FROM trades
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS trades, count(DISTINCT exchange_order_id) AS distinct_exch
FROM trades WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
-- c) Audit chain: trade.created → trade.filled for that trade
SELECT a.event_type, a.actor_type, a.created_at
FROM audit_logs a JOIN trades t ON t.id = a.entity_id AND a.entity_type = 'trade'
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%'
ORDER BY a.created_at;
-- d) Ack + clean tail
SELECT queue_length FROM pgmq.metrics('trade_signals');
SELECT count(*) AS dlq FROM trades_dlq
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS recon FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
```
**PASS (all):**
- (a) `accepted=1`, no `rejected`/`queue_failed`.
- (b) exactly **1 trade**, `status=filled`, non-null `exchange_order_id`, `filled_at` set; `trades=1=distinct_exch`.
- (c) audit `event_type` shows `trade.created` then `trade.filled`, `actor_type=worker`.
- (d) `queue_length=0`, `dlq=0`, `recon=0`.

## 7. Disarm (MANDATORY at end and on any stop condition — operator-only)
Doppler (`dev`): set `QUEUE_ENABLED=false` → redeploy/restart Railway.
Confirm: `worker_starting queue_enabled:false` → `worker_queue_disabled`; `queue_length=0`.
**Never leave WB9 armed.**

## 8. Cleanup / rollback
- **No DB cleanup of the WB9 trade.** The fill is a **real testnet order and the proof
  artifact** — retained as evidence (same as WB6/WB7 fills). Do NOT delete the trades /
  webhook_logs / audit rows.
- **Rollback (if a stop condition fires mid-run):** disarm immediately (§7); the queue
  message either acked (resolved) or remains unacked and re-appears after the visibility
  timeout — assess with §6 before any re-fire. Do not delete real trade rows.
- If a trade lands `unknown` → a `reconciliation_job` is the correct handoff (WB8 path);
  leave it for triage, do not hand-delete.

## 9. Stop conditions (any one → STOP, disarm §7, preserve logs + §6 outputs, escalate)
- `is_production:true` or `queue_enabled` not as expected.
- `webhook_reject` / `webhook_queue_failed` / non-200 from the fire.
- More than one trade for the RUN_ID, or `trades > distinct_exch` (duplicate order).
- Trade `unknown`/`failed`, or any `reconciliation_job`/DLQ row for the RUN_ID.
- `message_processed` with `read_ct > 1`, or `processing_duration_ms ≥ 30000` (≥ VT).
- Queue not draining (`queue_length` stays > 0), or any `*_error` event.
- `ExchangeUnavailable` / HTTP 451 (egress regressed).

## 10. Caveats (explicit)
- **Not real TradingView connectivity.** `scripts/wb6-e1-fire.sh` simulates the TradingView
  webhook POST; it proves Edge auth + ingestion + the downstream pipeline, **not** a live
  TradingView alert integration (separate, out-of-scope step).
- **Testnet only**, single fire — not the 50-trade production gate (separate campaign).
- Inherits carried-forward items: WB7 true 5-bot load; WB8 `fetchOrder` resolution; runtime
  `setInterval(60s)` scan — none required for WB9.
- **Migration 009 frozen.** Production-grade egress remains a LIVE blocker (Register `380d6df6`).

---
**Gated:** no execution, no arm/fire, no Doppler/Railway change, DB read-only only, canon
untouched, Migration 009 frozen. After the run: hand back the Edge+worker logs + §6 outputs
→ agent verifies PASS/FAIL and drafts the WB9 closure for review.
