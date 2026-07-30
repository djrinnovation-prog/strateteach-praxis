# A1 — Static Egress IP / Exchange Allowlisting (CONCRETE DECISION PLAN)

> **DOC / PLANNING + read-only grounding — NOT EXECUTION.** No implementation · no deploy · no Railway change · no
> Doppler change · no secrets · no mainnet / no real funds. **Real funds remain NO-GO.** Uncommitted draft for Codex/Oren
> review. Consolidates + supersedes the two prior A1 packets — `production-a1-static-egress-ip-decision-packet.md`
> (options) and `production-a1-egress-binance-connectivity-packet.md` (connectivity/evidence) — grounded in the **verified
> worker + infra topology** (read-only, 2026-07-10). Pairs with `production-a4-mainnet-credentials-architecture.md`
> (the key-IP-allowlist consumes A1's chosen IP).
>
> **Rev 2 (2026-07-10): Codex CHANGES 1-8 applied.** Added a **per-option proof plan** (§5a, safe IP proof — no orders,
> no secrets, harmless HTTPS egress probe first), **Option-A acceptance criteria** (§5a-A), **Option-B1 security
> requirements** (§5a-B1), **Option-C migration-risk checklist** (§5a-C), **A1 stage gates** (§8a: DESIGN → PROVIDER-
> DECISION → EGRESS-PROOF → ALLOWLIST-READY → LIVE-READONLY-PROOF, all before A4 mainnet key entry), a Binance
> **read-only-first** clarification (§5a proof + §8), an explicit **implement-after-PASS** list (§9a), and the
> **decision-for-today** recommendation (§7: ask provider questions first, don't write code).

## 0. Reading guide — confirmed vs unverified (kept explicit)
- **[FACT]** = verified from repo/infra source (file cited) or a prior recorded incident.
- **[UNVERIFIED]** = a provider/exchange capability that **must** be confirmed by Oren before any path is chosen. **No
  option is selected until §4 is answered.**
- **[PROPOSAL]** = a recommendation / design this plan puts forward (nothing built).

---

## 1. Current hosting topology (CONFIRMED)
- **[FACT] Worker = the sole exchange-egress path.** ccxt exists **only** in the worker (`worker/package.json`);
  `BinanceAdapter` (`worker/src/BinanceAdapter.ts`) is the only exchange client, constructed **after** the Step-4b gates.
  The webhook (Edge) and frontend have **no exchange path** (webhook = supabase-js + `pgmq_send`; frontend = anon key,
  `exchange_environment` is a read-only display field) — per the Codex egress assessment in the connectivity packet.
- **[FACT] Worker host:** Railway service `praxis-platform`, `worker/railway.json` = **NIXPACKS**, `startCommand:
  npm start`, `restartPolicyType: ON_FAILURE` (max 3). **No region pinned in the repo** — region is a Railway dashboard
  setting (historically **EU-West**, set to clear the testnet `451`, §2).
- **[FACT] ccxt construction** (`BinanceAdapter.ts:256-263`): `new ccxt.binance({ apiKey, secret, timeout: 5000 })`,
  created **per-operation** (never cached), `setSandboxMode(true)` when `!isProduction`. **No proxy / httpsAgent /
  httpsProxy option is set today** — egress is **direct** from the container.
- **[FACT] No egress plumbing exists:** no `HTTPS_PROXY` / `proxyUrl` / `EGRESS`/`STATIC_IP` references anywhere in
  `worker/src` (grep clean). So any proxy path is **net-new** (see §5 Option B — it needs code + a secret).
- **[FACT] Frontend** — separate Railway static service `praxis-operator-console-production`; not on the execution path.
- **[FACT] Supabase** — managed Postgres + Edge (project `eraxuxidsiolyvfefcez`); the DB/webhook path is **separate** from
  exchange egress and is **not** what A1 concerns.
- **[FACT] Exchange** — Binance **testnet** today; **mainnet** later. Default Railway egress is **shared/dynamic**
  ([UNVERIFIED] whether a static option exists on our plan — §3/§4).
- **[FACT] No Railway CLI** on the operator machine → Railway inspection is **dashboard-only** (read-only), or a later
  approved runtime egress-IP probe.

## 2. What must have static egress, and why (CONFIRMED requirement)
- **[FACT] Only the worker** needs allowlist-grade egress — it is the one component that talks to Binance. Nothing else
  needs a static IP.
- **Why static:** a Binance **mainnet API key should be IP-restricted** (defence-in-depth MUST for real funds). An IP
  allowlist requires a **stable, known outbound IP**. Railway's default **dynamic** egress means the worker's IP can
  change on redeploy/restart → an allowlisted key would break, or the operator is forced to leave the key
  **un-restricted** (a serious downgrade). **⇒ a stable egress IP is a real-funds prerequisite** and is the single
  allowlist target for every A4 mainnet key.
- **[FACT] Two distinct needs (don't conflate):**
  1. **Region-compliant egress** (clears the geo `451`) — needs a *compliant region*, **not** necessarily static. Already
     satisfied on testnet by EU-West.
  2. **Allowlist-grade egress** (pin the mainnet key) — needs a **static** IP. **This is the real A1 gate.**
- **[FACT] Fail-closed safety unaffected:** any Binance unavailability → `ExchangeUnavailableError` → retry, **no order**
  (`production-a1-egress-binance-connectivity-packet.md` §1). So an egress problem is a **liveness** issue (can't trade),
  never a **safety** one (won't mis-trade). A1 makes egress *correct + evidenced*, it doesn't fix a safety hole.

## 3. Provider facts — CONFIRMED vs UNVERIFIED
| Item | Status | Detail |
|---|---|---|
| Worker is sole egress | **[FACT]** | ccxt only in worker; webhook/frontend clean (§1). |
| Default Railway egress is dynamic/shared | **[FACT]** | Documented Railway behaviour; no static plumbing in repo. |
| EU-West cleared testnet `451` | **[FACT]** | Region fix, recorded (`380d6df6`); a **testnet** observation. |
| Mainnet geo-policy from EU-West | **[UNVERIFIED]** | Binance mainnet may differ from testnet — confirm for the account's jurisdiction. |
| Railway static outbound IP on our plan/region | **[UNVERIFIED]** | May be a paid add-on / region-limited / unavailable. **Gates Option A.** |
| Static IP **stability across redeploys/restarts** | **[UNVERIFIED]** | Even if offered, confirm it survives deploys (else it's not allowlist-grade). |
| Binance mainnet IP-allowlist: required vs optional; format | **[UNVERIFIED]** | Single IP vs CIDR vs list; how many entries — drives A/B/C fit. |
| ccxt proxy support | **[FACT]** | ccxt accepts `httpsProxy`/`proxy`/`agent` options, but **none is wired** — Option B needs code. |

## 4. Exact questions Oren must ask Railway / the provider / Binance (answerable, read-only)
**To Railway (dashboard or support):**
1. Does Railway offer a **static / dedicated outbound (egress) IP** for the `praxis-platform` service on our **current
   plan and region**? If yes: what **tier/add-on and cost**?
2. If offered, is that egress IP **stable across redeploys, restarts, and scaling events** (i.e. it does **not** rotate)?
   Is it a **single IP** or a pool/CIDR?
3. What **region** is the `praxis-platform` service currently in (confirm EU-West), and can it be pinned?
4. Does Railway support restricting/**allowlisting outbound** to specific destinations (for the later H-A1-1 network
   egress allowlist)? (Nice-to-have, not blocking.)

**To Binance (docs/support, read-only):**
5. Is Binance **mainnet** API access **permitted from EU-West** for the intended account jurisdiction? (Region proof —
   don't infer from testnet.)
6. Is mainnet API-key **IP-restriction required or optional-but-recommended**, and what **format** (single IP / multiple
   IPs / CIDR) and **max entries**?

**To Oren (decision inputs):**
7. **Budget ceiling** for the egress solution (drives A vs B vs C).
8. **Appetite** to run/secure a **proxy/NAT** (Option B) or to **migrate the worker** (Option C) if A is unavailable.
9. **Acceptable added latency** to the exchange for a proxy hop (B/C).

## 5. Options (grounded, with the concrete build cost of each)
### A — Railway native static outbound IP *(if the plan offers it)*
- **What:** enable Railway's static-egress feature/add-on for `praxis-platform`; allowlist that IP on the mainnet key.
- **Build cost:** **near-zero code** — a Railway setting; no worker change, no new secret.
- **Pros:** least change; worker stays put; no new hop/secret; lowest latency. **Cons:** **[UNVERIFIED] availability**;
  possible paid tier / region lock; must confirm the IP is stable across redeploys (§4 Q2).

### B — External fixed-IP egress (proxy / NAT) — **two sub-variants; on Railway this realistically means B1**
- **B1 — forward proxy the worker routes through (ccxt `httpsProxy`).** Stand up a small fixed-IP proxy (VPS) in an
  allowed region; wire `BinanceAdapter` to send exchange calls via it; allowlist the **proxy's** IP.
  - **Build cost:** **CODE** (add an `httpsProxy`/agent option to the per-op ccxt construction, sourced from a
    Doppler env, default none, **fail-closed in production if unset**) **+ a NEW SECRET** (proxy URL/creds → Doppler,
    hygiene per S5-A6) **+ run/secure/monitor the proxy** (SPOF on the critical path).
  - **Pros:** provider-agnostic, deterministic IP without moving the worker. **Cons:** new critical component + security
    surface (sees TLS-wrapped exchange traffic — **not** keys, which stay TLS'd to Binance), new secret, added latency,
    ops burden.
- **B2 — network-level NAT / transparent egress (no code).** A cloud NAT gateway with an elastic IP that the worker's
  traffic routes through at the OS/network layer (no ccxt change, no secret).
  - **[FACT] Feasibility caveat:** on Railway you generally **cannot** force OS-level egress routing for a managed
    container → B2 is usually **not achievable without moving the worker**, at which point it collapses into **Option C**.
    List it for completeness; realistically **B on Railway = B1**.

### C — Move worker execution to a provider with native static egress
- **What:** run the execution worker on a VPS/cloud VM with an **elastic IP** (or behind a cloud NAT) in an allowed
  region; allowlist that IP.
- **Build cost:** **HIGH** — migrate the worker off Railway (redo deploy, secret wiring/Doppler sync, monitoring,
  restart policy), own the host (patching/uptime).
- **Pros:** clean native static IP, full region/IP control, **no proxy hop, no new secret**. **Cons:** largest migration;
  longest calendar; more infra to own.

### D — No key IP-restriction — **REJECTED**
- Don't pin the key. **Fails the MUST control** for real funds. Rejected; listed only to close it.

## 5a. Per-option PROOF PLAN + acceptance / security / migration criteria
**Universal proof rules (apply to every option — no exceptions):**
- **No orders.** **No `createOrder` of any size** is part of A1. IP/egress is proven by **reads only**.
- **No secrets printed.** The **egress IP is NOT a secret** and may be recorded; **API keys, secrets, proxy creds,
  signed query strings, and order payloads are NEVER printed/logged/committed.**
- **No mainnet trade.** Proof is testnet-first; a mainnet **read-only** step comes later, separately gated.
- **Two-stage proof, harmless first:**
  1. **HTTPS egress probe (harmless, keyless):** the worker performs a plain **read-only HTTPS GET to a public IP-echo
     endpoint** and logs the returned **outbound IP** (non-secret). This alone proves *which IP the worker egresses from*
     — no exchange, no key, no order.
  2. **Binance READ-ONLY verification (only if/when needed):** public ping / `loadMarkets` (region proof, keyless) →
     then an **authenticated read-only private endpoint** (`fetchBalance`) to prove **key + IP + region** are accepted —
     **[CHANGE 6] start with read-only/private account endpoints, NEVER order endpoints.** A `451` at the keyless step =
     region block; a 200 at `fetchBalance` = key/IP/region accepted **without moving funds**.

### §5a-A — Option A (Railway native static IP): ACCEPTANCE CRITERIA (all must hold)
- [ ] **Exact outbound IP (or CIDR) is known** and documented (from Railway + confirmed by the §5a HTTPS egress probe).
- [ ] **Stable across redeploy/restart** — the IP does not change when the service redeploys or restarts (probe before
      and after a redeploy → identical).
- [ ] **Stable across region/plan changes, or the conditions are documented** — if a plan/region change would rotate it,
      that dependency is written down and controlled.
- [ ] **Reachable from the worker** — the HTTPS egress probe succeeds from `praxis-platform`.
- [ ] **Compatible with Binance allowlist format** — single IP or CIDR matches what Binance accepts (§4 Q6).
- [ ] **Monitorable for drift** — a check can compare the live egress IP to the documented allowlisted IP and alert on
      mismatch (§9 monitoring design).
- [ ] **Rollback defined if the IP changes** — on drift: worker stays **fail-closed** (no order), operator re-confirms +
      updates the key allowlist before resuming; never loosen the key to "get trading working."
- **Proof plan (A):** HTTPS egress probe → record IP → **redeploy** → probe again → assert identical → (later, gated)
  Binance keyless ping + read-only `fetchBalance` from that IP.

### §5a-B1 — Option B1 (forward proxy): SECURITY REQUIREMENTS (all mandatory)
- [ ] **Proxy credentials live ONLY in the Doppler/Railway secret path** — never in a doc, chat, PR, log, or argv (S5-A6
      hygiene).
- [ ] **Worker FAILS CLOSED if a proxy is required but missing/unset** — in production it must **refuse to construct the
      mainnet exchange** (no order) rather than fall back.
- [ ] **NO fallback to direct egress in production** — if the proxy is unreachable, the worker does not silently egress
      direct (that would defeat the allowlist); it fails closed.
- [ ] **Proxy logs must NOT contain** API keys, signed query strings, order payloads, or any secret — TLS to Binance is
      end-to-end (the proxy sees a CONNECT tunnel, not plaintext), and proxy access logs are scrubbed of anything
      sensitive.
- [ ] **Proxy supports HTTPS `CONNECT` / is ccxt-compatible** — verified with a keyless HTTPS probe through the proxy
      before any key use.
- [ ] **IP-drift monitoring on the proxy's egress IP** — alert if the proxy's outbound IP changes from the allowlisted
      value.
- **Proof plan (B1):** keyless **HTTPS egress probe THROUGH the proxy** → confirm the returned IP == the proxy's fixed IP
      → assert worker **fails closed** when the proxy env is unset (negative test) → (later, gated) Binance keyless ping +
      read-only `fetchBalance` through the proxy.

### §5a-C — Option C (move worker): MIGRATION-RISK CHECKLIST (all must be verified)
- [ ] **Env/secrets parity** — every Doppler/Railway secret the worker needs is present + correct on the new host
      (service_role, Vault access, pepper if used, etc.), verified before cutover.
- [ ] **Queue behavior** — pgmq read/visibility-timeout/DLQ behavior is identical from the new host; no double-processing.
- [ ] **Worker singleton / duplicate-worker prevention** — **exactly one** worker consumes the queue; the old Railway
      worker is **stopped** before the new one arms (no two workers placing orders).
- [ ] **Health checks** — liveness/readiness + the dead-man's-switch alerting work on the new host.
- [ ] **Logs / audit continuity** — logs + `audit_logs` writes continue unbroken; retention + redaction (H4) preserved.
- [ ] **Rollback to Railway is disabled OR clearly controlled** — a documented, single-active-worker rollback (never both
      running); the Railway worker stays **off** unless a controlled fail-back is executed.
- [ ] **Static IP verified BEFORE any key allowlist** — the new host's elastic IP is proven (HTTPS egress probe) and
      documented **before** the Binance key is restricted to it.
- **Proof plan (C):** on the new host, HTTPS egress probe → record elastic IP → restart/redeploy → probe again → assert
      identical → confirm singleton (old worker off) → (later, gated) Binance keyless ping + read-only `fetchBalance`.

## 6. Decision criteria — scored (higher = better; blockers noted)
| Criterion | A Railway static | B1 forward proxy | C move worker |
|---|---|---|---|
| **Latency** (extra hop?) | ★★★ none | ★★ +1 hop | ★★★ none (post-migration) |
| **Reliability / IP stability** | ★★ *(if stable across deploys — [UNVERIFIED])* | ★★ *(you own proxy uptime; SPOF)* | ★★★ *(you control the elastic IP)* |
| **Auditability** (prove + monitor the IP) | ★★★ single IP | ★★★ known proxy IP | ★★★ known elastic IP |
| **Operational burden** | ★★★ low (a setting) | ★ run/patch/monitor a proxy | ★ own the host + redo ops |
| **Secret exposure** (new secret / new hop) | ★★★ none | ★ new proxy secret + new hop | ★★★ none new |
| **Binance allowlist compatibility** | ★★★ *(if single stable IP)* | ★★★ deterministic IP | ★★★ native elastic IP |
| **Gating unknown** | **availability [UNVERIFIED]** | needs code + secret | migration effort/calendar |

**Reading:** **A dominates on every axis it wins — its only risk is availability.** B1 is the pragmatic fallback (no
migration) at the cost of a new component + secret. C is cleanest-by-control but heaviest.

## 7. Recommended path (conditional on §4 verification)
1. **Verify Option A first** — it's a single dashboard/support question at zero cost and, if available + stable + region-OK,
   it wins on latency, ops burden, and secret exposure. **[PROPOSAL] choose A if** Railway confirms a **static outbound
   IP that survives redeploys** on our plan **and** EU-West (or another offered region) is Binance-mainnet-compliant.
2. **If A is unavailable/unstable → Option B1** (forward proxy): accept the new component + secret; **harden + monitor**
   the proxy; wire ccxt `httpsProxy` fail-closed in production. Pragmatic middle — no worker migration.
3. **Option C only if** A is unavailable **and** B1's added component/secret is unacceptable — reserve for when full
   IP/region control is worth a migration.
4. **D rejected.**
- **Whichever wins:** the chosen IP becomes the **single allowlist target** for all A4 mainnet keys and **must be
  monitored for change** (a silently-changed egress IP = mainnet outage; see §9 Claude monitoring design).

### [CHANGE 8] Decision for TODAY
**Today's decision is to ASK the provider questions (§4) first — NOT to write code.** No egress plumbing, proxy, or
migration is chosen or built now.
- **If Railway confirms a static outbound IP that is stable across redeploys (§5a-A acceptance) and the region is
  Binance-mainnet-compliant → choose A.** It wins on latency, ops burden, and secret exposure, and needs no code.
- **If Railway does NOT offer a stable static egress → decide B1 vs C** (B1 = no migration, new component + secret; C =
  migration, full control, no new secret) based on Oren's appetite/budget/latency answers (§4 Q7-Q9).
- Only **after** the provider answers do we author any probe/plumbing — and even then, **no runtime change until Oren
  picks the path** (§9a).

## 8. Stop conditions (hard)
- **No mainnet API key may be created or IP-allowlisted until the egress path is SELECTED and its IP is known** — A4
  mainnet provisioning is **blocked** on this decision (the key's allowlist target must exist first).
- **Do not enable the key's IP-restriction before the static egress IP is confirmed AND mainnet reachability is proven
  read-only** — doing it out of order **locks the worker out of mainnet**.
- **No `createOrder` / no order of any size is part of A1** — connectivity is proven by **reads only** (public ping +
  read-only `fetchBalance`), per the connectivity packet §5.
- **No region change / no proxy / no secret / no worker migration** is introduced without its **own** separate approval;
  any proxy creds follow S5-A6 hygiene (Doppler-only, never printed/argv/logged).
- **If mainnet region policy is unclear, or no static-IP path is available → STOP and escalate to Oren.** Never "try it
  live." Remain **testnet-only** (`exchange_environment=testnet`) until A1 closes.
- **Real funds remain NO-GO** — A1 is one gate among A2(✅)/A4/A8-H3/A11/live-tier.

## 8a. A1 STAGE GATES (sequential — each must close before the next; A4 mainnet key entry is blocked until the last)
| Gate | Meaning | Owner | Exit evidence |
|---|---|---|---|
| **A1-DESIGN PASS** | this plan reviewed + accepted | Codex/Oren | Codex PASS on Rev 2 (doc-only) |
| **A1-PROVIDER-DECISION** | §4 questions answered → **Option A / B1 / C chosen** | **Oren** (+ provider) | recorded answers + selected option + (if B1/C) budget/appetite |
| **A1-EGRESS-PROOF (testnet / no order)** | the chosen path's **outbound IP is proven** via the §5a **HTTPS egress probe** (keyless), stable across a redeploy | Claude authors probe → **Oren-approved run** | documented IP + before/after-redeploy match; **no order, no secret** |
| **A1-ALLOWLIST-READY** | the static IP is documented + drift-monitored; Binance allowlist **format confirmed** (§4 Q6); key-allowlist runbook ready — **key NOT yet restricted** | Claude (runbook/monitor) + Oren | IP + monitor live; runbook approved; allowlist entry **prepared, not applied** |
| **A1-LIVE-READONLY-PROOF** | **mainnet READ-ONLY** reachability proven from the static IP — Binance keyless ping (region) → authenticated **`fetchBalance`** (key+IP+region), **no order** | **Oren-gated run** | 200 from the documented egress IP; recorded (non-secret) |

**Only after A1-LIVE-READONLY-PROOF closes may A4 mainnet key entry proceed** (create key → restrict to the proven IP →
arm later, still behind A11 + all other gates). The mainnet key is **IP-restricted only after** the IP is proven and
reachable — never before (out-of-order = lockout, §8).

## 9. What Claude can do next WITHOUT Oren (design/read-only only — each still gated to implement)
- **[PROPOSAL] ccxt proxy-plumbing DESIGN (for Option B1):** how `BinanceAdapter` would accept an `httpsProxy` from a
  Doppler-sourced env — **default none**, and **fail-closed** (refuse to construct a mainnet exchange) if production
  requires a proxy but none is set. Design only; no code, no secret.
- **[PROPOSAL] Read-only egress-IP probe DESIGN:** a worker-side read that logs its **own** current outbound IP (via a
  public IP-echo endpoint — the IP is **non-secret**) to (a) capture today's dynamic IP and (b) later confirm the static
  IP. The *run* is Oren-gated; the design/read-only check is not.
- **[PROPOSAL] Egress-IP-change MONITORING design:** detect when the worker's egress IP differs from the documented
  allowlisted IP → alert (a changed IP = mainnet outage). Pairs with existing alerting.
- **[PROPOSAL] Binance key-IP-allowlist RUNBOOK (operator-run):** the exact operator steps to restrict the mainnet key to
  the chosen IP, in the safe order (confirm IP → prove reachability → then restrict). Claude authors steps; **never**
  handles the key.
- **[PROPOSAL] H-A1-1..5 hardening DESIGNS** (from the connectivity packet): network egress allowlist (worker → exchange
  endpoints only), CI route-inventory/bundle-grep guard (ccxt only in the worker Execution Core), deployed-artifact proof
  (only `dist/index.js` runs; `spike-*`/dev tools unreachable), block any StrateTeach direct-exchange path, mainnet egress
  validation (post-A11). All design/CI — no infra.
- **Read-only:** confirm the current topology facts on request (already done here).

## 9a. What Claude can IMPLEMENT after A1-DESIGN PASS (still no runtime change until Oren picks the path)
After Codex PASS on this plan, Claude may **build (design + code + LOCAL tests)** — but **NOT deploy or run against live
infra** — the following. **No runtime/infra change happens until Oren completes A1-PROVIDER-DECISION** (§8a):
- **Egress-IP probe** — the keyless HTTPS IP-echo read (§5a) as a small, reviewed worker utility/script + LOCAL test.
  Authored after PASS; **its actual run is Oren-approved** (A1-EGRESS-PROOF). Prints only the **non-secret** IP.
- **Optional proxy plumbing (Option B1) DESIGN + code-behind-a-flag** — wire `BinanceAdapter` to accept an `httpsProxy`
  from a Doppler env, **default none, fail-closed in production**, behind a default-OFF path; LOCAL tests (incl. the
  fail-closed negative test). **Built only if B1 is the direction; not deployed until Oren chooses B1.**
- **Egress-IP-drift monitoring runbook** + the check design (compare live egress IP vs documented allowlisted IP → alert).
- **Binance key-IP-allowlist runbook** (operator-run steps, safe order; Claude never handles the key).
- **H-A1-1..5 hardening** (network egress allowlist, CI route-inventory guard, deployed-artifact proof) — CI/design.
- **NOT after PASS:** no Railway/Doppler change, no proxy stood up, no worker migration, no deploy, no mainnet, no key
  restriction — all wait on the provider decision + their own gates.

## 10. What OREN must do EXTERNALLY (no Claude substitute)
- **Ask Railway** the §4 Q1-Q4 static-egress questions (dashboard/support) and report the answers.
- **Confirm Binance mainnet region policy** (§4 Q5) for the account jurisdiction; confirm the **allowlist format/limits**
  (§4 Q6).
- **Decide budget** (§4 Q7) and **appetite** for B/C (§4 Q8) and acceptable latency (§4 Q9).
- **If Option B1:** provision + harden the fixed-IP proxy VPS; put proxy creds in **Doppler** (never printed to Claude).
- **If Option C:** provision the static-egress host + own the worker migration.
- **Set the Binance key IP-allowlist** to the chosen IP (A4, after egress selected + reachability proven).
- **Approve** any runtime egress-IP probe / mainnet read-only reachability step (each separately).
- **A11** (written, capped) before any mainnet arming — independent of A1.

---
**Net:** A1 is a **decision blocked on provider facts**, not on Claude effort. The recommended sequence is **verify
Option A → fall back to B1 → C only if forced**, with the chosen IP becoming the A4 allowlist target. This plan
authorizes **nothing** — every step is separately Oren/Codex-gated. **Real funds remain NO-GO.**
