// rotate-bot-webhook-token — OWNER-gated webhook token rotation (UI-first, G-TVR).
//
// Contrast with admin-rotate-webhook-token (operator-only + Doppler attestation + dry_run/commit):
// this is a SINGLE call gated to the BOT OWNER (bots.user_id == auth.uid()), for the in-product
// TradingView connection UI. The CLIENT generates the plaintext token and sends it; the server stores
// ONLY the HMAC hash (reusing _shared/webhook-hash.ts) and returns a FINGERPRINT ONLY — never the
// plaintext, never the full hash. Every rotation is audited (fingerprints only). No secret is logged.
//
// Pure + dependency-injected (no Deno/env/IO here) so it is unit-testable and identical in tests.
import { computeWebhookHash, hashFingerprint, HASH_RE } from "../_shared/webhook-hash.ts";

// Same shape as the webhook token verifier + admin-rotate: URL-safe, >= 32 chars.
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // JWT is in the Authorization header (no cookies) → * is safe
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

export interface AuditRow {
  entity_type: string; entity_id: string; event_type: string;
  actor_type: string; actor_id: string | null;
  before_state: Record<string, unknown>; after_state: Record<string, unknown>;
}

export interface RotateDeps {
  /** Resolve the caller's user id from the Authorization header, or null if unauthenticated. */
  getUid: (authHeader: string | null) => Promise<string | null>;
  /** OWNER-scoped read: the bot's current hash, ONLY if it exists and belongs to uid; else null. */
  getBotForOwner: (botId: string, uid: string) => Promise<{ webhook_secret_hash: string } | null>;
  /** OWNER-scoped compare-and-swap; returns rows affected (1 on success, 0 on CAS miss). */
  casUpdate: (botId: string, uid: string, expectedOldHash: string, newHash: string) => Promise<number>;
  /** Mandatory audit write (throws on failure). */
  audit: (row: AuditRow) => Promise<void>;
  getEnv: (k: string) => string | undefined;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

export async function handleRotate(req: Request, deps: RotateDeps): Promise<Response> {
  // CORS preflight (browser). No auth required for OPTIONS.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  // Auth: enforced IN the function (config verify_jwt=false so the browser preflight is not blocked).
  const uid = await deps.getUid(req.headers.get("Authorization"));
  if (!uid) return json(401, { ok: false, error: "unauthenticated" });

  let body: { bot_id?: unknown; token?: unknown };
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid_json" }); }
  const bot_id = body?.bot_id;
  const token = body?.token;
  if (typeof bot_id !== "string" || !UUID_RE.test(bot_id)) return json(400, { ok: false, error: "invalid_bot_id" });
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return json(400, { ok: false, error: "invalid_token" });

  // OWNER gate: the read is scoped to (bot_id, uid); null ⇒ not owned or not found. Uniform 403 (no leak).
  const bot = await deps.getBotForOwner(bot_id, uid);
  if (!bot) return json(403, { ok: false, error: "forbidden" });
  const old_hash = bot.webhook_secret_hash;
  if (!HASH_RE.test(old_hash)) return json(503, { ok: false, error: "config_error" }); // corrupt stored hash

  let new_hash: string;
  try { new_hash = await computeWebhookHash(deps.getEnv("WEBHOOK_SECRET_PEPPER") ?? "", token); }
  catch { return json(503, { ok: false, error: "config_error" }); } // missing pepper (fail-closed)
  const new_fp = hashFingerprint(new_hash);
  const old_fp = hashFingerprint(old_hash);

  // Compare-and-swap on the current hash (owner-scoped) — no lost-update race.
  const rows = await deps.casUpdate(bot_id, uid, old_hash, new_hash);
  if (rows !== 1) return json(409, { ok: false, error: "conflict", message: "token changed; retry" });

  // Mandatory audit (fingerprints only). CAS already committed → if audit fails, report degraded, not clean.
  try {
    await deps.audit({
      entity_type: "bot", entity_id: bot_id, event_type: "webhook_token.rotated",
      actor_type: "user", actor_id: uid,
      before_state: { old_fp }, after_state: { new_fp, updated_rows: 1 },
    });
  } catch {
    return json(500, { ok: false, error: "rotation_committed_audit_failed", rotation_committed: true, bot_id, new_fp });
  }

  // Success — FINGERPRINT ONLY. Never the plaintext token, never the full hash.
  return json(200, { ok: true, bot_id, new_fp });
}
