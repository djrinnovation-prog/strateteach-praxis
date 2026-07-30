# Slice 4C — closeout status (interim)

**Status as of 2026-07-13.** 4C (pgmq no-silent-loss) is **implemented, schema-applied, and deployed on testnet**; two items remain, both **approval-gated**: (1) the live enqueue→`queued` fixture validation (blocked on a webhook token) and (2) enabling the sweeper (Action F). Real funds NO-GO.

## What is DONE
| Item | Evidence |
|---|---|
| Code | committed + pushed `732ebfb` (webhook state machine, `_shared/queue-recovery.ts`, migrations 024/025, `webhookRequeueSweeper.ts`, tests) |
| LOCAL validation | `db reset` 001..025 clean + `psql` SQL claim-RPC test PASSED; `node --test` queue-recovery 12/12; worker jest (sweeper 9 + dup-order 1); `deno check` clean |
| **A** apply 024 | linked: enum `webhook_log_status` has `queued` (read-back) |
| **B** track 024 | `schema_migrations` 024/`webhook_status_queued`; `migration list --linked` 024 Local+Remote |
| **C** apply 025 | linked: 3 recovery columns + `webhook_logs_recovery_idx` + `claim_webhook_requeue` present (read-back) |
| **D** track 025 | `schema_migrations` 025/`webhook_requeue_recovery`; **migration list Local==Remote / nothing pending** |
| **E** deploy webhook | Edge fn **v14 (2026-07-08) → v15 (2026-07-13 17:32)**; 4C webhook live |
| P0 pre-checks | repo has 024/025; `origin/main` ≥ 732ebfb; worker disarmed (`is_production=false`, `queue_enabled=false`, `worker_state=disabled`); sweeper flag **absent → OFF** (verified via Railway var filter) |
| Backup | pre-024 `pg_dump` at `~/praxis-db-backups/praxis-linked-pre024-20260713T171104Z.{schema,data}.sql` (no PITR — project is Free plan) |

## What REMAINS (both approval-gated)
1. **Live enqueue→`queued` fixture validation.** Blocked: firing the webhook needs the bot's **plaintext token**, which is missing (only the hash is stored; non-recoverable) → **token rotation** required first. Paths prepared:
   - **UI path (preferred long-term):** UI-3a `TradingViewConnect` built + tested (frontend-only, held for review); needs the reviewed owner-gated **G-TVR** Edge fn to actually rotate — not yet built/deployed.
   - **Operator fallback (ready now):** `production-webhook-token-rotation-checklist.md` (marked operator-fallback). You run it (enter your JWT + a fresh token via `admin-rotate-webhook-token`), then fire `scripts/wb6-e1-fire.sh 'FRESH_SIG'`; I read back `webhook_logs.status` → expect `queued`.
   - The **failure-path** (`queue_failed`) is not safely injectable on prod; it's covered by the LOCAL SQL/jest tests.
2. **Action F — enable the sweeper** (`WEBHOOK_REQUEUE_SWEEPER_ENABLED=true`, Doppler→Railway). Separate approval; worker already carries the code.

## Close condition
4C is fully "in force" after: F enabled + the enqueue→`queued` fixture validated (and the failure path accepted via local coverage). Until then: webhook 4C is live but the sweeper is inert and the live happy-path is un-fired. Hard real-funds precondition (audit CR-2), alongside A1 (done) / 4A (implemented, flag OFF) / A4 / A11.

## Boundaries
Nothing further executed. No sweeper enable, no token rotation, no fixture fired, no secrets/mainnet — all await explicit approval.

*Prepared for Codex review at Oren request. Testnet only; no real funds.*
