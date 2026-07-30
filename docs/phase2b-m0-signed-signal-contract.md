# Phase 2B · M0 — Signed-signal contract + ADR (Praxis = sole execution engine)

Status: **Design / contract of record.** No code, no cutover — M1+ implement against this. This document
is derived from and MUST stay consistent with the ALREADY-DEPLOYED webhook + body-signing (T4):
`supabase/functions/webhook/index.ts` and `supabase/functions/_shared/body-signing.ts`. Where this doc
and that code ever disagree, the code wins and this doc is a bug.

---

## ADR — Praxis is the sole execution engine; StrateTeach emits signed intent only

**Decision.** In the unified system, **Praxis is the ONLY component that touches an exchange or holds
exchange keys.** StrateTeach becomes a **signal source**: its scanner / AutoPilot / webhook-bot emit a
**signed INTENT** (buy/sell) to a Praxis webhook, and nothing more. Praxis owns keys (Vault), sizing,
risk caps, kill, reconciliation, and order placement.

**The boundary is one-way and hard:**
- StrateTeach → Praxis: a signed HTTP POST of intent. That is the only channel.
- Praxis → StrateTeach: nothing at execution time (StrateTeach may later READ status via Praxis RPCs —
  M5 — but that is read-only and cannot drive execution).
- After cutover (M3), StrateTeach's direct order-placement paths (`services/exchange.py` `place_order`,
  `autopilot_live.py`, the `close_*` helpers) are **dismantled**; StrateTeach holds **no** exchange keys
  and makes **no** exchange calls. Its `withdraw`/`transfer` paths are retired, never ported.

**Why.** One execution spine, one place where money moves, one set of safeguards (egress allowlist,
fail-closed gates, per-(user,bot) key isolation, kill, reconciliation, audit). StrateTeach cannot be
tricked or bugged into moving funds because it structurally cannot — it has no keys and no exchange
client. Repos stay **separate**; StrateTeach changes are patches against its baseline, shadow-mode first.

**Consequences.** StrateTeach must (a) map each of its signal sources to a Praxis bot, (b) hold a
per-bot signing key (never an exchange key), (c) send intent only — never symbol/qty/leverage/risk,
which Praxis resolves server-side from bot config. A losing position can no longer "ride the drawdown"
because an exit signal is dropped: exits are first-class (EP3), and the ratchet is closed by routing
BOTH entries and exits through Praxis.

---

## The contract (exact — matches the deployed webhook)

### Endpoint
```
POST /functions/v1/webhook/{bot_id}/{url_token}
```
- `{bot_id}` — the Praxis bot UUID (validated `UUID_RE`).
- `{url_token}` — the per-bot URL secret (first auth layer; hashed+peppered server-side, never logged).

### Body (JSON) — INTENT ONLY
```json
{ "signal_id": "<unique-per-bot string>", "action": "buy" | "sell", "timestamp": <epoch-s | epoch-ms | ISO-8601> }
```
- `signal_id` — **source-supplied, required** (reject-if-absent; no server UUID fallback). The
  idempotency key.
- `action` — **exactly** `"buy"` or `"sell"` (`sideFromAction`; anything else ⇒ reject). No other verbs.
- `timestamp` — freshness anchor; epoch seconds, epoch milliseconds, or ISO-8601.
- **NOT in the body — resolved server-side from bot config, never from the payload:** trading pair,
  quantity/notional, sizing mode, risk caps, leverage, protective legs, venue. The signal conveys
  *what to do* (enter/exit), never *how much / where / how risky*. `schema_version` is **stamped by the
  server** at enqueue (`"1.0"`), not read from the body.

### Signing (T4 — required when the bot has it enabled)
- Header: `X-Praxis-Signature: <lowercase-hex HMAC-SHA256(bodyKey, rawBody)>` (case-insensitive accepted).
  The signature covers the **raw request bytes**, including `signal_id` and `timestamp`, so no field can
  be altered and no fresh `signal_id` replayed without the key.
- `bodyKey = HMAC-SHA256(WEBHOOK_SECRET_PEPPER, "praxis.webhook.body-sign.v1|" + bot_id)`. The pepper is
  **Edge-only**; Praxis never exposes it. The operator derives the per-bot `bodyKey` (as hex) and hands
  THAT to the signing relay — see Provisioning.
- Freshness: `|now − timestamp| ≤ 300s` (`DEFAULT_FRESHNESS_WINDOW_MS`). Stale/absent/unparseable ⇒
  fail-closed reject.
- Verification is constant-time (`crypto.subtle.verify`). Per-bot flag
  `bots.webhook_body_signing_required` (operator-locked via the 034/036 field-lock). It is DORMANT by
  default and **usable only behind a signing relay** — vanilla TradingView cannot set headers or HMAC,
  so this is a StrateTeach-relay capability, exactly this integration's purpose.

### Idempotency & replay
- Dedup anchor: `webhook_logs` upsert on `(bot_id, signal_id)`; the worker additionally dedups on the
  `trades` `UNIQUE(bot_id, signal_id)`. A repeated `signal_id` for a bot is ack-and-skip, never a second
  order. The relay MUST use a **stable, unique** `signal_id` per logical signal and **reuse it on
  retry** (so a retried POST dedups instead of double-trading).
- Replay of the exact same signed payload is bounded by the 300s window and then absorbed by dedup.

### Responses (the relay MUST treat these correctly)
- **Uniform `200`** for every *authenticated/business* outcome (queued, duplicate, paused-bot, blocked)
  — deliberately no structure leak, so a caller cannot probe bot state. `200` ≠ "an order was placed";
  it means "accepted/handled." The relay must NOT infer execution from `200`.
- **`5xx`** for infra faults (queue send failed, config error) — retry-worthy (with the SAME `signal_id`).
- Per-IP, pre-auth rate limiting (H1a): a wrong-token flood can never touch a bot's budget; over-limit
  requests get a uniform `200` with no enqueue.

---

## Key & bot-mapping provisioning (operator, no secrets in this repo)

- **Signing key handoff:** the operator derives each bot's `bodyKey` hex (from the Edge-only pepper +
  `bot_id`, via the T4 derivation) and configures it in the StrateTeach relay as that source's signing
  secret. Praxis stores no relay copy; the pepper never leaves the Edge. Rotating the pepper re-keys all
  bodyKeys (a deliberate, gated operation).
- **Bot mapping (the N:M problem):** StrateTeach identifies signals by (username, symbol/strategy);
  Praxis executes per `bot_id`. Each StrateTeach signal source maps to **exactly one** Praxis
  `(bot_id, url_token, bodyKey)`. The operator provisions this mapping table on the relay side. Because
  Praxis resolves pair/size/risk from the bot's server-side config, the mapping is the ONLY place the
  "which bot" decision lives — the payload can never redirect it.

---

## Scope boundary of M0

M0 is the contract + ADR **only**. It introduces no code and changes no behavior. The pieces that build
against it, each its own gated milestone: **M1** Praxis ingress readiness (provision a relay-fed bot +
enable signing + the mapping/derivation tooling) · **M2** StrateTeach signal-adapter (shadow-mode) ·
**M3** dismantle StrateTeach's direct order paths (the hard cutover) · **M4** credential migration
(Fernet→Vault, operator-run) · **M5** unified status/kill in the StrateTeach UI via Praxis RPCs +
end-to-end timing across the boundary (extends EP7's `trade_timing`) · **M6** the comprehensive
**testnet** end-to-end run (StrateTeach signal → Praxis money-pipe → Binance testnet) · **M7** tiny-live
pilot. Real funds stay **NO-GO** until M6 passes and the go-live blockers (A1/A4/A11 + the recorded
T3c-style testnet money-path run) are closed.
