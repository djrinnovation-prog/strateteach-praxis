// Service-worker registration + eager update UX.
//
// The SW (public/sw.js) is notification-only and updates itself eagerly
// (skipWaiting on install, clients.claim on activate). This module registers it
// and, when a NEW worker takes control of an already-loaded tab, shows a small
// non-blocking "new version available" banner instead of silently reloading.
//
// Why a banner, not an auto-reload: this is a live trading app. Yanking the page
// out from under someone who is mid-action (reviewing positions, confirming a
// trade) is jarring and could look like a glitch. The banner lets the user
// refresh at a safe moment; a plain refresh or next app-open already gets the
// latest build because index.html is served no-store.
//
// First-open guard: on a first-ever visit the very first worker claiming the
// page also fires `controllerchange`, but there is no "previous version" — we
// suppress the banner in that case by only showing it once a controller already
// existed when we started listening.

let bannerShown = false;
let reloading = false;

function showUpdateBanner(): void {
  if (bannerShown || document.getElementById("sw-update-banner")) return;
  bannerShown = true;

  const bar = document.createElement("div");
  bar.id = "sw-update-banner";
  bar.setAttribute("role", "status");
  bar.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:16px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:12px",
    "max-width:calc(100vw - 24px)",
    "padding:10px 14px",
    "border-radius:12px",
    "background:#0B2733",
    "color:#EAF3F8",
    "font:500 14px/1.2 Rubik,system-ui,sans-serif",
    "box-shadow:0 8px 28px rgba(0,0,0,.28)",
    "direction:rtl",
  ].join(";");

  const label = document.createElement("span");
  label.textContent = "גרסה חדשה זמינה";

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "רענון";
  refresh.style.cssText = [
    "cursor:pointer",
    "border:0",
    "border-radius:8px",
    "padding:6px 14px",
    "background:#22C7E6",
    "color:#0B2733",
    "font:600 14px/1 Rubik,system-ui,sans-serif",
  ].join(";");
  refresh.onclick = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "סגור");
  dismiss.textContent = "✕";
  dismiss.style.cssText = [
    "cursor:pointer",
    "border:0",
    "background:transparent",
    "color:#9DAEBA",
    "font:600 15px/1 system-ui,sans-serif",
    "padding:4px",
  ].join(";");
  dismiss.onclick = () => bar.remove();

  bar.append(label, refresh, dismiss);
  document.body.appendChild(bar);
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // A tab that already had a controller and then sees a new one means a fresh
      // build's worker just took over (sw.js skipWaiting + clients.claim). Instead of
      // asking the user to tap "רענון" (they kept seeing stale builds), AUTO-APPLY the
      // new build with a one-time reload. (No controller yet = the first-ever install
      // on this origin; nothing to update to, so stay quiet.)
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || reloading) return;
        // Loop guard: only auto-reload if we haven't just done so. A tight repeat
        // (< 10s) means something is off (e.g. the new build also updates) — fall
        // back to the manual banner rather than reload-looping the page.
        try {
          const now = Date.now();
          const last = Number(sessionStorage.getItem("algo770_sw_reload_ts") || "0");
          if (now - last < 10000) { showUpdateBanner(); return; }
          sessionStorage.setItem("algo770_sw_reload_ts", String(now));
        } catch { showUpdateBanner(); return; }
        reloading = true;
        window.location.reload();
      });

      // Fallback path for the WORKER-DRIVEN reload: on engines where the SW can't call
      // WindowClient.navigate(), sw.js posts a RELOAD message instead — reload here.
      // Same loop guard (≤12s) as the controllerchange path so the two never double up.
      navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
        if (!e.data || (e.data as any).type !== "RELOAD" || reloading) return;
        try {
          const now = Date.now();
          const last = Number(sessionStorage.getItem("algo770_sw_reload_ts") || "0");
          if (now - last < 12000) return;
          sessionStorage.setItem("algo770_sw_reload_ts", String(now));
        } catch { /* */ }
        reloading = true;
        window.location.reload();
      });

      // Proactively activate a freshly-installed worker so open tabs pick up the new
      // build without waiting: as soon as an update is found and reaches "installed"
      // while a controller exists, ask it to take over (sw.js already skipWaiting()s
      // on install; this is a belt-and-braces nudge). It then claims → controllerchange
      // → the one-time auto-reload above.
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            try { nw.postMessage({ type: "SKIP_WAITING" }); } catch { /* no-op */ }
          }
        });
      });

      // Nudge the browser to re-check /sw.js when the user returns to the tab, so
      // a version that shipped while the tab was idle is noticed promptly rather
      // than only on the browser's ~24h background check.
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => { /* offline — retry next time */ });
      });
    }).catch(() => { /* notifications just won't fire; app is unaffected */ });
  });
}
