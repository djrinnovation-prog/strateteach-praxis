# WB8 Runbook — boot reconciliation exercised

**Status:** PREP ONLY (plan; no seed, no restart, no execution yet).
**Scope:** worker `runBootReconciliation` ([worker/src/index.ts](../worker/src/index.ts) — the
boot-time scan that finds stuck `pending`/`unknown` trades and hands them to
`reconciliation_jobs`).
**Safety headline:** boot reconciliation runs at boot **independent of `QUEUE_ENABLED`**, so
WB8 is exercised with the **queue DISABLED** — **no arm, no fire, no real orders**. The only
mutation required is a small **reversible synthetic seed** (gated, operator-approved).
**Canon:** no canon change until reviewed E1/E2 evidence. Migration 009 frozen.

---

## 1. What boot reconciliation does (grounded in code)
At boot, before the queue branch, `runBootReconciliation`:
1. Computes `threshold = now() − RECONCILIATION_THRESHOLD_SECONDS` (60s).
2. Selects `trades` where `status IN ('pending','unknown') AND created_at < threshold AND
   deleted_at IS NULL` (global; not bot-scoped).
3. Logs `boot_reconciliation_complete{stuck_count}`.
4. For each stuck trade: `upsert reconciliation_jobs(trade_id)` with
   `onConflict:trade_id, ignoreDuplicates` → **idempotent** (backed by
   `reconciliation_trade_unique`). Logs `reconciliation_job_created{trade_id,status}` or
   `reconciliation_job_upsert_error`.

It only **hands off** (creates a job). It does NOT place an order, call the exchange, or
mutate the stuck trade. The runtime `setInterval(60s)` scan and the actual
unknown→filled/failed *resolution* (fetchOrder) are **deferred** — out of WB8 scope (§9).

## 2. Objective
Exercise the non-zero path: prove that when stuck `pending`/`unknown` trades exist at boot,
the worker (a) **detects** them, (b) **creates** a `reconciliation_job` for each, and (c) is
**idempotent** across reboots (no duplicate jobs) — with the queue disabled and zero orders.

## 3. Why a seed is required (and the safer-path rationale)
A stuck trade can arise only two ways: a real crash mid-processing (needs arm+fire+kill at a
precise instant — nondeterministic and places real orders), or a **synthetic seed row**. The
seed is strictly safer and deterministic: queue stays disabled, no exchange call, fully
reversible (DELETE). WB8 uses the seed.
The seed and cleanup are **gated DB mutations** — operator-approved at execution time. PREP
does not perform them.

## 4. RUN_ID
```bash
RUN_ID="WB8R-$(date +%Y%m%d-%H%M)"; echo "$RUN_ID"   # e.g. WB8R-20260617-1500
```
Every seeded `signal_id`/`client_order_id` begins with `$RUN_ID`; every SQL filters
`signal_id LIKE '<RUN_ID>%'` with the exact value.

## 5. Pre-run baseline (read-only; required clean state)
```sql
-- WB8 GATE — matches runBootReconciliation's exact selector (status + 60s threshold + not-deleted):
SELECT count(*) AS global_stuck_eligible FROM trades
  WHERE status IN ('pending','unknown')
    AND created_at < now() - interval '60 seconds'
    AND deleted_at IS NULL;
-- Informational only (stricter — all pending/unknown regardless of age):
SELECT count(*) AS global_stuck_all FROM trades
  WHERE status IN ('pending','unknown') AND deleted_at IS NULL;
-- RUN_ID namespace empty
SELECT count(*) AS trades_pre FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS recon_pre FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
  WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
```
Required (gate): `global_stuck_eligible=0`, `trades_pre=0`, `recon_pre=0`.
(Baseline 2026-06-17: `global_stuck_eligible=0`, `global_stuck_all=0`, global reconciliation_jobs=0 — confirmed read-only.)

## 5.5 Pre-seed safety gate (REQUIRED — do NOT seed if the worker is armed)
Before seeding, confirm from the LATEST Railway `worker_starting` line (+ the following idle log):
- `queue_enabled:false` **and** `worker_queue_disabled` present
- `is_production:false`
- `doppler_environment:dev`

If `queue_enabled:true` (armed) or `is_production:true` → **STOP, do not seed.** The seed is
only safe while the queue is disabled: a seeded `pending`/`unknown` row must never coexist with
an armed consumer.

## 6. Seed (GATED mutation — reversible; operator-approved at execution)
Two synthetic stuck trades (one `pending`, one `unknown`), backdated > 60s, real FK values
(bot `2dcaddba-…`, user `66e1b075-930e-4a20-9289-ca8668699eea`, `BTCUSDT`). No
`exchange_order_id` → never touched the exchange.
```sql
INSERT INTO trades (bot_id, user_id, signal_id, client_order_id, side, trading_pair, quantity, status, created_at)
VALUES
 ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','66e1b075-930e-4a20-9289-ca8668699eea',
  '<RUN_ID>-pending','<RUN_ID>-PRX-pending','buy','BTCUSDT',0.00010,'pending', now() - interval '2 minutes'),
 ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','66e1b075-930e-4a20-9289-ca8668699eea',
  '<RUN_ID>-unknown','<RUN_ID>-PRX-unknown','buy','BTCUSDT',0.00010,'unknown', now() - interval '2 minutes');
```
Confirm (read-only): 2 rows present for RUN_ID, statuses `pending`/`unknown`,
`created_at` older than 60s, `exchange_order_id` null.

## 7. Exercise — restart the worker (queue stays DISABLED)
Confirm `QUEUE_ENABLED=false` first, then restart/redeploy the Railway worker so
`runBootReconciliation` runs. **Do NOT arm.** Expected logs, in order:
- `worker_starting` with `queue_enabled:false`, `is_production:false`, `doppler_environment:dev`
- `boot_reconciliation_complete{stuck_count:2}`
- `reconciliation_job_created{trade_id,status:"pending"}` and `{…,status:"unknown"}` (one each)
- then `worker_queue_disabled` (idle keep-alive; queue not consumed)

## 8. Post-run verification (read-only)
```sql
-- a) a reconciliation_job exists for each seeded trade (expect 2)
SELECT t.signal_id, t.status AS trade_status, rj.status AS job_status
FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%'
ORDER BY t.signal_id;
SELECT count(*) AS recon_jobs FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
-- b) seeded trades UNCHANGED (boot reconciliation only hands off; no order placed)
SELECT signal_id, status, exchange_order_id, filled_at FROM trades
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' ORDER BY signal_id;
-- c) no DLQ for the seeds
SELECT count(*) AS dlq FROM trades_dlq
WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
```
Expected: (a) `recon_jobs=2`, both `job_status='pending'`; (b) seeds still `pending`/`unknown`,
`exchange_order_id` null, `filled_at` null; (c) `dlq=0`.

## 9. Idempotency check (restart again — the core WB8 evidence)
Restart the worker a SECOND time (queue still disabled). Then re-run §8(a) count.
- Expected DB: `recon_jobs` **still 2** — no duplicates (the upsert `ignoreDuplicates` +
  `reconciliation_trade_unique` hold across reboots).
- **Honesty note:** the `reconciliation_job_created` log may fire again on the second boot
  even though no new row was inserted — with `ignoreDuplicates`, a conflicting upsert is a
  silent no-op, so the log is per-attempt, not per-insert. The **authoritative idempotency
  evidence is the DB count staying at 2**, not the log line.

## 10. Pass / fail criteria
PASS (all):
- Boot 1: `boot_reconciliation_complete{stuck_count:2}`; one `reconciliation_job_created` per seed.
- §8(a): `recon_jobs=2`, both jobs `pending`.
- §8(b): seeds unchanged — no `exchange_order_id`, no `filled_at` (proves hand-off only, no order).
- §8(c): `dlq=0`.
- Boot 2 (idempotency): DB `recon_jobs` **still 2** (no duplicates).
- `is_production:false` and `queue_enabled:false` throughout (no arm, no order).

## 11. Cleanup (GATED mutation — reversible; MANDATORY after the run)
Run both DELETEs in ONE transaction (recon jobs first — FK `ON DELETE RESTRICT` — then trades),
so cleanup is all-or-nothing and can't half-apply:
```sql
BEGIN;
  DELETE FROM reconciliation_jobs WHERE trade_id IN (
    SELECT id FROM trades WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%');
  DELETE FROM trades WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
COMMIT;
```
Then verify (read-only) — all three must be 0:
```sql
SELECT count(*) AS run_trades FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS run_recon FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
  WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS global_stuck_eligible FROM trades
  WHERE status IN ('pending','unknown') AND created_at < now() - interval '60 seconds' AND deleted_at IS NULL;
```
Required: `run_trades=0`, `run_recon=0`, `global_stuck_eligible=0`. **Leaving the `unknown`
seed in place would block the bot at Step 3.5 on any future armed run — cleanup is required.**

## 12. Stop conditions (any one → stop, do NOT arm, preserve logs + §8 outputs, escalate)
- `boot_reconciliation_query_error`, or `stuck_count` ≠ 2 (≠ the seeded count).
- `reconciliation_job_upsert_error` for a seed.
- Any seeded trade changes status, gains `exchange_order_id`, or `filled_at` (would mean
  something acted on it — unexpected; boot reconciliation must only hand off).
- Any DLQ row, or any unexpected trade for the RUN_ID.
- `queue_enabled:true` or `is_production:true` observed (immediately stop — this run must be
  queue-disabled testnet).

## 13. Scope caveat (carry forward)
WB8 exercises **detection + job creation + idempotency** of boot reconciliation via synthetic
seeds, queue disabled. It does **NOT** exercise:
- the runtime `setInterval(60s)` reconciliation scan (deferred), or
- the actual *resolution* of an `unknown` trade via `fetchOrder` (unknown → filled/failed).
Those are carried forward as separate items (see Decision Log: "Reconciliation worker —
setInterval(60s) design").

## 14. Optional follow-up (NOT part of WB8; no code change now)
`reconciliation_job_created` logs per upsert-attempt, not per actual insert (see §9). A future
nicety could log `reconciliation_job_exists` vs `_created` by checking the upsert rowcount.
Not required — DB count is authoritative. Left as a deferred instrumentation note.

---
**Gated:** no execution, no arm/fire, no Doppler/Railway change, DB mutations (seed/cleanup)
only on operator approval at execution time, canon untouched, Migration 009 frozen.
