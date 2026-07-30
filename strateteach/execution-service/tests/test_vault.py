"""Vault client (slice 5) — the ref→creds boundary, and its refusals.

No real vault, no real key: only the in-memory MockVault with obviously-fake
placeholder values is exercised. These tests assert the SAFETY properties —
env-guard, non-ref refusal, no-secret-in-logs — not any real secret handling.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from exec_service.errors import EnvGuardError
from exec_service.vault import (
    ExchangeCreds,
    MockVault,
    VaultError,
    resolve,
)

PACKAGE = Path(__file__).resolve().parent.parent / "exec_service"
REF = "vault://strateteach/exec/bybit-testnet"
PLACEHOLDER = ExchangeCreds(api_key="PLACEHOLDER-testnet-key", api_secret="PLACEHOLDER-testnet-secret")


def _mock():
    v = MockVault()
    v.put_placeholder(REF, PLACEHOLDER)
    return v


def test_resolve_returns_creds_under_matching_env(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    creds = resolve(_mock(), ref=REF, credential_env="testnet")
    assert creds.api_key and creds.api_secret


def test_resolve_refuses_a_mainnet_credential_under_testnet(monkeypatch):
    """The env-guard runs BEFORE the fetch — a testnet process never resolves a
    mainnet credential (spec §0.2)."""
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    with pytest.raises(EnvGuardError):
        resolve(_mock(), ref=REF, credential_env="mainnet")


def test_resolve_refuses_without_a_backend(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    with pytest.raises(VaultError):
        resolve(None, ref=REF, credential_env="testnet")


def test_resolve_refuses_a_non_reference(monkeypatch):
    """A bare string that isn't a vault://… pointer must be refused — the guard
    against someone passing a raw secret where a ref belongs."""
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    with pytest.raises(VaultError):
        resolve(_mock(), ref="AKIA-looks-like-a-secret", credential_env="testnet")


def test_incomplete_credential_is_refused(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "testnet")
    v = MockVault()
    v.put_placeholder(REF, ExchangeCreds(api_key="", api_secret=""))
    with pytest.raises(VaultError):
        resolve(v, ref=REF, credential_env="testnet")


def test_creds_redaction_never_exposes_the_secret():
    r = PLACEHOLDER.redacted()
    assert r["api_key"] == "«redacted»" and r["api_secret"] == "«redacted»"
    assert "PLACEHOLDER-testnet-secret" not in str(r)


def test_vault_module_never_writes_a_secret_anywhere():
    """Structural: the vault module must not INSERT, write a log with the
    secret, or otherwise persist key material. It only READS."""
    src = (PACKAGE / "vault.py").read_text()
    assert "INSERT" not in src.upper()
    # no "set secret" / write path — this module resolves only
    assert "put_placeholder" in src  # the ONLY writer, and it's test-seam only
    for writer in ("write_secret", "create_secret", "kv.v2.create", "set_secret"):
        assert writer not in src


def test_worker_only_resolves_for_an_adapter_that_needs_creds():
    """The mock needs nothing, so the resolve path must be gated on
    needs_credentials — a keyless mock run never touches the vault."""
    src = (PACKAGE / "worker.py").read_text()
    assert 'getattr(adapter, "needs_credentials", False)' in src
    assert "resolve(vault_backend" in src
    # the resolved secret is handed to the adapter, never written to a row
    assert "creds=creds" in src


def test_mock_adapter_discards_creds():
    src = (PACKAGE / "mock_exchange.py").read_text()
    assert "needs_credentials = False" in src
    assert "del creds" in src
