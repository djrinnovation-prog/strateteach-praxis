# Production Go-Live Checklist + Rollback

> **PLAN / DOC ONLY — NOT EXECUTION.** This is the *sequence and gates* for a go-live decision, not a
> command to run anything. No DB mutation · no Doppler/Railway change · no `QUEUE_ENABLED` change · no
> §6b enable · no arm/fire · no TradingView live · no mainnet/real funds in this document.
> **Real funds are BLOCKED** until every MUST gap closes (E1/E2) **and** Oren signs off (see
> [go-live gap list](production-go-live-gap-list.md)). Reaching "config-ready" or even a testnet smoke
> PASS does **not** authorize mainnet.

## Honest status going into the decision
- **Closed/ready:** testnet-ready (S4-2), config-ready (014 + 5 bots, `trading_enabled=false`), SELL
  fail-closed, A6 runbook, all packets.
- **Open MUST (block real funds):** A1 egress · A2 Migration 009 · A3 live smoke (testnet) · A4
  credential isolation · A5 webhook/TradingView hardening · A10 rollback drill · A11 real-funds
  approval (+ A8 kill path). → **Tomorrow is a decision + at most a testnet smoke, not a mainnet launch.**

---

## Phase 0 — Go/no-go decision (read-only, ~30 min)
1. Review the [gap list](production-go-live-gap-list.md): which MUST are closed with E1/E2, which open.
2. Confirm current state is clean + disarmed (read-only): 5 bots `trading_enabled=false`,
   `QUEUE_ENABLED=false`, `queue_length=0`, no open/pending/unknown trades, dlq=0, recon=0.
3. **Decision:** (a) run the testnet controlled smoke now (Phase 1, Oren-approved), or (b) defer and
   keep closing MUST gaps. **Mainnet (Phase 3) is not on tomorrow's table** unless every MUST is
   already closed — it is not.

## Phase 1 — Controlled testnet smoke (Oren-approved window, ~30–45 min)
- Run **exactly** [sprint5-s5-a3-b4-controlled-smoke-packet.md](sprint5-s5-a3-b4-controlled-smoke-packet.md):
  pre-arm verify → enable ONE bot (§6b) → arm queue → fire ONE signal → observe → **immediate disarm**.
- **SMOKE PASS** = one testnet fill sized from config (`requested=20`, `executed≈20`); **`order.blocked`
  = SAFE STOP**, not a pass. Re-disarm regardless.
- Output: A3 evidence (E1) recorded; system back to config-ready, disarmed.
- **This is still testnet.** It does not move real money and does not open Phase 3.

## Phase 2 — Close the MUST gates (multi-session, NOT tomorrow)
Each is its own gated design → review → execute → evidence loop; none ships to mainnet alone:
- **A1** static egress + mainnet reachability (read-only probe) — [A1 packet](production-a1-egress-binance-connectivity-packet.md).
- **A2** scope → write → review → apply Migration 009; reconcile migration history.
- **A4** production credential isolation + rotation drill — [A4 packet](production-a4-credential-isolation-packet.md).
- **A5** webhook IP allowlist + token rotation + replay/rate-limit + (later) real TradingView on testnet (A7) — [A5 packet](production-a5-webhook-tradingview-hardening-packet.md).
- **A10** rollback drill (below) passes.
- **A8** a trusted kill path (CLI/SQL acceptable v1) documented + drilled.
- **A11** Oren's written real-funds authorization + capital ceiling.

## Phase 3 — Mainnet credential setup gates (ONLY after Phase 2 + A11, far gated)
**Strict order — do not reorder (lock-out / unrestricted-key risk):**
1. A1 static egress IP confirmed + mainnet **read-only** reachability proven (no order).
2. Create the **mainnet** credential in **Vault**; set `exchange_environment='mainnet'`;
   **IP-restrict the key to the static egress IP from creation** (A1/A4).
3. Verify the worker's env guard: with `PRAXIS_IS_PRODUCTION=true`, mainnet creds accepted, testnet
   creds blocked (`env_mismatch`).
4. Configure the mainnet bot(s) with **tiny** limits (Phase 4 placeholders); `trading_enabled=false`.

## Phase 4 — First real-money smoke (smallest possible, Oren present, attended)
- **Max initial notional / daily cap — PLACEHOLDERS (Oren sets):**
  - `fixed_notional_usdt = <SMALLEST that clears Binance minNotional, ~$10–15 — TBD Oren>`
  - `max_order_notional_usdt = <≈ fixed, e.g. 15 — TBD Oren>`
  - `daily_notional_cap_usdt = <one or two orders, e.g. 30 — TBD Oren>`
- Sequence mirrors the controlled smoke but on **mainnet**, ONE bot, ONE order, attended, immediate
  disarm. Observe a real fill of the smallest size; verify `requested/executed_notional`, audit, and
  the rollback levers all work **before** any scale-up.
- **Scale-up (more bots / higher caps / TradingView live / unattended) is a separate later decision** —
  not part of the first smoke.

## Rollback levers (each halts the money path independently; drill all in A10)
Apply the **fastest sufficient** lever first; for a hard stop, apply all.
1. **Queue off (fastest, global):** `QUEUE_ENABLED=false` in Doppler → Railway redeploy. Worker stops
   processing signals (`worker_queue_disabled`). Verify: `doppler secrets get QUEUE_ENABLED --plain -p praxis-platform -c dev` (or prod config) ⇒ `false`.
2. **Kill switch (DB).** Worker blocks every BUY (`trading_disabled`), no order. Pick one:
   - **Disable ONE bot by id:**
     ```sql
     UPDATE public.bots SET trading_enabled = false WHERE id = '2dcaddba-b62d-47e1-87a7-7f7b759f38d2'
     RETURNING id, trading_pair, trading_enabled;
     ```
   - **Disable ALL configured bots (hard stop):**
     ```sql
     UPDATE public.bots SET trading_enabled = false WHERE trading_enabled = true
     RETURNING id, trading_pair, trading_enabled;
     ```
   Verify either way:
   ```sql
   SELECT count(*) AS enabled_bots FROM public.bots WHERE trading_enabled = true;  -- expect 0 for a full stop
   ```
3. **Revoke/rotate webhook token (stop new signals):** rotate the bot's token (A5/A6) → old token
   rejected at the Edge → no new signals enqueued. (Token value never printed.)
4. **Disable credential (stop order placement):** set the credential `status` away from `valid`
   (and/or rotate at the exchange) → the worker fail-closes credential resolution → no orders. (At the
   exchange, disabling/IP-locking the key is the hardest stop.)
- **Ordering note:** 1 + 2 stop processing fastest; 3 stops the *source*; 4 is the exchange-side
  backstop. Real money incident → do 1 **and** 2 immediately, then 3/4.

## Stop conditions (hard gates — money / mainnet / queue / TradingView)
- **No real funds** until ALL MUST gaps closed (E1/E2) **and** A11 written Oren approval. Independent
  of any technical readiness.
- **No mainnet** (probe-with-order, key, fire) without Oren; mainnet first smoke is attended + smallest
  size + immediate disarm.
- **No `QUEUE_ENABLED=true` / no §6b enable** outside an explicit Oren-approved window; revert
  immediately after.
- **No TradingView live** until A5/A7 evidence; simulator only.
- `order.blocked` / any anomaly during a smoke → disarm first (kill switch before investigation),
  then diagnose; never re-fire blindly.
- Any secret exposed → [A6 incident protocol](sprint5-s5-a6-incident-rotation-runbook.md); rotate
  before resuming.
- If the rollback drill (A10) hasn't passed, **do not** start real funds.

## Estimated time blocks (rough, planning only)
| Block | Est. |
|---|---|
| Phase 0 go/no-go review | ~30 min |
| Phase 1 testnet controlled smoke (if approved) | ~30–45 min |
| Phase 2 MUST gates (A1/A2/A4/A5/A10/A8/A11) | **multi-session** (days), each gated separately |
| Phase 3 mainnet credential setup | ~1–2 h (after Phase 2) |
| Phase 4 first real-money smoke (attended) | ~30–45 min |
| A10 rollback drill (testnet/non-destructive) | ~30 min |

**Tomorrow realistically = Phase 0 + (optionally) Phase 1.** Phases 2–4 are the real road to funds.
