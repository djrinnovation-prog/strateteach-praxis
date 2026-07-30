-- 001_init.sql — execution-service schema (Phase 1, slice 1)
--
-- Spec: StrateTeach-Phase1-Execution-Service-Spec.md §2 (data model), §4 (gate).
--
-- Everything here is DISARMED and testnet-only:
--   * exec_state is a singleton seeded execution_armed=false, kill_switch=true,
--     environment='testnet'. Fail-closed: absence of a row means "not armed".
--   * A phase-1 CHECK constraint pins every env column to 'testnet'. mainnet is
--     blocked in code (env-guard) AND here. Both must be lifted, deliberately,
--     in the go-live migration.
--   * exec_credentials holds a VAULT REFERENCE ONLY — never key material. A
--     CHECK constraint rejects anything that is not a short vault://|kms:// ref.
--   * owner_fund and owner_approvals are OWNER-ONLY (spec §7): the execution
--     operator (Oren) sees the whole exec plane but never the owners' fund,
--     its movements, or the 3-of-3 approvals.
--
-- This slice creates state only. There is no ingress, no queue, no worker and
-- no exchange adapter yet — those are slices 2-6.

BEGIN;

-- ── exec_bots ─────────────────────────────────────────────────────────────
-- Execution policy lives HERE, in config — never in a signal payload
-- (envelope-only contract, spec §3). Quantity and symbol are derived
-- server-side from this row.
CREATE TABLE IF NOT EXISTS exec_bots (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT        NOT NULL UNIQUE,
    exchange            TEXT        NOT NULL,
    pair                TEXT        NOT NULL,
    env                 TEXT        NOT NULL DEFAULT 'testnet',
    -- Sizing + caps: server-side, fail-closed. Nothing may exceed these.
    fixed_notional      NUMERIC(18, 8) NOT NULL,
    max_order_notional  NUMERIC(18, 8) NOT NULL,
    daily_notional_cap  NUMERIC(18, 8) NOT NULL,
    max_open_positions  INTEGER     NOT NULL DEFAULT 1,
    -- Per-bot switch. Default OFF; the kill-switch flips every row to false.
    trading_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exec_bots_env_known          CHECK (env IN ('testnet', 'mainnet')),
    -- PHASE-1 GUARD: drop only in the deliberate go-live migration.
    CONSTRAINT exec_bots_phase1_testnet     CHECK (env = 'testnet'),
    CONSTRAINT exec_bots_notional_positive  CHECK (fixed_notional > 0),
    CONSTRAINT exec_bots_caps_positive      CHECK (max_order_notional > 0 AND daily_notional_cap > 0),
    CONSTRAINT exec_bots_cap_ge_order       CHECK (daily_notional_cap >= max_order_notional),
    CONSTRAINT exec_bots_order_ge_fixed     CHECK (max_order_notional >= fixed_notional),
    CONSTRAINT exec_bots_positions_positive CHECK (max_open_positions > 0)
);

COMMENT ON TABLE exec_bots IS
    'Execution-bot policy (pair/caps/env). Operator-visible. Policy is config, never signal payload.';

-- ── exec_signals ──────────────────────────────────────────────────────────
-- Inbound trade INTENT only (spec §3). No quantity, no free symbol, no key.
-- UNIQUE(bot_id, signal_id) is the dedup guarantee.
CREATE TABLE IF NOT EXISTS exec_signals (
    id            BIGSERIAL PRIMARY KEY,
    bot_id        BIGINT      NOT NULL REFERENCES exec_bots(id) ON DELETE RESTRICT,
    -- Supplied by the source. Reject the signal if absent — never synthesize it,
    -- or dedup silently stops working.
    signal_id     TEXT        NOT NULL,
    action        TEXT        NOT NULL,
    fire_time     TIMESTAMPTZ,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status        TEXT        NOT NULL DEFAULT 'accepted',
    reject_reason TEXT,
    CONSTRAINT exec_signals_dedup   UNIQUE (bot_id, signal_id),
    CONSTRAINT exec_signals_action  CHECK (action IN ('buy', 'sell')),
    CONSTRAINT exec_signals_status  CHECK (status IN (
        'accepted', 'queued', 'processed', 'duplicate', 'rejected', 'expired', 'noop_disarmed'
    ))
);

CREATE INDEX IF NOT EXISTS exec_signals_bot_received_idx ON exec_signals (bot_id, received_at DESC);

COMMENT ON TABLE exec_signals IS
    'Inbound signed trade intents (envelope-only). UNIQUE(bot_id, signal_id) = dedup. Operator-visible.';

-- ── exec_orders ───────────────────────────────────────────────────────────
-- Source of truth for execution: requested vs executed, for reconciliation.
CREATE TABLE IF NOT EXISTS exec_orders (
    id                BIGSERIAL PRIMARY KEY,
    bot_id            BIGINT      NOT NULL REFERENCES exec_bots(id) ON DELETE RESTRICT,
    signal_row_id     BIGINT      REFERENCES exec_signals(id) ON DELETE RESTRICT,
    -- Idempotency key sent to the exchange. UNIQUE = exactly-once (spec §8.1).
    client_order_id   TEXT        NOT NULL UNIQUE,
    exchange_order_id TEXT,
    env               TEXT        NOT NULL DEFAULT 'testnet',
    side              TEXT        NOT NULL,
    symbol            TEXT        NOT NULL,
    requested_qty     NUMERIC(28, 12) NOT NULL,
    requested_notional NUMERIC(18, 8) NOT NULL,
    executed_qty      NUMERIC(28, 12) NOT NULL DEFAULT 0,
    avg_fill_price    NUMERIC(28, 12),
    fills             JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status            TEXT        NOT NULL DEFAULT 'pending',
    error             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exec_orders_env_known      CHECK (env IN ('testnet', 'mainnet')),
    -- PHASE-1 GUARD: drop only in the deliberate go-live migration.
    CONSTRAINT exec_orders_phase1_testnet CHECK (env = 'testnet'),
    CONSTRAINT exec_orders_side           CHECK (side IN ('buy', 'sell')),
    CONSTRAINT exec_orders_qty_positive   CHECK (requested_qty > 0),
    CONSTRAINT exec_orders_exec_qty       CHECK (executed_qty >= 0),
    CONSTRAINT exec_orders_status         CHECK (status IN (
        'pending', 'submitted', 'partially_filled', 'filled',
        'rejected', 'cancelled', 'failed', 'noop_disarmed'
    ))
);

CREATE INDEX IF NOT EXISTS exec_orders_bot_created_idx ON exec_orders (bot_id, created_at DESC);

COMMENT ON TABLE exec_orders IS
    'Execution source of truth (requested vs executed) for reconciliation. Operator-visible.';

-- ── exec_credentials ──────────────────────────────────────────────────────
-- VAULT REFERENCE ONLY. Key material never reaches this database, this repo,
-- or any log line. The owners load keys directly into the vault; only the
-- worker resolves the ref at execution time (slice 5).
CREATE TABLE IF NOT EXISTS exec_credentials (
    id            BIGSERIAL PRIMARY KEY,
    label         TEXT        NOT NULL UNIQUE,
    exchange      TEXT        NOT NULL,
    env           TEXT        NOT NULL DEFAULT 'testnet',
    owner         TEXT        NOT NULL,
    -- e.g. 'vault://strateteach/exec/bybit-testnet' — a POINTER, not a secret.
    vault_ref     TEXT        NOT NULL,
    vault_backend TEXT        NOT NULL DEFAULT 'undecided',
    status        TEXT        NOT NULL DEFAULT 'placeholder',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rotated_at    TIMESTAMPTZ,
    CONSTRAINT exec_credentials_env_known      CHECK (env IN ('testnet', 'mainnet')),
    -- PHASE-1 GUARD: drop only in the deliberate go-live migration.
    CONSTRAINT exec_credentials_phase1_testnet CHECK (env = 'testnet'),
    CONSTRAINT exec_credentials_status         CHECK (status IN ('placeholder', 'active', 'revoked')),
    -- Structural defence against a secret ever being pasted into this column:
    -- a ref must be a short, schemed pointer. Exchange keys/secrets are longer
    -- and unschemed, so they fail this CHECK at the database.
    CONSTRAINT exec_credentials_is_reference   CHECK (
        vault_ref ~ '^(vault|kms|awskms|gcpkms)://[A-Za-z0-9/_.:-]{1,180}$'
    ),
    CONSTRAINT exec_credentials_backend        CHECK (vault_backend IN (
        'undecided', 'hashicorp_vault', 'aws_kms', 'gcp_kms', 'app_encryption'
    ))
);

COMMENT ON TABLE exec_credentials IS
    'Vault REFERENCES only (spec §6) — never key material. Operator-visible; the secret itself is not.';
COMMENT ON COLUMN exec_credentials.vault_ref IS
    'Pointer into the server-side vault (vault://... / kms://...). NEVER an API key or secret.';

-- ── exec_state ────────────────────────────────────────────────────────────
-- Singleton. The master gate + kill-switch + worker heartbeat (spec §4).
-- Fail-closed by construction: armed defaults false, kill_switch defaults
-- ENGAGED, environment is pinned to testnet, and a missing row reads as
-- "not armed" in code.
CREATE TABLE IF NOT EXISTS exec_state (
    id                 SMALLINT    PRIMARY KEY DEFAULT 1,
    execution_armed    BOOLEAN     NOT NULL DEFAULT FALSE,
    kill_switch        BOOLEAN     NOT NULL DEFAULT TRUE,
    environment        TEXT        NOT NULL DEFAULT 'testnet',
    worker_id          TEXT,
    worker_heartbeat_at TIMESTAMPTZ,
    armed_by           TEXT,
    armed_at           TIMESTAMPTZ,
    kill_switch_by     TEXT,
    kill_switch_at     TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exec_state_singleton     CHECK (id = 1),
    -- PHASE-1 GUARD: drop only in the deliberate go-live migration.
    CONSTRAINT exec_state_phase1_testnet CHECK (environment = 'testnet')
);

COMMENT ON TABLE exec_state IS
    'Singleton master gate: execution_armed=false + kill_switch engaged + testnet. Fail-closed.';

-- Seed the disarmed singleton. ON CONFLICT DO NOTHING so re-running the
-- migration can never re-arm or silently reset a deliberate owner action.
INSERT INTO exec_state (id, execution_armed, kill_switch, environment)
VALUES (1, FALSE, TRUE, 'testnet')
ON CONFLICT (id) DO NOTHING;

-- ── owner_fund ── OWNER-ONLY ──────────────────────────────────────────────
-- The owners' shared fund ledger: deposits -> ownership % -> NAV. Fully
-- separated from client money and from the demo AutoPilots. Blocked from the
-- execution operator (spec §7): he runs the machine, he does not see the
-- owners' private capital or its movements.
CREATE TABLE IF NOT EXISTS owner_fund (
    id            BIGSERIAL PRIMARY KEY,
    owner         TEXT        NOT NULL,
    entry_type    TEXT        NOT NULL,
    amount_usd    NUMERIC(18, 2) NOT NULL,
    ownership_pct NUMERIC(9, 6),
    nav_usd       NUMERIC(18, 2),
    note          TEXT,
    created_by    TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT owner_fund_entry_type CHECK (entry_type IN (
        'deposit', 'withdrawal', 'pnl', 'fee', 'adjustment'
    )),
    CONSTRAINT owner_fund_pct_range  CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100))
);

CREATE INDEX IF NOT EXISTS owner_fund_owner_created_idx ON owner_fund (owner, created_at DESC);

COMMENT ON TABLE owner_fund IS
    'OWNER-ONLY (spec §7). Owners shared-fund ledger + NAV. Blocked from the execution operator.';

-- ── owner_approvals ── OWNER-ONLY ─────────────────────────────────────────
-- 3-of-3 gate (spec §5). Nothing moves on the owners' fund without three
-- explicit approvals from three DISTINCT owners.
CREATE TABLE IF NOT EXISTS owner_approvals (
    id           BIGSERIAL PRIMARY KEY,
    request_ref  TEXT        NOT NULL UNIQUE,
    action       TEXT        NOT NULL,
    -- Intent of the request (what would be done if all 3 approve).
    payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    requested_by TEXT        NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ,
    -- The three approvals: [{"owner": "...", "at": "...", "note": "..."}, ...]
    approvals    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    status       TEXT        NOT NULL DEFAULT 'pending',
    executed_at  TIMESTAMPTZ,
    CONSTRAINT owner_approvals_status CHECK (status IN (
        'pending', 'approved', 'rejected', 'expired', 'executed'
    )),
    CONSTRAINT owner_approvals_json_shapes CHECK (
        jsonb_typeof(approvals) = 'array' AND jsonb_typeof(payload) = 'object'
    ),
    -- The 3-of-3 gate, enforced at the database and not only in code: a request
    -- cannot reach approved/executed with fewer than three approvals recorded.
    CONSTRAINT owner_approvals_three_of_three CHECK (
        status NOT IN ('approved', 'executed') OR jsonb_array_length(approvals) >= 3
    )
);

COMMENT ON TABLE owner_approvals IS
    'OWNER-ONLY (spec §7). 3-of-3 approval requests on the owners fund. Blocked from the execution operator.';

-- ── audit_log ── append-only ──────────────────────────────────────────────
-- Every action: who / what / when / before-after. Irreversible.
CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor      TEXT        NOT NULL,
    actor_role TEXT,
    action     TEXT        NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    before     JSONB,
    after      JSONB,
    meta       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT audit_log_actor_present CHECK (length(actor) > 0),
    CONSTRAINT audit_log_action_present CHECK (length(action) > 0)
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx        ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx    ON audit_log (entity, entity_id);

COMMENT ON TABLE audit_log IS
    'Append-only audit trail (spec §0.6). UPDATE/DELETE are rejected by trigger.';

-- Append-only is enforced by the database, not by convention: a bug, a stray
-- script, or a console session cannot rewrite history through this connection.
-- (A superuser can still disable the trigger — that is why the go-live plan
-- also ships off-box log shipping. Documented, not pretended away.)
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR STATEMENT EXECUTE FUNCTION audit_log_append_only();

COMMIT;
