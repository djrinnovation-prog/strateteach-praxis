import React from "react";
import LayoutEditor, { type EditorItem, type EditorRegion } from "./LayoutEditor";
import { useLayout, type LayoutArrangement } from "../lib/layout";

// ── HomeLayoutEditor — the ONE modal that edits BOTH Home regions ─────────────
// Dan opened "Edit shortcuts" on Home and wanted to edit the two central buttons
// there too. This composes the shortcuts row (screenKey "home") AND the central
// buttons (screenKey "home-central") into a single tabbed LayoutEditor: same
// pick-from-list / reorder / show-hide / live-preview / Approve UX + per-scope
// Reset. Home supplies each region's items, code default, preview renderer and
// labels; this component owns the two useLayout hooks + Approve saving.

export type HomeRegionInput = {
  label: string;
  items: EditorItem[];
  codeDefault: LayoutArrangement;
  maxShown?: number;
  renderPreview: (arr: LayoutArrangement) => React.ReactNode;
};

export default function HomeLayoutEditor({ he, onClose, initialKey, shortcuts, central }: {
  he: boolean;
  onClose: () => void;
  initialKey?: "home" | "home-central";
  shortcuts: HomeRegionInput;
  central: HomeRegionInput;
}) {
  const sc = useLayout("home");
  const ce = useLayout("home-central");

  const regions: EditorRegion[] = [
    {
      key: "home", label: shortcuts.label, items: shortcuts.items,
      arrangement: sc.arr ?? shortcuts.codeDefault, maxShown: shortcuts.maxShown,
      defaultArrangement: shortcuts.codeDefault, renderPreview: shortcuts.renderPreview,
      onApprove: (a, scope) => { void sc.save(a, scope); },
    },
    {
      key: "home-central", label: central.label, items: central.items,
      arrangement: ce.arr ?? central.codeDefault,
      defaultArrangement: central.codeDefault, renderPreview: central.renderPreview,
      onApprove: (a, scope) => { void ce.save(a, scope); },
    },
  ];

  return (
    <LayoutEditor
      he={he} title={he ? "עריכת מסך הבית" : "Edit Home"}
      canEditShared={sc.canEditShared} role={sc.role}
      regions={regions} initialRegionKey={initialKey}
      onClose={onClose}
    />
  );
}
