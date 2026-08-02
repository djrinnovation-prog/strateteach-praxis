// validate-credential — Phase 2C (Option A) · M8. Requests a READ-ONLY proof that a connected
// exchange key authenticates, WITHOUT placing any order. This is the gate arm-bot depends on
// (arm-bot refuses a credential whose status !== 'valid').
//
// The Edge function itself performs NO exchange call — the single egress point is the worker
// (static outbound IPs / proxy live there, not here). It only: verifies the ticket, burns the jti,
// re-checks ownership, fences mainnet, and ENQUEUES a request onto the dedicated
// `credential_validations` pgmq queue (isolated from the frozen trade_signals contract). The worker's
// credentialValidation loop drains it, calls fetchBalance, and flips the credential valid/invalid.
//
// Gated, fail-closed:
//   - signed single-use validate_credential ticket (praxis_user_id + praxis_bot_id), ownership `.eq`.
//   - the bot must own a credential; MAINNET is refused here (defense-in-depth — connect-credential
//     already rejects mainnet; validation stays fenced until the mainnet approval gate exists).
//   - PRAXIS_PROVISION_ENABLED kill-switch (503) — same master switch as the rest of provisioning.
// verify_jwt=false (the ticket is the authority).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";
import { mainnetAllowed } from "../_shared/mainnet-gate.ts";

const PEPPER = Deno.env.get("WEBHOOK_SECRET_PEPPER") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("CONNECT_ALLOWED_ORIGIN") ?? "*";
const PROVISION_ENABLED = Deno.env.get("PRAXIS_PROVISION_ENABLED") === "true";
const QUEUE = "credential_validations";
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
  // Master kill-switch — if provisioning is disabled, the whole bridge is dark.
  if (!PROVISION_ENABLED) return json(503, { ok: false, error: "provisioning_disabled" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const ticket = body?.ticket;
  if (typeof ticket !== "string") return json(400, { ok: false, error: "missing_ticket" });

  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "validate_credential");
  if (!t || !t.praxis_bot_id) return json(401, { ok: false, error: "invalid_or_expired_ticket" });

  // Single-use — burn the jti BEFORE any side effect (mirrors arm-bot / pause-bot).
  const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
  if (jerr) return json(409, { ok: false, error: "ticket_already_used" });

  // Load the bot (owned by the ticket's user) + its credential's env.
  const { data: bot } = await sb.from("bots")
    .select("id, credential_id").eq("id", t.praxis_bot_id).eq("user_id", t.praxis_user_id).maybeSingle();
  if (!bot) return json(404, { ok: false, error: "bot_not_found_or_not_owned" });
  if (!bot.credential_id) return json(409, { ok: false, error: "no_credential" });

  // Ownership-scoped credential lookup (defense-in-depth): the worker re-checks ownership, but scoping
  // here too keeps the trust boundary self-defending and symmetric with bot-status.
  const { data: cred } = await sb.from("user_exchange_credentials")
    .select("status, exchange_environment").eq("id", bot.credential_id).eq("user_id", t.praxis_user_id).maybeSingle();
  if (!cred) return json(409, { ok: false, error: "no_credential" });
  // Mainnet double-gate (Plan v1.1 · 1.2): rejected UNLESS the global master-switch is on AND this user has an
  // active operator approval. Default (switch off / no approval) ⇒ rejected, identical to pre-1.2.
  if (cred.exchange_environment === "mainnet" && !(await mainnetAllowed(sb, t.praxis_user_id))) {
    return json(403, { ok: false, error: "mainnet_not_enabled" });
  }

  // Enqueue the validate request. A non-secret request_id correlates the UI click ↔ worker outcome
  // in logs. The worker (single egress point) performs the actual read-only fetchBalance.
  const requestId = crypto.randomUUID();
  const { error: qerr } = await sb.rpc("pgmq_send", {
    queue_name: QUEUE,
    message: {
      schema_version: "1.0",
      kind: "validate_credential",
      bot_id: bot.id,
      credential_id: bot.credential_id,
      request_id: requestId,
    },
  });
  if (qerr) return json(503, { ok: false, error: "enqueue_failed" });

  // 202 Accepted — validation is asynchronous; the client polls bot-status for the credential status
  // to transition pending_validation → valid | invalid.
  return json(202, { ok: true, queued: true, request_id: requestId });
});
