"""Role boundary for the execution plane (spec §7) — the "Oren boundary".

The execution operator runs the financial machine and sees all of it: bots,
signals, orders, state, caps, credential *references*, reconciliation. He does
not see the owners' shared fund, its movements, or the 3-of-3 approvals — those
are owner-only.

This module is the code half of that boundary. The database half is the grants
in 002_owner_only_grants.sql. Where the deployment allows both, both apply.
"""
from __future__ import annotations

from enum import Enum
from typing import FrozenSet

from exec_service.errors import AccessDenied


class ExecRole(str, Enum):
    OWNER = "owner"                        # Dan · Rafi · Yoav — equal, 3-of-3 on the fund
    EXECUTION_OPERATOR = "execution_operator"  # Oren — the exec plane, not the owners' money


#: The whole execution plane. Operator + owners.
EXEC_PLANE_TABLES: FrozenSet[str] = frozenset({
    "exec_bots",
    "exec_signals",
    "exec_orders",
    "exec_credentials",  # vault REFERENCES only; the secret is not in the row
    "exec_state",
    "audit_log",
})

#: Owners only. The operator must never read these (spec §7).
OWNER_ONLY_TABLES: FrozenSet[str] = frozenset({
    "owner_fund",
    "owner_approvals",
})

_VISIBLE = {
    ExecRole.OWNER: EXEC_PLANE_TABLES | OWNER_ONLY_TABLES,
    ExecRole.EXECUTION_OPERATOR: EXEC_PLANE_TABLES,
}


def can_read(role: ExecRole, table: str) -> bool:
    """Whether `role` may read `table`. Unknown table/role -> False (fail-closed)."""
    try:
        return table in _VISIBLE[ExecRole(role)]
    except (KeyError, ValueError):
        return False


def assert_can_read(role: ExecRole, table: str) -> None:
    """Raise AccessDenied unless `role` may read `table`."""
    if not can_read(role, table):
        raise AccessDenied(
            f"role={getattr(role, 'value', role)!r} may not read {table!r}"
            + (" (owner-only: the owners' fund and its movements)" if table in OWNER_ONLY_TABLES else "")
        )
