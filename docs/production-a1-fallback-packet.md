# A1 — Static Egress FALLBACK Packet (don't wait on Railway) — for Codex review

> **DOC / PLANNING — NO CODE, NO DEPLOY.** No Railway/Doppler change · no secrets · no mainnet / no real funds. **Real
> funds remain NO-GO.** Uncommitted draft for Codex review. Deepens the A1 decision plan (`production-a1-static-egress-
> decision-plan.md`, PASS `2bcdaf0`) into a **production-quality FALLBACK** so we reach tiny-live without waiting on
> Railway. Grounded in the verified topology (read-only): the **worker is the sole exchange egress**; `BinanceAdapter`
> builds `ccxt.binance({ apiKey, secret, timeout:5000 })` **per-op with NO proxy option wired**; EU-West cleared the
> testnet `451`.
>
> **Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.** Goal: the fastest SAFE
> path to a stable, allowlist-grade outbound IP, without dropping any gate.

> **Rev 2 (2026-07-12): Codex CHANGES 1-9 applied.** Option B now **requires proxy authentication** (no open proxy; proxy
> URL = secret operational config, never logged/printed); clarified **what the proxy can/cannot see**; pinned the **exact
> fail-closed behavior** (prod: missing proxy→block, unreachable→unavailable/retry-or-block never direct, unexpected
> egress IP→STOP; testnet optional); exact **test requirements**; **rollout gates B1-B8**; **monitoring** (drift/failure/
> direct-attempt alerts); a **decision rule** (A if Railway sufficient before B ships, else B, else C); and a **cost/risk
> comparison** (A/B/C/D).

## 0. The decision in one line
**Verify Option A (Railway native static egress) — but do NOT block on it. Prepare Option B (fixed-IP forward proxy) in
parallel; it is the fastest safe fallback and the worker stays on Railway. Option C (move the worker) only if A is
unavailable and B is unacceptable.** The one Option-B code slice (ccxt proxy wiring, fail-closed in production) is
**Claude-implementable NOW, LOCAL-testable, behind a default-off flag with zero testnet impact.**

---

## 1. Option A — Railway native static egress
- **Acceptance criteria (all required):** a **single outbound IP (or a small documented CIDR)** that is (a) **known**,
  (b) **stable across redeploys/restarts/scaling**, (c) reachable from the worker, (d) **Binance-allowlist-format
  compatible**, (e) region-compliant for Binance mainnet, (f) **monitorable for drift**, with a defined **rollback if it
  changes**.
- **Proof steps (read-only, gated):** keyless HTTPS egress probe (§5) from `praxis-platform` → record the IP → **redeploy**
  → probe again → assert **identical** → (later) Binance keyless ping + authenticated read-only `fetchBalance` from that
  IP.
- **Monitoring:** a drift check compares the live egress IP to the documented allowlisted IP → alert on mismatch (a
  silently-changed egress = mainnet outage). Reuse existing alerting.
- **What Railway response is SUFFICIENT:** an explicit confirmation that our **plan + region** provides a **dedicated/
  static outbound IP that does not rotate across redeploys** (single IP or CIDR), with the tier/cost. Anything vague
  ("shared egress", "IP may change", "not offered on your plan") → **A is out → go Option B.**

## 2. Option B — fixed-IP outbound proxy (RECOMMENDED fallback)
### 2a. Architecture
- A small **fixed-IP forward proxy** (HTTPS `CONNECT` tunnel) with a **static/elastic IP** in a Binance-allowed region
  (EU-West, matching the testnet `451` fix). The worker sends **only its Binance/exchange calls** through it; everything
  else (Supabase) goes **direct**. The proxy's IP is the single allowlist target for A4 mainnet keys.
- **Why a forward proxy (not OS-level NAT):** on Railway you cannot force OS-level egress routing for a managed container;
  a **per-adapter proxy option in ccxt** is the clean, worker-scoped way to route only exchange traffic.
### 2b. Where the proxy runs
- A tiny hardened VPS (or a managed static-IP forward-proxy) the **operator provisions** — its own elastic/static IP,
  minimal attack surface (only the proxy port, IP/credential-authenticated), patched, monitored. Not on the critical path
  for anything but exchange egress.
### 2c. How the worker routes ONLY exchange traffic through it
- Set the ccxt **`httpsProxy`** (or `proxy`) option **on the `BinanceAdapter`'s ccxt instance only** — so **only Binance
  calls** tunnel through the proxy; the Supabase client (`supabase-js`) is untouched. **Do NOT use a global
  `HTTPS_PROXY` env** (that would route Supabase + everything through the proxy).
- Source the proxy URL from an env (`EXCHANGE_HTTPS_PROXY`, Doppler→Railway). Default **unset** = direct (current
  behavior; testnet).
### 2d. Exact fail-closed behavior [CHANGE 3]
**In production / mainnet (`PRAXIS_IS_PRODUCTION=true`):**
- **`EXCHANGE_HTTPS_PROXY` missing/empty → BLOCK adapter creation** (the worker refuses to build the mainnet adapter; no
  order; a config fault, not a transient) — a missing proxy must never silently egress direct.
- **Proxy unreachable / connection error → `ExchangeUnavailableError` → transient retry OR block; NEVER a direct-Binance
  fallback** (a direct egress would defeat the key IP allowlist). Matches the existing fail-closed exchange-unavailable
  path.
- **Proxy returns an unexpected egress IP** (the observed egress ≠ the documented allowlisted proxy IP) → **STOP** (do not
  trade; alert) — a wrong egress IP means the allowlist assumption is broken.

**In testnet (`PRAXIS_IS_PRODUCTION≠true`):**
- The proxy is **optional** — used only if `EXCHANGE_HTTPS_PROXY` is explicitly set; otherwise **direct** (current
  behavior). **Zero testnet behavior change.**

- **Tier source-of-truth caveat (mirror slice 4B):** the fail-closed rule keys off `PRAXIS_IS_PRODUCTION` on the **worker**
  surface; the live cutover must set it consistently (worker) — cross-checked in the live-tier preflight.
### 2f. Secrets required — proxy MUST be authenticated (NO open proxy) [CHANGE 1]
- **The proxy MUST require authentication — an open (auth-less) proxy is FORBIDDEN.** Since Railway's egress-to-proxy IP
  is dynamic (can't reliably IP-allowlist the worker→proxy hop), **credential auth (user:pass) is required**.
- **`EXCHANGE_HTTPS_PROXY`** = the authenticated proxy URL (e.g. `https://user:pass@proxy-host:port`) — a **NEW SECRET =
  sensitive operational config**. → **Doppler → Railway** (S5-A6 hygiene). **Never logged, never in argv, never printed in
  evidence** (evidence records only pass/fail + the egress IP fingerprint, never the proxy URL/creds).
- The **exchange API key stays TLS'd end-to-end to Binance** — the proxy authenticates the *tunnel*, not the exchange
  session; it never holds the exchange key.

### 2f-bis. What the proxy CAN and CANNOT see [CHANGE 2]
- **CAN see:** the **destination host:port** (the `CONNECT api.binance.com:443` target) and **timing/volume** (traffic
  metadata) — because HTTPS `CONNECT` establishes a TLS tunnel the proxy relays but does not terminate.
- **CANNOT see (with end-to-end TLS to Binance):** the **Binance API key**, the **signed query-string/body contents**, or
  any response payload — those are inside the TLS session between the worker and Binance, which the proxy only forwards.
- **Still treat the proxy as SENSITIVE INFRASTRUCTURE:** it is on the exchange-egress path and sees metadata (which hosts,
  when, how much). Harden it, patch it, monitor it, restrict its inbound to the worker, and rotate its credentials on any
  exposure.
### 2g. Logging rules
- **Never log** the proxy URL/creds or the exchange key. The proxy's own access logs must contain **no** API keys / signed
  query strings / order payloads (TLS `CONNECT` tunnel → proxy sees only `host:port`). Log the **egress IP** (non-secret)
  for the drift monitor. Redact on both sides.
### 2h. Test requirements (LOCAL; Claude-buildable now) [CHANGE 4]
- **mainnet/prod + missing proxy ⇒ adapter construction FAILS** — `is_production=true` + `EXCHANGE_HTTPS_PROXY` unset →
  the BinanceAdapter build **throws/blocks** (no order).
- **mainnet/prod + proxy set ⇒ ccxt gets `httpsProxy`** — the ccxt.binance instance receives the `httpsProxy` option =
  the configured proxy URL.
- **testnet + no proxy ⇒ existing behavior UNCHANGED** — direct egress; ccxt gets **no** `httpsProxy`; Supabase client
  unaffected (no global proxy).
- **proxy error ⇒ NO direct Binance fallback** — a proxy connection error at the live tier → `ExchangeUnavailableError`
  (retry, no order), never a direct call.
- **proxy URL NEVER appears in logs/errors** — assert the proxy URL/creds are absent from any log line, error message, or
  thrown error (redacted). (Also a CI grep guard.)
### 2i. Rollout GATES — B1 … B8 (each its own go) [CHANGE 5]
- **B1 [Claude, NOW]:** ccxt proxy wiring + fail-closed-in-prod + the §2h tests — **LOCAL-tested only**, behind the
  default-unset env → **zero testnet impact**. A1-independent — buildable before Railway answers.
- **B2 [Oren]:** provision + harden the fixed-IP **proxy VPS** (authenticated, region-compliant).
- **B3 [Oren]:** `EXCHANGE_HTTPS_PROXY` (authenticated URL) → **Doppler/Railway** secret entry.
- **B4 [gated]:** **deploy the worker with `QUEUE_ENABLED=false`** (no trading) — code live but disarmed.
- **B5 [gated]:** **keyless egress-IP probe** (through the proxy) → confirm the egress = the proxy's fixed IP.
- **B6 [gated]:** **Binance PUBLIC-endpoint probe** (keyless `loadMarkets`/server-time through the proxy) → 200 (not
  geo-blocked).
- **B7 [gated, after A4]:** **authenticated READ-ONLY probe** (`fetchBalance`) — **only after an A4 mainnet credential
  exists** + is IP-allowlisted; no order.
- **B8 [gated, A4]:** **allowlist the mainnet key** to the proxy IP — **only after the egress proof (B5/B6) passes.**
### 2j-mon. Monitoring [CHANGE 6]
- **Scheduled egress-IP probe** — periodic keyless probe records the live egress IP.
- **Alert on IP drift** — live egress IP ≠ documented allowlisted proxy IP → alert (a drift = mainnet outage / broken
  allowlist assumption).
- **Alert on proxy failure** — proxy unreachable / auth failure → alert (the worker is fail-closed but not trading).
- **Alert if a PRODUCTION adapter attempts DIRECT Binance without the proxy** — any attempted direct egress at the live
  tier is a fail-closed violation → alert (should be impossible by §2d, but monitor for it).
### 2k. Rollback
- Unset `EXCHANGE_HTTPS_PROXY` (→ direct on testnet) / revert the wiring / redeploy the prior worker. Decommission the
  proxy VPS. Reversible; no data change. (In production, unsetting the proxy fails closed — safe, not silently-direct.)

## 3. Option C — move the worker to a static-IP host
- **Architecture:** run the execution worker on a VPS/VM with an **elastic IP** (or behind a cloud NAT) in an allowed
  region; allowlist that IP.
- **Migration risk (HIGH):** redo deploy, secret wiring (Doppler→host), monitoring, restart policy; own the host
  (patching/uptime).
- **Worker singleton requirement:** **exactly ONE** worker consumes the pgmq queue — the **Railway worker must be STOPPED
  before** the new host's worker arms (two workers = duplicate orders). A hard cutover, verified.
- **Env parity:** every Doppler/Railway secret the worker needs (service_role, Vault access, pepper if used,
  `PRAXIS_IS_PRODUCTION`, `QUEUE_ENABLED`) present + correct on the new host **before** cutover; health/dead-man checks work.
- **Rollback:** single-active-worker discipline — Railway worker stays **off** unless a controlled fail-back (never both
  running). Documented cutover + fail-back.

## 4. Decision deadline + go/no-go
- **Deadline:** if Railway has **not** given a sufficient answer (§1) within the operator's chosen window (e.g. **24-48h**),
  **do not wait** — proceed with **Option B**.
- **Go/no-go criteria:**
  - **Choose A** iff Railway confirms a static outbound IP **stable across redeploys** on our plan+region, Binance-format
    compatible → verify via §5, then done.
  - **Choose B** iff A is unavailable/unstable **and** a fixed-IP proxy VPS is acceptable (fast; worker stays on Railway;
    accepts one new component + secret).
  - **Choose C** iff A is unavailable **and** B's added component/secret is unacceptable (full control > migration cost).
  - **Reject D** (no key IP-restriction) — always.
- **[CHANGE 7] Decision rule (explicit):**
  - **If Railway gives a SUFFICIENT native static-egress answer (§1) BEFORE B is deployed → choose A and do NOT deploy B**
    (B1 code can still be committed dormant, but B2-B8 are not executed).
  - **If Railway's answer is vague / slow (past the window) / negative → proceed with B.**
  - **If the proxy (B) adds unacceptable operational risk** (a new secret + component the operator won't run/monitor) →
    **choose C.**

## 4a. Cost / risk comparison [CHANGE 8]
| Option | Code | Infra / ops | Secret | Migration risk | Verdict |
|---|---|---|---|---|---|
| **A — Railway native static egress** | **lowest** (a setting) | none new | none | none | **Simplest — verify first** |
| **B — fixed-IP forward proxy** | small (ccxt `httpsProxy` wiring, fail-closed) | **+1 component** (proxy VPS to run/patch/monitor) | **+1** (`EXCHANGE_HTTPS_PROXY`) | low (worker stays on Railway) | **Fastest fallback — adds infra/secret/ops risk** |
| **C — move worker to static-IP host** | medium (redo deploy/monitoring) | own the host | none new | **highest** (singleton cutover, env parity) | **Strongest control — highest migration risk** |
| **D — no key IP-restriction** | — | — | — | — | **REJECTED** (fails the MUST allowlist control) |

## 5. Proof plan (read-only; NEVER an order)
- **Keyless egress-IP probe:** the worker does a read-only HTTPS GET to a public IP-echo endpoint and logs its **outbound
  IP** (non-secret) — for A, direct; for B, **through the proxy** (expect the proxy IP). Proves *which IP we egress from*;
  no key, no exchange.
- **Binance public-endpoint probe:** keyless `loadMarkets` / server-time from that egress → **200** = region/egress not
  geo-blocked; `451` = blocked → STOP.
- **Authenticated read-only probe (later, A4/A1-LIVE-READONLY-PROOF):** `fetchBalance` (read-only) from the static IP with
  the IP-allowlisted key → **200** = key+IP+region accepted, **no funds moved**.
- **HARD:** **never `createOrder`**, **never a mainnet order** in any A1 proof — reads only.

## 6. Recommendation
- **Fastest safe fallback = Option B (fixed-IP forward proxy).** Worker stays on Railway; the code slice is small and
  LOCAL-testable now; the proxy is hours to provision. It delivers an allowlist-grade static IP without a worker
  migration.
- **Implementation slices + expected time:**
  - **B1 ccxt proxy wiring + fail-closed-in-prod + LOCAL tests [Claude, ~0.5 day, A1-INDEPENDENT — start now].**
  - **B2 proxy VPS provisioning + hardening [Oren, ~hours].**
  - **B3 `EXCHANGE_HTTPS_PROXY` → Doppler [Oren, minutes].**
  - **B4 deploy + keyless egress-IP probe [gated, ~0.5 day].**
  - **B5 allowlist proxy IP on mainnet key [A4, with A4-1].**
  - **Expected: ~1 day to a proven static egress if B is chosen** (B1 in parallel with awaiting Railway; the rest once B
    is decided). Option A, if Railway confirms, is faster (a setting) — hence verify A first but build B1 in parallel.
- **Net:** verify A, build **B1 now** (safe, testnet-no-op), and if Railway doesn't answer in the window → execute B2-B5.
  Every step read-only-proven; **no `createOrder`, no mainnet order, real funds NO-GO** until the full ladder (A4/live-
  tier/A11) closes.

---
**Progress: 1/5 complete · Current: 2/5 — Static egress / IP allowlist (A1) · Remaining: 4/5.** Planning only — no code,
no deploy, no Railway/Doppler, no secrets, no mainnet. **Real funds remain NO-GO.**
