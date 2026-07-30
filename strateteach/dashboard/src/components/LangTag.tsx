import React from "react";
import { Globe } from "lucide-react";
import { useI18n } from "../i18n";
import { C } from "../theme";

// Small language tag widget — shown on every screen so the user can flip
// He/En from anywhere (not just the sidebar).
export default function LangTag() {
  const { lang, setLang } = useI18n();
  return (
    <button onClick={() => setLang(lang === "he" ? "en" : "he")} aria-label="language"
      style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`,
        color: C.text, borderRadius: 999, padding: "5px 11px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
      <Globe size={12} color={C.gold} /> {lang === "he" ? "עברית" : "English"}
    </button>
  );
}
