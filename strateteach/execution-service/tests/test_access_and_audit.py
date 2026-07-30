"""The Oren boundary (spec §7) and the audit writer's scrubbing (spec §0.6)."""
from __future__ import annotations

import pytest

from exec_service.access import (
    EXEC_PLANE_TABLES,
    OWNER_ONLY_TABLES,
    ExecRole,
    assert_can_read,
    can_read,
)
from exec_service.audit import REDACTED, _scrub
from exec_service.errors import AccessDenied


# ── §7: the operator runs the machine but never sees the owners' money ────

@pytest.mark.parametrize("table", sorted(EXEC_PLANE_TABLES))
def test_operator_sees_the_whole_execution_plane(table):
    assert can_read(ExecRole.EXECUTION_OPERATOR, table) is True


@pytest.mark.parametrize("table", sorted(OWNER_ONLY_TABLES))
def test_operator_is_blocked_from_owner_fund_and_approvals(table):
    assert can_read(ExecRole.EXECUTION_OPERATOR, table) is False
    with pytest.raises(AccessDenied):
        assert_can_read(ExecRole.EXECUTION_OPERATOR, table)


@pytest.mark.parametrize("table", sorted(EXEC_PLANE_TABLES | OWNER_ONLY_TABLES))
def test_owners_see_everything(table):
    assert can_read(ExecRole.OWNER, table) is True


def test_owner_only_set_is_exactly_the_two_spec_tables():
    assert set(OWNER_ONLY_TABLES) == {"owner_fund", "owner_approvals"}


def test_unknown_table_and_unknown_role_fail_closed():
    assert can_read(ExecRole.OWNER, "some_new_table") is False
    assert can_read("marketing_intern", "exec_bots") is False


# ── §0.6: audit lines can never carry key material ────────────────────────

def test_scrub_redacts_secret_shaped_keys():
    scrubbed = _scrub({
        "api_key": "AKIA-not-a-real-key",
        "apiSecret": "shhh",
        "passphrase": "hunter2",
        "vault_ref": "vault://strateteach/exec/bybit-testnet",
        "bot": "btc-testnet",
    })
    assert scrubbed["api_key"] == REDACTED
    assert scrubbed["apiSecret"] == REDACTED
    assert scrubbed["passphrase"] == REDACTED
    # A vault ref is a pointer, not a secret — it stays readable in the audit.
    assert scrubbed["vault_ref"] == "vault://strateteach/exec/bybit-testnet"
    assert scrubbed["bot"] == "btc-testnet"


def test_scrub_reaches_nested_structures():
    scrubbed = _scrub({"cfg": {"creds": [{"token": "abc"}]}})
    assert scrubbed["cfg"]["creds"][0]["token"] == REDACTED


def test_scrub_is_depth_bounded():
    deep = cur = {}
    for _ in range(20):
        cur["next"] = {}
        cur = cur["next"]
    assert "«too-deep»" in str(_scrub(deep))


def test_audit_write_failure_does_not_raise(monkeypatch):
    """A broken audit must never take down the action it was recording."""
    from exec_service import audit

    monkeypatch.setenv("EXEC_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    audit.record(actor="test", action="gate.arm")  # must not raise
