#!/usr/bin/env bash
#
# wb6-e1-disarm.sh — DISARM the WB6 worker by setting QUEUE_ENABLED=false (Doppler praxis-platform/dev).
# Prints no secret values. Run immediately after the single fire, on success OR failure.
#
set -euo pipefail

echo "DISARM: setting QUEUE_ENABLED=false in Doppler (praxis-platform/dev)..." >&2
doppler secrets set QUEUE_ENABLED=false --project praxis-platform --config dev >/dev/null
echo "DISARM: done -> QUEUE_ENABLED=false. Railway will redeploy -> expect worker_queue_disabled." >&2
