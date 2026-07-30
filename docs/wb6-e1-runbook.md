# WB6 E1 — Single-Fire Runbook

Prove the pipeline end-to-end on **Binance Testnet** with **one** webhook:
`TradingView → Edge → pgmq → worker → testnet fill → trades + audit_logs`, then disarm.

**Invariants:** testnet-only (server-enforced) · effectively-once (server dedup) · secret hygiene (token never echoed/logged/in-history) · single fire, no retries · disarm immediately after.

Bot under test: `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` (BTCUSDT, spot, credential attached).

---

## 0. Pre-flight (read-only)
```
supabase db query --linked --file sql/wb6-e1-status.sql
```
Expect baseline: `queue_length=0`, `bot_status=active`, `cred_attached=true`, `trades=0`, `dlq=0`, `recon=0`, and your chosen `signal_id` not present in `webhook_logs`.
Also confirm (operator): Binance key is **Spot Testnet, trade-only, no withdrawal**.

## 1. Arm
```
bash scripts/wb6-e1-arm.sh
```
Sets `QUEUE_ENABLED=true`. Wait for the Railway redeploy to go **Active**.

## 2. Verify the Railway startup gate (MANDATORY)
Railway → worker → latest deploy → Logs. All must hold:
- `worker_starting` → `queue_enabled:true` **and `is_production:false`** ← testnet safety gate
- `boot_reconciliation_complete` → `stuck_count:0`
- `queue_preflight_ok`
- `worker_running`
- no startup / queue / database / permission / fatal errors

**If `is_production:false` is absent, or `queue_preflight_ok` missing, or any error → `bash scripts/wb6-e1-disarm.sh` and STOP.**

## 3. Fire once
```
bash scripts/wb6-e1-fire.sh                       # default signal_id WB6E1|60|1750000000|buy
#   re-runs need a FRESH signal_id (repeats are deduped):
# bash scripts/wb6-e1-fire.sh 'WB6E1|60|1750000001|buy'
```
Paste the token at the hidden prompt. Expect output ending in `HTTP 200`. **Do not disarm yet** — let the worker process.

## 4. Trace (read-only)
```
supabase db query --linked --file sql/wb6-e1-status.sql      # summary; or paste into SQL Editor for detail
```
**Success (all required):**
- `webhook_logs`: new row `status=accepted` for the signal_id
- queue: `1` momentarily → back to `0`
- `trades`: **exactly one** row — `side=buy`, `trading_pair=BTCUSDT`, **`status=filled`**, `exchange_order_id` set, `error_reason` null
- `audit_logs`: `trade.created` then `trade.filled`
- `dlq=0`, `recon=0`, bot still `active`

**Abort / stop conditions (any one):**
- bot → `error` (credential disable / circuit breaker) · any DLQ row · trade `unknown` + recon job · **>1 trade** for the signal · webhook 5xx · worker log `credential_fetch_error` / `bot_misconfigured_credential` (F-01 regression)

## 5. Disarm (immediately — success OR failure)
```
bash scripts/wb6-e1-disarm.sh
```
Sets `QUEUE_ENABLED=false`. Wait for redeploy → expect `worker_queue_disabled`. (Idempotency makes even a mid-flight restart safe.)

## 6. Document result
Record in Current Status / Sprint 3 Plan: outcome, the `trades` row id + `exchange_order_id`, queue returned to 0, and the E1 evidence (success criteria met, or the exact failure). On success, WB6 E1 is closed; next is WB7.

---

### One-liners
- Arm → `bash scripts/wb6-e1-arm.sh`
- Status (read-only) → `supabase db query --linked --file sql/wb6-e1-status.sql`
- Fire once → `bash scripts/wb6-e1-fire.sh ['signal_id']`
- Disarm → `bash scripts/wb6-e1-disarm.sh`
