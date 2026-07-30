"""Phase 2C (Option A) · M3 — StrateTeach's Praxis provisioning routes (the SOLE identity trust boundary).

StrateTeach authenticates the user (opaque session → username); THIS module derives the Praxis identity
SERVER-SIDE from that session and mints signed tickets. The browser never supplies praxis_user_id / st_ref
(INV-1). No exchange key ever touches these routes — they only mint tickets and provision the shadow
identity; the key goes browser→Praxis (connect-credential) directly.

Endpoints (all behind Depends(current_user) + PRAXIS_PROVISION_ENABLED + a per-user rate limit):
  POST /praxis/link               ensure this user has a Praxis identity (idempotent provision-user)
  POST /praxis/bot-ticket         mint a create_bot ticket for the session user
  POST /praxis/credential-ticket  mint a connect_credential ticket (venue + mainnet-env gated)

Dormant by default (PRAXIS_PROVISION_ENABLED unset ⇒ 503).
"""
import os
import re
import time
import threading

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user
from app.services import praxis_tickets as tickets

router = APIRouter(tags=["praxis-provision"])

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _enabled() -> bool:
    return os.getenv("PRAXIS_PROVISION_ENABLED", "").strip().lower() == "true"


def _key_configured() -> bool:
    """PRAXIS_PROVISION_KEY_HEX must be present + valid hex, else ticket minting throws deep in the request
    (a 500). Validate up front so a misconfig is a clean 503, matching _praxis_base()."""
    k = os.getenv("PRAXIS_PROVISION_KEY_HEX", "")
    if not k:
        return False
    try:
        bytes.fromhex(k)
        return True
    except ValueError:
        return False


def _praxis_base() -> str:
    base = os.getenv("PRAXIS_WEBHOOK_BASE", "").rstrip("/")
    if not base:
        raise HTTPException(503, "praxis_base_unconfigured")
    # The provision-user response carries the (unauthenticated) praxis_user_id we persist forever; require
    # TLS so it can't be MITM-injected. Local dev sets PRAXIS_ALLOW_INSECURE_BASE=true to allow http.
    if not base.startswith("https://") and os.getenv("PRAXIS_ALLOW_INSECURE_BASE", "").strip().lower() != "true":
        raise HTTPException(503, "praxis_base_insecure")
    return base


# ── Per-user rate limit (in-process token bucket). NOTE: single-instance only; a multi-instance deploy
# MUST move this to a shared store (Redis/DB) — the audit flagged this. Bounded to keep provisioning/ticket
# minting from being hammered per user.
_RL_LOCK = threading.Lock()
_RL: dict[str, list] = {}          # key -> [count, window_start]
_RL_MAX = int(os.getenv("PRAXIS_PROVISION_RL_MAX", "30"))
_RL_WINDOW_S = 60


def _rate_limit(user: str, route: str) -> None:
    key = user + "|" + route
    now = time.time()
    with _RL_LOCK:
        slot = _RL.get(key)
        if not slot or now - slot[1] > _RL_WINDOW_S:
            _RL[key] = [1, now]
            return
        if slot[0] >= _RL_MAX:
            raise HTTPException(429, "rate_limited")
        slot[0] += 1


def _guard(user: str, route: str) -> dict:
    """Common gate: feature-flag + rate-limit + resolve the caller's Praxis identity mapping."""
    if not _enabled():
        raise HTTPException(503, "praxis_provisioning_disabled")
    if not _key_configured():
        raise HTTPException(503, "praxis_provisioning_misconfigured")
    _rate_limit(user, route)
    ident = db.get_praxis_identity(user)
    if not ident or not ident.get("user_uid"):
        raise HTTPException(404, "user_not_found")
    return ident


@router.post("/praxis/link")
def praxis_link(user: str = Depends(current_user)) -> dict:
    """Ensure the session user has a Praxis identity. Idempotent: if already linked, returns immediately;
    else derives st_ref from the IMMUTABLE user_uid, mints a provision_user ticket, calls Praxis
    provision-user, and stores the returned praxis_user_id (only if not already set — never repoint)."""
    ident = _guard(user, "link")
    if ident.get("praxis_user_id"):
        return {"linked": True, "already": True}
    st_ref = tickets.derive_st_ref(ident["user_uid"])
    ticket = tickets.provision_user_ticket(st_ref)
    try:
        r = httpx.post(_praxis_base() + "/functions/v1/provision-user",
                       json={"ticket": ticket}, timeout=float(os.getenv("PRAXIS_PROVISION_TIMEOUT_S", "8") or 8))
    except Exception:
        raise HTTPException(502, "praxis_unreachable")
    if r.status_code not in (200, 201):
        raise HTTPException(502, "praxis_provision_failed")
    try:
        data = r.json() or {}
    except Exception:
        raise HTTPException(502, "praxis_provision_bad_body")
    puid = data.get("praxis_user_id")
    if not isinstance(puid, str) or not _UUID_RE.match(puid):
        raise HTTPException(502, "praxis_provision_bad_id")
    # Defense-in-depth against a spoofed/mis-mapped response: the identity Praxis linked must be for OUR
    # st_ref (echoed back), i.e. the one we derived from THIS user's immutable user_uid — never a victim's.
    if data.get("st_ref") != st_ref:
        raise HTTPException(502, "praxis_provision_stref_mismatch")
    try:
        eff = db.set_praxis_user_id(user, puid)   # idempotent; returns the effective (winning) id
    except Exception:
        # UNIQUE(praxis_user_id) violation ⇒ this id already belongs to another account (invariant break).
        raise HTTPException(409, "praxis_identity_conflict")
    if not eff:
        raise HTTPException(404, "user_not_found")
    if eff != puid:   # our row was already mapped to a DIFFERENT id (never repoint) ⇒ surface the conflict
        raise HTTPException(409, "praxis_identity_conflict")
    return {"linked": True}


@router.post("/praxis/bot-ticket")
def praxis_bot_ticket(user: str = Depends(current_user)) -> dict:
    """Mint a create_bot ticket for the session user's Praxis identity (must be linked first)."""
    ident = _guard(user, "bot-ticket")
    puid = ident.get("praxis_user_id")
    if not puid:
        raise HTTPException(409, "not_linked")
    return {"ticket": tickets.create_bot_ticket(puid)}


class CredentialTicketReq(BaseModel):
    bot_id: str
    exchange: str
    env: str


@router.post("/praxis/credential-ticket")
def praxis_credential_ticket(body: CredentialTicketReq, user: str = Depends(current_user)) -> dict:
    """Mint a connect_credential ticket. env is validated + the mainnet gate is enforced against the
    OPERATOR-approved users.praxis_env (never elevated by the user). praxis_user_id comes from the session,
    never the body (INV-1) — so a user can only ever mint a ticket for their own identity."""
    ident = _guard(user, "credential-ticket")
    puid = ident.get("praxis_user_id")
    if not puid:
        raise HTTPException(409, "not_linked")
    bot_id = (body.bot_id or "").strip()
    exchange = (body.exchange or "").strip().lower()
    env = (body.env or "").strip().lower()
    if not bot_id or not exchange:
        raise HTTPException(400, "bad_request")
    if env not in ("testnet", "mainnet"):
        raise HTTPException(400, "bad_env")
    if env == "mainnet" and ident.get("praxis_env") != "mainnet":
        raise HTTPException(403, "mainnet_not_approved")
    return {"ticket": tickets.connect_credential_ticket(puid, bot_id, exchange, env)}


@router.post("/praxis/status-ticket")
def praxis_status_ticket(user: str = Depends(current_user)) -> dict:
    """Mint a MULTI-use read_status ticket for the session user (dashboard → Praxis bot-status)."""
    ident = _guard(user, "status-ticket")
    puid = ident.get("praxis_user_id")
    if not puid:
        raise HTTPException(409, "not_linked")
    return {"ticket": tickets.read_status_ticket(puid)}


class PauseTicketReq(BaseModel):
    bot_id: str


@router.post("/praxis/pause-ticket")
def praxis_pause_ticket(body: PauseTicketReq, user: str = Depends(current_user)) -> dict:
    """Mint a single-use pause_bot (KILL) ticket for the session user's bot. Ownership is enforced by Praxis
    pause-bot via the praxis_user_id in the ticket. (The long-lived per-bot pause_token from create-bot is
    the StrateTeach-independent kill path — INV-8.)"""
    ident = _guard(user, "pause-ticket")
    puid = ident.get("praxis_user_id")
    if not puid:
        raise HTTPException(409, "not_linked")
    bot_id = (body.bot_id or "").strip()
    if not bot_id:
        raise HTTPException(400, "bad_request")
    return {"ticket": tickets.pause_bot_ticket(puid, bot_id)}


@router.post("/praxis/arm-ticket")
def praxis_arm_ticket(body: PauseTicketReq, user: str = Depends(current_user)) -> dict:
    """Mint a single-use arm_bot ticket. Praxis arm-bot gates on credential='valid' + not mainnet (INV-6)."""
    ident = _guard(user, "arm-ticket")
    puid = ident.get("praxis_user_id")
    if not puid:
        raise HTTPException(409, "not_linked")
    bot_id = (body.bot_id or "").strip()
    if not bot_id:
        raise HTTPException(400, "bad_request")
    return {"ticket": tickets.arm_bot_ticket(puid, bot_id)}


@router.post("/praxis/validate-ticket")
def praxis_validate_ticket(body: PauseTicketReq, user: str = Depends(current_user)) -> dict:
    """Mint a single-use validate_credential ticket (EP6): Praxis enqueues a worker validate job."""
    ident = _guard(user, "validate-ticket")
    puid = ident.get("praxis_user_id")
    if not puid:
        raise HTTPException(409, "not_linked")
    bot_id = (body.bot_id or "").strip()
    if not bot_id:
        raise HTTPException(400, "bad_request")
    return {"ticket": tickets.validate_credential_ticket(puid, bot_id)}
