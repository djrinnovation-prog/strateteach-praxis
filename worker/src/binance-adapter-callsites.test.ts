/**
 * binance-adapter-callsites.test.ts
 *
 * A1 Option B (exchange egress proxy) source-level invariant:
 *
 *     production + BinanceAdapter  =>  proxy exists   (NO exceptions)
 *
 * The runtime guards (worker Step 4b, reconciliation defaultAdapterFor) plus the
 * BinanceAdapter constructor invariant enforce this at run time. This test enforces it
 * STATICALLY so a future call site cannot silently reintroduce a proxy-less construction:
 * every `new BinanceAdapter(` in worker source MUST pass the 4th (exchangeHttpsProxy) argument,
 * and the set of construction sites must be exactly the known, reviewed ones.
 *
 * Pure source scan — imports nothing from the worker, runs no network, touches no secret.
 */

import * as fs from 'fs'
import * as path from 'path'

const SRC_DIR = __dirname
const MARKER = 'new BinanceAdapter('

/** Recursively list *.ts source files under src/, excluding test files. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * For each `new BinanceAdapter(...)` in `source`, count the top-level arguments by
 * walking from the opening paren to its match and counting depth-1 commas. Nested
 * parens/args (e.g. `new VaultSecretsProvider(supabase)`) are skipped via the depth guard.
 */
function argCounts(source: string): number[] {
  const counts: number[] = []
  let idx = source.indexOf(MARKER)
  while (idx !== -1) {
    const openParen = idx + MARKER.length - 1 // index of the '(' in the marker
    let depth = 0
    let commas = 0
    let sawArg = false
    for (let i = openParen; i < source.length; i++) {
      const ch = source[i]
      if (ch === '(') {
        depth++
      } else if (ch === ')') {
        depth--
        if (depth === 0) break
      } else if (depth === 1) {
        if (ch === ',') commas++
        if (!/\s/.test(ch)) sawArg = true
      }
    }
    counts.push(sawArg ? commas + 1 : 0)
    idx = source.indexOf(MARKER, idx + MARKER.length)
  }
  return counts
}

/**
 * Count the top-level arguments of each `processMessage(` CALL (skipping its `function` definition)
 * in comment-stripped source. Proves no PRODUCTION call passes the optional 3rd `deps` arg (the
 * T3a adapter-factory seam), which could otherwise build an adapter with a non-real
 * isProduction/egress under production. `stripComments` is a hoisted function declaration below.
 */
function processMessageCallArgCounts(source: string): number[] {
  const src = stripComments(source)
  const MARKER = 'processMessage('
  const counts: number[] = []
  let idx = src.indexOf(MARKER)
  while (idx !== -1) {
    const before = src.slice(Math.max(0, idx - 9), idx)
    if (!/function\s$/.test(before)) { // skip the definition `function processMessage(`
      const openParen = idx + MARKER.length - 1
      let depth = 0
      let commas = 0
      let sawArg = false
      for (let i = openParen; i < src.length; i++) {
        const ch = src[i]
        if (ch === '(') {
          depth++
        } else if (ch === ')') {
          depth--
          if (depth === 0) break
        } else if (depth === 1) {
          if (ch === ',') commas++
          if (!/\s/.test(ch)) sawArg = true
        }
      }
      counts.push(sawArg ? commas + 1 : 0)
    }
    idx = src.indexOf(MARKER, idx + MARKER.length)
  }
  return counts
}

describe('A1 Option B — BinanceAdapter construction call sites (static guard)', () => {
  const files = sourceFiles(SRC_DIR)
  const sites = files
    .map((f) => ({ file: path.basename(f), counts: argCounts(fs.readFileSync(f, 'utf8')) }))
    .filter((s) => s.counts.length > 0)

  test('every `new BinanceAdapter(` call site passes BOTH egress args (4th proxy + 5th native — B0)', () => {
    // Fails loudly if a new site omits an egress arg — so no path can silently reintroduce an
    // unconfigured-egress construction. Both the proxy (4th) and nativeEgressAllowed (5th) must be explicit.
    const offenders = sites
      .flatMap((s) => s.counts.map((c) => ({ file: s.file, args: c })))
      .filter((s) => s.args < 5)
    expect(offenders).toEqual([])
  })

  test('construction sites are exactly the known, reviewed set (no surprise path)', () => {
    // If this fails, a new file constructs BinanceAdapter — verify it is guarded before
    // construction in production, then add it here.
    const filesWithSites = sites.map((s) => s.file).sort()
    // flatten.ts (EP5): a reviewed construction site — resolveAdapterForBot fail-closes on
    // unconfigured production egress BEFORE constructing, and passes the egress args (6-arg form).
    // credentialValidation.ts (M8): a reviewed READ-ONLY site — fail-closes on ownership / venue
    // is_active+SUPPORTED / env / production egress BEFORE constructing, passes the egress args
    // (6-arg form), and calls ONLY fetchBalance (never createOrder).
    expect(filesWithSites).toEqual(['credentialValidation.ts', 'flatten.ts', 'index.ts', 'reconciliation.ts', 'spike-binance.ts'])
  })

  test('no production processMessage() call injects the adapter factory (T3a seam is test-only, ≤2 args)', () => {
    // deps.adapterFactory is injectable ONLY by tests. A prod call passing a 3rd arg could construct
    // an adapter with a non-real isProduction/egress under production — forbid it statically.
    const offenders = files
      .flatMap((f) =>
        processMessageCallArgCounts(fs.readFileSync(f, 'utf8')).map((args) => ({ file: path.basename(f), args })),
      )
      .filter((s) => s.args > 2)
    expect(offenders).toEqual([])
  })
})

// ── No direct-exchange import guard (ccxt import-scope) ────────────────────────────
// BinanceAdapter is the ONLY sanctioned place that PLACES ORDERS on the exchange: it
// installs every safety rail (static-egress proxy, testnet/mainnet guard, kill switch,
// sizing/risk caps, secret zeroing). A direct `ccxt` import anywhere else on the worker
// surface could talk to the exchange bypassing those rails. The construction-site guard
// above only proves `new BinanceAdapter(` sites are correct — it does NOT stop a new file
// from importing ccxt directly. This guard closes that gap (T2). Test-only; no runtime change.
//
// Scope = the WHOLE deployed worker surface, not just src/: also worker/scripts (ops tools
// that run on the Railway worker — e.g. validate-credential.mjs, which holds mainnet keys)
// and worker/tools, across every source extension (.ts/.mts/.cts/.mjs/.cjs/.js).

const WORKER_ROOT = path.join(SRC_DIR, '..') // worker/
const SCAN_ROOTS = ['src', 'scripts', 'tools'].map((d) => path.join(WORKER_ROOT, d))
const SRC_EXT = /\.(?:mjs|cjs|js|mts|cts|ts)$/
const isTestFile = (name: string) => /\.test\.(?:mjs|cjs|js|mts|cts|ts)$/.test(name)

/** Recursively list source files (excluding tests, node_modules, dist) under a root. */
function scanSourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...scanSourceFiles(full))
    else if (SRC_EXT.test(entry.name) && !isTestFile(entry.name)) out.push(full)
  }
  return out
}

/** Strip block + line comments so a ccxt/order mention inside a COMMENT is not a false
 *  positive — e.g. validate-credential.mjs's own header lists the forbidden calls. The
 *  line-comment strip keeps `http://`-style `://` intact. Heuristic (not a full parser). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// Matches every ccxt import form (post comment-strip): `import … from 'ccxt'`,
// `import 'ccxt'`, `require('ccxt')`, `await import('ccxt')`, double quotes, subpaths.
// KNOWN immaterial evasions: template-literal `require(`ccxt`)` and string concatenation.
const CCXT_SPEC = /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]ccxt(?:\/[^'"]*)?['"]/

// Files permitted to import ccxt at all:
//  - BinanceAdapter.ts       : the sanctioned order-placing wrapper (all rails live inside it)
//  - spike-binance.ts        : DEV-ONLY manual spike, allowed only because prod never imports it
//  - validate-credential.mjs : READ-ONLY ops tool (asserted mutation-free below)
const CCXT_ALLOWED = new Set(['BinanceAdapter.ts', 'spike-binance.ts', 'validate-credential.mjs'])
// Every allowlisted ccxt user EXCEPT the order-placing wrapper and the dev-only spike must
// be provably read-only (no mutating exchange call).
const CCXT_READONLY_REQUIRED = new Set(
  Array.from(CCXT_ALLOWED).filter((f) => f !== 'BinanceAdapter.ts' && f !== 'spike-binance.ts'),
)
// A MUTATING exchange call — order place/cancel, withdrawal, transfer, or any raw
// private/sapi/fapi/dapi/papi POST/PUT/DELETE. Matched as a METHOD CALL (`.name(`) so
// read-only restriction FIELDS like `withdrawals_off`/`internal_transfer_off` never trip it.
const MUTATING_CALL =
  /\.\s*(?:create(?:Market|Limit)?Orders?|editOrders?|cancel(?:All)?Orders?|withdraw|transferOut|transfer|(?:sapi|fapi|dapi|papi|private)(?:Post|Put|Delete)\w*)\s*\(/

const SPIKE_FILE = 'spike-binance.ts'
const SPIKE_REF = /['"][^'"]*spike-binance(?:\.[jt]s)?['"]/

describe('no direct-exchange import (ccxt import-scope, static guard)', () => {
  const files = SCAN_ROOTS.flatMap(scanSourceFiles)
  const read = (f: string) => stripComments(fs.readFileSync(f, 'utf8'))

  test('ccxt is imported ONLY by the sanctioned allowlist (adapter, dev-spike, read-only validator)', () => {
    const offenders = files
      .map((f) => ({ file: path.basename(f), src: read(f) }))
      .filter((s) => CCXT_SPEC.test(s.src) && !CCXT_ALLOWED.has(s.file))
      .map((s) => s.file)
      .sort()
    // A new worker file importing ccxt directly would bypass BinanceAdapter's egress/kill/
    // risk rails — route exchange access through BinanceAdapter instead.
    expect(offenders).toEqual([])
  })

  test('read-only ccxt users make no mutating exchange call (order/cancel/withdraw/transfer)', () => {
    const offenders = files
      .filter((f) => CCXT_READONLY_REQUIRED.has(path.basename(f)))
      .map((f) => ({ file: path.basename(f), src: read(f) }))
      .filter((s) => MUTATING_CALL.test(s.src))
      .map((s) => s.file)
      .sort()
    // e.g. validate-credential.mjs holds mainnet keys; it must only read (fetchBalance,
    // sapiGet…). A mutating call here would move real funds outside every safety rail.
    expect(offenders).toEqual([])
  })

  test('dev-only spike-binance.ts is NOT reachable from any worker source', () => {
    // spike-binance.ts may use ccxt ONLY because no worker file imports it. If this fails,
    // the spike became reachable — its raw ccxt use is now a live hole.
    const importers = files
      .filter((f) => path.basename(f) !== SPIKE_FILE)
      .map((f) => ({ file: path.basename(f), src: read(f) }))
      .filter((s) => SPIKE_REF.test(s.src))
      .map((s) => s.file)
      .sort()
    expect(importers).toEqual([])
  })
})
