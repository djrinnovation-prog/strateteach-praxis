-- 006_queue_held.sql — a 'held' state for the kill-switch (Phase 1, slice 6).
--
-- Spec §4: the kill-switch halts everything with one act — trading_enabled off
-- on every bot AND the queue paused, "not re-armed by itself". A paused item
-- must be distinguishable from a normally-queued one so release can restore
-- exactly what the kill-switch paused (and nothing it didn't). We add a
-- reversible 'held' status:
--
--   engage  → queued items become 'held' (claim skips them; sweeper ignores them)
--   release → 'held' items become 'queued' again (does NOT arm execution)
--
-- 'held' is deliberately NOT claimable: dequeue only ever selects 'queued'.

BEGIN;

ALTER TABLE exec_queue DROP CONSTRAINT IF EXISTS exec_queue_status;

ALTER TABLE exec_queue ADD CONSTRAINT exec_queue_status
    CHECK (status IN ('queued', 'processing', 'held', 'done', 'dead'));

COMMIT;
