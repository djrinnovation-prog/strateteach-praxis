import React, { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { C, UI } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import { useI18n } from "../i18n";
import { GlassTile, homeDim } from "./GlassTile";
import LayoutEditor, { type EditorItem } from "./LayoutEditor";
import { useLayout, applyArrangement, type LayoutArrangement } from "../lib/layout";

// ── SquareRow — the editable CENTRAL BUTTONS row (Home's big glass squares) ────
// The 2–3 central action squares (Home's Trading / Personal-Portal / Signal-Bot
// hero, and each launcher screen's central squares) rendered from a DATA array so
// the SAME layout editor drives them: an EDIT (✎) icon opens the choose-from-list
// panel → toggle which appear + reorder (↑/↓) → APPROVE. Server-backed + resolved
// exactly like the shortcuts row (useLayout → user override / role / default / code)
// so a user customises their own view and an owner sets the default for everyone.
// GlassTile's primary/secondary variants are a verbatim mirror of Home's Square, so
// the rendered squares look pixel-identical to the hand-written hero.
//
// MONEY-SAFETY: a `locked` square is force-shown (applyArrangement keeps it and the
// editor disables its hide toggle), so a safety-critical control can be reordered
// but never removed.

export type SquareDef = {
  id: string; label: string; sub?: string; Icon: React.FC<any>; onClick: () => void;
  variant?: "primary" | "secondary";   // its size/emphasis (kept on reorder); default secondary
  locked?: boolean; badge?: React.ReactNode; disabled?: boolean;
  tour?: string;                        // data-tour anchor (coach-marks), preserved on conversion
};

export default function SquareRow({ screenKey, squares, defaultShown, editable = true, onEditOverride, mobile, gap, editLabel, liquid, style }: {
  screenKey: string;
  squares: SquareDef[];
  defaultShown?: string[];             // ids shown by default (the rest start hidden); default = all
  editable?: boolean;
  onEditOverride?: () => void;         // route the ✎ edit to an external editor (e.g. Home's combined modal)
  mobile?: boolean;                    // pass the parent's mobile to avoid an extra listener
  gap?: number;
  editLabel?: string;
  liquid?: boolean;                    // opt-in LIQUID-GLASS finish on the squares (STAGE-1 preview)
  style?: React.CSSProperties;
}) {
  const autoMobile = useIsMobile();
  const mob = mobile ?? autoMobile;
  const { lang } = useI18n();
  const he = lang === "he";
  const { arr, canEditShared, role, save } = useLayout(screenKey);
  const [editOpen, setEditOpen] = useState(false);

  const ids = useMemo(() => squares.map((s) => s.id), [squares]);
  const lockedIds = useMemo(() => squares.filter((s) => s.locked).map((s) => s.id), [squares]);
  const editorItems: EditorItem[] = useMemo(() => squares.map((s) => ({ id: s.id, label: s.label, Icon: s.Icon, locked: s.locked })), [squares]);

  // Code default: every square shown in code order, unless `defaultShown` narrows it
  // (the extras start hidden but remain addable from the editor list).
  const codeDefault: LayoutArrangement = useMemo(() => {
    if (!defaultShown || !defaultShown.length) return { order: ids, hidden: [] };
    const showSet = new Set(defaultShown.filter((k) => ids.includes(k)));
    const rest = ids.filter((k) => !showSet.has(k));
    const lockedSet = new Set(lockedIds);
    return { order: [...defaultShown.filter((k) => ids.includes(k)), ...rest], hidden: rest.filter((k) => !lockedSet.has(k)) };
  }, [ids, defaultShown, lockedIds]);

  const eff = arr ?? codeDefault;
  const { shown } = applyArrangement(squares, eff, { lockedIds });
  const byId = useMemo(() => new Map(squares.map((s) => [s.id, s])), [squares]);

  // Render the central squares for a given SHOWN list. Reused by the live row AND the
  // editor's live preview, so the preview is pixel-faithful to the real hero.
  const renderSquares = (list: { id: string }[]) => (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: gap ?? (mob ? 14 : 18) }}>
      {list.map((it) => {
        const s = byId.get(it.id); if (!s) return null;
        const variant: "primary" | "secondary" = s.variant || "secondary";
        // key on the Fragment (not GlassTile) — same as TileGrid — so React's key
        // never lands in GlassTile's prop type (avoids the JSX-key type quirk).
        return (
          <React.Fragment key={s.id}>
            <GlassTile variant={variant} mobile={mob} dim={homeDim(variant, mob)} liquid={liquid}
              Icon={s.Icon} label={s.label} sub={s.sub} badge={s.badge} disabled={s.disabled} tour={s.tour} onClick={s.onClick} />
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div style={style}>
      {editable && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginBottom: mob ? 2 : 4 }}>
          <button onClick={() => (onEditOverride ? onEditOverride() : setEditOpen(true))} className="tap44"
            aria-label={editLabel ?? (he ? "ערוך כפתורים מרכזיים" : "Edit central buttons")}
            title={editLabel ?? (he ? "ערוך כפתורים מרכזיים" : "Edit central buttons")}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none",
              color: C.gold, cursor: "pointer", fontFamily: UI, fontSize: mob ? 10 : 11.5, fontWeight: 800, padding: "2px 4px" }}>
            <Pencil size={mob ? 11 : 13} color={C.gold} /> {he ? "ערוך" : "Edit"}
          </button>
        </div>
      )}

      {renderSquares(shown)}

      {editOpen && !onEditOverride && (
        <LayoutEditor
          he={he} title={he ? "עריכת כפתורים מרכזיים" : "Edit central buttons"} items={editorItems} arrangement={eff}
          canEditShared={canEditShared} role={role}
          defaultArrangement={codeDefault}
          renderPreview={(a) => renderSquares(applyArrangement(squares, a, { lockedIds }).shown)}
          onApprove={(a, scope) => { void save(a, scope); }}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
