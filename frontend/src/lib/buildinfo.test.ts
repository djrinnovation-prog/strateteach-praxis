import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  readKillEnabled, readHarnessEnabled, readBuildCommit, fetchDeployedBundleHash, getBuildInfo,
} from './buildinfo'

afterEach(() => { vi.unstubAllEnvs() })

// Build a mock `fetch` that returns given { ok, body } (body is the served HTML).
function mockFetch(opts: { ok?: boolean; body?: string; throws?: boolean }): typeof fetch {
  return vi.fn(async () => {
    if (opts.throws) throw new Error('network')
    return { ok: opts.ok ?? true, text: async () => opts.body ?? '' } as Response
  }) as unknown as typeof fetch
}

const INDEX_HTML = `<!doctype html><html><head><title>Praxis — Operator Console</title></head>
<body><div id="root"></div><script type="module" src="/assets/index-D-3QjUQg.js"></script></body></html>`

describe('flag readers (default OFF; ON only for exactly "true")', () => {
  test('kill flag', () => {
    expect(readKillEnabled()).toBe(false)                       // unset → OFF
    vi.stubEnv('VITE_OPERATOR_KILL_ENABLED', 'true'); expect(readKillEnabled()).toBe(true)
    vi.stubEnv('VITE_OPERATOR_KILL_ENABLED', 'TRUE'); expect(readKillEnabled()).toBe(false)   // not exactly 'true'
  })
  test('harness flag', () => {
    expect(readHarnessEnabled()).toBe(false)
    vi.stubEnv('VITE_OPERATOR_HARNESS_ENABLED', 'true'); expect(readHarnessEnabled()).toBe(true)
    vi.stubEnv('VITE_OPERATOR_HARNESS_ENABLED', '1'); expect(readHarnessEnabled()).toBe(false)
  })
})

describe('readBuildCommit', () => {
  test('unset → "unknown" (not failure)', () => { expect(readBuildCommit()).toBe('unknown') })
  test('empty/whitespace → "unknown"', () => {
    vi.stubEnv('VITE_BUILD_COMMIT', '   '); expect(readBuildCommit()).toBe('unknown')
  })
  test('present → trimmed value', () => {
    vi.stubEnv('VITE_BUILD_COMMIT', ' abc1234 '); expect(readBuildCommit()).toBe('abc1234')
  })
})

describe('fetchDeployedBundleHash (self-read, never throws)', () => {
  test('parses /assets/index-<hash>.js from served html', async () => {
    expect(await fetchDeployedBundleHash(mockFetch({ body: INDEX_HTML }))).toBe('index-D-3QjUQg.js')
  })
  test('no bundle in html → "unknown"', async () => {
    expect(await fetchDeployedBundleHash(mockFetch({ body: '<html></html>' }))).toBe('unknown')
  })
  test('non-2xx → "unknown"', async () => {
    expect(await fetchDeployedBundleHash(mockFetch({ ok: false, body: INDEX_HTML }))).toBe('unknown')
  })
  test('fetch throws → "unknown" (resilient)', async () => {
    expect(await fetchDeployedBundleHash(mockFetch({ throws: true }))).toBe('unknown')
  })
})

describe('getBuildInfo', () => {
  test('assembles flags + commit + bundle', async () => {
    vi.stubEnv('VITE_OPERATOR_KILL_ENABLED', 'true')
    vi.stubEnv('VITE_OPERATOR_HARNESS_ENABLED', 'true')
    vi.stubEnv('VITE_BUILD_COMMIT', 'deadbeef')
    const info = await getBuildInfo(mockFetch({ body: INDEX_HTML }))
    expect(info).toEqual({
      killEnabled: true, harnessEnabled: true, buildCommit: 'deadbeef', deployedBundle: 'index-D-3QjUQg.js',
    })
  })
  test('defaults (all flags off / unknowns) when env unset + bundle unresolvable', async () => {
    const info = await getBuildInfo(mockFetch({ body: '' }))
    expect(info).toEqual({
      killEnabled: false, harnessEnabled: false, buildCommit: 'unknown', deployedBundle: 'unknown',
    })
  })
})
