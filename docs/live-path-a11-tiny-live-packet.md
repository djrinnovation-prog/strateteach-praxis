# LIVE-PATH — A11 tiny-live packet (first real-money micro-order)

The final gate: arm bot `2dcaddba-…` on valid mainnet credential `1164c49b-…` and place ONE tiny real-money
BUY, then disarm. **PACKET ONLY — nothing executed.** Every step below is separately operator-approved. Real
funds NO-GO until each hard prerequisite is closed and you approve the first order.

Grounding state: bot `2dcaddba` `paused` · `trading_enabled=false` · credential `1164c49b` valid/mainnet
(repointed) · no order yet · worker currently testnet tier.

---

## 0. HARD PREREQUISITES / open blockers (must close BEFORE arming — each its own reviewed step)
These are not yet done and A11 cannot proceed without them:

- **B0 — production-proxy invariant vs native egress (BLOCKER).** The worker fail-closes in production without
  a proxy: Step 4b `if (isProduction && !exchangeHttpsProxy) throw 'exchange_proxy_missing'` + the
  `BinanceAdapter` ctor. But A1 was resolved as **native static egress (Option A)**, no proxy (the validation
  script used direct ccxt and worked). So flipping `PRAXIS_IS_PRODUCTION=true` today would make **every order
  fail-closed** with `exchange_proxy_missing`. Resolve one way, reviewed:
  (a) reconcile the code — allow production with no proxy when native static egress is the chosen path
  (remove/adjust the two guards), OR (b) deploy the dormant B1 proxy + set `EXCHANGE_HTTPS_PROXY`.
  Recommended: (a) — Option A is the decided egress path. **This needs its own packet + Codex PASS.**
- **B1 — bot has no usable webhook token.** Only the hash is stored; firing a signal needs a fresh plaintext
  token (rotate via G-TVR once its UI is live, or the operator fallback). Needed for §6.
- **B2 — 4A audit fail-closed OFF.** `AUDIT_FAIL_CLOSED_ENABLED` should be `true` for live (HB-A pre-order
  audit gate). Confirm/enable.
- **B3 — 4C sweeper OFF.** The no-silent-loss sweeper flag is not enabled; enable for live durability
  (separate approval, already packeted).
- **B4 — H-2 atomic cap not applied/wired.** Migration 029 (atomic reservation) is not applied; app-side cap
  is non-atomic. Mitigated here by sizing `daily_notional_cap` for exactly ONE order (a race cannot place a
  second). Accept for a single supervised micro-order; do not rely on it at scale.
- **B5 — TradingView live alert not set up.** For the first order, prefer a MANUAL single-fire (§6) over a
  live alert.

Arming may NOT begin until B0 is closed and B2/B3 are confirmed on.

---

## 1. Exact PRE checks before arming (read-only)
```sql
-- bot
select id, user_id, status, trading_enabled, credential_id, trading_pair,
       sizing_mode, position_size_pct, fixed_notional_usdt, max_order_notional_usdt, daily_notional_cap_usdt,
       sell_enabled, consecutive_failures
from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect: status='paused', trading_enabled=false, credential_id='1164c49b-…', trading_pair='BTCUSDT',
--         sell_enabled=false, consecutive_failures=0; sizing/caps must be the TINY mainnet values (see §3)

-- credential
select status, exchange_environment, (permissions_confirmed->>'evidence_hash') as evidence_hash
from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082';
-- expect: 'valid','mainnet', evidence_hash='b11ba031…fb91'

-- no open trades / clean state
select count(*) from public.trades where bot_id='2dcaddba-…' and deleted_at is null
  and status in ('pending','submitted','unknown');   -- 0
select count(*) from public.trades_dlq where bot_id='2dcaddba-…';   -- 0
select count(*) from public.reconciliation_jobs rj join public.trades t on t.id=rj.trade_id
  where t.bot_id='2dcaddba-…';   -- 0

-- kill switch present
select exists(select 1 from pg_proc where proname='operator_kill_all') as kill_rpc_present;   -- true
```
Also confirm out-of-band: worker running + queue_enabled; static egress = the 3 IPs; Binance key restrictions
still (withdrawals OFF, IP-allowlisted, spot); B0–B3 closed.

## 2. Worker production-tier requirements (operator, Doppler→Railway + redeploy)
- `PRAXIS_IS_PRODUCTION=true` — the tier flip (so `assertExchangeEnvironment` accepts the mainnet credential;
  a testnet-tier worker would fail-closed on it).
- **B0 resolved** — production works with native egress (no `exchange_proxy_missing`).
- `AUDIT_FAIL_CLOSED_ENABLED=true` (B2). Rate limiting auto-forces on in live tier. `WEBHOOK_SECRET_PEPPER` +
  `SUPABASE_*` present (they are).
- Worker redeploy to pick up the tier + flags. Confirm the deployed worker logs `is_production=true`.

## 3. Exact risk caps / tiny order sizing (set on the bot BEFORE activation)
Deterministic, minimal, one-order-only:
- `sizing_mode = 'fixed_notional'` (not percent — exact tiny size).
- `fixed_notional_usdt` = **just above Binance's live BTCUSDT minNotional** (confirm current filter; ~$5–10 →
  use e.g. **$11**).
- `max_order_notional_usdt` = the same tiny ceiling (e.g. **$12**) — no single order exceeds it.
- `daily_notional_cap_usdt` = **$12** — enough for exactly ONE order; a runaway/second signal is capped out.
- `sell_enabled = false` (v1 BUY-only).
Set via a guarded update (owner-scoped, while paused). Fail-closed sizing (`isBotConfigReady`) requires all
present.

## 4. Kill-switch / operator lock / rollback (arm these mentally BEFORE the order)
- **One-click kill:** `operator_kill_all(p_hard_lock=true)` (019) → disables trading + pauses ALL bots +
  audits. This is the primary abort. Verify it is callable (kill_rpc_present) and, if using the UI,
  `VITE_OPERATOR_KILL_ENABLED=true`.
- **Operator lock (027):** `operator_set_bot_lock(bot, true)` holds the bot against owner re-enable.
- **Immediate manual rollback:** `update bots set trading_enabled=false, status='paused' where id='2dcaddba-…'`
  (owner/privileged); and/or flip `PRAXIS_IS_PRODUCTION=false` (worker back to testnet → mainnet cred
  fail-closes). Any of these stops further orders instantly.

## 5. Bot activation steps (ARM — each separately approved, in order)
1. Set the §3 tiny caps (guarded update; bot still paused/disabled). Re-run §1 to confirm.
2. `trading_enabled=true` (guarded update; still `status='paused'` so no webhook yet).
3. `status='active'` (guarded update) — opens the webhook + worker path. **The bot is now armed.**
Order matters: caps → enable → activate. Do NOT activate before the caps are set and confirmed.

## 6. Test-signal path (prefer MANUAL single-fire for the first order)
- **Recommended — manual single-fire:** rotate a fresh token (B1) → fire exactly ONE webhook to
  `/functions/v1/webhook/2dcaddba-…/<token>` with a unique `signal_id` and `action:"buy"` (the hardened fire
  script delivers the token via stdin, not argv). One signal, one observable order.
- **Alternative — TradingView:** a single alert with the real webhook URL/template. More moving parts; defer
  to after the first manual proof.
- Either way: ONE BUY signal, fresh `signal_id`. No repeated fires.

## 7. First micro-order approval wording (the explicit gate)
> **Need Oren — FIRST REAL-MONEY ORDER:** fire ONE BUY signal to bot `2dcaddba-…` (BTCUSDT, mainnet),
> `fixed_notional ≈ $11`, daily cap `$12`. Worker in production tier, native egress verified, kill-switch
> armed, monitoring live. Why: A11 tiny-live proof. I will do: fire exactly one signal (or you fire it) and
> watch it to fill. Risk: ~$11 of real funds on a trade-only, withdrawal-disabled, IP-allowlisted key; abort
> = operator_kill_all. Approve to place the order.

## 8. Live monitoring checklist (during/after the fire)
Watch, in real time:
- `trades` for bot: one new row → `pending` → `filled` (or `submitted`). `quantity`/`requested_notional` ≈ tiny.
- `audit_logs`: `trade.created` then `trade.filled` (or the HB-A block event if audit failed).
- Worker logs: `trade_pending` → `trade_executed status=filled`; no `order_blocked` / `sizing_error`.
- Binance account: the actual tiny fill appears (BTC bought ≈ $11 worth). `executed_notional_usdt` ≈ $11.
- **No second order** (daily cap). `trades_dlq`=0. `reconciliation_jobs`=0. `consecutive_failures`=0.
- Egress/auth: no `ExchangeAuthError`/`env_mismatch`/`exchange_proxy_missing` in logs.

## 9. Abort criteria (→ IMMEDIATE `operator_kill_all`)
Abort on ANY of: order notional > the tiny cap; a SECOND order; a `unknown`/`failed` trade; DLQ entry;
circuit-breaker trip; `ExchangeAuthError` / env mismatch / proxy error; egress IP not one of the 3; any
withdrawal-related event (should be impossible — key can't withdraw); or anything unexpected. Kill first,
investigate after.

## 10. Rollback after the test (DISARM — do not leave it armed)
Once the single micro-order fills and is verified:
1. `operator_kill_all(p_hard_lock=true)` OR `update bots set trading_enabled=false, status='paused'`.
2. Optionally `PRAXIS_IS_PRODUCTION=false` + redeploy (worker back to testnet tier).
3. Confirm: bot `paused` + `trading_enabled=false`, no open trades, one filled tiny trade on record.
The tiny-live proof is complete; scaling up is a separate decision with its own risk review (and closing
B4/H-2 properly, per-bot distinct secrets, etc.).

---

## Boundaries
Packet only — nothing executed (no reads, no tier flip, no caps set, no activation, no signal, no order, no
deploy). Arming is a multi-step, separately-approved sequence gated on B0–B3. Real funds NO-GO until then.
