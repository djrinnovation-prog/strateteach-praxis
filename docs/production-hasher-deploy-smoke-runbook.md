# Server-Side Webhook Hasher — Deploy + Smoke Runbook

> **DEPLOYED + SMOKE PASS (2026-07-07) · Codex PASS.** _updated by Codex at Oren request._ See
> "Deploy+smoke run — results" at the end. Deploys the committed hasher slice:
> [design](production-server-side-webhook-hasher-design.md) · [impl plan](production-server-side-hasher-implementation-plan.md).
> **`commit` mode was OUT OF SMOKE SCOPE** — the smoke exercised `dry_run` + denials only; **no bot hash was changed**.

## 1. Deploy order (operator-run, gated)
1. **Deploy the new admin function:** `supabase functions deploy admin-rotate-webhook-token`
   - The CLI applies `config.toml` `[functions.admin-rotate-webhook-token] verify_jwt = true` → platform requires a valid JWT.
2. **Redeploy `webhook`** (it was refactored to import the shared `verifyWebhookToken`): `supabase functions deploy webhook`
   - The shared module `_shared/webhook-hash.ts` ships with each function bundle; both must be deployed from the same commit.
- **Order rationale:** deploying the admin function first is additive (new endpoint, no live traffic). The `webhook`
  redeploy is the only change to a live-ingress path → do it second so it can be validated (§4) immediately.

## 2. Required env / secrets (Edge function secrets)
- **Auto-injected by the Supabase Edge runtime (do NOT set manually):** `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`. Confirm they exist (names only) with `supabase secrets list`.
- **`WEBHOOK_SECRET_PEPPER`** — already set (the `webhook` function uses it). **Reused** by the hasher; **no new value**,
  operator never handles it. Verify present via `supabase secrets list` (name only).
- **`ADMIN_ROTATE_SECRET`** — **optional** second factor. If set (`supabase secrets set ADMIN_ROTATE_SECRET=…`), every
  call must send header `x-admin-rotate-secret: <value>`; the smoke must include it. If unset, the function skips the
  second factor (JWT + `is_operator` still required).
- **Never** print/paste any secret value into chat/docs/logs — names only.

## 3. Pre-deploy checks (all must hold)
```bash
git rev-parse --short HEAD          # == 0e7bc2e
git status --short                  # empty (working tree clean)
cd supabase/functions
deno check _shared/webhook-hash.ts webhook/index.ts \
  admin-rotate-webhook-token/rotate.ts admin-rotate-webhook-token/index.ts \
  admin-rotate-webhook-token/index.test.ts        # all "Check", no errors
deno test _shared/webhook-hash.test.ts admin-rotate-webhook-token/index.test.ts _shared/rate-limit.test.ts
# expect: ok | 34 passed | 0 failed
```
```sql
-- system disarmed (read-only)
SELECT 'enabled_bots' AS k, count(*)::text v FROM public.bots WHERE trading_enabled AND deleted_at IS NULL
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text
UNION ALL SELECT 'worker_state', worker_state FROM public.worker_status
UNION ALL SELECT 'is_production', is_production::text FROM public.worker_status;
-- REQUIRE: enabled_bots=0, queue_length=0, worker_state=disabled, is_production=false
```
**Also capture the pre-deploy hash snapshot** (fingerprints only — for the §5 no-change proof):
```sql
SELECT id, trading_pair, left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8) AS hash_fp
FROM public.bots WHERE deleted_at IS NULL ORDER BY trading_pair;
```

## 4. Smoke tests (after deploy — dry_run + denials only; NO commit)
> `FN=https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/admin-rotate-webhook-token`. Operator holds all JWTs/secrets;
> nothing secret into chat. An **operator JWT** = the access token from the Operator Console session
> (`supabase.auth.getSession().access_token`) — operator-held.

| # | Request | Expect |
|---|---------|--------|
| 4a | **No `Authorization` header** | **401** — platform gate (`verify_jwt=true`) rejects before the function. |
| 4b | anon key / malformed bearer as `Authorization` | **401/403 at the gateway** — a **GATEWAY smoke only**. The anon key is **not a user JWT**, so this is **NOT** a non-operator proof. |
| 4c | **Real Supabase USER JWT for a user with `profiles.is_operator = false`** | **403** (function-level operator gate). **If no such non-operator user JWT is available → mark NOT RUN / optional — do NOT fake it with the anon key.** |
| 4d | operator JWT + `{ "bot_id":"not-a-uuid", "mode":"dry_run", "token":"<synthetic ≥32>" }` | **400** `invalid_bot_id`. |
| 4e | operator JWT + `{ "bot_id":"<real bot>", "mode":"dry_run", "token":"<SYNTHETIC throwaway>" }` | **200** `{updated_rows:0}` + `old_hash`/`new_hash`/`new_fp` returned to the operator; **no DB write** (§5). |
| 4f | *(if `ADMIN_ROTATE_SECRET` set)* operator JWT + **wrong** `x-admin-rotate-secret` | **403**. |

**Note on 4b/4c:** the function's own operator `403` (4c) is provable **only** with a genuine non-operator **user** JWT.
The anon key exercises the **gateway** (4b), not the operator gate — never present it as a non-operator proof.

**Synthetic dry_run token (4d/4e) — mandatory:** use a clearly fake, throwaway token, e.g.
`SMOKE_ROTATE_TOKEN_DO_NOT_USE_0123456789` (URL-safe, ≥ 32 chars). It **must never** be put in Doppler, used in
TradingView, or treated as a real rotation candidate; its `new_hash` from dry_run is a **throwaway** (dry_run does not
write). **Do NOT expose any real BNB/XRP/SOL campaign token during the smoke** — the smoke never needs a real token.

**`commit` is NOT run in smoke** — only with explicit Oren approval, as a real rotation (separate runbook).

**Webhook verifier regression check (wrong-token negative only — no valid token needed):**
```bash
# a bogus token in the URL path → uniform 200 {ok:true}, NO enqueue / NO webhook_logs (H5 N1 behaviour)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/5acc84c9-edd2-4c9f-87dd-fd928f8b62cd/bogus-not-a-real-token" \
  -H 'content-type: application/json' -d '{"signal_id":"hasher-smoke-wrongtoken","action":"buy"}'
```
Expect **200**. (Acceptance-parity for valid tokens is already covered by the committed unit tests — known-vector + parity —
so the live smoke needs only the negative test; no real token is used.)

## 5. Read-backs (after smoke — all must hold)
```sql
-- (a) NO bots.webhook_secret_hash changed vs the §3 snapshot (compare fingerprints)
SELECT id, trading_pair, left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8) AS hash_fp
FROM public.bots WHERE deleted_at IS NULL ORDER BY trading_pair;   -- identical to §3 snapshot

-- (b) no queue messages / trades / DLQ; worker still disabled
SELECT 'queue_length' AS k, public.pgmq_queue_length('trade_signals')::text v
UNION ALL SELECT 'q_trade_signals', count(*)::text FROM pgmq.q_trade_signals
UNION ALL SELECT 'smoke webhook_logs', count(*)::text FROM public.webhook_logs WHERE signal_id LIKE 'hasher-smoke-%'
UNION ALL SELECT 'trades since deploy', count(*)::text FROM public.trades WHERE signal_id LIKE 'hasher-smoke-%'
UNION ALL SELECT 'trades_dlq', count(*)::text FROM public.trades_dlq
UNION ALL SELECT 'worker_state', worker_state FROM public.worker_status
UNION ALL SELECT 'enabled_bots', count(*)::text FROM public.bots WHERE trading_enabled AND deleted_at IS NULL;
-- REQUIRE: queue 0, q 0, wrong-token webhook_logs 0 (rejected pre-upsert), trades 0, dlq 0, worker disabled, enabled_bots 0
```
- Audit spot-check (optional): a `webhook_token.rotate_dryrun` row exists for 4e with **fingerprints only** (no token/pepper/full hash).

## 6. Rollback
- **Webhook verifier regression** (wrong-token smoke behaves differently, or a valid alert stops working): **redeploy the
  previous known-good bundle.** The last known-good **before the hasher refactor is `347af24`** — check out that whole
  commit (or build the bundle from it) and `supabase functions deploy webhook`. **Do NOT partially `git checkout` a single
  file** (e.g. only `webhook/index.ts`) unless explicitly reviewed: the refactored `webhook/index.ts` imports
  `_shared/webhook-hash.ts`, so the two **must stay consistent** — reverting one without the other breaks the build/behaviour.
- **Admin function smoke fails:** the admin function is **additive** — **delete/disable it**
  (`supabase functions delete admin-rotate-webhook-token`). No live path depends on it.
- **No DB rollback needed** — the smoke runs `dry_run` only (no write). A DB rollback is relevant **only if `commit` was
  run**, and **`commit` is out of smoke scope**.

## 7. Stop conditions (any ⇒ halt + §6 rollback)
- Any **5xx on `dry_run`** (4e) that is not the intended `503` missing-pepper path (pepper is present → a 5xx is a fault).
- **Any `bots.webhook_secret_hash` changed** during the smoke (§5a fingerprint differs from §3) — a dry_run must never write.
- **Any queue message / trade / DLQ row** appears (§5b non-zero) — the hasher must not touch the trade path.
- **Webhook wrong-token behaviour changes** — the negative test no longer returns uniform 200, or it enqueues / writes a
  `webhook_logs` row. That signals a verifier regression → rollback the `webhook` bundle.

## 8. GO / NO-GO
- **This is planning only** — deploy is operator-run after Codex PASS + Oren approval.
- Smoke success = 4a–4f as expected + wrong-token webhook 200 + §5 read-backs all clean (no hash/queue/trade/DLQ change).
- Then rotations can proceed via the hasher (`dry_run` → Doppler → `commit`, per the rotation runbook) — a **separate
  gated step**. **Real funds = NO-GO** regardless.

---

## Revision — Codex CHANGES round 1 applied (2026-07-07)
1. **Auth smoke semantics (§4):** the anon key is **not** a user JWT — 4b is a **gateway** smoke (401/403), not a
   non-operator proof. Non-operator `403` (4c) requires a **real user JWT with `is_operator=false`**; if unavailable →
   **NOT RUN / optional** (never faked with the anon key). Missing Authorization → gateway **401**.
2. **Synthetic dry_run token (§4d/4e):** use a clearly fake throwaway (e.g. `SMOKE_ROTATE_TOKEN_DO_NOT_USE_0123456789`) —
   never in Doppler/TradingView, never a real rotation candidate; **no real BNB/XRP/SOL token exposed** in smoke.
3. **Production-safe rollback (§6):** redeploy the **previous known-good bundle** (`347af24`) as a whole — **do not**
   partially checkout a single file; `webhook/index.ts` and `_shared/webhook-hash.ts` must stay consistent. Admin function
   is additive → delete/disable if smoke fails.

---

## Deploy+smoke run — results (DEPLOYED + PASS · Codex PASS · 2026-07-07)
_updated by Codex at Oren request._

**Deploy** (operator-run): `admin-rotate-webhook-token` deployed, then `webhook` redeployed (shared verifier). Migration
`018` applied before the final admin-function redeploy.

**Smoke (dry_run + denials only — NO commit):**
| Check | Result |
|---|---|
| 4a missing `Authorization` | **401** (gateway `verify_jwt`) |
| 4b malformed bearer | **401** (gateway) |
| webhook wrong-token | **200**, **0 side effects** (0 webhook_logs / 0 enqueue / 0 trades) |
| 4f no `ADMIN_ROTATE_SECRET` header | **403** (moot — secret not set) |
| 4d operator JWT + invalid bot_id | **400** (auth + operator gate pass, validation fails) |
| 4e operator JWT + dry_run (synthetic token) | **200**, `ok=true`, `shape_ok=true`, **`updated_rows=0`** |

4d/4e used a **synthetic throwaway token** — no real BNB/XRP/SOL token exposed; no `commit`.

**Post-smoke read-backs (all clean):** BNB/SOL/XRP `webhook_secret_hash` fingerprints **UNCHANGED** vs baseline
(`c4da7f8a..1dd16670` / `08efe60b..43946740` / `6c7c3d53..6f551029`) → **dry_run wrote nothing**; `enabled_bots=0`,
`queue_length=0`, `q_trade_signals=0`, `open_trades=0`, `trades_dlq=0`, `worker_state=disabled`, `is_production=false`;
**dry_run audit row exists** (`webhook_token.rotate_dryrun`, fingerprint only).

**Two live-smoke bugs caught + fixed (Codex-reviewed, committed):**
1. **`getUid`** (`d67925a`) — `caller.auth.getUser()` resolved a valid operator JWT to null (supabase-js v2 needs a
   stored session); fix: extract the bearer token and call **`getUser(token)`** explicitly. (Unit tests mock `getUid` →
   only the live call surfaced it.)
2. **Operator gate** (`8691048` + `6dc39d8`) — `service_role` has **no SELECT on the locked-down `profiles`** table, so
   `svc.from("profiles").select("is_operator")` failed → 403 `not_operator` for a real operator. Fix (**no grant on
   `profiles`**): SECURITY DEFINER **`public.is_operator(uuid)`** RPC (migration `018`, `search_path=''`, EXECUTE
   service_role only) + `svc.rpc("is_operator", …)`, fail-closed. Verified live.

**Outcome: DEPLOYED + SMOKE PASS.** The hasher works end-to-end (operator-authenticated `dry_run`, no hash change, system
disarmed). Rotations are now live-grade — **operator never handles `WEBHOOK_SECRET_PEPPER`**. **No rotation happened, no
Doppler action, no mainnet, no real funds.** `commit`-mode rotation is a separate gated step.

---

## ADMIN_ROTATE_SECRET 2nd factor — SET + smoke PASS (Codex PASS · 2026-07-07)
_updated by Codex at Oren request._

**Setup (operator-run):** `ADMIN_ROTATE_SECRET` generated locally (`openssl rand`, 43-char URL-safe) and **set as a
Supabase Edge secret** via `supabase secrets set --env-file` (env-file `umask 077`, then `rm -f`); confirmed present in
`supabase secrets list` (**name + digest only**). `admin-rotate-webhook-token` redeployed to pick it up.
**The secret value was never printed, never pasted to chat, and is not written in any doc/Notion.**

**2nd-factor smoke (dry_run only — NO commit):**
| Check | Result |
|---|---|
| **S1** operator JWT, **no** `x-admin-rotate-secret` header | **403** |
| **S2** operator JWT, **wrong** secret header | **403** |
| **S3** operator JWT, **correct** secret header + `dry_run` (synthetic token) | **200**, `ok=true`, `shape_ok=true`, `updated_rows=0` |

S3 used the **synthetic throwaway token** — no real BNB/XRP/SOL token exposed; no `commit`.

**Read-backs (clean):** BNB/SOL/XRP `webhook_secret_hash` fingerprints **UNCHANGED** vs baseline; `enabled_bots=0`,
`queue_length=0`, `q_trade_signals=0`, `open_trades=0`, `trades_dlq=0`, `worker_state=disabled`, `is_production=false`.

**Now enforced:** **`ADMIN_ROTATE_SECRET` is REQUIRED for every future `dry_run` AND `commit`** — each call must send a
valid `x-admin-rotate-secret` header **in addition to** the operator JWT + `is_operator` gate (missing/wrong ⇒ 403, per
S1/S2). **The value is stored only in the operator's password manager and was cleared from the shell** (`unset SECRET`).
If lost, re-run this setup with a new value.

**No rotation · no commit mode · no Doppler action · no mainnet · no real funds · system disarmed.** The hasher's
defense-in-depth is complete: **operator JWT (gateway) + `profiles.is_operator` (SECURITY DEFINER RPC) +
`ADMIN_ROTATE_SECRET` header.**
