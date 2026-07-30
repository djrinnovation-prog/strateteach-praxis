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
