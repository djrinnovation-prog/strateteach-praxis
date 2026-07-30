# Webhook Token Rotation Runbook — BNBUSDT / XRPUSDT / SOLUSDT

> **Codex PASS · PLANNING ONLY — DO NOT ROTATE YET** (actual rotation requires explicit Oren approval).
> _updated by Codex at Oren request._ · 2026-07-06. Derived from live repo/schema (read-only). Related:
> [[praxis-bnbusdt-token-rotation]] · [S5-A6 rotation runbook](sprint5-s5-a6-incident-rotation-runbook.md) ·
> [A5 hardening](production-a5-hardening-implementation-plan.md).
>
> **Status (exact):**
> - **Server-side hashing is the PREFERRED rotation path;** the operator **never handles `WEBHOOK_SECRET_PEPPER`**.
> - **Local pepper hashing is FALLBACK ONLY and NO-GO for live** unless Oren explicitly approves (per bot).
> - **New-token proof must be OBSERVABLE** (`webhook_logs=1` accepted vs old `=0`, or exported `invalid_action`).
> - **Old token remains BURNED;** old-hash rollback is **emergency-only · disarmed-only · short-lived · never live**.
> - **Affected tokens (all rotation-required now):** BNBUSDT, XRPUSDT, **SOLUSDT (already exposed, Sprint 4-2 Phase A)**.
>   **Actual rotation requires explicit Oren approval.**

## 1. Why rotation is required
Each bot's webhook token was used from the **operator's local terminal** (token in the webhook **URL path** → shell
history / process argv / clipboard) → **local exposure** (NOT a public leak):
- **BNBUSDT** — H5 negative tests N2–N4 (2026-07-05).
- **XRPUSDT** — A10 kill-switch drill K1–K4 (2026-07-06).
- **SOLUSDT** — was **already locally exposed during Sprint 4-2 Phase A on 2026-06-29** via local terminal URL usage
  (`$T_SOL`); SOLUSDT token is **rotation-required now**, before any further live/TV/execution. H6 may re-expose it but
  is **not** the first exposure.

A webhook token that can trigger execution must not remain in a possibly-exposed state before going live. Rotation
replaces the token + its stored hash so the exposed value is **burned** and cannot fire the bot.

## 2. Affected secrets + bot ids
| Bot | bot_id | Doppler secret (token) |
|-----|--------|------------------------|
| BNBUSDT | `36b46eb3-9384-4e05-a79b-1246e9b85119` | `PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN` |
| XRPUSDT | `297dddb9-965b-49ff-abd8-e3e8e88fa4fc` | `PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN` |
| SOLUSDT | `5acc84c9-edd2-4c9f-87dd-fd928f8b62cd` | `PRAXIS_CAMPAIGN_SOLUSDT_WEBHOOK_TOKEN` |

- **Stored hash column:** `public.bots.webhook_secret_hash` (`v1:<64-hex>`).
- **Pepper (NOT rotated):** `WEBHOOK_SECRET_PEPPER` (base64url, Edge-only). Rotating the pepper would invalidate **all**
  bots — **out of scope**; this runbook rotates only per-bot tokens (independent per bot).
- Rotate the three **one bot at a time** (independent; no cross-impact). **All three (incl. SOLUSDT) are
  rotation-required now** — SOLUSDT is already exposed (S4-2 Phase A), not gated on H6.

## 3. Exact hashing path (authoritative — from `verifyToken`, index.ts:115)
`webhook_secret_hash = "v1:" + hex( HMAC-SHA256( key = base64url_decode(WEBHOOK_SECRET_PEPPER), msg = utf8_bytes(token) ) )`
- Format guard (webhook `HASH_RE`): `^v1:[0-9a-f]{64}$`. Any other shape ⇒ `webhook_config_error` (503).
- The hash is a **one-way digest** (safe to store in SQL). The **token** and the **pepper** are secrets (never stored/printed).

## 4. Exact safe rotation sequence (per bot; **DO NOT RUN** — planning only)
> Substitute `<BOT_ID>` + `<DOPPLER_SECRET>` per §2. Run in a controlled shell (`unset HISTFILE`), env vars only,
> nothing secret printed. Do one bot fully (steps 1–9) before the next.

**Step 1 — disarmed pre-check (READ-ONLY).** Confirm the target is safe to touch:
```sql
SELECT id, trading_pair, status::text, trading_enabled, webhook_secret_hash
FROM public.bots WHERE id='<BOT_ID>';
SELECT 'enabled_bots' k, count(*)::text v FROM public.bots WHERE trading_enabled AND deleted_at IS NULL
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text
UNION ALL SELECT 'ws.worker_state', worker_state FROM public.worker_status
UNION ALL SELECT 'ws.is_production', is_production::text FROM public.worker_status;
-- REQUIRE: target trading_enabled=false; enabled_bots=0; queue 0; worker disabled; is_production=false.
-- RECORD the current webhook_secret_hash verbatim (this is the ROLLBACK value).
```

**Step 2 — generate a new token locally** (URL-safe, strong; kept secret):
```bash
unset HISTFILE
export NEW_TOKEN="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=' | cut -c1-43)"   # URL-safe, ~43 chars
[ -n "$NEW_TOKEN" ] && echo "token generated (len ${#NEW_TOKEN})" || echo "EMPTY"        # never print the value
```

**Step 3 — compute the `v1:<hex>` hash — SERVER-SIDE (preferred; operator never handles the pepper).** The operator
supplies the Step-2 token to a **server-side hasher that holds `WEBHOOK_SECRET_PEPPER`** and returns **only** `v1:<hex>`,
so the pepper never touches the operator machine. Use one of:
- an **Edge / admin function** that takes a token (over an authenticated channel) and returns `v1:<hex>`;
- a **privileged DB RPC** that computes `hex(HMAC-SHA256(pepper, token))` with the pepper held server-side;
- the **trusted provisioning script** (`sql/s4-2-provision-campaign-bots.sql` path) run **only in a secure environment**
  that already holds the pepper.
Validate the returned value matches `^v1:[0-9a-f]{64}$`. **The operator never reads/handles the pepper value.**

> **FALLBACK — local pepper-based computation (NO-GO for live unless Oren explicitly approves).** If no server-side
> hasher exists yet, the hash MAY be computed locally — but this **exposes the pepper on the operator machine**, so it
> is a **fallback only**. A token/bot hashed this way is **NO-GO for live until re-rotated via the server-side path**
> (or Oren explicitly approves the fallback for that bot). If used: secure, ephemeral shell only; pepper in an env var,
> **never printed**, `unset` immediately (Step 9):
> ```bash
> unset HISTFILE
> export WEBHOOK_SECRET_PEPPER='...'   # FALLBACK ONLY — pepper on operator machine; never printed; unset after
> export NEW_HASH="$(node -e 'const c=require("crypto");const p=Buffer.from(process.env.WEBHOOK_SECRET_PEPPER,"base64url");process.stdout.write("v1:"+c.createHmac("sha256",p).update(process.env.NEW_TOKEN,"utf8").digest("hex"))')"
> echo "$NEW_HASH" | grep -Eq '^v1:[0-9a-f]{64}$' && echo "hash shape OK" || echo "BAD HASH SHAPE — STOP"
> ```
> `NEW_HASH` (`v1:<hex>`) is safe to display/store; `NEW_TOKEN` and `WEBHOOK_SECRET_PEPPER` are NOT.

**Step 4 — update the Doppler secret** (operator, Doppler dashboard/CLI): set `<DOPPLER_SECRET>` = `$NEW_TOKEN`
(paste the value; never into chat/logs). *(While the bot is disarmed with no live TV alert, the brief window between
Steps 4 and 5 causes no lockout.)*

**Step 5 — update `bots.webhook_secret_hash`** (operator; the DB mutation that activates the new token + kills the old):
```sql
UPDATE public.bots SET webhook_secret_hash = '<NEW_HASH value from Step 3>'
WHERE id='<BOT_ID>';
-- expect UPDATE 1
```

**Step 6 — raw read-back: hash changed, token not printed** (READ-ONLY):
```sql
SELECT id, trading_pair,
       webhook_secret_hash,
       (webhook_secret_hash ~ '^v1:[0-9a-f]{64}$') AS shape_ok
FROM public.bots WHERE id='<BOT_ID>';
-- REQUIRE: webhook_secret_hash == the Step-3 NEW_HASH, shape_ok=true, and it DIFFERS from the Step-1 recorded value.
-- The hash is a digest (safe to read); the token is never queried/printed.
```

**Step 7 — prove the OLD token now FAILS** (safe; no execution). Fire the **old** token → expect `invalid_secret`
(rejected pre-enqueue, like H5 N1): HTTP 200, **no `webhook_logs` row, no enqueue**.
```bash
# old token in OLD_TOKEN env (operator-held); bot stays trading_enabled=false
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/<BOT_ID>/$OLD_TOKEN" \
  -H 'content-type: application/json' -d '{"signal_id":"rot-old-<ts>","action":"buy"}'
```
Read-back: `SELECT count(*) FROM public.webhook_logs WHERE signal_id='rot-old-<ts>';` → **0**; `queue_length` unchanged.
Confirm the webhook function log shows `reason=invalid_secret` for this request.

**Step 8 — prove the NEW token WORKS with OBSERVABLE evidence (safe, no execution).** **Do NOT claim the new token
works without observable evidence that it passed auth.** Use ONE of:

- **(A) DB-observable (preferred — no Edge logs needed).** Keep the bot `trading_enabled=false` **and** `QUEUE_ENABLED=false`.
  Fire the **new** token with a **valid** payload → the request passes auth and **enqueues**, writing a `webhook_logs`
  row = **DB-observable proof the token was accepted**; the disarmed worker (queue off) never consumes it → **no order**.
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
    "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/<BOT_ID>/$NEW_TOKEN" \
    -H 'content-type: application/json' -d '{"signal_id":"rot-new-<ts>","action":"buy"}'
  ```
  Read-back (the observable artifact): `SELECT count(*) FROM public.webhook_logs WHERE signal_id='rot-new-<ts>'` → **1**
  (accepted); `SELECT count(*) FROM public.trades WHERE signal_id='rot-new-<ts>'` → **0** (no execution). **Contrast with
  Step 7:** old token → `webhook_logs = 0` (rejected); new token → `webhook_logs = 1` (accepted) — accepted-vs-rejected
  observed **in the DB**. Then **scoped cleanup:** inspect `pgmq.q_trade_signals`, verify `signal_id`+`bot_id`, delete
  that one msg_id (`pgmq.delete`), confirm `queue_length=0`.

- **(B) Edge-log observable.** Fire the **new** token with an **invalid** payload (`action:"hold"`) → no enqueue / no
  order → **require an Edge log export** showing `reason=invalid_action` (a POST-auth reject ⇒ token accepted), NOT
  `invalid_secret`. Valid **only if** the Edge logs are actually exported/observed (ties to A5 H4).

**No PASS without the observable artifact** — the `webhook_logs=1` row (A) or the exported `invalid_action` log line (B).

**Step 9 — document evidence + clear secrets.** Record: bot, date, old-hash→new-hash (hashes only), Step-7 old-fails +
Step-8 new-accepted results, read-back. Then **clear all secret env vars** (`unset NEW_TOKEN OLD_TOKEN WEBHOOK_SECRET_PEPPER`),
confirm no secret in shell history/scrollback. **Never** record token or pepper values.

## 5. Rollback
- **Before Step 5** — nothing committed to the DB; abort freely.
- **Preferred rollback (after Step 5, if the new token can't be validated):** **generate a THIRD fresh token and rotate
  again** (Steps 2–8, server-side hash). Do not reuse any burned value.
- **Emergency-only old-hash restore:** restoring the Step-1 recorded old hash
  (`UPDATE public.bots SET webhook_secret_hash='<OLD v1:hex>' WHERE id='<BOT_ID>';`) is **emergency-only, disarmed-only,
  and short-lived** — solely to recover a broken bot's config so it isn't left unusable. It is **NEVER for
  live/TradingView/execution**. Immediately schedule a clean fresh re-rotation.
- **The old token remains compromised/burned** and must **NEVER** carry live/TV/execution traffic. An old-hash restore
  only re-enables a burned token on a **disarmed** bot temporarily; a bot goes live **only** after a clean fresh
  rotation (Step-7 old-fails + Step-8 new-accepted proven).
- Keep the bot `trading_enabled=false` throughout rollback; no live traffic is affected (disarmed).

## 6. Stop conditions (any ⇒ abort + §5 rollback)
- Step-1 pre-check not fully disarmed, or `is_production=true` → **abort**.
- `NEW_HASH` fails `^v1:[0-9a-f]{64}$`, or `WEBHOOK_SECRET_PEPPER` empty/missing.
- Step-6 read-back hash ≠ Step-3 value, or the `UPDATE` touched ≠ 1 row / the wrong `id`.
- Step-7 old token does **not** fail (still accepted) or Step-8 new token is rejected (`invalid_secret`).
- **Step-8 produces no observable artifact** (`webhook_logs=1` or exported `invalid_action`) → cannot claim the new
  token works → **abort** (do not proceed on an unobserved assumption).
- **Local fallback hashing (§3) used without explicit Oren approval** → the bot is **NO-GO for live** until re-rotated
  server-side.
- Any secret value (token or **pepper**) printed to chat/log/screen, or any accidental enqueue that gets consumed.
- More than one bot's row affected in a single `UPDATE`.

## 7. Token custody rules
- **Operator owns all secrets.** Claude/Codex never see, print, store, request, or inspect a token or the pepper value.
- Tokens + pepper live only in their stores (Doppler / Edge secret) and, transiently, in **operator env vars**
  (`unset` after use). Retrieve from the store; never hard-code, never paste into chat/docs/commits.
- A token used once from a terminal (URL path) is **burned** → single-use for a test, then rotated (this runbook).
- Rotate **one bot at a time**; keep the Step-1 old hash only until Step-8 passes (rollback anchor), then discard.

## 8. What must NEVER be printed or stored
- **NEVER:** the raw token value · the `WEBHOOK_SECRET_PEPPER` value · the full webhook URL with the token · any
  clipboard/history persistence of the above.
- **SAFE to store/read:** the `webhook_secret_hash` (`v1:<hex>` one-way digest) · bot ids · Doppler **secret names**
  (not values) · reject-reason strings.

## 9. GO / NO-GO before live
- **Rotation is a hard prerequisite for live** for all three bots. A bot may go to live/TradingView execution **only
  when:** its token is rotated (this runbook), the hash was computed via the **server-side path** (§3) — or the local
  fallback was **explicitly Oren-approved** for that bot — **and** Step-7 old-fails + Step-8 new-accepted proven with an
  **observable artifact**, Step-6 hash read-back verified, no secret exposed post-rotation, **and** (for live) its
  TradingView alert URL is updated to the new token.
- **Testnet:** rotation itself is a safe testnet/disarmed operation (Oren-gated when executed).
- **Real funds = NO-GO** regardless — rotation is one prerequisite; real funds still require **A11** + A1/A4/A5/A8
  hardening. Rotation does not by itself authorize live or real-funds trading.

## 10. Server-side hasher — prerequisite for a clean (non-fallback) rotation
The **preferred** hashing path (§3) is a **server-side hasher** (Edge function / privileged DB RPC / trusted
provisioning script in a secure env) that holds `WEBHOOK_SECRET_PEPPER` and returns only `v1:<hex>` — so the pepper
never leaves the Edge boundary or touches the operator machine. **If this hasher does not yet exist, building it is a
prerequisite for a live-grade rotation**; until then, rotations rely on the local fallback (§3), which is **NO-GO for
live unless Oren explicitly approves** per bot. Track as a rotation-hardening item.

---

## Revision — Codex CHANGES round 1 applied (2026-07-06)
1. **Server-side hashing is now the preferred path (§3/§9/§10):** operator supplies only the token; a server-side hasher
   holds the pepper and returns `v1:<hex>`. Local pepper-based computation is a **fallback = NO-GO for live** unless Oren
   explicitly approves.
2. **New-token proof must be observable (§8):** DB-observable primary (disarmed + queue-off → `webhook_logs=1` = accepted
   vs old-token `webhook_logs=0`; then scoped cleanup), or an exported Edge `invalid_action` log line. **No PASS without
   the artifact.**
3. **Rollback never restores a burned token for normal use (§5):** preferred rollback = generate a THIRD fresh token and
   re-rotate; old-hash restore is emergency-only / disarmed-only / short-lived / **never live**; the old token stays
   compromised.

---

## Rotation runs — results log (via the server-side hasher)
_updated by Codex at Oren request._ All runs: server-side hasher (operator never handled `WEBHOOK_SECRET_PEPPER`),
`dry_run` → Doppler → `commit` CAS; new token **hash-proven, NOT live-fired**; old token **`invalid_secret`, 0 side
effects**; only the target bot changed; disarmed throughout; no mainnet/real funds.

| Bot | Date | Old fp → New fp | commit | Old-token-fails | Status |
|-----|------|-----------------|--------|-----------------|--------|
| **BNBUSDT** `36b46eb3` | 2026-07-08 | `c4da7f8a..1dd16670` → `0d4109bf..70c3754a` | CAS `updated_rows:1` (after a 409 `dry_run_fingerprint_mismatch` recovery — token regenerated mid-flow) | `webhook_logs=0`, 0 trades | ✅ COMPLETE + PASS ([BNB runbook](production-bnbusdt-rotation-runbook.md)) |
| **XRPUSDT** `297dddb9` | 2026-07-08 | `6c7c3d53..6f551029` → `f28d7c14..6563b0b2` | CAS `updated_rows:1` (clean first-try, **no 409**) | `webhook_logs=0` (`xrprot-old-1783498214`), 0 trades | ✅ COMPLETE + PASS |
| **SOLUSDT** `5acc84c9` | 2026-07-08 | `08efe60b..43946740` → `3dd79dcb..7f305e9a` | CAS `updated_rows:1` (after a **gateway 401** JWT-expiry — no write; clean commit after `OP_JWT` refresh) | `webhook_logs=0` (`solrot-old-1783499901`), 0 trades | ✅ COMPLETE + PASS |

**🎉 ALL THREE CAMPAIGN TOKENS ROTATED** (2026-07-08) — token-exposure debt fully cleared via the server-side hasher.

**Lessons (all runs):** (1) do **not** re-run the `NEW_TOKEN=$(openssl…)` generate line mid-flow — the CAS
`dry_run_fingerprint` binding guard 409s (correctly) on a regenerated token (BNB). (2) A **gateway 401** (JWT expiry)
causes **no DB write** — refresh **only** `OP_JWT` and re-run the same commit (SOL). Never regenerate the token to "fix" a 401.

**Current hash fingerprints (2026-07-08):** BNB `0d4109bf..70c3754a` · XRP `f28d7c14..6563b0b2` · SOL `3dd79dcb..7f305e9a` (all rotated).
