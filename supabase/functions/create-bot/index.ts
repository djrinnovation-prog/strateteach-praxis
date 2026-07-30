// create-bot — Praxis owns the bot (Phase 2B unification). StrateTeach's UI collects the bot config and
// POSTs {ticket, ...config} STRAIGHT here; Praxis creates the bot, mints its webhook token, and returns
// it once. StrateTeach no longer manages bots. The ticket (issued by StrateTeach, which authenticated
// the user, action="create_bot") authorizes creating ONE bot for that user. Single-use + short-lived.
//
// SAFE DEFAULTS: a new bot is trading_enabled=false (must be explicitly armed later), status
// 'pending_setup' (needs a credential via connect-credential before it can go active), and
// webhook_body_signing_required=true (only a signed relay can drive it). account_type is spot-only (the
// futures cage refuses non-spot). The url_token is shown ONCE; only its hash is stored.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deriveProvisionKeyMaterial, verifyTicket } from "../_shared/provision-ticket.ts";
import { computeWebhookHash } from "../_shared/webhook-hash.ts";

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

const numIn = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
function genToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return "prx_" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" });
  if (!PEPPER) return json(503, { ok: false, error: "config" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "bad_json" }); }
  const ticket = body?.ticket;
  if (typeof ticket !== "string") return json(400, { ok: false, error: "missing_ticket" });

  // 1) Ticket: signature + freshness + action-bound to create_bot.
  const material = await deriveProvisionKeyMaterial(PEPPER);
  const t = await verifyTicket(material, ticket, Math.floor(Date.now() / 1000), "create_bot");
  if (!t) return json(401, { ok: false, error: "invalid_or_expired_ticket" });

  // 2) Single-use.
  const { error: jerr } = await sb.from("provision_tickets_used").insert({ jti: t.jti });
  if (jerr) return json(409, { ok: false, error: "ticket_already_used" });

  // 3) Validate the bot config (fail-closed).
  const trading_pair = body?.trading_pair;
  const sizing_mode = body?.sizing_mode;
  if (typeof trading_pair !== "string" || !/^[A-Z0-9]{5,20}$/.test(trading_pair))
    return json(400, { ok: false, error: "bad_trading_pair" });
  if (body?.account_type !== undefined && body?.account_type !== "spot")
    return json(400, { ok: false, error: "only_spot_supported" });   // futures cage
  if (sizing_mode !== "fixed_notional" && sizing_mode !== "percent_of_balance")
    return json(400, { ok: false, error: "bad_sizing_mode" });
  const fixed = sizing_mode === "fixed_notional" ? numIn(body?.fixed_notional_usdt, 1, 100_000) : null;
  const pct = sizing_mode === "percent_of_balance" ? numIn(body?.position_size_pct, 0.1, 100) : null;
  if (sizing_mode === "fixed_notional" && fixed === null) return json(400, { ok: false, error: "bad_fixed_notional" });
  if (sizing_mode === "percent_of_balance" && pct === null) return json(400, { ok: false, error: "bad_position_pct" });
  const maxNotional = numIn(body?.max_order_notional_usdt, 1, 1_000_000);
  const dailyCap = numIn(body?.daily_notional_cap_usdt, 1, 10_000_000);
  if (maxNotional === null || dailyCap === null) return json(400, { ok: false, error: "bad_caps" });
  // Cross-field sanity (audit): a single order can't exceed the daily cap, and a fixed size can't exceed
  // the per-order cap — reject inconsistent config rather than store it silently.
  if (maxNotional > dailyCap) return json(400, { ok: false, error: "max_exceeds_daily" });
  if (fixed !== null && fixed > maxNotional) return json(400, { ok: false, error: "fixed_exceeds_max" });

  // 4) Mint the webhook token (stored ONLY as a hash) + create the bot with SAFE defaults.
  const token = genToken();
  const webhook_secret_hash = await computeWebhookHash(PEPPER, token);
  const { data: bot, error: berr } = await sb.from("bots").insert({
    user_id: t.praxis_user_id,
    name: trading_pair + " bot",
    trading_pair,
    account_type: "spot",
    webhook_secret_hash,
    status: "pending_setup",              // needs a credential (connect-credential) before active
    trading_enabled: false,               // must be explicitly armed
    webhook_body_signing_required: true,  // signed relay only
    sizing_mode,
    fixed_notional_usdt: fixed,
    position_size_pct: pct,
    max_order_notional_usdt: maxNotional,
    daily_notional_cap_usdt: dailyCap,
    sell_enabled: false,
  }).select("id").single();
  if (berr || !bot) return json(500, { ok: false, error: "bot_create_failed" });

  // url_token shown ONCE — the caller MUST save it; only its hash is stored server-side.
  return json(201, {
    ok: true,
    bot_id: bot.id,
    webhook_path: `/functions/v1/webhook/${bot.id}/${token}`,
    url_token: token,
    status: "pending_setup",
  });
});
