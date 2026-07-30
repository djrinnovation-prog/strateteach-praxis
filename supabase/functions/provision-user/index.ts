// provision-user — Phase 2C (Option A) · M2. Idempotently maps a StrateTeach identity (an opaque, keyed
// `st_ref` = HMAC of the user's IMMUTABLE user_uid) to exactly ONE Praxis auth.users record ("shadow user").
// StrateTeach mints a signed, single-use, action-bound `provision_user` ticket; the browser (or StrateTeach)
// POSTs it here; Praxis (service_role) creates/returns the mapped praxis_user_id. StrateTeach never holds
// service_role or a Praxis key — the ticket is the auth. verify_jwt=false (the ticket is the authority).
//
// Idempotency rests on the DETERMINISTIC synthetic email (auth.users email-unique) + the st_ref PK — NOT on
// the returned uuid (fresh per createUser). A crash after createUser but before the link insert self-heals
// via reconcile-by-email. A `disabled` link (set by a future deprovision) is fail-closed (403), never
// silently re-linked. Every outcome writes a non-secret provisioning_audit row.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";
import { b64urlToBytes } from "../_shared/webhook-hash.ts";

const PEPPER = Deno.env.get("WEBHOOK_SECRET_PEPPER") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("CONNECT_ALLOWED_ORIGIN") ?? "*";
// Synthetic-identity email domain. MUST be a domain you control / that never receives mail (no password
// grant / reset can reach it). Configurable so prod can pin an owned, unroutable domain.
const NOLOGIN_DOMAIN = Deno.env.get("PRAXIS_NOLOGIN_EMAIL_DOMAIN") ?? "nologin.praxis.local";

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
const bytesToHex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

// Deterministic, CASE-INSENSITIVE synthetic email from st_ref (hex of the 32 raw bytes — never base64url,
// which auth providers may case-fold and collapse). Lowercased end-to-end: GoTrue stores email lowercased,
// and the reconcile RPC matches with lower(), so an uppercase NOLOGIN_DOMAIN override cannot wedge lookups.
function emailForStRef(stRef: string): string {
  return ("st-" + bytesToHex(b64urlToBytes(stRef)) + "@" + NOLOGIN_DOMAIN).toLowerCase();
}
function randomPassword(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return "P" + bytesToHex(b); // unknowable; the shadow user never logs in interactively
}

async function audit(event: string, praxis_user_id: string | null, meta: Record<string, unknown>) {
  try { await sb.from("provisioning_audit").insert({ event, praxis_user_id, actor: "provision-user", meta }); }
  catch { /* audit is best-effort; never block the operation on it */ }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  if (!PEPPER) return json(503, { ok: false, error: "config" });
  // Kill-switch: identity provisioning is DORMANT unless explicitly armed. Fail-closed (the design/roadmap
  // treat this as the default-off arming flag; without it the endpoint would be live the moment it deploys).
  if (Deno.env.get("PRAXIS_PROVISION_ENABLED") !== "true") return json(503, { ok: false, error: "disabled" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const ticket = body?.ticket;
  if (typeof ticket !== "string") return json(400, { ok: false, error: "missing_ticket" });

  // 1) Verify: signature + freshness + action-bound to provision_user + strict st_ref format.
  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "provision_user");
  if (!t || !t.st_ref) return json(401, { ok: false, error: "invalid_or_expired_ticket" });
  const stRef = t.st_ref;

  // 2) SINGLE-USE: claim the jti (replay protection). A conflict ⇒ already used.
  const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
  if (jerr) return json(409, { ok: false, error: "ticket_already_used" });

  // 3) Already linked? Return the existing identity — but a DISABLED link is fail-closed (never re-link).
  const { data: existing } = await sb.from("strateteach_user_link")
    .select("praxis_user_id, status").eq("st_ref", stRef).maybeSingle();
  if (existing) {
    if (existing.status === "disabled") {
      await audit("provision_denied_disabled", existing.praxis_user_id, { st_ref_fp: fp(stRef) });
      return json(403, { ok: false, error: "identity_disabled" });
    }
    return json(200, { ok: true, praxis_user_id: existing.praxis_user_id, status: "already_linked" });
  }

  // 4) Create the shadow auth user with the DETERMINISTIC email. On a duplicate-email (a prior crash after
  // createUser but before the link insert), reconcile: look the user up by that email.
  const email = emailForStRef(stRef);
  let praxisUserId: string | null = null;
  const { data: created, error: cerr } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomPassword(),
    user_metadata: { source: "strateteach", st_ref: stRef },
  });
  if (created?.user?.id) {
    praxisUserId = created.user.id;
  } else {
    // Reconcile-by-email (self-heal the crash window). The RPC adopts a row ONLY if it is a genuine shadow
    // user for THIS st_ref (source='strateteach' AND st_ref match) — so a colliding/pre-seeded non-shadow
    // signup on the synthetic email can never be adopted as the identity. Any non-match ⇒ fail closed.
    const { data: uid } = await sb.rpc("auth_uid_by_email", { p_email: email, p_st_ref: stRef });
    if (typeof uid === "string" && uid) praxisUserId = uid;
    else return json(500, { ok: false, error: "provision_create_failed", detail: cerr?.message ?? "unknown" });
  }

  // 5) Insert the link idempotently. ON CONFLICT (st_ref) DO NOTHING then re-select, so two concurrent calls
  // converge on ONE identity (the loser reads the winner's row) with no spurious 500.
  const { error: lerr } = await sb.from("strateteach_user_link")
    .upsert({ st_ref: stRef, praxis_user_id: praxisUserId }, { onConflict: "st_ref", ignoreDuplicates: true });
  if (lerr) { /* fall through to the re-select — the row may already exist from a concurrent call */ }
  const { data: linked } = await sb.from("strateteach_user_link")
    .select("praxis_user_id, status").eq("st_ref", stRef).maybeSingle();
  if (!linked) return json(500, { ok: false, error: "provision_link_failed" });
  if (linked.status === "disabled") return json(403, { ok: false, error: "identity_disabled" });

  await audit("provision", linked.praxis_user_id, { st_ref_fp: fp(stRef), created: !!created?.user?.id });
  return json(201, { ok: true, praxis_user_id: linked.praxis_user_id, status: "linked" });
});
