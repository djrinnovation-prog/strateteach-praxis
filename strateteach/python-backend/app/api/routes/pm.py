"""Owners Portal · project-management board (Phase 2).

A small task store toward launch + one editable headline GOAL per partner. Everything
lives under the ``/auth/pm/*`` prefix so the production Caddy — which proxies a fixed
allowlist of prefixes (``/auth/*`` among them) and does NOT reload on deploy — routes
these to the backend without a Caddyfile change (same reason team-roles / requests live
under ``/auth/*``).

Access model:
  • Owners/admins (``require_owner_or_admin`` — the SAME set that reaches the Owners
    Portal UI) manage everything: the full board, create/reassign/edit any task, set any
    partner's goal, and view any partner's personal screen.
  • A partner (any authenticated user) reads THEIR OWN tasks + goal (``/mine``) and may
    update progress / notes / status on their own tasks (``POST /tasks/{id}`` self-edit).

The Phase-3 voting system attaches to the SAME task/goal rows by id — no remodelling.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

try:  # Israel-local morning stamp; fall back to UTC if tzdata is unavailable.
    from zoneinfo import ZoneInfo
    _IL_TZ = ZoneInfo("Asia/Jerusalem")
except Exception:  # noqa: BLE001
    _IL_TZ = timezone.utc

from app import database as db
from app.core.security import current_user, require_owner_or_admin, require_owner, is_owner
from app.services import email as email_svc, notify, sms

logger = logging.getLogger("algo770")

# Report views render LIVE from current PM data — forbid every cache layer (browser/iframe/proxy)
# so a re-open/refresh always re-fetches a fresh render, never a stale "previous data" copy.
_NO_STORE = {"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"}

router = APIRouter(tags=["pm"])


# ── Progress rollup ───────────────────────────────────────────────────────────
def _rollup(tasks: list[dict]) -> dict:
    """Overall + per-phase progress from the task list, framed toward the FINAL
    milestone (releasing v1 for sale). `overall` is the mean task progress; `byPhase`
    is the mean progress per roadmap phase; the status buckets drive the breakdown."""
    n = len(tasks)
    overall = round(sum(int(t.get("progress") or 0) for t in tasks) / n) if n else 0
    by_phase: dict[str, dict] = {}
    for t in tasks:
        ph = t.get("phase") or "—"
        b = by_phase.setdefault(ph, {"sum": 0, "count": 0})
        b["sum"] += int(t.get("progress") or 0); b["count"] += 1
    phase_pct = {ph: (round(b["sum"] / b["count"]) if b["count"] else 0) for ph, b in by_phase.items()}
    buckets = {"todo": 0, "in_progress": 0, "blocked": 0, "done": 0}
    for t in tasks:
        buckets[t.get("status") or "todo"] = buckets.get(t.get("status") or "todo", 0) + 1
    return {"overall": overall, "byPhase": phase_pct, "counts": buckets, "total": n}


# ── Board (owners/admin) — the whole board + goals + rollup in one call ────────
@router.get("/auth/pm/board")
def pm_board(_: str = Depends(require_owner_or_admin)):
    tasks = db.list_pm_tasks()
    return {"tasks": tasks, "goals": db.list_pm_goals(), "progress": _rollup(tasks),
            "partners": list(db.PM_PARTNERS)}


# ── Mine (any partner) — the caller's own tasks + goal + partner id ────────────
@router.get("/auth/pm/mine")
def pm_mine(username: str = Depends(current_user)):
    pid = db.partner_for_username(username)
    tasks = db.list_pm_tasks_for(username)
    goal = db.get_pm_goal(pid) if pid else None
    return {"partner": pid, "tasks": tasks, "goal": goal, "progress": _rollup(tasks)}


# ── A specific partner's personal screen (owners/admin view any) ───────────────
@router.get("/auth/pm/partner/{partner}")
def pm_partner(partner: str, _: str = Depends(require_owner_or_admin)):
    if partner not in db.PM_PARTNERS:
        raise HTTPException(404, "Unknown partner.")
    tasks = db.list_pm_tasks(partner=partner)
    return {"partner": partner, "tasks": tasks, "goal": db.get_pm_goal(partner),
            "progress": _rollup(tasks)}


# ── Create a task (owners/admin) ───────────────────────────────────────────────
class PmTaskCreate(BaseModel):
    titleHe: str = ""
    titleEn: str = ""
    assignee: Optional[str] = None
    partner: Optional[str] = None            # legacy single-partner (still accepted)
    partners: Optional[List[str]] = None     # multi-partner assignment (preferred)
    status: str = "todo"
    progress: int = 0
    notes: str = ""
    detail: str = ""
    implStatus: str = ""
    phase: Optional[str] = None
    category: Optional[str] = None
    priority: str = "none"
    sort: int = 0


@router.post("/auth/pm/tasks")
def pm_create(body: PmTaskCreate, actor: str = Depends(require_owner)):
    # OWNER-only: the shared board's task lifecycle (create) is the owners'. A collaborator
    # (Raz/Oren) creates their OWN tasks from their portal's Tasks tab (portal endpoints,
    # partner-pinned), never arbitrary board rows here.
    if not (body.titleHe or body.titleEn):
        raise HTTPException(400, "A task needs a title.")
    # Accept a multi-partner list (preferred) or the legacy single partner; db normalizes.
    partners = body.partners if body.partners is not None else ([body.partner] if body.partner else None)
    task = db.create_pm_task(
        title_he=body.titleHe, title_en=body.titleEn, assignee=body.assignee,
        partner=body.partner, partners=partners, status=body.status, progress=body.progress,
        notes=body.notes, detail=body.detail, impl_status=body.implStatus, phase=body.phase,
        category=body.category, priority=body.priority, sort=body.sort, created_by=actor,
    )
    logger.info("pm.task.create id=%s partners=%s by=%s", task.get("id"), task.get("partners"), actor)
    return {"task": task}


# ── Update a task ──────────────────────────────────────────────────────────────
# Owners/admins may edit ANY field of ANY task. A partner may edit ONLY status /
# progress / notes on a task that is THEIRS (assignee == them or their partner id).
class PmTaskUpdate(BaseModel):
    titleHe: Optional[str] = None
    titleEn: Optional[str] = None
    assignee: Optional[str] = None
    partner: Optional[str] = None
    partners: Optional[List[str]] = None     # multi-partner reassignment (owners/admin)
    status: Optional[str] = None
    progress: Optional[int] = None
    notes: Optional[str] = None
    detail: Optional[str] = None
    implStatus: Optional[str] = None
    phase: Optional[str] = None
    category: Optional[str] = None
    priority: Optional[str] = None
    sort: Optional[int] = None


def _owns(task: dict, username: str) -> bool:
    """A task is the caller's if they're the assignee OR their partner id is in its (possibly
    multi-partner) assigned set — so every assigned partner may self-edit a shared task."""
    if task.get("assignee") == username:
        return True
    pid = db.partner_for_username(username)
    return bool(pid and pid in (task.get("partners") or ([task["partner"]] if task.get("partner") else [])))


@router.post("/auth/pm/tasks/{task_id}")
def pm_update(task_id: int, body: PmTaskUpdate, username: str = Depends(current_user)):
    task = db.get_pm_task(task_id)
    if not task:
        raise HTTPException(404, "No such task.")
    # camelCase field map matching db._PM_COL; only send the ones the caller set.
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    user = db.get_user(username)
    is_manager = bool(user and user.get("role") == "admin") or _is_owner(username)
    if is_manager:
        out = db.update_pm_task(task_id, fields, updated_by=username)  # any field
    elif _owns(task, username):
        out = db.update_pm_task(task_id, fields, updated_by=username, allowed=db.PM_PARTNER_FIELDS)
    else:
        raise HTTPException(403, "You can only update your own tasks.")
    logger.info("pm.task.update id=%s by=%s manager=%s", task_id, username, is_manager)
    return {"task": out}


@router.delete("/auth/pm/tasks/{task_id}")
def pm_delete(task_id: int, _: str = Depends(require_owner)):
    # OWNER-only: deleting a board task is the owners'. A collaborator deletes their OWN tasks
    # from their portal's Tasks tab (partner-guarded portal endpoint), never any board row here.
    db.delete_pm_task(task_id)
    return {"ok": True}


# ── Sub-tasks (checklist) ──────────────────────────────────────────────────────
# A manager may manage sub-tasks on ANY task; an assigned partner may manage them on
# THEIR task (same "who can edit the board" rule as a status/notes self-edit) so a
# partner can tick off their own checklist. Every mutation returns the whole task so the
# board re-renders with the fresh subtask list + progress.
class SubtaskCreate(BaseModel):
    title: str = ""


class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    done: Optional[bool] = None


def _load_task_for_edit(task_id: int, username: str) -> dict:
    task = db.get_pm_task(task_id)
    if not task:
        raise HTTPException(404, "No such task.")
    user = db.get_user(username)
    is_manager = bool(user and user.get("role") == "admin") or _is_owner(username)
    if not (is_manager or _owns(task, username)):
        raise HTTPException(403, "You can only edit your own tasks.")
    return task


@router.post("/auth/pm/tasks/{task_id}/subtasks")
def pm_subtask_add(task_id: int, body: SubtaskCreate, username: str = Depends(current_user)):
    _load_task_for_edit(task_id, username)
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "A sub-task needs a title.")
    out = db.add_pm_subtask(task_id, title, updated_by=username)
    return {"task": out}


@router.post("/auth/pm/tasks/{task_id}/subtasks/{sub_id}")
def pm_subtask_update(task_id: int, sub_id: int, body: SubtaskUpdate, username: str = Depends(current_user)):
    _load_task_for_edit(task_id, username)
    if body.title is None and body.done is None:
        raise HTTPException(400, "Nothing to update.")
    out = db.update_pm_subtask(task_id, sub_id, title=body.title, done=body.done, updated_by=username)
    return {"task": out}


@router.delete("/auth/pm/tasks/{task_id}/subtasks/{sub_id}")
def pm_subtask_delete(task_id: int, sub_id: int, username: str = Depends(current_user)):
    _load_task_for_edit(task_id, username)
    out = db.delete_pm_subtask(task_id, sub_id, updated_by=username)
    return {"task": out}


# ── Goals ──────────────────────────────────────────────────────────────────────
class PmGoalInput(BaseModel):
    goalHe: str = ""
    goalEn: str = ""


@router.post("/auth/pm/goals/{partner}")
def pm_set_goal(partner: str, body: PmGoalInput, username: str = Depends(current_user)):
    if partner not in db.PM_PARTNERS:
        raise HTTPException(404, "Unknown partner.")
    user = db.get_user(username)
    is_manager = bool(user and user.get("role") == "admin") or _is_owner(username)
    # A partner may set their OWN goal; owners/admins may set any partner's.
    if not is_manager and db.partner_for_username(username) != partner:
        raise HTTPException(403, "You can only set your own goal.")
    goal = db.set_pm_goal(partner, body.goalHe, body.goalEn, updated_by=username)
    logger.info("pm.goal.set partner=%s by=%s", partner, username)
    return {"goal": goal}


# ── Task comments — owner direction/feedback on tasks (+ the assignee's replies) ─
# Owners (Dan/Rafi/Yoav) comment on ANY task — including the collaborators' (Raz/Oren)
# tasks — to give direction. The task's assigned partner may reply on their OWN task. Owner
# comments also surface in the Owners Daily Report (see owners_report._task_rows).
class TaskComment(BaseModel):
    text: str = ""


def _can_comment(task: dict, username: str) -> bool:
    """Owners comment on ANY task; a task's assigned partner (incl. Raz/Oren) on their OWN task.
    Same 'who's involved with this task' rule the self-edit uses, plus owners over everything."""
    return is_owner(username) or _owns(task, username)


def _comment(row: dict, me: str) -> dict:
    return {"id": int(row.get("id") or 0), "author": row.get("author"),
            "authorName": row.get("author_name") or row.get("author") or "",
            "text": row.get("text") or "", "createdAt": row.get("created_at"),
            "isOwner": is_owner(row.get("author") or ""), "mine": row.get("author") == me}


@router.get("/auth/pm/tasks/{task_id}/comments")
def pm_task_comments(task_id: int, username: str = Depends(current_user)):
    """A task's comment thread. Owners see any task's; a partner sees their own task's."""
    task = db.get_pm_task(task_id)
    if not task:
        raise HTTPException(404, "No such task.")
    if not _can_comment(task, username):
        raise HTTPException(403, "You can only see comments on your own tasks.")
    return {"comments": [_comment(c, username) for c in db.list_pm_task_comments(task_id)]}


@router.post("/auth/pm/tasks/{task_id}/comments")
def pm_task_comment_add(task_id: int, body: TaskComment, username: str = Depends(current_user)):
    """Post a comment on a task. Owners → any task (direction/feedback); a partner → their own."""
    task = db.get_pm_task(task_id)
    if not task:
        raise HTTPException(404, "No such task.")
    if not _can_comment(task, username):
        raise HTTPException(403, "You can only comment on your own tasks.")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(400, "A comment needs text.")
    c = db.add_pm_task_comment(task_id, username, db.display_name(username), text[:4000])
    logger.info("pm.task.comment.add id=%s task=%s by=%s", c.get("id"), task_id, username)
    return {"comment": _comment(c, username)}


@router.delete("/auth/pm/tasks/{task_id}/comments/{comment_id}")
def pm_task_comment_delete(task_id: int, comment_id: int, username: str = Depends(current_user)):
    """Delete a comment. The comment's author or any owner may delete it."""
    c = next((x for x in db.list_pm_task_comments(task_id) if int(x["id"]) == comment_id), None)
    if not c:
        raise HTTPException(404, "No such comment.")
    if c.get("author") != username and not is_owner(username):
        raise HTTPException(403, "Only the author or an owner can delete this comment.")
    db.delete_pm_task_comment(comment_id)
    return {"ok": True}


# ══ Phase 3 · VOTING ══════════════════════════════════════════════════════════
# The owner votes on the whole system — the app's screens, the key product/business
# decisions, and the live PM tasks — and the results feed continued work back onto the
# board. One vote per voter per item (upsert). Owners/admins CAST; owners AND partners
# READ the tallies + results (read-only for a non-manager partner). A change/reject item
# can be promoted to a pm_tasks row so the outcome flows into the board (and Phase 4's
# daily summary reads the same rows). Votable items = a curated catalog on the frontend
# (owners.ts: SCREENS + DECISIONS) keyed by a stable item_key, PLUS the live PM tasks
# (task:{id}); the backend stores votes keyed by that id and tallies generically.


def _require_partner_or_owner(username: str = Depends(current_user)) -> str:
    """Read gate for the voting surfaces: pass for any full admin, a product owner, OR a
    resolved partner (dan/rafi/yoav/oren/raz). A partner reads the tallies + results
    read-only; casting stays behind require_owner_or_admin."""
    user = db.get_user(username)
    if (user and user.get("role") == "admin") or _is_owner(username) or db.partner_for_username(username):
        return username
    raise HTTPException(403, "Owners or partners only.")


def _can_vote(username: str) -> bool:
    """Who may CAST a vote — the SAME set require_owner_or_admin (the cast endpoint) allows: a
    product OWNER, or a collaborator with a portal grant (legal editor Raz / IT editor Oren).
    So the collaborator portals get FULL voting (cast), not a read-only tally. A plain partner
    with no grant stays read-only."""
    return (_is_owner(username)
            or db.is_legal_editor(username) or db.is_it_editor(username) or db.is_biz_editor(username))


def _vote_tallies() -> dict:
    """item_key → tally. Screens/tasks: approve/change/reject (+ approvalPct). Decisions:
    `byOption` counts per chosen option (+ winning option `top`/`topPct`). `abstain` +
    `total` (all ballots) apply to both."""
    out: dict[str, dict] = {}
    for v in db.list_votes():
        t = out.setdefault(v["itemKey"], {
            "itemKey": v["itemKey"], "itemType": v["itemType"],
            "approve": 0, "change": 0, "reject": 0, "abstain": 0, "total": 0,
            "byOption": {}, "voters": []})
        vote = v["vote"]
        if vote == "option" and v.get("choice"):
            t["byOption"][v["choice"]] = int(t["byOption"].get(v["choice"], 0)) + 1
        elif vote in ("approve", "change", "reject", "abstain"):
            t[vote] = int(t.get(vote, 0)) + 1
        t["total"] += 1
        t["voters"].append({"voter": v["voter"], "vote": vote, "choice": v.get("choice"),
                            "comment": v["comment"], "updatedAt": v["updatedAt"]})
    for t in out.values():
        decided = t["approve"] + t["change"] + t["reject"]           # excludes abstain
        t["approvalPct"] = round(100 * t["approve"] / decided) if decided else 0
        picks = sum(t["byOption"].values())                          # decision option picks
        if picks:
            top = max(t["byOption"].items(), key=lambda kv: kv[1])
            t["top"] = top[0]
            t["topPct"] = round(100 * top[1] / picks)
            t["picks"] = picks
        else:
            t["top"] = None; t["topPct"] = 0; t["picks"] = 0
    return out


def _vote_linked() -> dict:
    """item_key → pm_tasks id for items already promoted to the board (key `vote:{item_key}`)."""
    out: dict[str, int] = {}
    for t in db.list_pm_tasks():
        k = t.get("key") or ""
        if k.startswith("vote:"):
            out[k[len("vote:"):]] = t["id"]
    return out


def _vote_task_items() -> list:
    """The live PM tasks as votable items (task:{id}) — excludes the vote-spawned rows so
    the Tasks vote-group stays the real roadmap, not a promotion echo."""
    items = []
    for t in db.list_pm_tasks():
        if (t.get("key") or "").startswith("vote:"):
            continue
        items.append({"key": f"task:{t['id']}", "itemType": "task", "taskId": t["id"],
                      "titleHe": t["titleHe"], "titleEn": t["titleEn"],
                      "partner": t.get("partner"), "status": t.get("status")})
    return items


class VoteCast(BaseModel):
    itemKey: str
    itemType: str = "screen"
    vote: str                                # approve|change|reject (screen/task) | option | abstain
    choice: Optional[str] = None             # chosen option id when vote='option' (decisions)
    comment: str = ""


@router.get("/auth/pm/votes")
def pm_votes(username: str = Depends(_require_partner_or_owner)):
    """Votable items' tallies + the caller's own vote per item + task items + which items
    are already linked to a board task + whether the caller may cast."""
    return {"tallies": _vote_tallies(),
            "mine": {v["itemKey"]: {"vote": v["vote"], "choice": v.get("choice"), "comment": v["comment"]}
                     for v in db.list_votes() if v["voter"] == username},
            "taskItems": _vote_task_items(), "linked": _vote_linked(),
            "canVote": _can_vote(username)}


@router.post("/auth/pm/votes")
def pm_cast_vote(body: VoteCast, actor: str = Depends(require_owner_or_admin)):
    ik = (body.itemKey or "").strip()
    if not ik:
        raise HTTPException(400, "Missing item.")
    if body.vote not in db.VOTE_BALLOT:
        raise HTTPException(400, "Vote must be approve / change / reject / option / abstain.")
    if body.vote == "option" and not (body.choice or "").strip():
        raise HTTPException(400, "A decision pick needs a choice.")
    try:
        v = db.upsert_vote(ik, body.itemType, actor, body.vote, (body.comment or "").strip(), body.choice)
    except ValueError as e:
        raise HTTPException(400, str(e))
    logger.info("pm.vote.cast item=%s vote=%s choice=%s by=%s", ik, body.vote, body.choice, actor)
    return {"vote": v, "tally": _vote_tallies().get(ik)}


@router.delete("/auth/pm/votes/{item_key}")
def pm_withdraw_vote(item_key: str, actor: str = Depends(require_owner_or_admin)):
    """Retract the caller's own vote on an item (not just switch it)."""
    db.clear_vote(item_key, actor)
    return {"ok": True, "tally": _vote_tallies().get(item_key)}


@router.get("/auth/pm/votes/results")
def pm_vote_results(_: str = Depends(_require_partner_or_owner)):
    """The rollup: per-item tallies (prioritized), an overall approval %, and the
    prioritized NEEDS-WORK list (any change/reject) that feeds continued work."""
    tallies = _vote_tallies()
    items = sorted(tallies.values(), key=lambda t: (-t["reject"], -t["change"], -t["total"]))
    for t in items:
        best = max(("approve", "change", "reject"), key=lambda k: t[k])
        t["consensus"] = best if t[best] else None
    # Decisions = items with option picks; the winner is already on the tally (top/topPct).
    decisions = [t for t in items if t["picks"]]
    # Needs-work: only judged screen/task items with change/reject (decisions never qualify).
    needs_work = [t for t in items if t["itemType"] != "decision" and (t["change"] or t["reject"])]
    total_votes = sum(t["total"] for t in items)
    decided = sum(t["approve"] + t["change"] + t["reject"] for t in items)   # screen/task, ex-abstain
    total_approve = sum(t["approve"] for t in items)
    overall = {"approvalPct": round(100 * total_approve / decided) if decided else 0,
               "totalVotes": total_votes, "itemsVoted": len(items),
               "decisionsCount": len(decisions), "needsWorkCount": len(needs_work)}
    return {"items": items, "overall": overall, "decisions": decisions,
            "needsWork": needs_work, "linked": _vote_linked()}


class VotePromote(BaseModel):
    itemKey: str
    itemType: str = "screen"
    titleHe: str = ""
    titleEn: str = ""
    partner: Optional[str] = None


@router.post("/auth/pm/votes/promote")
def pm_vote_promote(body: VotePromote, actor: str = Depends(require_owner)):
    """Turn a needs-change/reject outcome into board work. A task item is already on the
    board (returns it). Otherwise create/link ONE pm_tasks row keyed `vote:{item_key}` so
    the outcome flows into the board and re-promoting links instead of duplicating.
    OWNER-only: promotion WRITES a board task (board management), so it stays with the owners
    even though collaborators may CAST + read votes (Results/promote UI is owner-only too)."""
    ik = (body.itemKey or "").strip()
    if not ik:
        raise HTTPException(400, "Missing item.")
    if body.itemType == "task" and ik.startswith("task:"):
        try:
            tid = int(ik.split(":", 1)[1])
        except ValueError:
            raise HTTPException(400, "Bad task item.")
        t = db.get_pm_task(tid)
        if not t:
            raise HTTPException(404, "No such task.")
        return {"task": t, "linked": True, "created": False}
    key = f"vote:{ik}"
    existing = db.get_pm_task_by_key(key)
    if existing:
        return {"task": existing, "linked": True, "created": False}
    tally = _vote_tallies().get(ik, {})
    note = (f"Flagged by owners' vote — {tally.get('change', 0)} needs-change · "
            f"{tally.get('reject', 0)} reject · {tally.get('approve', 0)} approve.")
    # Land it on a partner's column so it's visible on the board (owners can reassign).
    partner = body.partner if body.partner in db.PM_PARTNERS else "dan"
    task = db.create_pm_task(
        title_he=(body.titleHe or ik), title_en=(body.titleEn or ik), assignee=partner,
        partner=partner, status="todo", progress=0, notes=note, impl_status="",
        phase=None, category="vote", sort=0, created_by=actor, key=key)
    logger.info("pm.vote.promote item=%s task=%s by=%s", ik, task.get("id"), actor)
    return {"task": task, "linked": True, "created": True}


# ══ Phase 4 · DAILY-SUMMARY PORTAL ═════════════════════════════════════════════
# One aggregated morning payload the owners scan each day, composed server-side from the
# SAME pm data (tasks, goals, votes, the progress + vote rollups) — no heavy new backend.
# build_daily() is the reusable core; the composed one-paragraph `summary` (HE + EN) is
# deliberately self-contained so Part C's report-sending can reuse it verbatim.
_PM_NAME = {"dan": "Dan", "rafi": "Rafi", "yoav": "Yoav", "oren": "Oren", "raz": "Raz", "raful": "Raful"}


def _il_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(_IL_TZ)


def _daily_summary(*, overall: int, attention: list, decisions: list, contested: list,
                   partners: list, date_en: str, date_he: str) -> dict:
    blocked = [a for a in attention if a["kind"] == "blocked"]
    near = [a for a in attention if a["kind"] == "near_done"]
    flagged = [a for a in attention if a["kind"] == "vote_needswork"]
    top = max(partners, key=lambda p: p["openCount"]) if partners else None
    top_name = _PM_NAME.get((top or {}).get("partner", ""), (top or {}).get("partner", "")) if top else ""
    blocker = blocked[0] if blocked else None
    en = (f"Good morning — {date_en}. We're {overall}% to launch. "
          f"{len(attention)} item(s) need attention today "
          f"({len(blocked)} blocked, {len(near)} near done, {len(flagged)} flagged in voting).")
    if blocker and blocker.get("titleEn"):
        en += f" Top blocker: {blocker['titleEn']}."
    en += f" Voting: {len(decisions)} decision(s) settled, {len(contested)} still contested."
    if top and top["openCount"]:
        en += f" {top_name} carries the most open work ({top['openCount']} tasks)."
    he = (f"בוקר טוב — {date_he}. אנחנו ב-{overall}% עד ההשקה. "
          f"{len(attention)} פריטים דורשים תשומת לב היום "
          f"({len(blocked)} חסומים, {len(near)} קרובים לסיום, {len(flagged)} סומנו בהצבעה).")
    if blocker and blocker.get("titleHe"):
        he += f" החסם המרכזי: {blocker['titleHe']}."
    he += f" הצבעה: {len(decisions)} החלטות הוכרעו, {len(contested)} עדיין שנויות במחלוקת."
    if top and top["openCount"]:
        he += f" {top_name} עם הכי הרבה עבודה פתוחה ({top['openCount']} משימות)."
    return {"he": he, "en": en}


def build_daily() -> dict:
    """The aggregated morning payload — assembled ONCE, server-side, from the existing pm
    data. Reused by the /auth/pm/daily route and (Part C) the report-sender."""
    tasks = db.list_pm_tasks()
    goals = {g["partner"]: g for g in db.list_pm_goals()}
    by_task_key = {f"task:{t['id']}": t for t in tasks}
    roll = _rollup(tasks)
    overall = int(roll.get("overall") or 0)
    tallies = _vote_tallies()

    def _title_for(item_key: str) -> "tuple[str, str]":
        t = by_task_key.get(item_key)
        return (t["titleHe"], t["titleEn"]) if t else ("", "")

    # ── Voting pulse: settled decision winners, still-contested decisions, flagged screens.
    decisions, contested, screens_flagged = [], [], []
    for t in tallies.values():
        if t["picks"]:
            last_at = max((v.get("updatedAt") or "" for v in t["voters"]), default="")
            entry = {"itemKey": t["itemKey"], "top": t.get("top"), "topPct": t.get("topPct", 0),
                     "picks": t["picks"], "lastAt": last_at}
            decisions.append(entry)
            if t.get("topPct", 0) < 60:
                contested.append(entry)
        elif t["itemType"] == "screen" and t["change"]:
            screens_flagged.append({"itemKey": t["itemKey"], "change": t["change"], "reject": t["reject"]})
    decisions.sort(key=lambda d: d["lastAt"], reverse=True)

    # ── Needs attention today (deduped by item_key, priority order) — each deep-links.
    attention: list = []
    seen: set = set()

    def _add(entry: dict) -> None:
        if entry["itemKey"] in seen:
            return
        seen.add(entry["itemKey"]); attention.append(entry)

    for tk in tasks:                                   # blocked first (most urgent)
        if tk["status"] == "blocked":
            _add({"kind": "blocked", "itemKey": f"task:{tk['id']}", "target": "board",
                  "titleHe": tk["titleHe"], "titleEn": tk["titleEn"], "progress": tk["progress"], "taskId": tk["id"]})
    for t in tallies.values():                          # vote-flagged (change/reject, non-decision)
        if t["itemType"] != "decision" and (t["change"] or t["reject"]):
            th, te = _title_for(t["itemKey"])
            _add({"kind": "vote_needswork", "itemKey": t["itemKey"], "target": "vote",
                  "titleHe": th, "titleEn": te, "change": t["change"], "reject": t["reject"]})
    for tk in tasks:                                    # near done — the quick wins
        if tk["status"] == "in_progress" and 70 <= tk["progress"] < 100:
            _add({"kind": "near_done", "itemKey": f"task:{tk['id']}", "target": "board",
                  "titleHe": tk["titleHe"], "titleEn": tk["titleEn"], "progress": tk["progress"], "taskId": tk["id"]})
    for tk in tasks:                                    # nearest-term open priorities (p0/p1 todo)
        if tk["status"] == "todo" and (tk.get("phase") in ("p0", "p1")) and tk["progress"] < 40:
            _add({"kind": "open_priority", "itemKey": f"task:{tk['id']}", "target": "board",
                  "titleHe": tk["titleHe"], "titleEn": tk["titleEn"], "progress": tk["progress"], "taskId": tk["id"]})
    attention = attention[:12]

    # ── Per-partner snapshot: open-task count + their piece of progress + headline goal.
    partners = []
    for pid in db.PM_PARTNERS:
        plist = [tk for tk in tasks if pid in (tk.get("partners") or ([tk["partner"]] if tk.get("partner") else []))]
        open_count = sum(1 for tk in plist if tk["status"] != "done")
        avg = round(sum(tk["progress"] for tk in plist) / len(plist)) if plist else 0
        g = goals.get(pid) or {}
        partners.append({"partner": pid, "name": _PM_NAME.get(pid, pid), "openCount": open_count,
                         "avgProgress": avg, "goalHe": g.get("goalHe", ""), "goalEn": g.get("goalEn", "")})

    # ── Recently changed feed (task edits + vote casts), newest first.
    feed = []
    for tk in tasks:
        if tk.get("updatedAt"):
            feed.append({"kind": "task", "itemKey": f"task:{tk['id']}", "target": "board",
                         "titleHe": tk["titleHe"], "titleEn": tk["titleEn"], "updatedAt": tk["updatedAt"], "by": tk.get("updatedBy")})
    for v in db.list_votes():
        th, te = _title_for(v["itemKey"])
        feed.append({"kind": "vote", "itemKey": v["itemKey"], "target": "vote",
                     "titleHe": th, "titleEn": te, "updatedAt": v["updatedAt"], "by": v["voter"]})
    feed.sort(key=lambda x: x["updatedAt"] or "", reverse=True)
    feed = feed[:8]

    il = _il_now()
    date_iso = il.strftime("%Y-%m-%d")
    date_en = f"{il.day} {il.strftime('%b %Y')}"
    date_he = f"{il.day}/{il.month}/{il.year}"
    summary = _daily_summary(overall=overall, attention=attention, decisions=decisions,
                             contested=contested, partners=partners, date_en=date_en, date_he=date_he)
    return {"date": date_iso, "dateEn": date_en, "dateHe": date_he,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "overall": overall, "counts": roll.get("counts", {}),
            "attention": attention,
            "votingPulse": {"decisions": decisions, "contested": contested, "screensFlagged": screens_flagged},
            "partners": partners, "recent": feed, "summary": summary}


@router.get("/auth/pm/daily")
def pm_daily(_: str = Depends(require_owner_or_admin)):
    """The morning scan — one aggregated payload (owners/admin)."""
    return build_daily()


# ══ Part C2 · SEND SUMMARY REPORT (compose → preview → confirm → send) ══════════
# SAFETY: never auto-sends. The endpoint defaults to dryRun (compose + resolve recipients
# only). A live send requires dryRun=False, which the UI passes ONLY after an explicit
# owner click + a ConfirmModal. Recipient scope is the TEAM/PARTNERS only (never all app
# users). Default channel is the IN-APP DM (db.chat_send — a pure DB insert, NO external
# push), lowest blast radius + no external keys. External channels gracefully no-op.
_PM_ROLE = {"dan": ("בעלים ומנהל", "Owner & Admin"), "rafi": ("משקיע ובעלים", "Investor & Owner"),
            "yoav": ("בעלים וראש קריאייטיב", "Owner & Head of Creative"),
            "oren": ("מפתח ראשי", "Lead Developer"), "raz": ("יועצת משפטית", "Legal Counsel"),
            "raful": ("מנהל פיתוח עסקי", "Head of Business Development")}
_PM_STATUS_LBL = {"todo": ("לביצוע", "To do"), "in_progress": ("בתהליך", "In progress"),
                  "blocked": ("חסום", "Blocked"), "done": ("הושלם", "Done")}


def _report_recipients(scope) -> "list[str]":
    """Resolve a scope → an ORDERED list of partner ids. TEAM/PARTNERS only — never a
    broadcast to all app users."""
    if scope in ("each", "all"):
        return list(db.PM_PARTNERS)
    if isinstance(scope, list):
        return [p for p in scope if p in db.PM_PARTNERS]
    return []


def _partner_message(pid: str, daily: dict) -> dict:
    """A partner's OWN personalized summary (name/role, goal + %, open tasks, blockers)."""
    pdata = next((p for p in daily.get("partners", []) if p["partner"] == pid), {}) or {}
    tasks = db.list_pm_tasks(partner=pid)
    open_tasks = [t for t in tasks if t["status"] != "done"]
    blocked = [t for t in open_tasks if t["status"] == "blocked"]
    top = open_tasks[:5]
    name = _PM_NAME.get(pid, pid)
    role_he, role_en = _PM_ROLE.get(pid, ("", ""))
    avg = pdata.get("avgProgress", 0)

    def _lines(he: bool) -> str:
        out = []
        for t in top:
            s = _PM_STATUS_LBL.get(t["status"], ("", ""))[0 if he else 1]
            out.append(f"• {t['titleHe'] if he else t['titleEn']} — {s} {t['progress']}%")
        return "\n".join(out)

    he = (f"שלום {name} 👋 ({role_he})\n"
          f"היעד שלך: {pdata.get('goalHe') or '—'} · {avg}%\n"
          f"משימות פתוחות: {len(open_tasks)}\n{_lines(True)}")
    if blocked:
        he += f"\n⚠️ {len(blocked)} חסומות דורשות תשומת לב."
    he += "\n— פורטל הבעלים"
    en = (f"Hi {name} 👋 ({role_en})\n"
          f"Your goal: {pdata.get('goalEn') or '—'} · {avg}%\n"
          f"Open tasks: {len(open_tasks)}\n{_lines(False)}")
    if blocked:
        en += f"\n⚠️ {len(blocked)} blocked need attention."
    en += "\n— Owners Portal"
    return {"he": he, "en": en}


def compose_report(scope, daily: Optional[dict] = None) -> "list[dict]":
    """Compose the per-recipient messages + resolve accounts. 'all' sends the COMBINED team
    summary (reuses build_daily's morning paragraph) to everyone; 'each'/specific sends each
    partner THEIR personalized summary. A partner with no account is flagged (will skip)."""
    daily = daily or build_daily()
    team = daily.get("summary", {"he": "", "en": ""})
    email_ready = email_svc.email_configured()
    sms_ready = sms.is_configured()          # Twilio SMS keys present on the server
    wa_ready = sms.whatsapp_configured()     # Twilio WhatsApp keys present on the server
    out = []
    for pid in _report_recipients(scope):
        # Resolve the partner id → a REAL account (e.g. the founder's 'admin' account for
        # 'dan'), so a send actually reaches an inbox instead of skipping everyone.
        acct = db.account_for_partner(pid)
        # Email eligibility from the account's notification prefs: emailTo is the account
        # email; `email` is the per-channel consent toggle (consent is stamped server-side
        # when it flips on). emailOk = deliverable right now (configured + on file + consent).
        prefs = db.get_notif_prefs(acct) if acct else {}
        # Owners-portal STAFF (Dan/Rafi/Yoav/Oren/Raz — product owner / role=='admin' /
        # legal editor) are the internal business team, NOT end-users: on EVERY channel
        # the owners team report treats a contact on file as sufficient and does NOT
        # require the marketing-style per-channel consent opt-in — an email for email, a
        # phone for SMS/WhatsApp. End-users keep the consent gate everywhere (this report
        # only ever targets the PARTNERS set, so no end-user is affected).
        is_staff = _is_staff_recipient(acct)
        # Email
        has_email = bool((prefs.get("emailTo") or "").strip())
        email_consent = bool(prefs.get("email"))
        email_allowed = bool(email_consent or is_staff)
        email_ok = bool(acct and has_email and email_allowed and email_ready)
        # SMS — needs a phone on file; WhatsApp — a whatsappTo override or the phone.
        # (WhatsApp DELIVERY still obeys the existing Twilio window/template rules at send
        # time; eligibility here only stops skipping owners as "no consent".)
        phone = (prefs.get("phone") or "").strip()
        wa_number = (prefs.get("whatsappTo") or "").strip() or phone
        has_phone = bool(phone)
        has_wa = bool(wa_number)
        sms_allowed = bool(prefs.get("sms") or is_staff)
        wa_allowed = bool(prefs.get("whatsapp") or is_staff)
        # Deliverable right now = account + number on file + allowed (consent OR staff) +
        # the channel actually configured on the server. WhatsApp's number is the whatsappTo
        # override or the phone (what delivery uses); its send-time window/template rules are
        # unchanged — this only decides eligibility.
        sms_ok = bool(acct and has_phone and sms_allowed and sms_ready)
        wa_ok = bool(acct and has_wa and wa_allowed and wa_ready)
        msg = team if scope == "all" else _partner_message(pid, daily)
        out.append({"partner": pid, "name": _PM_NAME.get(pid, pid),
                    "account": acct, "hasAccount": acct is not None,
                    "hasEmail": has_email, "emailConsent": email_consent,
                    "hasPhone": has_phone, "hasWhatsappNumber": has_wa,
                    "isStaff": is_staff, "emailAllowed": email_allowed, "emailOk": email_ok,
                    "smsOk": sms_ok, "waOk": wa_ok,
                    "messageHe": msg["he"], "messageEn": msg["en"]})
    return out


class ReportSend(BaseModel):
    scope: Union[str, List[str]] = "each"      # 'each' | 'all' | [partnerIds]
    channel: str = "inapp"                       # 'inapp' (default) | sms | whatsapp | email
    lang: str = "he"
    dryRun: bool = True                          # SAFE default — never sends unless explicitly False


@router.post("/auth/pm/report/send")
def pm_report_send(body: ReportSend, actor: str = Depends(require_owner)):
    """Compose + (dry-run) preview or (live) send the summary report to the TEAM. dryRun=True
    (default) returns the composed messages + resolved recipients WITHOUT sending. dryRun=False
    dispatches — in-app DM only actually delivers; external channels gracefully no-op."""
    scope = body.scope
    if scope not in ("each", "all") and not isinstance(scope, list):
        raise HTTPException(400, "Scope must be 'each', 'all', or a list of partner ids.")
    channel = (body.channel or "inapp").lower()
    lang = "en" if body.lang == "en" else "he"
    reports = compose_report(scope)
    email_ready = email_svc.email_configured()

    # How many will actually go out on THIS channel: in-app needs an account; email needs
    # an account + an email on file + consent + a configured server. (SMS/WhatsApp are
    # best-effort via the shared notify path — counted by account, skipped if unconfigured.)
    def _sendable(r: dict) -> bool:
        if channel == "email":
            return bool(r.get("emailOk"))
        if channel == "sms":
            return bool(r.get("smsOk"))
        if channel == "whatsapp":
            return bool(r.get("waOk"))
        return bool(r["hasAccount"])

    if body.dryRun:
        return {"dryRun": True, "channel": channel,
                "scope": scope if isinstance(scope, str) else "specific",
                "recipients": reports, "count": len(reports),
                "sendable": sum(1 for r in reports if _sendable(r)),
                "emailConfigured": email_ready}

    # ── LIVE send — reached ONLY when the UI passes dryRun=False after an owner confirm. ──
    subj = "פורטל הבעלים — דוח יומי" if lang == "he" else "Owners Portal — daily report"
    results = []
    for r in reports:
        base = {"partner": r["partner"], "name": r["name"]}
        if not r["hasAccount"]:
            results.append({**base, "ok": False, "status": "skipped_no_account"})
            continue
        text = r["messageEn"] if lang == "en" else r["messageHe"]
        if channel == "inapp":
            try:
                db.chat_send(actor, r["account"], text)  # in-app DM — pure DB insert, no external push
                results.append({**base, "ok": True, "status": "sent"})
            except Exception as e:  # noqa: BLE001
                results.append({**base, "ok": False, "status": "error", "error": str(e)})
        elif channel == "email":
            # Real email delivery (respects consent + address on file).
            if not email_ready:
                results.append({**base, "ok": False, "status": "skipped_email_not_configured"})
            elif not r.get("hasEmail"):
                results.append({**base, "ok": False, "status": "skipped_no_email"})
            elif not r.get("emailAllowed"):
                # Consent required for non-staff; owners-portal staff are exempt (see compose_report).
                results.append({**base, "ok": False, "status": "skipped_email_off"})
            else:
                # Resolve the address server-side (kept out of the dry-run API response) and
                # send via the BLOCKING send_email — the SAME reliable path as the working
                # admin test-email. The async notify_user/send_email_async path spawns a
                # daemon thread that returns True immediately (reporting "sent") and swallows
                # any provider error in _send_safe — so a rejected send looked delivered.
                # Blocking makes the per-recipient status reflect the REAL provider result.
                addr = (db.get_notif_prefs(r["account"]).get("emailTo") or "").strip()
                try:
                    res = email_svc.send_email(addr, subj, text)
                    ok = bool(res.get("ok"))
                    logger.info("pm.report.email to=%s ok=%s msg=%s", addr, ok, res.get("message"))
                    if ok:
                        results.append({**base, "ok": True, "status": "sent_email"})
                    else:
                        results.append({**base, "ok": False, "status": "email_failed", "error": res.get("message") or "send failed"})
                except Exception as e:  # noqa: BLE001
                    logger.warning("pm.report.email to=%s raised: %s", addr, e)
                    results.append({**base, "ok": False, "status": "email_failed", "error": str(e)})
        else:
            # SMS / WhatsApp — same shared notify path; delivers only when that channel is
            # configured on the server (and, for WhatsApp, within the 24h-window/template
            # rules), else a graceful skip. Owner/staff bypass the per-channel consent gate
            # (require_consent=False) so a contact on file is enough — matching compose_report
            # eligibility; non-staff still need consent. No number → notify_user skips itself.
            ok = bool(notify.notify_user(r["account"], text, channels={channel}, subject=subj,
                                         require_consent=not r.get("isStaff")))
            results.append({**base, "ok": ok, "status": ("sent_" + channel) if ok else "skipped_channel_unavailable"})
    sent = sum(1 for x in results if x["ok"])
    logger.info("pm.report.send scope=%s channel=%s by=%s sent=%s/%s", scope, channel, actor, sent, len(results))
    return {"dryRun": False, "channel": channel, "results": results, "sent": sent, "total": len(results)}


# Local import guard: `is_owner` lives in security; import lazily to avoid a cycle at
# module import (security imports db, db doesn't import security).
def _is_owner(username: str) -> bool:
    from app.core.security import is_owner
    return is_owner(username)


def _is_staff_recipient(acct: Optional[str]) -> bool:
    """The owners-portal team — a product OWNER (owner_flag / OWNER_USERNAMES allowlist /
    main admin / owner email), a role=='admin' user (Oren), or a legal editor (Raz). These
    are the internal business team, so the owners team report treats them as email-eligible
    on a saved address WITHOUT the consent opt-in that end-users still require."""
    if not acct:
        return False
    if _is_owner(acct) or db.is_legal_editor(acct):
        return True
    return (db.get_user(acct) or {}).get("role") == "admin"


# ══ Owners DAILY REPORT — branded PDF + HTML web view + manual test trigger ═════
# The approved report (masthead + launch-% hero + owners overview + per-owner detail).
# Rendered server-side from the LIVE PM data. Emailed daily 09:00 IL by
# owners_report.owners_report_email_loop (registered in main.py); these routes power
# the web view (email link) + Dan's manual "send now" / preview.

def _report_view_authorized(authorization: Optional[str], t: Optional[str]) -> bool:
    """Allow if a valid signed report-view token (the device-independent email link) OR the
    caller is a logged-in owner/staff (the in-app preview). Internal data — nothing public."""
    from app.services import owners_report as orr
    if orr.check_report_token(t):
        return True
    try:
        u = current_user(authorization)
    except Exception:  # noqa: BLE001 — no/invalid bearer → fall through to deny
        return False
    return _is_staff_recipient(u)


@router.get("/auth/pm/report.html")
def report_html(t: Optional[str] = Query(default=None),
                authorization: Optional[str] = Header(default=None)):
    """Owner/staff (or a valid view token) → the report as responsive branded HTML."""
    if not _report_view_authorized(authorization, t):
        raise HTTPException(status_code=403, detail="Owners only")
    from app.services import owners_report as orr
    # never cache — rendered LIVE from current PM data; a cached copy is the "stale report" bug.
    return HTMLResponse(orr.render_html(orr.build_report_data()), headers=_NO_STORE)


@router.get("/auth/pm/report.pdf")
def report_pdf(t: Optional[str] = Query(default=None),
               authorization: Optional[str] = Header(default=None)):
    """Owner/staff (or a valid view token) → the report as a downloadable PDF."""
    if not _report_view_authorized(authorization, t):
        raise HTTPException(status_code=403, detail="Owners only")
    from app.services import owners_report as orr
    try:
        pdf = orr.render_pdf(orr.build_report_data())
    except Exception as exc:  # noqa: BLE001
        logger.warning("report.pdf render failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"PDF render failed: {exc}")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="owners-report.pdf"', **_NO_STORE})


@router.get("/auth/pm/report/link")
def report_link(request: Request, _: str = Depends(require_owner)):
    """Owner-only: mint a fresh view token + return the device-independent report URLs
    (used by the in-app 'open web report' / 'download PDF' buttons — no auth header needed
    when opened in a new tab). Same link shape the daily email embeds."""
    from app.services import owners_report as orr
    tok = orr.mint_report_token()
    base = (os.environ.get("PUBLIC_BASE_URL") or str(request.base_url)).rstrip("/")
    return {"token": tok, "html": f"{base}/auth/pm/report.html?t={tok}",
            "pdf": f"{base}/auth/pm/report.pdf?t={tok}"}


@router.post("/auth/pm/report/daily-send")
def report_daily_send(actor: str = Depends(require_owner)):
    """Owner-only MANUAL TEST TRIGGER: render + email the daily owners report to the owners
    RIGHT NOW (force=True bypasses the once-per-day guard). Verifies the whole pipeline."""
    from app.services import owners_report as orr
    out = orr.send_daily_report(force=True, actor=actor)
    logger.info("owners report manual send by=%s -> sent=%s/%s", actor, out.get("sent"), out.get("total"))
    return out


@router.get("/auth/pm/report/status")
def report_status(_: str = Depends(require_owner)):
    """Owner-only: whether the DAILY 09:00 auto-send is currently enabled (default OFF)."""
    from app.services import owners_report as orr
    return {"autoEnabled": orr.autosend_enabled()}


class AutoSendToggle(BaseModel):
    enabled: bool


@router.post("/auth/pm/report/autosend")
def report_autosend(body: AutoSendToggle, actor: str = Depends(require_owner)):
    """Owner-only: flip the daily 09:00 auto-send ON/OFF (persisted, live — no redeploy).
    Dan turns this ON once he approves the design; OFF keeps the scheduler dormant."""
    from app.services import owners_report as orr
    orr.set_autosend(body.enabled)
    logger.info("owners report auto-send set to %s by %s", body.enabled, actor)
    return {"autoEnabled": orr.autosend_enabled()}
