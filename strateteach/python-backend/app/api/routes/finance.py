"""Owners Portal · FINANCE — business-finance management.

WRITES are owner-only (``require_owner``, Dan / Rafi / Yoav) — unchanged.
The READ (overview) follows the approved Oren boundary (P2.3, mgmt mapping page §5):
owners see everything; the EXECUTION OPERATOR (it_editor, Oren) sees the financial
STRUCTURE — budget, expenses, wallets, revenue, cashflow, payroll AGGREGATES — but
never the owners' investments/movements, per-person payroll, or edit controls.
Manual entry only in v1 — no exchange auto-pull; currency defaults to USD.

Four stores (budget lines · expenses · wallets · revenue forecast) with add/edit/delete +
status changes, plus a derived summary and a per-month cash-flow (revenue in vs expenses
out). Modelled on the pm store.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

try:
    from zoneinfo import ZoneInfo
    _IL_TZ = ZoneInfo("Asia/Jerusalem")
except Exception:  # noqa: BLE001
    _IL_TZ = timezone.utc

from app import database as db
from app.core.security import require_owner, require_financial_structure, is_owner

logger = logging.getLogger("algo770")
router = APIRouter(tags=["finance"])

# Display names for the owner picker / attribution (partner id → name).
_OWNER_NAMES = {"dan": "Dan", "rafi": "Rafi", "yoav": "Yoav", "oren": "Oren", "raz": "Raz"}


def _this_month() -> str:
    return datetime.now(_IL_TZ).strftime("%Y-%m")


def _owner_options() -> list:
    """The OWNER partners an investment can be tied to (Dan/Rafi/Yoav) — the partner ids
    that resolve to product-owner status. '' (company/unattributed) is offered by the UI."""
    return [{"id": pid, "name": _OWNER_NAMES.get(pid, pid)} for pid in db.PM_PARTNERS if is_owner(pid)]


def _cashflow(revenue: list, expenses: list) -> list:
    """Per-month cash flow: revenue IN vs (non-cancelled) expenses OUT, with a running
    cumulative net. Months are gathered from revenue.period + expense due-date months."""
    months: set[str] = set()
    inflow: dict[str, float] = {}
    outflow: dict[str, float] = {}
    for r in revenue:
        m = (r.get("period") or "")[:7]
        if len(m) == 7:
            months.add(m)
            inflow[m] = inflow.get(m, 0.0) + float(r.get("amount") or 0)
    for e in expenses:
        if e.get("status") == "cancelled":
            continue
        m = (e.get("dueDate") or "")[:7]
        if len(m) == 7:
            months.add(m)
            outflow[m] = outflow.get(m, 0.0) + float(e.get("amount") or 0)
    out = []
    cum = 0.0
    for m in sorted(months):
        i = round(inflow.get(m, 0.0), 2)
        o = round(outflow.get(m, 0.0), 2)
        net = round(i - o, 2)
        cum = round(cum + net, 2)
        out.append({"month": m, "in": i, "out": o, "net": net, "cumulative": cum})
    return out


def _summary(budget: list, expenses: list, wallets: list, revenue: list, investments: list, cashflow: list) -> dict:
    this = _this_month()
    plan_month = round(sum(b["planned"] for b in budget if b["scope"] == "month"), 2)
    actual_month = round(sum(b["actual"] for b in budget if b["scope"] == "month"), 2)
    plan_forward = round(sum(b["planned"] for b in budget if b["scope"] == "forward"), 2)
    plan_total = round(sum(b["planned"] for b in budget), 2)
    actual_total = round(sum(b["actual"] for b in budget), 2)
    wallet_total = round(sum(w["balance"] for w in wallets), 2)
    open_expenses = round(sum(e["amount"] for e in expenses if e["status"] in ("planned", "pending", "overdue")), 2)
    paid_expenses = round(sum(e["amount"] for e in expenses if e["status"] == "paid"), 2)
    revenue_total = round(sum(r["amount"] for r in revenue), 2)
    revenue_this_month = round(sum(r["amount"] for r in revenue if (r["period"] or "")[:7] == this), 2)
    expenses_this_month = round(sum(e["amount"] for e in expenses if e["status"] != "cancelled" and (e["dueDate"] or "")[:7] == this), 2)
    net_this_month = round(revenue_this_month - expenses_this_month, 2)
    projected_net = round(revenue_total - (open_expenses + paid_expenses), 2)
    invested_total = round(sum(i["amount"] for i in investments), 2)
    invested_by_owner: dict[str, float] = {}
    invested_by_purpose: dict[str, float] = {}
    for i in investments:
        k = i.get("owner") or "company"
        invested_by_owner[k] = round(invested_by_owner.get(k, 0.0) + float(i.get("amount") or 0), 2)
        p = i.get("purpose") or "other"
        invested_by_purpose[p] = round(invested_by_purpose.get(p, 0.0) + float(i.get("amount") or 0), 2)
    return {
        "thisMonth": this,
        "investedTotal": invested_total, "investedByOwner": invested_by_owner,
        "investedByPurpose": invested_by_purpose,
        "budgetPlannedMonth": plan_month, "budgetActualMonth": actual_month,
        "budgetPlannedForward": plan_forward,
        "budgetPlannedTotal": plan_total, "budgetActualTotal": actual_total,
        "budgetRemaining": round(plan_total - actual_total, 2),
        "walletTotal": wallet_total,
        "openExpenses": open_expenses, "paidExpenses": paid_expenses,
        "revenueTotal": revenue_total, "revenueThisMonth": revenue_this_month,
        "expensesThisMonth": expenses_this_month, "netThisMonth": net_this_month,
        "projectedNet": projected_net,
        "runwayNet": round(wallet_total + projected_net, 2),
    }


# ── Payroll ↔ Finance (Phase 2, READ-side) ──────────────────────────────────────
# The employee_payments ledger is the SINGLE SOURCE OF TRUTH — nothing is duplicated into the
# finance tables. Here we synthesise VIRTUAL expense rows from it so payroll rolls into the
# budget / summary / cash-flow / reports automatically. Marking a payment PAID in ניהול עובדים
# therefore moves it from "upcoming obligation" (open) to "actual expense" (paid) in the budget.
def _payroll_rows() -> list:
    """Virtual EXPENSE rows from employee_payments: PAID → an actual expense (money out);
    PENDING → an upcoming obligation. category='payroll'; tagged with the employee for breakdown."""
    out: list = []
    names: dict = {}
    for p in db.list_employee_payments():
        u = p.get("username") or ""
        nm = names.get(u)
        if nm is None:
            emp = db.get_employee(u) or {}
            nm = emp.get("fullName") or db.display_name(u)
            names[u] = nm
        typ = p.get("type") or "salary"
        out.append({
            "id": int(p.get("id") or 0), "name": f"{nm} · {typ}", "amount": float(p.get("amount") or 0),
            "category": "payroll", "currency": p.get("currency") or "USD",
            "dueDate": p.get("date") or "", "status": "paid" if p.get("status") == "paid" else "pending",
            "recurring": "", "employee": u, "employeeName": nm, "ptype": typ, "virtual": True,
        })
    return out


def _payroll_monthly() -> float:
    """Recurring monthly salary obligation = sum of monthly_salary for ACTIVE employees."""
    return round(sum(float(e.get("monthlySalary") or 0) for e in db.list_employees() if e.get("status") == "active"), 2)


def _payroll_summary(payroll: list, monthly: float) -> dict:
    this = _this_month()
    paid = round(sum(p["amount"] for p in payroll if p["status"] == "paid"), 2)
    pending = round(sum(p["amount"] for p in payroll if p["status"] == "pending"), 2)
    this_month_paid = round(sum(p["amount"] for p in payroll if p["status"] == "paid" and (p["dueDate"] or "")[:7] == this), 2)
    by_emp: dict = {}
    for p in payroll:
        d = by_emp.setdefault(p["employeeName"], {"paid": 0.0, "pending": 0.0})
        d["paid" if p["status"] == "paid" else "pending"] += p["amount"]
    for d in by_emp.values():
        d["paid"] = round(d["paid"], 2); d["pending"] = round(d["pending"], 2)
    return {"paid": paid, "pending": pending, "monthly": monthly, "thisMonthPaid": this_month_paid,
            "byEmployee": by_emp, "count": len(payroll)}


@router.get("/auth/finance/fund")
def finance_shared_fund(_: str = Depends(require_owner)):
    """The owners' SHARED FUND view — ownership %, NAV, per-owner contribution.
    OWNER-ONLY (require_owner): the execution operator never sees the owners' fund
    (spec §7). Read-only, derived from owner-attributed investments."""
    return db.shared_fund_view()


@router.get("/auth/finance/overview")
def finance_overview(username: str = Depends(require_financial_structure)):
    """The finance overview, in two honest shapes (P2.3, the approved Oren boundary):

    OWNER — everything, unchanged.
    EXECUTION OPERATOR (it_editor) — the financial STRUCTURE only:
      * investments: COMPANY-attributed rows only. Owner-attributed rows (the owners'
        investments and their movements) are removed BEFORE any total is computed,
        so no owner amount leaks through a sum or a breakdown.
      * payroll: aggregate totals only (they keep budget/cashflow honest); the
        per-person ledger rows and byEmployee breakdown stay owner-only.
      * owners picker: empty — every finance WRITE stays require_owner anyway.
    """
    owner_view = is_owner(username)
    budget = db.list_finance_budget()
    expenses = db.list_finance_expenses()
    wallets = db.list_finance_wallets()
    revenue = db.list_finance_revenue()
    investments = db.list_finance_investments()
    if not owner_view:
        # The operator's slice is decided HERE, server-side, before any aggregation.
        investments = [i for i in investments if not (i.get("owner") or "").strip()]
    # Payroll (virtual, read-side) — folded into the derived metrics WITHOUT persisting.
    payroll = _payroll_rows()
    payroll_monthly = _payroll_monthly()
    combined_expenses = expenses + payroll
    # A virtual FORWARD budget line for the recurring monthly salary obligation.
    budget_calc = budget + ([{"scope": "forward", "planned": payroll_monthly, "actual": 0.0,
                              "category": "payroll", "label": "Payroll (recurring)"}] if payroll_monthly else [])
    cashflow = _cashflow(revenue, combined_expenses)
    summary = _summary(budget_calc, combined_expenses, wallets, revenue, investments, cashflow)
    payroll_sum = _payroll_summary(payroll, payroll_monthly)
    if not owner_view:
        payroll_sum["byEmployee"] = {}
    summary["payroll"] = payroll_sum
    return {
        "budget": budget, "expenses": expenses, "wallets": wallets, "revenue": revenue,
        "investments": investments, "owners": _owner_options() if owner_view else [],
        # Per-person payroll rows are owner-only; the operator gets the aggregates above.
        "payroll": payroll if owner_view else [],
        "cashflow": cashflow,
        "summary": summary,
        "currency": "USD",
        # The UI renders read-only when the caller may not edit (writes stay require_owner).
        "canEdit": owner_view,
    }


# ── Budget lines ────────────────────────────────────────────────────────────────
class BudgetInput(BaseModel):
    scope: Optional[str] = None            # month | forward
    period: Optional[str] = None
    category: Optional[str] = None
    label: Optional[str] = None
    planned: Optional[float] = None
    actual: Optional[float] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    sort: Optional[int] = None


@router.post("/auth/finance/budget")
def budget_create(body: BudgetInput, actor: str = Depends(require_owner)):
    row = db.create_finance_budget(body.model_dump(exclude_none=True), created_by=actor)
    logger.info("finance.budget.create id=%s by=%s", row.get("id"), actor)
    return {"row": row}


@router.post("/auth/finance/budget/{row_id}")
def budget_update(row_id: int, body: BudgetInput, actor: str = Depends(require_owner)):
    row = db.update_finance_budget(row_id, body.model_dump(exclude_none=True), updated_by=actor)
    if not row:
        raise HTTPException(404, "No such budget line.")
    return {"row": row}


@router.delete("/auth/finance/budget/{row_id}")
def budget_delete(row_id: int, _: str = Depends(require_owner)):
    db.delete_finance_budget(row_id)
    return {"ok": True}


# ── Expenses ──────────────────────────────────────────────────────────────────────
class ExpenseInput(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    currency: Optional[str] = None
    dueDate: Optional[str] = None
    status: Optional[str] = None            # planned | pending | paid | overdue | cancelled
    recurring: Optional[str] = None
    notes: Optional[str] = None


@router.post("/auth/finance/expenses")
def expense_create(body: ExpenseInput, actor: str = Depends(require_owner)):
    if not (body.name or "").strip():
        raise HTTPException(400, "An expense needs a name.")
    row = db.create_finance_expense(body.model_dump(exclude_none=True), created_by=actor)
    logger.info("finance.expense.create id=%s by=%s", row.get("id"), actor)
    return {"row": row}


@router.post("/auth/finance/expenses/{row_id}")
def expense_update(row_id: int, body: ExpenseInput, actor: str = Depends(require_owner)):
    row = db.update_finance_expense(row_id, body.model_dump(exclude_none=True), updated_by=actor)
    if not row:
        raise HTTPException(404, "No such expense.")
    return {"row": row}


@router.delete("/auth/finance/expenses/{row_id}")
def expense_delete(row_id: int, _: str = Depends(require_owner)):
    db.delete_finance_expense(row_id)
    return {"ok": True}


# ── Wallets ───────────────────────────────────────────────────────────────────────
class WalletInput(BaseModel):
    name: Optional[str] = None
    balance: Optional[float] = None
    currency: Optional[str] = None
    kind: Optional[str] = None
    notes: Optional[str] = None
    sort: Optional[int] = None


@router.post("/auth/finance/wallets")
def wallet_create(body: WalletInput, actor: str = Depends(require_owner)):
    if not (body.name or "").strip():
        raise HTTPException(400, "A wallet needs a name.")
    row = db.create_finance_wallet(body.model_dump(exclude_none=True), created_by=actor)
    return {"row": row}


@router.post("/auth/finance/wallets/{row_id}")
def wallet_update(row_id: int, body: WalletInput, actor: str = Depends(require_owner)):
    row = db.update_finance_wallet(row_id, body.model_dump(exclude_none=True), updated_by=actor)
    if not row:
        raise HTTPException(404, "No such wallet.")
    return {"row": row}


@router.delete("/auth/finance/wallets/{row_id}")
def wallet_delete(row_id: int, _: str = Depends(require_owner)):
    db.delete_finance_wallet(row_id)
    return {"ok": True}


# ── Revenue forecast ──────────────────────────────────────────────────────────────
class RevenueInput(BaseModel):
    period: Optional[str] = None            # 'YYYY-MM'
    label: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    notes: Optional[str] = None
    sort: Optional[int] = None


@router.post("/auth/finance/revenue")
def revenue_create(body: RevenueInput, actor: str = Depends(require_owner)):
    row = db.create_finance_revenue(body.model_dump(exclude_none=True), created_by=actor)
    return {"row": row}


@router.post("/auth/finance/revenue/{row_id}")
def revenue_update(row_id: int, body: RevenueInput, actor: str = Depends(require_owner)):
    row = db.update_finance_revenue(row_id, body.model_dump(exclude_none=True), updated_by=actor)
    if not row:
        raise HTTPException(404, "No such revenue line.")
    return {"row": row}


@router.delete("/auth/finance/revenue/{row_id}")
def revenue_delete(row_id: int, _: str = Depends(require_owner)):
    db.delete_finance_revenue(row_id)
    return {"ok": True}


# ── Investments (initial / additional capital, source, optional owner link) ────────
class InvestmentInput(BaseModel):
    amount: Optional[float] = None
    kind: Optional[str] = None              # initial | additional
    source: Optional[str] = None
    date: Optional[str] = None              # 'YYYY-MM-DD'
    owner: Optional[str] = None             # owner id (dan/rafi/yoav) | '' = company
    currency: Optional[str] = None
    purpose: Optional[str] = None           # where the money went (working_capital|owner_loan|initial_shares|equity|company|ongoing|other)
    priority: Optional[str] = None          # none|red(חשוב)|orange(לדיון)|green(מאושר)
    notes: Optional[str] = None
    sort: Optional[int] = None


@router.post("/auth/finance/investments")
def investment_create(body: InvestmentInput, actor: str = Depends(require_owner)):
    row = db.create_finance_investment(body.model_dump(exclude_none=True), created_by=actor)
    logger.info("finance.investment.create id=%s owner=%s by=%s", row.get("id"), row.get("owner") or "company", actor)
    return {"row": row}


@router.post("/auth/finance/investments/{row_id}")
def investment_update(row_id: int, body: InvestmentInput, actor: str = Depends(require_owner)):
    row = db.update_finance_investment(row_id, body.model_dump(exclude_none=True), updated_by=actor)
    if not row:
        raise HTTPException(404, "No such investment.")
    return {"row": row}


@router.delete("/auth/finance/investments/{row_id}")
def investment_delete(row_id: int, _: str = Depends(require_owner)):
    db.delete_finance_investment(row_id)
    return {"ok": True}
