import { describe, test, expect } from 'vitest'
import harnessSource from './harness.ts?raw'   // Vite raw import — the module's own source as a string
import type { OperatorStatus, BotStatus } from './status'
import type { BuildInfo } from './buildinfo'
import {
  buildPreflight, captureBaseline, verifyAgainst, verifyDisarmed, generateEvidence, generateRestoreDraft,
  sqlQuoteLiteral,
} from './harness'

function bot(o: Partial<BotStatus> = {}): BotStatus {
  return {
    id: 'bot-btc', trading_pair: 'BTCUSDT', bot_status: 'active', trading_enabled: false, sizing_mode: 'fixed_notional',
    exchange_environment: 'testnet', credential_status: 'valid', credential_ok: true,
    credential_shared: false, shared_with_count: 0, config_ready: true,
    execution_ready: false, ...o,
  }
}
function status(o: Partial<OperatorStatus> = {}): OperatorStatus {
  return {
    bots: [bot()], enabled_bots: 0, open_trades: 0, dlq: 0, open_recon: 0, queue_length: 0, kill_rpc_present: true,
    worker_status: { queue_enabled: false, is_production: false, worker_state: 'disabled', boot_stuck_count: 0,
                     updated_at: '2026-07-09T00:00:00Z' },
    ...o,
  }
}
const build = (o: Partial<BuildInfo> = {}): BuildInfo => ({
  killEnabled: false, harnessEnabled: true, buildCommit: 'unknown', deployedBundle: 'index-abc.js', ...o,
})

const SECRET_RE = /(webhook_secret_hash|pepper|service_role|api[_-]?key|postgresql:\/\/|password|<REDACTED>)/i

describe('buildPreflight', () => {
  test('disarmed + kill_rpc_present → PASS', () => {
    expect(buildPreflight(status(), build()).verdict).toBe('PASS')
  })
  test('enabled_bots>0 → ATTENTION', () => {
    expect(buildPreflight(status({ enabled_bots: 2 }), build()).verdict).toBe('ATTENTION')
  })
  test('kill_rpc_present mismatch → ATTENTION', () => {
    expect(buildPreflight(status({ kill_rpc_present: false }), build()).verdict).toBe('ATTENTION')
  })
  test('worker_status null → ATTENTION (worker_state unknown)', () => {
    const r = buildPreflight(status({ worker_status: null }), build())
    expect(r.verdict).toBe('ATTENTION')
    expect(r.db.worker_state).toBe('unknown')
  })
  test('built_commit unknown → does NOT block PASS (advisory)', () => {
    const r = buildPreflight(status(), build({ buildCommit: 'unknown' }), { expectedCommit: 'abc' })
    expect(r.verdict).toBe('PASS')
    expect(r.checklist.find(c => c.item === 'commit match')?.status).toBe('unknown')
  })
  test('known commit mismatch → ATTENTION', () => {
    const r = buildPreflight(status(), build({ buildCommit: 'aaa' }), { expectedCommit: 'bbb' })
    expect(r.verdict).toBe('ATTENTION')
  })
  test('armed kill UI at rest (killEnabled=true, default expect false) → ATTENTION', () => {
    const r = buildPreflight(status(), build({ killEnabled: true }))
    expect(r.verdict).toBe('ATTENTION')
    expect(r.deploy.flag_kill_enabled).toBe(true)
    expect(r.checklist.find(c => c.item.startsWith('kill UI flag'))?.status).toBe('attention')
  })
  test('killEnabled=true accepted when expectKillEnabled=true (validation window)', () => {
    expect(buildPreflight(status(), build({ killEnabled: true }), { expectKillEnabled: true }).verdict).toBe('PASS')
  })
  // A8-H3 S1a CONTRACT (Option B): sharing → visible advisory item (attention), overall verdict UNCHANGED.
  test('S1a: disarmed + shared credential → verdict PASS, advisory item = attention (visible, not verdict-flipping)', () => {
    const shared = status({ bots: [bot({ credential_shared: true, shared_with_count: 4 })] })
    const r = buildPreflight(shared, build())
    const item = r.checklist.find(c => c.item === 'credential sharing (advisory)')
    expect(item).toBeDefined()                       // advisory ALWAYS present (visible)
    expect(item?.status).toBe('attention')           // attention because a bot shares
    expect(item?.note).toMatch(/1 bot\(s\) share a credential/)
    expect(r.verdict).toBe('PASS')                   // Option B: sharing does NOT flip the verdict at this tier
  })
  test('S1a: sharing does not RESCUE an otherwise-failing preflight (verdict still ATTENTION on a real fault)', () => {
    // enabled_bots>0 is a real fault → ATTENTION regardless of sharing; the advisory item is still present.
    const r = buildPreflight(status({ enabled_bots: 2, bots: [bot({ credential_shared: true, shared_with_count: 4 })] }), build())
    expect(r.verdict).toBe('ATTENTION')
    expect(r.checklist.find(c => c.item === 'credential sharing (advisory)')?.status).toBe('attention')
  })
  test('S1a: no shared credentials → advisory item present + ok', () => {
    const item = buildPreflight(status(), build()).checklist.find(c => c.item === 'credential sharing (advisory)')
    expect(item?.status).toBe('ok')
  })
})

describe('captureBaseline', () => {
  test('deterministic shape with ids', () => {
    const b = captureBaseline(status({ bots: [bot({ id: 'b1', bot_status: 'paused' })], enabled_bots: 0 }),
      { runId: 'OPS-x', capturedAt: '2026-07-09T00:00:00Z' })
    expect(b).toEqual({
      run_id: 'OPS-x', captured_at: '2026-07-09T00:00:00Z', enabled_bots: 0,
      bots: [{ id: 'b1', trading_pair: 'BTCUSDT', status: 'paused', trading_enabled: false }],
    })
  })
})

describe('verifyAgainst (PASS / ATTENTION / FAIL)', () => {
  test('all match, no residual → PASS', () => {
    const r = verifyAgainst(status({ bots: [bot({ id: 'b1', bot_status: 'paused' })] }),
      { enabled_bots: 0, bot_statuses: { b1: 'paused' } })
    expect(r.verdict).toBe('PASS')
  })
  test('core mismatch (enabled_bots) → FAIL', () => {
    const r = verifyAgainst(status({ enabled_bots: 1 }), { enabled_bots: 0 })
    expect(r.verdict).toBe('FAIL')
  })
  test('bot status mismatch → FAIL', () => {
    const r = verifyAgainst(status({ bots: [bot({ id: 'b1', bot_status: 'active' })] }),
      { bot_statuses: { b1: 'paused' } })
    expect(r.verdict).toBe('FAIL')
  })
  test('core match but residual open_trades → ATTENTION', () => {
    const r = verifyAgainst(status({ open_trades: 2 }), { enabled_bots: 0 })
    expect(r.verdict).toBe('ATTENTION')
  })
  test('core match but residual queue → ATTENTION', () => {
    const r = verifyAgainst(status({ queue_length: 3 }), { enabled_bots: 0 })
    expect(r.verdict).toBe('ATTENTION')
  })
  test('missing bot id (expected id absent from current) → FAIL', () => {
    const r = verifyAgainst(status({ bots: [bot({ id: 'b1' })] }), { bot_ids: ['b1', 'b2'] })
    expect(r.verdict).toBe('FAIL')
    expect(r.diffs.find(d => d.field === 'bot_ids')?.match).toBe(false)
  })
  test('extra bot id (current has one not expected) → FAIL', () => {
    const r = verifyAgainst(
      status({ bots: [bot({ id: 'b1' }), bot({ id: 'b2', trading_pair: 'ETHUSDT' })] }), { bot_ids: ['b1'] })
    expect(r.verdict).toBe('FAIL')
  })
  test('exact id set + no residual → PASS', () => {
    const r = verifyAgainst(status({ bots: [bot({ id: 'b1' })] }), { bot_ids: ['b1'], enabled_bots: 0 })
    expect(r.verdict).toBe('PASS')
  })
})

describe('verifyDisarmed', () => {
  test('disarmed → GREEN', () => { expect(verifyDisarmed(status()).verdict).toBe('GREEN') })
  test('enabled_bots>0 → NOT_DISARMED', () => {
    expect(verifyDisarmed(status({ enabled_bots: 1 })).verdict).toBe('NOT_DISARMED')
  })
  test('queue_enabled true → NOT_DISARMED', () => {
    expect(verifyDisarmed(status({ worker_status: { queue_enabled: true, is_production: false,
      worker_state: 'running', boot_stuck_count: 0, updated_at: 'x' } })).verdict).toBe('NOT_DISARMED')
  })
})

describe('generateEvidence (secret-NAMED fields are redacted — not arbitrary secret detection)', () => {
  test('contains run_id + verdicts; structure preserved', () => {
    const ev = generateEvidence({
      run_id: 'OPS-1', preflight: buildPreflight(status(), build()), disarmed: verifyDisarmed(status()),
      action_result: { ok: true, audit_id: 'a1' },
    })
    expect(ev.markdown).toContain('OPS-1')
    expect(ev.markdown).toContain('disarmed: GREEN')
    expect(ev.json).toContain('"audit_id": "a1"')
  })
  test('recursively redacts secret-named keys (nested), preserving structure', () => {
    const SENT = 'SENTINEL_RAW_VALUE'
    // Real secret-bearing keys (exact names, incl. camelCase apiKey/secretKey) — all MUST redact.
    // 'credential' is intentionally NOT here: exact-key matching no longer redacts credential_* status fields.
    const secretKeys = ['token', 'access_token', 'refresh_token', 'secret', 'secret_key', 'password',
      'authorization', 'apiKey', 'secretKey', 'api_key', 'webhook_secret_hash', 'x-admin-rotate-secret',
      'pepper', 'service_role', 'dsn', 'vault_secret_id']
    const nested: Record<string, unknown> = { ok: true, audit_id: 'a1' }
    for (const k of secretKeys) nested[k] = `${SENT}_${k}`
    const ev = generateEvidence({ run_id: 'OPS-3', action_result: { deep: { nested } } })
    const parsed = JSON.parse(ev.json)
    const n = parsed.action_result.deep.nested
    for (const k of secretKeys) expect(n[k]).toBe('<REDACTED>')   // every secret-named field redacted
    expect(n.ok).toBe(true)                                       // non-secret structure preserved
    expect(n.audit_id).toBe('a1')
    expect(ev.json).not.toContain(SENT)                           // no raw secret-named value survives
  })
  test('exact-key matching: credential_* status fields stay VISIBLE (regression for the over-broad match)', () => {
    // The operator_status payload carries these non-secret per-bot status fields; they must NOT be redacted.
    const nested = {
      credential_ok: true, credential_status: 'valid', credential: 'display-label',
      exchange_environment: 'testnet', config_ready: true,
    }
    const ev = generateEvidence({ run_id: 'OPS-4', action_result: { deep: { nested } } })
    const n = JSON.parse(ev.json).action_result.deep.nested
    expect(n.credential_ok).toBe(true)                 // NOT redacted
    expect(n.credential_status).toBe('valid')          // NOT redacted
    expect(n.credential).toBe('display-label')         // bare 'credential' also NOT redacted (not a secret key)
    expect(n.exchange_environment).toBe('testnet')
    expect(n.config_ready).toBe(true)
    expect(ev.json).not.toContain('<REDACTED>')        // zero false-positive redactions in this payload
  })
  test('a real operator_status snapshot redacts nothing (0 false positives)', () => {
    const baseline = captureBaseline(status(), { runId: 'OPS-5', capturedAt: '2026-07-10T00:00:00Z' })
    const ev = generateEvidence({ run_id: 'OPS-5', baseline })
    expect(ev.json).not.toContain('<REDACTED>')        // operator_status carries no secret-named keys
  })
})

describe('generateRestoreDraft (NON-EXECUTABLE, no run path, no secrets)', () => {
  const baseline = captureBaseline(
    status({ bots: [bot({ id: 'b1', bot_status: 'active', trading_enabled: false })] }),
    { runId: 'OPS-2', capturedAt: '2026-07-09T00:00:00Z' })
  const draft = generateRestoreDraft(baseline, status({ bots: [bot({ id: 'b1', bot_status: 'paused',
    trading_enabled: false })] }))

  test('has NOT-EXECUTABLE watermark + explicit review-required line + baseline + diff', () => {
    expect(draft).toMatch(/NOT EXECUTABLE — TEMPLATE ONLY/)
    expect(draft).toMatch(/REQUIRES SEPARATE CODEX REVIEW BEFORE EXECUTION/)
    expect(draft).toContain('b1')
    expect(draft).toMatch(/status paused->active/)
    expect(draft).toMatch(/END TEMPLATE — not executable/)
  })
  test('STRUCTURALLY non-executable: every non-blank line is a comment', () => {
    const nonBlank = draft.split('\n').filter(l => l.trim().length > 0)
    const uncommented = nonBlank.filter(l => !l.trimStart().startsWith('--'))
    expect(uncommented).toEqual([])
  })
  test('no uncommented top-level begin/commit/update/do-block', () => {
    expect(draft).not.toMatch(/^\s*(begin\b|commit\b|update\s+public\.bots|do\s+\$\$)/im)
  })
  test('no shell / run affordance (psql / DSN / supabase db query / --file / pipe-to-shell / copy-run)', () => {
    expect(draft).not.toMatch(/psql|postgresql:\/\/|supabase db query|--file|\|\s*(psql|sh|bash)|copy[^\n]*run/i)
  })
  test('no secret substrings', () => {
    expect(draft).not.toMatch(SECRET_RE)
  })
})

describe('sqlQuoteLiteral (L-8: escape single quotes to prevent injection/breakout)', () => {
  test('normal UUID round-trips as a plain single-quoted literal', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    expect(sqlQuoteLiteral(uuid)).toBe(`'${uuid}'`)
  })
  test("embedded single quote is doubled (o'brien -> 'o''brien')", () => {
    expect(sqlQuoteLiteral("o'brien")).toBe("'o''brien'")
  })
  test('classic breakout payload cannot terminate the literal early', () => {
    // Naive `'${id}'` would yield `''; drop table bots; --'` (broken out). Escaped stays inside one literal.
    expect(sqlQuoteLiteral("'; drop table bots; --")).toBe("'''; drop table bots; --'")
  })
})

describe('generateRestoreDraft escapes ids (L-8 injection template)', () => {
  test('an id containing a single quote produces no unescaped quote breakout in the generated SQL', () => {
    const evilId = "b1'; drop table bots; --"
    const baseline = captureBaseline(
      status({ bots: [bot({ id: evilId, bot_status: 'active', trading_enabled: true })] }),
      { runId: 'OPS-evil', capturedAt: '2026-07-09T00:00:00Z' })
    const draft = generateRestoreDraft(baseline, status({ bots: [bot({ id: evilId })] }))
    // The id appears with its single quote doubled inside the `in (...)` list.
    expect(draft).toContain("'b1''; drop table bots; --'")
    // Every single quote in the SQL-template `in (...)` lines is balanced (even count) — no breakout.
    for (const line of draft.split('\n').filter(l => l.includes(' in ('))) {
      expect((line.match(/'/g) ?? []).length % 2).toBe(0)
    }
  })
  test('normal UUID ids are emitted as plain quoted literals', () => {
    const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
    const baseline = captureBaseline(
      status({ bots: [bot({ id: uuid, bot_status: 'active', trading_enabled: true })] }),
      { runId: 'OPS-uuid', capturedAt: '2026-07-09T00:00:00Z' })
    const draft = generateRestoreDraft(baseline, status({ bots: [bot({ id: uuid })] }))
    expect(draft).toContain(`'${uuid}'`)
  })
})

describe('module stays read-only (no mutation import)', () => {
  test('harness.ts does not import actions.ts / any kill RPC', () => {
    expect(harnessSource).not.toMatch(/from\s+['"]\.\/actions['"]/)
    expect(harnessSource).not.toMatch(/operatorKillAll|operator_kill_all/)
  })
})
