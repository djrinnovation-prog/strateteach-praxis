# Audit v3 — Remediation Record + Execution Packets

**Source:** `Praxis_Security_Audit_v3.docx` (13 Jul 2026) — 1 Critical, 6 High, 16 Medium, 17 Low, 5 Info.
**This document:** what was fixed locally (with tests), what is deferred as a reviewed packet, the
gated migration apply runbook, and the H-6 rotation/scrub checklist. **No commits, no deploys, no linked
DB writes, no secrets, no mainnet were performed.** Real funds remain **NO-GO**.

---

## 1. Fixed locally + tested (this pass)

| ID | Sev | Fix | Files | Tests |
|----|-----|-----|-------|-------|
| H-1 | High | Step 3.5 blocks on stale `pending` too (not only `unknown`) via a time-cutoff `.or()` | worker/src/index.ts | index.test.ts (H-1 filter assertion) |
| H-3 | High | Reject non-finite qty: `parseMarketRules` throws on bad stepSize/minQty/minNotional (not cached); `computeBuyQuantity` `!isFinite` guard; `roundDownToStep` step>0 guard | worker/src/{BinanceAdapter,sizingRisk}.ts | +6 tests |
| H-4 | High | `clientIpFromHeaders` — prefer `x-real-ip`, else RIGHT-most XFF hop; never left-most | _shared/rate-limit.ts, webhook/index.ts | +5 rate-limit tests |
| H-5 | High | OrderNotFound-after-timeout → `unknown` + reconciliation_job (not terminal `failed`) | worker/src/index.ts | index.test.ts (Case B rewritten) |
| M-1 | Med | admin-rotate per-bot authz: `getBot` returns owner; non-owner needs explicit `operator_override`, audited `rotate_cross_owner` | admin-rotate/{rotate,index}.ts | +2 deno tests |
| M-6 | Med | `finalizeTerminal` persists exchange_order_id/price/executed_notional/filled_at; inline Case A adds executed_notional | worker/src/reconciliation.ts, index.ts | reconciliation.test.ts (M-6 assertions) |
| M-9 | Med | Dropped SELL exit signal → distinct `order.exit_signal_dropped` audit + error log (not generic `order.blocked`) | worker/src/index.ts | index.test.ts (2 SELL tests) |
| M-10 | Med | `isReadOnlySelect` rejects INTO / FOR UPDATE / set_config / multi-statement; `assertReadOnly` checks real FROM; comment de-overclaimed | worker/tools/lib/readonly-sql.ts | +tests (31 pass) |
| M-13 | Med | config: password ≥12 + complexity, email confirmation on, TOTP MFA available | supabase/config.toml | n/a (config) |
| M-14 | Med | config: `ssl_enforcement` on; network_restrictions documented (IPs deferred to dashboard, H-6) | supabase/config.toml | n/a |
| M-15 | Med | Pin ccxt/@supabase-js/pg/nanoid (worker) + @supabase-js (frontend) exact-to-lock | worker+frontend package.json | n/a |
| M-16 | Med | VT worst-case comment corrected (5×5s exchange calls); default 30→45s | worker/src/index.ts | full suite |
| L-2 | Low | Magnitude-scaled rounding epsilon (no genuine sub-step bump-up) | worker/src/sizingRisk.ts | +2 tests |
| L-3 | Low | webhook: require application/json, cap body 16 KiB, cap signal_id 128 | webhook/index.ts | deno check |
| L-5 | Low | AlertRoConfig DSN → `#dsn` true-private field | worker/tools/alert-poller/pg-readonly-runner.ts | +test (36 pass) |
| L-7 | Low | safe-payload length+entropy heuristic for opaque secrets | worker/tools/lib/safe-payload.ts | +tests (50 pass) |
| L-8 | Low | `sqlQuoteLiteral` escaping in restore-draft harness | frontend/src/lib/harness.ts | +tests (38 pass) |
| L-9 | Low | admin-rotate constant-time secret compare via fixed-length SHA-256 (no length/UTF-16 leak) | admin-rotate/rotate.ts | deno tests |
| L-17 | Low | fire script: ids via required env (scrubbed), token-URL via stdin `--config -` not argv | scripts/wb6-e1-fire.sh | bash -n + preflight |
| I-1 | Info | admin-rotate dry_run/commit return fingerprints ONLY unless explicit `reveal:true` (audited) | admin-rotate/rotate.ts | +deno test |

## 2. Migration files written (GATED — NOT applied, NOT tracked)

Follow the established discipline: apply **LOCAL** (`supabase db reset`) for validation → **LINKED** only on
explicit operator approval + read-back → then record in `schema_migrations`. Apply **surgically**
(`db query --linked --file`), **never** `db push`. Each file is `begin/commit` with pre-guard + post-verify.

- **026** — C-1: `guard_credential_vault_pointer_owner` trigger (a vault_secret_id can never be tied to >1
  user) + partial unique index on live `vault_secret_id`. Closes the DB side of the cross-user pointer.
- **027** — M-2: `bots.operator_locked` + guard trigger (owner can't re-enable while locked) + operator-only
  `operator_set_bot_lock` RPC. **Follow-up:** wire `operator_kill_all` (019) to set `operator_locked=true`.
- **028** — M-11 (profiles column guard: subscription_status/affiliate_code/referred_by) + L-4 (soft-delete
  `deleted_at IS NULL` in bots/credentials UPDATE USING) + L-15 (`bot_events_select`/`audit_logs_select`
  scoped `TO authenticated`) + L-6 (`webhook_rate_bump`/`claim_webhook_requeue` → service_role + search_path='').
- **029** — H-2: `insert_pending_trade_atomic` RPC — advisory-lock + cap re-check + insert in one txn.

> **Local validation still required** before Codex/apply: run `supabase db reset` to confirm 026–029 apply
> cleanly on top of 001..025, then author `supabase/tests/*.sql` assertions. Not run here (kept off the
> linked DB; local reset deferred to the review step).

## 3. Deferred packets (worker changes — need the migration live and/or carry high test-churn)

### H-2 worker wiring (after 029 is live)
Replace the Step 7 plain `trades` INSERT with `supabase.rpc('insert_pending_trade_atomic', {...})`. Keep the
JS `enforceRiskLimits` as a fast pre-gate. Map the RPC's `rejected_reason`:
`per_order_max_notional`/`daily_notional_cap` → `onSizingError` (ack, `order.blocked`, no order);
`duplicate_signal` → ack (dedup); null reason → proceed with returned `trade_id`. Update index.test.ts (the
insert chain becomes an rpc call). **Do not wire until 029 is applied** (worker would call a missing RPC).

### M-3 — re-read kill switch before createOrder
Immediately before `adapter.createOrder`, re-read `bots.trading_enabled/status` (or make the pending INSERT
conditional on them) and abort if flipped. High test-churn: adds a DB call to every BUY happy-path, shifting
the position-ordered mocks across ~40 tests. Recommend as its own slice with a mock-harness helper update.

### M-4 — returned `unknown`/`failed`/`cancelled` on the success (non-throw) path
`unknown` already creates a reconciliation_job (done). Extend the Step 9 success branch so a returned
`failed`/`cancelled` status is treated like `ExchangeRejectedError` (DLQ insert + `consecutive_failures++` +
breaker), instead of a silent terminal write. Moderate success-path test-churn.

### M-5 — executed vs estimated notional
Caps enforce requested notional (config × pre-trade price), not executed (fill). Options: marketable-limit /
`quoteOrderQty` cap so the exchange enforces the ceiling, or a slippage buffer; reconcile `executed_notional`
back into the daily-cap basis. Needs a product decision on order type.

### M-7 — `unknown` blocks a bot indefinitely
Ship the runtime reconciliation loop (or paginate/raise `RECONCILIATION_RESOLVE_CAP`) + a max-redelivery
cutoff that dead-letters/alerts a persistently blocked message. Boot-only resolve ≤10 is the current cap.

### M-8 — claim-then-send enqueue (webhook dedup path)
Move the reenqueue to claim-then-send: `UPDATE ... SET status='queued' WHERE status IN (...) RETURNING`, send
only if the CAS claimed the row; increment `requeue_attempts`. (Partially mitigated by the 4C leased sweeper +
worker `UNIQUE(bot_id,signal_id)` idempotency; this tightens the webhook path itself.)

### Low residuals (localised)
- **L-1** atomic `consecutive_failures = consecutive_failures + 1 ... RETURNING` (SQL) — breaker lost-updates.
- **L-10** default the IP gate fail-CLOSED on rate-store error in non-live tiers, or make testnet fail-open a
  deliberate + alarmed choice.
- **L-11** constant-work HMAC verify against a dummy hash when the bot is absent (existence timing oracle).
- **L-12** sliding-window / token-bucket counter (fixed 60s window allows ~2× burst).
- **L-13** distinguish `VaultUnavailableError` (creds never fetched → transient ack, no `unknown`) from a
  true post-dispatch timeout.
- **L-16** provision a distinct credential per campaign bot (`sql/s4-2-provision-campaign-bots.sql`), never
  re-enable sharing after the 023 backfill.
- **M-12** migration process: wrap 016 in begin/commit + idempotent DDL; reconcile 010–025 tracking; resolve
  009. (Process/runbook item — no single code change.)

## 4. H-6 / L-14 — leaked-identifier scrub + rotation checklist (ROTATION = operator action)

Committed identifiers are only truly neutralised by **rotation**; scrubbing the historical evidence docs is a
mechanical follow-up best done as one reviewed batch (kept intact here to preserve the audit trail).

**Occurrences (this snapshot):** project ref `eraxuxidsiolyvfefcez` — 11 docs; vault pointer `2b5c038a…781b`
— 22 files; a live bot UUID `2dcaddba…` — 22 files; operator IP `87.71.21.23` — 1 doc; operator email — 2 docs.
`scripts/wb6-e1-fire.sh` is already scrubbed (ids now env-only).

**Operator (Oren) actions before mainnet:**
1. **Rotate every per-bot webhook token** (via the owner-gated G-TVR once deployed, or the operator
   `admin-rotate` fallback). All five bot tokens; treat any doc-exposed token as burned.
2. **Rotate the leaked Vault pointer** (`2b5c038a…`) — re-store the secret so the pointer changes; the leaked
   pointer must no longer resolve. (C-1 migration 026 blocks cross-user reuse regardless.)
3. **Treat operator IP `87.71.21.23` as burned** — do not re-allowlist it; use a fresh one for M-14.
4. **Enforce MFA on the operator account** (email is leaked; M-13).
5. **git-history secret scan** (gitleaks/trufflehog) over full history; rotate anything found (I-5).
6. **Mechanical doc scrub** (on approval): replace the identifiers above with placeholders across the mapped
   files. Ready to run as a follow-up; not done here to avoid rewriting historical evidence unreviewed.

## 5. Recommended commit split (all UNCOMMITTED; Codex-review first)

1. `H-3 + L-2: reject non-finite order quantity + magnitude-scaled rounding` — sizingRisk.ts, BinanceAdapter.ts (+tests)
2. `H-1: block on stale pending trades` — worker/src/index.ts (+test)
3. `H-5: reconcile timed-out OrderNotFound instead of terminal failed` — worker/src/index.ts (+tests)
4. `M-6: persist fill data on reconciled/ inline-resolved trades` — reconciliation.ts, index.ts (+tests)
5. `M-9: surface dropped SELL exit signals` — worker/src/index.ts (+tests)
6. `M-16: correct VT worst-case + raise default to 45s` — worker/src/index.ts
7. `H-4 + L-3: trusted client IP + webhook payload bounds` — rate-limit.ts, webhook/index.ts (+tests)
8. `M-1 + L-9 + I-1: admin-rotate per-bot authz + constant-time secret + reveal-gated hashes` — admin-rotate/* (+tests)
9. `M-10: strengthen read-only SQL guard` — worker/tools/lib/readonly-sql.ts (+tests)
10. `L-5: DSN private field` · `L-7: payload entropy scan` · `L-8: harness SQL escaping` — three small commits
11. `M-13/M-14/M-15: auth+network+SSL config hardening + pin deps` — config.toml, package.json ×2
12. `L-17: harden testnet fire script (env ids + stdin transport)` — scripts/wb6-e1-fire.sh
13. `migrations 026–029 (C-1/M-2/M-11/L-4/L-6/L-15/H-2) — GATED, not applied` — separate, apply-later
14. `docs: audit v3 remediation record + packets`

(Keep the pre-existing uncommitted G-TVR + UI-3a + 4c-closeout out of these — they are separate prior work.)

## 6. GO / NO-GO for real funds

**NO-GO.** C-1 (Critical) requires migration 026 applied + the leaked pointer/tokens rotated (operator). The
High tier is code-fixed (H-1/H-3/H-4/H-5) but H-2 needs 029 applied + worker wiring, and H-6 needs rotation.
Pre-existing blockers stand: A1 key-allowlist (A4), tiny-live (A11), and the config live-dashboard verification
(M-13/M-14). No mainnet funds should move until C-1 + H-tier + those gates close.
