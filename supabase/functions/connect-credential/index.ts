// connect-credential — browser-facing credential intake (Phase 2B · M1, the ideal "key straight to
// Praxis" design). The browser POSTs {ticket, api_key, api_secret} STRAIGHT here — StrateTeach never sees
// the key. The ticket (issued by StrateTeach, which authenticated the user) authorizes creating ONE
// credential for a specific (user, bot, exchange, env). We verify the ticket (signature + freshness +
// SINGLE-USE), store the key in Vault (031), create a pending_validation credential, and link the bot.
// The key is NEVER logged; the response carries only fingerprints. No key migration (no M4) — every key
// is born in Praxis Vault. Validation (EP6: trade-only / withdrawals-off) is a SEPARATE step before use.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";

const PEPPER = Deno.env.get("WEBHOOK_SECRET_PEPPER") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("CONNECT_ALLOWED_ORIGIN") ?? "*"; // set to the exact StrateTeach origin in prod
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
const fp = (id: unknown) => (typeof id === "string" && id.length >= 16 ? id.slice(0, 8) + ".." + id.slice(-8) : "—");

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  if (!PEPPER) return json(503, { ok: false, error: "config" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const ticket = body?.ticket, api_key = body?.api_key, api_secret = body?.api_secret;
  if (typeof ticket !== "string" || typeof api_key !== "string" || typeof api_secret !== "string"
      || !api_key || !api_secret) return json(400, { ok: false, error: "missing_fields" });

  // 1) Verify the ticket (signature + freshness). NEVER trust the request without it.
  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "connect_credential");
  if (!t) return json(401, { ok: false, error: "invalid_or_expired_ticket" });

  // 2) SINGLE-USE: claim the jti. A conflict means the ticket was already used ⇒ reject (replay).
  const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
  if (jerr) return json(409, { ok: false, error: "ticket_already_used" });

  // 3) Resolve the exchange row (fail-closed on an unknown venue).
  const { data: ex } = await sb.from("exchanges").select("id").eq("ccxt_id", t.exchange_ccxt_id).maybeSingle();
  if (!ex) return json(422, { ok: false, error: "unknown_exchange" });

  // 3b) Early target-state check (before any Vault write): the bot must exist, be owned by this user, and
  // have NO credential yet. Gives a clean 404/409 (re-connect an already-connected bot ⇒ 409) and avoids
  // orphaning a Vault secret on a doomed request. The link step below re-checks this race-safely.
  const { data: botRow } = await sb.from("bots")
    .select("credential_id").eq("id", t.praxis_bot_id!).eq("user_id", t.praxis_user_id).maybeSingle();
  if (!botRow) return json(404, { ok: false, error: "bot_not_found_or_not_owned" });
  if (botRow.credential_id !== null) return json(409, { ok: false, error: "bot_already_connected" });

  // 4) Store the key in Vault (031). The value goes to Vault ONLY — never logged, never returned.
  const secretJson = JSON.stringify({ api_key, api_secret });
  const { data: vsid, error: verr } = await sb.rpc("create_vault_secret", {
    secret_value: secretJson,
    secret_name: `${t.exchange_ccxt_id}/${t.praxis_bot_id!.slice(0, 8)}`,
    secret_description: "connected via UI; pending validation (trade-only / withdrawals-off to be verified)",
  });
  if (verr || !vsid) return json(500, { ok: false, error: "vault_store_failed" });

  // Cleanup helper (audit fix): NEVER leave the user's key orphaned in Vault if a later step fails.
  const cleanupVault = async () => { try { await sb.rpc("delete_vault_secret", { secret_id: vsid }); } catch { /* best-effort */ } };

  // 5) Create the credential (pending_validation). On failure, roll the Vault secret back.
  const { data: cred, error: cerr } = await sb.from("user_exchange_credentials").insert({
    user_id: t.praxis_user_id, exchange_id: ex.id, vault_secret_id: vsid,
    status: "pending_validation", exchange_environment: t.env,
    label: "ui-" + t.praxis_bot_id!.slice(0, 8),   // unique per (user, exchange, bot) — the label constraint
  }).select("id").single();
  if (cerr || !cred) { await cleanupVault(); return json(500, { ok: false, error: "credential_create_failed" }); }

  // 6) Link the bot — ONLY if it exists, is owned by this user, AND has no credential yet (target-state
  // guard: never silently repoint an already-configured bot). Assert EXACTLY ONE row changed; a 0-row
  // match (bad bot / not owned / already linked) is a failure, not a silent success — roll everything back.
  const { data: linked, error: lerr } = await sb.from("bots")
    .update({ credential_id: cred.id })
    .eq("id", t.praxis_bot_id!).eq("user_id", t.praxis_user_id).is("credential_id", null)
    .select("id");
  if (lerr || !Array.isArray(linked) || linked.length !== 1) {
    await sb.from("user_exchange_credentials").delete().eq("id", cred.id);   // roll back the credential row
    await cleanupVault();                                                     // and the Vault secret
    return json(409, { ok: false, error: "bot_link_failed" });
  }

  // Never the key — fingerprints + status only.
  return json(201, { ok: true, credential_fingerprint: fp(cred.id), vault_secret_fp: fp(vsid), status: "pending_validation" });
});
