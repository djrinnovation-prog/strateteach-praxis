# ST-2 — User read-only dashboard (PACKET)

**PACKET ONLY — no code, no deploy, no DB change, no secrets.** First decision-*dependent* StrateTeach slice,
unblocked by **A + 1** (same app rebranded + shared Supabase Auth). A per-user, mostly read-only dashboard that
each pilot user sees for **their own** bot(s), driven entirely by **their own Supabase Auth JWT + RLS** — no
service_role, no secrets, no credential values.

## 1. Goal & non-goals
- **Goal:** a rebranded user shell (flag-gated) showing, for the caller's own bot(s): status, env, caps, last
  signal, open position, recent trades, simple P&L, friendly block reason — plus **one** safely-scoped action:
  pause/disable **their own** bot.
- **Non-goals:** key entry, credential provisioning, bot activation/arming, cap/sizing edits, self-serve wizard,
  SSO. Those are later phases. No secret values, ever.

## 2. Identity & isolation (A + 1)
- Each pilot user is a **real Praxis Supabase Auth user**; the browser uses **their own JWT**. RLS on
  `auth.uid()` is the **sole** authority — no `user_id`-by-param, no shared account, no service_role in browser.
- Operator provisions the auth user + the bot (`user_id` = that uid) out-of-band (managed-account pilot).

## 3. Reads — RLS-scoped, secrets hard-excluded
Existing RLS already scopes these to the caller: `bots` (`user_id=auth.uid()`), `trades`/`trades_dlq` (via the
bots subquery), `audit_logs` (bot-scoped), `user_exchange_credentials` (`user_id=auth.uid()`).
**Preferred surface: one SECURITY DEFINER read RPC `user_bot_dashboard()`** scoped to `auth.uid()` that returns
ONLY safe columns — so the browser has no path to select a secret column even by mistake:
- per bot: `bot_id`, `status`, `trading_enabled`, `exchange_environment` (TESTNET/**LIVE** badge), caps,
  `sell_enabled`, strategy label, last `signal_id`/time, open position (qty + ~$), simple P&L;
- recent trades: `side`, `requested/executed_notional_usdt`, `status`, `created_at` (no ids that leak internals);
- friendly `last_block_reason` (map `insufficient_quote_balance` → "insufficient balance", etc.).
- **HARD-EXCLUDED everywhere:** `bots.webhook_secret_hash`, `user_exchange_credentials.vault_secret_id`,
  `api_key`/`secret`, pepper, tokens. Credential shown as **status + env only** (never the pointer/fingerprint to the user).

> If reads go via direct RLS `select` instead of the RPC, the client MUST enumerate safe columns explicitly
> (never `select *`) — the RPC is preferred precisely to remove that footgun.

## 4. The one user action — safely scoped self-pause
- **`user_pause_own_bot(p_bot_id)`** — SECURITY DEFINER, verifies `auth.uid() = bots.user_id`, sets
  `trading_enabled=false` + `status='paused'`, writes an audit row. **Nothing else** — a user cannot touch caps,
  sizing, credential, or activation through it.
- **Why an RPC, not raw `bots` UPDATE:** the existing broad user UPDATE policy (`user_id=auth.uid()`) would let a
  browser edit **any** bot column (incl. caps). ST-2 must **not** expose raw `bots` UPDATE. **Flag (separate,
  gated DB change — NOT this packet):** tighten that policy so pilot users cannot edit sizing/caps; until then,
  the UI exposes only the narrow RPC.
- **Re-enable/activate is operator-only** for the pilot. Migration 027's trigger already **blocks a user from
  re-enabling** a bot under operator lock — so self-pause is safe and non-bypassable in the wrong direction.

## 5. Reuse (existing, `frontend/src`)
- `Login.tsx` + `lib/supabase.ts` — shared Supabase Auth (user JWT).
- `StatusPanel.tsx` / `GateProgress.tsx` — re-skin into the user bot-status card + setup-progress strip.
- New rebranded **user shell** (App-shell variant) behind `VITE_STRATETEACH_PILOT` (default OFF).

## 6. Security boundaries (binding)
- RLS on `auth.uid()` only; **no service_role in browser**; **no secrets/credential values** rendered or
  returned; browser never calls Binance; no withdrawals; envelope/owner-split preserved.
- Status/logs only + the single scoped self-pause. Everything else read-only.

## 7. Backend deltas (spec only — implemented in a later gated slice)
- `user_bot_dashboard()` read RPC (SECURITY DEFINER, `auth.uid()`-scoped, safe columns only).
- `user_pause_own_bot(p_bot_id)` mutation RPC (scoped self-pause + audit).
- (Flagged, separate) tighten the broad `bots` user UPDATE policy for pilot users.

## 8. Tests (local only, when implemented)
- Vitest: dashboard renders from mocked RPC; **asserts no secret/credential field ever appears**; block-reason
  mapping; empty state. Self-pause calls only `user_pause_own_bot`; disabled under operator lock.
- RPC contract tests: `user_bot_dashboard` returns only the caller's bots + no secret columns; a second user sees
  nothing of the first (isolation); `user_pause_own_bot` rejects a bot the caller doesn't own.

## 9. Deliverable sequence (later, each gated)
packet (this) → Codex PASS → implement (2 RPCs migration + user shell, flag OFF) → `supabase db reset` local
validation + Vitest (incl. cross-user isolation) → **hold at deploy** for approval. Ships after ST-1.

## Boundaries
Packet only. No code, no deploy, no DB, no secrets, no live trading. Depends on A + 1 (confirmed).
