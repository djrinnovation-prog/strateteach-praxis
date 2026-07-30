import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { UI, loadThemePrefs } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import { LOGO_PALETTES, type SkinKey } from "../lib/logoPalettes";

// ── LogoWordmark — the StrateTeach wordmark recreated as a DYNAMIC SVG that MATCHES the
// home logo PNG (public/logo-*.png), per Dan. Not isometric/tilted — FRONT-FACING:
//   • chunky rounded Baloo 2 (800), mixed-case, the app's brand font;
//   • MULTI-COLOUR per letter — each glyph a different tone from the per-skin LOGO_PALETTES
//     (sampled from the real logo art), so the word runs light→deep→light like the logo,
//     NOT one flat skin tone;
//   • FRONT-FACING 3D — the extrusion goes straight DOWN (a hair right), a solid darker shade
//     of each letter, so it reads as an upright raised block, never a sideways isometric slant;
//   • a soft drop shadow beneath (like the logo);
//   • WHITE SEGMENT LINES clipped to the glyphs — the logo's "mosaic"/faceted break.
// The SVG is sized to its measured bbox and scales to fit its frame via max-width (long titles
// shrink, no clipping). Latin only for now (Hebrew handled separately). RTL-aware colour order.
function darkOf(hex: string, amt: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const i = parseInt(n, 16);
  const r = ((i >> 16) & 255) * (1 - amt), g = ((i >> 8) & 255) * (1 - amt), b = (i & 255) * (1 - amt);
  return "#" + [r, g, b].map((v) => Math.max(0, Math.round(v)).toString(16).padStart(2, "0")).join("");
}

export default function LogoWordmark({ text = "StrateTeach", size, style }: {
  text?: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const mobile = useIsMobile();
  const uid = "lw" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const faceRef = useRef<SVGTextElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const skin = loadThemePrefs().skin as SkinKey;
  const PAL = LOGO_PALETTES[skin] || LOGO_PALETTES.navy;
  const fs = size ?? (mobile ? 46 : 66);

  const chars = Array.from(text);
  // Per-glyph colour, advancing only on real glyphs (spaces keep the run continuous).
  let ci = 0;
  const colorOf = chars.map((ch) => (ch === " " ? null : PAL[(ci++) % PAL.length]));

  const ls = fs * 0.005;
  const Dx = fs * 0.02, depth = fs * 0.08;         // front-facing: extrusion mostly DOWN, a hair right
  const steps = Math.max(6, Math.round(depth));
  const x0 = fs * 0.4, baseY = fs * 1.0;

  const common: React.SVGProps<SVGTextElement> = {
    fontFamily: "'Baloo 2','Fredoka','Heebo'," + UI, fontWeight: 800, fontSize: fs, letterSpacing: ls,
  };
  const tspans = (mode: "face" | "dark", t = 1) => chars.map((ch, i) => {
    const c = colorOf[i];
    const fill = c == null ? "none" : (mode === "dark" ? darkOf(c, 0.3 + 0.12 * t) : c);
    return <tspan key={i} fill={fill}>{ch === " " ? " " : ch}</tspan>;
  });

  const extrusion: React.ReactNode[] = [];
  for (let s = steps; s >= 1; s--) {
    const t = s / steps;
    extrusion.push(<text key={"e" + s} x={x0 + Dx * t} y={baseY + depth * t} {...common}>{tspans("dark", t)}</text>);
  }

  // White mosaic lines (clipped to the glyphs): two near-horizontal cuts + a few slanted breaks.
  const sw = fs * 0.026;
  const whiteLines: React.ReactNode[] = [];
  [baseY - fs * 0.62, baseY - fs * 0.30].forEach((yy, k) =>
    whiteLines.push(<rect key={"h" + k} x={x0 - fs} y={yy} width={fs * (chars.length + 3)} height={sw} fill="#ffffff" opacity={0.9} />));
  [x0 + fs * 1.1, x0 + fs * 3.0, x0 + fs * 4.6, x0 + fs * 6.1].forEach((xx, k) =>
    whiteLines.push(<rect key={"v" + k} x={xx} y={baseY - fs} width={sw} height={fs * 1.15} fill="#ffffff" opacity={0.88} transform={`rotate(12 ${xx} ${baseY})`} />));

  // Size the SVG to the FACE text's bbox (not the clipped white group, whose wide rects would
  // blow up the box) + padding for the soft shadow + the downward extrusion.
  useLayoutEffect(() => {
    const measure = () => {
      const el = faceRef.current; if (!el) return;
      try { const b = el.getBBox(); if (b.width > 0 && b.height > 0) setBox({ x: b.x, y: b.y, w: b.width, h: b.height }); } catch { /* not laid out */ }
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
  }, [text, fs, skin]);

  const padL = fs * 0.16, padR = fs * 0.26, padT = fs * 0.14, padB = fs * 0.30;
  const estW = x0 * 2 + chars.length * fs, estH = baseY + depth + fs * 0.6;
  const w = box ? box.w + padL + padR : estW;
  const h = box ? box.h + padT + padB : estH;
  const vb = box ? `${box.x - padL} ${box.y - padT} ${w} ${h}` : `0 0 ${estW} ${estH}`;

  return (
    <svg role="heading" aria-level={1} aria-label={text} width={w} height={h} viewBox={vb}
      style={{ display: "block", maxWidth: "100%", height: "auto", overflow: "visible", ...style }}>
      <defs>
        <clipPath id={uid + "-clip"}>
          <text x={x0} y={baseY} {...common}>{chars.map((ch, i) => <tspan key={i}>{ch === " " ? " " : ch}</tspan>)}</text>
        </clipPath>
        <filter id={uid + "-sh"} x="-20%" y="-25%" width="140%" height="150%">
          <feGaussianBlur stdDeviation={fs * 0.03} />
        </filter>
      </defs>
      {/* soft drop shadow */}
      <text x={x0 + fs * 0.03} y={baseY + fs * 0.06} {...common} fill="rgba(0,0,0,0.16)" filter={`url(#${uid}-sh)`}>{text}</text>
      {extrusion}
      <text ref={faceRef} x={x0} y={baseY} {...common}>{tspans("face")}</text>
      <g clipPath={`url(#${uid}-clip)`}>{whiteLines}</g>
    </svg>
  );
}
