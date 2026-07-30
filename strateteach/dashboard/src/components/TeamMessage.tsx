import React from "react";
import { Diamond } from "lucide-react";
import { C, UI, SHADOW } from "../theme";
import { useI18n } from "../i18n";

// The SINGLE source of truth for a team → user message document: the admin composer
// previews this exact component, and the user's inbox renders the exact same one, so
// "what you preview is what they get". Skin-aware (C.*) and RTL-correct.
//
// Layout (top → bottom):
//   1) branded header band — STRATETEACH wordmark + "A message from the team"
//   2) a FIXED "About us" block (standard, NOT edited per message)
//   3) the message title (if any) + the body, with line breaks preserved.

// Fixed "About us" copy — identical on every message (never edited per-send).
const ABOUT_HE = "Strateteach — פלטפורמת מסחר אלגוריתמי שסורקת שווקים ומציפה הזדמנויות לפי אסטרטגיות מובנות (קריפטו · מניות · מתכות/סחורות). מצב דמו = סימולציה.";
const ABOUT_EN = "Strateteach — an algorithmic trading platform that scans markets and surfaces opportunities using built-in strategies (crypto · stocks · metals/commodities). Demo mode = simulation.";

export default function TeamMessage({ title, body, sender, date }: {
  title?: string | null; body: string; sender?: string; date?: string;
}) {
  const { lang } = useI18n();
  const rtl = lang === "he";
  let dateStr = "";
  if (date) {
    try { dateStr = new Date(date).toLocaleString(rtl ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }); }
    catch { dateStr = date; }
  }

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
      overflow: "hidden", fontFamily: UI, boxShadow: SHADOW }}>
      {/* 1) branded header band */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "14px 16px",
        background: `linear-gradient(135deg, ${C.gold}, ${C.accent} 55%, ${C.blue})` }}>
        <div style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center",
          justifyContent: "center", background: "rgba(255,255,255,0.20)" }}>
          <Diamond size={18} color="#fff" fill="#fff" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 900, letterSpacing: "0.16em", color: "#fff" }}>STRATETEACH</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.92)", marginTop: 1 }}>
            הודעה מהצוות · A message from the team
          </div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* 2) fixed "About us" block */}
        <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, letterSpacing: "0.04em", marginBottom: 5 }}>
            מי אנחנו · About us
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{ABOUT_HE}</div>
          <div dir="ltr" style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.5, marginTop: 6, textAlign: "left" }}>{ABOUT_EN}</div>
        </div>

        {/* sender / date line (shown when provided — i.e. the user view) */}
        {(sender || dateStr) && (
          <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 10 }}>
            {sender ? (rtl ? `מאת: ${sender}` : `From: ${sender}`) : ""}
            {sender && dateStr ? " · " : ""}
            {dateStr}
          </div>
        )}

        {/* 3) message title (if any) + body with line breaks preserved */}
        {title ? <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 8, lineHeight: 1.35 }}>{title}</div> : null}
        <div style={{ fontSize: 14, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {body || <span style={{ color: C.faint }}>{rtl ? "(אין תוכן עדיין)" : "(no content yet)"}</span>}
        </div>
      </div>
    </div>
  );
}
