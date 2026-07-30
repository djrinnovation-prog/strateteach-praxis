// Tests for the admin webhook-token rotation handler (rotate.ts). Injected fake
// deps — no network, no server boot. Covers authz, dry_run/commit, CAS conflict,
// dry_run binding, Doppler attestation, validation, fail-closed, and no-secret leakage.
import { assert, assertEquals } from "jsr:@std/assert";
import { handleRotate, type RotateDeps } from "./rotate.ts";
import { computeWebhookHash, hashFingerprint } from "../_shared/webhook-hash.ts";

const PEPPER = "dGVzdC1wZXBwZXItZm9yLXVuaXQtdGVzdHMtMDEyMzQ1Njc4OQ";
const BOT = "5acc84c9-edd2-4c9f-87dd-fd928f8b62cd";
const UID = "11111111-1111-1111-1111-111111111111";
const TOKEN = "commitTokenForUnitTests_ABCDEFGHIJ0123456789";
const OLD_HASH = "v1:" + "a".repeat(64);
const SECRET_NAME = "PRAXIS_CAMPAIGN_SOLUSDT_WEBHOOK_TOKEN";

interface FakeState {
  auditRows: Record<string, unknown>[];
  casCalls: { botId: string; expected: string; newHash: string }[];
}

function fakeDeps(o: {
  env?: Record<string, string | undefined>;
  uid?: string | null;
  isOperator?: boolean;
  botHash?: string | null;
  botOwner?: string;   // M-1: bot's user_id; defaults to the caller UID (caller is the owner)
  casResult?: number;
  auditThrowsOn?: string; // event_type that makes the audit write fail (simulates audit outage)
} = {}): { deps: RotateDeps; state: FakeState } {
  const state: FakeState = { auditRows: [], casCalls: [] };
  const env = o.env ?? { WEBHOOK_SECRET_PEPPER: PEPPER };
  const casResult = o.casResult ?? 1;
  const deps: RotateDeps = {
    getEnv: (k) => env[k],
    getUid: () => Promise.resolve(o.uid === undefined ? UID : o.uid),
    isOperator: () => Promise.resolve(o.isOperator === undefined ? true : o.isOperator),
    // M-1: null hash ⇒ bot not found; otherwise return hash + owner (owner defaults to the caller).
    getBot: () =>
      Promise.resolve(
        o.botHash === null ? null : { hash: o.botHash ?? OLD_HASH, userId: o.botOwner ?? UID },
      ),
    casUpdate: (botId, expected, newHash) => {
      state.casCalls.push({ botId, expected, newHash });
      return Promise.resolve(casResult);
    },
    audit: (row) => {
      if (o.auditThrowsOn && row.event_type === o.auditThrowsOn) {
        return Promise.reject(new Error("audit_down"));
      }
      state.auditRows.push(row);
      return Promise.resolve();
    },
  };
  return { deps, state };
}

function reqOf(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x/functions/v1/admin-rotate-webhook-token", {
    method: "POST",
    headers: { "content-type": "application/json", "Authorization": "Bearer test", ...headers },
    body: JSON.stringify(body),
  });
}

async function newFp(): Promise<string> {
  return hashFingerprint(await computeWebhookHash(PEPPER, TOKEN));
}

function commitBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bot_id: BOT, mode: "commit", token: TOKEN,
    expected_old_hash: OLD_HASH,
    dry_run_fingerprint: "__SET__",
    doppler_updated_confirmed: true,
    doppler_secret_name: SECRET_NAME,
    ...over,
  };
}

Deno.test("anon (no operator jwt) ⇒ 403, no write, denial audited", async () => {
  const { deps, state } = fakeDeps({ uid: null });
  const res = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }), deps);
  assertEquals(res.status, 403);
  assertEquals(state.casCalls.length, 0);
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotate_denied"));
});

Deno.test("non-operator + valid bot_id ⇒ 403, no write, denial audited", async () => {
  const { deps, state } = fakeDeps({ isOperator: false });
  const res = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }), deps);
  assertEquals(res.status, 403);
  assertEquals(state.casCalls.length, 0);
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotate_denied"));
});

Deno.test("no JWT + missing/invalid bot_id ⇒ 403, NO audit row (schema limit), secret-free log", async () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const { deps, state } = fakeDeps({ uid: null });
    const res = await handleRotate(reqOf({ mode: "dry_run", token: TOKEN }), deps); // no bot_id
    assertEquals(res.status, 403);
    assertEquals(state.auditRows.length, 0); // entity_id NOT NULL ⇒ cannot audit without bot_id
    const allLogs = logs.join("\n");
    assert(allLogs.includes("rotate_denied"), "denial must still be logged");
    assert(!allLogs.includes(TOKEN) && !allLogs.includes(PEPPER), "no secret in log");
  } finally {
    console.log = orig;
  }
});

Deno.test("ADMIN_ROTATE_SECRET mismatch ⇒ 403; correct ⇒ proceeds", async () => {
  const env = { WEBHOOK_SECRET_PEPPER: PEPPER, ADMIN_ROTATE_SECRET: "s3cret-value" };
  const bad = fakeDeps({ env });
  const r1 = await handleRotate(
    reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }, { "x-admin-rotate-secret": "wrong" }),
    bad.deps,
  );
  assertEquals(r1.status, 403);
  assert(bad.state.auditRows.some((r) => r.event_type === "webhook_token.rotate_denied")); // mismatch + valid bot_id ⇒ audited

  const good = fakeDeps({ env });
  const r2 = await handleRotate(
    reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }, { "x-admin-rotate-secret": "s3cret-value" }),
    good.deps,
  );
  assertEquals(r2.status, 200);
});

Deno.test("dry_run ⇒ 200, updated_rows 0, NO DB write; I-1: FINGERPRINTS ONLY by default (no full hash)", async () => {
  const { deps, state } = fakeDeps();
  const res = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }), deps);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.updated_rows, 0);
  assertEquals(state.casCalls.length, 0);
  // I-1: default disclosure is fingerprints only — full hashes must NOT be returned unless reveal:true.
  assert(typeof j.new_fp === "string" && j.new_fp.length > 0, "new_fp present");
  assertEquals(j.new_hash, undefined);
  assertEquals(j.old_hash, undefined);
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotate_dryrun"));
});

Deno.test("I-1: dry_run with reveal:true ⇒ full old_hash + new_hash returned (audited as revealed)", async () => {
  const { deps, state } = fakeDeps();
  const res = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN, reveal: true }), deps);
  assertEquals(res.status, 200);
  const j = await res.json();
  assert(String(j.new_hash).startsWith("v1:"), "full new_hash on reveal");
  assertEquals(j.old_hash, OLD_HASH);
  const dry = state.auditRows.find((r) => r.event_type === "webhook_token.rotate_dryrun");
  assertEquals((dry?.after_state as Record<string, unknown>)?.revealed, true);
});

Deno.test("M-1: operator rotating a bot they do NOT own, WITHOUT override ⇒ 403 (no silent IDOR), no CAS", async () => {
  const { deps, state } = fakeDeps({ botOwner: "99999999-9999-9999-9999-999999999999" });
  const res = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: await newFp() })), deps);
  assertEquals(res.status, 403);
  assertEquals(state.casCalls.length, 0);
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotate_denied"));
});

Deno.test("M-1: cross-owner rotation WITH operator_override ⇒ proceeds, and is audited as rotate_cross_owner", async () => {
  const { deps, state } = fakeDeps({ botOwner: "99999999-9999-9999-9999-999999999999", casResult: 1 });
  const res = await handleRotate(
    reqOf(commitBody({ dry_run_fingerprint: await newFp(), operator_override: true })),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(state.casCalls.length, 1);
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotate_cross_owner"), "cross-owner action audited");
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotated"));
});

Deno.test("commit (happy) ⇒ 200, exactly one CAS row, rotated audit", async () => {
  const { deps, state } = fakeDeps({ casResult: 1 });
  const res = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: await newFp() })), deps);
  assertEquals(res.status, 200);
  const j = await res.json();
  assertEquals(j.updated_rows, 1);
  assertEquals(state.casCalls.length, 1);
  assertEquals(state.casCalls[0].expected, OLD_HASH);
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotated"));
});

Deno.test("commit CAS succeeds but audit FAILS ⇒ degraded (NOT clean 200), rotation_committed, no secret leak", async () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const { deps, state } = fakeDeps({ casResult: 1, auditThrowsOn: "webhook_token.rotated" });
    const res = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: await newFp() })), deps);
    assert(res.status !== 200, "must NOT be a clean 200 when the audit failed");
    assertEquals(res.status, 500);
    const j = await res.json();
    assertEquals(j.ok, false);
    assertEquals(j.error, "rotation_committed_audit_failed");
    assertEquals(j.rotation_committed, true);
    assertEquals(state.casCalls.length, 1); // the rotation DID happen
    // No token / pepper / full hash in the degraded response or the critical log.
    const fullNewHashBody = (await computeWebhookHash(PEPPER, TOKEN)).slice(3);
    const bodyStr = JSON.stringify(j);
    const allLogs = logs.join("\n");
    assert(!bodyStr.includes(TOKEN) && !bodyStr.includes(PEPPER) && !bodyStr.includes(fullNewHashBody), "no secret in response");
    assert(!allLogs.includes(TOKEN) && !allLogs.includes(PEPPER) && !allLogs.includes(fullNewHashBody), "no secret in log");
    assert(allLogs.includes("rotation_committed_audit_failed"), "critical marker logged");
  } finally {
    console.log = orig;
  }
});

Deno.test("commit CAS conflict (0 rows) ⇒ 409, no rotation claim, conflict audit", async () => {
  const { deps, state } = fakeDeps({ casResult: 0 });
  const res = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: await newFp() })), deps);
  assertEquals(res.status, 409);
  const j = await res.json();
  assertEquals(j.conflict, true);
  assertEquals(state.casCalls.length, 1); // CAS attempted
  assert(state.auditRows.some((r) => r.event_type === "webhook_token.rotate_conflict"));
});

Deno.test("commit dry_run_fingerprint mismatch ⇒ 409, no CAS attempted", async () => {
  const { deps, state } = fakeDeps();
  const res = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: "deadbeef..deadbeef" })), deps);
  assertEquals(res.status, 409);
  assertEquals(state.casCalls.length, 0);
});

Deno.test("commit missing Doppler attestation ⇒ 400, no CAS", async () => {
  const fp = await newFp();
  const a = fakeDeps();
  const r1 = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: fp, doppler_updated_confirmed: false })), a.deps);
  assertEquals(r1.status, 400);
  assertEquals(a.state.casCalls.length, 0);

  const b = fakeDeps();
  const r2 = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: fp, doppler_secret_name: "" })), b.deps);
  assertEquals(r2.status, 400);
  assertEquals(b.state.casCalls.length, 0);
});

Deno.test("validation ⇒ 400 for bad bot_id / weak token / bad mode", async () => {
  const { deps } = fakeDeps();
  assertEquals((await handleRotate(reqOf({ bot_id: "not-a-uuid", mode: "dry_run", token: TOKEN }), deps)).status, 400);
  assertEquals((await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: "short" }), deps)).status, 400);
  assertEquals((await handleRotate(reqOf({ bot_id: BOT, mode: "frobnicate", token: TOKEN }), deps)).status, 400);
});

Deno.test("bot not found ⇒ 404", async () => {
  const { deps } = fakeDeps({ botHash: null });
  const res = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }), deps);
  assertEquals(res.status, 404);
});

Deno.test("missing pepper ⇒ 503 fail-closed", async () => {
  const { deps } = fakeDeps({ env: {} });
  const res = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }), deps);
  assertEquals(res.status, 503);
});

Deno.test("no token / pepper / full hash in logs, audit; token/pepper not in response", async () => {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    const fp = await newFp();
    const fullNewHashBody = (await computeWebhookHash(PEPPER, TOKEN)).slice(3);
    const { deps, state } = fakeDeps({ casResult: 1 });

    const r1 = await handleRotate(reqOf({ bot_id: BOT, mode: "dry_run", token: TOKEN }), deps);
    const t1 = await r1.text();
    const r2 = await handleRotate(reqOf(commitBody({ dry_run_fingerprint: fp })), deps);
    const t2 = await r2.text();

    const allLogs = logs.join("\n");
    assert(!allLogs.includes(TOKEN), "token leaked in logs");
    assert(!allLogs.includes(PEPPER), "pepper leaked in logs");
    assert(!allLogs.includes(fullNewHashBody), "full hash leaked in logs");
    assert(!allLogs.includes(OLD_HASH.slice(3)), "full old hash leaked in logs");

    const auditStr = JSON.stringify(state.auditRows);
    assert(!auditStr.includes(TOKEN), "token leaked in audit");
    assert(!auditStr.includes(PEPPER), "pepper leaked in audit");
    assert(!auditStr.includes(fullNewHashBody), "full hash leaked in audit");
    assert(!auditStr.includes(OLD_HASH.slice(3)), "full old hash leaked in audit");

    // Responses may carry hashes (rollback anchor) but NEVER the token/pepper.
    assert(!t1.includes(TOKEN) && !t2.includes(TOKEN), "token leaked in response");
    assert(!t1.includes(PEPPER) && !t2.includes(PEPPER), "pepper leaked in response");
  } finally {
    console.log = orig;
  }
});
