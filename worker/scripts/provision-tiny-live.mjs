#!/usr/bin/env node
// scripts/provision-tiny-live.mjs — one-shot operator provisioning: Doppler -> Vault -> credential row.
//
// SECURITY (hard):
//   - Reads the Binance key/secret from env (Doppler-injected). Keeps them in MEMORY ONLY.
//   - Sends the secret to Vault via the create_vault_secret RPC (031) over TLS (service_role).
//   - NEVER prints the API key, the secret, the Vault JSON, or the full vault_secret_id — only ids,
//     fingerprints (first8..last8), booleans, and counts.
//   - Does NOT touch public.bots (no repoint, no trading enable). Inserts exactly one credential row
//     with status='pending_validation'. Fail-closed everywhere.
//
// Run (operator, ONLY after Codex PASS + explicit approval). Lives under worker/scripts/ so Node resolves
// @supabase/supabase-js from worker/node_modules automatically (no NODE_PATH needed):
//   cd worker && doppler run -- node scripts/provision-tiny-live.mjs --bot <BOT_ID> --user <USER_ID>
//   add --dry-run to PREFLIGHT (PRE checks only; NO Vault write, NO insert).
//
// Tests (no network, no secrets, no Vault, no DB — injected mock deps):
//   node --test worker/scripts/provision-tiny-live.test.mjs

export const ENV_KEYS = {
  apiKey: 'BINANCE_MAINNET_API_KEY_TINY_LIVE',
  apiSecret: 'BINANCE_MAINNET_API_SECRET_TINY_LIVE',
};

/** Build the Vault secret JSON in memory. Shape matches VaultSecretsProvider (parsed.api_key/api_secret). */
export function buildSecretJson(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) throw new Error('missing_binance_credentials'); // message carries NO value
  return JSON.stringify({ api_key: apiKey, api_secret: apiSecret });
}

/** Non-secret fingerprint of a uuid: first8..last8. Never reveals the middle. */
export function fingerprint(id) {
  const s = String(id ?? '');
  return s.length >= 16 ? `${s.slice(0, 8)}..${s.slice(-8)}` : 'invalid';
}

/**
 * Sanitize a PostgREST/PG error for logging: keep `code` + `message` + `hint`, but DROP `details`
 * (PG echoes the offending row VALUES there — e.g. a vault_secret_id on a unique_violation), and scrub any
 * uuid from the surfaced strings. Never returns the API key/secret or the full vault_secret_id.
 */
export function sanitizePg(error) {
  const scrub = (s) => String(s ?? '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>');
  return { code: error?.code ?? null, message: scrub(error?.message), hint: scrub(error?.hint) }; // details omitted on purpose
}

/** Read required Binance env by NAME. Returns values (in memory) + the list of MISSING names (never values). */
export function readEnv(env) {
  const apiKey = env[ENV_KEYS.apiKey];
  const apiSecret = env[ENV_KEYS.apiSecret];
  const missing = [];
  if (!apiKey) missing.push(ENV_KEYS.apiKey);
  if (!apiSecret) missing.push(ENV_KEYS.apiSecret);
  return { apiKey, apiSecret, missing };
}

/**
 * PRE checks (read-only). deps (each THROWS on a read/PostgREST error — never swallowed):
 *   getBot(botId) -> { id, user_id, status, trading_enabled, credential_id } | null
 *   getCredentialExchangeId(credentialId) -> uuid | null   (exchange_id read from the bot's existing credential)
 *   countExistingCred(userId, label) -> number
 * A read error is surfaced as an explicit fail-closed reason (e.g. 'credential_read_error'), NOT as a false
 * 'not_found'/'ok'. exchange_id is resolved from the bot's own credential (service_role cannot read the
 * `exchanges` table, and the bot already references the correct Binance exchange_id).
 */
export async function preChecks(deps, { botId, userId, label }) {
  let bot;
  try { bot = await deps.getBot(botId); } catch { return { ok: false, reason: 'bots_read_error' }; }
  if (!bot) return { ok: false, reason: 'bot_not_found' };
  if (bot.user_id !== userId) return { ok: false, reason: 'user_mismatch' };
  if (bot.status === 'active' || bot.trading_enabled === true) return { ok: false, reason: 'bot_not_disabled' };
  if (!bot.credential_id) return { ok: false, reason: 'bot_has_no_credential' }; // can't resolve the exchange

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

/**
 * Provision (or preflight). deps also needs:
 *   createVaultSecret(json, name, desc) -> uuid
 *   insertCredential(row) -> uuid (credential id)
 *   log(obj) -> void
 * Returns { dryRun, credentialId, vaultSecretFp }. Throws (fail-closed) on any failure; no secret in errors.
 */
export async function provision(deps, { botId, userId, apiKey, apiSecret, dryRun }) {
  const label = `mainnet/tiny-live/${botId}`;

  const pre = await preChecks(deps, { botId, userId, label });
  deps.log({
    event: 'pre_checks', ok: pre.ok, reason: pre.reason ?? null,
    bot_id: botId, user_id: userId, keys_present: Boolean(apiKey && apiSecret),
  });
  if (!pre.ok) throw new Error(`pre_check_failed:${pre.reason}`);

  const secretJson = buildSecretJson(apiKey, apiSecret); // in memory only; never logged

  if (dryRun) {
    deps.log({ event: 'dry_run_ok', would_write_vault: true, would_insert_credential: true, label, exchange_id: pre.exchangeId, secret_built: true });
    return { dryRun: true, credentialId: null, vaultSecretFp: null };
  }

  const vaultSecretId = await deps.createVaultSecret(secretJson, `binance/${label}`, 'tiny-live mainnet spot, trade-only, withdrawals off');
  if (!vaultSecretId) throw new Error('vault_write_failed');
  const fp = fingerprint(vaultSecretId);
  deps.log({ event: 'vault_secret_created', vault_secret_fp: fp }); // FINGERPRINT ONLY

  const credentialId = await deps.insertCredential({
    user_id: userId,
    exchange_id: pre.exchangeId,
    vault_secret_id: vaultSecretId,        // SERVER-SET pointer (C-1; 026 trigger enforces owner-binding)
    label,                                  // 'mainnet/tiny-live/<BOT_ID>'
    status: 'pending_validation',
    exchange_environment: 'mainnet',
  });
  if (!credentialId) throw new Error('credential_insert_failed');
  deps.log({ event: 'credential_created', credential_id: credentialId, vault_secret_fp: fp });

  // POST: bot must be UNCHANGED (no repoint) and still disabled.
  const after = await deps.getBot(botId);
  const botUnchanged = Boolean(after) && after.credential_id === pre.bot.credential_id && after.trading_enabled === false && after.status !== 'active';
  deps.log({ event: 'post_checks', credential_id: credentialId, bot_unchanged: botUnchanged });
  if (!botUnchanged) throw new Error('post_check_bot_changed'); // should never happen; fail loud

  return { dryRun: false, credentialId, vaultSecretFp: fp };
}

// ---- real Supabase deps (only used by main()) ---------------------------------------------------
function realDeps(svc) {
  return {
    getBot: async (botId) => {
      const { data, error } = await svc.from('bots')
        .select('id, user_id, status, trading_enabled, credential_id')
        .eq('id', botId).is('deleted_at', null).maybeSingle();
      if (error) throw new Error('bots_read_error'); // never swallow — fail closed
      return data ?? null;
    },
    // Resolve exchange_id from the bot's OWN credential (service_role cannot SELECT the exchanges table).
    getCredentialExchangeId: async (credentialId) => {
      const { data, error } = await svc.from('user_exchange_credentials')
        .select('exchange_id').eq('id', credentialId).maybeSingle(); // by id; env/deleted irrelevant to exchange_id
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
    createVaultSecret: async (json, name, desc) => {
      const { data, error } = await svc.rpc('create_vault_secret', { secret_value: json, secret_name: name, secret_description: desc });
      if (error) { const e = new Error('vault_write_failed'); e.pg = sanitizePg(error); throw e; }
      return data;
    },
    insertCredential: async (row) => {
      const { data, error } = await svc.from('user_exchange_credentials').insert(row).select('id').single();
      if (error) { const e = new Error('credential_insert_failed'); e.pg = sanitizePg(error); throw e; } // sanitized code/message; no secret
      return data?.id ?? null;
    },
    log: (o) => console.log(JSON.stringify(o)),
  };
}

function parseArgs(argv) {
  const out = { bot: null, user: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bot') out.bot = argv[++i];
    else if (argv[i] === '--user') out.user = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bot || !args.user) {
    console.error(JSON.stringify({ event: 'usage_error', need: ['--bot <BOT_ID>', '--user <USER_ID>', '[--dry-run]'] }));
    process.exit(2);
  }
  const { apiKey, apiSecret, missing } = readEnv(process.env);
  if (missing.length) { console.error(JSON.stringify({ event: 'env_missing', missing })); process.exit(2); } // NAMES only
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error(JSON.stringify({ event: 'env_missing', missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] })); process.exit(2); }

  const { createClient } = await import('@supabase/supabase-js');
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const deps = realDeps(svc);
  try {
    const r = await provision(deps, { botId: args.bot, userId: args.user, apiKey, apiSecret, dryRun: args.dryRun });
    console.log(JSON.stringify({ event: 'done', ...r }));
  } catch (e) {
    // Surface the sanitized PG code/message/hint (no secret, no full uuid, no details) to aid diagnosis.
    console.error(JSON.stringify({ event: 'failed', error: e instanceof Error ? e.message : 'unknown', pg: (e && e.pg) ?? null }));
    process.exit(1);
  }
}

// Run main() only when invoked directly (not when imported by the test).
const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
