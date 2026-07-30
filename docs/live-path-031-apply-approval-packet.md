# LIVE-PATH — 031 apply + track: EXACT approval packet

Ready-to-run, operator-approved, **surgical** apply of `create_vault_secret` (031) to the **linked** DB.
**DO NOT EXECUTE until approved.** DDL-only function add — creates **no** Vault secret, **no** credential row,
touches **no** data. `db query --linked --file` only; **never `db push`**.

State: commit `5980102` pushed · 031 local-validated · 031 not applied to linked.

---

## 1. PRE checks (read-only; run first)
Run this read-only block against linked and confirm the expectations:
```sql
-- (a) is 031 already tracked? expect 0 rows
select version, name from supabase_migrations.schema_migrations where version = '031';

-- (b) current tracked versions + baseline count (so the delta is provable, and you can see whether
--     026-030 are applied yet — 031 is independent of them either way)
select version from supabase_migrations.schema_migrations order by version;
select count(*) as total_rows_before from supabase_migrations.schema_migrations;

-- (c) does create_vault_secret already exist? expect 0 rows
select proname from pg_proc where proname = 'create_vault_secret';

-- (d) Vault baseline (to prove the apply creates nothing)
select count(*) as vault_secrets_before from vault.secrets;
```
Expect: (a) 0 rows · (c) 0 rows · record `total_rows_before` and `vault_secrets_before`.
Also confirm: linked project is the intended one; `5980102` is on `origin/main` (✅).

## 2. APPLY 031 only (surgical — approval-gated)
```
supabase db query --linked --file supabase/migrations/031_create_vault_secret_function.sql
```
Applies ONLY 031. No seeds, no other migrations, no `db push`.

## 3. Read-backs (non-mutating; run after apply)
```sql
-- function present + SECURITY DEFINER + search_path pinned
select p.proname, p.prosecdef, array_to_string(p.proconfig, ',') as config
from pg_proc p where p.proname = 'create_vault_secret';
-- expect exactly one row: create_vault_secret | t | search_path=

-- grants: service_role only
select has_function_privilege('service_role','public.create_vault_secret(text,text,text)','EXECUTE') as svc,
       has_function_privilege('anon','public.create_vault_secret(text,text,text)','EXECUTE') as anon,
       has_function_privilege('authenticated','public.create_vault_secret(text,text,text)','EXECUTE') as authd;
-- expect: t | f | f

-- proves the apply created NOTHING in Vault
select count(*) as vault_secrets_after from vault.secrets;   -- expect == vault_secrets_before
```

## 4. TRACK 031 only (reviewed metadata-only insert — same form as 024/025)
```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('031', 'create_vault_secret_function');
-- verify
select version, name from supabase_migrations.schema_migrations where version = '031';   -- expect 1 row
select count(*) as total_rows_after from supabase_migrations.schema_migrations;           -- expect before + 1
```

## 5. `migration list --linked`
```
supabase migration list --linked
```
Expect: **031** now shows on **Remote** (tracked). NOTE: **026–030 may still show as local-only / pending**
if they haven't been applied+tracked yet — that is expected and SEPARATE (031 is independent of them). This
step verifies **031's own** row is tracked; do not expect a globally-clean Local==Remote unless 026–030 were
already applied.

## 6. ROLLBACK (only if needed)
```sql
drop function if exists public.create_vault_secret(text, text, text);
delete from supabase_migrations.schema_migrations where version = '031';
```
Safe — nothing depends on the function until operator provisioning runs (separate, later, approved step).

## 7. STOP
After tracking + read-backs pass, STOP. Do NOT run operator provisioning, create any Vault secret, insert any
credential row, repoint any bot, enable trading, deploy, or place any order.

---

**Boundaries:** nothing executed by this packet. On approval, this is a DDL-only function add + one metadata
tracking row — **no linked data beyond the function object, no real Binance secret, no production Vault write,
no credential row, no deploy, no mainnet order.**
