"""
DB-free characterization test for app/database.py.

The database layer is thin SQL wrappers; their observable behavior is (the SQL
executed, the params passed, the value returned). This test mocks get_conn with a
fake connection that records every execute(sql, params) and returns canned rows,
calls every public DB function with representative args, and compares the result
to a committed golden snapshot. It needs NO Postgres.

It guards refactors of database.py (e.g. the get_conn helper extraction): if any
function's SQL/params/return changes, this fails.

Run:    python3 tests/test_database_characterization.py            # check vs golden
Update: python3 tests/test_database_characterization.py --update   # re-baseline
        (only after an INTENTIONAL behavior change; eyeball the git diff)
"""
from __future__ import annotations

import datetime as _dt
import inspect
import json
import re
import sys
import types
from contextlib import contextmanager
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
GOLDEN = Path(__file__).resolve().parent / "database_characterization_golden.json"
sys.path.insert(0, str(BACKEND))

import app.database as db  # noqa: E402

_TS = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00")


class Row(dict):
    def __missing__(self, k):
        return 1


CANNED = Row(n=1, count=1, c=1, total=1, sum=1)
_LOG: list = []


class FakeCursor:
    rowcount = 1
    def fetchone(self): return Row(CANNED)
    def fetchall(self): return [Row(CANNED), Row(CANNED)]
    def __iter__(self): return iter([Row(CANNED)])


class FakeConn:
    def execute(self, sql, params=None):
        _LOG.append((" ".join(str(sql).split()), repr(params)))
        return FakeCursor()
    def cursor(self): return _Ctx()


class _Ctx:
    def __enter__(self): return FakeConn()
    def __exit__(self, *a): return False


@contextmanager
def _fake_get_conn():
    yield FakeConn()


class _FixedDateTime(_dt.datetime):
    @classmethod
    def now(cls, tz=None): return _dt.datetime(2020, 1, 1, tzinfo=tz or _dt.timezone.utc)
    @classmethod
    def utcnow(cls): return _dt.datetime(2020, 1, 1)


def _install_fakes():
    db.get_conn = _fake_get_conn
    db.now_iso = lambda: "2020-01-01T00:00:00+00:00"
    if hasattr(db, "datetime"):
        db.datetime = _FixedDateTime
    if hasattr(db, "secrets"):
        db.secrets.token_hex = lambda n=32: "deadbeef" * 4
        db.secrets.token_urlsafe = lambda n=32: "tok-fixed"


def _make_arg(param):
    if param.default is not inspect._empty:
        return param.default
    s = str(param.annotation).lower()
    name = param.name.lower()
    if "bool" in s: return True
    if "int" in s: return 1
    if "float" in s: return 1.0
    if "dict" in s or name in ("meta", "credits", "config"): return {}
    if "list" in s: return []
    return "test"


def characterize() -> dict:
    _install_fakes()
    out = {}
    for fname in sorted(dir(db)):
        if fname.startswith("_"):
            continue
        fn = getattr(db, fname)
        if not isinstance(fn, types.FunctionType) or fn.__module__ != "app.database":
            continue
        sig = inspect.signature(fn)
        try:
            args = [_make_arg(p) for p in sig.parameters.values()
                    if p.kind in (p.POSITIONAL_OR_KEYWORD, p.POSITIONAL_ONLY)]
        except Exception as e:  # noqa: BLE001
            out[fname] = {"args_error": repr(e)}
            continue
        _LOG.clear()
        try:
            ret_repr = repr(fn(*args))
        except Exception as e:  # noqa: BLE001
            ret_repr = f"EXC:{type(e).__name__}"
        out[fname] = {"sql": list(_LOG), "ret": ret_repr}
    # normalize timestamps so the snapshot is stable across clocks
    return json.loads(_TS.sub("<TS>", json.dumps(out, sort_keys=True)))


def test_database_layer_unchanged():
    assert GOLDEN.exists(), "golden snapshot missing — run with --update"
    expected = json.loads(GOLDEN.read_text())
    actual = characterize()
    missing = sorted(set(expected) - set(actual))
    added = sorted(set(actual) - set(expected))
    diffs = [k for k in set(expected) & set(actual) if expected[k] != actual[k]]
    assert not missing, f"functions disappeared: {missing}"
    assert not added, f"unexpected new functions (update golden if intended): {added}"
    assert not diffs, f"behavior changed for: {diffs}"


if __name__ == "__main__":
    if "--update" in sys.argv:
        GOLDEN.write_text(json.dumps(characterize(), indent=2, sort_keys=True) + "\n")
        print("wrote golden:", GOLDEN, f"({len(characterize())} functions)")
    else:
        try:
            test_database_layer_unchanged()
            print(f"PASS — all {len(characterize())} DB functions match golden snapshot.")
        except AssertionError as e:
            print("FAIL —", e)
            sys.exit(1)
