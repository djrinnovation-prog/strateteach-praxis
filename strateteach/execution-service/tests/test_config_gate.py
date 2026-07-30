"""The safety invariants, as tests (spec §0.1, §0.2, §4).

These do not need a database: config + env-guard are pure, and the gate's
fail-closed path is exercised by pointing it at a database that isn't there.
"""
from __future__ import annotations

import pytest

from exec_service.config import (
    ALLOWED_ENVIRONMENTS,
    assert_env_allows_credential,
    load_config,
)
from exec_service.errors import EnvGuardError


# ── §0.1 master gate defaults off ─────────────────────────────────────────

def test_execution_armed_defaults_false_when_unset(monkeypatch):
    monkeypatch.delenv("EXECUTION_ARMED", raising=False)
    assert load_config().execution_armed is False


@pytest.mark.parametrize(
    "value",
    ["", " ", "1", "yes", "y", "on", "TRUE!", "true-ish", "False", "0", "no", "null", "None"],
)
def test_only_the_exact_string_true_arms_the_env_flag(monkeypatch, value):
    """Anything ambiguous must read as disarmed — never 'probably meant yes'."""
    monkeypatch.setenv("EXECUTION_ARMED", value)
    assert load_config().execution_armed is False


@pytest.mark.parametrize("value", ["true", "TRUE", "True", " true "])
def test_explicit_true_sets_the_env_flag_only(monkeypatch, value):
    """The env flag flips — but it is one AND of four; it arms nothing alone."""
    monkeypatch.setenv("EXECUTION_ARMED", value)
    assert load_config().execution_armed is True


# ── §0.2 env-guard: testnet only ──────────────────────────────────────────

def test_environment_defaults_to_testnet(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    cfg = load_config()
    assert cfg.environment == "testnet"
    assert cfg.is_testnet is True


def test_mainnet_is_blocked_at_config_load(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "mainnet")
    with pytest.raises(EnvGuardError, match="testnet-only"):
        load_config()


def test_mainnet_is_blocked_even_when_armed(monkeypatch):
    """Arming must not open a mainnet door: the guard runs regardless."""
    monkeypatch.setenv("ENVIRONMENT", "MAINNET")
    monkeypatch.setenv("EXECUTION_ARMED", "true")
    with pytest.raises(EnvGuardError):
        load_config()


def test_unknown_environment_is_rejected(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "prod")
    with pytest.raises(EnvGuardError, match="not a known environment"):
        load_config()


def test_allowed_environments_is_testnet_only():
    assert set(ALLOWED_ENVIRONMENTS) == {"testnet"}


def test_mainnet_credential_is_refused_under_testnet(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    with pytest.raises(EnvGuardError):
        assert_env_allows_credential("mainnet")


def test_testnet_credential_is_allowed_under_testnet(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    assert_env_allows_credential("testnet")  # does not raise


# ── §4 gate is fail-closed ────────────────────────────────────────────────

def test_gate_reads_disarmed_when_database_is_unreachable(monkeypatch):
    """An unreadable gate is a closed gate — the failure mode is 'no trade'."""
    from exec_service import state

    monkeypatch.setenv("EXEC_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    monkeypatch.setenv("EXECUTION_ARMED", "true")  # even armed in env
    gate = state.read_gate()
    assert gate.armed is False
    assert state.is_armed() is False
    assert "fail-closed" in gate.reason


def test_gate_reads_disarmed_when_config_is_invalid(monkeypatch):
    from exec_service import state

    monkeypatch.setenv("ENVIRONMENT", "mainnet")  # load_config() raises
    assert state.read_gate().armed is False
    assert state.is_armed() is False
