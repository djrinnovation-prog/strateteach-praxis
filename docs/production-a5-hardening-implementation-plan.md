# A5 Webhook / TradingView Hardening — Implementation Plan (PREPARED, NOT LIVE)

**Status:** PLAN ONLY — no execution. **A5 = OPEN** and stays open until H1–H6 each have evidence.
**Date:** 2026-07-01 · **Owner (impl):** Praxis · **Gate:** A5 · Grounded in `supabase/functions/webhook/index.ts`.
Companion to `production-tradingview-readiness-prepared-not-live.md` (contract + negative tests + rollback).

> Standing (unchanged): `QUEUE_ENABLED=false` · all 5 bots `trading_enabled=false` · testnet only · nothing
> armed/fired. This plan does not deploy, arm, or fire anything. No mainnet, no real funds.

**Owner legend:** Praxis = design/impl/tests · Operator = secrets/deploy/IP-list/platform-logs · Oren = live approval.
**Global rollback primitive:** every control ships behind an env feature-flag → disable = revert to prior behavior;
all rollbacks verified by raw read-back (`queue_length` / `worker_status` / bot status).

---

## H1 — Rate limit / abuse control
- **Goal:** cap request rate per `bot_id` and per source IP; excess rejected without side effect.
- **Approach:** in-Edge sliding-window counter (dedicated `webhook_rate_limits` table keyed by `(bot_id, minute)` and
  `(ip, minute)`; service_role). On exceed → **uniform 200, no enqueue** + `audit_logs webhook_rate_limited`. **Never 5xx**
  (avoid TradingView retry storms). Feature-flag `WEBHOOK_RATE_LIMIT` (Edge env).
- **Owner:** Praxis (impl) · Operator (deploy + thresholds).
- **Exact evidence:** integration test — burst > N/min from one bot/IP ⇒ all excess return 200, `queue_length` unchanged,
  `webhook_rate_limited` audit rows present; under-limit passes. Testnet burst (disarmed ⇒ cannot order).
- **Stop condition:** a legit signal dropped with no audit row · any 5xx under load · any enqueue past the limit.
- **Rollback:** `WEBHOOK_RATE_LIMIT=off` → prior behavior; or redeploy the previous webhook function.

## H2 — Source IP allowlist / validation
- **Goal:** accept only TradingView's published egress IPs. **Optional for internal-beta / prepared-not-live;
  MANDATORY before live execution / real funds.**
- **Approach:** allowlist (config = Edge env `WEBHOOK_IP_ALLOWLIST` or a small table) of the current TradingView
  webhook IPs (operator confirms the published set at deploy). Validate the first `x-forwarded-for` hop; non-allowlisted →
  **200, no enqueue** + `audit_logs webhook_ip_rejected`. Feature-flag `WEBHOOK_IP_ALLOWLIST_ENABLED`.
- **Owner:** Praxis (impl) · Operator (maintain the IP list + deploy).
- **Exact evidence:** request from a non-allowlisted IP ⇒ 200, no enqueue, audit row; allowlisted IP passes to auth;
  the IP source/list is documented + dated.
- **Stop condition:** TradingView changes IPs and legit signals are silently blocked (needs alerting) · misconfig blocks
  all / allows all · `x-forwarded-for` not from a trusted proxy (spoofable) — verify the Supabase edge XFF chain first.
- **Rollback:** `WEBHOOK_IP_ALLOWLIST_ENABLED=off` → prior behavior.

## H3 — Replay / freshness window
- **Goal:** reject stale/replayed signals beyond a freshness window (complements the existing dedup).
- **Approach:** bound `fire_time` to ± window (e.g. 120s) — absent/older ⇒ **200, no enqueue** + `audit_logs webhook_stale`.
  Keeps `UNIQUE(bot_id, signal_id)` dedup. **Contract change:** `fire_time` is currently advisory/optional → making it a
  freshness gate requires deciding it is **required for live**. Feature-flag `WEBHOOK_FRESHNESS_WINDOW_S`.
- **Owner:** Praxis (impl + contract decision) · Operator (deploy).
- **Exact evidence:** old/absent `fire_time` ⇒ rejected stale; fresh ⇒ passes; dedup still enforced; clock-skew tolerance
  tested (both directions).
- **Stop condition:** clock skew rejects valid signals · `fire_time` unreliable from TradingView · window too tight/loose.
- **Rollback:** widen or disable via `WEBHOOK_FRESHNESS_WINDOW_S`; revert to dedup-only.

## H4 — Log-redaction audit (Edge + worker)
- **Goal:** prove the token / pepper / full-URL / stored-hash are **never** logged.
- **Approach:** static audit of every `log()` / `console.log` call-site in `webhook/index.ts` + worker; add an Edge
  redaction test mirroring `worker/tools/lib/safe-payload.test.ts`; grep live Supabase Edge logs + Railway worker logs over
  a window for token/URL/pepper/hash patterns.
- **Owner:** Praxis (audit + test) · Operator (pull platform logs).
- **Exact evidence:** a call-site audit table (field-by-field), a passing redaction test, and platform-log grep = **0 hits**.
- **Stop condition:** any token/pepper/full-URL/stored-hash substring in any log or audit row (treat a historical leak as an
  incident → rotation).
- **Rollback:** patch the offending log call + redeploy (audit itself is read-only).

## H5 — Negative tests N1–N6
- **Goal:** prove every reject path **cannot enqueue / trade / order** (per readiness packet §7).
- **Approach:** execute **N1** (wrong token — zero-secret) first, then **N2–N5** (valid token + invalid payload —
  operator-run) on **TESTNET**. **Only after explicit approval; not run yet.**
- **Owner:** Praxis (N1 on approval) · Operator (N2–N5 — valid-token custody).
- **Exact evidence:** each Ni ⇒ 200 + reject reason in logs + `queue_length=0` + 0 `webhook_logs.accepted` + 0 trades/orders
  (raw read-back before/after).
- **Stop condition:** any enqueue / accepted row / trade / order · any 503 on a wrong-token test.
- **Rollback:** none (no trading mutation); if an enqueue somehow occurs → purge the queue message + disarm + investigate.

## H6 — Controlled TESTNET positive test
- **Goal:** prove the full webhook → queue → worker → **testnet** path with **exactly one** filled order, then disarm.
- **Approach:** one bot, one valid signal, TESTNET only; mirrors the S5 smoke. **Requires the S5 arm gate (migration/config)
  + Oren written approval.** `QUEUE_ENABLED` flips true **only** inside the approved window, then back to false.
- **Owner:** Praxis (execute) · **Oren (approve — blocking).**
- **Exact evidence:** one filled testnet order via the webhook path; audit `trade.created → trade.filled`; then re-disarm
  verified by **raw read-back** (`enabled_bots=0`, `QUEUE_ENABLED=false`, `queue_length=0`).
- **Stop condition:** more than one order · any mainnet · a blocked order (SAFE STOP, not a pass) · disarm not raw-verified.
- **Rollback:** disarm (`QUEUE_ENABLED=false`, `trading_enabled=false`) + raw read-back; kill-switch per readiness §10.

---

## Sequencing & dependencies
- **Now (prepared, no arming):** H1, H2, H3, H4 are designable/implementable + testable without arming (reject-path +
  audit + local/testnet-negative). Each ships behind a feature-flag, deployed by the operator.
- **After approval:** H5-N1 (zero-secret) → H5 N2–N5 (operator, valid token).
- **Last, gated:** H6 — needs S5 arm gate + Oren approval; testnet only; single order; immediate disarm.
- **Real-funds** stays blocked regardless (A11 not granted; A1/A2/A4/A8/A10 open).

## A5 close criteria
**A5 remains OPEN until H1–H6 each have cited evidence** (E1 runtime / E2 platform). Partial evidence ⇒ A5 stays OPEN
and TradingView stays *prepared, not live*. No control is "closed" by design intent alone — only by evidence.

## What this plan does NOT do
No live TradingView alert · no valid executable signal · no queue arm · no fire · no mainnet · no real funds · no DB
mutation · no Railway/worker change · no deploy · no token/pepper handling by the agent. Plan only; A5 stays OPEN.

---

## Appendix A — H4 log-redaction audit evidence (reproducible · 2026-07-01)
**H4 static code audit = CLEAN / exhaustive for repo runtime paths. H4 overall = PARTIAL. A5 = OPEN.**
Do **not** mark H4 Complete until live platform logs are checked.

### Commands (rerun to reproduce; read-only)
```bash
# 1. Webhook: sensitive tokens never in a log construct (expect: only req.url PARSE + "invalid_secret" label)
git grep -nE 'secret|PEPPER|req\.url|webhook_secret_hash|\.headers|raw_payload' -- supabase/functions/webhook/index.ts | grep -iE 'console|log\(|stringify'

# 2. Runtime EXHAUSTIVE: any risky value logged (expect: NONE)
git grep -nE '(message|error|detail|reason|body|url|headers|token|secret|payload|cause):\s*(e|err|error)\.(message|stack|response|config|request|toString)|(message|error|cause):\s*(e|err|error)\b|\.\.\.(e|err|error)\b|headers:\s|authorization|bearer|req\.url|JSON\.stringify\((e|err|error)\)' -- worker/src supabase/functions ':(exclude)*.test.ts' ':(exclude)*spike-*'

# 3. env secret value inside a log (expect: NONE)
git grep -nE 'console\.|log\(|stringify' -- worker/src supabase/functions ':(exclude)*.test.ts' | grep -iE 'process\.env|Deno\.env'

# 4. spike-* deployed? (expect: entrypoint dist/index.js -> spikes compiled, NOT executed)
git grep -nE '"(main|start)"' -- worker/package.json

# 5. post-fix proof (expect: NONE in runtime)
grep -rn 'rawMsg' worker/src
git grep -nE '\.message' -- worker/src supabase/functions ':(exclude)*.test.ts' ':(exclude)*spike-*' | grep -iE 'console|log\(|stringify'
```

### Results (2026-07-01)
- **#1** → only `new URL(req.url)` **parse** at `webhook/index.ts:129` (not logged) + `reason:"invalid_secret"` **label** at `:172`. No token / pepper / stored-hash / body / headers in any log.
- **#2** → **NONE** — no `err.message` / `.stack` / `headers` / full-error logged in any runtime path.
- **#3** → **NONE** — no `process.env` / `Deno.env` value inside any log.
- **#4** → `main=dist/index.js`, `start=node dist/index.js` → `spike-*` compiled but **not executed** in production.
- **#5** → `rawMsg` **NONE**; runtime `.message`-in-log **NONE**.

### Classification
| Surface | Result |
|---|---|
| Edge webhook (`supabase/functions/webhook/index.ts`) | **SAFE** — event/reason/bot_id/signal_id/side only |
| Worker runtime (`index.ts`, `BinanceAdapter.ts`, `VaultSecretsProvider.ts`, `reconciliation.ts`, `workerStatus.ts`, `heartbeat.ts`) | **SAFE** — error name/code + `safeExchangeDetail` (class+httpStatus) only; adapter/vault have no `console.*` |
| Poller/lib (`worker/tools/*`) | **SAFE** — explicit `redactDsn` / `redactSecrets` / `buildSafeAlert` |
| Dev spikes (`spike-binance.ts`, `spike-vault.ts`) | **not runtime** (compiled, not executed — entrypoint `dist/index.js`). **All raw `.message` logs REDACTED to class-name / code only** (option B): `spike-binance.ts:229` + `:320`, `spike-vault.ts:155` + `:181` + `:197`. Zero `.message` logging remains in the repo. |

### Pending for H4 = Complete (NOT done here)
- Live grep of **Supabase Edge logs** for token / full-URL / pepper / stored-hash → require **0 hits** (platform access, operator).
- Live grep of **Railway worker logs** for the same → require **0 hits** (platform access, operator).
Until both return 0, **H4 stays PARTIAL and A5 stays OPEN.**

---

## Appendix B — H4 live-log-grep runbook (operator-run; PREPARED, NOT RUN)
**Goal:** complete the live half of H4 — confirm no secret ever reaches the live logs. **Read-only log inspection
only.** No execution, no deploy, no fire, no arm. **Owner:** Operator (platform access) + Praxis (patterns).
**Do NOT run without operator platform access + approval.** Nothing here touches trading state.

### What must NEVER appear in any log line
per-bot **token**, **pepper** (`WEBHOOK_SECRET_PEPPER`), a **full webhook URL with a token**
(`/functions/v1/webhook/<uuid>/<token>`), the **stored hash** (`v1:<64 hex>`), **service_role** / `sb_secret_` /
`eyJ…` JWT, exchange **api-key/secret**, a **DSN** with password, `authorization` / `bearer` headers.

### B1 — Supabase Edge logs (the `webhook` function)
- **Where:** Supabase Dashboard → Edge Functions → `webhook` → Logs (or the Logs Explorer / Logs API). Export a window
  (e.g. since the last webhook deploy, or last 7 days).
- **Grep the exported logs — each must return 0:**
  ```bash
  grep -inE 'v1:[0-9a-f]{64}' edge_webhook_logs.txt                                   # stored hash
  grep -inE '/functions/v1/webhook/[0-9a-f-]{36}/[^"/?[:space:]]+' edge_webhook_logs.txt # full URL w/ token
  grep -inE 'pepper|WEBHOOK_SECRET|service_role|sb_secret_|eyJ[A-Za-z0-9_-]{15}' edge_webhook_logs.txt
  grep -inE 'authorization|bearer ' edge_webhook_logs.txt
  ```
- **Expected:** only structured lines `{fn:"webhook", event, reason, bot_id, signal_id, side}` — no secret, no raw body.

### B2 — Railway worker logs
- **Where:** Railway → worker service → Logs / Observability. Export a window.
- **Grep the exported logs — each must return 0:**
  ```bash
  grep -inE 'v1:[0-9a-f]{64}|pepper|service_role|sb_secret_|eyJ[A-Za-z0-9_-]{15}' worker_logs.txt
  grep -inE 'api[_-]?secret|api[_-]?key|BINANCE[A-Z_]*SECRET|postgres://[^[:space:]]*:[^@[:space:]]*@' worker_logs.txt
  grep -inE 'AuthenticationError:.+key|authorization|bearer ' worker_logs.txt        # full ccxt auth message
  ```
- **Expected:** structured event logs with error **name/code** + `safeExchangeDetail` (class+httpStatus) only.

### Evidence to capture (E2)
Per source: the exact filter/window used · the hit count (**must be 0**) · a few representative (redacted) log lines · date.

### STOP condition
**Any** hit (token / full-URL / pepper / stored-hash / exchange secret / DSN / bearer) ⇒ treat as a **leak incident**:
rotate the exposed secret (per readiness §6), patch the offending log call, redeploy — and **do NOT mark H4 complete**.

### Completion
Both B1 + B2 return **0 hits** ⇒ H4 → **Complete** (cite both). A5 still requires **H1, H2, H3, H5, H6**. Until then
H4 stays **PARTIAL** and A5 stays **OPEN**. This runbook is prepared, **not run**.

---

## Appendix C — H1 / H2 / H3 implementation design (DESIGN ONLY — no code) · REVISED
Design only; no code, no deploy, no endpoint test. All three insert into the `webhook/index.ts` gate chain. Each ships
behind an **independent feature flag** (disable = prior behavior).

### Response policy — when 200 vs when 503 (binding)
- **Uniform `200 {ok:true}`** — every **per-request business outcome**: accept, dedup-skip, invalid token,
  bot_not_found, bot_not_active, invalid payload, **IP-rejected (H2)**, **rate-limited (H1)**, **stale/invalid/missing
  fire_time (H3)**. Attacker cannot distinguish accept from reject. **No enqueue on any reject.**
- **Internal server config/infra fault BEFORE the `webhook_logs` insert** (missing pepper, bot-lookup DB error, auth
  config error, rate-store fault, allowlist config fault) — handled **by tier**:
  - **prepared / testnet:** **`503 {ok:false}`** generic (no structure detail) → TradingView retries a transient blip. Allowed.
  - **live / mainnet:** **uniform `200 {ok:true}` to the caller + NO enqueue + audit + internal alert.** Live must **not**
    leak internal config/infra state via HTTP status — the caller sees the same `200` as any business outcome; the fault
    is dropped, audited, and alerted server-side. *(Trade-off: the caller does not retry on a live transient fault →
    recovery via alert/operator or re-fire. Any different live policy is an **explicit Oren decision**, not a default.)*
  - This tier rule covers **all** internal faults, including the **existing** WB5 503 sites (pepper / DB / auth-config):
    applying the live→uniform-`200` override there changes WB5's current unconditional-503 retry behavior, so it is
    called out as a design decision (default per this rule; deviation = Oren).
- **Rule:** a *per-request* filter (bad IP / over-rate / stale) is **always `200`**. An *internal fault* is **`503` in
  prepared/testnet** and **uniform `200` + no-enqueue + audit + alert in live**. Both bodies uniform; **live never leaks
  status and never fails OPEN.**

### Exact order of checks (explicit)
```
pepper-config(503) → POST → parse(bot_id, token)
  → [H1a per-IP rate]  (PRE-auth flood guard; key = IP only — a bad-token flood hits the IP limit, never a bot budget)
  → bot lookup(503 DB err)
  → HMAC auth(503 config / 200 bad-token)
  → [H2 IP allowlist]  (POST-auth; defense-in-depth on top of the token)
  → [H1b per-bot rate] (POST-auth; key = bot_id — increments ONLY after valid auth)
  → active gate → parse body → signal_id + action
  → [H3 freshness]     (heuristic filter; NEVER replaces dedup)
  → webhook_logs upsert  (dedup = hard idempotency)  → enqueue
```
Deliberate deviation from a naive "auth → IP → rate": **H1a (per-IP) runs pre-auth** so a wrong-token flood is throttled
before the expensive HMAC + DB; **H1b (per-bot) and H2 run post-auth** so only authenticated traffic touches a bot's
budget or the IP gate. An unauthenticated attacker can never increment a bot key.

### XFF trust model (verify before H2 becomes a security gate)
- Current code reads `x-forwarded-for.split(',')[0]` = the **client-claimed** first hop → **spoofable**; unusable for a
  trust decision as-is.
- **Trusted client IP** = the entry inserted by the **last trusted proxy** (Supabase edge/gateway), not the left-most
  client value. **Action:** verify empirically how Supabase Edge populates `x-forwarded-for` (which hop / index it
  controls, or a dedicated header it sets).
- **If verified** → H2 reads the IP from that trusted position and enforces the allowlist (hard gate).
- **If NOT verified** → H2 stays **advisory only** (`webhook_ip_observed`, **no reject**) until proven; it must **not**
  be relied on as security while XFF is client-controlled. For **live**, an H2 hard gate is allowed **only** after
  XFF-trust is verified; else use platform/network allowlisting — and the **HMAC token remains the primary auth**.

### Audit events (H1/H2/H3) — `audit_logs`, `entity_type=webhook_log`, non-secret `after_state`, `ip_address`
| `event_type` | When | `after_state` (non-secret) |
|---|---|---|
| `webhook_rate_limited` | over per-IP or per-bot limit | `dimension`(ip\|bot), `limit`, `count`, `window_start`, `tier` |
| `webhook_rate_limit_degraded` | rate-store error, **testnet fail-open** | `dimension`, `reason`, `tier=testnet` |
| `webhook_rate_limit_failclosed` | rate-store error, **live fail-closed** (dropped, no enqueue) | `dimension`, `reason`, `tier=live` |
| `webhook_ip_rejected` | source IP not allowlisted (hard gate) | `allowlist_source`, `tier` (IP in `ip_address`) |
| `webhook_ip_observed` | H2 advisory mode (XFF unverified) | `allowlist_source`, `matched`(bool) |
| `webhook_stale` | `\|server_now − fire_time\| > window` | `signal_id`, `fire_time_claimed`, `server_received_at`, `skew_seconds`, `window_s` |
| `webhook_invalid_fire_time` / `webhook_missing_fire_time` | unparseable / absent-when-required | `signal_id`, `server_received_at` |

`server_received_at` (server clock) is always recorded and is **authoritative**; `fire_time_claimed` is stored as
**untrusted input** only.

---
### H1 — Rate limit
1. **Design + key design (two independent keys, fixed 60s window, atomic increment):**
   - **per-IP** `rl:ip:<client_ip>:<window>` — incremented **pre-auth** on every request. Key is **IP-only** (never
     includes `bot_id`) ⇒ a bad-token attacker floods only their own IP budget and **cannot consume any bot's budget**.
   - **per-bot** `rl:bot:<bot_id>:<window>` — incremented **only after valid HMAC auth** ⇒ an unauthenticated attacker
     can **never** increment a bot key, so cannot deny/exhaust a legit bot.
   Over-limit ⇒ **`200`** + `webhook_rate_limited`, **no enqueue**.
2. **Data model / config:** prefer **Deno KV / Upstash** (atomic `INCR` + TTL, no cleanup). DB fallback:
   `public.webhook_rate_limits(key text, window_start timestamptz, count int, PRIMARY KEY(key, window_start))`,
   service_role only, RLS on, `INSERT … ON CONFLICT DO UPDATE SET count = count+1 RETURNING count`, + a bucket-cleanup
   job. Env: `WEBHOOK_RATE_LIMIT_ENABLED`, `WEBHOOK_RATE_IP_PER_MIN`, `WEBHOOK_RATE_BOT_PER_MIN`, `WEBHOOK_RATE_FAILMODE`.
3. **Failure behavior — by tier (NOT fail-open for live):**
   - **prepared / testnet:** rate-store error ⇒ **fail-OPEN** + `webhook_rate_limit_degraded` + alert (availability;
     the `QUEUE_ENABLED`/worker gate still gates execution).
   - **live / mainnet:** rate-store error ⇒ **fail-SAFE = uniform `200` to caller + NO enqueue** +
     `webhook_rate_limit_failclosed` audit + internal alert (a silent drop — **not** a 503, **never** fail-open, no
     status leak). Tier resolved from `PRAXIS_IS_PRODUCTION` / tier env; `WEBHOOK_RATE_FAILMODE` may override, but the
     **default for live is closed** (and a different live policy is an explicit Oren decision).
4. **Evidence to close:** unit (window boundary + both keys); testnet burst (> limit ⇒ excess `200`, `queue_length`
   unchanged, audit rows, under-limit passes); **bad-token-flood test (per-IP throttles, NO bot key incremented)**;
   tiered fail-mode test (testnet ⇒ fail-open+audit; live ⇒ drop+`failclosed` audit, no enqueue).
5. **Rollback/disable:** `WEBHOOK_RATE_LIMIT_ENABLED=off` ⇒ prior behavior; drop table if DB-based; redeploy prior fn.

---
### H2 — IP / source validation
1. **Design:** post-auth allowlist of TradingView egress IPs, using the **trusted** XFF position (see *XFF trust model*).
   **Hard gate only after XFF-trust is verified; otherwise advisory** (`webhook_ip_observed`, **no reject**).
   Defense-in-depth on top of the HMAC token — **never the primary auth**.
2. **Data model / config:** `WEBHOOK_IP_ALLOWLIST_ENABLED` (**optional** internal-beta/prepared; **MANDATORY** before
   live/real funds), `WEBHOOK_IP_ALLOWLIST` (IPs/CIDRs); recommend `public.webhook_ip_allowlist(cidr, note, added_at)`
   for auditability. IP source = TradingView docs; operator confirms + dates at deploy.
3. **Failure behavior + response policy (explicit):**
   - non-allowlisted request (hard gate) ⇒ **`200`** + `webhook_ip_rejected`, **no enqueue** — a per-request reject
     stays uniform 200 (no structure leak).
   - allowlist **config invalid/empty while enabled** = an **internal config fault** ⇒ **prepared/testnet:** `503`
     generic (loud, TV retries); **live:** **uniform `200` to caller + NO enqueue + audit + internal alert** (no HTTP
     status leak). **Never silently allow-all.** Gate H2-enable behind a verified non-empty config.
4. **Evidence to close:** XFF-trust verification result; non-allowlisted ⇒ `200`/no-enqueue/audit; allowlisted ⇒ passes;
   config-fault ⇒ `503`/no-enqueue/alert; documented + dated IP source.
5. **Rollback/disable:** `WEBHOOK_IP_ALLOWLIST_ENABLED=off` ⇒ prior behavior.

---
### H3 — Replay / freshness window
1. **Design (`fire_time` is UNTRUSTED):** `fire_time` is user/TradingView-controlled input → used **only as a
   freshness/replay heuristic**, never as authority. **Server receive time (`server_received_at`) is authoritative for
   audit.** If `|server_now − fire_time| > WINDOW` ⇒ `200` + `webhook_stale`; unparseable ⇒ `webhook_invalid_fire_time`;
   absent-when-required ⇒ `webhook_missing_fire_time`. **Idempotency is owned by dedup** (`UNIQUE(bot_id, signal_id)`),
   which freshness **never overrides or replaces** — a stale reject and a dedup-skip are independent; dedup is the hard
   guarantee, freshness is only an additional filter.
2. **Clock-skew window:** **bidirectional** `±WEBHOOK_FRESHNESS_WINDOW_S` (default **120s**) around `server_received_at`,
   to tolerate TV↔server skew in both directions; monitor the measured skew distribution and tune. The window bounds
   *staleness*, not identity.
3. **Contract (explicit):** `fire_time` is **optional** in prepared/testnet (`WEBHOOK_FIRE_TIME_REQUIRED=false` ⇒ absent
   allowed, freshness skipped) and **REQUIRED before live** (`=true` ⇒ absent/unparseable ⇒ reject). The TradingView
   alert template must send the **alert fire time** (`{{timenow}}`), not bar-close time. Advisory→required is the
   decision to make before live.
4. **Failure behavior:** stale / unparseable / absent-when-required ⇒ **`200`** + audit, **no enqueue** (business
   rejects, never 5xx). Dedup remains the idempotency backstop regardless of H3.
5. **Evidence to close:** test (old ⇒ stale; fresh ⇒ pass; skew both directions in/over window; absent ⇒ pass when
   optional / reject when required; **dedup still blocks a same-`signal_id` replay even when "fresh"**); testnet negative
   (stale ⇒ no enqueue); a measured skew sample.
6. **Rollback/disable:** `WEBHOOK_FRESHNESS_ENABLED=off` ⇒ dedup-only; or widen `WEBHOOK_FRESHNESS_WINDOW_S`.

---
### Remaining A5 blockers (after this design)
- **H1/H2/H3:** design **revised** (this appendix) — still need **implement → test → deploy → evidence** (design ≠ done).
- **H2 dependency:** **XFF trust-chain verification** — until proven, H2 is **advisory-only**, not a security gate.
- **H3 dependency:** **`fire_time` contract decision** (advisory → required-for-live; TV `{{timenow}}`) — pending.
- **H4:** PARTIAL — live Supabase Edge + Railway worker **log grep** (Appendix B) not run.
- **H5:** negative tests **N1–N6** not run.
- **H6:** controlled **TESTNET** positive test — needs S5 arm gate + Oren approval; not done.
- **A5 closes only when H1–H6 each have cited evidence.** Real funds remain **separately** blocked: A11 (not granted),
  A1/A2/A4/A8/A10 open; no mainnet credential. **A5 stays OPEN.** TradingView **prepared, not live**.

---

## Appendix D — XFF trust verification plan (H2 dependency · PLAN ONLY, not run)
**Question to answer:** how does Supabase Edge populate `x-forwarded-for` (and siblings), so we can decide whether H2
can be a **hard IP gate** or must stay **advisory**. **No webhook fire; no queue; no trade.** Owner: Praxis (method) +
Operator (deploy/run the isolated probe + approve).

### Method (preferred = isolated; never touches the webhook/trading path)
1. **Deploy a throwaway diagnostic function** `xff-probe` — a **separate** Edge function that only **echoes non-secret
   request metadata**: `x-forwarded-for`, `x-real-ip`, `cf-connecting-ip`, `forwarded`, and the Deno `connInfo` remote
   addr if exposed. **No webhook logic, no DB, no queue, no secrets, no `bot_id`.** (An echo probe cannot enqueue/order.)
2. **Hit it from ≥2 known source IPs** (operator's public IP, a mobile/hotspot IP) with a plain `GET`/`POST` — record
   each observed header chain vs the **true** client IP.
3. **Spoof test:** send a request with a **client-supplied** `x-forwarded-for: 203.0.113.9` (a value we control) and
   observe whether the platform **preserves** it (→ spoofable, left-most untrusted), **appends** the real IP (→ trust the
   right-most / known index), or **exposes a dedicated trusted header** (→ use that).
4. **Delete `xff-probe`** after. Cite the Supabase Edge networking docs alongside the empirical result.

### Decision output
- **Trusted position/header exists AND client-supplied XFF is not honored** ⇒ H2 **CAN be a hard gate** — parse the IP
  from that trusted position; enable `WEBHOOK_IP_ALLOWLIST_ENABLED` as a reject gate.
- **XFF is fully client-controlled** (no trusted overwrite/append) ⇒ H2 stays **advisory only** (`webhook_ip_observed`,
  no reject); do **not** hard-gate on IP. The **HMAC token remains the primary auth**; pursue **platform/network-level**
  allowlisting (e.g. WAF / Supabase network rules, if available) as the real IP enforcement for live.

### Evidence to close
Captured header chains from ≥2 IPs + the spoof-test result + a doc citation ⇒ a **dated determination**: "trusted at
`<header/index>`" **or** "client-controlled → advisory-only." **STOP** if inconsistent/ambiguous ⇒ H2 stays advisory.

### Safety
`xff-probe` is isolated from the webhook (no trading logic, no secrets, echoes only the tester's own IP), and is deleted
after. **Prepared, not run** — needs operator deploy + approval. Zero impact on `QUEUE_ENABLED` / bots / execution.

---

## Appendix E — `fire_time` contract decision (H3 dependency · DECISION DRAFT)
**Decision to make:** promote `fire_time` from advisory → **required before live**, and fix its exact contract.
`fire_time` stays **untrusted** (freshness heuristic only); `server_received_at` + dedup remain authoritative (per H3).

### Proposed contract
| Item | Decision |
|---|---|
| **Field** | `fire_time` (keep the existing advisory field name) |
| **Source** | TradingView alert placeholder **`{{timenow}}`** = the moment the **alert fires** — **not** bar time (`{{time}}`/close), which can be old for once-per-bar-close |
| **Format** | ISO-8601 UTC (`yyyy-MM-ddTHH:mm:ssZ`, TV's `{{timenow}}` shape); server parses → epoch |
| **Required-when** | `WEBHOOK_FIRE_TIME_REQUIRED=false` in **prepared/testnet** (absent ⇒ freshness skipped); **`=true` before live** (absent/unparseable ⇒ reject `200` + `webhook_missing/invalid_fire_time`) |
| **Freshness window** | bidirectional **±120s** around `server_received_at`; monitor skew, tune |
| **Trust** | untrusted input; heuristic only; **never** authority; dedup owns idempotency |
| **Ownership** | Praxis defines the required payload contract; Operator configures the TV alert template server-side; **Oren approves** the advisory→required transition as a go-live gate |

### Risks + mitigations
- **Clock skew** (TV vs server) ⇒ ±120s bidirectional window + measured-skew monitoring before tightening.
- **Template misconfig** (missing `fire_time` in live) ⇒ **fail-safe reject** (no bad execution) — acceptable; surfaced by audit + alert.
- **StrateTeach-originated signals** routing via the webhook must include `fire_time` in the (server-side) alert template — StrateTeach still never holds tokens or configures execution (owner-split intact).

### Evidence to close
Documented contract (this appendix) + a **measured testnet skew sample** confirming ±120s is adequate + a test set:
absent ⇒ pass(optional)/reject(required); unparseable ⇒ reject; stale ⇒ reject + no enqueue; fresh ⇒ pass;
**dedup still blocks a same-`signal_id` replay even when "fresh."** **Decision owner: Oren** (advisory→required gate).

**Both D and E are plan/decision drafts — no implementation, no endpoint test, no execution. A5 stays OPEN.**

---

## Appendix F — H5 N1 evidence (wrong-token negative test) — PASS · 2026-07-05
**H5 N1 (wrong token) = PASS** (E1, live, operator-approved). **One request only.** Target bot `36b46eb3…` (BNBUSDT),
fake token `n1-wrong-token-NOT-REAL`, signal_id `N1-1783272089`, project `eraxuxidsiolyvfefcez`.
| Check | Baseline | After N1 | Verdict |
|---|---|---|---|
| HTTP response | — | **200 `{"ok":true}`** | ✅ uniform, no leak |
| queue_length | 0 | **0** | ✅ no enqueue |
| open_trades | 0 | **0** | ✅ no trade |
| trade for the N1 signal_id | — | **0** | ✅ none |
| webhook_logs for the N1 signal_id | — | **0** | ✅ no row (auth reject precedes upsert) |
| webhook_logs for bot | 10 | **10** | ✅ unchanged |
| audit_logs total | 166 | **166** | ✅ unchanged (**zero DB write**) |
| enabled_bots | 0 | **0** | ✅ disarmed |
| worker_status.queue_enabled | false | **false** | ✅ disarmed |

**N1 result:** wrong token → rejected at auth (`invalid_secret`) → 200 uniform → zero enqueue / trade / webhook_logs /
audit / DB mutation. No valid token used.

### H5 N2–N4 (valid-token, invalid-payload) — PASS · 2026-07-05
Operator-fired (valid token; **custody: Oren/operator only — token value NOT documented**). Bot `36b46eb3…` (BNBUSDT),
one request each.
| Test | Payload | HTTP | Reject (code line) | DB side-effect |
|---|---|---|---|---|
| **N2** invalid JSON | `not-json` | **200 `{"ok":true}`** | `invalid_payload` (L232–234) | **none** |
| **N3** missing signal_id | `{"action":"buy"}` | **200 `{"ok":true}`** | `missing_signal_id` (L240–243) | **none** |
| **N4** invalid action | `{"signal_id":"N4-h5-hodltest","action":"hodl"}` | **200 `{"ok":true}`** | `invalid_action` (L244–247) | **none** |

Post-check (read-only): queue_length **0→0** · open_trades **0→0** · dlq **0→0** · webhook_logs for bot **10→10** ·
audit_logs **166→166** · no trade for `N4-h5-hodltest` · enabled_bots **0** · `worker_status.queue_enabled=false` ·
`worker_state=disabled`. All reject **before** the `webhook_logs` upsert (L252) ⇒ **zero webhook_logs / audit / enqueue /
trade**. No stop condition.

**H5 (interim): N1 · N2 · N3 · N4 = PASS.** N5 = BLOCKED; N6 aggregate = Appendix G. _updated by Codex at Oren request._

---

## Appendix G — H5 N6 aggregate + BNBUSDT token rotation requirement · 2026-07-05

### H5 N6 — aggregate
- **N1** wrong-token = **PASS** · **N2** invalid-JSON = **PASS** · **N3** missing-signal_id = **PASS** · **N4**
  invalid-action = **PASS**. All returned uniform **`200 {"ok":true}`**; each reject precedes the `webhook_logs` upsert
  (L252) ⇒ **zero enqueue / trade / webhook_logs / audit / DB mutation**; execution disarmed throughout.
- **N5 = BLOCKED** — requires an inactive-bot setup (a gated `bots.status` change = DB mutation needing separate approval).
- **H5 status: PARTIAL — NOT COMPLETE** (N5 pending). **A5 remains OPEN.**

### BNBUSDT webhook token — LOCAL exposure → ROTATION REQUIRED before live
- **What happened:** the valid BNBUSDT token was pasted/executed in the operator's **local terminal only** (N2–N4 curls).
  **Not sent to Claude, not written to docs / Notion / Git.** → **LOCAL exposure risk — NOT a public leak.**
- **Status: ROTATION REQUIRED BEFORE ANY LIVE EXECUTION.**
- **Binding rules:**
  - Do **not** reuse the current `PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN` for further tests.
  - Do **not** connect it to a TradingView live alert; do **not** use it on any enabled execution path.
  - **Before any live execution / valid TradingView alert / mainnet / real funds:** rotate
    `PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN` → update `bots.webhook_secret_hash` for
    `36b46eb3-9384-4e05-a79b-1246e9b85119` → verify **old token FAILS** → verify **new token works only in a safe
    negative test** → **never print/store the token value.**

### Remaining A5 blockers (before A5 closes / before live)
1. **H4** live-log grep (operator export: Supabase Edge + Railway worker).
2. **H5 N5** (inactive-bot `bot_not_active` — gated setup).
3. **H6** controlled TESTNET positive (S5 arm gate + Oren approval).
4. **A10** rollback / kill-switch drill.
5. **BNBUSDT token rotation** before live execution (above).

**A5 remains OPEN.** _updated by Codex at Oren request._
