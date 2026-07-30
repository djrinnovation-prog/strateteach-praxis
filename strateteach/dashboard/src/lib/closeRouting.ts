// Single source of truth for the "close positions in profit" action.
//
// The app has two completely separate trading books:
//   • DEMO  → paper trading (virtual money, the `paper_*` endpoints)
//   • LIVE  → the connected exchange (REAL money, the `exchange/*` endpoints,
//             every one PIN-gated on the server)
//
// These must NEVER mix: a "close in profit" tap while in demo may only touch the
// paper book, and a tap while in live may only touch the exchange book. To keep
// that guarantee in one place, no component should branch on the raw
// `algo770_profit_mode` localStorage flag by hand — it asks this module instead.

export type ProfitMode = "demo" | "live";
export type Book = "paper" | "exchange";

// Normalize any stored/passed value to a safe mode. Anything that is not
// explicitly the string "live" collapses to "demo" — the safe, no-real-money
// default. So a missing, stale, or corrupt flag can never silently route a
// close to a live (real-money) endpoint.
export function normalizeMode(raw: unknown): ProfitMode {
  return raw === "live" ? "live" : "demo";
}

// What the in-profit drawer reads + calls for a given mode. The two modes map to
// physically different data sources and API methods; they share none of them.
export interface CloseRoute {
  mode: ProfitMode;
  book: Book;                 // which ledger this mode acts on
  realMoney: boolean;         // live = true (PIN-gated on the server)
  pnlQueryKey: string;        // react-query key for the positions / P&L read
  // Endpoint identifiers are the actual `api.*` method names, kept as strings so
  // this module stays dependency-free and unit-testable (no React, no api import).
  closeInProfitApi: "paperCloseProfitableAll" | "closeProfitable";
  closeAllApi: "paperCloseAllActive" | "closeSpot";
  invalidateKeys: string[];   // queries to refetch after a close
}

export const CLOSE_ROUTES: Record<ProfitMode, CloseRoute> = {
  demo: {
    mode: "demo",
    book: "paper",
    realMoney: false,
    pnlQueryKey: "paperSessions",
    closeInProfitApi: "paperCloseProfitableAll",
    closeAllApi: "paperCloseAllActive",
    invalidateKeys: ["paperSessions"],
  },
  live: {
    mode: "live",
    book: "exchange",
    realMoney: true,
    pnlQueryKey: "livePnl",
    closeInProfitApi: "closeProfitable",
    closeAllApi: "closeSpot",
    invalidateKeys: ["exBalanceOv", "exPositionsOv", "tkPrices", "livePnl"],
  },
};

export function routeFor(mode: unknown): CloseRoute {
  return CLOSE_ROUTES[normalizeMode(mode)];
}

export interface ProfitPos { symbol: string; pnl: number; pnlPct?: number; session?: string; }

// Positions currently in the green — the ONLY ones a "close in profit" action is
// ever allowed to touch. Used identically for both books so the displayed list
// always matches what the close button will actually close.
export function winnersOnly<T extends { pnl?: number | string | null }>(positions: T[]): T[] {
  return (positions || []).filter((p) => Number(p?.pnl ?? 0) > 0);
}

// Defensive guard: a close intent for one book must never carry the other book's
// endpoint. Throws (caller catches) rather than firing the wrong API — turning a
// would-be cross-book leak into a loud, safe failure instead of a real trade.
export function assertBookMatch(mode: unknown, api: string): void {
  const r = routeFor(mode);
  const allowed: string[] = [r.closeInProfitApi, r.closeAllApi];
  if (!allowed.includes(api)) {
    throw new Error(
      `close-routing leak blocked: mode='${r.mode}' (book=${r.book}) may not call '${api}'`,
    );
  }
}
