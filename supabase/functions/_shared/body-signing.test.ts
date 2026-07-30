import { assert, assertFalse } from "jsr:@std/assert";
import {
  deriveBodyKey,
  deriveBodyKeyMaterial,
  verifyBodySignature,
  timestampFresh,
  DEFAULT_FRESHNESS_WINDOW_MS,
} from "./body-signing.ts";
import { b64urlToBytes } from "./webhook-hash.ts";

// Test/relay-side signer: HMAC-SHA256(keyMaterial, rawBody) → lowercase hex.
async function signHex(material: Uint8Array<ArrayBuffer>, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PEPPER = "dGVzdHBlcHBlcg"; // base64url("testpepper") — fixture, not a secret
const BOT = "11111111-1111-1111-1111-111111111111";

Deno.test("valid signature over the raw body verifies", async () => {
  const raw = JSON.stringify({ signal_id: "s1", action: "buy", timestamp: 1700000000000 });
  const sig = await signHex(await deriveBodyKeyMaterial(PEPPER, BOT), raw);
  assert(await verifyBodySignature(await deriveBodyKey(PEPPER, BOT), raw, sig));
});

Deno.test("tampered body fails verification (signature covers every field)", async () => {
  const raw = JSON.stringify({ signal_id: "s1", action: "buy", timestamp: 1700000000000 });
  const sig = await signHex(await deriveBodyKeyMaterial(PEPPER, BOT), raw);
  const tampered = JSON.stringify({ signal_id: "s1", action: "sell", timestamp: 1700000000000 });
  assertFalse(await verifyBodySignature(await deriveBodyKey(PEPPER, BOT), tampered, sig));
});

Deno.test("malformed / absent hex signature returns false (never throws)", async () => {
  const key = await deriveBodyKey(PEPPER, BOT);
  assertFalse(await verifyBodySignature(key, "x", "not-hex"));
  assertFalse(await verifyBodySignature(key, "x", ""));
  assertFalse(await verifyBodySignature(key, "x", "abcd")); // too short
});

Deno.test("uppercase hex signature is accepted (case-insensitive)", async () => {
  const raw = JSON.stringify({ signal_id: "s1", timestamp: 1700000000000 });
  const sig = await signHex(await deriveBodyKeyMaterial(PEPPER, BOT), raw);
  assert(await verifyBodySignature(await deriveBodyKey(PEPPER, BOT), raw, sig.toUpperCase()));
});

Deno.test("domain separation: a signature made WITHOUT the domain tag does not verify", async () => {
  const raw = JSON.stringify({ signal_id: "s1" });
  // Attacker's guess: HMAC(pepper, botId) with no domain prefix.
  const pepperKey = await crypto.subtle.importKey(
    "raw", b64urlToBytes(PEPPER), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const rogue = new Uint8Array(await crypto.subtle.sign("HMAC", pepperKey, new TextEncoder().encode(BOT)));
  const sig = await signHex(rogue, raw);
  assertFalse(await verifyBodySignature(await deriveBodyKey(PEPPER, BOT), raw, sig));
});

Deno.test("per-bot key: a signature for bot A does not verify for bot B", async () => {
  const raw = JSON.stringify({ signal_id: "s1" });
  const sigA = await signHex(await deriveBodyKeyMaterial(PEPPER, BOT), raw);
  const BOT_B = "22222222-2222-2222-2222-222222222222";
  assertFalse(await verifyBodySignature(await deriveBodyKey(PEPPER, BOT_B), raw, sigA));
});

Deno.test("deriveBodyKeyMaterial fail-closed on missing pepper", async () => {
  let msg = "";
  try {
    await deriveBodyKeyMaterial("", BOT);
  } catch (e) {
    msg = (e as Error).message;
  }
  assert(msg === "config:missing_pepper");
});

Deno.test("timestampFresh: ms / s / ISO within window; stale/future/missing rejected", () => {
  const now = 1_700_000_000_000;
  assert(timestampFresh(now, now)); // epoch ms
  assert(timestampFresh(now - 60_000, now)); // 1 min ago
  assert(timestampFresh(Math.floor(now / 1000), now)); // epoch seconds
  assert(timestampFresh(new Date(now).toISOString(), now)); // ISO-8601
  assertFalse(timestampFresh(now - (DEFAULT_FRESHNESS_WINDOW_MS + 1_000), now)); // stale
  assertFalse(timestampFresh(now + (DEFAULT_FRESHNESS_WINDOW_MS + 1_000), now)); // future
  assertFalse(timestampFresh(undefined, now));
  assertFalse(timestampFresh("not-a-date", now));
  assertFalse(timestampFresh({}, now));
});
