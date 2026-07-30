# ADR-002 — Praxis as the full multi-exchange execution engine (Phase 2A / EP0)

Status: Accepted (design). Supersedes the "Binance only, spot, buy-only, market-only" v1 scope.
Context: Praxis becomes the SOLE execution engine for StrateTeach (which is Binance+Bybit+OKX+
Kraken+KuCoin+Bitget+Gate+Coinbase, spot+futures/perp+leverage, market+limit+stop-loss+take-
profit+OCO, buy+sell+close). StrateTeach emits SIGNED signals only (Phase 2B); Praxis owns keys,
sizing, risk, kill, reconciliation, execution. Repos stay separate. Real-funds NO-GO throughout.

## Decisions

### D1 — ONE generic ccxt adapter, parameterized by exchange (not N hand-written adapters)
The supported set is 8 ccxt venues (`StrateTeach dashboard Exchange.tsx:98`). ccxt already gives a
uniform surface, so we generalize `BinanceAdapter` into a `CcxtAdapter` keyed by an `exchange` id
(ccxt exchange name). Per-exchange DIFFERENCES are isolated as small config/hooks:
- `marketRules` parsing (Binance filter-arrays vs Bybit v5 `instruments-info`/`lotSizeFilter`),
- sandbox/testnet support + URL (ccxt `setSandboxMode`; fail-closed if a venue has no sandbox and env=testnet),
- futures type mapping (`future` binance / `swap` others), symbol format (`BTC/USDT:USDT` perps),
- error-class coverage (ccxt normalizes most to its exception classes we already map).
Adding a venue later = config + a nock/testnet suite, not a new class.

### D2 — Exchange dimension + cross-exchange fail-closed gate
Add `exchange` to `bots` and `user_exchange_credentials`. Worker asserts, BEFORE decrypt/adapter
build, `bot.exchange == credential.exchange` (fail-closed) so a Binance key can never be used on a
Bybit adapter. DB composite FK/CHECK enforces at write time. Per-(user,bot) Vault isolation +
single-use (021/023) unchanged; keyed additionally by exchange.

### D3 — Order types: market + limit + stop-loss + take-profit + OCO (protective)
`OrderType` extends to `market | limit`; `OrderParams` gains optional protective legs
(`stopLossPrice`, `takeProfitPrice`) → placed as native stop/OCO where the venue supports it,
per-exchange OCO semantics behind the adapter. Fail-closed if a requested protective leg is
unsupported on a venue (reject, never place an unprotected order silently when protection asked).

### D4 — SELL / close / flatten
- SELL routes through the SAME kill/env/egress/sizing gates as BUY (today SELL is dropped before
  the adapter). Spot SELL sizes off free base balance (the exchange balance IS the position; no
  ledger needed). Exits are EXEMPT from the daily BUY notional cap (must always be able to exit)
  but idempotent via `UNIQUE(bot_id,signal_id)`. Per-bot `sell_enabled`, never global.
- FLATTEN (emergency close-all): operator-only + reason + audit + reduce-only + reads positions
  from the EXCHANGE as truth + per-credential scoped + single-flight. It deliberately does NOT gate
  on `trading_enabled` (must work AFTER a kill) — acceptable ONLY under those constraints. Through
  the adapter rails (never raw ccxt).

### D5 — Futures / perp
Extend the interface with leverage/margin/positions. MANDATORY before any futures order:
`setLeverage` per-order fail-closed (never inherit account leverage), **reduce-only** on all exits,
**isolated** margin (not cross), an enforced max-leverage cap, and risk caps recomputed on
**exposure/margin (notional×leverage)** — not raw notional. Futures uses its own testnet endpoint.
`computeSellQuantity` (spot free-base) is NOT reused for futures (position ≠ spot balance);
positions come from `fetchPositions`. Must not break the 5000ms-timeout / 30s-visibility budget —
extra `setLeverage`/`setMarginMode` round-trips are accounted for or the VT formula is revised.
Master-flag default-OFF + per-bot opt-in.

### D6 — Guard generalization (EP1 precondition — the "guard-first" blocker)
Before generalizing the money path, generalize the STATIC guards (else they silently pass a
mis-built adapter):
- Construction-site guard must scan EVERY `new *Adapter(` (not just `BinanceAdapter`) and require
  the egress args — or forbid `new *Adapter(` outside the factory and assert the factory threads them.
- ccxt-import allowlist stays EXACTLY enumerated (no `*Adapter.ts` glob → rubber stamp); each new
  adapter/validator added one-by-one; read-only tools proven mutation-free.
- Hoist the egress invariant + secret-zeroing `finally` + `setSandboxMode`-in-non-prod into a
  SHARED base no adapter can skip.
- Generalize BOTH factories: worker `index.ts` AND `reconciliation.ts` (second egress path).

### D8 — Sub-accounts: scoped BY THE KEY, not by a routing param (EP6)
Praxis already isolates one API key per (user, bot) in Vault (021/023). A venue sub-account is reached
by creating the API key UNDER that sub-account — so the credential IS the sub-account scope, and the
execution core needs NO sub-account routing field or logic: whatever sub-account the operator created
the key under is exactly where orders land. This keeps the blast radius of any one key to its own
sub-account. The alternative (a master key + a per-request sub-account/portfolio routing param) is
venue-specific, concentrates blast radius in one master key, and is deliberately NOT adopted; if a
future venue ever requires it, it is a thin per-venue ccxt option pass-through on the credential — not
a core change. EP6 therefore adds no sub-account code; it generalizes per-exchange credential
VALIDATION instead (see below).

### D9 — Per-exchange credential validation (EP6)
`validate-credential` (the read-only mainnet-key ops tool) is generalized to the credential's OWN venue:
auth is proven venue-agnostically via `fetchBalance`; key-permission introspection stays venue-specific
(Binance `sapiGetAccountApiRestrictions`). Venues without uniform ccxt permission introspection
FAIL-CLOSED to `restrictions_require_manual_verification` — auth is proven, but the tool never auto-OKs
a key whose withdrawals-off / IP-restriction it could not prove; the operator confirms those at the
exchange per the runbook. The tool remains strictly read-only (guard-enforced).

### D7 — withdraw stays OUT
Praxis never calls withdraw/transfer (defense-in-depth). StrateTeach's withdraw path is retired in
Phase 2B, never ported.

## Non-negotiable invariants (unchanged from Phase 1)
Fail-closed everywhere; per-exchange egress via the same static IPs (A4 allowlist extended per
venue); Vault-only keys, never browser; dormant/flag-gated; real-funds NO-GO until the go-live gates.

## Milestone order
EP1 (guard-gen + generic CcxtAdapter, Binance regression-identical) → EP2 (enable + validate the
other venues, per-exchange rules/sandbox/nock) ∥ EP3 (SELL) → protective orders → EP4 (futures) →
EP5 (flatten) → EP6 (sub-accounts + per-exchange nuances) → EP7 (multi-exchange reconciliation +
status + instrumentation). Each: implement → 3× audit → commit.
