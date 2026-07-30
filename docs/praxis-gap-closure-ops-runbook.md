# Praxis Gap-Closure — Operator Runbook (T7)

Hand-off for the `praxis-gap-closure` branch. Everything in the branch is **code-complete,
tested, and DORMANT / flag-gated OFF**. This runbook lists the **operational** steps only *you*
can perform (migrations on the linked DB, flag flips, Binance key config, the real-testnet proof).

> **Real-funds status: NO-GO.** Nothing here arms mainnet trading. Enabling live trading is a
> separate, deliberate decision gated on the A1/A4/A11/tiny-live work outside this branch.

---

## 0. What the branch changed (code) vs. what you do (ops)

| Task | Code (done, on branch) | Your operational step |
|---|---|---|
| T1 | CI/CD (GitHub Actions, 5 jobs) | Merge PR; confirm all checks green |
| T2 | ccxt import-scope guard | — (CI-enforced) |
| T5 | runtime reconciliation scan | flip `RECONCILIATION_SCAN_ENABLED` when ready |
| T6 | migration `035` (revoke credential-table access) | linked-apply `035` |
| T4 | migration `036` + dormant webhook body-signing | linked-apply `036` **before** the webhook deploy; enable per-bot only behind a relay |
| T3 | money-path e2e (nock in CI + on-demand testnet) | **run the real-testnet proof (T3c)** — the only real-exchange evidence |

---

## 1. Apply the migrations (linked DB) — SURGICAL, never `db push`

Per project discipline, apply each migration file explicitly against the linked project; do **not**
`supabase db push`. Apply in order, confirm each, and record in `schema_migrations` tracking.

```bash
supabase db query --linked --file supabase/migrations/035_credentials_revoke_authenticated.sql
supabase db query --linked --file supabase/migrations/036_bots_webhook_body_signing.sql
```

- **Before 035:** verify no authenticated/browser path writes `user_exchange_credentials` (the branch
  confirmed none exists in code). 035 revokes `authenticated`/`anon`/`public`; `service_role` (worker)
  and the SECURITY DEFINER dashboard RPCs are unaffected.
- **035/036 are gated migrations** — a linked apply is a separate reviewed step. Re-run the matching
  SQL tests (`supabase/tests/035_*.sql`, `036_*.sql`) against the linked DB if you want belt-and-suspenders.

## 2. Deploy ORDER (critical — avoids a self-inflicted outage)

**Migration `036` MUST be linked-applied BEFORE the webhook edge function is deployed.**
The new function reads `bots.webhook_body_signing_required`; if the column is missing it now
degrades gracefully to signing-OFF (a fix in T4), but the correct order avoids even that:

1. Apply `036` (above).
2. Then deploy the edge functions: `supabase functions deploy webhook` (+ any others changed).

## 3. Feature flags — all default OFF (dark). Flip only when you intend to.

Set on the worker (Doppler → Railway) unless noted. Each is fail-safe when unset.

| Flag | Where | Effect when `true` | Turn on when |
|---|---|---|---|
| `QUEUE_ENABLED` | worker | worker enters the pgmq poll loop (actually processes signals) | going live on the queue path |
| `RECONCILIATION_SCAN_ENABLED` | worker | T5 periodic stuck-trade scan (read-only; never places orders) | after queue is live |
| `WEBHOOK_REQUEUE_SWEEPER_ENABLED` | worker | 4C no-silent-loss sweeper | with the queue path |
| `HEALTHCHECKS_URL` | worker | dead-man heartbeat pings this URL | ops monitoring desired |
| `PRAXIS_IS_PRODUCTION` | worker | mainnet tier: rate-limit forced-ON, prod egress required (fail-closed) | mainnet go-live only |
| `EXCHANGE_HTTPS_PROXY` **or** `EXCHANGE_EGRESS_MODE=native` | worker | static egress (A1). In prod, one is **required** or trading fail-closes | with mainnet creds |
| `VITE_OPERATOR_KILL_ENABLED` | frontend build | shows the one-click operator kill in the UI | operator cockpit go-live |

`QUEUE_VISIBILITY_TIMEOUT_S` (default 45): if you raise it, the T5 scan threshold auto-clamps to
`max(60, visibility+15)` — the invariant is now enforced in code, so no manual coordination needed.

## 4. Webhook body-signing (T4) — enable ONLY behind a signing relay

The dormant flag `bots.webhook_body_signing_required` is **operator-managed** (a non-operator user
cannot toggle it — enforced by the 036 guard). **Do not enable it on a bot that fires directly from
vanilla TradingView** — TradingView cannot set headers or compute an HMAC, so every alert would be
fail-closed-rejected and the bot would silently stop.

Enable it **only** when a signing relay (e.g. the future StrateTeach integration) sits in front of the
webhook and:
1. computes `X-Praxis-Signature = hex HMAC-SHA256(bodyKey, rawBody)` where
   `bodyKey = HMAC(WEBHOOK_SECRET_PEPPER, "praxis.webhook.body-sign.v1|" + bot_id)` (derive it operator-side; hand it to the relay),
2. embeds a fresh `timestamp` **inside** the signed body (±300s window),
3. keeps `signal_id` in the body (it is covered by the signature).

Then, as operator, set the flag on that bot. Until a relay exists, leave it false (default).

## 5. Binance key configuration (exchange-side — cannot be enforced in code)

For any mainnet credential (A4 territory, outside this branch): the key must be **trade-only,
withdrawals DISABLED, IP-allowlisted** to the worker's static egress IP(s). The worker never calls
any withdraw/transfer endpoint, but that is defense-in-depth — the exchange key config is the real
control. Verify on the Binance dashboard.

## 6. The real-exchange proof (T3c) — the ONLY evidence that closes the money-path gap

**Green CI does NOT prove the money path works against a real exchange.** The nock suite proves
request-building/parsing/error-mapping up to the wire but does not validate the HMAC signature. The
real proof is the on-demand testnet run — **run it and record the output** as go-live evidence:

```bash
# read-only proof (signed fetchBalance = the exchange ACCEPTED the signature):
cd worker && PRAXIS_TESTNET_E2E=1 \
  BINANCE_TESTNET_KEY=<testnet-key> BINANCE_TESTNET_SECRET=<testnet-secret> \
  npx jest BinanceAdapter.testnet

# full write proof (also places ONE smallest-allowed market buy on TESTNET):
#   add PRAXIS_TESTNET_PLACE_ORDER=1
```

Use a **testnet** key only (the adapter is hard-pinned to sandbox here; a mainnet key would just be
rejected). Record: which tests passed, and (if placed) the testnet order id.

## 7. Go-live evidence gate (E1/E2)

Do not treat the money path as "proven" until, at minimum:
- [ ] `035` + `036` linked-applied (and tracked); SQL tests pass on linked.
- [ ] Webhook function deployed **after** `036`.
- [ ] CI green on the merged branch (worker/edge/frontend/sql).
- [ ] **T3c recorded** — signed testnet read (and, ideally, one testnet order) succeeded.
- [ ] Static egress verified (proxy or native) and, for mainnet, the key IP-allowlisted + no-withdrawal.
- [ ] One-click kill verified reachable (operator cockpit) before any real funds.

## 8. Scaling note

The worker is a single serial poll loop (SPOF/throughput ceiling by design). It is **safe** to run
more than one instance if ever needed — pgmq visibility timeout + `UNIQUE(bot_id, signal_id)`
idempotency prevent duplicate orders — but that is an operational change, not a code change.

---
*Branch commits (gap-closure): T1 `0e4f72b` (+`acc2378`,`dd83a9b` CI fixes) · T2 `9c49ecb` · T5 `67ee9b6` · T6 `0ef4ab2` · T4 `7981081` · T3 `43e39b6`+`2b258a0`.*
