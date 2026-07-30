-- ============================================================
-- Migration: 006_worker_grants.sql
-- Purpose:   Grant service_role access to all tables the Worker
--            reads or writes at runtime.
--
-- Why needed:
--   In Supabase, service_role has BYPASSRLS (skips Row Level
--   Security) but is NOT a PostgreSQL SUPERUSER.  Without
--   explicit GRANT, PostgreSQL raises 42501 (insufficient_privilege)
--   before RLS is even evaluated.
--
--   Migration 001 creates the tables but never grants service_role,
--   so every Worker query against a guarded table fails at startup
--   (boot_reconciliation_query_error / 42501).
--
-- Tables and required operations (derived from worker/src/index.ts):
--   trades                 SELECT, INSERT, UPDATE
--   bots                   SELECT, UPDATE
--   user_exchange_credentials SELECT, UPDATE
--   audit_logs             INSERT
--   trades_dlq             INSERT
--   reconciliation_jobs    INSERT, UPDATE  (upsert pattern)
--
-- Note: pgmq_read / pgmq_delete are functions, not tables;
--       they will be granted in migration 007 (Sprint 3).
--       get_decrypted_secret / delete_vault_secret already
--       granted to service_role in migrations 004 and 005.
-- ============================================================

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.trades
  TO service_role;

GRANT SELECT, UPDATE
  ON TABLE public.bots
  TO service_role;

GRANT SELECT, UPDATE
  ON TABLE public.user_exchange_credentials
  TO service_role;

GRANT INSERT
  ON TABLE public.audit_logs
  TO service_role;

GRANT INSERT
  ON TABLE public.trades_dlq
  TO service_role;

GRANT INSERT, UPDATE
  ON TABLE public.reconciliation_jobs
  TO service_role;
