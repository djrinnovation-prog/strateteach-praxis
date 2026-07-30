"""Anonymous poll for the hosted design-options presentation.

Serves the two PUBLIC endpoints used by the static presentation at /design/
(index.html = Hebrew, en.html = English) so a panel of evaluators can pick the
winning Home-screen design. Both routes are anonymous — no login, no name. One
device = one vote, keyed by a random uuid the browser keeps in localStorage
(`algo770_design_voter`); re-voting overwrites the prior choice.

Public/allowlisted (see core.security.PUBLIC_PATHS) and reached same-origin —
the Caddy reverse proxy routes ONLY the exact paths /design/vote and
/design/results to the backend, while the static /design/*.html pages keep
being served by the frontend. Nothing identifying is stored or returned; reads
are aggregate-only.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import database as db

logger = logging.getLogger("algo770")

router = APIRouter(tags=["design"])

# Anonymous vote payload. Kept tiny on purpose (basic anti-abuse): the voter id is
# a client uuid, choice is the favored option 1–6, and path is the short bracket
# trail they clicked (record-only). max_length caps the raw body so a public,
# unauthenticated endpoint can't be used to shovel large blobs into the DB.
_MAX_PATH_ITEMS = 32


class DesignVoteIn(BaseModel):
    voter_id: str = Field(min_length=1, max_length=100)
    choice: int = Field(ge=1, le=6)
    path: list | None = Field(default=None, max_length=_MAX_PATH_ITEMS)


@router.post("/design/vote")
def design_vote(body: DesignVoteIn):
    """PUBLIC (anonymous): record/replace one device's vote. Upserts by voter_id
    so re-voting replaces the prior choice. Returns {ok, total}."""
    voter_id = body.voter_id.strip()
    if not voter_id:
        raise HTTPException(status_code=422, detail="voter_id required")
    # Keep the stored path small + JSON-serialisable (strings/numbers only).
    path = None
    if body.path is not None:
        path = [str(p)[:40] for p in body.path][:_MAX_PATH_ITEMS]
    try:
        total = db.upsert_design_vote(voter_id, body.choice, path)
    except Exception as exc:  # noqa: BLE001 — never leak internals on a public route
        logger.warning("design vote failed: %s", exc)
        raise HTTPException(status_code=500, detail="vote_failed")
    # Optional best-effort owner ping (non-blocking daemon thread; no-op if the
    # admin's Telegram isn't configured). Anonymous — only the aggregate is sent.
    try:
        from app.services import telegram as tg
        tg.notify_admin(f"🗳️ Design poll: a panelist voted for Option {body.choice}. Total votes: {total}.")
    except Exception:  # noqa: BLE001 — telemetry only, must not affect the vote
        pass
    return {"ok": True, "total": total}


@router.get("/design/results")
def design_results():
    """PUBLIC (anonymous): AGGREGATE results only — {total, counts{1..6}, winner}.
    No per-voter identities are ever exposed. winner = max count; tie → lowest #."""
    return db.design_vote_results()
