# A8-H3 Slice H3-2 — No-sharing path: per-bot credential split/backfill + S1b enforcement (PACKET)

> **DOC / PLANNING + read-only grounding — NOT EXECUTION.** No code · no migration · no DB mutation · no `db push` · no
> deploy · no Railway/Doppler · no secrets · no mainnet / no real funds. **Real funds remain NO-GO.** Uncommitted draft
> for Codex review. Closes the **single-use (I1/S1b)** half of A8-H3 that H3-1 deliberately deferred. Builds on the
> committed + testnet-applied H3-1 (`afe0c6d`: migration 021 ownership FK + 022 S1a detection + worker W1).
>
> **Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.** H3-2 is what makes **1/5 complete**
> (see §7) — **but scoping does NOT advance progress**; 1/5 closes only after the full execution sequence lands (§7/§9).
>
> **Rev 2 (2026-07-12): Codex CHANGES 1-10 applied.** Sharpened the close condition (credential-ROW isolation only, NOT
> mainnet secret custody); reworded Option 1 as a **testnet-only shortcut** (never mainnet, not Vault-secret-blast-radius
> proof); added an explicit **preflight discovery** (§1a) with exact read-only checks + a `vault_secret_id` **fingerprint**
> (never the value); pinned the **backfill artifact** shape (one reviewed packet, INSERT 4 / UPDATE 4 / keep 1, PRE/POST);
> made **migration 023** explicit (no CONCURRENTLY-in-txn, PRE 0-sharing, POST, tracking-after-read-backs); added a
> **negative test plan**, **operator_status/Harness validation**, expanded **stop conditions**, and clarified progress.

## 0. Reading guide — buckets
- **[FACT]** verified (repo / migration / live read-back). **[PROPOSAL]** proposed here (not built). **[UNKNOWN/DECISION]**
  open for Codex/Oren.

## 1. Current state (CONFIRMED — post-H3-1, live read-backs 2026-07-12)
- **[FACT] I2/I3 enforced:** migration 021 composite ownership FK live (`bots(credential_id,user_id) → uec(id,user_id) ON
  DELETE RESTRICT`); worker W1 fail-closed deployed; env guard pre-existing. Cross-user = 0.
- **[FACT] I1 NOT enforced:** all **5 live testnet bots share ONE credential** `2b5c038a-a4a7-4be5-b2fe-90d32f67781b`
  (single user, `exchange_environment='testnet'`). `operator_status` (022) reports each bot `credential_shared=true,
  shared_with_count=4`.
- **[FACT] One Vault secret:** the shared credential's `vault_secret_id` points at the single testnet Binance key
  (per `praxis-secret-topology`; the value lives only in Vault — Claude never handles it). **S1b (single-use index) is
  NOT applied.** All 5 bots `trading_enabled=false` (disarmed), `QUEUE_ENABLED` off.
- **[FACT] Constraints in play:** `user_exchange_credentials` has `UNIQUE (user_id, exchange_id, label)` → **new per-bot
  rows for the same user+exchange MUST have distinct `label`s**. No unique on `vault_secret_id` (a Vault pointer may be
  referenced by >1 credential row).

## 1a. Preflight discovery (READ-ONLY — exact checks, run before authoring the backfill) [CHANGE 3]
All read-only; **`vault_secret_id` shown as a FINGERPRINT only, never the value.** (`SHARED_CRED` =
`2b5c038a-a4a7-4be5-b2fe-90d32f67781b`; `NEW_LABELS` = the 4 proposed per-bot labels, §4.)
```sql
with cred as (select * from public.user_exchange_credentials where id = 'SHARED_CRED')
select jsonb_pretty(jsonb_build_object(
  -- (a) the 5 bot ids/pairs currently on the shared credential
  'bots_on_shared', (select jsonb_agg(jsonb_build_object('bot_id', id, 'trading_pair', trading_pair,
        'status', status, 'trading_enabled', trading_enabled) order by trading_pair)
     from public.bots where credential_id = 'SHARED_CRED' and deleted_at is null),
  'count_on_shared', (select count(*) from public.bots where credential_id = 'SHARED_CRED' and deleted_at is null),
  -- (b) all live bots disarmed
  'all_disarmed', (select bool_and(trading_enabled = false) from public.bots where deleted_at is null),
  'any_enabled_bot', (select count(*) from public.bots where trading_enabled = true and deleted_at is null),
  -- (c) testnet only + (d) single user + (e) 0 cross-user
  'shared_cred_env', (select exchange_environment from cred),
  'distinct_bot_owners', (select count(distinct user_id) from public.bots where deleted_at is null),
  'cross_user', (select count(*) from public.bots b
                   join public.user_exchange_credentials c on c.id = b.credential_id
                   where b.deleted_at is null and c.user_id <> b.user_id),
  -- (f) current credential FINGERPRINT (status/env + vault pointer fingerprint — NOT the value)
  'shared_cred_fp', (select jsonb_build_object('id', id, 'status', status, 'exchange_environment', exchange_environment,
        'label', label, 'vault_secret_id_fp', substr(md5(vault_secret_id), 1, 12)) from cred),
  -- (g) proposed new labels do NOT collide with UNIQUE(user_id, exchange_id, label)
  'label_collisions', (select count(*) from public.user_exchange_credentials
        where user_id = (select user_id from cred) and exchange_id = (select exchange_id from cred)
          and label in ( /* NEW_LABELS */ 'h3-2-btc','h3-2-eth','h3-2-sol','h3-2-xrp' ))
)) as preflight;
-- Expect: count_on_shared=5; all_disarmed=true; any_enabled_bot=0; shared_cred_env='testnet';
--         distinct_bot_owners=1; cross_user=0; shared_cred_fp.status='valid'; label_collisions=0.
```
**If any expectation fails → STOP** (do not author/run the backfill). The `vault_secret_id_fp` (a 12-char md5 prefix)
lets us confirm all rows reference the same testnet pointer **without printing it**.

## 2. The no-sharing design (split/backfill → then enforce)
**Goal:** make every live bot reference its **own** credential row, so `credential_id` is single-use → S1b can be enforced
and a KP5 reversible lock (`status='invalid'`) affects exactly one bot.

**[PROPOSAL] Recommended split (minimal churn — "keep 1, add 4"):**
- Keep **one** bot on the existing credential `2b5c038a…` (optionally relabel it to that bot).
- Provision **4 new per-bot credential rows** (one per remaining bot): same `user_id`, same `exchange_id` (binance),
  `exchange_environment='testnet'`, **distinct `label`** (e.g. per-bot), a `vault_secret_id` (see §3), `status` per §3.
- **Repoint** each of those 4 bots' `bots.credential_id` to its new row (the composite FK passes — same user).
- **Result:** 5 credentials, each referenced by **exactly one** live bot → `shared_with_count=0` for all → S1b enforceable.
- **Alternative (uniform):** create **5** new per-bot rows, repoint all 5, then **soft-delete** the old `2b5c038a…` row
  (now referenced by 0 live bots; never `delete_vault_secret`). More churn + an orphaned row; pick in review.

**Ordering (hard):** provision rows → repoint bots → **verify 0 sharing (read-back)** → **only then** apply S1b (§4). S1b
must never be applied while any credential is shared by >1 live bot.

## 2a. Backfill artifact — precise shape [CHANGE 4]
- **ONE reviewed SQL packet** (`docs/sql/h3-2-backfill.sql`, operator-run — DATA mutation, A2-artifact discipline; **never
  `db push`**), **transaction-wrapped** (any guard RAISE ⇒ whole thing ROLLS BACK).
- **PRE-guards (fail-closed):** exactly 5 live bots on `SHARED_CRED`; all `trading_enabled=false`; env=testnet; single
  user; cross_user=0; the 4 `NEW_LABELS` do not collide (`UNIQUE(user_id, exchange_id, label)`); `SHARED_CRED.status='valid'`.
- **INSERT — exactly 4 new credential rows** (one per the 4 bots being moved): `user_id` = the shared cred's owner,
  `exchange_id` = binance, `exchange_environment='testnet'`, **distinct `label`** (a `NEW_LABEL`), `vault_secret_id` = §3
  choice (Option 1: the shared pointer; Option 2: 4 new pointers), `status='valid'` (Option 1) / `'pending_validation'`
  (Option 2). Capture the 4 new ids.
- **UPDATE — exactly 4 bot rows:** repoint each of 4 bots' `credential_id` to its new row (the composite FK passes — same
  user). **Leave the 5th bot on `SHARED_CRED`** (now single-use). Guard: `UPDATE … WHERE id = <bot> AND credential_id =
  'SHARED_CRED'`; assert exactly 4 rows updated total.
- **POST-verify (same txn; RAISE ⇒ ROLLBACK):**
  - **5 live bots** total (unchanged count); **5 distinct `credential_id`** across them; **same user**; **all testnet**;
    **all `trading_enabled=false`**; and (computed) **`credential_shared=false` / `shared_with_count=0`** for all 5.
- **Rollback packet** (`docs/sql/h3-2-backfill-rollback.sql`, txn-wrapped): **if S1b already applied, drop it FIRST** (see
  §5d) — then `UPDATE` the 4 bots' `credential_id` back to `SHARED_CRED`, `DELETE` (or soft-delete) the 4 new credential
  rows. POST-verify: 5 bots back on `SHARED_CRED`, the 4 new rows gone/soft-deleted. **Never `delete_vault_secret`.**

## 3. Vault secret handling — testnet duplicate vs distinct secrets [DECISION]
The split needs a `vault_secret_id` for each new row. Two options:
- **[PROPOSAL, RECOMMENDED for testnet — SHORTCUT] Option 1 — duplicate the existing pointer.** All new rows reference the
  **same** `vault_secret_id` as `2b5c038a…` (the already-proven testnet key), `status='valid'` (reuses a validated key, so
  `credential_ok`/`execution_ready` shape is unchanged; bots stay disarmed regardless). **Reuse of one `vault_secret_id` is
  a TESTNET-ONLY SHORTCUT** — described precisely as:
  - ✅ **Acceptable for testnet H3-2** — because the KP5 kill uses the **credential ROW status** (`status='invalid'`), which
    is now **per-bot** after the split, so the reversible-LOCK blast radius is per-bot.
  - ❌ **NOT acceptable for mainnet.**
  - ❌ **NOT proof of Vault-secret blast-radius isolation** — the underlying Vault **secret** is still shared across the 5
    rows; an (out-of-scope) `delete_vault_secret` would still destroy it for all 5. Option 1 proves credential-**row**
    isolation, **not** secret-custody isolation.
  - ❌ **Must NEVER be carried into A4 / mainnet** — A4 provisions **distinct per-bot mainnet keys + Vault secrets** from
    creation; no shared mainnet `vault_secret_id` ever.
- **[PROPOSAL] Option 2 — distinct testnet secrets.** Operator provisions 5 **new** testnet Binance keys → 5 Vault secrets
  → each row its own `vault_secret_id` (`status='pending_validation'` → read-only validate → `valid`, per A4 discipline).
  Full custody isolation incl. Vault; costs operator 5 testnet key creations. Overkill for testnet (no real funds), but a
  fuller end-to-end proof.
- **[DECISION for Codex/Oren]** Recommend **Option 1 for testnet** (prove the isolation MODEL + enforce S1b now, cheap),
  **explicitly documented** that **mainnet REQUIRES distinct per-bot Vault secrets (A4 provisions them per bot from
  creation)** — no shared mainnet secret ever. Optionally adopt Option 2 on testnet if a full custody-proof is wanted.
- **[Secret safety, both options]** Claude never handles a secret **value**; the operator does all Vault/secret entry. For
  Option 1 the operator reuses the existing (testnet) `vault_secret_id` pointer — a non-secret id (testnet). Mainnet
  `vault_secret_id` values remain sensitive (A4 §0a).
- **[PROPOSAL, optional follow-up] Shared-secret detection:** S1a detects shared `credential_id` (rows), not shared
  `vault_secret_id`. If we want to catch Option-1's shared-secret shortcut before mainnet, add an optional detection for
  rows sharing a `vault_secret_id` (a mainnet NO-GO). Not required to close 1/5; note for A4.

## 4. S1b enforcement — migration 023 (only after §2 backfill verified 0 sharing) [CHANGE 5]
- **[PROPOSAL] Migration 023** — transaction-wrapped; **plain `create unique index` (NOT `CONCURRENTLY`)** — CONCURRENTLY
  cannot run inside a transaction, and our surgical applies are txn-wrapped; the testnet `bots` table is tiny so the brief
  lock is negligible (revisit CONCURRENTLY-outside-txn only for a larger/mainnet table):
  ```sql
  begin;
  -- PRE-guard (fail-closed): MUST assert 0 live shared credential_id before creating the unique index.
  do $$ begin
    if exists (select 1 from public.bots where credential_id is not null and deleted_at is null
               group by credential_id having count(*) > 1) then
      raise exception 'H3-2 S1b PRE: a credential is still shared by >1 live bot — backfill first';
    end if;
  end $$;
  -- create the partial unique index on LIVE bot credential usage (soft-deleted + NULL exempt)
  create unique index bots_credential_single_use_uidx
    on public.bots (credential_id)
    where credential_id is not null and deleted_at is null;
  -- POST-guard: index exists, is unique + partial (⇒ duplicate live credential usage is now impossible)
  do $$ begin
    if not exists (select 1 from pg_indexes where schemaname='public' and tablename='bots'
                   and indexname='bots_credential_single_use_uidx') then
      raise exception 'H3-2 S1b POST: index not created';
    end if;
    if not exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
                   where c.relname='bots_credential_single_use_uidx' and i.indisunique and i.indpred is not null) then
      raise exception 'H3-2 S1b POST: index not unique+partial';
    end if;
    raise notice 'H3-2 S1b OK: single-use partial unique index enforced.';
  end $$;
  commit;
  ```
- **Tracking:** add `023 bots_credential_single_use_index` to `supabase_migrations.schema_migrations` via a reviewed
  metadata-only insert **only after apply + read-backs PASS** → then `supabase migration list --linked` = **Local ==
  Remote / nothing pending**. (The §2a backfill artifact is DATA, not a tracked migration.)

## 5. Operator-run steps · read-backs · tests · rollback
### 5a. Sequence (each Codex-reviewed; operator runs mutations; Claude read-backs only; never `db push`)
1. **Discovery re-confirm (Claude read-only):** 5 bots on 1 credential, cross_user=0, disarmed, bot-state hash baseline.
2. **Provision + repoint (operator-run reviewed artifact — DATA, like the A2 artifact):** insert the new per-bot
   credential rows (distinct labels; §3 vault_secret_id + status) → repoint each bot's `credential_id`. Transaction-wrapped,
   PRE/POST-guarded.
3. **Read-back (Claude):** each of the 5 live bots has a **distinct** `credential_id`; `operator_status` shows all 5
   `credential_shared=false, shared_with_count=0`; **bot count still 5, none disabled, none armed** (`trading_enabled`
   unchanged); bot-state hash changed **only** in the `credential_id` component (expected — that's the backfill), all
   `status`/`trading_enabled` unchanged.
4. **Apply S1b (operator runs migration 023):** PRE-guard (0 sharing) → create index → POST-verify.
5. **Read-back (Claude):** index present/unique/partial; a would-be duplicate is rejected (proven by the LOCAL fixture,
   §5c — not by mutating linked).
6. **Metadata tracking:** add `023` to `supabase_migrations.schema_migrations` (reviewed metadata-only, after read-backs
   PASS) → `migration list --linked` Local==Remote. (The backfill artifact is data, not a tracked migration.)
7. **operator_status / Ops Harness validation (after backfill + 023) [CHANGE 7]:** Action-D-style, read-only —
   - **Data-equivalent (Claude read-only):** all 5 live bots → `credential_shared=false`, `shared_with_count=0`.
   - **Browser / Ops Harness (operator, operator-JWT):** **no credential-sharing advisory** (the `credential sharing
     (advisory)` item clears to **`ok`**); the runtime `operator_status()` path shows all 5 bots `credential_shared=false`
     / `shared_with_count=0`; **preflight remains PASS**; **kill flag OFF** (button absent); **no `vault_secret_id`
     visible** anywhere.
   - *(Optional, separately approved) isolation smoke:* LOCK one bot's credential (`status='invalid'`) on testnet → only
     that bot's `credential_ok=false`, others unaffected → revert. **No kill, no order, no secrets.** Not required to close
     S1b.

### 5b. Read-backs (read-only, Claude)
- Post-backfill: distinct `credential_id` per bot; `shared_with_count=0` ×5; 5 live bots; disarmed; hash delta = credential
  repoint only.
- Post-S1b: `bots_credential_single_use_uidx` exists, `indisunique=true`, partial predicate correct; tracking has `023`;
  `migration list --linked` Local==Remote.

### 5c. Test plan — including NEGATIVE cases (LOCAL fixtures, authored before apply — like 021/022) [CHANGE 6]
- **NEGATIVE (before backfill): S1b fixture ABORTS on duplicate.** Seed 5 live bots on one credential, then attempt to
  create the S1b index → **fails** (`unique … violated` / the PRE-guard raises). Proves S1b cannot be applied over sharing.
- **POSITIVE (after backfill): S1b PASSES.** Seed the post-backfill state (5 bots, 5 distinct creds) → create S1b index →
  succeeds; POST-guard confirms unique+partial.
- **NEGATIVE (post-S1b): two live bots on one credential → REJECTED.** With the index live, `UPDATE`/`INSERT` making a
  second **live** bot reference an already-used `credential_id` → **rejected** (`unique_violation`).
- **Soft-deleted does not count:** a soft-deleted bot referencing the same `credential_id` as a live bot → **allowed**
  (predicate `deleted_at IS NULL` excludes it); repoint/rotation history never trips S1b.
- **NULL credential_id remains allowed:** multiple live bots with `credential_id = NULL` → **allowed** (partial index
  exempts NULL) — **retained because the product currently permits uncredentialed bots** (worker fail-closes at execution,
  ENG-007). If Codex decides uncredentialed bots should be disallowed, that's a separate change (out of H3-2).
- **Backfill fixture:** seed 5 bots on 1 credential → run the §2a split logic → assert 5 distinct credential_ids, 0
  sharing, 5 bots retained, all `trading_enabled=false`.
- **Isolation proof (LOCAL):** two bots, distinct creds → LOCK one (`status='invalid'`) → the other's `credential_ok`
  unaffected → revert.
- Existing worker jest 412 / frontend vitest 87 unaffected (H3-2 adds **no** worker/frontend code — DB-only).

### 5d. Rollback (reversible; order matters because of S1b)
1. **Drop S1b first:** `drop index if exists public.bots_credential_single_use_uidx;` (else repointing back would violate it).
2. **Un-backfill:** repoint the 4 (or 5) bots back to `2b5c038a…`; soft-delete/remove the new per-bot rows (data revert).
3. **Tracking:** `delete from supabase_migrations.schema_migrations where version='023'` — only if reverting 023, metadata
   only.
- **Never `delete_vault_secret`** in any rollback (out of scope; the shared testnet key stays).

## 6. Stop conditions (hard) [CHANGE 8]
- **Any enabled bot** (`trading_enabled=true` on any live bot) → STOP (must be fully disarmed before backfill/S1b).
- **Any mainnet credential** present/involved → STOP (H3-2 is testnet-only; mainnet isolation is A4).
- **Any label collision** with `UNIQUE(user_id, exchange_id, label)` → STOP (pick non-colliding `NEW_LABELS`).
- **Any missing rollback path** (backfill or S1b step without its reviewed rollback) → STOP.
- **Any plan to print a real `vault_secret_id` value** → STOP (fingerprint only; never the value).
- **Any `delete_vault_secret`** (out of H3 scope) → STOP.
- **Any `db push`** or **`CREATE INDEX CONCURRENTLY` inside a transaction** → STOP.
- **Any order / kill / arm** → STOP.
- **Any attempt to use the testnet duplicate-`vault_secret_id` shortcut for MAINNET** → STOP (A4 provisions distinct
  per-bot secrets; the shortcut is testnet-only).
- **S1b applied while any credential is shared by >1 live bot** → STOP (verify 0 sharing; the PRE-guard enforces it).
- **Do NOT orphan or disable a bot** during backfill; repoint carefully; keep all 5 live + disarmed.
- **Real funds remain NO-GO.**

## 7. What closes 1/5 — and what remains for 2/5 [CHANGES 1, 9]
### H3-2 closes `1/5 Credential isolation` ONLY for (be precise):
- **credential-ROW isolation** — each live bot has its own credential row;
- **ownership enforcement** — I2 (021 composite FK + worker W1);
- **S1b — no shared `bots.credential_id`** among live bots (partial unique index);
- **reversible per-bot LOCK blast radius** — KP5 `status='invalid'` affects exactly one bot.

### It does NOT close:
- **mainnet secret-custody isolation** — if the testnet shortcut (Option 1) reuses one `vault_secret_id`, the Vault
  **secret** is still shared. **Mainnet still requires A4 distinct per-bot secrets.** The A8-H3 gate governs credential-ROW
  blast radius + ownership, NOT Vault-secret custody — so 1/5 can close with the Option-1 caveat, but **A4 (3/5) is where
  distinct per-bot mainnet secrets are provisioned; the shortcut is never carried forward.**

### Remains for later steps (not 1/5):
- **2/5 — A1 static egress** (provider decision + egress proof) — separate; unblocked in parallel.
- **3/5 — A4 mainnet credentials** — distinct per-bot mainnet keys/secrets; rides on the now-enforced isolation model.
- **4/5 live fail-closed + TradingView**, **5/5 A11 + tiny live run** — unchanged.

### Progress — scoping does NOT advance it [CHANGE 9]
This packet is **scoping only** → **Progress stays 0/5**. **1/5 closes ONLY after ALL of:**
1. **H3-2 backfill applied** (per-bot rows + repoint, 0 sharing verified);
2. **023 (S1b) applied**;
3. **023 tracked** in `supabase_migrations.schema_migrations`;
4. **linked read-backs PASS** (distinct creds, `shared_with_count=0` ×5, index unique+partial, `migration list --linked`
   Local == Remote);
5. **browser / Ops Harness validation PASS** (no sharing advisory, preflight PASS, kill flag OFF, no `vault_secret_id`
   visible);
6. **closeout docs committed + pushed.**
Until all six land, **1/5 remains open**. **Real funds remain NO-GO.**

---
**Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.** *(Scoping only — no progress advance;
1/5 closes after the §7 six-condition execution sequence.)*
