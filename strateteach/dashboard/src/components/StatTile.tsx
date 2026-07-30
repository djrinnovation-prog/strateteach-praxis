import React from "react";
import { C, MONO, RADIUS, SHADOW } from "../theme";

// A big number-tile: the app's STANDARD dark/glassy card surface (C.surface + a
// C.line hairline + SHADOW), matching every other screen's card language — NOT a
// bright accent fill. Label is muted, the icon carries the skin accent (C.gold),
// the value stays high-contrast (C.text, or a semantic color override). The whole
// tile is a button to its screen. `grad` is accepted for call-site compatibility
// but intentionally unused so the tiles stay subtle across all skins/modes.
export default function StatTile({ label, value, sub, grad, Icon, onClick, color }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; grad?: string;
  Icon?: React.FC<any>; onClick?: () => void; color?: string;
}) {
  void grad;
  // Keep the figure on ONE line — never break inside digits, a "/", or a "(…%)".
  // When the value is a "number (percent)" string, split it so the number sits on
  // its own line and the percent drops just below (both nowrap), instead of wrapping
  // mid-number into a stray ")" or "DT". Each line then nowrap+ellipsis so a freak
  // long value clips cleanly rather than stretching/overflowing the tile.
  let main: React.ReactNode = value;
  let pct: React.ReactNode = null;
  if (typeof value === "string") {
    const m = value.match(/^(.*?)\s*(\([^()]*\))\s*$/);
    if (m) { main = m[1]; pct = m[2]; }
  }
  const oneLine: React.CSSProperties = { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
  // width:100% + minWidth:0 + box-sizing pin the tile to its grid cell so a long
  // value can never stretch it; the value font is clamped down for mobile.
  return (
    <button onClick={onClick} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.md, padding: "16px", cursor: onClick ? "pointer" : "default",
      fontFamily: "inherit", color: C.text, textAlign: "start", minHeight: 124, width: "100%", minWidth: 0, boxSizing: "border-box", overflow: "hidden",
      display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10, boxShadow: SHADOW }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.01em", minWidth: 0, overflowWrap: "break-word", color: C.muted }}>{label}</span>
        {Icon && <Icon size={18} color={C.gold} style={{ flexShrink: 0 }} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ ...oneLine, fontFamily: MONO, fontWeight: 900, fontSize: "clamp(15px, 4vw, 24px)", lineHeight: 1.1, color: color || C.text }}>{main}</span>
        {pct != null && <span style={{ ...oneLine, fontFamily: MONO, fontWeight: 800, fontSize: "clamp(11px, 3vw, 14px)", lineHeight: 1.2, marginTop: 1, color: color || C.text, opacity: 0.92 }}>{pct}</span>}
        {sub != null && <span style={{ ...oneLine, fontSize: 11, marginTop: 3, fontFamily: MONO, color: C.muted }}>{sub}</span>}
      </span>
    </button>
  );
}
