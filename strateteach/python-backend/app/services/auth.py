"""
Auth service for 770 Trend Diamonds.

The whole backend API is bearer-token gated by a global middleware (see main.py),
with only /healthz and /auth/login on the allowlist. Money-moving /exchange/*
endpoints are additionally gated by a user-set PIN (X-Exchange-Pin header) — that
PIN logic lives with the exchange service in a later milestone.

Uses stdlib pbkdf2-hmac for password hashing so there are no extra native deps.
Hash format:  pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets

_ITERATIONS = 200_000
_ALGO = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters_s, salt_hex, hash_hex = stored.split("$")
        if algo != _ALGO:
            return False
        iterations = int(iters_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(dk, expected)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def bearer_from_header(authorization: str | None) -> str | None:
    """Extract the token from an 'Authorization: Bearer <token>' header."""
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None
