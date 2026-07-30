# LIVE-PATH — worker deploy packet (B0 + H-2 wiring + native egress, still disarmed)

Deploy the worker service **`praxis-platform`** at HEAD (`4e0d4e1`) with `EXCHANGE_EGRESS_MODE=native`, while
keeping it **testnet-tier and disarmed**. **DO NOT EXECUTE until approved.** This is an INERT staging deploy:
it lands B0 + the H-2 atomic-reservation wiring + native-egress mode, but places **no order** (production tier
+ arming are A11, separate).

## What deploys
- Worker `praxis-platform` at `4e0d4e1` — includes: **B0** (explicit native egress), the already-committed
  **H-2 worker wiring** (`insert_pending_trade_atomic` RPC), and the earlier audit-v3 worker fixes
  (H-1/H-3/H-5/M-6/M-9/M-16, etc.).
- **Env change (worker Doppler config):** add `EXCHANGE_EGRESS_MODE=native` (A1 Option A — direct egress via
  the static outbound IPs; no proxy).

## What stays as-is (NOT changed by this deploy)
- `PRAXIS_IS_PRODUCTION=false` (testnet tier) — the worker uses ccxt sandbox and the egress gate is inert
  (testnet is always OK). **No mainnet path is exercised.**
- Worker disarmed: `QUEUE_ENABLED`/`worker_state` remain at their current disabled values (no polling/trading).
- `AUDIT_FAIL_CLOSED_ENABLED` — leave OFF (that is an A11 step).
- `EXCHANGE_HTTPS_PROXY` — leave UNSET (native mode needs no proxy; B1 proxy stays dormant).

## Prerequisites (verify first)
- `4e0d4e1` on `origin/main` (push first if needed).
- **Migration 029 applied + tracked on linked** — the H-2 wiring calls `insert_pending_trade_atomic`; if the
  RPC is absent the worker logs `reservation_rpc_error` on every signal. (029 is applied/tracked ✅ — confirm
  with the read-only check below.) Migrations 026–029 applied.
- Worker Doppler config has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `WEBHOOK_SECRET_PEPPER` (it does).

## Pre-deploy checks (read-only)
```sql
-- H-2 RPC present (else the worker's reservation fails)
select exists(select 1 from pg_proc where proname='insert_pending_trade_atomic') as h2_rpc_present;  -- true
-- worker still disarmed (testnet-tier metadata)
select is_production, queue_enabled, worker_state from public.worker_status order by updated_at desc limit 1;
-- expect: is_production=false, queue_enabled=false, worker_state=disabled (or current disarmed values)
```

## Deploy steps (operator, Railway)
1. Railway → service **`praxis-platform`** → **Variables** → add `EXCHANGE_EGRESS_MODE=native`. Confirm
   `PRAXIS_IS_PRODUCTION=false` is unchanged and `EXCHANGE_HTTPS_PROXY` is unset.
2. Deploy the service at `4e0d4e1` (push-triggered build, or Redeploy pinned to `4e0d4e1`).
3. Wait for **Success**.

## Post-deploy verification (non-trading)
1. **Deployments:** top = Success at `4e0d4e1`, Active.
2. **Startup log** (`startup_env`): `exchange_egress_mode: "native"`, and confirm the worker booted testnet
   (no `is_production=true`). No `exchange_egress_unconfigured` / `exchange_proxy_missing` errors.
3. **Still disarmed:** `worker_status` shows `is_production=false`, `queue_enabled=false` — no polling, no
   trades. `trades`/`trades_dlq`/`reconciliation_jobs` unchanged (no new rows from this deploy).
4. **Nothing traded:** this deploy exercises no order path (testnet + disarmed). Native egress is staged but
   not used until the A11 tier flip.

## Rollback
- Redeploy the prior worker build (Railway → Deployments → previous → Redeploy).
- Or unset `EXCHANGE_EGRESS_MODE`. Since the worker stays testnet/disarmed, there is no live-trading exposure
  to roll back.

## What this does NOT do
No production tier, no arming, no signal, no order, no A11, no bot activation, no repoint change. The bot
`2dcaddba` stays `paused` on the valid mainnet credential.

## Next (A11, separate + approved)
Flip `PRAXIS_IS_PRODUCTION=true` (+ `AUDIT_FAIL_CLOSED_ENABLED=true`), set the tiny caps, arm the bot, fire one
micro-signal — per the A11 tiny-live packet, with kill-switch armed and abort criteria. Real funds NO-GO until
then.

## Boundaries
Packet only — no deploy, no env change, no tier flip, no order.
