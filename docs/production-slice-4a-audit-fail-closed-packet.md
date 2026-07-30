# Slice 4A — audit fail-closed for real order lifecycle (Codex-reviewable packet)

**Status:** PLANNING / REVIEW ONLY — no code, no DB mutation, no deploy, no secrets, no mainnet / no real funds.
**Goal:** make a **real (live-tier) order lifecycle impossible without durable audit evidence** — a mainnet order must not be *placed* unless its pre-order audit is durably written, and a real fill/failure must never be *silently* recorded without its audit trail.

This is HARD BLOCKER **B1** from the 4/5 live-tier triage.

---

## 1. Current audit side-write behavior (grounded in source)

Two writers, **both non-fatal by design**:

- `insertAuditLog(...)` — [`worker/src/index.ts:465-492`](../worker/src/index.ts): inserts one `audit_logs` row; on error it logs `audit_log_insert_error` (error **code only**) and **returns void — processing continues**. Docstring (455-456): *"Non-fatal: if the insert fails, the error is logged and processing continues. Audit failure must never block trade execution."*
- `insertAudit(...)` — [`worker/src/reconciliation.ts:100-121`](../worker/src/reconciliation.ts): same pattern for reconciliation-resolved trades (`reconciliation_audit_error`, continues).

**Order-lifecycle call sites (all currently non-fatal):**

| Event | Site | When | Order placed? |
|---|---|---|---|
| `trade.created` | [index.ts:1018](../worker/src/index.ts) | **before** `createOrder` (1025) | **no — pre-order** |
| `trade.<status>` (filled/submitted) | [index.ts:1093](../worker/src/index.ts) | after fill, after trades update | yes — post-order |
| `trade.unknown` | [index.ts:1071](../worker/src/index.ts), 1278 | after DB-update failure | yes — post-order |
| `trade.failed` | [index.ts:1128](../worker/src/index.ts), 1160, 1256 | after `createOrder` throw | yes/maybe — post-order |
| terminal `trade.<status>` (reconcile) | [reconciliation.ts](../worker/src/reconciliation.ts) `insertAudit` | post-hoc resolution | yes — post-order |
| `order.blocked` | [index.ts:847](../worker/src/index.ts) | sizing/risk block | **no — no order** |
| `bot.*` (misconfigured / disabled_credential_invalid / circuit_breaker) | 585 / 543 / 1173 | bot-state | no |

**The hole:** the pre-order gate is already fail-closed for the **trades row** (the pending insert is error-checked at ~995 and returns if it fails), but the **`trade.created` audit at 1018 is non-fatal** — so a mainnet order can be **placed with no `trade.created` audit event**. And any post-order audit (`trade.filled`/`trade.failed`) can be silently lost — a **real fill with no audit trail**. That is exactly "an unauditable real order."

**Note (deliberately preserved):** on testnet these are non-fatal on purpose (ergonomics — a testnet audit blip must not block testing). 4A changes behavior **only in live tier**.

---

## 2. Which audit events are HARD BLOCKERS before a live order

Tied to an **actual order placement** (an audit miss = an unauditable real order):

- **HB-A — `trade.created` (pre-order).** Enforceable: the order must not be placed unless this audit is durable. *This is the true "impossible without audit" gate.*
- **HB-B — `trade.<status>` fill/submit (post-order).** The order already exists; must never be **silently** recorded — audit failure must be retried + alerted.
- **HB-C — `trade.failed` (post-order).** A failed real order must be durably audited or loudly alerted.
- **HB-D — reconciliation terminal audit.** A reconciled real fill must not be marked **resolved** without its audit (else a silent unaudited terminal state).

**SHOULD-FIX (no real order at direct risk — evidence completeness, not an unauditable order):**
- `order.blocked` (no order placed), `trade.unknown` (already an escalation state), `bot.*` state events. Bounded-retry + alert in live tier; not order-placement blockers.

---

## 3. Fail-closed conversion plan (live-tier only; testnet unchanged)

Gate on tier (`isProduction`, same source as 4B). Mechanism: make the audit writers **report success** (return `boolean`) instead of silently swallowing, and harden the hard-blocker sites.

### 3.1 Pre-order gate (HB-A) — ENFORCED (no order without audit)
Before `createOrder` (index.ts:1025), require the `trade.created` audit to be durable:
- `const audited = await insertAuditLog('trade.created', …)` (now returns boolean).
- **Live tier + `!audited`:** do **NOT** call `createOrder`. Mark the trade **`failed`, `error_reason='audit_write_failed'`**, emit a loud alert (`order_aborted_audit_unavailable`, bot_id/signal_id/trade_id — no secret), and **ack** (no order was placed; the failed trades row + alert are the durable evidence).
  - *Why mark `failed`, not leave `pending`+retry:* a retry re-enters `processMessage`, hits Step 3 with the existing **pending** trade, and is treated as `duplicate_signal` → ack (Step 3, index.ts:723-732) — it would **never** re-attempt the audit or the order. Marking `failed` is the correct terminal fail-closed (no order, observable, alert). (Optional refinement: a small bounded inline retry of the audit before declaring `failed`, to ride out a transient blip.)
- **Testnet:** unchanged (non-fatal; order proceeds).

### 3.2 Post-order hardening (HB-B/HB-C) — FAIL-LOUD (order can't be un-placed)
After `createOrder`, the order exists and the `trades` row is the state-of-record (already fail-closed: a status-update failure → `unknown` + reconciliation_job, index.ts:1045-1090). For the **audit** write:
- **Live tier + audit fails:** bounded inline retry (e.g. 2 extra attempts); on persistent failure emit a loud alert (`audit_write_failed_post_order`, trade_id/status — no secret). **Do NOT revert the known-good trade status** (we *know* it filled; only the trail is missing) and **do NOT silently ack without the alert.**
- The trade proceeds (it already happened); the alert makes the missing-trail non-silent. (Follow-up option, not this slice: an audit-backfill sweeper analogous to 4C that re-emits missing order-lifecycle audits from the `trades` row.)
- **Testnet:** unchanged.

### 3.3 Reconciliation terminal audit (HB-D)
In `finalizeTerminal` (reconciliation.ts), the audit currently fires **after** the job is marked resolved. Live tier: if the terminal audit fails, **do not mark the job resolved** (leave it for the next reconciliation pass) or emit a loud `reconciliation_audit_unavailable` alert — a reconciled real fill must not become silently unauditable-resolved.

### 3.4 Bounds + safety
- All retries are **bounded** (fixed small count) — never an unbounded loop that could hang the worker or delay the poll loop.
- Audit `after_state`/alerts carry **safe labels only** (status/reason/ids) — never credentials, balances, exchange responses, or raw payloads (existing `insertAuditLog` doctrine, index.ts:458-459).
- Flag-gated for a safe rollout (e.g. `AUDIT_FAIL_CLOSED_ENABLED`), so live fail-closed can be turned on/off independently of the tier flag during cutover.

---

## 4. Tests (LOCAL; worker jest — mock supabase audit insert to fail)

1. **prod + `trade.created` audit fails ⇒ NO order:** `createOrder` **not** called; trade → `failed(audit_write_failed)`; alert emitted; ack. *(the core HB-A guarantee)*
2. prod + `trade.created` audit succeeds ⇒ normal path (`createOrder` called once).
3. **prod + post-order fill audit fails ⇒ fail-loud:** bounded retry attempted; persistent failure emits `audit_write_failed_post_order` alert; trade **stays filled** (not reverted); ack; **no second order**.
4. prod + `trade.failed` audit fails ⇒ alert emitted; `trades_dlq` row still written.
5. **testnet + any order-lifecycle audit fails ⇒ UNCHANGED** (non-fatal; order proceeds) — ergonomics preserved.
6. **No secret leakage:** audit `after_state` + every new alert payload contain only safe labels (assert no balance/credential/raw-payload/exchange-response fields).
7. Reconciliation terminal audit fails in prod ⇒ job **not** marked resolved / alert emitted (HB-D).
8. Retry bound respected (audit failure does not loop unboundedly; fixed max attempts).
9. Flag OFF (`AUDIT_FAIL_CLOSED_ENABLED=false`) ⇒ behavior identical to today even in prod (safe default for staged rollout).

---

## 5. Rollout (staged; gated)

1. **LOCAL:** implement (audit writers return boolean + hardened hard-blocker sites + flag), run worker jest + `tsc`. Stop for Codex review with the diff. **No push until PASS.**
2. **No migration** — `audit_logs` schema is unchanged; nothing to linked-apply.
3. **Deploy dark:** ship with `AUDIT_FAIL_CLOSED_ENABLED=false` (behavior identical to today), on testnet first.
4. **Enable on testnet** (with `is_production=false`, so the *tier* gate keeps testnet non-fatal — verify the flag+tier interaction: fail-closed engages only when BOTH live tier AND flag on). Fault-inject an audit failure on a staging/live-tier dry run and confirm: pre-order abort (no order), post-order alert, no silent path.
5. **Live tier:** only as part of the broader live-tier cutover (with A1/A4/A11) — never standalone to mainnet.
- **Rollback:** flag OFF (instant) → non-fatal behavior returns. No data migration to undo.

---

## 6. Stop conditions (any ⇒ STOP)

- Any design that lets a **real order be placed** without a durable `trade.created` audit (HB-A must gate before `createOrder`).
- Any design that **silently** records or acks a real fill/failure whose audit could not be written (must retry + alert; never silent).
- Any design that **reverts a known-good filled trade** to a wrong state just because the *audit* (not the fill) failed.
- Any testnet ergonomics break (fail-closed must be live-tier + flag gated).
- Any secret / balance / exchange-response / raw-payload in an audit row or alert.
- Any **unbounded** audit retry (must be a fixed small bound — never hang/delay the worker).
- Any mainnet action / real-funds path in this slice.

---

## Summary for Codex

Audit writes are non-fatal today ([index.ts:482-491](../worker/src/index.ts)), so a mainnet order can place with no `trade.created` audit and a real fill can be silently unaudited. 4A, **live-tier + flag gated** (testnet unchanged): (HB-A) **gate `createOrder` on a durable `trade.created` audit** — fail ⇒ no order, trade `failed(audit_write_failed)` + alert; (HB-B/C) post-order audit failure ⇒ bounded retry + loud alert, never silent, never revert the real fill; (HB-D) never mark a reconciled fill resolved without its audit. Audit writers return a success boolean; safe-label-only payloads; bounded retries. No migration; rollback = flag OFF. Planning only — nothing executes until Codex PASS + Oren go.

*Prepared for Codex review at Oren request.*
