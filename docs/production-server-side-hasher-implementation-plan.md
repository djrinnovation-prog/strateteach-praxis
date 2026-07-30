# Server-Side Webhook Token Hasher — Implementation Plan

> **Codex PASS · PLANNING ONLY — NO CODE YET** (implementation is the next gated slice: Codex-reviewed diff →
> Oren-approved deploy). _updated by Codex at Oren request._ · 2026-07-07. No deploy · no DB mutation · no Doppler
> action · no endpoint fire · no mainnet/real funds. Implements the approved
> [hasher design](production-server-side-webhook-hasher-design.md) (§14) so token rotations (BNB/XRP/SOL) never require
> local pepper handling or ad-hoc scripts. Derived from live repo/schema (read-only 2026-07-07).

## 1. Objective
Ship an **Edge admin function** that computes `webhook_secret_hash` server-side (pepper stays in the Edge boundary) and
updates `bots.webhook_secret_hash`, gated to operators, audited by fingerprint. This is the **preferred rotation path**
the runbook depends on. **This slice ships the mechanism only — it does NOT rotate any bot** (that is a later gated run).

## 2. Files touched
| Path | New/Mod | Purpose |
|---|---|---|
| `supabase/functions/_shared/webhook-hash.ts` | **NEW** | Pure HMAC helper — single source of truth for hash + verify (no env read; pepper passed in). |
| `supabase/functions/_shared/webhook-hash.test.ts` | **NEW** | Parity + shape + known-vector tests (Deno test). |
| `supabase/functions/webhook/index.ts` | **MOD** | Import `verifyWebhookToken` + `HASH_RE` + byte helpers from `_shared/webhook-hash.ts` (behaviour-preserving refactor; keeps its own `PEPPER_B64URL` env read and passes it in). Guarantees hasher/verifier parity. |
| `supabase/functions/admin-rotate-webhook-token/index.ts` | **NEW** | The Edge admin function (auth → validate → hash → dry_run/commit → audit). |
| `supabase/functions/admin-rotate-webhook-token/index.test.ts` | **NEW** | Authz, dry_run/commit, no-secret-logging, validation, fail-closed tests. |
| `supabase/config.toml` | **MOD** | Add `[functions.admin-rotate-webhook-token]` with `verify_jwt = true`. |
| **No migration** | — | Uses existing `bots` + `audit_logs`; `event_type` is free-text (webhook/worker already write arbitrary strings — **confirm it is `text`, not an enum, before coding**). |

## 3. Shared helper — `_shared/webhook-hash.ts` (spec)
Pure functions, no `Deno.env` read (caller passes the pepper), so it is unit-testable and identical for hasher + verifier:
- `HASH_RE = /^v1:[0-9a-f]{64}$/`
- `b64urlToBytes(s)`, `hexToBytes(h)` (moved verbatim from `webhook/index.ts`)
- `computeWebhookHash(pepperB64url: string, token: string): Promise<string>` →
  `"v1:" + hex( HMAC-SHA256( key = b64urlToBytes(pepper), msg = utf8(token) ) )` via `crypto.subtle.importKey(...,["sign"])`
  + `crypto.subtle.sign`. Throws `config:missing_pepper` if pepper empty.
- `verifyWebhookToken(pepperB64url, stored, token): Promise<boolean>` → the **existing** `crypto.subtle.verify` logic
  (throws `config:missing_pepper` / `config:bad_stored_hash`). `webhook/index.ts` calls this → **parity by construction**.
- `hashFingerprint(v1hex: string): string` → non-reversible short id for audit, e.g. `first8+"…"+last8` of the 64-hex
  body (never the full hash).

## 4. Edge function — `admin-rotate-webhook-token/index.ts` (spec)
**Endpoint:** `POST /functions/v1/admin-rotate-webhook-token` · `verify_jwt = true` (platform gate: no valid JWT ⇒ 401).

**Auth boundary (all required; §2 of the design):**
1. Extract `Authorization` → caller-scoped client → `auth.getUser()` → `uid`. **Anon / no user ⇒ uniform 403 + denial audit.**
2. Optional `ADMIN_ROTATE_SECRET` header, constant-time compared to the env value ⇒ mismatch = 403.
3. **service_role** client: `SELECT is_operator FROM public.profiles WHERE id = uid` ⇒ must be `true` ⇒ else uniform 403 + denial audit.

**Inputs (validated):**
- `dry_run`: `{ bot_id: uuid (exists, not deleted), mode: "dry_run", token: string }`.
- `commit`: `{ bot_id, mode: "commit", token, expected_old_hash: v1hex, dry_run_fingerprint: string,
  doppler_updated_confirmed: true, doppler_secret_name: string }`.
- Token: **charset `[A-Za-z0-9_-]` only, length ≥ 32** ⇒ else 400 (weak/short rejected). Used **in memory only**.

**Flow:**
1. Read pepper `Deno.env.get("WEBHOOK_SECRET_PEPPER")` ⇒ empty ⇒ **503 fail-closed** (config error, not a bad token).
2. `new_hash = computeWebhookHash(pepper, token)`; assert `HASH_RE`. `new_fp = hashFingerprint(new_hash)`.
3. `old_hash` = `SELECT webhook_secret_hash FROM bots WHERE id = bot_id` (service_role); `old_fp = hashFingerprint(old_hash)`.
4. **`dry_run`** ⇒ **no write** ⇒ audit `webhook_token.rotate_dryrun` (`old_fp`,`new_fp`,`updated_rows:0`) ⇒ return
   `{ bot_id, old_hash, old_fp, new_hash, new_fp, shape_ok:true, updated_rows:0 }`. The operator records `new_fp` as the
   **`dry_run_fingerprint`** and `old_hash` as the CAS anchor.
5. **`commit`** — **compare-and-swap, not a blind update:**
   - **Bind to the dry_run:** require `dry_run_fingerprint === new_fp` (same token as the dry_run) ⇒ else **409 stale/mismatch**.
   - **Attestation:** require `doppler_updated_confirmed === true` + a non-empty `doppler_secret_name` ⇒ else **400**.
   - **CAS update:** `UPDATE public.bots SET webhook_secret_hash = new_hash
     WHERE id = bot_id AND webhook_secret_hash = expected_old_hash`.
   - **1 row updated** ⇒ read-back matches `HASH_RE` ⇒ audit `webhook_token.rotated` (fingerprints + attestation) ⇒
     return `{ …, updated_rows:1 }`.
   - **0 rows updated** ⇒ **409 conflict, NO rotation claim** ⇒ audit `webhook_token.rotate_conflict` ⇒ response tells the
     operator to **re-run `dry_run`** (the stored hash changed vs `expected_old_hash` — stale dry_run / concurrent rotation
     / wrong anchor).
6. **Doppler — operator-attested ordering (NOT technically enforced):** the Edge function **cannot read Doppler**, so
   Doppler-before-DB is **procedural**. The function only records the operator's **attestation** (`doppler_updated_confirmed`,
   `doppler_secret_name`) in the audit — it does **not** verify the Doppler secret was actually updated. The operator
   updates `PRAXIS_CAMPAIGN_<PAIR>_WEBHOOK_TOKEN` **before** `commit`; the function makes no stronger claim than "attested."

**Secret handling (explicit):**
- **Never** log/return the **token, pepper, request body, or full URL.** **No full hash in logs.**
- **Full `old_hash`/`new_hash` returned to the operator** is allowed **only** as the rollback anchor, over TLS,
  operator-only (authenticated response) — **never stored in the audit.**
- **Audit stores fingerprints only** (`old_fp`/`new_fp`), never the full hash / token / pepper / URL.

## 5. Config / env (operator-set at deploy, not in code)
- `config.toml`: `[functions.admin-rotate-webhook-token]` → `verify_jwt = true`.
- Edge function env: `WEBHOOK_SECRET_PEPPER` (existing), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (auto-injected),
  optional `ADMIN_ROTATE_SECRET`. **The operator never handles the pepper** — it is already an Edge secret.

## 6. Audit row (fingerprint only)
`audit_logs` insert: `event_type ∈ {webhook_token.rotated, webhook_token.rotate_dryrun, webhook_token.rotate_conflict,
webhook_token.rotate_denied}`, `entity_type='bot'`, `entity_id=bot_id`, `actor_type='operator'`, `actor_id=uid`,
`ip_address`, `before_state={old_fp}`, `after_state={new_fp, shape_ok, updated_rows}`. For `commit` and `conflict`,
`after_state` also carries the **attestation** `{doppler_secret_name, doppler_updated_confirmed}` and, on conflict,
`{expected_old_fp}` (so a stale/concurrent attempt is traceable). **No token, no pepper, no full hash, no full URL —
fingerprints only.**

## 7. Tests
**Helper** `_shared/webhook-hash.test.ts`:
- `computeWebhookHash` output matches `HASH_RE`.
- **Parity:** `verifyWebhookToken(pepper, computeWebhookHash(pepper, tok), tok) === true`.
- Wrong token ⇒ verify `false`.
- Known-vector regression (fixed pepper+token ⇒ fixed hash).

**Function** `admin-rotate-webhook-token/index.test.ts`:
- **authz:** anon/no-user ⇒ 403 + denial audit; non-operator uid ⇒ 403 + denial audit; `ADMIN_ROTATE_SECRET` mismatch ⇒ 403.
- **dry_run:** valid ⇒ `updated_rows:0`, returns `new_hash` + `new_fp`, **`bots.webhook_secret_hash` unchanged**.
- **commit (happy path):** valid `expected_old_hash` matches stored ⇒ **exactly 1 row updated (CAS)**, `updated_rows:1`,
  audit `webhook_token.rotated` with **fingerprints + attestation** (assert full hash/token/pepper **absent** from the audit).
- **commit CAS conflict:** `expected_old_hash` ≠ current stored ⇒ **0 rows ⇒ 409**, **no rotation** (hash unchanged),
  audit `webhook_token.rotate_conflict`, response instructs re-run `dry_run`.
- **commit dry_run binding:** `dry_run_fingerprint` ≠ `new_fp` (token differs from the dry_run) ⇒ **409 stale/mismatch**,
  no write.
- **commit attestation:** missing/`false` `doppler_updated_confirmed` or empty `doppler_secret_name` ⇒ **400**, no write.
- **validation:** non-uuid / unknown `bot_id` ⇒ 400; weak/short token ⇒ 400; bad `mode` ⇒ 400.
- **no-secret-logging:** capture stdout/stderr + the HTTP response across success + deny + reject paths ⇒ **token + pepper
  never appear**; full hash never in logs.
- **fail-closed:** missing pepper ⇒ 503.

**Regression:** existing `webhook` function tests still pass after the `verifyToken` extraction (parity preserved).

## 8. Deploy (gated — operator-run, after Codex PASS + Oren approval; NOT in this slice)
1. CI/local: `deno check` + `deno test` on `_shared/webhook-hash.test.ts` + the function test + the webhook regression.
2. Set `ADMIN_ROTATE_SECRET` (optional) in the Edge function secrets.
3. `supabase functions deploy admin-rotate-webhook-token` **and** redeploy `webhook` (it was modified).
4. Smoke: a non-operator call ⇒ 403 (no rotation); confirm no bot hash changed.

## 9. Rollback
- **No DB schema change** ⇒ nothing to migrate back.
- **Feature/deploy rollback:** the only live-path risk is the `webhook` refactor → mitigated by the parity + existing
  webhook tests. If a regression appears post-deploy, **redeploy the previous `webhook` bundle** and **undeploy the admin
  function** (additive → safe to remove).
- **Rotation rollback (using the function):** per design §9 + [runbook](production-webhook-token-rotation-runbook.md) §5 —
  a bad rotation ⇒ **generate a THIRD fresh token and re-rotate (`commit`)**. Emergency old-hash restore only via the
  operator-recorded `old_hash` (from the dry_run/commit response), **disarmed-only, short-lived, never live**; the **old
  token stays burned** — no live/TV/execution on it. Both the re-rotate and the emergency restore are themselves **CAS
  commits** (`expected_old_hash` = the current stored hash) ⇒ a concurrent change surfaces as a 409, never a blind overwrite.

---

## Revision — Codex CHANGES round 1 applied (2026-07-07)
1. **Doppler ordering is operator-ATTESTED, not enforced (§4/§6):** the Edge function cannot read Doppler → it only
   records the attestation `{doppler_updated_confirmed:true, doppler_secret_name}` (required on `commit`) in the audit;
   no stronger claim than "attested."
2. **Commit is COMPARE-AND-SWAP (§4/§7):** `dry_run` returns `old_hash`+`new_fp`; `commit` requires `expected_old_hash`
   + `dry_run_fingerprint` and updates only `WHERE …webhook_secret_hash = expected_old_hash`. 0 rows ⇒ **409, no rotation,
   audit `webhook_token.rotate_conflict`, operator re-runs `dry_run`** (prevents stale dry_run / concurrent rotation /
   accidental overwrite).
3. **Hash/secret handling clarified (§4/§6):** full `old_hash`/`new_hash` returned to the operator **only** as a rollback
   anchor over TLS/operator-only, **never stored in audit**; **audit stores fingerprints only**; **no token/pepper/full
   URL/full hash in logs.**

## 10. Out of scope (explicitly NOT this slice)
- No Doppler automation (Doppler update stays an operator step **before** `commit`).
- No TradingView update (operator/server-side, separate).
- **No actual rotation of BNB/XRP/SOL** — a later gated run uses this function once shipped.
- No Operator-Console kill/rotate button (relates to A8-H2, separate).

## 11. Pre-code confirmations
- `audit_logs.event_type` is **`text`** (not an enum) → no migration for the new event names. **Confirm before coding.**
- The `webhook` function's own test suite exists + passes today (baseline for the refactor regression check).

## 12. GO / NO-GO
- **Planning only** — no code, no deploy, no rotation. Implementation is the next gated slice (Codex-reviewed diff →
  Oren-approved deploy).
- Once shipped: rotations become **live-grade** (operator never handles the pepper). **Real funds = NO-GO** regardless —
  this is rotation hygiene, not a trading authorization.
