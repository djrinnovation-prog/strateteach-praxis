import React from "react";
import { C } from "../theme";
import FitLabel from "./FitLabel";

// Shared SQUARE app-tile — the Home springboard / shortcut-tile visual language, in one
// reusable place so grids that offer a Cards (squares) view all match the Home tiles:
//   • 1:1 square aspect (aspectRatio: 1/1)
//   • app-icon CHIP on top, LABEL under (icon-over-label), like SectionHub/TileNav
//   • label via the shared FitLabel → wraps only at word boundaries + auto-shrinks (no
//     mid-word breaks that orphan a lone "ת"/"ם"/"s")
//   • skin-adaptive (C.gold accent · C.surface · C.text · C.line), re-skins with the app
//   • glossy top sheen + soft drop shadow + a subtle press feel
// Kept intentionally generic (uniform skin-gold accent) so any launcher/nav grid can use it;
// the per-brand multi-colour springboard tiles stay in SectionHub for the 4 Home sections.
export default function AppTile({ label, Icon, onClick, tour, ariaLabel }: {
  label: string; Icon: React.FC<any>; onClick: () => void; tour?: string; ariaLabel?: string;
}) {
  return (
    <button onClick={onClick} data-tour={tour} className="tap44" aria-label={ariaLabel || label}
      style={{ position: "relative", overflow: "hidden", aspectRatio: "1 / 1", width: "100%", minWidth: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9,
        background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "10px 8px",
        cursor: "pointer", fontFamily: "inherit", color: C.text, WebkitTapHighlightColor: "transparent",
        boxShadow: `0 10px 24px -16px rgba(0,0,0,0.45), ${C.glassHi}`,
        transition: "transform .14s ease, box-shadow .18s ease" }}
      onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.96)"; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}>
      {/* glossy top sheen — the Apple-style light catch */}
      <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: "50%", borderRadius: "18px 18px 0 0",
        background: `linear-gradient(180deg, ${C.gold}14 0%, rgba(255,255,255,0) 100%)`, pointerEvents: "none", zIndex: 1 }} />
      {/* app-icon chip */}
      <span style={{ position: "relative", zIndex: 2, width: 46, height: 46, flexShrink: 0, borderRadius: 13,
        display: "grid", placeItems: "center", background: `${C.gold}18`, border: `1px solid ${C.gold}44`,
        boxShadow: `inset 0 1px 0 ${C.gold}22, 0 6px 14px -8px ${C.gold}55` }}>
        <Icon size={23} color={C.gold} strokeWidth={2.1} />
      </span>
      {/* label — FitLabel keeps whole words atomic + auto-shrinks to fit the square. */}
      <span style={{ position: "relative", zIndex: 2, display: "block", maxWidth: "100%", paddingInline: 4 }}>
        <FitLabel text={label} size={12.5} maxLines={2} lineHeight={1.12}
          style={{ fontWeight: 800, color: C.text, textAlign: "center", letterSpacing: "0.01em" }} />
      </span>
    </button>
  );
}
