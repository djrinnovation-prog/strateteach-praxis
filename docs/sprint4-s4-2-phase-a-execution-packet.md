# S4-2 — Phase A Execution Packet (50-fill campaign + reconciliation + bot-error)

**Status:** DESIGN / GATED. Nothing armed, fired, seeded, restarted, or written. Every
arm / fire / DB-write / restart below is a **GATED** step requiring explicit operator (Oren)
approval *at the moment*. Testnet only (`is_production=false`), **NOT LIVE**. **Migration 009
frozen.** `QUEUE_ENABLED=false` until explicit Oren approval. Companion (rationale):
`docs/sprint4-s4-2-campaign-checklist.md`. Evidence: `npm run sprint4:evidence` (migration 013
role) at each checkpoint.

This packet operationalises the campaign checklist for one concrete run. Pre-arm gates G0–G5
are already GREEN (containment complete; both BUY-sizing/diagnostic fixes on origin; a prior
armed pipeline smoke filled BTC + XRP end-to-end and was disarmed).

## Bots / tokens / credential
| symbol | bot_id | token (Doppler) |
|---|---|---|
| BTCUSDT | `2dcaddba-b62d-47e1-87a7-7f7b759f38d2` | `PRAXIS_WB5_TEST_BOT_WEBHOOK_TOKEN` |
| ETHUSDT | `c8913354-8b7e-4d8d-8b3d-fb8b8f8248df` | `PRAXIS_CAMPAIGN_ETHUSDT_WEBHOOK_TOKEN` |
| BNBUSDT | `36b46eb3-9384-4e05-a79b-1246e9b85119` | `PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN` |
| SOLUSDT | `5acc84c9-edd2-4c9f-87dd-fd928f8b62cd` | `PRAXIS_CAMPAIGN_SOLUSDT_WEBHOOK_TOKEN` |
| XRPUSDT | `297dddb9-965b-49ff-abd8-e3e8e88fa4fc` | `PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN` |

Shared testnet credential `2b5c038a-a4a7-4be5-b2fe-90d32f67781b` (vault_secret_id `6b012052`).
Webhook base: `https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook`.

## 0. RUN_ID
`RUN_ID=S42A-<YYYYMMDD-HHMM>` (UTC, operator-stamped, one per attempt). **Every** campaign
signal_id = `${RUN_ID}-${SYMBOL}-${NN}` (and the synthetic recon/bot-error rows below also carry
`${RUN_ID}-…`). The campaign count is scoped by `signal_id LIKE '${RUN_ID}-%'` so **prior smoke
trades (S4A-SMOKE/S4A-PIPE) and the legacy BTC fills are NOT counted.**

## 1. Pre-arm verification (read-only — confirm ALL before ARM)
- `npm run sprint4:evidence` → `phase0_ready=GO`, `queue_length=0`, DLQ/queue_failed/stuck=0, no
  dups. **Record current `filled_total`** (global baseline).
- Boot log (current deploy): `visibility_timeout_s:30`. **STOP if lower.**
- **Record pre-campaign cumulative reconciliation counts** (for the §7 delta — `resolved_at` is
  not queryable by the read-only role, so a delta + log lines are the proof):
```bash
printf "SELECT status, count(*) FROM public.reconciliation_jobs GROUP BY status;\n" > /tmp/q.sql
supabase db query --linked --file /tmp/q.sql; rm -f /tmp/q.sql
```

## 2. ARM (GATED)
```bash
doppler secrets set QUEUE_ENABLED=true -p praxis-platform -c dev >/dev/null 2>&1; echo "armed exit=$?"
```
→ Railway **Redeploy** → confirm boot: `queue_enabled:true · is_production:false ·
doppler_environment:dev · queue_preflight_ok · worker_running`.

## 3. Phase A — fire 50 (10 × 5 symbols, paced, RUN_ID-scoped) — GATED

Load the fire helper + tokens once:
```bash
RUN_ID="S42A-REPLACE"   # ← stamp the real value
BASE="https://eraxuxidsiolyvfefcez.supabase.co/functions/v1/webhook"
T_BTC=$(doppler secrets get PRAXIS_WB5_TEST_BOT_WEBHOOK_TOKEN --plain -p praxis-platform -c dev)
T_ETH=$(doppler secrets get PRAXIS_CAMPAIGN_ETHUSDT_WEBHOOK_TOKEN --plain -p praxis-platform -c dev)
T_BNB=$(doppler secrets get PRAXIS_CAMPAIGN_BNBUSDT_WEBHOOK_TOKEN --plain -p praxis-platform -c dev)
T_SOL=$(doppler secrets get PRAXIS_CAMPAIGN_SOLUSDT_WEBHOOK_TOKEN --plain -p praxis-platform -c dev)
T_XRP=$(doppler secrets get PRAXIS_CAMPAIGN_XRPUSDT_WEBHOOK_TOKEN --plain -p praxis-platform -c dev)
fire(){ # sym bot_id token nn
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/$2/$3" \
    -H 'content-type: application/json' --data-binary "{\"signal_id\":\"${RUN_ID}-$1-$4\",\"action\":\"buy\"}")
  printf '%s %s-%s-%s http=%s\n' "$1" "$RUN_ID" "$1" "$4" "$code"; }
fire_round(){ # nn
  fire BTCUSDT 2dcaddba-b62d-47e1-87a7-7f7b759f38d2 "$T_BTC" "$1"
  fire ETHUSDT c8913354-8b7e-4d8d-8b3d-fb8b8f8248df "$T_ETH" "$1"
  fire BNBUSDT 36b46eb3-9384-4e05-a79b-1246e9b85119 "$T_BNB" "$1"
  fire SOLUSDT 5acc84c9-edd2-4c9f-87dd-fd928f8b62cd "$T_SOL" "$1"
  fire XRPUSDT 297dddb9-965b-49ff-abd8-e3e8e88fa4fc "$T_XRP" "$1"; }
```

### Batch 0 — 1 per symbol (5 fires), then STOP and verify before the rest
```bash
fire_round 01
```
Wait ~30s, then verify the Batch-0 gate (scoped to `-01`):
```bash
printf "SELECT count(*) FILTER (WHERE status='filled') AS filled,
 count(*) FILTER (WHERE status IN ('failed','unknown')) AS bad, count(*) AS total,
 (SELECT public.pgmq_queue_length('trade_signals')) AS q
 FROM public.trades WHERE signal_id LIKE '${RUN_ID}-%-01' AND deleted_at IS NULL;\n" > /tmp/q.sql
supabase db query --linked --file /tmp/q.sql; rm -f /tmp/q.sql
```
**Batch-0 gate — ALL required, else STOP/DISARM/investigate:**
- `filled = 5` (5/5), `bad = 0` (no failed/unknown for RUN_ID), `total = 5`, `q = 0`.
- `npm run sprint4:evidence` → no DLQ / queue_failed / stuck.
- **Only then continue to the remaining 45.** (Catches a per-symbol problem after 1 fire, not 10.)

### Remaining 45 — rounds 02–10, paced
```bash
for n in 02 03 04 05 06 07 08 09 10; do fire_round "$n"; sleep 20; done
unset T_BTC T_ETH T_BNB T_SOL T_XRP
```
All fires `http=200`. **DURING checkpoint** (every 2–3 rounds, read-only) — confirm drain + zero faults:
```bash
printf "SELECT (SELECT public.pgmq_queue_length('trade_signals')) AS q,
 count(*) FILTER (WHERE status='filled') AS filled,
 count(*) FILTER (WHERE status IN ('failed','unknown')) AS bad, count(*) AS total
 FROM public.trades WHERE signal_id LIKE '${RUN_ID}-%' AND deleted_at IS NULL;\n" > /tmp/q.sql
supabase db query --linked --file /tmp/q.sql; rm -f /tmp/q.sql
```
**STOP if:** any `http≠200` · queue not draining / growing · any DLQ/queue_failed/stuck · `read_ct>1`
(duplicate execution) · `queue_length=unavailable` · any `bad>0` trend.

## 4. End of Phase A → DISARM, then Phase B/C as SEPARATE gated phases
```bash
doppler secrets set QUEUE_ENABLED=false -p praxis-platform -c dev >/dev/null 2>&1; echo "disarmed exit=$?"
```
→ Railway Redeploy → confirm `worker_queue_disabled`, `queue_length=0`. Let in-flight settle (VT 30s).

> **After Phase A, DISARM and verify queue_length=0. Phase B and Phase C are separate gated
> phases. Each phase requires explicit operator go, its own deploy/redeploy, and its own
> post-phase disarm/verify.** Reconciliation is boot-only this sprint; a worker boot runs
> boot-reconciliation BEFORE the queue opens, so never re-fire immediately after a reconciliation
> boot without re-gating.

## 5. Phase B — 3 reconciled unknowns (BOOT-ONLY reconciliation) — SEPARATE GATED PHASE
Explicit operator go + its own reconciliation redeploy + its own post-phase disarm/verify.
All synthetic rows are `${RUN_ID}-…`-scoped.

> **Evidence label (record verbatim in the result summary):**
> - **Synthetic reconciliation induction.**
> - **Validates resolver behavior, not organic crash timing.**
> - **S4-3a filled-path can close on resolver correctness, but not on natural SIGKILL fidelity.**
>
> (The checklist §5 prefers a natural `kill -9` between fill and the status write — higher fidelity
> but impractical to time on Railway. The induction below is deterministic and exercises the same
> resolver path; Oren chooses which.)

**Induce (queue stays DISARMED):**
1. **Unknown #1 + #3 — filled-path (S4-3a):** flip 2 already-filled campaign trades to `unknown`
   (they keep their real `client_order_id`/`exchange_order_id`) + recon jobs:
```sql
WITH picks AS (
  SELECT id FROM public.trades
  WHERE signal_id LIKE '<RUN_ID>-%' AND status='filled' AND deleted_at IS NULL
  ORDER BY created_at LIMIT 2)
UPDATE public.trades SET status='unknown' WHERE id IN (SELECT id FROM picks)
RETURNING id, signal_id, client_order_id;     -- expect 2
INSERT INTO public.reconciliation_jobs (trade_id)
  SELECT id FROM public.trades WHERE signal_id LIKE '<RUN_ID>-%' AND status='unknown'
  ON CONFLICT DO NOTHING;
```
2. **Unknown #2 — failed-path:** seed an `unknown` trade with a NON-EXISTENT client_order_id →
   resolver `fetchOrder` → OrderNotFound → `failed`:
```sql
INSERT INTO public.trades (bot_id, signal_id, client_order_id, trading_pair, status)
VALUES ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','<RUN_ID>-RECON-FAILED','PRX_NX<RUN_ID>','BTCUSDT','unknown')
RETURNING id;
INSERT INTO public.reconciliation_jobs (trade_id)
  SELECT id FROM public.trades WHERE signal_id='<RUN_ID>-RECON-FAILED';
```
3. **Reconciliation boot — MUST boot with `QUEUE_ENABLED=false`** (already disarmed): Railway
   **Redeploy** → boot-reconciliation runs before the queue opens. Confirm logs:
   - `boot_reconciliation_complete stuck_count:3` → `reconciliation_resolved …` for all 3,
     **including ≥1 `action=resolved_filled`** (filled-path) and 1 resolving to `failed`.
   - **MUST NOT** see any `createOrder` / `trade_executed` / `reconciliation_job_orphaned`.
4. Verify DB: all 3 reach terminal (2 filled, 1 failed); `reconciliation_jobs` resolved;
   `sprint4:evidence` → `no_open_pending_or_unknown=true`.
5. **Post-phase:** confirm still `QUEUE_ENABLED=false`, `queue_length=0` before any next phase.

## 6. Phase C — 1 recovered bot-error (credential-invalid) — SEPARATE GATED PHASE, LAST
Explicit operator go + its own arm/disarm. **Shared-credential blast radius:** `2b5c038a` is shared
by all 5 bots → marking it `invalid` affects all 5. Do this **last**, isolated, firing only the
one error-test signal.

**HARD PRECONDITION (read-only) — both counts MUST be 0 before invalidating the shared credential:**
```bash
printf "SELECT count(*) AS open_trades FROM public.trades WHERE status IN ('pending','unknown') AND deleted_at IS NULL;
SELECT count(*) AS pending_recon FROM public.reconciliation_jobs WHERE status='pending';\n" > /tmp/q.sql
supabase db query --linked --file /tmp/q.sql; rm -f /tmp/q.sql
```
**If either count > 0: STOP. Do not invalidate the shared credential.** (A reconciliation boot while
the credential is `invalid` hits `left_pending_transient` / `job_failed_auth` and silently leaves a
stuck trade through the "recovery".)

**Induce (credential-invalid — the approved method; NOT bot-deactivate, which acks silently):**
```sql
UPDATE public.user_exchange_credentials SET status='invalid'
WHERE id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
```
ARM → fire ONE signal to BTC (`${RUN_ID}-BOTERR`) → DISARM. Expect a **fail-closed, OBSERVABLE**
failure: `bot_misconfigured_credential` error log + **`bot.misconfigured` audit row** +
`bots.status='error'`. This path acks with **no `trades.failed` and no DLQ** — the audit row + error
log **IS** the artifact.

**Recover — BOTH (else `bot_not_active` → silent ack):**
```sql
UPDATE public.user_exchange_credentials SET status='valid'
WHERE id='2b5c038a-a4a7-4be5-b2fe-90d32f67781b';
UPDATE public.bots SET status='active', consecutive_failures=0
WHERE id='2dcaddba-b62d-47e1-87a7-7f7b759f38d2';
```
ARM → fire a fresh BTC signal → it **fills**. Capture the induce→recover→fill sequence. DISARM,
verify `queue_length=0`.

## 7. Final evidence (E1 runtime + E2 platform)
- **Timing:** FINAL snapshot **>300s after the last reconciliation/bot-error step**, **AND** after
  `queue_length=0` with no message in flight. **Never evaluate `full_s4_2` mid-phase.**
- `npm run sprint4:evidence` → `full_s4_2` all true: `filled_ge_50`, `symbols_ge_5`,
  `distinct_filled_signals_ge_50`, `no_duplicate_signal_id`, `no_duplicate_exchange_order_id`,
  `dlq_clear`, `queue_failed_clear`, `stuck_clear`, `no_open_pending_or_unknown`.
- **RUN_ID-scoped campaign count (authoritative for "the 50"):**
```bash
printf "SELECT trading_pair, count(*) FILTER (WHERE status='filled') AS filled
 FROM public.trades WHERE signal_id LIKE '${RUN_ID}-%' AND deleted_at IS NULL
 GROUP BY trading_pair ORDER BY trading_pair;
SELECT count(*) FILTER (WHERE status='filled') AS filled_total,
 count(DISTINCT trading_pair) FILTER (WHERE status='filled') AS symbols,
 count(DISTINCT signal_id) FILTER (WHERE status='filled') AS distinct_filled
 FROM public.trades WHERE signal_id LIKE '${RUN_ID}-%' AND deleted_at IS NULL;\n" > /tmp/q.sql
supabase db query --linked --file /tmp/q.sql; rm -f /tmp/q.sql
```
Expect 5 rows × 10 filled; `filled_total=50`, `symbols=5`, `distinct_filled=50`.
- **Manual gates (operator-signed):** reconciled ≥3 from **boot logs** (cumulative delta + ≥3
  `resolved_*` lines for campaign trades) · ≥1 `resolved_filled` (S4-3a filled-path) · the
  induce→recover→fill bot-error sequence · **zero SILENT failures** (every failure has a
  DLQ/queue_failed/failed/alert/log artifact) · disarm proof (`QUEUE_ENABLED=false`, `queue_length=0`).
- Result summary: RUN_ID, per-symbol fill counts, the 50 `(symbol, signal_id)` pairs, the 3
  reconciliations (with the synthetic-induction label above + the ≥1 filled-path), the bot-error
  recovery, alert checkpoints.

## 8. PASS / STOP
- **PASS** = RUN_ID-scoped 50 filled / 5 symbols / 50 distinct **AND** `full_s4_2=GO` **AND** every
  manual gate signed (3 reconciled incl. filled-path, bot-error recovered, zero silent). → S4-3a
  closes; ready for **S4-8** closure review (Oren).
- **STOP / ABORT:** duplicate trade / `read_ct>1` double-execution · silent failure · any
  `createOrder` from the resolver / unexpected order placement · `is_production=true` or any
  mainnet exposure · `reconciliation_job_orphaned` · egress/auth anomaly (cf. WB6 451) ·
  `queue_length=unavailable` · queue not draining / runaway fills · Phase-C hard-precondition
  counts > 0 · any Doppler/Railway change beyond the gated arm/disarm + reconciliation restart ·
  any touch of Migration 009.

## 9. Cleanup
Testnet **fills are real, retained as evidence** — not rolled back. Only the synthetic Unknown #2
seed (`<RUN_ID>-RECON-FAILED`): delete child rows BEFORE the trade (FKs `ON DELETE RESTRICT`) —
`reconciliation_jobs` then the `trades` row; `audit_logs` is append-only (retained). The 2 flipped
trades (filled→unknown→filled) return to `filled` — no cleanup. Post-cleanup: `sprint4:evidence` →
`queue_length=0`, DLQ 0, stuck 0.
