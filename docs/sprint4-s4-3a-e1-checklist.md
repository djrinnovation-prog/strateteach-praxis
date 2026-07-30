# S4-3a — Gated E1 Execution Checklist (boot reconciliation resolver)

**Status:** PLANNING / DOC ONLY. Nothing seeded, restarted, or run. Every DB write / restart below is GATED and requires explicit operator approval at the moment. The agent does NOT mutate the DB, restart the worker, change Doppler/Railway, or arm/fire. **Migration 009 frozen.** Source runbook: `docs/sprint4-s4-3a-reconciliation-resolution-runbook.md`.

**Decision: B2.** This E1 proves the **failed-path only** (Seed A: OrderNotFound → failed), with exact-baseline cleanup. The **filled-path (`unknown → filled`) is carried forward to S4-2** (real campaign fills). We do NOT flip an existing filled trade (B1) in this E1.

Resolver under test: `worker/src/reconciliation.ts` (`resolvePendingReconciliations` → `resolveStuckTrade`), wired into boot (`worker/src/index.ts`), committed `653417d`. It calls `fetchOrder` ONLY (never `createOrder`).

---

## 1. RUN_ID format
`S4-3A-E1-YYYYMMDD-HHMM` (UTC). Example: `S4-3A-E1-20260623-1015`.
Every seeded `trades` row carries the RUN_ID in **`signal_id`**, and a recognizable RUN_ID-derived **`client_order_id`** (`PRX_` prefix). One RUN_ID per E1 attempt.

---

## 2. Read-only baseline (capture BEFORE anything; reference for cleanup)
```sql
-- (a) stuck-eligible (the exact resolver selector)
SELECT count(*)::int AS stuck_eligible
FROM public.trades
WHERE status IN ('pending','unknown') AND created_at < now() - make_interval(secs => 60) AND deleted_at IS NULL;

-- (b) the stuck-eligible rows (non-secret ids) — must be the ONLY ones the resolver would touch
SELECT id, signal_id, status, client_order_id, trading_pair, created_at
FROM public.trades
WHERE status IN ('pending','unknown') AND created_at < now() - make_interval(secs => 60) AND deleted_at IS NULL
ORDER BY created_at;

-- (c) pending reconciliation_jobs
SELECT count(*)::int AS pending_jobs FROM public.reconciliation_jobs WHERE status='pending';

-- (d) RUN_ID must not pre-exist
SELECT count(*)::int AS run_id_rows FROM public.trades WHERE signal_id = '<RUN_ID>';
```
EXPECT at baseline: (a)=0, (b)=none, (c)=0, (d)=0. (Confirmed clean on 2026-06-23.) If (a)/(b) is non-zero, STOP and investigate — the resolver would also act on those (bounded by cap=10), which is out of E1 scope.

---

## 3. Seed design (B2 — Seed A only; all rows RUN_ID-scoped, reversible)
### Seed A — OrderNotFound → failed (the ONLY seed this E1)
A fresh `unknown` trade with a **non-existent** `client_order_id` → real `fetchOrder` → Binance `OrderNotFound` → `null` → trade `failed`, job resolved (resolution NULL + notes). No real order placed, no arm/fire, fully RUN_ID-scoped, exact-baseline cleanup.
```sql
INSERT INTO public.trades (bot_id, user_id, signal_id, client_order_id, side, trading_pair, quantity, status, created_at)
VALUES (
  '<BOT_ID>',                                                  -- a bot whose credential is 'valid' (e.g. the WB6 test bot)
  (SELECT user_id FROM public.bots WHERE id = '<BOT_ID>'),     -- denormalized user_id from the bot
  '<RUN_ID>',                                                  -- signal_id carries the RUN_ID
  'PRX_<RUN_ID-suffix>',                                       -- e.g. PRX_E1NX0623 — MUST be globally unique AND not a real Binance order
  'buy', 'BTCUSDT', 0.00008, 'unknown',
  now() - interval '2 minutes'                                 -- backdate >60s so it is stuck-eligible immediately
);
```

### Filled-path (`unknown → filled`) — DEFERRED TO S4-2 (B2; B1 REJECTED)
`trades.client_order_id` is **UNIQUE**, so we cannot insert a fresh trade reusing a real filled order's `client_order_id` (it would collide with the existing real trade). Decision: **the filled-path is NOT proven in this E1; it is carried forward to S4-2**, where real campaign fills occur naturally and an `unknown` can be induced on a fresh campaign order. This keeps the S4-3a E1 perfectly reversible (Seed A only) and avoids mutating any existing evidence row.

**B1 (flip an existing `filled` trade → `unknown`) is REJECTED for this E1** — it would change a real evidence row's `updated_at`, add an append-only `audit_logs` row, and is not exact-baseline. B1 (or any other clean filled-path proof) requires a **SEPARATE explicit approval**; do NOT flip an existing filled trade here.

---

## 4. Safety gates BEFORE seed (all must hold)
- [ ] RUN_ID chosen + recorded; baseline §2 captured; (a)=0, (b)=none, (c)=0, (d)=0.
- [ ] `QUEUE_ENABLED=false` confirmed in the worker env (no trading). Do NOT set it true.
- [ ] Seed A `client_order_id` is **unique** (not in `trades`) AND deliberately bogus (not a real Binance order id).
- [ ] `<BOT_ID>`'s credential is `status='valid'` and not deleted (so the resolver can build an adapter): `SELECT c.status, c.deleted_at FROM bots b JOIN user_exchange_credentials c ON c.id=b.credential_id WHERE b.id='<BOT_ID>';` → valid / null.
- [ ] Confirm this E1 places NO orders: resolver is `fetchOrder`-only; no `createOrder`, no queue arm.
- [ ] Seed is RUN_ID-attributable (`signal_id='<RUN_ID>'`). No existing trade is flipped (B1 not used).

---

## 5. Restart gate (`QUEUE_ENABLED=false`)
- [ ] Re-run baseline §2(a)/(b) immediately before restart → ONLY the RUN_ID seed is stuck-eligible (no other stuck rows crept in).
- [ ] Confirm worker env `QUEUE_ENABLED=false` (Doppler/Railway) — read-only confirm; do NOT change to true.
- [ ] Restart the worker instance running `653417d` (Railway restart/redeploy OR a local run of the same SHA). Boot path: `validateEnv` → `runBootReconciliation` (creates the job for the seed) → `resolvePendingReconciliations` (resolves it). No poll loop (queue disabled).
- [ ] Do NOT arm/fire; do NOT enable the queue; do NOT change any other env.

---

## 6. Expected logs + DB state
**Logs (boot, structured):**
- `worker_starting … queue_enabled:false`
- `boot_reconciliation_complete stuck_count:1` (the seed)
- `reconciliation_job_created trade_id:<seed>`
- `reconciliation_resolve_start {eligible:1, processing:1, deferred:0}`
- `reconciliation_resolved {resolved_status:"failed", action:"resolved_failed"}`
- `reconciliation_resolve_complete {total:1, resolved:1}`
- **MUST NOT appear:** any `trade_executed`, order-placement, or `createOrder` activity; any `reconciliation_job_orphaned` (would mean a partial failure).

**DB (post-boot, pre-cleanup) — read-only verify:**
- Seed A trade → `status='failed'`, `error_reason='order_not_found'`, `updated_at` set.
- Seed A reconciliation_job → `status='resolved'`, `resolution IS NULL`, `notes='order_not_found'`, `resolved_at` set.
- `audit_logs` → one `trade.failed` row for Seed A (append-only).
```sql
SELECT id, status, error_reason, updated_at FROM public.trades WHERE signal_id='<RUN_ID>';
SELECT trade_id, status, resolution, notes, resolved_at FROM public.reconciliation_jobs
  WHERE trade_id IN (SELECT id FROM public.trades WHERE signal_id='<RUN_ID>');
-- zero new exchange orders: confirmed by the absence of createOrder/trade_executed logs (resolver is fetchOrder-only)
```

---

## 7. Cleanup (RUN_ID-scoped) + baseline verification
FK `reconciliation_jobs.trade_id → trades(id)` is `ON DELETE RESTRICT`, so delete the job BEFORE the trade.
```sql
BEGIN;
  DELETE FROM public.reconciliation_jobs
    WHERE trade_id IN (SELECT id FROM public.trades WHERE signal_id = '<RUN_ID>');
  DELETE FROM public.trades WHERE signal_id = '<RUN_ID>';
  -- review the row counts below INSIDE the tx; COMMIT only if exactly the RUN_ID rows were removed.
COMMIT;
```
**Verify return to baseline (read-only, after COMMIT):**
- §2(a) stuck_eligible == pre-seed (0); §2(c) pending_jobs == pre-seed; §2(d) run_id_rows == 0.
- Note (documented, not a failure): `audit_logs` retains the append-only `trade.failed` row for the seed (identifiable by `entity_id`); the runbook scopes cleanup to `trades` + `reconciliation_jobs`.

---

## 8. Stop conditions (abort; leave clean)
- Any `createOrder` / order placement / `trade_executed` log during the E1 → ABORT immediately (the resolver must never place an order).
- `QUEUE_ENABLED` observed `true` at any point, or any move to arm/enable the queue → ABORT.
- The bogus Seed-A `client_order_id` unexpectedly resolves to `filled`/`submitted` (i.e. it matched a real order) → STOP, investigate before cleanup.
- A `reconciliation_job_orphaned` log (partial failure: terminal trade but job not resolved) → STOP, repair the orphaned job before cleanup.
- The resolver touches a trade NOT in the RUN_ID set (an unexpected stuck row appeared) → STOP; do not proceed; investigate.
- Cleanup scope ambiguous (RUN_ID not matchable) OR post-cleanup state ≠ recorded baseline → HALT; never broad-delete to "fix" it.
- Any flip of an existing filled trade (B1) without a separate explicit approval → forbidden in this E1.
- Any egress/credential/auth anomaly (cf. WB6 451) → STOP, diagnose the path, loosen nothing.
- Any Doppler/Railway change beyond the gated restart, any arm/fire, any touch of Migration 009 → forbidden.

---

## 9. Definition of Done (this E1 — SPLIT PROOF)
- **Seed A (failed-path):** `unknown → failed` (OrderNotFound) proven end-to-end at real boot, zero new orders, RUN_ID-scoped seed removed, `trades`/`reconciliation_jobs` back to baseline.
- **Filled-path (`unknown → filled`): NOT proven here — carried forward to S4-2** (real campaign fills). A clean filled-path proof (B1 or otherwise) needs a separate explicit approval.
- Evidence report captured (RUN_ID, seed transition, fetchOrder outcome, createOrder-call-count = 0, seed removed, baseline restored).
- **S4-3a is NOT fully Done from Seed A alone.** After a passing Seed A, the S4-3a status is **`failed-path E1 passed; filled-path deferred to S4-2`** (a split/partial E1-proof). S4-3a closes only once the filled-path is also proven (under S4-2, or via a separately-approved clean proof). **S4-3b runtime `setInterval(60s)` scan remains deferred.**
