# LIVE-PATH — worker read-only Binance validation packet

Validate the pending mainnet credential `1164c49b-…` (bot `2dcaddba-…`) with a **read-only** check that runs
**on the Railway worker** (static egress IPs). **Packet only — DO NOT EXECUTE.** No order, no repoint, no
trading enable, no balances printed, no auto-promote.

## Why it must run on the worker
The Binance key is IP-allowlisted to the worker's three static-egress IPs. Only a call egressing from those
IPs authenticates — an Edge function or a laptop egresses elsewhere and is rejected. Mechanism: a worker
script run in the **Railway Console** (the same context that produced the A1 egress probe), reusing the
worker's Vault access (`get_decrypted_secret`) + `ccxt` (already in `worker/node_modules`). Native A1 static
egress means direct ccxt calls leave via the 3 IPs (no proxy needed).

> The validation SCRIPT is to be authored + Codex-PASSed first (like the provisioning script), then run in the
> Railway Console: `cd worker && node scripts/validate-credential.mjs --credential 1164c49b-…`. This packet is
> the design + the exact checks.

## Part A — DB PRE checks (read-only SQL; can run via `db query --linked`)
```sql
select
  (select count(*) from public.user_exchange_credentials where id='1164c49b-...')                      as cred_exists,          -- 1: expect 1
  (select status               from public.user_exchange_credentials where id='1164c49b-...')          as cred_status,          -- 2: 'pending_validation'
  (select exchange_environment from public.user_exchange_credentials where id='1164c49b-...')          as cred_env,             -- 3: 'mainnet'
  (select status               from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')        as bot_status,           -- 4: 'paused'
  (select credential_id        from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')        as bot_credential_id,    -- 5: '594b9895-…' (NOT 1164c49b — not repointed)
  (select trading_enabled      from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')        as bot_trading_enabled;  -- 6: false
```
ABORT if `cred_exists≠1`, `cred_status≠'pending_validation'`, `cred_env≠'mainnet'`, `bot_status≠'paused'`,
`bot_credential_id≠'594b9895-…'` (a repoint would mean the bot already uses it — stop), or
`bot_trading_enabled≠false`.

## Part B — worker read-only validation (Railway Console; the script)
Runs after Part A passes. Steps, in order, all read-only:

7. **Egress IP** — keyless GET to an IP echo (e.g. `api.ipify.org`), assert the result ∈
   `{208.77.244.242, 152.55.184.240, 152.55.184.241}`. FAIL-CLOSED if not (means the call would not be
   coming from an allowlisted IP; do not proceed to the authenticated calls). Output: `egress_ip_ok:true`
   (the IP itself may be logged — it is non-secret infra).
8. **Binance read-only auth** — read the secret from Vault (`get_decrypted_secret(vault_secret_id)`), build a
   ccxt `binance` **mainnet** (non-sandbox) instance, call **`fetchBalance()`** (GET /api/v3/account —
   auth READ). Success proves the key authenticates AND the IP allowlist is correct. Output: `auth_ok:true`.
9. **Withdrawals OFF** — call the API-restrictions read (ccxt: `sapiGetAccountApiRestrictions` →
   GET /sapi/v1/account/apiRestrictions). Assert **`enableWithdrawals === false`**; also record
   `ipRestrict === true` and `enableSpotAndMarginTrading === true`. FAIL if withdrawals are enabled.
   Output: `withdrawals_off:true, ip_restrict:true, spot_enabled:true`.
10. **No order endpoints** — the script calls ONLY `fetchBalance` + `sapiGetAccountApiRestrictions` (both
    read). It NEVER calls `createOrder`, `cancelOrder`, `/order`, `/withdraw`, or any write endpoint. (Code
    review + a static check that the script imports no order path.)
11. **No balances printed** — `fetchBalance` is used only to prove auth; the script logs booleans/counts
    only, never balance amounts, the key/secret, the JSON, or the full `vault_secret_id` (fingerprint only).

### Success criteria (all true)
`egress_ip_ok` · `auth_ok` · `withdrawals_off` · `ip_restrict` · `spot_enabled`. The script outputs a
structured, non-secret **evidence** object, e.g.:
```json
{"event":"validation_ok","credential_fp":"1164c49b..<last8>","vault_secret_fp":"d14d87b1..ed6a76c5",
 "egress_ip_ok":true,"auth_ok":true,"withdrawals_off":true,"ip_restrict":true,"spot_enabled":true,
 "checked_at":"<iso>","evidence_hash":"<sha256 of the non-secret result>"}
```
Any failed check ⇒ `validation_failed` + the specific reason (sanitized PG/HTTP code, no secret); the
credential stays `pending_validation`.

## 12. Promotion to `valid` — SEPARATE, gated step (NOT part of validation; no auto-promote)
On success, a separate reviewed step records the evidence and promotes the credential:
```sql
update public.user_exchange_credentials
set status='valid', last_validated_at=now(),
    permissions_confirmed = jsonb_build_object(
      'withdrawals_off', true, 'ip_restrict', true, 'spot_enabled', true,
      'egress_ip_ok', true, 'evidence_hash', '<from validation>', 'validated_at', now())
where id='1164c49b-...' and status='pending_validation';   -- CAS on the pending status
```
`service_role` has UPDATE on this table (or run via `db query`). This is its own approval — the validation
script never writes `valid` itself (A4: promotion requires stored evidence, no auto-promote).

## What this does NOT do
No `createOrder`/order/withdraw calls · no repoint (`bots.credential_id` stays `594b9895-…`) · no trading
enable · no A11 · no deploy · no balances/secret printed. It is an authenticated **read-only** mainnet call
(fetchBalance + apiRestrictions) — no funds move, no Binance state changes.

## Sequence after this (each separate + approved)
validate → promote `valid` → (later) repoint the bot to `1164c49b-…` → A11 tiny-live arm → first micro order.
Every step gated; real funds NO-GO until A11.

## Boundaries
Packet only — the validation script is not authored/run here. No execution, no order, no repoint, no trading
enable, no deploy, no mainnet order.
