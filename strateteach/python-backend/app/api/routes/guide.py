"""Home Guide — the animated mascot overlay (Yoav's reels) + its management portal.

The guide is a lightweight 2D overlay on the Home screen: the "770" diamond character
walks to each section, spotlights the real DOM element and narrates it in an ElevenLabs
voice with lip-sync. This router serves ONE owner/admin-editable config that drives it,
plus the binary-asset override store so non-devs can swap voice/character files live.

Endpoints (all under /auth/* so the existing Caddy reverse-proxy already routes them):
  • GET    /auth/guide/config          — resolved config for PLAYING (any logged-in user).
  • PUT    /auth/guide/config          — save the config (OWNER or role==admin only).
  • POST   /auth/guide/asset/{key}     — upload/replace a voice mp3 or pose png (raw body;
                                          Content-Type = the file's mime). OWNER/admin only.
  • DELETE /auth/guide/asset/{key}     — drop an override so its slot falls back to the
                                          shipped static default. OWNER/admin only.
  • GET    /auth/guide/asset/{key}     — serve the uploaded bytes to a plain <img>/<audio>
                                          tag. PUBLIC read (no bearer — see auth_gate), the
                                          same way a static asset is served; nothing sensitive.

MONEY-SAFETY: the guide is pure onboarding narration — it renders in a pointer-events:none
overlay and touches NO trading/money surface. Nothing here can place an order or change a
financial setting; the manager only edits captions, ordering, enable flags and media.
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user, is_owner, require_admin

logger = logging.getLogger("algo770")

router = APIRouter(tags=["guide"])

# Slot ids the config references (e.g. 'voice-1', 'pose-talk'). Bounded + charset-locked so a
# key can never traverse paths or bloat the store.
_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
# Only the shapes the mascot actually uses — audio (mp3/mpeg/wav/ogg) + images (png/webp/jpeg).
_ALLOWED_MIME_PREFIXES = ("audio/", "image/")
_MAX_ASSET_BYTES = 12 * 1024 * 1024   # 12 MB — generous for a ~0.5 MB mp3 / ~0.25 MB png


def _valid_key(key: str) -> str:
    key = (key or "").strip().lower()
    if not _KEY_RE.match(key):
        raise HTTPException(status_code=422, detail="invalid asset key")
    return key


@router.get("/auth/guide/config")
def guide_config(username: str = Depends(current_user)):
    """Resolved guide config for the CURRENT user (used both to PLAY the guide and — when the
    caller is an owner/admin — to populate the manager). `assetKeys` lists which slots have an
    uploaded override; `canManage` says whether this caller may edit the shared config."""
    cfg = db.get_guide_config()
    can_manage = is_owner(username) or (db.get_user(username) or {}).get("role") == "admin"
    return {
        "config": cfg,
        "assetKeys": db.list_guide_asset_keys(),
        "canManage": bool(can_manage),
    }


class GuideConfigIn(BaseModel):
    # Loose on purpose — the whole object is whitelisted/normalised in db.set_guide_config.
    enabled: bool | None = None
    autoOfferFirstVisit: bool | None = None
    characterScale: float | None = None
    poses: dict | None = None
    steps: list | None = None


@router.put("/auth/guide/config")
def save_guide_config(body: GuideConfigIn, username: str = Depends(require_admin)):
    """Save the guide config. OWNER or role==admin only (require_admin). Returns the stored config."""
    cfg = db.set_guide_config(body.model_dump(exclude_unset=True), username)
    return {"ok": True, "config": cfg, "assetKeys": db.list_guide_asset_keys()}


@router.post("/auth/guide/asset/{key}")
async def upload_guide_asset(key: str, request: Request, username: str = Depends(require_admin)):
    """Upload/replace ONE guide asset. Body = the raw file bytes; Content-Type = its mime.
    OWNER/admin only. Returns the served URL (with a cache-busting version stamp)."""
    key = _valid_key(key)
    mime = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if not mime or not mime.startswith(_ALLOWED_MIME_PREFIXES):
        raise HTTPException(status_code=415, detail="only audio/* or image/* allowed")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=422, detail="empty upload")
    if len(data) > _MAX_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="file too large (max 12 MB)")
    db.upsert_guide_asset(key, mime, data, username)
    return {"ok": True, "key": key, "mime": mime, "url": f"/auth/guide/asset/{key}"}


@router.delete("/auth/guide/asset/{key}")
def remove_guide_asset(key: str, username: str = Depends(require_admin)):
    """Delete ONE uploaded asset so its slot falls back to the shipped static default."""
    key = _valid_key(key)
    db.delete_guide_asset(key)
    return {"ok": True, "key": key}


@router.get("/auth/guide/asset/{key}")
def serve_guide_asset(key: str):
    """PUBLIC (no bearer — see auth_gate): stream an uploaded asset to a plain <img>/<audio>
    tag. 404 when the slot has no override (the client then uses the static default)."""
    key = _valid_key(key)
    asset = db.get_guide_asset(key)
    if not asset:
        raise HTTPException(status_code=404, detail="no override")
    return Response(
        content=asset["data"],
        media_type=asset.get("mime") or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=60"},
    )
