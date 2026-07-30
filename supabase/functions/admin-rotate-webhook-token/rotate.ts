// Admin webhook-token rotation — pure request handler with injected I/O (RotateDeps),
// so it is unit-testable without booting a server or touching the network (same
// pattern as _shared/rate-limit.ts). The thin Deno.serve wrapper lives in index.ts.
//
// Security invariants:
//   - valid Supabase JWT + profiles.is_operator=true required; no anon/public.
//   - optional ADMIN_ROTATE_SECRET second factor.
//   - raw token used only in memory (to compute the hash); never logged/returned/stored.
//   - dry_run: compute hash, NO DB write, return full old/new hash to the operator only.
//   - commit: requires doppler attestation + expected_old_hash + dry_run_fingerprint;
//     COMPARE-AND-SWAP update; 0 rows ⇒ 409 conflict, no rotation.
//   - audit stores FINGERPRINTS only — never token/pepper/full hash/full URL.
//   - missing pepper ⇒ fail-closed 503.
import { computeWebhookHash, HASH_RE, hashFingerprint } from "../_shared/webhook-hash.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/; // URL-safe charset, min length 32

export interface RotateDeps {
  getEnv: (k: string) => string | undefined;
  getUid: (authHeader: string | null) => Promise<string | null>;
  isOperator: (uid: string) => Promise<boolean>;
  /** M-1: return the bot's current hash AND owner (user_id) so rotation can be authorized per-bot,
   *  not just "any operator can touch any bot". null ⇒ bot missing/deleted. */
  getBot: (botId: string) => Promise<{ hash: string; userId: string } | null>;
  casUpdate: (botId: string, expectedOldHash: string, newHash: string) => Promise<number>; // rows updated
  audit: (row: Record<string, unknown>) => Promise<void>;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Logs ONLY non-secret fields — never the token, pepper, full hash, body, or URL.
function log(o: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ fn: "admin-rotate-webhook-token", ...o }));
  } catch {
    console.log(JSON.stringify({ fn: "admin-rotate-webhook-token", event: "log_serialize_error" }));
  }
}

/**
 * L-9: constant-time secret comparison that leaks NEITHER the length NOR the bytes of the expected
 * secret. The previous impl short-circuited on `a.length !== b.length` (leaking ADMIN_ROTATE_SECRET's
 * length via timing) and compared UTF-16 code units (not byte-constant-time for multibyte input).
 * Hash both sides to a FIXED 32-byte SHA-256 digest over their UTF-8 bytes first, then compare the
 * digests in constant time — inputs of any length take the same comparison path.
 */
async function constantTimeEqualSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function safeAudit(deps: RotateDeps, row: Record<string, unknown>): Promise<void> {
  try {
    await deps.audit(row);
  } catch {
    /* audit is best-effort; the rotation decision must never throw on an audit failure */
  }
}

export async function handleRotate(req: Request, deps: RotateDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { ok: false });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // Parse body up front (read-only) so a denial can be attributed to the claimed
  // bot_id. NOTHING is acted on before the auth gates below.
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const rawBotId = body.bot_id;
  const entityId = typeof rawBotId === "string" && UUID_RE.test(rawBotId) ? rawBotId : null;

  // Denials: audit_logs.entity_id is NOT NULL, so under the current schema a denial can be
  // AUDITED only when the body carries a valid bot_id:
  //   - valid bot_id          ⇒ audit row (rotate_denied) + secret-free console log
  //   - missing/invalid bot_id ⇒ secret-free console log ONLY (no audit row possible)
  // (A canonical function-level audit entity would let us audit every denial — deferred.)
  const deny = async (reason: string, actorId: string | null): Promise<Response> => {
    if (entityId) {
      await safeAudit(deps, {
        entity_type: "bot",
        entity_id: entityId,
        event_type: "webhook_token.rotate_denied",
        actor_type: "user",
        actor_id: actorId,
        ip_address: ip,
        before_state: {},
        after_state: { reason },
      });
    }
    log({ event: "rotate_denied", reason, has_actor: actorId !== null, has_bot: entityId !== null });
    return json(403, { ok: false });
  };

  // 1. Authn — valid Supabase JWT ⇒ uid (null for anon/invalid).
  const uid = await deps.getUid(req.headers.get("Authorization"));
  if (!uid) return await deny("no_operator_jwt", null);

  // 2. Optional second factor.
  const wantSecret = deps.getEnv("ADMIN_ROTATE_SECRET");
  if (wantSecret) {
    const got = req.headers.get("x-admin-rotate-secret") ?? "";
    if (!(await constantTimeEqualSecret(got, wantSecret))) return await deny("bad_admin_secret", uid);
  }

  // 3. Operator allowlist.
  if (!(await deps.isOperator(uid))) return await deny("not_operator", uid);

  // 4. Pepper — fail-closed.
  const pepper = deps.getEnv("WEBHOOK_SECRET_PEPPER") ?? "";
  if (!pepper) {
    log({ event: "config_error", reason: "missing_pepper" });
    return json(503, { ok: false });
  }

  // 5. Validate inputs.
  const mode = body.mode;
  const token = body.token;
  // I-1: full-hash disclosure is opt-in. Default = fingerprints only (dry_run AND commit responses).
  const reveal = body.reveal === true;
  if (!entityId) return json(400, { ok: false, error: "invalid_bot_id" });
  if (mode !== "dry_run" && mode !== "commit") return json(400, { ok: false, error: "invalid_mode" });
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return json(400, { ok: false, error: "invalid_token" });

  // 6. Resolve current hash + owner, then compute the new hash (token used only here, in memory).
  const botRow = await deps.getBot(entityId);
  if (botRow === null) return json(404, { ok: false, error: "bot_not_found" });
  const old_hash = botRow.hash;

  // M-1: per-bot authorization. Being an operator is necessary but NOT sufficient — an operator must
  // not SILENTLY rotate a token for a bot they do not own (IDOR: it breaks the victim's integration and
  // installs a token the actor knows). If the caller is not the owner, require an explicit
  // `operator_override: true` acknowledgement, and audit it as a distinct cross-owner superadmin action
  // (never silent). Owner-initiated rotations proceed normally.
  const isBotOwner = botRow.userId === uid;
  const operatorOverride = body.operator_override === true;
  if (!isBotOwner && !operatorOverride) {
    return await deny("not_bot_owner", uid);
  }
  if (!isBotOwner && operatorOverride) {
    await safeAudit(deps, {
      entity_type: "bot",
      entity_id: entityId,
      event_type: "webhook_token.rotate_cross_owner",
      actor_type: "user",
      actor_id: uid,
      ip_address: ip,
      before_state: {},
      after_state: { note: "operator rotating a bot they do not own (explicit override)", mode: body.mode ?? null },
    });
    log({ event: "rotate_cross_owner", bot_id: entityId, actor: uid });
  }

  let new_hash: string;
  try {
    new_hash = await computeWebhookHash(pepper, token);
  } catch {
    log({ event: "config_error", reason: "hash_failed" });
    return json(503, { ok: false });
  }
  const new_fp = hashFingerprint(new_hash);
  const old_fp = hashFingerprint(old_hash);

  // 7. dry_run — validate + return, NO DB write.
  if (mode === "dry_run") {
    // I-1: full stored/new hashes are disclosed ONLY when the caller explicitly asks (`reveal: true`).
    // Default is FINGERPRINTS ONLY, so a routine dry_run (or a mis-scoped log / compromised session)
    // cannot harvest a bot's full stored hash. When revealed, the disclosure is recorded in the audit.
    await safeAudit(deps, {
      entity_type: "bot",
      entity_id: entityId,
      event_type: "webhook_token.rotate_dryrun",
      actor_type: "user",
      actor_id: uid,
      ip_address: ip,
      before_state: { old_fp },
      after_state: { new_fp, shape_ok: true, updated_rows: 0, revealed: reveal },
    });
    log({ event: "rotate_dryrun", bot_id: entityId, actor: uid, old_fp, new_fp, revealed: reveal });
    // Full hashes (rollback anchor / CAS expected_old_hash) only on explicit reveal, operator over TLS.
    const base: Record<string, unknown> = { ok: true, bot_id: entityId, mode, old_fp, new_fp, shape_ok: true, updated_rows: 0 };
    if (reveal) {
      base.old_hash = old_hash;
      base.new_hash = new_hash;
    }
    return json(200, base);
  }

  // 8. commit — attestation + dry_run binding + compare-and-swap.
  const expected_old_hash = body.expected_old_hash;
  const dry_run_fingerprint = body.dry_run_fingerprint;
  const doppler_updated_confirmed = body.doppler_updated_confirmed;
  const doppler_secret_name = body.doppler_secret_name;

  if (doppler_updated_confirmed !== true || typeof doppler_secret_name !== "string" || doppler_secret_name.length === 0) {
    return json(400, { ok: false, error: "missing_doppler_attestation" });
  }
  if (typeof expected_old_hash !== "string" || !HASH_RE.test(expected_old_hash)) {
    return json(400, { ok: false, error: "invalid_expected_old_hash" });
  }
  if (typeof dry_run_fingerprint !== "string") {
    return json(400, { ok: false, error: "invalid_dry_run_fingerprint" });
  }

  // Bind commit to the dry_run: same token ⇒ same new_fp.
  if (dry_run_fingerprint !== new_fp) {
    await safeAudit(deps, {
      entity_type: "bot",
      entity_id: entityId,
      event_type: "webhook_token.rotate_conflict",
      actor_type: "user",
      actor_id: uid,
      ip_address: ip,
      before_state: {},
      after_state: { reason: "dry_run_fingerprint_mismatch", new_fp, doppler_secret_name },
    });
    log({ event: "rotate_conflict", reason: "dry_run_fingerprint_mismatch", bot_id: entityId, actor: uid });
    return json(409, { ok: false, conflict: true, error: "dry_run_fingerprint_mismatch", message: "re-run dry_run" });
  }

  const rows = await deps.casUpdate(entityId, expected_old_hash, new_hash);
  if (rows === 1) {
    // The successful-rotation audit is NOT best-effort: the CAS has already mutated
    // bots.webhook_secret_hash, so if the audit write fails we must NOT report a clean
    // rotation. (Option B — no migration in this slice; a single transactional CAS+audit
    // RPC is the preferred future hardening.)
    try {
      await deps.audit({
        entity_type: "bot",
        entity_id: entityId,
        event_type: "webhook_token.rotated",
        actor_type: "user",
        actor_id: uid,
        ip_address: ip,
        before_state: { old_fp },
        after_state: { new_fp, shape_ok: true, updated_rows: 1, doppler_secret_name, doppler_updated_confirmed: true },
      });
    } catch {
      // Rotation IS committed but the audit row failed ⇒ degraded, manual reconciliation
      // required. Log a non-secret critical marker; do NOT return normal success.
      log({ event: "rotation_committed_audit_failed", bot_id: entityId, actor: uid, old_fp, new_fp });
      return json(500, {
        ok: false,
        error: "rotation_committed_audit_failed",
        rotation_committed: true,
        bot_id: entityId,
        new_fp,
        message: "rotation committed but audit write failed — manual reconciliation required",
      });
    }
    log({ event: "rotated", bot_id: entityId, actor: uid, old_fp, new_fp, doppler_secret_name });
    // I-1: fingerprints by default; full hashes only on explicit reveal.
    const done: Record<string, unknown> = { ok: true, bot_id: entityId, mode, old_fp, new_fp, shape_ok: true, updated_rows: 1 };
    if (reveal) {
      done.old_hash = old_hash;
      done.new_hash = new_hash;
    }
    return json(200, done);
  }

  // 0 rows ⇒ stored hash != expected_old_hash ⇒ CAS conflict, NO rotation claim.
  const expected_old_fp = hashFingerprint(expected_old_hash);
  await safeAudit(deps, {
    entity_type: "bot",
    entity_id: entityId,
    event_type: "webhook_token.rotate_conflict",
    actor_type: "user",
    actor_id: uid,
    ip_address: ip,
    before_state: { expected_old_fp },
    after_state: { reason: "cas_stale", new_fp, doppler_secret_name },
  });
  log({ event: "rotate_conflict", reason: "cas_stale", bot_id: entityId, actor: uid });
  return json(409, { ok: false, conflict: true, error: "stale_expected_old_hash", message: "stored hash changed; re-run dry_run" });
}
