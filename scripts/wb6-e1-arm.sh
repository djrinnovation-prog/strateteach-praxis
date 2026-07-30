#!/usr/bin/env bash
#
# wb6-e1-arm.sh — ARM the WB6 worker by setting QUEUE_ENABLED=true (Doppler praxis-platform/dev).
# Prints no secret values. Triggers a Railway redeploy via the Doppler integration.
#
# After running this you MUST verify the Railway startup gate before firing (see below).
#
set -euo pipefail

echo "ARM: setting QUEUE_ENABLED=true in Doppler (praxis-platform/dev)..." >&2
# stdout (the value table) suppressed; QUEUE_ENABLED is a non-secret flag, errors still surface on stderr.
doppler secrets set QUEUE_ENABLED=true --project praxis-platform --config dev >/dev/null
echo "ARM: done -> QUEUE_ENABLED=true. Railway will redeploy." >&2

cat >&2 <<'GATE'

VERIFY the Railway startup gate BEFORE firing (Railway -> worker -> latest deploy -> Logs):
    worker_starting            queue_enabled:true   is_production:false   <- testnet safety gate
    boot_reconciliation_complete   stuck_count:0
    queue_preflight_ok
    worker_running
  NO startup / queue / database / permission / fatal errors.

If is_production != false, or queue_preflight_ok is missing, or ANY error appears:
    -> run scripts/wb6-e1-disarm.sh immediately and STOP.
GATE
