-- ============================================================================
-- Migration 024: Slice 4C — add 'queued' to webhook_log_status (pgmq no-silent-loss).
--
-- Adds a terminal SUCCESS state so 'accepted' can mean "received, enqueue not yet confirmed" and 'queued'
-- means "confirmed durable in the queue". This distinction is what makes a stale 'accepted' row (a crash
-- between the webhook_logs commit and the enqueue) cleanly detectable + recoverable.
--
-- POSTGRES ENUM RULE (why this is a STANDALONE migration): on PG12+, `ALTER TYPE ... ADD VALUE` may run in
-- a transaction, but the new value CANNOT be USED (DML / index predicate / default / CHECK) until the
-- adding transaction commits. So this migration ONLY adds the value and references it NOWHERE; migration
-- 025 (columns/index/RPC) is the first to use it. Mirrors the 003 ADD VALUE precedent (single unwrapped
-- statement — not inside begin/commit).
--
-- GATED: apply LOCAL for tests; apply LINKED (`db query --linked --file`) ONLY on explicit operator
-- approval + read-back, then record 024 in supabase_migrations.schema_migrations. NEVER `db push`.
-- ============================================================================

ALTER TYPE webhook_log_status ADD VALUE IF NOT EXISTS 'queued';
