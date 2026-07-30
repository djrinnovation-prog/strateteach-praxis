# ST-2 — User read-only dashboard (IMPLEMENTATION PACKET)

**PACKET ONLY — no code yet, no deploy, no linked DB apply.** Implementation-ready spec for the StrateTeach
pilot **user** dashboard: each pilot user sees their **own** bot(s), driven by their **own Supabase Auth JWT +
RLS**. Decision locked: **A + 1** (same app rebranded, shared Supabase Auth). Follows ST-1 (`57138ea`).

## 1. Goal & non-goals
- **Goal:** a rebranded, flag-gated user view showing, for the caller's own bot(s): status, env badge, caps,
  open position, recent trades, friendly last-block reason — plus ONE scoped action: **pause/disable their own bot**.
- **Non-goals:** key entry, credential provisioning, bot **activation/arming**, cap/sizing edits, self-serve
  wizard, SSO, live/unrealized P&L (needs a price feed — later). No secret values, ever.

## 2. Backend — one migration `033_user_dashboard_rpcs.sql` (two functions)
Both mirror the proven `operator_status`/`032` security shape: `SECURITY DEFINER`, `set search_path=''`,
`grant execute … to authenticated`, deny-by-default `RAISE 42501`. Row-isolation is enforced **in the body by
`auth.uid()`** (SECURITY DEFINER bypasses RLS), and a **cross-user isolation SQL test is mandatory** (§5).

### 2a. `user_bot_dashboard() returns jsonb`  (read-only)
- Auth: `v_uid := auth.uid(); if null → 42501`.
- Returns a jsonb **array**, one object per `public.bots b WHERE b.user_id = v_uid AND b.deleted_at IS NULL`:
  - **bot:** `id`, `name`, `trading_pair`, `status`, `trading_enabled`, `sizing_mode`,
    `fixed_notional_usdt`, `max_order_notional_usdt`, `daily_notional_cap_usdt`, `sell_enabled`.
  - **credential (safe):** `exchange_environment`, `credential_status` (from `user_exchange_credentials` via
    `b.credential_id`). **NEVER** `vault_secret_id`.
  - **position (from filled trades):** `open_qty` = `sum(quantity) filter (side='buy',status='filled')` −
    `sum(quantity) filter (side='sell',status='filled')`; `cost_basis_usdt` =
    `sum(executed_notional_usdt) filter (side='buy',status='filled')`. (SELL is off in v1 → effectively buy totals.)
  - **recent_trades:** last 10 for the bot — `side`, `status`, `requested_notional_usdt`,
    `executed_notional_usdt`, `created_at`, `filled_at`. (No `signal_id` — avoid leaking source ids.)
  - **last_block_reason:** latest `audit_logs.after_state->>'reason'` where `entity_id=b.id AND
    event_type='order.blocked'` (mapped to friendly text client-side).
- **HARD-EXCLUDED:** `bots.webhook_secret_hash`, `user_exchange_credentials.vault_secret_id`, api key/secret,
  pepper, tokens — none selected. Read-only; no mutation.

### 2b. `user_pause_own_bot(p_bot_id uuid) returns jsonb`  (the ONLY user mutation)
- Auth: `v_uid := auth.uid(); if null → 42501`.
- Ownership: require a row `bots WHERE id=p_bot_id AND user_id=v_uid AND deleted_at IS NULL`; else `RAISE 42501`
  (do not reveal existence of others' bots).
- Action (nothing else): `update public.bots set trading_enabled=false, status='paused'
  where id=p_bot_id and user_id=v_uid`; then `audit_logs` insert (`entity_type='bot'`, `entity_id=p_bot_id`,
  `event_type='bot.user_paused'`, `actor_type='user'`, `actor_id=v_uid`, `after_state`). Return
  `{ok:true, bot_id, status:'paused', trading_enabled:false}`.
- **Never enables/activates**, never touches caps/sizing/credential. Migration **027**'s trigger already blocks a
  user from *re-enabling* under an operator lock — this RPC only ever *disables*, so it is always safe. Activation
  stays operator-only.

## 3. Why SECURITY DEFINER RPCs (not raw table reads/writes)
- The RPC **hard-excludes** secret columns — the browser has no path to `select webhook_secret_hash` /
  `vault_secret_id` even by mistake.
- **Footgun to close separately (NOT this packet):** the existing broad `bots` user-UPDATE RLS policy
  (`user_id=auth.uid()`) lets a raw JS-client `update` edit **any** bot column (incl. caps). ST-2's UI uses only
  `user_pause_own_bot`, but a user could still craft a raw update. **Required companion gated migration (ST-2b,
  separate):** narrow the `bots` user-UPDATE policy so pilot users cannot change sizing/caps/credential/status
  except via the scoped RPC. Flag as a **blocker before pilot users get accounts** — call out in review.

## 4. Frontend (same app, rebranded — flag `VITE_STRATETEACH_PILOT`, default OFF)
- **`frontend/src/lib/userDashboard.ts`** — `UserDashboardBot` type; `loadUserDashboard(client)` →
  `rpc('user_bot_dashboard')`; `pauseOwnBot(client, botId)` → `rpc('user_pause_own_bot', {p_bot_id})`. Reuse
  `friendlyBlockReason` from `lib/pilot.ts` (export/import; no duplication).
- **`frontend/src/components/UserDashboard.tsx`** — read-only cards per bot (status, env badge TESTNET/**LIVE**,
  caps, open position + cost basis, recent-trades table, friendly last-block) + a guarded **Pause my bot** button
  (confirm → `pauseOwnBot` → refresh). Forbidden (42501) → friendly "no access / please sign in". No secrets.
- **`frontend/src/App.tsx`** — add a **"My bots"** view rendered when `pilotEnabled`. Routing recommendation:
  reuse the existing operator-vs-user signal — if `operator_status()` returns 42501 (non-operator), default the
  pilot user to **My bots** and hide the operator console/cockpit; operators keep their tabs. (Minimal detection;
  the auto-routing polish may be a tiny follow-on — call out in review whether to include in this slice.)

## 5. Tests (local only)
- **SQL (`supabase/tests/033_user_dashboard_rpcs.test.sql`):**
  - user A sees only A's bot(s); **user B sees ZERO of A's** (cross-user isolation) — the key safety test;
  - payload has caps/env/position/last_block, and **no secret substrings** (`vault_secret_id|webhook_secret_hash|
    api_key|api_secret|service_role|pepper|token`);
  - `user_pause_own_bot` flips the caller's own bot to paused/disabled + writes the audit row;
  - `user_pause_own_bot(other_users_bot)` → 42501; null-uid → 42501;
  - after an operator hard-lock (027), the user still **cannot re-enable**, and `user_pause_own_bot` still succeeds.
- **Vitest:** `userDashboard.test.ts` (loaders + error), `UserDashboard.test.tsx` (renders from mock; **no-secret
  substring** assertion; TESTNET/LIVE badge; pause calls only `user_pause_own_bot`; 42501 → friendly notice),
  and an App test that the "My bots" view is reachable only when `pilotEnabled`.

## 6. Local validation plan (when implemented — no deploy, no linked apply)
`supabase db reset` (applies 001..033) → run `033_user_dashboard_rpcs.test.sql` via **psql** (multi-statement) →
`npm run typecheck` + `npx vitest run` → mock harness screenshot (`user-dashboard-harness.{tsx,html}`,
uncommitted, like `pilot-cockpit-harness`). Migration 033 stays **local-only**; linked apply is a separate gated step.

## 7. Security boundaries (binding)
- RLS/`auth.uid()` is the sole row authority; **no service_role in browser**; **no secrets/credential values**
  returned or rendered (fingerprints/status/env only); browser never calls Binance; no withdrawals; envelope/
  owner-split preserved. Status/logs/trades read-only + the single scoped self-pause. Real funds NO-GO.

## 8. Deliverable sequence
packet (this) → **Codex review** → implement (migration 033 + 2 lib/2 component files + App wiring + tests, flag
OFF) → local validation (§6) → **hold at deploy + hold at linked-apply** for approval → commit ST-2 only. ST-2b
(tighten `bots` user-UPDATE policy) tracked as a separate gated migration, required before pilot user accounts.

## Boundaries
Packet only — no code, no deploy, no linked DB apply, no secrets, no live trading. Depends on A+1 (confirmed) and ST-1 (`57138ea`, pushed).
