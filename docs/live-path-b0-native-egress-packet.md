# LIVE-PATH — B0 packet: production execution with A1 Option A native static egress

Reconcile the worker's "production REQUIRES a proxy" invariant with the decided A1 **Option A native Railway
static egress** (no proxy). Make the egress model EXPLICIT (native vs proxy), so production can run
proxy-less **only** when native egress is deliberately declared. **Packet only — no code changes until Codex
PASS, no deploy, no env change, no order.**

## 1. Exact code path — current production requires `EXCHANGE_HTTPS_PROXY`
Three fail-closed enforcement points (verified in source):
- `worker/src/index.ts:809,811` — `isProduction = PRAXIS_IS_PRODUCTION==='true'`;
  `exchangeHttpsProxy = EXCHANGE_HTTPS_PROXY?.trim() || null`.
- `worker/src/index.ts:894-895` (Step 4b, BUY gate):
  `if (isProduction && !exchangeHttpsProxy) throw new SizingUnavailableError('exchange_proxy_missing')`.
- `worker/src/index.ts:907` — `new BinanceAdapter(secretsProvider, cred.vault_secret_id, isProduction, exchangeHttpsProxy)`.
- `worker/src/BinanceAdapter.ts:265-266` (ctor invariant):
  `if (this.isProduction && !this.exchangeHttpsProxy) throw new Error('BinanceAdapter: exchange proxy required in production (EXCHANGE_HTTPS_PROXY missing)')`.
- `worker/src/reconciliation.ts:273` (`defaultAdapterFor`): `if (isProduction && !exchangeHttpsProxy) return null` (no adapter → trade left pending).
- Static guard `worker/src/binance-adapter-callsites.test.ts` — asserts every `new BinanceAdapter(` passes the
  4th (proxy) arg, so no call site can drop it.

**Consequence:** with native egress (no proxy), flipping `PRAXIS_IS_PRODUCTION=true` makes Step 4b throw
`exchange_proxy_missing` on every BUY, and reconciliation returns no adapter → **nothing executes**. This is
the B0 blocker.

## 2. Proposed fix — explicit egress mode (native | proxy), fail-closed by default
Change the invariant from "production ⇒ proxy" to **"production ⇒ proxy-set OR native-egress explicitly
declared"**. Native must be an EXPLICIT opt-in — an unset config still fails closed (no implicit "no proxy = ok").

New pure helper (e.g. `worker/src/egress.ts`, unit-tested):
```ts
export interface EgressConfig { proxy: string | null; nativeAllowed: boolean }
export function resolveEgress(env: Record<string,string|undefined>): EgressConfig {
  return {
    proxy: env.EXCHANGE_HTTPS_PROXY?.trim() || null,
    nativeAllowed: env.EXCHANGE_EGRESS_MODE === 'native',   // EXPLICIT opt-in only
  }
}
/** In production, egress is OK iff a proxy is set OR native egress is explicitly declared. Testnet: always OK. */
export function productionEgressOk(isProduction: boolean, e: EgressConfig): boolean {
  if (!isProduction) return true
  return Boolean(e.proxy) || e.nativeAllowed
}
```
Wire-in (minimal, all three points):
- `index.ts` Step 4b: read `{ proxy, nativeAllowed } = resolveEgress(process.env)`; gate becomes
  `if (isProduction && !proxy && !nativeAllowed) throw new SizingUnavailableError('exchange_egress_unconfigured')`
  (clearer than `exchange_proxy_missing`).
- `BinanceAdapter` ctor: add a 5th param `nativeEgressAllowed = false`; invariant becomes
  `if (isProduction && !exchangeHttpsProxy && !nativeEgressAllowed) throw new Error('BinanceAdapter: exchange egress unconfigured in production (need EXCHANGE_HTTPS_PROXY or EXCHANGE_EGRESS_MODE=native)')`.
  Factories unchanged — `httpsProxy` is still spread ONLY when a proxy is set, so native mode = **direct**
  egress via Railway's static IPs.
- `reconciliation.ts` `defaultAdapterFor`: `if (isProduction && !proxy && !nativeAllowed) return null`; thread
  `nativeAllowed` through `ResolveDeps` and pass the 5th ctor arg.
- Startup/env log (`index.ts:331`, `validateEnv`): add `exchange_egress_mode` (`native`/`proxy`/`unset`) so the
  deployed mode is observable (non-secret).
- Static guard test: update to require BOTH egress args (4th proxy + 5th nativeEgressAllowed) at every call
  site — so a future edit can't silently drop egress safety.

## 3. Env / flag model (explicit, not implicit)
| Var | Values | Meaning |
|---|---|---|
| `EXCHANGE_EGRESS_MODE` | `native` \| `proxy` \| (unset) | egress path. **native** = Railway native static outbound IPs, no proxy. **proxy** = use `EXCHANGE_HTTPS_PROXY`. unset in production ⇒ fail-closed. |
| `EXCHANGE_HTTPS_PROXY` | url \| (unset) | proxy URL; used only in proxy mode. |

Production is allowed iff: (`EXCHANGE_HTTPS_PROXY` set) **or** (`EXCHANGE_EGRESS_MODE=native`). Neither ⇒
`exchange_egress_unconfigured` (fail-closed). **For tiny-live (A11): set `EXCHANGE_EGRESS_MODE=native`, no
proxy.** Testnet is unaffected (isProduction=false ⇒ always OK, sandbox mode).

## 4. Tests (worker jest, mocked — to add/adjust)
- **production + no proxy + `EXCHANGE_EGRESS_MODE=native` ⇒ ALLOWED** — Step 4b does NOT throw
  `exchange_egress_unconfigured`; `BinanceAdapter` constructs; ccxt built **without** `httpsProxy` (direct).
- **production + no proxy + mode unset/other ⇒ FAIL-CLOSED** — Step 4b throws `exchange_egress_unconfigured`;
  `defaultAdapterFor` returns null; ctor throws. No order path reached.
- **production + proxy set ⇒ proxy mode** — ccxt built **with** `httpsProxy`; unchanged from today.
- **testnet (isProduction=false) unchanged** — no gate, sandbox mode, no proxy needed, regardless of egress mode.
- `resolveEgress` / `productionEgressOk` pure-unit tests (native/proxy/unset matrix).
- Update the existing `production BUY + missing exchange proxy → …` test (now asserts
  `exchange_egress_unconfigured` when neither proxy nor native) and the callsites static guard (5 args).

## 5. Deployment plan (operator; after Codex PASS + commit)
1. Commit + push the B0 change.
2. Set `EXCHANGE_EGRESS_MODE=native` in the worker's Doppler config (no proxy). **Keep
   `PRAXIS_IS_PRODUCTION=false` for now** — so the B0 deploy exercises no production path (testnet behavior
   unchanged; zero live risk).
3. Redeploy the worker (Railway). Verify the startup log shows `exchange_egress_mode=native` and
   `is_production=false`.
This lands the code + native-egress config **inert** — production trading is still gated behind the A11 tier
flip. A11 later flips `PRAXIS_IS_PRODUCTION=true`, at which point native egress is honored (no proxy required).

## 6. Rollback plan
- Redeploy the prior worker build (Railway "Redeploy" of the previous deployment) — reverts to the
  proxy-required invariant. Since `PRAXIS_IS_PRODUCTION` is still `false` during the B0 deploy, there is no
  live-trading exposure to roll back.
- Or unset `EXCHANGE_EGRESS_MODE` — production would then fail-closed again (safe), but that only matters once
  the tier is flipped.

## 7. A11 impact
- **Unblocks A11's tier flip.** With `EXCHANGE_EGRESS_MODE=native`, `PRAXIS_IS_PRODUCTION=true` no longer
  fail-closes with `exchange_proxy_missing`; the worker egresses **directly via the 3 Railway static IPs**
  (which the mainnet key allowlists — proven by the egress probe + the read-only validation run). The order
  path can execute.
- **Preserves the safety property.** Production still refuses to trade if egress is unconfigured — native is
  an explicit, logged choice; an accidental proxy-less production stays fail-closed.
- **No proxy to deploy.** The dormant B1 proxy remains a fallback only; native mode needs nothing new besides
  the flag.

## Boundaries
Packet only — no code changed, no deploy, no env change, no tier flip, no order. On Codex PASS I implement
locally (helper + wiring + tests), run the worker suite, and report; deployment + the `EXCHANGE_EGRESS_MODE`
env are separate operator steps.
