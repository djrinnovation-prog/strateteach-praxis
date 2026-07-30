# StrateTeach ⇄ Praxis — Production-Readiness Questions (owner-split)

> **DOC / DESIGN ONLY — NO CODE / NO EXECUTION / NO CONNECTION.** This answers the **Praxis-owned**
> production-readiness questions (execution / risk / audit / kill-switch / credentials) and **lists the
> StrateTeach-owned questions as OPEN** — to be answered by StrateTeach, not assumed here. The hard
> boundary in [gap-review §C](production-readiness-gap-review.md) is binding: **StrateTeach must never
> hold exchange keys, `service_role`, Vault secrets, DB write, or webhook tokens in browser/client code;
> must never decide quantity or bypass Praxis risk controls; all execution flows through the gated
> webhook → pgmq → worker → audit → limits.** (Webhook tokens, if StrateTeach posts directly, are
> server-side only, per-bot, rotatable, audited — see §C J2.) No StrateTeach connection until the T13
> seam is decided in the Decision Log.

## Owner split (binding)
- **Praxis owns: execute · audit · limit · credentials · orders.** The only component that touches the
  exchange or moves money. Answers below are Praxis decisions on record.
- **StrateTeach owns: strategy concepts · backtest · input · signal ideas · market-data · licensing ·
  provenance · UI claims.** Those answers are **OPEN — StrateTeach must confirm**; we do not fill them
  with assumptions, and Praxis answers do not substitute for them.

---

## A. Praxis-owned — ANSWERED (on record)
| # | Question | Praxis answer | Basis / evidence |
|---|----------|---------------|------------------|
| P1 | Who places orders / touches the exchange? | **Praxis worker only.** StrateTeach never calls the exchange, never invokes `createOrder`, never decrypts Vault. | gap-review §C; worker `processMessage` |
| P2 | Who decides quantity / sizing? | **Praxis.** Quantity is computed server-side (`computeBuyQuantity` from bot config); **StrateTeach never sends quantity**. Symbol comes from `bots.trading_pair`, **never** the payload. | S5-A3/B4; smoke evidence (qty `0.00034` from config) |
| P3 | What risk controls apply, and can a signal bypass them? | **Server-enforced, signal cannot bypass:** per-order cap (`max_order_notional_usdt`), daily cap (`daily_notional_cap_usdt`), kill switch (`trading_enabled`), env guard (testnet/mainnet), config-readiness — all **fail-closed**. | S5-A3/B4 blocked-path audit; controlled smoke |
| P4 | Emergency stop / kill switch? | **Operator-controlled, StrateTeach cannot override:** `trading_enabled=false` (per-bot/all), DB-backed `trading_paused` (Operator Console MVP), `QUEUE_ENABLED=false`, credential disable. Rollback drill = A10. | go-live checklist; A10 packet |
| P5 | Audit trail? | **Praxis writes it** (`trades`, `order.blocked`, `trade.created→filled`, operator actions). StrateTeach has **no DB write**. | S5-A3/B4; Operator Console design |
| P6 | Credential custody? | **Vault-only**, Praxis-side. **StrateTeach holds no exchange keys, no `service_role`, no DB write.** | A4 packet; gap-review §C |
| P7 | What may StrateTeach send (the contract)? | **Envelope only:** `signal_id` (source-supplied, reject-if-absent), `action` (buy/sell), optional dedup/freshness (`fire_time`/`close`/`volume`). **No symbol, no quantity, no account, no keys.** | A5 packet §2; gap-review §C |
| P8 | Duplicate / replay handling? | **Dedup** via `UNIQUE(bot_id, signal_id)`; **freshness window** + **rate limits** are A5 decisions (pending) before connect. | A5 packet §5–§7 |
| P9 | Environment separation (testnet/mainnet)? | **`exchange_environment` per credential** + worker env guard; a demo/test path can never reach a mainnet credential. | A4/A12; migration 014 |
| P10 | What does Praxis enforce regardless of what StrateTeach sends? | A malformed / oversized / forbidden payload is **rejected or its forbidden fields ignored** (envelope-only); SELL is fail-closed in v1; all P3 limits apply. **The code is the guardrail; DB config is the policy.** | S5-A3/B4; A5 |

---

## B. StrateTeach-owned — OPEN (StrateTeach must confirm; NOT answered here)
These are **not** Praxis decisions and are **not** assumed. Each must be answered/evidenced by StrateTeach
before any production connection; Praxis enforcement (§A) does **not** make these moot.
| # | Open question (StrateTeach to answer) | Why it matters | Status |
|---|----------------------------------------|----------------|--------|
| S1 | **Market-data sourcing + licensing** — source(s), and licensed for this use/redistribution? | legal/operational exposure; not a Praxis call | **OPEN** |
| S2 | **Backtest methodology / validity** — no look-ahead; realistic fills/fees/slippage? | a misleading backtest drives bad live signals | **OPEN** |
| S3 | **Signal provenance / quality** — how signals are generated; reliability/track record? | governs whether signals are fit to trade real money | **OPEN** |
| S4 | **Strategy-generation correctness** — does idea→signal do what it claims? | StrateTeach governance is weak (Audit v1.1, unverified) | **OPEN** |
| S5 | **UI / marketing claims** — no guaranteed-returns / misleading claims; risk disclaimers present? | compliance/duty-of-care; reputational | **OPEN** |
| S6 | **User education / suitability / disclaimers** — risk disclosure to end users? | real money + retail users | **OPEN** |
| S7 | **Data retention / privacy (StrateTeach side)** | user data handling outside Praxis | **OPEN** |

---

## C. Joint / the T13 seam — DECISION REQUIRED before connect
| # | Item | Position / required |
|---|------|---------------------|
| J1 | **Integration contract (T13)** | Decided in the **Decision Log first**; transport = the governed webhook only; **no direct-execution path ever**. |
| J2 | **Webhook token handling at the seam** | **StrateTeach must NOT hold webhook tokens in browser/client code.** If StrateTeach ever posts signals directly, the per-bot token must be **server-side only, scoped per bot, rotatable, audited, and never exposed to users/UI** (hashed at rest; scheduled rotation A5/S4-6a). This is **separate from and additional to** the rule that StrateTeach never holds exchange keys / `service_role` / Vault secrets / DB write — the webhook token is a *signal-trigger* credential, still operator/server-custodied, never client-side. |
| J3 | **Source validation / rate limits** | Per A5 (allowlist *if* TradingView/StrateTeach source IPs are officially available, else compensating controls) + per-bot rate limit. |
| J4 | **Config authority** | Bots/credentials created/edited via **Praxis** (UI + RLS), **not** pushed by StrateTeach. |

---

## Rules for this document
- **Do not duplicate answers across owners**, and **do not close a StrateTeach-owned gap with a Praxis
  assumption.** OPEN means awaiting StrateTeach.
- Praxis enforcement (§A) bounds **blast radius** but does not validate StrateTeach's signal quality,
  licensing, or claims (§B) — both must hold before real funds.
- **No StrateTeach connection** (even on testnet) until §C T13 is decided and §B is addressed. This
  document authorizes nothing; it scopes the questions.
