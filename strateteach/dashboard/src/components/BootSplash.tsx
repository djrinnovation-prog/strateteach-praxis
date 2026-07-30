import React from "react";
import { C, UI } from "../theme";
import EarthGlobe from "./EarthGlobe";

/** Minimal boot screen: just the app's slowly-turning globe — clean and
 * centered, with none of the surrounding chrome (no rings / orbs / floating
 * tickers / dashed orbit, no logo square or progress bar). EarthGlobe is pure
 * SVG/CSS, so it paints instantly and never blocks first paint — the parallel
 * warmBootQueries prefetch stays the thing that shortens the load.
 *
 * Fades in on mount, and (when the parent passes `fadingOut`) fades out to
 * reveal the app beneath — a smooth crossfade, no hard cut / empty flash.
 * Skin/theme-aware via live C colors, light & dark, and RTL-safe (centered). */
export default function BootSplash({ label, fadingOut = false }: { label?: string; fadingOut?: boolean }) {
  // Start transparent, then fade in on the next frame; `fadingOut` fades back
  // out. One opacity transition drives both directions (no keyframe clash).
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const visible = shown && !fadingOut;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 18, fontFamily: UI, background: C.bg,
        opacity: visible ? 1 : 0, transition: "opacity 0.5s ease",
        pointerEvents: fadingOut ? "none" : "auto",
      }}
    >
      {/* Just the globe — a soft skin-tinted halo behind it for depth, nothing
          orbiting it. Sized responsively so it stays centered on every screen. */}
      <div style={{ position: "relative", width: "min(64vw, 300px)", height: "min(64vw, 300px)" }}>
        <div style={{
          position: "absolute", inset: "-16%", borderRadius: "50%",
          background: `radial-gradient(circle at 50% 46%, ${C.gold}22, transparent 70%)`,
        }} />
        <EarthGlobe spin={64} />
      </div>
      {label && <div style={{ fontSize: 12, color: C.muted, letterSpacing: "0.04em" }}>{label}</div>}
    </div>
  );
}
