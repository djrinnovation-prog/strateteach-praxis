import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Info } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

// Premium "Signal Bot" entry CTA → /bots (the user-facing Signal Bots screen).
//
// Intentionally GLOSSY BLACK on every skin — the black-with-a-twinkling-star IS
// this premium feature's brand, so it stays constant across cyan/red/yellow/green
// (light + dark). The ONLY skin-aware touch is a soft accent (C.gold) glow on the
// star + border, so the button still reads as part of the active theme's chrome.
//
// Two sizes via `variant`:
//   • "pill"  — compact, rounded (header action area + Home shortcuts row).
//   • "block" — large, full-width with a sub-line (Home premium highlight).
//
// RTL-correct (logical props / inline-flex, so HE flips automatically), 44px tap
// target (minHeight + .tap44). The ★ twinkles via a CSS keyframe; under
// prefers-reduced-motion it renders as a static, fully-visible star.
export default function SignalBotButton({ variant = "pill", style }: {
  variant?: "pill" | "block";
  style?: React.CSSProperties;
}) {
  const nav = useNavigate();
  const loc = useLocation();
  const { lang } = useI18n();

  // The pill is a global quick-access entry to /bots — EXCEPT when you're already
  // on /bots, where navigating there is pointless. There, the same black-icon click
  // instead opens the in-screen "How it works" guide. We decouple via a window
  // CustomEvent so this button never has to prop-drill through ScreenHeader: the
  // /bots screen (SignalBots.tsx) listens for "open-signalbot-guide" and opens the
  // modal. Anywhere else, it navigates as before.
  const onBots = loc.pathname === "/bots" || loc.pathname === "/bots/";
  const handleClick = () => {
    if (onBots) window.dispatchEvent(new CustomEvent("open-signalbot-guide"));
    else nav("/bots");
  };
  const label = lang === "he" ? "סיגנל בוט" : "Signal Bot";
  const sub = lang === "he" ? "אוטומציית סיגנלים · פרימיום" : "Automated signals · Premium";
  const block = variant === "block";
  const accent = C.gold; // skin accent — used ONLY for the star glow + border tint

  // Glossy deep-black body. Kept black on every skin; the gradient + inset top
  // highlight give it the wet "gloss" sheen, the accent ring/glow ties it to the skin.
  const base: React.CSSProperties = {
    position: "relative",
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(180deg, #34343a 0%, #161619 40%, #050506 100%)",
    border: `1px solid ${accent}66`,
    color: "#FFFFFF",
    fontFamily: UI,
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), 0 0 0 1px rgba(0,0,0,0.55), 0 10px 26px -12px rgba(0,0,0,0.7), 0 0 16px -3px ${accent}55`,
    ...(block
      ? { width: "100%", minHeight: 56, borderRadius: 16, padding: "12px 20px", flexDirection: "column", gap: 3 }
      : { minHeight: 44, borderRadius: 999, padding: "9px 16px", fontSize: 12.5, fontWeight: 800 }),
    ...style,
  };

  const star = (
    <span aria-hidden className="sb-star" style={{
      color: accent, fontSize: block ? 18 : 14, lineHeight: 1, display: "inline-block",
      textShadow: `0 0 6px ${accent}, 0 0 12px ${accent}aa`,
    }}>★</span>
  );

  // Small "i" affordance so the black pill reads as tappable → opens the connect
  // guide (on /bots) / navigates (elsewhere). Gold to tie into the star, kept
  // subtle so it never crowds the label or breaks the header layout.
  const info = (
    <Info aria-hidden size={block ? 15 : 13} strokeWidth={2.25} style={{
      color: accent, opacity: 0.9, flexShrink: 0,
      filter: `drop-shadow(0 0 5px ${accent}88)`,
    }} />
  );

  return (
    <button type="button" onClick={handleClick} className="tap44" title={label} style={base}>
      <style>{
        "@keyframes sbTwinkle{0%,100%{opacity:.55;transform:scale(.82) rotate(0deg)}50%{opacity:1;transform:scale(1.18) rotate(10deg)}}" +
        ".sb-star{animation:sbTwinkle 1.9s ease-in-out infinite}" +
        "@media (prefers-reduced-motion:reduce){.sb-star{animation:none!important;opacity:1!important;transform:none!important}}"
      }</style>
      {/* top gloss sheen (static — pure decoration) */}
      <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0, height: "52%",
        background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)", pointerEvents: "none" }} />
      {block ? (
        <>
          <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 9, fontSize: 16, fontWeight: 900, letterSpacing: "0.01em" }}>
            {star} {label} {info}
          </span>
          <span style={{ position: "relative", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.66)" }}>{sub}</span>
        </>
      ) : (
        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 7 }}>
          {star} {label} {info}
        </span>
      )}
    </button>
  );
}
