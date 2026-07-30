// worker/tools/lib/safe-payload.ts
//
// Pure, dependency-free helpers for SECRET-SAFE alert/report payloads. Shared by the S4-1
// alert poller and the S4-0.5 evidence reporter. This module:
//   - does NOT import worker runtime code
//   - does NOT connect to a DB, send HTTP, or read secrets
//   - is pure and fully unit-testable
//
// Two-layer safety:
//   1. ALLOW-LIST (pickAllowed): only known-safe keys survive; tokens/urls/bodies/etc. are dropped.
//   2. CONTENT SCAN (assertSafePayload): rejects any forbidden key or secret-looking value that
//      slipped into an allowed field — fail loud, never emit.

export const ALLOWED_ALERT_FIELDS = [
  'event',
  'count',
  'bot_id',
  'trade_id',
  'signal_id',
  'status',
  'age_seconds',
  'exchange_order_id',
  'environment',
  'deploy_id',
  'timestamp',
  // additional non-sensitive context:
  'table',
  'reason_code', // a STATIC error class/code only — never a raw message (enforced by the scan)
  'newest',
] as const;

export type AllowedAlertField = (typeof ALLOWED_ALERT_FIELDS)[number];
export type SafeAlert = Partial<Record<AllowedAlertField, string | number>>;

/** Keep only allow-listed keys; everything else (tokens, urls, bodies, raw_payload, …) is dropped. */
export function pickAllowed(raw: Record<string, unknown>): SafeAlert {
  const out: SafeAlert = {};
  for (const key of ALLOWED_ALERT_FIELDS) {
    const v = raw[key];
    // Emit ONLY scalar string/number. Never booleans, objects, or arrays: those could nest
    // secrets or stringify to leaky/uninformative values, so any non-scalar (incl. null/undefined)
    // is dropped entirely.
    if (typeof v === 'string' || typeof v === 'number') out[key] = v;
  }
  return out;
}

// Value-content patterns that must never appear in any payload field.
const FORBIDDEN_VALUE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'url', re: /\bhttps?:\/\//i },
  { name: 'postgres_url', re: /\bpostgres(ql)?:\/\//i },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}/ },
  { name: 'bearer', re: /\bbearer\s+\S+/i },
  { name: 'authorization', re: /\bauthorization\b/i },
  { name: 'service_role', re: /service_role/i },
  { name: 'api_secret_key', re: /\b(sk|pk|rk)_[A-Za-z0-9]{8,}/ },
  { name: 'telegram_bot_token', re: /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/ },
  { name: 'pepper', re: /pepper/i },
  { name: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'password_kv', re: /\bpass(word|wd)?\s*[:=]/i },
];

// --- High-entropy opaque-secret heuristic (catches raw secrets with no fixed shape) ---
//
// The FORBIDDEN_VALUE_PATTERNS above only catch secrets with a recognizable SHAPE
// (urls, JWTs, sk_/pk_/rk_ prefixes, telegram tokens, PEM). A raw high-entropy secret —
// e.g. a 64-char hex or a base64 token dropped into an allowed scalar like deploy_id /
// environment / reason_code — has no such shape and would pass through unredacted.
//
// Heuristic: scan for a long, contiguous run of token-charset characters and, if it also
// looks random (high Shannon entropy), treat it as an opaque secret. We deliberately use
// the base64-standard alphabet [A-Za-z0-9+/=] and let every OTHER character (notably '-'
// and '_', but also '.', ':', whitespace) terminate a run. That split is what keeps normal
// structured values safe: UUIDs (bot_id/trade_id), kebab-case ("eu-west-1", "deploy-1234"),
// snake_case ("reason_code_abc"), and ISO timestamps all break into short segments and never
// reach the length threshold. Only a genuinely opaque, separator-free blob survives to the
// entropy test. Fail-safe: a long random-looking run is rejected (payload never emits).
const MIN_TOKEN_LEN = 32; // shortest run we consider suspicious (64-char hex, 40-char base64, …)
const MIN_TOKEN_ENTROPY = 3.5; // bits/char; random hex ≈ 4.0, base64 ≈ 5–6, English words ≈ 2–3
const TOKEN_RUN_RE = new RegExp(`[A-Za-z0-9+/=]{${MIN_TOKEN_LEN},}`, 'g');

/** Shannon entropy (bits per character) of a string. */
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** True if `text` contains a long, high-entropy token-charset run (an opaque secret). */
function hasHighEntropyToken(text: string): boolean {
  const runs = text.match(TOKEN_RUN_RE);
  if (!runs) return false;
  return runs.some((run) => shannonEntropy(run) >= MIN_TOKEN_ENTROPY);
}

// Keys that must never appear (defense-in-depth on top of the allow-list).
const FORBIDDEN_KEY_RE =
  /(token|secret|pass(word|wd)?|api[_-]?key|authorization|^auth$|header|cookie|^body$|raw_payload|payload|source_ip|ip_address|service_role|url|dsn|vault|connection|conn_str|pepper|bearer|signature|message|stack|cause|healthcheck|telegram|chat_id)/i;

export interface ForbiddenHit {
  kind: 'key' | 'value';
  name: string; // forbidden key name, or the value-pattern name
  where: string; // the payload key the hit was found under
}

/** Scan a candidate payload for forbidden keys or forbidden value-content. Pure, no throw. */
export function findForbidden(payload: Record<string, unknown>): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (FORBIDDEN_KEY_RE.test(key)) hits.push({ kind: 'key', name: key, where: key });
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    for (const p of FORBIDDEN_VALUE_PATTERNS) {
      if (p.re.test(text)) hits.push({ kind: 'value', name: p.name, where: key });
    }
    // Shapeless opaque secrets (raw hex / base64 dropped into an allowed scalar).
    if (hasHighEntropyToken(text)) hits.push({ kind: 'value', name: 'high_entropy_token', where: key });
  }
  return hits;
}

export class ForbiddenFieldError extends Error {
  constructor(readonly hits: ForbiddenHit[]) {
    super(`safe-payload: rejected — ${hits.map((h) => `${h.kind}:${h.name}@${h.where}`).join(', ')}`);
    this.name = 'ForbiddenFieldError';
  }
}

/** Throws ForbiddenFieldError if the payload contains any forbidden key or value-content. */
export function assertSafePayload(payload: Record<string, unknown>): void {
  const hits = findForbidden(payload);
  if (hits.length > 0) throw new ForbiddenFieldError(hits);
}

/**
 * Build a guaranteed-safe payload from a raw record:
 *   1. keep only allow-listed keys (drops tokens/urls/bodies/raw_payload/source_ip/…)
 *   2. assert no forbidden key or value-content survived (catches secrets smuggled into allowed fields)
 * Throws ForbiddenFieldError if step 2 finds anything — never silently emits a leaky payload.
 */
export function buildSafeAlert(raw: Record<string, unknown>): SafeAlert {
  const picked = pickAllowed(raw);
  assertSafePayload(picked);
  return picked;
}

/** Render a safe payload to a single non-secret line (e.g. for Telegram). Re-validates first. */
export function renderAlertText(raw: Record<string, unknown>): string {
  const safe = buildSafeAlert(raw);
  return Object.entries(safe)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
}
