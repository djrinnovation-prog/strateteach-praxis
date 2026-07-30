/**
 * EP1b — single source of truth for the venues the WORKER has code-validated end-to-end support for.
 *
 * This is the SECOND of two independent fail-closed gates that guard every money path (the first is
 * `exchanges.is_active` in the DB). A DB row may be is_active=true, but the worker still refuses any
 * ccxt_id not in this set — so activating a venue in the DB is NECESSARY BUT NOT SUFFICIENT; the venue
 * must ALSO be code-proven here. The set grows by exactly one entry per venue as each passes its EP2
 * testnet validation. Fail-closed by omission.
 *
 * Both the live order path (index.ts, Step 4a.6) and the reconciliation path (reconciliation.ts,
 * defaultAdapterFor) read this, so the two adapter-construction factories can never disagree about
 * which venues are permitted.
 */
export const SUPPORTED_EXCHANGES: ReadonlySet<string> = new Set<string>(['binance'])

/** True iff the worker has code-validated support for this ccxt exchange id. */
export function isSupportedExchange(ccxtId: string): boolean {
  return SUPPORTED_EXCHANGES.has(ccxtId)
}
