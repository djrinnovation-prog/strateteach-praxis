-- ============================================================================
-- 042 — credential_validations pgmq queue (M8-validate)
--
-- A DEDICATED queue for read-only credential-validation requests, physically
-- isolated from the frozen `trade_signals` contract. The Edge function
-- `validate-credential` enqueues a request; the worker's credentialValidation
-- loop drains it, proves the connected key authenticates via a single READ-ONLY
-- fetchBalance (NEVER an order), and flips the credential status valid/invalid.
--
-- Why a separate queue (not a `kind` field on trade_signals):
--   • trade_signals is a frozen v1.0 executable contract — it must carry ONLY
--     trades. A validate message can never touch the trade hot path.
--   • Isolated visibility-timeout / backpressure / metrics.
--   • The worker's validate handler has NO createOrder in scope, so a message on
--     this queue is structurally incapable of placing a trade.
--
-- No new RPC wrappers are needed: pgmq_read / pgmq_send / pgmq_delete (migration
-- 007) already take `queue_name` as a parameter and are service_role-only.
--
-- Idempotent + guarded (pgmq.create errors if the queue already exists), matching
-- the trade_signals bootstrap in 007. Safe to re-run.
-- ============================================================================

-- pgmq extension is already present (migration 007); create defensively anyway.
create extension if not exists pgmq;

do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'credential_validations'
  ) then
    perform pgmq.create('credential_validations');
  end if;
end $$;
