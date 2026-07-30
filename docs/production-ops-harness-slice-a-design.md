# Ops Harness — Slice A: Read-Only Harness (Design)

> **DOC / DESIGN ONLY — NO CODE.** No DB mutation · no deploy · no new mutation buttons · no flag change · no kill call
> · no mainnet/real funds. Design for the **read-surface** slice of the Ops Harness plan
> (`production-operator-console-ops-harness-plan.md`, Slice A). Grounded in the real console (`frontend/src`),
> `operator_status()` (migration 016), and the A8-H2 run. Runtime behavior is read-only (one operator-gated read RPC +
> client-side downloads); the **one DB change is a schema-only, read-surface extension** of `operator_status()`
> (a `CREATE OR REPLACE` = a DDL mutation, gated + approval-required — see §1).
>
> **Rev 2 (2026-07-09): Codex CHANGES 1-8 applied** — migration `020` called a schema/read-surface DDL (not "read-only
> touch"); `kill_rpc_present` = catalog boolean, coupling documented; `VITE_BUILD_COMMIT` made optional with fallback;
> `.env.example` (gitignored) removed from tracked edits; restore generator emits a TEMPLATE only (filled packet still
> needs review); HarnessPanel labels are no-mutation ("Generate draft"/"Copy evidence"/"Refresh read-back"); Railway
> checklist = operator-attested vs bundle-hash self-verified; A2 ledger updated ONLY after the linked `020` apply.
> **Returned for Codex re-review.**

## 0. Principles (carried from the plan)
- **Browser holds no privilege.** One read RPC (`operator_status`, operator-gated `42501`); no other server call.
- **No mutation, no new buttons.** Slice A adds read panels + client-side downloads only.
- **Feature-gated, default OFF.** The whole harness panel renders only behind a **new** `VITE_OPERATOR_HARNESS_ENABLED`
  flag (default OFF) — mirrors the kill-flag pattern; ships inert until validated.
- **No secrets in any artifact** (status fields + non-secret bot `id` only).
- **Reuse visuals, rebuild logic in React** against the real RPC (no standalone-UI JS copied).

---

## 1. Schema / read-surface extension (the one DB change — a gated DDL, not "read-only")
**Extend `operator_status()` — migration `020` (`CREATE OR REPLACE FUNCTION`).** This is a **schema-only DDL mutation**
(it replaces the function definition) even though the function itself only *reads*. It therefore needs the **same gating
as any migration**: explicit Oren approval, surgical linked apply (`db query --linked --file`, **never `db push`**), and
an **A2-ledger update only AFTER the apply** (§9). Recommended over a new RPC (one round-trip). Adds:
- **per-bot `id`** — `'id', b.id` in the `bots` jsonb array (needed for baseline/restore; `id` is a non-secret UUID).
- top-level **`kill_rpc_present`** (see below).

**`kill_rpc_present` — exact method:** a **catalog check only** —
`(select exists (select 1 from pg_proc where proname = 'operator_kill_all'))` → **boolean**. It **does not execute** the
RPC (no side effect), reads only `pg_catalog`. **Coupling note:** this ties the status payload to A8-H2's existence; it
is **testnet ops-metadata only** (not a security control, not real-funds-relevant). If Codex prefers to decouple, drop
it from `020` and have the preflight infer "kill RPC present" from a separate one-off catalog read; recommendation is to
include it (cheap, single round-trip) and label it ops-metadata.

**File:** `supabase/migrations/020_operator_status_add_id.sql` — `begin; CREATE OR REPLACE FUNCTION
public.operator_status() … (adds the two fields) …; commit;`. Owner `postgres`; **grant unchanged** (`authenticated`);
SECURITY DEFINER + `search_path=''` (as 016). **No new mutation surface at runtime** — still a read function; the DDL
apply is the gated step.

**Exact data `operator_status()` returns after 020** (unchanged fields + the two additions):
```
{
  bots: [ { id, trading_pair, bot_status, trading_enabled, sizing_mode, exchange_environment,
            credential_status, credential_ok, config_ready, execution_ready } , … ],
  enabled_bots, open_trades, dlq, open_recon, queue_length,
  worker_status: { queue_enabled, is_production, worker_state, boot_stuck_count, updated_at } | null,
  kill_rpc_present: boolean
}
```

## 2. Frontend files (exact — all read-only)
| File | New/Edit | Purpose |
|---|---|---|
| `frontend/src/lib/status.ts` | **edit** | add `id: string` to `BotStatus`; add `kill_rpc_present: boolean` to `OperatorStatus` |
| `frontend/src/lib/buildinfo.ts` | **new** | read `VITE_OPERATOR_KILL_ENABLED`, `VITE_OPERATOR_HARNESS_ENABLED`, **optional** `VITE_BUILD_COMMIT`; `fetchDeployedBundleHash()` (self-read of served `index.html`) |
| `frontend/src/lib/harness.ts` | **new** | pure functions: `buildPreflight`, `captureBaseline`, `verifyAgainst`, `verifyDisarmed`, `generateEvidence`, `generateRestoreDraft` (no I/O, no secrets) |
| `frontend/src/components/HarnessPanel.tsx` | **new** | renders preflight + verifier/disarmed read-backs + **draft/evidence download** controls (no action-named buttons — §3); behind the harness flag |
| `frontend/src/App.tsx` | **edit** | wire `<HarnessPanel>` only when `harnessEnabled` (new default-OFF flag); pass `loadStatus` + buildinfo |
| `frontend/src/vite-env.d.ts` | **edit** | type `VITE_OPERATOR_HARNESS_ENABLED?`, `VITE_BUILD_COMMIT?` (both optional). **This tracked file is where the flags are documented** — NOT `.env.example` (gitignored, not tracked). |
| `frontend/vite.config.ts` or build env | **edit (optional)** | if used, map `VITE_BUILD_COMMIT` from Railway's build-time `RAILWAY_GIT_COMMIT_SHA` (see §3-7). Not required for PASS — fallback is operator-provided `expected_commit`. |
| tests (below) | **new** | `harness.test.ts`, `buildinfo.test.ts`, `HarnessPanel.test.tsx`, `status.test.ts` additions |

*(Env flags are documented in the tracked `vite-env.d.ts` + this design doc; `.env.example` is gitignored and is NOT
edited/force-tracked.)*

## 3. Feature designs (data returned, per feature)
> **HarnessPanel is explicitly NO-MUTATION.** No control is named like an action. Allowed control labels: **"Refresh
> read-back"** (re-calls `operator_status()` — a **status read only**, no write), **"Capture baseline"** (client
> download), **"Generate restore draft"** (client download, §6), **"Copy evidence" / "Download evidence"** (client
> download), **"Verify"** / **"Check disarmed"** (read + compare). **Forbidden labels:** "Restore", "Run", "Apply",
> "Execute", "Kill" (kill stays in its own flagged panel). No button in HarnessPanel calls any mutation RPC — a test
> asserts this (§4).

### 1) Read-only preflight panel
- **Reads:** `operator_status()` (§1) + `buildinfo` (client-side).
- **Returns** `PreflightResult`:
  ```
  { db: { enabled_bots, open_trades, dlq, open_recon, queue_length, worker_state, queue_enabled,
          is_production, kill_rpc_present },
    deploy: { deployed_bundle_hash, expected_commit, built_commit, flag_kill_enabled, flag_harness_enabled },
    checklist: [ { item, status: 'ok'|'attention'|'unknown', note } ],   // incl. "flag on frontend svc not worker"
    verdict: 'PASS' | 'ATTENTION' }
  ```
- **Verdict logic:** PASS iff `enabled_bots=0` AND `queue_length=0` AND `open_trades=0` AND `dlq=0` AND
  `queue_enabled=false` AND `is_production=false` AND `worker_state` known AND `kill_rpc_present` as-expected. The
  **commit compare is advisory** — if `built_commit` and `expected_commit` are both present and differ → ATTENTION; if
  `built_commit` is not injected → shown "unknown", **does not block PASS** (git compare stays manual). Unknowns render
  "unknown", never "pass".

### 2) Baseline capture / export
- **Reads:** `operator_status().bots` (with `id`).
- **Returns / downloads** `baseline-<run_id>.json`:
  ```
  { run_id, captured_at, enabled_bots,
    bots: [ { id, trading_pair, status, trading_enabled } , … ] }
  ```
- Client-side download only. `run_id` = client-generated (`OPS-<iso>-<rand4>`). **No DB write, no audit.**

### 3) Post-action verifier
- **Reads:** current `operator_status()` + a caller-supplied `expected` object (e.g. after a kill: all target bots
  paused, `enabled_bots=0`, `open_trades`/`queue_length` acknowledged).
- **Returns** `VerifyResult`: `{ diffs: [ { field, expected, actual, match } ], open_trades, queue_length,
  verdict: 'PASS'|'ATTENTION'|'FAIL' }`. FAIL on a core mismatch (e.g. `enabled_bots≠0`); ATTENTION on residual
  (`open_trades>0`/`queue_length>0`); never auto-remediates.

### 4) Final disarmed verifier
- **Reads:** `operator_status()`.
- **Returns** `DisarmedResult`: `{ enabled_bots, queue_enabled, queue_length, worker_state, all_at_rest: bool,
  verdict: 'GREEN'|'NOT_DISARMED' }`. GREEN iff `enabled_bots=0 AND queue_enabled=false AND queue_length=0` and bots at
  the intended resting state.

### 5) Evidence summary generator
- **Reads:** the accumulated client-side run state (preflight + baseline + action response + verify + disarmed).
- **Returns / downloads** `evidence-<run_id>.json` + `.md` — the step table we hand-write today (ids, counts, verdicts,
  the audit_id from the action response). **Status fields only, no secrets.** No DB write.

### 6) Restore DRAFT generator (`generateRestoreDraft` — TEMPLATE, never a run-ready packet)
- **Reads:** baseline (§2) + current `operator_status()`.
- **Control label:** **"Generate restore draft"** (a download; never "Restore"/"Run").
- **Returns / downloads** `restore-DRAFT-<run_id>.txt` containing three clearly-separated parts:
  1. **baseline JSON** (per-bot `id`, baseline `status`/`trading_enabled`),
  2. a **diff table** (per-bot `id`, `status` current→baseline, `trading_enabled` current→baseline),
  3. a restore-SQL **TEMPLATE** — watermarked `-- NOT EXECUTABLE — TEMPLATE ONLY. The FILLED executable restore packet
     MUST be produced + Codex-reviewed separately before any run.` The template shows the Codex-PASS'd shape (id-keyed,
     tx-wrapped, only `status`/`trading_enabled`, exactly-N row guard + post-restore verification + raise/rollback), but
     is **explicitly a draft** — not the pipe-ready packet.
- **Hard rules:** **no auto-execute path, no `psql`/DSN/connection string, no secrets, no copy-and-run affordance.** The
  actual **filled executable restore packet still requires a separate Codex review** (as done 2026-07-09) and operator
  run — the draft only removes hand-templating, never the review→execute gate.

### 7) Frontend deployed-build evidence  (distinguish self-verified vs operator-attested)
- **`deployed_bundle_hash` — VERIFIED by the browser (self-read):** `fetchDeployedBundleHash()` GETs the served `/`
  (`index.html`) and extracts `/assets/index-<hash>.js`. This is real, self-verified evidence (the check we do by hand
  today).
- **`built_commit` — OPTIONAL, only if injected:** `import.meta.env.VITE_BUILD_COMMIT`. **How Railway would inject
  it:** Railway exposes `RAILWAY_GIT_COMMIT_SHA` at build; the frontend service's build maps `VITE_BUILD_COMMIT` from
  it (build env or a `vite define`). **If not configured, `built_commit` is `undefined`** — the panel shows "build
  commit: unknown (not injected)". **NOT required for PASS.**
- **`expected_commit` — operator-provided:** an input field (the operator's known `origin/main` SHA). The panel shows
  the compare **only when both are present**; otherwise **git commit comparison stays MANUAL** until CI/deploy metadata
  exists. Never renders "commit match: pass" on an unknown.
- **`flag_kill_enabled`, `flag_harness_enabled`** — from `import.meta.env` (self-known).
- **Railway service checklist — OPERATOR-ATTESTED, not verified truth:** static rendered items (flag set on
  `praxis-operator-console-production` frontend, NOT `praxis-platform` worker; frontend-vs-worker confirmed) with
  operator check-off. **No Railway API is called**, so these are **operator attestations** captured as evidence, clearly
  labeled "attested" (not "verified"). Likewise **Railway variables are operator-attested** unless/until deploy metadata
  surfaces them.
- Feeds the preflight panel (§3-1), which marks each field **verified** (bundle hash) vs **attested** (checklist,
  expected_commit) vs **unknown** (built_commit if not injected).

## 4. Tests (Vitest — all pure/deterministic, no network)
- **`status.test.ts` (add):** `BotStatus` includes `id`; `OperatorStatus` includes `kill_rpc_present` (shape).
- **`harness.test.ts` (new):** preflight verdict PASS vs ATTENTION (disarmed vs armed); commit-compare advisory (unknown
  `built_commit` does NOT block PASS); baseline capture shape (ids present); `verifyAgainst` → PASS on match, FAIL on
  `enabled_bots≠0`, ATTENTION on `open_trades>0`; `verifyDisarmed` GREEN/NOT_DISARMED; `generateEvidence` has the
  expected fields and **no secret substrings**; **`generateRestoreDraft`** contains the **NOT-EXECUTABLE TEMPLATE
  watermark**, the baseline JSON + id-keyed diff, and **no `psql`/DSN/auto-run/copy-run** affordance.
- **`buildinfo.test.ts` (new):** `fetchDeployedBundleHash` parses `/assets/index-<hash>.js` from a mocked `index.html`;
  flag reads reflect `import.meta.env`; `built_commit` undefined when `VITE_BUILD_COMMIT` unset.
- **`HarnessPanel.test.tsx` (new):** renders preflight (with **verified/attested/unknown** labels) + the
  read-back/download controls; **asserts NO mutation RPC is callable** — every control is a read (`operator_status`) or
  a client-side download; **no control labeled Restore/Run/Apply/Execute/Kill**; harness flag OFF → panel **not
  rendered**.
- **Commands:** `cd frontend && npm run typecheck && npm test` (+ `npm run build`). Migration `020` validated on a LOCAL
  DB (like the 019 fixture) at implementation.

## 5. Safety boundaries
- **Read-only:** the only server call is `operator_status()`; no mutation RPC, no writes, no audit rows. Downloads are
  client-side.
- **No secrets** in any panel or artifact (status fields + non-secret bot `id`); evidence/restore generators assert
  no-secret in tests.
- **Default-OFF harness flag** — the panel is absent unless `VITE_OPERATOR_HARNESS_ENABLED=true` (deploy inert first,
  like the kill flag).
- **Restore draft is a NON-EXECUTABLE TEMPLATE** (watermark, `.txt`, no run affordance); the filled executable packet
  still needs a separate Codex review.
- **Evidence is labeled by trust level** — bundle hash = **self-verified**; Railway service checklist + `expected_commit`
  = **operator-attested**; un-injected `built_commit` = **unknown**. Never renders attested/unknown as "verified/pass".
- **No new mutation buttons** — kill (7a) stays as-is behind its own flag; 7b/7c not in Slice A.

## 6. What remains manual (operator)
- **git clean/sync** — browser can't read git; preflight shows `expected_commit` for the operator to compare to
  `origin/main`.
- **Railway dashboard truth** — the service checklist is guided; the operator confirms the flag is on the frontend
  service, deploys, and reads the dashboard.
- **Restore execution** — operator-run reviewed packet (the artifact is generate-only).
- **Any deploy / flag change / migration apply** — operator (Railway / surgical `db query --linked`).

## 7. Out of scope (Slice A)
- Run-tracker persistence / ops tables (Slice B, optional).
- Any mutation button — `disable_bots`/`set_pause` (7b, Slice C), `enable`/arm/fire (7c, deferred).
- Railway API integration (checklist only).
- credentials/Vault/queue-purge/worker controls.

## 8. How this reduces manual steps
| Today (manual) | Slice A |
|---|---|
| ~6–8 DB SELECTs for preflight + 1 curl for bundle hash + commit compare | **1 Preflight click** |
| SELECT + copy per-bot baseline | **1 Baseline download** |
| hand-interpret post-kill read-back | **1 Verify click** (PASS/ATTENTION/FAIL) |
| hand-interpret disarmed state | **1 Disarmed click** (GREEN/NOT_DISARMED) |
| hand-template restore SQL + hand-write evidence/doc | **"Generate restore draft" (template) + evidence/doc downloads** |
Net: the ~10–15 copy/paste steps → **~2–3 approvals + one evidence export** (the plan's success metric). **Every
mutation still stays operator-clicked + typed-confirmed** — Slice A adds no mutation, only removes read/copy friction.

## 9. Implementation sub-slices (each: design→CP→impl→LOCAL test→gated apply/deploy→verify)
- **A1** migration `020` (operator_status + `id` + `kill_rpc_present`) authored + `status.ts` types + LOCAL test. The
  **linked apply of `020` is a separate gated step** (explicit Oren approval, surgical, never `db push`). **The A2
  migration ledger is updated ONLY AFTER the linked apply actually happens** — not at design or commit time.
- **A2** `buildinfo.ts` (bundle-hash self-read + flags + optional `VITE_BUILD_COMMIT`) + tests. (Railway
  `VITE_BUILD_COMMIT` wiring optional — fallback per §3-7.)
- **A3** `harness.ts` pure generators (preflight/baseline/verify/disarmed/evidence/**restore-draft**) + tests.
- **A4** `HarnessPanel.tsx` + `App` wiring behind `VITE_OPERATOR_HARNESS_ENABLED` (default OFF) + tests.

## GO / NO-GO
- **This packet:** DESIGN, Rev 2 — nothing built/applied. **Returned for Codex re-review.** On PASS → implement A1→A4,
  each Codex-reviewed; migration `020` applied surgically **only at a gated linked step with Oren approval**, and the
  **A2 ledger is updated only after that apply**.
- **Runtime read-only, testnet ergonomics only** — the one DB change is a gated schema DDL; adds no mutation, no arm
  path; **real funds unaffected / NO-GO** (A1/A4/A8-H3/A11/A2/live-fail-closed/mainnet unchanged).