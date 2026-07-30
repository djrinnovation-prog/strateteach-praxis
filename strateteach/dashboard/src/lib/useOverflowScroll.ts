import { useLayoutEffect, useRef, useState } from "react";

// Accessibility-aware scroll lock. Attach the returned `ref` to a one-screen-locked
// container; `overflowY` is "hidden" while the content fits the box and flips to
// "auto" the moment it would be clipped — e.g. when the large-text / zoom mode is on,
// on a very short device, OR when in-page content grows (an accordion/section expands).
// So the layout stays locked (no scroll) normally, and becomes scrollable exactly when
// needed, instead of cutting content off.
//
// The decision is `scrollHeight > clientHeight`, re-run whenever EITHER side can change:
//   • clientHeight (the box) — window resize, `algo770-theme` (large-text/zoom toggle),
//     and a ResizeObserver on the element + <html> (zoom changes the rendered box).
//   • scrollHeight (the CONTENT) — this is the case a container-only observer misses: the
//     scroll container is often position:fixed (Home), so its OWN box never changes when a
//     child grows. Expanding the "open positions" accordion grows a CHILD's height, not the
//     container's and not <html>'s, so nothing fired and the stale "hidden" clipped the new
//     rows (unscrollable). We therefore also observe every CHILD of the container (their
//     height grows on expand) and a MutationObserver re-observes children + re-checks when
//     rows are added/removed. Result: expand → overflow flips to "auto" (scrolls to the
//     true last row); collapse → back to "hidden" (locked, no empty scroll area).
// All callbacks are rAF-debounced so a re-measure never runs synchronously inside a
// ResizeObserver callback (avoids the "ResizeObserver loop" warning / thrash).
export function useOverflowScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(check); };
    check();
    const t = setTimeout(check, 300);

    let ro: ResizeObserver | null = null;
    // (Re)observe the container (box/zoom), <html> (zoom), AND every direct child so
    // content growth is caught even when the container's own box is fixed-size.
    const observeAll = () => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(el);
      try { ro.observe(document.documentElement); } catch (_e) { /* */ }
      for (let i = 0; i < el.children.length; i++) ro.observe(el.children[i]);
    };
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(schedule);
      observeAll();
    }
    // DOM changes (accordion expand adds/removes rows; new content wrappers mount) →
    // re-observe the current children and re-measure.
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => { observeAll(); schedule(); });
      mo.observe(el, { childList: true, subtree: true });
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("algo770-theme", schedule);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(t); ro?.disconnect(); mo?.disconnect();
      window.removeEventListener("resize", schedule); window.removeEventListener("algo770-theme", schedule);
    };
  }, []);
  return { ref, overflowY: (overflowing ? "auto" : "hidden") as "auto" | "hidden" };
}
