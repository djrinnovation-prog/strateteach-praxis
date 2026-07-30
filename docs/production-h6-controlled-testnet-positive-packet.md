# H6 — Controlled Testnet Positive (execution packet)

> **H6 = RUN + PASS (testnet, 2026-07-07) · Codex PASS.** _updated by Codex at Oren request._ See "Run — results +
> evidence" at the end. Corrected after the SOLUSDT historical-usage investigation (2026-07-06) disproved the
> "clean/never-exposed" premise; then RUN under explicit Oren ARM approval.
>
> **Status (exact):**
> - **H6 = RUN + PASS** (signal `H6-1783419859`, SOLUSDT, testnet, one `filled` trade @ 10.97 ≤ cap 11).
> - **System fully disarmed; PC0 caps `20/25/100` restored.**
> - **PASS requires `status=filled` ONLY.** `submitted`/`unknown` = **INCONCLUSIVE / NOT PASS** until resolved.
> - **SOLUSDT token is ALREADY locally exposed (Sprint 4-2 Phase A, 2026-06-29) → ROTATION-REQUIRED NOW** (not only
>   after H6). SOL is used for H6 anyway because it is testnet + already burned (no new class of exposure).
> - **Rotation-required list (now): BNBUSDT + XRPUSDT + SOLUSDT.** **No campaign bot is virgin.**
> **Goal:** prove the POSITIVE path on testnet — valid webhook signal → queue → worker → risk checks → **real testnet
> market order → fill** → trade + audit rows → clean disarm.
> A10 (RUN + PASS) is the **rollback proof** this packet references; **H6 is its own controlled positive — do NOT combine
> with A10.** Related: [A10 drill](production-a10-drill-execution-packet.md), [A1 egress](production-a1-egress-binance-connectivity-packet.md).

## 1. Bot candidate — **SOLUSDT `5acc84c9-edd2-4c9f-87dd-fd928f8b62cd`** (NOT a "clean" bot — corrected)
> **Correction (2026-07-06):** the earlier claim that SOL's token is *clean / never exposed / self-contained* was
> **WRONG** and is removed. SOL's token is **already locally exposed** (evidence below). SOL is used for H6 not because
> it is clean, but because it is **testnet + already burned** — so H6 adds no *new class* of exposure.

**SOLUSDT historical usage (read-only evidence, 2026-06-29):**
- Used in **Sprint 4-2 Phase A** — **10 `webhook_logs`** (all `accepted`) + **10 filled testnet `trades`** (signal_ids
  `S42A-20260629-0827-SOLUSDT-01…10`, all with an exchange order id).
- All 10 webhooks came from a **single non-TradingView IP `87.71.21.23`**, and `sprint4-s4-2-phase-a-execution-packet.md`
  fires SOL via **local curl** with the token in the URL path (`T_SOL=$(doppler secrets get …)` → `fire SOLUSDT …
  "$T_SOL"`). → **the SOL token was used through a local-terminal URL → already LOCALLY EXPOSED** (shell history/argv),
  same class as BNBUSDT/XRPUSDT.
- The raw token **value** does not appear in any committed doc (only the secret *name* / `$T_SOL` env ref); it has never
  been seen by Claude/Codex.

**Why SOL can still be used for H6 (testnet):**
- **Testnet only** (credential `2b5c038a` = testnet, `is_production=false`).
- **Already exposed** → an H6 local fire adds **no new class of exposure** (SOL is already on the rotation list).
- **Current state is clean for H6:** `open_trades=0`, `trades_dlq=0`, `queue_length=0`, SOL `trading_enabled=false`,
  worker disabled, `is_production=false`.
- **No prior H6 signals/trades** (0 `H6-*` webhook_logs, 0 `H6-*` trades) — the H6 run starts from a clean slate.

**No campaign bot is virgin** (read-only per-bot counts, 2026-07-06) — so "pick a different clean bot" is not available;
a truly clean run would need a **new provisioned bot** (explicitly NOT done now):

| Bot | webhook_logs | trades |
|---|---|---|
| BNBUSDT `36b46eb3` | 10 | 10 |
| BTCUSDT `2dcaddba` | 40 | 39 |
| ETHUSDT `c8913354` | 11 | 11 |
| SOLUSDT `5acc84c9` | 10 | 10 |
| XRPUSDT `297dddb9` | 14 | 11 |

- **Shared credential — explicit record:** SOLUSDT uses the **shared testnet credential `2b5c038a`** (backs all 5 bots),
  `status=valid`, `exchange_environment=testnet`. **Testnet only.** For **real funds** the shared-credential **blast
  radius remains NO-GO** until A4 credential isolation + A8 KP5 handling close. H6 does not change this.

## 2. Token rotation — SOL is rotation-required NOW (mandatory record)
- **SOLUSDT `PRAXIS_CAMPAIGN_SOLUSDT_WEBHOOK_TOKEN` (bot `5acc84c9`) is ALREADY locally exposed** (Sprint 4-2 Phase A,
  2026-06-29, local-terminal URL fires — §1) → it is **ROTATION-REQUIRED NOW, not only after H6.** Add it to the
  rotation list **immediately**, alongside BNBUSDT + XRPUSDT.
- **Rotation-required list (now): BNBUSDT `36b46eb3` + XRPUSDT `297dddb9` + SOLUSDT `5acc84c9`.**
- H6 fires the SOL token again from the operator terminal (URL path) → **re-exposure** (no new class; it is already
  burned). **Do NOT reuse the SOL token for any live / TradingView / execution use until rotated** (rotate the Doppler
  secret + re-hash `bots.webhook_secret_hash` for `5acc84c9`, per the
  [rotation runbook](production-webhook-token-rotation-runbook.md)).
- **Record:** SOL token already burned → rotation-required now · used once more for H6 · never reuse for
  live/TV/execution until rotated · **no token value in any doc/log/chat** (env var only, §5).

## 3. Max notional / caps (tiny, set during ARM)
- **MIN_NOTIONAL evidence:** SOLUSDT `NOTIONAL` filter **`minNotional = 5`** USDT. The H6 cap **`11` is above the floor**
  (11 > 5), so a ~$11 order clears min-notional (proves the kill/positive path, not a min-notional rejection).
- H6 needs an order that **passes** min-notional (unlike A10, where kills blocked before sizing). Caps just **above** the
  floor **and still tiny**: **`fixed_notional_usdt = 11`, `max_order_notional_usdt = 11`, `daily_notional_cap_usdt = 11`**
  (one ~$11 order max).
- **HARD PRECONDITION — MIN_NOTIONAL must be re-verified immediately before ARM.** Re-confirm the live SOLUSDT
  `minNotional` (Binance testnet symbol filters / a worker `getMarketRules` read) in the **same window** as ARM. **If it
  is not verified right before ARM, H6 is NO-GO** — do not arm on the recorded `5` alone. Set the three caps **>
  verified `minNotional`** yet tiny, kept equal so only **one** order is possible. (A cap below the floor would confound
  the positive test; an unverified floor is an automatic NO-GO.)

## 4. Pre-check (READ-ONLY — all must hold before ARM)
```sql
-- PC0 CAPTURE the drill bot baseline — restore target for §8 disarm (do NOT hardcode later).
SELECT id, trading_pair, status::text AS status, trading_enabled,
       fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt, sizing_mode
FROM public.bots WHERE id='5acc84c9-edd2-4c9f-87dd-fd928f8b62cd';

-- PC1 fully disarmed baseline
SELECT 'enabled_bots' AS k, count(*)::text v FROM public.bots WHERE trading_enabled AND deleted_at IS NULL
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text
UNION ALL SELECT 'open_trades', count(*)::text FROM public.trades WHERE status::text IN ('pending','submitted','unknown')
UNION ALL SELECT 'trades_dlq', count(*)::text FROM public.trades_dlq
UNION ALL SELECT 'ws.queue_enabled', queue_enabled::text FROM public.worker_status
UNION ALL SELECT 'ws.worker_state', worker_state FROM public.worker_status
UNION ALL SELECT 'ws.is_production', is_production::text FROM public.worker_status;
-- expect: enabled_bots 0, queue 0, open_trades 0, dlq 0, queue_enabled false, worker_state disabled, is_production false

-- PC2 candidate + credential
SELECT b.status::text AS bot_status, b.trading_enabled, c.status::text AS cred_status, c.exchange_environment
FROM public.bots b JOIN public.user_exchange_credentials c ON c.id=b.credential_id
WHERE b.id='5acc84c9-edd2-4c9f-87dd-fd928f8b62cd';
-- expect: active / false / valid / testnet
```
**Stop** if any pre-check fails. **`is_production=false` is a hard gate — if true, ABORT.**

## 5. ARM (DO NOT RUN — only after explicit Oren approval)
```sql
-- ARM-DB (DO NOT RUN) enable candidate + tiny caps (confirm MIN_NOTIONAL first, §3)
UPDATE public.bots
SET trading_enabled = true,
    fixed_notional_usdt = 11, max_order_notional_usdt = 11, daily_notional_cap_usdt = 11
WHERE id = '5acc84c9-edd2-4c9f-87dd-fd928f8b62cd';
```
```text
ARM-QUEUE (DO NOT RUN): Doppler QUEUE_ENABLED=true → Railway redeploy worker → wait for worker_running.
```
**Read-back after ARM (read-only):** `trading_enabled=true` + caps `11/11/11`; `queue_enabled=true`,
`worker_state=running`, fresh heartbeat; `enabled_bots=1` (SOL only); `queue_length=0`.

## 6. Fire ONE valid signal (operator terminal — token as env var only)
```bash
unset HISTFILE
export SOL_TOKEN='...'   # from Doppler dashboard; local terminal only, NEVER printed/pasted to chat
export FN_URL="https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook"
BOT=5acc84c9-edd2-4c9f-87dd-fd928f8b62cd
SIG="H6-$(date +%s)"
echo "SIG=$SIG"                      # record for read-back
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "$FN_URL/$BOT/$SOL_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"signal_id\":\"$SIG\",\"action\":\"buy\"}"
```
Expect **HTTP 200**. Fire **once only**. This is a **real testnet BUY** — the worker will place a `market` order.

## 7. Expected trade + audit rows (exact, from worker code)
Path: enqueue → worker gates pass (`assertTradingEnabled`✓, `assertExchangeEnvironment`✓ testnet, `isBotConfigReady`✓) →
`INSERT trades(pending)` (index.ts:948) → `createOrder({type:'market'})` (996) → update status (1005) → audit (1064).
- **`webhook_logs`**: 1 row for SIG, `status=accepted`.
- **`trades`**: **1 row** for SIG, starting `pending`. **The outcome status is NOT guaranteed to be `filled`** — the
  worker records whatever the exchange returns (`status = order.status`, index.ts:1008). Allowed outcomes:
  - **`filled`** (expected happy path for a testnet `market` order) — `exchange_order_id` set,
    `executed_notional_usdt ≈ 11` (ccxt `cost`), `price_at_execution` set, `filled_at` set.
  - **`submitted`** — order accepted by the venue but not yet reported filled; `exchange_order_id` set, `filled_at`
    null. **NOT an H6 PASS by itself** — non-terminal, and `submitted` **counts as `open_trades`** → the final
    disarmed read-back (`open_trades=0`) cannot hold. → **inconclusive / reconcile** (§9, §14) until it resolves to
    `filled`.
  - **`unknown`** — `createOrder` succeeded but the DB status update failed (index.ts:1022/1042) → a
    `reconciliation_jobs` row is created (1048); the order **may** be on the exchange → **reconciliation path** (§8b),
    NOT a lost order and **NOT a PASS** until reconciled to `filled`.
  - `side=buy`, `client_order_id` `PRX_…`, `requested_notional_usdt ≈ 11` in all cases.
- **Only `status=filled` is an H6 PASS (§14).** `submitted`/`unknown` ⇒ H6 **INCONCLUSIVE / NOT PASS** until resolved.
- **`audit_logs`** (entity_type=`trade`, entity_id=tradeId): **`trade.created`** (after `{status:pending,…}`) then
  **`trade.<status>`** — `trade.filled` / `trade.submitted` on success, or **`trade.unknown`** on the reconciliation path.
- **`queue_length`**: transient `+1 → 0` (consumed + acked). **`trades_dlq`**: unchanged (0).
- Worker logs: `trade_pending` then `trade_executed`.

## 8. Kill / disarm sequence
### 8a — after a successful FILL
```sql
-- D-DB (DO NOT RUN) instant stop (KP1) + restore PC0 baseline caps/status; end disarmed.
UPDATE public.bots
SET trading_enabled=false,
    fixed_notional_usdt=<PC0_fixed>, max_order_notional_usdt=<PC0_max>, daily_notional_cap_usdt=<PC0_daily>,
    status='active'
WHERE id='5acc84c9-edd2-4c9f-87dd-fd928f8b62cd';
```
```text
D-QUEUE (DO NOT RUN): Doppler QUEUE_ENABLED=false → Railway redeploy (worker_state=disabled).
```
- **Residual position note:** the fill leaves a **tiny (~$11) testnet SOL position**. **SELL is OFF in v1**
  (`sell_not_enabled`, index.ts:854) → no automated unwind; the position sits on the **testnet** account (play money) —
  acceptable. Operator MAY manually flatten on the Binance **testnet** UI; not required.

### 8b — after a TIMEOUT / non-terminal trade (§9)
1. **Immediately** disarm (KP1 `trading_enabled=false`) **+** `QUEUE_ENABLED=false`/redeploy (or stop the worker, KP3)
   to prevent any retry. **Do NOT re-fire the same `signal_id`.**
2. Let reconciliation resolve: the worker creates a `reconciliation_jobs` row on an ambiguous outcome (index.ts:1048)
   and boot reconciliation (>60s) is the backstop; a DB-update-fail-after-order-success marks the trade `unknown`
   (1042) — **not** a lost order.
3. Read `trades.status` + `reconciliation_jobs` + the `exchange_order_id` on Binance **testnet** to confirm whether the
   order actually landed **before** any further action. Never assume; verify on the exchange.

## 9. Timeout
- **Observation window: 90 s** for the trade to reach **`filled`** (the only PASS status). A `market` order normally
  fills in seconds; 90 s is generous — but a fill is **not assumed**.
- **If NOT `filled` within 90 s** — i.e. the trade is `pending`, `submitted`, or `unknown`:
  1. **Disarm** (KP1 `trading_enabled=false` + `QUEUE_ENABLED=false`/redeploy or worker stop).
  2. **Do NOT re-fire** — no second signal, ever (a re-fire risks a duplicate order).
  3. **Inspect + reconcile:** read `trades.status` + `reconciliation_jobs` + verify the `exchange_order_id` on Binance
     **testnet** to determine whether the order actually landed (§8b).
  4. **H6 is INCONCLUSIVE / NOT PASS** until the trade is resolved to **`filled`** (→ PASS) or determined an explicit
     **NO-GO**. During reconciliation `open_trades` **may be 1** (a `submitted`/`pending` row) — a **final PASS cannot be
     claimed while `open_trades ≠ 0`**.

## 10. Stop conditions (any → immediate disarm §8, abort)
- `is_production=true` at any point → **ABORT before firing** (must be testnet).
- More than **one** trade row for the SIG, an order on **any bot other than SOL**, or `executed_notional_usdt` **> cap**.
- `createOrder` error (e.g. `ExchangeNotAvailable:http_451` geo / auth) → no fill; disarm + investigate (A1 egress).
- Any worker error loop, DLQ row appearing, or a second enqueue.
- **Never** fire more than once; **never** bump caps mid-run; **never** touch BNBUSDT/XRPUSDT.

## 11. Rollback (references A10 — does NOT combine with it)
- **Primary rollback = KP1** `UPDATE bots SET trading_enabled=false` — **proven instant + safe in the A10 drill (K1:
  order.blocked, 0 trades)**. That runtime proof is why H6 can arm at all.
- Secondary: `QUEUE_ENABLED=false`+redeploy (KP2, A10 K2) / Railway worker stop (KP3, A10 K3). `pgmq.purge_queue`
  remains **emergency-only + explicit approval**; normal cleanup is scoped `pgmq.delete` by `msg_id`.
- Full disarm to the PC0 baseline is the definition of done (§12).

## 12. Final read-back (read-only — after disarm)
```sql
SELECT 'enabled_bots' AS k, count(*)::text v FROM public.bots WHERE trading_enabled AND deleted_at IS NULL   -- 0
UNION ALL SELECT 'ws.queue_enabled', queue_enabled::text FROM public.worker_status                            -- false
UNION ALL SELECT 'ws.worker_state', worker_state FROM public.worker_status                                    -- disabled
UNION ALL SELECT 'ws.is_production', is_production::text FROM public.worker_status                            -- false
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text                             -- 0
UNION ALL SELECT 'q_rows', count(*)::text FROM pgmq.q_trade_signals                                           -- 0
UNION ALL SELECT 'open_trades', count(*)::text FROM public.trades WHERE status::text IN ('pending','submitted','unknown') -- 0 (PASS)
UNION ALL SELECT 'H6 trade status', status::text FROM public.trades WHERE signal_id = 'H6-…'                  -- filled (PASS)
UNION ALL SELECT 'SOL caps restored', fixed_notional_usdt::text||'/'||max_order_notional_usdt::text||'/'||daily_notional_cap_usdt::text
  FROM public.bots WHERE id='5acc84c9-edd2-4c9f-87dd-fd928f8b62cd';                                            -- PC0 baseline
```
> **This read-back is the PASS state:** H6 trade `status=filled` **and** `open_trades=0`. If the trade is
> `submitted`/`unknown`, `open_trades` may read **1** and the disarmed baseline is not clean → **H6 is
> INCONCLUSIVE, not PASS** — reconcile (§8b/§9) to `filled` (then re-run this read-back for PASS) or record an explicit
> NO-GO. The disarm controls (`enabled_bots=0`, `queue_enabled=false`, `worker_state=disabled`, `queue_length=0`) must
> hold regardless.

## 13. Evidence table (to fill at run)
| # | Check | Expected |
|---|-------|----------|
| 1 | ARM | SOL `trading_enabled=true`, caps `11/11/11`; `queue_enabled=true`, `worker_state=running`; `enabled_bots=1` |
| 2 | Fire | HTTP 200, one SIG |
| 3 | Enqueue | `webhook_logs=1` (accepted); queue `+1→0` |
| 4 | Trade (PASS) | **exactly 1** `trades` row, **`status=filled`**, `exchange_order_id` set, `executed_notional_usdt ≤ cap`, `filled_at` set. `submitted`/`unknown` ⇒ **INCONCLUSIVE** → disarm + reconcile (§8b/§9), not PASS |
| 5 | Audit (PASS) | **`trade.created` + `trade.filled`** (entity=trade). `trade.submitted`/`trade.unknown` ⇒ inconclusive |
| 6 | Bounds | exactly 1 order, SOL only, notional ≤ cap, `is_production=false`, DLQ 0 |
| 7 | Disarm | `enabled_bots=0`, `queue_enabled=false`, `worker_state=disabled`, `queue_length=0`, **`open_trades=0`**, caps restored |

## 14. PASS / NO-GO
- **PASS requires ALL of** (strict — verified by raw read-back, `is_production=false` throughout):
  1. **exactly one** `trades` row for the SIG
  2. **`status = filled`**
  3. `exchange_order_id` set
  4. `executed_notional_usdt ≤ cap`
  5. `trade.created` **and** `trade.filled` audit rows (entity=trade)
  6. **`open_trades = 0`** at the final read-back
  7. `queue_length = 0`
  8. `worker_state = disabled` (`queue_enabled=false`)
  9. `enabled_bots = 0`
  10. caps restored to PC0 baseline
- **If `status = submitted` or `unknown`:** **disarm · do NOT re-fire · inspect/reconcile (§8b).** **H6 remains
  INCONCLUSIVE / NOT PASS** until the trade resolves to **`filled`** (→ PASS) or is recorded an explicit **NO-GO**.
  `open_trades` **may be 1 during reconciliation**, but a **final PASS cannot be claimed while `open_trades ≠ 0`**.
- **NO-GO / abort** = `is_production=true` · order on wrong bot · >1 order · notional > cap · exchange error / no order
  placed · trade stuck and unresolved · DLQ row · any kill fails.
- **Testnet = GO only with explicit Oren ARM approval** (this packet is design). **Real funds = NO-GO** — H6 is a
  testnet execution proof only; real funds still require A11 + A1/A4/A5/A8 hardening + the three token rotations.

## 15. Roles
- **Approves ARM/run:** Oren (explicit, written, per-window). **Runs every mutation/Doppler/Railway/curl:** Operator.
- **Runs read-backs (read-only) + records evidence:** Claude. **Reviews:** Codex.

---

## Revision — Codex CHANGES round 1 applied (2026-07-06)
1. **Shared credential recorded (§1):** SOLUSDT uses shared testnet cred `2b5c038a`; testnet-only acceptable; real-funds
   blast-radius NO-GO until A4/A8 hardening.
2. **MIN_NOTIONAL hard gate (§3):** verifying the live SOLUSDT MIN_NOTIONAL immediately before ARM is a hard
   precondition — unverified ⇒ H6 NO-GO; caps set above the floor and still tiny.
3. **Trade status not assumed (§7/§9/§13/§14):** happy path `filled`, but `submitted` and `unknown`/reconciliation are
   allowed; not terminal within 90 s ⇒ disarm, do not re-fire, inspect/reconcile, no second signal; `unknown` is not a
   PASS until reconciled.
4. **SOL token rotation (§2):** after H6, `PRAXIS_CAMPAIGN_SOLUSDT_WEBHOOK_TOKEN` is rotation-required before any further
   live/TV/execution; do not reuse the SOL token after H6 until rotated.

## Revision — Codex CHANGES round 2 applied (2026-07-06)
Resolved the `filled`-vs-`submitted` contradiction by adopting the **stricter** definition consistently across §7/§9/§12/
§13/§14:
- **H6 PASS requires `status=filled` AND `open_trades=0`** (+ exactly 1 trade row, `exchange_order_id`,
  `executed_notional_usdt ≤ cap`, `trade.created`+`trade.filled`, `queue_length=0`, worker disabled, `enabled_bots=0`,
  caps restored).
- **`submitted` or `unknown` ⇒ INCONCLUSIVE / NOT PASS** (since `submitted` counts as `open_trades`): disarm, do not
  re-fire, inspect/reconcile; `open_trades` may be 1 during reconciliation but a final PASS cannot be claimed until the
  trade resolves to `filled` (or an explicit NO-GO is recorded).

## Revision — SOL candidate correction (2026-07-06, after historical-usage investigation)
Read-only investigation disproved the "SOL token clean/never-exposed" premise. Corrected:
1. **Removed** the "clean / never-exposed / self-contained" claim (§1); removed "BTC/ETH are clean alternates."
2. **Recorded SOL history (§1):** Sprint 4-2 Phase A (2026-06-29) — 10 `webhook_logs` + 10 filled testnet trades; token
   fired via local-terminal URL (`$T_SOL`, single non-TV IP `87.71.21.23`) → **already locally exposed.**
3. **SOL added to the rotation-required list NOW (§2):** BNBUSDT + XRPUSDT + **SOLUSDT** — not only after H6.
4. **Why SOL still usable (§1):** testnet only · already exposed (no new class) · current state clean
   (`open_trades=0`, `dlq=0`, `queue=0`, `trading_enabled=false`, worker disabled, `is_production=false`) · no prior
   `H6-*` signals/trades.
5. **No campaign bot is virgin (§1):** BNB/BTC/ETH/SOL/XRP all have historical usage → "different clean bot" is not
   available; a truly clean run needs a **new provisioned bot** (explicitly NOT done now).
6. **Unchanged:** PASS criteria (`filled` only, one signal, one trade, `open_trades=0`, full disarm + PC0 restore);
   caps lifecycle (PC0 `20/25/100` → ARM `11/11/11` → verify → restore PC0); MIN_NOTIONAL evidence (`minNotional=5`,
   cap `11` above floor, re-verify before ARM).
7. **H6 run remains NOT APPROVED / NOT RUN** — no ARM until explicit Oren approval **after Codex PASS** on this
   correction. *(Superseded 2026-07-07: RUN + PASS — see below.)*

---

## Run — results + evidence (RUN + PASS · Codex PASS · 2026-07-07)
_updated by Codex at Oren request._

**Metadata**
- **ARM window:** 2026-07-07, ~10:19 UTC (ARM redeploy 10:19:42Z) → ~10:27 UTC (disarm redeploy 10:27:13Z), ≈ 8 min.
- **Oren explicit approval scope:** testnet only · **SOLUSDT only** · corrected SOL path (already exposed,
  rotation-required now) · first step = live MIN_NOTIONAL re-verify (STOP/NO-GO if cap not above floor) · caps 11/11/11
  verified before fire · one signal · PASS = `filled` only · `submitted`/`unknown` = INCONCLUSIVE · disarm + restore
  PC0 · no BNBUSDT/XRPUSDT · no mainnet/real funds · operator ran all mutations/Doppler/Railway/curl, Claude ran
  read-only read-backs.
- **Bot:** SOLUSDT `5acc84c9-edd2-4c9f-87dd-fd928f8b62cd`. **Testnet:** `is_production=false` at ARM, pre-fire, disarm.

**Gates**
1. **MIN_NOTIONAL re-verify (live, read-only):** SOL/USDT testnet `exchangeInfo` → **`minNotional = 5`** → cap **11 > 5**
   ✅.
2. **PC0 baseline before ARM:** SOL caps **`20/25/100`**, `active`, `trading_enabled=false`.
3. **ARM:** `trading_enabled=true` + caps **`11/11/11`** (verified before fire) · `QUEUE_ENABLED=true` + redeploy →
   `worker_running`, `queue_enabled=true`, `is_production=false`, `enabled_bots=1` (SOL only), `queue_length=0`.

**Fire + result** — `signal_id = H6-1783419859`, fired **once**, HTTP **200**:
- **Webhook:** exactly **1** `webhook_logs` (accepted). **Queue:** enqueue → consumed → `queue_length=0`.
- **Trade (exactly 1):** **`status = filled`** · `exchange_order_id` **present** · **`executed_notional_usdt = 10.97`
  (≤ cap 11)** · `filled_at` set.
- **Audit:** **`trade.created`** then **`trade.filled`**.

**Isolation:** no BNBUSDT / no XRPUSDT — only SOLUSDT armed (`enabled_bots=1`).

**Final disarm (raw read-back):** `enabled_bots=0` · `queue_length=0` · `q_trade_signals=0` · `open_trades=0` ·
`queue_enabled=false` · `worker_state=disabled` · `is_production=false` · **SOL restored `active / trading_enabled=false
/ 20-25-100`** · all bots `trading_enabled=false`.

**Outcome: H6 = RUN + PASS** — positive path (webhook → queue → worker → risk checks → testnet market order → **fill** →
trade + audit → clean disarm) runtime-proven; one `filled` trade within cap; PC0 restored.

**Post-run:** **SOL token rotation remains REQUIRED** (H6 re-used the token from a local terminal; already on the
BNB/XRP/SOL rotation list). **Residual ~$11 testnet SOL position** (SELL off in v1; testnet play money, no action).
**No mainnet. No real funds.**
