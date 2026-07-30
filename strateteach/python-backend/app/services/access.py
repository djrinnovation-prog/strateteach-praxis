"""Access grants — the single place that turns a "grant" object into account
state changes. Used by coupon redemption, admin direct grants, and granting an
access request.

A grant is a small dict; any subset of:
  {"all": true}                       full access (Pro + Profit Engine + all sections)
  {"none": true}                      lock down to Basic, no extra unlocks
  {"plan": "basic|middle|pro"}        set the subscription tier
  {"profitUnlock": true}              one-time Profit-Engine full unlock
  {"credits": {"bots": 5, ...}}       add purchasable-style credits
  {"sections": "all" | "none"}        unlock/lock all feature sections
"""
from __future__ import annotations

import secrets
import string
from typing import Any

from app import database as db
from app.services import plans

# Feature sections that "none" locks. These MUST be the real router paths the
# frontend access-gate checks (Shell NAV + Home orbs + Settings section editor),
# or a lock/unlock silently misses that screen. The dashboard route is /overview
# (NOT /dashboard) — using the wrong key here meant the dashboard could never be
# locked/unlocked by grants.
ALL_SECTIONS = [
    "/university", "/reels", "/overview", "/scanner", "/profit", "/strategy",
    "/exchange", "/analytics", "/backtests", "/telegram", "/chat",
]


def generate_code(prefix: str = "ALGO") -> str:
    """A short, human-friendly, unambiguous coupon code, e.g. ALGO-7K4P-9QX2."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1
    part = lambda n: "".join(secrets.choice(alphabet) for _ in range(n))
    return f"{prefix}-{part(4)}-{part(4)}"


def normalize_grant(grant: dict[str, Any] | None) -> dict[str, Any]:
    """Validate/clean an incoming grant so we never persist junk."""
    g = dict(grant or {})
    out: dict[str, Any] = {}
    if g.get("all"):
        out["all"] = True
    if g.get("none"):
        out["none"] = True
    if g.get("plan") in plans.PLAN_ORDER:
        out["plan"] = g["plan"]
    if g.get("profitUnlock"):
        out["profitUnlock"] = True
    if isinstance(g.get("credits"), dict):
        cr = {k: int(v) for k, v in g["credits"].items()
              if k in plans.CREDIT_KINDS and int(v) != 0}
        if cr:
            out["credits"] = cr
    if g.get("sections") in ("all", "none"):
        out["sections"] = g["sections"]
    return out


def describe_grant(grant: dict[str, Any] | None) -> str:
    g = normalize_grant(grant)
    if g.get("all"):
        return "Full access (Pro + Trading Engine)"
    if g.get("none"):
        return "Locked to Basic"
    parts = []
    if g.get("plan"):
        parts.append(f"{g['plan'].capitalize()} plan")
    if g.get("profitUnlock"):
        parts.append("Trading Engine unlock")
    if g.get("credits"):
        parts.append("credits: " + ", ".join(f"{k}+{v}" for k, v in g["credits"].items()))
    if g.get("sections"):
        parts.append(f"sections: {g['sections']}")
    return ", ".join(parts) or "No change"


def apply_grant(username: str, grant: dict[str, Any] | None) -> None:
    """Apply a (normalized) grant to a user's account."""
    g = normalize_grant(grant)

    if g.get("all"):
        db.set_user_plan(username, "pro")
        db.set_profit_engine_unlocked(username, True)
        db.set_user_locked(username, [])
        return
    if g.get("none"):
        db.set_user_plan(username, "basic")
        db.set_profit_engine_unlocked(username, False)
        db.set_user_locked(username, list(ALL_SECTIONS))
        return

    if g.get("plan"):
        db.set_user_plan(username, g["plan"])
        # A plan assignment also GRANTS section visibility (clears any per-user lock
        # and the inherited global lock). Without this, section access was fully
        # decoupled from the plan: an admin who "gave a user a plan" found the user
        # still couldn't SEE the screens, because visibility is governed only by
        # locked_sections, which a plan grant never touched (the "tom" bug). Per-
        # feature limits (scan size, backtests/day, Profit Engine) stay enforced by
        # entitlements, and each screen still shows its own upgrade prompt.
        db.set_user_locked(username, [])
    if g.get("profitUnlock"):
        db.set_profit_engine_unlocked(username, True)
    if g.get("credits"):
        for kind, n in g["credits"].items():
            db.add_credits(username, kind, n)
    if g.get("sections") == "all":
        db.set_user_locked(username, [])
    elif g.get("sections") == "none":
        db.set_user_locked(username, list(ALL_SECTIONS))
