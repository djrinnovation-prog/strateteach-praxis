# Sprint 4 — Plan (DRAFT for review)

**Theme:** prove the pipeline is **reliable at volume + recoverable + observable** on testnet,
and lay the production-readiness base. **Testnet only — not LIVE.**

## Assumptions
- Testnet throughout; **no LIVE/mainnet trading** in Sprint 4.
- Operator owns all arm/fire, Doppler, Railway, secrets, pushes; gated review discipline
  continues (runbook → checklist → gated execute → evidence → canon).
- Worker is single-threaded poll `qty=1` (concurrency = queue contention, not parallel
  processing) — relevant to S4-5.
- Sentry (or equivalent) is the alerting sink (canon: DLQ "Sentry fires on INSERT").
- Egress: Railway region fix cleared testnet 451; **production-grade egress still unproven**
  (shared IP; mainnet Binance policy unknown — Register `380d6df6`).
- Each workbatch closes on **E1 (runtime) / E2 (platform)** evidence.

## Effort scale (rough — calibrate to velocity)
S ≈ ≤1 day · M ≈ 2–4 days · L ≈ ≥1 week.

## Definition of Done
Sprint 4 closes when the **MUST spine** (S4-0 → S4-1 → S4-3a → S4-2 → S4-8) is proven on
E1/E2. SHOULD/COULD are upside; anything unfinished is **carried forward, not silently
dropped**. If S4-3a or S4-2 recovery work expands beyond a tight scope, **close Sprint 4 as
partial or split** — do not shrink campaign evidence.

---

## MUST — Sprint 4 core spine

### S4-0 — Baseline freeze · S
- **Objective:** pin the start point. Record code SHA (`origin/main`), live Railway deploy id,
  migration state, non-secret Doppler snapshot, test count.
  **Migration 010 history:** *assess and document migration 010 history state; reconcile only
  if a `migration list` / `db push` pre-check proves it safe. Otherwise record a written
  exception.* (Do not imply `db push` is mandatory or safe by default.)
- **Evidence:** documented baseline; migration-history state assessed + documented (reconciled
  or written exception); queue 0, no stuck trades; tests green + count.
- **Risks/stop:** history mismatch → document, never force-push migrations. Stop if DB baseline
  not clean.

### S4-1 — Alerting Phase 1 (minimal) · M
- **Objective:** make the campaign's failure signals **observable**, not just logged: DLQ insert
  · `queue_failed` · stuck `pending`/`unknown` · worker-not-running.
- **Evidence (E1):** induce each → a real alert fires; happy path → no alert (no noise).
- **Risks/stop:** scope creep (dashboards = S4-7). Stop if alerts unreliable — the campaign
  can't claim "zero silent failures" without this.

### S4-3a — fetchOrder / reconciliation resolution (campaign-required subset) · M–L
- **Objective:** prove **unknown → filled/failed** resolution via `fetchOrder` — the minimum the
  50-trade gate's "3 reconciled unknowns" needs. Inline resolution on createOrder timeout
  (Step 8b) **and** a stuck `unknown` resolved out of band (boot path is the retained mechanism).
- **Evidence (E1):** induced `unknown` → resolved to terminal via `fetchOrder`, **no blind
  re-order**, idempotent (no double `fetchOrder`, no duplicate exchange order); reconciliation_job
  lifecycle observed end to end.
- **Risks/stop:** new worker code; idempotency vs the deferred Step 0b path (canon decision).
  Stop on any blind/duplicate order or silent drop.
- **Scope guard:** resolution path only. The runtime `setInterval(60s)` scan and the exhaustive
  failure matrix are **S4-3b (SHOULD / carry)** — do not balloon the MUST.

### S4-2 — 50-trade testnet campaign · L
- **Objective:** the Architecture §8 gate on testnet: **50 fills · 5 symbols · 3 reconciled
  unknowns · 1 recovered bot-error · zero silent failures.**
- **Scope guard:** *if inducing 3 reconciled unknowns or a recovered bot-error proves
  unsafe/too broad, split into **Phase A** (happy-path 50-fill volume) and **Phase B** (recovery
  campaign); do not call Sprint 4 fully closed until the recovery evidence is either completed or
  explicitly split/renamed.*
- **Evidence (E1/E2):** 50 `filled` across 5 symbols; 3 `unknown` reconciled to terminal (via
  S4-3a); 1 bot-error path recovered; DLQ/recon fully accounted; **zero silent failures** (via
  S4-1); no duplicate signal/exchange order across all 50.
- **Risks/stop:** real testnet volume (rate limits, balances); needs 5 symbol-bots + credentials.
  **Hard deps: S4-1 + S4-3a.** Stop on any duplicate, silent drop, blind order, or egress regression.

### S4-8 — Sprint 4 closure review · S
- **Objective:** close with evidence summary, carried-forward list, and an explicit
  **LIVE-readiness assessment** (what still blocks mainnet).
- **Evidence:** all MUST closed on E1/E2; tests green + count; canon + Notion updated; closure
  doc written (like `sprint3-closure-review.md`).
- **Risks/stop:** don't round up — partial MUST → close "partial" with the gap named.

---

## SHOULD — high-value, not DoD-blocking

### S4-0.5 — Ops Evidence Reporter / Console Lite (Phase 0) · **Strong SHOULD / do-early** · S–M
*(Parallel with S4-1, after S4-0. NOT a DoD blocker, NOT MUST. Phase 0 of the ops-console
roadmap; the Phase 1 dashboard stays at S4-7.)*
- **Objective:** cut manual relay during Sprint-4 campaigns — input a **RUN_ID** → emit a
  **PASS/FAIL evidence report** against runbook criteria, correlating an exported Railway log
  file + operator-provided read-only SQL output files. **Offline only (Option 1): NO DB
  connection, NO `--run-sql`, no secrets, no mutations, no arm/fire, no worker-runtime imports.**
- **Covers:** webhook accepted/rejected · `queue_length` · trade count/status · `exchange_order_id`
  presence · audit chain · `read_ct` + `processing_duration_ms` (if logs provided) · DLQ/recon
  counts · duplicate checks (distinct `signal_id`/`exchange_order_id`) · disarm state (if logs).
- **Inputs:** RUN_ID · Railway log export (JSON lines) · operator-pasted/exported SQL result
  files. A parse-miss must **fail loud** ("could not verify"), never silently PASS.
- **Output:** terminal or Markdown report. No frontend, no live tail, no HTTP server.
- **Evidence (to close):** reporter reproduces a known run's PASS/FAIL (e.g. a WB9 RUN_ID) from
  captured logs + SQL outputs, matching the manual verdict; unit tests against fixture
  logs/outputs; criteria presets reviewed like any diff.
- **Files (isolated from worker runtime):** new `worker/tools/ops-reporter/**` (CLI · log parser
  · read-only SQL templates · criteria presets · MD/terminal renderer) + tests; `worker/package.json`
  `ops-report` script. **No new deps · no `worker/src/**` change.**
- **Effort:** S–M (~1.5–2 days incl. tests).
- **Risks/stop:** parser brittleness (mitigate: fixtures + fail-loud); false-PASS from a
  mis-encoded rule (mitigate: it **augments** — human/Codex still reviews; print raw evidence
  beside each verdict). Stop scope creep at Phase 0 — opt-in read-only `--run-sql` (Option 2) and
  the live dashboard (S4-7) are explicitly later.

### S4-6a — Token rotation + IP allowlist + regression proof · M
*(Prerequisite for S4-4. NOT full Migration 009.)*
- **Objective:** rotate the (E1-burned) webhook token; add the TradingView **IP allowlist** +
  a regression proof that the happy path still works.
- **Evidence (E1):** non-allowlisted IP rejected; allowlisted happy path still `accepted` → fill;
  old token rejected, new token works.
- **Risks/stop:** allowlist mis-derivation → lockout; rotation coordination (operator secret).
  Stop if any legitimate path breaks.

### S4-4 — Real TradingView connectivity · M
*(After S4-6a.)*
- **Objective:** replace the simulator with a **real TradingView alert** → live Edge webhook →
  downstream fill. Closes the "real TradingView not proven" carried-forward item.
- **Evidence (E1):** genuine TradingView alert → `webhook_logs accepted` + downstream testnet fill.
- **Risks/stop:** must follow S4-6a (token-in-path exposure); payload-shape vs frozen WB1
  contract. Stop if real payload ≠ contract (needs a decision, not a silent fix).

### S4-5 — True 5-bot / multi-bot load · M
- **Objective:** the carried-forward **WB7 true 5-bot concurrent load** (vs the single-bot proxy);
  confirm `read_ct` stays 1 and VT holds under real concurrency; revisit `batch_size`; record P99.
- **Evidence (E1):** 5 concurrent bots; zero duplicate; `read_ct {"1":N}`; VT headroom holds;
  P99 recorded.
- **Risks/stop:** provisioning 5 bots+creds; single-threaded poll stresses queue contention/VT
  (may surface a finding). Stop on any duplicate or `read_ct>1`.

### S4-3b — Runtime reconciliation scan + full failure matrix · M–L *(SHOULD / carry)*
- **Objective:** the runtime `setInterval(60s)` scan + the remaining Sprint-3 failure-matrix
  scenarios (vault-down, exchange-timeout breadth, zero-balance/sub-min fail-loud, DLQ-on-terminal)
  beyond the campaign-required subset.
- **Evidence (E1):** scan resolves a stuck trade without a reboot; each failure mode fails **closed**.
- **Risks/stop:** new always-on timer code; coordinate with S4-3a to avoid double `fetchOrder`.
  **Carry forward to Live-readiness if it doesn't fit Sprint 4.**

---

## COULD — drop first if the sprint runs long

### S4-7 — Read-only ops console (Phase 1 dashboard) · M
- **Objective:** ops-console **Phase 1** — a **read-only live dashboard** of worker/queue/trade
  state. (Phase 0 evidence reporter is now **S4-0.5**.) Accelerates live monitoring during campaigns.
- **Evidence:** console shows live state via a **read-only DB role** — no mutations, no secrets,
  no live TradingView.
- **Risks/stop:** scope creep into Phase 2 (assisted ops) — read-only slice only.

### Full Migration 009 — security hardening · L *(COULD this sprint; MUST-for-Live)*
- **Objective:** apply full 009 (Edge/`service_role` separation via `praxis_edge`, etc.) as its
  **own gated review/apply track**. **Remains frozen** until that plan; **not** a testnet-
  reliability blocker.
- **Evidence:** 009 applied + grants verified (E2); `praxis_edge` path E1-clean (no `42501`);
  `supabase_admin`-owned-tables regression check.
- **Risks/stop:** broad privilege change, high regression risk (the WB8 `42501` class). Caveats:
  `praxis_edge` not harmless; derive allowlist from all DB ops + failure paths. **If review
  bandwidth is short → carry forward as MUST-for-Live.**

---

## Recommended execution order
1. **S4-0** baseline (+ 010 history assessment)
2. **S4-1** alerting minimal · **S4-0.5** ops evidence reporter (parallel, do-early)
3. **S4-3a** fetchOrder/reconciliation resolution
4. **S4-2** 50-trade campaign → **MUST spine complete**
5. **S4-6a** token rotation + allowlist → **S4-4** real TradingView
6. **S4-5** multi-bot load · **S4-3b** runtime scan / failure matrix
7. **S4-7** read-only ops console (Phase 1 dashboard, later) · **full 009** as a separate gated track
8. **S4-8** closure review

## Explicitly OUT OF SCOPE (Sprint 4) / remaining LIVE blockers
- **LIVE/mainnet trading · real money.**
- **Production-grade egress** if unsolved — allowlist-grade static IP + verified mainnet Binance
  IP policy (Register `380d6df6`).
- **Full frontend MVP** (Sprint 5) · **payments/billing** (Sprint 6).
- **Full Migration 009** if not done → carried forward as MUST-for-Live.
- queue_failed re-enqueue sweeper · configurable Bot-owned sizing (O1) · credential-owned
  environment · asset_breakdown freeze — Live-readiness bundle unless a workbatch pulls them in.

---
**Status:** DRAFT — planning only. No code/DB/Doppler/Railway change, no arm/fire, no commits
until approved. Persisting to Notion (Sprint 4 entry) is a separate gated step.
