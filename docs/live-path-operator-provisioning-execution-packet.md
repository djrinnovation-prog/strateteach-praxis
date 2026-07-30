# LIVE-PATH — operator provisioning EXECUTION packet (Doppler → Vault → credential row)

Provision the tiny-live Binance credential: **Doppler → Vault (`create_vault_secret`, 031) →
`user_exchange_credentials` row (`pending_validation`)**. **Packet only — DO NOT EXECUTE.** No bot repoint,
no trading enable, no order. The **only** part that touches the secret is a one-shot server-side script;
PRE/POST are pure read-only SQL. Doppler names (values NEVER printed):
`BINANCE_MAINNET_API_KEY_TINY_LIVE`, `BINANCE_MAINNET_API_SECRET_TINY_LIVE`.

## Prerequisite
- `create_vault_secret` (031) applied + tracked on linked. ✅ (done)
- A one-shot **provisioning script** (below) — must be authored + Codex PASS before it is run. This packet
  specifies its exact logic; it is not written or run here.

## Execution shape (secret hygiene)
Run once with Doppler injecting the env: `doppler run -- node scripts/provision-tiny-live.mjs`. The script uses
the **service_role** Supabase client. The two secrets exist **only in process memory**, are sent to Vault via
the `create_vault_secret` RPC over TLS, and are **never** logged, printed, written to a file, or passed in
argv. The script prints only ids + a `vault_secret_id` **fingerprint**.

Fill in before running: `<BOT_ID>`, `<USER_ID>` (= that bot's `user_id`), `<BINANCE_EXCHANGE_ID>`.

## 1. PRE checks (read-only — run/verify before the write; ABORT if any fails)
**(a) Doppler keys exist by NAME only** (no value):
```
doppler secrets --only-names | grep -E 'BINANCE_MAINNET_API_(KEY|SECRET)_TINY_LIVE'
```
Expect both names present. Never print values.

**(b) Linked read-only SQL** (`supabase db query --linked --file …`):
```sql
-- target bot exists, is DISABLED, and record its current credential_id (proves no repoint later)
select id as bot_id, user_id, status, trading_enabled, credential_id
from public.bots where id = '<BOT_ID>' and deleted_at is null;
-- expect: user_id='<USER_ID>', status <> 'active', trading_enabled=false; note credential_id (unchanged later)

-- resolve Binance exchange_id
select id as binance_exchange_id from public.exchanges where ccxt_id = 'binance';

-- NO existing live mainnet credential already provisioned for this bot/user (idempotency / no-dup)
select count(*) as existing_mainnet_creds
from public.user_exchange_credentials
where user_id = '<USER_ID>' and exchange_environment = 'mainnet' and deleted_at is null
  and label = 'mainnet/tiny-live/<BOT_ID>';
-- expect 0
```
ABORT if: bot missing / active / `trading_enabled=true`, user_id mismatch, or `existing_mainnet_creds > 0`.

## 2. Vault write (script — the only secret-touching step)
```js
// env from Doppler (asserted non-empty; values never printed)
const apiKey    = process.env.BINANCE_MAINNET_API_KEY_TINY_LIVE;
const apiSecret = process.env.BINANCE_MAINNET_API_SECRET_TINY_LIVE;
if (!apiKey || !apiSecret) throw new Error('missing Doppler key (no value printed)');

const secret_value = JSON.stringify({ api_key: apiKey, api_secret: apiSecret }); // {"api_key":"...","api_secret":"..."}
const { data: vaultSecretId, error } = await svc.rpc('create_vault_secret', {
  secret_value,
  secret_name: 'binance/mainnet/tiny-live/<BOT_ID>',
  secret_description: 'tiny-live mainnet spot, trade-only, withdrawals off',
});
if (error) throw new Error('vault_write_failed');           // fail-closed; no secret in the error
const fp = `${vaultSecretId.slice(0,8)}..${vaultSecretId.slice(-8)}`;
console.log(JSON.stringify({ event: 'vault_secret_created', vault_secret_fp: fp })); // FINGERPRINT ONLY
```
- Secret shape written to Vault: `{ "api_key": "...", "api_secret": "..." }` (matches `VaultSecretsProvider`).
- No secret values printed; only `vault_secret_fp`.

## 3. Credential row insert (server-set pointer — C-1)
```js
const { data: cred, error: insErr } = await svc
  .from('user_exchange_credentials')
  .insert({
    user_id: '<USER_ID>',
    exchange_id: '<BINANCE_EXCHANGE_ID>',
    vault_secret_id: vaultSecretId,               // SERVER-SET (never client) — C-1; 026 trigger enforces owner-binding
    label: 'mainnet/tiny-live/<BOT_ID>',          // includes tiny-live / mainnet / bot
    status: 'pending_validation',
    exchange_environment: 'mainnet',
  })
  .select('id')
  .single();
if (insErr) throw new Error('credential_insert_failed');
console.log(JSON.stringify({ event: 'credential_created', credential_id: cred.id, vault_secret_fp: fp }));
// Does NOT touch public.bots — no credential_id set, no repoint.
```

## 4. POST checks (read-only SQL)
```sql
-- credential row exists with the right shape (NEVER select the vault_secret_id value)
select id, user_id, exchange_environment, status, label
from public.user_exchange_credentials where id = '<credential_id>';
-- expect: user_id='<USER_ID>', exchange_environment='mainnet', status='pending_validation', label='mainnet/tiny-live/<BOT_ID>'

-- bot UNCHANGED (credential_id equals the PRE value) + still disabled
select id, status, trading_enabled, credential_id
from public.bots where id = '<BOT_ID>';
-- expect: status <> 'active', trading_enabled=false, credential_id == PRE value (no repoint)

-- exactly ONE new live mainnet credential for this bot/user
select count(*) from public.user_exchange_credentials
where user_id='<USER_ID>' and exchange_environment='mainnet' and deleted_at is null and label='mainnet/tiny-live/<BOT_ID>';
-- expect 1
```
Also confirm the script output contained only ids + `vault_secret_fp` — **no secret value**.

## 5. Rollback
- **Delete the credential row if unused** (not yet repointed/validated):
  ```sql
  delete from public.user_exchange_credentials where id = '<credential_id>';
  ```
  Safe — no bot references it (POST §4 shows `credential_id` unchanged).
- **Vault secret delete** — `select public.delete_vault_secret('<vault_secret_id>');` — is a **separate,
  reviewed emergency action ONLY** (destructive/irreversible). Do it only when fully abandoning the
  credential, after the row is deleted. Not part of routine rollback.

## 6. Next step
**Worker read-only validation from the Railway static IPs** (separate packet): the worker fetches the secret
from Vault (allowlisted IP), calls Binance **read-only** (`fetchBalance` / API-restrictions), asserts
withdrawals-off + spot + env-match, and promotes the credential to `valid` (or `invalid` + reason). **No
order. No repoint. No trading enable. No A11. No activation.**

## Boundaries
Nothing executed. No deploy. No bot repoint. No trading enable. No mainnet order. The provisioning script is
specified, not written/run — authored + Codex PASS before any execution; the real secret is only ever handled
in-memory by that script, never printed.
