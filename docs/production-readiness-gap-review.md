# Production Readiness Gap Review (Sprint 5 planning)

**Status:** PLANNING / DRAFT — not canon, not a commitment to execute. Read-only synthesis of the
gaps between the current **testnet-proven** state (Sprint 4 closed: webhook → pgmq → worker →
Binance Testnet fill → audit, with reconciliation + bot-error recovery; `full_s4_2=GO`) and a
**production (LIVE, mainnet, real users)** posture. No code / DB / Doppler / Railway / execution —
this document only. Authority over scope/priority is the operator + Oren; each item below closes
only on cited E1/E2 evidence (Governance v1.0 §8).

Grounding: [DECISIONS.md](DECISIONS.md) (deferred/carried list), [sprint4-s4-8-closure-review.md](sprint4-s4-8-closure-review.md)
§4–§5, [sprint3-closure-review.md](sprint3-closure-review.md) (Migration 009 frozen), the Ecosystem
Map (Praxis / StrateTeach / 770 — Foundation Draft). **Frontend = 0%** today (empty Vite scaffold).

---

## A. Backend gaps to production

| # | Gap | Current (testnet) | Production requirement | Evidence to close | Pri |
|---|-----|-------------------|------------------------|-------------------|-----|
| A1 | **Production egress** | Railway shared egress IP; testnet 451 cleared by EU-West move (Register `380d6df6`) | Allowlist-grade **static** egress IP + **verified mainnet Binance** IP/policy | E1: mainnet read probe from the prod IP succeeds; E2: documented static IP + Binance allowlist entry | **MUST** |
| A2 | **Migration 009 — security hardening** | Reserved number, **frozen, no file** (held since Sprint 3) | Scope → write → review → apply the RLS/grant/security-hardening migration | E2: `supabase migration list` shows 009 applied; as-role catalog verification PASS | **MUST** |
| A3 | **Order sizing / risk (S5-A3/B4)** | **MET (testnet)**: code merged + config-ready + **controlled TESTNET smoke PASS (2026-06-30)** — one filled order `requested=20`/`executed=19.89`, exactly-one, caps honored, re-disarmed; per-symbol floor removed; SELL fail-closed; 402 unit tests | Live sizing/risk proven on testnet (done); real-money sizing within Oren-set caps still pending **mainnet** (gated by A1/A4/A11) | E1 **MET (testnet)**: [smoke evidence](sprint5-s5-a3-b4-controlled-smoke-evidence.md) PASS; E2 config-ready done | **MET (testnet smoke)** · mainnet sizing pending |
| A4 | **Credential isolation** | One **shared** testnet credential (`2b5c038a`) across all 5 bots | Per-user / per-bot credentials; blast-radius isolation; rotation without cross-impact | E2: schema + RLS proving a user/bot reaches only its own credential; rotation drill | **MUST** |
| A5 | **Webhook ingress hardening** | bot_id+token in URL; HMAC verified; no IP allowlist; manual token rotation | IP allowlist for the signal source + **scheduled token rotation** procedure (S4-6a) | E2: allowlist enforced (reject off-list); E1: rotation drill (old token rejected, new accepted) | **MUST** |
| A6 | **Incident / rotation protocol** | **CLOSED 2026-06-29** ([runbook](sprint5-s5-a6-incident-rotation-runbook.md) · [tabletop](sprint5-s5-a6-tabletop-dry-run.md)) — **docs / tabletop only, no execution** (was ad-hoc until the 2026-06-26 Doppler exposure) | Documented incident + full-rotation runbook (lessons: `doppler` prints values; Doppler→Railway sync; Vault credential re-encrypt; legacy-key disable) | **MET** — runbook + tabletop dry-run (S3 walkthrough PASS) + Codex review PASS + Oren acceptance | **MUST · DONE** |
| A7 | **Real signal-source connectivity** | TradingView **simulator** only (`scripts/*-fire.sh`) | A real, authenticated signal source (TradingView live and/or StrateTeach via the governed seam) end-to-end | E1: a real external signal → fill, on testnet first | **MUST** (gates LIVE) |
| A8 | **Runtime reconciliation scan** | **Boot-only** (S4-3b `setInterval(60s)` deferred) | Continuous in-process reconciliation so unknowns resolve without a restart | E1: a stuck unknown resolves within the scan interval, no restart | **SHOULD** |
| A9 | **queue_failed sweeper** | None — `queue_failed` rows durable but swept manually (webhook `index.ts` "sweeper deferred"; a stale WB5 row was cleaned by hand) | Automated detection/alert/retry-or-DLQ of `queue_failed` rows | E1: a seeded `queue_failed` row is detected + alerted/handled automatically | **SHOULD** |
| A10 | **Recurring alerting** | One-shot `alert:run-once`/`alert:send` (S4-1 scheduler deferred) | Scheduled poller (Railway cron) with liveness + dead-man | E1: scheduled run fires on cadence; missed-run alert | **SHOULD** |

---

## B. Frontend gaps (Frontend = 0% — empty Vite scaffold)

| # | Surface | Production requirement | Evidence to close | Pri |
|---|---------|------------------------|-------------------|-----|
| B1 | **Auth** | Supabase Auth (login/session/RLS-bound), MFA-ready; no keys-in-browser | E1: a user signs in and sees only their own RLS-scoped data | **MUST** |
| B2 | **Credential setup UI** | Add/rotate exchange API keys → **Vault only** (never DB/browser); shows `vault_secret_id` ref, not the key | E1: key entered → stored in Vault → never returned to the client | **MUST** |
| B3 | **Bot management** | Create/edit/activate/deactivate bots; per-bot symbol/credential/sizing config | E1: CRUD respects RLS + fail-closed governance | **SHOULD** |
| B4 | **Risk controls** | Per-bot/per-user limits (max notional, daily cap, kill-switch) surfaced + enforced | E1: a limit blocks an over-cap order (server-enforced, UI reflects) | **MUST** (real money) |
| B5 | **Read-only dashboard** | Trades, fills, status, P&L, queue/DLQ health (read-only, RLS-scoped) | E1: dashboard reads via least-privilege role | **SHOULD** |
| B6 | **TradingView setup wizard** | Guided webhook URL + token + payload-format setup for the user's signal source | E1: a user completes setup → a test fire is accepted | **COULD** |
| B7 | **Admin / ops read-only console** | Cross-tenant read-only ops view (queue, DLQ, reconciliation, alerts) for operators | E1: ops console reads via a scoped read-only role, no write path | **COULD** |

---

## C. Strateteach ⇄ Praxis contract

**Ownership split (from the Ecosystem Map — Foundation Draft):**
- **StrateTeach / 770 owns: teach + configure + generate.** Strategy education, the strategy lab,
  signal/strategy generation, learn/assistant, the idea→bot authoring experience. Governance/security
  there is weak (Audit v1.1, mostly unverified) — its patterns do **not** define the money path.
- **Praxis owns: execute + audit + limit.** The secure execution core — receives signals, applies
  fail-closed governance (Profile ⊇ Credential ⊇ Bot ⊇ Signal), sizes/places/reconciles orders,
  writes the audit trail, and enforces risk limits. **Praxis is the only component that touches the
  exchange or moves money.**

**Data contract (StrateTeach → Praxis, the ONLY allowed path):**
- Transport: the **governed webhook** `/functions/v1/webhook/{bot_id}/{token}` (HMAC-verified,
  per-bot token, IP-allowlisted in prod). Nothing else.
- Payload: the signal envelope only — `signal_id` (source-supplied, reject-if-absent),
  `action` (buy/sell), optional dedup fields (`fire_time`/`close`/`volume`). **Symbol comes from
  `bots.trading_pair`, never from the payload; quantity is computed by Praxis (sizing), never sent.**
- Configuration: bots/credentials are created/edited via Praxis (UI + RLS), not pushed by StrateTeach.
- StrateTeach holds **no exchange keys, no service_role, no DB write** to Praxis tables.

**Forbidden direct-execution path (hard boundary — T13 seam):**
- StrateTeach (or its browser/admin) **must never** call the exchange, decrypt Vault, write `trades`,
  or invoke `createOrder` directly. All execution flows through the gated webhook → pgmq → worker →
  audit → limits. The StrateTeach "keys-in-browser / admin-for-all" patterns (F1–F4, unverified)
  **do not cross into the core**. The integration seam (T13) is decided in the Decision Log before
  any connection, with auth + least-privilege + Vault/Edge enforced.

---

## D. Prioritized Sprint 5 plan

### MUST (gate LIVE / real users — none ships to mainnet until ALL closed with E1/E2 + Oren sign-off)
- A1 production egress · A2 Migration 009 · A3 real order sizing · A4 credential isolation ·
  A5 webhook ingress hardening (allowlist + token rotation) · A6 incident/rotation protocol ·
  A7 real signal-source connectivity (testnet-first) · B1 auth · B2 credential setup UI ·
  B4 server-enforced risk controls.

### SHOULD (production-quality operations / usable product)
- A8 runtime reconciliation scan · A9 queue_failed sweeper · A10 recurring alerting ·
  B3 bot management · B5 read-only dashboard.

### COULD (polish / later)
- B6 TradingView setup wizard · B7 admin/ops read-only console · Unified Shell + StrateTeach UX
  migration · user-facing naming decision (Open Question to Oren).

### Stop conditions (hard gates)
- **No LIVE / mainnet** until every MUST is closed with cited E1/E2 evidence **and** Oren sign-off.
- **No real funds** while order sizing is a placeholder (A3 open) or risk limits are not
  server-enforced (B4 open) or credentials are shared (A4 open).
- **No StrateTeach connection** until the T13 seam is decided (Decision Log) with least-privilege +
  no keys-in-browser; **no direct-execution path** ever.
- **Migration 009 stays frozen** until scoped + reviewed; applying it is itself a gated step.
- Any secret exposure → the A6 incident protocol; rotate before resuming.
- Testnet-first for every new runtime path; production egress/mainnet only after the MUST gate.

### Evidence required (per item)
Each MUST/SHOULD closes only on **E1 (runtime, cited command+output+date)** and/or **E2 (platform —
migration list, catalog, config)**, per Governance v1.0 §8. LIVE readiness = the MUST set closed +
a documented go-live checklist + Oren's decision. No item closes on E3/E4.

### Suggested Notion Workstream rows (Operating Model v1.1 — new work = a Workstream row)
| Row (title) | Bucket | Gate / owner |
|---|---|---|
| S5 — Production egress (static IP + mainnet Binance policy) | MUST | E1/E2 · Oren |
| S5 — Migration 009 security hardening (scope→apply) | MUST | E2 · Oren |
| S5 — Order sizing: position_size_pct / live price | MUST | E1 · CTO+Product |
| S5 — Credential isolation (per-user/bot) | MUST | E2 · Oren |
| S5 — Webhook ingress hardening (allowlist + token rotation, S4-6a) | MUST | E1/E2 · Oren |
| S5 — Incident & full-rotation runbook | MUST | doc + dry-run |
| S5 — Real signal-source connectivity (TradingView/StrateTeach) | MUST | E1 · testnet-first |
| S5 — Frontend: Auth + credential setup (Vault-only) | MUST | E1 |
| S5 — Server-enforced risk controls | MUST | E1 |
| S5 — Runtime reconciliation scan (S4-3b) | SHOULD | E1 |
| S5 — queue_failed sweeper | SHOULD | E1 |
| S5 — Recurring alerting (scheduler/cron) | SHOULD | E1 |
| S5 — Frontend: bot management + read-only dashboard | SHOULD | E1 |
| S5 — StrateTeach T13 integration seam (Decision Log first) | COULD→MUST-before-connect | Decision Log · Oren |

---

## E. Go-live package (2026-06-30) + real-funds recommendation

A production go-live decision package was produced (docs / design only — no execution):
- [production-go-live-gap-list.md](production-go-live-gap-list.md) — A1–A12 go-live gaps (owner,
  blocks-funds, deferrable, stop condition) + readiness tiers.
- [production-a1-egress-binance-connectivity-packet.md](production-a1-egress-binance-connectivity-packet.md) — egress / region / connectivity (read-only proof, static-IP requirement).
- [production-a4-credential-isolation-packet.md](production-a4-credential-isolation-packet.md) — no shared prod credential; model options; blast radius; rotation.
- [production-a5-webhook-tradingview-hardening-packet.md](production-a5-webhook-tradingview-hardening-packet.md) — webhook/TradingView contract; replay/dupe/rate-limit/allowlist; response hygiene.
- [production-go-live-checklist-and-rollback.md](production-go-live-checklist-and-rollback.md) — phased go-live sequence, mainnet gates, first real-money smoke, rollback levers, time blocks.
- [sprint5-s5-a3-b4-controlled-smoke-packet.md](sprint5-s5-a3-b4-controlled-smoke-packet.md) — testnet live sizing/risk smoke procedure.
- [sprint5-s5-a3-b4-controlled-smoke-evidence.md](sprint5-s5-a3-b4-controlled-smoke-evidence.md) — **smoke E1 evidence: SMOKE PASS, re-disarmed (2026-06-30)**.

**Status deltas since the original review:**
- **A6** incident/rotation protocol — **CLOSED** (runbook + tabletop + Codex PASS + Oren accept).
- **A3** sizing/risk — **CLOSED / MET (testnet)**: code merged + config-ready + **controlled TESTNET
  smoke PASS** (2026-06-30 — one filled order `requested=20`/`executed=19.89`, exactly-one, caps
  honored, re-disarmed; floor placeholder gone). Real-money sizing remains gated by the other MUST
  gates + A11 (mainnet), not by A3 itself.

**Current MUST blockers for REAL FUNDS:** A1 egress · A2 Migration 009 · A4 credential isolation ·
A5 webhook/TradingView hardening · A10 rollback drill · A11 written real-funds approval (+ A8 trusted
kill path). **(A3 live testnet smoke — CLOSED/MET 2026-06-30.)** **Real-funds-ready remains NO.**
Config-ready ≠ smoke-ready (✓) ≠ real-funds-ready.

**Explicit recommendation: NO real funds** until the **remaining MUST gaps are closed with cited
E1/E2 evidence AND Oren gives written authorization (A11)**. The controlled testnet smoke has **PASSED
(✓ 2026-06-30)** — that proved the live sizing/risk path on **testnet only**; it does **not** open
mainnet. Recommended next gate: **A10 rollback / kill-switch drill** before any multi-bot or
production work.

---

**This document is planning only.** It introduces no canon decision and triggers no execution.
Promote individual rows into gated Sprint-5 work as the operator/Oren approve; each then follows the
design → review → approve → execute → evidence loop. `QUEUE_ENABLED=false`; Migration 009 frozen.
