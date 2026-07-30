# Phase 2b — Mean-reversion sleeve · GATED PAPER-SIM results (Checkpoint 3)

**PAPER-SIM ONLY.** No orders, no capital, live gate / `AUTOPILOT_LIVE_ENABLED` untouched.
Historical replay driving the SAME wired strategy code (`app/services/mr_strategies.py`) through
a faithful paper-sim portfolio. Harness: `python-backend/scripts/mr_paper_sim.py`.

### Execution model (the whole point of CP3 — honest fills)
- **Signal on a bar's CLOSE → fill on the NEXT bar's OPEN** (stricter than Phase-2a's close-to-close).
- **MODELED slippage** (stated, not a live measurement): a bps execution gap on every fill
  (buy = open·(1+bps), sell = open·(1−bps)). Stocks **5 bps/side primary, 10 bps/side stress**;
  crypto 10/20 bps. Large-cap US stocks are very liquid, so 5 bps/side is conservative-realistic.
- **Fees:** 0.1%/side = **0.2% round-trip** on notional at entry and exit.
- **Paper-sim accounting:** per-pilot NAV, equal-weight sizing, hard **8-position cap**, daily
  mark-to-market → net% + maxDD. When more signals fire than free slots, the cap binds
  (most-oversold ranked first — a canonical ordering, not a tuned parameter).
- Window: 2018→now fetched (200-SMA warmed before 2020) so trades span **2019→2026 incl. the 2022 bear**.

---

## STOCKS — the sleeve's universe (141 usable of top-150)

**expW% = mean expectancy per trade, winsorized ±100%, NET of fees AND modeled slippage.** med% = median trade.

### Primary slippage — 5 bps/side (10 bps round-trip)
| strategy | win% | avgW% | avgL% | **expW%** | med% | hold | trades | t/day | net% | maxDD% | +assets |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| RSI(2)       | 61.0 | 2.59 | −3.69 | **+0.141** | +0.68 | 4.0 | 2524 | 1.18 | +38.3 | −40.3 | 66% |
| Bollinger(20,2) | 57.1 | 4.97 | −5.76 | **+0.375** | +1.23 | 8.2 | 1057 | 0.49 | +50.7 | −29.1 | 58% |

### Stress slippage — 10 bps/side (20 bps round-trip)
| strategy | win% | **expW%** | med% | net% | maxDD% | +assets |
|---|--:|--:|--:|--:|--:|--:|
| RSI(2)       | 59.6 | **+0.043** | +0.58 | +4.7  | −44.2 | 57% |
| Bollinger(20,2) | 56.6 | **+0.275** | +1.13 | +37.1 | −29.7 | 55% |

### Robustness — winsorized expectancy% (net of fees + primary slippage), by entry sub-period
| strategy | 20-21 | **2022 (bear)** | 23-24 | 25-26 | ALL |
|---|--:|--:|--:|--:|--:|
| RSI(2)       | +0.229 | **−0.785** | +0.193 | +0.216 | +0.141 |
| Bollinger(20,2) | +0.490 | **−1.751** | +0.700 | +0.215 | +0.375 |

---

## CRYPTO — reference cross-check ONLY (sleeve is stocks-only; just 23 assets fetched)
gate.io coverage was thin this run (23 assets) — small sample, not dependable. RSI2 recent
sub-periods ~0/negative (23-24 −0.02, 25-26 −0.06), matching Phase-2a's "crypto regime-dependent."
Bollinger looks strong (expW +1.6) but n=229 and 2022 n=3 — not enough to lean on. **Not used for the verdict.**

---

## VERDICT — KPI = expectancy × robustness (NOT trades/day)

Realistic execution (next-open fill + slippage) **roughly HALVED** both strategies vs the Phase-2a
close-to-close backtest (RSI2 +0.32→+0.14; Bollinger +0.80→+0.375 at primary). This is the honest
cost of real fills — exactly what CP3 was built to expose.

**✅ Bollinger(20,2) + 200-SMA — the edge SURVIVES.** Positive net of fees AND slippage at BOTH
primary (**+0.375%/trade**) and stress (**+0.275%/trade**); consistent in 3 of 4 sub-periods (only
2022 negative, then recovers strongly); positive on a majority of assets; maxDD −29% under the
8-position cap. This confirms Phase-2a's "cleanest stock-side edge" holds under realistic execution.

**⚠️ RSI(2) — real but TOO THIN to rely on.** Positive at primary (+0.141%/trade) but the margin
is thin and does **NOT robustly survive** the stress slippage: at 10 bps/side it collapses to
**+0.043%/trade** (≈ breakeven; net +4.7% over ~7 years) with a −44% drawdown. A 0.14% edge that
halves again under a modest slippage bump is fragile. **Honest finding: RSI2's edge does not
survive conservative execution costs with enough margin to trade.**

**Both weaken in 2022 despite the 200-SMA guard.** The per-asset regime guard reduces but does not
eliminate bear losses — a name above its own 200-SMA can still be hit in a broad drawdown. Inherent
to dip-buying; the guard helps (Bollinger recovers to +0.70 by 23-24) but is not a bear shield.

**Neither is high-frequency** (0.5–1.2 trades/day across the WHOLE universe) — consistent with
Phase-2a: the daily-trading edge is modest-frequency mean-reversion, not many-scalps-per-day.

### Bottom line
Of the two, **only Bollinger(20,2)+200-SMA clears the bar** (positive expectancy with margin,
robust to modeled slippage, consistent across periods and assets). RSI2 is a real but marginal edge
that a realistic slippage assumption erodes to breakeven — a valid negative finding, reported plainly.

### Next step (NOT taken — awaiting your call)
Option **(b) live-forward paper run**: arm the Bollinger sleeve in the paper-sim engine on the live
`daily_scan_stocks_mr` feed and accumulate REAL forward fills over weeks — the only way to confirm
true slippage before any capital discussion. **No live wiring, no capital, until you say go.**
