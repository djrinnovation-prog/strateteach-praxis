import React from "react";
import { useI18n } from "../i18n";
import { C } from "../theme";

type Lbl = { he: string; en: string };
const TAGS: Lbl[] = [
  { he: "סריקת כל הנכסים", en: "All market asset scan" },
  { he: "פריצות יומיות", en: "Daily breakouts" },
  { he: "חברו בורסה", en: "Connect your exchange" },
  { he: "מסחר דמו ולייב", en: "Demo & Live trading system" },
  { he: "למידה ורילים", en: "Learn & reels" },
];

// Brand-styled running sentence — the feature taglines scrolling in the
// STRATETEACH wordmark style. Lives at the bottom of Home.
export default function BrandTicker({ mobile }: { mobile?: boolean }) {
  const { lang } = useI18n();
  return (
    <div dir="ltr" style={{ overflow: "hidden", borderRadius: 999, padding: "8px 0", background: C.surface, border: `1px solid ${C.line}`,
      maskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)" }}>
      <style>{"@keyframes btRun{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <div style={{ display: "inline-flex", whiteSpace: "nowrap", animation: "btRun 22s linear infinite", willChange: "transform" }}>
        {[0, 1].map((half) => (
          <span key={half} style={{ display: "inline-flex", flexShrink: 0 }}>
            {TAGS.map((tg, k) => (
              <span key={k} style={{ paddingInline: 22, fontSize: mobile ? 12 : 13.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase",
                color: C.gold, textShadow: `0 1px 12px ${C.gold}66` }}>
                {tg[lang]}<span style={{ color: C.muted, margin: "0 -8px 0 14px" }}>✦</span>
              </span>
            ))}
          </span>
        ))}
      </div>
    </div>
  );
}
