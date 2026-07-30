// rotate-bot-webhook-token handler tests. Runtime-agnostic (node:test).
// Run: node --test supabase/functions/rotate-bot-webhook-token/rotate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRotate, TOKEN_RE, CORS_HEADERS, type RotateDeps, type AuditRow } from "./rotate.ts";

const PEPPER = "dGVzdC1wZXBwZXItZm9yLXVuaXQtdGVzdHMtMDEyMzQ1Njc4OQ"; // non-secret test pepper (base64url)
const OLD_HASH = "v1:" + "a".repeat(64);                             // valid-shaped stored hash
const UUID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "abcdEFGH_-1234567890abcdEFGH_-1234567890";           // matches TOKEN_RE

function deps(over: Partial<RotateDeps> = {}): RotateDeps {
  return {
    getEnv: (k) => (k === "WEBHOOK_SECRET_PEPPER" ? PEPPER : undefined),
    getUid: async () => "user-1",
    getBotForOwner: async () => ({ webhook_secret_hash: OLD_HASH }),
    casUpdate: async () => 1,
    audit: async () => {},
    ...over,
  };
}
function reqPost(body: unknown, auth: string | null = "Bearer valid.jwt"): Request {
  return new Request("https://x/functions/v1/rotate-bot-webhook-token", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}
const bodyOf = async (r: Response) => JSON.parse(await r.text());

test("TOKEN_RE matches the server webhook token shape", () => {
  assert.equal(TOKEN_RE.test(TOKEN), true);
  assert.equal(TOKEN_RE.test("short"), false);
});

test("happy path → 200, fingerprint only, NEVER the plaintext token or full hash", async () => {
  let audited: AuditRow | null = null;
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }), deps({ audit: async (r) => { audited = r; } }));
  assert.equal(res.status, 200);
  const b = await bodyOf(res);
  assert.equal(b.ok, true);
  assert.equal(b.bot_id, UUID);
  assert.match(b.new_fp, /^[0-9a-f]{8}\.\.[0-9a-f]{8}$/);   // fingerprint shape
  // Security: response must not leak the plaintext token or a full hash.
  const raw = JSON.stringify(b);
  assert.equal(raw.includes(TOKEN), false);
  assert.equal("token" in b, false);
  assert.equal("new_hash" in b, false);
  assert.equal("old_hash" in b, false);
  // Audit carries fingerprints only — never the token/full hash.
  assert.ok(audited);
  assert.equal((audited as AuditRow).event_type, "webhook_token.rotated");
  assert.equal((audited as AuditRow).actor_id, "user-1");
  assert.equal(JSON.stringify(audited).includes(TOKEN), false);
  // CORS on the response.
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});

test("OPTIONS preflight → 204 + CORS (no auth needed)", async () => {
  const res = await handleRotate(new Request("https://x", { method: "OPTIONS" }), deps());
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), CORS_HEADERS["Access-Control-Allow-Origin"]);
});

test("unauthenticated → 401", async () => {
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }, null), deps({ getUid: async () => null }));
  assert.equal(res.status, 401);
});

test("invalid bot_id → 400", async () => {
  const res = await handleRotate(reqPost({ bot_id: "not-a-uuid", token: TOKEN }), deps());
  assert.equal(res.status, 400);
  assert.equal((await bodyOf(res)).error, "invalid_bot_id");
});

test("invalid token (fails TOKEN_RE) → 400", async () => {
  const res = await handleRotate(reqPost({ bot_id: UUID, token: "too-short" }), deps());
  assert.equal(res.status, 400);
  assert.equal((await bodyOf(res)).error, "invalid_token");
});

test("NOT owner / not found → 403 (owner gate)", async () => {
  let gotArgs: [string, string] | null = null;
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }), deps({
    getBotForOwner: async (b, u) => { gotArgs = [b, u]; return null; },
  }));
  assert.equal(res.status, 403);
  assert.deepEqual(gotArgs, [UUID, "user-1"]);   // read is scoped to (bot_id, uid) — owner-gated
});

test("CAS conflict (rows=0) → 409, owner-scoped CAS", async () => {
  let cas: unknown[] | null = null;
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }), deps({
    casUpdate: async (b, u, eoh, nh) => { cas = [b, u, eoh, nh]; return 0; },
  }));
  assert.equal(res.status, 409);
  assert.equal((cas as unknown[])[0], UUID);
  assert.equal((cas as unknown[])[1], "user-1");   // CAS threads uid (owner-scoped)
  assert.equal((cas as unknown[])[2], OLD_HASH);   // CAS on the current hash (no lost update)
});

test("audit failure after CAS → 500 rotation_committed_audit_failed (not clean success)", async () => {
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }), deps({
    audit: async () => { throw new Error("audit down"); },
  }));
  assert.equal(res.status, 500);
  const b = await bodyOf(res);
  assert.equal(b.ok, false);
  assert.equal(b.error, "rotation_committed_audit_failed");
  assert.equal(b.rotation_committed, true);
});

test("missing pepper → 503 config_error (fail-closed)", async () => {
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }), deps({ getEnv: () => undefined }));
  assert.equal(res.status, 503);
  assert.equal((await bodyOf(res)).error, "config_error");
});

test("corrupt stored hash → 503 config_error", async () => {
  const res = await handleRotate(reqPost({ bot_id: UUID, token: TOKEN }), deps({
    getBotForOwner: async () => ({ webhook_secret_hash: "not-a-v1-hash" }),
  }));
  assert.equal(res.status, 503);
});
