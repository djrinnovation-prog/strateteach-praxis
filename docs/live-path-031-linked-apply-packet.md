# LIVE-PATH — migration 031 linked-apply packet (create_vault_secret)

Apply `create_vault_secret` (031) to the **linked** DB. **Packet only — DO NOT APPLY.** Operator-run,
approval-gated, surgical (`db query --linked --file`, NEVER `db push`). Applying this migration only adds an
**unused function** — it creates **no** Vault secret, **no** credential row, and touches **no** data.

## What 031 is (recap)
`public.create_vault_secret(secret_value, secret_name, secret_description) → uuid` — SECURITY DEFINER,
`search_path=''`, **service_role-only**, wraps `vault.create_secret`, returns only the new `vault_secret_id`.
Committed `5980102`. Local `db reset` 001..031 clean; local SQL test passed (round-trip + dup-name reject +
grants; throwaway secret rolled back).

## Risk profile
- **Additive + idempotent:** `CREATE OR REPLACE FUNCTION` + `REVOKE`/`GRANT`. No table/column/enum/data
  change. Re-applying is safe.
- **Inert once applied:** nothing calls it until operator provisioning (a later, separate step). Applying it
  cannot create a secret or a credential row on its own.
- **No PITR** on this project (free plan) — but there is nothing destructive to recover from here; rollback =
  `DROP FUNCTION` (below). No pre-apply data backup is required for this migration.

## PRE checks (operator)
1. `5980102` is on `origin/main` (push first if not) so the linked apply matches committed source.
2. Local validation already green (this packet's recap). 
3. Confirm the linked project is the intended one (`supabase projects list` / linked ref) — this is a DDL-only
   function add.
4. Confirm `031` is not already tracked: `select version from supabase_migrations.schema_migrations where version='031';` → expect 0 rows.

## APPLY (operator, approval-gated) — surgical, never db push
```
supabase db query --linked --file supabase/migrations/031_create_vault_secret_function.sql
```
(Applies only 031. Does NOT run seeds, other migrations, or db push.)

## READ-BACK verification (operator) — non-mutating
Run against the linked DB (e.g. `supabase db query --linked --file <readback.sql>` or psql to the linked DSN):
```sql
-- function present + SECURITY DEFINER + search_path pinned
select p.proname, p.prosecdef,
       (select array_to_string(proconfig,',') from pg_proc where oid = p.oid) as config
from pg_proc p where p.proname = 'create_vault_secret';
-- expect: create_vault_secret | t | search_path=

-- grants: service_role only
select has_function_privilege('service_role','public.create_vault_secret(text,text,text)','EXECUTE') as svc,
       has_function_privilege('anon','public.create_vault_secret(text,text,text)','EXECUTE') as anon,
       has_function_privilege('authenticated','public.create_vault_secret(text,text,text)','EXECUTE') as authd;
-- expect: t | f | f

-- prove it created NOTHING in Vault yet
select count(*) from vault.secrets;   -- unchanged vs before apply
```

## TRACK (operator) — reviewed metadata-only insert
Record 031 so `migration list --linked` shows Local==Remote (same pattern used for 024/025):
```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('031', 'create_vault_secret_function');
```
Then confirm: `supabase migration list --linked` shows **031** on both Local and Remote, nothing pending.
(Confirm the exact `version` string matches the format of existing rows, e.g. `'031'`, before inserting.)

## POST checks
- Read-back matches the expected values above (function present, SECDEF, service_role-only, `vault.secrets`
  count unchanged).
- `migration list --linked`: 031 tracked, nothing else changed.
- No credential row, no Vault secret, no bot touched.

## ROLLBACK
- Remove the function: `drop function if exists public.create_vault_secret(text, text, text);`
- If tracked: `delete from supabase_migrations.schema_migrations where version='031';`
- Safe — nothing depends on it until operator provisioning is run (which is a separate, later, approved step).

## Boundaries
No apply performed here. When applied (on approval): DDL-only function add — **no linked data mutation beyond
the function object, no Vault secret, no credential row, no real Binance secret, no deploy, no mainnet order.**

## Next (after 031 is applied + tracked)
Operator provisioning (Doppler→Vault→credential row, `pending_validation`) becomes runnable — its own packet
(`live-path-operator-provisioning-packet.md`), still gated, still no order/activation.
