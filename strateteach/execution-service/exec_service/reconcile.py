"""Reconciliation (spec §1/§4) — requested ↔ executed, catch every drift.

Reconciliation is a READ + a classification, never a correction. It compares
what each order asked the exchange to do against what the order records as
having happened, and flags anything that doesn't line up — so a divergence is
SEEN (and audited) rather than discovered later in a balance.

Per order, one finding:

  ok             filled, executed_qty matches requested_qty within tolerance
  partial        submitted/partially_filled — less filled than requested
  overfill       executed_qty > requested_qty (should never happen; loud)
  missing_exec   'filled' but no exchange_order_id / zero executed_qty
  no_op          noop_disarmed / rejected — nothing was sent, nothing to match
  stuck          pending/submitted older than a threshold (never resolved)

Nothing here places, cancels, or amends an order. In Phase 1 every order is a
mock or a no-op, so `run()` simply proves the classification is correct and
writes a summary to the audit trail. A real reconciliation against live
exchange fills is a mainnet-era concern, gated far beyond this slice.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any, Optional

from exec_service.audit import record
from exec_service.db import connect

log = logging.getLogger("exec_service.reconcile")

# Fill tolerance: fills are fractional, so treat |requested-executed| within this
# fraction of requested as matched (rounding/venue step size, not a real drift).
DEFAULT_FILL_TOLERANCE = 0.005          # 0.5%
DEFAULT_STUCK_AFTER_SEC = 300           # a pending/submitted order older than this is "stuck"


@dataclass(frozen=True)
class Finding:
    order_id: int
    client_order_id: str
    status: str
    verdict: str            # ok | partial | overfill | missing_exec | no_op | stuck
    detail: str = ""


def _stuck_after() -> int:
    try:
        return max(30, int(os.environ.get("EXEC_RECONCILE_STUCK_AFTER_SEC", DEFAULT_STUCK_AFTER_SEC)))
    except ValueError:
        return DEFAULT_STUCK_AFTER_SEC


def classify(order: Any, *, tolerance: float = DEFAULT_FILL_TOLERANCE, stuck_after_sec: Optional[int] = None) -> str:
    """The pure verdict for one order row (a dict-like). No I/O."""
    status = str(order["status"])
    if status in ("noop_disarmed", "rejected", "cancelled"):
        return "no_op"

    req = float(order.get("requested_qty") or 0)
    exe = float(order.get("executed_qty") or 0)

    if status in ("pending", "submitted", "partially_filled"):
        # An order that never resolved: stuck if it's been sitting too long.
        age = order.get("_age_sec")
        if age is not None and float(age) > float(stuck_after_sec if stuck_after_sec is not None else _stuck_after()):
            return "stuck"
        return "partial"

    if status == "filled":
        if not order.get("exchange_order_id") or exe <= 0:
            return "missing_exec"
        if req > 0 and exe > req * (1 + tolerance):
            return "overfill"
        if req > 0 and exe < req * (1 - tolerance):
            return "partial"
        return "ok"

    if status == "failed":
        return "no_op" if exe <= 0 else "overfill"

    return "no_op"


def run(*, bot_id: Optional[int] = None, actor: str = "reconciler") -> dict:
    """Reconcile recent orders and return a summary of verdicts + any drifts.

    Read-only: computes verdicts, writes ONE audit summary line, and (only when
    something is off) an audit line per drifting order so it is on the record.
    """
    where = "WHERE bot_id = %s" if bot_id is not None else ""
    params = (bot_id,) if bot_id is not None else ()
    findings: list[Finding] = []
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT id, client_order_id, exchange_order_id, status,
                       requested_qty, executed_qty,
                       EXTRACT(EPOCH FROM (NOW() - created_at)) AS _age_sec
                  FROM exec_orders {where}
                 ORDER BY id DESC
                 LIMIT 1000
                """,
                params,
            )
            rows = cur.fetchall()

    counts: dict[str, int] = {}
    drifts: list[dict] = []
    for r in rows:
        verdict = classify(r)
        counts[verdict] = counts.get(verdict, 0) + 1
        f = Finding(order_id=int(r["id"]), client_order_id=r["client_order_id"], status=r["status"], verdict=verdict)
        findings.append(f)
        if verdict in ("overfill", "missing_exec", "stuck"):
            drifts.append({"order_id": f.order_id, "client_order_id": f.client_order_id,
                           "status": f.status, "verdict": verdict})

    # One summary line always; a per-order line for each real drift.
    record(actor=actor, action="reconcile.run", entity="exec_orders", entity_id="*",
           meta={"counts": counts, "drift_count": len(drifts), "scanned": len(rows),
                 "bot_id": bot_id})
    for d in drifts:
        record(actor=actor, action="reconcile.drift", entity="exec_orders",
               entity_id=str(d["order_id"]), meta=d)
        log.warning("reconcile drift: order %s (%s) → %s", d["order_id"], d["client_order_id"], d["verdict"])

    return {"scanned": len(rows), "counts": counts, "drifts": drifts, "ok": not drifts}
