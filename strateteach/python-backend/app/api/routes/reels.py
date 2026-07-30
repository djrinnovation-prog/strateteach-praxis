"""Reels learning lessons — published list for any signed-in user, plus
RBAC-gated CRUD for admins.

All paths live under ``/auth/...`` on purpose: the production Caddy proxy only
forwards a fixed path allowlist (which includes ``/auth/*``), so a brand-new
top-level prefix like ``/reels/...`` would 404. This mirrors the admin
demo-video pattern in ``auth.py``.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException

from app import database as db
from app.core.security import current_user, require_content_editor

router = APIRouter(tags=["reels"])

# Cap for an uploaded base64 video *data URL*. Hosted links (the normal case,
# e.g. a HeyGen export) are tiny; this only guards direct uploads. ~25 MB.
_VIDEO_MAX_CHARS = 34_000_000


def _clean_video(value: Any) -> Optional[str]:
    """Accept a hosted http(s) URL or a base64 ``data:video`` URL; else 4xx."""
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise HTTPException(400, "video_url must be a string")
    v = value.strip()
    if v.startswith("data:"):
        if not v.startswith("data:video"):
            raise HTTPException(400, "Uploaded file must be a video.")
        if len(v) > _VIDEO_MAX_CHARS:
            raise HTTPException(
                413,
                "That video is too large — keep it under ~25MB, or paste a hosted link instead.",
            )
        return v
    if not (v.startswith("http://") or v.startswith("https://")):
        raise HTTPException(400, "Enter a valid video link (http/https) or upload a file.")
    return v


def _validate(body: dict, *, partial: bool = False) -> dict:
    """Coerce/validate admin input into kwargs for the db layer.

    With ``partial=True`` (PATCH) only the keys present in ``body`` are returned,
    so omitted fields are left untouched.
    """
    body = body or {}
    out: dict = {}

    def want(key: str) -> bool:
        return key in body or not partial

    if want("title_he"):
        out["title_he"] = str(body.get("title_he") or "").strip()
    if want("title_en"):
        out["title_en"] = str(body.get("title_en") or "").strip()
    if want("caption_he"):
        out["caption_he"] = str(body.get("caption_he") or "").strip()
    if want("caption_en"):
        out["caption_en"] = str(body.get("caption_en") or "").strip()
    if want("description"):
        out["description"] = str(body.get("description") or "").strip()
    if want("free_preview_seconds"):
        try:
            out["free_preview_seconds"] = max(0, int(body.get("free_preview_seconds", 30)))
        except (TypeError, ValueError):
            raise HTTPException(400, "free_preview_seconds must be a number")
    if want("position"):
        try:
            out["position"] = int(body.get("position", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "position must be a number")
    if want("published"):
        out["published"] = bool(body.get("published", False))
    if want("video_url"):
        out["video_url"] = _clean_video(body.get("video_url"))
    return out


@router.get("/auth/reels")
def list_lessons(_: str = Depends(current_user)):
    """Published lessons, ordered, for the player (any signed-in user)."""
    return {"lessons": db.list_reels_lessons(include_unpublished=False)}


@router.get("/auth/reels/admin")
def list_lessons_admin(_: str = Depends(require_content_editor)):
    """Every lesson incl. drafts/unpublished — for the admin manager."""
    return {"lessons": db.list_reels_lessons(include_unpublished=True)}


@router.post("/auth/reels/admin")
def create_lesson(body: dict, admin: str = Depends(require_content_editor)):
    """Create a lesson. Defaults to an unpublished draft the admin can refine."""
    data = _validate(body, partial=False)
    return {"lesson": db.create_reels_lesson(**data)}


@router.post("/auth/reels/admin/reorder")
def reorder_lessons(body: dict, admin: str = Depends(require_content_editor)):
    """Persist a new lesson order. Body: ``{"order": [id, id, …]}``. Declared BEFORE
    the ``/{lesson_id}`` routes so the literal ``reorder`` never matches the id param."""
    order = (body or {}).get("order")
    if not isinstance(order, list):
        raise HTTPException(400, "order must be a list of lesson ids")
    try:
        ids = [int(x) for x in order]
    except (TypeError, ValueError):
        raise HTTPException(400, "order must contain lesson ids")
    db.reorder_reels_lessons(ids)
    return {"lessons": db.list_reels_lessons(include_unpublished=True)}


# ── In-app "90-second tour" link (embedded on the Reels·course screen) ─────────
def _clean_tour(value: Any) -> str:
    """A same-origin static path (/media/…) or a hosted http(s) URL. Blank → default."""
    v = str(value or "").strip()
    if not v:
        return db.REELS_TOUR_DEFAULT
    if v.startswith("/") or v.startswith("http://") or v.startswith("https://"):
        return v
    raise HTTPException(400, "Enter a path like /media/home-tour.html or a full http(s) link.")


@router.get("/auth/reels/tour")
def get_tour(_: str = Depends(current_user)):
    """The current in-app tour link, for the player (any signed-in user)."""
    return {"url": db.get_reels_tour_url()}


@router.patch("/auth/reels/admin/tour")
def set_tour(body: dict, admin: str = Depends(require_content_editor)):
    """Re-point the in-app tour link (owner/content-editor only)."""
    return {"url": db.set_reels_tour_url(_clean_tour((body or {}).get("url")))}


@router.patch("/auth/reels/admin/{lesson_id}")
def update_lesson(lesson_id: int, body: dict, admin: str = Depends(require_content_editor)):
    if db.get_reels_lesson(lesson_id) is None:
        raise HTTPException(404, "Lesson not found")
    data = _validate(body, partial=True)
    return {"lesson": db.update_reels_lesson(lesson_id, **data)}


@router.delete("/auth/reels/admin/{lesson_id}")
def delete_lesson(lesson_id: int, admin: str = Depends(require_content_editor)):
    if not db.delete_reels_lesson(lesson_id):
        raise HTTPException(404, "Lesson not found")
    return {"ok": True}
