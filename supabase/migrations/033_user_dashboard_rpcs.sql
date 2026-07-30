-- Migration 033: user-facing read-only dashboard + scoped self-pause (StrateTeach ST-2).
--
-- Two SECURITY DEFINER RPCs, granted to `authenticated`, deny-by-default (RAISE 42501). Row-isolation is
-- enforced IN THE BODY by auth.uid() (SECURITY DEFINER bypasses RLS) — a cross-user isolation test is
-- MANDATORY (supabase/tests/033_user_dashboard_rpcs.test.sql). NON-SECRET only: never selects
-- webhook_secret_hash / vault_secret_id / api keys / tokens / pepper.
--
-- Apply LOCAL for tests (`supabase db reset`); a linked apply is a SEPARATE gated step — do NOT `db push`.

begin;

-- 1. user_bot_dashboard() — the caller's OWN bots, safe columns only.
create or replace function public.user_bot_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'user_bot_dashboard: not authenticated' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(obj order by pair), '[]'::jsonb) into v_out
  from (
    select
      b.trading_pair as pair,
      jsonb_build_object(
        'id',                      b.id,
        'name',                    b.name,
        'trading_pair',            b.trading_pair,
        'bot_status',              b.status,
        'trading_enabled',         b.trading_enabled,
        'sizing_mode',             b.sizing_mode,
        'fixed_notional_usdt',     b.fixed_notional_usdt,
        'max_order_notional_usdt', b.max_order_notional_usdt,
        'daily_notional_cap_usdt', b.daily_notional_cap_usdt,
        'sell_enabled',            b.sell_enabled,
        'exchange_environment',    c.exchange_environment,
        'credential_status',       c.status,
        'open_qty',                coalesce(pos.open_qty, 0),
        'cost_basis_usdt',         coalesce(pos.cost_basis_usdt, 0),
        'last_block_reason',       lb.reason,
        'recent_trades',           coalesce(rt.rows, '[]'::jsonb)
      ) as obj
    from public.bots b
    left join public.user_exchange_credentials c on c.id = b.credential_id
    left join lateral (
      select
        coalesce(sum(t.quantity) filter (where t.side = 'buy'  and t.status = 'filled'), 0)
          - coalesce(sum(t.quantity) filter (where t.side = 'sell' and t.status = 'filled'), 0) as open_qty,
        coalesce(sum(t.executed_notional_usdt) filter (where t.side = 'buy' and t.status = 'filled'), 0) as cost_basis_usdt
      from public.trades t
      where t.bot_id = b.id and t.deleted_at is null
    ) pos on true
    left join lateral (
      select a.after_state->>'reason' as reason
      from public.audit_logs a
      where a.entity_id = b.id and a.event_type = 'order.blocked'
      order by a.created_at desc
      limit 1
    ) lb on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'side',                    t.side,
               'status',                  t.status,
               'requested_notional_usdt', t.requested_notional_usdt,
               'executed_notional_usdt',  t.executed_notional_usdt,
               'created_at',              t.created_at,
               'filled_at',               t.filled_at
             ) order by t.created_at desc) as rows
      from (
        select t2.side, t2.status, t2.requested_notional_usdt, t2.executed_notional_usdt, t2.created_at, t2.filled_at
        from public.trades t2
        where t2.bot_id = b.id and t2.deleted_at is null
        order by t2.created_at desc
        limit 10
      ) t
    ) rt on true
    where b.user_id = v_uid and b.deleted_at is null
  ) s;

  return v_out;
end;
$$;

comment on function public.user_bot_dashboard() is
  'StrateTeach ST-2 user dashboard (read-only). Auth required (RAISE 42501). SECURITY DEFINER, search_path '
  'empty; row-scoped in the body to auth.uid() OWN bots. NON-SECRET only: bot status/caps/sell + credential '
  'exchange_environment/status + open position + last 10 trades + last order.blocked reason. NEVER returns '
  'vault_secret_id, webhook_secret_hash, keys, tokens, pepper.';

revoke all on function public.user_bot_dashboard() from public;
revoke all on function public.user_bot_dashboard() from anon;
grant execute on function public.user_bot_dashboard() to authenticated;

-- 2. user_pause_own_bot(p_bot_id) — the ONLY user mutation: disable + pause OWN bot. Never enables.
create or replace function public.user_pause_own_bot(p_bot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_owns boolean;
begin
  if v_uid is null then
    raise exception 'user_pause_own_bot: not authenticated' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.bots
    where id = p_bot_id and user_id = v_uid and deleted_at is null
  ) into v_owns;
  if not v_owns then
    raise exception 'user_pause_own_bot: not found or not owned' using errcode = '42501';
  end if;

  update public.bots
    set trading_enabled = false, status = 'paused'
    where id = p_bot_id and user_id = v_uid and deleted_at is null;

  insert into public.audit_logs (entity_type, entity_id, event_type, actor_type, actor_id, after_state)
  values ('bot', p_bot_id, 'bot.user_paused', 'user', v_uid,
          jsonb_build_object('trading_enabled', false, 'status', 'paused'));

  return jsonb_build_object('ok', true, 'bot_id', p_bot_id, 'status', 'paused', 'trading_enabled', false);
end;
$$;

comment on function public.user_pause_own_bot(uuid) is
  'StrateTeach ST-2 scoped self-pause. Auth required (42501). SECURITY DEFINER; verifies auth.uid() owns the '
  'bot, then sets trading_enabled=false + status=paused + writes a bot.user_paused audit row. NEVER enables/'
  'activates, never touches caps/sizing/credential. Re-enable under an operator lock stays blocked by 027.';

revoke all on function public.user_pause_own_bot(uuid) from public;
revoke all on function public.user_pause_own_bot(uuid) from anon;
grant execute on function public.user_pause_own_bot(uuid) to authenticated;

commit;
