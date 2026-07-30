"""Collaborator portals — one GENERIC, domain-parameterised private workspace between a
collaborator and the three owners (Dan / Rafi / Yoav).

Three domains are mounted from the SAME code:
  • ``legal`` — the legal counsel (Raz) ↔ owners, at ``/legal/portal/*`` (partner ``raz``).
  • ``it``    — the IT lead (Oren)      ↔ owners, at ``/it/portal/*``    (partner ``oren``).
  • ``biz``   — the biz-dev lead (Raful) ↔ owners, at ``/biz/portal/*``  (partner ``raful``).

The IT + biz domains also mount an ``editor_store`` content tab: IT = text docs + system links;
biz = documents & materials (each with an OPTIONAL uploaded file, base64-in-TEXT like avatars)
+ links & sources. Files are listed as metadata only and streamed by a per-doc download route.

Each domain is gated by its own RBAC dependency (``require_legal_editor`` / ``require_it_editor``
— an OWNER or the matching per-user flag), so only that collaborator + the owners reach it.
The sections / notes / chat store is partitioned by a ``domain`` column; the tasks are the SAME
``pm_tasks`` rows the Owners board uses, pinned to the domain's partner id. This module replaces
the former ``legal_portal.py`` — the ``legal`` domain behaves byte-for-byte as before.
"""
from __future__ import annotations

import html
import logging
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from app import database as db
from app.core.security import (
    current_user, is_owner, require_biz_editor, require_it_editor, require_legal_editor,
)

logger = logging.getLogger("algo770")

# Report views render LIVE from current PM data — forbid every cache layer (browser HTTP cache,
# iframe, proxy) so a re-open/refresh always re-fetches a fresh render, never a stale copy.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}


# ── per-domain configuration ──────────────────────────────────────────────────
@dataclass(frozen=True)
class PortalDomain:
    domain: str                       # 'legal' | 'it' — the DB partition + URL prefix segment
    partner: str                      # PM partner id the tasks tab is pinned to ('raz'|'oren')
    gate: Callable                    # RBAC dependency (require_legal_editor / require_it_editor)
    is_editor: Callable[[str], bool]  # db.is_legal_editor / db.is_it_editor (for report view auth)
    notify_label: str                 # Telegram ping label, e.g. "Legal portal"
    notify_emoji: str                 # Telegram ping emoji, e.g. "⚖️"
    report: Optional[str] = None      # report service module name (e.g. "legal_report"); None = no report tab
    report_filename: str = "summary.pdf"
    editor_store: str = ""            # ""=none | "it"=text docs+links (Oren) | "biz"=file docs+links (Raful)


# ── shaping (domain-agnostic) ─────────────────────────────────────────────────
def _section(row: dict) -> dict:
    return {
        "id": int(row.get("id") or 0),
        "title": row.get("title") or "",
        "body": row.get("body") or "",
        "status": row.get("status") or "open",
        "createdBy": row.get("created_by"),
        "createdName": row.get("created_name") or row.get("created_by") or "",
        "sort": int(row.get("sort") or 0),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
        "noteCount": int(row.get("note_count") or 0),
        "lastNoteAt": row.get("last_note_at"),
    }


def _note(row: dict) -> dict:
    return {
        "id": int(row.get("id") or 0),
        "sectionId": int(row.get("section_id") or 0),
        "authorId": row.get("author_id"),
        "authorName": row.get("author_name") or row.get("author_id") or "",
        "body": row.get("body") or "",
        "createdAt": row.get("created_at"),
    }


def _chat_msg(row: dict, me: str) -> dict:
    return {
        "id": int(row.get("id") or 0),
        "authorId": row.get("author_id"),
        "authorName": row.get("author_name") or row.get("author_id") or "",
        "body": row.get("body") or "",
        "createdAt": row.get("created_at"),
        "mine": row.get("author_id") == me,
    }


# ── input models (domain-agnostic) ────────────────────────────────────────────
class SectionCreate(BaseModel):
    title: str = ""
    body: str = ""


class SectionUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None
    sort: Optional[int] = None


class NoteCreate(BaseModel):
    body: str = ""


class ChatSend(BaseModel):
    body: str = ""


class PortalTaskCreate(BaseModel):
    titleHe: str = ""
    titleEn: str = ""
    detail: str = ""
    status: str = "todo"
    progress: int = 0
    phase: Optional[str] = None
    partners: Optional[list] = None          # extra collaborators; the domain partner is always pinned
    assignee: Optional[str] = None
    priority: str = "none"


class PortalTaskUpdate(BaseModel):
    titleHe: Optional[str] = None
    titleEn: Optional[str] = None
    detail: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[int] = None
    phase: Optional[str] = None
    partners: Optional[list] = None
    assignee: Optional[str] = None
    notes: Optional[str] = None
    priority: Optional[str] = None


class SubtaskCreate(BaseModel):
    title: str = ""


class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    done: Optional[bool] = None


# IT "ניהול ועריכה" store — editable docs + system links (only mounted when cfg.editor_store).
class DocUpsert(BaseModel):
    id: Optional[int] = None
    title: str = ""
    body: str = ""


class LinkUpsert(BaseModel):
    id: Optional[int] = None
    label: str = ""
    url: str = ""
    note: str = ""


# Biz-dev docs carry an OPTIONAL uploaded file as a base64 data-URL (same mechanism as avatars).
# fileData: None = leave the existing file untouched (text-only edit); "" = clear the file;
# a "data:<mime>;base64,…" string = set/replace the file. fileName/fileType are its metadata.
class BizDocUpsert(BaseModel):
    id: Optional[int] = None
    title: str = ""
    body: str = ""
    fileName: Optional[str] = None
    fileType: Optional[str] = None
    fileData: Optional[str] = None


# Max uploaded file size (raw bytes, pre-base64). DB-TEXT blob storage — generous enough for
# PDFs / decks / images, capped so the Postgres row (and the base64 inflation) stays sane.
_BIZ_FILE_MAX_BYTES = 12 * 1024 * 1024  # 12 MB
_BIZ_BODY_MAX = 100_000                 # long-form rich description (5× the IT text cap)


def _report_service(name: str):
    """Import a report service module by name (e.g. 'legal_report' → app.services.legal_report)."""
    import importlib
    return importlib.import_module(f"app.services.{name}")


def build_portal_router(cfg: PortalDomain) -> APIRouter:
    """Build the full portal router for one domain. Mounted at ``/{cfg.domain}/portal/*``."""
    router = APIRouter(tags=[f"{cfg.domain}-portal"])
    P = f"/{cfg.domain}/portal"
    gate = cfg.gate

    def _notify_owners(actor: str, text: str) -> None:
        """Best-effort Telegram ping to the owners' admin channel for portal activity."""
        try:
            from app.services import telegram as tg
            tg.notify_admin(f"{cfg.notify_emoji} <b>{cfg.notify_label}</b> · {html.escape(actor)}\n{html.escape(text[:400])}")
        except Exception:  # noqa: BLE001 — never block on notification
            pass

    def _section_or_404(section_id: int) -> dict:
        """Load a section and ensure it belongs to THIS domain (portals are partitioned)."""
        row = db.get_legal_section(section_id)
        if not row or (row.get("domain") or "legal") != cfg.domain:
            raise HTTPException(404, "No such section.")
        return row

    # ── sections ──────────────────────────────────────────────────────────────
    @router.get(f"{P}/sections")
    def portal_sections(status: Optional[str] = None, user: str = Depends(gate)):
        """All portal sections, most-recently-active first (collaborator + owners share one view)."""
        return {"sections": [_section(r) for r in db.list_legal_sections(domain=cfg.domain, status=status)]}

    @router.post(f"{P}/sections")
    def portal_create_section(body: SectionCreate, user: str = Depends(gate)):
        """Open a new titled section. The collaborator (or an owner) creates it; both sides read + reply."""
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(400, "A section title is required.")
        sid = db.create_legal_section(
            title=title[:300], body=(body.body or "").strip()[:8000],
            created_by=user, created_name=db.display_name(user), domain=cfg.domain,
        )
        logger.info("%s.portal.section.create id=%s by=%s", cfg.domain, sid, user)
        _notify_owners(db.display_name(user), f"opened a new section: {title[:120]}")
        row = db.get_legal_section(sid)
        return {"ok": True, "section": _section(row) if row else {"id": sid}}

    @router.get(f"{P}/sections/{{section_id}}")
    def portal_section(section_id: int, user: str = Depends(gate)):
        """One section + its full note thread (oldest-first)."""
        row = _section_or_404(section_id)
        return {"section": _section(row),
                "notes": [_note(n) for n in db.list_legal_notes(section_id)]}

    @router.post(f"{P}/sections/{{section_id}}")
    def portal_update_section(section_id: int, body: SectionUpdate, user: str = Depends(gate)):
        """Edit a section (title/body/status/sort). The author or any owner may edit; only an
        owner may resolve/reopen a section, keeping the topic lifecycle with the owners."""
        _section_or_404(section_id)
        fields: dict = {}
        if body.title is not None:
            fields["title"] = body.title.strip()[:300]
        if body.body is not None:
            fields["body"] = body.body.strip()[:8000]
        if body.sort is not None:
            fields["sort"] = int(body.sort)
        if body.status is not None:
            if not is_owner(user):
                raise HTTPException(403, "Only an owner can resolve or reopen a section.")
            if body.status not in db.LEGAL_SECTION_STATUSES:
                raise HTTPException(400, "Unknown status.")
            fields["status"] = body.status
        if not fields:
            raise HTTPException(400, "Nothing to update.")
        db.update_legal_section(section_id, fields)
        updated = db.get_legal_section(section_id)
        return {"ok": True, "section": _section(updated) if updated else None}

    @router.delete(f"{P}/sections/{{section_id}}")
    def portal_delete_section(section_id: int, user: str = Depends(gate)):
        """Delete a section and its thread. The author or any owner may delete it."""
        row = _section_or_404(section_id)
        if row.get("created_by") != user and not is_owner(user):
            raise HTTPException(403, "Only the author or an owner can delete this section.")
        db.delete_legal_section(section_id)
        logger.info("%s.portal.section.delete id=%s by=%s", cfg.domain, section_id, user)
        return {"ok": True}

    # ── notes (the thread within a section) ───────────────────────────────────
    @router.post(f"{P}/sections/{{section_id}}/notes")
    def portal_add_note(section_id: int, body: NoteCreate, user: str = Depends(gate)):
        """Append a note/reply to a section's thread. The collaborator writes notes; owners reply here."""
        row = _section_or_404(section_id)
        text = (body.body or "").strip()
        if not text:
            raise HTTPException(400, "Note text is required.")
        nid = db.add_legal_note(section_id, user, db.display_name(user), text[:8000])
        logger.info("%s.portal.note.add section=%s id=%s by=%s", cfg.domain, section_id, nid, user)
        _notify_owners(db.display_name(user), f"replied in “{(row.get('title') or '')[:80]}”: {text[:160]}")
        return {"ok": True, "notes": [_note(n) for n in db.list_legal_notes(section_id)]}

    @router.delete(f"{P}/notes/{{note_id}}")
    def portal_delete_note(note_id: int, user: str = Depends(gate)):
        """Delete a single note. The note's author or any owner may delete it. Scoped to a note
        whose section is in THIS domain, so one portal can't reach the other's notes by id."""
        note = db.fetch_one("SELECT * FROM legal_notes WHERE id = %s", (note_id,))
        if not note:
            raise HTTPException(404, "No such note.")
        _section_or_404(int(note.get("section_id") or 0))
        if note.get("author_id") != user and not is_owner(user):
            raise HTTPException(403, "Only the author or an owner can delete this note.")
        db.delete_legal_note(note_id)
        return {"ok": True}

    # ── private chat room (collaborator ↔ the 3 owners) ───────────────────────
    @router.get(f"{P}/chat")
    def portal_chat(since_id: int = 0, user: str = Depends(gate)):
        """Poll the portal chat room. Returns messages after `since_id` (id ASC) + the highest id
        seen, so the client advances its cursor. Everyone in the portal shares this one room."""
        rows = db.list_legal_chat(since_id=since_id, domain=cfg.domain)
        msgs = [_chat_msg(r, user) for r in rows]
        last = msgs[-1]["id"] if msgs else int(since_id or 0)
        return {"messages": msgs, "lastId": last}

    @router.post(f"{P}/chat")
    def portal_chat_send(body: ChatSend, user: str = Depends(gate)):
        """Post a message to the portal chat room."""
        text = (body.body or "").strip()
        if not text:
            raise HTTPException(400, "Message text is required.")
        mid = db.add_legal_chat(user, db.display_name(user), text[:8000], domain=cfg.domain)
        logger.info("%s.portal.chat.send id=%s by=%s", cfg.domain, mid, user)
        _notify_owners(db.display_name(user), f"💬 {text[:200]}")
        return {"ok": True, "id": mid}

    # ── tasks (the SAME pm_tasks rows the Owners board uses, pinned to the domain partner) ──
    def _pin_partner(partners) -> list:
        """Keep the domain's partner id in a task's partner set so it stays this portal's task.
        De-dupes; preserves order; the partner is appended if missing."""
        out: list = []
        for p in (partners or []):
            p = (p or "").strip().lower()
            if p and p not in out:
                out.append(p)
        if cfg.partner not in out:
            out.append(cfg.partner)
        return out

    def _assigned_to_domain(task: dict) -> bool:
        """Is this task assigned to the domain partner — by partner-set membership OR by its
        assignee resolving to that partner (a task entered FOR them)? Mirrors list_pm_tasks_
        assigned_to, so the edit guard matches exactly what the Tasks tab lists."""
        partners = task.get("partners") or ([task["partner"]] if task.get("partner") else [])
        return cfg.partner in partners or db.partner_for_username(task.get("assignee")) == cfg.partner

    def _domain_task_or_404(task_id: int) -> dict:
        """Load a task and ensure it's THIS domain's task (assigned to the partner) — the portal
        editor may only touch its own partner's tasks, never arbitrary board rows. Accepts BOTH
        partner-set and assignee-resolves-to-partner, matching the Tasks tab, so Raz/Oren can edit
        a task an owner entered for them."""
        task = db.get_pm_task(task_id)
        if not task:
            raise HTTPException(404, "No such task.")
        if not _assigned_to_domain(task):
            raise HTTPException(403, "This task is not a portal task for this domain.")
        return task

    @router.get(f"{P}/tasks")
    def portal_tasks(user: str = Depends(gate)):
        """The domain partner's PM tasks — surfaced inside the portal for both the collaborator AND
        the owners. ALWAYS scoped to the domain partner (not the caller), so an owner opening the
        portal sees the collaborator's tasks. Includes EVERY task assigned to them — multi-assignee
        AND ones entered for them by others (list_pm_tasks_assigned_to). Full edit lives below."""
        from app.api.routes.pm import _rollup  # local import — avoids an import cycle at boot
        tasks = db.list_pm_tasks_assigned_to(cfg.partner)
        return {"partner": cfg.partner, "tasks": tasks,
                "goal": db.get_pm_goal(cfg.partner), "progress": _rollup(tasks)}

    @router.post(f"{P}/tasks")
    def portal_task_create(body: PortalTaskCreate, user: str = Depends(gate)):
        """Create a task (collaborator or an owner). The domain partner is always among the assignees."""
        if not (body.titleHe or body.titleEn):
            raise HTTPException(400, "A task needs a title.")
        partners = _pin_partner(body.partners)
        task = db.create_pm_task(
            title_he=body.titleHe, title_en=body.titleEn, assignee=(body.assignee or cfg.partner),
            partner=partners[0], partners=partners, status=body.status, progress=int(body.progress or 0),
            detail=body.detail, phase=body.phase, priority=body.priority, created_by=user,
        )
        logger.info("%s.portal.task.create id=%s by=%s", cfg.domain, task.get("id"), user)
        return {"task": task}

    @router.post(f"{P}/tasks/{{task_id}}")
    def portal_task_update(task_id: int, body: PortalTaskUpdate, user: str = Depends(gate)):
        """Full edit of a task — title / detail / status / progress / phase / assigned people
        (partners) / notes. Same db.update_pm_task the board uses, full field access."""
        _domain_task_or_404(task_id)
        fields = {k: v for k, v in body.model_dump().items() if v is not None}
        if "partners" in fields:
            fields["partners"] = _pin_partner(fields["partners"])  # never drop the domain partner
        out = db.update_pm_task(task_id, fields, updated_by=user)  # allowed=None → any field
        logger.info("%s.portal.task.update id=%s by=%s", cfg.domain, task_id, user)
        return {"task": out}

    @router.delete(f"{P}/tasks/{{task_id}}")
    def portal_task_delete(task_id: int, user: str = Depends(gate)):
        """Delete a task (collaborator or an owner)."""
        _domain_task_or_404(task_id)
        db.delete_pm_task(task_id)
        logger.info("%s.portal.task.delete id=%s by=%s", cfg.domain, task_id, user)
        return {"ok": True}

    @router.post(f"{P}/tasks/{{task_id}}/subtasks")
    def portal_subtask_add(task_id: int, body: SubtaskCreate, user: str = Depends(gate)):
        """Add a sub-task / sub-topic to a task."""
        _domain_task_or_404(task_id)
        title = (body.title or "").strip()
        if not title:
            raise HTTPException(400, "A sub-task needs a title.")
        out = db.add_pm_subtask(task_id, title, updated_by=user)
        return {"task": out}

    @router.post(f"{P}/tasks/{{task_id}}/subtasks/{{sub_id}}")
    def portal_subtask_update(task_id: int, sub_id: int, body: SubtaskUpdate, user: str = Depends(gate)):
        """Rename / tick a sub-task."""
        _domain_task_or_404(task_id)
        if body.title is None and body.done is None:
            raise HTTPException(400, "Nothing to update.")
        out = db.update_pm_subtask(task_id, sub_id, title=body.title, done=body.done, updated_by=user)
        return {"task": out}

    @router.delete(f"{P}/tasks/{{task_id}}/subtasks/{{sub_id}}")
    def portal_subtask_delete(task_id: int, sub_id: int, user: str = Depends(gate)):
        """Delete a sub-task."""
        _domain_task_or_404(task_id)
        out = db.delete_pm_subtask(task_id, sub_id, updated_by=user)
        return {"task": out}

    # ── "ניהול ועריכה" store — editable IT docs + "link your system to us" (IT only) ──
    if cfg.editor_store == "it":
        @router.get(f"{P}/docs")
        def portal_docs(user: str = Depends(gate)):
            """IT notes/documentation entries (editable). Shared by the collaborator + owners."""
            return {"docs": db.list_it_docs()}

        @router.post(f"{P}/docs")
        def portal_doc_upsert(body: DocUpsert, user: str = Depends(gate)):
            """Create (no id) or edit an IT doc entry."""
            title = (body.title or "").strip()
            if not title and not (body.body or "").strip():
                raise HTTPException(400, "A doc needs a title or body.")
            doc = db.upsert_it_doc(doc_id=body.id, title=title[:300], body=(body.body or "")[:20000], updated_by=user)
            logger.info("%s.portal.doc.upsert id=%s by=%s", cfg.domain, doc.get("id"), user)
            return {"doc": doc}

        @router.delete(f"{P}/docs/{{doc_id}}")
        def portal_doc_delete(doc_id: int, user: str = Depends(gate)):
            db.delete_it_doc(doc_id)
            return {"ok": True}

        @router.get(f"{P}/links")
        def portal_links(user: str = Depends(gate)):
            """The 'link your system to us' entries — Oren's links/connections for the owners."""
            return {"links": db.list_it_links()}

        @router.post(f"{P}/links")
        def portal_link_upsert(body: LinkUpsert, user: str = Depends(gate)):
            """Create (no id) or edit a system link."""
            label = (body.label or "").strip()
            url = (body.url or "").strip()
            if not label and not url:
                raise HTTPException(400, "A link needs a label or URL.")
            link = db.upsert_it_link(link_id=body.id, label=label[:200], url=url[:1000],
                                     note=(body.note or "").strip()[:2000], updated_by=user)
            logger.info("%s.portal.link.upsert id=%s by=%s", cfg.domain, link.get("id"), user)
            return {"link": link}

        @router.delete(f"{P}/links/{{link_id}}")
        def portal_link_delete(link_id: int, user: str = Depends(gate)):
            db.delete_it_link(link_id)
            return {"ok": True}

    # ── "מסמכים וחומרים / קישורים ומקורות" store — biz-dev docs (WITH uploaded files) + links ──
    #    Same shape as the IT store, relabeled for business-development content, and each doc can
    #    carry a real uploaded FILE (PDF/image/deck) as a base64 data-URL (like avatars). The list
    #    returns metadata only; the file bytes are streamed by the download route below.
    elif cfg.editor_store == "biz":
        @router.get(f"{P}/docs")
        def biz_docs(user: str = Depends(gate)):
            """Biz-dev documents & materials (title + long-form description + optional file)."""
            return {"docs": db.list_biz_docs()}

        @router.post(f"{P}/docs")
        def biz_doc_upsert(body: BizDocUpsert, user: str = Depends(gate)):
            """Create (no id) or edit a biz doc. An optional file rides along as a base64 data-URL:
            fileData None = keep the existing file, '' = clear it, 'data:…' = set/replace it."""
            title = (body.title or "").strip()
            has_new_file = bool((body.fileData or "").strip())
            if not title and not (body.body or "").strip() and not has_new_file:
                raise HTTPException(400, "A document needs a title, description or file.")
            fname = ftype = None
            fsize = 0
            fdata = body.fileData  # None → unchanged; "" → cleared; "data:…" → new
            if has_new_file:
                data = body.fileData.strip()
                if not data.startswith("data:"):
                    raise HTTPException(400, "File must be a data: URL.")
                b64 = data.split(",", 1)[1] if "," in data else ""
                # decoded byte size = 3/4 of the base64 length (minus padding) — enforce the cap
                fsize = (len(b64) * 3) // 4 - b64[-2:].count("=")
                if fsize > _BIZ_FILE_MAX_BYTES:
                    raise HTTPException(400, f"File too large — max {_BIZ_FILE_MAX_BYTES // (1024 * 1024)}MB.")
                fname = (body.fileName or "file").strip()[:300]
                ftype = (body.fileType or "").strip()[:120]
                fdata = data
            doc = db.upsert_biz_doc(doc_id=body.id, title=title[:300], body=(body.body or "")[:_BIZ_BODY_MAX],
                                    file_name=fname, file_type=ftype, file_data=fdata, file_size=fsize,
                                    updated_by=user)
            logger.info("%s.portal.doc.upsert id=%s file=%s by=%s", cfg.domain, doc.get("id"), bool(has_new_file), user)
            return {"doc": doc}

        @router.delete(f"{P}/docs/{{doc_id}}")
        def biz_doc_delete(doc_id: int, user: str = Depends(gate)):
            db.delete_biz_doc(doc_id)
            return {"ok": True}

        @router.get(f"{P}/docs/{{doc_id}}/file")
        def biz_doc_file(doc_id: int, user: str = Depends(gate)):
            """Stream a doc's uploaded file bytes (decoded from its base64 data-URL) for download.
            Gated like the rest of the portal — the client fetches it with the bearer token and
            saves the resulting blob (so the download stays behind the same access check)."""
            import base64
            row = db.get_biz_doc_file(doc_id)
            if not row or not (row.get("file_data") or ""):
                raise HTTPException(404, "No file on this document.")
            data = row["file_data"]
            b64 = data.split(",", 1)[1] if "," in data else data
            try:
                raw = base64.b64decode(b64)
            except Exception:  # noqa: BLE001 — corrupt/oversized payload
                raise HTTPException(422, "File could not be decoded.")
            ctype = (row.get("file_type") or "application/octet-stream")
            fname = (row.get("file_name") or f"document-{doc_id}").replace('"', "")
            return Response(content=raw, media_type=ctype,
                            headers={"Content-Disposition": f'attachment; filename="{fname}"', **_NO_STORE})

        @router.get(f"{P}/links")
        def biz_links(user: str = Depends(gate)):
            """Biz-dev links & sources — Raful's references/resources for the owners."""
            return {"links": db.list_biz_links()}

        @router.post(f"{P}/links")
        def biz_link_upsert(body: LinkUpsert, user: str = Depends(gate)):
            """Create (no id) or edit a biz link/source."""
            label = (body.label or "").strip()
            url = (body.url or "").strip()
            if not label and not url:
                raise HTTPException(400, "A link needs a label or URL.")
            link = db.upsert_biz_link(link_id=body.id, label=label[:200], url=url[:1000],
                                      note=(body.note or "").strip()[:2000], updated_by=user)
            logger.info("%s.portal.link.upsert id=%s by=%s", cfg.domain, link.get("id"), user)
            return {"link": link}

        @router.delete(f"{P}/links/{{link_id}}")
        def biz_link_delete(link_id: int, user: str = Depends(gate)):
            db.delete_biz_link(link_id)
            return {"ok": True}

    # ── summary report (owners-report style, domain-scoped, sendable to owners) ──
    # Only mounted for domains that configure a report service (legal today; IT lands in a
    # later phase). Same token-gated view + send-to-owners pattern as the owners daily report.
    if cfg.report:
        def _report_view_ok(authorization: str | None, t: str | None) -> bool:
            from app.services import owners_report as orr
            if orr.check_report_token(t):
                return True
            try:
                u = current_user(authorization)
            except Exception:  # noqa: BLE001 — unauthenticated + no token → not allowed
                return False
            return bool(u) and (is_owner(u) or cfg.is_editor(u))

        @router.get(f"{P}/report.html")
        def portal_report_html(t: str | None = Query(default=None),
                               authorization: str | None = Header(default=None)):
            """The summary report as responsive HTML (owner/editor, or a valid view token)."""
            if not _report_view_ok(authorization, t):
                raise HTTPException(403, f"{cfg.domain} portal only")
            svc = _report_service(cfg.report)
            # never cache — the report is rendered LIVE from current PM data; a cached copy
            # (browser/iframe/proxy) is exactly the "stuck on previous data" staleness.
            return HTMLResponse(svc.render_html(svc.build_report_data()), headers=_NO_STORE)

        @router.get(f"{P}/report.pdf")
        def portal_report_pdf(t: str | None = Query(default=None),
                              authorization: str | None = Header(default=None)):
            """The summary report as a downloadable PDF (owner/editor, or a valid view token)."""
            if not _report_view_ok(authorization, t):
                raise HTTPException(403, f"{cfg.domain} portal only")
            svc = _report_service(cfg.report)
            pdf = svc.render_pdf(svc.build_report_data())
            return Response(content=pdf, media_type="application/pdf",
                            headers={"Content-Disposition": f'inline; filename="{cfg.report_filename}"', **_NO_STORE})

        @router.get(f"{P}/report/link")
        def portal_report_link(request: Request, user: str = Depends(gate)):
            """Mint a fresh device-independent view token + return the HTML/PDF URLs (used by the
            portal's 'open web report' / 'download PDF' buttons — they open in a new tab, which
            can't carry the bearer token, so a URL token is minted)."""
            import os
            from app.services import owners_report as orr
            tok = orr.mint_report_token()
            base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
            return {"token": tok, "html": f"{base}{P}/report.html?t={tok}",
                    "pdf": f"{base}{P}/report.pdf?t={tok}"}

        @router.post(f"{P}/report/send")
        def portal_report_send(user: str = Depends(gate)):
            """Render + email the summary to the owners NOW (collaborator or an owner presses send)."""
            svc = _report_service(cfg.report)
            out = svc.send_report(actor=user)
            logger.info("%s.portal.report.send by=%s sent=%s", cfg.domain, user, out.get("sent"))
            return out

    return router


# ── domain instances ──────────────────────────────────────────────────────────
LEGAL = PortalDomain(
    domain="legal", partner="raz", gate=require_legal_editor, is_editor=db.is_legal_editor,
    notify_label="Legal portal", notify_emoji="⚖️", report="legal_report",
    report_filename="legal-summary.pdf",
)
IT = PortalDomain(
    domain="it", partner="oren", gate=require_it_editor, is_editor=db.is_it_editor,
    notify_label="IT portal", notify_emoji="🛠️", report="it_report",
    report_filename="it-summary.pdf", editor_store="it",
)
BIZ = PortalDomain(
    domain="biz", partner="raful", gate=require_biz_editor, is_editor=db.is_biz_editor,
    notify_label="Biz-dev portal", notify_emoji="📈", report="biz_report",
    report_filename="biz-summary.pdf", editor_store="biz",
)

# One module-level `router` that mounts all domains, so main.py includes it like any other.
router = APIRouter()
router.include_router(build_portal_router(LEGAL))
router.include_router(build_portal_router(IT))
router.include_router(build_portal_router(BIZ))
