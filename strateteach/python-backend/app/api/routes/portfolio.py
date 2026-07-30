"""Portfolio activity feed. Demo activity is public; live activity is gated
behind the exchange protection code (PIN), like every other live read.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header

from app import database as db
from app.core.security import current_user
from app.services import exchange as ex

router = APIRouter(tags=["portfolio"])


@router.get("/portfolio/activity")
async def portfolio_activity(
    limit: int = 1000,
    mode: Optional[str] = None,
    x_exchange_pin: Optional[str] = Header(None, alias="X-Exchange-Pin"),
    x_exchange_key: Optional[str] = Header(None, alias="X-Exchange-Key"),
    user: str = Depends(current_user),
):
    # Demo activity is virtual-money only and stays open. Live activity exposes
    # real order details, so — like every other live /exchange/* read — it is
    # gated behind the protection code. Without a valid PIN we return demo
    # activity only and flag that live data is locked.
    lim = max(1, min(2000, int(limit or 1000)))
    stored = db.get_exchange_pin_hash(user)
    # Live activity is the user's own order log (already behind login). Unlock it the
    # same way as balance/positions: open if no PIN is set, OR the browser is holding
    # its own keys (non-custodial header creds), OR a valid PIN is supplied.
    pin_ok = (not stored) or bool(x_exchange_key) or bool(x_exchange_pin and ex.verify_pin(x_exchange_pin, stored))
    m = mode if mode in ("demo", "live") else None
    if not pin_ok:
        if m == "live":
            return {"events": [], "liveLocked": True}
        return {"events": db.list_activity(limit=lim, mode="demo"), "liveLocked": True}
    # LIVE activity is scoped to the authenticated user so one user never sees
    # another's live orders. DEMO activity is public (virtual money) and unscoped.
    # Live P&L is NET of Binance fees: use the shared exchange config (server-side read, like the
    # other backend loops) so the column can be enriched with real fees. None → GROSS fallback.
    cfg = None
    try:
        cfg = db.get_exchange_config()
    except Exception:  # noqa: BLE001
        cfg = None
    if m == "live":
        return {"events": _with_live_pnl(db.list_activity(limit=lim, mode="live", username=user), user, cfg), "liveLocked": False}
    if m == "demo":
        return {"events": db.list_activity(limit=lim, mode="demo"), "liveLocked": False}
    # Mixed feed (no mode): this user's live orders + public demo events, newest first.
    events = db.list_activity(limit=lim, mode="demo") + _with_live_pnl(db.list_activity(limit=lim, mode="live", username=user), user, cfg)
    events.sort(key=lambda e: e.get("id") or 0, reverse=True)
    return {"events": events[:lim], "liveLocked": False}


def _with_live_pnl(events: list, user: str, cfg: "Optional[dict]" = None) -> list:
    """Stamp REALIZED gain/loss (NET of Binance fees) onto each live SELL row so the live trades
    table's P&L column is populated (was "—" — live orders are logged without a per-order P&L).
    Read-only: realized_pnl_by_order over this user's own order log (sell-aware moving-average),
    with real per-order fees attached (fetch_my_trades, cached ~5min). Buys keep pnl=None ("—").
    Falls back to GROSS if the exchange has no fee data."""
    try:
        orders = [e for e in events if e.get("kind") == "order"]
        if cfg:
            try:
                from app.services import live_reconcile
                live_reconcile.enrich_orders_with_fees(user, cfg, orders)   # net (best-effort)
            except Exception:  # noqa: BLE001
                pass
        pnl_by_id = ex.realized_pnl_by_order(orders)
        if not pnl_by_id:
            return events
        return [({**e, "pnl": pnl_by_id[e["id"]]} if e.get("id") in pnl_by_id else e) for e in events]
    except Exception:  # noqa: BLE001 — the feed must render even if the P&L calc hiccups
        return events
