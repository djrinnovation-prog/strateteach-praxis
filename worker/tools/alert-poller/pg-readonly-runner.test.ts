// worker/tools/alert-poller/pg-readonly-runner.test.ts
//
// Offline tests for the real read-only DB runner + config/redaction boundary. NO real database, NO
// real secrets: the pg driver is never loaded (a fake client factory is injected) and every DSN
// here is a syntactically-valid but fake local value. Four focus areas:
//   1. config validation        — AlertRoConfig.fromEnv accepts only a valid praxis_alert_ro DSN
//   2. secret redaction          — no path (describe/toString/toJSON/inspect/error) leaks a password
//   3. read-only execution       — connect hardens the session; run() is a thin SELECT pass-through
//   4. no mutation SQL           — a non-SELECT / multi-statement / off-table query never hits the wire

import {
  AlertRoConfig,
  AlertRoConfigError,
  PgReadonlyRunner,
  ReadonlyRunnerError,
  redactDsn,
  DEFAULT_STATEMENT_TIMEOUT_MS,
  APPLICATION_NAME,
  type ClientFactory,
  type ClientFactoryOptions,
  type PgLikeClient,
} from './pg-readonly-runner';
import { dlqSince, queueFailedSince, stuckTrades, type ReadonlyQuery } from '../lib/readonly-sql';
import type { ReadonlyRow } from './poller';
// Imported to prove the leak is closed through the run-once CLI path too (safeErrorLine surfaces
// AlertRoConfigError.message to stderr).
import { safeErrorLine } from './run-once';

// A fake password that looks token-like, so redaction tests are meaningful.
const FAKE_PW = 'sk_live_abc123SECRETtoken456';
const VALID_DSN = `postgresql://praxis_alert_ro:${FAKE_PW}@db.internal:5432/praxis?sslmode=require`;

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { PRAXIS_ALERT_RO_DSN: VALID_DSN, ...overrides } as NodeJS.ProcessEnv;
}

// ── Fake client / factory (the pg driver is NEVER loaded) ──────────────────────

interface FakeOpts {
  connectErr?: Error;
  /** Fails the connect-time `SET ...` hardening statements. */
  setQueryErr?: Error;
  /** Fails a post-connect DATA query (anything not starting with SET) — the real run() path. */
  dataQueryErr?: Error;
  /** Raw driver rows — may contain non-scalar values (e.g. a Date) to exercise normalization. */
  rows?: Record<string, unknown>[];
}

class FakeClient implements PgLikeClient {
  connected = false;
  ended = false;
  queries: { text: string; values?: ReadonlyArray<unknown> }[] = [];
  constructor(private readonly opts: FakeOpts = {}) {}
  async connect(): Promise<void> {
    if (this.opts.connectErr) throw this.opts.connectErr;
    this.connected = true;
  }
  async query(text: string, values?: ReadonlyArray<unknown>): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    const isSet = /^SET\b/i.test(text);
    if (isSet && this.opts.setQueryErr) throw this.opts.setQueryErr;
    if (!isSet && this.opts.dataQueryErr) throw this.opts.dataQueryErr;
    return { rows: this.opts.rows ?? [] };
  }
  async end(): Promise<void> {
    this.ended = true;
  }
}

/**
 * Assert a thrown error leaks the fake password through NO surface: message, String(), JSON, inspect,
 * every own property (enumerable or not), and that the raw `cause` was not retained.
 */
function assertNoSecretLeak(err: unknown): void {
  expect(err).toBeInstanceOf(ReadonlyRunnerError);
  const e = err as ReadonlyRunnerError;
  const util = require('util') as typeof import('util');
  const surfaces: string[] = [
    e.message,
    String(e),
    JSON.stringify(e),
    util.inspect(e, { depth: null }),
  ];
  for (const k of Object.getOwnPropertyNames(e)) {
    const v = (e as unknown as Record<string, unknown>)[k];
    surfaces.push(typeof v === 'string' ? v : JSON.stringify(v ?? ''));
  }
  for (const s of surfaces) expect(s).not.toContain(FAKE_PW);
  // the raw cause must NOT be retained anywhere on the error
  expect((e as unknown as { cause?: unknown }).cause).toBeUndefined();
}

function fakeFactory(client: FakeClient): { factory: ClientFactory; calls: ClientFactoryOptions[] } {
  const calls: ClientFactoryOptions[] = [];
  const factory: ClientFactory = (opts) => {
    calls.push(opts);
    return client;
  };
  return { factory, calls };
}

// A deliberately mutating "query" that should never reach a driver.
function mutating(sql: string, name = 'evil'): ReadonlyQuery {
  return { name, table: 'trades', sql, params: [] };
}

// ── 1. Config validation ───────────────────────────────────────────────────────

describe('AlertRoConfig.fromEnv — config validation', () => {
  it('accepts a valid praxis_alert_ro DSN and exposes a redacted descriptor', () => {
    const cfg = AlertRoConfig.fromEnv(env());
    expect(cfg.redacted).toEqual({
      protocol: 'postgresql:',
      user: 'praxis_alert_ro',
      host: 'db.internal',
      port: '5432',
      database: 'praxis',
    });
    expect(cfg.statementTimeoutMs).toBe(DEFAULT_STATEMENT_TIMEOUT_MS);
    expect(cfg.applicationName).toBe(APPLICATION_NAME);
    // connectionString() is the only path that returns the secret.
    expect(cfg.connectionString()).toBe(VALID_DSN);
  });

  it('accepts the postgres:// scheme too', () => {
    const dsn = `postgres://praxis_alert_ro:${FAKE_PW}@h:5432/praxis`;
    expect(() => AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: dsn }))).not.toThrow();
  });

  it('throws when PRAXIS_ALERT_RO_DSN is unset or blank', () => {
    expect(() => AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: undefined }))).toThrow(AlertRoConfigError);
    expect(() => AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: '   ' }))).toThrow(/not set/);
  });

  it('throws on an unparseable DSN WITHOUT echoing the raw value', () => {
    const raw = `not a url ${FAKE_PW}`;
    try {
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: raw }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AlertRoConfigError);
      expect((e as Error).message).not.toContain(FAKE_PW);
    }
  });

  it('rejects a non-postgres scheme', () => {
    const dsn = `mysql://praxis_alert_ro:${FAKE_PW}@h:3306/praxis`;
    expect(() => AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: dsn }))).toThrow(/unsupported scheme/);
  });

  it('refuses any user that is not praxis_alert_ro (service_role / postgres / etc.)', () => {
    for (const user of ['service_role', 'postgres', 'supabase_admin', 'authenticator', 'anon']) {
      const dsn = `postgresql://${user}:${FAKE_PW}@h:5432/praxis`;
      expect(() => AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: dsn }))).toThrow(/must be "praxis_alert_ro"/);
    }
  });

  it('the wrong-user error mentions service_role is not permitted, and never the password', () => {
    const dsn = `postgresql://service_role:${FAKE_PW}@h:5432/praxis`;
    try {
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: dsn }));
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/service_role/);
      expect(msg).not.toContain(FAKE_PW);
    }
  });

  it('requires a password, a host, and a database name', () => {
    expect(() =>
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: 'postgresql://praxis_alert_ro@h:5432/praxis' })),
    ).toThrow(/missing a password/);
    expect(() =>
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: `postgresql://praxis_alert_ro:${FAKE_PW}@h:5432/` })),
    ).toThrow(/missing a database/);
  });

  it('honors a valid custom statement timeout and rejects invalid ones', () => {
    const ok = AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS: '8000' }));
    expect(ok.statementTimeoutMs).toBe(8000);
    for (const bad of ['0', '-1', '1.5', 'abc', '0x10']) {
      expect(() => AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS: bad }))).toThrow(
        AlertRoConfigError,
      );
    }
  });
});

// ── 1b. Config errors never echo raw env/DSN values ─────────────────────────────

/** Assert a thrown config error leaks `secret` through NO surface, including the run-once CLI path. */
function assertNoConfigSecretLeak(err: unknown, secret: string): void {
  expect(err).toBeInstanceOf(AlertRoConfigError);
  const e = err as Error;
  const util = require('util') as typeof import('util');
  const surfaces: string[] = [
    e.message,
    String(e),
    JSON.stringify(e),
    util.inspect(e, { depth: null }),
    safeErrorLine(e), // the run-once CLI surfaces AlertRoConfigError.message — must also be clean
  ];
  for (const k of Object.getOwnPropertyNames(e)) {
    const v = (e as unknown as Record<string, unknown>)[k];
    surfaces.push(typeof v === 'string' ? v : JSON.stringify(v ?? ''));
  }
  for (const s of surfaces) expect(s).not.toContain(secret);
}

describe('AlertRoConfig.fromEnv — config errors never echo raw values', () => {
  const SECRET = 'sk_live_LEAKME_SECRET_999';

  it('a secret in PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS never leaks (through any surface or safeErrorLine)', () => {
    let caught: unknown;
    try {
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS: SECRET }));
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toContain('PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS'); // names the var
    assertNoConfigSecretLeak(caught, SECRET);
  });

  it('a secret-looking DSN username never leaks', () => {
    const dsn = `postgresql://${SECRET}:pw@db.internal:5432/praxis`;
    let caught: unknown;
    try {
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: dsn }));
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    // still names the required role (the EXPECTED constant), but never the supplied username
    expect((caught as Error).message).toContain('praxis_alert_ro');
    assertNoConfigSecretLeak(caught, SECRET);
  });

  it('an unsupported scheme carrying a marker never leaks', () => {
    const SCHEME_MARKER = 'leakyschemesecret123'; // lowercase, URL-scheme-valid
    const dsn = `${SCHEME_MARKER}://praxis_alert_ro:pw@db.internal:5432/praxis`;
    let caught: unknown;
    try {
      AlertRoConfig.fromEnv(env({ PRAXIS_ALERT_RO_DSN: dsn }));
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toMatch(/unsupported scheme/);
    assertNoConfigSecretLeak(caught, SCHEME_MARKER);
  });
});

// ── 2. Secret redaction ─────────────────────────────────────────────────────────

describe('secret redaction — password must never leak', () => {
  it('redactDsn masks the password and strips query params', () => {
    expect(redactDsn(VALID_DSN)).toBe('postgresql://praxis_alert_ro:***@db.internal:5432/praxis');
    expect(redactDsn(VALID_DSN)).not.toContain(FAKE_PW);
  });

  it('redactDsn handles a missing port / no auth / unparseable input without leaking', () => {
    expect(redactDsn(`postgresql://praxis_alert_ro:${FAKE_PW}@h/db`)).toBe(
      'postgresql://praxis_alert_ro:***@h/db',
    );
    expect(redactDsn('postgresql://h:5432/db')).toBe('postgresql://h:5432/db');
    expect(redactDsn(`garbage ${FAKE_PW}`)).toBe('[unparseable-dsn-redacted]');
    expect(redactDsn(`garbage ${FAKE_PW}`)).not.toContain(FAKE_PW);
  });

  it('no AlertRoConfig serialization path contains the password', () => {
    const cfg = AlertRoConfig.fromEnv(env());
    const util = require('util') as typeof import('util');
    const surfaces = [
      cfg.describe(),
      cfg.toString(),
      `${cfg}`,
      JSON.stringify(cfg),
      JSON.stringify(cfg.redacted),
      util.inspect(cfg),
    ];
    for (const s of surfaces) expect(s).not.toContain(FAKE_PW);
    // ...while the connection string DOES still carry it (for the driver only).
    expect(cfg.connectionString()).toContain(FAKE_PW);
  });

  it('the DSN is a true-private field — never enumerable via spread / Object.keys / clone (L-5)', () => {
    const cfg = AlertRoConfig.fromEnv(env());

    // 1. Own keys must not include a DSN-bearing property, and none of the enumerated
    //    key names or values may carry the password.
    const keys = Object.keys(cfg);
    expect(keys).not.toContain('dsn');
    for (const k of keys) expect(k).not.toContain(FAKE_PW);

    // 2. Object spread copies only enumerable own props — the password must not ride along.
    const spread = { ...cfg } as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(spread, 'dsn')).toBe(false);
    expect(JSON.stringify(spread)).not.toContain(FAKE_PW);

    // 3. Object.entries / getOwnPropertyNames (enumerable + non-enumerable) must be clean.
    for (const [, v] of Object.entries(cfg)) {
      expect(JSON.stringify(v ?? '')).not.toContain(FAKE_PW);
    }
    for (const name of Object.getOwnPropertyNames(cfg)) {
      const v = (cfg as unknown as Record<string, unknown>)[name];
      expect(name).not.toContain(FAKE_PW);
      expect(typeof v === 'string' ? v : JSON.stringify(v ?? '')).not.toContain(FAKE_PW);
    }

    // 4. structuredClone walks enumerable own props too — the password must not survive it.
    //    (toJSON returns the redacted descriptor, and #dsn is unreachable to the cloner.)
    expect(JSON.stringify(structuredClone(cfg.toJSON()))).not.toContain(FAKE_PW);
    expect(JSON.stringify(structuredClone(spread))).not.toContain(FAKE_PW);

    // ...but the private accessor still yields the secret for the driver.
    expect(cfg.connectionString()).toContain(FAKE_PW);
  });
});

// ── 3. Read-only execution boundary ─────────────────────────────────────────────

describe('PgReadonlyRunner — read-only execution boundary', () => {
  it('connect() builds the client with the config and hardens the session read-only', async () => {
    const client = new FakeClient();
    const { factory, calls } = fakeFactory(client);
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), { clientFactory: factory });

    await runner.connect();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      connectionString: VALID_DSN,
      applicationName: APPLICATION_NAME,
      statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
    });
    expect(client.connected).toBe(true);
    expect(client.queries.map((q) => q.text)).toEqual([
      'SET default_transaction_read_only = on',
      `SET statement_timeout = ${DEFAULT_STATEMENT_TIMEOUT_MS}`,
    ]);
  });

  it('run() passes the vetted SELECT + bound params straight through and returns rows', async () => {
    const rows: ReadonlyRow[] = [{ n: 2, newest: '2026-06-23T00:00:00Z' }];
    const client = new FakeClient({ rows });
    const { factory } = fakeFactory(client);
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), { clientFactory: factory });
    await runner.connect();

    const out = await runner.run(dlqSince, ['2026-06-01T00:00:00Z']);

    // run() returns a normalized copy (scalar values pass through unchanged → deep-equal, not same ref)
    expect(out).toEqual(rows);
    const last = client.queries[client.queries.length - 1];
    expect(last.text).toBe(dlqSince.sql);
    expect(last.values).toEqual(['2026-06-01T00:00:00Z']);
  });

  it('run() normalizes a pg Date (timestamptz) column to an ISO string', async () => {
    const when = new Date('2026-06-24T11:59:00.000Z');
    const client = new FakeClient({ rows: [{ n: 1, newest: when }] });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), { clientFactory: fakeFactory(client).factory });
    await runner.connect();

    const out = await runner.run(dlqSince, ['1970-01-01T00:00:00Z']);

    expect(out).toEqual([{ n: 1, newest: '2026-06-24T11:59:00.000Z' }]);
    expect(typeof out[0].newest).toBe('string');
  });

  it('run() fails loud on an unsupported non-scalar column — names column + type, never the value', async () => {
    const client = new FakeClient({ rows: [{ n: 1, weird: { secret: 'do-not-leak' } }] });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), { clientFactory: fakeFactory(client).factory });
    await runner.connect();

    let caught: unknown;
    try {
      await runner.run(dlqSince, ['1970-01-01T00:00:00Z']);
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ReadonlyRunnerError);
    const msg = (caught as Error).message;
    expect(msg).toContain('weird'); // the column
    expect(msg).toContain('(object)'); // the JS type
    expect(msg).not.toContain('do-not-leak'); // never the value
    assertNoSecretLeak(caught); // no raw cause / no leak across any surface
  });

  it('the bound run() can be used directly as a ReadonlyRunner for all three alert queries', async () => {
    const client = new FakeClient({ rows: [{ n: 0, newest: null }] });
    const { factory } = fakeFactory(client);
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), { clientFactory: factory });
    await runner.connect();
    const run = runner.run; // detached reference — must stay bound
    await run(dlqSince, ['1970-01-01T00:00:00Z']);
    await run(queueFailedSince, ['1970-01-01T00:00:00Z']);
    await run(stuckTrades, [300]);
    expect(client.queries.map((q) => q.text).slice(2)).toEqual([
      dlqSince.sql,
      queueFailedSince.sql,
      stuckTrades.sql,
    ]);
  });

  it('run() before connect() throws and never builds a client', async () => {
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: () => {
        throw new Error('factory must not be called');
      },
    });
    await expect(runner.run(dlqSince, ['x'])).rejects.toThrow(/not connected/);
  });

  it('double connect() throws', async () => {
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: fakeFactory(new FakeClient()).factory,
    });
    await runner.connect();
    await expect(runner.connect()).rejects.toThrow(/already connected/);
  });

  it('close() ends the client; run() afterwards throws', async () => {
    const client = new FakeClient();
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: fakeFactory(client).factory,
    });
    await runner.connect();
    await runner.close();
    expect(client.ended).toBe(true);
    await expect(runner.run(dlqSince, ['x'])).rejects.toThrow(/not connected/);
  });

  it('close() before connect() is a safe no-op', async () => {
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: () => {
        throw new Error('factory must not be called');
      },
    });
    await expect(runner.close()).resolves.toBeUndefined();
  });

  it('a connect failure with a SECRET-bearing driver error leaks the password through NO surface', async () => {
    // The driver error embeds the password — the classic leak vector.
    const client = new FakeClient({ connectErr: new Error(`boom ${FAKE_PW}`) });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: fakeFactory(client).factory,
    });
    let caught: unknown;
    try {
      await runner.connect();
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    const e = caught as ReadonlyRunnerError;
    // The redacted host is present (useful), the password is not, the raw cause is gone.
    expect(e.message).toContain('db.internal');
    expect(e.causeName).toBe('Error'); // only the safe type name is kept
    assertNoSecretLeak(e);
    expect(client.ended).toBe(true);
  });

  it('a connect-time SET-hardening failure surfaces as ReadonlyRunnerError and tears the client down', async () => {
    const client = new FakeClient({ setQueryErr: new Error('cannot set read-only') });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: fakeFactory(client).factory,
    });
    await expect(runner.connect()).rejects.toThrow(ReadonlyRunnerError);
    expect(client.ended).toBe(true);
  });

  it('a POST-CONNECT run() query failure (real run path) names the query and leaks no secret', async () => {
    // connect succeeds (the two SET statements pass); the DATA query fails with a secret-bearing error.
    const client = new FakeClient({ dataQueryErr: new Error(`pg down ${FAKE_PW}`) });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: fakeFactory(client).factory,
    });
    await runner.connect(); // must NOT throw — the failure is on the data query, not connect
    let caught: unknown;
    try {
      await runner.run(dlqSince, ['1970-01-01T00:00:00Z']);
      throw new Error('expected throw');
    } catch (e) {
      caught = e;
    }
    const e = caught as ReadonlyRunnerError;
    expect(e.message).toContain(dlqSince.name); // names the query for debuggability
    expect(e.causeName).toBe('Error');
    assertNoSecretLeak(e);
  });
});

// ── 4. No mutation SQL reaches the wire ─────────────────────────────────────────

describe('PgReadonlyRunner — no mutation SQL boundary', () => {
  async function connectedRunner(): Promise<{ runner: PgReadonlyRunner; client: FakeClient }> {
    const client = new FakeClient({ rows: [] });
    const runner = new PgReadonlyRunner(AlertRoConfig.fromEnv(env()), {
      clientFactory: fakeFactory(client).factory,
    });
    await runner.connect();
    return { runner, client };
  }

  const FORBIDDEN: { label: string; sql: string }[] = [
    { label: 'UPDATE', sql: 'UPDATE public.trades SET status = $1' },
    { label: 'DELETE', sql: 'DELETE FROM public.trades WHERE id = $1' },
    { label: 'INSERT', sql: 'INSERT INTO public.trades (id) VALUES ($1)' },
    { label: 'DROP', sql: 'DROP TABLE public.trades' },
    { label: 'GRANT', sql: 'GRANT SELECT ON public.trades TO public' },
    { label: 'multi-statement', sql: 'SELECT 1; DROP TABLE public.trades' },
    { label: 'CTE write', sql: 'SELECT 1 FROM x; UPDATE y SET z=1' },
  ];

  it.each(FORBIDDEN)('refuses a $label statement BEFORE it reaches the driver', async ({ sql }) => {
    const { runner, client } = await connectedRunner();
    const before = client.queries.length; // the two SET hardening statements
    await expect(runner.run(mutating(sql), ['x'])).rejects.toThrow();
    expect(client.queries.length).toBe(before); // nothing new was sent to the client
  });

  it('refuses a SELECT against a non-allow-listed table before the driver', async () => {
    const { runner, client } = await connectedRunner();
    const before = client.queries.length;
    const offTable: ReadonlyQuery = {
      name: 'peek_creds',
      // valid SELECT shape, but the table is not in the alert allow-list
      table: 'user_exchange_credentials' as unknown as ReadonlyQuery['table'],
      sql: 'SELECT count(*)::int AS n FROM public.user_exchange_credentials',
      params: [],
    };
    await expect(runner.run(offTable, [])).rejects.toThrow(/non-allow-listed table/);
    expect(client.queries.length).toBe(before);
  });
});
