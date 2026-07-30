# A8-H3 Slice H3-1 — LOCAL Validation Results (H3-1d)

> **DOC / EVIDENCE — LOCAL only. No linked apply · no deploy · no Railway/Doppler · no secrets · no mainnet / no real
> funds.** Records the LOCAL validation of the H3-1 diff (S2 + W1 + S1a). Uncommitted, for Codex review.
>
> **Progress: 0/5 complete · Current: 1/5 — Credential isolation (implemented + LOCAL-validated; not linked-applied) ·
> Remaining: 5/5 until production live.** (1/5 closes only when H3-2 no-sharing is also done.)

## Environment
- Supabase LOCAL (OrbStack/Docker), `supabase db reset` applied migrations **001..022** to the local DB.
- SQL fixtures run via `psql -v ON_ERROR_STOP=1 -f` against the local DB (`db query --file` cannot run multi-statement
  fixtures). Worker = jest; frontend = vitest + tsc.
- **Local stack STOPPED after validation** (`supabase stop`; confirmed no supabase containers running). Local data
  persists in the docker volume; nothing runs now.
- **No `--linked`, no deploy, no secrets, no mainnet.**

## Results (all GREEN)
| Check | Command | Result |
|---|---|---|
| Migrations apply (001..022) | `supabase db reset` | ✅ 021 printed `H3-1a S2 OK: ownership FK enforced …`; 022 applied |
| **021 — S2 ownership FK** | `psql -f supabase/tests/021_bots_credential_owner_fk.test.sql` | ✅ `ALL 021 TESTS PASSED` (exit 0) |
| **022 — S1a detection** | `psql -f supabase/tests/022_operator_status_credential_shared.test.sql` | ✅ `ALL 022 TESTS PASSED` (exit 0) |
| **Worker typecheck** | `tsc --noEmit` (worker) | ✅ clean |
| **Worker tests** | `jest` (worker) | ✅ **412 passed** (15 suites; incl. W1 index + reconciliation tests) |
| **Frontend typecheck** | `tsc --noEmit` (frontend) | ✅ clean |
| **Frontend tests** | `vitest run` (frontend) | ✅ **87 passed** (8 files; incl. 3 S1a preflight-contract tests) |

### 021 (S2) — what it proved
- Composite FK `bots_credential_owner_fkey` present; old `bots_credential_id_fkey` gone; `uec_id_user_key` present.
- **Cross-user reference REJECTED** (INSERT + UPDATE) via `foreign_key_violation`.
- **Matching owner ALLOWED**; **NULL `credential_id` ALLOWED** (MATCH SIMPLE); **ON DELETE RESTRICT** still holds.

### 022 (S1a) — what it proved
- Two live bots sharing one credential → each `credential_shared=true`, `shared_with_count=1`.
- **LIVE-SHAPE: 5 live bots sharing one credential → each `credential_shared=true`, `shared_with_count=4`** (direct
  fixture — matches the current linked-DB fleet).
- Single-use bot → `false` / `0`. Null-credential bot → `false` / `0` (NOT null).
- **Soft-deleted sharing peer EXCLUDED** (not listed; not counted → the 2-bot case stays count 1, not 2); exactly 9 live
  bots listed (soft-deleted excluded).
- Existing 020 shape preserved; **no secret substrings** in the payload; non-operator → `42501`.

### Frontend (S1a preflight) — CONTRACT (Option B), what it proved
- Disarmed + shared credential → **verdict PASS**, with a **visible advisory** item `credential sharing (advisory)` =
  `attention` (sharing is surfaced, does NOT flip the verdict at this tier).
- Sharing does **not rescue** a real fault (enabled_bots>0 → verdict ATTENTION, advisory still present).
- No sharing → advisory present + `ok`. Mainnet NO-GO is enforced **outside** buildPreflight (S1a consumers + A4 gate).

### Worker (W1) — what it proved
- Ownership mismatch (`cred.user_id != bot.user_id`) → **no adapter** (`MockAdapter` not called → no decrypt/exchange
  call), **only this bot** set `status='error'`, credential row **not** touched (`not …{status:'invalid'}`), audit
  `bot.misconfigured` reason `credential_owner_mismatch`, **no Vault delete** (queue-exhaustion guard), ack=true.
  **Asserted: the `vault_secret_id` VALUE appears in NO log and in NO audit payload.**
- Reconciliation `defaultAdapterFor` mismatch → **returns null** (trade left pending, no exchange call) **and logs a
  NO-SECRET observable event** `reconciliation_credential_owner_mismatch` (`{trade_id, bot_id}` only — asserted the
  `vault_secret_id` value is NOT in the log). Null credential → null (unchanged). Happy-path unchanged — 412 green.

## Reproduce
```
supabase start && supabase db reset
DSN="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$DSN" -v ON_ERROR_STOP=1 -f supabase/tests/021_bots_credential_owner_fk.test.sql
psql "$DSN" -v ON_ERROR_STOP=1 -f supabase/tests/022_operator_status_credential_shared.test.sql
( cd worker && npx tsc --noEmit && npx jest )
( cd frontend && npm run typecheck && npm test )
```

## Linked apply plan — migration tracking is EXPLICIT (gated, NOT done here)
Order (operator-run, after Codex PASS + go; never `db push`):
1. **PITR/backup confirmed.**
2. **Apply 021** surgically: `supabase db query --linked --file supabase/migrations/021_bots_credential_owner_fk.sql`.
3. **Claude read-back 021:** composite FK `bots_credential_owner_fkey` present, old `bots_credential_id_fkey` gone,
   `uec_id_user_key` present. **Only if read-backs PASS →** proceed.
4. **Apply 022** surgically; **read-back:** `operator_status()` returns `credential_shared`/`shared_with_count`; grants
   intact; no secrets.
5. **Migration TRACKING (explicit — because A2 is reconciled):** **ONLY AFTER steps 3-4 read-backs PASS**, add the two
   tracking rows to `supabase_migrations.schema_migrations` via a **reviewed, metadata-only** insert (same discipline as
   the A2 reconcile artifact `docs/sql/a2-reconcile-010-020.sql`): `('021','bots_credential_owner_fk')` and
   `('022','operator_status_credential_shared')`. **Metadata only — touches ONLY the tracking table; never `db push`.**
   Then `supabase migration list --linked` must show Local == Remote / nothing pending. Update the **A2 ledger**
   (`production-a2-migration-009-decision-packet.md`) to record 021/022 as tracked (doc-only, after the insert).
6. **Deploy** worker (W1) + frontend (S1a surface) — operator-run (Railway).
- **NOT done here:** no linked apply, no tracking insert, no deploy, no A2 ledger change (all above are gated).
- **S1b / testnet split/backfill = H3-2**, not this slice.
