-- ============================================================================
-- LOCAL-ONLY test for migration 020 — operator_status() adds per-bot id + kill_rpc_present.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..020 applied locally
-- (`supabase db reset` applies them; 019 must be present so kill_rpc_present = true).
-- Runs as the DB owner; drives auth.uid() via the request.jwt.claims GUC. One transaction, ROLLS BACK.
--   supabase db query --file supabase/tests/020_operator_status_add_id.test.sql   (or psql -f)
-- ============================================================================

begin;

-- Seed one operator + one bot (credential_id omitted → nullable).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'op020@test.local');
update public.profiles set is_operator = true where id = '00000000-0000-0000-0000-0000000000c1';
insert into public.bots (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'status-020', 'BTCUSDT', 'x', 'active', false);

-- Call operator_status() as the operator (auth.uid() via GUC).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
do $$
declare v jsonb;
begin
  v := public.operator_status();

  -- ADDED (020): kill_rpc_present present + true (operator_kill_all exists locally via migration 019).
  assert v ? 'kill_rpc_present', '020: top-level kill_rpc_present key present';
  assert (v->>'kill_rpc_present')::boolean = true, '020: kill_rpc_present = true (operator_kill_all exists)';

  -- ADDED (020): per-bot id present + equals the seeded bot id.
  assert (v->'bots'->0) ? 'id', '020: bots[].id present';
  assert (v->'bots'->0->>'id') = '00000000-0000-0000-0000-0000000000d1', '020: bots[].id matches seeded bot';

  -- Existing shape preserved (spot-check per-bot + top-level).
  assert (v->'bots'->0->>'trading_pair') = 'BTCUSDT',       '020: per-bot trading_pair preserved';
  assert (v->'bots'->0->>'bot_status')   = 'active',        '020: per-bot bot_status preserved';
  assert (v->'bots'->0) ? 'trading_enabled',                '020: per-bot trading_enabled preserved';
  assert (v->'bots'->0) ? 'execution_ready',                '020: per-bot execution_ready preserved';
  assert (v ? 'enabled_bots') and (v ? 'open_trades') and (v ? 'dlq')
     and (v ? 'open_recon') and (v ? 'queue_length') and (v ? 'worker_status'),
                                                            '020: top-level shape preserved';

  -- No secrets in the payload.
  assert not (v::text ~* '(webhook_secret_hash|token|secret|vault|password|service_role)'),
                                                            '020: no secret substrings in payload';
end $$;
select set_config('request.jwt.claims', '', true);

-- Authz preserved: non-operator / null uid → 42501 (deny-by-default unchanged).
do $$
begin
  begin
    perform public.operator_status();
    raise exception '020: expected 42501 for null-uid caller';
  exception when sqlstate '42501' then null;   -- expected
  end;
end $$;

do $$ begin raise notice 'ALL 020 TESTS PASSED'; end $$;

rollback;
