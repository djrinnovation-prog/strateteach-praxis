# LIVE-PATH — tiny-live provisioning RUN runbook (execute the committed script)

Run `scripts/provision-tiny-live.mjs` (committed `f4b2a29`) to provision the tiny-live Binance credential:
**Doppler → Vault → `user_exchange_credentials` (`pending_validation`)**. **DO NOT EXECUTE until approved.**
Dry-run first, then the real run. The commit run creates a REAL Vault secret + credential row on the LINKED
(production) DB — no bot repoint, no trading enable, no order.

## Prerequisites
- Script committed `f4b2a29`; mock tests 10/10; `create_vault_secret` (031) applied+tracked on linked. ✅
- **Doppler config** (the one `doppler run` uses) contains, by name: `BINANCE_MAINNET_API_KEY_TINY_LIVE`,
  `BINANCE_MAINNET_API_SECRET_TINY_LIVE`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the URL/role for the
  **linked** project). Confirm names only — never print values.
- `@supabase/supabase-js` on the path → **run from `worker/`** (which has it).
- Binance key restrictions already done: withdrawals OFF, spot, IP-allowlisted to the 3 worker IPs.

## Identify the target (read-only — confirm before running)
Fill `<BOT_ID>` + `<USER_ID>`. To pick the tiny-live bot, run read-only:
```sql
select id as bot_id, user_id, trading_pair, status, trading_enabled, credential_id
from public.bots where deleted_at is null order by created_at;
```
Choose the intended tiny-live bot; `<USER_ID>` = its `user_id`. Confirm it is **disabled**
(`status<>'active'`, `trading_enabled=false`).

## Step 1 — DRY-RUN (preflight; NO Vault write, NO insert)
```
cd worker && doppler run -- node ../scripts/provision-tiny-live.mjs --bot <BOT_ID> --user <USER_ID> --dry-run
```
Expect JSON lines:
- `{"event":"pre_checks","ok":true,...,"keys_present":true}`
- `{"event":"dry_run_ok","would_write_vault":true,"would_insert_credential":true,"label":"mainnet/tiny-live/<BOT_ID>",...,"secret_built":true}`
- `{"event":"done","dryRun":true,"credentialId":null,"vaultSecretFp":null}`

ABORT if `pre_checks.ok` is false (reason tells you why: `bot_not_found` / `user_mismatch` /
`bot_not_disabled` / `credential_already_exists` / `exchange_not_found`). Fix and re-dry-run. **No value is
ever printed.**

## Step 2 — REAL RUN (creates the Vault secret + credential row) — approval-gated
```
cd worker && doppler run -- node ../scripts/provision-tiny-live.mjs --bot <BOT_ID> --user <USER_ID>
```
Expect:
- `{"event":"pre_checks","ok":true,...}`
- `{"event":"vault_secret_created","vault_secret_fp":"xxxxxxxx..xxxxxxxx"}`
- `{"event":"credential_created","credential_id":"<uuid>","vault_secret_fp":"xxxxxxxx..xxxxxxxx"}`
- `{"event":"post_checks","credential_id":"<uuid>","bot_unchanged":true}`
- `{"event":"done","dryRun":false,"credentialId":"<uuid>","vaultSecretFp":"xxxxxxxx..xxxxxxxx"}`

The script fails loud (non-zero exit) on any error; a `post_check_bot_changed` would mean the bot was touched
(should never happen — investigate before proceeding). **Only ids + fingerprint are printed.**

## Step 3 — Independent verification (read-only SQL on linked)
```sql
-- credential row (never select the vault_secret_id VALUE)
select id, user_id, exchange_environment, status, label
from public.user_exchange_credentials where id = '<credential_id>';
-- expect: user_id=<USER_ID>, exchange_environment='mainnet', status='pending_validation', label='mainnet/tiny-live/<BOT_ID>'

-- bot UNCHANGED + still disabled
select id, status, trading_enabled, credential_id from public.bots where id = '<BOT_ID>';
-- expect: status<>'active', trading_enabled=false, credential_id == pre-run value (no repoint)

-- exactly one new Vault secret was created (baseline was 2 → expect 3)
select count(*) as vault_secrets_now from vault.secrets;   -- expect 3
```

## Rollback
- **Delete the credential row if unused** (not repointed/validated):
  `delete from public.user_exchange_credentials where id = '<credential_id>';`
- **Vault secret delete** — `select public.delete_vault_secret('<vault_secret_id>');` — **separate reviewed
  emergency action only** (destructive). Only when fully abandoning the credential, after the row is deleted.

## Next step (after this)
Worker **read-only** validation from the 3 Railway IPs → promote the credential to `valid` (or `invalid` +
reason). **No order. No repoint. No trading enable. No A11. No activation.**

## Boundaries
Nothing executed by this runbook. The dry-run writes nothing; the real run creates exactly one Vault secret +
one `pending_validation` credential row and **does not touch `bots`**. No `doppler run` executed here, no
deploy, no bot repoint, no trading enable, no mainnet order.
