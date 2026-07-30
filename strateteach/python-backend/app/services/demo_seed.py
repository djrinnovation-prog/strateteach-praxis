"""Idempotent seeding of the two labelled DEMO preview accounts.

Single source of truth for both entry points:
  • ``seed(force=False)`` is called from ``database.bootstrap()`` on every boot —
    a fast NO-OP once both accounts exist (two indexed PK lookups, no writes), so
    it never slows a normal restart. On the FIRST boot (accounts missing) it
    creates them + a representative SIMULATION portfolio for the end-user.
  • ``seed(force=True)`` is called by the ``seed_demo_accounts.py`` CLI to RESET
    the two accounts back to a known state (password, role, fresh portfolio).

Accounts (both password-login; the login IS the username, set equal to the email):
  • demo.user@strateteach.com  → role='user'  → Home + a demo/simulation portfolio.
  • demo.staff@strateteach.com → role='admin' (NON-owner) → Staff Audit landing.

Reuses the EXISTING auth/roles model (no new scheme). No exchange keys, no real
money, no live trading — simulation only.
"""
from __future__ import annotations

import os
from typing import Any

from app import database as db

# Owner allowlist (see core.security): these usernames get owner powers. The demo
# staff MUST stay out of this set so it remains a plain admin (Staff Audit landing).
_OWNER_NAMES = {"admin", "dan", "rafi", "yoav"}

USER_LOGIN = os.environ.get("DEMO_USER_LOGIN", "demo.user@strateteach.com").strip()
USER_PW = os.environ.get("DEMO_USER_PW", "Demo770!user")
STAFF_LOGIN = os.environ.get("DEMO_STAFF_LOGIN", "demo.staff@strateteach.com").strip()
STAFF_PW = os.environ.get("DEMO_STAFF_PW", "Demo770!staff")
CAPITAL = float(os.environ.get("DEMO_CAPITAL", "10000") or 10000)

# A representative demo/simulation portfolio for the END-USER. Entry prices are
# static, plausible snapshots — the app marks them to LIVE public prices at view
# time (falling back to entry = flat P&L when the public feed is geo-blocked), so
# the point here is only that Home / Trading show real holdings, not an empty box.
DEMO_PICKS = [
    # (symbol, name, tier, entry_price)
    ("BTC/USDT", "Bitcoin", "in_uptrend", 61250.0),
    ("ETH/USDT", "Ethereum", "breaking_out", 3120.0),
    ("SOL/USDT", "Solana", "near_breakout", 148.0),
    ("LINK/USDT", "Chainlink", "in_uptrend", 17.4),
    ("AVAX/USDT", "Avalanche", "building", 34.8),
]


def _hash(pw: str) -> str:
    # Lazy import to avoid any import cycle with database.bootstrap().
    from app.services.auth import hash_password
    return hash_password(pw)


def _guard_owner_collision(login: str) -> None:
    if login.strip().lower() in _OWNER_NAMES:
        raise ValueError(
            f"Refusing to seed '{login}': it collides with the OWNER allowlist "
            f"({', '.join(sorted(_OWNER_NAMES))}). Pick a different demo login."
        )


def _ensure_account(login: str, password: str, role: str, *, force: bool) -> str:
    """Create the account if missing; on force, reset password + role. Otherwise
    only correct a drifted role (never rewrite an existing password)."""
    _guard_owner_collision(login)
    existing = db.get_user(login)
    if existing is None:
        # email column mirrors the login so the account is self-describing.
        db.create_user(login, _hash(password), role=role, email=login, created_by="seed:demo")
        return "created"
    if force:
        db.update_user_password(login, _hash(password))
    if existing.get("role") != role:
        db.update_user_role(login, role)
    return "refreshed" if force else "exists"


def _seed_user_portfolio(*, force: bool) -> int:
    """Give the END-USER full access + a running demo portfolio. Idempotent:
    only (re)builds the portfolio when forced or when the user has none."""
    # Pro plan + Trading Engine + all sections unlocked so every screen is reachable
    # (a fresh 'user' is Basic with locks). Cheap + idempotent.
    db.set_user_plan(USER_LOGIN, "pro")
    db.set_profit_engine_unlocked(USER_LOGIN, True)
    db.set_user_locked(USER_LOGIN, [])
    try:
        db.set_cost_basis(USER_LOGIN, "demo", CAPITAL)
    except Exception:  # noqa: BLE001 — non-fatal seeding nicety
        pass

    existing = [s for s in db.list_paper_sessions() if s.get("owner") == USER_LOGIN]
    if existing and not force:
        return 0  # already has a portfolio — leave it (and any demo activity) alone
    for s in existing:
        db.delete_paper_session(s["id"])

    started = db.now_iso()
    sid = db.create_paper_session(
        label="Demo portfolio", strategy="profit_engine", capital=CAPITAL,
        daily_target=2.0, target_behavior="notify",
        tiers=["breaking_out", "near_breakout", "in_uptrend"],
        max_positions=len(DEMO_PICKS), started_at=started, owner=USER_LOGIN,
    )
    per = CAPITAL / len(DEMO_PICKS)
    positions = [{
        "symbol": symbol, "name": name, "tier": tier,
        "qty": per / entry, "entryPrice": entry, "capital": per, "openedAt": started,
    } for symbol, name, tier, entry in DEMO_PICKS]
    db.insert_paper_positions(positions, sid)
    return len(positions)


def seed(force: bool = False) -> dict[str, Any]:
    """Seed (or, with ``force``, reset) the two demo accounts. Returns a small
    summary dict. Startup fast-path: NO-OP once both accounts already exist."""
    if not force and db.get_user(USER_LOGIN) is not None and db.get_user(STAFF_LOGIN) is not None:
        return {"seeded": False, "reason": "accounts already exist",
                "user": USER_LOGIN, "staff": STAFF_LOGIN}

    r_user = _ensure_account(USER_LOGIN, USER_PW, "user", force=force)
    r_staff = _ensure_account(STAFF_LOGIN, STAFF_PW, "admin", force=force)
    positions = _seed_user_portfolio(force=force)
    try:
        db.add_audit("demo.seed", actor="seed:demo",
                     detail={"user": USER_LOGIN, "staff": STAFF_LOGIN,
                             "force": force, "positions": positions})
    except Exception:  # noqa: BLE001 — audit is best-effort
        pass
    return {"seeded": True, "user": USER_LOGIN, "userState": r_user,
            "staff": STAFF_LOGIN, "staffState": r_staff, "positions": positions}
