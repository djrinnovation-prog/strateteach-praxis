# A1 Option B — Slice B1: ccxt fixed-IP proxy wiring (IMPLEMENTATION PACKET)

> **DOC / PLANNING — NO CODE yet.** No deploy · no Railway/Doppler · no secrets · no mainnet / no real funds. **Real funds
> remain NO-GO.** Uncommitted draft for Codex review. Implements **B1** of the A1 fallback packet
> (`production-a1-fallback-packet.md`, PASS `1047e90`): wire the worker to route **only** its Binance traffic through an
> authenticated fixed-IP proxy, **fail-closed in production**. Grounded in the actual adapter code (read-only, 2026-07-12).
>
> **Progress: 1/5 complete · Current: 2/5 — A1 static egress · Remaining: 4/5.** B1 is **A1-INDEPENDENT** — buildable +
> LOCAL-testable now, **behind a default-unset env with zero testnet behavior change**; deploy + provisioning are separate
> gated steps (B2-B8).

> **Rev 2 (2026-07-12): Codex CHANGES applied.** **Resolved the ccxt option** — `httpsProxy` (verified from installed
> ccxt **4.5.56**, `node_modules/ccxt/js/src/base/types.d.ts:577`, no longer `[UNKNOWN]`); added a **hard stop** if it
> can't be verified; explicit tests for **BOTH** ccxt instances (auth + public); a **no-direct-public-call** rule
> (production public calls must also proxy); an **evidence requirement** (proxy URL absent from thrown errors / console
> logs / audit payloads / test snapshots); and clarified **missing-proxy blocks BEFORE constructing `BinanceAdapter`**
> (constructor throw = defense-in-depth only, so no ccxt instance is ever built without a proxy in prod).

## 0. Grounding (verified)
- **[FACT] `BinanceAdapter`** (`worker/src/BinanceAdapter.ts`): constructor L237-240 `(secretsProvider, vaultSecretId,
  isProduction)`. It builds **TWO** ccxt instances — **`createAuthenticatedExchange`** (L256-257: `new ccxt.binance({
  apiKey, secret, timeout:5000 })`, used for `fetchBalance`/`createOrder`) and **`createPublicExchange`** (L274-275: `new
  ccxt.binance({ timeout:5000 })`, used for `getMarketRules`/`fetchPrice`). **Both** must route through the proxy.
  `setSandboxMode(true)` when `!isProduction` (L262/L276).
- **[FACT] Adapter build sites:** `worker/src/index.ts:884` `new BinanceAdapter(secretsProvider, cred.vault_secret_id,
  isProduction)` and `worker/src/reconciliation.ts:262` (same, via `defaultAdapterFor`). Both carry `isProduction`.
- **[FACT] Env:** `validateEnv` (`index.ts` ~L278-325) reads `process.env.*` and returns a config object; secrets are not
  logged (only presence/`DOPPLER_ENVIRONMENT`).
- **[FACT] Supabase client is separate** — `supabase-js`, not ccxt; it must NOT be routed through the exchange proxy.

## 1. Exact worker files to change
- **`worker/src/BinanceAdapter.ts`** — add a 4th constructor param `exchangeHttpsProxy: string | null`; set the ccxt
  `httpsProxy` option in **both** `createAuthenticatedExchange` and `createPublicExchange` when it is non-null; add the
  production invariant (below).
- **`worker/src/index.ts`** — `validateEnv` reads `EXCHANGE_HTTPS_PROXY`; add it to the config type; a **Step-4b
  fail-closed gate** before building the adapter; pass the value to `new BinanceAdapter(...)` at L884.
- **`worker/src/reconciliation.ts`** — thread the proxy value to `new BinanceAdapter(...)` at L262 (via `ResolveDeps` /
  `defaultAdapterFor`).
- **Tests:** `worker/src/BinanceAdapter.test.ts` + `worker/src/index.test.ts` (+ reconciliation if needed).
- **No DB/migration, no webhook change.**

## 2. How `EXCHANGE_HTTPS_PROXY` is read
- Read once in `validateEnv`: `const exchangeHttpsProxy = process.env.EXCHANGE_HTTPS_PROXY?.trim() || null` → returned in
  the config (a single source of truth), then passed to each `BinanceAdapter`. **Not** read ad-hoc elsewhere.
- Value = an **authenticated** proxy URL (e.g. `https://user:pass@host:port`). Treated as a **secret** (§6).

## 3. Production / mainnet fail-closed behavior
- **Missing proxy → BLOCK BEFORE constructing `BinanceAdapter` [CHANGE 6].** The **primary** guard is an explicit gate in
  `index.ts` Step 4b (and `reconciliation.ts`) **before** `new BinanceAdapter(...)` — so **no ccxt instance is ever
  constructed without a proxy in production.** The constructor throw is **defense-in-depth only** (a backstop if a caller
  forgets the gate), never the primary mechanism. Primary gate (mirrors the existing config gates that `return { ack:
  true }`):
  ```ts
  if (isProduction && !exchangeHttpsProxy) {
    await disableBotMisconfigured(supabase, bot, signal_id, 'exchange_proxy_missing')
    return { ack: true }   // no adapter, no order — config fault, not transient
  }
  ```
  Same in `reconciliation.ts` `defaultAdapterFor`: `if (isProduction && !exchangeHttpsProxy) return null` (fail-closed,
  trade left pending). **Defense-in-depth:** the `BinanceAdapter` **constructor throws** `if (isProduction &&
  !exchangeHttpsProxy)` so the adapter can never be built in production without a proxy even if a caller forgets the gate.
- **Proxy unreachable → exchange unavailable / retry or block; NEVER direct.** ccxt egresses **only** via the configured
  `httpsProxy`; a proxy connection error surfaces as a network error → the **existing** mapping (`getMarketRules`/
  `fetchBalance` catch → `ExchangeUnavailableError` → `ack=false` retry / or the typed-error block). **No fallback branch
  is added** — there is no "if proxy fails, try direct" code path.
- **(Unexpected egress IP → STOP)** is a monitoring/operational stop (A1 fallback §2j-mon), not a per-request code path.

## 4. Testnet behavior
- **Unchanged unless the proxy is explicitly set.** `!isProduction` → the fail-closed guard does **not** fire; the ccxt
  `httpsProxy` is set **only if** `EXCHANGE_HTTPS_PROXY` is present, else the instances are built exactly as today
  (direct, `setSandboxMode(true)`). Since the platform is testnet (`PRAXIS_IS_PRODUCTION=false`) with the env unset,
  **B1 is a no-op on testnet.**

## 5. ccxt wiring (exchange adapter ONLY)
- Set the ccxt **`httpsProxy`** option on **both** Binance instances only:
  ```ts
  // createAuthenticatedExchange:
  const exchange = new ccxt.binance({
    apiKey: credentials.apiKey, secret: credentials.apiSecret, timeout: 5000,
    ...(this.exchangeHttpsProxy ? { httpsProxy: this.exchangeHttpsProxy } : {}),
  })
  // createPublicExchange:
  const exchange = new ccxt.binance({
    timeout: 5000,
    ...(this.exchangeHttpsProxy ? { httpsProxy: this.exchangeHttpsProxy } : {}),
  })
  ```
- **Do NOT set a global `HTTPS_PROXY`/`https_proxy` env** — that would route Supabase + everything through the proxy.
- **Do NOT route Supabase/webhook traffic** through the proxy — only the two Binance ccxt instances.
- **[RESOLVED — CHANGE 1] The ccxt option is `httpsProxy`** (a `string`), verified from the **installed** package:
  **ccxt `4.5.56`**, `node_modules/ccxt/js/src/base/types.d.ts:577` — the Exchange config declares `httpsProxy?: string;`
  (siblings `socksProxy`, `wssProxy`, and the legacy `proxy`). `httpsProxy` is the correct forward/`CONNECT` proxy for
  HTTPS traffic to Binance (the legacy `proxy` is a URL-prefix mechanism, **not** what we want). Set it **in the `new
  ccxt.binance({...})` constructor options** of both instances (§5). A unit test asserts the option lands on each instance.
- **[CHANGE 4] No-direct-public-call rule:** in production/mainnet, the **public** Binance calls the worker makes
  (`getMarketRules`/`fetchPrice` via `createPublicExchange`) **MUST also go through the proxy** — they must **not** bypass
  it just because they carry no API key. Both the authenticated **and** public instances get `httpsProxy`; the production
  fail-closed guard (§3) applies before either is built.

## 6. Secret hygiene
- **`EXCHANGE_HTTPS_PROXY` = secret operational config.** **Never logged** (the startup env log prints presence/names, not
  values — confirm it does not print this value); **never included in errors or evidence**.
- **ccxt error sanitization:** a proxy network error may embed the proxy URL in its message. The worker's error mapping
  reads only `constructor.name` + `httpStatus` (`BinanceAdapter.ts:81-86`), **not** the message — so the mapped `detail`
  is clean; but any place that logs a **raw** ccxt error must **redact** a `EXCHANGE_HTTPS_PROXY`-shaped substring. Add a
  redaction + a test.

## 7. LOCAL tests
### Proxy wiring on BOTH ccxt instances [CHANGE 3]
- **prod + proxy set ⇒ AUTHENTICATED instance gets `httpsProxy`** — the `createAuthenticatedExchange` ccxt instance
  carries `httpsProxy = <proxy>`.
- **prod + proxy set ⇒ PUBLIC instance gets `httpsProxy`** — the `createPublicExchange` ccxt instance carries
  `httpsProxy = <proxy>` (no public bypass — CHANGE 4).
- **testnet + no proxy ⇒ NEITHER instance gets `httpsProxy`** — both build with `setSandboxMode(true)` and no proxy
  (unchanged).
### Fail-closed + fallback
- **prod + missing proxy ⇒ fail closed:** `isProduction=true`, `EXCHANGE_HTTPS_PROXY` unset → the **Step-4b gate** disables
  the bot (`exchange_proxy_missing`, `ack=true`, **no adapter, no ccxt instance built**); the `BinanceAdapter` constructor
  **throws** for the same case (defense-in-depth).
- **proxy error ⇒ NO direct fallback:** a proxy/network failure → `ExchangeUnavailableError` (retry, no order); assert no
  direct (non-proxied) ccxt call is made.
### Secret evidence — proxy URL is NEVER printed [CHANGE 5]
LOCAL tests must prove the proxy URL/creds appear in **NONE** of:
- **thrown errors** (assert the caught/rethrown error message + `detail` contain no `EXCHANGE_HTTPS_PROXY` substring);
- **console logs** (spy console.error/log across the adapter build + a proxy failure → no proxy URL);
- **audit payloads** (the `exchange_proxy_missing` audit `after_state` carries only ids + reason, no URL);
- **test snapshots** (no fixture/snapshot embeds the real proxy URL — tests use a dummy like `https://user:pass@proxy.test:8080`).

## 8. Rollout gates (B1 … B8 — from the A1 fallback packet)
- **B1 [this slice — Claude, NOW]:** the code above + LOCAL tests. **LOCAL-only; no deploy.** A1-independent, testnet no-op.
- **B2 [Oren]:** provision + harden the authenticated fixed-IP proxy VPS.
- **B3 [Oren]:** `EXCHANGE_HTTPS_PROXY` → Doppler/Railway (secret entry).
- **B4 [gated]:** deploy the worker **with `QUEUE_ENABLED=false`** (code live, disarmed).
- **B5 [gated]:** keyless egress-IP probe (through the proxy) → confirm the proxy IP.
- **B6 [gated]:** Binance PUBLIC-endpoint probe through the proxy → 200.
- **B7 [gated, after A4]:** authenticated READ-ONLY probe (`fetchBalance`) — only after an A4 mainnet credential exists +
  is IP-allowlisted.
- **B8 [gated, A4]:** allowlist the mainnet key to the proxy IP — only after the egress proof (B5/B6) passes.

## 9. Rollback + stop conditions
- **Rollback:** revert the `BinanceAdapter`/`index.ts`/`reconciliation.ts` change + redeploy the prior worker; unset
  `EXCHANGE_HTTPS_PROXY`. Reversible; no data change. (Testnet unaffected either way; in production, unsetting fails
  closed — safe, not silently-direct.)
- **Stop conditions:**
  - **[CHANGE 2] If the ccxt proxy option cannot be verified locally → do NOT implement B1.** (Resolved: `httpsProxy` per
    ccxt 4.5.56 `types.d.ts:577`. If a future ccxt upgrade changes/removes it → re-verify before merge; do not guess.)
  - **[CHANGE 4] Any production public Binance call that bypasses the proxy → STOP** (both instances must proxy; no
    key-less bypass).
  - Any **global `HTTPS_PROXY`** or **Supabase traffic routed through the proxy** → STOP.
  - Any **direct-Binance fallback branch** in production → STOP.
  - Any **proxy URL in a log / error / audit / evidence / snapshot** → STOP + fix redaction.
  - **No deploy without green LOCAL tests. No secrets. No mainnet.** Real funds NO-GO.

---
**Net:** B1 threads an **authenticated** `EXCHANGE_HTTPS_PROXY` into the two Binance ccxt instances (only), with a
production **fail-closed** guard (missing proxy → block adapter; unreachable → exchange-unavailable, never direct) and
strict secret hygiene, **zero testnet impact**. LOCAL-testable now, ahead of any Railway answer. **Planning only — no code
yet, no deploy, no secrets, no mainnet.**

**Progress: 1/5 complete · Current: 2/5 — A1 static egress · Remaining: 4/5.**
