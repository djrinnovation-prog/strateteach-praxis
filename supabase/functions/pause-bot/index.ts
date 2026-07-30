// pause-bot — Phase 2C (Option A) · M4 / INV-8. Pauses ONE bot (trading_enabled=false, status='paused' —
// identical effect to user_pause_own_bot). PAUSE-ONLY: it can never arm or trade, so its blast radius is a
// single-bot halt (safe direction). Two independent auth modes:
//   (a) a signed SINGLE-USE pause_bot ticket (StrateTeach-minted; carries praxis_user_id + praxis_bot_id) —
//       ownership enforced by `.eq("user_id", praxis_user_id)` (INV-9).
//   (b) the long-lived per-bot KILL token the user holds (issued once at create-bot). Ownership is proven by
//       the token hashing to the bot's stored pause_token_hash — so the user can stop the bot even if
//       StrateTeach is DOWN (INV-8: the kill path does not depend on StrateTeach liveness).
// verify_jwt=false.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";
import { computeWebhookHash } from "../_shared/webhook-hash.ts";

const PEPPER = Deno.env.get("WEBHOOK_SECRET_PEPPER") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("CONNECT_ALLOWED_ORIGIN") ?? "*";
const sb = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

const cors = () => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors() } });

// Constant-time compare of two equal-length hex strings (avoid a timing side-channel on the hash).
function ctEq(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  if (!PEPPER) return json(503, { ok: false, error: "config" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const ticket = body?.ticket, pause_token = body?.pause_token, bot_id = body?.bot_id;

  let ownerUid: string | null = null;   // set on the ticket path → adds the ownership predicate
  let targetBot: string | null = null;

  if (typeof ticket === "string" && ticket) {
    // (a) Ticket path — verify + single-use claim (state-changing action ⇒ single-use).
    const material = await deriveProvisionKeyMaterial(PEPPER);
    const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "pause_bot");
    if (!t || !t.praxis_bot_id) return json(401, { ok: false, error: "invalid_or_expired_ticket" });
    const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
    if (jerr) return json(409, { ok: false, error: "ticket_already_used" });
    ownerUid = t.praxis_user_id;
    targetBot = t.praxis_bot_id;
  } else if (typeof pause_token === "string" && pause_token && typeof bot_id === "string" && bot_id) {
    // (b) Long-lived kill-token path — holder-proof ownership; NO StrateTeach involvement (INV-8).
    const h = await computeWebhookHash(PEPPER, pause_token);
    const { data: b } = await sb.from("bots").select("pause_token_hash").eq("id", bot_id).maybeSingle();
    if (!b || typeof b.pause_token_hash !== "string" || !ctEq(b.pause_token_hash, h)) {
      return json(401, { ok: false, error: "invalid_pause_token" });
    }
    targetBot = bot_id;
  } else {
    return json(400, { ok: false, error: "missing_auth" });
  }

  // Perform the pause. On the ticket path, enforce ownership (INV-9); on the token path, the token WAS the
  // ownership proof for this exact bot. Assert exactly one row changed.
  let q = sb.from("bots").update({ trading_enabled: false, status: "paused" }).eq("id", targetBot);
  if (ownerUid) q = q.eq("user_id", ownerUid);
  const { data: updated, error } = await q.select("id");
  if (error || !Array.isArray(updated) || updated.length !== 1) {
    return json(404, { ok: false, error: "bot_not_paused" });
  }
  return json(200, { ok: true, bot_id: targetBot, status: "paused", trading_enabled: false });
});
