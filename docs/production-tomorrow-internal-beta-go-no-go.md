# Tomorrow — Internal Beta Go/No-Go (read-only / backtest-only)

> **DOC / DESIGN ONLY.** Answers whether tomorrow can be **GO for internal beta / read-only /
> backtest-only**. **GO can only ever mean that** — **NO real trading, NO mainnet orders, NO
> withdrawals, NO public user trading, NO TradingView live automation, NO reachable execution path;
> execution remains disarmed.** No DB/Doppler/Railway execution by this doc; safe-state values below are
> the ones verified earlier **today (2026-06-30)** in Phase 0 + the controlled-smoke disarm, and **MUST
> be re-confirmed by a read-only re-check immediately before the beta deploy** (§2).

## 0. Bottom line
**Recommendation: GO — internal beta / read-only / backtest-only**, conditioned on §2 deploy-time
re-check PASS and the StrateTeach-owned items in §4 being owned by StrateTeach (not Praxis). No
execution path is reachable via the beta (§5). **This GO does not approve real-money trading, mainnet
execution, withdrawals, public user trading, TradingView live automation, or StrateTeach execution
connection.**

---

## 1. Exact deploy scope
- **Included (Praxis side):** **nothing new** — no new Praxis frontend, no new endpoints, no migration.
  The Praxis worker stays at its last **disarmed** deployment.
- **Operator Console Slice 1: NOT included.** It is not built yet (it is the *next* step after this
  artifact); frontend is 0% (empty Vite scaffold). No Praxis operator UI ships tomorrow.
- **StrateTeach: NOT connected** to Praxis (T13 seam undecided). Any beta read-only/backtest experience
  is **StrateTeach-side and does not reach Praxis execution.**
- **Explicitly excluded:** any order placement, bot enable, queue arm, signal fire, mainnet, withdrawals,
  public user trading, TradingView live, StrateTeach→Praxis execution.

## 2. Safe-state proof (concrete; verified 2026-06-30, RE-CHECK before deploy)
Values from today's Phase 0 + controlled-smoke disarm (read-only, cited):
| Signal | Value | Source |
|---|---|---|
| `QUEUE_ENABLED` | **false** | Doppler flag read (Phase 0 §2c / disarm) |
| `enabled_bots` | **0** | `SELECT count(*) … trading_enabled=true` |
| per-bot `trading_enabled` (BTC/ETH/BNB/SOL/XRP) | **all false** | Phase 0 §2a + smoke Step 7 |
| `open_trades` (pending/submitted/unknown) | **0** | Phase 0 / Step 7 |
| DLQ (`trades_dlq`) | **0** | Phase 0 / Step 7 |
| `pending_reconciliation` (`status='pending'`) | **0** | Phase 0 / Step 7 |
| `queue_length` (`trade_signals`) | **0** | Phase 0 / Step 7 |
| worker armed/disarmed | **disarmed** — `worker_queue_disabled`, boot `stuck_count=0` | Railway (d), operator-verified |
| SELL | **fail-closed** (blocked in Step 4b, v1) | code + smoke |
| mainnet | **disabled / not reachable** — `PRAXIS_IS_PRODUCTION=false`, no mainnet credential exists (all creds `exchange_environment=testnet`) | env + migration 014 / A4 |

**Mandatory:** re-run the read-only safe-state check (the Phase 0 §2 queries + Doppler flag + Railway
deploy log) **immediately before** the beta deploy; **all must still read as above** or it is **NO-GO**.

## 3. Build / test evidence
- **Latest commit (origin/main):** `8cf10e4` (docs only). Last **code** change: `65d0d40` (SELL legacy
  path removed); worker test suite **402 passed**, `tsc` build clean, tools `tsc` clean at that point.
- **Tests run / build:** the worker is green at the last code change; **no new code is built or deployed
  tomorrow** (commits since are docs-only).
- **Lint/typecheck:** `npm run build` (tsc) + `npx tsc -p tools/tsconfig.json --noEmit` clean at `65d0d40`.
- **Deploy target:** Railway worker remains at its current disarmed build; **no Praxis frontend deploy**.
- **What is actually deployed tomorrow (Praxis):** nothing new — the existing disarmed worker. (Any beta
  UI/backtest is StrateTeach-side, outside Praxis.)

## 4. Backtest / read-only evidence
| Question | Answer |
|---|---|
| What data source is used? | **StrateTeach-owned — OPEN** (not a Praxis decision; readiness §B-S1). |
| Data licensing approved? | **OPEN — StrateTeach must confirm** (readiness §B-S1). Not assumed. |
| Any DB migration included tomorrow? | **No.** |
| Can any endpoint trigger execution? | **No** — worker disarmed (queue off); see §5. |
| Can any UI action arm trading? | **No** — no Praxis UI deployed (Slice 1 not built). |
| Can TradingView trigger execution? | **No** — not connected/live; and worker disarmed. |
| Can StrateTeach trigger execution? | **No** — not connected (T13 undecided); envelope-only contract + disarmed worker would block regardless. |

## 5. Endpoint / action reachability matrix
| Surface | type | place order? | enable bot? | arm queue? | fire signal? | auth | GO implication |
|---|---|---|---|---|---|---|---|
| Praxis Operator Console | **not deployed** | n/a | n/a | n/a | n/a | n/a | not a beta surface |
| Any Praxis frontend | **none (0%)** | n/a | n/a | n/a | n/a | n/a | nothing user-facing |
| Webhook Edge `/webhook/{bot_id}/{token}` | write (enqueue) | **No** (queue off + bots off → no execution) | No | No | enqueues only; **no order results while disarmed** | per-bot token (HMAC) | pre-existing ingress, **not** a beta feature; cannot execute while disarmed; arming is Oren-gated/out-of-band |
| Worker poll loop | **disabled** (`QUEUE_ENABLED=false`) | No | No | No | No | service_role (server) | does not process signals |
| StrateTeach → Praxis | **not connected** | No | No | No | No | — | no path into execution |
| Doppler / Railway (arm) | operator/Oren only, out-of-band | — | — | the only way to arm | — | operator creds | NOT part of the beta; Oren-gated |

No deployed beta endpoint can place an order or reach the worker execution path while
`QUEUE_ENABLED=false` and all bots `trading_enabled=false`. The pre-existing webhook ingress can still
accept/enqueue authorized testnet signals if called with a valid token, but it is not part of the beta
surface, is not connected to StrateTeach/TradingView, and cannot produce orders while the worker queue
and bots remain disarmed. The only arming path (Doppler `QUEUE_ENABLED=true` + Railway redeploy + DB
enable) is operator/Oren-gated and out of scope.

## 6. Rollback plan
Tomorrow ships **no new Praxis surface**, so the primary "rollback" is keeping the disarmed state. If
anything must be halted:
- **Action (fastest, global):** `QUEUE_ENABLED=false` in Doppler + Railway redeploy (already the current
  state) — **owner: operator** — expected **≤ 5 min**.
- **Kill switch (DB):** `UPDATE public.bots SET trading_enabled=false WHERE trading_enabled=true;`
  (already 0 enabled) — **owner: operator** — seconds.
- **If a beta deploy is StrateTeach-side:** roll back / take down the StrateTeach beta surface —
  **owner: StrateTeach** (their deploy).
- **Verification after rollback (read-only, raw read-back):** `QUEUE_ENABLED=false`, `enabled_bots=0`,
  `queue_length=0`, worker `worker_queue_disabled` — confirmed by re-query (empty/filtered output is not
  evidence; per the smoke Step-6 lesson).

## 7. Go/No-Go recommendation
**GO — internal beta / read-only / backtest-only.** Basis: Praxis execution is **double-disarmed**
(`QUEUE_ENABLED=false` **and** all bots `trading_enabled=false`), **testnet-only with no mainnet
credential**, **no Praxis execution surface is deployed**, **StrateTeach is not connected**, and **no
execution path is reachable via the beta** (§5). SELL is fail-closed.

**Conditions of this GO:**
1. The §2 deploy-time read-only safe-state re-check **PASSES** (all values as listed); else **NO-GO**.
2. **StrateTeach owns and must separately confirm** the §4 OPEN items (data source + **licensing**,
   backtest validity, provenance, UI claims) for any market-data/backtest shown — **Praxis does not and
   cannot certify these**; they remain OPEN until StrateTeach confirms.
3. The beta surface introduces **no** link to the Praxis webhook/arming and **no** Praxis execution UI.

> **This GO does not approve real-money trading, mainnet execution, withdrawals, public user trading, TradingView live automation, or StrateTeach execution connection.**

**Automatic NO-GO triggers** (if any is true at deploy time):
- the §2 re-check fails: queue on, any bot enabled, non-zero open trades / dlq / pending recon, or worker armed;
- **any non-zero `queue_length` at the deploy-time re-check**;
- a mainnet credential exists or `PRAXIS_IS_PRODUCTION=true`;
- any deployed surface can reach an execution path;
- **any beta surface exposes or links to the webhook URL/token**;
- **any valid-token webhook fire is performed as part of the beta**;
- StrateTeach is connected to Praxis execution; or a Praxis order-capable UI ships.
