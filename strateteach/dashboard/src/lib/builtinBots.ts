// The three system "770" bots — hardcoded FRONTEND presets (same ids the Scanner
// and Backtest engine accept). They are NOT user-saved rows, so they never appear
// in api.savedStrategies(); we surface them explicitly as BUILT-IN, read-only
// entries so every user sees ALL their strategies = these bots + their own customs.
//
// IMPORTANT: the `id` values (bot8c / bot4 / bot1) are the engine contract and must
// NEVER change. What users SEE is the display label only — "Strategy N" / "אסטרטגיה N"
// (strategyLabel), keeping the same number the id carries. Descriptions are kept
// generic on purpose (no indicator/structure internals).
import { isOwner } from "../app/api";

export type BuiltinBot = { id: string; name: string; desc: { he: string; en: string } };

// Generic, internals-free description shown to users in place of any copy that used
// to name the algorithm's internals (indicators / structure). Single short line.
export const STRATEGY_DESC: { he: string; en: string } = {
  he: "אנחנו משתמשים באלגוריתם שלנו שפותח על בסיס למידה.",
  en: "We use our own algorithm, developed with machine learning.",
};

export const BUILTIN_BOTS: BuiltinBot[] = [
  { id: "bot8c", name: "BOT(8C)-770", desc: { ...STRATEGY_DESC } },
  { id: "bot4", name: "BOT4-770", desc: { ...STRATEGY_DESC } },
  { id: "bot1", name: "BOT1-770", desc: { ...STRATEGY_DESC } },
];

// Extract the strategy NUMBER from an id ("bot8c" → 8, "bot4" → 4, "bot1" → 1).
// Returns null when the id carries no number (e.g. a freeform saved custom).
export function strategyNumber(id: string | null | undefined): number | null {
  const m = String(id || "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// The ONE client-facing strategy is bot8c, and users meet it as "Strategy 1" — a
// single, clean offering rather than a confusing numbered catalogue. OWNERS keep the
// true engine numbers (8 / 4 / 1) so they can still tell the internals apart.
const PUBLIC_DISPLAY_NUMBER: Record<string, number> = { bot8c: 1 };

// User-facing display label: "Strategy N" / "אסטרטגיה N". Falls back to the raw id
// when it carries no number.
export function strategyLabel(id: string | null | undefined, lang: "he" | "en"): string {
  const n = strategyNumber(id);
  if (n == null) return String(id || "");
  const pub = PUBLIC_DISPLAY_NUMBER[String(id || "")];
  const shown = !isOwner() && pub != null ? pub : n;
  return lang === "he" ? `אסטרטגיה ${shown}` : `Strategy ${shown}`;
}

// Visibility gate. The FULL strategy list (2..7, the proprietary internals) is
// OWNER-only; everyone else — including a non-owner ADMIN (Oren) — sees/selects ONLY
// the user-facing strategy 1 and strategy 8. Pass `seeAll` = api.isOwner().
// Clients see exactly ONE strategy — bot8c (presented as "Strategy 1"). Everything
// else (the proprietary internals) is OWNER-only, including for a non-owner ADMIN.
const USER_VISIBLE_NUMBERS = [8];
export function isStrategyVisible(id: string | null | undefined, seeAll: boolean): boolean {
  if (seeAll) return true;
  const n = strategyNumber(id);
  return n != null && USER_VISIBLE_NUMBERS.includes(n);
}

// The built-in bots a given user may see/select (all for OWNERS; 1 & 8 otherwise).
export function visibleBuiltinBots(seeAll: boolean): BuiltinBot[] {
  return BUILTIN_BOTS.filter((b) => isStrategyVisible(b.id, seeAll));
}
