"""Guard test for Phase 2C·M1 — the immutable identity root `user_uid`.

`user_uid` must be **DB-generated only**: no application SQL may ever INSERT or UPDATE it. Its security value
(a non-recyclable identity root the Praxis st_ref derives from) rests on that. The DB enforces immutability
on UPDATE (trigger) and uniqueness (constraint); this test enforces the INSERT side by convention — it fails
if any app SQL writes user_uid, which is exactly the 'supply a recycled uid' path the auditors flagged.

Run directly:  python3 tests/test_user_uid_invariant.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # python-backend/
APP = os.path.join(ROOT, "app")

# Write patterns: `SET user_uid ...`, or `user_uid` inside an `INSERT INTO users (...)` column list.
_SET = re.compile(r"\bset\s+user_uid\b", re.IGNORECASE)
_INS = re.compile(r"insert\s+into\s+users\s*\([^)]*\buser_uid\b", re.IGNORECASE | re.DOTALL)


def _iter_py():
    for dp, _, files in os.walk(APP):
        if "__pycache__" in dp:
            continue
        for fn in files:
            if fn.endswith(".py"):
                yield os.path.join(dp, fn)


def test_no_app_sql_writes_user_uid():
    offenders = []
    for path in _iter_py():
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
        rel = os.path.relpath(path, ROOT)
        for m in _SET.finditer(text):
            offenders.append(f"{rel}: `SET user_uid` near offset {m.start()}")
        for m in _INS.finditer(text):
            offenders.append(f"{rel}: INSERT INTO users lists user_uid near offset {m.start()}")
    assert not offenders, "app SQL must never write user_uid (DB-generated only): " + "; ".join(offenders)
    print("  ✓ no app SQL writes user_uid (DB-generated only) — %d files scanned" % sum(1 for _ in _iter_py()))


def test_migration_defines_the_invariant():
    """Sanity: the M1 migration (column + immutability trigger) is present exactly once."""
    db = open(os.path.join(APP, "database.py"), "r", encoding="utf-8", errors="ignore").read()
    assert db.count("ADD COLUMN IF NOT EXISTS user_uid") == 1, "user_uid column migration should appear once"
    assert "trg_user_uid_immutable" in db and "ENABLE ALWAYS TRIGGER trg_user_uid_immutable" in db, \
        "immutability trigger + ENABLE ALWAYS must be present"
    print("  ✓ M1 migration present: user_uid column + ENABLE ALWAYS immutability trigger")


if __name__ == "__main__":
    test_no_app_sql_writes_user_uid()
    test_migration_defines_the_invariant()
    print("\nUSER_UID INVARIANT CHECKS PASSED ✓")
