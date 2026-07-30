"""University / Learn content — the editable "Explanations" store.

Mirrors the reels_lessons editor: a published read for any signed-in user, plus
content_editor-gated CRUD (add / edit / reorder / remove) + a one-time import that
seeds the store from the app's built-in content. All paths live under ``/auth/...``
so the production Caddy allowlist (which forwards ``/auth/*``) routes them without a
Caddyfile change (same reason reels / pm / legal live under ``/auth/*``).

Content model (one row per item, grouped by ``section``):
  • getting_started — a numbered step (body = the step text).
  • concepts        — a concept card (icon + title + body; blank line = new paragraph).
  • glossary        — a term (title) + its definition (body).

Empty store → the frontend renders the built-in lib/uni.ts content (nothing is ever
lost); a content_editor imports the built-in to start editing.
"""
from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from app import database as db
from app.core.security import current_user, require_content_editor

router = APIRouter(tags=["university"])


def _item_json(r: dict) -> dict:
    return {"id": int(r["id"]), "section": r.get("section") or "concepts", "icon": r.get("icon") or "",
            "titleHe": r.get("title_he") or "", "titleEn": r.get("title_en") or "",
            "bodyHe": r.get("body_he") or "", "bodyEn": r.get("body_en") or "",
            "position": int(r.get("position") or 0), "published": bool(r.get("published")),
            "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}


def _grouped(rows: list[dict]) -> dict:
    out: dict[str, list] = {"getting_started": [], "concepts": [], "glossary": []}
    for r in rows:
        out.setdefault(r.get("section") or "concepts", []).append(_item_json(r))
    return out


def _validate(body: dict, *, partial: bool = False) -> dict:
    body = body or {}
    out: dict = {}

    def want(key: str) -> bool:
        return key in body or not partial

    if want("section"):
        sec = str(body.get("section") or "concepts")
        out["section"] = sec if sec in db.UNIVERSITY_SECTIONS else "concepts"
    if want("icon"):
        out["icon"] = str(body.get("icon") or "").strip()
    if want("title_he"):
        out["title_he"] = str(body.get("title_he") or "").strip()
    if want("title_en"):
        out["title_en"] = str(body.get("title_en") or "").strip()
    if want("body_he"):
        out["body_he"] = str(body.get("body_he") or "")
    if want("body_en"):
        out["body_en"] = str(body.get("body_en") or "")
    if want("position"):
        try:
            out["position"] = int(body.get("position", 0))
        except (TypeError, ValueError):
            raise HTTPException(400, "position must be a number")
    if want("published"):
        out["published"] = bool(body.get("published", True))
    return out


@router.get("/auth/university")
def get_university(_: str = Depends(current_user)):
    """Published content grouped by section (any signed-in user). ``hasContent`` tells
    the client whether to render the store or fall back to the built-in content."""
    rows = db.list_university_items(include_unpublished=False)
    return {"hasContent": db.count_university_items() > 0, "sections": _grouped(rows)}


@router.get("/auth/university/admin")
def get_university_admin(_: str = Depends(require_content_editor)):
    """Every item incl. drafts — for the content editor."""
    rows = db.list_university_items(include_unpublished=True)
    return {"hasContent": len(rows) > 0, "items": [_item_json(r) for r in rows]}


@router.post("/auth/university/admin")
def create_university(body: dict, editor: str = Depends(require_content_editor)):
    data = _validate(body, partial=False)
    return {"item": _item_json(db.create_university_item(updated_by=editor, **data))}


@router.patch("/auth/university/admin/{item_id}")
def update_university(item_id: int, body: dict, editor: str = Depends(require_content_editor)):
    if db.get_university_item(item_id) is None:
        raise HTTPException(404, "Item not found")
    data = _validate(body, partial=True)
    return {"item": _item_json(db.update_university_item(item_id, updated_by=editor, **data))}


@router.delete("/auth/university/admin/{item_id}")
def delete_university(item_id: int, editor: str = Depends(require_content_editor)):
    if not db.delete_university_item(item_id):
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@router.post("/auth/university/admin/import")
def import_university(body: dict, editor: str = Depends(require_content_editor)):
    """Seed the store from the app's built-in content (sent by the editor). Only runs
    when the store is empty → never clobbers existing edits."""
    items: List[dict] = (body or {}).get("items") or []
    if not isinstance(items, list):
        raise HTTPException(400, "items must be a list")
    imported = db.import_university_items(items, updated_by=editor)
    return {"ok": True, "imported": imported, "hasContent": db.count_university_items() > 0}
