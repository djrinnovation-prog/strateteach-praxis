-- ============================================================================
-- LOCAL-ONLY test for migration 028 — M-11 / L-4 / L-15 / L-6.
-- LOCAL Supabase ONLY (never --linked). Requires 001..028 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/028_authz_hardening.test.sql
-- auth.uid() simulated via request.jwt.claims GUC; runs as postgres (RLS bypassed) — the guard
-- trigger keys on auth.uid(). Catalog assertions cover the policy/grant shape (L-4/L-15/L-6).
-- ============================================================================

begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000a8', 'ua028@test.local');
-- 002 trigger auto-creates public.profiles for the new auth user.
do $$
begin
  assert exists (select 1 from public.profiles where id='a0000000-0000-0000-0000-0000000000a8'), '028: profile auto-created';
end $$;

-- ---- M-11: a USER cannot self-edit billing/affiliate columns ----
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a8","role":"authenticated"}', true);
do $$
begin
  begin
    update public.profiles set subscription_status='active' where id='a0000000-0000-0000-0000-0000000000a8';
    raise exception '028/M-11: expected self-edit of subscription_status to be REJECTED';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set affiliate_code='FREE' where id='a0000000-0000-0000-0000-0000000000a8';
    raise exception '028/M-11: expected self-edit of affiliate_code to be REJECTED';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set referred_by='someone' where id='a0000000-0000-0000-0000-0000000000a8';
    raise exception '028/M-11: expected self-edit of referred_by to be REJECTED';
  exception when insufficient_privilege then null; end;
end $$;

-- POSITIVE: a privileged session (no jwt) may set them.
select set_config('request.jwt.claims', '', true);
update public.profiles set subscription_status='active' where id='a0000000-0000-0000-0000-0000000000a8';
do $$
begin
  assert (select subscription_status from public.profiles where id='a0000000-0000-0000-0000-0000000000a8')='active',
    '028/M-11: privileged update must succeed';
end $$;

-- ---- L-4: bots_update + credentials_update USING carry deleted_at IS NULL ----
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and tablename in ('bots','user_exchange_credentials')
     and policyname in ('bots_update','credentials_update')
     and lower(coalesce(qual,'')) like '%deleted_at is null%';
  assert n = 2, format('028/L-4: expected both UPDATE policies to carry deleted_at guard, got %s', n);
end $$;

-- ---- L-15: bot_events_select + audit_logs_select scoped TO authenticated ----
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and tablename in ('bot_events','audit_logs')
     and policyname in ('bot_events_select','audit_logs_select')
     and 'authenticated' = any(roles);
  assert n = 2, format('028/L-15: expected both SELECT policies scoped to authenticated, got %s', n);
end $$;

-- ---- L-6: helper functions locked to service_role + search_path pinned ----
do $$
declare v_oid oid;
begin
  foreach v_oid in array (
    select array_agg(oid) from pg_proc where proname in ('webhook_rate_bump','claim_webhook_requeue')
  )
  loop
    assert exists (select 1 from unnest(coalesce((select proconfig from pg_proc where oid=v_oid), array[]::text[])) c
                   where c like 'search_path=%'),
      format('028/L-6: function %s must pin search_path', v_oid::regprocedure);
    assert not has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      format('028/L-6: authenticated must NOT execute %s', v_oid::regprocedure);
    assert not has_function_privilege('anon', v_oid, 'EXECUTE'),
      format('028/L-6: anon must NOT execute %s', v_oid::regprocedure);
    assert has_function_privilege('service_role', v_oid, 'EXECUTE'),
      format('028/L-6: service_role MUST execute %s', v_oid::regprocedure);
  end loop;
  raise notice '028 PASS: M-11 column guard + L-4 soft-delete scoping + L-15 authenticated selects + L-6 function grants.';
end $$;

rollback;
