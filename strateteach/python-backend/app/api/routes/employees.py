"""Employee Management — owner-only management surface (Phase 1, piece 2).

Owners view the team as employee cards and edit each employee: role / work-domains / status /
monthly salary / bonus-account / has-portal, plus the per-employee PAYMENTS ledger (records
only — NO real money movement) and a read-only view of their PM tasks. Everything here is
gated by ``require_owner`` (Dan / Rafi / Yoav). The employee SELF-EDIT surface (birthday /
contact / sub-account / wallet + view-payments) lands in piece 4.

All routes live under ``/auth/*`` so the production Caddy already proxies them (no Caddyfile
change), same pattern as the finance + team-role endpoints.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user, require_owner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["employees"])

# Employees that map to an existing collaborator portal → a direct link on their card.
_PORTAL_BY_PARTNER = {"raz": "legal", "oren": "it", "raful": "biz"}

# Owner-editable fields (the employee self-edits birthday/contact/sub-account/wallet elsewhere).
_OWNER_FIELDS = {"fullName", "role", "workDomains", "status", "monthlySalary", "bonusAccount",
                 "hasPortal", "joinDate", "bonusProgramStatus", "tradingPnl"}


# ── onboarding link tokens (login-free, like the report-view tokens) ───────────
def _mint_onboard_token(username: str, ttl_days: int = 30) -> str:
    tok = secrets.token_urlsafe(20)
    exp = (datetime.now(timezone.utc) + timedelta(days=ttl_days)).isoformat()
    db._set_singleton(f"onboard:{tok}", json.dumps({"u": username, "exp": exp}))
    return tok


def _onboard_username(tok: "Optional[str]") -> "Optional[str]":
    if not tok:
        return None
    raw = db._get_singleton(f"onboard:{tok}", None)
    if not raw:
        return None
    try:
        d = json.loads(raw)
        if datetime.fromisoformat(d["exp"]) <= datetime.now(timezone.utc):
            return None
        return d.get("u")
    except Exception:  # noqa: BLE001
        return None


def _employee_tasks(username: str) -> list:
    """Their PM tasks — via list_pm_tasks_assigned_to when the username resolves to a PM partner
    (dan/rafi/yoav/oren/raz), else the general assignee match so every employee shows something."""
    pid = db.partner_for_username(username)
    return db.list_pm_tasks_assigned_to(pid) if pid else db.list_pm_tasks_for(username)


def _portal_domain(username: str) -> Optional[str]:
    return _PORTAL_BY_PARTNER.get(db.partner_for_username(username) or "")


def _card(emp: dict) -> dict:
    """Grid-card shape: the employee + display name/avatar + payments summary + task count +
    an optional existing-portal link."""
    uname = emp.get("username") or ""
    user = db.get_user(uname) or {}
    return {
        **emp,
        "name": emp.get("fullName") or db.display_name(uname),
        "avatar": user.get("avatar") or "",
        "payments": db.employee_payment_summary(uname),
        "program": db.bonus_program_summary(uname),
        "taskCount": len(_employee_tasks(uname)),
        "portalDomain": _portal_domain(uname),
    }


# ── input models ──────────────────────────────────────────────────────────────
class EmployeeUpdate(BaseModel):
    fullName: Optional[str] = None
    role: Optional[str] = None
    workDomains: Optional[list] = None
    status: Optional[str] = None
    monthlySalary: Optional[float] = None
    bonusAccount: Optional[bool] = None
    hasPortal: Optional[bool] = None
    joinDate: Optional[str] = None
    bonusProgramStatus: Optional[str] = None   # none | requested | active | paused
    tradingPnl: Optional[float] = None         # manual owner-entered P&L figure (piece 3)


class EmployeeCreate(BaseModel):
    username: str
    fullName: str = ""
    role: str = ""
    workDomains: Optional[list] = None
    monthlySalary: Optional[float] = None
    createPortal: bool = False
    joinDate: Optional[str] = None


class PaymentInput(BaseModel):
    type: Optional[str] = None          # salary | bonus | expense | addition
    amount: Optional[float] = None
    currency: Optional[str] = None
    date: Optional[str] = None
    status: Optional[str] = None        # paid | pending
    note: Optional[str] = None


# ── owner-side endpoints ────────────────────────────────────────────────────────
@router.get("/auth/employees")
def list_employees(_: str = Depends(require_owner)):
    """The employee grid — every team member as a card with summary + task count."""
    return {"employees": [_card(e) for e in db.list_employees()]}


@router.post("/auth/employees")
def create_employee(body: EmployeeCreate, request: Request, actor: str = Depends(require_owner)):
    """Add a new employee (onboarding). Creates the row (status='onboarding'), optionally flags
    'has portal', and mints a login-free ONBOARDING LINK to the welcome/explanation screen."""
    uname = (body.username or "").strip().lower()
    if not uname:
        raise HTTPException(400, "A username is required.")
    fields: dict = {"fullName": body.fullName, "role": body.role, "status": "onboarding"}
    if body.workDomains is not None:
        fields["workDomains"] = body.workDomains
    if body.monthlySalary is not None:
        fields["monthlySalary"] = body.monthlySalary
    if body.joinDate:
        fields["joinDate"] = body.joinDate
    if body.createPortal:
        fields["hasPortal"] = True
    emp = db.create_employee(uname, fields, created_by=actor)
    tok = _mint_onboard_token(uname)
    base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
    logger.info("employee.create %s by=%s portal=%s", uname, actor, body.createPortal)
    return {"employee": _card(emp) if emp else None, "onboardToken": tok, "onboardUrl": f"{base}/?onboard={tok}"}


@router.get("/auth/employees/{username}")
def get_employee(username: str, _: str = Depends(require_owner)):
    """One employee's full detail + their payments ledger + their PM tasks (read-only view)."""
    emp = db.get_employee(username)
    if not emp:
        raise HTTPException(404, "No such employee.")
    return {"employee": _card(emp),
            "payments": db.list_employee_payments(username),
            "tasks": _employee_tasks(username)}


@router.post("/auth/employees/{username}")
def update_employee(username: str, body: EmployeeUpdate, actor: str = Depends(require_owner)):
    """Edit an employee's OWNER-managed fields (role/domains/status/salary/bonus/portal/join)."""
    if not db.get_employee(username):
        raise HTTPException(404, "No such employee.")
    fields = {k: v for k, v in body.model_dump(exclude_none=True).items() if k in _OWNER_FIELDS}
    emp = db.update_employee(username, fields, updated_by=actor)
    logger.info("employee.update %s by=%s fields=%s", username, actor, list(fields.keys()))
    return {"employee": _card(emp) if emp else None}


@router.delete("/auth/employees/{username}")
def delete_employee(username: str, actor: str = Depends(require_owner)):
    """Delete an employee record + its payments ledger. Owner-only. The founder / main admin is
    GUARDED from deletion (same protection as user management), so the seeded 'admin' can't be
    removed. The linked owners'-loan finance record stays in Finance (managed there)."""
    if not db.get_employee(username):
        raise HTTPException(404, "No such employee.")
    # Guard the founder: the main-admin flag (prod) OR the seeded 'admin' username directly (robust
    # even on a fresh DB where the is_main migration ran before the admin row existed).
    if db.is_main_admin(username) or (username or "").strip().lower() == "admin":
        raise HTTPException(403, "The founder / main admin can't be deleted.")
    db.delete_employee(username)
    logger.info("employee.delete %s by=%s", username, actor)
    return {"ok": True}


class DepositInput(BaseModel):
    amount: float = 0
    date: Optional[str] = None


@router.post("/auth/employees/{username}/program/deposit")
def record_deposit(username: str, body: DepositInput, actor: str = Depends(require_owner)):
    """Record the program's INITIAL DEPOSIT as an 'הלוואת בעלים / owners' loan' Finance record
    (finance_investments, purpose='owner_loan') linked to the employee — so it flows into the
    owners' budget via the Phase-2 investment aggregation. Records only; no money moves. Updates
    the linked investment if one already exists (no duplicate), and activates the program."""
    emp = db.get_employee(username)
    if not emp:
        raise HTTPException(404, "No such employee.")
    amt = float(body.amount or 0)
    if amt <= 0:
        raise HTTPException(400, "A deposit amount is required.")
    name = emp.get("fullName") or db.display_name(username)
    inv_fields = {"amount": amt, "kind": "initial", "purpose": "owner_loan",
                  "source": f"Bonus program — {name}", "date": body.date or "", "owner": ""}
    inv = None
    if emp.get("depositInvestmentId"):
        inv = db.update_finance_investment(emp["depositInvestmentId"], inv_fields, actor)  # None if it was deleted
    if not inv:
        inv = db.create_finance_investment(inv_fields, actor)
    db.set_employee_deposit(username, amt, inv.get("id"), actor)
    if (emp.get("bonusProgramStatus") or "none") not in ("active", "paused"):
        db.update_employee(username, {"bonusProgramStatus": "active"}, actor)
    logger.info("employee.program.deposit %s amount=%s inv=%s by=%s", username, amt, inv.get("id"), actor)
    return {"employee": _card(db.get_employee(username)), "investmentId": inv.get("id")}


@router.post("/auth/employees/{username}/payments")
def add_payment(username: str, body: PaymentInput, actor: str = Depends(require_owner)):
    """Record a payment on an employee's ledger (records only — owner approval, no money moves)."""
    if not db.get_employee(username):
        raise HTTPException(404, "No such employee.")
    fields = body.model_dump(exclude_none=True)
    fields["username"] = username
    pay = db.add_employee_payment(fields, created_by=actor)
    logger.info("employee.payment.add %s type=%s amount=%s by=%s", username, pay.get("type"), pay.get("amount"), actor)
    return {"payment": pay}


# Payment update/delete use a separate /auth/employee-payments/* prefix so a payment id can never
# collide with the /auth/employees/{username} route (username="payments").
@router.post("/auth/employee-payments/{payment_id}")
def update_payment(payment_id: int, body: PaymentInput, actor: str = Depends(require_owner)):
    """Edit a ledger payment (type/amount/date/status/note)."""
    pay = db.update_employee_payment(payment_id, body.model_dump(exclude_none=True), updated_by=actor)
    if not pay:
        raise HTTPException(404, "No such payment.")
    return {"payment": pay}


@router.delete("/auth/employee-payments/{payment_id}")
def delete_payment(payment_id: int, _: str = Depends(require_owner)):
    db.delete_employee_payment(payment_id)
    return {"ok": True}


# ── EMPLOYEE SELF-SERVICE (their OWN record only — /me mini-panel, piece 4) ─────
# Gated by current_user + scoped to the caller's own username. The employee self-edits ONLY
# their personal fields (birthday/contact/sub-account/wallet); owner-managed fields
# (role/domains/status/salary/bonus/portal) are read-only here.
_SELF_FIELDS = {"birthday", "contact", "subaccountDetails"}


class SelfUpdate(BaseModel):
    birthday: Optional[str] = None
    contact: Optional[str] = None
    subaccountDetails: Optional[str] = None


class WalletInput(BaseModel):
    walletAddress: str = ""


@router.get("/auth/me/employee")
def my_employee(username: str = Depends(current_user)):
    """The caller's OWN employee record + their payments (read-only ledger). Null if not an employee."""
    emp = db.get_employee(username)
    if not emp:
        return {"employee": None, "payments": []}
    return {"employee": _card(emp), "payments": db.list_employee_payments(username)}


@router.post("/auth/me/employee")
def my_employee_update(body: SelfUpdate, username: str = Depends(current_user)):
    """Self-edit personal fields only (birthday / contact / sub-account details)."""
    if not db.get_employee(username):
        raise HTTPException(404, "You don't have an employee record.")
    fields = {k: v for k, v in body.model_dump(exclude_none=True).items() if k in _SELF_FIELDS}
    emp = db.update_employee(username, fields, updated_by=username)
    return {"employee": _card(emp) if emp else None}


@router.post("/auth/me/employee/wallet")
def my_employee_wallet(body: WalletInput, username: str = Depends(current_user)):
    """Record the employee's wallet address to the owner side (the 'join the bonus program' action)
    + best-effort notify the owners. Phase 1 = records the wallet only; no funding moves."""
    cur = db.get_employee(username)
    if not cur:
        raise HTTPException(404, "You don't have an employee record.")
    addr = (body.walletAddress or "").strip()
    if not addr:
        raise HTTPException(400, "A wallet address is required.")
    # Sending the wallet IS the "join the bonus program" request → mark 'requested' (unless the
    # owner already moved them to active/paused). Owner approval flips it to 'active'.
    fields: dict = {"walletAddress": addr}
    if (cur.get("bonusProgramStatus") or "none") == "none":
        fields["bonusProgramStatus"] = "requested"
    emp = db.update_employee(username, fields, updated_by=username)
    try:
        from app.services import telegram as tg
        tg.notify_admin(f"💎 <b>Bonus program</b> · {db.display_name(username)} sent a wallet for the bonus/sub-account program:\n{addr[:160]}")
    except Exception:  # noqa: BLE001 — never block on the notification
        pass
    logger.info("employee.wallet.self %s", username)
    return {"ok": True, "employee": _card(emp) if emp else None}


# ── BONUS-PROGRAM DEFINITION — owner-editable, bilingual presentation content ─────
# ONE program-wide definition (a config singleton): the read-only "how it works" story shown to
# employees on the join screen + previewed by owners. Reading is open to any authenticated user
# (employees render it); editing is owner-only. Content only — no money, no per-employee data.
class BonusStepInput(BaseModel):
    icon: Optional[str] = None
    titleHe: Optional[str] = None
    titleEn: Optional[str] = None
    bodyHe: Optional[str] = None
    bodyEn: Optional[str] = None


class BonusProgramDefInput(BaseModel):
    titleHe: Optional[str] = None
    titleEn: Optional[str] = None
    introHe: Optional[str] = None
    introEn: Optional[str] = None
    benefitHe: Optional[str] = None
    benefitEn: Optional[str] = None
    termsHe: Optional[str] = None
    termsEn: Optional[str] = None
    steps: Optional[list[BonusStepInput]] = None


@router.get("/auth/bonus-program/definition")
def bonus_program_definition(_: str = Depends(current_user)):
    """The owner-editable bonus-program presentation (bilingual) — read by employees + owners."""
    return {"definition": db.get_bonus_program_def()}


@router.post("/auth/bonus-program/definition")
def bonus_program_definition_save(body: BonusProgramDefInput, actor: str = Depends(require_owner)):
    """Owner save of the program definition (title / intro / steps / benefit / terms)."""
    payload = body.model_dump(exclude_none=True)
    definition = db.set_bonus_program_def(payload, updated_by=actor)
    logger.info("bonus_program.definition.save by=%s", actor)
    return {"definition": definition}


# ── PUBLIC onboarding welcome payload (login-free, token-gated) ─────────────────
# Reached from the emailed/sent onboarding LINK before the new hire has a session, so it must
# pass the bearer gate — hence /auth/onboard is listed in security.PUBLIC_PATHS (same pattern as
# the report views). The token itself is the credential; no secrets are returned.
_TEAM_BLURB = [
    {"name": "Dan", "role_he": "בעלים ומנהל", "role_en": "Owner & Admin"},
    {"name": "Rafi", "role_he": "משקיע ובעלים", "role_en": "Investor & Owner"},
    {"name": "Yoav", "role_he": "בעלים וראש קריאייטיב", "role_en": "Owner & Head of Creative"},
    {"name": "Oren", "role_he": "מפתח ראשי וראש IT", "role_en": "Lead Developer & Head of IT"},
    {"name": "Raz", "role_he": "יועצת משפטית", "role_en": "Legal Counsel"},
]


@router.get("/auth/onboard")
def onboard_info(t: str = Query(default="")):
    """The welcome/explanation payload for a new hire's onboarding link (no login)."""
    uname = _onboard_username(t)
    if not uname:
        raise HTTPException(403, "This onboarding link is invalid or has expired.")
    emp = db.get_employee(uname) or {}
    return {
        "username": uname,
        "name": emp.get("fullName") or db.display_name(uname),
        "role": emp.get("role") or "",
        "workDomains": emp.get("workDomains") or [],
        "hasPortal": bool(emp.get("hasPortal")),
        "team": _TEAM_BLURB,
    }
