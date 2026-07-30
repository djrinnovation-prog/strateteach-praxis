# Operator Console — Ops Harness (Planning)

> **DOC / PLANNING ONLY — NO CODE.** No deploy · no DB mutation · no flag change · no kill call · no mainnet/real
> funds. Design for a console workflow that **reduces manual terminal/Railway/browser friction** while keeping **Oren
> approval for every mutation**. Grounded in what exists: `operator_status()` (migration 016), `operator_kill_all`
> (migration 019, audited), `audit_logs` (001), the gated A8-H2 validation run (2026-07-09), and the read-only console
> (`StatusPanel`/`actions.ts`). Everything mutating stays a **separately-implemented, Codex-reviewed, testnet-gated**
> slice.
>
> **Rev 2 (2026-07-09): Codex CHANGES 1-8 applied** — read-only generators are NOT audited unless persisted (no `*`
> ambiguity); the restore generator emits a **NOT-EXECUTABLE reviewed artifact** (no run-now path); mutation buttons
> split into validated / future-stop-only / forbidden-deferred tiers (no generic framework); preflight adds deploy/git
> read-only evidence helpers; a UI-integration section (reuse visuals, rebuild logic in React, flag per action); the run
> tracker is an **optional Slice B, not a prerequisite**; a success metric; and an explicit real-funds boundary.
> **Returned for Codex re-review.**

## 0. Governing principles (non-negotiable)
- **Browser holds no privilege.** Every read is a `SECURITY DEFINER` operator RPC (like `operator_status`); every
  mutation is a guarded `SECURITY DEFINER` RPC that re-enforces `auth.uid()` + `profiles.is_operator` in-body. No
  service_role / Vault / exchange keys in the bundle.
- **The harness never auto-mutates.** It automates **read → generate → verify**. It does **not** click mutation buttons,
  apply migrations, deploy, or push git. A mutation happens only when the **operator** types the confirmation and clicks.
- **Oren approval is unchanged.** The harness makes correct actions *easier and better-evidenced*; it does not lower the
  approval bar. Stop-direction actions (kill/disable/pause) need typed-confirm + operator click; arm/enable and anything
  real-funds stay **out-of-band Oren-gated**.
- **Reads are cheap and safe; mutations are rare and gated.** Build all read-only/generator features first (low risk),
  add mutation buttons last, each as its own validated slice.
- **Out of console scope (stay manual/operator):** `git` push/commit, Railway deploys + env/flag changes, Doppler,
  **linked migration applies**, and `QUEUE_ENABLED`. The console reads DB state and fires *already-built* guarded RPCs;
  it does not manage infra.

---

## 1. Read-only preflight button
- **Reads (DB):** `operator_status()` payload (per-bot state, `enabled_bots`, `open_trades`, `dlq`, `open_recon`,
  `queue_length`, `worker_status`) **+** a small extension exposing `kill_rpc_present` (does `operator_kill_all` exist).
- **Reads (deploy/build — the git/Railway bottleneck, now surfaced as evidence, not ignored):**
  - **deployed frontend bundle hash** — the console fetches its own served `index.html` and reads the `/assets/index-
    <hash>.js` name (self-inspection; the same hash we verify by hand today).
  - **expected commit hash** — baked at build into a `VITE_BUILD_COMMIT` (or `build-info.json`) so the console can show
    "built from `<sha>`" and the operator compares to `origin/main`.
  - **flag ON/OFF detection** — `killEnabled` (`VITE_OPERATOR_KILL_ENABLED`) is known client-side; show it explicitly.
  - **Railway service checklist** — a static, rendered **evidence checklist** ("flag set on `praxis-operator-console-
    production` (frontend), NOT `praxis-platform` (worker)"; "worker vs frontend service confirmed") with operator
    check-off fields. **No Railway API is called** — it's a guided checklist + captured operator confirmations, which
    directly targets the wrong-service mistake we hit in the A8-H2 run.
- **Mutates:** **No.**
- **Guard:** operator auth (the RPC already raises `42501` for non-operators).
- **Audit event:** **none** (read-only; nothing persisted).
- **Failure/rollback:** read error → DEGRADED banner, no state change; unknown fields render "unknown", never "pass".
- **Stays manual/operator:** **git clean/sync** and the truth of the **Railway dashboard** remain operator-confirmed
  (browser can't read git or Railway state) — but the console now **shows the expected values + checklist** so the
  operator confirms against evidence instead of remembering. CI could later assert the commit-hash match.
- **Slices:** extend `operator_status()` (add `kill_rpc_present`); add `VITE_BUILD_COMMIT`; client bundle-hash
  self-read + checklist render. Read-only.

## 2. Baseline capture / export  (client-side, read-only)
- **Reads:** per-bot **`id`, `trading_pair`, `status`, `trading_enabled`** (+ counts). **Gap:** `operator_status()`
  today returns `trading_pair` but **not `id`** — baseline/restore need `id`. Requires a read that includes `id`
  (extend `operator_status`, or a dedicated `operator_baseline()` read RPC).
- **Mutates:** **No.** Default is **client-side download** (`baseline-<run_id>.json`) — a pure read + browser download.
- **Guard:** operator auth (to load the data).
- **Audit event:** **NONE** — a client-side download is not a security event, so **no DB audit row**. (Server-side
  persistence is a *deferred, separate* option — see §6/Data-model — and only *then* gets a defined table/RLS/audit.)
- **Failure/rollback:** read error → no capture; nothing to roll back (no write).
- **Stays manual/operator:** operator initiates.
- **Slices:** read RPC with `id`; client JSON export. Read-only.

## 3. Post-action verifier
- **Reads:** current `operator_status()` + the relevant `audit_logs` rows; compares to the **expected** post-action
  state (e.g. after a kill: `enabled_bots=0`, all target bots paused, exactly N new `operator.kill_all` rows) →
  **PASS / ATTENTION / FAIL** with a per-field diff.
- **Mutates:** **No.**
- **Guard:** operator auth.
- **Audit event:** none (read).
- **Failure/rollback:** a mismatch **never auto-remediates** — it surfaces FAIL/ATTENTION and points the operator to the
  restore packet (§5) or an abort. Empty/insufficient read → "cannot verify" (not a pass).
- **Stays manual/operator:** deciding what to do on FAIL is the operator's.
- **Slices:** a diff engine over the read payload vs an expected-state object; reuse the KillResult rendering.

## 4. Evidence JSON/text generator  (client-side, read-only)
- **Reads:** the already-collected preflight + baseline + action-response + verifier outputs (client-side state).
- **Mutates:** **No** — client-side assemble + download `evidence-<run_id>.json` / `.md`.
- **Guard:** operator auth (to have loaded the data at all).
- **Audit event:** **NONE** (pure client-side serialization, no persistence). The *trading action itself* is already
  audited by its RPC (`operator.kill_all` etc.); this artifact just collates read-backs — status fields only, **no
  secrets**.
- **Failure/rollback:** none (pure serialization).
- **Stays manual/operator:** nothing.
- **Slices:** a serializer that emits the evidence table we produce by hand today (step results, ids, counts, verdict).

## 5. Restore packet generator  (produces a NOT-EXECUTABLE reviewed artifact)
- **Reads:** the captured **baseline** (§2) + current state.
- **Mutates:** **No.** It emits a **reviewed artifact, explicitly NOT an operator-ready "run now" command.** Hard rules:
  - The output is a **`.txt`/`.md` draft** (not a directly-pipeable `.sql`), watermarked at the top:
    `-- NOT EXECUTABLE UNTIL CODEX REVIEW — do not pipe/run as-is`. **No copy-and-run affordance, no auto-execute path,
    no embedded connection string / credentials.**
  - It includes the **baseline diff** it would reverse: per-bot `id`, `status` (current→baseline), `trading_enabled`
    (current→baseline) — so the reviewer sees exactly what it targets.
  - The SQL body is the Codex-PASS'd shape (id-keyed, transaction-wrapped, restores only `status`/`trading_enabled`,
    **exactly-N row guard + post-restore baseline verification, raise+rollback on mismatch**). **No secrets.**
- **Guard:** operator auth to read the baseline.
- **Audit event:** **NONE** (client-side generation; nothing persisted).
- **Failure/rollback:** no baseline → refuse to generate; generation never touches the DB.
- **Stays manual/operator:** **Codex review of the filled artifact THEN operator-run execution** — either via a surgical
  reviewed SQL packet (as done 2026-07-09) or a *future separate guarded RPC*. The generator only removes hand-templating
  friction; it never shortens the review→execute gate.
- **Slices:** a templater baseline→artifact string + diff table; download as non-executable `.txt`. **Execution is a
  distinct, deferred, guarded slice — never bundled with generation.**

## 6. Validation-run tracker with `run_id`  (OPTIONAL — Slice B, NOT a prerequisite)
> **Not required for the read-only harness.** A `run_id` can be a **client-side value** stamped into the downloaded
> evidence/baseline files (Slice A). Server-side persistence is only worth it once there are ≥2 mutation types to track
> across sessions — otherwise it adds a DB write surface for little gain. **Do not build the ops tables before Slice A.**
- **Reads:** all step outputs.
- **Mutates:** **If built:** append-only OPS METADATA only — `operator_runs` (run_id, opened_by, opened_at, purpose,
  closed_at, verdict) + `operator_run_steps` (run_id, step, status, ts, evidence_ref, audit_ref). **Never trading
  state**; references the real `audit_logs` row by id.
- **Guard:** operator auth; ops-RPCs re-check operator; **RLS append-only** (mirror `audit_logs` deny-user-write:
  `WITH CHECK (FALSE)` for users, definer/service append only).
- **Audit event:** the run rows ARE the ops record; the trading action still writes its own `audit_logs` row which the
  step references. (This is the ONE place a "generated" artifact becomes a defined persisted record — with an explicit
  table + RLS, per CHANGE 1.)
- **Failure/rollback:** a tracker-write failure flags the step "untracked" but never blocks the trading action's own
  atomic audit; a wrong run row is reversible (append-only → supersede, don't mutate).
- **Stays manual/operator:** opening/advancing/closing a run = operator actions.
- **Slices:** **Slice B only** — `operator_runs`/`operator_run_steps` migration (append-only, RLS) + open/append/close
  RPCs. Deferred behind Slice A.

## 7. Mutation actions — THREE separate tiers (no generic "mutation button" framework)
> Each action is its **own** RPC + design + LOCAL test + default-OFF feature flag + testnet validation. There is **no
> shared "mutation button" abstraction** to build now — that would be a framework ahead of its actions. The harness
> **never auto-fires**; every mutation is an operator click behind a typed confirmation.

### 7a. VALIDATED — `operator_kill_all`  (BUILT)
- Migration 019, audited, testnet-validated 2026-07-09. Typed-`KILL` confirm; default-OFF `VITE_OPERATOR_KILL_ENABLED`.
- Audit `operator.kill_all` (mandatory in-tx). Rollback = the reviewed restore packet (§5). **Reference implementation
  for any future action — but not a reusable "framework" yet.**

### 7b. FUTURE — stop-only actions (NOT built; each its own slice)
- **`operator_disable_bots(ids)`** and **`operator_set_pause(true)`** (pause bots) — **safe-direction (only *stop*)**,
  designed in `production-operator-console-mvp-design.md`, **RPCs not built.**
- Each requires its **own** RPC design → Codex CP → impl → LOCAL test → testnet validation, plus its **own default-OFF
  feature flag** and typed confirmation (`DISABLE`/`PAUSE`). Audit `operator.disable_bots` / `operator.set_pause`.
- Rollback = guarded re-arm / reviewed restore. **Disabled in the UI until each is separately implemented + validated.**

### 7c. FORBIDDEN / DEFERRED — arming actions (Oren-gated, out of the default set)
- **`operator_enable_bots(ids)` (precheck-guarded), any queue-arm (`QUEUE_ENABLED`/pause-off), any signal fire.**
- **Not built and not built-toward here.** Arming/enabling is **out-of-band Oren-gated**; these surfaces render **absent
  or visibly disabled+blocked**, never as live buttons. Real-funds fire stays fully out of scope.

**Common to all tiers:** operator auth + server-side RPC re-enforces authz; typed confirmation + explicit operator click
(harness never auto-fires); RPC atomic with mandatory in-tx audit; read-back verifies (SAFE/ATTENTION); no raw inverse
— rollback is the guarded restore path.

## 8. Final disarmed verifier
- **Reads:** `operator_status()` — asserts the **disarmed invariant**: `enabled_bots=0`, `queue_enabled=false`,
  `queue_length=0`, `open_trades` acknowledged, bots at the intended resting state (baseline or paused), no armed flag.
- **Mutates:** **No.**
- **Guard:** operator auth.
- **Audit event:** none (read); result recorded in the run tracker (§6).
- **Failure/rollback:** NOT-disarmed → red banner + blocks "run closed = GREEN"; points to restore/abort.
- **Stays manual/operator:** operator confirms + decides.
- **Slices:** a specialization of §3 targeting the disarmed invariant; reuse the DEGRADED/ATTENTION rendering.

## 9. Documentation-draft generator
- **Reads:** the run tracker (§6) + evidence (§4).
- **Mutates:** **No** — emits a **markdown draft** of the RUN-results section (the shape of the Slice 6 doc) for
  operator/Codex review.
- **Guard:** operator auth.
- **Audit event:** none.
- **Failure/rollback:** none.
- **Stays manual/operator:** **Codex review + `git` commit/push stay manual** — the generator drafts, it does not
  commit.
- **Slices:** a templater from the run log → markdown; download `.md`.

---

## Summary matrix
| # | Feature | Mutates? | Guard | Audit event | Slice |
|---|---|---|---|---|---|
| 1 | Preflight (+ deploy/git evidence) | no | operator auth | none | A |
| 2 | Baseline capture (client download) | no | operator auth | **none** (client-side) | A |
| 3 | Post-action verifier | no | operator auth | none | A |
| 4 | Evidence generator (client download) | no | operator auth | **none** (client-side) | A |
| 5 | Restore generator (**NOT-EXECUTABLE artifact**) | no | operator auth | **none** (client-side) | A |
| 8 | Disarmed verifier | no | operator auth | none | A |
| 9 | Doc-draft generator | no | operator auth | none | A |
| 6 | Run tracker (run_id) | **append-only ops metadata** | operator auth + append-only RLS | run rows (defined table) | **B (optional)** |
| 7a | `operator_kill_all` | **YES** | typed-`KILL` + auth + server authz | `operator.kill_all` | done ✅ |
| 7b | disable_bots / set_pause (stop-only) | **YES** | typed-confirm + flag + server authz | `operator.disable_bots` / `.set_pause` | C (each own) |
| 7c | enable / arm / fire | — | **Oren-gated, deferred** | — | deferred |

**No `*` ambiguity:** every client-side generator writes **no** DB audit; the only persisted record is the optional run
tracker (§6, Slice B), which has an explicit table + append-only RLS.

## Data-model additions (design; gated, not applied)
- **Read RPC must include bot `id`** (baseline/restore need it) — extend `operator_status()` or add `operator_baseline()`.
- **`operator_runs` / `operator_run_steps`** — append-only ops metadata (run_id, steps, verdict, refs to `audit_logs`).
  RLS deny-user-write (mirror `audit_logs`); service/definer append only. **No trading state.**
- Reuse `audit_logs` for the actual mutation audit (unchanged).

## Operator Console UI integration (standalone Claude-designed UI vs the real console)
The harness is built **in the real React console** (`frontend/`, `StatusPanel`/`actions.ts`) against **real status
APIs** — it is **not** the standalone Claude-designed UI mockup. Integration rules:

**Reuse safely — VISUAL components only (already built, read-only or validated):**
- The **read-only status surface** — System counts + Bots table (`StatusPanel`), the **DEGRADED** banner,
  **forbidden/42501** handling, **Login/auth gate** → the harness's preflight/verifier/disarmed views.
- The **KillResult rendering** — SAFE vs ATTENTION, `open_trades`/`queue_length`/telemetry-null detail → the verifier
  (§3) and 7a result.
- The **typed-confirmation pattern** + **default-OFF feature-flag** (`VITE_OPERATOR_KILL_ENABLED`) → the template each
  new action re-implements with **its own flag**.
- The validated **`operator_kill_all` button** (7a). ✅

**Hard rules for pulling from the standalone mockup:**
- **Reuse visual/layout only — do NOT copy the standalone UI's JS logic.** Any mock data, fake handlers, or client-side
  "auth" from a standalone prototype is **not** trustworthy. **Rebuild all behavior in React against the real
  SECURITY-DEFINER RPCs** (`operator_status`, `operator_kill_all`, future ops RPCs) with real Supabase auth.
- **Every action surface stays DISABLED unless backed by a reviewed, built RPC.** A button may render only if its RPC
  exists, is Codex-reviewed, LOCAL-tested, and testnet-validated — otherwise it is **absent or visibly disabled+blocked**.
- **One default-OFF feature flag PER action** (not a global "actions on" switch) — so each mutation ships and arms
  independently.

**Must stay DISABLED until separately implemented (do NOT surface as live actions):**
- **enable / arm / queue-on** — no RPC, **Oren-gated** (7c). Absent or visibly disabled+blocked.
- **`disable_bots` / `set_pause`** — RPCs **designed but NOT built** (7b); disabled until each is built + LOCAL-tested +
  testnet-validated (A8-H2 pattern).
- **Restore EXECUTION** button — generator (§5) is **artifact-only**; execution stays operator-run + Codex-reviewed
  until a guarded restore/enable RPC exists.
- Anything touching **credentials/Vault/queue-purge/worker** — out of scope (H3 / operational).

## Success metric (why this is worth building)
The A8-H2 validation run took **~10–15 manual copy/paste steps** across terminal + Railway dashboard + browser DevTools
(preflight queries, baseline capture, wrong-service diagnosis, DOM checks, kill, verify, hand-templated restore, final
checks, doc write-up). **Target after Slice A:** the same run = **2–3 operator approvals + one evidence export** — i.e.
one Preflight click (DB + deploy/git evidence surfaced), one **typed-confirmed** kill click, one Verify/Disarmed click,
and one Evidence/doc download; the restore artifact is auto-generated (still Codex-reviewed before run). **The operator
remains the approval gate for every mutation** — the reduction is in *manual read/copy/verify friction*, not in control.

## Implementation slices (overall sequencing)
- **Slice A — read-only harness (LOW risk, the biggest friction win; NO new mutation, NO new persisted table):**
  preflight + deploy/git evidence (§1) + baseline-with-`id` (§2 read) + verifier (§3) + disarmed verifier (§8) +
  client-side evidence / **not-executable** restore / doc generators (§4/§5/§9). Only DB change = extend
  `operator_status()` (add bot `id` + `kill_rpc_present`) + a `VITE_BUILD_COMMIT`. Each: design → Codex CP → impl →
  LOCAL test → flag-gated deploy → verify. **Delivers the success metric on its own.**
- **Slice B — run tracker (OPTIONAL, append-only ops metadata; only if ≥2 mutation types justify it):**
  `operator_runs`/`operator_run_steps` + RPCs (§6). Gated (migration + LOCAL test + testnet validation). **Not a
  prerequisite for Slice A.**
- **Slice C — additional stop-only actions (HIGH risk, ONE at a time, each its own RPC+flag):** `operator_disable_bots`
  then `operator_set_pause`, each the full A8-H2 gated pipeline. **`enable_bots` / arm / fire remain deferred,
  Oren-gated (7c).**
- `operator_kill_all` (7a) is already done + validated — the reference, not a framework.

## Real-funds boundary (explicit)
**The Ops Harness improves TESTNET operator ergonomics only.** It does **NOT** close — and must never be read as
closing — any real-funds gate: **A1** (egress/connectivity), **A4** (credential isolation), **A8-H3 / KP5**
(shared-credential blast-radius), **A11** (written real-funds approval), **A2** (migration reconcile), or the
**live-tier fail-closed** proof, or **mainnet** enablement. It touches no credentials/Vault/queue/worker and adds no
arming path. Real funds stay **NO-GO** regardless of this harness.

## Open decisions for Codex
1. Extend `operator_status()` to include bot `id` (+ `kill_rpc_present`), or add a separate `operator_baseline()` read
   RPC? (Recommend: extend, one round-trip.)
2. **RESOLVED (Rev 2):** baseline/evidence/restore are **client-side download-only** with **no DB audit**; server-side
   persistence exists **only** as the optional run tracker (§6, Slice B) with its own table + append-only RLS.
3. **RESOLVED (Rev 2):** run tracker is **Slice B, optional, deferred** — not a prerequisite; Slice A stamps a
   client-side `run_id` into the exports.
4. Confirm each action keeps its **own default-OFF feature-flag** + typed-confirm + out-of-band Oren approval for
   arm/enable (per-action flag, not a global switch).

## GO / NO-GO
- **This packet:** PLANNING, Rev 2 (Codex CHANGES 1-8 applied) — nothing built/applied. **Returned for Codex
  re-review.** On PASS, start **Slice A** (read-only harness) design → CP.
- **Reduces friction, preserves control:** read/generate/verify are automated → target 2–3 approvals + one export;
  **every mutation stays operator-clicked, typed-confirmed, server-authz'd, and audited**; arm/enable/real-funds stay
  Oren-gated.
- **Real funds = NO-GO** — testnet operator-ergonomics only; does not touch A1/A4/A8-H3/A11/A2/live-fail-closed/mainnet
  (see Real-funds boundary).
