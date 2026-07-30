# Server-Side Webhook Token Hasher — Design

> **Codex PASS · DESIGN ONLY — NOT IMPLEMENTED** (implementation is a separate gated slice, §14, needing Oren approval).
> _updated by Codex at Oren request._ · 2026-07-06. Derived from live repo/schema (read-only).
> **Goal:** a live-grade rotation mechanism so the operator **never handles `WEBHOOK_SECRET_PEPPER`**. It is the
> "preferred path" the [token rotation runbook](production-webhook-token-rotation-runbook.md) §3/§10 depends on.
> Related: webhook `verifyToken` (supabase/functions/webhook/index.ts:115), [A4 credential isolation](production-a4-credential-isolation-packet.md),
> [A8 kill path](production-a8-kill-path-readiness-packet.md).
>
> **Status (exact):**
> - **Edge admin function is the PREFERRED design.** Implementation remains a **separate gated slice**.
> - **Auth:** valid Supabase JWT + **`profiles.is_operator=true`**; **no anon/public execution**; optional
>   `ADMIN_ROTATE_SECRET`. Operator **never receives service_role** and **never handles `WEBHOOK_SECRET_PEPPER`**.
> - **Raw token** validated, used **in memory only**, never logged, never returned.
> - **Sequence:** `dry_run` before Doppler update → **Doppler before DB commit** → `commit` updates the DB hash.
> - **Audit stores a fingerprint** — not the full hash/token/pepper.
> - **Post-rotation proof may expose the token if a local URL is used → re-rotate before live.**

## 1. Preferred mechanism — options + recommendation
| Option | What | Pepper blast radius | Algorithm parity | Fit |
|--------|------|---------------------|------------------|-----|
| **A. Edge admin function** (Deno) | new function holds pepper in its env (like the webhook), hashes + updates DB | **no new surface** — pepper already lives in the Edge env | **exact** — reuses the webhook's `crypto.subtle` HMAC code | **RECOMMENDED** |
| B. Privileged DB RPC | Postgres function computes HMAC via `pgcrypto` | **worse** — pepper must be **added to the DB** (Vault/GUC), a new boundary | **drift risk** — reimplements HMAC in SQL vs the Deno verifier | reject as primary |
| C. Trusted provisioning script | script run in a secure CI/admin runner that holds the pepper | needs pepper in the runner (CI secret) | parity if it imports the shared hasher | fallback for bulk/initial provisioning, not routine rotation |

**Recommendation: Option A — an Edge admin function** (working name `admin-rotate-webhook-token`). Rationale: the pepper
**already** lives in the Edge environment (the webhook function reads it) → no new place holds the pepper; **algorithm
parity is guaranteed** by sharing the exact HMAC helper with `verifyToken` (no hasher/verifier drift); it can be
admin-gated and update the DB with service_role in one atomic, audited call. Option B spreads the pepper to the DB;
Option C needs a secure runner and is better kept for provisioning.

## 2. Admin boundary (explicit — all required)
The function MUST require **all** of:
- **A valid Supabase JWT** — a genuine, unexpired Auth token; the function verifies it server-side.
- **`profiles.is_operator = true`** for `auth.uid()` — looked up server-side against the operator allowlist
  (migration 016). The operator authenticates **as themselves** → **no `service_role` key on the operator machine**.
- **Optional second factor — `ADMIN_ROTATE_SECRET`** in a request header, held only in the function env + operator
  secret store, so a stolen operator session alone cannot rotate.
- **No anon access.** **No public/unauthenticated execution** (never `verify_jwt=false`).
- **Uniform denial response** — every rejected caller gets an identical `403` with no detail leakage (no "not operator"
  vs "bad token" distinction).
- **Audit every denial** — write an `audit_logs` denial row (`webhook_token.rotate_denied`) with `{actor-or-null, ip,
  reason-code, ts}` and **no secret values** (no token, no pepper, no JWT).
- The function runs **service_role internally** (to read the pepper env + update the DB); the **caller is never given
  service_role.**

## 3. Inputs + raw-token handling
- `bot_id` (uuid) — the target bot (must be a valid UUID, exist, not deleted).
- `mode` — `"dry_run"` | `"commit"` (see §7).
- `token` (string) — the **operator-generated** new token (runbook Step 2), sent over TLS.
- **Raw-token rules (the function receives the raw new token → strict handling):**
  - **Validate charset + length** — URL-safe charset only (`[A-Za-z0-9_-]`), **minimum length** (e.g. ≥ 32 chars);
    **reject weak/short tokens** (fail-closed).
  - **Use the token only in memory** — hash it and drop it; **no persistence except the resulting hash**.
  - **Never log the request body. Never log the token. Never return the token.**
  - **Tests must prove** the token never appears in logs, error messages, or the response (§11).
- *(Variant, not chosen: server-side token generation returning the token once — rejected; returning the token is an
  exposure. Operator-provides keeps the token out of the response.)*

## 4. Outputs
- **`dry_run`** → `{ bot_id, old_hash, new_hash, shape_ok, updated_rows: 0 }` — validates the token + computes the hash
  **without** any DB write (lets the operator confirm before committing).
- **`commit`** → `{ bot_id, old_hash, new_hash, shape_ok, updated_rows: 1 }` — after the DB update.
- The returned `old_hash`/`new_hash` (`v1:<hex>`) are **one-way digests, safe to return** over TLS to the authenticated
  operator (their read-back + rollback-anchor record). **Persistence (audit) stores only a fingerprint** (§8), not the
  full hash.
- **NEVER** the token. **NEVER** the pepper.

## 5. How it reads `WEBHOOK_SECRET_PEPPER` server-side
- `Deno.env.get("WEBHOOK_SECRET_PEPPER")` — from the **Edge function secret env**, exactly as the webhook function does.
  **Fail-closed** (`config:missing_pepper` → 503) if absent. The pepper is imported as the HMAC-SHA256 key
  (`crypto.subtle.importKey`), used to `sign`, and **never** logged/returned/persisted. It **never leaves the Edge
  boundary** and **never touches the operator machine.**
- **Parity guarantee:** extract the HMAC into a shared helper `computeWebhookHash(pepper, token) → "v1:"+hex(sign)`,
  imported by **both** this hasher and the webhook `verifyToken`, so the hasher and verifier can never drift.

## 6. How it updates `bots.webhook_secret_hash` (commit mode only)
- **`dry_run` does NOT write.** Only **`commit`** touches the DB.
- Internal service_role client: read the **old** hash first (for the operator's returned rollback anchor + the audit
  **fingerprint**, §8), then `UPDATE public.bots SET webhook_secret_hash = <v1:hex> WHERE id = <bot_id>`.
- Assert **exactly 1 row** updated; on 0 or >1 → abort + no-op + audit the failure. Verify the stored value matches
  `^v1:[0-9a-f]{64}$` (`HASH_RE`) after write.
- No partial state: if the UPDATE fails, nothing is returned as success (see §7 failure handling).

## 7. Doppler / DB consistency — exact sequence + failure handling
The function **does NOT touch Doppler** (never sees it; Doppler never holds the pepper). Consistency is achieved by
**ordering** + the **dry-run/commit** split. **Doppler is updated BEFORE the DB — never DB first.**

**Sequence (operator-driven; the function is called twice):**
1. **Generate** the new token locally (runbook Step 2).
2. **`dry_run`** — call the hasher in dry-run: validates the token + returns `new_hash` (**no DB write**). Operator
   records `old_hash` + `new_hash`.
3. **Update Doppler** `PRAXIS_CAMPAIGN_<PAIR>_WEBHOOK_TOKEN` = new token (inert so far — DB hash is still the old one).
4. **`commit`** — call the hasher in commit: updates `bots.webhook_secret_hash` (activates new token + kills old).
5. **Verify** the DB hash changed (§6 read-back).

**Failure handling:**
- **Doppler OK, then `commit` (DB) FAILS:** the **old DB hash is still active** → the **old token still works**, the
  **new token is not yet active**. **Stop; do NOT use the new token.** Re-attempt `commit` (or roll forward with a fresh
  token). No lockout — the bot is unchanged.
- **DB-before-Doppler is FORBIDDEN:** never `commit` (DB) before the Doppler update. If the DB flipped to the new hash
  while Doppler still held the old token, the live/TV path would carry a now-dead token. Ordering Doppler→DB makes the
  new token present the instant the DB activates it.
- Both steps are **disarmed-only** (bot `trading_enabled=false`); no live traffic is affected during the window.

## 8. Audit event + hash policy
- Every call (success **and** denial) → `audit_logs` row with: **`bot_id`, `actor` (auth.uid()), `action`**
  (`webhook_token.rotated` / `webhook_token.rotate_denied`), **`result`** (ok / reason-code), `ip`, `ts`.
- **Do NOT store the full before/after hash** (unless explicitly approved). **Preferred: store a hash FINGERPRINT** —
  the first/last 8 hex chars of each (`old_fp`, `new_fp`), or a separate HMAC fingerprint — enough to correlate a
  rotation without persisting the full digest.
- **NEVER** in the audit row: the token, the pepper, or the full webhook URL.
- The **rollback anchor** is the **full `old_hash` returned to the operator** in the `dry_run`/`commit` response (§4) and
  recorded by the operator — **not** the audit fingerprint. (Ties to the A8-H1 audited-action theme.)

## 9. Rollback
- **Rollback anchor = the full `old_hash` returned by `dry_run`/`commit` and recorded by the operator** (§4/§8) — the
  audit stores only a fingerprint, so it is not the anchor. Per the [rotation runbook](production-webhook-token-rotation-runbook.md)
  §5: **preferred rollback = generate a THIRD fresh token and re-rotate** via this function.
- **Emergency-only** old-hash restore (a gated admin call or a direct service_role `UPDATE` to the recorded old hash) is
  **disarmed-only, short-lived, NEVER live** — the old token stays **burned**. The function may expose a
  `restore_hash(bot_id, old_v1_hex)` admin path under the **same gating + audit**, but it must refuse to leave a bot
  live on a restored old hash.

## 10. Old-token-fails + new-token proofs — minimize token exposure
The hasher only **enables** rotation; the proofs are the operator's post-rotation tests (runbook §7/§8), DB-observable
with **no reliance on the hasher's own output**:
- **Old token fails:** fire old token → `webhook_logs = 0` for that signal_id (rejected `invalid_secret`), no enqueue.
- **New token accepted (observable):** bot `trading_enabled=false` + `QUEUE_ENABLED=false` → fire new token (valid
  payload) **exactly once** → `webhook_logs = 1` (accepted) + `trades = 0` (no execution) → scoped `pgmq.delete`
  cleanup. (`1` vs the old token's `0` = accepted vs rejected, in DB.)

**Exposure caveat (critical):**
- The new token may be used **exactly once** for that safe negative test. **If it is fired through the webhook URL
  (local terminal), the URL-path exposure applies → the token is again LOCALLY EXPOSED** and must be treated as burned.
- **Therefore a token proven via a local webhook URL is NOT suitable as the final pre-live token — another rotation is
  required before live.** Document, per rotation, whether the proof used the URL (⇒ re-rotate before live) or not.
- **For LIVE:** the final new token must reach **TradingView server-side/operator-side without ever being printed or
  fired from a local terminal**; validate it via a **TV-originated controlled test** (or rely on `dry_run` hash-parity +
  the DB-observable old-token-fails), so the live token is **never** exposed through a local URL.
- **Cheapest clean path:** on **testnet** the local-URL proof is fine (the token is rotated again before live anyway);
  reserve the no-local-URL discipline for the **final pre-live** rotation.

## 11. No token / pepper in logs, errors, or responses
- The function logs **only** non-secret fields: `bot_id`, `actor`, `event`, `shape_ok`, `updated_rows`, result/reason.
- **NEVER** logs or includes in an **error message / response body**: the token, the pepper, the full webhook URL, or
  the raw request body. Mirrors the webhook function's explicit rule ("never log the token, the full URL, the pepper, or
  the stored hash").
- **Tests prove absence:** the token and pepper never appear in stdout/stderr logs, in any thrown error/`catch` message,
  or in the HTTP response — including the deny paths (§2) and the validation-reject paths (§3).

## 12. Rate limits / abuse protection
- **Admin-only** already bounds volume; add: **per-actor rate limit** (e.g. ≤ N rotations/min) and a **per-bot cooldown**
  (reject re-rotating the same bot within a short window) to prevent thrashing/mistakes. (Can reuse the A5 rate-limit
  primitive or a small per-actor counter.)
- **Every call audited** (including denials); repeated denials from one actor/IP → alertable.
- **Fail-closed** on missing pepper, bad/unknown `bot_id`, weak token, or non-operator caller — uniform `403`/`503`, no
  detail leakage.

## 13. Local / dev restrictions
- **Dev has a different (or no) pepper** — the function **fails closed** if `WEBHOOK_SECRET_PEPPER` is absent; it never
  imports a production pepper into a dev context. The whole point: the **production pepper never reaches a local machine**.
- **Environment guard:** the function checks it is running in the intended environment (e.g. `PRAXIS_IS_PRODUCTION` /
  project ref) and refuses to rotate **production** bot rows from a **dev** deployment.
- Deploy/invoke of the admin function is restricted to the production Edge project; local dev uses a **dev pepper** +
  dev bots only. No cross-environment rotation.

## 14. Exact implementation slice (if approved — gated, Codex-reviewed, no auto-deploy)
1. **Shared helper** `supabase/functions/_shared/webhook-hash.ts` — `computeWebhookHash(pepperB64url, token) → "v1:"+hex`
   (the exact `crypto.subtle` HMAC-SHA256 already in `verifyToken`). **Refactor `verifyToken` to import it** → single
   source of truth (parity).
2. **Edge function** `supabase/functions/admin-rotate-webhook-token/index.ts`:
   - **admin boundary (§2):** verify JWT + **`profiles.is_operator=true`** (+ optional `ADMIN_ROTATE_SECRET` header);
     no anon / no public; uniform `403`; **audit every denial** (no secret values);
   - validate `{ bot_id, mode, token }` (UUID + exists; **token charset + min length**, §3);
   - `computeWebhookHash` (in memory) → read old hash → **`dry_run`: return, no write** / **`commit`: `UPDATE
     bots.webhook_secret_hash` (service_role, assert 1 row)** → insert `audit_logs` with **hash fingerprints** (§8);
   - per-actor rate limit + per-bot cooldown; fail-closed; **never log/return the token, pepper, or request body**;
   - return `{ bot_id, old_hash, new_hash, shape_ok, updated_rows }` only.
3. **Config (Edge env):** `WEBHOOK_SECRET_PEPPER` (existing), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   optional `ADMIN_ROTATE_SECRET`. **No new migration** (uses `bots` + `audit_logs`), unless adding a dedicated audit
   `event_type` enum value + a fingerprint helper.
4. **Tests:** hash **parity** with `verifyToken` (a token hashed by the helper verifies true); reject non-operator
   (403 + denial audit); reject bad/unknown `bot_id`; reject weak/short token; **`dry_run` writes nothing / `commit`
   writes exactly 1 row**; audit stores **fingerprint only** (no full hash / no token / no pepper); **token + pepper
   absent from logs, error messages, AND the response** (incl. deny + reject paths); rate-limit + cooldown; fail-closed
   on missing pepper.
5. **Deploy (gated):** `supabase functions deploy admin-rotate-webhook-token` — operator-run, after Codex PASS + Oren
   approval. Then the [rotation runbook](production-webhook-token-rotation-runbook.md) Step 3 uses this function as its
   **preferred** (non-fallback) path.

## 15. GO / NO-GO
- **This is design only** — nothing built. Implementation is a separate gated slice (§14) requiring Codex PASS + Oren
  approval; deploy is operator-run.
- Once shipped, rotations become **live-grade** (operator never handles the pepper) → removes the runbook's
  fallback/NO-GO-for-live caveat for future rotations.
- **Real funds = NO-GO** regardless — this hasher is a rotation-hygiene enabler, not a trading authorization; real funds
  still require A11 + A1/A4/A5/A8.

---

## Revision — Codex CHANGES round 1 applied (2026-07-06)
1. **Explicit admin boundary (§2):** valid JWT + `profiles.is_operator=true` + optional `ADMIN_ROTATE_SECRET`; no anon /
   no public; uniform 403; audit every denial with no secret values.
2. **Raw-token handling (§3/§11):** validate charset+length, reject weak/short; in-memory only, no persistence except
   the hash; never log body/token, never return token; tests prove token absent from logs, errors, and response.
3. **Doppler/DB consistency (§7) + dry-run/commit modes (§4/§6):** generate → `dry_run` (validate, no write) → update
   Doppler → `commit` (DB) → verify. Doppler-before-DB enforced; Doppler-OK/DB-fail ⇒ old hash still active, stop, don't
   use new token; DB-first forbidden.
4. **Audit hash policy (§8):** store a hash **fingerprint** (first/last 8 hex or HMAC fp) + bot_id/actor/action/result;
   never full hash (unless approved), never token/pepper/URL. Rollback anchor = operator-recorded `old_hash` from the
   response, not the audit.
5. **Proof exposure (§10):** new token used exactly once for the safe test; a token fired via a local webhook URL is
   again locally exposed ⇒ re-rotate before live; for live, TradingView gets the token server-side/operator-side without
   printing, validated via a TV-originated test.
