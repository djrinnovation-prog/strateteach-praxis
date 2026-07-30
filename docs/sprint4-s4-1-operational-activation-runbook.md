# S4-1 — Operational Activation Runbook (scheduled poller + Telegram E1)

**Status:** DESIGN / DOC ONLY. Nothing in this runbook has been built, deployed, provisioned, or sent.
**Goal:** take S4-1 alerting from **implementation-complete** to **operationally live** — a scheduled poller that connects as `praxis_alert_ro`, evaluates the three alert signals, and delivers a **secret-safe** Telegram alert — proven by **one induced end-to-end alert (E1)**. Completing this closes S4-1.
**Gate:** every step that runs code against the live DB, provisions a secret, sends a real Telegram message, or deploys a scheduler requires **explicit operator approval at the moment of running**. The agent does **not** mutate the DB, create/handle secrets, send Telegram, or deploy. **Migration 009 frozen.**

---

## 0. Preconditions (what's ready / what's missing)
**Ready (built + applied + verified):**
- DB role `praxis_alert_ro` — migrations 011+012 **applied + verified** (E1+E2): SELECT-only, NOBYPASSRLS, no membership, RLS scoped; as-role verification PASS (webhook_logs queue_failed n=1; write/overreach incl. `bots` 42501; visible 0/1/0).
- Pure code (committed): `worker/tools/lib/readonly-sql.ts` (query templates), `worker/tools/alert-poller/criteria.ts` (`evaluatePoll`), `worker/tools/alert-poller/poller.ts` (`runPoll`, `SqlEvidenceSource` with **injected** `ReadonlyRunner`, `StateStore`/`InMemoryStateStore`), `worker/tools/alert-poller/telegram-sender.ts` (`sendAlerts`, `fetchTransport(config, fetchImpl)`).
- Worker dead-man heartbeat (signal 4) `worker/src/heartbeat.ts` — built, default OFF (separate activation; see §5 note).

**Missing (the activation gaps):**
1. A **real `ReadonlyRunner`** that connects to Postgres **as `praxis_alert_ro`** and executes the read-only queries (today the runner is an injected seam; no real one exists).
2. A **real `fetchTransport` fetch** (today `fetchImpl` is injected; tests use a fake).
3. An **entrypoint** wiring source → `runPoll` → `sendAlerts`, plus a **config loader** reading secrets from env.
4. A **scheduler/runtime** to run it on an interval.
5. **Provisioned secrets** (operator, out-of-band): `praxis_alert_ro` DSN + Telegram bot token + chat id.
6. A **de-dup/state strategy** compatible with a read-only role (it cannot persist watermarks to the DB).

---

## 1. Architecture (target data flow)
```
scheduler (cron)
  └─ poller entrypoint
       ├─ SqlEvidenceSource(realRunner as praxis_alert_ro)  --read-only SELECT-->  Supabase Postgres
       │      (readonly-sql templates; bound watermarks)
       ├─ evaluatePoll(evidence, state, ctx)   (pure; criteria engine)
       └─ sendAlerts(decisions, { transport: fetchTransport(config, realFetch) })  --HTTPS-->  api.telegram.org
  (signal 4 "worker not running" is covered separately by the worker's Healthchecks heartbeat, NOT this poller)
```
The poller only needs outbound to **Supabase Postgres** (read) and **api.telegram.org** (send) — no Binance, so the WB6 egress (HTTP 451) issue is irrelevant here.

---

## 2. Work breakdown — BUILD vs PROVISION vs PROVE
- **BUILD (separate gated CODE step, reviewed + committed):** §3 — real runner, real transport, entrypoint, config loader, tests. **Not done in this runbook.**
- **PROVISION (operator, out-of-band):** §6 — DSN + Telegram secrets into Doppler. Agent never sees them.
- **PROVE (gated E1):** §8 — fixture-first send, then a reversible real induction; capture the alert report.

---

## 3. Implementation needed (future gated code step — design only here)
All additions stay under `worker/tools/alert-poller/` (isolated from the trading build), with tests, DI-first:
- **`ReadonlyRunner` (real):** executes a vetted `ReadonlyQuery` with bound params against a `praxis_alert_ro` connection and returns rows. It MUST `assertReadOnly(query)` before executing (defense-in-depth, already done by `SqlEvidenceSource`). **Dependency decision (needs approval):** connecting as a custom Postgres role with a DSN requires a Postgres client — `@supabase/supabase-js` cannot do this (it speaks PostgREST as anon/service_role via JWT, not a raw role login). Options:
  - (a) add a minimal PG client dep (`pg` or `postgres`) **scoped to the poller tool** (not the trading `src/` build) — *new dependency, needs explicit approval given the "no new deps" stance*;
  - (b) run the poller as a **Supabase scheduled Edge Function (Deno)** using `deno-postgres`, importing the pure TS criteria/sender — no Node dep, but a different runtime;
  - (c) avoid a client entirely by shelling `psql` and piping rows to the TS evaluator — rejected (re-implements/forks parsing; fragile).
  - **Recommend (a) or (b); decide before building.**
- **Real `fetchTransport` fetch:** `fetchTransport(config, globalThis.fetch)` (Node 20 / Deno global). Config holds the bot token + chat id — only inside the transport closure (already the design).
- **Entrypoint** (`poller-main.ts` or an Edge handler): build ctx (`now`, `environment`, `deployId`), load state (§4), `runPoll`, then `sendAlerts(result.alerts, …)`; emit a **structured, secret-free** run summary (RUN_ID, per-signal decision, delivered/failed counts) — never the DSN/token/chat.
- **Config loader:** read `PRAXIS_ALERT_RO_DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` from env (injected by the scheduler/Doppler). Fail loud if any required var is missing; never log their values.

---

## 4. State / de-dup strategy (read-only role CANNOT write)
`praxis_alert_ro` has no write privilege, so it **cannot persist watermarks in the DB**. Align with the approved alerting-runbook §7 stance — **bounded query window + deterministic alert keys; never silently mark handled**:
- Each cycle queries a **bounded lookback window** (e.g. `created_at/received_at > now() - INTERVAL '<window>'`) rather than an open-ended watermark, so the poll is **stateless** w.r.t. the DB.
- Each alert carries a **deterministic key** (signal + table + bounded-window bucket + count/newest) so duplicates are *identifiable*, not silent.
- **Trade-off (must be acknowledged):** a still-present condition inside the window re-alerts each cycle (at-least-once, no false-negatives). Mitigate by: a modest window + interval, and — if dup volume is unacceptable — a **separate, minimal writable de-dup store that is NOT `praxis_alert_ro`** (e.g. the scheduler's own persistent KV/volume, or a dedicated tiny state row owned by a *different* writable role). **Do NOT grant `praxis_alert_ro` write access to add dedup state.**
- Decision to lock before build: window size, poll interval, and whether to add an external dedup store now or accept bounded duplicates for Phase-1.

---

## 5. Scheduler / runtime options (design choice)
- **Supabase scheduled Edge Function** (pg_cron / cron trigger, Deno) — co-located, `deno-postgres` to connect as `praxis_alert_ro`, secrets via Supabase function secrets. No Node dep. Ephemeral per run → state per §4.
- **Railway cron service** (Node) — reuses the existing TS, Doppler-injected env, persistent volume available if an external dedup store is wanted. New `pg` dep.
- **GitHub Actions scheduled workflow** (Node) — simplest infra, Doppler-injected secrets; fully ephemeral (no persistence → bounded-window only). New `pg` dep.
- **Recommendation:** decide alongside the §3 dependency decision. (Note: **signal 4** — "worker not running" — is delivered by the worker's own Healthchecks heartbeat set via `HEALTHCHECKS_URL`; activating that is a **separate** Doppler/worker step, out of scope here.)

---

## 6. Secrets & provisioning (operator, out-of-band — agent never sees them)
- **`PRAXIS_ALERT_RO_DATABASE_URL`** — the `praxis_alert_ro` DSN (host + role + password + `sslmode=require`). Built from the password provisioned during the 011 verification; stored in **Doppler** (or the scheduler's secret store). NEVER in code/git/chat.
- **`TELEGRAM_BOT_TOKEN`** + **`TELEGRAM_CHAT_ID`** — created via BotFather / the target alert chat; stored in **Doppler**. NEVER in code/git/chat.
- Injected as **env vars** at runtime by the scheduler/Doppler; the sender keeps token+chat only inside the `fetchTransport` closure; the DSN only inside the runner. **No secret is ever logged or returned.**
- Provisioning Doppler secrets is an **operator-gated environment change** (like the 011 password).

---

## 7. Connection path (as `praxis_alert_ro`)
- Connect with the DSN as `praxis_alert_ro`, `sslmode=require`, read-only. Direct connection username is `praxis_alert_ro`; via the Supavisor pooler it is `praxis_alert_ro.<project_ref>` (confirm which path the scheduler uses).
- `auth.uid()` is NULL on a direct role connection — the role is governed solely by the `alert_ro_*` policies (verified). Reads return only the alert-scoped rows.

---

## 8. Induced-alert E1 plan (gated; two phases)
**Phase 1 — fixture-first send (no prod data, proves the SEND PATH ONLY):**
- Wire a **`FixtureEvidenceSource`** with synthetic evidence (e.g. one DLQ `n=1` / queue_failed `n=1` / stuck `n=1`) → `runPoll` → `evaluatePoll` → `sendAlerts` with the **real** `fetchTransport` to the alert chat.
- **Expect:** exactly the right number of Telegram messages delivered to the alert chat; each message is **`k=v` safe text only**; logs contain **no** token / chat id / DSN. `SendOutcome` = `delivered`.
- **Scope (important):** Phase 1 proves **Telegram delivery / the send path + secret-safety ONLY**. It uses a fixture, so it does **NOT** exercise the `praxis_alert_ro` read path or the criteria engine over real evidence. **Phase 1 alone is NOT sufficient for S4-1 closure** — it is a prerequisite gate, not the closure proof. Full alerting E1 (and S4-1 closure) **REQUIRES Phase 2**.

**Phase 2 — real induction (gated, reversible — proves the FULL alerting E1; REQUIRED for S4-1 closure):**
- **RUN_ID namespace:** assign a scoped RUN_ID `S4-1-ACT-YYYYMMDD-HHMM` for the induction. Every seeded row MUST carry the RUN_ID in an **identifiable field where the schema allows it** (e.g. `webhook_logs.signal_id` / `trades_dlq.signal_id` — both TEXT), so the seed is unambiguously attributable and removable. If no field can carry the RUN_ID, do **not** seed that table — choose one that can.
- **Record baseline FIRST** (privileged read, before any seed): exact counts + ids for the target table(s) (e.g. `trades_dlq` count + ids; `webhook_logs` queue_failed count + ids). Save this as the cleanup reference.
- Operator **reversibly seeds one** real condition (privileged insert), e.g. a single `webhook_logs status='queue_failed'` row OR a `trades_dlq` row, **stamped with the RUN_ID** in its `signal_id`.
- Run the **real poller** (`SqlEvidenceSource` as `praxis_alert_ro`) once → confirm the alert fires from **real evidence read through the role** → Telegram delivered.
- **Cleanup (RUN_ID-scoped ONLY):** delete **only** rows matching the RUN_ID (`WHERE signal_id = '<RUN_ID>...'`) — **never** a broad/unscoped delete.
- **Verify return to baseline:** re-read the target table(s) and confirm counts + ids are **identical to the recorded pre-seed baseline**.
- **STOP if cleanup scope is ambiguous:** if the RUN_ID cannot be matched exactly, or the post-cleanup state does **not** equal the recorded baseline, **halt and report** — do **not** improvise a broad delete to "fix" it.
- This proves the full `praxis_alert_ro → criteria → Telegram` path end-to-end and is the **closure-gating** evidence (Phase 1 is not).

**Capture an S4-1 alert report (E1):** RUN_ID, signal(s), rendered payload (safe text), `delivered=true`, no-leak check (grep logs for token/chat/DSN → none), DB writes by poller = 0, seed removed.

---

## 9. Secret-safety checklist (every run)
- Sender hands the generic transport only `{ text }`; token+chat live only in `fetchTransport`; DSN only in the runner. ✅ by design.
- Rendered alert text is `buildSafeAlert`-validated `k=v` (forbidden-content scan) — unsafe payload fails loud before send.
- Structured logs only; **never** log DSN / token / chat / connection string / raw rows. Use `redactSecrets` if any caller-side string might contain a secret.
- Pasting evidence to chat: only counts / outcomes / `delivered` lines — never secrets.

---

## 10. Verification / evidence for S4-1 closure (E1)
1. Phase-1 fixture send → ≥1 alert delivered, safe text, no leak — **send-path proof ONLY; NOT sufficient for closure by itself.**
2. **Phase-2 real induction (REQUIRED for closure)** → alert fires from real evidence read as `praxis_alert_ro`; delivered; **RUN_ID-scoped seed removed; table(s) == recorded pre-seed baseline.**
3. Poller made **zero DB writes** (read-only role; verify no write attempts / 42501 in logs).
4. No secret in any log/output (token/chat/DSN absent).
5. Scheduler runs on its interval (a couple of clean cycles), no alert spam beyond the accepted bounded-window dup policy (§4).
6. S4-1 alert report captured; Kanban row → Done; Current Status / DECISIONS updated.

---

## 11. Stop conditions (abort, leave everything clean)
- Any **secret** (DSN / token / chat id) about to appear in code, git, logs, or chat.
- Any use of a **write-capable** DB role / `service_role` / **broad grants** / `BYPASSRLS` for the poller — the poller uses `praxis_alert_ro` **only**.
- Any **DB write** by the poller, or any write to add dedup state via `praxis_alert_ro`.
- **Alert spam** beyond the agreed bounded-window dup policy (back off; tighten window/dedup before continuing).
- A real Telegram send **before** the fixture-first phase passes, or **without** explicit approval.
- Treating **Phase 1 (fixture send) as sufficient** for S4-1 closure — it proves the send path only; closure requires Phase 2.
- **Phase-2 cleanup ambiguity:** the RUN_ID cannot be matched exactly, or the post-cleanup state **≠ recorded baseline** — halt; never broad-delete to "fix" it.
- Any scheduler deploy / Doppler / Railway change **without** explicit approval.
- Any unexpected runtime mutation outside the approved scope; any touch of **Migration 009** (frozen).

---

## 12. Rollback / cleanup
- Disable/pause the scheduler (no further runs).
- Remove any Phase-2 seed row; confirm DB baseline.
- If a secret was exposed at any point → **rotate it immediately** (new Telegram token via BotFather; new `praxis_alert_ro` password via §6/011 path) and purge from wherever it leaked.
- No persistent test data; the poller writes nothing, so there is nothing to clean DB-side beyond the seed.

---

## 13. Definition of Done (closes S4-1)
S4-1 is **CLOSED** when: §3 built + reviewed + committed; secrets provisioned out-of-band; **Phase-1 + Phase-2 induced alerts delivered E1** with zero leak and zero poller writes; scheduler running cleanly; alert report captured; Kanban/Current Status/DECISIONS updated. Until then, S4-1 stays **implementation-complete, operational activation pending** (current state).
