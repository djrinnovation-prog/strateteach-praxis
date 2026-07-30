-- ============================================================================
-- 007_pgmq_queue_and_rpc.sql
-- Sprint 3 / WB3 — pgmq queue + public RPC wrappers
--
-- Enables pgmq (1.5.1, verified available on the instance), creates the
-- trade_signals queue, and exposes three SECURITY DEFINER wrappers in `public`
-- so the worker (service_role) can call them via PostgREST RPC. pgmq's own
-- functions live in the `pgmq` schema and are NOT exposed to PostgREST — same
-- pattern as the Vault accessors (migrations 004/005).
--
-- Decision Log (2026-06-04): "Queue Message Format v1.0", "signal_id =
-- source-supplied C-bar composite". Wrapper arg names MUST match the worker's
-- supabase.rpc() calls (worker/src/index.ts) — Supabase binds RPC args by name.
-- ============================================================================

-- 1. Extension (idempotent). pgmq creates and uses its own `pgmq` schema.
create extension if not exists pgmq;

-- 2. Queue (guarded — pgmq.create() errors if the queue already exists).
do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'trade_signals'
  ) then
    perform pgmq.create('trade_signals');
  end if;
end $$;

-- 3. Public RPC wrappers (SECURITY DEFINER, empty search_path, fully qualified).
--    Arg names are contract-critical: queue_name / vt / qty / msg_id / message.

-- 3a. read — worker preflightQueue (qty=0) and pollOnce (qty=1, vt>0)
create or replace function public.pgmq_read(queue_name text, vt integer, qty integer)
returns setof pgmq.message_record
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Preflight probe sends qty=0: prove the RPC is callable without reading
  -- (and therefore without consuming/hiding) any real message.
  if qty is null or qty <= 0 then
    return;
  end if;
  return query select * from pgmq.read(queue_name, vt, qty);
end;
$$;

-- 3b. delete — worker pollOnce ack path
create or replace function public.pgmq_delete(queue_name text, msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete(queue_name, msg_id);
$$;

-- 3c. send — Edge Function (WB5) enqueue path; returns the new msg_id
create or replace function public.pgmq_send(queue_name text, message jsonb)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select t.msg_id from pgmq.send(queue_name, message) as t(msg_id);
$$;

-- 4. Grants — service_role only (worker + Edge). Strip the default PUBLIC grant.
revoke all on function public.pgmq_read(text, integer, integer)  from public, anon, authenticated;
revoke all on function public.pgmq_delete(text, bigint)          from public, anon, authenticated;
revoke all on function public.pgmq_send(text, jsonb)             from public, anon, authenticated;

grant execute on function public.pgmq_read(text, integer, integer) to service_role;
grant execute on function public.pgmq_delete(text, bigint)         to service_role;
grant execute on function public.pgmq_send(text, jsonb)            to service_role;

-- 5. Documentation
comment on function public.pgmq_read(text, integer, integer) is
  'WB3: read up to qty msgs from a pgmq queue with visibility timeout vt. qty<=0 returns empty (preflight probe). service_role only.';
comment on function public.pgmq_delete(text, bigint) is
  'WB3: delete (ack) a pgmq message by msg_id. Returns true if found. service_role only.';
comment on function public.pgmq_send(text, jsonb) is
  'WB3: enqueue a jsonb message to a pgmq queue; returns msg_id. Edge Function (WB5). service_role only.';

-- 6. Refresh PostgREST schema cache so the new RPCs are immediately callable.
notify pgrst, 'reload schema';
