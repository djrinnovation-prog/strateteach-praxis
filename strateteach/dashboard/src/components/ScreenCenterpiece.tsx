import React from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import EarthGlobe from "./EarthGlobe";

// ── Shared hub-screen CENTERPIECE / watermark ────────────────────────────────
// Every hub screen (Exchange, Explanations, My profile, Scanner, Profit, Backtests,
// Dashboard, …) has an empty dark middle between the top cards and the floating
// action-button row (the TileNav tile row). To make none of them look empty we
// render ONE consistent branded centerpiece there: the SAME boot-splash earth-globe
// (EarthGlobe) CENTERED, with the screen's OWN title under it styled like the
// STRATETEACH wordmark (UI font · wide letter-spacing · the dedicated C.titleInk
// brand colour — the exact wordmark treatment used in the sidebar header).
//
// It's a pure decoration: `position:absolute; inset:0; pointer-events:none; zIndex:0`
// inside the TileNav fill wrapper, so it sits BEHIND the tile row and NEVER blocks or
// overlaps the floating action buttons or the top content — it only fills the empty
// gap. Skin-aware (live C.* + the per-skin EarthGlobe), RTL-safe (centred + logical
// padding to offset the trailing letter-spacing) and responsive (globe sized in vw).

// Route → the screen's i18n title key (its own name, same one the nav uses).
const ROUTE_KEY: Record<string, string> = {
  "/exchange": "exchange", "/scanner": "scanner", "/profit": "profit",
  "/strategy": "strategy", "/backtests": "backtests", "/overview": "dashboard",
  "/analytics": "analytics", "/university": "university", "/telegram": "telegram",
  "/chat": "chat", "/settings": "settings", "/privacy": "privacy",
  "/admin": "admin", "/screens": "screens", "/reels": "reels", "/activity": "activity",
};
// Routes without an i18n nav key — their own bilingual title.
const ROUTE_EXTRA: Record<string, { he: string; en: string }> = {
  "/me": { he: "החשבון שלי", en: "My profile" },
  "/requests": { he: "פורטל פניות", en: "Requests" },
  "/bots": { he: "בוטים", en: "Signal bots" },
  "/plans": { he: "מסלולים", en: "Plans" },
};

export default function ScreenCenterpiece({ title: titleProp, showTitle = true }: { title?: string; showTitle?: boolean }) {
  const { t, lang } = useI18n();
  const loc = useLocation();
  let title = titleProp;
  if (!title) {
    const key = ROUTE_KEY[loc.pathname];
    if (key) title = (t as any)[key];
    else if (ROUTE_EXTRA[loc.pathname]) title = ROUTE_EXTRA[loc.pathname][lang];
  }
  // In "section-hub" mode the screen's big spaced title now leads at the TOP (in the
  // ScreenHeader), so we render the orb (globe) ALONE here and drop the title to
  // avoid duplicating it at the bottom. Otherwise (Profit and any legacy caller) the
  // globe + title watermark are kept exactly as before.
  const withTitle = showTitle && !!title;

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, opacity: 0.55, maxWidth: "100%" }}>
        {/* the SAME boot-splash globe, with a soft skin-tinted halo for depth */}
        <div style={{ position: "relative", width: "min(40vw, 230px)", height: "min(40vw, 230px)", maxHeight: "44vh", aspectRatio: "1 / 1" }}>
          <div style={{ position: "absolute", inset: "-14%", borderRadius: "50%",
            background: `radial-gradient(circle at 50% 46%, ${C.gold}22, transparent 70%)` }} />
          <EarthGlobe spin={90} />
        </div>
        {/* the screen's own title, in the STRATETEACH wordmark treatment (hub mode
            moves this to the top instead, so it's omitted here) */}
        {withTitle && (
          <div style={{ fontFamily: UI, fontWeight: 800, fontSize: "clamp(15px, 4.2vw, 23px)", lineHeight: 1.1,
            letterSpacing: "0.26em", textTransform: "uppercase", color: C.titleInk, textAlign: "center",
            paddingInlineStart: "0.26em", whiteSpace: "nowrap", maxWidth: "92vw", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </div>
        )}
      </div>
    </div>
  );
}
