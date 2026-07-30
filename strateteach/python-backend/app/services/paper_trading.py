"""Paper-trading (demo) engine — practice the Profit Engine with virtual money.

No real exchange and no real money are involved. Given the user's virtual
capital and a fresh crypto signals scan, this sizes a handful of simulated long
positions, then marks them to market against live public prices to show honest
unrealized profit (in both quote currency and percent). It also evaluates whether
the chosen daily profit target has been reached.

Everything here is a pure function (no I/O). The endpoints in ``main.py`` own the
scan, the price fetch, and the database persistence.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

# Long, upside tiers a demo BUY can act on — mirrors the live Profit Engine.
TRADEABLE_TIERS = ("breaking_out", "near_breakout", "in_uptrend", "building")
DEFAULT_TIERS = ["breaking_out", "near_breakout"]

# How many candidate picks the recommendations popup shows at most.
PREVIEW_LIMIT = 10


def _round(v: float, n: int) -> float:
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return 0.0


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tradeable_pool(signals: List[dict], tiers: List[str]) -> List[dict]:
    """All tradeable crypto long signals in the chosen tiers, best first."""
    use_tiers = [t for t in (tiers or DEFAULT_TIERS) if t in TRADEABLE_TIERS] or list(DEFAULT_TIERS)
    return [
        s for s in (signals or [])
        if s.get("bucket") == "crypto"
        and s.get("direction") == "long"
        and s.get("tier") in use_tiers
        and float(s.get("currentPrice") or 0) > 0
    ]


def select_picks(signals: List[dict], tiers: List[str], max_positions: int) -> List[dict]:
    """Pick tradeable crypto long signals in the chosen tiers, best first."""
    n = max(1, int(max_positions or 5))
    return _tradeable_pool(signals, tiers)[:n]


def recommend_picks(signals: List[dict], tiers: List[str], max_positions: int,
                    limit: int = PREVIEW_LIMIT) -> List[dict]:
    """Candidates for the recommendations popup: at most ``limit`` picks, with the
    top ``max_positions`` (capped at ``limit``) flagged ``recommended`` (the
    strongest worth entering)."""
    n_rec = min(max(1, int(max_positions or 5)), limit)
    pool = _tradeable_pool(signals, tiers)[:limit]
    return [
        {
            "symbol": s.get("symbol"),
            "name": s.get("name"),
            "tier": s.get("tier"),
            "direction": s.get("direction"),
            "currentPrice": float(s.get("currentPrice") or 0.0),
            "recommended": i < n_rec,
            # breakout detail for the recommendation row
            "breakoutDate": s.get("breakoutDate"),
            "changeYesterdayPct": s.get("changeYesterdayPct"),
            "changeTodayPct": s.get("changeTodayPct"),
            "stillGreen": s.get("stillGreen"),
            "desc": s.get("desc"),
        }
        for i, s in enumerate(pool)
    ]


def size_positions(capital: float, picks: List[dict], opened_at: str,
                   entry_prices: Optional[dict] = None) -> List[dict]:
    """Split capital equally across picks and compute the simulated quantity.

    ``entry_prices`` (symbol -> live price) is the authoritative entry source for
    the demo path: it MUST be the same live tick the position is later marked
    against, so a freshly opened position shows exactly zero unrealized P&L at
    open (demo opens have no fees). When omitted, falls back to each pick's
    ``currentPrice`` (the daily-scan bar close, which can be hours stale).
    """
    capital = max(0.0, float(capital or 0.0))
    n = len(picks)
    if n == 0 or capital <= 0:
        return []
    per = capital / n
    out: List[dict] = []
    for s in picks:
        if entry_prices is not None:
            entry = float(entry_prices.get(s.get("symbol")) or 0.0)
        else:
            entry = float(s.get("currentPrice") or 0.0)
        if entry <= 0:
            continue
        out.append({
            "symbol": s.get("symbol"),
            "name": s.get("name"),
            "tier": s.get("tier"),
            "qty": per / entry,
            "entryPrice": entry,
            # Full-precision cost basis: qty*entry == per exactly, so a freshly
            # opened position marks at exactly zero PnL. Rounding happens at display.
            "capital": per,
            "openedAt": opened_at,
        })
    return out


def mark_to_market(positions: List[dict], prices: dict) -> dict:
    """Mark open positions to market. Returns enriched rows + portfolio totals.

    ``prices`` maps symbol -> current price; a missing symbol falls back to its
    entry price (zero PnL) so the view never invents a move.
    """
    rows: List[dict] = []
    total_cost = 0.0
    total_value = 0.0
    for p in positions:
        entry = float(p.get("entryPrice") or 0.0)
        qty = float(p.get("qty") or 0.0)
        cost = float(p.get("capital") or (entry * qty))
        cur = float((prices or {}).get(p.get("symbol")) or 0.0) or entry
        value = qty * cur
        pnl = value - cost
        pnl_pct = (pnl / cost * 100.0) if cost > 0 else 0.0
        total_cost += cost
        total_value += value
        rows.append({
            **p,
            "currentPrice": _round(cur, 6),
            "value": _round(value, 2),
            "pnl": _round(pnl, 2),
            "pnlPct": _round(pnl_pct, 2),
        })
    total_pnl = total_value - total_cost
    total_pct = (total_pnl / total_cost * 100.0) if total_cost > 0 else 0.0
    return {
        "positions": rows,
        "totalCost": _round(total_cost, 2),
        "totalValue": _round(total_value, 2),
        "totalPnl": _round(total_pnl, 2),
        "totalPnlPct": _round(total_pct, 2),
    }


def runtime_seconds(started_at: Optional[str], now: Optional[datetime] = None) -> float:
    """Elapsed seconds since the session started (0 if unknown)."""
    start = _parse_iso(started_at)
    if not start:
        return 0.0
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    cur = now or datetime.now(timezone.utc)
    return max(0.0, (cur - start).total_seconds())


def session_runtime(started_at: Optional[str], closed_at: Optional[str] = None) -> float:
    """Runtime that freezes at ``closed_at`` for a closed session, else live."""
    end = _parse_iso(closed_at) if closed_at else None
    if end and end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    return runtime_seconds(started_at, end)


def history_stats(events: List[dict]) -> dict:
    """Summarise target-hit history: count, average/best/worst time to target."""
    secs = [e["secondsToTarget"] for e in (events or []) if e.get("secondsToTarget")]
    total_profit = sum(float(e.get("profit") or 0.0) for e in (events or []))
    return {
        "count": len(events or []),
        "avgSeconds": _round(sum(secs) / len(secs), 0) if secs else None,
        "bestSeconds": _round(min(secs), 0) if secs else None,
        "worstSeconds": _round(max(secs), 0) if secs else None,
        "totalProfit": _round(total_profit, 2),
    }
