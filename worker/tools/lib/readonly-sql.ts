// worker/tools/lib/readonly-sql.ts
//
// Pure, dependency-free read-only SQL definitions for Sprint-4 alerting (S4-1) and the
// S4-0.5 evidence reporter. This module:
//   - does NOT connect to a database
//   - does NOT import worker runtime code
//   - does NOT read secrets or perform any I/O
// It only declares parameterized SELECT templates + static guards. Callers bind parameters
// at the driver layer ($1..) — never string-interpolate untrusted input into these.

export const ALERT_READONLY_TABLES = ['trades_dlq', 'webhook_logs', 'trades'] as const;
export type AlertReadonlyTable = (typeof ALERT_READONLY_TABLES)[number];

/** Default stuck-trade threshold: 5 min, well above VT 30s + ~2s processing (no flapping). */
export const STUCK_THRESHOLD_SECONDS_DEFAULT = 300;

export interface ReadonlyQuery {
  /** Stable identifier (used in logs/tests). */
  name: string;
  /** One read-only SELECT, parameterized with $1.. placeholders only. */
  sql: string;
  /** Ordered description of each placeholder. */
  params: string[];
  /** The single table this query reads (must be in ALERT_READONLY_TABLES). */
  table: AlertReadonlyTable;
}

// ── Alerting criteria (S4-1) ────────────────────────────────────────────────

/** DLQ rows newer than a watermark — alert if n > 0. */
export const dlqSince: ReadonlyQuery = {
  name: 'dlq_since',
  table: 'trades_dlq',
  sql: 'SELECT count(*)::int AS n, max(created_at) AS newest FROM public.trades_dlq WHERE created_at > $1',
  params: ['$1 since (timestamptz)'],
};

/** Total DLQ rows — floor check (DLQ should be empty in a healthy testnet run). */
export const dlqTotal: ReadonlyQuery = {
  name: 'dlq_total',
  table: 'trades_dlq',
  sql: 'SELECT count(*)::int AS n FROM public.trades_dlq',
  params: [],
};

/** webhook_logs flipped to queue_failed since a watermark — alert if n > 0. */
export const queueFailedSince: ReadonlyQuery = {
  name: 'queue_failed_since',
  table: 'webhook_logs',
  sql: "SELECT count(*)::int AS n, max(received_at) AS newest FROM public.webhook_logs WHERE status = 'queue_failed' AND received_at > $1",
  params: ['$1 since (timestamptz)'],
};

/** Pending/unknown trades older than a threshold (seconds) — alert if n > 0. */
export const stuckTrades: ReadonlyQuery = {
  name: 'stuck_trades',
  table: 'trades',
  sql: "SELECT count(*)::int AS n FROM public.trades WHERE status IN ('pending','unknown') AND created_at < now() - make_interval(secs => $1) AND deleted_at IS NULL",
  params: ['$1 threshold_seconds (int)'],
};

export const ALERT_QUERIES: readonly ReadonlyQuery[] = [
  dlqSince,
  dlqTotal,
  queueFailedSince,
  stuckTrades,
];

// ── Static read-only guard (defense-in-depth, NOT the real guarantee) ────────
//
// IMPORTANT: this static text guard is NOT the last line of defence and it is NOT sufficient on its
// own. A keyword check on SQL text can never be a sound proof of read-only-ness — writing functions
// (e.g. a SECURITY DEFINER wrapper), obscure builtins, and future syntax will always be able to hide
// behind a leading SELECT. The ACTUAL guarantee is the database least-privilege layer:
//   1. a dedicated read-only role that has been GRANTed SELECT (and nothing else) on the report tables, and
//   2. the session-level `SET default_transaction_read_only = on` the runner forces on connect.
// Even a statement that slips past this guard cannot mutate under that role/session. This function is a
// cheap, fail-closed (unknown => reject) tripwire that catches obvious mistakes in our own static
// query definitions early — it is defence-in-depth, not the wire-level authority.
//
// Word boundaries matter: `created_at`/`deleted_at` must NOT trip `create`/`delete`.

// Statement-level DML/DDL and session-mutating keywords.
const FORBIDDEN_SQL_RE =
  /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|merge|call|do|vacuum|comment|set|into|lock|listen|notify|reindex|cluster|refresh|reset)\b/i;

// Row-locking clauses turn a SELECT into a writer of lock state — reject them explicitly. A bare
// `\bfor\b` would be too broad, so match only the actual locking clauses. (Catches the `... FOR UPDATE`
// bypass that a keyword blocklist misses.)
const LOCKING_CLAUSE_RE = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b/i;

// Known writing / session-mutating builtins callable from inside a SELECT list, which the generic
// keyword blocklist misses because they are function calls, not statements:
//   - set_config(...)  — mutates a GUC (the `\bset\b` blocklist does NOT match `set_config`)
//   - nextval(...)/setval(...) — advance/set a sequence (a write)
//   - any pg_<name>(...) call — advisory locks, pg_terminate_backend, pg_read_file, etc.
// NOTE: we deliberately match pg_ *function calls* (followed by `(`), not pg_catalog table reads,
// and we do NOT ban all function calls — legitimate read wrappers exist (e.g. the reporter's
// SECURITY DEFINER `public.pgmq_queue_length(...)`). A *writing* user/SECURITY-DEFINER function whose
// name is not in this set CANNOT be detected from SQL text; that residual is covered by the read-only
// DB role/session above — see the module note.
const WRITE_FUNCTION_RE = /\b(set_config|nextval|setval|pg_\w+)\s*\(/i;

/**
 * Heuristic tripwire: true only for a single statement that starts with SELECT (or a WITH…SELECT CTE)
 * and contains none of the forbidden write constructs above. Fail-closed: anything unrecognised => false.
 * This is defence-in-depth, not a security boundary — the read-only DB role/session is the real guard.
 */
export function isReadOnlySelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/\s+/g, ' ');
  if (trimmed.includes(';')) return false; // single statement only (reject stacked statements)
  // Must lead with SELECT, or a WITH … SELECT CTE (which must actually contain a SELECT).
  if (/^with\b/i.test(trimmed)) {
    if (!/\bselect\b/i.test(trimmed)) return false;
  } else if (!/^select\b/i.test(trimmed)) {
    return false;
  }
  if (FORBIDDEN_SQL_RE.test(trimmed)) return false;
  if (LOCKING_CLAUSE_RE.test(trimmed)) return false;
  if (WRITE_FUNCTION_RE.test(trimmed)) return false;
  return true;
}

/**
 * Throws if the query is not a single read-only SELECT, reads a non-allow-listed table, or if its
 * declared `table` metadata does not actually appear as `public.<table>` in the SQL (so the self-declared
 * metadata cannot lie about what the statement reads). Still defence-in-depth — see the module note.
 */
export function assertReadOnly(q: ReadonlyQuery): void {
  if (!isReadOnlySelect(q.sql)) {
    throw new Error(`readonly-sql: query "${q.name}" is not a single read-only SELECT`);
  }
  if (!ALERT_READONLY_TABLES.includes(q.table)) {
    throw new Error(`readonly-sql: query "${q.name}" reads non-allow-listed table "${q.table}"`);
  }
  // Bind the metadata to reality: the declared table must actually be referenced as public.<table>.
  if (!q.sql.includes(`public.${q.table}`)) {
    throw new Error(`readonly-sql: query "${q.name}" does not reference its declared table "public.${q.table}"`);
  }
}
