# Slice 4C — `pgmq_send` recovery / no-silent-loss (Codex-reviewable packet) — **Rev 2**

**Status:** PLANNING / REVIEW ONLY — no code, no DB mutation, no deploy, no Railway/Doppler, no secrets, no mainnet / no real funds.
**Goal:** a fresh TradingView signal must never be silently lost if `pgmq_send` fails — or if the webhook dies at any point between committing the dedup row and confirming the enqueue. No silent loss; no duplicate executable order; retry-safe idempotency.

This is HARD BLOCKER **B4** from the 4/5 live-tier triage.

> **Rev 2 core principle (Codex CHANGES #1):** **the durable guarantee is OUR own path, not TradingView.**
> ```
> guarantee = webhook_logs row  +  recoverable state  +  worker sweeper  +  worker idempotency
> ```
> Returning **503** on enqueue failure is **defense-in-depth only** (a fast recovery *shortcut* when TV happens to retry). **If TradingView never retries, the system still fully recovers** every `queue_failed` and every stale `accepted` row via the sweeper. No design decision below may depend on a TV retry for correctness.

---

## 1. Current webhook queue path (as-built — grounded in source)

File: [`supabase/functions/webhook/index.ts`](../supabase/functions/webhook/index.ts) (286 lines).

1. Pepper/method/path/rate-limit/bot-lookup/auth/active/body/`signal_id`+`action` gates (lines 98-212). **Every reject returns before the upsert** with a uniform **200** (`ok()`) — deliberate anti-enumeration (header lines 10-15). Genuine infra faults *before the row commit* return **503** (`infra()`).
2. **Dedup anchor — `webhook_logs` upsert** (lines 216-222): `status:"accepted"`, `onConflict:"bot_id,signal_id", ignoreDuplicates:true`, `.select("id")`. Backed by `UNIQUE (bot_id, signal_id)` ([`001:247`](../supabase/migrations/001_initial_schema.sql)). Insert error (row not committed) → **503** (safe to retry).
3. **Duplicate branch 8a** (lines 231-264): 0 rows ⇒ existing row ⇒ `webhook_dedup_skip` audit → **200**. **Does not inspect the existing row's `status`.**
4. **Fresh signal → enqueue 8b** (lines 266-270): `sb.rpc("pgmq_send", { queue_name:"trade_signals", message:{schema_version:"1.0", bot_id, signal_id, side} })`.
5. **`pgmq_send` failure** (lines 272-282): `update … status="queue_failed", rejection_reason="pgmq_send_failed"` → **`return ok()` (200)**.

### The hole (two-fold)
- **A. Silent loss on enqueue failure:** the row is committed as `queue_failed`, the webhook returns **200** (TV never retries), and there is **no sweeper** ("sweeper deferred", line 274) → the signal is recorded but **never executes**.
- **B. Crash-in-window:** the upsert commits `status="accepted"` *before* `pgmq_send`. `accepted` conflates "received" with "queued". If the function dies (or the platform kills it, or the `queue_failed` update itself fails) anywhere between the commit (222) and a successful status write, the row is left `accepted`, was never enqueued, and **nothing recovers it**.
- **C. Dedup-swallow:** a TV retry of any existing row hits branch 8a → **dedup-skip → 200**, `pgmq_send` never re-attempted. So even a naive "return 503" is swallowed on retry.

### Existing schema (grounded)
`webhook_logs`: `id, bot_id, signal_id, raw_payload jsonb, source_ip, status webhook_log_status, rejection_reason text, received_at timestamptz DEFAULT now()`, `UNIQUE(bot_id,signal_id)` ([`001:237-248`](../supabase/migrations/001_initial_schema.sql)). **No `updated_at`.** `raw_payload` is documented safe ("TradingView payloads never contain secrets", `001:256`). Enum = `{accepted, rejected}` (`001:70`) + `queue_failed` (`003:13`). `rejected` is **never written by this function** (all rejects short-circuit before the upsert) — it is effectively vestigial in the ingest path. Grants: service_role has `insert, update` on `webhook_logs` (`008`).

### Worker idempotency — THE SAFETY FOUNDATION (grounded, unchanged by 4C)
Worker dedups on the **same** `(bot_id, signal_id)` ([`worker/src/index.ts:39`](../worker/src/index.ts); step 3, lines 694-733):
```ts
const { data: existingTrade } = await supabase.from('trades')
  .select('id, status').eq('bot_id', bot_id).eq('signal_id', signal_id).maybeSingle();
if (existingTrade) { /* terminal → 'duplicate_signal' → ack; 'unknown' → recon_job → ack */ return { ack: true }; }
```
plus the `23505` race guard on the `trades` INSERT (header line 77) and `CONSTRAINT trades_bot_signal_unique UNIQUE (bot_id, signal_id)` on `trades` ([`001:286`](../supabase/migrations/001_initial_schema.sql)). **A duplicate queue message for the same `signal_id` can NEVER create a second order.** Every re-enqueue path in this packet rests on this — re-enqueue is *always* duplicate-order-safe.

### Sweeper host (grounded)
The worker already runs a **periodic reconciliation loop (`setInterval` ~60s)** ([`worker/src/index.ts` header line 109](../worker/src/index.ts); `resolvePendingReconciliations`), running regardless of `QUEUE_ENABLED`. The worker is a **singleton** on Railway. This loop is the sweeper's home.

---

## 2. Desired behavior

1. Never return success unless the signal is **durably queued (`queued`)** OR **durably recoverable** (a non-`queued`/non-`rejected` row the sweeper will re-enqueue).
2. **No silent loss** — *any* row not in `queued`/`rejected` is on a recovery path. This holds even when our own status-update writes fail (covered by the stale-`accepted` catch-all, §3.3).
3. **No duplicate executable order** — guaranteed by worker `UNIQUE(bot_id, signal_id)` idempotency; re-enqueue is always safe.
4. **Retry-safe idempotency** — a re-delivery (TV or sweeper) of a not-yet-`queued` signal re-attempts enqueue; of a `queued` signal, dedups cleanly.
5. **No direct exchange call from the webhook** (unchanged — webhook has zero exchange code).

---

## 3. Recommended design

### 3.1 State machine (exact — Codex CHANGES #2)
`webhook_log_status`: `accepted | queued(NEW) | queue_failed | rejected`.

**Ingest (fresh signal):**
| step | transition |
|---|---|
| upsert | *(none)* → `accepted` (row committed; enqueue not yet confirmed) |
| `pgmq_send` success | `accepted` → **`queued`** (terminal success) |
| `pgmq_send` failure | `accepted` → **`queue_failed`** (`rejection_reason='pgmq_send_failed'`, `next_retry_at=now()+backoff(0)`) |

**Duplicate re-delivery (branch 8a — reads existing `status`, `received_at`, `requeue_attempts`):**
| existing status | action | response |
|---|---|---|
| `queued` | dedup-skip audit; **no enqueue** | **200** (idempotent success) |
| `rejected` | terminal; **no enqueue** | **200** |
| `queue_failed` | **re-attempt `pgmq_send`** (subject to §3.4 attempt cap) | success → `queued` + **200**; fail → `queue_failed` + **503** |
| `accepted`, **stale** (`received_at < now()-N`) | crash-window candidate → **re-attempt `pgmq_send`** | success → `queued` + **200**; fail → `queue_failed` + **503** |
| `accepted`, **fresh** (`received_at ≥ now()-N`) | **do not race** the in-flight original; **do not enqueue** | **503** retryable (honest "not yet durably queued"; the original request or the sweeper resolves it — see §3.3) |

Rationale for fresh-`accepted` → 503 (not 200): the row is not confirmed `queued`, so returning success would violate desired-behavior #1. Not re-enqueuing avoids a needless double-send while the original request is still in flight. Correctness does **not** depend on the 503 being retried — if it isn't, the original request completes the transition, and if the original crashed, the row goes stale and the sweeper catches it.

### 3.2 Webhook code changes (two edits, `supabase/functions/webhook/index.ts`)
- **8b:** on success → `update … status='queued'`; on failure → `update … status='queue_failed', rejection_reason='pgmq_send_failed', next_retry_at=now()` → `infra()` (**503**).
- **8a:** extend the existing existing-row fetch (lines 232-237 already select the row) to include `status, received_at, requeue_attempts`; branch per the table above. The re-enqueue helper is shared with 8b.

### 3.3 Stale-`accepted` threshold N (Codex CHANGES #3)
- **N = 60 seconds**, keyed off `received_at` (no `updated_at` needed — a row's `accepted` lifetime is the single request).
- **Justification:** the `accepted → queued/queue_failed` transition is one `pgmq_send` RPC + one `UPDATE`, **sub-second** in the normal case. A Supabase Edge Function invocation cannot keep a row `accepted` for 60s (the enqueue path finishes far faster; even a slow/timed-out invocation is well under a minute for this path). Therefore an `accepted` row with `received_at` older than **60s cannot be a live in-flight request** — it is a crash/kill/failed-status-write casualty and is safe to re-enqueue (worker dedups). N=60s also aligns with the ~60s sweeper tick, so a row becomes eligible ~one tick after it goes stale.
- **This stale-`accepted` sweep is the ultimate catch-all:** it recovers the row *regardless of why* it isn't `queued` — including the cases where we could not even record `queue_failed` (failure-window C, §5 test 15). That is what makes the guarantee independent of our own follow-up writes succeeding.

### 3.4 Recovery sweeper (worker, in the ~60s loop) — concurrency-safe + bounded
**Eligibility (the recovery set):**
```sql
status = 'queue_failed'                                   -- explicit failures, backoff-gated
   OR ( status = 'accepted' AND received_at < now() - interval '60 seconds' )  -- crash-window
```
excluding rows past the attempt cap (below).

**Concurrency-safe claim (Codex CHANGES #4).** Current reality = **single worker**, so there is no self-concurrency. But we do NOT rely on that alone — the webhook dedup-branch re-enqueue can race the sweeper, and a future second worker must be safe. Mechanism = **atomic lease claim**, one of:
- **(recommended)** a `claim_webhook_requeue(batch int)` **RPC** doing `SELECT … FOR UPDATE SKIP LOCKED LIMIT batch` then setting `next_retry_at = now() + lease_interval` and `requeue_attempts = requeue_attempts + 1`, returning the claimed rows. `SKIP LOCKED` guarantees two concurrent claimers never take the same row; the lease hides a claimed row from the next tick until `lease_interval` passes.
- **or** a plain atomic `UPDATE webhook_logs SET next_retry_at = now()+lease, requeue_attempts = requeue_attempts+1 WHERE <eligible> AND (next_retry_at IS NULL OR next_retry_at <= now()) RETURNING bot_id, signal_id, raw_payload->>'action' AS side` (claim-by-update; the `WHERE next_retry_at<=now()` predicate is the guard).

The claim does **not** set `queued` — status flips to `queued` only *after* a confirmed `pgmq_send`. **Ultimate backstop:** even if two paths both re-enqueue the same row (lease expiry race, or webhook + sweeper), the worker collapses the duplicate to one trade (§1). So exactly-once is a *nicety*; the claim exists to bound work and avoid thrash, not for safety.

**Per-row sweep step:** for each claimed row → `pgmq_send({schema_version:'1.0', bot_id, signal_id, side})` → success: `UPDATE status='queued'`; failure: `UPDATE next_retry_at = now()+backoff(requeue_attempts), last_requeue_error=<sanitized class/code>` (stays `queue_failed`); emit metric.

**Bounded retry policy (Codex CHANGES #6):**
- `MAX_REQUEUE_ATTEMPTS = 5`.
- **Backoff** = exponential on `requeue_attempts`: `next_retry_at = now() + least(2^attempts, 300) seconds` (1m cap-ish: 1s,2s,4s,8s,16s… capped 300s). Gate eligibility on `next_retry_at <= now()`.
- **Final state after cap:** row **stays `queue_failed`** but is **excluded from the eligible set** by `requeue_attempts < MAX_REQUEUE_ATTEMPTS`. It is **NOT dropped, NOT deleted, NOT flipped to a terminal "give-up" that hides it.** The row remains queryable/observable forever.
- **Alert / DLQ:** on reaching the cap, emit a **loud** `webhook_requeue_exhausted` alert (bot_id, signal_id, attempts, sanitized last error) for human triage. No silent drop. (A dedicated DLQ table is optional; the exhausted `queue_failed` rows are themselves the durable dead-letter set, queryable by `requeue_attempts >= MAX`.)
- **Flag-gated:** `WEBHOOK_REQUEUE_SWEEPER_ENABLED` (default **false**) for a dark launch; `WEBHOOK_REQUEUE_BATCH` (e.g. 50), plus the constants above.

### 3.5 Response rules (exact — Codex CHANGES #7)
| Case | Response | Why |
|---|---|---|
| First signal + enqueue success | **200** | durably `queued` |
| First signal + enqueue fail | **503** | not queued; TV *may* retry (defense-in-depth); sweeper guarantees recovery |
| Infra fault **before** row commit | **503** | unchanged; safe to retry |
| Duplicate of `queued` | **200** | idempotent success, no enqueue |
| Duplicate of `queue_failed` | re-enqueue → **200** if success, **503** if fail | breaks dedup-swallow; still recoverable via sweeper |
| Duplicate of **stale** `accepted` | re-enqueue → **200**/**503** per result | crash-window recovery |
| Duplicate of **fresh** `accepted` | **503** retryable | not yet queued; don't race the in-flight original |
| Duplicate of `rejected` | **200** | terminal, no enqueue |
| Business reject (inactive/bad-token/invalid body/rate-limit) | **200** | unchanged anti-enumeration policy (never write `rejected`, never enqueue) |

`rejected` response question resolved: business rejects keep the **uniform 200** (no 4xx) to avoid leaking bot existence/validity/structure to attackers — the long-standing WB5 policy (header lines 10-15). 4xx would be an enumeration oracle. Rejects never reach the enqueue path.

---

## 4. Migration shape (precise — Codex CHANGES #5)

**Postgres enum constraint (must respect):** on Supabase (PG15) `ALTER TYPE … ADD VALUE` **can** run inside a transaction, **but the new value cannot be *used*** (in DML, an index predicate, a default, or a CHECK) **until the adding transaction commits.** Migration 003 set the precedent (`ADD VALUE IF NOT EXISTS 'queue_failed'`). Therefore split:

**Migration 024 — enum only (standalone, references `queued` nowhere):**
```sql
ALTER TYPE webhook_log_status ADD VALUE IF NOT EXISTS 'queued';
```

**Migration 025 — columns + recovery index (separate migration, after 024 commits):**
```sql
ALTER TABLE public.webhook_logs
  ADD COLUMN IF NOT EXISTS requeue_attempts   smallint    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at      timestamptz,          -- null = eligible now
  ADD COLUMN IF NOT EXISTS last_requeue_error text;                 -- SANITIZED: class/code only

-- Recovery index. Predicate uses only pre-existing enum values (safe; does not reference 'queued').
CREATE INDEX IF NOT EXISTS webhook_logs_recovery_idx
  ON public.webhook_logs (next_retry_at)
  WHERE status IN ('queue_failed', 'accepted');

-- The table comment says "write-once, never mutated"; status transitions already mutate it.
COMMENT ON TABLE public.webhook_logs IS
  'Signal ingestion log. Status transitions (accepted->queued/queue_failed, sweeper requeue) are the only mutations; payload write-once.';
```
Notes: `last_requeue_error` stores a **sanitized** error class/code only — never a driver message, URL, payload, or secret. `received_at` (existing) is the staleness clock; no `updated_at` needed. If the claim RPC (`claim_webhook_requeue`) is chosen (§3.4), it is defined in migration 025 as well (SECURITY DEFINER, service_role only).

**Open decision (see §7):** claim RPC vs claim-by-`UPDATE…RETURNING`; and whether to persist a `side` column at ingest vs derive `side` from `raw_payload->>'action'` in the sweeper (the webhook validated `action ∈ {buy,sell}` before commit, so derivation is safe).

---

## 5. Tests (all LOCAL; no network, no secrets)

**Webhook (Deno `node:test`; mock supabase client + `pgmq_send`):**
1. enqueue success ⇒ row `queued` + **200**.
2. enqueue failure ⇒ row `queue_failed` (`pgmq_send_failed`, `next_retry_at` set) + **503**.
3. **Retry after `queue_failed` re-enqueues (not dedup-drop):** existing `queue_failed` → `pgmq_send` re-called → success ⇒ `queued`+200; fail ⇒ `queue_failed`+503.
4. **Stale `accepted` re-enqueues:** existing `accepted`, `received_at` older than N ⇒ re-enqueue attempted.
5. **Fresh `accepted` does not race:** existing `accepted`, `received_at` within N ⇒ **no enqueue**, **503** retryable.
6. **Duplicate of `queued` dedups safely:** existing `queued` ⇒ dedup-skip audit + 200, **`pgmq_send` NOT called**.
7. Duplicate of `rejected` ⇒ 200, no enqueue.
8. **No direct exchange call from the webhook** — module imports/constructs no exchange client, makes no exchange HTTP call (static + behavioral).
9. Infra error before row commit still ⇒ 503 (regression guard).

**Duplicate-order safety (Codex CHANGES #8 — worker jest; some already exist, cite + add):**
10. Two identical queue messages for the same `(bot_id, signal_id)` ⇒ **exactly one trade** created.
11. Second worker processing of a duplicate ⇒ `duplicate_signal`/ack, **no order** ([`worker/src/index.ts:723-732`](../worker/src/index.ts)).
12. **Re-enqueue after `queue_failed` ⇒ no second executable trade** (drive the worker twice with the same signal; assert one `createOrder`).

**Failure-window tests (Codex CHANGES #9 — expected recovery defined):**
13. **Crash after `accepted`, before `pgmq_send`** (row `accepted`, no enqueue): after N, sweeper claims + enqueues ⇒ `queued`; worker makes ≤1 trade. *Expected: recovered.*
14. **`pgmq_send` succeeds but the `status='queued'` UPDATE fails** (row stuck `accepted`, message already in queue): after N, sweeper re-enqueues ⇒ **duplicate queue message** ⇒ worker dedups ⇒ **one trade**; a later status write flips to `queued`. *Expected: recovered, no duplicate order.*
15. **`pgmq_send` fails AND the `status='queue_failed'` UPDATE fails** (row stuck `accepted`, nothing enqueued, no failure recorded): the **stale-`accepted` catch-all** re-enqueues after N ⇒ `queued`. *Expected: recovered — this is the case that proves the guarantee does not depend on our own follow-up writes.*

**Sweeper (worker jest; mock supabase + `pgmq_send`):**
16. `queue_failed` eligible ⇒ claimed once ⇒ `pgmq_send` ⇒ success ⇒ `queued`.
17. **Concurrency:** two concurrent claim calls over the same eligible set ⇒ each row claimed by at most one (SKIP LOCKED / lease guard); no row double-processed within a lease.
18. **Bounded:** persistent failure increments `requeue_attempts` with backoff (`next_retry_at` advances); at `MAX_REQUEUE_ATTEMPTS` the row is **excluded** from eligibility and emits `webhook_requeue_exhausted`; it is **not** dropped/deleted.
19. Fresh `accepted` (age < N) is **not** swept; stale `accepted` (age ≥ N) **is**.
20. Sweeper makes **no exchange call**, touches no secret, and logs no token/payload.

---

## 6. Observability / evidence (Codex CHANGES #10)

- **Counts** (structured logs / a status rollup query): `accepted`, `queued`, `queue_failed`, `recovered` (queue_failed/stale→queued by sweeper), `max_attempts_exceeded` (`requeue_attempts >= MAX`). A single `SELECT status, count(*) … GROUP BY status` + a `requeue_attempts >= MAX` count is the evidence read-back.
- **Per-event logs:** `webhook_accepted`, `webhook_queued`, `webhook_queue_failed`, `webhook_requeued` (sweeper success), `webhook_requeue_failed`, `webhook_requeue_exhausted`. Each carries `bot_id`, `signal_id`, `requeue_attempts` — **never** the token, pepper, full URL, stored hash, `vault_secret_id`, or `raw_payload`. Errors are sanitized to class/code (matches existing `safeExchangeDetail` doctrine + `last_requeue_error` column).
- `bot_id`/`signal_id` are explicitly allowed in logs (already logged today). `raw_payload` is documented non-secret but is still **not** dumped to logs wholesale (only `->>'action'` is read, in-DB, for `side`).

---

## 7. Rollout (staged; Codex CHANGES #11 — mirrors A8-H3 discipline)

1. **LOCAL only:** author migrations 024 + 025 + webhook edits + sweeper + claim RPC; run Deno webhook tests + worker jest + `supabase db reset` through 025 with LOCAL fixtures (incl. the three failure-window cases + concurrency). **Stop for Codex review with the diff. No push until PASS.**
2. **Migration only (linked):** operator runs `supabase db query --linked --file` for **024** (enum), then **025** (columns/index/RPC) — surgical, **never `db push`**, two separate applies (enum committed before use). Claude read-backs only (`enumsortorder` shows `queued`; columns/index/RPC exist; `migration list --linked` Local==Remote). Then reviewed metadata tracking rows (A2 discipline).
3. **Webhook logic:** deploy the webhook with the new states/response rules; behavior is safe on its own (worst case identical to today for `queued` rows). Sweeper still **OFF**.
4. **Sweeper disabled by flag:** deploy the worker with `WEBHOOK_REQUEUE_SWEEPER_ENABLED=false`.
5. **Enable sweeper on testnet:** flip the flag on testnet only.
6. **Inject failure + verify recovery (testnet):** fire a signal with pgmq healthy → row `queued`, 200; inject a `pgmq_send` failure → row `queue_failed`, 503; confirm the sweeper flips it to `queued`; force a stuck `accepted` (skip the status write) → confirm stale-sweep recovers it after N; confirm the worker produced **exactly one trade** per `signal_id` (read-back `trades`); confirm `webhook_requeue_exhausted` fires only after `MAX` attempts. No kill/arm/secret/mainnet.
7. **Only later:** consider prod. **No mainnet in 4C.**
- **Rollback:** sweeper flag OFF (instant). Migration 024 `ADD VALUE` is additive/irreversible but benign (old code never writes `queued`). 025 columns/index/RPC are `DROP`-able. Webhook reverts by redeploying the prior function. No data migration to undo.

---

## 8. Stop conditions (any ⇒ STOP, do not implement)

- Any design that leaves a committed row **neither `queued`/`rejected` nor in the recovery set** (silent loss) — including any reliance on a TradingView retry for correctness, or any path where a failed status write hides a not-enqueued row (the stale-`accepted` catch-all must cover it).
- Any design that can create a **duplicate executable order** (i.e. that does not rest on worker `UNIQUE(bot_id, signal_id)` idempotency, or introduces a new order path bypassing it).
- Any **direct exchange call in the webhook**.
- Any token/pepper/full-URL/stored-hash/`vault_secret_id`/`raw_payload` printed to logs/errors/audit; any unsanitized driver error persisted in `last_requeue_error`.
- Any **silent drop** at the attempt cap (must stay observable + alert).
- Any mainnet action / real-funds path; `db push`; unreviewed metadata mutation; using the new enum value in the same transaction that adds it.

---

## Rev 2 summary (Codex CHANGES #12)

- **Files changed:** `supabase/migrations/024_webhook_status_queued.sql` (enum) + `025_webhook_requeue_recovery.sql` (columns/index/claim RPC); `supabase/functions/webhook/index.ts` (8b states/response, 8a status-aware re-enqueue); `worker/src/` new `webhook-requeue-sweeper.ts` + wire into the ~60s loop (flag-gated); tests in webhook (Deno) + worker (jest).
- **Exact state machine:** `accepted → queued` (enqueue ok) / `accepted → queue_failed` (enqueue fail) / dedup: `queued`→200, `rejected`→200, `queue_failed`→re-enqueue, stale-`accepted`→re-enqueue, fresh-`accepted`→503-no-enqueue. (§3.1 tables.)
- **Migration shape:** 024 `ADD VALUE 'queued'` standalone (enum-use-after-commit rule); 025 `requeue_attempts`, `next_retry_at`, `last_requeue_error` + partial recovery index + claim RPC.
- **Retry policy:** MAX 5 attempts, exponential backoff via `next_retry_at` (cap ~300s), terminal = observable `queue_failed` excluded by `attempts>=MAX` + `webhook_requeue_exhausted` alert; **no silent drop**.
- **Guarantee:** `webhook_logs row + recoverable state + sweeper + worker idempotency` — **independent of TradingView**; 503 is defense-in-depth only.
- **Tests required:** §5 items 1-20 (webhook states/responses, duplicate-order safety, three failure-window cases, sweeper concurrency + bounded + staleness + no-exchange).
- **Open decisions:** (a) claim RPC (`FOR UPDATE SKIP LOCKED`) vs claim-by-`UPDATE…RETURNING`; (b) persist `side` column at ingest vs derive from `raw_payload->>'action'`; (c) stale threshold N=60s (proposed, justified) — confirm; (d) DLQ shape — a `trades_dlq` table already exists ([`001:339`](../supabase/migrations/001_initial_schema.sql)) but is **trade-processing** scoped (keyed on `trade_id`), not webhook-ingest; so webhook dead-letters use `requeue_attempts>=MAX` `queue_failed` rows as the durable dead-letter set (queryable), or, if a table is preferred, a new webhook-scoped DLQ — confirm.
- **Confirmation:** planning only — no code, no DB mutation, no deploy, no Railway/Doppler, no secrets, no mainnet / no real funds.

*Prepared for Codex review at Oren request.*
