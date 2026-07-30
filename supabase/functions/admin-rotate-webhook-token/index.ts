// Admin webhook-token rotation Edge function — thin wrapper: wires real Supabase
// I/O into the pure handler (rotate.ts). All decision logic + security invariants
// live in rotate.ts (unit-tested there). Requires config.toml verify_jwt = true.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleRotate, type RotateDeps } from "./rotate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// service_role client — reads is_operator, current hash, does the CAS update + audit.
const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const realDeps: RotateDeps = {
  getEnv: (k) => Deno.env.get(k),

  // Resolve the caller's JWT → uid (null for anon/invalid). Uses a caller-scoped
  // client so the JWT is validated by Supabase Auth.
  getUid: async (authHeader) => {
    if (!authHeader) return null;
    // Pass the JWT explicitly to getUser(token): getUser() with no argument
    // resolves from a STORED session, which a fresh server-side client does not
    // have — so it would return null even with the Authorization header set.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const caller = createClient(SUPABASE_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await caller.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  },

  isOperator: async (uid) => {
    // `profiles` is locked down (no service_role SELECT). Use the SECURITY DEFINER
    // RPC public.is_operator(uuid) (migration 018), which reads profiles.is_operator
    // as the function owner. Fail closed on any RPC error / non-true result.
    const { data, error } = await svc.rpc("is_operator", { p_uid: uid });
    if (error) return false;
    return data === true;
  },

  // M-1: return hash AND owner so the handler can authorize per-bot (not just "any operator").
  getBot: async (botId) => {
    const { data, error } = await svc
      .from("bots").select("webhook_secret_hash, user_id").eq("id", botId).is("deleted_at", null).maybeSingle();
    if (error || !data) return null;
    const hash = (data.webhook_secret_hash as string) ?? null;
    const userId = (data.user_id as string) ?? null;
    if (hash === null || userId === null) return null;
    return { hash, userId };
  },

  // Compare-and-swap: update only if the stored hash still equals expected_old_hash.
  // Returns the number of rows updated (0 ⇒ conflict).
  casUpdate: async (botId, expectedOldHash, newHash) => {
    const { data, error } = await svc
      .from("bots")
      .update({ webhook_secret_hash: newHash })
      .eq("id", botId).eq("webhook_secret_hash", expectedOldHash).is("deleted_at", null)
      .select("id");
    if (error) throw new Error("cas_update_failed");
    return data?.length ?? 0;
  },

  audit: async (row) => {
    await svc.from("audit_logs").insert(row);
  },
};

Deno.serve((req) => handleRotate(req, realDeps));
