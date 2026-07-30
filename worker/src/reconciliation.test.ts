// worker/src/reconciliation.test.ts
import {
  resolveStuckTrade,
  resolvePendingReconciliations,
  defaultAdapterFor,
  type StuckTrade,
} from './reconciliation';
import { ExchangeAdapter } from './types';
import { ExchangeAuthError, ExchangeTimeoutError, ExchangeUnavailableError } from './types';
import { SupabaseClient } from '@supabase/supabase-js';

// ─── Supabase mock (FIFO chains, mirrors index.test.ts) ──────────────────────
type Chain = Record<string, jest.Mock> & {
  then: PromiseLike<unknown>['then'];
};

function sbChain(result: unknown): Chain {
  const p = Promise.resolve(result);
  const chain = {} as Chain;
  const self = (): Chain => chain;
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'is', 'in', 'lt']) {
    chain[m] = jest.fn().mockImplementation(self);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = p.then.bind(p) as PromiseLike<unknown>['then'];
  (chain as unknown as { catch: unknown }).catch = p.catch.bind(p);
  (chain as unknown as { finally: unknown }).finally = p.finally.bind(p);
  return chain;
}
const sbOk = (data: unknown = null): Chain => sbChain({ data, error: null });
const sbErr = (code: string): Chain => sbChain({ data: null, error: { code } });
/** A trades-UPDATE chain that reports exactly one affected row. */
const tradeOk = (): Chain => sbOk([{ id: 't1' }]);
/** A reconciliation_jobs-UPDATE chain that reports exactly one affected pending row. */
const jobOk = (id = 't1'): Chain => sbOk([{ trade_id: id }]);

function makeSupabase(...chains: Chain[]): SupabaseClient {
  let i = 0;
  const from = jest.fn(() => {
    const c = chains[i++];
    if (!c) throw new Error(`unexpected from() call #${i} (only ${chains.length} chains provided)`);
    return c;
  });
  return { from } as unknown as SupabaseClient;
}

// ─── Adapter mock ────────────────────────────────────────────────────────────
function makeAdapter(fetchOrder: jest.Mock) {
  return {
    getMarketRules: jest.fn(),
    fetchBalance: jest.fn(),
    createOrder: jest.fn(),
    fetchOrder,
  };
}
function order(status: string) {
  return {
    id: 'ex-1',
    clientOrderId: 'PRX_abc',
    symbol: 'BTCUSDT',
    side: 'buy',
    type: 'market',
    status,
    quantity: 1,
    filled: 1,
    price: 100,
    cost: 100,
    timestamp: 0,
  };
}
function trade(over: Partial<StuckTrade> = {}): StuckTrade {
  return {
    id: 't1',
    bot_id: 'b1',
    signal_id: 'S4-3A-test',
    status: 'unknown',
    client_order_id: 'PRX_abc',
    trading_pair: 'BTCUSDT',
    exchange_order_id: null,
    ...over,
  };
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** Parse structured-log lines captured by a console spy. */
function logged(spy: jest.SpyInstance): Array<Record<string, unknown>> {
  return spy.mock.calls.flatMap((args: unknown[]) => {
    try {
      return [JSON.parse(String(args[0])) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

describe('resolveStuckTrade — outcome mappings (fetchOrder only, never createOrder)', () => {
  test('filled → trade filled, job resolved/filled (exactly one job row)', async () => {
    const tUpdate = tradeOk();
    const recon = jobOk();
    const audit = sbOk();
    const supabase = makeSupabase(tUpdate, recon, audit);
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('filled')));

    const r = await resolveStuckTrade(supabase, adapter as unknown as ExchangeAdapter, trade());

    expect(r).toEqual({ trade_id: 't1', action: 'resolved_filled', trade_status: 'filled' });
    expect(adapter.fetchOrder).toHaveBeenCalledWith({ clientOrderId: 'PRX_abc', symbol: 'BTCUSDT' });
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
    // M-6: the resolved fill is persisted (order id / price / executed notional / filled_at) — no
    // NULL-price filled rows; P&L computable and the order traceable.
    expect(tUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'filled',
      exchange_order_id: 'ex-1',
      price_at_execution: 100,
      executed_notional_usdt: 100,
    }));
    const filledPatch = (tUpdate.update as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(filledPatch.filled_at).toBeTruthy(); // filled_at stamped
    expect(tUpdate.in).toHaveBeenCalledWith('status', ['pending', 'unknown']);
    expect(recon.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolution: 'filled' }));
    expect(recon.eq).toHaveBeenCalledWith('status', 'pending');
    expect(recon.select).toHaveBeenCalledWith('trade_id'); // affected-row verification
  });

  test('cancelled → trade cancelled, job resolved/cancelled', async () => {
    const recon = jobOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('cancelled')));

    const r = await resolveStuckTrade(makeSupabase(tradeOk(), recon, sbOk()), adapter as unknown as ExchangeAdapter, trade());

    expect(r.action).toBe('resolved_cancelled');
    expect(recon.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolution: 'cancelled' }));
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('failed → trade failed, job resolved with resolution NULL + notes (enum default b)', async () => {
    const tUpdate = tradeOk();
    const recon = jobOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('failed')));

    const r = await resolveStuckTrade(makeSupabase(tUpdate, recon, sbOk()), adapter as unknown as ExchangeAdapter, trade());

    expect(r.action).toBe('resolved_failed');
    expect(tUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_reason: 'order_failed' }));
    expect(recon.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolution: null, notes: 'order_failed' }));
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('null (OrderNotFound) → trade failed, resolution NULL + notes order_not_found', async () => {
    const tUpdate = tradeOk();
    const recon = jobOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(null));

    const r = await resolveStuckTrade(makeSupabase(tUpdate, recon, sbOk()), adapter as unknown as ExchangeAdapter, trade({ status: 'pending' }));

    expect(r.action).toBe('resolved_failed');
    expect(tUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_reason: 'order_not_found' }));
    expect(recon.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolution: null, notes: 'order_not_found' }));
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('submitted (open) → trade LEFT pending/unknown (not orphaned), job annotated only', async () => {
    // Only a recon chain is provided: if the resolver tried to UPDATE trades it would throw.
    const recon = sbOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('submitted')));

    const r = await resolveStuckTrade(makeSupabase(recon), adapter as unknown as ExchangeAdapter, trade());

    // Trade status is UNCHANGED so a later boot re-selects it; job stays pending with a note.
    expect(r).toEqual({ trade_id: 't1', action: 'left_open', trade_status: 'unknown' });
    expect(recon.update).toHaveBeenCalledWith({ notes: 'order_open' });
    expect(recon.eq).toHaveBeenCalledWith('status', 'pending');
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('terminal trade update succeeds but job update returns [] (0 rows) → job_update_failed, orphan logged, NOT resolved', async () => {
    const tUpdate = tradeOk(); // trade really moved to terminal
    const recon = sbOk([]); // 0 pending rows matched, NO error
    const audit = sbOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('filled')));

    const r = await resolveStuckTrade(makeSupabase(tUpdate, recon, audit), adapter as unknown as ExchangeAdapter, trade());

    expect(r).toEqual({ trade_id: 't1', action: 'job_update_failed', trade_status: 'filled' });
    expect(audit.insert).toHaveBeenCalled(); // transition still audited
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
    const orphan = logged(errorSpy).find((e) => e.event === 'reconciliation_job_orphaned');
    expect(orphan).toBeDefined();
    expect(orphan).toMatchObject({ trade_id: 't1', job_rows: 0 });
  });

  test('terminal trade update succeeds but job update ERRORS → job_update_failed, orphan logged', async () => {
    const tUpdate = tradeOk();
    const recon = sbErr('XX'); // DB error on the job update
    const audit = sbOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('filled')));

    const r = await resolveStuckTrade(makeSupabase(tUpdate, recon, audit), adapter as unknown as ExchangeAdapter, trade());

    expect(r).toEqual({ trade_id: 't1', action: 'job_update_failed', trade_status: 'filled' });
    expect(tUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'filled' }));
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
    expect(logged(errorSpy).find((e) => e.event === 'reconciliation_job_orphaned')).toBeDefined();
  });

  test('exchange unknown → leave pending, note only, no trade change', async () => {
    const recon = sbOk();
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('unknown')));

    const r = await resolveStuckTrade(makeSupabase(recon), adapter as unknown as ExchangeAdapter, trade());

    expect(r.action).toBe('left_pending_unknown');
    expect(recon.update).toHaveBeenCalledWith({ notes: 'exchange_unknown' });
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('transient ExchangeTimeoutError → leave trade+job pending, NO db writes', async () => {
    const supabase = makeSupabase(); // any from() would throw → asserts zero DB calls
    const adapter = makeAdapter(jest.fn().mockRejectedValue(new ExchangeTimeoutError()));

    const r = await resolveStuckTrade(supabase, adapter as unknown as ExchangeAdapter, trade());

    expect(r.action).toBe('left_pending_transient');
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('transient ExchangeUnavailableError → leave pending, NO db writes', async () => {
    const adapter = makeAdapter(jest.fn().mockRejectedValue(new ExchangeUnavailableError()));
    const r = await resolveStuckTrade(makeSupabase(), adapter as unknown as ExchangeAdapter, trade());
    expect(r.action).toBe('left_pending_transient');
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('ExchangeAuthError + a pending job (1 row) → job_failed_auth, trade NOT forced terminal', async () => {
    const recon = jobOk();
    const adapter = makeAdapter(jest.fn().mockRejectedValue(new ExchangeAuthError()));

    const r = await resolveStuckTrade(makeSupabase(recon), adapter as unknown as ExchangeAdapter, trade());

    expect(r).toEqual({ trade_id: 't1', action: 'job_failed_auth', trade_status: 'unknown' });
    expect(recon.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', notes: 'auth_error' }));
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('ExchangeAuthError but job update matched 0 rows → does NOT claim job_failed_auth (left pending for retry)', async () => {
    const recon = sbOk([]); // no pending job updated
    const adapter = makeAdapter(jest.fn().mockRejectedValue(new ExchangeAuthError()));

    const r = await resolveStuckTrade(makeSupabase(recon), adapter as unknown as ExchangeAdapter, trade());

    expect(r).toEqual({ trade_id: 't1', action: 'left_pending_transient', trade_status: 'unknown' });
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('entry guard: already-terminal trade → noop, fetchOrder NEVER called', async () => {
    const adapter = makeAdapter(jest.fn());
    const r = await resolveStuckTrade(makeSupabase(), adapter as unknown as ExchangeAdapter, trade({ status: 'filled' }));
    expect(r.action).toBe('noop_not_stuck');
    expect(adapter.fetchOrder).toHaveBeenCalledTimes(0);
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });

  test('race: conditional trade UPDATE matches 0 rows → noop_race, job NOT touched', async () => {
    const tUpdate = sbOk([]); // 0 rows updated — another path already resolved it
    const supabase = makeSupabase(tUpdate); // only the trades update chain; recon/audit must NOT be called
    const adapter = makeAdapter(jest.fn().mockResolvedValue(order('filled')));

    const r = await resolveStuckTrade(supabase, adapter as unknown as ExchangeAdapter, trade());

    expect(r.action).toBe('noop_race');
    expect(tUpdate.in).toHaveBeenCalledWith('status', ['pending', 'unknown']);
    expect(adapter.createOrder).toHaveBeenCalledTimes(0);
  });
});

describe('resolvePendingReconciliations — boot orchestration', () => {
  test('processes eligible trades via injected adapterFor; never createOrder', async () => {
    const t1 = trade({ id: 't1', client_order_id: 'PRX_1' });
    const t2 = trade({ id: 't2', client_order_id: 'PRX_2' });
    const supabase = makeSupabase(
      sbOk([t1, t2]), // stuck-trades query
      sbOk([{ id: 't1' }]), jobOk('t1'), sbOk(), // t1: trade update, recon (1 row), audit
      sbOk([{ id: 't2' }]), jobOk('t2'), sbOk(), // t2
    );
    const createOrder = jest.fn();
    const adapterFor = jest.fn().mockResolvedValue({
      getMarketRules: jest.fn(),
      fetchBalance: jest.fn(),
      createOrder,
      fetchOrder: jest.fn().mockResolvedValue(order('filled')),
    } as unknown as ExchangeAdapter);

    const results = await resolvePendingReconciliations(supabase, { isProduction: false, adapterFor });

    expect(results.map((r) => r.action)).toEqual(['resolved_filled', 'resolved_filled']);
    expect(adapterFor).toHaveBeenCalledTimes(2);
    expect(createOrder).toHaveBeenCalledTimes(0);
  });

  test('cap bounds processing; remainder deferred (logged, not silently dropped)', async () => {
    const trades = [trade({ id: 't1' }), trade({ id: 't2' }), trade({ id: 't3' })];
    const supabase = makeSupabase(
      sbOk(trades),
      sbOk([{ id: 't1' }]), jobOk('t1'), sbOk(),
      sbOk([{ id: 't2' }]), jobOk('t2'), sbOk(),
    );
    const adapterFor = jest.fn().mockResolvedValue({
      getMarketRules: jest.fn(), fetchBalance: jest.fn(), createOrder: jest.fn(),
      fetchOrder: jest.fn().mockResolvedValue(order('filled')),
    } as unknown as ExchangeAdapter);

    const results = await resolvePendingReconciliations(supabase, { isProduction: false, cap: 2, adapterFor });

    expect(results).toHaveLength(2); // only cap processed
    expect(adapterFor).toHaveBeenCalledTimes(2);
  });

  test('adapterFor returns null → trade skipped, job left pending, no DB writes for it', async () => {
    const supabase = makeSupabase(sbOk([trade({ id: 't1' })])); // only the stuck query; no per-trade chains
    const adapterFor = jest.fn().mockResolvedValue(null);

    const results = await resolvePendingReconciliations(supabase, { isProduction: false, adapterFor });

    expect(results).toEqual([{ trade_id: 't1', action: 'left_pending_transient', trade_status: 'unknown' }]);
  });

  test('query error → returns empty, no work', async () => {
    const supabase = makeSupabase(sbErr('57014'));
    const adapterFor = jest.fn();
    const results = await resolvePendingReconciliations(supabase, { isProduction: false, adapterFor });
    expect(results).toEqual([]);
    expect(adapterFor).not.toHaveBeenCalled();
  });
});

// ─── A8-H3 W1: defaultAdapterFor ownership fail-closed ───────────────────────
describe('defaultAdapterFor — credential ownership (A8-H3 W1)', () => {
  const trade = { id: 't1', bot_id: 'bot-1' } as unknown as StuckTrade;
  const VAULT = '7e57ed00-aaaa-bbbb-cccc-123456789abc';

  test('ownership mismatch (cred.user_id != bot.user_id) → returns null, logs a NO-SECRET observable event', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabase(
      sbChain({ data: { credential_id: 'cred-1', user_id: 'user-A' }, error: null }),                        // bots
      sbChain({ data: { vault_secret_id: VAULT, status: 'valid', deleted_at: null, user_id: 'user-B' }, error: null }), // cred (different owner)
    );
    const adapter = await defaultAdapterFor(supabase, trade, false);
    expect(adapter).toBeNull();   // fail-closed: no BinanceAdapter, trade left pending, no exchange call

    // Observable: exactly the no-secret mismatch event (ids only), and the vault_secret_id VALUE never logged.
    const logged = errSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(logged).toContain('reconciliation_credential_owner_mismatch');
    expect(logged).toContain('bot-1');
    expect(logged).not.toContain(VAULT);          // no vault_secret_id value in any log
    errSpy.mockRestore();
  });

  test('null credential_id → returns null (unchanged fail-closed)', async () => {
    const supabase = makeSupabase(
      sbChain({ data: { credential_id: null, user_id: 'user-A' }, error: null }),
    );
    const adapter = await defaultAdapterFor(supabase, trade, false);
    expect(adapter).toBeNull();
  });
});

// ─── EP1b: defaultAdapterFor venue gate (is_active AND SUPPORTED_EXCHANGES) ───────────────────
// The reconciliation factory applies the SAME two fail-closed gates as the live order path, so it
// can never reconcile a trade against the wrong exchange (e.g. after a venue is deactivated, or one
// that the worker has not code-validated). All chains: bots → credential → exchanges.
describe('defaultAdapterFor — exchange venue gate (EP1b)', () => {
  const trade = { id: 't1', bot_id: 'bot-1' } as unknown as StuckTrade;
  const VAULT = '7e57ed00-aaaa-bbbb-cccc-123456789abc';
  const bots = () => sbChain({ data: { credential_id: 'cred-1', user_id: 'user-A' }, error: null });
  const cred = () => sbChain({
    data: { vault_secret_id: VAULT, status: 'valid', deleted_at: null, user_id: 'user-A', exchange_id: 'exch-1' },
    error: null,
  });

  test('active + supported (binance) → builds an adapter (both gates pass)', async () => {
    const supabase = makeSupabase(bots(), cred(), sbChain({ data: { ccxt_id: 'binance', is_active: true }, error: null }));
    expect(await defaultAdapterFor(supabase, trade, false)).not.toBeNull();
  });

  test('venue INACTIVE (is_active=false) → null (fail-closed, trade left pending)', async () => {
    const supabase = makeSupabase(bots(), cred(), sbChain({ data: { ccxt_id: 'binance', is_active: false }, error: null }));
    expect(await defaultAdapterFor(supabase, trade, false)).toBeNull();
  });

  test('venue active but NOT in the worker allowlist (bybit) → null (fail-closed)', async () => {
    const supabase = makeSupabase(bots(), cred(), sbChain({ data: { ccxt_id: 'bybit', is_active: true }, error: null }));
    expect(await defaultAdapterFor(supabase, trade, false)).toBeNull();
  });

  test('exchange fetch error → null (fail-closed; venue truth unknown)', async () => {
    const supabase = makeSupabase(bots(), cred(), sbChain({ data: null, error: { code: '57014' } }));
    expect(await defaultAdapterFor(supabase, trade, false)).toBeNull();
  });

  test('exchange row missing (null) → null (fail-closed)', async () => {
    const supabase = makeSupabase(bots(), cred(), sbChain({ data: null, error: null }));
    expect(await defaultAdapterFor(supabase, trade, false)).toBeNull();
  });
});
