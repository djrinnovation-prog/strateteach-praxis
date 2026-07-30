# Praxis full code audit — real-money readiness (2026-07-13)

**Method:** four independent read-only audit passes — (A) order-execution/money-correctness, (B) safety-gates/fail-closed/kill/audit, (C) auth/secrets/RLS/RPC/webhook/Vault, (D) queue/delivery/idempotency/migrations. No code was changed during the audit. Every finding is grounded at file:line.

**Headline:** the execution spine is **genuinely fail-closed and defense-in-depth**. Auth/secrets/RLS/credential-isolation/Vault are **clean** (no Critical/High). The real-money exposure is a **small, well-bounded set**: audit durability (4A), concurrency assumptions in the cap ledger, two non-terminal-order-state gaps, a safety-net write, and two **deployment/release gates** for 4C. **NO-GO for real funds** today — but the gap is tractable and mostly already tracked.

---

## Critical blockers for real funds

### CR-1 — Order-lifecycle audit is best-effort; a real order can execute with no audit trail (= 4A / B1)
- **file:line:** `worker/src/index.ts:482-491` (`insertAuditLog` swallows the error); order-lifecycle callsites `:1018` (`trade.created`, fires *before* `createOrder` at `:1024`), `:1093` (`trade.filled`), `:847` (`order.blocked`); reconciliation `worker/src/reconciliation.ts:118`.
- **risk:** audit writes are non-fatal; nothing in the order path checks the result.
- **why real money:** a real mainnet fill can occur with **zero** corresponding `audit_logs` rows (created + filled lost during an `audit_logs` outage / RLS regression); the `order.blocked` evidence that a cap/env/kill fired can also vanish. Forensic/compliance reconstruction has a hole exactly over live executions. (The `trades` row itself is durable — it's inserted before the order and is fatal-on-failure — so this is an *audit-trail* hole, not an order-record hole.)
- **required fix:** the **4A packet** (`docs/production-slice-4a-audit-fail-closed-packet.md`, written, uncommitted): make the created/filled/blocked trio durable — write the audit in the same transaction as the trade transition (the pattern `019_operator_kill_all.sql:199-223` already uses — it rolls the kill back if its audit fails), **or** park/block the order when the pre-order `trade.created` audit can't be written; keep secondary audits non-fatal; live-tier + flag gated (testnet unchanged).
- **required test:** inject an `audit_logs` insert failure → order path fails closed (no `createOrder`, or trade parked for reconciliation); a filled order always has a durable transition row.
- **blocks real funds:** **YES.**

### CR-2 — 4C no-silent-loss guarantee is INERT until two release gates are met (deployment discipline, not a code defect)
- **file:line:** sweeper flag `worker/src/index.ts:1504-1507` (`WEBHOOK_REQUEUE_SWEEPER_ENABLED`, default OFF); code that requires migrations `supabase/functions/webhook/index.ts:113,119-122` + `worker/src/webhookRequeueSweeper.ts:115` (needs `queued`/`next_retry_at`/`claim_webhook_requeue` from `024`+`025`, **not linked-applied**).
- **risk:** (a) with the sweeper **OFF** (current default), a crash between the `webhook_logs` commit and `pgmq_send` leaves a stuck `accepted` row that nothing recovers — a real signal can be silently dropped. (b) If the 4C **code deploys before `024`+`025` are linked-applied**, the `queue_failed` marking references a non-existent column and fails → the recoverable state is never written → silent loss reintroduced.
- **why real money:** a real BUY/SELL signal lost with no order, no alert, no dead-letter — the exact failure 4C exists to prevent.
- **required fix (release gates, need YOUR approval to execute):** ① linked-apply `024` then `025` (surgical, never `db push`), read-back + track in `schema_migrations`, **before** deploying the 4C webhook+worker build; ② set `WEBHOOK_REQUEUE_SWEEPER_ENABLED=true` and confirm the worker runs it, as a hard real-funds precondition. Both are external actions — see Approvals.
- **required test:** post-apply read-back asserts the enum value + 3 columns exist; with sweeper ON, a stuck `accepted` row is re-enqueued within one sweep; a migration-order CI check.
- **blocks real funds:** **YES** (until both gates are in force).

> Also blocking real funds but **external / not code**: the 5-step production ladder — **A1** static egress (2/5, packet + probe ready, egress-proof not run), **A4** mainnet credentials (3/5), **A11** authorized tiny-live run (5/5). These are the gates you already track; nothing in the audit shortcuts them.

---

## High priority before production

| # | Finding | file:line | Blocks funds | Note |
|---|---|---|---|---|
| H-1 | **Daily-cap / per-bot exposure is TOCTOU** — read-then-insert, no atomic enforcement; correctness depends entirely on exactly **one serial worker** | `index.ts:962-969` (read), `:977-991` (insert), `sizingRisk.ts:178-195`; in-flight guard only covers `unknown` `:742-757` | **NO** at 1 replica; **YES if scaled >1** | Two concurrent same-bot BUYs both read the pre-insert total, both pass → cap exceeded / stacked positions. Fix: assert single-replica at startup **or** atomic cap reservation (per-bot ledger `FOR UPDATE`, or a constraint/trigger). (Agents A+B independently.) |
| H-2 | **`submitted` (ccxt `open`) treated as terminal success** — not in Step 3.5 block set, no reconciliation job, breaker reset | `index.ts:1034-1116`; block set `:744-746`; map `BinanceAdapter.ts:104` | **YES** (low prob, but failure = stacked exposure) | An open/partially-filled order isn't reconciled until restart **and** the next BUY isn't blocked → a second market order stacks. Fix: treat `submitted` non-terminal (recon job + add to in-flight block set). |
| H-3 | **Success-path `unknown` creates no reconciliation job** (inconsistent with every other `unknown` path) | `index.ts:1034-1116` vs Case C `:1277-1294` + UPDATE-fail `:1077-1087` | **NO** (fail-safe: blocks) | Bot correctly blocked, but a possibly-live order has no reconciliation handoff until restart. Fix: mirror Case C (upsert `reconciliation_job`). **Safest first fix.** |
| H-4 | **Circuit-breaker state write unchecked + counted from stale read** — breaker can silently fail to trip | `index.ts:1171` (no error check), count `:1165` | **NO** (safety-net erosion) | A bot hitting repeated `ExchangeRejectedError` meant to auto-disable at 5 keeps firing if the `bots` write fails or the count under-counts. Fix: atomic `consecutive_failures = consecutive_failures + 1` RETURNING + error check. |
| H-5 | **pgmq `trade_signals` has no poison-message cap** — a permanently-blocked signal redelivers forever | `pollOnce` `index.ts:1362-1434` (`read_ct` only logged `:1387`); block `:749-757` | **NO** (fail-closed) | A message that always `ack:false` (unresolved `unknown`, persistent `market_rules_error`) spins indefinitely; the stuck position never self-heals without the runtime reconciliation loop. Fix: `read_ct`/age cap → DLQ + alert; ship the runtime reconciliation loop. |
| H-6 | **Duplicate-delivery re-enqueue bypasses the attempt counter/backoff** (4C) | `webhook/index.ts:282-293` vs increment only in `025:75-81` | **NO** (worker dedups → no double order) | Under a sustained pgmq outage + TV duplicates, unbounded enqueue attempts with no backoff/exhaustion alert via the delivery path. Fix: route the duplicate re-enqueue through the claim RPC, or increment `requeue_attempts` under CAS in `enqueueAndMark`. |

---

## Medium / backlog

- **M-1 slippage:** caps enforced on *requested* notional, not executed cost — an upward tick between price-fetch and fill can exceed per-order max / drift the daily ledger (`index.ts:962-969`, `sizingRisk.ts:132`). Fix: slippage buffer, or reconcile ledger vs `executed_notional_usdt`, or limit order; at minimum document tolerance.
- **M-2 config range validation:** `isBotConfigReady` presence-checks only (`sizingRisk.ts:50-70`) — `pct>100` / negative caps pass readiness (downstream still fails closed). Fix: explicit `0<pct≤100`, `notional>0`, `caps>0`. **Safe additive hardening.**
- **M-3 runtime reconciliation deferred:** `unknown`/`pending` trades resolve only on boot (`index.ts:1454-1469`); a bot can sit blocked until restart. Fix: land the `setInterval(60s)` loop (reuses `resolveStuckTrade`). *(Unlocks H-3/H-5/M-4 fully.)*
- **M-4 reconciliation env-guard parity:** `defaultAdapterFor` skips `assertExchangeEnvironment` (`reconciliation.ts:248-269`) — read-only, no money path; env mismatch = auth noise. Fix: add the env column + guard.
- **M-5 DLQ insert failures swallowed:** `index.ts:1141-1143,1187-1189` — forensics loss, not live safety. Fix: alert on `dlq_insert_error`.
- **M-6 unchecked `status:'queued'` update:** `webhook/index.ts:119-122`, sweeper `webhookRequeueSweeper.ts:86-92` — benign (idempotent) but spurious 503s. Fix: check + log/retry.
- **M-7 kill doesn't cancel/unwind:** `019:10-12` (by-design, disclosed via `requires_attention`). Fix: roadmap operator-gated cancel/flatten, or document the manual runbook.
- **M-8 XFF-spoofable per-IP rate gate:** `webhook/index.ts:152-153` — availability only (per-bot gate is the real, un-spoofable control). Fix: trust a right-most/platform hop.
- **M-9 `webhook_rate_limits` no retention:** `017:27` — table grows. Fix: periodic delete of aged buckets.
- **M-10 `webhook_secret_hash` readable by owner (RLS):** `001:509-511` — not forgeable (pepper Edge-only, preimage-resistant). Fix: column-scoped select.
- **M-11 two SQL fns omit `SET search_path`:** `webhook_rate_bump` `017:33-42`, `claim_webhook_requeue` `025:51-83` — service_role-only + fully-qualified refs, no vector today. Fix: add `SET search_path=''` for parity.

---

## False positives / non-issues (verified safe — do NOT change)

Env guard is **double-keyed** and fail-closed (worker `isProduction` AND credential `exchange_environment` must both be mainnet, else `assertExchangeEnvironment` throws before the adapter — `sizingRisk.ts:78-85`, `index.ts:885`; adapter sandbox when `!isProduction` on both ccxt instances). Production egress proxy fail-closed at **three** layers (`index.ts:888`, `reconciliation.ts:239`, `BinanceAdapter.ts:250-252`). **Idempotency/no-double-order** is sound — `trades_bot_signal_unique` is a **full non-partial** `UNIQUE(bot_id,signal_id)` (`001:286`), pending row inserted **before** `createOrder`, 23505 handled as duplicate-ack; VT re-delivery mid-order can't double (Step 3 guard; ccxt timeout 5000ms both instances < 30s VT). **Kill is per-message** (queued signals also blocked) and its **audit is durable in-transaction** (`019:199-223` — the reference pattern for 4A). **Reconciliation never places an order** (`fetchOrder` only; sole `createOrder` = `index.ts:1025`, guarded by `binance-adapter-callsites.test.ts`). **Sizing/risk never defaults** — null config throws. **SELL blocked before the adapter** in v1. **Startup gates strict** (exact `true`/`false`, else `exit(1)`; `QUEUE_ENABLED` absent → no poll loop). **ccxt market BUY by base quantity is correctly constructed** (verified against ccxt 4.5.56 source). **Auth/secrets/RLS/credential-isolation/Vault**: constant-time webhook verify, no secret ever logged/returned/audited, admin-rotation fully gated with mandatory in-txn audit, `is_operator` self-assignment blocked, operator RPCs deny-by-default, Vault/queue accessors service_role-only, worker zeroes key material in `finally`, RLS cross-user tight — all verified safe.

---

## Production-path mapping (Deliverable 2)

| Finding | Maps to | Status |
|---|---|---|
| CR-1 audit durability | **4A** | packet written (`production-slice-4a-audit-fail-closed-packet.md`), uncommitted; implement after review |
| CR-2 sweeper ON + migration order | **4C** deploy gates + **A11** preconditions | 4C code committed/pushed; migrations 024/025 **not linked-applied**; sweeper OFF — both need your approval to execute |
| H-1 cap concurrency | **A4/live-tier** + scaling gate | new; fix before real funds (CRITICAL if ever scaled) |
| H-2 submitted-terminal, H-3 success-unknown, H-4 breaker, H-5 poison-cap, M-3 runtime-recon | **live-tier fail-closed (4/5)** worker hardening | authorable now (worker code + LOCAL tests, A1-independent) |
| H-6, M-6, M-11 | **4C** polish | authorable now |
| M-8/M-9/M-10 | webhook/**TradingView production path** hardening | authorable now |
| A1 static egress | **A1** (2/5) | packet + probe ready; egress-proof is operator-run |
| A4 mainnet credentials | **A4** (3/5) | plan + impl packets ready; blocked on A1 |
| TradingView production | **TradingView path** | `production-tradingview-readiness-prepared-not-live.md` exists |
| A11 tiny-live | **A11** (5/5) | template ready; nothing executes until all gates green |
| UI / user setup | **UI-1..UI-6** | plan PASS'd; UI-1+UI-1b safe-now |

---

## Final GO / NO-GO

**NO-GO for real funds.** Justification:
1. **CR-1 (4A audit durability)** — the one true code-level fail-open; a real order can execute unaudited. Fix designed, not yet built.
2. **CR-2 (4C release gates)** — the no-silent-loss guarantee is not in force until migrations are linked-applied *before* the code deploy and the sweeper is ON.
3. **External ladder incomplete** — A1 egress-proof not run, A4 not provisioned, A11 not authorized.
4. **High worker-hardening items** (H-1 cap-atomicity/single-replica, H-2 submitted-terminal, H-4 breaker) should be closed before live; H-1 becomes **Critical** if the worker is ever scaled beyond one replica.

**Testnet posture: strong.** The execution controls, env isolation, kill, idempotency, sizing/risk, and security surfaces are fail-closed and well-hardened — appropriate for continued testnet operation.

**What I can advance now (no external deps):** the H-2/H-3/H-4/H-5/H-6 + M-2/M-3/M-6/M-11 worker/edge hardening — each as its own reviewed, LOCAL-tested change (never bundled). **What needs you:** CR-2 linked-apply + sweeper enable, A1 egress-proof, A4, A11, and any deploy — all external, all held for explicit approval.

*Prepared autonomously within the stated safety boundaries. No external/mainnet/secret/linked-DB/deploy action taken.*
