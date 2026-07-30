import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C, onAccent } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";

export type CoachStep = { target: string; title: string; body: string };
export type CoachLabels = { next: string; back: string; skip: string; done: string };

type Rect = { top: number; left: number; width: number; height: number };

const DEFAULT_LABELS: CoachLabels = { next: "Next", back: "Back", skip: "Skip", done: "Done" };

// Resolve a data-tour id to the element to spotlight. `data-tour="<id>"` should be unique,
// but guard anyway: if several match, pick the one with the largest area actually visible
// in the viewport (skip display:none/off-screen instances) so the spotlight locks onto the
// tile the user is looking at, not whichever happens to come first in the DOM.
//
// CRITICAL: validate EVERY match (not just when there are several) for being actually
// rendered + non-zero size. A tour anchor can be present in the DOM yet have NOTHING to
// spotlight — e.g. the Home / Profit "Live open positions" wrapper `<div data-tour=...>`
// stays mounted but its child (PositionsWidget) returns null when no exchange is connected,
// leaving an empty 0×0 box; likewise a collapsed card with no laid-out content. If we
// returned that box the spotlight would lock onto an invisible point. Returning null
// instead lets the caller fall back to its centred-bubble explanation — so the spotlight
// NEVER lands on nothing.
function pickTarget(sel: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${sel}"]`));
  if (els.length === 0) return null;
  const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
  let best: HTMLElement | null = null, bestScore = 0;
  for (const e of els) {
    // Not actually rendered? Skip it. offsetParent===null ⇒ a display:none subtree (a
    // position:fixed node legitimately has none too, so exempt those); a 0×0 box ⇒ the
    // anchor exists but its content rendered null / is collapsed to nothing.
    if (e.offsetParent === null && getComputedStyle(e).position !== "fixed") continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const iw = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const ih = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const onScreen = iw * ih;                    // visible (on-screen) area right now
    // Prefer the largest on-screen instance; but an element that's merely scrolled out
    // of view (onScreen===0) is still a valid target — the caller scrolls it to centre
    // next — so give it a tiny positive score so it still beats "nothing". Genuinely
    // hidden / zero-size elements were already skipped above.
    const score = onScreen > 0 ? onScreen : 1e-3;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;   // null → target hidden/absent → CoachMarks centres the bubble
}

// Does any ancestor of `el` establish a stacking/containing context that would CONFINE the
// element's giant box-shadow spread (transform / filter / perspective / will-change / contain,
// opacity<1, position:fixed|sticky)? When one exists, the element's own `0 0 0 9999px` dim is
// clipped to that ancestor's box — areas outside it stay un-dimmed — so we additionally paint a
// single light full-screen scrim as a baseline dim. (The PRIMARY highlight is always the element's
// own box-shadow, which is perfectly aligned regardless.)
function hasStackingContextAncestor(el: HTMLElement | null): boolean {
  let p = el?.parentElement || null;
  while (p && p !== document.body && p !== document.documentElement) {
    const s = getComputedStyle(p);
    if (
      (s.transform && s.transform !== "none") ||
      (s.filter && s.filter !== "none") ||
      (s.perspective && s.perspective !== "none") ||
      (s.willChange && /transform|filter|opacity/.test(s.willChange)) ||
      (s.contain && /paint|layout|strict|content/.test(s.contain)) ||
      (s.opacity !== "" && parseFloat(s.opacity) < 1) ||
      s.position === "fixed" || s.position === "sticky"
    ) return true;
    p = p.parentElement;
  }
  return false;
}

// Z-index layers. The light baseline scrim + transparent tap-shield are body-level position:fixed;
// the spotlight is the TARGET ELEMENT itself, lifted just above the shield so its box-shadow paints
// over the dim. The bubble floats on top.
const Z_SCRIM   = 2147483600;   // optional light baseline dim (only when a stacking ancestor confines the element shadow)
const Z_SHIELD  = 2147483630;   // transparent full-screen click-catcher (tap = close)
const Z_TARGET  = 2147483635;   // the lifted target element (its box-shadow IS the ring + dim)
const Z_BUBBLE  = 2147483642;

// Strength of the element's own giant box-shadow dim (everything OUTSIDE the element) and of the
// optional light baseline scrim.
const DIM_ELEM  = 0.6;
const DIM_SCRIM = 0.25;

// Reusable coach-marks guided tour — NO external deps. For each step it resolves the target by
// `data-tour="<id>"`, scrolls it to centre, then paints the spotlight by styling the TARGET ELEMENT
// DIRECTLY: a multi-layer box-shadow whose front layers form a high-contrast ring (white inner
// outline + dark halo + accent band + soft glow) and whose LAST layer is a huge `0 0 0 9999px` dark
// spread that dims the whole viewport except the element itself. A skin-tokened explanation bubble
// floats beside it. Next / Back / Skip + a 1/N progress row. RTL-aware; closes on ✕, Esc, or a tap.
//
// WHY style the element (not a separate positioned overlay): a box-shadow is ALWAYS rendered at the
// element's true on-screen position. There is no getBoundingClientRect, no zoom math, no scroll-timing
// race — so the ring/dim can NEVER drift on real mobile (the failure mode of the coordinate-positioned
// overlay in 43123b3). The element's original inline styles are saved before we override and restored
// on step change / close / unmount (React cleanup runs before the next effect, so the save→apply order
// is preserved). Only the explanation bubble uses getBoundingClientRect — and only for rough placement,
// where a few px of drift is harmless.
export default function CoachMarks({ steps, open, onClose, rtl = false, labels }: {
  steps: CoachStep[]; open: boolean; onClose: () => void; rtl?: boolean; labels?: CoachLabels;
}) {
  const mobile = useIsMobile();
  const L = labels || DEFAULT_LABELS;
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);   // target box (ONLY for bubble placement)
  const [scrim, setScrim] = useState(false);             // paint the light baseline scrim this step?
  const bubbleRef = useRef<HTMLDivElement | null>(null); // the rendered bubble (for true-width clamp)
  const [bubbleW, setBubbleW] = useState(0);             // ACTUAL on-screen bubble width (px)

  // ── Guaranteed-teardown bookkeeping ──────────────────────────────────────────
  // The spotlight is painted by mutating the TARGET ELEMENT's inline styles (z-index +
  // giant dim box-shadow). If that mutation is ever left applied — header buried under
  // the 9999px dim, page un-tappable — the screen looks stuck. So we track the styled
  // element + its saved styles in refs and tear them down through ONE idempotent path
  // (clearSpotlight) that runs on EVERY exit: step change, Done, Skip/✕, Esc, backdrop
  // tap, AND unmount/navigation. We also remember the scroll position at open so the
  // per-step scrollIntoView never strands the page scrolled-down with the header gone.
  type Saved = { position: string; zIndex: string; boxShadow: string; borderRadius: string; transition: string };
  const styledElRef = useRef<HTMLElement | null>(null);
  const savedStylesRef = useRef<Saved | null>(null);
  const startScrollRef = useRef<{ x: number; y: number } | null>(null);

  // Restore the spotlighted element's inline styles exactly as we found them, then forget
  // it. Idempotent: safe to call from multiple cleanup paths and on an already-cleared el.
  const clearSpotlight = () => {
    const el = styledElRef.current;
    const saved = savedStylesRef.current;
    if (el && saved) {
      el.style.position = saved.position;
      el.style.zIndex = saved.zIndex;
      el.style.boxShadow = saved.boxShadow;
      el.style.borderRadius = saved.borderRadius;
      el.style.transition = saved.transition;
    }
    styledElRef.current = null;
    savedStylesRef.current = null;
  };

  // Restart at the first step every time the tour (re)opens.
  useEffect(() => { if (open) setI(0); }, [open]);

  // Tour-level lifecycle: capture the pristine scroll position the instant the tour opens
  // (a useLayoutEffect declared BEFORE the per-step one, so it runs first — before any
  // scrollIntoView moves the page). The cleanup is the single safety-net teardown that
  // runs on EVERY way the tour ends (open→false) and on unmount/navigation: it clears any
  // leftover spotlight and snaps the page back to where the user launched the tour, so the
  // header/wordmark is on screen again. Instant scrollTo works under any zoom/large-text mode.
  useLayoutEffect(() => {
    if (!open) return;
    startScrollRef.current = { x: window.scrollX, y: window.scrollY };
    return () => {
      clearSpotlight();
      const s = startScrollRef.current;
      if (s) window.scrollTo({ left: s.x, top: s.y, behavior: "auto" });
      startScrollRef.current = null;
    };
  }, [open]);

  const total = steps.length;
  const step = open && i < total ? steps[i] : null;
  const last = i >= total - 1;
  const goNext = () => setI((n) => (n >= total - 1 ? n : n + 1));
  const goBack = () => setI((n) => (n <= 0 ? 0 : n - 1));

  const ink = onAccent(C.gold);

  // The spotlight box-shadow stack, front→back: white inner outline + dark halo make the ring read on
  // ANY skin (incl. light-green); an accent band carries the brand; a soft dark glow adds depth; and
  // the giant final spread IS the dim, painted LAST so it sits behind the ring. Applied to the ELEMENT
  // → always at the element's true position, so it can never drift.
  const SPOTLIGHT_SHADOW = [
    `0 0 0 2px rgba(255,255,255,0.95)`,
    `0 0 0 5px rgba(0,0,0,0.65)`,
    `0 0 0 8px ${C.gold}`,
    `0 0 14px 6px rgba(0,0,0,0.35)`,
    `0 0 0 9999px rgba(0,0,0,${DIM_ELEM})`,
  ].join(", ");

  // Per-step: resolve → scroll to centre → STYLE THE ELEMENT (save originals first) → measure its rect
  // for bubble placement. Cleanup restores the saved inline styles, so step change / close / unmount
  // always leaves the page exactly as we found it.
  useLayoutEffect(() => {
    if (!open || !step) { clearSpotlight(); setRect(null); setScrim(false); return; }
    const el = pickTarget(step.target);
    if (!el) { clearSpotlight(); setRect(null); setScrim(false); return; }   // missing → plain dim + centred bubble

    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

    // ── Save the original inline values for every key we are about to override ──
    // Clear any previously-styled element FIRST (idempotent), then record THIS element's
    // originals into the refs so the single teardown path can always restore them.
    clearSpotlight();
    const saved: Saved = {
      position: el.style.position,
      zIndex: el.style.zIndex,
      boxShadow: el.style.boxShadow,
      borderRadius: el.style.borderRadius,
      transition: el.style.transition,
    };
    styledElRef.current = el;
    savedStylesRef.current = saved;

    // ── Apply the spotlight ON THE ELEMENT ──
    // position:relative only if currently static (so z-index takes effect without disturbing layout).
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.zIndex = String(Z_TARGET);
    // Keep the element's own corner radius so the ring hugs it; nudge sharp corners to a soft 8px.
    const curRadius = parseFloat(getComputedStyle(el).borderRadius as string) || 0;
    if (curRadius < 8) el.style.borderRadius = "8px";
    el.style.transition = "box-shadow .18s ease";
    el.style.boxShadow = SPOTLIGHT_SHADOW;

    // If a transformed/sticky/opacity/filter ancestor confines the element's giant dim spread, also
    // paint the light baseline scrim so the rest of the screen is still visibly darkened.
    setScrim(hasStackingContextAncestor(el));

    // Measure (ONLY for bubble placement) and keep tracking through the smooth scroll + scroll/resize.
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const t = window.setTimeout(measure, 360);   // after the smooth scroll settles
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      // Restore exactly what was there before — through the single idempotent path so the
      // tour-level safety-net teardown and this per-step cleanup can never fight or double-clear.
      clearSpotlight();
    };
  }, [open, step, i]);

  // Keyboard: Esc closes; arrows step through (mirrored in RTL).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") (rtl ? goBack : goNext)();
      else if (e.key === "ArrowLeft") (rtl ? goNext : goBack)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rtl, total]);

  // Measure the bubble's ACTUAL rendered width (incl. padding/border, post text-wrap) so the horizontal
  // clamp below keeps the WHOLE bubble on-screen even if box-sizing/fonts make it wider than the nominal
  // TW — and so RTL (where the explicit px `left` is unaffected by direction) can't push it off the right.
  useLayoutEffect(() => {
    if (!open || !step) { setBubbleW(0); return; }
    const measure = () => {
      const el = bubbleRef.current;
      if (el) setBubbleW(el.getBoundingClientRect().width);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const on = () => measure();
    window.addEventListener("resize", on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", on); };
  }, [open, step, i, rect, mobile]);

  if (!open || !step) return null;
  if (typeof document === "undefined") return null;

  const accentFill = `linear-gradient(135deg, ${C.accent}, ${C.gold})`;
  const vw = window.innerWidth || 360;
  const vh = window.innerHeight || 640;
  const MARGIN = 12;                                          // min gap from BOTH screen edges
  const narrow = vw < 360;                                    // very narrow phone → tighten padding/font
  // Bubble width: never exceeds the viewport (leaves MARGIN on both sides). `box-sizing: border-box`
  // (set on the bubble) makes this the TRUE box width incl. padding+border, so the clamp below is exact.
  const TW = Math.min(vw - MARGIN * 2, mobile ? 290 : 340);   // bubble width

  // ── Bubble placement (rough viewport coords via getBoundingClientRect; a few px of drift is fine) ──
  // Clamp from the ACTUAL rendered width (bubbleW) when known — falls back to TW on the first paint.
  const BW = Math.min(bubbleW || TW, vw - MARGIN * 2);
  const GAP = 14;
  let bubblePos: React.CSSProperties;
  if (rect) {
    const below = (vh - (rect.top + rect.height)) > (mobile ? 180 : 210) || rect.top < 150;
    // left >= MARGIN AND left + BW <= vw - MARGIN  → the whole bubble stays on-screen on both sides (incl. RTL).
    const left = Math.max(MARGIN, Math.min(vw - BW - MARGIN, rect.left + rect.width / 2 - BW / 2));
    bubblePos = below
      ? { top: rect.top + rect.height + GAP, left }
      : { top: rect.top - GAP, left, transform: "translateY(-100%)" };
  } else {
    bubblePos = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  // Body-level fixed layers in the ROOT stacking context: optional light scrim · transparent tap-shield
  // · bubble. The spotlight itself lives ON the target element (styled above), not here.
  return createPortal(
    <div aria-live="polite" style={{ direction: rtl ? "rtl" : "ltr" }}>
      {/* optional light baseline scrim — only when a stacking-context ancestor confines the element's
          own giant dim. Catches taps too (tap = close). Sits BELOW the elevated element. */}
      {(scrim || !rect) && (
        <div onClick={onClose} aria-hidden="true"
          style={{ position: "fixed", inset: 0, zIndex: Z_SCRIM, pointerEvents: "auto",
            background: `rgba(0,0,0,${rect ? DIM_SCRIM : DIM_ELEM})` }} />
      )}

      {/* transparent full-screen click shield — catches taps on the dimmed area so the page never gets
          them; tap = close. Sits just below the elevated target so the target's ring paints over it. */}
      <div onClick={onClose} aria-hidden="true"
        style={{ position: "fixed", inset: 0, zIndex: Z_SHIELD, pointerEvents: "auto", background: "transparent" }} />

      {/* explanation bubble */}
      <div ref={bubbleRef} role="dialog" aria-modal="false"
        style={{ position: "fixed", zIndex: Z_BUBBLE, pointerEvents: "auto", boxSizing: "border-box",
          width: TW, maxWidth: "calc(100vw - 24px)",
          background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16,
          boxShadow: "0 18px 50px -16px rgba(0,0,0,0.55)",
          padding: narrow ? "11px 11px 10px" : mobile ? "14px 14px 12px" : "16px 16px 14px",
          ...bubblePos }}>
        <button onClick={onClose} aria-label={L.skip}
          style={{ position: "absolute", top: 8, insetInlineEnd: 8, width: 30, height: 30, borderRadius: "50%",
            background: C.surface2, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>✕</button>

        <div style={{ color: C.gold, fontWeight: 900, fontSize: narrow ? 13.5 : mobile ? 14.5 : 16, marginBottom: 6,
          paddingInlineEnd: 28, overflowWrap: "anywhere", wordBreak: "break-word" }}>{step.title}</div>
        <div style={{ color: C.muted, fontSize: narrow ? 12 : mobile ? 12.5 : 13.5, lineHeight: 1.5, marginBottom: 12,
          overflowWrap: "anywhere", wordBreak: "break-word" }}>{step.body}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", rowGap: 8 }}>
          {/* progress dots */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginInlineEnd: "auto" }}>
            {steps.map((_, n) => (
              <span key={n} style={{ width: n === i ? 16 : 6, height: 6, borderRadius: 999,
                background: n === i ? C.gold : C.line, transition: "all .2s ease" }} />
            ))}
          </div>
          {i > 0 && (
            <button onClick={goBack}
              style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer",
                fontFamily: "inherit", fontWeight: 800, fontSize: 12.5, borderRadius: 999, padding: "7px 14px" }}>{L.back}</button>
          )}
          <button onClick={() => (last ? onClose() : goNext())}
            style={{ background: accentFill, border: "none", color: ink, cursor: "pointer",
              fontFamily: "inherit", fontWeight: 900, fontSize: 12.5, borderRadius: 999, padding: "7px 16px" }}>
            {last ? L.done : `${L.next} (${i + 1}/${total})`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
