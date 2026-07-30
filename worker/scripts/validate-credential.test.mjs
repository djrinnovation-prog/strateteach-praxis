// Mock/unit tests for validate-credential.mjs. NO network, NO secrets, NO Vault, NO DB, NO Binance.
// Run: node --test worker/scripts/validate-credential.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedEgressIp, assessRestrictions, fingerprint, evidenceHash, validate, ALLOWED_EGRESS_IPS,
} from './validate-credential.mjs';

const CRED = '1164c49b-bf7a-4593-802f-920d76669082';
const VAULT_ID = 'd14d87b1-0000-0000-0000-0000ed6a76c5';
const FAKE_KEY = 'FAKE_API_KEY_zzz';
const FAKE_SECRET = 'FAKE_API_SECRET_yyy';
const GOOD_RESTRICTIONS = {
  ipRestrict: true, enableWithdrawals: false, enableSpotAndMarginTrading: true,
  permitsUniversalTransfer: false, enableInternalTransfer: false, enableReading: true,
};

function capture() { const logs = []; return { log: (o) => logs.push(o), logs, dump: () => JSON.stringify(logs) }; }
function baseDeps(over = {}) {
  return {
    getCredential: async () => ({ id: CRED, status: 'pending_validation', exchange_environment: 'mainnet', vault_secret_id: VAULT_ID, ccxt_id: 'binance' }),
    getEgressIp: async () => '152.55.184.240',
    getSecret: async () => ({ apiKey: FAKE_KEY, apiSecret: FAKE_SECRET }),
    authOk: async () => true,
    apiRestrictions: async () => ({ ...GOOD_RESTRICTIONS }),
    now: () => '2026-07-15T00:00:00.000Z',
    log: () => {},
    ...over,
  };
}

test('isAllowedEgressIp: only the 3 static IPs', () => {
  for (const ip of ALLOWED_EGRESS_IPS) assert.equal(isAllowedEgressIp(ip), true);
  assert.equal(isAllowedEgressIp('1.2.3.4'), false);
  assert.equal(isAllowedEgressIp(' 152.55.184.240 '), true); // trims
  assert.equal(isAllowedEgressIp(null), false);
});

test('assessRestrictions: good config -> ok', () => {
  const a = assessRestrictions(GOOD_RESTRICTIONS);
  assert.deepEqual([a.ok, a.withdrawals_off, a.ip_restrict, a.spot_enabled], [true, true, true, true]);
});
test('assessRestrictions: withdrawals ON -> fail', () => {
  assert.equal(assessRestrictions({ ...GOOD_RESTRICTIONS, enableWithdrawals: true }).ok, false);
});
test('assessRestrictions: ipRestrict OFF -> fail; spot OFF -> fail', () => {
  assert.equal(assessRestrictions({ ...GOOD_RESTRICTIONS, ipRestrict: false }).ok, false);
  assert.equal(assessRestrictions({ ...GOOD_RESTRICTIONS, enableSpotAndMarginTrading: false }).ok, false);
});
test('assessRestrictions: a VISIBLE transfer toggle ON -> fail; ABSENT -> null (not asserted)', () => {
  assert.equal(assessRestrictions({ ...GOOD_RESTRICTIONS, permitsUniversalTransfer: true }).ok, false);
  const { permitsUniversalTransfer, enableInternalTransfer, ...noTransfers } = GOOD_RESTRICTIONS;
  const a = assessRestrictions(noTransfers);
  assert.equal(a.ok, true);
  assert.equal(a.universal_transfer_off, null);
});
test('assessRestrictions: missing core fields -> fail (cannot confirm)', () => {
  assert.equal(assessRestrictions({}).ok, false);
  assert.equal(assessRestrictions({}).withdrawals_off, false);
});
test('assessRestrictions: coerces string booleans', () => {
  assert.equal(assessRestrictions({ ipRestrict: 'true', enableWithdrawals: 'false', enableSpotAndMarginTrading: 'true' }).ok, true);
});

test('evidenceHash: deterministic; changes with content', () => {
  const e = { a: 1, b: 2 };
  assert.equal(evidenceHash(e), evidenceHash({ b: 2, a: 1 })); // key order independent
  assert.notEqual(evidenceHash(e), evidenceHash({ a: 1, b: 3 }));
  assert.match(evidenceHash(e), /^[0-9a-f]{64}$/);
});

test('validate: happy path -> ok, evidence + hash, fingerprint only', async () => {
  const r = await validate(baseDeps(), { credentialId: CRED });
  assert.equal(r.ok, true);
  assert.equal(r.evidence.credential_id, CRED);
  assert.equal(r.evidence.vault_secret_fp, 'd14d87b1..ed6a76c5');
  assert.equal(r.evidence.withdrawals_off, true);
  assert.equal(r.evidence.ip_restrict, true);
  assert.equal(r.evidence.spot_enabled, true);
  assert.match(r.evidence.evidence_hash, /^[0-9a-f]{64}$/);
});

test('validate: EP6 non-Binance venue (no ccxt restriction introspection) -> manual verification, auth proven', async () => {
  const r = await validate(baseDeps({
    getCredential: async () => ({ id: CRED, status: 'pending_validation', exchange_environment: 'mainnet', vault_secret_id: VAULT_ID, ccxt_id: 'bybit' }),
    apiRestrictions: async () => null,   // realDeps returns null for any non-binance venue
  }), { credentialId: CRED });
  assert.equal(r.ok, false);                                   // NOT auto-OK without restriction proof
  assert.equal(r.reason, 'restrictions_require_manual_verification');
  assert.equal(r.evidence.auth_ok, true);                      // auth WAS proven (fetchBalance)
  assert.equal(r.evidence.exchange, 'bybit');
  assert.equal(r.evidence.restrictions_verified, false);
  assert.match(r.evidence.evidence_hash, /^[0-9a-f]{64}$/);
});

test('validate: EP6 unresolved venue (ccxt_id missing) -> exchange_unresolved; secret NEVER touched', async () => {
  let secretCalled = 0;
  const r = await validate(baseDeps({
    getCredential: async () => ({ id: CRED, status: 'pending_validation', exchange_environment: 'mainnet', vault_secret_id: VAULT_ID, ccxt_id: null }),
    getSecret: async () => { secretCalled++; return { apiKey: FAKE_KEY, apiSecret: FAKE_SECRET }; },
  }), { credentialId: CRED });
  assert.equal(r.reason, 'exchange_unresolved');
  assert.equal(secretCalled, 0);                                // fail-closed BEFORE the key is fetched
});

test('validate: SECURITY — no key/secret/JSON/full vault_secret_id in the result', async () => {
  const cap = capture();
  const r = await validate(baseDeps({ log: cap.log }), { credentialId: CRED });
  const dump = JSON.stringify(r) + cap.dump();
  assert.equal(dump.includes(FAKE_KEY), false);
  assert.equal(dump.includes(FAKE_SECRET), false);
  assert.equal(dump.includes('api_key'), false);
  assert.equal(dump.includes(VAULT_ID), false);            // full pointer never present
  assert.equal(dump.includes('d14d87b1..ed6a76c5'), true); // fingerprint present
});

test('validate: egress NOT allowlisted -> fail, and secret/auth NEVER touched', async () => {
  let secretCalled = 0, authCalled = 0, restrCalled = 0;
  const deps = baseDeps({
    getEgressIp: async () => '9.9.9.9',
    getSecret: async () => { secretCalled++; return { apiKey: FAKE_KEY, apiSecret: FAKE_SECRET }; },
    authOk: async () => { authCalled++; return true; },
    apiRestrictions: async () => { restrCalled++; return GOOD_RESTRICTIONS; },
  });
  const r = await validate(deps, { credentialId: CRED });
  assert.equal(r.reason, 'egress_ip_not_allowlisted');
  assert.equal(secretCalled, 0); // fail-closed BEFORE the key is fetched
  assert.equal(authCalled, 0);
  assert.equal(restrCalled, 0);
});

test('validate: credential PRE failures', async () => {
  assert.equal((await validate(baseDeps({ getCredential: async () => null }), { credentialId: CRED })).reason, 'credential_not_found');
  assert.equal((await validate(baseDeps({ getCredential: async () => ({ id: CRED, status: 'valid', exchange_environment: 'mainnet', vault_secret_id: VAULT_ID, ccxt_id: 'binance' }) }), { credentialId: CRED })).reason, 'credential_not_pending');
  assert.equal((await validate(baseDeps({ getCredential: async () => ({ id: CRED, status: 'pending_validation', exchange_environment: 'testnet', vault_secret_id: VAULT_ID, ccxt_id: 'binance' }) }), { credentialId: CRED })).reason, 'credential_not_mainnet');
});

test('validate: auth failure -> auth_failed (no restrictions call)', async () => {
  let restrCalled = 0;
  const r = await validate(baseDeps({ authOk: async () => false, apiRestrictions: async () => { restrCalled++; return GOOD_RESTRICTIONS; } }), { credentialId: CRED });
  assert.equal(r.reason, 'auth_failed');
  assert.equal(restrCalled, 0);
});

test('validate: bad restrictions -> restrictions_failed (evidence carries the failing flags)', async () => {
  const r = await validate(baseDeps({ apiRestrictions: async () => ({ ...GOOD_RESTRICTIONS, enableWithdrawals: true }) }), { credentialId: CRED });
  assert.equal(r.reason, 'restrictions_failed');
  assert.equal(r.evidence.withdrawals_off, false);
});

test('validate: NEVER promotes / no mutating deps present', async () => {
  const deps = baseDeps();
  // The read-only dep set carries no write/order/promote capability.
  for (const k of ['updateCredential', 'promote', 'createOrder', 'withdraw', 'transfer', 'cancelOrder']) {
    assert.equal(k in deps, false, `dep ${k} must not exist`);
  }
  const r = await validate(deps, { credentialId: CRED });
  assert.equal(r.ok, true); // validate returns evidence; it does not write anything
});
