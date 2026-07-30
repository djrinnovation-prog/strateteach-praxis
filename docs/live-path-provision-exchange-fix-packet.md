# LIVE-PATH — provisioning script fix packet (exchange_id resolution + error handling)

Fix two defects in `worker/scripts/provision-tiny-live.mjs` surfaced by the dry-run's `exchange_not_found`.
**Packet only — implement locally after Codex PASS.** No provisioning, no Vault secret, no credential row.

## Root cause (recap, verified read-only)
- The `binance` exchange row EXISTS (`ccxt_id='binance'`, id `aca29e72-…`, active); all 5 testnet creds use it.
- But **`service_role` has NO SELECT grant on `public.exchanges`** (this project grants service_role
  explicitly per-migration; `exchanges` was never granted). `bots` + `user_exchange_credentials` ARE granted.
- The script's `getExchangeId` read `exchanges`, got a PostgREST **permission error (42501)**, and
  `return data?.id ?? null` **swallowed** it to `null` → PRE mapped it to `exchange_not_found`.

## Fix 1 — resolve `exchange_id` from the bot's existing credential (no `exchanges` read, no new grant)
The target bot already references a Binance credential (`bots.credential_id`), whose `exchange_id` is the
correct Binance id. service_role CAN read `user_exchange_credentials`, so read the exchange_id from there.
Reusing it puts the new mainnet credential on the **same exchange** as the bot's existing one.

- **Remove** dep `getExchangeId(ccxtId)`.
- **Add** dep `getCredentialExchangeId(credentialId) -> exchange_id | null` (reads
  `user_exchange_credentials.exchange_id` by the credential's id; no `exchanges` access).
- `preChecks` uses `bot.credential_id` → `getCredentialExchangeId` → `exchangeId`.
- New fail-closed reason `bot_has_no_credential` if `bot.credential_id` is null (can't resolve the exchange).

## Fix 2 — do not swallow PostgREST errors; return the real pre-check reason (fail-closed)
Real deps **throw** on any PostgREST `error` (instead of returning `null`/`0`). `preChecks` wraps each read in
try/catch and returns a **specific reason** so the operator sees the true cause — never a false
"not found"/"ok". Any read failure ⇒ abort before any write.

### New `preChecks` logic
```js
export async function preChecks(deps, { botId, userId, label }) {
  let bot;
  try { bot = await deps.getBot(botId); } catch { return { ok: false, reason: 'bots_read_error' }; }
  if (!bot) return { ok: false, reason: 'bot_not_found' };
  if (bot.user_id !== userId) return { ok: false, reason: 'user_mismatch' };
  if (bot.status === 'active' || bot.trading_enabled === true) return { ok: false, reason: 'bot_not_disabled' };
  if (!bot.credential_id) return { ok: false, reason: 'bot_has_no_credential' };

  let exchangeId;
  try { exchangeId = await deps.getCredentialExchangeId(bot.credential_id); }
  catch { return { ok: false, reason: 'credential_read_error' }; }
  if (!exchangeId) return { ok: false, reason: 'exchange_unresolved_from_credential' };

  let existing;
  try { existing = await deps.countExistingCred(userId, label); }
  catch { return { ok: false, reason: 'existing_cred_read_error' }; }
  if (existing > 0) return { ok: false, reason: 'credential_already_exists' };

  return { ok: true, bot, exchangeId, existing };
}
```
`provision()` is unchanged except it consumes `pre.exchangeId` (now from the credential). It still throws
`pre_check_failed:<reason>` on `!pre.ok` — so a read error aborts fail-closed with the real reason, before any
Vault write or insert.

### New/updated real deps (throw on error — no swallow)
```js
getBot: async (botId) => {
  const { data, error } = await svc.from('bots')
    .select('id, user_id, status, trading_enabled, credential_id')
    .eq('id', botId).is('deleted_at', null).maybeSingle();
  if (error) throw new Error('bots_read_error');
  return data ?? null;
},
getCredentialExchangeId: async (credentialId) => {
  const { data, error } = await svc.from('user_exchange_credentials')
    .select('exchange_id').eq('id', credentialId).maybeSingle();   // by id; env/deleted irrelevant to exchange_id
  if (error) throw new Error('credential_read_error');
  return data?.exchange_id ?? null;
},
countExistingCred: async (userId, label) => {
  const { count, error } = await svc.from('user_exchange_credentials')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('exchange_environment', 'mainnet').is('deleted_at', null).eq('label', label);
  if (error) throw new Error('existing_cred_read_error');
  return count ?? 0;
},
// getExchangeId removed.
```

## Reason catalog (after fix)
`bots_read_error` · `bot_not_found` · `user_mismatch` · `bot_not_disabled` · `bot_has_no_credential` ·
`credential_read_error` · `exchange_unresolved_from_credential` · `existing_cred_read_error` ·
`credential_already_exists`. (Read failures are now explicit, not hidden as "not found".)

## Tests to update/add (`worker/scripts/provision-tiny-live.test.mjs`)
- `baseDeps`: replace `getExchangeId` with `getCredentialExchangeId: async () => EXID`.
- Update the happy-path + COMMIT tests to assert the credential insert uses `exchange_id = EXID` resolved via
  `getCredentialExchangeId(bot.credential_id)`.
- **New error-handling tests (fail-closed, no swallow):**
  - `getBot` throws → `preChecks.reason === 'bots_read_error'` and provision rejects before any write.
  - `getCredentialExchangeId` throws → `credential_read_error`; returns null → `exchange_unresolved_from_credential`.
  - `countExistingCred` throws → `existing_cred_read_error`.
  - `bot.credential_id === null` → `bot_has_no_credential`.
  - Assert that on any read error, `createVaultSecret`/`insertCredential` are **never** called.
- Keep the existing dry-run / security / no-bots-update / dup tests (still valid).

## Validate after implementing (local only)
`node --test worker/scripts/provision-tiny-live.test.mjs` (mock, no network/secret/DB) + `node --check`.

## Boundaries
Packet only — no code changed yet. On PASS: edit the script + tests, run mock tests + `node --check`, report.
No provisioning, no Vault secret, no credential row, no `exchanges` write, no new grant, no deploy, no mainnet.
