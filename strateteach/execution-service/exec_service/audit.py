"""Append-only audit writer (spec §0.6). Skeleton — writer only, no reader UI.

Every state change in the execution plane goes through ``record()``. The table
rejects UPDATE and DELETE at the database (trigger in 001_init.sql), so this
module can only ever add lines to history.

Two properties worth stating, because both are easy to get wrong later:

1. **Writing audit must not break the caller.** A failed audit write is logged
   loudly and swallowed. Losing an audit line is bad; crashing a kill-switch
   because the audit insert timed out is worse.
2. **Secrets never enter this table.** `before`/`after`/`meta` are scrubbed of
   anything that looks like key material before insert. exec_credentials stores
   only vault refs, so there should be nothing to scrub — this is the belt to
   that braces.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from psycopg.types.json import Json

from exec_service.db import connect

log = logging.getLogger("exec_service.audit")

# Keys whose values are redacted before they can reach the audit table.
_SENSITIVE_KEY = re.compile(
    r"(api[_-]?key|secret|passphrase|password|token|private[_-]?key|credential)",
    re.IGNORECASE,
)

REDACTED = "«redacted»"


def _scrub(value: Any, *, depth: int = 0) -> Any:
    """Recursively redact secret-shaped keys. Defensive; expects to find nothing."""
    if depth > 6:
        return "«too-deep»"
    if isinstance(value, dict):
        return {
            k: (REDACTED if _SENSITIVE_KEY.search(str(k)) else _scrub(v, depth=depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub(v, depth=depth + 1) for v in value]
    return value


def record(
    *,
    actor: str,
    action: str,
    entity: Optional[str] = None,
    entity_id: Optional[str] = None,
    actor_role: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Append one audit line. Never raises.

    actor  — who did it ('dan', 'oren', 'worker:1', 'system').
    action — dotted verb ('gate.arm', 'kill_switch.engage', 'order.submit').
    """
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO audit_log (actor, actor_role, action, entity, entity_id, before, after, meta)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        actor,
                        actor_role,
                        action,
                        entity,
                        entity_id,
                        Json(_scrub(before)) if before is not None else None,
                        Json(_scrub(after)) if after is not None else None,
                        Json(_scrub(meta or {})),
                    ),
                )
                conn.commit()
    except Exception:  # noqa: BLE001 — see module docstring, property 1.
        log.exception(
            "audit write FAILED (action=%s actor=%s entity=%s/%s) — action itself was not rolled back",
            action, actor, entity, entity_id,
        )


def tail(limit: int = 50) -> list:
    """Most recent audit lines, newest first. Read-only convenience for status."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, at, actor, actor_role, action, entity, entity_id, meta "
                "FROM audit_log ORDER BY at DESC, id DESC LIMIT %s",
                (max(1, min(int(limit), 500)),),
            )
            return cur.fetchall()
