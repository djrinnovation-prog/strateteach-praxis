import { useEffect, useRef, useState } from "react";

// Tracks how the breakout list changed between daily scans. Given a stable
// `scanId` (the daily scan's lastScanAt) and the current symbols, it remembers
// the previously-seen scan (persisted in localStorage under `key`) and reports
// which symbols are NEW since then and which DROPPED out. It recomputes only when
// a genuinely new scan arrives — not on every poll — so the badges persist until
// the next scan, and it survives reloads ("new since you last looked").
export type ScanChanges = { isNew: (sym: string) => boolean; dropped: string[]; newCount: number };

export function useScanChanges(key: string, scanId: string | null | undefined, symbols: string[]): ScanChanges {
  const [state, setState] = useState<{ newSet: Set<string>; dropped: string[] }>({ newSet: new Set(), dropped: [] });
  // Baseline = the scan we last diffed against. Seeded once from localStorage.
  const baseRef = useRef<{ id: string | null; syms: string[] } | null>(null);
  if (baseRef.current === null) {
    let init: { id: string | null; syms: string[] } = { id: null, syms: [] };
    try {
      const raw = localStorage.getItem(key);
      if (raw) { const p = JSON.parse(raw); init = { id: p.id ?? null, syms: Array.isArray(p.syms) ? p.syms.map(String) : [] }; }
    } catch (_e) { /* */ }
    baseRef.current = init;
  }

  const symKey = symbols.join(",");
  useEffect(() => {
    if (!scanId) return;
    const base = baseRef.current!;
    if (scanId === base.id) return;            // same scan → nothing changed
    if (base.syms.length) {                     // diff against the previous scan
      const prev = new Set(base.syms);
      const cur = new Set(symbols);
      setState({
        newSet: new Set(symbols.filter((s) => !prev.has(s))),
        dropped: base.syms.filter((s) => !cur.has(s)),
      });
    } else {
      setState({ newSet: new Set(), dropped: [] });  // first baseline → no badges
    }
    baseRef.current = { id: scanId, syms: symbols.slice() };
    try { localStorage.setItem(key, JSON.stringify({ id: scanId, syms: symbols })); } catch (_e) { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId, symKey, key]);

  return { isNew: (s: string) => state.newSet.has(s), dropped: state.dropped, newCount: state.newSet.size };
}
