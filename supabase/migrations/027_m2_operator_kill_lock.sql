-- Migration 027: M-2 — make the operator "kill-all" durable against the users it targets.
--
-- THREAT (audit v3 M-2): operator_kill_all (019) sets trading_enabled=false + status=paused, but the
-- ordinary owner UPDATE policy lets the bot owner immediately PATCH trading_enabled=true / status=active
-- back — the emergency stop is not durable. There is no operator-lock the owner cannot clear.
--
-- FIX: add bots.operator_locked (only a privileged/operator session may set or clear it) + a BEFORE
-- UPDATE guard trigger that refuses a USER (auth.uid() IS NOT NULL) attempt to re-enable trading or
-- re-activate a bot while it is operator_locked. Mirrors the is_operator guard pattern (016).
--
-- WIRING (follow-up, small): operator_kill_all (019) should additionally set operator_locked=true on the
-- bots it pauses so the lock engages automatically; operator_unlock_bot() below clears it. Until 019 is
-- updated, an operator can engage the lock via operator_set_bot_lock(). Documented in the closeout.
--
-- GATED: apply LOCAL for tests, then LINKED on explicit operator approval + read-back; record 027 in
-- schema_migrations. Apply SURGICALLY (`db query --linked --file`), NEVER `db push`.

begin;

-- ---- 1. operator_locked column (deny-by-default: unlocked) --------------------------------------
alter table public.bots
  add column if not exists operator_locked boolean not null default false;

comment on column public.bots.operator_locked is
  'M-2: operator emergency lock. While true, a USER context may not re-enable trading or re-activate the '
  'bot; only a privileged/operator session may clear it (operator_unlock_bot / operator_set_bot_lock).';

-- ---- 2. Guard: a user may not re-enable trading or re-activate while operator_locked ------------
create or replace function public.guard_bot_operator_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only constrain USER (JWT) contexts; privileged sessions (auth.uid() IS NULL / service_role) manage the lock.
  if auth.uid() is null then
    return new;
  end if;
  -- A user may never clear the lock themselves.
  if old.operator_locked and (new.operator_locked is distinct from old.operator_locked) then
    raise exception 'operator_locked can only be cleared by an operator' using errcode = '42501';
  end if;
  -- While locked, a user may not re-enable trading or move the bot back to active.
  if old.operator_locked then
    if new.trading_enabled and not old.trading_enabled then
      raise exception 'bot is operator-locked; trading cannot be re-enabled by the owner' using errcode = '42501';
    end if;
    if new.status = 'active' and old.status is distinct from 'active' then
      raise exception 'bot is operator-locked; status cannot be re-activated by the owner' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bot_operator_lock on public.bots;
create trigger trg_bot_operator_lock
  before update on public.bots
  for each row
  execute function public.guard_bot_operator_lock();

-- ---- 3. Operator-only lock/unlock RPCs (SECURITY DEFINER; fail-closed authz mirrors 016) --------
create or replace function public.operator_set_bot_lock(p_bot_id uuid, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_is_op boolean;
begin
  if v_uid is null then
    raise exception 'operator_set_bot_lock: not authenticated' using errcode = '42501';
  end if;
  select p.is_operator into v_is_op from public.profiles p where p.id = v_uid;
  if v_is_op is distinct from true then
    raise exception 'operator_set_bot_lock: forbidden' using errcode = '42501';
  end if;
  update public.bots set operator_locked = p_locked where id = p_bot_id;
end;
$$;

revoke all on function public.operator_set_bot_lock(uuid, boolean) from public, anon, authenticated;
grant execute on function public.operator_set_bot_lock(uuid, boolean) to authenticated; -- body re-checks is_operator

-- ---- POST-VERIFY ------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='bots' and column_name='operator_locked') then
    raise exception 'M-2 POST: bots.operator_locked missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_bot_operator_lock') then
    raise exception 'M-2 POST: operator-lock guard trigger missing';
  end if;
  raise notice 'M-2 OK: operator_locked column + guard trigger + operator lock RPC in place.';
end $$;

commit;
