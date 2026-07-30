"""Governance bridge to the ISOLATED execution-service database — P2.4.

The 3-of-3 approvals queue (``owner_approvals``) and the append-only
``audit_log`` live in the execution service's OWN database, deliberately
separated from this backend (spec §0.7). This module is the ONE sanctioned
boundary through which the owners' console reaches that queue, and it is
narrow on purpose:

* **Its own connection string** — ``EXEC_GOV_DATABASE_URL``. Point it at a
  Postgres user whose grants cover ONLY ``owner_approvals`` + ``audit_log``
  (the exec_owner_role boundary from migration 002), never the whole exec DB.
* **Governance records only.** Create / approve / reject / expire requests +
  audit lines. There is NO code path here that executes anything: no order,
  no key, no arming, no 'executed' transition (that belongs to the worker,
  P4+, under its own gates).
* **Dormant until configured.** The execution service is not deployed yet;
  when the env var is missing every read answers ``{"available": False}`` and
  the console shows an honest empty state. Nothing breaks, nothing pretends.
* **The database backstops the rules**: migration 003 enforces >= 3 DISTINCT
  owner approvals at the CHECK level even if this code has a bug.

Every entry point takes the acting OWNER's username — callers must have
already passed ``require_owner``.
"""
from __future__ import annotations

import logging
import os
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

logger = logging.getLogger("algo770")

#: Actions an owner may REQUEST. Deliberately a closed list — free-text actions
#: would turn the queue into an unauditable grab-bag. All are requests only;
#: nothing consumes them in this phase.
ALLOWED_ACTIONS = (
    "fund_deposit",       # הפקדה לקרן המשותפת
    "fund_withdrawal",    # משיכה מהקרן
    "arm_testnet",        # חימוש טסטנט (הגייט האמיתי נשאר בשירות + ידני)
    "policy_change",      # שינוי מדיניות/caps
    "other",
)

_TERMINAL = ("approved", "rejected", "expired", "executed")


def available() -> bool:
    return bool(os.environ.get("EXEC_GOV_DATABASE_URL"))


@contextmanager
def _conn() -> Iterator[psycopg.Connection]:
    url = os.environ.get("EXEC_GOV_DATABASE_URL")
    if not url:
        raise RuntimeError("EXEC_GOV_DATABASE_URL is not configured")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        yield conn


def _audit(cur, actor: str, action: str, entity_id: str, before: Optional[dict], after: Optional[dict], meta: Optional[dict] = None) -> None:
    """One audit line, same shape the exec service writes. Never carries secrets
    (nothing here handles any). Runs inside the caller's transaction so the
    record and its audit line commit together."""
    cur.execute(
        "INSERT INTO audit_log (actor, actor_role, action, entity, entity_id, before, after, meta) "
        "VALUES (%s, 'owner', %s, 'owner_approvals', %s, %s, %s, %s)",
        (actor, action, entity_id,
         Json(before) if before is not None else None,
         Json(after) if after is not None else None,
         Json(meta or {})),
    )


def _expire_if_due(cur, row: dict, actor: str) -> dict:
    """Lazy expiry: a pending request whose expires_at has passed flips to
    'expired' (audited) the first time anyone touches/reads it in a write path."""
    if row["status"] == "pending" and row.get("expires_at") and row["expires_at"] < datetime.now(timezone.utc):
        cur.execute("UPDATE owner_approvals SET status = 'expired' WHERE id = %s", (row["id"],))
        _audit(cur, actor, "approval.expire", row["request_ref"],
               {"status": "pending"}, {"status": "expired"})
        row = {**row, "status": "expired"}
    return row


def _shape(row: dict) -> dict:
    approvals = row.get("approvals") or []
    return {
        "ref": row["request_ref"],
        "action": row["action"],
        "payload": row.get("payload") or {},
        "requestedBy": row["requested_by"],
        "requestedAt": row["requested_at"].isoformat() if row.get("requested_at") else None,
        "expiresAt": row["expires_at"].isoformat() if row.get("expires_at") else None,
        "status": row["status"],
        "approvals": approvals,
        "approvers": sorted({(a.get("owner") or "").strip().lower() for a in approvals if (a.get("owner") or "").strip()}),
    }


def list_approvals(actor: str, limit: int = 100) -> dict:
    if not available():
        return {"available": False, "requests": []}
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM owner_approvals ORDER BY (status = 'pending') DESC, requested_at DESC LIMIT %s",
                (max(1, min(int(limit), 500)),),
            )
            rows = [_expire_if_due(cur, r, actor) for r in cur.fetchall()]
            conn.commit()
    return {"available": True, "requests": [_shape(r) for r in rows]}


def create_request(actor: str, action: str, payload: dict, expires_hours: Optional[int]) -> dict:
    if action not in ALLOWED_ACTIONS:
        raise ValueError(f"unknown action {action!r}")
    ref = f"req-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(2)}"
    expires_at = None
    if expires_hours and int(expires_hours) > 0:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=int(expires_hours))
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO owner_approvals (request_ref, action, payload, requested_by, expires_at) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING *",
                (ref, action, Json(payload or {}), actor, expires_at),
            )
            row = cur.fetchone()
            _audit(cur, actor, "approval.request", ref, None,
                   {"status": "pending", "action": action}, {"payload": payload or {}})
            conn.commit()
    return _shape(row)


def approve(actor: str, ref: str, note: str = "") -> dict:
    """Append the acting owner's approval. One voice per owner (re-approving is a
    409-style error). Three DISTINCT owners → status 'approved' (the DB CHECK from
    migration 003 backstops both counts). Approval NEVER executes anything."""
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM owner_approvals WHERE request_ref = %s FOR UPDATE", (ref,))
            row = cur.fetchone()
            if not row:
                raise LookupError("request not found")
            row = _expire_if_due(cur, row, actor)
            if row["status"] != "pending":
                raise PermissionError(f"request is {row['status']} — no further approvals")
            approvals = list(row.get("approvals") or [])
            me = actor.strip().lower()
            if any((a.get("owner") or "").strip().lower() == me for a in approvals):
                raise PermissionError("already approved by this owner")
            approvals.append({"owner": actor, "at": datetime.now(timezone.utc).isoformat(), "note": note or ""})
            distinct = {(a.get("owner") or "").strip().lower() for a in approvals if (a.get("owner") or "").strip()}
            new_status = "approved" if len(distinct) >= 3 and len(approvals) >= 3 else "pending"
            cur.execute(
                "UPDATE owner_approvals SET approvals = %s, status = %s WHERE id = %s RETURNING *",
                (Json(approvals), new_status, row["id"]),
            )
            updated = cur.fetchone()
            _audit(cur, actor, "approval.approve", ref,
                   {"status": row["status"], "approvals": len(approvals) - 1},
                   {"status": new_status, "approvals": len(approvals)}, {"note": note or ""})
            conn.commit()
    return _shape(updated)


def reject(actor: str, ref: str, note: str = "") -> dict:
    """3-of-3 is UNANIMOUS: one owner's rejection closes the request."""
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM owner_approvals WHERE request_ref = %s FOR UPDATE", (ref,))
            row = cur.fetchone()
            if not row:
                raise LookupError("request not found")
            row = _expire_if_due(cur, row, actor)
            if row["status"] != "pending":
                raise PermissionError(f"request is {row['status']} — cannot reject")
            cur.execute("UPDATE owner_approvals SET status = 'rejected' WHERE id = %s RETURNING *", (row["id"],))
            updated = cur.fetchone()
            _audit(cur, actor, "approval.reject", ref,
                   {"status": "pending"}, {"status": "rejected"}, {"note": note or ""})
            conn.commit()
    return _shape(updated)
