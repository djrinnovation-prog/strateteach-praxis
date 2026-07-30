// rate-limit.test.ts — A5-1 / H1 unit + decision tests. Runtime-agnostic (node:test).
// Run: node --test supabase/functions/_shared/rate-limit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rateConfig, windowStartIso, ipKey, botKey, overLimit, failMode,
  shouldRunIpGate, shouldRunBotGate, enforceRateLimit, clientIpFromHeaders,
  type EnforceDeps,
} from "./rate-limit.ts";

// ── H-4: trusted client-IP extraction (never the client-controlled left-most XFF) ──
const headers = (m: Record<string, string>) => (name: string): string | null =>
  Object.prototype.hasOwnProperty.call(m, name) ? m[name] : null;

test("H-4: prefers x-real-ip over X-Forwarded-For", () => {
  assert.equal(
    clientIpFromHeaders(headers({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })),
    "9.9.9.9",
  );
});
test("H-4: uses the RIGHT-most XFF hop, NOT the attacker-controlled left-most token", () => {
  // Attacker prepends a fake IP; the real connecting IP is appended on the right by the trusted edge.
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.7" })), "203.0.113.7");
});
test("H-4: a single spoofed XFF value cannot mint per-request buckets (right-most is used)", () => {
  // Two requests with different left-most spoofs but the SAME trusted right-most hop ⇒ same IP ⇒ same bucket.
  const a = clientIpFromHeaders(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }));
  const b = clientIpFromHeaders(headers({ "x-forwarded-for": "9.8.7.6, 203.0.113.7" }));
  assert.equal(a, b);
  assert.equal(a, "203.0.113.7");
});
test("H-4: no usable IP ⇒ null (caller maps to a single shared 'unknown' bucket, fails closed)", () => {
  assert.equal(clientIpFromHeaders(headers({})), null);
  assert.equal(ipKey(clientIpFromHeaders(headers({})), "W"), "ip:unknown:W");
});
test("H-4: trims whitespace around tokens", () => {
  assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": " 1.1.1.1 ,  203.0.113.7 " })), "203.0.113.7");
  assert.equal(clientIpFromHeaders(headers({ "x-real-ip": "  8.8.8.8 " })), "8.8.8.8");
});

const env = (m: Record<string, string>) => (k: string) => m[k];

// ── pure helpers ────────────────────────────────────────────────────────────
test("windowStartIso floors to the 60s window", () => {
  assert.equal(windowStartIso(Date.parse("2026-07-05T12:34:56.789Z")), "2026-07-05T12:34:00.000Z");
});
test("ipKey / botKey formats", () => {
  assert.equal(ipKey("1.2.3.4", "W"), "ip:1.2.3.4:W");
  assert.equal(ipKey(null, "W"), "ip:unknown:W");   // null IP ⇒ shared 'unknown' bucket, never skipped
  assert.equal(botKey("bot-1", "W"), "bot:bot-1:W");
});
test("overLimit: limit N allows N, rejects N+1", () => {
  assert.equal(overLimit(60, 60), false);
  assert.equal(overLimit(61, 60), true);
});
test("failMode: testnet=open, live=closed; override CANNOT force open in live", () => {
  assert.equal(failMode("testnet", null), "open");
  assert.equal(failMode("live", null), "closed");        // live NEVER fails open
  assert.equal(failMode("testnet", "closed"), "closed"); // testnet override may tighten
  assert.equal(failMode("live", "open"), "closed");      // override CANNOT force open in live
});

// ── config / gate decisions ─────────────────────────────────────────────────
test("rateConfig: flag OFF by default (flag-off parity)", () => {
  const cfg = rateConfig(env({}));
  assert.equal(cfg.enabled, false);
  assert.equal(shouldRunIpGate(cfg), false);
  assert.equal(shouldRunBotGate(cfg, true), false);
});
test("rateConfig: enabled + tier + numbers", () => {
  const cfg = rateConfig(env({
    WEBHOOK_RATE_LIMIT_ENABLED: "true", WEBHOOK_RATE_IP_PER_MIN: "10",
    WEBHOOK_RATE_BOT_PER_MIN: "3", PRAXIS_IS_PRODUCTION: "true",
  }));
  assert.deepEqual(
    { e: cfg.enabled, ip: cfg.ipPerMin, bot: cfg.botPerMin, t: cfg.tier },
    { e: true, ip: 10, bot: 3, t: "live" },
  );
});
test("wrong-token / unauth NEVER runs the per-bot gate (cannot drain bot budget)", () => {
  const cfg = rateConfig(env({ WEBHOOK_RATE_LIMIT_ENABLED: "true" }));
  assert.equal(shouldRunBotGate(cfg, false), false);  // unauthenticated ⇒ no bot bump
  assert.equal(shouldRunBotGate(cfg, true), true);    // only authenticated increments a bot key
  assert.equal(shouldRunIpGate(cfg), true);           // per-IP still runs (pre-auth), keyed by IP only
});

// ── 4B: production FORCES rate limiting ON (hard-blocker B3) ─────────────────
test("4B tier mapping: only exact PRAXIS_IS_PRODUCTION='true' ⇒ live (same rule as the worker)", () => {
  assert.equal(rateConfig(env({ PRAXIS_IS_PRODUCTION: "true" })).tier, "live");
  for (const v of ["false", "TRUE", "1", "", "yes"]) {
    assert.equal(rateConfig(env({ PRAXIS_IS_PRODUCTION: v })).tier, "testnet", `tier for '${v}'`);
  }
  assert.equal(rateConfig(env({})).tier, "testnet");   // absent ⇒ testnet
});
test("4B: production/live FORCES enabled ON even with the flag ABSENT", () => {
  const cfg = rateConfig(env({ PRAXIS_IS_PRODUCTION: "true" }));   // no WEBHOOK_RATE_LIMIT_ENABLED
  assert.equal(cfg.tier, "live");
  assert.equal(cfg.enabled, true);
  assert.equal(shouldRunIpGate(cfg), true);            // gates run in live even with flag off
  assert.equal(shouldRunBotGate(cfg, true), true);
});
test("4B: missing/false WEBHOOK_RATE_LIMIT_ENABLED CANNOT disable live", () => {
  assert.equal(rateConfig(env({ PRAXIS_IS_PRODUCTION: "true", WEBHOOK_RATE_LIMIT_ENABLED: "false" })).enabled, true);
  assert.equal(rateConfig(env({ PRAXIS_IS_PRODUCTION: "true", WEBHOOK_RATE_LIMIT_ENABLED: "" })).enabled, true);
  // and the flag=true case stays true
  assert.equal(rateConfig(env({ PRAXIS_IS_PRODUCTION: "true", WEBHOOK_RATE_LIMIT_ENABLED: "true" })).enabled, true);
});
test("4B: testnet behavior UNCHANGED — respects the flag (default OFF)", () => {
  assert.equal(rateConfig(env({})).enabled, false);                              // absent ⇒ off
  assert.equal(rateConfig(env({ WEBHOOK_RATE_LIMIT_ENABLED: "false" })).enabled, false);
  assert.equal(rateConfig(env({ WEBHOOK_RATE_LIMIT_ENABLED: "true" })).enabled, true);   // opt-in ⇒ on
  // testnet with flag off ⇒ gates do NOT run
  assert.equal(shouldRunIpGate(rateConfig(env({}))), false);
});

// ── enforceRateLimit ────────────────────────────────────────────────────────
function recorder(bump: (k: string, w: string) => Promise<number>) {
  const audits: Array<{ event: string; after: Record<string, unknown> }> = [];
  const deps: EnforceDeps = { bump, audit: async (event, after) => { audits.push({ event, after }); }, log: () => {} };
  return { deps, audits };
}
const P = (o: Partial<Parameters<typeof enforceRateLimit>[1]> = {}) => ({
  dimension: "ip" as const, key: "k", windowIso: "W", limit: 60, tier: "testnet" as const, failOverride: null, ...o,
});

test("per-IP over limit ⇒ reject + webhook_rate_limited(dim=ip)", async () => {
  const { deps, audits } = recorder(async () => 61);
  assert.equal(await enforceRateLimit(deps, P({ dimension: "ip", limit: 60 })), "reject");
  assert.equal(audits[0].event, "webhook_rate_limited");
  assert.equal(audits[0].after.dimension, "ip");
});
test("per-bot under limit ⇒ pass, no audit", async () => {
  const { deps, audits } = recorder(async () => 5);
  assert.equal(await enforceRateLimit(deps, P({ dimension: "bot", limit: 20 })), "pass");
  assert.equal(audits.length, 0);
});
test("store error, testnet ⇒ fail-OPEN (pass) + degraded audit", async () => {
  const { deps, audits } = recorder(async () => { throw new Error("boom"); });
  assert.equal(await enforceRateLimit(deps, P({ tier: "testnet" })), "pass");
  assert.equal(audits[0].event, "webhook_rate_limit_degraded");
});
test("store error, live ⇒ fail-CLOSED (reject) + failclosed audit (no fail-open)", async () => {
  const { deps, audits } = recorder(async () => { throw new Error("boom"); });
  assert.equal(await enforceRateLimit(deps, P({ tier: "live" })), "reject");
  assert.equal(audits[0].event, "webhook_rate_limit_failclosed");
});

// ── never-throws (audit/log best-effort) ────────────────────────────────────
const throwingDeps = (bump: (k: string, w: string) => Promise<number>): EnforceDeps => ({
  bump,
  audit: async () => { throw new Error("audit boom"); },
  log: () => { throw new Error("log boom"); },
});
test("over-limit + audit/log throw ⇒ reject, no throw", async () => {
  assert.equal(await enforceRateLimit(throwingDeps(async () => 61), P({ dimension: "ip", limit: 60 })), "reject");
});
test("store error live + audit/log throw ⇒ reject, no throw", async () => {
  const bump = async () => { throw new Error("store boom"); };
  assert.equal(await enforceRateLimit(throwingDeps(bump), P({ tier: "live" })), "reject");
});
test("store error testnet + audit/log throw ⇒ pass, no throw", async () => {
  const bump = async () => { throw new Error("store boom"); };
  assert.equal(await enforceRateLimit(throwingDeps(bump), P({ tier: "testnet" })), "pass");
});
