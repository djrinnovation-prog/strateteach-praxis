-- Migration 036 (T4): dormant per-bot webhook body-signing flag, locked to operators.
--
-- Adds bots.webhook_body_signing_required (default FALSE ⇒ every existing bot keeps today's
-- behavior EXACTLY — no signature required). When an operator sets it true, the webhook edge
-- function additionally requires a valid X-Praxis-Signature (HMAC over the raw body with a
-- pepper-derived per-bot key) + a fresh in-body timestamp, fail-closed. This is a DORMANT
-- capability: it is usable only behind a SIGNING RELAY (vanilla TradingView cannot set headers
-- or compute an HMAC), so enabling it on a direct-TradingView bot would fail-closed-reject every
-- alert. Enabling is a deliberate operator go-live step (see the ops runbook), never automatic.
--
-- The flag is OPERATOR-MANAGED: it is added to the 034 field-lock guard so a NON-OPERATOR user
-- (raw JS-client UPDATE under the broad bots_update RLS) cannot toggle their own signing
-- requirement. All existing 034 checks are retained verbatim.
--
-- SEPARATE gated migration. Apply LOCAL for tests (`supabase db reset`); a linked apply is a
-- SEPARATE gated step — do NOT `db push`.

begin;

alter table public.bots
  add column if not exists webhook_body_signing_required boolean not null default false;

comment on column public.bots.webhook_body_signing_required is
  'T4: when true, the webhook requires a valid X-Praxis-Signature (HMAC over the raw body with a '
  'pepper-derived, domain-separated per-bot key) plus a fresh in-body timestamp. Operator-managed '
  '(locked by guard_bot_user_field_lock). Default false = current behavior. Usable only behind a '
  'signing relay — enabling is a gated operator step.';

-- Re-issue the 034 field-lock guard with webhook_body_signing_required added to the operator-only
-- set. create-or-replace updates the function the existing trg_bot_user_field_lock trigger runs;
-- ALL prior 034 checks are preserved.
create or replace function public.guard_bot_user_field_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Only constrain NON-OPERATOR USER (JWT) contexts. Privileged sessions (auth.uid() IS NULL /
  -- service_role) and operators set caps/credentials/signing and are exempt.
  if v_uid is null or public.is_operator(v_uid) then
    return new;
  end if;

  if (new.fixed_notional_usdt          is distinct from old.fixed_notional_usdt)
  or (new.max_order_notional_usdt      is distinct from old.max_order_notional_usdt)
  or (new.daily_notional_cap_usdt      is distinct from old.daily_notional_cap_usdt)
  or (new.sizing_mode                  is distinct from old.sizing_mode)
  or (new.position_size_pct            is distinct from old.position_size_pct)
  or (new.sell_enabled                 is distinct from old.sell_enabled)
  or (new.credential_id                is distinct from old.credential_id)
  or (new.trading_pair                 is distinct from old.trading_pair)
  or (new.account_type                 is distinct from old.account_type)
  or (new.webhook_body_signing_required is distinct from old.webhook_body_signing_required)
  then
    raise exception 'bots: sizing/risk/credential/pair/signing fields are operator-managed and cannot be changed by the owner'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_bot_user_field_lock() is
  'ST-2b + T4: forbids a NON-OPERATOR JWT context from changing operator-managed bot fields '
  '(caps/sizing/sell/credential/trading_pair/account_type/webhook_body_signing_required). '
  'auth.uid() IS NULL (service_role) and operators are exempt. Users may still change '
  'status/trading_enabled (governed by 027 + user_pause_own_bot) and cosmetic fields.';

commit;
