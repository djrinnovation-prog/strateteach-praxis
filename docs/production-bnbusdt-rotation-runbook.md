# BNBUSDT Token Rotation — Runbook (first real rotation via the hasher)

> **RUN — COMPLETE + PASS (2026-07-08) · Codex PASS.** _updated by Codex at Oren request._ See "Run — results" at the
> end. First real `commit`-mode rotation through the server-side hasher
> ([design](production-server-side-webhook-hasher-design.md) · [deploy/smoke](production-hasher-deploy-smoke-runbook.md) ·
> [rotation runbook](production-webhook-token-rotation-runbook.md)). **Operator never handled `WEBHOOK_SECRET_PEPPER`.**
> No mainnet · no real funds · no TV alert · no bot arming · disarmed throughout.
>
> **Nature of this run:** a **testnet flow-proof** that the hasher rotation path works end-to-end — **not** the final
> pre-live rotation (see the exposure caveat in §7). BNBUSDT is not armed and not going to a live TV alert here.

## Target + constants
- **Bot:** BNBUSDT **`36b46eb3-9384-4e05-a79b-1246e9b85119`** (testnet, `status=active`, `trading_enabled=false`).
- **Doppler secret:** `PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN`.
- **Hasher:** `FN=https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/admin-rotate-webhook-token`
- **Webhook:** `https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/<bot_id>/<token>`
- **Auth (every hasher call):** `Authorization: Bearer $OP_JWT` **+** `x-admin-rotate-secret: $SECRET` (from the password manager).
- **Current BNB hash fingerprint (baseline):** `v1:c4da7f8a..1dd16670`.
- **Roles:** operator runs all hasher curls / Doppler / webhook fires; **Claude runs read-only DB read-backs only.**

## 1. Pre-checks (READ-ONLY — all must hold)
```bash
git status --short          # empty (clean); origin/main up to date
```
```sql
SELECT 'BNB status/trading_enabled' AS k, status::text||' / '||trading_enabled::text v
  FROM public.bots WHERE id='36b46eb3-9384-4e05-a79b-1246e9b85119'                    -- active / false
UNION ALL SELECT 'enabled_bots', count(*)::text FROM public.bots WHERE trading_enabled AND deleted_at IS NULL  -- 0
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text       -- 0
UNION ALL SELECT 'open_trades', count(*)::text FROM public.trades WHERE status::text IN ('pending','submitted','unknown')  -- 0
UNION ALL SELECT 'trades_dlq', count(*)::text FROM public.trades_dlq                    -- 0
UNION ALL SELECT 'worker_state', worker_state FROM public.worker_status                 -- disabled
UNION ALL SELECT 'is_production', is_production::text FROM public.worker_status          -- false
UNION ALL SELECT 'BNB hash_fp (baseline anchor)',
  left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8)
  FROM public.bots WHERE id='36b46eb3-9384-4e05-a79b-1246e9b85119';                     -- v1:c4da7f8a..1dd16670
```
**Also capture the OLD token** (for the §7 old-token-fails proof) **before** Doppler is overwritten (§4):
```bash
OLD_TOKEN=$(doppler secrets get PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN --plain)   # or copy from the Doppler dashboard
[ -n "$OLD_TOKEN" ] && echo "old token captured len=${#OLD_TOKEN}" || echo "EMPTY - stop"
```
**Stop** if any pre-check fails.

## 2. Generate the new BNB token locally (value never printed)
```bash
NEW_TOKEN=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=' | cut -c1-43)
echo "new token len=${#NEW_TOKEN}"     # prints ONLY the length
```

## 3. `dry_run` (no DB write) — capture the CAS anchor + fingerprint
```bash
DRY=$(curl -sS -X POST "$FN" -H "Authorization: Bearer $OP_JWT" -H "x-admin-rotate-secret: $SECRET" \
  -H 'content-type: application/json' \
  -d "{\"bot_id\":\"36b46eb3-9384-4e05-a79b-1246e9b85119\",\"mode\":\"dry_run\",\"token\":\"$NEW_TOKEN\"}")
echo "$DRY" | tr ',' '\n' | grep -E '"ok"|updated_rows|old_fp|new_fp|shape_ok|error'
OLD_HASH=$(echo "$DRY" | grep -oE '"old_hash":"[^"]+"' | cut -d'"' -f4)
NEW_FP=$(echo "$DRY"  | grep -oE '"new_fp":"[^"]+"'  | cut -d'"' -f4)
echo "OLD_HASH captured len=${#OLD_HASH} ; NEW_FP=$NEW_FP"
```
**Expect:** `updated_rows:0`, `ok:true`, `old_fp` = `c4da7f8a..1dd16670` (matches baseline), `new_fp` set.
`OLD_HASH` (full `v1:` digest — CAS anchor) and `NEW_FP` (dry_run fingerprint) are captured for the commit. **No DB write.**

## 4. Update the Doppler secret (Doppler BEFORE DB commit)
- Set **`PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN` = `$NEW_TOKEN`** in Doppler (dashboard, or CLI if working). Copy the
  value without printing: `printf '%s' "$NEW_TOKEN" | pbcopy` → paste into Doppler → **never into chat**.
- This is **operator-attested** to the hasher in §5 (`doppler_updated_confirmed`, `doppler_secret_name`); the function
  does not read Doppler. **Order matters: Doppler first, then commit** (design §7).

## 5. `commit` — compare-and-swap (exactly 1 row)
```bash
COMMIT=$(curl -sS -X POST "$FN" -H "Authorization: Bearer $OP_JWT" -H "x-admin-rotate-secret: $SECRET" \
  -H 'content-type: application/json' \
  -d "{\"bot_id\":\"36b46eb3-9384-4e05-a79b-1246e9b85119\",\"mode\":\"commit\",\"token\":\"$NEW_TOKEN\",\"expected_old_hash\":\"$OLD_HASH\",\"dry_run_fingerprint\":\"$NEW_FP\",\"doppler_updated_confirmed\":true,\"doppler_secret_name\":\"PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN\"}")
echo "$COMMIT" | tr ',' '\n' | grep -E '"ok"|updated_rows|new_fp|error|conflict'
```
**Expect:** `ok:true`, **`updated_rows:1`**, `new_fp` = the §3 `NEW_FP`.
- **409 conflict** ⇒ the stored hash ≠ `expected_old_hash` (concurrent change / stale dry_run) → **no rotation** → re-run §3.
- **500 `rotation_committed_audit_failed`** ⇒ CAS succeeded but the audit failed ⇒ manual reconciliation (§8) — NOT a clean success.

## 6. Post-commit read-back (Claude, READ-ONLY)
```sql
SELECT 'BNB hash_fp (want != baseline, == new_fp)' AS k,
  left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8) v
  FROM public.bots WHERE id='36b46eb3-9384-4e05-a79b-1246e9b85119'
UNION ALL SELECT 'SOL hash_fp (unchanged 08efe60b..43946740)',
  left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8) FROM public.bots WHERE trading_pair='SOLUSDT' AND deleted_at IS NULL
UNION ALL SELECT 'XRP hash_fp (unchanged 6c7c3d53..6f551029)',
  left(webhook_secret_hash,11)||'..'||right(webhook_secret_hash,8) FROM public.bots WHERE trading_pair='XRPUSDT' AND deleted_at IS NULL
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text
UNION ALL SELECT 'open_trades', count(*)::text FROM public.trades WHERE status::text IN ('pending','submitted','unknown')
UNION ALL SELECT 'trades_dlq', count(*)::text FROM public.trades_dlq
UNION ALL SELECT 'worker_state', worker_state FROM public.worker_status
UNION ALL SELECT 'rotated audit (fingerprint only)',
  (SELECT count(*)::text FROM public.audit_logs WHERE event_type='webhook_token.rotated'
   AND entity_id='36b46eb3-9384-4e05-a79b-1246e9b85119');
```
**Require:** BNB `hash_fp` **changed to `NEW_FP`**; **SOL/XRP unchanged**; queue 0; open_trades 0; DLQ 0; worker disabled;
a `webhook_token.rotated` audit row (fingerprint only).

## 7. Proof (safe — no execution)
**(a) Old token FAILS (necessary; old token already burned):** fire the **old** token at the webhook → rejected
`invalid_secret` (auth rejects before the `webhook_logs` upsert):
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/36b46eb3-9384-4e05-a79b-1246e9b85119/$OLD_TOKEN" \
  -H 'content-type: application/json' -d '{"signal_id":"bnbrot-old-<ts>","action":"buy"}'
```
Read-back: `webhook_logs` for `bnbrot-old-<ts>` = **0** (rejected); `queue_length`/trades unchanged. **HTTP 200** (uniform).

**(b) New token cryptographically INSTALLED / hash-proven (NOT live-fired):** the §5 commit (CAS 1 row) + §6 read-back
(`BNB hash_fp == NEW_FP`) prove the stored `webhook_secret_hash` is `HMAC(pepper, NEW_TOKEN)` — i.e. the **new-token auth
path is proven by hash installation, not live-fired.** **No request with the new token is fired.**
> **Wording (do not overstate):** this is **NOT** "new token accepted" — that term is reserved for an actually-fired
> request. Describe it only as **"new token cryptographically installed / hash-proven"** or **"new-token auth path proven
> by hash installation, not live-fired."**

> **EXPOSURE CAVEAT — read before any new-token fire.** Firing the NEW token through the webhook **URL path re-exposes
> it** (shell history/argv) ⇒ it would need **another rotation before live**. Because this run is a **flow-proof** (not
> the final pre-live rotation, no TV alert yet), an optional confirmation fire is acceptable **but** marks the new token
> **rotation-required again before live**. For the eventual **pre-live** rotation, **skip the new-token fire** entirely
> and rely on the CAS + hash read-back.

**(b-optional) Optional live-fire confirmation — RE-EXPOSES the new token (skip for pre-live; recommendation: skip):**
only an actually-fired request may be called "new token accepted". Fire the **new** token with an **invalid-action**
payload → passes auth, rejected at payload → **0 enqueue, 0 trade**. **This fires a request through the webhook URL path,
so it RE-EXPOSES the new token ⇒ BNBUSDT becomes rotation-required again before live.**
```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/36b46eb3-9384-4e05-a79b-1246e9b85119/$NEW_TOKEN" \
  -H 'content-type: application/json' -d '{"signal_id":"bnbrot-new-<ts>","action":"hold"}'
```
- Distinguishing "accepted" (`invalid_action`, post-auth) from "rejected" (`invalid_secret`) is **only in the webhook
  Edge log** — both are HTTP 200 with **0 `webhook_logs`**. **Requires Edge-log observation (Supabase dashboard;** the
  CLI has no `functions logs`). If Edge logs aren't observed, **(b) [CAS + hash read-back] is the authoritative proof** —
  prefer it and skip (b-optional).
- Read-back either way: `webhook_logs`/queue/trades for `bnbrot-new-<ts>` = **0** (no enqueue, no execution).

**No valid execution signal is fired at any point** (no `buy` with a valid payload on the armed path; bot stays
`trading_enabled=false`, worker disabled).

## 8. Rollback
- **Preferred:** if the new token can't be validated, **generate a THIRD fresh token and re-rotate** (§2–§6). Do not
  reuse any burned value.
- **Emergency-only old-hash restore:** restore the §3-captured `OLD_HASH` via a `commit` with `expected_old_hash` = the
  current stored hash — **disarmed-only, short-lived, NEVER for live/TV/execution**. The **old token stays burned**; an
  old-hash restore only re-enables a burned token on a disarmed bot to recover a broken state, then re-rotate fresh.
- **No `commit` restores a burned token for normal use.**

## 9. Stop conditions (any ⇒ halt)
- `dry_run` returns **5xx**.
- **Doppler update fails** (before commit) — do **not** commit; the old hash stays active (bot unchanged), retry Doppler.
- `commit` returns **409** (conflict — stale/concurrent) or **500** (`rotation_committed_audit_failed` — degraded).
- Post-commit **`BNB hash_fp` did not change** to `NEW_FP`, or **SOL/XRP changed**.
- Any **queue message / trade / DLQ** row appears.
- **Old token still accepted** after commit (webhook_logs=1 for the old-token fire) — rotation didn't take.
- **New token rejected `invalid_secret`** after commit — the stored hash ≠ new token (mismatch).

## 10. Post-run status + GO/NO-GO
- After a clean run: **BNBUSDT token rotated via the hasher** (flow proven). If any new-token fire was done (§7b-opt),
  **BNBUSDT is rotation-required again before live** (re-exposed). **XRPUSDT + SOLUSDT rotations still pending.**
- **Testnet flow-proof = GO** (Oren-gated when run). **Real funds = NO-GO** — rotation is hygiene, not a trading
  authorization; the final **pre-live** rotation must avoid any local new-token fire (put the token into TV server-side).

---

## Run — results (COMPLETE + PASS · Codex PASS · 2026-07-08)
_updated by Codex at Oren request._

**BNBUSDT rotation = COMPLETE + PASS** — first real hasher `commit`-mode rotation, end-to-end. Bot `36b46eb3`.

- **Pre-checks passed:** git clean (`2150fb0`); disarmed; BNB active/`trading_enabled=false`; queue/q/open_trades/DLQ=0;
  worker disabled; `is_production=false`. Baselines: BNB **`c4da7f8a..1dd16670`**, SOL `08efe60b..43946740`, XRP
  `6c7c3d53..6f551029`; old BNB token captured locally (never printed).
- **dry_run:** `updated_rows:0`, `old_fp=c4da7f8a..1dd16670`; no DB write.
- **409 recovery (happened + correct):** first `commit` → **`409 dry_run_fingerprint_mismatch`** — the CAS binding guard
  caught a regenerated `$NEW_TOKEN` vs a stale `$NEW_FP`; **no rotation occurred**. Recovered by re-deriving a fresh
  dry_run for the current token (`new_fp=0d4109bf..70c3754a`) and re-aligning Doppler to that same token.
- **Doppler update completed** (value replaced, never printed) **before** commit.
- **commit CAS:** `ok:true`, **`updated_rows:1`**, `new_fp=0d4109bf..70c3754a`.
- **Read-back:** BNB `hash_fp` **changed `c4da7f8a..1dd16670` → `0d4109bf..70c3754a`**; **SOL/XRP unchanged**;
  `webhook_token.rotated` audit = 1 (**fingerprint only**); queue/q/open_trades/DLQ=0; enabled_bots=0; worker disabled;
  `is_production=false`.
- **Proofs:** **new token cryptographically installed / hash-proven, NOT live-fired** (commit CAS + hash read-back);
  **old token FAILS `invalid_secret`** — fired at the webhook (twice), `webhook_logs=0` + 0 trades both times ⇒ dead,
  **0 side effects**.
- **Housekeeping:** sensitive shell vars unset (`NEW_TOKEN OLD_TOKEN OLD_HASH NEW_FP SECRET OP_JWT`); `ADMIN_ROTATE_SECRET`
  retained only in the operator password manager. A **messy paste** (a 2nd old-token fire + stray `command not found`
  lines) **caused no changes** — verified: both old fires 0 side effects, BNB hash still new, disarmed.
- **No mainnet · no real funds · no TV alert · no bot arming.**

**Status after run:** **BNBUSDT rotated** (token-exposure debt cleared; new token clean, not URL-fired).
**XRPUSDT + SOLUSDT rotations still PENDING** (same hasher flow — remember: do not re-run the token-generate line
mid-flow; the 409 guard will otherwise catch it).
