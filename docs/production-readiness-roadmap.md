# Praxis — Production-Readiness Roadmap (testnet → real-funds live)

> **DOC / PLANNING ONLY — NO IMPLEMENTATION.** No deploy · no DB mutation · no flag change · no secrets · no mainnet /
> no real funds. A full map from the current **testnet** state to **production** — where TradingView alerts connect,
> real exchange/wallet credentials connect, and real signals are received and executed **safely**. Returned for Codex
> review. Nothing here authorizes work; §7 proposes the order, each item stays separately gated.
>
> **Rev 2 (2026-07-09): Codex CHANGES 1-8 applied** — added a per-gate time-estimate table (§2a), a critical-path to a
> tiny controlled real-money validation (§2b), a "Claude-immediate, no-Oren" list (§3), an "Oren/operator bottleneck"
> list (§4), an Ops-Harness-impact section (§4a, no overclaim), a 5-stage production definition (§0a), and a next-48h
> plan (§7a). Time estimates are anchored to this session's **observed throughput** (a gated code slice = design →
> Codex CP → author → LOCAL test ≈ one focused work block; calendar is dominated by review + operator/provider
> turnaround, not authoring). **Returned for Codex re-review. Planning only.**
>
> **STATUS UPDATE 2026-07-10 — A2 reconcile DONE.** The first roadmap implementation, **A2 migration reconcile 010–020**,
> was operator-run and **VERIFIED GREEN** (metadata-only; `schema_migrations` = 001–008 + 010–020; 009 absent; 0
> duplicates; 19 rows; `migration list --linked` = Local == Remote / nothing pending). A2 divergence **RESOLVED** and the
> A2 gate is **CLOSED**. **Wherever this doc lists A2 reconcile as a next/remaining item (§0a, §1, §2, §7, §7a), treat it
> as complete.** Real funds remain **NO-GO** — A1 / A4 / A8-H3 / A11 / live-tier fail-closed (+ H4, TradingView) remain
> open. See `docs/production-a2-migration-009-decision-packet.md` and `…-reconcile-010-020-packet.md` §10.

## 0. Definitions & the production bar
- **Testnet (today):** Binance **testnet** creds, no real funds, `PRAXIS_IS_PRODUCTION=false`, `QUEUE_ENABLED` off
  except gated smokes. Fail-open telemetry is tolerated.
- **Production / live (target):** **mainnet** exchange creds + real funds; **TradingView live alerts** fire real
  signals; worker executes at the **live tier** (`PRAXIS_IS_PRODUCTION=true`) with **fail-CLOSED everywhere**. Every
  mutation audited; kill/restore proven at the live tier.
- **The production bar = ALL real-funds gates closed + A11 written approval + external provisioning done.** No single
  code change flips this; it is a checklist of gates below.

## 0a. Staged production definition (the ladder)
| Stage | Definition | Real money? | Gate to enter |
|---|---|---|---|
| **Stage 1 — testnet product complete** | full pipeline + console + kill/harness proven on testnet; A5 fully closed (incl. H4 worker) | no | H4 worker closeout + ~~A2 reconcile~~ **(A2 reconcile DONE 2026-07-10)** |
| **Stage 2 — production infra ready, no real money** | credential isolation (A4/A8-H3) built; live-tier fail-closed proven; static egress + prod Doppler + monitoring stood up; **still testnet keys** | no | A4 + A8-H3 + live-tier fail-closed + A1 + prod secret topology |
| **Stage 3 — tiny controlled real-money validation** | ONE bot, real mainnet key, **minimum caps**, one/few real signals, close-watched, immediate kill ready | **yes (minimal)** | **A11 (capped)** + real key provisioned + TradingView live alert + all Stage-2 gates green |
| **Stage 4 — limited production** | a few bots/users, small caps, monitored; reconciliation clean over time | yes (bounded) | Stage-3 clean + A11 (expanded caps) + operational confidence |
| **Stage 5 — scaled production** | multi-user/multi-bot at intended scale | yes (full) | Stage-4 clean + capacity/monitoring/support maturity |

**Current position: entering Stage 1's tail** (testnet product nearly complete; **A2 reconcile DONE 2026-07-10**; H4
worker closeout remains).

## 0b. Consolidated stages × blockers table (across the packet set)
Columns distinguish **Claude-autonomous** work from **Oren/provider** blockers. "Active work" = focused authoring/design
blocks (§2a); "Calendar risk" = external turnaround, not effort.
| Stage | Gate | Owner | Claude start now? | Needs Oren? | Needs provider? | Blocks real funds? | Expected active work | Expected calendar risk |
|---|---|---|---|---|---|---|---|---|
| 1 | H4 worker log-redaction closeout | operator grep → Claude read-back | plan yes; grep no | yes (grep) | no | no (quality) | ~0.5 blk | med (needs an armed-worker run in retention) |
| 1 | ~~A2 migration reconcile 010–020~~ **DONE 2026-07-10 (APPLIED + VERIFIED GREEN)** | Claude author → Codex → operator | ✅ done | ✅ ran inserts | no | ✅ closed | ✅ complete | ✅ |
| 1 | `credential_*` redaction cleanup | Claude → Codex | **yes** | no | no | no | 0.25–0.5 blk | none |
| 2 | A8-H3 / KP5 credential isolation | Claude/Codex (+ Oren keys) | **yes (design)** | yes (apply/keys) | no | **YES** | 1–2 blk | med (coupled to A4) |
| 2 | A4 real per-bot-per-user credential architecture | Claude/Codex + Oren (keys) | **yes (design)** | yes (keys) | no | **YES** | 2–3 blk | med (Vault-per-bot decision) |
| 2 | Live-tier fail-closed proof | Claude/Codex + operator (proof) | **yes (design)** | yes (proof run) | no | **YES** | 2 blk | med (gated proof run) |
| 2 | A1 static egress IP + exchange allowlist | Oren + provider | packet only | yes | **YES** | **YES** | 0.5–1 blk (packet) | **high (provider capability/cost)** |
| 2 | Rotate remaining exposed secrets + prod Doppler | Oren/operator | no | yes | no | **YES** | — (operator) | med |
| 2 | Ops Harness Slice C (stop-only ops actions) | Claude/Codex | **yes (design)** | yes (validate) | no | no (ergonomics) | 1–2 blk/action | low |
| 3 | Real mainnet keys (trade-only) → Vault | Oren + exchange | no | yes | **YES** | **YES** | — (operator) | **high (account/custody)** |
| 3 | TradingView live alert + no-token-exposure path | Oren + Claude (runbook) | yes (runbook) | yes | **YES (TV tier)** | **YES** | 0.5–1 blk | **high (TV account/config)** |
| 3 | A8-H4 live kill drill (kill/restore at live tier) | operator → Claude read-back | yes (adapt runbook) | yes (run) | no | **YES** | ~0.5 blk | med (gated live run) |
| 3 | **A11 written approval (capped)** | **Oren** | no | **yes** | no | **YES (hard gate)** | n/a | **Oren decision** |
| 4–5 | Scale / monitoring / support maturity / reconciliation | Oren + Claude | partial (design) | yes | maybe | operational | ongoing | ongoing |

---

## 1. DONE / testnet-proven
| Area | State |
|---|---|
| Webhook → queue → worker pipeline | built + testnet-proven (Sprints 3–4) |
| Operator Console (read-only status) | live on testnet — `operator_status()` (016), `worker_status` (015), auth/operator gate |
| A5 webhook hardening | **H1** rate-limit deployed+ENABLED (testnet 60/20); **H5** negatives; **H6** controlled positive PASS; **3 webhook tokens rotated** via server-side hasher (`admin-rotate-webhook-token`, migration 018) |
| A10 kill-switch drill | **RUN + PASS** (K1–K4, zero orders) — runtime kill-path evidence |
| A8-H2 audited one-click kill | **BUILT + testnet-VALIDATED** (migration 019); testnet-CLOSED; `operator_kill_all` audited, reversible |
| Ops Harness Slice A (read-only) | **LIVE on testnet** (migration 020: `operator_status` + `id` + `kill_rpc_present`); preflight / baseline / verifiers / evidence / NON-EXECUTABLE restore-draft; harness flag ON, kill flag OFF |
| Server-side webhook hasher | built + smoke-validated (operator never handles the pepper) |
| Migrations 010–020 | applied surgically to live DB **and now TRACKED** — A2 reconcile **DONE + VERIFIED GREEN 2026-07-10** (`schema_migrations` = 001–008 + 010–020, 009 absent, 0 dups, 19 rows; `migration list --linked` Local == Remote / nothing pending) |

**Testnet-proven ≠ production-trusted.** A10/A8-H2/H6 are *testnet* evidence; live-tier proof is a separate gate (§2).

## 2. STILL BLOCKING real production (the gate list)
| Gate | What it is | Why it blocks | Needs |
|---|---|---|---|
| **A1** egress / static IP | worker's outbound IP must be **static + allowlisted** on the exchange (mainnet API often IP-locks keys) | mainnet orders rejected / insecure without a pinned egress | provider static-egress IP or proxy; exchange allowlist entry (external + Oren) |
| ~~**A2** migration reconcile 010–020~~ **✅ CLOSED 2026-07-10** | ~~tracking says 001–008; reality is +010–020 (untracked)~~ **RESOLVED** — tracking now == reality (001–008 + 010–020, 009 absent) | ~~a future `db push` mis-fires~~ **no longer a landmine** (`migration list --linked`: nothing pending) | **DONE** — reviewed metadata-only artifact `docs/sql/a2-reconcile-010-020.sql` operator-run + read-back-verified GREEN |
| **A4** real exchange creds + **per-bot-per-user credential isolation** | today a credential can be **shared** across bots; prod needs each user/bot's own isolated mainnet key | shared keys = blast radius + wrong-attribution + custody risk | schema/worker design + migration; Oren provisions real mainnet keys into Vault |
| **A8-H3 / KP5** credential blast-radius isolation | a shared-credential kill (`status=invalid`/Vault delete) disables **every** bot using it | custody-lock kill unsafe until per-bot isolation exists | design (per-bot isolation OR explicit emergency-only procedure) → build |
| **A11** written real-funds approval | Oren's explicit written go for mainnet/real funds | hard gate — nothing goes live without it | Oren (out-of-band) |
| **Live-tier fail-closed proof** | worker must **fail CLOSED** at `PRAXIS_IS_PRODUCTION=true` (rate-limit, sizing/risk, kill gates, telemetry) | testnet tolerates fail-open; live must reject on any doubt | implement live-tier semantics + gated proof run |
| **H4 worker log-redaction closeout** | webhook side COMPLETE; **worker side PARTIAL** (armed-window logs aged out) | secret-in-logs unproven for the worker execution path | grep a future armed-worker run within retention (operator) |
| **TradingView production alert setup** | real TV alerts → the live webhook, with the real token | no live signal source until configured | TV account/config (external) + alert→webhook mapping design |
| **Real webhook token handling / no-exposure path** | the live token lives in the TV alert URL; must never be locally fired/exposed before live | a locally-fired token is "burned" → re-rotate | design a provisioning path (rotate via server-side hasher → put in TV, never local terminal) |
| **Secret hygiene / Doppler exposure** | remaining exposed dev secrets (postgres / report_ro / pepper / Vault-cred / git-ssh per the 2026-06-26 exposure) | prod must not inherit compromised secrets | rotate the remainder before prod; prod Doppler config gated |
| **Prod secret topology / Doppler prod config** | Doppler is source-of-record → Railway sync; prod config not stood up | live worker needs prod secrets wired | operator provisions prod Doppler config + Railway sync |

## 2a. Time-estimate table (anchored to observed throughput)
Active work = focused authoring/design blocks (a gated code slice ≈ one block, per this session's cadence). Calendar
adds review + operator/provider turnaround. Estimates are ranges, not commitments.
| Gate | Optimistic active | Realistic active | Calendar-risk / external dep | Owner |
|---|---|---|---|---|
| ~~A2 reconcile 010–020~~ **DONE 2026-07-10** | — | — | ✅ complete (operator ran reviewed inserts; verified GREEN) | Claude author → Codex → operator |
| H4 worker log closeout | 0 (attach to next armed run) | 0.5 block (grep + doc) | med — depends on a future armed-worker run in retention | operator run → Claude read-back |
| `credential_*` redaction cleanup | 0.25 block | 0.5 block + review | none | Claude → Codex |
| A4 credential isolation | 1 block design | 2–3 blocks (design+migration+worker+tests) | med — depends on Vault-per-bot model decision | Claude/Codex; Oren provisions keys |
| A8-H3 / KP5 isolation | 0.5 block design | 1–2 blocks (rides on A4) | med — coupled to A4 | Claude/Codex |
| Live-tier fail-closed | 1 block design | 2 blocks (impl + proof runbook) | med — needs a gated proof run | Claude/Codex; operator runs proof |
| A8-H4 live kill drill | 0 (runbook exists) | 0.5 block (adapt runbook) | med — gated live-tier run | operator run → Claude read-back |
| Ops Harness Slice C (stop-only) | 1 block/action design | 1–2 blocks per action | low | Claude/Codex; operator validates |
| A1 static egress IP | 0.5 block (decision packet) | 1 block packet | **high — provider capability + cost** | Oren + provider; Claude authors packet |
| Rotate remaining exposed secrets | 0 (Claude) | — | med — operator-run rotations | Oren/operator |
| Prod Doppler + Railway sync | 0 (Claude) | — | med — operator setup | Oren/operator |
| Real mainnet keys → Vault | 0 (Claude) | — | **high — external account + custody** | Oren + exchange |
| TradingView prod alerts | 0.5 block (runbook) | 1 block runbook | **high — TV account/tier + config** | Oren; Claude authors runbook |
| A11 written approval | n/a | n/a | **hard gate — Oren decision** | Oren |

**Read:** the *code/design* work is small and Claude-authorable; the **calendar is dominated by external provisioning
(A1 static IP, mainnet keys, TradingView) and the A11 decision** — not by implementation effort.

## 2b. Critical path — shortest SAFE route to a tiny controlled real-money validation (Stage 3)
This is the **minimum** to fire **one** real signal on **one** bot with **minimum caps** — deliberately narrower than
full scalable production (§7 Phases handle scale).
1. **A2 reconcile** (trustworthy migration history) — Claude-authorable now.
2. **A4 (single-bot slice) + A8-H3** — per-bot credential isolation for **one** bot (not the full multi-user model);
   enough that the one real key is isolated and its kill can't blast others.
3. **Live-tier fail-closed** (implement + gated proof) — the worker must reject-on-doubt at the live tier.
4. **A1 static egress IP + exchange allowlist** — the one hard external dependency for mainnet orders.
5. **Real mainnet key (one, trade-only, no-withdrawal) → Vault**; **rotate remaining exposed secrets**; **prod Doppler**.
6. **TradingView live alert** for the one bot + **no-token-exposure** token placement.
7. **A8-H4 live kill drill** (prove kill/restore at the live tier) + a **capped A11** for the single controlled run.
8. **Fire one real signal, minimal cap, close-watched, kill ready** → observe → decide.

**Critical-path gating dependencies:** A2 → A4/A8-H3 → live-tier fail-closed can proceed on testnet keys in parallel
with the external track (A1 + mainnet key + TradingView). **A11 (capped) is the final gate before step 8.** Full
scalable production (Stages 4–5) is a *separate* effort layered on top — do NOT conflate the tiny validation with scale.

## 3. What CLAUDE can start IMMEDIATELY (no Oren, no infra — design/authoring/read-only only)
All Codex-gated before any code lands; none needs Oren, secrets, deploy, or DB mutation to *start*.
1. **A2 migration reconcile packet** — exact `INSERT INTO supabase_migrations.schema_migrations` set + per-object verify
   checklist for 010–020 (execution is operator/Codex-gated).
2. **A8-H3 / KP5 design** — per-bot credential isolation OR an explicit emergency-only custody-lock procedure.
3. **A4 credential architecture design** — per-bot-per-user isolation (schema + worker read path + Vault-pointer-per-bot);
   design only, no secrets.
4. **Live-tier fail-closed runbook** — every gate's live-vs-testnet behavior + a fail-closed test matrix + proof plan.
5. **TradingView production alert runbook** — alert→webhook mapping, payload/token format, and the "rotate → place in TV,
   never fire locally" no-exposure token path.
6. **Monitoring / audit / evidence checklist** — required prod observability (audit_logs coverage, reconciliation, DLQ,
   worker heartbeat, alert channel, "no mutation without an audit row").
7. **`credential_*` redaction cleanup** — tighten the over-broad secret-name pattern (harness `generateEvidence` +
   checks) to exact secret keys.
8. **H4 worker closeout trigger plan** — the exact grep + attach-to-next-armed-run plan so the worker log-redaction
   closes on the next armed testnet run within retention.
- *(+ Ops Harness Slice B/C designs, and read-only read-backs on request.)*

## 4. OREN / OPERATOR bottleneck (these gate the calendar; Claude cannot do them)
- **Static IP / provider decision** — choose + procure the static-egress mechanism (A1).
- **Binance / mainnet account + API key creation** — real exchange account, trade-only keys (no withdrawal).
- **IP allowlist** — enter the static egress IP into the exchange key's allowlist.
- **Doppler / Railway secret entry** — stand up prod Doppler config + Railway sync; enter/rotate secrets (operator never
  hands keys/pepper to Claude).
- **TradingView alert creation** — production alert(s) with the live webhook + token.
- **A11 written real-funds approval — with explicit caps/limits** (per-order + daily notional, bot count, kill authority).
- **Any real-money execution approval** — the go for each live signal / arming (per-run for Stage 3).
- **Run all gated proofs & mutations** — linked applies (A2/A4, surgical, never `db push`), deploys, live-tier
  fail-closed proof, H4 worker grep, A8-H4 live kill drill; **Claude read-backs only.**

## 4a. Ops Harness impact (what it now reduces — and what it does NOT)
**Reduces (evidence/read-back friction — proven this session):** the harness turned the ~10–15 manual copy/paste read
steps of a gated run into a preflight click + baseline capture + verifier + evidence export. In production ops it is the
**read-back / preflight / disarmed-verifier / evidence-and-restore-draft** surface — fewer manual SQL/curl/DOM steps per
run, consistent evidence packets, and (with Slice C, future) the stop-only kill/disable controls.
**Does NOT reduce (no overclaim):** it does **not** do provider setup (static IP, exchange account, TradingView), **key
custody / secret entry** (operator-only, never Claude), the **A11 decision**, linked migration applies, deploys, or any
real-money approval. It is an **operator ergonomics + evidence** tool, not an automation of the gated approvals or the
external/custody work. Kill/arm remain gated; the harness itself has **no mutation surface** today (read-only).

## 5. What requires CODEX REVIEW before implementation
Every item in §3 that becomes code/migration/deploy — **design → Codex CP → implement → LOCAL test → gated apply →
validation**, matching the A8-H2 / Ops-Harness cadence:
- A2 reconcile INSERTs (reviewed before any linked run).
- A4 credential-isolation migration + worker changes.
- A8-H3 credential-isolation / emergency procedure.
- Live-tier fail-closed code + its proof runbook.
- Ops Harness Slice C mutation RPCs (each), Slice B run-tracker tables.
- TradingView/webhook token-handling changes; any secret-topology change.
- The A1 egress approach (proxy/static-IP wiring).

## 6. What requires EXTERNAL SETUP / PROVIDER work
- **Static egress IP** — Railway static-egress add-on or an outbound proxy/NAT with a fixed IP (A1).
- **Exchange (Binance) mainnet** — real API keys, **IP allowlist**, permissions scoped (trade-only, no withdrawal).
- **TradingView** — paid tier for webhook alerts; production alert setup.
- **Doppler** — prod config/project; Railway↔Doppler prod sync.
- **Custody / wallet** decisions if wallet credentials (beyond exchange keys) are in scope.
- **Monitoring/alerting** channel (e.g., Telegram alert bot — confirm it's wired for prod).
- **PITR / backups** verified for the prod DB tier.

## 7. Suggested ORDER of work (phased; each gated)
**Phase 0 — De-risk & reconcile (no real funds; Claude-authorable now):**
1. **A2 reconcile packet** (author → Codex → operator runs the inserts → tracking == reality). Unblocks trustworthy
   migrations for everything after.
2. **H4 worker-log closeout** (attach to the next armed-worker testnet run; operator grep) → A5 fully COMPLETE.
3. **Cleanup:** secret-name pattern (`credential_*`) tighten.

**Phase 1 — Credential architecture (the core real-funds enabler):**
4. **A4 per-bot-per-user credential isolation** design → build → testnet-validate.
5. **A8-H3 / KP5** credential blast-radius isolation (rides on A4) → close A8 fully.

**Phase 2 — Live-tier safety proofs (still testnet creds):**
6. **Live-tier fail-closed** implement + gated proof run (rate-limit/sizing/kill/telemetry all reject-on-doubt at
   `PRAXIS_IS_PRODUCTION=true`).
7. **A8-H4 live kill drill** — re-run the kill paths + the audited one-click kill at the live tier (runtime + timing).
8. **Ops Harness Slice C** (stop-only `disable_bots`/`set_pause`) — the production operational kill/disable surface;
   Slice B run tracker if run-audit is wanted.

**Phase 3 — External provisioning (Oren/providers; parallelizable with Phase 1–2 design):**
9. **A1 static egress IP** + **exchange mainnet allowlist**.
10. **Rotate remaining exposed secrets**; stand up **prod Doppler config** + Railway sync.
11. **Provision real mainnet keys** into Vault (per-bot-per-user, from A4).

**Phase 4 — Signal source & token path:**
12. **TradingView production alerts** + the **no-token-exposure** provisioning (rotate → place in TV, never local).

**Phase 5 — Go-live gate:**
13. **A11 written approval** + a final green pre-flight (all gates closed, disarmed, kill/restore proven live) → arm a
    single bot with minimal caps → observe → scale. **Not before.**

## 7a. Suggested next 48-hour plan (Claude-authorable, no-Oren, planning/design — each Codex-gated)
Ordered by leverage; all design/authoring only (no deploy/DB/secrets/mainnet):
1. **A2 reconcile packet** — author the `INSERT`s + per-object verify for 010–020 → Codex. (Unblocks trustworthy
   history; highest leverage.)
2. **`credential_*` redaction cleanup** — small, closes the one open non-blocking item from the harness run → Codex.
3. **A8-H3 / KP5 design** — per-bot credential isolation / emergency procedure (feeds A4 + closes A8) → Codex.
4. **A1 / static-IP decision packet** — enumerate the static-egress options (Railway add-on / proxy / NAT), cost/latency
   trade-offs, and the exchange-allowlist steps → Codex, then it's ready for Oren's provider decision.
- *(Stretch, if bandwidth: start the A4 credential architecture design — but A8-H3 first since it scopes A4.)*
**End-of-48h target:** four reviewed design/reconcile packets queued; zero infra touched; the two hard external items
(A1 provider, mainnet key) teed up for Oren; **real funds still NO-GO.**

## Cross-cutting requirements
- **Rollback / kill / restore readiness (prod):** A8-H2 kill (built) + reviewed restore packets + A10/A8-H4 drills; the
  Ops Harness preflight/disarmed-verifier + Slice-C stop actions are the operational surface. **Live-tier kill drill is
  a gate (Phase 2).**
- **Monitoring / audit / evidence:** `audit_logs` (append-only) covers every operator/worker mutation; `worker_status`
  heartbeat; `operator_status`/Ops-Harness for read-back; reconciliation jobs + DLQ watched; a live alerting channel.
  **Requirement: no mutation without an audit row; every gated run produces an evidence packet.**
- **Testnet-only vs mainnet/live:** stays testnet until Phase 5 — Binance **testnet** creds, `QUEUE_ENABLED` off,
  `PRAXIS_IS_PRODUCTION=false`, harness read-only. **Becomes mainnet/live** only at Phase 5 with A11 + real keys +
  live-tier fail-closed + static IP + TradingView.
- **Security gaps / operational risks (open):** shared-credential blast radius (A4/A8-H3); remaining exposed dev secrets
  (rotate before prod); migration divergence (A2); no static egress yet (A1); worker log-redaction unproven (H4);
  live-tier fail-closed unproven; over-broad secret-name pattern (cleanup); TradingView token-in-URL exposure risk.

## GO / NO-GO
- **This roadmap:** PLANNING, Rev 2 — **no implementation, no deploy, no DB mutation, no flag change, no secrets, no
  mainnet / no real funds.** **Returned for Codex re-review.** On PASS, start the §7a 48-hour plan (A2 reconcile packet
  first) — design/authoring only, each subsequent item separately Codex-gated.
- **Real funds = NO-GO** until every §2 gate is closed + A11 (with caps). This map is the checklist to get there safely;
  it commits to nothing by existing.
