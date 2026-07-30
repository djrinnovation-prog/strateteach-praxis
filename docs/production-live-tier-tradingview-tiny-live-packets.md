# 4/5 — Live-tier fail-closed + TradingView production path + Tiny-live preflight (PACKETS)

> **DOC / PLANNING + read-only grounding — NOT EXECUTION.** No code · no DB mutation · no deploy · no Railway/Doppler ·
> no secrets · no mainnet / no real funds. **Real funds remain NO-GO.** Uncommitted draft for Codex review. Prepares the
> **4/5** production gate while **2/5 (A1)** is externally pending. Grounded in the actual worker + webhook code
> (read-only, 2026-07-12).
>
> **Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.** These are **4/5**
> packets (+ the tiny-live preflight that consumes 1-4). Planning-ahead; nothing executes until A1 (2/5) + A4 (3/5) +
> A11 (5/5).
>
> **Rev 2 (2026-07-12): Codex CHANGES 1-10 applied.** Triaged the 7 gaps into **HARD BLOCKERS / SHOULD FIX / BACKLOG**
> (§0); named 5 hard blockers before any tiny-live; recommended the **`pgmq_send`-failure** behavior (§2e); added exact
> **TradingView token rules** (§2b); added the **"one order only" guard** (§3); defined the **A11 approval text** (§4);
> split the fail-closed proof into **staging fault-injection / production-readiness read-only / tiny-live runtime** (§1d);
> added **implementation slices 4A-4G** with before-A1 markers (§5); progress unchanged.

## 0. Grounding — what is ALREADY fail-closed vs the FAIL-OPEN gaps (verified)
- **[FACT] Startup fail-closed:** `PRAXIS_IS_PRODUCTION` is REQUIRED — missing/invalid → `process.exit(1)`
  (`worker/src/index.ts` validateEnv ~L282-331). `QUEUE_ENABLED` optional, **defaults false = safe (worker does not
  trade)**; invalid → exit(1). **No stricter production-only startup gate exists today.**
- **[FACT] Order spine already fail-closed:** every `catch` in `processMessage` either **RETRIES** (`ack=false`) or
  **BLOCKS** (`ack=true`); nothing proceeds to `createOrder` on uncertainty. `assertExchangeEnvironment` (sizingRisk.ts
  L78-85): `env=null`→throw; **prod ⇒ only `mainnet` passes**, non-prod ⇒ only `testnet`. `enforceRiskLimits`
  (L178-195): **null cap → `missing_risk_caps` throw (fail-closed, not "unlimited")**; per-order + daily caps enforced.
  Kill switch: `trading_enabled=false` (and NULL⇒false) blocks **before the adapter** (`assertTradingEnabled`, index.ts
  ~L872).
- **[FACT] Webhook already: no direct exchange call** — only `pgmq_send` enqueue to `trade_signals`; token = pepper
  HMAC-SHA256 constant-time; idempotency via `webhook_logs (bot_id, signal_id)`; rate limiter is **tier-aware fail-closed
  for `live`** (`rate-limit.ts` L52-56: "live NEVER fails open").
- **[FACT] The FAIL-OPEN surface = side-writes (NOT the order spine).** The trading spine needs no fail-closed change;
  the work is the 7 side-writes below, **triaged by severity [CHANGE 1/2]:**

**HARD BLOCKERS — must be fixed + proven before ANY tiny-live real order:**
- **B1 — audit fail-closed for real order-lifecycle events** (`insertAuditLog` non-fatal, index.ts ~L455-482): at live
  tier, if the **`order.blocked` / `trade.created` / `trade.filled`** audit cannot be written, the order path must NOT
  proceed unauditably (retry/block). **A lost audit ⇒ an unauditable real-money order.** → slice **4A**.
- **B2 — live-tier heartbeat/staleness proof** (heartbeat default OFF if `HEALTHCHECKS_URL` unset, heartbeat.ts; +
  `worker_status` staleness): live tier must **require** the heartbeat and prove staleness is detectable. → slice **4E**.
- **B3 — production rate-limit forced ON** (gated on `WEBHOOK_RATE_LIMIT_ENABLED`; prod does not force it): production
  must make rate limiting **non-disable-able by a missing flag**. → slice **4B**.
- **B4 — `pgmq_send` failure cannot silently lose a fresh TradingView signal** (webhook marks `queue_failed`, 200; no
  auto-recovery): a fresh signal must be recoverable. → slice **4C** (§2e recommendation).
- **B5 — no direct exchange path from the webhook + a CI/route guard** (currently true; must be *enforced*): the webhook
  bundle must be unable to import an exchange client. → slice **4D**.

**SHOULD FIX — before *limited* production (Stage 4), not required for a single watched tiny-live order:**
- **S1 — `dlq_insert_error` non-fatal** (index.ts ~L1124/L1170): a permanently-failed trade can escape the DLQ, still
  acked. (For one watched tiny-live order with manual reconcile, tolerable; fix before scale.)
- **S2 — `worker_status` write reliability** (workerStatus.ts swallows write errors) — status can go stale silently.
- **S3 — `isProduction` single source of truth** (re-read from raw env at index.ts ~L814 vs the validated boolean).

**BACKLOG / observability:**
- **BL1 — pgmq redelivery: no max-retries / auto-DLQ on `read_ct`** (instrumentation only) → poison-message handling.
- **BL2 — monitoring/alerting dashboards, richer telemetry.**

**Model to follow:** the webhook rate limiter is **already tier-aware fail-closed** (`rate-limit.ts` L52-56, `live` ⇒
closed) and migration 019 already separates CORE-PROOF (rolls back) vs TELEMETRY (never rolls back) — the pattern the
worker's live-tier conversions should mirror.

---

## PACKET 1 — Live-tier fail-closed
**Goal:** at `PRAXIS_IS_PRODUCTION=true` the system must fail CLOSED everywhere — including the side-writes above — and must
refuse to trade unless A1/A4/A11 preconditions hold.

### 1a. What MUST happen at `PRAXIS_IS_PRODUCTION=true`
- Only **`mainnet`** credentials can trade (already: `assertExchangeEnvironment`); a testnet cred in prod → block.
- **Rate limiting FORCED ON** — production must require `WEBHOOK_RATE_LIMIT_ENABLED=true` (else no rate limiting; gap #5).
- **Heartbeat REQUIRED** — production must require `HEALTHCHECKS_URL` set (else no dead-man; gap #3).
- **Side-writes fail closed** (gaps #1/#2/#4): in production, if the **`order.blocked` or `trade.created` audit cannot be
  written**, the worker must **not silently proceed** — treat as `ack=false` (retry) or block, so no real order is
  unauditable. Similarly a **DLQ insert failure in production** must not silently ack a lost trade.
- **One source of truth for `isProduction`** (gap #7) — use the validated boolean.

### 1b. What MUST fail closed if A1 / A4 / A11 are missing
- **A1 missing (no proven static egress / not allowlisted):** a mainnet key not IP-allowlisted → exchange auth/IP error →
  `ExchangeAuthError` → **disable bot, ack=true** (already fail-closed, but noisy). **Rule:** do NOT flip
  `PRAXIS_IS_PRODUCTION=true` until A1 is proven (A1-LIVE-READONLY-PROOF). The flip is the gate, not the exchange error.
- **A4 missing (no `valid` mainnet credential):** the bot's credential gate blocks (status≠valid or env mismatch) →
  **fail-closed** (no order). A bot cannot trade mainnet without an A4-promoted credential.
- **A11 missing:** A11 is a **process** gate the worker cannot read — enforced by **not arming** (`trading_enabled=false`
  ⇒ kill-switch block) + operational discipline. **Rule:** never set `trading_enabled=true` / `QUEUE_ENABLED=true` on a
  mainnet bot without A11. The worker fail-closes on `trading_enabled=false` regardless.

### 1c. Gate inventory (where each lives; all already fail-closed unless flagged)
- **Startup gates:** `PRAXIS_IS_PRODUCTION` required (exit1); **[PROPOSAL]** production also requires
  `WEBHOOK_RATE_LIMIT_ENABLED=true` + `HEALTHCHECKS_URL` → exit(1) if missing at the live tier.
- **Queue gates:** `QUEUE_ENABLED` default false (safe); arming = deliberately true. **[PROPOSAL]** a sweeper/retry for
  `webhook_logs.status='queue_failed'` (gap #6) so a dropped fresh signal is recoverable.
- **Credential gates:** env guard (mainnet-only in prod) · ownership W1 (021) · status=valid · vault_secret_id shape —
  all fail-closed.
- **Order-path gates:** kill switch (`trading_enabled`) · sizing/risk caps (null→fail-closed) · per-order + daily notional
  caps · SELL off in v1 — all fail-closed.
- **Side-write gates [the conversions]:** audit/worker_status/DLQ made fail-closed **in production** (§1a).

### 1d. Proof plan — THREE distinct proofs [CHANGE 7]
**(i) Staging fault-injection proof** (converts B1-B5; testnet/staging; fault-injected; **NO mainnet order**):
- **B1 audit fail-closed:** inject an audit-write failure → the order path **blocks/retries** (does not proceed
  unauditably). Evidence: no `createOrder` fired when the `order.blocked`/`trade.created` audit fails.
- **B2 heartbeat/staleness:** startup at live tier without `HEALTHCHECKS_URL` → **exit(1)**; and a forced-stale
  `worker_status` is **detected** (surfaces as ATTENTION). Evidence: exit code + staleness flag.
- **B3 rate-limit forced-on:** at `is_production=true` with the flag unset → **startup refuses / rate limiting still
  active**; exceed limit → uniform 200, **no enqueue**; live-tier store error → **fail-closed reject**.
- **B4 pgmq no-loss:** inject a `pgmq_send` failure → a **recovery record persists** and the sweeper (or TV retry, §2e)
  **re-enqueues** → the signal is eventually processed, not lost.
- **B5 route guard:** the CI/build guard **fails** if the webhook bundle imports an exchange client.
- **Also (already fail-closed, re-confirm):** env-mismatch block · null-cap `missing_risk_caps` · kill switch (A10 drill).
- **Stop conditions:** any blocker's fault-injection proof does NOT fail closed → STOP (not live-ready). Evidence:
  pass/fail per B1-B5; no secrets; no mainnet.

**(ii) Production-readiness READ-ONLY proof** (at the real live config, BEFORE arming; **no order**):
- Read-only confirm: `PRAXIS_IS_PRODUCTION=true`; rate-limit flag forced on; `HEALTHCHECKS_URL` set + heartbeat fresh;
  the deployed webhook bundle has **no exchange import** (route guard green in CI for the deployed commit); the bot's
  credential is `mainnet` + `valid`; caps set (non-null). **No `createOrder`; no arming yet.** Evidence: a read-only
  checklist snapshot. **Stop:** any item red → STOP (do not arm).

**(iii) Tiny-live RUNTIME proof** — the single real order (Packet 3) — the only proof that involves a mainnet order, fully
A11-gated, with immediate disarm (§3). **Stop:** any gate fails / order exceeds caps / kill needed → STOP + rollback.

### 1e. Stop conditions
- **`PRAXIS_IS_PRODUCTION=true` flipped without A1 proven + A4 `valid` credential + A11** → STOP.
- **Any live-tier fail-OPEN side-write** (audit/status/DLQ/rate-limit-off/heartbeat-off) unconverted → STOP (not
  live-ready).
- **Arming (`trading_enabled=true`/`QUEUE_ENABLED=true`) without caps set** → STOP.
- **No `db push` · no secrets · no mainnet order outside the tiny-live preflight.** Real funds NO-GO.

### 1f. Rollback
- **Disarm:** `PRAXIS_IS_PRODUCTION=false` (or `QUEUE_ENABLED=false`) → worker returns to the no-trade safe state;
  `operator_kill_all` for an immediate stop (`trading_enabled=false` + `status=paused`). Redeploy prior worker if a
  conversion misbehaves. All reversible; no data change.

---

## PACKET 2 — TradingView production path
**Goal:** real TradingView alerts drive live signals safely — token never exposed, no direct exchange call, risk gates in
the worker.

### 2a. Alert setup
- One TradingView **alert per (bot, symbol)** → POSTs to the **live webhook URL** with the bot's **real webhook token**
  in the request (path/body). Alert message = the minimal signal (`signal_id`, `action` buy/sell) — **no secrets beyond
  the token**, no account data.
- `signal_id` must be a **stable, unique** id per alert firing (idempotency key) — non-empty string (webhook rejects
  absent; no UUID fallback).

### 2b. Webhook token / no-exposure path — exact PRODUCTION token rules [CHANGE 4]
- **One token PER BOT** (not per alert). The token authenticates the **bot** (`bots.webhook_secret_hash`); all of a bot's
  alerts (one per symbol) use that **one** bot token. Different bots → different tokens. *(No per-alert tokens — the hash
  is a bot-level column.)*
- **Token = a bearer SECRET.** **Never printed** in docs / logs / chat / browser / commits / argv. Treated like a
  password.
- **Hash / pepper path [FACT]:** the token is verified as `webhook_secret_hash = "v1:" + HMAC-SHA256(key=pepper, msg=token)`
  (constant-time). The **pepper is Edge-only** (Supabase Edge secret), **never** in TradingView / the client / any doc.
  Only the **hash** (`v1:<64hex>`) is stored in the DB; the raw token is never stored server-side.
- **Rotation on exposure:** any **local fire / log / commit / screenshot** of a token → it is **BURNED** → **re-rotate**
  via the server-side hasher (`admin-rotate-webhook-token`): new token → new `webhook_secret_hash`; update the TradingView
  alert with the new token; never reuse the old. Rotation is operator-run; the raw token is entered **only** into
  TradingView.
- **[FACT] Fail-closed responses:** missing pepper / bad stored hash → **503** (never "invalid_secret"); wrong token →
  uniform **200** (no structure leak, no enqueue).
- **Evidence the token path is clean (pass/fail, never the value):** (a) a repo/log **grep proves no token value appears**
  anywhere; (b) the stored `webhook_secret_hash` matches `^v1:[0-9a-f]{64}$`; (c) a wrong token → uniform 200 (no leak);
  (d) missing pepper → 503; (e) the rotation runbook exists + the token was entered **only** into TradingView (operator
  attests). **No token value in the evidence.**

### 2c. Signal validation (webhook)
- `bot_id` UUID + well-formed path; body parses as JSON; `signal_id` non-empty string; `action ∈ {buy, sell}`;
  `bot.status === 'active'` (else 200 reject — the webhook half of the kill switch). Schema stamped `schema_version='1.0'`.

### 2d. Idempotency
- **[FACT] `webhook_logs` upsert `onConflict (bot_id, signal_id) ignoreDuplicates`** is the dedup anchor — a duplicate
  firing → `webhook_dedup_skip`, 200, **no enqueue**. (The worker also idempotency-checks existing trades — defence in
  depth.)

### 2e. Queue insertion (NO direct exchange call)
- **[FACT] Only side effect = `pgmq_send('trade_signals', { schema_version:'1.0', bot_id, signal_id, side })`.** The
  webhook **never** imports ccxt / calls the exchange. **Rule:** keep it that way — a CI/route guard must fail the build
  if the webhook bundle imports an exchange client.
- **[B4] `pgmq_send` failure — recommended behavior [CHANGE 3]: BOTH persist + retry, with the server-side sweeper as the
  authoritative no-loss guarantee.**
  - **Persist a recovery record BEFORE ack (primary):** the `webhook_logs` row is already inserted *before* enqueue; on
    `pgmq_send` failure mark `status='queue_failed'`. A **reviewed server-side sweeper** re-enqueues `queue_failed` rows
    (idempotent; flips them to `queued` on success). **This guarantees no fresh signal is lost regardless of TV retry.**
  - **Return non-2xx to TradingView (secondary):** returning **503** on enqueue failure lets TV retry — BUT only if the
    dedup treats a `queue_failed` row as **re-enqueueable** (else a same-`signal_id` retry hits `webhook_logs` dedup →
    `dedup_skip` → the signal is suppressed, defeating the retry). So the dedup must be adjusted: **a `logged/queued` row
    dedups; a `queue_failed` row re-attempts enqueue.**
  - **Why both (not TV-retry alone):** TradingView retries are limited/best-effort, and the current insert-then-enqueue
    order means a naive non-2xx retry would be swallowed by dedup. The **sweeper is the durable guarantee**; the non-2xx
    is a helpful accelerant once the dedup is retry-safe. → slice **4C**.

### 2f. Risk gates before order
- **Applied in the WORKER, not the webhook** — the webhook only enqueues. The worker then applies: kill switch · env
  guard (mainnet in prod) · ownership · credential valid · sizing config · **per-order + daily notional caps** ·
  balance/minQty/minNotional — all fail-closed. **No order can bypass these by arriving via the webhook.**

### 2g. Evidence format + stop conditions
- **Evidence:** pass/fail per check (token accepted 200 / rejected 200; dedup skip; enqueue OK; worker applied gates) —
  **no token value, no secrets, no account data**. Rate-limit + kill behaviors recorded pass/fail.
- **Stop conditions:** token fired locally / exposed → STOP + re-rotate. Any **direct exchange call** added to the webhook
  → STOP. **Rate limiter off in production** → STOP (Packet 1 forces it on). Any secret in a TradingView alert beyond the
  token → STOP. Real funds NO-GO.

---

## PACKET 3 — Tiny-live preflight
**Goal:** the single gated step that places the FIRST real order — one bot, one symbol, minimum caps, kill ready.

### 3a. Prerequisites (ALL must be true — hard gate)
- [ ] **A1 complete** — static egress IP proven + key IP-allowlisted (A1-LIVE-READONLY-PROOF).
- [ ] **A4 credential `valid`** — per-bot mainnet credential provisioned + read-only-validated + promoted (A4-1..A4-3).
- [ ] **Live-tier fail-closed proof PASS** — Packet 1 §1d proofs green (side-writes converted + proven).
- [ ] **TradingView path PASS** — Packet 2 proofs green (token, no-exposure, no direct exchange call, dedup, enqueue).
- [ ] **A11 written approval WITH CAPS** — explicit, capped, one bot, kill authority acknowledged.

### 3b. Exact caps / limits needed (Oren sets the numbers; these are the fields)
- **Per-order max notional:** `bots.max_order_notional_usdt` = a **tiny** USDT cap (Oren's number).
- **Daily notional cap:** `bots.daily_notional_cap_usdt` = a **tiny** daily USDT cap.
- **Position size:** `bots.sizing_mode` + (`position_size_pct` **or** `fixed_notional_usdt`) — set to the minimum viable.
- **Scope:** exactly **one bot, one symbol**; SELL stays off (v1). Caps are enforced fail-closed (null → block).
- *(A11 should pre-agree these exact numbers; the worker rejects anything over them.)*

### 3b-guard. "ONE ORDER ONLY" enforcement [CHANGE 5]
- **one bot** · **one symbol** · **one `signal_id`** (the single TradingView alert firing) · **one side — BUY only**
  (SELL is off in v1 and requires explicit separate approval).
- **max notional cap REQUIRED** (`max_order_notional_usdt`, non-null) · **daily cap REQUIRED**
  (`daily_notional_cap_usdt`, non-null).
- **Risk-layer one-order guard:** set **`daily_notional_cap_usdt` = the single order's notional** so a **second** order
  the same day → `daily_notional_cap` block (the risk layer itself refuses a 2nd order — defence in depth, not just
  manual disarm).
- **Immediately disarm after the one order OR after a timeout:** the moment the single order reaches a terminal state (or
  a short arm-window timeout elapses), **disarm** (`trading_enabled=false` / `QUEUE_ENABLED=false`). Do not leave the bot
  armed.
- **NO scale-up in the same run:** no cap increase, no second symbol, no second bot, no re-arm — a larger run is a
  **separate** A11 approval.

### 3c. One-bot / one-symbol flow (the ONLY place a bot is repointed + armed)
1. Repoint the one bot's `credential_id` → its **valid mainnet** credential (respects 021 ownership + 023 single-use).
2. Set the caps (§3b); confirm `isBotConfigReady` = ready.
3. `PRAXIS_IS_PRODUCTION=true` (live tier, with Packet-1 conversions live) + `QUEUE_ENABLED=true` + **arm**
   (`trading_enabled=true`) — **only after A11**.
4. One **TradingView alert** → one signal → webhook (dedup + enqueue) → worker (all gates) → **one small mainnet order**
   within caps → reconcile.

### 3d. Rollback / kill readiness
- **`operator_kill_all` armed + tested** (A8-H2, testnet-validated) — one click sets `trading_enabled=false` +
  `status=paused` (fail-closed, audited, reversible LOCK).
- **Instant disarm:** `QUEUE_ENABLED=false` and/or `PRAXIS_IS_PRODUCTION=false` → no-trade safe state.
- **Per-bot rollback:** repoint `credential_id` back / disarm. **Never `delete_vault_secret`** (emergency-only).

### 3e. Evidence packet (non-secret)
- Prerequisite checklist all ✅ (A1/A4/live-tier/TradingView/A11-caps) with references.
- The single order: placed within caps (record notional ≤ cap, symbol, bot — **no account balances/secrets**), reconciled
  to a terminal state.
- Kill readiness verified; caps enforced; **no secret/token/`vault_secret_id` value recorded** (fingerprint/counts only).
- Close: "tiny-live PASS" or "STOP + rollback" with the reason.

## PACKET 4 — A11 approval text (DEFINITION only — for LATER, not now) [CHANGE 6]
The tiny-live run (Packet 3) requires Oren's **written A11 approval** containing **exactly** these fields. This packet
**defines the template**; it is **not** a request for approval now.
```
A11 — REAL-FUNDS TINY-LIVE APPROVAL (Oren, written, out-of-band)
- bot_id:                <the one bot uuid>
- symbol:                <the one trading pair, e.g. BTCUSDT>
- max_notional_usdt:     <per-order cap, tiny>
- daily_cap_usdt:        <daily cap; = max_notional for a one-order run>
- allowed_side:          BUY only        (SELL requires separate approval)
- max_duration:          <arm window, e.g. "disarm after 1 order or 30 min, whichever first">
- kill_rollback:         approved — operator_kill_all authority acknowledged; disarm on demand
- real_funds_ack:        "I acknowledge this places a REAL-FUNDS order of up to <max_notional_usdt> USDT."
- date / signed:         <date> / Oren
```
- **Without every field** (incl. the explicit **real-funds acknowledgement** + caps), the tiny-live run does **not**
  proceed. Approval is per-run; a larger run needs a new A11.

## 5. Implementation slices — 4A … 4G [CHANGE 8]
| Slice | What | Kind | Buildable BEFORE the A1 answer? |
|---|---|---|---|
| **4A** | Audit fail-closed conversion (B1): in production, block/retry if an `order.blocked`/`trade.created`/`trade.filled` audit write fails | Worker code | **YES** — tier behavior, LOCAL-testable via fault injection; A1-independent |
| **4B** | Rate-limit forced-ON in production (B3): production requires `WEBHOOK_RATE_LIMIT_ENABLED=true` (startup/webhook) | Worker/webhook code | **YES** — A1-independent |
| **4C** | `pgmq_send` recovery / no-loss (B4): sweeper re-enqueues `queue_failed` + dedup made retry-safe (§2e) | Webhook + sweeper code | **YES** — A1-independent |
| **4D** | Direct-exchange route guard (B5): CI/build guard fails if the webhook bundle imports an exchange client | CI/build | **YES** — A1-independent |
| **4E** | Heartbeat/staleness gate (B2): live tier requires `HEALTHCHECKS_URL`; staleness detectable | Worker startup code | **YES** — A1-independent |
| **4F** | TradingView production runbook (Packet 2) | Doc/runbook | **YES (doc)** — TV alert *creation* is Oren/external, after A1+A4 |
| **4G** | Tiny-live preflight packet (Packet 3 + A11 template) | Doc/runbook | **YES (doc)** — execution after A1+A4+A11 |

**⇒ ALL of 4A-4G can be authored (and 4A-4E built + LOCAL-tested) BEFORE the A1 answer** — they are live-tier behavior +
docs, not mainnet-dependent. Their **linked deploy + production-readiness/tiny-live proofs are gated** (need the real live
config + A1/A4/A11), but the **code + LOCAL tests are A1-independent**. Each slice = its own Codex-reviewed + LOCAL-tested
change; nothing deploys without its own go.

## 6. Progress [CHANGE 9]
**Planning does NOT advance progress.** **4/5 does not START until A1 (2/5) and A4 (3/5) are materially ready.** These
packets are authoring-ahead of that gate.

**Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.**

---
**Net:** Packet 1 = live-tier fail-closed with **triaged severity** (5 hard blockers B1-B5 before any tiny-live; S1-S3
before limited production; BL backlog) — the order spine is already fail-closed. Packet 2 = TradingView → webhook → queue
hardening (**one bot-token, no-exposure + rotation, no direct exchange call, dedup, `pgmq_send` both-persist-and-retry with
a sweeper as the no-loss guarantee**). Packet 3 = the single A11-gated tiny-live step with a **one-order-only guard**.
Packet 4 = the **A11 approval template**. Slices **4A-4G** are all authorable before the A1 answer (4A-4E code + LOCAL
tests; 4F-4G docs). **Planning/runbooks only — no code, no DB mutation, no deploy, no Railway/Doppler, no secrets, no
mainnet.** **Real funds remain NO-GO.**

**Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.**
