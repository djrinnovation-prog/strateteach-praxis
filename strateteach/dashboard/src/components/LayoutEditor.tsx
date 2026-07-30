import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ArrowUp, ArrowDown, Eye, EyeOff, Lock, RotateCcw, X } from "lucide-react";
import { C, UI, onAccent } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import { applyArrangement, type LayoutArrangement, type LayoutScope } from "../lib/layout";

// ── LayoutEditor — the shared, PREVIEW-DRIVEN "design your screen" editor ──────
// Dan's UX: opening edit gives a nice, large screen where you DESIGN the region by
// SELECTION — pick which buttons appear, reorder them, show/hide — and SEE the change
// LIVE in a preview of the actual screen, then press APPROVE and only THEN does it
// apply. Cancel discards; Reset restages the default. Nothing commits until Approve.
//
// Supports ONE region (the common case) or SEVERAL as TABS in the same modal — e.g. on
// Home you edit BOTH the shortcuts row AND the two central buttons from one editor.
//
// Height is ZOOM-SAFE: the modal is capped by a % chain off the fixed inset:0 overlay
// (NOT vh — vh doesn't scale with html{zoom} and renders ~15% too tall → footer cut off,
// see index.html). Header, tabs, live-preview, scope pills and the footer stay pinned;
// only the pick-LIST scrolls, so every control is always reachable at any zoom / height.
//
// MONEY-SAFETY: a `locked` item is pinned SHOWN — its hide toggle is disabled. It can be
// reordered but never removed; applyArrangement enforces it at render too.

export type EditorItem = { id: string; label: string; Icon: React.FC<any>; locked?: boolean };

export type EditorRegion = {
  key: string;
  label: string;                                       // tab label
  items: EditorItem[];
  arrangement: LayoutArrangement | null;               // current effective
  maxShown?: number;                                   // 5 for the shortcuts row; undefined otherwise
  defaultArrangement?: LayoutArrangement | null;       // Reset target (the built-in layout)
  renderPreview?: (arr: LayoutArrangement) => React.ReactNode;
  onApprove: (arr: LayoutArrangement, scope: LayoutScope) => void;
};

type Row = EditorItem & { shown: boolean };

const lockedOf = (items: EditorItem[]) => items.filter((i) => i.locked).map((i) => i.id);
const seedRows = (items: EditorItem[], a: LayoutArrangement | null): Row[] => {
  const { ordered } = applyArrangement(items, a, { lockedIds: lockedOf(items) });
  const hidden = new Set(a?.hidden ?? []);
  return ordered.map((it) => ({ ...it, shown: !!it.locked || !hidden.has(it.id) }));
};
const toArr = (rows: Row[]): LayoutArrangement => ({
  order: rows.map((r) => r.id),
  hidden: rows.filter((r) => !r.shown && !r.locked).map((r) => r.id),
});

export default function LayoutEditor(props: {
  he: boolean;
  title: string;
  canEditShared: boolean;            // owner → may target role / default scope
  role: string | null;
  onClose: () => void;
  // Single-region (the common case):
  items?: EditorItem[];
  arrangement?: LayoutArrangement | null;
  maxShown?: number;
  defaultArrangement?: LayoutArrangement | null;
  renderPreview?: (arr: LayoutArrangement) => React.ReactNode;
  onApprove?: (arr: LayoutArrangement, scope: LayoutScope) => void;
  // OR several regions shown as TABS in one modal:
  regions?: EditorRegion[];
  initialRegionKey?: string;
}) {
  const { he, title, canEditShared, role, onClose } = props;
  const ink = onAccent(C.gold);
  const mobile = useIsMobile();

  // Normalise to a regions array — single-region props wrap into one region.
  const regions: EditorRegion[] = props.regions ?? [{
    key: "main", label: title, items: props.items ?? [], arrangement: props.arrangement ?? null,
    maxShown: props.maxShown, defaultArrangement: props.defaultArrangement,
    renderPreview: props.renderPreview, onApprove: props.onApprove ?? (() => { /* noop */ }),
  }];

  const [activeKey, setActiveKey] = useState<string>(props.initialRegionKey && regions.some((r) => r.key === props.initialRegionKey) ? props.initialRegionKey : regions[0].key);
  // Working rows per region (each tab keeps its own in-progress edits). Nothing here is
  // persisted until Approve.
  const [rowsByRegion, setRowsByRegion] = useState<Record<string, Row[]>>(() => {
    const m: Record<string, Row[]> = {};
    for (const r of regions) m[r.key] = seedRows(r.items, r.arrangement);
    return m;
  });
  const [scope, setScope] = useState<LayoutScope>("user");

  const active = regions.find((r) => r.key === activeKey) ?? regions[0];
  const rows = rowsByRegion[active.key] ?? [];
  const workingArr = useMemo(() => toArr(rows), [rows]);
  const maxShown = active.maxShown;
  const shownCount = rows.filter((r) => r.shown).length;
  const atCap = maxShown != null && shownCount >= maxShown;

  const setRows = (updater: (prev: Row[]) => Row[]) =>
    setRowsByRegion((prev) => ({ ...prev, [active.key]: updater(prev[active.key] ?? []) }));

  function move(i: number, dir: -1 | 1) {
    setRows((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function toggle(i: number) {
    setRows((prev) => {
      const r = prev[i];
      if (r.locked) return prev;                       // safety: never hide a locked control
      if (!r.shown && maxShown != null && prev.filter((x) => x.shown).length >= maxShown) return prev;  // cap
      const next = [...prev];
      next[i] = { ...r, shown: !r.shown };
      return next;
    });
  }
  function approve() {
    // Commit EVERY region's working arrangement (across all tabs) with the chosen scope.
    for (const r of regions) r.onApprove(toArr(rowsByRegion[r.key] ?? []), scope);
    onClose();
  }
  // Reset RESTAGES the built-in default of the ACTIVE tab into its working preview (live,
  // WYSIWYG) — not committed; the user still presses Approve to apply.
  function resetToDefault() { setRows(() => seedRows(active.items, active.defaultArrangement ?? null)); }

  const scopeOpts: { key: LayoutScope; label: string }[] = [
    { key: "user", label: he ? "רק אני" : "Just me" },
  ];
  if (canEditShared) {
    if (role) scopeOpts.push({ key: "role", label: he ? `התפקיד שלי (${role})` : `My role (${role})` });
    scopeOpts.push({ key: "default", label: he ? "כולם (ברירת מחדל)" : "Everyone (default)" });
  }

  // ZOOM-SAFE surface: the overlay is a % height reference (h/w:100% + inset:0 — %, unlike
  // vh, scales correctly through html{zoom:1.15}); the modal caps at 100% of it (minus the
  // overlay padding), so it never exceeds the visible viewport. On mobile it's a full-height
  // bottom sheet; the header + preview are pinned, ONLY the list scrolls, and the footer is a
  // sticky bottom bar (last flex child, never cut).
  const surface: React.CSSProperties = {
    width: "100%", maxWidth: mobile ? 560 : 640,
    // MOBILE: an EXPLICIT height (fills the overlay content box = viewport − top peek) so the
    // internal flex column has a definite height → the list scroll + sticky footer are
    // guaranteed. DESKTOP: cap at 100% and size to content (a centred sheet).
    ...(mobile ? { height: "100%" } : { maxHeight: "100%" }), minHeight: 0,
    display: "flex", flexDirection: "column", overflow: "hidden",
    background: C.surface, border: `1px solid ${C.glassBd}`,
    borderRadius: mobile ? "18px 18px 0 0" : 20, boxShadow: "0 -12px 40px rgba(0,0,0,0.5)",
  };
  const sidePad = "0 16px";

  // Rendered through a PORTAL to <body> so the fixed overlay ALWAYS covers the real viewport.
  // Home's springboard (and other screens) wrap content in transform/scale + fixed containers;
  // a position:fixed child INSIDE a transformed ancestor is positioned relative to that
  // ancestor (not the viewport) — which turned the editor into a tall in-flow panel whose
  // footer scrolled off. Portaling to <body> escapes that entirely.
  const overlay = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 3000, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", fontFamily: UI,
      direction: he ? "rtl" : "ltr",   // portaled to <body> → set direction explicitly (not inherited from the app's dir)
      padding: mobile ? "24px 0 0" : 20, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={surface}>

        {/* Header (pinned) */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 16px 10px", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 900, color: C.text }}>{title}</h3>
          <button onClick={onClose} className="tap44" aria-label={he ? "סגור" : "Close"}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, padding: 0,
              background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, cursor: "pointer", fontFamily: UI }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs (pinned) — one per region, when there is more than one */}
        {regions.length > 1 && (
          <div style={{ display: "flex", gap: 6, padding: "0 16px 10px", flexShrink: 0, flexWrap: "wrap" }}>
            {regions.map((r) => {
              const on = r.key === active.key;
              return (
                <button key={r.key} onClick={() => setActiveKey(r.key)} className="tap44"
                  style={{ padding: "7px 14px", borderRadius: 10, cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800,
                    background: on ? C.gold : C.surface2, color: on ? ink : C.text, border: `1px solid ${on ? C.gold : C.line}` }}>
                  {r.label}
                </button>
              );
            })}
          </div>
        )}

        {/* LIVE PREVIEW (pinned) — the actual region drawn from the working arrangement; it
            updates the instant you select / reorder / show-hide. Non-interactive. */}
        {active.renderPreview && (
          <div style={{ padding: "0 16px 12px", flexShrink: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.06em", color: C.muted, marginBottom: 6, textAlign: "center" }}>
              {he ? "תצוגה מקדימה — כך זה ייראה" : "Live preview — how it will look"}
            </div>
            <div style={{ position: "relative", borderRadius: 16, border: `1px solid ${C.line}`, background: C.surface2,
              padding: mobile ? "12px 10px" : "16px 14px", boxShadow: `inset 0 1px 0 ${C.glassHi}`, maxHeight: mobile ? 148 : 200, overflow: "hidden" }}>
              <div style={{ pointerEvents: "none", userSelect: "none" }} aria-hidden>
                {active.renderPreview(workingArr)}
              </div>
            </div>
          </div>
        )}

        {/* Scope + hint (pinned) */}
        <div style={{ padding: sidePad, flexShrink: 0 }}>
          {scopeOpts.length > 1 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 8 }}>
              {scopeOpts.map((o) => {
                const on = scope === o.key;
                return (
                  <button key={o.key} onClick={() => setScope(o.key)} className="tap44"
                    style={{ padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontFamily: UI, fontSize: 11.5, fontWeight: 800,
                      background: on ? C.gold : C.surface2, color: on ? ink : C.text, border: `1px solid ${on ? C.gold : C.line}` }}>
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
          <p style={{ margin: "0 0 10px", fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>
            {maxShown != null
              ? (he ? `בחרו עד ${maxShown} כפתורים וסדרו אותם (↑/↓) — התצוגה מתעדכנת מיד. לחצו אישור להחלה.` : `Pick up to ${maxShown} buttons and order them (↑/↓) — the preview updates live. Press Approve to apply.`)
              : (he ? "בחרו אילו כפתורים יופיעו וסדרו אותם (↑/↓) — התצוגה מתעדכנת מיד. לחצו אישור להחלה." : "Choose which buttons appear and order them (↑/↓) — the preview updates live. Press Approve to apply.")}
          </p>
        </div>

        {/* Pick-LIST (the ONLY scrolling area) */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 16px 12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r, i) => {
              const disableEnable = !r.shown && !r.locked && atCap;
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px",
                  background: r.shown ? C.glassTint : C.surface2, border: `1px solid ${r.shown ? C.gold : C.line}`, borderRadius: 12,
                  opacity: r.shown ? 1 : 0.72 }}>
                  <span style={{ width: 20, textAlign: "center", fontSize: 12, fontWeight: 900, color: r.shown ? C.gold : C.faint, flexShrink: 0 }}>{r.shown ? i + 1 : "–"}</span>
                  <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0,
                    background: r.shown ? C.gold : C.surface, color: r.shown ? ink : C.gold }}><r.Icon size={15} /></span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: C.text, fontFamily: UI, fontSize: 12.5, fontWeight: 700 }}>{r.label}</span>
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="tap44" aria-label={he ? "הזז למעלה" : "Move up"}
                    style={{ ...iconBtn, opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? "default" : "pointer" }}><ArrowUp size={15} color={C.text} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="tap44" aria-label={he ? "הזז למטה" : "Move down"}
                    style={{ ...iconBtn, opacity: i === rows.length - 1 ? 0.3 : 1, cursor: i === rows.length - 1 ? "default" : "pointer" }}><ArrowDown size={15} color={C.text} /></button>
                  {r.locked ? (
                    <span title={he ? "כפתור חובה — לא ניתן להסתרה" : "Required — cannot be hidden"}
                      style={{ ...iconBtn, borderColor: `${C.gold}66`, cursor: "default", display: "inline-grid", placeItems: "center" }}><Lock size={14} color={C.gold} /></span>
                  ) : (
                    <button onClick={() => toggle(i)} disabled={disableEnable} className="tap44"
                      title={r.shown ? (he ? "הסתר" : "Hide") : (disableEnable ? (he ? "הגעת למקסימום" : "At the limit") : (he ? "הצג" : "Show"))}
                      style={{ ...iconBtn, opacity: disableEnable ? 0.3 : 1, cursor: disableEnable ? "not-allowed" : "pointer" }}>
                      {r.shown ? <Eye size={15} color={C.gold} /> : <EyeOff size={15} color={C.faint} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer (STICKY bottom bar) — the last flex child of the capped column, so it is
            ALWAYS visible without scrolling (never cut). Reset restages the default into the
            preview (not committed); Cancel discards; Approve commits every tab's arrangement.
            Bottom pad clears the iOS home indicator. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
          borderTop: `1px solid ${C.line}`, background: C.surface, flexShrink: 0 }}>
          <button onClick={resetToDefault} className="tap44" title={he ? "החזרת העיצוב לברירת-המחדל (עדיין צריך לאשר)" : "Restage the default design (still needs Approve)"}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: C.gold,
              border: `1px solid ${C.gold}66`, borderRadius: 10, padding: "9px 14px", fontFamily: UI, fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
            <RotateCcw size={14} /> {he ? "חזור לברירת-מחדל" : "Reset to default"}
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="tap44"
            style={{ background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 16px", fontFamily: UI, fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
            {he ? "ביטול" : "Cancel"}
          </button>
          <button onClick={approve} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.gold, color: ink, border: "none", borderRadius: 10, padding: "9px 18px", fontFamily: UI, fontWeight: 900, fontSize: 12.5, cursor: "pointer" }}>
            <Check size={14} /> {he ? "אישור" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay;
}

const iconBtn: React.CSSProperties = {
  flexShrink: 0, width: 32, height: 32, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center",
  background: C.surface, border: `1px solid ${C.line}`, padding: 0,
};
