-- ============================================================================
-- LOCAL-ONLY test for migrations 024 + 025 — Slice 4C requeue recovery.
-- LOCAL Supabase ONLY (never --linked). Requires migrations 001..025 applied
-- locally (`supabase db reset`). One transaction, ROLLS BACK.
--   psql "$LOCAL_DSN" -v ON_ERROR_STOP=1 -f supabase/tests/025_webhook_requeue_claim.test.sql
-- ============================================================================

begin;

-- ---- Migration shape: enum value, columns, index, RPC ----------------------
do $$
begin
  assert exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
                 where t.typname='webhook_log_status' and e.enumlabel='queued'),
    '024: queued enum value present';
  assert exists (select 1 from information_schema.columns where table_schema='public'
                 and table_name='webhook_logs' and column_name='requeue_attempts'), '025: requeue_attempts col';
  assert exists (select 1 from information_schema.columns where table_schema='public'
                 and table_name='webhook_logs' and column_name='next_retry_at'), '025: next_retry_at col';
  assert exists (select 1 from information_schema.columns where table_schema='public'
                 and table_name='webhook_logs' and column_name='last_requeue_error'), '025: last_requeue_error col';
  assert exists (select 1 from pg_indexes where schemaname='public' and tablename='webhook_logs'
                 and indexname='webhook_logs_recovery_idx'), '025: recovery index present';
  assert exists (select 1 from pg_proc where proname='claim_webhook_requeue'), '025: claim RPC present';
end $$;

-- ---- Fixtures: 1 user, 1 bot (credential_id NULL is permitted) --------------
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-000000000025', 'u025@test.local');
insert into public.bots (id, user_id, credential_id, name, trading_pair, webhook_secret_hash, status) values
  ('b0000000-0000-0000-0000-0000000b0250', 'a0000000-0000-0000-0000-000000000025', NULL, 'bot025', 'AAAUSDT', 'x', 'active');

-- webhook_logs fixtures covering every eligibility branch.
insert into public.webhook_logs (bot_id, signal_id, raw_payload, status, received_at, requeue_attempts, next_retry_at) values
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-qf-eligible',     '{"action":"buy"}',  'queue_failed', now(),                        0, NULL),                        -- eligible
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-stale-accepted',  '{"action":"sell"}', 'accepted',     now() - interval '120 sec',   0, NULL),                        -- eligible (crash-window)
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-fresh-accepted',  '{"action":"buy"}',  'accepted',     now(),                        0, NULL),                        -- NOT eligible (fresh)
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-queued',          '{"action":"buy"}',  'queued',       now(),                        0, NULL),                        -- NOT eligible (done)
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-qf-atcap',        '{"action":"buy"}',  'queue_failed', now(),                        5, NULL),                        -- NOT eligible (at cap)
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-qf-leased',       '{"action":"buy"}',  'queue_failed', now(),                        1, now() + interval '300 sec'),  -- NOT eligible (backoff lease)
  ('b0000000-0000-0000-0000-0000000b0250', 'sig-qf-noaction',     '{}'::jsonb,         'queue_failed', now(),                        0, NULL);                        -- eligible; NULL-safe side (worker guards it)

-- ---- Claim #1: only the eligible rows, with derived side (NULL-safe) --------
create temporary table claimed_1 on commit drop as
  select * from public.claim_webhook_requeue(50, 60, 5);

do $$
declare n int;
begin
  select count(*) into n from claimed_1;
  assert n = 3, format('025: expected 3 claimed, got %s', n);
  assert exists (select 1 from claimed_1 where signal_id='sig-qf-eligible'    and side='buy'),  '025: qf eligible claimed (side buy)';
  assert exists (select 1 from claimed_1 where signal_id='sig-stale-accepted' and side='sell'), '025: stale accepted claimed (side sell)';
  -- Missing action ⇒ RPC returns NULL side WITHOUT crashing; the worker sweeper marks invalid_action + never enqueues.
  assert exists (select 1 from claimed_1 where signal_id='sig-qf-noaction'    and side is null), '025: missing action ⇒ NULL-safe side';
  assert not exists (select 1 from claimed_1
                     where signal_id in ('sig-fresh-accepted','sig-queued','sig-qf-atcap','sig-qf-leased')),
    '025: ineligible rows must not be claimed';
end $$;

-- ---- Side effects: claimed rows incremented + leased; others untouched -----
do $$
begin
  assert (select requeue_attempts from public.webhook_logs where signal_id='sig-qf-eligible') = 1,   '025: qf attempts incremented';
  assert (select next_retry_at    from public.webhook_logs where signal_id='sig-qf-eligible') > now(),'025: qf leased into the future';
  assert (select requeue_attempts from public.webhook_logs where signal_id='sig-stale-accepted') = 1, '025: stale attempts incremented';
  -- The claim must NOT change status (worker flips to queued only after a confirmed enqueue).
  assert (select status::text from public.webhook_logs where signal_id='sig-stale-accepted') = 'accepted', '025: claim leaves status unchanged';
  -- Untouched rows.
  assert (select requeue_attempts from public.webhook_logs where signal_id='sig-fresh-accepted') = 0, '025: fresh untouched';
  assert (select requeue_attempts from public.webhook_logs where signal_id='sig-qf-atcap')       = 5, '025: at-cap untouched';
  assert (select requeue_attempts from public.webhook_logs where signal_id='sig-qf-leased')      = 1, '025: leased untouched';
end $$;

-- ---- Claim #2 (immediate): the lease hides the just-claimed rows ⇒ 0 -------
create temporary table claimed_2 on commit drop as
  select * from public.claim_webhook_requeue(50, 60, 5);

do $$
declare n int;
begin
  select count(*) into n from claimed_2;
  assert n = 0, format('025: second immediate claim must be 0 (backoff lease), got %s', n);
end $$;

do $$ begin raise notice 'ALL 024/025 TESTS PASSED'; end $$;

rollback;
