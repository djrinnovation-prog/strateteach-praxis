# Phase 0 — Go/No-Go Review Sheet (read-only)

> **READ-ONLY REVIEW — NOT EXECUTION.** Phase 0 inspects state only: read-only SQL + a non-secret
> flag read. **No DB mutation · no Doppler/Railway change · no `QUEUE_ENABLED` change · no §6b enable ·
> no arm/fire · no TradingView · no mainnet/real funds.** This sheet is *prepared* for the live review;
> the checks below have **not** been run yet. Decision path: **C now** (this read-only review) → **A
> only if Oren explicitly approves in writing AFTER Phase 0**. Companions: [Oren brief](production-oren-go-no-go-brief.md),
> [checklist + rollback](production-go-live-checklist-and-rollback.md), [controlled smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md).

## 1. State snapshot for the room (one screen)
- **Tiers:** testnet-ready ✅ · config-ready ✅ · controlled-smoke-ready ⏳ (packaged, NOT run) · **real-funds-ready ❌**.
- **Standing (expected, to be confirmed live in §2):** `QUEUE_ENABLED=false` · 5 bots `trading_enabled=false` · SELL fail-closed · migration 014 applied · 009 frozen. The system **cannot place an order** in this state.
- **Real funds:** blocked behind MUST gates A1/A2/A3/A4/A5/A10/A11 (+A8 kill path) + controlled-smoke PASS + Oren written approval (A11). **Not** on today's table.

## 2. Phase 0 read-only checks (run live during the review; all read-only)
> Run these **at** the review, not before. None mutates anything. If any check is **not** as expected,
> the answer is **No-Go for Phase 1** (do not arm) — investigate first.

**(a) 5 bots config-ready + kill switch OFF + env testnet (E2):**
```sql
SELECT b.trading_pair, b.id, b.sizing_mode, b.fixed_notional_usdt, b.max_order_notional_usdt,
       b.daily_notional_cap_usdt, b.sell_enabled, b.trading_enabled, c.exchange_environment
FROM public.bots b JOIN public.user_exchange_credentials c ON c.id = b.credential_id
WHERE b.id IN ('2dcaddba-b62d-47e1-87a7-7f7b759f38d2','c8913354-8b7e-4d8d-8b3d-fb8b8f8248df',
  '36b46eb3-9384-4e05-a79b-1246e9b85119','5acc84c9-edd2-4c9f-87dd-fd928f8b62cd',
  '297dddb9-965b-49ff-abd8-e3e8e88fa4fc')
ORDER BY b.trading_pair;
```
**Expected:** 5 rows — `sizing_mode=fixed_notional`, `fixed_notional_usdt=20`, `max_order_notional_usdt=25`,
`daily_notional_cap_usdt=100`, `sell_enabled=false`, **`trading_enabled=false`**, `exchange_environment=testnet`.

**(b) No in-flight work + clean queue/dlq/recon (E2):**
```sql
SELECT
  (SELECT count(*) FROM public.trades WHERE status IN ('pending','submitted','unknown') AND deleted_at IS NULL) AS open_trades,
  (SELECT count(*) FROM public.trades_dlq) AS dlq,
  (SELECT count(*) FROM public.reconciliation_jobs WHERE status = 'pending') AS open_recon,
  (SELECT public.pgmq_queue_length('trade_signals')) AS queue_length;
```
**Expected:** `0 / 0 / 0 / 0`.

**(c) Queue flag is OFF (non-secret flag; Doppler is source of record):**
```bash
doppler secrets get QUEUE_ENABLED --plain -p praxis-platform -c dev   # expect: false
```
**Expected:** `false`.

**(d) Worker disarmed (E1, observe — read-only):** the latest Railway worker deployment shows
`queue_enabled=false`, `worker_queue_disabled`, and `boot_reconciliation_complete stuck_count=0`.
(Inspect logs only; do not redeploy.)

## 3. Interpreting the review
- **All (a)–(d) as expected** ⇒ the system is **clean, disarmed, and config-ready**. Phase 0 is a
  GO *for the decision* — i.e. it is safe to **consider** Phase 1. It does **not** itself authorize Phase 1.
- **Any check off** ⇒ **No-Go for Phase 1**; record the discrepancy; do not arm. (E.g. any bot
  `trading_enabled=true`, `QUEUE_ENABLED≠false`, non-zero open/queue/dlq/recon, wrong config.)

## 4. The decision after Phase 0
- **If Oren explicitly approves (A), in writing:** proceed to the controlled testnet smoke, executed
  **exactly** per [the smoke packet](sprint5-s5-a3-b4-controlled-smoke-packet.md) — pre-arm verify →
  enable one bot → queue arm → fire **one BTC testnet** signal → observe → **immediate disarm** →
  final evidence. **testnet only.** A blocked outcome/failure is a **SAFE STOP**, not a PASS.
- **If Oren defers (B):** no runtime; continue closing MUST gates.
- Either way, a decision record is written afterward (DECISIONS.md + optional decision-record doc) with
  Oren's choice, timestamp, scope, and explicit non-approval of mainnet unless A11 is separately granted.

## 5. Stop conditions (hold regardless)
- Phase 0 is **read-only** — nothing here arms, enables, or fires.
- **No Phase 1 / arm / §6b enable / `QUEUE_ENABLED=true`** without Oren's **explicit written approval
  after** Phase 0.
- **No mainnet / real funds / TradingView live** — independent of Phase 0/1; gated on the full MUST
  set + A11.
- Any anomaly in §2 ⇒ No-Go for Phase 1; any secret exposure ⇒ A6 incident protocol.
