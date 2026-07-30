// worker/tools/alert-poller/run-once.test.ts
//
// Offline tests for the run-once entrypoint/config-loader. NO real DB, NO network, NO real secrets:
// the runner and the transport are injected fakes, the clock is injected, and every DSN/token here is
// a syntactically-valid but fake value. Focus areas:
//   1. config validation        — loadRunOnceConfig accepts only valid config, fails loud otherwise
//   2. secret redaction          — no DSN/token/chat leaks through the config or its describe/JSON
//   3. dry-run / fake execution  — connect→fetch(read-only)→evaluate→render, no send, no network
//   4. criteria → sender handoff — 'send' mode hands rendered text to an injected fake transport
//   5. no live Telegram / no DB  — dry-run never calls a transport; 'send' w/o transport fails loud

import {
  loadRunOnceConfig,
  loadTelegramConfig,
  describeConfig,
  runOnce,
  summaryLine,
  safeErrorLine,
  buildLiveTransport,
  RunOnceConfigError,
  ENV,
  type RunOnceConfig,
  type RunnerLike,
} from './run-once';
import { AlertRoConfig, AlertRoConfigError, PgReadonlyRunner, type PgLikeClient } from './pg-readonly-runner';
import { PollerError, type ReadonlyRunner, type ReadonlyRow } from './poller';
import { dlqSince } from '../lib/readonly-sql';
import type { FetchLike, TelegramTransport, TransportInput } from './telegram-sender';

const FAKE_PW = 'sk_live_DSNpassword_SECRET_123';
const FAKE_TOKEN = '987654321:FAKE_telegram_BOT_token_ABCDEFG';
const FAKE_CHAT = '-1009998887777';
const VALID_DSN = `postgresql://praxis_alert_ro:${FAKE_PW}@db.internal:5432/praxis?sslmode=require`;
const FIXED_NOW = '2026-06-24T12:00:00Z';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { [ENV.DSN]: VALID_DSN, ...overrides } as NodeJS.ProcessEnv;
}

// ── Fake runner: serves canned rows per alert query; records connect/run/close ──

class FakeRunner implements RunnerLike {
  connects = 0;
  closes = 0;
  ranQueries: { name: string; params: ReadonlyArray<string | number> }[] = [];
  constructor(private readonly rowsByQuery: Record<string, ReadonlyRow[]> = {}) {}
  async connect(): Promise<void> {
    this.connects++;
  }
  run: ReadonlyRunner = async (query, params) => {
    this.ranQueries.push({ name: query.name, params });
    // default: zero rows (no alert)
    return this.rowsByQuery[query.name] ?? [{ n: 0, newest: null }];
  };
  async close(): Promise<void> {
    this.closes++;
  }
}

// A runner that triggers a single DLQ alert (and nothing else).
function dlqAlertRunner(): FakeRunner {
  return new FakeRunner({
    dlq_since: [{ n: 2, newest: '2026-06-24T11:59:00Z' }],
    queue_failed_since: [{ n: 0, newest: null }],
    stuck_trades: [{ n: 0 }],
  });
}

// A transport that records what it was handed.
function recordingTransport(): { transport: TelegramTransport; sent: TransportInput[] } {
  const sent: TransportInput[] = [];
  const transport: TelegramTransport = (input) => {
    sent.push(input);
    return { ok: true, status: 200 };
  };
  return { transport, sent };
}

// A transport that must never be called.
const explodingTransport: TelegramTransport = () => {
  throw new Error('transport must not be called');
};

/** Assert a thrown config error leaks `secret` through NO surface, including the CLI's safeErrorLine. */
function assertNoEnvSecretLeak(err: unknown, secret: string): void {
  const e = err as Error;
  const util = require('util') as typeof import('util');
  const surfaces: string[] = [
    e.message,
    String(e),
    JSON.stringify(e),
    util.inspect(e, { depth: null }),
    safeErrorLine(e),
  ];
  for (const s of surfaces) expect(s).not.toContain(secret);
}

// ── 1. Config validation ───────────────────────────────────────────────────────

describe('loadRunOnceConfig — config validation', () => {
  it('loads sane defaults from just a DSN', () => {
    const c = loadRunOnceConfig(env());
    expect(c.sendMode).toBe('dry-run');
    expect(c.environment).toBe('dev');
    expect(c.deployId).toBeUndefined();
    expect(c.thresholdSeconds).toBe(300);
    expect(c.telegramConfigured).toBe(false);
    expect(c.db.redacted.user).toBe('praxis_alert_ro');
  });

  it('delegates DSN validation to AlertRoConfig (missing DSN fails loud)', () => {
    expect(() => loadRunOnceConfig(env({ [ENV.DSN]: undefined }))).toThrow(AlertRoConfigError);
  });

  it('rejects an invalid send mode', () => {
    expect(() => loadRunOnceConfig(env({ [ENV.SEND_MODE]: 'broadcast' }))).toThrow(/must be one of dry-run\|send/);
  });

  it('accepts the explicit send mode + custom labels + threshold', () => {
    const c = loadRunOnceConfig(
      env({
        [ENV.SEND_MODE]: 'send',
        [ENV.ENVIRONMENT]: 'staging',
        [ENV.DEPLOY_ID]: 'railway-abc123',
        [ENV.STUCK_THRESHOLD_SECONDS]: '120',
      }),
    );
    expect(c.sendMode).toBe('send');
    expect(c.environment).toBe('staging');
    expect(c.deployId).toBe('railway-abc123');
    expect(c.thresholdSeconds).toBe(120);
  });

  it('rejects an invalid threshold', () => {
    for (const bad of ['0', '-5', '1.5', 'abc']) {
      expect(() => loadRunOnceConfig(env({ [ENV.STUCK_THRESHOLD_SECONDS]: bad }))).toThrow(RunOnceConfigError);
    }
  });

  it('telegramConfigured is true only when BOTH token and chat id are present', () => {
    expect(loadRunOnceConfig(env({ [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN })).telegramConfigured).toBe(false);
    expect(loadRunOnceConfig(env({ [ENV.TELEGRAM_CHAT_ID]: FAKE_CHAT })).telegramConfigured).toBe(false);
    expect(
      loadRunOnceConfig(env({ [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN, [ENV.TELEGRAM_CHAT_ID]: FAKE_CHAT }))
        .telegramConfigured,
    ).toBe(true);
  });

  it('loadTelegramConfig fails loud when a secret is missing, without echoing it', () => {
    expect(() => loadTelegramConfig(env())).toThrow(/TELEGRAM_BOT_TOKEN is required/);
    expect(() => loadTelegramConfig(env({ [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN }))).toThrow(
      /TELEGRAM_CHAT_ID is required/,
    );
    const tg = loadTelegramConfig(env({ [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN, [ENV.TELEGRAM_CHAT_ID]: FAKE_CHAT }));
    expect(tg).toEqual({ botToken: FAKE_TOKEN, chatId: FAKE_CHAT });
  });
});

// ── 2. Secret redaction ─────────────────────────────────────────────────────────

describe('run-once secret redaction', () => {
  it('RunOnceConfig retains no Telegram secret and no DSN password', () => {
    const c = loadRunOnceConfig(env({ [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN, [ENV.TELEGRAM_CHAT_ID]: FAKE_CHAT }));
    // no secret-bearing own properties
    expect((c as unknown as { botToken?: unknown }).botToken).toBeUndefined();
    expect((c as unknown as { chatId?: unknown }).chatId).toBeUndefined();
    const blob = JSON.stringify(c);
    for (const secret of [FAKE_PW, FAKE_TOKEN, FAKE_CHAT]) expect(blob).not.toContain(secret);
  });

  it('describeConfig and summaryLine never contain any secret', () => {
    const c = loadRunOnceConfig(
      env({ [ENV.SEND_MODE]: 'send', [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN, [ENV.TELEGRAM_CHAT_ID]: FAKE_CHAT }),
    );
    const desc = describeConfig(c);
    expect(desc).toContain('db.internal'); // redacted host is useful
    expect(desc).toContain('telegramConfigured=true');
    const line = summaryLine(c, { sendMode: 'send', committed: true, alertCount: 0, signals: [], rendered: [] });
    for (const secret of [FAKE_PW, FAKE_TOKEN, FAKE_CHAT]) {
      expect(desc).not.toContain(secret);
      expect(line).not.toContain(secret);
    }
  });

  it('safeErrorLine surfaces only redacted/known messages, never raw unknown errors', () => {
    expect(safeErrorLine(new RunOnceConfigError('bad mode'))).toContain('bad mode');
    // an unknown error carrying a secret must NOT have its message surfaced
    expect(safeErrorLine(new Error(`boom ${FAKE_PW}`))).not.toContain(FAKE_PW);
    expect(safeErrorLine(new Error(`boom ${FAKE_PW}`))).toContain('unexpected error');
  });

  // Config errors must NEVER echo the raw env value — a secret pasted into the wrong env var would
  // otherwise reach stderr/logs via safeErrorLine. (The classic env-misconfiguration leak.)
  it('a secret pasted into PRAXIS_ALERT_SEND_MODE never leaks through any error surface', () => {
    let caught: unknown;
    try {
      loadRunOnceConfig(env({ [ENV.SEND_MODE]: FAKE_TOKEN }));
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RunOnceConfigError);
    expect((caught as Error).message).toContain(ENV.SEND_MODE); // names the env var
    assertNoEnvSecretLeak(caught, FAKE_TOKEN);
  });

  it('a secret pasted into PRAXIS_ALERT_STUCK_THRESHOLD_SECONDS never leaks through any error surface', () => {
    let caught: unknown;
    try {
      loadRunOnceConfig(env({ [ENV.STUCK_THRESHOLD_SECONDS]: FAKE_PW }));
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RunOnceConfigError);
    expect((caught as Error).message).toContain(ENV.STUCK_THRESHOLD_SECONDS); // names the env var
    assertNoEnvSecretLeak(caught, FAKE_PW);
  });
});

// ── 3. Dry-run / fake execution path ────────────────────────────────────────────

describe('runOnce — dry-run / fake execution', () => {
  it('connects, fetches the three read-only alert queries, renders the alert, sends nothing', async () => {
    const runner = dlqAlertRunner();
    const config = loadRunOnceConfig(env()); // dry-run
    const result = await runOnce(config, { runner, now: () => FIXED_NOW });

    expect(runner.connects).toBe(1);
    expect(runner.closes).toBe(1);
    expect(runner.ranQueries.map((q) => q.name)).toEqual(['dlq_since', 'queue_failed_since', 'stuck_trades']);
    expect(result.committed).toBe(true);
    expect(result.alertCount).toBe(1);
    expect(result.signals).toEqual(['dlq']);
    expect(result.rendered[0]).toContain('event=dlq_alert');
    expect(result.rendered[0]).toContain('count=2');
    expect(result.outcomes).toBeUndefined(); // dry-run never sends
  });

  it('reports zero alerts cleanly when evidence is all-zero', async () => {
    const runner = new FakeRunner(); // all queries default to n=0
    const result = await runOnce(loadRunOnceConfig(env()), { runner, now: () => FIXED_NOW });
    expect(result.alertCount).toBe(0);
    expect(result.rendered).toEqual([]);
    expect(runner.closes).toBe(1);
  });

  it('always closes the runner, even when evaluation throws', async () => {
    // A malformed row (n is a string) makes the evidence layer throw — close() must still run.
    const runner = new FakeRunner({ dlq_since: [{ n: 'oops' as unknown as number, newest: null }] });
    await expect(runOnce(loadRunOnceConfig(env()), { runner, now: () => FIXED_NOW })).rejects.toThrow();
    expect(runner.connects).toBe(1);
    expect(runner.closes).toBe(1);
  });

  it('loadRunOnceConfig alone connects to nothing (no execution on config load)', () => {
    const runner = new FakeRunner();
    loadRunOnceConfig(env());
    expect(runner.connects).toBe(0); // nothing invoked the runner
  });
});

// ── 4. Criteria → sender handoff (with fakes) ───────────────────────────────────

describe('runOnce — criteria → sender handoff', () => {
  it("'send' mode hands the rendered safe text to the injected transport and classifies delivery", async () => {
    const runner = dlqAlertRunner();
    const { transport, sent } = recordingTransport();
    const config = loadRunOnceConfig(env({ [ENV.SEND_MODE]: 'send' }));

    const result = await runOnce(config, { runner, transport, now: () => FIXED_NOW });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes?.[0].status).toBe('delivered');
    expect(result.outcomes?.[0].signal).toBe('dlq');
    // the transport received EXACTLY the rendered text — and only { text }, never a secret
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ text: result.rendered[0] });
    expect(Object.keys(sent[0])).toEqual(['text']);
  });

  it("'send' mode with NO transport fails loud (no network by default)", async () => {
    const runner = dlqAlertRunner();
    const config = loadRunOnceConfig(env({ [ENV.SEND_MODE]: 'send' }));
    await expect(runOnce(config, { runner, now: () => FIXED_NOW })).rejects.toThrow(/requires an injected transport/);
    expect(runner.closes).toBe(1); // still closed
  });
});

// ── 5. No live Telegram / no real DB ────────────────────────────────────────────

describe('runOnce — no live send / no network', () => {
  it('dry-run never calls the transport even if one is provided', async () => {
    const runner = dlqAlertRunner();
    const config = loadRunOnceConfig(env()); // dry-run
    const result = await runOnce(config, { runner, transport: explodingTransport, now: () => FIXED_NOW });
    // explodingTransport would throw if called; reaching here proves it was not called
    expect(result.alertCount).toBe(1);
    expect(result.outcomes).toBeUndefined();
  });

  it("'send' mode with no alerts does not call the transport", async () => {
    const runner = new FakeRunner(); // zero alerts
    const config = loadRunOnceConfig(env({ [ENV.SEND_MODE]: 'send' }));
    const result = await runOnce(config, { runner, transport: explodingTransport, now: () => FIXED_NOW });
    expect(result.alertCount).toBe(0);
    expect(result.outcomes).toBeUndefined();
  });
});

// ── 6. Integration: real PgReadonlyRunner + pg Date normalization (the live failure repro) ──────

// A raw pg-like client that dispatches canned rows by SQL text (SET statements return no rows).
class DispatchPgClient implements PgLikeClient {
  texts: string[] = [];
  constructor(private readonly rowsBySql: Record<string, Record<string, unknown>[]> = {}) {}
  async connect(): Promise<void> {}
  async query(text: string): Promise<{ rows: Record<string, unknown>[] }> {
    this.texts.push(text);
    if (/^SET\b/i.test(text)) return { rows: [] };
    return { rows: this.rowsBySql[text] ?? [{ n: 0, newest: null }] };
  }
  async end(): Promise<void> {}
}

describe('runOnce — integration with real PgReadonlyRunner (pg Date normalization)', () => {
  it('a pg Date in newest is normalized → ISO and the dry-run path SUCCEEDS (repro of the live PollerError)', async () => {
    const when = new Date('2026-06-24T11:59:00.000Z'); // pg returns timestamptz as a Date
    const client = new DispatchPgClient({ [dlqSince.sql]: [{ n: 1, newest: when }] });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), { clientFactory: () => client });

    const result = await runOnce(loadRunOnceConfig(env()), { runner, now: () => FIXED_NOW });

    expect(result.alertCount).toBe(1);
    expect(result.signals).toEqual(['dlq']);
    expect(result.rendered[0]).toContain('newest=2026-06-24T11:59:00.000Z'); // Date → ISO end-to-end
    expect(result.outcomes).toBeUndefined(); // dry-run
  });
});

// ── 7. Failure path: a PollerError stays generic (no message/cause leak via safeErrorLine) ──────

describe('safeErrorLine — PollerError stays generic', () => {
  it('keeps a PollerError generic even when its message/cause embed a secret', () => {
    const e = new PollerError(`boom ${FAKE_PW}`, new Error(`cause ${FAKE_PW}`));
    const line = safeErrorLine(e);
    expect(line).toBe('unexpected error (PollerError)');
    expect(line).not.toContain(FAKE_PW);
  });
});

// ── 8. Live Telegram transport wiring (send-slice; fake fetch — no network, no real secret) ──────

describe('buildLiveTransport + send-mode wiring', () => {
  const tgCreds = { [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN, [ENV.TELEGRAM_CHAT_ID]: FAKE_CHAT };

  it('dry-run does NOT send: a live-style transport is never invoked (no fetch)', async () => {
    let fetchCalls = 0;
    const fetchImpl: FetchLike = async () => {
      fetchCalls++;
      return { ok: true, status: 200 };
    };
    const transport = buildLiveTransport(env(tgCreds), fetchImpl);
    const result = await runOnce(loadRunOnceConfig(env()), { runner: dlqAlertRunner(), transport, now: () => FIXED_NOW });
    expect(result.outcomes).toBeUndefined();
    expect(fetchCalls).toBe(0);
  });

  it('send mode delivers EXACTLY ONE message via the fake fetch (one alert → one call)', async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    const transport = buildLiveTransport(env(tgCreds), fetchImpl);
    const result = await runOnce(loadRunOnceConfig(env({ ...tgCreds, [ENV.SEND_MODE]: 'send' })), {
      runner: dlqAlertRunner(),
      transport,
      now: () => FIXED_NOW,
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes?.[0].status).toBe('delivered');
    expect(result.outcomes?.[0].httpStatus).toBe(200);
    expect(calls).toHaveLength(1); // exactly one send
    // the egress boundary legitimately composes the token URL + chat_id body; the BODY text is the safe render
    const body = JSON.parse(calls[0].init.body);
    expect(body.text).toBe(result.rendered[0]);
  });

  it('buildLiveTransport fails loud on a missing Telegram secret, without echoing it', () => {
    expect(() => buildLiveTransport(env())).toThrow(/TELEGRAM_BOT_TOKEN is required/);
    try {
      buildLiveTransport(env({ [ENV.TELEGRAM_BOT_TOKEN]: FAKE_TOKEN }));
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/TELEGRAM_CHAT_ID is required/);
      expect((e as Error).message).not.toContain(FAKE_TOKEN);
    }
  });

  it('a fetch THROW is classified failed — token/chat/URL never leak into the outcome', async () => {
    // the thrown error embeds the token-bearing URL — sendAlert must swallow it
    const fetchImpl: FetchLike = async (url) => {
      throw new Error(`net down ${url}`);
    };
    const transport = buildLiveTransport(env(tgCreds), fetchImpl);
    const result = await runOnce(loadRunOnceConfig(env({ ...tgCreds, [ENV.SEND_MODE]: 'send' })), {
      runner: dlqAlertRunner(),
      transport,
      now: () => FIXED_NOW,
    });
    expect(result.outcomes?.[0].status).toBe('failed');
    expect(result.outcomes?.[0].reason).toBe('transport_error');
    const blob = JSON.stringify(result.outcomes);
    expect(blob).not.toContain(FAKE_TOKEN);
    expect(blob).not.toContain(FAKE_CHAT);
  });

  it('a non-OK HTTP is classified failed with the status, no secret', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: false, status: 401 });
    const transport = buildLiveTransport(env(tgCreds), fetchImpl);
    const result = await runOnce(loadRunOnceConfig(env({ ...tgCreds, [ENV.SEND_MODE]: 'send' })), {
      runner: dlqAlertRunner(),
      transport,
      now: () => FIXED_NOW,
    });
    expect(result.outcomes?.[0].status).toBe('failed');
    expect(result.outcomes?.[0].httpStatus).toBe(401);
    expect(result.outcomes?.[0].reason).toBe('http_not_ok');
    expect(JSON.stringify(result.outcomes)).not.toContain(FAKE_TOKEN);
  });

  it('summaryLine, rendered, and outcomes carry NO Telegram secret', async () => {
    const fetchImpl: FetchLike = async () => ({ ok: true, status: 200 });
    const transport = buildLiveTransport(env(tgCreds), fetchImpl);
    const config = loadRunOnceConfig(env({ ...tgCreds, [ENV.SEND_MODE]: 'send' }));
    const result = await runOnce(config, { runner: dlqAlertRunner(), transport, now: () => FIXED_NOW });
    const surfaces = [summaryLine(config, result), ...result.rendered, JSON.stringify(result.outcomes)];
    for (const s of surfaces) {
      expect(s).not.toContain(FAKE_TOKEN);
      expect(s).not.toContain(FAKE_CHAT);
      expect(s).not.toContain(FAKE_PW);
    }
  });
});
