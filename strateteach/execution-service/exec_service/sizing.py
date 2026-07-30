"""Sizing + caps (spec §4) — PURE decisions, fail-closed. No I/O in the math.

The signal never carries a quantity (envelope-only); the ORDER SIZE comes from
the bot's server-side config, and every cap is enforced HERE, before anything
could reach an adapter:

  per-order   fixed_notional must fit max_order_notional  (schema also CHECKs)
  daily       today's used notional + this order must fit daily_notional_cap
  positions   open orders must stay below max_open_positions

Every violation is a REJECTION with a stable reason slug — never a clamp,
never a "best effort" resize. A money system does exactly what its config
says or nothing at all.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class SizingDecision:
    ok: bool
    reason: str            # 'ok' | 'per_order_cap' | 'daily_cap' | 'max_positions' | 'bad_config'
    detail: str = ""
    notional: float = 0.0  # the order notional (USD) when ok


def decide(bot: Mapping[str, Any], *, used_today_notional: float, open_positions: int) -> SizingDecision:
    """One order-sizing decision from the bot's CONFIG row + current usage.

    Callers supply the usage numbers (read from exec_orders); this function is
    deliberately pure so the caps math is trivially testable and reviewable.
    Anything malformed reads as a rejection (fail-closed), never a default.
    """
    try:
        fixed = float(bot["fixed_notional"])
        per_order_cap = float(bot["max_order_notional"])
        daily_cap = float(bot["daily_notional_cap"])
        max_positions = int(bot["max_open_positions"])
    except (KeyError, TypeError, ValueError) as e:
        return SizingDecision(ok=False, reason="bad_config", detail=f"unreadable bot config: {e}")

    if fixed <= 0 or per_order_cap <= 0 or daily_cap <= 0 or max_positions <= 0:
        return SizingDecision(ok=False, reason="bad_config", detail="caps must be positive")

    if fixed > per_order_cap:
        return SizingDecision(ok=False, reason="per_order_cap",
                              detail=f"order {fixed} exceeds per-order cap {per_order_cap}")

    used = max(0.0, float(used_today_notional or 0.0))
    if used + fixed > daily_cap:
        return SizingDecision(ok=False, reason="daily_cap",
                              detail=f"used {used} + order {fixed} exceeds daily cap {daily_cap}")

    if int(open_positions or 0) >= max_positions:
        return SizingDecision(ok=False, reason="max_positions",
                              detail=f"{open_positions} open >= max {max_positions}")

    return SizingDecision(ok=True, reason="ok", notional=fixed)
