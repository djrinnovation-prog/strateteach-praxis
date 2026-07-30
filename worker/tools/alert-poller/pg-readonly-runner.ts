// worker/tools/alert-poller/pg-readonly-runner.ts
//
// REAL read-only DB runner + config/redaction boundary for the S4-1 alert poller runtime.
// This is the single seam the poller skeleton left open: SqlEvidenceSource (./poller) consumes a
// `ReadonlyRunner`, and this module provides the one backed by a real Postgres connection — but
// ONLY as the least-privilege `praxis_alert_ro` role, ONLY over a connection forced read-only, and
// ONLY through the vetted read-only SELECT templates (../lib/readonly-sql).
//
// Hard boundaries (enforced here, not by convention):
//   - CONNECT AS praxis_alert_ro ONLY. The DSN user MUST equal `praxis_alert_ro`; any other user
//     (service_role / postgres / superuser / anything) is refused at config load. No service_role.
//   - READ-ONLY at three layers: (1) the role's column-level SELECT grants; (2) a per-session
//     `default_transaction_read_only = on`; (3) every query is re-asserted `assertReadOnly` at the
//     boundary, so a non-SELECT / non-allow-listed statement throws BEFORE the driver is called.
//   - SECRETS NEVER LEAK: the DSN/password lives only inside AlertRoConfig and is handed straight to
//     the driver. Every toString/toJSON/inspect/describe path is redacted (password masked, query
//     params stripped). Errors reference the query name + redacted descriptor only — never the DSN.
//   - The `pg` driver is loaded LAZILY, only when a real client is built. Tests inject a fake client
//     factory and never touch the driver or any real secret.
//
// This module performs NO I/O at import time, opens NO connection until connect() is called, and
// does NOT import worker runtime code (no service_role client, no Vault, no ccxt).

import {
  assertReadOnly,
  type ReadonlyQuery,
} from '../lib/readonly-sql';
import type { ReadonlyRow, ReadonlyRunner } from './poller';

/** The ONLY role this runner may connect as. A least-privilege, column-level-SELECT login role. */
export const REQUIRED_ROLE = 'praxis_alert_ro';
/** Default per-session statement timeout (ms). Bounds any single read so a poll can't hang. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 5000;
/** Reported to Postgres as application_name — aids server-side observability. Not a secret. */
export const APPLICATION_NAME = 'praxis-alert-poller';

// ── Errors ───────────────────────────────────────────────────────────────────

/** Raised when the env config is missing/invalid. Messages are redacted — never echo the DSN. */
export class AlertRoConfigError extends Error {
  constructor(message: string) {
    super(`alert-ro-config: ${message}`);
    this.name = 'AlertRoConfigError';
  }
}

/**
 * Raised on a connection / query fault. The underlying cause (e.g. a pg driver error) is NOT
 * retained — driver errors can embed the DSN/password, and a retained `cause` would leak through
 * `console.error(err)`, `util.inspect`, or any serializer that walks `.cause`. We keep ONLY the
 * cause's type name (`causeName`, e.g. "Error" / "DatabaseError"), never its message or the object
 * itself. The `message` is already redacted by the caller. No secret reaches this error.
 */
export class ReadonlyRunnerError extends Error {
  /** The TYPE name of the underlying cause (safe class identifier), never its message/value. */
  readonly causeName?: string;

  constructor(message: string, cause?: unknown) {
    // Intentionally do NOT forward `cause` to super({ cause }) — that would re-attach the raw object.
    super(`pg-readonly-runner: ${message}`);
    this.name = 'ReadonlyRunnerError';
    this.causeName = ReadonlyRunnerError.safeCauseName(cause);
  }

  /** Extract only a non-sensitive type label from a thrown cause. Never returns its message/value. */
  private static safeCauseName(cause: unknown): string | undefined {
    if (cause === undefined || cause === null) return undefined;
    if (cause instanceof Error) return cause.name || cause.constructor?.name || 'Error';
    // Non-Error throwable: report only the primitive type, never the value (which may be a secret).
    return typeof cause;
  }
}

// ── Secret-safe redaction ──────────────────────────────────────────────────────

/**
 * Render a DSN to a single safe line with the password masked and query params stripped:
 *   postgresql://praxis_alert_ro:***@host:5432/db
 * Pure; never throws and never returns the password. On an unparseable DSN, returns a constant
 * placeholder rather than echoing any of the raw input.
 */
export function redactDsn(dsn: string): string {
  try {
    const u = new URL(dsn);
    const proto = u.protocol.toLowerCase();
    const user = u.username ? decodeURIComponent(u.username) : '';
    const auth = user ? `${user}:***@` : '';
    const port = u.port ? `:${u.port}` : '';
    const db = u.pathname.replace(/^\//, '');
    return `${proto}//${auth}${u.hostname}${port}/${db}`;
  } catch {
    return '[unparseable-dsn-redacted]';
  }
}

/** Structured, password-free view of the connection target. Safe to log / serialize. */
export interface RedactedDsn {
  protocol: string;
  user: string;
  host: string;
  port: string | null;
  database: string;
}

// ── Config boundary ────────────────────────────────────────────────────────────

const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom');

function parsePositiveIntEnv(raw: string | undefined, dflt: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return dflt;
  const t = raw.trim();
  // NEVER echo the raw value — a secret could be pasted into the wrong env var. Name + shape only.
  if (!/^\d+$/.test(t)) throw new AlertRoConfigError(`${name} must be a positive integer`);
  const n = Number(t);
  if (n <= 0) throw new AlertRoConfigError(`${name} must be a positive integer`);
  return n;
}

/**
 * Validated connection config for the alert poller. The raw DSN is held privately and exposed ONLY
 * via connectionString() (for the driver). Every other accessor is redacted, so logging or
 * serializing a config can never leak the password.
 */
export class AlertRoConfig {
  // ECMAScript true-private field: NOT enumerable and unreachable via {...config},
  // Object.keys/entries, structuredClone, or JSON.stringify — so the password can never leak
  // through object spread or serialization. (TS `private` is compile-time only and would leak.)
  readonly #dsn: string;
  /** Password-free structured descriptor. */
  readonly redacted: RedactedDsn;
  readonly statementTimeoutMs: number;
  readonly applicationName: string;

  private constructor(dsn: string, redacted: RedactedDsn, statementTimeoutMs: number) {
    this.#dsn = dsn;
    this.redacted = redacted;
    this.statementTimeoutMs = statementTimeoutMs;
    this.applicationName = APPLICATION_NAME;
  }

  /**
   * Build config from environment. Reads ONLY `PRAXIS_ALERT_RO_DSN` (secret-bearing) and the
   * optional `PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS`. Fails loud on anything that is not a valid
   * `praxis_alert_ro` Postgres DSN — including any service_role/superuser DSN.
   */
  static fromEnv(env: NodeJS.ProcessEnv): AlertRoConfig {
    const dsn = (env.PRAXIS_ALERT_RO_DSN ?? '').trim();
    if (!dsn) throw new AlertRoConfigError('PRAXIS_ALERT_RO_DSN is not set');

    let url: URL;
    try {
      url = new URL(dsn);
    } catch {
      // Never echo the raw DSN — it carries the password.
      throw new AlertRoConfigError('PRAXIS_ALERT_RO_DSN is not a valid connection URL');
    }

    const protocol = url.protocol.toLowerCase();
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
      // NEVER echo the raw scheme — name the env var + expected shape only.
      throw new AlertRoConfigError('PRAXIS_ALERT_RO_DSN has an unsupported scheme (expected postgres:// or postgresql://)');
    }

    const user = decodeURIComponent(url.username);
    if (user !== REQUIRED_ROLE) {
      // NEVER echo the supplied username — a secret could be pasted there. State only the required
      // role (the EXPECTED value, a non-secret constant).
      throw new AlertRoConfigError(
        `PRAXIS_ALERT_RO_DSN user must be "${REQUIRED_ROLE}" (least-privilege read-only role); ` +
          'service_role / superuser DSNs are not permitted here.',
      );
    }
    if (!url.password) {
      throw new AlertRoConfigError(`DSN for "${REQUIRED_ROLE}" is missing a password`);
    }

    const host = url.hostname;
    if (!host) throw new AlertRoConfigError('DSN is missing a host');

    const database = url.pathname.replace(/^\//, '');
    if (!database) throw new AlertRoConfigError('DSN is missing a database name');

    const statementTimeoutMs = parsePositiveIntEnv(
      env.PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      'PRAXIS_ALERT_RO_STATEMENT_TIMEOUT_MS',
    );

    const redacted: RedactedDsn = {
      protocol,
      user,
      host,
      port: url.port || null,
      database,
    };
    return new AlertRoConfig(dsn, redacted, statementTimeoutMs);
  }

  /** The full connection string. ONLY the client factory should read this; never log it. */
  connectionString(): string {
    return this.#dsn;
  }

  /** A redacted one-line descriptor (password masked, query params stripped). Safe to log. */
  describe(): string {
    return redactDsn(this.#dsn);
  }

  toString(): string {
    return this.describe();
  }

  /** JSON form is the password-free structured descriptor — JSON.stringify(config) is safe. */
  toJSON(): RedactedDsn {
    return this.redacted;
  }

  [INSPECT_CUSTOM](): string {
    return `AlertRoConfig(${this.describe()})`;
  }
}

// ── Read-only execution boundary ───────────────────────────────────────────────

/**
 * The minimal client surface this runner uses. The real pg.Client structurally satisfies it. Rows
 * carry RAW driver values (untyped): the pg driver returns some SQL types as JS objects — notably
 * `timestamptz` as a `Date`. `run()` normalizes each row to scalar ReadonlyRow values before any
 * downstream layer sees it.
 */
export interface PgLikeClient {
  connect(): Promise<void>;
  query(text: string, values?: ReadonlyArray<unknown>): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

export interface ClientFactoryOptions {
  connectionString: string;
  applicationName: string;
  statementTimeoutMs: number;
}

/** Builds a client from connection options. Injected in tests; the default uses the pg driver. */
export type ClientFactory = (opts: ClientFactoryOptions) => PgLikeClient;

/**
 * Default factory — the ONLY place the pg driver is touched. Loaded lazily via require() so that
 * importing this module (or running fixture tests) never pulls the driver in. Wraps pg.Client in
 * the narrow PgLikeClient surface above.
 */
export const defaultClientFactory: ClientFactory = (opts) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require('pg') as typeof import('pg');
  const client = new Client({
    connectionString: opts.connectionString,
    application_name: opts.applicationName,
    statement_timeout: opts.statementTimeoutMs,
  });
  return {
    connect: async () => {
      await client.connect();
    },
    query: async (text, values) => {
      const res = await client.query(text, values as unknown[]);
      return { rows: res.rows };
    },
    end: async () => {
      await client.end();
    },
  };
};

// Session-hardening statements issued once on connect. These are intentional SET statements (NOT
// ReadonlyQuery objects), so they are NOT — and must not be — routed through assertReadOnly (whose
// guard forbids the `set` keyword). They make every implicit transaction read-only at the server.
const SESSION_READONLY_SQL = 'SET default_transaction_read_only = on';

/**
 * Normalize one RAW driver column value to a scalar ReadonlyRow value. The pg driver returns some
 * SQL types as JS objects — notably `timestamptz` as a `Date` — but the alerting layer
 * (criteria/poller) expects `string | number | null`. Convert `Date` → ISO string; pass
 * string/number/null/undefined through unchanged; FAIL LOUD on any other (non-scalar / unsupported)
 * type. Never stringifies arbitrary objects, and the error names only the column + JS type — never
 * the value — so a bad row can never leak data.
 */
function normalizeValue(value: unknown, column: string, query: ReadonlyQuery): string | number | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  throw new ReadonlyRunnerError(
    `query "${query.name}" column "${column}" returned an unsupported type (${typeof value})`,
  );
}

/** Normalize a whole raw driver row to a ReadonlyRow (scalar values only). */
function normalizeRow(row: Record<string, unknown>, query: ReadonlyQuery): ReadonlyRow {
  const out: ReadonlyRow = {};
  for (const key of Object.keys(row)) {
    out[key] = normalizeValue(row[key], key, query);
  }
  return out;
}

/**
 * A `ReadonlyRunner` backed by a real `praxis_alert_ro` Postgres connection. Connect once, run many
 * vetted read-only queries, close. The `run` member is bound and typed as `ReadonlyRunner`, so it
 * plugs straight into `new SqlEvidenceSource({ runner })`.
 */
export class PgReadonlyRunner {
  private readonly config: AlertRoConfig;
  private readonly clientFactory: ClientFactory;
  private client: PgLikeClient | null = null;

  constructor(config: AlertRoConfig, deps: { clientFactory?: ClientFactory } = {}) {
    this.config = config;
    this.clientFactory = deps.clientFactory ?? defaultClientFactory;
  }

  /** Convenience: load config from env, then build an (unconnected) runner. */
  static fromEnv(env: NodeJS.ProcessEnv, deps: { clientFactory?: ClientFactory } = {}): PgReadonlyRunner {
    return new PgReadonlyRunner(AlertRoConfig.fromEnv(env), deps);
  }

  /** Open the connection and harden the session read-only + statement-timeout. Idempotency: throws if already connected. */
  async connect(): Promise<void> {
    if (this.client) throw new ReadonlyRunnerError('already connected');
    const client = this.clientFactory({
      connectionString: this.config.connectionString(),
      applicationName: this.config.applicationName,
      statementTimeoutMs: this.config.statementTimeoutMs,
    });
    try {
      await client.connect();
      await client.query(SESSION_READONLY_SQL);
      // statementTimeoutMs is a validated positive integer (no injection surface).
      await client.query(`SET statement_timeout = ${this.config.statementTimeoutMs}`);
    } catch (e) {
      try {
        await client.end();
      } catch {
        /* ignore secondary teardown error */
      }
      // describe() is redacted — the DSN/password is never in the message.
      throw new ReadonlyRunnerError(`connect failed for ${this.config.describe()}`, e);
    }
    this.client = client;
  }

  /**
   * Execute one vetted read-only query. Bound so it can be passed directly as a `ReadonlyRunner`.
   * Re-asserts read-only at the boundary: a non-SELECT / non-allow-listed query throws HERE, before
   * the driver is ever called — the last guard before the wire.
   */
  run: ReadonlyRunner = async (query: ReadonlyQuery, params: ReadonlyArray<string | number>) => {
    if (!this.client) throw new ReadonlyRunnerError('not connected — call connect() first');
    assertReadOnly(query);
    try {
      const res = await this.client.query(query.sql, params);
      // Normalize raw driver values (e.g. timestamptz Date → ISO string) before any downstream layer.
      return res.rows.map((row) => normalizeRow(row, query));
    } catch (e) {
      if (e instanceof ReadonlyRunnerError) throw e;
      throw new ReadonlyRunnerError(`query "${query.name}" failed`, e);
    }
  };

  /** Close the connection if open. Safe to call when never connected. */
  async close(): Promise<void> {
    if (!this.client) return;
    const c = this.client;
    this.client = null;
    await c.end();
  }
}
