-- ============================================================================
-- LOCAL-ONLY test for migration 027 — M-2 operator kill-lock.
-- LOCAL Supabase ONLY (never --linked). Requires 001..027 applied locally. ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/027_m2_operator_kill_lock.test.sql
-- auth.uid() is simulated via the request.jwt.claims GUC (is_local=true), same pattern as 019.
-- Runs as postgres so RLS is bypassed; the guard trigger keys on auth.uid(), which the GUC drives.
-- ============================================================================

begin;

insert into public.exchanges (id, name, display_name, ccxt_id) values
  ('e0000000-0000-0000-0000-000000000027', 'binance-t027', 'Binance T027', 'binance-t027');
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000a7', 'ua027@test.local');
insert into public.user_exchange_credentials (id, user_id, exchange_id, vault_secret_id, label, status, exchange_environment) values
  ('c0000000-0000-0000-0000-0000000c0271', 'a0000000-0000-0000-0000-0000000000a7', 'e0000000-0000-0000-0000-000000000027', 'vault-0271', 'c1', 'valid', 'testnet');
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('b0000000-0000-0000-0000-0000000b0271', 'a0000000-0000-0000-0000-0000000000a7', 'c0000000-0000-0000-0000-0000000c0271', 'bot1', 'AAAUSDT', 'x', 'active', false);

-- Structure present.
do $$
begin
  assert exists (select 1 from information_schema.columns where table_schema='public' and table_name='bots' and column_name='operator_locked'), '027: operator_locked column present';
  assert exists (select 1 from pg_trigger where tgname='trg_bot_operator_lock'), '027: guard trigger present';
  assert exists (select 1 from pg_proc where proname='operator_set_bot_lock'), '027: operator_set_bot_lock RPC present';
end $$;

-- Engage the lock as a privileged session (no jwt => auth.uid() null => guard allows).
select set_config('request.jwt.claims', '', true);
update public.bots set operator_locked = true where id='b0000000-0000-0000-0000-0000000b0271';

-- NEGATIVE: the OWNER cannot re-enable trading while locked.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7","role":"authenticated"}', true);
do $$
begin
  begin
    update public.bots set trading_enabled = true where id='b0000000-0000-0000-0000-0000000b0271';
    raise exception '027: expected owner re-enable while locked to be REJECTED';
  exception when insufficient_privilege then null;  -- expected
  end;
end $$;

-- NEGATIVE: the OWNER cannot clear the lock themselves.
do $$
begin
  begin
    update public.bots set operator_locked = false where id='b0000000-0000-0000-0000-0000000b0271';
    raise exception '027: expected owner clearing the lock to be REJECTED';
  exception when insufficient_privilege then null;  -- expected
  end;
end $$;

-- NEGATIVE: operator_set_bot_lock fails closed for a non-authenticated caller.
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.operator_set_bot_lock('b0000000-0000-0000-0000-0000000b0271', false);
    raise exception '027: expected operator_set_bot_lock to reject an unauthenticated caller';
  exception when insufficient_privilege then null;  -- expected (not authenticated)
  end;
end $$;

-- NEGATIVE: a NON-operator authenticated caller is forbidden.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.operator_set_bot_lock('b0000000-0000-0000-0000-0000000b0271', false);
    raise exception '027: expected operator_set_bot_lock to forbid a non-operator';
  exception when insufficient_privilege then null;  -- expected (forbidden)
  end;
end $$;

-- POSITIVE: a privileged session (no jwt) can clear the lock, and then the owner can re-enable.
select set_config('request.jwt.claims', '', true);
update public.bots set operator_locked = false where id='b0000000-0000-0000-0000-0000000b0271';
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-0000000000a7","role":"authenticated"}', true);
update public.bots set trading_enabled = true where id='b0000000-0000-0000-0000-0000000b0271';
do $$
begin
  assert (select trading_enabled from public.bots where id='b0000000-0000-0000-0000-0000000b0271') = true,
    '027: after unlock, owner re-enable must succeed';
  raise notice '027 PASS: locked bot blocks owner re-enable + self-unlock; RPC fail-closed; unlock restores owner control.';
end $$;

rollback;
