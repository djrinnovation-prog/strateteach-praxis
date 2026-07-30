"""The signed-signal CONTRACT (spec §3) — pure functions, no I/O.

A signal is an INTENT envelope: which bot, which source-signal id, buy or sell.
Nothing else. The contract is enforced structurally here, before any database
or (future) transport is involved:

* **Envelope-only** — a payload carrying quantity, symbol, account or anything
  key-shaped is REJECTED outright (spec §0.4/§3: sizing and symbol live in
  ``exec_bots`` config, server-side; keys live in the vault, nowhere near a
  signal).
* **HMAC-SHA256** over a canonical string, verified in constant time
  (``hmac.compare_digest``). The signing secret is server-side and rotating
  (spec §3); it reaches this module as an argument — this module never reads
  the environment, never logs, and never stores it.
* **Freshness** — a unix ``ts`` is mandatory; stale or future-dated envelopes
  are rejected (dedup alone cannot stop a replayed intent tomorrow).

No exchange code, no HTTP, no secrets at rest. The worker does not exist yet;
nothing here executes anything.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any, Mapping, Optional

# The COMPLETE envelope. Anything else in the payload is a contract violation.
ALLOWED_FIELDS = frozenset({"bot", "signal_id", "action", "fire_time", "ts", "nonce"})
REQUIRED_FIELDS = frozenset({"bot", "signal_id", "action", "ts"})

# Structural defence for envelope-only: these keys are rejected BY NAME so a
# mis-integrated sender fails loudly, not silently. (Unknown keys are rejected
# too — this list exists for the explicit, auditable reason string.)
FORBIDDEN_FIELDS = frozenset({
    "quantity", "qty", "amount", "size", "notional", "price",
    "symbol", "pair", "market", "account", "subaccount",
    "api_key", "apikey", "secret", "passphrase", "token", "private_key",
})

ALLOWED_ACTIONS = frozenset({"buy", "sell"})

# Freshness window (seconds). Callers may override; the defaults are the spec's
# intent: a signal is an instruction for NOW, not a durable order.
DEFAULT_MAX_AGE_SEC = 90
DEFAULT_MAX_SKEW_SEC = 30


@dataclass(frozen=True)
class ContractError(Exception):
    """A payload that violates the contract. `reason` is a stable slug for the
    signal row / audit line; `detail` is the human sentence."""

    reason: str
    detail: str

    def __str__(self) -> str:  # pragma: no cover
        return f"{self.reason}: {self.detail}"


def validate_structure(payload: Mapping[str, Any]) -> None:
    """Envelope-only, enforced. Raises ContractError on the FIRST violation."""
    if not isinstance(payload, Mapping):
        raise ContractError("malformed", "payload is not an object")
    keys = {str(k).strip().lower() for k in payload.keys()}
    banned = keys & FORBIDDEN_FIELDS
    if banned:
        raise ContractError(
            "envelope_violation",
            f"forbidden field(s) {sorted(banned)} — a signal carries intent only "
            f"(no quantity, no symbol, no account, no key material)",
        )
    unknown = keys - ALLOWED_FIELDS
    if unknown:
        raise ContractError("envelope_violation", f"unknown field(s) {sorted(unknown)}")
    missing = REQUIRED_FIELDS - keys
    if missing:
        raise ContractError("malformed", f"missing required field(s) {sorted(missing)}")

    action = str(payload.get("action") or "").strip().lower()
    if action not in ALLOWED_ACTIONS:
        raise ContractError("malformed", f"action must be one of {sorted(ALLOWED_ACTIONS)}")
    if not str(payload.get("bot") or "").strip():
        raise ContractError("malformed", "bot must be a non-empty name")
    if not str(payload.get("signal_id") or "").strip():
        # NEVER synthesised — a missing source id would silently break dedup.
        raise ContractError("malformed", "signal_id must be supplied by the source")
    try:
        int(payload["ts"])
    except (KeyError, TypeError, ValueError):
        raise ContractError("malformed", "ts must be a unix timestamp (seconds)")


def canonical_message(payload: Mapping[str, Any]) -> str:
    """The string that gets signed: the envelope fields, sorted, JSON-encoded
    with no whitespace ambiguity. Canonicalisation means sender and verifier
    can never disagree about byte order/spacing."""
    body = {k: payload[k] for k in sorted(ALLOWED_FIELDS & set(payload.keys()))}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_signature(secret: str, payload: Mapping[str, Any]) -> str:
    """HMAC-SHA256 hex digest of the canonical message. For the SENDER side
    (and for tests). The secret is used and dropped — never stored or logged."""
    if not secret:
        raise ContractError("unconfigured", "signing secret is empty")
    return hmac.new(secret.encode("utf-8"), canonical_message(payload).encode("utf-8"), hashlib.sha256).hexdigest()


def verify_signature(secret: str, payload: Mapping[str, Any], provided: Optional[str]) -> None:
    """Constant-time verification. Raises ContractError on mismatch. A missing
    or malformed signature is the same failure as a wrong one — one reason
    slug, no oracle for attackers."""
    if not secret:
        # Fail-closed: an unconfigured verifier accepts NOTHING.
        raise ContractError("unconfigured", "ingress has no signing secret configured")
    expected = compute_signature(secret, payload)
    given = str(provided or "").strip().lower()
    if not given or not hmac.compare_digest(expected, given):
        raise ContractError("bad_signature", "HMAC signature missing or invalid")


def check_freshness(
    payload: Mapping[str, Any],
    *,
    now_ts: int,
    max_age_sec: int = DEFAULT_MAX_AGE_SEC,
    max_skew_sec: int = DEFAULT_MAX_SKEW_SEC,
) -> None:
    """A signal is for NOW: too old → replay/queue-lag, reject; too far in the
    future → clock games, reject. Both are 'expired' business outcomes."""
    ts = int(payload["ts"])
    if ts < now_ts - int(max_age_sec):
        raise ContractError("expired", f"signal is older than {max_age_sec}s")
    if ts > now_ts + int(max_skew_sec):
        raise ContractError("expired", f"signal is {ts - now_ts}s in the future (max skew {max_skew_sec}s)")
