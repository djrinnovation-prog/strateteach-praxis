# A1 Option A — Railway native static outbound IP: egress-proof packet — **Rev 2**

**Status:** PLANNING / RUNBOOK ONLY — no code (Option A is a Railway network setting, not a code change), no deploy by Claude, no linked DB apply, no Railway/Doppler by Claude, no secrets, no mainnet / no real funds. The proof steps are **operator-executed**; Claude does read-backs + records evidence only.

**What this is:** the execution/proof runbook for the A1 **EGRESS-PROOF** stage gate on the **Option A (Railway native static outbound IP)** path — operationalizing the decision-plan §5a-A acceptance criteria (`docs/production-a1-static-egress-decision-plan.md`) with the Rev 2 hardening additions below. Option A is now the front-runner because Railway offers native Static Outbound IPs on our plan (operator-confirmed; see §3). **B1 proxy stays fallback-only and is NOT deployed.**

**Grounded facts:** the **worker (`praxis-platform`, NIXPACKS, `npm start`) is the SOLE exchange egress** (ccxt exists only in the worker; webhook/frontend have no exchange path). Option A needs **zero worker code** — it is a Railway service setting. `worker/railway.json` pins **no region** (region is a Railway dashboard setting) → region MUST be captured as evidence (§3/§4). B1 proxy code shipped dormant (`732ebfb`/`9ee7c81`); it activates only if `EXCHANGE_HTTPS_PROXY` is set — it stays unset under Option A.

---

## 1. Service scope (Rev 2 #1) — worker ONLY

Enable **Static Outbound IPs on the worker service `praxis-platform` and nothing else**:
- ✅ `praxis-platform` (worker) — the only exchange egress.
- ❌ NOT the frontend / operator console (`praxis-operator-console-production`) — static HTML, no exchange path.
- ❌ NOT any other service (DB, cron, unrelated).
- **Rationale:** only the worker talks to Binance; enabling static egress elsewhere adds cost + attack surface for zero benefit and muddies the allowlist story (A4 allowlists exactly one IP/CIDR — the worker's).
- **Read-back:** after enabling, confirm in the Railway dashboard that Static Outbound IPs is ON for `praxis-platform` and OFF for every other service. Record the per-service state.

## 2. Disarmed precondition (Rev 2 #2) — verify BEFORE toggling/redeploy

The toggle triggers a worker redeploy. Do it only while the worker is fully disarmed. Claude reads each back (read-only); operator does not proceed if any fails:

| Precondition | Where to read (read-only) | Required |
|---|---|---|
| `QUEUE_ENABLED=false` | Railway worker env / worker boot log `queue_enabled` | false |
| `is_production=false` | `worker_status.is_production` / boot log `is_production` | false |
| `worker_state` disabled/disarmed | `worker_status.worker_state` | `disabled` |
| `enabled_bots = 0` | `select count(*) from bots where trading_enabled = true and deleted_at is null` | 0 |
| `open_trades = 0` | `select count(*) from trades where status in ('pending','unknown') and deleted_at is null` | 0 |
| `queue_length = 0` | pgmq queue depth for `trade_signals` (metrics/RPC read) | 0 |
| no secret/mainnet change | — | none in this operation |

If any precondition is not met → **STOP** (see §7). No secrets are read or changed at any point.

## 3. Railway facts (Rev 2 #3) — recorded accurately (operator-confirmed)

Recorded from Railway (operator-relayed; the empirical §4 proof supersedes any doc claim):
- **Pro-plan feature** — Static Outbound IPs requires the Railway Pro plan.
- **Outbound IPv4 only** — it fixes the *egress* (outbound) IPv4 address. It is **NOT** an inbound/static public endpoint (we need none — the worker only makes outbound calls).
- **IPs may be shared** with other Railway customers on the same egress — so the IP proves *our egress origin*, not exclusivity. (Binance allowlisting still works: allowlisting a shared egress IP permits our key from that IP; it does not grant anyone else our key.)
- **Stable across redeploys within the same region** — the outbound IP does not change on redeploy/restart while the region is unchanged. (This is exactly what §4 proves empirically.)
- **Changes if the region changes** — a region move changes the outbound IP → would break a Binance allowlist. Therefore the **region is part of the evidence** and is pinned/change-controlled after proof.
- **Record the region** (Railway dashboard → worker service → region) alongside the IP/CIDR in the evidence table.

## 4. Egress proof procedure (Rev 2 #4) — operator-executed, keyless

The proof runs a **keyless egress probe from the worker's network context** (so it observes the worker's actual outbound IP), before/after redeploys.

**Probe design (to be authored LOCAL at execution — tiny, no deploy of trading behavior):**
- A plain read-only **HTTPS GET to a neutral IP-echo** (e.g. `https://checkip.amazonaws.com` or `https://api.ipify.org?format=json`). Output = the observed egress IP only.
- **NO auth, NO Binance, NO order, NO secret, NO signed request.** Neutral endpoint deliberately separates "what is our egress IP" from "can we reach Binance" (§5).
- Run in the worker network context (Railway one-off `railway run` / a temporary diagnostic command / `railway ssh`), operator-executed.

**Procedure:**
1. **(optional) Baseline:** run the probe BEFORE enabling → record the current (dynamic) egress IP/CIDR + region (useful to show the change).
2. **Enable** Static Outbound IPs on `praxis-platform` only (§1).
3. **Redeploy** the worker.
4. **Probe #1** → record IP/CIDR + region + timestamp.
5. **Redeploy** the worker again.
6. **Probe #2** → record IP/CIDR + region + timestamp.
7. **Assert:** Probe #1 IP/CIDR **==** Probe #2 IP/CIDR (and region unchanged). Mismatch → STOP (§7).
8. **Record** the stable IP/CIDR + region as the **EGRESS-PROOF gate evidence** — this is the value A4 will Binance-allowlist.

**Evidence record (to fill):**

| Field | Value |
|---|---|
| Railway region (worker) | `____` |
| Baseline egress IP (pre-enable, optional) | `____` |
| Probe #1 IP/CIDR (post-enable, redeploy 1) | `____` |
| Probe #2 IP/CIDR (redeploy 2) | `____` |
| Probe #1 == Probe #2 ? | `Y / N` |
| Static IP ON: worker only? others OFF? | `Y / N` |
| Timestamps (probe1 / probe2) | `____` |

## 5. Binance public reachability proof (Rev 2 #5) — public only

After the IP is stable (§4), prove Binance is **reachable** from that IP:
- **Public endpoints ONLY:** `GET /api/v3/ping` and `GET /api/v3/time`.
- **NO auth, NO API key, NO signed request, NO order.**
- **This proves REACHABILITY (no `451`/region block) from the static IP — it does NOT prove or exercise Binance allowlist enforcement** (no key is allowlisted yet; allowlisting happens in A4). A `451` here = a **region** problem (revisit region/region-move), not an allowlist problem.
- Record: ping/time HTTP status + observed egress IP (should match §4).

## 6. A4 boundary (Rev 2 #6) — authenticated read-only is LATER

An **authenticated** read-only Binance check (e.g. a private read endpoint) is the separate **LIVE-READONLY-PROOF** stage and happens **only after**:
- an A4 mainnet credential row exists (provisioned per the A4 packets), AND
- the key is IP-allowlisted to the §4 IP/CIDR, AND
- **no balances/amounts are printed** (status/reachability only), AND
- **no order endpoints** are touched.

Not in this packet. A1 Option A stops at keyless egress + public Binance reachability.

## 7. Stop conditions (Rev 2 #7) — any ⇒ STOP

- Region changed (or a region move is proposed) — re-prove from scratch; do not allowlist a pre-move IP.
- IP/CIDR unstable across the two redeploys (Probe #1 != Probe #2).
- Worker not fully disarmed (any §2 precondition unmet).
- Any production/mainnet flag enabled (`is_production`, `QUEUE_ENABLED`, arming) during the operation.
- Any secret required or changed.
- Any order or **authenticated** Binance call attempted (A1 is keyless + public only).
- The Static Outbound IP toggle is unavailable on the worker service (plan/region limitation) → Option A not available → §8 fallback.

## 8. Decision (Rev 2 #8)

- **Proof passes (stable IP across redeploys + public Binance reachable):** **A1 Option A SELECTED.** Record the IP/CIDR + region as the allowlist target for A4. **B1 proxy stays FALLBACK-ONLY and is NOT deployed** — its code remains dormant (`EXCHANGE_HTTPS_PROXY` unset); no proxy is provisioned.
- **Proof fails** (toggle unavailable / IP unstable / region-locked incompatible): fall back to the **B1 (fixed-IP forward proxy) vs C (move worker)** decision from the fallback packet — B1 is buildable/deployable next, C is the heavier migration.

This advances the A1 ladder: DESIGN ✅ → PROVIDER-DECISION ✅ (Railway offers Option A) → **EGRESS-PROOF (this packet, on execution)** → ALLOWLIST-READY (A4) → LIVE-READONLY-PROOF (A4). A1 stays **incomplete** until EGRESS-PROOF evidence is recorded green. Real funds NO-GO.

---

## Rev 2 summary

- **Scope tightened (#1):** worker service ONLY; frontend/console/others explicitly OFF; per-service read-back.
- **Disarmed precondition (#2):** 7-item pre-toggle read-back checklist (QUEUE_ENABLED/is_production/worker_state/enabled_bots/open_trades/queue_length + no secret/mainnet), each with a read-only source; STOP if any fails.
- **Railway facts recorded accurately (#3):** Pro feature; outbound IPv4 only; not inbound; IPs may be shared; stable across same-region redeploys; changes with region; **region recorded as evidence**; empirical proof supersedes docs.
- **Egress proof (#4):** optional baseline → enable → redeploy → probe → redeploy → probe → assert same IP/CIDR → record for A4 allowlist. Keyless neutral IP-echo probe (no auth/Binance/order/secret), operator-run in the worker network context; probe to be authored LOCAL at execution (no trading-behavior deploy). Evidence table included.
- **Binance public proof (#5):** `/ping` + `/time` only; no auth/signed/order; proves reachability (no 451), NOT allowlist enforcement.
- **A4 boundary (#6):** authenticated read-only deferred to LIVE-READONLY-PROOF; only after A4 credential + IP-allowlist; no balances printed; no order endpoints.
- **Stop conditions (#7):** region change / IP instability / not-disarmed / any prod-mainnet flag / any secret / any order-or-auth call / toggle unavailable.
- **Decision (#8):** pass ⇒ Option A selected, B1 fallback-only + not deployed; fail ⇒ B1/C fallback.
- **Confirmation:** planning/runbook only — no code, no deploy, no linked apply, no Railway/Doppler by Claude, no secrets, no mainnet / no real funds. Execution steps are operator-run; Claude read-backs + records evidence.

*Prepared for Codex review at Oren request.*
