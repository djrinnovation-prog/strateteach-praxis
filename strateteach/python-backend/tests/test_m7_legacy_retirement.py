"""M7 — legacy StrateTeach trading-engine retirement: the retirement holds at every layer.

Proves, as hard checkable facts, that with the legacy engine RETIRED (the default —
STRATETEACH_LEGACY_ENGINE_ENABLED unset):
  1. the HTTP route guard raises 410 (no key-ingest / order / withdraw route can execute);
  2. every DATA-LAYER key-WRITE helper refuses BEFORE any DB write (StrateTeach physically
     cannot store an exchange key — the guarantee is one layer below the routes);
  3. the background autopilot LIVE gate is hard-OFF even if AUTOPILOT_LIVE_ENABLED is set
     (the one live path that is not behind an HTTP route cannot place a real order);
  4. the escape hatch works: with the flag explicitly ON, the route guard passes (so the
     retirement is a deliberate switch, and this test is meaningful, not vacuous).

Run in the backend container:  python3 tests/test_m7_legacy_retirement.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Retired by default — make sure no ambient value leaks in.
os.environ.pop("STRATETEACH_LEGACY_ENGINE_ENABLED", None)

from fastapi import HTTPException                       # noqa: E402
from app.core import security                           # noqa: E402
import app.database as db                               # noqa: E402
from app.services import autopilot_live as live         # noqa: E402


def _expect_raise(fn, exc, label):
    try:
        fn()
    except exc as e:
        print(f"  ✓ {label} → {type(e).__name__}")
        return
    raise AssertionError(f"{label}: expected {exc.__name__}, none raised")


def test_route_guard_410():
    _expect_raise(security.assert_legacy_engine_enabled, HTTPException, "route guard raises")
    try:
        security.assert_legacy_engine_enabled()
    except HTTPException as e:
        assert e.status_code == 410, f"expected 410, got {e.status_code}"
    print("test_route_guard_410 PASS")


def test_data_layer_write_refused():
    # Every key-WRITE helper refuses at the FIRST line, before any DB access.
    _expect_raise(lambda: db.save_exchange_config("binance", "testnet", "", "k", "s", "", 5.0),
                  RuntimeError, "save_exchange_config")
    _expect_raise(lambda: db.create_bot(username="u", label=None, exchange="binance", market="spot",
                                        enc_key="k", enc_secret="s", enc_passphrase="",
                                        sub_account=None, max_quote=None, max_open=None),
                  RuntimeError, "create_bot")
    _expect_raise(lambda: db.save_exchange_creds_backup(username="u", exchange="binance", environment="testnet",
                                                        sub_account=None, enc_key="k", enc_secret="s", enc_passphrase=""),
                  RuntimeError, "save_exchange_creds_backup")
    _expect_raise(lambda: db.save_autopilot_keys(username="u", exchange="bybit", environment="testnet",
                                                 enc_key="k", enc_secret="s"),
                  RuntimeError, "save_autopilot_keys")
    print("test_data_layer_write_refused PASS")


def test_background_live_gate_hard_off():
    # Even if an operator sets AUTOPILOT_LIVE_ENABLED, the legacy-retired flag wins.
    os.environ["AUTOPILOT_LIVE_ENABLED"] = "true"
    try:
        assert live.live_master_enabled() is False, "live_master_enabled must be False while retired"
    finally:
        os.environ.pop("AUTOPILOT_LIVE_ENABLED", None)
    print("test_background_live_gate_hard_off PASS")


def test_execution_gate_requires_legacy_flag():
    # HIGH-1/MED-2: the direct-exchange execution chokepoint (place_order/withdraw/close/dust and the
    # public signal webhook) must be OFF while the legacy engine is retired, EVEN IF the older
    # STRATETEACH_ENGINE_ENABLED flag is left on. Otherwise the M7 kill-switch wouldn't govern the
    # primary trade path.
    from app.services import exchange as ex_svc
    os.environ["STRATETEACH_ENGINE_ENABLED"] = "true"
    os.environ.pop("STRATETEACH_LEGACY_ENGINE_ENABLED", None)
    try:
        assert ex_svc._engine_enabled() is False, "execution must be fail-closed while legacy retired"
    finally:
        os.environ.pop("STRATETEACH_ENGINE_ENABLED", None)
    print("test_execution_gate_requires_legacy_flag PASS")


def test_execution_gate_escape_hatch_both_flags():
    # The execution gate must UN-stick only when BOTH flags are on (proves it isn't wedged off).
    from app.services import exchange as ex_svc
    os.environ["STRATETEACH_LEGACY_ENGINE_ENABLED"] = "true"
    os.environ["STRATETEACH_ENGINE_ENABLED"] = "true"
    try:
        assert ex_svc._engine_enabled() is True, "both flags on ⇒ execution gate open"
    finally:
        os.environ.pop("STRATETEACH_LEGACY_ENGINE_ENABLED", None)
        os.environ.pop("STRATETEACH_ENGINE_ENABLED", None)
    print("test_execution_gate_escape_hatch_both_flags PASS")


def test_escape_hatch_reenables_route_guard():
    os.environ["STRATETEACH_LEGACY_ENGINE_ENABLED"] = "true"
    try:
        # With the flag ON, the route guard must NOT raise (deliberate re-enable).
        security.assert_legacy_engine_enabled()
        print("test_escape_hatch_reenables_route_guard PASS")
    finally:
        os.environ.pop("STRATETEACH_LEGACY_ENGINE_ENABLED", None)


if __name__ == "__main__":
    test_route_guard_410()
    test_data_layer_write_refused()
    test_background_live_gate_hard_off()
    test_execution_gate_requires_legacy_flag()
    test_execution_gate_escape_hatch_both_flags()
    test_escape_hatch_reenables_route_guard()
    print("\nALL M7 RETIREMENT TESTS PASSED")
