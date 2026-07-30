import React, { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Loader2, AlertCircle, Diamond, ArrowRight, TrendingUp, ChevronDown, Search, Columns3, Coins, BarChart3, Gem, Droplet } from "lucide-react";
import ScreenShortcuts from "../components/ScreenShortcuts";
import { ErrorState } from "../components/StateBlock";
import { track, ev, resultBucket, type MarketClass } from "../lib/analytics";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, isAdmin, isOwner } from "../app/api";
import { strategyLabel, isStrategyVisible } from "../lib/builtinBots";
import { useI18n } from "../i18n";
import { C, UI, MONO, tierInfo, SHADOW } from "../theme";
import { ExportBar } from "../ui";
import { useDeepLinkTab } from "../lib/useDeepLinkTab";
import DailyScanCard from "../components/DailyScanCard";
import { HubPanel } from "../components/HubScreen";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { useIsMobile } from "../lib/useIsMobile";
import type { TrendColor } from "../lib/types";

// Ported from the original Replit client's signals.tsx — the 3-color Trend
// Scanner: a daily Green/Grey/Red history chart + a per-symbol transitions table.
// Built-in system strategies. `id` is the engine contract; the DISPLAY label is
// derived via strategyLabel ("Strategy N" / "אסטרטגיה N"). Descriptions are kept
// generic (no indicator/structure internals).
const STRAT: { id: string; desc: { he: string; en: string } }[] = [
  { id: "bot8c", desc: { he: "אנחנו משתמשים באלגוריתם שלנו שפותח על בסיס למידה.", en: "We use our own algorithm, developed with machine learning." } },
  { id: "bot4", desc: { he: "אנחנו משתמשים באלגוריתם שלנו שפותח על בסיס למידה.", en: "We use our own algorithm, developed with machine learning." } },
  { id: "bot1", desc: { he: "אנחנו משתמשים באלגוריתם שלנו שפותח על בסיס למידה.", en: "We use our own algorithm, developed with machine learning." } },
];
const CRYPTO_LIMITS = [10, 50, 100, 250, 500];
const BUCKETS = ["all", "crypto", "stocks", "metals", "commodities"] as const;
// Trend colours route through the THEME's semantic tokens (green up / red down / neutral
// muted) via getters, so the 3-colour model adapts to every skin + light/dark instead of
// being pinned to fixed literals. Every `HEX.Green|Red|Grey` and `HEX[color]` read below
// keeps working unchanged — the getter just resolves against the active palette.
const HEX: Record<TrendColor, string> = {
  get Green() { return C.gain; },
  get Grey() { return C.muted; },
  get Red() { return C.loss; },
};

const STR = {
  he: {
    title: "סורק מגמות", sub: "מודל מגמה ב-3 צבעים", refresh: "רענון", strategy: "אסטרטגיה:", crypto: "קריפטו:",
    legendG: "ירוק = מגמת עלייה (עסקה פתוחה)", legendN: "אפור = ניטרלי (החזקה)", legendR: "אדום = מגמת ירידה (עסקה סגורה)",
    histTitle: "היסטוריית מגמות", histHint: "ספירה יומית של ירוק / אפור / אדום על פני כל הנכסים שנסרקו",
    green: "ירוק", grey: "אפור", red: "אדום", open: "פתוחה", closed: "סגורה", trade: "סחר",
    loading: "סורק שווקים…", loadingHint: "מושך מחירים חיים ומחשב צבעי מגמה", failed: "הסריקה נכשלה",
    scanned: (n: number) => `נסרקו ${n} נכסים`, updated: (s: string) => `· עודכן ${s}`, noRows: "אין נכסים שתואמים את הסינון",
    topBreak: "20 הפריצות המובילות היום", forEngine: "מזין את מנוע המסחר", buildPlan: "בנה תוכנית רווח",
    breakMinHint: (n: number) => `${n} פריצות היום · הקישו להרחבה`,
    lastRun: "בקטסט אחרון להיום", viewRuns: "לכל הבדיקות", noBreak: "אין פריצות כרגע", price: "מחיר", toGreen: "לאזור הירוק",
    top10: { title: "10 הפריצות המובילות היום", sym: "נכס", above: "% מעל קו הפריצה", price: "מחיר", today: "שינוי היום", todayHint: "שינוי היום · ירוק = עלייה, אדום = ירידה", empty: "אין פריצות עדיין", loading: "טוען פריצות…" },
    bucket: { all: "הכל", crypto: "קריפטו", stocks: "מניות", metals: "מתכות", commodities: "סחורות" } as Record<string, string>,
    cmp: { tile: "מנוע השוואת אסטרטגיות", title: "השוואת אסטרטגיות", sub: "טופ הפריצות של כל אסטרטגיה — זו לצד זו", top10: "טופ 10", top100: "טופ 100",
      shared: "משותף לכולן", unique: "ייחודי", only: "רק כאן", none: "אין תוצאות עדיין", loading: "סורק את כל האסטרטגיות…", loadingHint: "מושך מחירים פעם אחת ומדרג בכל אסטרטגיה",
      scanned: (n: number) => `${n} סמלים בכל אסטרטגיה`, empty: "אין פריצות פעילות כרגע", legend: "צבע התא = הדירוג של הסמל באסטרטגיה", aboveLine: "% מעל קו הפריצה" },
    th: { asset: "נכס", ticker: "טיקר", trend: "מגמה", range: "טווח?", changed: "שינוי מגמה", status: "סטטוס", opened: "תאריך פתיחה", pnl: "רווח/הפסד נטו %", tf: "טווח זמן" },
  },
  en: {
    title: "Trend Scanner", sub: "3-color trend model", refresh: "Refresh", strategy: "Strategy:", crypto: "Crypto:",
    legendG: "Green = uptrend (trade open)", legendN: "Grey = neutral (hold)", legendR: "Red = downtrend (trade closed)",
    histTitle: "Trend History", histHint: "Daily count of Green / Grey / Red across the scanned universe",
    green: "Green", grey: "Grey", red: "Red", open: "OPEN", closed: "CLOSED", trade: "Trade",
    loading: "Scanning markets…", loadingHint: "Fetching live prices and computing trend colors", failed: "Scan failed",
    scanned: (n: number) => `${n} symbols scanned`, updated: (s: string) => `· Updated ${s}`, noRows: "No symbols match this filter",
    topBreak: "Today's top 20 breakouts", forEngine: "feeds the trading engine", buildPlan: "Build profit plan",
    breakMinHint: (n: number) => `${n} breakouts today · tap to expand`,
    lastRun: "Latest backtest today", viewRuns: "All runs", noBreak: "No breakouts right now", price: "Price", toGreen: "To green zone",
    top10: { title: "Today's top-10 breakouts", sym: "Symbol", above: "% above breakout line", price: "Price", today: "Today's move", todayHint: "Today's move · green = up, red = down", empty: "No breakouts yet", loading: "Loading breakouts…" },
    bucket: { all: "all", crypto: "crypto", stocks: "stocks", metals: "metals", commodities: "commodities" } as Record<string, string>,
    cmp: { tile: "Strategy comparison", title: "Compare strategies", sub: "Each strategy's top breakouts — side by side", top10: "Top 10", top100: "Top 100",
      shared: "Shared by all", unique: "Unique", only: "only here", none: "No results yet", loading: "Scanning all strategies…", loadingHint: "Fetches prices once, ranks under every strategy",
      scanned: (n: number) => `${n} symbols per strategy`, empty: "No active breakouts right now", legend: "Cell color = the symbol's rank in that strategy", aboveLine: "% above breakout line" },
    th: { asset: "Asset", ticker: "Ticker", trend: "Trend", range: "Range?", changed: "Trend Changed", status: "Status", opened: "Date Opened", pnl: "Net P&L %", tf: "Timeframe" },
  },
};

export default function Scanner() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const t = STR[lang];
  const nav = useNavigate();
  const mobile = useIsMobile();
  // Same admin flag used app-wide: regular users see only strategy 1 & 8.
  const admin = isAdmin();
  const visStrat = STRAT.filter((s) => isStrategyVisible(s.id, isOwner()));
  const [strategy, setStrategy] = useState("bot8c");
  const [cryptoLimit, setCryptoLimit] = useState(250); // agreed default crypto universe (was 10 → 100 → 250)
  const [bucket, setBucket] = useState<string>("all");
  useDeepLinkTab(setBucket, ["all", "crypto", "stocks", "metals", "commodities"]); // promo ?tab=<bucket> preselects a bucket
  const [openSym, setOpenSym] = useState<string | null>(null);
  const [breakMin, setBreakMin] = useState(true); // Breakouts list collapsed by default (compact summary); expand → Top-20
  // This screen IS "Daily scan" (סריקה יומית) — its name in Home tools, the menu and
  // Dashboard all route here as "Daily scan". So it OPENS on the daily-scan section by
  // default; otherwise the user landed on the hub with no daily view showing at all (the
  // reported "the daily-scan screen doesn't appear"). A ?tab=<section> deep-link can still
  // open a different section (buckets and sections are disjoint keys, so this coexists with
  // the bucket deep-link above without clashing).
  // URL-driven child navigation (Back returns to the launcher) — the finalized model.
  // `ssec`/`setSsec` are ALIASED to the ?sec= URL param so every existing `ssec === …`
  // section + `setSsec(…)` call site keeps working unchanged; default = "" (launcher).
  const [sp, setSp] = useSearchParams();
  const ssec = sp.get("sec") || "";
  const setSsec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_scanner_more_view_v1", "cards");
  const breakoutsRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const scrollTo = (r: React.RefObject<HTMLDivElement>) => setTimeout(() => r.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  const [compareTop, setCompareTop] = useState<10 | 100>(10); // Top-10 ⇄ Top-100 toggle for the comparison

  // Canonical analytics: viewing the scanner, and each scan run + its result bucket.
  const marketClass = (): MarketClass => (bucket === "all" ? "crypto" : (bucket as MarketClass));
  useEffect(() => { ev.scannerViewed(); }, []);
  const savedQ = useQuery({ queryKey: ["savedStrategies"], queryFn: () => api.savedStrategies() });
  const q = useQuery({
    queryKey: ["trendScan", strategy, cryptoLimit],
    queryFn: () => api.trendScan({ cryptoLimit, strategy }),
  });
  // Fetch breakouts across EVERY market (crypto/stocks/metals/commodities), not
  // just crypto — otherwise the card is empty whenever the only breakouts are in
  // stocks/commodities/metals (e.g. Coffee, AAPL). Metals & commodities default to
  // the full universe server-side; a stock_limit covers the majors (AAPL is #1).
  const breakoutsQ = useQuery({ queryKey: ["breakouts", cryptoLimit], queryFn: () => api.breakouts(["crypto", "stocks", "metals", "commodities"], Math.max(20, cryptoLimit), 20), refetchInterval: 30000, refetchOnWindowFocus: true });
  const runsQ = useQuery({ queryKey: ["runs"], queryFn: () => api.listRuns() });
  // Compare: lazily runs only when its tile is open. One backend fetch ranks all
  // built-in strategies (top-100); we slice to Top-10/100 client-side via the toggle.
  const compareQ = useQuery({
    queryKey: ["compareStrategies"],
    queryFn: () => api.compareStrategies({ cryptoLimit: 100, top: 100 }),
    enabled: ssec === "compare",
    staleTime: 60_000,
    // The compare fetch is bounded server-side (per-symbol + overall timeout) and
    // client-side (request timeout). Don't retry: surface the real error/empty
    // state at once rather than spinning through 3 silent retries.
    retry: 0,
  });
  const allBreakouts = (breakoutsQ.data as any[]) || [];
  // Breakouts tile (Top-20): the server ranks breaking_out-first across all buckets,
  // so the first rows are already the strongest breakouts across every market.
  const topBreaks = allBreakouts.slice(0, 20);
  // ── Today's top-10 breakouts CARD (top of screen) ──
  // Show the ACTUAL breakouts across EVERY market — not crypto-only, not today-only:
  // keep genuine breaking_out rows, sort by pctToGreen ASC (most-negative = furthest
  // ABOVE the breakout band = strongest), take the top 10. Only a truly empty
  // breaking_out set shows "No breakouts yet".
  const top10 = allBreakouts
    .filter((s: any) => s.tier === "breaking_out")
    .sort((a: any, b: any) => (a.pctToGreen ?? 0) - (b.pctToGreen ?? 0))
    .slice(0, 10);
  const lastRun = ((runsQ.data as any[]) || [])[0];

  // Derived comparison: each strategy sliced to the active Top-N, plus a per-symbol
  // presence count so we can mark "shared by all" vs "unique to one strategy".
  const compare = useMemo(() => {
    // Regular users compare only the strategies they can see (1 & 8); admins see all.
    const strats = ((compareQ.data?.strategies ?? []) as any[]).filter((s) => isStrategyVisible(s.id, isOwner())).map((s) => ({
      ...s,
      // Real breakouts only: pctToGreen <= 0 means price is already AT/ABOVE the breakout
      // line. Sort most-above-first (display = -pctToGreen, descending ⇔ pctToGreen ascending),
      // THEN take the active Top-N — so up to N genuine breakouts show.
      rows: ((s.results ?? []) as any[])
        .filter((r: any) => typeof r.pctToGreen === "number" && r.pctToGreen <= 0)
        .sort((a: any, b: any) => a.pctToGreen - b.pctToGreen)
        .slice(0, compareTop),
    }));
    const count: Record<string, number> = {};
    strats.forEach((s) => s.rows.forEach((r: any) => { count[r.symbol] = (count[r.symbol] || 0) + 1; }));
    const total = strats.length;
    const sharedAll = total > 1 ? Object.keys(count).filter((k) => count[k] === total) : [];
    return { strats, count, total, sharedAll };
  }, [compareQ.data, compareTop, admin]);

  const data: any = q.data;
  const rows = useMemo(() => (data?.scanner ?? []).filter((r: any) => bucket === "all" || r.bucket === bucket), [data, bucket]);
  // Fire scanner_run_completed once per finished fetch, bucketing the result count.
  useEffect(() => {
    if (q.dataUpdatedAt && !q.isFetching) ev.scannerRunCompleted(marketClass(), resultBucket(rows.length));
  }, [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = (savedQ.data ?? []) as any[];
  const stratLabel = STRAT.find((s) => s.id === strategy)
    ? strategyLabel(strategy, lang)
    : (saved.find((s) => `saved_${s.id}` === strategy)?.name ?? strategyLabel(strategy, lang));

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {ssec === "" && (
        <>
          <FramedTitle text={t.title} subtitle={t.sub} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="scanner"
            defaultKeys={["crypto", "stocks", "metals", "commodities", "compare"]}
            onMore={() => setSsec("more")}
            catalog={[
              { key: "crypto", label: he ? "קריפטו" : "Crypto", Icon: Coins, onClick: () => { setBucket("crypto"); setSsec("scan"); } },
              { key: "stocks", label: he ? "מניות" : "Stocks", Icon: BarChart3, onClick: () => { setBucket("stocks"); setSsec("scan"); } },
              { key: "metals", label: he ? "מתכות" : "Metals", Icon: Gem, onClick: () => { setBucket("metals"); setSsec("scan"); } },
              { key: "commodities", label: he ? "סחורות" : "Commodities", Icon: Droplet, onClick: () => { setBucket("commodities"); setSsec("scan"); } },
              { key: "compare", label: he ? "השוואה" : "Compare", Icon: Columns3, onClick: () => setSsec("compare") },
              { key: "daily", label: he ? "סריקה יומית" : "Auto daily", Icon: Search, onClick: () => setSsec("daily") },
            ]}
          />

          {/* Central glass buttons — now EDITABLE via SquareRow (choose which appear + order +
              APPROVE + reset; owner sets the default, users override). The screen's own 3 are
              shown by default; the shared app-destinations pool is addable from the ✎ editor. */}
          <SquareRow screenKey="scanner-central" mobile={mobile} defaultShown={["daily", "breakouts", "compare"]}
            squares={[
              { id: "daily", variant: "primary", Icon: Search, label: he ? "סריקה יומית" : "Daily scan", sub: he ? "אוטומטי" : "auto", onClick: () => setSsec("daily") },
              { id: "breakouts", variant: "secondary", Icon: TrendingUp, label: he ? "פריצות" : "Breakouts", sub: he ? "טופ היום" : "today's top", onClick: () => setSsec("breakouts") },
              { id: "compare", variant: "secondary", Icon: Columns3, label: he ? "השוואה" : "Compare", sub: he ? "אסטרטגיות" : "strategies", onClick: () => setSsec("compare") },
              ...centralExtras(he, nav, { exclude: ["scanner"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the scanner areas as a tile grid with a rows/tiles toggle. ── */}
      {ssec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי הסריקה" : "All scanner areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="scanner-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "daily", label: he ? "סריקה יומית" : "Daily scan", Icon: Search, onClick: () => setSsec("daily") },
            { id: "scan", label: he ? "סריקת מגמות" : "Trend scan", Icon: Diamond, onClick: () => setSsec("scan") },
            { id: "breakouts", label: he ? "פריצות" : "Breakouts", Icon: TrendingUp, onClick: () => setSsec("breakouts") },
            { id: "compare", label: he ? "השוואה" : "Compare", Icon: Columns3, onClick: () => setSsec("compare") },
            { id: "crypto", label: he ? "קריפטו" : "Crypto", Icon: Coins, onClick: () => { setBucket("crypto"); setSsec("scan"); } },
            { id: "stocks", label: he ? "מניות" : "Stocks", Icon: BarChart3, onClick: () => { setBucket("stocks"); setSsec("scan"); } },
            { id: "metals", label: he ? "מתכות" : "Metals", Icon: Gem, onClick: () => { setBucket("metals"); setSsec("scan"); } },
            { id: "commodities", label: he ? "סחורות" : "Commodities", Icon: Droplet, onClick: () => { setBucket("commodities"); setSsec("scan"); } },
            { id: "engine", label: he ? "מנוע מסחר" : "Trading Engine", Icon: TrendingUp, onClick: () => nav("/profit") },
          ]} />
        </div>
      )}

      {/* ── TOP of the Breakouts child: today's top-10 breakouts table. Reuses the SAME breakouts
          data source (breakoutsQ → api.breakouts) and semantics (% above the breakout
          line = -pctToGreen, sorted as the source already provides) as the Breakouts
          tile below. Loading + empty states included; RTL-aware + mobile-responsive. */}
      {ssec === "breakouts" && (
      <div ref={breakoutsRef} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: SHADOW, scrollMarginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 800, fontSize: 15 }}>
            <TrendingUp size={16} color={C.gold} /> {t.top10.title}
            {top10.length > 0 && <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>({top10.length})</span>}
          </span>
          <button onClick={() => nav("/profit")} style={{ ...pill(true), fontSize: 11 }}>{t.buildPlan}</button>
        </div>
        <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontFamily: MONO, fontWeight: 700, color: HEX.Green }}>+%</span> {t.top10.todayHint}
        </div>
        {breakoutsQ.isError ? (
          <ErrorState compact onRetry={() => breakoutsQ.refetch()} retrying={breakoutsQ.isFetching} screen="scanner"
            title={lang === "he" ? "לא הצלחנו לטעון פריצות" : "Couldn't load breakouts"} />
        ) : breakoutsQ.isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: C.muted, fontSize: 13, padding: "20px 0" }}>
            <Loader2 size={16} className="spin" color={C.gold} /> {t.top10.loading}
          </div>
        ) : top10.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, padding: "22px 0", textAlign: "center" }}>{t.top10.empty}</div>
        ) : (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                  <th style={th("center")}>#</th>
                  <th style={th("start")}>{t.top10.sym}</th>
                  <th style={th("end")}>{t.top10.price}</th>
                  <th style={th("end")}>{t.top10.today}</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((s: any, i: number) => {
                  const ti = tierInfo(s.tier);
                  // Color/value by the asset's actual DIRECTION today: up = green, down = red.
                  // (We no longer surface the -pctToGreen "% above the band" here — a strong
                  // breakout that's DOWN today reading green was the confusing bit.)
                  const today = s.changeTodayPct;
                  return (
                    <tr key={s.symbol} onClick={() => {
                        const base = String(s.symbol || "").split("/")[0].toUpperCase();
                        if (base) { try { localStorage.setItem("algo770_profit_mode", "demo"); sessionStorage.setItem("algo770_pe_prefill", base); } catch (_e) { /* */ } }
                        nav("/profit");
                      }} title={lang === "he" ? `פתחו ריצה על ${s.symbol}` : `Start a run on ${s.symbol}`}
                      style={{ borderBottom: i === top10.length - 1 ? "none" : `1px solid ${C.line}`, cursor: "pointer" }}>
                      <td style={{ ...td(rtl), textAlign: "center", color: C.faint, fontFamily: MONO, fontSize: 12, width: 34 }}>{i + 1}</td>
                      <td style={{ ...td(rtl), whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <Diamond size={11} color={ti.c} fill={ti.fill ? ti.c : "none"} />
                          <span style={{ fontWeight: 700, fontFamily: MONO }}>{s.symbol}</span>
                          {s.name && s.name !== s.symbol && <span style={{ fontSize: 11, color: C.muted }}>{s.name}</span>}
                          {s.bucket && <span style={{ padding: "1px 7px", borderRadius: 999, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: C.blue, border: `1px solid ${C.blue}44`, background: `${C.blue}14` }}>{t.bucket[s.bucket] ?? s.bucket}</span>}
                        </span>
                      </td>
                      <td style={{ ...td(rtl), textAlign: "end", fontFamily: MONO, color: C.muted, whiteSpace: "nowrap" }}>{typeof s.currentPrice === "number" ? (s.currentPrice >= 1 ? s.currentPrice.toFixed(2) : s.currentPrice.toFixed(5)) : "—"}</td>
                      <td style={{ ...td(rtl), textAlign: "end", fontFamily: MONO, fontWeight: 700, color: typeof today === "number" ? (today >= 0 ? HEX.Green : HEX.Red) : C.muted, whiteSpace: "nowrap" }}>{typeof today === "number" ? `${today > 0 ? "+" : ""}${today.toFixed(1)}%` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Scroll anchor kept for the shortcut-driven section jumps. */}
      <div ref={sectionRef} aria-hidden style={{ scrollMarginTop: 8 }} />

      {/* ── Scan: pickers + bucket filter + the trend table (scrolls internally) ── */}
      {ssec === "scan" && (
      <HubPanel ns="scanner" id="scan" title={t.title} icon={<Diamond size={15} />} onClose={() => setSsec("")}>
        {/* toolbar: Refresh + export (Excel/PDF/Email) — preserved from the old header. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={() => { track("scan_run", { source: "scanner" }); ev.scannerRunStarted(marketClass()); q.refetch(); }} disabled={q.isFetching} className="tap44" style={pill(true)}>
            <RefreshCw size={13} className={q.isFetching ? "spin" : ""} /> {t.refresh}
          </button>
          <span style={{ fontSize: 11.5, color: C.muted }}>{t.sub} · {stratLabel}{q.dataUpdatedAt ? ` ${t.updated(new Date(q.dataUpdatedAt).toLocaleTimeString())}` : ""}{data?.scanner?.length ? ` · ${t.scanned(data.scanner.length)}` : ""}</span>
          <span style={{ flex: 1 }} />
          <ExportBar name="scanner" title={t.title} rtl={rtl}
            headers={[t.th.asset, t.th.ticker, t.th.trend, t.th.status, t.th.opened, t.th.pnl, t.th.tf]}
            rows={rows.map((r: any) => [r.asset, r.ticker, `${r.trendFrom} → ${r.trendTo}`, r.status, r.openDate ?? "", r.netPnlPct == null ? "" : `${r.netPnlPct.toFixed(2)}%`, r.timeframe])} />
        </div>
        {/* pickers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted }}>{t.strategy}</span>
            {visStrat.map((s) => <Pill key={s.id} on={strategy === s.id} title={s.desc[lang]} onClick={() => setStrategy(s.id)}>{strategyLabel(s.id, lang)}</Pill>)}
            {saved.map((s) => <Pill key={s.id} on={strategy === `saved_${s.id}`} onClick={() => setStrategy(`saved_${s.id}`)}>{s.name && s.name !== "Strategy" ? s.name : `${strategyLabel(s.strategyId || "770", lang)} #${s.id}`}</Pill>)}
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginInlineStart: 8 }}>{t.crypto}</span>
            {CRYPTO_LIMITS.map((l) => <Pill key={l} on={cryptoLimit === l} onClick={() => setCryptoLimit(l)}>{l}</Pill>)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 11, color: C.muted }}>
            <Legend2 c={HEX.Green} label={t.legendG} /><Legend2 c={HEX.Grey} label={t.legendN} /><Legend2 c={HEX.Red} label={t.legendR} />
          </div>
        </div>

        {/* bucket filter */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {BUCKETS.map((b) => (
            <button key={b} onClick={() => setBucket(b)} style={{ ...pill(bucket === b), borderRadius: 999, padding: "4px 13px", fontSize: 12 }}>
              {t.bucket[b]}
            </button>
          ))}
        </div>

        {q.isLoading ? (
          <Center><Loader2 size={32} className="spin" color={C.gold} /><p style={{ fontWeight: 600, marginTop: 12 }}>{t.loading}</p><p style={{ fontSize: 13, color: C.muted }}>{t.loadingHint}</p></Center>
        ) : q.isError ? (
          <Center><AlertCircle size={32} color={C.loss} /><p style={{ fontWeight: 600, marginTop: 12 }}>{t.failed}</p><button onClick={() => q.refetch()} style={{ ...pill(false), marginTop: 12 }}><RefreshCw size={13} /> {t.refresh}</button></Center>
        ) : (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflowX: "auto", overflowY: "auto", maxHeight: "60svh" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.line}` }}>
                  {[t.th.asset, t.th.ticker, t.th.trend, t.th.range, t.th.changed, t.th.status, t.th.opened].map((h, i) => <th key={i} style={th("start")}>{h}</th>)}
                  <th style={th("end")}>{t.th.pnl}</th>
                  <th style={th("center")}>{t.th.tf}</th>
                  <th style={{ padding: "10px 12px" }} />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: C.muted, padding: 40 }}>{t.noRows}</td></tr>}
                {rows.map((r: any) => {
                  const pnlC = r.netPnlPct == null ? C.muted : r.netPnlPct >= 0 ? HEX.Green : HEX.Red;
                  return (
                    <tr key={`${r.bucket}:${r.symbol}`} onClick={() => {
                        const base = String(r.symbol || r.ticker || "").split("/")[0].toUpperCase();
                        if (r.bucket === "crypto" && base) { try { localStorage.setItem("algo770_profit_mode", "demo"); sessionStorage.setItem("algo770_pe_prefill", base); } catch (_e) { /* */ } }
                        nav("/profit");
                      }} title={lang === "he" ? `פתחו ריצה על ${r.asset}` : `Start a run on ${r.asset}`} style={{ borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
                      <td style={{ ...td(rtl), fontWeight: 600, whiteSpace: "nowrap" }}>{r.asset}</td>
                      <td style={{ ...td(rtl), color: C.muted, fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}>{r.ticker}</td>
                      <td style={td(rtl)}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                          <Chip color={r.trendFrom} label={colorName(t, r.trendFrom)} />
                          <ArrowRight size={12} color={C.muted} />
                          <Chip color={r.trendTo} label={colorName(t, r.trendTo)} />
                        </span>
                      </td>
                      <td style={{ ...td(rtl), fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{r.range ?? "—"}</td>
                      <td style={{ ...td(rtl), fontSize: 12, whiteSpace: "nowrap" }}>{r.trendChanged}</td>
                      <td style={td(rtl)}>
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, border: `1px solid ${r.status === "OPEN" ? `${HEX.Green}4d` : C.line}`, color: r.status === "OPEN" ? HEX.Green : C.muted, background: r.status === "OPEN" ? `${HEX.Green}1f` : C.surface2 }}>
                          {r.status === "OPEN" ? t.open : t.closed}
                        </span>
                      </td>
                      <td style={{ ...td(rtl), fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{r.openDate ?? "—"}</td>
                      <td style={{ ...td(rtl), textAlign: "end", fontWeight: 700, color: pnlC, whiteSpace: "nowrap" }}>{r.netPnlPct == null ? "—" : `${r.netPnlPct > 0 ? "+" : ""}${r.netPnlPct.toFixed(2)}%`}</td>
                      <td style={{ ...td(rtl), textAlign: "center", fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{r.timeframe}</td>
                      <td style={{ ...td(rtl), whiteSpace: "nowrap" }}>
                        {r.bucket === "crypto" && r.status === "OPEN" && (
                          <button onClick={(e) => { e.stopPropagation(); nav("/exchange"); }} style={{ ...pill(false), padding: "5px 10px", fontSize: 12 }}><TrendingUp size={12} /> {t.trade}</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </HubPanel>
      )}

      {/* ── Breakouts: live Top-20 today, minimizable (feeds the trading engine) + today's latest backtest ── */}
      {ssec === "breakouts" && (
      <HubPanel ns="scanner" id="breakouts" title={t.topBreak} icon={<TrendingUp size={15} />} onClose={() => setSsec("")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: SHADOW }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              {/* collapse/expand control — tap the title to toggle the live Top-20 list (collapsed by default for tidiness) */}
              <button onClick={() => setBreakMin((m) => !m)} aria-expanded={!breakMin} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", color: C.text }}>
                <ChevronDown size={16} color={C.faint} style={{ transform: breakMin ? (rtl ? "rotate(90deg)" : "rotate(-90deg)") : "none", transition: "transform .2s", flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 15 }}>{t.topBreak}</span>
                {topBreaks.length > 0 && <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>({topBreaks.length})</span>}
              </button>
              <button onClick={() => nav("/profit")} style={{ ...pill(true), fontSize: 11 }}>{t.buildPlan}</button>
            </div>
            <div style={{ fontSize: 11, color: C.gold, marginBottom: 4 }}>◆ {t.forEngine}</div>
            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ fontFamily: MONO, fontWeight: 700, color: HEX.Green }}>+%</span> {t.top10.todayHint}</div>
            {breakMin ? (
              // collapsed: a compact one-line summary (today's count) — tap to expand the full Top-20
              <div onClick={() => setBreakMin(false)} className="tap44" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.muted, cursor: "pointer", padding: "6px 0" }}>
                {breakoutsQ.isLoading ? <Loader2 size={14} className="spin" /> : topBreaks.length === 0 ? t.noBreak : t.breakMinHint(topBreaks.length)}
              </div>
            ) : breakoutsQ.isLoading ? <div style={{ color: C.muted, fontSize: 13, padding: "10px 0" }}><Loader2 size={14} className="spin" /></div>
              : topBreaks.length === 0 ? <div style={{ color: C.muted, fontSize: 13, padding: "10px 0" }}>{t.noBreak}</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: "52svh", overflowY: "auto" }}>
                  {topBreaks.map((s: any, i: number) => {
                    const ti = tierInfo(s.tier);
                    const open = openSym === s.symbol;
                    return (
                      <div key={s.symbol} style={{ borderBottom: i === topBreaks.length - 1 ? "none" : `1px solid ${C.line}` }}>
                        <div onClick={() => setOpenSym(open ? null : s.symbol)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 4px", cursor: "pointer" }}>
                          <span style={{ width: 18, color: C.faint, fontFamily: MONO, fontSize: 12 }}>{i + 1}</span>
                          <Diamond size={11} color={ti.c} fill={ti.fill ? ti.c : "none"} />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.symbol}</span>
                          {typeof s.currentPrice === "number" && <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{s.currentPrice >= 1 ? s.currentPrice.toFixed(2) : s.currentPrice.toFixed(5)}</span>}
                          {/* BOTH metrics per row: primary "% above the breakout line" + secondary "today's change". */}
                          <MetricPair
                            above={typeof s.pctToGreen === "number" ? -s.pctToGreen : null}
                            today={typeof s.changeTodayPct === "number" ? s.changeTodayPct : null}
                            he={lang === "he"} />
                          <ChevronDown size={13} color={C.faint} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
                        </div>
                        {open && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", padding: "4px 8px 12px 30px", fontSize: 11.5, direction: rtl ? "rtl" : "ltr" }}>
                            <div><span style={{ color: C.faint }}>{lang === "he" ? "פריצה החלה" : "Breakout started"}: </span><b>{s.breakoutDate || "—"}</b></div>
                            <div><span style={{ color: C.faint }}>{lang === "he" ? "אתמול" : "Yesterday"}: </span><b style={{ color: (s.changeYesterdayPct ?? 0) >= 0 ? HEX.Green : HEX.Red }}>{typeof s.changeYesterdayPct === "number" ? `${s.changeYesterdayPct > 0 ? "+" : ""}${s.changeYesterdayPct.toFixed(1)}%` : "—"}</b></div>
                            <div><span style={{ color: C.faint }}>{lang === "he" ? "עדיין ירוק?" : "Still green?"}: </span><b style={{ color: s.stillGreen ? HEX.Green : HEX.Red }}>{s.stillGreen ? (lang === "he" ? "כן ✓" : "Yes ✓") : (lang === "he" ? "לא" : "No")}</b></div>
                            <div><span style={{ color: C.faint }}>{lang === "he" ? "היום" : "Today"}: </span><b style={{ color: (s.changeTodayPct ?? 0) >= 0 ? HEX.Green : HEX.Red }}>{typeof s.changeTodayPct === "number" ? `${s.changeTodayPct > 0 ? "+" : ""}${s.changeTodayPct.toFixed(1)}%` : "—"}</b></div>
                            {s.desc && <div style={{ gridColumn: "1 / -1", color: C.muted }}>{s.desc}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>}
          </div>

          <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, boxShadow: SHADOW }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{t.lastRun}</span>
              <button onClick={() => nav("/backtests")} style={{ ...pill(false), fontSize: 11 }}>{t.viewRuns}</button>
            </div>
            {lastRun ? (
              <div onClick={() => nav("/backtests")} style={{ cursor: "pointer" }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{lastRun.name || lastRun.id?.slice(0, 8)}</div>
                <div style={{ fontSize: 12, color: C.muted, fontFamily: MONO }}>
                  {(lastRun.buckets || []).join(", ")} · {lastRun.status}
                  {lastRun.createdAt ? ` · ${new Date(lastRun.createdAt).toLocaleString(lang === "he" ? "he-IL" : "en-US")}` : ""}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{lastRun.completedSymbols ?? 0}{lastRun.totalSymbols ? ` / ${lastRun.totalSymbols}` : ""} {t.bucket.all === "all" ? "symbols" : "נכסים"}</div>
              </div>
            ) : <div style={{ color: C.muted, fontSize: 13 }}>{t.noData ?? "—"}</div>}
          </div>
        </div>
      </HubPanel>
      )}

      {/* ── Daily scan summary card ── */}
      {ssec === "daily" && (
      <HubPanel ns="scanner" id="daily" title={lang === "he" ? "סריקה יומית" : "Daily scan"} icon={<Search size={15} />} onClose={() => setSsec("")}>
        <DailyScanCard />
      </HubPanel>
      )}

      {/* ── Compare strategies: each strategy's Top-10/100 side by side, shared vs unique ── */}
      {ssec === "compare" && (
      <HubPanel ns="scanner" id="compare" title={t.cmp.title} icon={<Columns3 size={15} />} onClose={() => setSsec("")}>
        {/* controls: Top-10 ⇄ Top-100 toggle + refresh + scanned count */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12.5, color: C.muted }}>{t.cmp.sub}</div>
            {compare.total > 0 && <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{t.cmp.scanned(compareTop)}</div>}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", border: `1.5px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
              {([10, 100] as const).map((n) => (
                <button key={n} onClick={() => setCompareTop(n)} className="tap44" style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: "pointer", border: "none",
                  background: compareTop === n ? "var(--btn-bg)" : "transparent", color: compareTop === n ? "var(--btn-ink)" : C.muted,
                }}>{n === 10 ? t.cmp.top10 : t.cmp.top100}</button>
              ))}
            </div>
            <button onClick={() => compareQ.refetch()} disabled={compareQ.isFetching} className="tap44" style={pill(true)}>
              <RefreshCw size={13} className={compareQ.isFetching ? "spin" : ""} /> {t.refresh}
            </button>
          </div>
        </div>

        {compareQ.isLoading || compareQ.isFetching ? (
          <Center><Loader2 size={32} className="spin" color={C.gold} /><p style={{ fontWeight: 600, marginTop: 12 }}>{t.cmp.loading}</p><p style={{ fontSize: 13, color: C.muted }}>{t.cmp.loadingHint}</p></Center>
        ) : compareQ.isError ? (
          <Center><AlertCircle size={32} color={C.loss} /><p style={{ fontWeight: 600, marginTop: 12 }}>{t.failed}</p>
            {(compareQ.error as any)?.message ? <p style={{ fontSize: 12, color: C.muted, marginTop: 6, maxWidth: 420 }}>{(compareQ.error as any).message}</p> : null}
            <button onClick={() => compareQ.refetch()} style={{ ...pill(false), marginTop: 12 }}><RefreshCw size={13} /> {t.refresh}</button></Center>
        ) : compare.total === 0 ? (
          <div style={{ color: C.muted, fontSize: 13, padding: "10px 0" }}>{t.cmp.none}</div>
        ) : (
          <>
            {/* differences legend + shared-by-all summary */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 11, color: C.muted, marginBottom: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Diamond size={10} color={C.gold} fill={C.gold} /> {t.cmp.shared}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ padding: "1px 6px", borderRadius: 5, fontSize: 10, fontWeight: 700, color: C.blue, border: `1px solid ${C.blue}55`, background: `${C.blue}1a` }}>{t.cmp.only}</span> {t.cmp.unique}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ fontFamily: MONO, fontWeight: 700, color: HEX.Green }}>+%</span> {t.cmp.aboveLine}</span>
            </div>
            {compare.sharedAll.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gold }}>{t.cmp.shared}:</span>
                {compare.sharedAll.map((sym) => (
                  <span key={sym} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, border: `1px solid ${C.gold}55`, background: `${C.gold}14`, color: C.gold, fontFamily: MONO }}>
                    <Diamond size={9} color={C.gold} fill={C.gold} /> {sym}
                  </span>
                ))}
              </div>
            )}

            {/* side-by-side: one ranked column per strategy */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              {compare.strats.map((s: any) => (
                <div key={s.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: SHADOW }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 800, fontSize: 14 }}>{strategyLabel(s.id, lang)}</span>
                    <span style={{ fontSize: 11, color: C.faint, fontFamily: MONO }}>{s.rows.length}</span>
                  </div>
                  {s.rows.length === 0 ? (
                    <div style={{ color: C.muted, fontSize: 12, padding: "10px 0" }}>{t.cmp.empty}</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: "56svh", overflowY: "auto" }}>
                      {s.rows.map((r: any, i: number) => {
                        const ti = tierInfo(r.tier);
                        const sharedAll = compare.total > 1 && compare.count[r.symbol] === compare.total;
                        const uniq = compare.count[r.symbol] === 1;
                        return (
                          <div key={r.symbol} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 8, borderBottom: i === s.rows.length - 1 ? "none" : `1px solid ${C.line}`, background: sharedAll ? `${C.gold}10` : "transparent" }}>
                            <span style={{ width: 20, color: C.faint, fontFamily: MONO, fontSize: 12, textAlign: "end" }}>{i + 1}</span>
                            <Diamond size={10} color={sharedAll ? C.gold : ti.c} fill={sharedAll || ti.fill ? (sharedAll ? C.gold : ti.c) : "none"} />
                            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.symbol}</span>
                            {uniq && <span style={{ padding: "0 5px", borderRadius: 5, fontSize: 9.5, fontWeight: 700, color: C.blue, border: `1px solid ${C.blue}55`, background: `${C.blue}1a`, whiteSpace: "nowrap" }}>{t.cmp.only}</span>}
                            {/* BOTH metrics per row: primary "% above the breakout line" + secondary "today's change". */}
                            <MetricPair
                              above={typeof r.pctToGreen === "number" ? -r.pctToGreen : null}
                              today={typeof r.changeTodayPct === "number" ? r.changeTodayPct : null}
                              he={lang === "he"} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
      <style>{".spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

const colorName = (t: any, c: TrendColor) => (c === "Green" ? t.green : c === "Red" ? t.red : t.grey);

function Pill({ on, onClick, children, title }: any) {
  return <button onClick={onClick} title={title} style={pill(on)}>{children}</button>;
}
function Chip({ color, label }: { color: TrendColor; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 6px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      border: `1px solid ${HEX[color]}40`, color: HEX[color], background: `${HEX[color]}1a` }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: HEX[color] }} /> {label}
    </span>
  );
}
function Legend2({ c, label }: { c: string; label: string }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: c }} /> {label}</span>;
}
function Center({ children }: any) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", textAlign: "center" }}>{children}</div>;
}

// A compact TWO-metric cell for a scan row: the PRIMARY "% above breakout line" (breakout
// strength) on top, and a smaller SECONDARY "today's change %" beneath it — each with its
// own +/- sign, green/red color, and a short bilingual label so the two never get confused.
function MetricPair({ above, today, he }: { above: number | null; today: number | null; he: boolean }) {
  const row = (label: string, v: number | null, primary: boolean) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, whiteSpace: "nowrap" }}>
      <span style={{ fontSize: primary ? 8.5 : 8, fontWeight: 700, color: C.faint }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: primary ? 11.5 : 10, fontWeight: primary ? 800 : 600,
        color: v == null ? C.muted : (v >= 0 ? HEX.Green : HEX.Red), opacity: primary ? 1 : 0.92 }}>
        {v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
      </span>
    </span>
  );
  return (
    <span title={he ? "מעל = % מעל קו הפריצה · היום = שינוי היום" : "line = % above the breakout line · today = today's change"}
      style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1, flexShrink: 0, minWidth: 64 }}>
      {row(he ? "מעל" : "line", above, true)}
      {row(he ? "היום" : "today", today, false)}
    </span>
  );
}
// Premium toggle/action chip — the tile-family finish (rounded, accent border when
// on, soft inner top-highlight) so every pill on Scanner reads as the Home design
// language. whiteSpace:nowrap keeps EN/HE labels ("BOT(8C)-770", "commodities" /
// "סחורות") on one line; the inline-flex centering keeps them comfortably padded.
const pill = (on: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "6px 12px", borderRadius: 10,
  fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit",
  border: `1.5px solid ${on ? C.gold : C.line}`,
  background: on ? "var(--btn-bg)" : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
  color: on ? "var(--btn-ink)" : C.muted,
  boxShadow: on
    ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -12px rgba(0,0,0,0.35)"
    : "inset 0 1px 0 rgba(255,255,255,0.22)",
});
const th = (align: "start" | "end" | "center"): React.CSSProperties => ({
  textAlign: align as any, fontWeight: 600, padding: "10px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted,
});
const td = (rtl: boolean): React.CSSProperties => ({ padding: "10px 12px", textAlign: rtl ? "right" : "left" });
