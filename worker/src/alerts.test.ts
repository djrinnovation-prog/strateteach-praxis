/**
 * alerts.test.ts — alert sink (Plan v1.1 · 1.5): default-OFF no-op, POST when configured, never throws.
 */
import { configureAlerts, emitAlert, resetAlertsForTest, type AlertFetch } from './alerts';

describe('alerts', () => {
  afterEach(() => {
    resetAlertsForTest();
    jest.restoreAllMocks();
  });

  test('default OFF (no url) → emitAlert is a no-op, fetch never called', async () => {
    const fetchImpl = jest.fn<ReturnType<AlertFetch>, Parameters<AlertFetch>>().mockResolvedValue({ ok: true });
    configureAlerts({ url: '', fetchImpl });
    emitAlert('credential_invalidated', { bot_id: 'b1' });
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('configured → POSTs a compact JSON payload with source + event + fields', async () => {
    const fetchImpl = jest.fn<ReturnType<AlertFetch>, Parameters<AlertFetch>>().mockResolvedValue({ ok: true });
    configureAlerts({ url: 'https://hook.example/abc', fetchImpl });
    emitAlert('mainnet_master_switch_off', { bot_id: 'b1', signal_id: 's1' });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://hook.example/abc');
    expect(init.method).toBe('POST');
    const payload = JSON.parse(init.body);
    expect(payload).toEqual({ source: 'praxis-worker', event: 'mainnet_master_switch_off', bot_id: 'b1', signal_id: 's1' });
  });

  test('never throws when the sink rejects (swallowed)', async () => {
    const fetchImpl = jest.fn<ReturnType<AlertFetch>, Parameters<AlertFetch>>().mockRejectedValue(new Error('network'));
    jest.spyOn(console, 'log').mockImplementation(() => {});
    configureAlerts({ url: 'https://hook.example/abc', fetchImpl });
    expect(() => emitAlert('credential_invalidated', { bot_id: 'b1' })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
