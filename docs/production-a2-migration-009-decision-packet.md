# A2 Packet — Migration 009 Decision

> **DOC / DESIGN + read-only discovery — NOT EXECUTION.** No DB mutation · no `db push` · no migration apply ·
> no deploy · no mainnet/real funds. _updated by Codex at Oren request._ · Codex PASS with scoping · 2026-07-05
>
> **CLOSEOUT UPDATE 2026-07-10:** the A2 reconcile artifact `docs/sql/a2-reconcile-010-020.sql` was **operator-run and
> VERIFIED GREEN** (metadata-only). Migration-history divergence **RESOLVED**; reconcile prerequisite **CLOSED**. This
> doc-only update records that outcome. Real funds remain **NO-GO** (A1/A4/A8-H3/A11/live-tier open).

## Status (exact)
- **A2 testnet = GO.**
- **A2 real funds = OPEN / NO-GO** (reconcile prerequisite now **CLOSED**; other real-funds gates remain — see GO/NO-GO).
- **009 draft = no-op / superseded.** **009 remains intentionally absent** (no file; sequence 008 → 010).
- **Migration history divergence = RESOLVED** — **A2 reconcile APPLIED + VERIFIED GREEN (2026-07-10).**
- **Never run `db push`.** (Now a no-op — tracking == reality, nothing pending — but the standing rule is unchanged.)
- **010–020 are applied live AND NOW TRACKED** (reconciled 2026-07-10; 017 applied 2026-07-08 · 018 2026-07-07 · 019 + 020 2026-07-09).
- **021 + 022 applied live AND TRACKED (2026-07-12, A8-H3 H3-1 linked apply):** `021 bots_credential_owner_fk` (composite
  ownership FK) + `022 operator_status_credential_shared`; both surgical (`db query --linked --file`, never `db push`),
  read-back-verified, then a reviewed metadata-only insert added them to tracking. 009 still absent.
- **023 applied live AND TRACKED (2026-07-12, A8-H3 H3-2 linked execution):** `023 bots_credential_single_use_index`
  (S1b partial unique index — single-use among live bots); surgical (`db query --linked --file`, never `db push`),
  read-back-verified (unique+partial, `WHERE credential_id IS NOT NULL AND deleted_at IS NULL`), then a reviewed
  metadata-only insert added it to tracking. `schema_migrations` now = **001–008 + 010–023** (22 rows); `migration list
  --linked` = **Local == Remote / nothing pending**. **009 intentionally absent.**
- **No file-only migration remains.**
- **Reconcile DONE:** history reconciled via per-object verify + reviewed **metadata-only** tracking inserts — see "A2 reconcile — APPLIED + VERIFIED GREEN" below.

## What Migration 009 is
- **No `009` file exists** in the repo — the sequence jumps `008 → 010`.
- Per DECISIONS: **"Migration 009 = unrelated security-hardening DRAFT"** — never finalized, never committed as a file,
  never applied. **Decision: 009 = no-op / superseded** — its security intent is owned by the explicit gates **A4
  (credential isolation) + A5 (webhook hardening)** + the Master Rebuild Plan. No file, no apply.
- "Migration 009 frozen" is **shorthand** for the broader posture: *migration history is diverged — do not `db push`.*

## Current live migration state (read-only evidence · 2026-07-05)
| Item | State |
|---|---|
| `supabase_migrations.schema_migrations` (CLI tracking) | **001–008 only** (8 rows) |
| **009** | absent (no file, not applied) |
| **010–016** | **APPLIED to live DB, but NOT tracked** (surgical/direct SQL). Verified: 010 dlq-grant · 014 sizing col · 015 worker_status · 016 operator_status |
| **017** | **APPLIED to live DB (2026-07-08), but NOT tracked** — surgical transaction-wrapped apply + verified: `public.webhook_rate_limits` table + `public.webhook_rate_bump(text,timestamptz)` RPC, RLS deny-all, service_role only (A5-1 H1 webhook rate limiter). |
| **018** | **APPLIED to live DB (2026-07-07), but NOT tracked** — surgical transaction-wrapped apply + verified: `public.is_operator(uuid)` SECURITY DEFINER, `search_path=''`, EXECUTE service_role only (for the webhook-token hasher's operator gate). |
| **019** | **APPLIED to live DB (2026-07-09), but NOT tracked** — surgical transaction-wrapped apply (`db query --linked --file`, **never `db push`**) + verified: `public.operator_kill_all(text, boolean)` SECURITY DEFINER, `search_path=''`, owner=`postgres`; grants `authenticated`=EXECUTE, PUBLIC/anon=none (A8-H2 audited one-click kill). Exercised end-to-end in the A8-H2 testnet validation run (`production-a8-h2-testnet-validation-runbook.md`). |
| **020** | **APPLIED to live DB (2026-07-09), but NOT tracked** — surgical transaction-wrapped apply (`db query --linked --file`, **never `db push`**) + verified: **schema-only** `CREATE OR REPLACE public.operator_status()` adding per-bot `id` + `kill_rpc_present` (catalog boolean, no execute); SECURITY DEFINER, `search_path=''`; grants unchanged (`authenticated`=EXECUTE, PUBLIC/anon=none); **no bot-state change** (snapshot identical). Ops Harness read-surface. Verified via catalog read-backs + operator-JWT `operator_status` read; live-run: `production-ops-harness-live-readonly-run-runbook.md` (RUN — RESULTS). |

**Divergence — RESOLVED (2026-07-10).** The CLI tracking previously said "001–008 applied" while reality was "001–008
**+ 010–020**". The **A2 reconcile ran and verified GREEN** — `supabase_migrations.schema_migrations` now tracks
**001–008 + 010–020** (009 intentionally absent) — **and, since 2026-07-12, + 021 + 022** (A8-H3 H3-1) **+ 023** (A8-H3
H3-2), i.e. **001–008 + 010–023** (22 rows). `supabase migration list --linked` shows **Local == Remote / nothing
pending**, so a future `db push` is a **no-op** (no longer a landmine). The "never `db push`" discipline still stands as
policy. See the closeout section below.

### A2 reconcile — APPLIED + VERIFIED GREEN (2026-07-10)
- **Artifact:** `docs/sql/a2-reconcile-010-020.sql` (sha256 `bae375a2…c6297`) — transaction-wrapped, **metadata-only**
  (touches **only** `supabase_migrations.schema_migrations`), PRE-guards + explicit `where not exists` + POST-verify
  (RAISE ⇒ ROLLBACK). Operator-run surgically (`db query --linked --file`) — **never `db push`**.
- **Read-back evidence (Claude, read-only):**
  - `present_001_008 = 8`, **`present_010_020 (exact names) = 11`**, `has_009 = 0`, **`duplicate_versions = 0`**,
    **`total_rows = 19`** (8 + 11, delta exactly **+11 tracking rows**).
  - Full tracking list = `001–008 + 010–020`, each with its exact `name` (010 `reconciliation_dlq_select_grant` …
    020 `operator_status_add_id`); **009 absent**.
  - **`supabase migration list --linked`** = every row **Local == Remote**, **nothing pending**.
- **Scope proof:** the only mutation was the reviewed metadata insert into `supabase_migrations.schema_migrations`;
  **no schema/data change outside the tracking table** (delta = +11 rows, nothing else). No deploy · no Railway/Doppler ·
  no secrets · no mainnet / no real funds.
- **Net:** A2 migration-history divergence **RESOLVED**; A2's reconcile prerequisite **CLOSED**. **Real funds remain
  NO-GO** — A1 / A4 / A8-H3 / A11 / live-tier fail-closed remain open.

## Risk of running `db push` (HIGH — never run)
- Push trusts the tracking table (001–008) → treats **010–020 as pending**.
- Re-applying **010–016** (already live) → `CREATE TABLE` (no `IF NOT EXISTS`) → **"already exists" errors** → push
  **aborts partway** → unpredictable/partial state.
- Push would also **apply 017** — an **ungated, unreviewed** apply we explicitly don't want.
- **`db push` is a landmine until the history is reconciled. Never run it.**

## Decision (recommended, Codex-PASS)
- **009 draft → no-op / superseded** (dead draft; security owned by A4/A5 + rebuild plan).
- **Migration history → keep frozen / surgical now (never `db push`); reconcile before real funds** (gated) — insert the
  010–020 tracking rows (after per-object verify) so tracking == reality and a future `db push` is safe. **No file-only
  migration is pending; all surgical applies through 020 are done.**

## Evidence needed before any change (reconcile — real-funds prerequisite)
- **Per-object verify** each of 010–020 is **fully applied + matches its committed file** (object-by-object read-back)
  **before** inserting its tracking row — never mark-applied a partial migration.
- **PITR / backup** confirmed available.
- **Exact `INSERT INTO supabase_migrations.schema_migrations (version) VALUES …` statements reviewed (Codex)** + a
  dry-run understanding of what `db push` would do *after* reconciliation.

## Rollback / recovery (if migration history is wrong)
- The tracking table is **metadata** → a wrong reconcile is **reversible** (`DELETE` the offending `version` row).
- If a mark-applied object is actually missing → a future push **skips** it → recover by **re-applying the committed
  FILE surgically** (files are the source of truth).
- **Never `db push` blindly**; always surgical apply + raw read-back.

## GO / NO-GO
- **Testnet = GO** — surgical posture works; 010–020 applied + verified; "never-`db push`" discipline is safe
  for testnet. A2 does not block testnet.
- **Reconcile prerequisite = CLOSED (2026-07-10)** — migration history **reconciled + VERIFIED GREEN**
  (`001–008 + 010–020` tracked, 009 absent, 0 duplicates, 19 rows, Local == Remote / nothing pending). 009 is
  formally superseded (no file, no row).
- **Real funds = OPEN / NO-GO** — A2's reconcile prerequisite is now closed, but real funds remain NO-GO because the
  other gates remain open: **A1** static egress IP · **A4** real per-bot credentials · **A8-H3/KP5** credential
  isolation · **A11** written approval · **live-tier fail-closed** proof (also H4 worker closeout, TradingView).
