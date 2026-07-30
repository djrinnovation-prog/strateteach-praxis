# S5-A3/B4 — Controlled TESTNET Smoke Evidence (E1)

> **EVIDENCE RECORD — docs only.** No DB/Doppler/Railway/execution by this document. Records the
> outcome of the Oren-approved controlled smoke. **TESTNET ONLY · no mainnet · no real funds · A11 NOT
> granted.** Decision: [production-oren-decision-record.md](production-oren-decision-record.md) §3/§7.
> Procedure: [controlled smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md).

## Verdict: **SMOKE PASS** (one filled testnet order), system **re-disarmed**
Semantics (locked): **SMOKE PASS = one FILLED testnet order**; an `order.blocked` / failure would be a
**SAFE STOP** (fail-closed worked), **not** a PASS. The result here is a PASS.

- **RUN_ID:** `S5SMOKE-20260630-1034`
- **signal_id:** `S5SMOKE-20260630-1034-BTCUSDT-01`
- **Bot:** BTCUSDT `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` (one bot only); other 4 stayed disabled.
- **Date:** 2026-06-30 (testnet, `is_production=false`).

## Execution timeline (per the smoke packet)
| Step | Who | Result |
|---|---|---|
| 1. Pre-arm verify (read-only) | agent | PASS — 5 bots config-ready, all `trading_enabled=false`, env=testnet; `open_trades/dlq/open_recon(status='pending')/queue_length=0/0/0/0`; `QUEUE_ENABLED=false`; BTC §6b-eligible=true, currently_enabled=false |
| 2. Enable ONE bot (§6b guarded UPDATE) | agent | BTC `trading_enabled=true` (RETURNING 1 row); `still_enabled=1`, `non_btc_enabled=0`; queue still off |
| 3. Arm queue | operator | `QUEUE_ENABLED=true` + Railway redeploy → `queue_enabled:true`, `stuck_count:0`, `worker_running` |
| 4. Fire ONE signal | operator | `wb6-e1-fire.sh` → `{"ok":true}` HTTP 200, CURL_EXIT=0 (one POST) |
| 5. Observe (read-only) | agent | **SMOKE PASS** (details below) |
| 6. Disarm | operator + agent | `QUEUE_ENABLED=false` + redeploy (operator); BTC `trading_enabled=false` (agent) — see anomaly below |
| 7. Final evidence (read-only) | agent + operator | fully disarmed (details below) |

## SMOKE PASS evidence (Step 5, E1)
- **Exactly one trade** for the signal_id: `e1dd53ec-d61a-496d-9d17-15ef36df0cb9`.
- `side=buy`, **`status=filled`**, `error_reason=null`.
- **`requested_notional_usdt=20`** (config `fixed_notional_usdt=20`, persisted on the pending row).
- **`executed_notional_usdt=19.8938726`** (= exchange order cost, ≈20).
- **`quantity=0.00034`** = roundDown(`20 / 58511.39` (price_at_execution), step `0.00001`).
- `exchange_order_id=11051234` (present).
- **Caps honored:** order notional ≤ `max_order_notional_usdt=25`; ≤ `daily_notional_cap_usdt=100`.
- **Audit chain:** `trade.created` (pending) → `trade.filled` (filled).
- No second trade; no `order.blocked`; no DLQ; no reconciliation job.
- → the DB-configured sizing + server-enforced risk path is proven **end-to-end on testnet**:
  config → balance + live price → `computeBuyQuantity` → `requested_notional_usdt` on pending →
  `createOrder` → fill → `executed_notional_usdt` from cost.

## Disarm — final evidence (Steps 6–7, E1/E2, verified)
- `enabled_bots=0` · `btc_still_enabled=0` · `open_trades=0` · `dlq=0` ·
  `open_recon(status='pending')=0` · `queue_length=0` · `QUEUE_ENABLED=false`.
- **Railway (d), operator-verified:** latest worker deployment/logs show `queue_enabled=false`,
  `worker_queue_disabled`, `boot_reconciliation_complete stuck_count=0`.
- The single testnet fill is **retained as evidence** (no cleanup). System is fully fail-closed.

## Step 6 anomaly — caught + corrected
- The **first** `trading_enabled=false` UPDATE returned **empty output**.
- **No success was reported from the empty output.** A **raw read-back** showed **BTC was still
  `trading_enabled=true`** — the first UPDATE had not taken effect.
- The UPDATE was **re-run** (raw `RETURNING` → BTC `trading_enabled=false`), and an **independent final
  read** verified `enabled_bots=0` and `btc_still_enabled=0`.
- During the gap, the operator had already set the Doppler source-of-record flag to
  `QUEUE_ENABLED=false`, no additional signal was fired, and final evidence later confirmed
  `queue_length=0` plus Railway `worker_queue_disabled`. Therefore no additional order was observed or
  recorded. (The Doppler flag alone does not prove an already-running worker had reloaded the env; the
  final state — not the flag during the gap — is what proves no additional order occurred.)
- **Lesson (binding):** empty/filtered command output is **not** evidence. Every arm/disarm DB
  mutation must be verified by a **raw read-back** of the actual row state, never by the
  presence/absence of grep-filtered output.

## Scope (reaffirmed)
- **Testnet only. No mainnet. No real funds. A11 (real-funds authorization) NOT granted.** Choosing A
  authorized this **testnet** smoke only and implies no mainnet step.
- Standing after: `QUEUE_ENABLED=false`; all 5 bots `trading_enabled=false`; SELL fail-closed;
  Migration 009 frozen; config-ready, **NOT armed**.
