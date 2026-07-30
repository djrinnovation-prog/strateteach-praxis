// worker/tools/lib/readonly-sql.test.ts
import {
  ALERT_QUERIES,
  ALERT_READONLY_TABLES,
  STUCK_THRESHOLD_SECONDS_DEFAULT,
  dlqSince,
  dlqTotal,
  queueFailedSince,
  stuckTrades,
  isReadOnlySelect,
  assertReadOnly,
} from './readonly-sql';

describe('readonly-sql — allow-listed tables + threshold', () => {
  test('exactly the 3 alerting tables', () => {
    expect([...ALERT_READONLY_TABLES]).toEqual(['trades_dlq', 'webhook_logs', 'trades']);
  });

  test('stuck threshold default is 300s (> VT 30s + processing)', () => {
    expect(STUCK_THRESHOLD_SECONDS_DEFAULT).toBe(300);
  });

  test('every query reads only an allow-listed table', () => {
    for (const q of ALERT_QUERIES) {
      expect(ALERT_READONLY_TABLES).toContain(q.table);
      expect(q.sql).toContain(`public.${q.table}`);
    }
  });
});

describe('readonly-sql — every defined query is a single read-only SELECT', () => {
  test.each(ALERT_QUERIES.map((q) => [q.name, q] as const))('%s passes isReadOnlySelect', (_name, q) => {
    expect(isReadOnlySelect(q.sql)).toBe(true);
    expect(() => assertReadOnly(q)).not.toThrow();
  });

  test('parameterized queries use $-placeholders, not interpolation', () => {
    expect(dlqSince.sql).toContain('$1');
    expect(queueFailedSince.sql).toContain('$1');
    expect(stuckTrades.sql).toContain('$1');
    expect(dlqTotal.params).toHaveLength(0);
    // no template-literal artifacts (`${...}`) baked into any SQL string
    for (const q of ALERT_QUERIES) expect(q.sql).not.toMatch(/\$\{/);
  });

  test('column names containing DML substrings do not trip the guard (created_at / deleted_at)', () => {
    expect(isReadOnlySelect('SELECT max(created_at) FROM public.trades_dlq')).toBe(true);
    expect(isReadOnlySelect('SELECT 1 FROM public.trades WHERE deleted_at IS NULL')).toBe(true);
  });

  test('legitimate SELECT … FROM … WHERE … and WITH … SELECT CTEs still pass', () => {
    expect(isReadOnlySelect("SELECT id FROM public.trades WHERE status = 'filled' AND deleted_at IS NULL")).toBe(true);
    expect(isReadOnlySelect('WITH x AS (SELECT id FROM public.trades) SELECT count(*) FROM x')).toBe(true);
    // A legit read wrapper (SECURITY DEFINER read-only fn) used by the reporter must NOT be blocked.
    expect(isReadOnlySelect("SELECT public.pgmq_queue_length('trade_signals')::int AS n")).toBe(true);
    // make_interval (a read-only builtin) inside the stuck-trades query must NOT be blocked.
    expect(isReadOnlySelect('SELECT count(*) FROM public.trades WHERE created_at < now() - make_interval(secs => $1)')).toBe(true);
  });
});

describe('readonly-sql — guard rejects non-read-only statements', () => {
  test.each([
    ['insert', 'INSERT INTO trades_dlq (id) VALUES (1)'],
    ['update', 'UPDATE trades SET status = $1'],
    ['delete', 'DELETE FROM trades WHERE id = $1'],
    ['truncate', 'TRUNCATE trades_dlq'],
    ['drop', 'DROP TABLE trades'],
    ['alter', 'ALTER TABLE trades ADD COLUMN x int'],
    ['grant', 'GRANT SELECT ON trades TO x'],
    ['stacked', 'SELECT 1; DROP TABLE trades'],
    ['cte-write', 'WITH x AS (DELETE FROM trades RETURNING 1) SELECT * FROM x'],
    ['not-select', 'EXPLAIN SELECT 1'],
    // ── M-10: the four named blocklist bypasses that formerly slipped through ──
    ['select-into (DDL)', 'SELECT 1 INTO x'],
    ['select-into-table', 'SELECT * INTO newtbl FROM public.trades'],
    ['set_config', "SELECT set_config('x','y',true)"],
    ['for-update lock', 'SELECT 1 FROM public.trades FOR UPDATE'],
    ['for-share lock', 'SELECT 1 FROM public.trades FOR SHARE'],
    ['for-no-key-update lock', 'SELECT 1 FROM public.trades FOR NO KEY UPDATE'],
    // extra write-function bypasses in the same class as set_config
    ['nextval (sequence write)', "SELECT nextval('some_seq')"],
    ['pg_ function call', 'SELECT pg_advisory_lock(1)'],
    ['pg_terminate_backend', 'SELECT pg_terminate_backend(42)'],
    // WITH that ultimately performs a write is still rejected
    ['with-write-cte', 'WITH x AS (UPDATE trades SET n=1 RETURNING 1) SELECT * FROM x'],
  ])('rejects %s', (_label, sql) => {
    expect(isReadOnlySelect(sql)).toBe(false);
  });

  test('assertReadOnly rejects a query whose declared table is not actually referenced (metadata cannot lie)', () => {
    expect(() =>
      assertReadOnly({
        name: 'liar',
        table: 'trades',
        sql: 'SELECT count(*)::int AS n FROM public.webhook_logs',
        params: [],
      }),
    ).toThrow(/does not reference its declared table/);
  });
});
