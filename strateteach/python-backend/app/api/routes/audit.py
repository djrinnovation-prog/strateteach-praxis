"""Daily AUDIT system — a living audit loop for Oren (it/product), Raz (legal) and Dan (all).

Modelled on the legal-copy portal: a DB store + role-gated edit/approve. Audit items carry
an editable `prompt` (the check to run) and a workflow status (todo/in_process/redo/approved);
each run snapshots the prompt + the pasted result and can be approved (which approves the item).
"Generate today's audit prompt" bundles all non-approved items in the caller's domains into one
runnable prompt.

Domain visibility (gate):
  • main admin (Dan) — all domains, read/write.
  • it_editor (Oren) — {it, product}, read/write.
  • legal_editor (Raz) — {legal}, read/write.
  • other product owners — all domains, READ-ONLY.
  • anyone else — nothing.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import database as db
from app.core.security import current_user, is_owner, require_owner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["audit"])

ALL = {"it", "legal", "product"}


def _writable_domains(user: str) -> set:
    """Domains this user may EDIT / MANAGE:
      • product OWNERS (Dan/Rafi/Yoav) + main admin → ALL — the global oversight view in
        the /owners portal manages every domain.
      • any role=='admin' STAFF member (the Staff-Audit landing gates on isAdmin() with an
        all-domains scope) → ALL, so an internal admin can view/create/edit/respond.
      • the it_editor grant (Oren) → {it, product}; the legal_editor grant (Raz) → {legal};
        the biz_editor grant (Raful) → {biz}.
    Everyone else → nothing (audit is internal governance data, never exposed to customers)."""
    u = db.get_user(user) or {}
    if u.get("is_main") or is_owner(user) or u.get("role") == "admin":
        return set(ALL)
    doms: set = set()
    if u.get("it_editor"):
        doms |= {"it", "product"}
    if u.get("legal_editor"):
        doms |= {"legal"}
    if u.get("biz_editor"):
        doms |= {"biz"}
    return doms


def _viewable_domains(user: str) -> set:
    u = db.get_user(user) or {}
    if is_owner(user) or u.get("is_main"):
        return set(ALL)
    return _writable_domains(user)


def _require_write(user: str, domain: str) -> None:
    if domain not in _writable_domains(user):
        raise HTTPException(403, "You may not edit audit items in this domain.")


class ItemCreate(BaseModel):
    title: str = ""
    prompt: str = ""
    domain: str = "product"
    section: str = ""
    baseline: str | None = None
    status: str | None = None


class ItemEdit(BaseModel):
    prompt: str | None = None
    doneNote: str | None = None


class StatusInput(BaseModel):
    status: str = ""


class RunInput(BaseModel):
    resultText: str | None = None


class DailyPromptInput(BaseModel):
    domain: str | None = None


@router.get("/audit/items")
def audit_items(user: str = Depends(current_user)):
    """Items the caller may see, grouped by section, each tagged with canWrite."""
    view = _viewable_domains(user)
    write = _writable_domains(user)
    items = db.list_audit_items(sorted(view) if view else [])
    groups: list = []
    by_section: dict = {}
    for it in items:
        it["canWrite"] = it["domain"] in write
        by_section.setdefault(it["section"], []).append(it)
    for section, its in by_section.items():
        groups.append({"section": section, "items": its})
    return {"sections": groups, "writeDomains": sorted(write), "viewDomains": sorted(view)}


@router.post("/audit/items")
def audit_item_create(body: ItemCreate, user: str = Depends(current_user)):
    """Create a NEW custom audit / task item. Gated to the domain's editor (staff editors +
    owners) — the same _require_write gate that guards editing. Returns the created item
    already tagged canWrite=True (the creator can always write it) so the UI shows it live."""
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "A title is required.")
    domain = (body.domain or "product").strip()
    if domain not in _writable_domains(user):
        raise HTTPException(403, "You may not create audit items in this domain.")
    section = (body.section or "").strip() or ("משימות חדשות / New")
    row = db.create_audit_item(
        domain=domain, section=section, title=title, prompt=(body.prompt or "").strip(),
        baseline=(body.baseline or "missing"), status=(body.status or "todo"), created_by=user,
    )
    if not row:
        raise HTTPException(500, "Could not create the item.")
    row["canWrite"] = True
    logger.info("audit.item.create id=%s domain=%s by=%s", row.get("id"), domain, user)
    return {"ok": True, "item": row}


@router.put("/audit/items/{item_id}")
def audit_item_save(item_id: int, body: ItemEdit, user: str = Depends(current_user)):
    """Edit an item's prompt and/or done-note (gated to the domain's editor)."""
    item = db.get_audit_item(item_id)
    if not item:
        raise HTTPException(404, "No such audit item.")
    _require_write(user, item["domain"])
    row = db.update_audit_item(item_id, prompt=body.prompt, done_note=body.doneNote, updated_by=user)
    logger.info("audit.item.save id=%s by=%s", item_id, user)
    return {"ok": True, "item": row}


@router.post("/audit/items/{item_id}/status")
def audit_item_status(item_id: int, body: StatusInput, user: str = Depends(current_user)):
    """Move an item's workflow status (approve/in_process/redo/todo)."""
    item = db.get_audit_item(item_id)
    if not item:
        raise HTTPException(404, "No such audit item.")
    _require_write(user, item["domain"])
    if body.status not in db.AUDIT_STATUSES:
        raise HTTPException(400, "Invalid status.")
    row = db.set_audit_item_status(item_id, body.status, user)
    logger.info("audit.item.status id=%s status=%s by=%s", item_id, body.status, user)
    return {"ok": True, "item": row}


# audit_items workflow status → pm_tasks status (the two vocabularies differ).
_AUDIT_TO_PM_STATUS = {"todo": "todo", "in_process": "in_progress", "redo": "in_progress", "approved": "done"}


class MoveToPmInput(BaseModel):
    dryRun: bool = False
    ids: list[int] | None = None   # optional explicit subset; can only NARROW the safe default set


@router.post("/audit/move-to-pm")
def audit_move_to_pm(body: MoveToPmInput, owner: str = Depends(require_owner)):
    """OWNER-ONLY one-click COPY of Oren's control-panel / audit-board items into his IT
    pm_tasks (the "main IT tasks screen"). This exists because his home was forced to
    /staff-audit, so tasks he added landed on the audit board instead of his IT task manager.

    Candidate set = audit_items in {it, product} LAST EDITED by 'oren' (the board has no
    created_by — only updated_by — so this is "items Oren last touched"). An optional `ids`
    list can only NARROW that safe set (a client can never inject arbitrary items).

    COPY ONLY — never move or delete: each source item is left in place and marked 'approved'
    (fully reversible from the board). Idempotent via pm_tasks.key='audit-moved|{id}', so
    re-runs skip anything already imported and never duplicate. `dryRun=true` returns just the
    candidate count (for the confirm dialog) and changes nothing."""
    OREN = "oren"
    items = db.list_audit_items(["it", "product"])
    cands = [it for it in items if (it.get("updatedBy") or "").strip().lower() == OREN]
    if body.ids:
        idset = {int(x) for x in body.ids}
        cands = [it for it in cands if it.get("id") in idset]
    if body.dryRun:
        return {"ok": True, "dryRun": True, "candidates": len(cands)}
    copied = skipped = failed = 0
    for it in cands:
        try:
            key = f"audit-moved|{it['id']}"
            if db.get_pm_task_by_key(key):          # idempotent — already imported
                skipped += 1
                continue
            detail = "\n\n".join(x for x in [(it.get("prompt") or "").strip(), (it.get("doneNote") or "").strip()] if x)
            status = _AUDIT_TO_PM_STATUS.get((it.get("status") or "todo"), "todo")
            db.create_pm_task(title_he=(it.get("title") or ""), title_en="", assignee=OREN,
                              partner=OREN, partners=[OREN], status=status, detail=detail,
                              category=(it.get("section") or None), key=key, created_by=owner)
            db.set_audit_item_status(it["id"], "approved", owner)   # retire source (reversible) — NEVER delete
            copied += 1
        except Exception:   # noqa: BLE001 — one bad row must not abort the batch
            logger.exception("audit.move-to-pm failed for item id=%s", it.get("id"))
            failed += 1
    logger.info("audit.move-to-pm owner=%s copied=%s skipped=%s failed=%s candidates=%s",
                owner, copied, skipped, failed, len(cands))
    return {"ok": True, "candidates": len(cands), "copied": copied, "skipped": skipped, "failed": failed}


@router.post("/audit/items/{item_id}/run")
def audit_item_run(item_id: int, body: RunInput, user: str = Depends(current_user)):
    """Create a run snapshotting the item's prompt (item moves to in_process)."""
    item = db.get_audit_item(item_id)
    if not item:
        raise HTTPException(404, "No such audit item.")
    _require_write(user, item["domain"])
    run = db.create_audit_run(item_id, body.resultText or "")
    logger.info("audit.item.run id=%s by=%s run=%s", item_id, user, run and run.get("id"))
    return {"ok": True, "run": run, "item": db.get_audit_item(item_id)}


@router.get("/audit/items/{item_id}/runs")
def audit_item_runs(item_id: int, user: str = Depends(current_user)):
    item = db.get_audit_item(item_id)
    if not item:
        raise HTTPException(404, "No such audit item.")
    if item["domain"] not in _viewable_domains(user):
        raise HTTPException(403, "Not visible to you.")
    return {"runs": db.list_audit_runs(item_id)}


@router.put("/audit/runs/{run_id}")
def audit_run_save(run_id: int, body: RunInput, user: str = Depends(current_user)):
    """Save/paste a run's result text before approving it."""
    run = db.get_audit_run(run_id)
    if not run:
        raise HTTPException(404, "No such run.")
    item = db.get_audit_item(run["itemId"])
    _require_write(user, item["domain"] if item else "")
    row = db.update_audit_run_result(run_id, body.resultText or "")
    return {"ok": True, "run": row}


@router.post("/audit/runs/{run_id}/approve")
def audit_run_approve(run_id: int, user: str = Depends(current_user)):
    """Approve a run — marks the run approved and its item Approved (clears it from open)."""
    run = db.get_audit_run(run_id)
    if not run:
        raise HTTPException(404, "No such run.")
    item = db.get_audit_item(run["itemId"])
    _require_write(user, item["domain"] if item else "")
    row = db.approve_audit_run(run_id, user)
    logger.info("audit.run.approve run=%s by=%s", run_id, user)
    return {"ok": True, "run": row, "item": db.get_audit_item(run["itemId"])}


@router.post("/audit/daily-prompt")
def audit_daily_prompt(body: DailyPromptInput, user: str = Depends(current_user)):
    """Compile all non-approved items in the caller's writable domains (or one requested
    domain) into a single runnable daily-audit prompt; stamps sent_at on those items."""
    write = _writable_domains(user)
    if not write:
        raise HTTPException(403, "No audit domains you can generate a prompt for.")
    domains = sorted(write)
    if body.domain:
        if body.domain not in write:
            raise HTTPException(403, "You may not generate a prompt for that domain.")
        domains = [body.domain]
    out = db.compile_audit_daily_prompt(domains)
    logger.info("audit.daily-prompt by=%s domains=%s count=%s", user, domains, out.get("count"))
    return out
