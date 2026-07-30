# WB7 Execution Checklist — Option B (single-bot backlog proxy)

Fast runsheet for the WB7 measured run. Full rationale lives in
[wb7-runbook.md](wb7-runbook.md) and [wb7-measured-run-plan.md](wb7-measured-run-plan.md).

- **Load decision (Sprint 3): Option B** — single-bot backlog as a **proxy**. This is a
  throughput/contention test on ONE bot; it is **NOT equivalent to 5 concurrent bots**.
  True 5-bot concurrency is **carried forward** as a later load/performance item; evidence
  from this run must say "single-bot proxy".
- **Target = Railway** (deployed, egress green). Local worker = rehearsal only, non-canon.
- `scripts/wb6-e1-fire.sh` = **TradingView webhook simulator** (operator fire tool). It
  proves the Supabase Edge webhook + queue ingestion path — **not** live TradingView.
- **Arm / fire / disarm are operator-only.** This document does not execute anything.

---

## 0. Set RUN_ID (once, whole run)
```bash
RUN_ID="WB7R-$(date +%Y%m%d-%H%M)-railway"; echo "$RUN_ID"   # e.g. WB7R-20260617-1430-railway
BOT=2dcaddba-b62d-47e1-87a7-7f7b759f38d2
```
Substitute the literal RUN_ID into every SQL `<RUN_ID>` below (psql has no shell vars).

## 1. Pre-run baseline SQL (read-only; all must be 0 / empty)
```sql
SELECT count(*) AS trades_pre   FROM trades       WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS webhook_pre  FROM webhook_logs WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS dlq_pre      FROM trades_dlq   WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS recon_pre    FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
  WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
SELECT queue_length             FROM pgmq.metrics('trade_signals');
```
Required: `trades_pre=0, webhook_pre=0, dlq_pre=0, recon_pre=0, queue_length=0`.
Any non-zero → STOP, pick a new RUN_ID.

## 2. Doppler/Railway checks (non-secret — read latest `worker_starting` log line)
Expect: `queue_enabled:false`, `visibility_timeout_s:30`, `is_production:false`, `doppler_environment:dev`.

## 3. Arm (operator-only)
Doppler (config `dev`): set `QUEUE_ENABLED=true` → redeploy/restart Railway.
Confirm: new `worker_starting` shows `queue_enabled:true`, preflight ok, no `startup_error`.
**Do not fire until confirmed.**

## 4. Fire — 10 baseline + 10 backlog (one RUN_ID)
```bash
# Baseline (isolated timing): 10 fires, spaced
for i in $(seq 1 10); do
  scripts/wb6-e1-fire.sh "${RUN_ID}-B-${i}-buy"
  sleep 6
done

# Backlog proxy (Option B — single-bot contention, NOT 5 concurrent bots): 10 fires, no spacing
for i in $(seq 1 10); do
  scripts/wb6-e1-fire.sh "${RUN_ID}-L-${i}-buy"
done
```
Hidden token prompt per fire; do not cache to env. Expect HTTP 200 each.

## 5. Logs to export → `run.log`
Export the Railway log window covering the run. Must include `worker_starting`,
`message_received`, `message_processed` (read_ct, processing_duration_ms), `message_acked`,
and any `duplicate_signal*`, `*_error`, DLQ, `unknown_trade_requeued`.

## 6. Post-run SQL (read-only)
```sql
SELECT count(*) AS trades, count(DISTINCT signal_id) AS distinct_signals FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT status, count(*) FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' GROUP BY status ORDER BY status;
SELECT count(*) AS stuck FROM trades
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' AND status IN ('pending','unknown');
SELECT count(*) AS recon FROM reconciliation_jobs rj JOIN trades t ON t.id=rj.trade_id
  WHERE t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS dlq FROM trades_dlq
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT status, count(*) FROM webhook_logs
  WHERE bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%' GROUP BY status ORDER BY status;
SELECT queue_length, oldest_msg_age_sec FROM pgmq.metrics('trade_signals');
```
Expect: trades==distinct_signals==20; all `filled`; stuck=0; recon=0; dlq=0;
webhook_logs `accepted`=20, `rejected`=0, `queue_failed`=0; queue_length=0.

## 7. Calculation commands
```bash
# read_ct histogram — ANY bucket other than "1" is a finding
grep '"event":"message_processed"' run.log | jq -r '.read_ct' | sort | uniq -c

# max processing_duration_ms (baseline + backlog)
MAX=$(grep '"event":"message_processed"' run.log | jq -r '.processing_duration_ms' | sort -n | tail -1)

# visibility_timeout per runbook §3: + ack overhead, + safety buffer, ceil to seconds
ACK=1000; BUF=15000; WORST=$(( MAX + ACK )); VT=$(( (WORST + BUF + 999) / 1000 ))
echo "max=${MAX}ms worst_case=${WORST}ms visibility_timeout=${VT}s (configured=30s)"
```
PASS (runbook §6): read_ct all `1`; `VT ≤ 30`; trades==distinct_signals;
stuck/recon/dlq=0; webhook accepted=20/rejected=0/queue_failed=0; queue_length=0.

## 8. Disarm (operator-only — MANDATORY at end and on any stop)
Doppler (`dev`): set `QUEUE_ENABLED=false` → redeploy/restart Railway.
Confirm: `worker_starting queue_enabled:false`, then `worker_queue_disabled`,
`queue_length=0`. **Never leave armed.**

## 9. Stop conditions (any one → stop firing, disarm §8, preserve run.log + §6 outputs, escalate)
- any `read_ct > 1` on a non-stuck message · trades > distinct_signals · any `duplicate_signal_race` on first delivery
- any trade `unknown`; any recon/DLQ row appears
- any `webhook_logs` `rejected`/`queue_failed` for this RUN_ID
- any `ExchangeUnavailable`/HTTP 451; `is_production` ≠ false
- `processing_duration_ms` ≥ `QUEUE_VISIBILITY_TIMEOUT_S`×1000; queue not draining
- spike in `queue_read_error`/`trade_insert_error`/`market_rules_error`/repeated `queue_ack_error`

---

**Gated:** no execution, no arm/fire, no Doppler/Railway/DB change, no canon update until
reviewed E1/E2 evidence, Migration 009 frozen.
After the run, hand back `run.log` + the §6 outputs → agent computes §7 + PASS/FAIL and
drafts the canon update for approval.
