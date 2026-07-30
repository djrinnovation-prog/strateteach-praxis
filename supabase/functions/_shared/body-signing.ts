// Optional per-bot webhook body signing (T4 — dormant / opt-in). A SECOND factor on top of the
// URL path token: the SIGNAL SOURCE (a signing relay — vanilla TradingView cannot set headers or
// compute an HMAC) sends X-Praxis-Signature = lowercase-hex HMAC-SHA256(bodyKey, rawBody), with a
// timestamp INSIDE the signed body. The server derives the SAME bodyKey from the Edge-only pepper
// (never stored) using a DOMAIN TAG so it can never collide with the URL-token hash
// (HMAC(pepper, token)), and verifies constant-time via crypto.subtle.verify. Because the signature
// covers the whole raw body (incl. signal_id and the timestamp), an attacker cannot alter any field
// or replay a fresh signal_id without the key; the freshness window bounds replay of the exact same
// signed payload (which signal_id dedup then absorbs).
//
// Pure + I/O-free (pepper is passed in) → unit-testable, identical wherever it is called.
import { b64urlToBytes, hexToBytes } from "./webhook-hash.ts";

const enc = new TextEncoder();

// Domain separation from the URL-token hash. A URL-token message is the token string; this domain
// prefix + bot_id can never equal a token, so the two HMAC(pepper, ·) uses are cryptographically split.
const BODY_SIGN_DOMAIN = "praxis.webhook.body-sign.v1|";

// Case-insensitive: hexToBytes/parseInt accept either case, and many HMAC libraries emit
// uppercase — accepting both avoids a relay foot-gun while staying strict on shape/length.
export const BODY_SIGNATURE_RE = /^[0-9a-fA-F]{64}$/;
export const DEFAULT_FRESHNESS_WINDOW_MS = 300_000; // ±5 minutes

// Raw per-bot key material = HMAC-SHA256(pepper, DOMAIN + botId). This is the value an operator
// hands to the signing relay (as hex) to sign bodies with. Throws "config:missing_pepper" fail-closed.
export async function deriveBodyKeyMaterial(pepperB64url: string, botId: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!pepperB64url) throw new Error("config:missing_pepper");
  const pepperKey = await crypto.subtle.importKey(
    "raw", b64urlToBytes(pepperB64url), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const material = await crypto.subtle.sign("HMAC", pepperKey, enc.encode(BODY_SIGN_DOMAIN + botId));
  return new Uint8Array(material);
}

// Import the derived material as the HMAC verification key used server-side.
export async function deriveBodyKey(pepperB64url: string, botId: string): Promise<CryptoKey> {
  const material = await deriveBodyKeyMaterial(pepperB64url, botId);
  return await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
}

// Constant-time verify of a hex body signature over the RAW request bytes. A malformed/absent hex
// signature returns false (never throws) — a bad second factor is a rejection, not a config fault.
export async function verifyBodySignature(key: CryptoKey, rawBody: string, sigHex: string): Promise<boolean> {
  if (typeof sigHex !== "string" || !BODY_SIGNATURE_RE.test(sigHex)) return false;
  return await crypto.subtle.verify("HMAC", key, hexToBytes(sigHex), enc.encode(rawBody));
}

// Freshness of the in-body timestamp: epoch seconds, epoch milliseconds, or an ISO-8601 string.
// |now - ts| must be within the window. Missing / non-parseable ⇒ false (fail-closed).
export function timestampFresh(ts: unknown, nowMs: number, windowMs = DEFAULT_FRESHNESS_WINDOW_MS): boolean {
  let t: number;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    t = ts < 1e12 ? ts * 1000 : ts; // heuristic: < 1e12 ⇒ seconds, else milliseconds
  } else if (typeof ts === "string") {
    const p = Date.parse(ts);
    if (Number.isNaN(p)) return false;
    t = p;
  } else {
    return false;
  }
  return Math.abs(nowMs - t) <= windowMs;
}
