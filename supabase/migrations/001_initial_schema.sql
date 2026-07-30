-- ============================================================
-- PRAXIS — Initial Schema
-- Migration: 001_initial_schema.sql
-- Status: READY FOR EXECUTION
-- Last Updated: 2026-05-26
-- Peer Review: SQL Schema Review 001 — Approved by Oren
-- Post-review fixes: Soft delete RLS, CHECK constraints,
--                    trigger search_path hardening
-- Changes go in: 002_*.sql and beyond
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- REQUIRED SETUP STEPS (not in this migration)
-- 1. profiles creation trigger → 002_auth_profile_trigger.sql
-- 2. pgmq trade_signals queue → Supabase dashboard
-- 3. Supabase Vault → Supabase dashboard
-- 4. service_role key → Edge Functions and Worker only
-- ============================================================


-- ============================================================
-- ENUMS
-- ============================================================

-- Sprint 1: spot only.
-- Sprint 4 adds: ALTER TYPE account_type ADD VALUE 'futures';
CREATE TYPE account_type AS ENUM (
  'spot'
);

-- Sprint 1: buy/sell only.
-- Sprint 4 adds: long, short, flat
CREATE TYPE trade_side AS ENUM (
  'buy',
  'sell'
);

CREATE TYPE trade_status AS ENUM (
  'pending',
  'submitted',
  'filled',
  'failed',
  'cancelled',
  'unknown'
);

CREATE TYPE bot_status AS ENUM (
  'pending_setup',
  'active',
  'paused',
  'error',
  'deleted'
);

CREATE TYPE credential_status AS ENUM (
  'pending_validation',
  'valid',
  'invalid'
);

CREATE TYPE webhook_log_status AS ENUM (
  'accepted',
  'rejected'
);

CREATE TYPE actor_type AS ENUM (
  'user',
  'system',
  'worker'
);

CREATE TYPE reconciliation_status AS ENUM (
  'pending',
  'resolved',
  'failed'
);

CREATE TYPE reconciliation_resolution AS ENUM (
  'filled',
  'cancelled',
  'unknown'
);


-- ============================================================
-- EXCHANGES
-- System table — seeded below. No user writes.
-- ============================================================

CREATE TABLE exchanges (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT NOT NULL,
  display_name            TEXT NOT NULL,
  ccxt_id                 TEXT NOT NULL,
  supported_account_types account_type[] NOT NULL DEFAULT '{spot}',
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT exchanges_name_unique    UNIQUE (name),
  CONSTRAINT exchanges_ccxt_id_unique UNIQUE (ccxt_id)
);

COMMENT ON TABLE exchanges IS
  'System registry of supported exchanges. Managed by Praxis. No user writes.';
COMMENT ON COLUMN exchanges.is_active IS
  'Set false to disable exchange without deleting. Never hard delete.
   Visibility filtered by application logic, not RLS.';


-- ============================================================
-- PROFILES
-- profiles.id = auth.users.id — single column, no user_id.
-- Rows created by Auth trigger in 002_auth_profile_trigger.sql
-- ============================================================

CREATE TABLE profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  display_name        TEXT,
  language            TEXT NOT NULL DEFAULT 'he'
                        CHECK (language IN ('he', 'en')),
  subscription_status TEXT NOT NULL DEFAULT 'trialing',
  affiliate_code      TEXT,
  referred_by         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE profiles IS
  'Product-level user data extending Supabase Auth. profiles.id = auth.users.id.
   Rows created automatically by Auth trigger — see 002_auth_profile_trigger.sql.';
COMMENT ON COLUMN profiles.subscription_status IS
  'Placeholder — trialing by default. Billing logic activates Sprint 5.';
COMMENT ON COLUMN profiles.affiliate_code IS
  'Placeholder — nullable. Affiliate system activates Sprint 3-4.';
COMMENT ON COLUMN profiles.referred_by IS
  'Placeholder — nullable. Stores affiliate code used at signup.';


-- ============================================================
-- USER EXCHANGE CREDENTIALS
-- Vault pointer only — never raw API key.
-- ============================================================

CREATE TABLE user_exchange_credentials (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  exchange_id           UUID NOT NULL REFERENCES exchanges(id) ON DELETE RESTRICT,
  vault_secret_id       TEXT NOT NULL,
  label                 TEXT NOT NULL DEFAULT 'default',
  status                credential_status NOT NULL DEFAULT 'pending_validation',
  last_validated_at     TIMESTAMPTZ,
  permissions_confirmed JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT credentials_user_exchange_label_unique
    UNIQUE (user_id, exchange_id, label)
);

COMMENT ON TABLE user_exchange_credentials IS
  'Links user to exchange account. vault_secret_id is a Supabase Vault pointer only.
   Raw API key never stored here.';
COMMENT ON COLUMN user_exchange_credentials.vault_secret_id IS
  'Supabase Vault reference stored as TEXT. Vault returns a text identifier, not always UUID.
   Raw API key never stored in this table.';
COMMENT ON COLUMN user_exchange_credentials.permissions_confirmed IS
  'Confirmed permissions: can_trade, can_read. Never can_withdraw.';


-- ============================================================
-- BOTS
-- One bot = one webhook, one trading pair, one credential.
-- ============================================================

CREATE TABLE bots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  credential_id        UUID REFERENCES user_exchange_credentials(id) ON DELETE RESTRICT,
  name                 TEXT NOT NULL,
  trading_pair         TEXT NOT NULL,
  account_type         account_type NOT NULL DEFAULT 'spot',
  webhook_secret_hash  TEXT NOT NULL,
  status               bot_status NOT NULL DEFAULT 'pending_setup',
  consecutive_failures INT NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at           TIMESTAMPTZ
);

COMMENT ON TABLE bots IS
  'Trading bot configuration. One webhook, one pair, one credential per bot.';
COMMENT ON COLUMN bots.webhook_secret_hash IS
  'bcrypt hash of webhook secret. Raw secret shown once at creation, never stored.
   Uniqueness enforced by generation logic (crypto.randomBytes(32)).';
COMMENT ON COLUMN bots.consecutive_failures IS
  'Circuit breaker counter. Application sets status=error when >= 5. Manual reset only.';
COMMENT ON COLUMN bots.trading_pair IS
  'Exchange trading pair. Normalization (e.g. BTCUSDT format) is adapter responsibility before insert.';
COMMENT ON COLUMN bots.account_type IS
  'Sprint 1: spot only. futures added via ALTER TYPE in Sprint 4.';


-- ============================================================
-- BOT EVENTS
-- Append-only. Writes: service role only.
-- ============================================================

CREATE TABLE bot_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id     UUID NOT NULL REFERENCES bots(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor      actor_type NOT NULL DEFAULT 'system',
  metadata   JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE bot_events IS
  'Append-only lifecycle audit for bots. Never updated or deleted.
   Writes by service role only.';


-- ============================================================
-- WEBHOOK LOGS
-- Write-once. Writes: Edge Function service role only.
-- ============================================================

CREATE TABLE webhook_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id           UUID NOT NULL REFERENCES bots(id) ON DELETE RESTRICT,
  signal_id        TEXT NOT NULL,
  raw_payload      JSONB NOT NULL,
  source_ip        TEXT,
  status           webhook_log_status NOT NULL,
  rejection_reason TEXT,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT webhook_logs_bot_signal_unique UNIQUE (bot_id, signal_id)
);

COMMENT ON TABLE webhook_logs IS
  'Raw signal ingestion log. Write-once, never mutated.
   Writes by Edge Function service role only.';
COMMENT ON COLUMN webhook_logs.signal_id IS
  'Idempotency key scoped to bot. UNIQUE(bot_id, signal_id) prevents duplicate processing.';
COMMENT ON COLUMN webhook_logs.raw_payload IS
  'Full TradingView payload. Safe to store — TradingView payloads never contain secrets.
   Alert templates must never include API keys or credentials (enforced by onboarding).';


-- ============================================================
-- TRADES
-- Created at pending before exchange call.
-- Writes: worker service role only.
-- ============================================================

CREATE TABLE trades (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id             UUID NOT NULL REFERENCES bots(id) ON DELETE RESTRICT,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  signal_id          TEXT NOT NULL,
  client_order_id    TEXT NOT NULL,
  side               trade_side NOT NULL,
  trading_pair       TEXT NOT NULL,
  quantity           NUMERIC(30, 18) NOT NULL CHECK (quantity > 0),
  price_at_signal    NUMERIC(30, 18),
  price_at_execution NUMERIC(30, 18),
  exchange_order_id  TEXT,
  status             trade_status NOT NULL DEFAULT 'pending',
  error_reason       TEXT,
  last_attempt_at    TIMESTAMPTZ,
  filled_at          TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,

  CONSTRAINT trades_bot_signal_unique   UNIQUE (bot_id, signal_id),
  CONSTRAINT trades_client_order_unique UNIQUE (client_order_id)
);

COMMENT ON TABLE trades IS
  'Every trade attempt — intent, execution state, and result. Never hard deleted.
   Writes by worker service role only.';
COMMENT ON COLUMN trades.user_id IS
  'Denormalized from bots for RLS performance. Set at insert by worker, never updated.';
COMMENT ON COLUMN trades.signal_id IS
  'Idempotency key scoped to bot. Matches webhook_logs.signal_id for the same signal.';
COMMENT ON COLUMN trades.client_order_id IS
  'Praxis-generated. Format: PRX_<nanoid(10)>. Created before exchange call. Globally unique.';
COMMENT ON COLUMN trades.quantity IS
  'NUMERIC(30,18) for crypto precision. Always rounded DOWN before insertion — never UP.
   CHECK (quantity > 0) enforced at DB level.';


-- ============================================================
-- AUDIT LOGS
-- Immutable. No foreign keys — intentional.
-- Writes: service role only.
-- ============================================================

CREATE TABLE audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  event_type   TEXT NOT NULL,
  before_state JSONB NOT NULL DEFAULT '{}',
  after_state  JSONB NOT NULL DEFAULT '{}',
  actor_type   actor_type NOT NULL DEFAULT 'system',
  actor_id     UUID,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE audit_logs IS
  'Immutable compliance trail. Append-only. No foreign keys — audit survives entity deletion.
   Writes by service role only. No user writes ever.
   Known limitation: no DB constraint enforces entity_type matches entity_id.
   Integrity guaranteed by application layer — worker must always set both fields correctly.';
COMMENT ON COLUMN audit_logs.before_state IS
  'Status fields and metadata only. Never raw payloads, exchange responses, or secrets.';
COMMENT ON COLUMN audit_logs.after_state IS
  'Status fields and metadata only. Never raw payloads, exchange responses, or secrets.';


-- ============================================================
-- TRADES DLQ
-- Terminal. Writes: worker service role only.
-- ============================================================

CREATE TABLE trades_dlq (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id       UUID NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  bot_id         UUID NOT NULL REFERENCES bots(id) ON DELETE RESTRICT,
  signal_id      TEXT NOT NULL,
  raw_payload    JSONB NOT NULL,
  failure_reason TEXT NOT NULL,
  retry_count    INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trades_dlq_trade_unique UNIQUE (trade_id)
);

COMMENT ON TABLE trades_dlq IS
  'Dead letter queue. Manual triage only. Sentry fires on INSERT.
   Writes by worker service role only.';


-- ============================================================
-- RECONCILIATION JOBS
-- Boot-time crash recovery. Writes: worker service role only.
-- ============================================================

CREATE TABLE reconciliation_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id    UUID NOT NULL REFERENCES trades(id) ON DELETE RESTRICT,
  status      reconciliation_status NOT NULL DEFAULT 'pending',
  resolution  reconciliation_resolution,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,

  CONSTRAINT reconciliation_trade_unique UNIQUE (trade_id)
);

COMMENT ON TABLE reconciliation_jobs IS
  'Recovery jobs for trades stuck in pending or unknown after crash or timeout.
   Writes by worker service role only. No user access.';


-- ============================================================
-- INDEXES
-- ============================================================

-- exchanges
CREATE INDEX idx_exchanges_is_active       ON exchanges (is_active);

-- user_exchange_credentials
CREATE INDEX idx_credentials_user_id       ON user_exchange_credentials (user_id);
CREATE INDEX idx_credentials_user_exchange ON user_exchange_credentials (user_id, exchange_id);

-- bots
CREATE INDEX idx_bots_user_id              ON bots (user_id);
CREATE INDEX idx_bots_credential_id        ON bots (credential_id);
CREATE INDEX idx_bots_webhook_hash         ON bots (webhook_secret_hash);
CREATE INDEX idx_bots_status               ON bots (status);

-- bot_events
CREATE INDEX idx_bot_events_bot_id         ON bot_events (bot_id);
CREATE INDEX idx_bot_events_created_at     ON bot_events (created_at);

-- webhook_logs
CREATE INDEX idx_webhook_logs_bot_id       ON webhook_logs (bot_id);
CREATE INDEX idx_webhook_logs_received     ON webhook_logs (received_at);

-- trades
CREATE INDEX idx_trades_bot_id             ON trades (bot_id);
CREATE INDEX idx_trades_user_id            ON trades (user_id);
CREATE INDEX idx_trades_status             ON trades (status);
CREATE INDEX idx_trades_created_at         ON trades (created_at);
CREATE INDEX idx_trades_bot_id_status      ON trades (bot_id, status); -- composite: approved in peer review

-- audit_logs
CREATE INDEX idx_audit_entity              ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_actor_id            ON audit_logs (actor_id);
CREATE INDEX idx_audit_created_at          ON audit_logs (created_at);

-- trades_dlq
CREATE INDEX idx_dlq_bot_id                ON trades_dlq (bot_id);
CREATE INDEX idx_dlq_created_at            ON trades_dlq (created_at);

-- reconciliation_jobs
CREATE INDEX idx_recon_status              ON reconciliation_jobs (status);
CREATE INDEX idx_recon_created_at          ON reconciliation_jobs (created_at);


-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_credentials_updated_at
  BEFORE UPDATE ON user_exchange_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bots_updated_at
  BEFORE UPDATE ON bots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_trades_updated_at
  BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_recon_updated_at
  BEFORE UPDATE ON reconciliation_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchanges                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_exchange_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades_dlq                ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_jobs       ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY profiles_select
  ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY profiles_update
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- exchanges
CREATE POLICY exchanges_read
  ON exchanges FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- user_exchange_credentials
CREATE POLICY credentials_select
  ON user_exchange_credentials FOR SELECT
  USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY credentials_insert
  ON user_exchange_credentials FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY credentials_update
  ON user_exchange_credentials FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY credentials_delete
  ON user_exchange_credentials FOR DELETE
  USING (user_id = auth.uid());

-- bots
CREATE POLICY bots_select
  ON bots FOR SELECT
  USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY bots_insert
  ON bots FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY bots_update
  ON bots FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY bots_delete
  ON bots FOR DELETE
  USING (user_id = auth.uid());

-- bot_events
CREATE POLICY bot_events_select
  ON bot_events FOR SELECT
  USING (
    bot_id IN (
      SELECT id FROM bots WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY bot_events_no_user_insert
  ON bot_events FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY bot_events_no_user_update
  ON bot_events FOR UPDATE
  USING (FALSE);

CREATE POLICY bot_events_no_user_delete
  ON bot_events FOR DELETE
  USING (FALSE);

-- webhook_logs
CREATE POLICY webhook_logs_select
  ON webhook_logs FOR SELECT
  USING (
    bot_id IN (
      SELECT id FROM bots WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY webhook_logs_no_user_insert
  ON webhook_logs FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY webhook_logs_no_user_update
  ON webhook_logs FOR UPDATE
  USING (FALSE);

CREATE POLICY webhook_logs_no_user_delete
  ON webhook_logs FOR DELETE
  USING (FALSE);

-- trades
CREATE POLICY trades_select
  ON trades FOR SELECT
  USING (user_id = auth.uid() AND deleted_at IS NULL);

CREATE POLICY trades_no_user_insert
  ON trades FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY trades_no_user_update
  ON trades FOR UPDATE
  USING (FALSE);

CREATE POLICY trades_no_user_delete
  ON trades FOR DELETE
  USING (FALSE);

-- audit_logs
CREATE POLICY audit_logs_select
  ON audit_logs FOR SELECT
  USING (
    actor_id = auth.uid()
    OR entity_id IN (
      SELECT id FROM bots WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
    OR entity_id IN (
      SELECT id FROM trades WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY audit_logs_no_user_insert
  ON audit_logs FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY audit_logs_no_user_update
  ON audit_logs FOR UPDATE
  USING (FALSE);

CREATE POLICY audit_logs_no_user_delete
  ON audit_logs FOR DELETE
  USING (FALSE);

-- trades_dlq
CREATE POLICY trades_dlq_select
  ON trades_dlq FOR SELECT
  USING (
    trade_id IN (
      SELECT id FROM trades WHERE user_id = auth.uid()
      AND deleted_at IS NULL
    )
  );

CREATE POLICY trades_dlq_no_user_insert
  ON trades_dlq FOR INSERT
  WITH CHECK (FALSE);

CREATE POLICY trades_dlq_no_user_update
  ON trades_dlq FOR UPDATE
  USING (FALSE);

CREATE POLICY trades_dlq_no_user_delete
  ON trades_dlq FOR DELETE
  USING (FALSE);

-- reconciliation_jobs
CREATE POLICY recon_no_user_access
  ON reconciliation_jobs FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);


-- ============================================================
-- SEED DATA — EXCHANGES
-- Binance active. All others inactive — enabled per sprint.
-- ============================================================

INSERT INTO exchanges (name, display_name, ccxt_id, supported_account_types, is_active)
VALUES
  ('binance',  'Binance',  'binance',  '{spot}', TRUE),
  ('bybit',    'Bybit',    'bybit',    '{spot}', FALSE),
  ('okx',      'OKX',      'okx',      '{spot}', FALSE),
  ('coinbase', 'Coinbase', 'coinbase', '{spot}', FALSE),
  ('kraken',   'Kraken',   'kraken',   '{spot}', FALSE)
ON CONFLICT (name) DO NOTHING;
