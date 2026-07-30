# LIVE-PATH — provisioning recovery packet (orphan Vault secret)

The real provisioning run created a Vault secret then failed the credential insert, leaving an **orphan Vault
secret with no credential row**. **Packet only — DO NOT EXECUTE.** Do not delete the secret, do not create
another secret, do not repoint the bot, no order.

## State (verified read-only)
- Orphan Vault secret **exists** — fingerprint `d14d87b1..ed6a76c5`; `vault.secrets` count = 3 (was 2).
- **No** `user_exchange_credentials` row exists for `label='mainnet/tiny-live/2dcaddba-…'` (0), and **no**
  mainnet credential exists at all (0).

## Exact failure cause
`service_role` privileges on `public.user_exchange_credentials` are **SELECT=true, INSERT=false, UPDATE=true**.
Credential rows were always created client-side via RLS, so migration 006 granted the worker SELECT+UPDATE
but never INSERT. The provisioning script inserts as `service_role`, so the insert failed with PostgREST
**42501 (permission denied)** — after `create_vault_secret` (a SECURITY DEFINER function, which runs as its
owner and does NOT need a service_role grant) had already succeeded. The script reported the generic
`credential_insert_failed` (now improved to surface the sanitized code — see the script change).

## Recovery — Option A (RECOMMENDED): attach the orphan to a credential row
Reuse the existing orphan (no new secret, no delete). The insert must run as **postgres**
(`db query --linked`), which has INSERT — not as service_role. It resolves the orphan's id **by fingerprint**
(the full id/secret is never printed) and the exchange_id from the bot's own credential.
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

  -- exchange_id from the bot's existing credential (Binance aca29e72-…; service_role couldn't read exchanges)
  select c.exchange_id into v_exchange
    from public.user_exchange_credentials c
   where c.id = (select credential_id from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2');
  if v_exchange is null then raise exception 'could not resolve exchange_id from the bot credential'; end if;

  insert into public.user_exchange_credentials
    (user_id, exchange_id, vault_secret_id, label, status, exchange_environment)
  values
    ('66e1b075-930e-4a20-9289-ca8668699eea', v_exchange, v_secret,
     'mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2', 'pending_validation', 'mainnet');
end $$;
```
POST verify (non-secret — never select the `vault_secret_id` value):
```sql
select id, user_id, exchange_environment, status, label
from public.user_exchange_credentials
where label='mainnet/tiny-live/2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect 1 row: user_id=66e1b075-…, exchange_environment='mainnet', status='pending_validation'
select id, status, trading_enabled, credential_id from public.bots
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect UNCHANGED: status='paused', trading_enabled=false, credential_id='594b9895-…' (no repoint)
select count(*) from vault.secrets;   -- still 3 (no new secret)
```
The C-1 trigger (026) passes: the orphan isn't tied to any other user. The unique `(user_id, exchange_id,
label)` constraint passes (no existing row). No bot touched.

## Recovery — Option B (ALTERNATIVE): delete the orphan (only if abandoning)
Separate, reviewed, destructive action — only if you decide NOT to reuse the secret:
```sql
select public.delete_vault_secret(
  (select id from vault.secrets where left(id::text,8)='d14d87b1' and right(id::text,8)='ed6a76c5')
);  -- returns true if deleted
```
After deletion, a later provisioning run would create a fresh secret. Do **not** delete if Option A is used.

## Durable fix for the script path (SEPARATE follow-up — not this recovery)
So future provisioning works via `service_role` without the postgres workaround, pick one (own packet, gated):
1. **Grant** `service_role INSERT ON public.user_exchange_credentials` (small migration), OR
2. **Preferred (C-1-aligned):** route credential creation through a new SECURITY DEFINER
   `create_exchange_credential(...)` function (like `create_vault_secret`), so service_role never needs raw
   INSERT and the server sets `vault_secret_id` inside the function. This matches C-1's "server-set pointer
   via a definer function" direction.

## Script improvement (task 7 — implemented, not committed)
`insertCredential` / `createVaultSecret` now attach a **sanitized** PG error (`{code, message, hint}` — uuids
scrubbed, `details` dropped because PG echoes row values there), surfaced by `main()` as
`{"event":"failed","error":"credential_insert_failed","pg":{"code":"42501",...}}`. `sanitizePg` unit-tested.
Had this been in place, the run would have reported `42501` directly. Mock tests 16/16; `node --check` OK.

## Boundaries
Nothing executed. No secret value printed, no full `vault_secret_id`, no new Vault secret, no delete, no
credential row created, no repoint, no trading enable, no deploy, no mainnet order.
