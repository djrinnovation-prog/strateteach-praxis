"""Execution-service error types.

Kept in their own module so nothing in the service needs to import the
browser-facing backend to raise or catch them.
"""
from __future__ import annotations


class ExecServiceError(Exception):
    """Base class for every execution-service failure."""


class EnvGuardError(ExecServiceError):
    """The environment is not one this build is allowed to run against.

    Phase 1 is testnet-only. mainnet raises here, at config load, before any
    other code runs — there is no code path that reaches an exchange with a
    mainnet credential in this build.
    """


class DisarmedError(ExecServiceError):
    """An execution was attempted while the master gate was off.

    Nothing raises this yet — slice 1 has no execution path at all. It exists
    so the worker (slice 4) has one obvious thing to raise, and so the name is
    reserved rather than invented ad hoc later.
    """


class AccessDenied(ExecServiceError):
    """A role tried to read or write something outside its boundary (spec §7)."""
