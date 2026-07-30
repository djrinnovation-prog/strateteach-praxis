# LIVE-PATH — operator credential provisioning packet (Doppler → Vault → credential row, C-1-safe)

One-shot, operator-run, server-side provisioning of the tiny-live Binance credential. **Packet only — DO NOT
EXECUTE.** No secret values printed anywhere. No bot repoint. No trading enable. No order. No A11.

Confirmed Doppler names (values NEVER printed): `BINANCE_MAINNET_API_KEY_TINY_LIVE`,
`BINANCE_MAINNET_API_SECRET_TINY_LIVE`.

## Prerequisites (must exist before running — currently DO NOT)
- **Vault WRITE wrapper**: this repo has `get_decrypted_secret` (004, read) and `delete_vault_secret`
  (005, delete) but **no write wrapper**. Provisioning needs a new SECURITY DEFINER, **service_role-only**
  `create_vault_secret(secret_json text, secret_name text, secret_description text) returns uuid` (mirrors
  004/005; wraps `vault.create_secret`). → **new gated migration + Codex PASS + linked apply** first.
  *(Alternative: a direct `pg` superuser call to `vault.create_secret` — but the wrapper matches the
  codebase's least-privilege pattern and is preferred.)*
- **C-1 owner-binding** (migration 026) applied on linked — its trigger guarantees the new `vault_secret_id`
  can't be cross-bound. (A fresh uuid bound to the target user is clean regardless.)
- Provisioning runs as a one-shot script with Doppler env injected (`doppler run -- …`), using the
  service_role client. The two secrets live **in process memory only** — never a file, never argv, never a log.

## 1. PRE checks (all must pass; fail-closed)
1. **Doppler key exists by NAME only** — e.g. `doppler secrets --only-names` shows
   `BINANCE_MAINNET_API_KEY_TINY_LIVE` and `BINANCE_MAINNET_API_SECRET_TINY_LIVE`. **Never print the value.**
   The script asserts both env vars are non-empty and aborts if not (no value echoed).
2. **Target bot selected** — a single `<BOT_ID>` (the tiny-live bot). Confirm it exists and is
   `deleted_at IS NULL`.
3. **Target user_id confirmed** — `<USER_ID>` = that bot's `user_id`. The credential row is created for this
   user; it must match the bot owner.
4. **`exchange_environment = mainnet`** — this is a mainnet credential.
5. **No bot repoint** — provisioning creates a credential row ONLY; it must NOT set `bots.credential_id`.
   Record the bot's current `credential_id` before/after to prove it is unchanged.
6. **No trading enable** — `bots.trading_enabled` stays `false` and `status` stays not-`active` throughout.
7. Resolve `exchange_id` for Binance: `select id from public.exchanges where ccxt_id = 'binance'`.
8. (Advisory) Binance-side restrictions already set: withdrawals OFF, spot-only, IP-allowlisted to the 3
   worker egress IPs — the read-only validation (next step) re-verifies these.

## 2. Server-side Vault write
- **Secret JSON shape** (built in memory from the two Doppler env vars — snake_case, matches
  `VaultSecretsProvider` which reads `parsed.api_key` / `parsed.api_secret`):
  ```json
  { "api_key": "<BINANCE_MAINNET_API_KEY_TINY_LIVE>", "api_secret": "<BINANCE_MAINNET_API_SECRET_TINY_LIVE>" }
  ```
  (Placeholders shown for shape ONLY — the real values are never rendered.)
- **Write**: `create_vault_secret(secret_json, name := 'binance/mainnet/tiny-live/<BOT_ID>', description := 'tiny-live mainnet spot, trade-only, withdrawals off')` → returns `vault_secret_id` (uuid).
- **No secret logging**: the script logs only a **fingerprint** of the returned uuid (`first8..last8`) + the
  name. It never logs the key, the secret, the JSON, or the full uuid.
- **Returns**: `vault_secret_id` held in memory for the insert (§3); to the operator, only the **fingerprint**.

## 3. Credential row insert (server-set pointer — C-1)
```
insert into public.user_exchange_credentials
  (user_id, exchange_id, vault_secret_id, label, status, exchange_environment)
values
  ('<USER_ID>', '<BINANCE_EXCHANGE_ID>', '<vault_secret_id from §2>',
   'mainnet/tiny-live/<BOT_ID>', 'pending_validation', 'mainnet');
```
- `status = 'pending_validation'` (not usable until the read-only validation promotes it).
- `exchange_environment = 'mainnet'`.
- `vault_secret_id` is **server-set** (this whole path is service_role/server-side; the client never sets it)
  — the C-1 invariant; migration 026's trigger enforces owner-binding on the fresh uuid.
- `label` encodes **mainnet / tiny-live / bot**: `mainnet/tiny-live/<BOT_ID>`.
- **Does NOT touch `bots`** — no `credential_id` set, no repoint.

## 4. POST checks
1. **Credential row exists**: `select id, status, exchange_environment, user_id from
   user_exchange_credentials where id = '<cred_id>'` → `status='pending_validation'`,
   `exchange_environment='mainnet'`, `user_id='<USER_ID>'`. **Do NOT select `vault_secret_id`'s value** —
   fingerprint only if needed.
2. **Bot still not repointed**: `bots.credential_id` for `<BOT_ID>` equals the pre-check value (unchanged).
3. **Bot still disabled**: `bots.trading_enabled = false` AND `status <> 'active'` for `<BOT_ID>`.
4. **No secret value printed**: confirm the run output + any logs contain only ids + fingerprints — no key,
   secret, JSON, or full `vault_secret_id`.

## 5. Rollback
- **Delete the credential row if unused** (not yet repointed/validated): `delete from
  user_exchange_credentials where id = '<cred_id>'` (or soft-delete via `deleted_at`). Safe because no bot
  references it (§4.2).
- **Vault secret delete** — `delete_vault_secret('<vault_secret_id>')` — is a **separate, reviewed emergency
  action ONLY** (destructive; irreversible). Do it only when fully abandoning the credential, and only after
  the row is deleted / nothing points to it. Not part of the routine rollback.

## 6. Next step (after this)
- **Worker read-only validation from the Railway static IPs** (separate packet): the worker fetches the
  secret from Vault (allowlisted IP), calls Binance **read-only** (`fetchBalance` / API-restrictions),
  asserts withdrawals-off + spot + env-match, and promotes the credential to `valid` (or `invalid` + reason).
  **No order. No A11. No activation.** Repoint (`bots.credential_id`) and activation remain separate,
  later, explicitly-approved steps.

## Product note
The **end-user future flow** does the identical downstream via the **`connect-exchange` UI/Edge function**
(user types the key/secret in the browser → Edge fn writes Vault + sets the pointer). The **current
tiny-live path is operator provisioning from Doppler staging** — same Vault write, same C-1-safe server-set
pointer, same `pending_validation` outcome — just sourced from Doppler instead of a browser form.

## Boundaries
No deploy. No secret values. No bot repoint. No trading enable. No mainnet order. No A11. This packet is for
review; nothing is executed and no code/migration is written until Codex PASS.
