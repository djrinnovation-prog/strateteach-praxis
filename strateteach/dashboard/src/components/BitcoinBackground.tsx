import React from "react";
import { loadThemePrefs } from "../theme";

// Live, ambient market backdrop: crypto/stock/metal/commodity symbols drifting
// up very slowly. Deliberately faint + slow so it feels alive without distracting.
// Pure CSS (no deps, no JS loop), pointer-events: none, sits behind all content.

// Mix of big glyphs and ticker chips across asset classes.
const GLYPHS = [
  { txt: "₿", left: "8%", size: 150, dur: 58, delay: 0, op: 0.05, c: "#F7931A" },   // Bitcoin
  { txt: "Ξ", left: "70%", size: 200, dur: 74, delay: -12, op: 0.045, c: "#8aa0ff" }, // Ethereum
  { txt: "$", left: "40%", size: 120, dur: 50, delay: -28, op: 0.04, c: "#7CC04E" },  // USD
  { txt: "Ɇ", left: "88%", size: 120, dur: 66, delay: -40, op: 0.045, c: "#F7931A" },
  { txt: "₮", left: "20%", size: 150, dur: 80, delay: -55, op: 0.038, c: "#26A17B" }, // USDT
  { txt: "Ł", left: "55%", size: 96, dur: 46, delay: -18, op: 0.05, c: "#bfbfbf" },   // Litecoin
];

// Ticker chips: crypto · stocks · metals · commodities.
const TICKERS = [
  { t: "BTC", left: "14%", dur: 64, delay: -5, c: "#F7931A" },
  { t: "ETH", left: "30%", dur: 72, delay: -20, c: "#8aa0ff" },
  { t: "AAPL", left: "48%", dur: 60, delay: -33, c: "#cbd5e1" },
  { t: "TSLA", left: "62%", dur: 78, delay: -10, c: "#cbd5e1" },
  { t: "NVDA", left: "78%", dur: 56, delay: -44, c: "#7CC04E" },
  { t: "XAU·GOLD", left: "6%", dur: 86, delay: -50, c: "#FBC02D" },
  { t: "XAG·SILVER", left: "84%", dur: 70, delay: -25, c: "#cfd8dc" },
  { t: "WTI·OIL", left: "36%", dur: 82, delay: -62, c: "#9ccc65" },
  { t: "NATGAS", left: "92%", dur: 68, delay: -38, c: "#80deea" },
  { t: "SPX", left: "24%", dur: 58, delay: -15, c: "#cbd5e1" },
  { t: "SOL", left: "68%", dur: 50, delay: -48, c: "#a47bf0" },
  { t: "COPPER", left: "52%", dur: 90, delay: -70, c: "#e08a5b" },
];

export default function BitcoinBackground() {
  // Mode-aware backdrop. On DARK skins it stays exactly as before — pale brand
  // glyphs at a whisper of opacity with a soft coloured glow. On LIGHT skins those
  // pale colours simply vanished against the off-white page (Dan: "on the light
  // skin I don't see the symbols in the background"), so instead of skipping the
  // layer we DARKEN each glyph/ticker toward its deep brand shade and lift the
  // opacity a few points — still a faint, tasteful watermark, but actually legible
  // on the light background. (App.tsx re-keys this subtree on theme change, so the
  // mode read here re-evaluates whenever the skin/mode switches.)
  const light = loadThemePrefs().mode === "light";
  // Darken a brand hex toward near-black — used only in light mode so the symbol
  // keeps its hue identity while gaining enough contrast on the off-white page.
  const darken = (h: string, amt: number) => {
    const m = h.replace("#", "");
    const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
    const i = parseInt(n, 16);
    const ch = (sh: number) => Math.max(0, Math.min(255, Math.round(((i >> sh) & 255) * (1 - amt)))).toString(16).padStart(2, "0");
    return `#${ch(16)}${ch(8)}${ch(0)}`;
  };
  const ink = (c: string) => (light ? darken(c, 0.5) : c);
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
      <style>{`
        @keyframes mktRise {
          0%   { transform: translateY(112vh) rotate(-6deg); }
          100% { transform: translateY(-45vh) rotate(6deg); }
        }
        @keyframes mktDrift {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>

      {/* slow drifting price line */}
      <svg viewBox="0 0 200 100" preserveAspectRatio="none"
        style={{ position: "absolute", left: 0, bottom: "8%", width: "200%", height: "34%",
          opacity: light ? 0.5 : 0.5, animation: "mktDrift 90s linear infinite" }}>
        <polyline fill="none" stroke={ink("#F7931A")} strokeWidth={light ? 0.5 : 0.4}
          points="0,70 8,64 16,68 24,52 32,58 40,40 48,46 56,30 64,38 72,22 80,28 88,18 96,26 104,70 112,64 120,68 128,52 136,58 144,40 152,46 160,30 168,38 176,22 184,28 192,18 200,26" />
      </svg>

      {/* big asset glyphs — RESTORED to full presence (Dan: bring the running coins back on all
          screens). The dark-mode opacity was previously HALVED (g.op * 0.5), which had faded them
          to near-invisible; now they run at their designed faint-but-legible level, app-wide. */}
      {GLYPHS.map((g, i) => (
        <div key={`g${i}`} style={{ position: "absolute", left: g.left, top: 0, fontWeight: 900,
          fontSize: g.size, lineHeight: 1, color: ink(g.c), opacity: light ? 0.18 : g.op * 2.8,
          animation: `mktRise ${g.dur}s linear ${g.delay}s infinite`, willChange: "transform",
          textShadow: light ? "none" : `0 0 40px ${g.c}55` }}>
          {g.txt}
        </div>
      ))}

      {/* ticker chips across asset classes */}
      {TICKERS.map((t, i) => (
        <div key={`t${i}`} style={{ position: "absolute", left: t.left, top: 0,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 15, fontWeight: 700,
          letterSpacing: "0.08em", color: ink(t.c), opacity: light ? 0.24 : 0.16, whiteSpace: "nowrap",
          animation: `mktRise ${t.dur}s linear ${t.delay}s infinite`, willChange: "transform" }}>
          {t.t}
        </div>
      ))}
    </div>
  );
}
