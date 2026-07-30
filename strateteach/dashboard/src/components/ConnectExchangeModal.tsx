import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Plug, X } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

// Connect-exchange POPUP — shown ONLY when a user opts into LIVE (flips the Demo/Live
// toggle to Live, or starts a live session) without an exchange connected in this browser.
// Replaces the old always-on floating banner: a user who isn't going live never sees it.
// Branded skin + glass, dismissible (backdrop · Escape · X), CTA → the Exchange › Connect screen.
export default function ConnectExchangeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const { rtl, lang } = useI18n();
  const he = lang === "he";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = () => { onClose(); nav("/exchange?sec=connect"); };

  return createPortal(
    <div onClick={onClose} dir={rtl ? "rtl" : "ltr"}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div role="dialog" aria-modal="true" aria-label={he ? "חיבור בורסה למסחר חי" : "Connect an exchange for live trading"}
        onClick={(e) => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"}
        style={{ width: "min(420px, 94vw)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
          background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1.5px solid ${C.gold}`,
          borderRadius: 18, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI, color: C.text }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px",
          borderBottom: `1px solid ${C.line}`, background: `linear-gradient(135deg, ${C.gold}26, ${C.gold}0f), transparent` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0, fontSize: 15.5, fontWeight: 900 }}>
            <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: `linear-gradient(140deg, ${C.gold}, ${C.loss})`, color: "#1a1206" }}><Plug size={16} /></span>
            {he ? "מסחר חי — חברו בורסה" : "Live trading — connect an exchange"}
          </span>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30,
              borderRadius: 9, background: "none", border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer" }}>
            <X size={15} />
          </button>
        </div>
        {/* body */}
        <div style={{ padding: "16px", textAlign: rtl ? "right" : "left" }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: C.text }}>
            {he
              ? "כדי לסחור בכסף אמיתי צריך לחבר בורסה. אין בורסה מחוברת בדפדפן הזה — אפשר להמשיך בדמו, או לחבר בורסה כדי לעבור ללייב."
              : "Live trading needs a connected exchange. No exchange is connected in this browser — you can keep using Demo, or connect an exchange to go live."}
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 11.5, lineHeight: 1.5, color: C.muted }}>
            {he
              ? "המפתחות נשמרים מקומית בלבד (לא-משמורתי)."
              : "Your keys are stored locally only (non-custodial)."}
          </p>
          <div style={{ display: "flex", gap: 9, marginTop: 18, flexWrap: "wrap" }}>
            <button onClick={go} className="gbtn ptile"
              style={{ flex: 1, minWidth: 150, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                background: "var(--btn-bg)", border: "1.5px solid var(--btn-bd)", color: "var(--btn-ink)", borderRadius: 12,
                padding: "11px 14px", fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: UI,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 9px 22px -13px rgba(0,0,0,0.4)" }}>
              <Plug size={15} /> {he ? "חברו בורסה" : "Connect exchange"}
            </button>
            <button onClick={onClose}
              style={{ flexShrink: 0, background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 12,
                padding: "11px 16px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
              {he ? "נשאר בדמו" : "Stay on Demo"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
