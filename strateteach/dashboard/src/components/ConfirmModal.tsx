import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X, Loader2, CheckCircle2, ShieldAlert } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { track } from "../lib/analytics";

// ── ConfirmModal — the financial-safety confirm gate for REAL-money actions ──────
// A proper centred dialog: dismissible backdrop (Cancel · Escape · backdrop click),
// focus-trapped, role="dialog". Portals to <body> so a transformed ancestor can't
// clip/collapse it (same reason HelpPortal does). It NEVER becomes a stuck scrim —
// every non-busy state can be dismissed. Skin-aware via C.* in all 4 skins; Rubik.
//
// It's additive: `onConfirm` runs the caller's EXISTING action unchanged. The modal
// only adds a preview + an honest status flow around it (Processing → Done, or the
// honest failure line "the action was not completed; your funds are unchanged").

// `emphasis` (opt-in) renders the value larger/bolder — for the ONE hero figure of a gate
// (e.g. the real-money allocation). Omitted rows render exactly as before (backward-compatible).
export type ConfirmRow = { label: string; value: React.ReactNode; color?: string; emphasis?: boolean };

export default function ConfirmModal({
  title, intro, rows, risk, confirmLabel, cancelLabel, tone = "primary", onConfirm, onClose,
}: {
  title: string;
  intro?: React.ReactNode;
  rows?: ConfirmRow[];
  risk?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "gain" | "loss";
  onConfirm: () => Promise<any> | any;   // resolves on success; throws/rejects on failure
  onClose: () => void;
}) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "error">("idle");
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus the SAFE default (Cancel) when the dialog opens.
  useEffect(() => { const id = setTimeout(() => cancelRef.current?.focus(), 30); return () => clearTimeout(id); }, []);
  // Trust KPI: a confirm gate was shown for a real-money action.
  useEffect(() => { track("confirm_modal_shown"); }, []);

  // Escape closes (only when not mid-flight); Tab is trapped inside the dialog so
  // focus never escapes to the page behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "busy") { e.preventDefault(); onClose(); return; }
      if (e.key === "Tab") {
        const root = dialogRef.current; if (!root) return;
        const f = Array.from(root.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        )).filter((el) => el.offsetParent !== null);
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  const doConfirm = async () => {
    if (phase === "busy" || phase === "done") return;   // guard against double-submit
    track("confirm_modal_confirmed");
    setPhase("busy");
    try { await onConfirm(); setPhase("done"); track("transaction_status_viewed", { result: "done" }); setTimeout(onClose, 1000); }
    catch (_e) { setPhase("error"); track("transaction_status_viewed", { result: "error" }); }
  };

  const confirmClass = tone === "loss" ? "gbtn gbtn-loss tap44" : tone === "gain" ? "gbtn gbtn-gain tap44" : "gbtn tap44";
  const dismiss = () => {
    if (phase === "busy") return;
    if (phase === "idle" || phase === "error") track("confirm_modal_cancelled");  // closed WITHOUT completing
    onClose();
  };

  return createPortal(
    <div onClick={dismiss}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} dir={rtl ? "rtl" : "ltr"}
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(440px, 94vw)", maxWidth: "100%", maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
          background: C.surface, border: `1.5px solid ${C.gold}`, borderRadius: 18,
          boxShadow: "0 28px 80px rgba(0,0,0,0.6)", fontFamily: UI, overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px",
          borderBottom: `1px solid ${C.line}`, background: `linear-gradient(135deg, ${C.gold}26, ${C.gold}0f), ${C.surface}` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0, fontSize: 15.5, fontWeight: 900, color: C.text }}>
            <ShieldAlert size={18} color={C.gold} style={{ flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>{title}</span>
          </span>
          <button ref={cancelRef} onClick={dismiss} disabled={phase === "busy"} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: phase === "busy" ? "default" : "pointer", opacity: phase === "busy" ? 0.5 : 1 }}>
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {intro && <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>{intro}</div>}

          {rows && rows.length > 0 && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, background: C.surface2, overflow: "hidden" }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                  padding: r.emphasis ? "12px 13px" : "10px 13px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>{r.label}</span>
                  <span style={{ fontSize: r.emphasis ? 18 : 13.5, fontWeight: r.emphasis ? 900 : 800, color: r.color || C.text, textAlign: rtl ? "left" : "right", letterSpacing: r.emphasis ? "-0.01em" : undefined }}>{r.value}</span>
                </div>
              ))}
            </div>
          )}

          {risk && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.5,
              color: C.text, background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
              <AlertTriangle size={15} color={C.loss} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{risk}</span>
            </div>
          )}

          {/* honest status line */}
          {phase === "busy" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: C.muted }}>
              <Loader2 size={15} className="spin" /> {he ? "בעיבוד…" : "Processing…"}
            </div>
          )}
          {phase === "done" && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: C.gain }}>
              <CheckCircle2 size={16} /> {he ? "הפעולה בוצעה" : "Done"}
            </div>
          )}
          {phase === "error" && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5, fontWeight: 700,
              color: C.loss, background: `${C.loss}12`, border: `1px solid ${C.loss}55`, borderRadius: 10, padding: "9px 12px" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{he ? "הפעולה לא בוצעה. הכספים נשארו בחשבונך." : "The action was not completed. Your funds are unchanged."}</span>
            </div>
          )}

          {/* actions */}
          <div style={{ display: "flex", gap: 10, marginTop: 2, flexDirection: rtl ? "row-reverse" : "row" }}>
            <button onClick={doConfirm} disabled={phase === "busy" || phase === "done"} className={confirmClass}
              style={{ flex: "1.4 1 0", minHeight: 46, borderRadius: 12, border: "none", fontFamily: UI, fontSize: 14.5, fontWeight: 900,
                cursor: (phase === "busy" || phase === "done") ? "default" : "pointer", opacity: (phase === "busy" || phase === "done") ? 0.6 : 1,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {phase === "busy" ? <Loader2 size={16} className="spin" /> : null}
              {phase === "error" ? (he ? "נסה שוב" : "Try again") : confirmLabel}
            </button>
            <button onClick={dismiss} disabled={phase === "busy"} className="tap44"
              style={{ flex: "1 1 0", minHeight: 46, borderRadius: 12, background: C.surface2, color: C.text,
                border: `1px solid ${C.line}`, fontFamily: UI, fontSize: 14, fontWeight: 800,
                cursor: phase === "busy" ? "default" : "pointer", opacity: phase === "busy" ? 0.6 : 1 }}>
              {phase === "done" ? (he ? "סגור" : "Close") : (cancelLabel || (he ? "ביטול" : "Cancel"))}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
