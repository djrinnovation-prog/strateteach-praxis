import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Home as HomeIcon, TrendingUp, GraduationCap, MessageCircle, UserRound } from "lucide-react";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, UI } from "../theme";

// Persistent bottom tab bar — an ALWAYS-PRESENT navigation layer that sits in
// ADDITION to the existing circle hub / SectionHub springboard / TileNav (none of
// which are touched). It gives one-tap access to the app's five top-level areas.
//
// Height of the bar itself (excluding the iOS safe-area inset). Each scrolling
// screen reserves this much (+ safe-area) as bottom padding so the bar never
// covers content (e.g. Home's "Quick helper" / "מדריך מהיר").
export const TABBAR_H = 58;

// The 5 destinations (per Dan's mapping). Each `to` is the section's PRIMARY screen —
// all are existing routes (see Shell.tsx / Exchange.tsx), so nothing can break:
//   trade   → /profit              (Trading engine)
//   learn   → /university          (Explanations / מושגי המערכת — the educational concepts)
//   chat    → /chat                (the Telegram-style chat — Exchange stays reachable via
//                                   the Home TOOLS tile + the ☰ side menu)
//   account → /me                  (My profile)
// `match` lists every route that belongs to the section (the pathname only — query
// strings are ignored) so the correct tab highlights wherever the user lands.
type Tab = { key: string; to: string; he: string; en: string; Icon: React.FC<any>; match: string[] };
const TABS: Tab[] = [
  { key: "home", to: "/", he: "בית", en: "Home", Icon: HomeIcon, match: [] },
  { key: "trade", to: "/trading", he: "מסחר", en: "Trading", Icon: TrendingUp,
    match: ["/trading", "/profit", "/overview", "/scanner", "/backtests", "/analytics", "/strategy"] },
  { key: "learn", to: "/university", he: "למידה", en: "Learn", Icon: GraduationCap,
    match: ["/university", "/reels"] },
  { key: "chat", to: "/chat", he: "צ'אט", en: "Chat", Icon: MessageCircle,
    match: ["/chat"] },
  { key: "account", to: "/me", he: "חשבון", en: "Account", Icon: UserRound,
    match: ["/me", "/admin", "/privacy", "/settings", "/plans", "/screens", "/activity"] },
];

export default function TabBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const { lang, rtl } = useI18n();
  const mobile = useIsMobile();
  const path = loc.pathname;
  // Mobile-first: the bottom tab bar is the conventional MOBILE navigation layer.
  // On desktop the persistent left sidebar (NavPanel) already fills that role, so
  // the bar would only overlap it — hide it there.
  if (!mobile) return null;
  // Active tab = Home on "/" (and on the staff landing, where the "/" redirect lands
  // staff collaborators — so the Home tab still highlights as their home), else the
  // section whose routes contain the current path. Falls back to none on an unmapped route.
  const activeKey = path === "/" || path.startsWith("/staff-audit")
    ? "home"
    : (TABS.find((t) => t.key !== "home" && t.match.some((m) => path === m || path.startsWith(m + "/")))?.key ?? "");

  return (
    <nav aria-label={lang === "he" ? "ניווט ראשי" : "Main navigation"}
      style={{
        // BULLETPROOF: a REAL flex-shrink:0 child at the BOTTOM of the app's height:100%
        // flex COLUMN (both Home and Shell mount it as the last child under the scroll region)
        // — NOT position:fixed. A fixed bar anchors to the nearest transformed/filtered ancestor
        // (not always the viewport), so at narrow widths with tall content it could land in the
        // wrong containing block and become unreachable ("nav gone / can't navigate"). As a flow
        // child it is structurally ALWAYS visible and can never be covered or pushed off-screen.
        // relative + zIndex keeps it above the fixed ambient backdrop; the screen's own modals
        // (z >= 1000) and the side drawer still layer above it.
        flexShrink: 0, position: "relative", zIndex: 42,
        direction: rtl ? "rtl" : "ltr",
        display: "flex", alignItems: "stretch",
        background: C.surface, borderTop: `1px solid ${C.line}`,
        boxShadow: "0 -8px 24px -16px rgba(0,0,0,0.45)",
        // iOS safe-area: keep the labels clear of the home indicator / rounded corners.
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        fontFamily: UI,
      }}>
      {TABS.map((tb) => {
        const active = tb.key === activeKey;
        return (
          <button key={tb.key} onClick={() => nav(tb.to)} className="tap44"
            aria-current={active ? "page" : undefined}
            title={lang === "he" ? tb.he : tb.en}
            style={{
              flex: 1, minWidth: 0, minHeight: TABBAR_H,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              background: "none", border: "none", cursor: "pointer", fontFamily: UI,
              position: "relative", padding: "9px 4px 7px",
            }}>
            {/* active accent — a short skin-accent bar along the top edge of the tab */}
            <span aria-hidden style={{
              position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
              width: active ? 26 : 0, height: 3, borderRadius: 3,
              background: C.gold, transition: "width .2s ease",
            }} />
            <tb.Icon size={21} strokeWidth={active ? 2.6 : 2} color={active ? C.gold : C.muted} />
            <span style={{
              fontSize: 10.5, fontWeight: active ? 800 : 600, letterSpacing: "0.01em",
              color: active ? C.text : C.muted, whiteSpace: "nowrap", maxWidth: "100%",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {lang === "he" ? tb.he : tb.en}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
