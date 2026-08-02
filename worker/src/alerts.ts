/**
 * alerts.ts — operator alert sink for critical, actionable events (default OFF). Mainnet Plan v1.1 · 1.5.
 *
 * Posts a COMPACT JSON to ALERT_WEBHOOK_URL for rare, operator-actionable events (credential invalidated,
 * mainnet auth-attention pause, mainnet master-switch engaged, etc.) so an operator is notified out-of-band
 * from the logs. Complements the dead-man heartbeat (which only says "the worker is alive").
 *
 * Same safety discipline as heartbeat.ts:
 *   - default OFF: no ALERT_WEBHOOK_URL ⇒ emitAlert is a silent no-op (no fetch).
 *   - fire-and-forget: emitAlert returns void; callers never await it and it can NEVER throw into the
 *     trade/validate path (a sync throw or async rejection is swallowed + logged as alert_failed).
 *   - secret hygiene: the URL is NEVER logged; the payload carries ONLY the event name + caller-supplied
 *     NON-SECRET fields (ids/reasons) — never a key, balance, vault_secret_id, or exchange response.
 *
 * Dependency-injected fetch for tests. Module-level config is set once from main() via configureAlerts().
 */

export type AlertFields = Record<string, string | number | boolean | undefined>;
export type AlertResponse = { ok: boolean; status?: number };
export type AlertFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<AlertResponse>;

let alertUrl: string | undefined;
let alertFetch: AlertFetch | undefined;

const defaultFetch: AlertFetch = async (url, init) => {
  const res = await (globalThis as { fetch: (u: string, i?: unknown) => Promise<AlertResponse> }).fetch(url, init);
  return { ok: res.ok, status: res.status };
};

/**
 * Configure the alert sink once at startup. Empty/undefined url ⇒ alerts stay OFF (emitAlert is a no-op).
 * Logs a single enabled/disabled line (never the url). Injectable fetch for tests.
 */
export function configureAlerts(opts: { url?: string; fetchImpl?: AlertFetch } = {}): void {
  alertUrl = typeof opts.url === 'string' && opts.url !== '' ? opts.url : undefined;
  alertFetch = opts.fetchImpl ?? defaultFetch;
  console.log(JSON.stringify({ event: alertUrl ? 'alerts_enabled' : 'alerts_disabled' }));
}

/** Test/shutdown helper: clear module config so alerts are OFF again. */
export function resetAlertsForTest(): void {
  alertUrl = undefined;
  alertFetch = undefined;
}

/**
 * Fire one alert. No-op when disabled. NEVER throws, NEVER awaited. `fields` MUST be non-secret (event name
 * + ids/reasons only). A non-OK response, async rejection, or sync throw is swallowed + logged as
 * alert_failed with the error CONSTRUCTOR NAME only (no url / message / stack).
 */
export function emitAlert(event: string, fields: AlertFields = {}): void {
  const url = alertUrl;
  const fetchImpl = alertFetch;
  if (!url || !fetchImpl) return; // default OFF
  const body = JSON.stringify({ source: 'praxis-worker', event, ...fields });
  void Promise.resolve()
    .then(() => fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
    .then((res) => {
      if (!res || res.ok !== true) {
        console.log(JSON.stringify({ event: 'alert_failed', alert_event: event, error_type: 'http_not_ok', status: typeof res?.status === 'number' ? res.status : undefined }));
      }
    })
    .catch((e: unknown) => {
      console.log(JSON.stringify({ event: 'alert_failed', alert_event: event, error_type: e instanceof Error ? e.constructor.name : 'unknown' }));
    });
}
