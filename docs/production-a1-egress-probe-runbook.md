# A1 Option A — egress probe runbook (keyless)

**Artifact:** `worker/scripts/egress-probe.mjs` (+ `npm run egress-probe`). Companion to the EGRESS-PROOF procedure in `production-a1-option-a-native-static-egress-packet.md` §4.

**Status:** LOCAL artifact only — no deploy, no Railway change, no secrets, no Binance auth, no mainnet, no order. The probe is a standalone diagnostic; it is **not** wired into the worker runtime.

## What it does
- Captures the **outbound IPv4** from three neutral IP-echo providers (`checkip.amazonaws.com`, `api.ipify.org`, `ipv4.icanhazip.com`) and cross-checks they **agree**; computes the `/24` for reference.
- Captures **Binance PUBLIC** reachability: `GET /api/v3/ping` + `GET /api/v3/time` (no auth, no signed request, no order).
- Prints one **non-secret** JSON evidence object.

## What it deliberately does NOT do
- No secret is read or printed (only an optional non-secret `EGRESS_PROBE_REGION` label).
- No Binance API key, no signed/auth request, no account/balance endpoint, no order endpoint.
- No mainnet action. Reachability here proves the region is not blocked (`451`) — it does **not** prove or exercise Binance allowlist enforcement (no key is allowlisted until A4).

## CRITICAL — run it in the WORKER's network context
The probe must run **inside the deployed worker container** so it observes the worker's egress IP. Running it on your laptop reports **your** IP, not the worker's. Two ways:
- **`railway ssh`** into the `praxis-platform` service, then `node scripts/egress-probe.mjs` (the script ships in the repo/image).
- **or** temporarily set the worker start command to `node scripts/egress-probe.mjs`, redeploy, read the evidence from the deploy logs, then restore `npm start`.

(`railway run … node scripts/egress-probe.mjs` executes on your machine with Railway env injected — it does **not** use the worker's egress. Do not use it for the IP proof.)

## Prerequisites (from the packet)
- Worker **disarmed** (§2 checklist: `QUEUE_ENABLED=false`, `is_production=false`, `worker_state=disabled`, `enabled_bots=0`, `open_trades=0`, `queue_length=0`).
- Node >= 20 in the container (the worker image satisfies this).

## Procedure (maps to packet §4)
1. **(optional) Baseline** — run once BEFORE enabling Static Outbound IPs. Record `egress_ipv4`.
2. Enable Static Outbound IPs on the **worker service only**; **redeploy**.
3. **Probe #1** — run in-container; record `egress_ipv4` + `egress_cidr_24` + region + `ts`.
4. **Redeploy** again.
5. **Probe #2** — run in-container; record the same.
6. **Assert:** `egress_ipv4` (Probe #1) **==** `egress_ipv4` (Probe #2), `ip_providers_agree=true`, and `binance_public_reachable=true` on both. Region unchanged.
7. Record the stable `egress_ipv4` / `egress_cidr_24` + region as the **EGRESS-PROOF evidence** (the A4 allowlist target).

## Reading the evidence
| Field | Pass condition |
|---|---|
| `ip_providers_agree` | `true` (all three providers returned the same IPv4) |
| `egress_ipv4` | non-null, identical across Probe #1 and Probe #2 |
| `binance_public_reachable` | `true` (ping + time both 200; no `451`) |
| `region_label` | matches the Railway worker region you recorded |

**Any mismatch / instability / `451` / non-agreement → STOP** and consult the packet §7 stop conditions (region change, IP instability, toggle unavailable → fall back to B1/C).

## Notes
- Exit code is always 0 (diagnostic) — you assert stability by comparing the two runs, not by exit status.
- The egress IP is **non-secret** operational infra info (it is the value you will hand to Binance for the allowlist). It is safe to record in evidence; it is not a credential.
- Smoke-tested locally (structure + provider agreement + Binance public 200/200) on 2026-07-13; the authoritative run is in-container per above.
