# A1 Packet — Egress / Railway Region / Binance Connectivity

> **DOC / DESIGN ONLY — NOT EXECUTION.** No Binance probe · no region change · no API-key change ·
> no Doppler/Railway change · no mainnet/real funds. Defines the requirement, the read-only checks,
> connectivity-proof method (no orders), closing evidence, stop conditions, and fallbacks. Scope =
> the **worker → Binance** outbound path only (webhook **ingress** = [A5](production-a5-webhook-tradingview-hardening-packet.md)).

## 1. Current evidence (prior incidents)
- **Binance `451` (geo-block), testnet:** the worker's egress initially landed in a Binance-blocked
  region → `451`. **Cleared by moving the Railway service to EU-West** (Register `380d6df6`). This is
  a **region** fix, observed on **testnet**; **mainnet geo-policy is not proven** by it.
- **`order_not_found_after_timeout` / swallowed diagnostics:** `createOrder` timeouts could surface
  as an opaque `ExchangeUnavailableError`. Fixed in `f07ef5a` — the original ccxt class + httpStatus
  is preserved as a **non-secret** `detail` (e.g. `ExchangeNotAvailable:http_451`), so an egress/geo
  failure is now **observable** in logs instead of silent. (Confirmed again by the `fetchPrice`
  `ExchangeNotAvailable:http_451` adapter test.)
- **Fail-closed today:** any Binance unavailability → `ExchangeUnavailableError` → transient retry,
  **no order, no pending trade**. So an egress regression is a **liveness** problem (can't trade),
  never a **safety** one (won't mis-trade). A1 makes egress *correct + evidenced*, not *safe* (it is).

## 2. Production requirement
1. **Region-compliant egress** for Binance **mainnet** (verified, not inferred from testnet EU-West).
2. **Static / allowlist-grade egress IP** (one IP, or a small fixed set) so the mainnet API key can be
   **IP-restricted** to it.
3. **Key IP-allowlist enabled** — mainnet key restricted to the static egress IP (defence in depth).
4. Mainnet reachability **proven read-only** before any order.

## 3. Railway region / egress assumptions (to confirm — read-only)
- **Region:** worker service in **EU-West** (testnet 451 cleared there). Mainnet allowed from EU-West:
  **TO CONFIRM** (Binance public docs / support — read-only).
- **Egress IP:** Railway default egress is **shared/dynamic** → not allowlist-grade. Whether the
  current plan offers a **static outbound IP** is **TO CONFIRM** (Railway dashboard — read-only).
- **No Railway CLI** on the operator machine (per infra notes) — Railway inspection is via the
  **dashboard** (read-only) or, later, an approved runtime egress-IP probe (§5), not a local CLI.

## 4. Exact read-only checks needed (no execution in this packet)
All are read-only / inspection; **none** mutates Railway, Doppler, or the key:
1. **Railway service region** — dashboard → service → region = EU-West (confirm).
2. **Static outbound IP availability** — dashboard → networking/egress: does the plan expose a static
   egress IP? (yes → Option A; no → Option B/C in §7).
3. **Current egress IP value** — determined later by an **approved** read-only probe (§5), since the
   dashboard may not display the live egress IP. (IP value is **not** a secret.)
4. **Binance mainnet region policy** — Binance docs/support: is API access from EU-West permitted for
   the intended account? (read-only research.)
5. **Binance API key IP-restriction capability** — confirm the key settings page supports IP allowlist
   (it does; documents the closing E2 step). **Do not change the key in this packet.**

## 5. Proving Binance connectivity WITHOUT placing orders
The worker already has read-only Exchange calls — use those, never `createOrder`:
- **Public, unauthenticated:** `fetchPrice` (ccxt `fetchTicker`) / `loadMarkets` / server-time ping —
  a 200 proves the egress region is not geo-blocked (no key needed). A `451` here = region block.
- **Authenticated read:** `fetchBalance` (read-only; the worker uses it for sizing) — a 200 proves the
  **key + IP** are accepted by mainnet **without** moving funds.
- **Sequence (all read-only, each its own approved step, testnet-first):**
  1. Testnet public ping + `fetchBalance` from the prod egress → 200 (re-confirms the known-good path).
  2. **Mainnet public ping** from the prod egress → 200, not `451` (region proof).
  3. **Mainnet `fetchBalance`** (read-only) from the prod egress with the IP-restricted key → 200
     (key + IP + region proof).
- **Hard rule:** **no `createOrder` / no order of any size** is part of A1. Connectivity is proven by
  reads only. The first *order* belongs to the controlled smoke (testnet) and later, separately, a
  mainnet first-money smoke — both Oren-gated, not here.

## 6. Evidence that closes A1 (E1 + E2)
- **E1:** the mainnet **read-only** probe (§5 step 3) returns 200 from the documented prod egress IP —
  command + (non-secret) result + date recorded.
- **E2:** the static egress IP (or set) documented + reproducible, **and** the Binance mainnet key's
  IP-restriction list shows exactly that IP. (IP recorded; key/secret never recorded.)
- A1 is **MET** only when both hold **and** Oren signs off on mainnet. Until then mainnet stays gated.

## 7. Static egress IP — required or not?
- **For connectivity (clearing 451):** a *region-compliant* IP suffices; it need **not** be static.
- **For the key IP-allowlist (a MUST control with real funds):** a **static** IP **is required** — you
  cannot safely restrict a mainnet key to a rotating/shared IP.
- **Conclusion:** **static egress IP IS required for production real funds** (because the key-IP
  allowlist is MUST). A non-static IP is acceptable only for read-only connectivity testing, never for
  a live mainnet key.

### Options (pick by: allowlist-grade stability · least new secret · cost/latency · simplicity)
| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Railway native static egress** | Use Railway's static-outbound-IP if the plan offers it | Simplest; no new hop/secret | Availability TO CONFIRM; possible plan tier |
| **B. Static-IP egress proxy** | Route Binance calls via a fixed-IP forward proxy | Deterministic IP; provider-managed | New **secret** (proxy creds) → Doppler + hygiene; latency; SPOF |
| **C. Self-managed NAT / fixed-IP host** | Egress hop on a host with a static IP in an allowed region | Full IP/region control | Most ops overhead; we own uptime/patching |
| **D. No key-IP-restriction** | Don't pin the key | No new infra | **Rejected** — fails the MUST control |

Lean: **A if available**, else **B**; **C** only if A/B fail; **D** rejected.

## 8. Stop conditions
- **No mainnet anything** (probe, key change, order) without explicit Oren approval — this packet is design.
- **Do not enable the key IP-restriction before the static egress IP is confirmed + reachability
  proven** — doing so out of order locks the worker out of mainnet.
- **No `createOrder`** as part of A1 — connectivity is reads only.
- **No region change / no proxy / no secret** introduced in this packet (each is a separate approved step; proxy creds follow [S5-A6](sprint5-s5-a6-incident-rotation-runbook.md) hygiene — Doppler-only, never printed/argv/logged).
- Mainnet region policy unclear, or no static-IP path available → **stop and escalate to Oren**; never "try it live."

## 9. Rollback / fallback
- A1 introduces no live change, so there is nothing to roll back from *this packet*. For the later
  approved steps:
  - If a mainnet probe returns `451`/`403`: revert any region/egress change, stay on the last known
    config; the worker remains fail-closed (no orders) meanwhile. Do **not** loosen the key.
  - If the key was IP-restricted to a wrong/again-rotating IP and the worker can't reach mainnet:
    treat as an incident — correct the IP allowlist (operator, key settings) before resuming; never
    remove the restriction to "get trading working."
  - Fallback posture: remain **testnet-only** (current `exchange_environment=testnet`) until A1 closes.

---

## Egress readiness assessment (Codex PASS · 2026-07-05) — read-only discovery
_updated by Codex at Oren request._

**Status:**
- **A1 testnet egress readiness = GO.**
- **A1 real-funds egress readiness = OPEN / NO-GO.**
- **A1 is NOT fully closed.**

**Recorded findings:**
- **Code-level egress separation only** (not network-level isolation).
- **No exchange path observed** in the **webhook / frontend** tracked source **and deployed bundle** (webhook = supabase-js
  + `pgmq_send`; frontend = anon key only, `exchange_environment` is a read-only display field).
- **Only the worker has ccxt** in current source (`worker/package.json`); BinanceAdapter (worker) is the sole exchange
  client, constructed after the Step-4b gates.
- **Testnet/mainnet guard exists** — `isProduction` → `setSandboxMode(true)` when `!isProduction` +
  `assertExchangeEnvironment` (fail-closed, pre-adapter).
- **Binance testnet egress previously proven** (WB6 E1, Railway, region-fixed).
- **Mainnet egress NOT tested** (no mainnet credential).
- **Network-level egress allowlist MISSING** (Railway does not restrict outbound).
- **Deployed worker artifact proof PENDING** — the image also compiles `spike-*` (exchange-capable dev scripts); prove
  only the intended entrypoint (`dist/index.js`) runs and no sidecar/dev/spike can call the exchange.
- **StrateTeach direct ccxt / order / withdraw paths = NO-GO** until blocked/removed or routed via Praxis (Stone-2
  M5: S1 order / S2 withdraw / S9 direct ccxt).
- **Scanner/backtest PUBLIC market-data egress is separate** from private exchange-execution egress (allowed).

**Hardening before real funds:**
- **H-A1-1** network egress allowlist (worker: only exchange endpoints; deny all other outbound).
- **H-A1-2** CI guard / route inventory / bundle grep (fail build if ccxt/adapter imported outside worker Execution
  Core; webhook + frontend bundles clean in CI).
- **H-A1-3** deployed worker artifact proof (only intended entrypoint; `spike-*`/dev tools excluded or unreachable).
- **H-A1-4** block StrateTeach direct exchange paths (M6/M7; route only via the Praxis signal contract).
- **H-A1-5** mainnet egress validation — after A11 + gates + a mainnet credential.
