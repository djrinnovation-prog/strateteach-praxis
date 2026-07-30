import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { C, UI } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import { useI18n } from "../i18n";
import FitLabel from "./FitLabel";
import LayoutEditor, { type EditorItem } from "./LayoutEditor";
import { useLayout, applyArrangement, legacyTileOrder, type LayoutArrangement } from "../lib/layout";

// A cheap one-shot viewport read (no hook, no listener) — used as a fallback when a
// parent doesn't pass `mobile`. Avoids mounting a resize listener PER tile (a grid can
// have 10+ tiles); the screen/TileGrid subscribes once and passes the value down.
const readMobile = () => (typeof window !== "undefined" ? window.innerWidth < 860 : false);

// ── GlassTile — the SQUARE translucent-glass button, EXACTLY like Home's GlobeHero squares ──
// Dan: the central buttons must look identical to Home's Trading / Personal-Portal squares.
// This mirrors Home's `Square` verbatim (screens/Home.tsx): same fills (C.glassTint primary /
// C.glass secondary), gold rim (3px primary / 2px secondary), the same layered shadow +
// C.glassHi bevel + backdrop-blur, the same compact radius/padding/gap, a PLAIN accent icon
// (no chip) over a FitLabel title + sub. Sizes track Home's teDim/sbDim via `dim`.
//   • primary   — the big accent-tinted glass CTA (Home's Trading square).
//   • secondary — the smaller neutral frosted square (Home's Personal-Portal square).
//   • tile      — the same frosted glass, lighter rim, for the function-button grid.
export type TileVariant = "primary" | "secondary" | "tile";

// Home's exact square dimensions (GlobeHero teDim / sbDim), for the central buttons.
export function homeDim(variant: "primary" | "secondary", mobile: boolean): number | string {
  if (variant === "primary") return mobile ? 106 : "clamp(108px, 15vh, 124px)";
  return mobile ? 88 : "clamp(96px, 13vh, 110px)";
}

export function GlassTile({ onClick, variant = "tile", Icon, label, sub, badge, dim, mobile: mobileProp, disabled, tour, ariaLabel, liquid, style }: {
  onClick: () => void;
  variant?: TileVariant;
  Icon: React.FC<any>;
  label: string;
  sub?: string;
  badge?: React.ReactNode;
  dim?: number | string;         // square size (Home teDim/sbDim); omit for grid-cell tiles
  mobile?: boolean;              // pass from the parent's ONE useIsMobile — avoids a per-tile listener
  disabled?: boolean;
  tour?: string;
  ariaLabel?: string;
  liquid?: boolean;              // opt-in LIQUID-GLASS finish (STAGE-1 preview): layer the .lqglass gloss on top
  style?: React.CSSProperties;
}) {
  const mobile = mobileProp ?? readMobile();
  const primary = variant === "primary";
  const tile = variant === "tile";
  const bg = primary ? C.glassTint : C.glass;
  const border = primary ? `3px solid ${C.frameAccent}` : variant === "secondary" ? `2px solid ${C.frameAccent}` : `1.5px solid ${C.frameAccent}99`;
  const shadow = primary
    ? `0 18px 38px -12px ${C.gold}99, 0 0 0 1px ${C.gold}66, ${C.glassHi}`
    : variant === "secondary"
      ? `0 16px 32px -14px rgba(0,0,0,0.6), 0 0 0 1px ${C.gold}55, ${C.glassHi}`
      : `0 12px 26px -16px rgba(0,0,0,0.55), 0 0 0 1px ${C.gold}33, ${C.glassHi}`;
  // Home's exact icon + label sizes per square variant.
  const isz = tile ? 24 : primary ? (mobile ? 26 : 36) : (mobile ? 22 : 27);
  const labelSz = tile ? 12.5 : primary ? (mobile ? 14 : 15) : (mobile ? 12.5 : 13);
  const subSz = tile ? 9.5 : primary ? (mobile ? 9 : 10.5) : (mobile ? 8.5 : 9.5);
  return (
    <button onClick={onClick} disabled={disabled} data-tour={tour} className={`tap44${liquid ? " lqglass" : ""}`} aria-label={ariaLabel || label}
      style={{ position: "relative", overflow: "hidden", flexShrink: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: tile ? 6 : (mobile ? 2 : 4), textAlign: "center",
        borderRadius: tile ? 18 : (mobile ? 14 : 20), padding: tile ? "12px 10px" : (mobile ? 5 : 8),
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: UI, color: C.text,
        WebkitTapHighlightColor: "transparent", background: bg, border, boxShadow: shadow,
        backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any, transition: "transform .14s ease",
        ...(dim != null ? { width: dim, height: dim } : null), ...style }}
      onPointerDown={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.transform = "translateY(2px) scale(0.985)"; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}>
      {badge != null && (
        <span style={{ position: "absolute", top: 7, insetInlineEnd: 9, fontSize: 9, fontWeight: 900, letterSpacing: "0.04em",
          padding: "2px 7px", borderRadius: 8, background: `${C.gold}26`, color: C.gold, textTransform: "uppercase" }}>{badge}</span>
      )}
      {/* icon + FitLabels rendered EXACTLY like Home's GlobeHero Square (default stroke,
          width:100% + centred, lineHeight 1.04 title / 1.15 sub) so the glyph placement +
          label metrics are pixel-identical to Home. */}
      <span style={{ display: "inline-flex", flexShrink: 0 }}><Icon size={isz} color={C.gold} /></span>
      <FitLabel text={label} size={labelSz} maxLines={2} lineHeight={1.04} style={{ width: "100%", fontWeight: 900, color: C.text, textAlign: "center" }} />
      {sub && <FitLabel text={sub} size={subSz} maxLines={1} lineHeight={1.15} style={{ width: "100%", fontWeight: 700, color: C.text, opacity: 0.85, textAlign: "center" }} />}
    </button>
  );
}

// ── TileGrid — DATA-DRIVEN function-button grid with the shared layout editor ──
// The screen passes a plain ARRAY of tile objects (id · label · Icon · onClick · …); the grid
// renders the RESOLVED arrangement (which tiles show + their order) as square GlassTiles. The
// arrangement is SERVER-BACKED (per user, resolving user → role → default → the code order),
// so a user's picks follow them across devices and owners can set a default/role layout for
// everyone. A ✎ pencil opens the shared LayoutEditor (choose-from-list + ↑/↓ + APPROVE). Mark
// any safety-critical tile `locked` and the editor can reorder but never hide it.
export type TileDef = {
  id: string; label: string; Icon: React.FC<any>; onClick: () => void;
  sub?: string; badge?: React.ReactNode; variant?: TileVariant; disabled?: boolean;
  locked?: boolean;              // safety-critical → always shown (reorder-only, never hidden)
};

export function TileGrid({ screenKey, tiles, columns = 3, aspect = 1, view = "cards", maxTile = 168, editable = true, style }: {
  screenKey: string;
  tiles: TileDef[];
  columns?: number;
  aspect?: number;               // tile width/height ratio (>1 = shorter tiles, for non-scroll density)
  view?: "cards" | "list";       // TILES (squares) or ROWS (list) — driven by ViewToggle
  maxTile?: number;              // CAP each square's px size so desktop tiles stay compact (centred), not ballooned
  editable?: boolean;            // show the ✎ layout-editor affordance (default true)
  style?: React.CSSProperties;
}) {
  const mobile = useIsMobile();   // ONE listener for the whole grid (not one per tile)
  const { rtl } = useI18n();
  const { arr, canEditShared, role, save } = useLayout(screenKey);
  const [editOpen, setEditOpen] = useState(false);

  const tileIds = useMemo(() => tiles.map((t) => t.id), [tiles]);
  const lockedIds = useMemo(() => tiles.filter((t) => t.locked).map((t) => t.id), [tiles]);
  const editorItems: EditorItem[] = useMemo(() => tiles.map((t) => ({ id: t.id, label: t.label, Icon: t.Icon, locked: t.locked })), [tiles]);
  // Code default = every tile shown, in code order. Legacy migration folds a pre-editor
  // localStorage tile order in so an existing user keeps their arrangement on first load.
  const codeDefault: LayoutArrangement = useMemo(() => ({ order: tileIds, hidden: [] }), [tileIds]);
  const legacy: LayoutArrangement | null = useMemo(() => {
    const o = legacyTileOrder(screenKey);
    return o.length ? { order: o, hidden: [] } : null;
  }, [screenKey]);
  const eff = arr ?? legacy ?? codeDefault;
  const { shown: ordered } = applyArrangement(tiles, eff, { lockedIds });

  const editPencil = editable ? (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
      <button onClick={() => setEditOpen(true)} className="tap44" aria-label={rtl ? "ערוך מיקום" : "Edit layout"} title={rtl ? "ערוך מיקום" : "Edit layout"}
        style={{ width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0,
          background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any, border: `1px dashed ${C.gold}`, color: C.gold,
          borderRadius: 12, cursor: "pointer", fontFamily: UI, boxShadow: `0 6px 16px -10px rgba(0,0,0,0.42), ${C.glassHi}` }}>
        <Pencil size={15} color={C.gold} />
      </button>
    </div>
  ) : null;

  // Render the grid (or list) for a given SHOWN tile list. Reused by the live region AND
  // the editor's live preview, so the preview is pixel-faithful to the real grid.
  const renderTiles = (list: TileDef[]) => {
    if (view === "list") {
      const Chev = rtl ? ChevronLeft : ChevronRight;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((t) => (
            <button key={t.id} onClick={t.onClick} disabled={t.disabled} className="tap44"
              style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "start", cursor: t.disabled ? "default" : "pointer",
                opacity: t.disabled ? 0.55 : 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px",
                color: C.text, fontFamily: UI, boxShadow: C.glassHi }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: C.surface2, color: C.gold, flexShrink: 0 }}><t.Icon size={18} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 800, fontSize: 13.5, lineHeight: 1.2 }}>{t.label}</span>
                {t.sub && <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 2, lineHeight: 1.3 }}>{t.sub}</span>}
              </span>
              {t.badge != null && (
                <span style={{ fontSize: 9.5, fontWeight: 900, padding: "2px 7px", borderRadius: 8, background: `${C.gold}26`, color: C.gold, flexShrink: 0 }}>{t.badge}</span>
              )}
              <Chev size={17} color={C.faint} style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      );
    }
    // TILES view — square glass grid. Auto-balance the column count so the LAST row is
    // never a lone orphan tile (e.g. 9 items in 5 cols stays 5, but 9 in 4 would be 4+4+1).
    let cols = columns;
    while (cols > 2 && list.length % cols === 1) cols -= 1;
    // Each column is CAPPED at maxTile px (not stretched to 1fr) and the grid is CENTRED.
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, ${maxTile}px))`, justifyContent: "center", gap: mobile ? 8 : 10 }}>
        {list.map((t) => (
          <React.Fragment key={t.id}>
            <GlassTile variant={t.variant || "tile"} Icon={t.Icon} label={t.label} sub={t.sub} mobile={mobile}
              badge={t.badge} disabled={t.disabled} onClick={t.onClick} style={{ aspectRatio: `${aspect} / 1` }} />
          </React.Fragment>
        ))}
      </div>
    );
  };

  const editor = editOpen ? (
    <LayoutEditor
      he={rtl} title={rtl ? "עריכת מיקום" : "Edit layout"} items={editorItems} arrangement={eff}
      canEditShared={canEditShared} role={role}
      defaultArrangement={codeDefault}
      renderPreview={(a) => renderTiles(applyArrangement(tiles, a, { lockedIds }).shown)}
      onApprove={(a, scope) => { void save(a, scope); }}
      onClose={() => setEditOpen(false)}
    />
  ) : null;

  return (
    <div style={style}>
      {editPencil}
      {editor}
      {renderTiles(ordered)}
    </div>
  );
}

export default GlassTile;
