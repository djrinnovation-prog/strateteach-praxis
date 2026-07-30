#!/usr/bin/env python3
"""Reset the two labelled DEMO preview accounts to a known state (manual CLI).

The accounts are ALSO created automatically + idempotently on backend startup
(see app.services.demo_seed.seed, called from database.bootstrap), so a normal
deploy needs NO manual step. Run this script only to force a RESET — it rewrites
the demo passwords/roles and rebuilds the end-user's simulation portfolio:

    docker compose exec backend python seed_demo_accounts.py

  • demo.user@strateteach.com  → role='user'  → Home + a 5-position SIMULATION
    portfolio, Pro plan, all sections unlocked. No exchange keys, no real money.
  • demo.staff@strateteach.com → role='admin' (NON-owner) → Staff Audit landing.

Optional env overrides: DEMO_USER_LOGIN / DEMO_USER_PW / DEMO_STAFF_LOGIN /
DEMO_STAFF_PW / DEMO_CAPITAL (see app.services.demo_seed).

NOTE: the demo END-USER (role='user') is normally blocked by the maintenance
gate. Prod exempts it via MAINTENANCE_BYPASS_USERNAMES=demo.user@strateteach.com
(wired in .github/workflows/deploy.yml + docker-compose.yml) — that lets it past
the gate WITHOUT any admin power. The demo STAFF is role='admin' and bypasses
maintenance automatically, so it needs no allowlisting.
"""
from __future__ import annotations

import os
import sys

# Runnable from python-backend/ (start.sh's cwd) where `app` is importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import database as db  # noqa: E402
from app.services import demo_seed  # noqa: E402


def main() -> None:
    print("Bootstrapping schema (idempotent)…")
    db.bootstrap()

    print("Resetting demo accounts (force)…")
    result = demo_seed.seed(force=True)
    print(f"  user  {result['user']}: {result.get('userState')}")
    print(f"  staff {result['staff']}: {result.get('staffState')}")
    print(f"  demo portfolio positions: {result.get('positions')}")

    maint = db.get_maintenance()
    print("\n─────────────────────────────────────────────────────────────")
    print("DEMO ACCOUNTS READY")
    print("─────────────────────────────────────────────────────────────")
    print(f"  END-USER   login: {demo_seed.USER_LOGIN}")
    print(f"             pass : {demo_seed.USER_PW}")
    print(f"             role : user  (Home + demo/simulation portfolio)")
    print(f"  STAFF      login: {demo_seed.STAFF_LOGIN}")
    print(f"             pass : {demo_seed.STAFF_PW}")
    print(f"             role : admin (Staff Audit landing; NOT an owner)")
    print("─────────────────────────────────────────────────────────────")
    print(f"  Maintenance gate is currently: {'ON' if maint else 'OFF'}")
    if maint:
        print("  → The STAFF account (admin) bypasses maintenance automatically.")
        print("  → The END-USER passes via MAINTENANCE_BYPASS_USERNAMES (set on prod deploy).")
    print("─────────────────────────────────────────────────────────────")


if __name__ == "__main__":
    main()
