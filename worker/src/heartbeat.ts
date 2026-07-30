/**
 * heartbeat.ts — S4-1 dead-man heartbeat (Healthchecks.io), default OFF.
 *
 * Pings HEALTHCHECKS_URL on its OWN timer so an external monitor can detect a dead/hung worker.
 * Strictly out-of-band from trading:
 *   - started in main() ONLY (never pollOnce / processMessage / runWorker loop)
 *   - fire-and-forget: callers never await a ping; startHeartbeat returns synchronously
 *   - failures are swallowed + classified, never thrown into startup or the poll loop
 *   - the interval is unref()'d so it can never keep the process alive or delay shutdown
 *
 * Secret hygiene: HEALTHCHECKS_URL is a capability URL — it is NEVER logged. Failures log only the
 * error CONSTRUCTOR NAME (no message / stack / cause / url). The url lives only inside this module's
 * closures and is passed to the injected fetch.
 *
 * Dependency injection (for tests): fetchImpl, setIntervalImpl/clearIntervalImpl, intervalMs. The
 * defaults use the Node 20 globals; tests pass fakes so no real network / real timer is used.
 */

export const HEARTBEAT_INTERVAL_MS_DEFAULT = 60_000;

/** Minimal fetch shape — resolves to the response's ok flag + status (we don't read the body). */
export type HeartbeatResponse = { ok: boolean; status?: number };
export type HeartbeatFetch = (url: string) => Promise<HeartbeatResponse>;

type IntervalHandle = { unref?: () => void };
type SetIntervalLike = (handler: () => void, ms: number) => IntervalHandle;
type ClearIntervalLike = (handle: IntervalHandle) => void;

export interface StartHeartbeatOptions {
  /** HEALTHCHECKS_URL. Undefined/empty → disabled (no timer, no fetch). NEVER logged. */
  url?: string;
  /** Injected fetch (default: global fetch). */
  fetchImpl?: HeartbeatFetch;
  intervalMs?: number;
  setIntervalImpl?: SetIntervalLike;
  clearIntervalImpl?: ClearIntervalLike;
}

export interface HeartbeatHandle {
  stop(): void;
}

const defaultFetch: HeartbeatFetch = async (url) => {
  // Node 20 provides a global fetch. GET is the Healthchecks ping convention. We inspect ONLY
  // ok/status — never the body — because native fetch resolves even on 4xx/5xx.
  const res = await (globalThis as { fetch: (u: string, init?: unknown) => Promise<HeartbeatResponse> }).fetch(url, {
    method: 'GET',
  });
  return { ok: res.ok, status: res.status };
};

/**
 * Fire one ping. Returns void — never awaited by callers. A non-OK HTTP response (ok === false),
 * an async rejection, OR a synchronous throw is each treated as a failure: swallowed and logged as
 * heartbeat_failed with NO url / message / stack / cause. A successful (ok) response logs nothing.
 */
function pingOnce(url: string, fetchImpl: HeartbeatFetch): void {
  // Promise.resolve().then(...) ensures even a SYNCHRONOUS throw from fetchImpl lands in .catch,
  // so this function can never throw into its caller.
  void Promise.resolve()
    .then(() => fetchImpl(url))
    .then((res) => {
      // Native fetch resolves on 4xx/5xx — a non-OK status is a heartbeat failure, not a success.
      if (!res || res.ok !== true) {
        console.log(
          JSON.stringify({
            event: 'heartbeat_failed',
            error_type: 'http_not_ok',
            status: typeof res?.status === 'number' ? res.status : undefined,
          }),
        );
      }
      // ok === true → success → log nothing (no per-minute spam).
    })
    .catch((e: unknown) => {
      console.log(
        JSON.stringify({
          event: 'heartbeat_failed',
          error_type: e instanceof Error ? e.constructor.name : 'unknown',
        }),
      );
    });
}

/**
 * Start the heartbeat. Returns null when disabled (url unset/empty); otherwise returns a handle whose
 * stop() clears the timer. Pings once immediately, then every intervalMs. The url is never logged.
 */
export function startHeartbeat(opts: StartHeartbeatOptions = {}): HeartbeatHandle | null {
  const url = opts.url;
  if (typeof url !== 'string' || url === '') {
    // Default OFF: one minimal structured line, no url, no env value, no timer, no fetch.
    console.log(JSON.stringify({ event: 'heartbeat_disabled' }));
    return null;
  }

  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS_DEFAULT;
  const setIntervalImpl = opts.setIntervalImpl ?? (setInterval as unknown as SetIntervalLike);
  const clearIntervalImpl = opts.clearIntervalImpl ?? (clearInterval as unknown as ClearIntervalLike);

  console.log(JSON.stringify({ event: 'heartbeat_enabled', interval_ms: intervalMs }));

  pingOnce(url, fetchImpl); // immediate, fire-and-forget

  const handle = setIntervalImpl(() => pingOnce(url, fetchImpl), intervalMs);
  // Never let the heartbeat keep the process alive or delay shutdown.
  if (typeof handle.unref === 'function') handle.unref();

  let stopped = false;
  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearIntervalImpl(handle);
      console.log(JSON.stringify({ event: 'heartbeat_stopped' }));
    },
  };
}
