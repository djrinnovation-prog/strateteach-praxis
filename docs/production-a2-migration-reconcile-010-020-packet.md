# A2 — Migration Reconcile 010–020 (Planning Packet)

> **DOC / PLANNING + read-only discovery.** Grounded in `docs/production-a2-migration-009-decision-packet.md`.
>
> **STATUS: DONE — APPLIED + VERIFIED GREEN (2026-07-10).** Option B was approved; the reviewed artifact
> `docs/sql/a2-reconcile-010-020.sql` (metadata-only) was **operator-run** and Claude read-back-verified GREEN. This
> packet is retained as the reviewed record; see "§10 Closeout" for the evidence. Real funds remain **NO-GO**
> (A1/A4/A8-H3/A11/live-tier open).

## Closeout summary (2026-07-10)
- **A2 reconcile APPLIED + VERIFIED GREEN.** `supabase_migrations.schema_migrations` now tracks **001–008 + 010–020**;
  **009 remains intentionally absent**; `duplicate_versions = 0`; `total_rows = 19`.
- **`supabase migration list --linked` = Local == Remote / nothing pending.** A2 migration-history divergence is
  **RESOLVED**; a future `supabase db push` is **no longer a pending-migration landmine**.
- **Only mutation = the reviewed metadata insert** into `supabase_migrations.schema_migrations`; **no schema/data change
  outside the tracking table**. No deploy · no Railway/Doppler · no secrets · no mainnet / no real funds.
- Full evidence in **§10** and in the A2 ledger (`production-a2-migration-009-decision-packet.md`).

## Scope (execution posture — explicit)
- The reconcile itself was **metadata-only** (tracking-table inserts), operator-run surgically
  (`db query --linked --file`), **never `db push`**. Claude performed read-only read-backs only. No deploy. No
  Railway/Doppler change. No secrets. No mainnet / no real funds. **Real funds remain NO-GO.**
## 1. Current state (read-only evidence — verified from the linked DB, not assumed)
- **Tracking table (verified live):** `supabase_migrations.schema_migrations` with columns
  **`version text NOT NULL`**, **`name text` (nullable)**, **`statements text[]` (nullable)**.
- **Version format (verified from existing rows):** a **zero-padded 3-digit string** matching the file prefix, with
  `name` = the filename minus the numeric prefix and `.sql`. Examples from the live table:
  `('001','initial_schema')`, `('005','vault_delete_function')`, `('008','webhook_logs_bot_events_grants')`.
- `supabase_migrations.schema_migrations` records **001–008 only** (8 rows).
- Reality: **001–008 + 010–020** applied to the linked DB — **010–020 were applied surgically** (transaction-wrapped
  `supabase db query --linked --file`) and are **UNTRACKED**.
- **009** = no file / no-op / superseded (sequence jumps 008 → 010) — **do NOT fabricate a 009 row.**
- Every 010–020 file is committed and is the source of truth; each was verified at apply time (per-object read-backs) —
  but that verification **must be re-proven live** before any tracking insert (§7).

## 2. Why this blocks real production
- **`db push` is a landmine:** it trusts the tracking table (001–008) → treats 010–020 as *pending* → re-runs them →
  `CREATE TABLE`/`CREATE FUNCTION` "already exists" conflicts → **aborts partway → unpredictable/partial state.**
- A production DB whose migration history is **not trustworthy** cannot safely receive future migrations, CI checks, or a
  disaster-recovery rebuild. Reconcile is a **real-funds prerequisite** (tracking must == reality before mainnet).

## 3. Target end-state
`supabase_migrations.schema_migrations` == reality: **001–008 + 010–020 all tracked** (009 intentionally absent,
documented), so a future `supabase db push` is a **no-op** (nothing pending) and CI/DR can trust the history. Files
remain the source of truth.

## 4. Options
**A — Baseline / squash.** Generate one baseline migration capturing the current schema; reset tracking to that
baseline; archive 001–020.
- *Pros:* clean single starting point; no per-row inserts. *Cons:* **loses granular history**; requires a
  perfectly-accurate baseline (drift risk); higher-risk one-shot; harder to audit which change came from where.
**B — Preserve historical migrations + mark reconciled (RECOMMENDED).** Keep all files; **insert the missing tracking
rows** (`version` 010–020) after per-object verify, so tracking == reality with full history intact.
- *Pros:* lowest risk; reversible (tracking is metadata); preserves audit trail; matches the "files are source of truth"
  discipline. *Cons:* per-version verify effort (small, bounded: 11 versions).
**C — Hybrid.** Do **B now** (reconcile 010–020 to unblock), and *optionally later* squash 001–020 into a baseline for a
future clean cut — as a separate, non-urgent effort.
- *Pros:* unblocks immediately (B) without foreclosing a future baseline; *Cons:* two-phase.

## 5. Risks
- **Marking a partially-applied migration as applied** → a future push *skips* it → missing object. **Mitigation:**
  per-object verify each version *fully* applied + matches its file **before** inserting its row.
- **Wrong version string** (e.g. `019` vs a timestamp) → tracking mismatch. **Mitigation:** read an existing tracked row
  to confirm the exact `version` format the CLI expects, and match it.
- **Concurrent `db push` by anyone** mid-reconcile. **Mitigation:** the standing **never `db push`** rule; do the
  reconcile in one reviewed transaction.
- **009 gap** confusing tooling. **Mitigation:** document 009 as intentionally-absent no-op; do NOT fabricate a 009 row.

## 6. Exact NO-`db push` rule (unchanged, binding)
**Never run `supabase db push`** until reconcile is complete and verified. All applies are surgical
(`db query --linked --file`) + raw read-back. After reconcile, a `db push` dry-run must show **zero pending** before it
is ever trusted.

## 7. Proposed Codex-reviewed execution plan (Option B)
> **HARD RULE: do NOT insert any tracking row until EVERY object in 010–020 is independently PROVEN live** (per the
> matrix below). Tracking a version whose object isn't proven present would make a future push *skip* a real change.
>
> **Execution artifact (reviewed, UNEXECUTED):** the exact operator-run SQL is **`docs/sql/a2-reconcile-010-020.sql`** —
> transaction-wrapped, metadata-only, PRE-guards + explicit `where not exists` + POST-verification (RAISE ⇒ rollback),
> touching **only** `supabase_migrations.schema_migrations`. **OPERATOR-RUN, never `db push`.** Live verification of all
> 010–020 objects PASSED (2026-07-10); pre-state clean (001–008 present, 009 absent, 010–020 absent, PK
> `schema_migrations_pkey`, 0 duplicates).

### 7a. Per-migration verification matrix (each object must be proven live before its row is inserted)
| version | name (for the `name` column) | Objects to prove present live |
|---|---|---|
| 010 | `reconciliation_dlq_select_grant` | SELECT grant on `public.trades_dlq` to the DLQ-reader role |
| 011 | `alert_readonly_role` | role `praxis_alert_ro`; `alert_ro_*` SELECT policies on trades_dlq/webhook_logs/trades |
| 012 | `scope_user_select_policies_to_authenticated` | the re-scoped user SELECT policies (to `authenticated`) |
| 013 | `report_readonly_role` | role `praxis_report_ro`; report_ro policies; `public.pgmq_queue_length(text)` fn |
| 014 | `bot_sizing_risk` | `bots` columns: `trading_enabled`, `sizing_mode`, `max_order_notional_usdt`, `daily_notional_cap_usdt`, `position_size_pct`, `fixed_notional_usdt` |
| 015 | `worker_status` | table `public.worker_status` (singleton) |
| 016 | `operator_status_rpc` | `profiles.is_operator` col; `guard_profiles_is_operator()` trigger; `public.operator_status()` fn |
| 017 | `webhook_rate_limits` | table `public.webhook_rate_limits`; `public.webhook_rate_bump(text,timestamptz)` fn |
| 018 | `is_operator_rpc` | `public.is_operator(uuid)` fn (SECURITY DEFINER, EXECUTE service_role) |
| 019 | `operator_kill_all` | `public.operator_kill_all(text,boolean)` fn; grants authenticated-only |
| 020 | `operator_status_add_id` | `operator_status()` def contains `b.id` + `kill_rpc_present` (verified live 2026-07-09) |

*(009 is intentionally absent — no row.)* Each cell = a read-only catalog/`information_schema` check; produce the
evidence per version.

### 7b. Steps
1. **Confirm tracking format** (done — §1: `version` text zero-padded, `name`, `statements` nullable).
2. **Run the §7a matrix live** — object-by-object. Record PASS/UNPROVEN per version.
3. **Author the reconcile SQL** (transaction-wrapped; version + name; `statements` left NULL — it is nullable):
   ```sql
   begin;
   insert into supabase_migrations.schema_migrations (version, name) values
     ('010','reconciliation_dlq_select_grant'),
     ('011','alert_readonly_role'),
     ('012','scope_user_select_policies_to_authenticated'),
     ('013','report_readonly_role'),
     ('014','bot_sizing_risk'),
     ('015','worker_status'),
     ('016','operator_status_rpc'),
     ('017','webhook_rate_limits'),
     ('018','is_operator_rpc'),
     ('019','operator_kill_all'),
     ('020','operator_status_add_id')
   on conflict (version) do nothing;
   commit;
   -- ONLY the versions whose §7a objects are PROVEN live may appear here.
   ```
4. **Codex reviews** the filled SQL + the §7a evidence (every included version PROVEN).
5. **PITR/backup confirmed**; **operator runs** the reconcile surgically (`db query --linked --file`). **Never `db push`.**
6. **Dry-run / pending verification AFTER reconcile:** re-read tracking (001–008 + 010–020 present); then a `supabase db
   push --dry-run` (or the CLI's list of pending migrations) must show **ZERO pending**. If it still lists any → the
   reconcile is incomplete; do not proceed.
7. **Document** in the A2 ledger + memory.

## 8. Rollback / stop conditions
- **Rollback (precise):** the reconcile itself makes **NO schema change** — it inserts only **tracking metadata rows**.
  Therefore a wrong reconcile is undone by **deleting the specific inserted `version` row(s)** — and this is safe
  **only because** the reconcile touched nothing but the tracking table. (If a mark-applied object turns out actually
  missing, that is a *separate* problem: re-apply that migration's committed FILE surgically — do not just delete the
  row.) **Do not generalize "delete the row" to any other table.**
- **Stop if (any → halt, do not insert that version / abort):**
  - Any §7a object cannot be **proven present live** → that version is **UNPROVEN** → do NOT insert its row; investigate.
  - The `version`/`name` format doesn't match the live table (it does — §1), or `statements` turns out non-nullable in
    practice.
  - The post-reconcile dry-run still shows pending migrations.
  - Any hint that someone ran (or will run) **`db push`** before reconcile completes.
  - PITR/backup not confirmed.

## 9. Recommendation
**Option B now (Hybrid C posture).** Reconcile 010–020 via reviewed tracking inserts after per-object verify — lowest
risk, reversible, preserves history, unblocks trustworthy migrations for A4/live-tier/etc. Defer any 001–020 squash as a
separate, non-urgent baseline effort. **Real funds remain NO-GO** — this closes A2's reconcile prerequisite, one of
several gates.

> **OUTCOME (2026-07-10): Option B was chosen, approved, and EXECUTED — see §10.** A2 reconcile prerequisite **CLOSED**.

## 10. Closeout — APPLIED + VERIFIED GREEN (2026-07-10)
**Precondition:** PITR/backup confirmed by operator before the run. **Run:** operator executed
`supabase db query --linked --file docs/sql/a2-reconcile-010-020.sql` (returned clean; the artifact's own PRE/POST
guards passed ⇒ it committed). **Claude then ran read-only read-backs** (no mutation):

| Assertion | Result | Expected | ✓ |
|---|---|---|---|
| `present_001_008` | 8 | 8 | ✅ |
| **`present_010_020` (exact names)** | **11** | 11 | ✅ |
| `has_009` | 0 | 0 (absent) | ✅ |
| `duplicate_versions` | 0 | 0 | ✅ |
| `total_rows` | **19** | 8 + 11 | ✅ |

- **Full tracking list:** `001–008 + 010–020`, each with its exact `name` (010 `reconciliation_dlq_select_grant` …
  020 `operator_status_add_id`); **009 absent**.
- **`supabase migration list --linked`** (CLI supports it): **every row Local == Remote**, **nothing pending** —
  strongest confirmation that tracking == reality.
- **Scope proof:** the only mutation was the reviewed metadata insert into `supabase_migrations.schema_migrations`;
  delta = **exactly +11 tracking rows** (8 → 19), **no schema/data change outside the tracking table** (guaranteed by
  the artifact's content — it has no other statements).
- **Net:** A2 migration-history divergence **RESOLVED**; a future `db push` is a **no-op** (no longer a landmine); A2
  reconcile prerequisite **CLOSED**. No deploy · no Railway/Doppler · no secrets · no mainnet / no real funds.
  **Real funds remain NO-GO** — A1 / A4 / A8-H3 / A11 / live-tier fail-closed remain open.
