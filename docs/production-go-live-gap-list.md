# Production Go-Live Gap List (real-funds decision)

> **DOC / DESIGN ONLY — NOT EXECUTION.** No DB mutation · no Doppler/Railway change · no
> `QUEUE_ENABLED` change · no §6b enable · no arm/fire · no TradingView live · no mainnet/real funds.
> Authority over scope/priority = operator + Oren; each gap closes only on cited **E1 (runtime)** /
> **E2 (platform)** evidence (Governance v1.0 §8). Companion to
> [production-readiness-gap-review.md](production-readiness-gap-review.md).

## Readiness tiers (do not conflate)
- **Testnet-ready** ✅ — proven on Binance testnet (S4-2: 50 fills, reconciliation, bot-error recovery; `full_s4_2=GO`).
- **Config-ready** ✅ — migration 014 applied; 5 bots configured (`fixed_notional=20`, `max=25`, `daily=100`, `sell off`, **`trading_enabled=false`**), `exchange_environment=testnet`; SELL fail-closed; `QUEUE_ENABLED=false`. **Not armed.**
- **Controlled-smoke-ready** ✅ — controlled **testnet** smoke **PASS (2026-06-30)**: one filled BTC testnet order (`requested=20`/`executed=19.89`), exactly-one, caps honored, re-disarmed ([smoke evidence](sprint5-s5-a3-b4-controlled-smoke-evidence.md)). Testnet only.
- **Production-real-funds-ready** ❌ — **ALL MUST gaps closed (E1/E2) + controlled smoke PASS + Oren + legal/financial sign-off.** Not met.

---

## At-a-glance
| ID | Area | Pri | Blocks real funds? | Deferrable? | Owner |
|----|------|-----|--------------------|-------------|-------|
| A1 | Egress / Railway region / Binance connectivity | **MUST** | **YES** | No | Operator + Oren |
| A2 | Migration 009 / migration-history exception | **MUST** | **YES** | No (009); history-reconcile SHOULD | Operator + Oren |
| A3 | Sizing/risk live smoke (testnet) | **MUST · MET ✅** (testnet smoke PASS 2026-06-30) | No (closed) | — | Operator + Oren |
| A4 | Production credential isolation (no shared prod cred) | **MUST** | **YES** | No | Operator + Oren |
| A5 | Webhook + TradingView hardening | **MUST** | **YES** | No | Operator + Oren |
| A6 | Incident/rotation runbook (closed) + go-live drill | **MUST** (drill) | **YES** (drill) | Runbook done; drill No | Operator |
| A7 | Observability / alerts (recurring) | **SHOULD** | No¹ | Yes (manual interim) | Operator |
| A8 | Frontend / admin minimum controls | **MUST** (risk controls) / SHOULD (rest) | **YES** (kill-switch surfacing) | Partial | CTO/Product |
| A9 | StrateTeach integration contract (T13 seam) | **MUST before connect** | Only if connected | Yes (until connect) | Oren + CTO |
| A10 | Production rollback / kill-switch drill | **MUST** | **YES** | No | Operator |
| A11 | Legal / financial / operator approval for real funds | **MUST** | **YES** | No | Oren (+ legal) |
| A12 | User / demo environment separation | **MUST** (before multi-user) / SHOULD (single-operator) | YES if multi-user | Yes (single-operator launch) | Operator + Oren |

¹ A7 doesn't *block* a single-operator, closely-watched first smoke, but is MUST before unattended real-funds operation.

---

## Per-gap detail

### A1 — Egress / Railway region / Binance connectivity — MUST · blocks funds · not deferrable
- **Current:** Railway shared/dynamic egress IP; testnet `451` cleared by the EU-West move (Register `380d6df6`); mainnet reachability + region policy **unverified**; no key IP-allowlist.
- **Requirement:** region-compliant, **static/allowlist-grade** egress IP; Binance mainnet API key restricted to that IP; mainnet reachability proven.
- **Why:** `451` geo-block = silent liveness outage; a mainnet key that moves real funds MUST be IP-restricted, which needs a predictable egress IP.
- **Evidence to close:** E1 — read-only mainnet probe from the prod egress succeeds (200, not 451; **no order**). E2 — documented static IP + Binance key IP-allowlist entry.
- **STOP:** no mainnet probe/key/order without Oren; do not enable key IP-restriction before the static IP is confirmed (lock-out risk); region/IP path unclear → escalate, never "try live." Detail: [A1 packet](production-a1-egress-binance-connectivity-packet.md).

### A2 — Migration 009 + migration-history exception — MUST · blocks funds
- **Current:** 009 reserved, **frozen, no file** (security hardening, held since Sprint 3). 010–014 applied **surgically**, **not** in `supabase_migrations` (documented exception); a naive `db push` would re-run 010–014.
- **Requirement:** scope → write → review → apply 009 (RLS/grant hardening); reconcile migration history so the remote `supabase_migrations` truth is restored (SHOULD, before relying on `db push`).
- **Why:** unhardened RLS/grants on a real-money DB is unacceptable; an untracked history risks a destructive accidental `db push`.
- **Evidence:** E2 — `migration list` shows 009 applied + history reconciled; as-role catalog verification PASS.
- **STOP:** 009 stays frozen until scoped + reviewed; applying it is itself a gated step; never `db push` without the 010–014 pre-check + approved reconcile.

### A3 — Sizing/risk live smoke (testnet) — MUST · **MET ✅ (2026-06-30)**
- **Status:** **CLOSED / MET (testnet).** Controlled testnet smoke **PASS** — sizing/risk live path
  proven end-to-end on testnet.
- **Requirement (met):** one Oren-approved **testnet** controlled smoke **PASS = one FILLED order**
  sized from config (`requested_notional_usdt=20`, fill, `executed_notional` persisted), then re-disarm.
  (An `order.blocked` would have been a **SAFE STOP**, **not** a pass — the outcome was a fill.)
- **Evidence (E1, 2026-06-30):** [smoke evidence](sprint5-s5-a3-b4-controlled-smoke-evidence.md) —
  trade `e1dd53ec` filled, `requested=20`/`executed=19.89`, qty `0.00034`=roundDown(20/58511.39),
  exactly-one, audit `created→filled`, caps honored; re-disarmed (`enabled_bots=0`, `QUEUE_ENABLED=false`).
- **Note:** this proved **testnet only**. Real-money sizing on mainnet remains gated by A1/A4/A11 — not
  by A3. The locked semantics stand: SMOKE PASS = one filled order; `order.blocked`/failure = SAFE STOP.

### A4 — Production credential isolation — MUST · blocks funds · not deferrable
- **Current:** 5 testnet bots **share one** credential (`2b5c038a`).
- **Requirement:** no shared **production** credential (unless explicitly Oren-approved for a single-operator launch); per-user/per-bot model; Vault-only; testnet/mainnet separated via `exchange_environment`; rotation without cross-impact.
- **Why:** a shared key = one compromise/rotation hits every bot; blast radius unacceptable with real funds.
- **Evidence:** E2 — schema + RLS proving a user/bot reaches only its own credential; rotation drill (rotate one, others unaffected).
- **STOP:** no real funds on a shared credential without an explicit, documented Oren exception; mainnet key provisioning sequenced with A1 (IP) so the key is restricted from creation. Detail: [A4 packet](production-a4-credential-isolation-packet.md).

### A5 — Webhook + TradingView hardening — MUST · blocks funds
- **Current:** `bot_id`+token in URL, HMAC verified; **no** IP allowlist; manual token rotation; signal source = simulator only.
- **Requirement:** source IP allowlist (TradingView ranges) or equivalent; scheduled token rotation; explicit replay/duplicate policy; rate-limiting/abuse controls; strict payload contract.
- **Why:** the webhook is the only inbound trigger to the money path; an unauthenticated/replayable trigger can fire unwanted orders.
- **Evidence:** E2 — allowlist enforced (off-list rejected); E1 — rotation drill (old token rejected, new accepted), replay rejected.
- **STOP:** no TradingView live connection until the contract + hardening are evidenced; TradingView must never receive any secret (see A5 packet); testnet-first. Detail: [A5 packet](production-a5-webhook-tradingview-hardening-packet.md).

### A6 — Incident/rotation runbook (closed) + go-live drill — MUST (drill)
- **Current:** runbook + tabletop **CLOSED 2026-06-29** (docs/tabletop only). A **live go-live rollback/rotation drill** has not been run.
- **Requirement:** one rehearsed drill of the go-live rollback path (disarm + token rotate + credential disable) before real funds.
- **Why:** a runbook unrehearsed under go-live conditions is unproven muscle memory.
- **Evidence:** E1 — a dry-run of the rollback sequence (on testnet/non-destructive) completes within target time. See [A10](#a10).
- **STOP:** S3/S4 incidents require Oren to resume; secrets never printed.

### A7 — Observability / alerts (recurring) — SHOULD (MUST for unattended)
- **Current:** one-shot `alert:run-once`/`alert:send`; scheduler/cron deferred (S4-1).
- **Requirement:** scheduled poller (liveness + dead-man), alert on stuck/unknown/DLQ/queue_failed, fill/error notifications.
- **Why:** real funds running unattended need automated detection; manual polling is insufficient beyond a watched first smoke.
- **Evidence:** E1 — scheduled run fires on cadence; a missed run alerts; a seeded fault alerts.
- **STOP:** first real-funds smoke must be **attended** regardless; unattended operation gated on A7.

### A8 — Frontend / admin minimum controls — MUST (risk controls) / SHOULD (rest)
- **Current:** frontend = 0% (empty Vite scaffold). All control today is direct SQL/Doppler by the operator.
- **Requirement (minimum for real funds):** a **reliable kill switch** path the operator trusts (even if CLI/SQL for v1), risk-limit visibility, and read-only trade/health visibility. Full UI (auth, credential setup, bot mgmt) is the broader B-series.
- **Why:** an operator must be able to *see* and *stop* real-money activity quickly.
- **Evidence:** E1 — the kill path (QUEUE_ENABLED=false + trading_enabled=false) is documented + drilled (A10); read-only health view available.
- **STOP:** real funds only with a proven, fast kill path; multi-user UI (B1/B2) is MUST before multi-user, not before a single-operator launch.

### A9 — StrateTeach integration contract (T13 seam) — MUST before connect
- **Current:** no StrateTeach connection; contract defined in the gap review (Praxis owns execute/audit/limit; StrateTeach owns teach/configure/generate; webhook is the only path).
- **Requirement:** T13 seam decided in the Decision Log before any connection — auth + least-privilege + Vault/Edge enforced; **no direct-execution path ever**; StrateTeach holds no keys/service_role/DB write.
- **Why:** StrateTeach's weak governance must not cross into the money core.
- **Evidence:** Decision Log T13 entry + E2 proving no cross-privilege; only relevant **if** connecting.
- **STOP:** no connection until T13 decided; the forbidden direct-execution path is permanent.

### A10 — Production rollback / kill-switch drill — MUST · blocks funds · not deferrable
- **Current:** rollback *concepts* exist (QUEUE_ENABLED=false, trading_enabled=false, token rotate, credential disable) but are **not drilled** as a single go-live sequence.
- **Requirement:** a rehearsed, timed rollback sequence; each lever proven to halt the money path independently.
- **Why:** in an incident you fall back to what you've rehearsed; an undrilled rollback is a liability with real funds.
- **Evidence:** E1 — a non-destructive drill (testnet) of the full rollback completes; each lever verified to stop flow.
- **STOP:** no real funds until the rollback drill passes. Detail: [go-live checklist + rollback](production-go-live-checklist-and-rollback.md).

### A11 — Legal / financial / operator approval for real funds — MUST · blocks funds · not deferrable
- **Current:** no explicit real-funds authorization on record.
- **Requirement:** Oren (+ any legal/financial sign-off) explicitly authorizes real funds, the initial capital ceiling, and accepted-risk posture, in writing.
- **Why:** moving real money is a business/legal decision, not an engineering one.
- **Evidence:** a recorded Oren decision (DECISIONS.md / Notion) with the capital ceiling + scope.
- **STOP:** **no real funds without this explicit written approval** — independent of all technical gates.

### A12 — User / demo environment separation — MUST (multi-user) / SHOULD (single-operator)
- **Current:** one environment; testnet via `exchange_environment=testnet` + `PRAXIS_IS_PRODUCTION=false`; no user/demo separation (no multi-user yet).
- **Requirement:** clear separation of demo/test vs real-money, and per-user data isolation (RLS) before onboarding external users; no demo path can touch a mainnet credential.
- **Why:** mixing demo and real-money state, or cross-user data leakage, is unacceptable once users exist.
- **Evidence:** E2 — environment + RLS isolation proven (a demo/test action cannot reach mainnet; a user sees only their data).
- **STOP:** no external/multi-user real funds until separation + RLS proven; a single-operator launch may proceed with this as SHOULD if Oren accepts.

---

## Bottom line
**Real funds are blocked.** A3 (live testnet smoke) is **CLOSED/MET (2026-06-30)**; the still-open
MUST-and-blocks-funds set is **A1, A2, A4, A5, A10, A11 (+ A6 drill, A8 kill path)**. Config-ready ≠
smoke-ready (✓) ≠ real-funds-ready. See the explicit blocker list in
[production-readiness-gap-review.md](production-readiness-gap-review.md) and the sequence in
[go-live checklist + rollback](production-go-live-checklist-and-rollback.md).
