-- 017_webhook_rate_limits.sql — webhook per-IP / per-bot rate-limit store — A5-1 / H1
-- ============================================================================
-- Fixed 60s-window counter for the webhook Edge function (H1 rate limit). Single atomic
-- insert-or-increment RPC returns the new count; the function decides pass/reject.
--
-- NOT auto-applied. GATED. **Migration 009 frozen.** Do NOT `db push` (010–016 applied surgically,
-- absent from supabase_migrations). Apply surgically (transaction-wrapped `db query --linked --file`)
-- ONLY on explicit approval; then reconcile. This file is committed for review — NOT applied.
--
-- Access: WRITE by the webhook (service_role); RLS ON with no policies (deny-all direct client access;
-- service_role bypasses). No secrets stored — only bucket keys (ip:/bot:) + counts.
-- ============================================================================

begin;

CREATE TABLE public.webhook_rate_limits (
  bucket_key   text        NOT NULL,   -- 'ip:<ip>:<window-iso>' | 'bot:<uuid>:<window-iso>'
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (bucket_key, window_start)
);

COMMENT ON TABLE public.webhook_rate_limits IS
  'Webhook H1 rate-limit counters (fixed 60s window). No secrets. service_role write only; read via RPC.';

-- Index to support opportunistic cleanup of expired buckets.
CREATE INDEX webhook_rate_limits_window_start_idx ON public.webhook_rate_limits (window_start);

ALTER TABLE public.webhook_rate_limits ENABLE ROW LEVEL SECURITY;   -- deny-all; service_role bypasses
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_rate_limits TO service_role;

-- Atomic insert-or-increment; returns the NEW count. (supabase-js .upsert() cannot increment.)
CREATE FUNCTION public.webhook_rate_bump(p_key text, p_window timestamptz)
RETURNS integer
LANGUAGE sql
AS $$
  INSERT INTO public.webhook_rate_limits (bucket_key, window_start, count)
  VALUES (p_key, p_window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = public.webhook_rate_limits.count + 1
  RETURNING count;
$$;

COMMENT ON FUNCTION public.webhook_rate_bump(text, timestamptz) IS
  'Atomic per-window insert-or-increment for webhook rate limiting. Returns the new count. service_role only.';

REVOKE ALL ON FUNCTION public.webhook_rate_bump(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webhook_rate_bump(text, timestamptz) TO service_role;

commit;
