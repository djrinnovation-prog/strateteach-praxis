// list-proposals — 045 per-order approval. Returns THIS user's PENDING proposed orders (ownership-scoped) so
// the UI can render an Approve/Reject list. Non-secret fields only — never a key or vault pointer. MULTI-use
// read_proposals ticket (like read_status; NO jti burn, so the UI can poll). verify_jwt=false.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  if (!PEPPER) return json(503, { ok: false, error: "config" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const ticket = body?.ticket;
  if (typeof ticket !== "string") return json(400, { ok: false, error: "missing_ticket" });

  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "read_proposals");
  if (!t) return json(401, { ok: false, error: "invalid_or_expired_ticket" });
  // MULTI-use read token → no jti burn (the UI polls). Ownership is enforced by the .eq("user_id",…) below.

  const { data, error } = await sb.from("proposed_trades")
    .select("id, bot_id, signal_id, side, trading_pair, requested_notional_usdt, price_at_signal, expires_at, created_at")
    .eq("user_id", t.praxis_user_id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return json(500, { ok: false, error: "list_failed" });

  return json(200, { ok: true, proposals: data ?? [] });
});
