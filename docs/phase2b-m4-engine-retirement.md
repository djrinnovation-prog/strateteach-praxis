# Phase 2B · M4 — StrateTeach engine retirement (the permanent one-way boundary)

**Goal:** in the unified app, StrateTeach structurally cannot touch an exchange or hold a key — Praxis is
the sole executor. This supersedes the rejected "credential-migration tooling" idea
(`phase2b-m4-credential-migration-tooling.md`): keys go STRAIGHT to Praxis (`connect-credential`), so there
is nothing to migrate.

This is done in three slices. **#4a (below) is APPLIED.** #4b/#4c remain.

## #4a — global engine kill-switch + guards (APPLIED 2026-07-30)

The money boundary is enforced at the single chokepoint module (`app/services/exchange.py` — the only
place that calls an exchange client's `create_order`).

- `exchange._engine_enabled()` — reads `STRATETEACH_ENGINE_ENABLED`, **default OFF**. A single GLOBAL gate
  over ALL credentials (stronger than, and independent of, the per-credential M3 cutover flag).
- When OFF (the unified-app default) every authenticated-order path fails CLOSED:
  `place_order` (direct path), `withdraw`, `close_profitable_positions`, `close_profitable_spot`,
  `close_all_spot`, `clean_dust_spot` → `{"ok": false, "message": "strateteach_engine_disabled…"}`.
  A cut-over signal still routes to Praxis (the gate sits AFTER the cutover routing, so it only blocks the
  DIRECT path — never Praxis).
- `autopilot_live.connect_keys` and `go_live` also refuse when the engine is OFF, so StrateTeach will not
  store an exchange key or arm live trading — users connect their key to Praxis instead.

**Layering (three independent gates, strongest first):**
1. `STRATETEACH_ENGINE_ENABLED` (global, default OFF) — refuse ALL direct orders.
2. M3 per-credential cutover (`PRAXIS_CUTOVER_ENABLED` + `PRAXIS_CUTOVER_KEYS`) — route listed credentials
   to Praxis; block their bulk-close/withdraw.
3. Structural: `create_order` is confined to `exchange.py` (guard test), so no new code can bypass it.

**Proof:** `strateteach/python-backend/tests/test_praxis_cutover_dryrun.py` — 10/10 (ccxt stubbed, client
factory raises if built). Existing dry-runs green; the legacy-engine OCO suite arms the engine explicitly.

**To temporarily run the legacy engine** (e.g. a controlled A/B or a rollback): set
`STRATETEACH_ENGINE_ENABLED=true`. Leave it UNSET in the unified app.

## #4b — physical quarantine + delete (LATER, after the testnet pilot is proven)
Move `exchange.py`'s order/close/withdraw code + `autopilot_live` + `live_reconcile`'s exchange writes into
an `_archive/` module (or delete), drop the Fernet key stores and the legacy webhook, and add a repo-wide
CI ban on `.create_order(` / authenticated ccxt use outside Praxis. Read-only public-data ccxt
(`data/market_exchange.py`, `signals.py` — prices/OHLCV, no keys) may stay or move to a public feed.

## #4c — frontend rewire (NEXT)
Point the dashboard's key/bot forms at the Praxis Edge functions (`create-bot`, `connect-credential`) via a
provisioning ticket, instead of the legacy `connect_keys` / bot-create backend routes. The old key form is
entangled with the retired engine, so it is rewired here rather than in #4b.

Real funds NO-GO until Stage 11 + Stage 12 (A1/A4/A11 + M7).
