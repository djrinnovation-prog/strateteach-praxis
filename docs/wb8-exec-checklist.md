# WB8 Execution Checklist — boot reconciliation exercised

Fast runsheet. Rationale + pass/fail live in [wb8-runbook.md](wb8-runbook.md).

- **No arm, no fire, no real orders** — boot reconciliation runs at boot regardless of
  `QUEUE_ENABLED`, so this runs with the **queue DISABLED**.
- The **seed** and **cleanup** are the only DB writes — both **gated, reversible,
  operator-approved** at execution time. Read-only checks otherwise.
- Bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2`, user `66e1b075-930e-4a20-9289-ca8668699eea`, `BTCUSDT`.

---

## 0. Set RUN_ID (once)
```bash
RUN_ID="WB8R-$(date +%Y%m%d-%H%M)"; echo "$RUN_ID"   # e.g. WB8R-20260617-1500
```
Substitute the literal RUN_ID into every `<RUN_ID>` below.

## 1. Pre-run baseline (read-only; gate)
```sql
-- GATE — matches runBootReconciliation's exact selector (status + 60s threshold + not-deleted):
SELECT count(*) AS global_stuck_eligible FROM trades
  WHERE status IN ('pending','unknown') AND created_at < now() - interval '60 seconds' AND deleted_at IS NULL;
-- Informational (all ages):
SELECT count(*) AS global_stuck_all FROM trades
  WHERE status IN ('pending','unknown') AND deleted_at IS NULL;
-- RUN_ID namespace empty:
SELECT count(*) AS trades_pre FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS recon_pre FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
  WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
```
Required: `global_stuck_eligible=0`, `trades_pre=0`, `recon_pre=0`.

## 2. Pre-seed Railway safety gate (REQUIRED — no seed if armed)
From the latest `worker_starting` line (+ the idle log that follows):
- `queue_enabled:false` **and** `worker_queue_disabled` present
- `is_production:false`
- `doppler_environment:dev`

If `queue_enabled:true` or `is_production:true` → **STOP, do not seed.**

## 3. Seed (GATED mutation — reversible; operator-approved)
```sql
INSERT INTO trades (bot_id, user_id, signal_id, client_order_id, side, trading_pair, quantity, status, created_at)
VALUES
 ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','66e1b075-930e-4a20-9289-ca8668699eea',
  '<RUN_ID>-pending','<RUN_ID>-PRX-pending','buy','BTCUSDT',0.00010,'pending', now() - interval '2 minutes'),
 ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','66e1b075-930e-4a20-9289-ca8668699eea',
  '<RUN_ID>-unknown','<RUN_ID>-PRX-unknown','buy','BTCUSDT',0.00010,'unknown', now() - interval '2 minutes');
```
Confirm (read-only): 2 rows for RUN_ID, statuses `pending`/`unknown`, `exchange_order_id` null,
`created_at` older than 60s, i.e. `created_at < now() - interval '60 seconds'`.

## 4. Restart worker (QUEUE_ENABLED stays false)
Confirm `QUEUE_ENABLED=false`, then restart/redeploy the Railway worker. **Do NOT arm.**

## 5. Expected logs (boot 1)
- `worker_starting` `queue_enabled:false`, `is_production:false`, `doppler_environment:dev`
- `boot_reconciliation_complete{stuck_count:2}`
- `reconciliation_job_created{trade_id,status:"pending"}` and `{…,status:"unknown"}` (one each)
- `worker_queue_disabled`

## 6. Post-run verification (read-only)
```sql
SELECT t.signal_id, t.status AS trade_status, rj.status AS job_status
FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%' ORDER BY t.signal_id;
SELECT count(*) AS recon_jobs FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
SELECT signal_id, status, exchange_order_id, filled_at FROM trades
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' ORDER BY signal_id;
SELECT count(*) AS dlq FROM trades_dlq
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
```
Expected: `recon_jobs=2`, both jobs `pending`; seeds still `pending`/`unknown`, `exchange_order_id`
null, `filled_at` null; `dlq=0`.

## 7. Idempotency check — restart worker a SECOND time (queue still disabled)
Then re-run the `recon_jobs` count from §6.
- **DB count must still be 2** (no duplicates). This — not the log — is the idempotency proof
  (`reconciliation_job_created` may log again on a no-op upsert; the DB count is authoritative).

## 8. Cleanup (GATED mutation — reversible; transactional; MANDATORY)
```sql
BEGIN;
  DELETE FROM reconciliation_jobs WHERE trade_id IN (
    SELECT id FROM trades WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%');
  DELETE FROM trades WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
COMMIT;
```

## 9. Cleanup verification (read-only — all three must be 0)
```sql
SELECT count(*) AS run_trades FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS run_recon FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
  WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS global_stuck_eligible FROM trades
  WHERE status IN ('pending','unknown') AND created_at < now() - interval '60 seconds' AND deleted_at IS NULL;
```
Required: `run_trades=0`, `run_recon=0`, `global_stuck_eligible=0`.

## 10. Stop conditions (any one → stop, do NOT arm, preserve logs + §6 outputs, escalate)
- `boot_reconciliation_query_error`, or `stuck_count` ≠ 2.
- `reconciliation_job_upsert_error` for a seed.
- Any seeded trade changes status / gains `exchange_order_id` / `filled_at`.
- Any DLQ row, or any unexpected trade for the RUN_ID.
- `queue_enabled:true` or `is_production:true` observed.

---
**Gated:** no execution, no arm/fire, no Doppler/Railway change; DB writes (seed/cleanup) only on
operator approval; canon untouched; Migration 009 frozen. Cleanup is required — a leftover
`unknown` seed would block the bot at Step 3.5 on any future armed run.
