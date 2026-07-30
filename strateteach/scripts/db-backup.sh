#!/usr/bin/env bash
# Nightly Postgres backup for a self-hosted ALGO770 install.
# Dumps the database from the running `db` compose service to a gzipped file,
# then prunes backups older than RETENTION_DAYS. Safe to run from cron.
#
#   crontab -e
#   0 3 * * *  cd /opt/algo770 && ./scripts/db-backup.sh >> /var/log/algo770-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."                 # repo root (compose project dir)
[ -f .env ] && set -a && . ./.env && set +a

PGUSER="${POSTGRES_USER:-algo770}"
PGDB="${POSTGRES_DB:-algo770}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
FILE="$OUT_DIR/algo770_${STAMP}.sql.gz"

echo "[$(date -Is)] backing up $PGDB → $FILE"
docker compose exec -T db pg_dump -U "$PGUSER" "$PGDB" | gzip > "$FILE"

# Verify the dump is non-trivial before trusting it.
SIZE="$(stat -f%z "$FILE" 2>/dev/null || stat -c%s "$FILE")"
if [ "${SIZE:-0}" -lt 100 ]; then
  echo "[$(date -Is)] ERROR: backup file is suspiciously small ($SIZE bytes)" >&2
  exit 1
fi

# Prune old backups.
find "$OUT_DIR" -name 'algo770_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -delete
echo "[$(date -Is)] done · kept $(ls -1 "$OUT_DIR"/algo770_*.sql.gz 2>/dev/null | wc -l | tr -d ' ') backups"
