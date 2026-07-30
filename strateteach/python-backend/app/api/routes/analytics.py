"""Privacy-safe product analytics / audit events (Part F + Item 2).

- POST /analytics/collect  (auth'd) — the STRICT, spec-compliant ingest for the 12
  canonical product events. Consent-gated; keyed by a pseudonymous id + client
  session id; a forbidden-key denylist + per-event allowlist runs server-side.
- POST /analytics/event    (auth'd) — the pre-existing generic beacon path. Same
  sanitizer + consent gate; kept so already-wired beacons keep working.
- GET  /analytics/consent  (auth'd) — the caller's own consent state.
- POST /analytics/consent  (auth'd) — set the caller's consent (Accept / Decline).
- GET  /analytics/summary  (admin)  — aggregate KPI rollups (counts only, NO identities).

The internal user id is NEVER placed in an event payload NOR stored on the new rows
(see database.record_analytics_event → auid pseudonym). Recording is fire-and-forget:
it never raises, so a tracking hiccup can't break a user flow.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app import database as db
from app.core.security import current_user, require_admin

logger = logging.getLogger("algo770")

router = APIRouter(tags=["analytics"])


@router.post("/analytics/collect")
def collect_event(body: dict, username: str = Depends(current_user)):
    """STRICT ingest for a canonical product event { event, props, session_id }.
    Consent-gated + sanitized server-side. Always returns ok (best-effort) with a
    `stored` flag so the client can tell whether consent was the blocker."""
    event = ((body or {}).get("event") or "").strip()
    props = (body or {}).get("props")
    if not isinstance(props, dict):
        props = {}
    session_id = (body or {}).get("session_id")
    stored = db.record_analytics_event(username, event, props, session_id)
    return {"ok": True, "stored": bool(stored)}


@router.post("/analytics/event")
def record_event(body: dict, username: str = Depends(current_user)):
    """Generic beacon path (pre-existing call-sites). Props are sanitized + the event
    is consent-gated exactly like /collect. Always returns ok (best-effort)."""
    event = ((body or {}).get("event") or "").strip()
    props = (body or {}).get("props")
    if not isinstance(props, dict):
        props = {}
    session_id = (body or {}).get("session_id")
    stored = db.record_analytics_event(username, event, props, session_id)
    return {"ok": True, "stored": bool(stored)}


@router.get("/analytics/consent")
def get_consent(username: str = Depends(current_user)):
    """The caller's own analytics-consent state: { consent, decided }. `decided`=false
    means the one-time consent screen has not been answered yet."""
    return db.get_analytics_consent_state(username)


@router.post("/analytics/consent")
def set_consent(body: dict, username: str = Depends(current_user)):
    """Accept (true) or Decline (false) analytics collection. Decline leaves the app
    fully usable — it only stops event ingest for this user."""
    consent = bool((body or {}).get("consent"))
    db.set_analytics_consent(username, consent)
    logger.info("analytics.consent user=%s consent=%s", username, consent)
    return {"ok": True, "consent": consent}


@router.get("/analytics/summary")
def analytics_summary(days: int = 14, _admin: str = Depends(require_admin)):
    """Admin-only KPI rollup: per-event counts (+ distinct pseudonymous users) and a
    daily total trend over the window. Aggregate only — no identities, no balances."""
    return db.analytics_summary(days)


@router.get("/analytics/safety")
def analytics_safety(days: int = 14, _admin: str = Depends(require_admin)):
    """Admin-only SAFETY rollup (Item 6): blocked actions by reason/kind, validation
    errors by screen, the go-live funnel + kill-switch count, and scanner/backtest
    volumes. Aggregate only — every value is a count, no identities, no balances."""
    return db.analytics_safety_summary(days)
