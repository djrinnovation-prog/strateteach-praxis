"""Structural guard: this slice must contain no way to trade.

Slice 1 is a scaffold. These tests fail the build if an exchange client, a
credential read, or an order-placing call ever appears in this package before
its slice — including by accident, in a helper someone added "just to test".

They are crude on purpose. A grep that occasionally needs a deliberate
exception is worth more than a subtle check nobody trusts.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import List

PACKAGE = Path(__file__).resolve().parent.parent / "exec_service"

# Execution code is allowed in EXACTLY ONE place: the adapters boundary (slice 8+).
# Everything else in the service must stay execution-free — that is what keeps
# ingress/queue/worker-core/sizing/vault/fund reviewable and inert. The adapter
# has its own dedicated safety tests (test_ccxt_adapter.py).
ADAPTERS_DIR = PACKAGE / "adapters"


def _sources() -> List[Path]:
    return sorted(p for p in PACKAGE.rglob("*.py") if ADAPTERS_DIR not in p.parents)


def _code_lines(path: Path) -> List[str]:
    """Source lines with comments and docstring bodies excluded.

    The modules document what they deliberately do NOT do ("no ccxt import",
    "never a real key"), so a naive grep would flag its own safety notes.
    """
    out: List[str] = []
    in_doc = False
    quote = ""
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if in_doc:
            if quote in line:
                in_doc = False
            continue
        if line.startswith(('"""', "'''")):
            quote = line[:3]
            # A one-line docstring opens and closes on the same line.
            if not (len(line) > 5 and line.endswith(quote)):
                in_doc = True
            continue
        if line.startswith("#"):
            continue
        out.append(raw.split("#", 1)[0])
    return out


# ── zero exchange code ────────────────────────────────────────────────────

FORBIDDEN_IMPORTS = ["ccxt", "binance", "pybit", "bybit"]


def test_no_exchange_library_is_imported():
    for path in _sources():
        for line in _code_lines(path):
            for lib in FORBIDDEN_IMPORTS:
                assert not re.search(rf"^\s*(import|from)\s+{lib}\b", line), (
                    f"{path.name} imports {lib} — exchange code is allowed ONLY under adapters/"
                )


def test_execution_code_lives_only_under_adapters():
    """The core must contain no exchange calls; the adapters boundary is the
    single sanctioned place. This asserts the exclusion is real: an execution
    call in any non-adapter module fails the build."""
    for path in _sources():  # _sources() already excludes adapters/
        body = "\n".join(_code_lines(path))
        for call in FORBIDDEN_CALLS:
            assert call not in body, f"{path.name} contains {call!r} outside adapters/"


FORBIDDEN_CALLS = [
    "create_order", "create_market_order", "create_limit_order",
    "place_order", "cancel_order", "fetch_balance", "private_post", "sign(",
]


def test_no_order_placing_call_exists():
    for path in _sources():
        for line in _code_lines(path):
            for call in FORBIDDEN_CALLS:
                assert call not in line, f"{path.name} contains {call!r} — no execution in slice 1"


def test_no_http_client_is_imported():
    """No network client at all: nothing here should talk to anything but Postgres."""
    for path in _sources():
        for line in _code_lines(path):
            assert not re.search(r"^\s*(import|from)\s+(httpx|requests|aiohttp|urllib)\b", line), (
                f"{path.name} imports an HTTP client — slice 1 makes no outbound calls"
            )


# ── zero key material ─────────────────────────────────────────────────────

def test_no_api_key_env_var_is_read():
    """Keys live in the vault and are read by the worker (slice 5) — not here."""
    for path in _sources():
        for line in _code_lines(path):
            assert not re.search(r"API_KEY|API_SECRET|SECRET_KEY|PRIVATE_KEY", line), (
                f"{path.name} references key material — this slice handles no keys"
            )


def test_credentials_are_referenced_only_by_vault_ref():
    """The schema stores a pointer; nothing here has a column for a secret."""
    sql = (PACKAGE.parent / "migrations" / "001_init.sql").read_text()
    body = sql.split("CREATE TABLE IF NOT EXISTS exec_credentials")[1].split(");")[0]
    # Column definitions only — the SQL comments in this table say the word
    # "secret" precisely to explain that no column holds one.
    columns = [
        line.strip().split()[0].lower()
        for line in body.splitlines()
        if line.strip() and not line.strip().startswith(("--", "CONSTRAINT", "("))
    ]
    for banned in ("api_key", "api_secret", "secret", "passphrase", "private_key"):
        assert banned not in columns, f"exec_credentials has a {banned!r} column"
    assert "vault_ref" in columns


# ── the schema's own safety invariants ────────────────────────────────────

def test_exec_state_is_seeded_disarmed():
    sql = (PACKAGE.parent / "migrations" / "001_init.sql").read_text()
    assert "execution_armed    BOOLEAN     NOT NULL DEFAULT FALSE" in sql
    assert "kill_switch        BOOLEAN     NOT NULL DEFAULT TRUE" in sql
    assert "VALUES (1, FALSE, TRUE, 'testnet')" in sql


def test_every_env_column_is_pinned_to_testnet_in_phase_1():
    sql = (PACKAGE.parent / "migrations" / "001_init.sql").read_text()
    for table in ("exec_bots", "exec_orders", "exec_credentials"):
        assert f"CONSTRAINT {table}_phase1_testnet" in sql, f"{table} is not pinned to testnet"
    assert "CONSTRAINT exec_state_phase1_testnet" in sql


def test_audit_log_is_append_only_at_the_database():
    sql = (PACKAGE.parent / "migrations" / "001_init.sql").read_text()
    assert "BEFORE UPDATE OR DELETE ON audit_log" in sql
    assert "audit_log is append-only" in sql


def test_signals_are_deduped_by_unique_constraint():
    sql = (PACKAGE.parent / "migrations" / "001_init.sql").read_text()
    assert "CONSTRAINT exec_signals_dedup   UNIQUE (bot_id, signal_id)" in sql


def test_owner_approvals_enforce_three_of_three():
    sql = (PACKAGE.parent / "migrations" / "001_init.sql").read_text()
    assert "owner_approvals_three_of_three" in sql
    assert "jsonb_array_length(approvals) >= 3" in sql


def test_queue_is_durable_skip_locked_with_dead_letter():
    """004 (slice 3): one item per signal (UNIQUE), SKIP LOCKED claim in code,
    retry with delayed visibility, and a DEAD status — never silent loss."""
    sql = (PACKAGE.parent / "migrations" / "004_queue.sql").read_text()
    assert "UNIQUE REFERENCES exec_signals(id)" in sql
    assert "'queued', 'processing', 'done', 'dead'" in sql
    assert "visible_at" in sql and "max_attempts" in sql
    qsrc = (PACKAGE / "queue.py").read_text()
    assert "FOR UPDATE SKIP LOCKED" in qsrc
    assert "'dead'" in qsrc


def test_queue_module_is_transport_only():
    """The queue carries REFERENCES (signal_row_id, bot_id) — it must never
    grow order/exchange/credential logic."""
    src = (PACKAGE / "queue.py").read_text()
    for banned in ("ccxt", "create_order", "api_key", "vault_ref", "credential"):
        assert banned not in src, f"queue.py mentions {banned!r} — the queue is transport only"


def test_noop_orders_may_carry_zero_qty_but_real_ones_must_not():
    """005: a DISARMED no-op / caps rejection is a record with qty 0 (nothing
    was requested); every other status still demands a positive quantity."""
    sql = (PACKAGE.parent / "migrations" / "005_order_noop_qty.sql").read_text()
    assert "DROP CONSTRAINT IF EXISTS exec_orders_qty_positive" in sql
    assert "requested_qty > 0 OR status IN ('noop_disarmed', 'rejected')" in sql


def test_owner_approvals_require_three_distinct_approvers():
    """003 (P2.3): 3-of-3 means three DIFFERENT owners — the same owner three times
    must not satisfy the gate. The strengthened CHECK counts DISTINCT approvers."""
    sql = (PACKAGE.parent / "migrations" / "003_distinct_approvers.sql").read_text()
    assert "owner_approvals_distinct_approvers" in sql
    assert "COUNT(DISTINCT" in sql
    assert "DROP CONSTRAINT IF EXISTS owner_approvals_three_of_three" in sql
    # The replacement keeps BOTH conditions: >=3 approvals AND >=3 distinct approvers.
    assert "jsonb_array_length(approvals) >= 3" in sql
    assert "owner_approvals_distinct_approvers(approvals) >= 3" in sql
    # Malformed entries must not count (fail-closed).
    assert "COALESCE(TRIM(elem->>'owner'), '') <> ''" in sql
