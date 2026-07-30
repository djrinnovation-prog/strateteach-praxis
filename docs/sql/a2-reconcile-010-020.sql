-- ============================================================================
-- a2-reconcile-010-020.sql  —  A2 migration-history reconcile (metadata only).
--
-- OPERATOR-RUN, surgical:  supabase db query --linked --file <this file>
-- **NEVER `db push`.**  This inserts ONLY tracking-metadata rows into
-- supabase_migrations.schema_migrations for the already-applied, live-verified
-- migrations 010-020. It makes NO schema/data change. Transaction-wrapped: any
-- guard failure RAISES and the whole thing ROLLS BACK (nothing committed).
--
-- Pre-verified (read-only, 2026-07-10): all 010-020 live objects present; tracking
-- has 001-008, no 009, no 010-020, no duplicates; PK = schema_migrations_pkey.
-- Uses explicit `where not exists` (does NOT rely on ON CONFLICT).
-- 009 is intentionally omitted (no file). UNEXECUTED — for Codex review.
-- ============================================================================

begin;

-- ---- PRE-INSERT GUARDS (fail-closed) ----------------------------------------
do $$
begin
  -- 001-008 must be present (8 rows)
  if (select count(*) from supabase_migrations.schema_migrations
        where version in ('001','002','003','004','005','006','007','008')) <> 8 then
    raise exception 'a2-reconcile PRE: expected 001-008 all present';
  end if;
  -- 009 must be absent (no file)
  if exists (select 1 from supabase_migrations.schema_migrations where version = '009') then
    raise exception 'a2-reconcile PRE: 009 must be ABSENT';
  end if;
  -- 010-020 must be absent before reconcile
  if exists (select 1 from supabase_migrations.schema_migrations
               where version in ('010','011','012','013','014','015','016','017','018','019','020')) then
    raise exception 'a2-reconcile PRE: 010-020 must be ABSENT before reconcile';
  end if;
end $$;

-- ---- INSERT (explicit where-not-exists; no reliance on ON CONFLICT) ----------
insert into supabase_migrations.schema_migrations (version, name)
select x.version, x.name
from ( values
  ('010','reconciliation_dlq_select_grant'),
  ('011','alert_readonly_role'),
  ('012','scope_user_select_policies_to_authenticated'),
  ('013','report_readonly_role'),
  ('014','bot_sizing_risk'),
  ('015','worker_status'),
  ('016','operator_status_rpc'),
  ('017','webhook_rate_limits'),
  ('018','is_operator_rpc'),
  ('019','operator_kill_all'),
  ('020','operator_status_add_id')
) as x(version, name)
where not exists (
  select 1 from supabase_migrations.schema_migrations m where m.version = x.version
);

-- ---- POST-INSERT VERIFICATION (same transaction; RAISE => ROLLBACK) ----------
do $$
begin
  -- 010-020 now present with EXACTLY the expected names (11 matches)
  if (
    select count(*) from supabase_migrations.schema_migrations m
    join ( values
      ('010','reconciliation_dlq_select_grant'),
      ('011','alert_readonly_role'),
      ('012','scope_user_select_policies_to_authenticated'),
      ('013','report_readonly_role'),
      ('014','bot_sizing_risk'),
      ('015','worker_status'),
      ('016','operator_status_rpc'),
      ('017','webhook_rate_limits'),
      ('018','is_operator_rpc'),
      ('019','operator_kill_all'),
      ('020','operator_status_add_id')
    ) as e(version, name) on e.version = m.version and e.name = m.name
  ) <> 11 then
    raise exception 'a2-reconcile POST: 010-020 not all present with expected names';
  end if;
  -- 009 still absent
  if exists (select 1 from supabase_migrations.schema_migrations where version = '009') then
    raise exception 'a2-reconcile POST: 009 unexpectedly present';
  end if;
  -- no duplicate versions
  if exists (select 1 from supabase_migrations.schema_migrations group by version having count(*) > 1) then
    raise exception 'a2-reconcile POST: duplicate version rows present';
  end if;
  raise notice 'a2-reconcile OK: 010-020 inserted with expected names; 009 absent; no duplicates.';
end $$;

commit;

-- Post-run evidence (read-only, after this file commits):
--   select version, name from supabase_migrations.schema_migrations order by version;  -- 001-008 + 010-020, no 009
--   supabase migration list --linked   -- (if supported) should show local == remote, nothing pending
