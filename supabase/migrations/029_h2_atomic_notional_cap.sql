-- Migration 029: H-2 — atomic per-bot notional-cap reservation.
--
-- THREAT (audit v3 H-2): enforceRiskLimits reads the day's summed requested notional, compares in JS,
-- and INSERTs the pending reservation several statements later with NO lock. UNIQUE(bot_id,signal_id)
-- stops double-execution of the SAME signal, but nothing guards the aggregate cap across DIFFERENT
-- signals: two concurrent signals both read sum=900, both pass 900+100<=1000, both order → 1100 > cap.
--
-- FIX: a SECURITY DEFINER RPC that, under a per-bot transaction advisory lock, RE-checks the per-order
-- max and the day's running sum and INSERTs the pending row ATOMICALLY. The lock serializes concurrent
-- signals for the same bot, so the running sum a racer sees always includes the other's reservation.
-- The worker keeps its JS enforceRiskLimits as a fast pre-gate (fail-closed before the exchange call);
-- THIS RPC is the authoritative final reservation. On rejection the worker treats it as a risk block
-- (ack, audit order.blocked, NO order) — see the H-2 worker-wiring packet.
--
-- Reserving statuses + UTC day boundary MUST match the worker (DAILY_CAP_RESERVING_STATUSES =
-- pending/submitted/unknown/filled; start-of-day UTC).
--
-- GATED: apply LOCAL for tests, then LINKED on explicit operator approval + read-back; record 029 in
-- schema_migrations. Apply SURGICALLY (`db query --linked --file`), NEVER `db push`. Worker wiring is a
-- SEPARATE step and must land only AFTER this RPC is live (the worker calls a function that must exist).

begin;

create or replace function public.insert_pending_trade_atomic(
  p_bot_id               uuid,
  p_user_id              uuid,
  p_signal_id            text,
  p_client_order_id      text,
  p_side                 text,
  p_trading_pair         text,
  p_quantity             numeric,
  p_requested_notional   numeric,
  p_max_order_notional   numeric,
  p_daily_cap            numeric
)
returns table (trade_id uuid, rejected_reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', (now() at time zone 'utc')) at time zone 'utc';
  v_sum       numeric;
  v_new_id    uuid;
begin
  -- Fail-closed input validation (never reserve on a non-finite / missing cap).
  if p_requested_notional is null or p_max_order_notional is null or p_daily_cap is null
     or not (p_requested_notional = p_requested_notional)  -- NaN guard
  then
    return query select null::uuid, 'invalid_input'::text;
    return;
  end if;

  -- Serialize concurrent signals for THIS bot (xact-scoped; released at COMMIT/ROLLBACK).
  perform pg_advisory_xact_lock(hashtextextended(p_bot_id::text, 0));

  -- Per-order ceiling.
  if p_requested_notional > p_max_order_notional then
    return query select null::uuid, 'per_order_max_notional'::text;
    return;
  end if;

  -- Day's running reservation under the lock (same basis as the worker).
  select coalesce(sum(t.requested_notional_usdt), 0) into v_sum
  from public.trades t
  where t.bot_id = p_bot_id
    and t.deleted_at is null
    and t.status in ('pending','submitted','unknown','filled')
    and t.created_at >= v_day_start;

  if v_sum + p_requested_notional > p_daily_cap then
    return query select null::uuid, 'daily_notional_cap'::text;
    return;
  end if;

  -- Reserve atomically. A UNIQUE(bot_id,signal_id) collision ⇒ a concurrent worker already inserted.
  begin
    insert into public.trades (
      bot_id, user_id, signal_id, client_order_id, side, trading_pair, quantity,
      requested_notional_usdt, status, last_attempt_at
    ) values (
      p_bot_id, p_user_id, p_signal_id, p_client_order_id, p_side::public.trade_side, p_trading_pair, p_quantity,
      p_requested_notional, 'pending', now()
    )
    returning id into v_new_id;
  exception when unique_violation then
    return query select null::uuid, 'duplicate_signal'::text;
    return;
  end;

  return query select v_new_id, null::text;
end;
$$;

revoke all on function public.insert_pending_trade_atomic(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.insert_pending_trade_atomic(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric) to service_role;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'insert_pending_trade_atomic') then
    raise exception 'H-2 POST: insert_pending_trade_atomic not created';
  end if;
  raise notice 'H-2 OK: atomic notional-cap reservation RPC created (worker wiring is a separate gated step).';
end $$;

commit;
