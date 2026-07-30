# S4-3a — fetchOrder / Reconciliation Resolution Runbook

**Status:** DESIGN / DOC ONLY. No code written, nothing run, nothing armed.
**Goal:** resolve the `reconciliation_jobs` that boot reconciliation creates — turn a stuck `pending`/`unknown` trade into its **true terminal status** (`filled`/`failed`/`cancelled`) by calling **`fetchOrder`** (a read-only exchange lookup), updating the trade + the reconciliation job idempotently. This fills the WB8 gap (WB8 proved *detection + job creation + idempotency*, **not** resolution).
**Core safety invariant:** resolution is **READ-ONLY on the exchange** — it calls **`fetchOrder` ONLY, NEVER `createOrder`**. The resolver can never place, re-place, or duplicate an order. (This is what makes deferring the runtime scan safe.)
**Gate:** building is a separate approved code step; any run that calls the exchange with real credentials, or seeds/cleans DB rows, is gated (explicit approval at the moment). **No arm/fire. Migration 009 frozen.**

---

## 0. Scope
**In scope (S4-3a):** the resolution *logic* (`fetchOrder` → terminal status) + wiring it into **boot reconciliation** so jobs are resolved at startup, with tests + a gated E1.
**Out of scope (deferred):** the runtime `setInterval(60s)` scan (**S4-3b**) — S4-3a builds the resolver; S4-3b later calls it on a timer. Also out: any new order placement, Step-0b idempotency redesign, Migration 009.

---

## 1. Current state (what exists vs the gap)
- **`runBootReconciliation(supabase)`** (`worker/src/index.ts`): finds trades `status IN ('pending','unknown')`, `created_at < now()-60s`, `deleted_at IS NULL`; **UPSERTs `reconciliation_jobs(trade_id)`** (status default `pending`). It **creates the handoff but does NOT resolve** — jobs sit `pending`. *(WB8 proved this.)*
- **Inline Branch-3** (`processMessage`): already resolves a `createOrder` timeout in real time via `fetchOrder` (`filled|submitted|cancelled|failed`, or `null`→failed, or transient→`unknown`+job). The **deferred/boot path has no resolver** — that's the S4-3a gap.
- **`BinanceAdapter.fetchOrder({ clientOrderId?, exchangeOrderId?, symbol })`** → `Order | null`. `null` = `OrderNotFound`. Throws `ExchangeAuthError` / `ExchangeTimeoutError` / `ExchangeUnavailableError`. `Order.status ∈ {submitted, filled, failed, cancelled, unknown}` (never `pending`).
- Enums: `trade_status {pending, submitted, filled, failed, cancelled, unknown}`; `reconciliation_status {pending, resolved, failed}`; `reconciliation_resolution {filled, cancelled, unknown}` *(note: no `failed` — see §4 decision)*.

---

## 2. Identifier choice for `fetchOrder`
- Use **`clientOrderId`** (`trades.client_order_id`, `PRX_<nanoid(10)>`) → adapter's `origClientOrderId` path. It is **always present** on every trade row.
- `exchange_order_id` is **nullable** (null when `createOrder` timed out before returning an id, or when the worker crashed pre-call), so it is **not** reliable for the stuck cases — prefer `clientOrderId`. Pass `exchangeOrderId` only as an optional fast-path when present.

---

## 3. Resolver design (`resolveStuckTrade`)
A new function (in `worker/tools/...` or `worker/src` — see §7), **DI-first** (adapter + supabase injected) and pure-ish:
```
resolveStuckTrade(trade, adapter, supabase, ctx):
  1. Guard: only act if trade.status ∈ {pending, unknown}. (else no-op; already terminal)
  2. order = adapter.fetchOrder({ clientOrderId: trade.client_order_id, symbol: trade.trading_pair })
        (READ-ONLY; never createOrder)
  3. Map outcome (§4) → desiredTradeStatus + reconResolution + reconStatus + notes
  4. Conditional UPDATE trades SET status=desired, ... WHERE id=trade.id AND status IN ('pending','unknown')
        (idempotent + race-safe vs the inline path; 0 rows updated = already resolved → no-op)
  5. UPDATE reconciliation_jobs SET status=reconStatus, resolution=reconResolution, notes=..., resolved_at=now()
        WHERE trade_id=trade.id AND status='pending'
  6. insertAuditLog(trade.<newstatus>) ; structured log (no secrets)
```
Never writes any table other than `trades`, `reconciliation_jobs`, `audit_logs`. Never calls `createOrder`. Bounded per-boot cap (e.g. process at most N jobs per boot; log the remainder).

---

## 4. Outcome mapping (`fetchOrder` result → state)
| `fetchOrder` result | trade.status → | reconciliation_jobs | notes |
|---|---|---|---|
| `Order.status = filled` | **filled** | status=`resolved`, resolution=`filled`, resolved_at | terminal ✅ |
| `Order.status = cancelled` | **cancelled** | status=`resolved`, resolution=`cancelled` | terminal |
| `Order.status = failed` (rejected/expired) | **failed** | status=`resolved`, resolution=`NULL` + notes=`order_failed` | see enum decision |
| `Order.status = submitted` (open) | **submitted** | **stays `pending`** (note: open on exchange) | not terminal → re-check next cycle (S4-3b) |
| `Order.status = unknown` | leave **unknown** | stays `pending`, notes=`exchange_unknown` | rare; retry |
| `null` (OrderNotFound) | **failed** | status=`resolved`, resolution=`NULL` + notes=`order_not_found` | order never reached exchange |
| throws `ExchangeTimeoutError` / `ExchangeUnavailableError` | **unchanged** | stays `pending` | transient → safe retry, no DB change to trade |
| throws `ExchangeAuthError` | **unchanged** | status=`failed`, notes=`auth_error` | credential problem → triage/alert; do NOT silently resolve |

**Enum decision — DEFAULT SET:** `reconciliation_resolution` has no `failed` value. **The first implementation uses Option (b): `resolution = NULL` + `notes`, NO migration 013.** (Decision recorded; kept visible below.)
- **(b) DEFAULT for the first implementation (no migration):** for `failed`/`order_not_found`, set `reconciliation_jobs.resolution = NULL` + `notes`, and let **`trades.status='failed'`** carry the precise truth (the trade row is the source of record); reserve `resolution='unknown'` for genuinely-unresolvable. This is what S4-3a builds.
- **(a) OPTIONAL cleanup only — NOT in the first implementation:** a tiny additive migration (`013`) `ALTER TYPE reconciliation_resolution ADD VALUE 'failed'` — gated, orthogonal to 009. **Requires separate explicit approval; deferred by default.**

---

## 5. Idempotency & concurrency (the "no blind/duplicate order" guarantees)
1. **No `createOrder`, ever** — the resolver only `fetchOrder`s. There is no code path that can place a new/duplicate order. This is the primary safety property.
2. **Conditional UPDATE guard** — `WHERE status IN ('pending','unknown')` so the resolver can never clobber a trade the inline path (or a prior cycle) already moved to terminal; 0-rows = no-op.
3. **`clientOrderId` lookup is deterministic** — same trade → same `origClientOrderId` → same exchange answer; re-running is safe.
4. **Reconciliation-job guard** — `WHERE status='pending'` so an already-resolved job is not re-touched.
5. **Transient = leave pending** — timeouts/unavailable never change the trade; the job stays `pending` for the next cycle (boot restart now; S4-3b timer later).

---

## 6. Wiring (S4-3a) + boundary with S4-3b
- **S4-3a:** after `runBootReconciliation` creates/【finds】 the jobs, **resolve each `pending` job at boot** by calling `resolveStuckTrade`. Boot-time resolution is enough to prove the mechanism and to feed the S4-2 campaign's "3 reconciled unknowns" (restart-driven).
- **S4-3b (deferred):** a runtime `setInterval(60s)` scan that calls the same `resolveStuckTrade` continuously — **NOT** built here. Keeping resolution in one reusable function lets S4-3b reuse it with no logic change.
- Runs regardless of `QUEUE_ENABLED` (boot reconciliation already does); requires exchange egress + credentials (testnet) — so the E1 is gated.

---

## 7. Code placement & dependency note
- The resolver touches the worker runtime (it uses `BinanceAdapter` + the Supabase client), so it lives in **`worker/src/`** (like boot reconciliation), not `worker/tools/`. Keep it a **separate, DI-first function** with its own tests; wire it into `main()`/`runWorker` boot path with a single call.
- **No new dependencies** — reuses existing `BinanceAdapter`, `@supabase/supabase-js`, the existing adapter construction (Vault credential resolve, F-01 chain).

---

## 8. Tests (unit, DI mocks — no network)
- Each §4 mapping: filled / cancelled / failed / submitted / unknown / null / timeout / unavailable / auth → asserts the trade-status target, recon status/resolution, and **that `createOrder` is NEVER called** (mock asserts 0 calls).
- **Idempotent re-run:** running the resolver twice on the same trade → second run is a no-op (conditional guard; 0 rows).
- **Race guard:** trade already `filled` (terminal) → resolver makes no change.
- **Transient leaves pending:** timeout/unavailable → trade unchanged, job stays `pending`.
- **Bounded cap:** more jobs than the cap → only cap processed, remainder logged.
- Existing worker suite stays green; resolver covered like `processMessage`.

---

## 9. E1 induction plan (gated, reversible — WB8-style, RUN_ID-scoped)
Prove the resolver against **real testnet order states** without placing new orders:
- **RUN_ID** `S4-3A-YYYYMMDD-HHMM`; every seeded trade carries it in `signal_id` (and a recognizable `client_order_id`), so seeds are attributable + removable.
- **Record baseline FIRST** (privileged read): trades/reconciliation_jobs counts + ids.
- **Seed (privileged insert), reversible:**
  - One `unknown` trade whose `client_order_id` matches a **real, already-`filled` testnet order** (e.g. a prior WB6/WB7 fill) → resolver should fetchOrder → `filled` → trade `filled`, job `resolved/filled`.
  - One `pending`/`unknown` trade with a `client_order_id` that **does not exist** on the exchange → fetchOrder → `null` → trade `failed`, job resolved.
- Restart the worker (`QUEUE_ENABLED=false` so no trading) → boot reconciliation creates jobs → resolver runs → observe the transitions in logs + DB.
- **Verify:** trades reach the expected terminal status; jobs resolved; **zero `createOrder` calls** (logs); zero new exchange orders.
- **Cleanup (RUN_ID-scoped ONLY):** delete only `signal_id = '<RUN_ID>...'` rows (trades + their jobs); **re-verify counts/ids == recorded baseline**. STOP if cleanup scope is ambiguous or baseline mismatches.
- Capture an S4-3a evidence report (RUN_ID, per-trade transition, fetchOrder result, createOrder-call-count = 0, seeds removed, baseline restored).

---

## 10. Stop conditions (abort, leave clean)
- Any code path that calls **`createOrder`** / places an order during resolution — forbidden.
- Resolver writing **any table other than** `trades` / `reconciliation_jobs` / `audit_logs`.
- A trade in a **terminal** status being overwritten (guard failed).
- Seeding/cleanup that is **not RUN_ID-scoped**, or post-cleanup state ≠ recorded baseline.
- Repeated transient/auth exchange errors → **leave pending / mark job failed + alert**; do **not** force a terminal status without evidence.
- Any **egress/credential** anomaly (cf. WB6 451) → stop and diagnose the path, do not loosen anything.
- Any arm/fire of the trading queue (`QUEUE_ENABLED=true`) **without** explicit approval; any touch of **Migration 009** (frozen).

---

## 11. Definition of Done (S4-3a)
- `resolveStuckTrade` built + unit-tested (all §4 mappings; never-`createOrder`; idempotent; transient-safe); worker suite green; build + tools-tsc clean.
- Wired into boot reconciliation (resolve `pending` jobs at boot).
- **Gated E1** proves: `unknown` → `filled` (real testnet order) and `pending`/`unknown` → `failed` (OrderNotFound), idempotent, **zero new orders**, seeds removed, baseline restored.
- Enum decision (§4) recorded; if (a) chosen, migration 013 is its own gated step.
- Canon/Notion updated. (S4-3b runtime scan remains deferred.)
