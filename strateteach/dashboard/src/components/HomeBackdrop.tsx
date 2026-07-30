import React from "react";
import { C, loadThemePrefs } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import BitcoinBackground from "./BitcoinBackground";

// ── Antique CRACKED texture (ALL skins) — a fine fracture/crackle web, crisp at any size ──
// Pure inline SVG: a loose irregular cell grid warped by an feDisplacementMap (fractal turbulence)
// into an organic network of wavy cracks — the crackle-glaze / cracked-leather look. Vector, so it
// stays razor-sharp in both zoom modes (no raster). Overlaid at low opacity on the app backdrop for
// EVERY skin in BOTH modes (Dan: "בכל הסקינים תעשה את השבירה היפה כמו בנייבי" — the same beautiful
// crackle Navy has, on every skin). Each skin gets a TONAL vein colour + opacity so the crackle
// reads as part of that skin (steel-navy on Navy, warm-rose on Peach, bronze on Nude/amber,
// muted-teal on Sea/aurora), never glaring. DARK stays deliberately SUBTLE (low opacity — Dan:
// "לא בוהק" / not shiny). It sits BEHIND all cards/text (zIndex 0), so readability is untouched —
// it just makes the surface read "aged / broken".
const crackSVG = (color: string) =>
  "<svg xmlns='http://www.w3.org/2000/svg' width='440' height='440'>" +
  "<filter id='w' x='-6%' y='-6%' width='112%' height='112%'>" +
  "<feTurbulence type='fractalNoise' baseFrequency='0.021' numOctaves='3' seed='6' result='t'/>" +
  "<feDisplacementMap in='SourceGraphic' in2='t' scale='38' xChannelSelector='R' yChannelSelector='G'/></filter>" +
  "<g filter='url(#w)' stroke='" + color + "' stroke-width='1.15' fill='none'>" +
  "<path d='M-20 40 H460 M-20 108 H460 M-20 176 H460 M-20 250 H460 M-20 320 H460 M-20 392 H460'/>" +
  "<path d='M52 -20 V460 M128 -20 V460 M205 -20 V460 M285 -20 V460 M360 -20 V460 M418 -20 V460'/>" +
  "<path d='M128 40 L205 108 M285 176 L360 250 M52 250 L128 320 M285 320 L360 392'/>" +
  "</g></svg>";
const crackURL = (color: string) => `url("data:image/svg+xml,${encodeURIComponent(crackSVG(color))}")`;
// Per-skin crackle veins: { dark-mode colour, light-mode colour, dark opacity, light opacity }.
// Navy keeps its exact original values; the other three get a tasteful tonal vein of their own.
const CRACK: Record<string, { dark: string; light: string; darkOp: number; lightOp: number }> = {
  navy:   { dark: "#7484AA", light: "#6E6455", darkOp: 0.13, lightOp: 0.26 }, // soft steel-navy / warm-taupe (unchanged)
  peach:  { dark: "#C08A7C", light: "#9A6558", darkOp: 0.12, lightOp: 0.22 }, // warm-rose veins
  amber:  { dark: "#BB8A46", light: "#8A5A2E", darkOp: 0.12, lightOp: 0.22 }, // bronze veins (Nude skin)
  aurora: { dark: "#6FA298", light: "#4E7268", darkOp: 0.12, lightOp: 0.22 }, // muted-teal veins (Sea skin)
};

// The ONE shared, skin-aware ambient backdrop — exactly the treatment the Home
// springboard uses, lifted into a single component so EVERY screen (home + every
// inner screen via the Shell) renders an identical background and the whole app
// feels like one place. Dan: "there's a BIG difference in the background … between
// the home screen and the other screens" — inner screens used to render a totally
// different space/Earth backdrop (SpaceBackdrop) over the plain body gradient; now
// they share this. Three layers, all FIXED, pointer-events:none, behind content
// (zIndex 0):
//   1. a soft radial page glow (skin tokens surface2 → bg — same as Home's root)
//   2. three faint ambient brand-colour glow blobs (Home's old inline <Glow>s)
//   3. a deterministic twinkling starfield (gold accents via C.gold)
// The drifting market-symbol layer (BitcoinBackground) is mounted app-wide in
// App.tsx, so it already sits behind BOTH home and inner screens — this component
// supplies the REST of home's look so they finally match. Everything reads the
// active palette via C.*, so it re-themes across all 4 skins × light/dark exactly
// like home (App re-keys the tree on theme change, so C re-evaluates here too).

// Deterministic starfield so positions are stable between renders (same maths the
// Home springboard's own starfield used).
const STARS = Array.from({ length: 50 }, (_, i) => {
  const rnd = (n: number) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
  return { x: +(rnd(1) * 100).toFixed(2), y: +(rnd(2) * 100).toFixed(2), s: +(1 + rnd(3) * 2.4).toFixed(2), o: +(0.22 + rnd(4) * 0.5).toFixed(2), d: +(rnd(5) * 4).toFixed(2), t: +(2.2 + rnd(6) * 3).toFixed(2) };
});

// `quiet` = a calm, STATIC, decluttered backdrop (owners portal): just the soft radial
// page glow + one faint brand blob, NO twinkling starfield (the drifting market symbols
// are gated off separately in App). Dan flagged the owners portal as "very loaded" + slow;
// dropping the animated layers there makes it clean and light.
export default function HomeBackdrop({ quiet = false }: { quiet?: boolean }) {
  const mobile = useIsMobile();
  const prefs = loadThemePrefs();
  const dark = prefs.mode !== "light";
  // Per-skin crackle (all four skins now). Falls back to Navy's tone for any unknown skin key.
  const crackCfg = CRACK[prefs.skin] || CRACK.navy;
  const crackImg = crackURL(dark ? crackCfg.dark : crackCfg.light);
  const crackOp = dark ? crackCfg.darkOp : crackCfg.lightOp;
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden",
      background: `radial-gradient(1200px 760px at 50% -8%, ${C.surface2} 0%, ${C.bg} 55%, ${C.bg} 100%)` }}>
      {/* Antique cracked-surface texture over the base, EVERY skin + both modes. Very low opacity so
          cards + text stay fully legible (it lives behind everything at zIndex 0). */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: crackImg, backgroundRepeat: "repeat", backgroundSize: "440px 440px",
        // Dark: kept GENTLE/subtle (Dan: "לא בוהק" — not shiny). Light: a touch stronger, still tasteful.
        opacity: crackOp }} />
      {quiet ? (
        // Single soft, STATIC brand glow — no animation, minimal GPU cost.
        <div style={{ position: "absolute", borderRadius: "50%", filter: "blur(100px)", width: 460, height: 460, top: -120, insetInlineStart: -120, background: "rgba(247,147,26,0.10)" }} />
      ) : (
        <>
          <style>{"@keyframes hbTwinkle{0%,100%{opacity:.15}50%{opacity:.9}}"}</style>
          {/* ambient brand glows — kept subtle (big blur radii are pricey on mobile, so
              90px keeps the soft look at a fraction of the GPU cost). RTL-agnostic: these
              are decorative, aria-hidden, and don't affect layout or reading order. */}
          <div style={{ position: "absolute", borderRadius: "50%", filter: "blur(90px)", width: 420, height: 420, top: -80, left: -96, background: "rgba(247,147,26,0.18)" }} />
          <div style={{ position: "absolute", borderRadius: "50%", filter: "blur(90px)", width: 460, height: 460, top: "33%", left: "50%", transform: "translateX(-50%)", background: "rgba(124,192,78,0.16)" }} />
          <div style={{ position: "absolute", borderRadius: "50%", filter: "blur(90px)", width: 440, height: 440, bottom: -96, right: -96, background: "rgba(247,181,0,0.20)" }} />
          {/* twinkling starfield watermark */}
          {STARS.map((st, i) => (
            <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, borderRadius: "50%",
              background: i % 6 === 0 ? C.gold : "#fff", opacity: st.o, boxShadow: i % 6 === 0 ? `0 0 6px ${C.gold}` : "none",
              animation: mobile ? "none" : `hbTwinkle ${st.t}s ease-in-out ${st.d}s infinite` }} />
          ))}
          {/* Drifting market symbols ("running coins") — rendered HERE, as the TOP backdrop
              layer, so they sit ABOVE this backdrop's opaque skin fill and show on EVERY screen.
              Previously mounted app-wide in App.tsx at zIndex:0, they were hidden on Home by
              Home's own opaque zIndex:1 root; folding them into the shared backdrop fixes that.
              Only in the full (non-quiet) backdrop — the owners portal stays clean. */}
          <BitcoinBackground />
        </>
      )}
    </div>
  );
}
