# LIVE-PATH — promote credential to `valid` (execution packet)

Promote credential `1164c49b-…` from `pending_validation` → `valid`, recording the validation evidence hash.
**DO NOT EXECUTE until approved.** DB status change only — no bot repoint, no trading enable, no order, no A11.

Evidence to record (from the Railway Console read-only validation run):
`evidence_hash = b11ba031c8e4f74889d16f5df1847372decac7b02e42717aa8352adc6e3afb91`
(all flags true: withdrawals_off · ip_restrict · spot_enabled · universal_transfer_off · internal_transfer_off · margin_off · egress_ip_ok · auth_ok).

## 1. PRE read-back (read-only — ABORT on mismatch)
```sql
select
  (select status               from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082') as cred_status,          -- expect 'pending_validation'
  (select exchange_environment from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082') as cred_env,             -- expect 'mainnet'
  (select status               from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                      as bot_status,           -- expect 'paused'
  (select credential_id        from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                      as bot_credential_id,    -- expect '594b9895-…' (not repointed)
  (select trading_enabled      from public.bots where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2')                      as bot_trading_enabled;  -- expect false
```
ABORT if `cred_status ≠ 'pending_validation'` (already promoted / changed), env not mainnet, bot not paused,
bot repointed, or trading enabled.

## 2. Mutation (approval-gated) — CAS on the pending status; records evidence
```sql
update public.user_exchange_credentials
set status = 'valid',
    last_validated_at = now(),
    permissions_confirmed = jsonb_build_object(
      'method', 'read_only_worker_validation',
      'withdrawals_off', true, 'ip_restrict', true, 'spot_enabled', true,
      'universal_transfer_off', true, 'internal_transfer_off', true, 'margin_off', true,
      'egress_ip_ok', true, 'auth_ok', true,
      'evidence_hash', 'b11ba031c8e4f74889d16f5df1847372decac7b02e42717aa8352adc6e3afb91',
      'validated_at', now()
    )
where id = '1164c49b-bf7a-4593-802f-920d76669082'
  and status = 'pending_validation'
returning id, status, last_validated_at, (permissions_confirmed->>'evidence_hash') as evidence_hash;
```
- CAS guard `and status = 'pending_validation'` → expect **exactly 1 row**; 0 rows ⇒ it was not pending
  (already promoted / changed) — investigate, do not retry blindly.
- Changes only this credential's `status` + evidence. Does **not** touch `public.bots` (no repoint).

## 3. POST read-back
```sql
select id, status, exchange_environment,
       (permissions_confirmed->>'evidence_hash') as evidence_hash, last_validated_at
from public.user_exchange_credentials where id='1164c49b-bf7a-4593-802f-920d76669082';
-- expect: status='valid', exchange_environment='mainnet',
--         evidence_hash='b11ba031c8e4f74889d16f5df1847372decac7b02e42717aa8352adc6e3afb91'

select id, status, trading_enabled, credential_id from public.bots
where id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
-- expect UNCHANGED: status='paused', trading_enabled=false, credential_id='594b9895-…' (no repoint)
```

## 4. Rollback (only if needed)
```sql
update public.user_exchange_credentials
set status='pending_validation', permissions_confirmed='{}'::jsonb, last_validated_at=null
where id='1164c49b-bf7a-4593-802f-920d76669082' and status='valid';
```
Restores the pre-promotion state. Nothing else changes (no bot, no Vault secret).

## Boundaries
Packet only, not executed. Promotes ONE credential's `status` + records the evidence hash. **No bot repoint ·
no trading enable · no order · no A11 · no deploy.** The bot remains `paused` on its testnet credential; the
new mainnet credential is now `valid` but **not yet used by any bot** (repoint is a separate, later,
approved step).

## Next (each separate + approved, AFTER promotion)
1. Repoint bot `2dcaddba` → credential `1164c49b` (guarded; the composite FK 021 requires (id, user_id) match).
2. A11 tiny-live arm (tiny size, kill-switch armed, monitoring, abort criteria).
3. First micro real-money order. Real funds NO-GO until A11.
