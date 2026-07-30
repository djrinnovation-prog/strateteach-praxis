# LINKED-APPLY PACKET — 032 + 033 + 034 (StrateTeach pilot UI backend)

**PACKET ONLY — nothing applied here. Each of the three phases needs its own explicit approval and STOPs after
its read-back.** Prepares the linked DB for the StrateTeach pilot UI **without turning the UI on**
(`VITE_STRATETEACH_PILOT` stays OFF; no deploy). Surgical apply via `supabase db query --linked --file` — **never
`db push`** — matching the 026–031 method. TRACK each migration in `supabase_migrations.schema_migrations` **only
after** its read-back passes.

Migrations (all additive; two read RPCs + one guard trigger):
- **032** `operator_pilot_fleet` — ST-1 operator cockpit fleet (read-only). Committed `57138ea`.
- **033** `user_dashboard_rpcs` — `user_bot_dashboard()` + `user_pause_own_bot()`. Committed `bf2bfc0`.
- **034** `bots_user_field_lock` — `guard_bot_user_field_lock` trigger (ST-2b). Committed `b598b57`.

`schema_migrations` shape: `(version text, statements text[] NULL, name text)` → TRACK inserts use
`(version, name)` only, `version='0NN'`, `name='<file minus prefix/.sql>'`.

---

## Step 0 — verify commits are pushed (do FIRST)
- `57138ea` (032) — **confirmed on `origin/main`** (cached).
- `bf2bfc0` (033) + `b598b57` (034) — **NOT yet in cached `origin/main`; my shell cannot fetch.** → **You push
  first:** `git push origin main`. Then confirm (either paste `git log --oneline -1 origin/main` showing
  `b598b57`, or I re-check `git merge-base --is-ancestor` once fetched). **Do not apply any phase until all three
  are on `origin/main`.**

---

## PHASE 1 — migration 032 (`operator_pilot_fleet`)

### 1a. PRE (read-only)
```sql
-- not tracked yet
select exists(select 1 from supabase_migrations.schema_migrations where version='032') as tracked_032;   -- expect false
-- function does not exist yet
select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='operator_pilot_fleet') as fn_exists;               -- expect false
-- baseline: current tracked tip
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;
```
ABORT if `tracked_032=true` or `fn_exists=true`.

### 1b. APPLY (approval-gated; surgical, NOT db push)
```
supabase db query --linked --file supabase/migrations/032_operator_pilot_fleet.sql
```
(The file is `begin;…commit;`-wrapped. If the CLI rejects multi-statement, apply the same file via the linked
SQL editor / psql — **never** `db push`.)

### 1c. READ-BACK (read-only — must all pass before TRACK)
```sql
select
  p.prosecdef                                                                         as security_definer,   -- true
  p.proconfig                                                                          as config,             -- {search_path=""}
  has_function_privilege('authenticated','public.operator_pilot_fleet()','execute')    as authed_exec,        -- true
  has_function_privilege('anon','public.operator_pilot_fleet()','execute')             as anon_exec,          -- false
  (pg_get_functiondef(p.oid) !~* '(vault_secret_id|webhook_secret_hash|api_key|api_secret|pepper)')
                                                                                        as no_secret_columns   -- true
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='operator_pilot_fleet';
```
Expect: `security_definer=true`, `config={search_path=""}`, `authed_exec=true`, `anon_exec=false`,
`no_secret_columns=true`.

### 1d. TRACK (only after 1c passes)
```sql
insert into supabase_migrations.schema_migrations (version, name) values ('032','operator_pilot_fleet');
select version, name from supabase_migrations.schema_migrations where version='032';   -- confirm 1 row
```
### 1e. **STOP** — report 1a–1d, await approval for Phase 2.

---

## PHASE 2 — migration 033 (`user_dashboard_rpcs`)

### 2a. PRE (read-only)
```sql
select exists(select 1 from supabase_migrations.schema_migrations where version='033') as tracked_033;   -- false
select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='user_bot_dashboard')  as dashboard_fn_exists,            -- false
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='user_pause_own_bot')  as pause_fn_exists;                -- false
```
ABORT if any is true.

### 2b. APPLY (approval-gated)
```
supabase db query --linked --file supabase/migrations/033_user_dashboard_rpcs.sql
```

### 2c. READ-BACK (read-only)
```sql
select p.proname,
       p.prosecdef                                                                         as security_definer,  -- true
       p.proconfig                                                                          as config,            -- {search_path=""}
       has_function_privilege('authenticated','public.'||p.proname||
         case when p.proname='user_pause_own_bot' then '(uuid)' else '()' end,'execute')    as authed_exec,       -- true
       has_function_privilege('anon','public.'||p.proname||
         case when p.proname='user_pause_own_bot' then '(uuid)' else '()' end,'execute')    as anon_exec,         -- false
       (pg_get_functiondef(p.oid) !~* '(vault_secret_id|webhook_secret_hash|api_key|api_secret|pepper)')
                                                                                             as no_secret_columns  -- true
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('user_bot_dashboard','user_pause_own_bot')
order by p.proname;
```
Expect **two rows**, both: `security_definer=true`, `config={search_path=""}`, `authed_exec=true`,
`anon_exec=false`, `no_secret_columns=true`.

### 2d. TRACK (only after 2c passes)
```sql
insert into supabase_migrations.schema_migrations (version, name) values ('033','user_dashboard_rpcs');
select version, name from supabase_migrations.schema_migrations where version='033';
```
### 2e. **STOP** — report 2a–2d, await approval for Phase 3.

---

## PHASE 3 — migration 034 (`bots_user_field_lock`, ST-2b)

### 3a. PRE (read-only)
```sql
select exists(select 1 from supabase_migrations.schema_migrations where version='034') as tracked_034;   -- false
select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='guard_bot_user_field_lock')      as guard_fn_exists;-- false
select exists(select 1 from pg_trigger where tgrelid='public.bots'::regclass
              and tgname='trg_bot_user_field_lock')                                     as trigger_exists;-- false
```
ABORT if any is true.

### 3b. APPLY (approval-gated)
```
supabase db query --linked --file supabase/migrations/034_bots_user_field_lock.sql
```

### 3c. READ-BACK (read-only — function + trigger active + exemption)
```sql
-- function: SECURITY DEFINER + operator/service exemption clause present (static)
select p.prosecdef                                                                as security_definer,     -- true
       p.proconfig                                                                 as config,               -- {search_path=""}
       (pg_get_functiondef(p.oid) ~* 'is_operator')                                as operator_exempt,      -- true
       (pg_get_functiondef(p.oid) ~* 'auth\.uid\(\) is null')                      as service_exempt        -- true
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='guard_bot_user_field_lock';

-- trigger present + ENABLED (tgenabled='O') as BEFORE UPDATE on bots
select tgname, tgenabled,                                     -- expect 'O' (enabled)
       (tgtype & 2) = 2  as is_before,                        -- BEFORE
       (tgtype & 16) = 16 as is_update                        -- UPDATE
from pg_trigger where tgrelid='public.bots'::regclass and tgname='trg_bot_user_field_lock';
```
Expect: `security_definer=true`, `config={search_path=""}`, `operator_exempt=true`, `service_exempt=true`;
trigger `tgenabled='O'`, `is_before=true`, `is_update=true`. (Behavioral proof — owner blocked / operator +
service exempt — was validated locally by `supabase/tests/034_bots_user_field_lock.test.sql`; we do NOT run a
behavioral seed on linked prod data.)

### 3d. TRACK (only after 3c passes)
```sql
insert into supabase_migrations.schema_migrations (version, name) values ('034','bots_user_field_lock');
select version, name from supabase_migrations.schema_migrations where version='034';
```
### 3e. **STOP** — report 3a–3d.

---

## FINAL — reconcile
```
supabase migration list --linked
```
Expect 032/033/034 shown as applied (Local == Remote), no pending. Report the tail of the list.

## Boundaries
No deploy. `VITE_STRATETEACH_PILOT` stays OFF (UI not lit). No secrets read/printed. No live trading. Linked DB
gains three additive, non-secret read/guard objects only; no data mutated. Each phase applies + reads-back +
tracks, then STOPS for approval.
