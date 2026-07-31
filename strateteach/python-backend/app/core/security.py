"""Authentication: the global bearer gate (middleware) and the per-route
`current_user` dependency. Both resolve a bearer token to a username via the
sessions table.
"""
from __future__ import annotations

import os

from fastapi import Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app import database as db
from app.services.auth import bearer_from_header

# ── Product OWNERS (Dan, Rafi, Yoav) ─────────────────────────────────────────
# The FULL Requests portal — see ALL users' requests, the owner-notes tab, reply,
# change status, create owner notes — is reserved for the product OWNERS, NOT every
# admin account. A secondary admin (role=admin, is_main=FALSE) gets ONLY their own
# support correspondence, exactly like a regular user. An owner is the main/super-
# admin (is_main — the seeded "admin", i.e. Dan) OR a username/email in the
# allowlist below. The allowlist is overridable per deployment via the env vars
# OWNER_USERNAMES / OWNER_EMAILS (comma-separated) WITHOUT a code change, so the
# three owners can be pinned to their real accounts in production.
_OWNER_USERNAMES = {u.strip().lower() for u in
                    (os.environ.get("OWNER_USERNAMES") or "admin,dan,rafi,yoav").split(",") if u.strip()}
_OWNER_EMAILS = {e.strip().lower() for e in
                 (os.environ.get("OWNER_EMAILS") or "").split(",") if e.strip()}

# ── Maintenance-gate per-account bypass allowlist ────────────────────────────
# A comma-separated list of usernames that are let THROUGH the maintenance wall
# WITHOUT being granted any admin/owner power. Defaults to EMPTY, so with the
# env var unset this is a pure no-op and the gate behaves exactly as before.
# Its only purpose is to let a specific NON-admin account (e.g. a labelled demo
# END-USER) preview the real user experience while global maintenance stays ON
# for everyone else — instead of lifting the gate. Membership grants ZERO extra
# capabilities: it does not touch roles, RBAC, or any /require_* dependency; it
# only exempts the listed account from the 503 + session-invalidation below.
_MAINTENANCE_BYPASS_USERNAMES = {u.strip().lower() for u in
                                 (os.environ.get("MAINTENANCE_BYPASS_USERNAMES") or "").split(",") if u.strip()}


def maintenance_bypass(username: str | None) -> bool:
    """True if this account is on the maintenance-gate bypass allowlist (see
    ``MAINTENANCE_BYPASS_USERNAMES``). Real admins/owners bypass via the role
    checks; this is the extra, capability-free exemption for a previewer."""
    if not username:
        return False
    return username.strip().lower() in _MAINTENANCE_BYPASS_USERNAMES

# Paths reachable without a bearer token.
PUBLIC_PATHS = {"/healthz", "/auth/login", "/auth/login/verify", "/auth/reset", "/docs",
                "/openapi.json", "/redoc", "/auth/billing/webhook", "/auth/demo-login",
                "/auth/signup-request", "/auth/self-signup", "/auth/welcome-login", "/telegram/webhook",
                # New-hire onboarding welcome payload — opened from a login-free onboarding link
                # (token-gated inside the route), same pattern as the report views below.
                "/auth/onboard",
                "/auth/whatsapp/inbound",
                # Anonymous design-options poll (hosted presentation at /design/). No bearer.
                "/design/vote", "/design/results",
                # The 4 legal-copy blocks are read WITHOUT a bearer (the app renders them in
                # the footer / before money actions). Edits + approvals under /legal/copy/* are
                # gated by require_legal_copy_writer. (Also reachable via the /legal/ prefix pass.)
                "/legal/copy",
                # Owners Daily Report web view + PDF. These open from an EMAIL LINK / a new
                # browser tab (no bearer), so they must pass the bearer gate — but they are
                # NOT public: the route itself requires a valid signed ?t= view token OR a
                # logged-in owner session (see pm._report_view_authorized), same token-gated
                # pattern as the Signal-Bot webhook. Only these two are token-capable; the
                # report ACTION routes (/report/link|status|autosend|daily-send|send) stay
                # session-gated and are intentionally NOT listed here.
                "/auth/pm/report.html", "/auth/pm/report.pdf",
                # IT Summary Report web view + PDF — opened from an EMAIL LINK / new tab (no
                # bearer). Token-gated INSIDE the route (portal._report_view_ok), same pattern as
                # the owners report above. The legal report's equivalent rides the /legal/* pass.
                "/it/portal/report.html", "/it/portal/report.pdf",
                # Business-Development Summary Report web view + PDF — same login-free, token-gated
                # pattern as the IT/owners reports above.
                "/biz/portal/report.html", "/biz/portal/report.pdf"}

# Authenticated paths that stay reachable for a NON-admin even while maintenance is
# ON, so a trapped user can still (a) learn the app is in maintenance and (b) sign
# out. Everything else is 503'd for non-admins by the maintenance gate below.
MAINTENANCE_ALLOWLIST = {"/system/maintenance", "/auth/logout"}


async def auth_gate(request: Request, call_next):
    """Global bearer gate. Allowlist: /healthz + /auth/login (+ docs).

    Versioned paths (/v1/...) are normalised before the allowlist check so the
    same public routes are reachable with or without the /v1 prefix.
    """
    path = request.url.path
    public = path
    if public.startswith("/v1/"):
        public = public[3:]
    elif public == "/v1":
        public = "/"
    # The Signal-Bot inbound webhook is public but token-gated INSIDE the route
    # (/signals/webhook/{botToken}); it carries no bearer and must reach the handler.
    # Public legal texts (GET /legal, GET /legal/{key}) must be readable WITHOUT a bearer —
    # they render the app's legal copy and serve the no-login public URL the app stores need.
    # The editing routes under /legal/* carry their own require_legal_editor/require_main_admin
    # dependency, so letting the whole /legal prefix past the bearer gate stays safe (same
    # pattern as the token-gated Signal-Bot webhook).
    # Home-guide binary assets (uploaded voice/pose overrides) are served to plain <img>/
    # <audio> tags, which never send a bearer — so the SERVE route must pass the gate like a
    # static file. Only GET reaches data; the upload/delete routes under the same prefix carry
    # their own require_admin dependency, so opening the prefix stays safe (same pattern as the
    # public legal texts / token-gated Signal-Bot webhook above).
    if (request.method == "OPTIONS" or public in PUBLIC_PATHS
            or public == "/legal" or public.startswith("/legal/")
            or public.startswith("/auth/guide/asset/")
            or public.startswith("/auth/review/file/")
            or public.startswith("/signals/webhook/")):
        return await call_next(request)

    token = bearer_from_header(request.headers.get("authorization"))
    sess = db.get_session(token) if token else None
    username = sess["username"] if sess else None
    if not username:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    request.state.username = username

    # Resolve the authoritative DB role ONCE — both gates below need it. "Admin" is
    # always read from the DB role (the same source require_admin trusts), never from
    # a client-supplied flag. Skipped entirely on the allowlist / when neither gate is
    # armed, so the fast path stays a single session lookup.
    gated = public not in MAINTENANCE_ALLOWLIST
    maint_on = db.get_maintenance_cached()
    cutoff = db.get_nonadmin_session_cutoff_cached()
    user = db.get_user(username) if (gated and (maint_on or cutoff is not None)) else None
    # "Privileged" for the maintenance gate = a role==admin user (Oren) OR a product OWNER
    # (Dan/Rafi/Yoav — who may not be role==admin but must NEVER be locked out, since they
    # are the ones who lift maintenance). Both bypass the 503 + session-invalidation below.
    # A bypass-allowlisted account (e.g. a labelled demo user) is ALSO let through here —
    # WITHOUT any admin power — so it can preview the app while maintenance stays ON.
    is_admin = bool(user and (user.get("role") == "admin" or is_owner(username))) \
        or maintenance_bypass(username)

    # The Review board (/auth/review/*) is the TEAM'S TOOL for fixing the app, so its gated
    # reviewers — the owners PLUS Oren (it_editor) — must reach it even while maintenance is ON.
    # Without this a NON-OWNER reviewer (Oren, or an owner-by-grant not on the fast owner path)
    # was 503'd by the maintenance gate BEFORE the route's own require_it_editor ran, so their
    # "Send to Dan" never stored → empty inbox. Each /auth/review/* route still enforces
    # require_it_editor itself, so this only lets the RIGHT people through.
    review_ok = public.startswith("/auth/review/") and not is_admin \
        and (is_owner(username) or db.is_it_editor(username)
             or db.is_legal_editor(username) or db.is_biz_editor(username))

    # Backend-enforced maintenance gate. When ON, NON-admins are cut off from every
    # protected route except the maintenance-status probe and logout — regardless of
    # what their (possibly stale / cached) frontend believes. This is the real gate:
    # the frontend splash is only cosmetic and can be bypassed by an old PWA build or
    # any direct API client. Admins always pass.
    if gated and maint_on and not is_admin and not review_ok:
        return JSONResponse(
            status_code=503,
            content={"maintenance": True, "detail": "The app is in maintenance. Please try again soon."},
        )

    # Active session invalidation ("disconnect all non-admins now"). Once the main
    # admin has stamped a cutoff (done automatically when maintenance is turned on),
    # any NON-admin session ISSUED BEFORE it is force-logged-out with a 401, so the
    # user is bounced back to the login screen on their next call / reload — not just
    # blocked on a deliberate action. Admins (incl. the main admin) are NEVER
    # invalidated — they keep working and the main admin can lift maintenance. Same
    # allowlist as the maintenance gate so a trapped user can still read the status
    # and log out. (During maintenance the 503 above fires first for non-admins; this
    # keeps their tokens dead once maintenance is lifted.)
    if gated and cutoff and not is_admin and not review_ok and str(sess.get("created_at") or "") < cutoff:
        return JSONResponse(status_code=401, content={"detail": "session_invalidated"})

    try:
        db.touch_session(token)  # for the admin "connected users" view
    except Exception:
        pass
    return await call_next(request)


def block_nonadmin_during_maintenance(user: "dict | None") -> None:
    """Login-endpoint guard: refuse to issue a token to a non-admin while
    maintenance is ON, so a non-admin can't authenticate at all (the middleware
    only covers ALREADY-authenticated requests; this closes the login door too).

    `user` is the resolved DB row (or None for flows that only ever create a
    non-admin account, e.g. self-signup). Admin role is read from that row — the
    same authoritative source require_admin uses. Raises 503 for everyone else.
    """
    try:
        on = db.get_maintenance_cached()
    except Exception:  # noqa: BLE001 — never block login on a cache/DB error
        on = False
    uname = (user or {}).get("username")
    if on and not (user and (user.get("role") == "admin" or is_owner(uname))) \
            and not maintenance_bypass(uname):
        raise HTTPException(
            status_code=503,
            detail="The app is in maintenance. Only administrators can sign in right now.",
        )


def current_user(authorization: str | None = Header(default=None)) -> str:
    """Route dependency: resolve the bearer token to a username or 401.
    Demo testers are additionally cut off once their 30-minute window elapses."""
    token = bearer_from_header(authorization)
    username = db.get_session_user(token) if token else None
    if not username:
        raise HTTPException(status_code=401, detail="Unauthorized")
    user = db.get_user(username)
    if user and user.get("is_demo"):
        from datetime import datetime, timezone
        exp = user.get("demo_expires")
        expired = True
        if exp:
            try:
                expired = datetime.fromisoformat(exp) <= datetime.now(timezone.utc)
            except Exception:
                expired = True
        if expired:
            raise HTTPException(status_code=401, detail="demo_expired")
    return username


# ── M7: legacy StrateTeach trading-engine retirement ─────────────────────────
# Under the Option A model, StrateTeach is the BRAIN/UI only and must NEVER hold an
# exchange key, place an order, or withdraw funds — execution lives entirely in Praxis
# (browser → Praxis Edge/Vault → worker). This gate RETIRES the legacy engine's
# key-ingest / order / withdrawal / creds-backup routes: with the flag OFF (the default,
# = retired) they return 410 Gone pointing to the secure Praxis flow. The flag exists
# only as a transitional escape hatch; production leaves it unset. It is NOT a substitute
# for the Phase 3 wipe (deleting stored ciphertext + dropping the key tables), which
# removes the data at rest — this only closes the live routes.
def legacy_engine_enabled() -> bool:
    """True only if an operator has explicitly re-enabled the legacy engine (default: retired).
    Read at CALL time (not import) so it is consistent with the data-layer guard in database.py
    and directly testable. The same flag also hard-OFFs the background autopilot LIVE gate."""
    return os.getenv("STRATETEACH_LEGACY_ENGINE_ENABLED", "false").strip().lower() == "true"


def assert_legacy_engine_enabled() -> None:
    """Route dependency: 410 Gone unless the legacy StrateTeach trading engine is explicitly
    re-enabled. Applied to every route that ingests an exchange key, places an order, or
    withdraws — so StrateTeach can no longer hold keys or move money (M7 full retirement)."""
    if not legacy_engine_enabled():
        raise HTTPException(
            status_code=410,
            detail=(
                "This flow has been retired. Connect your exchange through the secure Praxis "
                "flow — your key goes straight to the isolated execution vault and never touches "
                "this service."
            ),
        )


def require_admin(authorization: str | None = Header(default=None)) -> str:
    """Route dependency: resolve the bearer token AND require ADMIN-tier access —
    i.e. a product OWNER (Dan/Rafi/Yoav) OR a role=='admin' user (Oren). This is the
    RBAC gate for the operational admin surfaces (user management, system, bots, comms,
    monitoring). Owners ALWAYS pass here even if their account isn't role=='admin', so the
    three owners have every admin function; a non-owner admin (Oren) keeps them too.
    """
    username = current_user(authorization)
    if is_owner(username):
        return username
    user = db.get_user(username)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return username


def require_main_admin(authorization: str | None = Header(default=None)) -> str:
    """DEPRECATED tier. The single "main admin" no longer exists — the three OWNERS
    (Dan/Rafi/Yoav) are equal and hold every former main-admin power. This alias now
    requires OWNER, so any call site not yet repointed stays safely owner-only. Prefer
    require_owner (owner-only powers) or require_admin (owner||admin surfaces) directly."""
    username = current_user(authorization)
    if not is_owner(username):
        raise HTTPException(status_code=403, detail="Owners only")
    return username


def require_legal_editor(authorization: str | None = Header(default=None)) -> str:
    """RBAC gate for the in-app Legal Console. Passes for the main admin (always) OR any
    user the main admin granted the ``legal_editor`` flag — so the legal counsel can edit
    legal copy WITHOUT being a full admin."""
    username = current_user(authorization)
    if is_owner(username) or db.is_legal_editor(username):
        return username
    raise HTTPException(status_code=403, detail="Legal editor only")


def require_legal_copy_writer(authorization: str | None = Header(default=None)) -> str:
    """Stricter gate for EDITING the 4 legal-copy blocks: the legal counsel (Raz, via the
    ``legal_editor`` grant) or the main admin — NOT every product owner. Other owners can
    READ the copy (public GET) but not change/approve it, per the copy-approval workflow."""
    username = current_user(authorization)
    if db.is_legal_editor(username):   # is_main OR legal_editor flag (Raz) — excludes plain owners
        return username
    raise HTTPException(status_code=403, detail="Legal copy is editable by the legal editor only")


def require_it_editor(authorization: str | None = Header(default=None)) -> str:
    """RBAC gate for the in-app IT portal (mirrors require_legal_editor). Passes for a product
    OWNER (always) OR any user granted the ``it_editor`` flag (e.g. Oren) — so the IT
    collaborator can use their portal WITHOUT being a full admin."""
    username = current_user(authorization)
    if is_owner(username) or db.is_it_editor(username):
        return username
    raise HTTPException(status_code=403, detail="IT editor only")


def require_biz_editor(authorization: str | None = Header(default=None)) -> str:
    """RBAC gate for the in-app Business-Development portal (mirrors require_it_editor). Passes
    for a product OWNER (always) OR any user granted the ``biz_editor`` flag (e.g. Raful)."""
    username = current_user(authorization)
    if is_owner(username) or db.is_biz_editor(username):
        return username
    raise HTTPException(status_code=403, detail="Biz-dev editor only")


def require_content_editor(authorization: str | None = Header(default=None)) -> str:
    """RBAC gate for the content editors (Reels; Courses next). Passes for ANY full admin
    (role == admin, incl. the main admin) OR a user granted the ``content_editor`` flag — so
    a creative partner can manage content WITHOUT being a full admin."""
    username = current_user(authorization)
    if is_owner(username):
        return username
    user = db.get_user(username)
    if user and user.get("role") == "admin":
        return username
    if db.is_content_editor(username):
        return username
    raise HTTPException(status_code=403, detail="Content editor only")


def is_owner(username: str | None) -> bool:
    """True only for a product OWNER (Dan / Rafi / Yoav). An owner is the main/
    super-admin (is_main), a username/email in the OWNER allowlist, OR a user the main
    admin granted the per-user ``owner_flag`` from the Team-roles panel. A non-owner
    admin is NOT an owner — they only get their own support correspondence."""
    if not username:
        return False
    try:
        if db.is_main_admin(username):
            return True
    except Exception:  # noqa: BLE001 — never let a DB hiccup grant/deny by surprise
        pass
    if username.strip().lower() in _OWNER_USERNAMES:
        return True
    u = db.get_user(username) or {}
    if bool(u.get("owner_flag")):
        return True
    if _OWNER_EMAILS:
        em = (u.get("email") or "").strip().lower()
        if em and em in _OWNER_EMAILS:
            return True
    return False


def require_owner(authorization: str | None = Header(default=None)) -> str:
    """Route dependency: resolve the bearer token AND require product-OWNER status
    (Dan / Rafi / Yoav). Gates the FULL Requests portal (see-all + manage) away
    from non-owner admins and regular users."""
    username = current_user(authorization)
    if not is_owner(username):
        raise HTTPException(status_code=403, detail="Owners only")
    return username


def require_financial_structure(authorization: str | None = Header(default=None)) -> str:
    """Route dependency for the company's FINANCIAL STRUCTURE views (P2.3, the approved
    Oren boundary): a product OWNER (Dan/Rafi/Yoav) OR the EXECUTION OPERATOR (it_editor,
    Oren). Per the owner-approved policy (mgmt mapping page §5): the operator sees the
    financial STRUCTURE — budget, expenses, wallets, revenue, cashflow — but NEVER the
    owners' fund, the owners' investments or their movements, and never per-person
    payroll detail. That filtering happens INSIDE the endpoint (see finance_overview);
    this dependency only decides who may read the structural view at all. Legal/biz/
    content editors are deliberately NOT admitted — this is exactly owner ∪ operator."""
    username = current_user(authorization)
    if is_owner(username) or db.is_it_editor(username):
        return username
    raise HTTPException(status_code=403, detail="Owners or execution operator only")


def require_owner_or_admin(authorization: str | None = Header(default=None)) -> str:
    """Route dependency for the shared PM surfaces reused across the portals: a product OWNER
    (Dan/Rafi/Yoav) OR a COLLABORATOR with a portal grant — a legal editor (Raz) or an IT
    editor (Oren). This is the SAME set that reaches the shared portal tabs (daily / board /
    votes) in the UI, so collaborators can CAST votes and manage their own tasks. Gates the PM
    board's manage surfaces (create/reassign/edit tasks, votes, daily). NOTE: a plain role=='
    admin' account is NOT enough here anymore — the Owners interface is owners-only and Oren
    (formerly admin) now reaches the PM surfaces via his it_editor grant. FINANCE is NOT here —
    it stays require_owner (owners only)."""
    username = current_user(authorization)
    if is_owner(username):
        return username
    if db.is_legal_editor(username):
        return username
    if db.is_it_editor(username):
        return username
    if db.is_biz_editor(username):
        return username
    raise HTTPException(status_code=403, detail="Owners portal access only")


def require_reviewer(authorization: str | None = Header(default=None)) -> str:
    """Gate for the QA / Review-Mode tool (submit notes / inbox / report / snapshots). The
    audience is a product OWNER (Dan/Rafi/Yoav), ANY role=='admin' user (e.g. Oren once
    promoted), OR a portal collaborator with a legal / IT / biz editor grant. Mirrors the
    frontend isReviewer() exactly, so the QA button's visibility matches what these endpoints
    authorize. Review tool ONLY — this is not finance / PM (those stay owner-scoped)."""
    username = current_user(authorization)
    if is_owner(username):
        return username
    u = db.get_user(username) or {}
    if u.get("role") == "admin":
        return username
    if db.is_legal_editor(username) or db.is_it_editor(username) or db.is_biz_editor(username):
        return username
    raise HTTPException(status_code=403, detail="Review tool access only")


def assert_can_manage_user(caller: str, target: str | None = None, *, new_role: str | None = None) -> None:
    """Per-target admin-management guard for endpoints reachable by `require_admin`.

    Owner-tier model: a product OWNER (Dan/Rafi/Yoav) manages everyone, including other
    admins and owners. A non-owner admin (Oren, role=admin) may act on regular / demo
    users but must NEVER:
      • create or promote an ADMIN account  (new_role == "admin"), or
      • modify / lock / reset / delete / grant an existing admin OR owner.
    Raises 403 in those cases. Call it inside every `require_admin` endpoint that
    creates or mutates a user the caller named, so a non-owner admin can't reach an
    admin/owner through an operational endpoint.
    """
    if is_owner(caller):
        return  # a product OWNER (Dan/Rafi/Yoav): full control over everyone, incl. admins
    if new_role == "admin":
        raise HTTPException(status_code=403, detail="Only an owner can manage admin accounts.")
    if target:
        tu = db.get_user(target)
        if tu and (tu.get("role") == "admin" or is_owner(target)):   # a non-owner admin can't touch admins or owners
            raise HTTPException(status_code=403, detail="Only an owner can manage admin/owner accounts.")
