-- ============================================================================
-- LOCAL-ONLY test fixture for migration 019 public.operator_kill_all(text, boolean)
-- A8-H2 audited one-click kill — Slice 2 / Codex CP2.
--
-- SCOPE: LOCAL Supabase ONLY. Do NOT run against the linked/testnet/prod DB.
--   The whole script runs inside ONE transaction and ROLLS BACK at the end, so it
--   leaves the local DB unchanged. It seeds throwaway auth.users/bots/trades rows.
--
-- HOW TO RUN (operator, local only):
--   supabase start                       # local stack
--   supabase db reset                    # applies migrations 001..019 locally (fresh)
--   supabase db query --file supabase/tests/019_operator_kill_all.test.sql
--   # (equivalently: psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f <this file>)
--   supabase stop
--   Any failed ASSERT aborts with an error. Reaching 'ALL 019 TESTS PASSED' = green.
--
-- HOW auth.uid() IS SIMULATED: operator_kill_all authorizes on auth.uid() + inline
--   profiles.is_operator (NOT on the DB role). We drive auth.uid() by setting the
--   'request.jwt.claims' GUC per case via set_config(..., is_local => true). Running
--   as the DB owner (postgres) also lets the SECURITY DEFINER function INSERT into the
--   service-role-only audit_logs (owner bypasses RLS) — this mirrors the real apply
--   (function owned by the migration-applier). The EXECUTE grant is verified from the
--   catalog (pg_proc.proacl via aclexplode), not by a real role-based call.
--
-- WHAT THIS FIXTURE DOES *NOT* PROVE (scope honesty): running as the DB owner bypasses
--   RLS and role-based grants, so this fixture proves the FUNCTION LOGIC under a simulated
--   auth.uid() — it does NOT exercise the real PostgREST invocation as the `authenticated`
--   role with a real JWT, nor RLS as a non-owner. That end-to-end authenticated RPC path
--   is covered later by the Slice 5 testnet validation (real operator JWT) and the
--   frontend/integration smoke. CP2 = function-semantics proof only.
--
-- Covers: non-operator denial, null-uid denial, clean kill, idempotent 2nd kill,
--   default hard_lock=true (pauses), explicit hard_lock=false (status unchanged),
--   open_trades => ATTENTION, queue => ATTENTION (guarded local pgmq), invalid reason
--   => 22023, no audit on denial, mandatory audit on authorized kill, grant lockdown.
-- ============================================================================

begin;

-- ---- Fixed throwaway UUIDs (hardcoded literally below; no psql \set so this runs
--      identically under `supabase db query` or psql) ---------------------------
--   ...a1 = OP   operator (profiles.is_operator=true)
--   ...a2 = NON  authenticated but NOT operator
--   ...b1 / ...b2 = two active, trading_enabled bots owned by OP
--
-- ---- SEED (as owner; no jwt claims set, so auth.uid() is NULL => the profiles
--      is_operator guard trigger treats this as a privileged session) -----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'op@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'nonop@test.local');
-- profiles are auto-created by the on_auth_user_created trigger (migration 002).
update public.profiles set is_operator = true  where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set is_operator = false where id = '00000000-0000-0000-0000-0000000000a2';

-- two live bots: active + trading_enabled (credential_id nullable → omitted)
insert into public.bots (id, user_id, name, trading_pair, webhook_secret_hash, status, trading_enabled) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'kill-test-1', 'BTCUSDT', 'x', 'active', true),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'kill-test-2', 'ETHUSDT', 'x', 'active', true);

-- worker_status singleton row: worker running, telemetry OK (so a clean kill is not
-- forced to ATTENTION by worker telemetry).
insert into public.worker_status (singleton, queue_enabled, is_production, worker_state, boot_stuck_count)
values (true, false, false, 'running', 0)
on conflict (singleton) do update set worker_state = excluded.worker_state, queue_enabled = excluded.queue_enabled;

savepoint seeded;   -- baseline: 2 enabled+active bots, worker running, 0 audit rows

-- ===========================================================================
-- GRANT LOCKDOWN — reliable catalog check via pg_proc.proacl + aclexplode
-- (grantee 0 = PUBLIC). Expected end-state: authenticated=EXECUTE; PUBLIC=none; anon=none.
-- aclexplode makes the PUBLIC grant explicit (has_function_privilege can't take PUBLIC).
-- ===========================================================================
do $$
declare v_oid oid := 'public.operator_kill_all(text, boolean)'::regprocedure;
begin
  assert exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = v_oid and a.grantee = 'authenticated'::regrole and a.privilege_type = 'EXECUTE'),
    'GRANT: authenticated MUST have EXECUTE';
  assert not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = v_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'),   -- 0 = PUBLIC
    'GRANT: PUBLIC MUST NOT have EXECUTE (revoke public held)';
  assert not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = v_oid and a.grantee = 'anon'::regrole and a.privilege_type = 'EXECUTE'),
    'GRANT: anon MUST NOT have EXECUTE (revoke anon held)';
end $$;

-- ===========================================================================
-- CASE A — non-operator denial: 42501, zero bot change, zero audit.
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.operator_kill_all('non-operator attempt', true);
    raise exception 'CASE A FAILED: expected 42501 denial, call succeeded';
  exception
    when sqlstate '42501' then null;   -- expected: forbidden
  end;
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.bots where trading_enabled and deleted_at is null) = 2,
    'CASE A: non-operator denial must not change bots';
  assert (select count(*) from public.audit_logs where event_type = 'operator.kill_all') = 0,
    'CASE A: non-operator denial must NOT write an audit row';
end $$;

-- ===========================================================================
-- CASE A2 — null uid (no sub) denial: 42501, zero effect, zero audit.
-- ===========================================================================
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);   -- no "sub" => auth.uid() null
do $$
begin
  begin
    perform public.operator_kill_all('anon attempt', true);
    raise exception 'CASE A2 FAILED: expected 42501 (not authenticated)';
  exception
    when sqlstate '42501' then null;   -- expected
  end;
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.bots where trading_enabled and deleted_at is null) = 2,
    'CASE A2: null-uid denial must not change bots';
  assert (select count(*) from public.audit_logs where event_type = 'operator.kill_all') = 0,
    'CASE A2: null-uid denial must NOT write an audit row';
end $$;

-- ===========================================================================
-- CASE B — clean operator kill via the DEFAULT (call with ONLY p_reason, so
-- p_hard_lock defaults to TRUE): proves default=true by asserting statuses become
-- paused. Expect ok=true, SAFE, enabled_after=0, all paused, exactly one audit row.
-- (queue empty, worker running.)
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.operator_kill_all('clean kill');   -- p_hard_lock OMITTED → must default to true
  assert (r->>'ok')::boolean                 = true,       'CASE B: ok=true';
  assert (r->>'kill_applied')::boolean        = true,       'CASE B: kill_applied=true';
  assert (r->>'requires_attention')::boolean  = false,      'CASE B: requires_attention=false';
  assert (r->>'operational_state')            = 'SAFE',     'CASE B: SAFE';
  assert (r->>'enabled_bots_after')::int      = 0,          'CASE B: enabled_bots_after=0';
  assert (r->>'open_trades')::int             = 0,          'CASE B: open_trades=0';
  assert (r->>'queue_length')::int            = 0,          'CASE B: queue_length=0';
  assert (r->>'worker_state')                 = 'running',  'CASE B: worker_state reported';
  assert (r->>'audit_id') is not null,                      'CASE B: audit_id present';
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.bots where trading_enabled and deleted_at is null) = 0,
    'CASE B: all bots trading_enabled=false';
  assert (select count(*) from public.bots where status = 'active' and deleted_at is null) = 0,
    'CASE B: DEFAULT hard_lock (p_hard_lock omitted) paused all active bots';
  assert (select count(*) from public.bots where status = 'paused' and deleted_at is null) = 2,
    'CASE B: both bots now paused (proves default hard_lock=true)';
  assert (select count(*) from public.audit_logs where event_type = 'operator.kill_all') = 1,
    'CASE B: exactly one audit row';
  assert (select actor_type::text from public.audit_logs where event_type = 'operator.kill_all') = 'user',
    'CASE B: audit actor_type=user';
  assert (select actor_id from public.audit_logs where event_type = 'operator.kill_all')
         = '00000000-0000-0000-0000-0000000000a1',
    'CASE B: audit actor_id = operator uid';
  -- CONCRETE no-secret assertion: neither before_state nor after_state may contain any of
  -- webhook_secret_hash / token / secret / credential (case-insensitive substring in JSON text).
  assert (select count(*) from public.audit_logs
            where event_type = 'operator.kill_all'
              and (before_state::text ~* '(webhook_secret_hash|token|secret|credential)'
                or after_state::text  ~* '(webhook_secret_hash|token|secret|credential)')) = 0,
    'CASE B: audit before/after_state must not contain webhook_secret_hash/token/secret/credential';
end $$;

-- ===========================================================================
-- CASE C — idempotent second kill (continues from B's killed state): still
-- kill_applied=true, enabled_after=0, and a SECOND audit row is written.
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.operator_kill_all('idempotent second', true);
  assert (r->>'kill_applied')::boolean   = true, 'CASE C: kill_applied=true on repeat';
  assert (r->>'enabled_bots_after')::int = 0,    'CASE C: enabled_bots_after=0 on repeat';
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.audit_logs where event_type = 'operator.kill_all') = 2,
    'CASE C: second kill is also audited (no silent no-op)';
  -- NOTE: created_at is the TRANSACTION timestamp (constant within this single-transaction
  -- fixture), so rows cannot be ordered by it. Assert the SET of updated_rows across the two
  -- kills instead: the first kill disabled 2 bots (updated_rows=2); the second idempotent kill
  -- disabled none (updated_rows=0).
  assert (select count(*) from public.audit_logs
            where event_type = 'operator.kill_all' and (after_state->>'updated_rows')::int = 2) = 1,
    'CASE C: first kill audit recorded updated_rows=2';
  assert (select count(*) from public.audit_logs
            where event_type = 'operator.kill_all' and (after_state->>'updated_rows')::int = 0) = 1,
    'CASE C: second (idempotent) kill audit recorded updated_rows=0';
end $$;
rollback to savepoint seeded;   -- restore 2 enabled+active bots, drop audit rows

-- ===========================================================================
-- CASE D — explicit hard_lock=false: disables trading, leaves status unchanged.
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.operator_kill_all('no hard lock', false);
  assert (r->>'kill_applied')::boolean   = true, 'CASE D: kill_applied=true';
  assert (r->>'enabled_bots_after')::int = 0,    'CASE D: enabled_bots_after=0';
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.bots where trading_enabled and deleted_at is null) = 0,
    'CASE D: trading disabled';
  -- statuses must be EXACTLY the seeded baseline: both still active, none paused.
  assert (select count(*) from public.bots where status = 'active' and deleted_at is null) = 2,
    'CASE D: hard_lock=false leaves both statuses active (baseline)';
  assert (select count(*) from public.bots where status = 'paused' and deleted_at is null) = 0,
    'CASE D: hard_lock=false paused NOTHING (exact baseline preserved)';
end $$;
rollback to savepoint seeded;

-- ===========================================================================
-- CASE E — open_trades>0 => ATTENTION (kill_applied=true but ok=false).
-- ===========================================================================
insert into public.trades (bot_id, user_id, signal_id, client_order_id, side, trading_pair, quantity, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   'sig-open-1', 'PRX_open_1', 'buy', 'BTCUSDT', 1, 'pending');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare r jsonb;
begin
  r := public.operator_kill_all('kill with open trade', true);
  assert (r->>'kill_applied')::boolean       = true,        'CASE E: kill still applied';
  assert (r->>'ok')::boolean                 = false,       'CASE E: ok=false with open trade';
  assert (r->>'requires_attention')::boolean = true,        'CASE E: requires_attention=true';
  assert (r->>'operational_state')           = 'ATTENTION', 'CASE E: ATTENTION';
  assert (r->>'open_trades')::int            = 1,           'CASE E: open_trades=1 reported';
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.bots where trading_enabled and deleted_at is null) = 0,
    'CASE E: kill applied despite ATTENTION';
end $$;
rollback to savepoint seeded;   -- drops the trade + the kill

-- ===========================================================================
-- CASE F — queue_length>0 => ATTENTION. LOCAL-ONLY via pgmq.send; guarded/skipped
-- if the local pgmq queue is absent (NEVER fabricate queue rows in a linked DB).
-- ===========================================================================
-- CP2 PASS does NOT require pgmq: if the local queue is absent this branch is SKIPPED /
-- DEFERRED to Slice 5 (never fabricate queue rows). The final summary re-detects pgmq
-- presence and reports whether the queue branch actually ran.
do $$
declare r jsonb; has_q boolean;
begin
  select exists (select 1 from pgmq.list_queues() where queue_name = 'trade_signals') into has_q;
  if not has_q then
    raise notice 'CASE F SKIPPED: local pgmq queue trade_signals absent → queue ATTENTION branch DEFERRED to Slice 5 (no fake rows).';
    return;
  end if;
  perform pgmq.send('trade_signals', '{"test":"kill-attention"}'::jsonb);   -- transactional; undone by rollback
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  r := public.operator_kill_all('kill with queued msg', true);
  perform set_config('request.jwt.claims', '', true);
  assert (r->>'kill_applied')::boolean       = true,        'CASE F: kill still applied';
  assert (r->>'ok')::boolean                 = false,       'CASE F: ok=false with queued message';
  assert (r->>'requires_attention')::boolean = true,        'CASE F: requires_attention=true';
  assert (r->>'operational_state')           = 'ATTENTION', 'CASE F: ATTENTION';
  assert (r->>'queue_length')::int          >= 1,           'CASE F: queue_length>=1 reported';
  raise notice 'CASE F RAN: queue ATTENTION branch verified against local pgmq.';
end $$;
rollback to savepoint seeded;   -- drops the queued message + the kill

-- ===========================================================================
-- CASE G — invalid p_reason => 22023 (bad input, NOT 42501), zero effect, no audit.
--   G1 over-length (>500). G2 control char (newline) rejected by ^[ -~]*$.
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  -- G1: over-length (>500)
  begin
    perform public.operator_kill_all(repeat('x', 501), true);
    raise exception 'CASE G1 FAILED: expected 22023 for >500 chars';
  exception when sqlstate '22023' then null; end;

  -- G2: REAL newline control char (chr(10)) — not the literal two-char string "\n"
  begin
    perform public.operator_kill_all('line1' || chr(10) || 'line2', true);
    raise exception 'CASE G2 FAILED: expected 22023 for newline control char';
  exception when sqlstate '22023' then null; end;

  -- G3: REAL tab control char (chr(9))
  begin
    perform public.operator_kill_all('col1' || chr(9) || 'col2', true);
    raise exception 'CASE G3 FAILED: expected 22023 for tab control char';
  exception when sqlstate '22023' then null; end;
end $$;
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.bots where trading_enabled and deleted_at is null) = 2,
    'CASE G: invalid reason must not change bots';
  assert (select count(*) from public.audit_logs where event_type = 'operator.kill_all') = 0,
    'CASE G: invalid reason must NOT write an audit row';
end $$;
rollback to savepoint seeded;

-- ---- Final summary (honest queue coverage) --------------------------------
do $$
begin
  if exists (select 1 from pgmq.list_queues() where queue_name = 'trade_signals') then
    raise notice 'ALL 019 TESTS PASSED — including CASE F (queue ATTENTION ran against local pgmq).';
  else
    raise notice 'ALL 019 TESTS PASSED — EXCEPT CASE F queue ATTENTION which was DEFERRED (local pgmq absent). CP2 PASS excludes the queue runtime branch; it is covered by static review + Slice 5.';
  end if;
end $$;

-- ---- Cleanup / no-leak guarantee ------------------------------------------
--   * The entire script is one transaction and ends in ROLLBACK — no COMMIT anywhere,
--     so NO seeded rows (auth.users/profiles/bots/trades/worker_status/pgmq) persist.
--   * Every set_config(...) uses is_local => true (transaction-scoped) and each case
--     resets 'request.jwt.claims' to '' after use; the final ROLLBACK discards them too.
--   * No set_config(..., false) session write exists (grep: only 'true'), so no session leak.
rollback;
