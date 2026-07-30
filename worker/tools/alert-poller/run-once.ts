// worker/tools/alert-poller/run-once.ts
//
// Entrypoint / config-loader for ONE alert poll cycle (the "run-once" slice of S4-1 operational
// activation). It wires the already-built pieces together and nothing more:
//   PgReadonlyRunner (real praxis_alert_ro read-only DB) → SqlEvidenceSource → runPoll/evaluatePoll
//   → either a DRY-RUN render (default) or a send through an INJECTED transport.
//
// Boundaries (enforced, not by convention):
//   - NO execution on import. The CLI runs ONLY under `require.main === module`; importing this file
//     (as every test does) connects to nothing and sends nothing.
//   - NO connection unless explicitly invoked: runOnce() is the only thing that calls runner.connect().
//   - READ-ONLY DB only: the runner is a PgReadonlyRunner (praxis_alert_ro, SELECT-only, re-asserted
//     read-only per query). No service_role, no write SQL.
//   - NO network by default: there is NO built-in fetch / transport. 'send' mode requires an injected
//     transport; without one it fails loud rather than silently skipping or hitting the wire. The CLI
//     wires NO transport, so the CLI never sends (dry-run only in this slice).
//   - SECRET-SAFE: the DSN lives only inside AlertRoConfig (redacted on every serialize). Telegram
//     token/chat id are NEVER retained on RunOnceConfig (only a `telegramConfigured` boolean) and are
//     read solely at the secret boundary (loadTelegramConfig, for a future real transport). Logs emit
//     only safe summaries + already-safe rendered alert lines — never DSNs, tokens, chat ids, request
//     bodies, or raw errors.

import {
  AlertRoConfig,
  AlertRoConfigError,
  PgReadonlyRunner,
  ReadonlyRunnerError,
} from './pg-readonly-runner';
import {
  SqlEvidenceSource,
  InMemoryStateStore,
  runPoll,
  type StateStore,
  type ReadonlyRunner,
} from './poller';
import { STUCK_THRESHOLD_SECONDS_DEFAULT } from '../lib/readonly-sql';
import {
  fetchTransport,
  renderAlertMessage,
  sendAlerts,
  type FetchLike,
  type SendOutcome,
  type TelegramConfig,
  type TelegramTransport,
} from './telegram-sender';
import type { AlertSignal, PollContext } from './criteria';

// Env var names (single source of truth).
export const ENV = {
  DSN: 'PRAXIS_ALERT_RO_DSN', // consumed by AlertRoConfig.fromEnv (secret)
  SEND_MODE: 'PRAXIS_ALERT_SEND_MODE', // 'dry-run' (default) | 'send'
  ENVIRONMENT: 'PRAXIS_ALERT_ENVIRONMENT', // non-secret label, default 'dev'
  DEPLOY_ID: 'PRAXIS_ALERT_DEPLOY_ID', // non-secret label (e.g. Railway deploy id), optional
  STUCK_THRESHOLD_SECONDS: 'PRAXIS_ALERT_STUCK_THRESHOLD_SECONDS',
  TELEGRAM_BOT_TOKEN: 'PRAXIS_ALERT_TELEGRAM_BOT_TOKEN', // secret
  TELEGRAM_CHAT_ID: 'PRAXIS_ALERT_TELEGRAM_CHAT_ID', // sensitive
} as const;

export type SendMode = 'dry-run' | 'send';
const SEND_MODES: readonly SendMode[] = ['dry-run', 'send'];

/** Fail-loud config fault. Messages are secret-free (values intentionally omitted). */
export class RunOnceConfigError extends Error {
  constructor(message: string) {
    super(`alert-poller-run-once: ${message}`);
    this.name = 'RunOnceConfigError';
  }
}

function parsePositiveIntEnv(raw: string | undefined, dflt: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return dflt;
  const t = raw.trim();
  // NEVER echo the raw value — a secret could be pasted into the wrong env var. Name + shape only.
  if (!/^\d+$/.test(t)) throw new RunOnceConfigError(`${name} must be a positive integer`);
  const n = Number(t);
  if (n <= 0) throw new RunOnceConfigError(`${name} must be a positive integer`);
  return n;
}

/** Secret-safe run-once config. Holds NO Telegram secret — only a `telegramConfigured` boolean. */
export interface RunOnceConfig {
  db: AlertRoConfig;
  sendMode: SendMode;
  environment: string;
  deployId?: string;
  thresholdSeconds: number;
  /** Whether BOTH Telegram envs are present — a boolean only, never the secret values. */
  telegramConfigured: boolean;
}

/**
 * Load + validate run-once config from env. Fails loud on a missing/invalid DSN (via AlertRoConfig),
 * a bad send mode, or a bad threshold. Telegram creds are NOT required here (only in 'send' with a
 * real transport) and are NOT retained on the returned object — only `telegramConfigured`.
 */
export function loadRunOnceConfig(env: NodeJS.ProcessEnv): RunOnceConfig {
  const db = AlertRoConfig.fromEnv(env); // secret-bearing DSN; redacted on every accessor

  const rawMode = (env[ENV.SEND_MODE] ?? '').trim() || 'dry-run';
  if (!SEND_MODES.includes(rawMode as SendMode)) {
    // NEVER echo the raw value (a secret could be in the wrong env var). Only the allowed set is static.
    throw new RunOnceConfigError(`${ENV.SEND_MODE} must be one of ${SEND_MODES.join('|')}`);
  }
  const sendMode = rawMode as SendMode;

  const environment = (env[ENV.ENVIRONMENT] ?? '').trim() || 'dev';
  const deployId = (env[ENV.DEPLOY_ID] ?? '').trim() || undefined;
  const thresholdSeconds = parsePositiveIntEnv(
    env[ENV.STUCK_THRESHOLD_SECONDS],
    STUCK_THRESHOLD_SECONDS_DEFAULT,
    ENV.STUCK_THRESHOLD_SECONDS,
  );

  const token = (env[ENV.TELEGRAM_BOT_TOKEN] ?? '').trim();
  const chatId = (env[ENV.TELEGRAM_CHAT_ID] ?? '').trim();
  const telegramConfigured = token !== '' && chatId !== '';

  return { db, sendMode, environment, deployId, thresholdSeconds, telegramConfigured };
}

/**
 * Read Telegram secrets — the SECRET BOUNDARY, used only to build a real fetch transport (a separate,
 * gated step). Fails loud if either is missing; the missing value is never echoed. Not called by the
 * dry-run CLI path.
 */
export function loadTelegramConfig(env: NodeJS.ProcessEnv): TelegramConfig {
  const botToken = (env[ENV.TELEGRAM_BOT_TOKEN] ?? '').trim();
  const chatId = (env[ENV.TELEGRAM_CHAT_ID] ?? '').trim();
  if (!botToken) throw new RunOnceConfigError(`${ENV.TELEGRAM_BOT_TOKEN} is required for send mode`); // value omitted
  if (!chatId) throw new RunOnceConfigError(`${ENV.TELEGRAM_CHAT_ID} is required for send mode`); // value omitted
  return { botToken, chatId };
}

/** A redacted one-line summary of the config. Safe to log — contains no DSN/token/chat secret. */
export function describeConfig(config: RunOnceConfig): string {
  return [
    `db=${config.db.describe()}`,
    `sendMode=${config.sendMode}`,
    `environment=${config.environment}`,
    `deployId=${config.deployId ?? '(none)'}`,
    `thresholdSeconds=${config.thresholdSeconds}`,
    `telegramConfigured=${config.telegramConfigured}`,
  ].join(' · ');
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/** The runner surface run-once needs. PgReadonlyRunner satisfies it; tests inject a fake. */
export interface RunnerLike {
  connect(): Promise<void>;
  run: ReadonlyRunner;
  close(): Promise<void>;
}

export interface RunOnceDeps {
  runner: RunnerLike;
  /** De-dup state store. Defaults to in-memory (no cross-run persistence — a file store is a later slice). */
  store?: StateStore;
  /** Injected send seam (fake in tests; a real fetchTransport only via a separately-gated step). */
  transport?: TelegramTransport;
  /** Clock for PollContext.now (injected for determinism in tests). */
  now?: () => string;
}

export interface RunOnceResult {
  sendMode: SendMode;
  committed: boolean;
  alertCount: number;
  signals: AlertSignal[];
  /** Secret-safe one-line renders of each alert (always produced; this is what dry-run "shows"). */
  rendered: string[];
  /** Present only in 'send' mode with alerts: per-alert delivery outcomes (secret-free). */
  outcomes?: SendOutcome[];
}

/**
 * Run exactly one poll cycle: connect → fetch evidence (read-only) → evaluate/de-dup → render, and
 * in 'send' mode hand the decisions to the injected transport. The connection is always closed.
 * Throws (fail loud) on config/evidence faults or on 'send' mode without a transport — never sends by
 * default, never on import.
 */
export async function runOnce(config: RunOnceConfig, deps: RunOnceDeps): Promise<RunOnceResult> {
  const { runner } = deps;
  const store: StateStore = deps.store ?? new InMemoryStateStore();
  const now = deps.now ?? defaultNow;

  const source = new SqlEvidenceSource({ runner: runner.run, thresholdSeconds: config.thresholdSeconds });
  const context: PollContext = { now: now(), environment: config.environment, deployId: config.deployId };

  await runner.connect();
  try {
    const poll = await runPoll({ source, store, context });
    const rendered = poll.alerts.map((a) => renderAlertMessage(a.payload));
    const signals = poll.alerts.map((a) => a.signal);

    let outcomes: SendOutcome[] | undefined;
    if (config.sendMode === 'send' && poll.alerts.length > 0) {
      if (typeof deps.transport !== 'function') {
        // No transport => no network by default. Fail loud rather than silently skip a real send.
        throw new RunOnceConfigError('send mode requires an injected transport (no network by default)');
      }
      outcomes = await sendAlerts(poll.alerts, { transport: deps.transport });
    }

    return { sendMode: config.sendMode, committed: poll.committed, alertCount: poll.alerts.length, signals, rendered, outcomes };
  } finally {
    await runner.close();
  }
}

function defaultNow(): string {
  return new Date().toISOString();
}

// ── CLI entrypoint (DRY-RUN only in this slice; NEVER runs on import) ────────────

/** Build the safe stdout summary line for a completed run. Contains no secrets. */
export function summaryLine(config: RunOnceConfig, result: RunOnceResult): string {
  return (
    `[alert-poller:run-once] ${describeConfig(config)} · committed=${result.committed} · ` +
    `alerts=${result.alertCount} · signals=[${result.signals.join(',')}]`
  );
}

/** Map any thrown error to a SAFE one-line message — our own errors are already redacted; others get only a type label. */
export function safeErrorLine(err: unknown): string {
  if (err instanceof RunOnceConfigError || err instanceof AlertRoConfigError || err instanceof ReadonlyRunnerError) {
    return err.message; // these message strings are constructed to be secret-free
  }
  const name = (err as { name?: string })?.name;
  return `unexpected error (${typeof name === 'string' && name ? name : 'Error'})`;
}

// ── Live Telegram transport (the ONLY network egress; built ONLY in send mode) ──

/**
 * The single network-egress adapter, over the global fetch. It logs NOTHING (the URL embeds the bot
 * token) and returns only { ok, status }. Any throw propagates to sendAlert's classify-not-throw
 * handler, which converts it to a secret-free `failed` outcome — so the token-bearing URL never leaks.
 */
/* istanbul ignore next -- thin wrapper over global fetch; tests inject a fake FetchLike instead. */
export const realFetch: FetchLike = async (url, init) => {
  const res = await globalThis.fetch(url, init);
  return { ok: res.ok, status: res.status };
};

/**
 * Build the REAL Telegram transport: read the bot token + chat id from env (fail loud if missing) and
 * bind them behind fetchTransport. Secrets live ONLY here; the returned transport exposes a non-secret
 * { text } API. `fetchImpl` is injectable so tests exercise this with a fake fetch — no network, no real
 * secret. The default is the live `realFetch`. Build this ONLY when actually sending.
 */
export function buildLiveTransport(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = realFetch): TelegramTransport {
  return fetchTransport(loadTelegramConfig(env), fetchImpl);
}

/** Render one SendOutcome to a secret-free stdout line. */
function outcomeLine(o: SendOutcome): string {
  return (
    `[alert-poller:run-once] send signal=${o.signal} status=${o.status}` +
    `${o.httpStatus !== undefined ? ` httpStatus=${o.httpStatus}` : ''}` +
    `${o.reason !== undefined ? ` reason=${o.reason}` : ''}`
  );
}

/* istanbul ignore next -- CLI wiring; exercised by operators, not unit tests (no live run here). */
async function main(): Promise<void> {
  const env = process.env;
  const config = loadRunOnceConfig(env);
  const runner = PgReadonlyRunner.fromEnv(env);
  // Wire the REAL Telegram transport ONLY in send mode (loadTelegramConfig fails loud if creds are
  // missing). In dry-run (the default) no transport is built, so nothing is ever sent.
  const transport = config.sendMode === 'send' ? buildLiveTransport(env) : undefined;
  const result = await runOnce(config, { runner, transport });
  process.stdout.write(`${summaryLine(config, result)}\n`);
  for (const line of result.rendered) process.stdout.write(`[alert-poller:run-once] alert ${line}\n`);
  for (const o of result.outcomes ?? []) process.stdout.write(`${outcomeLine(o)}\n`);
}

/* istanbul ignore next -- only true when executed directly, never on import or under jest. */
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[alert-poller:run-once] FAILED: ${safeErrorLine(err)}\n`);
    process.exitCode = 1;
  });
}
