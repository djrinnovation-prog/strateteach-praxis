# S4-2 — 50-Trade Testnet Campaign · Moment-of-Execution Checklist

**Status:** DESIGN / GATED. Nothing armed, fired, seeded, or restarted. Every arm/fire/DB-write/restart
below is a **GATED** step requiring explicit operator approval *at the moment*. Testnet only
(`is_production=false`), **NOT LIVE**. **Migration 009 frozen.** Companion design:
`docs/sprint4-s4-1-operational-activation-runbook.md` (alerting) + the S4-2 execution packet (chat).
Evidence is collected with `npm run sprint4:evidence` (migration 013 role) at each checkpoint.

> **DEFAULTS:** items marked **[DEFAULT — confirm/override]** are my proposed values for the open §10
> decisions; the operator/reviewer overrides any before execution. No default is self-executing.

## 0. RUN_ID
`S4-2-CAMPAIGN-YYYYMMDD-HHMM` (UTC). Every seeded/synthetic row carries it in `signal_id`; campaign
trades carry their natural simulator `signal_id`. One RUN_ID per campaign attempt.

## 1. Prerequisites (read-only / setup — verify ALL before arming)
- [ ] Worker deployed at the resolver+alerting SHA; **testnet egress green** (disarmed boot: `binance_http_probe`-equivalent ok, `queue_enabled:false`, `is_production:false`).
- [ ] **`praxis_report_ro` provisioned** (migration 013 applied + verified) and `PRAXIS_REPORT_DSN` set → baseline run works.
- [ ] **5 symbol bots**, each `active`, credential `valid`/not-deleted. **[DEFAULT — confirm/override]** symbols `BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT, XRPUSDT`; one bot per symbol; all on the existing testnet credential `2b5c038a` (confirm it trades all 5 on testnet). *(Creating bot rows = a GATED DB write.)*
- [ ] **Testnet balances funded** for all 5 quote pairs (≥50 small fills + headroom).
- [ ] **Baseline = Phase 0 GO:** `npm run sprint4:evidence` → `phase0_ready=GO` (queue empty, DLQ 0, queue_failed 0, stuck 0, no dup signal_id / exchange_order_id). **If `queue_length=unavailable` → STOP** (re-provision the report role; never fire without a positively-verified empty queue).
- [ ] Boot log shows `visibility_timeout_s:30` (WB7-measured worst-case headroom). **STOP if lower** (redelivery / duplicate-execution risk).
- [ ] `QUEUE_ENABLED=false` at start. Migration 009 frozen.

## 2. Runtime-state transitions (each GATED)
1. **Disarmed baseline** (`QUEUE_ENABLED=false`) → §1 baseline.
2. **ARM** → `QUEUE_ENABLED=true` (Doppler → Railway redeploy); confirm boot `queue_enabled:true · is_production:false · doppler_environment:dev · queue_preflight_ok`.
3. **FIRE** → drive simulator signals (phased, §3–§6).
4. **DISARM** → `QUEUE_ENABLED=false` immediately after; confirm `worker_queue_disabled`, `queue_length=0`.

## 3. Phase 0 — smoke (1–2 fills) · GATED arm+fire
- [ ] ARM. Fire **1–2 BTCUSDT** signals (fresh `signal_id`s).
- [ ] Verify full pipeline: webhook `accepted` → 1 queue msg → worker consume → **testnet fill** → `trades.filled` + audit `trade.created→trade.filled`; **exactly one** trade per signal (no dup); queue drains to 0.
- [ ] Checkpoint: `npm run sprint4:evidence` → no DLQ/queue_failed/stuck; `filled_total` increased; alerting dry-run clean.
- [ ] GO/abort decision before Phase A.

## 4. Phase A — volume to 50 fills / 5 symbols · GATED fire (queue stays armed)
- [ ] Fire in **batches of 10** across the 5 symbols (fresh `signal_id` each); checkpoint after each batch.
- [ ] Each checkpoint (`sprint4:evidence`): `phaseA=GO` (no dup signal_id / exchange_order_id, DLQ 0, queue_failed 0); `filled_total` climbing; `filled_by_symbol` covering 5 symbols; `read_ct` histogram `{1:…}` (zero-duplicate redelivery — confirm via logs).
- [ ] Continue to **≥50 filled across ≥5 symbols**, **50 distinct `signal_id` = 50 distinct `exchange_order_id`**.

## 5. Phase B — 3 reconciled unknowns (incl. S4-3a filled-path) · GATED
Reconciliation is **boot-only** this sprint (S4-3b deferred) → unknowns resolve on the next worker restart.
- [ ] **Unknown #1 — filled→unknown (S4-3a FILLED-PATH proof) [DEFAULT — confirm/override]:** for one armed trade, **`kill -9` (SIGKILL) the worker after the order is placed/filled on testnet but BEFORE the `trades.filled` write**, leaving the trade `unknown` with a real filled `client_order_id`. **Use SIGKILL, NOT SIGTERM/SIGINT** — the worker traps those for graceful drain and would COMPLETE the status write, defeating the injection. Sub-second, non-deterministic window: a missed kill yields a clean `filled` trade (not a failure — just retry). *(Natural injection — no DB flip, no WB9 row touched.)*
- [ ] **Unknown #2 — unknown→failed [DEFAULT]:** seed/observe a trade that ends `unknown` with a **non-existent** order (OrderNotFound) → resolves `failed` (as the S4-3a failed-path E1 already proved).
- [ ] **Unknown #3 — second filled-left-unknown [DEFAULT]:** repeat the Unknown #1 injection (resolves terminal `resolved_filled` in ONE boot). **Do NOT use a `submitted`/transient variant** — the resolver leaves those `left_open`/`left_pending_*` (NON-terminal): the trade stays open, only `reconciliation_resolve_open` is logged (no `reconciliation_resolved`), `recon_jobs_by_status` shows `pending` not `resolved`, and `no_open_pending_or_unknown` will NO-GO until a *further* reconciliation boot. Counts toward "3 reconciled" only if it reaches `action=resolved_*`.
- [ ] **DISARM first** (`QUEUE_ENABLED=false`) and let in-flight settle (VT 30s). A bot with an `unknown` trade Step-3.5-blocks its later signals (`ack:false`) → those show `read_ct>1`; that is the **intended block**, NOT the §8 double-execution stop condition.
- [ ] **Reconciliation restart — MUST boot with `QUEUE_ENABLED=false` (mandatory, not optional)** so the poll loop never races the resolver and no unacked message redelivers/re-executes during recovery. Boot → `boot_reconciliation_complete stuck_count:N` → `reconciliation_resolved …` per unknown. **MUST include ≥1 `resolved_status=filled action=resolved_filled`** (S4-3a filled-path). **MUST NOT** see any `createOrder`/order-placement/`trade_executed`/`reconciliation_job_orphaned`. Re-arm only after `reconciliation_resolve_complete` + a clean evidence snapshot.
- [ ] Verify DB: each unknown → correct terminal status; `reconciliation_jobs` resolved; audit rows appended. `sprint4:evidence` → `no_open_pending_or_unknown` true (every induced unknown reached a terminal status; a `left_open`/`left_pending_*` outcome means NOT reconciled — re-boot or investigate).
- [ ] **GATE before Phase C — arm = boot = reconciliation.** Every worker boot runs boot-reconciliation + the resolver BEFORE the queue opens, so the Phase-C arm is *itself* a reconciliation boot. Before arming for Phase C, confirm Phase B is **fully terminal**: `recon_jobs_by_status` has **0 `pending`**, `no_open_pending_or_unknown=true`, and the Phase-C arm boot logs `boot_reconciliation_complete stuck_count:0` (nothing left to act on). **If `stuck_count>0` on the Phase-C arm → STOP** (a non-terminal Phase-B trade would be reconciled by the Phase-C boot, mixing the two phases into one ambiguous log stream).

## 6. Phase C — 1 recovered bot-error · GATED
- [ ] **Precondition:** the bot chosen for the credential fault must have **no open trades and no `pending` reconciliation_job** (clean its lane first — see the §5 gate). Otherwise a reconciliation boot while the credential is `invalid` hits `left_pending_transient` (null adapter) or `job_failed_auth`, silently leaving a stuck trade through the "recovery".
- [ ] **Induce [DEFAULT — credential-invalid, NOT bot-deactivate]:** set one bot's credential `status='invalid'` → fire a signal. Expect a **fail-closed, OBSERVABLE** failure: `bot_misconfigured_credential` error log + **`bot.misconfigured` audit row** + `bots.status='error'`. **NOTE:** this path acks with **no `trades.failed` row and no DLQ** — the audit row + error log **IS** the artifact. **Do NOT use the deactivate-bot variant** — `bot_not_active` acks **silently** (no trade / DLQ / alert), itself a silent-failure DoD violation. Confirm the worker does NOT brand the credential row invalid on its own (only the bot → `error`).
- [ ] **Recover — BOTH:** restore the credential to `status='valid'` **AND** set the bot back to `status='active'` (an `error`/inactive bot still hits `bot_not_active` → silent ack). Fire a fresh signal → it **fills**. Capture the induce→recover→fill sequence.

## 7. Evidence to collect (E1 runtime + E2 platform)
> **`full_s4_2=GO` is necessary but NOT sufficient for the DoD.** GO covers only the auto-verifiable
> counts; the qualitative half is operator-signed manual gates. **The campaign PASSES only when
> `full_s4_2=GO` AND every manual gate below is signed off.**
- [ ] **Timing — FINAL snapshot only:** take it **>300s after the last induced unknown / reconciliation restart**, **AND** after the queue has drained (`queue_length=0`) with **no message in flight**. **Never evaluate `full_s4_2` mid-Phase-A** — a trade is briefly `pending` between INSERT and the status write (normal in-flight, not a failure). `full_s4_2` is a final-state gate.
- [ ] `sprint4:evidence` — `full_s4_2` auto-checks ALL true: `filled_ge_50`, `symbols_ge_5`, **`distinct_filled_signals_ge_50`** (distinct signal_ids among FILLED trades — not all trades), `no_duplicate_signal_id`, `no_duplicate_exchange_order_id`, `dlq_clear`, `queue_failed_clear`, `stuck_clear`, **`no_open_pending_or_unknown`** (direct `pending==0 && unknown==0`).
- [ ] **Capture the fired signal_ids:** record the list of 50 `(symbol, signal_id)` pairs the simulator fired (campaign fills carry the simulator `signal_id`, NOT a RUN_ID) so the campaign is reproducible and the "50 distinct" claim is auditable independent of the live DB.
- [ ] **Manual gates (signed):**
  - **reconciled ≥3 THIS campaign** — compute from **worker boot logs** (count `reconciliation_resolved … action=resolved_*` lines tied to campaign trade_ids), NOT from the snapshot: `reconciliation_jobs.resolved` is cumulative, and `praxis_report_ro` is granted only the `status` column → it **cannot** time-window by `resolved_at`. Record the pre-campaign cumulative `resolved` count and the post count; require delta ≥3 **and** ≥3 `resolved_*` log lines for campaign trades.
  - **S4-3a filled-path** — ≥1 `reconciliation_resolved … resolved_status=filled action=resolved_filled` log line tied to a campaign trade + its DB end-state.
  - **recovered bot-error** sequence (§6).
  - **zero SILENT failures** — every failure has a DLQ/queue_failed/failed/alert/log artifact (cross-check vs §6's silent-ack traps).
- [ ] Audit chains per trade; **disarm proof** (`QUEUE_ENABLED=false`, `queue_length=0`).
- [ ] Result summary: RUN_ID, per-symbol fill counts, the fired signal_id list, the 3 reconciliations (incl. filled-path), the bot-error recovery, alert checkpoints.

## 8. Stop conditions (abort, disarm, leave clean)
- Any **duplicate trade** for one `signal_id` / `read_ct>1` double-execution → STOP.
- A **silent failure** (failure with no DLQ/queue_failed/failed/alert/log) → STOP (DoD violated).
- Any **`createOrder` from the resolver** / unexpected order placement → ABORT.
- `is_production=true` or any mainnet/real-money exposure → ABORT.
- `reconciliation_job_orphaned` → STOP, repair.
- Egress/auth anomaly (cf. WB6 451) → STOP, diagnose, loosen nothing.
- `queue_length=unavailable` at any checkpoint (can't verify queue) → STOP until re-verified.
- Runaway fills / queue not draining / unexpected stuck growth → DISARM + investigate.
- Any Doppler/Railway change beyond the gated arm/disarm + reconciliation restart, or any touch of **Migration 009** → forbidden.

## 9. Rollback / abort
- **Immediate disarm:** `QUEUE_ENABLED=false` → stops new execution; in-flight finishes/times out (VT 30s).
- Testnet **fills are real, retained as evidence** (like WB6/WB9) — not rolled back.
- Induced unknowns → resolved by reconciliation (forward recovery), not deletion.
- A **disarm-time** `unknown` (a signal caught mid-`createOrder` when disarming) is recoverable ONLY via a gated reconciliation restart (boot-only this sprint); if one occurs it counts as a **sanctioned** restart, not a §8 violation.
- Any **synthetic** seed rows (e.g. Unknown #2) → RUN_ID-scoped, transactional cleanup; delete child rows **(reconciliation_jobs, and trades_dlq if present)** BEFORE the trade (both FKs are `ON DELETE RESTRICT`); `audit_logs` has no FK → append-only, retained (do not clean).
- Post-abort: re-run `sprint4:evidence` → confirm `queue_length=0`, DLQ 0, stuck 0; report.

## 10. Open decisions (flagged defaults above — confirm/override before execution)
1. **Symbols + bots** (§1): the 5 symbols, per-symbol vs shared credential, balances. *(Bot creation = gated DB write.)*
2. **Injection methods** (§5/§6): the filled-left-unknown SIGKILL timing; Unknown #3 type; the bot-error method.
3. **Phasing**: single session vs split (Phase A now; B/C later).
4. **Alerting at checkpoints**: dry-run (default) vs live send to a dedicated chat.
5. **Reconciliation restarts**: count/timing (boot-only constraint).
