"""Master gate + kill-switch state (spec §4). STATE ONLY — nothing executes.

There is no execution path in this slice, so nothing consumes ``is_armed()``
yet. It is written now so that when the worker arrives (slice 4) the gate is an
existing, tested function it must call — not a check invented alongside the
code that wants to trade.

The arming decision is an AND of four independent conditions:

    EXECUTION_ARMED=true (env)          — deploy-level intent
  AND exec_state.execution_armed=true   — a deliberate, audited owner action
  AND exec_state.kill_switch=false      — nobody has pulled the cord
  AND environment == testnet            — the env-guard

Any error, any missing row, any disagreement between env and database reads as
DISARMED. Fail-closed is the whole point: the failure mode of this function
must be "no trade", never "trade anyway".
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from exec_service.audit import record
from exec_service.config import load_config
from exec_service.db import connect

log = logging.getLogger("exec_service.state")


@dataclass(frozen=True)
class GateState:
    """A read of the gate. `armed` is the only field a caller should act on."""

    armed: bool
    db_execution_armed: bool
    env_execution_armed: bool
    kill_switch: bool
    environment: str
    worker_id: Optional[str] = None
    worker_heartbeat_at: Optional[datetime] = None
    # Why the gate is closed, in words, for the status view and the audit line.
    reason: str = ""


DISARMED_UNKNOWN = GateState(
    armed=False,
    db_execution_armed=False,
    env_execution_armed=False,
    kill_switch=True,
    environment="unknown",
    reason="state unavailable — fail-closed",
)


def read_gate() -> GateState:
    """Read the effective gate. Never raises; an unreadable gate is a closed gate."""
    try:
        cfg = load_config()
    except Exception:  # noqa: BLE001 — a config that won't load cannot arm anything.
        return DISARMED_UNKNOWN

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT execution_armed, kill_switch, environment,
                           worker_id, worker_heartbeat_at
                      FROM exec_state
                     WHERE id = 1
                    """
                )
                row = cur.fetchone()
    except Exception:  # noqa: BLE001 — DB down / table missing / no permission.
        return DISARMED_UNKNOWN

    if row is None:
        # No singleton row: the schema exists but was never seeded. Not armed.
        return GateState(
            armed=False,
            db_execution_armed=False,
            env_execution_armed=cfg.execution_armed,
            kill_switch=True,
            environment=cfg.environment,
            reason="exec_state row missing — fail-closed",
        )

    db_armed = bool(row["execution_armed"])
    kill = bool(row["kill_switch"])
    db_env = str(row["environment"])

    reasons = []
    if not cfg.execution_armed:
        reasons.append("EXECUTION_ARMED=false (env)")
    if not db_armed:
        reasons.append("exec_state.execution_armed=false")
    if kill:
        reasons.append("kill-switch engaged")
    if not cfg.is_testnet:
        reasons.append(f"environment={cfg.environment} is not testnet")
    if db_env != cfg.environment:
        # env and database disagree about which world this is. Refuse both.
        reasons.append(f"env/db environment mismatch ({cfg.environment} vs {db_env})")

    return GateState(
        armed=not reasons,
        db_execution_armed=db_armed,
        env_execution_armed=cfg.execution_armed,
        kill_switch=kill,
        environment=cfg.environment,
        worker_id=row["worker_id"],
        worker_heartbeat_at=row["worker_heartbeat_at"],
        reason="armed" if not reasons else "; ".join(reasons),
    )


def is_armed() -> bool:
    """True only when every gate condition holds. Fail-closed on any error."""
    return read_gate().armed


# ── Mutations (audited) ───────────────────────────────────────────────────
# Arming is an owner action, performed by an owner, through an owner-facing
# path that does not exist yet. These helpers exist so that path has a single
# audited entry point to call — they are not wired to any route in this slice.


def engage_kill_switch(actor: str, *, reason: str = "") -> GateState:
    """Halt everything: kill_switch on + every bot's trading_enabled off (spec §4).

    Deliberately asymmetric with release: it does not re-arm anything, and it is
    safe to call when already engaged.
    """
    before = read_gate()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_state
                   SET kill_switch = TRUE,
                       kill_switch_by = %s,
                       kill_switch_at = NOW(),
                       updated_at = NOW()
                 WHERE id = 1
                """,
                (actor,),
            )
            cur.execute("UPDATE exec_bots SET trading_enabled = FALSE, updated_at = NOW()")
            conn.commit()

    # Pause the queue too (slice 6): the switch is one act that stops BOTH
    # sides — no bot trades AND no queued item is claimable. Import here to keep
    # state.py free of a hard queue dependency (the gate must read even if the
    # queue table doesn't exist yet).
    try:
        from exec_service.queue import hold_all
        hold_all(actor=actor)
    except Exception:  # noqa: BLE001 — a missing queue must not block the halt
        log.exception("kill-switch engaged but queue hold failed (bots are still halted)")

    after = read_gate()
    record(
        actor=actor,
        action="kill_switch.engage",
        entity="exec_state",
        entity_id="1",
        before={"kill_switch": before.kill_switch, "armed": before.armed},
        after={"kill_switch": after.kill_switch, "armed": after.armed},
        meta={"reason": reason},
    )
    return after


def release_kill_switch(actor: str, *, reason: str = "") -> GateState:
    """Clear the kill-switch. Does NOT arm execution — that is a separate act.

    Releasing the switch only removes one of the four ANDs; the master gate
    stays closed until an owner arms it deliberately (spec §0.1).
    """
    before = read_gate()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_state
                   SET kill_switch = FALSE,
                       kill_switch_by = %s,
                       kill_switch_at = NOW(),
                       updated_at = NOW()
                 WHERE id = 1
                """,
                (actor,),
            )
            conn.commit()

    # Restore the queue the switch paused — but NOT execution. Held items become
    # claimable again; the master gate stays closed until an owner arms it.
    try:
        from exec_service.queue import release_held
        release_held(actor=actor)
    except Exception:  # noqa: BLE001
        log.exception("kill-switch released but queue release failed")

    after = read_gate()
    record(
        actor=actor,
        action="kill_switch.release",
        entity="exec_state",
        entity_id="1",
        before={"kill_switch": before.kill_switch, "armed": before.armed},
        after={"kill_switch": after.kill_switch, "armed": after.armed},
        meta={"reason": reason, "note": "release does not arm execution"},
    )
    return after


def set_execution_armed(armed: bool, actor: str, *, reason: str = "") -> GateState:
    """Set the database half of the master gate. OWNER ACTION.

    Even after this, execution stays gated behind EXECUTION_ARMED=true in the
    environment, a released kill-switch, and the testnet env-guard. No single
    call — and no single person's mistake — can arm this system.
    """
    before = read_gate()
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_state
                   SET execution_armed = %s,
                       armed_by = %s,
                       armed_at = NOW(),
                       updated_at = NOW()
                 WHERE id = 1
                """,
                (bool(armed), actor),
            )
            conn.commit()

    after = read_gate()
    record(
        actor=actor,
        action="gate.arm" if armed else "gate.disarm",
        entity="exec_state",
        entity_id="1",
        before={"execution_armed": before.db_execution_armed, "armed": before.armed},
        after={"execution_armed": after.db_execution_armed, "armed": after.armed},
        meta={"reason": reason, "effective_armed": after.armed, "gate_reason": after.reason},
    )
    return after


def heartbeat(worker_id: str) -> None:
    """Stamp the worker heartbeat (spec §2, exec_state).

    No worker exists yet; the column and this writer are here so staleness is
    observable from the first day the worker runs, rather than added after the
    first time nobody noticed it had stopped.
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE exec_state
                   SET worker_id = %s, worker_heartbeat_at = %s, updated_at = NOW()
                 WHERE id = 1
                """,
                (worker_id, datetime.now(timezone.utc)),
            )
            conn.commit()
