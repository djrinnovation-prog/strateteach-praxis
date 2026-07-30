# A8-H2 — Audited One-Click Kill — Implementation Plan (gated slices)

> **DOC / PLANNING ONLY — NOT EXECUTION.** No code · no migration apply · no DB mutation · no deploy · no
> Railway/Doppler change · no mainnet/real-funds. This plan sequences the build of the **Codex-PASS design**
> (`docs/production-a8-h2-audited-one-click-kill-packet.md`, Rev 3). Grounded in the repo (file:line cited). Each slice
> is **Codex-reviewed before it is committed/applied**; nothing here authorizes writing code.
> **Rev 2 (2026-07-08): Codex plan-CHANGES 1-8 applied** — three migration-apply states (§1a), realistic
> audit-fail/queue tests (Slice 2), exact frontend paths (Slice 3), explicit migration rollback (§1a), exact-baseline
> restore (Slice 5), per-CP roles + global roles rule, and the A2-ledger step (Slice 6). **Returned for Codex
> re-review.**

## 0. Invariants carried from the DESIGN PASS (must hold in every slice)
- RPC `public.operator_kill_all(p_reason text DEFAULT NULL, p_hard_lock boolean DEFAULT true)`, `SECURITY DEFINER`,
  `SET search_path=''`, schema-qualified, **no dynamic SQL**, **no caller-supplied actor_id**.
- Grant model: `REVOKE ALL … FROM PUBLIC, anon;` `GRANT EXECUTE … TO authenticated;` — authz enforced **inside** the
  body via the proven `016` inline `public.profiles.is_operator` read; fail-closed (`42501`) on null uid / non-operator.
- **default `hard_lock=true`** ⇒ `trading_enabled=false` AND `status='paused'` for all live bots.
- **`ok=true` ONLY** when `enabled_bots_after=0 AND open_trades=0 AND queue_length=0`; residual ⇒ `kill_applied=true`
  but `ok=false` / `requires_attention=true` / `operational_state='ATTENTION'`.
- Denials **not** DB-audited; authorized kills **mandatory-audited in-transaction** (audit-fail ⇒ full rollback).
- H2 does **not** cancel orders, unwind positions, stop the worker, purge the queue, flip `QUEUE_ENABLED`, or
  invalidate credentials. **KP5 blast-radius = A8-H3.**

## 1. Grounded facts the build reuses (from read-only discovery)
- **Migration house style (surgical, transaction-wrapped):** latest applied `017`/`018` wrap the body in in-file
  `begin;` … `commit;`; `REVOKE ALL … FROM PUBLIC;` + `GRANT EXECUTE … TO <role>;`; `SECURITY DEFINER` + `SET
  search_path=''`; `RAISE EXCEPTION … USING errcode='42501'`. **Next free number = `019`** (highest file = `018`).
  Applied **surgically** via `supabase db query --linked --file`, **never `db push`** (`010-018` untracked;
  `a2-migration-009-decision-packet.md`).
- **Authz precedent** (`016_operator_status_rpc.sql:59-71`): `v_uid := auth.uid();` null → `42501`; `SELECT
  p.is_operator … WHERE p.id=v_uid;` `IS DISTINCT FROM true` → `42501`.
- **Reusable read-back SQL** (from `operator_status()` `016:106-111`):
  - enabled: `SELECT count(*) FROM public.bots WHERE trading_enabled=true AND deleted_at IS NULL`
  - open trades: `SELECT count(*) FROM public.trades WHERE status IN ('pending','submitted','unknown') AND deleted_at IS NULL`
  - queue: `public.pgmq_queue_length('trade_signals')` (wrapper `013:118-126`, SECURITY DEFINER; callable by the same
    definer owner as `operator_status`).
  - worker: `SELECT … FROM public.worker_status LIMIT 1`.
- **Enums** (`001:47-62`): `trade_status(pending,submitted,filled,failed,cancelled,unknown)`;
  `bot_status(pending_setup,active,paused,error,deleted)`; `actor_type(user,system,worker)`.
- **audit_logs** (`001:310-331`): columns `entity_type,entity_id,event_type,before_state,after_state,actor_type,
  actor_id,ip_address,created_at`; RLS denies all user writes (`001:602-612`); `INSERT` granted to `service_role`
  (`006:42-44`). A `SECURITY DEFINER` function **owned by the migration-applier role (`postgres`, which bypasses RLS)**
  can INSERT — **confirm ownership at apply** (residual item, §CP1).
- **Kill honored by deployed code (proof points):** worker `assertTradingEnabled` before adapter
  (`worker/src/index.ts:860` → `worker/src/sizingRisk.ts` throws `trading_disabled`); webhook intake reject
  (`supabase/functions/webhook/index.ts:186-189`, `bot.status !== "active"`). Both A10-proven (K1/K4).
- **Frontend wiring to mirror:** client `frontend/src/lib/supabase.ts:13` (anon key, persisted session); RPC helper
  `frontend/src/lib/status.ts:59-63` (`client.rpc('operator_status')`); `frontend/src/App.tsx:36`
  (`loadStatus=useCallback(()=>loadOperatorStatus(client))`) → `<StatusPanel loadStatus=…/>`
  (`frontend/src/components/StatusPanel.tsx`), read-only today; `isForbiddenError` renders "Operator access required".
- **Test runners:** Deno (`deno test <fn>/index.test.ts`, `jsr:@std/assert`, injected deps — see
  `admin-rotate-webhook-token/index.test.ts`); Node (`node --test _shared/*.test.ts`); Frontend Vitest
  (`cd frontend && npm test`). **No pgTAP / SQL test harness exists** (drives Slice 2's approach).

---

## 1a. Migration `019` — three distinct apply states (no ambiguity)
The word "applied" is split into three states; a slice/CP only ever advances one of them:
1. **AUTHORED/REVIEWED (repo):** the `019_*.sql` file exists in the repo and is Codex-reviewed. **No database has run
   it.** (Slice 1 → CP1.)
2. **APPLIED-LOCAL (throwaway):** run against a **disposable local Supabase** (`supabase start`) or a throwaway branch
   DB, **for tests only**. Never the linked DB. Torn down after (`supabase stop`). (Slice 2 → CP2.)
3. **APPLIED-LINKED (testnet):** run against the linked **testnet** DB — **only after CP1 + CP2 PASS AND an explicit
   Oren/operator approval**, executed **by the operator** (not the agent), surgically (transaction-wrapped `supabase db
   query --linked --file`), **never `db push`**. This happens as part of Slice 5's gated run, not in Slices 1-2.

**Rollback of the migration (additive RPC — no data rollback):**
- Immediate: `REVOKE EXECUTE ON FUNCTION public.operator_kill_all(text, boolean) FROM authenticated;` (disables the
  action instantly, function still present).
- Optional/full: `DROP FUNCTION public.operator_kill_all(text, boolean);`.
- **No bot-state rollback is needed** — the function *definition* changes no data; only an actual *kill run* changes bot
  rows, and **that** is reversed by the separate **guarded enable/re-arm flow** (`operator_enable_bots`, un-pause), **not**
  by migration rollback. Keep the two concepts distinct.

## SLICE 1 — Migration `019` : the `operator_kill_all` RPC (→ state AUTHORED/REVIEWED)
**Goal:** author the SQL migration file only (NOT applied).
**Files to touch (create):**
- `supabase/migrations/019_operator_kill_all.sql` — `begin; … commit;` wrapped:
  - `CREATE FUNCTION public.operator_kill_all(p_reason text DEFAULT NULL, p_hard_lock boolean DEFAULT true) RETURNS
    jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ … $$;`
  - body: authz (`016` inline pattern) → `p_reason` validation (`length ≤ 500`, `~ '^[[:print:][:space:]]*$'`, else
    `RAISE … 42501`) → capture `before` (bots snapshot + `enabled_bots_before`) → `UPDATE public.bots SET
    trading_enabled=false WHERE trading_enabled=true AND deleted_at IS NULL` (`GET DIAGNOSTICS v_updated=ROW_COUNT`) →
    if `p_hard_lock` `UPDATE public.bots SET status='paused' WHERE status='active' AND deleted_at IS NULL` (`paused_rows`)
    → read-back (`enabled_bots_after`, `open_trades`, `queue_length`, `worker_state`) → compute
    `kill_applied/requires_attention/operational_state/ok` per §0 → `INSERT INTO public.audit_logs(...)` (event
    `operator.kill_all`, `actor_type='user'`, `actor_id=v_uid`, status-only before/after, **no ip**) `RETURNING id INTO
    v_audit_id` → `RETURN jsonb_build_object(...)` (the §2a contract). Audit-insert failure propagates ⇒ PostgREST tx
    rollback (mandatory-audit).
  - `REVOKE ALL ON FUNCTION public.operator_kill_all(text, boolean) FROM PUBLIC, anon;`
  - `GRANT EXECUTE ON FUNCTION public.operator_kill_all(text, boolean) TO authenticated;`
  - `COMMENT ON FUNCTION …` describing the audited kill (no secrets).
**State reached:** AUTHORED/REVIEWED only. File committed for review; **no DB has run it.**
**Test command (compile-check, no apply):** none run against any linked DB; `019` is exercised in Slice 2 against a
LOCAL DB. (Optionally `supabase db lint` if available — else skip.)
**Rollback:** per §1a (additive; `REVOKE EXECUTE` then optional `DROP FUNCTION`; no bot-state rollback).
**► Codex checkpoint CP1 — roles:** **Codex reviews** the full `019` SQL — authz, no-dynamic-SQL, schema-qualified,
`ok`/attention math, mandatory-audit-before-return, grants, and **confirms the function-owner role (`postgres`,
bypasses RLS) has INSERT on `audit_logs`** (not by exposing service_role to the browser). **No linked apply here.** PASS
→ Slice 2.

## SLICE 2 — RPC semantics tests (no pgTAP → SQL fixture on LOCAL DB; → state APPLIED-LOCAL)
**Goal:** prove the RPC's semantics deterministically **before** it touches the testnet DB. Since the repo has **no
SQL test harness**, use a self-contained SQL script run against a **disposable local Supabase** (`supabase start`) or a
throwaway branch DB — **never the linked testnet/prod DB**.
**Files to touch (create):**
- `supabase/tests/019_operator_kill_all.test.sql` — seed fixtures (an operator profile, a non-operator profile, N bots
  with `trading_enabled=true`/`status='active'`, optional open-trade + queued-message fixtures), then assert via
  `DO $$ … ASSERT … $$` blocks or `SELECT` checks:
  1. non-operator / null uid → `42501`, **zero** bot changes, **zero** new `audit_logs` rows;
  2. operator clean kill (`open_trades=0`,`queue_length=0`) → `ok=true`, `kill_applied=true`, `enabled_bots_after=0`,
     all `status='paused'` (default hard-lock), **exactly one** `operator.kill_all` audit row (actor=uid, no secrets);
  3. idempotent second call → `kill_applied=true`, `updated_rows=0`, new audit row, before=already-disabled;
  4. `p_hard_lock=false` → only `trading_enabled=false`, `status` unchanged;
  5. `open_trades>0` → `kill_applied=true`, `ok=false`, `requires_attention=true`, `operational_state='ATTENTION'`
     (open-trade fixtures are **plain `INSERT INTO public.trades` rows in the LOCAL DB** — fully controllable);
  6. `p_reason` >500 / non-printable → `42501`, zero effect; valid reason stored verbatim.

**Two items that are NOT brittle SQL assertions (per Codex):**
- **`queue_length>0` (ATTENTION):** `queue_length` comes from `public.pgmq_queue_length('trade_signals')` →
  `pgmq.metrics(...)`, which is **not cheaply forced by inserting fake rows**. Handle as **(a) static review** that the
  RPC classifies `queue_length>0` as ATTENTION (read the branch), **plus (b) an optional LOCAL-ONLY integration check**
  if a real local pgmq message can be enqueued via the local worker/pgmq API (safe, disposable), **else deferred to the
  Slice 5 testnet integration run**. **Never invent fake queue rows in the linked DB.**
- **Audit-fail → rollback:** a `postgres`-owned SECURITY DEFINER function will not naturally fail its `audit_logs`
  INSERT, so **do not promise a brittle test.** Instead: **(a) static review requirement** — the audit INSERT occurs
  **before** the final `RETURN` and inside the same transaction (so any failure aborts the whole call); **(b) optional
  LOCAL-ONLY negative test** if feasible (e.g. in a local fixture, temporarily rename/revoke the audit target inside the
  test transaction and assert the flag UPDATEs did not persist), rolled back immediately; **(c) NO linked destructive
  audit-fail test** — ever.
**Test commands:**
- `supabase start` (local stack) → apply `019` to the **LOCAL** DB → `supabase db query --file
  supabase/tests/019_operator_kill_all.test.sql` (or `psql "$LOCAL_DB_URL" -f …`). Assertions raise on failure. Tear
  down with `supabase stop`.
- **Operator confirms local-only**; **nothing runs against `--linked`** in this slice.
**Rollback:** LOCAL/branch only — `supabase stop` / drop the branch. No linked/prod impact.
**► Codex checkpoint CP2 — roles:** **Codex reviews** the test script + the LOCAL run output (assertions 1-6 PASS;
queue + audit-fail handled per the static-review/optional-local rule above). **No linked apply.** PASS → proceed.

## SLICE 3 — Operator Console: kill action + guarded button
**Goal:** wire a single guarded "Kill all trading" control that calls the RPC. **No deploy.**
**Exact files (confirmed by read-only discovery — no vagueness, no Slice 0 needed):**
- **NEW `frontend/src/lib/actions.ts`** — resolved: mutations live in a **new** module (reads stay in
  `frontend/src/lib/status.ts`, which currently holds `loadOperatorStatus` at `status.ts:59-63`; do not overload it).
  Add:
  `export async function operatorKillAll(client: SupabaseClient, { reason, hardLock = true }): Promise<KillResult> {
  const { data, error } = await client.rpc('operator_kill_all', { p_reason: reason ?? null, p_hard_lock: hardLock });
  if (error) throw error; return data as KillResult }` + a `KillResult` type mirroring the §2a contract.
- **EDIT `frontend/src/App.tsx`** (mirror the existing `loadStatus` wiring at `App.tsx:36`) — add
  `const killAll = useCallback((reason: string) => operatorKillAll(client, { reason }), [client])`; pass `killAll` into
  `<StatusPanel …/>` alongside the existing `loadStatus` prop.
- **EDIT `frontend/src/components/StatusPanel.tsx`** (currently read-only; props type `StatusPanelProps` at
  `StatusPanel.tsx:13-17`) — extend props with `killAll?`, add a guarded **Kill all trading** button rendered **only in
  the loaded `'ok'` view state**, behind an explicit **confirm step** (typed-confirm or two-click modal) with a short
  reason field; on click → `killAll(reason)` → store the `KillResult` for Slice-4 rendering. Reuse the existing
  `isForbiddenError` path for `42501`; mirror the existing `role="status"`/`role="alert"` a11y.
- **NEW `frontend/src/lib/actions.test.ts`** — Vitest: mock `client.rpc` to assert params (`p_hard_lock` default true,
  reason passthrough), and that a thrown `42501` surfaces as forbidden.
- (client stays `frontend/src/lib/supabase.ts:13` — anon key, persisted session; **no** change, **no** service_role.)
**Test commands:** `cd frontend && npm run typecheck && npm test` (Vitest). Optionally `npm run build` (compile only —
**not** deployed).
**Rollback:** pure frontend diff, **not deployed** → `git revert` the commit; live console unchanged until a separate,
gated deploy.
**► Codex checkpoint CP3 — roles:** **Codex reviews** the frontend diff (confirm-gating, default `hard_lock=true`, no
service_role in the browser, no secret handling, forbidden-path UX). **Oren/operator approves** any later console
**deploy**. **No deploy in this slice.** PASS → proceed.

## SLICE 4 — Read-back / status rendering (ATTENTION surfacing)
**Goal:** render the `KillResult` truthfully — never a green "all clear" when residual exists.
**Files to touch:**
- `frontend/src/components/StatusPanel.tsx` (+ maybe a small `KillResultBanner.tsx`) — after a kill, show
  `operational_state`: **SAFE** (green) only when `ok=true`; **ATTENTION** (amber/red, `role="alert"`) when
  `requires_attention` — display `open_trades`, `queue_length`, `enabled_bots_after`, `worker_state`, and the
  `message`. Then re-poll `loadStatus()` (the existing `operator_status` read) for the independent second read-back and
  show the refreshed matrix.
- `frontend/src/lib/status.ts` — extend the `OperatorStatus`/types if needed to render the post-kill fields
  (only additive typing).
- Vitest test: given a mocked `KillResult` with `open_trades>0` → asserts the ATTENTION banner renders and no
  "all clear".
**Test commands:** `cd frontend && npm run typecheck && npm test`.
**Rollback:** frontend diff → `git revert`; **not deployed**.
**► Codex checkpoint CP4 — roles:** **Codex reviews** the rendering (ATTENTION cannot be mistaken for clean; residual
counts visible; matches §2a). **Oren/operator approves** any later deploy. **No deploy here.** PASS → proceed.

## SLICE 5 — Testnet validation runbook (gated; execution is a separate approved run)
**Goal:** author the exact operator-run validation for when `019` is applied + the console deployed to **testnet**.
Mirrors the A10/H6 discipline (operator mutates, Claude read-backs; raw read-backs; no secrets).
**Files to touch (create):**
- `docs/production-a8-h2-testnet-validation-runbook.md` — exact steps:
  - **Pre — EXACT baseline capture (mandatory, before any kill):** raw `operator_status()` read-back recorded to a
    baseline artifact — **per-bot `id` + `trading_pair` + `trading_enabled` + `status`**, plus `enabled_bots`,
    `open_trades`, `queue_length`. This exact per-bot baseline is the **restore target**. Confirm testnet only / no real
    funds; PITR/backup noted; **operator (not agent)** applies migration `019` to the **linked testnet** DB surgically
    (transaction-wrapped `db query --linked --file`, **never `db push`**) only after CP1+CP2 PASS; then object-verify
    (function exists, grants = revoke public/anon + execute authenticated, owner has audit INSERT).
  - **Runs** (each = **operator** action → **Claude** raw read-back only): (1) **denial** (non-operator JWT → `42501`,
    zero bot changes, zero new audit rows); (2) **operator clean kill** (→ `ok=true`, `enabled_bots=0`, all active bots
    `paused`, exactly one `operator.kill_all` audit row, no new trades / no credential change); (3) **idempotent**
    second click; (4) **ATTENTION** (with a local/safe open-trade and — if a real testnet queued message is available —
    queued-message condition → `ok=false`, ATTENTION, queue **not** purged).
  - **Baseline RESTORE (explicit, not just "guarded re-arm"):** re-arm **only** via the guarded
    `operator_enable_bots` precheck path **and** un-pause (`status`→`active`) — **NOT** any kill inverse, **NOT**
    migration rollback. Then **verify the restored state equals the EXACT captured baseline** per-bot (each bot's
    `trading_enabled` and `status` match the pre-capture), via raw `operator_status()` read-back. Restore is not
    "done" until the per-bot diff against baseline is empty.
  - **Evidence:** counts / pass-fail only; raw read-backs; secrets never printed.
  - **GO/NO-GO:** clean run + exact-baseline restore ⇒ A8-H2 testnet-closed; real funds remain NO-GO
    (H3/H4/A11/live fail-closed/reconcile).
**No execution in this slice** — runbook text only.
**Test command:** n/a (doc). The run itself is a later, explicitly-approved gate.
**Rollback (for the eventual run):** an executed **kill** is reversed by the **guarded enable/re-arm to the exact
baseline** (above) — **not** migration rollback; the **migration** `019` is reversed per §1a (`REVOKE EXECUTE` →
optional `DROP FUNCTION`), no bot-state change. Two separate concerns.
**► Codex checkpoint CP5 — roles:** **Codex reviews** the runbook BEFORE the gated run **and** the run evidence AFTER
(counts) to mark validation PASS. **Oren/operator approves** the linked apply + the run and **executes** all mutations;
**Claude/Codex do read-backs only** — **no agent applies the linked migration or fires the kill.**

## SLICE 6 — Documentation + Kanban
**Goal:** record outcomes; keep the ledger honest.
**Files to touch:**
- `docs/production-a8-h2-implementation-plan.md` (this file) — append per-slice status as each PASSes.
- Update the A8 Kanban card (`390d6df6-026d-8156-97f0-d311ed3a8ce3`) — H-A8-2 IMPLEMENTED (testnet) once Slice 5 PASS;
  "updated by Codex at Oren request".
- Update `docs/production-a8-kill-path-readiness-packet.md` (H-A8-2 status) + memory
  `praxis-a8-h2-one-click-kill.md` (design→implemented).
- **A2 migration ledger (mandatory after the linked apply of `019`):** update
  `docs/production-a2-migration-009-decision-packet.md` — add `019` to the "applied-but-UNTRACKED" list (like 010-018),
  with its verified objects (function + grants), so the reconcile-before-real-funds list stays complete. This step runs
  **only after** Slice 5's linked apply actually happens (not before).
**Test command:** n/a.
**Rollback:** doc-only (`git revert`).
**► Codex checkpoint CP6 — roles:** **Codex reviews** the doc/Kanban/ledger wording before commit; **operator** does
the `git push` and Notion is updated "at Oren request". No linked/DB action here.

---

## Sequencing, gates & test-command summary
| Slice | Deliverable / state | Test / verify | Rollback | Codex CP |
|---|---|---|---|---|
| 1 | `019_operator_kill_all.sql` → **AUTHORED/REVIEWED** | reviewed SQL; (opt) `supabase db lint` | §1a: `REVOKE EXECUTE` → opt `DROP FUNCTION` | **CP1** (Codex review; no apply) |
| 2 | `019_*.test.sql` → **APPLIED-LOCAL** only | `supabase start` + `db query --file` (LOCAL); assertions 1-6 + static-review for queue/audit-fail | LOCAL `supabase stop`/drop branch | **CP2** (Codex review; no linked) |
| 3 | Console action + guarded button (undeployed) | `cd frontend && npm run typecheck && npm test` | `git revert` (undeployed) | **CP3** (Codex; Oren approves any deploy) |
| 4 | ATTENTION rendering (undeployed) | `cd frontend && npm run typecheck && npm test` | `git revert` (undeployed) | **CP4** (Codex; Oren approves any deploy) |
| 5 | Testnet validation runbook → later **APPLIED-LINKED** gated run | doc; gated run later (operator mutates + Claude read-backs) | executed-kill = guarded re-arm to EXACT baseline; migration = §1a | **CP5** (Codex before+after; Oren approves linked apply+run) |
| 6 | Docs + Kanban + A2 ledger | n/a | `git revert` | **CP6** (Codex review wording) |

**Order:** 1 → 2 → (3 ‖ 4 pipeline) → 5 → 6. **Each slice is committed only on its Codex CP PASS.** Migration `019`
reaches **APPLIED-LINKED only after CP1+CP2 PASS AND explicit Oren approval**, executed **by the operator**, surgically
(transaction-wrapped `supabase db query --linked --file`), **never `db push`**; the frontend is **deployed only** as a
later, explicitly-approved step (Slices 3-4 land as reviewed-but-undeployed code first).

**Roles at every checkpoint (invariant):** **Codex** reviews the artifact/diff; **Oren/operator** approves and executes
any **linked DB apply, deploy, or kill run**; **Claude/Codex run read-backs only**. **No agent applies a linked
migration or deploys.** (Consistent with the standing operating model.)

## Global guardrails (unchanged)
- **Agent never pushes / never applies:** operator runs all `git push`, migration applies, `supabase start`, deploys,
  and any DB mutation; Claude does read-only read-backs.
- **Never `db push`**; `009` frozen; `010-019` surgical/untracked → reconcile before real funds.
- **Testnet only, no mainnet, no real funds, QUEUE_ENABLED stays off**; A11 not granted.
- **Evidence discipline:** raw read-backs; empty/filtered output ≠ evidence; secrets never printed.

## GO / NO-GO
- **This plan:** PLANNING, Rev 2 (Codex plan-CHANGES 1-8 applied) — nothing built/applied. **Returned for Codex
  re-review of the plan itself.** On PASS, begin Slice 1 (author `019` SQL, state AUTHORED/REVIEWED) → CP1.
- **Testnet:** A8-H2 becomes testnet-closed only after Slice 5 validation PASS.
- **Real funds = OPEN / NO-GO** — still needs A8-H3 (KP5 isolation), A8-H4 (runtime drill of this path), A11, live-tier
  fail-closed proof, migration reconcile.
