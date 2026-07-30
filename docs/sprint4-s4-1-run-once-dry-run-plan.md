# S4-1 — Run-once Dry-Run Execution Plan (alert poller)

**Status:** DOC + PACKAGING ONLY. Nothing here is executed in this slice. The dry-run command exists
but is **not run** — running it opens a real (read-only) DB connection as `praxis_alert_ro`, which is a
**separately-approved** step (operator provisions the DSN out-of-band). **No live run · no real DB
connection · no Telegram send · no scheduler deploy · no Doppler/Railway change · no arm/fire ·
Migration 009 frozen.** Companion to the activation runbook `docs/sprint4-s4-1-operational-activation-runbook.md`.

Entrypoint under test/packaging: `worker/tools/alert-poller/run-once.ts` (commit `c6d2610`), wiring
`PgReadonlyRunner` → `SqlEvidenceSource` → `runPoll`/`evaluatePoll` → dry-run render.

---

## 1. What the dry-run is (and is NOT)

- **IS:** one poll cycle that connects to the database **as `praxis_alert_ro` (SELECT-only)**, reads the
  three alert-evidence queries (DLQ / `queue_failed` / stuck trades), evaluates the de-dup criteria, and
  **renders** each alert as a secret-safe one-line string to stdout.
- **IS NOT:** a Telegram send. In this slice the CLI wires **no transport**, so nothing is ever sent. It
  is also **not fully offline** — it still makes a **read-only** DB connection to fetch evidence. For a
  no-DB smoke check, use the unit tests (`run-once.test.ts`), which inject a fake runner.

The CLI runs in **`dry-run` mode by default** (`PRAXIS_ALERT_SEND_MODE` unset → `dry-run`). With no
transport wired, even an explicit `PRAXIS_ALERT_SEND_MODE=send` would **fail loud** ("send mode requires
an injected transport") rather than send — by design, live send is a later, separately-gated slice.

## 2. npm scripts (packaging)

```
# worker/package.json (run from the worker/ directory)
npm run alert:run-once     # ts-node ... run-once.ts — respects PRAXIS_ALERT_SEND_MODE (default dry-run)
npm run alert:dry-run      # forces PRAXIS_ALERT_SEND_MODE=dry-run, then runs alert:run-once
```

`alert:dry-run` **explicitly forces `PRAXIS_ALERT_SEND_MODE=dry-run`** — it cannot inherit a `send` value
from the environment — while `alert:run-once` **respects the env / default** (`dry-run` when unset).
Neither is run here; running either requires the env below — in particular a real `PRAXIS_ALERT_RO_DSN`,
which is provisioned out-of-band by the operator under a separate approval. (Even in `send` mode the CLI
wires no transport and fails loud rather than sending — but `alert:dry-run` removes that path entirely.)

## 3. Environment (names only — values are never committed or logged)

| Env var | Required | Secret | Meaning / default |
|---|---|---|---|
| `PRAXIS_ALERT_RO_DSN` | yes | **secret** | Postgres DSN; user **must** be `praxis_alert_ro` (least-privilege, SELECT-only). service_role/superuser DSNs are refused. |
| `PRAXIS_ALERT_SEND_MODE` | no | no | `dry-run` (default) \| `send`. Dry-run never sends. `send` without a wired transport fails loud (no transport exists this slice). |
| `PRAXIS_ALERT_ENVIRONMENT` | no | no | Non-secret label stamped on alerts; default `dev`. |
| `PRAXIS_ALERT_DEPLOY_ID` | no | no | Non-secret deploy label (e.g. Railway deploy id); optional. |
| `PRAXIS_ALERT_STUCK_THRESHOLD_SECONDS` | no | no | Stuck-trade threshold; default `300`. Positive integer. |
| `PRAXIS_ALERT_TELEGRAM_BOT_TOKEN` | no (dry-run) | **secret** | Read **only** at the send boundary (`loadTelegramConfig`), unused in dry-run. Never retained on config; only a `telegramConfigured` boolean is exposed. |
| `PRAXIS_ALERT_TELEGRAM_CHAT_ID` | no (dry-run) | **sensitive** | As above. |

Config errors name the env var + expected shape **only** — they never echo the supplied value (so a
secret pasted into the wrong var cannot leak to stderr/logs).

## 4. Expected output (dry-run)

One secret-safe summary line, then one line per fired alert. Example (host redacted; illustrative):

```
[alert-poller:run-once] db=postgresql://praxis_alert_ro:***@<host>:5432/praxis · sendMode=dry-run · environment=dev · deployId=(none) · thresholdSeconds=300 · telegramConfigured=false · committed=true · alerts=1 · signals=[dlq]
[alert-poller:run-once] alert environment=dev · timestamp=<iso> · event=dlq_alert · table=trades_dlq · count=2 · newest=<iso>
```

- `committed=true` means the de-dup state was persisted for this process (in-memory store this slice; a
  file-backed store is a later slice — across separate runs, de-dup does not yet carry over).
- Zero alerts → `alerts=0 · signals=[]` and no alert lines.
- The DSN line shows the **redacted** descriptor only (`:***@`), never the password.

## 5. No-live-send guarantees (enforced in code, not by convention)

- **No execution on import** — the CLI runs only under `require.main === module`.
- **No connection unless invoked** — only `runOnce()` calls `runner.connect()`.
- **No built-in network** — there is no default fetch/transport; dry-run never calls a transport; `send`
  without an injected transport fails loud.
- **Read-only DB only** — `praxis_alert_ro` (SELECT-only) + per-session `default_transaction_read_only`
  + per-query `assertReadOnly`. No service_role, no write SQL.
- **Secret redaction** — DSN/token/chat id never logged; only redacted descriptors + safe rendered lines.

## 6. Stop conditions (abort, change nothing)

- Any attempt to send to Telegram, wire a real transport, or set `PRAXIS_ALERT_SEND_MODE=send` → STOP
  (out of scope for dry-run; live send is a separate gated slice).
- The DSN user is anything other than `praxis_alert_ro`, or any write/permission is observed → STOP.
- Any secret value appears in stdout/stderr/logs → STOP, treat as a leak, do not proceed.
- Any Doppler/Railway change, scheduler deploy, restart, arm/fire, or touch of Migration 009 → forbidden.
- The dry-run is being run against production data without explicit approval → STOP.

## 7. Gating / what's next

- **This slice:** packaging (npm scripts) + this doc. **Not run.**
- **Separately approved next steps (not here):** (a) operator provisions `PRAXIS_ALERT_RO_DSN`
  out-of-band; (b) a gated dry-run against the read-only DB to capture real output; (c) the real Telegram
  `fetchTransport` wiring (live send) under explicit approval; (d) scheduler/deploy packaging. Closure of
  S4-1 still requires the RUN_ID-scoped induced end-to-end alert E1 per the activation runbook.
