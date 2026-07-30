// Pure webhook-token hashing helper — the SINGLE source of truth for BOTH the
// webhook verifier (supabase/functions/webhook) and the admin rotation hasher
// (supabase/functions/admin-rotate-webhook-token), so the two can never drift.
//
// No Deno.env read, no I/O: the caller passes the pepper (base64url). This keeps
// the module unit-testable and identical in both call sites.
//
// Stored hash format: "v1:" + hex( HMAC-SHA256( key = b64url_decode(pepper), msg = utf8(token) ) )

export const HASH_RE = /^v1:[0-9a-f]{64}$/;

const enc = new TextEncoder();

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 ? "=".repeat(4 - (t.length % 4)) : "";
  const bin = atob(t + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function hexToBytes(h: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

// Compute the stored webhook secret hash for a token.
// Throws "config:missing_pepper" when the pepper is empty (fail-closed).
// The token is used only to produce the digest and is never retained here.
export async function computeWebhookHash(pepperB64url: string, token: string): Promise<string> {
  if (!pepperB64url) throw new Error("config:missing_pepper");
  const key = await crypto.subtle.importKey(
    "raw",
    b64urlToBytes(pepperB64url),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(token));
  return "v1:" + bytesToHex(sig);
}

// Verify a token against a stored "v1:<hex>" hash. Throws "config:missing_pepper"
// / "config:bad_stored_hash" on config faults; returns a boolean only for a
// genuine token comparison. Behaviour is identical to the pre-refactor webhook
// verifyToken (uses crypto.subtle.verify, not a string compare).
export async function verifyWebhookToken(
  pepperB64url: string,
  stored: string,
  token: string,
): Promise<boolean> {
  if (!pepperB64url) throw new Error("config:missing_pepper");
  if (!HASH_RE.test(stored)) throw new Error("config:bad_stored_hash");
  const key = await crypto.subtle.importKey(
    "raw",
    b64urlToBytes(pepperB64url),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(stored.slice(3)), // 32-byte signature from the stored "v1:" hex
    enc.encode(token), // message = raw token bytes
  );
}

// Non-reversible short id of a "v1:<hex>" hash for audit rows — first/last 8 hex
// of the 64-char body. NEVER the full hash. Used so a rotation is traceable in
// audit_logs without persisting the full digest.
export function hashFingerprint(v1hex: string): string {
  const body = v1hex.startsWith("v1:") ? v1hex.slice(3) : v1hex;
  if (body.length < 16) return "invalid";
  return body.slice(0, 8) + ".." + body.slice(-8);
}
