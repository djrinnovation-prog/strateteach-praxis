// provision-ticket.ts — the auth bridge for "connect exchange" (Phase 2B · M1, ideal design).
//
// StrateTeach (the brain, which authenticates the user) mints a SHORT-LIVED, SINGLE-USE, SIGNED ticket
// that authorizes the browser to create ONE credential in Praxis for a specific (user, bot, exchange,
// env). The browser then POSTs {ticket, api_key, api_secret} STRAIGHT to Praxis connect-credential.
// StrateTeach NEVER sees the API key — it only issues the ticket. There is NO key migration (no M4):
// every key is born in Praxis Vault.
//
// The ticket key material = HMAC-SHA256(pepper, "praxis.provision.ticket.v1"), domain-separated from the
// webhook body-signing use of the same Edge-only pepper. The operator hands StrateTeach the hex material
// (like the bodyKey); Praxis derives the same from the pepper and verifies. Constant-time verify.
import { b64urlToBytes, hexToBytes } from "./webhook-hash.ts";

const PROVISION_DOMAIN = "praxis.provision.ticket.v1";
const enc = new TextEncoder();
const dec = new TextDecoder();

// Hard cap on ticket lifetime (audit fix): the server rejects any ticket whose exp is more than this far
// in the future, so a misconfigured/long-lived ticket can't outlive the single-use ledger — and any
// jti-ledger cleanup can safely key off exp. Independent of what the issuer requests.
export const MAX_TICKET_TTL_S = 300;

export type TicketAction = "create_bot" | "connect_credential";

export interface TicketPayload {
  praxis_user_id: string;
  action: TicketAction;                   // binds the ticket to ONE operation (no cross-use)
  jti: string;                            // unique nonce — enforces single-use (server dedups)
  exp: number;                            // epoch SECONDS; ticket invalid after this
  // Required ONLY for action === "connect_credential":
  praxis_bot_id?: string;
  exchange_ccxt_id?: string;              // e.g. 'binance'
  env?: "testnet" | "mainnet";
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function bytesToB64url(b: Uint8Array): string {
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToStr(s: string): string {
  return dec.decode(b64urlToBytes(s));
}

/** Derive the ticket key material from the Edge-only pepper. StrateTeach receives the hex of this. */
export async function deriveProvisionKeyMaterial(pepperB64url: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!pepperB64url) throw new Error("config:missing_pepper");
  const key = await crypto.subtle.importKey(
    "raw", b64urlToBytes(pepperB64url), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const material = await crypto.subtle.sign("HMAC", key, enc.encode(PROVISION_DOMAIN));
  return new Uint8Array(material);
}

/** ticket = base64url(JSON(payload)) + "." + hex(HMAC(material, base64url(payload))). */
export async function signTicket(material: Uint8Array<ArrayBuffer>, payload: TicketPayload): Promise<string> {
  const body = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return body + "." + bytesToHex(new Uint8Array(sig));
}

/** Verify signature (constant-time) + freshness (exp) + that the ticket is for `expectedAction`.
 *  Returns the payload, or null (fail-closed). SINGLE-USE (jti dedup) is enforced by the caller against a
 *  store — verification alone is not enough. Binding to expectedAction stops a create_bot ticket from
 *  being replayed against connect_credential (or vice versa). */
export async function verifyTicket(
  material: Uint8Array<ArrayBuffer>, ticket: string, nowSec: number, expectedAction: TicketAction,
): Promise<TicketPayload | null> {
  if (typeof ticket !== "string") return null;
  const dot = ticket.indexOf(".");
  if (dot <= 0) return null;
  const body = ticket.slice(0, dot);
  const sigHex = ticket.slice(dot + 1);
  if (!/^[0-9a-fA-F]{64}$/.test(sigHex)) return null;
  const key = await crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let ok: boolean;
  try { ok = await crypto.subtle.verify("HMAC", key, hexToBytes(sigHex), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let p: TicketPayload;
  try { p = JSON.parse(b64urlToStr(body)); } catch { return null; }
  if (!p || typeof p.exp !== "number" || !Number.isFinite(p.exp) || p.exp < nowSec) return null;   // expired
  if (p.exp - nowSec > MAX_TICKET_TTL_S) return null;                                               // over-long lifetime
  if (typeof p.praxis_user_id !== "string" || !p.praxis_user_id
      || typeof p.jti !== "string" || p.jti.length < 8
      || p.action !== expectedAction) return null;                                                  // action-bound
  if (expectedAction === "connect_credential") {
    if (typeof p.praxis_bot_id !== "string" || !p.praxis_bot_id
        || typeof p.exchange_ccxt_id !== "string" || !p.exchange_ccxt_id
        || (p.env !== "testnet" && p.env !== "mainnet")) return null;
  }
  return p;
}
