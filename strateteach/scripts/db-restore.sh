#!/usr/bin/env bash
# Restore a Postgres backup produced by db-backup.sh into the `db` compose service.
# DESTRUCTIVE: overwrites the current database. Run a restore drill periodically
# so you know your backups actually work (PRR §12).
#
#   ./scripts/db-restore.sh ./backups/algo770_20260610_030000.sql.gz
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

FILE="${1:-}"
[ -z "$FILE" ] && { echo "usage: $0 <backup.sql.gz>" >&2; exit 1; }
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

PGUSER="${POSTGRES_USER:-algo770}"
PGDB="${POSTGRES_DB:-algo770}"

read -r -p "This will OVERWRITE database '$PGDB'. Type the db name to confirm: " ans
[ "$ans" = "$PGDB" ] || { echo "aborted." >&2; exit 1; }

echo "[$(date -Is)] restoring $FILE → $PGDB"
gunzip -c "$FILE" | docker compose exec -T db psql -U "$PGUSER" -d "$PGDB"
echo "[$(date -Is)] restore complete"
