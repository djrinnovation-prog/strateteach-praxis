# LIVE-PATH — repoint bot to the valid mainnet credential (execution packet)

Repoint bot `2dcaddba-…` `credential_id`: testnet `594b9895-…` → valid mainnet `1164c49b-…`.
**DO NOT EXECUTE until approved.** Changes ONLY `bots.credential_id`. Keeps `status='paused'` and
`trading_enabled=false`. No activation, no trading enable, no order, no A11, no deploy.

Owner (both bot + credential): `66e1b075-930e-4a20-9289-ca8668699eea`.

## Invariants this must satisfy (verified in PRE)
- **Composite ownership FK (021):** `bots(credential_id, user_id)` → `user_exchange_credentials(id, user_id)`.
  The new credential `1164c49b-…` must have `user_id = 66e1b075-…` (same as the bot) — it does.
- **Single-use index (023):** among LIVE bots, `credential_id` is unique. No other live bot may already
  reference `1164c49b-…` — verify 0.
- Bot must be `paused` + `trading_enabled=false` + no open trades (repoint only a quiescent bot).

## 1. PRE read-back (read-only — ABORT on any mismatch)
```sql
select
  (select user_id         from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                       as bot_user_id,          -- 66e1b075-…
  (select status          from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                       as bot_status,           -- 'paused'
  (select trading_enabled from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                       as bot_trading_enabled,  -- false
  (select credential_id   from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                       as bot_credential_id,    -- '594b9895-…' (current)
  (select count(*) from public.trades t where t.bot_id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
     and t.deleted_at is null and t.status in ('pending','submitted','unknown'))                                 as open_trades,          -- 0
  (select status               from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082') as new_cred_status,  -- 'valid'
  (select exchange_environment from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082') as new_cred_env,     -- 'mainnet'
  (select user_id              from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082') as new_cred_user,    -- 66e1b075-… (FK match)
  (select count(*) from public.bots where credential_id='1164c49b-bf7a-4593-802f-920d76669082' and deleted_at is null) as other_bots_on_new_cred; -- 0 (single-use)
```
Expect: `bot_user_id=66e1b075-…` · `bot_status='paused'` · `bot_trading_enabled=false` ·
`bot_credential_id='594b9895-…'` · `open_trades=0` · `new_cred_status='valid'` · `new_cred_env='mainnet'` ·
`new_cred_user=66e1b075-…` · `other_bots_on_new_cred=0`.
**ABORT** on any mismatch (esp. new cred not `valid`/`mainnet`, owner mismatch, `open_trades>0`,
`other_bots_on_new_cred>0`, bot not paused/disabled).

## 2. Mutation (approval-gated) — repoint credential_id ONLY; CAS-guarded
```sql
update public.bots
set credential_id = '1164c49b-bf7a-4593-802f-920d76669082'
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  and user_id = '66e1b075-930e-4a20-9289-ca8668699eea'
  and credential_id = '594b9895-7180-4aa9-a8fe-41879c913f6d'  -- CAS on the current testnet cred
  and status = 'paused'                                        -- only while paused
  and trading_enabled = false                                  -- only while disabled
returning id, credential_id, status, trading_enabled;
```
- Changes ONLY `credential_id`. `status` stays `paused`, `trading_enabled` stays `false` (not in the SET).
- The WHERE guards (owner + current cred + paused + disabled) → expect **exactly 1 row**; 0 rows ⇒ state
  drifted (investigate, do not retry blindly). The composite FK (021) + single-use index (023) enforce the
  ownership + uniqueness on write.

## 3. POST read-back
```sql
select id, credential_id, status, trading_enabled from public.bots
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect: credential_id='1164c49b-…', status='paused', trading_enabled=false

select id, status, exchange_environment from public.user_exchange_credentials
where id in ('1164c49b-bf7a-4593-802f-920d76669082','594b9895-7180-4aa9-a8fe-41879c913f6d');
-- expect: 1164c49b = valid/mainnet ; 594b9895 = testnet (untouched, still exists — not deleted)

select count(*) from public.bots
where credential_id='1164c49b-bf7a-4593-802f-920d76669082' and deleted_at is null;   -- expect 1 (single-use holds)
```

## 4. Rollback (only if needed)
```sql
update public.bots
set credential_id = '594b9895-7180-4aa9-a8fe-41879c913f6d'
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  and user_id = '66e1b075-930e-4a20-9289-ca8668699eea'
  and credential_id = '1164c49b-bf7a-4593-802f-920d76669082'
  and status = 'paused' and trading_enabled = false
returning id, credential_id;
```
Restores the testnet credential. Nothing else changes.

## Important semantics after repoint
The bot now references a **mainnet, valid** credential but stays **paused** + **trading_enabled=false** → it
still cannot trade. Actually placing a mainnet order additionally requires the **worker in production tier**
(`assertExchangeEnvironment` would otherwise block a testnet-tier worker on a mainnet credential — fail-closed)
AND activation — both part of **A11**. This repoint alone moves NO funds.

## Boundaries
Packet only, not executed. Changes exactly one bot's `credential_id`. **No activation · no trading enable ·
no status change · no order · no A11 · no deploy.** Real funds NO-GO until A11.
