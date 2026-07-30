# Oren Go/No-Go Decision Record — Praxis

> **FINALIZED 2026-06-30 — Oren chose A (controlled TESTNET smoke). Executed: SMOKE PASS, re-disarmed
> (§7).** Authorized a **testnet** smoke only — **NOT mainnet, NOT real funds**; A11 (real-funds
> authorization) is **not** granted. Executed exactly per [the controlled smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md),
> operator-driven, immediate disarm; system is fully fail-closed again.
> Source brief: [Oren go/no-go brief](production-oren-go-no-go-brief.md).

## 1. Context
Sprint 4 closed (testnet-proven); S5-A3/B4 sizing/risk code merged; migration 014 applied; 5 bots
config-ready (`fixed_notional=20`, `max=25`, `daily=100`, SELL off, **`trading_enabled=false`**,
`exchange_environment=testnet`); SELL fail-closed; `QUEUE_ENABLED=false`; Migration 009 frozen.
Real-funds-ready = ❌ (MUST gates A1/A2/A3/A4/A5/A10/A11 + A8 open).

## 2. Phase 0 review result — **PASS / GO-for-decision** (2026-06-30, read-only)
- **(a)** 5 bots config-ready ✅ — all of BTC/ETH/BNB/SOL/XRP: `sizing_mode=fixed_notional`,
  `fixed_notional_usdt=20`, `max_order_notional_usdt=25`, `daily_notional_cap_usdt=100`,
  `sell_enabled=false`, **`trading_enabled=false`**, `exchange_environment=testnet` (E2, `db query --linked`).
- **(b)** Clean state ✅ — `open_trades=0 / dlq=0 / open_recon(status='pending')=0 / queue_length=0` (E2).
- **(c)** `QUEUE_ENABLED=false` ✅ — Doppler flag read (E2).
- **(d)** Worker disarmed ✅ — latest Railway worker deploy: `queue_enabled=false`,
  `worker_queue_disabled`, `boot_reconciliation_complete stuck_count=0` (E1, operator-verified).
- **Conclusion:** system is clean, disarmed, and config-ready → safe to *consider* Phase 1. Phase 0
  does **not** itself authorize Phase 1.

## 3. Decision
- **Selected option:** ☑ **A — approve controlled TESTNET smoke window** (☐ B  ☐ C)
- **Decided by:** Oren (relayed by operator)
- **Date (UTC):** 2026-06-30
- **Scope (verbatim):** testnet only · one BTC bot only · one signal only · expected
  `requested_notional_usdt=20` · immediate disarm after outcome **regardless of PASS / SAFE STOP /
  failure** · no mainnet · no real funds · no TradingView live · no broader campaign.
- **Explicitly NOT granted:** A11 real-funds approval. A authorizes the **testnet** smoke only and
  does not imply any mainnet step.

## 4. Selected option — A (B and C not chosen)
**A — approve controlled TESTNET smoke window.** Authorizes Phase 1 **testnet only**, executed
**exactly** per [the controlled smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md): pre-arm
verify → enable one bot (BTCUSDT) → queue arm → fire **one BTC testnet** signal → observe →
**immediate disarm** → final evidence. **SMOKE PASS = one filled testnet order**
(`requested_notional_usdt=20`); a blocked outcome/failure is a **SAFE STOP**, not a PASS — disarm +
investigate either way. **Does NOT authorize mainnet/real funds; A11 remains separate.** The smoke
outcome (PASS or SAFE STOP) + re-disarm will be recorded in a separate E1 evidence note + DECISIONS.md.

## 5. Scope + non-approval (applies to ALL options)
- No mainnet, no real funds, no TradingView live — gated on the full MUST set **and** Oren's separate
  written real-funds authorization (A11), independent of this decision.
- A choice of A authorizes **testnet** Phase 1 only; it does **not** imply A11 or any mainnet step.
- `QUEUE_ENABLED=false` and all bots `trading_enabled=false` until/unless A is chosen in writing, and
  reverted immediately after any approved smoke window.

## 6. Follow-up on finalize
- Fill §3, keep the chosen block in §4, then add a concise DECISIONS.md entry (choice + timestamp +
  scope + explicit mainnet non-approval). If A and the smoke is run, record its E1 evidence (PASS or
  SAFE STOP) separately and re-confirm disarm.

## 7. Smoke outcome — E1 evidence (2026-06-30) — **SMOKE PASS, re-disarmed**
Executed exactly per the controlled smoke packet. **RUN_ID `S5SMOKE-20260630-1034`**, signal_id
`S5SMOKE-20260630-1034-BTCUSDT-01`. Testnet only.
- **Step 1 pre-arm (read-only, PASS):** 5 bots config-ready, all `trading_enabled=false`, env=testnet;
  `open_trades/dlq/open_recon(status='pending')/queue_length = 0/0/0/0`; `QUEUE_ENABLED=false`;
  BTC §6b-eligible=true, currently_enabled=false.
- **Step 2 enable (BTC only):** §6b guarded `UPDATE` → 1 row, BTCUSDT `trading_enabled=true`;
  `still_enabled=1`, `non_btc_enabled=0` (other 4 stayed false); queue still off.
- **Steps 3–4 (operator):** `QUEUE_ENABLED=true` + Railway redeploy (armed: `queue_enabled:true`,
  `stuck_count:0`, `worker_running`); fired **one** signal (`{"ok":true}` HTTP 200, CURL_EXIT=0).
- **Step 5 observe — SMOKE PASS:** exactly **1** trade `e1dd53ec-d61a-496d-9d17-15ef36df0cb9` —
  `side=buy`, `status=filled`, `requested_notional_usdt=20`, `executed_notional_usdt=19.8938726`
  (= order cost), `quantity=0.00034` = roundDown(20 / `price_at_execution` 58511.39, step 0.00001),
  `exchange_order_id=11051234`, `error_reason=null`; audit chain `trade.created`(pending) →
  `trade.filled`(filled). Caps honored (≤ max 25, ≤ daily 100). No second trade, no `order.blocked`.
- **Step 6 disarm anomaly (caught + corrected):** the **first** `trading_enabled=false` UPDATE returned
  **empty output**; a raw read-back showed **BTC still `trading_enabled=true`** (the first UPDATE did not
  take effect). Per "empty output ≠ evidence", the UPDATE was re-run (raw `RETURNING` → BTC=false) and an
  independent read confirmed it. (During the gap the Doppler flag was already `QUEUE_ENABLED=false` and
  no additional signal was fired; final evidence — `queue_length=0` + Railway `worker_queue_disabled` —
  confirms no additional order was observed or recorded. The flag alone is not proof of the worker's
  runtime state during the gap; the final state is.)
- **Step 7 final evidence (raw, verified):** `enabled_bots=0`, `btc_still_enabled=0`,
  `open_trades=0`, `dlq=0`, `open_recon=0`, `queue_length=0`, `QUEUE_ENABLED=false`; Railway (d):
  latest worker deploy `queue_enabled=false` + `worker_queue_disabled` + `boot_reconciliation_complete
  stuck_count=0` (operator-verified). **Fully disarmed, fail-closed.**
- **Scope reaffirmed:** **testnet only · no mainnet · no real funds · A11 NOT granted.** The single
  testnet fill is retained as evidence (no cleanup).
- **Lesson:** every DB mutation in an arm/disarm runbook must be verified by a raw read-back, never by
  the presence/absence of grep-filtered output.
