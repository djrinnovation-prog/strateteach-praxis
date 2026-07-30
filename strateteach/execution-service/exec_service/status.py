"""`python -m exec_service.status` — print the gate, honestly.

The only entry point in this slice. It reads; it changes nothing. If the
database is unreachable it prints DISARMED with the reason, because that is
what the gate actually evaluates to — not an error the reader has to interpret.
"""
from __future__ import annotations

import sys

from exec_service import __version__
from exec_service.state import read_gate


def main() -> int:
    gate = read_gate()
    print(f"execution-service {__version__}")
    print(f"  environment          : {gate.environment}")
    print(f"  EXECUTION_ARMED (env): {gate.env_execution_armed}")
    print(f"  execution_armed (db) : {gate.db_execution_armed}")
    print(f"  kill_switch          : {'ENGAGED' if gate.kill_switch else 'released'}")
    print(f"  worker heartbeat     : {gate.worker_heartbeat_at or 'never (no worker in this slice)'}")
    try:
        from exec_service.queue import depth
        d = depth()
        print(f"  queue                : queued={d['queued']} processing={d['processing']} done={d['done']} dead={d['dead']}")
    except Exception:  # noqa: BLE001 — status must print even with no DB
        print("  queue                : unavailable (database unreachable)")
    print()
    print(f"  EFFECTIVE GATE       : {'ARMED' if gate.armed else 'DISARMED'}")
    print(f"  reason               : {gate.reason}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
