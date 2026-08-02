// _shared/mainnet-gate.ts — Mainnet double-gate (Mainnet Go-Live Plan v1.1 · 1.2).
//
// Real-money (mainnet) is allowed for a user ONLY when BOTH hold:
//   (1) the GLOBAL master-switch env PRAXIS_MAINNET_ENABLED === "true" (default/absent ⇒ false ⇒ ALL mainnet
//       off — the instant global kill), AND
//   (2) an ACTIVE per-user row in public.mainnet_approvals (operator-approved; NEVER self-serve).
// FAIL-CLOSED: a missing/false env, a DB error, or a missing/inactive row ⇒ false (reject). Testnet paths
// never call this. Default state (switch unset + table empty) ⇒ mainnet stays fully fenced, identical to
// pre-1.2 behaviour — the callers keep their hard `env === "mainnet"` reject, now merely guarded by this gate.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** The GLOBAL kill: true iff PRAXIS_MAINNET_ENABLED is explicitly "true". Anything else (incl. unset) ⇒ false. */
export function mainnetMasterSwitchOn(): boolean {
  return (Deno.env.get("PRAXIS_MAINNET_ENABLED") ?? "").trim().toLowerCase() === "true";
}

/** True iff mainnet is allowed for THIS user: master-switch ON *and* an active per-user approval row exists. */
export async function mainnetAllowed(sb: SupabaseClient, userId: string): Promise<boolean> {
  if (!mainnetMasterSwitchOn()) return false;
  if (!userId || typeof userId !== "string") return false;
  const { data, error } = await sb
    .from("mainnet_approvals")
    .select("user_id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) return false; // fail-closed on any DB fault
  return !!data;
}
