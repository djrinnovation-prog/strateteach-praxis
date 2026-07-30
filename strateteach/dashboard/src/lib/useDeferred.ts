import { useEffect, useState } from "react";

// Returns false on first render, then true once the browser is idle (or after a
// short timeout) — used to hold NON-critical fetches (e.g. the announcement
// banner) until AFTER the first paint, so the critical home data renders fast and
// the deferred calls fire a beat later. Gate a react-query `enabled` on this.
export function useDeferred(delay = 1000): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as any;
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: delay });
      return () => w.cancelIdleCallback?.(id);
    }
    const tmr = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(tmr);
  }, []);
  return ready;
}
