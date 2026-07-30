# A8-H3 / KP5 — Credential Blast-Radius Isolation (IMPLEMENTATION-READY PLAN)

> **DOC / PLANNING + read-only discovery — NOT EXECUTION.** No code · no migration · no DB mutation · no `db push` · no
> deploy · no Railway/Doppler change · no secrets · no mainnet / no real funds. **Real funds remain NO-GO.** Uncommitted
> draft for Codex/Oren review. Supersedes the design doc `production-a8-h3-kp5-credential-isolation-design.md` by
> grounding it in the **verified live schema + worker code** (two read-only exploration passes, 2026-07-10). Pairs with
> `production-a4-mainnet-credentials-architecture.md`.
>
> **Rev 2 (2026-07-10): Codex CHANGES 1-10 applied.** Isolation is now proven on **testnet first** (not skipped);
> single-use is split into **S1a (detect + hard NO-GO)** and **S1b (DB enforcement after split/backfill)**; **Path B is
> demoted to a temporary posture, not the recommendation**; the current testnet share is documented as **acceptable only
> under explicit conditions** (never normalized); implementation is framed as **Slice H3-1** (S2+W1+S1a+tests) then
> **Slice H3-2** (split/backfill → S1b); **Vault-delete is OUT OF SCOPE for H3** (reversible lock/disable only); and a
> hard **real-funds gate** is stated (§15). Discovery values in §5 are evidence, read-only.

---

## 0. Reading guide — four buckets (kept explicit throughout)
Every claim below is tagged:
- **[FACT]** = verified from the actual migrations / worker source (file:line cited).
- **[ASSUMPTION]** = carried from the prior design docs, **not** independently confirmed here.
- **[PROPOSAL]** = a change this plan proposes (not built).
- **[UNKNOWN]** = open question for Codex/Oren before implementation.

**Design-doc corrections surfaced by grounding (read these first):**
- The design doc referenced Vault fns `read_vault_secret` / `update_secret` — **[FACT] those names do not exist.** The
  real fns are **`get_decrypted_secret(secret_id uuid)`** (`004_vault_accessor_function.sql:11-25`) and
  **`delete_vault_secret(secret_id uuid)`** (`005_vault_delete_function.sql:28-41`), both SECURITY DEFINER,
  `search_path=''`, **service_role only**. Arg type is **`uuid`** though `vault_secret_id` is stored **`TEXT`** → callers cast.
- The design doc floated a `bot_id` column on credentials — **[FACT] ABSENT.** The link is one-directional:
  `bots.credential_id → user_exchange_credentials(id)`.
- The design/A4 docs speak of "a bot's `exchange_environment` must match its credential's" — **[FACT] `bots` has NO
  `exchange_environment` column.** Environment lives **only on the credential** (`user_exchange_credentials.exchange_environment`,
  added by `014_bot_sizing_risk.sql:58-60`). So the environment guard is **credential-env vs the worker's global
  `PRAXIS_IS_PRODUCTION`**, not a bot-vs-credential field comparison. The invariant is reframed accordingly (§3).
- **[FACT]** `deleted_at` **does** exist on both `user_exchange_credentials` (`001:164`) and `bots` (`001:197`) — so a
  partial-unique-on-live-rows approach is viable.

---

## 1. Current credential model (CONFIRMED from repo/schema)
- **[FACT] `user_exchange_credentials`** (`001_initial_schema.sql:153-168`): `id uuid PK`, `user_id uuid NOT NULL →
  auth.users ON DELETE RESTRICT`, `exchange_id uuid NOT NULL`, `vault_secret_id TEXT NOT NULL`, `label TEXT NOT NULL
  DEFAULT 'default'`, `status credential_status NOT NULL DEFAULT 'pending_validation'`, `deleted_at TIMESTAMPTZ` (nullable),
  `created_at/updated_at`. **Only uniqueness = `UNIQUE (user_id, exchange_id, label)`** (`001:166-167`). **No unique on
  `vault_secret_id`.**
- **[FACT] `credential_status` enum** (`001:64-68`) = exactly **`pending_validation` | `valid` | `invalid`** (no others).
- **[FACT] `exchange_environment`** added to the **credential** by `014:58-60`: `TEXT`, nullable, `CHECK (… IN
  ('testnet','mainnet'))`. NULL = fail-closed (worker). **Not on `bots`.**
- **[FACT] `bots`** (`001:185-198`): `credential_id uuid` **nullable**, `→ user_exchange_credentials(id) ON DELETE
  RESTRICT`, indexed **non-uniquely** (`idx_bots_credential_id`, `001:393`). `user_id uuid NOT NULL`, `deleted_at
  TIMESTAMPTZ`, `status bot_status` (`pending_setup|active|paused|error|deleted`). `trading_enabled BOOLEAN NOT NULL
  DEFAULT TRUE` added by `014:28` (server-side kill).
- **[FACT] No DB-level tie** between a bot and its credential's `user_id` or `exchange_environment` — **no CHECK, no FK on
  the composite, no trigger.** Only `set_updated_at` triggers exist. The ownership/environment relationship is **entirely
  application-layer** (worker), and the ownership half is **not even checked there** (§7).
- **[FACT] Vault helpers:** `get_decrypted_secret(uuid)` (decrypt at execution), `delete_vault_secret(uuid)` (destroy);
  both service_role-only. Worker credential-table grants: SELECT/UPDATE (`006_worker_grants.sql:39`).

**Net current model:** a credential is a per-`(user,exchange,label)` row holding a Vault pointer + status + environment;
**nothing enforces that a credential is used by only one bot, nor that the bot and credential share an owner.**

## 2. Exact blast-radius risk (CONFIRMED, and more precise than the design doc)
- **[FACT] Sharing is possible today:** `bots.credential_id` has only a **non-unique** index — multiple live bots can
  point at the **same** credential row. (Flagged in-repo at `019_operator_kill_all.sql:12`.)
- **[FACT] Auto-disable path `disableCredentialAndBot` (`worker/src/index.ts:497-542`):** on a credential/auth failure it
  (a) sets the **shared credential row** `status='invalid'` (`503-508`, guarded `WHERE deleted_at IS NULL`), (b) sets
  **only the triggering bot** `status='error'` (`519-522`), (c) writes a `bot.disabled_credential_invalid` audit log.
  **It does NOT call `delete_vault_secret`** (grep: zero Vault-delete calls anywhere in `worker/`).
- **[FACT] Deferred cross-bot halt (the real blast radius):** invalidating a *shared* credential does **not** immediately
  pause the other bots, but each of them **fails closed on its next signal** at the credential-status gate
  (`index.ts:774-783`: `cred.status !== 'valid'` → `disableBotMisconfigured(reason='credential_status_invalid')`). So an
  auth failure on **one** bot silently disables **every** other live bot sharing that credential — just lazily, on their
  next signal. Reversible today (flip status back), but unexpected and cross-bot.
- **[FACT] Cross-user exposure (arguably worse than blast radius):** the worker **does not check** that the credential's
  `user_id` equals the bot's `user_id` (§7). A bot pointed at **another user's** credential would trade on that user's
  key with **no guard** — wrong-attribution / cross-tenant key use.
- **[FACT] Irreversible variant is operator-only:** since the worker never Vault-deletes, the irreversible
  "destroy the key for all sharers" outcome is reachable **only** via a manual/operator `delete_vault_secret` on a shared
  credential — exactly the emergency action A8-H2 deferred to H3.

## 3. Target invariant (REFRAMED to the real schema)
Design-doc wording was "one active credential per `(user_id, bot_id, environment)`." Since **`bot_id` is not on the
credential** and **environment is not on the bot**, that composite can't be a single credential-side key. **[PROPOSAL]**
the enforceable invariant is expressed as **two bot-side guarantees + the existing credential-side env property**:

> **I1 — Single-use:** for every **live** bot (`deleted_at IS NULL`) with `credential_id IS NOT NULL`, that
> `credential_id` is referenced by **no other live bot**. (⇒ no active credential is shared across bots.)
>
> **I2 — Ownership:** a bot's referenced credential has **`user_id = bots.user_id`** (a credential belongs to the bot's
> owner; no cross-user use).
>
> **I3 — Environment (already a credential property, worker-enforced):** the credential's `exchange_environment` is
> non-NULL and matches the worker tier at execution (`assertExchangeEnvironment`, `sizingRisk.ts:78-85`). There is **no
> bot environment field** to reconcile; "per-environment isolation" = the credential's own environment + the existing
> worker guard + (A4) mainnet keys being distinct rows from testnet keys.

**Result:** a KP5 action on a bot's credential touches **exactly that one bot** (I1), can never hit another user (I2),
and can never cross testnet/mainnet (I3). This is the precise, schema-true version of the design's intent.

## 4. Revoked / soft-deleted credentials × uniqueness
- **[FACT]** liveness predicate available = `deleted_at IS NULL` on both tables (matches RLS usage, `001:493, 511`).
- **[PROPOSAL]** Enforce **I1 on the `bots` side** with a **partial unique index**:
  `UNIQUE (credential_id) WHERE credential_id IS NOT NULL AND deleted_at IS NULL`. This makes each credential single-use
  **among live bots only** — a **soft-deleted bot** (old row from a repoint/rotation) is exempt, so history and
  re-pointing don't trip it. Detaching a bot (`credential_id = NULL`) is also exempt.
- **[PROPOSAL]** A **soft-deleted or `invalid` credential** does not need its own uniqueness change — I1 is enforced on
  bots, not credentials. Rotation (old cred → soft-delete/invalidate; new cred → repoint the bot) never violates I1
  because only the **new, live** bot↔credential edge is counted.
- **[RESOLVED by §5 discovery]** liveness predicate `deleted_at IS NULL` is sound — **0** live bots have
  `status='deleted'`, so there is no status/`deleted_at` skew. Predicate = `deleted_at IS NULL`.

## 5. Shared-credential detection (discovery — READ-ONLY, run before any enforce)
**[PROPOSAL]** run these read-only queries first (no mutation); enforcement is gated on them returning clean (or on
backfill resolving them):
```sql
-- (a) I1 violations: credentials referenced by >1 LIVE bot (the sharing to resolve)
select credential_id, count(*) as live_bots
from public.bots
where credential_id is not null and deleted_at is null
group by credential_id
having count(*) > 1;

-- (b) I2 violations: a live bot whose credential belongs to a different user
select b.id as bot_id, b.user_id as bot_user, c.user_id as cred_user
from public.bots b
join public.user_exchange_credentials c on c.id = b.credential_id
where b.deleted_at is null and c.user_id <> b.user_id;

-- (c) I3 gaps: a live bot whose (live) credential has NULL environment
select b.id as bot_id, c.id as credential_id, c.exchange_environment
from public.bots b
join public.user_exchange_credentials c on c.id = b.credential_id
where b.deleted_at is null and c.deleted_at is null and c.exchange_environment is null;

-- (d) liveness sanity: any live bot in status='deleted' (predicate check for §4)
select id, status from public.bots where deleted_at is null and status = 'deleted';
```
### §5 DISCOVERY RESULTS — run read-only on the linked DB (2026-07-10)
- **[FACT] Baseline:** **5 bots** (all live), **1 credential** total (live). Single-user testnet.
- **[FACT] (a) Shared credentials = 1** — credential `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` is referenced by **all 5 live
  bots** (a single 5-way share; fanout = one credential → 5 bots). *(This id is a row/pointer id, not a secret.)*
- **[FACT] (b) Cross-user mismatches = 0** — one owner for all bots and the credential (`distinct_bot_owners=1`,
  `distinct_cred_owners_in_use=1`).
- **[FACT] (c) Live bots with NULL-environment credential = 0.** Environment distribution: **`testnet: 1`** (all & live);
  no `(null)`, no `mainnet`.
- **[FACT] (d) Live bots with `status='deleted'` = 0** → the **`deleted_at IS NULL` liveness predicate is sound** (no
  status/deleted_at skew). *(Resolves the §4 [UNKNOWN].)*
- **[FACT] Credential-ref health (live bots):** `valid=5`, and null/missing/soft-deleted/invalid/pending all **= 0**.
- **[FACT] Mainnet credentials = 0** (total & live) — **no real-funds exposure**; this is purely testnet posture.

**Materiality:** **I2/I3 are clean today, but I1 is maximally violated** (5 bots on 1 credential). So **S1b (the
single-use unique index) CANNOT be applied to current testnet data** without first splitting into per-bot credentials —
this **activates the §13 stop condition**. **S2 (ownership) + W1 (worker ownership check) + S1a (detection) are safe to
add now** (current data passes I2). See §10 (Slice H3-1 / H3-2) and the recommended path below.

### Why the current testnet share is acceptable **right now** (and ONLY because of these — not a production posture)
> **The single shared testnet credential is tolerated only because ALL of the following hold. It is NOT an acceptable
> production posture and MUST be resolved (split/backfill → S1b) before any real funds.**
> - **[FACT] 0 mainnet credentials** (`mainnet_total=0`) — no real key is shared.
> - **[FACT] all 5 live bots have `trading_enabled=false`** (server-side kill engaged; verified 2026-07-10) — none can
>   place an order even though `status='active'`; and `QUEUE_ENABLED` is off.
> - **[FACT] testnet only** (`env_distribution = {testnet:1}`) — no real funds at risk.
> - **Real funds remain NO-GO** — the whole real-funds ladder (A1/A4/A11/live-tier) is still open.
> - **S1b enforcement is BLOCKED until split/backfill** — recorded as a hard stop (§13), not waved through.
>
> Shared credentials are **never** normalized as acceptable for production. Testnet's job here is to **prove the
> isolation model**, not to skip it.

### DECISION POINT surfaced by discovery — RECOMMENDED PATH (prove isolation on testnet first)
The testnet fleet currently shares one testnet key. The **recommended, production-quality path** is:
1. **Implement S2 (ownership) + W1 (worker ownership fail-closed) first** — safe on current data (I2 clean); closes the
   cross-user gap immediately.
2. **Ship S1a (shared-credential detection + hard NO-GO reporting)** — visibility before enforcement.
3. **Split / backfill testnet into per-bot credential rows** (operator provisions per-bot testnet keys → repoint bots →
   verify §5(a) = 0) — **prove the isolation model on testnet**.
4. **Enforce S1b (partial unique index)** once no sharing remains. **S1b must be enforced (or an equivalent no-sharing
   guarantee proven) before any real funds.**
- **Path B (defer S1b to mainnet/A4, keep testnet shared) = TEMPORARY ONLY, not recommended.** It is tolerable only as a
  short-lived state under the conditions boxed above, and only if the operator explicitly chooses to postpone the testnet
  split. It must **not** become the standing plan: real funds still require S1b (or equivalent) with per-bot mainnet keys.
  Skipping the testnet proof means the isolation model reaches mainnet unvalidated — avoid.

**Recommendation:** the numbered path above — **S2 + W1 + S1a now (Slice H3-1)**, then **testnet split/backfill → S1b
(Slice H3-2)** as the required pre-real-funds path. Testnet proves isolation before mainnet.

## 6. Proposed schema/detection changes (PROPOSAL — gated, LOCAL-tested, never `db push`)
Next migration number = **021** (020 is the latest; A2 reconcile is now tracked, so 021+ will track cleanly).

### S2 — Ownership (I2), declarative composite FK (RECOMMENDED) — PRECISE
**A composite FK requires a UNIQUE (or PK) constraint on the EXACT referenced column list.** `user_exchange_credentials`
has a PK on `id` alone and `UNIQUE (user_id, exchange_id, label)` — **neither covers `(id, user_id)`**, so a composite FK
on `(id, user_id)` **cannot** be created as-is. Two precise options:
- **S2 (recommended): add the supporting unique, then the composite FK.**
  ```sql
  -- 1) supporting unique so (id, user_id) is FK-referenceable (id is PK ⇒ this pair is trivially unique,
  --    but Postgres still REQUIRES an explicit unique constraint on the referenced columns):
  alter table public.user_exchange_credentials
    add constraint uec_id_user_key unique (id, user_id);
  -- 2) confirm the EXACT current FK name on bots.credential_id via catalog BEFORE dropping it:
  --    select conname from pg_constraint where conrelid='public.bots'::regclass and contype='f'
  --      and conkey = array[(select attnum from pg_attribute
  --        where attrelid='public.bots'::regclass and attname='credential_id')];
  --    (Postgres default would be 'bots_credential_id_fkey' — do NOT assume; verify.)
  -- 3) replace the single-col FK with the ownership-composite FK:
  alter table public.bots
    drop constraint <exact_fk_name_from_step_2>,
    add  constraint bots_credential_owner_fkey
      foreign key (credential_id, user_id)
      references public.user_exchange_credentials (id, user_id) on delete restrict;
  ```
  `credential_id` stays nullable — MATCH SIMPLE means a row with NULL `credential_id` is exempt (a bot with no credential
  is allowed). The FK now guarantees **`cred.user_id = bot.user_id`** at write time. `ON DELETE RESTRICT` preserved.
- **S2′ (fallback): trigger-based validation.** If Codex prefers not to alter the FK topology, a `BEFORE INSERT/UPDATE OF
  credential_id, user_id ON public.bots` trigger that raises unless the referenced credential's `user_id = NEW.user_id`.
  Equivalent guarantee, more procedural code, no dependency on adding `uec_id_user_key`. **Do not hand-wave — pick one in
  review;** recommend **S2** (declarative, DB-native).

### S1a — Single-use DETECTION + hard NO-GO (ship in Slice H3-1, NO enforcement yet)
- **Read-only detection**, not a constraint: the §5(a) query (credentials referenced by >1 live bot) exposed as (i) a
  standing read-only query, and (ii) a field in `operator_status()` / the Ops Harness (§8 O1) so sharing is **visible**.
- **Hard NO-GO rule (policy, enforced in review + runbooks, not the DB yet):** **any shared credential on a mainnet-bound
  bot ⇒ real funds NO-GO** (§15). S1a makes the violation observable before S1b makes it impossible.
- Ships **without** touching write paths — safe on the current shared-testnet data.

### S1b — Single-use DB ENFORCEMENT via partial unique index (Slice H3-2, ONLY after split/backfill)
- ```sql
  create unique index bots_credential_single_use_uidx
    on public.bots (credential_id)
    where credential_id is not null and deleted_at is null;
  ```
- **BLOCKED on current data** (5 bots share 1 credential — §5). Apply **only after** the testnet split/backfill (or over
  already-isolated mainnet data) makes §5(a) return 0. **[UNKNOWN]** brief-lock `create unique index` (fine for the small
  testnet table) vs `CREATE INDEX CONCURRENTLY` (cannot run in a transaction; our applies are txn-wrapped) for a larger
  table — decide at H3-2 time. Never apply S1b while any sharing remains (§13).

### S3 — Environment (I3): leave to the worker
Already fail-closes on NULL/mismatch (§7, `assertExchangeEnvironment`). A DB CHECK can't reference another table; a
trigger would be redundant with the worker guard. **[PROPOSAL]** no DB environment enforcement now; the worker guard is
the control. (Revisit at A4 if desired.)

## 7. Worker fail-closed checks (PROPOSAL)
- **[FACT] Present:** environment guard `assertExchangeEnvironment(isProduction, cred.exchange_environment)`
  (`index.ts:861`, logic `sizingRisk.ts:78-85`) — fires before the adapter is built; NULL or tier-mismatch → no order.
  Credential status/liveness gate (`index.ts:774-783`). `vault_secret_id` UUID-shape gate (`785-793`). Kill-switch
  `assertTradingEnabled` + `isBotConfigReady` (`857-868`).
- **[FACT] ABSENT — the gap to close:** **no `user_id` ownership check.** Step 4a select (`index.ts:754-758`) fetches
  `vault_secret_id, status, deleted_at, exchange_environment` — **not** the credential's `user_id`; nothing compares
  `cred.user_id === bot.user_id`.
- **[PROPOSAL] W1 — ownership fail-closed (EXACT behavior):** add `user_id` to the Step 4a credential select
  (`index.ts:754-758`) and, **before any decrypt / before any adapter creation**, compare `cred.user_id` to `bot.user_id`.
  On **mismatch**, the worker must:
  1. **NOT decrypt** — do not call the Vault path / `get_decrypted_secret`; the `vault_secret_id` is never resolved.
  2. **NOT create the adapter** — `new BinanceAdapter(...)` (`index.ts:872`) is never reached for this message.
  3. **Disable ONLY this bot** — call the existing `disableBotMisconfigured(supabase, bot, signal_id,
     'credential_owner_mismatch')` path (sets **this** bot to a stopped state + writes an audit row), exactly like the
     other misconfig gates (`index.ts:774-783`). **No other bot is touched.**
  4. **Emit an audit/log event with NO secrets** — reason string `credential_owner_mismatch` + bot id + signal id only;
     **never** the `vault_secret_id`, the key, or any credential value.
  5. **NEVER call `delete_vault_secret`** — W1 is detection + fail-closed disable, not destruction (see §9/§8-scope).
  6. **Ack the message** (return `{ ack: true }`) so it is not retried in a poison loop — consistent with the sibling
     misconfig gates.
  Belt-and-suspenders with the S2 composite FK: the **DB** rejects a cross-user write; the **worker** additionally
  refuses to trade if such a row ever exists. Result matches I2: an ownership violation stops **only that one bot**.
- **[FACT] Second resolution site:** `worker/src/reconciliation.ts:232-246` duplicates the credential resolution — the
  **same W1 ownership check must be applied there** (or factor both into one shared resolver so the guard can't drift).
  In the reconciliation path a mismatch must likewise **not decrypt, not build an adapter, log a no-secret event, and
  skip** that bot's reconciliation (no Vault delete). Flag both sites in the diff.
- **[PROPOSAL] W2 (optional):** keep the existing env guard unchanged; no change needed for I3.

## 8. Operator Console / Ops Harness impact (PROPOSAL)
- **[FACT]** `operator_status()` (016, extended by 020) already surfaces per-bot `credential_status` / `credential_ok`
  and joins the credential for `exchange_environment` (`016:80`, `020:47`).
- **[PROPOSAL] O1 = the S1a surfacing (read-only, non-secret; part of Slice H3-1):** add a per-bot
  **`credential_shared`** boolean (and/or `shared_with_count`) to `operator_status()` — computed: is any *other* live bot
  referencing this `credential_id`? Migration = a `CREATE OR REPLACE operator_status()` (like 020), catalog/count only,
  **no execute on secrets, no secret values**. This is the console half of **S1a detection** — sharing becomes visible in
  the Operator Console / Ops Harness, and (per §15) a mainnet-bound shared credential is a **hard NO-GO** the console can
  show. **[NOTE]** pairs with the pending **`credential_*` redaction cleanup** — the harness `SECRET_KEY_RE` over-matches
  `credential*`; adding a `credential_shared` field makes fixing that over-match (exact-key matching) a sensible companion
  so the new field isn't spuriously redacted.
- **[PROPOSAL] Ops Harness Slice C (FUTURE, gated, NOT now):** a "custody-lock" one-click becomes **safe only after I1/I2
  are live** — it would invalidate **one** bot's credential (disable-first, reversible), audited. Deferred.

## 9. KP5 disable / lock semantics — H3 IMPLEMENTS REVERSIBLE LOCK ONLY; Vault-DELETE OUT OF SCOPE
- **[FACT] Today's auto-path is already the reversible one:** `status='invalid'` only, **never** Vault delete. So
  "disable-first" is the existing behavior; H3 makes it *isolated*, not *new*.
- **[SCOPE — Codex CHANGE 8] `delete_vault_secret` is OUT OF SCOPE for the H3 implementation.** H3 implements **only**
  reversible credential lock/disable semantics. No H3 slice adds, wires, or invokes a Vault delete — not in the worker,
  not in the console, not in the Ops Harness. **Vault delete remains a SEPARATE emergency, operator-run procedure** with
  its own review each time (unchanged from today, where no code path deletes).
- **[PROPOSAL] KP5 tiers, with H3 scope marked:**
  1. **LOCK (default, reversible) — IN H3 SCOPE:** set the bot's credential `status='invalid'` (worker already does this
     on auth failure; a manual operator lock does the same). **Reverse** = re-validate → set back to
     **`'pending_validation'`** (recommended, so the worker re-validates before trusting; **[UNKNOWN]** vs straight to
     `'valid'` — recommend `pending_validation`). With I1 (post-S1b), this fails-closed **only that one bot**.
  2. **DETACH (reversible, alternative) — IN H3 SCOPE:** `bots.credential_id = NULL`; reversible by repointing; loses the
     pointer, so LOCK is preferred over DETACH.
  3. **VAULT-DELETE (irreversible) — OUT OF H3 SCOPE:** `delete_vault_secret(vault_secret_id::uuid)`, service_role,
     operator-run, emergency-only, reviewed each time; only on confirmed compromise. **Not built, not wired, not
     one-click.** Listed only to fix its boundary.
- **[PROPOSAL]** H3's custody-lock = **LOCK (reversible)**. Vault-delete is explicitly deferred out of H3.

## 10. Implementation slices (gated; each separately Codex-reviewed) — the two-slice path

### Slice H3-1 — Ownership + worker fail-closed + sharing detection (RECOMMENDED FIRST; safe on current data)
**Scope:** everything that is safe over the current shared-testnet data (no S1b unique index).
- **S2 — ownership guard** (migration 021): add `uec_id_user_key unique (id, user_id)` → verify exact live FK name →
  replace `bots.credential_id` FK with the composite ownership FK (§6). *(Or S2′ trigger if Codex prefers.)* Current data
  passes I2 (§5(b)=0), so this applies cleanly.
- **W1 — worker ownership fail-closed** (§7): add `user_id` to the credential select; on mismatch → no decrypt, no
  adapter, disable-only-this-bot, no-secret audit, no Vault delete; **both** resolution sites (`index.ts`,
  `reconciliation.ts`).
- **S1a — shared-credential DETECTION** (§6, §8): the read-only §5(a) query as a standing check **+** a `credential_shared`
  field in `operator_status()` / Ops Harness. **No enforcement.** Makes sharing visible + supports the §15 NO-GO.
- **Tests** (§11): LOCAL SQL for S2 (cross-user rejected / matching allowed / NULL allowed); worker unit for W1 fail-closed
  (both sites); an `operator_status` fixture asserting `credential_shared=true` for the current 5-way share.
- **NOT in H3-1:** the S1b unique index (blocked — §13), any split/backfill, any Vault delete.

### Slice H3-2 — Testnet split/backfill → enforce S1b (REQUIRED before real funds; can stay planned now)
**Scope:** eliminate sharing, prove isolation on testnet, then lock it with the DB constraint.
1. **Per-bot credential split/backfill strategy:** provision one testnet credential row per bot (each its own
   `vault_secret_id`). **Operator provisioning checklist (secret-safe):**
   - [ ] Operator creates N per-bot testnet API keys in the exchange (one per bot).
   - [ ] Operator stores each key's secret into **Vault** (per-bot `vault_secret_id`) via the provisioning path — **value
         pasted only into the secret store, never a doc/PR/chat/terminal Claude can read.**
   - [ ] Insert the per-bot `user_exchange_credentials` rows (correct `user_id`, `exchange_environment='testnet'`) —
         reviewed, surgical.
   - [ ] Record only **non-secret** metadata (label, bot mapping, created date).
2. **Repoint bots:** update each bot's `credential_id` to its own new row — reviewed, surgical, one at a time; never
   orphan a bot.
3. **Verify no sharing:** re-run §5(a) → **must return 0** (and §5(b)=0, §7b=0) before enforcing.
4. **Enforce S1b** (§6): apply the partial unique index once sharing = 0 (brief-lock vs CONCURRENTLY decided here). Then
   isolation is DB-guaranteed on testnet.
5. **Isolation proof (testnet validation):** disable one bot's credential → only that bot fails closed; others unaffected;
   reverse it → bot recovers (§11). Proves the model **before** mainnet.
- **Mainnet (A4-coupled):** A4 provisions **per-bot mainnet keys isolated from creation**, so I1 holds by construction and
  S1b simply locks it in — no shared mainnet key ever reaches enforcement.

**Apply order:** **H3-1** (S2 + W1 + S1a + tests) ▸ **H3-2** (split/backfill → verify 0 sharing → S1b → isolation proof)
▸ mainnet per-bot keys at A4. **Path B** (postpone the H3-2 testnet split, keep testnet shared temporarily) is tolerable
**only** under the §5 conditions box and only as an explicit short-lived operator choice — **S1b (or an equivalent proven
no-sharing guarantee) is still required before real funds (§15).**

## 11. Tests (LOCAL fixtures + worker unit + testnet validation — authored before apply)
- **Slice H3-1 — LOCAL SQL (pgTAP-style, like `019`/`020` fixtures):**
  - **S2:** a bot whose `credential_id`'s `user_id` ≠ the bot's `user_id` is **rejected** (composite FK / trigger); a
    matching-owner reference is **allowed**; NULL `credential_id` **allowed**.
  - **S1a (detection):** an `operator_status`-shaped fixture over a shared credential asserts `credential_shared=true`
    (and correct `shared_with_count`); a single-use credential asserts `credential_shared=false`. **No write-path change.**
- **Slice H3-1 — Worker unit:** ownership mismatch → **no decrypt, no adapter**, disable-only-this-bot via
  `disableBotMisconfigured('credential_owner_mismatch')`, no-secret audit, **no Vault delete**; both resolution sites
  (`index.ts`, `reconciliation.ts`). Env mismatch already covered.
- **Slice H3-2 — LOCAL SQL (after split/backfill):**
  - **S1b:** a **2nd live bot** on an already-referenced `credential_id` is **rejected**; a **soft-deleted** bot duplicate
    is **allowed** (rotation/repoint); `credential_id = NULL` is **allowed** (multiple).
  - **Isolation proof:** bots A,B with **distinct** credentials → set A's credential `status='invalid'` → **B's credential
    + eligibility UNAFFECTED**; re-validate A (reversible).
- **Slice H3-2 — Testnet validation (gated run):** invalidate one testnet bot's credential → **only that bot** fails
  closed on next signal; others keep running; reverse it (re-validate) → bot recovers. **Vault-delete is out of H3 scope
  and is NOT exercised.**

## 12. Rollout plan
- **Testnet first (prove the model):** discovery ✅ → **H3-1** (S2 + W1 + S1a) → **H3-2** (split/backfill → verify
  §5(a)=0 → enforce **S1b** → isolation proof). Testnet is where isolation is **proven**, not skipped.
- **Mainnet (A4-coupled):** per-bot mainnet keys are **created already-isolated** (A4 §6) — one key per (user, bot,
  mainnet), never shared — so on mainnet the invariants hold **by provisioning**, and **S1b/S2** simply keep them true. No
  shared mainnet key ever reaches enforcement. **S1b (or an equivalent proven no-sharing guarantee) is required before
  real funds (§15).**

## 13. Stop conditions (hard)
- **ACTIVE (discovery 2026-07-10): §5(a) returns 1 row — all 5 testnet bots share one credential.** Therefore **do NOT
  apply S1b (the single-use unique index) against the current DB** — it would fail or force detaching 4 live bots. S1b is
  applied only over isolated data (H3-2 testnet split, or mainnet/A4 per-bot keys). **S1a (detection) and S2 (ownership)
  are NOT blocked** — §5(b)=0, so ownership + detection are safe now.
- **General rule:** do NOT apply S1b while any credential is shared by >1 live bot — split/backfill/isolate first; enforce
  only over clean data (verify §5(a)=0 first).
- **Shared credentials are NOT an acceptable production posture** — the current testnet share is tolerated only under the
  §5 conditions box; it must be resolved before real funds.
- **Any active shared mainnet credential → real funds NO-GO** (I1 must be live-verified / S1b-enforced before any mainnet
  arming).
- **Any cross-user credential reference (I2 violation) → STOP** and fix before enforce/arming.
- **`delete_vault_secret` is OUT OF H3 SCOPE** — if any H3 slice proposes wiring/invoking a Vault delete → STOP (it is a
  separate emergency operator procedure, §9).
- **`CREATE INDEX CONCURRENTLY` inside a transaction / any `db push` → STOP** (surgical, tracked applies only).
- **Any secret value in a doc/PR/log → STOP + rotate.**

## 14. What can become implementation AFTER Codex PASS (each still separately gated)
**Recommended first implementation = Slice H3-1** (§10), which is safe over current data:
- **Discovery (§5)** — ✅ **DONE** (read-only, 2026-07-10).
- **Migration 021 = S2 ownership guard** (composite FK incl. the supporting `uec_id_user_key`, or S2′ trigger) — passes on
  current data; LOCAL-tested; verify exact live FK name first. **No S1b in 021.**
- **Worker W1 ownership fail-closed** (§7, exact behavior) — both resolution sites, with tests; gated deploy.
- **S1a shared-credential detection** — read-only query + `operator_status()`/Harness `credential_shared` field; no
  enforcement. Optionally with the `credential_*` redaction cleanup.
**Planned, NOT yet (Slice H3-2, §10):** testnet split/backfill (operator provisions per-bot keys) → verify §5(a)=0 →
enforce **S1b** partial unique index → isolation proof. **Required before real funds.**
- **NOT authorized by this packet:** any Vault delete (out of H3 scope, §9), any mainnet/testnet key provisioning
  (operator/A4), any repoint/backfill without a go, any arming, any deploy without its own go.

## 15. Real-funds gate (hard) — Codex CHANGE 9
**Real funds remain NO-GO until ALL hold:**
- [ ] **S2 + W1 live** — ownership enforced at the DB and fail-closed in the worker (both resolution sites).
- [ ] **S1a reports ZERO sharing for every mainnet-bound bot** — no mainnet bot shares a credential (detection green).
- [ ] **S1b enforced** (partial unique index over isolated data) **or an equivalent proven no-sharing guarantee** exists
      for mainnet bots (e.g. A4 per-bot provisioning verified + S1a=0).
- [ ] **Per-bot mainnet credentials exist** — one isolated `vault_secret_id` per (user, bot, mainnet), trade-only,
      allowlisted (A4).
- [ ] **A1 / A4 / A11 / live-tier fail-closed still pass** — H3 closes the custody-lock blast-radius gap and (with H4)
      makes A8 fully closable, but it does **not** substitute for those gates.

H3 by itself is **necessary, not sufficient** for real funds. **Real funds remain NO-GO.**

---

### Open questions to resolve in review (consolidated [UNKNOWN]s)
1. **[ANSWERED by §5 discovery]** live counts: **5 bots share 1 testnet credential** (I1 violated), **0** cross-user,
   **0** null-env, **0** mainnet; all 5 bots `trading_enabled=false`. → **Recommended path (not "defer to mainnet"):**
   ship **H3-1** (S2+W1+S1a) now, then **H3-2** testnet split/backfill → **S1b**, before real funds. Path B (keep testnet
   shared) is a temporary operator option only, under the §5 conditions box.
2. **[RESOLVED by §5 discovery]** liveness predicate = `deleted_at IS NULL` (0 live `status='deleted'`).
3. **§6 S2** — composite FK (recommended, needs the supporting `uec_id_user_key unique (id, user_id)`) vs trigger for
   ownership? Confirm the **exact live FK name** on `bots.credential_id` before any drop.
4. **§6 S1b** — brief-lock `create unique index` (fine for small testnet) vs `CONCURRENTLY` (needs out-of-txn) for the
   eventual larger/mainnet table (decided at H3-2 time).
5. **§9** — on reverse-of-lock, set credential back to `valid` or to `pending_validation` (re-validate first)? Recommend
   `pending_validation`.
6. **§6 S3 / §7** — keep environment enforcement worker-only (recommended) or also add a DB trigger?
7. **1:1 strictness** — confirm strict single-use (I1), i.e. never a deliberate 1-credential-to-many-bots case.
