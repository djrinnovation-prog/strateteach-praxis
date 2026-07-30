import React from "react";
import { C } from "../theme";

// A colourful, slowly-turning Earth — blue oceans, drifting continents (green/
// gold/accent land), meridians and a glowing atmosphere edge. Every colour comes
// from the active skin, so it adapts to Mint / Purple / Wild. Fills its parent.
// Built from stacked <svg> layers so each can rotate independently (reliable
// cross-browser, unlike rotating inner <g> elements).
export default function EarthGlobe({ spin = 70 }: { spin?: number }) {
  const uid = React.useId().replace(/:/g, "");
  const ocean = `ego${uid}`, clipC = `egc${uid}`, glow = `egg${uid}`;
  const abs: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", overflow: "visible" };
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }} aria-hidden>
      <style>{"@keyframes egSpin{to{transform:rotate(360deg)}}"}</style>
      {/* ocean body + shared defs */}
      <svg viewBox="0 0 100 100" style={abs}>
        <defs>
          <radialGradient id={ocean} cx="38%" cy="33%" r="82%">
            <stop offset="0%" stopColor={C.blue} stopOpacity="0.55" />
            <stop offset="68%" stopColor={C.blue} stopOpacity="0.30" />
            <stop offset="100%" stopColor={C.blue} stopOpacity="0.50" />
          </radialGradient>
          <clipPath id={clipC}><circle cx="50" cy="50" r="46" /></clipPath>
          <filter id={glow} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.05" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <circle cx="50" cy="50" r="46" fill={`url(#${ocean})`} />
      </svg>
      {/* drifting continents (clipped to the globe) */}
      <svg viewBox="0 0 100 100" style={{ ...abs, transformOrigin: "center", animation: `egSpin ${spin}s linear infinite` }}>
        <g clipPath={`url(#${clipC})`}>
          <path d="M26 30 q11 -7 19 1 q7 7 -2 13 q-13 6 -19 -3 q-4 -7 2 -11Z" fill={C.gain} opacity="0.5" />
          <path d="M60 42 q13 -4 17 7 q1 11 -11 13 q-13 -1 -12 -11 q1 -6 6 -9Z" fill={C.gold} opacity="0.46" />
          <path d="M30 62 q11 -3 13 8 q0 9 -11 8 q-10 -2 -8 -11 q1 -3 6 -5Z" fill={C.accent} opacity="0.42" />
          <ellipse cx="72" cy="30" rx="8" ry="5" fill={C.gain} opacity="0.4" />
          <ellipse cx="44" cy="78" rx="10" ry="5" fill={C.gold} opacity="0.36" />
        </g>
      </svg>
      {/* meridians / latitudes (counter-rotating) */}
      <svg viewBox="0 0 100 100" style={{ ...abs, transformOrigin: "center", animation: `egSpin ${Math.round(spin * 0.8)}s linear infinite reverse` }}>
        <g clipPath={`url(#${clipC})`} fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="0.5">
          <ellipse cx="50" cy="50" rx="16" ry="46" /><ellipse cx="50" cy="50" rx="32" ry="46" />
          <line x1="4" y1="50" x2="96" y2="50" /><ellipse cx="50" cy="50" rx="46" ry="20" />
        </g>
      </svg>
      {/* glowing atmosphere edge (on top) */}
      <svg viewBox="0 0 100 100" style={abs}>
        <circle cx="50" cy="50" r="46" fill="none" stroke={C.gold} strokeWidth="1.3" style={{ opacity: 0.82, filter: `url(#${glow})` }} />
        <circle cx="50" cy="50" r="49" fill="none" stroke={C.blue} strokeWidth="0.6" style={{ opacity: 0.45 }} />
      </svg>
    </div>
  );
}

// ── Premium machined-silver orbit ring — an iPhone-grade polished metal rim that
// frames the Earth globe and carries the orbiting currency symbols ("money creation").
// Built entirely from layered SVG gradients + filters so it reads as a real bevelled
// rim, NOT a flat stroke:
//   • a circumferential brushed-metal sweep (bright→mid→dark, racing round the band)
//     gives the polished-titanium look that catches light as the eye travels the rim;
//   • a top-left specular glint gradient lays a believable shine over that sweep;
//   • the band is rounded on BOTH edges by paired bevel strokes — a bright catch-light
//     lip + a dark roll-off shadow on the outer edge, and the same paired lip+shadow on
//     the inner edge — so each edge reads as a soft convex roundover (iPhone-style);
//   • a soft outer drop-shadow halo lets the whole rim FLOAT above the background, and a
//     soft inner shadow opens a faint gap between the globe and the band so the ring is
//     clearly its own separated, cohesive frame around the globe.
// Skin-independent on purpose (fixed metallic). Shared by the Home springboard
// (SectionHub) and every in-screen hub (TileNav) so both rings are pixel-identical.
// Geometry is fixed (band centre r≈49) so the tile-inscribe + orbit maths in those
// callers still holds. Fills its square parent (inset:0); overflow visible for the halo.
export function MetalRing() {
  const uid = React.useId().replace(/:/g, "");
  const band = `mrb${uid}`, spec = `mrs${uid}`, halo = `mrh${uid}`, inSh = `mri${uid}`;
  return (
    <svg viewBox="0 0 100 100" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
      <defs>
        {/* circumferential brushed-metal sweep — light races round the rim like a real
            machined edge, now in DARK NAVY METAL: bright cool-blue catch-light → mid
            steel-blue body → deep navy in the bottom-right shadow */}
        <linearGradient id={band} x1="6" y1="4" x2="94" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d6e6ff" />
          <stop offset="10%" stopColor="#3A63B0" />
          <stop offset="22%" stopColor="#9FC2FF" />
          <stop offset="36%" stopColor="#16315f" />
          <stop offset="50%" stopColor="#6f9ef0" />
          <stop offset="63%" stopColor="#0E2A5E" />
          <stop offset="76%" stopColor="#2B4E8C" />
          <stop offset="88%" stopColor="#0c1f47" />
          <stop offset="100%" stopColor="#0A1733" />
        </linearGradient>
        {/* specular glint — a bright top-left shine fading to nothing over the band */}
        <linearGradient id={spec} x1="20" y1="6" x2="74" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        {/* soft outer halo → the polished rim floats above the background */}
        <filter id={halo} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0.6" stdDeviation="1.5" floodColor="#040a1a" floodOpacity="0.5" />
        </filter>
        {/* soft inner shadow → a faint separated gap between globe and band */}
        <filter id={inSh} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>
      {/* (1) outer roll-off shadow lip — the dark outer roundover, wrapped in the soft
             halo so the whole rim casts a gentle drop-shadow and floats */}
      <g style={{ filter: `url(#${halo})` }}>
        <circle cx="50" cy="50" r="50.45" fill="none" stroke="#060c1c" strokeWidth="1.0" opacity="0.85" />
      </g>
      {/* (2) main brushed-metal band — the polished dark-navy rim */}
      <circle cx="50" cy="50" r="49" fill="none" stroke={`url(#${band})`} strokeWidth="3.0" />
      {/* (3) outer bevel: bright cool-blue catch-light lip just inside the outer edge → roundover */}
      <circle cx="50" cy="50" r="50.0" fill="none" stroke="rgba(207,228,255,0.55)" strokeWidth="0.55" />
      {/* (4) specular glint laid over the band's top-left — the high-end metal shine */}
      <circle cx="50" cy="50" r="49" fill="none" stroke={`url(#${spec})`} strokeWidth="2.7" />
      {/* (5) inner bevel: bright cool-blue lip on the inner edge → the second rounded edge */}
      <circle cx="50" cy="50" r="47.75" fill="none" stroke="rgba(207,228,255,0.62)" strokeWidth="0.6" />
      {/* (6) inner roll-off shadow → soft dark navy gap separating the globe from the band */}
      <circle cx="50" cy="50" r="47.1" fill="none" stroke="rgba(5,10,26,0.5)" strokeWidth="0.9" style={{ filter: `url(#${inSh})` }} />
    </svg>
  );
}

// ── Orbiting market symbols — small asset/currency glyphs (₿ $ € Ξ £ ¥ AAPL TSLA
// Au Ag …) drifting slowly around the orbit ring in a rich dark money/dollar-green
// gradient (bright green core → deep money-green) with a luminous green glow halo +
// a thin dark outline so they stay legible riding on the dark-navy metal band.
// The whole ring of glyphs rotates while each glyph counter-rotates about its own
// centre so it stays upright (SMIL rotate — reliable cross-browser, no CSS transform-
// origin quirks on SVG). A FIXED vibrant gradient (like the metallic ring + the tile
// identity colours) so the symbols stay striking on every skin. Lightweight & inert. ──
export const ORBIT_ASSETS = ["₿", "$", "Ξ", "€", "AAPL", "£", "Au", "¥", "TSLA", "◎", "Ag", "◆"];
// The clean single-glyph currency/crypto SYMBOLS from the orbit set (drops the
// multi-char text tickers like AAPL/TSLA/Au/Ag) — reused on the Home hero's tight
// ticker frame so the frame reads as a run of pure symbols, matching "what was in
// the circle" (the orbiting glyphs), NOT text/price tickers.
export const MONEY_GLYPHS = ORBIT_ASSETS.filter((g) => g.length === 1);
export function OrbitSymbols({ dur = 90 }: { dur?: number }) {
  const uid = React.useId().replace(/:/g, "");
  const grad = `obg${uid}`;
  // Orbit radius tuned so the glyphs ride centred ON the metallic ring band (the owner
  // wanted them "more in the silver area"): the main band spans r≈47.5–50.5; a single
  // glyph is ~5.4 tall (half ≈2.7), so a centre at R=47.5 lands the glyph centred in the
  // band metal with its outer edge ~50.2 (just inside the outer rim) — riding within the
  // navy ring on both mobile & desktop, never drifting outside it or overlapping the
  // inscribed tiles (which reach r≈39).
  const R = 47.5, N = ORBIT_ASSETS.length;
  return (
    <svg viewBox="0 0 100 100" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6FE39A" />
          <stop offset="50%" stopColor="#1F9A50" />
          <stop offset="100%" stopColor="#15703B" />
        </linearGradient>
      </defs>
      {/* the whole ring of glyphs turns slowly; a luminous green glow halo lifts the
          dark-green glyphs off the navy band so they read with strong contrast */}
      <g style={{ filter: "drop-shadow(0 0 1.7px rgba(70,225,130,0.9))" }}>
        <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur={`${dur}s`} repeatCount="indefinite" />
        {ORBIT_ASSETS.map((t, i) => {
          const ang = (i / N) * 2 * Math.PI - Math.PI / 2;
          const cx = +(50 + R * Math.cos(ang)).toFixed(2);
          const cy = +(50 + R * Math.sin(ang)).toFixed(2);
          const fs = t.length > 2 ? 3.0 : 5.4; // multi-char tickers ride smaller
          return (
            <text key={i} x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
              fontFamily="'JetBrains Mono', ui-monospace, Menlo, monospace" fontWeight={800} fontSize={fs}
              fill={`url(#${grad})`} stroke="#05311a" strokeWidth={0.35} paintOrder="stroke" opacity={0.98}>
              {t}
              {/* counter-rotate about own centre so the glyph stays upright while orbiting */}
              <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`-360 ${cx} ${cy}`} dur={`${dur}s`} repeatCount="indefinite" />
            </text>
          );
        })}
      </g>
    </svg>
  );
}
