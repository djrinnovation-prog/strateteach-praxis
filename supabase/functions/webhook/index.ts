// ============================================================================
// WB5 — Webhook Ingestion Edge Function  (Sprint 3, ratified 2026-06-04)
//
// POST /functions/v1/webhook/{bot_id}/{secret}
//
//   parse path → bot lookup → HMAC-pepper auth → active gate → parse body
//   → read+validate signal_id/action → webhook_logs upsert (dedup anchor)
//   → dup? audit_logs dedup-skip : pgmq_send → hybrid 200/5xx
//
// Response policy (Architecture "Webhook Rejection Policy" + hybrid 200/5xx):
//   • 200 for ALL authenticated/business outcomes (incl. reject, dedup) —
//     never 401/403/404 (no structure leak to attackers).
//   • 5xx ONLY for genuine infra failure BEFORE the webhook_logs insert, so
//     TradingView's retry recovers a transient DB blip (a retry after the row
//     exists is correctly deduped). 503 chosen (TradingView retries 5xx≠504).
//
// Auth encoding (locked, must match the seed compute):
//   key  = base64url-decode(WEBHOOK_SECRET_PEPPER)         (raw bytes)
//   msg  = UTF-8 bytes of the {secret} path segment (token, NOT decoded)
//   hash = "v1:" + lowercase hex( HMAC-SHA256(key, msg) )  → stored in DB
//   verify constant-time via crypto.subtle.verify.
//
// Fixes ratified during review:
//   Fix 1 — missing/empty pepper ⇒ webhook_config_error + 503 (never invalid_secret)
//   Fix 2 — dedup audit after_state carries the full discriminator tuple
//   Fix 3 — HASH_RE guard: malformed stored hash ⇒ webhook_config_error + 503
//
// Invariants: never log the token, the full URL, the pepper, or the stored
// hash. signal_id is source-supplied (reject-if-absent, no UUID fallback).
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  rateConfig, windowStartIso, ipKey, botKey, enforceRateLimit, shouldRunIpGate, shouldRunBotGate,
  clientIpFromHeaders,
} from "../_shared/rate-limit.ts";
import { verifyWebhookToken } from "../_shared/webhook-hash.ts";
import { deriveBodyKey, verifyBodySignature, timestampFresh } from "../_shared/body-signing.ts";
import { decideDuplicateAction, sideFromAction, type WebhookLogStatus } from "../_shared/queue-recovery.ts";

// --- constants --------------------------------------------------------------
const QUEUE_NAME = "trade_signals";
const SCHEMA_VERSION = "1.0";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pepper is read once at module load. Empty ⇒ every request fails loud (503).
const PEPPER_B64URL = Deno.env.get("WEBHOOK_SECRET_PEPPER") ?? "";

const sb = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// --- H1 rate limit I/O (A5-1) — service_role rpc bump + best-effort audit ---
async function rateBump(key: string, windowIso: string): Promise<number> {
  const { data, error } = await sb.rpc("webhook_rate_bump", { p_key: key, p_window: windowIso });
  if (error) throw new Error("rate_store_error");
  return (data as number) ?? 0;
}
async function rateAudit(
  bot_id: string, source_ip: string | null, event: string, after: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("audit_logs").insert({
      entity_type: "webhook_log", entity_id: bot_id, event_type: event, after_state: after, ip_address: source_ip,
    });
  } catch { /* audit best-effort; a rate check must never throw */ }
}

// --- helpers ----------------------------------------------------------------
function log(o: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ fn: "webhook", ...o }));
  } catch {
    console.log(JSON.stringify({ fn: "webhook", event: "log_serialize_error" }));
  }
}

// 200 for every authenticated/business outcome. Uniform body — no structure leak.
function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// 503 for genuine infra failure BEFORE the webhook_logs insert (TradingView retries).
function infra(): Response {
  return new Response(JSON.stringify({ ok: false }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

// Token hashing/verification lives in ../_shared/webhook-hash.ts (single source
// of truth shared with the admin rotation hasher, so the two can never drift).

// Slice 4C — enqueue the signal EVENT and record the DURABLE outcome on webhook_logs.
// Returns true iff the message is confirmed in the queue ('queued'); false ⇒ 'queue_failed' (recoverable
// by the worker sweeper). The row is already committed, so a failure NEVER loses the signal — it only
// changes the HTTP status (503 = defense-in-depth fast-retry hint; the sweeper is the real guarantee).
async function enqueueAndMark(
  bot_id: string, signal_id: string, side: "buy" | "sell",
): Promise<boolean> {
  const { error: sendErr } = await sb.rpc("pgmq_send", {
    queue_name: QUEUE_NAME,
    message: { schema_version: SCHEMA_VERSION, bot_id, signal_id, side },
  });
  if (sendErr) {
    // Mark queue_failed + eligible-now for the sweeper (next_retry_at=now()). Attempt counting/backoff is
    // owned by the sweeper's claim RPC — the webhook only keeps the row recoverable.
    await sb.from("webhook_logs")
      .update({ status: "queue_failed", rejection_reason: "pgmq_send_failed", next_retry_at: new Date().toISOString() })
      .eq("bot_id", bot_id).eq("signal_id", signal_id);
    log({ event: "webhook_queue_failed", bot_id, signal_id });
    return false;
  }
  // CAS on status so a concurrent transition (sweeper / other delivery) is never clobbered.
  await sb.from("webhook_logs")
    .update({ status: "queued" })
    .eq("bot_id", bot_id).eq("signal_id", signal_id)
    .in("status", ["accepted", "queue_failed"]);
  log({ event: "webhook_queued", bot_id, signal_id, side });
  return true;
}

// --- handler ----------------------------------------------------------------
Deno.serve(async (req: Request): Promise<Response> => {
  // Fix 1 — fail loud as a config problem; must NOT look like a bad token.
  if (!PEPPER_B64URL) {
    log({ event: "webhook_config_error", reason: "missing_pepper" });
    return infra();
  }

  if (req.method !== "POST") {
    log({ event: "webhook_reject", reason: "method_not_post" });
    return ok();
  }

  // 1. Parse path — works for "/webhook/{id}/{secret}" and the
  //    "/functions/v1/webhook/{id}/{secret}" form.
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const wi = parts.indexOf("webhook");
  const bot_id = wi >= 0 ? parts[wi + 1] : undefined;
  const secret = wi >= 0 ? parts[wi + 2] : undefined;

  if (!bot_id || !secret || !UUID_RE.test(bot_id)) {
    log({ event: "webhook_reject", reason: "bad_request" });
    return ok();
  }

  // H-4: derive the client IP from a TRUSTED source (never the client-controlled left-most XFF token),
  // so a per-request spoofed IP can no longer mint a fresh rate-limit bucket and bypass the pre-auth gate.
  const source_ip = clientIpFromHeaders((name) => req.headers.get(name));

  // --- H1 rate limit (A5-1). Flag OFF ⇒ this whole block is skipped ⇒ behavior unchanged. ---
  const rateCfg = rateConfig((k) => Deno.env.get(k));
  const rateWin = windowStartIso(Date.now());
  const rateDeps = {
    bump: rateBump,
    audit: (ev: string, after: Record<string, unknown>) => rateAudit(bot_id, source_ip, ev, after),
    log,
  };

  // H1a — per-IP, PRE-auth. Key = IP only, so a wrong-token flood can NEVER touch a bot's budget.
  if (shouldRunIpGate(rateCfg)) {
    const action = await enforceRateLimit(rateDeps, {
      dimension: "ip", key: ipKey(source_ip, rateWin), windowIso: rateWin,
      limit: rateCfg.ipPerMin, tier: rateCfg.tier, failOverride: rateCfg.failOverride,
    });
    if (action === "reject") return ok();   // uniform 200, NO enqueue
  }

  // 2. Bot lookup. A DB error here is infra (pre-row) ⇒ 503. The signing flag column (migration
  //    036, T4) may be ABSENT if this function is deployed before 036 is linked-applied — in that
  //    case degrade to signing-OFF (dormant, byte-for-byte legacy behavior) rather than 503-ing
  //    EVERY webhook (signed or not). Any OTHER db error is genuine infra.
  let { data: bot, error: botErr } = await sb
    .from("bots")
    .select("webhook_secret_hash, status, webhook_body_signing_required")
    .eq("id", bot_id)
    .maybeSingle();

  if (botErr && botErr.code === "42703") {
    // undefined_column ⇒ 036 not applied yet. Re-fetch the stable columns; signing stays off.
    log({ event: "webhook_body_signing_column_absent", bot_id });
    ({ data: bot, error: botErr } = await sb
      .from("bots")
      .select("webhook_secret_hash, status")
      .eq("id", bot_id)
      .maybeSingle());
  }

  if (botErr) {
    log({ event: "webhook_infra_error", stage: "bot_lookup", bot_id });
    return infra();
  }
  if (!bot) {
    log({ event: "webhook_reject", reason: "bot_not_found", bot_id });
    return ok();
  }

  // 3. Auth. config:* faults ⇒ 503 (never invalid_secret); bad token ⇒ 200.
  let authed = false;
  try {
    authed = await verifyWebhookToken(PEPPER_B64URL, bot.webhook_secret_hash as string, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("config:")) {
      log({ event: "webhook_config_error", reason: msg.slice(7), bot_id });
      return infra();   // Fix 1 + Fix 3 — corrupt server state, not a bad token
    }
    log({ event: "webhook_infra_error", stage: "auth", bot_id });
    return infra();
  }
  if (!authed) {
    log({ event: "webhook_reject", reason: "invalid_secret", bot_id });
    return ok();
  }

  // H1b — per-bot, POST-auth. Only authenticated requests can increment a bot's budget.
  if (shouldRunBotGate(rateCfg, authed)) {
    const action = await enforceRateLimit(rateDeps, {
      dimension: "bot", key: botKey(bot_id, rateWin), windowIso: rateWin,
      limit: rateCfg.botPerMin, tier: rateCfg.tier, failOverride: rateCfg.failOverride,
    });
    if (action === "reject") return ok();   // uniform 200, NO enqueue
  }

  // 4. Active gate (most-restrictive layer; Edge only checks bot.status).
  if (bot.status !== "active") {
    log({ event: "webhook_reject", reason: "bot_not_active", bot_id, status: bot.status });
    return ok();
  }

  // 5. Parse body. L-3: require application/json and bound the body size BEFORE trusting it, so an
  //    authenticated token holder cannot grow the table/index unbounded with multi-MB payloads.
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    log({ event: "webhook_reject", reason: "bad_content_type", bot_id });
    return ok();
  }
  const MAX_BODY_BYTES = 16 * 1024; // 16 KiB — a TradingView alert JSON is well under this.
  const rawText = await req.text();
  if (rawText.length > MAX_BODY_BYTES) {
    log({ event: "webhook_reject", reason: "payload_too_large", bot_id, bytes: rawText.length });
    return ok();
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawText);
  } catch {
    log({ event: "webhook_reject", reason: "invalid_payload", bot_id });
    return ok();
  }

  // 5b. Optional body signing (T4 — dormant / opt-in, operator-locked flag). When the bot requires
  //     it, a valid X-Praxis-Signature over the RAW body (verified with the pepper-derived per-bot
  //     key) AND a fresh in-body timestamp are a mandatory SECOND factor. Fail-closed: any miss ⇒
  //     uniform-200 reject, NEVER a fall-through to enqueue. Flag off (default) ⇒ this block is
  //     skipped entirely and behavior is byte-for-byte unchanged. Never logs the signature/timestamp.
  // Strict `=== true`: the column is boolean NOT NULL, and if it is absent (F1 fallback above) the
  // property is undefined ⇒ signing OFF — a missing/degraded value never turns signing ON.
  // The signature is verified over req.text() (raw bytes); JSON alert bodies are valid UTF-8, so the
  // relay's bytes and the server's re-encode match (invalid UTF-8 would fail-closed, never enqueue).
  if (bot.webhook_body_signing_required === true) {
    let sigOk = false;
    try {
      const key = await deriveBodyKey(PEPPER_B64URL, bot_id);
      sigOk = await verifyBodySignature(key, rawText, req.headers.get("x-praxis-signature") ?? "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("config:")) {
        // corrupt server state (e.g. missing pepper) ⇒ 503, not a bad-signature reject.
        log({ event: "webhook_config_error", reason: msg.slice(7), bot_id });
        return infra();
      }
      log({ event: "webhook_infra_error", stage: "body_signature", bot_id });
      return infra();
    }
    if (!sigOk) {
      log({ event: "webhook_reject", reason: "invalid_body_signature", bot_id });
      return ok();
    }
    if (!timestampFresh(body?.timestamp, Date.now())) {
      log({ event: "webhook_reject", reason: "stale_or_missing_timestamp", bot_id });
      return ok();
    }
  }

  // 6. Read + validate the source-supplied signal_id and action.
  const signal_id = body?.signal_id;
  const action = body?.action;
  const MAX_SIGNAL_ID_LEN = 128; // L-3: cap the indexed dedup key.
  if (typeof signal_id !== "string" || signal_id.length === 0) {
    log({ event: "webhook_reject", reason: "missing_signal_id", bot_id });
    return ok();   // reject-if-absent — no UUID fallback
  }
  if (signal_id.length > MAX_SIGNAL_ID_LEN) {
    log({ event: "webhook_reject", reason: "signal_id_too_long", bot_id });
    return ok();
  }
  if (action !== "buy" && action !== "sell") {
    log({ event: "webhook_reject", reason: "invalid_action", bot_id, signal_id });
    return ok();
  }
  const side = action;

  // 7. webhook_logs upsert = the dedup anchor. An infra error here is the last
  //    point where a 5xx is correct (row not yet committed ⇒ retry is safe).
  const { data: inserted, error: insErr } = await sb
    .from("webhook_logs")
    .upsert(
      { bot_id, signal_id, raw_payload: body, source_ip, status: "accepted" },
      { onConflict: "bot_id,signal_id", ignoreDuplicates: true },
    )
    .select("id");

  if (insErr) {
    log({ event: "webhook_infra_error", stage: "webhook_logs_insert", bot_id, signal_id });
    return infra();
  }

  // 8a. Duplicate (ON CONFLICT ⇒ 0 rows). Slice 4C: the response now depends on the EXISTING row's
  //     status — a not-yet-`queued` row must re-attempt the enqueue instead of being dedup-swallowed.
  if (!inserted || inserted.length === 0) {
    const { data: existing } = await sb
      .from("webhook_logs")
      .select("id, raw_payload, status, received_at, requeue_attempts")
      .eq("bot_id", bot_id)
      .eq("signal_id", signal_id)
      .maybeSingle();

    // Defensive: row should exist under ON CONFLICT; if it vanished, treat as retryable infra.
    if (!existing) {
      log({ event: "webhook_infra_error", stage: "dedup_reload", bot_id, signal_id });
      return infra();
    }

    const decision = decideDuplicateAction({
      status: existing.status as WebhookLogStatus,
      receivedAtMs: Date.parse(existing.received_at as string),
      nowMs: Date.now(),
      requeueAttempts: (existing.requeue_attempts as number) ?? 0,
    });

    if (decision === "reenqueue") {
      // queue_failed OR crash-window stale `accepted`, under the cap ⇒ re-attempt the enqueue.
      // Side derives from the STORED payload's action (validated at ingest), per decision (b).
      const storedSide = sideFromAction((existing.raw_payload as Record<string, unknown> | null)?.action);
      if (!storedSide) {
        // Corrupt/legacy stored action — never enqueue blindly. Leave for triage; retryable.
        log({ event: "webhook_requeue_bad_action", bot_id, signal_id });
        return infra();
      }
      const durable = await enqueueAndMark(bot_id, signal_id, storedSide);
      log({ event: "webhook_duplicate_reenqueue", bot_id, signal_id, durable });
      return durable ? ok() : infra();
    }

    if (decision === "race_fresh_accepted") {
      // Original delivery still in flight; do NOT race it and do NOT falsely claim success.
      log({ event: "webhook_duplicate_inflight", bot_id, signal_id });
      return infra();
    }

    if (decision === "exhausted") {
      // Requeue attempts exhausted — observable dead-letter; human triage owns it. Not queued ⇒ 503.
      log({ event: "webhook_requeue_exhausted", bot_id, signal_id, requeue_attempts: existing.requeue_attempts });
      return infra();
    }

    // decision === "dedup_success" (status queued/rejected): the signal is durably handled ⇒ record a
    // dedup-skip audit with the full discriminator tuple (Fix 2), then idempotent 200.
    const stored = (existing.raw_payload ?? {}) as Record<string, unknown>;
    const distinct =
      stored.fire_time !== body.fire_time ||
      stored.close !== body.close ||
      stored.volume !== body.volume;

    await sb.from("audit_logs").insert({
      entity_type: "webhook_log",
      entity_id: existing.id ?? bot_id,
      event_type: "webhook_dedup_skip",
      after_state: {
        signal_id,
        stored_fire_time: stored.fire_time ?? null,
        new_fire_time: body.fire_time ?? null,
        stored_close: stored.close ?? null,
        new_close: body.close ?? null,
        stored_volume: stored.volume ?? null,
        new_volume: body.volume ?? null,
        distinct,
      },
      ip_address: source_ip,
    });

    log({ event: "webhook_dedup_skip", bot_id, signal_id, distinct });
    return ok();
  }

  // 8b. Fresh signal ⇒ enqueue the EVENT (WB1 v1.0 wire shape). Slice 4C: success ⇒ `queued` + 200;
  //     failure ⇒ `queue_failed` + 503 (defense-in-depth fast retry). Either way the row is durable and
  //     recoverable by the worker sweeper — no silent loss.
  const durable = await enqueueAndMark(bot_id, signal_id, side);
  if (!durable) return infra();

  log({ event: "webhook_accepted", bot_id, signal_id, side });
  return ok();
});
