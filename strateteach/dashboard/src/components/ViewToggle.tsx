import React, { useState } from "react";
import { ListTree, LayoutGrid } from "lucide-react";
import { C, onAccent } from "../theme";

// ── Shared "rows vs squares" view toggle ─────────────────────────────────────────
// Dan asked for the SAME List/Cards (rows/squares) switch that lives on the AutoPilots
// screen to be available on every collection screen (positions, signal bots, backtests,
// owners-portal item/task lists, …). This is the ONE reusable implementation so the
// control looks and behaves identically everywhere — extracted verbatim from the
// original AutoPilots toggle (styled like the Live/Demo pill).

export type ViewMode = "list" | "cards";

// Persist each screen's choice under its OWN localStorage key (pass a stable key per
// screen, e.g. "algo770_positions_view_v1"). Falls back gracefully if storage is blocked.
export function useViewMode(storageKey: string, fallback: ViewMode = "list"): [ViewMode, (m: ViewMode) => void] {
  const [view, setViewState] = useState<ViewMode>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === "cards" || v === "list" ? v : fallback;
    } catch { return fallback; }
  });
  const setView = (m: ViewMode) => {
    setViewState(m);
    try { localStorage.setItem(storageKey, m); } catch { /* ignore */ }
  };
  return [view, setView];
}

// The pill itself. `he` picks the Hebrew labels; `size` shrinks it for dense toolbars.
export function ViewToggle({ view, onChange, he, style }: {
  view: ViewMode; onChange: (m: ViewMode) => void; he: boolean; style?: React.CSSProperties;
}) {
  const ink = onAccent(C.gold);
  return (
    <div style={{ display: "inline-flex", background: C.surface2, border: `1px solid ${C.line}`,
      borderRadius: 999, padding: 3, gap: 2, ...style }}>
      {([["list", ListTree, he ? "רשימה" : "List"], ["cards", LayoutGrid, he ? "כרטיסים" : "Cards"]] as const).map(([m, Ico, label]) => {
        const active = view === m;
        return (
          <button key={m} onClick={() => onChange(m)} className="tap44"
            title={label} aria-pressed={active}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800,
              borderRadius: 999, padding: "4px 11px", border: "none", cursor: "pointer",
              background: active ? C.gold : "transparent", color: active ? ink : C.muted }}>
            <Ico size={13} /> {label}
          </button>
        );
      })}
    </div>
  );
}
