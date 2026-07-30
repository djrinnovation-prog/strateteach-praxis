import React, { useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
import { C } from "../theme";

// One-time risk acknowledgment shown after login. Persisted in localStorage so it
// appears once per browser. Backs the trading-risk disclaimer (see /legal).
const STR = {
  he: {
    title: "אישור סיכון לפני שמתחילים",
    intro: "ALGO770 הוא כלי תוכנה — לא ייעוץ פיננסי. לפני שתמשיכו, אנא אשרו שהבנתם:",
    points: [
      "מסחר בקריפטו הוא ספקולטיבי ועלול לגרום לאובדן מלא של ההון. סחרו רק בכסף שאתם יכולים להרשות לעצמכם להפסיד.",
      "תוצאות בקטסט הן היסטוריות והיפותטיות — אינן מבטיחות רווח עתידי.",
      "אתם מאשרים כל פקודה ואחראים לכל החלטה ועסקה.",
      "המערכת לא-משמורתית: המפתחות והכספים נשארים אצלכם; איננו מחזיקים אותם.",
      "התוכנה מסופקת כמות שהיא, ללא אחריות.",
    ],
    legal: "הפרטים המלאים: תנאי השימוש וכתב הסיכון.",
    accept: "הבנתי ואני מקבל/ת את הסיכון",
    decline: "לא מסכים/ה — התנתק",
  },
  en: {
    title: "Risk acknowledgment before you start",
    intro: "ALGO770 is a software tool — not financial advice. Before continuing, please confirm you understand:",
    points: [
      "Crypto trading is speculative and can lead to total loss of capital. Only trade money you can afford to lose.",
      "Backtest results are historical and hypothetical — they do not guarantee future profit.",
      "You approve every order and are responsible for every decision and trade.",
      "The system is non-custodial: your keys and funds stay with you; we never hold them.",
      "The software is provided “as is,” without warranty.",
    ],
    legal: "Full details: Terms of Service and Risk Disclaimer.",
    accept: "I understand and accept the risk",
    decline: "I don't agree — sign out",
  },
};

export default function RiskGate({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const { lang, rtl } = useI18n();
  const t = STR[lang];
  const [checked, setChecked] = useState(false);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      background: "rgba(5,4,8,0.85)", backdropFilter: "blur(4px)", direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ width: "100%", maxWidth: 520, background: "linear-gradient(160deg, #15101f 0%, #0B0613 100%)", border: "1px solid rgba(247,181,0,0.25)", borderRadius: 20, padding: 28, boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(240,97,109,0.15)" }}>
            <AlertTriangle size={19} color={C.loss} />
          </span>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#fff" }}>{t.title}</h2>
        </div>
        <p style={{ fontSize: 13.5, color: "#cbd5e1", lineHeight: 1.6, margin: "0 0 14px" }}>{t.intro}</p>
        <ul style={{ margin: "0 0 16px", paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {t.points.map((p, i) => <li key={i} style={{ fontSize: 13, color: "#b9c6da", lineHeight: 1.55 }}>{p}</li>)}
        </ul>
        <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 16 }}>{t.legal}</div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13.5, color: "#e2e8f0", cursor: "pointer", marginBottom: 16 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
          <span>{t.accept}</span>
        </label>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={onAccept} disabled={!checked} className={checked ? "gbtn" : undefined}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: 1, justifyContent: "center", border: "none", borderRadius: 12, padding: "12px 0", fontWeight: 700, fontSize: 14,
              cursor: checked ? "pointer" : "not-allowed", color: checked ? undefined : C.faint,
              background: checked ? undefined : C.surface2 }}>
            <ShieldCheck size={16} /> {t.accept}
          </button>
          <button onClick={onDecline} style={{ background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 12, padding: "12px 16px", cursor: "pointer", fontSize: 13 }}>
            {t.decline}
          </button>
        </div>
      </div>
    </div>
  );
}
