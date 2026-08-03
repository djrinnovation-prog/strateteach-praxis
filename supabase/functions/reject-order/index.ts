// reject-order — 045 per-order approval. The user REJECTS a PENDING proposed order → it is marked 'rejected'
// and NO order is ever placed. Single-use reject_order ticket + ownership `.eq("user_id",…)`. verify_jwt=false.
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
  const ticket = body?.ticket, proposalId = body?.proposal_id;
  if (typeof ticket !== "string") return json(400, { ok: false, error: "missing_ticket" });
  if (typeof proposalId !== "string") return json(400, { ok: false, error: "missing_proposal_id" });

  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "reject_order");
  if (!t) return json(401, { ok: false, error: "invalid_or_expired_ticket" });

  const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
  if (jerr) return json(409, { ok: false, error: "ticket_already_used" });

  const { data: prop, error: upErr } = await sb.from("proposed_trades")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", proposalId).eq("user_id", t.praxis_user_id).eq("status", "pending")
    .select("id").maybeSingle();
  if (upErr) return json(500, { ok: false, error: "reject_failed" });
  if (!prop) return json(409, { ok: false, error: "not_pending_or_not_owned" });

  return json(200, { ok: true, proposal_id: proposalId, status: "rejected" });
});
