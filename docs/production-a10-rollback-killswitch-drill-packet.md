# A10 Packet — Rollback / Kill-Switch Drill

> **DESIGN / DOC ONLY — NOT EXECUTION.** No DB/Doppler/Railway mutation · no arm/fire · no mainnet/real
> funds by this document. It defines *how* the rollback drill will be run later. The drill itself,
> when run, is **testnet only** and the live portions are **Oren-approved arming windows** (same gate
> as the controlled smoke). Companions: [go-live checklist + rollback](production-go-live-checklist-and-rollback.md)
> (the levers), [A6 incident runbook](sprint5-s5-a6-incident-rotation-runbook.md),
> [smoke evidence](sprint5-s5-a3-b4-controlled-smoke-evidence.md).

## 1. Objective (why A10 is a MUST that blocks real funds)
Prove — by rehearsal, on testnet — that **each rollback lever independently halts the money path**, and
that a full stop is **fast and repeatable**. An undrilled rollback is a liability with real funds; the
controlled-smoke Step-6 anomaly (a kill-switch UPDATE that silently did not take, caught only by a raw
read-back) is direct motivation: the levers and their *verification* must be muscle memory before any
higher-stakes operation.

A10 closes only when every lever is drilled with cited E1 evidence (engaged → no order produced → the
expected fail-closed artifact → reverted), the **raw read-back** verification rule is followed, and the
rollback time is measured.

## 2. The four levers (recap) + the independence principle
| # | Lever | Mechanism | Stops |
|---|-------|-----------|-------|
| L1 | **Queue off** (fastest, global) | `QUEUE_ENABLED=false` (Doppler) + Railway redeploy | worker stops processing any signal |
| L2 | **Kill switch** (per-bot / all) | `bots.trading_enabled=false` (DB) | worker blocks BUY (`order.blocked('trading_disabled')`), no order |
| L3 | **Revoke/rotate webhook token** | rotate the bot token (A5/A6) | Edge rejects new signals → nothing enqueued |
| L4 | **Disable credential** | credential `status`≠`valid` (and/or exchange-side key disable) | worker fail-closes credential resolution → no order |

**Apply the fastest sufficient lever first; for a hard stop, apply all.** L1+L2 stop processing
fastest; L3 stops the source; L4 is the exchange-side backstop.

## 3. Binding verification rule (from the smoke anomaly)
**Every arm/disarm DB mutation in this drill MUST be verified by a raw read-back of the actual row
state** — never by the presence/absence of filtered/grep output, and never by an empty result. A
mutation is "done" only when an independent `SELECT` shows the intended value.

## 4. Drill design — per lever
Each lever's drill = **precondition → engage → attempt → expected fail-closed result + artifact →
raw-verify no order → measure time → revert**. Grouped by how much arming each needs.

### Cheap (no valid signal is ever enqueued) — do these first
**L3 — token validation, no-side-effect only.** Two checks, neither of which enqueues a trade:
  - **(a) wrong/rotated token** + any payload → Edge **reject** (`event=webhook_reject`, non-2xx),
    **nothing enqueued** (`queue_length` unchanged), **no trade row**. The wrong-token test must **not**
    expose any real token fragment (hidden-prompt fire tool only; Edge logs redact).
  - **(b) valid token + INTENTIONALLY INVALID payload** → expected `invalid_payload` reject, **no
    enqueue, no trade** — confirms the token is accepted *without placing a trade*. **Do NOT** fire a
    valid trade payload to "confirm the token" outside a separately-approved smoke window with full disarm.
  - **Expected evidence:** `webhook_logs` reject rows (`webhook_reject` / `invalid_payload`),
    `queue_length` unchanged, **0** trade rows for the drill markers.

**L1 — queue off.** Already evidenced by the controlled-smoke disarm (`worker_queue_disabled` halts
processing). **Do NOT enqueue a live valid signal for L1.** Any optional re-confirmation must use only a
**rejected** path (invalid payload / wrong token) that never enqueues.
  - **Queue-cleanliness invariant (mandatory):** `queue_length=0` must be verified (raw read-back)
    **before leaving the drill and before ANY later `QUEUE_ENABLED=true`**. If a message is ever enqueued
    during any drill, it must first be removed via a **reviewed cleanup** — a `pgmq` delete of the
    specific `msg_id` (exact tooling agreed at run time), then `queue_length=0` re-verified — **before**
    arming.
  - **Expected evidence:** no processing (no trade), `queue_length=0` at exit.

### Oren-approved testnet arming window (L2 + L4) — one window, BTC bot, immediate disarm
**Precondition (raw-verified):** all 5 bots `trading_enabled=false`; **all non-BTC bots stay disabled
throughout.** ⚠️ **The testnet credential `2b5c038a` is shared by all 5 bots**, so L4 (credential
disable) has a **5-bot blast radius** — every non-BTC bot must be disabled before L4. Unique signal_id
per lever: `S5DRILL-<YYYYMMDD-HHMM>-L2-01` and `S5DRILL-<YYYYMMDD-HHMM>-L4-01`.

- **L2 — kill switch.** Enable BTC → arm queue → set BTC `trading_enabled=false` → fire `…-L2-01`.
  - **Expected:** **no order artifact observed — no `exchange_order_id`, no trade row; logs/audit show
    the order blocked before the exchange call** — a bot-scoped `order.blocked` audit with reason
    `trading_disabled` for the signal_id.
  - **Raw-verify:** 0 trade rows for `…-L2-01`; the `order.blocked` audit present; `enabled_bots` state.
- **L4 — disable credential.** BTC enabled + armed → set credential `status`≠`valid` → fire `…-L4-01`.
  - **Expected:** worker **fail-closes credential resolution before any exchange call** — a
    `bot.misconfigured` / credential-disable artifact; **no order artifact — no `exchange_order_id`, no
    unexpected trade row; logs/audit show the fail-close before the exchange call.**
  - **Mandatory post-L4 restore (raw-verify EACH):** credential `status='valid'`; BTC bot
    `status='active'`; BTC `trading_enabled=false`; the other 4 bots `trading_enabled=false`;
    `enabled_bots=0`.
- **Immediate disarm at window end (regardless of outcome):** `QUEUE_ENABLED=false` + Railway redeploy;
  BTC `trading_enabled=false`; then **raw-verify** `enabled_bots=0`, `queue_length=0`, credential
  `status='valid'`, BTC `status='active'`, and no open trades / dlq / recon.

> Note: L2's "disabled bot is blocked" is already covered by unit tests + the smoke gates; the live drill
> upgrades it to rehearsed E1 muscle memory. §7 decides whether the live L2/L4 window runs now or L2/L4
> are accepted on tabletop + existing evidence.

## 5. Timing
For each lever, record **time from "decide to stop" → "path verified halted"** (raw-verify complete).
Target (operator/Oren to set): a full hard stop (L1+L2) verified within a small bound (e.g. **≤ 5 min**).
A lever that cannot be verified-halted within the bound is a finding to fix before real funds.

## 6. Evidence to close A10 (E1)
- **Per lever:** engaged → **no order artifact observed — no `exchange_order_id`, no trade row, and
  logs/audit show the path blocked *before* the exchange call** → the expected fail-closed artifact
  (reject / `invalid_payload` / `order.blocked` / credential-disable) → reverted; each DB mutation
  **raw-read-back-verified** (never inferred from empty/filtered output).
- **Timing:** full-stop time measured + within the agreed bound.
- **Post-drill clean + disarmed (raw-verified):** `enabled_bots=0`, `QUEUE_ENABLED=false`,
  `queue_length=0`, no open trades/dlq/recon, **credential `status='valid'`, BTC bot `status='active'`,
  all 5 bots `trading_enabled=false`**; Railway `worker_queue_disabled`.
- Recorded as an A10 evidence note + DECISIONS.md entry. Testnet only.

## 7. Decision points (operator / Oren)
1. **Run the live L2/L4 window now**, or accept L2/L4 on tabletop + existing smoke/unit evidence and
   drill only L1/L3 cheaply? (Recommended: one short Oren-approved testnet window covering L2+L4, since
   "rehearsed" is the whole point of A10.)
2. **Rollback time target** for a hard stop (default proposal: ≤ 5 min).
3. Whether to also drill the **exchange-side** key disable (L4 hard backstop) on testnet, or document it
   as a mainnet-only manual step.

## 8. Stop conditions
- This packet is design only — **no execution, no arm/fire** until reviewed and an Oren window is granted
  for the live L2/L4 portion.
- Live drill portions are **testnet only**; immediate disarm after the window regardless of outcome.
- **No mainnet / real funds** — A10 is a gate *toward* real funds, not an authorization for them; A11
  (written real-funds approval) remains separate and ungranted.
- Any lever that fails to halt the path, or any mutation not confirmable by raw read-back → **A10 fails**;
  fix before relying on rollback with real funds.
- No secret/token value printed at any point (hidden-prompt fire tool only; rotation per A6).

## 9. What this is NOT
- Not execution, not an arming authorization, not mainnet, not real funds.
- Not a replacement for the A6 incident runbook — A10 rehearses the *rollback levers*; A6 governs the
  full incident/rotation response.

---

## 10. Revised drill plan (Codex-approved · 2026-07-05) — PLAN, NOT RUN
**Status: A10 plan = PASS (Codex). Execution remains GATED — A10 stays OPEN until the drill is actually run.**
_updated by Codex at Oren request._

**Objective:** from an armed testnet state, prove each kill switch stops execution within a target, and the system
returns to fully disarmed (`queue_length=0`), with cited evidence.

**A10 is standalone.** Default: **A10 first, H6 separate.** Sharing one arm window with H6 requires **explicit Oren
approval** — not default.

**Risk caps + preconditions:** one **dedicated testnet bot only**; **tiny cap** (`max_order_notional_usdt` at the
exchange min; small `daily_notional_cap_usdt` / `fixed_notional`); **NOT** the exposed BNBUSDT token (use another bot's
own token / a dedicated drill bot; see the BNBUSDT rotation rule); no mainnet credential; no real funds; **precondition
`open_trades=0`, `dlq=0`, `queue_length=0`.**

**Kill switches (4 layers):**
| # | Switch | Mechanism | Expected (precise) |
|---|--------|-----------|--------------------|
| **K1** | `trading_enabled=false` (DB, per-bot) | Step-4b gate per signal | enqueue → worker consumes → gate ⇒ **`order.blocked`** (no fill); message acked |
| **K2** | `QUEUE_ENABLED=false` (worker env) | read at boot ⇒ redeploy | signal **may enqueue** · worker **does NOT consume** (`worker_state=disabled`) · **no trade/order** · queue measured explicitly (message stays) ⇒ **cleanup**. **Do NOT claim no-enqueue for K2.** |
| **K3** | worker service stop (Railway) | Railway | consumption stops totally · no trade · leftover message ⇒ cleanup |
| **K4** | intake: `bots.status != active` / token rotation | webhook rejects | signal ⇒ webhook **reject** (`bot_not_active`/`invalid_secret`) · **no enqueue** · no trade |

**Queue tracking + cleanup:** record `queue_length` before/after **every** test signal; K2/K3 intentionally leave a
message ⇒ **cleanup** = `pgmq` purge/delete of that message after confirming no consumption; **final `queue_length=0`**
(raw read-back).

**Drill sequence (gated · operator-run · agent read-back between steps):**
0. Pre-check disarmed baseline + caps + token≠BNBUSDT (read-only).
1. **ARM (Oren-gated):** one bot `trading_enabled=true` + tiny caps + `QUEUE_ENABLED=true` (redeploy) → verify armed.
2. **K1:** `trading_enabled=false` → fire signal → **`order.blocked`, no fill**; queue **0→0 or transient +1→0**.
3. **K2:** `QUEUE_ENABLED=false` + redeploy → fire signal → **enqueue possible, no consume, no trade**; queue +1 (stays) → cleanup → 0.
4. **K3:** worker stop → fire signal → no consume, no trade; queue → cleanup → 0.
5. **K4:** `status != active` (or rotate token) → fire signal → **webhook reject, no enqueue**; queue 0→0.
6. **Re-disarm (mandatory):** `QUEUE_ENABLED=false` · all bots `trading_enabled=false` · worker disabled ·
   **`queue_length=0`** → raw read-back.

**Approvals:** Oren approves the **ARM** (step 1) + the drill window. Operator runs Doppler/Railway/DB + the curl (token
stays with operator). Agent runs read-only pre/post read-backs + timing + cleanup-verify.

**Rollback timing targets:** K1 next signal blocked ≤ **5s** · K2/K3 consumption stops ≤ **3 min** (redeploy/stop) ·
K4 reject ≤ **5s** · overall first-kill→disarmed+queue0 ≤ **5 min**.

**Evidence table (to fill at run):** per step — Switch · trigger time · queue before→after · effect verified · elapsed ·
verdict. **K1 row queue = `0→0 or transient +1→0`.**

**Stop conditions:** any **order FILLED** during a kill ⇒ STOP + emergency disarm + incident · kill exceeds timing ·
**K4 causes an enqueue** · unexpected trade · queue not clean at end (`queue_length≠0`) · any mainnet/real-funds ·
re-disarm read-back not clean.

**PASS:** K1–K4 within target · **zero order filled** · K4 = no-enqueue · K2/K3 = no-consume/no-trade (enqueue allowed,
cleaned) · re-disarm clean + `queue_length=0` · E1/E2 evidence per step.

**NO-GO:** any kill fails/exceeds · order filled during a kill · K4 enqueues · queue not cleaned · re-disarm not verified
· any mainnet/real-funds ⇒ kill path NOT trusted ⇒ **A10 stays OPEN, no live.**

**Standing rules carried:** execution remains **gated**; **A10 remains OPEN until the drill is actually run**; **H6 stays
separate unless Oren explicitly approves a shared window**; the **BNBUSDT exposed/local-token rule stands — rotate before
live execution.**
