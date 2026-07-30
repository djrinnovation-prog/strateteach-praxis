#!/bin/bash
# Double-click to verify the execution service against a REAL local Postgres.
# Spins up a DISPOSABLE postgres:16 container (strateteach-exec-pg, port 55432),
# applies migrations 001-003, runs the full unit-test suite + the integration
# check (tools/integration_check.py). Test data only — no keys, no money, no
# connection to production. Safe to run any time.
set -e
cd "$(dirname "$0")/execution-service"

echo "==> StrateTeach execution-service — local verification"

# 1 · Docker up (starts Docker Desktop if needed)
if ! docker info >/dev/null 2>&1; then
  echo "    starting Docker Desktop..."
  open -a Docker
  until docker info >/dev/null 2>&1; do sleep 2; done
fi

# 2 · disposable Postgres
docker rm -f strateteach-exec-pg >/dev/null 2>&1 || true
echo "    starting postgres:16 on :55432 (container strateteach-exec-pg)..."
docker run -d --name strateteach-exec-pg -p 55432:5432 \
  -e POSTGRES_USER=exec -e POSTGRES_PASSWORD=exec -e POSTGRES_DB=strateteach_exec \
  postgres:16 >/dev/null
until docker exec strateteach-exec-pg pg_isready -U exec >/dev/null 2>&1; do sleep 1; done

# 3 · python env (local to execution-service/, git-ignored). Prefer the newest
#     python available; upgrade pip first (the CLT python ships an old pip that
#     can't see recent psycopg wheels).
PY="$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3)"
echo "    using $($PY --version 2>&1) at $PY"
rm -rf .venv
"$PY" -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/pip install -q "psycopg[binary]" "pytest"

export EXEC_DATABASE_URL=postgresql://exec:exec@localhost:55432/strateteach_exec

# 4 · unit tests (no DB needed) + integration against the real DB
echo "==> unit tests"
.venv/bin/python -m pytest -q
echo "==> integration check (real Postgres)"
.venv/bin/python tools/integration_check.py

echo ""
echo "==> DONE. The container keeps running for further work:"
echo "    postgresql://exec:exec@localhost:55432/strateteach_exec"
echo "    (remove with: docker rm -f strateteach-exec-pg)"
