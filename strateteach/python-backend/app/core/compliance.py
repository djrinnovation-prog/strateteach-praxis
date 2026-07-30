"""Compliance guards (owner-approved 2026-07-18) — BTC-only + client-autopilot freeze.

Pure, dependency-light helpers used at every client trading choke point. The
policy background is the Raz regulatory meeting: restricting a client to Bitcoin
(not a security) is the narrowest legally-safe scope, and the client-facing
autonomous-execution path is the highest regulatory exposure.

Both guards are FAIL-OPEN-BY-DEFAULT only in the sense that their DB flags default
to the safe posture (BTC-only OFF = no restriction yet; autopilot freeze ON =
closed). Owners are always exempt so they can keep testing.

Nothing here talks to an exchange or moves money — these only decide allow/deny.
"""
from __future__ import annotations

from fastapi import HTTPException

from app import database as db
from app.core.security import is_owner

# A pair is "Bitcoin" if its BASE asset is BTC (or the legacy XBT ticker). We look
# at the base only — BTC/USDT, BTCUSDT, BTC/USD, BTC-USDT all pass; ETH/BTC does
# NOT (its base is ETH, i.e. the client would be trading Ether).
_BTC_BASES = ("BTC", "XBT")


def is_btc_pair(symbol: str | None) -> bool:
    if not symbol:
        return False
    s = str(symbol).strip().upper().replace("-", "/").replace("_", "/")
    # Normalise a compact BTCUSDT → BTC/USDT for the base check.
    if "/" not in s:
        for q in ("USDT", "USDC", "USD", "BUSD", "FDUSD", "EUR", "ILS"):
            if s.endswith(q) and len(s) > len(q):
                s = s[: -len(q)] + "/" + q
                break
    base = s.split("/", 1)[0]
    return base in _BTC_BASES


def is_restricted_client(username: str | None) -> bool:
    """True for a regular client; False for owners AND role=='admin' (exempt so
    they can test other pairs). An unknown/empty user is treated as restricted
    (fail-closed on identity)."""
    if not username:
        return True
    if is_owner(username):
        return False
    try:
        u = db.get_user(username) or {}
    except Exception:  # noqa: BLE001
        return True
    return (u.get("role") or "") != "admin"


def assert_btc_only_ok(username: str | None, symbol: str | None) -> None:
    """Raise 403 if the BTC-only compliance flag is ON, the caller is a restricted
    client, and the symbol is not a Bitcoin pair. No-op when the flag is OFF
    (the default) — so this changes nothing until the owners enable it."""
    if not db.get_btc_only_cached():
        return
    if not is_restricted_client(username):
        return
    if not is_btc_pair(symbol):
        raise HTTPException(
            status_code=403,
            detail="Trading is currently limited to Bitcoin (BTC) pairs.",
        )


def filter_btc_only(username: str | None, symbols):
    """Return only the BTC pairs from `symbols` when the flag is ON and the caller
    is a restricted client; otherwise return `symbols` unchanged. Used where a
    universe/list is chosen (paper picks, backtest symbols) rather than one order."""
    if not symbols or not db.get_btc_only_cached() or not is_restricted_client(username):
        return symbols
    return [s for s in symbols if is_btc_pair(s)]


def client_autopilot_frozen(username: str | None) -> bool:
    """True when the client-autopilot freeze is ON and the caller is a restricted
    client. Owners are never frozen. Default flag is ON (frozen)."""
    if not is_restricted_client(username):
        return False
    try:
        return db.get_client_autopilot_frozen()
    except Exception:  # noqa: BLE001 — fail CLOSED for the risky path
        return True
