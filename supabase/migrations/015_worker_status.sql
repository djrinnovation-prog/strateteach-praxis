-- 015_worker_status.sql — Operator Console worker runtime status (read model) — S5 Slice 1a
-- ============================================================================
-- Single-row table the worker upserts on boot + every ~60s, so the operator console can show
-- worker-OBSERVED runtime state (queue_enabled, is_production, worker_state, boot_stuck_count,
-- updated_at). Read-only model: NO secrets (only operational flags/counts), NO execution capability.
--
-- NOT auto-applied. GATED. **Migration 009 frozen.** Do NOT `db push` (010–014 were applied surgically
-- and are absent from supabase_migrations — a push would re-apply them). Apply surgically via a
-- transaction-wrapped `supabase db query --linked --file` only on explicit approval, then reconcile.
--
-- Access model:
--   - WRITE: the worker (service_role) upserts the single row (service_role bypasses RLS).
--   - READ: only via the operator_status() SECURITY DEFINER RPC (migration 016, Slice 1b).
--   - RLS is ON with NO anon/authenticated policies → direct client reads are denied (fail-closed).
-- ============================================================================

CREATE TABLE public.worker_status (
  singleton        boolean     PRIMARY KEY DEFAULT true CHECK (singleton),   -- enforces exactly one row
  queue_enabled    boolean     NOT NULL,
  is_production    boolean     NOT NULL,
  worker_state     text        NOT NULL CHECK (worker_state IN ('running', 'disabled', 'stopping')),
  boot_stuck_count integer     CHECK (boot_stuck_count >= 0),                 -- NULL = unknown (boot query error)
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.worker_status IS
  'Single-row worker runtime status for the operator console (boot + ~60s heartbeat upsert). No secrets.
   Worker writes via service_role; read only via the operator_status() SECURITY DEFINER RPC (Slice 1b).';
COMMENT ON COLUMN public.worker_status.boot_stuck_count IS
  'Stuck pending/unknown trades found at boot reconciliation; NULL = unknown (boot query error).';

-- RLS ON, no policies: deny all direct client reads/writes. service_role (worker) bypasses RLS for the
-- upsert; the operator console reads only through the definer RPC in Slice 1b.
ALTER TABLE public.worker_status ENABLE ROW LEVEL SECURITY;

-- Worker (service_role) upserts the single row.
GRANT SELECT, INSERT, UPDATE ON public.worker_status TO service_role;
