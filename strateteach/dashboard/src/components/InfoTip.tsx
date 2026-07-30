import React, { useState } from "react";
import { Info } from "lucide-react";
import { C } from "../theme";

// ── (i) info affordance ───────────────────────────────────────────────────────
// A small circular "i" that reveals a compact explainer popover on HOVER (desktop)
// or TAP (mobile). STRICTLY display-only — it never triggers any action, so it's
// safe to sit right next to a real-money button. Rendered as a SIBLING of the
// button (an HTML button can't nest another button), anchored above the icon so it
// never gets clipped by the panel's bottom edge. RTL-aware.
export default function InfoTip({
  title, lines, he, rtl, align = "end",
}: {
  title?: string;
  lines: React.ReactNode[];
  he: boolean;
  rtl?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const isRtl = rtl ?? he;
  // Which horizontal edge the popover pins to (default: inline-end, so it hugs the
  // side the buttons sit on and grows inward).
  const pin: React.CSSProperties = align === "end" ? { insetInlineEnd: 0 } : { insetInlineStart: 0 };
  return (
    <span
      style={{ position: "relative", display: "inline-flex", lineHeight: 0 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={he ? "הסבר" : "Info"}
        aria-expanded={open}
        style={{
          width: 20, height: 20, minWidth: 20, borderRadius: "50%", flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: open ? `${C.gold}22` : C.surface2, border: `1px solid ${open ? C.gold : C.line}`,
          color: open ? C.gold : C.muted, cursor: "pointer", padding: 0,
        }}
      >
        <Info size={12} />
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", ...pin, zIndex: 60,
            width: "max-content", maxWidth: "min(280px, 78vw)",
            textAlign: isRtl ? "right" : "left", direction: isRtl ? "rtl" : "ltr",
            background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
            boxShadow: "0 14px 34px -12px rgba(0,0,0,0.6)", padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 5, whiteSpace: "normal",
          }}
        >
          {title && (
            <span style={{ fontSize: 12, fontWeight: 900, color: C.text }}>{title}</span>
          )}
          {lines.map((l, i) => (
            <span key={i} style={{ fontSize: 11.5, lineHeight: 1.5, color: C.muted }}>{l}</span>
          ))}
        </span>
      )}
    </span>
  );
}
