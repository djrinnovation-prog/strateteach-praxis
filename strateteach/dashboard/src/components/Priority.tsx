import React from "react";
import { C } from "../theme";

// ── Shared PRIORITY scheme — used by BOTH PM tasks and finance investments (Dan's spec):
//   🔴 red  = חשוב   / Important       (sorts to the TOP)
//   🟠 orange = לדיון  / For discussion
//   🟢 green = מאושר  / Approved
//   ⚪ none = ללא עדיפות / No priority  (default; no chip)
// Red → orange → green → none is the sort order (a chosen priority raises a task to the top).
export type PriorityKey = "red" | "orange" | "green" | "none";

export const PRIORITY_OPTS: { v: PriorityKey; he: string; en: string }[] = [
  { v: "none",   he: "ללא עדיפות", en: "No priority" },
  { v: "red",    he: "חשוב",       en: "Important" },
  { v: "orange", he: "לדיון",       en: "For discussion" },
  { v: "green",  he: "מאושר",      en: "Approved" },
];

// Traffic-light colors from the peach theme tokens: red=loss, orange=gold(amber), green=gain.
export const priorityColor = (p?: string): string =>
  p === "red" ? C.loss : p === "orange" ? C.gold : p === "green" ? C.gain : C.faint;

// Sort weight: lower = higher up the list. none sinks to the bottom.
export const PRIORITY_WEIGHT: Record<string, number> = { red: 0, orange: 1, green: 2, none: 3 };
export const priorityWeight = (p?: string): number => PRIORITY_WEIGHT[p || "none"] ?? 3;

const LBL: Record<string, { he: string; en: string }> = Object.fromEntries(PRIORITY_OPTS.map((o) => [o.v, { he: o.he, en: o.en }]));

// A colored priority chip (dot + label). Renders NOTHING for "none" so unprioritized rows stay clean.
export function PriorityChip({ priority, he }: { priority?: string; he: boolean }) {
  if (!priority || priority === "none") return null;
  const col = priorityColor(priority);
  const l = LBL[priority] || { he: priority, en: priority };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: col,
      background: `${col}1a`, border: `1px solid ${col}55`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: col, flexShrink: 0 }} />
      {he ? l.he : l.en}
    </span>
  );
}

// A compact priority <select> for the editors (owners board + portal Tasks + investment form).
export function PrioritySelect({ value, onChange, he, style }: {
  value: string; onChange: (v: string) => void; he: boolean; style?: React.CSSProperties;
}) {
  return (
    <select value={value || "none"} onChange={(e) => onChange(e.target.value)} style={style}>
      {PRIORITY_OPTS.map((o) => <option key={o.v} value={o.v}>{he ? o.he : o.en}</option>)}
    </select>
  );
}
