# Sprint 4 · S4-0 — Baseline Freeze

**Date:** 2026-06-21 · **Type:** read-only assessment (no mutation). Records the clean starting
state for Sprint 4 per `docs/sprint4-plan.md` (S4-0). Evidence tiers: E2 platform · E3 static ·
operator-confirmed runtime.

---

## 1. Git
- **Branch:** `main`
- **HEAD:** `0e79020` (`0e790207ffdd7df5c039e10993cb104a1e696b86`)
- **origin/main:** synced (`## main...origin/main`, no ahead/behind)
- **Working tree:** clean

## 2. Tests / static (E3)
- `tsc` build — **clean** (no errors)
- `npm test` (jest) — **113 passed / 113**, 3 suites
- `git diff --check` — **clean** (no whitespace errors)

## 3. Runtime safety (operator-confirmed)
Railway deployment **`1a872bdb`**:
- `worker_starting queue_enabled:false`
- `visibility_timeout_s:30`
- `is_production:false`
- `doppler_environment:dev`
- `boot_reconciliation_complete stuck_count:0`
- `worker_queue_disabled` present

## 4. DB / queue baseline (read-only, E2)
- `pgmq.metrics('trade_signals').queue_length` = **0**
- `trades_dlq` total = **0**
- `reconciliation_jobs` total = **0** (pending = 0)
- trades `pending`/`unknown` (not deleted) = **0**
- Test bot `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` — **active**, `BTCUSDT`
- Credential `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` — **valid**, not deleted, vault pointer present

## 5. Migration state (read-only, E2)
`supabase migration list --linked`:
- **001–008** — Local = Remote (in sync).
- **No 009 file** in `supabase/migrations/` — **Migration 009 (security hardening) frozen**, held
  outside the applied set.
- **010** — **Local-only in migration history** (Remote column blank): `010` is **applied live via
  direct SQL** (grants effective) and **WB8-verified** (`has_select=true` on `reconciliation_jobs`
  + `trades_dlq`), but is **not recorded** in `supabase_migrations.schema_migrations`.
- **No `db push` performed.** No reconciliation done.

### Written exception — migration 010
Migration 010 (`GRANT SELECT ON reconciliation_jobs + trades_dlq TO service_role`) was applied
surgically via direct SQL during WB8 and is intentionally **not** in the remote migration history.
Its effect is **live and verified**. Reconciliation (recording 010 in `supabase_migrations` via
`supabase db push`) is **deferred** and must be **pre-checked + approved** first — the grants are
idempotent, so a `db push` should be a no-op for 010, but this must be confirmed before running.
Until then, `migration list` will show 010 as remote-pending; this is a **history/tracking
discrepancy only, not a functional gap**.

---

## GO / NO-GO
**GO for S4-1 (Alerting Phase 1).** The baseline is clean: synced HEAD, green tests, empty
queue/DLQ/reconciliation, no stuck trades, bot + credential ready, runtime disarmed on testnet.
S4-1 does not arm/fire, so the migration-010 history gap (tracking-only) does not block it.

## Caveats / risks
- **Migration 010 history discrepancy** — live + verified, but not in `supabase_migrations`;
  reconcile only after a pre-checked, approved `db push` (idempotent grant no-op). Tracking-only.
- **Production-grade egress still unproven** — Railway static IP is shared (not allowlist-grade)
  and mainnet Binance IP policy is unverified (Register `380d6df6`). A LIVE blocker, not a Sprint-4
  testnet blocker.
- **LIVE / mainnet out of scope** for Sprint 4 (testnet only; real money / 50-trade *production*
  mainnet step excluded).

*Last verified: 2026-06-21 · git `0e79020` · Supabase read-only queries + `migration list` (E2) +
Railway deploy `1a872bdb` (operator-confirmed).*
