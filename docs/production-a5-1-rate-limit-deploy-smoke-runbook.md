# A5-1 Webhook Rate Limit (H1) — Deploy + Smoke Runbook

> **RUN — DEPLOYED + ENABLED on testnet (2026-07-08) · Codex PASS.** _updated by Codex at Oren request._ See
> "Deploy+smoke run — results" at the end. Finishes the already-built H1 rate-limit slice
> ([A5 plan](production-a5-hardening-implementation-plan.md)); the limiter code is committed (`1f33b35`+`c86437b`) and
> **already deployed with the webhook** but **inert** (flag OFF, migration 017 not applied).

## Current state (read-only, 2026-07-08)
- **Code:** `_shared/rate-limit.ts` + webhook H1a (per-IP, pre-auth) / H1b (per-bot, post-auth) gates — **deployed**,
  gated by `WEBHOOK_RATE_LIMIT_ENABLED` (default **false** ⇒ `shouldRun*Gate=false` ⇒ gates skipped ⇒ no `webhook_rate_bump` call).
- **Migration 017** (`webhook_rate_limits` table + `webhook_rate_bump(text,timestamptz)` RPC, RLS deny-all / service_role only):
  **file exists, NOT applied** — table + RPC absent in DB (verified 0/0).
- **Config:** `WEBHOOK_RATE_IP_PER_MIN` (default 60), `WEBHOOK_RATE_BOT_PER_MIN` (default 20),
  tier = `PRAXIS_IS_PRODUCTION==="true" ? live : testnet`, `failMode`: **testnet=open, live=ALWAYS closed** (override can't
  force live open).
- **Ordering rule:** apply 017 **before** enabling the flag — else a flag-on webhook calls a missing `webhook_rate_bump`
  ⇒ `rate_store_error` ⇒ fail-open (testnet), i.e. the limiter is inert + logs errors.

## Roles
Operator runs all deploys / migration apply / secret changes / webhook fires; **Claude runs read-only DB read-backs.**

## 1. Pre-checks (all must hold)
```bash
git status --short          # empty (clean)
git log --oneline -1        # origin/main up to date incl. latest token-rotation docs (14d9f5b or later)
cd supabase/functions
deno check webhook/index.ts _shared/rate-limit.ts        # Check, no errors
deno test _shared/rate-limit.test.ts                     # ok | 14 passed | 0 failed
deno check webhook/index.ts                              # (webhook check) Check, no errors
```
```sql
-- disarmed (read-only)
SELECT 'enabled_bots' k, count(*)::text v FROM public.bots WHERE trading_enabled AND deleted_at IS NULL
UNION ALL SELECT 'queue_length', public.pgmq_queue_length('trade_signals')::text
UNION ALL SELECT 'q_trade_signals', count(*)::text FROM pgmq.q_trade_signals
UNION ALL SELECT 'open_trades', count(*)::text FROM public.trades WHERE status::text IN ('pending','submitted','unknown')
UNION ALL SELECT 'trades_dlq', count(*)::text FROM public.trades_dlq
UNION ALL SELECT 'worker_state', worker_state FROM public.worker_status
UNION ALL SELECT 'is_production', is_production::text FROM public.worker_status;
-- REQUIRE: enabled_bots=0, queue=0, q=0, open_trades=0, dlq=0, worker disabled, is_production=false
```

## 2. Migration 017 — surgical apply (gated)
- **Verify file exists:** `supabase/migrations/017_webhook_rate_limits.sql`.
- **Verify absent before apply (READ-ONLY):**
  ```sql
  SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='webhook_rate_limits') AS tbl,
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='webhook_rate_bump') AS fn;
  -- expect tbl=0, fn=0
  ```
- **Apply (operator, transaction-wrapped surgical — NOT `db push`, NOT tracked; consistent with 010–016/018):**
  ```bash
  supabase db query --linked --file supabase/migrations/017_webhook_rate_limits.sql
  ```
  *(The file has no `begin/commit`; if you want it wrapped, I'll add `begin;…commit;` as a tiny commit first — recommended.)*
- **Read-back (Claude, READ-ONLY):** table exists; `webhook_rate_bump(text,timestamptz)` exists; RLS **on**;
  EXECUTE `service_role=true`, `public/anon/authenticated=false`; table GRANTs service_role-only. Add 017 to the **A2
  migration ledger** (applied-surgically-untracked) afterward.

## 3. Deploy — redeploy webhook (flag stays OFF)
```bash
supabase functions deploy webhook
```
- The rate-limit code is already live; this redeploy is a clean confirmation from the current commit. **`WEBHOOK_RATE_LIMIT_ENABLED`
  remains unset/false** ⇒ gates still skipped.

## 4. Smoke — flag OFF (limiter inert, behaviour unchanged)
- **Wrong-token negative** (no valid token needed): fire a bogus token → **200**, **0 side effects**.
  ```bash
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
    "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/36b46eb3-9384-4e05-a79b-1246e9b85119/bogus-a51-flagoff" \
    -H 'content-type: application/json' -d '{"signal_id":"a51-flagoff-wrongtoken","action":"buy"}'
  ```
- **Read-back:** `webhook_logs` for `a51-flagoff-wrongtoken` = **0**; `webhook_rate_limits` table **empty** (flag off ⇒ no
  `webhook_rate_bump` call); queue/q/trades/DLQ = 0; worker disabled.
- **Secret handling (not a log claim):** **no real campaign token is intentionally sent** in this smoke (wrong/bogus
  tokens only). Edge-function **log redaction is covered by static audit / H4**; a **live log grep is NOT RUN** unless the
  Edge logs are exported. DB **audit rows are readable** and asserted to carry no token/hash (§7).

## 5. Enable the flag — TESTNET ONLY (low limits for the smoke)
Set as Supabase Edge secrets, then redeploy to pick up:
```bash
# testnet only — PRAXIS_IS_PRODUCTION stays false/unset ⇒ tier=testnet, failMode=open
supabase secrets set WEBHOOK_RATE_LIMIT_ENABLED=true WEBHOOK_RATE_IP_PER_MIN=3 WEBHOOK_RATE_BOT_PER_MIN=2
supabase functions deploy webhook
```
- **Low limits (IP=3, bot=2)** make the over-limit trigger clean in the smoke; we reset to normal (60/20) in §8-final.
- **Never set `PRAXIS_IS_PRODUCTION=true`** here — testnet only.

## 6. Smoke — rate limiter ON (all with WRONG tokens; no real token exposure)
The per-IP gate is **pre-auth**, so wrong-token fires exercise it — no valid token needed (keeps the freshly-rotated
tokens clean).
- **6a per-IP over-limit rejects:** fire **> IP limit** wrong-token requests from your IP in one 60s window (e.g. 5×
  with `IP_PER_MIN=3`); the ones past the limit → **200, NO enqueue**.
  ```bash
  for i in 1 2 3 4 5; do curl -sS -o /dev/null -w "ip-fire $i -> %{http_code}\n" -X POST \
    "https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook/36b46eb3-9384-4e05-a79b-1246e9b85119/bogus-a51-ip-$i" \
    -H 'content-type: application/json' -d "{\"signal_id\":\"a51-ip-$i\",\"action\":\"buy\"}"; done
  ```
- **6b per-bot budget NOT consumed by wrong-token:** because the per-bot gate is **post-auth**, wrong-token requests
  (rejected at auth) never reach it ⇒ **no `bot:` bucket** is created. Proven by the read-back (§7): only `ip:` buckets, no `bot:` buckets.
- **6c valid-under-limit + post-auth per-bot limiter:** **NOT live-fired.** No valid token is sent (it would re-expose a
  freshly-rotated token ⇒ re-rotation before live). The **per-bot post-auth limiter is unit-tested + code-reviewed**
  (`rate-limit.test.ts` — 14/14, incl. "per-bot under limit ⇒ pass", "per-bot over limit ⇒ reject", "wrong-token NEVER
  runs the per-bot gate"), not live-exercised here.

**What this smoke DOES vs DOES NOT live-prove (be precise):**
- **DOES (live):** the **per-IP limiter** (over-limit ⇒ 200/no-enqueue); **wrong-token cannot drain the per-bot budget**
  (`bot:` buckets stay 0); **no enqueue / trade / DLQ**.
- **DOES NOT (live):** the **post-auth per-bot limiter with a valid token** — intentionally **NOT RUN** to avoid
  valid-token exposure; its correctness rests on the **unit tests + code review**. A full valid-token per-bot live
  exercise would require an approved token exposure (then re-rotation) — a separate, explicit decision.
- **H1 live evidence = per-IP limiting + wrong-token-budget protection + no side effects** — *not* a full valid-token
  per-bot live exercise.

## 7. Read-backs (after the ON smoke)
```sql
SELECT 'queue_length' k, public.pgmq_queue_length('trade_signals')::text v
UNION ALL SELECT 'q_trade_signals', count(*)::text FROM pgmq.q_trade_signals
UNION ALL SELECT 'a51 webhook_logs (0 = none enqueued)', count(*)::text FROM public.webhook_logs WHERE signal_id LIKE 'a51-%'
UNION ALL SELECT 'a51 trades (0)', count(*)::text FROM public.trades WHERE signal_id LIKE 'a51-%'
UNION ALL SELECT 'trades_dlq (0)', count(*)::text FROM public.trades_dlq
UNION ALL SELECT 'rate_limits ip buckets (>0)', count(*)::text FROM public.webhook_rate_limits WHERE bucket_key LIKE 'ip:%'
UNION ALL SELECT 'rate_limits bot buckets (want 0 — wrong-token never touches bot budget)', count(*)::text FROM public.webhook_rate_limits WHERE bucket_key LIKE 'bot:%'
UNION ALL SELECT 'webhook_rate_limited audit (>=1, dim=ip)', count(*)::text FROM public.audit_logs WHERE event_type='webhook_rate_limited'
UNION ALL SELECT 'worker_state', worker_state FROM public.worker_status;
```
**Require:** queue/q/trades/DLQ = 0; `ip:` buckets > 0 (some count > limit); **`bot:` buckets = 0**; a
`webhook_rate_limited` audit exists (dim=ip); worker disabled. **DB audit rows carry no token/hash** (verifiable read).
**No real campaign token was sent** (wrong tokens only); Edge-log redaction = static audit / H4 (live grep NOT RUN unless logs exported).

## 8. Final state + rollback
- **Final flag state — EXPLICIT operator decision after smoke PASS** (choose one):
  - **A — leave ON at normal testnet limits (60/20)** — *default if continuing toward testnet-live*:
    ```bash
    supabase secrets set WEBHOOK_RATE_IP_PER_MIN=60 WEBHOOK_RATE_BOT_PER_MIN=20   # WEBHOOK_RATE_LIMIT_ENABLED stays true
    supabase functions deploy webhook
    ```
  - **B — turn OFF, document deploy-readiness only** — *default if stopping after the smoke*:
    ```bash
    supabase secrets set WEBHOOK_RATE_LIMIT_ENABLED=false
    supabase functions deploy webhook
    ```
  - Record the chosen state. (A5-1 "**deployed**" = 017 applied + code live; "**enabled**" = flag on. The two are separate.)
- **Rollback:**
  1. **Flag off first:** `supabase secrets set WEBHOOK_RATE_LIMIT_ENABLED=false` → redeploy webhook (limiter inert again; behaviour reverts).
  2. **Redeploy previous webhook bundle** only if a *verifier* regression appears (redeploy the whole known-good commit, per the hasher runbook §6 — never a partial single-file checkout).
  3. **017 leave/drop by explicit decision only:** the table/RPC are additive + inert with the flag off — normally **leave**. A drop (`DROP FUNCTION`/`DROP TABLE`) is a separate gated call.

## 9. Stop conditions (any ⇒ halt + §8 rollback)
- **Any enqueue / trade / DLQ row** from a rate-limit smoke fire (a rate-limit reject must NEVER enqueue).
- **Any unexpected 5xx** (a `503` is only valid for the missing-pepper config path; a 5xx from the limiter is a fault).
- **Wrong-token behaviour changes** (no longer uniform 200, or it enqueues / writes `webhook_logs`).
- **Rate limiter fails OPEN in live mode** — must never happen (`failMode(live)` is always `closed`); if `PRAXIS_IS_PRODUCTION`
  were true and a store error fell open, that's a critical bug. (This smoke is testnet; do not set production tier.)
- **Any token / hash / pepper / secret in a DB audit row** (observable). *(Edge-function log redaction is covered by
  H4 / static audit; a live log grep is not part of this smoke unless logs are exported.)*

## 10. GO / NO-GO
- **Planning only** — nothing applied/deployed/enabled. Execution is operator-run, gated, after Codex PASS + Oren approval.
- **Testnet A5-1 = GO** when 017 applied + flag-on smoke passes (per-IP rejects, per-bot budget protected, no side effects).
- **Real funds = NO-GO** regardless — plus live tier requires the `failMode=closed` behaviour proven under a store outage
  (a later real-funds hardening test), and the other MUST gates (A11/A1/A4/A8/A2).

---

## Revision — Codex CHANGES round 1 applied (2026-07-08)
1. **No over-claim of per-bot live proof (§6):** the smoke live-proves **per-IP limiting + wrong-token-budget protection +
   no side effects** only. The **post-auth per-bot limiter is unit-tested/code-reviewed, NOT live-fired** (to avoid
   valid-token exposure); a full valid-token per-bot live exercise is a separate, explicitly-approved decision.
2. **No "no secrets in logs" claim without export (§4/§7/§9):** replaced with — no real campaign token is sent (wrong
   tokens only); **DB audit rows are readable and asserted clean**; Edge-log redaction = static audit / H4; a **live log
   grep is NOT RUN** unless logs are exported.
3. **Explicit final-flag decision (§8):** after smoke PASS, operator chooses **A) leave ON at 60/20** (default if
   continuing toward testnet-live) or **B) turn OFF, deploy-readiness only** (default if stopping). Record the choice.

---

## Deploy+smoke run — results (DEPLOYED + ENABLED · Codex PASS · 2026-07-08)
_updated by Codex at Oren request._

**Outcome: A5-1 H1 rate limiter = DEPLOYED + ENABLED on testnet.** Operator ran all mutations/deploys; Claude read-backs.

- **Pre-checks passed:** git clean (`02a4e4f`+`9dc0b1c`); deno check; rate-limit tests **14/14**; disarmed; 017 absent; no
  `WEBHOOK_RATE_*` secrets (flag off/defaults).
- **Migration 017 applied surgically (transaction-wrapped):** read-back — `webhook_rate_limits` table exists;
  `webhook_rate_bump(text,timestamptz)` RPC exists; **RLS enabled**; **service_role** INSERT/EXECUTE = true;
  **anon/authenticated denied**; table empty.
- **Webhook redeployed.**
- **Flag-OFF smoke PASS:** wrong-token → 200, `webhook_logs=0`, `webhook_rate_limits` empty (no bump), 0 side effects.
- **Flag-ON low-limit smoke PASS** (`ENABLED=true`, `IP=3`, `bot=2`, testnet): **5 wrong-token requests all HTTP 200**;
  **`ip:` bucket count = 5 (> limit 3)**; **`webhook_rate_limited` audit = 2, dimension = ip**; **`bot:` bucket rows = 0**
  (wrong-token never touches the per-bot budget); **no enqueue** (a51-ip `webhook_logs`/trades = 0). No valid token fired;
  no real campaign token exposed.
- **Disarmed throughout:** queue=0, q=0, open_trades=0, DLQ=0, enabled_bots=0, worker disabled, is_production=false.
- **Final resting state (chosen A):** `WEBHOOK_RATE_LIMIT_ENABLED=true`, `WEBHOOK_RATE_IP_PER_MIN=60`,
  `WEBHOOK_RATE_BOT_PER_MIN=20` (values confirmed via `secrets list` SHA-256 digests), **`PRAXIS_IS_PRODUCTION` absent →
  testnet** (fail-open; live tier fails closed).
- **Scope/caveats:** live-proof = per-IP limiter + wrong-token-budget protection + no side effects. **Post-auth per-bot
  limiter with a valid token = NOT live-fired** (unit-tested/code-reviewed). **H4 live-log grep = separate / NOT RUN**
  (needs log export). **Migration 017 added to the A2 migration ledger as applied-untracked.**
- **No mainnet · no real funds.**

**A5 status after run:** H1 rate-limit **done** (deployed + enabled testnet). **Remaining A5 = H4 live-log grep** (+ the
per-bot valid-token live exercise if/when a token exposure is approved). Real funds = NO-GO (live fail-closed proof +
A11/A1/A4/A8/A2).
