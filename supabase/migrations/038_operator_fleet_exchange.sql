-- Migration 038 (EP7): operator_pilot_fleet() carries the VENUE (exchange).
--
-- Additive, READ-ONLY. Re-issues 032's operator_pilot_fleet() verbatim with ONE addition: a left join
-- to public.exchanges (via the credential's exchange_id) exposing the non-secret venue name as
-- 'exchange', so the operator cockpit shows WHICH exchange each bot trades on (not only testnet vs
-- mainnet). Security is unchanged — SECURITY DEFINER, search_path='', operator gate (auth.uid() +
-- profiles.is_operator, RAISE 42501), authenticated-only. Still NEVER returns vault_secret_id,
-- webhook_secret_hash, keys, tokens, or pepper.
--
-- Apply LOCAL for tests (supabase/tests/038_operator_fleet_exchange.test.sql via `supabase db reset`);
-- a linked apply is a SEPARATE gated operator step — do NOT `db push`.

begin;

create or replace function public.operator_pilot_fleet()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_is_op boolean;
  v_out   jsonb;
begin
  if v_uid is null then
    raise exception 'operator_pilot_fleet: not authenticated' using errcode = '42501';
  end if;
  select p.is_operator into v_is_op from public.profiles p where p.id = v_uid;
  if v_is_op is distinct from true then   -- NULL (no profile) OR false → forbidden
    raise exception 'operator_pilot_fleet: forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(obj order by pair), '[]'::jsonb) into v_out
  from (
    select
      b.trading_pair as pair,
      jsonb_build_object(
        'id',                      b.id,
        'user_id',                 b.user_id,
        'trading_pair',            b.trading_pair,
        'bot_status',              b.status,
        'trading_enabled',         b.trading_enabled,
        'exchange_environment',    c.exchange_environment,
        -- EP7: the non-secret venue name (e.g. 'binance') the credential trades on. NULL if the bot
        -- has no credential yet. Never a secret.
        'exchange',                e.name,
        -- NON-SECRET credential ROW-id fingerprint (left-8 of credential_id) — never vault_secret_id.
        'credential_fingerprint',  case when b.credential_id is null then null
                                        else left(b.credential_id::text, 8) end,
        'fixed_notional_usdt',     b.fixed_notional_usdt,
        'max_order_notional_usdt', b.max_order_notional_usdt,
        'daily_notional_cap_usdt', b.daily_notional_cap_usdt,
        'sell_enabled',            b.sell_enabled,
        'last_trade_at',           lt.created_at,
        'last_trade_status',       lt.status,
        'last_block_reason',       lb.reason
      ) as obj
    from public.bots b
    left join public.user_exchange_credentials c on c.id = b.credential_id
    left join public.exchanges e on e.id = c.exchange_id
    left join lateral (
      select t.status, t.created_at
      from public.trades t
      where t.bot_id = b.id and t.deleted_at is null
      order by t.created_at desc
      limit 1
    ) lt on true
    left join lateral (
      select a.after_state->>'reason' as reason
      from public.audit_logs a
      where a.entity_id = b.id and a.event_type = 'order.blocked'
      order by a.created_at desc
      limit 1
    ) lb on true
    where b.deleted_at is null
  ) s;

  return v_out;
end;
$$;

comment on function public.operator_pilot_fleet() is
  'StrateTeach ST-1 operator cockpit fleet (read-only). Operator-gated (auth.uid()+profiles.is_operator, '
  'RAISE 42501 otherwise), SECURITY DEFINER, search_path empty. NON-SECRET per-bot enrichment only: id/'
  'user_id/trading_pair/bot_status/trading_enabled/exchange_environment/exchange (venue name)/'
  'credential_fingerprint (left-8 of the credential ROW id, NOT vault_secret_id)/tiny caps/sell_enabled/'
  'last_trade_at/last_trade_status/last_block_reason. No mutation. NEVER returns vault_secret_id, '
  'webhook_secret_hash, keys, tokens, pepper.';

commit;
