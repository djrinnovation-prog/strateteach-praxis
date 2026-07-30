# Phase 2B · M2 — StrateTeach signal-adapter (SHADOW mode) — operator-apply packet

Status: **Ready to apply (shadow).** This is a PATCH packet against the StrateTeach baseline
(`algo770-strateteach-main`, 2026-07-19 zip). It is applied by the **operator** to live StrateTeach
after re-verifying line numbers against the current live version. It changes StrateTeach only
ADDITIVELY and runs in **shadow**: every real order still executes exactly as today; in parallel, a
signed INTENT is mirrored to Praxis so the Praxis money-path can be validated side-by-side before the
M3 cutover. Nothing here moves money and nothing here can break the live order path.

## Safety principles (why this is safe to run in production, disabled → then shadow)
- **Fail-safe / fire-and-forget:** the hook calls `send_shadow(...)`, which NEVER raises and returns
  immediately (the POST runs on a daemon thread). A mapping miss, bad config, network error, or even a
  thrown exception inside the relay is swallowed. The live `place_order` is unaffected in timing and
  outcome.
- **No exchange keys:** the relay holds only a per-bot Praxis **signing** key (`body_key_hex`) — never
  an exchange API key. It cannot place, cancel, or move anything on an exchange.
- **Intent only:** the payload is `{signal_id, action, timestamp}`. It never sends symbol, quantity,
  price, or leverage — Praxis resolves those from the bot's server-side config (the M0 contract).
- **Off by default:** no effect unless `PRAXIS_SHADOW_ENABLED=true` AND the credential is mapped.
- **No secrets in code / no plaintext hashing:** the credential mapping key is a sha256 over the
  ENCRYPTED key blob (`apiKeyEnc`), never the decrypted key; all config comes from env.

---

## Step 1 — add the new module `python-backend/app/services/praxis_relay.py`

Copy this file verbatim (validated by the test in Step 4 — 7/7 pass):

```python
"""SHADOW relay: mirror each real StrateTeach order as a SIGNED INTENT to Praxis (Phase 2B · M2).

SHADOW-ONLY + FAIL-SAFE. `send_shadow()` fires in a daemon thread and NEVER raises into the caller;
every error (mapping miss, network, bad config) is swallowed. It holds a per-bot SIGNING key (the Praxis
bodyKey) only — NEVER an exchange key — and sends INTENT ONLY (action buy/sell); it never sends
symbol/quantity/price/leverage (Praxis resolves those from the bot's server-side config). Disabled by
default (PRAXIS_SHADOW_ENABLED). Adds NO latency to the live order path.

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
    Uses the ENCRYPTED key blob — never the decrypted key — so no secret is hashed."""
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
    """Prefer a symbol-specific entry, else the credential-wide entry. None (no-op) on a miss."""
    ak = account_key(cfg)
    return mapping.get(f"{ak}:{symbol}") or mapping.get(ak)


def build_payload(side: str) -> str:
    """Canonical INTENT body: {signal_id, action, timestamp}. Compact separators = exact signed bytes."""
    return json.dumps(
        {"signal_id": "st-" + uuid.uuid4().hex, "action": side, "timestamp": int(time.time())},
        separators=(",", ":"),
    )


def sign(body_key_hex: str, raw_body: str) -> str:
    """Lowercase-hex HMAC-SHA256(key, raw_body) — matches Praxis verifyBodySignature over the raw bytes."""
    return hmac.new(bytes.fromhex(body_key_hex), raw_body.encode(), hashlib.sha256).hexdigest()


def _post(base: str, m: dict, raw_body: str, timeout: float) -> None:
    try:
        import httpx  # lazy so a missing dep can never break import of this module
        url = base.rstrip("/") + "/functions/v1/webhook/" + m["bot_id"] + "/" + m["url_token"]
        httpx.post(
            url,
            content=raw_body,
            headers={"Content-Type": "application/json", "X-Praxis-Signature": sign(m["body_key_hex"], raw_body)},
            timeout=timeout,
        )
    except Exception as e:  # best-effort: type-only log, never re-raise
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
        pass  # the live order path MUST be unaffected by anything here
```

## Step 2 — the ONE hook in `app/services/exchange.py::place_order`

`place_order(cfg, symbol, side, pct, ...)` is the single chokepoint every signal-driven buy/sell funnels
through. Insert the hook immediately AFTER the existing `side` validation (baseline ≈ line 565, the
`if side not in ("buy", "sell")` guard) — re-verify the exact spot against the live version:

```diff
     side = (side or "").lower()
     order_type = (order_type or "market").lower()
     if side not in ("buy", "sell"):
         return {"ok": False, "message": "side must be 'buy' or 'sell'."}
+    # Phase 2B · M2 (SHADOW): mirror this signal as a SIGNED INTENT to Praxis. Fire-and-forget; never
+    # affects this order (no-op unless PRAXIS_SHADOW_ENABLED=true and the credential is mapped).
+    try:
+        from . import praxis_relay
+        praxis_relay.send_shadow(cfg, symbol, side, source="place_order")
+    except Exception:
+        pass
     if order_type not in ("market", "limit"):
         return {"ok": False, "message": "orderType must be 'market' or 'limit'."}
```

That is the ENTIRE code change to StrateTeach for M2: one new file + one guarded call. (The close/
liquidation helpers — `close_all_spot`, `close_profitable`, etc. — are NOT hooked here; they map to
Praxis's operator flatten (EP5) and are handled in a later milestone, not the signal path.)

**Fidelity note (hook timing):** placed here, the shadow fires **on-intent** — as soon as a valid
buy/sell enters `place_order`, before StrateTeach's own balance/notional checks. So Praxis may receive a
signal for an order StrateTeach then rejects locally (Praxis independently gates it, so this is safe,
and it also exercises the ingress path). If you want a stricter **on-fill** mirror (emit only for orders
StrateTeach actually placed), move the `send_shadow(...)` call to just before each successful `return`
of a placed order instead — same fail-safe wrapper. On-intent is the recommended default for M2
validation; on-fill is the closer apples-to-apples for a pre-M3 go/no-go.

## Step 3 — provisioning (operator; no secrets in this repo)

For each StrateTeach bot you want to shadow:
1. Ensure a matching Praxis bot exists (same venue/pair intent) with `webhook_body_signing_required=true`.
2. Derive that bot's `body_key_hex` from the Praxis Edge-only pepper (T4 derivation:
   `hex(HMAC-SHA256(pepper, "praxis.webhook.body-sign.v1|" + bot_id))`). The pepper never leaves the
   Edge; only the derived hex is placed in StrateTeach config.
3. Compute the StrateTeach `account_key` for that bot's credential:
   `python -c "import app.services.praxis_relay as p, json,sys; print(p.account_key(json.load(sys.stdin)))"`
   piping the bot's cfg dict (or call `account_key(cfg)` in a one-off).
4. Add to `PRAXIS_RELAY_MAP` (env JSON or a JSON file):
   `{ "<account_key>": {"bot_id":"<uuid>","url_token":"<token>","body_key_hex":"<hex>"} }`
   (use `"<account_key>:<SYMBOL>"` if one credential trades several symbols to different Praxis bots).
5. Set `PRAXIS_WEBHOOK_BASE` to the Praxis Edge base. Leave `PRAXIS_SHADOW_ENABLED` **unset/false**
   until you are ready to observe shadow traffic.

## Step 4 — test (validated; all assertions pass)

Ship `python-backend/tests/test_praxis_relay.py`. It covers: `account_key` stable + non-secret, `resolve`
symbol/fallback/miss, intent-only payload, hex-HMAC signing matching Praxis, `send_shadow`
disabled-by-default + fully-guarded + NEVER-raises, and `_post` URL + signature header.

```python
import hashlib, hmac, json, os, sys, types
from app.services import praxis_relay as pr

CFG = {"exchange": "binance", "subAccount": "", "apiKeyEnc": "ENC_BLOB_abc", "apiSecretEnc": "x"}
KEY_HEX = "00112233445566778899aabbccddeeff"


def _reset_env():
    for k in ("PRAXIS_SHADOW_ENABLED", "PRAXIS_WEBHOOK_BASE", "PRAXIS_RELAY_MAP", "PRAXIS_SHADOW_TIMEOUT_S"):
        os.environ.pop(k, None)


def test_account_key_stable_and_non_secret():
    ak = pr.account_key(CFG)
    assert len(ak) == 16 and pr.account_key(CFG) == ak
    assert pr.account_key({**CFG, "apiKeyEnc": "OTHER"}) != ak
    assert "ENC_BLOB_abc" not in ak                    # hashed, not embedded


def test_resolve_symbol_then_credential_then_miss():
    ak = pr.account_key(CFG)
    m = {f"{ak}:BTCUSDT": {"bot_id": "b1"}, ak: {"bot_id": "b0"}}
    assert pr.resolve(m, CFG, "BTCUSDT")["bot_id"] == "b1"
    assert pr.resolve(m, CFG, "ETHUSDT")["bot_id"] == "b0"
    assert pr.resolve({}, CFG, "BTCUSDT") is None


def test_payload_is_intent_only():
    p = json.loads(pr.build_payload("buy"))
    assert set(p) == {"signal_id", "action", "timestamp"}
    assert p["action"] == "buy" and p["signal_id"].startswith("st-") and isinstance(p["timestamp"], int)


def test_sign_matches_praxis_formula():
    body = '{"signal_id":"st-x","action":"sell","timestamp":1}'
    assert pr.sign(KEY_HEX, body) == hmac.new(bytes.fromhex(KEY_HEX), body.encode(), hashlib.sha256).hexdigest()


def test_send_shadow_gating(monkeypatch):
    _reset_env()
    started = []
    monkeypatch.setattr(pr.threading, "Thread", lambda *a, **k: types.SimpleNamespace(start=lambda: started.append(1)))
    pr.send_shadow(CFG, "BTCUSDT", "buy"); assert not started         # disabled
    os.environ["PRAXIS_SHADOW_ENABLED"] = "true"
    pr.send_shadow(CFG, "BTCUSDT", "hold"); assert not started        # bad side
    pr.send_shadow(CFG, "BTCUSDT", "buy"); assert not started         # no base
    os.environ["PRAXIS_WEBHOOK_BASE"] = "https://x.functions.supabase.co"
    pr.send_shadow(CFG, "BTCUSDT", "buy"); assert not started         # unmapped
    os.environ["PRAXIS_RELAY_MAP"] = json.dumps({pr.account_key(CFG): {"bot_id": "b", "url_token": "t", "body_key_hex": KEY_HEX}})
    pr.send_shadow(CFG, "BTCUSDT", "buy"); assert started == [1]      # armed + mapped
    _reset_env()


def test_send_shadow_never_raises(monkeypatch):
    os.environ.update(PRAXIS_SHADOW_ENABLED="true", PRAXIS_WEBHOOK_BASE="http://x",
                      PRAXIS_RELAY_MAP=json.dumps({pr.account_key(CFG): {"bot_id": "b", "url_token": "t", "body_key_hex": KEY_HEX}}))
    def boom(*a, **k): raise RuntimeError("boom")
    monkeypatch.setattr(pr.threading, "Thread", boom)
    pr.send_shadow(CFG, "BTCUSDT", "buy")   # must swallow
    _reset_env()


def test_post_builds_url_and_signature(monkeypatch):
    calls = {}
    fake = types.ModuleType("httpx")
    fake.post = lambda url, content=None, headers=None, timeout=None: calls.update(url=url, headers=headers, content=content)
    monkeypatch.setitem(sys.modules, "httpx", fake)
    body = '{"signal_id":"st-x","action":"buy","timestamp":1}'
    pr._post("https://base.co/", {"bot_id": "b9", "url_token": "tk", "body_key_hex": KEY_HEX}, body, 3.0)
    assert calls["url"] == "https://base.co/functions/v1/webhook/b9/tk"
    assert calls["headers"]["X-Praxis-Signature"] == pr.sign(KEY_HEX, body)
    assert calls["content"] == body
```

## Step 5 — arm + observe (shadow), then rollback path

- Arm: set `PRAXIS_SHADOW_ENABLED=true`. Now every real StrateTeach buy/sell ALSO emits a signed intent
  to the mapped Praxis bot. Compare: Praxis `webhook_logs` / `trades` / `trade_timing` (EP7) vs
  StrateTeach's real orders for the same signals. The Praxis side stays gated (testnet creds / flags),
  so no real Praxis order fires until you deliberately open its gates.
- Rollback: set `PRAXIS_SHADOW_ENABLED=false` (instant), and/or remove the module + the hook. Because
  the change is additive and fail-safe, disabling it fully restores prior behavior with zero risk.

## Scope / boundary
M2 is SHADOW only — the direct StrateTeach order path is untouched and remains authoritative. The hard
cutover (StrateTeach stops placing orders; Praxis becomes the sole executor) is **M3**, gated on a green
shadow comparison + M4 credential migration. Real funds remain NO-GO until M6 (comprehensive testnet
e2e) and the go-live blockers close.
