"""
Access-control test for the main-admin tier.

Proves the require_main_admin gate: a RESTRICTED admin (role=admin, is_main=False)
is 403'd from "inside info" endpoints, while a MAIN admin (is_main=True) passes,
and a normal user is rejected. No DB/network — db lookups are monkeypatched.

Run:  python3 tests/test_admin_roles.py   (or under pytest)
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# Stub optional heavy deps so importing the security module stays light.
for _n in ["yfinance", "ccxt", "stripe", "twilio", "sentry_sdk", "sendgrid"]:
    sys.modules.setdefault(_n, types.ModuleType(_n))

from fastapi import HTTPException  # noqa: E402
from app.core import security  # noqa: E402

USERS = {
    "admin":      {"role": "admin", "is_main": True},   # main / owner
    "staff":      {"role": "admin", "is_main": False},  # restricted admin
    "bob":        {"role": "user",  "is_main": False},  # normal user
}
SESSIONS = {"tok-admin": "admin", "tok-staff": "staff", "tok-bob": "bob"}


def _install():
    db = security.db
    db.get_session_user = lambda tok: SESSIONS.get(tok)
    db.get_user = lambda u: ({"username": u, **USERS[u]} if u in USERS else None)
    db.is_main_admin = lambda u: bool(USERS.get(u, {}).get("role") == "admin" and USERS.get(u, {}).get("is_main"))


def _expect_ok(fn, tok, who):
    assert fn(f"Bearer {tok}") == who, f"{who} should pass {fn.__name__}"


def _expect_403(fn, tok, who):
    try:
        fn(f"Bearer {tok}")
    except HTTPException as e:
        assert e.status_code == 403, f"{who}: expected 403, got {e.status_code}"
        return
    raise AssertionError(f"{who} should have been 403'd by {fn.__name__}")


def test_require_main_admin():
    _install()
    # main admin passes both gates
    _expect_ok(security.require_admin, "tok-admin", "admin")
    _expect_ok(security.require_main_admin, "tok-admin", "admin")
    # restricted admin: keeps admin gate, BLOCKED from main-admin (inside info)
    _expect_ok(security.require_admin, "tok-staff", "staff")
    _expect_403(security.require_main_admin, "tok-staff", "staff")
    # normal user: blocked from both
    _expect_403(security.require_admin, "tok-bob", "bob")
    _expect_403(security.require_main_admin, "tok-bob", "bob")


if __name__ == "__main__":
    try:
        test_require_main_admin()
        print("PASS — main admin passes; restricted admin keeps app-admin but is 403'd from inside info; user blocked.")
    except AssertionError as e:
        print("FAIL —", e); sys.exit(1)
