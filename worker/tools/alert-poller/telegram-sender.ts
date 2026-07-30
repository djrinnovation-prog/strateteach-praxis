// worker/tools/alert-poller/telegram-sender.ts
//
// Telegram sender for the S4-1 alerting layer. It takes poller AlertDecisions and delivers their
// SECRET-SAFE rendered text via an INJECTED transport. This module:
//   - does NOT connect to a DB, read secrets from env, or import worker runtime code
//   - performs NO network by default — the transport is injected; there is no built-in fetch, so
//     importing this module can never hit the wire. Tests pass a fake transport / fake fetch.
//   - never logs (no console). The bot token + chat id are treated as secrets.
//
// Secret-surface design (the key invariant):
//   - The GENERIC transport receives ONLY non-secret send input: { text }. It never sees the bot
//     token or chat id, so a fake/real transport cannot store/log a secret it never received.
//   - fetchTransport(config, fetchImpl) is the SOLE holder of botToken/chatId — it alone builds the
//     token-bearing URL and the chat_id body, behind an injected fetch.
//
// Safety contract:
//   - Fail loud / fail closed on an UNSAFE payload: rendering re-validates via buildSafeAlert and
//     throws ForbiddenFieldError BEFORE transport is called — an unsafe payload never reaches the wire.
//   - Send failures (transport throw / non-OK HTTP) are CLASSIFIED, not hidden: the outcome is
//     `failed` with a sanitized, secret-free reason. Delivery is NEVER reported successful when the
//     send did not succeed (runbook §3/§8).

import { renderAlertText, type SafeAlert } from '../lib/safe-payload';
import type { AlertDecision, AlertSignal } from './criteria';

/** Telegram Bot API origin. Only fetchTransport composes the token-bearing URL from this. */
export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** Fail-loud sender-layer fault (missing config / transport, refusing to leak). Secret-free message. */
export class TelegramSenderError extends Error {
  constructor(message: string) {
    super(`telegram-sender: ${message}`);
    this.name = 'TelegramSenderError';
  }
}

/** Secrets. Held ONLY by fetchTransport; never passed to the generic transport, logged, or returned. */
export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/** The ONLY thing handed to the generic transport — non-secret. */
export interface TransportInput {
  text: string;
}

export interface TransportResult {
  ok: boolean;
  status?: number;
}

/** Injected send seam. Receives non-secret input only. No default is provided (no network by default). */
export type TelegramTransport = (input: TransportInput) => TransportResult | Promise<TransportResult>;

export type SendStatus = 'delivered' | 'failed';

/** Result of one send attempt. Contains ONLY non-secret, classified fields. */
export interface SendOutcome {
  signal: AlertSignal;
  status: SendStatus;
  /** HTTP status when the transport returned one (delivered or non-OK). */
  httpStatus?: number;
  /** Sanitized, secret-free failure classification (only present when status === 'failed'). */
  reason?: string;
}

export interface SendOptions {
  transport: TelegramTransport;
}

function assertConfig(config: TelegramConfig): void {
  if (!config || typeof config.botToken !== 'string' || config.botToken === '') {
    throw new TelegramSenderError('botToken is required'); // value intentionally omitted
  }
  if (typeof config.chatId !== 'string' || config.chatId === '') {
    throw new TelegramSenderError('chatId is required'); // value intentionally omitted
  }
}

/** Render the safe one-line text for an alert payload. Throws ForbiddenFieldError if unsafe. */
export function renderAlertMessage(payload: SafeAlert): string {
  return renderAlertText(payload as Record<string, unknown>);
}

/** Replace any occurrence of the configured secrets with a redaction marker. For safe logging by callers. */
export function redactSecrets(text: string, config: TelegramConfig): string {
  let out = text;
  for (const secret of [config?.botToken, config?.chatId]) {
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  return out;
}

/**
 * Send one alert decision. Order of operations is the safety contract:
 *   1. validate transport (fail loud; no network by default)
 *   2. render safe text — throws ForbiddenFieldError on an unsafe payload BEFORE transport is called
 *   3. hand ONLY { text } to the transport; classify the result
 *
 * Knows NO secrets. Throws (fail loud) only for unsafe payloads / a missing transport — NEVER for a
 * transport/HTTP failure, which is returned as { status: 'failed', reason } so a failed send is
 * reported, never mistaken for success.
 */
export async function sendAlert(decision: AlertDecision, opts: SendOptions): Promise<SendOutcome> {
  const { transport } = opts;
  if (typeof transport !== 'function') {
    throw new TelegramSenderError('transport is required (no network by default)');
  }

  // Fail loud / fail closed BEFORE any send. An unsafe payload throws here and never reaches the wire.
  const text = renderAlertMessage(decision.payload);

  let result: TransportResult;
  try {
    result = await transport({ text });
  } catch {
    // The raw error may embed transport-internal detail — DO NOT propagate it. Classify with a
    // sanitized, secret-free reason and never mark delivery successful.
    return { signal: decision.signal, status: 'failed', reason: 'transport_error' };
  }

  if (!result || result.ok !== true) {
    return {
      signal: decision.signal,
      status: 'failed',
      httpStatus: typeof result?.status === 'number' ? result.status : undefined,
      reason: 'http_not_ok',
    };
  }

  return { signal: decision.signal, status: 'delivered', httpStatus: result.status };
}

/**
 * Send a batch of decisions in order, returning one outcome each. Transport/HTTP failures are
 * classified per-alert (the batch continues); an unsafe payload still fails loud (throws) because it
 * is a security violation, not an operational condition.
 */
export async function sendAlerts(decisions: AlertDecision[], opts: SendOptions): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = [];
  for (const decision of decisions) {
    outcomes.push(await sendAlert(decision, opts));
  }
  return outcomes;
}

// ── HTTP transport — the SOLE secret boundary (still injected; no network by default) ─────────

/** Minimal fetch shape — injected, never the global, so importing this module performs no network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * Build a transport that knows the secrets. This is the ONLY place botToken/chatId are read and the
 * ONLY place a real network call would originate (and only if the caller passes a real fetch — a
 * separately-approved step). The returned transport exposes a non-secret { text } API, so the rest
 * of the sender — and every test fake — never touches a secret. Tests pass a fake fetch.
 */
export function fetchTransport(config: TelegramConfig, fetchImpl: FetchLike): TelegramTransport {
  assertConfig(config); // fail loud at the secret boundary
  return async ({ text }: TransportInput): Promise<TransportResult> => {
    const url = `${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text }),
    });
    return { ok: res.ok, status: res.status };
  };
}
