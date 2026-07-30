// buildinfo.ts — Ops Harness Slice A2. READ-ONLY deploy/build evidence for the operator preflight.
// No mutation, no server RPC. Self-reads the served index.html for the deployed bundle hash and reads
// build-time flags from import.meta.env. All functions are resilient: a missing value / fetch error
// returns 'unknown'/false, never throws (this is evidence, not a gate).

/** Deploy/build evidence surfaced in the preflight. Trust levels: deployedBundle = self-verified (browser);
 *  buildCommit = 'unknown' unless injected at build; flags = self-known from the bundle. */
export interface BuildInfo {
  killEnabled: boolean      // VITE_OPERATOR_KILL_ENABLED === 'true'
  harnessEnabled: boolean   // VITE_OPERATOR_HARNESS_ENABLED === 'true'
  buildCommit: string       // VITE_BUILD_COMMIT, or 'unknown' if not injected
  deployedBundle: string    // e.g. 'index-D-3QjUQg.js', or 'unknown' if not resolvable
}

/** A flag is ON only when the env var is exactly the string 'true' (default OFF). */
export function readKillEnabled(): boolean {
  return import.meta.env.VITE_OPERATOR_KILL_ENABLED === 'true'
}
export function readHarnessEnabled(): boolean {
  return import.meta.env.VITE_OPERATOR_HARNESS_ENABLED === 'true'
}

/** Built commit if injected (Railway RAILWAY_GIT_COMMIT_SHA -> VITE_BUILD_COMMIT); else 'unknown'. */
export function readBuildCommit(): string {
  const c = import.meta.env.VITE_BUILD_COMMIT
  return typeof c === 'string' && c.trim().length > 0 ? c.trim() : 'unknown'
}

const BUNDLE_RE = /\/assets\/(index-[A-Za-z0-9._-]+\.js)/

/**
 * Self-read the served index.html and extract the built bundle filename (e.g. 'index-<hash>.js').
 * Never throws — returns 'unknown' on any error, non-2xx, or no match. Injectable fetch for tests.
 */
export async function fetchDeployedBundleHash(
  fetchImpl: typeof fetch = globalThis.fetch,
  url = '/',
): Promise<string> {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' })
    if (!res.ok) return 'unknown'
    const html = await res.text()
    const m = html.match(BUNDLE_RE)
    return m ? m[1] : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Assemble the full BuildInfo (flags + commit + self-read bundle). Read-only. */
export async function getBuildInfo(fetchImpl: typeof fetch = globalThis.fetch): Promise<BuildInfo> {
  return {
    killEnabled: readKillEnabled(),
    harnessEnabled: readHarnessEnabled(),
    buildCommit: readBuildCommit(),
    deployedBundle: await fetchDeployedBundleHash(fetchImpl),
  }
}
