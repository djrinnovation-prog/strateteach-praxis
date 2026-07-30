# A8-H3 Slice H3-2 — LOCAL Validation Results (authoring)

> **DOC / EVIDENCE — LOCAL only. No linked apply · no deploy · no DB mutation on linked · no Railway/Doppler · no secrets
> · no mainnet / no real funds.** Records the LOCAL validation of the authored H3-2 artifacts (backfill + rollback +
> migration 023 S1b + fixtures). Uncommitted, for Codex review. Decisions applied: **Option 1** (reuse one testnet
> `vault_secret_id`), **keep 1 + add 4**, **NULL `credential_id` allowed**, new rows **`status='valid'`**.
>
> **Progress: 0/5 complete · Current: 1/5 — Credential isolation · Remaining: 5/5.** (Authoring + LOCAL only — does NOT
> advance progress; 1/5 closes only after the linked execution sequence, per the H3-2 packet §7.)

## Why Option 1 is TESTNET-ONLY (reuse one `vault_secret_id`)
Option 1 makes the 4 new rows reference the **same** testnet `vault_secret_id` as `SHARED_CRED`. This:
- **closes credential-ROW isolation** — each live bot has its own credential row → S1b single-use holds, and a KP5
  reversible LOCK (`status='invalid'`) now has a **per-bot** blast radius;
- **does NOT prove secret-custody isolation** — the underlying Vault **secret** is still shared across the 5 rows, so an
  (out-of-scope) `delete_vault_secret` would still destroy it for all; this is acceptable on **testnet** (no real funds)
  because the in-scope KP5 action is the reversible row-status LOCK, not a Vault delete;
- **mainnet still requires A4 distinct per-bot secrets** — A4 provisions a separate key + Vault secret per (user, bot,
  mainnet), so no shared mainnet `vault_secret_id` ever exists;
- **the shortcut must NOT be reused for mainnet** — it is a testnet convenience to prove + enforce the isolation MODEL,
  never a custody posture.

## Artifacts authored (this pass)
| File | Kind | Executes on linked? |
|---|---|---|
| `docs/sql/h3-2-backfill.sql` | DATA packet — split 5-on-1 → 5 per-bot rows; PRE-guards incl. **exact 5-bot-id** fleet check + `status='active'`; POST-verify | **No (authored only)** |
| `docs/sql/h3-2-backfill-rollback.sql` | DATA rollback packet — PRE-guards (5 bots, 4 h3-2 rows used only by the 4 expected bots, no enabled, no mainnet) → drop S1b → repoint 4 → delete 4 | **No** |
| `supabase/migrations/023_bots_credential_single_use_index.sql` | Migration — S1b partial unique index `bots_credential_single_use_uidx` (PRE 0 live-sharing / POST unique+partial) | **No** |
| `supabase/tests/023_bots_credential_single_use_index.test.sql` | LOCAL fixture — index behavior | LOCAL only |
| `supabase/tests/h3-2-backfill.test.sql` | LOCAL fixture — backfill body (real 5 ids), POSITIVE | LOCAL only |
| `supabase/tests/h3-2-backfill-negative.test.sql` | LOCAL fixture — backfill PRE-guard **aborts** when the fleet id set changed | LOCAL only |
| `supabase/tests/h3-2-backfill-rollback.test.sql` | LOCAL fixture — rollback body, POSITIVE | LOCAL only |
| `supabase/tests/h3-2-backfill-rollback-negative.test.sql` | LOCAL fixture — rollback PRE-guard **aborts** on an unexpected bot using an h3-2 row | LOCAL only |

**Secret handling (verified):** **no real `vault_secret_id` VALUE appears in any artifact** — the backfill reads it from
the DB into a variable and reuses it (never a literal); fixtures use only a dummy `…aa` placeholder; a repo grep of every
`vault_secret_id` occurrence shows only subquery-reuse / comments / the dummy. Evidence uses md5 fingerprint or counts.

## Environment
Supabase LOCAL (OrbStack/Docker), `supabase db reset` applied migrations **001..023** (023 created the S1b index on the
empty `bots` table). Fixtures via `psql -v ON_ERROR_STOP=1 -f`. **Local stack STOPPED + confirmed after validation.** No
`--linked`, no deploy, no secrets, no mainnet.

## Results (all GREEN — 5 fixtures)
| Check | Result |
|---|---|
| Migrations apply (001..023) | ✅ `Applying migration 023_bots_credential_single_use_index.sql` — clean |
| **023 — S1b index** | ✅ `ALL 023 TESTS PASSED` |
| **Backfill (positive, real 5 ids)** | ✅ `ALL H3-2 BACKFILL TESTS PASSED` |
| **Backfill (NEGATIVE — fleet changed → abort)** | ✅ `ALL H3-2 BACKFILL-NEGATIVE TESTS PASSED` |
| **Rollback (positive)** | ✅ `ALL H3-2 ROLLBACK TESTS PASSED` |
| **Rollback (NEGATIVE — unexpected bot → abort)** | ✅ `ALL H3-2 ROLLBACK-NEGATIVE TESTS PASSED` |
| Worker/frontend | ✅ unaffected (H3-2 is DB-only; jest 412 / vitest 87 unchanged) |
| Secret grep | ✅ no real `vault_secret_id` value in any artifact |

### 023 (S1b) — what it proved
- Index present, **unique + partial**; a **2nd LIVE bot** on an already-used `credential_id` → **rejected**
  (`unique_violation`); a **soft-deleted** duplicate → **allowed**; **multiple NULL `credential_id`** bots → **allowed**.

### Backfill — what it proved
- Seeded the pre-split **5 bots on one credential** (index dropped in-txn to allow it), ran the packet body →
  **5 live bots, 5 distinct `credential_id`, 0 sharing, all disarmed, all testnet**; **exactly 4 new rows** created,
  **all 4 REUSE `SHARED_CRED`'s `vault_secret_id`** (Option 1), **exactly 1 bot kept** on `SHARED_CRED`, **all 5 on valid**
  credentials; then **re-creating the S1b index SUCCEEDS** (0 sharing) — proving backfill unblocks S1b.
- **Label uniqueness fix during authoring:** the initial `'h3-2-'||left(id,8)` collided for test ids sharing a prefix →
  changed to **`'h3-2-'||<full bot id>`** (guaranteed unique) in both the packet and the fixture; re-ran → PASS.

### Rollback — what it proved
- Seeded the **post-backfill** state (5 bots on 5 distinct creds, 4 `h3-2-*`), ran the rollback body → **drops S1b first**,
  repoints the 4 back to `SHARED_CRED`, deletes the 4 `h3-2-*` rows → **5 bots restored on `SHARED_CRED`, 0 `h3-2-*` rows**.
  Round-trip reversibility confirmed. **No `delete_vault_secret`.**

## Reproduce
```
supabase start && supabase db reset
DSN="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
for t in 023_bots_credential_single_use_index h3-2-backfill h3-2-backfill-negative \
         h3-2-backfill-rollback h3-2-backfill-rollback-negative; do
  psql "$DSN" -v ON_ERROR_STOP=1 -f supabase/tests/$t.test.sql
done
supabase stop
```

## Not done here (gated — per the H3-2 packet §5/§7)
- **No linked apply** (backfill + 023 not run on the linked DB) · **no tracking insert for 023** · **no deploy** · **no A2
  ledger change** · **no browser/Harness validation**. These are the separate operator-gated execution steps.
- **1/5 remains open** until: backfill applied → 023 applied → 023 tracked → linked read-backs PASS → browser/Harness
  validation PASS → closeout committed/pushed. **Real funds remain NO-GO.**
