# Ops Harness — Live Read-Only Run Runbook (migration 020 + harness flag)

> **DOC / RUNBOOK — NOT EXECUTION.** Producing this file applies nothing. It sequences the **gated, operator-run**
> activation of the **read-only** Ops Harness on **TESTNET**. **Read-only harness only — NO mutation buttons, NO kill
> call, NO DB data mutation except the schema/function replace from migration `020`.** No mainnet / no real funds.
>
> **Roles:** the **operator executes** the linked apply + the Railway deploy/flag change **and any authenticated
> (operator-JWT) `operator_status` read**; **Claude/Codex do read-only catalog/table read-backs only** (no agent applies
> a linked migration, deploys, or spoofs `auth.uid()`). Run only after explicit Oren approval.
>
> **Rev 2 (2026-07-09): Codex CHANGES 1-8 applied** — §3 runtime shape is an **operator-JWT PostgREST read** (no GUC
> `auth.uid()` spoofing on the linked DB); explicit runtime assertions; §4 ledger is **post-read-back** (skip on
> failure); §7 DOM avoids an exact-button-set requirement (matches the A4 tests); §8 records the resting-state decision
> (A/B) + a safer rollback (keep additive `020` unless a reviewed rollback packet exists); a **kill-flag hard-stop** and
> a **wrong-service guard** added. **Returned for Codex re-review. Doc-only, no execution.**
>
> **⛔ KILL-FLAG HARD STOP (invariant):** if `VITE_OPERATOR_KILL_ENABLED=true` is observed **anywhere** during this run,
> **HARD STOP** — do not continue until the kill flag is OFF and the frontend is redeployed. This run must not arm the
> kill UI.

## Scope & invariants (every step)
- **Testnet only.** `QUEUE_ENABLED` stays OFF; `PRAXIS_IS_PRODUCTION=false`. No mainnet, no real funds, A11 out of scope.
- **Read-only harness only.** `020` adds two non-secret read fields to `operator_status()` (per-bot `id`,
  `kill_rpc_present`). **No trading-state mutation** — the only DB change is the `CREATE OR REPLACE FUNCTION` (a DDL
  replace; changes no rows). The harness UI has **no** mutation buttons and calls **no** mutation RPC.
- **Evidence discipline:** every assertion backed by a raw read-back; empty/filtered output is not evidence; secrets
  never printed.
- **Kill flag stays OFF** throughout (the harness is independent of the kill UI; a live harness must not arm the kill).

---

## 1. Pre-checks (read-only; before any apply)
Operator runs; Claude confirms from output:
- **Git:** `git status --porcelain` empty; `git rev-parse HEAD` == `origin/main`; the A-slice commits present
  (`e5fc390` migration/types, `1633702` buildinfo, `d80c63b` harness, `0629d84` panel).
- **`020` NOT yet linked-applied:** the linked `operator_status()` definition does **not** yet contain the new fields —
  Claude read-back:
  ```sql
  select (pg_get_functiondef('public.operator_status()'::regprocedure) ilike '%kill_rpc_present%') as has_new_field;
  -- expect: false (pre-apply)
  ```
- **Disarmed baseline snapshot (for the "no state change" compare in §3):** Claude read-back —
  ```sql
  select id, trading_pair, status, trading_enabled from public.bots where deleted_at is null order by trading_pair;
  select count(*) filter (where trading_enabled) as enabled, count(*) as total from public.bots where deleted_at is null;
  ```
  Confirm disarmed (all `trading_enabled=false`), record the exact per-bot rows.
- **Frontend harness flag currently OFF / no armed harness deploy:** the deployed console shows **no** `harness-panel`
  (operator DOM check or note the current bundle predates the flag). PITR/backup for testnet confirmed.

## 2. Linked apply of `020` (operator-run, surgical, never `db push`)
Only after §1 + explicit Oren approval. **Operator** runs:
```bash
supabase db query --linked --file supabase/migrations/020_operator_status_add_id.sql
```
- Transaction-wrapped in-file (`begin;…commit;`) → atomic `CREATE OR REPLACE FUNCTION public.operator_status()`.
- **Never `db push`** (010–019 untracked; 020 will likewise be applied-untracked → recorded in §4 after apply).
- Expect clean success. On error → **stop**, capture it, do not retry blindly.

## 3. Read-backs after apply (Claude; shape + grants + NO state change)
Claude runs read-only:
- **(a) Function definition updated** (the two additive fields present):
  ```sql
  select
    (pg_get_functiondef('public.operator_status()'::regprocedure) ilike '%'|| chr(39) ||'id'|| chr(39) ||', b.id%') as has_id_field,
    (pg_get_functiondef('public.operator_status()'::regprocedure) ilike '%kill_rpc_present%') as has_kill_rpc_field;
  -- expect: both true
  ```
- **(b) Grants unchanged** (authenticated EXECUTE; PUBLIC/anon none):
  ```sql
  select a.grantee::regrole::text as grantee, a.privilege_type
  from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'public.operator_status()'::regprocedure;
  -- expect: authenticated=EXECUTE (+ owner postgres); NO grantee 0/PUBLIC, NO anon
  ```
- **(c) Runtime shape — OPERATOR runs a real authenticated read via PostgREST (operator JWT).** `operator_status()` is
  READ-ONLY, so this is a read-back, not a mutation — but it must go through the **real auth path**, not a GUC
  `auth.uid()` simulation. **NOTE: setting `request.jwt.claims` / spoofing `auth.uid()` on the LINKED DB is NOT an
  acceptable substitute here** (Claude does not spoof identity on linked). Instead, the **operator** runs (their own
  JWT; secrets never pasted to Claude):
  ```bash
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/operator_status" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OP_JWT" -H "Content-Type: application/json" -d '{}' \
    | jq '{ kill_rpc_present,
            bot_count: (.bots | length),
            all_ids_nonempty: (.bots | all(.id != null and (.id|tostring|length) > 0)),
            enabled_bots,
            has_secret_key: ([paths|join(".")] | any(test("webhook_secret_hash|token|secret|vault|password|service_role|pepper|credential";"i"))) }'
  ```
  **Assert (from the jq output):** `kill_rpc_present === true` · `bot_count === 5` · `all_ids_nonempty === true` ·
  `enabled_bots === 0` (disarmed) · `has_secret_key === false` (no secret-named keys in the returned JSON).
  *(Alternatively, the operator confirms the same from the deployed console after login once §5–§7 are done — but the
  JWT curl is the direct runtime proof.)*
- **(d) NO trading-state change** (Claude read-back, catalog/table read — no auth needed): re-run the §1 per-bot
  snapshot; assert **identical** (same ids, `status`, `trading_enabled`) — the DDL replace changed **no rows**;
  `enabled_bots` still 0.
- Any deviation (grants widened, secrets present, `kill_rpc_present`≠true, id missing, bot count≠5, bot state changed)
  → **stop** (§8).

## 4. A2 ledger update (ONLY after §2 apply AND §3 read-backs PASS)
**Order is strict: apply (§2) → read-backs prove shape/grants/no-state-change (§3) → THEN update the ledger.** If any
§3 read-back fails, **do NOT update the ledger** (and roll back per §8). Once §3 is green: doc-only, Codex-reviewed,
committed "at Oren request" — add **`020`** to the applied-but-UNTRACKED list in
`docs/production-a2-migration-009-decision-packet.md` (like 010–019): schema-only `CREATE OR REPLACE operator_status`
(+ per-bot `id`, catalog `kill_rpc_present`), applied surgically, never `db push`; reconcile 010–020 before real funds.

## 5. Enable the frontend harness flag (operator, Railway — CORRECT service)
Only after §3 read-backs pass + explicit Oren approval.
- **⚠ WRONG-SERVICE GUARD (do this first):** in Railway, **confirm you are on the `praxis-operator-console-production`
  (frontend) service — NOT `praxis-platform` (the worker)**. Positive check: the service's Variables contain
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` and **do NOT** contain worker-only secrets (`QUEUE_ENABLED`,
  `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_SECRET_ID`). If those worker secrets are present, **you are on the wrong service —
  stop.** (This is the exact mistake from the A8-H2 run.)
- On the confirmed **frontend** service → Variables → **add `VITE_OPERATOR_HARNESS_ENABLED = true`.** (`VITE_*` is
  frontend-only; the worker ignores it.)
- **Confirm `VITE_OPERATOR_KILL_ENABLED` is unset/OFF** on this service (kill stays off; the harness is independent).
  If it is `true`, **KILL-FLAG HARD STOP** (see banner) — turn it off + redeploy before proceeding.
- *(Optional, separate)* `VITE_BUILD_COMMIT` = the deploy commit (so the harness commit-compare isn't "unknown");
  otherwise it reads "unknown" (advisory, non-blocking).

## 6. Redeploy the frontend (operator, Railway — rebuild)
- Because `VITE_*` is **build-time**, the flag takes effect only on a **rebuild** → trigger a frontend redeploy (or it
  auto-redeploys on the var change). Wait for the new deployment to go green.
- Claude read-back (read-only GET): the **deployed bundle hash changed** — `curl -s <console-url> | grep -oE
  '/assets/index-[^"]+\.js'` differs from the pre-flag bundle (proof of a real rebuild).

## 7. Browser DOM verification (operator; harness present + read-only)
Operator loads the console (hard-refresh / incognito), signs in as operator, DevTools. **Mirrors the A4 accepted
tests** — assert the essentials, not an exact button set (disabled/variant controls are fine):
```js
document.querySelector('[data-testid="harness-panel"]') !== null      // expect: true  (harness rendered)
document.querySelector('[data-testid="kill-button"]')                  // expect: null  (kill UI still OFF)
document.querySelector('[data-testid="h-kill-flag"]')?.textContent     // expect: contains "kill UI flag: OFF"
// NO EXACT forbidden mutation label (substring like "restore" in "Generate restore draft" is allowed):
const labels = [...document.querySelectorAll('[data-testid="harness-panel"] button')].map(b => b.textContent.trim())
labels.some(l => /^(Restore|Run|Apply|Execute|Kill)$/i.test(l))       // expect: false
// enough allowed read/generate/download controls to prove functionality:
['Refresh read-back','Capture baseline','Generate restore draft','Download evidence'].every(x => labels.includes(x))
//   expect: true
```
- Click **Capture baseline** → baseline info shows the bot count and (in the downloaded JSON) per-bot **`id`** — proves
  `020`'s `id` is live end-to-end.
- Click **Generate restore draft** → the rendered draft is **visibly NON-EXECUTABLE**: it carries the
  **`NOT EXECUTABLE — TEMPLATE ONLY`** + **`REQUIRES SEPARATE CODEX REVIEW BEFORE EXECUTION`** header and every line is
  commented. **Do NOT run it.**
- Confirm **no kill fired, no mutation** — the harness has no mutation button, and `kill-button` is null.

## 8. Final resting state (EXPLICIT decision) + rollback
- **Resting-state decision (record the choice in the run log + Kanban):** because the harness is **read-only**, the
  default may be ON. Choose one and record it:
  - **A) leave `VITE_OPERATOR_HARNESS_ENABLED=true` ON** (harness live, read-only) — default; **or**
  - **B) turn it OFF + redeploy** (harness removed after verification).
  **In BOTH cases the kill flag `VITE_OPERATOR_KILL_ENABLED` MUST remain OFF.** Record: "harness = A(ON)/B(OFF); kill =
  OFF" in the run log and the Ops Harness Kanban card.
- **Rollback — frontend (operator, ordinary/safe default):** unset `VITE_OPERATOR_HARNESS_ENABLED` + **redeploy** → the
  harness panel disappears (console returns to read-only status only). **No DB change involved.**
- **Rollback — DB (default = KEEP `020`):** `020` is **additive / read-surface only** (two extra read fields, no data
  touched) → **keep it**; the harness simply goes inert when the flag is off. **Do NOT re-apply the prior 016 body ad
  hoc.** A DB-level function rollback is done **only** if there is a **concrete, reviewed `CREATE OR REPLACE` rollback
  packet** (the exact prior body, Codex-reviewed) — not improvised.
- **Stop / NO-GO triggers (any → stop + roll back per above):**
  - **⛔ `VITE_OPERATOR_KILL_ENABLED=true` observed anywhere → HARD STOP** — do not continue until the kill flag is OFF
    and the frontend is redeployed.
  - §2 apply error; §3 grants widened / secret-named keys present / `kill_rpc_present`≠true / bot `id` missing / bot
    count ≠ 5 / bot-state changed; §5 wrong service (worker secrets present); §6 bundle unchanged (no rebuild); §7 an
    exact mutation-action button (Restore/Run/Apply/Execute/Kill) present or `kill-button` rendered; any sign of real
    funds / mainnet / `QUEUE_ENABLED=true`.

## GO / NO-GO
- **This runbook:** DOC, Rev 2 (Codex CHANGES 1-8 applied) — nothing applied/deployed. **Returned for Codex re-review.**
  After PASS + Oren approval: operator runs §2 apply + §3(c) operator-JWT read + §5/§6 Railway + §7 browser; Claude does
  the §1/§3(a,b,d)/§6-bundle read-backs; **§4 ledger only after §3 passes**; **§8 records the resting-state decision
  (A/B, kill=OFF)** and governs rollback.
- **On a clean run:** the **read-only** Ops Harness is live on testnet (operator-only, no mutation surface). **Slice B**
  (optional run tracker) and **Slice C** (stop-only mutation actions) remain future, each separately gated.
- **Real funds = NO-GO** — this run is testnet operator-ergonomics only; it closes **no** real-funds gate
  (A1/A4/A8-H3/A11/A2/live-fail-closed/mainnet unchanged).

---

## RUN — RESULTS: live read-only harness = COMPLETE / GREEN (2026-07-09)
_updated by Codex at Oren request._ Operator-run mutations; Claude read-only read-backs; operator-JWT PostgREST read
for runtime shape. Testnet only; kill flag OFF throughout; no data mutation except the `020` DDL; no mainnet/real funds.

**Checkpoints (all PASS):** P0 → Action A (`020` linked apply) → **CHECKPOINT A** → Action B (frontend flag) → Action C
(Railway **auto-deploy** rebuild — accepted as Action C) → **CHECKPOINT B** → Step 7 browser DOM → **CHECKPOINT D**.

| Field | Result |
|---|---|
| verdict | **PASS** |
| what changed | `operator_status()` def (+ per-bot `id`, + `kill_rpc_present`, via `020`); `VITE_OPERATOR_HARNESS_ENABLED=true` on the frontend service; frontend bundle rebuilt |
| what did NOT change | bot rows (5, per-bot `id`/`status`/`trading_enabled` identical to P0 baseline); grants (authenticated EXECUTE, no anon/PUBLIC); `QUEUE_ENABLED`; worker; credentials; queue; kill flag |
| disarmed | `enabled_bots=0` · `queue_enabled=false` · `queue_length=0` · `is_production=false` · `worker=disabled` |
| flags | **`VITE_OPERATOR_HARNESS_ENABLED=ON`** · **`VITE_OPERATOR_KILL_ENABLED=OFF`** |
| bundle hash | pre `/assets/index-gxqK14Ca.js` → post `/assets/index-CokGqn1e.js` (**changed**) |
| operator_status shape (operator-JWT) | `kill_rpc_present=true` · `bot_count=5` · `all_ids_nonempty=5/5` · no secrets* |
| DOM | `harness-panel` present · `kill-button`=null · `h-kill-flag`="kill UI flag: OFF" · no exact Restore/Run/Apply/Execute/Kill label · allowed controls present · baseline=5 bots · restore draft NON-EXECUTABLE (both watermarks + all lines commented; carries a real bot `id`) — **not run** |
| resting decision | **A) harness ON** (read-only) · **kill OFF** |
| real funds | **NO-GO** — closes no gate (A1/A4/A8-H3/A11/A2/live-fail-closed/mainnet unchanged) |

*\* The runtime secret-name scan reported 10 name-matches — verified benign: exactly the **non-secret**
`credential_status` + `credential_ok` fields (5 bots × 2), matched by the over-broad `credential` substring. The
`operator_status` payload carries **no** secret. **Non-blocking cleanup:** tighten the secret-name pattern (here and in
the harness `generateEvidence` redaction, which likewise over-redacts `credential_*`) to exact secret keys later.*

**Net:** the **read-only** Ops Harness is **live on testnet** (operator-only; no mutation surface, no kill path). `020`
is applied-linked/untracked → recorded in `production-a2-migration-009-decision-packet.md`. Slice B (run tracker) /
Slice C (stop-only mutations) remain future, each separately gated.
