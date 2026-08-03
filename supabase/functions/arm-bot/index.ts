// arm-bot — Phase 2C (Option A) · M8. Flips a bot to LIVE (trading_enabled=true, status='active') — the
// ONLY arming path (027 removed the owner-UPDATE path; under Option A the browser has no JWT). Gated,
// fail-closed:
//   - signed single-use arm_bot ticket (praxis_user_id + praxis_bot_id), ownership `.eq("user_id",…)`.
//   - the bot's credential MUST be status='valid' (EP6 validate-credential ran) — never arm an unvalidated
//     or 'invalid' key.
//   - operator_locked bots are refused (respects the operator kill-lock; service_role bypasses RLS so we
//     check it explicitly).
//   - MAINNET is refused here until the S3 approval gate exists (mainnet_provision_approvals) — fail-closed.
// verify_jwt=false (the ticket is the authority).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";
import { mainnetAllowed } from "../_shared/mainnet-gate.ts";

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
  // execution_mode (045): 'simulation' (default) arms the bot to run signals as SIMULATED fills — no real
  // order ever reaches the exchange. 'live' is the deliberate go-live: each signal is PROPOSED and the user
  // must approve it before the (unchanged) Praxis money-path executes. The money-path, per-order/daily caps,
  // and the mainnet double-gate below are identical in both modes; mode only selects sim-fill vs propose.
  const rawMode = typeof body?.mode === "string" ? body.mode : "simulation";
  if (rawMode !== "simulation" && rawMode !== "live") return json(400, { ok: false, error: "bad_mode" });
  const execution_mode = rawMode;

  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "arm_bot");
  if (!t || !t.praxis_bot_id) return json(401, { ok: false, error: "invalid_or_expired_ticket" });

  const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
  if (jerr) return json(409, { ok: false, error: "ticket_already_used" });

  // Load the bot (owned by the ticket's user) + its credential.
  const { data: bot } = await sb.from("bots")
    .select("id, credential_id, operator_locked").eq("id", t.praxis_bot_id).eq("user_id", t.praxis_user_id).maybeSingle();
  if (!bot) return json(404, { ok: false, error: "bot_not_found_or_not_owned" });
  if (bot.operator_locked === true) return json(403, { ok: false, error: "operator_locked" });
  if (!bot.credential_id) return json(409, { ok: false, error: "no_credential" });

  const { data: cred } = await sb.from("user_exchange_credentials")
    .select("status, exchange_environment").eq("id", bot.credential_id).eq("user_id", t.praxis_user_id).maybeSingle();
  if (!cred) return json(409, { ok: false, error: "no_credential" });
  if (cred.status !== "valid") return json(409, { ok: false, error: "credential_not_valid" }); // EP6 must pass first
  // Mainnet double-gate (Plan v1.1 · 1.2): arming a mainnet bot is rejected UNLESS the global master-switch is
  // on AND this user has an active operator approval. Default (switch off / no approval) ⇒ rejected, identical
  // to pre-1.2. (The worker independently re-checks the master-switch on every mainnet order.)
  if (cred.exchange_environment === "mainnet" && !(await mainnetAllowed(sb, t.praxis_user_id))) {
    return json(403, { ok: false, error: "mainnet_not_enabled" });
  }

  // Arm. Ownership re-checked in the predicate; assert exactly one row. (operator_locked was checked above;
  // a concurrent lock is covered by the independent operator kill, the authoritative control.)
  const { data: armed, error } = await sb.from("bots")
    .update({ trading_enabled: true, status: "active", execution_mode })
    .eq("id", t.praxis_bot_id).eq("user_id", t.praxis_user_id).select("id");
  if (error || !Array.isArray(armed) || armed.length !== 1) return json(409, { ok: false, error: "arm_failed" });
  return json(200, { ok: true, bot_id: t.praxis_bot_id, trading_enabled: true, status: "active", execution_mode });
});
