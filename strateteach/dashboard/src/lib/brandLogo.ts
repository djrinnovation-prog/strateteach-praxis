import { loadThemePrefs } from "../theme";

// ── Shared StrateTeach PNG wordmark source ─────────────────────────────────────
// The approved hand-made per-skin wordmark art (public/logo-{skin}.png), keyed by the
// active PALETTES skin key — the SAME asset Home's headline uses. Centralised here so
// the entry/auth surfaces (Login, WelcomeOnboarding) render the identical branded logo
// and re-skin with the app. (Home keeps its own inline copy for its preload logic.)
const LOGO_BY_SKIN: Record<string, string> = {
  navy: "/logo-navy.png",
  peach: "/logo-peach.png",
  amber: "/logo-nude.png",   // the Nude skin's key is `amber`
  aurora: "/logo-sea.png",   // the Sea skin's key is `aurora`
};
// Keep in step with Home's LOGO_VERSION cache-buster (bump only when the artwork changes).
const LOGO_VERSION = "1";

export function brandLogoSrc(): string {
  return `${LOGO_BY_SKIN[loadThemePrefs().skin] || "/logo-navy.png"}?v=${LOGO_VERSION}`;
}
