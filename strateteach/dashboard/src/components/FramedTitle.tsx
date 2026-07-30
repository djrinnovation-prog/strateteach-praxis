import React from "react";
import { C } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import CarvedTitle from "./CarvedTitle";

// ── FramedTitle — the carved screen-name inside Home's logo FRAME ─────────────
// Dan: each screen's carved title must sit in the SAME framed container Home's wordmark
// uses (the skin-adaptive glass/gold rounded frame with the bevel). This replicates Home's
// exact frame styling (screens/Home.tsx wordmark frame) around <CarvedTitle> + an optional
// subtitle, so every screen's title reads like Home's. Desktop HUGS the title (fit-content);
// mobile is full-width. Skin-aware via C.*.
export default function FramedTitle({ text, subtitle, size, variant = "emboss" }: {
  text: string;
  subtitle?: React.ReactNode;
  size?: number;                 // optional CarvedTitle size override (else responsive)
  // Headline style passthrough — "emboss" = the CLEAN warm skin-gradient embossed text that
  // echoes the Home PNG wordmark (the approved inner-screen treatment). DEFAULT for every inner
  // screen — Dan approved unifying ALL inner-screen headlines to this Home-matching emboss (the
  // Backtests sample de0935f), so defaulting it here rolls it out to EVERY FramedTitle at once
  // (Home itself uses its PNG wordmark, not FramedTitle, so it's untouched). "classic" = the older
  // heavy 45° carve (opt-in only now); "iso3d" = the rejected block extrusion (reference only).
  variant?: "classic" | "iso3d" | "emboss";
}) {
  const mobile = useIsMobile();
  return (
    // Fixed top offset so the title sits at the SAME vertical position on every screen.
    <div style={{ display: "flex", justifyContent: "center", width: "100%", marginTop: 2, marginBottom: 2 }}>
      <div style={{
        // CONSISTENT frame width across screens so navigating doesn't visually shift the
        // title: a fixed min width (short names still get the same frame), grows only for
        // very long names. Mobile is full-width (already consistent).
        width: mobile ? "100%" : "fit-content", minWidth: mobile ? undefined : 320, maxWidth: mobile ? "100%" : "92vw",
        boxSizing: "border-box",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
        // Home's wordmark-frame styling, verbatim (skin-adaptive gold-glass + bevel).
        background: `linear-gradient(145deg, ${C.gold}30, ${C.gold}0c 58%, ${C.gold}14)`,
        borderRadius: mobile ? 14 : 18, padding: mobile ? "6px 16px 4px" : "12px 32px 8px",
        borderTop: `2px solid ${C.gold}e0`, borderLeft: `2px solid ${C.gold}e0`,
        borderRight: `2px solid ${C.gold}55`, borderBottom: `2px solid ${C.gold}55`,
        boxShadow: `inset 2px 2px 4px ${C.accentHi}99, inset -3px -3px 7px ${C.gold}3a, 0 14px 34px -24px ${C.gold}55`,
      }}>
        <CarvedTitle text={text} size={size} variant={variant} />
        {subtitle != null && (
          // Subtitle enlarged (Dan: too small on mobile) — 12.5 mobile / 13.5 desktop.
          <span dir="auto" style={{ display: "block", textAlign: "center", fontSize: mobile ? 12.5 : 13.5,
            fontWeight: 600, color: C.gold, opacity: 0.92, letterSpacing: "0.02em", lineHeight: 1.35, maxWidth: 460, paddingInline: 4 }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
