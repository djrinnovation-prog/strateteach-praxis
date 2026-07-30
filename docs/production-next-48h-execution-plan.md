# Praxis — Next 48-Hour Execution Plan (Planning)

> **DOC / PLANNING — NO IMPLEMENTATION.** No deploy · no linked apply · no DB mutation · no Railway/Doppler change · no
> secrets · no mainnet/real funds. Overnight draft, **uncommitted**, for Codex/Oren review. Operationalizes
> `docs/production-readiness-roadmap.md` §7a.

## Scope (planning only — explicit)
- **Planning only.** No deploy. No linked apply. No DB mutation. No Railway/Doppler change. No secrets. No mainnet / no real funds. **Real funds remain NO-GO.**
## 0. Day 1 / Day 2 (plan/review vs implementation — explicit)
> **Default for the whole 48h = DOCS ONLY (planning/review).** No provider action, no secret entry, no deploy, no linked
> apply, no mainnet — **unless a specific item is explicitly Oren-approved** to move to implementation, and only **after
> its packet gets Codex PASS.**
- **Day 1 — reviewable packets (docs only):** finish/refine A2 reconcile, `credential_*` cleanup, A8-H3, A1 decision.
  **Output:** four Codex-ready packets + read-only discovery evidence (migration matrix, shared-credential scan). No
  implementation.
- **Day 2 — decisions + (optionally) the first implementation:** Oren + Codex review the packets; Oren answers the A1
  provider question and the A11-caps question; **if** A2 reconcile gets Codex PASS **and** Oren approves, the *only*
  candidate to move to implementation is **A2 reconcile** (author the exact `INSERT`s → per-object verify → operator
  runs). Everything else stays docs until separately approved. **Output:** go/no-go on first implementation; A4 +
  live-tier + TradingView runbooks drafted if bandwidth.
- **Ends as DOCS ONLY (no implementation in 48h regardless):** A4 architecture, A1 decision (provider action is Oren's),
  live-tier fail-closed, TradingView runbook, monitoring checklist. **Can become implementation ONLY after Codex PASS +
  Oren approval:** A2 reconcile (metadata inserts, operator-run), then A8-H3 (later).

## 1. Recommended order (highest leverage first; all design/authoring, each Codex-gated)
1. **A2 migration reconcile packet → Codex → operator runs inserts.** Unblocks trustworthy migration history for
   everything downstream. (`docs/production-a2-migration-reconcile-010-020-packet.md`.)
2. **`credential_*` redaction cleanup** — small; closes the one open non-blocking item from the harness run.
   (`docs/ops-harness-credential-redaction-cleanup-plan.md`.)
3. **A8-H3 / KP5 credential isolation design → Codex.** Scopes A4; closes the custody-lock blast-radius gap.
   (`docs/production-a8-h3-kp5-credential-isolation-design.md`.)
4. **A1 static-egress decision packet → Oren decision.** The hard external dependency; get it in front of Oren early.
   (`docs/production-a1-static-egress-ip-decision-packet.md`.)
5. **A4 mainnet-credentials architecture → Codex** (rides on A8-H3). (`docs/production-a4-mainnet-credentials-architecture.md`.)
6. *(Stretch)* **Live-tier fail-closed runbook** design; **TradingView prod alert runbook** design.

## 2. What can be done WITHOUT Oren (Claude, now)
- Author/refine all the packets above (A2 reconcile, A8-H3, A4, A1 decision, live-tier runbook, TradingView runbook,
  monitoring checklist, `credential_*` cleanup) — design/authoring only.
- Read-only read-backs (migration tracking format, shared-credential discovery, current state) on request.
- LOCAL-only test fixtures for any reconcile/isolation SQL (no linked apply).

## 3. What blocks on OREN
- Running the A2 reconcile inserts (surgical, reviewed).
- The A1 static-IP / provider decision.
- Mainnet account + trade-only keys + IP allowlist (A4).
- Doppler/Railway prod secret entry + rotating remaining exposed secrets.
- TradingView alert creation.
- **A11 written approval (with caps).**
- Any deploy / flag change / real-money arming.

## 4. What blocks on PROVIDERS
- Railway static egress availability (A1 Option A) — or provisioning a proxy/NAT (B) / migration host (C).
- Binance mainnet key creation + IP allowlist.
- TradingView paid tier for webhook alerts.
- Any custody/wallet provider decisions.

## 5. What needs CODEX REVIEW (before any implementation)
- The A2 reconcile SQL + per-object verify evidence.
- A8-H3 isolation migration + worker fail-closed change.
- A4 schema/worker/runbook changes.
- Live-tier fail-closed code + proof runbook.
- The `credential_*` redaction change.
- Any TradingView/token-handling or secret-topology change.

## 6. What would make real funds STILL NO-GO (after the 48h)
Even with all four+ packets reviewed, real funds stay NO-GO because these remain open: **A1 static IP not provisioned ·
mainnet keys not created/allowlisted · A4/A8-H3 not built+validated · live-tier fail-closed not proven · A2 reconcile
not run · A11 (capped) not granted · TradingView live alert not set · remaining exposed secrets not rotated.** The 48h
produces **reviewed plans**, not a live system.

## 6a. TOMORROW-MORNING REVIEW ORDER (read/decide in this order)
| # | Packet | What Oren/Codex should DECIDE | Expected output of review | Implementation immediately after PASS? |
|---|---|---|---|---|
| 1 | **A2 reconcile** (`production-a2-migration-reconcile-010-020-packet.md`) | approve Option B; approve the per-migration verify matrix; PITR confirmed | approved reconcile approach + a scheduled reviewed `INSERT` run | **YES** — the ONE candidate that can move to implementation immediately after Codex PASS + Oren go (metadata inserts, operator-run) |
| 2 | **A8-H3 / KP5** (`production-a8-h3-kp5-credential-isolation-design.md`) | approve the isolation invariant (≤1 active credential per user/bot/env); disable-first KP5 | approved isolation model → scopes A4; a build sequence | **NO** — design PASS only; build is a subsequent gated slice (migration + worker + tests) |
| 3 | **A1 decision** (`production-a1-static-egress-ip-decision-packet.md`) | **the provider question:** does Railway offer static egress? if not, proxy/NAT vs migrate | a chosen egress path (A/B/C) or an action to verify with the provider | **NO** — provider/Oren action; no code. Gates A4 mainnet keys |
| 4 | **A4 architecture** (`production-a4-mainnet-credentials-architecture.md`) | approve per-bot key model + trade-only/no-withdrawal + Vault custody split | approved architecture; Oren key-provisioning checklist queued | **NO** — design PASS only; build rides on A8-H3; keys are Oren/external |
| 5 | **48h plan** (this doc) | confirm the order + that only A2 may implement now; confirm A11 caps to pre-agree | agreed sequencing + pre-agreed A11 caps for an eventual Stage-3 run | **N/A** — it's the plan itself |
| 6 | **credential cleanup** (`ops-harness-credential-redaction-cleanup-plan.md`) | approve the exact-key redaction change | approved small change | **YES (optional)** — safe quick win; may implement after Codex PASS (frontend-only, no infra) |

**Net:** after tomorrow's review, the only items that can *become implementation* (Codex PASS + Oren go) are **A2
reconcile** and **(optionally) the credential cleanup** — both real-funds-safe. A8-H3/A4/A1 exit review as **approved
designs/decisions**, not code. **Real funds remain NO-GO.**

## 7. Tomorrow-morning review checklist (for Oren + Codex)
- [ ] Read the 5–6 overnight packets (A2 reconcile · A8-H3 · A4 · A1 decision · 48h plan · [cleanup]).
- [ ] **A1 decision:** does Railway offer static egress on our plan? If not, choose proxy/NAT vs migrate.
- [ ] **A2:** approve the reconcile approach (Option B recommended) → schedule the reviewed inserts.
- [ ] **A8-H3 → A4:** approve the isolation model → sequence the credential-architecture build.
- [ ] Decide **which first implementation** to green-light (recommendation: A2 reconcile, then A8-H3).
- [ ] Confirm the **A11 caps** you'd want for an eventual Stage-3 tiny real-money run (per-order + daily notional, one
      bot, kill authority) — so it's pre-agreed.
- [ ] Confirm **no mutations/deploys/secrets/mainnet** happened overnight (they did not).

## 8. Recommended FIRST implementation after review
**A2 migration reconcile (Option B) — and ONLY after its packet gets Codex PASS + Oren approval.** It is the smallest,
reversible, highest-leverage unblock (metadata inserts, operator-run, real-funds-safe). Then **A8-H3 credential
isolation** (scopes A4), separately. **No implementation begins without the packet's Codex PASS.** No provider/secret/
mainnet action in the 48h unless explicitly Oren-approved. **Real funds remain NO-GO** throughout.
