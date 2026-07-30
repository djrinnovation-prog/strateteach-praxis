// Tests for the pure webhook-hash helper (hash + verify parity, shape, fingerprint,
// fail-closed). No network / no env — the pepper is passed in.
import { assert, assertEquals, assertMatch, assertRejects } from "jsr:@std/assert";
import {
  computeWebhookHash,
  hashFingerprint,
  HASH_RE,
  verifyWebhookToken,
} from "./webhook-hash.ts";

// A fixed base64url "pepper" for deterministic tests (NOT a real secret).
const PEPPER = "dGVzdC1wZXBwZXItZm9yLXVuaXQtdGVzdHMtMDEyMzQ1Njc4OQ";
const TOKEN = "abcDEF012_-tokenForUnitTests-0123456789";

Deno.test("computeWebhookHash — shape matches HASH_RE", async () => {
  const h = await computeWebhookHash(PEPPER, TOKEN);
  assertMatch(h, HASH_RE);
});

Deno.test("parity — verify(compute(token)) is true", async () => {
  const h = await computeWebhookHash(PEPPER, TOKEN);
  assertEquals(await verifyWebhookToken(PEPPER, h, TOKEN), true);
});

Deno.test("wrong token — verify is false", async () => {
  const h = await computeWebhookHash(PEPPER, TOKEN);
  assertEquals(await verifyWebhookToken(PEPPER, h, TOKEN + "x"), false);
});

Deno.test("known vector — deterministic + stable", async () => {
  const a = await computeWebhookHash(PEPPER, TOKEN);
  const b = await computeWebhookHash(PEPPER, TOKEN);
  assertEquals(a, b); // deterministic
  // Regression anchor (computed once from this fixed PEPPER+TOKEN):
  assertEquals(
    a,
    "v1:6d47be7bfbecb5b145cc1df1c15b6005bb48e3dfbd872b43d66bdcc564b09246",
  );
});

Deno.test("hashFingerprint — first/last 8 of body, never the full hash", async () => {
  const h = await computeWebhookHash(PEPPER, TOKEN);
  const fp = hashFingerprint(h);
  const body = h.slice(3);
  assertEquals(fp, body.slice(0, 8) + ".." + body.slice(-8));
  assert(!fp.includes(body)); // fingerprint must not contain the full hex body
  assert(fp.length < h.length);
});

Deno.test("fail-closed — missing pepper / bad stored hash throw config:*", async () => {
  await assertRejects(() => computeWebhookHash("", TOKEN), Error, "config:missing_pepper");
  await assertRejects(() => verifyWebhookToken("", "v1:" + "0".repeat(64), TOKEN), Error, "config:missing_pepper");
  await assertRejects(() => verifyWebhookToken(PEPPER, "not-a-valid-hash", TOKEN), Error, "config:bad_stored_hash");
});
