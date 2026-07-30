// rotate-bot-webhook-token Edge function — thin wrapper: wires real Supabase I/O into the pure
// handler (rotate.ts). All decision logic + security invariants live in rotate.ts (unit-tested there).
//
// OWNER-gated (bots.user_id == auth.uid()), browser-callable (for the in-product TradingView UI).
// config.toml MUST set verify_jwt = false so the browser CORS preflight (unauthenticated OPTIONS) is
// not blocked; auth is enforced IN the function (getUid → owner-scoped reads/CAS).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleRotate, type RotateDeps } from "./rotate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// service_role client — owner-scoped hash read + CAS update + audit. Never returns secrets to the client.
const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const realDeps: RotateDeps = {
  getEnv: (k) => Deno.env.get(k),

  // Resolve the caller's JWT → uid (null for anon/invalid). Pass the JWT explicitly to getUser(token):
  // getUser() with no argument resolves from a STORED session a fresh server client does not have.
  getUid: async (authHeader) => {
    if (!authHeader) return null;
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const caller = createClient(SUPABASE_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await caller.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  },

  // OWNER-scoped read: returns the current hash ONLY if the bot exists AND belongs to uid; else null.
  getBotForOwner: async (botId, uid) => {
    const { data, error } = await svc
      .from("bots").select("webhook_secret_hash")
      .eq("id", botId).eq("user_id", uid).is("deleted_at", null)
      .maybeSingle();
    if (error || !data) return null;
    return { webhook_secret_hash: (data.webhook_secret_hash as string) ?? "" };
  },

  // OWNER-scoped compare-and-swap: update only if id+user_id match AND the stored hash still equals
  // expectedOldHash. Returns rows updated (0 ⇒ conflict / not owner).
  casUpdate: async (botId, uid, expectedOldHash, newHash) => {
    const { data, error } = await svc
      .from("bots")
      .update({ webhook_secret_hash: newHash })
      .eq("id", botId).eq("user_id", uid).eq("webhook_secret_hash", expectedOldHash).is("deleted_at", null)
      .select("id");
    if (error) throw new Error("cas_update_failed");
    return data?.length ?? 0;
  },

  audit: async (row) => {
    await svc.from("audit_logs").insert(row);
  },
};

Deno.serve((req) => handleRotate(req, realDeps));
