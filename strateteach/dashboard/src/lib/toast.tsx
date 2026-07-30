import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, LifeBuoy } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

// ── Global honest-status / honest-error TOAST ───────────────────────────────────
// A single, app-wide, NON-BLOCKING toast stack (never a full-screen scrim/freeze):
// small dismissible cards at the bottom, portalled to <body>, pointer-events only on
// the cards themselves. Used for the financial-safety layer's ongoing status
// ("Processing / Order pending") and its honest error states (what happened · are the
// funds safe · next step · a support path to the Help Portal). Skin-aware (C.*), Rubik,
// ≥44px targets, a11y: error = role="alert"/assertive, others = role="status"/polite.
//
// Fire from anywhere (including react-query onError) via the module helpers below —
// no context/provider needed; <ToastHost/> is mounted once at the app root.

export type ToastKind = "error" | "success" | "info" | "pending";
export type ToastInput = {
  id?: string;
  kind: ToastKind;
  title: string;             // WHAT happened (already localised by the caller)
  body?: string;             // extra line: the next step / detail (already localised)
  fundsSafe?: boolean;       // money errors: append the localised "funds unchanged" line
  support?: boolean;         // show the "Get help" CTA → /requests (Help Portal)
  duration?: number | null;  // ms auto-dismiss; null = sticky until dismissed/replaced
};
type Toast = ToastInput & { id: string };

let idc = 0;
type Action = "add" | "remove";
type Listener = (t: Toast, a: Action) => void;
const listeners = new Set<Listener>();

// Push (or replace, when reusing an id) a toast. Returns the id so a "pending" toast
// can later be replaced by its success/error resolution (same id).
export function pushToast(input: ToastInput): string {
  const id = input.id || `t${++idc}`;
  const duration = input.duration !== undefined
    ? input.duration
    : input.kind === "error" ? null : input.kind === "pending" ? null : 4200;
  const t: Toast = { ...input, id, duration };
  listeners.forEach((l) => l(t, "add"));
  return id;
}
export function dismissToast(id: string) {
  listeners.forEach((l) => l({ id, kind: "info", title: "" }, "remove"));
}

// Convenience helpers — money errors default to fundsSafe + support (the honest layer).
export function toastError(title: string, opts?: { body?: string; fundsSafe?: boolean; support?: boolean; id?: string; duration?: number | null }) {
  return pushToast({ kind: "error", title, fundsSafe: opts?.fundsSafe ?? true, support: opts?.support ?? true, body: opts?.body, id: opts?.id, duration: opts?.duration });
}
export function toastPending(title: string, id?: string, body?: string) {
  return pushToast({ kind: "pending", title, id, body, duration: null });
}
export function toastSuccess(title: string, body?: string, id?: string) {
  return pushToast({ kind: "success", title, body, id });
}
export function toastInfo(title: string, body?: string, id?: string) {
  return pushToast({ kind: "info", title, body, id });
}

const META: Record<ToastKind, { Icon: React.FC<any>; color: () => string }> = {
  error:   { Icon: AlertTriangle, color: () => C.loss },
  success: { Icon: CheckCircle2,  color: () => C.gain },
  info:    { Icon: Info,          color: () => C.gold },
  pending: { Icon: Loader2,       color: () => C.gold },
};

export default function ToastHost() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const l: Listener = (t, action) => {
      if (action === "remove") { setItems((p) => p.filter((x) => x.id !== t.id)); return; }
      setItems((prev) => [...prev.filter((x) => x.id !== t.id), t].slice(-4)); // cap the stack at 4
      if (t.duration != null) setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), t.duration);
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  if (items.length === 0) return null;

  return createPortal(
    <div aria-live="polite" dir={rtl ? "rtl" : "ltr"}
      style={{ position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, bottom: "calc(env(safe-area-inset-bottom, 0px) + 74px)",
        zIndex: 3000, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "0 12px", pointerEvents: "none" }}>
      {items.map((t) => {
        const m = META[t.kind]; const col = m.color();
        return (
          <div key={t.id} role={t.kind === "error" ? "alert" : "status"} aria-live={t.kind === "error" ? "assertive" : "polite"}
            style={{ pointerEvents: "auto", width: "min(460px, 100%)", background: C.surface,
              border: `1px solid ${col}66`, borderInlineStart: `4px solid ${col}`, borderRadius: 14,
              boxShadow: "0 14px 40px -12px rgba(0,0,0,0.5)", fontFamily: UI, overflow: "hidden",
              animation: "a770toastIn .22s cubic-bezier(.22,.61,.36,1) both" }}>
            <style>{"@keyframes a770toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}"}</style>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px" }}>
              <span style={{ flexShrink: 0, marginTop: 1, color: col }}>
                <m.Icon size={18} className={t.kind === "pending" ? "spin" : undefined} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, lineHeight: 1.35 }}>{t.title}</div>
                {t.body && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{t.body}</div>}
                {t.fundsSafe && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.gain, lineHeight: 1.5, marginTop: 3 }}>
                    {he ? "הכספים נשארו בחשבונך." : "Your funds are unchanged."}
                  </div>
                )}
                {t.support && (
                  <button onClick={() => { nav("/requests"); dismissToast(t.id); }} className="tap44"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, background: C.surface2,
                      border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "7px 12px",
                      fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
                    <LifeBuoy size={14} color={C.gold} /> {he ? "קבלת עזרה מהתמיכה" : "Get help from support"}
                  </button>
                )}
              </div>
              <button onClick={() => dismissToast(t.id)} aria-label={he ? "סגור" : "Dismiss"} className="tap44"
                style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 2 }}>
                <X size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  );
}
