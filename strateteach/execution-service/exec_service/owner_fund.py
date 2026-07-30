"""Owners' shared fund — ledger → ownership % → NAV (spec §5). OWNER-ONLY.

One shared fund for the three owners (Dan / Rafi / Yoav), not an account each.
This module keeps the ledger and derives each owner's proportional stake and
the fund NAV. It is completely separated from client money and from the demo
AutoPilots (spec §0.7), and — like the whole owner_fund table — invisible to
the execution operator (the DB grants + access.py enforce that; this module
adds no path around them).

What this slice does:
* append ledger entries (deposit / withdrawal / pnl / fee / adjustment);
* compute ownership % from net contributed capital per owner;
* compute NAV = contributed net ± pnl/fees.

What it deliberately does NOT do:
* move any money — every entry is a RECORD an owner made, audited;
* execute anything on the fund — that is the 3-of-3 flow (approvals_flow.py),
  and even there Phase 1 only records the decision. No trade, ever, here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from exec_service.audit import record
from exec_service.db import connect

log = logging.getLogger("exec_service.owner_fund")

CONTRIB_TYPES = ("deposit", "withdrawal")   # affect an owner's contributed capital
PNL_TYPES = ("pnl", "fee", "adjustment")    # affect NAV but not ownership base


@dataclass(frozen=True)
class FundView:
    nav_usd: float
    contributed_net: float
    pnl_net: float
    by_owner: dict          # owner -> {contributed, ownership_pct}


def add_entry(owner: str, entry_type: str, amount_usd: float, *, created_by: str, note: str = "") -> int:
    """Append ONE ledger entry (a record, not a movement). Amount sign follows
    the type: deposits/pnl are positive, withdrawals/fees are entered positive
    and subtracted in the math. Returns the ledger row id."""
    if entry_type not in CONTRIB_TYPES + PNL_TYPES:
        raise ValueError(f"unknown entry_type {entry_type!r}")
    if amount_usd <= 0:
        raise ValueError("amount_usd must be positive; the type carries the direction")
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO owner_fund (owner, entry_type, amount_usd, note, created_by) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (owner, entry_type, amount_usd, note, created_by),
            )
            row_id = int(cur.fetchone()["id"])
            conn.commit()
    record(actor=created_by, action="fund.entry", entity="owner_fund", entity_id=str(row_id),
           after={"owner": owner, "type": entry_type, "amount": amount_usd}, meta={"note": note})
    return row_id


def _signed(entry_type: str, amount: float) -> float:
    if entry_type in ("withdrawal", "fee"):
        return -abs(amount)
    return abs(amount)


def view() -> FundView:
    """Derive the fund snapshot from the ledger. Pure read.

    ownership % = an owner's NET contributed capital / total net contributed.
    NAV = total net contributed + net pnl/fees/adjustments.
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT owner, entry_type, amount_usd FROM owner_fund")
            rows = cur.fetchall()

    contributed: dict[str, float] = {}
    pnl_net = 0.0
    for r in rows:
        amt = _signed(r["entry_type"], float(r["amount_usd"]))
        if r["entry_type"] in CONTRIB_TYPES:
            contributed[r["owner"]] = round(contributed.get(r["owner"], 0.0) + amt, 2)
        else:
            pnl_net = round(pnl_net + amt, 2)

    total_contrib = round(sum(contributed.values()), 2)
    by_owner: dict[str, dict] = {}
    for owner, c in contributed.items():
        pct = round((c / total_contrib) * 100, 6) if total_contrib > 0 else 0.0
        by_owner[owner] = {"contributed": round(c, 2), "ownership_pct": pct}

    nav = round(total_contrib + pnl_net, 2)
    return FundView(nav_usd=nav, contributed_net=total_contrib, pnl_net=pnl_net, by_owner=by_owner)
