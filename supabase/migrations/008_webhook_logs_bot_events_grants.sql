-- ============================================================================
-- 008_webhook_logs_bot_events_grants.sql
-- Sprint 3 / WB3-followup — service_role grants surfaced by the WB5 pre-build audit.
--
-- 006 granted service_role only the WORKER's tables. Two were never granted
-- because nothing wrote them in Sprint 2:
--   • webhook_logs — first written by the WB5 Edge Function (S1, HIGH, blocks WB5)
--   • bot_events   — written by the worker on bot status transitions (A1, HIGH, WB6)
-- Without these, the first write hits 42501 (permission denied). service_role
-- bypasses RLS but still requires table GRANTs (same root cause as the 006 fix).
-- ============================================================================

-- webhook_logs: Edge Function inserts accepted rows, updates status->queue_failed
-- on enqueue failure, and selects the stored row for the dedup-skip discriminator.
grant select, insert, update on public.webhook_logs to service_role;

-- bot_events: worker appends lifecycle events on bot status transitions (append-only).
grant insert on public.bot_events to service_role;

-- Refresh PostgREST so the privilege change is picked up immediately.
notify pgrst, 'reload schema';
