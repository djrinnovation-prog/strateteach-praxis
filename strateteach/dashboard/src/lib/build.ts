// The build stamp — shown in the ☰ menu footer and under the Home wordmark so the owner
// can tell at a glance whether the live app is the latest deploy or a stale service-worker
// cache. Vite `define` (see vite.config.ts) bakes the RAW build instant (full ISO) + the
// short git SHA at build time; here we format that instant to ISRAEL local time
// (Asia/Jerusalem) so the owner reads a familiar wall-clock — not UTC. A subtle "IL" hint
// marks the timezone. Falls back to "dev" outside a build (Docker build has no .git → no SHA).
declare const __BUILD_ISO__: string;
declare const __BUILD_SHA__: string;

const ISO: string = typeof __BUILD_ISO__ !== "undefined" ? __BUILD_ISO__ : "";
const SHA: string = typeof __BUILD_SHA__ !== "undefined" ? __BUILD_SHA__ : "";

// Format the baked ISO instant as "YYYY-MM-DD HH:MM" in Israel time.
function israelTime(iso: string): string {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "dev";
  try {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {} as Record<string, string>);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  } catch {
    // Environments without full ICU tz data — fall back to the UTC wall-clock.
    return iso.slice(0, 16).replace("T", " ");
  }
}

const when = israelTime(ISO);
export const BUILD_STAMP: string = when === "dev" ? "dev" : (SHA ? SHA + " · " : "") + when + " IL";
