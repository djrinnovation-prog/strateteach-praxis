"""Execution-service configuration — fail-closed, testnet-pinned.

Spec §0.1/§0.2: the master gate is off unless someone deliberately turns it
on, and mainnet is blocked in code. Both rules live here, at the single point
where the environment is read, so no caller can accidentally route around them.

Reading rules that matter:

* ``EXECUTION_ARMED`` defaults to False and is only True for the exact string
  "true" (case-insensitive). "1", "yes", "TRUE " with a typo, an empty value,
  a missing var — all read as False. An ambiguous value must never arm a
  money-moving system.
* ``ENVIRONMENT`` defaults to "testnet". "mainnet" raises EnvGuardError at load.
* The env flag alone does NOT arm anything. Effective arming also requires the
  database state row (see state.py). This module is one of several ANDs.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from exec_service.errors import EnvGuardError

# Phase 1 runs against testnet only. Lifting this is a deliberate go-live
# change (spec §8.4), gated on written owner approval — not a config edit.
ALLOWED_ENVIRONMENTS = frozenset({"testnet"})

KNOWN_ENVIRONMENTS = frozenset({"testnet", "mainnet"})

DEFAULT_ENVIRONMENT = "testnet"


def _read_bool(name: str, *, default: bool = False) -> bool:
    """Strictly parse a boolean env var. Anything unexpected reads as `default`.

    Deliberately not permissive: for a flag that can move real money, a value
    the author did not clearly intend must fall back to the safe side.
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() == "true"


@dataclass(frozen=True)
class ExecConfig:
    """Immutable snapshot of the service's environment configuration."""

    # Master gate (spec §0.1). False unless explicitly, unambiguously "true".
    execution_armed: bool = False
    # Env guard (spec §0.2). testnet only in Phase 1.
    environment: str = DEFAULT_ENVIRONMENT
    database_url: Optional[str] = None
    service_name: str = "strateteach-execution-service"

    @property
    def is_testnet(self) -> bool:
        return self.environment == "testnet"


def load_config() -> ExecConfig:
    """Build the config from the environment, enforcing the env-guard.

    Raises EnvGuardError if ENVIRONMENT is mainnet (or anything unknown), so a
    misconfigured deploy fails at startup rather than running with a surprising
    environment.
    """
    environment = (os.environ.get("ENVIRONMENT") or DEFAULT_ENVIRONMENT).strip().lower()

    if environment not in KNOWN_ENVIRONMENTS:
        raise EnvGuardError(
            f"ENVIRONMENT={environment!r} is not a known environment "
            f"(expected one of {sorted(KNOWN_ENVIRONMENTS)})."
        )
    if environment not in ALLOWED_ENVIRONMENTS:
        raise EnvGuardError(
            f"ENVIRONMENT={environment!r} is blocked in this build. Phase 1 is "
            f"testnet-only (spec §0.2); mainnet requires the separate go-live "
            f"gate and explicit written owner approval."
        )

    return ExecConfig(
        execution_armed=_read_bool("EXECUTION_ARMED", default=False),
        environment=environment,
        database_url=os.environ.get("EXEC_DATABASE_URL"),
    )


def assert_env_allows_credential(credential_env: str) -> None:
    """Guard a credential's environment against the running environment.

    Spec §0.2: a testnet process must never touch a mainnet credential. Nothing
    resolves credentials in this slice (there is no vault client yet), but the
    check is written now so slice 5 has one place to call and cannot forget it.
    """
    env = (credential_env or "").strip().lower()
    running = load_config().environment
    if env != running:
        raise EnvGuardError(
            f"credential env={env!r} does not match running ENVIRONMENT={running!r} — refusing."
        )
    if env not in ALLOWED_ENVIRONMENTS:
        raise EnvGuardError(f"credential env={env!r} is blocked in this build.")
