#!/usr/bin/env node
// worker/scripts/validate-credential.mjs — READ-ONLY mainnet credential validation. Runs ON the Railway
// worker (Console) so it egresses via the A1 static IPs (the Binance key is IP-allowlisted to them).
//
// SECURITY (hard):
//   - Reads the exchange secret from Vault (get_decrypted_secret); keeps it in MEMORY ONLY.
//   - Calls ONLY read-only endpoints: fetchBalance (auth proof) + sapiGetAccountApiRestrictions.
//     NEVER createOrder / cancelOrder / withdraw / transfer / any mutating endpoint.
//   - Prints NO balances, NO api key/secret, NO Vault JSON, NO full vault_secret_id (fingerprint only).
//   - Emits a non-secret evidence object + evidence_hash. Does NOT promote the credential (no DB write).
//
// Run (operator, ONLY after Codex PASS + approval, in the Railway Console):
//   cd worker && node scripts/validate-credential.mjs --credential <CREDENTIAL_ID>
// Tests (no network, no secrets, no Vault, no DB — injected mock deps):
//   node --test worker/scripts/validate-credential.test.mjs
import { createHash } from 'node:crypto';

export const ALLOWED_EGRESS_IPS = ['208.77.244.242', '152.55.184.240', '152.55.184.241'];

export function isAllowedEgressIp(ip) {
  return ALLOWED_EGRESS_IPS.includes(String(ip ?? '').trim());
}

/** Non-secret fingerprint of a uuid: first8..last8. */
export function fingerprint(id) {
  const s = String(id ?? '');
  return s.length >= 16 ? `${s.slice(0, 8)}..${s.slice(-8)}` : 'invalid';
}

/**
 * Assess Binance GET /sapi/v1/account/apiRestrictions. Core gates must be VISIBLE and correct
 * (withdrawals off, ip restriction on, spot enabled). Transfer/margin toggles are "off if visible":
 * a visible+enabled one FAILS; an absent one is null (not asserted). Coerces boolean-or-'true' strings.
 */
export function assessRestrictions(r) {
  const truthy = (v) => v === true || v === 'true';
  const has = (k) => r != null && Object.prototype.hasOwnProperty.call(r, k);
  const withdrawals_off = has('enableWithdrawals') ? !truthy(r.enableWithdrawals) : false; // must confirm OFF
  const ip_restrict     = has('ipRestrict') ? truthy(r.ipRestrict) : false;                // must confirm ON
  const spot_enabled    = has('enableSpotAndMarginTrading') ? truthy(r.enableSpotAndMarginTrading) : false;
  const offIfVisible = (k) => (has(k) ? !truthy(r[k]) : null); // true=off, false=on(FAIL), null=not visible
  const universal_transfer_off = offIfVisible('permitsUniversalTransfer');
  const internal_transfer_off  = offIfVisible('enableInternalTransfer');
  const margin_off             = offIfVisible('enableMargin');
  const transfers_ok = universal_transfer_off !== false && internal_transfer_off !== false && margin_off !== false;
  const ok = withdrawals_off && ip_restrict && spot_enabled && transfers_ok;
  return { ok, withdrawals_off, ip_restrict, spot_enabled, universal_transfer_off, internal_transfer_off, margin_off };
}

/** Deterministic sha256 of the non-secret evidence (sorted keys). Inputs are non-secret by construction. */
export function evidenceHash(evidence) {
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  return createHash('sha256').update(JSON.stringify(sortKeys(evidence))).digest('hex');
}

/**
 * Validate (read-only). deps:
 *   getCredential(id) -> { id, status, exchange_environment, vault_secret_id } | null   (throws on read error)
 *   getEgressIp() -> string
 *   getSecret(vaultSecretId) -> { apiKey, apiSecret }   (from Vault; kept in memory, never logged)
 *   binanceAuthOk(creds) -> boolean                     (fetchBalance; balances discarded)
 *   binanceApiRestrictions(creds) -> object             (read-only apiRestrictions)
 *   now() -> iso string ; log(obj) -> void
 * Returns { ok, evidence?, reason?, egress_ip? }. NEVER writes/promotes. Fail-closed: egress must pass
 * BEFORE the secret is ever fetched or used.
 */
export async function validate(deps, { credentialId }) {
  const cred = await deps.getCredential(credentialId);
  if (!cred) return { ok: false, reason: 'credential_not_found' };
  if (cred.status !== 'pending_validation') return { ok: false, reason: 'credential_not_pending' };
  if (cred.exchange_environment !== 'mainnet') return { ok: false, reason: 'credential_not_mainnet' };
  // EP6: the venue (ccxt id) must be resolved — a credential we cannot map to an exchange is
  // unverifiable. Fail-closed rather than default to any venue.
  if (typeof cred.ccxt_id !== 'string' || cred.ccxt_id.length === 0) return { ok: false, reason: 'exchange_unresolved' };

  // Egress gate FIRST — if we are not on an allowlisted IP, do not even fetch/use the key.
  const egress_ip = await deps.getEgressIp();
  if (!isAllowedEgressIp(egress_ip)) return { ok: false, reason: 'egress_ip_not_allowlisted', egress_ip };

  const creds = await deps.getSecret(cred.vault_secret_id); // memory only; never logged
  const auth_ok = await deps.authOk(creds, cred.ccxt_id);   // fetchBalance — venue-agnostic auth proof
  if (!auth_ok) return { ok: false, reason: 'auth_failed', egress_ip };

  // Key-permission introspection is VENUE-SPECIFIC: Binance exposes it (sapiGetAccountApiRestrictions);
  // most venues do NOT expose it uniformly via ccxt. A null result ⇒ we cannot AUTO-verify
  // withdrawals-off / IP-restriction here → FAIL-CLOSED to manual verification (never auto-OK a key
  // whose restrictions we could not prove; the operator confirms them at the exchange, per the runbook).
  const restrictions = await deps.apiRestrictions(creds, cred.ccxt_id);

  const evidence = {
    credential_id: cred.id,                         // row id (non-secret)
    exchange: cred.ccxt_id,                         // venue (non-secret)
    vault_secret_fp: fingerprint(cred.vault_secret_id), // fingerprint ONLY (never the full pointer)
    egress_ip, egress_ip_ok: true, auth_ok: true,
    checked_at: deps.now(),
  };

  if (restrictions == null) {
    evidence.restrictions_verified = false;
    evidence.evidence_hash = evidenceHash(evidence);
    // Auth is proven; permissions are NOT auto-verified for this venue. Not OK to auto-promote.
    return { ok: false, reason: 'restrictions_require_manual_verification', evidence };
  }

  const a = assessRestrictions(restrictions);
  evidence.withdrawals_off = a.withdrawals_off;
  evidence.ip_restrict = a.ip_restrict;
  evidence.spot_enabled = a.spot_enabled;
  evidence.universal_transfer_off = a.universal_transfer_off;
  evidence.internal_transfer_off = a.internal_transfer_off;
  evidence.margin_off = a.margin_off;
  evidence.restrictions_verified = true;
  evidence.evidence_hash = evidenceHash(evidence);

  if (!a.ok) return { ok: false, reason: 'restrictions_failed', evidence };
  return { ok: true, evidence };
  // No promotion here — a SEPARATE reviewed step records the evidence and sets status='valid'.
}

// ---- real deps (only used by main()) ------------------------------------------------------------
function realDeps(svc, ccxt) {
  // EP6: build the ccxt instance for the credential's OWN venue (fail-closed on an unknown id) —
  // no longer hardcoded to binance.
  const buildExchange = (creds, ccxtId) => {
    const Ctor = ccxt[ccxtId];
    if (typeof Ctor !== 'function') throw new Error('unsupported_exchange');
    return new Ctor({ apiKey: creds.apiKey, secret: creds.apiSecret, enableRateLimit: true });
  };
  return {
    getCredential: async (id) => {
      const { data, error } = await svc.from('user_exchange_credentials')
        .select('id, status, exchange_environment, vault_secret_id, exchange_id').eq('id', id).maybeSingle();
      if (error) throw new Error('credential_read_error');
      if (!data) return null;
      // Resolve the venue's ccxt id (separate read — the codebase avoids PostgREST embeddings).
      const { data: ex, error: exErr } = await svc.from('exchanges')
        .select('ccxt_id').eq('id', data.exchange_id).maybeSingle();
      if (exErr) throw new Error('exchange_read_error');
      return { ...data, ccxt_id: ex?.ccxt_id ?? null };
    },
    getEgressIp: async () => (await (await fetch('https://api.ipify.org?format=text')).text()).trim(),
    getSecret: async (vaultSecretId) => {
      const { data, error } = await svc.rpc('get_decrypted_secret', { secret_id: vaultSecretId });
      if (error) throw new Error('secret_read_error');
      if (!data) throw new Error('secret_empty');
      const parsed = JSON.parse(data); // { api_key, api_secret }
      return { apiKey: parsed.api_key, apiSecret: parsed.api_secret };
    },
    authOk: async (creds, ccxtId) => {
      const ex = buildExchange(creds, ccxtId);
      try { await ex.fetchBalance(); return true; } catch { return false; } // balances discarded, never printed
    },
    apiRestrictions: async (creds, ccxtId) => {
      // Binance: read-only key-permission introspection. Other venues: no uniform ccxt endpoint →
      // return null so validate() fails closed to manual verification. NEVER a mutating call.
      if (ccxtId !== 'binance') return null;
      return buildExchange(creds, ccxtId).sapiGetAccountApiRestrictions();
    },
    now: () => new Date().toISOString(),
    log: (o) => console.log(JSON.stringify(o)),
  };
}

function parseArgs(argv) {
  const out = { credential: null };
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--credential') out.credential = argv[++i];
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.credential) { console.error(JSON.stringify({ event: 'usage_error', need: ['--credential <CREDENTIAL_ID>'] })); process.exit(2); }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error(JSON.stringify({ event: 'env_missing', missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] })); process.exit(2); }
  const { createClient } = await import('@supabase/supabase-js');
  const ccxt = (await import('ccxt')).default ?? (await import('ccxt'));
  const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const deps = realDeps(svc, ccxt);
  try {
    const r = await validate(deps, { credentialId: args.credential });
    deps.log({ event: r.ok ? 'validation_ok' : 'validation_failed', reason: r.reason ?? null, ...(r.evidence ? { evidence: r.evidence } : {}), ...(r.egress_ip && !r.evidence ? { egress_ip: r.egress_ip } : {}) });
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(JSON.stringify({ event: 'validation_error', error: e instanceof Error ? e.message : 'unknown' })); // no secret
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) main();
