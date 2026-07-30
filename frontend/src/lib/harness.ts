// harness.ts — Ops Harness Slice A3. PURE, DETERMINISTIC generators for the read-only harness.
// No I/O, no server RPC, no mutation, no Date.now()/random (timestamps + run_id are passed in by the caller
// so these functions are deterministic and testable). Inputs are the non-secret operator_status() payload
// (OperatorStatus) + BuildInfo. NOTHING here can call a mutation RPC.
import type { OperatorStatus } from './status'
import type { BuildInfo } from './buildinfo'

// Secret-NAMED-field redaction (not arbitrary secret-value detection): the VALUE of any object key whose
// NAME is EXACTLY a known secret-bearing field (case-insensitive, whole-key match — NOT a substring) is
// replaced with '<REDACTED>' before output. Exact matching is deliberate: status fields that merely CONTAIN
// a sensitive-looking substring — e.g. `credential_ok`, `credential_status` — are NOT redacted (the earlier
// broad-substring pattern over-matched `credential`/`vault`). This redacts by field name only; it cannot
// detect a secret value hidden under an innocuous key.
const SECRET_KEYS = new Set<string>([
  'token', 'access_token', 'refresh_token',
  'secret', 'secret_key', 'secretkey',
  'password', 'authorization',
  'apikey', 'api_key',
  'webhook_secret_hash', 'x-admin-rotate-secret',
  'pepper', 'service_role', 'dsn', 'vault_secret_id',
])
// Exact, case-insensitive whole-key match. camelCase (apiKey, secretKey) and snake_case (api_key, secret_key)
// both fold via toLowerCase() to a listed entry. 'credential', 'credential_ok', 'credential_status' are
// intentionally absent, so credential status fields stay visible.
function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase())
}
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? '<REDACTED>' : redactSecrets(v)
    }
    return out
  }
  return value
}

// ---- 1) Preflight -----------------------------------------------------------
export interface PreflightCheck { item: string; status: 'ok' | 'attention' | 'unknown'; note?: string }
export interface PreflightResult {
  db: {
    enabled_bots: number; open_trades: number; dlq: number; open_recon: number; queue_length: number
    worker_state: string; queue_enabled: boolean | 'unknown'; is_production: boolean | 'unknown'
    kill_rpc_present: boolean
  }
  deploy: {
    deployed_bundle: string; built_commit: string; expected_commit: string
    flag_kill_enabled: boolean; flag_harness_enabled: boolean
  }
  checklist: PreflightCheck[]
  verdict: 'PASS' | 'ATTENTION'
}

/** Build the preflight from a status read + build evidence. Commit compare is advisory (unknown never
 *  blocks; a known mismatch is ATTENTION). expectKillRpc defaults true. */
export function buildPreflight(
  status: OperatorStatus,
  build: BuildInfo,
  opts: { expectedCommit?: string; expectKillRpc?: boolean; expectKillEnabled?: boolean } = {},
): PreflightResult {
  const ws = status.worker_status
  const workerState = ws?.worker_state ?? 'unknown'
  const expectKillRpc = opts.expectKillRpc ?? true
  const expectKillEnabled = opts.expectKillEnabled ?? false   // safe resting state = kill UI OFF
  const expectedCommit = opts.expectedCommit && opts.expectedCommit.trim().length > 0
    ? opts.expectedCommit.trim() : 'unknown'

  const checklist: PreflightCheck[] = []
  const at = (cond: boolean, item: string, note?: string): boolean => {
    checklist.push({ item, status: cond ? 'ok' : 'attention', note })
    return cond
  }

  let ok = true
  ok = at(status.enabled_bots === 0, 'enabled_bots = 0') && ok
  ok = at(status.open_trades === 0, 'open_trades = 0') && ok
  ok = at(status.dlq === 0, 'dlq = 0') && ok
  ok = at(status.queue_length === 0, 'queue_length = 0') && ok
  ok = at(ws?.queue_enabled === false, 'QUEUE_ENABLED = false') && ok
  ok = at(ws?.is_production === false, 'is_production = false') && ok
  ok = at(workerState !== 'unknown', 'worker_state known', workerState) && ok
  ok = at(status.kill_rpc_present === expectKillRpc, `kill_rpc_present = ${expectKillRpc}`) && ok
  // Accidentally-armed kill UI at rest is ATTENTION (safe resting state after A8-H2 = read-only, flag OFF).
  ok = at(build.killEnabled === expectKillEnabled, `kill UI flag = ${expectKillEnabled}`,
          `killEnabled=${build.killEnabled}`) && ok

  // A8-H3 S1a — shared-credential detection. CONTRACT (Option B): buildPreflight's overall `verdict` is
  // NOT flipped by credential sharing — a disarmed testnet fleet that knowingly shares one credential can
  // still be PASS. Sharing is surfaced as a SEPARATE, always-visible advisory checklist item (status
  // 'attention' when any bot shares, else 'ok') so the panel shows it without failing the resting-state
  // preflight. This is DETECTION only. The hard NO-GO for a mainnet-bound bot is enforced OUTSIDE this
  // function (S1a consumers + the A4 real-funds gate), never by silently mutating this verdict.
  const sharedCount = status.bots.filter(b => b.credential_shared).length
  checklist.push({
    item: 'credential sharing (advisory)',
    status: sharedCount > 0 ? 'attention' : 'ok',
    note: sharedCount > 0
      ? `${sharedCount} bot(s) share a credential — advisory on testnet; NO-GO for any mainnet bot (enforced outside preflight)`
      : 'no shared credentials',
  })

  // Commit compare: unknown → informational (does NOT block); known mismatch → attention.
  if (build.buildCommit === 'unknown' || expectedCommit === 'unknown') {
    checklist.push({ item: 'commit match', status: 'unknown', note: `built=${build.buildCommit} expected=${expectedCommit} (compare manual)` })
  } else if (build.buildCommit === expectedCommit) {
    checklist.push({ item: 'commit match', status: 'ok', note: build.buildCommit })
  } else {
    checklist.push({ item: 'commit match', status: 'attention', note: `built=${build.buildCommit} != expected=${expectedCommit}` })
    ok = false
  }

  return {
    db: {
      enabled_bots: status.enabled_bots, open_trades: status.open_trades, dlq: status.dlq,
      open_recon: status.open_recon, queue_length: status.queue_length, worker_state: workerState,
      queue_enabled: ws?.queue_enabled ?? 'unknown', is_production: ws?.is_production ?? 'unknown',
      kill_rpc_present: status.kill_rpc_present,
    },
    deploy: {
      deployed_bundle: build.deployedBundle, built_commit: build.buildCommit, expected_commit: expectedCommit,
      flag_kill_enabled: build.killEnabled, flag_harness_enabled: build.harnessEnabled,
    },
    checklist,
    verdict: ok ? 'PASS' : 'ATTENTION',
  }
}

// ---- 2) Baseline ------------------------------------------------------------
export interface BaselineBot { id: string; trading_pair: string; status: string; trading_enabled: boolean }
export interface Baseline { run_id: string; captured_at: string; enabled_bots: number; bots: BaselineBot[] }

/** Deterministic: run_id + captured_at are supplied by the caller (no Date.now here). */
export function captureBaseline(status: OperatorStatus, meta: { runId: string; capturedAt: string }): Baseline {
  return {
    run_id: meta.runId,
    captured_at: meta.capturedAt,
    enabled_bots: status.enabled_bots,
    bots: status.bots.map(b => ({
      id: b.id, trading_pair: b.trading_pair, status: b.bot_status, trading_enabled: b.trading_enabled,
    })),
  }
}

// ---- 3) Post-action verifier ------------------------------------------------
export interface ExpectedState {
  enabled_bots?: number
  bot_ids?: string[]                             // exact expected id set (missing/extra → FAIL, id-keyed)
  bot_statuses?: Record<string, string>          // bot id -> expected status
  bot_trading_enabled?: Record<string, boolean>  // bot id -> expected trading_enabled
}
export interface VerifyDiff { field: string; expected: unknown; actual: unknown; match: boolean }
export interface VerifyResult {
  diffs: VerifyDiff[]; open_trades: number; queue_length: number; verdict: 'PASS' | 'ATTENTION' | 'FAIL'
}

export function verifyAgainst(current: OperatorStatus, expected: ExpectedState): VerifyResult {
  const diffs: VerifyDiff[] = []
  const byId = new Map(current.bots.map(b => [b.id, b]))

  if (expected.enabled_bots !== undefined) {
    diffs.push({ field: 'enabled_bots', expected: expected.enabled_bots, actual: current.enabled_bots,
      match: current.enabled_bots === expected.enabled_bots })
  }
  // Id-keyed identity: the current bot-id set must equal the expected set (no missing, no extra).
  if (expected.bot_ids !== undefined) {
    const want = [...expected.bot_ids].sort()
    const have = current.bots.map(b => b.id).sort()
    const missing = want.filter(id => !have.includes(id))
    const extra = have.filter(id => !want.includes(id))
    diffs.push({ field: 'bot_ids', expected: want, actual: have, match: missing.length === 0 && extra.length === 0 })
  }
  for (const [id, st] of Object.entries(expected.bot_statuses ?? {})) {
    const actual = byId.get(id)?.bot_status ?? '<missing>'
    diffs.push({ field: `bot[${id}].status`, expected: st, actual, match: actual === st })
  }
  for (const [id, te] of Object.entries(expected.bot_trading_enabled ?? {})) {
    const actual = byId.get(id)?.trading_enabled
    diffs.push({ field: `bot[${id}].trading_enabled`, expected: te, actual: actual ?? '<missing>', match: actual === te })
  }

  const coreMatch = diffs.every(d => d.match)
  const residual = current.open_trades > 0 || current.queue_length > 0
  const verdict: VerifyResult['verdict'] = !coreMatch ? 'FAIL' : residual ? 'ATTENTION' : 'PASS'
  return { diffs, open_trades: current.open_trades, queue_length: current.queue_length, verdict }
}

// ---- 4) Disarmed verifier ---------------------------------------------------
export interface DisarmedResult {
  enabled_bots: number; queue_enabled: boolean | 'unknown'; queue_length: number; worker_state: string
  all_at_rest: boolean; verdict: 'GREEN' | 'NOT_DISARMED'
}
export function verifyDisarmed(status: OperatorStatus): DisarmedResult {
  const ws = status.worker_status
  const atRest = status.enabled_bots === 0 && ws?.queue_enabled === false && status.queue_length === 0
  return {
    enabled_bots: status.enabled_bots, queue_enabled: ws?.queue_enabled ?? 'unknown',
    queue_length: status.queue_length, worker_state: ws?.worker_state ?? 'unknown',
    all_at_rest: atRest, verdict: atRest ? 'GREEN' : 'NOT_DISARMED',
  }
}

// ---- 5) Evidence generator --------------------------------------------------
export interface RunState {
  run_id: string
  preflight?: PreflightResult
  baseline?: Baseline
  action_result?: Record<string, unknown>   // e.g. a KillResult (already non-secret); redacted defensively
  verify?: VerifyResult
  disarmed?: DisarmedResult
}
/** Assemble evidence JSON + markdown. Secret-named keys are defensively redacted. No I/O. */
export function generateEvidence(run: RunState): { json: string; markdown: string } {
  const safe = redactSecrets(run) as RunState
  const json = JSON.stringify(safe, null, 2)
  const lines: string[] = [
    `# Ops evidence — run ${safe.run_id}`,
    '',
    `- preflight: ${safe.preflight?.verdict ?? 'n/a'}`,
    `- action: ${safe.action_result ? 'recorded' : 'n/a'}`,
    `- verify: ${safe.verify?.verdict ?? 'n/a'}`,
    `- disarmed: ${safe.disarmed?.verdict ?? 'n/a'}`,
    `- baseline bots: ${safe.baseline?.bots.length ?? 0}`,
  ]
  return { json, markdown: lines.join('\n') }
}

// ---- 6) Restore DRAFT generator (NON-EXECUTABLE template) --------------------
// Every line of the draft is a comment (`--`) or blank — the artifact is STRUCTURALLY non-executable, not
// merely watermarked. There is no uncommented begin;/commit;/update/do-block, no psql/db-query/pipe/copy-run.
const RESTORE_HEADER = [
  '-- NOT EXECUTABLE — TEMPLATE ONLY (structurally commented). Not a runnable command; no pipe/run path.',
  '-- REQUIRES SEPARATE CODEX REVIEW BEFORE EXECUTION.',
  '-- The FILLED executable restore packet must be produced + Codex-reviewed separately, then operator-run.',
]

/** Quote a value as a safe single-quoted SQL string literal by doubling any embedded single quotes
 *  (`'` -> `''`). This prevents quote-breakout / injection when the restore template is later uncommented
 *  and operator-run. Ids are expected to be UUIDs, but this stays correct even if the id source widens. */
export function sqlQuoteLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

/** Produce a STRUCTURALLY NON-EXECUTABLE restore review draft: every line commented/blank. Contains the
 *  baseline JSON + per-bot diff + a fully-commented SQL template. No psql/DSN/db-query/copy-run, no secrets. */
export function generateRestoreDraft(baseline: Baseline, current: OperatorStatus): string {
  const byId = new Map(current.bots.map(b => [b.id, b]))
  const enableIds = baseline.bots.filter(b => b.trading_enabled).map(b => b.id)
  const activeIds = baseline.bots.filter(b => b.status === 'active').map(b => b.id)

  const diffLines = baseline.bots.map(b => {
    const cur = byId.get(b.id)
    const curStatus = cur?.bot_status ?? '<missing>'
    const curEnabled = cur ? String(cur.trading_enabled) : '<missing>'
    const match = curStatus === b.status && String(cur?.trading_enabled) === String(b.trading_enabled)
    return `--   ${b.id}  ${b.trading_pair}: status ${curStatus}->${b.status}  ` +
           `trading_enabled ${curEnabled}->${String(b.trading_enabled)}  [${match ? 'MATCH' : 'DIFF'}]`
  })

  const idList = (ids: string[]) => ids.length ? ids.map(sqlQuoteLiteral).join(', ') : '/* none */'

  return [
    ...RESTORE_HEADER,
    `-- run ${baseline.run_id}   captured_at ${baseline.captured_at}`,
    '',
    '-- Baseline (restore target):',
    JSON.stringify(baseline, null, 2).split('\n').map(l => `--   ${l}`).join('\n'),
    '',
    '-- Current-vs-baseline diff:',
    ...diffLines,
    '',
    '-- Restore SQL TEMPLATE (fully commented — fill/verify + Codex-review before any run):',
    '--   begin;',
    `--     -- re-enable trading for baseline trading_enabled=true bots (exactly ${enableIds.length} rows expected):`,
    `--     -- update public.bots set trading_enabled=true where id in (${idList(enableIds)}) and deleted_at is null;`,
    `--     -- un-pause baseline status=active bots (exactly ${activeIds.length} rows expected):`,
    `--     -- update public.bots set status='active' where id in (${idList(activeIds)}) and deleted_at is null;`,
    '--     -- + exactly-N row guard + post-restore per-bot baseline verification (raise+rollback on mismatch).',
    '--   commit;',
    '',
    '-- END TEMPLATE — not executable as-is.',
  ].join('\n')
}
