"""Kill-switch wiring + reconciliation classification (slice 6)."""
from __future__ import annotations

from pathlib import Path

from exec_service.reconcile import classify

PACKAGE = Path(__file__).resolve().parent.parent / "exec_service"


def _order(**over):
    o = {"status": "filled", "requested_qty": 1.0, "executed_qty": 1.0,
         "exchange_order_id": "MOCK-x", "_age_sec": 1}
    o.update(over)
    return o


# ── reconciliation verdicts (pure) ──────────────────────────────────────────

def test_clean_fill_is_ok():
    assert classify(_order()) == "ok"


def test_noop_and_rejected_are_no_op():
    assert classify(_order(status="noop_disarmed")) == "no_op"
    assert classify(_order(status="rejected")) == "no_op"


def test_underfill_is_partial():
    assert classify(_order(executed_qty=0.5)) == "partial"


def test_overfill_is_flagged_loudly():
    assert classify(_order(executed_qty=1.5)) == "overfill"


def test_filled_without_exchange_id_is_missing_exec():
    assert classify(_order(exchange_order_id=None)) == "missing_exec"
    assert classify(_order(executed_qty=0)) == "missing_exec"


def test_pending_within_time_is_partial_but_old_is_stuck():
    assert classify(_order(status="submitted", executed_qty=0, _age_sec=5), stuck_after_sec=300) == "partial"
    assert classify(_order(status="submitted", executed_qty=0, _age_sec=9999), stuck_after_sec=300) == "stuck"


def test_tolerance_absorbs_rounding_not_real_drift():
    # 0.3% under with a 0.5% tolerance = ok; 2% under = partial.
    assert classify(_order(executed_qty=0.997)) == "ok"
    assert classify(_order(executed_qty=0.98)) == "partial"


# ── kill-switch wiring (structural) ─────────────────────────────────────────

def test_queue_has_hold_and_release_that_do_not_arm():
    src = (PACKAGE / "queue.py").read_text()
    assert "def hold_all" in src and "def release_held" in src
    assert "status = 'held'" in src
    assert "release does not arm execution" in src


def test_kill_switch_engage_holds_the_queue_and_release_restores_it():
    src = (PACKAGE / "state.py").read_text()
    assert "from exec_service.queue import hold_all" in src
    assert "from exec_service.queue import release_held" in src


def test_held_items_are_not_claimable():
    """dequeue only ever selects 'queued' — a held item can never be claimed."""
    src = (PACKAGE / "queue.py").read_text()
    # the claim subquery filters on status='queued'
    assert "WHERE status = 'queued' AND visible_at <= NOW()" in src


def test_reconcile_never_places_or_cancels_orders():
    src = (PACKAGE / "reconcile.py").read_text()
    for banned in ("create_order", "cancel_order", "submit_intent", "ccxt", "UPDATE exec_orders", "INSERT INTO exec_orders"):
        assert banned not in src, f"reconcile.py must be read-only — found {banned!r}"


def test_queue_held_migration_extends_the_status_check():
    sql = (PACKAGE.parent / "migrations" / "006_queue_held.sql").read_text()
    assert "'queued', 'processing', 'held', 'done', 'dead'" in sql
