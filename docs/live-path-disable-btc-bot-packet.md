# LIVE-PATH — guarded disable packet: BTCUSDT tiny-live target

Set the BTCUSDT bot `active → paused` so the provisioning PRE check (`bot_not_disabled`) passes. **Packet
only — DO NOT EXECUTE.** Scoped to ONE bot; changes only `status`. No trading enable, no repoint, no order.

Target: bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` (BTCUSDT), owner `66e1b075-930e-4a20-9289-ca8668699eea`.
Current (from identify): `status='active'`, `trading_enabled=false`, `credential_id='594b9895-7180-4aa9-a8fe-41879c913f6d'` (testnet).

`paused` is the disable value (webhook rejects `bot_not_active`; worker skips) — the same status
`operator_kill_all` (019) uses. Runs as a privileged session (`db query --linked`, `auth.uid()` null), so the
M-2 operator-lock guard (027) does not interfere; this is a DISABLE, not a re-enable.

## 1. PRE read-back (read-only — ABORT if any mismatch)
```sql
select id, user_id, trading_pair, status, trading_enabled, credential_id,
       (select exchange_environment from public.user_exchange_credentials c where c.id = b.credential_id) as cred_env,
       (select count(*) from public.trades t
        where t.bot_id = b.id and t.deleted_at is null and t.status in ('pending','submitted','unknown')) as open_trades
from public.bots b
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' and deleted_at is null;
```
Expect exactly:
- `trading_pair = 'BTCUSDT'`
- `user_id = '66e1b075-930e-4a20-9289-ca8668699eea'`
- `trading_enabled = false`
- `cred_env = 'testnet'`
- `open_trades = 0`
- `status = 'active'` (the state we are flipping)

**ABORT** if trading_pair ≠ BTCUSDT, owner mismatch, `trading_enabled = true`, `cred_env ≠ 'testnet'`, or
`open_trades > 0`.

## 2. Mutation (approval-gated) — disable THIS bot only, status column only
```sql
update public.bots
set status = 'paused'
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  and user_id = '66e1b075-930e-4a20-9289-ca8668699eea'
  and status = 'active'
returning id, status, trading_enabled, credential_id;
```
- Changes **only** `status` (active → paused). Does **not** touch `trading_enabled` (stays false) or
  `credential_id` (no repoint).
- The `and status = 'active'` guard makes it idempotent/safe: expect **exactly 1 row**; 0 rows ⇒ the bot was
  not `active` (investigate, do not retry blindly).

## 3. POST read-back
```sql
select id, status, trading_enabled, credential_id,
       (select count(*) from public.trades t
        where t.bot_id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' and t.deleted_at is null
          and t.status in ('pending','submitted','unknown')) as open_trades
from public.bots
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
```
Expect:
- `status = 'paused'` (non-active / disabled) ✅
- `trading_enabled = false` (unchanged) ✅
- `credential_id = '594b9895-7180-4aa9-a8fe-41879c913f6d'` (**unchanged** — no repoint) ✅
- `open_trades = 0` (the disable creates no trade/order) ✅

## 4. Rollback (only if needed)
```sql
update public.bots
set status = 'active'
where id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
  and user_id = '66e1b075-930e-4a20-9289-ca8668699eea'
  and status = 'paused'
returning id, status;
```
Restores the previous status (`active`) — only if you need to revert. Nothing else to undo (no other column
changed).

## Effect / boundaries
- The BTCUSDT bot stops accepting webhooks (`status=paused`) and remains non-trading. Minimal impact — it was
  testnet with `trading_enabled=false` already.
- After this, the provisioning **dry-run** PRE check passes for this bot (`status ≠ 'active'`).
- **No Vault secret. No credential row. No repoint. No trading enable. No deploy. No mainnet order.** This
  packet changes exactly one bot's `status` and nothing else — and only on approval.
