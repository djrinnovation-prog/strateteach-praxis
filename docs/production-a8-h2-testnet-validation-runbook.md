# A8-H2 — Testnet Validation Runbook (operator_kill_all + Operator Console kill)

> **DOC / RUNBOOK — NOT EXECUTION.** Producing this file applies nothing. It sequences the **gated, operator-run**
> validation of the audited one-click kill on **TESTNET only**. Each mutating step is **operator-executed**; Claude does
> **read-only read-backs**. **No linked apply, no deploy, no flag enable, no kill call by authoring this.** Grounded in
> the repo (migration `019`, `operator_status()` 016, guarded-enable design). **Never `db push`. No mainnet / no real
> funds.**
>
> **This is the APPLIED-LINKED gate.** Do not run any step below until Oren explicitly approves the linked apply + run.
> Slices 1-3 are done (019 authored+CP1, LOCAL test GREEN+CP2, frontend gated+CP3). Slice 4 (ATTENTION/telemetry
> rendering) is functionally covered by CP3 and tested, pending this live validation.
>
> **Rev 2 (2026-07-08): Codex CP5 CHANGES 1-3 applied** — restore is now an explicit reviewed id-keyed SQL packet
> (§11, Option B; Codex-review-before-run + hard-stop on non-empty diff), the denial test leads with a MANDATORY
> anon/no-auth denial (§7a) with non-operator-JWT optional (§7b, may be NOT RUN), and the frontend flag has an explicit
> default-OFF final resting state (§12a). **Returned for Codex CP5 re-review.**

## Roles & standing constraints (every step)
- **Operator executes** all mutations: linked SQL applies, `git push`, frontend build/deploy, flag enable, the kill
  call. **Claude/Codex do read-backs only.** No agent applies a linked migration, deploys, or fires the kill.
- **Testnet only.** `QUEUE_ENABLED` stays **OFF** the entire time (so even a re-enabled bot cannot execute).
  `PRAXIS_IS_PRODUCTION=false`. No mainnet, no real funds, A11 not in scope.
- **Evidence discipline:** every assertion is backed by a **raw** read-back (`supabase db query --linked --file` or
  `operator_status()`); empty/filtered output is not evidence; secrets never printed.
- **Abort on any mismatch** (see §14 Stop / NO-GO). Baseline is captured first and is the exact restore target.

---

## 1. Pre-checks (before any apply)
Operator runs; Claude confirms from the outputs:
- **Git clean + synced:** `git status --porcelain` empty; `git rev-parse HEAD` == `origin/main`; the three A8-H2
  commits present (`019` migration, LOCAL test, frontend `0e3a3b2`).
- **System disarmed:** `operator_status()` (or raw SELECTs) show `worker_status.queue_enabled=false`,
  `worker_state` disabled/stale acceptable, `enabled_bots` = whatever the baseline is (record it), no active fire path.
- **`019` NOT linked-applied yet:** raw catalog check returns **no** function —
  `select count(*) from pg_proc where proname='operator_kill_all';` → **0**. (If ≠0, stop: it was already applied;
  reconcile before proceeding.)
- **Frontend flag OFF:** the currently-deployed console has **no** kill control (read-only header); the build has
  `VITE_OPERATOR_KILL_ENABLED` unset/≠'true'.
- **PITR / backup** confirmed available for the testnet DB.

## 2. Exact per-bot baseline capture (mandatory — the restore target)
Operator runs a raw SELECT (LINKED, read-only) and saves the output as the baseline artifact:
```sql
-- baseline.sql (read-only)
select id, trading_pair, status, trading_enabled
from public.bots
where deleted_at is null
order by trading_pair;
```
`supabase db query --linked --file baseline.sql` → record **every** row: `id`, `trading_pair`, `status`,
`trading_enabled`. Also record `select count(*) from public.bots where trading_enabled and deleted_at is null;`
(= `enabled_bots_before`) and the open-trades/queue snapshot from `operator_status()`. **This exact per-bot set is the
restore target in §11.** No mutation here.

## 3. Linked apply of `019` (operator-run, surgical, never `db push`)
Only after §1-§2 pass **and explicit Oren approval**. Operator runs:
```bash
supabase db query --linked --file supabase/migrations/019_operator_kill_all.sql
```
- Transaction-wrapped in-file (`begin; … commit;`) — applies atomically.
- **Never `db push`** (010-018 are applied-untracked; push would mis-fire). `019` will likewise be applied-untracked
  → recorded in the A2 ledger in §12.
- If the apply errors (e.g., the function owner lacks INSERT on `audit_logs` — the CP1 residual), **stop**, capture the
  error, and resolve ownership/grant before retrying. Do **not** leave a half-applied object.

## 4. Read-back after apply (function exists, grants correct, NO bot-state change)
Operator runs (LINKED, read-only); Claude confirms:
```sql
-- verify_019.sql (read-only)
-- (a) function exists
select proname, pronargs from pg_proc where proname='operator_kill_all';
-- (b) grants: authenticated=EXECUTE, PUBLIC=none, anon=none
select a.grantee::regrole::text as grantee, a.privilege_type
from pg_proc p, aclexplode(p.proacl) a
where p.oid='public.operator_kill_all(text, boolean)'::regprocedure;
-- (c) bot state UNCHANGED vs baseline (must equal §2 exactly)
select id, trading_pair, status, trading_enabled from public.bots where deleted_at is null order by trading_pair;
```
Assert: (a) one row; (b) `authenticated` has EXECUTE, **no** grantee `0`/PUBLIC, **no** `anon`; (c) per-bot rows
**identical to the §2 baseline** — applying the function changed **no** data. If (c) differs, stop (§14).

## 5. Deploy frontend with the flag OFF first (read-only smoke)
- Operator builds+deploys the frontend via the project's existing deploy process with
  **`VITE_OPERATOR_KILL_ENABLED` unset/≠'true'**. *(Note: `VITE_*` is inlined at **build** time — the flag state is
  baked into the bundle; changing it later requires a **rebuild + redeploy**, not a runtime toggle.)*
- **Read-only smoke:** load the deployed console as an operator → confirm status renders, header shows
  **"(read-only)"**, and there is **no kill button in the DOM** (`kill-controls` / `kill-button` absent). This proves
  the gate: `019` is applied but the UI exposes no kill path yet.

## 6. Enable the flag + redeploy (only after approval)
Only after §5 smoke passes **and explicit Oren approval**:
- Operator sets `VITE_OPERATOR_KILL_ENABLED=true` in the frontend build env, **rebuilds**, and redeploys.
- Load the console → confirm the **Emergency kill** section + **Kill all trading** button now render, header no longer
  "(read-only)". No kill fired yet.

## 7. PostgREST path validation via DENIAL (proves the path + authz, zero effect)
Because `operator_kill_all` has no dry-run, validate the **real PostgREST path** with a **denial** that mutates nothing.

**7a — anon / no-auth denial (MANDATORY — always available, no special token needed).** Call the RPC with only the
public anon key (no operator Bearer). Expect a denial (PostgREST maps the RPC's `42501` → **401/403**; with no valid
JWT `auth.uid()` is null → "not authenticated"):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  "$SUPABASE_URL/rest/v1/rpc/operator_kill_all" \
  -H "apikey: $ANON_KEY" -H "Content-Type: application/json" \
  -d '{"p_reason":"anon path check","p_hard_lock":true}'
```
Assert: **401/403** (denied). Then raw read-back: bots **unchanged** vs baseline, **zero** new `operator.kill_all`
audit rows. This alone proves the PostgREST path reaches the server-side authz gate and is rejected with zero effect.

**7b — non-operator authenticated denial (OPTIONAL — run only if a non-operator JWT is readily available; else mark
NOT RUN).** If (and only if) a second, non-operator test user's JWT can be obtained without effort, repeat 7a with
`-H "Authorization: Bearer $NON_OPERATOR_JWT"` and assert **403 (42501)** + zero effect. **Do not block the run** on
obtaining this token — if unavailable, record "7b = NOT RUN (no non-operator JWT)"; 7a is the required denial proof,
and the LOCAL fixture (Slice 2) already covered the non-operator `is_operator=false` branch under simulated auth.
*(Secrets/JWTs are the operator's own session values — never pasted to Claude.)*

## 8. Execute ONE kill — testnet only (operator-run)
Only after §7 passes. Operator fires **one** kill, via **either**:
- **the deployed Console UI** (preferred — exercises the real button): type the reason, type `KILL`, Confirm; **or**
- an authenticated REST call with the **operator** JWT:
```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/operator_kill_all" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OP_JWT" \
  -H "Content-Type: application/json" -d '{"p_reason":"A8-H2 testnet validation","p_hard_lock":true}'
```
Capture the JSON response (the KillResult). This disables trading + pauses **all** testnet bots. `QUEUE_ENABLED` is OFF
so nothing executes regardless.

## 9. Verify the response contract (SAFE or ATTENTION per open_trades/queue)
From the §8 response, assert:
- `kill_applied = true`, `enabled_bots_after = 0`.
- **If** `open_trades = 0` **and** `queue_length = 0` (and telemetry read OK): `ok = true`, `operational_state='SAFE'`
  — UI shows the green SAFE result.
- **Else** (`open_trades>0` or `queue_length>0`, or a telemetry read failed → null): `ok = false`,
  `requires_attention = true`, `operational_state='ATTENTION'` — UI shows the ATTENTION result with the open-trade /
  queue / telemetry detail. `queue_length=null` renders "read failed", `worker_state=null` renders "unavailable".
- Cross-check against a fresh `operator_status()` read-back: `enabled_bots=0`; all bots `trading_enabled=false`; all
  previously-active bots now `paused`.

## 10. Verify the audit row
Operator runs (LINKED, read-only):
```sql
select entity_type, event_type, actor_type, actor_id, before_state, after_state, ip_address, created_at
from public.audit_logs
where event_type='operator.kill_all'
order by created_at desc limit 5;
```
Assert: **exactly one new** row for this kill — `entity_type='operator'`, `event_type='operator.kill_all'`,
`actor_type='user'`, `actor_id` = the operator's uid, `after_state` carries `enabled_bots_after=0` +
`kill_applied/requires_attention/operational_state` (and `queue_read_failed`/`worker_read_failed` if telemetry failed),
`ip_address` null (RPC does not capture it), and **no secret substrings** (grep `before_state::text||after_state::text`
for `webhook_secret_hash|token|secret|credential` → 0). No credential/Vault change occurred.

## 11. Restore / re-arm → exact baseline diff = empty (reviewed restore SQL packet)
The guarded `operator_enable_bots` precheck RPC is **NOT built yet** (a separate future slice). For **testnet
validation only**, restore is done via the **explicit, reviewed, id-keyed restore SQL packet below** — never ad-hoc
prose. **This packet MUST be Codex-reviewed (filled with the §2 baseline ids) before the operator runs it.** A proper
guarded enable path replaces it in a later slice.

**Restore packet rules (all mandatory):**
- Restores **only** `status` and `trading_enabled`, keyed **by bot `id` only** (the exact ids captured in §2).
- **Transaction-wrapped** (`begin; … commit;`); operator-run only.
- Touches **nothing else** — no caps/sizing, no credentials/tokens, no queue, no trades, no worker/env.
- Restores **only** the bots whose baseline value was `trading_enabled=true` / `status='active'` (leave already-off
  bots off).
- After commit, **read-back diff MUST be empty** vs the §2 baseline; **if the diff is not empty → HARD STOP** (do not
  leave bots in a non-baseline state).

```sql
-- a8-h2-restore.sql — TESTNET restore to the §2 baseline. Fill the id lists from the captured baseline.
-- Codex-reviewed BEFORE execution. Operator-run only. QUEUE_ENABLED confirmed OFF throughout.
begin;

-- (1) re-enable trading ONLY for bots whose baseline trading_enabled was true:
update public.bots
   set trading_enabled = true
 where id in ( /* <baseline ids where trading_enabled = true>, comma-separated uuids */ )
   and deleted_at is null;

-- (2) un-pause ONLY for bots whose baseline status was 'active':
update public.bots
   set status = 'active'
 where id in ( /* <baseline ids where status = 'active'>, comma-separated uuids */ )
   and deleted_at is null;

commit;
```
**Read-back diff (must be empty):** re-run the §2 SELECT and compare per-bot `(status, trading_enabled)` to the
captured baseline for **every** bot — no bot enabled/active that wasn't in baseline, none missing that was. Restore is
not "done" until the diff is empty. Then confirm `operator_status()` shows `enabled_bots` = the baseline count and
`queue_enabled=false` still. **If the diff is non-empty → HARD STOP (§14).**

## 12. A2 ledger update (only AFTER the linked apply happened)
Once §3 actually applied `019` to the linked DB, operator/Claude update
`docs/production-a2-migration-009-decision-packet.md`: add **`019`** to the "applied-but-UNTRACKED" list (like
010-018), with its verified objects (`operator_kill_all(text,boolean)` + grants), so the reconcile-before-real-funds
list stays complete. Doc-only, Codex-reviewed, committed "at Oren request". **Do this only after** the apply — not
before.

## 12a. Final resting state of the frontend flag (explicit decision — required)
Because `VITE_OPERATOR_KILL_ENABLED` is **build-time**, the resting state after validation is a deliberate rebuild
decision, not a runtime toggle. **Default final state = FLAG OFF.** After a successful validation, unless Oren
**explicitly** decides to keep the kill UI armed for testnet operations:
- Operator **rebuilds with `VITE_OPERATOR_KILL_ENABLED` unset/≠'true'** and **redeploys** → the console returns to
  read-only, **no kill control in the DOM** (verify: header "(read-only)", `kill-button` absent).
- Record the chosen resting state explicitly in the run log: **(A) OFF** (default — validated then disarmed) or
  **(B) armed** (flag stays ON — only with explicit Oren approval, testnet only).
- The **RPC `019` may remain applied** (it is inert without an authenticated operator call); disarming the **UI** is
  what returns the surface to read-only. To also remove the RPC, use §13.

## 13. Rollback (if anything fails or must be undone)
Two independent concerns (never conflate):
- **Undo an executed kill** → the **§11 restore** to exact baseline (surgical re-enable/un-pause), **not** migration
  rollback.
- **Remove the RPC** (function-level) → per migration `019` §1a: **immediate** `REVOKE EXECUTE ON FUNCTION
  public.operator_kill_all(text, boolean) FROM authenticated;` (disables the action instantly, function still present);
  **optional/full** `DROP FUNCTION public.operator_kill_all(text, boolean);`. No bot-state rollback needed for the
  function itself.
- **Frontend** → rebuild with `VITE_OPERATOR_KILL_ENABLED` unset (flag OFF) + redeploy → kill control disappears; or
  revert the deploy.
- Order for a full abort: flag OFF (rebuild+redeploy) → `REVOKE EXECUTE` (→ optional `DROP FUNCTION`) → restore bot
  baseline (§11) → verify disarmed + baseline.

## 14. Stop / NO-GO conditions (abort immediately)
- `019` already present at §1 (unexpected prior apply) → stop, reconcile.
- Apply error at §3 (e.g., audit-INSERT ownership) → stop, no half-applied object.
- §4 grants wrong (PUBLIC/anon has EXECUTE) or bot state changed by the apply → stop, revoke/drop.
- §5 read-only smoke shows a kill control while the flag is OFF → stop (gating broken).
- §7a the **anon/no-auth** call is **not** denied (any HTTP 2xx / any bot change / any audit row) → **stop** — authz
  hole. (7b non-operator denial: stop likewise if run and not denied; skip is allowed only if the token is unavailable.)
- §11 restore packet run without Codex review of the filled ids, or a non-empty baseline diff after restore → **stop**.
- §8/§9 `enabled_bots_after ≠ 0`, or a "clean" `ok=true` while `open_trades>0`/`queue_length>0` → stop.
- §10 audit row missing, wrong actor, or any secret substring present → stop.
- §11 baseline diff non-empty after restore → stop; do not leave bots in a non-baseline state.
- Any sign of **real funds / mainnet / `QUEUE_ENABLED=true`** at any point → **hard stop**.

## GO / NO-GO
- **This runbook:** DOC, Rev 2 (Codex CP5 CHANGES 1-3 applied) — nothing applied/deployed/fired. **Returned for Codex
  CP5 re-review.** After CP5 PASS **and Oren approval**, the operator runs §1-§12 (Claude read-backs); the §11 restore
  packet needs its own Codex review once the baseline ids are filled; **§12a default final state = flag OFF**; §13/§14
  govern abort.
- **Testnet:** a clean §1-§11 run + exact-baseline restore ⇒ **A8-H2 testnet-closed** (RPC + real authenticated path +
  UI validated; H-A8-2 IMPLEMENTED for testnet). Slice 4 rendering is then live-validated.
- **Real funds = OPEN / NO-GO** regardless — still requires A8-H3 (KP5 isolation), A8-H4 (runtime drill of this path),
  A11, live-tier fail-closed proof, and migration reconcile.

---

## RUN — RESULTS: A8-H2 testnet validation = COMPLETE / GREEN (2026-07-09)
_updated by Codex at Oren request._ Operator-run mutations; Claude read-only read-backs. Testnet only; `QUEUE_ENABLED`
false throughout; no credential/token/queue/worker change; no mainnet/real funds.

**Pre-flight (read-only):** git clean/in-sync `81e4c00`; `019` absent; disarmed; **baseline = all 5 bots `active`,
`trading_enabled=false`** — BNBUSDT `36b46eb3…`, BTCUSDT `2dcaddba…`, ETHUSDT `c8913354…`, SOLUSDT `5acc84c9…`,
XRPUSDT `297dddb9…`.

| Step | Result |
|---|---|
| 1 — linked apply `019` | ✅ clean, surgical (`db query --linked --file`, never `db push`); owner=`postgres` (holds `audit_logs` INSERT) |
| 2 — read-back grants / no state change | ✅ fn exists (2 args); `authenticated`=EXECUTE, PUBLIC=none, anon=none; bot state unchanged |
| 3 — frontend flag-OFF deploy + DOM | ✅ Railway static svc `praxis-operator-console-production`; header "(read-only)", `kill-button`/`kill-controls` null |
| 4 — flag ON + rebuild | ✅ set `VITE_OPERATOR_KILL_ENABLED=true` on the **frontend** service (first attempt mis-set on the worker `praxis-platform` → removed; benign worker redeploy stayed disarmed); bundle rebuilt; kill control renders |
| 5 — **anon/no-auth denial (mandatory)** | ✅ HTTP **401**; zero effect (0 audit rows, bots unchanged) |
| 6 — one operator kill (UI) | ✅ SAFE; `kill_applied=true`, `enabled_bots_after=0`, `open_trades=0`, `queue_length=0`; audit `e4ec2abe-d16f-4bd5-bea9-623ededa885d` |
| 7 — verify audit + read-backs | ✅ exactly **1** `operator.kill_all` row (`entity_type=operator`, `actor_type=user`, `actor_id=2f0eb49b…`, `ip=null`, `updated_rows=0`, `paused_rows=5`, `enabled_after=0`, `op_state=SAFE`, **no secret substrings**); DB 0 active / **5 paused**, all `trading_enabled=false`, trades/dlq/queue=0 |
| 8 — approved restore packet | ✅ ran (only `bots.status`, exactly-5 row guard + baseline verify); committed |
| 9 — exact baseline restored | ✅ 5 active / 0 paused; per-bot **baseline diff EMPTY**; `enabled_bots=0`; still exactly 1 audit row |
| 10 — final flag OFF + redeploy | ✅ removed the flag; bundle back to the byte-identical flag-OFF build; DOM read-only (`kill-button`/`kill-controls` null) |

**Verdict:** the audited one-click kill is validated end-to-end on testnet — deployed UI → authenticated PostgREST →
`operator_kill_all` → one audited SAFE kill → fully reversible to the exact baseline; unauthorized callers rejected
(401) with zero effect. **H-A8-2 = IMPLEMENTED + VALIDATED (testnet).** `019` remains **applied-linked (untracked)** →
recorded in the A2 ledger (`production-a2-migration-009-decision-packet.md`).

**Minor follow-up (non-blocking):** the audit `reason` came through `null` (the UI reason field was empty at fire
time; `p_reason` is optional so this did not affect validity or the SAFE result). Check the Console reason-input capture
in a later cleanup — not a gate.

**Still OPEN for real funds:** A8-H3 (KP5 shared-credential blast-radius / per-bot isolation), A11, live-tier
fail-closed proof, A1/A4 hardening, A2 migration reconcile. **A8 not fully closed; real funds remain NO-GO.**
