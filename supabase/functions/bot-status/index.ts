// bot-status — Phase 2C (Option A) · M4. Returns the caller's OWN bots (NON-secret status only), for the
// StrateTeach dashboard. Authorized by a MULTI-use read_status ticket (StrateTeach-minted, carries the
// session user's praxis_user_id). Reads are idempotent, so this ticket is NOT single-use — the jti is
// never claimed, so repeated status polls don't burn the replay ledger (audit §4.8a). Row scope is the
// hand-written `.eq("user_id", praxis_user_id)` predicate (INV-9; RLS is bypassed by service_role) — this
// predicate is the SOLE cross-user isolation control. It is verified LIVE by the 2-user isolation check
// (supabase/functions/tests/m4-isolation.md); a CI integration test that fails if the filter is dropped is
// a tracked follow-up. No secrets/keys are ever returned (non-secret columns only). verify_jwt=false.
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
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "read_status");
  if (!t) return json(401, { ok: false, error: "invalid_or_expired_ticket" });
  // Multi-use: NO jti claim (reads change no state; single-use would break polling — audit §4.8a).

  // NON-secret status only, scoped to the caller's own rows (INV-9). Never select tokens/hashes/vault ids.
  const { data: bots, error } = await sb.from("bots")
    .select("id, name, trading_pair, account_type, status, trading_enabled, sell_enabled, credential_id, created_at")
    .eq("user_id", t.praxis_user_id)
    .order("created_at", { ascending: false });
  if (error) return json(500, { ok: false, error: "read_failed" });

  // Attach each bot's credential status (non-secret) so the UI can drive the connect → validate → arm
  // flow: pending_validation → valid | invalid. Fetched in ONE query scoped to the SAME user (INV-9;
  // never trust a bot's credential_id to belong to another user), then merged in memory. Never selects
  // vault_secret_id or any secret. A missing/other-user credential surfaces as credential_status=null.
  const credIds = [...new Set((bots ?? []).map(b => b.credential_id).filter((v): v is string => typeof v === "string"))];
  const statusById = new Map<string, string>();
  if (credIds.length > 0) {
    const { data: creds, error: cerr } = await sb.from("user_exchange_credentials")
      .select("id, status")
      .eq("user_id", t.praxis_user_id)
      .in("id", credIds);
    if (cerr) return json(500, { ok: false, error: "read_failed" });
    for (const c of creds ?? []) statusById.set(c.id as string, c.status as string);
  }
  const withCred = (bots ?? []).map(b => ({
    ...b,
    credential_status: b.credential_id ? (statusById.get(b.credential_id) ?? null) : null,
  }));
  return json(200, { ok: true, bots: withCred });
});
