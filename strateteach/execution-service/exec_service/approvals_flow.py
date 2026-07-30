"""3-of-3 approval FLOW on the owners' fund (spec §5). OWNER-ONLY, records only.

The flow, exactly as the spec states it:

    request (owner) → 3 explicit approvals from 3 DISTINCT owners →
    time window → [would execute via the worker] → audit

In Phase 1 the last step is NOT taken: reaching 'approved' records the unanimous
decision and stops. There is NO call from here into the worker, the queue, or
any exchange path — arming the fund and executing on owner capital is a
deliberate, later, owner-driven act, never something this code performs.

Everything is enforced twice: this module checks the rules, and the database
CHECK (migration 003) independently refuses to let a row reach 'approved' /
'executed' without ≥ 3 approvals from ≥ 3 distinct owners. Belt and braces,
because this is the gate on real money.

This mirrors the backend's exec_gov bridge (the owners' console UI) — but here
inside the isolated service, against its own owner_approvals table, so the two
stay consistent when they are wired together.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from psycopg.types.json import Json

from exec_service.audit import record
from exec_service.db import connect

log = logging.getLogger("exec_service.approvals_flow")

# Actions an owner may request on the fund. Closed list — an unbounded action
# space would make the queue unauditable. All are requests only in Phase 1.
FUND_ACTIONS = ("fund_deposit", "fund_withdrawal", "fund_trade", "arm_fund")


def request(action: str, payload: dict, *, requested_by: str, expires_hours: int = 72) -> dict:
    if action not in FUND_ACTIONS:
        raise ValueError(f"unknown fund action {action!r}")
    ref = f"fund-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(2)}"
    expires_at = datetime.now(timezone.utc) + timedelta(hours=max(1, int(expires_hours)))
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO owner_approvals (request_ref, action, payload, requested_by, expires_at) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING *",
                (ref, action, Json(payload or {}), requested_by, expires_at),
            )
            row = cur.fetchone()
            conn.commit()
    record(actor=requested_by, action="fund.request", entity="owner_approvals", entity_id=ref,
           after={"status": "pending", "action": action})
    return _shape(row)


def approve(ref: str, owner: str, *, note: str = "") -> dict:
    """Append one owner's approval. One voice per owner. Three DISTINCT owners →
    'approved' (recorded, NOT executed). The DB CHECK backstops both counts."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM owner_approvals WHERE request_ref = %s FOR UPDATE", (ref,))
            row = cur.fetchone()
            if not row:
                raise LookupError("request not found")
            row = _expire_if_due(cur, row, owner)
            if row["status"] != "pending":
                raise PermissionError(f"request is {row['status']} — no further approvals")
            approvals = list(row.get("approvals") or [])
            me = owner.strip().lower()
            if any((a.get("owner") or "").strip().lower() == me for a in approvals):
                raise PermissionError("already approved by this owner")
            approvals.append({"owner": owner, "at": datetime.now(timezone.utc).isoformat(), "note": note or ""})
            distinct = {(a.get("owner") or "").strip().lower() for a in approvals if (a.get("owner") or "").strip()}
            # 'approved' means UNANIMOUS DECISION RECORDED — NOT executed. Phase 1
            # never advances a row to 'executed'; that belongs to a gated, later act.
            new_status = "approved" if len(distinct) >= 3 and len(approvals) >= 3 else "pending"
            cur.execute(
                "UPDATE owner_approvals SET approvals = %s, status = %s WHERE id = %s RETURNING *",
                (Json(approvals), new_status, row["id"]),
            )
            updated = cur.fetchone()
            conn.commit()
    record(actor=owner, action="fund.approve", entity="owner_approvals", entity_id=ref,
           after={"status": new_status, "approvals": len(approvals)}, meta={"note": note or ""})
    if new_status == "approved":
        log.info("fund request %s reached 3-of-3 (RECORDED, not executed)", ref)
    return _shape(updated)


def reject(ref: str, owner: str, *, note: str = "") -> dict:
    """3-of-3 is unanimous — one owner's rejection closes the request."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM owner_approvals WHERE request_ref = %s FOR UPDATE", (ref,))
            row = cur.fetchone()
            if not row:
                raise LookupError("request not found")
            row = _expire_if_due(cur, row, owner)
            if row["status"] != "pending":
                raise PermissionError(f"request is {row['status']} — cannot reject")
            cur.execute("UPDATE owner_approvals SET status = 'rejected' WHERE id = %s RETURNING *", (row["id"],))
            updated = cur.fetchone()
            conn.commit()
    record(actor=owner, action="fund.reject", entity="owner_approvals", entity_id=ref,
           after={"status": "rejected"}, meta={"note": note or ""})
    return _shape(updated)


def _expire_if_due(cur, row: dict, actor: str) -> dict:
    if row["status"] == "pending" and row.get("expires_at") and row["expires_at"] < datetime.now(timezone.utc):
        cur.execute("UPDATE owner_approvals SET status = 'expired' WHERE id = %s", (row["id"],))
        record(actor=actor, action="fund.expire", entity="owner_approvals", entity_id=row["request_ref"],
               after={"status": "expired"})
        return {**row, "status": "expired"}
    return row


def _shape(row: dict) -> dict:
    approvals = row.get("approvals") or []
    return {
        "ref": row["request_ref"], "action": row["action"], "payload": row.get("payload") or {},
        "requestedBy": row["requested_by"], "status": row["status"],
        "approvals": approvals,
        "approvers": sorted({(a.get("owner") or "").strip().lower() for a in approvals if (a.get("owner") or "").strip()}),
        "expiresAt": row["expires_at"].isoformat() if row.get("expires_at") else None,
    }
