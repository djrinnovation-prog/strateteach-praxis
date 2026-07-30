// worker/tools/alert-poller/telegram-sender.test.ts
import {
  sendAlert,
  sendAlerts,
  renderAlertMessage,
  redactSecrets,
  fetchTransport,
  TelegramSenderError,
  TELEGRAM_API_BASE,
  type TelegramConfig,
  type TelegramTransport,
  type TransportInput,
  type FetchLike,
} from './telegram-sender';
import { buildSafeAlert, ForbiddenFieldError } from '../lib/safe-payload';
import type { AlertDecision } from './criteria';

// Realistic-looking SECRETS — every test asserts these never surface in transport input / text /
// outcomes / errors. Only the scoped fetchTransport test (the secret boundary) handles them.
const config: TelegramConfig = {
  botToken: '7654321098:AAH_fake_telegram_bot_token_DO_NOT_LOG_xxxx',
  chatId: '-1009876543210',
};

/** Build a safe AlertDecision from a raw record (goes through the real safe-payload builder). */
function decision(raw: Record<string, unknown>, signal: AlertDecision['signal'] = 'dlq'): AlertDecision {
  return { signal, payload: buildSafeAlert(raw) };
}

const dlqDecision = decision({
  event: 'dlq_alert',
  table: 'trades_dlq',
  count: 2,
  environment: 'dev',
  timestamp: '2026-06-21T12:00:00Z',
});

/** A generic transport that records its (non-secret) input and returns a fixed result. No network. */
function recordingTransport(result: { ok: boolean; status?: number }) {
  const calls: TransportInput[] = [];
  const transport: TelegramTransport = (input) => {
    calls.push(input);
    return result;
  };
  return { transport, calls };
}

describe('telegram-sender — successful fake send', () => {
  test('delivers via the injected transport and reports delivered', async () => {
    const { transport, calls } = recordingTransport({ ok: true, status: 200 });
    const outcome = await sendAlert(dlqDecision, { transport });

    expect(outcome).toEqual({ signal: 'dlq', status: 'delivered', httpStatus: 200 });
    expect(calls).toHaveLength(1);
    // The transport received ONLY text — no url, no token, no chat id.
    expect(Object.keys(calls[0])).toEqual(['text']);
    expect(calls[0].text).toContain('event=dlq_alert');
    expect(calls[0].text).toContain('count=2');
  });

  test('sendAlerts returns one outcome per decision, in order', async () => {
    const { transport } = recordingTransport({ ok: true, status: 200 });
    const outcomes = await sendAlerts(
      [dlqDecision, decision({ event: 'stuck_trades_alert', table: 'trades', count: 1 }, 'stuck')],
      { transport },
    );
    expect(outcomes.map((o) => `${o.signal}:${o.status}`)).toEqual(['dlq:delivered', 'stuck:delivered']);
  });
});

describe('telegram-sender — the generic transport never receives secrets', () => {
  test('recorded transport input contains neither token nor chat id', async () => {
    const { transport, calls } = recordingTransport({ ok: true, status: 200 });
    await sendAlert(dlqDecision, { transport });

    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain(config.botToken);
    expect(serialized).not.toContain(config.chatId);
    expect(serialized).not.toContain('api.telegram.org'); // no token-bearing URL is built here at all
  });

  test('rendered text contains neither token nor chat id', () => {
    const text = renderAlertMessage(dlqDecision.payload);
    expect(text).not.toContain(config.botToken);
    expect(text).not.toContain(config.chatId);
  });

  test('a transport that throws never leaks anything into the outcome', async () => {
    const throwingTransport: TelegramTransport = () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:443');
    };
    const outcome = await sendAlert(dlqDecision, { transport: throwingTransport });

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toBe('transport_error');
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(config.botToken);
    expect(serialized).not.toContain(config.chatId);
  });

  test('redactSecrets masks token + chat id (for safe caller-side logging)', () => {
    const raw = `POST ${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage chat_id=${config.chatId}`;
    const masked = redactSecrets(raw, config);
    expect(masked).not.toContain(config.botToken);
    expect(masked).not.toContain(config.chatId);
    expect(masked).toContain('[REDACTED]');
  });
});

describe('telegram-sender — unsafe payload is rejected before send (fail loud)', () => {
  test('an unsafe rendered field throws ForbiddenFieldError and the transport is never called', async () => {
    const { transport, calls } = recordingTransport({ ok: true, status: 200 });
    // A forbidden value (URL) smuggled into an allowed field — must be rejected at render time.
    const unsafe: AlertDecision = { signal: 'dlq', payload: { event: 'see https://hc-ping.com/leak', count: 1 } as never };

    await expect(sendAlert(unsafe, { transport })).rejects.toThrow(ForbiddenFieldError);
    expect(calls).toHaveLength(0); // never reached the wire
  });
});

describe('telegram-sender — send failure is reported, not hidden as success', () => {
  test('non-OK HTTP → failed with httpStatus, not delivered', async () => {
    const { transport } = recordingTransport({ ok: false, status: 500 });
    const outcome = await sendAlert(dlqDecision, { transport });
    expect(outcome).toEqual({ signal: 'dlq', status: 'failed', httpStatus: 500, reason: 'http_not_ok' });
  });

  test('transport throw → failed, never delivered', async () => {
    const transport: TelegramTransport = () => {
      throw new Error('socket hang up');
    };
    const outcome = await sendAlert(dlqDecision, { transport });
    expect(outcome.status).toBe('failed');
    expect(outcome.status).not.toBe('delivered');
  });
});

describe('telegram-sender — no network by default', () => {
  test('omitting the transport fails loud (no built-in network)', async () => {
    await expect(sendAlert(dlqDecision, { transport: undefined as unknown as TelegramTransport })).rejects.toThrow(
      TelegramSenderError,
    );
  });

  test('fetchTransport fails loud on missing config, with no secret in the message', () => {
    expect(() => fetchTransport({ botToken: '', chatId: config.chatId }, async () => ({ ok: true, status: 200 }))).toThrow(
      TelegramSenderError,
    );
    try {
      fetchTransport({ botToken: '', chatId: config.chatId }, async () => ({ ok: true, status: 200 }));
    } catch (e) {
      expect((e as Error).message).not.toContain(config.chatId);
    }
  });

  // The SOLE place secrets legitimately exist: the HTTP seam, behind an injected fake fetch.
  test('fetchTransport (the secret boundary) builds the Telegram payload via ONLY the injected fetch', async () => {
    const seen: { url: string; method: string; body: string }[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      seen.push({ url, method: init.method, body: init.body });
      return { ok: true, status: 200 };
    };
    const outcome = await sendAlert(dlqDecision, { transport: fetchTransport(config, fakeFetch) });

    expect(outcome.status).toBe('delivered');
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe(`${TELEGRAM_API_BASE}/bot${config.botToken}/sendMessage`);
    expect(JSON.parse(seen[0].body)).toEqual({ chat_id: config.chatId, text: expect.stringContaining('event=dlq_alert') });
  });

  test('fetchTransport surfaces a fake-fetch failure as a classified failure (not delivered)', async () => {
    const failingFetch: FetchLike = async () => {
      throw new Error('dns error');
    };
    const outcome = await sendAlert(dlqDecision, { transport: fetchTransport(config, failingFetch) });
    expect(outcome).toEqual({ signal: 'dlq', status: 'failed', reason: 'transport_error' });
  });
});
