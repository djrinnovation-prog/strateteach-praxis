"""DRY-RUN proof for Phase 2B · M3 (CUTOVER): for a cut-over credential Praxis is the SOLE executor.

No exchange, no creds, no network: ccxt is stubbed and the client factory is replaced by a sentinel that
RAISES if it is ever built — so "a cut-over bot never touches the exchange" becomes a hard, checkable fact
(if place_order returns without building a client, it provably never called create_order). We also prove the
NON-cutover path still falls through to the direct exchange, and that the bulk close path fails CLOSED for a
cut-over credential.

Run directly:  python3 tests/test_praxis_cutover_dryrun.py
"""
import os
import sys
import types

# ── stub ccxt so app.services.exchange imports without the real dependency ─────────────────────────
_ccxt = types.ModuleType("ccxt")
class _Base(Exception):
    ...
_ccxt.AuthenticationError = type("AuthenticationError", (_Base,), {})
_ccxt.InsufficientFunds = type("InsufficientFunds", (_Base,), {})
_ccxt.BaseError = _Base
sys.modules.setdefault("ccxt", _ccxt)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services import exchange as ex           # noqa: E402
from app.services import praxis_relay as relay     # noqa: E402

CFG = {"exchange": "binance", "subAccount": "", "apiKeyEnc": "enc-blob-xyz"}
AK = relay.account_key(CFG)   # the non-secret credential id the operator lists in PRAXIS_CUTOVER_KEYS


def _clear_env():
    for k in ("PRAXIS_CUTOVER_ENABLED", "PRAXIS_CUTOVER_KEYS", "PRAXIS_SHADOW_ENABLED",
              "PRAXIS_WEBHOOK_BASE", "PRAXIS_RELAY_MAP"):
        os.environ.pop(k, None)


def _explode_client(*a, **k):
    raise AssertionError("client factory was built for a CUT-OVER bot — direct path was reached!")


def _reached_client(*a, **k):
    raise RuntimeError("REACHED_CLIENT")   # generic → place_order reports 'Order failed: REACHED_CLIENT'


# ── 1. cut-over BUY routes to Praxis and NEVER builds a client ──────────────────────────────────────
def test_cutover_routes_and_never_touches_exchange():
    _clear_env()
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "true"
    os.environ["PRAXIS_CUTOVER_KEYS"] = AK
    relay.route_to_praxis = lambda cfg, symbol, side: {"ok": True, "routed": "praxis", "message": "routed to Praxis"}
    ex._client_from_config = _explode_client     # would raise if ever called
    r = ex.place_order(CFG, "BTC/USDT", "buy", pct=10.0)
    assert r == {"ok": True, "routed": "praxis", "message": "routed to Praxis"}, r
    print("  ✓ cut-over BUY routed to Praxis; exchange client never built")


# ── 2. cut-over route FAILS (non-2xx) ⇒ ok=False, STILL no direct order (fail-closed) ───────────────
def test_cutover_route_failure_fails_closed():
    _clear_env()
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "true"
    os.environ["PRAXIS_CUTOVER_KEYS"] = AK
    relay.route_to_praxis = lambda cfg, symbol, side: {"ok": False, "routed": "praxis", "message": "praxis_route_http_500"}
    ex._client_from_config = _explode_client
    r = ex.place_order(CFG, "BTC/USDT", "sell", pct=100.0)
    assert r["ok"] is False and r["routed"] == "praxis", r
    print("  ✓ cut-over route failure → ok=False, no direct order (fail-closed)")


# ── 3. NOT cut over ⇒ falls through to the direct exchange path (client IS built) ───────────────────
def test_non_cutover_uses_direct_path():
    _clear_env()                              # cutover flag off
    shadow_calls = []
    relay.send_shadow = lambda cfg, symbol, side, source="place_order": shadow_calls.append((symbol, side))
    ex._client_from_config = _reached_client  # proves we reach the direct path
    r = ex.place_order(CFG, "BTC/USDT", "buy", pct=10.0)
    assert r["ok"] is False and "REACHED_CLIENT" in r["message"], r
    assert shadow_calls == [("BTC/USDT", "buy")], shadow_calls
    print("  ✓ non-cutover → direct path reached + shadow mirrored (no cutover interception)")


# ── 4. cut-over flag on but this credential is NOT listed ⇒ still direct (partial cutover) ───────────
def test_cutover_on_but_credential_not_listed_is_direct():
    _clear_env()
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "true"
    os.environ["PRAXIS_CUTOVER_KEYS"] = "some-other-credential"
    relay.send_shadow = lambda *a, **k: None
    ex._client_from_config = _reached_client
    r = ex.place_order(CFG, "BTC/USDT", "buy", pct=10.0)
    assert r["ok"] is False and "REACHED_CLIENT" in r["message"], r
    print("  ✓ cutover ON but credential unlisted → direct path (only listed credentials cut over)")


# ── 5. bulk close (close_all_spot) is REFUSED for a cut-over credential, client never built ──────────
def test_close_all_spot_refused_when_cutover():
    _clear_env()
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "true"
    os.environ["PRAXIS_CUTOVER_KEYS"] = AK
    ex._client_from_config = _explode_client
    r = ex.close_all_spot(CFG)
    assert r["ok"] is False and "cutover_direct_disabled" in r["message"], r
    print("  ✓ close_all_spot refused for a cut-over credential; exchange client never built")


# ── 6. relay gating helpers are correct (pure) ──────────────────────────────────────────────────────
def test_relay_gating_helpers():
    _clear_env()
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "true"
    os.environ["PRAXIS_CUTOVER_KEYS"] = f"{AK}:ETH/USDT"      # symbol-specific only
    assert relay.is_cutover(CFG, "ETH/USDT") is True
    assert relay.is_cutover(CFG, "BTC/USDT") is False          # different symbol → not cut over
    assert relay.is_credential_cutover(CFG) is True            # credential appears under a symbol entry
    os.environ["PRAXIS_CUTOVER_ENABLED"] = "false"
    assert relay.is_cutover(CFG, "ETH/USDT") is False          # master flag off ⇒ nothing cut over
    assert relay.is_credential_cutover(CFG) is False
    print("  ✓ is_cutover / is_credential_cutover gate correctly (master flag + key match)")


if __name__ == "__main__":
    test_cutover_routes_and_never_touches_exchange()
    test_cutover_route_failure_fails_closed()
    test_non_cutover_uses_direct_path()
    test_cutover_on_but_credential_not_listed_is_direct()
    test_close_all_spot_refused_when_cutover()
    test_relay_gating_helpers()
    print("\nALL CUTOVER DRY-RUN CHECKS PASSED ✓  (no exchange call was made)")
