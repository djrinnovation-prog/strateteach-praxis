import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, FlaskConical, Microscope, BookOpen, Menu, Search, Globe, Info, X, Diamond, Cpu, MessageCircle, Play, Pointer, Rocket, ArrowLeftRight, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, Check, Bitcoin, Apple, Coins, Droplet, Eye, EyeOff, Lock, Send, Activity, BarChart3, GraduationCap, Crown, UserRound, Settings, Pencil, Bot, LifeBuoy, Bell, RotateCw, Gem as GemIcon } from "lucide-react";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { useOverflowScroll } from "../lib/useOverflowScroll";
import { useDeferred } from "../lib/useDeferred";
import { C, MONO, RADIUS, SHADOW, onAccent, loadThemePrefs } from "../theme";
import { api, loadExchangeCreds } from "../app/api";
import { useCombinedLive } from "../lib/useCombinedLive";
import { useEntitlements, PriceTag, FEATURE_REQUIRES, ALACARTE_PRICE } from "../lib/entitlements";
import ThemeControl from "../components/ThemeControl";
import HomeTop from "../components/HomeTop";
import BrandTicker from "../components/BrandTicker";
import HomeBackdrop from "../components/HomeBackdrop";
import ConnectExchangeModal from "../components/ConnectExchangeModal";
import AboutContent, { ABOUT_STR } from "../components/AboutContent";
import { useDemoLeft } from "../components/DemoKit";
import { Clock } from "lucide-react";
import TourLauncher from "../components/TourLauncher";
import SquareRow, { type SquareDef } from "../components/SquareRow";
import ScreenShortcuts from "../components/ScreenShortcuts";
import HomeLayoutEditor from "../components/HomeLayoutEditor";
import { GlassTile, homeDim } from "../components/GlassTile";
import { applyArrangement, type LayoutArrangement } from "../lib/layout";
import { type EditorItem } from "../components/LayoutEditor";
import TabBar from "../components/TabBar";
import HelpPortalButton from "../components/HelpPortal";
import AccessibilityControl from "../components/AccessibilityControl";
import HomeGuide, { GuideLaunchButton } from "../components/HomeGuide";
import { BUILD_STAMP } from "../lib/build";

// Ported from the original Replit client's landing.tsx — the iPhone-style
// "springboard": a scattered constellation of app orbs over an ambient glow.
const BRAND = "linear-gradient(135deg, #FBC02D 0%, #F7931A 45%, #7CC04E 100%)";

// ── ONE shared "square with border" tile look ────────────────────────────────
// Every bordered-square control on Home shares this so the rows read as one uniform
// set: the tools/shortcuts row, "מי אנחנו" (About Us), and Learn · Reels · Help Portal.
// Rounded-square (SQ_RADIUS) + a visible skin-accent (C.gold) frame over the glass
// surface. A function (not a const) so it re-reads the live C.* theme on every render /
// skin change — like the in-component style objects below. Callers spread it, then add
// their own size / padding / layout (…sqTile(), flex, minHeight, padding).
export const SQ_RADIUS = 13;
export const sqTile = (): React.CSSProperties => ({
  background: C.glassTint, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
  border: `1.5px solid ${C.frameAccent}`, borderRadius: SQ_RADIUS, color: C.text,
  boxShadow: `0 6px 16px -10px rgba(0,0,0,0.42), ${C.glassHi}`,
});

const STR = {
  he: {
    tagline: "מסחר אלגוריתמי רב-נכסים · סורק פריצות בזמן אמת",
    subtitle: "Algo Trading System",
    headline: "StrateTeach",
    dailyTrend: "סריקה יומית", dailyTrendSub: "סיגנלי פריצה בזמן אמת · כל הנכסים",
    dailyTrendInfo: "סורק את כל הנכסים ומציג לכל אחד את צבע המגמה (ירוק / אפור / אדום). ירוק = פתיחת עסקה, אפור = החזקה, אדום = סגירה. כולל אחוז רווח/הפסד נטו מהמחיר בפתיחה וגרף היסטוריית מגמות יומית.",
    runBacktest: "בדיקות", runBacktestSub: "BOT(8C)-770 · BOT4 · תוצאות אסטרטגיה",
    runBacktestInfo: "בודק את האסטרטגיות (BOT(8C)-770, BOT4, BOT1) על נתוני עבר כדי לראות איך הן היו מתפקדות — תשואה כוללת, אחוז הצלחה ומספר עסקאות.",
    profitEngine: "מנוע מסחר", profitEngineSub: "תוכנית יומית מהסיגנלים של היום · אתם מאשרים כל פקודה",
    profitEngineInfo: "בונה תוכנית קנייה יומית מהסיגנלים החמים של קריפטו, מפזר את התקציב בין הבחירות ומחשב יעד רווח — אתם מאשרים כל עסקה ידנית.",
    lab: "מעבדת אסטרטגיות", labSub: "בנייה · כוונון · השוואת אסטרטגיות",
    labInfo: "מקום להתנסות ולכוונן אסטרטגיות ופרמטרים, לצפות בהן על המטבעות המובילים ולהשוות תוצאות לפני שמיישמים.",
    glossary: "הסברים", glossarySub: "מילון מושגים · כל מונח בהסבר פשוט",
    glossaryInfo: "מילון של כל המונחים באפליקציה — דרגות, מגמות, פריצה, שארפ, ירידה מקסימלית ועוד — בהסבר פשוט.",
    chat: "צ'אט", chatSub: "חברים · קבוצות · הודעות בזמן אמת",
    chatInfo: "מסך הצ'אט: הוסיפו חברים, פתחו קבוצות, שלחו הודעות ישירות וקבלו עדכוני רווח בזמן אמת. מנהל יכול לשלוח גם פרסים חגיגיים.",
    mainMenu: "תפריט ראשי", menuSub: "כל המסכים במקום אחד", menuInfo: "פותח את התפריט הראשי עם כל המסכים.",
    dash: "דאשבורד", dashSub: "סיכומים חיים · רווח והפסד", dashInfo: "סיכום כל הביצועים במקום אחד — רווח היום/חודש/שנה, עסקאות ועוד. כל מספר לחיץ למקור.",
    agent: "סוכן AI", agentSub: "המדריך החכם · 5 שאלות → תוכנית", agentInfo: "המדריך החכם שואל 5 שאלות, בונה לכם תוכנית אישית ומעניק תג. אפשר להריץ אותו בכל זמן.",
    reels: "רילים", reelsTip: "קורס וידאו · 3 דמויות",
    start: "התחל עכשיו", startTitle: "מתחילים ב-3 צעדים פשוטים",
    s1t: "ללמוד", s1s: "הסבר קצר על המערכת — איך הכל עובד.",
    s2t: "לחבר בורסה", s2s: "חברו בורסה — המפתחות נשמרים רק בדפדפן שלכם.",
    s3t: "מנוע מסחר", s3s: "בנו תוכנית רווח יומית ואשרו כל פקודה.",
    stBack: "חזרה", stNext: "הצעד הבא", stDone: "סיום", stOpen: "פתח מסך זה", stStep: "צעד",
    footer: "ALGO770 · אסטרטגיית ערוץ גאוסיאני", more: "מידע נוסף", open: "פתח",
  },
  en: {
    tagline: "Multi-Asset Algo Trading · Real-time breakout scanner",
    subtitle: "Algo Trading System",
    headline: "StrateTeach",
    dailyTrend: "Daily scan", dailyTrendSub: "Live breakout signals · All assets",
    dailyTrendInfo: "Scans every asset and shows each one's trend color (Green / Grey / Red). Green = open a trade, Grey = hold, Red = close. Includes Net P&L from the open price and a daily trend-history chart.",
    runBacktest: "Backtests", runBacktestSub: "BOT(8C)-770 · BOT4 · Strategy results",
    runBacktestInfo: "Tests the strategies (BOT(8C)-770, BOT4, BOT1) on historical data to see how they would have performed — total return, win rate and number of trades.",
    profitEngine: "Trading engine", profitEngineSub: "A daily plan from today's signals · You approve each order",
    profitEngineInfo: "Builds a daily buy plan from today's hot crypto signals, splits your budget across the picks and computes a take-profit target — you confirm every order manually.",
    lab: "Strategy Lab", labSub: "Build · Tune · Compare strategies",
    labInfo: "A place to experiment with and tune strategies and parameters, preview them on the top coins, and compare results before applying them.",
    glossary: "Explanations", glossarySub: "Glossary · Every term explained",
    glossaryInfo: "A glossary of every term in the app — tiers, trends, breakout, Sharpe, max drawdown and more — in plain language.",
    chat: "Chat", chatSub: "Friends · Groups · Real-time messages",
    chatInfo: "The Chat screen: add friends, create groups, send direct messages and get live profit updates. Admins can also send celebratory rewards.",
    mainMenu: "Main menu", menuSub: "All screens in one place", menuInfo: "Opens the main menu with every screen.",
    dash: "Dashboard", dashSub: "Live totals · P&L", dashInfo: "Your whole performance in one place — profit today / month / year, trades and more. Every figure is pressable to its source.",
    agent: "AI agent", agentSub: "The smart guide · 5 questions to a plan", agentInfo: "The smart guide asks 5 questions, builds you a personalized plan and awards a badge. Replayable any time.",
    reels: "Reels", reelsTip: "Video course · 3 hosts",
    start: "Start now", startTitle: "Get started in 3 simple steps",
    s1t: "Learn", s1s: "A short tour of the system — how it all works.",
    s2t: "Connect exchange", s2s: "Connect an exchange — keys stay only in your browser.",
    s3t: "Trading engine", s3s: "Build a daily profit plan and approve each order.",
    stBack: "Back", stNext: "Next step", stDone: "Done", stOpen: "Open this screen", stStep: "Step",
    footer: "ALGO770 · Gaussian Channel Strategy", more: "More info", open: "Open",
  },
};

type OrbKey = "menu" | "dash" | "agent" | "signals" | "runs" | "lab" | "profit" | "chat" | "glossary";

// All orbs share one elegant deep-blue glass body. ORB_BLUE is the rim/sheen;
// ART gives each orb's inner graphic its own vivid colour so it glows on the blue.
const ORB_BLUE = "#5CB3FF";
const ART: Record<OrbKey, string> = {
  menu: "#FBC02D", dash: "#5CB3FF", agent: "#FF9F45", signals: "#F7B500", runs: "#36E0A0", lab: "#C792FF",
  profit: "#FFD24A", chat: "#37E0D8", glossary: "#7CC0FF",
};

// Home "quick actions" shortcuts row — the user picks WHICH of these main action
// screens appear (CHANGE 2). The catalog is the full menu of available options;
// `nav` is where the chip routes, `lock` is the bare section path checked against
// the same `locked` list the springboard orbs use (so a query-string entry like
// the exchange-connect deep link still gates on its base route). Labels are kept
// inline (module scope, no `t`) so this stays self-contained.
type ShortcutDef = { id: string; nav: string; lock: string; he: string; en: string; Icon: any };
const SHORTCUT_CATALOG: ShortcutDef[] = [
  { id: "signalbot",  nav: "/bots",                 lock: "/bots",       he: "סיגנל בוט",    en: "Signal Bot",       Icon: Bot },
  { id: "scanner",    nav: "/scanner",              lock: "/scanner",    he: "סריקה יומית",  en: "Daily scan",       Icon: Search },
  { id: "backtests",  nav: "/backtests",            lock: "/backtests",  he: "בדיקות",       en: "Backtest",         Icon: FlaskConical },
  { id: "strategy",   nav: "/strategy",             lock: "/strategy",   he: "אסטרטגיות",    en: "Strategy",         Icon: Microscope },
  { id: "guidedbuilder", nav: "/guided-builder",    lock: "/guided-builder", he: "בונה אסטרטגיה", en: "Strategy Builder", Icon: GraduationCap },
  { id: "profit",     nav: "/profit",               lock: "/profit",     he: "מנוע מסחר",    en: "Trading engine",    Icon: Diamond },
  { id: "exchange",   nav: "/exchange",            lock: "/exchange",   he: "בורסה",        en: "Exchange",         Icon: ArrowLeftRight },
  { id: "learn",      nav: "/university",           lock: "/university", he: "למידה",        en: "Learn",            Icon: BookOpen },
  { id: "telegram",   nav: "/telegram",             lock: "/telegram",   he: "טלגרם",        en: "Telegram",         Icon: Send },
  { id: "chat",       nav: "/chat",                 lock: "/chat",       he: "צ'אט",         en: "Chat",             Icon: MessageCircle },
  { id: "activity",   nav: "/activity",             lock: "/activity",   he: "פעילות",       en: "Activity",         Icon: Activity },
  { id: "analytics",  nav: "/analytics",            lock: "/analytics",  he: "אנליטיקה",     en: "Analytics",        Icon: BarChart3 },
  { id: "university", nav: "/university",           lock: "/university", he: "אקדמיה",       en: "University",       Icon: GraduationCap },
  { id: "plans",      nav: "/plans",                lock: "/plans",      he: "מסלולים",      en: "Plans",            Icon: Crown },
  { id: "account",    nav: "/me",                   lock: "/me",         he: "החשבון שלי",   en: "Account",          Icon: UserRound },
  // Settings/Account merge — Step 1: "הגדרות" now lands on the unified "החשבון שלי" hub.
  // Id kept so any saved shortcut row keeps working; it just points at /me now.
  { id: "settings",   nav: "/me",                   lock: "/me",         he: "הגדרות",       en: "Settings",         Icon: Settings },
];
// Default Tools row (5) — the "trade in one place" utilities that flank the hero:
// Exchange · Daily Scan · Backtest · Strategy · Learn. Trading Engine + Signal Bot
// now live in the centred hero (TradeHero), so they're dropped from the default row;
// both stay re-addable from the catalog via the pencil (this row is user-editable).
// Default Tools row (5). The row is now the shared, server-backed ScreenShortcuts, so
// selection/order live in layout_prefs (per user + owner default) — the old localStorage
// loader + one-time signalbot migration were dropped with the bespoke row.
const DEFAULT_SHORTCUTS = ["guidedbuilder", "scanner", "backtests", "strategy", "learn"];

// ── Desktop FIT-TO-VIEWPORT scale ────────────────────────────────────────────
// Measures the natural column height and, if it exceeds the space between the top
// bar and the bottom tab bar, scales the whole column DOWN (transform: scale, origin
// top-centre, clamped to a min of 0.8) so EVERYTHING — hero, P&L, positions, and the
// help portal — stays visible with NO scrollbar and nothing clipped, at any desktop
// height. Recomputes on window resize + content reflow (ResizeObserver). Fails safe:
// on any error / when inactive it returns scale 1 (normal layout). The scaled column
// is wrapped in an overflow-hidden flex box so its natural (unscaled) layout height
// never leaks a scrollbar into the page. `active` is desktop-only; mobile keeps its
// svh + flex layout untouched.
const FIT_MIN = 0.62;
function useFitScale(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  // `overflow` = the content is too tall to fit even at the MIN scale (e.g. the Portfolio P&L
  // panel expanded) → the caller must switch to SCROLL (and NOT keep a transform, which would
  // leave phantom empty scroll since a transform doesn't change layout height).
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    if (!active) { setScale(1); setOverflow(false); return; }
    let raf = 0;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      // ROBUST, ZOOM-PROOF measurement — the earlier version divided getBoundingClientRect().top
      // by the html zoom, which was fragile and mis-fit under the default desktop zoom (1.15). All
      // three metrics here are LAYOUT px (unaffected by html zoom AND by the transform:scale we
      // apply), so no zoom maths is needed and there's no feedback loop:
      //   • el.offsetParent = the fixed full-viewport container (position:fixed, inset 0);
      //   • its clientHeight = the viewport height in CSS px;
      //   • el.offsetTop = how much sits above the column (ticker + toolbar) inside that container;
      //   • el.scrollHeight = the column's FULL natural (unscaled) content height.
      const parent = el.offsetParent as HTMLElement | null;
      const availPx = parent ? parent.clientHeight : window.innerHeight;
      const top = el.offsetTop;
      const natural = el.scrollHeight;
      // Reserve a small bottom margin so the last row (Help Portal) never sits flush to the edge.
      const avail = availPx - top - 18;
      // Desired scale to fit the FULL content. If it's below FIT_MIN the content is too tall to
      // fit even when shrunk (e.g. the P&L panel is expanded) → DON'T scale (a scaled + scrolled
      // element leaves phantom empty scroll because the transform doesn't shrink layout height);
      // instead report `overflow` so the caller allows normal scrolling at scale 1.
      const desired = natural > 0 && avail > 0 && natural > avail ? avail / natural : 1;
      const fits = desired >= FIT_MIN;
      const s = fits ? Math.min(1, desired) : 1;
      setScale((prev) => (Math.abs(prev - s) < 0.004 ? prev : s));
      setOverflow((prev) => (prev === !fits ? prev : !fits));
    };
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();  // first pass SYNCHRONOUSLY (useLayoutEffect → pre-paint) so there's no 1-frame unscaled flash
    // Re-measure after async content (P&L, positions) + web fonts settle, so a late
    // height growth can never leave the bottom clipped.
    const timers = [setTimeout(schedule, 200), setTimeout(schedule, 600), setTimeout(schedule, 1500), setTimeout(schedule, 3000)];
    try { (document as any).fonts?.ready?.then?.(schedule); } catch { /* */ }
    let ro: ResizeObserver | null = null;
    // Observe the column, <html> (zoom), AND every direct child — a child growing (the Portfolio
    // P&L panel expanding) changes the CONTENT height, which must re-trigger the fit/overflow
    // decision so the user can scroll to the newly-revealed rows.
    const observeAll = () => {
      if (!ro || !ref.current) return;
      ro.disconnect();
      ro.observe(ref.current);
      try { ro.observe(document.documentElement); } catch { /* */ }
      for (let i = 0; i < ref.current.children.length; i++) ro.observe(ref.current.children[i]);
    };
    try { if (typeof ResizeObserver !== "undefined" && ref.current) { ro = new ResizeObserver(schedule); observeAll(); } } catch { /* */ }
    // A panel expand/collapse can add/remove rows deep in the tree → re-observe + re-measure.
    let mo: MutationObserver | null = null;
    try { if (typeof MutationObserver !== "undefined" && ref.current) { mo = new MutationObserver(() => { observeAll(); schedule(); }); mo.observe(ref.current, { childList: true, subtree: true }); } } catch { /* */ }
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("algo770-theme", schedule);   // large-text/zoom toggle → re-fit
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); if (ro) ro.disconnect(); if (mo) mo.disconnect(); window.removeEventListener("resize", schedule); window.removeEventListener("orientationchange", schedule); window.removeEventListener("algo770-theme", schedule); };
  }, [active]);
  return { ref, scale, overflow };
}

// The Home wordmark = the APPROVED hand-made per-skin PNG logo (the "new headline style · for
// review" reference Dan pointed at = the state at commit 32e0f8e, before the headline saga): a
// warm multi-colour 3D "StrateTeach" with a graduation-cap on the "T" + a diamond on the "S".
// Keyed by the PALETTES skin key: navy · peach · amber(=Nude label) · aurora(=Sea label).
const LOGO_BY_SKIN: Record<string, string> = {
  navy: "/logo-navy.png",
  peach: "/logo-peach.png",
  amber: "/logo-nude.png",   // the Nude skin's key is `amber`
  aurora: "/logo-sea.png",   // the Sea skin's key is `aurora`
};
// STABLE cache-buster for the ~820KB logo PNGs (bump ONLY when the logo ARTWORK changes).
const LOGO_VERSION = "1";

// ── Home portfolio GLANCE ─────────────────────────────────────────────────────
// Dan (#N2IM): Home must be a GLANCE + a DOOR, not the full breakdown. This is the
// minimal replacement for the heavy HomeUnifiedFrame — just total portfolio value +
// P&L on a compact line, and a clear "Full dashboard →" button to /overview (which
// holds the detailed portfolio/positions/holdings). Read-only; no keys, no money moves.
function HomeGlance() {
  const { lang } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const exConn = !!loadExchangeCreds();
  const paperQ = useQuery({ queryKey: ["paperState"], queryFn: () => api.paperState(), retry: false, refetchInterval: 30000 });
  const paper: any = paperQ.data;
  const isLive = exConn;

  // REAL-MONEY INVARIANT (Dan): the LIVE headline is the COMBINED real-money total across ALL of the
  // user's connected accounts — the engine's browser sub-accounts AND the autopilots' Bybit balance —
  // computed by the SHARED useCombinedLive hook, so Home and /overview show the IDENTICAL number and
  // can never drift (Home previously showed the engine-ONLY total). Simulated pilot / Signal-Bot P&L
  // is NEVER folded into this real total (real balances only). DEMO reads paper state (all sim).
  const cl = useCombinedLive();
  const value: number | null = isLive
    ? cl.value
    : (paper ? Number(paper.totalCost || 0) + Number(paper.totalPnl || 0) : null);
  const pnl: number | null = isLive
    ? cl.pnl
    : (paper ? Number(paper.totalPnl || 0) : null);
  const pct: number | null = isLive
    ? cl.pct
    : (paper && Number(paper.totalCost || 0) > 0 ? (Number(paper.totalPnl || 0) / Number(paper.totalCost)) * 100 : null);
  const today: number | null = isLive ? cl.today : null;
  const loading = isLive ? cl.loading : paperQ.isLoading;

  const money = (v: number | null) => v == null || isNaN(v) ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const signed = (v: number | null) => v == null || isNaN(v) ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const arrow = (v: number | null) => v == null || isNaN(v) ? "" : (v >= 0 ? "▲ " : "▼ ");
  const glc = (v: number | null) => v == null || isNaN(v) ? C.text : (v >= 0 ? C.gain : C.loss);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, boxShadow: SHADOW, padding: "14px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: "0.03em", color: C.muted }}>
          {he ? "סה\"כ תיק" : "Total portfolio"}
          <span style={{ fontSize: 9.5, fontWeight: 900, padding: "1px 7px", borderRadius: 999, color: isLive ? "#fff" : "#fff", background: isLive ? C.loss : C.blue }}>
            {isLive ? (he ? "לייב" : "LIVE") : (he ? "דמו" : "DEMO")}
          </span>
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: C.text }}>{loading ? "…" : money(value)}</span>
          <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 13, color: glc(pnl) }}>
            {loading ? "" : `${arrow(pnl)}${signed(pnl)}`}{pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : ""}
          </span>
          {today != null && <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO }}>{he ? "היום" : "today"} <b style={{ color: glc(today) }}>{signed(today)}</b></span>}
        </div>
      </div>
      <button onClick={() => nav("/overview")} className="gbtn" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px",
        borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
        {he ? "הלוח המלא" : "Full dashboard"} <ChevronRight size={15} style={{ transform: (lang === "he") ? "scaleX(-1)" : "none" }} />
      </button>
    </div>
  );
}

export default function Home({ onMenu }: { onMenu?: () => void }) {
  const { lang, rtl, setLang } = useI18n();
  const t = STR[lang];
  const nav = useNavigate();
  // Active skin key → its tonal logo. Read live each render; Home re-renders on "algo770-theme".
  const logoSrc = `${LOGO_BY_SKIN[loadThemePrefs().skin] || "/logo-navy.png"}?v=${LOGO_VERSION}`;
  // Preload the ACTIVE skin's logo at HIGH priority so the wordmark is present from first paint.
  useEffect(() => {
    const ID = "algo770-logo-preload";
    let link = document.getElementById(ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = ID; link.rel = "preload"; link.as = "image";
      (link as any).fetchPriority = "high";
      document.head.appendChild(link);
    }
    if (link.getAttribute("href") !== logoSrc) link.href = logoSrc;
  }, [logoSrc]);
  const mobile = useIsMobile();
  // Home is LOCKED to one screen normally (no scroll); `overflowY` flips to "auto" only
  // when the content would otherwise be clipped (large-text / zoom accessibility mode, or
  // a very short device) so nothing is ever cut off. Other screens keep scrolling — this
  // lock is Home-only. See useOverflowScroll: "hidden" while it fits, "auto" when needed.
  const { ref: fitRef, overflowY: homeOverflowY } = useOverflowScroll<HTMLDivElement>();
  // Fit-scale is ENABLED on DESKTOP so Home stays one locked, NON-scrolling screen even at
  // the bigger default text (the desktop-default html{zoom:1.15}) and on short desktop windows
  // (1280×800): the column scales DOWN just enough to fit, instead of introducing a scrollbar.
  // On a tall desktop it stays 1 (full bigger text); on a short one it eases back toward normal
  // — always NO scroll. MOBILE keeps its natural svh/flex layout + useOverflowScroll (no scale).
  // DESKTOP fit-to-ONE-screen (Dan): the column scales DOWN just enough to fit the viewport so the
  // DEFAULT home shows everything (headline → Help Portal) with NO scroll. When the Portfolio panel
  // is EXPANDED past what even the min scale can fit, the hook reports `overflow` and we drop the
  // transform → normal SCROLL to the extra rows. Re-enabled with a zoom-proof measurement (above).
  const { ref: scaleRef, scale: fitScale, overflow: fitOverflow } = useFitScale(!mobile);
  // When the Portfolio card is EXPANDED, drop the fit-scale transform and let the page SCROLL to
  // the revealed detail — otherwise growing the card makes the fit-scale shrink the whole column
  // (Dan: "the screen moves to be smaller"). `noFit` folds this into the existing overflow path.
  const [cardExpanded, setCardExpanded] = useState(false);
  const noFit = fitOverflow || cardExpanded;
  const [visible, setVisible] = useState(false);
  const [info, setInfo] = useState<OrbKey | null>(null);
  const [start, setStart] = useState(false);
  const [step, setStep] = useState(0);
  const [doneSteps, setDoneSteps] = useState<boolean[]>([false, false, false]);
  const [aboutOpen, setAboutOpen] = useState(false);      // "About Us / מי אנחנו" modal (opened from the wordmark)
  // "Update to latest" — a round ↻ button beside the build stamp (it's tied to the version
  // shown). Asks the SW to fetch the newest worker, hands the waiting worker a SKIP_WAITING
  // so it activates immediately (see public/sw.js), then reloads to pull fresh assets. It
  // NEVER clears localStorage/caches/site-data — that would wipe the saved exchange keys +
  // login. Only the service-worker / asset layer is refreshed.
  const [updating, setUpdating] = useState(false);
  const updateToLatest = async () => {
    if (updating) return;
    setUpdating(true);
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch { /* offline / no new worker — reload still bypasses stale caches */ }
          if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
      }
    } catch { /* SW unavailable — fall through to a plain reload */ }
    window.setTimeout(() => { location.reload(); }, 500);  // settle so a fresh worker can activate, then reload
  };
  const [trendOpen, setTrendOpen] = useState<any>(null);  // trending asset popup
  const trendRef = useRef<HTMLDivElement>(null);          // trending slider scroller
  const [showMarkets, setShowMarkets] = useState(() => { try { return localStorage.getItem("algo770_markets") !== "0"; } catch { return true; } });
  const toggleMarkets = (v: boolean) => { try { localStorage.setItem("algo770_markets", v ? "1" : "0"); } catch (_e) { /* */ } setShowMarkets(v); };
  // "Start now" opens the AI-agent onboarding (quiz → personalized steps → badge),
  // replayable any time.
  const openStart = () => { window.dispatchEvent(new Event("algo770-onboarding-quiz")); };

  // Admin-published "NEW" feature promo for the shiny running banner. Non-critical:
  // deferred until after first paint so it doesn't compete with the critical home
  // data; the poll then also pauses while the tab is hidden.
  const promoReady = useDeferred();
  const promoQ = useQuery({ queryKey: ["featurePromo"], queryFn: () => api.getAnnouncement(), enabled: promoReady, refetchInterval: 60000, refetchIntervalInBackground: false, staleTime: 30000 });
  const promo = (promoQ.data as any)?.promo as { title: string; body: string; route: string; cta: string } | null | undefined;
  // Constant-speed marquee: measure the track and set the duration so the text
  // always scrolls at the same px/sec on phone and desktop (no fast/slow drift).
  const promoTrackRef = useRef<HTMLSpanElement>(null);
  const [promoDur, setPromoDur] = useState(20);
  useEffect(() => {
    const el = promoTrackRef.current;
    if (!el) return;
    const half = el.scrollWidth / 2;           // one of the two identical halves
    if (half > 0) setPromoDur(Math.min(60, Math.max(12, half / 55))); // ~55px per second
  }, [promo?.title, promo?.body, promo?.cta, mobile, lang]);

  useEffect(() => { const id = setTimeout(() => setVisible(true), 80); return () => clearTimeout(id); }, []);

  // Always OPEN at the top so the STRATETEACH title is visible on load — never mid-page.
  // The page is its own scroll container (fitRef); reset it on mount (and once more after
  // the first async content settles, in case a late layout nudged it).
  useEffect(() => {
    const top = () => { try { fitRef.current?.scrollTo({ top: 0 }); } catch { /* */ } };
    top();
    const id = setTimeout(top, 120);
    return () => clearTimeout(id);
  }, []);

  // Returning from a "open this screen" step → reopen the wizard where we left off.
  useEffect(() => {
    if (sessionStorage.getItem("algo770_qs") === "1") {
      const st = parseInt(sessionStorage.getItem("algo770_qs_step") || "0", 10) || 0;
      let dn: boolean[] = [false, false, false];
      try { const p = JSON.parse(sessionStorage.getItem("algo770_qs_done") || "[]"); if (Array.isArray(p) && p.length === 3) dn = p; } catch (_e) { /* */ }
      setDoneSteps(dn); setStep(st); setStart(true);
      sessionStorage.removeItem("algo770_qs");
      window.dispatchEvent(new Event("qs-change"));
    }
  }, []);

  const accessQ = useQuery({ queryKey: ["sectionAccess"], queryFn: () => api.sectionAccess(), staleTime: 30000 });
  const locked: string[] = (accessQ.data as any)?.isAdmin ? [] : ((accessQ.data as any)?.locked || []);
  // Live totals widget (home only): demo P&L + running engines, with a privacy toggle.
  const liveQ = useQuery({ queryKey: ["dashboardLive"], queryFn: () => api.dashboardLive(), refetchInterval: 15000, retry: 0 });
  const demoTotal = Number((liveQ.data as any)?.demo?.total || 0);
  const runningCount = Number((liveQ.data as any)?.runningSessions || 0);
  const [hideAmt, setHideAmt] = useState(false);
  // Positions area = ONE panel with a live/demo toggle (not two stacked panels). Default to
  // the LIVE view when an exchange is connected in THIS browser, else the DEMO (paper) view.
  const _exCreds = loadExchangeCreds() as any;
  const exConnected = !!(_exCreds && _exCreds.key && _exCreds.secret);
  const [posMode, setPosMode] = useState<"live" | "demo">(exConnected ? "live" : "demo");
  const [showConnect, setShowConnect] = useState(false);  // connect-exchange popup (live intent, not connected)
  // Home's COMBINED layout editor — one modal with two tabs (shortcuts + central buttons).
  // null = closed; the value picks which tab opens first (from the pencil the user clicked).
  const [homeLayoutTab, setHomeLayoutTab] = useState<null | "home" | "home-central">(null);
  const SROW: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 };

  // Home shortcuts row — now the shared, server-backed ScreenShortcuts (its own editor +
  // resolver drive selection/order/reset), so the old localStorage-only state + custom
  // sheet were removed. The catalog + DEFAULT_SHORTCUTS below still define what's offered.

  const ORBS: { key: OrbKey; path: string; title: string; sub: string; body: string;
    x: number; y: number; tilt: number; delay: number; ring: string; glow: string; icon: React.ReactNode; badge?: boolean }[] = [
    { key: "menu", path: "", title: t.mainMenu, sub: t.menuSub, body: t.menuInfo,
      x: 50, y: 8, tilt: -6, delay: 80, ring: BRAND, glow: "rgba(247,181,0,0.45)", icon: <Menu size={26} color="#0B0613" strokeWidth={2.4} /> },
    { key: "dash", path: "/overview", title: t.dash, sub: t.dashSub, body: t.dashInfo,
      x: 80, y: 20, tilt: 6, delay: 160, ring: "linear-gradient(135deg, #5CB3FF 0%, #2F7BBE 100%)", glow: "rgba(92,179,255,0.45)", icon: <TrendingUp size={26} color="#0B0613" strokeWidth={2.4} /> },
    { key: "agent", path: "", title: t.agent, sub: t.agentSub, body: t.agentInfo,
      x: 50, y: 50, tilt: -5, delay: 200, ring: BRAND, glow: "rgba(255,159,69,0.45)", icon: <Cpu size={26} color="#0B0613" strokeWidth={2.4} /> },
    { key: "signals", path: "/scanner", title: t.dailyTrend, sub: t.dailyTrendSub, body: t.dailyTrendInfo,
      x: 17, y: 20, tilt: -7, delay: 240, ring: BRAND, glow: "rgba(247,147,26,0.45)", icon: <TrendingUp size={26} color="#0B0613" strokeWidth={2.4} /> },
    { key: "runs", path: "/backtests", title: t.runBacktest, sub: t.runBacktestSub, body: t.runBacktestInfo,
      x: 83, y: 20, tilt: 7, delay: 320, ring: "linear-gradient(135deg, #7CC04E 0%, #3f9142 100%)", glow: "rgba(124,192,78,0.42)", icon: <FlaskConical size={26} color="#0B0613" strokeWidth={2.4} /> },
    { key: "profit", path: "/profit", title: t.profitEngine, sub: t.profitEngineSub, body: t.profitEngineInfo,
      x: 85, y: 51, tilt: 6, delay: 400, ring: "linear-gradient(135deg, #F7B500 0%, #F7931A 60%, #7CC04E 100%)", glow: "rgba(247,181,0,0.5)", icon: <Diamond size={28} color="#0B0613" fill="#0B0613" />, badge: true },
    { key: "lab", path: "/strategy", title: t.lab, sub: t.labSub, body: t.labInfo,
      x: 15, y: 51, tilt: -6, delay: 480, ring: "linear-gradient(135deg, #E8438F 0%, #7B2FBE 100%)", glow: "rgba(123,47,190,0.45)", icon: <Microscope size={26} color="#0B0613" strokeWidth={2.4} /> },
    { key: "chat", path: "/chat", title: t.chat, sub: t.chatSub, body: t.chatInfo,
      x: 34, y: 82, tilt: -5, delay: 560, ring: "linear-gradient(135deg, #2DD4BF 0%, #0EA5E9 100%)", glow: "rgba(45,212,191,0.42)", icon: <MessageCircle size={26} color="#0B0613" strokeWidth={2.4} /> },
  ];
  const visOrbs = ORBS.filter((o) => !locked.includes(o.path));

  // Tier gating: which orbs need an upgrade for this user (price tag → /plans).
  const ent = useEntitlements().data;
  const ORB_FEATURE: Partial<Record<OrbKey, string>> = { runs: "backtest", profit: "profit_engine", lab: "strategy_lab" };
  function orbGate(key: OrbKey): { plan: string; price: number } | null {
    const feature = ORB_FEATURE[key];
    if (!feature || !ent || ent.isAdmin || ent.features.includes(feature)) return null;
    return { plan: FEATURE_REQUIRES[feature] || "pro", price: ALACARTE_PRICE[feature] || 0 };
  }

  // Height of the fixed price ticker pinned at the very top (PriceTickerBar).
  // All header controls + the wordmark sit BELOW it so nothing overlaps the ticker,
  // whether it's fixed/sticky/absolute (it's out of flow, so we offset manually).
  const TICKER_H = 34;
  // One unified control look across the whole Home screen: a clear 1px border,
  // surface fill and a single consistent corner radius (card/tile style).
  const CTRL_R = 12;
  // Square-ish menu button for the inline-start of the top app-bar. Height-matched
  // to the language + skin pills so the whole bar shares one baseline.
  // The top app-bar buttons are the "panel above the two big buttons" — bordered SQUARES
  // with a VISIBLE skin-accent (C.gold) frame (matching sqTile above), not a faint glass
  // hairline, so the whole top header reads as one uniform set of squares.
  const menuBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 34, flexShrink: 0,
    background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
    border: `1.5px solid ${C.gold}`, color: C.text, borderRadius: CTRL_R, cursor: "pointer", boxShadow: C.glassHi,
  };
  // Compact square icon button for the top-bar right cluster (help · ♿ lives in its
  // own control · skin · bell) — one shared look, height-matched to the menu button.
  const iconBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", width: 34, height: 30, flexShrink: 0,
    background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
    border: `1.5px solid ${C.gold}`, color: C.text, borderRadius: CTRL_R, cursor: "pointer",
    fontFamily: "inherit", boxShadow: C.glassHi,
  };
  // Language + skin share the top app-bar's inline-end cluster (height-matched,
  // never stacked) so they don't collide with each other or the wordmark below.
  const langPill: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, height: 30, boxSizing: "border-box", flexShrink: 0,
    background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
    border: `1px solid ${C.glassBd}`, color: C.text, borderRadius: CTRL_R,
    cursor: "pointer", padding: "0 11px", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, boxShadow: C.glassHi,
  };
  // (The bespoke Home TOOLS-row button styles — actBtn / botActBtn — were removed with
  // the hand-rolled shortcut row; the shared ScreenShortcuts renders that row now.)

  function activate(o: { key: OrbKey; path: string }) {
    if (o.key === "menu") { onMenu?.(); return; }
    if (o.key === "agent") { openStart(); return; }
    if (o.path) nav(o.path);
    else setInfo(o.key);
  }

  const ticker = useLivePrices();
  const demoLeft = useDemoLeft();
  const score = ent?.testerScore;
  // Celebrate when a demo tester crosses a new 20-point score milestone.
  useEffect(() => {
    if (typeof score !== "number") return;
    try { localStorage.setItem("algo770_last_score", String(score)); } catch (_e) { /* */ }
    let prev = 0; try { prev = parseInt(localStorage.getItem("algo770_score_ms") || "0", 10) || 0; } catch (_e) { /* */ }
    const ms = Math.floor(score / 20) * 20;
    if (ms > prev && ms >= 20) {
      try { localStorage.setItem("algo770_score_ms", String(ms)); } catch (_e) { /* */ }
      window.dispatchEvent(new Event("algo770-confetti"));
    }
  }, [score]);
  // Trending = real, live crypto only (the price engine is crypto-only, so these
  // are genuine prices with a live % since the page opened — not placeholders).
  const trending = ["BTC", "ETH", "SOL", "BNB"]
    .map((s) => ticker.find((it) => it.sym === s))
    .filter(Boolean) as typeof ticker;

  // ── Desktop dashboard side panels (≥860px only) ──────────────────────────────
  // Two compact nav cards that flank the CENTERED orb so the full desktop width is
  // used with a balanced, symmetric layout. Pure navigation to EXISTING screens
  // (the same routes the shortcuts row / springboard already use) — no new features
  // and no data of their own. Plan-locked routes are dropped (same `locked` list the
  // springboard orbs use). Never rendered on mobile, so the compact phone view is
  // completely untouched.
  const deskQuick = [
    { to: "/scanner",   lock: "/scanner",   Icon: Search,       he: "סריקה יומית",     en: "Daily scan" },
    { to: "/profit",    lock: "/profit",    Icon: Diamond,      he: "מנוע מסחר",       en: "Trading engine" },
    { to: "/bots",      lock: "/bots",      Icon: Bot,          he: "סיגנל בוט",       en: "Signal Bot" },
    { to: "/backtests", lock: "/backtests", Icon: FlaskConical, he: "בדיקות",          en: "Backtest" },
  ];
  const deskLearn = [
    { to: "/university", lock: "/university", Icon: BookOpen,   he: "הסברים",          en: "Explanations" },
    { to: "/reels",      lock: "/reels",      Icon: Play,       he: "רילים",           en: "Reels" },
    { to: "/strategy",   lock: "/strategy",   Icon: Microscope, he: "מעבדת אסטרטגיות", en: "Strategy Lab" },
    { to: "/analytics",  lock: "/analytics",  Icon: BarChart3,  he: "ביצועים",         en: "Performance" },
  ];
  const DeskNavCard = ({ title, items }: { title: string; items: typeof deskQuick }) => {
    const list = items.filter((it) => !locked.includes(it.lock));
    if (!list.length) return null;
    return (
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 16, padding: 14, boxShadow: "0 10px 24px -16px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, marginBottom: 10, textAlign: rtl ? "right" : "left" }}>{title}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((it) => (
            <button key={it.to} onClick={() => nav(it.to)} className="tap44"
              style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: rtl ? "right" : "left",
                background: C.surface, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "11px 13px",
                fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: `${C.gold}18`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <it.Icon size={16} color={C.gold} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{lang === "he" ? it.he : it.en}</span>
              {rtl ? <ChevronLeft size={15} color={C.muted} /> : <ChevronRight size={15} color={C.muted} />}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ── Home's COMBINED layout editor inputs (shortcuts + central buttons) ──
  // Built here so the ONE modal (opened from either pencil) edits both regions. Cheap;
  // only consumed when homeLayoutTab !== null. Uses the SAME catalogs the live rows use.
  const he = lang === "he";
  const homeShortcutCatalog = SHORTCUT_CATALOG.filter((s) => !locked.includes(s.lock));
  const homeShortcutItems: EditorItem[] = homeShortcutCatalog.map((s) => ({ id: s.id, label: he ? s.he : s.en, Icon: s.Icon }));
  const homeShortcutDefault: LayoutArrangement = (() => {
    const ids = homeShortcutCatalog.map((s) => s.id);
    const def = DEFAULT_SHORTCUTS.filter((k) => ids.includes(k)).slice(0, 5);
    const defSet = new Set(def);
    const rest = ids.filter((k) => !defSet.has(k));
    return { order: [...def, ...rest], hidden: rest };
  })();
  const homeCentral = homeCentralSquares(he, nav);
  const homeCentralItems: EditorItem[] = homeCentral.map((s) => ({ id: s.id, label: s.label, Icon: s.Icon, locked: s.locked }));
  const homeCentralDefault: LayoutArrangement = (() => {
    const showSet = new Set(HOME_CENTRAL_DEFAULT);
    const rest = homeCentral.map((s) => s.id).filter((k) => !showSet.has(k));
    return { order: [...HOME_CENTRAL_DEFAULT, ...rest], hidden: rest };
  })();
  const renderHomeShortcutPreview = (a: LayoutArrangement) => {
    const list = applyArrangement(homeShortcutItems, a, { maxShown: 5 }).shown;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
        {list.map((it) => (
          <div key={it.id} style={{ ...sqTile(), display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 2, minWidth: 54, minHeight: 46, padding: "6px 8px" }}>
            <it.Icon size={15} color={C.gold} />
            <span style={{ fontSize: 10, fontWeight: 800, color: C.text, textAlign: "center", lineHeight: 1.05 }}>{it.label}</span>
          </div>
        ))}
      </div>
    );
  };
  const renderHomeCentralPreview = (a: LayoutArrangement) => {
    const list = applyArrangement(homeCentral, a, {}).shown;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", alignItems: "center" }}>
        {list.map((s) => (
          <React.Fragment key={s.id}>
            <GlassTile variant={s.variant || "secondary"} mobile dim={homeDim(s.variant || "secondary", true)}
              Icon={s.Icon} label={s.label} sub={s.sub} onClick={() => { /* preview only */ }} />
          </React.Fragment>
        ))}
      </div>
    );
  };

  return (
    // BULLETPROOF SHELL (Dan): a height:100% flex COLUMN. The bottom TabBar is a REAL
    // flex-shrink:0 child at the end of this column (NOT position:fixed), so the nav can NEVER
    // be pushed off-screen or covered however tall the content gets — the recurring "can't
    // navigate at ~390px" failure. The scroll region below (fitRef) is flex:1 + min-height:0 +
    // overflow-y:auto — Home content flows and scrolls INSIDE it. No vh/svh/dvh anywhere: the
    // % chain (#root height:100%) is exact under html{zoom:1.15}. position:relative + zIndex:1
    // stacks the column above the fixed ambient backdrop (the old fixed box did this implicitly).
    <div style={{ height: "100%", display: "flex", flexDirection: "column", position: "relative",
      // Skin-bg FILL under everything so there is NEVER a black void, whatever the content height
      // (Dan's reported void). It paints at the very bottom of this stacking context; HomeBackdrop
      // (a fixed z:0 child) still paints ABOVE it, so the glow/starfield look is unchanged — this
      // is purely a safety floor.
      zIndex: 1, overflow: "hidden", background: C.bg, direction: rtl ? "rtl" : "ltr" }}>
    {/* THE single scroll region — fills the space above the TabBar and scrolls internally when
        the content is tall, so every section stays reachable on BOTH mobile and desktop.
        MOBILE: always "auto" — growth (expanded Portfolio/P&L) is absorbed by scrolling here,
        never a page jump, and the TabBar below stays put. DESKTOP: "hidden" while the column is
        fit-scaled to one screen (fitScale<1), else "auto". */}
    <div ref={fitRef} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0,
      display: "flex", flexDirection: "column",
      overflowY: mobile ? "auto" : ((!noFit && fitScale !== 1) ? "hidden" : "auto"), overflowX: "hidden", WebkitOverflowScrolling: "touch" as any, overscrollBehaviorY: "contain",
      background: "transparent", userSelect: "none" }}>
      {/* The ONE shared ambient backdrop (skin-aware radial glow + glows + starfield).
          Lifted into HomeBackdrop so the Shell can render the IDENTICAL backdrop on
          every inner screen — home and the inner screens now share one source. The
          old market-symbol motif lives as the vivid glyphs ORBITING the springboard
          ring (see SectionHub); the app-wide BitcoinBackground sits behind this too. */}
      <HomeBackdrop />
      {/* Tour engine kept mounted (event listener + CoachMarks) but its floating pill
          is hidden — on Home the tour is launched from the integrated top action row. */}
      <TourLauncher hidePill />
      {/* Yoav's animated Home Guide (mascot overlay). Mounted once here; dormant (just a
          deferred config fetch + optional first-visit auto-offer) until launched from the
          bottom help layer's "Guide" button. Self-contained, lazy assets, no first-paint cost. */}
      <HomeGuide />

      {/* Top app-bar — a REAL flow row (not absolute), so the wordmark below can
          NEVER slide under the icons however much the page is compressed. The
          menu sits at the inline-start, language + skin at the inline-end; the
          container's `direction` swaps the two sides automatically in RTL. The
          row's top padding clears the fixed price ticker (TICKER_H) PLUS a comfortable
          gap so the toolbar buttons never sit flush against the ticker (Dan: on mobile
          the ☰/globe/♿/skin/gear row was touching the ticker — it needs breathing room). */}
      {/* STICKY so the menu + icons stay pinned/accessible while the page scrolls (e.g. when the
          Portfolio card is expanded with a long positions list) — never scrolled off, never
          collided. When the card is expanded (the only time the page scrolls) it gets an OPAQUE
          skin-bg + a hairline divider so scrolled content passes cleanly BEHIND it instead of
          crowding the icons. The fixed price ticker (z:22) still sits above this (z:20). */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, paddingTop: TICKER_H + (mobile ? 10 : 16), paddingBottom: noFit ? 8 : 0, paddingInline: 14,
        ...(noFit ? { background: C.bg, borderBottom: `1px solid ${C.line}` } : null) }}>
        <button onClick={onMenu} aria-label="menu" className="tap44" style={menuBtn}>
          <Menu size={18} color={C.gold} />
        </button>
        {/* Right icon cluster — persistent app chrome: language · help (lifebuoy) ·
            accessibility (♿) · skin (palette) · notifications (bell). All real routes /
            controls; icon-only so they fit one row beside the wordmark. */}
        <div style={{ display: "flex", alignItems: "center", gap: mobile ? 5 : 7, minWidth: 0 }}>
          {/* Language = a clear EN | HE text toggle (Dan: not a world icon). The ACTIVE language
              is highlighted (gold), the other muted; tapping switches. */}
          <button onClick={() => setLang(lang === "he" ? "en" : "he")} aria-label="language" title={lang === "he" ? "English" : "עברית"} className="tap44"
            style={{ ...iconBtn, width: "auto", padding: "0 9px", gap: 3, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.02em", fontFamily: MONO }}>
            <span style={{ color: lang === "en" ? C.gold : C.muted }}>EN</span>
            <span style={{ color: C.faint }}>|</span>
            <span style={{ color: lang === "he" ? C.gold : C.muted }}>HE</span>
          </button>
          <button onClick={() => nav("/requests")} aria-label={lang === "he" ? "עזרה" : "Help"} title={lang === "he" ? "עזרה" : "Help"} className="tap44" style={iconBtn}>
            <LifeBuoy size={15} color={C.gold} />
          </button>
          <AccessibilityControl compact />
          <ThemeControl compact />
          {/* Gear → My Account (the unified /me hub — Step 1 of the settings/account merge). */}
          <button onClick={() => nav("/me")} aria-label={lang === "he" ? "החשבון שלי" : "My Account"} title={lang === "he" ? "החשבון שלי" : "My Account"} className="tap44" style={iconBtn}>
            <Settings size={15} color={C.gold} />
          </button>
        </div>
      </div>

      {/* Content — a natural-height column (no fixed-height / flex-crush games). The page
          above scrolls when this is tall; no clipping, no down-scaling. */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
      <div ref={scaleRef} style={{ width: "100%", display: "flex", flexDirection: "column",
        // DESKTOP fit-to-viewport: scale the whole column DOWN (top-centre origin so the top
        // edge stays put) just enough to fit → NO scroll at the bigger default text. When the
        // content overflows even at min scale (expanded P&L panel) we DON'T scale — the row above
        // switches to real scrolling instead (a scaled + scrolled element would over-scroll).
        ...(!mobile && !noFit && fitScale !== 1 ? { transform: `scale(${fitScale})`, transformOrigin: "top center" } : null) }}>
      {/* Prominent SYSTEM-NAME header — a generously-sized STRATETEACH wordmark with an
          integrated subtitle directly beneath it (one cohesive title unit), and real
          breathing room ABOVE (below the top icon bar) and BELOW. Tappable → About. */}
      <div style={{ zIndex: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: mobile ? 2 : 7,
        // Breathing room ABOVE the wordmark. MOBILE is compacted so the whole Home fits ONE
        // viewport with NO scroll (Dan): paddingTop 8→3, inter-block gap 3→2, paddingBottom 0.
        // DESKTOP unchanged (it fit-scales).
        paddingTop: mobile ? 3 : 12, paddingBottom: mobile ? 0 : 6, paddingInline: 18,
        opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(-12px)", transition: "all 0.6s ease-out" }}>
        {/* the title UNIT: big wordmark + subtitle, tightly grouped — FULL WIDTH so the
            frame spans the whole header area (logo centered inside). */}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: mobile ? 2 : 6 }}>
          {/* The wordmark is pressable → opens the "About Us / מי אנחנו" intro. DESKTOP: the
              box HUGS the logo (fit-content, centered). MOBILE: full-width. The cap + gem now
              sit INSIDE the frame, anchored to the LOGO's top-left/top-right edges (near the
              first "S" / last "h"), so on mobile they track the centered logo — not the wide
              frame corners. */}
          {/* Center the headline frame DIRECTION-AGNOSTICALLY (Dan: frame STILL shifted right in
              Hebrew on mobile). text-align:center on this block + an INLINE-level frame centers it
              via inline alignment, which is symmetric and immune to RTL flow / fit-content / margin
              quirks that survived the earlier flex-center. `dir:ltr` here pins the centering axis so
              the frame is dead-centred (equal L/R gap) in Hebrew too; the frame re-asserts its own
              dir for its text. */}
          {/* ORIGINAL headline restored EXACTLY (Dan: "go back to EXACTLY the image, the moment
              before I asked you to start changing the headline") = commit 32e0f8e: the approved
              per-skin PNG wordmark (warm multi-colour, moderate embossed 3D) with the graduation-
              cap on the "T" + the diamond on the "S", inside the rounded frame, subtitle attached.
              This supersedes every code-3D attempt (WebGL Wordmark3DGL + CarvedTitle iso3d). */}
          <div style={{ position: "relative", display: "block",
            width: mobile ? "100%" : "fit-content", marginInline: mobile ? undefined : "auto" }}>
            <h1 onClick={() => setAboutOpen(true)} role="button" tabIndex={0}
              title={lang === "he" ? "מי אנחנו" : "About us"}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setAboutOpen(true); } }}
              style={{ margin: 0, cursor: "pointer",
                // DESKTOP: frame HUGS the logo (fit-content). MOBILE: full-width. Logo centered.
                width: mobile ? "100%" : "fit-content", boxSizing: "border-box",
                // COLUMN: the wordmark stacks over its sub-line, both centered (tagline INSIDE the frame).
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 0,
                // CONTAINER (pill/box) stays SKIN-ADAPTIVE — its fill · borders · bevel all read from
                // the active skin via C.* so the frame follows Navy / Peach / Nude / Sea.
                background: `linear-gradient(145deg, ${C.gold}30, ${C.gold}0c 58%, ${C.gold}14)`,
                borderRadius: mobile ? 14 : 18, padding: mobile ? "6px 16px 4px" : "18px 34px 9px",
                borderTop: `2px solid ${C.gold}e0`, borderLeft: `2px solid ${C.gold}e0`,
                borderRight: `2px solid ${C.gold}55`, borderBottom: `2px solid ${C.gold}55`,
                boxShadow: `inset 2px 2px 4px ${C.accentHi}99, inset -3px -3px 7px ${C.gold}3a, 0 14px 34px -24px ${C.gold}55` }}>
              {/* Logo box — a relative wrapper that SHRINK-WRAPS the rendered logo at EVERY size
                  (fit-content), so the cap + gem anchor to the LOGO's real edges. The negative
                  marginBottom crops the PNG's transparent bottom band so the sub-line snugs under
                  the letters (desktop img=150 → -41; mobile img=68 → -17). */}
              <span style={{ position: "relative", display: "block", lineHeight: 0,
                width: "fit-content", maxWidth: "100%", marginBottom: mobile ? -17 : -41 }}>
                {/* Graduation cap — centred on the LEFT edge (≈53%) of the capital "T" of "Teach".
                    Lowered so it RESTS on the letter instead of floating too high above it (Dan). */}
                <GraduationCap size={mobile ? 15 : 22} color={C.gold} aria-hidden
                  style={{ position: "absolute", top: mobile ? 7 : 12, left: "53%",
                    transform: "translateX(-50%) rotate(-18deg)", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.45))", pointerEvents: "none", zIndex: 2 }} />
                {/* Diamond gem — hugging the TOP-LEFT of the capital "S", %-anchored in logo-space
                    (S's left edge ≈3% of width, letter-tops ≈10%), so it lands ON the S at every size. */}
                <GemIcon size={mobile ? 13 : 19} color={C.gold} aria-hidden
                  style={{ position: "absolute", top: "10%", left: "3%",
                    transform: "rotate(12deg)", filter: `drop-shadow(0 0 5px ${C.gold}) drop-shadow(0 1px 3px rgba(0,0,0,0.35))`, pointerEvents: "none", zIndex: 2 }} />
                {/* Dan-APPROVED rendered 3D "StrateTeach" logo — PER-SKIN tonal variant (logoSrc).
                    HEIGHT-DRIVEN (desktop 150 / mobile 68) with width:auto, so the element box equals
                    the rendered logo (no objectFit letterboxing) → the fit-content wrapper hugs it and
                    the cap/gem % anchors map to real logo-space at every viewport. */}
                <img src={logoSrc} alt="StrateTeach" loading="eager" decoding="sync" {...({ fetchpriority: "high" } as any)}
                  style={{ display: "block", objectFit: "contain", pointerEvents: "none", aspectRatio: "3339 / 849",
                    ...(mobile
                      ? { height: 68, width: "auto", maxWidth: "100%" }
                      : { height: 150, width: "auto", maxWidth: "100%" }) }} />
              </span>
              {/* Integrated sub-line — INSIDE the frame, centered directly under the wordmark (Dan).
                  Skin-adaptive brand tone (C.gold, softened). RTL-correct + bilingual. */}
              <span dir={lang === "he" ? "rtl" : "ltr"}
                style={{ display: "block", textAlign: "center",
                  fontSize: mobile ? 9 : 12.5, fontWeight: 600, color: C.gold, opacity: 0.9,
                  letterSpacing: lang === "he" ? "0.03em" : "0.07em",
                  lineHeight: mobile ? 1.2 : 1.3, maxWidth: "100%", paddingInline: 4 }}>
                {lang === "he" ? "מערכת למידה, מסחר ואוטומציה של אסטרטגיות מבוססות אלגוריתמים" : "A learning, trading & automation system for algorithm-based strategies"}
              </span>
            </h1>
          </div>
        </div>
        {/* About link + update button + build marker — beneath the title unit. The round
            ↻ "update to latest" button sits right beside About and the version stamp, since
            it's what refreshes the app to the newest deploy. */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: mobile ? 1 : 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: mobile ? 6 : 7 }}>
            {/* "מי אנחנו" — a bordered SQUARE tile (shared sqTile look), not a pill. */}
            <button onClick={() => setAboutOpen(true)} aria-label={lang === "he" ? "מי אנחנו" : "About us"} className="tap44"
              style={{ ...sqTile(), display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer",
                fontFamily: "inherit", fontSize: mobile ? 9.5 : 12, fontWeight: 800, letterSpacing: "0.04em",
                padding: mobile ? "3px 10px" : "7px 15px" }}>
              <Info size={mobile ? 10 : 13} color={C.gold} /> {lang === "he" ? "מי אנחנו" : "About Us"}
            </button>
            {/* Round ↻ update-to-latest button — refreshes SW + assets, never clears keys/login. */}
            <button onClick={updateToLatest} disabled={updating} className="tap44"
              aria-label={lang === "he" ? "עדכן לגרסה אחרונה" : "Update to latest"}
              title={updating ? (lang === "he" ? "מעדכן…" : "Updating…") : (lang === "he" ? "עדכן לגרסה אחרונה" : "Update to latest")}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: mobile ? 23 : 30, height: mobile ? 23 : 30, borderRadius: "50%",
                background: C.glassTint, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
                border: `1px solid ${C.gold}66`, color: C.gold, cursor: updating ? "default" : "pointer",
                opacity: updating ? 0.7 : 1, padding: 0, boxShadow: C.glassHi }}>
              <RotateCw size={mobile ? 12 : 15} color={C.gold} style={updating ? { animation: "spin 0.8s linear infinite" } : undefined} />
            </button>
          </div>
          <div style={{ fontSize: 8, color: C.faint, opacity: 0.7, letterSpacing: "0.02em", whiteSpace: "nowrap" }} title={lang === "he" ? "מזהה גרסה · שעון ישראל" : "Build version · Israel time"}>
            {lang === "he" ? "גרסה" : "build"} {BUILD_STAMP}
          </div>
        </div>
        {/* (The legacy top action row — Start · Help · Reels · Tour — was REMOVED from
            Home entirely: it was never in the v7 plan and cluttered the top. Its entries
            live in the new chrome — Reels + Help + Learn in the bottom help pill and the
            top help(♿) icons; "Start" = the Trading Engine hero; the tour stays reachable
            from the ☰ side menu. Removing it lets the GlobeHero flex-grow to fill the
            freed vertical space on mobile.) */}

        {/* "The tools to trade better" — heading over the editable TOOLS row. The row is
            now the SHARED, server-backed ScreenShortcuts (✎ → choose-from-list → APPROVE,
            with per-scope Reset). A user overrides their own row; an owner sets the default
            for everyone / a role. Plan-locked sections are dropped from the catalog (same
            `locked` the springboard orbs use), so a user can never pick a gated screen. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", maxWidth: 500,
          marginTop: mobile ? 0 : 4, paddingInline: mobile ? 4 : 0 }}>
          <span style={{ fontSize: mobile ? 9.5 : 12, fontWeight: 800, letterSpacing: "0.06em", color: C.muted }}>
            {lang === "he" ? "הכלים למסחר חכם יותר" : "The tools to trade better"}
          </span>
        </div>
        <div data-guide="tools" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
        <ScreenShortcuts screenKey="home" defaultKeys={DEFAULT_SHORTCUTS} liquid
          onEditOverride={() => setHomeLayoutTab("home")}
          catalog={SHORTCUT_CATALOG.filter((s) => !locked.includes(s.lock)).map((s) => ({
            key: s.id, label: lang === "he" ? s.he : s.en, Icon: s.Icon, onClick: () => nav(s.nav),
          }))} />
        </div>

        {/* ONE combined editor — opened from EITHER the shortcuts pencil (above) or the
            central-buttons ✎ (in the hero below); two tabs, same design UX. */}
        {homeLayoutTab && (
          <HomeLayoutEditor he={he} initialKey={homeLayoutTab} onClose={() => setHomeLayoutTab(null)}
            shortcuts={{ label: he ? "קיצורים" : "Shortcuts", items: homeShortcutItems, codeDefault: homeShortcutDefault, maxShown: 5, renderPreview: renderHomeShortcutPreview }}
            central={{ label: he ? "כפתורים מרכזיים" : "Central buttons", items: homeCentralItems, codeDefault: homeCentralDefault, renderPreview: renderHomeCentralPreview }}
          />
        )}

        {/* Service Hub — the "Help Portal" is now a small ROUND button inside the
            springboard orb below (passed into SectionHub as helpSlot). It opens the
            Requests-portal overlay (new request + past requests & replies) on-screen. */}

      </div>

      {/* ── Content — ONE clean vertical column for BOTH mobile and desktop, same order:
          hero (two central squares) → P&L strip → positions → helper. Desktop just centres
          the same column at a comfortable max-width (structure intact, NOT a 2-column
          dashboard). Natural height → the page scrolls when tall (e.g. positions expanded);
          generous bottom padding (+ iOS safe-area) so the last card clears the fixed nav. */}
      <div style={{ position: "relative", zIndex: 9, width: "100%", maxWidth: mobile ? 500 : 600, margin: "0 auto", boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: mobile ? 4 : 7,
        // Bottom pad reserves a little breathing room so the last card doesn't sit flush against the
        // TabBar. TOP pad raises the two big buttons toward the tools row (Dan). MOBILE values are
        // trimmed (top 4→2, inter-card gap 5→4, bottom 8→6) as part of the zero-scroll pass. */
        padding: mobile ? "2px 12px 6px" : "2px 16px 16px" }}>
        <style>{"@keyframes orbShine{to{background-position:200% center}}@keyframes algoFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@keyframes reelGlow{0%{background-position:0% 50%}100%{background-position:300% 50%}}@keyframes reelRun{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes promoShine{to{background-position:200% center}}@keyframes promoRun{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes miniDrop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.algoBtn{transition:transform .12s ease}.algoBtn:active{transform:scale(.9)}.algoBtn:active .algoIcon{filter:brightness(1.25)}"}</style>

        {/* HERO — the two central action squares in the thick skin frame (focal). Also the
            Home Guide's "engine" anchor (Trading + Trading Engine live in these central squares). */}
        <div data-guide="engine"><GlobeHero mobile={mobile} /></div>
        {/* UNIFIED account frame — Live · Demo · Pilots · Signal Bots merged into ONE card
            with a Total/source toggle (replaces the old P&L strip + positions + AutoPilots
            panels). Combined total headline with the SIM portion broken out. Carries BOTH the
            guide's "portfolio" anchor (Demo/Live toggle) and the "signal" anchor (the Signal
            Bot source now lives inside this card) — the guide narrates both beats on it. */}
        {/* Dan #N2IM: Home = a GLANCE + a DOOR. The heavy portfolio/positions/holdings
            breakdown now lives ONLY on /overview (the full dashboard); Home shows one
            compact line (total value + P&L) and a clear "Full dashboard →" button. The
            guide anchors (portfolio/signal) ride on the glance so the tour still resolves. */}
        <div data-guide="portfolio"><div data-guide="signal" data-tour="home-positions"><HomeGlance /></div></div>
        {/* Persistent help layer / pill — the safety net for a lost user. Also the guide's
            "bottom" anchor (Learn · Reels · Help Portal) + where the Guide launch button lives. */}
        <div data-guide="bottom"><HelpLayer /></div>
      </div>
      </div>{/* /scaleRef */}
      </div>{/* /fit box */}

      {/* Board 1 — fast price ticker pinned to the very top */}
      <PriceTickerBar lang={lang} />


      {/* Trending asset popup — opened by tapping/clicking a slider card */}
      {trendOpen && (
        <div onClick={() => setTrendOpen(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, direction: rtl ? "rtl" : "ltr" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 330, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.45)", fontFamily: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: trendOpen.tag.c, border: `1px solid ${trendOpen.tag.c}66`, borderRadius: 5, padding: "2px 7px" }}>{lang === "he" ? trendOpen.tag.he : trendOpen.tag.en}</span>
              <button onClick={() => setTrendOpen(null)} className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: C.text }}>{trendOpen.sym}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
              <span style={{ fontFamily: MONO, fontSize: 18, color: C.text }}>{fmtPrice(trendOpen.price)}</span>
              <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 800, color: trendOpen.col }}>{trendOpen.up ? "▲" : "▼"}{Math.abs(trendOpen.ch).toFixed(2)}%</span>
            </div>
            <div style={{ marginTop: 12 }}><Spark up={trendOpen.up} seed={trendOpen.sym + "_big"} /></div>
            <button onClick={() => { setTrendOpen(null); nav("/scanner"); }} className="gbtn" style={{ marginTop: 16, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 999, padding: "12px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
              <TrendingUp size={15} /> {lang === "he" ? "פתח בסורק" : "Open in scanner"}
            </button>
          </div>
        </div>
      )}

      {/* 3-step quick-start wizard: go back, green check per done step, advance only on press */}
      {start && (() => {
        const STEPS = [
          { path: "/university", title: t.s1t, sub: t.s1s, icon: <BookOpen size={26} color="#0B0613" strokeWidth={2.4} />, ring: "linear-gradient(135deg,#36C5F0,#2F7BBE)" },
          { path: "/exchange", title: t.s2t, sub: t.s2s, icon: <ArrowLeftRight size={26} color="#0B0613" strokeWidth={2.4} />, ring: "linear-gradient(135deg,#7CC04E,#3f9142)" },
          { path: "/profit", title: t.s3t, sub: t.s3s, icon: <TrendingUp size={26} color="#0B0613" strokeWidth={2.4} />, ring: BRAND },
        ];
        const cur = STEPS[step];
        const isLast = step === STEPS.length - 1;
        const Fwd = rtl ? ChevronLeft : ChevronRight;
        const Bwd = rtl ? ChevronRight : ChevronLeft;
        return (
          <div onClick={() => setStart(false)} dir={rtl ? "rtl" : "ltr"}
            style={{ position: "fixed", inset: 0, zIndex: 45, display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.66)", backdropFilter: "blur(4px)" }} />
            <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "100%", maxWidth: 400, borderRadius: 22,
              border: "1px solid rgba(247,181,0,0.3)", padding: 22, background: "linear-gradient(160deg,#15101f,#0B0613)", boxShadow: "0 24px 64px rgba(0,0,0,0.6)" }}>
              <button onClick={() => setStart(false)} aria-label="close" className="tap44" style={{ position: "absolute", top: 12, [rtl ? "left" : "right"]: 12, width: 30, height: 30,
                borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", cursor: "pointer" }}>
                <X size={15} />
              </button>
              <h3 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 900, color: "#fff" }}>{t.startTitle}</h3>

              {/* progress: numbered chips that turn green when done */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                {STEPS.map((_, i) => {
                  const done = doneSteps[i]; const active = i === step;
                  return (
                    <React.Fragment key={i}>
                      <button onClick={() => setStep(i)} aria-label={`${t.stStep} ${i + 1}`} style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800,
                        background: done ? "#1f9d57" : active ? C.gold : "rgba(255,255,255,0.08)",
                        color: done ? "#fff" : active ? "#1a1206" : "#cbd5e1", border: active && !done ? "none" : "1px solid rgba(255,255,255,0.12)" }}>
                        {done ? <Check size={16} /> : i + 1}
                      </button>
                      {i < STEPS.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, background: doneSteps[i] ? "#1f9d57" : "rgba(255,255,255,0.12)" }} />}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* current step */}
              <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 18 }}>
                <span style={{ flexShrink: 0, width: 52, height: 52, borderRadius: "50%", background: cur.ring, display: "flex", alignItems: "center", justifyContent: "center" }}>{cur.icon}</span>
                <div>
                  <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 2 }}>{t.stStep} {step + 1} / {STEPS.length}</div>
                  <b style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{cur.title}</b>
                  <div style={{ fontSize: 12.5, color: "#a9b2c0", marginTop: 3, lineHeight: 1.5 }}>{cur.sub}</div>
                </div>
              </div>

              {/* open-this-screen link (leaves the wizard so they can look) */}
              <button onClick={() => {
                  sessionStorage.setItem("algo770_qs", "1");
                  sessionStorage.setItem("algo770_qs_step", String(step));
                  sessionStorage.setItem("algo770_qs_done", JSON.stringify(doneSteps));
                  window.dispatchEvent(new Event("qs-change"));
                  setStart(false); nav(cur.path);
                }} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff", borderRadius: 12, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}>
                <Play size={13} fill="#F7931A" color="#F7931A" /> {t.stOpen}
              </button>

              {/* nav: back + done/next */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "1px solid rgba(255,255,255,0.14)",
                    color: step === 0 ? "#5b6473" : "#cbd5e1", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: step === 0 ? "default" : "pointer", fontFamily: "inherit" }}>
                  <Bwd size={15} /> {t.stBack}
                </button>
                <button onClick={() => {
                    setDoneSteps((d) => { const n = [...d]; n[step] = true; return n; });
                    if (isLast) setStart(false); else setStep((s) => s + 1);
                  }}
                  className="gbtn"
                  style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    borderRadius: 12, padding: "11px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                  {isLast ? <><Check size={16} /> {t.stDone}</> : <>{t.stNext} <Fwd size={16} /></>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {info && (
        <div style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={() => setInfo(null)}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} />
          <div onClick={(e) => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"}
            style={{ position: "relative", width: "100%", maxWidth: 384, borderRadius: 24, border: "1px solid rgba(255,255,255,0.1)",
              padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", background: "linear-gradient(160deg, #15101f 0%, #0B0613 100%)" }}>
            <button onClick={() => setInfo(null)} aria-label="close" className="tap44"
              style={{ position: "absolute", top: 12, [rtl ? "left" : "right"]: 12, width: 32, height: 32, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0", cursor: "pointer" } as React.CSSProperties}>
              <X size={15} />
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--btn-bg)" }}>
                <Info size={16} color="#0B0613" strokeWidth={2.4} />
              </span>
              <h3 style={{ fontSize: 18, fontWeight: 900, color: "#fff", margin: 0 }}>{ORBS.find((o) => o.key === info)?.title}</h3>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "#cbd5e1", margin: 0 }}>{ORBS.find((o) => o.key === info)?.body}</p>
            <button onClick={() => { const o = ORBS.find((x) => x.key === info); setInfo(null); if (o?.path) nav(o.path); }}
              style={{ marginTop: 20, width: "100%", borderRadius: 16, padding: "12px 0", fontWeight: 700, color: "#fff", border: "none",
                cursor: "pointer", background: "var(--btn-bg)", boxShadow: "0 8px 28px rgba(247,181,0,0.35)" }}>
              {ORBS.find((o) => o.key === info)?.title}
            </button>
          </div>
        </div>
      )}

      {/* About Us / מי אנחנו — opened from the wordmark. Renders the SHARED
          AboutContent so it stays in sync with the Explanations screen's About tile.
          Theme-surfaced (C.*) so it adapts to the active skin; RTL-aware. */}
      {aboutOpen && (
        <div onClick={() => setAboutOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, direction: rtl ? "rtl" : "ltr" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.45)", fontFamily: "inherit", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 900, color: C.text }}>
                <Info size={17} color={C.gold} /> {ABOUT_STR[lang].aboutTitle}
              </span>
              <button onClick={() => setAboutOpen(false)} aria-label="close" className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <AboutContent />
          </div>
        </div>
      )}

    </div>{/* /fitRef scroll region */}
      {/* Persistent bottom tab bar — a REAL flex-shrink:0 child at the BOTTOM of the column
          (NOT position:fixed), so it can never be covered or pushed off-screen however tall the
          content is. Self-hides on desktop. Home's modals (z >= 1000, rendered above inside the
          scroll region) still layer above it. */}
      <TabBar />
    </div>
  );
}

// ── HERO — the two big SOLID SQUARE trading buttons wrapped in a THICK skin-coloured
// The central action squares (the springboard hero) — now DATA-DRIVEN + editable via
// SquareRow, so a user picks which central buttons appear + their order (✎ → choose
// from list → APPROVE) and an owner sets the default for everyone, resolving exactly
// like the shortcuts row. GlassTile's primary/secondary variants + homeDim reproduce
// the previous hand-written squares pixel-for-pixel (same dims/tint/rim/label sizes),
// so the no-scroll fit is unchanged. Default shows the two current buttons (Trading ·
// Personal Portal); Signal Bot / Trading Engine / Exchange are addable from the list.
// The central-square catalog (shared by the live hero AND Home's combined layout editor)
// so both edit exactly the same buttons. Default shows Trading · Personal Portal.
// The home now states the product's order of operations: FIRST you build your own
// strategy (that's the whole premise — StrateTeach), THEN you run it in the engine.
// So the big primary square is Strategies (step 1) and the engine is the smaller
// step 2 beside it. The step labels make the flow readable at a glance.
const HOME_CENTRAL_DEFAULT = ["strategy", "trading"];
function homeCentralSquares(he: boolean, nav: (p: string) => void): SquareDef[] {
  return [
    { id: "strategy", variant: "primary", Icon: GraduationCap, label: he ? "אסטרטגיות" : "Strategies", sub: he ? "צעד 1 · בנה את שלך" : "Step 1 · build yours", onClick: () => nav("/strategy") },
    { id: "trading", variant: "secondary", Icon: Rocket, label: he ? "מסחר" : "Trading", sub: he ? "צעד 2 · הרץ אותה" : "Step 2 · run it", onClick: () => nav("/trading") },
    { id: "engine", variant: "secondary", Icon: Cpu, label: he ? "מנוע מסחר" : "Trading Engine", sub: he ? "דמו ולייב" : "Demo & live", onClick: () => nav("/profit") },
    { id: "personal", variant: "secondary", Icon: UserRound, label: he ? "פורטל אישי" : "Personal Portal", sub: he ? "פרטים · הגדרות · חיבורים" : "Details · settings · links", onClick: () => nav("/personal") },
    { id: "signalbot", variant: "secondary", Icon: Bot, label: he ? "סיגנל בוט" : "Signal Bot", sub: "TradingView", onClick: () => nav("/bots") },
    { id: "exchange", variant: "secondary", Icon: ArrowLeftRight, label: he ? "בורסה" : "Exchange", sub: he ? "חשבונות ומפתחות" : "accounts & keys", onClick: () => nav("/exchange") },
  ];
}

function GlobeHero({ mobile }: { mobile?: boolean }) {
  const { lang } = useI18n();
  const nav = useNavigate();
  const he = lang === "he";
  // NO standalone edit trigger here (Dan #8CFI/IMG_4889): the separate central-buttons "ערוך" was
  // redundant with the shortcuts-row edit chip, which opens the SAME combined editor whose "big
  // buttons" tab edits these squares. So `editable={false}` drops the duplicate trigger; editing the
  // two big buttons still works via that tab (it saves to the same "home-central" layout SquareRow
  // reads). Removing the control also tightens the tools-row → big-buttons gap.
  return (
    <SquareRow screenKey="home-central" mobile={mobile} defaultShown={HOME_CENTRAL_DEFAULT}
      editable={false} liquid squares={homeCentralSquares(he, nav)} />
  );
}

// ── Compact P&L strip — ONE clean line for the ACTIVE mode (live | demo), driven by the
// SAME shared `mode` state as the open-positions toggle below it: one toggle switches
// both the P&L headline AND the positions panel together (no more two stacked P&L rows).
// The single line shows exactly what the owner asked for: current total value · today's
// rise (amount + %) · overall rise vs. deposited capital (amount + %). For LIVE when no
// exchange is connected it shows the compact "חבר בורסה" connect prompt instead of numbers.
// Sources: LIVE → livePnl (totalValue, period.today, growthPnl/growthPct); DEMO →
// paperState (totalValue, totalPnl) + dashboardLive.demo (today change/%). Self-contained
// (react-query dedupes the shared query keys). Skin-aware (C.*). RTL-correct (LTR-isolated
// numeric spans so "$281 (+1.29%)" never pulls/overlaps inside the Hebrew layout).
export function PnlStrip({ hide, onToggle, mode }: { hide: boolean; onToggle: () => void; mode: "live" | "demo" }) {
  const { lang } = useI18n();
  const nav = useNavigate();
  const he = lang === "he";
  const mobile = useIsMobile();
  const [showInfo, setShowInfo] = useState(false);
  const creds = loadExchangeCreds() as any;
  const connected = !!(creds && creds.key && creds.secret);
  const liveQ = useQuery({ queryKey: ["dashboardLive"], queryFn: () => api.dashboardLive(), refetchInterval: 15000, retry: 0 });
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: connected, retry: false, refetchInterval: 30000 });
  const pnl: any = pnlQ.data;
  // REAL money — the total account BALANCE (totalValue) + today's change vs the deposit-
  // aware baseline (period.today). % is today's change over the BALANCE SHOWN here so the
  // two visible figures reconcile (+$3.63 on $281.25 → +1.29%).
  const realTotal: number | null = pnl?.ok ? Number(pnl.totalValue) : null;
  const realToday: number | null = pnl?.ok && pnl.period?.today != null ? Number(pnl.period.today) : null;
  const realPct: number | null = realToday != null && realTotal != null && realTotal > 0 ? (realToday / realTotal) * 100 : null;
  // OVERALL: portfolio GROWTH vs. net deposited capital (server-computed). null = no deposit
  // recorded yet → prompt to set it.
  const growthPnl: number | null = pnl?.ok && pnl.growthPnl != null ? Number(pnl.growthPnl) : null;
  const growthPct: number | null = pnl?.ok && pnl.growthPct != null ? Number(pnl.growthPct) : null;
  // DEMO — the paper-trading portfolio, marked to market: VALUE (Σ open positions) as the
  // total, GROWTH vs. deployed capital (value − deposited = totalPnl) as the overall figure,
  // and today's change from dashboardLive.demo (the deposit-aware today delta + %).
  const demoQ = useQuery({ queryKey: ["paperState"], queryFn: () => api.paperState(), retry: false, refetchInterval: 15000 });
  const demoState: any = demoQ.data;
  const demoValue: number | null = demoState ? Number(demoState.totalValue || 0) : null;
  const demoGrowth: number | null = demoState ? Number(demoState.totalPnl || 0) : null;
  const demoGrowthPct: number | null = demoState && demoState.totalPnlPct != null ? Number(demoState.totalPnlPct) : null;
  const demoDash: any = (liveQ.data as any)?.demo;
  const demoToday: number | null = demoDash && demoDash.todayChange != null ? Number(demoDash.todayChange) : null;
  const demoTodayPct: number | null = demoDash && demoDash.todayPct != null ? Number(demoDash.todayPct) : null;

  const usd = (v: number | null) => v == null || isNaN(v) ? "—" : "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signed = (v: number | null) => v == null || isNaN(v) ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const pctTxt = (p: number | null) => p == null || isNaN(p) ? "" : `${mobile ? "" : " "}(${p >= 0 ? "+" : ""}${p.toFixed(2)}%)`;

  // LTR-isolated numeric span — keeps "$281.25 (+1.29%)" rendering left-to-right and stops
  // it pulling/overlapping inside the Hebrew RTL layout.
  const Num = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <span dir="ltr" style={{ unicodeBidi: "isolate", whiteSpace: "nowrap", ...style }}>{children}</span>
  );
  // MOBILE must fit ONE physical line at ~390px: shrink the value + secondary fonts,
  // tighten separators, and abbreviate the overall label. DESKTOP keeps the roomier sizes.
  const mainVal: React.CSSProperties = { fontFamily: MONO, fontSize: mobile ? 15 : 17, fontWeight: 900, color: C.text };
  const labelSz = mobile ? 8.5 : 10.5;
  const numSz = mobile ? 10.5 : 13;
  // A compact labeled figure: "היום +$2.97 (+1.06%)" — small label, then the LTR-isolated
  // signed amount + %. Coloured gain/loss. Used for BOTH the today and overall segments.
  // On mobile the amount+% is packed tight (no space before the paren) to fit one line.
  const figure = (label: string, val: number | null, pct: number | null) => (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: mobile ? 2 : 4 }}>
      <span style={{ fontSize: labelSz, fontWeight: 800, color: C.muted, whiteSpace: "nowrap" }}>{label}</span>
      <Num style={{ fontFamily: MONO, fontSize: numSz, fontWeight: 900, color: (val ?? 0) >= 0 ? C.gain : C.loss }}>{signed(val)}{pctTxt(pct)}</Num>
    </span>
  );
  // A dim mid-dot separator between the three figures.
  const dot = <span style={{ color: C.faint, fontWeight: 900, opacity: 0.7, fontSize: mobile ? 10 : undefined }}>·</span>;

  // Resolve the ACTIVE mode's figures from the shared `mode` state (same toggle as positions).
  const isDemo = mode === "demo";
  const loading = isDemo ? demoQ.isLoading : (connected && pnlQ.isLoading);
  const total = isDemo ? demoValue : realTotal;
  const todayVal = isDemo ? demoToday : realToday;
  const todayPct = isDemo ? demoTodayPct : realPct;
  const overallVal = isDemo ? demoGrowth : growthPnl;
  const overallPct = isDemo ? demoGrowthPct : growthPct;
  // LIVE + not connected → the compact connect prompt instead of numbers (kept as-is).
  const showConnect = !isDemo && !connected;
  // Overall = growth vs. deposited capital. Abbreviated to "סה״כ"/"total" on mobile so the
  // whole row fits one physical line; the roomier "מהפקדה"/"vs deposit" stays on desktop.
  const overallLabel = he ? (mobile ? "סה״כ" : "מהפקדה") : (mobile ? "total" : "vs deposit");
  const todayLabel = he ? "היום" : "today";

  // Tiny clarification: "today" can exceed "from deposit" when the portfolio was BELOW the
  // deposit at the day's start — both figures are correct, just measured from different
  // baselines. Shown in a small popover behind an unobtrusive ⓘ (display-only; no math).
  const infoNote = he
    ? "\"היום\" = השינוי מתחילת היום (00:01 שעון ישראל). \"מהפקדה\" = השינוי מאז ההפקדה שלך. לכן \"היום\" יכול להיות גדול מ\"מהפקדה\" אם בתחילת היום היית מתחת לסכום שהפקדת — שני המספרים נכונים, הם פשוט נמדדים מנקודת פתיחה שונה."
    : "\"today\" = the change since the start of today (00:01 Israel time). \"from deposit\" = the change since your deposit. So \"today\" can be larger than \"from deposit\" if you were below your deposited amount at the start of the day — both numbers are correct, just measured from a different starting point.";

  return (
    <div style={{ position: "relative" }}>
    {/* ONE clean line for the active mode. Direction-locked so it aligns to the start edge
        (right in RTL) and numeric spans stay LTR-isolated — no left-pull. MOBILE forces a
        single physical line (nowrap + compact fonts); desktop may wrap (it has the width). */}
    {/* Clean card — VISUAL SIBLING of the AutoPilots + Live-positions home panels
        (soft glassTint surface, glass border, inner-highlight bevel, 16px radius). */}
    <div style={{ display: "flex", alignItems: "center", flexWrap: mobile ? "nowrap" : "wrap", gap: mobile ? 5 : 8, direction: he ? "rtl" : "ltr",
      background: C.glassTint, border: `1px solid ${C.glassBd}`, borderRadius: 16, boxShadow: `0 6px 16px -12px rgba(0,0,0,0.42), ${C.glassHi}`,
      padding: mobile ? "10px 12px" : "10px 13px", overflow: "hidden" }}>
      {showConnect ? (
        // LIVE, no exchange — keep the honest connect prompt (no fake numbers).
        <button onClick={() => nav("/exchange?sec=connect")} title={he ? "חבר בורסה" : "Connect exchange"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: C.gold, whiteSpace: "nowrap" }}>
            {he ? "חבר בורסה ←" : "Connect exchange →"}
          </span>
        </button>
      ) : (
        <>
          {/* (a) TOTAL — the prominent value, doubles as the eye (hide) toggle. */}
          <button onClick={onToggle} aria-label={he ? "הצג/הסתר" : "show/hide"}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
            <Num style={mainVal}>{hide ? "••••" : loading ? "…" : usd(total)}</Num>
            {hide ? <EyeOff size={13} color={C.muted} /> : <Eye size={13} color={C.muted} />}
          </button>
          {!hide && !loading && (
            <>
              {/* (b) TODAY's rise — amount + %. */}
              {todayVal != null && <>{dot}{figure(todayLabel, todayVal, todayPct)}</>}
              {/* (c) OVERALL rise vs. deposited capital — amount + %. LIVE with no deposit set
                  yet falls back to a prompt to set it. */}
              {overallVal != null ? (
                <>{dot}{figure(overallLabel, overallVal, overallPct)}</>
              ) : (!isDemo && (
                <>{dot}<span onClick={() => nav("/overview")} style={{ fontSize: 11, fontWeight: 800, color: C.gold, whiteSpace: "nowrap", cursor: "pointer" }}>
                  {he ? "הגדר הון שהופקד ←" : "set deposited capital →"}
                </span></>
              ))}
            </>
          )}
          {/* Tiny ⓘ — explains why "today" can exceed "from deposit". Sits at the row end. */}
          {!hide && !loading && (
            <button onClick={() => setShowInfo((v) => !v)} aria-label={he ? "מידע על היום ומהפקדה" : "about today vs from-deposit"}
              style={{ marginInlineStart: "auto", background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", alignItems: "center", flexShrink: 0, color: showInfo ? C.gold : C.faint }}>
              <Info size={13} />
            </button>
          )}
        </>
      )}
    </div>
    {showInfo && (
      <>
        {/* click-away scrim */}
        <div onClick={() => setShowInfo(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
        <div dir={he ? "rtl" : "ltr"} style={{ position: "absolute", top: "calc(100% + 6px)", insetInlineEnd: 0, zIndex: 41,
          maxWidth: mobile ? 280 : 320, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12,
          padding: "11px 13px", boxShadow: "0 14px 34px -20px rgba(0,0,0,0.55)", fontSize: 11.5, lineHeight: 1.6, color: C.muted }}>
          {infoNote}
        </div>
      </>
    )}
    </div>
  );
}

// ── Persistent HELP LAYER — the safety net for a lost user, kept prominent right
// under the hero on every device. "New here? / Lost?" → Learn · Reels · Help Portal
// (the existing Help Portal pill, HelpPortalButton). Reuses existing routes; it is a
// plain in-flow cluster — no overlay, no fixed positioning.
export function HelpLayer() {
  const { lang } = useI18n();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const he = lang === "he";
  // Learn · Reels share the ONE bordered-SQUARE tile look (sqTile) — matching the Help
  // Portal (square) beside them and the shortcuts/About tiles above, so all read as one set.
  const linkBtn: React.CSSProperties = {
    ...sqTile(),
    display: "inline-flex", alignItems: "center", gap: 5, padding: mobile ? "4px 10px" : "8px 13px",
    fontSize: mobile ? 10 : 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
    flexShrink: 0,
  };
  return (
    // FIVE items (New here? · Learn · Reels · Guide · Help Portal). On mobile Learn/Reels/Guide are
    // icon-only (above), so all five fit ONE compact line at 390px — no wrap, so the row adds no
    // extra height and Home no longer scrolls. flex-wrap stays as a graceful fallback on an even
    // narrower phone (it only wraps if it genuinely must). DESKTOP unchanged (labels + wrap card).
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center",
      gap: mobile ? 6 : 8, overflowX: "visible",
      background: C.glassTint, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
      border: `1px dashed ${C.frameAccent}66`, borderRadius: mobile ? 999 : 13, padding: mobile ? "5px 10px" : "10px 12px", boxShadow: C.glassHi }}>
      {/* "New here? / Lost?" → the dedicated BEGINNER GUIDE (/guide): a friendly, always-
          re-openable library that starts a total beginner from zero (the full reference
          library still lives one tap deeper, under "Learn"). Shorter label on mobile. */}
      <button onClick={() => nav("/guide")} className="tap44"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: mobile ? 11 : 12.5, fontWeight: 800,
          color: C.text, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "2px 4px", whiteSpace: "nowrap", flexShrink: 0 }}>
        <Info size={mobile ? 12 : 14} color={C.gold} /> {he ? (mobile ? "חדש כאן?" : "חדש כאן? אבדת?") : (mobile ? "New here?" : "New here? Lost?")}
      </button>
      {/* MOBILE: Learn / Reels / Guide are ICON-ONLY so all five items fit ONE line (adding the
          Guide button had pushed the row to a 2nd wrapped line, whose extra height made Home
          scroll). Desktop keeps the labels. */}
      <button onClick={() => nav("/university")} className="tap44" style={linkBtn} title={he ? "למידה" : "Learn"} aria-label={he ? "למידה" : "Learn"}>
        <BookOpen size={mobile ? 14 : 14} color={C.gold} /> {!mobile && (he ? "למידה" : "Learn")}
      </button>
      <button onClick={() => nav("/reels")} className="tap44" style={linkBtn} title={he ? "רילים" : "Reels"} aria-label={he ? "רילים" : "Reels"}>
        <Play size={mobile ? 13 : 13} fill={C.gold} color={C.gold} /> {!mobile && (he ? "רילים" : "Reels")}
      </button>
      {/* Animated Home Guide launch — sits with Reels/Help (audio needs a user gesture, so the
          tour starts from this tap). Self-hides when the guide is switched off server-side.
          Icon-only on mobile (compact) so the help row stays one line. */}
      <GuideLaunchButton square compact={mobile} />
      {/* Help Portal — the BOLD, high-contrast CTA (owner: must stand out + be easy to
          hit), now the bordered SQUARE variant so it matches Learn + Reels beside it. */}
      <HelpPortalButton cta square />
    </div>
  );
}

// (The starfield + ambient glows that used to live here now live in the shared
// HomeBackdrop component, rendered both here and by the Shell on every inner
// screen so the whole app shares one consistent, skin-aware backdrop.)

// ── Live, futuristic per-orb graphics. Each is a self-animating SVG (SMIL) so
// every button on the springboard feels alive instead of a flat coloured icon.
function OrbArt({ kind, size, accent }: { kind: OrbKey; size: number; accent: string }) {
  const a = accent;                       // per-orb colour line art — glows on the blue
  const lite = "#ffffff";                 // bright white highlight
  const fill = `${accent}2a`;             // faint colour fill
  const common = {
    width: size, height: size, viewBox: "0 0 100 100",
    style: { filter: `drop-shadow(0 0 3px ${accent}cc)`, overflow: "visible" } as React.CSSProperties,
  };
  switch (kind) {
    case "signals": // daily-scan calendar showing today's date + a scan sweep
      return (
        <svg {...common}>
          {/* binder rings */}
          <line x1="38" y1="20" x2="38" y2="30" stroke={a} strokeWidth="3" strokeLinecap="round" />
          <line x1="62" y1="20" x2="62" y2="30" stroke={a} strokeWidth="3" strokeLinecap="round" />
          {/* calendar body */}
          <rect x="24" y="26" width="52" height="50" rx="6" fill={fill} stroke={a} strokeWidth="2.4" />
          <rect x="24" y="26" width="52" height="11" rx="6" fill={a} />
          {/* today's date */}
          <text x="50" y="65" textAnchor="middle" fontSize="27" fontWeight="800" fill={a} fontFamily="system-ui, -apple-system, sans-serif">{new Date().getDate()}</text>
          {/* scan line sweeping down the page */}
          <rect x="26" y="40" width="48" height="5" rx="2" fill={lite} opacity="0.55">
            <animate attributeName="y" values="40;69;40" dur="2.6s" repeatCount="indefinite" />
          </rect>
        </svg>
      );
    case "runs": // live backtest — candlesticks that keep replaying
      return (
        <svg {...common}>
          <line x1="20" y1="76" x2="80" y2="76" stroke={`${a}66`} strokeWidth="1.6" strokeLinecap="round" />
          {[
            { x: 30, up: true,  hi: "22;18;28;20", b: "0s",   yy: "44;34;52;40", hh: "20;30;12;24" },
            { x: 43, up: false, hi: "26;30;20;28", b: "0.35s", yy: "50;40;58;46", hh: "16;26;8;18" },
            { x: 57, up: true,  hi: "20;26;16;22", b: "0.7s",  yy: "38;30;48;36", hh: "26;34;14;28" },
            { x: 70, up: false, hi: "30;24;34;26", b: "1.05s", yy: "54;46;60;50", hh: "12;22;6;16" },
          ].map((c, i) => (
            <g key={i}>
              <line x1={c.x} y1="26" x2={c.x} y2="74" stroke={c.up ? "#27d17f" : "#ff5b6b"} strokeWidth="1.4" />
              <rect x={c.x - 4.5} width="9" rx="1.5" fill={c.up ? "#27d17f" : "#ff5b6b"} stroke={c.up ? "#1aa763" : "#d8404f"} strokeWidth="1.2">
                <animate attributeName="y" values={c.yy} dur="2.2s" begin={c.b} repeatCount="indefinite" />
                <animate attributeName="height" values={c.hh} dur="2.2s" begin={c.b} repeatCount="indefinite" />
              </rect>
            </g>
          ))}
        </svg>
      );
    case "lab": // spinning atom
      return (
        <svg {...common}>
          {[0, 60, 120].map((rot, i) => (
            <g key={i} transform={`rotate(${rot} 50 50)`}>
              <ellipse cx="50" cy="50" rx="32" ry="13" fill="none" stroke={a} strokeWidth="2.6" />
              <g>
                <circle cx="82" cy="50" r="3.6" fill={["#37E0D8", "#FF7AB8", "#FFD24A"][i]} />
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to={`${i % 2 ? -360 : 360} 50 50`} dur={`${2.6 + i * 0.6}s`} repeatCount="indefinite" />
              </g>
            </g>
          ))}
          <circle cx="50" cy="50" r="5.5" fill={lite} />
        </svg>
      );
    case "profit": // shimmering faceted diamond
      return (
        <svg {...common}>
          <polygon points="50,18 72,42 50,82 28,42" fill={fill} stroke={a} strokeWidth="2.6" strokeLinejoin="round" />
          <line x1="28" y1="42" x2="72" y2="42" stroke={a} strokeWidth="2.2" />
          <line x1="50" y1="18" x2="50" y2="82" stroke={`${a}88`} strokeWidth="1.6" />
          <line x1="40" y1="42" x2="50" y2="82" stroke={`${a}55`} strokeWidth="1.2" />
          <line x1="60" y1="42" x2="50" y2="82" stroke={`${a}55`} strokeWidth="1.2" />
          {[{ x: 78, y: 26, b: "0s" }, { x: 22, y: 58, b: "0.9s" }].map((sp, i) => (
            <path key={i} d={`M${sp.x} ${sp.y - 6} l1.8 4.2 4.2 1.8 -4.2 1.8 -1.8 4.2 -1.8 -4.2 -4.2 -1.8 4.2 -1.8 z`} fill={lite}>
              <animate attributeName="opacity" values="0;1;0" dur="1.9s" begin={sp.b} repeatCount="indefinite" />
            </path>
          ))}
        </svg>
      );
    case "chat": // two people facing each other, taking turns talking
      return (
        <svg {...common}>
          {/* left person (teal) */}
          <circle cx="30" cy="44" r="9" fill="#37C0FF" />
          <path d="M16 74 a14 14 0 0 1 28 0 z" fill="#37C0FF" />
          {/* right person (green) */}
          <circle cx="70" cy="44" r="9" fill="#36E0A0" />
          <path d="M56 74 a14 14 0 0 1 28 0 z" fill="#36E0A0" />
          {/* alternating little speech bubbles above their heads */}
          <g>
            <ellipse cx="30" cy="24" rx="7" ry="5" fill={lite} />
            <animate attributeName="opacity" values="1;1;0;0" dur="2.4s" repeatCount="indefinite" />
          </g>
          <g>
            <ellipse cx="70" cy="24" rx="7" ry="5" fill={lite} />
            <animate attributeName="opacity" values="0;0;1;1" dur="2.4s" repeatCount="indefinite" />
          </g>
        </svg>
      );
    case "menu": // main menu — three glowing bars
      return (
        <svg {...common}>
          {[34, 50, 66].map((y, i) => (
            <rect key={i} x="24" y={y - 4} width="52" height="8" rx="4" fill={a}>
              <animate attributeName="opacity" values="0.45;1;0.45" dur="1.9s" begin={`${i * 0.22}s`} repeatCount="indefinite" />
            </rect>
          ))}
        </svg>
      );
    case "dash": // dashboard — KPI tiles with a live bar
      return (
        <svg {...common}>
          <rect x="22" y="22" width="24" height="22" rx="4" fill={fill} stroke={a} strokeWidth="2.4" />
          <rect x="54" y="22" width="24" height="14" rx="4" fill={fill} stroke={a} strokeWidth="2.4" />
          <rect x="54" y="44" width="24" height="34" rx="4" fill={fill} stroke={a} strokeWidth="2.4" />
          <rect x="22" y="52" width="24" height="26" rx="4" fill={fill} stroke={a} strokeWidth="2.4" />
          <rect x="27" y="60" width="6" height="12" rx="1.5" fill={a}>
            <animate attributeName="height" values="6;14;6" dur="1.8s" repeatCount="indefinite" />
            <animate attributeName="y" values="66;58;66" dur="1.8s" repeatCount="indefinite" />
          </rect>
        </svg>
      );
    case "agent": // AI agent — a friendly robot head with a thinking pulse
      return (
        <svg {...common}>
          {/* antenna */}
          <line x1="50" y1="16" x2="50" y2="26" stroke={a} strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="50" cy="14" r="3" fill={a}><animate attributeName="opacity" values="0.3;1;0.3" dur="1.4s" repeatCount="indefinite" /></circle>
          {/* head */}
          <rect x="26" y="28" width="48" height="40" rx="11" fill={fill} stroke={a} strokeWidth="2.6" />
          {/* eyes */}
          <circle cx="40" cy="46" r="4.6" fill={a}><animate attributeName="r" values="4.6;1.4;4.6" dur="3.4s" repeatCount="indefinite" /></circle>
          <circle cx="60" cy="46" r="4.6" fill={a}><animate attributeName="r" values="4.6;1.4;4.6" dur="3.4s" repeatCount="indefinite" /></circle>
          {/* smile */}
          <path d="M40 56 q10 8 20 0" fill="none" stroke={a} strokeWidth="2.4" strokeLinecap="round" />
          {/* ears */}
          <rect x="20" y="42" width="5" height="12" rx="2.5" fill={a} />
          <rect x="75" y="42" width="5" height="12" rx="2.5" fill={a} />
          {/* sparkle */}
          <path d="M76 24 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6 z" fill={lite}>
            <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" />
          </path>
        </svg>
      );
    case "glossary": // a professor (graduation cap) explaining, with a talking bubble
    default:
      return (
        <svg {...common}>
          {/* head + shoulders */}
          <circle cx="40" cy="46" r="10" fill={fill} stroke={a} strokeWidth="2" />
          <path d="M24 76 a16 16 0 0 1 32 0 z" fill={fill} stroke={a} strokeWidth="2" />
          {/* mortarboard cap */}
          <polygon points="40,24 64,33 40,42 16,33" fill={a} />
          <line x1="40" y1="42" x2="40" y2="36" stroke={a} strokeWidth="1.4" />
          <line x1="62" y1="34" x2="64" y2="48" stroke={a} strokeWidth="1.4" />
          <circle cx="64" cy="49" r="2.2" fill={a} />
          {/* speech bubble with talking dots */}
          <rect x="58" y="50" width="26" height="16" rx="4" fill={lite} stroke={a} strokeWidth="1.6" />
          {[64, 71, 78].map((cx, i) => (
            <circle key={i} cx={cx} cy="58" r="1.7" fill={a}>
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.2s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
            </circle>
          ))}
        </svg>
      );
  }
}

// ── A live-style "stock board": a market ticker that runs across the bottom of
// the springboard. Real crypto prices are merged in from the daily scan when
// available; the rest drift gently so the board always feels alive. ───────────
// Crypto only — these all have REAL last prices from the exchange ticker.
// (Stocks/commodities were removed: the data engine is crypto-only, so those
// numbers couldn't be real.)
// Multi-asset marquee: crypto prices are live; stocks/metals/commodities show
// the asset class (a "you can invest across markets" signal), not a fake price.
type SeedRow = { sym: string; price: number; base: number; cls: "crypto" | "stock" | "metal" | "commodity" };
// NOTE: the trailing .map re-seeds `base` from `price`. It must be typed as SeedRow[]
// or TS widens `cls` back to `string` and the annotation stops matching.
const SEED: SeedRow[] = ([
  { sym: "BTC", price: 67250, base: 67250, cls: "crypto" }, { sym: "ETH", price: 3520, base: 3520, cls: "crypto" },
  { sym: "SOL", price: 168.4, base: 168.4, cls: "crypto" }, { sym: "AAPL", price: 226, base: 226, cls: "stock" },
  { sym: "NVDA", price: 128, base: 128, cls: "stock" }, { sym: "TSLA", price: 248, base: 248, cls: "stock" },
  { sym: "BNB", price: 604, base: 604, cls: "crypto" }, { sym: "XAU·GOLD", price: 2380, base: 2380, cls: "metal" },
  { sym: "XAG·SILVER", price: 29.6, base: 29.6, cls: "metal" }, { sym: "XRP", price: 0.523, base: 0.523, cls: "crypto" },
  { sym: "WTI·OIL", price: 78.2, base: 78.2, cls: "commodity" }, { sym: "LINK", price: 14.2, base: 14.2, cls: "crypto" },
  { sym: "NATGAS", price: 2.7, base: 2.7, cls: "commodity" }, { sym: "AVAX", price: 27.4, base: 27.4, cls: "crypto" },
  { sym: "DOGE", price: 0.162, base: 0.162, cls: "crypto" }, { sym: "COPPER", price: 4.3, base: 4.3, cls: "commodity" },
] as SeedRow[]).map((s) => ({ ...s, base: s.price }));

const CLS_TAG: Record<string, { en: string; he: string; c: string }> = {
  crypto: { en: "CRYPTO", he: "קריפטו", c: "#F7931A" },
  stock: { en: "STOCK", he: "מניה", c: "#36C5F0" },
  metal: { en: "METAL", he: "מתכת", c: "#FBC02D" },
  commodity: { en: "COMMODITY", he: "סחורה", c: "#7CC04E" },
};

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

// Shared live-price hook: REAL last prices from the exchange ticker, refreshed
// every 60s. No random drift — every number on the board is real. The % shown
// is the change since the page was opened (first real price = baseline).
function useLivePrices() {
  const [items, setItems] = useState(SEED);
  const inited = useRef(false);
  const syms = useRef(SEED.filter((s) => s.cls === "crypto").map((s) => s.sym)).current;
  // Prices refresh every 60s while the tab is visible; the poll PAUSES when the tab
  // is hidden (refetchIntervalInBackground:false) to save battery/data and resumes
  // on return — the next tick repaints the board with fresh prices.
  const q = useQuery({ queryKey: ["tickerPrices"], queryFn: () => api.tickerPrices(syms), staleTime: 60000, refetchInterval: 60000, refetchIntervalInBackground: false, retry: 0 });
  useEffect(() => {
    const prices: Record<string, number> = (q.data as any)?.prices || {};
    if (!Object.keys(prices).length) return;
    setItems((prev) => prev.map((it) => {
      const p = prices[it.sym];
      if (!(p && isFinite(p) && p > 0)) return it;
      return inited.current ? { ...it, price: p } : { ...it, price: p, base: p };
    }));
    inited.current = true;
  }, [q.data]);
  return items;
}

// ── Board 1: the fast price ticker pinned to the very top of the screen. ───────
function PriceTickerBar({ lang }: { lang: string }) {
  const mobile = useIsMobile();
  const items = useLivePrices();
  const Row = ({ tag }: { tag: string }) => (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
      {items.map((it, i) => {
        const ch = ((it.price - it.base) / it.base) * 100;
        const up = ch >= 0;
        const col = up ? "#3ee08a" : "#ff5b6b";
        const cls = (it as any).cls as string;
        const tagInfo = CLS_TAG[cls];
        return (
          <span key={tag + i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 14px" }}>
            <b style={{ color: "#e8edf4", fontFamily: MONO, fontSize: mobile ? 11 : 12.5, fontWeight: 800, letterSpacing: "0.04em" }}>{it.sym}</b>
            <span style={{ fontFamily: MONO, fontSize: mobile ? 11 : 12.5, color: "#aeb9c9" }}>{fmtPrice(it.price)}</span>
            {cls === "crypto" ? (
              <span style={{ fontFamily: MONO, fontSize: mobile ? 11 : 12, fontWeight: 800, color: col, textShadow: `0 0 7px ${col}88` }}>
                {up ? "▲" : "▼"}{Math.abs(ch).toFixed(2)}%
              </span>
            ) : (
              <span style={{ fontSize: 8.5, fontWeight: 800, color: tagInfo.c, border: `1px solid ${tagInfo.c}66`, borderRadius: 4, padding: "0 4px", letterSpacing: "0.04em" }}>{tagInfo.en}</span>
            )}
          </span>
        );
      })}
    </div>
  );
  return (
    <div data-guide="ticker" style={{ position: "fixed", left: 0, right: 0, top: 0, zIndex: 22, height: 34, overflow: "hidden",
      background: "linear-gradient(180deg,#0a1730,#030914)", borderBottom: "1px solid rgba(247,181,0,0.42)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.45)", display: "flex", alignItems: "center", pointerEvents: "none", direction: "ltr" }}>
      <style>{"@keyframes priceRun{from{transform:translateX(0)}to{transform:translateX(-50%)}}@keyframes liveBlink{0%,100%{opacity:1}50%{opacity:0.25}}"}</style>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 8px)" }} />
      <div style={{ display: "flex", flexShrink: 0, animation: "priceRun 46s linear infinite", whiteSpace: "nowrap" }}>
        <Row tag="a" /><Row tag="b" />
      </div>
      <div style={{ position: "absolute", top: 0, bottom: 0, [lang === "he" ? "right" : "left"]: 0, display: "flex", alignItems: "center", gap: 6,
        padding: "0 11px", background: lang === "he" ? "linear-gradient(270deg,#030914,rgba(3,9,20,0))" : "linear-gradient(90deg,#030914,rgba(3,9,20,0))" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3ee08a", animation: "liveBlink 1.4s ease-in-out infinite", boxShadow: "0 0 9px #3ee08a" }} />
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", color: C.gold }}>{lang === "he" ? "חי" : "LIVE"}</span>
      </div>
    </div>
  );
}


// A realistic brilliant-cut diamond in the classic gem silhouette (point down):
// faceted crown + pavilion with light/dark facets, faint spectral fire, bright
// edges, a specular highlight and twinkling scintillation. Solid fills so it
// always renders.
// A small indicative price sparkline for a coin card (shape varies by symbol,
// slope follows the up/down direction). Fills the card so it doesn't look empty.
function Spark({ up, seed }: { up: boolean; seed: string }) {
  const W = 90, H = 30, n = 22;
  let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rnd = (k: number) => { const x = Math.sin((h % 1000) + k * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const col = up ? "#3ee08a" : "#ff5b6b";
  let d = "";
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const slope = up ? (H - 4) - t * (H - 8) : 4 + t * (H - 8);
    const noise = (rnd(i) - 0.5) * 8;
    const x = (t * W).toFixed(1);
    const y = Math.max(2, Math.min(H - 2, slope + noise)).toFixed(1);
    d += (i ? "L" : "M") + x + " " + y + " ";
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block", marginTop: 6 }}>
      <path d={d} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 3px ${col}99)` }} />
    </svg>
  );
}

function Gem({ size }: { size: number }) {
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-flex",
      filter: "drop-shadow(0 8px 18px rgba(60,90,130,0.55))" }}>
      <style>{"@keyframes gemTwinkle{0%,100%{opacity:0;transform:scale(.3)}50%{opacity:1;transform:scale(1)}}"}</style>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        {/* crown */}
        <polygon points="34,22 66,22 70,40 30,40" fill="#eef4fa" />
        <polygon points="34,22 30,40 12,40" fill="#cdd9e6" />
        <polygon points="66,22 88,40 70,40" fill="#aebccd" />
        {/* pavilion facets to the culet (point) */}
        <polygon points="12,40 30,40 50,90" fill="#9fb1c4" />
        <polygon points="30,40 50,40 50,90" fill="#dde7f1" />
        <polygon points="50,40 70,40 50,90" fill="#b9c8d8" />
        <polygon points="70,40 88,40 50,90" fill="#8a9cb0" />
        {/* faint spectral fire */}
        <polygon points="30,40 50,40 50,90" fill="#bfe9ff" opacity="0.25" />
        <polygon points="50,40 70,40 50,90" fill="#ffd6ea" opacity="0.18" />
        {/* facet separators */}
        <g stroke="rgba(40,70,110,0.30)" strokeWidth="0.7">
          <line x1="34" y1="22" x2="30" y2="40" /><line x1="66" y1="22" x2="70" y2="40" />
          <line x1="30" y1="40" x2="50" y2="90" /><line x1="50" y1="40" x2="50" y2="90" /><line x1="70" y1="40" x2="50" y2="90" />
          <line x1="12" y1="40" x2="88" y2="40" />
        </g>
        {/* bright outline + table edge */}
        <polygon points="34,22 66,22 88,40 50,90 12,40" fill="none" stroke="#ffffff" strokeWidth="1.4" strokeLinejoin="round" />
        <line x1="34" y1="22" x2="66" y2="22" stroke="#ffffff" strokeWidth="1.1" />
        {/* specular highlight */}
        <polygon points="37,24 49,24 45,38 33,38" fill="#ffffff" opacity="0.45" />
        {/* scintillation */}
        <circle cx="40" cy="33" r="1.8" fill="#fff" style={{ transformBox: "fill-box", transformOrigin: "center", animation: "gemTwinkle 2s ease-in-out infinite" }} />
        <circle cx="58" cy="55" r="1.5" fill="#fff" style={{ transformBox: "fill-box", transformOrigin: "center", animation: "gemTwinkle 2.4s ease-in-out .8s infinite" }} />
      </svg>
    </span>
  );
}
