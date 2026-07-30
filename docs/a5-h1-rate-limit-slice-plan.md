# A5-1 — H1 Rate Limit — Implementation Plan (PLAN ONLY, awaiting coding approval)

**Status:** PLAN — no code, no deploy, no endpoint fire, no DB live mutation, no arm. Grounded in the actual
`supabase/functions/webhook/index.ts` + A5 plan Appendix C. Coding starts **only after explicit approval**.
**Invariant:** flag **off by default** ⇒ webhook behavior byte-identical to today.

---

## 1. Files touched
| File | Change | Applied? |
|------|--------|----------|
| `supabase/functions/_shared/rate-limit.ts` | **NEW** — pure logic: `windowStart(now)`, `ipKey(ip,win)`, `botKey(bot,win)`, `overLimit(count,limit)`, `failMode(tier)`. No I/O. | code (not deployed) |
| `supabase/functions/webhook/index.ts` | Add H1a (per-IP, pre-auth) + H1b (per-bot, post-auth) **inside a flag guard**; reject = uniform `200` + audit, no enqueue. | code (not deployed) |
| `supabase/migrations/017_webhook_rate_limits.sql` | **NEW FILE** — table + atomic `webhook_rate_bump` RPC + grants. **NOT applied** (gated, like 015/016). | file only |
| `supabase/functions/_shared/rate-limit.test.ts` | **NEW** — `deno test` unit + decision tests (pure + mock store). | test |

## 2. Data model (migration 017 — FILE, NOT applied)
```sql
CREATE TABLE public.webhook_rate_limits (
  bucket_key   text        NOT NULL,     -- 'ip:<ip>:<win>' | 'bot:<uuid>:<win>'
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
ALTER TABLE public.webhook_rate_limits ENABLE ROW LEVEL SECURITY;   -- no policies (deny-all; service_role bypasses)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_rate_limits TO service_role;

-- atomic insert-or-increment; returns the new count (supabase-js .upsert() can't increment)
CREATE FUNCTION public.webhook_rate_bump(p_key text, p_window timestamptz)
RETURNS integer LANGUAGE sql AS $$
  INSERT INTO public.webhook_rate_limits (bucket_key, window_start, count)
  VALUES (p_key, p_window, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = public.webhook_rate_limits.count + 1
  RETURNING count;
$$;
REVOKE ALL ON FUNCTION public.webhook_rate_bump(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.webhook_rate_bump(text, timestamptz) TO service_role;
```
- **Cleanup:** old buckets pruned opportunistically (`DELETE … WHERE window_start < now() - interval '1 hour'`) — a
  follow-up cron/opportunistic delete (noted, not blocking A5-1). Fixed 60s window (`window_start = date_trunc('minute')`).
- **Store choice:** Postgres (reuses the webhook's existing service_role `sb` client). Deno KV / Upstash deferred
  (adds a runtime dependency + secret). *(Trade-off noted: H1a adds one pre-auth RPC per request; acceptable at TV volume.)*

## 3. Feature flags (Edge env; read PER-REQUEST so toggling is instant, no redeploy)
| Env | Default | Meaning |
|-----|---------|---------|
| `WEBHOOK_RATE_LIMIT_ENABLED` | **`false`** | master flag — off ⇒ zero new code path executes |
| `WEBHOOK_RATE_IP_PER_MIN` | e.g. `60` | per-IP limit / 60s |
| `WEBHOOK_RATE_BOT_PER_MIN` | e.g. `20` | per-bot limit / 60s |
| `WEBHOOK_RATE_FAILMODE` | tier-derived | store-error behavior: testnet=open, live=closed (override) |

## 4. Exact webhook integration (gate order — matches Appendix C)
```
… parse(bot_id, token) → source_ip
  → [H1a per-IP]   if ENABLED: c = rpc webhook_rate_bump('ip:'+ip+':'+win)
                   c > IP_PER_MIN ⇒ audit webhook_rate_limited(dim=ip) + return ok() (200, NO enqueue)
  → bot lookup → HMAC auth (authed)               ← wrong token rejects HERE (200), before H1b
  → [H1b per-bot]  if ENABLED && authed: c = rpc webhook_rate_bump('bot:'+bot_id+':'+win)
                   c > BOT_PER_MIN ⇒ audit webhook_rate_limited(dim=bot) + return ok() (200, NO enqueue)
  → active gate → parse body → signal_id/action → webhook_logs upsert (dedup) → pgmq_send (enqueue)
```
- **Null source_ip** ⇒ `ip:unknown:<win>` bucket (throttles the aggregate; never skipped).
- **Store error (rpc fails):** tier-based per Appendix C — **testnet: fail-OPEN** + `webhook_rate_limit_degraded`;
  **live: fail-SAFE = uniform `200` + NO enqueue** + `webhook_rate_limit_failclosed` + alert (**no 503, no status leak,
  never fail-open**).
- **Audit** (`audit_logs`, entity_type=`webhook_log`, `ip_address`, non-secret after_state): `webhook_rate_limited`
  {dimension, limit, count, window_start, tier}; `webhook_rate_limit_degraded`/`_failclosed` {dimension, reason, tier}.

## 5. Tests (`deno test`, no live endpoint)
1. **Pure unit:** `windowStart` (60s bucket), `ipKey`/`botKey` format, `overLimit` boundary (count==limit passes; >limit fails).
2. **Per-IP throttle (mock store):** N+1 same-IP in a window ⇒ excess flagged; key is IP-only.
3. **Per-bot post-auth (mock store):** bot key increments **only** when `authed=true`.
4. **Flag-off parity:** with `WEBHOOK_RATE_LIMIT_ENABLED=false`, every outcome (accept / dedup / invalid-token /
   invalid-payload / inactive / not-found) is **identical** to baseline; the store rpc is **never called**.
5. **Tiered fail-mode:** store error ⇒ testnet fail-open+degraded audit; live uniform-200+no-enqueue+failclosed audit.

## 6. Rollback / disable
- **Instant:** set `WEBHOOK_RATE_LIMIT_ENABLED=false` (read per-request ⇒ no redeploy) ⇒ current behavior.
- Redeploy the prior webhook function if needed.
- Migration rollback (if 017 was applied): `DROP FUNCTION public.webhook_rate_bump; DROP TABLE public.webhook_rate_limits;`
- **No trading state is touched by any of this** (no queue, no bots, no orders).

## 7. Required proofs (the three you asked for)
- **P1 — flag off preserves current webhook behavior:** the entire H1a/H1b block is wrapped in
  `if (RATE_LIMIT_ENABLED) { … }`; off ⇒ **no new statement executes**. *Proof = Test 4 (flag-off parity across all
  outcomes) + a code diff showing every addition is inside the flag guard.*
- **P2 — bad-token cannot drain bot budget:** H1a is keyed by **IP only** (no `bot_id`) and runs **pre-auth**; H1b runs
  **only after `authed=true`**. A wrong-token request rejects at auth **before** H1b ⇒ the **bot key is never bumped**.
  *Proof = Test 3 + a wrong-token-burst test asserting `botKey` count stays 0 while only `ipKey` increments.*
- **P3 — rate-limited requests do not enqueue:** on an H1a/H1b reject the handler `return ok()` **before** the
  `webhook_logs` upsert and `pgmq_send`. *Proof = a test asserting `pgmq_send` (and the `webhook_logs` upsert) are
  **not called** on a rate-limit reject; `queue_length` unchanged.*

## 8. Out of scope / still forbidden
No deploy · no endpoint fire · no `QUEUE_ENABLED=true` · no `trading_enabled=true` · no mainnet · no real funds · no DB
**live** mutation (017 is a file, applied only on separate approval). H2/H3/H4/H5/H6/A10 are separate later slices.

## 9. Runtime / CI verification — what ran vs. what is REQUIRED but NOT RUN (per Codex round-2)
**Local environment:** `deno` **ABSENT** · `supabase` CLI **not logged in** · no `.github/workflows` · no `deno.json`.
- ✅ **RAN — pure module:** `node --test supabase/functions/_shared/rate-limit.test.ts` → **11/11 pass** (runtime-agnostic
  logic: config/keys/overLimit/failMode/enforce/gate-decisions).
- ✅ **RAN — `deno check` (deno 2.9.1). Both modules PASS.**
  - `_shared/rate-limit.ts` ⇒ type-clean; `webhook/index.ts` ⇒ **PASS** after the crypto typing pre-fix (below).
  - **Crypto typing pre-fix (Codex-approved, in-package):** `b64urlToBytes` / `hexToBytes` return type
    `Uint8Array` → `Uint8Array<ArrayBuffer>` (what `new Uint8Array(n)` already produces), so they satisfy `BufferSource`
    in `crypto.subtle.importKey` / `verify`. **Type-only — zero runtime / auth / rate-limit behavior change.** (The 2
    errors were pre-existing; proven identical on `HEAD` before the fix.)
  - **Handler runtime is NOT claimed verified.** Recommended follow-up (now feasible with deno installed): Deno
    **handler** tests with a mock `sb` (flag-off parity / wrong-token ⇒ no bot bump / rate-limited ⇒ no `pgmq_send`),
    purely local/mocked — a `supabase-edge-check` CI job.
- ⛔ **NOT RUN — live DB read-back.** CLI not logged in (operator will handle `supabase login`/token). Live disarmed/017
  evidence is **NOT claimed from this run.**
- ⛔ **NOT RUN — live DB read-back.** `supabase db query --linked` ⇒ *"Access token not provided"* (CLI not logged in).
  The live read-back (017 absent / `QUEUE_ENABLED` / `enabled_bots` / `queue_length`) **was NOT run and is NOT used as
  evidence.** Re-login (or `SUPABASE_ACCESS_TOKEN`) enables it. "017 not applied" is asserted **structurally only**
  (new untracked file; zero apply commands run this session).
