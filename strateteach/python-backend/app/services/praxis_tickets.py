"""StrateTeach → Praxis provisioning tickets (unification #2). StrateTeach (which authenticates the
user) mints SHORT-LIVED, SINGLE-USE, ACTION-BOUND, SIGNED tickets authorizing the browser to create a
bot / attach a key in Praxis. StrateTeach holds the ticket-signing key (PRAXIS_PROVISION_KEY_HEX, given
by the operator) — it NEVER holds an exchange key. The browser then posts {ticket, ...} straight to
Praxis; StrateTeach is out of the key path. Mirrors Praxis _shared/provision-ticket.ts sign format."""
import base64, hashlib, hmac, json, os, time, uuid

_KEY_HEX = os.getenv("PRAXIS_PROVISION_KEY_HEX", "")


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _sign(payload: dict) -> str:
    if not _KEY_HEX:
        raise RuntimeError("PRAXIS_PROVISION_KEY_HEX not configured")
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(bytes.fromhex(_KEY_HEX), body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def create_bot_ticket(praxis_user_id: str, ttl_s: int = 120) -> str:
    return _sign({"praxis_user_id": praxis_user_id, "action": "create_bot",
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def connect_credential_ticket(praxis_user_id: str, praxis_bot_id: str, exchange_ccxt_id: str,
                              env: str, ttl_s: int = 120) -> str:
    return _sign({"praxis_user_id": praxis_user_id, "action": "connect_credential",
                  "praxis_bot_id": praxis_bot_id, "exchange_ccxt_id": exchange_ccxt_id, "env": env,
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})
