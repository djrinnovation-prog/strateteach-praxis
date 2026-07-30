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


_STREF_DOMAIN = "praxis.stref.v1|"


def derive_st_ref(user_uid: str) -> str:
    """Opaque, deterministic, non-recyclable StrateTeach handle for Praxis: base64url(HMAC(key,
    "praxis.stref.v1|" + user_uid)). Keyed off the IMMUTABLE user_uid (never the recyclable username), so a
    freed/renamed username can never resolve to a prior identity. HMAC-SHA256 = 32 bytes → 43-char CANONICAL
    base64url (the padding bits are zero), which is exactly what Praxis verifyTicket requires. Domain-
    separated from ticket signing ('praxis.provision.ticket.v1' is the material domain; this is the message)."""
    if not _KEY_HEX:
        raise RuntimeError("PRAXIS_PROVISION_KEY_HEX not configured")
    mac = hmac.new(bytes.fromhex(_KEY_HEX), (_STREF_DOMAIN + str(user_uid)).encode(), hashlib.sha256).digest()
    return _b64url(mac)


def provision_user_ticket(st_ref: str, ttl_s: int = 120) -> str:
    """Identity BOOTSTRAP ticket (no praxis_user_id yet). Carries the st_ref; Praxis provision-user maps it
    to one shadow auth.users."""
    return _sign({"praxis_user_id": "", "action": "provision_user", "st_ref": st_ref,
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def create_bot_ticket(praxis_user_id: str, ttl_s: int = 120) -> str:
    return _sign({"praxis_user_id": praxis_user_id, "action": "create_bot",
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def read_status_ticket(praxis_user_id: str, ttl_s: int = 240) -> str:
    """MULTI-use read token for bot-status (Praxis does NOT claim its jti). exp-bounded; kept BELOW the
    Praxis MAX_TICKET_TTL_S (300s) so there is clock-skew + latency headroom (an exp exactly at the cap
    would 401 the moment Praxis's clock trails StrateTeach). The dashboard re-mints per window."""
    return _sign({"praxis_user_id": praxis_user_id, "action": "read_status",
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def pause_bot_ticket(praxis_user_id: str, praxis_bot_id: str, ttl_s: int = 120) -> str:
    """Single-use KILL ticket for pause-bot (StrateTeach-minted path). The long-lived per-bot pause token
    (from create-bot) is the StrateTeach-independent alternative (INV-8)."""
    return _sign({"praxis_user_id": praxis_user_id, "action": "pause_bot", "praxis_bot_id": praxis_bot_id,
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def arm_bot_ticket(praxis_user_id: str, praxis_bot_id: str, ttl_s: int = 120) -> str:
    """Single-use ticket to arm a bot to LIVE (Praxis arm-bot gates on credential='valid' + not mainnet)."""
    return _sign({"praxis_user_id": praxis_user_id, "action": "arm_bot", "praxis_bot_id": praxis_bot_id,
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def validate_credential_ticket(praxis_user_id: str, praxis_bot_id: str, ttl_s: int = 120) -> str:
    """Single-use ticket to request EP6 validation of a bot's credential (Praxis enqueues a worker job)."""
    return _sign({"praxis_user_id": praxis_user_id, "action": "validate_credential", "praxis_bot_id": praxis_bot_id,
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})


def connect_credential_ticket(praxis_user_id: str, praxis_bot_id: str, exchange_ccxt_id: str,
                              env: str, ttl_s: int = 120) -> str:
    return _sign({"praxis_user_id": praxis_user_id, "action": "connect_credential",
                  "praxis_bot_id": praxis_bot_id, "exchange_ccxt_id": exchange_ccxt_id, "env": env,
                  "jti": "st-" + uuid.uuid4().hex, "exp": int(time.time()) + ttl_s})
