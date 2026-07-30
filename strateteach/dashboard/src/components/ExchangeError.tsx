import React from "react";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { mapExchangeError } from "../lib/exchangeErrors";

// Shows an exchange order error as clear, actionable guidance (mapExchangeError), with the
// RAW rejection tucked into a small "details" expander for debugging. Use anywhere an
// exchange order/close error surfaces inline. DISPLAY ONLY.
export default function ExchangeErrorText({ raw, style, color }: { raw: string; style?: React.CSSProperties; color?: string }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const m = mapExchangeError(raw, he);
  const showRaw = m.mapped && m.raw && m.raw.trim() !== m.friendly.trim();
  return (
    <div style={{ minWidth: 0, ...style }}>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: color || C.text, wordBreak: "break-word" }}>{m.friendly}</div>
      {showRaw && (
        <details style={{ marginTop: 3 }}>
          <summary style={{ cursor: "pointer", fontSize: 10.5, color: C.faint, listStyle: "none" }}>
            {he ? "פרטים טכניים" : "Technical details"}
          </summary>
          <code style={{ display: "block", fontSize: 10, color: C.muted, fontFamily: MONO, wordBreak: "break-word", marginTop: 3, direction: "ltr", textAlign: "left" }}>
            {m.raw}
          </code>
        </details>
      )}
    </div>
  );
}
