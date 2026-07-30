// worker/tools/lib/safe-payload.test.ts
import {
  ALLOWED_ALERT_FIELDS,
  pickAllowed,
  findForbidden,
  assertSafePayload,
  buildSafeAlert,
  renderAlertText,
  ForbiddenFieldError,
} from './safe-payload';

// A record carrying every ALLOWED field (clean) PLUS every forbidden category.
const leaky = {
  // allowed (clean) — must survive
  event: 'dlq_alert',
  count: 1,
  bot_id: '2dcaddba-b62d-47e1-87a7-7f7b759f38d2',
  trade_id: 'd59f68a0-8511-4625-9b2b-8d2fd44f7359',
  signal_id: 'WB9R-20260621-1200-railway-buy',
  status: 'failed',
  age_seconds: 99,
  exchange_order_id: 5927166,
  environment: 'dev',
  deploy_id: '1a872bdb',
  timestamp: '2026-06-21T12:00:00Z',
  // forbidden — must be dropped / must never appear
  secret: 'SUPER_SECRET_VALUE',
  api_key: 'sk_live_ABC12345DEF',
  webhook_token: 'tok_WBHK_9999',
  authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.body.sig',
  headers: { 'x-api-key': 'h-XYZ' },
  body: '{"close":"68000","volume":"1.0"}',
  raw_payload: { close: 68000, volume: 1 },
  source_ip: '203.0.113.7',
  service_role: 'eyJrb2xlIjoic2VydmljZV9yb2xlIn0',
  telegram_bot_token: '123456789:AAHtelegramBotTokenxxxxxxxxxxxxxx',
  healthchecks_url: 'https://hc-ping.com/11111111-2222-3333',
  db_url: 'postgres://alert:passw0rd@db.host:5432/praxis',
  ccxt_message: 'AuthenticationError: api-key invalid',
  stack: 'Error: boom\n    at processMessage (index.ts:911)',
  cause: 'ETIMEDOUT https://testnet.binance.vision',
};

const REQUIRED_ALLOWED = [
  'event', 'count', 'bot_id', 'trade_id', 'signal_id', 'status',
  'age_seconds', 'exchange_order_id', 'environment', 'deploy_id', 'timestamp',
] as const;

const FORBIDDEN_SUBSTRINGS = [
  'SUPER_SECRET_VALUE', 'sk_live', 'tok_WBHK', 'Bearer', 'eyJ', 'x-api-key',
  '68000', '203.0.113.7', 'service_role', '123456789:AAH', 'hc-ping.com',
  'postgres://', 'AuthenticationError', 'processMessage', 'testnet.binance.vision', 'https://',
];

describe('safe-payload — allowed fields survive', () => {
  const safe = buildSafeAlert(leaky);

  test.each(REQUIRED_ALLOWED)('keeps allowed field %s with its value', (k) => {
    expect(safe).toHaveProperty(k);
    expect(safe[k]).toEqual((leaky as Record<string, unknown>)[k]);
  });

  test('output keys are a subset of the allow-list', () => {
    for (const k of Object.keys(safe)) expect(ALLOWED_ALERT_FIELDS).toContain(k);
  });
});

describe('safe-payload — forbidden fields excluded', () => {
  const safe = buildSafeAlert(leaky);
  const serialized = JSON.stringify(safe);

  test.each(FORBIDDEN_SUBSTRINGS)('serialized payload contains no %s', (needle) => {
    expect(serialized).not.toContain(needle);
  });

  test('no forbidden category key survives', () => {
    for (const k of [
      'secret', 'api_key', 'webhook_token', 'authorization', 'headers', 'body',
      'raw_payload', 'source_ip', 'service_role', 'telegram_bot_token',
      'healthchecks_url', 'db_url', 'ccxt_message', 'stack', 'cause',
    ]) {
      expect(safe).not.toHaveProperty(k);
    }
  });

  test('pickAllowed alone already drops every forbidden key', () => {
    expect(findForbidden(pickAllowed(leaky))).toEqual([]);
  });
});

describe('safe-payload — fail loud on smuggled secrets / forbidden keys', () => {
  test('a forbidden VALUE in an allowed field throws (defense-in-depth)', () => {
    expect(() => buildSafeAlert({ event: 'fail — see https://hc-ping.com/x', count: 1 })).toThrow(
      ForbiddenFieldError,
    );
    expect(() => buildSafeAlert({ status: 'Bearer eyJabc1234567890' })).toThrow(ForbiddenFieldError);
  });

  test('findForbidden flags forbidden keys on a raw record', () => {
    const hits = findForbidden(leaky).map((h) => h.where);
    for (const k of ['secret', 'authorization', 'raw_payload', 'source_ip', 'db_url', 'stack']) {
      expect(hits).toContain(k);
    }
  });

  test('assertSafePayload passes for a clean allow-listed payload', () => {
    expect(() => assertSafePayload(pickAllowed(leaky))).not.toThrow();
  });
});

describe('safe-payload — non-scalar allowed values are dropped', () => {
  test('allowed key with an object value is not emitted', () => {
    const safe = buildSafeAlert({ event: { nested_secret: 'sk_live_NEST123' }, count: 2 });
    expect(safe).not.toHaveProperty('event');
    expect(safe.count).toBe(2);
  });

  test('allowed key with an array value is not emitted', () => {
    const safe = buildSafeAlert({ status: ['leak-array-elem'], count: 1 });
    expect(safe).not.toHaveProperty('status');
    expect(safe.count).toBe(1);
  });

  test('boolean / null / undefined allowed values are dropped', () => {
    const safe = buildSafeAlert({ count: 3, environment: true, status: null, event: undefined });
    expect(safe).toEqual({ count: 3 });
  });

  test('renderAlertText emits no array/object contents from allowed keys', () => {
    const line = renderAlertText({
      event: 'ok',
      signal_id: ['leak-array-elem'],
      trade_id: { nested_secret: 'sk_live_NEST123' },
      count: 1,
    });
    expect(line).toContain('event=ok');
    expect(line).toContain('count=1');
    expect(line).not.toContain('leak-array-elem');
    expect(line).not.toContain('sk_live_NEST123');
    expect(line).not.toContain('nested_secret');
    expect(line).not.toContain('[object Object]');
  });
});

describe('safe-payload — high-entropy opaque secrets (no fixed shape)', () => {
  test('a 64-char hex secret smuggled into deploy_id throws', () => {
    const hex64 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
    expect(hex64).toHaveLength(64);
    expect(() => buildSafeAlert({ event: 'deploy', deploy_id: hex64 })).toThrow(ForbiddenFieldError);
  });

  test('a base64-ish 40+ char token smuggled into reason_code throws', () => {
    const b64 = 'Tm93IGlzIHRoZSB0aW1lIGZvciBhbGwgZ29vZCBtZW4=';
    expect(b64.length).toBeGreaterThanOrEqual(40);
    expect(() => buildSafeAlert({ event: 'x', reason_code: b64 })).toThrow(ForbiddenFieldError);
    const hits = findForbidden({ reason_code: b64 });
    expect(hits.some((h) => h.name === 'high_entropy_token' && h.where === 'reason_code')).toBe(true);
  });

  test.each([
    ['production', { environment: 'production' }],
    ['deploy-1234', { deploy_id: 'deploy-1234' }],
    ['eu-west-1', { environment: 'eu-west-1' }],
    ['reason_code_abc', { reason_code: 'reason_code_abc' }],
    ['snake_case reason', { reason_code: 'order_rejected_insufficient_balance_by_exchange' }],
    ['uuid bot_id', { bot_id: '2dcaddba-b62d-47e1-87a7-7f7b759f38d2' }],
    ['structured signal_id', { signal_id: 'WB9R-20260621-1200-railway-buy' }],
    ['iso timestamp', { timestamp: '2026-06-21T12:00:00Z' }],
  ])('does NOT over-redact normal value: %s', (_label, payload) => {
    expect(() => buildSafeAlert(payload as Record<string, unknown>)).not.toThrow();
  });

  test('the real UUID / signal_id / timestamp allowed fields all survive together', () => {
    const safe = buildSafeAlert(leaky);
    expect(safe.bot_id).toBe(leaky.bot_id);
    expect(safe.trade_id).toBe(leaky.trade_id);
    expect(safe.signal_id).toBe(leaky.signal_id);
    expect(safe.timestamp).toBe(leaky.timestamp);
  });
});

describe('safe-payload — renderAlertText', () => {
  test('renders allowed k=v, no forbidden content', () => {
    const line = renderAlertText(leaky);
    expect(line).toContain('event=dlq_alert');
    expect(line).toContain('exchange_order_id=5927166');
    for (const needle of FORBIDDEN_SUBSTRINGS) expect(line).not.toContain(needle);
  });

  test('throws if a secret is smuggled into an allowed field', () => {
    expect(() => renderAlertText({ event: 'postgres://u:p@h/db' })).toThrow(ForbiddenFieldError);
  });
});
