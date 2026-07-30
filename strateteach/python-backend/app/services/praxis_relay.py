"""SHADOW relay: mirror each real StrateTeach order as a SIGNED INTENT to Praxis (Phase 2B · M2).

SHADOW-ONLY + FAIL-SAFE. `send_shadow()` fires in a daemon thread and NEVER raises into the caller;
every error (mapping miss, network, bad config) is swallowed. It holds a per-bot SIGNING key (the Praxis
bodyKey) only — NEVER an exchange key — and sends INTENT ONLY (action buy/sell); it never sends
symbol/quantity/price/leverage (Praxis resolves those from the bot's server-side config). Disabled by
default (PRAXIS_SHADOW_ENABLED). Adds NO latency to the live order path (returns immediately; the POST
runs on a background daemon thread).

Config (all via env; NO secrets in code):
  PRAXIS_SHADOW_ENABLED   "true" to arm shadow mirroring (default off).
  PRAXIS_WEBHOOK_BASE     e.g. https://<proj>.functions.supabase.co  (Praxis Edge base URL)
  PRAXIS_RELAY_MAP        inline JSON, or a path to a JSON file, mapping a credential (± symbol) to a
                          Praxis bot: { "<account_key>[:<symbol>]": {"bot_id","url_token","body_key_hex"} }
  PRAXIS_SHADOW_TIMEOUT_S per-request timeout seconds (default 3).

`body_key_hex` is the HEX of the Praxis per-bot key material = HMAC-SHA256(pepper, "praxis.webhook.
body-sign.v1|" + bot_id). The operator derives it once and configures it here; the pepper never leaves
the Praxis Edge, and no exchange key is ever involved.
"""
import hashlib
import hmac
import json
import logging
import os
import threading
import time
import uuid
from typing import Optional

log = logging.getLogger("praxis_relay")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


def account_key(cfg: dict) -> str:
    """Stable, NON-SECRET id for a StrateTeach credential: sha256 over (exchange|subAccount|apiKeyEnc).

    Uses the ENCRYPTED key blob (apiKeyEnc) — never the decrypted key — so no secret is hashed, and the
    output is safe to place in an operator-managed mapping/config.
    """
    basis = "|".join([
        str(cfg.get("exchange", "")),
        str(cfg.get("subAccount", "")),
        str(cfg.get("apiKeyEnc", "")),
    ])
    return hashlib.sha256(basis.encode()).hexdigest()[:16]


def load_map(raw: Optional[str] = None) -> dict:
    """Parse PRAXIS_RELAY_MAP: inline JSON object, or a path to a JSON file. Unreadable → {} (shadow off)."""
    raw = _env("PRAXIS_RELAY_MAP") if raw is None else raw
    if not raw:
        return {}
    try:
        if raw.strip().startswith("{"):
            return json.loads(raw)
        with open(raw, "r") as fh:
            return json.load(fh)
    except Exception:
        log.warning("praxis_relay: PRAXIS_RELAY_MAP unreadable; shadow mirroring disabled")
        return {}


def resolve(mapping: dict, cfg: dict, symbol: str) -> Optional[dict]:
    """Resolve the Praxis bot for this credential+symbol. Prefer a symbol-specific entry, else the
    credential-wide entry. Returns None (no-op) on a miss."""
    ak = account_key(cfg)
    return mapping.get(f"{ak}:{symbol}") or mapping.get(ak)


def build_payload(side: str) -> str:
    """Canonical INTENT body. signal_id is unique per shadow emit; action is the side; timestamp is
    epoch seconds. Compact separators so the exact bytes are what we sign."""
    return json.dumps(
        {"signal_id": "st-" + uuid.uuid4().hex, "action": side, "timestamp": int(time.time())},
        separators=(",", ":"),
    )


def sign(body_key_hex: str, raw_body: str) -> str:
    """Lowercase-hex HMAC-SHA256(key, raw_body) — matches Praxis verifyBodySignature over the raw bytes."""
    return hmac.new(bytes.fromhex(body_key_hex), raw_body.encode(), hashlib.sha256).hexdigest()


def _post(base: str, m: dict, raw_body: str, timeout: float) -> None:
    try:
        import httpx  # imported lazily so a missing dep can never break import of this module
        url = base.rstrip("/") + "/functions/v1/webhook/" + m["bot_id"] + "/" + m["url_token"]
        httpx.post(
            url,
            content=raw_body,
            headers={"Content-Type": "application/json", "X-Praxis-Signature": sign(m["body_key_hex"], raw_body)},
            timeout=timeout,
        )
    except Exception as e:  # best-effort: shadow failures are logged by type only, never re-raised
        log.info("praxis_relay: shadow post failed (ignored): %s", type(e).__name__)


def send_shadow(cfg: dict, symbol: str, side: str, *, source: str = "place_order") -> None:
    """Fire-and-forget shadow signal. NEVER raises. No-op unless enabled + mapped + side in {buy,sell}."""
    try:
        if _env("PRAXIS_SHADOW_ENABLED", "false").lower() != "true":
            return
        side = (side or "").lower()
        if side not in ("buy", "sell"):
            return
        base = _env("PRAXIS_WEBHOOK_BASE")
        if not base:
            return
        m = resolve(load_map(), cfg, symbol)
        if not m or not all(k in m for k in ("bot_id", "url_token", "body_key_hex")):
            return
        raw = build_payload(side)
        timeout = float(_env("PRAXIS_SHADOW_TIMEOUT_S", "3") or 3)
        threading.Thread(target=_post, args=(base, m, raw, timeout), daemon=True).start()
    except Exception:
        # The live order path MUST be unaffected by anything here.
        pass


# ─── Phase 2B · M3 (CUTOVER) ─────────────────────────────────────────────────────────────────────────
# For a CUT-OVER bot, Praxis is the SOLE executor. place_order routes the intent to Praxis and returns
# WITHOUT ever placing a direct order. The invariant: a cut-over bot can NEVER reach client.create_order,
# and any failure fails CLOSED (return ok=False, no trade) — never a direct order, never a double.

def cutover_keys() -> set:
    """The explicit set of cut-over account_keys (or `account_key:symbol`), from PRAXIS_CUTOVER_KEYS
    (comma-separated). Pure + robust: an unset/blank value yields an empty set (nothing cut over)."""
    raw = _env("PRAXIS_CUTOVER_KEYS")
    return {x.strip() for x in raw.split(",") if x.strip()} if raw else set()


def is_cutover(cfg: dict, symbol: str) -> bool:
    """True iff the master flag is on AND this credential (± symbol) is explicitly listed. Deterministic,
    no I/O beyond env reads — it does not depend on the network or the mapping being loadable."""
    if _env("PRAXIS_CUTOVER_ENABLED", "false").lower() != "true":
        return False
    ks = cutover_keys()
    ak = account_key(cfg)
    return (f"{ak}:{symbol}" in ks) or (ak in ks)


def is_credential_cutover(cfg: dict) -> bool:
    """CREDENTIAL-level cutover (symbol-agnostic): True iff the master flag is on AND this credential
    appears in the cutover set — either credential-wide (`account_key`) OR under ANY `account_key:<symbol>`
    entry. Used to fail-CLOSE the bulk/close/withdraw/dust paths for a cut-over credential: those are not a
    single buy/sell INTENT, so there is no 1:1 Praxis signal to route — a cut-over credential is simply
    REFUSED there, and Praxis owns exits via its own reconciliation / flatten. Pure (env reads only)."""
    if _env("PRAXIS_CUTOVER_ENABLED", "false").lower() != "true":
        return False
    ak = account_key(cfg)
    return any(k == ak or k.startswith(ak + ":") for k in cutover_keys())


def route_to_praxis(cfg: dict, symbol: str, side: str) -> dict:
    """SYNCHRONOUS authoritative route to Praxis for a cut-over bot. Returns a result dict; NEVER raises.
    ok=True only on a 2xx (Praxis accepted the signal — it then applies its own gates). Any miss / non-2xx
    / error ⇒ ok=False, and the caller MUST NOT place a direct order. Single attempt (no retry: a fresh
    signal_id retry could double; Praxis dedups only the SAME signal_id)."""
    try:
        m = resolve(load_map(), cfg, symbol)
        if not m or not all(k in m for k in ("bot_id", "url_token", "body_key_hex")):
            return {"ok": False, "routed": "praxis", "message": "praxis_route_unmapped"}
        base = _env("PRAXIS_WEBHOOK_BASE")
        if not base:
            return {"ok": False, "routed": "praxis", "message": "praxis_route_unconfigured"}
        raw = build_payload(side)
        import httpx
        r = httpx.post(
            base.rstrip("/") + "/functions/v1/webhook/" + m["bot_id"] + "/" + m["url_token"],
            content=raw,
            headers={"Content-Type": "application/json", "X-Praxis-Signature": sign(m["body_key_hex"], raw)},
            timeout=float(_env("PRAXIS_ROUTE_TIMEOUT_S", "6") or 6),
        )
        if 200 <= r.status_code < 300:
            return {"ok": True, "routed": "praxis", "message": "routed to Praxis"}
        return {"ok": False, "routed": "praxis", "message": "praxis_route_http_%d" % r.status_code}
    except Exception as e:
        return {"ok": False, "routed": "praxis", "message": "praxis_route_error:" + type(e).__name__}


def maybe_route(cfg: dict, symbol: str, side: str):
    """If this bot is CUT OVER, route to Praxis and return a result dict (caller MUST return it and MUST
    NOT place a direct order). If NOT cut over, return None (caller proceeds with shadow + its direct
    path). NEVER returns None for a cut-over bot, so a cut-over bot can never fall through to direct
    execution; a route failure returns ok=False, not None."""
    try:
        cut = is_cutover(cfg, side and symbol)
    except Exception:
        cut = False   # determination failed → prior behavior (shadow+direct); is_cutover is pure so this is theoretical
    if not cut:
        return None
    return route_to_praxis(cfg, symbol, side)
