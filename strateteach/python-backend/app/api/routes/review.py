"""Review board (Phase 2) — multi-user Review-Mode submissions + Dan's mini-portal.

Each gated reviewer walks the app collecting per-screen "what to fix" notes in the client (Review
Mode, localStorage), then SUBMITS them here as one submission. The mini-portal (/review-inbox)
lists every submission, lets a viewer merge a submission's tasks into their own working notes,
delete a submission, and compile a date-range report to email or download.

All endpoints live under /auth/* (already proxied by Caddy) and are gated by require_reviewer
— the product OWNERS (Dan/Rafi/Yoav), any role=='admin' user, PLUS the portal collaborators:
Oren (it_editor), Raz (legal_editor) and Raful (biz_editor). No one else reaches any of this.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import database as db
from app.core.security import require_reviewer
from app.services import email as email_svc

logger = logging.getLogger("algo770")

router = APIRouter(tags=["review"])

# Fixed instruction block injected at the TOP of every compiled prompt / report, so the executing
# agent scans-first (checks git history / codebase) before doing anything. Kept verbatim + in sync
# with the frontend constant (ReviewMode.tsx PROMPT_HEADER).
PROMPT_HEADER = (
    "# Agent — read first\n"
    "Before executing anything below: for EACH task, FIRST scan the codebase + recent git history "
    "to check whether this change was ALREADY made (note when). Skip anything already done. Then "
    "produce an APPROVED LIST of only the not-yet-done tasks, and execute those.\n"
)


class ReviewNoteIn(BaseModel):
    screen: str = ""
    route: str = ""
    text: str = ""
    code: str = ""
    ts: str = ""
    files: list[str] = Field(default_factory=list)   # data-URLs on submit → stored as tokens


class ReviewSubmitIn(BaseModel):
    notes: list[ReviewNoteIn] = Field(default_factory=list)
    prompt: str = ""
    fromName: str | None = None


@router.post("/auth/review/submit")
def submit_review(body: ReviewSubmitIn, username: str = Depends(require_reviewer)):
    """A gated reviewer submits their collected notes as ONE submission."""
    notes = [n.model_dump() for n in body.notes]
    if not notes:
        raise HTTPException(status_code=422, detail="No notes to submit.")
    row = db.add_review_submission(username, (body.fromName or username), notes, body.prompt)
    return {"ok": True, "submission": _view(row)}


@router.get("/auth/review/submissions")
def list_submissions(_username: str = Depends(require_reviewer)):
    """Every submission on the board, newest first."""
    return {"submissions": [_view(r) for r in db.list_review_submissions()]}


@router.delete("/auth/review/submissions/{sub_id}")
def delete_submission(sub_id: int, _username: str = Depends(require_reviewer)):
    """Remove one submission (and its attached files) from the board."""
    db.delete_review_submission(sub_id)
    return {"ok": True, "id": sub_id}


@router.get("/auth/review/file/{token}")
def serve_review_file(token: str):
    """PUBLIC (no bearer — see auth_gate): stream one attached review file to an <img>/<a> tag.
    The token is unguessable (secrets), so knowing it is the capability, same as guide assets."""
    f = db.get_review_file(token)
    if not f:
        raise HTTPException(status_code=404, detail="not found")
    return Response(content=f["data"], media_type=f.get("mime") or "application/octet-stream",
                    headers={"Cache-Control": "private, max-age=300"})


@router.get("/auth/review/report")
def review_report(
    _username: str = Depends(require_reviewer),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
):
    """All submissions in [from, to] + a compiled markdown report (for download / preview)."""
    subs = db.review_submissions_in_range(date_from, date_to)
    return {
        "from": date_from, "to": date_to,
        "count": len(subs),
        "taskCount": sum(len(s.get("notes") or []) for s in subs),
        "submissions": [_view(r) for r in subs],
        "markdown": _compile_report(subs, date_from, date_to),
    }


class ReviewEmailIn(BaseModel):
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    email: str | None = None   # optional override recipient


@router.post("/auth/review/report/send")
def send_review_report(body: ReviewEmailIn, username: str = Depends(require_reviewer)):
    """Compile the date-range report and EMAIL it (reuses the app's email service). Sends to the
    override address if given, else the caller's own account email."""
    if not email_svc.email_configured():
        raise HTTPException(status_code=503, detail="Email is not configured on the server.")
    recipient = (body.email or "").strip() or ((db.get_user(username) or {}).get("email") or "").strip()
    if not recipient:
        raise HTTPException(status_code=422, detail="No recipient email (add one to your account or pass ?email).")
    subs = db.review_submissions_in_range(body.from_, body.to)
    md = _compile_report(subs, body.from_, body.to)
    rng = _range_label(body.from_, body.to)
    subject = f"StrateTeach — Review report ({rng})"
    body_html = "<pre style='font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap'>" + _escape(md) + "</pre>"
    res = email_svc.send_email(recipient, subject, md, body_html)
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res.get("message") or "Email send failed.")
    return {"ok": True, "to": recipient, "count": len(subs)}


# ── Prompt snapshots · per-reviewer save/restore checkpoints ───────────────────────
# Dan's ask: in the prompt-editing screen, SAVE the current working prompt as a named +
# timestamped snapshot BEFORE executing, and RESTORE a previous one if the result isn't good.
# Owner-scoped (each reviewer sees only their own). Restore is client-side (load `content` back
# into the editor), so no restore endpoint is needed — just list / create / delete.
class SnapshotIn(BaseModel):
    name: str = ""
    content: str = ""


def _snap_view(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "name": row.get("name") or "",
        "content": row.get("content") or "",
        "createdAt": row.get("created_at"),
    }


@router.get("/auth/review/snapshots")
def list_snapshots(username: str = Depends(require_reviewer)):
    """The caller's saved prompt snapshots, newest first."""
    return {"snapshots": [_snap_view(r) for r in db.list_review_snapshots(username)]}


@router.post("/auth/review/snapshots")
def create_snapshot(body: SnapshotIn, username: str = Depends(require_reviewer)):
    """Save the current working prompt as ONE named + timestamped snapshot."""
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=422, detail="Nothing to save — the prompt is empty.")
    name = (body.name or "").strip() or f"Snapshot {db.now_iso()[:16].replace('T', ' ')}"
    row = db.add_review_snapshot(username, name, content)
    return {"ok": True, "snapshot": _snap_view(row)}


@router.delete("/auth/review/snapshots/{snap_id}")
def delete_snapshot(snap_id: int, username: str = Depends(require_reviewer)):
    """Delete one of the caller's own snapshots."""
    db.delete_review_snapshot(username, snap_id)
    return {"ok": True, "id": snap_id}


# ── helpers ──────────────────────────────────────────────────────────────────────
def _view(row: dict) -> dict:
    """Trim a DB row to the client shape."""
    return {
        "id": row.get("id"),
        "fromUser": row.get("from_user"),
        "fromName": row.get("from_name") or row.get("from_user"),
        "notes": row.get("notes") or [],
        "prompt": row.get("prompt_text") or "",
        "createdAt": row.get("created_at"),
    }


def _range_label(a: str | None, b: str | None) -> str:
    if a and b:
        return f"{a} → {b}"
    if a:
        return f"from {a}"
    if b:
        return f"through {b}"
    return "all time"


def _escape(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _task_line(n: dict) -> str:
    """One report/prompt task line: `- [#CODE · date] text  [N files]`."""
    text = str(n.get("text") or "").replace("\r\n", " ").replace("\n", " ").strip()
    code = str(n.get("code") or "").strip()
    when = _short_dt(str(n.get("ts") or ""))
    nfiles = len(n.get("files") or [])
    tag = ""
    if code or when:
        tag = "[" + " · ".join(x for x in [f"#{code}" if code else "", when] if x) + "] "
    files = f"  [{nfiles} file{'s' if nfiles != 1 else ''}]" if nfiles else ""
    return f"- {tag}{text}{files}\n"


def _short_dt(iso: str) -> str:
    """ISO → 'YYYY-MM-DD HH:MM' (best-effort; returns the input on failure)."""
    if not iso:
        return ""
    try:
        from datetime import datetime
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso[:16].replace("T", " ")


def _compile_report(subs: list[dict], a: str | None, b: str | None) -> str:
    """One combined markdown report across all submissions in range, grouped by submitter. Always
    opens with the scan-first PROMPT_HEADER so the executing agent checks git/codebase first."""
    total_tasks = sum(len(s.get("notes") or []) for s in subs)
    out = PROMPT_HEADER
    out += f"\n# Review report ({_range_label(a, b)}) — {len(subs)} submission(s), {total_tasks} task(s)\n"
    out += "\n# Fix requests (by screen)\n"
    for s in subs:
        who = s.get("from_name") or s.get("from_user")
        when = s.get("created_at") or ""
        notes = s.get("notes") or []
        out += f"\n## {who} — {when}  ({len(notes)} task{'s' if len(notes) != 1 else ''})\n"
        by_screen: dict[str, list[dict]] = {}
        for n in notes:
            key = f"{n.get('screen') or ''} ({n.get('route') or ''})"
            by_screen.setdefault(key, []).append(n)
        for screen, items in by_screen.items():
            out += f"\n### {screen}\n"
            for n in items:
                out += _task_line(n)
    return out
