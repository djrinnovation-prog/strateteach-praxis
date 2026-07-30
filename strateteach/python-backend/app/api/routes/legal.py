"""Editable legal texts + the Legal Console API.

Public reads (`GET /legal`, `GET /legal/{key}`) serve the app's live legal copy — and
double as the no-login public URL the app stores require. Editing (`GET /legal/admin/all`,
`PUT /legal/{key}`) is gated by :func:`require_legal_editor` so the legal counsel can
maintain the copy WITHOUT being a full admin; granting that access is a main-admin action.

Route order matters: the specific paths (`/legal/admin/all`, `/legal/editors`) are declared
BEFORE the `/legal/{key}` catch-all so they aren't swallowed by it.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import database as db
from app.core.security import require_legal_editor, require_legal_copy_writer, require_owner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["legal"])


# ── shaping ──────────────────────────────────────────────────────────────────
def _public(row: dict) -> dict:
    """A legal text as the app renders it (both languages; no internal columns)."""
    return {
        "key": row.get("key"),
        "titleHe": row.get("title_he") or "",
        "titleEn": row.get("title_en") or "",
        "bodyHe": row.get("body_he") or "",
        "bodyEn": row.get("body_en") or "",
        "sort": int(row.get("sort") or 0),
        "updatedAt": row.get("updated_at"),
    }


def _admin(row: dict) -> dict:
    """A legal text for the console — adds the draft/publish + audit fields."""
    return {**_public(row), "published": bool(row.get("published")), "updatedBy": row.get("updated_by")}


# ── input models ─────────────────────────────────────────────────────────────
class LegalSaveInput(BaseModel):
    titleHe: str = ""
    titleEn: str = ""
    bodyHe: str = ""
    bodyEn: str = ""
    published: bool = True
    sort: Optional[int] = None


class LegalEditorInput(BaseModel):
    username: str
    enabled: bool = True


class LegalCopySaveInput(BaseModel):
    he: str = ""
    en: str = ""


def _copy(row: dict) -> dict:
    """A legal-copy block as the app + portal render it (both languages + approval)."""
    return {
        "block": row.get("block"),
        "he": row.get("he") or "",
        "en": row.get("en") or "",
        "approved": bool(row.get("approved")),
        "updatedBy": row.get("updated_by"),
        "updatedAt": row.get("updated_at"),
    }


# ── public (no auth) — the live copy the app renders + the public store URL ──
@router.get("/legal")
async def legal_list():
    return {"texts": [_public(r) for r in db.list_legal_texts(published_only=True)]}


# ── legal COPY blocks (the 4 analytics/safety-plan blocks) ───────────────────
# GET is public (the app renders these before/around money actions); editing +
# approving are gated to the legal editor (Raz) / owners, same as the console.
@router.get("/legal/copy")
async def legal_copy_list():
    """The 4 legal-copy blocks with their current copy + approval state (public read)."""
    return {"blocks": [_copy(r) for r in db.list_legal_copy()]}


@router.put("/legal/copy/{block}")
async def legal_copy_save(block: str, body: LegalCopySaveInput, user: str = Depends(require_legal_copy_writer)):
    """Save a block's HE/EN copy (Raz / legal editor). Editing reverts it to DRAFT
    (approved=FALSE) so edited copy always goes back through Confirm & Approve."""
    block = (block or "").strip().lower()
    if block not in db.LEGAL_COPY_BLOCKS:
        raise HTTPException(404, "No such legal-copy block.")
    row = db.upsert_legal_copy(block=block, he=body.he, en=body.en, updated_by=user)
    logger.info("legal.copy.save block=%s by=%s", block, user)
    return {"ok": True, "block": _copy(row) if row else None}


@router.post("/legal/copy/{block}/approve")
async def legal_copy_approve(block: str, user: str = Depends(require_legal_copy_writer)):
    """Confirm & Approve a block — sets approved=TRUE, clearing the DRAFT badge app-wide."""
    block = (block or "").strip().lower()
    if block not in db.LEGAL_COPY_BLOCKS:
        raise HTTPException(404, "No such legal-copy block.")
    row = db.approve_legal_copy(block=block, approved=True, updated_by=user)
    logger.info("legal.copy.approve block=%s by=%s", block, user)
    return {"ok": True, "block": _copy(row) if row else None}


@router.post("/legal/copy/{block}/unapprove")
async def legal_copy_unapprove(block: str, user: str = Depends(require_legal_copy_writer)):
    """Un-approve a block — sets approved=FALSE, re-showing the DRAFT badge app-wide."""
    block = (block or "").strip().lower()
    if block not in db.LEGAL_COPY_BLOCKS:
        raise HTTPException(404, "No such legal-copy block.")
    row = db.approve_legal_copy(block=block, approved=False, updated_by=user)
    logger.info("legal.copy.unapprove block=%s by=%s", block, user)
    return {"ok": True, "block": _copy(row) if row else None}


# ── admin (legal-editor gated) — the console ─────────────────────────────────
@router.get("/legal/admin/all")
async def legal_admin_list(user: str = Depends(require_legal_editor)):
    """Every legal text incl. drafts — for the Legal Console list."""
    return {"texts": [_admin(r) for r in db.list_legal_texts(published_only=False)]}


# ── access management (main-admin only) — grant the legal counsel edit rights ──
@router.get("/legal/editors")
async def legal_editors(user: str = Depends(require_owner)):
    return {"editors": [
        {"username": r.get("username"), "role": r.get("role"),
         "isMain": bool(r.get("is_main")), "legalEditor": bool(r.get("legal_editor"))}
        for r in db.list_legal_editors()
    ]}


@router.post("/legal/editors")
async def legal_set_editor(body: LegalEditorInput, user: str = Depends(require_owner)):
    """Grant/revoke a user's legal-editor access. Main-admin only."""
    target = (body.username or "").strip()
    if not target or not db.get_user(target):
        raise HTTPException(404, "No such user.")
    db.set_legal_editor(target, body.enabled)
    logger.info("legal.editor.set target=%s enabled=%s by=%s", target, body.enabled, user)
    return {"ok": True}


@router.put("/legal/{key}")
async def legal_save(key: str, body: LegalSaveInput, user: str = Depends(require_legal_editor)):
    """Create/update a legal text (Save → publishes live when published=True)."""
    key = (key or "").strip().lower()
    if not key:
        raise HTTPException(400, "A key is required.")
    row = db.upsert_legal_text(
        key=key, title_he=body.titleHe, title_en=body.titleEn,
        body_he=body.bodyHe, body_en=body.bodyEn, published=body.published,
        updated_by=user, sort=body.sort,
    )
    logger.info("legal.save key=%s by=%s published=%s", key, user, body.published)
    return {"ok": True, "text": _admin(row)}


# ── public single read — LAST so it never shadows the specific paths above ──
@router.get("/legal/{key}")
async def legal_get(key: str):
    row = db.get_legal_text(key, published_only=True)
    if not row:
        raise HTTPException(404, "Not found")
    return _public(row)
