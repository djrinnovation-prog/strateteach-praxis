# Ops Harness — Live Read-Only Run: Single-Run Execution Packet

> **DOC / PACKET — NOT EXECUTION.** Producing this applies nothing. It is a **single-pass** operator task that activates
> the **read-only** Ops Harness on **TESTNET** and returns **one evidence packet** (§5). Read-only checks are **batched**;
> the three mutations (A/B/C) each have an **explicit checkpoint**. Companion to the runbook
> `docs/production-ops-harness-live-readonly-run-runbook.md` (commit `97d53e7`).
>
> **Roles:** **operator executes** Action A (linked apply), Action B/C (Railway), and the operator-JWT `operator_status`
> read; **Claude/Codex do read-only catalog/table read-backs + the bundle-hash GET only** (no agent applies a linked
> migration, deploys, or spoofs `auth.uid()`).
>
> **Invariants:** testnet only · read-only harness (no mutation buttons, no kill call) · no DB *data* mutation except the
> `020` `CREATE OR REPLACE` (DDL) · kill flag stays OFF · no mainnet/real funds.
> **⛔ HARD STOP:** `VITE_OPERATOR_KILL_ENABLED=true` observed **anywhere** → stop until it is OFF + redeployed.

---

## 1. Pre-checks (batched, read-only) — CHECKPOINT P0
**Claude (local + linked read-only):**
- Git: `git status --porcelain` empty; `HEAD == origin/main`; A-slice commits present (`e5fc390 1633702 d80c63b 0629d84`)
  + runbook `97d53e7`.
- Linked catalog/table read-back #1 (booleans):
  ```sql
  select
    (pg_get_functiondef('public.operator_status()'::regprocedure) ilike '%kill_rpc_present%') as f020_applied, -- expect false
    (select count(*) from public.bots where deleted_at is null) as total_bots,                                  -- expect 5
    (select count(*) from public.bots where trading_enabled and deleted_at is null) as enabled_bots,            -- expect 0
    (select queue_enabled from public.worker_status limit 1) as queue_enabled,                                  -- expect false
    (select is_production from public.worker_status limit 1) as is_production;                                   -- expect false
  ```
- Linked read-back #2 (baseline snapshot — the "did-not-change" target):
  ```sql
  select id, trading_pair, status, trading_enabled from public.bots where deleted_at is null order by trading_pair;
  ```
- Bundle hash (pre): `curl -s <console-url> | grep -oE '/assets/index-[^"]+\.js'` → record `bundle_pre`.

**Operator:** confirm the deployed console currently shows **no** `harness-panel` (harness flag OFF); PITR/backup ok.

**CHECKPOINT P0:** `f020_applied=false`, disarmed (enabled_bots=0, queue_enabled=false, is_production=false), 5 bots,
harness OFF. All green → proceed. Any deviation → stop.

---

## 2. Mutations (operator-run) — each its own checkpoint

### ACTION A — linked apply of `020` (operator) → CHECKPOINT A
```bash
supabase db query --linked --file supabase/migrations/020_operator_status_add_id.sql
```
Transaction-wrapped `CREATE OR REPLACE operator_status()`; **never `db push`**. Expect clean success.

**Read-back A (batched):**
- Claude (linked catalog): definition + grants + no-state-change —
  ```sql
  select
    (pg_get_functiondef('public.operator_status()'::regprocedure) ilike '%kill_rpc_present%') as has_kill_rpc_field, -- true
    (pg_get_functiondef('public.operator_status()'::regprocedure) ilike '%, b.id%')           as has_id_field,       -- true
    (select bool_or(a.grantee='anon'::regrole or a.grantee=0) from pg_proc p, aclexplode(p.proacl) a
       where p.oid='public.operator_status()'::regprocedure and a.privilege_type='EXECUTE') as anon_or_public_exec; -- false
  ```
  then re-run the §1 read-back #2 snapshot → assert **identical** (same ids/status/trading_enabled), enabled_bots still 0.
- Operator (real auth path — operator JWT PostgREST read; **not** a GUC spoof):
  ```bash
  curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/operator_status" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $OP_JWT" -H "Content-Type: application/json" -d '{}' \
    | jq '{ kill_rpc_present, bot_count:(.bots|length),
            all_ids_nonempty:(.bots|all(.id!=null and (.id|tostring|length)>0)), enabled_bots,
            has_secret_key: ([paths|join(".")]|any(test("webhook_secret_hash|token|secret|vault|password|service_role|pepper|credential";"i"))) }'
  ```
  Expect `kill_rpc_present=true`, `bot_count=5`, `all_ids_nonempty=true`, `enabled_bots=0`, `has_secret_key=false`.

**CHECKPOINT A:** has_id_field ∧ has_kill_rpc_field ∧ anon_or_public_exec=false ∧ snapshot identical ∧ (operator jq:
kill_rpc_present=true, bot_count=5, ids non-empty, enabled_bots=0, no secret keys). All green → A2 ledger update queued
for §8 (post-read-back). **Any fail → STOP; do NOT update the ledger; do NOT proceed to B** (roll back per §7).

### ACTION B — Railway frontend flag change (operator) → CHECKPOINT B
- **Wrong-service guard:** confirm the **`praxis-operator-console-production` (frontend)** service — it has
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` and **NOT** `QUEUE_ENABLED`/`SUPABASE_SERVICE_ROLE_KEY`/`VAULT_SECRET_ID`.
  If those worker secrets are present → **wrong service, STOP.**
- **Kill-flag check:** `VITE_OPERATOR_KILL_ENABLED` is unset/≠`true` on this service. If `true` → **HARD STOP**.
- **Set the flag DIRECTLY in Railway Variables:** `VITE_OPERATOR_HARNESS_ENABLED = true`. **Do NOT use Doppler/stage
  unless this frontend service is actually Doppler-synced** (operator confirms; if synced, set it in that config
  instead). **Prefer direct Railway Variables.**
- *(Optional)* `VITE_BUILD_COMMIT` = deploy commit (else the harness commit-compare reads "unknown", advisory).

**CHECKPOINT B:** flag set on the confirmed frontend service; kill flag OFF; no worker-service change. → proceed to C.

### ACTION C — Railway frontend redeploy (operator) → CHECKPOINT C
- Trigger a **rebuild/redeploy** of the frontend service (VITE is build-time). Wait for the deployment to go green.
- **Read-back C (Claude, read-only GET):** `bundle_post = curl -s <console-url> | grep -oE '/assets/index-[^"]+\.js'`
  → assert `bundle_post != bundle_pre` (proof of a real rebuild).

**CHECKPOINT C:** bundle hash changed. → proceed to DOM.

---

## 3. Browser DOM checks (operator) — CHECKPOINT D
Hard-refresh / incognito, sign in as operator, DevTools (mirrors the A4 accepted tests):
```js
document.querySelector('[data-testid="harness-panel"]') !== null           // expect true
document.querySelector('[data-testid="kill-button"]')                       // expect null
document.querySelector('[data-testid="h-kill-flag"]')?.textContent          // expect contains "kill UI flag: OFF"
const L=[...document.querySelectorAll('[data-testid="harness-panel"] button')].map(b=>b.textContent.trim())
L.some(x=>/^(Restore|Run|Apply|Execute|Kill)$/i.test(x))                    // expect false (no EXACT action label)
['Refresh read-back','Capture baseline','Generate restore draft','Download evidence'].every(x=>L.includes(x)) // expect true
```
- **Capture baseline** → baseline shows the bot count; the downloaded JSON has per-bot **`id`** (proves `020` end-to-end).
- **Generate restore draft** → carries `NOT EXECUTABLE — TEMPLATE ONLY` + `REQUIRES SEPARATE CODEX REVIEW BEFORE
  EXECUTION`, every line commented. **Do NOT run it.**
- No kill fired; no mutation.

**CHECKPOINT D:** harness present, kill-button null, kill flag OFF, no exact action label, allowed controls present,
baseline has ids, restore draft non-executable. → assemble the evidence packet (§5).

---

## 4. Read-back batching note
Steps §1, Read-back A (Claude catalog/snapshot), and Read-back C are **batched read-only** and can run back-to-back. The
**operator-JWT `operator_status` read** and all **mutations** (A/B/C) are the only steps requiring an operator action +
an explicit checkpoint before continuing.

## 5. Final evidence packet (fill + return — one result)
```
A8-OPS-HARNESS LIVE READ-ONLY RUN — <date>
verdict:            PASS | FAIL | ATTENTION
what_changed:       operator_status() definition (added id + kill_rpc_present); frontend flag
                    VITE_OPERATOR_HARNESS_ENABLED=true; frontend bundle rebuilt
what_did_not_change: bot rows (per-bot id/status/trading_enabled identical to baseline); grants
                    (authenticated EXECUTE, no anon/PUBLIC); QUEUE_ENABLED; worker; credentials; queue; kill flag
disarmed_state:     enabled_bots=<n> queue_enabled=<b> queue_length=<n> is_production=<b> worker_state=<s>   (expect 0/false/0/false/disabled)
flags:              VITE_OPERATOR_HARNESS_ENABLED=<on/off>  VITE_OPERATOR_KILL_ENABLED=<MUST be off>
bundle_hash:        pre=<index-....js>  post=<index-....js>  changed=<yes/no>
operator_status_shape: kill_rpc_present=<true>  bot_count=<5>  all_ids_nonempty=<true>  no_secret_keys=<true>
mutation_buttons:   none in harness panel; kill-button=null; no exact Restore/Run/Apply/Execute/Kill label
secrets:            no secret-named keys in operator_status JSON; restore draft/evidence carry no secrets
resting_decision:   harness = A(ON) | B(OFF)   ;   kill = OFF
recommendation:     <e.g. "read-only harness live on testnet; A8-H2 unaffected; real funds remain NO-GO">
```

## 6. Stop conditions (any → STOP + roll back per §7)
- **⛔ `VITE_OPERATOR_KILL_ENABLED=true` anywhere → HARD STOP** (kill UI must not be armed).
- P0: `020` already applied / not disarmed / bot_count≠5.
- Action A: apply error; grants widened (anon/PUBLIC EXECUTE); `has_secret_key=true`; `kill_rpc_present≠true`; any
  `id` empty; bot_count≠5; bot snapshot changed.
- Action B: wrong service (worker secrets present).
- Action C: bundle hash unchanged (no rebuild).
- DOM: an exact mutation-action button present, or `kill-button` rendered.
- Any sign of real funds / mainnet / `QUEUE_ENABLED=true`.

## 7. Rollback / default resting-state decision
- **Resting decision (record in §5 + Kanban):** **A) harness ON** (read-only; default) **or B) OFF + redeploy.** **Kill
  flag OFF in both.**
- **Rollback — frontend (ordinary/safe default):** unset `VITE_OPERATOR_HARNESS_ENABLED` (same place it was set) +
  **redeploy** → harness gone; no DB change.
- **Rollback — DB (default = KEEP `020`):** `020` is additive/read-surface only → **keep it**; harness is inert when the
  flag is off. A function rollback is done **only** via a **concrete, reviewed `CREATE OR REPLACE` rollback packet** — not
  improvised.

## 8. Documentation plan (after the run; doc-only, Codex-reviewed, "at Oren request")
Only if Action A applied `020` AND Read-back A passed:
1. Append a **RUN — RESULTS** section (the §5 packet) to `production-ops-harness-live-readonly-run-runbook.md`.
2. Add **`020`** to the A2 ledger (`production-a2-migration-009-decision-packet.md`) as applied-untracked (schema-only
   `CREATE OR REPLACE operator_status` + id + catalog `kill_rpc_present`), never `db push`; reconcile 010–020 before
   real funds.
3. Update memory + the Ops Harness Kanban card with the verdict + resting decision (harness A/B, kill OFF).
If Read-back A failed → document the stop + rollback instead; **do not** touch the A2 ledger.

## GO / NO-GO
- **This packet:** DOC — nothing applied/deployed. **Return for Codex review.** After PASS + explicit Oren approval, the
  operator runs A/B/C with the checkpoints; Claude batches the read-backs; §5 is the single returned result.
- **Real funds = NO-GO** — testnet read-only ergonomics only; closes no gate (A1/A4/A8-H3/A11/A2/live-fail-closed/
  mainnet unchanged).
