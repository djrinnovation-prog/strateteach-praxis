-- Migration 028: AuthZ/least-privilege hardening — M-11, L-4, L-15, L-6 (audit v3).
--
-- M-11: profiles UPDATE is not column-scoped. The 016 guard protects only is_operator; every other
--       column (subscription_status, affiliate_code, referred_by) is user-writable via PATCH → self-grant
--       a paid tier / forge affiliate attribution. Extend the guard to reject user changes to those.
-- L-4:  credentials_update / bots_update USING clauses omit `deleted_at IS NULL`, so an owner can PATCH
--       deleted_at=NULL to resurrect a soft-deleted (e.g. abuse-disabled) credential/bot. Add the guard.
-- L-15: bot_events_select and audit_logs_select were never scoped TO authenticated (012 did the others),
--       leaving the subquery-in-policy hazard for those two. Re-scope them to the authenticated role.
-- L-6:  webhook_rate_bump (017) and claim_webhook_requeue (025) only REVOKE PUBLIC and set no search_path;
--       lock them to service_role and pin an empty search_path.
--
-- GATED: apply LOCAL for tests, then LINKED on explicit operator approval + read-back; record 028 in
-- schema_migrations. Apply SURGICALLY (`db query --linked --file`), NEVER `db push`.

begin;

-- ================================ M-11: profiles column guard ================================
-- Extend the 016 guard so a USER context cannot change privileged/billing columns. Keeps the existing
-- is_operator protection (idempotent CREATE OR REPLACE of the same function name used by trg from 016).
create or replace function public.guard_profiles_is_operator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only constrain USER (JWT) contexts; privileged sessions (auth.uid() IS NULL) provision these.
  if auth.uid() is null then
    return new;
  end if;
  if new.is_operator is distinct from old.is_operator then
    raise exception 'profiles.is_operator cannot be changed by a user; provision via a privileged session'
      using errcode = '42501';
  end if;
  -- M-11: billing/affiliate columns are server-owned — a user may not self-edit them.
  if new.subscription_status is distinct from old.subscription_status then
    raise exception 'profiles.subscription_status is not user-writable' using errcode = '42501';
  end if;
  if new.affiliate_code is distinct from old.affiliate_code then
    raise exception 'profiles.affiliate_code is not user-writable' using errcode = '42501';
  end if;
  if new.referred_by is distinct from old.referred_by then
    raise exception 'profiles.referred_by is not user-writable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ================================ L-4: soft-delete UPDATE scoping ================================
-- Owners can UPDATE only NON-deleted rows — deleted_at=NULL resurrection is blocked. Recreate both
-- policies with the guard in the USING clause (WITH CHECK unchanged: still your own row).
drop policy if exists credentials_update on public.user_exchange_credentials;
create policy credentials_update
  on public.user_exchange_credentials for update
  to authenticated
  using (user_id = auth.uid() and deleted_at is null)
  with check (user_id = auth.uid());

drop policy if exists bots_update on public.bots;
create policy bots_update
  on public.bots for update
  to authenticated
  using (user_id = auth.uid() and deleted_at is null)
  with check (user_id = auth.uid());

-- ================================ L-15: scope SELECT policies TO authenticated ================================
drop policy if exists bot_events_select on public.bot_events;
create policy bot_events_select
  on public.bot_events for select
  to authenticated
  using (
    bot_id in (select id from public.bots where user_id = auth.uid() and deleted_at is null)
  );

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select
  on public.audit_logs for select
  to authenticated
  using (
    actor_id = auth.uid()
    or entity_id in (select id from public.bots   where user_id = auth.uid() and deleted_at is null)
    or entity_id in (select id from public.trades where user_id = auth.uid() and deleted_at is null)
  );

-- ================================ L-6: lock down helper functions ================================
alter function public.webhook_rate_bump(text, timestamptz) set search_path = '';
revoke all on function public.webhook_rate_bump(text, timestamptz) from public, anon, authenticated;
grant execute on function public.webhook_rate_bump(text, timestamptz) to service_role;

alter function public.claim_webhook_requeue(int, int, int) set search_path = '';
revoke all on function public.claim_webhook_requeue(int, int, int) from public, anon, authenticated;
grant execute on function public.claim_webhook_requeue(int, int, int) to service_role;

-- ================================ POST-VERIFY ================================
do $$
begin
  -- L-4: both UPDATE policies must carry the deleted_at guard in their USING (qual) text
  -- (pg_policies renders it as e.g. "(deleted_at IS NULL)"; match case-insensitively on the column).
  if exists (
    select 1 from pg_policies
    where schemaname='public' and tablename in ('bots','user_exchange_credentials')
      and policyname in ('bots_update','credentials_update')
      and lower(coalesce(qual,'')) not like '%deleted_at is null%'
  ) then
    raise exception 'L-4 POST: an UPDATE policy is missing the deleted_at IS NULL guard';
  end if;
  raise notice 'M-11/L-4/L-15/L-6 OK: profiles column guard + soft-delete UPDATE scoping + authenticated-scoped selects + function grants.';
end $$;

commit;
