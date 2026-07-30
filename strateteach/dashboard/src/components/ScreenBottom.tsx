import React, { useState } from "react";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, UI } from "../theme";
import { loadExchangeCreds } from "../app/api";
import { HelpLayer, PnlStrip } from "../screens/Home";

// ── ScreenBottom — the persistent, COMPACT bottom cluster shared by every structured
// screen (above the 5-tab bar). Reuses Home's ACTUAL components (not mocks):
//   • PnlStrip  — Home's one-LINE live/demo P&L card (dense; a tiny live/demo pill drives it).
//   • HelpLayer — the "New here? · Learn · Reels · Help Portal" pill.
// Kept deliberately dense so screens stay one-viewport / non-scroll (Dan). (The taller
// HomeUnifiedFrame is Home's centrepiece — too big for a footer.)
export default function ScreenBottom() {
  const { lang } = useI18n();
  const he = lang === "he";
  const mobile = useIsMobile();
  const creds = loadExchangeCreds() as any;
  const connected = !!(creds && creds.key && creds.secret);
  const [mode, setMode] = useState<"live" | "demo">(connected ? "live" : "demo");
  const [hide, setHide] = useState(false);
  const pill = (m: "live" | "demo"): React.CSSProperties => ({
    border: "none", cursor: "pointer", fontFamily: UI, fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "3px 10px",
    background: mode === m ? (m === "live" ? C.loss : C.blue) : "transparent", color: mode === m ? "#fff" : C.muted,
  });
  return (
    // On mobile the inner-screen content has a wide start/end gutter (for the edge drawer
    // tabs); the footer sits BELOW those mid-height tabs, so we reclaim that gutter with a
    // negative inline margin → the one-line P&L + Help fit the full width like Home (no
    // horizontal clip), while staying compact (no vertical scroll).
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4,
      marginInlineStart: mobile ? -22 : 0, marginInlineEnd: mobile ? -38 : 0 }}>
      {/* tiny live/demo toggle above the one-line P&L strip */}
      <div style={{ display: "flex", justifyContent: he ? "flex-start" : "flex-end" }}>
        <div style={{ display: "inline-flex", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: 2, gap: 2 }}>
          <button onClick={() => setMode("live")} style={pill("live")}>{he ? "לייב" : "Live"}</button>
          <button onClick={() => setMode("demo")} style={pill("demo")}>{he ? "דמו" : "Demo"}</button>
        </div>
      </div>
      <PnlStrip hide={hide} onToggle={() => setHide((h) => !h)} mode={mode} />
      <HelpLayer />
    </div>
  );
}
