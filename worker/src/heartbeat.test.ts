// worker/src/heartbeat.test.ts
import { startHeartbeat, HEARTBEAT_INTERVAL_MS_DEFAULT, type HeartbeatFetch, type HeartbeatResponse } from './heartbeat';

// A capability URL that must NEVER appear in any log line (enabled / failed / disabled / stopped).
const SECRET_URL = 'https://hc-ping.com/11111111-2222-3333-4444-555555555555';

const OK: HeartbeatResponse = { ok: true, status: 200 };

/** A fetch fake that always resolves to a given response and records the urls it was called with. */
function okFetch(response: HeartbeatResponse = OK) {
  const urls: string[] = [];
  const fetchImpl: HeartbeatFetch = (url) => {
    urls.push(url);
    return Promise.resolve(response);
  };
  return { fetchImpl, urls };
}

/** Capture console.log/error lines emitted SYNCHRONOUSLY during the callback, then restore. */
function captureLogs(fn: () => void): string[] {
  const cap = startCapture();
  try {
    fn();
  } finally {
    cap.restore();
  }
  return cap.lines;
}

/** Install console spies that stay active until restore() — for capturing ASYNC (post-flush) logs. */
function startCapture() {
  const lines: string[] = [];
  const spyLog = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  const spyErr = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, restore: () => { spyLog.mockRestore(); spyErr.mockRestore(); } };
}

/** Fake interval that captures the callback and handle without scheduling anything real. */
function fakeTimer() {
  const calls: { cb: () => void; ms: number }[] = [];
  let unrefCount = 0;
  const handle = { unref: () => void unrefCount++ };
  const setIntervalImpl = (cb: () => void, ms: number) => {
    calls.push({ cb, ms });
    return handle;
  };
  const cleared: unknown[] = [];
  const clearIntervalImpl = (h: unknown) => void cleared.push(h);
  return { calls, handle, get unrefCount() { return unrefCount; }, setIntervalImpl, clearIntervalImpl, cleared };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('heartbeat — default OFF when url unset/empty', () => {
  test.each([undefined, ''])('url=%p → no-op: null handle, no fetch, no timer', (url) => {
    const { fetchImpl, urls } = okFetch();
    const timer = fakeTimer();

    let handle: ReturnType<typeof startHeartbeat> = null;
    const lines = captureLogs(() => {
      handle = startHeartbeat({ url, fetchImpl, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    });

    expect(handle).toBeNull();
    expect(urls).toHaveLength(0); // no fetch
    expect(timer.calls).toHaveLength(0); // no timer
    // one minimal disabled line, with no url / env value
    expect(lines.some((l) => l.includes('heartbeat_disabled'))).toBe(true);
    expect(lines.join('\n')).not.toContain(SECRET_URL);
  });
});

describe('heartbeat — enabled fires immediately + on interval', () => {
  test('immediate ping, interval ping, unref, stop clears', async () => {
    const { fetchImpl, urls } = okFetch();
    const timer = fakeTimer();

    const handle = startHeartbeat({
      url: SECRET_URL,
      fetchImpl,
      intervalMs: 30_000,
      setIntervalImpl: timer.setIntervalImpl,
      clearIntervalImpl: timer.clearIntervalImpl,
    });

    await flush();
    expect(urls).toEqual([SECRET_URL]); // immediate, with the right url
    expect(timer.calls).toHaveLength(1);
    expect(timer.calls[0].ms).toBe(30_000);
    expect(timer.unrefCount).toBe(1); // never keeps the process alive

    timer.calls[0].cb(); // simulate the interval firing
    await flush();
    expect(urls).toHaveLength(2);

    expect(handle).not.toBeNull();
    handle!.stop();
    expect(timer.cleared).toContain(timer.handle);
    handle!.stop(); // idempotent — clears only once
    expect(timer.cleared).toHaveLength(1);
  });

  test('default interval is HEARTBEAT_INTERVAL_MS_DEFAULT', async () => {
    const { fetchImpl } = okFetch();
    const timer = fakeTimer();
    startHeartbeat({ url: SECRET_URL, fetchImpl, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    await flush();
    expect(timer.calls[0].ms).toBe(HEARTBEAT_INTERVAL_MS_DEFAULT);
  });
});

describe('heartbeat — HTTP outcome classification', () => {
  test('a non-OK response { ok:false, status:500 } → heartbeat_failed, no throw, no url leak', async () => {
    const { fetchImpl } = okFetch({ ok: false, status: 500 });
    const timer = fakeTimer();

    const cap = startCapture();
    expect(() => {
      startHeartbeat({ url: SECRET_URL, fetchImpl, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    }).not.toThrow();
    await flush();
    cap.restore();

    const all = cap.lines.join('\n');
    expect(all).toContain('heartbeat_failed');
    expect(all).toContain('"error_type":"http_not_ok"');
    expect(all).toContain('"status":500');
    expect(all).not.toContain(SECRET_URL);
  });

  test('an OK response { ok:true, status:200 } → no failure log', async () => {
    const { fetchImpl } = okFetch({ ok: true, status: 200 });
    const timer = fakeTimer();

    const cap = startCapture();
    startHeartbeat({ url: SECRET_URL, fetchImpl, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    await flush();
    cap.restore();

    const all = cap.lines.join('\n');
    expect(all).toContain('heartbeat_enabled');
    expect(all).not.toContain('heartbeat_failed'); // success logs nothing
    expect(all).not.toContain(SECRET_URL);
  });
});

describe('heartbeat — failures never throw and never leak the url', () => {
  test('a rejecting fetch does not throw and logs only the error_type (no url)', async () => {
    const rejecting: HeartbeatFetch = () => Promise.reject(new TypeError(`fetch failed for ${SECRET_URL}`));
    const timer = fakeTimer();

    const cap = startCapture();
    expect(() => {
      startHeartbeat({ url: SECRET_URL, fetchImpl: rejecting, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    }).not.toThrow();
    await flush(); // the failure log is emitted on a microtask AFTER startHeartbeat returns
    cap.restore();

    const all = cap.lines.join('\n');
    expect(all).toContain('heartbeat_failed');
    expect(all).toContain('"error_type":"TypeError"');
    // hard secret guarantees: no url, no message text, no stack/cause keys
    expect(all).not.toContain(SECRET_URL);
    expect(all).not.toContain('fetch failed for');
    expect(all).not.toContain('"message"');
    expect(all).not.toContain('"stack"');
    expect(all).not.toContain('"cause"');
  });

  test('a synchronously-throwing fetch is also swallowed (never throws into the caller)', async () => {
    const throwing: HeartbeatFetch = () => {
      throw new Error(`boom ${SECRET_URL}`);
    };
    const timer = fakeTimer();
    const cap = startCapture();
    expect(() => {
      startHeartbeat({ url: SECRET_URL, fetchImpl: throwing, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    }).not.toThrow();
    await flush();
    cap.restore();
    const all = cap.lines.join('\n');
    expect(all).toContain('heartbeat_failed');
    expect(all).not.toContain(SECRET_URL);
  });

  test('the enabled startup log carries no url', () => {
    const { fetchImpl } = okFetch();
    const timer = fakeTimer();
    const lines = captureLogs(() => {
      startHeartbeat({ url: SECRET_URL, fetchImpl, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    });
    expect(lines.some((l) => l.includes('heartbeat_enabled'))).toBe(true);
    expect(lines.join('\n')).not.toContain(SECRET_URL);
  });
});

describe('heartbeat — fire-and-forget (non-blocking, cannot stall a caller)', () => {
  test('startHeartbeat returns synchronously even if the ping never resolves', () => {
    const neverResolves: HeartbeatFetch = () => new Promise<HeartbeatResponse>(() => {});
    const timer = fakeTimer();
    const handle = startHeartbeat({ url: SECRET_URL, fetchImpl: neverResolves, setIntervalImpl: timer.setIntervalImpl, clearIntervalImpl: timer.clearIntervalImpl });
    // We are back here synchronously with a handle — the in-flight ping did not block us.
    expect(handle).not.toBeNull();
    handle!.stop();
  });
});
