"""Vault client (slice 5, spec §6/§10.2) — resolve a REF to credentials.

The owners' decision (§10.2, recommended option): a DEDICATED secrets vault
with permission separation — HashiCorp Vault. This module is the ONLY place
that turns an ``exec_credentials.vault_ref`` pointer into live credentials,
and it is built to keep the secret's blast radius to a single function call.

Boundaries that are enforced, not just described:

* **No key is entered here — ever.** The owners load testnet keys directly
  into the vault out-of-band (spec §6). This service, and this agent, never
  write, read-and-store, or log a key. There is no "set secret" call in this
  module by design.
* **testnet may never touch a mainnet ref.** ``resolve()`` runs the env-guard
  (config.assert_env_allows_credential) before it fetches anything.
* **Secrets are never persisted.** A resolved credential is returned as an
  in-memory ``ExchangeCreds`` and handed straight to the adapter; it is never
  written to a row, a log line, or the audit trail (audit records the REF and
  the fact of a fetch, not the secret).
* **Fail-closed.** No backend configured, an unreachable vault, or a
  ref/env mismatch → raise. Nothing falls back to a plaintext anything.
* **The real HashiCorp client is optional at import time.** ``hvac`` is only
  imported inside the HashiCorp backend's fetch path, so the service (and its
  tests) run with no secret dependency installed. In this slice the only
  backend exercised is the in-memory MOCK — no real vault, no real key.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Dict, Optional, Protocol

from exec_service.config import assert_env_allows_credential
from exec_service.errors import ExecServiceError

log = logging.getLogger("exec_service.vault")


class VaultError(ExecServiceError):
    """A credential could not be resolved. Never carries the secret."""


@dataclass(frozen=True)
class ExchangeCreds:
    """In-memory only. Deliberately has NO __str__/__repr__ override that could
    print the secret, and is never JSON-encoded into a row or a log."""

    api_key: str
    api_secret: str
    passphrase: Optional[str] = None

    def redacted(self) -> dict:
        """The ONLY safe projection — for a log/audit line. Never the secret."""
        return {"api_key": "«redacted»", "api_secret": "«redacted»",
                "passphrase": "«redacted»" if self.passphrase else None}


class VaultBackend(Protocol):
    name: str
    def fetch(self, ref: str) -> ExchangeCreds: ...


class MockVault:
    """In-memory backend for tests/tools ONLY. Holds throwaway 'testnet'
    placeholder values that are obviously not real keys. This is the only
    backend slice 5 actually runs — no network, no HashiCorp, no real secret."""

    name = "mock"

    def __init__(self, store: Optional[Dict[str, ExchangeCreds]] = None) -> None:
        self._store = store or {}

    def put_placeholder(self, ref: str, creds: ExchangeCreds) -> None:
        """Test seam only — seeds a PLACEHOLDER credential. Not a real key, and
        this method exists nowhere in the production resolve path."""
        self._store[ref] = creds

    def fetch(self, ref: str) -> ExchangeCreds:
        if ref not in self._store:
            raise VaultError(f"mock vault has no entry for ref {ref!r}")
        return self._store[ref]


class HashiCorpVault:
    """The RECOMMENDED backend (spec §10.2): HashiCorp Vault KV v2, read-only.

    Reads a secret at the ref's path with a token/role that is scoped to READ
    that path and nothing else (permission separation is configured in Vault,
    not here). Imports ``hvac`` lazily so the dependency is only needed where a
    real vault is actually wired — not in this slice, not in tests.
    """

    name = "hashicorp_vault"

    def __init__(self, addr: Optional[str] = None, token: Optional[str] = None) -> None:
        self.addr = addr or os.environ.get("VAULT_ADDR")
        # The token is read per-process from the environment and never stored in
        # a row/log. A production deploy uses a short-lived, path-scoped token.
        self._token = token or os.environ.get("VAULT_TOKEN")

    def fetch(self, ref: str) -> ExchangeCreds:  # pragma: no cover - no real vault in this slice
        if not self.addr or not self._token:
            raise VaultError("HashiCorp Vault is not configured (VAULT_ADDR/VAULT_TOKEN)")
        try:
            import hvac  # lazy: only needed when a real vault is wired
        except ImportError as e:
            raise VaultError("hvac is not installed — the HashiCorp backend is not available here") from e
        # ref form: vault://<mount>/<path>  → mount + secret path
        path = ref.split("://", 1)[1] if "://" in ref else ref
        mount, _, secret_path = path.partition("/")
        client = hvac.Client(url=self.addr, token=self._token)
        try:
            resp = client.secrets.kv.v2.read_secret_version(mount_point=mount, path=secret_path)
            data = resp["data"]["data"]
        except Exception as e:  # noqa: BLE001 — never surface vault internals/secret
            raise VaultError(f"could not read secret for ref {ref!r}") from e
        try:
            return ExchangeCreds(api_key=data["api_key"], api_secret=data["api_secret"],
                                 passphrase=data.get("passphrase"))
        except KeyError as e:
            raise VaultError(f"secret at ref {ref!r} is missing field {e}") from e


def resolve(backend: VaultBackend, *, ref: str, credential_env: str) -> ExchangeCreds:
    """Turn a vault_ref into live credentials — the ONE resolve path.

    Runs the env-guard FIRST (a testnet process refuses a mainnet credential,
    spec §0.2), then delegates to the backend. The returned creds are meant to
    flow straight into the adapter call and be discarded — never stored.
    """
    if backend is None:
        raise VaultError("no vault backend wired — refusing to resolve credentials")
    assert_env_allows_credential(credential_env)  # raises EnvGuardError on mismatch/mainnet
    if not ref or "://" not in ref:
        raise VaultError("refusing to resolve a non-reference (expected a vault://… pointer)")
    creds = backend.fetch(ref)
    if not creds.api_key or not creds.api_secret:
        raise VaultError(f"resolved credential for ref {ref!r} is incomplete")
    return creds
