-- ============================================================
-- Migration: 003_queue_failed_status.sql
-- Purpose:   Add queue_failed to webhook_log_status enum
--            Update webhook_secret_hash comment: bcrypt → HMAC-SHA256
-- Reason:    Architecture Roast [2] added queue_failed to Edge Function
--            error path: pgmq.send() failure must be recorded in webhook_logs.
--            Decision Log: bcrypt superseded by HMAC-SHA256 (2026-05-28).
-- ============================================================

-- webhook_log_status: add queue_failed
-- Note: ADD VALUE cannot run inside a transaction block in Postgres < 12.
-- Supabase runs Postgres 15+ — this is safe.
ALTER TYPE webhook_log_status ADD VALUE IF NOT EXISTS 'queue_failed';

-- Update column comment: bcrypt → HMAC-SHA256
COMMENT ON COLUMN bots.webhook_secret_hash IS
  'HMAC-SHA256 digest of webhook secret. Raw secret shown once at creation, never stored.
   Algorithm: crypto.createHmac(''sha256'', secret).digest(''hex'').
   Verified with timingSafeEqual() — constant-time, <1ms.
   Uniqueness enforced by generation logic (crypto.randomBytes(32)).
   Supersedes: bcrypt (Decision Log 2026-05-28).';
