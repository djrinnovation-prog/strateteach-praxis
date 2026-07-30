// Mock/unit tests for provision-tiny-live.mjs. NO network, NO secrets, NO Vault, NO DB — injected deps.
// Run: node --test scripts/provision-tiny-live.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSecretJson, fingerprint, sanitizePg, readEnv, preChecks, provision, ENV_KEYS } from './provision-tiny-live.mjs';

const BOT = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
const USER = 'user-uuid-0001';
const EXID = 'exch-uuid-binance';
const VAULT_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
const FAKE_KEY = 'FAKE_API_KEY_VALUE_zzz';
const FAKE_SECRET = 'FAKE_API_SECRET_VALUE_yyy';
const LABEL = `mainnet/tiny-live/${BOT}`;

function capture() {
  const logs = [];
  return { log: (o) => logs.push(o), logs, dump: () => JSON.stringify(logs) };
}
function baseDeps(over = {}) {
  return {
    getBot: async () => ({ id: BOT, user_id: USER, status: 'paused', trading_enabled: false, credential_id: 'cred-old' }),
    getCredentialExchangeId: async () => EXID,  // resolved from the bot's existing credential
    countExistingCred: async () => 0,
    createVaultSecret: async () => VAULT_ID,
    insertCredential: async () => 'cred-new',
    ...over,
  };
}

test('buildSecretJson: exact snake_case shape; throws (no value) on missing', () => {
  assert.equal(buildSecretJson('AK', 'SK'), '{"api_key":"AK","api_secret":"SK"}');
  assert.throws(() => buildSecretJson('', 'SK'), /missing_binance_credentials/);
  assert.throws(() => buildSecretJson('AK', ''), /missing_binance_credentials/);
});

test('fingerprint: first8..last8; short -> invalid; never reveals the middle', () => {
  assert.equal(fingerprint(VAULT_ID), 'abcdef12..34567890');
  assert.equal(fingerprint('short'), 'invalid');
  assert.equal(fingerprint(VAULT_ID).includes('7890-abcd-ef12'), false);
});

test('sanitizePg: keeps code/message/hint, DROPS details, scrubs uuids (no secret/full-uuid leak)', () => {
  const err = {
    code: '23505',
    message: `duplicate key value violates unique constraint; key (vault_secret_id)=(${VAULT_ID}) exists`,
    details: `Key (vault_secret_id)=(${VAULT_ID}) already exists.`, // PG echoes VALUES here
    hint: null,
  };
  const s = sanitizePg(err);
  assert.equal(s.code, '23505');                       // code kept
  assert.equal('details' in s, false);                 // details dropped (it echoes row values)
  assert.equal(s.message.includes(VAULT_ID), false);   // uuid scrubbed from message
  assert.equal(s.message.includes('<uuid>'), true);
  // permission-denied (our real failure) — code kept, no values to leak
  assert.equal(sanitizePg({ code: '42501', message: 'permission denied for table user_exchange_credentials' }).code, '42501');
});

test('readEnv: reports MISSING names (never values)', () => {
  const r1 = readEnv({});
  assert.deepEqual(r1.missing.sort(), [ENV_KEYS.apiKey, ENV_KEYS.apiSecret].sort());
  const r2 = readEnv({ [ENV_KEYS.apiKey]: 'x', [ENV_KEYS.apiSecret]: 'y' });
  assert.deepEqual(r2.missing, []);
});

test('preChecks: happy path ok', async () => {
  const r = await preChecks(baseDeps(), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(r.ok, true);
  assert.equal(r.exchangeId, EXID);
});

test('preChecks: abort conditions', async () => {
  const notFound = await preChecks(baseDeps({ getBot: async () => null }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(notFound.reason, 'bot_not_found');
  const mismatch = await preChecks(baseDeps({ getBot: async () => ({ id: BOT, user_id: 'other', status: 'paused', trading_enabled: false, credential_id: null }) }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(mismatch.reason, 'user_mismatch');
  const active = await preChecks(baseDeps({ getBot: async () => ({ id: BOT, user_id: USER, status: 'active', trading_enabled: false, credential_id: null }) }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(active.reason, 'bot_not_disabled');
  const enabled = await preChecks(baseDeps({ getBot: async () => ({ id: BOT, user_id: USER, status: 'paused', trading_enabled: true, credential_id: null }) }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(enabled.reason, 'bot_not_disabled');
  const dup = await preChecks(baseDeps({ countExistingCred: async () => 1 }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(dup.reason, 'credential_already_exists');
});

test('preChecks: exchange_id resolved from the bot credential (not the exchanges table)', async () => {
  let askedCredId = null;
  const deps = baseDeps({ getCredentialExchangeId: async (cid) => { askedCredId = cid; return EXID; } });
  const r = await preChecks(deps, { botId: BOT, userId: USER, label: LABEL });
  assert.equal(r.ok, true);
  assert.equal(r.exchangeId, EXID);
  assert.equal(askedCredId, 'cred-old'); // resolved via bot.credential_id
  assert.equal('getExchangeId' in deps, false); // the exchanges-table dep is gone
});

test('preChecks: bot with no credential -> bot_has_no_credential (cannot resolve exchange)', async () => {
  const deps = baseDeps({ getBot: async () => ({ id: BOT, user_id: USER, status: 'paused', trading_enabled: false, credential_id: null }) });
  const r = await preChecks(deps, { botId: BOT, userId: USER, label: LABEL });
  assert.equal(r.reason, 'bot_has_no_credential');
});

test('preChecks: credential exists but no exchange_id -> exchange_unresolved_from_credential', async () => {
  const r = await preChecks(baseDeps({ getCredentialExchangeId: async () => null }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(r.reason, 'exchange_unresolved_from_credential');
});

test('preChecks: READ ERRORS surface as explicit fail-closed reasons (never swallowed)', async () => {
  const botErr = await preChecks(baseDeps({ getBot: async () => { throw new Error('pg 42501'); } }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(botErr.reason, 'bots_read_error');
  const credErr = await preChecks(baseDeps({ getCredentialExchangeId: async () => { throw new Error('pg 42501'); } }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(credErr.reason, 'credential_read_error');
  const cntErr = await preChecks(baseDeps({ countExistingCred: async () => { throw new Error('pg 42501'); } }), { botId: BOT, userId: USER, label: LABEL });
  assert.equal(cntErr.reason, 'existing_cred_read_error');
});

test('a read error aborts BEFORE any Vault write / insert', async () => {
  let vaultCalled = 0, insertCalled = 0;
  const deps = baseDeps({
    getCredentialExchangeId: async () => { throw new Error('pg 42501'); },
    createVaultSecret: async () => { vaultCalled++; return VAULT_ID; },
    insertCredential: async () => { insertCalled++; return 'cred-new'; },
    log: () => {},
  });
  await assert.rejects(
    provision(deps, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: false }),
    /pre_check_failed:credential_read_error/,
  );
  assert.equal(vaultCalled, 0);
  assert.equal(insertCalled, 0);
});

test('DRY-RUN: never calls createVaultSecret or insertCredential', async () => {
  let vaultCalled = 0, insertCalled = 0;
  const cap = capture();
  const deps = baseDeps({
    createVaultSecret: async () => { vaultCalled++; return VAULT_ID; },
    insertCredential: async () => { insertCalled++; return 'cred-new'; },
    log: cap.log,
  });
  const r = await provision(deps, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(vaultCalled, 0);
  assert.equal(insertCalled, 0);
  // dry-run must not leak the secret either
  assert.equal(cap.dump().includes(FAKE_KEY), false);
  assert.equal(cap.dump().includes(FAKE_SECRET), false);
});

test('COMMIT: writes Vault with the exact JSON+name, inserts the credential row with the right fields', async () => {
  let vaultArgs, insertRow;
  const deps = baseDeps({
    createVaultSecret: async (json, name, desc) => { vaultArgs = { json, name, desc }; return VAULT_ID; },
    insertCredential: async (row) => { insertRow = row; return 'cred-new'; },
    log: () => {},
  });
  const r = await provision(deps, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: false });
  assert.equal(r.credentialId, 'cred-new');
  assert.equal(r.vaultSecretFp, 'abcdef12..34567890');
  // Vault write args
  assert.equal(vaultArgs.json, `{"api_key":"${FAKE_KEY}","api_secret":"${FAKE_SECRET}"}`);
  assert.equal(vaultArgs.name, `binance/mainnet/tiny-live/${BOT}`);
  // Credential row shape
  assert.equal(insertRow.exchange_environment, 'mainnet');
  assert.equal(insertRow.status, 'pending_validation');
  assert.equal(insertRow.label, `mainnet/tiny-live/${BOT}`);
  assert.equal(insertRow.vault_secret_id, VAULT_ID);  // server-set
  assert.equal(insertRow.user_id, USER);
  assert.equal(insertRow.exchange_id, EXID);
});

test('SECURITY: logs never contain the key, secret, Vault JSON, or full vault_secret_id — only the fingerprint', async () => {
  const cap = capture();
  const deps = baseDeps({ log: cap.log });
  await provision(deps, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: false });
  const dump = cap.dump();
  assert.equal(dump.includes(FAKE_KEY), false, 'api key leaked');
  assert.equal(dump.includes(FAKE_SECRET), false, 'api secret leaked');
  assert.equal(dump.includes('api_key'), false, 'vault JSON leaked');
  assert.equal(dump.includes(VAULT_ID), false, 'full vault_secret_id leaked');
  assert.equal(dump.includes('abcdef12..34567890'), true, 'fingerprint should be present');
});

test('COMMIT never updates bots (no repoint) + POST bot-unchanged guard', async () => {
  // baseDeps has NO update-bots capability at all; provision must not need one.
  const deps = baseDeps({ log: () => {} });
  assert.equal('updateBot' in deps, false);
  const r = await provision(deps, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: false });
  assert.equal(r.credentialId, 'cred-new');
  // If the bot changed underneath (simulated repoint), provision fails loud.
  let n = 0;
  const changing = baseDeps({
    getBot: async () => (n++ === 0
      ? { id: BOT, user_id: USER, status: 'paused', trading_enabled: false, credential_id: 'cred-old' }
      : { id: BOT, user_id: USER, status: 'paused', trading_enabled: false, credential_id: 'cred-NEW' }), // changed!
    log: () => {},
  });
  await assert.rejects(
    provision(changing, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: false }),
    /post_check_bot_changed/,
  );
});

test('pre_check failure aborts before any write', async () => {
  let vaultCalled = 0;
  const deps = baseDeps({ getBot: async () => null, createVaultSecret: async () => { vaultCalled++; return VAULT_ID; }, log: () => {} });
  await assert.rejects(
    provision(deps, { botId: BOT, userId: USER, apiKey: FAKE_KEY, apiSecret: FAKE_SECRET, dryRun: false }),
    /pre_check_failed:bot_not_found/,
  );
  assert.equal(vaultCalled, 0);
});
