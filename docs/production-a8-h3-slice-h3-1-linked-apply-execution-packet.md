# A8-H3 Slice H3-1 — LINKED-APPLY + TESTNET-VALIDATION Execution Packet

> **DOC / RUNBOOK — NOT EXECUTION.** Nothing here runs until explicitly approved, action-by-action. **No linked apply · no
> deploy · no DB mutation · no Railway/Doppler · no secrets · no mainnet / no real funds.** For Codex review before
> execution. Implements the linked-apply plan of the committed H3-1 diff (`d23e251`); pairs with
> `production-a8-h3-slice-h3-1-local-validation-results.md`.
>
> **Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.** (1/5 closes only when H3-1 is
> linked-applied+deployed AND H3-2 no-sharing is done.)

## Division of labour (binding)
- **Operator runs** ALL mutations: the two surgical migration applies (021, 022), the metadata tracking insert, the
  deploys, and any operator-JWT runtime read. **Never `db push`.**
- **Claude runs read-only read-backs only** (`supabase db query --linked` = catalog/data SELECTs; no mutation).
- Each Action is a **separate approval**: "Approved for Action A only", etc. A read-back FAIL halts the sequence.

---

## 1. Pre-checks (P0 — read-only; must ALL pass before Action A)
| # | Check | How | Expected |
|---|---|---|---|
| P1 | Git at `d23e251`, clean, synced | `git rev-parse HEAD`; `git status --porcelain`; `git fetch && git rev-list --count origin/main..HEAD` | HEAD=`d23e251…`; empty status; 0 ahead/behind origin/main |
| P2 | PITR / backup confirmed | **Operator** confirms Supabase PITR/backup available for the linked project | operator attests |
| P3 | System disarmed | Claude read-back (below) | `enabled_bots=0`, `queue_enabled=false`, `is_production=false` |
| P4 | Cross-user mismatch = 0 (I2 clean) | Claude read-back | `cross_user=0` |
| P5 | Shared-credential count = 1 | Claude read-back | `shared_credentials=1` |
| P6 | 5 bots share ONE testnet credential | Claude read-back | one credential, `live_bots=5`; env=testnet |

**P3-P6 read-only SQL (Claude runs `supabase db query --linked --file`):**
```sql
select jsonb_pretty(jsonb_build_object(
  'disarmed_enabled_bots', (select count(*) from public.bots where trading_enabled = true and deleted_at is null),
  'worker', (select jsonb_build_object('queue_enabled', w.queue_enabled, 'is_production', w.is_production,
                                        'worker_state', w.worker_state) from public.worker_status w limit 1),
  'cross_user', (select count(*) from public.bots b
                   join public.user_exchange_credentials c on c.id = b.credential_id
                   where b.deleted_at is null and c.user_id <> b.user_id),
  'shared_credentials', (select count(*) from (
       select credential_id from public.bots where credential_id is not null and deleted_at is null
       group by credential_id having count(*) > 1) s),
  'fanout', (select jsonb_agg(jsonb_build_object('credential_id', credential_id, 'live_bots', n))
             from (select credential_id, count(*) n from public.bots
                   where credential_id is not null and deleted_at is null group by credential_id) t),
  'live_env', (select jsonb_object_agg(coalesce(exchange_environment,'(null)'), n) from (
       select c.exchange_environment, count(*) n from public.bots b
         join public.user_exchange_credentials c on c.id=b.credential_id
       where b.deleted_at is null group by c.exchange_environment) e)
)) as p0;
-- Expect: disarmed_enabled_bots=0; queue_enabled=false; is_production=false; cross_user=0; shared_credentials=1;
--         fanout = one credential with live_bots=5; live_env = {testnet: 5}.
```
**Also capture a BOT-STATE BASELINE now (for the P7 "no bot state changed" check after Action A):**
```sql
select coalesce(md5(string_agg(id::text || '|' || status || '|' || coalesce(trading_enabled::text,'') || '|' ||
        coalesce(credential_id::text,'null'), ',' order by id)), 'none') as bot_state_hash,
       count(*) as live_bots
from public.bots where deleted_at is null;
-- Record bot_state_hash + live_bots. Must be IDENTICAL after Action A (021 changes constraints, not data).
```

## 2. Action A — apply migration 021 (S2 ownership FK) ONLY
**Operator runs:** `supabase db query --linked --file supabase/migrations/021_bots_credential_owner_fk.sql`
(transaction-wrapped; its own PRE-guard re-checks 0 cross-user + FK exists; POST-verify; **never `db push`**).

**Claude read-backs (read-only):**
```sql
select jsonb_pretty(jsonb_build_object(
  'uec_id_user_key',            exists(select 1 from pg_constraint where conrelid='public.user_exchange_credentials'::regclass
                                        and conname='uec_id_user_key' and contype='u'),
  'bots_credential_owner_fkey', exists(select 1 from pg_constraint where conrelid='public.bots'::regclass
                                        and conname='bots_credential_owner_fkey' and contype='f'),
  'old_fkey_removed',      not exists(select 1 from pg_constraint where conrelid='public.bots'::regclass
                                        and conname='bots_credential_id_fkey'),
  'owner_fkey_def', (select pg_get_constraintdef(oid) from pg_constraint
                       where conrelid='public.bots'::regclass and conname='bots_credential_owner_fkey')
)) as a_readback;
-- Expect: uec_id_user_key=true; bots_credential_owner_fkey=true; old_fkey_removed=true;
--         owner_fkey_def = FOREIGN KEY (credential_id, user_id) REFERENCES ...(id, user_id) ON DELETE RESTRICT
```
**P7 — no bot state changed:** re-run the BOT-STATE BASELINE query → `bot_state_hash` + `live_bots` **IDENTICAL** to P0.
**PASS gate:** all four booleans true, FK def exact, bot_state_hash unchanged. **Any mismatch → STOP + Action-A rollback (§7).**

## 3. Action B — apply migration 022 (S1a operator_status) ONLY
**Operator runs:** `supabase db query --linked --file supabase/migrations/022_operator_status_credential_shared.sql`.

**Claude read-backs (read-only):**
1. **Function definition carries the new fields + grants intact (catalog, no execute):**
```sql
select jsonb_pretty(jsonb_build_object(
  'has_credential_shared',  (pg_get_functiondef('public.operator_status()'::regprocedure) like '%credential_shared%'),
  'has_shared_with_count',  (pg_get_functiondef('public.operator_status()'::regprocedure) like '%shared_with_count%'),
  'grant_authenticated',    exists(select 1 from information_schema.role_routine_grants
                                   where routine_name='operator_status' and grantee='authenticated' and privilege_type='EXECUTE'),
  'no_public_grant',    not exists(select 1 from information_schema.role_routine_grants
                                   where routine_name='operator_status' and grantee in ('PUBLIC','anon'))
)) as b_readback_def;
-- Expect: has_credential_shared=true; has_shared_with_count=true; grant_authenticated=true; no_public_grant=true
```
2. **Data-equivalent read-only proof (does NOT execute the RPC; computes the same values from the tables):**
```sql
select jsonb_agg(jsonb_build_object('bot_id', b.id, 'credential_shared', shared, 'shared_with_count', n) order by b.id)
from public.bots b
cross join lateral (
  select count(*) as n from public.bots b2
   where b2.credential_id = b.credential_id and b2.deleted_at is null and b2.id <> b.id
) cnt
cross join lateral (select (b.credential_id is not null and cnt.n > 0) as shared) s
where b.deleted_at is null;
-- Expect: the 5 live bots each → credential_shared=true, shared_with_count=4.
```
3. **Operator-JWT runtime read (OPERATOR runs — Claude cannot supply an operator JWT):** call `operator_status()` as the
   operator (console or an operator-JWT `curl`/SQL with `request.jwt.claims` set) and confirm the live payload lists **5
   bots**, each with **`credential_shared=true`** and **`shared_with_count=4`**, and no secret fields. Operator reports the
   (non-secret) shape.
**PASS gate:** def booleans true + grants intact + data-equivalent shows 5×(true,4) + operator-JWT read matches. **Else STOP + Action-B rollback (§7).**

## 4. Action C — metadata tracking insert (ONLY after A + B read-backs PASS)
**Operator runs** this reviewed **metadata-only** SQL (A2-reconcile discipline — touches ONLY the tracking table; **never
`db push`**):
```sql
begin;
-- PRE: 021/022 not yet tracked; 020 present (sanity).
do $$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version in ('021','022')) then
    raise exception 'H3-1 track PRE: 021/022 already tracked'; end if;
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '020') then
    raise exception 'H3-1 track PRE: 020 missing — unexpected tracking state'; end if;
end $$;
insert into supabase_migrations.schema_migrations (version, name)
select x.version, x.name from (values
  ('021','bots_credential_owner_fk'),
  ('022','operator_status_credential_shared')
) as x(version, name)
where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = x.version);
-- POST: exactly 021+022 now present with expected names; no duplicates.
do $$ begin
  if (select count(*) from supabase_migrations.schema_migrations m
      join (values ('021','bots_credential_owner_fk'),('022','operator_status_credential_shared'))
        e(version,name) on e.version=m.version and e.name=m.name) <> 2 then
    raise exception 'H3-1 track POST: 021/022 not both present with expected names'; end if;
  if exists (select 1 from supabase_migrations.schema_migrations group by version having count(*)>1) then
    raise exception 'H3-1 track POST: duplicate version'; end if;
end $$;
commit;
```
**Claude read-backs:** tracking table now lists `…020, 021, 022` (names exact, no dups); then **`supabase migration list
--linked`** = **Local == Remote / nothing pending**. **PASS gate:** both true. Then update the A2 ledger (doc-only, after
this insert).

## 5. Action D — deploy worker + frontend
**Operator deploys** (Railway): the worker (W1 ownership check) + the frontend (S1a surface). **Verify:**
- **Worker healthy:** Claude read-back `worker_status` → `worker_state` sane, `updated_at` fresh (within staleness window),
  `boot_stuck_count` not climbing; operator confirms no crash-loop in Railway logs. Startup env non-secret.
- **Ops Harness / operator_status surface:** operator loads the console (operator JWT) → `operator_status()` returns
  `credential_shared`/`shared_with_count`; the Harness preflight shows the **"credential sharing (advisory)"** item
  (attention, sharing visible) with **verdict still PASS** when disarmed (Option B).
**PASS gate:** worker healthy + surface shows the new fields + advisory visible. **Else STOP + deploy rollback (§7).**

## 6. Testnet validation (read-only / observational — NO kill, NO order, NO secrets)
- **No kill call** (`operator_kill_all` NOT invoked) · **no real order** (`createOrder` never) · **no secrets printed**.
- **Verify disarmed:** `enabled_bots=0`, `queue_enabled=false`, `is_production=false` (re-run the P3 read).
- **Verify sharing advisory visible:** in the Ops Harness preflight, the `credential sharing (advisory)` item is present +
  `attention` (5 bots share) and the overall verdict is **PASS** (Option B: advisory does not flip verdict).
- **Ownership enforcement smoke (optional, read-only):** confirm a *would-be* cross-user write is rejected — **do NOT**
  mutate; instead confirm the FK exists (Action-A read-back already proves it). No data change.
- **No `vault_secret_id` in logs (if logs checked):** if the operator greps recent worker/Railway logs, confirm no
  `vault_secret_id` value appears (the new W1 paths log ids + reason only). Report pass/fail, never paste a secret.

## 7. Rollback (per action; reversible — metadata/constraint/function only, no bot-data change)
- **Action A (021):** `alter table public.bots drop constraint bots_credential_owner_fkey, add constraint
  bots_credential_id_fkey foreign key (credential_id) references public.user_exchange_credentials(id) on delete restrict;
  alter table public.user_exchange_credentials drop constraint uec_id_user_key;` (constraint-only; verify 0 cross-user
  still holds — it does).
- **Action B (022):** `CREATE OR REPLACE public.operator_status()` back to the **exact migration-020 body** (revert the two
  added fields); re-assert grants. (Ship a `022_rollback.sql` = the 020 body if needed.)
- **Action D (deploy):** redeploy the prior worker/frontend build (Railway rollback). W1 is additive + fail-closed;
  reverting only removes the extra guard — the DB FK still enforces ownership.
- **Action C (tracking) — only if needed:** `delete from supabase_migrations.schema_migrations where version in
  ('021','022');` — safe ONLY because it is tracking metadata; do this only if reverting the migrations themselves. Never
  generalize "delete the row" to any other table.
- **Order:** roll back in reverse (D → C → B → A) as far as needed; each step re-verified by read-back.

## 8. Stop conditions (hard)
- **Any P0 pre-check fails** (not clean/synced, PITR unconfirmed, not disarmed, cross_user≠0, shared≠1, not 5-on-1) → do
  NOT start Action A.
- **Any Action read-back FAILs** → STOP at that action; roll back that action; do not proceed.
- **`db push` proposed / used anywhere** → STOP.
- **Any bot-state change after Action A** (bot_state_hash differs) → STOP + rollback (021 must not touch data).
- **Any secret / `vault_secret_id` value about to be printed** → STOP (report pass/fail only).
- **Any move toward a kill call, a real order, arming, or mainnet** → STOP (out of scope).
- **Real funds remain NO-GO.**

## 9. Evidence packet format (record per action; non-secret only)
- **Header:** date, git HEAD (`d23e251`), operator attestation of PITR.
- **Per action (A/B/C/D):** the exact command run (operator), the read-back query + its (non-secret) JSON result, PASS/FAIL,
  timestamp.
- **P0:** the pre-check JSON + the bot_state_hash (before) and (after Action A).
- **022:** the def-check booleans, the data-equivalent 5×(true,4) array, and the operator-JWT read shape.
- **C:** the tracking-table list + `migration list --linked` output (Local==Remote).
- **D:** worker_status snapshot + a one-line "harness advisory visible, verdict PASS" note.
- **Validation:** disarmed re-read, advisory-visible confirmation, "no vault_secret_id in logs" pass/fail.
- **Close:** "H3-1 linked-applied + testnet-validated" + the updated progress line. Secrets NEVER recorded.

## 10. Progress
**Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.**
On successful execution, H3-1 is **linked-applied + deployed + testnet-validated** — but **1/5 stays incomplete** until
**H3-2** (S1b single-use + testnet split/backfill) closes the full credential-isolation gate.

---
**Net:** a per-action, read-back-gated runbook to apply 021 → 022 → track → deploy → validate on **testnet**, with
rollback for every step and a hard no-kill/no-order/no-secret/no-mainnet posture. **Authorizes nothing** — each action is
separately operator-approved. **Real funds remain NO-GO.**

---

## RUN — RESULTS (executed 2026-07-12, testnet; operator-run mutations, Claude read-backs)
**Outcome: A → B → C → D all PASS. H3-1 linked-applied + deployed + testnet-validated.** No kill, no order, no arming,
no secrets, no mainnet. `bot_state_hash = b787cc92ffa3d786167c6204f2a4de04` unchanged across every action.

- **P0 pre-checks — PASS:** git `5a05625` clean/synced (0 ahead/0 behind); PITR operator-attested; disarmed
  (`enabled_bots=0`, `queue_enabled=false`, `is_production=false`, `worker_state=disabled`); `cross_user=0`;
  `shared_credentials=1`; fanout = credential `2b5c038a…781b` → 5 live bots; `live_env={testnet:5}`; bot-state baseline
  captured (`b787cc92…de04`). No kill/order/arm.
- **Action A (021) — PASS:** operator applied `021_bots_credential_owner_fk.sql`. Read-backs: `uec_id_user_key`=true;
  `bots_credential_owner_fkey`=true (`FOREIGN KEY (credential_id, user_id) REFERENCES user_exchange_credentials(id,
  user_id) ON DELETE RESTRICT`); old `bots_credential_id_fkey` removed; `bot_state_hash` unchanged; disarmed; cross_user=0.
  *(First read-back showed pre-021 state → reported honestly; operator re-ran → verified.)*
- **Action B (022) — PASS:** operator applied `022_operator_status_credential_shared.sql`. Read-backs: def includes
  `credential_shared` + `shared_with_count`; grants intact (authenticated EXECUTE, no anon/PUBLIC); **data-equivalent: all
  5 live bots → `credential_shared=true`, `shared_with_count=4`**; `bot_state_hash` unchanged; disarmed.
  *(First read-back showed def still 020 → reported honestly; operator re-ran → verified.)*
- **Action C (metadata tracking) — PASS:** operator ran the reviewed metadata-only artifact
  (`scratchpad/h31-track-021-022.sql`; PRE 001-008/010-020 present, 009 absent, 021/022 absent, 0 dups; INSERT 021+022;
  POST exact names, no dups, 009 absent). Read-backs: `021`=`bots_credential_owner_fk`, `022`=
  `operator_status_credential_shared`; `009` absent; 0 duplicates; **total 19 → 21 (+2 only)**; version list
  `001-008 + 010-022`; **`supabase migration list --linked` = every row Local == Remote / nothing pending**;
  `bot_state_hash` unchanged (metadata-only). A2 ledger updated (below).
- **Action D (deploy + verify) — PASS:**
  - **Worker health (Claude read-only DB):** `worker_status` fresh (~26s), `boot_stuck_count=0`, `worker_state=disabled`,
    `enabled_bots=0`, `queue_enabled=false`, `is_production=false`, `open_trades=0`, `dlq=0`. Only kill audit =
    `operator.kill_all` @ 2026-07-09 (historical A8-H2 drill; **none from this session**). `bot_state_hash` unchanged.
  - **Frontend / Ops Harness (operator browser evidence):** `harnessPanel=true`; **Preflight=PASS**; **kill UI flag=OFF**;
    harness flag=ON; **deployed bundle=`index-COkqcrZH.js`**; baseline captured (5 bots); disarmed visible=true;
    **credential sharing advisory visible=true**; **`vault_secret_id` visible=false**; kill-button=null; kill-controls=null;
    restore-draft visible + non-executable + review-required + every line commented = true.
  - **Note:** the raw field name `shared_with_count` was not surfaced as visible UI text, but the **Action-B
    data-equivalent already proved all 5 live bots return `credential_shared=true` / `shared_with_count=4`** at the RPC/data
    layer; the console confirms the runtime path loads, the advisory renders, and kill UI stays OFF (Option-B contract).
- **Ownership now DB-enforced on the linked testnet DB** (021 composite FK) + worker W1 fail-closed (deployed) + S1a
  detection live (022 + console). **1/5 remains incomplete** until H3-2 (S1b + testnet split/backfill) closes the full
  credential-isolation gate.

**Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.**
