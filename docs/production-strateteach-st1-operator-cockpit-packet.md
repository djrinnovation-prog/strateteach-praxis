# ST-1 — Operator read-only pilot cockpit (PACKET)

**PACKET ONLY — no code, no deploy, no DB change, no secrets.** First StrateTeach-pilot slice. A single
operator page that turns the by-hand SQL monitoring from the micro-order run into a durable cockpit, and
becomes the arming-verification surface for every later phase. Decision locked: **A + 1** (same app rebranded,
shared Supabase Auth).

## 1. Goal & non-goals
- **Goal:** operator sees, in one place: worker runtime health, queue depth, and a per-pilot-bot fleet row with
  status + last activity + last block reason + lock/kill state — **read-only, fingerprints only**.
- **Non-goals:** any new mutation (the existing audited `operator_kill_all` is the only action), user-facing UI,
  provisioning, arming, trading. No secret values anywhere.

## 2. Reuse (existing, `frontend/src`)
- `lib/status.ts` `fetchOperatorStatus()` → `operator_status` RPC — already returns `worker_status`
  (`queue_enabled`, `worker_state`, …), `queue_length`, `kill_rpc_present`, and a **DEGRADED** rule when
  `worker_status` is missing/stale (>180s). Reuse verbatim for the health header.
- `StatusPanel.tsx` — health header rendering.
- `GateProgress.tsx` — reuse for a per-bot readiness strip.
- `lib/actions.ts` `operator_kill_all` — the existing audited kill (kept available; ST-1 itself adds no mutation).
- `Login.tsx`, `lib/supabase.ts` — auth + client.

## 3. One backend delta (read-only, SECURITY DEFINER, operator-gated) — spec only
`operator_status` covers worker/queue health but not a per-bot fleet. Add **one read RPC** (name TBD,
e.g. `operator_pilot_fleet()`), mirroring the `operator_status` security pattern (inline
`auth.uid()` + `profiles.is_operator`, `SECURITY DEFINER`, `search_path=''`, `grant execute` to the
authenticated operator only). Returns, per bot, **safe columns only**:
`bot_id`, `user_id`, `status`, `trading_enabled`, `exchange_environment`, **credential fingerprint** (never
`vault_secret_id`), caps (`fixed/max/daily`), `sell_enabled`, `last_trade_at`, `last_trade_status`,
`last_block_reason` (from `audit_logs order.blocked`), and operator-lock state.
- **Also confirm** `operator_status`/`worker_status` surface **`is_production`** + `updated_at` age (needed for
  arming verification); if absent, extend the read RPC to include them. **No writes. No secrets.**

## 4. What the page shows
- **Runtime header:** `is_production` (TESTNET / **LIVE**), `queue_enabled`, `worker_state`, worker age + a
  **"real restart?"** hint (write-cadence shift) + DEGRADED banner — the Doppler↔Railway drift guard, on screen.
- **Queue:** `trade_signals` depth.
- **Fleet table:** one row per pilot bot — user · env badge · **cred fingerprint** · caps · status ·
  trading_enabled · last trade (status/time) · last block reason · lock/kill.
- **Kill affordance:** the existing `operator_kill_all` button (unchanged).

## 5. Security & guardrails
- **Read-only** (zero DB mutation beyond the pre-existing kill). **Zero secrets** — fingerprints/placeholders
  only; the read RPC must not select `vault_secret_id`, `webhook_secret_hash`, `api_key`/`secret`, pepper.
- Operator-gated (`is_operator`) at the RPC, not the client. No `service_role` in the browser.
- **Flag-gated** behind `VITE_STRATETEACH_PILOT` (default OFF). Not deployed by this slice.

## 6. Tests (local only, when implemented)
- Vitest: renders health header + fleet from a mocked RPC; **asserts no secret field is ever rendered**;
  DEGRADED path; empty-fleet path. RPC contract test (shape + operator-gate denial for non-operators).
- Harness/mock screenshot for review (no live backend).

## 7. Deliverable sequence (later, each gated)
packet (this) → Codex PASS → implement (`operator_pilot_fleet` migration + cockpit component, flag OFF) →
`supabase db reset` local validation + Vitest → **hold at deploy** for approval.

## Boundaries
Packet only. No code, no deploy, no DB, no secrets, no live trading.
