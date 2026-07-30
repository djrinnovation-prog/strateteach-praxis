# A5 Packet — Webhook + TradingView Hardening

> **DOC / DESIGN ONLY — NOT EXECUTION.** No Edge/DB/Doppler change · no token rotation · no
> TradingView live connection · no mainnet/real funds. Defines the signal contract, hardening
> decisions, evidence, and stop conditions before any real signal source is connected. Companion to
> the Strateteach⇄Praxis contract in [production-readiness-gap-review.md](production-readiness-gap-review.md) §C.

## 1. Current webhook model
- Endpoint: `POST /functions/v1/webhook/{bot_id}/{token}` (Supabase Edge).
- Auth: per-bot **token in the URL path**, **HMAC-verified** against the bot's stored hash
  (`WEBHOOK_SECRET_PEPPER`, Edge-only). Wrong/missing token → reject (`event=webhook_reject`).
- Flow: Edge validates → enqueues `{schema_version, bot_id, signal_id, side}` to **pgmq** → worker
  `processMessage`. Hybrid 200/5xx ingestion response; Praxis owns retries via pgmq.
- Idempotency: `trades` has `UNIQUE(bot_id, signal_id)` → a duplicate `signal_id` is server-deduped
  (`duplicate_signal_race`, ack, **no second trade**).
- Gaps: **no source IP allowlist**, **no rate limiting**, **manual** token rotation, **no explicit
  replay-freshness** check, real source = **simulator only** (`scripts/*-fire.sh`).

## 2. TradingView signal contract (the ONLY inbound path)
- **Allowed payload (signal envelope only):** `signal_id` (source-supplied, **reject-if-absent**, no
  UUID fallback), `action` ∈ {buy, sell}, optional dedup/freshness fields (`fire_time` / `close` /
  `volume`). `schema_version`.
- **Symbol comes from `bots.trading_pair`, NEVER from the payload.** **Quantity is computed by Praxis
  (sizing), NEVER sent by TradingView.** Account/credential/limits are never in the payload.
- **SELL:** currently fail-closed server-side (v1 sell off) regardless of `action=sell`.
- A payload carrying symbol/quantity/account/keys is **rejected/ignored** for those fields — the
  contract is envelope-only.

## 3. What TradingView must NEVER receive (response hygiene)
The webhook is **inbound-only**. TradingView sends a signal and gets a **minimal** ack — nothing more.
The Edge response must **never** contain:
- exchange API keys / secrets, `WEBHOOK_SECRET_PEPPER`, the bot token;
- `service_role` / any DB key / JWT;
- DB rows, Vault pointers, `vault_secret_id`, internal trade/credential data;
- internal error detail, stack traces, or secret substrings.
Allowed response: a status (200 accepted / 4xx reject / 5xx retryable) + a non-secret reason code at
most. (Confirm the current Edge response body emits only this.)

## 4. Token rotation
- **Per-bot token**, hashed at rest (HMAC + pepper). Rotation = generate a new token → update the
  bot's hash → distribute the new token to the signal source → old token then rejected.
- **Scheduled rotation procedure (S4-6a):** documented cadence + drill; follows
  [S5-A6 runbook](sprint5-s5-a6-incident-rotation-runbook.md) hygiene (token never printed in
  argv/logs; hashing done off-channel).
- **Evidence:** rotation drill — old token rejected, new token accepted, no downtime window beyond the
  swap.

## 5. Replay protection — decision
- **Today:** exact-`signal_id` replay is **deduped** (UNIQUE → no second trade). That covers a resend
  of the *same* signal.
- **Gap:** a *stale-but-unique* signal (an old, never-seen `signal_id` replayed late) would still fire.
- **Decision (recommended):** add a **freshness window** — reject a signal whose `fire_time` is older
  than a configured bound (e.g. minutes), in addition to the uniqueness dedup. Combined with
  Once-Per-Bar-Close semantics, this bounds replay risk. **Open:** the exact window + whether
  `fire_time` is mandatory in prod (Decision Log before connect).
- HMAC + per-bot token already prevent **forged** signals from an attacker without the token.

## 6. Duplicate signal handling
- Mechanism: `UNIQUE(bot_id, signal_id)` → on collision the worker logs `duplicate_signal_race` and
  **acks without a second trade** (idempotent). No change needed; document it as the contract.
- TradingView/alerts that fire-twice are safe by construction — but the **freshness window** (§5) is
  what stops a *late* unique replay.

## 7. Rate limiting / abuse controls
- **Today:** none at the Edge. A leaked token could be hammered (each unique `signal_id` = a trade
  attempt, bounded only by the per-bot daily cap downstream).
- **Requirement:** per-bot (and per-IP) **rate limit** at the Edge (e.g. N requests/min), plus the
  existing downstream caps (`max_order_notional_usdt`, `daily_notional_cap_usdt`) as the money-side
  backstop. Reject (429) over the limit; never enqueue.
- **Defence in depth:** even with a leaked token, the server-side risk limits cap exposure per the
  bot's config — but rate limiting prevents queue/abuse flooding.

## 8. Source validation / allowlist feasibility
- **Source validation must be chosen AFTER verifying current TradingView capabilities** from official
  TradingView documentation at the time of integration — do **not** assume a stable published source-IP
  set exists or is current. (TradingView's webhook source addressing has changed over time; treat any
  IP list as needing fresh verification + an update/monitoring procedure.)
- **Decision rule:**
  - **If** official, stable TradingView source IPs **are** available → enforce an IP allowlist at the
    Edge / fronting layer (Cloudflare/WAF) — off-list → reject — **in addition to** HMAC + token (an
    allowlist is never a substitute for auth), with an update procedure + monitoring for
    legitimate-but-blocked rejects.
  - **If** stable source IPs are **not** officially available → rely on the compensating controls:
    token rotation (§4) + freshness/replay protection (§5) + duplicate dedup (§6) + rate limiting (§7)
    + response hygiene (§3) + monitoring/WAF anomaly controls. HMAC + per-bot token remain mandatory.
- For StrateTeach (if connected), the seam decides its own source validation (T13).
- **Evidence:** the chosen control is enforced and tested — either an off-allowlist request is rejected
  (allowlist path), or the compensating controls (rotation/freshness/rate-limit) are each evidenced
  (no-allowlist path).

## 9. Evidence required before connecting TradingView (E1 + E2)
- **E2 — source validation enforced (per §8 decision):** *if* an allowlist is used — off-list source
  rejected, on-list + valid-token accepted; *if* no stable source IPs — the compensating controls
  (rotation + freshness + rate-limit + response hygiene) are each evidenced instead.
- **E1 — token rotation drill:** old token rejected, new accepted.
- **E1 — replay/freshness:** a stale-`fire_time` signal rejected; an exact-duplicate `signal_id`
  deduped (no second trade).
- **E1 — rate limit:** over-limit requests get 429 and are not enqueued.
- **E2 — response hygiene:** webhook responses contain no secret/DB/role data (body inspection).
- **Testnet-first:** the first real TradingView signal → fill is proven on **testnet** before any
  mainnet consideration (this is also gap **A7**).

## 10. Stop conditions
- **No TradingView live connection** until §9 evidence exists — simulator only until then.
- **No secret ever leaves Praxis to TradingView** (response hygiene §3) — and TradingView never sends
  symbol/quantity/keys (contract §2).
- **No StrateTeach connection** until the T13 seam is decided (Decision Log) — no direct-execution path
  ever (gap-review §C).
- Any token suspected leaked → rotate via [A6 runbook](sprint5-s5-a6-incident-rotation-runbook.md)
  before resuming; do not "wait and see."
- Real signal source on **mainnet** only after A1/A4 close + controlled smoke + Oren (this packet does
  not authorize mainnet).
