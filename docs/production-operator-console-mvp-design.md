# Operator Console MVP — Design Packet

> **DESIGN / DOC ONLY — NO CODE.** No DB/Doppler/Railway mutation, no execution, no arm/fire by this
> document. Defines product scope, backend, UI, safety gates, audit, boundaries, slices, tests, and
> stop conditions for an **internal, testnet-only** operator console. No code until Codex review.
> Companions: [go-live checklist + rollback](production-go-live-checklist-and-rollback.md) (levers),
> [A10 drill](production-a10-rollback-killswitch-drill-packet.md), [smoke evidence](sprint5-s5-a3-b4-controlled-smoke-evidence.md),
> [A4 credential isolation](production-a4-credential-isolation-packet.md).

## 1. Goal & product scope
Replace the manual terminal/SQL runtime steps (the ones used in the controlled smoke and A10 drill)
with **guarded UI actions + live status + audit**, to reduce manual-operation risk **before** any
multi-bot or production work.

**In scope (MVP):** an internal operator console that (a) shows live system status read-only, (b) lets
the operator select bots and see config-readiness, (c) performs **guarded** enable/disable/disarm
actions with pre-check + raw read-back + audit. **Testnet only. Internal operator only.**

**Out of scope (MVP):** public/user UI, TradingView live, real funds / mainnet controls, queue-arm
(`QUEUE_ENABLED=true`) and any *fire* — those stay out-of-band and Oren-gated. Frontend today is 0%
(empty Vite scaffold); this is the first real surface and must not become a money-moving control.

## 2. Required capabilities (MVP)
1. **Read-only status panel:** `QUEUE_ENABLED`, enabled-bots count, per-bot `trading_enabled`,
   `queue_length`, open trades, DLQ, pending recon, latest worker state / deploy evidence (if available).
2. **Bot selection:** one / multiple / all eligible testnet bots; per-bot config-readiness shown.
3. **Guarded actions:** pre-check selected bots · enable selected · disable selected · disarm all ·
   queue off · (later, Oren-gated) queue on.
4. **Hard safety rules:** no queue arm unless pre-check PASS; no fire unless queue armed + selected bots
   enabled + explicit run_id; no action without raw read-back; every mutation shows before/after; no
   mainnet/real-funds controls in MVP (absent or visibly disabled/blocked).
5. **Evidence:** every operation writes an audit/operator-event record (who/when/what/before/after/
   result); empty output is never success; raw read-back required.
6. **Scope:** testnet only · internal operator only · no TradingView live · no real funds · no public UI.

## 3. Architecture & execution boundaries
- **Browser never mutates directly, never holds privilege.** The console (Vite/React) calls
  **server-side SECURITY DEFINER RPCs** (or Edge Functions) for every action; it has **no** service_role,
  no exchange key, no direct table write. RLS + the RPCs are the authority — the UI only reflects them.
- **Server-side is the guardrail.** Each guarded RPC re-applies the same conditions as the manual
  guarded UPDATE (mode-specific + env-checked for enable), writes the audit row, and **returns the
  after-state from a fresh SELECT** (the raw read-back) — the UI shows before/after from that, never from
  an assumed/empty result.
- **`QUEUE_ENABLED` is a worker env flag (Doppler→Railway).** The browser cannot read env directly, so:
  - **Status (read):** the worker publishes its runtime state (`queue_enabled`, `is_production`, boot
    `stuck_count`, last-seen ts) to a DB row the console reads (see §5 `worker_status`). The panel shows
    "last known worker state" with its timestamp (stale if the worker is down).
  - **Queue off (write) — CHOSEN: Option A, DB-backed pause gate.** A `system_controls.trading_paused`
    row that the **worker reads as an ADDITIONAL fail-closed gate**: the worker processes a signal only
    if `QUEUE_ENABLED=true` **AND** `trading_paused=false`. **Fail-closed semantics (mandatory):**
    `trading_paused` defaults **`true`**; if the row is **missing / unreadable / errors**, the worker
    treats it as **paused** (does not process). The console can **set pause ON** (`trading_paused=true`)
    — a fast, console-owned global stop independent of Doppler — but **cannot un-pause**: setting
    `trading_paused=false` is **Oren-gated** and out of the default MVP action set. `QUEUE_ENABLED`
    stays the outer worker gate (Doppler/Railway, unchanged). Honoring the gate is a worker-code slice.
  - **Queue ON is never an MVP console action** — arming is Oren-gated, out-of-band, regardless.

## 4. Backend — endpoints / RPCs
All RPCs are `SECURITY DEFINER`, callable only by an authenticated **operator** role (§6), and each
writes an audit row + returns `{before, after, result}` from a fresh read-back.
- **`operator_status()`** (read) → status-panel payload: per-bot (`id`, `trading_pair`, `trading_enabled`,
  config-readiness, `exchange_environment`), `enabled_bots`, `open_trades`, `dlq`, `open_recon`
  (`status='pending'`), `queue_length` (`pgmq_queue_length('trade_signals')`), latest `worker_status`,
  and the `system_controls`/`QUEUE_ENABLED` view. Read-only; safe to poll.
- **`operator_precheck(bot_ids[])`** (read) → per-bot readiness for enable: mirrors the §6b guard
  (`sizing_mode`, the matching size field, both caps, `sell_enabled=false`, `exchange_environment` vs
  worker env) → `{bot_id, eligible: bool, missing: []}`. No mutation.
- **`operator_disable_bots(bot_ids[])`** (mutation, **always allowed — safe direction**) → set
  `trading_enabled=false` for the given bots; audit; return before/after rows.
- **`operator_disarm_all()`** (mutation, safe) → `trading_enabled=false` for ALL bots; audit; return
  before/after + `enabled_bots` after (must be 0).
- **`operator_enable_bots(bot_ids[])`** (mutation, **guarded**) → enable **only** bots that pass
  `operator_precheck` (mode-specific + env-checked); refuse (no-op + reason) for any that don't; audit;
  return before/after. Never enables a bot the worker would block.
- **`operator_set_pause(paused bool)`** (mutation, Option A only) → flip `system_controls.trading_paused`;
  audit; return before/after. (`paused=true` is the console "queue off"; `paused=false` = un-pause is a
  guarded/Oren-gated step, see §7.)
- **No `operator_queue_on` / no fire RPC in MVP.**

## 5. Data model additions (design — gated, not applied)
- **`worker_status`** (worker writes on boot + heartbeat; console reads): `queue_enabled`,
  `is_production`, `boot_stuck_count`, `worker_state`, `updated_at`, deploy id if available. Lets the
  panel show real worker/queue state with staleness.
- **`system_controls`** (chosen — Option A): a single row, `trading_paused boolean NOT NULL DEFAULT
  true` (**fail-closed default = paused**), `updated_by`, `updated_at`. The worker reads it as an extra
  gate and **treats missing / unreadable / error as paused**. The console may set `true`; setting `false`
  (un-pause) is **Oren-gated**, not a default MVP action.
- **`operator_actions`** (audit; or reuse `audit_logs`): `actor` (operator user id), `action`, `targets`,
  `before_state`, `after_state`, `result`, `created_at`. (Reusing `audit_logs` with `entity_type='operator'`
  is the lighter option — decision §10.)
- All migrations follow the surgical/gated process (009 frozen; no `db push`; transaction-wrapped).

## 6. Auth & roles
- **Operator auth:** Supabase Auth; only users in an **operator allowlist/role** may call the RPCs (the
  RPCs check membership; non-operators are denied). MFA-ready.
- **Least privilege, deny-by-default:** RLS/grants **deny everything** not explicitly exposed via an
  operator RPC. The browser session can call the operator RPCs but holds **no service_role**, cannot read
  secrets, cannot write tables directly, and cannot reach exchange keys / `vault_secret_id` values.
- This is **internal operator** access only — not the public user auth (B1) and not credential-setup UI
  (B2); those are separate gaps.

## 7. Safety gates (enforced server-side, reflected in UI)
- **Disable / disarm-all / pause-ON: always allowed and fast** (safe direction — they only *stop*
  trading): `operator_disable_bots`, `operator_disarm_all`, `operator_set_pause(true)`. All raw-read-back
  verified. Allowed even when state is DEGRADED (below).
- **Enable: guarded partial-arm only.** `operator_enable_bots` enables **only** the selected, **testnet**,
  `operator_precheck`-PASS bots (a non-ready bot is refused with its `missing[]` reason); raw-read-back +
  audit; UI requires explicit confirm, shows the pre-check result, and labels the result **"partially
  armed"** (some bots enabled, not the whole system). **Enabling a bot does NOT by itself allow any order:**
  orders require `trading_paused=false` **AND** `QUEUE_ENABLED=true` — both of which are **Oren-gated /
  out-of-band** and absent from the default MVP actions. So in MVP, enable can never on its own produce a
  trade.
- **DEGRADED state (stale/missing worker status):** if `worker_status` is **missing or stale** (older
  than the agreed freshness bound), the console is **DEGRADED** — **block guarded enable and any arm-like
  operation**, and surface the staleness prominently. **Safe actions remain allowed** in DEGRADED: pause
  ON, disable bots, disarm all.
- **No queue arm (`QUEUE_ENABLED=true`) from the console — ever in MVP.** Un-pausing
  (`operator_set_pause(false)`) and any queue-on are **Oren-gated** and out of the default MVP action set
  (or behind a separate, clearly-marked, approval-gated control).
- **No fire** from the console — firing stays the hardened out-of-band tool, and only inside an
  Oren-approved window (armed + enabled + explicit run_id).
- **Raw read-back on every mutation:** the RPC re-SELECTs and returns after-state; the UI must show
  before→after; an empty/again-unchanged after-state is surfaced as a **failure**, never success
  (direct lesson from the smoke Step-6 anomaly).
- **No mainnet / real-funds controls** rendered in MVP (absent, or visibly disabled + blocked server-side).

## 8. Audit / evidence model
- Every mutating RPC writes one audit record: actor (operator id), timestamp, action, target bots,
  before_state, after_state, result (success / refused + reason). **No secret material in the audit** —
  bot ids / statuses / non-secret reasons only; never tokens, keys, DSNs, or `vault_secret_id` values.
  Read actions are not audited (or lightly logged).
- The console surfaces a **read-only audit/event log** view (recent operator actions + worker events) so
  an operator sees the trail without SQL.
- Evidence parity with the manual flow: what we capture by hand today (before/after, raw read-back,
  reason) is captured automatically by the RPC + audit.

## 9. Implementation slices (each: code + tests, gated, Codex review, no arm/fire)
1. **Status read path** — `operator_status()` RPC + `worker_status` table + the worker writing to it;
   read-only status panel UI. No mutations.
2. **Safe mutations** — `operator_disable_bots` + `operator_disarm_all` (always-safe) + audit; UI disable/
   disarm with before/after. (Disabling first: it can only *reduce* risk.)
3. **Guarded enable** — `operator_precheck` + `operator_enable_bots` (mode/env-guarded) + confirm UI +
   pre-check display.
4. **Console-side queue-off (Option A — chosen)** — `system_controls` + worker honors the fail-closed
   pause gate + `operator_set_pause(true)` + UI; un-pause stays Oren-gated.
5. **Audit/event log view** — read-only operator action + worker event timeline.
- **Deferred (not MVP):** queue-on UI, multi-bot arming, any fire control, public user UI (B1/B2),
  mainnet.

## 10. Decision points (operator / Codex / Oren)
1. **Queue-off mechanism — DECIDED: Option A** (DB-backed `trading_paused`, fail-closed, worker honors
   it; `QUEUE_ENABLED` stays the outer gate). Option B (read-only console) **rejected** — a read-only
   console cannot stop processing without Doppler/Railway.
2. **Audit store:** new `operator_actions` table vs reuse `audit_logs` (`entity_type='operator'`).
3. **Operator role model:** Supabase Auth role/allowlist mechanics; how operators are provisioned.
4. **Worker status publishing:** boot-only vs heartbeat cadence for `worker_status`.

## 11. Tests
- **RPC unit/integration:** guard conditions (enable refuses non-ready bots, per-bot; disable/disarm
  always succeed); audit row written with correct before/after; after-state from raw read-back; refusal
  reasons.
- **Auth/RLS:** non-operator denied every RPC; browser cannot direct-write tables or read secrets/
  `vault_secret_id`.
- **Fail-closed:** pre-check FAIL ⇒ enable blocked; `system_controls` defaults paused; missing config ⇒
  refused, not enabled.
- **Pause gate (worker):** `trading_paused=true` **blocks worker processing** (no order); a pause-row
  **read error / missing row fail-closes** (treated as paused); default = paused.
- **DEGRADED (stale worker status):** stale/missing `worker_status` **blocks guarded enable** and any
  arm-like op; safe actions (pause ON / disable / disarm all) still allowed.
- **Disarm-all:** raw-verifies `enabled_bots=0` after the call (not inferred from empty output).
- **Raw-read-back semantics:** a mutation that does not change state surfaces as failure (regression for
  the smoke Step-6 anomaly).
- **No-arm/no-fire:** no code path enables the queue or fires; **queue-on / un-pause / fire RPCs are
  absent** from MVP.
- **UI:** status renders from `operator_status`; before/after shown; mainnet/real-funds controls absent.

## 12. Stop conditions
- Design only — **no code until Codex review**; no DB/Doppler/Railway change by this packet.
- The console **never** arms the queue, un-pauses to live, or fires without an **explicit Oren-approved
  window**; those controls are absent or approval-gated in MVP.
- **Testnet only · internal operator only · no real funds · no mainnet · no TradingView live · no public
  UI.** Any mainnet/real-funds control is out of MVP entirely.
- Every mutation is server-side, guarded, audited, and **raw-read-back-verified** — empty/unchanged
  output is a failure, never success.
- Any RPC that could enable a bot the worker would block, or mutate without audit/read-back, is a defect
  → fix before use.
