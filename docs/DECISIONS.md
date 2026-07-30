# Praxis — Decisions (Git Decision Mirror)

> **Source of truth: Notion Decision Log** (`⚖️ Decision Log`, collection `84066d49-04b8-46c8-b6b2-69c795147c11`) · this file is **NON-AUTHORITATIVE**.
>
> This file is the **Git decision mirror** — a **hand-maintained**, durable record of decisions kept in Git for **disaster-recovery, offline reference, and review alongside the code**. It is **hand-updated incrementally** as decisions are made, and reconciled with Notion at gate close. (Earlier framing of this file as "generated, never hand-edited" is superseded: in practice it is the hand-maintained Git mirror; deterministic export automation remains a tracked nice-to-have.)
> - The **authoritative record is the Notion Decision Log**. If this file disagrees with Notion, **Notion wins**.
> - Reconcile with the live log at each **gate close** (Governance §7.5).
> - Per **Memory Architecture v2** (Decision Log, 2026-06-04): disaster recovery lives *outside* the LLM layer — this Git mirror, not a Claude Project file, is the decisions backup.
>
> **Entries:** 52 total — 46 ACTIVE, 6 SUPERSEDED.
> **Last updated:** 2026-07-01 (Sprint 5 / **Operator Console Slice 1 usable end-to-end** — frontend deployed on Railway (`praxis-operator-console-production.up.railway.app`, separate service, anon Publishable key only); Supabase Auth Site URL + redirects set; operator `djrinnovation@gmail.com` invited + **provisioned `is_operator=true`** (raw read-back `operators_total=1`); login works, `operator_status()` returns live data, non-operator denied 42501; console fresh + no DEGRADED + zero mutation controls; `enabled_bots=0`/`open_trades=0`/`dlq=0`/`open_recon=0`/`queue_length=0`, all 5 bots `trading_enabled=false`, `QUEUE_ENABLED=false`, `worker_state=disabled`, `is_production=false`; **execution disarmed**, no queue arm/fire/mainnet/real funds; design skin = later Slice 1d); 2026-06-30 (Sprint 5 / **Operator Console Slice 1 DB foundation applied** — migrations 015 `worker_status` + 016 `operator_status`/`is_operator`/guard APPLIED surgically + verified (verify script **ALL_7_CASES_PASS**, rolled back); NOT in `supabase_migrations`; `worker_status` live row fresh (`queue_enabled=false`/`is_production=false`/`worker_state=disabled`/`boot_stuck_count=0`); `operators_provisioned=0`; **UI NOT deployed**, no operator provisioned, no worker/Doppler/Railway change; execution disarmed; next blockers P8/P9/P11); 2026-06-30 (Sprint 5 / Praxis⇄StrateTeach **owner split** recorded — Praxis owns execution/risk/audit/credentials/orders, StrateTeach owns strategy/backtest/signal-ideas and must not hold keys/write DB/decide quantity/bypass risk; StrateTeach-owned readiness Qs **OPEN**, not assumed; next-block scope = readiness + Operator Console Slice 1 status-read; no connection/mainnet/arm); 2026-06-30 (Sprint 5 / controlled **testnet** smoke **EXECUTED — SMOKE PASS, re-disarmed**: one filled testnet order `requested=20`/`executed=19.89`, exactly-one, caps honored; Step-6 disarm anomaly caught via raw read-back + corrected; fully fail-closed; testnet only, no mainnet/real funds, A11 not granted); 2026-06-30 (Sprint 5 / Oren go/no-go — **chose A**: controlled **testnet** smoke approved after Phase 0 PASS; testnet only, NOT mainnet/real funds, A11 not granted; execution per the controlled smoke packet, operator-driven, immediate disarm); 2026-06-30 (Sprint 5 / production go-live GATED — real funds blocked until all MUST gaps closed + controlled testnet smoke PASS + Oren written approval; controlled smoke DEFERRED; go-live readiness package created, docs-only); 2026-06-30 (Sprint 5 / S5-A3/B4 — migration 014 APPLIED surgically + **5 bots CONFIG-READY** (fixed_notional 20 / max 25 / daily 100, sell off, **trading_enabled=false**, env=testnet; Step 5 E2 PASS); NOT in `supabase_migrations`; **no §6b enable, no queue enable, no arm**, `QUEUE_ENABLED=false`, Migration 009 frozen); 2026-06-29 (Sprint 5 / A6 incident-rotation protocol CLOSED — runbook + tabletop dry-run + Codex PASS + Oren accept; docs-only); 2026-06-29 (Sprint 4 / S4-2 50-fill testnet campaign RUNTIME PASS — 50 filled/5 symbols/50 distinct, 3 reconciled incl. filled-path → S4-3a CLOSED, bot-error recovered, `full_s4_2=GO`, worker disarmed); prior: 2026-06-25 (Sprint 4 / S4-1 operational activation CLOSED — dual E1 PASS, scheduler deferred); 2026-06-23 (Sprint 4 / S4-1 + S4-3a evidence canon); 2026-06-04 (Sprint 3 / WB1 ratification): +9 ratified entries (top of ACTIVE); 4 prior entries superseded in place (3 signal_id + the deferred message-format entry). _Incremental hand-update; deterministic export automation remains tracked (Live-Readiness / Sprint 2 Closure §4)._

---

## ACTIVE decisions

### Operator Console Slice 1 usable end-to-end (deployed + operator provisioned)
- **Date:** 2026-07-01 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** The read-only Operator Console is **live and usable end-to-end**. Frontend deployed as a **separate** Railway static service (build `npm run build` → `serve -s dist -l $PORT`; **anon Publishable key only**, no secrets) at `https://praxis-operator-console-production.up.railway.app`; Supabase Auth Site URL + redirect allowlist set (that URL + `http://localhost:5173`). Operator `djrinnovation@gmail.com` invited (auth user `2f0eb49b…`, email confirmed, profile auto-created by the `handle_new_user` trigger) and **provisioned `is_operator=true`** (privileged UPDATE, raw read-back: `operators_total=1`). Login works; `operator_status()` returns **live data**; a non-operator is correctly denied (**42501**, "Operator access required", no data). Console shows: `enabled_bots=0`, `open_trades=0`, `dlq=0`, `open_recon=0`, `queue_length=0`; all **5 bots** `active` / `trading_enabled=false` / testnet / `config_ready=true`; `worker_status` **fresh** (`queue_enabled=false`, `worker_state=disabled`, `is_production=false`) → **no DEGRADED**; **zero mutation controls** (only Sign out).
- **Alternatives:** Keep the console code-complete but undeployed — rejected (the goal was a usable read-only console to cut manual runtime operations).
- **Reason:** Read-only, operator-gated status path only. **No trading capability:** no queue arm, no fire, no mainnet, no real funds, no `trading_enabled` change; **execution remains disarmed** (`QUEUE_ENABLED=false`, all bots `trading_enabled=false`). Executed per the apply/deploy runbook §10 (R1→R5, operator-driven, gated, raw read-back per DB mutation). The design skin is a later gated presentational slice (**Slice 1d** — same data/auth/read-only/zero-mutation). A1/A2/A4/A5/A10/A11/A8 remain open; Migration 009 frozen.

### Operator Console Slice 1 DB foundation applied (015/016 verified; console not deployed)
- **Date:** 2026-06-30 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Migrations **015** (`worker_status`) + **016** (`operator_status()` + `profiles.is_operator` + guard trigger) **APPLIED surgically** to the live DB and verified by RAW read-back; the 016 verify script returned **ALL_7_CASES_PASS** (transaction rolled back — nothing persisted). **NOT** added to `supabase_migrations` (no `db push`). `worker_status` holds **one fresh row** (`queue_enabled=false`, `is_production=false`, `worker_state=disabled`, `boot_stuck_count=0`) → the live worker already runs the Slice 1a status writer. `operators_provisioned=0`. The read-only console **DB foundation is live**, but the **UI is still NOT deployed**, **no operator is provisioned**, and there was **no worker deploy/change, no Doppler/Railway change**. Next blockers (Steps 4–6): **P8** operator email · **P9** Supabase Auth site URL + redirect allowlist · **P11** frontend host.
- **Alternatives:** Defer the DB apply until a single full deploy bundle — rejected (gated DB-foundation-first reduces deploy-time risk and the read-only infra adds no trading capability).
- **Reason:** 015/016 are **read-only** console infrastructure — they do not enable trading, arm the queue, or change `trading_enabled`. Applying + verifying them now de-risks the later console deploy without increasing trading risk. Executed per the apply/deploy runbook (Steps 1–3 only, operator-approved); **execution remains disarmed** (`QUEUE_ENABLED=false`, all 5 bots `trading_enabled=false`); no queue arm / fire / mainnet / real funds; A11 not granted; Migration 009 frozen.

### Queue message is an event, not a command (DB owns policy)
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** The wire carries only the event (bot_id, signal_id, side). All execution authority — symbol, exchange, environment, sizing, risk, enable/disable — resolves server-side from persistent objects. Shapes WB1/WB5/WB6 and all future policy placement.
- **Alternatives:** Command-style payload (symbol/quantity/exchange/environment/price on the wire) — the common TradingView-tool convention. Rejected.
- **Reason:** A public, unsigned, repaint-prone, corruptible TradingView channel must not dictate real-money execution for a multi-tenant platform holding other users' exchange keys. Umbrella decision; the ownership hierarchy and wire/signal_id entries are corollaries.

### Trading-policy ownership hierarchy: Profile ⊇ Credential ⊇ Bot ⊇ Signal (fail-closed)
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Each policy has one authoritative owner. Execution resolves Signal → Bot → Credential → Profile; most-restrictive gate wins; a trade proceeds only if every gate is open. Map: symbol→Bot, exchange→Credential, environment→Credential(target), sizing→Bot, risk-limits→Profile+Bot, enable/disable→layered.
- **Alternatives:** Flat/bot-only ownership; signal-supplied policy. Rejected.
- **Reason:** Maps to the verified schema. Makes kill-switches + multi-tenancy enforceable; account caps cannot be bypassed by spinning up more bots.

### Queue Message Format v1.0 = {schema_version, bot_id, signal_id, side}
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Frozen Edge↔Worker contract (WB1). Resolves the deferred 'pgmq trade_signals message format' decision (Option A minimal + schema_version). symbol from bots.trading_pair; client_order_id + quantity worker-side; advisory data in webhook_logs.raw_payload, never on the queue.
- **Alternatives:** B) Full {bot_id, action, symbol, signal_id, client_order_id}; C) Hybrid +symbol. Both rejected.
- **Reason:** Matches the existing Worker assumption; minimal wire = smallest attack/validation surface; schema_version enables forward versioning.

### signal_id = source-supplied C-bar composite; reject-if-absent; no UUID fallback
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Level 2 for Sprint 3. TradingView alert supplies signal_id = ticker|interval|time|{{strategy.order.action}}. Praxis REJECTS if absent (no crypto.randomUUID fallback). Dedup via UNIQUE(bot_id, signal_id) + INSERT ON CONFLICT DO NOTHING. Dedup-skips → audit_logs (event_type=webhook_dedup_skip, distinct flag). Observability fields fire_time/close/volume: never executed, never on the queue. Optional future fire_id. Once-Per-Bar-Close mandated. RESIDUAL RISK: same bot+bar+action+truly-distinct-intent → identical signal_id → over-dedup; LOW in Sprint 3 (Once-Per-Bar-Close), observable (distinct=true). Level 3 escalation if observed / intrabar alerts / non-TV native IDs / live multi-same-side-per-bar.
- **Alternatives:** D4 server-derived SHA-256(bot_id|bar_time|side) — rejected. crypto.randomUUID() fallback — rejected (resend duplicates). Full Level 3 source fire_id — deferred (not available from vanilla TradingView).
- **Reason:** Realizes the entropy contract's payload.signal_id primary while fixing its UUID-fallback defect. Preserves the entropy contract's intent (no silent collision-drop) via mechanism (reject-if-absent + audit_logs skips + Once-Per-Bar-Close), not high-entropy randomness. C-bar is resend-stable (bar-bound). Supersedes the three prior signal_id entries.

### Webhook identity & auth transport: bot_id + secret in URL path
- **Date:** 2026-06-04 · **Category:** Security · **Status:** ACTIVE
- **Impact:** POST /functions/v1/webhook/{bot_id}/{secret}. HMAC-SHA256(secret) constant-time vs bots.webhook_secret_hash. HTTPS at the edge. IP allowlist = defense-in-depth (deferred [LIVE-BLOCKER]). Full webhook URL never logged.
- **Alternatives:** Secret in body — rejected (raw_payload persisted + assumed secret-free; corruptible). Custom header — impossible. Body-passphrase only — rejected.
- **Reason:** Identity + secret travel off the corruptible body and out of persisted raw_payload. Specifies TRANSPORT for the already-ratified HMAC-SHA256 decision (does not change the hash algorithm).

### Sprint 3 sizing = implicit server-side; configurable Bot-owned sizing deferred [LIVE-BLOCKER]
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Sizing ownership = Bot. Sprint 3 uses implicit sizing (BUY ≈ min-safe-notional; SELL = full balance), off the wire. Configurable Bot-owned sizing is a [LIVE-BLOCKER], due before the Live Gate (Sprint 6).
- **Alternatives:** Option A (add sizing column now) — deferred. Wire-controlled sizing — rejected. %-balance/modes — future.
- **Reason:** O1 does not touch the wire; implicit sizing already filled a testnet order. Fastest safe Sprint 3; avoids rushing the sizing model. (O1 resolution.)

### Environment authority = Exchange Credential (target); deployment-global PRAXIS_IS_PRODUCTION (current)
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Environment never on the wire. Today: global PRAXIS_IS_PRODUCTION → setSandboxMode. Target: credential-owned (testnet/live = distinct credentials). Exit condition: migrate before a deployment serves both environments OR live is enabled — whichever first. [LIVE-BLOCKER for mixed/live].
- **Alternatives:** Per-bot DB flag; on-the-wire; deployment-global permanent. Rejected.
- **Reason:** Credential-owned makes testnet/live mismatch structurally impossible. Deployment-global valid only while single-environment (true today).

### Edge ingestion response: hybrid 200/5xx; Praxis owns retries via pgmq
- **Date:** 2026-06-04 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** 200 for all business outcomes (incl. reject, dedup); 5xx ONLY for infra failure before the webhook_logs insert (TradingView retry recovers). queue_failed recorded; re-enqueue sweeper + ingestion-5xx alerting deferred [LIVE-BLOCKER]; logging retained in Sprint 3.
- **Alternatives:** Pure always-200 — rejected (silent loss). Always-buffer — useless when buffer down. Rely on TradingView retries — too narrow.
- **Reason:** Restores retry on the one recoverable case without leaking structure (generic 500 reveals nothing). Closes the silent-ingestion-loss gap (failure-model audit).

### v1 single signal source = TradingView (explicit scoping)
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** v1 supports only TradingView. Coupling contained at the Edge signal_id derivation; webhook_logs has no source field yet. Future sources need a source field + source-aware signal_id, and may supply a native fire_id.
- **Alternatives:** Multi-source now — over-scope. Leave implicit — silent lock-in. Rejected.
- **Reason:** Explicit scoping with a named extension seam. signal_id documented as a source-supplied 'intent key' so future sources plug in without changing WB1 or the schema.

### Claude Project memory is not part of the disaster-recovery strategy
- **Date:** 2026-06-04 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** DR for canonical Notion content moves OUT of the LLM layer to scheduled exports/backups (Git preferred; Drive/external acceptable) — generated, date-stamped, non-authoritative. Claude Project knowledge is reduced to ONE Bootstrap pointer (CLAUDE_BOOT_CONTEXT v2.0.0, slim). Removed from Project context: DECISIONS.md, CURRENT_STATE.md, PRAXIS_RUNTIME_CONTEXT.md, LAST_SYNC.md. Notion remains the sole source of truth.
- **Alternatives:** (a) Keep DECISIONS.md as an in-Project Notion fallback — rejected: a stale auto-injected file is silently trusted, violating §0 "Truth ≠ Freshness". (b) Make Git the Project's fallback layer — rejected: DR should not live in the LLM layer at all. (c) Keep the stale Hot Memory twins attached "just in case" — rejected: they inject false runtime facts into every session (active harm).
- **Reason:** A permanent Project file is justified only by the "always-present-without-fetch" property, which serves exactly two needs: Bootstrap or Disaster Recovery. Bootstrap is owned by CLAUDE_BOOT_CONTEXT (its position outside the system is irreplaceable). With DR now an infrastructure concern outside the LLM layer, no other Project file retains a unique function. Git is the correct DR home: Tier-1, version-controlled, diffable, co-located with the code decisions govern, and safe-on-read.

### Governance Model v1.0 §8 — Evidence Quality Framework adopted (E1–E4 + gate-closure rule)
- **Date:** 2026-06-03 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Stage gates (Governance §2) may now only be closed using E1 (Runtime) or E2 (Platform) evidence. E3 (Static) supports claims but cannot close gates. E4 (Inference) may never close a gate. Evidence must be CITED (command + output + date), not asserted. Applies retroactively: Sprint 2 closure rests on E2 (`supabase migration list`) + E1 (Railway runtime logs).
- **Alternatives:** (a) Keep informal "verified" claims — rejected: caused the 005 stale-claim error. (b) Reuse the existing Tier 1–4 Authority labels for evidence — rejected: collides with document-authority tiers. Chosen: a separate E1–E4 axis labeled distinctly.
- **Reason:** Stage-gate closures were being made on mixed-strength evidence (e.g. a stale "migration 005 not applied" claim that contradicted a live check). We needed an explicit hierarchy of proof strength so closures cite verifiable platform/runtime evidence rather than inference. Complements — does not replace — the Authority Tiers.

### Governance Model v1.0 ratified — documentation authority, stage-gate workflow & lifecycle
- **Date:** 2026-06-03 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Archived CURRENT_STATE, PRAXIS_RUNTIME_CONTEXT, LAST_SYNC (banners). Retired Sprints & Tasks DB. Corrected CLAUDE_BOOT_CONTEXT (v2.0.0). Repaired/stamped Setup Guide (1.1.0), Database Schema (1.4.0), Architecture (1.6.0), Findings Register (1.1.0). Boot now reads Current Status → Decision Log (Active) → Open Incidents → Sprint Overview → targeted docs. Findings Register scoped to code findings only; runtime findings → Incidents.
- **Alternatives:** (a) Keep N overlapping state docs + chase real-time sync — rejected: guarantees drift. (b) Delete the Hot Memory snapshots outright — rejected: lose historical record; Archive-with-banner chosen. (c) Repurpose Sprints & Tasks DB as a live board — rejected: it is the dead forcing-function; retired.
- **Reason:** Root cause of doc drift was too many sources of truth + no forcing function. v1.0 establishes: "the artifact closest to the work wins" (Tier-1 = Git/Supabase/Railway/Doppler/logs); a 6-criteria stage-gate (not Scrum); a doc lifecycle with Last Verified stamps; corrected boot order; an Ownership Model; and a day-to-day Operating Protocol (§7).

### Disabled Worker stays alive (ref'd heartbeat), not clean exit
- **Date:** 2026-06-03 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** Disabled Worker now stays Active and exits cleanly on SIGTERM/SIGINT. Commit db26445. Negligible idle cost in Sprint 2.
- **Alternatives:** Clean exit (exit 0 after boot reconciliation) — rejected: "Completed" is an ambiguous health signal and does not validate the always-on Railway model; production topology is a persistent poll loop anyway.
- **Reason:** QUEUE_ENABLED=false must keep the Railway container Active, not exit. First implementation awaited a never-resolving Promise — but a pending Promise + signal listener does NOT keep Node's event loop alive, so the process exited 0 and Railway showed "Completed". Fixed with a no-op ref'd setInterval that holds the loop open, cleared on shutdown. Verified empirically.

### QUEUE_ENABLED default false until queue RPC exists
- **Date:** 2026-06-03 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** Sprint 2 Railway deploy runs idle: validateEnv + boot reconciliation (the 42501 canary for migration 006) + worker_queue_disabled once, no poll loop. Sprint 3 sets QUEUE_ENABLED=true after the pgmq wrapper migration lands. Commit 37c8c70 on main; 97/97 worker tests pass; tsc clean.
- **Alternatives:** (a) Leave the loop running and tolerate PGRST202 spam — rejected: noisy, hides real alerts. (b) exit(0) when disabled — rejected: Railway shows the container stopped. (c) Make QUEUE_ENABLED required — rejected: safe state (false) is the default; strict 'true'/'false' parse only if the var is present.
- **Reason:** pgmq_read/pgmq_delete RPC wrappers do not exist until Sprint 3. The unconditional poll loop logged queue_read_error (PGRST202) every interval — an unhealthy container masquerading as running. Gating the loop behind QUEUE_ENABLED lets the Worker deploy and idle cleanly; QUEUE_ENABLED=true adds a non-destructive preflight that fails fast if the RPC is missing.

### signal_id entropy contract: UUID v4 or ≥122 bits, never timestamp-derived  *(SUPERSEDED 2026-06-04)*
- **Date:** 2026-06-02 · **Category:** Architecture · **Status:** SUPERSEDED
- **Superseded by:** "signal_id = source-supplied C-bar composite; reject-if-absent; no UUID fallback" (2026-06-04). Intent (no silent collision-drop) PRESERVED via reject-if-absent + audit_logs dedup-skips + Once-Per-Bar-Close, not high-entropy randomness.
- **Impact:** Edge Function must generate UUID v4 or use a TradingView-supplied payload ID with sufficient entropy. Timestamp-derived IDs must never be used as signal_id. UNIQUE(bot_id, signal_id) is the system's idempotency key — low-entropy IDs create collision risk causing silent signal drops (second signal treated as duplicate, ack=true, no error logged).
- **Alternatives:** Composite idempotency key (bot_id + timestamp + sequence) — rejected: timestamp collisions possible within the same ms under concurrent signals. Single high-entropy UUID v4 is simpler, correct, and aligns with the TradingView webhook payload format.
- **Reason:** ENG-006 (2026-06-02): signal_id entropy requirements were confirmed in design but undocumented. Any future Edge Function using a timestamp or sequential counter would cause idempotency collisions — two distinct signals treated as duplicates under concurrent load. The collision is silent.

### processMessage Step 10 transient path: inline fetchOrder before marking unknown (Option B)
- **Date:** 2026-06-02 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** createOrder timeout/unavailable → fetchOrder(clientOrderId) once immediately. Outcomes: (A) order found → update trade, ack=true, no recon job; (B) OrderNotFound → trade:failed, ack=true, no DLQ, no failures++; (C) fetchOrder also fails → trade:unknown, reconciliation_job created immediately, ack=true, bot blocked via Step 3.5 until resolved. Unknown state only when both createOrder AND fetchOrder fail. Unblock: Worker restart (boot reconciliation) or Sprint 3 setInterval.
- **Alternatives:** Option A — defer blocking to Sprint 3: bot stays blocked (ack=false) until Sprint 3 setInterval resolves unknown trades. Rejected by CTO (2026-06-02): leaves bot blocked indefinitely with no unblock mechanism; ack=false also does not retry correctly (ENG-010).
- **Reason:** ENG-004: blocking a bot in Sprint 2 without an automatic unblock mechanism is unacceptable. Unknown trades are the highest-risk state (double-exposure on next signal). Inline fetchOrder resolves most transient failures immediately, reducing unknown state to network-outage-only scenarios.

### 🔖 Trade quantity calculation — minimum safe (Sprint 2 placeholder) vs configurable position_size_pct (DEFERRED Sprint 3/4)
- **Date:** 2026-06-01 · **Category:** Architecture · **Status:** ACTIVE (DEFERRED Sprint 3/4)
- **Impact:** DEFERRED. Owner: CTO + Product. Trigger to reopen: before Sprint 4 (50 testnet trades) planning — decide whether minimum safe quantity is acceptable for the 50-trade gate, or real position sizing is required. Sprint 2 math (minimum safe): BUY ceil((5×1.5)/100,000/0.00001)×0.00001 = 0.00008 BTC ≈ $8; SELL floor(free_balance×0.95/stepSize)×stepSize (0.95 is placeholder). position_size_pct option requires migration + UI field + Worker recalculation. Future option: TradingView Pine `{{strategy.position_size}}` in payload.
- **Alternatives:** A) Minimum safe quantity (current Sprint 2 code) — no migration, validates pipeline only. B) position_size_pct in bots table — Sprint 3 migration + UI + Worker update. C) Quantity from TradingView payload via pgmq message — most flexible, Sprint 4+.
- **Reason:** Sprint 2 Worker uses hardcoded minimum safe quantity, proven on Binance Testnet (9/9 PASS, 0.00008 BTC filled). Real users need configurable sizing; bots table has no sizing field. Cannot build in Sprint 2.

### 🔖 WB8 boot reconciliation exercised — RESOLVED (2026-06-17)
- **Date:** 2026-06-17 · **Category:** Infrastructure · **Status:** RESOLVED / complete — boot reconciliation proven (detection + reconciliation_job creation + idempotency). Required migration 010. `QUEUE_ENABLED=false` throughout; no arm/fire; no real orders.
- **Method (RUN_ID `WB8R-20260617-1249`):** two synthetic stuck trades seeded (one `pending`, one `unknown`, backdated >60s, real bot/user FK, `exchange_order_id` null), worker restarted with the queue DISABLED so `runBootReconciliation` runs without consuming the queue. Reversible seed; cleaned up after (below).
- **Detection (E1):** `boot_reconciliation_complete stuck_count:2`.
- **Initial failure (E1/E2 — first boot, deploy `6514786f`):** `reconciliation_job_upsert_error error:42501` ×2 (pending + unknown); DB `recon_jobs=0`. Boot reconciliation detected the stuck trades but could not create the hand-off jobs.
- **Root cause:** `service_role` lacked `SELECT` on `reconciliation_jobs` (`006_worker_grants` granted INSERT/UPDATE only); the worker's PostgREST insert/upsert path also needs SELECT (RETURNING in the source CTE). `trades_dlq` carried the same latent INSERT-only gap (never exercised — no WB7 trade reached the DLQ).
- **Fix:** migration 010 (commit `9b6be0e`) — `GRANT SELECT ON public.reconciliation_jobs TO service_role;` and `... ON public.trades_dlq ...`.
- **Apply note:** 010 was applied **surgically via direct SQL** (idempotent grants), **not** via migration-history-tracked `db push`; the committed file `supabase/migrations/010_reconciliation_dlq_select_grant.sql` is the record. Live verification: `service_role` `has_select=true` on both tables.
- **Post-fix evidence (E1/E2 — deploy `862dfb08`):** `reconciliation_job_created` for both seeds (pending trade `b994a9aa-be5a-41a0-b225-e5e4444dd78b`, unknown trade `72124d42-671b-421d-a746-411dba0429df`); DB `recon_jobs=2`; no `42501`.
- **Idempotency evidence (E2 — second reboot, deploy `2ec7f8d1`):** DB `recon_jobs` stayed **2**, one job per seed, `distinct_trade_id=2`, `distinct_recon_id=2` — no duplicates (upsert `onConflict:trade_id, ignoreDuplicates` + `reconciliation_trade_unique`). Repeated `reconciliation_job_created` log lines were expected no-op upserts; DB count is authoritative.
- **Hand-off-only:** seeds never mutated across all boots (`exchange_order_id`/`filled_at` null), `dlq=0` — boot reconciliation only creates the job, never touches the exchange.
- **Cleanup evidence (E2 — transactional):** `run_trades=0`, `run_recon=0`, `dlq=0`, `global_stuck_eligible=0`. Seeds + jobs removed; namespace and global stuck-eligible back to 0.
- **Caveat — NOT fetchOrder resolution:** WB8 proves boot **detection + reconciliation_job creation + idempotency** only. It does **NOT** prove resolution of an `unknown` trade via `fetchOrder` (unknown → filled/failed), nor the runtime `setInterval(60s)` scan — both deferred/carried forward (see the two reconciliation entries below).
- **Migration 009 remains frozen** (unrelated security-hardening draft); 010 is independent of it.

### 🔖 WB9 E2E dev proof — RESOLVED / PASS (2026-06-17)
- **Date:** 2026-06-17 · **Category:** Infrastructure · **Status:** RESOLVED / PASS — full pipeline observed end-to-end from Railway (single controlled testnet fire). `QUEUE_ENABLED` armed → disarmed; no production, no LIVE.
- **Method (RUN_ID `WB9R-20260617-1631-railway`, signal_id `WB9R-20260617-1631-railway-buy`):** one fire via the webhook simulator (`scripts/wb6-e1-fire.sh`) → `webhook → Edge → pgmq → Railway worker → Binance Testnet fill → trades + audit → ack`. Fire result: **HTTP 200, CURL_EXIT=0**.
- **Worker log evidence (E1):** `message_received msg_id=26 read_ct=1` → `trade_pending trade_id=d59f68a0-8511-4625-9b2b-8d2fd44f7359` → `trade_executed status=filled exchange_order_id=5927166` → `message_processed ack=true read_ct=1 processing_duration_ms=1957` → `message_acked msg_id=26`.
- **DB evidence (E2, read-only):** `webhook_logs` accepted=1 (no rejected/queue_failed); exactly **1 trade**, `status=filled`, `exchange_order_id=5927166`, `filled_at` set; audit chain `trade.created → trade.filled` (`actor_type=worker`); `queue_length=0`; `dlq=0`; `recon=0`; `distinct_signal_id=1` and `distinct_exchange_order_id=1` (no duplicate signal or exchange order).
- **Disarm evidence (E1):** deployment `88d8597e` — `queue_enabled:false`, `is_production:false`, `doppler_environment:dev`, `worker_queue_disabled`, `boot_reconciliation_complete stuck_count:0`.
- **Caveats:** webhook **simulator, NOT real TradingView connectivity** (live alert integration is a separate, out-of-scope step); **testnet only**, not live/mainnet; **single E2E proof**, not the 50-trade production campaign; carried-forward items unchanged — WB7 true 5-bot concurrent load · WB8 `fetchOrder` resolution (unknown → filled/failed) · runtime `setInterval(60s)` reconciliation scan · production-grade egress (LIVE blocker, Register `380d6df6`); **Migration 009 frozen**.
- **Note:** the WB9 trade (`d59f68a0…`, exchange order `5927166`) is a **real testnet fill retained as evidence** — no DB cleanup performed.

### 🔖 Sprint 4 — S4-1 alert read-only role + migration-history exception + S4-3a resolver/E1 (2026-06-23)
- **Date:** 2026-06-23 · **Category:** Infrastructure / Security · **Status:** S4-1 read-only role RESOLVED (applied + verified); S4-3a resolver RESOLVED-PARTIAL (failed-path E1 PASS, filled-path deferred to S4-2); migration-history exception DOCUMENTED. `QUEUE_ENABLED=false` throughout; no arm/fire; **Migration 009 frozen**.
- **S4-1 alert read-only role (`praxis_alert_ro`):** migration `011_alert_readonly_role` (commit `cff68a5`) creates a SELECT-only role for the external alert poller. Applied **surgically via direct SQL** (`supabase db query --linked --file …`), **not** `db push`. Catalog verification passed (LOGIN, NOBYPASSRLS, no membership, column-level SELECT, `alert_ro_*` policies scoped to the role). **As-role verification was initially BLOCKED** — `ERROR: permission denied for table bots` querying `webhook_logs` as `praxis_alert_ro`: the pre-existing PUBLIC SELECT policies (`webhook_logs_select`, `trades_dlq_select`) reference other tables (`bots`/`trades`) in subqueries and, being `roles={public}`, also applied to the new role (permissive policies OR-combine and are all evaluated). **Fix: migration `012_scope_user_select_policies_to_authenticated`** (commit `8d7de7d`) scopes the three end-user SELECT policies PUBLIC→`authenticated` (no new access; fail-loud if a target policy is missing); applied surgically. **Full `praxis_alert_ro` as-role verification then PASSED:** intended SELECTs work (`webhook_logs` queue_failed n=1); write-negatives → `42501`; column overreach (`exchange_order_id`/`raw_payload`/`failure_reason`) → `42501`; table overreach (`bots`, `user_exchange_credentials`, `reconciliation_jobs`) → `42501`; visible counts match the scoped expectation (trades 0 / webhook 1 / dlq 0); catalog (E2): no BYPASSRLS, no elevated attrs, no membership; `service_role` still BYPASSRLS (worker/Edge unaffected). `praxis_alert_ro` is confirmed **least-privilege read-only for alerting**.
- **Migration-history exception (010/011/012):** all three are applied **live via surgical/direct SQL** and are **NOT recorded in the remote `supabase_migrations` history**; **no `supabase db push` was run**. The committed files (`010_reconciliation_dlq_select_grant.sql`, `011_alert_readonly_role.sql`, `012_scope_user_select_policies_to_authenticated.sql`) are the record. This is a **documented history/tracking exception**: any future `db push` requires an explicit pre-check + reconcile decision (a naive push would attempt to re-apply 010/011/012). **Migration 009 remains frozen.**
- **S4-3a boot reconciliation resolver:** runbook commit `1cadf2f`; resolver commit `653417d` (`worker/src/reconciliation.ts` + boot wiring in `worker/src/index.ts`). Tests **257/257**, build clean, tools tsc clean. The resolver turns a stuck `pending`/`unknown` trade into its terminal status via **`fetchOrder` ONLY — NEVER `createOrder`** (no blind/duplicate order); idempotent + affected-row guards; `failed`/`order_not_found` → `trades.status='failed'` + `reconciliation_jobs.resolution=NULL`+notes (enum default (b); **no migration 013**); `submitted` leaves the trade pending (no orphan); **boot-wired only** (runtime `setInterval(60s)` scan = S4-3b, **deferred**). Pre-push read-only baseline: `stuck_eligible=0`, pending `reconciliation_jobs=0` → first boot inert.
- **S4-3a failed-path E1 — PASS (2026-06-23):** checklist commit `e2207c3`. RUN_ID `S4-3A-E1-20260623-1259`; seed trade `4421c08c-3ea5-485c-874b-a86c94598503` (`client_order_id PRX_E1_20260623_1259_NX`) seeded `status=unknown`; Railway deploy `bc156e29` (`queue_enabled:false`, `is_production:false`, `doppler_environment:dev`, `worker_queue_disabled`). Logs (E1): `boot_reconciliation_complete stuck_count:1` → `reconciliation_job_created` → `reconciliation_resolve_start eligible:1 processing:1 deferred:0` → `reconciliation_resolved resolved_status=failed action=resolved_failed` → `reconciliation_resolve_complete total=1 resolved=1`. Negative checks clean: no `trade_executed`, no `message_received`/`message_processed`, no `createOrder`/order placement, no `reconciliation_job_orphaned`. DB post-boot (E2): trade `failed`, `error_reason=order_not_found`; job `resolved`, `resolution=NULL`, `notes=order_not_found`; audit `trade.failed` (actor `worker`). Cleanup verified: `stuck_eligible=0`, `pending_jobs=0`, `run_id_trade_rows=0`, `run_id_reconciliation_jobs=0` (append-only `trade.failed` audit retained). **Result: failed-path E1 PASS.** **Limitation:** the filled-path (`unknown → filled`) is **NOT proven here** — `trades.client_order_id` is UNIQUE so it cannot be a fresh seed; **deferred to S4-2** (real campaign fills) or a separately-approved clean proof. **S4-3a is NOT fully closed.** **S4-3b runtime `setInterval(60s)` scan remains deferred.**

### 🔖 Sprint 4 — S4-1 operational activation CLOSED (dual E1 PASS; scheduler deferred) (2026-06-25)
- **Date:** 2026-06-25 · **Category:** Infrastructure / Observability · **Status:** RESOLVED — S4-1 operational activation **CLOSED for Sprint 4**. Both runtime E1s PASS; scheduler/recurring polling deferred to next sprint. No DB writes, no Doppler/Railway changes, no scheduler deploy/restart; **Migration 009 frozen**.
- **Path proven (E1):** read-only DB (`praxis_alert_ro`) → evaluate/de-dup → secret-safe render → **Telegram delivery**. Offline-first poller: injectable read-only `PgReadonlyRunner` + injectable Telegram transport; the only DB connection and the only network egress (`realFetch`) are built solely in their respective modes; secrets (DSN, bot token, chat id) live only at their boundaries and are never logged (config errors name env var + expected shape only; driver/transport errors are classified, never propagated raw). Slices: `6c09cb3` (pg readonly runner/config boundary) · `c6d2610` (run-once entrypoint/config loader) · `601aeba` (dry-run packaging plan + npm scripts) · `54c9676` (pg `timestamptz`→ISO row normalization + `PollerError`/`ReadonlyRunnerError` cause-leak hardening) · `f225229` (Telegram send mode: `realFetch` + `buildLiveTransport` + `alert:send`). Final tests **322/322**; build + tools-tsc clean.
- **DB-access dry-run E1 — PASS (2026-06-24, `54c9676`):** one-shot `npm run alert:dry-run` as `praxis_alert_ro` (password provisioned out-of-band; `psql` connectivity verified). `exit=0`, stderr empty, `leak-check`/`pw-check` CLEAN, DSN redacted (`:***@`); read the known live `queue_failed` evidence (`alerts=1 · signals=[queue_failed]`, `count=1`, `newest=2026-06-11T07:32:51.755Z`); **no send, no DB writes**. (Surfaced + fixed a real `pg`-Date→`PollerError` bug via `54c9676`.)
- **Telegram send-path E1 — PASS (2026-06-25, `f225229`):** one-shot `npm run alert:send` against the existing `queue_failed` evidence (no induction, no DB write). `exit=0`, stderr empty, `dsn`/`pw`/`token`/`chat`-check ALL CLEAN; `sendMode=send · telegramConfigured=true · alerts=1 · signals=[queue_failed]`; `send signal=queue_failed status=delivered httpStatus=200`; **Telegram message received** (`event=queue_failed_alert · count=1 · table=webhook_logs · newest=2026-06-11T07:32:51.755Z`). **Exactly one** send (in-memory de-dup → not re-run).
- **Closure decision (Oren, 2026-06-25):** the **one-shot run** (`run-once` / `alert:send`) is **accepted as sufficient operational proof for Sprint 4 closure**. **Scheduler / recurring polling / Railway cron is DEFERRED to next sprint** as operational hardening — **not** a Sprint 4 blocker. S4-1 operational activation is **DONE**; the deferred scheduler is carried forward.
- **Next Sprint 4 path:** **S4-3a filled-path** proof (`unknown/pending → filled` via `fetchOrder`, asserting `createOrder` never called) → **S4-2** 50-trade testnet campaign → **S4-8** closure review.

### 🔖 Sprint 4 — S4-2 50-fill testnet campaign RUNTIME PASS; S4-3a filled-path CLOSED; bot-error recovered (2026-06-29)
- **Date:** 2026-06-29 · **Category:** Reliability / Trading · **Status:** RESOLVED — S4-2 runtime PASS; S4-3a fully CLOSED (filled-path proven); ready for **S4-8** closure review. Testnet (`is_production=false`); `QUEUE_ENABLED=false` at rest, armed only during gated fire windows; **Migration 009 frozen**. RUN_ID **`S42A-20260629-0827`**, executed per [sprint4-s4-2-phase-a-execution-packet.md](sprint4-s4-2-phase-a-execution-packet.md) over [sprint4-s4-2-campaign-checklist.md](sprint4-s4-2-campaign-checklist.md).
- **Pre-campaign unblockers:** after the 2026-06-26 Doppler dev-secret rotation (all secrets rotated; legacy Supabase JWT keys disabled; Vault Binance credential + `WEBHOOK_SECRET_PEPPER` rotated; per [praxis-secret topology / exposure memory]), two reviewed worker fixes landed — `f07ef5a` (preserve safe exchange-unavailable diagnostics: `createOrder`/`fetchOrder` carry the original ccxt class+httpStatus as `ExchangeUnavailableError.detail`, never message/URL/secret) and `4f0cc0e` (**per-symbol BUY price floors**: fixed a Binance **-1013 NOTIONAL** under-sizing bug where the global assumed-MAX price (100_000) under-sized orders once testnet BTC fell to ~$59.3k → 0.00008 BTC = $4.78 < $5; replaced with a per-symbol `ASSUMED_MIN_PRICE_FLOOR_USDT` + fail-loud helper). 5 campaign bots (ETH/BNB/SOL/XRP + the existing BTC) on the shared testnet credential `2b5c038a`.
- **Phase A (E1) — 50 fills:** Phase-A RUN_ID-scoped **50 filled / 5 symbols / 50 distinct `signal_id`** (the `…-${SYM}-NN` fires, 10/symbol); the Phase-C recovery fill and the synthetic recon rows are additional RUN_ID-scoped evidence, **not counted toward the 50**. Global `filled_total=76` (incl. prior smoke + recovery). Batch-0 gate (5/5, queue=0, no faults) passed before the remaining 45. **`full_s4_2=GO`** (all: `filled_ge_50`, `symbols_ge_5`, `distinct_filled_signals_ge_50`, `no_duplicate_signal_id`, `no_duplicate_exchange_order_id`, `dlq_clear`, `queue_failed_clear`, `stuck_clear`, `no_open_pending_or_unknown`).
- **Phase B (E1) — 3 reconciled unknowns (boot-only, `QUEUE_ENABLED=false`):** `reconciliation_jobs={"resolved":3}` incl. ≥1 `resolved_status=filled action=resolved_filled` → **S4-3a filled-path CLOSED** (resolver correctness). **Induction was SYNTHETIC** — 2 filled campaign trades flipped to `unknown` (real `client_order_id`) + 1 seeded non-existent-order `unknown`; this **validates resolver behaviour, NOT organic crash timing** (natural SIGKILL fidelity not exercised — impractical on Railway). No `createOrder`/`trade_executed`/`reconciliation_job_orphaned` from the resolver.
- **Phase C (E1) — 1 recovered bot-error:** credential-invalid induction (shared-credential hard precondition `open_trades=0 ∧ pending_recon=0` verified first) → `bot.misconfigured` audit + `bots.status='error'` (fail-closed, observable; no silent ack, no DLQ — the audit+log IS the artifact) → recovered (credential `valid` **and** bot `active`) → recovery trade **filled**.
- **Final state (E1/E2):** `queue_length=0`, `dlq_total=0`, `queue_failed_total=0`, `stuck_total=0`, `pending_unknown_old=0`, zero duplicates; worker **DISARMED** (`queue_enabled=false`, `worker_queue_disabled`, boot `stuck_count=0`, `reconciliation_resolve_complete total=0 resolved=0`). Testnet fills retained as evidence (not rolled back); the single synthetic failed-path seed is **retained as RUN_ID-scoped reconciliation evidence — no DB cleanup performed before closure review** (cleanup remains optional per the execution packet; append-only audit retained).
- **Deferred (carried, NON-blocking for S4-2):** scheduler / recurring polling (S4-1, next sprint); true 5-bot concurrent production load; `position_size_pct` / live-price order sizing (the per-symbol floor remains a placeholder — see "🔖 Trade quantity calculation"); S4-3b runtime `setInterval(60s)` reconciliation scan.
- **Next:** **S4-8** closure review ([sprint4-s4-8-closure-review.md](sprint4-s4-8-closure-review.md)) → **Oren** close/no-close decision for Sprint 4.

### 🔖 Sprint 5 — A6 incident / rotation protocol CLOSED (2026-06-29)
- **Date:** 2026-06-29 · **Category:** Security / Operations · **Status:** RESOLVED — production-readiness gap **A6 CLOSED**. **Docs / tabletop only — no code / DB / Doppler / Railway execution, no secret reads; `QUEUE_ENABLED` unchanged.**
- **Deliverables:** [sprint5-s5-a6-incident-rotation-runbook.md](sprint5-s5-a6-incident-rotation-runbook.md) — severity model S0–S4; immediate-containment checklist (incl. a git working-tree/history scan for accidental secret persistence); secret-inventory matrix; rotation order (privileged → dependent, exchange creds after the Vault decrypt path, pepper+bot-tokens together); safe-CLI lessons from the 2026-06 Doppler exposure (`doppler` prints values → redirect; no values in argv/history; 0600 temp env-files; **never print any prefix/suffix/substring of a secret**); provider-specific verification (Supabase incl. CLI/access token, Vault, Binance, Telegram, Railway); resume/stop criteria; incident-record template. Plus [sprint5-s5-a6-tabletop-dry-run.md](sprint5-s5-a6-tabletop-dry-run.md) — an S3 dev privileged-secret exposure walkthrough, 14-step dry-run table all PASS, no remaining runbook-blocking gaps.
- **Evidence (E3 doc + tabletop):** runbook + tabletop dry-run (S3 walkthrough PASS); **Codex review PASS** (after a secret-hygiene fix — no secret prefix/substring verification — and folding two observations into the runbook: Supabase CLI/access-token rotation + the git-scan containment step); **Oren accepted** closure.
- **Standing rule:** production incidents MUST follow the runbook; **S3/S4 require Oren approval to resume**; secret values are never printed/pasted (names / digests / redacted only).
- **Carried (remaining Sprint 5 gaps):** egress, Migration 009, `position_size_pct`/live sizing, credential isolation, webhook hardening, frontend, StrateTeach T13 seam — see [production-readiness-gap-review.md](production-readiness-gap-review.md).

### 🔖 Sprint 5 — S5-A3/B4 migration 014 APPLIED + 5 bots CONFIG-READY (NOT armed) (2026-06-30)
- **Date:** 2026-06-30 · **Category:** Infrastructure / Trading · **Status:** RESOLVED — migration 014 **APPLIED + E2-verified**; 5 bots **CONFIG-READY (configured, kill switch OFF — NOT armed)**. **No §6b enable, no queue enable, no arm; `QUEUE_ENABLED=false`; Migration 009 frozen.**
- **What applied:** `014_bot_sizing_risk.sql` (commit `25c85c5`) — `bots` +8 sizing/risk cols (`sizing_mode`, `position_size_pct`, `fixed_notional_usdt`, `max_order_notional_usdt`, `daily_notional_cap_usdt`, `trading_enabled` NOT NULL DEFAULT true, `sell_enabled` NOT NULL DEFAULT false, `sell_size_pct`); `trades` +2 (`requested_notional_usdt`, `executed_notional_usdt`); `user_exchange_credentials` +1 (`exchange_environment`). Applied **surgically via transaction-wrapped direct SQL** (`{ echo BEGIN; cat 014…; echo COMMIT; } > /tmp/…; supabase db query --linked --file …`) per [sprint5-s5-a3-b4-execution-packet.md](sprint5-s5-a3-b4-execution-packet.md) Step 2 — atomic (rollback on any error), **NOT `db push`**.
- **Migration-history exception (010–014):** like 010/011/012/013, 014 is applied live and is **NOT recorded in remote `supabase_migrations`**; the committed file is the record. Step 1 (E2, 2026-06-30) confirmed `migration list` shows **010–014 Local-not-Remote** and 001–008 Local=Remote (009 has no local file) — so a naive `db push` would attempt to re-apply 010–014 and requires an explicit pre-check + reconcile. **Migration 009 remains frozen.**
- **Step 3 E2 PASS (2026-06-30):** all 11 columns present (`col_count=11`) with intended types/nullability/defaults (`trading_enabled` bool NOT NULL default true; `sell_enabled` default false; rest nullable, no default); CHECK constraints present (`sizing_mode IN (percent_of_balance,fixed_notional)`; `exchange_environment IN (testnet,mainnet)`; the `>0`/`>=0` numerics); **fail-closed confirmed** `bots_total=5, bots_unconfigured=5` (every bot `sizing_mode IS NULL` → worker blocks BUY before any order) — **apply-moment state, before §6a config**.
- **Code dependency:** the merged worker (slices 1–2b-2, final `fdae77b`) selects these columns in `processMessage` and fails closed (`env_missing` / `config_incomplete` / `trading_disabled` → audited bot-scoped `order.blocked`, no order, no pending trade) until bots are configured **and** enabled. Apply runbook + config packet: [sprint5-s5-a3-b4-migration-014-apply-runbook.md](sprint5-s5-a3-b4-migration-014-apply-runbook.md), [sprint5-s5-a3-b4-bot-config-packet.md](sprint5-s5-a3-b4-bot-config-packet.md).
- **Config §6a DONE + Step 5 E2 PASS (2026-06-30):** credential `exchange_environment='testnet'` set once on the shared credential `2b5c038a`; all **5 bots** (BTC/ETH/BNB/SOL/XRP) configured `sizing_mode=fixed_notional`, `fixed_notional_usdt=20`, `max_order_notional_usdt=25`, `daily_notional_cap_usdt=100`, `sell_enabled=false`, **`trading_enabled=false`** (kill switch OFF — config-ready, NOT armed). Step 5 verify: 5 rows all-fields-as-above, credential `valid` + not deleted, `QUEUE_ENABLED=false`. Approved values + statements per [sprint5-s5-a3-b4-bot-config-packet.md](sprint5-s5-a3-b4-bot-config-packet.md) / [execution packet](sprint5-s5-a3-b4-execution-packet.md) Steps 4–6.
- **NOT done (separate, Oren-approved arm):** §6b per-bot enable (`trading_enabled=true`, mode-specific + env-checked guard) **and** queue re-enable (`QUEUE_ENABLED=true`) + controlled first-fire = **arm**. No fire / TradingView / simulator. `QUEUE_ENABLED=false` throughout; fail-closed until armed.

### 🔖 Sprint 5 — Production go-live GATED; controlled smoke deferred; readiness package created (2026-06-30)
- **Date:** 2026-06-30 · **Category:** Governance / Trading · **Status:** ACTIVE — production go-live (real funds) **GATED**. Controlled testnet smoke **DEFERRED** pending an Oren-approved runtime window. **Docs / design only — no DB / Doppler / Railway / `QUEUE_ENABLED` / §6b enable / arm / mainnet executed.**
- **Decision:** real funds require **ALL MUST gaps closed (E1/E2) + controlled testnet smoke PASS + Oren written authorization (A11)**. Tiers are distinct: testnet-ready ✅ · config-ready ✅ · controlled-smoke-ready ⏳ (not executed) · production-real-funds-ready ❌.
- **Package (docs only):** [production-go-live-gap-list.md](production-go-live-gap-list.md), [production-a1-egress-binance-connectivity-packet.md](production-a1-egress-binance-connectivity-packet.md), [production-a4-credential-isolation-packet.md](production-a4-credential-isolation-packet.md), [production-a5-webhook-tradingview-hardening-packet.md](production-a5-webhook-tradingview-hardening-packet.md), [production-go-live-checklist-and-rollback.md](production-go-live-checklist-and-rollback.md), [sprint5-s5-a3-b4-controlled-smoke-packet.md](sprint5-s5-a3-b4-controlled-smoke-packet.md); [gap review](production-readiness-gap-review.md) updated (A6 closed; A3 config-ready/smoke-deferred).
- **Open MUST blockers for real funds:** A1 egress · A2 Migration 009 · A3 live smoke (testnet) · A4 credential isolation · A5 webhook/TradingView hardening · A10 rollback drill · A11 written real-funds approval (+ A8 trusted kill path).
- **Standing:** `QUEUE_ENABLED=false`; 5 bots `trading_enabled=false`; SELL fail-closed; Migration 009 frozen; mainnet only after the MUST gate + Oren.

### 🔖 Sprint 5 — Oren go/no-go: chose A (controlled TESTNET smoke approved); Phase 0 PASS (2026-06-30)
- **Date:** 2026-06-30 · **Category:** Governance / Trading · **Status:** ACTIVE — **Oren chose option A** (approve a controlled **testnet** smoke window) after **Phase 0 PASS**. Authorizes Phase 1 **testnet only**; **NOT mainnet, NOT real funds; A11 not granted.** Record: [production-oren-decision-record.md](production-oren-decision-record.md).
- **Phase 0 PASS (read-only, 2026-06-30):** (a) 5 bots config-ready — `fixed_notional=20`/`max=25`/`daily=100`, `sell=false`, **`trading_enabled=false`**, env=testnet (E2); (b) `open_trades=0 / dlq=0 / open_recon(status='pending')=0 / queue_length=0` (E2); (c) `QUEUE_ENABLED=false` (E2); (d) latest Railway worker deploy `queue_enabled=false` + `worker_queue_disabled` + boot `stuck_count=0` (E1, operator-verified).
- **Approved scope (verbatim):** testnet only · one BTC bot only · one signal only · expected `requested_notional_usdt=20` · **immediate disarm after outcome regardless of PASS/SAFE STOP/failure** · no mainnet · no real funds · no TradingView live · no broader campaign.
- **Execution:** Phase 1 follows [the controlled smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md) **exactly**, operator-driven (enable/arm/fire/disarm), agent runs read-only verifies. **SMOKE PASS = one filled testnet order**; `order.blocked` = SAFE STOP, not a pass. Outcome + re-disarm to be recorded as separate E1 evidence on completion.

### 🔖 Sprint 5 — Controlled TESTNET smoke EXECUTED: SMOKE PASS, re-disarmed (2026-06-30)
- **Date:** 2026-06-30 · **Category:** Reliability / Trading · **Status:** RESOLVED — **S5-A3/B4 live sizing/risk path PROVEN on testnet** (one filled order), then **fully re-disarmed**. **Testnet only · no mainnet · no real funds · A11 NOT granted.** Full record: [production-oren-decision-record.md](production-oren-decision-record.md) §7.
- **SMOKE PASS (E1, RUN_ID `S5SMOKE-20260630-1034`):** signal_id `S5SMOKE-20260630-1034-BTCUSDT-01` → exactly **1** trade `e1dd53ec-d61a-496d-9d17-15ef36df0cb9`: `side=buy`, `status=filled`, `requested_notional_usdt=20`, `executed_notional_usdt=19.8938726` (= order cost), `quantity=0.00034` = roundDown(20 / price 58511.39, step 0.00001), `exchange_order_id=11051234`, `error_reason=null`; audit `trade.created → trade.filled`. Caps honored (≤max 25, ≤daily 100); no second trade, no `order.blocked`. Sizing/risk proven end-to-end: config → balance+price → computeBuyQuantity → requested_notional persisted → createOrder → fill → executed_notional from cost.
- **Disarm (E1/E2, verified):** `enabled_bots=0`, `btc_still_enabled=0`, `open_trades=0`, `dlq=0`, `open_recon(status='pending')=0`, `queue_length=0`, `QUEUE_ENABLED=false`; Railway worker deploy `queue_enabled=false` + `worker_queue_disabled` + `boot_reconciliation_complete stuck_count=0` (operator-verified). Single testnet fill retained as evidence (no cleanup).
- **Step 6 anomaly (caught + corrected):** the first `trading_enabled=false` UPDATE returned **empty output**; a raw read-back caught **BTC still enabled** (first UPDATE didn't take); re-run succeeded (raw `RETURNING` false) and an independent read confirmed `enabled_bots=0`. During the gap the Doppler flag was already `QUEUE_ENABLED=false` and no additional signal was fired; final evidence (`queue_length=0` + Railway `worker_queue_disabled`) confirms no additional order was observed or recorded (the flag alone does not prove the worker's runtime state during the gap). **Lesson (binding):** every arm/disarm DB mutation must be verified by a raw read-back — empty/absent grep output is not evidence.
- **Standing after:** `QUEUE_ENABLED=false`; all 5 bots `trading_enabled=false`; SELL fail-closed; Migration 009 frozen; config-ready, **NOT armed**. Real funds remain blocked behind the MUST gates (A1/A2/A4/A5/A10/A11 + A8) + A11 written approval.

### 🔖 Sprint 5 — Praxis⇄StrateTeach owner split + next-block scope (2026-06-30)
- **Date:** 2026-06-30 · **Category:** Governance / Integration · **Status:** ACTIVE — owner split recorded; StrateTeach-owned readiness questions remain **OPEN** (not assumed); next-block scope fixed. Docs only — no code/DB/Doppler/Railway/execution; no StrateTeach connection. Docs: [strateteach readiness questions](production-strateteach-readiness-questions.md), [tomorrow scope](production-tomorrow-scope.md).
- **Owner split (binding):** **Praxis owns execution · risk · audit · credentials · orders** (only component that touches the exchange/moves money); **StrateTeach owns strategy concepts · backtest · input · signal ideas** (+ market-data, licensing, provenance, UI claims). **StrateTeach must NOT** hold exchange keys / `service_role` / Vault secrets / DB write, **hold webhook tokens in browser/client code** (if it posts directly, tokens are server-side only, per-bot, rotatable, audited, never UI-exposed), decide quantity, or bypass Praxis risk controls; the **only** path is the governed webhook (envelope-only) → pgmq → worker → audit → limits. **No direct-execution path, ever.**
- **Praxis-owned readiness — ANSWERED** (orders, sizing/quantity authority, server-enforced risk caps + kill switch, audit, Vault-only credentials, env separation, idempotency, the envelope-only contract) — see readiness §A.
- **StrateTeach-owned — OPEN (awaiting StrateTeach, not assumed):** market-data sourcing/licensing, backtest validity, signal provenance, strategy-gen correctness, UI/marketing claims, user disclaimers, data retention (readiness §B). Praxis enforcement bounds blast radius but does not validate these.
- **T13 seam:** no StrateTeach connection (even testnet) until decided in the Decision Log (transport = webhook only; token rotation; source validation/rate limits; config authority = Praxis).
- **Next-block scope:** StrateTeach readiness Q&A + this scope/DECISIONS record; then **Operator Console Slice 1 (status read only)** when we proceed to code (gated, per-slice review). **OUT:** mainnet/real funds, queue-arm/un-pause/fire, multi-bot arming, TradingView live, StrateTeach connection, console mutating slices.

### 🔖 Reconciliation worker — setInterval(60s) design, cap, and coordination (DEFERRED Sprint 3)
- **Date:** 2026-06-01 · **Category:** Architecture · **Status:** ACTIVE (DEFERRED Sprint 3)
- **Impact:** DEFERRED. Owner: CTO. Trigger: after pgmq live AND Worker deployed AND first reconciliation_job created naturally. Open sub-decisions (all must resolve in Sprint 3): (1) Cap per cycle (placeholder 20; 20 × Vault P99 121ms = 2.4s Worker blockage — acceptable?); (2) Scheduling (setInterval shares the poll event loop — no true parallelism); (3) Age threshold (currently 60s at visibility_timeout=30s); (4) 24h escalation → Sentry alert; (5) coordination with step 0b to avoid double fetchOrder.
- **Alternatives:** A) setInterval(60s) same process — simple, no extra infra; if Worker crashes, reconciliation stops too. B) pg_cron — runs even if Worker down; risk dual actor; needs pg_cron extension. C) Separate reconciliation worker — clean isolation, extra infra/monitoring. D) Boot-only (current Sprint 2) — simplest; risk silent accumulation on long uptime.
- **Reason:** pgmq not set up (Sprint 3). Cannot test reconciliation without real queue traffic and failure patterns. Architecture mandates setInterval(60s) same-process, but cap/coordination/threshold/escalation are unresolved; implementing now = speculation.

### 🔖 processMessage step 0b — crash recovery: inline fetchOrder vs reconciliation (DEFERRED Sprint 3)
- **Date:** 2026-06-01 · **Category:** Architecture · **Status:** ACTIVE (DEFERRED Sprint 3)
- **Impact:** DEFERRED. Owner: CTO. Trigger: after pgmq live AND first 50 testnet signals processed. Answer: (1) How often does a message re-appear with an existing pending/unknown trade? (2) reconciliation_jobs per 100 trades in practice? (3) Is 30s visibility timeout long enough? If step 0b → Worker self-heals on re-delivery, processMessage more complex. If reconciliation-only → processMessage simple, stuck trades accumulate without restart. Sprint 2: duplicate signal → ack=true skip; boot reconciliation creates jobs; no inline fetchOrder.
- **Alternatives:** A) Step 0b in processMessage (Arch v1.3) — self-healing. B) Boot reconciliation only (current Sprint 2) — risk silent accumulation. C) setInterval(60s) reconciliation only — decoupled from re-delivery. D) Both — belt-and-suspenders; risk double fetchOrder.
- **Reason:** pgmq not set up (Sprint 3). No real failure data. Two valid designs; wrong choice wastes complexity or creates silent stuck-trade accumulation. Must see real failure patterns first.

### 🔖 pgmq trade_signals message format — minimal vs full payload (DEFERRED Sprint 3)  *(SUPERSEDED / RESOLVED 2026-06-04)*
- **Date:** 2026-06-01 · **Category:** Architecture · **Status:** SUPERSEDED
- **Resolved by:** "Queue Message Format v1.0 = {schema_version, bot_id, signal_id, side}" (2026-06-04) — chose Option A (minimal) + schema_version.
- **Impact:** DEFERRED. Owner: CTO. Option A (minimal {bot_id, signal_id, side}): Edge Function simpler; Worker generates client_order_id, derives symbol from bots.trading_pair; no client_order_id in webhook_logs (extra JOIN to correlate). Option B (full {bot_id, action, symbol, signal_id, client_order_id}): direct audit trail; Edge Function must generate nanoid; both sides must agree on format PRX_<nanoid(10)>. Option C (hybrid): symbol for observability, Worker still makes client_order_id.
- **Alternatives:** A) Minimal — current Sprint 2 Worker assumes this. B) Full — Architecture v1.3.0 assumed this. C) Hybrid.
- **Reason:** Edge Function (Sprint 3) not yet written. Worker index.ts assumes minimal {bot_id, signal_id, side}; Architecture v1.3 documented full payload. These are incompatible — a breaking interface contract between two components. Wrong choice = rewrite.

### Vault secret JSON contract: { api_key, api_secret } + logging policy
- **Date:** 2026-05-31 · **Category:** Security · **Status:** ACTIVE
- **Impact:** Storage (Vault): {"api_key": string, "api_secret": string} (snake_case, matches Binance UI). In-memory (ccxt): { apiKey, apiSecret } (camelCase). VaultSecretsProvider maps on parse. FORBIDDEN in logs/Sentry/console: apiKey/api_key value, apiSecret/api_secret value, ExchangeCredentials object, ccxt exchange object, any Vault decrypted_secret string, SUPABASE_SERVICE_ROLE_KEY. ALLOWED: credential_id (UUID pointer), bot_id, exchange, symbol, action, error.code/message (never full error object if credentials in scope), client_order_id, amounts, prices.
- **Alternatives:** camelCase storage (rejected — inconsistent with Binance UI). Flat storage without JSON (rejected — cannot add exchange field later without migration).
- **Reason:** Vault stores Binance credentials as JSON; format must be frozen before BinanceAdapter parses it. Logging policy required to prevent credential leakage. Validated by spike-vault.ts 2026-05-31.

### SecretsProvider abstraction + per-trade ccxt instantiation
- **Date:** 2026-05-31 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** BinanceAdapter receives ExchangeCredentials (never credential_id). Worker calls SecretsProvider.getExchangeCredentials(credentialId) before instantiating ccxt. Mandatory memory lifecycle: fetch creds → new ccxt.binance({apiKey, apiSecret}) → createOrder → finally { exchange.apiKey=''; exchange.apiSecret=''; credentials=null; exchange=null }. Error rules (amended 2026-06-01): never include credentialId in thrown error messages; never log raw error objects; ccxt exchange object must never appear in logs.
- **Alternatives:** Direct Vault access in BinanceAdapter (rejected — untestable, violates SRP). Singleton ccxt exchange (rejected — credentials persist across trades).
- **Reason:** Decouples secret fetching from exchange ops (testable via MockSecretsProvider, single audit point, future-proof). Threat Review 001: ccxt stores apiKey/apiSecret as object properties — nulling the credentials variable alone does not zero the ccxt copy; both must be wiped. Per-trade instantiation: created, used, zeroed, discarded within one try/finally.

### Vault API: get_decrypted_secret() RPC wrapper (verified 2026-05-31)
- **Date:** 2026-05-28 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** RESOLVED (spike passed 2026-05-31). vault.decrypted_secrets VIEW is NOT exposed to PostgREST (PGRST106). Correct call: supabase.rpc('get_decrypted_secret', { secret_id: uuid }). Requires migration 004 (wrapper fn, SECURITY DEFINER, service_role only). Returns string | null (null on missing, not an exception). Local P50 115ms / P99 121ms. Still open: key rotation (tracked separately), Railway latency TBD.
- **Alternatives:** N/A — verification gate, not a design choice.
- **Reason:** vault.decrypted_secrets is a VIEW in the vault schema; PostgREST does not expose vault by default. Correct approach: SECURITY DEFINER wrapper fn in public, callable via rpc(). Validated by spike-vault.ts 2026-05-31.

### Key rotation + secret deletion procedure — DEFINED
- **Date:** 2026-06-01 · **Category:** Security · **Status:** ACTIVE
- **Impact:** Procedure: (1) user enters new key+secret; (2) validate via test fetchBalance; (3) if valid: INSERT new Vault secret → new id; UPDATE user_exchange_credentials.vault_secret_id (atomic); DELETE old via delete_vault_secret() (migration 005); credential_status→valid; (4) if invalid: DELETE new Vault entry, old key still works. CRITICAL ORDER: always UPDATE DB before DELETE old secret. In-flight trades fetch key at execution time; atomic DB update = no gap. Migration 005 written, apply before Sprint 3 credential UI. Implementation: Sprint 3.
- **Alternatives:** N/A — blocked on Vault Spike; procedure must match actual Vault API behavior.
- **Reason:** User wants to replace their Binance API key; architecture had no defined rotation procedure. Could not define correctly without the Vault API (blocked on Vault Spike).

### 🔖 pgmq visibility_timeout — RESOLVED (WB7, 2026-06-17)
- **Date:** 2026-05-28 · **Resolved:** 2026-06-17 · **Category:** Infrastructure · **Status:** RESOLVED — `visibility_timeout_s = 30` (measured minimum 18s; 30s retained for headroom)
- **Resolution (WB7 measured run — Railway testnet, RUN_ID `WB7R-20260617-1017-railway`):** 20 signals (10 baseline + 10 single-bot backlog), all `filled`. `read_ct` histogram `{"1":20}` → zero redelivery, log-proven for all 20 (msg_id 6–25). `max(processing_duration_ms) = 1887ms`. Computed `visibility_timeout_s = ceil((1887 + ack_delete_overhead_ms[1000] + safety_buffer_ms[15000]) / 1000) = 18s`. Configured **30s ≥ 18s → PASS** with headroom; 30s retained (margin preferred over marginally faster crash-recovery). DB: 20 trades = 20 distinct `signal_id` = 20 distinct `exchange_order_id`; `pending/unknown=0`, DLQ=0, reconciliation=0; `webhook_logs` accepted=20 / rejected=0 / queue_failed=0; `queue_length=0`. Disarm verified (deployment `dc4c9bbe`: `queue_enabled:false`, `worker_queue_disabled`, `is_production:false`, `doppler_environment:dev`). Evidence: [wb7-runbook.md](wb7-runbook.md), [wb7-measured-run-plan.md](wb7-measured-run-plan.md), [wb7-exec-checklist.md](wb7-exec-checklist.md).
- **Formula correction (WB7):** the original formula below double-counted Vault (`max(20) + Vault P99`). Measured `processing_duration_ms` already covers Vault end-to-end, so the resolved formula re-adds only the post-process ack RPC + safety buffer: `visibility_timeout_s = ceil((max(processing_duration_ms) + ack_delete_overhead_ms[1000] + safety_buffer_ms[15000]) / 1000)`. See [wb7-runbook.md](wb7-runbook.md) §3.
- **Caveat — NOT 5-bot concurrent load:** this closes WB7 under the approved Sprint-3 **Option B single-bot backlog proxy** only. It is **not** proof of true 5 concurrent bots; genuine multi-bot concurrent load is **carried forward as a separate load/performance item**.
- **Original plan (2026-05-28, pre-measurement):** Return trigger: end of Sprint 2, after BinanceAdapter works on Testnet. Measurement: 20 runs (10 baseline single bot + 10 under load 5 concurrent bots); use worst single result. Formula: WORKER_EXCHANGE_TIMEOUT = max(20) + Vault P99 + 3s margin; visibility_timeout = WORKER_EXCHANGE_TIMEOUT + 15s safety buffer.
- **Alternatives:** Static estimate (rejected — no real data). Conservative fixed high value (rejected — degrades crash-recovery time).
- **Reason:** Cannot set without measuring actual pipeline latency under concurrent load. Estimates risk duplicate order attempts (too short) or stuck pending trades (too long) — both have direct financial consequences.

### HMAC-SHA256 for webhook_secret verification
- **Date:** 2026-05-28 · **Category:** Security · **Status:** ACTIVE
- **Impact:** webhook_secret_hash stores HMAC-SHA256 digest. Edge Function: crypto.createHmac('sha256', secret).update(payload).digest('hex') with timingSafeEqual() for constant-time comparison. One-way. Supersedes the bcrypt entry (2026-05-20). Decided: Architecture Roast [2] 2026-05-28.
- **Alternatives:** bcrypt (SUPERSEDED — wrong primitive, cold-start latency), Vault (overkill), plaintext (insecure).
- **Reason:** webhook_secret is a random 32-byte token, not a human password. HMAC-SHA256 is the correct primitive: <1ms vs bcrypt 100–300ms, constant-time comparison, no cost-factor tuning. Industry standard (GitHub, Stripe, Twilio).

### ERD v1.2 Approved — Sprint 1 DB design finalized
- **Date:** 2026-05-26 · **Category:** Database · **Status:** ACTIVE
- **Impact:** 001_initial_schema.sql ready for execution. Table structures, constraints, RLS, enums locked for Sprint 1.
- **Alternatives:** 9 separate Decision Log entries — rejected as too granular.
- **Reason:** Full ERD review cycle completed; Sprint 1 scope locked; all sub-decisions resolved before SQL generation.

### Frontend = React + TypeScript + Vite (not Next.js)
- **Date:** 2026-05-21 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** All scaffolding commands use Vite. Worker remains Node.js/TypeScript separately.
- **Alternatives:** Next.js (SUPERSEDED — see superseded section).
- **Reason:** No SSR needed for MVP; Vite is faster to build with. CURRENT_STATE and CLAUDE_BOOT_CONTEXT previously listed Next.js in error — corrected in context audit 2026-05-21.

### pgmq delivery = at-least-once; effectively-once trade execution via idempotency layer
- **Date:** 2026-05-21 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Wording corrected: exactly-once → **effectively-once**. Mechanism corrected: signal_id check is `INSERT … ON CONFLICT (bot_id, signal_id) DO NOTHING` on webhook_logs (atomic), NOT a prior SELECT. Worker signal_id state machine added to Architecture. Migration 003 adds queue_failed to webhook_log_status enum. Updated: Architecture Roast [3] 2026-05-28.
- **Alternatives:** 1) Exactly-once delivery at queue level (rejected — not achievable without distributed transactions; pgmq has no native support). 2) Dedup at queue level (rejected — pgmq has no built-in dedup). 3) SELECT-before-INSERT (rejected — race condition, non-atomic). 4) At-least-once + application-layer idempotency (CHOSEN).
- **Reason:** pgmq guarantees at-least-once delivery. Effectively-once execution via two idempotency layers: (1) Edge Function INSERT ON CONFLICT DO NOTHING (atomic dedup); (2) Worker SELECT trades WHERE (bot_id, signal_id) before any exchange call. **This is effectively-once, NOT exactly-once — exactly-once does not exist in distributed systems without distributed transactions.**

### signal_id = TradingView payload ID or UUID v4 — never timestamp-derived  *(SUPERSEDED 2026-06-04)*
- **Date:** 2026-05-21 · **Category:** Architecture · **Status:** SUPERSEDED
- **Superseded by:** "signal_id = source-supplied C-bar composite; reject-if-absent; no UUID fallback" (2026-06-04). payload.signal_id primary retained; the ?? crypto.randomUUID() fallback retired (resend duplicates) → reject-if-absent.
- **Impact:** Edge Function generates signal_id as payload.signal_id ?? crypto.randomUUID(). Refinement 2026-05-26: uniqueness is UNIQUE(bot_id, signal_id) — NOT globally unique. Two users running the same TradingView strategy produce identical signal_ids; global uniqueness would cause false rejections.
- **Alternatives:** Timestamp window approach (botId + action + timestamp/10000) — rejected: not stable enough.
- **Reason:** Timestamp-based keys are unreliable across clock skew and retry windows. UUID v4 or a TradingView-provided unique field is canonical.

### DB schema tables: 10 tables across 001_initial_schema.sql
- **Date:** 2026-05-21 · **Category:** Database · **Status:** ACTIVE
- **Impact:** 001_initial_schema.sql ready. 10 tables. Structures/constraints/RLS/enums locked for Sprint 1. Updated: Roast [6] 2026-05-31 — corrected stale count of 9.
- **Alternatives:** —
- **Reason:** Tables: exchanges, profiles, user_exchange_credentials, bots, bot_events, webhook_logs, trades, audit_logs, trades_dlq, reconciliation_jobs. Note: auth.users is Supabase-managed and NOT counted — Praxis does not create or own it.

### Spot before Futures
- **Date:** 2026-05-20 · **Category:** Product · **Status:** ACTIVE
- **Impact:** Futures in Sprint 7+.
- **Alternatives:** Futures from day one (complex).
- **Reason:** Simpler, less risk, faster to ship.

### Sentry for error tracking
- **Date:** 2026-05-20 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** Worker + Frontend tracked separately.
- **Alternatives:** Datadog (expensive), custom logging (no time).
- **Reason:** Free tier sufficient for MVP.

### Testnet enforced in code (not just env flag)
- **Date:** 2026-05-20 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** No real trades until explicit production deploy. (Production gate: see MVP Scope — Testnet enforced until 50 successful fake trades.)
- **Alternatives:** Env flag only (human error risk).
- **Reason:** if NODE_ENV !== production → forceTestnet. Not just an env flag.

### Round DOWN always on quantity
- **Date:** 2026-05-20 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Slightly less quantity traded. Prevents balance errors.
- **Alternatives:** Round nearest (sometimes UP = failure).
- **Reason:** Round UP can cause the order to exceed available balance.

### Market orders only (MVP)
- **Date:** 2026-05-20 · **Category:** Product · **Status:** ACTIVE
- **Impact:** 100% fill or error. No partial state.
- **Alternatives:** Limit orders (complex fill tracking).
- **Reason:** Simplest execution. No partial-fill complexity.

### ccxt for exchange integration
- **Date:** 2026-05-20 · **Category:** Product · **Status:** ACTIVE
- **Impact:** All exchange calls go through the ccxt interface.
- **Alternatives:** Custom per-exchange (weeks per exchange).
- **Reason:** 100+ exchanges, unified API.

### Binance first
- **Date:** 2026-05-20 · **Category:** Product · **Status:** ACTIVE
- **Impact:** Bybit in Sprint 7. ccxt abstracts the adapter.
- **Alternatives:** Bybit first (smaller user base).
- **Reason:** Most users, best docs. ccxt makes adding others trivial.

### ON DELETE RESTRICT everywhere
- **Date:** 2026-05-20 · **Category:** Database · **Status:** ACTIVE
- **Impact:** Deletes require explicit multi-step cleanup.
- **Alternatives:** CASCADE (risky), SET NULL (loses FK).
- **Reason:** No silent cascade deletes. Data loss must be explicit.

### Soft delete (status=deleted + deleted_at)
- **Date:** 2026-05-20 · **Category:** Database · **Status:** ACTIVE
- **Impact:** deleted_at TIMESTAMPTZ on bots. Never physically removed.
- **Alternatives:** Hard delete (data loss risk).
- **Reason:** A deleted bot may have open positions; hard delete loses history.

### profiles (not users)
- **Date:** 2026-05-20 · **Category:** Database · **Status:** ACTIVE
- **Impact:** New engineers won't confuse public.profiles with auth.users. **The MVP user table is `profiles`, NOT `users`.**
- **Alternatives:** users table (naming conflict).
- **Reason:** Avoids collision with auth.users. Prevents engineer confusion.

### signal_id from payload, not timestamp  *(SUPERSEDED 2026-06-04)*
- **Date:** 2026-05-20 · **Category:** Architecture · **Status:** SUPERSEDED
- **Superseded by:** "signal_id = source-supplied C-bar composite; reject-if-absent; no UUID fallback" (2026-06-04).
- **Impact:** signal_id must come from TradingView or be a webhook UUID.
- **Alternatives:** floor(timestamp/10000) (causes signal collapse).
- **Reason:** Timestamp rounding collapses buy+sell in the same 10s window.

### 200 OK always on webhook (even on reject)
- **Date:** 2026-05-20 · **Category:** Security · **Status:** ACTIVE
- **Impact:** All rejection info in webhook_logs only.
- **Alternatives:** Return real status codes (security risk).
- **Reason:** 401/403 reveals system structure to attackers.

### INSERT trades(pending) BEFORE exchange call
- **Date:** 2026-05-20 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** Transaction pattern. Foundational to reliability.
- **Alternatives:** Insert after (risks lost trade), no insert (no idempotency).
- **Reason:** Prevents lost trades and double-execution on Worker crash.

### No automatic retry after timeout
- **Date:** 2026-05-20 · **Category:** Architecture · **Status:** ACTIVE
- **Impact:** reconciliation_job created instead.
- **Alternatives:** Auto-retry (dangerous), manual retry (slow).
- **Reason:** Timeout = unknown state; retry risks double-execution.

### Doppler for secrets
- **Date:** 2026-05-20 · **Category:** Security · **Status:** ACTIVE
- **Impact:** All app secrets in Doppler. GitHub Secrets permitted for CI/CD pipelines only.
- **Alternatives:** .env files (insecure).
- **Reason:** No secrets in repository code. Fintech discipline from day one.

### Supabase Vault for API keys
- **Date:** 2026-05-20 · **Category:** Security · **Status:** ACTIVE
- **Impact:** User-transparent (no re-entry on infra changes). Migration to KMS would be non-trivial (all vault_secret_id references change, Worker API call changes, per-row migration). Root key: pgsodium root key is Supabase-managed — accepted MVP tradeoff. Enterprise CMEK is post-MVP.
- **Alternatives:** 1) Doppler — rejected: built for a fixed set of system secrets, not N per-user dynamic secrets; would grant developer access to user keys. 2) AWS KMS — rejected for MVP: separate account, IAM, cross-cloud path (valid for Enterprise). 3) pgcrypto — rejected: reintroduces key-management problem. 4) Proxy service (don't store keys) — rejected: out of scope for Sprint 1–3.
- **Reason:** Supabase Vault-backed encryption — zero custom crypto, SOC2-certified platform (pgsodium/libsodium). Exact runtime primitive + Node access API verified by Vault Spike before any Worker credential code.

### pgmq (not RabbitMQ / Redis / BullMQ)
- **Date:** 2026-05-20 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** Queue lives in Supabase DB. One less service.
- **Alternatives:** RabbitMQ (too heavy), BullMQ (needs Redis).
- **Reason:** Postgres-native. No extra infra. No DevOps for MVP.

### Railway for hosting
- **Date:** 2026-05-20 · **Category:** Infrastructure · **Status:** ACTIVE
- **Impact:** Move to AWS when hiring a DevOps engineer.
- **Alternatives:** AWS (needs DevOps), Render (similar).
- **Reason:** Zero DevOps. Managed SSL + auto-deploy.

---

## SUPERSEDED decisions (kept for history — do not act on)

### bcrypt → HMAC-SHA256 for webhook_secret verification  *(SUPERSEDED)*
- **Date:** 2026-05-20 · **Category:** Security · **Status:** SUPERSEDED
- **Superseded by:** "HMAC-SHA256 for webhook_secret verification" (2026-05-28, Architecture Roast [2]).
- **Reason (historical):** bcrypt is a password hash for human-memorable secrets; webhook_secret is a random 32-byte token. HMAC-SHA256 is <1ms vs bcrypt 100–300ms, avoiding Edge Function cold-start timeout. Refinement 2026-05-26 removed the UNIQUE constraint.

### Next.js for Frontend (not Vite/React)  *(SUPERSEDED)*
- **Date:** 2026-05-20 · **Category:** Product · **Status:** SUPERSEDED
- **Superseded by:** "Frontend = React + TypeScript + Vite (not Next.js)" (2026-05-21).
- **Reason (historical):** Originally chosen on Dan's recommendation for better DX. Reversed: no SSR needed for MVP; Vite is faster to build with.
