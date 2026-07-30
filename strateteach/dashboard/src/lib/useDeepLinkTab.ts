import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Reads the `?tab=<key>` deep-link param and applies it once on mount (and again
// if the query changes). Home-page promos that point at a hub sub-tab navigate
// to e.g. `/strategy?tab=editor`; the target screen calls this hook to open that
// section. `valid` filters out unknown keys so a stale link can't push a screen
// into a bad state. No param → nothing happens, so default behaviour is intact.
export function useDeepLinkTab(apply: (tab: string) => void, valid?: readonly string[]) {
  const loc = useLocation();
  useEffect(() => {
    try {
      const tab = new URLSearchParams(loc.search).get("tab");
      if (tab && (!valid || valid.includes(tab))) apply(tab);
    } catch { /* malformed query — ignore */ }
    // apply/valid are stable enough for this one-shot read; re-run only on query change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.search]);
}
