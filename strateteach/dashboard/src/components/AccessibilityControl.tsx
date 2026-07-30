import React, { useEffect, useRef, useState } from "react";
import { Accessibility, Minus, Plus, Contrast, Gauge, Check, X } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI, loadThemePrefs, applyThemePrefs, type ThemePrefs } from "../theme";
import { track } from "../lib/analytics";

// ── ♿ Accessibility control — a small top-bar icon that opens an INLINE panel with
//   • text size (A− / A+)     → prefs.fontScale (root font-size %, NO zoom)
//   • high contrast (toggle)  → prefs.contrast  (boosts every C.* token, actually works)
//   • reduce motion (toggle)  → prefs.reduceMotion (opt-in CSS class, motion-only)
//
// SAFETY (the previous accessibility widget froze the whole site and was reverted):
// this panel is a normal in-flow dropdown anchored under its button — NO full-screen
// fixed scrim, NO high z-index blocker, NO `zoom`, NO global `!important` added here.
// It closes on an outside click via a lightweight document listener (no overlay
// element), so nothing can ever cover the page or trap clicks. Every change persists
// through applyThemePrefs + fires the existing "algo770-theme" event so the whole app
// re-skins live (same mechanism ThemeControl uses).
const MIN_SCALE = 0.9, MAX_SCALE = 1.4, STEP = 0.1;

export default function AccessibilityControl({ compact }: { compact?: boolean }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<ThemePrefs>(() => loadThemePrefs());
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tr = (en: string, h: string) => (he ? h : en);

  function set(p: Partial<ThemePrefs>) {
    const next = { ...prefs, ...p };
    setPrefs(next);
    applyThemePrefs(next);
    window.dispatchEvent(new Event("algo770-theme"));
  }
  const scale = prefs.fontScale && prefs.fontScale > 0 ? prefs.fontScale : 1;
  const stepScale = (d: number) => set({ fontScale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((scale + d) * 10) / 10)) });

  // Close on an outside click — a plain document listener, NOT a full-screen catcher
  // element, so there is never a layer over the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const H = compact ? 30 : 34;
  const toggleRow = (active: boolean, icon: React.ReactNode, label: string, onClick: () => void) => (
    <button onClick={onClick} className="tap44"
      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: he ? "right" : "left",
        border: `1px solid ${active ? C.gold : C.line}`, background: active ? "var(--btn-bg)" : "transparent",
        color: active ? "var(--btn-ink)" : C.text, borderRadius: 10, padding: "9px 11px",
        fontSize: 13, fontWeight: 700, fontFamily: UI, cursor: "pointer" }}>
      <span style={{ display: "inline-flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {active && <Check size={15} />}
    </button>
  );

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button onClick={() => setOpen((o) => { if (!o) track("a11y_open"); return !o; })} aria-label={tr("Accessibility", "נגישות")} title={tr("Accessibility", "נגישות")}
        aria-expanded={open} className="tap44"
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: H === 30 ? 34 : 38, height: H,
          background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, cursor: "pointer" }}>
        <Accessibility size={15} color={C.gold} />
      </button>

      {open && (
        <div role="menu" dir={he ? "rtl" : "ltr"}
          style={{ position: "absolute", top: "calc(100% + 8px)", insetInlineEnd: 0, zIndex: 50,
            width: "min(280px, 86vw)", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
            padding: 14, boxShadow: "0 18px 44px -14px rgba(0,0,0,0.5)", fontFamily: UI, color: C.text }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontWeight: 800, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Accessibility size={15} color={C.gold} /> {tr("Accessibility", "נגישות")}
            </span>
            <button onClick={() => setOpen(false)} aria-label="close" className="tap44"
              style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
          </div>

          {/* Text size — A− / A+ (root font-size, no zoom) */}
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{tr("Text size", "גודל טקסט")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <button onClick={() => stepScale(-STEP)} disabled={scale <= MIN_SCALE + 1e-9} aria-label={tr("Smaller text", "טקסט קטן יותר")} className="tap44"
              style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                border: `1px solid ${C.line}`, background: "transparent", color: C.text, borderRadius: 10, padding: "9px 6px",
                fontSize: 13, fontWeight: 800, fontFamily: UI, cursor: scale <= MIN_SCALE ? "default" : "pointer", opacity: scale <= MIN_SCALE ? 0.5 : 1 }}>
              <Minus size={14} /> A
            </button>
            <span style={{ minWidth: 46, textAlign: "center", fontSize: 12.5, fontWeight: 800, color: C.muted }}>{Math.round(scale * 100)}%</span>
            <button onClick={() => stepScale(STEP)} disabled={scale >= MAX_SCALE - 1e-9} aria-label={tr("Larger text", "טקסט גדול יותר")} className="tap44"
              style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                border: `1px solid ${C.line}`, background: "transparent", color: C.text, borderRadius: 10, padding: "9px 6px",
                fontSize: 15, fontWeight: 800, fontFamily: UI, cursor: scale >= MAX_SCALE ? "default" : "pointer", opacity: scale >= MAX_SCALE ? 0.5 : 1 }}>
              <Plus size={14} /> A
            </button>
          </div>

          {/* High contrast — actually adjusts the C.* tokens app-wide */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {toggleRow(!!prefs.contrast, <Contrast size={16} color={prefs.contrast ? undefined : C.gold} />,
              tr("High contrast", "ניגודיות גבוהה"), () => set({ contrast: !prefs.contrast }))}
            {toggleRow(!!prefs.reduceMotion, <Gauge size={16} color={prefs.reduceMotion ? undefined : C.gold} />,
              tr("Reduce motion", "הפחתת תנועה"), () => set({ reduceMotion: !prefs.reduceMotion }))}
          </div>

          {(scale !== 1 || prefs.contrast || prefs.reduceMotion) && (
            <button onClick={() => set({ fontScale: 1, contrast: false, reduceMotion: false })}
              style={{ marginTop: 12, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.muted,
                borderRadius: 10, padding: "9px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: UI }}>
              {tr("Reset accessibility", "איפוס נגישות")}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
