# Oren Go/No-Go Brief — Praxis (2026-06-30)

> **One decision is requested** (see §6). This is a briefing, not an execution. Nothing has been
> armed; the system is fail-closed and disarmed. Full detail: [go-live gap list](production-go-live-gap-list.md),
> [checklist + rollback](production-go-live-checklist-and-rollback.md), [readiness review](production-readiness-gap-review.md).

## 1. Where we are (one line per tier)
- **Testnet-ready** ✅ — Sprint 4: 50 real testnet fills, reconciliation + bot-error recovery (`full_s4_2=GO`).
- **Config-ready** ✅ — sizing/risk code merged; migration 014 applied; 5 bots configured (fixed $20/order, $25 per-order cap, $100/day cap, SELL off, **kill switch OFF**), testnet.
- **Controlled-smoke-ready** ⏳ — a one-bot/one-order testnet smoke is *packaged but NOT yet run*.
- **Production-real-funds-ready** ❌ — **NO.** Multiple MUST gates open (§4).

Standing safety: `QUEUE_ENABLED=false`, all 5 bots `trading_enabled=false`, SELL fail-closed,
Migration 009 frozen. The system cannot place an order in its current state.

## 2. What tomorrow CAN be
- **Phase 0** — a go/no-go review (read-only), and
- **Phase 1 (optional, your call)** — one **testnet** controlled smoke: enable **one** bot, open the
  queue briefly, fire **one** signal, observe a single ~$20 **testnet** order, then immediately disarm.

## 3. What tomorrow is NOT
- **Not** mainnet. **Not** real funds. **Not** a TradingView live connection. **Not** multi-user.
- The testnet smoke proves the live order *path* on testnet only; it does **not** open mainnet.

## 4. Why real funds are blocked (MUST gates still open)
| Gate | Open item |
|---|---|
| A1 | Production egress — static/allowlist-grade IP + verified mainnet Binance reachability |
| A2 | Migration 009 security hardening (frozen) + migration-history reconcile |
| A3 | Live sizing/risk smoke not yet run (testnet) |
| A4 | Credential isolation — 5 bots still share one testnet key; no per-user/bot prod model |
| A5 | Webhook/TradingView hardening (rotation, replay/rate-limit, source validation) |
| A10 | Rollback / kill-switch **drill** not yet rehearsed |
| A11 | **Your written real-funds authorization + capital ceiling** — not on record |
| A8 | A trusted, drilled kill path (CLI/SQL acceptable for v1) |

Each closes only on cited runtime (E1) / platform (E2) evidence. **All must close before any real money.**

## 5. Risk posture of the testnet smoke (if you approve Phase 1)
- **Money at risk: none** (Binance **testnet**, play funds).
- **Blast radius: one bot, one ~$20 testnet order**, a narrow armed window, **immediate disarm
  regardless of outcome** (queue off + kill switch back on).
- **Reversible:** four independent rollback levers, each halts the path (queue off / kill switch /
  token rotate / disable credential).
- **Outcome semantics:** PASS = one filled testnet order sized from config; a fail-closed
  `order.blocked` is a SAFE STOP (proves the guardrails) — **not** a pass; either way we disarm.

## 6. The decision requested
Choose one:
- **A. Approve a testnet controlled-smoke window tomorrow** (Phase 0 + Phase 1), operator-run,
  attended. *Approving this authorizes **testnet only — NOT mainnet, NOT real funds.*** If chosen,
  execution follows [the controlled smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md)
  **exactly**: pre-arm verify → enable one bot → queue arm → fire **one** BTC **testnet** signal →
  observe → **immediate disarm** → final evidence. A blocked outcome or any failure is a **SAFE STOP**
  (disarm + investigate), **not** a PASS.
- **B. Defer the smoke** — keep closing MUST gates first; no runtime tomorrow.
- **C. Approve Phase 0 review only** — decide on the smoke after the review.

Separately, **real-funds authorization (A11) is NOT being requested in this brief** — it comes only
after all MUST gates close **and** the controlled smoke passes, as its own written decision with a
capital ceiling. Choosing A does **not** imply A11.

## 7. Stop conditions (hold regardless of approval)
- No mainnet / real funds without **all** MUST gates closed (E1/E2) **and** explicit written A11 approval.
- No `QUEUE_ENABLED=true` / no bot enable outside the approved window; revert immediately after.
- No TradingView live until A5/A7 evidence; simulator only.
- Any anomaly or secret exposure → disarm first, then the incident/rotation runbook (A6).

## 8. Recommendation
Proceed with **Phase 0** in all cases. **Phase 1 (testnet smoke) is low-risk and high-information**
(it converts "config-ready" into proven "the live order path works on testnet") — recommended **if**
you want that evidence before investing in the MUST-gate work. **Mainnet/real funds remain firmly
gated** behind the §4 list + your written approval, independent of the smoke result.
