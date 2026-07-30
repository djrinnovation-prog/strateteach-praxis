// egress.ts — A1 exchange-egress mode resolution (B0).
//
// The worker must reach Binance from a fixed, allowlisted source IP. Two supported models, EXPLICIT:
//   - proxy  : route ccxt through EXCHANGE_HTTPS_PROXY (A1 Option B; a fixed-IP forward proxy).
//   - native : Railway native static outbound IPs (A1 Option A) — direct egress, NO proxy.
// In PRODUCTION exactly one must be configured. An unset/unknown egress model is FAIL-CLOSED (never an
// implicit "no proxy = direct" — native egress must be a deliberate, logged choice). Testnet is unaffected
// (sandbox mode; no external IP allowlist to satisfy).

export interface EgressConfig {
  /** Fixed-IP forward proxy URL for exchange egress, or null. Non-null ⇒ proxy mode. */
  proxy: string | null
  /** True iff EXCHANGE_EGRESS_MODE === 'native' — production may egress directly via the static IPs (no proxy). */
  nativeAllowed: boolean
}

/** Resolve egress config from env. Native is an EXPLICIT opt-in; any other value (or unset) ⇒ not native. */
export function resolveEgress(env: Record<string, string | undefined>): EgressConfig {
  return {
    proxy: env.EXCHANGE_HTTPS_PROXY?.trim() || null,
    nativeAllowed: env.EXCHANGE_EGRESS_MODE === 'native',
  }
}

/**
 * In production, egress is OK iff a proxy is set OR native egress is explicitly declared. Testnet: always OK.
 * A production worker with neither is fail-closed (the caller blocks BEFORE any adapter/exchange call).
 */
export function productionEgressOk(isProduction: boolean, e: EgressConfig): boolean {
  if (!isProduction) return true
  return Boolean(e.proxy) || e.nativeAllowed
}

/** Non-secret label of the configured egress mode, for startup/observability logs. */
export function egressModeLabel(e: EgressConfig): 'proxy' | 'native' | 'unset' {
  if (e.proxy) return 'proxy'
  if (e.nativeAllowed) return 'native'
  return 'unset'
}
