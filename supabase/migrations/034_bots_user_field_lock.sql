-- Migration 034 (ST-2b): lock sizing/risk/credential/pair fields against NON-OPERATOR user edits.
--
-- THREAT: the broad bots_update RLS policy (user_id=auth.uid()) lets a pilot user's raw JS-client UPDATE edit
-- ANY bot column, including operator-set caps. This BEFORE UPDATE trigger forbids a NON-OPERATOR JWT context
-- from changing protected columns (caps/sizing/sell/credential/trading_pair/account_type). Mirrors 027's guard.
-- Privileged sessions (auth.uid() IS NULL / service_role) and operators (public.is_operator) are EXEMPT — they
-- set caps/credentials. The scoped user_pause_own_bot() RPC only changes status/trading_enabled, so it passes.
-- Users may still change status/trading_enabled (governed by 027 + the pause RPC) and cosmetic fields (name).
--
-- SEPARATE gated migration — REQUIRED before pilot user accounts. Apply LOCAL for tests (`supabase db reset`);
-- a linked apply is a SEPARATE gated step — do NOT `db push`.

begin;

create or replace function public.guard_bot_user_field_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Only constrain NON-OPERATOR USER (JWT) contexts. Privileged sessions (auth.uid() IS NULL / service_role)
  -- and operators set caps/credentials and are exempt.
  if v_uid is null or public.is_operator(v_uid) then
    return new;
  end if;

  if (new.fixed_notional_usdt     is distinct from old.fixed_notional_usdt)
  or (new.max_order_notional_usdt is distinct from old.max_order_notional_usdt)
  or (new.daily_notional_cap_usdt is distinct from old.daily_notional_cap_usdt)
  or (new.sizing_mode             is distinct from old.sizing_mode)
  or (new.position_size_pct       is distinct from old.position_size_pct)
  or (new.sell_enabled            is distinct from old.sell_enabled)
  or (new.credential_id           is distinct from old.credential_id)
  or (new.trading_pair            is distinct from old.trading_pair)
  or (new.account_type            is distinct from old.account_type)
  then
    raise exception 'bots: sizing/risk/credential/pair fields are operator-managed and cannot be changed by the owner'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_bot_user_field_lock() is
  'ST-2b: forbids a NON-OPERATOR JWT context from changing operator-managed bot fields (caps/sizing/sell/'
  'credential/trading_pair/account_type). auth.uid() IS NULL (service_role) and operators are exempt. Users may '
  'still change status/trading_enabled (governed by 027 + user_pause_own_bot) and cosmetic fields.';

drop trigger if exists trg_bot_user_field_lock on public.bots;
create trigger trg_bot_user_field_lock
  before update on public.bots
  for each row
  execute function public.guard_bot_user_field_lock();

commit;
