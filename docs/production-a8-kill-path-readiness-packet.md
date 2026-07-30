# A8 Packet — Trusted Kill Path Readiness

> **DOC / DESIGN + read-only discovery — NOT EXECUTION.** No code · no DB mutation · no deploy · no endpoint fire ·
> no `QUEUE_ENABLED`/`trading_enabled` change · no mainnet/real funds. _updated by Codex at Oren request._ · 2026-07-05

## Objective
Define and evidence the **trusted kill path(s)** that stop execution — required **before any live/testnet arming
window**. **A8 = the requirement/definition + proof; A10 = the drill that rehearses it.**

## Kill paths (5) — mechanism · effect · speed · safety · access · audit
| KP | Mechanism (code evidence) | Effect | Speed | Safety | Operator-accessible today | Audit |
|----|---------------------------|--------|-------|--------|---------------------------|-------|
| **KP1 — `trading_enabled=false`** | `assertTradingEnabled` (sizingRisk.ts:166) at Step-4b (index.ts:860) ⇒ `RiskLimitExceededError('trading_disabled')` ⇒ `order.blocked` | worker consumes, gate blocks, **no adapter/fill**; message acked | **immediate (per signal)** | **SAFEST** — targeted per-bot, reversible, audited | ✅ `UPDATE bots SET trading_enabled=false` (privileged) — **PROVEN** (S5 smoke Step-6 disarm) | `order.blocked` |
| **KP2 — `QUEUE_ENABLED=false` + restart** | boot gate (index.ts:301–317); `worker_queue_disabled` (1473) | worker stops consuming entirely (**webhook may still enqueue**) | **~redeploy (minutes) — restart to take effect** | total but slower | ✅ Doppler + Railway redeploy | `worker_queue_disabled` (console) |
| **KP3 — Railway worker stop** | operational (Railway service stop) | total consumption stop | seconds–minutes | total | ✅ Railway dashboard (no railway CLI here) | Railway logs |
| **KP4 — bot status inactive / token rotation** | webhook: `status != active` ⇒ `bot_not_active`; token rotate ⇒ `invalid_secret` | stops **new** signals entering the queue | **immediate (per request)** | targeted intake | ✅ DB status / Doppler token (+ pepper deploy for pepper) | `webhook_reject` (console) — **token/`invalid_secret` path PROVEN (H5 N1); `bot_not_active` path NOT separately tested (N5 blocked)** |
| **KP5 — credential status invalid / custody lock** | `disableCredentialAndBot` (index.ts:497–537) auto on dead cred; manual `status='invalid'`; Vault delete (mig 005) | bots on that credential **can't decrypt/trade** | immediate | ⚠️ **broad blast radius** (shared credential ⇒ ALL bots) — **EMERGENCY-ONLY, NOT first-line (use KP1 first)** | ✅ `UPDATE user_exchange_credentials SET status='invalid'` / Vault delete | `credential_invalid` / `bot_disabled_credential_invalid` |

## Fastest / safest / operator-accessible
- **Fastest:** KP1 · KP4 · KP5 (per-signal / per-request, immediate). KP2 = restart (slow). KP3 = Railway (mid).
- **Safest:** **KP1** — targeted, reversible, audited, smoke-proven. (KP5 broad blast radius; KP2/KP3 total.)
- **Operator-accessible today:** all — but **all are MANUAL** (DB SQL / Doppler / Railway). **No one-click hardened kill**
  (the Operator Console is read-only; a mutating kill slice is a later gated slice). **KP1 has proven E1 evidence.**

## Current implementation evidence
- **KP1 ✅** code + **PROVEN** (S5 smoke Step-6: `trading_enabled=false` ⇒ `enabled_bots=0`, raw-verified).
- **KP2 ✅** code (boot gate); current live state `QUEUE_ENABLED=false` / `worker_state=disabled`.
- **KP4 ✅** code + **PROVEN** intake reject (H5 N1 wrong-token ⇒ 200 / no enqueue).
- **KP5 ✅** code (auto-disable on proven-dead credential); manual path available; **not drilled**.
- **KP3** operational (Railway) — no code.

## Gaps before trusted LIVE use
- **G1** KP2 is **not instant** (restart-to-take-effect) → for a fast kill rely on KP1.
- **G2** kill paths **not DRILLED under armed load** (A10 pending) → timing/effectiveness not runtime-proven (except KP1 disarm + KP4 reject).
- **G3** **no hardened one-action operator kill** — all manual SQL/dashboard; Operator Console read-only (mutating kill slice later).
- **G4** a **MANUAL kill action is not audited** (the DB `UPDATE` has no who/when/why trail) — audit gap for real funds.
- **G5** **KP5 blast radius** — the shared credential ⇒ invalidating it kills **all 5 bots** (not targeted).
- **G6** no railway CLI locally ⇒ KP2/KP3 are operator-dashboard only (not agent-scriptable).

## Required audit events (for trusted live)
Every kill (manual or auto) ⇒ `audit_logs` {actor, kill_path, scope (bot/all), reason, ts, before/after state} — **no
secret value.** Present: `order.blocked` (KP1), `credential_invalid`/`bot_disabled` (KP5), `worker_queue_disabled` /
`webhook_reject` (console). **Missing:** an audit row for a **manual operator kill** (KP1/KP4/KP5 manual flips).

## Required read-back evidence (per kill)
- KP1: `enabled_bots=0` + `order.blocked`, no fill.
- KP2: `worker_state=disabled`, no consumption.
- KP3: no consumption.
- KP4: webhook reject, no enqueue.
- KP5: credential `status=invalid`, bots can't trade.
- **Final: full disarmed read-back** (`QUEUE_ENABLED=false`, all bots off, worker disabled, `queue_length=0`).

## Relationship to the A10 drill
**A8 defines + evidences** the trusted kill paths (this packet). **A10 rehearses** them (arm → kill → measure timing).
A8 must be defined **before** any arming window; A10 provides the runtime timing/effectiveness proof. A10 K1–K4 map to
A8 KP1–KP4; A8 adds **KP5** (credential/custody). A8 PASS is a **precondition** for the A10 drill and for any arming.

## PASS criteria
- All 5 kill paths defined + mechanism evidence present.
- ≥1 **fast, safe, operator-accessible** kill (KP1) with **E1 proof**.
- Read-back capability for each path.
- (Real funds) an **audited** kill action + **A10 drill PASS**.

## NO-GO criteria
No proven fast kill · kill not operator-accessible · no read-back · manual kill **not audited** (real funds) · A10 drill
not run (real funds) · KP5 blast radius unhandled for real funds.

## GO / NO-GO
- **Testnet = GO** — KP1 is fast, safe, operator-accessible and **PROVEN** (smoke Step-6 + H5 N1 intake); the disarmed
  baseline is read-back-verifiable; all kill mechanisms are evidenced. Sufficient for testnet arming windows (operator
  runs the disarm + read-back).
- **Real funds = OPEN / NO-GO** — requires **A10 drill PASS** (runtime kill proof + timing), an **audited one-action
  kill** (G3/G4), **KP5 blast-radius handling**, plus **A11** and the other MUST gates. **A8 not fully closed.**

---

## Codex round-2 review — corrections + dispositions (2026-07-05)
1. **KP1 blocks BEFORE the adapter/order — CONFIRMED.** `assertTradingEnabled` (index.ts:860, comment @858
   "Fail-closed BEFORE the adapter / getMarketRules / any Exchange call") runs **before** the adapter is constructed
   (@872), before `getMarketRules`/`fetchBalance` (@878/909), before `INSERT trades(pending)` (@942), and before
   `createOrder` (@996). A blocked bot's signal is consumed + acked as `order.blocked`; **no adapter call, no order.**
2. **KP2 wording — exact:** `QUEUE_ENABLED=false` stops worker **consumption ONLY after restart/redeploy** (read at
   boot); it does **NOT** stop webhook **enqueue** (messages may still land in the queue).
3. **KP4 — corrected:** H5 N1 proves only the **`invalid_secret` (token)** path. **`bot_not_active` is NOT separately
   tested** (that is N5, currently BLOCKED). (Table updated.)
4. **KP5 — explicit:** broad blast radius (shared credential ⇒ all bots). **EMERGENCY-ONLY, not a first-line kill —
   KP1 is first-line.** (Table updated.)
5. **Manual kills:** for **real funds**, the kill MUST be an **audited operator action** — a raw SQL/Doppler/Railway
   flip with no audit trail is **not acceptable** for real funds (testnet only).
6. **One-click kill (required future slice):** an **Operator Console guarded kill** — kill-button / disable-all /
   custody-lock — with **audit + read-back** (a later, gated, mutating Console slice; the console is read-only today).
7. **A10 relationship:** **A8 planning can PASS now**, but **A8 *trusted* status (real funds) requires A10 drill
   evidence** (runtime proof + timing). Planning-PASS ≠ trusted-closed.

**Disposition: CHANGES applied ⇒ A8 = PLANNING PASS.** Testnet GO; real funds OPEN/NO-GO; A8 not fully closed.

### Real-funds hardening slice — A8-H
- **H-A8-1** audited kill action — every kill (manual or auto) writes `audit_logs` {actor, kill_path, scope (bot/all),
  reason, ts, before/after}, **no secret value**. **✅ IMPLEMENTED + VALIDATED (testnet)** via `operator_kill_all`
  (migration 019) — the 2026-07-09 run wrote exactly one audited `operator.kill_all` row, actor=user, no secrets.
- **H-A8-2** one-action hardened kill — Operator Console guarded **kill-button** with audit + read-back.
  **✅ IMPLEMENTED + VALIDATED on TESTNET (2026-07-09).** RPC `public.operator_kill_all(text, boolean)` (migration 019,
  applied-linked/untracked) + gated Operator Console kill UI (`VITE_OPERATOR_KILL_ENABLED`, default OFF). End-to-end
  validation run PASS — deployed UI → authenticated PostgREST → one audited SAFE kill → exact-baseline restore; anon
  denied 401. Evidence: `docs/production-a8-h2-testnet-validation-runbook.md` (RUN — RESULTS). *(The **disable-all** is
  the kill-all scope; **custody-lock** is the KP5 half → deferred to H-A8-3.)*
- **H-A8-3** KP5 blast-radius handling — per-bot credential isolation, or an explicit emergency-only procedure so a
  shared-credential kill cannot unintentionally stop unrelated bots. **STILL OPEN** (the custody-lock half of H2; H2 by
  design does not touch credentials/Vault).
- **H-A8-4** **A10 drill PASS** — runtime proof of every kill path + timing (the actual trusted-status evidence).
  **✅ SATISFIED** (A10 drill RUN+PASS 2026-07-06).
- (+ **KP4 `bot_not_active` test** — closed via A10 K4.)

**A8-H2 status:** testnet-CLOSED (H-A8-1 + H-A8-2 implemented+validated; H-A8-4 satisfied). **Real funds still
OPEN/NO-GO** — requires **H-A8-3** (KP5 isolation) + A11 + live-tier fail-closed proof + A1/A4 hardening + A2 migration
reconcile.
