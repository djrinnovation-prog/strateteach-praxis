"""
PostgreSQL persistence layer for 770 Trend Diamonds.

Design (mirrors the original):
- ALL backend state lives in managed Postgres (psycopg 3), not local SQLite,
  so data is shared across devices and survives redeploys.
- A thin connection helper + dict-row cursors keep call sites simple.
- bootstrap() is idempotent (CREATE TABLE IF NOT EXISTS) and seeds a default
  admin user so a fresh database is immediately usable.

Milestone 1 implements: connection handling, schema bootstrap, and full
users/auth_sessions CRUD (needed for the live auth gate). Domain tables for
runs / results / paper-trading / config are CREATED here but their CRUD is
filled in during later milestones.
"""
from __future__ import annotations

import os
import re
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, List, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.models import (
    DEFAULT_BUCKET_AMOUNT,
    BacktestResult,
    EquityCurvePoint,
    Run,
    StrategyConfig,
    Trade,
)

# ── Day boundary: Israel time ───────────────────────────────────────────────
# The owner and the user base are in Israel, so the "today" boundary for every
# account-value snapshot — LIVE *and* DEMO — is Asia/Jerusalem, never the
# browser's local offset and never UTC. DST-aware via zoneinfo; falls back to a
# fixed UTC+3 (IDT) offset if the tz database is unavailable. Mirrors the same
# pattern in services/leaderboard.py.
from datetime import timedelta as _timedelta

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
    _IL_TZ = _ZoneInfo("Asia/Jerusalem")
except Exception:  # noqa: BLE001 — fall back to a fixed offset (IDT, UTC+3)
    _IL_TZ = timezone(_timedelta(hours=3))


def _il_now() -> datetime:
    """Current wall-clock time in Israel (Asia/Jerusalem).

    The single source of truth for the day/month/year boundaries used by the
    per-(user, env) account-value snapshots, so live and demo "today" always
    roll over at Israel midnight regardless of where the viewer is.
    """
    return datetime.now(_IL_TZ)


# ── Connection ────────────────────────────────────────────────────────────

_DATABASE_URL = os.environ.get("DATABASE_URL")


def _require_url() -> str:
    if not _DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set — provision a Postgres database and export it."
        )
    return _DATABASE_URL


_POOL: "Optional[Any]" = None


def _get_pool():
    """Lazily build a shared connection pool.

    Opening a fresh Postgres connection on every query was the main source of
    per-request latency (~1s each, and the app fires a dozen calls on load).
    A pool keeps warm connections around so each query reuses one instead of
    re-doing TCP + auth + session setup. Falls back to direct connections if
    psycopg_pool isn't available.
    """
    global _POOL
    if _POOL is None:
        try:
            from psycopg_pool import ConnectionPool
            _POOL = ConnectionPool(
                _require_url(),
                min_size=1, max_size=10, max_idle=300, timeout=10,
                kwargs={"row_factory": dict_row},
                open=False,
            )
            _POOL.open()
        except Exception:  # noqa: BLE001 — pool lib missing or DB down: degrade gracefully
            _POOL = False  # sentinel: never try again, use direct connections
    return _POOL


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    """Yield a pooled Postgres connection with dict rows; commit on success."""
    pool = _get_pool()
    if pool:
        # pool.connection() commits on clean exit / rolls back on error and
        # returns the connection to the pool — same semantics as before.
        with pool.connection() as conn:
            yield conn
        return
    # Fallback: direct connection (pool unavailable).
    conn = psycopg.connect(_require_url(), row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Query helpers ───────────────────────────────────────────────────────────
# Thin wrappers over get_conn() for the common single-statement cases, so call
# sites read as one line. Identical semantics to the inlined form (same SQL, same
# params, same commit-on-exit via get_conn). Multi-statement / transactional
# functions keep using `with get_conn() as conn:` directly.

def fetch_one(sql: str, params: "tuple | None" = None) -> "Optional[dict[str, Any]]":
    """Run a read and return the first row (or None)."""
    with get_conn() as conn:
        return conn.execute(sql, params).fetchone()


def fetch_all(sql: str, params: "tuple | None" = None) -> "list[dict[str, Any]]":
    """Run a read and return all rows as a list."""
    with get_conn() as conn:
        return list(conn.execute(sql, params).fetchall())


def execute(sql: str, params: "tuple | None" = None) -> None:
    """Run a write (INSERT/UPDATE/DELETE); get_conn commits on clean exit."""
    with get_conn() as conn:
        conn.execute(sql, params)


# ── Schema bootstrap ────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    status            TEXT NOT NULL,
    buckets           JSONB NOT NULL,
    config            JSONB NOT NULL,
    total_symbols     INTEGER,
    completed_symbols INTEGER DEFAULT 0,
    failed_symbols    INTEGER DEFAULT 0,
    current_symbol    TEXT,
    created_at        TEXT NOT NULL,
    completed_at      TEXT,
    error_message     TEXT
);

CREATE TABLE IF NOT EXISTS backtest_results (
    run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    symbol              TEXT NOT NULL,
    name                TEXT,
    bucket              TEXT NOT NULL,
    total_return        DOUBLE PRECISION,
    cagr                DOUBLE PRECISION,
    max_drawdown        DOUBLE PRECISION,
    win_rate            DOUBLE PRECISION,
    sharpe              DOUBLE PRECISION,
    trade_count         INTEGER,
    initial_capital     DOUBLE PRECISION,
    is_return_outlier   BOOLEAN DEFAULT FALSE,
    is_drawdown_outlier BOOLEAN DEFAULT FALSE,
    error_message       TEXT,
    equity_curve        JSONB,
    trades              JSONB,
    PRIMARY KEY (run_id, symbol)
);

CREATE TABLE IF NOT EXISTS saved_strategies (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    config      JSONB NOT NULL,
    pine_source TEXT,
    created_at  TEXT NOT NULL
);

-- Singleton config blobs (telegram, exchange, profit-engine, saved strategies).
CREATE TABLE IF NOT EXISTS config_singletons (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_sessions (
    id          BIGSERIAL PRIMARY KEY,
    data        JSONB NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_positions (
    id          BIGSERIAL PRIMARY KEY,
    session_id  BIGINT NOT NULL REFERENCES paper_sessions(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'open',
    data        JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS target_events (
    id          BIGSERIAL PRIMARY KEY,
    session_id  BIGINT,
    data        JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
    id         BIGSERIAL PRIMARY KEY,
    ts         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    detail     JSONB
);

-- Append-only audit trail: who did what, when (security + compliance).
CREATE TABLE IF NOT EXISTS audit_log (
    id      BIGSERIAL PRIMARY KEY,
    ts      TEXT NOT NULL,
    actor   TEXT,
    action  TEXT NOT NULL,
    target  TEXT,
    ip      TEXT,
    detail  JSONB
);

-- One-time admin-issued password reset tokens.
CREATE TABLE IF NOT EXISTS password_resets (
    token      TEXT PRIMARY KEY,
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at    TEXT
);

-- In-app chat between users. to_user NULL = broadcast to everyone.
CREATE TABLE IF NOT EXISTS chat_messages (
    id        BIGSERIAL PRIMARY KEY,
    ts        TEXT NOT NULL,
    from_user TEXT NOT NULL,
    to_user   TEXT,
    body      TEXT NOT NULL
);

-- Friend graph: a request from `requester` to `addressee`, accepted = friends.
CREATE TABLE IF NOT EXISTS friendships (
    id        BIGSERIAL PRIMARY KEY,
    requester TEXT NOT NULL,
    addressee TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'pending',
    ts        TEXT NOT NULL,
    UNIQUE (requester, addressee)
);

-- Group chats + membership.
CREATE TABLE IF NOT EXISTS chat_groups (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS group_members (
    group_id BIGINT NOT NULL,
    username TEXT NOT NULL,
    UNIQUE (group_id, username)
);

-- Admin-sent rewards (e.g. flying confetti) targeted at a user or everyone.
CREATE TABLE IF NOT EXISTS rewards (
    id        BIGSERIAL PRIMARY KEY,
    ts        TEXT NOT NULL,
    from_user TEXT NOT NULL,
    target    TEXT,
    kind      TEXT NOT NULL DEFAULT 'confetti'
);

-- Admin screen-capture requests + the uploaded snapshot from the user's browser.
CREATE TABLE IF NOT EXISTS screen_requests (
    id           BIGSERIAL PRIMARY KEY,
    ts           TEXT NOT NULL,
    target_user  TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    image        TEXT,
    route        TEXT,
    captured_at  TEXT
);

-- Loyalty (gamification) earn/spend ledger. Distinct from purchasable credits.
CREATE TABLE IF NOT EXISTS loyalty_events (
    id         BIGSERIAL PRIMARY KEY,
    username   TEXT NOT NULL,
    kind       TEXT NOT NULL,
    points     INTEGER NOT NULL,
    meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TEXT NOT NULL
);

-- Stripe/billing event log (also serves as webhook idempotency by stripe_id).
CREATE TABLE IF NOT EXISTS billing_events (
    id         BIGSERIAL PRIMARY KEY,
    stripe_id  TEXT,
    username   TEXT,
    kind       TEXT NOT NULL,
    amount     INTEGER,
    currency   TEXT,
    raw        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_stripe_id ON billing_events(stripe_id) WHERE stripe_id IS NOT NULL;

-- Per-user, per-metric, per-day usage counters for rate limits
-- (e.g. backtest scans/day, profit-engine runs/day).
CREATE TABLE IF NOT EXISTS usage_counters (
    username TEXT NOT NULL,
    metric   TEXT NOT NULL,
    day      TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (username, metric, day)
);

-- Admin-generated access coupons. grant = what redeeming unlocks
-- (e.g. {"all": true} or {"plan":"pro","profitUnlock":true,"credits":{"bots":5}}).
CREATE TABLE IF NOT EXISTS coupons (
    code        TEXT PRIMARY KEY,
    grant_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_uses    INTEGER NOT NULL DEFAULT 0,   -- 0 = unlimited
    used_count  INTEGER NOT NULL DEFAULT 0,
    expires_at  TEXT,
    note        TEXT,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  TEXT,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id          BIGSERIAL PRIMARY KEY,
    code        TEXT NOT NULL,
    username    TEXT NOT NULL,
    redeemed_at TEXT NOT NULL,
    UNIQUE (code, username)
);

-- Admin-uploaded demo videos, keyed by feature (home/profit/scanner/...).
CREATE TABLE IF NOT EXISTS demo_videos (
    feature    TEXT PRIMARY KEY,
    video      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Tester suggestions/feedback (from demo users and others).
CREATE TABLE IF NOT EXISTS feedback (
    id         BIGSERIAL PRIMARY KEY,
    username   TEXT NOT NULL,
    text       TEXT NOT NULL,
    route      TEXT,
    handled    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL
);

-- "Contact admin for access" requests. Admin can grant (free) or require payment.
CREATE TABLE IF NOT EXISTS access_requests (
    id          BIGSERIAL PRIMARY KEY,
    username    TEXT NOT NULL,
    message     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | granted | payment | denied
    handled_by  TEXT,
    handled_at  TEXT,
    created_at  TEXT NOT NULL
);

-- Reels learning lessons (admin-managed). `video_url` holds either a hosted
-- video URL (e.g. a HeyGen export) or a base64 data URL for direct uploads.
CREATE TABLE IF NOT EXISTS reels_lessons (
    id                   BIGSERIAL PRIMARY KEY,
    title_he             TEXT NOT NULL DEFAULT '',
    title_en             TEXT NOT NULL DEFAULT '',
    description          TEXT NOT NULL DEFAULT '',
    video_url            TEXT,
    free_preview_seconds INTEGER NOT NULL DEFAULT 30,
    position             INTEGER NOT NULL DEFAULT 0,
    published            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);

-- Observational log of runs/positions opened & closed (additive; never gates a
-- trade). One row per opened position/order; updated in place when it closes.
CREATE TABLE IF NOT EXISTS runs_log (
    id               BIGSERIAL PRIMARY KEY,
    username         TEXT,
    mode             TEXT NOT NULL DEFAULT 'demo',   -- 'live' | 'demo'
    symbol           TEXT,
    side             TEXT,                            -- 'long' | 'short' | 'buy' | 'sell'
    opened_at        TEXT,
    closed_at        TEXT,
    duration_seconds INTEGER,
    entry_price      DOUBLE PRECISION,
    exit_price       DOUBLE PRECISION,
    qty              DOUBLE PRECISION,
    pnl              DOUBLE PRECISION,
    pnl_pct          DOUBLE PRECISION,
    status           TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'closed' | 'stopped'
    source           TEXT,                            -- 'manual' | 'auto'
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_log_created ON runs_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_log_user ON runs_log(username);

-- ── AutoPilots — DRY-RUN / SIMULATION ONLY (owners-only feature) ────────────────
-- These three tables hold a pilot's SIMULATED activity: NO real orders, NO money.
-- `autopilot_armed` = one row per (user, pilot) that the owner armed; the sim engine
-- iterates these on-arm / daily / run-now. Positions + activity are all simulated.
CREATE TABLE IF NOT EXISTS autopilot_armed (
    id             BIGSERIAL PRIMARY KEY,
    username       TEXT NOT NULL,
    pilot_id       TEXT NOT NULL,
    direction      TEXT NOT NULL DEFAULT 'long-only',   -- 'long-only' | 'long-short'
    market         TEXT NOT NULL DEFAULT 'crypto',
    nav            DOUBLE PRECISION NOT NULL DEFAULT 1000,
    per_trade_pct  DOUBLE PRECISION NOT NULL DEFAULT 10,
    account_label  TEXT,
    armed_at       TEXT NOT NULL,
    last_run_at    TEXT,
    next_run_at    TEXT,
    status         TEXT NOT NULL DEFAULT 'simulation',   -- always 'simulation' in this phase
    equity_curve   JSONB,                                -- backfilled sim P&L journey [{d,v}]
    UNIQUE (username, pilot_id)
);
CREATE INDEX IF NOT EXISTS idx_autopilot_armed_user ON autopilot_armed(username);

CREATE TABLE IF NOT EXISTS autopilot_sim_positions (
    id             BIGSERIAL PRIMARY KEY,
    username       TEXT NOT NULL,
    pilot_id       TEXT NOT NULL,
    symbol         TEXT NOT NULL,
    side           TEXT NOT NULL DEFAULT 'long',         -- 'long' | 'short'
    entry_price    DOUBLE PRECISION NOT NULL,
    qty            DOUBLE PRECISION NOT NULL,
    last_price     DOUBLE PRECISION,
    unrealized_pnl DOUBLE PRECISION DEFAULT 0,
    realized_pnl   DOUBLE PRECISION DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'closed'
    opened_at      TEXT NOT NULL,
    closed_at      TEXT,
    exit_price     DOUBLE PRECISION,
    updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ap_pos_user ON autopilot_sim_positions(username, pilot_id, status);

CREATE TABLE IF NOT EXISTS autopilot_sim_activity (
    id             BIGSERIAL PRIMARY KEY,
    username       TEXT NOT NULL,
    pilot_id       TEXT NOT NULL,
    kind           TEXT NOT NULL,                         -- 'open' | 'close' | 'run'
    symbol         TEXT,
    side           TEXT,
    price          DOUBLE PRECISION,
    qty            DOUBLE PRECISION,
    pnl            DOUBLE PRECISION,
    note           TEXT,
    at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ap_act_user ON autopilot_sim_activity(username, pilot_id, at DESC);
"""

# Idempotent column migrations for tables that pre-date a feature.
_MIGRATIONS = (
    # Reels · course lessons: bilingual CAPTION shown under the title in the player
    # (additive — the older single `description` stays for back-compat).
    "ALTER TABLE reels_lessons ADD COLUMN IF NOT EXISTS caption_he TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE reels_lessons ADD COLUMN IF NOT EXISTS caption_en TEXT NOT NULL DEFAULT ''",
    # AutoPilots: backfilled simulated P&L journey (added after the table shipped).
    "ALTER TABLE autopilot_armed ADD COLUMN IF NOT EXISTS equity_curve JSONB",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS protection_hash TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS win_target REAL NOT NULL DEFAULT 60",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_sections TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT",
    # ── Privacy-safe product analytics consent (Item 2/3). Default FALSE — the ingest
    #    boundary REJECTS every event until the user accepts the consent notice. ──
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_consent BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS analytics_consent_at TEXT",
    # ── Data-rights (Item 7): a SOFT deletion REQUEST (marks the account + notifies an
    #    owner) — never a hard delete here. Cleared when the request is withdrawn. ──
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TEXT",
    # ── Subscriptions / tiers / credits / loyalty (Stage 1) ──
    # Added WITHOUT a default so pre-existing rows stay NULL and can be
    # grandfathered to 'pro' once (see _backfill_plans). New users get 'basic'
    # explicitly in create_user(); reads COALESCE to 'basic'.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS profit_engine_unlocked BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS credits JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_period_end TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding JSONB",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS badge TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS music TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_expires TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_token TEXT",
    "CREATE INDEX IF NOT EXISTS idx_users_demo_token ON users(demo_token) WHERE demo_token IS NOT NULL",
    "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS group_id BIGINT",
    "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_seen TEXT",
    "CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)",
    "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS image TEXT",  # optional screenshot (data URL, <=3MB)
    # Per-user notification preferences (channels + which alerts). See _NOTIF_DEFAULTS.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_prefs JSONB NOT NULL DEFAULT '{}'::jsonb",
    # Per-user in-app auto-run config (the Profit Engine scheduler). See _AUTORUN_DEFAULTS.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS autorun JSONB NOT NULL DEFAULT '{}'::jsonb",
    # Owner of a saved strategy (username). NULL = legacy/admin-provided (admin-only edit).
    "ALTER TABLE saved_strategies ADD COLUMN IF NOT EXISTS owner TEXT",
    # Strategy help requests: a user sends their code to the admin, admin answers.
    "CREATE TABLE IF NOT EXISTS strategy_help (id BIGSERIAL PRIMARY KEY, username TEXT, source TEXT, "
    "message TEXT, status TEXT NOT NULL DEFAULT 'open', answer TEXT, created_at TEXT, answered_at TEXT)",
    # SMS login 2FA (Twilio Verify). Off by default; user opts in after verifying a phone.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN NOT NULL DEFAULT FALSE",
    # Main-admin tier. role='admin' grants the admin panel; is_main additionally
    # grants "inside info" (other users' data/P&L, revenue, bot logic). New admins
    # default to restricted (is_main=FALSE). The seeded owner account is always
    # re-affirmed as main on boot so it can never be locked out of its own panel.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_main BOOLEAN NOT NULL DEFAULT FALSE",
    "UPDATE users SET is_main = TRUE WHERE username = 'admin'",
    # Privacy-policy acknowledgement: stores the policy version (date) the user accepted.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_ack TEXT",
    # Forced password change: TRUE after an admin resets the user's password with
    # "force change on next login". On their next successful login the app routes
    # them straight to a set-new-password screen and blocks everything until they
    # pick one (which clears this flag). Defaults FALSE for everyone.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
    # Public self-signup requests (await admin approval, then become demo users).
    """CREATE TABLE IF NOT EXISTS signup_requests (
        id BIGSERIAL PRIMARY KEY, name TEXT, email TEXT, phone TEXT, note TEXT,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT, handled_at TEXT, handled_by TEXT,
        username TEXT
    )""",
    # Self-service "can't log in / forgot password" flow. A user who can't log in
    # files a PENDING request (public, no auth); an admin approves it, which flips
    # reset_approved=TRUE on the account so the user can renew their password from
    # the login screen WITHOUT the old one (one-time, cleared once they set a new
    # password). Mirrors the signup-request → admin-approval pattern.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_approved BOOLEAN NOT NULL DEFAULT FALSE",
    """CREATE TABLE IF NOT EXISTS password_reset_requests (
        id BIGSERIAL PRIMARY KEY, username TEXT, contact TEXT, note TEXT,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT, handled_at TEXT, handled_by TEXT
    )""",
    # Backtest runs are EPHEMERAL by default: a run executes + is viewable/exportable,
    # but is only KEPT (shown in history) when the user explicitly saves it. New runs
    # insert saved=FALSE; mark_run_saved() flips it. Pre-existing rows are grandfathered
    # to TRUE once (see _backfill_runs_saved) so old history isn't suddenly hidden.
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS saved BOOLEAN NOT NULL DEFAULT FALSE",
    # Admin → single-user stored messages ("reply to a user"). Any admin can send
    # a branded message that a user reads in-app. Created here (not only in _SCHEMA)
    # so it lands on the EXISTING production DB on the next boot — same mechanism as
    # runs.saved / strategy_help. created_at/read_at are TEXT ISO strings to match
    # every other timestamp column in this file (written via now_iso()).
    """CREATE TABLE IF NOT EXISTS admin_messages (
        id         BIGSERIAL PRIMARY KEY,
        recipient  TEXT NOT NULL,
        sender     TEXT NOT NULL,
        title      TEXT,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at    TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_admin_messages_recipient ON admin_messages(recipient)",
    # ── Signal Automated Bots (server-stored TRADE-ONLY per-bot keys + TradingView
    #    webhooks). These place REAL orders, so keys are Fernet-encrypted at rest
    #    (same scheme as the exchange-config singleton) and ciphertext is NEVER
    #    returned by any endpoint. Created here (not only in _SCHEMA) so the table
    #    lands on the EXISTING production DB on the next boot — same mechanism as
    #    runs.saved / admin_messages. ──
    """CREATE TABLE IF NOT EXISTS bots (
        id             BIGSERIAL PRIMARY KEY,
        username       TEXT NOT NULL,
        label          TEXT,
        webhook_token  TEXT UNIQUE NOT NULL,
        status         TEXT NOT NULL DEFAULT 'active',
        exchange       TEXT,
        market         TEXT DEFAULT 'spot',
        enc_key        TEXT,
        enc_secret     TEXT,
        enc_passphrase TEXT,
        sub_account    TEXT,
        max_quote      NUMERIC,
        max_open       INTEGER,
        size_mode      TEXT NOT NULL DEFAULT 'fixed',
        size_pct       NUMERIC NOT NULL DEFAULT 100,
        created_at     TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_bots_username ON bots(username)",
    "CREATE INDEX IF NOT EXISTS idx_bots_webhook_token ON bots(webhook_token)",
    # Order-size mode per bot: 'fixed' (per-order maxQuote/alert quote — the existing
    # behaviour) or 'balance_pct' (size a BUY off size_pct% of the free quote balance —
    # SPOT LONG-ONLY). Existing bots default to 'fixed' so behaviour is unchanged.
    "ALTER TABLE bots ADD COLUMN IF NOT EXISTS size_mode TEXT NOT NULL DEFAULT 'fixed'",
    "ALTER TABLE bots ADD COLUMN IF NOT EXISTS size_pct NUMERIC NOT NULL DEFAULT 100",
    # Attribute every real order/run to the bot that fired it (NULL for manual / paper).
    "ALTER TABLE runs_log ADD COLUMN IF NOT EXISTS bot_id BIGINT",
    "ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS bot_id BIGINT",
    "CREATE INDEX IF NOT EXISTS idx_runs_log_bot ON runs_log(bot_id) WHERE bot_id IS NOT NULL",
    # Live-close auto-detection: the READ-ONLY exchange reconcile stamps how a live position
    # actually closed (stop_loss | take_profit | manual) and the exchange order id it matched,
    # so the closed-positions log shows the real OCO fill. close_order_id also dedupes reconciles.
    "ALTER TABLE runs_log ADD COLUMN IF NOT EXISTS close_reason TEXT",
    "ALTER TABLE runs_log ADD COLUMN IF NOT EXISTS close_order_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_runs_log_close_oid ON runs_log(close_order_id) WHERE close_order_id IS NOT NULL",
    # ── Owner / Requests portal (mini help-desk). A "request" is EITHER a user
    #    feedback (category='user_request') OR an internal owner note
    #    (category='owner_note'). Every Service-Hub feedback also lands here as a
    #    request row (status='new'). Replies live in request_replies (a per-request
    #    thread); an admin reply to a user_request is ALSO delivered to that user via
    #    the existing admin_messages "Team Message" path. Created here (not only in
    #    _SCHEMA) so the tables land on the EXISTING production DB on the next boot —
    #    same mechanism as admin_messages / bots. ──
    """CREATE TABLE IF NOT EXISTS requests (
        id           BIGSERIAL PRIMARY KEY,
        user_id      TEXT,
        display_name TEXT,
        category     TEXT NOT NULL DEFAULT 'user_request',  -- user_request | owner_note
        subject      TEXT,
        body         TEXT NOT NULL DEFAULT '',
        media        TEXT,
        route        TEXT,
        status       TEXT NOT NULL DEFAULT 'new',           -- new | in_progress | answered | resolved
        feedback_id  BIGINT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_requests_category ON requests(category)",
    """CREATE TABLE IF NOT EXISTS request_replies (
        id          BIGSERIAL PRIMARY KEY,
        request_id  BIGINT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        author_id   TEXT,
        author_name TEXT,
        text        TEXT NOT NULL,
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_request_replies_request ON request_replies(request_id)",
    # ── Anonymous design-options poll. Self-contained, used ONLY by the hosted
    #    design presentation at /design/ (index.html = HE, en.html = EN) to let a
    #    panel of evaluators pick the winning Home-screen design. No identities are
    #    stored — one row per anonymous browser (a random uuid kept in localStorage),
    #    upserted on re-vote so one device = one vote. `choice` is the favored option
    #    1–6; `path` is the JSON bracket path they clicked (for the record only).
    #    Created here (not only in _SCHEMA) so it lands on the EXISTING production DB
    #    on the next boot — same mechanism as requests / bots / admin_messages. ──
    """CREATE TABLE IF NOT EXISTS design_votes (
        id         BIGSERIAL PRIMARY KEY,
        voter_id   TEXT UNIQUE NOT NULL,
        choice     INTEGER NOT NULL,
        path       JSONB,
        created_at TEXT NOT NULL,
        updated_at TEXT
    )""",
    # ── Privacy-safe product analytics / audit events (Part F). ONE row per tracked
    #    UI event: `username` (per-user isolation), the `event` name, and `props`
    #    (JSONB) restricted SERVER-SIDE to a small whitelist of non-sensitive keys
    #    (screen/action/mode/op/code/ok…). NEVER stores amounts, API keys or PII —
    #    see record_analytics_event(). Indexed on (event, ts) for the admin rollups. ──
    """CREATE TABLE IF NOT EXISTS analytics_events (
        id       BIGSERIAL PRIMARY KEY,
        username TEXT,
        event    TEXT NOT NULL,
        props    JSONB NOT NULL DEFAULT '{}'::jsonb,
        ts       TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_analytics_event_ts ON analytics_events(event, ts)",
    "CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(username)",
    # ── Pseudonymous identity (Item 2). `auid` = HMAC(username, SESSION_SECRET) — a
    #    stable per-user pseudonym; the mapping is NOT exposed in analytics reads. New
    #    events store the pseudonym + a client session id and leave `username` NULL, so
    #    the row itself carries no internal identity. Legacy rows keep their username. ──
    "ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS auid TEXT",
    "ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS session_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_analytics_auid ON analytics_events(auid)",
    # ── Per-user ENCRYPTED exchange-key backup. So the exchange connection follows the
    #    user across devices and survives a browser cache-clear (keys were per-device
    #    localStorage only). ONE row per user (PRIMARY KEY username → strict per-user
    #    isolation). Secrets are stored ONLY as Fernet ciphertext (enc_*), the SAME
    #    SESSION_SECRET-derived scheme the Signal Bots use — plaintext keys never touch
    #    this table. Decrypted only back to the authenticated owner over HTTPS. Created
    #    here (not only in _SCHEMA) so it lands on the EXISTING production DB on next
    #    boot — same mechanism as bots / requests / admin_messages. ──
    """CREATE TABLE IF NOT EXISTS exchange_creds_backup (
        username       TEXT PRIMARY KEY,
        exchange       TEXT,
        environment    TEXT,
        sub_account    TEXT,
        enc_key        TEXT,
        enc_secret     TEXT,
        enc_passphrase TEXT,
        updated_at     TEXT
    )""",
    # ── HOME GUIDE · owner/admin-replaceable binary assets for the animated Home guide
    #    (Yoav's mascot overlay). Each row is ONE uploaded override — a per-step voice MP3
    #    or a character pose PNG — stored as bytes so owners can swap assets live from the
    #    Guide manager with NO deploy. `key` is the stable slot id ('voice-1'…'voice-8',
    #    'pose-talk'/'pose-wave'/…). The guide config singleton only stores URL strings; a
    #    slot with a row here is served from /auth/guide/asset/<key>, otherwise the shipped
    #    static /media/guide/… default is used. Created here (not only in _SCHEMA) so it
    #    lands on the EXISTING prod DB on next boot — same mechanism as exchange_creds_backup. ──
    """CREATE TABLE IF NOT EXISTS guide_assets (
        key        TEXT PRIMARY KEY,
        mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
        data       BYTEA NOT NULL,
        updated_by TEXT,
        updated_at TEXT
    )""",
    # ── REVIEW SUBMISSIONS · the multi-user Review-Mode board (Phase 2). Each gated reviewer
    #    (owners + Oren) collects per-screen "what to fix" notes in the client, then SUBMITS them
    #    here as ONE submission — the notes ([{screen, route, text, hasScreenshot}]) + the compiled
    #    markdown prompt + who/when. Dan's mini-portal (/review-inbox) lists every submission,
    #    merges tasks, deletes, and compiles a date-range report to email/download. Created here
    #    (not only in _SCHEMA) so it lands on the EXISTING prod DB on next boot. ──
    """CREATE TABLE IF NOT EXISTS review_submissions (
        id          BIGSERIAL PRIMARY KEY,
        from_user   TEXT NOT NULL,
        from_name   TEXT NOT NULL DEFAULT '',
        notes       JSONB NOT NULL DEFAULT '[]',
        prompt_text TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_review_submissions_created ON review_submissions(created_at DESC)",
    # ── REVIEW FILES · up to 10 attached files per review task, travelling to Dan's inbox.
    #    Stored as downscaled bytes (BYTEA), keyed by an unguessable `token` used in the served
    #    URL so the inbox's <img> tags can load them (public read, same pattern as guide assets).
    #    The submission's notes JSON stores only the file TOKENS, so the list stays light; the
    #    bytes are fetched lazily per <img>. Cascade-deleted with their submission. ──
    """CREATE TABLE IF NOT EXISTS review_files (
        id            BIGSERIAL PRIMARY KEY,
        token         TEXT UNIQUE NOT NULL,
        submission_id BIGINT,
        mime          TEXT NOT NULL DEFAULT 'image/jpeg',
        data          BYTEA NOT NULL,
        created_at    TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_review_files_submission ON review_files(submission_id)",
    # ── REVIEW SNAPSHOTS · per-reviewer named checkpoints of the working prompt / task-set.
    #    Dan (and any reviewer) can SAVE the current prompt as a named+timestamped snapshot from
    #    the Review-inbox prompt editor BEFORE executing, then RESTORE a previous one if the
    #    result isn't good. Owner-scoped (each reviewer sees only their own). `content` is the raw
    #    prompt/markdown text. Created here (not only in _SCHEMA) so it lands on the EXISTING prod
    #    DB on next boot. ──
    """CREATE TABLE IF NOT EXISTS review_snapshots (
        id          BIGSERIAL PRIMARY KEY,
        owner_user  TEXT NOT NULL,
        name        TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_review_snapshots_owner ON review_snapshots(owner_user, created_at DESC)",
    # ── Editable LEGAL texts (privacy / terms / risk / demo / exchange-keys …). The legal
    #    counsel edits these live from the in-app Legal Console — no code change / deploy.
    #    `key` is the stable id the app renders by; title/body carried per-language (HE/EN),
    #    body is markdown. `published` gates whether the public app shows it. Seeded on boot
    #    from the shipped copy (ON CONFLICT DO NOTHING → never clobbers an editor's changes).
    #    Created here (not only _SCHEMA) so it lands on the EXISTING prod DB next boot. ──
    """CREATE TABLE IF NOT EXISTS legal_texts (
        key        TEXT PRIMARY KEY,
        title_he   TEXT NOT NULL DEFAULT '',
        title_en   TEXT NOT NULL DEFAULT '',
        body_he    TEXT NOT NULL DEFAULT '',
        body_en    TEXT NOT NULL DEFAULT '',
        published  BOOLEAN NOT NULL DEFAULT TRUE,
        sort       INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        updated_by TEXT
    )""",
    # ── LEGAL COPY · the 4 analytics/safety-plan legal BLOCKS Raz edits + approves in
    #    her /legal-portal (disclaimer · risk · privacy · consent). Each row is the live
    #    bilingual copy the app renders; `approved` FALSE shows the amber DRAFT badge
    #    app-wide, and Raz's Confirm & Approve flips it TRUE (clears the badge). Created
    #    here (not only in _SCHEMA) so it lands on the EXISTING prod DB on boot. ──
    """CREATE TABLE IF NOT EXISTS legal_copy (
        block      TEXT PRIMARY KEY,
        he         TEXT NOT NULL DEFAULT '',
        en         TEXT NOT NULL DEFAULT '',
        approved   BOOLEAN NOT NULL DEFAULT FALSE,
        updated_by TEXT,
        updated_at TEXT
    )""",
    # ── DAILY AUDIT · a living audit loop for Oren (it/product) + Raz (legal) + Dan (all).
    #    Items seeded from the v1 readiness audit; each has an editable `prompt` (the check
    #    to run), a workflow `status` (todo/in_process/redo/approved) and a `baseline` chip.
    #    `key` = domain|section|title makes the seed idempotent. audit_runs holds each run's
    #    prompt snapshot + pasted result + approval. Created here so both land on the live
    #    DB on boot (same mechanism as legal_copy / pm_tasks). ──
    """CREATE TABLE IF NOT EXISTS audit_items (
        id          BIGSERIAL PRIMARY KEY,
        key         TEXT UNIQUE,
        domain      TEXT NOT NULL DEFAULT 'product',
        section     TEXT NOT NULL DEFAULT '',
        title       TEXT NOT NULL DEFAULT '',
        where_we_are TEXT NOT NULL DEFAULT '',
        prompt      TEXT NOT NULL DEFAULT '',
        baseline    TEXT NOT NULL DEFAULT 'missing',
        status      TEXT NOT NULL DEFAULT 'todo',
        done_note   TEXT NOT NULL DEFAULT '',
        sent_at     TEXT,
        last_run_id BIGINT,
        sort        INTEGER NOT NULL DEFAULT 0,
        updated_by  TEXT,
        updated_at  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_audit_items_domain ON audit_items(domain, section)",
    """CREATE TABLE IF NOT EXISTS audit_runs (
        id             BIGSERIAL PRIMARY KEY,
        item_id        BIGINT NOT NULL,
        run_at         TEXT,
        prompt_snapshot TEXT NOT NULL DEFAULT '',
        result_text    TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL DEFAULT 'pending',
        approved_by    TEXT,
        approved_at    TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_audit_runs_item ON audit_runs(item_id)",
    # ── LEGAL PORTAL · sections + note threads (private, Raz ↔ the 3 owners) ──────
    #    The legal counsel (Raz) opens titled SECTIONS for the owners — one per topic
    #    (a correction / an issue / a question). Each section carries an opening body
    #    and holds a NOTE THREAD: Raz writes notes, and the owners READ and REPLY back
    #    in the same thread. `status` lets a topic be closed (open | resolved). This is
    #    the legal-portal's own store — deliberately SEPARATE from the help-desk
    #    `requests` tables so the two portals never cross-contaminate. Created here (not
    #    only in _SCHEMA) so both tables land on the EXISTING prod DB on the next boot —
    #    same mechanism as requests / pm_tasks / legal_texts. ──
    """CREATE TABLE IF NOT EXISTS legal_sections (
        id           BIGSERIAL PRIMARY KEY,
        title        TEXT NOT NULL DEFAULT '',
        body         TEXT NOT NULL DEFAULT '',       -- opening description of the section
        status       TEXT NOT NULL DEFAULT 'open',    -- open | resolved
        created_by   TEXT,                            -- author username
        created_name TEXT,                            -- display name at creation time
        sort         INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_legal_sections_status ON legal_sections(status)",
    """CREATE TABLE IF NOT EXISTS legal_notes (
        id          BIGSERIAL PRIMARY KEY,
        section_id  BIGINT NOT NULL REFERENCES legal_sections(id) ON DELETE CASCADE,
        author_id   TEXT,
        author_name TEXT,
        body        TEXT NOT NULL,
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_legal_notes_section ON legal_notes(section_id)",
    # ── LEGAL PORTAL · private chat room (Raz ↔ the 3 owners) ─────────────────────
    #    ONE shared room for the whole portal — a real running chat, not a per-topic
    #    thread. The audience IS the portal gate (owner OR legal_editor), so there is
    #    no per-room membership to keep in sync as owner grants change: every message
    #    is visible to everyone who can open the portal. Polled by `since_id` (id ASC),
    #    the same incremental pattern the in-app chat uses. Lands on the existing prod
    #    DB on next boot — same mechanism as the sections/notes tables above. ──
    """CREATE TABLE IF NOT EXISTS legal_chat (
        id          BIGSERIAL PRIMARY KEY,
        author_id   TEXT,
        author_name TEXT,
        body        TEXT NOT NULL,
        created_at  TEXT NOT NULL
    )""",
    # ── COLLABORATOR PORTALS · domain scoping ────────────────────────────────────
    #    The sections/notes/chat store is shared by the domain-parameterised collaborator
    #    portals: 'legal' (Raz) and 'it' (Oren). A `domain` column partitions the rows so
    #    each portal sees only its own sections + chat. Existing rows default to 'legal', so
    #    the Legal Portal keeps working byte-for-byte. Notes inherit their section's domain
    #    (they're always fetched via a section_id), so only sections + chat carry the column.
    "ALTER TABLE legal_sections ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'legal'",
    "ALTER TABLE legal_chat ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'legal'",
    "CREATE INDEX IF NOT EXISTS idx_legal_sections_domain ON legal_sections(domain)",
    "CREATE INDEX IF NOT EXISTS idx_legal_chat_domain ON legal_chat(domain)",
    # ── IT PORTAL · "ניהול ועריכה" store (Oren) ──────────────────────────────────
    #    The IT portal's editing tab has no pre-existing store (legal reuses legal_texts). Two
    #    tables back it: it_docs = editable IT notes/documentation entries; it_links = the
    #    "link your system to us" area where Oren records links/connections/references for the
    #    owners to see. Both land on the existing prod DB next boot, same mechanism as above.
    """CREATE TABLE IF NOT EXISTS it_docs (
        id          BIGSERIAL PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS it_links (
        id          BIGSERIAL PRIMARY KEY,
        label       TEXT NOT NULL DEFAULT '',
        url         TEXT NOT NULL DEFAULT '',
        note        TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    # ── BIZ-DEV PORTAL · "מסמכים וחומרים / קישורים ומקורות" store (Raful) ──────────
    #    Mirrors the IT store (it_docs/it_links) but for BUSINESS-DEVELOPMENT content, and
    #    biz_docs ADDS an optional real uploaded FILE per doc (PDF/image/deck). Files use the
    #    same base64-in-TEXT mechanism as user avatars (users.avatar): the file is stored as a
    #    data-URL in file_data (kept OUT of the list query — fetched only on download), with
    #    file_name / file_type / file_size metadata. body stays for long-form rich description.
    #    NOTE: this is DB-TEXT blob storage (fine for modest PDFs/decks); true large-scale or
    #    high-volume binary storage would want an object store (see the report note).
    """CREATE TABLE IF NOT EXISTS biz_docs (
        id          BIGSERIAL PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        body        TEXT NOT NULL DEFAULT '',
        file_name   TEXT NOT NULL DEFAULT '',
        file_type   TEXT NOT NULL DEFAULT '',
        file_data   TEXT NOT NULL DEFAULT '',
        file_size   INTEGER NOT NULL DEFAULT 0,
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS biz_links (
        id          BIGSERIAL PRIMARY KEY,
        label       TEXT NOT NULL DEFAULT '',
        url         TEXT NOT NULL DEFAULT '',
        note        TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    # ── PM task comments — owners give direction/feedback on ANY task (incl. the collaborators'
    #    Raz/Oren tasks); the task's assigned partner can reply on their OWN task. A simple
    #    threaded note (author + text + ts). Owner comments also surface in the Owners Daily
    #    Report. Lands on the existing prod DB next boot, same mechanism as the tables above.
    """CREATE TABLE IF NOT EXISTS pm_task_comments (
        id          BIGSERIAL PRIMARY KEY,
        task_id     BIGINT NOT NULL,
        author      TEXT,
        author_name TEXT,
        text        TEXT NOT NULL,
        created_at  TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_pm_task_comments_task ON pm_task_comments(task_id)",
    # Per-user LEGAL-EDITOR grant — lets the main admin give the legal counsel (e.g. Raz)
    # edit access to the Legal Console WITHOUT making her a full admin. The main admin always
    # has it implicitly (see is_legal_editor). Additive boolean, defaults off.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS legal_editor BOOLEAN NOT NULL DEFAULT FALSE",
    # Per-user CONTENT-EDITOR grant — lets the main admin give a creative partner (e.g. Yoav)
    # access to the content editors (Reels now; Courses/University next) WITHOUT full admin.
    # Same pattern as legal_editor. Any full admin also qualifies (see is_content_editor).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS content_editor BOOLEAN NOT NULL DEFAULT FALSE",
    # Per-user OWNER grant — lets the main admin give a partner (e.g. Rafi/Yoav) product-OWNER
    # status (the Owners Portal + the full Requests portal) WITHOUT them being on the static
    # OWNER allowlist. The main admin / allowlisted owners always qualify (see security.is_owner).
    # Same additive-boolean pattern as legal_editor / content_editor; defaults off.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_flag BOOLEAN NOT NULL DEFAULT FALSE",
    # Per-user IT-EDITOR grant — mirrors legal_editor, for the IT collaborator (Oren). Gives
    # access to his private IT portal (chat ↔ owners / notes / system links / tasks / report)
    # WITHOUT being a full admin. An OWNER always qualifies (see is_it_editor). Additive, off.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS it_editor BOOLEAN NOT NULL DEFAULT FALSE",
    # Oren is an IT COLLABORATOR, not a full admin: he must see ONLY his IT portal — NOT user
    # management, system & bots, the Owners interface, or Finance. Idempotently demote his
    # legacy admin role and grant the it_editor flag. Guarded so it never touches the seeded
    # main admin or an owner-flagged/allowlisted account. (Finance was already owner-only.)
    "UPDATE users SET role = 'user' WHERE username = 'oren' AND COALESCE(is_main, FALSE) = FALSE AND COALESCE(owner_flag, FALSE) = FALSE",
    "UPDATE users SET it_editor = TRUE WHERE username = 'oren'",
    # Per-user BIZ-DEV-EDITOR grant — mirrors it_editor, for the business-development collaborator
    # (Raful). Gives access to his private /biz-portal WITHOUT being a full admin. Owner always
    # qualifies (see is_biz_editor). Additive, off. Idempotently grant it to raful (like Oren).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS biz_editor BOOLEAN NOT NULL DEFAULT FALSE",
    "UPDATE users SET biz_editor = TRUE WHERE username = 'raful'",
    # ── PER-USER exchange protection code (PIN) ──────────────────────────────────
    #    The live-trading PIN is a per-user second factor (exchange keys + orders are
    #    already per-user), so it lives on the user row — NEVER a global singleton. Empty
    #    = no PIN set (pinSet=false). Existing installs migrate to '' (the old global PIN
    #    can't be un-hashed per-user), so each user sets a fresh code.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS exchange_pin_hash TEXT NOT NULL DEFAULT ''",
    # ── Owners Portal · project-management board (Phase 2) ───────────────────────
    #    A task on the roadmap toward launch. `partner` groups it to a partner
    #    (dan/rafi/yoav/oren/raz); `assignee` is the owning username (usually the same
    #    id). `impl_status` is an honest implementation slug (not_started | scaffolded |
    #    blocked_external | in_review | live). `phase` maps to the roadmap phases in
    #    owners.ts (p0..p3). Owners/admins manage everything; a partner may update
    #    progress/notes/status on their OWN tasks. `key` is a stable seed id so the
    #    starter set seeds ONCE and idempotently (edits/reassignments persist). Created
    #    here (not only in _SCHEMA) so it lands on the EXISTING production DB next boot.
    """CREATE TABLE IF NOT EXISTS pm_tasks (
        id           BIGSERIAL PRIMARY KEY,
        key          TEXT UNIQUE,                           -- stable seed key; NULL for user-created
        title_he     TEXT NOT NULL DEFAULT '',
        title_en     TEXT NOT NULL DEFAULT '',
        assignee     TEXT,                                  -- owning username
        partner      TEXT,                                  -- partner id (dan/rafi/yoav/oren/raz)
        status       TEXT NOT NULL DEFAULT 'todo',          -- todo | in_progress | blocked | done
        progress     INTEGER NOT NULL DEFAULT 0,            -- 0..100
        notes        TEXT NOT NULL DEFAULT '',
        impl_status  TEXT NOT NULL DEFAULT '',              -- not_started|scaffolded|blocked_external|in_review|live
        phase        TEXT,                                  -- roadmap phase id (p0..p3)
        category     TEXT,                                  -- freeform grouping
        sort         INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT,
        updated_by   TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_pm_tasks_assignee ON pm_tasks(assignee)",
    "CREATE INDEX IF NOT EXISTS idx_pm_tasks_partner ON pm_tasks(partner)",
    # Multi-partner assignment (Phase 3 refinement): a task may belong to SEVERAL partners.
    # `partners` is a CSV of partner ids (e.g. "oren,raz"); the legacy single `partner`
    # column is kept as the PRIMARY (first) partner for backward compatibility + the board
    # fallback. Membership queries wrap the CSV in commas and match `,pid,`. Additive column
    # → existing single-partner rows keep working (partners NULL ⇒ falls back to partner).
    "ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS partners TEXT",
    # Full task edit (PM board enhancement): a freeform DESCRIPTION/detail for the task,
    # distinct from `notes` (which reads as short progress notes). Additive, defaults empty.
    "ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS detail TEXT NOT NULL DEFAULT ''",
    # SUB-TASKS as a JSON checklist on the task: [{id:int, title:str, done:bool}]. JSON keeps
    # a lightweight checklist in one row (no join); ids are per-task ints (max+1). Additive.
    "ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS subtasks JSONB NOT NULL DEFAULT '[]'::jsonb",
    # Priority (shared scheme with finance investments): none | red (חשוב/important) |
    # orange (לדיון/for discussion) | green (מאושר/approved). A chosen priority raises the task
    # to the TOP of the board (red→orange→green→none), then the existing sort/phase/id order.
    "ALTER TABLE pm_tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'none'",
    # Per-partner headline GOAL (one editable row per partner). Bilingual HE/EN.
    """CREATE TABLE IF NOT EXISTS pm_goals (
        partner      TEXT PRIMARY KEY,                      -- dan/rafi/yoav/oren/raz
        goal_he      TEXT NOT NULL DEFAULT '',
        goal_en      TEXT NOT NULL DEFAULT '',
        updated_at   TEXT,
        updated_by   TEXT
    )""",
    # ── Owners Portal · VOTING (Phase 3) ─────────────────────────────────────────
    #    One vote per voter per votable item. `item_key` is the stable id the app
    #    votes by ("screen:home" | "decision:skins" | "task:{id}"); `item_type` is
    #    the group (screen | decision | task). `vote` is approve | change | reject.
    #    UNIQUE (item_key, voter) → the owner upserts on re-vote so a voter changes
    #    their mind in place (one voice per item). Owners/admins cast; owners/partners
    #    read the tallies + results. The results rollup feeds continued work — a
    #    change/reject item can spawn a pm_tasks row (key `vote:{item_key}`) so the
    #    outcome flows onto the board, and Phase 4's daily summary reads the same rows.
    #    Created here (not only _SCHEMA) so it lands on the EXISTING prod DB next boot. ──
    """CREATE TABLE IF NOT EXISTS votes (
        id         BIGSERIAL PRIMARY KEY,
        item_key   TEXT NOT NULL,                           -- screen:home | decision:skins | task:{id}
        item_type  TEXT NOT NULL DEFAULT 'screen',          -- screen | decision | task
        voter      TEXT NOT NULL,                           -- voter username
        vote       TEXT NOT NULL,                           -- approve | change | reject | option | abstain
        comment    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        UNIQUE (item_key, voter)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_votes_item ON votes(item_key)",
    # DECISIONS are a real multiple-choice pick, not thumbs up/down: `choice` holds the
    # chosen OPTION id (e.g. "navy", "growth") when vote='option'. Additive + nullable →
    # existing screen approve/change/reject rows keep working (choice NULL). Lands on the
    # existing prod DB on next boot.
    "ALTER TABLE votes ADD COLUMN IF NOT EXISTS choice TEXT",
    # ── University / Learn content store (content_editor-managed) ────────────────
    #    The Courses/University "Explanations" content, made editable in-app (mirrors the
    #    reels_lessons editor). ONE row per content item; `section` groups them
    #    (getting_started | concepts | glossary). Bilingual title + body (body is plain
    #    text; for a multi-paragraph concept, paragraphs are separated by a blank line).
    #    `icon` is a lucide key (concepts only). Empty store → the app renders the built-in
    #    lib/uni.ts content (so nothing is ever lost); a content_editor imports the built-in
    #    to start editing. Created here (not only _SCHEMA) so it lands on prod next boot.
    """CREATE TABLE IF NOT EXISTS university_items (
        id         BIGSERIAL PRIMARY KEY,
        section    TEXT NOT NULL DEFAULT 'concepts',   -- getting_started | concepts | glossary
        icon       TEXT NOT NULL DEFAULT '',           -- lucide key (concepts)
        title_he   TEXT NOT NULL DEFAULT '',
        title_en   TEXT NOT NULL DEFAULT '',
        body_he    TEXT NOT NULL DEFAULT '',
        body_en    TEXT NOT NULL DEFAULT '',
        position   INTEGER NOT NULL DEFAULT 0,
        published  BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TEXT,
        updated_by TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_university_section ON university_items(section, position)",
    # ── Owners Portal · FINANCE (owner-only business finance store) ──────────────
    #    Manual entry by product OWNERS (Dan/Rafi/Yoav) — no exchange auto-pull in v1.
    #    Four tables; cash-flow is DERIVED in the endpoint (revenue in vs expenses out per
    #    month). Created here (not only _SCHEMA) so they land on the EXISTING prod DB on
    #    the next boot. Amounts are NUMERIC (money); currency defaults to USD.
    """CREATE TABLE IF NOT EXISTS finance_budget_lines (
        id          BIGSERIAL PRIMARY KEY,
        scope       TEXT NOT NULL DEFAULT 'month',       -- month | forward (project budget by timeline)
        period      TEXT NOT NULL DEFAULT '',            -- '2026-07' (month) | '2026-Q3' | 'H2-2026'
        category    TEXT NOT NULL DEFAULT '',            -- infra | legal | marketing | salaries | …
        label       TEXT NOT NULL DEFAULT '',
        planned     NUMERIC(14,2) NOT NULL DEFAULT 0,
        actual      NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency    TEXT NOT NULL DEFAULT 'USD',
        notes       TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_fin_budget_scope ON finance_budget_lines(scope, period)",
    """CREATE TABLE IF NOT EXISTS finance_expenses (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT '',
        amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        category    TEXT NOT NULL DEFAULT '',
        currency    TEXT NOT NULL DEFAULT 'USD',
        due_date    TEXT NOT NULL DEFAULT '',            -- 'YYYY-MM-DD'
        status      TEXT NOT NULL DEFAULT 'planned',     -- planned | pending | paid | overdue | cancelled
        recurring   TEXT NOT NULL DEFAULT '',            -- '' | monthly | quarterly | yearly
        notes       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_fin_expenses_status ON finance_expenses(status)",
    """CREATE TABLE IF NOT EXISTS finance_wallets (
        id          BIGSERIAL PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT '',
        balance     NUMERIC(16,2) NOT NULL DEFAULT 0,
        currency    TEXT NOT NULL DEFAULT 'USD',
        kind        TEXT NOT NULL DEFAULT 'bank',        -- bank | crypto | cash | card | other
        notes       TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    """CREATE TABLE IF NOT EXISTS finance_revenue (
        id          BIGSERIAL PRIMARY KEY,
        period      TEXT NOT NULL DEFAULT '',            -- 'YYYY-MM'
        label       TEXT NOT NULL DEFAULT '',
        amount      NUMERIC(14,2) NOT NULL DEFAULT 0,    -- forecast revenue for that month
        currency    TEXT NOT NULL DEFAULT 'USD',
        notes       TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_fin_revenue_period ON finance_revenue(period)",
    #    Investments — initial or additional capital, its source, and (optionally) the
    #    owner it's tied to (partner id dan/rafi/yoav; '' = company/unattributed).
    """CREATE TABLE IF NOT EXISTS finance_investments (
        id          BIGSERIAL PRIMARY KEY,
        amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        kind        TEXT NOT NULL DEFAULT 'initial',     -- initial | additional
        source      TEXT NOT NULL DEFAULT '',            -- where the funds came from (free text)
        inv_date    TEXT NOT NULL DEFAULT '',            -- 'YYYY-MM-DD'
        owner       TEXT NOT NULL DEFAULT '',            -- linked owner id (dan/rafi/yoav) | '' = company
        currency    TEXT NOT NULL DEFAULT 'USD',
        notes       TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_fin_investments_owner ON finance_investments(owner)",
    # Classification of what the money is FOR — ongoing expenses vs a company investment vs
    # a share/equity purchase vs working capital vs other. Additive; existing rows default
    # to 'other' (unclassified) until an owner edits them.
    "ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'other'",
    # Priority (SAME scheme as pm_tasks): none | red (חשוב) | orange (לדיון) | green (מאושר).
    "ALTER TABLE finance_investments ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'none'",
    # ── EMPLOYEE MANAGEMENT (Phase 1) ────────────────────────────────────────────
    #    One row per team member, keyed to their username (resolves to a PM partner id for
    #    task linkage). Owner-managed (role/domains/status/salary/portal) + self-edited by the
    #    employee (birthday/contact/sub-account/wallet). Lands on the existing prod DB next boot.
    """CREATE TABLE IF NOT EXISTS employees (
        username            TEXT PRIMARY KEY,
        full_name           TEXT NOT NULL DEFAULT '',       -- display name (a new hire may have no login account yet)
        role                TEXT NOT NULL DEFAULT '',       -- job role (free text, e.g. מנהל פיתוח עסקי)
        work_domains        TEXT NOT NULL DEFAULT '',       -- CSV of domain tags
        status              TEXT NOT NULL DEFAULT 'active',  -- active | onboarding | paused
        join_date           TEXT NOT NULL DEFAULT '',
        birthday            TEXT NOT NULL DEFAULT '',        -- self-edited
        contact             TEXT NOT NULL DEFAULT '',        -- self-edited (phone/email/free text)
        subaccount_details  TEXT NOT NULL DEFAULT '',        -- self-edited (exchange sub-account info)
        monthly_salary      NUMERIC(14,2) NOT NULL DEFAULT 0,
        bonus_account_flag  BOOLEAN NOT NULL DEFAULT FALSE,  -- enrolled in the bonus program / paid to bonus account
        has_portal          BOOLEAN NOT NULL DEFAULT FALSE,  -- has a private collaborator portal
        wallet_address      TEXT NOT NULL DEFAULT '',        -- wallet the employee sent to the owners (bonus program)
        created_at          TEXT NOT NULL,
        updated_at          TEXT,
        updated_by          TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status)",
    # full_name added after the initial employees table shipped — ALTER so existing installs get it.
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''",
    # ── Bonus / sub-account trading program (Phase 3) — records & tracking only, NO money moves.
    #    status: none | requested (employee asked to join) | active (owner approved) | paused.
    #    initial_deposit = the owners' loan the owner recorded (linked to a finance_investments
    #    row via deposit_investment_id, purpose='owner_loan'). trading_pnl = manual owner figure.
    #    Bonus accrual is DERIVED from the employee_payments ledger (type='bonus'), not stored.
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS bonus_program_status TEXT NOT NULL DEFAULT 'none'",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS initial_deposit NUMERIC(14,2) NOT NULL DEFAULT 0",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS deposit_investment_id BIGINT",
    "ALTER TABLE employees ADD COLUMN IF NOT EXISTS trading_pnl NUMERIC(14,2) NOT NULL DEFAULT 0",
    # Per-employee payments ledger — records only (owner approval; NO real money movement in
    # Phase 1). Phase 2 feeds Finance/budget, so the shape mirrors the finance ledgers.
    """CREATE TABLE IF NOT EXISTS employee_payments (
        id          BIGSERIAL PRIMARY KEY,
        username    TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'salary',  -- salary | bonus | expense | addition
        amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency    TEXT NOT NULL DEFAULT 'USD',
        pay_date    TEXT NOT NULL DEFAULT '',         -- 'YYYY-MM-DD'
        status      TEXT NOT NULL DEFAULT 'pending',  -- paid | pending
        note        TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT,
        updated_by  TEXT
    )""",
    "CREATE INDEX IF NOT EXISTS idx_employee_payments_user ON employee_payments(username)",
    # ── AutoPilots REAL-MONEY (Bybit) — heavily-safeguarded, GATED, owner-only ──
    # Per-pilot execution mode. DEFAULT 'simulation'. A pilot NEVER runs live unless the
    # owner explicitly completes the multi-step GO-LIVE flow (which flips this to 'live').
    "ALTER TABLE autopilot_armed ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'simulation'",
    # MANDATORY starting-capital cap for the first live run (owner-set, low max enforced in
    # code). The live executor NEVER deploys more than this across the pilot's live positions.
    "ALTER TABLE autopilot_armed ADD COLUMN IF NOT EXISTS live_cap DOUBLE PRECISION",
    "ALTER TABLE autopilot_armed ADD COLUMN IF NOT EXISTS live_started_at TEXT",
    # Live positions get a real exchange order id + fees stamped so the audit reconciles.
    "ALTER TABLE autopilot_sim_positions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'simulation'",
    "ALTER TABLE autopilot_sim_positions ADD COLUMN IF NOT EXISTS order_id TEXT",
    # Owner's OWN Bybit API keys for AutoPilots — encrypted at rest (Fernet / SESSION_SECRET,
    # the SAME scheme as exchange_creds_backup). NEVER logged, NEVER returned raw to the client.
    # Isolated from the main exchange config so the live executor has an explicit key source.
    """CREATE TABLE IF NOT EXISTS autopilot_exchange_keys (
        username     TEXT PRIMARY KEY,
        exchange     TEXT NOT NULL DEFAULT 'bybit',
        environment  TEXT NOT NULL DEFAULT 'testnet',   -- 'testnet' | 'live'
        enc_key      TEXT NOT NULL DEFAULT '',          -- Fernet ciphertext
        enc_secret   TEXT NOT NULL DEFAULT '',          -- Fernet ciphertext
        connected    BOOLEAN NOT NULL DEFAULT FALSE,
        last_test_at   TEXT,
        last_test_ok   BOOLEAN,
        last_test_msg  TEXT,
        created_at   TEXT,
        updated_at   TEXT
    )""",
    # Append-only audit trail for EVERY live action (connect/disconnect keys, go-live,
    # stop-live, order attempt/placed/failed/skipped). `detail` NEVER contains secrets.
    """CREATE TABLE IF NOT EXISTS autopilot_live_audit (
        id        BIGSERIAL PRIMARY KEY,
        username  TEXT NOT NULL,
        pilot_id  TEXT,
        action    TEXT NOT NULL,       -- keys_connected | keys_disconnected | go_live |
                                       -- stop_live | order_attempt | order_placed |
                                       -- order_failed | order_skipped | mark
        detail    JSONB,
        at        TEXT NOT NULL
    )""",
    "CREATE INDEX IF NOT EXISTS idx_ap_audit_user ON autopilot_live_audit(username, at DESC)",
    # ── LAYOUT / LOCATION prefs · owners set the DEFAULT (or per-role) screen layout and
    #    every user can save their OWN override. One row per (scope, screen). `scope` is
    #    'default' (everyone), 'role:<role>' (a role's default), or 'user:<username>' (a
    #    personal override). `arrangement` is the tile/shortcut plan: {"order":[ids…],
    #    "hidden":[ids…]} — which buttons show + in which order. Resolution at render is
    #    user → role → default → the code's built-in order. Safety-critical controls are
    #    NEVER stored here (they render outside the editable grids and locked ids are force-
    #    shown client-side), so a hidden[] can never suppress a money/disclosure control.
    #    Created here (not only _SCHEMA) so it lands on the EXISTING prod DB on boot —
    #    same mechanism as legal_copy / audit_items / exchange_creds_backup. ──
    """CREATE TABLE IF NOT EXISTS layout_prefs (
        scope       TEXT NOT NULL,        -- 'default' | 'role:<role>' | 'user:<username>'
        screen_key  TEXT NOT NULL,
        arrangement JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_by  TEXT,
        updated_at  TEXT,
        PRIMARY KEY (scope, screen_key)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_layout_prefs_screen ON layout_prefs(screen_key)",
    # ── TOTP (RFC 6238) authenticator-app login factor ───────────────────────────
    #    A high-security, ZERO-cost second factor: the code is generated on the
    #    user's device (Google Authenticator / Authy), nothing is sent per login.
    #    `totp_secret` is the base32 shared secret; `totp_enabled` flips true only
    #    after the user proves the app is set up (confirms one code). `totp_last_step`
    #    is the last accepted 30-second time-step — a replay guard so the same code
    #    can't be used twice. When TOTP is on it is the PRIMARY factor; the
    #    Telegram/email OTP becomes the lost-device RECOVERY path.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT NOT NULL DEFAULT 0",
    # ── MANAGEMENT SYSTEM (SheraCore pattern) · P2.1 — projects + role_scopes ─────
    #    Owner-approved 2026-07-16 (the /mgmt-…/ mapping page): every work domain is a
    #    first-class PROJECT, and access inside a project is a per-user SCOPED role
    #    granted by an owner. This slice is DDL ONLY — no screen changes, no permission
    #    behavior changes, and nothing here touches money, execution, or exchange keys.
    #    Existing guards (require_owner / require_it_editor / …) keep working unchanged;
    #    the console UI (P2.2) and the boundary alignment (P2.3) build ON TOP of this.
    """CREATE TABLE IF NOT EXISTS projects (
        id          BIGSERIAL PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,              -- stable id: execution | owners-fund | legal | content
        name_he     TEXT NOT NULL DEFAULT '',
        name_en     TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'active',    -- active | paused | archived
        owner_only  BOOLEAN NOT NULL DEFAULT FALSE,    -- TRUE = layer-3 (owners) only, e.g. the shared fund
        sort        INTEGER NOT NULL DEFAULT 0,
        created_by  TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT '',
        updated_at  TEXT,
        updated_by  TEXT,
        CONSTRAINT projects_status_known CHECK (status IN ('active','paused','archived'))
    )""",
    # Scoped membership: user ↔ project with a role INSIDE that project. A row is created
    # ONLY by an owner's explicit click in the Team panel (P2.2) — never seeded here, never
    # auto-granted. Roles: operator (runs the project's machine) | editor (works in it) |
    # viewer (reads it). Owners need no rows (layer 3 sees everything by definition), and
    # owner_only projects REQUIRE layer 3 regardless of any row in this table.
    """CREATE TABLE IF NOT EXISTS role_scopes (
        id          BIGSERIAL PRIMARY KEY,
        username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
        project_id  BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_role  TEXT NOT NULL DEFAULT 'viewer',    -- operator | editor | viewer
        granted_by  TEXT NOT NULL DEFAULT '',          -- the OWNER who clicked the grant
        created_at  TEXT NOT NULL DEFAULT '',
        updated_at  TEXT,
        CONSTRAINT role_scopes_role_known CHECK (scope_role IN ('operator','editor','viewer')),
        UNIQUE (username, project_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_role_scopes_project ON role_scopes(project_id)",
    # The FIRST PROJECTS, exactly the list Dan approved on the mapping page (§3.2) —
    # idempotent seed (ON CONFLICT DO NOTHING): re-boot never duplicates or resets edits.
    # Seeding a PROJECT grants nobody access; role_scopes stays empty until owners grant.
    """INSERT INTO projects (slug, name_he, name_en, description, owner_only, sort, created_by, created_at)
       VALUES
         ('execution',   'שירות הביצוע',   'StrateTeach-Execution', 'Project #1 — the isolated execution service (Phase 1)', FALSE, 1, 'owners-approval-2026-07-16', NOW()::text),
         ('owners-fund', 'הקרן המשותפת',   'Owners Fund',           'The owners'' shared fund — owner-only, 3-of-3',          TRUE,  2, 'owners-approval-2026-07-16', NOW()::text),
         ('legal',       'משפטי ורישוי',   'Legal & Licensing',     'Legal / licensing / provenance workstream',              FALSE, 3, 'owners-approval-2026-07-16', NOW()::text),
         ('content',     'תוכן ושיווק',    'Content & Marketing',   'Content / marketing workstream',                          FALSE, 4, 'owners-approval-2026-07-16', NOW()::text)
       ON CONFLICT (slug) DO NOTHING""",
    # Access-layer alignment (0–3) as a VIEW — DERIVED from the existing flags so there is
    # exactly one source of truth (no duplicate layer column that can drift out of sync):
    #   3 = owner (owner_flag / is_main) · 2a = execution operator (it_editor) ·
    #   2b = team (legal/content/biz editor) · 1 = client (any other login).
    #   Layer 0 (demo/public) has no user row, so it does not appear here.
    """CREATE OR REPLACE VIEW user_access_layers AS
       SELECT username,
              CASE
                WHEN COALESCE(owner_flag, FALSE) OR COALESCE(is_main, FALSE) THEN '3_owner'
                WHEN COALESCE(it_editor, FALSE) THEN '2a_execution_operator'
                WHEN COALESCE(legal_editor, FALSE) OR COALESCE(content_editor, FALSE)
                     OR COALESCE(biz_editor, FALSE) THEN '2b_team'
                ELSE '1_client'
              END AS access_layer
         FROM users""",
    # ── Phase 2C (Option A) · M1 — immutable identity root (user_uid) ──────────────────────
    # The Praxis-provisioning bridge derives st_ref from an IMMUTABLE, never-recycled surrogate,
    # NOT from the recyclable `username` PK (the audited root-cause fix). Single-statement add so the
    # volatile default fills every existing row atomically in the table rewrite; UNIQUE guards
    # collisions; IF NOT EXISTS makes re-boots a no-op. gen_random_uuid() is core on PG13+ (this
    # deploy is PG16). Validated idempotent (runs clean on the 2nd boot) against the live DB.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS user_uid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()",
    # Immutability guard (UPDATE only). We deliberately do NOT enforce on INSERT: an insert-side trigger
    # that force-generates or rejects a supplied user_uid would corrupt a `pg_restore` (its COPY fires the
    # trigger and would regenerate/refuse the original uids, shattering every Praxis st_ref→identity link).
    # The insert-supplied-uid path is instead non-exploitable by construction: (a) no app code ever writes
    # user_uid (guard test tests/test_user_uid_invariant.py), (b) UNIQUE rejects reuse of a LIVE uid, and
    # (c) identity inheritance needs a *provisioned* uid — provisioned users are soft-deleted (M3, uid stays
    # in the table → UNIQUE blocks reuse) while non-provisioned users have no Praxis identity to inherit.
    """CREATE OR REPLACE FUNCTION prevent_user_uid_change() RETURNS trigger AS $$
BEGIN
  IF NEW.user_uid IS DISTINCT FROM OLD.user_uid THEN
    RAISE EXCEPTION 'user_uid is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql""",
    # DROP+CREATE (not CREATE OR REPLACE TRIGGER, which is PG14+ and would hard-brick boot on older PG):
    # idempotent under the per-boot runner and version-portable. ENABLE ALWAYS so immutability still fires
    # under session_replication_role='replica' (logical-replication apply / restore); UPDATE-only, so a
    # restore's INSERT/COPY path is unaffected.
    "DROP TRIGGER IF EXISTS trg_user_uid_immutable ON users",
    """CREATE TRIGGER trg_user_uid_immutable BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION prevent_user_uid_change()""",
    "ALTER TABLE users ENABLE ALWAYS TRIGGER trg_user_uid_immutable",
    # ── Phase 2C (Option A) · M3 — StrateTeach→Praxis identity mapping columns ─────────────────
    # praxis_user_id = the mapped Praxis auth.users id (TEXT UUID), set once by /praxis/link (idempotent,
    # only when NULL). UNIQUE so no two StrateTeach users can map to one Praxis identity (many NULLs OK).
    # praxis_env = highest env the OPERATOR approved for this user ('none'|'testnet'|'mainnet'); the mainnet
    # ticket gate reads it. Never elevated by the user. praxis_linked_at = provisioning timestamp.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS praxis_user_id TEXT UNIQUE",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS praxis_env TEXT NOT NULL DEFAULT 'none' CHECK (praxis_env IN ('none','testnet','mainnet'))",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS praxis_linked_at TEXT",
)


def bootstrap() -> None:
    """Create tables if missing, run column migrations, seed a default admin."""
    with get_conn() as conn:
        conn.execute(_SCHEMA)
        for stmt in _MIGRATIONS:
            conn.execute(stmt)
    _seed_default_admin()
    _backfill_plans()
    _backfill_runs_log()
    _backfill_runs_saved()
    _backfill_feedback_requests()
    _seed_legal_texts()
    _seed_legal_copy()
    _seed_audit_items()
    _backfill_audit_first_run()
    _seed_pm()
    _seed_employees()
    _normalize_employee_roster()
    _backfill_pm_audit()
    _backfill_legal_drafts()
    _stamp_session_cutoff_if_maintenance()
    _seed_demo_accounts()


def _seed_demo_accounts() -> None:
    """Idempotently ensure the two labelled DEMO preview accounts exist so an
    owner can log in as each after any deploy — no manual server step. Fast NO-OP
    once both exist (see demo_seed.seed). Never blocks boot: any failure is
    swallowed exactly like the other startup seeds. Lazy import avoids a cycle."""
    try:
        # SECURITY (partner-pilot hardening): the demo accounts include a role='admin' STAFF login whose
        # default password is REPO-KNOWN (demo_seed.STAFF_PW). Seeding by default stands up a guessable
        # admin on every deploy — a takeover vector the moment a second (partner) user shares the instance.
        # Gate seeding behind DEMO_SEED_ENABLED (default OFF / fail-closed). Local dev + demo environments
        # opt in explicitly; production pilots stay clean. Any demo rows from earlier boots are removed or
        # password-rotated operator-side.
        if os.environ.get("DEMO_SEED_ENABLED", "false").strip().lower() != "true":
            return
        from app.services import demo_seed
        demo_seed.seed(force=False)
    except Exception:  # noqa: BLE001 — demo seeding must never fail a boot
        return


def _backfill_runs_saved() -> None:
    """One-time, idempotent: grandfather every pre-existing run to saved=TRUE.

    The `saved` column ships defaulting FALSE, but runs created before the
    ephemeral-by-default change were auto-persisted (effectively "saved"), so
    without this they'd vanish from the history list. Guarded by a singleton flag
    so it runs exactly once — later restarts must NOT re-flag user-discarded
    (unsaved) runs back to saved."""
    if _get_singleton("runs_saved_backfill_done", False):
        return
    try:
        execute("UPDATE runs SET saved = TRUE")
    except Exception:  # noqa: BLE001 — best-effort; never block boot
        return
    _set_singleton("runs_saved_backfill_done", True)


def _stamp_session_cutoff_if_maintenance() -> None:
    """One-time on boot: if the app is already in maintenance and no disconnect
    cutoff has been recorded yet, stamp it now so existing NON-admin sessions are
    actively logged out (not just blocked on their next action). This covers the
    current locked-down state, where maintenance was turned on before this gate
    existed. Idempotent: it only stamps when the cutoff is unset, so it never
    re-kicks on later restarts. Admins are never affected. Best-effort — must never
    block boot."""
    try:
        if get_nonadmin_session_cutoff() is None and get_maintenance():
            bump_nonadmin_session_cutoff()
    except Exception:  # noqa: BLE001
        return


def _backfill_plans() -> None:
    """Friends-and-family testing policy: ONLY admins get full (Pro) access;
    everyone else starts on Basic and must request access (or pay) to upgrade.
    Runs once via a singleton flag."""
    if _get_singleton("plan_basic_v2_done", False):
        return
    with get_conn() as conn:
        conn.execute("UPDATE users SET plan = 'basic' WHERE role <> 'admin'")
        conn.execute("UPDATE users SET plan = 'pro' WHERE role = 'admin'")
    _set_singleton("plan_basic_v2_done", True)


def _backfill_runs_log() -> None:
    """One-time, idempotent: seed runs_log from already-CLOSED demo paper positions
    so the report shows historical demo runs (duration + result), not only new ones.

    Idempotent by stamping the created runId onto each position; positions that
    already carry a runId (forward-logged or previously backfilled) are skipped.
    Only clean rows (with both openedAt and closedAt) are imported. Best-effort —
    never raises, so it can't block boot."""
    try:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT pp.id AS pid, pp.data AS pdata, ps.data AS sdata "
                "FROM paper_positions pp JOIN paper_sessions ps ON ps.id = pp.session_id "
                "WHERE pp.status <> 'open'"
            ).fetchall()
            for r in rows:
                pdata = dict(r.get("pdata") or {})
                if pdata.get("runId"):
                    continue
                opened, closed = pdata.get("openedAt"), pdata.get("closedAt")
                if not opened or not closed:
                    continue
                sdata = dict(r.get("sdata") or {})
                owner = sdata.get("owner")
                source = "auto" if str(sdata.get("label") or "").startswith("Auto ") else "manual"
                try:
                    entry = float(pdata["entryPrice"]) if pdata.get("entryPrice") else None
                    exitp = float(pdata["closePrice"]) if pdata.get("closePrice") is not None else None
                    qty = float(pdata["qty"]) if pdata.get("qty") else None
                    pnl = float(pdata["realizedPnl"]) if pdata.get("realizedPnl") is not None else None
                    cost = float(pdata.get("capital") or 0.0)
                    pnl_pct = round(pnl / cost * 100.0, 2) if (pnl is not None and cost > 0) else None
                except (TypeError, ValueError, KeyError):
                    entry = exitp = qty = pnl = pnl_pct = None
                dur = None
                try:
                    o = datetime.fromisoformat(opened); c = datetime.fromisoformat(closed)
                    if o.tzinfo is None:
                        o = o.replace(tzinfo=timezone.utc)
                    if c.tzinfo is None:
                        c = c.replace(tzinfo=timezone.utc)
                    dur = max(0, int((c - o).total_seconds()))
                except (TypeError, ValueError):
                    dur = None
                ins = conn.execute(
                    "INSERT INTO runs_log (username, mode, symbol, side, opened_at, closed_at, "
                    "duration_seconds, entry_price, exit_price, qty, pnl, pnl_pct, status, source, created_at) "
                    "VALUES (%s,'demo',%s,'long',%s,%s,%s,%s,%s,%s,%s,%s,'closed',%s,%s) RETURNING id",
                    (owner, pdata.get("symbol"), opened, closed, dur, entry, exitp, qty, pnl, pnl_pct, source, closed),
                ).fetchone()
                if ins:
                    pdata["runId"] = int(ins["id"])
                    conn.execute("UPDATE paper_positions SET data = %s WHERE id = %s", (Json(pdata), r["pid"]))
    except Exception:  # noqa: BLE001 — observational; must never block boot
        return


def get_praxis_identity(username: str) -> Optional[dict[str, Any]]:
    """The user's Praxis identity mapping: the IMMUTABLE user_uid, the mapped praxis_user_id (or None), and
    the operator-approved praxis_env. Read server-side by the /praxis provisioning routes — never trusts a
    client-supplied id."""
    return fetch_one(
        "SELECT user_uid::text AS user_uid, praxis_user_id, COALESCE(praxis_env, 'none') AS praxis_env "
        "FROM users WHERE username = %s", (username,))


def set_praxis_user_id(username: str, praxis_user_id: str) -> Optional[str]:
    """Idempotently record the mapped Praxis identity — ONLY when not already set (never repoint an existing
    mapping, even under a race). Returns the EFFECTIVE praxis_user_id (the pre-existing one if already set,
    else the newly stored one), or None if the user row is gone. The caller compares to detect a conflict."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET praxis_user_id = %s, praxis_linked_at = %s "
            "WHERE username = %s AND praxis_user_id IS NULL",
            (praxis_user_id, datetime.now(timezone.utc).isoformat(), username))
        row = conn.execute("SELECT praxis_user_id FROM users WHERE username = %s", (username,)).fetchone()
    return row["praxis_user_id"] if row else None


def _seed_default_admin() -> None:
    # Imported lazily to avoid a cycle (auth_service imports nothing from here).
    from app.services.auth import hash_password

    if get_user("admin") is not None:
        return
    default_pw = os.environ.get("ADMIN_DEFAULT_PASSWORD", "admin")
    create_user("admin", hash_password(default_pw), role="admin")


# ── Users ─────────────────────────────────────────────────────────────────

def get_user(username: str) -> Optional[dict[str, Any]]:
    return fetch_one("SELECT username, password_hash, role, created_at, email, protection_hash, "
            "nickname, win_target, avatar, phone, COALESCE(plan, 'basic') AS plan, "
            "profit_engine_unlocked, COALESCE(credits, '{}'::jsonb) AS credits, "
            "loyalty_points, stripe_customer_id, subscription_status, "
            "subscription_period_end, onboarded, badge, is_demo, demo_expires, "
            "COALESCE(twofa_enabled, FALSE) AS twofa_enabled, privacy_ack, "
            "totp_secret, COALESCE(totp_enabled, FALSE) AS totp_enabled, "
            "COALESCE(totp_last_step, 0) AS totp_last_step, "
            "COALESCE(is_main, FALSE) AS is_main, "
            # Team-role grant flags — WITHOUT these in the SELECT, is_legal_editor /
            # is_content_editor read user.get(...) == None for a granted-but-not-main user,
            # so a legal/content editor who isn't a full admin resolves False everywhere
            # (nav hidden + /auth/me flag off + require_legal_editor → 403). Select them.
            "COALESCE(legal_editor, FALSE) AS legal_editor, "
            "COALESCE(content_editor, FALSE) AS content_editor, "
            "COALESCE(it_editor, FALSE) AS it_editor, "
            "COALESCE(biz_editor, FALSE) AS biz_editor, "
            "COALESCE(must_change_password, FALSE) AS must_change_password, "
            "COALESCE(reset_approved, FALSE) AS reset_approved "
            "FROM users WHERE username = %s", (username,))


def is_main_admin(username: str) -> bool:
    """True only for a MAIN admin (role=admin AND is_main). Restricted admins
    (role=admin, is_main=FALSE) keep app features but no inside info."""
    u = get_user(username)
    return bool(u and u.get("role") == "admin" and u.get("is_main"))


def set_main_admin(username: str, is_main: bool) -> None:
    """Promote/demote an admin to/from the main tier (main-admin action)."""
    execute("UPDATE users SET is_main = %s WHERE username = %s", (bool(is_main), username))


def list_users() -> list[dict[str, Any]]:
    return fetch_all("SELECT username, role, created_at, email, phone, COALESCE(is_main, FALSE) AS is_main FROM users ORDER BY created_at")


def create_user(username: str, password_hash: str, role: str = "user",
                email: Optional[str] = None, created_by: Optional[str] = None) -> None:
    # New users start on the Basic tier (admins are unlimited via role anyway).
    plan = "pro" if role == "admin" else "basic"
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash, role, created_at, email, created_by, plan) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (username) DO NOTHING",
            (username, password_hash, role, now_iso(), email, created_by, plan),
        )


def count_users() -> int:
    row = fetch_one("SELECT COUNT(*) AS n FROM users")
    return int(row["n"]) if row else 0


def count_users_created_by(creator: str) -> int:
    row = fetch_one("SELECT COUNT(*) AS n FROM users WHERE created_by = %s", (creator,))
    return int(row["n"]) if row else 0


def update_user_email(username: str, email: Optional[str]) -> None:
    execute("UPDATE users SET email = %s WHERE username = %s", (email, username))


def set_user_protection(username: str, protection_hash: Optional[str]) -> None:
    """Per-user protection code (hash), or None to clear it."""
    execute("UPDATE users SET protection_hash = %s WHERE username = %s", (protection_hash, username))


def update_user_password(username: str, password_hash: str) -> None:
    execute("UPDATE users SET password_hash = %s WHERE username = %s", (password_hash, username))


def set_must_change_password(username: str, flag: bool) -> None:
    """Flag/clear the "must set a new password on next login" state for a user.
    An admin reset sets it TRUE; the user clears it by picking a new password."""
    execute("UPDATE users SET must_change_password = %s WHERE username = %s", (bool(flag), username))


def set_reset_approved(username: str, flag: bool) -> None:
    """Flag/clear the one-time "admin approved a passwordless reset" marker. Set
    TRUE when an admin approves a 'can't log in' request; cleared once the user
    actually sets a new password (or by a reject)."""
    execute("UPDATE users SET reset_approved = %s WHERE username = %s", (bool(flag), username))


def update_user_role(username: str, role: str) -> None:
    execute("UPDATE users SET role = %s WHERE username = %s", (role, username))


class ProvisionedAccountError(Exception):
    """Raised when a hard delete is attempted on an account linked to a Praxis identity."""


def delete_user(username: str) -> None:
    # Phase 2C-A · M3: a PROVISIONED account (mapped to a Praxis auth.users, and potentially holding
    # credentials/bots/Vault keys) must NOT be hard-deleted — that orphans live Praxis state (the FK to
    # auth.users is ON DELETE RESTRICT on the Praxis side, and the exchange key would survive in Vault).
    # Such an account routes to the deprovision (soft-delete) flow, added in M7. Until then, refuse
    # fail-closed rather than silently orphaning. Non-provisioned accounts delete normally.
    # ATOMIC (audit): a single conditional DELETE closes the TOCTOU where a concurrent /praxis/link could
    # provision the account between a separate SELECT and DELETE — which would orphan live Praxis state.
    with get_conn() as conn:
        deleted = conn.execute(
            "DELETE FROM users WHERE username = %s AND praxis_user_id IS NULL", (username,)).rowcount
        if deleted == 0:
            still = conn.execute("SELECT 1 FROM users WHERE username = %s", (username,)).fetchone()
            if still:   # row exists but wasn't deleted ⇒ it is provisioned ⇒ refuse (route to deprovision)
                raise ProvisionedAccountError(username)


# ── Subscriptions / tiers ──────────────────────────────────────────────────

VALID_PLANS = ("basic", "middle", "pro")


def set_user_plan(username: str, plan: str, *, status: Optional[str] = None,
                  period_end: Optional[str] = None) -> None:
    """Set a user's subscription tier (and optionally its Stripe status/period)."""
    if plan not in VALID_PLANS:
        raise ValueError(f"Unknown plan: {plan}")
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET plan = %s, subscription_status = COALESCE(%s, subscription_status), "
            "subscription_period_end = COALESCE(%s, subscription_period_end) WHERE username = %s",
            (plan, status, period_end, username),
        )


def set_subscription_state(username: str, status: Optional[str],
                           period_end: Optional[str]) -> None:
    execute("UPDATE users SET subscription_status = %s, subscription_period_end = %s WHERE username = %s", (status, period_end, username))


def set_profit_engine_unlocked(username: str, unlocked: bool) -> None:
    execute("UPDATE users SET profit_engine_unlocked = %s WHERE username = %s", (bool(unlocked), username))


def set_stripe_customer(username: str, customer_id: str) -> None:
    execute("UPDATE users SET stripe_customer_id = %s WHERE username = %s", (customer_id, username))


def get_user_by_stripe_customer(customer_id: str) -> Optional[dict[str, Any]]:
    if not customer_id:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT username FROM users WHERE stripe_customer_id = %s LIMIT 1",
            (customer_id,),
        ).fetchone()
    return row


# ── Credits (purchasable capacity top-ups) ─────────────────────────────────

def get_credits(username: str) -> dict[str, int]:
    user = get_user(username)
    if not user:
        return {}
    return {k: int(v) for k, v in (user.get("credits") or {}).items()}


def add_credits(username: str, kind: str, amount: int) -> dict[str, int]:
    """Add (or subtract, if negative) credits of a given kind. Floors at 0."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(credits, '{}'::jsonb) AS credits FROM users WHERE username = %s FOR UPDATE",
            (username,),
        ).fetchone()
        credits = {k: int(v) for k, v in ((row or {}).get("credits") or {}).items()}
        credits[kind] = max(0, credits.get(kind, 0) + int(amount))
        conn.execute("UPDATE users SET credits = %s WHERE username = %s", (Json(credits), username))
    return credits


def spend_credit(username: str, kind: str, amount: int = 1) -> bool:
    """Atomically spend `amount` credits of `kind`. Returns False if insufficient."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(credits, '{}'::jsonb) AS credits FROM users WHERE username = %s FOR UPDATE",
            (username,),
        ).fetchone()
        credits = {k: int(v) for k, v in ((row or {}).get("credits") or {}).items()}
        if credits.get(kind, 0) < amount:
            return False
        credits[kind] -= amount
        conn.execute("UPDATE users SET credits = %s WHERE username = %s", (Json(credits), username))
    return True


# ── Loyalty points (gamification) ──────────────────────────────────────────

def add_loyalty(username: str, kind: str, points: int, meta: Optional[dict] = None) -> int:
    """Record a loyalty earn/spend and return the new balance."""
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO loyalty_events (username, kind, points, meta, created_at) "
            "VALUES (%s, %s, %s, %s, %s)",
            (username, kind, int(points), Json(meta or {}), now_iso()),
        )
        row = conn.execute(
            "UPDATE users SET loyalty_points = GREATEST(0, loyalty_points + %s) "
            "WHERE username = %s RETURNING loyalty_points",
            (int(points), username),
        ).fetchone()
    return int(row["loyalty_points"]) if row else 0


def get_loyalty(username: str) -> int:
    user = get_user(username)
    return int(user.get("loyalty_points") or 0) if user else 0


def list_loyalty_events(username: str, limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT kind, points, meta, created_at FROM loyalty_events "
            "WHERE username = %s ORDER BY id DESC LIMIT %s",
            (username, limit),
        ).fetchall()
    return list(rows)


# ── Billing event log + idempotency ────────────────────────────────────────

def billing_event_exists(stripe_id: str) -> bool:
    if not stripe_id:
        return False
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM billing_events WHERE stripe_id = %s LIMIT 1", (stripe_id,)
        ).fetchone()
    return row is not None


def record_billing_event(kind: str, *, stripe_id: Optional[str] = None,
                         username: Optional[str] = None, amount: Optional[int] = None,
                         currency: Optional[str] = None, raw: Optional[dict] = None) -> None:
    execute("INSERT INTO billing_events (stripe_id, username, kind, amount, currency, raw, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (stripe_id) DO NOTHING", (stripe_id, username, kind, amount, currency, Json(raw or {}), now_iso()))


# ── Per-user daily usage counters (rate limits) ────────────────────────────

def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def get_usage(username: str, metric: str, day: Optional[str] = None) -> int:
    day = day or _today()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT count FROM usage_counters WHERE username = %s AND metric = %s AND day = %s",
            (username, metric, day),
        ).fetchone()
    return int(row["count"]) if row else 0


def incr_usage(username: str, metric: str, by: int = 1, day: Optional[str] = None) -> int:
    day = day or _today()
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO usage_counters (username, metric, day, count) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (username, metric, day) DO UPDATE SET count = usage_counters.count + EXCLUDED.count "
            "RETURNING count",
            (username, metric, day, by),
        ).fetchone()
    return int(row["count"]) if row else by


def set_badge(username: str, badge: Optional[str]) -> None:
    execute("UPDATE users SET badge = %s WHERE username = %s", (badge, username))


def set_music(username: str, music: Optional[str]) -> None:
    """Store (or clear) the user's uploaded background-music data URL.
    Kept out of get_user() since it's large — fetched only on demand."""
    execute("UPDATE users SET music = %s WHERE username = %s", (music or None, username))


def get_music(username: str) -> Optional[str]:
    row = fetch_one("SELECT music FROM users WHERE username = %s", (username,))
    return (row or {}).get("music") if row else None


# ── Demo videos (admin-uploaded, per feature) ───────────────────────────────

def set_demo_video(feature: str, video: Optional[str]) -> None:
    with get_conn() as conn:
        if not video:
            conn.execute("DELETE FROM demo_videos WHERE feature = %s", (feature,))
            return
        conn.execute(
            "INSERT INTO demo_videos (feature, video, updated_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (feature) DO UPDATE SET video = EXCLUDED.video, updated_at = EXCLUDED.updated_at",
            (feature, video, now_iso()),
        )


def get_demo_video(feature: str) -> Optional[str]:
    row = fetch_one("SELECT video FROM demo_videos WHERE feature = %s", (feature,))
    return (row or {}).get("video") if row else None


def list_demo_features() -> list[str]:
    with get_conn() as conn:
        rows = conn.execute("SELECT feature FROM demo_videos").fetchall()
    return [r["feature"] for r in rows]


# ── Reels lessons (admin-managed learning videos) ───────────────────────────

# Columns an admin may set/update via the API (id/timestamps are managed here).
_REELS_FIELDS = (
    "title_he", "title_en", "caption_he", "caption_en", "description", "video_url",
    "free_preview_seconds", "position", "published",
)

_REELS_COLS = (
    "id, title_he, title_en, caption_he, caption_en, description, video_url, "
    "free_preview_seconds, position, published, created_at, updated_at"
)


def list_reels_lessons(include_unpublished: bool = False) -> list[dict[str, Any]]:
    """Lessons ordered for the player. Users see only published; admins see all."""
    sql = f"SELECT {_REELS_COLS} FROM reels_lessons "
    if not include_unpublished:
        sql += "WHERE published = TRUE "
    sql += "ORDER BY position ASC, id ASC"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return list(rows)


def get_reels_lesson(lesson_id: int) -> Optional[dict[str, Any]]:
    return fetch_one(f"SELECT {_REELS_COLS} FROM reels_lessons WHERE id = %s", (lesson_id,))


def create_reels_lesson(
    title_he: str = "",
    title_en: str = "",
    caption_he: str = "",
    caption_en: str = "",
    description: str = "",
    video_url: Optional[str] = None,
    free_preview_seconds: int = 30,
    position: int = 0,
    published: bool = False,
) -> dict[str, Any]:
    ts = now_iso()
    with get_conn() as conn:
        return conn.execute(
            "INSERT INTO reels_lessons "
            "(title_he, title_en, caption_he, caption_en, description, video_url, "
            "free_preview_seconds, position, published, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_REELS_COLS}",
            (title_he, title_en, caption_he, caption_en, description, video_url,
             free_preview_seconds, position, published, ts, ts),
        ).fetchone()


def update_reels_lesson(lesson_id: int, **fields: Any) -> Optional[dict[str, Any]]:
    """Update only the allowed columns that were provided; refresh updated_at."""
    cols = [(k, v) for k, v in fields.items() if k in _REELS_FIELDS]
    if not cols:
        return get_reels_lesson(lesson_id)
    set_sql = ", ".join(f"{k} = %s" for k, _ in cols) + ", updated_at = %s"
    params = [v for _, v in cols] + [now_iso(), lesson_id]
    with get_conn() as conn:
        return conn.execute(
            f"UPDATE reels_lessons SET {set_sql} WHERE id = %s RETURNING {_REELS_COLS}",
            params,
        ).fetchone()


def delete_reels_lesson(lesson_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM reels_lessons WHERE id = %s", (lesson_id,))
        return cur.rowcount > 0


def reorder_reels_lessons(ordered_ids: list[int]) -> None:
    """Set position = rank for each id in the given order (0-based). Ignores unknown ids."""
    if not ordered_ids:
        return
    ts = now_iso()
    with get_conn() as conn:
        for rank, lid in enumerate(ordered_ids):
            conn.execute(
                "UPDATE reels_lessons SET position = %s, updated_at = %s WHERE id = %s",
                (rank, ts, lid),
            )


# The in-app "90-second tour" link the Reels·course screen embeds (an iframe + an
# open-in-new-tab link). Owner-editable so it can be re-pointed without a deploy;
# defaults to the shipped frontend-static file at /media/home-tour.html.
_REELS_TOUR_KEY = "reels_tour"
REELS_TOUR_DEFAULT = "/media/home-tour.html"


def get_reels_tour_url() -> str:
    val = _get_singleton(_REELS_TOUR_KEY, {}) or {}
    url = (val.get("url") if isinstance(val, dict) else None) or ""
    return url.strip() or REELS_TOUR_DEFAULT


def set_reels_tour_url(url: str) -> str:
    clean = (url or "").strip() or REELS_TOUR_DEFAULT
    _set_singleton(_REELS_TOUR_KEY, {"url": clean})
    return clean


# ── University / Learn content store (content_editor-managed; mirrors reels) ──
UNIVERSITY_SECTIONS = ("getting_started", "concepts", "glossary")
_UNI_COLS = ("id, section, icon, title_he, title_en, body_he, body_en, "
             "position, published, updated_at, updated_by")
_UNI_FIELDS = ("section", "icon", "title_he", "title_en", "body_he", "body_en", "position", "published")


def list_university_items(include_unpublished: bool = False) -> list[dict[str, Any]]:
    """University content items, ordered by (section, position). Users see only
    published; a content_editor sees all."""
    sql = f"SELECT {_UNI_COLS} FROM university_items "
    if not include_unpublished:
        sql += "WHERE published = TRUE "
    sql += "ORDER BY position ASC, id ASC"
    with get_conn() as conn:
        return list(conn.execute(sql).fetchall())


def count_university_items() -> int:
    r = fetch_one("SELECT COUNT(*) AS n FROM university_items")
    return int((r or {}).get("n") or 0)


def get_university_item(item_id: int) -> Optional[dict[str, Any]]:
    return fetch_one(f"SELECT {_UNI_COLS} FROM university_items WHERE id = %s", (item_id,))


def create_university_item(*, section: str = "concepts", icon: str = "", title_he: str = "",
                           title_en: str = "", body_he: str = "", body_en: str = "",
                           position: int = 0, published: bool = True,
                           updated_by: Optional[str] = None) -> dict[str, Any]:
    if section not in UNIVERSITY_SECTIONS:
        section = "concepts"
    ts = now_iso()
    with get_conn() as conn:
        return conn.execute(
            "INSERT INTO university_items (section, icon, title_he, title_en, body_he, body_en, "
            "position, published, updated_at, updated_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            f"RETURNING {_UNI_COLS}",
            (section, icon, title_he, title_en, body_he, body_en, int(position), bool(published), ts, updated_by),
        ).fetchone()


def update_university_item(item_id: int, updated_by: Optional[str] = None, **fields: Any) -> Optional[dict[str, Any]]:
    cols = [(k, v) for k, v in fields.items() if k in _UNI_FIELDS]
    if not cols:
        return get_university_item(item_id)
    set_sql = ", ".join(f"{k} = %s" for k, _ in cols) + ", updated_at = %s, updated_by = %s"
    params = [v for _, v in cols] + [now_iso(), updated_by, item_id]
    with get_conn() as conn:
        return conn.execute(
            f"UPDATE university_items SET {set_sql} WHERE id = %s RETURNING {_UNI_COLS}", params).fetchone()


def delete_university_item(item_id: int) -> bool:
    with get_conn() as conn:
        return conn.execute("DELETE FROM university_items WHERE id = %s", (item_id,)).rowcount > 0


def import_university_items(items: list[dict], updated_by: Optional[str] = None) -> int:
    """Bulk-seed the store from a caller-provided list (the built-in lib/uni.ts content).
    ONLY runs when the store is empty — never clobbers an editor's existing content.
    Returns the number of rows inserted (0 if the store already had content)."""
    if count_university_items() > 0:
        return 0
    n = 0
    for it in items or []:
        create_university_item(
            section=str(it.get("section") or "concepts"), icon=str(it.get("icon") or ""),
            title_he=str(it.get("title_he") or ""), title_en=str(it.get("title_en") or ""),
            body_he=str(it.get("body_he") or ""), body_en=str(it.get("body_en") or ""),
            position=int(it.get("position") or n), published=bool(it.get("published", True)),
            updated_by=updated_by)
        n += 1
    return n


# ── Demo testers (timed one-tap accounts) ──────────────────────────────────

def create_demo_user(username: str, token: str, plan: str = "pro") -> None:
    execute("INSERT INTO users (username, password_hash, role, created_at, plan, is_demo, demo_token) "
            "VALUES (%s, %s, 'user', %s, %s, TRUE, %s) ON CONFLICT (username) DO NOTHING", (username, "", now_iso(), plan, token))


def get_user_by_demo_token(token: str) -> Optional[dict[str, Any]]:
    if not token:
        return None
    with get_conn() as conn:
        return conn.execute("SELECT username FROM users WHERE demo_token = %s LIMIT 1", (token,)).fetchone()


def set_demo_expires(username: str, expires_iso: Optional[str]) -> None:
    execute("UPDATE users SET demo_expires = %s WHERE username = %s", (expires_iso, username))


def mark_demo_user(username: str, expires_iso: str, plan: str = "pro") -> None:
    """Turn an existing (password-based) user into a timed demo user with full
    PRO features for the given window. Used by admin 'Add user → Demo'."""
    execute("UPDATE users SET is_demo = TRUE, demo_expires = %s, plan = %s WHERE username = %s", (expires_iso, plan, username))


def ensure_demo_token(username: str) -> Optional[str]:
    """Return the user's one-tap demo token, generating + persisting one if missing.

    Demo users minted via ``mark_demo_user`` (admin 'Add user → Demo') never got a
    token, so their invite link rendered as ``?demo=None``. This backfills a real
    token on demand (e.g. when the admin list is fetched) so every demo user has a
    working invite link.
    """
    import secrets as _s
    with get_conn() as conn:
        row = conn.execute("SELECT demo_token FROM users WHERE username = %s", (username,)).fetchone()
        if not row:
            return None
        tok = (row or {}).get("demo_token")
        if tok:
            return tok
        tok = _s.token_urlsafe(16)
        conn.execute("UPDATE users SET demo_token = %s WHERE username = %s", (tok, username))
        return tok


def tester_score(username: str) -> dict[str, Any]:
    """Demo-tester score 0-100, from ACTUAL USE + demo PROFIT.
    Use: runs (paper sessions) + suggestions + loyalty. Profit: realized demo P&L."""
    runs = suggestions = loyalty = 0
    try:
        with get_conn() as conn:
            runs = int((conn.execute("SELECT COUNT(*) AS n FROM paper_sessions WHERE data->>'owner' = %s", (username,)).fetchone() or {}).get("n") or 0)
            suggestions = int((conn.execute("SELECT COUNT(*) AS n FROM feedback WHERE username = %s", (username,)).fetchone() or {}).get("n") or 0)
            lr = conn.execute("SELECT loyalty_points FROM users WHERE username = %s", (username,)).fetchone()
            loyalty = int((lr or {}).get("loyalty_points") or 0)
    except Exception:
        pass
    profit = 0.0
    try:
        profit = float(demo_pnl_stats(owner=username, is_admin=False).get("total") or 0)
    except Exception:
        pass
    use_pts = min(runs * 6, 30) + min(suggestions * 5, 20) + min(loyalty, 10)   # up to 60
    profit_pts = max(0, min(40, round(profit / 50)))                            # +1 per $50 demo profit, up to 40
    score = max(0, min(100, int(use_pts + profit_pts)))
    return {"score": score, "runs": runs, "suggestions": suggestions, "profit": round(profit),
            "usePts": int(use_pts), "profitPts": int(profit_pts)}


def list_demo_users() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT username, demo_expires, demo_token, created_at, plan FROM users WHERE is_demo = TRUE ORDER BY created_at DESC"
        ).fetchall()
    return list(rows)


# ── Tester feedback / suggestions ──────────────────────────────────────────

def add_feedback(username: str, text: str, route: Optional[str] = None, image: Optional[str] = None) -> int:
    # Keep the image small (a data URL up to ~3MB after base64 ≈ 4.1MB string).
    img = image if (image and len(image) < 4_300_000 and image.startswith("data:image/")) else None
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO feedback (username, text, route, image, created_at) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (username, (text or "").strip()[:1000], route, img, now_iso()),
        ).fetchone()
    return int(row["id"]) if row else 0


def list_feedback(limit: int = 100) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, text, route, image, handled, created_at FROM feedback ORDER BY id DESC LIMIT %s", (limit,)
        ).fetchall()
    return list(rows)


# ── Product analytics / audit events (privacy-safe) ──────────────────────────
# THREE-part identity (Item 2):
#   • user_id / username — the internal identity. NEVER written into an event row's
#     props, and (for events recorded through the new pseudonymous path) not stored
#     in the `username` column either.
#   • auid  = HMAC(username, SESSION_SECRET) — a STABLE pseudonym per user. The
#     reverse mapping is recomputable server-side (for a user's own data export) but
#     is never returned by any analytics READ.
#   • session_id — a short-lived id the client generates and rotates per login.
#
# Two safety nets sit at the ingest boundary, defence-in-depth:
#   1. A hard FORBIDDEN-key denylist — dropped before anything else, no matter what.
#   2. A per-event or generic key ALLOWLIST — only known, non-sensitive keys survive.
# Values are additionally coerced to safe scalars, so no amount / key / PII can be
# persisted even if a caller slips one in.

# Keys that must NEVER reach storage — dropped/redacted first, unconditionally.
_ANALYTICS_FORBIDDEN_KEYS = frozenset({
    "user_id", "username", "email", "phone", "name", "api_key", "api_secret",
    "secret", "token", "password", "exchange_credential", "pine_script",
    "strategy_source", "webhook_url", "operator_id", "wallet_address", "balance",
    "amount", "amount_usd", "order_size", "position_size", "ip_address",
})

# The 12 canonical product events + the ONLY props allowed on each (all enums or
# buckets — no free text). Events not in this map fall back to the generic key
# allowlist below (keeps the pre-existing generic beacons working & safe).
_ANALYTICS_EVENT_PROPS = {
    "user_logged_in":         frozenset(),
    "dashboard_viewed":       frozenset(),
    "scanner_viewed":         frozenset(),
    "scanner_run_started":    frozenset({"market_class"}),
    "scanner_run_completed":  frozenset({"market_class", "result_bucket"}),
    "backtest_started":       frozenset({"strategy_kind"}),
    "backtest_completed":     frozenset({"strategy_kind", "duration_bucket"}),
    "strategy_created":       frozenset({"strategy_kind"}),
    "strategy_saved":         frozenset({"strategy_kind"}),
    "validation_error_seen":  frozenset({"screen", "error_code"}),
    "blocked_action_seen":    frozenset({"action_kind", "reason_code"}),
    "autopilot_viewed":       frozenset({"pilot_no"}),
}

# Generic (pre-existing) beacons — screen_view, app_open, exchange_connect_*, … —
# are limited to this small non-sensitive set. None of these are forbidden keys.
_ANALYTICS_PROP_KEYS = frozenset({
    "screen", "action", "mode", "op", "code", "ok", "result", "step",
    "skin", "kind", "source", "reason", "count", "id",
    # canonical-event enums (so a canonical event may also flow this path)
    "market_class", "result_bucket", "strategy_kind", "duration_bucket",
    "error_code", "action_kind", "reason_code", "pilot_no",
})


def analytics_pseudonym(username: "Optional[str]") -> "Optional[str]":
    """Stable pseudonymous analytics id for a user = HMAC-SHA256(username, SESSION_SECRET),
    truncated. Deterministic (so a user's own export can find their rows) but not
    reversible without the secret + the username list, and never exposed in reads.
    Returns None when there is no username or no secret configured."""
    import hashlib
    import hmac
    if not username:
        return None
    secret = os.environ.get("SESSION_SECRET", "")
    if not secret:
        return None
    return hmac.new(secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def _analytics_safe_props(event: str, props: "Optional[dict]") -> "dict[str, Any]":
    """Apply the forbidden-key denylist + the per-event/generic allowlist, then coerce
    surviving values to safe scalars. Pure — returns the sanitized props dict."""
    allowed = _ANALYTICS_EVENT_PROPS.get(event)
    safe: "dict[str, Any]" = {}
    for k, v in (props or {}).items():
        if k in _ANALYTICS_FORBIDDEN_KEYS:
            continue                                   # 1. hard denylist
        if allowed is not None:
            if k not in allowed:
                continue                               # 2a. per-event allowlist
        elif k not in _ANALYTICS_PROP_KEYS:
            continue                                   # 2b. generic allowlist
        if isinstance(v, bool):
            safe[k] = v
        elif isinstance(v, int):
            # cap ints so a raw amount can't be smuggled through a numeric prop
            safe[k] = max(-1_000_000, min(1_000_000, int(v)))
        elif v is None:
            safe[k] = None
        else:
            safe[k] = str(v)[:48]                      # short, non-sensitive tag only
    return safe


def record_analytics_event(username: "Optional[str]", event: str, props: "Optional[dict]" = None,
                           session_id: "Optional[str]" = None, *, require_consent: bool = True) -> bool:
    """Store one analytics event for `username`, keyed by the PSEUDONYM (never the
    internal username, which is stored NULL). Enforces the consent gate + the
    forbidden-key/allowlist sanitizer. Best-effort: never raises to the caller
    (analytics must not break a user flow). Returns True if a row was written."""
    ev = (event or "").strip()[:64]
    if not ev:
        return False
    if require_consent and username and not get_analytics_consent(username):
        return False                                   # consent gate — REJECT
    safe = _analytics_safe_props(ev, props)
    auid = analytics_pseudonym(username)
    sid = (str(session_id)[:64] if session_id else None)
    try:
        execute(
            "INSERT INTO analytics_events (username, auid, session_id, event, props, ts) "
            "VALUES (NULL, %s, %s, %s, %s, %s)",
            (auid, sid, ev, Json(safe), now_iso()),
        )
        return True
    except Exception:  # noqa: BLE001 — analytics is fire-and-forget
        return False


def get_analytics_consent(username: "Optional[str]") -> bool:
    """Has this user accepted analytics collection? Default FALSE (opt-in)."""
    if not username:
        return False
    r = fetch_one("SELECT analytics_consent FROM users WHERE username = %s", (username,))
    return bool(r and r["analytics_consent"])


def get_analytics_consent_state(username: "Optional[str]") -> "dict[str, bool]":
    """Consent value + whether the user has ever made a choice. `decided` is False until
    Accept/Decline is recorded (analytics_consent_at NULL) — the consent screen shows
    only while undecided, then never again (re-toggle lives in the My-Data settings)."""
    if not username:
        return {"consent": False, "decided": False}
    r = fetch_one(
        "SELECT analytics_consent, analytics_consent_at FROM users WHERE username = %s",
        (username,),
    )
    return {
        "consent": bool(r and r["analytics_consent"]),
        "decided": bool(r and r["analytics_consent_at"]),
    }


def set_analytics_consent(username: str, consent: bool) -> bool:
    """Set the per-user analytics consent flag + stamp the time. Returns the new value."""
    execute(
        "UPDATE users SET analytics_consent = %s, analytics_consent_at = %s WHERE username = %s",
        (bool(consent), now_iso(), username),
    )
    return bool(consent)


def list_user_analytics_events(username: str, limit: int = 5000) -> "list[dict[str, Any]]":
    """A user's OWN analytics events (for their data export, Item 7), found via the
    recomputed pseudonym. Returns event name + props + ts only — no identity fields."""
    auid = analytics_pseudonym(username)
    if not auid:
        return []
    rows = fetch_all(
        "SELECT event, props, ts FROM analytics_events WHERE auid = %s ORDER BY ts DESC LIMIT %s",
        (auid, int(limit)),
    )
    return [{"event": r["event"], "props": r["props"], "ts": r["ts"]} for r in rows]


def set_deletion_requested(username: str, requested: bool) -> "Optional[str]":
    """Mark (or withdraw) a SOFT account-deletion request. Returns the stamp when set,
    None when withdrawn. Never deletes data — an owner actions it from the requests
    portal (Item 7: deletion is a request/soft path, not a destructive self-action)."""
    ts = now_iso() if requested else None
    execute("UPDATE users SET deletion_requested_at = %s WHERE username = %s", (ts, username))
    return ts


def get_deletion_requested(username: "Optional[str]") -> "Optional[str]":
    """The pending deletion-request timestamp for a user, or None."""
    if not username:
        return None
    r = fetch_one("SELECT deletion_requested_at FROM users WHERE username = %s", (username,))
    return (r or {}).get("deletion_requested_at") if r else None


def analytics_summary(days: int = 14) -> "dict[str, Any]":
    """Admin aggregation over the last `days`: total events, per-event counts +
    distinct-user counts, and an overall daily-total trend. Grouped by event name;
    the frontend maps events → KPI buckets (Activation / Feature / Trust / Errors)."""
    days = max(1, min(int(days or 14), 90))
    since = (datetime.now(timezone.utc) - _timedelta(days=days)).isoformat()
    counts = fetch_all(
        # distinct-user counts use the pseudonym (new rows) OR legacy username — never
        # exposing either identity, only the COUNT. Aggregate only, no identities.
        "SELECT event, COUNT(*) AS n, COUNT(DISTINCT COALESCE(auid, username)) AS users "
        "FROM analytics_events WHERE ts >= %s GROUP BY event ORDER BY n DESC",
        (since,),
    )
    trend = fetch_all(
        "SELECT substr(ts, 1, 10) AS day, COUNT(*) AS n "
        "FROM analytics_events WHERE ts >= %s GROUP BY substr(ts, 1, 10) ORDER BY day ASC",
        (since,),
    )
    total = sum(int(r["n"]) for r in counts)
    return {
        "days": days,
        "total": total,
        "counts": {r["event"]: {"n": int(r["n"]), "users": int(r["users"])} for r in counts},
        "trend": [{"day": r["day"], "n": int(r["n"])} for r in trend],
    }


def analytics_safety_summary(days: int = 14) -> "dict[str, Any]":
    """Admin SAFETY rollup (Item 6) over the last `days`. AGGREGATE ONLY — counts
    broken down by the non-sensitive enum props, never any identity or balance:
      • blocked_action_seen  → by reason_code and by action_kind
      • validation_error_seen → by screen
      • go-live funnel        → attempts (blocked + confirmed), confirmed, kill-switch
      • volumes               → scanner runs + backtests
    Every value is a COUNT. No usernames, no amounts."""
    days = max(1, min(int(days or 14), 90))
    since = (datetime.now(timezone.utc) - _timedelta(days=days)).isoformat()

    def _by(event: str, key: str) -> "list[dict[str, Any]]":
        rows = fetch_all(
            "SELECT COALESCE(props->>%s, 'unknown') AS k, COUNT(*) AS n "
            "FROM analytics_events WHERE event = %s AND ts >= %s GROUP BY 1 ORDER BY n DESC",
            (key, event, since),
        )
        return [{"key": r["k"], "n": int(r["n"])} for r in rows]

    def _count(event: str, where: str = "", params: tuple = ()) -> int:
        r = fetch_one(
            f"SELECT COUNT(*) AS n FROM analytics_events WHERE event = %s AND ts >= %s{where}",
            (event, since, *params),
        )
        return int(r["n"]) if r else 0

    blocked_by_reason = _by("blocked_action_seen", "reason_code")
    blocked_by_action = _by("blocked_action_seen", "action_kind")
    validation_by_screen = _by("validation_error_seen", "screen")
    go_live_blocked = _count("blocked_action_seen", " AND props->>'action_kind' = 'go_live'")
    go_live_confirmed = _count("autopilot_go_live")     # generic beacon fired on a successful go-live
    kill_switch = _count("autopilot_stop_live")         # generic beacon fired on kill-switch / stop-live
    return {
        "days": days,
        "blocked_by_reason": blocked_by_reason,
        "blocked_by_action": blocked_by_action,
        "validation_by_screen": validation_by_screen,
        "go_live": {
            "attempts": go_live_blocked + go_live_confirmed,
            "confirmed": go_live_confirmed,
            "blocked": go_live_blocked,
            "kill_switch": kill_switch,
        },
        "volumes": {
            "scanner_runs": _count("scanner_run_completed"),
            "backtests": _count("backtest_completed"),
        },
    }


def backfill_feedback_into_requests() -> int:
    """Import every previously-submitted feedback (the chat "suggestions") into the
    Owner/Requests portal as a user_request row, so the portal shows the FULL
    history — not only feedback submitted after the requests-mirror hook landed.

    Idempotent + self-healing: only feedback NOT already mirrored (no requests row
    with that feedback_id) is imported, de-duplicated by feedback_id, preserving the
    ORIGINAL author + timestamp. Safe to run repeatedly. Returns rows imported."""
    imported = 0
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT f.id, f.username, f.text, f.route, f.image, f.created_at, u.nickname "
            "FROM feedback f LEFT JOIN users u ON u.username = f.username "
            "WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.feedback_id = f.id) "
            "ORDER BY f.id ASC"
        ).fetchall()
        for f in rows:
            uname = f.get("username")
            dname = f.get("nickname") or uname
            text = (f.get("text") or "").strip()
            img = f.get("image")
            subject = (text[:120].strip() or ("📎 screenshot" if img else "Feedback"))
            ts = f.get("created_at") or now_iso()
            conn.execute(
                "INSERT INTO requests (user_id, display_name, category, subject, body, media, route, "
                "status, feedback_id, created_at, updated_at) "
                "VALUES (%s, %s, 'user_request', %s, %s, %s, %s, 'new', %s, %s, %s)",
                (uname, dname, subject, text, img, f.get("route"), f["id"], ts, ts),
            )
            imported += 1
    return imported


def _backfill_feedback_requests() -> None:
    """One-time on boot: import pre-existing feedback into the requests portal so the
    history is complete. Guarded by a singleton flag (the underlying import is itself
    idempotent, so this just avoids re-scanning every boot). Best-effort — never
    blocks boot."""
    if _get_singleton("feedback_requests_backfill_done", False):
        return
    try:
        backfill_feedback_into_requests()
    except Exception:  # noqa: BLE001
        return
    _set_singleton("feedback_requests_backfill_done", True)


# ── Anonymous design-options poll ────────────────────────────────────────────
# Backing store for the hosted design presentation's vote (see design_votes in
# _MIGRATIONS). Everything here is anonymous: the only key is the caller-supplied
# random voter_id (a uuid from the browser's localStorage), and no reads ever
# return per-voter rows — only aggregates.

def upsert_design_vote(voter_id: str, choice: int, path: "Any" = None) -> int:
    """Record (or replace) one anonymous vote and return the new total vote count.

    Upsert by voter_id so one device = one vote — re-voting overwrites the prior
    choice instead of stacking. Returns the total number of distinct voters.
    """
    now = now_iso()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO design_votes (voter_id, choice, path, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s) "
            "ON CONFLICT (voter_id) DO UPDATE SET "
            "choice = EXCLUDED.choice, path = EXCLUDED.path, updated_at = EXCLUDED.updated_at",
            (voter_id, int(choice), Json(path) if path is not None else None, now, now),
        )
        row = conn.execute("SELECT COUNT(*) AS n FROM design_votes").fetchone()
    return int(row["n"]) if row else 0


def design_vote_results() -> "dict[str, Any]":
    """Return AGGREGATE poll results only (no identities): total, per-option counts
    for options 1–6, and the winning option (max count; ties → lowest number)."""
    rows = fetch_all("SELECT choice, COUNT(*) AS n FROM design_votes GROUP BY choice")
    counts = {str(i): 0 for i in range(1, 7)}
    total = 0
    for r in rows:
        c = int(r["choice"])
        n = int(r["n"])
        total += n
        if 1 <= c <= 6:
            counts[str(c)] = n
    # winner = highest count; tie broken by lowest option number (1..6 iteration order).
    winner = None
    best = -1
    for i in range(1, 7):
        if counts[str(i)] > best:
            best = counts[str(i)]
            winner = i
    if total == 0:
        winner = None
    return {"total": total, "counts": counts, "winner": winner}


def set_onboarded(username: str, value: bool = True) -> None:
    execute("UPDATE users SET onboarded = %s WHERE username = %s", (bool(value), username))


def save_onboarding(username: str, profile: dict) -> None:
    """Persist the onboarding answers + computed strat profile, and flag done."""
    execute("UPDATE users SET onboarding = %s, onboarded = TRUE WHERE username = %s", (Json(profile or {}), username))


def get_onboarding(username: str) -> Optional[dict]:
    row = fetch_one("SELECT onboarding FROM users WHERE username = %s", (username,))
    return (row or {}).get("onboarding") if row else None


# ── Coupons (admin-generated access codes) ─────────────────────────────────

def create_coupon(code: str, grant: dict, *, max_uses: int = 0,
                  expires_at: Optional[str] = None, note: Optional[str] = None,
                  created_by: Optional[str] = None) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO coupons (code, grant_data, max_uses, expires_at, note, created_by, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (code, Json(grant or {}), int(max_uses or 0), expires_at, note, created_by, now_iso()),
        )
    return get_coupon(code)


def get_coupon(code: str) -> Optional[dict]:
    row = fetch_one("SELECT * FROM coupons WHERE code = %s", (code,))
    return row


def list_coupons() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM coupons ORDER BY created_at DESC").fetchall()
    return list(rows)


def set_coupon_active(code: str, active: bool) -> None:
    execute("UPDATE coupons SET active = %s WHERE code = %s", (bool(active), code))


def redeem_coupon(code: str, username: str) -> dict:
    """Atomically validate + consume a coupon for a user.
    Returns {"ok": True, "grant": {...}} or {"ok": False, "error": "..."}."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM coupons WHERE code = %s FOR UPDATE", (code,)).fetchone()
        if not row:
            return {"ok": False, "error": "Invalid code"}
        if not row["active"]:
            return {"ok": False, "error": "This code is no longer active"}
        if row["expires_at"] and row["expires_at"] < now_iso():
            return {"ok": False, "error": "This code has expired"}
        if row["max_uses"] and row["used_count"] >= row["max_uses"]:
            return {"ok": False, "error": "This code has reached its usage limit"}
        dup = conn.execute(
            "SELECT 1 FROM coupon_redemptions WHERE code = %s AND username = %s",
            (code, username),
        ).fetchone()
        if dup:
            return {"ok": False, "error": "You've already used this code"}
        conn.execute(
            "INSERT INTO coupon_redemptions (code, username, redeemed_at) VALUES (%s, %s, %s)",
            (code, username, now_iso()),
        )
        conn.execute("UPDATE coupons SET used_count = used_count + 1 WHERE code = %s", (code,))
        grant = row["grant_data"] or {}
    return {"ok": True, "grant": grant}


# ── Access requests ("contact admin for access") ───────────────────────────

def create_access_request(username: str, message: Optional[str] = None) -> int:
    row = fetch_one("INSERT INTO access_requests (username, message, created_at) VALUES (%s, %s, %s) RETURNING id", (username, (message or "").strip()[:500], now_iso()))
    return int(row["id"]) if row else 0


def list_access_requests(status: Optional[str] = None) -> list[dict]:
    with get_conn() as conn:
        if status:
            rows = conn.execute(
                "SELECT * FROM access_requests WHERE status = %s ORDER BY created_at DESC", (status,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM access_requests ORDER BY created_at DESC").fetchall()
    return list(rows)


def get_access_request(req_id: int) -> Optional[dict]:
    return fetch_one("SELECT * FROM access_requests WHERE id = %s", (req_id,))


def set_access_request_status(req_id: int, status: str, handled_by: Optional[str]) -> None:
    execute("UPDATE access_requests SET status = %s, handled_by = %s, handled_at = %s WHERE id = %s", (status, handled_by, now_iso(), req_id))


def pending_access_request_count() -> int:
    row = fetch_one("SELECT COUNT(*) AS n FROM access_requests WHERE status = 'pending'")
    return int(row["n"]) if row else 0


# ── Admin → user messages (branded, stored "reply to a user") ────────────────

def create_admin_message(recipient: str, sender: str, title: Optional[str], body: str) -> int:
    """Store an admin-authored message to a single user; return the new id."""
    row = fetch_one(
        "INSERT INTO admin_messages (recipient, sender, title, body, created_at) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (recipient, sender, title, body, now_iso()),
    )
    return int(row["id"]) if row else 0


def list_user_messages(username: str) -> list[dict[str, Any]]:
    """Messages addressed to ``username``, newest first; each carries a computed
    ``read`` boolean (read_at IS NOT NULL)."""
    return fetch_all(
        "SELECT id, sender, title, body, created_at, read_at, "
        "(read_at IS NOT NULL) AS read FROM admin_messages "
        "WHERE recipient = %s ORDER BY id DESC",
        (username,),
    )


def mark_message_read(message_id: int, username: str) -> None:
    """Stamp read_at=now, but ONLY if the row's recipient matches ``username``
    (so a user can't mark someone else's message read). No-op if already read."""
    execute(
        "UPDATE admin_messages SET read_at = %s "
        "WHERE id = %s AND recipient = %s AND read_at IS NULL",
        (now_iso(), message_id, username),
    )


def count_unread_messages(username: str) -> int:
    row = fetch_one(
        "SELECT COUNT(*) AS n FROM admin_messages WHERE recipient = %s AND read_at IS NULL",
        (username,),
    )
    return int(row["n"]) if row else 0


# ── Owner / Requests portal (help-desk: user feedback + internal owner notes) ──
# A "request" is a user feedback (category='user_request') OR an owner note
# (category='owner_note'). Each carries a reply thread (request_replies). The
# Requests-portal endpoints reuse the existing auth/role helpers + the
# admin_messages "Team Message" delivery for replies back to the user.

REQUEST_STATUSES = ("new", "in_progress", "answered", "resolved")
REQUEST_CATEGORIES = ("user_request", "owner_note")


def create_request(user_id: Optional[str], display_name: Optional[str], category: str,
                   subject: Optional[str], body: str, *, media: Optional[str] = None,
                   route: Optional[str] = None, status: str = "new",
                   feedback_id: Optional[int] = None) -> int:
    """Create a request row (a user_request or an owner_note); return its id."""
    if category not in REQUEST_CATEGORIES:
        category = "user_request"
    if status not in REQUEST_STATUSES:
        status = "new"
    ts = now_iso()
    row = fetch_one(
        "INSERT INTO requests (user_id, display_name, category, subject, body, media, route, "
        "status, feedback_id, created_at, updated_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (user_id, display_name, category, (subject or None), (body or ""), media, route,
         status, feedback_id, ts, ts),
    )
    return int(row["id"]) if row else 0


def list_requests(*, category: Optional[str] = None, status: Optional[str] = None,
                  user_id: Optional[str] = None, limit: int = 500) -> list[dict[str, Any]]:
    """Requests newest-first, each with a computed reply_count. Filters compose
    (category / status / owning user)."""
    clauses: List[str] = []
    params: List[Any] = []
    if category:
        clauses.append("r.category = %s"); params.append(category)
    if status:
        clauses.append("r.status = %s"); params.append(status)
    if user_id is not None:
        clauses.append("r.user_id = %s"); params.append(user_id)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    return fetch_all(
        "SELECT r.id, r.user_id, r.display_name, r.category, r.subject, r.body, r.media, "
        "r.route, r.status, r.feedback_id, r.created_at, r.updated_at, "
        "(SELECT COUNT(*) FROM request_replies rr WHERE rr.request_id = r.id) AS reply_count "
        f"FROM requests r{where} ORDER BY r.id DESC LIMIT %s",
        tuple(params),
    )


def get_request(req_id: int) -> Optional[dict[str, Any]]:
    return fetch_one("SELECT * FROM requests WHERE id = %s", (req_id,))


def list_request_replies(req_id: int) -> list[dict[str, Any]]:
    """The reply thread for one request, oldest-first (chronological)."""
    return fetch_all(
        "SELECT id, request_id, author_id, author_name, text, created_at "
        "FROM request_replies WHERE request_id = %s ORDER BY id ASC",
        (req_id,),
    )


def add_request_reply(req_id: int, author_id: Optional[str], author_name: Optional[str],
                      text: str) -> int:
    """Append a reply to a request's thread; bump the request's updated_at."""
    ts = now_iso()
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO request_replies (request_id, author_id, author_name, text, created_at) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (req_id, author_id, author_name, text, ts),
        ).fetchone()
        conn.execute("UPDATE requests SET updated_at = %s WHERE id = %s", (ts, req_id))
    return int(row["id"]) if row else 0


def set_request_status(req_id: int, status: str) -> bool:
    """Update a request's status (one of REQUEST_STATUSES). No-op for an unknown value."""
    if status not in REQUEST_STATUSES:
        return False
    execute("UPDATE requests SET status = %s, updated_at = %s WHERE id = %s",
            (status, now_iso(), req_id))
    return True


# ── Legal Portal · sections + note threads (Raz ↔ owners) ─────────────────────
LEGAL_SECTION_STATUSES = ("open", "resolved")


def list_legal_sections(*, domain: str = "legal", status: Optional[str] = None, limit: int = 500) -> list[dict[str, Any]]:
    """Portal sections for a domain ('legal'|'it'), most-recently-active first, each with its
    note_count and the timestamp of the latest note (for the thread preview)."""
    clauses: List[str] = ["s.domain = %s"]
    params: List[Any] = [domain]
    if status:
        clauses.append("s.status = %s"); params.append(status)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    return fetch_all(
        "SELECT s.id, s.title, s.body, s.status, s.created_by, s.created_name, s.sort, "
        "s.created_at, s.updated_at, "
        "(SELECT COUNT(*) FROM legal_notes n WHERE n.section_id = s.id) AS note_count, "
        "(SELECT MAX(n.created_at) FROM legal_notes n WHERE n.section_id = s.id) AS last_note_at "
        f"FROM legal_sections s{where} "
        "ORDER BY COALESCE((SELECT MAX(n.created_at) FROM legal_notes n WHERE n.section_id = s.id), "
        "s.updated_at, s.created_at) DESC LIMIT %s",
        tuple(params),
    )


def get_legal_section(section_id: int) -> Optional[dict[str, Any]]:
    return fetch_one("SELECT * FROM legal_sections WHERE id = %s", (section_id,))


def create_legal_section(*, title: str, body: str, created_by: Optional[str],
                         created_name: Optional[str], domain: str = "legal") -> int:
    """Open a new section (topic) in a portal domain ('legal'|'it'). Returns the new id."""
    ts = now_iso()
    row = fetch_one(
        "INSERT INTO legal_sections (title, body, status, created_by, created_name, "
        "sort, created_at, updated_at, domain) VALUES (%s, %s, 'open', %s, %s, 0, %s, %s, %s) RETURNING id",
        (title or "", body or "", created_by, created_name, ts, ts, domain),
    )
    return int(row["id"]) if row else 0


_LEGAL_SECTION_FIELDS = {"title", "body", "status", "sort"}


def update_legal_section(section_id: int, fields: dict[str, Any]) -> bool:
    """Patch an allowed subset of a section's columns (title/body/status/sort)."""
    cols = [(k, v) for k, v in fields.items() if k in _LEGAL_SECTION_FIELDS]
    if not cols:
        return False
    if any(k == "status" and v not in LEGAL_SECTION_STATUSES for k, v in cols):
        return False
    sets = ", ".join(f"{k} = %s" for k, _ in cols) + ", updated_at = %s"
    params = [v for _, v in cols] + [now_iso(), section_id]
    execute(f"UPDATE legal_sections SET {sets} WHERE id = %s", tuple(params))
    return True


def delete_legal_section(section_id: int) -> None:
    execute("DELETE FROM legal_sections WHERE id = %s", (section_id,))


def list_legal_notes(section_id: int) -> list[dict[str, Any]]:
    """The note thread for one section, oldest-first (chronological)."""
    return fetch_all(
        "SELECT id, section_id, author_id, author_name, body, created_at "
        "FROM legal_notes WHERE section_id = %s ORDER BY id ASC",
        (section_id,),
    )


def add_legal_note(section_id: int, author_id: Optional[str], author_name: Optional[str],
                   body: str) -> int:
    """Append a note/reply to a section's thread; bump the section's updated_at."""
    ts = now_iso()
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO legal_notes (section_id, author_id, author_name, body, created_at) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (section_id, author_id, author_name, body, ts),
        ).fetchone()
        conn.execute("UPDATE legal_sections SET updated_at = %s WHERE id = %s", (ts, section_id))
    return int(row["id"]) if row else 0


def delete_legal_note(note_id: int) -> None:
    execute("DELETE FROM legal_notes WHERE id = %s", (note_id,))


def list_legal_chat(since_id: int = 0, limit: int = 300, *, domain: str = "legal") -> list[dict[str, Any]]:
    """A portal domain's chat-room messages after `since_id`, oldest-first (id ASC) — the
    incremental long-poll shape. `limit` caps a cold first load."""
    return fetch_all(
        "SELECT id, author_id, author_name, body, created_at FROM legal_chat "
        "WHERE domain = %s AND id > %s ORDER BY id ASC LIMIT %s",
        (domain, int(since_id or 0), int(limit)),
    )


def add_legal_chat(author_id: Optional[str], author_name: Optional[str], body: str, *, domain: str = "legal") -> int:
    """Post a message to a portal domain's chat room. Returns the new id."""
    row = fetch_one(
        "INSERT INTO legal_chat (author_id, author_name, body, created_at, domain) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (author_id, author_name, body, now_iso(), domain),
    )
    return int(row["id"]) if row else 0


# ── IT portal "ניהול ועריכה" store — editable docs + system links (Oren) ──────────
def list_it_docs() -> "list[dict[str, Any]]":
    """IT notes/documentation entries, most-recently-updated first."""
    return fetch_all(
        "SELECT id, title, body, sort, created_at, updated_at, updated_by FROM it_docs "
        "ORDER BY sort ASC, COALESCE(updated_at, created_at) DESC, id DESC"
    )


def upsert_it_doc(*, doc_id: Optional[int], title: str, body: str, updated_by: Optional[str]) -> dict[str, Any]:
    """Create (doc_id None) or edit an IT doc. Returns the row."""
    now = now_iso()
    if doc_id:
        row = fetch_one(
            "UPDATE it_docs SET title = %s, body = %s, updated_at = %s, updated_by = %s WHERE id = %s RETURNING *",
            (title or "", body or "", now, updated_by, doc_id),
        )
        if row:
            return row
    row = fetch_one(
        "INSERT INTO it_docs (title, body, sort, created_at, updated_at, updated_by) "
        "VALUES (%s, %s, 0, %s, %s, %s) RETURNING *",
        (title or "", body or "", now, now, updated_by),
    )
    return row or {}


def delete_it_doc(doc_id: int) -> None:
    execute("DELETE FROM it_docs WHERE id = %s", (doc_id,))


def list_it_links() -> "list[dict[str, Any]]":
    """The 'link your system to us' entries — Oren's links/connections/references for the owners."""
    return fetch_all(
        "SELECT id, label, url, note, sort, created_at, updated_at, updated_by FROM it_links "
        "ORDER BY sort ASC, COALESCE(updated_at, created_at) DESC, id DESC"
    )


def upsert_it_link(*, link_id: Optional[int], label: str, url: str, note: str, updated_by: Optional[str]) -> dict[str, Any]:
    """Create (link_id None) or edit an IT system link. Returns the row."""
    now = now_iso()
    if link_id:
        row = fetch_one(
            "UPDATE it_links SET label = %s, url = %s, note = %s, updated_at = %s, updated_by = %s WHERE id = %s RETURNING *",
            (label or "", url or "", note or "", now, updated_by, link_id),
        )
        if row:
            return row
    row = fetch_one(
        "INSERT INTO it_links (label, url, note, sort, created_at, updated_at, updated_by) "
        "VALUES (%s, %s, %s, 0, %s, %s, %s) RETURNING *",
        (label or "", url or "", note or "", now, now, updated_by),
    )
    return row or {}


def delete_it_link(link_id: int) -> None:
    execute("DELETE FROM it_links WHERE id = %s", (link_id,))


# ── Biz-dev portal store (Raful) — docs WITH an optional uploaded file + links ────
# biz_docs mirrors it_docs but adds a real file (base64 data-URL in file_data, like avatars).
# The list NEVER returns file_data (the heavy blob) — only metadata + a has_file flag; the
# bytes are fetched one-at-a-time via get_biz_doc_file for download. Keeps list queries light.
def list_biz_docs() -> "list[dict[str, Any]]":
    """Biz-dev documents & materials, most-recently-updated first. Metadata only — the file
    blob (file_data) is deliberately excluded so the list stays small; download fetches it."""
    return fetch_all(
        "SELECT id, title, body, file_name, file_type, file_size, "
        "(file_data <> '') AS has_file, sort, created_at, updated_at, updated_by FROM biz_docs "
        "ORDER BY sort ASC, COALESCE(updated_at, created_at) DESC, id DESC"
    )


def get_biz_doc_file(doc_id: int) -> "Optional[dict[str, Any]]":
    """One doc's file payload for download — file_name, file_type, file_data (base64 data-URL)."""
    return fetch_one("SELECT id, file_name, file_type, file_data FROM biz_docs WHERE id = %s", (doc_id,))


def upsert_biz_doc(*, doc_id: Optional[int], title: str, body: str,
                   file_name: Optional[str] = None, file_type: Optional[str] = None,
                   file_data: Optional[str] = None, file_size: Optional[int] = None,
                   updated_by: Optional[str]) -> dict[str, Any]:
    """Create (doc_id None) or edit a biz doc. The FILE is optional and only touched when
    file_data is not None: '' clears the file, a data-URL sets a new one; None (the default)
    leaves the existing file untouched on an edit. Returns the row WITHOUT the file blob."""
    now = now_iso()
    cols = "id, title, body, file_name, file_type, file_size, (file_data <> '') AS has_file, sort, created_at, updated_at, updated_by"
    if doc_id:
        if file_data is None:
            # text-only edit — never disturb the stored file
            execute(
                "UPDATE biz_docs SET title = %s, body = %s, updated_at = %s, updated_by = %s WHERE id = %s",
                (title or "", body or "", now, updated_by, doc_id),
            )
        else:
            execute(
                "UPDATE biz_docs SET title = %s, body = %s, file_name = %s, file_type = %s, "
                "file_data = %s, file_size = %s, updated_at = %s, updated_by = %s WHERE id = %s",
                (title or "", body or "", file_name or "", file_type or "", file_data or "",
                 int(file_size or 0), now, updated_by, doc_id),
            )
        row = fetch_one(f"SELECT {cols} FROM biz_docs WHERE id = %s", (doc_id,))
        if row:
            return row
    row = fetch_one(
        "INSERT INTO biz_docs (title, body, file_name, file_type, file_data, file_size, sort, created_at, updated_at, updated_by) "
        f"VALUES (%s, %s, %s, %s, %s, %s, 0, %s, %s, %s) RETURNING {cols}",
        (title or "", body or "", file_name or "", file_type or "", file_data or "",
         int(file_size or 0), now, now, updated_by),
    )
    return row or {}


def delete_biz_doc(doc_id: int) -> None:
    execute("DELETE FROM biz_docs WHERE id = %s", (doc_id,))


def list_biz_links() -> "list[dict[str, Any]]":
    """Biz-dev links & sources — Raful's references/resources for the owners to see."""
    return fetch_all(
        "SELECT id, label, url, note, sort, created_at, updated_at, updated_by FROM biz_links "
        "ORDER BY sort ASC, COALESCE(updated_at, created_at) DESC, id DESC"
    )


def upsert_biz_link(*, link_id: Optional[int], label: str, url: str, note: str, updated_by: Optional[str]) -> dict[str, Any]:
    """Create (link_id None) or edit a biz link. Returns the row."""
    now = now_iso()
    if link_id:
        row = fetch_one(
            "UPDATE biz_links SET label = %s, url = %s, note = %s, updated_at = %s, updated_by = %s WHERE id = %s RETURNING *",
            (label or "", url or "", note or "", now, updated_by, link_id),
        )
        if row:
            return row
    row = fetch_one(
        "INSERT INTO biz_links (label, url, note, sort, created_at, updated_at, updated_by) "
        "VALUES (%s, %s, %s, 0, %s, %s, %s) RETURNING *",
        (label or "", url or "", note or "", now, now, updated_by),
    )
    return row or {}


def delete_biz_link(link_id: int) -> None:
    execute("DELETE FROM biz_links WHERE id = %s", (link_id,))


# ── PM task comments — owner direction/feedback on tasks (+ the assignee's replies) ──
def list_pm_task_comments(task_id: int) -> "list[dict[str, Any]]":
    """A task's comment thread, oldest-first (chronological)."""
    return fetch_all(
        "SELECT id, task_id, author, author_name, text, created_at FROM pm_task_comments "
        "WHERE task_id = %s ORDER BY id ASC",
        (task_id,),
    )


def add_pm_task_comment(task_id: int, author: Optional[str], author_name: Optional[str], text: str) -> dict[str, Any]:
    """Append a comment to a task's thread. Returns the new row."""
    row = fetch_one(
        "INSERT INTO pm_task_comments (task_id, author, author_name, text, created_at) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id, task_id, author, author_name, text, created_at",
        (task_id, author, author_name, text, now_iso()),
    )
    return row or {}


def delete_pm_task_comment(comment_id: int) -> None:
    execute("DELETE FROM pm_task_comments WHERE id = %s", (comment_id,))


def comments_by_task(task_ids: "list[int]") -> "dict[int, list[dict[str, Any]]]":
    """Bulk-load comments for many tasks at once (for the daily report). Returns {task_id: [rows]}
    oldest-first. Empty dict when no ids, so the report never fires a query per task."""
    ids = [int(t) for t in (task_ids or []) if t]
    if not ids:
        return {}
    rows = fetch_all(
        "SELECT id, task_id, author, author_name, text, created_at FROM pm_task_comments "
        "WHERE task_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    )
    out: "dict[int, list[dict[str, Any]]]" = {}
    for r in rows:
        out.setdefault(int(r["task_id"]), []).append(r)
    return out


# ── Account lockout (brute-force protection) ──────────────────────────────────

from datetime import timedelta  # noqa: E402

_MAX_FAILED = 5          # lock after this many consecutive failures
_LOCK_MINUTES = 15       # stay locked this long


def lock_status(username: str) -> Optional[str]:
    """Return the ISO time the account is locked until, or None if not locked."""
    row = fetch_one("SELECT locked_until FROM users WHERE username = %s", (username,))
    if not row or not row.get("locked_until"):
        return None
    try:
        until = datetime.fromisoformat(row["locked_until"])
    except (ValueError, TypeError):
        return None
    return row["locked_until"] if until > datetime.now(timezone.utc) else None


def record_failed_login(username: str) -> None:
    """Increment the failure counter; lock the account once the cap is hit."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT failed_attempts FROM users WHERE username = %s", (username,)
        ).fetchone()
        if not row:
            return
        attempts = (row.get("failed_attempts") or 0) + 1
        locked_until = None
        if attempts >= _MAX_FAILED:
            locked_until = (datetime.now(timezone.utc) + timedelta(minutes=_LOCK_MINUTES)).isoformat()
            attempts = 0  # reset counter; the lock now gates access
        conn.execute(
            "UPDATE users SET failed_attempts = %s, locked_until = %s WHERE username = %s",
            (attempts, locked_until, username),
        )


def clear_failed_login(username: str) -> None:
    execute("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE username = %s", (username,))


# ── Audit trail (append-only) ─────────────────────────────────────────────────

def add_audit(action: str, *, actor: Optional[str] = None, target: Optional[str] = None,
              ip: Optional[str] = None, detail: Optional[dict] = None) -> None:
    execute("INSERT INTO audit_log (ts, actor, action, target, ip, detail) "
            "VALUES (%s, %s, %s, %s, %s, %s)", (now_iso(), actor, action, target, ip, Json(detail or {})))


def list_audit(limit: int = 200) -> List[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, actor, action, target, ip, detail FROM audit_log "
            "ORDER BY id DESC LIMIT %s", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def list_audit_for(username: str, limit: int = 1000) -> List[dict]:
    """Audit entries where the user was the actor or the target (for data export)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, actor, action, target, ip, detail FROM audit_log "
            "WHERE actor = %s OR target = %s ORDER BY id DESC LIMIT %s",
            (username, username, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def count_admins() -> int:
    row = fetch_one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    return int(row["n"]) if row else 0


# ── Password reset tokens (admin-issued, one-time) ────────────────────────────

def create_password_reset(username: str, token: str, ttl_hours: int = 24) -> str:
    expires = (datetime.now(timezone.utc) + timedelta(hours=ttl_hours)).isoformat()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO password_resets (token, username, created_at, expires_at) "
            "VALUES (%s, %s, %s, %s)",
            (token, username, now_iso(), expires),
        )
    return expires


def consume_password_reset(token: str) -> Optional[str]:
    """Validate + burn a reset token. Returns the username, or None if invalid."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT username, expires_at, used_at FROM password_resets WHERE token = %s",
            (token,),
        ).fetchone()
        if not row or row.get("used_at"):
            return None
        try:
            if datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
                return None
        except (ValueError, TypeError):
            return None
        conn.execute("UPDATE password_resets SET used_at = %s WHERE token = %s",
                     (now_iso(), token))
        return row["username"]


# ── Sessions ────────────────────────────────────────────────────────────────

def create_session(token: str, username: str) -> None:
    execute("INSERT INTO auth_sessions (token, username, created_at) VALUES (%s, %s, %s)", (token, username, now_iso()))


def get_session_user(token: str) -> Optional[str]:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT username FROM auth_sessions WHERE token = %s", (token,)
        )
        row = cur.fetchone()
        return row["username"] if row else None


def get_session(token: str) -> Optional[dict[str, Any]]:
    """Resolve a bearer token to its session row (username + issued-at), or None.

    The auth gate uses this instead of get_session_user() because it needs the
    session's `created_at` (the issued-at) to enforce active session invalidation
    — force-logging-out non-admin sessions issued before the disconnect cutoff."""
    if not token:
        return None
    return fetch_one(
        "SELECT username, created_at FROM auth_sessions WHERE token = %s", (token,)
    )


def touch_session(token: str) -> None:
    """Mark a session as active (throttled to ~30s to limit writes)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
    with get_conn() as conn:
        conn.execute(
            "UPDATE auth_sessions SET last_seen = %s WHERE token = %s "
            "AND (last_seen IS NULL OR last_seen < %s)",
            (now_iso(), token, cutoff),
        )


def list_sessions() -> list[dict[str, Any]]:
    """One row per logged-in user: when they signed in + last activity + session count."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT username, MIN(created_at) AS since, "
            "MAX(COALESCE(last_seen, created_at)) AS last_seen, COUNT(*) AS sessions "
            "FROM auth_sessions GROUP BY username ORDER BY since"
        ).fetchall()
    return [dict(r) for r in rows]


def delete_session(token: str) -> None:
    execute("DELETE FROM auth_sessions WHERE token = %s", (token,))


# ── Runs ────────────────────────────────────────────────────────────────────

def _row_to_run(row: dict[str, Any]) -> Run:
    return Run(
        id=row["id"], name=row["name"], status=row["status"],
        buckets=row["buckets"] or [],
        totalSymbols=row["total_symbols"],
        completedSymbols=row["completed_symbols"],
        failedSymbols=row["failed_symbols"],
        createdAt=row["created_at"], completedAt=row["completed_at"],
        config=StrategyConfig(**(row["config"] or {})),
        errorMessage=row["error_message"],
        saved=bool(row.get("saved")),
    )


def save_run(run: Run) -> None:
    # Note: `saved` is set only on INSERT (run.saved, default FALSE) and is
    # deliberately NOT in the DO UPDATE set, so a status re-save can never reset a
    # run the user already saved. mark_run_saved() owns flipping it to TRUE.
    execute("""
            INSERT INTO runs
              (id, name, status, buckets, total_symbols, completed_symbols, failed_symbols,
               created_at, completed_at, config, error_message, saved)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, status = EXCLUDED.status, buckets = EXCLUDED.buckets,
                total_symbols = EXCLUDED.total_symbols,
                completed_symbols = EXCLUDED.completed_symbols,
                failed_symbols = EXCLUDED.failed_symbols,
                created_at = EXCLUDED.created_at, completed_at = EXCLUDED.completed_at,
                config = EXCLUDED.config, error_message = EXCLUDED.error_message
            """, (run.id, run.name, run.status, Json(run.buckets),
             run.totalSymbols, run.completedSymbols, run.failedSymbols,
             run.createdAt, run.completedAt, Json(run.config.model_dump()), run.errorMessage,
             bool(getattr(run, "saved", False))))


def mark_run_saved(run_id: str) -> None:
    """Persist (keep) a run: flip it from ephemeral to saved so it appears in the
    history list and survives the unsaved-run purge."""
    execute("UPDATE runs SET saved = TRUE WHERE id = %s", (run_id,))


def purge_unsaved_runs(older_than_hours: int = 24) -> int:
    """Discard stale EPHEMERAL (unsaved) runs — the backstop that keeps unsaved
    runs from accumulating when the client doesn't clean them up itself.

    Only deletes runs that are saved=FALSE, finished (never an in-flight run), and
    older than the cutoff, so it can never touch a saved run or a run still being
    viewed/executed right now. Returns the number removed."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max(1, older_than_hours))).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM runs WHERE saved = FALSE AND created_at < %s "
            "AND status NOT IN ('running', 'pending')",
            (cutoff,),
        )
        try:
            return cur.rowcount or 0
        except Exception:  # noqa: BLE001
            return 0


def update_run_status(run_id: str, status: str, completed_at: Optional[str] = None,
                      error_message: Optional[str] = None, total_symbols: Optional[int] = None,
                      completed_symbols: Optional[int] = None,
                      failed_symbols: Optional[int] = None) -> None:
    fields = ["status = %s"]
    values: List[Any] = [status]
    for col, val in (
        ("completed_at", completed_at), ("error_message", error_message),
        ("total_symbols", total_symbols), ("completed_symbols", completed_symbols),
        ("failed_symbols", failed_symbols),
    ):
        if val is not None:
            fields.append(f"{col} = %s")
            values.append(val)
    values.append(run_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE runs SET {', '.join(fields)} WHERE id = %s", values)


def increment_run_progress(run_id: str, success: bool) -> None:
    col = "completed_symbols" if success else "failed_symbols"
    with get_conn() as conn:
        conn.execute(f"UPDATE runs SET {col} = {col} + 1 WHERE id = %s", (run_id,))


def reconcile_interrupted_runs() -> int:
    """Mark runs still 'running'/'pending' as failed on startup.

    Backtest tasks live in-memory in the runner; if the backend restarts (deploy,
    crash, reboot) their tasks are gone but the DB row stays 'running' forever,
    so the UI shows runs stuck at a low %. Called once at startup to clear them.
    Returns the number of rows reconciled.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE runs SET status = 'failed', completed_at = %s, "
            "error_message = 'Interrupted by a server restart — please run again.' "
            "WHERE status IN ('running', 'pending')",
            (now,),
        )
        try:
            return cur.rowcount or 0
        except Exception:
            return 0


def get_run(run_id: str) -> Optional[Run]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = %s", (run_id,)).fetchone()
        return _row_to_run(row) if row else None


def list_runs() -> List[Run]:
    # History shows ONLY explicitly-saved runs. The currently-running / just-finished
    # ephemeral run is fetched directly by id via get_run(), so it stays viewable
    # without polluting the saved history.
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM runs WHERE saved = TRUE ORDER BY created_at DESC"
        ).fetchall()
        return [_row_to_run(r) for r in rows]


def delete_run(run_id: str) -> None:
    execute("DELETE FROM runs WHERE id = %s", (run_id,))


# ── Results ─────────────────────────────────────────────────────────────────

def _row_to_result(row: dict[str, Any]) -> BacktestResult:
    return BacktestResult(
        symbol=row["symbol"], name=row["name"], bucket=row["bucket"],
        totalReturn=row["total_return"] or 0.0, cagr=row["cagr"] or 0.0,
        maxDrawdown=row["max_drawdown"] or 0.0, winRate=row["win_rate"] or 0.0,
        sharpe=row["sharpe"] or 0.0, tradeCount=row["trade_count"] or 0,
        initialCapital=row["initial_capital"] or DEFAULT_BUCKET_AMOUNT,
        isReturnOutlier=bool(row["is_return_outlier"]),
        isDrawdownOutlier=bool(row["is_drawdown_outlier"]),
        errorMessage=row["error_message"],
    )


def save_result(run_id: str, result: BacktestResult,
                equity_curve: List[EquityCurvePoint], trades: List[Trade]) -> None:
    execute("""
            INSERT INTO backtest_results
              (run_id, symbol, name, bucket, total_return, cagr, max_drawdown, win_rate,
               sharpe, trade_count, initial_capital, is_return_outlier, is_drawdown_outlier,
               error_message, equity_curve, trades)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (run_id, symbol) DO UPDATE SET
                name = EXCLUDED.name, bucket = EXCLUDED.bucket,
                total_return = EXCLUDED.total_return, cagr = EXCLUDED.cagr,
                max_drawdown = EXCLUDED.max_drawdown, win_rate = EXCLUDED.win_rate,
                sharpe = EXCLUDED.sharpe, trade_count = EXCLUDED.trade_count,
                initial_capital = EXCLUDED.initial_capital,
                is_return_outlier = EXCLUDED.is_return_outlier,
                is_drawdown_outlier = EXCLUDED.is_drawdown_outlier,
                error_message = EXCLUDED.error_message,
                equity_curve = EXCLUDED.equity_curve, trades = EXCLUDED.trades
            """, (run_id, result.symbol, result.name, result.bucket,
             result.totalReturn, result.cagr, result.maxDrawdown, result.winRate,
             result.sharpe, result.tradeCount, result.initialCapital,
             bool(result.isReturnOutlier), bool(result.isDrawdownOutlier),
             result.errorMessage,
             Json([p.model_dump() for p in equity_curve]),
             Json([t.model_dump() for t in trades])))


_ALLOWED_SORT = {
    "symbol", "bucket", "total_return", "cagr", "max_drawdown",
    "win_rate", "sharpe", "trade_count",
}
_SORT_COL = {
    "totalReturn": "total_return", "maxDrawdown": "max_drawdown",
    "winRate": "win_rate", "tradeCount": "trade_count",
}


def get_results(run_id: str, bucket: Optional[str] = None,
                sort_by: str = "cagr", sort_dir: str = "desc") -> List[BacktestResult]:
    db_col = _SORT_COL.get(sort_by, sort_by)
    if db_col not in _ALLOWED_SORT:
        db_col = "cagr"
    direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
    query = "SELECT * FROM backtest_results WHERE run_id = %s"
    params: List[Any] = [run_id]
    if bucket:
        query += " AND bucket = %s"
        params.append(bucket)
    query += f" ORDER BY {db_col} {direction}"
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
        return [_row_to_result(r) for r in rows]


def get_symbol_detail(run_id: str, symbol: str):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM backtest_results WHERE run_id = %s AND symbol = %s",
            (run_id, symbol),
        ).fetchone()
        if not row:
            return None
        result = _row_to_result(row)
        equity_curve = [EquityCurvePoint(**p) for p in (row["equity_curve"] or [])]
        trades = [Trade(**t) for t in (row["trades"] or [])]
        return result, equity_curve, trades


# Absolute implausibility ceiling on total_return (stored as a PERCENT, so 1000 =
# 1000% = 10×). A single backtest returning ≥10× is almost always a data artifact
# — a micro-priced coin, a bad warm-up, a stale split — not a real edge. Such a
# result is flagged as a return outlier REGARDLESS of the run's distribution, so a
# degenerate "+15,333%" never gets to headline the dashboard as the best performer.
OUTLIER_RETURN_PCT = 1000.0


def flag_outliers(run_id: str) -> None:
    """Flag implausible results so the dashboard headline never showcases them.

    Two independent tests, OR'd onto ``is_return_outlier``:
      • Absolute — ``abs(total_return) >= OUTLIER_RETURN_PCT`` (10×). Applies to
        EVERY run, including a single-symbol run where there is no cohort to derive
        a sigma from (the old >3σ-only test silently skipped runs with <4 results,
        so a lone blow-up sailed through).
      • Statistical — >3σ from the run's mean on return and drawdown. Only applied
        when there are enough results (≥4) for a meaningful spread.
    """
    import numpy as np

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT symbol, total_return, max_drawdown FROM backtest_results "
            "WHERE run_id = %s AND error_message IS NULL",
            (run_id,),
        ).fetchall()
        if not rows:
            return
        have_cohort = len(rows) >= 4
        ret_mean = ret_std = dd_mean = dd_std = 0.0
        if have_cohort:
            returns = np.array([r["total_return"] for r in rows], dtype=float)
            drawdowns = np.array([r["max_drawdown"] for r in rows], dtype=float)
            ret_mean, ret_std = float(np.mean(returns)), float(np.std(returns))
            dd_mean, dd_std = float(np.mean(drawdowns)), float(np.std(drawdowns))
        for row in rows:
            ret = float(row["total_return"] or 0.0)
            # Absolute ceiling first — independent of any cohort.
            is_ret = abs(ret) >= OUTLIER_RETURN_PCT
            is_dd = False
            if have_cohort:
                if ret_std > 0 and abs(ret - ret_mean) > 3 * ret_std:
                    is_ret = True
                if dd_std > 0 and abs(float(row["max_drawdown"] or 0.0) - dd_mean) > 3 * dd_std:
                    is_dd = True
            conn.execute(
                "UPDATE backtest_results SET is_return_outlier = %s, is_drawdown_outlier = %s "
                "WHERE run_id = %s AND symbol = %s",
                (bool(is_ret), bool(is_dd), run_id, row["symbol"]),
            )


def get_dashboard_summary() -> dict[str, Any]:
    with get_conn() as conn:
        total_runs = conn.execute("SELECT COUNT(*) AS n FROM runs").fetchone()["n"]
        completed_runs = conn.execute(
            "SELECT COUNT(*) AS n FROM runs WHERE status = 'completed'"
        ).fetchone()["n"]
        total_symbols = conn.execute(
            "SELECT COUNT(*) AS n FROM backtest_results WHERE error_message IS NULL"
        ).fetchone()["n"]
        # Headline best/worst exclude flagged outliers so the dashboard never
        # showcases a degenerate result (e.g. a +15,333% micro-cap blow-up) as the
        # "best performer". Flagged rows still exist + are returned per-run (just
        # badged in the table) — they're only kept out of these summary extremes.
        best = conn.execute(
            "SELECT symbol, total_return FROM backtest_results WHERE error_message IS NULL "
            "AND is_return_outlier = FALSE "
            "ORDER BY total_return DESC LIMIT 1"
        ).fetchone()
        worst = conn.execute(
            "SELECT symbol, max_drawdown FROM backtest_results WHERE error_message IS NULL "
            "AND is_drawdown_outlier = FALSE "
            "ORDER BY max_drawdown ASC LIMIT 1"
        ).fetchone()
        avg_sharpe = conn.execute(
            "SELECT AVG(sharpe) AS s FROM backtest_results WHERE error_message IS NULL"
        ).fetchone()["s"]
        bucket_rows = conn.execute(
            """
            SELECT bucket,
                   COUNT(*) AS cnt,
                   AVG(total_return) AS avg_ret,
                   AVG(sharpe) AS avg_sharpe,
                   SUM(initial_capital) AS start_amt,
                   SUM(initial_capital * (1 + total_return / 100.0)) AS end_val
            FROM backtest_results WHERE error_message IS NULL GROUP BY bucket
            """
        ).fetchall()
        return {
            "totalRuns": total_runs,
            "completedRuns": completed_runs,
            "totalSymbolsTested": total_symbols,
            "bestPerformer": best["symbol"] if best else None,
            "bestPerformerReturn": best["total_return"] if best else None,
            "worstDrawdown": worst["symbol"] if worst else None,
            "worstDrawdownPct": worst["max_drawdown"] if worst else None,
            "avgSharpe": avg_sharpe,
            "bucketBreakdown": [
                {"bucket": r["bucket"], "symbolCount": r["cnt"],
                 "avgReturn": r["avg_ret"] or 0, "avgSharpe": r["avg_sharpe"] or 0,
                 "startingAmount": r["start_amt"] or 0, "endingValue": r["end_val"] or 0}
                for r in bucket_rows
            ],
        }


# ── Saved strategies ────────────────────────────────────────────────────────

def save_strategy(name: str, strategy_id: str, config: dict[str, Any],
                  pine_source: Optional[str] = None, owner: Optional[str] = None) -> dict[str, Any]:
    row = fetch_one("INSERT INTO saved_strategies (name, strategy_id, config, pine_source, created_at, owner) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id", (name, strategy_id, Json(config), pine_source, now_iso(), owner))
    return {"id": row["id"] if row else None, "name": name,
            "strategyId": strategy_id, "config": config, "pineSource": pine_source, "owner": owner}


def list_saved_strategies() -> List[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, strategy_id, config, pine_source, created_at, owner "
            "FROM saved_strategies ORDER BY created_at DESC"
        ).fetchall()
    return [{"id": r["id"], "name": r["name"], "strategyId": r["strategy_id"],
             "config": r["config"], "pineSource": r["pine_source"],
             "createdAt": r["created_at"], "owner": r.get("owner")} for r in rows]


def get_saved_strategy(strategy_id: int) -> Optional[dict[str, Any]]:
    r = fetch_one("SELECT id, name, strategy_id, config, pine_source, created_at, owner "
            "FROM saved_strategies WHERE id = %s", (strategy_id,))
    if not r:
        return None
    return {"id": r["id"], "name": r["name"], "strategyId": r["strategy_id"],
            "config": r["config"], "pineSource": r["pine_source"], "createdAt": r["created_at"], "owner": r.get("owner")}


def update_saved_strategy(strategy_id: int, *, name: Optional[str] = None,
                          config: Optional[dict[str, Any]] = None, pine_source: Optional[str] = None) -> Optional[dict[str, Any]]:
    sets, vals = [], []
    if name is not None:
        sets.append("name = %s"); vals.append(name)
    if config is not None:
        sets.append("config = %s"); vals.append(Json(config))
        sets.append("strategy_id = %s"); vals.append(str(config.get("strategyId") or "bot8c"))
    if pine_source is not None:
        sets.append("pine_source = %s"); vals.append(pine_source)
    if sets:
        vals.append(strategy_id)
        with get_conn() as conn:
            conn.execute(f"UPDATE saved_strategies SET {', '.join(sets)} WHERE id = %s", tuple(vals))
    return get_saved_strategy(strategy_id)


def delete_saved_strategy(strategy_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM saved_strategies WHERE id = %s", (strategy_id,))
    return True


# ── Strategy help requests (user → admin) ────────────────────────────────────

def create_help_request(username: str, source: str, message: str) -> dict[str, Any]:
    row = fetch_one("INSERT INTO strategy_help (username, source, message, status, created_at) "
            "VALUES (%s, %s, %s, 'open', %s) RETURNING id", (username, source, message, now_iso()))
    return {"id": row["id"] if row else None}


def list_help_requests() -> List[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM strategy_help ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def list_my_help_requests(username: str) -> List[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM strategy_help WHERE username = %s ORDER BY created_at DESC", (username,)).fetchall()
    return [dict(r) for r in rows]


def get_help_request(req_id: int) -> Optional[dict[str, Any]]:
    r = fetch_one("SELECT * FROM strategy_help WHERE id = %s", (req_id,))
    return dict(r) if r else None


def answer_help_request(req_id: int, answer: str) -> bool:
    with get_conn() as conn:
        conn.execute("UPDATE strategy_help SET answer = %s, status = 'answered', answered_at = %s WHERE id = %s",
                     (answer, now_iso(), req_id))
    return True


# ── Singleton config blobs (exchange / profit / telegram) ────────────────────

def _get_singleton(key: str, default: Any) -> Any:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM config_singletons WHERE key = %s", (key,)).fetchone()
        return row["value"] if row else default


def _set_singleton(key: str, value: Any) -> None:
    execute("INSERT INTO config_singletons (key, value) VALUES (%s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (key, Json(value)))


# ── Global maintenance / "under development" flag (app-wide, NOT per-user) ────
# When ON, every NON-admin user is shown a full-screen "under development" splash
# instead of the app; admins always keep full access. Stored as a singleton so an
# admin can flip it at runtime. DEFAULT = ON (the owner wants it active on deploy).

def get_maintenance() -> bool:
    val = _get_singleton("maintenance_mode", {"on": True})
    if isinstance(val, dict):
        return bool(val.get("on", True))
    return bool(val)


# Cheap in-process cache for the maintenance flag. The backend maintenance gate
# (auth middleware) consults this on EVERY protected request, so we must not hit
# Postgres each time. Short TTL → an admin toggle still takes effect within a few
# seconds; set_maintenance() busts it immediately so the owner sees it instantly.
_MAINT_CACHE: "dict[str, Any]" = {"val": None, "ts": 0.0}


def get_maintenance_cached(ttl: float = 5.0) -> bool:
    import time
    now = time.monotonic()
    cached = _MAINT_CACHE["val"]
    if cached is not None and (now - _MAINT_CACHE["ts"]) <= ttl:
        return bool(cached)
    try:
        val = get_maintenance()
    except Exception:  # noqa: BLE001 — a DB blip must never decide the gate by itself
        # Reuse the last known value if we have one; otherwise treat as OFF so a
        # transient error can't lock the entire user base out of the app.
        return bool(cached) if cached is not None else False
    _MAINT_CACHE["val"] = val
    _MAINT_CACHE["ts"] = now
    return bool(val)


def set_maintenance(on: bool) -> bool:
    import time
    _set_singleton("maintenance_mode", {"on": bool(on)})
    _MAINT_CACHE["val"] = bool(on)  # bust the gate cache so the flip is instant
    _MAINT_CACHE["ts"] = time.monotonic()
    # Locking the app (maintenance ON) also actively disconnects every CURRENT
    # non-admin session: their tokens are stamped as pre-cutoff and the auth gate
    # 401s them so they're bounced to the login screen, not merely blocked. Admins
    # are never affected. Turning maintenance OFF leaves the cutoff in place (old
    # non-admin sessions stay invalidated; fresh logins are post-cutoff and pass).
    if on:
        try:
            bump_nonadmin_session_cutoff()
        except Exception:  # noqa: BLE001 — a cutoff write must never break the toggle
            pass
    return bool(on)


# ── Compliance switches (server-side, owner-approved 2026-07-18) ─────────────
# Two independent flags, both stored as runtime-flippable singletons:
#
#   btc_only_compliance  — DEFAULT OFF. When ON, a restricted CLIENT may trade /
#     paper-trade / backtest only BITCOIN pairs (the narrowest legally-safe scope
#     from the Raz meeting: BTC is not a security). Owners are exempt. OFF by
#     default so nothing changes until the owners deliberately turn it on.
#
#   client_autopilot_frozen — DEFAULT ON. A guard that keeps any CLIENT-facing
#     autopilot / autonomous-execution real-money path frozen (the highest
#     regulatory exposure). Owners are exempt. ON by default so the risky path
#     is closed unless the owners deliberately open it. (Autopilots are owner-only
#     today, so this changes nothing now; it's a forward guard.)

def get_btc_only() -> bool:
    val = _get_singleton("btc_only_compliance", {"on": False})  # DEFAULT OFF
    return bool(val.get("on", False)) if isinstance(val, dict) else bool(val)


_BTCONLY_CACHE: "dict[str, Any]" = {"val": None, "ts": 0.0}


def get_btc_only_cached(ttl: float = 5.0) -> bool:
    """Cheap cache — the per-order/paper/backtest choke points consult this."""
    import time
    now = time.monotonic()
    cached = _BTCONLY_CACHE["val"]
    if cached is not None and (now - _BTCONLY_CACHE["ts"]) <= ttl:
        return bool(cached)
    try:
        val = get_btc_only()
    except Exception:  # noqa: BLE001 — a DB blip must not silently DISABLE a compliance guard
        # Fail toward the SAFE side for a compliance restriction: if we can't
        # read it, keep the last known value; if none, treat as OFF (the default)
        # so a transient error can't block all trading — matching the flag default.
        return bool(cached) if cached is not None else False
    _BTCONLY_CACHE["val"] = val
    _BTCONLY_CACHE["ts"] = now
    return bool(val)


def set_btc_only(on: bool) -> bool:
    import time
    _set_singleton("btc_only_compliance", {"on": bool(on)})
    _BTCONLY_CACHE["val"] = bool(on)
    _BTCONLY_CACHE["ts"] = time.monotonic()
    return bool(on)


def get_client_autopilot_frozen() -> bool:
    val = _get_singleton("client_autopilot_frozen", {"on": True})  # DEFAULT ON (frozen)
    return bool(val.get("on", True)) if isinstance(val, dict) else bool(val)


def set_client_autopilot_frozen(on: bool) -> bool:
    _set_singleton("client_autopilot_frozen", {"on": bool(on)})
    return bool(on)


# ── Active session invalidation ("disconnect all non-admins now") ────────────
# A cutoff timestamp: any NON-admin auth_sessions row issued (created_at) strictly
# before it is rejected (401) by the auth gate, forcing those users to re-login.
# ADMINS ARE NEVER INVALIDATED — the gate exempts role=admin, so the main admin
# keeps working and can lift maintenance. Bumped whenever maintenance is turned ON
# (see set_maintenance) and stamped once on boot if the app is already in
# maintenance (see _stamp_session_cutoff_if_maintenance). Stored as a singleton so
# it survives restarts; cached in-process like the maintenance flag.

_CUTOFF_CACHE: "dict[str, Any]" = {"val": None, "ts": 0.0, "loaded": False}


def get_nonadmin_session_cutoff() -> Optional[str]:
    """The ISO timestamp before which non-admin sessions are invalid, or None."""
    val = _get_singleton("nonadmin_session_cutoff", None)
    if isinstance(val, dict):
        ts = val.get("ts")
        return ts if isinstance(ts, str) else None
    return val if isinstance(val, str) else None


def get_nonadmin_session_cutoff_cached(ttl: float = 5.0) -> Optional[str]:
    """Cached read of the disconnect cutoff for the per-request auth gate.

    The gate consults this on EVERY protected request, so it must not hit Postgres
    each time. Short TTL → a new cutoff still takes effect within a few seconds;
    bump_nonadmin_session_cutoff() busts it immediately. On a DB blip we reuse the
    last known value (and never invent a cutoff), so a transient error can't start
    force-logging-out users on its own."""
    import time
    now = time.monotonic()
    if _CUTOFF_CACHE["loaded"] and (now - _CUTOFF_CACHE["ts"]) <= ttl:
        return _CUTOFF_CACHE["val"]
    try:
        val = get_nonadmin_session_cutoff()
    except Exception:  # noqa: BLE001 — never let a DB blip decide the gate by itself
        return _CUTOFF_CACHE["val"] if _CUTOFF_CACHE["loaded"] else None
    _CUTOFF_CACHE["val"] = val
    _CUTOFF_CACHE["ts"] = now
    _CUTOFF_CACHE["loaded"] = True
    return val


def bump_nonadmin_session_cutoff(ts: Optional[str] = None) -> str:
    """Stamp the disconnect cutoff to `ts` (default: now), busting the cache so the
    gate enforces it immediately. Returns the cutoff written."""
    import time
    ts = ts or now_iso()
    _set_singleton("nonadmin_session_cutoff", {"ts": ts})
    _CUTOFF_CACHE["val"] = ts
    _CUTOFF_CACHE["ts"] = time.monotonic()
    _CUTOFF_CACHE["loaded"] = True
    return ts


def create_welcome_token(username: str, ttl_minutes: int = 2880) -> dict:
    """Mint a one-time, short-lived passwordless 'welcome' token for an EXISTING
    user. Stored in a singleton map {token: {username, expires}}, pruned on mint.
    Default TTL = 48h."""
    import secrets
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    nowiso = now.isoformat()
    toks = _get_singleton("welcome_tokens", {}) or {}
    if not isinstance(toks, dict):
        toks = {}
    toks = {k: v for k, v in toks.items() if isinstance(v, dict) and str(v.get("expires", "")) > nowiso}
    token = secrets.token_urlsafe(24)
    expires = (now + timedelta(minutes=ttl_minutes)).isoformat()
    toks[token] = {"username": username, "expires": expires}
    _set_singleton("welcome_tokens", toks)
    return {"token": token, "expires": expires}


def redeem_welcome_token(token: str) -> Optional[str]:
    """Validate AND consume a welcome token (one-time). Returns the username, or
    None if missing/expired. The token is removed on the first lookup that finds it,
    so a link works exactly once."""
    from datetime import datetime, timezone
    toks = _get_singleton("welcome_tokens", {}) or {}
    if not isinstance(toks, dict):
        return None
    rec = toks.get(token)
    if isinstance(rec, dict):
        toks.pop(token, None)            # consume — one-time
        _set_singleton("welcome_tokens", toks)
    if not isinstance(rec, dict):
        return None
    if str(rec.get("expires", "")) <= datetime.now(timezone.utc).isoformat():
        return None
    return rec.get("username")


# ── Feature promo (the home-page "NEW" widget) ───────────────────────────────
# A single active announcement the admin publishes. It surfaces as the shiny
# "NEW" running banner on the home springboard and, optionally, as an SMS blast.
# Stored as one singleton blob so promoting a new feature simply overwrites the
# previous one — forward-proof for whatever the admin wants to promote next.

def get_feature_promo() -> Optional[dict[str, Any]]:
    promo = _get_singleton("feature_promo", None)
    if not promo or not promo.get("active"):
        return None
    return promo


def set_feature_promo(title: str, body: str, route: str, cta: str) -> dict[str, Any]:
    promo = {
        "title": (title or "").strip(),
        "body": (body or "").strip(),
        # Empty route = a text-only announcement (no link). A value links the banner.
        "route": (route or "").strip(),
        "cta": (cta or "").strip(),
        "active": True,
        "createdAt": now_iso(),
    }
    _set_singleton("feature_promo", promo)
    return promo


def clear_feature_promo() -> None:
    promo = _get_singleton("feature_promo", None) or {}
    promo["active"] = False
    _set_singleton("feature_promo", promo)


# ── Exchange config + PIN ────────────────────────────────────────────────────

_EXCHANGE_DEFAULTS = {
    "exchange": "binance", "environment": "testnet", "subAccount": "",
    "apiKeyEnc": "", "apiSecretEnc": "", "apiPassphraseEnc": "",
    "defaultPct": 5.0, "lastTestAt": None, "lastTestStatus": None, "lastTestMessage": None,
}


def get_exchange_config() -> dict:
    return {**_EXCHANGE_DEFAULTS, **(_get_singleton("exchange_config", {}) or {})}


def _assert_key_storage_retired() -> None:
    """M7 (full retirement): StrateTeach must NEVER store an exchange key. This is the DATA-LAYER
    guarantee — every key-WRITE helper calls it, so even a future un-guarded route or a flipped
    STRATETEACH_LEGACY_ENGINE_ENABLED flag cannot land a key in this DB. Execution + key custody
    live ONLY in Praxis (browser → Praxis Vault). The HTTP routes already return 410; this makes the
    storage physically impossible one layer deeper. Raises unless the legacy engine is explicitly
    re-enabled (the default is retired)."""
    import os as _os
    if _os.getenv("STRATETEACH_LEGACY_ENGINE_ENABLED", "false").strip().lower() != "true":
        raise RuntimeError("legacy_key_storage_retired")


def save_exchange_config(exchange: str, environment: str, sub_account: str,
                         api_key_enc: str, api_secret_enc: str,
                         api_passphrase_enc: str, default_pct: float) -> None:
    _assert_key_storage_retired()  # M7: StrateTeach holds no keys
    cfg = get_exchange_config()
    cfg.update(exchange=exchange, environment=environment, subAccount=sub_account,
               apiKeyEnc=api_key_enc, apiSecretEnc=api_secret_enc,
               apiPassphraseEnc=api_passphrase_enc, defaultPct=default_pct)
    _set_singleton("exchange_config", cfg)


# ── Exchange protection code (PIN) — PER USER ────────────────────────────────────
# Keyed by username on the users row (never a global singleton — strict per-user
# isolation: user A's PIN never overwrites or unlocks user B's). Empty = not set.
def get_exchange_pin_hash(username: str) -> str:
    if not username:
        return ""
    r = fetch_one("SELECT exchange_pin_hash FROM users WHERE username = %s", (username,))
    return (r or {}).get("exchange_pin_hash") or ""


def set_exchange_pin_hash(username: str, pin_hash: str) -> None:
    if not username:
        return
    execute("UPDATE users SET exchange_pin_hash = %s WHERE username = %s", (pin_hash or "", username))


def clear_exchange_pin(username: str) -> None:
    """Wipe ONE user's protection code (pinSet → False) so a fresh one can be set without
    the old PIN. Used by the verified reset paths (admin reset a target · forgot-PIN self)."""
    set_exchange_pin_hash(username, "")


def update_exchange_test_status(ok: bool, message: str) -> None:
    cfg = get_exchange_config()
    cfg.update(lastTestAt=now_iso(), lastTestStatus=("ok" if ok else "error"), lastTestMessage=message)
    _set_singleton("exchange_config", cfg)


# ── Profit engine config + last plan ──────────────────────────────────────────

_PROFIT_DEFAULTS = {
    "enabled": False, "targetMode": "daily", "dailyTarget": 0.0, "weeklyTarget": 0.0,
    "tiers": ["breaking_out", "near_breakout"], "maxPositions": 5, "deployPct": 50.0,
    "autoScan": False, "scheduleTime": "09:00", "profitPctEnabled": False,
    "profitPctPerPosition": 5.0, "investAmount": 0.0, "lastBuiltAt": None,
}


def get_profit_config() -> dict:
    return {**_PROFIT_DEFAULTS, **(_get_singleton("profit_config", {}) or {})}


def save_profit_config(enabled: bool, target_mode: str, daily_target: float,
                       weekly_target: float, tiers: List[str], max_positions: int,
                       deploy_pct: float, auto_scan: bool, schedule_time: str,
                       profit_pct_enabled: bool = False,
                       profit_pct_per_position: float = 5.0,
                       invest_amount: float = 0.0) -> None:
    cfg = get_profit_config()
    cfg.update(enabled=enabled, targetMode=target_mode, dailyTarget=daily_target,
               weeklyTarget=weekly_target, tiers=tiers, maxPositions=max_positions,
               deployPct=deploy_pct, autoScan=auto_scan, scheduleTime=schedule_time,
               profitPctEnabled=profit_pct_enabled, profitPctPerPosition=profit_pct_per_position,
               investAmount=invest_amount)
    _set_singleton("profit_config", cfg)


def save_profit_plan(plan: dict) -> None:
    _set_singleton("profit_plan", plan)
    cfg = get_profit_config()
    cfg["lastBuiltAt"] = plan.get("generatedAt")
    _set_singleton("profit_config", cfg)


def get_profit_plan() -> Optional[dict]:
    return _get_singleton("profit_plan", None)


# ── Activity log (live orders, paper events) ──────────────────────────────────

def add_activity(mode: str, kind: str, symbol: Optional[str] = None, *, side: Optional[str] = None,
                 qty: Optional[float] = None, price: Optional[float] = None,
                 cost: Optional[float] = None, pnl: Optional[float] = None,
                 environment: Optional[str] = None, ts: Optional[str] = None,
                 name: Optional[str] = None, tier: Optional[str] = None,
                 direction: Optional[str] = None, username: Optional[str] = None,
                 bot_id: Optional[int] = None) -> None:
    # ``username`` stamps the row's owner so personal LIVE views (live-pnl, the
    # activity feed, realized stats) can be scoped to the caller. Demo activity is
    # public and is logged without a username (None), so it is never filtered out.
    # ``bot_id`` attributes an order to the Signal Bot that fired it (NULL = manual).
    detail = {"mode": mode, "symbol": symbol, "name": name, "tier": tier, "direction": direction,
              "side": side, "qty": qty, "price": price, "cost": cost, "pnl": pnl,
              "environment": environment, "username": username, "botId": bot_id}
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO activity_log (ts, kind, detail, bot_id) VALUES (%s, %s, %s, %s)",
            (ts or now_iso(), kind, Json(detail), bot_id),
        )


def list_activity(limit: int = 100, mode: Optional[str] = None,
                  username: Optional[str] = None) -> List[dict]:
    # ``username`` scopes the result to one owner — used by PERSONAL live views so
    # one user never sees another's live orders. Left None for demo (public) and for
    # admin-aggregate callers. Legacy live rows logged before the per-user stamp have
    # no username and are therefore excluded from any per-user view (intentional
    # isolation — they can't bleed into a real user's P&L).
    clauses: List[str] = []
    params: List[Any] = []
    if mode in ("demo", "live"):
        clauses.append("detail->>'mode' = %s"); params.append(mode)
    if username is not None:
        clauses.append("detail->>'username' = %s"); params.append(username)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT id, ts, kind, detail FROM activity_log{where} ORDER BY id DESC LIMIT %s",
            tuple(params),
        ).fetchall()
    return [{"id": r["id"], "ts": r["ts"], "kind": r["kind"], **(r["detail"] or {})} for r in rows]


# ── Paper trading (demo) sessions + positions + target events ─────────────────

def _session_row_to_dict(row: dict[str, Any]) -> dict:
    return {**(row["data"] or {}), "id": row["id"]}


def create_paper_session(label: str, strategy: str, capital: float, daily_target: float,
                         target_behavior: str, tiers: List[str], max_positions: int,
                         started_at: str, take_profit_enabled: bool = False,
                         take_profit_pct: float = 5.0, owner: Optional[str] = None,
                         stop_loss_enabled: bool = False, stop_loss_mode: str = "amount",
                         stop_loss_value: float = 0.0) -> int:
    data = {
        "label": label, "strategy": strategy, "capital": capital, "dailyTarget": daily_target,
        "targetBehavior": target_behavior, "tiers": tiers, "maxPositions": max_positions,
        "startedAt": started_at, "status": "running", "pendingDecision": False,
        "acknowledged": False, "closedAt": None, "takeProfitEnabled": take_profit_enabled,
        "takeProfitPct": take_profit_pct, "targetHitAt": None, "secondsToTarget": None,
        "owner": owner,  # username that opened this session; None = legacy (admin-only view)
        "stopLossEnabled": stop_loss_enabled, "stopLossMode": stop_loss_mode,
        "stopLossValue": stop_loss_value,
    }
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO paper_sessions (data, created_at) VALUES (%s, %s) RETURNING id",
            (Json(data), started_at),
        ).fetchone()
    return row["id"]


def list_paper_sessions() -> List[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, data FROM paper_sessions ORDER BY id").fetchall()
    return [_session_row_to_dict(r) for r in rows]


def get_paper_session_by_id(session_id: int) -> Optional[dict]:
    row = fetch_one("SELECT id, data FROM paper_sessions WHERE id = %s", (session_id,))
    return _session_row_to_dict(row) if row else None


_SESSION_FIELD_MAP = {
    "status": "status", "pending_decision": "pendingDecision", "closed_at": "closedAt",
    "acknowledged": "acknowledged", "target_hit_at": "targetHitAt",
    "seconds_to_target": "secondsToTarget",
}


def update_paper_session_row(session_id: int, **fields) -> None:
    with get_conn() as conn:
        row = conn.execute("SELECT data FROM paper_sessions WHERE id = %s", (session_id,)).fetchone()
        if not row:
            return
        data = dict(row["data"] or {})
        for k, v in fields.items():
            data[_SESSION_FIELD_MAP.get(k, k)] = v
        conn.execute("UPDATE paper_sessions SET data = %s WHERE id = %s", (Json(data), session_id))


def delete_paper_session(session_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM target_events WHERE session_id = %s", (session_id,))
        conn.execute("DELETE FROM paper_sessions WHERE id = %s", (session_id,))  # positions cascade


def reset_paper() -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM paper_positions")
        conn.execute("DELETE FROM target_events")
        conn.execute("DELETE FROM paper_sessions")


def insert_paper_positions(positions: List[dict], session_id: int) -> None:
    # Observational: log each open and stamp its runId onto the position data for
    # precise close-pairing. Done BEFORE the insert connection (no nested pool use)
    # and fully best-effort — a logging hiccup never blocks opening the position.
    owner: Optional[str] = None
    source = "manual"
    try:
        srow = fetch_one("SELECT data FROM paper_sessions WHERE id = %s", (session_id,))
        sdata = (srow or {}).get("data") or {}
        owner = sdata.get("owner")
        if str(sdata.get("label") or "").startswith("Auto "):
            source = "auto"
    except Exception:  # noqa: BLE001
        pass
    enriched: List[dict] = []
    for p in positions:
        rid = None
        try:
            rid = log_run_open(
                username=owner, mode="demo", symbol=p.get("symbol"), side="long",
                entry_price=(float(p.get("entryPrice")) if p.get("entryPrice") else None),
                qty=(float(p.get("qty")) if p.get("qty") else None),
                opened_at=p.get("openedAt"), source=source,
            )
        except Exception:  # noqa: BLE001
            rid = None
        enriched.append({**p, "runId": rid} if rid else p)
    with get_conn() as conn:
        for p in enriched:
            conn.execute(
                "INSERT INTO paper_positions (session_id, status, data) VALUES (%s, 'open', %s)",
                (session_id, Json(p)),
            )


def list_paper_positions(status: Optional[str] = None, session_id: Optional[int] = None) -> List[dict]:
    query = "SELECT id, session_id, status, data FROM paper_positions WHERE 1=1"
    params: List[Any] = []
    if session_id is not None:
        query += " AND session_id = %s"
        params.append(session_id)
    if status is not None:
        query += " AND status = %s"
        params.append(status)
    query += " ORDER BY id"
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [{**(r["data"] or {}), "id": r["id"], "sessionId": r["session_id"], "status": r["status"]}
            for r in rows]


def close_paper_position(position_id: int, close_price: float, pnl: float, closed_at: str,
                         reason: Optional[str] = None) -> None:
    data: dict = {}
    with get_conn() as conn:
        row = conn.execute("SELECT data FROM paper_positions WHERE id = %s", (position_id,)).fetchone()
        if not row:
            return
        data = dict(row["data"] or {})
        data.update(closePrice=close_price, realizedPnl=pnl, closedAt=closed_at)
        if reason:
            data["closeReason"] = reason   # stop_loss | take_profit | target_hit | manual | daily_reset
        conn.execute(
            "UPDATE paper_positions SET status = 'closed', data = %s WHERE id = %s",
            (Json(data), position_id),
        )
    # Observational run-close log (after the trade write; never blocks it).
    try:
        cost = float(data.get("capital") or 0.0)
        pnl_pct = round(pnl / cost * 100.0, 2) if cost > 0 else None
        log_run_close(run_id=data.get("runId"), mode="demo", symbol=data.get("symbol"),
                      exit_price=close_price, pnl=pnl, pnl_pct=pnl_pct, status="closed", closed_at=closed_at)
    except Exception:  # noqa: BLE001 — logging must never affect a close
        pass


# ── Runs log (observational only; every call is best-effort and swallows errors
#    so a failure to log can NEVER break a trade / flow) ────────────────────────

def log_run_open(*, username: Optional[str], mode: str, symbol: Optional[str], side: Optional[str],
                 entry_price: Optional[float], qty: Optional[float], opened_at: Optional[str],
                 source: Optional[str] = None, bot_id: Optional[int] = None) -> Optional[int]:
    """Record an opened run/position; returns the row id (for later pairing) or None.

    ``bot_id`` attributes the run to the Signal Bot that opened it (NULL = manual/paper)."""
    try:
        ts = now_iso()
        with get_conn() as conn:
            row = conn.execute(
                "INSERT INTO runs_log (username, mode, symbol, side, opened_at, entry_price, qty, "
                "status, source, created_at, bot_id) VALUES (%s,%s,%s,%s,%s,%s,%s,'open',%s,%s,%s) RETURNING id",
                (username, mode, symbol, side, opened_at or ts, entry_price, qty, source, ts, bot_id),
            ).fetchone()
        return int(row["id"]) if row else None
    except Exception:  # noqa: BLE001
        return None


def log_run_close(*, run_id: Optional[int] = None, username: Optional[str] = None, mode: str = "demo",
                  symbol: Optional[str] = None, exit_price: Optional[float] = None,
                  pnl: Optional[float] = None, pnl_pct: Optional[float] = None,
                  status: str = "closed", closed_at: Optional[str] = None,
                  bot_id: Optional[int] = None) -> None:
    """Close a run row by id (demo) or the latest matching open row (live), computing
    duration. Inserts a standalone closed row if no open row is found. Best-effort.

    ``bot_id`` (when set) pairs the close to the SAME bot's latest open row, so two
    bots trading the same symbol for one user never close each other's positions."""
    try:
        ts = closed_at or now_iso()
        with get_conn() as conn:
            target_id = run_id
            if target_id is None and bot_id is not None:
                r = conn.execute(
                    "SELECT id FROM runs_log WHERE status = 'open' AND mode = %s AND symbol = %s "
                    "AND bot_id = %s ORDER BY id DESC LIMIT 1",
                    (mode, symbol, bot_id),
                ).fetchone()
                target_id = int(r["id"]) if r else None
            if target_id is None:
                r = conn.execute(
                    "SELECT id FROM runs_log WHERE status = 'open' AND mode = %s AND symbol = %s "
                    "AND (username IS NOT DISTINCT FROM %s) ORDER BY id DESC LIMIT 1",
                    (mode, symbol, username),
                ).fetchone()
                target_id = int(r["id"]) if r else None
            if target_id is None:
                conn.execute(
                    "INSERT INTO runs_log (username, mode, symbol, exit_price, pnl, pnl_pct, status, "
                    "closed_at, created_at, bot_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (username, mode, symbol, exit_price, pnl, pnl_pct, status, ts, ts, bot_id),
                )
                return
            orow = conn.execute("SELECT opened_at FROM runs_log WHERE id = %s", (target_id,)).fetchone()
            dur = None
            try:
                oa = (orow or {}).get("opened_at")
                if oa:
                    o = datetime.fromisoformat(oa); cc = datetime.fromisoformat(ts)
                    if o.tzinfo is None: o = o.replace(tzinfo=timezone.utc)
                    if cc.tzinfo is None: cc = cc.replace(tzinfo=timezone.utc)
                    dur = max(0, int((cc - o).total_seconds()))
            except (TypeError, ValueError):
                dur = None
            conn.execute(
                "UPDATE runs_log SET closed_at = %s, duration_seconds = %s, exit_price = %s, "
                "pnl = %s, pnl_pct = %s, status = %s WHERE id = %s",
                (ts, dur, exit_price, pnl, pnl_pct, status, target_id),
            )
    except Exception:  # noqa: BLE001
        return


def list_runs_log(*, username: Optional[str] = None, mode: Optional[str] = None,
                  status: Optional[str] = None, limit: int = 500) -> list[dict[str, Any]]:
    q = ("SELECT id, username, mode, symbol, side, opened_at, closed_at, duration_seconds, "
         "entry_price, exit_price, qty, pnl, pnl_pct, status, source, created_at, "
         "close_reason, close_order_id, bot_id FROM runs_log WHERE 1=1")
    params: List[Any] = []
    if username:
        q += " AND username = %s"; params.append(username)
    if mode:
        q += " AND mode = %s"; params.append(mode)
    if status:
        q += " AND status = %s"; params.append(status)
    # Newest first by the run's real time (so backfilled historical rows sort by
    # when they actually happened, not by their just-assigned id).
    q += " ORDER BY COALESCE(closed_at, opened_at, created_at) DESC, id DESC LIMIT %s"; params.append(int(limit))
    with get_conn() as conn:
        rows = conn.execute(q, params).fetchall()
    return [dict(r) for r in rows]


def list_open_live_runs(username: Optional[str] = None) -> list[dict[str, Any]]:
    """Open LIVE runs_log rows (the positions the app opened live and hasn't seen close),
    for the READ-ONLY exchange reconcile to match exit fills against."""
    q = ("SELECT id, username, symbol, side, opened_at, entry_price, qty FROM runs_log "
         "WHERE mode = 'live' AND status = 'open'")
    params: List[Any] = []
    if username:
        q += " AND username = %s"; params.append(username)
    q += " ORDER BY id ASC"
    with get_conn() as conn:
        rows = conn.execute(q, params).fetchall()
    return [dict(r) for r in rows]


def live_close_order_seen(order_id: str) -> bool:
    """Dedup guard: True if a runs_log row already reconciled this exchange order id."""
    if not order_id:
        return False
    row = fetch_one("SELECT 1 AS x FROM runs_log WHERE close_order_id = %s LIMIT 1", (str(order_id),))
    return bool(row)


def reconcile_live_run_close(run_id: int, *, exit_price: Optional[float], pnl: Optional[float],
                             pnl_pct: Optional[float], closed_at: str, reason: str,
                             order_id: str) -> None:
    """Mark ONE open live run closed from a detected exchange fill (read-only reconcile).
    Stamps exit price, %P&L, the close reason, and the matched exchange order id. Best-effort;
    computes duration from the run's opened_at. Never touches the exchange."""
    try:
        with get_conn() as conn:
            orow = conn.execute("SELECT opened_at, status FROM runs_log WHERE id = %s", (run_id,)).fetchone()
            if not orow or str(orow.get("status")) != "open":
                return  # already closed / gone — never double-close
            dur = None
            try:
                op = datetime.fromisoformat(str(orow.get("opened_at")))
                cl = datetime.fromisoformat(str(closed_at))
                dur = max(0, int((cl - op).total_seconds()))
            except (TypeError, ValueError):
                dur = None
            conn.execute(
                "UPDATE runs_log SET status = 'closed', closed_at = %s, duration_seconds = %s, "
                "exit_price = %s, pnl = %s, pnl_pct = %s, close_reason = %s, close_order_id = %s "
                "WHERE id = %s AND status = 'open'",
                (closed_at, dur, exit_price, pnl, pnl_pct, reason, str(order_id), run_id),
            )
    except Exception:  # noqa: BLE001 — reconcile must never break the log
        pass


# ── Signal Automated Bots (server-stored trade-only keys + TradingView webhooks) ─
# Keys are Fernet-encrypted (services/exchange.encrypt, same scheme as the exchange
# singleton). Ciphertext lives ONLY in enc_key/enc_secret/enc_passphrase and is
# NEVER returned by an endpoint — mask_bot() strips it to boolean has* flags.

def mask_bot(row: Optional[dict[str, Any]]) -> dict[str, Any]:
    """Public, safe-to-return view of a bot row. Carries NO secret material — only
    boolean has* flags so the UI can show "key set" without ever exposing it."""
    if not row:
        return {}
    mq = row.get("max_quote")
    mo = row.get("max_open")
    sp = row.get("size_pct")
    return {
        "id": int(row["id"]),
        "username": row.get("username"),
        "label": row.get("label"),
        "webhookToken": row.get("webhook_token"),  # owner-only; needed to wire TradingView
        "status": row.get("status") or "active",
        "exchange": row.get("exchange"),
        "market": row.get("market") or "spot",
        "subAccount": row.get("sub_account"),
        "maxQuote": (float(mq) if mq is not None else None),
        "maxOpen": (int(mo) if mo is not None else None),
        "sizeMode": (row.get("size_mode") or "fixed"),
        "sizePct": (float(sp) if sp is not None else 100.0),
        "hasKey": bool(row.get("enc_key")),
        "hasSecret": bool(row.get("enc_secret")),
        "hasPassphrase": bool(row.get("enc_passphrase")),
        "createdAt": row.get("created_at"),
    }


def create_bot(*, username: str, label: Optional[str], exchange: Optional[str], market: str,
               enc_key: str, enc_secret: str, enc_passphrase: str,
               sub_account: Optional[str], max_quote: Optional[float],
               max_open: Optional[int], size_mode: str = "fixed",
               size_pct: float = 100.0) -> dict[str, Any]:
    """Insert a bot with a fresh unguessable webhook token; returns the RAW row
    (callers mask it before returning to a client)."""
    _assert_key_storage_retired()  # M7: no key-holding bot creation in StrateTeach
    import secrets as _s
    token = _s.token_urlsafe(24)
    sm = size_mode if size_mode in ("fixed", "balance_pct") else "fixed"
    sp = float(size_pct) if size_pct is not None else 100.0
    sp = max(0.0, min(sp, 100.0))
    return fetch_one(
        "INSERT INTO bots (username, label, webhook_token, status, exchange, market, "
        "enc_key, enc_secret, enc_passphrase, sub_account, max_quote, max_open, "
        "size_mode, size_pct, created_at) "
        "VALUES (%s,%s,%s,'active',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (username, label, token, exchange, (market or "spot"), enc_key, enc_secret,
         enc_passphrase, sub_account, max_quote, max_open, sm, sp, now_iso()),
    )


def get_bot(bot_id: int) -> Optional[dict[str, Any]]:
    """RAW bot row (includes ciphertext) — internal use only; never return directly."""
    return fetch_one("SELECT * FROM bots WHERE id = %s", (bot_id,))


def get_bot_by_token(token: str) -> Optional[dict[str, Any]]:
    """RAW bot row matched by its webhook token (the public inbound path)."""
    if not token:
        return None
    return fetch_one("SELECT * FROM bots WHERE webhook_token = %s", (token,))


def list_bots(username: str) -> list[dict[str, Any]]:
    """The user's bots, MASKED (no secrets), newest first."""
    rows = fetch_all("SELECT * FROM bots WHERE username = %s ORDER BY id DESC", (username,))
    return [mask_bot(r) for r in rows]


def count_bots(username: str) -> int:
    row = fetch_one("SELECT COUNT(*) AS n FROM bots WHERE username = %s", (username,))
    return int(row["n"]) if row else 0


def count_user_bots(username: str) -> int:
    """How many Signal Bots a user owns (COUNT on the bots table). Used by the
    PRIVACY-SCOPED admin bot-limit panel — exposes a count only, never bot rows
    or any secret material."""
    return count_bots(username)


# ── Per-user encrypted exchange-key backup ───────────────────────────────────────
# One row per user (PK username). Stores ONLY Fernet ciphertext (enc_*) — the SAME
# scheme the Signal Bots use (services.exchange.encrypt / SESSION_SECRET). Lets the
# exchange connection follow the user across devices / survive a cache-clear. Strict
# per-user isolation: every read/write is keyed on the caller's own username.

def save_exchange_creds_backup(*, username: str, exchange: Optional[str], environment: Optional[str],
                               sub_account: Optional[str], enc_key: str, enc_secret: str,
                               enc_passphrase: str) -> None:
    """Upsert the caller's encrypted exchange creds (ciphertext only)."""
    _assert_key_storage_retired()  # M7: StrateTeach holds no keys
    execute(
        "INSERT INTO exchange_creds_backup "
        "(username, exchange, environment, sub_account, enc_key, enc_secret, enc_passphrase, updated_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (username) DO UPDATE SET "
        "exchange = EXCLUDED.exchange, environment = EXCLUDED.environment, "
        "sub_account = EXCLUDED.sub_account, enc_key = EXCLUDED.enc_key, "
        "enc_secret = EXCLUDED.enc_secret, enc_passphrase = EXCLUDED.enc_passphrase, "
        "updated_at = EXCLUDED.updated_at",
        (username, exchange, environment, sub_account, enc_key, enc_secret, enc_passphrase, now_iso()),
    )


def get_exchange_creds_backup(username: str) -> Optional[dict[str, Any]]:
    """RAW backup row for this user (includes ciphertext) — internal use only; the
    route decrypts and returns creds ONLY to the authenticated owner."""
    if not username:
        return None
    return fetch_one("SELECT * FROM exchange_creds_backup WHERE username = %s", (username,))


def delete_exchange_creds_backup(username: str) -> None:
    """Remove the caller's backup (on explicit disconnect)."""
    if not username:
        return
    execute("DELETE FROM exchange_creds_backup WHERE username = %s", (username,))


# ── Editable legal texts + legal-editor access ───────────────────────────────────
# The legal counsel edits the app's legal copy live from the in-app Legal Console.
# Bodies are markdown (## heading, blank-line paragraphs). Seeded on boot from the
# shipped copy — ON CONFLICT DO NOTHING so re-boots never overwrite an editor's edits.

# The shipped defaults. Transcribed from the in-app copy (Privacy screen, RiskDisclaimer,
# SimBadge) PLUS a NEW exchange-keys disclosure that discloses the encrypted server-side
# backup. `sort` orders them in the console + any combined public view.
_LEGAL_SEED: "dict[str, dict[str, Any]]" = {
    "privacy": {
        "sort": 10,
        "title_he": "מדיניות פרטיות",
        "title_en": "Privacy Policy",
        "body_he": (
            "## העיקרון המרכזי שלנו: ללא החזקת נכסים\n\n"
            "Strateteach לעולם אינה מחזיקה בכספים שלכם ואינה שומרת את מפתחות ה‑API של הבורסה שלכם בשרתים שלנו. המפתחות נשארים בדפדפן שלכם ומשמשים אך ורק לביצוע הפעולות שאתם יוזמים. איננו יכולים להזיז את כספכם בעצמנו.\n\n"
            "## מידע שאנו אוספים\n\n"
            "מידע חשבון שאתם מספקים: שם משתמש וסיסמה (נשמרת רק כ‑hash מוצפן), אימייל (אם נמסר, למשל לאיפוס סיסמה), וקוד ההגנה האישי שלכם (נשמר כ‑hash).\n\n"
            "מידע שאתם יוצרים: הגדרות אסטרטגיה, בדיקות עבר, איתותים, סשנים של מסחר דמו, תוכניות מנוע מסחר, ייצואים והצעות/משוב ששלחתם.\n\n"
            "נתוני בורסה ושוק: מפתחות ה‑API שלכם משמשים באופן זמני בדפדפן כדי לקרוא יתרות/פוזיציות ולבצע את ההוראות שאתם מאשרים. אנו מושכים מחירי שוק ציבוריים ממקורות צד‑שלישי.\n\n"
            "נתונים טכניים: כתובת IP, סוג מכשיר/דפדפן, ויומני בקשות לצורכי אבטחה, הגבלת קצב ופתרון תקלות; אבחון שגיאות אופציונלי דרך ספק הניטור שלנו.\n\n"
            "## כיצד אנו משתמשים במידע\n\n"
            "כדי לספק ולהפעיל את השירות, לשמור על אבטחתו (הגבלת קצב, נעילת חשבון, יומן ביקורת), ליצור עמכם קשר (למשל אימייל לאיפוס סיסמה), לספק התראות אופציונליות שתפעילו (למשל טלגרם), ולשפר את היציבות.\n\n"
            "## כיצד המידע משותף\n\n"
            "איננו מוכרים את המידע האישי שלכם. אנו משתפים מידע רק עם ספקי האחסון/תשתית שלנו, ספק אימייל (לאימיילים תפעוליים, אם הוגדר), ספק ניטור שגיאות (אם הופעל), טלגרם (להתראות שתפעילו), והבורסות/מקורות הנתונים הדרושים לביצוע הפעולות שאתם יוזמים — או כאשר הדבר נדרש על פי חוק.\n\n"
            "## שמירת נתונים\n\n"
            "אנו שומרים נתוני חשבון ופעילות כל עוד החשבון פעיל וכנדרש להפעלת השירות ולעמידה בחובות חוקיות. כשאתם מוחקים את החשבון, אנו מוחקים או הופכים לאנונימי את המידע האישי שלכם בתוך פרק זמן סביר, אלא אם השמירה נדרשת על פי חוק.\n\n"
            "## הזכויות שלכם\n\n"
            "ב‑הגדרות ← הנתונים שלך תוכלו לייצא את הנתונים שלכם ולמחוק את החשבון בכל עת. בהתאם למקום מגוריכם (למשל GDPR באיחוד האירופי/בריטניה, CCPA/CPRA בקליפורניה), ייתכן שיש לכם גם זכויות גישה, תיקון, הגבלה או ניוד, וזכות להתנגד לעיבוד מסוים. פנו אלינו למימוש כל זכות.\n\n"
            "## אבטחה\n\n"
            "אנו מגנים על הנתונים בעזרת HTTPS/TLS בהעברה, סיסמאות וקודי הגנה מוצפנים (hash), נעילת PIN על פעולות כספיות, הגבלת קצב, נעילת חשבון ורישום אבטחה. אף שיטה אינה מאובטחת ב‑100%, אך אנו נוקטים באמצעים מקובלים בתעשייה. לגבי מפתחות הבורסה — ראו את הסעיף \"מפתחות הבורסה שלך\".\n\n"
            "## בינלאומי, קטינים ושינויים\n\n"
            "ייתכן שהנתונים שלכם יעובדו מחוץ למדינתכם עם אמצעי הגנה מתאימים. השירות אינו מיועד למי שמתחת לגיל 18. אנו עשויים לעדכן מדיניות זו ונפרסם גרסה חדשה עם תאריך מעודכן.\n\n"
            "## יצירת קשר\n\n"
            "שאלות? כתבו ל‑privacy@strateteach.com. Strateteach (רישום חברה בהליך — ישראל)."
        ),
        "body_en": (
            "## Our core principle: non-custodial\n\n"
            "Strateteach is non-custodial. We never take custody of your funds, and we do not move your funds on our own. Your exchange API keys are used only to perform the actions you initiate.\n\n"
            "## Information we collect\n\n"
            "Account information you provide: username and password (stored only as a salted hash), email (if given, e.g. for password reset), and your per-user protection code (stored hashed).\n\n"
            "Information you generate: strategy configurations, backtest runs, signals, paper-trading sessions, profit-engine plans, exports, and suggestions/feedback you submit.\n\n"
            "Exchange & market data: your exchange API keys are used to read balances/positions and place the orders you authorize. We fetch public market prices from third-party data sources.\n\n"
            "Technical data: IP address, device/browser type, and request logs for security, rate-limiting, and troubleshooting; optional error diagnostics via our monitoring provider.\n\n"
            "## How we use your information\n\n"
            "To provide and operate the Service, to keep it secure (rate limiting, lockout, audit trail), to communicate with you (e.g. password-reset emails), to deliver optional notifications you enable (e.g. Telegram alerts), and to diagnose and improve reliability.\n\n"
            "## How your information is shared\n\n"
            "We do not sell your personal information. We share data only with our hosting/infrastructure providers, an email provider (for transactional emails, if configured), an error-monitoring provider (if enabled), Telegram (for alerts you enable), and the exchanges/data sources needed to perform the actions you initiate — or where required by law.\n\n"
            "## Data retention\n\n"
            "We keep account and activity data while your account is active and as needed to operate the Service and meet legal obligations. When you delete your account, we delete or anonymize your personal data within a reasonable period, except where retention is legally required.\n\n"
            "## Your rights\n\n"
            "From Settings → Your data you can export your data and delete your account at any time. Depending on where you live (e.g. EU/UK GDPR, California CCPA/CPRA), you may also have rights to access, correct, restrict, or port your data, and to object to certain processing. Contact us to exercise any right.\n\n"
            "## Security\n\n"
            "We protect your data with HTTPS/TLS in transit, hashed passwords and protection codes, PIN-gating on money-moving actions, rate limiting, account lockout, and security logging. No method is 100% secure, but we use industry-standard measures. For how exchange keys are handled, see \"Your exchange keys\".\n\n"
            "## International, children, and changes\n\n"
            "Your data may be processed outside your country with appropriate safeguards. The Service is not intended for anyone under 18. We may update this policy and will post the new version with an updated date.\n\n"
            "## Contact\n\n"
            "Questions? Email privacy@strateteach.com. Strateteach (company registration pending — Israel)."
        ),
    },
    "exchange_keys": {
        "sort": 20,
        "title_he": "מפתחות הבורסה שלך",
        "title_en": "Your exchange keys",
        "body_he": (
            "המפתחות שלכם נשמרים בדפדפן זה כדרך המהירה (browser-first), ומשמשים לביצוע הפעולות שאתם מאשרים.\n\n"
            "בנוסף, כברירת מחדל אנו שומרים עבורכם עותק גיבוי **מוצפן** של המפתחות בשרת, כדי שהחיבור לבורסה יעבור אתכם בין מכשירים וישרוד ניקוי של נתוני הדפדפן. הגיבוי נשמר מוצפן במנוחה (הצפחה סימטרית עם מפתח שרת), נפרד לכל משתמש, ומפוענח בחזרה רק אליכם — בעל החשבון המאומת — דרך HTTPS. ניתוק מוחק גם את הגיבוי מהשרת.\n\n"
            "מומלץ להשתמש במפתחות למסחר בלבד (ללא הרשאת משיכה). איננו יכולים להזיז את כספכם בעצמנו."
        ),
        "body_en": (
            "Your keys are kept in this browser as the fast path (browser-first) and are used to perform the actions you authorize.\n\n"
            "By default we also keep an **encrypted** backup copy of your keys on our server, so your exchange connection follows you across devices and survives clearing your browser data. The backup is stored encrypted at rest (symmetric encryption with a server key), kept separately per user, and decrypted back only to you — the authenticated account owner — over HTTPS. Disconnecting also deletes the server backup.\n\n"
            "We recommend trade-only keys (no withdrawal permission). We can never move your funds on our own."
        ),
    },
    "risk": {
        "sort": 30,
        "title_he": "אזהרת סיכון",
        "title_en": "Risk disclaimer",
        "body_he": "מסחר באלגוריתמים כרוך בסיכון; ביצועי עבר אינם מבטיחים תוצאות עתידיות. אין באמור משום ייעוץ להשקעות.",
        "body_en": "Algorithmic trading involves risk; past performance does not guarantee future results. Nothing here is investment advice.",
    },
    "demo": {
        "sort": 40,
        "title_he": "סימולציה (דמו)",
        "title_en": "Simulation (demo)",
        "body_he": "מספרי הדמו הם סימולציה · לא כסף אמיתי. הם נועדו לתרגול ולמידה בלבד ואינם משקפים ביצועים בפועל.",
        "body_en": "Demo figures are a simulation · not real money. They are for practice and learning only and do not reflect actual performance.",
    },
    "terms": {
        "sort": 50,
        "title_he": "תנאי שימוש",
        "title_en": "Terms of Use",
        "body_he": (
            "טיוטה. השירות מסופק \"כפי שהוא\" (AS IS) לצורכי מסחר וניתוח בשליטתכם. אתם אחראים לפעולות שאתם יוזמות ולמפתחות ה‑API שלכם.\n\n"
            "אין באמור משום ייעוץ פיננסי, משפטי או מס. השימוש כפוף למדיניות הפרטיות. היועצת המשפטית תשלים סעיף זה."
        ),
        "body_en": (
            "Draft. The Service is provided \"AS IS\" for trading and analysis under your control. You are responsible for the actions you initiate and for your API keys.\n\n"
            "Nothing here is financial, legal, or tax advice. Use is subject to the Privacy Policy. Legal counsel to complete this section."
        ),
    },
}


def _seed_legal_texts() -> None:
    """Insert the shipped legal defaults if absent — never overwrites an editor's edits."""
    for key, v in _LEGAL_SEED.items():
        execute(
            "INSERT INTO legal_texts (key, title_he, title_en, body_he, body_en, published, sort, updated_at, updated_by) "
            "VALUES (%s,%s,%s,%s,%s,TRUE,%s,%s,'seed') ON CONFLICT (key) DO NOTHING",
            (key, v["title_he"], v["title_en"], v["body_he"], v["body_en"], int(v.get("sort", 0)), now_iso()),
        )


# ── Legal COPY blocks (the 4 analytics/safety-plan blocks Raz edits + approves) ──
# The DB is the source of truth once seeded; the frontend file drafts (lib/legalCopy.tsx)
# are only the fallback default. [PLACEHOLDER …] markers are kept verbatim — human
# decisions (entity name, retention periods, DPO, contact). Seeded approved=FALSE so the
# amber DRAFT badge shows until Raz confirms each block.
LEGAL_COPY_BLOCKS = ("disclaimer", "risk", "privacy", "consent")
_LEGAL_COPY_SEED = {
    "disclaimer": {
        "en": (
            "Strateteach (operated by [PLACEHOLDER — registered legal entity name + company no.]) "
            "provides technology tools: market scanning, educational content, backtesting, and "
            "automated strategy simulations. Strateteach does not provide personalized investment "
            "advice, investment marketing, or portfolio management within the meaning of the "
            "Regulation of Investment Advice, Investment Marketing and Portfolio Management Law, "
            "5755-1995, is not licensed under that law, and nothing on the platform is a "
            "recommendation tailored to your personal circumstances to buy, sell, or hold any "
            "security or financial asset. Strateteach does not hold, custody, or transfer your funds "
            "or assets — any trading takes place in your own account at a third-party exchange, using "
            "API keys you control. You are solely responsible for your trading decisions. Consider "
            "consulting a licensed investment advisor before making decisions."),
        "he": (
            "Strateteach (מופעל על-ידי [PLACEHOLDER — שם הישות המשפטית הרשומה ומספר ח.פ.]) מספק כלים "
            "טכנולוגיים: סריקת שווקים, תוכן לימודי, בדיקות היסטוריות (בקטסטים) והדמיות של אסטרטגיות "
            "אוטומטיות. Strateteach אינו מספק ייעוץ השקעות, שיווק השקעות או ניהול תיקי השקעות כהגדרתם "
            "בחוק הסדרת העיסוק בייעוץ השקעות, בשיווק השקעות ובניהול תיקי השקעות, התשנ״ה-1995, אינו בעל "
            "רישיון לפי חוק זה, ואין באמור בפלטפורמה משום המלצה המותאמת לנסיבותיך האישיות לקנות, למכור "
            "או להחזיק נייר ערך או נכס פיננסי כלשהו. Strateteach אינו מחזיק, שומר או מעביר את כספך או "
            "נכסיך — כל מסחר מתבצע בחשבונך שלך אצל זירת מסחר צד-שלישי, באמצעות מפתחות API שבשליטתך. "
            "האחריות להחלטות המסחר היא עליך בלבד. מומלץ לשקול התייעצות עם יועץ השקעות בעל רישיון לפני "
            "קבלת החלטות."),
    },
    "risk": {
        "en": (
            "Trading in securities, cryptocurrencies, and other financial assets involves a high risk "
            "of loss and is not suitable for everyone. You may lose some or all of your capital. "
            "Cryptocurrency markets are highly volatile and only partially regulated in Israel. Demo, "
            "simulation, and backtest results are hypothetical, do not represent real trading, and are "
            "not a promise or indication of future results — past performance does not guarantee "
            "future performance. Automated strategies ('AutoPilots') can and do incur losses; they run "
            "on your own exchange account and you remain responsible for it. Strateteach does not "
            "guarantee any profit. Only trade with money you can afford to lose. This is not "
            "personalized investment advice."),
        "he": (
            "מסחר בניירות ערך, במטבעות קריפטוגרפיים ובנכסים פיננסיים אחרים כרוך בסיכון גבוה להפסד ואינו "
            "מתאים לכל אדם. אתה עלול לאבד חלק מכספך או את כולו. שוקי הקריפטו תנודתיים מאוד ומוסדרים "
            "באופן חלקי בלבד בישראל. תוצאות דמו, הדמיה ובדיקות היסטוריות (בקטסט) הן תיאורטיות, אינן "
            "משקפות מסחר אמיתי, ואינן הבטחה או אינדיקציה לתוצאות עתידיות — ביצועי עבר אינם מבטיחים "
            "ביצועים עתידיים. אסטרטגיות אוטומטיות ('טייסים אוטומטיים') עלולות לגרום להפסדים; הן פועלות "
            "בחשבון המסחר שלך והאחריות עליו נותרת שלך. Strateteach אינו מבטיח רווח כלשהו. סחור אך ורק "
            "בכסף שאתה יכול להרשות לעצמך להפסיד. אין באמור ייעוץ השקעות אישי."),
    },
    "privacy": {
        "en": (
            "Privacy Policy (draft). What we collect: account details (name, email, phone); your "
            "exchange API keys (trade-only, used to run the service); trading and backtest activity; "
            "support messages; and — only if you consent — pseudonymous product-usage analytics (which "
            "screens/features you use). Especially-sensitive data: financial details are treated as "
            "'especially sensitive' under the Protection of Privacy Law, 5741-1981 (as amended by "
            "Amendment 13, in force 14 Aug 2025) and protected accordingly. Why we use it: to operate "
            "and secure the service, to provide the features you request, and to improve the product. "
            "We do not sell your data. Who we share it with: the third-party exchange you connect; "
            "service providers who help us operate (e.g., messaging/email and hosting providers); and "
            "authorities where required by law. Your rights: access the data we hold about you and "
            "receive a copy (in Hebrew or English), correct inaccuracies, request deletion when the "
            "data is no longer needed, and withdraw analytics consent at any time — from Settings → My "
            "Data. Retention: we keep data only as long as necessary. [PLACEHOLDER — Raz/Dan to set "
            "periods]. Security: [PLACEHOLDER — summary of measures]. Questions about your data: "
            "[PLACEHOLDER — contact + whether a Data Protection Officer is appointed]."),
        "he": (
            "מדיניות פרטיות (טיוטה). מה אנו אוספים: פרטי חשבון (שם, אימייל, טלפון); מפתחות ה-API של "
            "הבורסה שלך (למסחר בלבד, לצורך הפעלת השירות); פעילות מסחר ובדיקות היסטוריות; פניות תמיכה; "
            "ורק אם נתת הסכמה — נתוני שימוש פסאודונימיים על אילו מסכים/תכונות אתה משתמש. מידע רגיש "
            "במיוחד: פרטים פיננסיים נחשבים 'מידע בעל רגישות גבוהה' לפי חוק הגנת הפרטיות, התשמ״א-1981 "
            "(כפי שתוקן בתיקון 13, שנכנס לתוקף ב-14 באוגוסט 2025) ומוגנים בהתאם. מדוע אנו משתמשים בו: "
            "להפעלת השירות ואבטחתו, לאספקת התכונות שביקשת, ולשיפור המוצר. איננו מוכרים את המידע שלך. עם "
            "מי אנו חולקים: זירת המסחר של צד שלישי שאליה התחברת; ספקי שירות המסייעים בהפעלה (למשל ספקי "
            "הודעות/דוא״ל ואירוח); ורשויות ככל שנדרש על-פי דין. זכויותיך: לעיין במידע שאנו מחזיקים "
            "אודותיך ולקבל עותק (בעברית או באנגלית), לתקן אי-דיוקים, לבקש מחיקה כאשר המידע אינו נחוץ "
            "עוד, ולחזור בך מהסכמה לאנליטיקס בכל עת — דרך הגדרות ← המידע שלי. שמירת מידע: אנו שומרים "
            "מידע רק כל עוד נחוץ. [PLACEHOLDER — רז/דן לקביעת תקופות]. אבטחה: [PLACEHOLDER — תמצית "
            "אמצעים]. שאלות על המידע שלך: [PLACEHOLDER — פרטי קשר והאם מונה ממונה הגנת פרטיות]."),
    },
    "consent": {
        "en": (
            "With your permission, we'll collect anonymous usage data — which screens and features you "
            "use — to make the app better. What we collect: screen and feature events tied to a random "
            "ID (not your name). What we never collect here: your trading credentials, exchange keys, "
            "strategy content, or any money amounts. This is optional — the app works fully whether you "
            "accept or not, and you can change your choice anytime in Settings → My Data."),
        "he": (
            "באישורך, נאסוף מידע שימוש אנונימי — באילו מסכים ותכונות אתה משתמש — כדי לשפר את האפליקציה. "
            "מה נאסף: אירועי מסך ותכונה המשויכים למזהה אקראי (לא שמך). מה לעולם לא נאסף כאן: פרטי "
            "ההתחברות למסחר, מפתחות הבורסה, תוכן אסטרטגיות או סכומי כסף כלשהם. זו בחירה שברשות — "
            "האפליקציה עובדת במלואה בין אם תאשר ובין אם לא, וניתן לשנות את הבחירה בכל עת בהגדרות ← "
            "המידע שלי."),
    },
}


def _seed_legal_copy() -> None:
    """Seed the 4 legal-copy blocks with the shipped drafts if absent (approved=FALSE).
    Never clobbers Raz's edits — ON CONFLICT DO NOTHING."""
    ts = now_iso()
    for block in LEGAL_COPY_BLOCKS:
        v = _LEGAL_COPY_SEED[block]
        execute(
            "INSERT INTO legal_copy (block, he, en, approved, updated_by, updated_at) "
            "VALUES (%s,%s,%s,FALSE,'seed',%s) ON CONFLICT (block) DO NOTHING",
            (block, v["he"], v["en"], ts),
        )


def list_legal_copy() -> "list[dict[str, Any]]":
    """The 4 legal-copy blocks (block, he, en, approved, updated_by, updated_at)."""
    return fetch_all("SELECT * FROM legal_copy ORDER BY block")


def get_legal_copy(block: str) -> "Optional[dict[str, Any]]":
    return fetch_one("SELECT * FROM legal_copy WHERE block = %s", (block,)) if block else None


def upsert_legal_copy(*, block: str, he: str, en: str, updated_by: str) -> "Optional[dict[str, Any]]":
    """Save a block's HE/EN copy. Editing REVERTS approved→FALSE (re-shows the DRAFT badge)
    so edited copy always goes back through an explicit Confirm & Approve."""
    return fetch_one(
        "INSERT INTO legal_copy (block, he, en, approved, updated_by, updated_at) "
        "VALUES (%s,%s,%s,FALSE,%s,%s) "
        "ON CONFLICT (block) DO UPDATE SET he = EXCLUDED.he, en = EXCLUDED.en, approved = FALSE, "
        "updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at RETURNING *",
        (block, he, en, updated_by, now_iso()),
    )


def approve_legal_copy(*, block: str, approved: bool, updated_by: str) -> "Optional[dict[str, Any]]":
    """Confirm & Approve (or un-approve) a block — flips `approved`, which clears/shows the
    DRAFT badge app-wide. Leaves the copy text unchanged."""
    return fetch_one(
        "UPDATE legal_copy SET approved = %s, updated_by = %s, updated_at = %s "
        "WHERE block = %s RETURNING *",
        (bool(approved), updated_by, now_iso(), block),
    )


# ── DAILY AUDIT ──────────────────────────────────────────────────────────────────
AUDIT_DOMAINS = ("it", "legal", "product")
AUDIT_STATUSES = ("todo", "in_process", "redo", "approved")
# Seed lines: "domain|baseline|SECTION :: title :: prompt". baseline='done' → approved,
# else 'todo'. From the v1 readiness audit (ביקורת אפיון ומוכנות ל-v1, 2026-07-03).
_AUDIT_SEED_RAW = """
it|partial|היוריסטיקות :: נראות מצב המערכת :: סטטוס מלא לכל פעולת כסף: נשלח/בעיבוד/הצליח/נכשל
product|done|היוריסטיקות :: שפה מהעולם האמיתי :: מונחון אחיד + בדיקת ניסוחים
it|partial|היוריסטיקות :: שליטה וחופש :: ביטול/אישור לפני פעולת LIVE בלתי-הפיכה
product|done|היוריסטיקות :: עקביות ותקנים :: להשלים כותרת אחידה/ScreenHero על כל המסכים
it|partial|היוריסטיקות :: מניעת שגיאות :: ולידציה, גבולות סכום, מניעת כפילויות
it|partial|היוריסטיקות :: זיהוי במקום זכירה :: מסך אישור שמציג סכום/עמלה/פרטים לפני LIVE
product|done|היוריסטיקות :: גמישות ויעילות :: קיצורים ניתנים לעריכה (שמירה)
product|done|היוריסטיקות :: עיצוב מינימליסטי :: מוקד יחיד, 2 פעולות (שמירה)
it|missing|היוריסטיקות :: התאוששות משגיאות :: הודעת שגיאה: מה קרה · האם הכסף בסיכון · הצעד הבא
product|done|היוריסטיקות :: עזרה ותיעוד בהקשר :: מסך מדריך מתחיל מלא
it|partial|עקרונות פינטק :: אמון נראה :: הסבר קצר 'למה מבקשים מידע'
it|partial|עקרונות פינטק :: שקיפות מלאה :: עמלות/שערים/סיכון לפני התחייבות
product|done|עקרונות פינטק :: איסוף מדורג :: KYC/מפתחות רק בעת חיבור (שמירה)
product|done|עקרונות פינטק :: הפחתת עומס/מוקד יחיד :: מתודולוגיית 2-הפעולות (שמירה)
it|partial|עקרונות פינטק :: מניעת טעויות כספיות :: preview + גבולות + כפילויות + התאוששות
it|partial|עקרונות פינטק :: נגישות מהיום הראשון :: מעבר WCAG מלא + לא-צבע-בלבד
product|done|עקרונות פינטק :: הפרדת חיכוך חיוני ממיותר :: KYC/אבטחה מתוזמנים (שמירה)
legal|done|תהליך :: שלב 0 · הקשר עסקי ורגולטורי :: לאמת רגולציה מול יועץ
product|partial|תהליך :: שלב 1 · Discovery :: מסמך מחקר/כאבים פורמלי
product|partial|תהליך :: שלב 2 · Define :: פרסונות/JTBD/KPIs מתועדים
product|partial|תהליך :: שלב 3 · מסעות ו-IA :: מפות מסע ו-user-flows עם הסתעפויות
product|missing|תהליך :: שלב 4 · רעיונאות :: 6 סקיצות למסך (או דילוג מתועד)
product|done|תהליך :: שלב 5 · אפיון מסכים :: להשלים תבנית מלאה לכל מסך
product|missing|תהליך :: שלב 6 · אב-טיפוס ובדיקות שמישות :: בדיקה עם 5-8 משתמשים
product|partial|תהליך :: שלב 7 · Handoff :: קריטריוני קבלה + tokens + אירועים
it|partial|תהליך :: שלב 8 · QA והשקה :: QA שיטתי: happy/negative, timeout, כפילות, נגישות
product|missing|תהליך :: שלב 9 · מדידה וממשל :: דשבורד מדדים + אירועי analytics
product|done|תבנית מסך :: שם/מטרה/פעולות :: הוגדרו (שמירה)
product|partial|תבנית מסך :: כניסה למסך :: לתעד תנאי כניסה לכל מסך
product|partial|תבנית מסך :: נתונים (מקור/רענון/fallback) :: מצב ריק/latency/fallback לכל מסך
it|partial|תבנית מסך :: מצבים (7) :: לכסות אין-הרשאה/לא-מקוון/timeout
it|missing|תבנית מסך :: ולידציות :: להגדיר ולידציה לכל טופס ופעולה
it|partial|תבנית מסך :: מיקרו-קופי :: קופי לשגיאות/גילויים/אישור
it|partial|תבנית מסך :: נגישות :: aria-labels, focus order, קורא מסך
it|missing|תבנית מסך :: אירועים (analytics/audit/fraud) :: קטלוג אירועים ורישום
product|partial|תבנית מסך :: קריטריוני קבלה :: Given/When/Then לכל מסך
it|missing|דפוסי אמון :: תצוגה מקדימה לפני התחייבות :: לפני LIVE/סגירת פוזיציה: סכום/הקצאה/עמלה/סיכון + אישור
it|missing|דפוסי אמון :: סטטוס פעולה מתמשך :: processing/pending + ערוץ עדכון
it|partial|דפוסי אמון :: הסבר 'למה מבקשים מידע' :: משפט קצר ליד כל בקשת מידע
it|missing|דפוסי אמון :: אישור עם מזהה עסקה :: מספר עסקה + זמן + שיתוף/הורדה
product|done|דפוסי אמון :: אבטחה מרגיעה :: 2FA + non-custodial (הסבר קצר)
it|partial|מיקרו-קופי :: כפתור אומר מה הוא עושה :: 'הפעל LIVE · כסף אמיתי · ₪X'
it|missing|מיקרו-קופי :: שגיאות כנות ומרגיעות :: 'הפקודה לא בוצעה. הכספים נשארו בחשבונך.'
it|partial|מיקרו-קופי :: שקיפות עמלה/סיכון בכפתור :: להציג עלות/סיכון לפני אישור
it|missing|מצבי שגיאה :: Timeout אחרי פעולה :: לבדוק סטטוס שרת; לא לשלוח שוב אוטומטית
it|missing|מצבי שגיאה :: כשל ספק (בורסה/פקודה) :: האם הפקודה יצאה/נכשלה + מזהה פנייה + נתיב תמיכה
it|partial|מצבי שגיאה :: נתון לא זמין :: retry + cache מסומן בזמן
it|partial|Dark Patterns :: ללא dark patterns :: לא להסתיר עלות, לא תיבות מסומנות-מראש, ביטול קל
it|partial|Dark Patterns :: ביטול/יציאה קלה :: לא להקשות על ביטול יותר מהרשמה
it|partial|Dark Patterns :: שינוי פרטים רגישים :: להשהות + התראה בערוץ נוסף
product|done|RTL ומספרים :: RTL + יישור מספרים :: שמירה
it|partial|RTL ומספרים :: סכומים/מטבע לפי locale :: פורמט אחד (₪ 250.00)
it|partial|RTL ומספרים :: מזהי עסקה LTR :: להציג מזהים כ-LTR נפרד, גופן קבוע
product|done|RTL ומספרים :: שמות אירועים/API :: שמירה
legal|partial|KYC ורגולציה :: KYC מדורג לפי סיכון :: רמות סיכון + מסלולי חריגה
legal|missing|KYC ורגולציה :: רשות ני"ע — אזהרות/התאמה/גילוי תשואות :: לאמת מול יועץ
legal|missing|KYC ורגולציה :: איסור הלבנת הון — KYC/AML/audit :: חובת KYC/דיווח מול יועץ
legal|partial|KYC ורגולציה :: הגנת הפרטיות :: consent matrix + זכות עיון/מחיקה
it|missing|ממשל ומדידה :: קטלוג אירועים (analytics+audit) :: אירועים עסקיים/UX/סיכון + audit trail
product|missing|ממשל ומדידה :: KPIs + דשבורד מדידה :: Activation/Trust/Operations/Risk/Accessibility
product|partial|ממשל ומדידה :: RACI :: מי מאשר מה (מוצר/משפטי/אבטחה)
product|partial|ממשל ומדידה :: Definition of Done :: DoD מחייב לכל מסך
"""


def _parse_audit_seed() -> "list[tuple]":
    """Parse the raw seed into (domain, baseline, section, title, prompt) tuples."""
    out: "list[tuple]" = []
    for line in _AUDIT_SEED_RAW.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            dom, baseline, rest = line.split("|", 2)
            section, title, prompt = [p.strip() for p in rest.split("::", 2)]
        except ValueError:
            continue
        out.append((dom.strip(), baseline.strip(), section, title, prompt))
    return out


def _seed_audit_items() -> None:
    """Seed the audit items if absent (idempotent by `key`). baseline='done' rows start
    'approved'; all others 'todo'. Never clobbers an editor's edits (ON CONFLICT DO NOTHING)."""
    ts = now_iso()
    for i, (dom, baseline, section, title, prompt) in enumerate(_parse_audit_seed()):
        key = f"{dom}|{section}|{title}"
        status = "approved" if baseline == "done" else "todo"
        execute(
            "INSERT INTO audit_items (key, domain, section, title, where_we_are, prompt, baseline, "
            "status, done_note, sort, updated_at, updated_by) "
            "VALUES (%s,%s,%s,%s,'',%s,%s,%s,'',%s,%s,'seed') ON CONFLICT (key) DO NOTHING",
            (key, dom, section, title, prompt, baseline, status, i * 10, ts),
        )


# First master-run findings (2026-07-08). Numbered 1..48 = the non-approved seed items in
# the SAME order the master prompt bundles them (ORDER BY section, sort, id) — so the
# backfill below re-uses that exact query. (status, done_note[HE]). Never 'approved'.
_AUDIT_FIRST_RUN = {
    1: ("in_process", "עיצוב נקי + עלות/סיכון מוצגים לפני התחייבות (Item4); ביקורת פורמלית 'אין תיבות מסומנות/ביטול קל' בכל זרימה — טרם"),
    2: ("in_process", "מודלי אישור כוללים ביטול; לא נבדק בכל זרימה"),
    3: ("todo", "2FA קיים; השהיה+התראה בערוץ נוסף בשינוי מפתחות/פרטים — לא מיושם"),
    4: ("todo", "לא מיושם (non-custodial); דרושה הכרעת רז אם נדרש רגולטורית"),
    5: ("in_process", "טיוטת אזהרות/גילוי שוחררה (פורטל משפטי); אימות מול רשות ני\"ע/יועץ — ממתין לרז"),
    6: ("todo", "לא מיושם; דרושה הכרעת רז (KYC/AML/דיווח)"),
    7: ("in_process", "הסכמה+ייצוא/מחיקת מידע שוחררו (Items 3/7); תקופות שמירה+DPO — ממתין לרז"),
    8: ("in_process", "עקבי ברובו; פורמט אחיד ₪250.00 לא נאכף בכל מקום"),
    9: ("todo", "הצגת מזהים כ-LTR/גופן קבוע — לא מיושם"),
    10: ("in_process", "✓ שוחרר היום (Item4: סכום/הקצאה/עמלה/סיכון+אישור לפני LIVE/סגירה) — לאמת ולאשר"),
    11: ("in_process", "מצבים נוספו (Item8)+ערוצי SMS/WhatsApp; מעקב פעולה-ברקע מלא — חלקי"),
    12: ("in_process", "הסכמה/גילויים מסבירים; משפט 'למה' ליד כל שדה — לא בכל מקום"),
    13: ("todo", "אישור עם מזהה עסקה (מספר+זמן+שיתוף/הורדה) — לא מיושם"),
    14: ("in_process", "מעבר מצבי-מסך שוחרר (Item8); לא כל פעולת כסף נבדקה"),
    15: ("in_process", "✓ שוחרר היום (Item5: אישור מוקלד GO-LIVE) — לאמת ולאשר"),
    16: ("in_process", "גבולות+מניעת כפילות שוחררו (Item5); ולידציית טפסים מלאה — חלקי"),
    17: ("in_process", "✓ שוחרר היום (Item4) — לאמת ולאשר"),
    18: ("in_process", "Item8+טקסט שגיאה כן — חלקי; 'הכסף בטוח/הצעד הבא' לא סטנדרטי"),
    19: ("in_process", "כפתורים מציינים פעולה; הסכום בכפתור — חלקי"),
    20: ("in_process", "מיקרו-קופי שגיאה כן — טיוטה, לא סטנדרטי בכל האפליקציה"),
    21: ("in_process", "✓ עלות/סיכון לפני אישור (Item4) — לאמת ולאשר"),
    22: ("in_process", "✓ קטלוג 12 אירועי analytics+audit_log (Item2/6) — לאמת ולאשר; אירועי הונאה — בהמשך"),
    23: ("in_process", "דשבורד Safety למנהל שוחרר (Item6); דשבורד KPI מלא — בהמשך"),
    24: ("in_process", "תפקידים (owner/legal/it) קיימים; מטריצת אישורים פורמלית — בהמשך"),
    25: ("todo", "DoD מחייב לכל מסך — טרם נכתב"),
    26: ("todo", "בדיקת סטטוס-שרת אחרי timeout — לא מיושם"),
    27: ("in_process", "טיפול שגיאות חלקי; 'האם הפקודה יצאה+מזהה+תמיכה' — לא סטנדרטי"),
    28: ("in_process", "fallback קיים; סימון cache בזמן — חלקי"),
    29: ("in_process", "חלקי (מפתחות); משפט 'למה' בכל בקשה — לא בכל מקום"),
    30: ("in_process", "✓ שוחרר היום (Item4: עמלות/סיכון לפני התחייבות) — לאמת ולאשר"),
    31: ("in_process", "✓ ליבה שוחררה היום (Item5); התאוששות — חלקי"),
    32: ("in_process", "פאנל נגישות+44px קיימים; WCAG 2.2 AA מלא+לא-צבע-בלבד — בהמשך"),
    33: ("todo", "תנאי כניסה לכל מסך — לא תועדו"),
    34: ("in_process", "נתונים חיים; ריק/latency/fallback לכל מסך — חלקי (Item8)"),
    35: ("in_process", "רבים כוסו (Item8); אין-הרשאה/לא-מקוון — לא בכל מקום"),
    36: ("todo", "ולידציה שיטתית לכל טופס — טרם הוגדרה"),
    37: ("in_process", "גילויים נוספו היום; קופי שגיאה/אישור — חלקי"),
    38: ("todo", "aria-labels/focus/קורא-מסך — טרם"),
    39: ("in_process", "analytics+audit שוחררו (Item2); אירועי הונאה/תמיכה — בהמשך"),
    40: ("todo", "קריטריוני קבלה Given/When/Then לכל מסך — טרם"),
    41: ("todo", "מסמך Discovery/כאבים פורמלי — טרם (אפשר 'דילוג מתועד')"),
    42: ("todo", "פרסונות/JTBD/KPIs — לא תועדו (אפשר דילוג מתועד)"),
    43: ("in_process", "ניווט+מפת מסכים קיימים; מפות מסע/flows עם הסתעפויות — בהמשך"),
    44: ("todo", "6 סקיצות למסך — לא בוצע (דילוג מתועד מקובל)"),
    45: ("todo", "בדיקת שמישות 5-8 משתמשים — לא בוצעה"),
    46: ("in_process", "הקוד=handoff; קריטריוני קבלה+tokens+אירועים — חלקי"),
    47: ("in_process", "QA ידני; שיטתי (happy/negative/timeout/כפילות/נגישות) — בהמשך"),
    48: ("in_process", "analytics שוחרר (Item2); דשבורד מדדים+ממשל מלא — בהמשך"),
}


def _backfill_audit_first_run() -> None:
    """One-time: record the assistant's first master-run findings onto the seeded audit
    items. Enumerates the non-approved items in the SAME order the master prompt numbers
    them (ORDER BY section, sort, id) and applies finding[i] to the i-th — but ONLY to a
    row still at its seed default (updated_by='seed' AND no done_note), so a human edit is
    never clobbered. Never sets 'approved' (that stays a human click). Idempotent via a flag."""
    if _get_singleton("audit_first_run_v1_done", False):
        return
    try:
        rows = fetch_all(
            "SELECT id, updated_by, done_note FROM audit_items WHERE status <> 'approved' "
            "ORDER BY section, sort, id")
        ts = now_iso()
        for i, r in enumerate(rows, 1):
            f = _AUDIT_FIRST_RUN.get(i)
            if not f:
                continue
            if (r.get("updated_by") == "seed") and not (r.get("done_note") or ""):
                status, note = f
                execute(
                    "UPDATE audit_items SET status = %s, done_note = %s, updated_at = %s, "
                    "updated_by = 'audit-backfill' WHERE id = %s",
                    (status, note, ts, r["id"]))
    except Exception:  # noqa: BLE001 — best-effort; never block boot
        return
    _set_singleton("audit_first_run_v1_done", True)


def _audit_item_json(r: "Optional[dict]") -> "Optional[dict[str, Any]]":
    if not r:
        return None
    return {
        "id": r["id"], "domain": r["domain"], "section": r["section"], "title": r["title"],
        "whereWeAre": r.get("where_we_are") or "", "prompt": r.get("prompt") or "",
        "baseline": r.get("baseline") or "missing", "status": r.get("status") or "todo",
        "doneNote": r.get("done_note") or "", "sentAt": r.get("sent_at"),
        "lastRunId": r.get("last_run_id"), "updatedBy": r.get("updated_by"), "updatedAt": r.get("updated_at"),
    }


def list_audit_items(domains: "Optional[list]" = None) -> "list[dict[str, Any]]":
    """Audit items in the given domains (all if None), ordered by section then sort."""
    if domains is not None and not domains:
        return []
    if domains is None:
        rows = fetch_all("SELECT * FROM audit_items ORDER BY section, sort, id")
    else:
        ph = ",".join(["%s"] * len(domains))
        rows = fetch_all(f"SELECT * FROM audit_items WHERE domain IN ({ph}) ORDER BY section, sort, id", tuple(domains))
    return [_audit_item_json(r) for r in rows]


def get_audit_item(item_id: int) -> "Optional[dict[str, Any]]":
    return _audit_item_json(fetch_one("SELECT * FROM audit_items WHERE id = %s", (item_id,)))


def update_audit_item(item_id: int, *, prompt: "Optional[str]" = None, done_note: "Optional[str]" = None,
                      updated_by: str) -> "Optional[dict[str, Any]]":
    sets, params = [], []
    if prompt is not None:
        sets.append("prompt = %s"); params.append(prompt)
    if done_note is not None:
        sets.append("done_note = %s"); params.append(done_note)
    if not sets:
        return get_audit_item(item_id)
    sets += ["updated_at = %s", "updated_by = %s"]; params += [now_iso(), updated_by, item_id]
    return _audit_item_json(fetch_one(f"UPDATE audit_items SET {', '.join(sets)} WHERE id = %s RETURNING *", tuple(params)))


AUDIT_BASELINES = ("done", "partial", "missing")


def create_audit_item(*, domain: str, section: str, title: str, prompt: str = "",
                      baseline: str = "missing", status: str = "todo",
                      created_by: str) -> "Optional[dict[str, Any]]":
    """Create a NEW (custom) audit / task item. Used by the "+ New task / + New audit item"
    button — staff editors + owners add their own items alongside the seeded ones. The key is
    a random `custom|…` token so it never collides with a seed key (domain|section|title) and
    the seed/backfill (which only touch updated_by='seed' rows) never clobbers it. `sort` is
    high so custom items sit AFTER the seeded ones within their section, ordered by id."""
    if baseline not in AUDIT_BASELINES:
        baseline = "missing"
    if status not in AUDIT_STATUSES:
        status = "todo"
    key = f"custom|{secrets.token_hex(8)}"
    ts = now_iso()
    row = fetch_one(
        "INSERT INTO audit_items (key, domain, section, title, where_we_are, prompt, baseline, "
        "status, done_note, sort, updated_at, updated_by) "
        "VALUES (%s,%s,%s,%s,'',%s,%s,%s,'',%s,%s,%s) RETURNING *",
        (key, domain, section, title, prompt, baseline, status, 100000, ts, created_by),
    )
    return _audit_item_json(row)


def set_audit_item_status(item_id: int, status: str, updated_by: str) -> "Optional[dict[str, Any]]":
    if status not in AUDIT_STATUSES:
        return get_audit_item(item_id)
    return _audit_item_json(fetch_one(
        "UPDATE audit_items SET status = %s, updated_at = %s, updated_by = %s WHERE id = %s RETURNING *",
        (status, now_iso(), updated_by, item_id)))


def create_audit_run(item_id: int, result_text: str = "") -> "Optional[dict[str, Any]]":
    """Create a run snapshotting the item's current prompt; link it as the item's last run."""
    item = fetch_one("SELECT prompt FROM audit_items WHERE id = %s", (item_id,))
    if not item:
        return None
    ts = now_iso()
    run = fetch_one(
        "INSERT INTO audit_runs (item_id, run_at, prompt_snapshot, result_text, status) "
        "VALUES (%s,%s,%s,%s,'pending') RETURNING *",
        (item_id, ts, item.get("prompt") or "", result_text or ""),
    )
    if run:
        execute("UPDATE audit_items SET last_run_id = %s, status = 'in_process', updated_at = %s WHERE id = %s",
                (run["id"], ts, item_id))
    return _audit_run_json(run)


def _audit_run_json(r: "Optional[dict]") -> "Optional[dict[str, Any]]":
    if not r:
        return None
    return {"id": r["id"], "itemId": r["item_id"], "runAt": r.get("run_at"),
            "promptSnapshot": r.get("prompt_snapshot") or "", "resultText": r.get("result_text") or "",
            "status": r.get("status") or "pending", "approvedBy": r.get("approved_by"), "approvedAt": r.get("approved_at")}


def update_audit_run_result(run_id: int, result_text: str) -> "Optional[dict[str, Any]]":
    return _audit_run_json(fetch_one(
        "UPDATE audit_runs SET result_text = %s WHERE id = %s RETURNING *", (result_text or "", run_id)))


def list_audit_runs(item_id: int) -> "list[dict[str, Any]]":
    rows = fetch_all("SELECT * FROM audit_runs WHERE item_id = %s ORDER BY id DESC", (item_id,))
    return [_audit_run_json(r) for r in rows]


def get_audit_run(run_id: int) -> "Optional[dict[str, Any]]":
    return _audit_run_json(fetch_one("SELECT * FROM audit_runs WHERE id = %s", (run_id,)))


def approve_audit_run(run_id: int, approver: str) -> "Optional[dict[str, Any]]":
    """Approve a run + mark its item approved."""
    ts = now_iso()
    run = fetch_one(
        "UPDATE audit_runs SET status = 'approved', approved_by = %s, approved_at = %s WHERE id = %s RETURNING *",
        (approver, ts, run_id))
    if run:
        execute("UPDATE audit_items SET status = 'approved', updated_at = %s, updated_by = %s WHERE id = %s",
                (ts, approver, run["item_id"]))
    return _audit_run_json(run)


def compile_audit_daily_prompt(domains: "list[str]") -> "dict[str, Any]":
    """Bundle every NON-approved item's prompt in `domains` into one runnable prompt, and
    stamp sent_at=now on those items. Returns { text, count, itemIds }."""
    if not domains:
        return {"text": "", "count": 0, "itemIds": []}
    ph = ",".join(["%s"] * len(domains))
    rows = fetch_all(
        f"SELECT id, domain, section, title, prompt FROM audit_items "
        f"WHERE domain IN ({ph}) AND status <> 'approved' ORDER BY section, sort, id", tuple(domains))
    if not rows:
        return {"text": "", "count": 0, "itemIds": []}
    lines = ["דוח ביקורת יומי — נא להריץ כל בדיקה ולתעד תוצאה (Approve / In-process / Redo):", ""]
    cur = None
    for i, r in enumerate(rows, 1):
        if r["section"] != cur:
            cur = r["section"]; lines.append(f"\n## {cur}")
        lines.append(f"{i}. [{r['domain']}] {r['title']} — {r['prompt']}")
    text = "\n".join(lines)
    ids = [r["id"] for r in rows]
    ts = now_iso()
    execute(f"UPDATE audit_items SET sent_at = %s WHERE id IN ({','.join(['%s'] * len(ids))})", (ts, *ids))
    return {"text": text, "count": len(ids), "itemIds": ids}


def list_legal_texts(published_only: bool = True) -> "list[dict[str, Any]]":
    """All legal texts (ordered). ``published_only`` restricts to live ones (public view);
    the admin console passes False to see drafts too."""
    if published_only:
        return fetch_all("SELECT * FROM legal_texts WHERE published = TRUE ORDER BY sort, key")
    return fetch_all("SELECT * FROM legal_texts ORDER BY sort, key")


def get_legal_text(key: str, published_only: bool = True) -> "Optional[dict[str, Any]]":
    if not key:
        return None
    if published_only:
        return fetch_one("SELECT * FROM legal_texts WHERE key = %s AND published = TRUE", (key,))
    return fetch_one("SELECT * FROM legal_texts WHERE key = %s", (key,))


def upsert_legal_text(*, key: str, title_he: str, title_en: str, body_he: str, body_en: str,
                      published: bool, updated_by: str, sort: Optional[int] = None) -> "dict[str, Any]":
    """Create or update a legal text (the editor Save). Returns the stored row."""
    row = get_legal_text(key, published_only=False)
    srt = sort if sort is not None else (int(row.get("sort") or 0) if row else 0)
    return fetch_one(
        "INSERT INTO legal_texts (key, title_he, title_en, body_he, body_en, published, sort, updated_at, updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (key) DO UPDATE SET title_he = EXCLUDED.title_he, title_en = EXCLUDED.title_en, "
        "body_he = EXCLUDED.body_he, body_en = EXCLUDED.body_en, published = EXCLUDED.published, "
        "sort = EXCLUDED.sort, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by RETURNING *",
        (key, title_he, title_en, body_he, body_en, bool(published), srt, now_iso(), updated_by),
    )


def is_legal_editor(username: str) -> bool:
    """True if the user may edit legal texts — the main admin (always) OR a user the main
    admin granted the ``legal_editor`` flag."""
    if not username:
        return False
    user = get_user(username)
    if not user:
        return False
    return bool(user.get("is_main")) or bool(user.get("legal_editor"))


def set_legal_editor(username: str, enabled: bool) -> bool:
    """Grant/revoke a user's legal-editor access (main-admin action)."""
    if not username:
        return False
    execute("UPDATE users SET legal_editor = %s WHERE username = %s", (bool(enabled), username))
    return True


def list_legal_editors() -> "list[dict[str, Any]]":
    """Users who can edit legal texts (explicit flag OR main admin), for the access panel."""
    return fetch_all(
        "SELECT username, role, is_main, legal_editor FROM users "
        "WHERE legal_editor = TRUE OR is_main = TRUE ORDER BY is_main DESC, username"
    )


# ── Content-editor grant (same pattern as legal_editor) ──────────────────────────
def is_content_editor(username: str) -> bool:
    """True if the user may use the content editors (Reels; Courses next) — the main admin
    (always) OR a user the main admin granted the ``content_editor`` flag."""
    if not username:
        return False
    user = get_user(username)
    if not user:
        return False
    return bool(user.get("is_main")) or bool(user.get("content_editor"))


def set_content_editor(username: str, enabled: bool) -> bool:
    if not username:
        return False
    execute("UPDATE users SET content_editor = %s WHERE username = %s", (bool(enabled), username))
    return True


# ── IT-editor grant (same pattern as legal_editor) ──────────────────────────────
def is_it_editor(username: str) -> bool:
    """True if the user may use the IT portal (chat/notes/system-links/tasks/report) — the main
    admin (always) OR a user the main admin granted the ``it_editor`` flag (e.g. Oren)."""
    if not username:
        return False
    user = get_user(username)
    if not user:
        return False
    return bool(user.get("is_main")) or bool(user.get("it_editor"))


def set_it_editor(username: str, enabled: bool) -> bool:
    """Grant/revoke a user's IT-editor access (owner action)."""
    if not username:
        return False
    execute("UPDATE users SET it_editor = %s WHERE username = %s", (bool(enabled), username))
    return True


def list_it_editors() -> "list[dict[str, Any]]":
    """Users who can use the IT portal (explicit flag OR main admin), for the access panel."""
    return fetch_all(
        "SELECT username, role, is_main, it_editor FROM users "
        "WHERE it_editor = TRUE OR is_main = TRUE ORDER BY is_main DESC, username"
    )


# ── Biz-dev-editor grant (same pattern as it_editor) ─────────────────────────────
def is_biz_editor(username: str) -> bool:
    """True if the user may use the Business-Development portal — the main admin (always) OR a
    user granted the ``biz_editor`` flag (e.g. Raful)."""
    if not username:
        return False
    user = get_user(username)
    if not user:
        return False
    return bool(user.get("is_main")) or bool(user.get("biz_editor"))


def set_biz_editor(username: str, enabled: bool) -> bool:
    """Grant/revoke a user's biz-dev-editor access (owner action)."""
    if not username:
        return False
    execute("UPDATE users SET biz_editor = %s WHERE username = %s", (bool(enabled), username))
    return True


def list_biz_editors() -> "list[dict[str, Any]]":
    """Users who can use the Biz-Dev portal (explicit flag OR main admin), for the access panel."""
    return fetch_all(
        "SELECT username, role, is_main, biz_editor FROM users "
        "WHERE biz_editor = TRUE OR is_main = TRUE ORDER BY is_main DESC, username"
    )


# ── Owner grant (same pattern as legal_editor/content_editor) ────────────────────
def has_owner_grant(username: str) -> bool:
    """True if the user carries the per-user ``owner_flag`` grant. (The full owner test —
    which also honours the main admin + the static OWNER allowlist — lives in
    security.is_owner, which folds this in.)"""
    if not username:
        return False
    user = get_user(username)
    if not user:
        return False
    return bool(user.get("owner_flag"))


def set_owner(username: str, enabled: bool) -> bool:
    """Grant/revoke a user's product-OWNER access (main-admin action)."""
    if not username:
        return False
    execute("UPDATE users SET owner_flag = %s WHERE username = %s", (bool(enabled), username))
    return True


def set_user_role(username: str, role: str) -> bool:
    """Set a user's base role ('admin' | 'user'). Never touches a main-admin row (the main
    admin can't be demoted here). Used by the Team-roles panel to grant/revoke full admin."""
    if not username or role not in ("admin", "user"):
        return False
    user = get_user(username)
    if not user or bool(user.get("is_main")):
        return False
    execute("UPDATE users SET role = %s WHERE username = %s", (role, username))
    return True


def list_team_roles() -> "list[dict[str, Any]]":
    """EVERY user with their role + team flags — the single source the Team-roles picker
    reads (so the exact username is always selectable, never free-typed / 'not found')."""
    return fetch_all(
        "SELECT username, role, COALESCE(is_main, FALSE) AS is_main, "
        "COALESCE(legal_editor, FALSE) AS legal_editor, COALESCE(content_editor, FALSE) AS content_editor, "
        "COALESCE(owner_flag, FALSE) AS owner_flag, COALESCE(it_editor, FALSE) AS it_editor, "
        "COALESCE(biz_editor, FALSE) AS biz_editor "
        "FROM users ORDER BY is_main DESC, role DESC, username"
    )


# ── Owners Portal · project-management board (Phase 2) ───────────────────────────
# Tasks toward launch + a headline goal per partner. Owners/admins manage everything;
# a partner may update progress/notes/status on their OWN tasks. All copy is bilingual
# and lives here (seeded once, idempotently) so the board is a real, editable store —
# the Phase-3 voting system can attach to the SAME task/goal rows by id.

# raful = the business-development collaborator (his own PM partner id, so tasks can be
# assigned to him and his biz-portal tasks tab resolves, exactly like oren/raz).
PM_PARTNERS = ("dan", "rafi", "yoav", "oren", "raz", "raful")
PM_STATUSES = ("todo", "in_progress", "blocked", "done")
# Shared priority scheme (tasks + finance investments): red=חשוב · orange=לדיון · green=מאושר.
PM_PRIORITIES = ("none", "red", "orange", "green")
# Name → partner-id aliases so a logged-in account resolves to its partner screen even
# if the username isn't exactly the id (case-insensitive; extend per real usernames).
_PM_ALIASES = {"dan": "dan", "daniel": "dan", "rafi": "rafi", "raphael": "rafi",
               "yoav": "yoav", "oren": "oren", "raz": "raz", "raful": "raful", "admin": "dan"}


def partner_for_username(username: str | None) -> Optional[str]:
    """Resolve a username to its partner id (dan/rafi/yoav/oren/raz), or None. Matches the
    id directly or a small alias table; the main admin ('admin') maps to Dan (founder)."""
    if not username:
        return None
    u = username.strip().lower()
    if u in PM_PARTNERS:
        return u
    return _PM_ALIASES.get(u)


def account_for_partner(pid: Optional[str]) -> Optional[str]:
    """Resolve a partner id (dan/rafi/yoav/oren/raz) → a REAL account username, or None.
    The report-sender needs this because the actual accounts are usually NOT named exactly
    'dan'/'rafi'/… (e.g. the founder signs in as 'admin', which aliases to 'dan').

    Collects every account that resolves to this partner (the id itself first if it exists,
    then any alias-mapped account), and PREFERS one with an email on file — so the owner
    resolves to their real inbox (Dan → the 'admin' account holding dpasler770@…, not a
    legacy emailless 'dan' record). Falls back to the first candidate when none has one."""
    if not pid:
        return None
    candidates: List[str] = []
    if get_user(pid):
        candidates.append(pid)
    for r in fetch_all("SELECT username FROM users"):
        uname = r.get("username")
        if uname and uname != pid and partner_for_username(uname) == pid:
            candidates.append(uname)
    if not candidates:
        return None
    for uname in candidates:
        if (get_user(uname) or {}).get("email"):
            return uname
    return candidates[0]


def _pm_partners_of(r: "dict[str, Any]") -> "list[str]":
    """A task's assigned partner ids as a list — from the `partners` CSV, falling back to
    the legacy single `partner` column so old single-assignee rows still resolve."""
    raw = (r.get("partners") or "").strip()
    if raw:
        return [p for p in (x.strip() for x in raw.split(",")) if p]
    p = r.get("partner")
    return [p] if p else []


# SQL fragment: does partner id `%s` belong to this task? Wraps the CSV (falling back to the
# single column) in commas and matches `,pid,`. Pass the pid via f"%,{pid},%" as the LIKE arg.
_PM_MEMBER_SQL = "(',' || COALESCE(NULLIF(partners, ''), COALESCE(partner, '')) || ',') LIKE %s"

# Priority rank for ORDER BY — a chosen priority raises the task to the TOP: red→orange→green,
# then unprioritized. Used as the FIRST sort key so `list … ORDER BY {rank}, sort, phase, id`.
_PM_PRIO_RANK = "CASE priority WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'green' THEN 2 ELSE 3 END"
_PM_ORDER = f"{_PM_PRIO_RANK}, sort, phase, id"


def _pm_task_json(r: "dict[str, Any]") -> "dict[str, Any]":
    partners = _pm_partners_of(r)
    return {
        "id": int(r["id"]), "key": r.get("key"),
        "titleHe": r.get("title_he") or "", "titleEn": r.get("title_en") or "",
        "assignee": r.get("assignee"),
        # `partner` = PRIMARY (first) partner, kept for backward compatibility; `partners` =
        # the full assigned set (a task can belong to several partners).
        "partner": (r.get("partner") or (partners[0] if partners else None)),
        "partners": partners,
        "status": r.get("status") or "todo", "progress": int(r.get("progress") or 0),
        "notes": r.get("notes") or "", "detail": r.get("detail") or "",
        "subtasks": _pm_subtasks_of(r), "implStatus": r.get("impl_status") or "",
        "phase": r.get("phase"), "category": r.get("category"),
        "priority": r.get("priority") or "none",
        "sort": int(r.get("sort") or 0), "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by"),
    }


def list_pm_tasks(*, partner: Optional[str] = None, assignee: Optional[str] = None) -> "list[dict[str, Any]]":
    """PM tasks (optionally scoped to a partner or an assignee), stable order. A `partner`
    scope matches ANY of a task's assigned partners (multi-assignee aware)."""
    clauses: List[str] = []
    params: List[Any] = []
    if partner:
        clauses.append(_PM_MEMBER_SQL); params.append(f"%,{partner},%")
    if assignee:
        clauses.append("assignee = %s"); params.append(assignee)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return [_pm_task_json(r) for r in fetch_all(
        f"SELECT * FROM pm_tasks{where} ORDER BY {_PM_ORDER}", tuple(params))]


def list_pm_tasks_for(username: str) -> "list[dict[str, Any]]":
    """The caller's tasks — matched by assignee username OR by their resolved partner id in
    the task's partner set (so a multi-assignee task shows on EACH assigned partner's screen)."""
    pid = partner_for_username(username)
    return [_pm_task_json(r) for r in fetch_all(
        f"SELECT * FROM pm_tasks WHERE assignee = %s OR (%s AND {_PM_MEMBER_SQL}) "
        f"ORDER BY {_PM_ORDER}", (username, pid is not None, f"%,{pid},%"))]


def list_pm_tasks_assigned_to(partner: str) -> "list[dict[str, Any]]":
    """EVERY task assigned to a partner id, in BOTH senses of "assigned to me":
      • the partner is in the task's assigned partner-set (multi-assignee — the partner chips), OR
      • the task's ASSIGNEE resolves to that partner (a task an owner entered FOR them, even if
        they weren't added to the partner chips).
    Union, de-duped, stable order. This is what the collaborator portals (Raz/Oren) use so their
    Tasks tab shows ALL their tasks — including ones others created for them. The partner-set half
    is a straight SQL match; the assignee half resolves usernames→partner (alias-aware) in Python,
    which the plain `list_pm_tasks(partner=…)` can't do — that's the gap this closes."""
    out: "list[dict[str, Any]]" = []
    seen: set = set()
    for r in fetch_all(f"SELECT * FROM pm_tasks ORDER BY {_PM_ORDER}"):
        pset = _pm_partners_of(r)
        if partner in pset or partner_for_username(r.get("assignee")) == partner:
            if r["id"] not in seen:
                seen.add(r["id"]); out.append(_pm_task_json(r))
    return out


def get_pm_task(task_id: int) -> "Optional[dict[str, Any]]":
    r = fetch_one("SELECT * FROM pm_tasks WHERE id = %s", (task_id,))
    return _pm_task_json(r) if r else None


def _pm_partners_csv(partners: "Optional[list]", partner: Optional[str]) -> "tuple[Optional[str], Optional[str]]":
    """Normalize a requested partner set → (csv, primary). Accepts an explicit `partners`
    list or falls back to a single `partner`; keeps only known partner ids, de-duped, order
    preserved. Returns (CSV or None, primary/first or None)."""
    src = partners if partners is not None else ([partner] if partner else [])
    seen: "list[str]" = []
    for p in src:
        p = (p or "").strip().lower()
        if p in PM_PARTNERS and p not in seen:
            seen.append(p)
    return ((",".join(seen) if seen else None), (seen[0] if seen else None))


def create_pm_task(*, title_he: str, title_en: str, assignee: Optional[str], partner: Optional[str],
                   status: str = "todo", progress: int = 0, notes: str = "", impl_status: str = "",
                   phase: Optional[str] = None, category: Optional[str] = None, sort: int = 0,
                   created_by: Optional[str] = None, key: Optional[str] = None,
                   partners: "Optional[list]" = None, detail: str = "", priority: str = "none") -> "dict[str, Any]":
    if status not in PM_STATUSES:
        status = "todo"
    if priority not in PM_PRIORITIES:
        priority = "none"
    partners_csv, primary = _pm_partners_csv(partners, partner)
    ts = now_iso()
    r = fetch_one(
        "INSERT INTO pm_tasks (key, title_he, title_en, assignee, partner, partners, status, progress, notes, "
        "detail, impl_status, phase, category, priority, sort, created_at, updated_at, updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (key, title_he or "", title_en or "", assignee, primary, partners_csv, status,
         max(0, min(100, int(progress))), notes or "", detail or "", impl_status or "", phase, category,
         priority, int(sort), ts, ts, created_by),
    )
    return _pm_task_json(r)


def get_pm_task_by_key(key: str) -> "Optional[dict[str, Any]]":
    r = fetch_one("SELECT * FROM pm_tasks WHERE key = %s", (key,))
    return _pm_task_json(r) if r else None


# The fields a partner may self-edit on their OWN task (a full owner/admin edit may set any).
PM_PARTNER_FIELDS = {"status", "progress", "notes"}
_PM_COL = {"titleHe": "title_he", "titleEn": "title_en", "assignee": "assignee", "partner": "partner",
           "partners": "partners", "status": "status", "progress": "progress", "notes": "notes",
           "detail": "detail", "implStatus": "impl_status", "phase": "phase", "category": "category",
           "priority": "priority", "sort": "sort"}


def update_pm_task(task_id: int, fields: "dict[str, Any]", *, updated_by: str,
                   allowed: Optional[set] = None) -> "Optional[dict[str, Any]]":
    """Patch a task. `allowed` (when given) restricts which camelCase keys may be written
    (a partner self-edit passes PM_PARTNER_FIELDS); None = any field (owner/admin)."""
    fields = dict(fields)
    # A `partners` list edit → the CSV column, and keep the legacy primary `partner` in sync.
    if "partners" in fields and (allowed is None or "partners" in allowed):
        csv, primary = _pm_partners_csv(fields.get("partners"), None)
        fields["partners"] = csv
        fields["partner"] = primary
    sets: List[str] = []
    params: List[Any] = []
    for k, v in fields.items():
        if k not in _PM_COL:
            continue
        if allowed is not None and k not in allowed:
            continue
        if k == "progress":
            v = max(0, min(100, int(v or 0)))
        elif k == "status" and v not in PM_STATUSES:
            continue
        elif k == "priority" and v not in PM_PRIORITIES:
            continue
        sets.append(f"{_PM_COL[k]} = %s"); params.append(v)
    if not sets:
        return get_pm_task(task_id)
    sets.append("updated_at = %s"); params.append(now_iso())
    sets.append("updated_by = %s"); params.append(updated_by)
    params.append(task_id)
    r = fetch_one(f"UPDATE pm_tasks SET {', '.join(sets)} WHERE id = %s RETURNING *", tuple(params))
    return _pm_task_json(r) if r else None


def delete_pm_task(task_id: int) -> bool:
    execute("DELETE FROM pm_tasks WHERE id = %s", (task_id,))
    return True


# ── PM sub-tasks (JSON checklist on a task) ──────────────────────────────────────
# Each sub-task is {id:int, title:str, done:bool}; the list lives in pm_tasks.subtasks
# (JSONB). ids are per-task ints (max existing + 1) — deleting the highest id may let the
# next add reuse it, which is harmless: the list is server-authoritative and the client
# refetches the whole task after every mutation, so a stale toggle just no-ops. All three
# mutations reload → mutate → write the whole list back — fine for a short checklist.
def _pm_subtasks_of(r: "dict[str, Any]") -> "list[dict[str, Any]]":
    raw = r.get("subtasks")
    if isinstance(raw, str):
        import json
        try:
            raw = json.loads(raw or "[]")
        except Exception:
            raw = []
    if not isinstance(raw, list):
        return []
    out: List[dict] = []
    for s in raw:
        if isinstance(s, dict) and s.get("id") is not None:
            out.append({"id": int(s["id"]), "title": str(s.get("title") or ""), "done": bool(s.get("done"))})
    return out


def _pm_raw_subtasks(task_id: int) -> "Optional[list[dict[str, Any]]]":
    r = fetch_one("SELECT subtasks FROM pm_tasks WHERE id = %s", (task_id,))
    if r is None:
        return None
    return _pm_subtasks_of(r)


def _pm_write_subtasks(task_id: int, subs: "list[dict[str, Any]]", *, updated_by: str) -> "Optional[dict[str, Any]]":
    import json
    r = fetch_one(
        "UPDATE pm_tasks SET subtasks = %s::jsonb, updated_at = %s, updated_by = %s WHERE id = %s RETURNING *",
        (json.dumps(subs), now_iso(), updated_by, task_id))
    return _pm_task_json(r) if r else None


def add_pm_subtask(task_id: int, title: str, *, updated_by: str) -> "Optional[dict[str, Any]]":
    subs = _pm_raw_subtasks(task_id)
    if subs is None:
        return None
    nid = (max((s["id"] for s in subs), default=0) or 0) + 1
    subs.append({"id": nid, "title": (title or "").strip(), "done": False})
    return _pm_write_subtasks(task_id, subs, updated_by=updated_by)


def update_pm_subtask(task_id: int, sub_id: int, *, title: Optional[str] = None,
                      done: Optional[bool] = None, updated_by: str) -> "Optional[dict[str, Any]]":
    subs = _pm_raw_subtasks(task_id)
    if subs is None:
        return None
    for s in subs:
        if s["id"] == sub_id:
            if title is not None:
                s["title"] = title.strip()
            if done is not None:
                s["done"] = bool(done)
            break
    return _pm_write_subtasks(task_id, subs, updated_by=updated_by)


def delete_pm_subtask(task_id: int, sub_id: int, *, updated_by: str) -> "Optional[dict[str, Any]]":
    subs = _pm_raw_subtasks(task_id)
    if subs is None:
        return None
    subs = [s for s in subs if s["id"] != sub_id]
    return _pm_write_subtasks(task_id, subs, updated_by=updated_by)


# ── Owners Portal · FINANCE (owner-only business finance store) ─────────────────
# Four small CRUD stores modelled on the pm_tasks pattern. NUMERIC money → float in JSON.
# Table + column names below are CODE constants (never user input), so the f-string SQL is
# injection-safe; every VALUE flows through a %s parameter.
def _fnum(v: "Any") -> float:
    try:
        return round(float(v or 0), 2)
    except Exception:  # noqa: BLE001
        return 0.0

_FIN_NUMERIC = {"planned", "actual", "amount", "balance"}

def _fin_update(table: str, colmap: "dict[str, str]", tojson, row_id: int,
                fields: "dict[str, Any]", updated_by: str) -> "Optional[dict[str, Any]]":
    sets: List[str] = []
    params: List[Any] = []
    for k, v in (fields or {}).items():
        if k not in colmap:
            continue
        if k == "sort":
            v = int(v or 0)
        elif k in _FIN_NUMERIC:
            v = _fnum(v)
        else:
            v = "" if v is None else str(v)
        sets.append(f"{colmap[k]} = %s"); params.append(v)
    if not sets:
        r = fetch_one(f"SELECT * FROM {table} WHERE id = %s", (row_id,))
        return tojson(r) if r else None
    sets.append("updated_at = %s"); params.append(now_iso())
    sets.append("updated_by = %s"); params.append(updated_by)
    params.append(row_id)
    r = fetch_one(f"UPDATE {table} SET {', '.join(sets)} WHERE id = %s RETURNING *", tuple(params))
    return tojson(r) if r else None

def _fin_delete(table: str, row_id: int) -> bool:
    execute(f"DELETE FROM {table} WHERE id = %s", (row_id,))
    return True

# — Budget lines —
def _fin_budget_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"id": int(r["id"]), "scope": r.get("scope") or "month", "period": r.get("period") or "",
            "category": r.get("category") or "", "label": r.get("label") or "",
            "planned": _fnum(r.get("planned")), "actual": _fnum(r.get("actual")),
            "currency": r.get("currency") or "USD", "notes": r.get("notes") or "",
            "sort": int(r.get("sort") or 0), "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}

_FIN_BUDGET_COL = {"scope": "scope", "period": "period", "category": "category", "label": "label",
                   "planned": "planned", "actual": "actual", "currency": "currency", "notes": "notes", "sort": "sort"}

def list_finance_budget() -> "list[dict[str, Any]]":
    return [_fin_budget_json(r) for r in fetch_all("SELECT * FROM finance_budget_lines ORDER BY scope, sort, period, id")]

def create_finance_budget(fields: "dict[str, Any]", created_by: str) -> "dict[str, Any]":
    ts = now_iso()
    r = fetch_one(
        "INSERT INTO finance_budget_lines (scope,period,category,label,planned,actual,currency,notes,sort,created_at,updated_at,updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (str(fields.get("scope") or "month"), str(fields.get("period") or ""), str(fields.get("category") or ""),
         str(fields.get("label") or ""), _fnum(fields.get("planned")), _fnum(fields.get("actual")),
         str(fields.get("currency") or "USD"), str(fields.get("notes") or ""), int(fields.get("sort") or 0),
         ts, ts, created_by))
    return _fin_budget_json(r)

def update_finance_budget(row_id: int, fields, updated_by):
    return _fin_update("finance_budget_lines", _FIN_BUDGET_COL, _fin_budget_json, row_id, fields, updated_by)

def delete_finance_budget(row_id: int) -> bool:
    return _fin_delete("finance_budget_lines", row_id)

# — Expenses —
def _fin_expense_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"id": int(r["id"]), "name": r.get("name") or "", "amount": _fnum(r.get("amount")),
            "category": r.get("category") or "", "currency": r.get("currency") or "USD",
            "dueDate": r.get("due_date") or "", "status": r.get("status") or "planned",
            "recurring": r.get("recurring") or "", "notes": r.get("notes") or "",
            "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}

_FIN_EXPENSE_COL = {"name": "name", "amount": "amount", "category": "category", "currency": "currency",
                    "dueDate": "due_date", "status": "status", "recurring": "recurring", "notes": "notes"}
FINANCE_EXPENSE_STATUSES = ("planned", "pending", "paid", "overdue", "cancelled")

def list_finance_expenses() -> "list[dict[str, Any]]":
    return [_fin_expense_json(r) for r in fetch_all("SELECT * FROM finance_expenses ORDER BY due_date DESC, id DESC")]

def create_finance_expense(fields: "dict[str, Any]", created_by: str) -> "dict[str, Any]":
    ts = now_iso()
    status = str(fields.get("status") or "planned")
    if status not in FINANCE_EXPENSE_STATUSES:
        status = "planned"
    r = fetch_one(
        "INSERT INTO finance_expenses (name,amount,category,currency,due_date,status,recurring,notes,created_at,updated_at,updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (str(fields.get("name") or ""), _fnum(fields.get("amount")), str(fields.get("category") or ""),
         str(fields.get("currency") or "USD"), str(fields.get("dueDate") or ""), status,
         str(fields.get("recurring") or ""), str(fields.get("notes") or ""), ts, ts, created_by))
    return _fin_expense_json(r)

def update_finance_expense(row_id: int, fields, updated_by):
    fields = dict(fields or {})
    if "status" in fields and fields["status"] not in FINANCE_EXPENSE_STATUSES:
        fields.pop("status")
    return _fin_update("finance_expenses", _FIN_EXPENSE_COL, _fin_expense_json, row_id, fields, updated_by)

def delete_finance_expense(row_id: int) -> bool:
    return _fin_delete("finance_expenses", row_id)

# — Wallets —
def _fin_wallet_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"id": int(r["id"]), "name": r.get("name") or "", "balance": _fnum(r.get("balance")),
            "currency": r.get("currency") or "USD", "kind": r.get("kind") or "bank",
            "notes": r.get("notes") or "", "sort": int(r.get("sort") or 0),
            "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}

_FIN_WALLET_COL = {"name": "name", "balance": "balance", "currency": "currency", "kind": "kind", "notes": "notes", "sort": "sort"}

def list_finance_wallets() -> "list[dict[str, Any]]":
    return [_fin_wallet_json(r) for r in fetch_all("SELECT * FROM finance_wallets ORDER BY sort, id")]

def create_finance_wallet(fields: "dict[str, Any]", created_by: str) -> "dict[str, Any]":
    ts = now_iso()
    r = fetch_one(
        "INSERT INTO finance_wallets (name,balance,currency,kind,notes,sort,updated_at,updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (str(fields.get("name") or ""), _fnum(fields.get("balance")), str(fields.get("currency") or "USD"),
         str(fields.get("kind") or "bank"), str(fields.get("notes") or ""), int(fields.get("sort") or 0), ts, created_by))
    return _fin_wallet_json(r)

def update_finance_wallet(row_id: int, fields, updated_by):
    return _fin_update("finance_wallets", _FIN_WALLET_COL, _fin_wallet_json, row_id, fields, updated_by)

def delete_finance_wallet(row_id: int) -> bool:
    return _fin_delete("finance_wallets", row_id)

# — Revenue forecast —
def _fin_revenue_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"id": int(r["id"]), "period": r.get("period") or "", "label": r.get("label") or "",
            "amount": _fnum(r.get("amount")), "currency": r.get("currency") or "USD",
            "notes": r.get("notes") or "", "sort": int(r.get("sort") or 0),
            "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}

_FIN_REVENUE_COL = {"period": "period", "label": "label", "amount": "amount", "currency": "currency", "notes": "notes", "sort": "sort"}

def list_finance_revenue() -> "list[dict[str, Any]]":
    return [_fin_revenue_json(r) for r in fetch_all("SELECT * FROM finance_revenue ORDER BY period, sort, id")]

def create_finance_revenue(fields: "dict[str, Any]", created_by: str) -> "dict[str, Any]":
    ts = now_iso()
    r = fetch_one(
        "INSERT INTO finance_revenue (period,label,amount,currency,notes,sort,created_at,updated_at,updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (str(fields.get("period") or ""), str(fields.get("label") or ""), _fnum(fields.get("amount")),
         str(fields.get("currency") or "USD"), str(fields.get("notes") or ""), int(fields.get("sort") or 0), ts, ts, created_by))
    return _fin_revenue_json(r)

def update_finance_revenue(row_id: int, fields, updated_by):
    return _fin_update("finance_revenue", _FIN_REVENUE_COL, _fin_revenue_json, row_id, fields, updated_by)

def delete_finance_revenue(row_id: int) -> bool:
    return _fin_delete("finance_revenue", row_id)

# — Investments (initial / additional capital, source, optional owner link) —
def _fin_investment_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"id": int(r["id"]), "amount": _fnum(r.get("amount")), "kind": r.get("kind") or "initial",
            "source": r.get("source") or "", "date": r.get("inv_date") or "",
            "owner": r.get("owner") or "", "currency": r.get("currency") or "USD",
            "purpose": r.get("purpose") or "other",
            "priority": r.get("priority") or "none",
            "notes": r.get("notes") or "", "sort": int(r.get("sort") or 0),
            "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}

_FIN_INVESTMENT_COL = {"amount": "amount", "kind": "kind", "source": "source", "date": "inv_date",
                       "owner": "owner", "currency": "currency", "purpose": "purpose",
                       "priority": "priority", "notes": "notes", "sort": "sort"}
FINANCE_INVESTMENT_KINDS = ("initial", "additional")
# What the investment money is FOR / WHERE it went (classification, per Dan). Keys are stable;
# labels are localised in the frontend. 'other' is the default/unclassified bucket. Extended to
# cover: company operating capital · owners' loan · initial share purchase.
FINANCE_INVESTMENT_PURPOSES = ("working_capital", "owner_loan", "initial_shares",
                               "equity", "company", "ongoing", "other")

def list_finance_investments() -> "list[dict[str, Any]]":
    return [_fin_investment_json(r) for r in fetch_all("SELECT * FROM finance_investments ORDER BY inv_date DESC, id DESC")]

def shared_fund_view() -> "dict[str, Any]":
    """The owners' SHARED FUND — derived from the owner-attributed investments the
    owners already entered (spec §5, decision doc). OWNER-ONLY.

    Ownership % = each owner's net contributed capital / total owner contributions.
    NAV = total owner contributions ± any recorded fund P&L (none tracked in the
    main app yet — the fund has not traded, so NAV == contributed for now).

    STRICTLY SEPARATED: only rows attributed to an owner (dan/rafi/yoav) count;
    company money (owner='') and client money are excluded by construction. This
    is a READ — it moves nothing and executes nothing; trading the fund stays a
    gated, owner-only 3-of-3 act elsewhere."""
    OWNERS = ("dan", "rafi", "yoav")
    OWNER_NAMES = {"dan": "Dan", "rafi": "Rafi", "yoav": "Yoav"}
    contributed: "dict[str, float]" = {o: 0.0 for o in OWNERS}
    for inv in list_finance_investments():
        o = (inv.get("owner") or "").strip().lower()
        if o in contributed:
            contributed[o] = round(contributed[o] + float(inv.get("amount") or 0), 2)
    total = round(sum(contributed.values()), 2)
    by_owner = [
        {
            "owner": o, "name": OWNER_NAMES[o],
            "contributed": contributed[o],
            "ownershipPct": round((contributed[o] / total) * 100, 4) if total > 0 else 0.0,
        }
        for o in OWNERS
    ]
    return {
        "navUsd": total,               # no fund P&L recorded yet → NAV == contributed
        "contributedTotal": total,
        "pnlNet": 0.0,
        "byOwner": by_owner,
        "currency": "USD",
        # honest provenance for the UI:
        "note": "Derived from owner-attributed investments. Separate from company and client money. The fund has not traded — NAV equals contributed capital.",
    }


def create_finance_investment(fields: "dict[str, Any]", created_by: str) -> "dict[str, Any]":
    ts = now_iso()
    kind = str(fields.get("kind") or "initial")
    if kind not in FINANCE_INVESTMENT_KINDS:
        kind = "initial"
    purpose = str(fields.get("purpose") or "other")
    if purpose not in FINANCE_INVESTMENT_PURPOSES:
        purpose = "other"
    priority = str(fields.get("priority") or "none")
    if priority not in PM_PRIORITIES:
        priority = "none"
    r = fetch_one(
        "INSERT INTO finance_investments (amount,kind,source,inv_date,owner,currency,purpose,priority,notes,sort,created_at,updated_at,updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (_fnum(fields.get("amount")), kind, str(fields.get("source") or ""), str(fields.get("date") or ""),
         str(fields.get("owner") or ""), str(fields.get("currency") or "USD"), purpose, priority, str(fields.get("notes") or ""),
         int(fields.get("sort") or 0), ts, ts, created_by))
    return _fin_investment_json(r)

def update_finance_investment(row_id: int, fields, updated_by):
    fields = dict(fields or {})
    if "kind" in fields and fields["kind"] not in FINANCE_INVESTMENT_KINDS:
        fields.pop("kind")
    if "purpose" in fields and fields["purpose"] not in FINANCE_INVESTMENT_PURPOSES:
        fields.pop("purpose")
    if "priority" in fields and fields["priority"] not in PM_PRIORITIES:
        fields.pop("priority")
    return _fin_update("finance_investments", _FIN_INVESTMENT_COL, _fin_investment_json, row_id, fields, updated_by)

def delete_finance_investment(row_id: int) -> bool:
    return _fin_delete("finance_investments", row_id)


# ══ EMPLOYEE MANAGEMENT (Phase 1) ════════════════════════════════════════════════
EMPLOYEE_STATUSES = ("active", "onboarding", "paused")
EMPLOYEE_PAYMENT_TYPES = ("salary", "bonus", "expense", "addition")
EMPLOYEE_PAYMENT_STATUSES = ("paid", "pending")
BONUS_PROGRAM_STATUSES = ("none", "requested", "active", "paused")


def _employee_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {
        "username": r.get("username"),
        "fullName": r.get("full_name") or "",
        "role": r.get("role") or "",
        "workDomains": [d for d in (r.get("work_domains") or "").split(",") if d],
        "status": r.get("status") or "active",
        "joinDate": r.get("join_date") or "",
        "birthday": r.get("birthday") or "",
        "contact": r.get("contact") or "",
        "subaccountDetails": r.get("subaccount_details") or "",
        "monthlySalary": _fnum(r.get("monthly_salary")),
        "bonusAccount": bool(r.get("bonus_account_flag")),
        "hasPortal": bool(r.get("has_portal")),
        "walletAddress": r.get("wallet_address") or "",
        # Bonus / sub-account trading program (Phase 3).
        "bonusProgramStatus": r.get("bonus_program_status") or "none",
        "initialDeposit": _fnum(r.get("initial_deposit")),
        "depositInvestmentId": (int(r["deposit_investment_id"]) if r.get("deposit_investment_id") else None),
        "tradingPnl": _fnum(r.get("trading_pnl")),
        "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by"),
    }


# camelCase → column, split by python type so we coerce correctly (str / numeric / bool / CSV).
_EMP_STR = {"fullName": "full_name", "role": "role", "status": "status", "joinDate": "join_date",
            "birthday": "birthday", "contact": "contact", "subaccountDetails": "subaccount_details",
            "walletAddress": "wallet_address", "bonusProgramStatus": "bonus_program_status"}
_EMP_NUM = {"monthlySalary": "monthly_salary", "initialDeposit": "initial_deposit", "tradingPnl": "trading_pnl"}
_EMP_BOOL = {"bonusAccount": "bonus_account_flag", "hasPortal": "has_portal"}
_EMP_CSV = {"workDomains": "work_domains"}


def list_employees() -> "list[dict[str, Any]]":
    return [_employee_json(r) for r in fetch_all(
        "SELECT * FROM employees ORDER BY (status = 'active') DESC, role, username")]


def get_employee(username: str) -> "Optional[dict[str, Any]]":
    if not username:
        return None
    r = fetch_one("SELECT * FROM employees WHERE username = %s", (username,))
    return _employee_json(r) if r else None


def update_employee(username: str, fields: "dict[str, Any]", updated_by: str) -> "Optional[dict[str, Any]]":
    """Patch an employee's typed columns. Owner sets role/domains/status/salary/portal; the
    employee self-edits birthday/contact/sub-account/wallet — the endpoint gates WHICH keys it
    forwards, this just coerces + writes whatever it's given."""
    sets: List[str] = []
    params: List[Any] = []
    for k, v in (fields or {}).items():
        if k in _EMP_STR:
            if k == "status" and v not in EMPLOYEE_STATUSES:
                continue
            if k == "bonusProgramStatus" and v not in BONUS_PROGRAM_STATUSES:
                continue
            sets.append(f"{_EMP_STR[k]} = %s"); params.append("" if v is None else str(v))
        elif k in _EMP_NUM:
            sets.append(f"{_EMP_NUM[k]} = %s"); params.append(_fnum(v))
        elif k in _EMP_BOOL:
            sets.append(f"{_EMP_BOOL[k]} = %s"); params.append(bool(v))
        elif k in _EMP_CSV:
            csv = ",".join(str(x).strip() for x in v if str(x).strip()) if isinstance(v, list) else str(v or "")
            sets.append(f"{_EMP_CSV[k]} = %s"); params.append(csv)
    if not sets:
        return get_employee(username)
    sets += ["updated_at = %s", "updated_by = %s"]; params += [now_iso(), updated_by]
    params.append(username)
    r = fetch_one(f"UPDATE employees SET {', '.join(sets)} WHERE username = %s RETURNING *", tuple(params))
    return _employee_json(r) if r else None


def create_employee(username: str, fields: "dict[str, Any]", created_by: str) -> "Optional[dict[str, Any]]":
    """Create an employee (add-employee onboarding). If the row already exists, patches it —
    so this is safe to re-run. Returns the shaped row."""
    username = (username or "").strip()
    if not username:
        return None
    if not get_employee(username):
        ts = now_iso()
        execute("INSERT INTO employees (username, created_at, updated_at, updated_by) "
                "VALUES (%s,%s,%s,%s) ON CONFLICT (username) DO NOTHING", (username, ts, ts, created_by))
    return update_employee(username, fields, created_by)


def delete_employee(username: str) -> bool:
    """Delete an employee record AND its payments ledger. The linked owners'-loan finance
    record (if any) is intentionally LEFT in Finance — it's a recorded money fact the owners
    manage there, not deleted implicitly with the employee."""
    execute("DELETE FROM employee_payments WHERE username = %s", (username,))
    execute("DELETE FROM employees WHERE username = %s", (username,))
    return True


# ── Employee payments ledger (records only — owner approval, NO real money movement) ──
def _employee_payment_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"id": int(r["id"]), "username": r.get("username"), "type": r.get("type") or "salary",
            "amount": _fnum(r.get("amount")), "currency": r.get("currency") or "USD",
            "date": r.get("pay_date") or "", "status": r.get("status") or "pending",
            "note": r.get("note") or "", "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}


def list_employee_payments(username: "Optional[str]" = None) -> "list[dict[str, Any]]":
    if username:
        rows = fetch_all("SELECT * FROM employee_payments WHERE username = %s ORDER BY pay_date DESC, id DESC", (username,))
    else:
        rows = fetch_all("SELECT * FROM employee_payments ORDER BY pay_date DESC, id DESC")
    return [_employee_payment_json(r) for r in rows]


def add_employee_payment(fields: "dict[str, Any]", created_by: str) -> "dict[str, Any]":
    typ = str(fields.get("type") or "salary")
    if typ not in EMPLOYEE_PAYMENT_TYPES:
        typ = "salary"
    status = str(fields.get("status") or "pending")
    if status not in EMPLOYEE_PAYMENT_STATUSES:
        status = "pending"
    ts = now_iso()
    r = fetch_one(
        "INSERT INTO employee_payments (username,type,amount,currency,pay_date,status,note,created_at,updated_at,updated_by) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
        (str(fields.get("username") or ""), typ, _fnum(fields.get("amount")), str(fields.get("currency") or "USD"),
         str(fields.get("date") or ""), status, str(fields.get("note") or ""), ts, ts, created_by))
    return _employee_payment_json(r)


_EMP_PAY_COL = {"type": "type", "amount": "amount", "currency": "currency", "date": "pay_date",
                "status": "status", "note": "note", "username": "username"}


def update_employee_payment(row_id: int, fields: "dict[str, Any]", updated_by: str) -> "Optional[dict[str, Any]]":
    sets: List[str] = []
    params: List[Any] = []
    for k, v in (fields or {}).items():
        if k not in _EMP_PAY_COL:
            continue
        if k == "type" and v not in EMPLOYEE_PAYMENT_TYPES:
            continue
        if k == "status" and v not in EMPLOYEE_PAYMENT_STATUSES:
            continue
        v = _fnum(v) if k == "amount" else ("" if v is None else str(v))
        sets.append(f"{_EMP_PAY_COL[k]} = %s"); params.append(v)
    if not sets:
        r = fetch_one("SELECT * FROM employee_payments WHERE id = %s", (row_id,))
        return _employee_payment_json(r) if r else None
    sets += ["updated_at = %s", "updated_by = %s"]; params += [now_iso(), updated_by]
    params.append(row_id)
    r = fetch_one(f"UPDATE employee_payments SET {', '.join(sets)} WHERE id = %s RETURNING *", tuple(params))
    return _employee_payment_json(r) if r else None


def delete_employee_payment(row_id: int) -> bool:
    return _fin_delete("employee_payments", row_id)


def employee_payment_summary(username: str) -> "dict[str, Any]":
    """Small per-employee rollup for the card: total paid, total pending, and count."""
    rows = list_employee_payments(username)
    paid = round(sum(p["amount"] for p in rows if p["status"] == "paid"), 2)
    pending = round(sum(p["amount"] for p in rows if p["status"] == "pending"), 2)
    return {"count": len(rows), "paid": paid, "pending": pending}


def set_employee_deposit(username: str, amount: float, investment_id: "Optional[int]", updated_by: str) -> "Optional[dict[str, Any]]":
    """Link an employee to their recorded owners'-loan deposit: store the amount + the
    finance_investments row id (BIGINT). Used by the program deposit endpoint (Phase 3)."""
    execute("UPDATE employees SET initial_deposit = %s, deposit_investment_id = %s, updated_at = %s, updated_by = %s WHERE username = %s",
            (_fnum(amount), int(investment_id) if investment_id else None, now_iso(), updated_by, username))
    return get_employee(username)


def bonus_program_summary(username: str) -> "dict[str, Any]":
    """Derived figures for the bonus / sub-account trading program (records & tracking only):
      • bonusAccrued = Σ of the employee's 'bonus' ledger entries (monthly accruals).
      • initialDeposit = the owners'-loan seed the owner recorded.
      • capital = initialDeposit + bonusAccrued — the growing 'larger capital for launch'.
      • tradingPnl = the manual owner-entered profit figure; totalValue = capital + P&L.
    Bonus accrual is DERIVED from the ledger (single source), never stored separately."""
    emp = get_employee(username) or {}
    pays = list_employee_payments(username)
    bonus_history = [p for p in pays if p.get("type") == "bonus"]
    accrued = round(sum(p["amount"] for p in bonus_history), 2)
    initial = _fnum(emp.get("initialDeposit"))
    pnl = _fnum(emp.get("tradingPnl"))
    capital = round(initial + accrued, 2)
    return {
        "status": emp.get("bonusProgramStatus") or "none",
        "initialDeposit": round(initial, 2), "bonusAccrued": accrued,
        "capital": capital, "tradingPnl": round(pnl, 2), "totalValue": round(capital + pnl, 2),
        "bonusHistory": bonus_history, "depositInvestmentId": emp.get("depositInvestmentId"),
    }


# ── Bonus-program DEFINITION — owner-editable, bilingual presentation content ─────
# The read-only "how the program works" story shown to employees (join screen) and previewed
# by owners. Stored as ONE config singleton (JSONB) — no table needed. A sensible HE+EN default
# describes the real mechanics: owners' initial deposit as a loan → trade in a dedicated
# sub-account → the profit is the employee's → a monthly bonus accrues and grows the capital.
_BONUS_PROGRAM_DEF_KEY = "bonus_program_definition"
_BONUS_DEF_TEXT_FIELDS = ("titleHe", "titleEn", "introHe", "introEn",
                          "benefitHe", "benefitEn", "termsHe", "termsEn")


def _default_bonus_program_def() -> "dict[str, Any]":
    """The seeded default program definition (bilingual) — real mechanics, editable by owners."""
    return {
        "titleHe": "תוכנית הבונוס",
        "titleEn": "The Bonus Program",
        "introHe": "דרך לצבור הון ובונוסים חודשיים דרך תת-חשבון מסחר אישי: הבעלים מזרימים הון "
                   "התחלתי כהלוואת בעלים, אתה סוחר עם המנוע והכלים של המערכת, והרווח שנוצר שייך לך. "
                   "במקביל נצבר בונוס חודשי שמגדיל את ההון שלך לקראת ההשקה.",
        "introEn": "A way to build capital and earn monthly bonuses through a personal trading "
                   "sub-account: the owners seed it with starting capital as an owners' loan, you "
                   "trade with the platform's engine and tools, and the profit you generate is "
                   "yours. Alongside it, a monthly bonus accrues and grows your capital toward launch.",
        "steps": [
            {"icon": "TrendingUp",
             "titleHe": "הון התחלתי מהבעלים (הלוואה)",
             "titleEn": "Owners seed the capital (a loan)",
             "bodyHe": "הבעלים מפקידים הון התחלתי לתת-חשבון הייעודי שלך — נרשם כהלוואת בעלים.",
             "bodyEn": "The owners deposit starting capital into your dedicated sub-account — recorded as an owners' loan."},
            {"icon": "KeyRound",
             "titleHe": "מסחר בתת-חשבון ייעודי",
             "titleEn": "Trade in a dedicated sub-account",
             "bodyHe": "אתה מנהל את המסחר בתת-החשבון — עם המנוע, הבוטים והכלים של המערכת.",
             "bodyEn": "You run the trading in the sub-account — with the platform's engine, bots and tools."},
            {"icon": "Sparkles",
             "titleHe": "הרווח שייך לך",
             "titleEn": "The profit is yours",
             "bodyHe": "הרווח שנוצר מהמסחר שייך לך — הוא לא מוחזר לבעלים.",
             "bodyEn": "The profit generated from the trading belongs to you — it is not returned to the owners."},
            {"icon": "Coins",
             "titleHe": "בונוס חודשי שמגדיל את ההון",
             "titleEn": "A monthly bonus grows your capital",
             "bodyHe": "מדי חודש נצבר בונוס שנוסף להון — כך ההון גדל בהתמדה לצד רווחי המסחר.",
             "bodyEn": "Each month a bonus accrues and adds to the capital — so it grows steadily alongside your trading profits."},
        ],
        "benefitHe": "ככל שהתוכנית מתקדמת ההון גדל: הלוואת הבעלים והבונוסים החודשיים בונים הון "
                     "משמעותי לקראת ההשקה — בזמן שהרווח מהמסחר נשאר שלך.",
        "benefitEn": "As the program progresses your capital grows: the owners' loan plus the "
                     "monthly bonuses build meaningful capital toward launch — while the trading "
                     "profit stays yours.",
        "termsHe": "רישום ומעקב בלבד — אין העברת כספים מהאפליקציה. ההצטרפות: מגדירים תת-חשבון "
                   "ושולחים כתובת ארנק לבעלים; המימון בפועל מתואם ידנית מול הבורסה. הלוואת הבעלים "
                   "מוחזרת בתיאום; הבונוס החודשי כפוף להמשך העסקה ולשיקול הבעלים.",
        "termsEn": "Records & tracking only — no money moves from the app. To join: set up a "
                   "sub-account and send a wallet address to the owners; actual funding is "
                   "coordinated manually on the exchange. The owners' loan is repaid by "
                   "arrangement; the monthly bonus is subject to continued engagement and owner discretion.",
    }


def get_bonus_program_def() -> "dict[str, Any]":
    """The owner-editable bonus-program presentation (bilingual). Falls back to the seeded
    default; a stored override is merged ONTO the default so fields added later still render."""
    base = _default_bonus_program_def()
    val = _get_singleton(_BONUS_PROGRAM_DEF_KEY, None)
    if isinstance(val, dict):
        for k, v in val.items():
            if v is not None:
                base[k] = v
    return base


def set_bonus_program_def(data: "dict[str, Any]", updated_by: str) -> "dict[str, Any]":
    """Owner save of the program definition. Validates/normalises text fields + the steps list,
    stamps updatedAt/By, and persists as the config singleton. Returns the stored definition."""
    d = get_bonus_program_def()
    for k in _BONUS_DEF_TEXT_FIELDS:
        if data.get(k) is not None:
            d[k] = str(data[k])[:6000]
    if isinstance(data.get("steps"), list):
        steps = []
        for s in data["steps"][:8]:
            if not isinstance(s, dict):
                continue
            steps.append({
                "icon": str(s.get("icon") or "Sparkles")[:40],
                "titleHe": str(s.get("titleHe") or "")[:200], "titleEn": str(s.get("titleEn") or "")[:200],
                "bodyHe": str(s.get("bodyHe") or "")[:1000], "bodyEn": str(s.get("bodyEn") or "")[:1000],
            })
        d["steps"] = steps
    d["updatedAt"] = now_iso()
    d["updatedBy"] = updated_by
    _set_singleton(_BONUS_PROGRAM_DEF_KEY, d)
    return d


# ── HOME GUIDE · animated mascot overlay config (Yoav's reels) ────────────────────
# ONE owner/admin-editable config singleton drives the Home guide: master on/off, the
# first-visit auto-offer, the character size, the pose→asset map, and the ordered STEPS
# (each with bilingual caption, gesture, audio url + fallback duration, enable flag,
# anchor). Non-devs edit it live from the Guide manager — no deploy. Uploaded voice/pose
# overrides are separate binary rows (guide_assets, served from /auth/guide/asset/<key>);
# the config only carries URL strings, so this row stays tiny and every Home load is cheap.
_GUIDE_CONFIG_KEY = "home_guide_config"
_GUIDE_MEDIA = "/media/guide"
# The 7 character poses (stack at 0,0, 460×680) — talk base + mouth/eye overlays + gestures.
_GUIDE_POSE_KEYS = ("talk", "mouthAh", "mouthOo", "blink", "point", "wave", "cheer")
_GUIDE_POSE_FILES = {
    "talk": "talk.png", "mouthAh": "mouth-ah.png", "mouthOo": "mouth-oo.png",
    "blink": "blink.png", "point": "point.png", "wave": "wave.png", "cheer": "cheer.png",
}
_GUIDE_GESTURES = ("wave", "point", "cheer", "talk")
# The Home sections a step can spotlight (the data-guide anchors on the Navy home).
_GUIDE_ANCHORS = ("ticker", "tools", "engine", "signal", "portfolio", "bottom")
_GUIDE_MAX_STEPS = 24


def _default_guide_config() -> "dict[str, Any]":
    """The seeded default guide — mirrors Yoav's reference reel exactly: 8 steps, wave intro →
    six anchored 'point' beats → cheer outro, ElevenLabs (Liam) English voice per line. HE
    captions are translated for the text bubble; a HE voice set can be uploaded later per step
    (audioHe), until then the EN mp3 plays under either language."""
    poses = {k: f"{_GUIDE_MEDIA}/character/{_GUIDE_POSE_FILES[k]}" for k in _GUIDE_POSE_KEYS}
    steps = [
        {"id": "intro", "anchor": None, "gesture": "wave", "dur": 30.6,
         "audio": f"{_GUIDE_MEDIA}/voice/line-1.mp3", "audioHe": None,
         "captionEn": "Hey — welcome to StrateTeach! I'm your guide, and yes, I'm a talking diamond "
                      "in a graduation cap. Here's the big idea: StrateTeach puts algorithmic trading "
                      "to work for you — no emotion, no FOMO, just disciplined, data-driven trading, "
                      "tested on years of history and running around the clock, always under your "
                      "control. Automate your strategy, connect your own signals, practice with zero "
                      "risk, and learn as you go. Alright — let's take a look at your home screen.",
         "captionHe": "היי — ברוכים הבאים ל-StrateTeach! אני המדריך שלכם, וכן, אני יהלום מדבר עם כובע "
                      "סיום. הרעיון הגדול: StrateTeach מפעיל בשבילכם מסחר אלגוריתמי — בלי רגש, בלי FOMO, "
                      "רק מסחר ממושמע מבוסס-נתונים, נבדק על שנים של היסטוריה ורץ מסביב לשעון, תמיד בשליטתכם. "
                      "הפעילו אסטרטגיה, חברו סיגנלים משלכם, תרגלו בלי סיכון ותלמדו תוך כדי. קדימה — בואו נסתכל "
                      "על מסך הבית שלכם."},
        {"id": "ticker", "anchor": "ticker", "gesture": "point", "dur": 10.6,
         "audio": f"{_GUIDE_MEDIA}/voice/line-2.mp3", "audioHe": None,
         "captionEn": "Up top: the market, live. Crypto, stocks, gold, oil — streaming in real time. "
                      "Blink and the prices change... so don't blink.",
         "captionHe": "למעלה: השוק, בשידור חי. קריפטו, מניות, זהב, נפט — זורמים בזמן אמת. תמצמצו והמחירים "
                      "כבר השתנו... אז אל תמצמצו."},
        {"id": "tools", "anchor": "tools", "gesture": "point", "dur": 12.0,
         "audio": f"{_GUIDE_MEDIA}/voice/line-3.mp3", "audioHe": None,
         "captionEn": "These are your tools. Daily Scan sniffs out today's setups, Backtest proves a "
                      "strategy on years of data, Strategy lets you build your own, and Learn — that's "
                      "where I really shine.",
         "captionHe": "אלה הכלים שלכם. הסריקה היומית מאתרת את ההזדמנויות של היום, הבדיקות מוכיחות "
                      "אסטרטגיה על שנים של נתונים, האסטרטגיות נותנות לכם לבנות משלכם, והלמידה — שם אני "
                      "באמת זורח."},
        {"id": "engine", "anchor": "engine", "gesture": "point", "dur": 10.0,
         "audio": f"{_GUIDE_MEDIA}/voice/line-4.mp3", "audioHe": None,
         "captionEn": "But THIS — the Trading Engine — is the main event. Tap it and your trading goes "
                      "on autopilot. You set the rules; it does the heavy lifting. Mic drop.",
         "captionHe": "אבל זה — מנוע המסחר — הוא האירוע המרכזי. הקישו עליו והמסחר שלכם עובר לטייס אוטומטי. "
                      "אתם קובעים את הכללים; הוא עושה את העבודה הקשה."},
        {"id": "signal", "anchor": "signal", "gesture": "point", "dur": 8.9,
         "audio": f"{_GUIDE_MEDIA}/voice/line-5.mp3", "audioHe": None,
         "captionEn": "Got TradingView? Wire it to the Signal Bot and your signals fire trades "
                      "automatically — like a co-pilot who never sleeps and never asks for coffee.",
         "captionHe": "יש לכם TradingView? חברו אותו לסיגנל בוט והסיגנלים שלכם יבצעו עסקאות אוטומטית — "
                      "כמו טייס משנה שלא ישן ולא מבקש קפה."},
        {"id": "portfolio", "anchor": "portfolio", "gesture": "point", "dur": 13.9,
         "audio": f"{_GUIDE_MEDIA}/voice/line-6.mp3", "audioHe": None,
         "captionEn": "Here's your Portfolio. Flip that Demo switch and practice with pretend money — "
                      "zero risk, all the fun. Ready for the real thing? Slide to Live. Baby steps... "
                      "or diamond steps.",
         "captionHe": "הנה התיק שלכם. העבירו למצב דמו ותרגלו עם כסף מדומה — אפס סיכון, כל הכיף. מוכנים "
                      "לאמת? החליקו ל-לייב. צעד-צעד... או צעד-יהלום."},
        {"id": "bottom", "anchor": "bottom", "gesture": "point", "dur": 10.2,
         "audio": f"{_GUIDE_MEDIA}/voice/line-7.mp3", "audioHe": None,
         "captionEn": "Lost? Never. Down here: Learn for the lessons, Reels for quick clips like this "
                      "one, and the Help Portal if you ever get stuck. I've got you.",
         "captionHe": "אבודים? לעולם לא. כאן למטה: למידה לשיעורים, רילים לקליפים קצרים כמו זה, ופורטל "
                      "העזרה אם נתקעתם. אני איתכם."},
        {"id": "outro", "anchor": None, "gesture": "cheer", "dur": 9.6,
         "audio": f"{_GUIDE_MEDIA}/voice/line-8.mp3", "audioHe": None,
         "captionEn": "That's your home base — mission control. Now go make some moves. I'll be right "
                      "here... sparkling. Let's trade!",
         "captionHe": "זה בסיס הבית שלכם — חדר הבקרה. עכשיו לכו לעשות מהלכים. אני אהיה כאן... נוצץ. בואו "
                      "נסחר!"},
    ]
    for s in steps:
        s["enabled"] = True
    return {
        "enabled": True,
        "autoOfferFirstVisit": True,
        "characterScale": 1.0,
        "poses": poses,
        "steps": steps,
        "updatedAt": None,
        "updatedBy": None,
    }


def get_guide_config() -> "dict[str, Any]":
    """The resolved Home-guide config. A stored override is merged ONTO the shipped default so
    top-level fields added later still render; `steps`/`poses` are taken wholesale from a stored
    override when present (they carry their own edits). Read by every logged-in user on Home."""
    base = _default_guide_config()
    val = _get_singleton(_GUIDE_CONFIG_KEY, None)
    if isinstance(val, dict):
        for k, v in val.items():
            if v is not None:
                base[k] = v
    return base


def _clean_guide_step(s: "dict[str, Any]", idx: int) -> "dict[str, Any]":
    """Whitelist ONE step's shape: bilingual caption + gesture + anchor + audio + duration +
    enable flag. Unknown gestures/anchors fall back to safe values; strings are length-bounded."""
    gesture = str(s.get("gesture") or "point")
    if gesture not in _GUIDE_GESTURES:
        gesture = "point"
    anchor = s.get("anchor")
    if anchor is not None:
        anchor = str(anchor)
        if anchor not in _GUIDE_ANCHORS:
            anchor = None
    def _url(v):
        if v is None:
            return None
        v = str(v)[:400]
        return v or None
    try:
        dur = float(s.get("dur") or 10.0)
    except (TypeError, ValueError):
        dur = 10.0
    dur = max(1.0, min(120.0, dur))
    return {
        "id": str(s.get("id") or f"step-{idx}")[:40],
        "anchor": anchor,
        "gesture": gesture,
        "dur": round(dur, 2),
        "audio": _url(s.get("audio")),
        "audioHe": _url(s.get("audioHe")),
        "captionEn": str(s.get("captionEn") or "")[:2000],
        "captionHe": str(s.get("captionHe") or "")[:2000],
        "enabled": bool(s.get("enabled", True)),
    }


def set_guide_config(data: "dict[str, Any]", updated_by: str) -> "dict[str, Any]":
    """Owner/admin save of the guide config. Validates/normalises every field, stamps
    updatedAt/By, persists as the config singleton. Returns the stored (resolved) config."""
    d = get_guide_config()
    if "enabled" in data:
        d["enabled"] = bool(data.get("enabled"))
    if "autoOfferFirstVisit" in data:
        d["autoOfferFirstVisit"] = bool(data.get("autoOfferFirstVisit"))
    if data.get("characterScale") is not None:
        try:
            d["characterScale"] = max(0.4, min(2.0, float(data["characterScale"])))
        except (TypeError, ValueError):
            pass
    if isinstance(data.get("poses"), dict):
        poses = dict(d.get("poses") or {})
        for k in _GUIDE_POSE_KEYS:
            v = data["poses"].get(k)
            if v is not None:
                poses[k] = str(v)[:400]
        d["poses"] = poses
    if isinstance(data.get("steps"), list):
        d["steps"] = [_clean_guide_step(s, i) for i, s in enumerate(data["steps"][:_GUIDE_MAX_STEPS]) if isinstance(s, dict)]
    d["updatedAt"] = now_iso()
    d["updatedBy"] = updated_by
    _set_singleton(_GUIDE_CONFIG_KEY, d)
    return d


def upsert_guide_asset(key: str, mime: str, data: bytes, updated_by: str) -> None:
    """Store (or replace) ONE uploaded guide asset (a voice mp3 or a pose png) as bytes."""
    execute(
        "INSERT INTO guide_assets (key, mime, data, updated_by, updated_at) VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, "
        "updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at",
        (key, mime, psycopg.Binary(data), updated_by, now_iso()),
    )


def get_guide_asset(key: str) -> "dict[str, Any] | None":
    """Fetch ONE uploaded guide asset ({mime, data bytes}) or None if the slot has no override."""
    with get_conn() as conn:
        row = conn.execute("SELECT mime, data FROM guide_assets WHERE key = %s", (key,)).fetchone()
    if not row:
        return None
    raw = row["data"]
    return {"mime": row["mime"], "data": bytes(raw) if raw is not None else b""}


def delete_guide_asset(key: str) -> None:
    """Remove ONE uploaded guide asset so its slot falls back to the shipped static default."""
    execute("DELETE FROM guide_assets WHERE key = %s", (key,))


def list_guide_asset_keys() -> "list[str]":
    """The slot ids that currently have an uploaded override (so the manager can show a badge)."""
    with get_conn() as conn:
        rows = conn.execute("SELECT key FROM guide_assets ORDER BY key").fetchall()
    return [r["key"] for r in rows]


# ── REVIEW SUBMISSIONS (Phase 2 multi-user Review Mode → Dan's mini-portal) ───────
_REVIEW_MAX_FILES_PER_NOTE = 10
_REVIEW_MAX_TOTAL_BYTES = 12 * 1024 * 1024   # ~12 MB decoded per submission (hard safety cap)


def _parse_data_url(s: str) -> "tuple[str, bytes] | None":
    """Parse a `data:<mime>;base64,<payload>` URL into (mime, bytes). Returns None on anything else
    (already-a-token, http url, malformed) so those files are simply skipped."""
    try:
        if not isinstance(s, str) or not s.startswith("data:") or ";base64," not in s:
            return None
        head, b64 = s.split(",", 1)
        mime = head[5:].split(";", 1)[0] or "image/jpeg"
        import base64 as _b64
        return mime[:60], _b64.b64decode(b64)
    except Exception:
        return None


def add_review_submission(from_user: str, from_name: str, notes: "list", prompt_text: str) -> "dict[str, Any]":
    """Store ONE reviewer's submitted Review-Mode notes as a submission. Each note is
    {screen, route, text, code, ts, files:[data-URL…]}. Attached files (already downscaled client-
    side) are decoded to BYTEA rows keyed by an unguessable token; the note's `files` is rewritten
    to the list of TOKENS so the board list stays light. A total-size cap trims extra files. The
    per-task `truncated` flag is set when its files were dropped for the cap. Returns the row."""
    ts = now_iso()
    safe_notes: list = []
    pending: list = []          # (token, mime, bytes)
    total = 0
    if isinstance(notes, list):
        for n in notes[:500]:
            if not isinstance(n, dict):
                continue
            tokens: list[str] = []
            truncated = False
            for f in (n.get("files") or [])[:_REVIEW_MAX_FILES_PER_NOTE]:
                parsed = _parse_data_url(f)
                if not parsed:
                    continue
                mime, data = parsed
                if total + len(data) > _REVIEW_MAX_TOTAL_BYTES:
                    truncated = True
                    break
                total += len(data)
                tok = secrets.token_urlsafe(12)
                tokens.append(tok)
                pending.append((tok, mime, data))
            safe_notes.append({
                "screen": str(n.get("screen") or "")[:120],
                "route": str(n.get("route") or "")[:200],
                "text": str(n.get("text") or "")[:4000],
                "code": str(n.get("code") or "")[:12],
                "ts": str(n.get("ts") or ts)[:40],
                "files": tokens,
                **({"truncated": True} if truncated else {}),
            })
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO review_submissions (from_user, from_name, notes, prompt_text, created_at) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id, from_user, from_name, notes, prompt_text, created_at",
            (from_user, (from_name or from_user)[:120], Json(safe_notes), str(prompt_text or "")[:60000], ts),
        ).fetchone()
        sub_id = row["id"]
        for tok, mime, data in pending:
            conn.execute(
                "INSERT INTO review_files (token, submission_id, mime, data, created_at) VALUES (%s, %s, %s, %s, %s)",
                (tok, sub_id, mime, psycopg.Binary(data), ts),
            )
    return dict(row)


def get_review_file(token: str) -> "dict[str, Any] | None":
    """Fetch one attached review file ({mime, data bytes}) by its token, or None."""
    with get_conn() as conn:
        r = conn.execute("SELECT mime, data FROM review_files WHERE token = %s", (token,)).fetchone()
    if not r:
        return None
    raw = r["data"]
    return {"mime": r["mime"], "data": bytes(raw) if raw is not None else b""}


def list_review_submissions() -> "list[dict[str, Any]]":
    """All submissions, newest first (for the mini-portal board)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, from_user, from_name, notes, prompt_text, created_at "
            "FROM review_submissions ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def delete_review_submission(sub_id: int) -> None:
    """Remove one submission from the board, plus its attached files."""
    execute("DELETE FROM review_files WHERE submission_id = %s", (int(sub_id),))
    execute("DELETE FROM review_submissions WHERE id = %s", (int(sub_id),))


def review_submissions_in_range(dt_from: str | None, dt_to: str | None) -> "list[dict[str, Any]]":
    """Submissions whose created_at (ISO string) falls within [dt_from, dt_to]. Empty bounds are
    treated as open-ended. ISO strings sort lexicographically, so string comparison is correct."""
    clauses, params = [], []
    if dt_from:
        clauses.append("created_at >= %s"); params.append(str(dt_from))
    if dt_to:
        # inclusive end-of-day when a bare date is given
        end = str(dt_to)
        if len(end) <= 10:
            end = end + "T23:59:59.999999"
        clauses.append("created_at <= %s"); params.append(end)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, from_user, from_name, notes, prompt_text, created_at "
            f"FROM review_submissions{where} ORDER BY created_at ASC, id ASC", tuple(params)
        ).fetchall()
    return [dict(r) for r in rows]


# ── Review snapshots · per-reviewer named checkpoints of the working prompt ────────────────
def add_review_snapshot(owner_user: str, name: str, content: str) -> "dict[str, Any]":
    """Save ONE named checkpoint of the caller's working prompt/task-set. Returns the row."""
    ts = now_iso()
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO review_snapshots (owner_user, name, content, created_at) "
            "VALUES (%s, %s, %s, %s) RETURNING id, owner_user, name, content, created_at",
            (owner_user, str(name or "")[:120], str(content or "")[:200000], ts),
        ).fetchone()
    return dict(row)


def list_review_snapshots(owner_user: str) -> "list[dict[str, Any]]":
    """The caller's saved snapshots, newest first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, owner_user, name, content, created_at FROM review_snapshots "
            "WHERE owner_user = %s ORDER BY created_at DESC, id DESC",
            (owner_user,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_review_snapshot(owner_user: str, snap_id: int) -> None:
    """Delete one of the caller's own snapshots (owner-scoped — can't touch anyone else's)."""
    execute("DELETE FROM review_snapshots WHERE id = %s AND owner_user = %s", (int(snap_id), owner_user))


# Seed the known team members as employees (idempotent — never clobbers an owner's edits).
# raful is seeded as the business-development manager on a $200 monthly salary paid to his
# BONUS account, per Dan. Names/roles are starter values — refined together in-app.
# Dan's FINAL roster — exactly these 6. (daniel/tzahi/tom removed; see _normalize_employee_roster.)
_EMPLOYEE_SEED = [
    # (username, role,                 work_domains,             status,   salary, bonus)
    ("admin",  "בעלים",               "management,product",     "active",   0,   False),  # Dan (founder)
    ("rafi",   "בעלים",               "finance,investment",     "active",   0,   False),
    ("yoav",   "בעלים",               "creative,reels,courses", "active",   0,   False),
    ("oren",   "מנהל IT",             "development,infra",      "active",   0,   False),
    ("raz",    "מנהל משפטית",         "legal",                  "active",   0,   False),
    ("raful",  "מנהל פיתוח עסקי",     "business_dev",           "active",  200,  True),
]


def _seed_employees() -> None:
    ts = now_iso()
    for uname, role, domains, status, salary, bonus in _EMPLOYEE_SEED:
        execute(
            "INSERT INTO employees (username, role, work_domains, status, monthly_salary, "
            "bonus_account_flag, created_at, updated_at, updated_by) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'seed') ON CONFLICT (username) DO NOTHING",
            (uname, role, domains, status, salary, bool(bonus), ts, ts))


# One-time roster correction to Dan's final 6 (guarded by a singleton so it runs ONCE — later
# owner edits to these roles, or a legitimately re-added tzahi/tom, are NOT clobbered on reboot).
_ROSTER_ROLES = {"admin": "בעלים", "rafi": "בעלים", "yoav": "בעלים",
                 "oren": "מנהל IT", "raz": "מנהל משפטית", "raful": "מנהל פיתוח עסקי"}


def _normalize_employee_roster() -> None:
    if _get_singleton("employee_roster_v1", None):
        return
    # Remove exactly these 3 (rows + their ledger). Guarded set — never touches anyone else.
    for u in ("daniel", "tzahi", "tom"):
        execute("DELETE FROM employee_payments WHERE username = %s", (u,))
        execute("DELETE FROM employees WHERE username = %s", (u,))
    # Normalize the 6 roles on the EXISTING rows (the idempotent seed won't clobber them). Salary
    # / bonus / other fields are left as-is — so raful's $200 → bonus stays intact.
    for u, role in _ROSTER_ROLES.items():
        execute("UPDATE employees SET role = %s WHERE username = %s", (role, u))
    _set_singleton("employee_roster_v1", "done")


def list_pm_goals() -> "list[dict[str, Any]]":
    rows = fetch_all("SELECT partner, goal_he, goal_en, updated_at, updated_by FROM pm_goals")
    return [{"partner": r["partner"], "goalHe": r.get("goal_he") or "", "goalEn": r.get("goal_en") or "",
             "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")} for r in rows]


def get_pm_goal(partner: str) -> "Optional[dict[str, Any]]":
    r = fetch_one("SELECT partner, goal_he, goal_en, updated_at, updated_by FROM pm_goals WHERE partner = %s", (partner,))
    if not r:
        return None
    return {"partner": r["partner"], "goalHe": r.get("goal_he") or "", "goalEn": r.get("goal_en") or "",
            "updatedAt": r.get("updated_at"), "updatedBy": r.get("updated_by")}


def set_pm_goal(partner: str, goal_he: str, goal_en: str, *, updated_by: str) -> "dict[str, Any]":
    ts = now_iso()
    fetch_one(
        "INSERT INTO pm_goals (partner, goal_he, goal_en, updated_at, updated_by) "
        "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (partner) DO UPDATE SET goal_he = EXCLUDED.goal_he, "
        "goal_en = EXCLUDED.goal_en, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by RETURNING partner",
        (partner, goal_he or "", goal_en or "", ts, updated_by),
    )
    return get_pm_goal(partner)


# ── Owners Portal · VOTING (Phase 3) ─────────────────────────────────────────
# Screens/tasks are judged approve/change/reject; DECISIONS are a real multiple-choice pick
# (vote='option' + a `choice` option id). `abstain` is available on any item.
VOTE_CHOICES = ("approve", "change", "reject")   # screen/task ballot (kept for back-compat)
VOTE_BALLOT = ("approve", "change", "reject", "option", "abstain")
VOTE_ITEM_TYPES = ("screen", "decision", "task")


def _vote_json(r: "dict[str, Any]") -> "dict[str, Any]":
    return {"itemKey": r.get("item_key"), "itemType": r.get("item_type") or "screen",
            "voter": r.get("voter"), "vote": r.get("vote"), "choice": r.get("choice"),
            "comment": r.get("comment") or "", "updatedAt": r.get("updated_at") or r.get("created_at")}


def list_votes() -> "list[dict[str, Any]]":
    """Every cast vote (stable order), for the tallies + results rollups."""
    return [_vote_json(r) for r in fetch_all("SELECT * FROM votes ORDER BY item_key, voter")]


def upsert_vote(item_key: str, item_type: str, voter: str, vote: str, comment: str = "",
                choice: Optional[str] = None) -> "dict[str, Any]":
    """Cast or change a vote — one voice per (item, voter). Re-voting updates the row in
    place (ON CONFLICT). A DECISION pick is vote='option' with a `choice` option id; a
    screen/task judgement is approve/change/reject; `abstain` clears any pick."""
    if vote not in VOTE_BALLOT:
        raise ValueError("bad vote")
    ch = (choice or "").strip() or None
    if vote == "option" and not ch:
        raise ValueError("option vote requires a choice")
    if vote != "option":
        ch = None
    if item_type not in VOTE_ITEM_TYPES:
        item_type = "screen"
    ts = now_iso()
    r = fetch_one(
        "INSERT INTO votes (item_key, item_type, voter, vote, choice, comment, created_at, updated_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (item_key, voter) DO UPDATE SET "
        "item_type = EXCLUDED.item_type, vote = EXCLUDED.vote, choice = EXCLUDED.choice, "
        "comment = EXCLUDED.comment, updated_at = EXCLUDED.updated_at RETURNING *",
        (item_key, item_type, voter, vote, ch, comment or "", ts, ts),
    )
    return _vote_json(r)


def clear_vote(item_key: str, voter: str) -> bool:
    """Withdraw a voter's vote on an item (so a voter can retract, not just switch)."""
    execute("DELETE FROM votes WHERE item_key = %s AND voter = %s", (item_key, voter))
    return True


# ── Starter seed — a real task set from the roadmap, one headline goal per partner ──
# Idempotent: each task carries a stable `key` (ON CONFLICT DO NOTHING), the goals upsert
# only when absent. Assignee defaults to the partner id; owners can reassign to the real
# account username via an update. Statuses/percentages reflect the current honest state.
_PM_TASK_SEED = [
    # key, partner, phase, title_he, title_en, status, progress, impl_status
    ("launch_v1",    "dan",  "p3", "השקת גרסה 1 למכירה למשתמשים", "Launch v1 to users for sale",        "in_progress", 45, "in_progress"),
    ("payments",     "dan",  "p2", "תשלומים — מפתחות Stripe",       "Payments — Stripe keys",             "blocked",     30, "scaffolded"),
    ("company_reg",  "dan",  "p2", "רישום חברה",                    "Company registration",               "todo",        10, "not_started"),
    ("lift_maint",   "dan",  "p3", "הסרת שער התחזוקה",              "Lift the maintenance gate",          "blocked",     20, "blocked_external"),
    ("investment",   "rafi", "p2", "אבני דרך בהשקעה (מדורג)",        "Investment milestones (phased)",     "in_progress", 40, "in_progress"),
    ("content_lib",  "yoav", "p3", "ספריית תוכן — רילים וקורסים",   "Reels + Courses content library",    "in_progress", 30, "in_progress"),
    # ── Oren (technical / production-readiness — the AUDIT's open technical items) ──
    ("infra",        "oren", "p1", "תשתית מוכנה לפרודקשן",          "Production-ready infrastructure",     "in_progress", 70, "in_progress"),
    ("prod_readiness","oren","p1", "רשימת פערים למוכנות לפרודקשן",  "Production-readiness gap list",        "in_progress", 40, "in_progress"),
    ("deploy_infra", "oren", "p2", "פריסה/תשתית — reload של /legal ב-Caddy · חיווט משתני סביבה (Stripe/SendGrid/Twilio) · צנרת פריסה", "Deploy/infra — Caddyfile /legal reload on the VPS · wire prod env vars (Stripe/SendGrid/Twilio) · deploy pipeline", "in_progress", 35, "in_progress"),
    ("engine_ip",    "oren", "p1", "IP/מקוריות המנוע — המנוע המוטמע ופורט ה-PineScript", "Engine IP / provenance — vendored engine + PineScript port", "todo", 15, "not_started"),
    ("security_hardening","oren","p1","הקשחת אבטחה להשקה",         "Security hardening for launch",       "in_progress", 45, "in_progress"),
    ("scaling_launch","oren","p2", "סקיילינג/תשתית להשקה",          "Scaling / infra for launch",          "todo",        20, "not_started"),
    ("email_key",    "oren", "p2", "אימייל — מפתח SendGrid",        "Email — SendGrid key",               "blocked",     25, "scaffolded"),
    ("whatsapp_meta","oren", "p2", "WhatsApp פרודקשן — אישור Meta", "WhatsApp prod — Meta approval",      "blocked",     40, "in_review"),
    ("apple_iap",    "oren", "p3", "Apple IAP",                     "Apple IAP",                          "todo",         5, "not_started"),
    # ── Raz (legal / regulatory — the AUDIT's open legal items) ──
    ("legal_rights", "raz",  "p1", "רישום זכויות ופטנטים",          "Rights registration + patents",      "in_progress", 35, "in_review"),
    ("legal_texts",  "raz",  "p1", "השלמת הטקסטים המשפטיים בקונסולת המשפט (פרטיות כולל מפתחות מוצפנים · תנאי שימוש · הבהרות סיכון/סימולציה)", "Finalize the legal texts in the Legal Console (privacy incl. encrypted-keys disclosure · terms · risk + simulation disclaimers)", "in_progress", 30, "in_review"),
    ("legal_disclosures","raz","p1","גילויים ורגולציה ישראלית — אזהרות סיכון ועמלות לפני פעולות בכסף אמיתי", "Disclosures + Israeli regulation — risk warnings + fees before real-money actions", "todo", 15, "not_started"),
    ("legal_reg_posture","raz","p1","עמדה רגולטורית — מפתחות מסחר-בלבד בשרת (החלטה + גילוי)", "Regulatory posture — server-held trade-only keys (decide + disclose)", "todo", 10, "not_started"),
    ("legal_ip_review","raz","p1", "תנאי מקדים ל-IP של המנוע — סקירה משפטית של מקוריות/בעלות", "Engine/strategy IP precondition — legal review of provenance/ownership", "todo", 10, "not_started"),
    ("legal_data_licensing","raz","p2","רישוי נתונים",             "Data licensing",                      "todo",         5, "not_started"),
]
# Raz's legal DECISION tasks that gate the analytics/safety/data-rights build
# (Items 1a–1d of the analytics-&-safety plan). Unlike _PM_TASK_SEED these carry a
# `detail` — a short statement of the decision Raz must make — so the portal Tasks tab
# shows Raz exactly what to approve. Seeded (idempotent, ON CONFLICT DO NOTHING) beside
# the starter tasks; a separate loop is used only because these need the detail column.
# Raz's task DETAILS. A full bilingual DRAFT now sits in the app (lib/legalCopy.tsx,
# DRAFT-badged), so each task asks Raz to REVIEW & EDIT the draft and answer the open
# questions — not to write from scratch. Kept in a dict so the seed AND the one-time
# backfill (_backfill_legal_drafts) share the exact same text.
_PM_LEGAL_DRAFT_DETAIL = {
    "legal_entity_reg":
        "טיוטה מלאה מוכנה לעיון ולעריכה (Block A → REGULATORY_DISCLAIMER, מוצג בכותרת התחתונה "
        "ולפני פעולות בכסף). לאשר/לתקן: (1) שם הישות המשפטית הרשומה + מספר ח.פ.; (2) האם תכונות "
        "הסורק/הסיגנל/הטייס האוטומטי מחייבות רישוי לפי חוק הסדרת העיסוק בייעוץ השקעות, בשיווק "
        "השקעות ובניהול תיקי השקעות, התשנ״ה-1995, או נכנסות לפטור (מידע כללי לא-אישי / חינוכי / "
        "לקוחות כשירים) — במיוחד לאור טיוטת רשות ני״ע מינואר 2026 'הנחיה לבעלי רישיון… מתן שירות "
        "באמצעים טכנולוגיים' בנוגע למסחר אלגוריתמי וסיגנלים (הערות ציבור עד 4.2.2026); (3) לאשר "
        "שהמודל הלא-משמורתי (חשבון הבורסה של המשתמש, מפתחות למסחר-בלבד, ללא החזקת כספים) משאיר "
        "אותנו מחוץ לרישוי 'שירות בנכס פיננסי' לפי חוק הפיקוח על שירותים פיננסיים (שירותים "
        "פיננסיים מוסדרים), התשע״ו-2016; (4) להוסיף נוסח מחייב מצד רשות ני״ע/רשות שוק ההון. — "
        "EN: Full draft ready to review & edit (Block A). Confirm/adjust: (1) registered entity "
        "name + company number; (2) whether the scanner/signal/AutoPilot features trigger "
        "licensing under the 1995 Advice Law or fit an exemption (generic non-personalized / "
        "educational / qualified-clients), esp. given the ISA Jan-2026 draft directive on "
        "algorithmic & signal trading (comments were open to 4 Feb 2026); (3) that the "
        "non-custodial model keeps us outside 'financial asset service' licensing under the 2016 "
        "Regulated Financial Services Law; (4) add any ISA/CMA-mandated wording.",
    "legal_risk_disclosure_copy":
        "טיוטת גילוי סיכונים מלאה מוכנה לעיון ולעריכה (Block B → RISK_DISCLOSURE, מוצג לפני כל "
        "התחייבות). לאשר/להתאים את הנוסח; לאשר שהוא עומד בציפיות רשות ני״ע/רשות שוק ההון לגילוי "
        "סיכונים לפעילותנו. — EN: Full risk-disclosure draft ready to review & edit (Block B). "
        "Approve/adjust the wording; confirm it meets any ISA/CMA risk-disclosure expectations "
        "for our activity.",
    "legal_privacy_retention":
        "טיוטת מדיניות פרטיות מלאה + זכויות (תיקון 13) מוכנה לעיון ולעריכה (Block C → "
        "PRIVACY_POLICY + RETENTION_TEXT, מוצג ב'המידע שלי'). לאשר/להתאים: (1) תקופות שמירה — "
        "ברירות מחדל מוצעות: חשבון פעיל נשמר כל עוד פעיל; לאחר סגירה עד 12 חודשים אלא אם הדין "
        "מחייב יותר; אנליטיקס פסאודונימי עד ~14 חודשים; רשומות אבטחה/ביקורת ואיסור הלבנת הון "
        "לתקופה שבדין [לאשר מדויק]; מפתחות API נמחקים מיד עם ניתוק; (2) תמצית אמצעי האבטחה ופרטי "
        "הקשר; (3) האם תיקון 13 מחייב מינוי ממונה הגנת פרטיות (DPO) — רלוונטי כי אנו מעבדים מידע "
        "פיננסי = רגיש במיוחד; (4) האם חלה חובת רישום/הודעה על מאגר (ספים: שיווק ישיר/מאגר לציבור "
        "מעל 10,000; רגיש במיוחד מעל 100,000). — EN: Full privacy-policy + rights draft "
        "(Amendment 13) ready to review & edit (Block C). Confirm/adjust: (1) retention periods "
        "(suggested defaults: active-account kept while active; after closure up to 12 months "
        "unless law requires longer; pseudonymous analytics up to ~14 months; security/audit + "
        "AML records for the period required by law [confirm exact]; API keys deleted on "
        "disconnect); (2) the security-measures summary + data contact; (3) whether Amendment 13 "
        "requires a DPO (we process financial = especially-sensitive data); (4) whether database "
        "registration/notification applies (thresholds: direct-marketing/public DB >10,000; "
        "especially-sensitive >100,000).",
    "legal_analytics_consent_copy":
        "טיוטת נוסח הסכמה לאנליטיקס מוכנה לעיון ולעריכה (Block D → CONSENT_TITLE + CONSENT_BODY, "
        "מוצג במסך ההסכמה). לאשר שהנוסח עומד בסטנדרט ההסכמה של תיקון 13 — מפורשת, מפורטת "
        "(גרנולרית) ומתועדת. — EN: Analytics-consent draft ready to review & edit (Block D). "
        "Confirm the wording satisfies Amendment 13's explicit + granular + documented consent "
        "standard.",
}
_PM_LEGAL_DECISION_SEED = [
    # key, phase, title_he, title_en (detail comes from _PM_LEGAL_DRAFT_DETAIL[key])
    ("legal_entity_reg", "p1",
     "עיון ועריכת טיוטת זהות הישות והסטטוס הרגולטורי",
     "Review & edit the legal-entity + regulatory-status draft"),
    ("legal_risk_disclosure_copy", "p1",
     "עיון ועריכת טיוטת גילוי הסיכונים (עברית + אנגלית)",
     "Review & edit the risk-disclosure draft (HE + EN)"),
    ("legal_privacy_retention", "p1",
     "עיון ועריכת טיוטת הפרטיות + תקופות שמירה + מחיקה/ייצוא",
     "Review & edit the privacy + retention + deletion/export draft"),
    ("legal_analytics_consent_copy", "p1",
     "עיון ועריכת טיוטת נוסח ההסכמה לאנליטיקס",
     "Review & edit the analytics-consent draft"),
]
_PM_GOAL_SEED = {
    "dan":  ("להשיק את המוצר",                                "Launch the product"),
    "rafi": ("אבני דרך בהשקעה",                               "Investment milestones"),
    "yoav": ("ספריית תוכן — רילים וקורסים",                   "Reels + Courses content library"),
    "oren": ("תשתית מוכנה לפרודקשן",                          "Production-ready infrastructure"),
    "raz":  ("רישום זכויות ופטנטים תחילה; השלמת הטקסטים המשפטיים", "Rights registration + patents first; legal texts finalized"),
}


def _seed_pm() -> None:
    """Seed the starter PM tasks + per-partner goals if absent. Idempotent — never
    overwrites an owner's edits (tasks keyed by `key` ON CONFLICT DO NOTHING; goals upsert
    only-when-missing)."""
    ts = now_iso()
    for i, (key, partner, phase, th, te, status, prog, impl) in enumerate(_PM_TASK_SEED):
        execute(
            "INSERT INTO pm_tasks (key, title_he, title_en, assignee, partner, status, progress, "
            "notes, impl_status, phase, category, sort, created_at, updated_at, updated_by) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,'',%s,%s,%s,%s,%s,%s,'seed') ON CONFLICT (key) DO NOTHING",
            (key, th, te, partner, partner, status, int(prog), impl, phase, phase, i * 10, ts, ts),
        )
    base = len(_PM_TASK_SEED) * 10
    for j, (key, phase, th, te) in enumerate(_PM_LEGAL_DECISION_SEED):
        detail = _PM_LEGAL_DRAFT_DETAIL.get(key, "")
        execute(
            "INSERT INTO pm_tasks (key, title_he, title_en, assignee, partner, status, progress, "
            "notes, detail, impl_status, phase, category, priority, sort, created_at, updated_at, updated_by) "
            "VALUES (%s,%s,%s,'raz','raz','todo',0,'',%s,'not_started',%s,%s,'red',%s,%s,%s,'seed') "
            "ON CONFLICT (key) DO NOTHING",
            (key, th, te, detail, phase, phase, base + j * 10, ts, ts),
        )
    for partner, (gh, ge) in _PM_GOAL_SEED.items():
        execute(
            "INSERT INTO pm_goals (partner, goal_he, goal_en, updated_at, updated_by) "
            "VALUES (%s,%s,%s,%s,'seed') ON CONFLICT (partner) DO NOTHING",
            (partner, gh, ge, ts),
        )


def _backfill_legal_drafts() -> None:
    """One-time: on DBs where Raz's 4 legal tasks were already seeded with the old
    'write from scratch' text, rewrite their title + detail to the 'review & edit the
    DRAFT' text (the ON CONFLICT DO NOTHING seed can't update existing rows). Touches
    ONLY rows still authored by 'seed' AND still todo/0% — so if Raz already started
    editing (status/progress/notes or an owner re-authored it) we never clobber her work.
    Idempotent via a singleton flag."""
    if _get_singleton("legal_drafts_v1_done", False):
        return
    try:
        title = {k: (th, te) for k, phase, th, te in _PM_LEGAL_DECISION_SEED}
        for key, detail in _PM_LEGAL_DRAFT_DETAIL.items():
            th, te = title.get(key, (None, None))
            execute(
                "UPDATE pm_tasks SET detail = %s, title_he = COALESCE(%s, title_he), "
                "title_en = COALESCE(%s, title_en), updated_at = %s "
                "WHERE key = %s AND updated_by = 'seed' AND status = 'todo' AND progress = 0",
                (detail, th, te, now_iso(), key),
            )
    except Exception:  # noqa: BLE001 — best-effort; never block boot
        return
    _set_singleton("legal_drafts_v1_done", True)


def _backfill_pm_audit() -> None:
    """One-time: refine the seeded Raz goal to the AUDIT-grounded text on DBs where PM was
    already seeded before this change (the ON CONFLICT DO NOTHING seed can't update it).
    Touches ONLY a row still authored by 'seed' — never an owner's edit. The new audit TASK
    keys are added by _seed_pm on the same boot (DO NOTHING on the ones that already exist).
    Idempotent via a singleton flag."""
    if _get_singleton("pm_audit_v2_done", False):
        return
    try:
        gh, ge = _PM_GOAL_SEED["raz"]
        execute("UPDATE pm_goals SET goal_he = %s, goal_en = %s "
                "WHERE partner = 'raz' AND updated_by = 'seed'", (gh, ge))
    except Exception:  # noqa: BLE001 — best-effort; never block boot
        return
    _set_singleton("pm_audit_v2_done", True)


def set_user_bots_limit(username: str, limit: Optional[int]) -> dict[str, int]:
    """Admin per-user override for the Signal-Bots create cap, stored in the
    existing users.credits JSONB under "bots_limit". entitlements() reads this and
    uses it as the effective bots cap in place of the plan cap; passing None clears
    the override (reverts to the plan cap). Returns the updated credits dict."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(credits, '{}'::jsonb) AS credits FROM users WHERE username = %s FOR UPDATE",
            (username,),
        ).fetchone()
        credits = {k: int(v) for k, v in ((row or {}).get("credits") or {}).items()}
        if limit is None:
            credits.pop("bots_limit", None)
        else:
            credits["bots_limit"] = max(0, int(limit))
        conn.execute("UPDATE users SET credits = %s WHERE username = %s", (Json(credits), username))
    return credits


_BOT_UPDATE_FIELDS = {
    "label", "status", "exchange", "market", "sub_account", "max_quote", "max_open",
    "size_mode", "size_pct",
    "enc_key", "enc_secret", "enc_passphrase",
}


def update_bot(bot_id: int, fields: dict[str, Any], username: Optional[str] = None) -> Optional[dict[str, Any]]:
    """Update only whitelisted columns; scoped to ``username`` (owner) when given.
    Returns the RAW updated row (caller masks)."""
    cols = [(k, v) for k, v in (fields or {}).items() if k in _BOT_UPDATE_FIELDS]
    if not cols:
        return get_bot(bot_id)
    set_sql = ", ".join(f"{k} = %s" for k, _ in cols)
    params: list[Any] = [v for _, v in cols] + [bot_id]
    sql = f"UPDATE bots SET {set_sql} WHERE id = %s"
    if username is not None:
        sql += " AND username = %s"
        params.append(username)
    sql += " RETURNING *"
    return fetch_one(sql, tuple(params))


def delete_bot(bot_id: int, username: str) -> bool:
    """Delete a bot — owner-scoped. Returns True if a row was removed."""
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM bots WHERE id = %s AND username = %s", (bot_id, username))
        try:
            return (cur.rowcount or 0) > 0
        except Exception:  # noqa: BLE001
            return False


def _bot_creds(bot: dict[str, Any]) -> dict[str, Any]:
    """Build a place_order-compatible config from a bot row — the SAME encrypted
    shape as get_exchange_config(). Credentials stay ciphertext here; place_order's
    _decrypt_config decrypts them just-in-time. NEVER log or return this dict."""
    return {
        "exchange": (bot.get("exchange") or "binance"),
        "environment": "live",  # Signal Bots place REAL orders
        "subAccount": (bot.get("sub_account") or ""),
        "apiKeyEnc": (bot.get("enc_key") or ""),
        "apiSecretEnc": (bot.get("enc_secret") or ""),
        "apiPassphraseEnc": (bot.get("enc_passphrase") or ""),
        "defaultPct": 5.0,
    }


def count_bot_open_runs(bot_id: int) -> int:
    """Currently-open positions attributed to this bot (for the max_open cap)."""
    row = fetch_one("SELECT COUNT(*) AS n FROM runs_log WHERE bot_id = %s AND status = 'open'", (bot_id,))
    return int(row["n"]) if row else 0


def list_bot_runs(bot_id: int, limit: int = 200) -> list[dict[str, Any]]:
    """This bot's trades from runs_log, newest first by real event time."""
    rows = fetch_all(
        "SELECT id, username, mode, symbol, side, opened_at, closed_at, duration_seconds, "
        "entry_price, exit_price, qty, pnl, pnl_pct, status, source, bot_id, created_at "
        "FROM runs_log WHERE bot_id = %s "
        "ORDER BY COALESCE(closed_at, opened_at, created_at) DESC, id DESC LIMIT %s",
        (bot_id, int(limit)),
    )
    return [dict(r) for r in rows]


def bot_pnl_summary(username: str) -> list[dict[str, Any]]:
    """Per-bot aggregate (trade count, open count, realized P&L) for the user's
    bots — grouped from runs_log by bot_id."""
    rows = fetch_all(
        "SELECT bot_id, COUNT(*) AS trades, "
        "COUNT(*) FILTER (WHERE status = 'open') AS open_count, "
        "COALESCE(SUM(pnl), 0) AS pnl "
        "FROM runs_log WHERE bot_id IS NOT NULL AND username = %s GROUP BY bot_id",
        (username,),
    )
    return [{"botId": int(r["bot_id"]), "trades": int(r["trades"] or 0),
             "open": int(r["open_count"] or 0), "pnl": round(float(r["pnl"] or 0.0), 2)}
            for r in rows]


def user_detail(username: str) -> Optional[dict[str, Any]]:
    """Aggregate everything an admin needs about ONE user — account, access, login
    activity, recent audit timeline, runs, and demo stats. Read-only; never raises
    on the optional sub-parts (they degrade to empty/None)."""
    u = get_user(username)
    if not u:
        return None
    sess = {"since": None, "last_seen": None, "sessions": 0}
    try:
        with get_conn() as conn:
            r = conn.execute(
                "SELECT MIN(created_at) AS since, MAX(COALESCE(last_seen, created_at)) AS last_seen, "
                "COUNT(*) AS sessions FROM auth_sessions WHERE username = %s", (username,)
            ).fetchone()
        if r:
            sess = {"since": r.get("since"), "last_seen": r.get("last_seen"), "sessions": int(r.get("sessions") or 0)}
    except Exception:  # noqa: BLE001
        pass
    account = {
        "username": u.get("username"), "role": u.get("role"), "isMain": bool(u.get("is_main")),
        "createdAt": u.get("created_at"), "createdBy": u.get("created_by"), "email": u.get("email"),
        "phone": u.get("phone"), "nickname": u.get("nickname"), "plan": (u.get("plan") or "basic"),
        "profitEngineUnlocked": bool(u.get("profit_engine_unlocked")), "isDemo": bool(u.get("is_demo")),
        "demoExpires": u.get("demo_expires"), "onboarded": bool(u.get("onboarded")),
        "badge": u.get("badge"), "loyaltyPoints": int(u.get("loyalty_points") or 0),
        "subscriptionStatus": u.get("subscription_status"),
    }
    demo = None
    if u.get("is_demo"):
        try:
            demo = {"score": tester_score(username).get("score"), "pnl": demo_pnl_stats(owner=username).get("total")}
        except Exception:  # noqa: BLE001
            demo = None
    try:
        locked = get_user_locked(username)
    except Exception:  # noqa: BLE001
        locked = []
    try:
        audit = list_audit_for(username, limit=100)
    except Exception:  # noqa: BLE001
        audit = []
    try:
        runs = list_runs_log(username=username, limit=200)
    except Exception:  # noqa: BLE001
        runs = []
    return {"account": account, "access": {"locked": locked}, "logins": sess,
            "audit": audit, "runs": runs, "demo": demo}


def add_target_event(mode: str, hit_at: str, started_at: Optional[str],
                     seconds_to_target: Optional[float], target: float, profit: float,
                     assets: str, detail: Optional[dict] = None,
                     session_id: Optional[int] = None) -> None:
    data = {"mode": mode, "hitAt": hit_at, "startedAt": started_at,
            "secondsToTarget": seconds_to_target, "target": target, "profit": profit,
            "assets": assets, "detail": detail, "sessionId": session_id}
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO target_events (session_id, data) VALUES (%s, %s)",
            (session_id, Json(data)),
        )


def list_target_events(limit: int = 100, session_id: Optional[int] = None) -> List[dict]:
    with get_conn() as conn:
        if session_id is not None:
            rows = conn.execute(
                "SELECT id, data FROM target_events WHERE session_id = %s ORDER BY id DESC LIMIT %s",
                (session_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, data FROM target_events ORDER BY id DESC LIMIT %s", (limit,)
            ).fetchall()
    return [{**(r["data"] or {}), "id": r["id"]} for r in rows]


# ── Telegram config ───────────────────────────────────────────────────────────

_TELEGRAM_DEFAULTS = {
    "botToken": "", "chatId": "", "scheduleTime": "08:00", "scheduleEnabled": False,
    "runIdOverride": None, "lastSentAt": None, "lastSendStatus": None, "lastSendMessage": None,
    "notifyExcelDaily": True, "notifyRunFinished": True, "notifyProfitEngine": True,
    "notifySignals": True,
    # Two-way assistant: mirror suggestions/free-text to Telegram AND route the
    # admin's reply back to the user. The kill switch for the whole 2-way bridge.
    "notifyAssistant": True,
}


def get_telegram_config() -> dict:
    return {**_TELEGRAM_DEFAULTS, **(_get_singleton("telegram_config", {}) or {})}


def save_telegram_config(bot_token: str, chat_id: str, schedule_time: str,
                         schedule_enabled: bool, run_id_override: Optional[str] = None,
                         notify_excel_daily: bool = True, notify_run_finished: bool = True,
                         notify_profit_engine: bool = True, notify_signals: bool = True,
                         notify_assistant: bool = True) -> None:
    cfg = get_telegram_config()
    cfg.update(botToken=bot_token, chatId=chat_id, scheduleTime=schedule_time,
               scheduleEnabled=schedule_enabled, runIdOverride=run_id_override,
               notifyExcelDaily=notify_excel_daily, notifyRunFinished=notify_run_finished,
               notifyProfitEngine=notify_profit_engine, notifySignals=notify_signals,
               notifyAssistant=notify_assistant)
    _set_singleton("telegram_config", cfg)


def update_telegram_send_status(ok: bool, message: str) -> None:
    cfg = get_telegram_config()
    cfg.update(lastSentAt=now_iso(), lastSendStatus=("ok" if ok else "error"), lastSendMessage=message)
    _set_singleton("telegram_config", cfg)


def disconnect_telegram_config() -> None:
    """Wipe the stored Telegram connection (token + chat) back to defaults and
    turn admin approvals off. Used by the admin 'Disconnect' button so the bot
    can be cleanly re-connected."""
    _set_singleton("telegram_config", dict(_TELEGRAM_DEFAULTS))
    _set_singleton("telegram_approvals_enabled", False)


def telegram_approvals_enabled() -> bool:
    return bool(_get_singleton("telegram_approvals_enabled", False))


def set_telegram_approvals_enabled(on: bool) -> None:
    _set_singleton("telegram_approvals_enabled", bool(on))


# ── Per-admin Telegram (each admin connects their own bot + chat) ──────────────
_USER_TG_KEY = "user_telegram_config"


def get_user_telegram(username: str) -> dict:
    """This admin's own Telegram connection ({botToken, chatId, enabled})."""
    return dict((_get_singleton(_USER_TG_KEY, {}) or {}).get(username, {}) or {})


def save_user_telegram(username: str, bot_token: str, chat_id: str) -> None:
    d = dict(_get_singleton(_USER_TG_KEY, {}) or {})
    d[username] = {"botToken": bot_token or "", "chatId": chat_id or "",
                   "enabled": bool(bot_token and chat_id)}
    _set_singleton(_USER_TG_KEY, d)


def disconnect_user_telegram(username: str) -> None:
    d = dict(_get_singleton(_USER_TG_KEY, {}) or {})
    d.pop(username, None)
    _set_singleton(_USER_TG_KEY, d)


def mark_user_telegram_tested(username: str, ok: bool) -> None:
    """Remember whether this admin's last Send-test reached Telegram, so the panel
    can show a "verified" badge. Only touches the test flag — never the creds."""
    d = dict(_get_singleton(_USER_TG_KEY, {}) or {})
    entry = d.get(username)
    if isinstance(entry, dict):
        entry["lastTestOk"] = bool(ok)
        d[username] = entry
        _set_singleton(_USER_TG_KEY, d)


def list_user_telegrams() -> dict:
    """All per-user Telegram connections, keyed by username."""
    return dict(_get_singleton(_USER_TG_KEY, {}) or {})


# ── Telegram ↔ in-app user routing (for the 2-way assistant) ───────────────────
# Remembers which Telegram chat an app user reached us from, so an admin's reply
# in the dashboard can be mirrored back to that chat. Keyed by app username.
_TG_CHAT_MAP_KEY = "telegram_user_chats"


def set_telegram_chat_for_user(username: str, chat_id) -> None:
    """Remember the Telegram chat an app user last messaged us from."""
    if not username or not chat_id:
        return
    d = dict(_get_singleton(_TG_CHAT_MAP_KEY, {}) or {})
    if d.get(username) == str(chat_id):
        return  # unchanged — avoid a needless write
    d[username] = str(chat_id)
    _set_singleton(_TG_CHAT_MAP_KEY, d)


def get_telegram_chat_for_user(username: str) -> Optional[str]:
    """The Telegram chat id for an app user, or None if they never used the bot."""
    if not username:
        return None
    return (dict(_get_singleton(_TG_CHAT_MAP_KEY, {}) or {})).get(username)


# ── Daily scan cache (feeds the Profit Engine) ──────────────────────────────

# ── AutoPilots simulation state (owners-only, DRY-RUN — no real orders) ───────────
# Every row here is SIMULATED. Nothing in this section places an order or moves money.

def autopilot_arm(*, username: str, pilot_id: str, direction: str, market: str,
                  nav: float, per_trade_pct: float, account_label: "Optional[str]",
                  next_run_at: "Optional[str]" = None) -> dict:
    """Arm (or re-arm) a pilot for a user. Upserts the config; keeps armed_at stable."""
    now = now_iso()
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO autopilot_armed (username, pilot_id, direction, market, nav, "
            "per_trade_pct, account_label, armed_at, next_run_at, status) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'simulation') "
            "ON CONFLICT (username, pilot_id) DO UPDATE SET "
            "direction=EXCLUDED.direction, market=EXCLUDED.market, nav=EXCLUDED.nav, "
            "per_trade_pct=EXCLUDED.per_trade_pct, account_label=EXCLUDED.account_label, "
            "next_run_at=COALESCE(EXCLUDED.next_run_at, autopilot_armed.next_run_at) "
            "RETURNING *",
            (username, pilot_id, direction, market, float(nav), float(per_trade_pct),
             account_label, now, next_run_at),
        ).fetchone()
    return dict(row) if row else {}


def autopilot_disarm(username: str, pilot_id: str) -> None:
    """Disarm a pilot and drop its simulated positions + activity (clean slate)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM autopilot_armed WHERE username=%s AND pilot_id=%s", (username, pilot_id))
        conn.execute("DELETE FROM autopilot_sim_positions WHERE username=%s AND pilot_id=%s", (username, pilot_id))
        conn.execute("DELETE FROM autopilot_sim_activity WHERE username=%s AND pilot_id=%s", (username, pilot_id))


def list_autopilot_armed(username: "Optional[str]" = None) -> "list[dict]":
    """List armed pilots — a single user's, or ALL users' (for the daily loop)."""
    if username:
        rows = fetch_all("SELECT * FROM autopilot_armed WHERE username=%s ORDER BY armed_at", (username,))
    else:
        rows = fetch_all("SELECT * FROM autopilot_armed ORDER BY username, armed_at")
    return [dict(r) for r in rows]


def get_autopilot_armed(username: str, pilot_id: str) -> "Optional[dict]":
    row = fetch_one("SELECT * FROM autopilot_armed WHERE username=%s AND pilot_id=%s", (username, pilot_id))
    return dict(row) if row else None


def set_autopilot_run_stamps(username: str, pilot_id: str, last_run_at: str, next_run_at: str) -> None:
    execute("UPDATE autopilot_armed SET last_run_at=%s, next_run_at=%s WHERE username=%s AND pilot_id=%s",
            (last_run_at, next_run_at, username, pilot_id))


def set_autopilot_equity(username: str, pilot_id: str, curve: "list") -> None:
    """Store the backfilled simulated P&L journey ([{d,v}]) on the armed row."""
    execute("UPDATE autopilot_armed SET equity_curve=%s WHERE username=%s AND pilot_id=%s",
            (Json(curve or []), username, pilot_id))


def clear_autopilot_sim(username: str, pilot_id: str) -> None:
    """Wipe a pilot's simulated positions + activity (used before a fresh backfill)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM autopilot_sim_positions WHERE username=%s AND pilot_id=%s", (username, pilot_id))
        conn.execute("DELETE FROM autopilot_sim_activity WHERE username=%s AND pilot_id=%s", (username, pilot_id))


def list_closed_autopilot_positions(username: str, limit: int = 300) -> "list[dict]":
    """All CLOSED autopilot positions for a user across every pilot (sim + live), newest-first,
    for the source-aware closed-positions log. Read-only."""
    q = ("SELECT id, pilot_id, symbol, side, entry_price, exit_price, qty, realized_pnl, "
         "status, mode, opened_at, closed_at FROM autopilot_sim_positions "
         "WHERE username=%s AND status='closed' "
         "ORDER BY COALESCE(closed_at, opened_at) DESC, id DESC LIMIT %s")
    return [dict(r) for r in fetch_all(q, (username, int(limit)))]


def list_autopilot_positions(username: str, pilot_id: str, status: "Optional[str]" = None) -> "list[dict]":
    q = "SELECT * FROM autopilot_sim_positions WHERE username=%s AND pilot_id=%s"
    params: "list[Any]" = [username, pilot_id]
    if status:
        q += " AND status=%s"; params.append(status)
    q += " ORDER BY (status='open') DESC, opened_at DESC"
    return [dict(r) for r in fetch_all(q, tuple(params))]


def open_autopilot_position(*, username: str, pilot_id: str, symbol: str, side: str,
                            entry_price: float, qty: float, opened_at: "Optional[str]" = None,
                            mode: str = "simulation", order_id: "Optional[str]" = None) -> int:
    """Record a NEW pilot position. `mode` distinguishes a SIMULATED entry ('simulation',
    the default — no order was placed) from a REAL live fill ('live', with the exchange
    `order_id` stamped for audit reconciliation)."""
    now = now_iso()
    opened = opened_at or now
    with get_conn() as conn:
        row = conn.execute(
            "INSERT INTO autopilot_sim_positions (username, pilot_id, symbol, side, entry_price, "
            "qty, last_price, unrealized_pnl, status, opened_at, updated_at, mode, order_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,0,'open',%s,%s,%s,%s) RETURNING id",
            (username, pilot_id, symbol, side, float(entry_price), float(qty), float(entry_price),
             opened, now, mode, order_id),
        ).fetchone()
    return int(row["id"]) if row else 0


def mark_autopilot_position(position_id: int, last_price: float, unrealized_pnl: float) -> None:
    execute("UPDATE autopilot_sim_positions SET last_price=%s, unrealized_pnl=%s, updated_at=%s WHERE id=%s",
            (float(last_price), float(unrealized_pnl), now_iso(), position_id))


def close_autopilot_position(position_id: int, exit_price: float, realized_pnl: float,
                             closed_at: "Optional[str]" = None) -> None:
    now = now_iso()
    execute("UPDATE autopilot_sim_positions SET status='closed', exit_price=%s, realized_pnl=%s, "
            "unrealized_pnl=0, last_price=%s, closed_at=%s, updated_at=%s WHERE id=%s",
            (float(exit_price), float(realized_pnl), float(exit_price), (closed_at or now), now, position_id))


def log_autopilot_activity(*, username: str, pilot_id: str, kind: str, symbol: "Optional[str]" = None,
                           side: "Optional[str]" = None, price: "Optional[float]" = None,
                           qty: "Optional[float]" = None, pnl: "Optional[float]" = None,
                           note: "Optional[str]" = None, at: "Optional[str]" = None) -> None:
    execute("INSERT INTO autopilot_sim_activity (username, pilot_id, kind, symbol, side, price, qty, pnl, note, at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (username, pilot_id, kind, symbol, side,
             (float(price) if price is not None else None),
             (float(qty) if qty is not None else None),
             (float(pnl) if pnl is not None else None), note, (at or now_iso())))


def list_autopilot_activity(username: str, pilot_id: str, limit: int = 20) -> "list[dict]":
    rows = fetch_all("SELECT * FROM autopilot_sim_activity WHERE username=%s AND pilot_id=%s "
                     "ORDER BY at DESC, id DESC LIMIT %s", (username, pilot_id, int(limit)))
    return [dict(r) for r in rows]


# ── AutoPilots REAL-MONEY (Bybit) — mode, keys, audit (heavily-safeguarded, GATED) ──

def set_autopilot_mode(username: str, pilot_id: str, mode: str,
                       live_cap: "Optional[float]" = None,
                       live_started_at: "Optional[str]" = None) -> None:
    """Flip a pilot between 'simulation' (default/fallback) and 'live'. When switching to
    live, `live_cap` (the mandatory low starting-capital cap) is stored. The KILL-SWITCH
    calls this with mode='simulation' to instantly stop new live orders."""
    if mode == "live":
        execute("UPDATE autopilot_armed SET mode='live', live_cap=%s, live_started_at=%s "
                "WHERE username=%s AND pilot_id=%s",
                (float(live_cap or 0.0), (live_started_at or now_iso()), username, pilot_id))
    else:
        # Back to simulation — keep live_cap on record for the audit, just flip the mode.
        execute("UPDATE autopilot_armed SET mode='simulation' WHERE username=%s AND pilot_id=%s",
                (username, pilot_id))


def set_autopilot_capital(username: str, pilot_id: str, nav: float) -> bool:
    """Update ONLY the sizing capital (nav) of an armed pilot — WITHOUT disarming/reloading,
    so its positions/history are preserved and the per-trade size (nav × per_trade_pct%)
    re-derives from the new capital. Does NOT touch `live_cap` (the separate real-money cap
    governs live spend). Returns True if a row was updated."""
    with get_conn() as conn:
        cur = conn.execute("UPDATE autopilot_armed SET nav=%s WHERE username=%s AND pilot_id=%s",
                           (float(nav), username, pilot_id))
        try:
            return (cur.rowcount or 0) > 0
        except Exception:  # noqa: BLE001
            return True


def save_autopilot_keys(*, username: str, exchange: str, environment: str,
                        enc_key: str, enc_secret: str) -> None:
    """Upsert the owner's encrypted AutoPilots exchange keys (CIPHERTEXT only — the route
    encrypts before calling this). NEVER stores plaintext, NEVER logs the values."""
    _assert_key_storage_retired()  # M7: StrateTeach holds no keys
    now = now_iso()
    connected = bool(enc_key and enc_secret)
    execute(
        "INSERT INTO autopilot_exchange_keys "
        "(username, exchange, environment, enc_key, enc_secret, connected, created_at, updated_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
        "ON CONFLICT (username) DO UPDATE SET "
        "exchange=EXCLUDED.exchange, environment=EXCLUDED.environment, "
        "enc_key=EXCLUDED.enc_key, enc_secret=EXCLUDED.enc_secret, "
        "connected=EXCLUDED.connected, updated_at=EXCLUDED.updated_at",
        (username, exchange, environment, enc_key, enc_secret, connected, now, now),
    )


def get_autopilot_keys(username: str) -> "Optional[dict]":
    """RAW keys row (includes ciphertext) — INTERNAL use only (the live executor decrypts
    it server-side). Routes must NEVER return this raw; use the masked/status helper."""
    if not username:
        return None
    row = fetch_one("SELECT * FROM autopilot_exchange_keys WHERE username=%s", (username,))
    return dict(row) if row else None


def set_autopilot_keys_test(username: str, ok: bool, msg: str) -> None:
    execute("UPDATE autopilot_exchange_keys SET last_test_at=%s, last_test_ok=%s, last_test_msg=%s "
            "WHERE username=%s", (now_iso(), bool(ok), (msg or "")[:300], username))


def delete_autopilot_keys(username: str) -> None:
    """Disconnect: remove the owner's stored keys entirely."""
    if not username:
        return
    execute("DELETE FROM autopilot_exchange_keys WHERE username=%s", (username,))


def log_autopilot_live_audit(*, username: str, pilot_id: "Optional[str]", action: str,
                             detail: "Optional[dict]" = None) -> None:
    """Append-only audit trail for EVERY live action. `detail` must NEVER carry secrets —
    callers pass only non-sensitive fields (symbol, qty, price, order id, error text)."""
    execute("INSERT INTO autopilot_live_audit (username, pilot_id, action, detail, at) "
            "VALUES (%s,%s,%s,%s,%s)",
            (username, pilot_id, action, Json(detail or {}), now_iso()))


def list_autopilot_live_audit(username: str, limit: int = 100) -> "list[dict]":
    rows = fetch_all("SELECT * FROM autopilot_live_audit WHERE username=%s ORDER BY at DESC, id DESC LIMIT %s",
                     (username, int(limit)))
    return [dict(r) for r in rows]


def save_daily_scan(signals: list, ran_at: str, next_at: str) -> None:
    """Cache the day's crypto breakout scan. Bounded to keep the JSONB small — the
    cap must stay ABOVE the scan's CRYPTO_LIMIT (500) or it would silently truncate
    the universe the AutoPilots consume; 600 leaves headroom."""
    crypto = [s for s in (signals or []) if s.get("bucket") == "crypto"][:600]
    _set_singleton("daily_scan", {"ranAt": ran_at, "nextAt": next_at, "signals": crypto})


def get_daily_scan() -> dict:
    return _get_singleton("daily_scan", {}) or {}


# ── Phase 2b · dedicated STOCKS mean-reversion scan (paper-sim only) ──────────
# A SEPARATE singleton from the crypto breakout scan above. The live daily batch
# reads ONLY `daily_scan` (crypto); the mean-reversion paper-sim reads ONLY this
# key. This isolation is deliberate and money-safe: the mean-reversion sleeve can
# never perturb the scan the live-capable AutoPilots consume, and vice-versa.
def save_daily_scan_stocks_mr(signals: list, ran_at: str, next_at: str) -> None:
    """Cache the day's stocks mean-reversion scan (RSI2 + Bollinger signals). Bounded
    well above the 150-symbol default universe so widening it later can't silently
    truncate. Paper-sim only — no live consumer."""
    stocks = [s for s in (signals or []) if s.get("bucket") == "stocks"][:600]
    _set_singleton("daily_scan_stocks_mr", {"ranAt": ran_at, "nextAt": next_at, "signals": stocks})


def get_daily_scan_stocks_mr() -> dict:
    return _get_singleton("daily_scan_stocks_mr", {}) or {}


# ── Phase 2c · dedicated CRYPTO trend scan (DR-Crypto pilot, paper-sim only) ──
# A SEPARATE singleton from the crypto breakout scan (which feeds pilots 1/2) and the
# stocks-MR scan. The DR-Crypto trend paper-sim reads ONLY this key. Isolation is
# deliberate and money-safe: it can never perturb the live-consumed scans, and vice-versa.
def save_daily_scan_dr_crypto(signals: list, ran_at: str, next_at: str) -> None:
    """Cache the day's crypto trend scan (Donchian + 200-SMA + Chandelier signals). Bounded
    above the 250-symbol default universe. Paper-sim only — no live consumer."""
    crypto = [s for s in (signals or []) if s.get("bucket") == "crypto"][:600]
    _set_singleton("daily_scan_dr_crypto", {"ranAt": ran_at, "nextAt": next_at, "signals": crypto})


def get_daily_scan_dr_crypto() -> dict:
    return _get_singleton("daily_scan_dr_crypto", {}) or {}


# ── DR-Crypto per-user OPERATIONAL risk mode (aggressive / smooth / safe) ─────
# Sets HOW the DR-Crypto SIM pilot sizes/risk-manages when it runs (dr_sim reads it).
# Paper-sim only — never touches the live executor / gate / orders.
def set_dr_mode(username: str, mode: str) -> None:
    modes = dict(_get_singleton("dr_crypto_modes", {}) or {})
    modes[username] = str(mode)
    _set_singleton("dr_crypto_modes", modes)


def get_dr_mode(username: str) -> str:
    return (_get_singleton("dr_crypto_modes", {}) or {}).get(username, "smooth")


# ── Section access control (admin gates which sections regular users see) ────

def get_section_access() -> dict:
    return _get_singleton("section_access", {"locked": []}) or {"locked": []}


def set_section_access(locked: list) -> None:
    _set_singleton("section_access", {"locked": [str(x) for x in (locked or [])]})


def get_user_locked(username: str) -> list:
    """Per-user locked section paths. Falls back to the global list if the user
    has no explicit override (so existing global rules still apply)."""
    import json
    with get_conn() as conn:
        row = conn.execute("SELECT locked_sections FROM users WHERE username = %s", (username,)).fetchone()
    raw = (row or {}).get("locked_sections")
    if raw:
        try:
            v = json.loads(raw)
            if isinstance(v, list):
                return [str(x) for x in v]
        except (TypeError, ValueError):
            pass
    return get_section_access().get("locked", [])


def set_user_locked(username: str, locked: list) -> None:
    import json
    with get_conn() as conn:
        conn.execute("UPDATE users SET locked_sections = %s WHERE username = %s",
                     (json.dumps([str(x) for x in (locked or [])]), username))


# ── Profile: nickname + win-rate target ─────────────────────────────────────

def set_nickname(username: str, nickname: Optional[str]) -> None:
    execute("UPDATE users SET nickname = %s WHERE username = %s", (nickname or None, username))


def set_win_target(username: str, target: float) -> None:
    target = max(0.0, min(100.0, float(target)))
    with get_conn() as conn:
        conn.execute("UPDATE users SET win_target = %s WHERE username = %s", (target, username))


def set_avatar(username: str, avatar: Optional[str]) -> None:
    """Store the user's profile picture as a data-URL string (or NULL to clear)."""
    execute("UPDATE users SET avatar = %s WHERE username = %s", (avatar or None, username))


def set_phone(username: str, phone: Optional[str]) -> None:
    """Store the user's phone number for SMS alerts (or NULL to clear)."""
    execute("UPDATE users SET phone = %s WHERE username = %s", (phone or None, username))


def set_twofa(username: str, enabled: bool) -> None:
    """Enable/disable channel-OTP (Telegram/email) login 2FA for a user."""
    execute("UPDATE users SET twofa_enabled = %s WHERE username = %s", (bool(enabled), username))


# ── TOTP (authenticator-app) login factor ────────────────────────────────────

def set_totp_secret(username: str, secret: Optional[str]) -> None:
    """Store (or clear) the user's TOTP shared secret WITHOUT enabling it yet —
    used at setup-start, before the user confirms a code. Resets the replay
    guard so a freshly-scanned secret starts clean."""
    execute("UPDATE users SET totp_secret = %s, totp_last_step = 0 WHERE username = %s",
            (secret or None, username))


def set_totp_enabled(username: str, enabled: bool) -> None:
    """Turn TOTP on (after a confirmed code) or off. Disabling also wipes the
    secret so a re-enable must scan a brand-new QR."""
    if enabled:
        execute("UPDATE users SET totp_enabled = TRUE WHERE username = %s", (username,))
    else:
        execute("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_last_step = 0 "
                "WHERE username = %s", (username,))


def set_totp_last_step(username: str, step: int) -> None:
    """Record the last accepted 30s time-step so the same code can't be replayed."""
    execute("UPDATE users SET totp_last_step = %s WHERE username = %s", (int(step), username))


def set_privacy_ack(username: str, version: str) -> None:
    """Record that the user accepted the privacy policy version (date string)."""
    execute("UPDATE users SET privacy_ack = %s WHERE username = %s", (version or None, username))


# ── Public self-signup requests (await admin approval) ───────────────────────

def create_signup_request(name: str, email: Optional[str], phone: Optional[str], note: Optional[str]) -> int:
    row = fetch_one("INSERT INTO signup_requests (name, email, phone, note, status, created_at) "
            "VALUES (%s, %s, %s, %s, 'pending', %s) RETURNING id", (name, email, phone, note, now_iso()))
    return int(row["id"])


def list_signup_requests(status: Optional[str] = "pending") -> list[dict]:
    with get_conn() as conn:
        if status:
            rows = conn.execute("SELECT * FROM signup_requests WHERE status = %s ORDER BY id DESC", (status,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM signup_requests ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


def get_signup_request(req_id: int) -> Optional[dict]:
    row = fetch_one("SELECT * FROM signup_requests WHERE id = %s", (req_id,))
    return dict(row) if row else None


def set_signup_request_status(req_id: int, status: str, handled_by: Optional[str], username: Optional[str] = None) -> None:
    execute("UPDATE signup_requests SET status = %s, handled_at = %s, handled_by = %s, username = COALESCE(%s, username) WHERE id = %s", (status, now_iso(), handled_by, username, req_id))


# ── Self-service password-reset requests ("can't log in" → admin approval) ───

def create_password_reset_request(username: str, contact: Optional[str] = None,
                                  note: Optional[str] = None) -> int:
    """Record a 'can't log in / forgot password' request. Dedupes against an
    existing PENDING request for the same user (re-submitting refreshes contact +
    timestamp instead of piling up rows), which doubles as basic anti-spam."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM password_reset_requests WHERE username = %s AND status = 'pending' "
            "ORDER BY id DESC LIMIT 1", (username,),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE password_reset_requests SET contact = COALESCE(%s, contact), "
                "note = COALESCE(%s, note), created_at = %s WHERE id = %s",
                (contact, note, now_iso(), row["id"]),
            )
            return int(row["id"])
        ins = conn.execute(
            "INSERT INTO password_reset_requests (username, contact, note, status, created_at) "
            "VALUES (%s, %s, %s, 'pending', %s) RETURNING id",
            (username, contact, note, now_iso()),
        ).fetchone()
    return int(ins["id"]) if ins else 0


def list_password_reset_requests(status: Optional[str] = "pending") -> list[dict]:
    with get_conn() as conn:
        if status:
            rows = conn.execute("SELECT * FROM password_reset_requests WHERE status = %s ORDER BY id DESC", (status,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM password_reset_requests ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


def get_password_reset_request(req_id: int) -> Optional[dict]:
    row = fetch_one("SELECT * FROM password_reset_requests WHERE id = %s", (req_id,))
    return dict(row) if row else None


def set_password_reset_request_status(req_id: int, status: str, handled_by: Optional[str]) -> None:
    execute("UPDATE password_reset_requests SET status = %s, handled_at = %s, handled_by = %s WHERE id = %s",
            (status, now_iso(), handled_by, req_id))


def pending_password_reset_request_count() -> int:
    row = fetch_one("SELECT COUNT(*) AS n FROM password_reset_requests WHERE status = 'pending'")
    return int(row["n"]) if row else 0


def unique_username(base: str) -> str:
    """Make a unique username from a base (email local-part or name)."""
    import re
    base = re.sub(r"[^a-zA-Z0-9_.]", "", (base or "user").split("@")[0]).strip(".") or "user"
    base = base[:20].lower()
    if get_user(base) is None:
        return base
    for i in range(2, 999):
        cand = f"{base}{i}"
        if get_user(cand) is None:
            return cand
    return f"{base}{secrets.token_hex(3)}"


# ── Per-user notification preferences (channels + alert types) ───────────────

# Channels are OPT-IN (off until the user enables them); alert types default on
# so once a channel is enabled the user gets the useful ones without extra setup.
_NOTIF_DEFAULTS = {
    "sms": False,          # send via SMS
    "whatsapp": False,     # send via WhatsApp
    "email": False,        # send via email (opt-in, strictly per-user)
    "whatsappTo": "",      # optional separate WhatsApp number (falls back to phone)
    "breakout": True,      # alert on new breakout signals
    "takeProfit": True,    # alert when a run hits take-profit
    "stopLoss": True,      # alert when a run hits stop-loss
    "botTrade": True,      # alert when a Signal Bot executes a live order
    "digest": False,       # daily scan digest
    "chat": True,          # push chat messages to SMS/WhatsApp/email
    # Per-channel consent audit trail (compliance). Stamped SERVER-SIDE only when a
    # channel is switched ON: {channel: {ts, version}}. Never client-writable.
    "consent": {},
}

# Deliverable channels that require explicit opt-in consent on enable.
_NOTIF_CHANNELS = ("sms", "whatsapp", "email")
# Keys the UI is allowed to set (consent is stamped server-side, never by the client).
_NOTIF_USER_KEYS = [k for k in _NOTIF_DEFAULTS if k != "consent"]


def get_notif_prefs(username: str) -> dict:
    row = fetch_one("SELECT notif_prefs, phone, email FROM users WHERE username = %s", (username,))
    # Copy defaults; deep-copy the mutable consent dict so callers never share it.
    prefs = {k: (dict(v) if isinstance(v, dict) else v) for k, v in _NOTIF_DEFAULTS.items()}
    if row and row.get("notif_prefs"):
        try:
            prefs.update({k: v for k, v in dict(row["notif_prefs"]).items() if k in _NOTIF_DEFAULTS})
        except (TypeError, ValueError):
            pass
    prefs["phone"] = (row or {}).get("phone") or ""
    # Recipient address for the email channel is the account email (like `phone` for SMS).
    prefs["emailTo"] = (row or {}).get("email") or ""
    if not isinstance(prefs.get("consent"), dict):
        prefs["consent"] = {}
    return prefs


def set_notif_prefs(username: str, prefs: dict) -> dict:
    import json
    cur = get_notif_prefs(username)
    prefs = prefs or {}
    # Stamp explicit per-channel consent when a channel transitions OFF -> ON. The
    # policy version is the user's accepted privacy_ack, tying consent to the policy
    # they agreed to. Strictly per-user — no global state.
    consent = dict(cur.get("consent") or {})
    ack = None
    for ch in _NOTIF_CHANNELS:
        if ch in prefs and bool(prefs[ch]) and not bool(cur.get(ch)):
            if ack is None:
                ack = (get_user(username) or {}).get("privacy_ack") or ""
            consent[ch] = {"ts": now_iso(), "version": ack, "channel": ch}
    # Only user-settable keys from the client; `consent` is authoritative server state.
    for k in _NOTIF_USER_KEYS:
        if k in prefs:
            cur[k] = prefs[k]
    cur["consent"] = consent
    store = {k: cur.get(k, _NOTIF_DEFAULTS[k]) for k in _NOTIF_DEFAULTS}
    with get_conn() as conn:
        conn.execute("UPDATE users SET notif_prefs = %s WHERE username = %s",
                     (json.dumps(store), username))
    u = get_user(username) or {}
    cur["phone"] = u.get("phone") or ""
    cur["emailTo"] = u.get("email") or ""
    return cur


# ── WhatsApp: reverse phone→user lookup + 24h session window + recipient setup ─
# Twilio inbound WhatsApp carries the sender as "whatsapp:+E.164". We map that back
# to an app user by matching the digits against users.phone OR their notif_prefs
# whatsappTo. Everything here is strictly per-user (no global state).

def _phone_digits(p: Optional[str]) -> str:
    """Digits-only form of a phone/whatsapp address (drops '+', spaces, 'whatsapp:')."""
    return re.sub(r"\D", "", p or "")


def get_user_by_phone(phone: str) -> Optional[str]:
    """Reverse-map a phone / whatsapp:+E.164 → username, or None.

    Matches on the last 9 digits (robust to +country-code vs. leading-0 storage),
    against both users.phone and the per-user notif_prefs.whatsappTo override. If
    more than one user shares that tail the match is ambiguous → return None (an
    owner then triages the message as an unknown sender rather than mis-routing it).
    """
    digits = _phone_digits(phone)
    if len(digits) < 7:
        return None
    tail = digits[-9:]
    hits: set[str] = set()
    for r in fetch_all(
        "SELECT username, phone, notif_prefs FROM users "
        "WHERE (phone IS NOT NULL AND phone <> '') "
        "OR COALESCE(notif_prefs->>'whatsappTo', '') <> ''"
    ):
        cand = _phone_digits(r.get("phone"))
        prefs = r.get("notif_prefs") or {}
        wa = _phone_digits(prefs.get("whatsappTo") if isinstance(prefs, dict) else "")
        if (cand and cand[-9:] == tail) or (wa and wa[-9:] == tail):
            hits.add(r["username"])
    return next(iter(hits)) if len(hits) == 1 else None


def wa_mark_inbound(username: str, ts: Optional[str] = None) -> None:
    """Stamp the user's most-recent inbound WhatsApp time — opens/refreshes their
    24h free-form messaging window (Twilio/Meta rule; outside it a template is
    required). Per-user singleton, never global."""
    _set_singleton(f"wa_window:{username}", ts or now_iso())


def wa_in_window(username: str, hours: int = 24) -> bool:
    """True if the user messaged us within the last ``hours`` (free-form allowed)."""
    ts = _get_singleton(f"wa_window:{username}", None)
    if not ts:
        return False
    try:
        last = datetime.fromisoformat(ts)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    return (datetime.now(timezone.utc) - last) <= timedelta(hours=hours)


def set_whatsapp_recipient(username: str, phone: str, *, all_alerts: bool = True) -> dict:
    """One-call setup of a WhatsApp alert recipient: store their phone, point the
    WhatsApp channel at it, enable WhatsApp, and (by default) turn ON every alert
    type. Consent is stamped by set_notif_prefs on the OFF→ON transition. Returns
    the resulting prefs. Strictly per-user."""
    phone = (phone or "").strip()
    if phone:
        set_phone(username, phone)
    prefs = {"whatsapp": True, "whatsappTo": phone}
    if all_alerts:
        prefs.update({"breakout": True, "takeProfit": True, "stopLoss": True,
                      "botTrade": True, "digest": True, "chat": True})
    return set_notif_prefs(username, prefs)


def latest_open_request_id(user_id: str) -> Optional[int]:
    """The user's most-recent NOT-resolved user_request (to append an inbound WA
    message onto an existing thread instead of spawning a new one each time)."""
    row = fetch_one(
        "SELECT id FROM requests WHERE user_id = %s AND category = 'user_request' "
        "AND status <> 'resolved' ORDER BY id DESC LIMIT 1",
        (user_id,),
    )
    return int(row["id"]) if row else None


# ── Per-user in-app auto-run (Profit Engine scheduler) ───────────────────────

# Config a user saves for the automatic Profit Engine runner. "bank" and
# "lastOpenedAt" are runtime state the loop maintains (not set directly by the UI).
_AUTORUN_DEFAULTS = {
    "enabled": False,
    "mode": "interval",            # "interval" | "count"
    "intervalMinutes": 60,         # interval mode: open a run this often
    "count": 0,                    # count mode: runs still to open (decrements)
    "capital": 1000.0,             # capital per run (the base, before reinvest)
    "dailyTarget": 50.0,           # profit target per run (USDT)
    "strategy": "bot8c",
    "buckets": ["crypto"],
    "tiers": ["breaking_out", "near_breakout"],
    "maxPositions": 5,
    "stopLossEnabled": False,
    "stopLossMode": "amount",
    "stopLossValue": 0.0,
    "autoCloseOnTarget": True,     # close the whole run the moment its target is hit
    "onlyIfCapitalAvailable": True,  # don't open a new run while one is still running
    "reinvest": False,             # roll the closed run's full value into the next run
    "dailyReset": False,           # ADMIN-only: each day close yesterday's auto-runs and reopen at 00:01 (Israel time)
    # runtime state (managed by the autorun loop, not the UI form):
    "bank": 0.0,                   # current compounding capital (0 = use "capital")
    "lastOpenedAt": None,          # ISO time the loop last opened a run for this user
    "lastSid": None,               # session id of the most recent auto-opened run
    "lastResetDay": None,          # YYYY-MM-DD (Israel) of the last daily reset
}

# Keys the UI is allowed to set (everything except internal runtime state).
_AUTORUN_USER_KEYS = [k for k in _AUTORUN_DEFAULTS if k not in ("bank", "lastOpenedAt")]


def get_autorun(username: str) -> dict:
    row = fetch_one("SELECT autorun FROM users WHERE username = %s", (username,))
    cfg = dict(_AUTORUN_DEFAULTS)
    if row and row.get("autorun"):
        try:
            cfg.update({k: v for k, v in dict(row["autorun"]).items() if k in _AUTORUN_DEFAULTS})
        except (TypeError, ValueError):
            pass
    return cfg


def set_autorun(username: str, patch: dict, *, internal: bool = False) -> dict:
    """Merge ``patch`` into the user's autorun config and persist.

    By default only user-settable keys are accepted; pass internal=True for the
    loop to update runtime state ("bank", "lastOpenedAt").
    """
    import json
    cur = get_autorun(username)
    allowed = list(_AUTORUN_DEFAULTS) if internal else _AUTORUN_USER_KEYS
    for k in allowed:
        if k in (patch or {}):
            cur[k] = patch[k]
    store = {k: cur.get(k, _AUTORUN_DEFAULTS[k]) for k in _AUTORUN_DEFAULTS}
    with get_conn() as conn:
        conn.execute("UPDATE users SET autorun = %s WHERE username = %s",
                     (json.dumps(store), username))
    return cur


def list_autorun_enabled() -> list[dict]:
    """[{username, autorun}] for every user whose autorun is enabled (for the loop)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT username, autorun FROM users "
            "WHERE COALESCE((autorun->>'enabled')::boolean, FALSE) IS TRUE"
        ).fetchall()
    out = []
    for r in rows:
        cfg = dict(_AUTORUN_DEFAULTS)
        try:
            cfg.update({k: v for k, v in dict(r.get("autorun") or {}).items() if k in _AUTORUN_DEFAULTS})
        except (TypeError, ValueError):
            pass
        out.append({"username": r["username"], "autorun": cfg})
    return out


def broadcast_recipients(target: str = "all") -> list[dict]:
    """Recipients for an admin broadcast.

    target: 'all' (everyone with a phone), 'demo' (active demo testers),
            or a comma-separated list of usernames.
    Returns [{username, phone, whatsappTo}].
    """
    with get_conn() as conn:
        if target == "demo":
            rows = conn.execute(
                "SELECT username, phone, notif_prefs FROM users "
                "WHERE is_demo = TRUE ORDER BY created_at DESC"
            ).fetchall()
        elif target in ("all", "", None):
            rows = conn.execute(
                "SELECT username, phone, notif_prefs FROM users "
                "WHERE phone IS NOT NULL AND phone <> '' ORDER BY created_at"
            ).fetchall()
        else:
            names = [n.strip() for n in str(target).split(",") if n.strip()]
            if not names:
                return []
            rows = conn.execute(
                "SELECT username, phone, notif_prefs FROM users WHERE username = ANY(%s)",
                (names,),
            ).fetchall()
    out = []
    for r in rows:
        prefs = {}
        try:
            prefs = dict(r.get("notif_prefs") or {})
        except (TypeError, ValueError):
            prefs = {}
        out.append({
            "username": r["username"],
            "phone": r.get("phone") or "",
            "whatsappTo": prefs.get("whatsappTo") or r.get("phone") or "",
        })
    return out


def is_recently_online(username: str, mins: int = 5) -> bool:
    """True if the user had a session active within the last ``mins`` minutes."""
    try:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT MAX(COALESCE(last_seen, created_at)) AS ls FROM auth_sessions WHERE username = %s",
                (username,),
            ).fetchone()
        ls = row and row.get("ls")
        if not ls:
            return False
        return (datetime.now(timezone.utc) - datetime.fromisoformat(ls)).total_seconds() < mins * 60
    except Exception:
        return False


def display_name(username: str) -> str:
    u = get_user(username) or {}
    return (u.get("nickname") or username)


# ── Built-in Assistant chat account ─────────────────────────────────────────

def ensure_assistant_user() -> None:
    """Create the built-in 'assistant' chat account if missing (never logged into).

    A random password is set so the account can't be signed into; messages are
    posted as it server-side. Sends one greeting DM to the admin so the
    conversation shows up in their chat list.
    """
    if not get_user("assistant"):
        import secrets as _s
        from app.services.auth import hash_password
        create_user("assistant", hash_password(_s.token_urlsafe(24)), role="user", created_by="system")
        try:
            set_nickname("assistant", "Assistant")
        except Exception:  # noqa: BLE001
            pass
    if not _get_singleton("assistant_greeted", False):
        try:
            chat_send("assistant", "admin",
                      "👋 Hi! I'm your Assistant. Message me here anytime — I'll answer within a few minutes.")
            _set_singleton("assistant_greeted", True)
        except Exception:  # noqa: BLE001
            pass


def assistant_inbox(since_id: int = 0, limit: int = 50) -> list[dict[str, Any]]:
    """DMs to the assistant from ADMINS only, with id > since_id (oldest first).

    The Assistant is private to admins — messages from regular users are ignored
    so it never auto-replies to anyone but the owner(s).
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT cm.id, cm.ts, cm.from_user, cm.body FROM chat_messages cm "
            "JOIN users u ON u.username = cm.from_user "
            "WHERE cm.to_user = 'assistant' AND u.role = 'admin' AND cm.id > %s "
            "ORDER BY cm.id ASC LIMIT %s",
            (since_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def assistant_cursor() -> int:
    try:
        return int(_get_singleton("assistant_cursor", 0) or 0)
    except Exception:  # noqa: BLE001
        return 0


def set_assistant_cursor(n: int) -> None:
    _set_singleton("assistant_cursor", int(n))


# ── In-app chat ─────────────────────────────────────────────────────────────

def chat_send(from_user: str, to_user: Optional[str], body: str, group_id: Optional[int] = None) -> dict[str, Any]:
    row = fetch_one("INSERT INTO chat_messages (ts, from_user, to_user, body, group_id) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id, ts, from_user, to_user, body, group_id", (now_iso(), from_user, to_user or None, body, group_id))
    return dict(row)


def chat_poll(username: str, since_id: int = 0, limit: int = 200) -> list[dict[str, Any]]:
    """Messages visible to ``username``: broadcasts + DMs to/from them + any group
    they belong to, with id > since_id."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, from_user, to_user, body, group_id FROM chat_messages "
            "WHERE id > %s AND ("
            "  (group_id IS NULL AND (to_user IS NULL OR to_user = %s OR from_user = %s))"
            "  OR group_id IN (SELECT group_id FROM group_members WHERE username = %s)"
            ") ORDER BY id ASC LIMIT %s",
            (since_id, username, username, username, limit),
        ).fetchall()
    return [dict(r) for r in rows]


# ── Admin "reply to users" inbox — inbound DMs from users to an admin/assistant ──
# A DM is part of a support thread when EXACTLY ONE side is a support endpoint (an
# admin account or the built-in 'assistant') and the other is a real (non-support) user.
def _is_support_side(username: Optional[str], role: Optional[str]) -> bool:
    return username == "assistant" or role == "admin"


def admin_chat_peers(limit: int = 1000) -> list[dict[str, Any]]:
    """Per non-support user who has DM'd (or been DM'd by) an admin/assistant: their
    LATEST message in that thread + whether the USER sent it last (→ needs a reply).
    Newest-first scan, first-seen-per-peer = latest."""
    rows = fetch_all(
        "SELECT cm.id, cm.ts, cm.from_user, cm.to_user, cm.body, "
        "fu.role AS from_role, tu.role AS to_role "
        "FROM chat_messages cm "
        "LEFT JOIN users fu ON fu.username = cm.from_user "
        "LEFT JOIN users tu ON tu.username = cm.to_user "
        "WHERE cm.group_id IS NULL AND cm.to_user IS NOT NULL "
        "ORDER BY cm.id DESC LIMIT %s", (limit,))
    peers: "dict[str, dict[str, Any]]" = {}
    for r in rows:
        fu, tu = r["from_user"], r["to_user"]
        f_support = _is_support_side(fu, r.get("from_role"))
        t_support = _is_support_side(tu, r.get("to_role"))
        if f_support == t_support:                 # need exactly one support side
            continue
        peer = tu if f_support else fu             # the real (non-support) user
        if not peer or peer == "assistant":
            continue
        if peer not in peers:                      # newest-first → first seen is the latest
            peers[peer] = {"userId": peer, "ts": r["ts"], "body": r["body"], "fromUser": (not f_support)}
    return list(peers.values())


def admin_user_chat_thread(user: str, limit: int = 300) -> list[dict[str, Any]]:
    """The chronological DM thread between ``user`` and any admin/assistant."""
    rows = fetch_all(
        "SELECT cm.id, cm.ts, cm.from_user, cm.to_user, cm.body, "
        "fu.role AS from_role, tu.role AS to_role "
        "FROM chat_messages cm "
        "LEFT JOIN users fu ON fu.username = cm.from_user "
        "LEFT JOIN users tu ON tu.username = cm.to_user "
        "WHERE cm.group_id IS NULL AND (cm.from_user = %s OR cm.to_user = %s) "
        "ORDER BY cm.id ASC LIMIT %s", (user, user, limit))
    out = []
    for r in rows:
        fu, tu = r["from_user"], r["to_user"]
        f_support = _is_support_side(fu, r.get("from_role"))
        t_support = _is_support_side(tu, r.get("to_role"))
        if f_support == t_support:
            continue
        peer = tu if f_support else fu
        if peer != user:
            continue
        out.append({"ts": r["ts"], "body": r["body"], "fromUser": (fu == user),
                    "author": display_name(fu), "authorId": fu})
    return out


# ── Friends + group chats ───────────────────────────────────────────────────

def friend_request(requester: str, addressee: str) -> None:
    with get_conn() as conn:
        # if the reverse request already exists, accept both directions
        rev = conn.execute("SELECT 1 FROM friendships WHERE requester = %s AND addressee = %s",
                           (addressee, requester)).fetchone()
        if rev:
            conn.execute("UPDATE friendships SET status='accepted' WHERE requester=%s AND addressee=%s",
                         (addressee, requester))
            return
        conn.execute(
            "INSERT INTO friendships (requester, addressee, status, ts) VALUES (%s,%s,'pending',%s) "
            "ON CONFLICT (requester, addressee) DO NOTHING",
            (requester, addressee, now_iso()),
        )


def friend_accept(user: str, requester: str) -> None:
    execute("UPDATE friendships SET status='accepted' WHERE requester=%s AND addressee=%s", (requester, user))


def friend_remove(a: str, b: str) -> None:
    execute("DELETE FROM friendships WHERE (requester=%s AND addressee=%s) OR (requester=%s AND addressee=%s)", (a, b, b, a))


def list_friends(user: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT requester, addressee FROM friendships WHERE status='accepted' AND (requester=%s OR addressee=%s)",
            (user, user)).fetchall()
    return [(r["addressee"] if r["requester"] == user else r["requester"]) for r in rows]


def resolve_user(query: str) -> Optional[str]:
    """Resolve a person by username OR nickname, case-insensitively → canonical username."""
    q = (query or "").strip()
    if not q:
        return None
    with get_conn() as conn:
        row = conn.execute(
            "SELECT username FROM users WHERE lower(username)=lower(%s) OR lower(nickname)=lower(%s) "
            "ORDER BY (lower(username)=lower(%s)) DESC LIMIT 1", (q, q, q)).fetchone()
    return row["username"] if row else None


def list_friend_requests(user: str) -> dict:
    with get_conn() as conn:
        inc = conn.execute("SELECT requester FROM friendships WHERE status='pending' AND addressee=%s", (user,)).fetchall()
        out = conn.execute("SELECT addressee FROM friendships WHERE status='pending' AND requester=%s", (user,)).fetchall()
    return {"incoming": [r["requester"] for r in inc], "outgoing": [r["addressee"] for r in out]}


def create_group(name: str, creator: str, members: list) -> int:
    with get_conn() as conn:
        row = conn.execute("INSERT INTO chat_groups (name, created_by, created_at) VALUES (%s,%s,%s) RETURNING id",
                           (name, creator, now_iso())).fetchone()
        gid = row["id"]
        for m in set([creator] + list(members or [])):
            conn.execute("INSERT INTO group_members (group_id, username) VALUES (%s,%s) ON CONFLICT DO NOTHING", (gid, m))
    return gid


def list_groups(user: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT g.id, g.name, g.created_by FROM chat_groups g "
            "JOIN group_members m ON m.group_id = g.id WHERE m.username = %s ORDER BY g.id", (user,)).fetchall()
        out = []
        for g in rows:
            mem = conn.execute("SELECT username FROM group_members WHERE group_id = %s", (g["id"],)).fetchall()
            out.append({"id": g["id"], "name": g["name"], "createdBy": g["created_by"],
                        "members": [x["username"] for x in mem]})
    return out


def group_member_ok(user: str, group_id: int) -> bool:
    row = fetch_one("SELECT 1 FROM group_members WHERE group_id=%s AND username=%s", (group_id, user))
    return row is not None


def get_group(group_id: int) -> Optional[dict]:
    row = fetch_one("SELECT id, name, created_by FROM chat_groups WHERE id=%s", (group_id,))
    return dict(row) if row else None


def list_group_members(group_id: int) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute("SELECT username FROM group_members WHERE group_id=%s", (group_id,)).fetchall()
    return [r["username"] for r in rows]


def add_group_member(group_id: int, username: str) -> None:
    execute("INSERT INTO group_members (group_id, username) VALUES (%s,%s) ON CONFLICT DO NOTHING", (group_id, username))


SUGGESTIONS_GROUP = "💡 Suggestions"


def ensure_suggestions_group() -> int:
    """A chat group that collects tester feedback. Members = admin + all demo
    users, so only they can see it (regular users are never added)."""
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM chat_groups WHERE name=%s ORDER BY id LIMIT 1", (SUGGESTIONS_GROUP,)).fetchone()
        gid = int(row["id"]) if row else None
        demos = [d["username"] for d in conn.execute("SELECT username FROM users WHERE is_demo = TRUE").fetchall()]
    if gid is None:
        return create_group(SUGGESTIONS_GROUP, "admin", ["admin", *demos])
    with get_conn() as conn:
        conn.execute("INSERT INTO group_members (group_id, username) VALUES (%s,'admin') ON CONFLICT DO NOTHING", (gid,))
        for d in demos:
            conn.execute("INSERT INTO group_members (group_id, username) VALUES (%s,%s) ON CONFLICT DO NOTHING", (gid, d))
    return gid


def join_suggestions_group(username: str) -> None:
    try:
        add_group_member(ensure_suggestions_group(), username)
    except Exception:
        pass


# ── Rewards (admin → users) + chat deletion ─────────────────────────────────

def add_reward(from_user: str, target: Optional[str], kind: str = "confetti") -> int:
    row = fetch_one("INSERT INTO rewards (ts, from_user, target, kind) VALUES (%s,%s,%s,%s) RETURNING id", (now_iso(), from_user, target or None, kind))
    return row["id"]


def pending_rewards(username: str, since_id: int = 0) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, from_user, target, kind FROM rewards "
            "WHERE id > %s AND (target IS NULL OR target = %s) ORDER BY id ASC LIMIT 20",
            (since_id, username)).fetchall()
    return [dict(r) for r in rows]


def delete_dm(a: str, b: str) -> None:
    execute("DELETE FROM chat_messages WHERE group_id IS NULL AND "
                     "((from_user=%s AND to_user=%s) OR (from_user=%s AND to_user=%s))", (a, b, b, a))


def delete_group_messages(group_id: int) -> None:
    execute("DELETE FROM chat_messages WHERE group_id = %s", (group_id,))


def delete_broadcast_messages() -> None:
    execute("DELETE FROM chat_messages WHERE group_id IS NULL AND to_user IS NULL")


def chat_contacts(me: str, online_window_min: int = 5) -> list[dict[str, Any]]:
    """All users with their nickname + whether they're online now (recent session)."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT u.username, u.nickname, u.role, u.avatar, "
            "MAX(COALESCE(s.last_seen, s.created_at)) AS last_seen "
            "FROM users u LEFT JOIN auth_sessions s ON s.username = u.username "
            "GROUP BY u.username, u.nickname, u.role, u.avatar ORDER BY u.username"
        ).fetchall()
    out = []
    now = datetime.now(timezone.utc)
    for r in rows:
        ls = r.get("last_seen")
        online = False
        if ls:
            try:
                online = (now - datetime.fromisoformat(ls)).total_seconds() < online_window_min * 60
            except (TypeError, ValueError):
                online = False
        out.append({"username": r["username"], "nickname": r.get("nickname") or r["username"],
                    "role": r.get("role"), "avatar": r.get("avatar"), "online": online,
                    "lastSeen": ls, "isMe": r["username"] == me})
    return out


# ── Admin screen-capture ────────────────────────────────────────────────────

def screen_request(target_user: str, requested_by: str) -> dict[str, Any]:
    row = fetch_one("INSERT INTO screen_requests (ts, target_user, requested_by, status) "
            "VALUES (%s, %s, %s, 'pending') RETURNING id", (now_iso(), target_user, requested_by))
    return dict(row)


def screen_pending_for(target_user: str) -> Optional[dict[str, Any]]:
    """The newest still-pending capture request for this user (so their browser snaps)."""
    row = fetch_one("SELECT id, requested_by, ts FROM screen_requests "
            "WHERE target_user = %s AND status = 'pending' ORDER BY id DESC LIMIT 1", (target_user,))
    return dict(row) if row else None


def screen_is_watched(target_user: str, window_min: int = 2) -> bool:
    """True if an admin requested/captured this user's screen very recently (banner)."""
    row = fetch_one("SELECT MAX(ts) AS t FROM screen_requests WHERE target_user = %s", (target_user,))
    t = row.get("t") if row else None
    if not t:
        return False
    try:
        return (datetime.now(timezone.utc) - datetime.fromisoformat(t)).total_seconds() < window_min * 60
    except (TypeError, ValueError):
        return False


def screen_upload(request_id: int, image: str, route: Optional[str]) -> None:
    execute("UPDATE screen_requests SET image = %s, route = %s, status = 'captured', captured_at = %s "
            "WHERE id = %s", (image, route, now_iso(), request_id))


def screen_captures(limit: int = 50) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, target_user, requested_by, status, route, captured_at "
            "FROM screen_requests ORDER BY id DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def screen_capture_image(capture_id: int) -> Optional[dict[str, Any]]:
    row = fetch_one("SELECT id, target_user, route, captured_at, image FROM screen_requests WHERE id = %s", (capture_id,))
    return dict(row) if row else None


# ── Performance analytics (win-rate engine) ─────────────────────────────────

def _pnl_of(data: dict[str, Any]) -> Optional[float]:
    for k in ("pnl", "profit", "realizedPnl", "pnlUsd", "netPnl", "result"):
        v = data.get(k) if isinstance(data, dict) else None
        if isinstance(v, (int, float)):
            return float(v)
    return None


def win_analytics() -> dict[str, Any]:
    """Aggregate closed paper positions into trades / wins / win-rate / P&L.

    Self-hosted-per-customer: one instance == one customer, so all closed
    positions on the instance are 'the user's' trades. Defensive about the JSON
    shape so a missing pnl key never crashes the dashboard.
    """
    trades = wins = losses = 0
    gross_win = gross_loss = 0.0
    recent: list[dict[str, Any]] = []
    try:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT id, data FROM paper_positions WHERE status <> 'open' ORDER BY id DESC LIMIT 500"
            ).fetchall()
    except Exception:
        rows = []
    for r in rows:
        data = r.get("data") or {}
        pnl = _pnl_of(data)
        if pnl is None:
            continue
        trades += 1
        if pnl >= 0:
            wins += 1
            gross_win += pnl
        else:
            losses += 1
            gross_loss += -pnl
        if len(recent) < 20:
            recent.append({"symbol": data.get("symbol") or data.get("sym"), "pnl": round(pnl, 2)})
    win_rate = (wins / trades * 100.0) if trades else 0.0
    net = gross_win - gross_loss
    avg_win = (gross_win / wins) if wins else 0.0
    avg_loss = (gross_loss / losses) if losses else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (gross_win if gross_win > 0 else 0.0)
    return {
        "trades": trades, "wins": wins, "losses": losses,
        "winRate": round(win_rate, 1), "netPnl": round(net, 2),
        "grossWin": round(gross_win, 2), "grossLoss": round(gross_loss, 2),
        "avgWin": round(avg_win, 2), "avgLoss": round(avg_loss, 2),
        "profitFactor": round(profit_factor, 2), "recent": recent,
    }


# ── Dashboard live stats (active runs + demo P&L by period) ──────────────────

def count_running_runs() -> int:
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT COUNT(*) AS n FROM runs WHERE status = 'running'").fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def count_running_sessions(owner: Optional[str] = None, is_admin: bool = False) -> int:
    """Running demo sessions. Scoped to ``owner`` unless ``is_admin`` (or no owner)."""
    try:
        with get_conn() as conn:
            if is_admin or owner is None:
                row = conn.execute("SELECT COUNT(*) AS n FROM paper_sessions WHERE data->>'status' = 'running'").fetchone()
            else:
                row = conn.execute(
                    "SELECT COUNT(*) AS n FROM paper_sessions WHERE data->>'status' = 'running' AND data->>'owner' = %s",
                    (owner,),
                ).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def count_open_positions(owner: Optional[str] = None, is_admin: bool = False) -> int:
    """Currently-open demo/paper positions. Scoped to ``owner`` unless ``is_admin``."""
    try:
        with get_conn() as conn:
            if is_admin or owner is None:
                row = conn.execute("SELECT COUNT(*) AS n FROM paper_positions WHERE status = 'open'").fetchone()
            else:
                row = conn.execute(
                    "SELECT COUNT(*) AS n FROM paper_positions pp JOIN paper_sessions ps ON ps.id = pp.session_id "
                    "WHERE pp.status = 'open' AND ps.data->>'owner' = %s",
                    (owner,),
                ).fetchone()
        return int(row["n"]) if row else 0
    except Exception:
        return 0


def demo_pnl_stats(owner: Optional[str] = None, is_admin: bool = False) -> dict:
    """Realized demo P&L bucketed by today / this month / this year / all-time.

    Scoped to ``owner``'s sessions unless ``is_admin`` (or no owner is given).
    """
    now = datetime.now(timezone.utc)
    today = now.date().isoformat(); month = now.strftime("%Y-%m"); year = str(now.year)
    total = d_today = d_month = d_year = 0.0
    cost = 0.0  # invested basis of the counted (closed) positions → for % display
    trades = 0
    try:
        with get_conn() as conn:
            if is_admin or owner is None:
                rows = conn.execute("SELECT data FROM paper_positions WHERE status <> 'open'").fetchall()
            else:
                rows = conn.execute(
                    "SELECT pp.data AS data FROM paper_positions pp "
                    "JOIN paper_sessions ps ON ps.id = pp.session_id "
                    "WHERE pp.status <> 'open' AND ps.data->>'owner' = %s",
                    (owner,),
                ).fetchall()
    except Exception:
        rows = []
    for r in rows:
        data = r.get("data") or {}
        pnl = data.get("realizedPnl")
        if pnl is None:
            pnl = _pnl_of(data)
        if pnl is None:
            continue
        pnl = float(pnl); total += pnl; trades += 1
        cost += float(data.get("capital") or 0.0)
        ca = str(data.get("closedAt") or "")
        if ca[:10] == today: d_today += pnl
        if ca[:7] == month: d_month += pnl
        if ca[:4] == year: d_year += pnl
    return {"trades": trades, "total": round(total, 2), "today": round(d_today, 2),
            "month": round(d_month, 2), "year": round(d_year, 2), "cost": round(cost, 2)}


def list_open_demo_positions(owner: Optional[str] = None, is_admin: bool = False) -> List[dict]:
    """Open (unrealized) demo positions, scoped to ``owner`` unless admin.

    Read-only: used to fold the *current* unrealized P&L of open positions into the
    demo dashboard total so the headline matches the per-position view. Pure DB read
    — no marking, no target/stop-loss evaluation, no persistence, no side effects.
    """
    try:
        with get_conn() as conn:
            if is_admin or owner is None:
                rows = conn.execute(
                    "SELECT data FROM paper_positions WHERE status = 'open'").fetchall()
            else:
                rows = conn.execute(
                    "SELECT pp.data AS data FROM paper_positions pp "
                    "JOIN paper_sessions ps ON ps.id = pp.session_id "
                    "WHERE pp.status = 'open' AND ps.data->>'owner' = %s",
                    (owner,),
                ).fetchall()
    except Exception:
        return []
    return [(r.get("data") or {}) for r in rows]


def demo_score(*, trades: int, win_rate: float, pnl_pct: float) -> int:
    """Gamified demo-tester score, 0–1000, always positive (even at a loss).

    Rewards *using* the demo and trading well, and never punishes a loss below the
    base so a losing tester still gets a low-but-positive, motivating score:

        base       = 50                          (just for being an active tester)
      + activity   = min(200, trades * 10)       (20+ trades → max)
      + win-rate   = min(300, round(winRate%*3)) (100% wins → max)
      + profit     = min(450, max(0, pnl%)*10)   (45%+ gain → max; a loss adds 0)
        ----------------------------------------------------------------------
        score      = clamp(0, 1000)              (max 50+200+300+450 = 1000)

    A loss only zeroes the *profit* component — base+activity+win-rate keep the
    score positive, so the board motivates rather than shames.
    """
    activity_pts = min(200, max(0, trades) * 10)
    win_pts = min(300, round(max(0.0, win_rate) * 3))
    profit_pts = min(450, round(max(0.0, pnl_pct) * 10))
    return int(max(0, min(1000, 50 + activity_pts + win_pts + profit_pts)))


def demo_leaderboard() -> list[dict[str, Any]]:
    """Ranked demo-tester leaderboard for the admin (and the "send to all" blast).

    One row per demo user with: username, how long they've been registered
    (``tenureDays`` — the frontend formats it as "3 days"/"2 weeks"), realized
    demo P&L ($ and %), trade count, win-rate, and a gamified ``score`` (0–1000,
    always ≥0 — see ``demo_score``). Ranked by score (then $), so everyone — even
    losers — gets a positive score and a rank to climb.

    Realized closed positions are aggregated per owner in a single pass (mirrors
    ``demo_pnl_stats``' per-position P&L logic, including the ``_pnl_of`` fallback
    and the invested ``capital`` basis used for the %). Demo users with no closed
    trades still appear (zeroed) so the admin sees everyone.
    """
    users = list_demo_users()  # username, demo_expires, demo_token, created_at
    stats: dict[str, dict] = {}
    try:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT ps.data->>'owner' AS owner, pp.data AS data "
                "FROM paper_positions pp JOIN paper_sessions ps ON ps.id = pp.session_id "
                "WHERE pp.status <> 'open'"
            ).fetchall()
    except Exception:
        rows = []
    for r in rows:
        owner = r.get("owner")
        if not owner:
            continue
        data = r.get("data") or {}
        pnl = data.get("realizedPnl")
        if pnl is None:
            pnl = _pnl_of(data)
        if pnl is None:
            continue
        pnl = float(pnl)
        s = stats.setdefault(owner, {"pnl": 0.0, "cost": 0.0, "trades": 0, "wins": 0})
        s["pnl"] += pnl
        s["cost"] += float(data.get("capital") or 0.0)
        s["trades"] += 1
        if pnl > 0:
            s["wins"] += 1

    now = datetime.now(timezone.utc)
    out: list[dict[str, Any]] = []
    for u in users:
        un = u.get("username")
        s = stats.get(un, {"pnl": 0.0, "cost": 0.0, "trades": 0, "wins": 0})
        cost, pnl, trades, wins = s["cost"], s["pnl"], s["trades"], s["wins"]
        pct = (pnl / cost * 100.0) if cost > 0 else 0.0
        win_rate = (wins / trades * 100.0) if trades else 0.0
        score = demo_score(trades=trades, win_rate=win_rate, pnl_pct=pct)
        tenure_days = None
        ca = u.get("created_at")
        try:
            if ca:
                dt = datetime.fromisoformat(ca)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                tenure_days = max(0, int((now - dt).total_seconds() // 86400))
        except (TypeError, ValueError):
            tenure_days = None
        out.append({
            "username": un,
            "name": un,                         # real username (per admin request — not the nickname)
            "createdAt": ca,
            "tenureDays": tenure_days,
            "pnl": round(pnl, 2),
            "pnlPct": round(pct, 2),
            "trades": trades,
            "wins": wins,
            "winRate": round(win_rate, 1) if trades else None,
            "score": score,
        })
    out.sort(key=lambda r: (r["score"], r["pnl"]), reverse=True)
    return out


def live_realized_stats(username: Optional[str] = None) -> dict:
    """Realized P&L from the LIVE order log, bucketed today / this month / this
    year / all-time, using a moving-average cost basis per symbol.

    Each sell realises ``qty * (sell_price - avg_buy_cost)`` and is bucketed by
    the sell's timestamp. Sells with no logged buy (cost basis unknown — e.g.
    coins acquired outside the app) are skipped so profit is never overstated.
    Robust to deposits / withdrawals because those are not orders. Mirrors
    ``demo_pnl_stats`` so the live dashboard card matches the demo one.
    """
    now = datetime.now(timezone.utc)
    today = now.date().isoformat(); month = now.strftime("%Y-%m"); year = str(now.year)
    total = d_today = d_month = d_year = 0.0
    trades = 0
    # Optional "start fresh" baseline: ignore orders before this timestamp so a
    # user can zero the counters once (e.g. after a logging fix) without deleting
    # history. Cost basis still replays from the start so sells are priced right.
    since = _get_singleton("live_stats_since", None)
    try:
        # Scope to ``username`` on personal views; None aggregates (admin) and
        # preserves the legacy behaviour for any caller that doesn't scope.
        acts = list_activity(limit=5000, mode="live", username=username)
    except Exception:
        acts = []
    # list_activity returns newest-first; replay oldest→newest so cost basis builds up.
    orders = [a for a in acts if a.get("kind") == "order"]
    orders.reverse()
    from collections import defaultdict
    qty_pool: dict = defaultdict(float)   # remaining qty held from logged buys
    cost_pool: dict = defaultdict(float)  # remaining cost basis for that qty
    for a in orders:
        side = (a.get("side") or "").lower()
        base = str(a.get("symbol") or "").split("/")[0].upper()
        if not base:
            continue
        qty = float(a.get("qty") or 0)
        cost = float(a.get("cost") or 0)
        if side == "buy":
            qty_pool[base] += qty
            cost_pool[base] += cost
        elif side == "sell":
            held = qty_pool[base]
            if held <= 0 or qty <= 0:
                continue  # no cost basis on record → can't compute, skip
            sold = qty if qty <= held else held
            avg = cost_pool[base] / held if held else 0.0
            # Proceeds: trust the logged fill value. If it's missing (legacy rows
            # from before the sell-proceeds logging fix), treat the sell as
            # break-even rather than booking the whole cost basis as a fake loss.
            ppu = (cost / qty) if (qty and cost > 0) else avg
            realized = (ppu - avg) * sold
            qty_pool[base] -= sold
            cost_pool[base] -= avg * sold
            ts = str(a.get("ts") or "")
            if since and ts < since:
                continue  # before the baseline → don't count toward stats
            total += realized; trades += 1
            if ts[:10] == today: d_today += realized
            if ts[:7] == month: d_month += realized
            if ts[:4] == year: d_year += realized
    return {"trades": trades, "total": round(total, 2), "today": round(d_today, 2),
            "month": round(d_month, 2), "year": round(d_year, 2)}


# ── Admin hourly-report aggregates (real data, read-only, defensive) ────────────────────
# Cheap SQL rollups for the Telegram/SMS hourly digest. Each returns zeros on any error so
# the digest never breaks; nothing here is fabricated.

def autopilot_report_stats() -> dict:
    """AutoPilots rollup across ALL users: loaded/live pilot counts + sim & live P&L
    (realized on closed + unrealized on open) + open sim positions + which pilots are
    loaded + today's sim P&L (realized closed today + current unrealized on open).

    HONESTY: ``livePnl`` reflects only pilots actually armed in mode='live'. While the
    master gate ``AUTOPILOT_LIVE_ENABLED`` is OFF no pilot arms live, so ``live`` = 0 and
    ``livePnl`` = $0 — the digest must present sim P&L as SIMULATION, never as real money."""
    day_start = _il_day_start_iso()
    try:
        armed = fetch_one("SELECT COUNT(*) AS loaded, COUNT(*) FILTER (WHERE mode='live') AS live "
                          "FROM autopilot_armed") or {}
        pos = fetch_one(
            "SELECT "
            "COALESCE(SUM(realized_pnl) FILTER (WHERE status='closed' AND mode='simulation'),0) "
            "  + COALESCE(SUM(unrealized_pnl) FILTER (WHERE status='open' AND mode='simulation'),0) AS sim_pnl, "
            "COALESCE(SUM(realized_pnl) FILTER (WHERE status='closed' AND mode='simulation' AND COALESCE(closed_at, updated_at, opened_at) >= %s),0) "
            "  + COALESCE(SUM(unrealized_pnl) FILTER (WHERE status='open' AND mode='simulation'),0) AS sim_pnl_today, "
            "COALESCE(SUM(realized_pnl) FILTER (WHERE status='closed' AND mode='live'),0) "
            "  + COALESCE(SUM(unrealized_pnl) FILTER (WHERE status='open' AND mode='live'),0) AS live_pnl, "
            "COUNT(*) FILTER (WHERE status='open' AND mode='simulation') AS open_sim, "
            "COUNT(*) FILTER (WHERE status='open' AND mode='live') AS open_live "
            "FROM autopilot_sim_positions", (day_start,)) or {}
        pilots = fetch_all("SELECT pilot_id, COUNT(*) AS n FROM autopilot_armed "
                           "GROUP BY pilot_id ORDER BY n DESC")
        pilot_names = [str(p.get("pilot_id")) for p in (pilots or [])]
        return {"loaded": int(armed.get("loaded") or 0), "live": int(armed.get("live") or 0),
                "pilots": pilot_names,
                "simPnl": round(float(pos.get("sim_pnl") or 0.0), 2),
                "simPnlToday": round(float(pos.get("sim_pnl_today") or 0.0), 2),
                "livePnl": round(float(pos.get("live_pnl") or 0.0), 2),
                "openPositions": int(pos.get("open_sim") or 0),
                "openLive": int(pos.get("open_live") or 0)}
    except Exception:  # noqa: BLE001
        return {"loaded": 0, "live": 0, "pilots": [], "simPnl": 0.0, "simPnlToday": 0.0,
                "livePnl": 0.0, "openPositions": 0, "openLive": 0}


def signal_bots_report_stats() -> dict:
    """Signal Bots rollup across ALL users: active/total bots + trades/open/realized P&L
    (from runs_log rows attributed to a bot)."""
    day_start = _il_day_start_iso()
    try:
        bots = fetch_one("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status='active') AS active "
                         "FROM bots") or {}
        runs = fetch_one(
            "SELECT COUNT(*) AS trades, COUNT(*) FILTER (WHERE status='open') AS open_ct, "
            "COALESCE(SUM(pnl),0) AS pnl, "
            "COUNT(*) FILTER (WHERE status='closed' AND COALESCE(closed_at, created_at) >= %s) AS closed_today, "
            "COALESCE(SUM(pnl) FILTER (WHERE status='closed' AND COALESCE(closed_at, created_at) >= %s),0) AS pnl_today "
            "FROM runs_log WHERE bot_id IS NOT NULL", (day_start, day_start)) or {}
        return {"activeBots": int(bots.get("active") or 0), "totalBots": int(bots.get("total") or 0),
                "trades": int(runs.get("trades") or 0), "open": int(runs.get("open_ct") or 0),
                "pnl": round(float(runs.get("pnl") or 0.0), 2),
                "closedToday": int(runs.get("closed_today") or 0),
                "pnlToday": round(float(runs.get("pnl_today") or 0.0), 2)}
    except Exception:  # noqa: BLE001
        return {"activeBots": 0, "totalBots": 0, "trades": 0, "open": 0, "pnl": 0.0,
                "closedToday": 0, "pnlToday": 0.0}


def profit_engine_live_stats(username: str) -> dict:
    """Per-user LIVE Trading Engine rollup — REALIZED P&L from ALL of the engine's own live
    closes: runs_log where mode='live', NOT a signal bot (bot_id IS NULL), status='closed'.

    "Engine's own" = every live position opened through the engine order path
    (exchange.place_order / placeOnExchange), fired MANUALLY or by the approved auto-batch,
    incl. its stop-loss/take-profit OCO closes (which live_reconcile stamps onto the same
    rows). NOT filtered to source='auto': the engine logs its live buys as source='manual'
    (bot_id NULL), so the old source='auto' filter matched nothing here (only Signal Bots
    write source='auto', and they carry a bot_id) — this bucket was always $0.

    bot_id IS NULL keeps it engine-only, so it never double-counts Signal Bots (bot_id set;
    their own Home slice) or open-position unrealized P&L. Mirrors profit_engine_report_stats."""
    try:
        row = fetch_one(
            "SELECT COALESCE(SUM(pnl) FILTER (WHERE status='closed'),0) AS realized, "
            "COUNT(*) FILTER (WHERE status='closed') AS closed "
            "FROM runs_log WHERE mode='live' AND bot_id IS NULL AND username=%s",
            (username,)) or {}
        return {"realizedPnl": round(float(row.get("realized") or 0.0), 2),
                "closed": int(row.get("closed") or 0)}
    except Exception:  # noqa: BLE001
        return {"realizedPnl": 0.0, "closed": 0}


def profit_engine_report_stats() -> dict:
    """Trading Engine rollup: REAL (live) profit from ALL engine-attributed closes today
    + all-time — runs_log where mode='live' and bot_id IS NULL.

    "Engine slice" = every live position the app opened through the Trading Engine order
    path (exchange.place_order / placeOnExchange), whether fired MANUALLY or by the
    approved auto-batch — including exchange-side stop-loss / take-profit OCO closes that
    live_reconcile stamps onto those same rows. Deliberately NOT filtered to source='auto':
    the engine logs its live buys as source='manual' (bot_id NULL), so the old source='auto'
    filter matched nothing (only Signal Bots write source='auto', and those carry a bot_id).

    Scope is kept engine-only by ``bot_id IS NULL``: Signal Bots (bot_id set) and AutoPilots
    (never written to runs_log) have their own report lines, so nothing is double-counted
    here. This is a SUBSET of the overall LIVE — real-money line, not a separate total."""
    try:
        # Israel-midnight "today" boundary, matching every other *_report_stats rollup
        # (they all compare UTC-ISO timestamps against _il_day_start_iso()). Using UTC
        # midnight here made this one line's "today" roll over at a different instant.
        today = _il_day_start_iso()
        row = fetch_one(
            "SELECT "
            "COALESCE(SUM(pnl) FILTER (WHERE status='closed'),0) AS pnl_all, "
            "COUNT(*) FILTER (WHERE status='closed') AS closed_all, "
            "COALESCE(SUM(pnl) FILTER (WHERE status='closed' AND COALESCE(closed_at, created_at) >= %s),0) AS pnl_today, "
            "COUNT(*) FILTER (WHERE status='closed' AND COALESCE(closed_at, created_at) >= %s) AS closed_today "
            "FROM runs_log WHERE mode='live' AND bot_id IS NULL",
            (today, today)) or {}
        return {"pnlToday": round(float(row.get("pnl_today") or 0.0), 2),
                "closedToday": int(row.get("closed_today") or 0),
                "pnlAll": round(float(row.get("pnl_all") or 0.0), 2),
                "closedAll": int(row.get("closed_all") or 0)}
    except Exception:  # noqa: BLE001
        return {"pnlToday": 0.0, "closedToday": 0, "pnlAll": 0.0, "closedAll": 0}


def pm_tasks_report_stats() -> dict:
    """Completed-tasks rollup: done total + done in the last 24h + open count."""
    try:
        cutoff = (datetime.now(timezone.utc) - _timedelta(hours=24)).isoformat()
        row = fetch_one(
            "SELECT COUNT(*) FILTER (WHERE status='done') AS done_total, "
            "COUNT(*) FILTER (WHERE status='done' AND COALESCE(updated_at, created_at) >= %s) AS done_recent, "
            "COUNT(*) FILTER (WHERE status <> 'done') AS open_ct, COUNT(*) AS total "
            "FROM pm_tasks", (cutoff,)) or {}
        return {"doneTotal": int(row.get("done_total") or 0), "doneRecent": int(row.get("done_recent") or 0),
                "open": int(row.get("open_ct") or 0), "total": int(row.get("total") or 0)}
    except Exception:  # noqa: BLE001
        return {"doneTotal": 0, "doneRecent": 0, "open": 0, "total": 0}


def users_report_stats() -> dict:
    """Users rollup: total + demo testers + new in the last 24h."""
    try:
        cutoff = (datetime.now(timezone.utc) - _timedelta(hours=24)).isoformat()
        row = fetch_one(
            "SELECT COUNT(*) AS total, "
            "COUNT(*) FILTER (WHERE COALESCE(is_demo, FALSE)) AS demo, "
            "COUNT(*) FILTER (WHERE created_at >= %s) AS new_24h FROM users", (cutoff,)) or {}
        return {"total": int(row.get("total") or 0), "demo": int(row.get("demo") or 0),
                "new24h": int(row.get("new_24h") or 0)}
    except Exception:  # noqa: BLE001
        return {"total": 0, "demo": 0, "new24h": 0}


def _il_day_start_iso() -> str:
    """UTC ISO timestamp of the most recent Israel (Asia/Jerusalem) midnight.

    The single "today" boundary for the hourly digest so a product day rolls over at
    Israel midnight, not UTC midnight. All the ``*_report_stats`` today-filters compare
    UTC-ISO timestamps against this value (both sides are UTC ISO 8601, so a plain string
    compare is a correct chronological compare)."""
    midnight_il = _il_now().replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_il.astimezone(timezone.utc).isoformat()


def live_realmoney_report_stats() -> dict:
    """GENUINE real-money LIVE rollup for the hourly digest — the HONEST live figure.

    This exists to fix the "$0 P&L but 87 trades" digest bug. The old report paired
    ``live_realized_stats``'s *all-time* trade count with *today*'s P&L (mislabeling
    all-time trades as "closed today"), AND ``live_realized_stats`` counts EVERY
    mode='live' order — including testnet/paper exchange orders (environment='testnet'
    is the default for connected keys), so fake-money practice trades were being
    reported as real-money LIVE activity.

    Here we count ONLY orders logged with environment='live' (real money on a
    production exchange). Testnet orders are excluded. Both P&L *and* trade count are
    reported for TODAY (Israel day) and all-time separately, so the digest never again
    pairs today's P&L with an all-time count. Cost basis (moving average per symbol)
    replays from the first real-money order so sells are priced correctly.

    While no real-money trading happens (e.g. AutoPilot live gate off, everyone on
    testnet) this honestly reads today=$0 / todayTrades=0 — say 0, don't mislead."""
    day_start = _il_day_start_iso()
    since = _get_singleton("live_stats_since", None)
    try:
        acts = list_activity(limit=5000, mode="live", username=None)
    except Exception:
        acts = []
    # Real money ONLY: environment='live'. Testnet/paper exchange orders are excluded.
    orders = [a for a in acts
              if a.get("kind") == "order" and str(a.get("environment") or "").lower() == "live"]
    orders.reverse()  # oldest→newest so the cost basis builds up
    from collections import defaultdict
    qty_pool: dict = defaultdict(float)   # remaining qty held from logged buys
    cost_pool: dict = defaultdict(float)  # remaining cost basis for that qty
    total = today = 0.0
    trades_all = trades_today = 0
    for a in orders:
        side = (a.get("side") or "").lower()
        base = str(a.get("symbol") or "").split("/")[0].upper()
        if not base:
            continue
        qty = float(a.get("qty") or 0)
        cost = float(a.get("cost") or 0)
        if side == "buy":
            qty_pool[base] += qty
            cost_pool[base] += cost
        elif side == "sell":
            held = qty_pool[base]
            if held <= 0 or qty <= 0:
                continue  # no cost basis on record → can't price, skip (never a fake loss)
            sold = qty if qty <= held else held
            avg = cost_pool[base] / held if held else 0.0
            ppu = (cost / qty) if (qty and cost > 0) else avg
            realized = (ppu - avg) * sold
            qty_pool[base] -= sold
            cost_pool[base] -= avg * sold
            ts = str(a.get("ts") or "")
            if since and ts < since:
                continue  # before the "start fresh" baseline → don't count
            total += realized; trades_all += 1
            if ts >= day_start:
                today += realized; trades_today += 1
    return {"today": round(today, 2), "todayTrades": trades_today,
            "total": round(total, 2), "trades": trades_all}


def demo_realized_report_stats() -> dict:
    """Demo/paper realized-P&L rollup for the digest, Israel-day-bounded.

    Mirrors ``demo_pnl_stats`` but reports today's P&L AND today's closed-trade count
    together (the old digest paired today's P&L with the all-time trade count), and
    rolls the day at Israel midnight. Aggregate across all testers (admin scope)."""
    day_start = _il_day_start_iso()
    total = today = 0.0
    trades_all = trades_today = 0
    try:
        with get_conn() as conn:
            rows = conn.execute("SELECT data FROM paper_positions WHERE status <> 'open'").fetchall()
    except Exception:
        rows = []
    for r in rows:
        data = r.get("data") or {}
        pnl = data.get("realizedPnl")
        if pnl is None:
            pnl = _pnl_of(data)
        if pnl is None:
            continue
        pnl = float(pnl); total += pnl; trades_all += 1
        ca = str(data.get("closedAt") or "")
        if ca and ca >= day_start:
            today += pnl; trades_today += 1
    return {"today": round(today, 2), "todayTrades": trades_today,
            "total": round(total, 2), "trades": trades_all}


def open_positions_split() -> dict:
    """Open positions split live vs demo for the digest. Demo = open paper_positions;
    Live = open real-money runs (runs_log mode='live', status='open')."""
    demo = count_open_positions(is_admin=True)
    try:
        row = fetch_one("SELECT COUNT(*) AS n FROM runs_log WHERE status='open' AND mode='live'") or {}
        live = int(row.get("n") or 0)
    except Exception:  # noqa: BLE001
        live = 0
    return {"demo": int(demo), "live": live, "total": int(demo) + live}


def users_activity_report_stats() -> dict:
    """Users rollup for the digest, Israel-day-bounded: total registered, demo testers,
    signups today, active today (distinct users seen), + new in the last rolling 24h."""
    day_start = _il_day_start_iso()
    cutoff24 = (datetime.now(timezone.utc) - _timedelta(hours=24)).isoformat()
    try:
        u = fetch_one(
            "SELECT COUNT(*) AS total, "
            "COUNT(*) FILTER (WHERE COALESCE(is_demo, FALSE)) AS demo, "
            "COUNT(*) FILTER (WHERE created_at >= %s) AS signups_today, "
            "COUNT(*) FILTER (WHERE created_at >= %s) AS new_24h FROM users",
            (day_start, cutoff24)) or {}
    except Exception:  # noqa: BLE001
        u = {}
    try:
        a = fetch_one(
            "SELECT COUNT(DISTINCT username) AS n FROM auth_sessions "
            "WHERE COALESCE(last_seen, created_at) >= %s", (day_start,)) or {}
        active_today = int(a.get("n") or 0)
    except Exception:  # noqa: BLE001
        active_today = 0
    return {"total": int(u.get("total") or 0), "demo": int(u.get("demo") or 0),
            "signupsToday": int(u.get("signups_today") or 0),
            "new24h": int(u.get("new_24h") or 0), "activeToday": active_today}


def set_live_stats_baseline() -> str:
    """Mark "now" as the start for live realized-P&L stats (non-destructive —
    older orders stay in the log but no longer count toward the dashboard card)."""
    ts = now_iso()
    _set_singleton("live_stats_since", ts)
    return ts


def _value_snap_key(username: Optional[str], env: str) -> Optional[str]:
    """Snapshot key for the per-(user, env) account-value history.

    Per-user keying is what fixes the cross-user "$500" bleed: each user/env keeps
    its OWN {date: {open, close}} map. The legacy GLOBAL ``"value_snapshots"`` key
    (one row shared by everyone) is deliberately NOT reused here, so its polluted
    data can never seed a per-user baseline — it is simply left inert. ``None`` is
    returned only when no user is supplied (legacy/global), which the live routes
    no longer do.
    """
    env = (env or "live").strip().lower()
    if env not in ("live", "demo"):
        env = "live"
    return f"value_snapshots:{env}:{username}" if username else "value_snapshots"


def record_and_compute_value_pnl(current_value: float, tz_offset_min: int = 0,
                                 username: Optional[str] = None, env: str = "live",
                                 deposit_events: Optional[list] = None,
                                 cost_basis: Optional[float] = None) -> dict:
    """Record today's total account value and return its change over today /
    this month / this year, measured on ISRAEL-time day boundaries.

    Profit "today" = current total funds − total funds at the start of the Israel
    day (i.e. the prior day's closing value). One {open, close} snapshot is kept
    per Israel date, so this captures real account growth (incl. unrealised moves),
    not just realised trades — matching how a brokerage shows a day's gain.

    The day key is Asia/Jerusalem (see :func:`_il_now`) for both live and demo.
    The legacy ``tz_offset_min`` argument — the viewer's browser offset — is kept
    for call-site compatibility but no longer affects the boundary.

    Scoped per (``username``, ``env``): every signed-in user has an independent
    baseline for their live and demo equity. See :func:`_value_snap_key`.

    Deposit-aware (``deposit_events``): an optional list of
    ``{"ts": epoch_ms, "amount": usd_signed}`` cash-flow events (+deposit /
    −withdrawal), valued in USD. It makes the baseline honest about cash moves:

      • First period we've ever seen (no prior-day close) → the baseline is the
        user's NET DEPOSITS (cost basis) instead of the day's first read, so a
        fresh deposit shows the real gain (value − net deposits), not a flat $0.
      • When a prior-day close DOES exist → today's net deposit/withdrawal is
        subtracted from the change, so moving cash in or out never registers as
        profit ("a deposit must never count as profit").

    Demo callers pass nothing → ``deposit_events`` is None and behaviour is
    identical to before (no exchange cash-flow concept for paper money).

    User-set ``cost_basis`` (deposited capital, per (user, env); see
    :func:`get_cost_basis`): when there's no prior-day close to anchor to, a
    cost basis the user has set takes priority over the auto-fetched Binance net
    deposits for the first-day baseline — so a manually entered $250 deposit
    sitting at $271 reads +$21 / +8.4% immediately. Priority order in
    :func:`_baseline` is: prior-day close → user cost basis (>0) → Binance net
    deposits → today's first open.
    """
    local = _il_now()
    d_today = local.date().isoformat()
    month_start = local.replace(day=1).date().isoformat()
    year_start = local.replace(month=1, day=1).date().isoformat()

    key = _value_snap_key(username, env)
    snaps = _get_singleton(key, {}) or {}
    if not isinstance(snaps, dict):
        snaps = {}
    cur = float(current_value or 0)
    rec = snaps.get(d_today)
    if isinstance(rec, dict):
        rec["close"] = cur            # update today's running close
    else:
        snaps[d_today] = {"open": cur, "close": cur}
    if len(snaps) > 400:              # keep ~13 months of daily points
        for k in sorted(snaps.keys())[:-400]:
            snaps.pop(k, None)
    _set_singleton(key, snaps)

    dates = sorted(snaps.keys())

    def _close_before(boundary: str):
        prior = [d for d in dates if d < boundary]
        return snaps[prior[-1]].get("close") if prior else None

    def _first_open_from(boundary: str):
        on_after = [d for d in dates if d >= boundary]
        return snaps[on_after[0]].get("open") if on_after else None

    # ── Net cash-flow (deposits − withdrawals) bucketed on the SAME Israel
    # boundaries as the equity snapshots, so deposit exclusion lines up by day. ──
    events = [e for e in (deposit_events or []) if isinstance(e, dict)]
    have_flows = bool(events)

    def _midnight(dt) -> float:
        return dt.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000.0

    def _flow_since(boundary_dt) -> float:
        if not events:
            return 0.0
        b = _midnight(boundary_dt)
        return sum(
            float(e.get("amount") or 0.0)
            for e in events
            if e.get("ts") is not None and float(e.get("ts") or 0.0) >= b
        )

    net_deposits_total = round(sum(float(e.get("amount") or 0.0) for e in events), 2) if have_flows else None
    flow_today = _flow_since(local)
    flow_month = _flow_since(local.replace(day=1))
    flow_year = _flow_since(local.replace(month=1, day=1))

    today_open = snaps[d_today].get("open")

    def _baseline(prior_close, first_open_boundary: str, flow_in_period: float):
        """Pick the baseline B and the amount to net out of the change.

        prior_close present → B = prior close, net out cash moved IN this period.
        prior_close absent  → first period ever: B = user-set cost basis (>0) if
        set, ELSE net deposits (cost basis, already includes the move) so we net
        out nothing; else fall back to the period's first open as before. A set
        cost basis beats the Binance auto for that first-day baseline."""
        if prior_close is not None:
            return float(prior_close), float(flow_in_period)
        if cost_basis is not None and cost_basis > 0:
            return float(cost_basis), 0.0
        if net_deposits_total is not None and net_deposits_total > 0:
            return float(net_deposits_total), 0.0
        fo = _first_open_from(first_open_boundary)
        return (float(fo) if fo is not None else None), 0.0

    base_today, sub_today = _baseline(_close_before(d_today), d_today, flow_today)
    if base_today is None:
        base_today, sub_today = float(today_open), 0.0   # always have a today open
    base_month, sub_month = _baseline(_close_before(month_start), month_start, flow_month)
    base_year, sub_year = _baseline(_close_before(year_start), year_start, flow_year)

    def _delta(b, sub):
        return round(cur - float(b) - float(sub), 2) if b is not None else None

    return {"today": _delta(base_today, sub_today),
            "month": _delta(base_month, sub_month),
            "year": _delta(base_year, sub_year),
            "dayStart": (round(float(base_today), 2) if base_today is not None else None),
            "netDeposits": net_deposits_total}


def set_day_open(value: float, tz_offset_min: int = 0,
                 username: Optional[str] = None, env: str = "live") -> dict:
    """Anchor the local day's opening total funds so "profit today" = current −
    this value. Lets the user set today's starting capital when no automatic
    start-of-day snapshot exists yet (e.g. the first day this is enabled).

    Scoped per (``username``, ``env``) — same per-user keying as
    :func:`record_and_compute_value_pnl`, so one user's anchor never moves
    another's baseline. The day key is Israel time (see :func:`_il_now`), matching
    record_and_compute_value_pnl so the anchor lands on the same date."""
    local = _il_now()
    d_today = local.date().isoformat()
    key = _value_snap_key(username, env)
    snaps = _get_singleton(key, {}) or {}
    if not isinstance(snaps, dict):
        snaps = {}
    v = float(value or 0)
    rec = snaps.get(d_today)
    if isinstance(rec, dict):
        rec["open"] = v
    else:
        snaps[d_today] = {"open": v, "close": v}
    _set_singleton(key, snaps)
    return {"ok": True, "date": d_today, "open": round(v, 2)}


def _cost_basis_key(username: Optional[str], env: str) -> Optional[str]:
    """Singleton key for a user's manually-set "deposited capital" (cost basis),
    scoped per (user, env ∈ {live, demo}) — same per-user keying discipline as
    :func:`_value_snap_key`, so one user's deposited-capital figure never seeds
    another's baseline. ``None`` when no user is supplied (no global cost basis)."""
    env = (env or "live").strip().lower()
    if env not in ("live", "demo"):
        env = "live"
    return f"cost_basis:{env}:{username}" if username else None


def get_cost_basis(username: Optional[str], env: str = "live") -> Optional[float]:
    """The user's set deposited capital for this env, or ``None`` if unset/≤0.

    Used as a first-day baseline in :func:`record_and_compute_value_pnl` (live)
    and as the demo-% denominator in the dashboard-live card."""
    key = _cost_basis_key(username, env)
    if not key:
        return None
    v = _get_singleton(key, None)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 2) if f > 0 else None


def set_cost_basis(username: Optional[str], env: str, value: float) -> dict:
    """Set (or clear, with ``value`` ≤ 0) the user's deposited capital for this
    env. Per-user only — stored under :func:`_cost_basis_key`."""
    key = _cost_basis_key(username, env)
    if not key:
        return {"ok": False, "costBasis": None}
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        v = 0.0
    if v > 0:
        _set_singleton(key, round(v, 2))
        return {"ok": True, "costBasis": round(v, 2)}
    _set_singleton(key, None)            # clear
    return {"ok": True, "costBasis": None}


# ── Layout / location prefs ──────────────────────────────────────────────────
# The layout editor persists WHICH buttons/tiles show + their order per screen,
# at three scopes (see the layout_prefs migration). Resolution at render is
# user → role → default → the code's built-in order. The frontend applies the
# arrangement AND force-shows any safety-locked control regardless of hidden[],
# so this table can never suppress a money action or disclosure.

def _valid_layout_scope(scope: str) -> bool:
    if scope in ("default",):
        return True
    return scope.startswith("role:") or scope.startswith("user:")


def get_layout_pref(scope: str, screen_key: str) -> Optional[dict[str, Any]]:
    """One stored arrangement row for an exact (scope, screen) — or None."""
    return fetch_one(
        "SELECT scope, screen_key, arrangement, updated_by, updated_at "
        "FROM layout_prefs WHERE scope = %s AND screen_key = %s",
        (scope, screen_key),
    )


def resolve_layout(username: str, role: Optional[str], screen_key: str) -> "tuple[Optional[dict[str, Any]], str]":
    """Resolve the arrangement for a user+screen: user override → role default →
    global default → None (code order). Returns (arrangement | None, source)."""
    scopes = [f"user:{username}"]
    if role:
        scopes.append(f"role:{role}")
    scopes.append("default")
    for scope in scopes:
        row = get_layout_pref(scope, screen_key)
        if row and isinstance(row.get("arrangement"), dict) and row["arrangement"]:
            src = "user" if scope.startswith("user:") else ("role" if scope.startswith("role:") else "default")
            return row["arrangement"], src
    return None, "code"


def upsert_layout_pref(scope: str, screen_key: str, arrangement: dict, updated_by: str) -> dict[str, Any]:
    """Insert/replace the arrangement for a (scope, screen). Caller is responsible
    for authorising the scope (user may only write their own user: scope; owners
    may also write default/role: — enforced in the route)."""
    execute(
        "INSERT INTO layout_prefs (scope, screen_key, arrangement, updated_by, updated_at) "
        "VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (scope, screen_key) DO UPDATE SET "
        "arrangement = EXCLUDED.arrangement, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at",
        (scope, screen_key, Json(arrangement or {}), updated_by, now_iso()),
    )
    return {"scope": scope, "screenKey": screen_key, "arrangement": arrangement or {}}


def delete_layout_pref(scope: str, screen_key: str) -> None:
    """Remove a stored arrangement (a reset to the next scope in the chain)."""
    execute("DELETE FROM layout_prefs WHERE scope = %s AND screen_key = %s", (scope, screen_key))


# ── MANAGEMENT CONSOLE (SheraCore pattern) · P2.2 — READ-ONLY reads ───────────
def mgmt_console_data() -> dict[str, Any]:
    """One read for the owners' console shell: projects + members, team + layers.

    READ-ONLY by design. Scoped-role GRANTS have no writer here — a grant is an
    owner's click in the Team panel (later slice). The access layer comes from
    the user_access_layers VIEW so the derivation lives in exactly one place.
    """
    projects = fetch_all(
        "SELECT id, slug, name_he, name_en, description, status, owner_only, sort "
        "FROM projects ORDER BY sort, id"
    )
    scopes = fetch_all(
        "SELECT rs.project_id, rs.username, rs.scope_role, rs.granted_by, rs.created_at "
        "FROM role_scopes rs ORDER BY rs.project_id, rs.username"
    )
    team = fetch_all(
        "SELECT u.username, l.access_layer "
        "FROM users u JOIN user_access_layers l ON l.username = u.username "
        "ORDER BY l.access_layer DESC, u.username"
    )
    by_project: dict[int, list[dict[str, Any]]] = {}
    by_user: dict[str, list[dict[str, Any]]] = {}
    for s in scopes:
        by_project.setdefault(int(s["project_id"]), []).append(
            {"username": s["username"], "scopeRole": s["scope_role"], "grantedBy": s["granted_by"]}
        )
        by_user.setdefault(str(s["username"]), []).append(
            {"projectId": int(s["project_id"]), "scopeRole": s["scope_role"]}
        )
    return {
        "projects": [
            {
                "id": int(p["id"]), "slug": p["slug"],
                "nameHe": p["name_he"], "nameEn": p["name_en"],
                "description": p["description"], "status": p["status"],
                "ownerOnly": bool(p["owner_only"]),
                "members": by_project.get(int(p["id"]), []),
            }
            for p in projects
        ],
        "team": [
            {
                "username": t["username"], "layer": t["access_layer"],
                "scopes": by_user.get(str(t["username"]), []),
            }
            for t in team
        ],
    }


def grant_role_scope(username: str, project_id: int, scope_role: str, granted_by: str) -> dict[str, Any]:
    """Scope a user to a project with a role (P2.2 mapping page). Owner action.
    Upsert: re-granting updates the role. Refuses an unknown role or a project
    that is owner-only (those belong to layer-3 owners, not scoped members)."""
    if scope_role not in ("operator", "editor", "viewer"):
        raise ValueError(f"unknown scope_role {scope_role!r}")
    row = fetch_one("SELECT owner_only FROM projects WHERE id = %s", (project_id,))
    if not row:
        raise ValueError("project not found")
    if bool(row["owner_only"]):
        raise ValueError("owner-only project: access is by owner layer, not a scope grant")
    execute(
        "INSERT INTO role_scopes (username, project_id, scope_role, granted_by, created_at) "
        "VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (username, project_id) DO UPDATE SET "
        "scope_role = EXCLUDED.scope_role, granted_by = EXCLUDED.granted_by, updated_at = %s",
        (username, project_id, scope_role, granted_by, now_iso(), now_iso()),
    )
    return {"username": username, "projectId": int(project_id), "scopeRole": scope_role, "grantedBy": granted_by}


def revoke_role_scope(username: str, project_id: int) -> None:
    execute("DELETE FROM role_scopes WHERE username = %s AND project_id = %s", (username, project_id))
