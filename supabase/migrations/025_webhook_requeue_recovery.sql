-- ============================================================================
-- Migration 025: Slice 4C — webhook_logs requeue recovery fields, index, and claim RPC.
--
-- Adds the durable-recovery machinery for the pgmq no-silent-loss guarantee:
--   - requeue_attempts   : sweeper-owned attempt counter; >= max ⇒ exhausted (observable, never dropped).
--   - next_retry_at      : backoff lease; NULL = eligible now. Gates re-claims.
--   - last_requeue_error : SANITIZED error class/code from the last failed requeue (never message/URL/
--                          payload/secret).
--   - webhook_logs_recovery_idx : partial index over the recovery set (predicate uses only pre-existing
--                          enum values, so it is safe in the same migration as no other 'queued' use).
--   - claim_webhook_requeue(...) : atomic lease claim (FOR UPDATE SKIP LOCKED) for the worker sweeper.
--
-- MUST be applied AFTER migration 024 has committed (this migration's SET does not reference 'queued', but
-- the sweeper/webhook write 'queued', so 024 must exist first).
--
-- GATED: apply LOCAL for tests; apply LINKED (`db query --linked --file`) ONLY on explicit operator
-- approval + read-back, then record 025 in supabase_migrations.schema_migrations. NEVER `db push`.
-- ============================================================================

begin;

-- ---- Recovery columns (idempotent) -----------------------------------------
ALTER TABLE public.webhook_logs
  ADD COLUMN IF NOT EXISTS requeue_attempts   smallint    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_requeue_error text;

COMMENT ON COLUMN public.webhook_logs.requeue_attempts IS
  'Slice 4C: number of sweeper requeue attempts. >= max ⇒ exhausted (observable dead-letter; never dropped).';
COMMENT ON COLUMN public.webhook_logs.next_retry_at IS
  'Slice 4C: earliest time this row is eligible for requeue (exponential-backoff lease). NULL = eligible now.';
COMMENT ON COLUMN public.webhook_logs.last_requeue_error IS
  'Slice 4C: SANITIZED error class/code from the last failed requeue. Never a driver message, URL, payload, or secret.';

-- ---- Recovery index (predicate references only pre-existing enum values) ----
CREATE INDEX IF NOT EXISTS webhook_logs_recovery_idx
  ON public.webhook_logs (next_retry_at)
  WHERE status IN ('queue_failed', 'accepted');

-- The original comment said "write-once, never mutated"; status transitions already mutate the row.
COMMENT ON TABLE public.webhook_logs IS
  'Signal ingestion log. Status transitions (accepted->queued/queue_failed, sweeper requeue) are the only
   mutations; the payload is write-once. Writes by the Edge Function / worker service role only.';

-- ---- Atomic lease-claim for the requeue sweeper -----------------------------
-- Selects eligible rows (queue_failed, or crash-window stale 'accepted'), under the attempt cap and past
-- their backoff lease, with FOR UPDATE SKIP LOCKED so concurrent sweepers NEVER claim the same row.
-- Increments the attempt counter and advances the backoff lease atomically, then returns the claimed rows
-- for the worker to re-enqueue. It does NOT set 'queued' — the worker flips status only after a confirmed
-- pgmq_send. Rows at/over p_max_attempts are never claimed (they stay queue_failed, observable).
CREATE OR REPLACE FUNCTION public.claim_webhook_requeue(
  p_batch         int,
  p_stale_seconds int,
  p_max_attempts  int
)
RETURNS TABLE (bot_id uuid, signal_id text, side text)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT wl.id
      FROM public.webhook_logs wl
     WHERE (
             wl.status = 'queue_failed'
             OR (wl.status = 'accepted'
                 AND wl.received_at < now() - make_interval(secs => p_stale_seconds))
           )
       AND wl.requeue_attempts < p_max_attempts
       AND (wl.next_retry_at IS NULL OR wl.next_retry_at <= now())
     ORDER BY COALESCE(wl.next_retry_at, wl.received_at) ASC
     LIMIT p_batch
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.webhook_logs wl
     SET requeue_attempts = wl.requeue_attempts + 1,
         next_retry_at    = now()
                            + (LEAST(POWER(2, wl.requeue_attempts + 1)::int, 300)) * interval '1 second'
    FROM eligible e
   WHERE wl.id = e.id
  RETURNING wl.bot_id, wl.signal_id, (wl.raw_payload->>'action');
END;
$$;

COMMENT ON FUNCTION public.claim_webhook_requeue(int, int, int) IS
  'Slice 4C: atomic lease-claim (FOR UPDATE SKIP LOCKED) of webhook_logs rows needing requeue. Increments
   requeue_attempts + sets a backoff lease; returns claimed rows for the sweeper. service_role only.';

REVOKE ALL ON FUNCTION public.claim_webhook_requeue(int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_webhook_requeue(int, int, int) TO service_role;

commit;
