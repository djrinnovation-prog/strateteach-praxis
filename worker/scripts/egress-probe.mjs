#!/usr/bin/env node
// ============================================================================
// A1 Option A — keyless egress proof probe.
//
// Captures the worker's OUTBOUND IPv4 (+ /24 for reference) from neutral IP-echo
// providers, and Binance PUBLIC reachability (/api/v3/ping + /api/v3/time). Used
// before/after the Railway "Static Outbound IPs" toggle + redeploys to prove the
// egress IP is stable (see docs/production-a1-option-a-native-static-egress-packet.md §4,
// docs/production-a1-egress-probe-runbook.md).
//
// STRICTLY keyless / read-only:
//   - NO secrets read or printed (only an optional NON-SECRET region label).
//   - NO Binance auth, NO signed request, NO order, NO account/balance endpoint.
//   - NO mainnet action. Output = non-secret evidence JSON only.
//
// Run it INSIDE the deployed worker container (railway ssh / a temporary start
// command) so it observes the WORKER's egress IP. Running it locally reports YOUR
// machine's IP, not the worker's.
//
//   node scripts/egress-probe.mjs            # or: npm run egress-probe
//   EGRESS_PROBE_REGION=us-west1 node scripts/egress-probe.mjs   # optional evidence label
//
// Standalone: imports nothing from the worker; uses global fetch (Node >= 20).
// Diagnostic tool — always exits 0; the operator asserts stability across redeploys.
// ============================================================================

const TIMEOUT_MS = 8000;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

// Neutral IP-echo providers (redundant — we cross-check they agree). Public, keyless.
const IP_ECHO = [
  { name: 'aws-checkip', url: 'https://checkip.amazonaws.com',      parse: (t) => t.trim() },
  { name: 'ipify',       url: 'https://api.ipify.org?format=json',  parse: (t) => JSON.parse(t).ip },
  { name: 'icanhazip',   url: 'https://ipv4.icanhazip.com',         parse: (t) => t.trim() },
];

// Binance PUBLIC endpoints only — reachability proof, NOT allowlist enforcement, NOT auth.
const BINANCE_PUBLIC = [
  { name: 'ping', url: 'https://api.binance.com/api/v3/ping' },
  { name: 'time', url: 'https://api.binance.com/api/v3/time' },
];

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, body: null, ms: Date.now() - started, error: e?.name ?? 'error' };
  } finally {
    clearTimeout(timer);
  }
}

function cidr24(ip) {
  const p = String(ip).split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : null;
}

async function main() {
  // 1) Egress IPv4 from multiple neutral providers; cross-check agreement.
  const ipProviders = [];
  for (const p of IP_ECHO) {
    const r = await fetchText(p.url);
    let ip = null;
    let ipv4 = false;
    if (r.ok && r.body != null) {
      try { ip = p.parse(r.body); ipv4 = IPV4_RE.test(ip ?? ''); } catch { ip = null; }
    }
    ipProviders.push({ provider: p.name, ok: r.ok, status: r.status, ip: ipv4 ? ip : ip, ipv4, ms: r.ms, error: r.error });
  }
  const v4 = ipProviders.filter((r) => r.ipv4).map((r) => r.ip);
  const uniqueIps = [...new Set(v4)];
  const agree = uniqueIps.length === 1;
  const egressIpv4 = agree ? uniqueIps[0] : null;

  // 2) Binance PUBLIC reachability (no auth, no order). time -> serverTime is public + non-secret.
  const binance = [];
  for (const b of BINANCE_PUBLIC) {
    const r = await fetchText(b.url);
    let serverTime = null;
    if (b.name === 'time' && r.ok && r.body) { try { serverTime = JSON.parse(r.body).serverTime ?? null; } catch { /* ignore */ } }
    binance.push({ endpoint: b.name, reachable: r.ok, status: r.status, ms: r.ms, serverTime, error: r.error });
  }
  const binanceReachable = binance.every((b) => b.reachable);

  const evidence = {
    artifact: 'a1-egress-probe',
    kind: 'keyless-egress-proof',
    ts: new Date().toISOString(),
    region_label: process.env.EGRESS_PROBE_REGION ?? null, // NON-SECRET label the operator may set for evidence
    egress_ipv4: egressIpv4,
    egress_cidr_24: egressIpv4 ? cidr24(egressIpv4) : null,
    ip_providers_agree: agree,
    ip_providers: ipProviders,
    binance_public_reachable: binanceReachable,
    binance_public: binance,
    note: 'keyless/public only — no auth, no order, no secret. Reachability != Binance allowlist enforcement. '
        + 'Run inside the worker container to capture the worker egress IP; assert egress_ipv4 identical across redeploys.',
  };

  // Evidence is NON-SECRET (egress IP is operational infra info, intended for the A4 allowlist).
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((e) => {
  // Never leak more than the error class; a probe failure is diagnostic, not fatal.
  console.log(JSON.stringify({ artifact: 'a1-egress-probe', ok: false, error: e?.name ?? 'error' }));
});
