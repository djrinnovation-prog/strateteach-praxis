// ── Chunk-load self-heal ─────────────────────────────────────────────────────
// The classic stale-cache-after-deploy failure: a tab that was OPEN across a deploy
// still holds the OLD bundle's module graph (old content-hashed chunk names). When it
// then lazy-imports a route/section, that old chunk no longer exists on the server
// (the deploy replaced /assets/*), so the dynamic import fails — a "ChunkLoadError" /
// "Loading chunk … failed" / "Failed to fetch dynamically imported module". Unhandled,
// this white-screens the app.
//
// index.html is served no-store (see nginx.conf), so a plain reload always fetches the
// FRESH index + the new chunk map — which fixes the tab. So the self-heal is simply:
// detect a chunk-load error and force ONE hard reload. Guarded so it can never loop:
//   • a module-level flag → at most one reload per page life, and
//   • a sessionStorage timestamp → the reloaded page won't immediately reload again for
//     the same class of error (e.g. mid-deploy where the new chunk is briefly 404).

const KEY = "algo770_chunk_reload_ts";
const COOLDOWN_MS = 20000;
let reloadedThisLoad = false;

/** True for the various "a dynamically-imported chunk failed to load" error shapes across
 *  browsers (Chrome/Firefox/Safari) — including a stale hashed-asset 404 served as HTML. */
export function isChunkLoadError(err: unknown): boolean {
  const e: any = err;
  const msg = String(e?.message ?? e?.reason?.message ?? e?.reason ?? e ?? "");
  const name = String(e?.name ?? e?.reason?.name ?? "");
  return (
    name === "ChunkLoadError" ||
    /Loading chunk\b[\s\S]*failed/i.test(msg) ||
    /Loading CSS chunk\b[\s\S]*failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||           // Safari
    /'?text\/html'?[\s\S]*(module|MIME)/i.test(msg)            // deleted chunk served as index.html
  );
}

/** Force at most ONE hard reload to recover to the fresh build. Returns true if it kicked
 *  a reload; false if it was suppressed by a guard (already reloaded / within cooldown). */
export function reloadOnceForChunkError(): boolean {
  if (reloadedThisLoad) return false;
  try {
    const now = Date.now();
    const last = Number(sessionStorage.getItem(KEY) || "0");
    if (now - last < COOLDOWN_MS) { reloadedThisLoad = true; return false; } // reloaded just now → stop (no loop)
    sessionStorage.setItem(KEY, String(now));
  } catch { /* storage blocked (private mode) — rely on reloadedThisLoad below */ }
  reloadedThisLoad = true;
  try { window.location.reload(); } catch { /* */ }
  return true;
}

/** Global belt-and-braces: catch chunk-load failures that surface OUTSIDE React render
 *  (e.g. a dynamic import() in an event handler → unhandled promise rejection, which an
 *  ErrorBoundary can't catch). Install once at startup. */
export function installChunkErrorHandlers(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e: ErrorEvent) => {
    if (isChunkLoadError((e as any)?.error ?? e?.message)) reloadOnceForChunkError();
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    if (isChunkLoadError((e as any)?.reason)) reloadOnceForChunkError();
  });
}
