-- Migration 018: public.is_operator(uuid) — SECURITY DEFINER operator check
--
-- Purpose: let the admin webhook-token rotation Edge function (service_role) gate on
-- whether a uid is an operator WITHOUT granting service_role SELECT on `profiles`.
-- `profiles` stays locked down (RLS on, no broad grants); this mirrors the existing
-- `operator_status()` SECURITY DEFINER pattern. Reads ONLY profiles.is_operator.
--
-- Apply SURGICALLY (transaction-wrapped `supabase db query --linked --file`), NOT via
-- `db push`, and NOT recorded in supabase_migrations — consistent with the documented
-- 010–017 migration-history exception. The committed file is the record.

begin;

create or replace function public.is_operator(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_operator from public.profiles p where p.id = p_uid),
    false
  );
$$;

comment on function public.is_operator(uuid) is
  'SECURITY DEFINER operator check: returns profiles.is_operator for p_uid (false if missing/null). '
  'EXECUTE granted to service_role only, so the admin rotation Edge function can gate on operator '
  'status without SELECT on the locked-down profiles table. Reads only the is_operator boolean.';

-- Lock down EXECUTE: revoke from everyone, grant only to service_role.
revoke all on function public.is_operator(uuid) from public;
revoke all on function public.is_operator(uuid) from anon;
revoke all on function public.is_operator(uuid) from authenticated;
grant execute on function public.is_operator(uuid) to service_role;

commit;
