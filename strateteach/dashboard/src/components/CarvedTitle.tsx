import React, { useLayoutEffect, useRef, useState } from "react";
import { GraduationCap, Diamond } from "lucide-react";
import { UI, loadThemePrefs } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import { LOGO_PALETTES, type SkinKey } from "../lib/logoPalettes";

// ── CarvedTitle — a faithful SCALED reproduction of the logo.html recipe, for ANY text ──
// The StrateTeach wordmark is CSS-generated (logo.html), reproduced EXACTLY, scaled to a
// title size (recipe authored at 150px; every px × k = size/150):
//   • Font 'Baloo 2' @ 800, line-height 1, letter-spacing −2px.
//   • white cut: -webkit-text-stroke 2px rgba(255,255,255,0.55) — SUBTLE.
//   • 3D depth: text-shadow = SEVEN hard layers 1..7px (x=y) in the DEPTH tone + one ambient.
// COLOURS = the ACTUAL per-skin logo palette, pixel-sampled granularly from logo-{skin}.png
// (src/lib/logoPalettes.ts) and cycled per letter — so the title matches Home's wordmark on
// each skin (warm coral/peach on Peach, blues on Navy, …), NOT a fixed rainbow. The depth
// tone is a darkened copy of each letter's face colour. Read live so it re-skins. RTL-aware.
//
// AUTO-FIT (Dan): the classic title is a single nowrap line, so a LONG name ("Owners Portal",
// "Personal Portal", "Trend Scanner") would run edge-to-edge and clip against the frame.
// We MEASURE the rendered title width vs the available inner width (the frame's content box)
// and scale the WHOLE recipe down (font-size drives k, so stroke/shadow/spacing all scale
// proportionally) until it sits inside with comfortable horizontal padding — floored at a
// sensible minimum. Short titles keep full size; only long ones shrink. Re-fits on mount,
// resize, orientation and font-load, all rAF-coalesced so there's no reflow storm.
function darkOf(hex: string, amt = 0.5): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const i = parseInt(n, 16);
  const r = ((i >> 16) & 255) * (1 - amt), g = ((i >> 8) & 255) * (1 - amt), b = (i & 255) * (1 - amt);
  return "#" + [r, g, b].map((v) => Math.max(0, Math.round(v)).toString(16).padStart(2, "0")).join("");
}
// Mix a hue toward WHITE by amt — the lit top-bevel edge for the iso-3D variant.
function lightOf(hex: string, amt = 0.5): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const i = parseInt(n, 16);
  const r = ((i >> 16) & 255), g = ((i >> 8) & 255), b = (i & 255);
  const mix = (v: number) => v + (255 - v) * amt;
  return "#" + [mix(r), mix(g), mix(b)].map((v) => Math.max(0, Math.round(v)).toString(16).padStart(2, "0")).join("");
}

function usePalette(): string[] {
  const skin = loadThemePrefs().skin as SkinKey;
  return LOGO_PALETTES[skin] || LOGO_PALETTES.navy;
}

export default function CarvedTitle({ text, size, variant = "classic", brandIcons = false, style }: {
  text: string;
  size?: number;                 // override the responsive default (px)
  // "classic" = the older 45° carved look (heavy 7-layer shadow). "emboss" = the CLEAN
  // warm skin-gradient EMBOSSED text that echoes the Home PNG wordmark art — per-letter
  // logo palette + a lit top bevel + a short soft depth + one ambient shadow (no heavy
  // carve). "iso3d" = the (rejected) isometric SVG block extrusion, kept only for reference.
  variant?: "classic" | "iso3d" | "emboss";
  brandIcons?: boolean;          // iso3d only: brand marks — a graduation-cap on the capital "T"
                                 // + a diamond on the "S" (the Home wordmark). Off everywhere else.
  style?: React.CSSProperties;
}) {
  const mobile = useIsMobile();
  if (variant === "iso3d") {
    const fs = size ?? (mobile ? 52 : 72);
    return <Iso3DTitle text={text} fs={fs} brandIcons={brandIcons} style={style} />;
  }
  return <ClassicCarved text={text} size={size} mobile={mobile} style={style} look={variant === "emboss" ? "emboss" : "classic"} />;
}

// ── ISO-3D — genuinely three-dimensional isometric block title (SVG) ──────────────────
// Not a flat text-shadow "carve": each letter is an EXTRUDED block. We stack many dense
// offset copies of the word along a mostly-downward isometric vector (the solid SIDE face,
// shaded darker toward the back for block roundness), add a bright lit TOP bevel (offset the
// opposite way — the raised/embossed edge), then the coloured FRONT face on top, and skew the
// whole group slightly so it reads as standing isometric blocks (like the colourful isometric
// alphabet reference). Per-letter colours = the live per-skin logo palette. Dynamic text,
// Latin + Hebrew (RTL char order reversed so the per-glyph SVG tspans read correctly). The SVG
// is sized to its measured bbox, then scales to fit its frame via max-width — so LONG titles
// shrink to fit with no clipping and no font re-fit maths.
function Iso3DTitle({ text, fs, brandIcons = false, style }: { text: string; fs: number; brandIcons?: boolean; style?: React.CSSProperties }) {
  const PAL = usePalette();
  const outerRef = useRef<SVGGElement>(null);
  const faceRef = useRef<SVGTextElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Measured x-centres of the capital "T" and "S" glyphs (for the brand cap/diamond marks). In
  // the SAME (skewed-group) coordinate system as the letters, so the icons align + scale with them.
  const [marks, setMarks] = useState<{ capX: number; gemX: number } | null>(null);

  const rtl = /[֐-׿]/.test(text);
  // Reverse RTL so per-glyph tspans (which defeat the SVG bidi reorder) render in visual order.
  // Hebrew is non-cursive, so a plain reverse yields correct letterforms.
  const chars = Array.from(rtl ? Array.from(text).reverse() : Array.from(text));

  // Geometry — all authored as fractions of the font size.
  const Dx = fs * 0.12, Dy = fs * 0.30;   // extrusion vector: mostly DOWN, slight RIGHT (standing block)
  const depth = fs * 0.42;                // total extrusion depth
  const steps = Math.max(18, Math.round(depth));   // ~1px steps → a SOLID side face, not gaps
  const ls = fs * 0.07;                   // letter-spacing — well-separated / "broken" like the logo
  const bev = fs * 0.035;                 // lit top-bevel offset (up-left)
  const skew = -9;                        // isometric lean (deg)
  const x0 = fs * 0.6, baseY = fs * 1.0;  // start position inside a generous initial canvas

  const face = chars.map((_, i) => PAL[i % PAL.length]);
  const common: React.SVGProps<SVGTextElement> = {
    fontFamily: "'Fredoka','Baloo 2','Heebo'," + UI, fontWeight: 700, fontSize: fs,
    letterSpacing: ls, textAnchor: "start",
  };
  const tspans = (cols: string[] | string) => chars.map((ch, i) => (
    <tspan key={i} fill={Array.isArray(cols) ? cols[i] : cols}>{ch === " " ? " " : ch}</tspan>
  ));

  const layers: React.ReactNode[] = [];
  // Extrusion, drawn BACK → FRONT (darker at the back for a rounded side).
  for (let s = steps; s >= 0; s--) {
    const t = s / steps, ox = Dx * t, oy = Dy * t;
    const cols = face.map((c) => darkOf(c, 0.30 + 0.30 * t));
    layers.push(<text key={"e" + s} x={x0 + ox} y={baseY + oy} {...common}>{tspans(cols)}</text>);
  }
  // Lit top bevel (raised edge) just under the face.
  layers.push(<text key="bev" x={x0 - bev} y={baseY - bev} {...common}>{tspans(face.map((c) => lightOf(c, 0.66)))}</text>);
  // (The front FACE is rendered separately below with a ref, so we can measure glyph positions
  //  for the brand cap/diamond marks.)

  // Measure the drawn bbox (includes the skewed inner group) → tight viewBox, so the frame hugs it.
  useLayoutEffect(() => {
    const measure = () => {
      const g = outerRef.current; if (!g) return;
      try { const b = g.getBBox(); if (b.width > 0 && b.height > 0) setBox({ x: b.x, y: b.y, w: b.width, h: b.height }); } catch { /* not yet laid out */ }
      // Brand marks: measure the exact x-centre of the capital "T" and "S" glyphs on the front
      // face so the graduation-cap / diamond sit ON those letters and scale with the title.
      if (brandIcons) {
        const f = faceRef.current;
        const idxT = chars.indexOf("T"), idxS = chars.indexOf("S");
        if (f && idxT >= 0 && idxS >= 0) {
          try {
            const cx = (i: number) => (f.getStartPositionOfChar(i).x + f.getEndPositionOfChar(i).x) / 2;
            setMarks({ capX: cx(idxT), gemX: cx(idxS) });
          } catch { /* not laid out yet */ }
        }
      }
    };
    measure();
    let cancelled = false;
    (document as any).fonts?.ready?.then(() => { if (!cancelled) measure(); }).catch(() => { /* */ });
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.addEventListener("algo770-theme", measure);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.removeEventListener("algo770-theme", measure);
    };
  }, [text, fs, brandIcons]);

  const pad = fs * 0.16;
  const estW = x0 * 2 + chars.length * fs;                 // generous pre-measure fallback
  const estH = baseY + Dy + depth + fs * 0.5;
  const w = box ? box.w + 2 * pad : estW;
  const h = box ? box.h + 2 * pad : estH;
  const vb = box ? `${box.x - pad} ${box.y - pad} ${w} ${h}` : `0 0 ${estW} ${estH}`;

  // Brand-mark colours + vertical anchor (cap-height above the baseline).
  const S = chars.indexOf("S"), T = chars.indexOf("T");
  const gemCol = face[S] ?? PAL[0];
  const capCol = lightOf(face[T] ?? PAL[0], 0.18);
  const letterTop = baseY - fs * 0.72;

  return (
    <svg role="heading" aria-level={1} aria-label={text}
      width={w} height={h} viewBox={vb}
      style={{ display: "block", maxWidth: "100%", height: "auto", overflow: "visible", ...style }}>
      <g ref={outerRef}>
        <g transform={`skewX(${skew})`}>
          {layers}
          {/* Front FACE (measured for the brand marks). */}
          <text ref={faceRef} x={x0} y={baseY} {...common}>{tspans(face)}</text>
          {brandIcons && marks && (
            <>
              {/* Diamond ON the "S" — a small filled gem sitting just above the letter. */}
              <Diamond x={marks.gemX - fs * 0.19} y={letterTop - fs * 0.28} width={fs * 0.38} height={fs * 0.38}
                color={lightOf(gemCol, 0.4)} fill={gemCol} strokeWidth={2} />
              {/* Graduation cap ON the capital "T" — the "teach" brand mark. */}
              <GraduationCap x={marks.capX - fs * 0.30} y={letterTop - fs * 0.52} width={fs * 0.60} height={fs * 0.60}
                color={capCol} strokeWidth={2.2} />
            </>
          )}
        </g>
      </g>
    </svg>
  );
}

// ── CLASSIC / EMBOSS — flat-text carved title (shared auto-fit) ───────────────────────
// `look="classic"` = the older heavy 7-layer 45° carve. `look="emboss"` = the CLEAN warm
// skin-gradient emboss that echoes the Home PNG wordmark: a lit top-left bevel + a short
// 3-step depth + one soft ambient shadow, and a hair-thin light stroke. Same per-letter
// logo palette, so it matches the wordmark on every skin — just cleaner/less carved.
function ClassicCarved({ text, size, mobile, style, look = "classic" }: {
  text: string; size?: number; mobile: boolean; style?: React.CSSProperties; look?: "classic" | "emboss";
}) {
  const baseFs = size ?? (mobile ? 56 : 68);   // strong presence on both; same recipe, smaller on mobile
  const MIN_FS = mobile ? 24 : 30;             // floor so a very long name stays legible while fitting
  const titleRef = useRef<HTMLSpanElement>(null);
  const [fitFs, setFitFs] = useState(baseFs);
  // Keep the applied size readable inside the measure closure without re-subscribing listeners.
  const fitFsRef = useRef(baseFs);
  fitFsRef.current = fitFs;

  // A new base (mobile↔desktop / size prop) or new text starts the fit fresh from full size.
  useLayoutEffect(() => { setFitFs(baseFs); }, [baseFs, text]);

  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = titleRef.current;
      const frame = el?.parentElement;            // the FramedTitle frame (padded box)
      const wrap = frame?.parentElement;          // the full-width centering row (stable, non-hugging)
      if (!el || !frame || !wrap) return;
      const cs = getComputedStyle(frame);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      // Available inner width = the widest the frame may become (the full-width centering row,
      // capped by the frame's own max-width) minus its padding, minus a small comfort margin
      // (also absorbs the 3D shadow's rightward extent). Measuring the NON-hugging grandparent
      // avoids the fit-content circularity (frame hugs title → can't grow → title clips).
      const avail = Math.max(48, wrap.clientWidth - padX - 12);
      const cur = fitFsRef.current;
      const natural = el.scrollWidth;             // title width at the CURRENTLY applied size
      if (!natural || !cur) return;
      // Width is linear in font-size, so natural-at-base is a single-shot computation.
      const naturalAtBase = natural * (baseFs / cur);
      const next = naturalAtBase <= avail ? baseFs : Math.max(MIN_FS, (baseFs * avail) / naturalAtBase);
      if (Math.abs(next - cur) > 0.5) setFitFs(next);
    };
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();  // first pass SYNCHRONOUSLY (useLayoutEffect → before paint) so there's no flash of the full-size title
    const wrap = titleRef.current?.parentElement?.parentElement;
    const ro = wrap ? new ResizeObserver(schedule) : null;
    if (wrap && ro) ro.observe(wrap);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("algo770-theme", schedule);
    let cancelled = false;
    (document as any).fonts?.ready?.then(() => { if (!cancelled) schedule(); }).catch(() => { /* */ });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("algo770-theme", schedule);
    };
  }, [baseFs, text, MIN_FS]);

  const fs = fitFs;
  const k = fs / 150;            // recipe authored at 150px — scale every px by k
  const px = (n: number) => (n * k).toFixed(2);
  // Pixel-exact per-skin face palette (granular sample of the real logo art) → matches
  // today's per-skin logo. Read live so it re-skins with the app.
  const PAL = usePalette();
  // CLASSIC: 7 hard 45° layers in one dark tone + a soft ambient.
  // EMBOSS: a lit top-left bevel (echoes the PNG's raised edge) + a SHORT 3-step depth in the
  // dark tone + one soft ambient — clean and dimensional without the heavy carve.
  const depth = (dark: string, light: string) => {
    if (look === "emboss") {
      return [
        `${px(-1)} ${px(-1)} 0 ${light}`,               // lit top-left bevel (raised edge)
        `${px(1)} ${px(1)} 0 ${dark}`,
        `${px(2)} ${px(2)} 0 ${dark}`,
        `${px(3)} ${px(3)} ${px(1)} ${dark}`,
        `0 ${px(8)} ${px(11)} rgba(20,20,40,0.26)`,      // one soft ambient
      ].join(", ");
    }
    const layers: string[] = [];
    for (let i = 1; i <= 7; i++) layers.push(`${px(i)} ${px(i)} 0 ${dark}`);
    layers.push(`0 ${px(10)} ${px(12)} rgba(20,20,40,0.28)`);
    return layers.join(", ");
  };
  const rtl = /[֐-׿]/.test(text);   // Hebrew → the letter row flows right-to-left
  const chars = Array.from(text);
  let ci = 0;                                  // colour index advances only on real glyphs
  return (
    // CLASSIC → Baloo 2 (Latin) / Fredoka (Hebrew).
    // NB: NO maxWidth here — the frame is fit-content and must hug the (fitted) title width;
    // a maxWidth:100% would let the frame collapse to its min-width instead of hugging.
    <span ref={titleRef} dir={rtl ? "rtl" : "ltr"} aria-label={text} role="heading" aria-level={1}
      style={{ display: "inline-block", whiteSpace: "nowrap",
        fontFamily: "'Baloo 2', 'Fredoka', 'Heebo', " + UI,
        fontWeight: 800, fontSize: fs, lineHeight: 1,
        letterSpacing: `${px(-2)}px`,
        paddingBottom: `${px(14)}px`, ...style }}>
      {chars.map((ch, idx) => {
        if (ch === " ") return <span key={idx} aria-hidden style={{ display: "inline-block", width: "0.3em" }} />;
        const color = PAL[ci % PAL.length];
        const dark = darkOf(color, look === "emboss" ? 0.42 : 0.5);
        const light = lightOf(color, 0.7);
        ci++;
        return (
          <span key={idx} aria-hidden style={{ color,
            WebkitTextStroke: look === "emboss" ? `${px(1)} rgba(255,255,255,0.42)` : `${px(2)} rgba(255,255,255,0.55)`,
            textShadow: depth(dark, light) }}>{ch}</span>
        );
      })}
    </span>
  );
}
