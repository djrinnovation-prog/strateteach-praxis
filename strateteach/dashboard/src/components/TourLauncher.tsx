import React, { useEffect, useState } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import { useI18n } from "../i18n";
import { C, onAccent } from "../theme";
import CoachMarks from "./CoachMarks";
import { tourSteps, tourLabels, hasTour } from "../lib/tours";
import { TABBAR_H } from "./TabBar";

// TEMPORARY (per Dan, 2026-06-30): the per-screen "steps" / guided-tour launcher is
// unclear and is hidden app-wide for now (to be improved & restored later). Flip this
// single flag back to `true` to bring every entry point back — the underlying tour
// code (CoachMarks, lib/tours.ts, the data-tour anchors) is untouched.
const SHOW_STEPS = false;

// Floating guided-tour launcher — reused on EVERY screen. Pass `screen` (a key in
// the tour registry, lib/tours.ts) and it renders a discreet pill that starts THAT
// screen's coach-marks tour (the reusable CoachMarks, spotlighting the real
// data-tour anchors one by one). If the screen has no tour yet it renders nothing
// (no dead button). Skin-tokened, RTL-aware; closes via ✕ / backdrop / Esc.
//
// Home keeps its richer chooser modal (with the "open the full /media tour" link);
// every other screen starts its tour directly on tap.
export default function TourLauncher({ screen = "home", hidePill = false }: { screen?: string; hidePill?: boolean }) {
  const [open, setOpen] = useState(false);   // chooser modal (home only)
  const [tour, setTour] = useState(false);   // coach-marks running
  const mobile = useIsMobile();
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const isHome = screen === "home";

  const ink = onAccent(C.gold);
  const accentFill = `linear-gradient(135deg, ${C.accent}, ${C.gold})`;

  // Esc closes the chooser modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // External trigger: the first-run WelcomeOnboarding's "Take the tour" CTA fires
  // `algo770-start-tour` to hand off into THIS coach-marks tour. Each screen's
  // launcher only responds to its own screen (detail.screen), so the Home tour
  // starts for the Home handoff and others stay quiet.
  useEffect(() => {
    const onStart = (e: Event) => {
      const want = (e as CustomEvent).detail?.screen || "home";
      if (want === screen && hasTour(screen)) { setOpen(false); setTour(true); }
    };
    window.addEventListener("algo770-start-tour", onStart as EventListener);
    return () => window.removeEventListener("algo770-start-tour", onStart as EventListener);
  }, [screen]);

  // Cross-screen handoff (no event-timing race): another screen (e.g. the beginner guide)
  // can request THIS screen's tour by setting sessionStorage before navigating here — we
  // pick it up on mount, so it works reliably even though the requesting screen unmounts.

  // No tour defined for this screen → nothing to mount.
  if (!hasTour(screen)) return null;
  // NOTE: SHOW_STEPS only hides the VISIBLE entry points (the floating pill + Home
  // chooser) per Dan — it must NOT block an event-LAUNCHED tour. The beginner guide's
  // "screen tour" button fires `algo770-start-tour`, which sets `tour` → the CoachMarks
  // below still render. (The pill/chooser stay gated on SHOW_STEPS just below.)

  const steps = tourSteps(screen, he);
  const labels = tourLabels(he);

  const startTour = () => { setOpen(false); setTour(true); };
  // Home opens the chooser (it has the extra full-tour link); others start directly.
  const onPill = () => (isHome ? setOpen(true) : setTour(true));

  // Placement: Home sits bottom-LEFT (clear of its springboard). Inner screens sit
  // bottom-RIGHT — the bottom-left corner there is taken by the Music rail; the
  // inline-end Activity/Profit drawer tab is mid-height, so this corner stays clear.
  // On MOBILE the persistent bottom tab bar (TabBar, height TABBAR_H) owns the very
  // bottom edge, so the pill is raised ABOVE it (+ iOS safe-area + a small margin)
  // — otherwise it would sit on top of the leftmost tab. Desktop has no tab bar
  // (the left sidebar fills that role), so the original low offset is kept there.
  const liftBottom = `calc(${TABBAR_H}px + env(safe-area-inset-bottom, 0px) + 10px)`;
  const pos: React.CSSProperties = isHome
    ? { left: mobile ? 10 : 20, bottom: mobile ? liftBottom : 24 }
    : { insetInlineEnd: mobile ? 10 : 18, bottom: mobile ? liftBottom : 20 };

  return (
    <>
      {/* discreet floating pill — hidden app-wide (SHOW_STEPS=false, per Dan) and also
          when `hidePill`. The event listener + CoachMarks below still run, so the tour
          itself keeps working (e.g. launched from the beginner guide). */}
      {SHOW_STEPS && !hidePill && (
      <button onClick={onPill} aria-label={he ? "פתח סיור מודרך" : "Open the guided tour"}
        style={{ position: "fixed", zIndex: 60, ...pos,
          display: "inline-flex", alignItems: "center", gap: mobile ? 6 : 8, cursor: "pointer", fontFamily: "inherit",
          border: "none", borderRadius: 999, padding: mobile ? "6px 11px" : "10px 16px",
          fontSize: mobile ? 11 : 13, fontWeight: 800, color: ink, opacity: 0.94,
          background: accentFill, boxShadow: "0 8px 20px -10px rgba(0,0,0,0.45)" }}>
        <span style={{ width: mobile ? 17 : 20, height: mobile ? 17 : 20, borderRadius: "50%", background: ink, color: C.gold,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: mobile ? 8.5 : 10, flex: "0 0 auto" }}>?</span>
        {mobile ? (he ? "סיור" : "Tour") : (he ? "סיור מודרך" : "Take a tour")}
      </button>
      )}

      {SHOW_STEPS && open && isHome && (
        // Backdrop — tapping outside the card closes it.
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 18, direction: rtl ? "rtl" : "ltr" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ position: "relative", width: "100%", maxWidth: 380, maxHeight: "82vh", overflowY: "auto",
              background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "24px 20px 22px", textAlign: "center",
              boxShadow: "0 20px 60px -16px rgba(0,0,0,0.55)" }}>
            <button onClick={() => setOpen(false)} aria-label={he ? "סגור" : "Close"}
              style={{ position: "absolute", top: 10, insetInlineEnd: 10, width: 40, height: 40, borderRadius: "50%",
                background: C.surface2, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer", fontSize: 19, lineHeight: 1 }}>✕</button>
            <div style={{ width: 58, height: 58, borderRadius: "50%", margin: "4px auto 14px", background: accentFill,
              display: "flex", alignItems: "center", justifyContent: "center", color: ink, fontSize: 23 }}>▶</div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 17, marginBottom: 8 }}>{he ? "סיור מודרך" : "Guided tour"}</div>
            <div style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.5, marginBottom: 18 }}>
              {he ? "סיור קצר שמסביר את מסך הבית — חלק אחר חלק. אפשר לדלג בכל רגע." : "A quick walkthrough of the Home screen — one part at a time. Skip anytime."}
            </div>
            <button onClick={startTour}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "none", cursor: "pointer", fontFamily: "inherit",
                background: accentFill, color: ink, fontWeight: 900, fontSize: 14, borderRadius: 999, padding: "11px 22px", marginBottom: 12 }}>
              {he ? "התחל סיור" : "Take the tour"}
            </button>
            <div>
              <a href="/media/home-tour.html" target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}
                style={{ color: C.gold, fontWeight: 700, fontSize: 12.5, textDecoration: "none" }}>
                {he ? "פתח את הסיור המלא ↗" : "Open the full tour ↗"}
              </a>
            </div>
          </div>
        </div>
      )}

      <CoachMarks steps={steps} open={tour} onClose={() => setTour(false)} rtl={rtl} labels={labels} />
    </>
  );
}
