# LIVE-PATH — attach-orphan EXECUTION packet (Option A)

Create ONE `user_exchange_credentials` row pointing at the existing orphan Vault secret
(fp `d14d87b1..ed6a76c5`). **DO NOT EXECUTE until approved.** Postgres-context insert only; no new secret,
no delete, no repoint, no trading enable, no order. The full `vault_secret_id`/secret is never printed —
resolved server-side by fingerprint.

Fixed values: bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` · user `66e1b075-930e-4a20-9289-ca8668699eea` ·
label `mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2` · expected bot cred `594b9895-7180-4aa9-a8fe-41879c913f6d` · expected exchange `aca29e72-6dd1-4844-809f-16b1c63f775c` (Binance).

> Runs via `supabase db query --linked` — its login role is elevated (it created `create_vault_secret` /
> ran CREATE FUNCTION 031), so it HAS INSERT here, where the script's `service_role` (INSERT=false) failed.

## 1. PRE read-back (read-only — ABORT on any mismatch)
```sql
select
  (select count(*) from vault.secrets
     where left(id::text,8)='d14d87b1' and right(id::text,8)='ed6a76c5')                     as fp_matches,
  (select count(*) from public.user_exchange_credentials
     where label='mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                    as existing_label_rows,
  (select count(*) from public.user_exchange_credentials
     where user_id='66e1b075-930e-4a20-9289-ca8668699eea'
       and exchange_environment='mainnet' and deleted_at is null)                             as existing_mainnet,
  (select status         from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')    as bot_status,
  (select trading_enabled from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')   as bot_trading_enabled,
  (select credential_id  from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')    as bot_credential_id,
  (select c.exchange_id from public.user_exchange_credentials c
     where c.id = (select credential_id from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')) as resolved_exchange_id,
  has_table_privilege(current_user,'public.user_exchange_credentials','INSERT')               as role_can_insert;
```
Expect EXACTLY:
- `fp_matches = 1` · `existing_label_rows = 0` · `existing_mainnet = 0`
- `bot_status = 'paused'` · `bot_trading_enabled = false`
- `bot_credential_id = '594b9895-7180-4aa9-a8fe-41879c913f6d'` (unchanged)
- `resolved_exchange_id = 'aca29e72-6dd1-4844-809f-16b1c63f775c'`
- `role_can_insert = true`

**ABORT** if any differs (esp. `fp_matches ≠ 1`, `existing_label_rows > 0`, `bot_status ≠ 'paused'`,
`bot_trading_enabled ≠ false`, `role_can_insert = false`).

## 2. Mutation (postgres-context; resolves orphan by fingerprint; re-guards inside the txn)
```sql
do $$
declare v_secret uuid; v_matches int; v_exchange uuid;
begin
  select count(*) into v_matches from vault.secrets
   where left(id::text,8)='d14d87b1' and right(id::text,8)='ed6a76c5';
  if v_matches <> 1 then raise exception 'orphan fingerprint matches % secrets (expected 1)', v_matches; end if;

  if exists (select 1 from public.user_exchange_credentials
             where label='mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2') then
    raise exception 'credential row already exists for this label'; end if;

  select id into v_secret from vault.secrets
   where left(id::text,8)='d14d87b1' and right(id::text,8)='ed6a76c5';

  select c.exchange_id into v_exchange
    from public.user_exchange_credentials c
   where c.id = (select credential_id from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2');
  if v_exchange is null then raise exception 'could not resolve exchange_id from the bot credential'; end if;

  insert into public.user_exchange_credentials
    (user_id, exchange_id, vault_secret_id, label, status, exchange_environment)
  values
    ('66e1b075-930e-4a20-9289-ca8668699eea', v_exchange, v_secret,
     'mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2', 'pending_validation', 'mainnet');

  raise notice 'attach-orphan OK: credential row inserted (pending_validation, mainnet).';
end $$;
```
- `status='pending_validation'`, `exchange_environment='mainnet'`, label as fixed, `vault_secret_id` = the
  existing orphan (resolved by fp — never printed). Does **not** touch `public.bots`.
- The C-1 trigger (026) passes (orphan not tied to another user); the unique `(user_id, exchange_id, label)`
  constraint passes (no existing row).

## 3. POST read-back (read-only — never select the vault_secret_id VALUE)
```sql
select id, user_id, exchange_environment, status, label
from public.user_exchange_credentials
where label='mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect 1 row: user_id=66e1b075-…, exchange_environment='mainnet', status='pending_validation'

select count(*) as vault_secrets from vault.secrets;    -- expect 3 (unchanged — no new secret)

select id, status, trading_enabled, credential_id from public.bots
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect UNCHANGED: status='paused', trading_enabled=false, credential_id='594b9895-…' (no repoint)
```

## 4. Rollback (only if needed)
Delete the credential row **only if unused** (no bot repointed to it); never delete the Vault secret here.
```sql
delete from public.user_exchange_credentials c
where c.label = 'mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  and not exists (select 1 from public.bots b where b.credential_id = c.id);
```
Do **not** run `delete_vault_secret` on the orphan unless separately approved (destructive; the whole point of
Option A is to keep and reuse it).

## Next step (after attach, separate approval)
Worker **read-only** validation from the Railway static IPs → promote the credential `valid`. No order, no
repoint, no trading enable, no A11.

## Boundaries
Nothing executed. No new Vault secret · orphan not deleted · no bot repoint · no trading enable · no deploy ·
no mainnet order. The insert reuses the existing orphan `vault_secret_id`; the value is never printed.
