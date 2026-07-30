# LIVE-PATH — credential validation RUN runbook (Railway Console)

Run `worker/scripts/validate-credential.mjs` (committed `5b3a8ff`) in the **Railway Console** of the worker
service (`praxis-platform`) to validate credential `1164c49b-…` read-only. **DO NOT EXECUTE until approved.**
Read-only mainnet call (fetchBalance + apiRestrictions) — no order, no repoint, no trading enable, no
promotion, no funds move.

## Why the Railway Console specifically
Only the worker egresses via the A1 static IPs the Binance key is allowlisted to. The script self-checks the
egress IP first and fails closed if it isn't one of `208.77.244.242 / 152.55.184.240 / 152.55.184.241` — so
running it anywhere else (laptop / Edge) cannot authenticate and will abort before using the key.

## Prerequisites
- `5b3a8ff` on `origin/main` (push first if needed) so the worker build/repo has the script.
- Worker service env has `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (it already does), and `ccxt` +
  `@supabase/supabase-js` in `worker/node_modules` (they are).
- Credential `1164c49b-…` is `pending_validation` / `mainnet` and the bot is still `paused` + not repointed
  (Part-A PRE below re-confirms).

## Part A — DB PRE (read-only; can run via `db query --linked` before opening the Console)
```sql
select
  (select status               from public.user_exchange_credentials where id='1164c49b-...') as cred_status,          -- 'pending_validation'
  (select exchange_environment from public.user_exchange_credentials where id='1164c49b-...') as cred_env,             -- 'mainnet'
  (select status               from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2') as bot_status,        -- 'paused'
  (select credential_id        from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2') as bot_credential_id, -- '594b9895-…' (not repointed)
  (select trading_enabled      from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2') as bot_trading_enabled;-- false
```
ABORT if any differs.

## Part B — open the Railway Console and run (operator)
1. Railway → project → service **`praxis-platform`** (the worker) → **Console** / shell (the same place the A1
   egress probe was run).
2. Run:
   ```
   cd worker && node scripts/validate-credential.mjs --credential 1164c49b-bf7a-4593-802f-920d76669082
   ```
3. Read the single JSON line:
   - **Success:** `{"event":"validation_ok","evidence":{ "credential_id":"1164c49b-…","vault_secret_fp":"d14d87b1..ed6a76c5","egress_ip":"<one of the 3>","egress_ip_ok":true,"auth_ok":true,"withdrawals_off":true,"ip_restrict":true,"spot_enabled":true,"universal_transfer_off":true|null,"internal_transfer_off":true|null,"margin_off":true|null,"checked_at":"…","evidence_hash":"<sha256>" }}`
   - **Failure:** `{"event":"validation_failed","reason":"<egress_ip_not_allowlisted|auth_failed|restrictions_failed|credential_not_pending|credential_not_mainnet|credential_not_found>", ...}` (evidence present for `restrictions_failed`).
   - Error (infra): `{"event":"validation_error","error":"<sanitized>"}`.
4. **Copy the whole JSON line** and paste it back — I'll verify every flag + record the `evidence_hash`.

Exit code: 0 on success, non-zero on failure. **No balances / key / secret / full pointer are ever printed.**

## What to check in the output
`egress_ip_ok=true` (egress ∈ the 3) · `auth_ok=true` (key authenticates from an allowlisted IP) ·
`withdrawals_off=true` · `ip_restrict=true` · `spot_enabled=true` · transfer/margin flags `true` or `null`
(never `false`). If `withdrawals_off=false` → **stop**: the key can withdraw; fix on Binance and re-validate.

## After a successful run (SEPARATE, gated — not part of this run)
Promotion to `valid` is its own approved step that records the `evidence_hash`:
```sql
update public.user_exchange_credentials
set status='valid', last_validated_at=now(),
    permissions_confirmed=jsonb_build_object('withdrawals_off',true,'ip_restrict',true,'spot_enabled',true,
      'egress_ip_ok',true,'evidence_hash','<from output>','validated_at',now())
where id='1164c49b-...' and status='pending_validation';
```
No auto-promote; the script never writes `valid` itself.

## Rollback
None needed — the run is read-only (no DB write, no Binance state change). Nothing to undo.

## Boundaries
Nothing executed by this runbook. The run itself is read-only (fetchBalance + apiRestrictions). No order, no
repoint, no trading enable, no promotion, no deploy, no mainnet order.
