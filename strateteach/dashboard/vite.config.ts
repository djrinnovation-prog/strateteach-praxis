import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// Build stamp shown in the UI (☰ menu footer + under the Home wordmark) so the owner
// can tell at a glance which deploy is live vs a stale service-worker cache. Computed
// at config-load (i.e. build time): a UTC build timestamp, plus the short git SHA when
// available. In the Docker build the repo's .git isn't copied, so git is skipped and
// the timestamp alone marks WHEN the live bundle was built — which is exactly the "did
// my deploy land?" signal.
let __gitSha = "";
try { __gitSha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* .git absent (Docker build) — timestamp only */ }
// Bake the RAW build instant (full ISO) + the short SHA, and format to Israel local
// time (Asia/Jerusalem) at DISPLAY time in the client (see src/lib/build.ts). The UTC
// wall-clock text is no longer baked — the owner reads it in Israel time.
const __buildIso = new Date().toISOString();   // e.g. "2026-07-03T14:30:00.000Z"

// After the build, stamp dist/sw.js's "__BUILD_ID__" placeholder with a hash of
// the emitted content-hashed asset filenames. Any deploy that changes app code
// changes an asset hash → changes this BUILD_ID → the service-worker bytes change
// → the browser installs the new worker and fires `controllerchange` in open
// tabs. That's what lets long-lived sessions learn a new version shipped (the app
// turns it into a refresh banner). Runs only at build time; a no-op in dev.
function swBuildStamp() {
  let outDir = "dist";
  return {
    name: "sw-build-stamp",
    apply: "build" as const,
    configResolved(cfg: { build: { outDir: string } }) {
      outDir = cfg.build.outDir;
    },
    closeBundle() {
      const swPath = resolve(outDir, "sw.js");
      let buildId = "dev";
      try {
        const names = readdirSync(resolve(outDir, "assets")).sort().join("|");
        buildId = createHash("sha1").update(names).digest("hex").slice(0, 12);
      } catch { /* no assets dir — leave a harmless constant */ }
      try {
        const src = readFileSync(swPath, "utf8").replace(/__BUILD_ID__/g, buildId);
        writeFileSync(swPath, src);
      } catch { /* sw.js absent — nothing to stamp */ }
    },
  };
}

// Served single-origin behind Caddy (API paths proxied to the backend), so the
// API client uses relative URLs. `npm run build` is `vite build` only — esbuild
// transpiles TS without a blocking type-check, keeping deploys green.
export default defineConfig({
  plugins: [react(), swBuildStamp()],
  // Expose the raw build instant + SHA to the app (replaced inline at build time); the
  // client formats them to Israel time in src/lib/build.ts.
  define: { __BUILD_ISO__: JSON.stringify(__buildIso), __BUILD_SHA__: JSON.stringify(__gitSha) },
  server: {
    proxy: {
      "/auth": "http://localhost:5000",
      "/signals": "http://localhost:5000",
      "/runs": "http://localhost:5000",
      "/strategy": "http://localhost:5000",
      "/exchange": "http://localhost:5000",
      "/telegram": "http://localhost:5000",
      "/portfolio": "http://localhost:5000",
      "/dashboard": "http://localhost:5000",
      "/symbols": "http://localhost:5000",
      "/config": "http://localhost:5000",
      "/healthz": "http://localhost:5000",
      "/system": "http://localhost:5000",
    },
  },
});
