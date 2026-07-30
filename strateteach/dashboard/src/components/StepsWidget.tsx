import React from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ArrowLeftRight, TrendingUp, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n";
import { C } from "../theme";

// Compact 3-step starter widget shown on every screen: Learn → Connect → Profit.
// Each chip jumps to that step's screen.
const STEPS = [
  { p: "/university", l: { he: "למד", en: "Learn" }, Icon: BookOpen },
  { p: "/exchange", l: { he: "חבר בורסה", en: "Connect" }, Icon: ArrowLeftRight },
  { p: "/profit", l: { he: "מנוע מסחר", en: "Profit" }, Icon: TrendingUp },
] as const;

export default function StepsWidget() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: C.faint }}>{lang === "he" ? "צעדים" : "Steps"}</span>
      {STEPS.map((s, i) => (
        <React.Fragment key={s.p}>
          <button onClick={() => nav(s.p)}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`,
              color: C.text, borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ width: 16, height: 16, borderRadius: "50%", background: `${C.gold}22`, color: C.gold, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800 }}>{i + 1}</span>
            <s.Icon size={12} color={C.gold} /> {s.l[lang]}
          </button>
          {i < STEPS.length - 1 && <ChevronRight size={12} color={C.faint} style={{ transform: rtl ? "scaleX(-1)" : "none" }} />}
        </React.Fragment>
      ))}
    </div>
  );
}
