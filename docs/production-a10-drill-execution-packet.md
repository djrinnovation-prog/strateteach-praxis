# A10 Drill — EXECUTION PACKET

> **Codex PASS · READY FOR OREN APPROVAL · NOT RUN.** _updated by Codex at Oren request._ · 2026-07-06.
> Exact execution checklist derived from the approved A10 plan + live repo/schema (read-only discovery 2026-07-06).
> **No action is taken by this doc.** All mutations below are marked **DO NOT RUN** — no DB mutation, no
> `QUEUE_ENABLED`/`trading_enabled` change, no endpoint fire, no deploy, no mainnet, no real funds.
> Related: [A8 kill-path](production-a8-kill-path-readiness-packet.md) (K1–K4 ↔ KP1–KP4), A10 plan §10.
>
> **Status (exact) — updated after the drill run:**
> - **A10 drill = RUN + PASS** (2026-07-06; Codex PASS on evidence). See "Drill run — results + evidence" at the end.
> - **K1 / K2 / K3 / K4 = all PASS.**
> - **System fully disarmed; PC0 baseline restored.**
> - **XRPUSDT token rotation REQUIRED before live; BNBUSDT token rotation REQUIRED before live.**
> - **Real funds remain NO-GO.**

## 0. Discovery basis (live, read-only · 2026-07-06)
- Bots: 5, `exchange_environment=testnet`, shared credential `2b5c038a-a4a7-4be5-b2fe-90d32f67781b`, `status=active`,
  `trading_enabled=false`, caps `fixed=20 / max=25 / daily=100`.
  IDs — BNBUSDT `36b46eb3` · BTCUSDT `2dcaddba` · ETHUSDT `c8913354` · SOLUSDT `5acc84c9` · **XRPUSDT
  `297dddb9-965b-49ff-abd8-e3e8e88fa4fc`**.
- `bot_status` enum = `pending_setup, active, paused, error, deleted` → K4 uses **`paused`**.
- pgmq (service_role EXECUTE ✅): `pgmq.read`, `pgmq.delete(q,msg_id)`, `pgmq.purge_queue(q)`; length wrapper
  `public.pgmq_queue_length('trade_signals')`. Current `queue_length = 0`.
- `worker_status` = `singleton, queue_enabled, is_production, worker_state, boot_stuck_count, updated_at`.
  Current: `queue_enabled=false, worker_state=disabled, is_production=false`.
- `operator_status()` = function → `jsonb`.
- Webhook: `POST /functions/v1/webhook/{bot_id}/{secret}` (bot_id + token in **URL path**); body requires
  `signal_id` (non-empty string) + `action` ∈ `buy|sell`. `bot_not_active` rejects **before** enqueue/`webhook_logs`.

## 1. Drill bot candidate — **XRPUSDT `297dddb9-965b-49ff-abd8-e3e8e88fa4fc`** (NOT BLOCKED)
A safe candidate exists → **not BLOCKED**. Chosen: XRPUSDT.
- **Why XRP:** testnet; its own token (`PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN`); low unit price → a tiny cap is safely
  above the exchange min-notional; equal in every other respect to the others. **Equally-valid alternates:** BTCUSDT
  `2dcaddba`, ETHUSDT `c8913354`, SOLUSDT `5acc84c9` (any non-BNB testnet bot).
- **Token exposure — mandatory record (accept before drill).** The token is passed in the webhook **URL path** →
  it lands in shell history + process argv → **local exposure** (same vector that flagged BNBUSDT). Therefore:
  1. **Use the XRP token ONCE, for this drill only.**
  2. **Rotate `PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN` + re-hash bot `297dddb9` immediately after the drill.**
  3. **Do NOT reuse the same token again for live / TradingView / any execution.**
  4. **No token value in any doc, log, or chat** — env var only (§7).
  Mitigate during the drill: `unset HISTFILE` (still argv-visible → rotation is still required, not optional).

## 2. Why **not** BNBUSDT `36b46eb3`
BNBUSDT's webhook token was **locally exposed** (H5 N2–N4, operator terminal) → per the standing rule + memory
`praxis-bnbusdt-token-rotation`, it is **ROTATION REQUIRED BEFORE ANY LIVE EXECUTION / do not reuse**. Using it for the
drill would re-fire a token already flagged compromised. **Excluded.**

## 3. Required caps (safety belt — set during ARM)
Kills block **before** an order forms (K1 at `assertTradingEnabled`, before sizing; K2/K3 never consume; K4 never
enqueues) → caps are never exercised in a clean drill. Set them tiny anyway so that **if a kill failed**, any slipped
testnet order is ~$6:
- `fixed_notional_usdt = 6`, `max_order_notional_usdt = 6`, `daily_notional_cap_usdt = 6`
  (6 ≥ testnet MIN_NOTIONAL ≈ 5 → a slipped order would be a *valid tiny* order, proving the kill — not min-notional —
  is what blocks).

## 4. Roles & approval
- **Approves ARM:** **Oren** — explicit, written, per-window. No ARM without it.
- **Runs every mutation** (DB SQL, Doppler, Railway, curl): **Operator** (holds the token; token never seen by
  Claude/Codex).
- **Runs read-backs** (read-only SQL): Operator or Claude (read-only). **Records evidence:** Claude. **Reviews:** Codex.
- **Environment invariant throughout:** `PRAXIS_IS_PRODUCTION=false` / `worker_status.is_production=false` (testnet).

## 5. Pre-check (READ-ONLY — run before ARM; all must hold)
```sql
-- PC0 CAPTURE the drill bot's baseline — RECORD these exact values; the final restore (§11 D1)
-- restores THESE, not any hardcoded numbers.
SELECT id, trading_pair, status::text AS status, trading_enabled,
       fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sizing_mode
FROM public.bots WHERE id='297dddb9-965b-49ff-abd8-e3e8e88fa4fc';
-- write the returned status / trading_enabled / caps into the run record → they are the restore target.

-- PC1 candidate + all bots disarmed
SELECT id, trading_pair, status::text AS status, trading_enabled,
       fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt
FROM public.bots WHERE deleted_at IS NULL ORDER BY trading_pair;
-- expect: XRPUSDT present; ALL trading_enabled=false; all status=active

-- PC2 enabled-bot count == 0
SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled AND deleted_at IS NULL;   -- expect 0

-- PC3 worker disarmed
SELECT queue_enabled, worker_state, is_production, updated_at, now()-updated_at AS heartbeat_age
FROM public.worker_status;   -- expect queue_enabled=false, worker_state=disabled, is_production=false

-- PC4 queue empty
SELECT public.pgmq_queue_length('trade_signals') AS queue_length;   -- expect 0

-- PC5 credential valid + testnet
SELECT id, status::text AS status, exchange_environment
FROM public.user_exchange_credentials WHERE id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b';  -- expect valid / testnet

-- PC6 operator-facing snapshot
SELECT public.operator_status();
```
**Stop** if any pre-check fails.

## 6. ARM (DO NOT RUN — only after Oren approval)
```sql
-- ARM-DB (DO NOT RUN) — enable candidate + set tiny caps
UPDATE public.bots
SET trading_enabled = true,
    fixed_notional_usdt = 6, max_order_notional_usdt = 6, daily_notional_cap_usdt = 6
WHERE id = '297dddb9-965b-49ff-abd8-e3e8e88fa4fc';
```
```text
ARM-QUEUE (DO NOT RUN) — Doppler + Railway (NOT SQL, NOT a REST endpoint):
  1. Doppler: set QUEUE_ENABLED=true  (source-of-record; syncs to Railway)
  2. Railway: redeploy the worker service so it re-reads QUEUE_ENABLED at boot
     (no railway CLI on this machine → Railway dashboard action)
```
**Read-back after ARM (read-only):**
```sql
SELECT id, trading_pair, trading_enabled, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt
FROM public.bots WHERE id='297dddb9-965b-49ff-abd8-e3e8e88fa4fc';   -- trading_enabled=true, caps=6
SELECT queue_enabled, worker_state, is_production, now()-updated_at AS heartbeat_age FROM public.worker_status;
-- expect queue_enabled=true, worker_state=running (post-redeploy), fresh heartbeat
SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled AND deleted_at IS NULL;  -- expect 1
```
> **Never fire a webhook while armed+enabled** — that is a positive fill (H6), not this drill. In each K test below,
> the kill is applied **first**, then the signal is fired.

## 7. Curl template (operator terminal only — token as env var, never printed)
```bash
# operator terminal ONLY; token + base URL are operator-held; never echoed into this doc/chat
unset HISTFILE
export XRP_TOKEN="$(doppler secrets get PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN --plain)"   # value never printed
export FN_URL="https://<PROJECT-REF>.supabase.co/functions/v1/webhook"                    # operator fills PROJECT-REF
BOT=297dddb9-965b-49ff-abd8-e3e8e88fa4fc
SIG="A10-<Kn>-$(date +%s)"          # unique per fire, e.g. A10-K1-...
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "$FN_URL/$BOT/$XRP_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"signal_id\":\"$SIG\",\"action\":\"buy\"}"
# expect HTTP 200 in every drill case (accept-shaped or reject-shaped are both 200)
```
Record only: the `SIG` string, the HTTP code, and the read-back rows. **Never** the token.

## 8. Kill tests — each: apply kill → fire → read-back → (cleanup if enqueued) → restore

### K1 — `trading_enabled=false` (KP1, fastest/safest)
- **Kill (DO NOT RUN):** `UPDATE public.bots SET trading_enabled=false WHERE id='297dddb9-...';`
- **Fire:** `SIG=A10-K1-…`, action `buy`.
- **Code basis — `0` trade rows is verified, not assumed** (worker/src/index.ts):
  - `assertTradingEnabled(botSizing)` runs at **index.ts:860**, inside the buy-gate `try` (859–867), **before** the
    adapter (872) and **before** `INSERT trades(pending)` (949–950).
  - `trading_enabled=false` ⇒ `assertTradingEnabled` throws `RiskLimitExceededError('trading_disabled')`
    (sizingRisk.ts:166–167) ⇒ caught at **index.ts:865** ⇒ `onSizingError` (819) writes an **`order.blocked`** audit
    (824–827) and returns `{ ack: true }`. Comment 817–818: *"There is no trade row for a blocked order."*
  - The early `return` at **866** means the adapter / `getMarketRules` / `fetchBalance` / `INSERT trades(pending)` /
    `createOrder` are **never reached** ⇒ **no trade row, no reservation, no exchange call.**
- **Expected:** worker consumes → gate blocks → **`order.blocked`** audit (`event_type='order.blocked'`,
  `after_state.reason='trading_disabled'`, `kind='RiskLimitExceededError'`, `where='gates'`); **0 trades rows**, no fill;
  queue returns to 0 (consumed + acked). **Timing target: < ~5 s** (per-signal, immediate).
- **Read-back:**
```sql
SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled AND deleted_at IS NULL;  -- 0
SELECT id, signal_id, status::text FROM public.trades WHERE signal_id = 'A10-K1-…';             -- 0 rows (unreached)
SELECT event_type, after_state, created_at FROM public.audit_logs
  WHERE entity_id='297dddb9-965b-49ff-abd8-e3e8e88fa4fc' AND event_type='order.blocked'
  ORDER BY created_at DESC LIMIT 5;         -- 1 new row; after_state.reason='trading_disabled', where='gates'
SELECT public.pgmq_queue_length('trade_signals');                                                -- 0
```
- **Restore for next test (DO NOT RUN):** `UPDATE public.bots SET trading_enabled=true WHERE id='297dddb9-...';`

### K2 — `QUEUE_ENABLED=false` + redeploy (KP2)
- **Kill (DO NOT RUN):** Doppler `QUEUE_ENABLED=false` → Railway redeploy worker (takes effect **only after restart**).
- **Fire:** `SIG=A10-K2-…` (bot `trading_enabled=true`, so it is the QUEUE that must stop it).
- **Expected:** webhook **enqueues** (enqueue is independent of `QUEUE_ENABLED`) → `queue_length +1` and **stays**;
  worker `worker_state=disabled` does **not** consume; **no trades row**, no fill. **Timing target: redeploy latency
  ~1–3 min** (documents that KP2 is not instant — use KP1 for a fast kill).
- **Read-back:**
```sql
SELECT queue_enabled, worker_state, now()-updated_at AS heartbeat_age FROM public.worker_status;  -- false / disabled
SELECT public.pgmq_queue_length('trade_signals');                                                  -- >= 1 (stays)
SELECT id, signal_id FROM public.trades WHERE signal_id = 'A10-K2-…';                               -- 0 rows
```
- **Queue cleanup (DO NOT RUN — after read-back):**
```sql
SELECT msg_id, message->>'bot_id' AS bot_id, message->>'signal_id' AS signal_id
FROM pgmq.read('trade_signals', 0, 10, NULL);        -- inspect; verify it is the A10-K2 drill message
SELECT pgmq.delete('trade_signals', <msg_id>);        -- delete that specific message
SELECT public.pgmq_queue_length('trade_signals');     -- expect 0
```
> **Default cleanup is SCOPED delete only** — read → identify by `message->>'signal_id'` **and** `message->>'bot_id'`
> matching the drill → `pgmq.delete('trade_signals', <msg_id>)` for that msg_id only. **`pgmq.purge_queue` is NOT normal
> cleanup** — it is an **emergency fallback requiring explicit Oren approval** (see §9), never a default step.
>
> **Runtime note (Codex):** do **not** issue repeated `pgmq.read` calls without an **immediate** scoped
> `pgmq.delete` + length read-back on each. One read → verify `bot_id`+`signal_id` → delete that msg_id → confirm
> length — never a read/read/read loop that leaves the queue in a half-inspected state.
- **Restore (DO NOT RUN):** Doppler `QUEUE_ENABLED=true` → Railway redeploy → worker `running`.

### K3 — Railway worker stop (KP3)
- **Kill (DO NOT RUN):** Railway dashboard → **stop** the worker service (armed baseline: `QUEUE_ENABLED=true`,
  `trading_enabled=true`, worker running — so the *service stop* is what halts consumption).
- **Fire:** `SIG=A10-K3-…`.
- **Expected:** webhook enqueues → `queue_length +1` and **stays** (worker down, no consume); `worker_status.updated_at`
  goes **stale** (heartbeat stops); **no trades row**, no fill. **Timing target: stop within ~30–60 s** (Railway).
- **Read-back:**
```sql
SELECT worker_state, now()-updated_at AS heartbeat_age FROM public.worker_status;   -- heartbeat stale/growing
SELECT public.pgmq_queue_length('trade_signals');                                    -- >= 1 (stays)
SELECT id, signal_id FROM public.trades WHERE signal_id = 'A10-K3-…';                 -- 0 rows
```
- **Queue cleanup (DO NOT RUN):** same pgmq.read → verify `A10-K3` → `pgmq.delete('trade_signals', <msg_id>)` → length 0.
- **Restore (DO NOT RUN):** Railway → **start** the worker service; confirm `worker_state=running`, fresh heartbeat.

### K4 — bot status `paused` (KP4 intake reject; also closes H5 N5)
- **Kill (DO NOT RUN):** `UPDATE public.bots SET status='paused' WHERE id='297dddb9-...';` (armed baseline otherwise).
- **Fire:** `SIG=A10-K4-…` **with the valid token** (must pass auth to reach the `bot_not_active` check).
- **Expected:** webhook rejects `bot_not_active` **before** enqueue/`webhook_logs` upsert → HTTP 200, **no enqueue**
  (`queue_length` unchanged = 0), **no `webhook_logs` row** for that `signal_id`, **no trades row**. **Timing target:
  immediate (per-request).** This also provides the **H5 N5 `bot_not_active`** evidence.
- **Read-back:**
```sql
SELECT public.pgmq_queue_length('trade_signals');                                    -- unchanged (0)
SELECT bot_id, signal_id, status FROM public.webhook_logs
  WHERE bot_id='297dddb9-965b-49ff-abd8-e3e8e88fa4fc' AND signal_id='A10-K4-…';       -- 0 rows (rejected pre-upsert)
SELECT id, signal_id FROM public.trades WHERE signal_id = 'A10-K4-…';                 -- 0 rows
```
- **Restore (DO NOT RUN):** `UPDATE public.bots SET status='active' WHERE id='297dddb9-...';`

## 9. Emergency rollback (if anything unexpected — DO NOT RUN unless triggered)
```sql
-- E-DB (DO NOT RUN) — disarm ALL bots immediately (KP1, fastest)
UPDATE public.bots SET trading_enabled=false WHERE deleted_at IS NULL;
```
```text
E-QUEUE (DO NOT RUN): Doppler QUEUE_ENABLED=false → Railway redeploy (or Railway: stop worker service — KP3).
```
```sql
-- E-PURGE (DO NOT RUN) — EMERGENCY ONLY, requires explicit Oren approval; drain the queue after the worker
-- is down. This is the ONLY sanctioned use of purge_queue; normal cleanup is scoped delete (§8, §11 D3).
SELECT pgmq.purge_queue('trade_signals');
```
**Emergency read-back (read-only):**
```sql
SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled AND deleted_at IS NULL;   -- 0
SELECT queue_enabled, worker_state FROM public.worker_status;                                     -- false / disabled
SELECT public.pgmq_queue_length('trade_signals');                                                 -- 0
```

## 10. PASS / NO-GO table
| Test | PASS condition | NO-GO (abort → §9) |
|------|----------------|--------------------|
| Pre-check | PC1–PC6 all hold (disarmed, queue 0, cred valid, testnet) | any fails |
| ARM | `trading_enabled=true`+caps=6 (1 bot), `queue_enabled=true`, `worker_state=running` | mismatch on read-back |
| **K1** | `enabled_bots=0`, `order.blocked` audit, **0 trades**, queue→0, ≤~5 s | any trade row / fill / no block |
| **K2** | `worker_state=disabled`, queue `+1` stays, **0 trades**; cleanup→0 | worker consumes / any trade |
| **K3** | heartbeat stale, queue `+1` stays, **0 trades**; cleanup→0 | worker consumes / any trade |
| **K4** | `bot_not_active`, queue unchanged, **0 webhook_logs**, **0 trades** | enqueue / trade row |
| Disarm | full disarmed read-back (below) all hold | any residual armed state |
- **Overall PASS** = all K1–K4 PASS **and** final disarm clean. Any single NO-GO ⇒ abort, run §9, do not proceed.

## 11. Final disarm checklist (DO NOT RUN until drill complete)
```sql
-- D1 (DO NOT RUN) restore the PC0-captured baseline EXACTLY for the drill bot; end disarmed.
-- Substitute <cap_fixed> <cap_max> <cap_daily> <status> with the values CAPTURED in PC0 (§5) —
-- do NOT hardcode. trading_enabled ends false (disarm; PC0 baseline was also false).
UPDATE public.bots
SET trading_enabled     = false,
    fixed_notional_usdt = <cap_fixed>, max_order_notional_usdt = <cap_max>, daily_notional_cap_usdt = <cap_daily>,
    status              = '<status>'
WHERE id='297dddb9-965b-49ff-abd8-e3e8e88fa4fc';
```
```text
D2 (DO NOT RUN): Doppler QUEUE_ENABLED=false → Railway redeploy (worker_state=disabled).
```
```sql
-- D3 (DO NOT RUN) SCOPED residual cleanup — after per-K cleanup the queue should already be 0.
SELECT public.pgmq_queue_length('trade_signals');   -- expect already 0
-- If >0: inspect and delete ONLY drill messages (signal_id LIKE 'A10-%' AND bot_id = drill bot):
SELECT msg_id, message->>'bot_id' AS bot_id, message->>'signal_id' AS signal_id
FROM pgmq.read('trade_signals', 0, 50, NULL);
SELECT pgmq.delete('trade_signals', <msg_id>);      -- per matching msg_id only
-- pgmq.purge_queue is EMERGENCY-ONLY and requires explicit Oren approval (§9) — NOT a default disarm step.
-- D4 disarmed read-back (read-only) — ALL must hold:
SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled AND deleted_at IS NULL;   -- 0
SELECT queue_enabled, worker_state, is_production FROM public.worker_status;                      -- false/disabled/false
SELECT public.pgmq_queue_length('trade_signals');                                                 -- 0
SELECT id, trading_pair, status::text, trading_enabled, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt
FROM public.bots WHERE deleted_at IS NULL ORDER BY trading_pair;                                   -- all off, caps restored
```
**D5 — post-drill token hygiene:** the XRPUSDT token was used from the operator terminal → **treat as locally-exposed →
rotate `PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN` + re-hash bot `297dddb9` before any live execution** (same rule as
BNBUSDT). Record in the rotation list.

## 12. Remaining unknowns / operator-supplied
- **Supabase functions base URL / project ref** — operator fills `<PROJECT-REF>` in §7 (known from prior H5 fires; not
  recorded here).
- **Railway redeploy/stop are dashboard actions** (no railway CLI on this machine) → operator-driven; timing (§8 K2/K3)
  is observed, not asserted.
- **Manual DB/Doppler/Railway kills are not self-audited** (A8 G4) — the drill records evidence manually; an audited
  one-action kill is the later A8-H / console slice, **not** part of this drill.
- **`order.blocked` audit — now CONFIRMED from code** (index.ts:824): `event_type='order.blocked'`, `after_state`
  = `{signal_id, side, reason, kind, where}`; K1 reason = `trading_disabled` (sizingRisk.ts:167). No longer an unknown.

---

## Revision — Codex CHANGES round 1 applied (2026-07-06)
1. **K1 trade-row expectation — verified from code, kept at 0 rows.** `assertTradingEnabled` @index.ts:860 (try 859–867)
   runs before `INSERT trades(pending)` @949–950; throw → catch @865 → `order.blocked` audit @824, `{ack:true}`, early
   `return` @866 ⇒ trade INSERT unreached. Cited in §8 K1.
2. **Restore baseline — no hardcoded caps.** Added PC0 (§5) to capture the drill bot's `status`/`trading_enabled`/caps;
   §11 D1 now restores the **captured** values (placeholders), not `20/25/100`.
3. **Queue cleanup — scoped by default.** §8/§11 D3 = read → match `signal_id`+`bot_id` → `pgmq.delete(<msg_id>)` only.
   `pgmq.purge_queue` is emergency-only with explicit Oren approval (§9).
4. **XRP token exposure — recorded (§1, §11 D5):** use once for drill only · rotate
   `PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN` after · never reuse for live/TradingView/execution · no token value in
   any doc/log/chat.

---

## Drill run — results + evidence (RUN + PASS · Codex PASS · 2026-07-06)
_updated by Codex at Oren request._

**Metadata**
- **Window:** 2026-07-06, ~08:56 UTC (ARM) → ~09:48 UTC (final disarm), ≈ 52 min (from Railway boot logs: ARM
  deploy 08:56:49Z → disarm deploy 09:48:03Z).
- **ARM approved by:** Oren (explicit window; scope: testnet only / XRPUSDT only / caps 6-6-6 / no BNBUSDT /
  no mainnet / no real funds / K1–K4 + final disarm).
- **Ran all mutations / Doppler / Railway / curl:** Operator. **Ran all read-backs (read-only):** Claude.
- **Bot:** XRPUSDT `297dddb9-965b-49ff-abd8-e3e8e88fa4fc`. **Environment:** testnet only — `is_production=false`
  verified at ARM, throughout, and at disarm. **Caps during drill:** `6 / 6 / 6`.
- **Final restored baseline (PC0):** `status=active` / `trading_enabled=false` / caps `20 / 25 / 100` — verified.

**Kill-path results (each fired once, valid token, HTTP 200)**
| Kill | Mechanism | Evidence | Verdict |
|------|-----------|----------|---------|
| **K1** | `trading_enabled=false` (KP1) · SIG `A10-K1-1783328969` | `webhook_logs=1` (enqueued) → worker consumed → **`order.blocked`**, `reason=trading_disabled`; **0 trades**; `queue_length` → **0** | **PASS** |
| **K2** | `QUEUE_ENABLED=false`+redeploy (KP2) · SIG `A10-K2-1783329853` | bot re-armed; `worker_queue_disabled`; `webhook_logs=1`; **`msg_id=86` stuck** (verified sig+bot), `order.blocked=0` (not consumed); **0 trades**; scoped `pgmq.delete(86)` → 0 | **PASS** |
| **K3** | Railway worker stop (KP3) · SIG `A10-K3-1783330622` | worker consume-capable then stopped (`updated_at` frozen 09:34:15, heartbeat 96s→124s); `webhook_logs=1`; **`msg_id=87` stuck**, `order.blocked=0`; **0 trades**; scoped `pgmq.delete(87)` → 0; worker restarted | **PASS** |
| **K4** | `status=paused` (KP4) · SIG `A10-K4-1783331166` | rejected **`bot_not_active`** pre-enqueue: `webhook_logs=0`, `queue_length=0`/`q=0` (0 enqueue), `order.blocked=0`; **0 trades** — **also closes H5 N5** | **PASS** |

**Final disarmed read-back (D4) — raw-verified:** `enabled_bots=0` · `worker_status.queue_enabled=false` ·
`worker_state=disabled` · `is_production=false` · `queue_length=0` · `q_trade_signals` rows `=0` · all bots
`trading_enabled=false` (BNB/BTC/ETH/SOL/XRP) · `open_trades=0`.

**Outcome**
- **Zero orders, zero trades, zero fills** across the entire drill. Every kill path stopped execution at its intended
  layer. Both stuck messages cleaned by **scoped `pgmq.delete` only — no `purge_queue`**. Full disarm + PC0 baseline
  restored, all verified by raw read-back.
- **A10 drill = RUN + PASS.** K1/K2/K3/K4 all PASS. **H5 N5** (`bot_not_active`) closed via K4.

**Post-drill obligations (before any live execution)**
- **XRPUSDT** `PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN` (bot `297dddb9`) — A10 local exposure → rotate + re-hash.
- **BNBUSDT** `PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN` (bot `36b46eb3`) — H5 local exposure → rotate + re-hash.

**Real funds = NO-GO** (unchanged): the drill closes the *runtime kill-proof* prerequisite, but real funds still require
the audited one-action kill (A8-H2), KP5 blast-radius handling (A8-H3), A1/A4 hardening, A5 deploy + H6, A11 written
approval, and the two token rotations. **A10 runtime evidence exists; A8 real-funds remains OPEN until the audited
one-click kill.**
