# A8-H3 Slice H3-1 — Ownership guard + worker fail-closed + sharing detection (IMPLEMENTATION PACKET)

> **DOC / PLANNING — NO CODE, NO MIGRATION, NO APPLY.** No DB mutation · no `db push` · no deploy · no Railway/Doppler ·
> no secrets · no mainnet / no real funds. **Real funds remain NO-GO.** Uncommitted draft for Codex review. Implements
> **Slice H3-1** of `production-a8-h3-kp5-credential-isolation-implementation-plan.md` (PASS): **S2** ownership guard +
> **W1** worker fail-closed ownership check + **S1a** shared-credential detection/reporting. **S1b (single-use index) is
> NOT in this slice** (blocked on the shared testnet credential — that is H3-2). Grounded in live catalog reads
> (2026-07-10).

> **Rev 3 (2026-07-10): Codex CHANGES applied.** Replaced the 10-step tracker with the **5-step production path** (planning
> is NOT counted as production completion); H3-1 technical content unchanged (H3-1a migration 021 · H3-1b worker W1 ·
> H3-1c migration 022/S1a + frontend · H3-1d local validation).
> **Rev 2 (2026-07-10): Codex CHANGES 1-10 applied.** Split H3-1 into code slices **H3-1a..d**; made explicit the
> nullable-`credential_id` FK behavior, the `unique (id, user_id)` safety, the exact W1 audit/log fields, the
> reconciliation fail-closed behavior (grounded), the S1a JSON shape + null/soft-delete semantics; implementation order +
> timebox.

## Production path (5 steps — planning is NOT counted as production completion)
1. **1/5 — Credential isolation (A8-H3): CURRENT**
2. **2/5 — Static egress / IP allowlist (A1)**
3. **3/5 — Mainnet credentials (A4)**
4. **4/5 — Live fail-closed + TradingView production path**
5. **5/5 — A11 + tiny controlled live run**

**Already done, NOT counted toward the 5 (foundations):** A2 migration reconcile · A8-H2 audited kill · Ops Harness ·
token rotations · rate limit · webhook hasher · testnet positive path.

**Progress: 0/5 complete** · **Current: 1/5 — Credential isolation** · **Remaining: 5/5 until production live.**
- **Do NOT overcount planning as production completion.** This packet (and the A1/A4/H3 plans) are **planning** — they do
  not advance the 0/5.
- **After H3-1 is implemented + LOCAL-validated + linked-applied:** still **0/5 complete** — it becomes **Current: 1/5
  partially complete** (S2/W1/S1a live), and **1/5 closes only when the FULL credential-isolation gate is closed**, i.e.
  H3-2 (no-sharing / per-bot credentials + S1b) is also done. *Every future H3 update repeats this `Progress: 0/5` /
  `Current:` / `Remaining:` block.*

## 0. Verified live facts this packet is keyed to (read-only, 2026-07-10)
- **[FACT] Exact FK to replace:** `bots_credential_id_fkey` = `FOREIGN KEY (credential_id) REFERENCES
  user_exchange_credentials(id) ON DELETE RESTRICT` (confirmed via `pg_constraint`, not assumed).
- **[FACT] `user_exchange_credentials` uniques today:** PK `user_exchange_credentials_pkey (id)` +
  `credentials_user_exchange_label_unique (user_id, exchange_id, label)`. **No `(id, user_id)` unique exists**
  (`has_id_user_unique=false`) → S2 must add one to be FK-referenceable.
- **[FACT] `idx_bots_credential_id`** is a **non-unique** btree on `bots(credential_id)`.
- **[FACT] Discovery (from H3-1 plan §5, 2026-07-10):** 5 live bots, **0 cross-user (I2 clean)**, **0 null-env**, 0
  mainnet; single 5-way testnet share (I1 — deferred to H3-2). So **S2 validates cleanly on current data**.
- **[FACT] `operator_status()` current body = migration `020`** (per-bot `id/trading_pair/bot_status/trading_enabled/
  sizing_mode/exchange_environment/credential_status/credential_ok/config_ready/execution_ready`; `enabled_bots/
  open_trades/dlq/open_recon/queue_length/kill_rpc_present/worker_status`). SECURITY DEFINER, `search_path=''`,
  authenticated-only + in-body `is_operator` gate.
- **[FACT] Worker credential resolution:** `index.ts:754-758` selects `vault_secret_id, status, deleted_at,
  exchange_environment` (NOT `user_id`); gate `:774-783`; adapter built `:872`; **no ownership check today**. `bot.user_id`
  available (`:632`). Second site: `reconciliation.ts:232-246`.

---

## 1. Exact migration plan
**Two single-purpose, transaction-wrapped, surgical migrations (never `db push`); each LOCAL-tested then operator-run
linked + read-back + tracked (A2 reconcile done → 021/022 track cleanly).** Split so each has one blast radius + its own
rollback. *(Codex may merge; recommend split.)*

### Migration 021 — S2 ownership guard (schema)
```sql
begin;

-- PRE-GUARD (fail-closed): abort unless ownership is already clean (I2 = 0 cross-user) and the exact FK exists.
do $$
begin
  if exists (
    select 1 from public.bots b
    join public.user_exchange_credentials c on c.id = b.credential_id
    where b.deleted_at is null and c.user_id <> b.user_id
  ) then
    raise exception 'H3-1 S2 PRE: cross-user credential reference exists — resolve before enforcing ownership';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bots'::regclass and contype='f' and conname='bots_credential_id_fkey'
  ) then
    raise exception 'H3-1 S2 PRE: expected FK bots_credential_id_fkey not found (verify live name)';
  end if;
end $$;

-- 1) supporting unique so (id, user_id) is FK-referenceable (id is PK ⇒ trivially unique, but the composite FK
--    REQUIRES an explicit unique on exactly these columns):
alter table public.user_exchange_credentials
  add constraint uec_id_user_key unique (id, user_id);

-- 2) replace the single-col FK with the ownership-composite FK (preserves ON DELETE RESTRICT; credential_id stays
--    nullable — MATCH SIMPLE ⇒ a NULL credential_id row is exempt):
alter table public.bots
  drop constraint bots_credential_id_fkey,
  add  constraint bots_credential_owner_fkey
    foreign key (credential_id, user_id)
    references public.user_exchange_credentials (id, user_id) on delete restrict;

-- POST-VERIFY (same txn; RAISE ⇒ ROLLBACK):
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid='public.bots'::regclass and conname='bots_credential_owner_fkey' and contype='f') then
    raise exception 'H3-1 S2 POST: ownership FK not created';
  end if;
  if exists (select 1 from pg_constraint
             where conrelid='public.bots'::regclass and conname='bots_credential_id_fkey') then
    raise exception 'H3-1 S2 POST: old single-col FK still present';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid='public.user_exchange_credentials'::regclass and conname='uec_id_user_key' and contype='u') then
    raise exception 'H3-1 S2 POST: supporting unique missing';
  end if;
end $$;

commit;
```
- **Alternative S2′ (trigger)** — if Codex prefers not to alter FK topology: a `BEFORE INSERT/UPDATE OF credential_id,
  user_id ON public.bots` trigger raising unless the referenced credential's `user_id = NEW.user_id`. Same guarantee,
  more procedural, no `uec_id_user_key`. **Recommend S2 (declarative FK).**
- **No `db push`; no `CREATE INDEX`** here (no S1b) → no CONCURRENTLY/txn conflict. On 5 rows the FK re-validate is trivial.

#### [CHANGE 3] Nullable `credential_id` behavior (explicit)
- **NULL `credential_id` remains ALLOWED.** The composite FK uses the default **`MATCH SIMPLE`**: if **any** referencing
  column is NULL, the FK is **not enforced** for that row. `credential_id` is nullable; `user_id` is NOT NULL — so a bot
  with `credential_id IS NULL` (uncredentialed) always passes the FK.
- **The ownership FK applies ONLY when `credential_id` is non-null** — then both columns are non-null and the pair
  `(credential_id, user_id)` must exist in `user_exchange_credentials(id, user_id)` (⇒ `cred.user_id = bot.user_id`).
- **The worker still FAILS CLOSED when a bot that needs execution has a null credential** — unchanged existing gate
  `index.ts:663-669` (`credential_id` null → `disableBotMisconfigured(..., 'credential_id_null')`, no order). The FK
  permits null at the DB layer; the worker refuses to trade a null-credential bot. Both are correct and complementary.

#### [CHANGE 4] `unique (id, user_id)` safety
- **Why it's valid despite `id` already being PK:** a UNIQUE constraint on a **superset** of a primary key is always
  valid — `id` alone is unique, so `(id, user_id)` is trivially unique too (never a duplicate). Postgres requires the FK's
  referenced columns to carry their **own** unique/PK constraint on **exactly** that column list, so the PK on `id` alone
  does **not** satisfy an FK on `(id, user_id)` — hence the explicit `uec_id_user_key`.
- **Named explicitly:** yes — `uec_id_user_key` (do not rely on an auto-generated name; needed for a clean rollback DROP).
- **Rollback impact:** dropping `uec_id_user_key` is safe **only after** the composite FK that references it is dropped
  first (a referenced unique can't be dropped while an FK depends on it) — rollback order = drop FK → re-add old FK →
  drop `uec_id_user_key` (see §7).
- **Pre/post verification (read-only):**
  ```sql
  -- PRE (expect has_pair=false): the (id,user_id) unique does not yet exist
  select exists (select 1 from pg_constraint
    where conrelid='public.user_exchange_credentials'::regclass and contype='u'
      and conkey = array[
        (select attnum from pg_attribute where attrelid='public.user_exchange_credentials'::regclass and attname='id'),
        (select attnum from pg_attribute where attrelid='public.user_exchange_credentials'::regclass and attname='user_id')
      ]) as has_pair;
  -- POST (expect uec_id_user_key present + bots_credential_owner_fkey present + bots_credential_id_fkey absent)
  select conname, pg_get_constraintdef(oid) from pg_constraint
   where conrelid in ('public.bots'::regclass,'public.user_exchange_credentials'::regclass)
     and conname in ('uec_id_user_key','bots_credential_owner_fkey','bots_credential_id_fkey');
  ```

### Migration 022 — S1a operator_status `credential_shared` (read-surface, `CREATE OR REPLACE`, mirrors 020's pattern)
- `CREATE OR REPLACE public.operator_status()` = **the exact 020 body** + **one additive non-secret per-bot field**
  inside the `jsonb_agg`:
  ```sql
  'credential_shared',
    (b.credential_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.bots b2
       WHERE b2.credential_id = b.credential_id AND b2.deleted_at IS NULL AND b2.id <> b.id)),
  -- optional companion:
  'shared_with_count',
    (SELECT count(*) FROM public.bots b2
       WHERE b2.credential_id = b.credential_id AND b2.deleted_at IS NULL AND b2.id <> b.id),
  ```
- **Everything else preserved verbatim** (authz, grants `REVOKE ALL … GRANT authenticated`, all existing fields, deny-
  by-default, `search_path=''`). Catalog/count only — **no vault pointers, keys, or secret values.** Update the function
  COMMENT to list the added field.

---

## 2. Exact worker code touchpoints (W1 — fail-closed ownership)
> **Exact behavior (from H3-1 plan §7): on `cred.user_id !== bot.user_id` → NO decrypt · NO adapter · disable ONLY this
> bot · no-secret audit · NO Vault delete · ack.**
1. **`worker/src/index.ts:754-758`** — extend the credential select to include `user_id`:
   `.select('vault_secret_id, status, deleted_at, exchange_environment')` → `', user_id'`.
2. **Credential row type** (the local `cred` shape near `index.ts:249`) — add `user_id: string`.
3. **New guard, AFTER the credential status/deleted gate (`:774-783`) and BEFORE the adapter build (`:857-872`)** —
   assert ownership; on mismatch:
   ```ts
   if (cred.user_id !== bot.user_id) {
     await disableBotMisconfigured(supabase, bot, signal_id, 'credential_owner_mismatch')
     return { ack: true }   // no decrypt, no adapter, only this bot disabled
   }
   ```
   Reuses the existing `disableBotMisconfigured` path exactly like the sibling misconfig reasons.

**[CHANGE 5] Exact `credential_owner_mismatch` effect (grounded in `disableBotMisconfigured`, `index.ts:556-585`):**
- **Bot status/result:** **only the triggering bot** (`.eq('id', bot.id)`) is set to `status='error'`. The signal
  message is **acked** (`return { ack: true }`) — no requeue/poison loop. **No other bot is read or written.**
- **Audit event:** `insertAuditLog(supabase, 'bot', bot.id, 'bot.misconfigured', { status: <prior> }, { status: 'error',
  reason: 'credential_owner_mismatch' })` — action name **`bot.misconfigured`**, reason **`credential_owner_mismatch`**.
- **Console event:** `bot_misconfigured_credential` with `{ bot_id, signal_id, reason: 'credential_owner_mismatch' }`.
- **No secret fields:** the audit + logs carry **only ids + status + the reason string** — **never** `vault_secret_id`,
  the key, or any credential value. (The `cred.user_id`/`bot.user_id` are already non-secret owner UUIDs; recommend
  logging **only the reason**, not the two uuids, to keep the event minimal.)
- **No adapter creation, no decrypt:** the guard returns **before** `new BinanceAdapter(...)` (`:872`) and before any
  Vault call. **Never `delete_vault_secret`.**

**[CHANGE 6] Second resolution site — `reconciliation.ts` `defaultAdapterFor` (`:224-246`) — exact behavior (grounded):**
The reconciliation resolver already **fail-closes by returning `null`** for an invalid/deleted/malformed credential (→
the batch loop **leaves the trade `pending`**, makes **no exchange call**, and moves on; the resolver *never* calls
`createOrder`). W1 there is the **same shape**:
- Add `user_id` to its credential select (`.select('vault_secret_id, status, deleted_at')` → add `, user_id`).
- **On `cred.user_id !== bot_user_id` → `return null`** — identical to the existing invalid-credential fail-close:
  - **no exchange call · no credential decrypt · no adapter · no Vault delete.**
  - the trade is **left `pending`** (safe retry on a later boot) — **no new/`failed` status is invented**; this matches
    the existing `reconciliation_jobs` model (null adapter ⇒ job stays pending; there is already a `job_failed_auth`
    action for credential problems, trade untouched). **No other bot is changed.**
  - *(Note: `defaultAdapterFor` currently selects `bot.credential_id` only — the bot's `user_id` must be added to that
    select too, or passed in, so the comparison is available. Small, local.)*
  - optional: emit a **no-secret** `reconciliation_owner_mismatch` log `{ trade_id, bot_id }` (no uuids-of-owner needed).
- **[RESOLVED — not open]** the reconciliation status model was grounded (read `reconciliation.ts:36-45, 224-246`): the
  `return null` fail-closed path is the correct, existing-model-consistent behavior; **no code beyond adding `user_id` +
  the null-return is required.**

**Recommend** factoring the comparison into one shared helper `assertCredentialOwnership(botUserId, credUserId): boolean`
so the `index.ts` (disable-bot) and `reconciliation.ts` (return-null) sites share one predicate and can't drift.

- **No change to the env guard** (`assertExchangeEnvironment`, `:861`) or any other gate. W1 is purely additive and
  fail-closed; current data (0 cross-user) means it changes no existing valid behavior.

## 3. `operator_status` / Ops Harness detection surface (S1a)
- **DB:** migration 022 adds `credential_shared` (+ optional `shared_with_count`) per bot (§1).
- **Frontend types — `frontend/src/lib/status.ts`:** add `credential_shared: boolean` (and `shared_with_count?: number`)
  to `BotStatus`. Non-secret.
- **Ops Harness surface — `frontend/src/lib/harness.ts` / `HarnessPanel.tsx`:** surface per-bot `credential_shared`
  (e.g. a "shared credential" flag in the read-back/preflight). **[PROPOSAL]** `buildPreflight` may add an advisory item:
  *"credential sharing: N bot(s) share a credential"* — **advisory only** now (testnet is knowingly shared); it becomes a
  **hard NO-GO** for any **mainnet-bound** bot (per A4 §2a / §15). No enforcement in the UI.
- **Standing read-only detection query** (documented, operator-runnable any time — the H3-1 plan §5(a)):
  ```sql
  select credential_id, count(*) as live_bots
  from public.bots where credential_id is not null and deleted_at is null
  group by credential_id having count(*) > 1;
  ```

### [CHANGE 7] Exact S1a JSON shape + semantics
Per bot (added inside the existing `operator_status().bots[]` objects):
```jsonc
{
  // ...existing 020 fields (id, trading_pair, bot_status, ..., credential_ok, config_ready, execution_ready)...
  "credential_shared": false,   // boolean, NEVER null
  "shared_with_count": 0        // integer >= 0, count of OTHER live bots sharing this credential
}
```
- **`credential_shared`: `boolean` (never null)** — `true` iff `credential_id IS NOT NULL` **and** another **live** bot
  references the same `credential_id`; else `false`.
- **`shared_with_count`: `integer` ≥ 0** — number of **other** live bots sharing this `credential_id`.
- **Null credential ⇒ `false` / `0`** (NOT null): the `b.credential_id IS NOT NULL AND …` guard short-circuits and the
  count subquery matches 0 rows.
- **Soft-deleted bots do NOT count and are NOT listed:** the outer query filters `b.deleted_at IS NULL` (only live bots
  appear) and both the EXISTS + count filter `b2.deleted_at IS NULL`.
- **Self excluded** (`b2.id <> b.id`). **Non-secret** (boolean + count only).
- **S1a test cases (LOCAL, §4b):** (1) two live bots on one credential → each `true`/`1`. (2) single-use → `false`/`0`.
  (3) null-`credential_id` bot → `false`/`0` (not null). (4) a soft-deleted sharing peer is excluded → live bot's count
  decremented. (5) current live data (5 bots, 5-way share) → each `true`/`4`.

## Code slices (H3-1a..d) — for faster autonomous work [CHANGE 2]
> Authorable in parallel after Codex PASS; **all local (no linked apply/deploy)**. Recommended single combined commit
> (§Implementation order), but split here so work + review can proceed slice-by-slice.

### H3-1a — Migration 021 (S2 ownership FK) — DB, local-only
- **Files:** `supabase/migrations/021_bots_credential_owner_fk.sql` (the §1 021 SQL) · `supabase/tests/021_*.test.sql`.
- **Tests:** §4a (reject cross-user / allow matching / allow NULL / ON DELETE RESTRICT / constraints present).
- **Rollback:** §7 (drop composite FK → re-add single-col FK → drop `uec_id_user_key`).
- **Before linked apply?** **Yes** — authored + LOCAL-tested without touching the linked DB.

### H3-1b — Worker W1 ownership fail-closed — worker code
- **Files:** `worker/src/index.ts` (select `user_id`, ownership guard, §CHANGE 5) · `worker/src/reconciliation.ts`
  (`defaultAdapterFor` select `user_id` + return-null, §CHANGE 6) · a shared `assertCredentialOwnership` helper · the
  `cred`/`BotRow` types · `worker/src/*.test.ts` (vitest).
- **Tests:** §4c (mismatch → no order/decrypt/adapter, disable-only-this-bot, both sites; matching → unchanged).
- **Rollback:** revert the worker commit / redeploy prior image (DB FK still enforces ownership).
- **Before linked apply?** **Yes** — code + unit tests are local; **deploy** is the separate gated step.

### H3-1c — Migration 022 (S1a `operator_status`) + frontend/Harness surface
- **Files:** `supabase/migrations/022_operator_status_credential_shared.sql` (§1 022) · `supabase/tests/022_*.test.sql` ·
  `frontend/src/lib/status.ts` (`BotStatus.credential_shared/shared_with_count`) · `frontend/src/lib/harness.ts` /
  `HarnessPanel.tsx` (surface) · `frontend/src/**/*.test.ts(x)`.
- **Tests:** §4b (S1a JSON shape + null/soft-delete) · §4d (frontend type/surface; 84 existing still pass).
- **Rollback:** `CREATE OR REPLACE operator_status()` back to the exact 020 body; revert the frontend commit.
- **Before linked apply?** **Yes** — migration authored + LOCAL-tested; frontend fully local.

### H3-1d — Integration / local validation packet
- **Files:** a short `docs/…-h3-1-local-validation-results.md` capturing the LOCAL run evidence (Supabase local apply of
  021+022 + all fixtures green; worker + frontend typecheck+tests green).
- **Tests:** the aggregate of 4a-4d run against Supabase LOCAL.
- **Rollback:** n/a (doc).
- **Before linked apply?** **Yes** — it is the evidence gate **before** any linked apply/deploy is requested.

## 4. Tests
### 4a. LOCAL SQL — S2 (migration 021), pgTAP-style like `019`/`020` fixtures
- **Supporting unique exists** (`uec_id_user_key`); **old FK gone**, **new `bots_credential_owner_fkey` present with ON
  DELETE RESTRICT**.
- **Reject cross-user:** insert/update a bot whose `credential_id`'s `user_id` ≠ the bot's `user_id` → **FK violation**.
- **Allow matching owner:** same-owner reference → **succeeds**.
- **Allow NULL:** `credential_id = NULL` → **succeeds** (MATCH SIMPLE exemption), multiple allowed.
- **ON DELETE RESTRICT still holds:** deleting a credential referenced by a live bot → **rejected**.
### 4b. LOCAL SQL — S1a (migration 022)
- With an operator profile fixture (`is_operator=true`): `operator_status()` returns **`credential_shared=true`** for
  bots sharing a `credential_id`, **`false`** for a single-use one; `shared_with_count` correct.
- **Non-secret:** payload contains no `vault_secret_id`/key/token/secret field (regression vs the redaction rule).
- Deny path unchanged (non-operator → 42501).
### 4c. Worker unit (vitest) — W1
- **Ownership mismatch → fail-closed:** resolved `cred.user_id !== bot.user_id` ⇒ **no `createOrder`**, no adapter
  constructed, `disableBotMisconfigured(..., 'credential_owner_mismatch')` called, **no `delete_vault_secret`** — asserted
  at **both** `index.ts` and `reconciliation.ts` sites.
- **Matching owner → unchanged:** existing green-path tests still pass (0 regressions).
### 4d. Frontend (vitest) — S1a surface
- `status.ts` type + any `harness`/`HarnessPanel` rendering of `credential_shared`; existing 84 tests still pass.

## 5. Local validation plan
- **Supabase LOCAL** (OrbStack/Docker; `supabase start`) — apply `021` then `022` to the **local** DB only (never linked
  in this step); run 4a/4b SQL fixtures → all PASS.
- **Worker:** `npm run typecheck` + `vitest run` in `worker/` (W1 unit tests) → green.
- **Frontend:** `npm run typecheck` + `vitest run` in `frontend/` (S1a type/surface) → green (84 + new).
- Record the LOCAL pass evidence (no linked apply, no deploy) for Codex before any linked step.

## 6. Linked apply plan (gated — operator-run, after Codex PASS + LOCAL green)
1. **PITR/backup confirmed** by operator.
2. **021 (S2)** — operator runs `supabase db query --linked --file <021>` (PRE-guard re-checks 0 cross-user; POST-verify;
   **never `db push`**). Claude read-back: new FK present, old FK gone, `uec_id_user_key` present. Record `021` in
   `schema_migrations`.
3. **022 (S1a)** — operator runs `<022>`; Claude read-back: `operator_status()` returns `credential_shared`; grants
   intact; no secrets. Record `022`.
4. **Worker W1 deploy** — operator deploys the worker with the ownership check (Railway redeploy). Order-independent of
   021 given current data (0 cross-user), but recommend **021 → W1** so DB + worker enforce together.
5. Update the A2 migration ledger (021/022 tracked) — doc-only, after the linked applies.

## 7. Rollback
- **021 (S2):** reversible, **metadata/constraint only, no data change** — drop `bots_credential_owner_fkey`, re-add
  `bots_credential_id_fkey foreign key (credential_id) references user_exchange_credentials(id) on delete restrict`, drop
  `uec_id_user_key`. (Only safe because it touches constraints, not data.)
- **022 (S1a):** `CREATE OR REPLACE operator_status()` back to the **exact 020 body** (revert the added field).
- **W1:** revert the worker commit / redeploy the prior image. W1 is additive + fail-closed; reverting only removes the
  extra guard (DB FK still enforces ownership).

## 8. Stop conditions (hard)
- **Do NOT apply 021 if the PRE-guard finds any cross-user reference** (I2 > 0) — abort; investigate/backfill first.
- **Do NOT add S1b (single-use unique index) in this slice** — the testnet 5-way share still exists; S1b is H3-2 (after
  split/backfill). Applying it now would fail / force detaching live bots.
- **No `db push`; no `CREATE INDEX CONCURRENTLY` in a transaction.** Surgical, tracked applies only.
- **W1 must never `delete_vault_secret`, never touch another bot, never print a secret** (only `credential_owner_mismatch`
  + ids in the audit).
- **No mainnet, no arming** (`trading_enabled` untouched), **no secrets**, **no Railway/Doppler change** beyond the gated
  worker redeploy. **Real funds remain NO-GO.**

## 9. What can be implemented AFTER Codex PASS (each still separately gated)
- **Author migration `021`** (S2 ownership FK) + its LOCAL SQL test fixture.
- **Author migration `022`** (S1a `operator_status.credential_shared`) + its LOCAL SQL test fixture.
- **Author worker W1** (ownership fail-closed at both resolution sites, shared helper) + vitest unit tests.
- **Author frontend S1a surface** (`status.ts` type + `harness`/`HarnessPanel` display) + tests.
- **Run LOCAL validation** (§5) — Supabase local + worker/frontend typecheck+tests — and record evidence.
- **NOT after PASS (still gated):** any **linked** apply (operator-run, §6), any worker **deploy**, the A2 ledger update
  (doc-only, post-apply). **NOT in H3-1 at all:** S1b, testnet split/backfill, any mainnet/arming/Vault-delete.

## 10. Implementation order + timebox + scope [CHANGES 8, 9]
**[CHANGE 8] Order of implementation (preferred):**
- The autonomous implementation pass may produce the **whole H3-1 diff at once** (H3-1a migration 021 + H3-1b worker W1 +
  H3-1c migration 022/S1a + frontend surface + all LOCAL tests) → **run LOCAL validation (H3-1d)** → **commit after Codex
  PASS**.
- **Do NOT split commits unless needed** — one coherent H3-1 commit is preferred; the H3-1a..d slices are review/work
  units, not mandatory separate commits.
- **Linked apply + worker deploy are SEPARATE, operator-gated steps** (§6), performed **after** the commit + your go —
  never folded into the implementation pass.

**[CHANGE 9] Timebox (target):**
- **Implementation + LOCAL tests (H3-1a-d authored + green locally):** **same day — ~0.5-1.5 workdays.**
- **Linked validation (021+022 applied + read-backs + worker deploy):** **~0.5 day after PASS**, operator-gated.

**[CHANGE 10] Scope for THIS packet (explicit, unchanged):** **planning only for now · no code yet · no migration yet ·
no DB mutation · no linked apply · no deploy · no Railway/Doppler · no secrets · no mainnet / no real funds.** The
read-only catalog lookups (§0) were SELECT-only. **Real funds remain NO-GO.**

**Progress: 0/5 complete · Current: 1/5 — Credential isolation (this packet = planning, not completion) · Remaining: 5/5
until production live.**

---
**Net:** H3-1 lands **DB-enforced + worker-enforced ownership** (S2 + W1) and **makes sharing observable** (S1a) — all
safe on the current data (0 cross-user; testnet sharing stays visible, not yet blocked). It does **not** enforce single-use
(S1b/H3-2) and touches **no mainnet, no secrets, no arming**. Every code/migration artifact is authored + LOCAL-tested
after Codex PASS; **linked apply + deploy are separate operator-gated steps.** **Real funds remain NO-GO.**
