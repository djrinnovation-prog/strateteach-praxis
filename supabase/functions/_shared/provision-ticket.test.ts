// Deno test for provision-ticket.ts — the connect-credential / create-bot auth bridge.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { deriveProvisionKeyMaterial, signTicket, verifyTicket, type TicketPayload } from "./provision-ticket.ts";

const PEPPER = "dGVzdHBlcHBlcg"; // base64url("testpepper") — fixture, not a secret
const USER = "11111111-1111-1111-1111-111111111111";
const now = () => Math.floor(Date.now() / 1000);

async function mat() { return await deriveProvisionKeyMaterial(PEPPER); }

Deno.test("valid connect_credential ticket verifies + round-trips", async () => {
  const m = await mat();
  const p: TicketPayload = { praxis_user_id: USER, action: "connect_credential", praxis_bot_id: "b1", exchange_ccxt_id: "binance", env: "testnet", jti: "nonce-abcd1234", exp: now() + 120 };
  const v = await verifyTicket(m, await signTicket(m, p), now(), "connect_credential");
  assert(v && v.praxis_bot_id === "b1" && v.env === "testnet");
});

Deno.test("valid create_bot ticket verifies (no bot fields required)", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-create12", exp: now() + 120 });
  assert(await verifyTicket(m, t, now(), "create_bot"));
});

Deno.test("action-bound: a create_bot ticket fails on connect_credential (and vice versa)", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-xact1234", exp: now() + 120 });
  assertEquals(await verifyTicket(m, t, now(), "connect_credential"), null);
});

Deno.test("expired ticket fails", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-exp12345", exp: now() - 5 });
  assertEquals(await verifyTicket(m, t, now(), "create_bot"), null);
});

Deno.test("over-long ticket (exp beyond MAX_TICKET_TTL_S) fails", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-overttl1", exp: now() + 100000 });
  assertEquals(await verifyTicket(m, t, now(), "create_bot"), null);
});

Deno.test("tampered body fails", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-tamper12", exp: now() + 120 });
  const [b, s] = t.split(".");
  assertEquals(await verifyTicket(m, "z" + b + "." + s, now(), "create_bot"), null);
});

Deno.test("wrong key fails", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-wrongky1", exp: now() + 120 });
  const other = await deriveProvisionKeyMaterial("b3RoZXJwZXA");
  assertEquals(await verifyTicket(other, t, now(), "create_bot"), null);
});

Deno.test("connect_credential missing bot fields fails", async () => {
  const m = await mat();
  // action=connect_credential but no praxis_bot_id/exchange/env
  const t = await signTicket(m, { praxis_user_id: USER, action: "connect_credential", jti: "nonce-nobotid1", exp: now() + 120 });
  assertEquals(await verifyTicket(m, t, now(), "connect_credential"), null);
});

Deno.test("garbage fails", async () => {
  const m = await mat();
  assertEquals(await verifyTicket(m, "notaticket", now(), "create_bot"), null);
  assertFalse(!!(await verifyTicket(m, "", now(), "create_bot")));
});

// ── provision_user (M2) ─────────────────────────────────────────────────────────────────────────────
const ST_REF = "abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE"; // 43 chars, base64url shape

Deno.test("valid provision_user ticket verifies (st_ref, NO praxis_user_id required)", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: "", action: "provision_user", st_ref: ST_REF, jti: "nonce-prov1234", exp: now() + 120 });
  const v = await verifyTicket(m, t, now(), "provision_user");
  assert(v && v.action === "provision_user" && v.st_ref === ST_REF);
});

Deno.test("provision_user missing st_ref fails", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: "", action: "provision_user", jti: "nonce-prov-nost", exp: now() + 120 });
  assertEquals(await verifyTicket(m, t, now(), "provision_user"), null);
});

Deno.test("provision_user malformed st_ref (wrong length/charset) fails", async () => {
  const m = await mat();
  for (const bad of ["short", ST_REF + "x", "has space in it 34567890123456789012345", ST_REF.replace("-", "+")]) {
    const t = await signTicket(m, { praxis_user_id: "", action: "provision_user", st_ref: bad, jti: "nonce-prov-bad1", exp: now() + 120 });
    assertEquals(await verifyTicket(m, t, now(), "provision_user"), null);
  }
});

Deno.test("action-bound: a provision_user ticket fails on create_bot / connect_credential", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: "", action: "provision_user", st_ref: ST_REF, jti: "nonce-prov-xact", exp: now() + 120 });
  assertEquals(await verifyTicket(m, t, now(), "create_bot"), null);
  assertEquals(await verifyTicket(m, t, now(), "connect_credential"), null);
});

Deno.test("a create_bot ticket fails on provision_user (no st_ref)", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "create_bot", jti: "nonce-cb-noref1", exp: now() + 120 });
  assertEquals(await verifyTicket(m, t, now(), "provision_user"), null);
});

// ── read_status + pause_bot (M4) ────────────────────────────────────────────────────────────────────
Deno.test("valid read_status ticket verifies (only praxis_user_id)", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "read_status", jti: "nonce-read12345", exp: now() + 120 });
  assert(await verifyTicket(m, t, now(), "read_status"));
});

Deno.test("valid pause_bot ticket verifies (praxis_user_id + praxis_bot_id)", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "pause_bot", praxis_bot_id: "b1", jti: "nonce-pause1234", exp: now() + 120 });
  const v = await verifyTicket(m, t, now(), "pause_bot");
  assert(v && v.praxis_bot_id === "b1");
});

Deno.test("pause_bot missing praxis_bot_id fails", async () => {
  const m = await mat();
  const t = await signTicket(m, { praxis_user_id: USER, action: "pause_bot", jti: "nonce-pause-nob", exp: now() + 120 });
  assertEquals(await verifyTicket(m, t, now(), "pause_bot"), null);
});

Deno.test("action-bound: read_status ↔ pause_bot cross-use fails both ways", async () => {
  const m = await mat();
  const rt = await signTicket(m, { praxis_user_id: USER, action: "read_status", jti: "nonce-rs-xact1", exp: now() + 120 });
  const pt = await signTicket(m, { praxis_user_id: USER, action: "pause_bot", praxis_bot_id: "b1", jti: "nonce-pb-xact1", exp: now() + 120 });
  assertEquals(await verifyTicket(m, rt, now(), "pause_bot"), null);
  assertEquals(await verifyTicket(m, pt, now(), "read_status"), null);
  // and neither is accepted as a create_bot / connect_credential
  assertEquals(await verifyTicket(m, rt, now(), "create_bot"), null);
  assertEquals(await verifyTicket(m, pt, now(), "connect_credential"), null);
});
