// _shared/rate-limit.ts — A5-1 / H1 webhook rate limiting.
// Runtime-agnostic PURE logic + a deps-injected enforcer. NO Deno/Node globals here, so it is unit-testable
// on any runtime. The Edge webhook (index.ts) wires real deps (service_role rpc bump + audit + log).

export type Tier = "testnet" | "live";
export type FailMode = "open" | "closed";
export type RateDimension = "ip" | "bot";
export type RateAction = "pass" | "reject";

export interface RateConfig {
  enabled: boolean;
  ipPerMin: number;
  botPerMin: number;
  tier: Tier;
  failOverride: FailMode | null;
}

/**
 * Read the rate-limit config from an env getter.
 * - Testnet: OFF unless `WEBHOOK_RATE_LIMIT_ENABLED === "true"` (opt-in; unchanged).
 * - Production (live): rate limiting is FORCED ON (slice 4B / hard-blocker B3) — a missing/false flag can ENABLE but can
 *   NEVER DISABLE protection in live. `tier` derives from `PRAXIS_IS_PRODUCTION` (the same variable the worker uses).
 */
export function rateConfig(getEnv: (k: string) => string | undefined): RateConfig {
  const num = (k: string, d: number) => {
    const v = parseInt(getEnv(k) ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  const ov = getEnv("WEBHOOK_RATE_FAILMODE");
  const tier: Tier = getEnv("PRAXIS_IS_PRODUCTION") === "true" ? "live" : "testnet";
  const flag = getEnv("WEBHOOK_RATE_LIMIT_ENABLED") === "true";
  return {
    enabled: flag || tier === "live",   // live FORCES ON; testnet respects the flag (default OFF)
    ipPerMin: num("WEBHOOK_RATE_IP_PER_MIN", 60),
    botPerMin: num("WEBHOOK_RATE_BOT_PER_MIN", 20),
    tier,
    failOverride: ov === "open" || ov === "closed" ? ov : null,
  };
}

/** 60s fixed window start as ISO (also the DB window_start value). */
export function windowStartIso(nowMs: number): string {
  return new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString();
}

/**
 * H-4: derive the client IP WITHOUT trusting an attacker-controlled value.
 *
 * The left-most `X-Forwarded-For` token is supplied by the client (proxies APPEND the connecting IP
 * to the RIGHT), so keying a rate limit on `xff.split(",")[0]` lets an attacker mint a fresh bucket
 * per request and never trip the limit. Instead:
 *   1. Prefer a single trusted header the edge sets itself (`x-real-ip`) — not a client-appendable list.
 *   2. Otherwise take the RIGHT-most `X-Forwarded-For` token — the hop appended by the closest trusted
 *      proxy (the audit's "right-most untrusted hop after stripping known proxies"). With one trusted
 *      edge hop this is the real client; it can never be spoofed by prepending fake entries.
 *
 * `getHeader` is case-insensitive-callable by the caller. Returns null when no usable IP is present
 * (→ a single shared "unknown" bucket, which fails CLOSED into one rate-limited pool, not unbounded).
 *
 * NOTE (runtime-dependent, verify at deploy — same class as M-13/M-14): the exact trusted header and
 * hop count on the live Supabase edge must be confirmed. Whatever the answer, the left-most XFF token
 * is NEVER trusted again.
 */
export function clientIpFromHeaders(getHeader: (name: string) => string | null): string | null {
  const realIp = getHeader("x-real-ip")?.trim();
  if (realIp) return realIp;
  const xff = getHeader("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]; // RIGHT-most, never left-most
  }
  return null;
}

export function ipKey(ip: string | null, windowIso: string): string {
  return `ip:${ip ?? "unknown"}:${windowIso}`;
}

export function botKey(botId: string, windowIso: string): string {
  return `bot:${botId}:${windowIso}`;
}

/** Over the limit when the post-increment count exceeds the limit (limit N ⇒ N allowed, N+1 rejected). */
export function overLimit(count: number, limit: number): boolean {
  return count > limit;
}

/** Fail mode on a store error, by tier. Live ALWAYS fails closed — an override may NOT force open in live. */
export function failMode(tier: Tier, override: FailMode | null): FailMode {
  if (tier === "live") return "closed";   // live NEVER fails open, regardless of override
  return override ?? "open";               // testnet/prepared: an override may tighten to "closed"
}

/** The per-IP gate runs whenever rate limiting is enabled (pre-auth). */
export function shouldRunIpGate(cfg: RateConfig): boolean {
  return cfg.enabled;
}

/** The per-bot gate runs ONLY when enabled AND the request is authenticated (post-auth). */
export function shouldRunBotGate(cfg: RateConfig, authed: boolean): boolean {
  return cfg.enabled && authed;
}

export interface EnforceDeps {
  bump: (key: string, windowIso: string) => Promise<number>; // atomic insert-or-increment ⇒ new count
  audit: (event: string, after: Record<string, unknown>) => Promise<void>;
  log: (o: Record<string, unknown>) => void;
}

export interface EnforceParams {
  dimension: RateDimension;
  key: string;
  windowIso: string;
  limit: number;
  tier: Tier;
  failOverride: FailMode | null;
}

/**
 * Enforce one rate dimension. Returns "reject" (caller MUST return uniform 200 with NO enqueue) or "pass".
 * On a store error: testnet ⇒ fail-open (pass) + degraded audit; live ⇒ fail-closed (reject) + failclosed audit
 * (uniform 200, no enqueue, no status leak — never fail-open). NEVER throws.
 */
export async function enforceRateLimit(deps: EnforceDeps, p: EnforceParams): Promise<RateAction> {
  // audit + log are BEST-EFFORT: a rate check must NEVER throw (a monitoring failure cannot break the webhook).
  const safeAudit = async (event: string, after: Record<string, unknown>): Promise<void> => {
    try { await deps.audit(event, after); } catch { /* best-effort; swallow */ }
  };
  const safeLog = (o: Record<string, unknown>): void => {
    try { deps.log(o); } catch { /* best-effort; swallow */ }
  };
  let count: number;
  try {
    count = await deps.bump(p.key, p.windowIso);
  } catch (_e) {
    const fm = failMode(p.tier, p.failOverride);
    const event = fm === "closed" ? "webhook_rate_limit_failclosed" : "webhook_rate_limit_degraded";
    await safeAudit(event, { dimension: p.dimension, reason: "rate_store_error", tier: p.tier });
    safeLog({ event, dimension: p.dimension });
    return fm === "closed" ? "reject" : "pass";
  }
  if (overLimit(count, p.limit)) {
    await safeAudit("webhook_rate_limited", {
      dimension: p.dimension, limit: p.limit, count, window_start: p.windowIso, tier: p.tier,
    });
    safeLog({ event: "webhook_rate_limited", dimension: p.dimension });
    return "reject";
  }
  return "pass";
}
