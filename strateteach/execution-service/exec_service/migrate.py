"""Migration runner for the execution-service schema.

Plain, ordered .sql files under ``migrations/``, applied once each and recorded
in ``exec_schema_migrations``. No Alembic: this service owns a handful of
tables whose DDL is money-critical and therefore worth reading as literal SQL
in review, not as generated autoreflection.

    python -m exec_service.migrate          # apply pending migrations
    python -m exec_service.migrate --status # list applied/pending, apply nothing
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import List, Tuple

from exec_service.config import load_config
from exec_service.db import connect

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS exec_schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
"""


def _discover() -> List[Path]:
    return sorted(p for p in MIGRATIONS_DIR.glob("*.sql") if p.is_file())


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _applied(cur) -> dict:
    cur.execute("SELECT filename, checksum FROM exec_schema_migrations")
    return {r["filename"]: r["checksum"] for r in cur.fetchall()}


def status() -> Tuple[List[str], List[str]]:
    """Return (applied, pending) filenames without changing anything."""
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_TRACKING_TABLE)
            conn.commit()
            done = _applied(cur)
    files = [p.name for p in _discover()]
    return [f for f in files if f in done], [f for f in files if f not in done]


def migrate() -> List[str]:
    """Apply pending migrations in filename order. Returns what was applied.

    An already-applied file whose contents changed is a hard error, not a
    re-run: editing shipped DDL in place would let two environments silently
    disagree about the shape of the tables that guard real money.
    """
    # Fails here on ENVIRONMENT=mainnet — the schema is not created at all in
    # an environment this build refuses to run in.
    cfg = load_config()

    applied_now: List[str] = []
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_TRACKING_TABLE)
            conn.commit()
            done = _applied(cur)

            for path in _discover():
                digest = _checksum(path)
                if path.name in done:
                    if done[path.name] != digest:
                        raise RuntimeError(
                            f"{path.name} was modified after being applied "
                            f"(checksum mismatch). Add a new migration instead "
                            f"of editing an applied one."
                        )
                    continue

                # Each file manages its own BEGIN/COMMIT so a file can opt into
                # its own transaction shape; psycopg's implicit transaction
                # wraps the rest.
                cur.execute(path.read_text())
                cur.execute(
                    "INSERT INTO exec_schema_migrations (filename, checksum) VALUES (%s, %s)",
                    (path.name, digest),
                )
                conn.commit()
                applied_now.append(path.name)

    print(f"environment={cfg.environment} · applied {len(applied_now)} migration(s)")
    for name in applied_now:
        print(f"  + {name}")
    return applied_now


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="execution-service migrations")
    parser.add_argument("--status", action="store_true", help="show applied/pending, apply nothing")
    args = parser.parse_args(argv)

    if args.status:
        done, pending = status()
        print("applied:")
        for name in done:
            print(f"  ✓ {name}")
        print("pending:")
        for name in pending:
            print(f"  · {name}")
        return 0

    migrate()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
