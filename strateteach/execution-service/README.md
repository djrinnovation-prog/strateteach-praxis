# execution-service — Phase 1 · slices 1-2 · DISARMED

Isolated crypto execution service, company-owned, built per
`StrateTeach-Phase1-Execution-Service-Spec.md`.

**Status: schema + signed ingress LIBRARY. This cannot trade.** There is no
queue, no worker, no exchange adapter, no vault client and no HTTP transport
yet. A valid signal becomes a ROW in `exec_signals` (status `noop_disarmed`
while the gate is off — which is always, in Phase 1) and goes nowhere. There
is no code path from anything here to an exchange, and no exchange API key is
handled, read, or stored anywhere in this directory.

Merged to `main` after owner review (slice 1 reviewed 2026-07-16); nothing
from this directory is deployed or imported by the app.

## What is here

| Path | What it is |
|---|---|
| `migrations/001_init.sql` | The full §2 schema. Money-critical DDL, written to be read. |
| `migrations/002_owner_only_grants.sql` | The §7 owner-only boundary as Postgres grants. |
| `exec_service/config.py` | Env-guard + master-gate flag. Fail-closed, testnet-pinned. |
| `exec_service/state.py` | Master gate + kill-switch **state**. No execution logic. |
| `exec_service/audit.py` | Append-only audit writer (+ secret scrubbing). |
| `exec_service/access.py` | Role boundary: operator sees the exec plane, not the owners' fund. |
| `exec_service/db.py` | Its own psycopg connection, its own `EXEC_DATABASE_URL`. |
| `exec_service/migrate.py` | Ordered .sql runner with checksums. |
| `exec_service/status.py` | `python -m exec_service.status` — prints the gate. Read-only. |
| `exec_service/envelope.py` | Slice 2 · the signed-signal CONTRACT (spec §3): envelope-only validation, HMAC-SHA256 (constant-time), freshness. Pure, no I/O. |
| `exec_service/ingress.py` | Slice 2 · verify → classify → RECORD into `exec_signals` (+ rate-limit + audit). Slice 3: an ACCEPTED signal (armed gate — never, in Phase 1) is also enqueued. |
| `migrations/004_queue.sql` + `exec_service/queue.py` | Slice 3 · durable queue: plain-Postgres SKIP LOCKED (same semantics as pgmq, zero new deps — §10.3 swap stays one module). enqueue idempotent · atomic claim · delayed retry · dead-letter · sweeper for stuck items. Transport only. |
| `exec_service/sizing.py` | Slice 4 · PURE sizing/caps decisions from bot config (per-order, daily, max positions). Violation = rejection, never a clamp. |
| `exec_service/worker.py` | Slice 4 · worker skeleton: gate re-checked at processing time → caps → adapter. NO default adapter (None refuses even when armed). One order per signal, ever (`client_order_id` UNIQUE). Bounded loop only — no daemon entry point. |
| `exec_service/mock_exchange.py` | Slice 4 · the ONLY adapter that exists: synthetic fills, zero network, zero keys, rows unmistakably `MOCK-…`. A real testnet adapter is a later, reviewed slice. |
| `exec_service/vault.py` | Slice 5 · the ONE ref→creds path. `resolve()` runs the env-guard then delegates to a backend: `MockVault` (tests only, placeholders) or `HashiCorpVault` (spec §10.2 recommendation, `hvac` lazy-imported). NO secret is entered, stored, logged, or audited here — only the ref. The worker resolves only for an adapter with `needs_credentials=True` (the mock has `False`). |
| `migrations/006_queue_held.sql` + queue `hold_all`/`release_held` | Slice 6 · kill-switch wiring: engage → queued items become `held` (dequeue skips them) + every bot `trading_enabled=false`; release → `held`→`queued` (does NOT arm). One act stops both sides. |
| `exec_service/reconcile.py` | Slice 6 · READ-ONLY requested↔executed check. Verdicts: ok / partial / overfill / missing_exec / no_op / stuck. Writes an audit summary + a line per drift. Never places, cancels, or amends an order. |
| `exec_service/owner_fund.py` | Slice 7 · OWNER-ONLY shared-fund ledger → ownership % → NAV. A RECORD only — moves no money, runs nothing. |
| `exec_service/approvals_flow.py` | Slice 7 · 3-of-3 flow on the fund: request → 3 DISTINCT owners approve → `approved` (RECORDED). Phase 1 never advances to `executed`; no call into worker/queue/adapter. DB CHECK (003) backstops distinctness. |
| `exec_service/adapters/ccxt_testnet.py` | Slice 8 · the ONLY execution code — a ccxt spot adapter **pinned to a testnet sandbox** (`set_sandbox_mode(True)` then VERIFIED; mainnet refused; ccxt injected for tests). Reaches an exchange ONLY when the owners have loaded keys + armed the gate. The agent has NOT run it against a real venue and holds no key. |
| `tests/` | The invariants below, as tests. |

## Isolation

Its own directory, own package name (`strateteach-execution-service`), own
`pyproject.toml`, own dependency list (Postgres only — no `ccxt`, no HTTP
client), own database URL. It imports nothing from `python-backend/app`, and
the existing backend imports nothing from it. Nothing routes to it. Lifting it
into its own repo/deploy (spec §10.1) is a `git mv`.

Same stack as the rest of the shop (Python 3.11 + psycopg 3 + Postgres) so it
stays reviewable by the same people.

## The safety invariants, and where they are enforced

| Invariant | Enforced by |
|---|---|
| `EXECUTION_ARMED=false` by default | `config.py` — default False; **only** the exact string `"true"` arms it. `"1"`, `"yes"`, `"TRUE!"` all read false. |
| Arming is not one switch | `state.read_gate()` — armed requires env flag **AND** `exec_state.execution_armed` **AND** kill-switch released **AND** testnet. |
| Fail-closed | Missing row, unreachable DB, invalid config, env/db mismatch → DISARMED, with a reason. Tested. |
| `ENVIRONMENT=testnet`, mainnet blocked | `config.py` raises `EnvGuardError` at load **and** every `env` column has a `phase1_testnet` CHECK. |
| No key material anywhere | `exec_credentials` has no secret column; `vault_ref` has a CHECK that only accepts a short `vault://`/`kms://` pointer; audit scrubs secret-shaped keys; a test greps the package for key vars. |
| Audit is append-only | Trigger in `001_init.sql` rejects UPDATE/DELETE/TRUNCATE. |
| Dedup | `UNIQUE(bot_id, signal_id)` on `exec_signals`. |
| Envelope-only | Sizing lives in `exec_bots` (config). No signal table column carries quantity or a free symbol. |
| 3-of-3 on the owners' fund | CHECK on `owner_approvals`: cannot reach `approved`/`executed` with fewer than 3 approvals **from 3 DISTINCT owners** (003 strengthens 001 — same owner ×3 does not count). |
| Owner-fund is blocked from the operator | `access.py` (code) + `002_owner_only_grants.sql` (database). |
| Execution code lives ONLY under `adapters/` | `tests/test_no_execution_code.py` fails the build on any exchange import/order call/HTTP client/key var ANYWHERE except the sanctioned `adapters/` boundary (which has its own safety tests in `test_ccxt_adapter.py`). |
| Envelope-only, enforced | `envelope.py` rejects any payload carrying quantity/symbol/account/key-shaped fields BY NAME, and any unknown field. |
| Signed or nothing | HMAC-SHA256 over a canonical message, `hmac.compare_digest` (constant-time). No secret configured → ingress rejects everything. The secret is a WEBHOOK-signing secret (env, per-call, never logged) — not an exchange key. |
| Freshness + dedup + rate-limit | stale/future `ts` → expired; `UNIQUE(bot_id, signal_id)` dedups at the DB; per-bot rolling rate-limit. |

## Running it

```bash
cd execution-service
cp .env.example .env            # EXECUTION_ARMED=false · ENVIRONMENT=testnet
export EXEC_DATABASE_URL=postgresql://…   # its own database, not the app's
python -m exec_service.migrate --status   # what would be applied
python -m exec_service.migrate            # apply
python -m exec_service.status             # prints: EFFECTIVE GATE : DISARMED
pytest                                    # invariants
```

`pytest` needs no database — the gate tests assert the fail-closed path by
pointing at a dead one.

## Known gaps (deliberate, tracked, not hidden)

1. **`002` grants may no-op.** On a managed Postgres where the migration user
   cannot create roles, the grants NOTICE and skip; the owner-only boundary
   then rests on `access.py` alone. Close this — a real role, a real grant —
   before any real key or real money exists.
2. **The audit trigger is not superuser-proof.** A superuser can disable it.
   Off-box log shipping belongs in the go-live plan; it is not here.
3. **Vault choice is open** (spec §10.2). `exec_credentials.vault_backend`
   defaults to `'undecided'` and the CHECK lists the candidates. No vault
   client is written until the owners decide.
4. **Queue choice is open** (spec §10.3, pgmq recommended). Slice 3.
5. **No pool, no service process.** Neither has a caller yet; both arrive with
   the worker (slice 4).

## What must NOT happen to this branch

Do not merge, do not deploy, do not set `EXECUTION_ARMED=true`, do not put a
real key anywhere near it. Arming, go-live, and key entry are explicit owner
actions under the 3-of-3 gate (spec §0.5, §8.4) — not a config edit and not an
agent's call.

## Next slices (spec §9)

2. ~~Signal ingress + HMAC contract + dedup/freshness (no worker)~~ ✓ (library; HTTP transport arrives with deployment)
3. ~~Durable queue + sweeper~~ ✓ (plain-Postgres SKIP LOCKED; pgmq stays a one-module swap if the owners prefer)
4. ~~Worker skeleton + sizing/caps + env-guard (testnet mock, no real keys)~~ ✓ (adapter is injected, mock-only; verified armed-simulation on a throwaway DB only)
5. ~~Vault ref → worker~~ ✓ CLIENT built (HashiCorp recommendation, §10.2), exercised with MockVault + placeholders only. **The owners enter the real testnet keys into the vault out-of-band — never this service, never the agent.** No real vault, no real key touched in this slice.
6. ~~Kill-switch wiring + reconciliation~~ ✓ (engage holds the queue + halts bots; release restores without arming; reconcile is read-only drift detection)
7. ~~Owner-fund ledger + 3-of-3 flow~~ ✓ (ledger→ownership%→NAV; unanimous-of-3-distinct decision RECORDED, never executed in Phase 1)
8. **In progress** · testnet smoke → campaign. 8a ✓ real ccxt testnet adapter (sandbox forced+verified, mainnet refused, injected ccxt in tests — NOT run against a real venue, no key held). 8b (owner acts): owners load testnet keys into the vault + arm the gate + run a real testnet smoke. Those are §8 go-live gates — owner-only.
8. testnet smoke → campaign (§8 gates)
