"""Management console (SheraCore pattern) — P2.2, READ-ONLY.

The owners' console shell reads projects + scoped roles + access layers in ONE
call. Nothing here writes, grants, or touches money/execution:

* Granting a scope stays an OWNER'S CLICK in the Team panel (a later slice) —
  there is deliberately no POST/PUT here yet.
* The 3-of-3 approvals queue lives in the ISOLATED execution-service database;
  this backend cannot reach it (separate DATABASE_URL on purpose, spec §0.7).
  The console's Approvals tab shows an honest empty state until P2.4 wires it
  through a proper boundary.

Mounted under /auth/* like every owner surface (Caddy proxies a fixed prefix
allowlist — see pm.py).
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import database as db
from app.core.security import require_owner
from app.services import exec_gov

logger = logging.getLogger("algo770")

router = APIRouter(tags=["mgmt"])


@router.get("/auth/mgmt/console")
def mgmt_console(_: str = Depends(require_owner)):
    """Everything the console shell renders, in one read.

    projects — the first-class projects (P2.1 schema) with their scoped members.
    team     — every login with its derived access layer (the user_access_layers
               view, single source of truth) + any project scopes.
    """
    return db.mgmt_console_data()


# ── 3-of-3 approvals (P2.4) — governance records ONLY, owners only ────────────
# Backed by the isolated execution-service DB through the narrow exec_gov bridge.
# Nothing here executes: approving a request changes a status row + audit line.
# The worker (P4+) is the only thing that will ever CONSUME an approved request,
# under its own gates. When the exec DB isn't configured (today's production),
# reads answer {available:false} and the console shows an honest empty state.

class ApprovalCreate(BaseModel):
    action: str
    payload: Optional[dict] = None
    expiresHours: Optional[int] = 72


class ApprovalNote(BaseModel):
    note: Optional[str] = ""


def _gov_errors(fn):
    """Map bridge errors to honest HTTP codes (404 / 409 / 503)."""
    def run(*a, **k):
        try:
            return fn(*a, **k)
        except LookupError as e:
            raise HTTPException(status_code=404, detail=str(e))
        except PermissionError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))
        except Exception as e:  # noqa: BLE001 — exec DB unreachable etc.
            logger.exception("exec_gov failure")
            raise HTTPException(status_code=503, detail=f"approvals store unavailable: {e}")
    return run


@router.get("/auth/mgmt/approvals")
def mgmt_approvals(username: str = Depends(require_owner)):
    if not exec_gov.available():
        return {"available": False, "requests": [], "actions": list(exec_gov.ALLOWED_ACTIONS)}
    data = _gov_errors(exec_gov.list_approvals)(username)
    data["actions"] = list(exec_gov.ALLOWED_ACTIONS)
    return data


@router.post("/auth/mgmt/approvals")
def mgmt_approval_create(body: ApprovalCreate, username: str = Depends(require_owner)):
    return {"request": _gov_errors(exec_gov.create_request)(username, body.action, body.payload or {}, body.expiresHours)}


@router.post("/auth/mgmt/approvals/{ref}/approve")
def mgmt_approval_approve(ref: str, body: ApprovalNote, username: str = Depends(require_owner)):
    return {"request": _gov_errors(exec_gov.approve)(username, ref, body.note or "")}


@router.post("/auth/mgmt/approvals/{ref}/reject")
def mgmt_approval_reject(ref: str, body: ApprovalNote, username: str = Depends(require_owner)):
    return {"request": _gov_errors(exec_gov.reject)(username, ref, body.note or "")}


# ── Compliance switches (owner-only) — BTC-only + client-autopilot freeze ─────
# Both are runtime-flippable. BTC-only defaults OFF (no change until enabled);
# the autopilot freeze defaults ON (the risky client path stays closed). Owners
# are always exempt from both, so flipping them never affects owner testing.

class ComplianceToggle(BaseModel):
    btcOnly: Optional[bool] = None
    clientAutopilotFrozen: Optional[bool] = None


class ScopeGrant(BaseModel):
    username: str
    projectId: int
    scopeRole: str  # operator | editor | viewer


@router.post("/auth/mgmt/scope")
def mgmt_scope_grant(body: ScopeGrant, username: str = Depends(require_owner)):
    """Scope a user to a project (owner action). Returns the fresh console data."""
    try:
        db.grant_role_scope(body.username, int(body.projectId), body.scopeRole, username)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return db.mgmt_console_data()


@router.delete("/auth/mgmt/scope")
def mgmt_scope_revoke(username_q: str, project_id: int, _: str = Depends(require_owner)):
    db.revoke_role_scope(username_q, int(project_id))
    return db.mgmt_console_data()


@router.get("/auth/mgmt/compliance")
def mgmt_compliance(_: str = Depends(require_owner)):
    return {
        "btcOnly": db.get_btc_only(),
        "clientAutopilotFrozen": db.get_client_autopilot_frozen(),
    }


@router.post("/auth/mgmt/compliance")
def mgmt_compliance_set(body: ComplianceToggle, username: str = Depends(require_owner)):
    if body.btcOnly is not None:
        db.set_btc_only(bool(body.btcOnly))
    if body.clientAutopilotFrozen is not None:
        db.set_client_autopilot_frozen(bool(body.clientAutopilotFrozen))
    return {
        "btcOnly": db.get_btc_only(),
        "clientAutopilotFrozen": db.get_client_autopilot_frozen(),
    }
