"""
770 Trend Diamonds — FastAPI application factory.

The app boots, /healthz is public, and a global bearer gate guards every other
route. Endpoints are organised into one router per domain under
``app/api/routes`` (auth, signals, runs, exchange, paper, telegram, …); this
module just wires them together.

Run:  uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload
Env:  DATABASE_URL (Postgres). Optional: ADMIN_DEFAULT_PASSWORD (default "admin").
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import database as db
from app.core.security import auth_gate
from app.core.observability import (
    configure_logging, rate_limit_middleware, request_context_middleware,
)
from app.api.routes import (
    analytics,
    audit,
    autopilots,
    auth,
    billing,
    bots,
    design,
    employees,
    exchange,
    praxis_provision,
    finance,
    guide,
    layout,
    legal,
    meta,
    mgmt,
    paper,
    pm,
    portal,
    portfolio,
    reels,
    review,
    runs,
    signals,
    social,
    strategy,
    telegram,
    university,
    whatsapp,
)

logger = logging.getLogger("algo770")


def _init_sentry() -> None:
    """Error monitoring — dormant unless SENTRY_DSN is set. Set it and redeploy to enable."""
    dsn = os.environ.get("SENTRY_DSN")
    if not dsn:
        return
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get("APP_ENV", "production"),
            traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0") or 0),
            send_default_pii=False,
        )
        logger.info("sentry.enabled")
    except Exception as exc:  # never let monitoring setup crash boot
        logger.warning("sentry init failed: %s", exc)

# Routers mounted in registration order. Each owns one slice of the API surface.
ROUTERS = (meta, auth, strategy, runs, signals, telegram, exchange, paper, portfolio, social, billing, reels, bots, whatsapp, design, analytics, legal, portal, pm, mgmt, finance, employees, university, autopilots, audit, layout, guide, review, praxis_provision)


def create_app() -> FastAPI:
    configure_logging()
    # Mainnet Plan v1.1 · 1.4 — direct execution is PERMANENTLY retired in code. The old re-arm flags are
    # now no-ops; if one is still set, log it loudly (CRITICAL) so an operator notices + removes the stale intent.
    if (os.environ.get("STRATETEACH_LEGACY_ENGINE_ENABLED", "").strip().lower() == "true"
            or os.environ.get("STRATETEACH_ENGINE_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")):
        logging.getLogger("algo770").critical(
            "legacy engine env flags are SET but direct execution is PERMANENTLY RETIRED (Plan v1.1 · 1.4) — "
            "flags are no-ops; remove them.")
    _init_sentry()
    app = FastAPI(title="770 Trend Diamonds API", version="1.0.0")

    # CORS — tightened for the cloud multi-origin deploy (Phase 2C). The browser SPA is served from a
    # DIFFERENT origin than this API, so we echo an EXPLICIT allowlist. A wildcard '*' is both a security
    # hole AND invalid together with allow_credentials (browsers reject '*'+credentials), so it is never
    # used. Origins come from CORS_ALLOWED_ORIGINS (comma-separated) — falling back to the single
    # CONNECT_ALLOWED_ORIGIN (shared with the Edge functions) — and finally to the deployed frontend so a
    # missing var fails SAFE (locked to the known frontend), never open. Local/dev sets it to include
    # http://localhost:<port>. Empty entries are dropped.
    _cors_default = "https://strateteach-praxis-front-production.up.railway.app"
    _cors_raw = os.environ.get("CORS_ALLOWED_ORIGINS") or os.environ.get("CONNECT_ALLOWED_ORIGIN") or _cors_default
    _cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Middleware added later wraps earlier ones: auth (inner) ← rate-limit ← logging (outer),
    # so every request — including 401s and 429s — is logged with a correlation id.
    app.middleware("http")(auth_gate)
    app.middleware("http")(rate_limit_middleware)
    app.middleware("http")(request_context_middleware)

    @app.on_event("startup")
    def _startup() -> None:
        # Safe to call repeatedly; creates tables + seeds the default admin.
        try:
            db.bootstrap()
        except Exception as exc:  # don't crash boot if DB is momentarily unavailable
            app.state.bootstrap_error = str(exc)
        # Clear runs orphaned by the previous process (deploy/restart) so they
        # don't show as perpetually "running" stuck at a low %.
        try:
            n = db.reconcile_interrupted_runs()
            if n:
                logger.info("Reconciled %d interrupted backtest run(s) on startup.", n)
        except Exception as exc:  # never block boot on this
            logger.warning("Run reconciliation skipped: %s", exc)

    @app.on_event("startup")
    async def _startup_daily_scan() -> None:
        # Background loop: daily breakout scan at 00:05 UTC, feeds the Profit Engine.
        import asyncio
        from app.services.daily_scan import daily_scan_loop
        try:
            asyncio.create_task(daily_scan_loop())
        except Exception as exc:
            logger.warning("daily scan loop not started: %s", exc)
        # Background loop: Phase-2b dedicated STOCKS mean-reversion scan at 00:06 UTC. Feeds
        # ONLY the separate daily_scan_stocks_mr singleton for the SIMULATION MR-BB pilot —
        # fully isolated from the crypto scan above and from any live path. Bounded/guarded.
        try:
            from app.services.mr_scan import mr_scan_loop
            asyncio.create_task(mr_scan_loop())
        except Exception as exc:
            logger.warning("MR stocks scan loop not started: %s", exc)
        # Background loop: Phase-2c dedicated CRYPTO trend scan at 00:08 UTC. Feeds ONLY the
        # separate daily_scan_dr_crypto singleton for the SIMULATION DR-Crypto pilot — fully
        # isolated from the live crypto scan and any live path. Bounded/guarded.
        try:
            from app.services.dr_scan import dr_scan_loop
            asyncio.create_task(dr_scan_loop())
        except Exception as exc:
            logger.warning("DR crypto scan loop not started: %s", exc)
        # Background loop: daily demo-tester reminders (time left + score) via SMS.
        try:
            from app.services.demo_reminders import demo_reminder_loop
            asyncio.create_task(demo_reminder_loop())
        except Exception as exc:
            logger.warning("demo reminder loop not started: %s", exc)
        # Background loop: daily demo leaderboard broadcast at 18:00 Israel time (in-app).
        try:
            from app.services.leaderboard import leaderboard_loop
            asyncio.create_task(leaderboard_loop())
        except Exception as exc:
            logger.warning("leaderboard loop not started: %s", exc)
        # Background loop: Telegram daily digest at the configured time.
        try:
            from app.services.telegram_scheduler import telegram_daily_loop
            asyncio.create_task(telegram_daily_loop())
        except Exception as exc:
            logger.warning("telegram daily loop not started: %s", exc)
        # Background loop: Telegram hourly status report (only when it changed).
        try:
            from app.services.telegram_scheduler import telegram_status_loop
            asyncio.create_task(telegram_status_loop())
        except Exception as exc:
            logger.warning("telegram status loop not started: %s", exc)
        # Background loops: recurring scheduled reports (Israel time) over the app's
        # WhatsApp/notify path — breakouts (daily 09:00 → users + team), users+
        # portfolio (hourly → owners), open requests (daily 12:00 → owners), and
        # closed-today requests (daily 00:05 → owners). Dormant until Twilio keys.
        try:
            from app.services.scheduled_reports import (
                breakouts_report_loop, owner_portfolio_loop,
                open_requests_loop, closed_requests_loop,
            )
            asyncio.create_task(breakouts_report_loop())
            asyncio.create_task(owner_portfolio_loop())
            asyncio.create_task(open_requests_loop())
            asyncio.create_task(closed_requests_loop())
        except Exception as exc:
            logger.warning("scheduled report loops not started: %s", exc)
        # Background loop: the branded Owners Daily Report — emailed (PDF attached +
        # HTML link) to the OWNERS only, daily 09:00 Israel time, one send/owner/day.
        try:
            from app.services.owners_report import owners_report_email_loop
            asyncio.create_task(owners_report_email_loop())
        except Exception as exc:
            logger.warning("owners report loop not started: %s", exc)
        # One-shot: re-register the inbound webhook so replies/buttons keep working
        # across deploys. No-op unless Telegram is connected, approvals are on, and
        # the public URL is reachable (skips the localhost dev override).
        try:
            from app.services import telegram as _tg
            asyncio.create_task(_tg.ensure_webhook())
        except Exception as exc:
            logger.warning("telegram webhook auto-register not started: %s", exc)
        # Background loop: in-app Profit Engine auto-run scheduler (per-user).
        try:
            from app.services.autorun import autorun_loop
            asyncio.create_task(autorun_loop())
        except Exception as exc:
            logger.warning("autorun loop not started: %s", exc)
        # Background loop: DEMO-only stop-loss / target safety net. Re-evaluates every
        # open paper run server-side (~30s) so a per-position stop fires even when the
        # screen isn't open and auto-run is off. Paper only — never places a live order.
        try:
            from app.services.autorun import stop_monitor_loop
            asyncio.create_task(stop_monitor_loop())
        except Exception as exc:
            logger.warning("paper stop-monitor loop not started: %s", exc)
        # Background loop: AutoPilots DRY-RUN/SIMULATION daily batch (00:10 UTC, after the
        # scan). Owners-only feature; simulates armed pilots — NO real orders, NO money.
        try:
            from app.services.autopilot_sim import autopilot_sim_loop
            asyncio.create_task(autopilot_sim_loop())
        except Exception as exc:
            logger.warning("autopilot sim loop not started: %s", exc)
        # Background loop: READ-ONLY live-close reconcile (~120s). Detects exchange-side OCO
        # stop/take-profit fills for users with open live runs so they land in the closed-log
        # without opening it. Only fetch_closed_orders — never places/cancels a live order.
        try:
            from app.services.live_reconcile import reconcile_loop
            asyncio.create_task(reconcile_loop())
        except Exception as exc:
            logger.warning("live reconcile loop not started: %s", exc)

    # Additive API versioning: every route is served at its current path AND under
    # /v1. Existing clients keep working unchanged; new consumers can adopt /v1.
    for module in ROUTERS:
        app.include_router(module.router)
        app.include_router(module.router, prefix="/v1")

    return app


app = create_app()
