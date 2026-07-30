"""Meta endpoints: health check and the manual data-resync trigger."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app import database as db
from app.core import cache
from app.core.security import current_user, require_admin, is_owner, maintenance_bypass
from app.services import signals as sig_scanner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["meta"])


@router.get("/healthz")
def healthz(request: Request):
    status = "ok" if not getattr(request.app.state, "bootstrap_error", None) else "degraded"
    return {"status": status}


# ── Maintenance / "under development" gate (global, app-wide) ─────────────────

@router.get("/system/maintenance")
def maintenance_status(username: str = Depends(current_user)):
    """Lightweight gate query for the frontend: is maintenance ON, and is THIS
    user an admin (so the client can let admins bypass the splash).

    A maintenance-bypass-allowlisted account (e.g. a labelled demo user) also
    reports isAdmin=True HERE ONLY — purely so the frontend doesn't strand it on
    the maintenance splash. It grants no admin capability anywhere else; every
    require_admin/require_owner surface still resolves from the real DB role."""
    user = db.get_user(username) or {}
    is_admin = user.get("role") == "admin" or maintenance_bypass(username)
    return {"maintenance": db.get_maintenance(), "isAdmin": is_admin}


@router.post("/system/maintenance")
def set_maintenance_mode(body: dict, admin: str = Depends(require_admin)):
    """Turn the global maintenance gate ON/OFF.

    Asymmetric by design while the redesign is locked down:
      • Turning it ON is allowed for ANY admin (re-raise the lock).
      • Turning it OFF (lifting the 'under development' splash) is restricted to the
        MAIN admin — the same `is_main` super-admin `/auth/me` reports as isMain — so
        a restricted admin can't re-open the app to users mid-redesign. Non-main
        admins get a 403 on an OFF attempt.
    Admins are NEVER locked out of the app itself by this; only the OFF switch is
    gated. Turning maintenance ON also actively disconnects current non-admin
    sessions (see db.set_maintenance)."""
    on = bool((body or {}).get("on"))
    if not on and not is_owner(admin):
        raise HTTPException(status_code=403, detail="Only an owner can turn maintenance off.")
    db.set_maintenance(on)
    db.add_audit("maintenance.set", actor=admin, detail={"on": on})
    return {"ok": True, "maintenance": on}


@router.post("/system/resync")
async def system_resync(_: str = Depends(current_user)):
    """Manual 'sync now': force-re-probe the crypto data source (ignoring the
    resolver TTL), drop the cached crypto universe, clear scan caches, and verify
    the DB. The next request from any screen returns freshly-synced data."""
    from app.data import market_exchange

    result: dict = {"ok": True}
    try:
        ex_id = await asyncio.to_thread(market_exchange.resolve_market_exchange_id, True)
        result["exchange"] = ex_id
        result["crypto_ok"] = ex_id is not None
        if ex_id is None:
            result["ok"] = False
    except Exception as exc:
        result.update(ok=False, crypto_ok=False, exchange=None, exchange_error=str(exc)[:200])

    try:
        sig_scanner.clear_crypto_universe_cache()
    except Exception:
        pass

    cache.clear_all()

    try:
        await asyncio.to_thread(db.list_users)
        result["db_ok"] = True
    except Exception as exc:
        result.update(ok=False, db_ok=False, db_error=str(exc)[:200])
    return result
