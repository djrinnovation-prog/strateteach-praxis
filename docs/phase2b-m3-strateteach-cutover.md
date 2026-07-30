# Phase 2B · M3 — StrateTeach cutover (Praxis becomes the sole executor) — operator-apply packet

Status: **Ready to apply, HARD-GATED.** This is the cutover: a cut-over StrateTeach bot stops placing
its own exchange orders and routes its signal to Praxis ONLY. It builds directly on the M2 packet
(`phase2b-m2-*.md`) — same `praxis_relay.py`, extended — and it is applied by the **operator**, PER BOT,
behind a flag, only AFTER that bot's M2 shadow-compare is green (Stage 6) and its credentials are
migrated to Praxis Vault (M4/Stage 7). Do not cut a bot over before both.

## The boundary invariant (non-negotiable)
> A cut-over bot can NEVER reach `client.create_order`. Every failure fails CLOSED to no-trade —
> never a direct exchange order, never a double.

This is enforced structurally (see the hook + `maybe_route` below), not by convention. Post-cutover the
bot holds no exchange keys (M4 moved them to Praxis Vault); even if a key lingered, the code path never
reaches an exchange client for a cut-over bot.

## Step 1 — extend `app/services/praxis_relay.py` (append the M3 block; VALIDATED)

Append after the M2 code (the cutover functions are pure + fail-safe; the boundary test in Step 4 proves
`maybe_route` never returns None for a cut-over bot):

```python
# ─── Phase 2B · M3 (CUTOVER) ────────────────────────────────────────────────────────────────────────
# For a CUT-OVER bot, Praxis is the SOLE executor. place_order routes the intent to Praxis and returns
# WITHOUT ever placing a direct order. Invariant: a cut-over bot can NEVER reach client.create_order, and
# any failure fails CLOSED (return ok=False, no trade) — never a direct order, never a double.

def cutover_keys() -> set:
    """Explicit set of cut-over account_keys (or `account_key:symbol`) from PRAXIS_CUTOVER_KEYS
    (comma-separated). Pure + robust: unset/blank ⇒ empty set (nothing cut over)."""
    raw = _env("PRAXIS_CUTOVER_KEYS")
    return {x.strip() for x in raw.split(",") if x.strip()} if raw else set()


def is_cutover(cfg: dict, symbol: str) -> bool:
    """True iff the master flag is on AND this credential (± symbol) is explicitly listed. Deterministic,
    no I/O beyond env reads — does not depend on the network or the mapping being loadable."""
    if _env("PRAXIS_CUTOVER_ENABLED", "false").lower() != "true":
        return False
    ks = cutover_keys()
    ak = account_key(cfg)
    return (f"{ak}:{symbol}" in ks) or (ak in ks)


def route_to_praxis(cfg: dict, symbol: str, side: str) -> dict:
    """SYNCHRONOUS authoritative route for a cut-over bot. Returns a result dict; NEVER raises. ok=True
    only on a 2xx (Praxis accepted the signal — it then applies its own gates). Any miss / non-2xx /
    error ⇒ ok=False; the caller MUST NOT place a direct order. Single attempt (no retry: a fresh
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
    """If CUT OVER, route to Praxis and return a result dict (caller MUST return it, MUST NOT place a
    direct order). If NOT cut over, return None (caller proceeds with shadow + its direct path). NEVER
    returns None for a cut-over bot; a route failure returns ok=False, not None."""
    try:
        cut = is_cutover(cfg, side and symbol)
    except Exception:
        cut = False   # determination failed → prior behavior; is_cutover is pure so this is theoretical
    if not cut:
        return None
    return route_to_praxis(cfg, symbol, side)
```

## Step 2 — REPLACE the M2 hook in `place_order` with the combined M3+M2 hook

In `app/services/exchange.py::place_order`, the M2 packet added a shadow-only call after the `side`
validation. Replace THAT block with this (structure matters — see the safety note):

```diff
     if side not in ("buy", "sell"):
         return {"ok": False, "message": "side must be 'buy' or 'sell'."}
-    # Phase 2B · M2 (SHADOW): mirror this signal as a SIGNED INTENT to Praxis. Fire-and-forget; never
-    # affects this order (no-op unless PRAXIS_SHADOW_ENABLED=true and the credential is mapped).
-    try:
-        from . import praxis_relay
-        praxis_relay.send_shadow(cfg, symbol, side, source="place_order")
-    except Exception:
-        pass
+    # Phase 2B · M3 (CUTOVER) + M2 (SHADOW). maybe_route() returns a result dict for a CUT-OVER bot
+    # (route to Praxis → return HERE; the direct order path below is NEVER reached) or None otherwise.
+    # It is intentionally NOT wrapped in a swallowing try: maybe_route is internally fail-safe (returns
+    # dict-or-None, never raises), and if it ever did raise, place_order would raise and the caller would
+    # place NO order — the fail-closed direction. Only the non-cutover shadow call is swallowed.
+    from . import praxis_relay
+    _routed = praxis_relay.maybe_route(cfg, symbol, side)
+    if _routed is not None:
+        return _routed
+    try:
+        praxis_relay.send_shadow(cfg, symbol, side, source="place_order")
+    except Exception:
+        pass
     if order_type not in ("market", "limit"):
         return {"ok": False, "message": "orderType must be 'market' or 'limit'."}
```

### Why this is boundary-safe (the two cases)
- **Cut-over bot:** `maybe_route` returns a dict → `place_order` returns it immediately. The code below
  (`_client_from_config`, `client.create_order`) is never executed → no exchange client is even built.
  A route failure returns `ok=False` → still an early return, still no direct order.
- **Non-cut-over bot:** `maybe_route` returns `None` → falls through to the (swallowed) shadow call and
  then the unchanged direct order path — behaves exactly as M2.
- **If `praxis_relay` is broken/absent:** the un-swallowed `maybe_route` call raises → `place_order`
  raises → the caller places NO order (fail-closed). This is deliberately conservative: a broken relay
  halts trading rather than risk a cut-over bot silently trading direct. (`praxis_relay` is validated +
  already deployed from M2, so this is theoretical.)

## Step 3 — config + PER-BOT rollout
- `PRAXIS_CUTOVER_ENABLED=true` — the master switch (off = every bot stays on its direct path; M2 shadow
  still works). 
- `PRAXIS_CUTOVER_KEYS` — comma-separated `account_key` (or `account_key:SYMBOL`) values for the bots
  that are cut over. Add ONE bot at a time.
- The mapping (`PRAXIS_RELAY_MAP`) + `PRAXIS_WEBHOOK_BASE` from M2 are reused. A cut-over key MUST have a
  live mapping entry with a valid `body_key_hex` (else `route_to_praxis` returns `praxis_route_unmapped`
  and the bot trades nothing until fixed).

**Per-bot cutover procedure (repeat):**
1. Confirm that bot's M2 shadow-compare is green and its credentials are migrated to Praxis Vault (M4).
2. Compute its `account_key` (`praxis_relay.account_key(cfg)`); append it to `PRAXIS_CUTOVER_KEYS`.
3. Deploy/redeploy StrateTeach. From now, that bot's signals execute on Praxis only.
4. Verify: the bot's real orders now appear on the Praxis side (testnet until Stage 12), and StrateTeach
   places no direct order for it (log shows `routed: praxis`).

## Step 4 — test (`python-backend/tests/test_praxis_relay_cutover.py`; VALIDATED, all pass)

```python
import json, os, sys, types
from app.services import praxis_relay as pr

CFG = {"exchange": "binance", "subAccount": "", "apiKeyEnc": "ENC", "apiSecretEnc": "x"}
KEY = "00112233445566778899aabbccddeeff"


def _reset():
    for k in ("PRAXIS_CUTOVER_ENABLED","PRAXIS_CUTOVER_KEYS","PRAXIS_WEBHOOK_BASE","PRAXIS_RELAY_MAP","PRAXIS_ROUTE_TIMEOUT_S"):
        os.environ.pop(k, None)

def _httpx(status):
    m = types.ModuleType("httpx"); m.post = lambda *a, **k: types.SimpleNamespace(status_code=status); return m


def test_is_cutover_gating():
    _reset(); ak = pr.account_key(CFG)
    assert pr.is_cutover(CFG, "BTCUSDT") is False              # master off
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "true"
    assert pr.is_cutover(CFG, "BTCUSDT") is False              # no keys
    os.environ["PRAXIS_CUTOVER_KEYS"] = ak
    assert pr.is_cutover(CFG, "BTCUSDT") is True
    os.environ["PRAXIS_CUTOVER_KEYS"] = f"{ak}:ETHUSDT"
    assert pr.is_cutover(CFG, "ETHUSDT") is True and pr.is_cutover(CFG, "BTCUSDT") is False
    _reset()


def test_route_to_praxis_outcomes(monkeypatch):
    _reset(); ak = pr.account_key(CFG); os.environ["PRAXIS_WEBHOOK_BASE"] = "https://x"
    assert pr.route_to_praxis(CFG, "BTCUSDT", "buy")["message"] == "praxis_route_unmapped"
    os.environ["PRAXIS_RELAY_MAP"] = json.dumps({ak: {"bot_id": "b", "url_token": "t", "body_key_hex": KEY}})
    monkeypatch.setitem(sys.modules, "httpx", _httpx(200)); assert pr.route_to_praxis(CFG, "BTCUSDT", "buy")["ok"] is True
    monkeypatch.setitem(sys.modules, "httpx", _httpx(503)); assert pr.route_to_praxis(CFG, "BTCUSDT", "buy")["ok"] is False
    boom = types.ModuleType("httpx"); boom.post = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("net"))
    monkeypatch.setitem(sys.modules, "httpx", boom); assert pr.route_to_praxis(CFG, "BTCUSDT", "buy")["ok"] is False   # never raises
    _reset()


def test_maybe_route_boundary(monkeypatch):
    _reset(); ak = pr.account_key(CFG)
    assert pr.maybe_route(CFG, "BTCUSDT", "buy") is None                              # not cutover → direct path
    os.environ.update(PRAXIS_CUTOVER_ENABLED="true", PRAXIS_CUTOVER_KEYS=ak,
                      PRAXIS_WEBHOOK_BASE="https://x",
                      PRAXIS_RELAY_MAP=json.dumps({ak: {"bot_id": "b", "url_token": "t", "body_key_hex": KEY}}))
    monkeypatch.setitem(sys.modules, "httpx", _httpx(200)); assert pr.maybe_route(CFG, "BTCUSDT", "buy")["ok"] is True
    boom = types.ModuleType("httpx"); boom.post = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("net"))
    monkeypatch.setitem(sys.modules, "httpx", boom)
    r = pr.maybe_route(CFG, "BTCUSDT", "buy"); assert r is not None and r["ok"] is False   # cutover + error → dict, NOT None
    os.environ["PRAXIS_RELAY_MAP"] = "{{broken"
    r = pr.maybe_route(CFG, "BTCUSDT", "buy"); assert r is not None and r["ok"] is False   # broken map → still not None
    _reset()
```

## Rollback
- Per bot: remove its `account_key` from `PRAXIS_CUTOVER_KEYS` + redeploy → that bot instantly reverts to
  its direct path (kept intact, not deleted, until Stage 11 green).
- Global: `PRAXIS_CUTOVER_ENABLED=false` → every bot back to direct (M2 shadow still runs).

## Post-cutover (end state, after ALL bots are cut over + Stage 11 green)
Once every bot is cut over and validated: retire StrateTeach's direct order path for good — remove the
`_client_from_config`/`create_order`/`close_*`/`withdraw` code, delete the exchange keys from
StrateTeach's stores, and drop `PRAXIS_CUTOVER_KEYS` (cutover becomes unconditional). At that point
StrateTeach structurally cannot touch an exchange — the one-way boundary is permanent. That final
teardown is a separate cleanup PR, done only after the pilot is proven. Real funds NO-GO until Stage 11
+ Stage 12 (A1/A4/A11 + M7).
