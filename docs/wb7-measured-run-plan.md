# WB7 Measured Run — Operator Plan (EXECUTION-GATED; this doc does not execute)

Source: [wb7-runbook.md](wb7-runbook.md) (§3 formula, §5 procedure, §6 pass/fail).

**Target: Railway (primary).** This run must execute against the **Railway** deployment
(`c1077c76` lineage, egress green) so the measured timings reflect the real production
target's egress path, region, and resource profile.
**Local worker = fallback only, NOT Railway-equivalent.** A local worker has a different
egress IP/region and machine profile, so its `processing_duration_ms` is **not**
representative and must never be used to set the canon `visibility_timeout`. Use local
only to rehearse mechanics — clearly label any local output as non-canon.

This run places **real Binance Testnet orders**. Operator authorization required. Nothing
in this document is executed by the agent.

**Tooling scope (important):** [scripts/wb6-e1-fire.sh](scripts/wb6-e1-fire.sh) is a
**TradingView webhook simulator / operator fire tool**, not TradingView itself. It posts a
synthetic alert payload to the Supabase Edge webhook, exercising the Edge auth + queue
ingestion path (`webhook_logs` → pgmq) exactly as a real alert would. It does **NOT**
prove a live TradingView alert integration — connecting real TradingView alerts is a
separate, out-of-scope step. This run validates the worker-consume path under the
simulator, not end-to-end TradingView connectivity.

---

## RUN_ID (unique per run — scopes every fire and every query)

Generate one RUN_ID and use it for the whole run. Format `WB7R-YYYYMMDD-HHMM-railway`:
```
RUN_ID="WB7R-$(date +%Y%m%d-%H%M)-railway"     # e.g. WB7R-20260617-1430-railway
echo "$RUN_ID"
```
- Every fired `signal_id` begins with `$RUN_ID` (see §5).
- Every SQL check filters `signal_id LIKE '<RUN_ID>%'` with the **exact** RUN_ID — never a
  broad `'WB7%'`. Substitute the literal RUN_ID into the SQL (psql has no shell vars).
- If you re-run within the same minute, change RUN_ID (e.g. append `-b`) so namespaces
  never overlap.

---

## 1. Preconditions (ALL must hold before arming)
- [ ] Operator explicitly authorizes a measured run (real testnet orders).
- [ ] Target is Railway; latest `worker_starting` shows `is_production:false`,
      `doppler_environment:dev`.
- [ ] `boot_reconciliation_complete stuck_count=0` on the current deploy.
- [ ] Queue empty at start: `pgmq.metrics('trade_signals').queue_length = 0` (§3).
- [ ] Egress green re-confirmed (region change resolved 451; re-confirm if region/deploy
      changed since).
- [ ] Log capture sink ready (Railway log export for the run window → `run.log`).
- [ ] `QUEUE_VISIBILITY_TIMEOUT_S` is 30 (default) for round 1.
- [ ] RUN_ID generated and recorded.

## 2. Exact Doppler/Railway checks (non-secret; read config, never secret values)
Prefer the already-emitted `worker_starting` line — it exposes every needed value, none of
them secret:
```
# Railway deploy logs, latest line:
# {"event":"worker_starting","queue":"trade_signals","queue_enabled":<bool>,
#  "visibility_timeout_s":30,"poll_interval_ms":1000,"is_production":false,
#  "doppler_environment":"dev"}
```
Expected PRE-arm: `queue_enabled:false`, `visibility_timeout_s:30`, `is_production:false`,
`doppler_environment:dev`.
If checking Doppler directly, confirm only that these KEYS are set as expected — do NOT
print secret values:
```
QUEUE_ENABLED              = false   (pre-arm)
QUEUE_VISIBILITY_TIMEOUT_S = 30      (or unset → default 30)
PRAXIS_IS_PRODUCTION       = false
```

## 3. Pre-run baseline for this RUN_ID (read-only; namespace must be clean)
Prove the RUN_ID namespace is empty BEFORE arming, so every post-run count is attributable
to this run alone. Run via `supabase db query --linked` (SELECT-only). Replace `<RUN_ID>`
with the exact value.
```sql
-- trades for RUN_ID must be 0
SELECT count(*) AS trades_pre FROM trades
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';

-- webhook_logs for RUN_ID must be 0
SELECT count(*) AS webhook_logs_pre FROM webhook_logs
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';

-- DLQ + reconciliation for RUN_ID must be 0
SELECT count(*) AS dlq_pre FROM trades_dlq
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS recon_pre FROM reconciliation_jobs rj
JOIN trades t ON t.id = rj.trade_id
WHERE t.bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';

-- queue empty
SELECT queue_length FROM pgmq.metrics('trade_signals');
```
Required: `trades_pre=0`, `webhook_logs_pre=0`, `dlq_pre=0`, `recon_pre=0`,
`queue_length=0`. If any is non-zero, STOP — the RUN_ID is not clean; pick a new RUN_ID.

## 4. Exact arm step (HUMAN-GATED — operator only)
This is the queue-consumption enablement flagged human-gated in the ops-console roadmap.
```
# Operator action (Doppler config: dev):
#   set QUEUE_ENABLED = true
# Then make Railway pick it up (redeploy/restart per your Doppler→Railway flow).
```
Confirm armed: new `worker_starting` shows `queue_enabled:true`, then the worker enters
preflight + poll loop (preflight success, no `startup_error`). DO NOT fire until
`queue_enabled:true` is confirmed.

## 5. Exact fire commands (RUN_ID-prefixed, unique signal_id per fire)
Tool: [scripts/wb6-e1-fire.sh](scripts/wb6-e1-fire.sh) — the **TradingView webhook
simulator** (operator fire tool), not a real TradingView alert. It posts a synthetic
payload to the Supabase Edge webhook → proves Edge auth + queue ingestion, **not** live
TradingView connectivity (see Tooling scope above). One webhook per call, hidden token
prompt each call. signal_id = `$RUN_ID` + phase + index → globally unique within the run
and filterable by `LIKE '<RUN_ID>%'`.
```
# Single fire (baseline element i):
scripts/wb6-e1-fire.sh "${RUN_ID}-B-${i}-buy"
# Prompted for the webhook token (hidden) — enter per fire; do not cache to env.
# Expect HTTP 200 + body, then one queued signal.
```

## 6. Baseline phase plan (10 single-bot signals, isolated timing)
Goal: clean per-message timing, no backlog.
```
for i in $(seq 1 10); do
  scripts/wb6-e1-fire.sh "${RUN_ID}-B-${i}-buy"
  sleep 6     # > poll interval + typical processing, so each msg drains before the next
done
```
Per fire, expect in the log: `message_received{read_ct:1}` →
`message_processed{ack:true, read_ct:1, processing_duration_ms:N}` → `message_acked`.
Record every `processing_duration_ms` and `read_ct`.

## 7. Load phase plan

> **DECISION REQUIRED — load evidence quality.** True multi-bot concurrency is **not
> currently available**: the fire tool targets one hardcoded `BOT_ID` with one token.
> Single-bot backlog is a *throughput/contention* test on one bot — it is **NOT equivalent
> to 5 concurrent bots** and must never be recorded as such.
>
> - **Option A (canon-grade):** provision 5 real testnet bots + tokens, then fire across
>   them concurrently. Required before the load phase can close canon as "5 concurrent
>   bots".
> - **Option B (Sprint-3 proxy):** accept single-bot backlog as a Sprint-3 proxy **only if
>   explicitly approved**, and carry forward "true multi-bot load" as an open follow-up.
>   The evidence must state it is a single-bot proxy, not 5-bot concurrency.
>
> Do not proceed with the load phase until A or B is chosen.

Single-bot backlog procedure (Option B, if approved):
```
for i in $(seq 1 10); do
  scripts/wb6-e1-fire.sh "${RUN_ID}-L-${i}-buy"   # no sleep — build queue backlog
done
```
This confirms each message is read exactly once (`read_ct:1`) even while others wait
queued. (Queued-but-unread messages are not under VT, so a backlog alone should not cause
redelivery; `read_ct>1` here would mean processing exceeded VT — a real finding.)

## 8. Logs to capture (worker stdout, JSON lines → run.log)
- `worker_starting` (armed line), `boot_reconciliation_complete`
- `message_received`, `message_processed` (read_ct, processing_duration_ms), `message_acked`
- `message_not_acked`, `duplicate_signal`, `duplicate_signal_race`, `unknown_trade_requeued`
- trade lifecycle: `trade_pending`, `trade.created`/`trade.filled` audit, fill events
- any error event: `queue_read_error`, `queue_ack_error`, `trade_insert_error`,
  `market_rules_error`, DLQ inserts
Capture the full run window from Railway logs to `run.log`.

## 9. Read-only SQL checks after run (filter by exact RUN_ID; no writes)
Run via `supabase db query --linked` (SELECT-only). Replace `<RUN_ID>` with the exact value.
```sql
-- a) one trade per signal (no duplicate orders)
SELECT count(*) AS trades, count(DISTINCT signal_id) AS distinct_signals
FROM trades
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';

-- b) status breakdown (expect all 'filled')
SELECT status, count(*) FROM trades
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%'
GROUP BY status ORDER BY status;

-- c) no stuck state
SELECT count(*) AS stuck FROM trades
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  AND signal_id LIKE '<RUN_ID>%' AND status IN ('pending','unknown');

-- d) no reconciliation jobs / DLQ for this run
SELECT count(*) AS recon_jobs FROM reconciliation_jobs rj
JOIN trades t ON t.id = rj.trade_id
WHERE t.bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND t.signal_id LIKE '<RUN_ID>%';
SELECT count(*) AS dlq FROM trades_dlq
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%';

-- e) webhook_logs ingestion verification (Edge accepted every fire, rejected none)
SELECT status, count(*) FROM webhook_logs
WHERE bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' AND signal_id LIKE '<RUN_ID>%'
GROUP BY status ORDER BY status;

-- f) queue drained
SELECT queue_length, oldest_msg_age_sec FROM pgmq.metrics('trade_signals');
```
Expected: (a) trades == distinct_signals; (b) all `filled`; (c) stuck=0; (d) recon_jobs=0,
dlq=0; (e) `accepted` == expected signal count (10 baseline, or 20 if load ran), `rejected`
== 0 and `queue_failed` == 0; (f) queue_length=0.

## 10. Calculate max processing_duration_ms and visibility_timeout_s
From run.log (jq over the structured lines):
```
# read_ct histogram — any bucket other than "1" is a finding
grep '"event":"message_processed"' run.log | jq -r '.read_ct' | sort | uniq -c

# max processing_duration_ms across ALL fires (baseline + load)
MAX=$(grep '"event":"message_processed"' run.log | jq -r '.processing_duration_ms' \
      | sort -n | tail -1)

# Apply runbook §3: no Vault re-add; + ack overhead; + safety buffer; ceil to seconds
ACK=1000; BUF=15000
WORST=$(( MAX + ACK ))
VT=$(( (WORST + BUF + 999) / 1000 ))     # integer ceil
echo "max=${MAX}ms worst_case=${WORST}ms visibility_timeout=${VT}s (configured=30s)"
```

## 11. Pass / fail criteria (runbook §6)
PASS requires ALL:
- Every `message_processed` has `read_ct == 1` (§10 histogram shows only the "1" bucket).
- Configured `QUEUE_VISIBILITY_TIMEOUT_S` (30) ≥ computed `visibility_timeout_s` (§10).
- 9(a) trades == distinct_signals; zero `duplicate_signal_race` for first-delivery msgs.
- 9(c) stuck=0; 9(d) recon_jobs=0, dlq=0; 9(e) accepted==expected, rejected=0,
  queue_failed=0; 9(f) queue_length=0.
If computed VT > 30: raise `QUEUE_VISIBILITY_TIMEOUT_S`, disarm/re-arm, repeat once with a
NEW RUN_ID (§3 baseline again).

## 12. Disarm procedure (MANDATORY at end, and on any stop condition)
```
# Operator action (Doppler config: dev):
#   set QUEUE_ENABLED = false
# Redeploy/restart Railway to pick it up.
```
Confirm disarmed: new `worker_starting` shows `queue_enabled:false`, then
`worker_queue_disabled`; `pgmq.metrics('trade_signals').queue_length = 0`. Never leave the
run armed.

## 13. Stop conditions (any one → STOP firing, disarm §12, collect evidence, escalate)
- Any `message_processed` with `read_ct > 1` on a non-stuck message (redelivery → VT too short).
- Any duplicate trade: 9(a) trades > distinct_signals, or any `duplicate_signal_race` for a
  first delivery.
- Any trade reaches `unknown`, or any `reconciliation_job`/DLQ row appears.
- Any `webhook_logs` row with `status='rejected'` or `'queue_failed'` for this RUN_ID.
- Any `ExchangeUnavailable`/egress failure (e.g. HTTP 451) or `is_production` ≠ false.
- `processing_duration_ms` approaches/exceeds VT (≥ `QUEUE_VISIBILITY_TIMEOUT_S` × 1000).
- Queue not draining: `queue_length` climbing or `oldest_msg_age_sec` rising across checks.
- Any error-event spike: `queue_read_error`, `trade_insert_error`, `market_rules_error`,
  repeated `queue_ack_error`.
On stop: disarm first, then preserve run.log + the §9 query outputs as evidence; do not
update canon; report for review.

---

**This run stays gated:** no execution, no arm/fire, no Doppler/Railway/DB changes, no
canon update until reviewed E1/E2 evidence (runbook §6), Migration 009 frozen.
