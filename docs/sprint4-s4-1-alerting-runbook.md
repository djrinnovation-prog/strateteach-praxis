# Sprint 4 · S4-1 — Alerting Phase 1 (runbook)

**Status:** DESIGN / RUNBOOK ONLY — no implementation, no migration, no DB/Doppler/Railway
change, no arm/fire. Testnet/dev only. Migration 009 frozen.
**Goal:** surface the 4 critical failure signals during Sprint-4 testnet campaigns without manual
log watching, with **secret-safe** payloads and **least-privilege** read access.
**Decisions applied:** Telegram + Healthchecks sinks · gated worker heartbeat (default OFF) ·
read-only role *design only* (no migration yet) · `pgmq_send` revoke is NOT the default
queue_failed induction path.

---

## 1. Architecture
Two isolated pieces, neither in the trade-processing hot path:
- **Signals 1–3 (DLQ · queue_failed · stuck trade): external scheduled alert poller** — read-only
  SQL every N minutes → Telegram on a state change. No DB mutation; unit-testable.
- **Signal 4 (worker liveness): Healthchecks.io dead-man switch** — the worker pings a Healthchecks
  URL on a periodic timer (armed + idle); HC alerts if pings stop. A dead worker can't self-report,
  so liveness must be an active heartbeat.

## 2. Sinks (decided)
- **Telegram** — DLQ / queue_failed / stuck-trade alerts (human push during campaigns). Secrets
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` live in Doppler (operator-owned).
- **Healthchecks.io** — worker liveness (dead-man). `HEALTHCHECKS_URL` in Doppler.
- **Sentry** — future / canon-aligned alternative ("DLQ → Sentry fires on INSERT"); **not** Phase 1.
- **logs-only** — rejected.

## 3. Signal definitions + exact trigger conditions (read-only SQL)
Watermarks (`:last_seen`) are the max `created_at`/`received_at` the poller has already alerted on;
alerts fire on **transition (clear→firing)** and on **new rows**, never every poll (§7 de-dup).

**1. DLQ insert / DLQ count > 0** — table `public.trades_dlq` (cols: `created_at`, `trade_id`,
`bot_id`, `signal_id`, `failure_reason`):
```sql
SELECT count(*) AS n, max(created_at) AS newest
FROM trades_dlq WHERE created_at > :last_seen_dlq;          -- alert if n > 0
SELECT count(*) AS n FROM trades_dlq;                        -- floor: DLQ should be empty
```

**2. webhook queue_failed** — table `public.webhook_logs` (cols: `status`, `received_at`, `bot_id`,
`signal_id`):
```sql
SELECT count(*) AS n, max(received_at) AS newest
FROM webhook_logs WHERE status = 'queue_failed' AND received_at > :last_seen_qf;   -- alert if n > 0
```

**3. Stuck pending/unknown trade older than threshold** — table `public.trades` (cols: `status`,
`created_at`, `deleted_at`, `id`, `bot_id`, `signal_id`):
```sql
SELECT count(*) AS n
FROM trades
WHERE status IN ('pending','unknown')
  AND created_at < now() - interval '5 minutes'      -- threshold >> VT 30s + ~2s processing → no flap
  AND deleted_at IS NULL;                            -- alert if n > 0
```

**4. Worker liveness** — Healthchecks dead-man: ping interval **60s**, grace **~5 min**. HC alerts
if no ping within the grace window. No DB query.

## 4. Worker heartbeat — strict constraints (the only `worker/src` change)
A periodic Healthchecks ping, gated and fully isolated:
- **Default OFF when `HEALTHCHECKS_URL` is unset** — the ping code is a no-op; existing deploys
  unaffected.
- **Fire-and-forget · failure-swallowed** — the ping is dispatched without awaiting in the trade
  path; any error (timeout/non-200) is caught and ignored.
- **Must never block or delay trade processing** — runs on its own timer, not inside `pollOnce`/
  `processMessage`; a slow/failed ping cannot stall a poll or a fill.
- **Must never log or expose the Healthchecks URL** (or any secret) — no `console.log` of the URL,
  no inclusion in any error line; the URL is read from env and used only as the fetch target.
- **Runs in armed + idle states** (so a disabled-queue worker still proves liveness).
- **Tests:** (a) **no-op when `HEALTHCHECKS_URL` unset** (no fetch attempted); (b) **no secret/URL
  leakage** in any emitted log (regex assertion); (c) a failed ping does not throw into the caller.

## 5. Poller DB access — dedicated read-only role (DESIGN ONLY; no migration yet)
The poller connects with a **dedicated least-privilege read-only role** (proposed name
`praxis_alert_ro`), never `service_role`.

**Exact access the poller needs (and nothing else):**
| Object | Columns used | Grant |
|---|---|---|
| `public.trades_dlq` | `created_at, trade_id, bot_id, signal_id, failure_reason` | `SELECT` |
| `public.webhook_logs` | `status, received_at, bot_id, signal_id` | `SELECT` |
| `public.trades` | `status, created_at, deleted_at, id, bot_id, signal_id` | `SELECT` |

**Proposed GRANT scope (to be applied later in a separate, gated migration — NOT now):**
```sql
-- DESIGN ONLY — do not apply in S4-1.
-- CREATE ROLE praxis_alert_ro NOLOGIN;  (+ a login role / password via Doppler, operator-owned)
GRANT USAGE  ON SCHEMA public TO praxis_alert_ro;
GRANT SELECT ON TABLE public.trades_dlq, public.webhook_logs, public.trades TO praxis_alert_ro;
-- No GRANT on any other table; no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES anywhere.
-- No pgmq access (queue_length is NOT a Phase-1 alert signal; excluded to keep the role minimal).
```

**Why not `service_role`:** `service_role` holds INSERT/UPDATE across the schema and BYPASSRLS. An
always-scheduled external poller holding it would massively widen blast radius if that credential
leaked. The alert poller only ever reads 3 tables → a SELECT-only role on exactly those 3 tables is
the correct least-privilege boundary.

**Verification (after the future migration, before trusting the role):**
- `information_schema.role_table_grants` for `grantee='praxis_alert_ro'` shows **only `SELECT`** on
  the 3 tables and **no rows** for any other table.
- Negative proof: an `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` attempt as the role **fails with 42501**.
- Role has no membership in `service_role`/`postgres` and no `BYPASSRLS`.

**Migration is a separate gated review** — S4-1 runbook specifies it; it is **not** created or
applied here.

## 6. Alert payload — safe vs forbidden
**Safe to include:** signal/event name · table name · **counts** · `trade_id` (UUID) · `signal_id`
(opaque idempotency key) · `bot_id` (UUID) · trade `status` · **age (s)** · `exchange_order_id`
(numeric) · `failure_reason` **only if it is a static error class/code** (never a raw message) ·
environment (`dev`) · Railway deploy id · timestamp.

**Must NEVER appear:** API keys / secrets · webhook **token** · **raw URLs** (esp. token-in-path
webhook URL) · HTTP headers · request/response bodies · `webhook_logs.raw_payload` /
`trades_dlq.raw_payload` (exclude wholesale) · `source_ip` · Vault / decrypted secrets · ccxt
`error.message`/stack/cause · `service_role` key · the **Telegram token / Healthchecks URL /
read-only DB URL** themselves. (Same allow-list discipline as the worker's structured logs:
ids/codes/counts only.)

## 7. De-dup / state
- Per-signal watermark (`last_seen_*`) + an "active condition" flag → alert on **clear→firing**
  transition and on **new rows**; re-arm only after the condition clears.
- State kept in a **small local state file** (no DB write) or a bounded query window — **no
  `alert_state` table** (avoids a mutation in Phase 1).
- Optional: a periodic "still-firing" reminder cap (e.g. once/hour) so a persistent condition isn't
  forgotten without spamming.
- **Persistence caveat:** a local state file is allowed **only when the scheduler/runtime has
  persistent storage**. In an **ephemeral scheduler** (e.g. GitHub Actions, stateless Railway cron),
  do **not** rely on a local state file — instead use a **bounded query window + deterministic alert
  keys**, and **accept/report possible duplicate reminders**, or choose a **persistent store in a
  separately reviewed design**. The poller **must never silently mark an alert as handled if state
  persistence is uncertain** — prefer a duplicate reminder over a dropped alert.

## 8. Implementation approach + files likely touched
- **Poller:** `worker/tools/alert-poller/{index,queries,telegram,dedup}.ts` + tests. Read-only SQL →
  evaluate 1–3 → secret-safe Telegram POST. Config from Doppler env.
- **Shared lib (with S4-0.5):** `worker/tools/lib/{readonly-sql,safe-payload}.ts`.
- **Worker change (small, gated):** `worker/src/heartbeat.ts` + a few lines in the bootstrap/keep-
  alive to start the timer behind `HEALTHCHECKS_URL`; `worker/package.json` adds an `alert-poll`
  script. No change to `pollOnce`/`processMessage`.
- **Operator infra (separate, gated):** a scheduler (Railway cron service / GitHub Actions schedule);
  a Healthchecks check; Doppler secrets; the read-only-role migration (§5).
- **No new runtime deps** beyond `fetch` (Node built-in) for Telegram/Healthchecks.

## 9. Tests needed
- Poller decision tests vs **fixture query results:** each condition fires correctly; threshold/no-
  flap on borderline ages; **no-alert on clean baseline**; de-dup (no re-alert for an unchanged
  condition).
- **Payload-safety test** (regex): forbidden fields never appear in any rendered alert.
- Heartbeat tests per §4 (no-op when unset · no leak · failure-swallowed).

## 10. Inducing each alert safely on testnet (all reversible, gated)
1. **DLQ:** seed one synthetic `trades_dlq` row (WB8-style reversible seed) → poller alerts →
   transactional cleanup. *(Gated mutation, separate approval.)*
2. **queue_failed — Phase-1 default = fixture/unit, NOT a live revoke:**
   - **Default (safe):** feed the poller a **fixture** `webhook_logs` row with `status='queue_failed'`
     in a unit test → assert it alerts. Proves the poller logic with **zero production impact**.
   - **Optional live induction (⚠️ HIGH-RISK / DESTRUCTIVE-REVERSIBLE — requires SEPARATE EXPLICIT
     APPROVAL):** briefly revoke `pgmq_send` EXECUTE, fire one webhook, restore + verify. This
     **breaks real enqueue for the revoke window** (any concurrent webhook fails to queue) — do NOT
     use as the default. Only on an isolated test env or an explicitly-approved, narrowly-timed,
     fully-restored window. **No safer live induction is currently identified** → Phase 1 relies on
     the fixture path; live verification is deferred unless a safer method is found.
3. **Stuck trade:** seed one synthetic `pending`/`unknown` trade backdated > 5 min (WB8 technique) →
   poller alerts → cleanup. *(Gated mutation, separate approval.)*
4. **Worker not running:** stop the dev worker (or pause its Healthchecks ping) → HC fires after the
   grace window → restart.

## 11. Prove the happy path does NOT alert
- Clean baseline (queue 0, DLQ 0, no stuck, worker pinging) → run the poller → assert **zero
  alerts**; Healthchecks stays green.
- A normal fill run (WB9-style single fire) → no DLQ / no queue_failed / no stuck → **no alert**; HC
  green throughout.

## 12. Stop conditions
- Any alert payload contains a **forbidden field** (secret/token/URL/header/body/raw_payload) → STOP,
  do not deploy.
- **Alert storm / flapping** (re-firing every poll) → STOP, fix de-dup/threshold.
- **False negative** (an induced condition didn't alert) → STOP, fix before relying on it.
- Poller credential has **more than read-only** access (any non-SELECT grant) → STOP.
- Heartbeat affects trade processing in any way (blocks/delays/throws) → STOP — it must be fully
  isolated and failure-swallowed.

## 13. Effort
**M (~2–4 days)** — poller (1–3) + gated heartbeat (4) + tests + the induce/verify exercises. A
minimal first cut (Telegram + HC + 3 SQL conditions + payload-safety + heartbeat no-op tests) ≈
**2–3 days**.

## 14. Sequencing vs S4-0.5
Build the **shared read-only-SQL + secret-safe-payload lib once**; then S4-1 (MUST — campaign-
critical "zero silent failures") and S4-0.5 (SHOULD) proceed **in parallel**, S4-1 prioritized.
Neither blocks the other.

---
**Out of scope / explicitly later:** the read-only-role **migration** (gated, separate review) ·
in-worker/DB-trigger immediate emit (Phase 2, lower latency) · Sentry · the live `pgmq_send`-revoke
induction (gated, optional) · `setInterval(60s)` runtime scan (S4-3b) · any LIVE/mainnet alerting.
No code, no migration, no DB/Doppler/Railway change, no arm/fire in S4-1 design.
