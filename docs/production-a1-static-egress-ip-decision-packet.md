# A1 — Static Egress IP / Exchange Allowlisting (Decision Packet)

> **DOC / PLANNING — NO IMPLEMENTATION.** No deploy · no provider change · no secrets · no mainnet/real funds. Overnight
> draft, **uncommitted**, for Codex/Oren review. Pairs with `docs/production-a1-egress-binance-connectivity-packet.md`
> (if present) and the A4 credentials packet.

## Scope (planning only — explicit)
- **Planning only.** No deploy. No linked apply. No DB mutation. No Railway/Doppler change. No secrets. No mainnet / no real funds. **Real funds remain NO-GO.**
## 0. ⚠ Provider verification REQUIRED (nothing here is confirmed)
**Every provider capability in this packet is UNVERIFIED until checked with the provider.** In particular: **do NOT
assume Railway offers a static outbound/egress IP** on our plan/region — it may be a paid add-on, region-limited, or
unavailable. Treat Option A as *conditional on verification*. No path is chosen until §5 is answered.

## 1. Current hosting topology
- **Worker** — Railway service `praxis-platform` (NIXPACKS; `npm start`); places exchange orders via ccxt (testnet
  today). **Outbound IP is dynamic** by default on Railway.
- **Frontend** — Railway static service `praxis-operator-console-production` (separate; serves the console). Not on the
  execution path.
- **Supabase** — managed Postgres + Edge (project `eraxuxidsiolyvfefcez`); the DB/webhook path is separate from exchange
  egress.
- **Exchange** — Binance **testnet** now; **mainnet** later.

## 2. Why static egress matters for Binance / mainnet allowlisting
- Binance mainnet API keys can (and for safety **should**) be **IP-allowlisted**. An allowlist requires a **stable,
  known outbound IP** for the worker.
- Railway's default dynamic egress means the worker's IP can change → allowlisted key breaks, or the operator is forced
  to leave the key **un-restricted** (a serious security downgrade). **A stable egress IP is a real-funds prerequisite**
  (it's the allowlist target for every A4 mainnet key).

## 3. Options
**A — Railway-supported static outbound IP (if available on the plan).**
- *Pros:* least architecture change; worker stays where it is; one setting/add-on. *Cons:* **depends on Railway offering
  static egress** on the current plan/region (must verify — it may be a paid tier / add-on / not available). Possible
  cost + region constraints.
**B — External proxy / NAT / small VPS egress.**
- Route the worker's exchange traffic through a fixed-IP proxy (e.g., a tiny VPS running a proxy, or a NAT gateway with
  an elastic IP). Allowlist the proxy's IP.
- *Pros:* provider-agnostic; guaranteed stable IP; decoupled from Railway's capabilities. *Cons:* **extra component to
  run/secure/monitor** (the proxy is now on the critical path + a security surface); added latency; ops burden; the
  proxy must be hardened (it sees exchange traffic, though not keys if TLS-terminated at the exchange).
**C — Move worker execution to a provider with native static egress.**
- Run the execution worker on a host/provider that gives a fixed outbound IP out of the box (e.g., a VPS/cloud VM with an
  elastic IP, or a cloud NAT).
- *Pros:* clean stable IP; full control. *Cons:* **largest migration** (move the worker off Railway, redo deploy/secrets
  wiring/monitoring); more infra to own; longer calendar.

## 4. Risks / costs / operational burden (comparison)
| Option | Setup effort | Ongoing burden | Cost | Risk |
|---|---|---|---|---|
| A Railway static | low (if offered) | low | plan/add-on | availability unknown; region lock |
| B proxy/NAT | medium | medium (run+secure the proxy) | small VPS/NAT | new critical component + security surface + latency |
| C move worker | high | medium | VM/cloud | migration risk; longest calendar |

## 5. Exact questions OREN must answer / verify with the provider
1. **Does Railway offer a static outbound/egress IP** for the `praxis-platform` service on the current plan + region?
   (If yes → Option A, done.) What tier/cost?
2. If not, is Oren willing to run/secure a **proxy/NAT** (Option B) — and where (which provider, which region near the
   exchange)?
3. Or migrate the worker to a **static-egress host** (Option C)? Appetite for that migration?
4. What is the **acceptable added latency** to the exchange (proxy hop)?
5. Binance mainnet: is IP-allowlisting **required** by policy, or optional-but-recommended? (Confirms how hard A1 gates.)
6. Budget ceiling for the egress solution?

## 5a. Decision criteria (score each option against these)
- **Latency** to the exchange (extra hop for B/C).
- **Reliability / stability** of the fixed IP (does it survive redeploys/restarts?).
- **Auditability** (can we prove the egress IP + monitor for change?).
- **Operational burden** (who runs/patches/monitors it — especially B's proxy).
- **Secret exposure surface** (does the path add a component that sees traffic? keys stay TLS'd to the exchange, but the
  hop is still a surface).
- **Binance allowlist compatibility** (does the IP satisfy the exchange's allowlist format + stability expectations?).

## 6. Recommended path (conditional on §5 verification)
- **Verify Option A first** (cheapest, least change) — **only if Railway confirms static egress on our plan/region.**
- **Fallback if A is unavailable → Option B (proxy/NAT):** the pragmatic middle — stable IP without migrating the worker,
  accepting the added component (harden + monitor it).
- **Option C only if** A is unavailable and B's proxy is unacceptable — heaviest (worker migration).
- Whichever: the chosen IP becomes the **single allowlist target** for all A4 mainnet keys, and must be **monitored for
  change** (a changed egress IP = mainnet outage).

## 7. No implementation yet + stop condition
This packet is a **decision aid** — it authorizes nothing. The static-IP mechanism, its wiring, and the exchange
allowlist are **Oren/provider actions** after the decision.
- **STOP CONDITION:** **no mainnet API key may be created or allowlisted until the egress path is SELECTED and its IP is
  known** — A4 mainnet provisioning is blocked on this decision (the key's allowlist target must exist first).
- **Real funds remain NO-GO;** A1 is one of several gates.
