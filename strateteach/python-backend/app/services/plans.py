"""Plan definitions, limits, and effective-entitlement computation.

Single source of truth for the three subscription tiers and what each unlocks.
Both the server-side RBAC checks and the frontend (via /me/entitlements) read
from here, so limits can never drift between enforcement and UI.

Three distinct concepts (do not conflate):
  • plan      – the subscription tier (basic / middle / pro): base capacity.
  • credits   – purchased top-ups that ADD to plan caps (per metric).
  • loyalty   – earned gamification points (display only; no capacity effect).

Profit Engine: included in Pro (profit_runs_per_day runs, capped at
PROFIT_INVEST_CAP invested). A one-time $500 purchase sets
users.profit_engine_unlocked = TRUE which grants access on any tier AND lifts
the invest cap (None = unlimited).
"""
from __future__ import annotations

from typing import Any, Optional

# Sentinel for "no cap" (full universe / unlimited).
UNLIMITED = None

# One-time Profit-Engine full-unlock price, in USD cents (Stripe wants cents).
PROFIT_UNLOCK_PRICE_CENTS = 50000  # $500.00

# Default Pro Profit-Engine invest cap (USD). $500 unlock lifts it to UNLIMITED.
PROFIT_INVEST_CAP = 20000.0

# Plan list prices, USD/month, for display + Stripe product mapping.
PLAN_PRICES = {
    "basic": 10.00,
    "middle": 29.99,
    "pro": 99.99,
}

PLAN_ORDER = ("basic", "middle", "pro")

# Base capability matrix. Numbers are *base* caps; purchased credits add on top.
#   scan_cap            – max assets in the daily breakout scan (None = full universe)
#   breakouts_visible   – how many breakout rows the user may see
#   bots                – max concurrent exchange bots
#   strategies          – max running strategies
#   backtest_per_day    – backtest scans allowed per day (0 = feature not included)
#   backtest_asset_cap  – max assets per backtest run
#   profit_engine       – baseline Profit-Engine access (Pro only by default)
#   profit_runs_per_day – Profit-Engine runs per day
#   backtest            – feature flag (False on Basic)
PLANS: dict[str, dict[str, Any]] = {
    "basic": {
        "label": "Basic",
        "price": PLAN_PRICES["basic"],
        "scan_cap": 10,
        "breakouts_visible": 10,
        "bots": 5,
        "signal_bots": False,   # automated TradingView-webhook bots (premium feature)
        "strategies": 1,
        "backtest": False,
        "backtest_per_day": 0,
        "backtest_asset_cap": 0,
        "profit_engine": False,
        "profit_runs_per_day": 0,
        "features": [
            "connect_exchange", "one_strategy", "top10_breakouts",
            "chat", "dashboard", "explanations", "learn", "profile", "settings",
        ],
    },
    "middle": {
        "label": "Middle",
        "price": PLAN_PRICES["middle"],
        "scan_cap": 1000,
        "breakouts_visible": 1000,
        "bots": 15,
        "signal_bots": True,
        "strategies": 4,  # 2 running + up to 2 of the user's own
        "backtest": True,
        "backtest_per_day": 5,
        "backtest_asset_cap": 100,
        "profit_engine": False,
        "profit_runs_per_day": 0,
        "features": [
            "connect_exchange", "daily_scan_1000", "backtest", "credits",
            "strategy_lab", "chat", "dashboard", "explanations", "learn", "profile", "settings",
        ],
    },
    "pro": {
        "label": "Pro",
        "price": PLAN_PRICES["pro"],
        "scan_cap": UNLIMITED,
        "breakouts_visible": UNLIMITED,
        "bots": 30,
        "signal_bots": True,
        "strategies": 3,
        "backtest": True,
        "backtest_per_day": 10,
        "backtest_asset_cap": 2500,
        "profit_engine": True,
        "profit_runs_per_day": 2,
        "features": [
            "connect_exchange", "full_scan", "backtest", "profit_engine",
            "strategy_lab", "credits", "chat", "dashboard", "explanations", "learn",
            "profile", "settings",
        ],
    },
}

# Credit kinds and how each one maps onto a plan cap (additive).
#   metric in entitlements -> credit kind that tops it up
CREDIT_KINDS = ("breakouts", "backtest_assets", "backtest_scans", "bots", "strategies")

# Hard global ceiling on Signal Bots per user (all users, incl. admins). Applied
# as a final clamp on the computed bots cap. Per-user overrides can still LOWER a
# user below this; raising above it is disabled while this ceiling is active.
# To lift/remove later, just change/delete this single constant.
GLOBAL_BOTS_CAP = 10


def plan_for(user: Optional[dict[str, Any]]) -> str:
    """Resolve a user row to a valid plan id (admins treated as 'pro')."""
    if not user:
        return "basic"
    if user.get("role") == "admin":
        return "pro"
    plan = (user.get("plan") or "basic").lower()
    return plan if plan in PLANS else "basic"


def _add(base: Any, extra: int) -> Any:
    """Add credits to a base cap. UNLIMITED stays UNLIMITED."""
    if base is UNLIMITED:
        return UNLIMITED
    return int(base) + int(extra)


def entitlements(user: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Compute a user's *effective* limits: plan base + purchased credits +
    profit-engine unlock + role. This is the object the frontend consumes and
    the RBAC checks enforce against."""
    is_admin = bool(user and user.get("role") == "admin")
    plan = plan_for(user)
    p = PLANS[plan]
    credits = {k: int(v) for k, v in ((user or {}).get("credits") or {}).items()}
    unlocked = bool((user or {}).get("profit_engine_unlocked"))

    # Profit Engine access: Pro by default, OR the one-time $500 unlock on any tier.
    pe_access = bool(p["profit_engine"]) or unlocked or is_admin
    # Runs/day: Pro gets the plan number; unlock-only users get the Pro cadence too.
    pe_runs = p["profit_runs_per_day"] or (2 if (unlocked or is_admin) else 0)
    # Invest cap: $20k by default; the $500 unlock (or admin) removes it.
    pe_cap = UNLIMITED if (unlocked or is_admin) else PROFIT_INVEST_CAP

    # Per-user ADMIN override on the Signal-Bots create cap, stored in the
    # users.credits JSONB as "bots_limit". When set it REPLACES the plan cap
    # (and any purchased bots credits); otherwise the cap is plan base + credits.
    # Admins stay unlimited regardless (the is_admin block below forces 9999).
    bots_override = credits.get("bots_limit")
    bots_cap = (int(bots_override) if bots_override is not None
                else _add(p["bots"], credits.get("bots", 0)))

    ent = {
        "plan": plan,
        "planLabel": p["label"],
        "role": "admin" if is_admin else "user",
        "isAdmin": is_admin,
        "scanCap": p["scan_cap"],
        "breakoutsVisible": _add(p["breakouts_visible"], credits.get("breakouts", 0)),
        "bots": bots_cap,
        "signalBots": bool(p.get("signal_bots")) or is_admin,
        "strategies": _add(p["strategies"], credits.get("strategies", 0)),
        "backtest": bool(p["backtest"]) or is_admin,
        "backtestPerDay": _add(p["backtest_per_day"], credits.get("backtest_scans", 0)),
        "backtestAssetCap": _add(p["backtest_asset_cap"], credits.get("backtest_assets", 0)),
        "profitEngine": pe_access,
        "profitRunsPerDay": pe_runs,
        "profitInvestCap": pe_cap,
        "profitUnlocked": unlocked or is_admin,
        "features": list(p["features"]),
        "credits": credits,
        "loyaltyPoints": int((user or {}).get("loyalty_points") or 0),
        "subscriptionStatus": (user or {}).get("subscription_status"),
        "subscriptionPeriodEnd": (user or {}).get("subscription_period_end"),
        "onboarded": bool((user or {}).get("onboarded")),
        "badge": ("pro" if is_admin else (user or {}).get("badge")),
        "isDemo": bool((user or {}).get("is_demo")),
        "demoExpires": (user or {}).get("demo_expires"),
    }
    # Admins are unlimited across capacity caps.
    if is_admin:
        ent.update({
            "scanCap": UNLIMITED, "breakoutsVisible": UNLIMITED,
            "bots": 9999, "strategies": 9999,
            "backtestPerDay": 9999, "backtestAssetCap": 9999,
        })
    # Final global ceiling on bots for ALL users (incl. admins): min(computed, cap).
    ent["bots"] = min(ent["bots"], GLOBAL_BOTS_CAP)
    return ent


def plans_public() -> list[dict[str, Any]]:
    """Plan catalog for the pricing screen (no internal feature flags leaked)."""
    out = []
    for pid in PLAN_ORDER:
        p = PLANS[pid]
        out.append({
            "id": pid,
            "label": p["label"],
            "price": p["price"],
            "scanCap": p["scan_cap"],
            "bots": p["bots"],
            "strategies": p["strategies"],
            "backtestPerDay": p["backtest_per_day"],
            "backtestAssetCap": p["backtest_asset_cap"],
            "profitEngine": p["profit_engine"],
            "profitRunsPerDay": p["profit_runs_per_day"],
        })
    return out
