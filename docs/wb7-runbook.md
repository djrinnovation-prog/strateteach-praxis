# WB7 Runbook — visibility_timeout measurement + zero-duplicate redelivery

**Status:** PREP ONLY (instrumentation landed; measured run NOT yet executed).
**Scope:** worker `trade_signals` consume loop.
**Owner action gate:** the measured phase (§5) is operator-gated. Egress to Binance
Testnet from Railway is now **GREEN**: Railway originally returned HTTP 451 (region/IP
geo-block); a Railway **region change** fixed testnet egress — HTTP probe returned 200
and `market_rules_probe` returned `ok:true` (captured while the WB6 diagnostic probes
were deployed, before their removal in `358afbd`). See
[wb6-e1-runbook.md](wb6-e1-runbook.md). The probe code itself was since removed, so a
fresh egress re-confirm before the run is operator-side (§5).
**Canon:** `DECISIONS.md → "pgmq visibility_timeout — PENDING MEASUREMENT"` stays OPEN.
Do **not** edit canon until §6 produces reviewed E1/E2 evidence.

---

## 1. Objective

Pick a correct `QUEUE_VISIBILITY_TIMEOUT_S` from measured data, and prove that under
that value **no message is redelivered while it is still being processed** (zero
duplicate order attempts). Two financial failure modes bound the choice:

- **VT too short** → message reappears mid-processing → duplicate order attempt
  (caught today by the idempotency layer, §4 — but it must never be *relied on* in
  steady state; a redelivery is a defect signal).
- **VT too long** → a genuinely stuck `pending`/`unknown` trade sits invisible longer
  than necessary → slow crash-recovery.

---

## 2. Instrumentation (landed — `worker/src/index.ts`, `pollOnce`)

Every consumed message now emits two structured log lines:

```
message_received   { msg_id, bot_id, side, read_ct }
message_processed  { msg_id, ack, read_ct, processing_duration_ms }
```

- **`processing_duration_ms`** — `processMessage` wall-time on a monotonic clock
  (`process.hrtime.bigint()`; immune to wall-clock adjustment). This is the empirical
  `worst_case` input for the formula in §3. It measures the dominant in-flight cost
  (Vault + up to 2× exchange round-trips + DB writes); the `pgmq_delete` ack adds one
  further small DB round-trip on top — accounted for separately in §3 via
  `ack_delete_overhead_ms`.
- **`read_ct`** — pgmq's redelivery counter, surfaced verbatim from
  `pgmq.message_record`. **`read_ct == 1`** = first delivery. **`read_ct > 1`** = the
  message was re-exposed after a prior VT lapse → **redelivery**. This is the
  zero-duplicate-redelivery evidence channel.

Pure measurement: no branch, ack, or DB behaviour depends on either value.

Static coverage: `index.test.ts → "WB7 instrumentation — processing_duration_ms +
redelivery counter"` (3 tests: ack-path duration+read_ct, read_ct>1 surfaced,
empty-queue emits neither).

---

## 3. visibility_timeout formula (LOCKED for the measured phase)

`processing_duration_ms` **already** measures the full `processMessage` wall-time
end-to-end — Vault fetch + up to 2× exchange round-trips + DB writes are all inside it.
The only work not yet covered is the one `pgmq_delete` (ack) round-trip that runs *after*
`processMessage` returns. So the timeout is built directly on the measured value plus
that ack allowance plus a safety buffer — **no per-component term is re-added**:

```
worst_case_ms        = max(processing_duration_ms over all runs)   # measured, §5
                       + ack_delete_overhead_ms                    # the post-process ack RPC
visibility_timeout_s = ceil( (worst_case_ms + safety_buffer_ms) / 1000 )
```

Constants (locked for the measured phase):
```
ack_delete_overhead_ms = 1000    # generous allowance for one pgmq_delete DB round-trip
safety_buffer_ms       = 15000   # carried over from canon's 15s safety buffer
```

**Why Vault is NOT double-counted (Codex review fix):** canon (`DECISIONS.md`) wrote
`worst_case` as an *analytic* sum of components
(`Vault_P99 + 2×exchange + DB + overhead`) because, when canon was written, no
end-to-end measurement existed. `processing_duration_ms` is the *measured realization*
of that same sum — Vault is counted **once**, inside it. Adding `Vault_P99` again on top
(as the old runbook draft did) would count Vault twice. This runbook uses the measured
value directly and re-adds nothing but the genuinely-uncovered ack RPC. Canon stays OPEN
and is reconciled only in §6, with evidence.

**Analytic cross-check** (a sanity bound on the measured `max`, *not* an additive term):
`worst_case ≈ T_vault_P99 + 2 × T_exchange_timeout + T_db + overhead`. With
`T_exchange_timeout = 5000 ms` (capped in BinanceAdapter) this predicts ≈ 10.4 s, so
`visibility_timeout_s ≈ ceil((10.4 + 1 + 15)) ≈ 27 s`. **Current default `30 s` is the
working hypothesis; the measured `max` confirms or replaces it.**

Hard precondition: BinanceAdapter exchange timeout **must** stay ≤ 5000 ms. If it is ever
raised to the ccxt default (10 s), `worst_case ≈ 20 s` → required VT ≈ 36 s > 30 s, and
the default becomes unsafe.

`visibility_timeout` is set via env `QUEUE_VISIBILITY_TIMEOUT_S` (no redeploy of code).

---

## 4. Idempotency / constraint verification (read-only — DONE)

Redelivery safety rests on two DB layers, both `UNIQUE(bot_id, signal_id)`:

| Layer | Table | Constraint | Worker code |
|---|---|---|---|
| Ingest dedup (Edge) | `webhook_logs` | `webhook_logs_bot_signal_unique` | enqueue path |
| Trade dedup (worker) | `trades` | `trades_bot_signal_unique` | Step 3 pre-check (`existingTrade`) + Step 7 INSERT race (`23505` → `duplicate_signal_race`, ack) |

**Read-only live verification (E2, run 2026-06-16, no mutation):**

```sql
SELECT conrelid::regclass::text AS table_name, conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition
FROM   pg_constraint
WHERE  conname IN ('trades_bot_signal_unique','webhook_logs_bot_signal_unique')
ORDER  BY table_name;
```

Result — both present and live:
- `trades.trades_bot_signal_unique` = `UNIQUE (bot_id, signal_id)`
- `webhook_logs.webhook_logs_bot_signal_unique` = `UNIQUE (bot_id, signal_id)`

So even if a redelivery occurs (`read_ct > 1`), a second order cannot be placed: the
worker either short-circuits at the Step 3 idempotency pre-check or the Step 7 INSERT
hits `23505` and acks as `duplicate_signal_race`. The WB7 goal is to keep `read_ct` at
1 so this safety net is never exercised in steady state.

---

## 5. Measured-phase procedure (GATED — do not run yet)

Preconditions (ALL required before starting):
- [x] Egress to Binance Testnet green on Railway — **resolved** via region change
      (HTTP probe → 200, `market_rules_probe` → `ok:true`). Operator re-confirms egress
      is still green before the run if the Railway region/deploy changed since.
- [ ] `PRAXIS_IS_PRODUCTION != 'true'` confirmed in `worker_starting` log (testnet).
- [ ] Operator authorization for a measured run (this places real testnet orders).

Procedure (canon-aligned: 20 runs total):
1. `QUEUE_ENABLED=true`, `QUEUE_VISIBILITY_TIMEOUT_S=30` (start at current default).
2. **Baseline:** 10 single-bot signals (fresh `signal_id` each). Record
   `processing_duration_ms` and `read_ct` from each `message_processed` line.
3. **Load:** 5 concurrent bots, 10 signals. Record the same.
4. `worst_case = max(processing_duration_ms)` across all 20.
5. Compute `visibility_timeout` per §3. If result > configured VT, raise
   `QUEUE_VISIBILITY_TIMEOUT_S` and repeat from step 2 once.

---

## 6. Pass / fail criteria (evidence to collect)

PASS (all):
- **Zero-duplicate redelivery:** every `message_processed` has `read_ct == 1`
  (E1, from logs). Any `read_ct > 1` for a non-stuck message = FAIL → VT too short.
- **Headroom:** configured `QUEUE_VISIBILITY_TIMEOUT_S` ≥ computed `visibility_timeout`
  (§3) using the measured `max`.
- **No duplicate trades:** `trades` row count == distinct `signal_id` count for the run
  (read-only SELECT, E2). Zero `duplicate_signal_race` events for first-delivery msgs.
- **No stuck state:** post-run `pending`/`unknown` trades == 0 (read-only, E2).

Only after the above are collected and reviewed:
- Update canon (`DECISIONS.md` visibility_timeout entry) from OPEN → resolved value,
  citing the run evidence.
- Persist the run log/evidence.

Until then: instrumentation is landed and unit-proven; the **value remains a
hypothesis (30 s)** and canon stays OPEN.

---

## 7. Out of scope for WB7 prep (do not start here)

- Alerting implementation (Sentry on `read_ct > 1` / stuck trades) — later.
- Reconciliation `setInterval(60s)` tuning — separate deferred decision.
- Any Migration 009 work — frozen.
- Egress remediation — **resolved** via Railway region change (egress now green); no
  longer a blocker for §5. Any further proxy/static-IP hardening is a separate workstream.
