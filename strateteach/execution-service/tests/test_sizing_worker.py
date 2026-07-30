"""Sizing/caps math (pure) + the worker skeleton's structural safety."""
from __future__ import annotations

from pathlib import Path

from exec_service.sizing import decide

BOT = {"fixed_notional": 10.0, "max_order_notional": 20.0, "daily_notional_cap": 25.0, "max_open_positions": 1}
PACKAGE = Path(__file__).resolve().parent.parent / "exec_service"


# ── caps: exact math, fail-closed ───────────────────────────────────────────

def test_happy_path_sizes_from_config():
    d = decide(BOT, used_today_notional=0, open_positions=0)
    assert d.ok and d.reason == "ok" and d.notional == 10.0


def test_per_order_cap_rejects():
    d = decide({**BOT, "fixed_notional": 30.0, "max_order_notional": 20.0},
               used_today_notional=0, open_positions=0)
    assert not d.ok and d.reason == "per_order_cap"


def test_daily_cap_rejects_at_the_boundary():
    # used 20 + order 10 = 30 > 25 → reject. Exactly at the cap (15+10=25) → allowed.
    assert not decide(BOT, used_today_notional=20, open_positions=0).ok
    assert decide(BOT, used_today_notional=15, open_positions=0).ok


def test_max_positions_rejects():
    d = decide(BOT, used_today_notional=0, open_positions=1)
    assert not d.ok and d.reason == "max_positions"


def test_malformed_config_is_a_rejection_not_a_default():
    assert decide({}, used_today_notional=0, open_positions=0).reason == "bad_config"
    assert decide({**BOT, "daily_notional_cap": 0}, used_today_notional=0, open_positions=0).reason == "bad_config"
    assert decide({**BOT, "fixed_notional": "??"}, used_today_notional=0, open_positions=0).reason == "bad_config"


def test_negative_usage_never_helps():
    """A corrupted negative 'used' figure must not create headroom."""
    d = decide(BOT, used_today_notional=-1_000_000, open_positions=0)
    assert d.ok and d.notional == 10.0  # clamped to 0, not to -1M


# ── worker skeleton: structural invariants ──────────────────────────────────

def test_worker_has_no_default_adapter_and_never_imports_one():
    """adapter=None must refuse to execute (one more AND), and the worker must
    not quietly wire an adapter in — injection only."""
    src = (PACKAGE / "worker.py").read_text()
    assert "adapter: Any = None" in src
    assert "adapter is None" in src
    assert "from exec_service.mock_exchange" not in src
    assert "import mock_exchange" not in src


def test_worker_rechecks_the_gate_at_processing_time():
    src = (PACKAGE / "worker.py").read_text()
    assert "read_gate()" in src
    assert "noop_disarmed" in src


def test_worker_orders_are_idempotent_per_signal():
    src = (PACKAGE / "worker.py").read_text()
    assert "ON CONFLICT (client_order_id) DO NOTHING" in src
    assert 'f"sig-{ctx[\'signal_row_id\']}"' in src


def test_mock_adapter_is_honest_about_being_fake():
    src = (PACKAGE / "mock_exchange.py").read_text()
    assert "mock: bool = True" in src
    for banned in ("http", "requests", "ccxt", "websocket"):
        assert f"import {banned}" not in src
