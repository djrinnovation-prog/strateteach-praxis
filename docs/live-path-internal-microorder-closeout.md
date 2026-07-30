# LIVE-PATH — internal micro-order closeout

**Result: `PASS*` — the mainnet order path reached Binance and failed safely due to insufficient USDT. No funds moved.**

Date: 2026-07-16. Bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` (BTCUSDT) · mainnet cred `1164c49b` (valid) ·
tiny caps 12/13/13 · sell disabled. Method: internal `pgmq_send` into `trade_signals` (webhook/TradingView
bypassed); the existing worker drove the full real path.

---

## 1. Exact timeline (times UTC, 2026-07-16)
| Time | Event |
|---|---|
| ~11:1x | Safe prep: PRE checks; paused the 4 other (testnet) active bots; sweeper confirmed OFF (evidence: 40 stale `accepted` webhook_logs, `max_requeue_attempts=0`); queue empty. |
| 11:42–11:46 | **Arming attempt via Railway UI only — did NOT take.** `worker_status` kept `is_production=false, queue_enabled=false` (fresh writes, unchanged boot cadence ⇒ no effective env change). |
| ~11:55:59 | **Armed after setting vars in Doppler + redeploy.** `worker_status` → `is_production=true, queue_enabled=true, worker_state=running` (write cadence shifted ⇒ real restart). |
| ~12:03 | Operator armed the bot (`status=active, trading_enabled=true`, guarded, 1 row); then fired ONE signal `pgmq_send` → `msg_id 89`, `signal_id=INTERNAL-TINYLIVE-2026-07-16-01`. |
| 12:03:35 | **`order.blocked`** — `SizingUnavailableError reason=insufficient_quote_balance` (where=sizing). Message acked, queue→0, **no trade row, no order, no funds moved.** |
| ~12:04 | Protective disarm (D1): bot → `paused, trading_enabled=false`. Confirmed queue 0, 0 trades for signal. |
| 12:18:58 | Worker de-arm redeploy — startup log cold (`queue_enabled:false, is_production:false, exchange_egress_mode:native, heartbeat_disabled`, boot reconciliation `total:0`). |
| 12:29:58 | **Final cold state** after an additional manual Railway-var change + redeploy (see §Operational finding). `worker_status` cold; 4 testnet bots restored to `active`; target left disarmed on mainnet cred. |

## 2. What WAS proven (end-to-end, real money on the line)
- Internal `pgmq_send` → worker consume → **schema_version gate** → **bot-active gate**.
- **Step-4b fail-closed gates:** `assertTradingEnabled` · `assertExchangeEnvironment` (mainnet↔production match) ·
  native egress (`productionEgressOk`) · `isBotConfigReady`.
- **`BinanceAdapter` authenticated to Binance MAINNET over the A1 static egress IP and read the live balance.**
  ⇒ credential validity, key permissions, static-egress allowlist, and mainnet auth all work in the live path.
- **Fail-closed sizing:** insufficient quote balance → `SizingUnavailableError` → `order.blocked`, message acked,
  **no order placed, no trade row created.** The system correctly refused to place an order it could not fund.
- Correct **idempotency/caps design** confirmed by code path (`insert_pending_trade_atomic`, `UNIQUE(bot_id,signal_id)`),
  though not exercised past the balance gate this run.

## 3. What was NOT proven
- **A real fill.** No order was placed (blocked at sizing), so exchange order placement, partial/aggressive-fill
  handling, reconciliation-to-`filled`, and executed-notional accounting are **not yet exercised on mainnet**.
- **Caps enforcement at runtime** (1st reserves / 2nd `daily_notional_cap` reject) — designed + unit-validated,
  not run live (blocked before reservation).
- **Position lifecycle / exit** — SELL is fail-closed in v1; closing a real position is manual on Binance.
- The webhook/TradingView ingest path (deliberately bypassed here).

## 4. Final safe / cold state (verified via `worker_status`, not UI)
- Worker `praxis-platform`: **testnet/idle** — `is_production=false, queue_enabled=false, worker_state=disabled`.
- Bot `2dcaddba`: **paused, trading_enabled=false**, on **valid mainnet cred `1164c49b`**, caps 12/13/13 (preserved for retry).
- 4 testnet bots (`297dddb9`, `36b46eb3`, `5acc84c9`, `c8913354`): restored to `active`.
- Queue `trade_signals`: empty (0). No pending trades. Withdrawals OFF on the mainnet key.

## 5. Retry recipe (after funding 13–15 USDT) — no code, no new deploy of code
1. **Fund:** deposit **13–15 USDT** (quote) to the mainnet Binance account (covers the $12 order + fees +
   minNotional buffer). *(Operator action — Claude cannot move funds.)*
2. **Arm worker:** set `PRAXIS_IS_PRODUCTION=true`, `QUEUE_ENABLED=true`, `AUDIT_FAIL_CLOSED_ENABLED=true`
   (keep `EXCHANGE_EGRESS_MODE=native`; leave `WEBHOOK_REQUEUE_SWEEPER_ENABLED` / `EXCHANGE_HTTPS_PROXY` unset).
   **Set in BOTH Doppler AND Railway Variables (they drift — see Operational finding), then redeploy.**
   Claude verifies `worker_status` shows `is_production=true, queue_enabled=true, running, age<60` — trust the DB, not either UI.
3. **Pre-arm safety:** pause the 4 other active bots; confirm queue=0 and sweeper OFF.
4. **Arm bot (operator):** `status='active', trading_enabled=true` (guarded to paused+disabled+mainnet cred).
5. **Fire ONE (operator):** `pgmq_send('trade_signals', {schema_version:'1.0', bot_id, signal_id:'<FRESH-unique>', side:'buy'})`.
6. **Monitor (Claude, read-only)** → **disarm on first fill/fail** (D1 kill bot → drain queue → operator de-arms
   worker in Doppler+Railway → restore the 4 bots → confirm cold).
> Order-causing steps (4 arm, 5 insert) are **operator-executed**; Claude does read-only monitoring + protective disarm.

## Operational finding — env source of truth is ambiguous (Doppler ↔ Railway drift)
- **Observed:** the Railway-UI-only arming attempt did NOT change the running worker's env. Setting vars in
  **Doppler + redeploy** DID arm it. But de-arming via **Doppler alone did not stick** — the operator had to
  change **Railway Variables manually + redeploy** to reach cold. So the two stores **drift**, and the currently
  effective runtime source appears to be **Railway Variables**, not a reliable Doppler→Railway sync.
- **Rule going forward:** for any arm/de-arm, **set the vars in BOTH Doppler and Railway, redeploy, and verify
  the actual `public.worker_status` row** (`is_production`/`queue_enabled`/`worker_state`, `age_s<60`, and a
  shifted write-cadence proving a real restart). **Never trust either UI alone.**
- **Follow-up (tracked):** consolidate the env source of truth (pick one authority) or fix the Doppler→Railway
  sync so the two cannot drift. Until fixed, the dual-set + `worker_status`-verify procedure is mandatory.

## 6. Remaining product gaps
1. **TradingView webhook token flow** — B1 rotation still open. Owner login for `66e1b075` unavailable; operator
   account `2f0eb49b` is valid. `admin-rotate` deployed v7 needs operator JWT (role=authenticated) + `apikey` +
   `x-admin-rotate-secret` (digest `2b75bafe…070f`); CORS blocks the browser path → use terminal curl. Script
   staged at `scratchpad/praxis-rotate-webhook.sh`. Then wire an alert to fire the live path.
2. **UI self-serve** — the Signum-inspired wizard (create → exchange → validate → TradingView → risk → activate)
   is planned/doc-only; TradingViewConnect wired behind `VITE_TV_CONNECT_ENABLED` (default OFF), frontend deploy held.
3. **Doppler/Railway env source cleanup** — per the Operational finding above.
4. **4C sweeper** — `WEBHOOK_REQUEUE_SWEEPER_ENABLED` still OFF (dark launch). 40 stale `accepted` webhook_logs for
   `2dcaddba` would be re-enqueued if enabled — enable only with intent + caps in place. Migrations 024/025 applied? (verify).
5. **Notion / runbook cleanup** — many `docs/live-path-*.md` packets are uncommitted working docs; consolidate the
   canonical runbooks and the Governance/Workstream tracking.
6. **Pilot onboarding** — real-user path gated on: a first real FILL (funding), UI self-serve, TradingView flow,
   and the env-source fix.

## Boundaries
Documentation only. No live actions, no deploy, no order. Worker cold, bot disarmed, real funds NO-GO.
