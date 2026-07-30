# Phase 2A + 2B — go-live operator runbook (engine parity → StrateTeach connection)

One sequenced, gated path from the current state (14 unpushed commits on `praxis-engine-parity`, all
dormant) to a StrateTeach↔Praxis pilot with Praxis as the sole execution engine. **Every stage has a
gate and a rollback. Real funds are NO-GO until Stage 11 is green and Stage 12's blockers close.**
Nothing in Stages 0–3 changes live behavior; the system stays Binance-spot-buy-only until you
deliberately open a gate.

Legend: **[O]** operator-run · **[C]** code/Claude-prepared (already committed or a prepared packet).
E1 = code + test pass. E2 = independent audit + no safeguard weakened + evidence recorded.

## What is built (branch `praxis-engine-parity`, 14 commits, NOT pushed)
Engine: EP0 ADR · EP1 exchange-param adapter · EP1b two-layer venue gate · EP2 Bybit (generic ccxt) +
tick-size fix · EP3 SELL · EP-protective (limit + native TP/SL) · EP4 futures primitives · EP4 futures
**cage** (non-spot fail-closed) · EP5 flatten · EP6 per-venue validate-credential · EP7 latency
instrumentation + venue-aware status. Connection packets: M0 contract+ADR · M2 StrateTeach shadow
adapter · M5 status/kill UI. jest 551 + node:test 33 green, tsc clean, guard 6/6 — **but every commit
is audited only by me (the independent agent audits were 529-blocked); Stage 1 closes that.**

## Flags / gates — ALL default OFF (nothing is armed)
| Control | Where | Default | Opens |
|---|---|---|---|
| `PRAXIS_IS_PRODUCTION` | worker env | off (testnet) | mainnet execution |
| `EXCHANGE_EGRESS_MODE=native` / `EXCHANGE_HTTPS_PROXY` | worker env | unset ⇒ prod fail-closed | egress (A1) |
| `QUEUE_ENABLED`, `RECONCILIATION_SCAN_ENABLED`, `WEBHOOK_REQUEUE_SWEEPER_ENABLED` | worker env | off | runtime paths |
| `AUDIT_FAIL_CLOSED_ENABLED` | worker env | off | live audit fail-closed |
| `SUPPORTED_EXCHANGES` (code) + `exchanges.is_active` (DB) | worker + DB | **binance only** | a venue (both required) |
| `bots.account_type` | DB enum | `spot` only | futures (cage refuses non-spot) |
| `bots.sell_enabled` | DB per-bot | false | SELL for that bot |
| `bots.webhook_body_signing_required` | DB per-bot (operator-locked) | false | signed-relay ingress (T4) |
| `PRAXIS_SHADOW_ENABLED` + `PRAXIS_RELAY_MAP` | StrateTeach env | off | M2 shadow mirroring |
| `VITE_OPERATOR_KILL_ENABLED` / `VITE_PRAXIS_*` | frontend env | off/unset | kill UI (M5) |

## New migrations from this work (linked-apply is a separate gated step — never `db push`)
`037_exchanges_seed_strateteach_venues.sql` (kucoin/bitget/gate inactive) ·
`038_operator_fleet_exchange.sql` (venue in the fleet RPC). Each has a LOCAL SQL test under
`supabase/tests/`. Prior migrations (035/036 and earlier) are governed by their own runbooks
(`docs/praxis-gap-closure-ops-runbook.md`); confirm `schema_migrations` before proceeding.

---

## Stage 0 — Push + CI  **[O]**
1. `git push -u origin praxis-engine-parity`; open a PR (base `praxis-gap-closure`, or `main` if that is
   merged).
2. **Gate:** CI green — worker (jest + node:test), edge (Deno + node:test), frontend (vitest), SQL
   (migrations 001..038 + tests). **CI green does NOT prove a real-exchange round-trip** (Stage 4/11 do).
3. **Rollback:** none needed — a branch/PR changes nothing live.

## Stage 1 — Independent audits (closes the one process gap)  **[O]**
1. Re-run the independent, adversarial audits that were 529-blocked — per milestone, regression + safety
   lenses — over the 14 commits (or run `/code-review` / `/security-review` on the branch).
2. **Gate:** clean, or every finding triaged and fixed (re-commit + re-run). **Do not proceed to any
   money-adjacent stage on my self-audits alone.**
3. **Rollback:** revert offending commits.

## Stage 2 — Apply migrations (linked, one at a time)  **[O]**
1. Apply `037` then `038` on the linked DB (surgically, NOT `db push`); run each `supabase/tests/037*`,
   `038*` SQL test.
2. **Gate:** `schema_migrations` lists 037/038; SQL tests pass; **`select count(*) from exchanges where
   is_active` = 1 (binance only)** — no venue silently activated.
3. **Rollback:** 037 is additive-dormant (drop the 3 rows if needed); 038 re-issues an RPC (restore the
   032 definition).

## Stage 3 — Deploy worker + edge (still dormant)  **[O]**
1. Deploy the worker (EP1–EP7 code) and edge (unchanged). Keep every flag at its default.
2. **Gate:** worker boots + reconciles; a Binance-spot bot behaves byte-identically (regression); a
   non-spot bot is refused (`account_type_not_supported`); every non-binance venue is inert (gate). No
   `trade_timing`/venue change alters execution.
3. **Rollback:** redeploy the prior worker image; flags already off.

## Stage 4 — Per-venue testnet validation → activation (repeat per venue; start Bybit)  **[O]**
1. Obtain that venue's TESTNET credentials. Run the adapter against the REAL testnet: market-rules parse,
   a real testnet order (the `BinanceAdapter.testnet.test.ts` pattern generalized), fetchOrder, error
   mapping. This catches live-shape bugs unit mocks cannot (cf. the EP2 tick-size fix).
2. Only after a green testnet run: **[C]** add the `ccxt_id` to `SUPPORTED_EXCHANGES` (code → re-audit →
   deploy) **and** **[O]** `update exchanges set is_active=true` (linked). BOTH gates required.
3. **Gate:** a real testnet order round-trips correctly; both allowlist + `is_active` set; Binance
   unaffected.
4. **Rollback:** `is_active=false` (instant) and/or revert the allowlist commit — either alone disables
   the venue (two-layer gate).

## Stage 5 — Deferred execution slices (only if/when needed; each testnet-gated)  **[C]+[O]**
- **EP-protective wiring** (bot config → protective legs; Binance-native stop via `createStopOrder`+OCO
  lifecycle, since Binance lacks the combined call). Build against a real testnet; audit; deploy behind
  a per-bot flag.
- **EP4 futures execution** (mandatory per-order `setLeverage`, isolated margin, reduce-only exits,
  exposure/margin caps, futures testnet). Build against a real futures testnet; audit; master flag OFF +
  per-bot opt-in; the cage (Stage 3) refuses futures until this lands.
- **Gate:** real testnet validation of the exact order shapes + independent audit before arming.

## Stage 6 — M2 shadow on StrateTeach (observe, no cutover)  **[O]** (packet `phase2b-m2-*.md`)
1. Apply the M2 packet to live StrateTeach (new `praxis_relay.py` + the one guarded hook). Deploy with
   `PRAXIS_SHADOW_ENABLED` unset.
2. **[O]** M1 ingress provisioning: for each shadowed bot, enable `webhook_body_signing_required`
   (operator-locked), derive its `bodyKey` hex from the Edge-only pepper, and populate `PRAXIS_RELAY_MAP`
   (per the M0 contract). Verify a signed test signal (valid / bad-sig / stale) behaves correctly at the
   webhook (edge e2e).
3. Arm `PRAXIS_SHADOW_ENABLED=true`. Every real StrateTeach order now ALSO emits a signed intent to
   Praxis (Praxis side stays on testnet/flags — no real Praxis order).
4. **Gate (the pre-cutover go/no-go):** over a meaningful window, Praxis receives + would-execute
   correctly for the SAME signals StrateTeach acted on (compare `webhook_logs`/`trades`/`trade_timing`
   vs StrateTeach orders). The shadow path never affected a live StrateTeach order.
5. **Rollback:** `PRAXIS_SHADOW_ENABLED=false` (instant); remove module + hook to fully revert.

## Stage 7 — M4 credential migration (sensitive; operator-run, no printing)  **[O]**
1. Migrate each StrateTeach Fernet key → Praxis Vault as a per-(user,bot) credential (gated, never
   printed), then rotate. Validate each with the per-venue `validate-credential` (EP6): auth proven;
   Binance restrictions auto-checked, other venues confirmed manually (withdrawals-off / IP-restricted).
2. **Gate:** every credential is per-bot owned + single-use (021/023), validates, and is `is_active`
   only for a venue that passed Stage 4.
3. **Rollback:** revoke the new Vault credential + re-key.

## Stage 8 — M5 status/kill UI  **[O]** (packet `phase2b-m5-*.md`)
1. Apply the M5 panel to the StrateTeach dashboard; set `VITE_PRAXIS_SUPABASE_URL/_ANON_KEY`.
2. **Gate:** operator signs in (own Praxis account) and sees the venue-aware fleet; the audited kill
   works against the testnet Praxis (disables trading; RAISE 42501 for non-operators).
3. **Rollback:** remove the route / unset the env.

## Stage 9 — M3 cutover (the hard boundary; per bot, flagged)  **[O]** (StrateTeach patch — future packet)
1. Flip each StrateTeach bot to route its signal to Praxis ONLY and STOP calling its own
   `place_order`/`create_order`. StrateTeach becomes a signal source; it holds no exchange keys after
   this (retire the direct order path + `withdraw`).
2. **Gate:** no direct `create_order` in StrateTeach prod for a cut-over bot; its signals reach Praxis;
   Praxis executes (testnet until Stage 12). Per-bot flag; instant flip-back.
3. **Rollback:** flip the bot back to its direct path (kept dormant, not deleted, until Stage 11 green).

## Stage 10 — Reconciliation + status sanity  **[O]**
1. Confirm Praxis reconciliation resolves any left-open/unknown orders per venue (already multi-exchange
   from EP1b); the M5 fleet + `trade_timing` reflect reality; the kill halts a cut-over bot.
2. **Gate:** no orphaned/unknown trades; kill verified end-to-end (StrateTeach → Praxis).

## Stage 11 — M6 comprehensive TESTNET end-to-end (the real go/no-go)  **[O]+[C]**
1. Drive the FULL unified path on **exchange testnet**: StrateTeach signal → Praxis webhook → worker →
   testnet order. Scenarios (recorded): duplicate `signal_id`, paused/kill-disabled bot, wrong-user,
   stale/bad signature, BUY, SELL, (protective/futures/flatten only if armed in Stage 5), reconciliation
   of a forced-open order, and a mid-run kill. This is the "very comprehensive end-to-end test."
2. **Gate:** every scenario passes on testnet with recorded evidence. **This is the go/no-go for real
   funds.** A single failure ⇒ stop, fix, re-run.

## Stage 12 — Go-live blockers + M7 tiny-live  **[O]**
1. Close A1 (static egress — materially done), A4 (per-venue mainnet key: `validate-credential` +
   withdrawals-off + IP-allowlist to the static egress IPs), A11 (tiny-live caps), and any live-tier
   hard blockers.
2. **[O]** M7: arm ONE bot with tiny caps on mainnet; place a real micro-order; monitor; **disarm clean
   (revoke the exchange key at the exchange, not just a flag).**
3. **Gate:** E1/E2 evidence for the micro-order + a clean disarm before any scale-up.

---

## Standing invariants (do not violate at any stage)
- Never `db push`; migrations are linked-applied one at a time with their SQL test.
- A venue trades only if BOTH `is_active=true` AND `ccxt_id ∈ SUPPORTED_EXCHANGES`.
- Praxis is the only holder of exchange keys post-M3; StrateTeach signs intent only.
- Kill and flatten must keep working after a kill (flatten is operator-only + reduce-only + audited).
- Real funds NO-GO until Stage 11 green + Stage 12 gates; disarm = revoke the key at the exchange.
- The independent audits (Stage 1) gate everything money-adjacent — self-audits are not sufficient.
