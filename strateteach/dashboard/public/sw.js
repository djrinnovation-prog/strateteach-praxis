// Minimal service worker — ONLY for notifications. It caches NO app requests
// (app-shell freshness is guaranteed at the HTTP layer: nginx serves index.html +
// this file no-store, and content-hashed /assets/* immutable). Its job is (a) let
// the app show notifications on mobile browsers where `new Notification()` is
// blocked, (b) update EAGERLY so a deploy reaches open tabs promptly, and (c)
// explicitly BYPASS the standalone /structure/ mockup so it always loads from the
// network (never the SPA app-shell or any cache).
//
// BUILD_ID is stamped by the sw-build-stamp Vite plugin at build time (it is the
// literal string "__BUILD_ID__" in dev). It changes when app ASSET hashes change —
// but a deploy that only touches a static public/ file (e.g. /structure/) does NOT
// change any asset hash, so BUILD_ID would stay the same and browsers would keep
// running the OLD cached worker. SW_VERSION is a MANUAL bump: changing it alters
// this file's bytes on demand, forcing the browser to install+activate the new
// worker (skipWaiting + clients.claim + the activate-time cache purge) even when
// BUILD_ID is unchanged. Bump it whenever the worker's own logic changes.
const BUILD_ID = "__BUILD_ID__";
const SW_VERSION = "structure-bypass-6"; // ⇦ bump to force a worker update (clean reload after reference churn)

// ── /structure/ bypass ───────────────────────────────────────────────────────
// The /structure/ path is a STANDALONE static mockup (dashboard/public/structure/
// index.html), NOT part of the SPA. Fetch it fresh from the network with
// cache:"no-store" so it always returns the real, latest static file — never the
// SPA index shell, a Cache-Storage entry, OR a stale HTTP-cached copy (the mockup
// is a review artifact that changes often; a heuristically cached HTML would keep
// showing an old label/layout). For every OTHER request we do NOT call
// respondWith(), so the browser's default network fetch runs exactly as before.
self.addEventListener("fetch", (event) => {
  let url;
  try { url = new URL(event.request.url); } catch (_e) { return; }
  if (url.pathname === "/structure" || url.pathname.startsWith("/structure/")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => fetch(event.request))
    );
  }
  // else: fall through to default network handling (no interception, no cache).
});

self.addEventListener("install", () => self.skipWaiting());

// Belt-and-braces: also skip waiting if the page asks (swUpdate.ts posts this when a
// new worker reaches "installed"). Harmless alongside the install-time skipWaiting.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Cache used ONLY to persist the reload-guard timestamp across a forced reload.
const RELOAD_GUARD = "algo770-sw-reload-guard";

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Purge any caches left by a previous/legacy worker so nothing stale can be
    // served — but KEEP the reload-guard cache so the loop guard below survives the
    // forced reload. This SW creates no app caches itself; this is defensive cleanup.
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== RELOAD_GUARD).map((k) => caches.delete(k)));
    } catch (_e) { /* caches API unavailable — nothing to clean */ }
    await self.clients.claim();

    // ── WORKER-DRIVEN auto-apply of the new build ───────────────────────────────
    // When this freshly-deployed worker activates, force every already-open window
    // to reload onto the new build — WITHOUT relying on the page's own JS (the point:
    // it must work for tabs still running an OLD pre-auto-reload page bundle, whose
    // `controllerchange` handler only shows a banner). We drive the reload from HERE,
    // the worker, via WindowClient.navigate() (postMessage RELOAD is the fallback for
    // engines lacking navigate()).
    //
    // HARD loop guard: only reload if we have NOT already reloaded in the last ~15s.
    // The timestamp is persisted in a cache (SWs have no localStorage) so it survives
    // the reload — this guarantees exactly one reload per new build, never a loop.
    try {
      const cache = await caches.open(RELOAD_GUARD);
      const prev = await cache.match("ts");
      const last = prev ? Number(await prev.text()) : 0;
      const now = Date.now();
      if (now - last < 15000) return;              // reloaded just now → stop (no loop)
      await cache.put("ts", new Response(String(now)));

      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of wins) {
        try {
          if (typeof client.navigate === "function") { await client.navigate(client.url); }
          else { client.postMessage({ type: "RELOAD" }); }
        } catch (_e) {
          try { client.postMessage({ type: "RELOAD" }); } catch (_e2) { /* give up on this client */ }
        }
      }
    } catch (_e) { /* clients API / caches unavailable — the banner remains as fallback */ }
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/chat";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if ("focus" in c) {
        try { await c.focus(); } catch (_e) { /* */ }
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
