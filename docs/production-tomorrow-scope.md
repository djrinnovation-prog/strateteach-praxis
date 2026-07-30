# Tomorrow — Explicit Scope

> **DOC / DESIGN ONLY.** Defines what is in/out of scope for the next working block, and the binding
> Praxis ⇄ StrateTeach owner split. No execution, no DB/Doppler/Railway, no arm/fire, no mainnet/real
> funds is authorized here. Companion: [StrateTeach readiness questions](production-strateteach-readiness-questions.md),
> [Operator Console MVP](production-operator-console-mvp-design.md).

## Owner split (binding)
- **Praxis owns:** execution · risk · audit · credentials · orders. The only component that touches the
  exchange or moves money.
- **StrateTeach owns:** strategy concepts · backtest · input · signal ideas (+ market-data, licensing,
  provenance, UI claims).
- **StrateTeach must NOT:** hold exchange keys / `service_role` / Vault secrets / DB write · **hold
  webhook tokens in browser/client code** (if it posts directly, tokens are server-side only, per-bot,
  rotatable, audited) · decide quantity · bypass Praxis risk controls · use any path other than the
  governed webhook.
- **Open until StrateTeach confirms:** market-data sourcing/licensing, backtest validity, signal
  provenance, UI/marketing claims (see readiness §B). These stay OPEN — not assumed.

## In scope (next block)
1. **StrateTeach production-readiness Q&A** — Praxis-owned answered; StrateTeach-owned marked OPEN
   ([doc](production-strateteach-readiness-questions.md)).
2. **This scope doc + a DECISIONS entry** — owner split + boundaries + open unknowns recorded.
3. **Operator Console MVP — Slice 1 (status read path) only**, when we proceed to code: `operator_status`
   RPC + `worker_status` table + read-only status panel + tests. **No mutations in Slice 1.** Each slice
   is gated + Codex-reviewed before code.

## Explicitly OUT of scope (tomorrow)
- ❌ Mainnet / real funds (gated on A1/A2/A4/A5/A10/A11 + A11 written approval).
- ❌ Queue arm (`QUEUE_ENABLED=true`) / un-pause / any **fire** — Oren-gated, out-of-band.
- ❌ §6b multi-bot enable / broader arming.
- ❌ TradingView live or any real signal-source connection.
- ❌ **StrateTeach connection** (even testnet) — T13 seam not decided; readiness §B open.
- ❌ Operator Console mutating slices (disable/disarm/enable/pause) — those are later slices, after
  Slice 1 + review.

## Standing state (unchanged)
`QUEUE_ENABLED=false` · all 5 bots `trading_enabled=false` · SELL fail-closed · migration 014 applied ·
Migration 009 frozen · config-ready, **NOT armed**. A3 testnet smoke CLOSED/MET; real-funds-ready = **NO**.

## Stop conditions
- Nothing here authorizes execution, arming, mainnet, real funds, or a StrateTeach/TradingView
  connection.
- StrateTeach-owned unknowns (readiness §B) and the T13 seam (§C) must be resolved before any connection
  or real funds — independent of Praxis-side readiness.
