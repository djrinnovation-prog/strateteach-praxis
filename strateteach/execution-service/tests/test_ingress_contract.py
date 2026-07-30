"""The signed-signal contract (spec §3), as tests. No database needed here —
the contract layer is pure, and ingress fail-closed paths are exercised by
pointing at a dead database / an empty secret."""
from __future__ import annotations

import time

import pytest

from exec_service.envelope import (
    ContractError,
    canonical_message,
    check_freshness,
    compute_signature,
    validate_structure,
    verify_signature,
)
from exec_service.ingress import ingest

SECRET = "test-signing-secret-not-a-real-one"


def _payload(**over):
    p = {"bot": "btc-testnet", "signal_id": "tv-0001", "action": "buy", "ts": int(time.time())}
    p.update(over)
    return p


# ── envelope-only: the payload carries INTENT, nothing else ────────────────

@pytest.mark.parametrize("field,value", [
    ("quantity", 3), ("qty", "0.5"), ("amount", 100), ("size", 1), ("notional", 50),
    ("price", 64000), ("symbol", "BTCUSDT"), ("pair", "BTC/USDT"), ("account", "main"),
    ("api_key", "x"), ("secret", "y"), ("passphrase", "z"), ("private_key", "k"),
])
def test_forbidden_fields_are_rejected_by_name(field, value):
    with pytest.raises(ContractError) as e:
        validate_structure(_payload(**{field: value}))
    assert e.value.reason == "envelope_violation"


def test_unknown_fields_are_rejected():
    with pytest.raises(ContractError) as e:
        validate_structure(_payload(surprise="!"))
    assert e.value.reason == "envelope_violation"


@pytest.mark.parametrize("missing", ["bot", "signal_id", "action", "ts"])
def test_missing_required_fields_are_rejected(missing):
    p = _payload()
    del p[missing]
    with pytest.raises(ContractError) as e:
        validate_structure(p)
    assert e.value.reason == "malformed"


def test_only_buy_and_sell_are_actions():
    with pytest.raises(ContractError):
        validate_structure(_payload(action="short_everything"))


def test_signal_id_is_never_synthesised():
    with pytest.raises(ContractError):
        validate_structure(_payload(signal_id="   "))


# ── HMAC: constant-time, canonical, no oracle ──────────────────────────────

def test_signature_roundtrip():
    p = _payload()
    sig = compute_signature(SECRET, p)
    verify_signature(SECRET, p, sig)  # does not raise


def test_tampered_payload_fails_verification():
    p = _payload()
    sig = compute_signature(SECRET, p)
    p["action"] = "sell"  # flip the intent after signing
    with pytest.raises(ContractError) as e:
        verify_signature(SECRET, p, sig)
    assert e.value.reason == "bad_signature"


def test_wrong_secret_fails_verification():
    p = _payload()
    sig = compute_signature("some-other-secret", p)
    with pytest.raises(ContractError) as e:
        verify_signature(SECRET, p, sig)
    assert e.value.reason == "bad_signature"


@pytest.mark.parametrize("bad", [None, "", "not-hex", "deadbeef"])
def test_missing_or_malformed_signature_is_one_uniform_failure(bad):
    with pytest.raises(ContractError) as e:
        verify_signature(SECRET, _payload(), bad)
    assert e.value.reason == "bad_signature"


def test_empty_secret_accepts_nothing():
    """Fail-closed: an unconfigured verifier is a closed door, not an open one."""
    p = _payload()
    with pytest.raises(ContractError) as e:
        verify_signature("", p, compute_signature(SECRET, p))
    assert e.value.reason == "unconfigured"


def test_canonicalisation_is_order_independent():
    a = {"bot": "b", "signal_id": "s", "action": "buy", "ts": 5}
    b = {"ts": 5, "action": "buy", "signal_id": "s", "bot": "b"}
    assert canonical_message(a) == canonical_message(b)
    assert compute_signature(SECRET, a) == compute_signature(SECRET, b)


def test_verification_uses_constant_time_compare():
    """Belt & braces: the module must go through hmac.compare_digest, never ==."""
    import inspect
    from exec_service import envelope
    src = inspect.getsource(envelope.verify_signature)
    assert "compare_digest" in src


# ── freshness: a signal is for NOW ──────────────────────────────────────────

def test_stale_signal_is_expired():
    now = int(time.time())
    with pytest.raises(ContractError) as e:
        check_freshness(_payload(ts=now - 3600), now_ts=now)
    assert e.value.reason == "expired"


def test_future_signal_is_expired():
    now = int(time.time())
    with pytest.raises(ContractError) as e:
        check_freshness(_payload(ts=now + 3600), now_ts=now)
    assert e.value.reason == "expired"


def test_fresh_signal_passes():
    now = int(time.time())
    check_freshness(_payload(ts=now - 5), now_ts=now)  # does not raise


# ── ingress fail-closed paths (no working database on purpose) ──────────────

def test_ingress_without_secret_rejects_before_touching_the_db(monkeypatch):
    """No signing secret → reject. The dead DB proves the DB was never reached."""
    monkeypatch.delenv("EXEC_SIGNAL_HMAC_SECRET", raising=False)
    monkeypatch.setenv("EXEC_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    p = _payload()
    res = ingest(p, compute_signature(SECRET, p))
    assert res.status == "rejected"
    assert res.reason == "unconfigured"


def test_ingress_rejects_bad_signature_before_touching_the_db(monkeypatch):
    monkeypatch.setenv("EXEC_SIGNAL_HMAC_SECRET", SECRET)
    monkeypatch.setenv("EXEC_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    res = ingest(_payload(), "ffff")
    assert res.status == "rejected"
    assert res.reason == "bad_signature"


def test_ingress_expires_stale_signals_before_touching_the_db(monkeypatch):
    monkeypatch.setenv("EXEC_SIGNAL_HMAC_SECRET", SECRET)
    monkeypatch.setenv("EXEC_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    p = _payload(ts=int(time.time()) - 3600)
    res = ingest(p, compute_signature(SECRET, p))
    assert res.status == "expired"
    assert res.reason == "expired"


def test_ingress_raises_on_infrastructure_failure_for_valid_signals(monkeypatch):
    """A VALID signal + dead DB = infrastructure error (transport answers 5xx,
    the sender retries) — never a silent business 'rejected'."""
    monkeypatch.setenv("EXEC_SIGNAL_HMAC_SECRET", SECRET)
    monkeypatch.setenv("EXEC_DATABASE_URL", "postgresql://nobody@127.0.0.1:1/nope")
    p = _payload()
    with pytest.raises(Exception):
        ingest(p, compute_signature(SECRET, p))
