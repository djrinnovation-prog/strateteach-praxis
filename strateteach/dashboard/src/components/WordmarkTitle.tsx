import React from "react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

// ── Reusable "wordmark-style title" ───────────────────────────────────────────
// Renders ANY screen's OWN NAME in the EXACT Home StrateTeach-wordmark visual design:
// the skin-adaptive title GRADIENT (C.titleGrad) clipped into the text, heavy weight,
// wide uppercase tracking (tighter in Hebrew), Rubik. The TEXT is the screen's name
// (e.g. "בורסה" on Exchange, "באקטסט" on Backtest, "מנוע מסחר" on the Daily Engine) —
// only the visual styling is shared, NOT the word. Per Dan: identical gradient
// treatment, identical title colours, identical font, skin-adaptive. Drop this into
// any screen/portal header to give it Home's title look with its own name.
export default function WordmarkTitle({ text, size = "lg", style }: {
  text: string;
  size?: "lg" | "md";              // lg = full-screen header (default) · md = embedded (portal tabs)
  style?: React.CSSProperties;
}) {
  const { lang } = useI18n();
  const he = lang === "he";
  const lg = size === "lg";
  return (
    <span style={{
      fontFamily: UI, fontWeight: 900, lineHeight: 1.1, textTransform: "uppercase",
      fontSize: lg ? "clamp(21px, 6.4vw, 32px)" : "clamp(19px, 5.2vw, 25px)",
      letterSpacing: he ? (lg ? "0.05em" : "0.04em") : (lg ? "0.16em" : "0.12em"),
      // the skin-adaptive wordmark gradient, clipped into the glyphs
      backgroundImage: C.titleGrad, WebkitBackgroundClip: "text", backgroundClip: "text",
      WebkitTextFillColor: "transparent", color: "transparent",
      paddingInlineStart: lg ? "0.16em" : undefined,
      ...style,
    }}>
      {text}
    </span>
  );
}
