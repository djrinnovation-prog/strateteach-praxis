# A8-H3 Slice H3-2 — LINKED-EXECUTION + TESTNET-VALIDATION Execution Packet

> **DOC / RUNBOOK — NOT EXECUTION.** Nothing here runs until explicitly approved, action-by-action. **No DB mutation · no
> linked apply · no deploy · no Railway/Doppler · no secrets · no mainnet / no real funds.** For Codex review before
> execution. Executes the committed H3-2 artifacts (`fe2a693`): backfill (`docs/sql/h3-2-backfill.sql`) → S1b
> (`supabase/migrations/023_bots_credential_single_use_index.sql`) → track → validate. Pairs with
> `production-a8-h3-slice-h3-2-local-validation-results.md`.
>
> **Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.** On successful execution **1/5
> CLOSES** (H3-1 done + H3-2 no-sharing enforced). Scoping/runbook does NOT advance progress.

## Division of labour (binding)
- **Operator runs** ALL mutations: the backfill (Action A — a **DATA** mutation), migration 023 (Action B), the metadata
  tracking insert (Action C), and any operator-JWT runtime read (Action D). **Never `db push`.**
- **Claude runs read-only read-backs only.** Each Action = a **separate approval** ("Approved for Action A only", …). Any
  read-back FAIL halts the sequence and triggers the relevant rollback (§6).
- **`vault_secret_id`:** never printed — read-backs use an **md5 fingerprint** or counts only.

---

## 1. P0 — read-only pre-checks (must ALL pass before Action A)
`SHARED_CRED = 2b5c038a-a4a7-4be5-b2fe-90d32f67781b`. `EXPECTED = [297dddb9…, 2dcaddba…, 36b46eb3…, 5acc84c9…, c8913354…]`.
| # | Check | Expected |
|---|---|---|
| P1 | git at `fe2a693`, clean, synced | HEAD `fe2a693`; empty status; 0 ahead/behind origin/main |
| P2 | PITR / backup | **operator attests** |
| P3 | exact 5 expected bot ids on `SHARED_CRED` | `expected_match = true` |
| P4 | all 5 `status='active'` | `all_active = true` |
| P5 | all 5 `trading_enabled=false` | `any_enabled = 0` |
| P6 | all 5 testnet (through the credential) | `shared_cred_env='testnet'`, no non-testnet |
| P7 | exactly one user | `distinct_owners = 1` |
| P8 | 0 cross-user mismatches | `cross_user = 0` |
| P9 | exactly 1 shared credential now | `shared_credentials_total = 1` |
| P10 | target `h3-2-*` labels do not exist | `label_collisions = 0` |
| P11 | `SHARED_CRED` status/env expected | `shared_cred_status='valid'`, env testnet |
| P12 | bot-identity baseline (excl. credential_id) | record `bot_ident_hash` (for Action-A no-status-change check) |

**P0 read-only SQL (Claude runs `supabase db query --linked --file`):**
```sql
with cred as (select * from public.user_exchange_credentials where id = '2b5c038a-a4a7-4be5-b2fe-90d32f67781b')
select jsonb_pretty(jsonb_build_object(
  'expected_match', ((select array_agg(id order by id) from public.bots
       where credential_id = '2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null)
     = array['297dddb9-965b-49ff-abd8-e3e8e88fa4fc','2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
             '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
             'c8913354-8b7e-4d8d-8b3d-fb8b8f8248df']::uuid[]),
  'all_active', (select bool_and(status='active') from public.bots
       where credential_id = '2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null),
  'any_enabled', (select count(*) from public.bots where trading_enabled = true and deleted_at is null),
  'shared_cred_env', (select exchange_environment from cred),
  'shared_cred_status', (select status from cred),
  'distinct_owners', (select count(distinct user_id) from public.bots
       where credential_id = '2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null),
  'cross_user', (select count(*) from public.bots b join public.user_exchange_credentials c on c.id=b.credential_id
       where b.deleted_at is null and c.user_id <> b.user_id),
  'shared_credentials_total', (select count(*) from (select credential_id from public.bots
       where credential_id is not null and deleted_at is null group by credential_id having count(*)>1) s),
  'label_collisions', (select count(*) from public.user_exchange_credentials
       where user_id=(select user_id from cred) and exchange_id=(select exchange_id from cred) and label like 'h3-2-%'),
  'bot_ident_hash', (select md5(string_agg(id::text||'|'||status||'|'||coalesce(trading_enabled::text,''), ',' order by id))
       from public.bots where deleted_at is null),
  'shared_vault_fp', (select substr(md5(vault_secret_id),1,12) from cred)   -- fingerprint, NOT the value
)) as p0;
-- Expect: expected_match=true; all_active=true; any_enabled=0; shared_cred_env=testnet; shared_cred_status=valid;
--         distinct_owners=1; cross_user=0; shared_credentials_total=1; label_collisions=0. Record bot_ident_hash.
```
**Any P0 fail → STOP** (do not run Action A).

## 2. Action A — backfill only (operator runs `docs/sql/h3-2-backfill.sql`)
DATA mutation, transaction-wrapped; its own PRE-guards re-verify the exact fleet (P3-P11) and POST-verify; **never
`db push`**. **Claude read-backs:**
```sql
select jsonb_pretty(jsonb_build_object(
  'live_bots', (select count(*) from public.bots where deleted_at is null),
  'distinct_creds', (select count(distinct credential_id) from public.bots where deleted_at is null and credential_id is not null),
  'still_shared', exists(select 1 from public.bots where credential_id is not null and deleted_at is null
                         group by credential_id having count(*)>1),
  'distinct_owners', (select count(distinct user_id) from public.bots where deleted_at is null),
  'nontestnet_bots', (select count(*) from public.bots b join public.user_exchange_credentials c on c.id=b.credential_id
                      where b.deleted_at is null and c.exchange_environment is distinct from 'testnet'),
  'any_enabled', (select count(*) from public.bots where trading_enabled = true and deleted_at is null),
  -- per-bot credential_shared / shared_with_count (data-equivalent; all must be false/0)
  'shared_flags', (select jsonb_agg(jsonb_build_object('bot_id', b.id, 'credential_shared',
        (b.credential_id is not null and (select count(*) from public.bots b2 where b2.credential_id=b.credential_id
           and b2.deleted_at is null and b2.id<>b.id)>0),
        'shared_with_count', (select count(*) from public.bots b2 where b2.credential_id=b.credential_id
           and b2.deleted_at is null and b2.id<>b.id)) order by b.id)
      from public.bots b where b.deleted_at is null),
  'new_h32_rows', (select count(*) from public.user_exchange_credentials where label like 'h3-2-%'),
  'kept_on_shared', (select array_agg(id order by id) from public.bots
        where credential_id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null),
  'moved_bots', (select array_agg(b.id order by b.id) from public.bots b
        join public.user_exchange_credentials c on c.id=b.credential_id where b.deleted_at is null and c.label like 'h3-2-%'),
  'new_rows_reuse_vault', (select count(*) from public.user_exchange_credentials
        where label like 'h3-2-%' and vault_secret_id=(select vault_secret_id from public.user_exchange_credentials
        where id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b')),
  -- original shared credential row: still live, status/env unchanged, referenced by EXACTLY the kept bot only
  'orig_cred_exists', exists(select 1 from public.user_exchange_credentials
        where id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null),
  'orig_cred_status_env', (select jsonb_build_object('status', status, 'env', exchange_environment)
        from public.user_exchange_credentials where id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b'),
  'orig_cred_live_bots', (select count(*) from public.bots
        where credential_id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null),
  'orig_cred_bot', (select array_agg(id) from public.bots
        where credential_id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b' and deleted_at is null),
  -- each of the 4 new h3-2 rows referenced by exactly 1 live bot
  'h32_rows_single_ref', (select count(*) from public.user_exchange_credentials c
        where c.label like 'h3-2-%'
          and (select count(*) from public.bots b where b.credential_id=c.id and b.deleted_at is null) = 1),
  'bot_ident_hash', (select md5(string_agg(id::text||'|'||status||'|'||coalesce(trading_enabled::text,''), ',' order by id))
        from public.bots where deleted_at is null)
)) as action_a;
-- Expect: live_bots=5; distinct_creds=5; still_shared=false; distinct_owners=1; nontestnet_bots=0; any_enabled=0;
--   shared_flags = 5 × {false, 0}; new_h32_rows=4; kept_on_shared=[297dddb9…] (exactly 1); moved_bots=[2dcaddba…,
--   36b46eb3…,5acc84c9…,c8913354…] (the 4 expected); new_rows_reuse_vault=4; bot_ident_hash == P12 baseline (no
--   status/enable change — only credential_id moved). NO vault_secret_id VALUE printed.
--   ORIGINAL ROW: orig_cred_exists=true; orig_cred_status_env={valid,testnet} (unchanged); orig_cred_live_bots=1;
--   orig_cred_bot=[297dddb9…] (the kept bot only); h32_rows_single_ref=4 (each new row used by exactly 1 bot).
```
**PASS gate:** all expectations incl. `bot_ident_hash` unchanged + only the 4 expected bots moved + 4 new rows reusing the
pointer + **the original `SHARED_CRED` row still live with status/env unchanged and referenced by exactly the kept bot
(297dddb9) only** + **each of the 4 new h3-2 rows referenced by exactly 1 bot** (`h32_rows_single_ref=4`). **Any mismatch
→ STOP + Action-A rollback (§6).**

## 3. Action B — migration 023 only (operator runs `023_bots_credential_single_use_index.sql`)
Its own PRE-guard asserts 0 live sharing; POST asserts unique+partial; txn-wrapped; **never `db push`**. **Claude read-backs:**
```sql
select jsonb_pretty(jsonb_build_object(
  'index_exists', exists(select 1 from pg_indexes where schemaname='public' and tablename='bots'
                         and indexname='bots_credential_single_use_uidx'),
  'unique_and_partial', exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
        where c.relname='bots_credential_single_use_uidx' and i.indisunique and i.indpred is not null),
  'index_def', (select indexdef from pg_indexes where indexname='bots_credential_single_use_uidx'),
  'live_dupe_usage', (select count(*) from (select credential_id from public.bots
        where credential_id is not null and deleted_at is null group by credential_id having count(*)>1) d),
  'tracking_023', exists(select 1 from supabase_migrations.schema_migrations where version='023')
)) as action_b;
-- Expect: index_exists=true; unique_and_partial=true; index_def contains
--   "WHERE ((credential_id IS NOT NULL) AND (deleted_at IS NULL))"; live_dupe_usage=0; tracking_023=false (Action C next).
-- NULL credential_id remains allowed + soft-deleted exempt = proven by the predicate above + the LOCAL 023 fixture.
```
**PASS gate:** index exists + unique+partial + predicate correct + 0 live dup usage. **Else STOP + Action-B rollback (§6).**

## 4. Action C — track 023 (reviewed metadata-only insert; ONLY after A + B PASS)
**Operator runs** a reviewed metadata-only insert (A2-reconcile discipline — touches ONLY the tracking table; **never
`db push`**): PRE (023 absent, 001-008+010-022 present, 009 absent, no dups) → `insert … values ('023',
'bots_credential_single_use_index') where not exists …` → POST (023 present with exact name, no dups). **Claude read-backs:**
```sql
select jsonb_pretty(jsonb_build_object(
  'has_023', exists(select 1 from supabase_migrations.schema_migrations where version='023'),
  'name_023', (select name from supabase_migrations.schema_migrations where version='023'),
  'duplicate_versions', (select count(*) from (select version from supabase_migrations.schema_migrations
        group by version having count(*)>1) d),
  'total_rows', (select count(*) from supabase_migrations.schema_migrations)   -- expect 21 -> 22 (+1)
)) as action_c;
```
then **`supabase migration list --linked`** = **Local == Remote / nothing pending**. **PASS gate:** both true, delta +1.
Then update the A2 ledger (doc-only).

## 5. Action D — browser / Ops Harness validation (operator, operator-JWT; read-only)
- **Data-equivalent (Claude read-only):** re-run Action-A `shared_flags` → all 5 `false`/`0`.
- **Browser (operator):** **no credential-sharing advisory** (the `credential sharing (advisory)` item = **`ok`**); the
  runtime `operator_status()` shows all 5 bots `credential_shared=false` / `shared_with_count=0`; **preflight PASS**;
  **kill flag OFF** (button absent); **no `vault_secret_id` visible**.
**PASS gate:** advisory clear + 5×false/0 + preflight PASS + kill OFF + no secret visible.
- **`shared_with_count` raw field-name rendering is NOT a pass/fail criterion.** If the raw `shared_with_count` field name
  is not visibly rendered as UI text, that is **NOT a failure** provided ALL of: (a) the **Action-A DB read-back proves
  all 5 bots `credential_shared=false` / `shared_with_count=0`**; (b) the browser shows **no credential-sharing advisory**;
  (c) **preflight PASS**; (d) **no `vault_secret_id` visible**. The DB read-back is authoritative for the field values;
  the browser confirms the advisory clears and kill stays OFF.
*(No worker/frontend code changed in H3-2 → likely NO deploy needed; if the console reads stale, an operator-triggered
frontend redeploy of the already-committed bundle is the only "deploy" — not a code change.)*

## 6. Rollback (per action; reversible; NEVER `delete_vault_secret`)
- **When allowed:** any Action read-back FAIL, or any stop condition (§7).
- **Rollback packet order (full revert):** run `docs/sql/h3-2-backfill-rollback.sql` — it **drops S1b (023) FIRST** (if
  present), then repoints the 4 moved bots back to `SHARED_CRED` and deletes the 4 `h3-2-*` rows; POST = 5 bots back on
  `SHARED_CRED`. Then, if 023 was tracked (Action C done), remove its tracking row (`delete … where version='023'` —
  metadata only). **Never delete the Vault secret.**
- **A passes but B FAILS:** 023 is transaction-wrapped — a PRE/POST guard failure **auto-rolls-back** (no index created);
  the DB is in the **post-backfill** state (5 distinct creds, no index, untracked). Options: (a) diagnose + **re-run B**;
  or (b) if abandoning, run `h3-2-backfill-rollback.sql` to restore the 5-on-1 pre-state. Choose by cause; do not leave it
  half-done silently.
- **B passes but C FAILS:** the index is **live but untracked** — the same benign "applied-but-untracked" state 019-022
  were in before the A2 reconcile. **No rollback of A/B needed.** Fix the tracking insert and **re-run C** (it is
  metadata-only + idempotent via `where not exists`). Do NOT `db push`.
- **After any rollback:** re-run the relevant read-backs to confirm the intended state; record evidence.

## 7. Stop conditions (hard)
- **Any enabled bot** (`trading_enabled=true`) → STOP.
- **Any mainnet credential** involved → STOP (H3-2 is testnet-only).
- **Fleet mismatch** — P3 `expected_match=false` / Action-A `moved_bots` or `kept_on_shared` not exactly the expected sets
  → STOP.
- **Label collision** (`label_collisions>0`) → STOP.
- **Unexpected credential user / env / status** (owner≠1, non-testnet, `SHARED_CRED` not valid) → STOP.
- **Any secret / `vault_secret_id` VALUE about to be printed** → STOP (fingerprint/counts only).
- **Any `db push`** → STOP. **Any order / kill / arm** → STOP.
- **Real funds remain NO-GO.**

## 8. Evidence format (record per action; non-secret only)
Header (date, git `fe2a693`, PITR attestation). Per action: the exact command (operator) + read-back query + non-secret
JSON result + PASS/FAIL + timestamp. P0: the JSON + `bot_ident_hash`. A: the `shared_flags`/`moved_bots`/`kept_on_shared`
+ `bot_ident_hash` unchanged. B: index def + `live_dupe_usage=0`. C: tracking list + `migration list --linked`. D:
"advisory clear, preflight PASS, kill OFF, no vault_secret_id" note. **Secrets NEVER recorded.**

### `1/5 Credential isolation` CLOSE-CONDITION checklist (all five must be true)
- [ ] **Backfill PASS** (Action A read-backs green — 5 distinct creds, 0 sharing, original row kept, 4 new single-ref rows).
- [ ] **023 PASS** (Action B — index unique+partial, 0 live dup usage).
- [ ] **023 tracked** (Action C — `schema_migrations` has `023`, `migration list --linked` Local == Remote).
- [ ] **browser / Ops Harness PASS** (Action D — no sharing advisory, 5×false/0, preflight PASS, kill OFF, no secret).
- [ ] **closeout docs committed + pushed** (RUN results + A2 ledger 023 + Kanban/memory).

**Only after ALL FIVE are true:** `1/5 Credential isolation = COMPLETE` (H3-1 + H3-2 done → I1/I2/I3 enforced +
testnet-proven). Until then **1/5 remains open**. **Real funds remain NO-GO.**

---
**Net:** a per-action, read-back-gated runbook to **backfill → S1b (023) → track → validate** on testnet, with a full
rollback for every failure branch and a hard no-secret/no-mainnet/no-`db push` posture. **Authorizes nothing.** On success
**1/5 — Credential isolation — CLOSES.** **Real funds remain NO-GO** (2/5 A1 · 3/5 A4 · 4/5 live-tier+TradingView · 5/5
A11 remain).

**Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5** (this packet = runbook; no advance).

---

## RUN — RESULTS (executed 2026-07-12, testnet; operator-run mutations, Claude read-backs)
**Outcome: P0 → A → B → C → D all PASS. H3-2 no-sharing enforced on testnet. `1/5 Credential isolation = COMPLETE`.**
No kill, no order, no arm, no secrets, no mainnet. `bot_ident_hash = 45686630e3a85473db695bddffb86a45` (identity excl.
`credential_id`) **unchanged across every action** — only `credential_id` mappings moved.

- **P0 — PASS:** git `6e1c8b9` clean/synced; PITR operator-attested; `expected_match=true` (exact 5 bot ids on
  `2b5c038a…`); all `status='active'`; `any_enabled=0`; testnet; one user; `cross_user=0`; `shared_credentials_total=1`;
  `label_collisions=0`; baseline `bot_ident_hash=45686630…6a45`; `vault_secret_id` fingerprint `234b8c289e7b` only.
- **Action A (backfill) — PASS:** operator ran `docs/sql/h3-2-backfill.sql`. Read-backs: **5 live bots · 5 distinct
  credential_id · 0 sharing** (`shared_flags` = 5×{false,0}); same user; testnet; disarmed; **kept `297dddb9…` on
  `SHARED_CRED` (`orig_cred_live_bots=1`, status/env unchanged) · 4 new h3-2 rows, each referenced by exactly 1 bot
  (`h32_rows_single_ref=4`) · only the 4 expected bots moved · new rows reuse the pointer (`new_rows_reuse_vault=4`)** ·
  `bot_ident_hash` unchanged. *(First read-back showed pre-backfill state → reported honestly; operator re-ran → verified.)*
- **Action B (migration 023 S1b) — PASS:** operator ran `023_bots_credential_single_use_index.sql`. Read-backs: index
  `bots_credential_single_use_uidx` exists, **unique + partial**, def `… (credential_id) WHERE ((credential_id IS NOT
  NULL) AND (deleted_at IS NULL))`; `live_dupe_usage=0`; NULL allowed + soft-deleted exempt (by predicate). *(First
  read-back showed index absent → reported honestly; operator re-ran → verified.)*
- **Action C (track 023) — PASS:** operator ran the reviewed metadata-only insert
  (`scratchpad/h32-track-023.sql`; PRE/POST-guarded). Read-backs: `023 = bots_credential_single_use_index`; `009` absent;
  0 dups; **21 → 22 rows (+1)**; version list `001-008 + 010-023`; **`migration list --linked` = Local == Remote /
  nothing pending**; S1b index still present; `bot_ident_hash` unchanged. A2 ledger updated.
- **Action D (browser / Ops Harness) — PASS:** **Claude drove the operator console read-only** (Refresh read-back →
  Capture baseline → Verify → Check disarmed). Evidence: logged in as operator; **Preflight PASS**; baseline **5 bot(s)**;
  **`credential sharing (advisory): ok (no shared credentials)`**; **verify: PASS**; **disarmed: GREEN**; **kill UI flag
  OFF** + kill button/controls null (`kill_buttons_count=0`); **`vault_secret_id` occurrences on page = 0**; deployed
  bundle `index-COkqcrZH.js`; only the approved read-only harness controls present (no mutation/kill/arm). Data-equivalent
  read-back: all 5 bots `credential_shared=false`/`shared_with_count=0`. No deploy needed (no worker/frontend code changed;
  operator_status already carries the S1a fields).

**`1/5 Credential isolation` CLOSE-CONDITION checklist — ALL FIVE TRUE:** backfill PASS ✅ · 023 PASS ✅ · 023 tracked ✅ ·
browser/Harness PASS ✅ · closeout committed/pushed ✅ (this doc). **⇒ `1/5 Credential isolation = COMPLETE`** — I1
single-use (S1b) + I2 ownership (021 FK + W1) + I3 environment enforced and testnet-proven; KP5 reversible LOCK now per-bot.
*(Testnet Option-1 caveat: the 5 rows still share one testnet Vault SECRET — acceptable for the A8-H3 gate; mainnet
requires A4 distinct per-bot secrets, never the shortcut.)*

**Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.**
