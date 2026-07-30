"""Layout / location editor — per-screen arrangement (which buttons/tiles show +
their order) persisted server-side so a user's customisation follows them across
devices, and owners can set the DEFAULT (or a per-role) layout for everyone.

Paths live under /auth/* so the existing Caddy reverse-proxy rule already routes
them to the backend (no proxy change needed) — same as social.py.

Scopes (see the layout_prefs migration):
  • user:<username>  — a personal override (any user may write their OWN).
  • role:<role>      — a role's default (OWNER-only).
  • default          — the global default for everyone (OWNER-only).

Resolution at render is user → role → default → the code's built-in order.

MONEY-SAFETY: this table only reorders / hides NON-safety navigation tiles. The
safety-critical controls (GO-LIVE confirm, LIVE/DEMO toggle, risk/fee disclosures,
the ConfirmModal path) render OUTSIDE these editable grids, and any tile a screen
marks `locked` is force-shown client-side regardless of a stored hidden[]. So a
stored arrangement can never suppress a money action or a required disclosure.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app import database as db
from app.core.security import current_user, is_owner

logger = logging.getLogger("algo770")

router = APIRouter(tags=["layout"])

_MAX_IDS = 200          # generous cap; a screen has ~10 tiles, this just bounds abuse
_MAX_ID_LEN = 80


def _clean_ids(value) -> list[str]:
    """Coerce an incoming list into a de-duplicated list of short id strings."""
    out: list[str] = []
    seen: set[str] = set()
    if isinstance(value, list):
        for x in value:
            if not isinstance(x, str):
                continue
            s = x.strip()
            if not s or len(s) > _MAX_ID_LEN or s in seen:
                continue
            seen.add(s)
            out.append(s)
            if len(out) >= _MAX_IDS:
                break
    return out


def _clean_arrangement(body) -> dict:
    """Whitelist the arrangement shape: {order:[ids], hidden:[ids]} — nothing else."""
    body = body or {}
    return {
        "order": _clean_ids(body.get("order")),
        "hidden": _clean_ids(body.get("hidden")),
    }


def _user_role(username: str) -> str | None:
    u = db.get_user(username) or {}
    return u.get("role")


@router.get("/auth/layout/{screen_key}")
def get_layout(screen_key: str, username: str = Depends(current_user)):
    """Resolved arrangement for the CURRENT user + screen (user → role → default →
    code). Also returns the per-scope stored rows so an owner's editor can show /
    reset a specific scope, plus whether this caller may edit the shared scopes."""
    role = _user_role(username)
    arrangement, source = db.resolve_layout(username, role, screen_key)
    owner = is_owner(username)

    def _arr(scope: str):
        row = db.get_layout_pref(scope, screen_key)
        return row["arrangement"] if row and isinstance(row.get("arrangement"), dict) else None

    return {
        "screen": screen_key,
        "arrangement": arrangement,          # None → the frontend falls back to code order
        "source": source,                    # 'user' | 'role' | 'default' | 'code'
        "canEditShared": owner,              # owners may write default / role: scopes
        "role": role,
        "scopes": {
            "user": _arr(f"user:{username}"),
            "role": _arr(f"role:{role}") if role else None,
            "default": _arr("default"),
        },
    }


@router.put("/auth/layout/{screen_key}")
def put_layout(screen_key: str, body: dict, username: str = Depends(current_user)):
    """Save an arrangement. `scope` is 'user' (personal, any user), 'role' (this
    user's role default, OWNER-only) or 'default' (global, OWNER-only). Returns the
    freshly resolved layout so the client re-renders from the source of truth."""
    scope_in = ((body or {}).get("scope") or "user").strip().lower()
    arrangement = _clean_arrangement((body or {}).get("arrangement"))
    role = _user_role(username)
    owner = is_owner(username)

    if scope_in == "user":
        scope = f"user:{username}"
    elif scope_in == "default":
        if not owner:
            raise HTTPException(status_code=403, detail="Only an owner can set the shared default layout.")
        scope = "default"
    elif scope_in == "role":
        if not owner:
            raise HTTPException(status_code=403, detail="Only an owner can set a role's default layout.")
        if not role:
            raise HTTPException(status_code=400, detail="No role to scope this layout to.")
        scope = f"role:{role}"
    else:
        raise HTTPException(status_code=400, detail="scope must be one of: user, role, default.")

    db.upsert_layout_pref(scope, screen_key, arrangement, username)
    resolved, source = db.resolve_layout(username, role, screen_key)
    return {"ok": True, "screen": screen_key, "scope": scope, "arrangement": resolved, "source": source}


@router.delete("/auth/layout/{screen_key}")
def reset_layout(screen_key: str, scope: str = "user", username: str = Depends(current_user)):
    """Reset (delete) a stored arrangement so rendering falls through to the next
    scope. A user may reset their OWN override; owners may also reset default/role."""
    scope_in = (scope or "user").strip().lower()
    role = _user_role(username)
    if scope_in == "user":
        target = f"user:{username}"
    elif scope_in == "default":
        if not is_owner(username):
            raise HTTPException(status_code=403, detail="Owners only")
        target = "default"
    elif scope_in == "role":
        if not is_owner(username):
            raise HTTPException(status_code=403, detail="Owners only")
        if not role:
            raise HTTPException(status_code=400, detail="No role to scope this layout to.")
        target = f"role:{role}"
    else:
        raise HTTPException(status_code=400, detail="scope must be one of: user, role, default.")
    db.delete_layout_pref(target, screen_key)
    resolved, source = db.resolve_layout(username, role, screen_key)
    return {"ok": True, "screen": screen_key, "arrangement": resolved, "source": source}
