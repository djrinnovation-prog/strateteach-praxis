"""Owner-fund ledger math + 3-of-3 flow — structural + pure-math invariants.

The DB-backed behaviours (INSERT, DISTINCT enforcement, expiry) are exercised
in the integration check against a real Postgres; here we assert the pure
ownership/NAV math and the structural safety properties."""
from __future__ import annotations

from pathlib import Path

import pytest

from exec_service.owner_fund import CONTRIB_TYPES, PNL_TYPES, _signed

PACKAGE = Path(__file__).resolve().parent.parent / "exec_service"


# ── ledger signing (pure) ───────────────────────────────────────────────────

def test_withdrawals_and_fees_are_negative():
    assert _signed("withdrawal", 100) == -100
    assert _signed("fee", 5) == -5


def test_deposits_pnl_adjustments_are_positive():
    assert _signed("deposit", 100) == 100
    assert _signed("pnl", 20) == 20
    assert _signed("adjustment", 3) == 3


def test_type_partitions_are_disjoint_and_complete():
    assert set(CONTRIB_TYPES).isdisjoint(PNL_TYPES)
    assert set(CONTRIB_TYPES) | set(PNL_TYPES) == {"deposit", "withdrawal", "pnl", "fee", "adjustment"}


# ── ownership/NAV math, computed the way view() does (pure recompute) ────────

def _ownership(entries):
    contributed = {}
    pnl = 0.0
    for owner, etype, amt in entries:
        s = _signed(etype, amt)
        if etype in CONTRIB_TYPES:
            contributed[owner] = contributed.get(owner, 0.0) + s
        else:
            pnl += s
    total = sum(contributed.values())
    pcts = {o: (c / total * 100 if total else 0.0) for o, c in contributed.items()}
    return pcts, total + pnl


def test_equal_deposits_split_ownership_evenly():
    pcts, nav = _ownership([("dan", "deposit", 100), ("rafi", "deposit", 100), ("yoav", "deposit", 100)])
    assert round(pcts["dan"], 4) == round(pcts["rafi"], 4) == round(pcts["yoav"], 4) == round(100 / 3, 4)
    assert nav == 300


def test_pnl_moves_nav_but_not_ownership():
    pcts, nav = _ownership([("dan", "deposit", 100), ("rafi", "deposit", 100), ("yoav", "deposit", 100),
                            ("dan", "pnl", 30)])
    # ownership base unchanged (pnl is not contributed capital)
    assert round(pcts["dan"], 4) == round(100 / 3, 4)
    assert nav == 330


def test_withdrawal_reduces_contribution_and_nav():
    pcts, nav = _ownership([("dan", "deposit", 200), ("rafi", "deposit", 100),
                            ("dan", "withdrawal", 100)])
    # dan net 100, rafi 100 → 50/50
    assert round(pcts["dan"], 2) == 50.0 and round(pcts["rafi"], 2) == 50.0
    assert nav == 200


# ── structural safety ───────────────────────────────────────────────────────

def test_owner_fund_moves_no_money_and_runs_nothing():
    src = (PACKAGE / "owner_fund.py").read_text()
    for banned in ("submit_intent", "create_order", "ccxt", "enqueue", "adapter"):
        assert banned not in src, f"owner_fund.py must be a ledger only — found {banned!r}"


def test_flow_records_but_never_executes():
    """The 3-of-3 flow may reach 'approved' but NEVER 'executed' in Phase 1, and
    must not call into the worker/queue/adapter."""
    src = (PACKAGE / "approvals_flow.py").read_text()
    # the only statuses this flow SETS are pending/approved/rejected/expired —
    # never 'executed' (that is a later, gated act). Check no assignment to it.
    assert 'new_status = "executed"' not in src
    assert "status = 'executed'" not in src
    assert "SET status = 'executed'" not in src
    for banned in ("submit_intent", "enqueue", "from exec_service.worker", "adapter"):
        assert banned not in src, f"approvals_flow.py must not execute — found {banned!r}"
    # unanimity + distinctness are asserted in code (DB CHECK backstops)
    assert "len(distinct) >= 3 and len(approvals) >= 3" in src


def test_flow_action_list_is_closed():
    from exec_service.approvals_flow import FUND_ACTIONS, request
    assert "arm_fund" in FUND_ACTIONS
    with pytest.raises(ValueError):
        # unknown action refused before any DB work
        request("drain_everything", {}, requested_by="dan")
