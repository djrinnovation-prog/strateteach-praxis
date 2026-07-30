"""Profit Engine — turns daily scanner signals into a semi-automatic trade plan.

Given the user's profit-engine config (target mode + amount, tier filter, and how
much of the balance to deploy) plus a fresh signals scan and the free quote
balance, this builds a list of suggested crypto BUY orders sized from the
deployable balance. Each item carries a take-profit price computed so that — IF
every position reaches its target — the chosen daily/weekly profit target is met.

Nothing in this module moves money. It only proposes a plan; the user confirms
each order through the PIN-gated ``/exchange/order`` endpoint. Returns are never
guaranteed: ``requiredMovePct`` is exactly the price move each position must make
to hit its take-profit, surfaced honestly rather than promised.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List

# Long, upside tiers that can be acted on with a spot BUY. Short/neutral tiers
# are never tradeable on the connected spot exchanges.
TRADEABLE_TIERS = ("breaking_out", "near_breakout", "in_uptrend", "building")
DEFAULT_TIERS = ["breaking_out", "near_breakout"]


def _round(v: float, n: int) -> float:
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return 0.0


def build_plan(config: dict, free_quote: float, quote: str,
               signals: List[dict]) -> dict:
    """Build a semi-automatic trade plan from a scan. Pure function (no I/O)."""
    tiers = [t for t in (config.get("tiers") or DEFAULT_TIERS) if t in TRADEABLE_TIERS]
    if not tiers:
        tiers = list(DEFAULT_TIERS)
    max_positions = max(1, int(config.get("maxPositions") or 5))
    deploy_pct = max(0.0, min(100.0, float(config.get("deployPct") or 50.0)))
    pct_mode = bool(config.get("profitPctEnabled"))
    profit_pct = max(0.0, float(config.get("profitPctPerPosition") or 5.0))
    mode = "percent" if pct_mode else (config.get("targetMode") or "daily")
    target = float(
        config.get("dailyTarget") if mode == "daily" else config.get("weeklyTarget")
        or 0.0
    )

    picks = [
        s for s in (signals or [])
        if s.get("bucket") == "crypto"
        and s.get("direction") == "long"
        and s.get("tier") in tiers
    ][:max_positions]

    free_quote = max(0.0, float(free_quote or 0.0))
    # A fixed invest amount (if set) overrides balance×deploy% — lets the engine
    # build a plan without (or regardless of) the live exchange balance.
    invest_amount = max(0.0, float(config.get("investAmount") or 0.0))
    deployable = invest_amount if invest_amount > 0 else (free_quote * deploy_pct / 100.0)
    n = len(picks)

    items: List[dict] = []
    if n > 0 and deployable > 0:
        capital_per_trade = deployable / n
        buy_pct = deploy_pct / n  # percent of free quote balance per BUY order
        if pct_mode:
            # Per-position take-profit: each pick targets the same % move, so the
            # money target is whatever that % yields on the deployed capital.
            move_pct = profit_pct
            profit_per_trade = capital_per_trade * profit_pct / 100.0
        else:
            profit_per_trade = (target / n) if target > 0 else 0.0
            move_pct = (profit_per_trade / capital_per_trade * 100.0) if capital_per_trade > 0 else 0.0
        for s in picks:
            entry = float(s.get("currentPrice") or 0.0)
            qty = (capital_per_trade / entry) if entry > 0 else 0.0
            tp_price = entry * (1 + move_pct / 100.0) if entry > 0 else 0.0
            items.append({
                "symbol": s.get("symbol"),
                "name": s.get("name"),
                "tier": s.get("tier"),
                "entryPrice": _round(entry, 6),
                "suggestedQty": _round(qty, 8),
                "capitalPerTrade": _round(capital_per_trade, 2),
                "buyPct": _round(buy_pct, 4),
                "takeProfitPrice": _round(tp_price, 6),
                "requiredMovePct": _round(move_pct, 2),
                "expectedProfit": _round(profit_per_trade, 2),
            })

    total_expected = _round(sum(i["expectedProfit"] for i in items), 2)
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "profitPctMode": pct_mode,
        "profitPct": _round(profit_pct, 2) if pct_mode else None,
        "target": total_expected if pct_mode else _round(target, 2),
        "quote": quote,
        "freeQuote": _round(free_quote, 2),
        "deployPct": deploy_pct,
        "deployable": _round(deployable, 2),
        "candidates": n,
        "nTrades": len(items),
        "totalExpectedProfit": total_expected,
        "tiers": tiers,
        "items": items,
    }
