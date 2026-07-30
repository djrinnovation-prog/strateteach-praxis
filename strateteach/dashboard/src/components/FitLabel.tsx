import React, { useLayoutEffect, useRef, useState } from "react";

// Auto-fitting tile label — the single source of truth for how a hub/category tile
// label is laid out, in BOTH Hebrew and English, on every springboard/hub screen.
//
// Two guarantees:
//  1) NEVER a mid-word break. Words stay atomic (overflowWrap:normal + wordBreak:keep-all
//     + hyphens:none), so wrapping happens ONLY at spaces — whole words per line. This
//     kills the orphaned trailing letter ("אסטרטגיו" + "ת", "מאפייני" + "ם", or an
//     English "…s") that overflowWrap:break-word used to drop onto its own line.
//  2) Always fits. A label is allowed up to `maxLines` lines; if it still overflows the
//     tile — horizontally (one long unbreakable word like "אסטרטגיות") or vertically
//     (too many wrapped lines) — the font auto-shrinks down to `minSize` until it fits.
//     The shrink is per-label and measured, so it reads as an intentional size choice,
//     not a cut-off. Centered both axes by the tile's flex container.
//
// Re-fits on text/lang change, viewport resize, and skin/mode change (the brand font
// can change width), matching how the rest of the app re-reads theme on "algo770-theme".
export default function FitLabel({
  text, size, minSize, maxLines = 2, lineHeight = 1.08, fitHeight = false, style,
}: {
  text: string;
  size: number;            // base (ideal) font size in px
  minSize?: number;        // floor; defaults to ~70% of base
  maxLines?: number;       // max wrapped lines before shrinking on height (default 2)
  lineHeight?: number;
  fitHeight?: boolean;     // also shrink to fit the PARENT's inner height (not just maxLines) —
                           // for fixed/compressible slots (e.g. shortcut tiles at html zoom),
                           // so the label never spills above/below its box. Opt-in; off = unchanged.
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fs, setFs] = useState(size);
  const min = minSize ?? Math.max(8, Math.round(size * 0.7));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const fit = () => {
      let s = size;
      el.style.fontSize = `${s}px`;
      const maxH = () => s * lineHeight * maxLines + 1; // allowance for `maxLines` lines
      // The parent's inner height — the true box the label must fit inside when `fitHeight`
      // is on (the tile slot can be compressed below the label's natural line by a
      // height-constrained flex parent, esp. under html{zoom}).
      const parentH = () => (fitHeight ? (el.parentElement?.clientHeight ?? Infinity) : Infinity);
      // Shrink while the (atomic-word) text overflows its box either horizontally — an
      // unbreakable word wider than the tile — or vertically (more than maxLines lines, or,
      // with fitHeight, taller than the parent slot).
      // HORIZONTAL SAFETY BUFFER: require the content to be at least ~2px NARROWER than the box
      // (`> clientWidth - 2`), not merely "not wider than it" (the old `> clientWidth + 0.5`).
      // That +0.5 tolerance let a sub-pixel/rounding overflow slip through, so a borderline word
      // like "Exchange" stayed a hair too wide and the tile's overflow:hidden clipped the last
      // letter. Shrinking to a guaranteed small side gap means the FULL word always shows.
      let guard = 60;
      while (
        guard-- > 0 && s > min &&
        (el.scrollWidth > el.clientWidth - 2 || el.scrollHeight > maxH() || el.scrollHeight > parentH() + 0.5)
      ) {
        s -= 0.5;
        el.style.fontSize = `${s}px`;
      }
      setFs(s);
    };
    fit();
    // rAF-COALESCE re-fits: resize (and skin/theme) can fire in bursts (esp. a scrollbar
    // toggling viewport width), and each fit() forces a synchronous reflow loop. Debouncing
    // to one fit per frame prevents a layout-thrash storm across the many labels on a screen.
    let raf = 0;
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    window.addEventListener("resize", schedule);
    window.addEventListener("algo770-theme", schedule);
    // Re-fit once web fonts finish loading — the brand/UI font can be wider than the fallback
    // used for the first measure, which would otherwise widen the word AFTER the fit ran (→ clip).
    let cancelled = false;
    (document as any).fonts?.ready?.then(() => { if (!cancelled) schedule(); }).catch(() => { /* */ });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("algo770-theme", schedule);
    };
  }, [text, size, min, maxLines, lineHeight, fitHeight]);

  return (
    <span
      ref={ref}
      style={{
        display: "block",
        maxWidth: "100%",
        fontSize: fs,
        lineHeight,
        whiteSpace: "normal",
        overflowWrap: "normal",
        wordBreak: "keep-all",
        hyphens: "none",
        ...style,
      }}
    >
      {text}
    </span>
  );
}
