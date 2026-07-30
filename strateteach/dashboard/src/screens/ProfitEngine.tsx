import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, LayoutGrid, Play, Check, X, Trash2, ArrowUpRight, ArrowUp, ArrowDown, ChevronDown, ChevronRight, ChevronUp, DownloadCloud, TrendingUp, Info, Repeat, KeyRound, ShieldCheck } from "lucide-react";
import { api, isAdmin, isOwner, loadExchangeCreds } from "../app/api";
import { strategyLabel, isStrategyVisible } from "../lib/builtinBots";
import { useI18n } from "../i18n";
import ExchangeErrorText from "../components/ExchangeError";
import { mapExchangeError } from "../lib/exchangeErrors";
import { C, MONO, tierInfo } from "../theme";
import { downloadCsv } from "../lib/export";
import { SimBadge, RiskDisclaimer } from "../ui";
import ConfirmModal from "../components/ConfirmModal";
import { usePinGate, SetPinModal } from "../components/PinModal";
import ClosedPositionsLog from "../components/ClosedPositionsLog";

const STRATS = [{ k: "bot8c", l: "BOT(8C)-770" }, { k: "bot4", l: "BOT4-770" }, { k: "bot1", l: "BOT1-770" }];
const TIERS = ["breaking_out", "near_breakout", "in_uptrend", "building"];
const BUCKETS: { k: string; he: string; en: string }[] = [
  { k: "crypto", he: "קריפטו", en: "Crypto" },
  { k: "stocks", he: "מניות", en: "Stocks" },
  { k: "metals", he: "מתכות", en: "Metals" },
  { k: "commodities", he: "סחורות", en: "Commodities" },
];

const L = {
  he: {
    newSession: "מפגש חדש", dashboard: "מצב", cfgTitle: "מפגש דמו חדש",
    cfgSub: "מפגש = הפעלת המנוע ליום אחד על הסיגנלים של היום; כל פקודה דורשת אישור שלכם, ואתם סוגרים מתי שתרצו. מתאמנים עם כסף וירטואלי — בלי בורסה, בלי סיכון. אפשר להריץ כמה במקביל.",
    capital: "הון וירטואלי (USDT)", target: "יעד רווח יומי (USDT)", pctMode: "רווח באחוז לכל פוזיציה",
    strategy: "אסטרטגיה", tiersLbl: "פתיחת פוזיציות מדורגות", positions: "כמה פוזיציות",
    note: "קנייה וירטואלית · מחירים חיים · קריפטו בזמן אמת, שווקים אחרים — מיטב המאמץ", scan: "סרוק את השוק", scanning: "סורק את השוק…",
    recTitle: "ההמלצות המובילות להיום", recSub: "בחרו לאילו להיכנס — המומלצות מסומנות מראש",
    back: "חזרה להגדרות", entering: "על מה נכנסים", selected: "נבחרו", perPos: "לכל פוזיציה",
    approve: "אישור ופתיחת מפגש", opening: "פותח…", long: "לונג", recommended: "מומלץ",
    totalPnl: "סה\"כ רווח/הפסד", totalInv: "סה\"כ הושקע", closeProfit: "סגור פוזיציות ברווח",
    inProfit: "פוזיציות ברווח", noSessions: "אין מפגשים פעילים — פתחו מפגש חדש",
    active: "פעיל", stopped: "הסתיים", runningFor: "רץ כבר", curValue: "שווי נוכחי", invested: "הושקע",
    pos: "פוזיציות", entry: "כניסה", now: "עכשיו", close: "סגור", csv: "ייצוא CSV",
    promote: "קדם ללייב", closeSession: "סגור מפגש", del: "מחק",
    promoteNote: "קידום ללייב פותח פקודות אמיתיות בבורסה. מטעמי בטיחות — את/ה מבצע/ת את הפקודות בעצמך במסך הבורסה. אלו הפוזיציות:",
    targetHit: "היעד הושג! להמשיך או לעצור?", keepGoing: "המשך", stop: "עצור וסגור",
    notReady: "הסריקה היומית עדיין רצה. לחצו + בכרטיס הסריקה למעלה והמתינו רגע, ואז נסו שוב.",
    stopLoss: "עצירת הפסד", slNote: "ב-% כל פוזיציה נסגרת כשהיא יורדת באחוז הזה מהכניסה; ב-$ הריצה כולה נסגרת כשההפסד מגיע לסכום.",
    cleanClosed: "נקה ריצות שהסתיימו", info: "פרטים", positionsTab: "פוזיציות", activity: "פעילות (יומן)",
  },
  en: {
    newSession: "New session", dashboard: "Dashboard", cfgTitle: "New demo session",
    cfgSub: "A session = running the engine for one day on today's signals; every order needs your approval, and you close it whenever you want. Practice with virtual money — no exchange, no risk. Run several in parallel.",
    capital: "Virtual capital (USDT)", target: "Daily profit target (USDT)", pctMode: "% profit per position",
    strategy: "Strategy", tiersLbl: "Tiered position opening", positions: "How many positions",
    note: "Virtual buy · live prices · crypto is realtime, other markets best-effort", scan: "Scan the market", scanning: "Scanning the market…",
    recTitle: "Today's top recommendations", recSub: "Pick which to enter — recommended are pre-selected",
    back: "Back to settings", entering: "What we're entering", selected: "selected", perPos: "per position",
    approve: "Approve & open session", opening: "Opening…", long: "long", recommended: "recommended",
    totalPnl: "Total P&L", totalInv: "Total invested", closeProfit: "Close profitable",
    inProfit: "in profit", noSessions: "No active sessions — open a new one",
    active: "active", stopped: "finished", runningFor: "running for", curValue: "Current value", invested: "Invested",
    pos: "Positions", entry: "Entry", now: "Now", close: "Close", csv: "Export CSV",
    promote: "Promote to live", closeSession: "Close session", del: "Delete",
    promoteNote: "Promoting to live places real orders on your exchange. For safety you place the orders yourself on the Exchange screen. These are the positions:",
    targetHit: "Target reached! Keep going or stop?", keepGoing: "Keep going", stop: "Stop & close",
    notReady: "The daily scan is still running. Tap + on the scan card above, wait a moment, then try again.",
    stopLoss: "Stop-loss", slNote: "In %, each position closes when it drops that % from its entry; in $, the whole run closes when the loss hits the amount.",
    cleanClosed: "Clean closed runs", info: "Info", positionsTab: "Positions", activity: "Activity (calendar)",
  },
};

function fmtDur(sec: number, lang: string): string {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
const money = (v: any) => `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const signed = (v: any) => `${Number(v) >= 0 ? "+" : ""}${Number(v || 0).toFixed(2)}`;

export default function ProfitEngine({ live = false }: { live?: boolean } = {}) {
  const { lang, rtl } = useI18n();
  const t = L[lang];
  const he = lang === "he";
  const qc = useQueryClient();
  // Same admin flag used app-wide: regular users see only strategy 1 & 8.
  const admin = isAdmin();
  const visStrats = STRATS.filter((s) => isStrategyVisible(s.k, isOwner()));
  const [tab, setTab] = useState<"new" | "dashboard">("dashboard");
  const [newOpen, setNewOpen] = useState(false);
  const [cap, setCap] = useState(1000);
  const [target, setTarget] = useState(50);
  const [pctMode, setPctMode] = useState(false);
  const [strat, setStrat] = useState("bot8c");
  const [buckets, setBuckets] = useState<string[]>(["crypto"]);
  const [tiers, setTiers] = useState<string[]>(["breaking_out", "near_breakout"]);
  const [maxPos, setMaxPos] = useState(5);
  const [cands, setCands] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [promote, setPromote] = useState<number | null>(null);
  const nav = useNavigate();
  // Hand a demo position to the Exchange order ticket (user reviews & places it).
  // pct = the slice of free USDT this position should buy (the live promote panel
  // passes each selected position its reconciled allocation as a %); defaults to 100.
  const placeOnExchange = (sym: string, pct?: number, slOverride?: number, tpOverride?: number) => {
    const symbol = String(sym).includes("/") ? String(sym) : `${sym}/USDT`;
    const p = pct != null && pct > 0 ? Math.max(1, Math.min(100, Math.round(pct))) : 100;
    // Carry the run's ARMED stop-loss AND take-profit % into the live order ticket, so a promoted
    // BUY places a native exchange OCO (take-profit above the fill + stop below). Overrides come
    // from the promoted session's own settings; otherwise fall back to the form values. The user
    // still reviews & places it (PIN-gated) — nothing here executes an order or flips a gate.
    const slPct = slOverride != null ? slOverride : (slOn && slMode === "pct" && Number(slVal) > 0 ? Number(slVal) : 0);
    const tpPct = tpOverride != null ? tpOverride : (tpOn && Number(tpVal) > 0 ? Number(tpVal) : 0);
    localStorage.setItem("algo770_order_prefill", JSON.stringify({ symbol, side: "buy", pct: p, slPct, tpPct }));
    nav("/exchange");
  };
  const promotedRef = React.useRef<Set<number>>(new Set()); // ping admin once per run when promote opens
  // Protective orders default ON (Dan: ALWAYS a stop-loss on live, and the same for take-profit;
  // both user-configurable, each individually toggleable). On LIVE these become a native exchange
  // OCO placed with the buy (stop −slVal% below + take-profit +tpVal% above); on DEMO the stop
  // drives the paper per-position stop. Defaults: stop 2%, take-profit 5%.
  const [slOn, setSlOn] = useState(true);
  const [slMode, setSlMode] = useState<"amount" | "pct">("pct");
  const [slVal, setSlVal] = useState(2);
  const [tpOn, setTpOn] = useState(true);
  const [tpVal, setTpVal] = useState(5);
  const [showCal, setShowCal] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showAuto, setShowAuto] = useState(false);
  const [autoListOpen, setAutoListOpen] = useState(false); // active auto-runs list: closed by default, expand on click
  const [runsOpen, setRunsOpen] = useState(false); // all-runs scroll: closed by default, expand on click
  const [infoOpen, setInfoOpen] = useState<number | null>(null);
  const [posOpen, setPosOpen] = useState<number | null>(null);
  // ── LIVE session firing (real money) — REUSES the existing PIN-gated placeOrder
  // path in a loop; NO new backend, nothing invented. Approve → branded batch
  // confirmation (every order + total + real-money warning) → ONE PIN → fire. ──────
  const [confirm, setConfirm] = useState<Omit<React.ComponentProps<typeof ConfirmModal>, "onClose"> | null>(null);
  const [liveResults, setLiveResults] = useState<{ symbol: string; ok: boolean; msg: string; stop?: any }[]>([]);
  // Read in BOTH modes so the discoverable PIN-status chip can show set/not-set even in
  // demo (users can set the live PIN ahead of time). pinSet drives the batch PIN gate.
  const exCfgQ = useQuery({ queryKey: ["exchangeConfig"], queryFn: () => api.exchangeConfig() });
  const pinSet = !!(exCfgQ.data as any)?.pinSet;
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  // Branded PIN entry (replaces window.prompt). Promise-based: requestPin() opens the
  // app-styled modal and resolves with the PIN (or null on cancel). Same setPin→placeOrder
  // logic after — only the PIN UI changes.
  const { pinModal, requestPin } = usePinGate();

  // The Profit screen's "New run" button (and the home orb) ask us to open the
  // new-session form even if we're already in demo mode / on the dashboard tab.
  const prefillRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const openNew = () => { setNewOpen(true); setCands(null); setErr(""); };
    const openDash = () => { setTab("dashboard"); setShowCal(true); setTimeout(() => { try { document.getElementById("pe-activity")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_e) { /* */ } }, 80); };
    const openAuto = () => setShowAuto(true);
    window.addEventListener("algo770-new-run", openNew);
    window.addEventListener("algo770-open-dashboard", openDash);
    window.addEventListener("algo770-open-autorun", openAuto);
    // Came from a Scanner row tap? open the new-session form, scan, and pre-select that symbol.
    let pf: string | null = null;
    try { pf = sessionStorage.getItem("algo770_pe_prefill"); if (pf) sessionStorage.removeItem("algo770_pe_prefill"); } catch (_e) { /* */ }
    if (pf) { prefillRef.current = pf; setNewOpen(true); setCands(null); setTimeout(() => previewM.mutate(), 60); }
    return () => { window.removeEventListener("algo770-new-run", openNew); window.removeEventListener("algo770-open-dashboard", openDash); window.removeEventListener("algo770-open-autorun", openAuto); };
  }, []); // eslint-disable-line

  const sessionsQ = useQuery({ queryKey: ["paperSessions"], queryFn: () => api.paperSessions(), refetchInterval: 18000 });
  // Real sub-account balance, so a new run can be sized off actual funds (not a
  // made-up virtual number) when the exchange is connected.
  const exCreds = loadExchangeCreds();
  const exConnected = !!(exCreds && exCreds.key && exCreds.secret);
  const exLive = exCreds?.env === "live";
  const balQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: exConnected, retry: false, refetchInterval: 30000 });
  const availUsdt: number | null = (() => {
    const u = (((balQ.data as any)?.balances) || []).find((b: any) => String(b.asset || "").toUpperCase() === "USDT");
    return u ? Number(u.free) : null;
  })();
  // LIVE: size the new session off the ACTUAL available balance the first time the form
  // opens (reuses the "Use available" value), so the batch isn't pre-set to the demo
  // default (1000) that the account can't cover → a guaranteed all-fail. Once armed per
  // open, we don't override the user's own edits. Demo is untouched.
  const liveCapInit = React.useRef(false);
  React.useEffect(() => {
    if (!newOpen) { liveCapInit.current = false; return; }
    if (live && !liveCapInit.current && availUsdt != null && availUsdt > 0) {
      liveCapInit.current = true;
      setCap(Math.max(1, Math.floor(availUsdt)));
    }
  }, [live, newOpen, availUsdt]);
  const autorunQ = useQuery({ queryKey: ["autorun"], queryFn: () => api.paperAutorunGet(), refetchInterval: 20000 });
  const autoCfg: any = (autorunQ.data as any)?.config || {};
  const savedStratsQ = useQuery({ queryKey: ["savedStrategies"], queryFn: () => api.savedStrategies() });
  const savedStrats = (savedStratsQ.data || []) as any[];
  // Newest session first — a freshly opened run shows at the top, not the bottom.
  const sessions: any[] = [...(((sessionsQ.data as any)?.sessions) || [])].sort((a, b) => Number(b?.id ?? 0) - Number(a?.id ?? 0));
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const flash = (msg: string, kind: "ok" | "err" = "ok") => { setToast({ msg, kind }); setTimeout(() => setToast((cur) => (cur && cur.msg === msg ? null : cur)), 2600); };
  const fail = (e: any) => { const m = e?.message || String(e); setErr(m); flash(m, "err"); };
  const inv = () => qc.invalidateQueries({ queryKey: ["paperSessions"] });

  const previewM = useMutation({
    mutationFn: () => api.paperPreview({ tiers, maxPositions: maxPos, strategy: strat, buckets: buckets.length ? buckets : ["crypto"] }),
    onSuccess: (d: any) => {
      const c = d.candidates || [];
      if (d.notReady || c.length === 0) { setErr(t.notReady); setCands(null); return; }
      setErr(""); setCands(c);
      const chosen = new Set<string>(c.filter((x: any) => x.recommended).map((x: any) => x.symbol));
      const pf = prefillRef.current; prefillRef.current = null;
      if (pf && c.some((x: any) => x.symbol === pf)) chosen.add(pf);
      setSel(chosen);
    },
    onError: fail,
  });
  const startM = useMutation({
    mutationFn: () => api.paperStart({ capital: Number(cap) || 1000, dailyTarget: pctMode ? 0 : (Number(target) || 0), takeProfitEnabled: pctMode, takeProfitPct: pctMode ? (Number(target) || 5) : 5, tiers, maxPositions: maxPos, symbols: Array.from(sel), strategy: strat, buckets: buckets.length ? buckets : ["crypto"], stopLossEnabled: slOn, stopLossMode: slMode, stopLossValue: Number(slVal) || 0 }),
    onSuccess: () => { setErr(""); setCands(null); setSel(new Set()); setNewOpen(false); setTab("dashboard"); inv(); flash(lang === "he" ? "הריצה פעילה ✓" : "Your run is on ✓"); },
    onError: fail,
  });
  const closePosM = useMutation({ mutationFn: (v: { s: number; id: number }) => api.paperClose(v.s, v.id), onSuccess: () => { inv(); flash(lang === "he" ? "הפוזיציה נסגרה ✓" : "Position closed ✓"); }, onError: fail });
  const closeProfitM = useMutation({ mutationFn: (s: number) => api.paperCloseProfitable(s), onSuccess: () => { inv(); flash(lang === "he" ? "רווחים נסגרו ✓" : "Profits closed ✓"); }, onError: fail });
  const closeSessM = useMutation({ mutationFn: (s: number) => api.paperClose(s), onSuccess: () => { inv(); flash(lang === "he" ? "הריצה נסגרה ✓" : "Run closed ✓"); }, onError: fail });
  const delM = useMutation({ mutationFn: (s: number) => api.paperDelete(s), onSuccess: () => { inv(); flash(lang === "he" ? "נמחק ✓" : "Deleted ✓"); }, onError: fail });
  const decM = useMutation({ mutationFn: (v: { s: number; a: "stop" | "continue" }) => api.paperDecision(v.s, v.a), onSuccess: () => { inv(); flash(lang === "he" ? "בוצע ✓" : "Done ✓"); }, onError: fail });
  const cleanM = useMutation({ mutationFn: () => api.paperDeleteClosed(), onSuccess: (d: any) => { inv(); flash(`${lang === "he" ? "נוקה" : "Cleaned"} ${d.deleted} ✓`); }, onError: fail });

  // ── Top-dashboard live controls ─────────────────────────────────────────
  const closeAllProfitM = useMutation({ mutationFn: () => api.paperCloseProfitableAll(), onSuccess: (d: any) => { inv(); flash((lang === "he" ? "רווחים נסגרו" : "Profits closed") + ` (${d?.closedCount ?? 0}) ✓`); }, onError: fail });
  const closeAllActiveM = useMutation({ mutationFn: () => api.paperCloseAllActive(), onSuccess: (d: any) => { inv(); flash((lang === "he" ? "כל הפוזיציות נסגרו" : "All positions closed") + ` (${d?.closedCount ?? 0}) ✓`); }, onError: fail });
  // Reopen = start a fresh run reusing the current engine config, always asking
  // for the capital first (live + demo), per the agreed behaviour.
  const reopenM = useMutation({ mutationFn: (capital: number) => api.paperStart({ capital, dailyTarget: pctMode ? 0 : (Number(target) || 0), takeProfitEnabled: pctMode, takeProfitPct: pctMode ? (Number(target) || 5) : 5, tiers, maxPositions: maxPos, symbols: Array.from(sel), strategy: strat, buckets: buckets.length ? buckets : ["crypto"], stopLossEnabled: slOn, stopLossMode: slMode, stopLossValue: Number(slVal) || 0 }), onSuccess: () => { inv(); flash(lang === "he" ? "ריצה חדשה נפתחה ✓" : "New run opened ✓"); }, onError: fail });
  const onReopen = () => {
    const v = window.prompt(lang === "he" ? "סכום הון לריצה החדשה ($)" : "Capital for the new run ($)", String(Number(cap) || 1000));
    if (v == null) return;
    const n = Number(v);
    if (n > 0) reopenM.mutate(n); else flash(lang === "he" ? "סכום לא תקין" : "Invalid amount");
  };
  const ctlBtn = (color: string, on: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 6, background: color, color: "#0B0613", border: "none", borderRadius: 9, padding: "8px 13px", fontSize: 12.5, fontWeight: 800, cursor: on ? "pointer" : "not-allowed", opacity: on ? 1 : 0.45, fontFamily: "inherit" });
  // Smart delete: if the run has open positions, offer to close them first.
  const onDelete = (s: any) => {
    const open = (s.positions || []).filter((p: any) => p.status === "open").length;
    if (open > 0) {
      if (window.confirm(lang === "he" ? `לריצה יש ${open} פוזיציות פתוחות. לסגור אותן ולמחוק?` : `This run has ${open} open position(s). Close them and delete?`)) {
        closeSessM.mutate(s.id, { onSuccess: () => { inv(); delM.mutate(s.id); } });
      }
      return;
    }
    if (window.confirm(lang === "he" ? "למחוק את הריצה?" : "Delete this run?")) delM.mutate(s.id);
  };

  const running = sessions.filter((s) => s.status === "running");
  const activeAuto = running.filter((s: any) => String(s.label || "").startsWith("Auto ")).length;
  const totalPnl = sessions.reduce((a, s) => a + Number(s.totalPnl || 0), 0);
  const totalInv = sessions.reduce((a, s) => a + Number(s.capital || 0), 0);
  const totalPnlPct = totalInv > 0 ? (totalPnl / totalInv) * 100 : 0;
  const inProfit = running.reduce((a, s) => a + (s.positions || []).filter((p: any) => p.status === "open" && Number(p.pnl) > 0).length, 0);

  const toggleTier = (x: string) => setTiers((p) => p.includes(x) ? p.filter((y) => y !== x) : [...p, x]);
  const toggleBucket = (x: string) => setBuckets((p) => p.includes(x) ? (p.length > 1 ? p.filter((y) => y !== x) : p) : [...p, x]);
  const toggleSel = (s: string) => setSel((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const perPos = sel.size > 0 ? (Number(cap) || 0) / sel.size : 0;

  // Fire the selected recommendations as REAL spot buys — even-split capital, loop the
  // EXISTING PIN-gated placeOrder (the exact call the live board's `runOrders` uses),
  // continue on partial failure, break early if out of cash, collect per-order results.
  const fireLiveBatch = async (symbols: string[], per: number) => {
    // ALWAYS-ON protection (Dan): each live buy carries a stop-loss % AND a take-profit % so
    // place_order attaches a native exchange OCO. Live stop is always PERCENT (the $ mode is a
    // demo-only whole-run concept). Each leg is 0 only if the user toggled it off for this run.
    const slp = slOn && Number(slVal) > 0 ? Number(slVal) : 0;
    const tpp = tpOn && Number(tpVal) > 0 ? Number(tpVal) : 0;
    const results: { symbol: string; ok: boolean; msg: string; stop?: any }[] = [];
    for (const s of symbols) {
      const symbol = String(s).includes("/") ? String(s) : `${s}/USDT`;
      try {
        const r: any = await api.placeOrder({ symbol, side: "buy", orderType: "market", market: "spot", leverage: 1, quoteAmount: per, stopLossPct: slp, takeProfitPct: tpp });
        const ok = r?.ok !== false;
        // Keep the exchange's REAL reason (below-min-notional / unknown symbol /
        // insufficient funds) so the per-order results are actionable, not blank.
        // r.stopOrder carries the native OCO/stop outcome (ids, prices, or a rejection).
        results.push({ symbol, ok, msg: r?.message || (ok ? "" : (he ? "הפקודה נדחתה" : "order rejected")), stop: r?.stopOrder ?? null });
        if (!ok && /free|insufficient|balance|margin/i.test(r?.message || "")) break; // out of cash — stop
      } catch (e: any) { results.push({ symbol, ok: false, msg: e?.message || String(e) }); }
    }
    setLiveResults((prev) => { const m = new Map(prev.map((r) => [r.symbol, r])); results.forEach((r) => m.set(r.symbol, r)); return Array.from(m.values()); });
    ["livePnl", "exBalanceOv", "exPositionsOv", "tkPrices", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    // NOTE: never throw here — the caller always needs the per-order results to render.
    return { okN: results.filter((r) => r.ok).length, results };
  };
  // Most spot exchanges reject an order below ~$5 notional; the backend also caps each
  // BUY to free USDT, so ordering above the balance guarantees an all-fail. We pre-flight
  // both so the user gets a precise reason instead of a batch that silently all-fails.
  const MIN_PER_ORDER = 5;
  // LIVE "Approve & open session": pre-flight → batch confirmation → ONE PIN → fire.
  // Capital is split equally across the chosen symbols.
  const openLiveApprove = () => {
    if (!loadExchangeCreds()) { setErr(he ? "חברו בורסה תחילה" : "Connect an exchange first"); return; }
    const chosen = Array.from(sel);
    if (chosen.length === 0) return;
    const per = Math.round(((Number(cap) || 0) / chosen.length) * 100) / 100;
    if (!(per > 0)) { setErr(he ? "סכום הון לא תקין" : "Invalid capital amount"); return; }
    const total = Math.round(per * chosen.length * 100) / 100;
    // Pre-flight #1 — balance: the backend caps each buy to free USDT, so a total above
    // the available balance can never all-succeed. Block with the exact figures.
    const avail = availUsdt;
    if (avail != null && total > avail + 0.005) {
      setErr(he
        ? `היתרה הפנויה (${money(avail)}) נמוכה מהסכום הנדרש (${money(total)}). הקטן/י את ההון, צמצם/י פוזיציות, או הפקד/י לבורסה.`
        : `Available balance (${money(avail)}) is below the ${money(total)} needed. Lower the capital, reduce positions, or top up your exchange.`);
      return;
    }
    // Pre-flight #2 — per-order minimum: below ~$5 the exchange rejects each order.
    if (per < MIN_PER_ORDER) {
      setErr(he
        ? `סכום לכל פוזיציה (${money(per)}) נמוך ממינימום הבורסה (~$${MIN_PER_ORDER}). צמצם/י פוזיציות או הגדל/י את ההון${avail != null ? ` (פנוי: ${money(avail)})` : ""}.`
        : `Per-position amount (${money(per)}) is below the exchange minimum (~$${MIN_PER_ORDER}). Reduce positions or raise the capital${avail != null ? ` (available: ${money(avail)})` : ""}.`);
      return;
    }
    // Protection that will be placed on the exchange with each buy (native OCO).
    const slp = slOn && Number(slVal) > 0 ? Number(slVal) : 0;
    const tpp = tpOn && Number(tpVal) > 0 ? Number(tpVal) : 0;
    const protVal = (slp || tpp)
      ? `${slp ? `−${slp}%` : (he ? "ללא" : "none")} / ${tpp ? `+${tpp}%` : (he ? "ללא" : "none")}`
      : (he ? "⚠️ ללא הגנה" : "⚠️ none");
    const protSentence = (slp || tpp)
      ? (he ? ` לכל קנייה תתווסף פקודת OCO אמיתית בבורסה: סטופ ${slp ? `${slp}%-` : "—"} וטייק-פרופיט ${tpp ? `+${tpp}%` : "—"}.`
            : ` Each buy also places a native exchange OCO: ${slp ? `−${slp}% stop` : "no stop"}${tpp ? ` + ${tpp}% take-profit` : ""}.`)
      : (he ? " ⚠️ ללא סטופ/טייק — הפוזיציות לא יהיו מוגנות בבורסה." : " ⚠️ No stop / take-profit — positions will NOT be protected on the exchange.");
    setConfirm({
      title: he ? "פתיחת מפגש לייב — כסף אמיתי" : "Open live session — real money",
      intro: (he ? `פתיחת ${chosen.length} פקודות קנייה אמיתיות בבורסה המחוברת, חלוקה שווה של ההון.` : `Opens ${chosen.length} real BUY orders on your connected exchange, capital split equally.`) + protSentence,
      rows: [
        ...chosen.map((s) => ({ label: String(s).split("/")[0], value: `${he ? "קנייה" : "Buy"} · ${money(per)}` })),
        { label: he ? "הגנה (OCO): סטופ / טייק" : "Protection (OCO): stop / take-profit", value: protVal, color: (slp || tpp) ? C.gain : C.loss },
        { label: he ? "סה\"כ (כסף אמיתי)" : "Total (real money)", value: money(total), color: C.gold },
      ],
      risk: (he ? "כסף אמיתי — לא ניתן לבטל. סימבולים שאינם נתמכים בבורסה, או מתחת למינימום, יסומנו כנכשלו (עם הסיבה)." : "Real money — cannot be undone. Symbols your exchange can't trade, or below its minimum, are reported as failed with the reason — not placed.") + (exLive ? "" : (he ? " · חשבון טסטנט." : " · Testnet account.")),
      confirmLabel: he ? `פתח ${chosen.length} פקודות` : `Open ${chosen.length} orders`,
      tone: "gain",
      onConfirm: async () => {
        // ONE PIN for the whole batch (only when a PIN is configured). Branded modal now,
        // not window.prompt. Cancel = abort, nothing fires. setPin persists in the client,
        // so every order carries it.
        if ((exCfgQ.data as any)?.pinSet) {
          const pin = await requestPin({
            title: he ? "הזן קוד אישור לפקודות לייב" : "Enter your live PIN",
            intro: he ? `הקוד מאבטח פתיחת ${chosen.length} פקודות אמיתיות (${money(total)}) בבורסה המחוברת.` : `Your PIN authorises ${chosen.length} real orders (${money(total)}) on your connected exchange.`,
            confirmLabel: he ? "אשר ופתח" : "Confirm & open",
          });
          if (!pin) throw new Error(he ? "נדרש PIN — לא בוצעה אף פקודה" : "PIN required — nothing was placed");
          api.setPin(pin);
        }
        const { okN, results } = await fireLiveBatch(chosen, per);
        // ALWAYS land on the dashboard so the per-order ✓/✗ + real reasons render —
        // whether some, all, or none were placed.
        setNewOpen(false); setCands(null); setSel(new Set()); setTab("dashboard");
        if (okN === 0) {
          // Surface the actual exchange reasons (deduped) in the banner, and throw so the
          // modal honestly shows "not completed · funds unchanged" (which is true).
          const reasons = Array.from(new Set(results.map((r) => r.msg).filter(Boolean).map((m) => mapExchangeError(m, he).friendly))).slice(0, 2).join(" · ");
          setErr((he ? `לא בוצעה אף פקודה (0/${chosen.length}). ` : `No orders placed (0/${chosen.length}). `) + (reasons || (he ? "ראו סיבות מפורטות בתוצאות למטה." : "See the per-order reasons below.")));
          throw new Error(he ? "לא בוצעה אף פקודה" : "No orders were placed");
        }
        flash(okN < chosen.length
          ? (he ? `בוצעו ${okN}/${chosen.length} — ראו תוצאות` : `Placed ${okN}/${chosen.length} — see results`)
          : (he ? "המפגש נפתח — הפוזיציות בלייב ✓" : "Session opened — positions are live ✓"));
      },
    });
  };

  const exportPositions = (s: any) => {
    const rows = (s.positions || []).map((p: any) => [p.symbol, p.status, p.entryPrice, p.currentPrice, p.pnl, p.pnlPct]);
    downloadCsv(`session_${s.id}`, ["Symbol", "Status", "Entry", "Now", "PnL", "PnL%"], rows);
  };

  return (
    <div>
      {/* action toast — confirms every action so the user knows it worked */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 9999,
          background: toast.kind === "ok" ? C.gain : C.loss, color: toast.kind === "ok" ? "#04221a" : "#fff",
          borderRadius: 999, padding: "10px 18px", fontSize: 13.5, fontWeight: 800, boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
          display: "inline-flex", alignItems: "center", gap: 8, maxWidth: "90vw" }}>
          {toast.kind === "ok" ? <Check size={15} /> : null} {toast.msg}
        </div>
      )}
      {/* Real-money confirm gate for the LIVE session (portals to body). */}
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {/* Branded PIN entry — renders above the ConfirmModal while the PIN is typed. */}
      {pinModal}
      {/* Branded create/change flow for the live PIN (discoverable from the chip below). */}
      {pinSetupOpen && <SetPinModal pinSet={pinSet} onClose={() => setPinSetupOpen(false)} />}

      {/* Header banner: DEMO trades virtual money (sim badge + risk note); LIVE is an
          unmistakable real-money warning. The engine flow below is otherwise identical. */}
      {live ? (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12,
          background: `${C.loss}12`, border: `1px solid ${C.loss}66`, borderRadius: 10, padding: "9px 12px", color: C.text, fontSize: 12.5, fontWeight: 700 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.loss }} />
            {he ? "מנוע לייב · כסף אמיתי — כל מפגש נפתח רק לאחר אישור פקודות ו-PIN." : "Live engine · real money — every session opens only after you confirm the orders and enter your PIN."}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12,
          background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 11px" }}>
          <SimBadge />
          <RiskDisclaimer style={{ flex: 1, minWidth: 180 }} />
        </div>
      )}

      {/* Discoverable LIVE-PIN control — a status chip + one-line explanation. Tapping it
          opens the branded set/change-PIN flow. Shown in both modes (subtle) so the PIN can
          be set up ahead of going live; it's what you enter to confirm live trades. */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <button onClick={() => setPinSetupOpen(true)}
          title={he ? "הגדר או שנה את קוד האישור ללייב" : "Set up or change your live PIN"}
          className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "inherit",
            fontSize: 12.5, fontWeight: 800, borderRadius: 999, padding: "7px 13px",
            color: pinSet ? C.gain : C.gold,
            background: pinSet ? `${C.gain}12` : `${C.gold}14`,
            border: `1px solid ${pinSet ? `${C.gain}66` : C.gold}` }}>
          {pinSet ? <ShieldCheck size={14} /> : <KeyRound size={14} />}
          {pinSet
            ? (he ? "קוד אישור לייב: מוגדר ✓ · שנה" : "Live PIN: set ✓ · change")
            : (he ? "הגדר קוד אישור לייב" : "Set up live PIN")}
        </button>
        <span style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, flex: 1, minWidth: 180 }}>
          {he
            ? "קוד קצר שמאבטח פקודות בכסף אמיתי — מגדירים פעם אחת, ואז מזינים אותו כדי לאשר עסקאות לייב."
            : "A short code that secures real-money orders — set it once, then enter it to confirm live trades."}
        </span>
      </div>

      {/* New run opens a popup; Dashboard is the main view */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button onClick={() => { setNewOpen(true); setCands(null); setErr(""); }} data-tour="profit-newrun" className="gbtn" style={{ ...tabBtn(false) }}><Plus size={15} /> {live ? (he ? "מפגש לייב חדש" : "New live session") : t.newSession}</button>
        {/* Auto-run is a DEMO-only paper scheduler (no live equivalent without new backend). */}
        {!live && <button onClick={() => setShowAuto(true)} className="gbtn" style={{ ...tabBtn(false) }}><Repeat size={15} /> {lang === "he" ? "ריצה אוטומטית" : "Auto-run"}</button>}
        <button onClick={() => setTab("dashboard")} style={tabBtn(tab === "dashboard")}><LayoutGrid size={15} /> {t.dashboard} {!live && running.length > 0 && <span style={pill(C.gain)}>{running.length}</span>}</button>
        {/* Persistent access to the closed-positions log — reachable from ANYWHERE in the engine
            (live AND demo), per Dan. One shared component; opens inline right below. */}
        <button onClick={() => setShowLog((v) => !v)} title={he ? "יומן פוזיציות סגורות (דמו + לייב)" : "Closed positions log (demo + live)"} style={tabBtn(showLog)}>🧾 {he ? "יומן סגירות" : "Closed log"}</button>
      </div>

      {err && <div style={{ background: "rgba(240,97,109,0.12)", border: `1px solid ${C.loss}`, color: "#f3a3a3", borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 12, fontFamily: MONO }}>{err}</div>}

      {/* Closed-positions log — top-level so it opens from anywhere (live or demo). */}
      {showLog && <div style={{ marginBottom: 12 }}><ClosedPositionsLog onClose={() => setShowLog(false)} defaultSource="engine" /></div>}

      {newOpen && (
        <div onClick={() => setNewOpen(false)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={modalCard}>
            <button onClick={() => setNewOpen(false)} aria-label="close" style={modalX}><X size={16} /></button>
            <div style={modalBody}>
          {!cands ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800 }}><Play size={16} color={live ? C.loss : C.gold} /> {live ? (he ? "מפגש לייב חדש" : "New live session") : t.cfgTitle}</div>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 16 }}>{live ? (he ? "אותו מנוע כמו הדמו — סורק, ממליץ, ואתם בוחרים. ההבדל היחיד: לפני פתיחה תראו אישור רכישה מרוכז של כל הפקודות בכסף אמיתי, ותאשרו עם PIN." : "The same engine as demo — it scans, recommends, and you pick. The only difference: before opening you'll see one batch purchase-confirmation of every order in real money, approved with your PIN.") : t.cfgSub}</div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
                <div>
                  <Field label={live ? (he ? "הון (USDT אמיתי)" : "Capital (real USDT)") : t.capital}><input type="number" value={cap} onChange={(e) => setCap(e.target.value as any)} style={inp} /></Field>
                  {exConnected && (
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 7, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {lang === "he" ? "פנוי עכשיו" : "Available now"}{exLive ? " · LIVE" : ""}:
                      <b style={{ color: C.gain, fontFamily: MONO }}>{balQ.isLoading ? "…" : (availUsdt == null ? "—" : "$" + availUsdt.toLocaleString(undefined, { maximumFractionDigits: 2 }))}</b>
                      {availUsdt != null && availUsdt > 0 && (
                        <button type="button" onClick={() => setCap(Math.floor(availUsdt) as any)}
                          style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.gold, borderRadius: 7, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          {lang === "he" ? "השתמש בזמין" : "Use available"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <Field label={pctMode ? t.pctMode + " (%)" : t.target}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="number" value={target} onChange={(e) => setTarget(e.target.value as any)} style={inp} />
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>
                      <input type="checkbox" checked={pctMode} onChange={(e) => setPctMode(e.target.checked)} /> %
                    </label>
                  </div>
                </Field>
                <Field label={t.positions}><input type="number" min={1} max={20} value={maxPos} onChange={(e) => setMaxPos(Number(e.target.value))} style={inp} /></Field>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={lbl}>{lang === "he" ? "תחום סריקה" : "Scan domain"}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {BUCKETS.map((b) => <button key={b.k} onClick={() => toggleBucket(b.k)} style={chip(buckets.includes(b.k))}>{lang === "he" ? b.he : b.en}</button>)}
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={lbl}>{t.strategy}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {visStrats.map((s) => <button key={s.k} onClick={() => setStrat(s.k)} style={chip(strat === s.k)}>{strategyLabel(s.k, lang)}</button>)}
                  {savedStrats.map((s: any) => { const sid = s.config?.strategyId || s.strategyId || "bot8c"; return <button key={"sv" + s.id} onClick={() => setStrat(sid)} style={chip(false)} title={lang === "he" ? "אסטרטגיה שמורה" : "Saved strategy"}>★ {s.name && s.name !== "Strategy" ? s.name : `${strategyLabel(sid, lang)} #${s.id}`}</button>; })}
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={lbl}>{t.tiersLbl}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                  {TIERS.map((x) => { const ti = tierInfo(x); return <button key={x} onClick={() => toggleTier(x)} style={chip(tiers.includes(x))}>{(ti as any)[lang] || x}</button>; })}
                </div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>ⓘ {t.note}</div>
              </div>

              {/* Protective orders — stop-loss + take-profit. On LIVE these are placed on the
                  exchange as a native OCO with each buy; on DEMO the stop drives the paper stop.
                  The $ (whole-run) stop mode is demo-only; LIVE is always a % below entry. */}
              <div style={{ marginTop: 16 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: C.text, cursor: "pointer" }}>
                  <input type="checkbox" checked={slOn} onChange={(e) => setSlOn(e.target.checked)} /> {t.stopLoss}
                </label>
                {slOn && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    {!live && <button onClick={() => setSlMode("amount")} style={chip(slMode === "amount")}>$</button>}
                    {!live && <button onClick={() => setSlMode("pct")} style={chip(slMode === "pct")}>%</button>}
                    <input type="number" min={1} value={slVal} onChange={(e) => setSlVal(Number(e.target.value))} style={{ ...inp, width: 120 }} />
                    <span style={{ fontSize: 11, color: C.faint }}>{live ? (he ? "% מתחת לכניסה — סטופ אמיתי בבורסה" : "% below entry — real exchange stop") : t.slNote}</span>
                  </div>
                )}
              </div>

              {/* take-profit — LIVE only: the upper OCO leg (limit sell above entry). DEMO keeps its
                  own take-profit via the target %-mode, so this control is shown for live runs. */}
              {live && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: C.text, cursor: "pointer" }}>
                  <input type="checkbox" checked={tpOn} onChange={(e) => setTpOn(e.target.checked)} /> {he ? "טייק-פרופיט" : "Take-profit"}
                </label>
                {tpOn && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <input type="number" min={1} value={tpVal} onChange={(e) => setTpVal(Number(e.target.value))} style={{ ...inp, width: 120 }} />
                    <span style={{ fontSize: 11, color: C.faint }}>{he ? "% מעל הכניסה — מכירת רווח אמיתית בבורסה" : "% above entry — real exchange take-profit"}</span>
                  </div>
                )}
              </div>
              )}

              {live && (
                <div style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.5, color: (slOn || tpOn) ? C.gold : C.loss, background: (slOn || tpOn) ? `${C.gold}12` : `${C.loss}12`, border: `1px solid ${(slOn || tpOn) ? C.goldDim : `${C.loss}66`}`, borderRadius: 9, padding: "9px 12px" }}>
                  {(slOn || tpOn)
                    ? (he ? `בלייב: לכל קנייה תיפתח פקודת OCO אמיתית בבורסה — ${slOn ? `סטופ ${slVal}%-` : "ללא סטופ"}${tpOn ? ` וטייק-פרופיט +${tpVal}%` : ""}. תראו אישור עם הרמות לפני הביצוע, ותוצאה עם מזהי הפקודות אחרי.` : `Live: each buy places a real exchange OCO — ${slOn ? `−${slVal}% stop` : "no stop"}${tpOn ? ` + ${tpVal}% take-profit` : ""}. You'll see the exact levels before confirming, and the order IDs after.`)
                    : (he ? "⚠️ שני הרגליים כבויות — הפוזיציות ייפתחו ללא הגנה בבורסה. הפעילו סטופ/טייק, או הגדירו ידנית בבורסה." : "⚠️ Both legs are off — positions will open with NO exchange protection. Turn on a stop / take-profit, or set one on your exchange.")}
                </div>
              )}
              {/* Scan button lives in the always-visible modal FOOTER (below). */}
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800 }}>✦ {t.recTitle}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{t.recSub}</div>
                </div>
                <button onClick={() => setCands(null)} style={chip(false)}><ChevronRight size={13} /> {t.back}</button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {cands.map((c) => {
                  const ti = tierInfo(c.tier); const on = sel.has(c.symbol);
                  const fmtPct = (v: any) => typeof v === "number" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—";
                  return (
                    <div key={c.symbol} style={{ borderRadius: 12, border: `1px solid ${on ? C.gold : C.line}`, background: on ? "rgba(247,147,26,0.06)" : C.surface2, overflow: "hidden" }}>
                      <button onClick={() => toggleSel(c.symbol)} style={{ ...recRow, border: "none", background: "transparent", width: "100%" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${on ? C.gold : C.line}`, background: on ? "var(--btn-bg)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{on && <Check size={14} color="var(--btn-ink)" />}</span>
                          <span style={{ fontWeight: 800 }}>{c.symbol}</span>
                          {c.recommended && <span style={pill(C.gain)}>{t.recommended}</span>}
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: ti.c, border: `1px solid ${ti.c}55`, borderRadius: 6, padding: "1px 7px" }}>{(ti as any)[lang] || c.tier}</span>
                          <span style={{ fontFamily: MONO, fontSize: 13 }}>{money(c.currentPrice)}</span>
                        </span>
                      </button>
                      {/* breakout detail: started, yesterday, today, still-green */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", fontSize: 11, color: C.muted,
                        padding: "0 12px 9px 44px", direction: rtl ? "rtl" : "ltr" }}>
                        <span>{lang === "he" ? "החל" : "Started"}: <b style={{ color: C.text }}>{c.breakoutDate || "—"}</b></span>
                        <span>{lang === "he" ? "אתמול" : "Yesterday"}: <b style={{ color: (c.changeYesterdayPct ?? 0) >= 0 ? C.gain : C.loss, fontFamily: MONO }}>{fmtPct(c.changeYesterdayPct)}</b></span>
                        <span>{lang === "he" ? "היום" : "Today"}: <b style={{ color: (c.changeTodayPct ?? 0) >= 0 ? C.gain : C.loss, fontFamily: MONO }}>{fmtPct(c.changeTodayPct)}</b></span>
                        <span style={{ color: c.stillGreen ? C.gain : C.loss, fontWeight: 700 }}>{c.stillGreen ? (lang === "he" ? "🟢 עדיין ירוק" : "🟢 still green") : (lang === "he" ? "לא ירוק" : "not green")}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Live pre-flight errors (insufficient balance / below min order) render
                  here — the top-level err banner sits behind this modal. */}
              {live && err && (
                <div style={{ marginTop: 12, background: `${C.loss}12`, border: `1px solid ${C.loss}66`, color: C.text, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, lineHeight: 1.5 }}>{err}</div>
              )}
              {/* Selected summary + approve button live in the always-visible FOOTER (below). */}
            </>
          )}
            </div>
            {/* Sticky footer — the primary action is ALWAYS visible (never scrolls away). */}
            <div style={modalFooter}>
              {!cands ? (
                <button onClick={() => { setErr(""); previewM.mutate(); }} disabled={previewM.isPending} className="gbtn" style={{ ...bigBtn }}>
                  {previewM.isPending ? <><Loader2 size={16} className="spin" /> {t.scanning}</> : <><TrendingUp size={16} /> {t.scan}</>}
                </button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, width: "100%" }}>
                  <span style={{ fontSize: 13, color: C.muted }}><b style={{ color: C.text }}>{sel.size}</b> {t.selected} · ≈ {money(perPos)} {t.perPos}{live ? (he ? " · כסף אמיתי" : " · real money") : ""}</span>
                  <button onClick={() => { setErr(""); if (live) openLiveApprove(); else startM.mutate(); }} disabled={(live ? false : startM.isPending) || sel.size === 0} className={live ? "gbtn gbtn-gain" : "gbtn"} style={bigBtn}>
                    {(!live && startM.isPending) ? <><Loader2 size={16} className="spin" /> {t.opening}</> : <><Check size={16} /> {t.approve}</>}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LIVE dashboard = the last batch's per-order results. The live positions panel is
          NOT repeated here — it's the shared PositionsWidget at the TOP of the Trading Engine
          screen (with its existing confirm/PIN close), so it renders exactly once. The paper
          sessions list / activity calendar / auto-run below are DEMO-only, hidden in live. */}
      {tab === "dashboard" && live && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {liveResults.length > 0 && (
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>🧾 {he ? "תוצאות הפקודות" : "Order results"}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: C.muted }}>{liveResults.filter((r) => r.ok).length}/{liveResults.length} {he ? "בוצעו" : "placed"}</span>
              </div>
              {liveResults.map((r) => {
                // Protective-order status line (native exchange OCO) so Dan can SEE it worked —
                // and, crucially, see when a position is UNPROTECTED. IDs are shown for Binance
                // verification. st == null → no protection was requested for this buy.
                const st = r.stop;
                const ids = st?.orderIds?.length ? ` · #${st.orderIds.join(", #")}` : "";
                const prot = !r.ok || st == null ? null
                  : st.ok === false
                    ? { c: C.loss, txt: he ? "⚠ ההגנה נדחתה — הפוזיציה חשופה. הגדירו סטופ בבורסה." : "⚠ Protection REJECTED — position UNPROTECTED. Set a stop on your exchange." }
                    : st.type === "oco"
                      ? { c: C.gain, txt: (he ? `סטופ ${st.slPct}%- + טייק +${st.tpPct}% נקבעו בבורסה ✓` : `Stop −${st.slPct}% + take-profit +${st.tpPct}% placed ✓`) + ids }
                      : st.type === "stop_only"
                        ? { c: C.gold, txt: (he ? `סטופ ${st.slPct}% נקבע ✓ · טייק-פרופיט לא צורף` : `Stop −${st.slPct}% placed ✓ · take-profit NOT attached`) + ids }
                        : st.type === "tp_only"
                          ? { c: C.gold, txt: (he ? `טייק +${st.tpPct}% נקבע ✓ · ללא סטופ` : `Take-profit +${st.tpPct}% placed ✓ · no stop`) + ids }
                          : null;
                return (
                  <div key={r.symbol} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ color: r.ok ? C.gain : C.loss, fontWeight: 900, lineHeight: 1.4 }}>{r.ok ? "✓" : "✗"}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.4, whiteSpace: "nowrap" }}>{r.symbol}</span>
                    {/* A failed order shows clear, actionable guidance; a successful one keeps its
                        short note plus the protective-order status line below it. */}
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                      {r.ok
                        ? <span style={{ fontSize: 11.5, color: C.gain, fontFamily: MONO, lineHeight: 1.4, wordBreak: "break-word" }}>{r.msg}</span>
                        : <ExchangeErrorText raw={r.msg} color={C.loss} style={{ flex: 1 }} />}
                      {/* Money reassurance on a rejected buy — nothing was spent; the allocation
                          stays as USDT cash (visible in the portfolio's "Cash available" line). */}
                      {!r.ok && <span style={{ fontSize: 11, fontWeight: 700, color: C.gold, lineHeight: 1.4, wordBreak: "break-word" }}>{he ? "נדחתה — לא נוצלו כספים, ה-USDT שלך לא השתנה." : "Rejected — no funds used, your USDT is unchanged."}</span>}
                      {prot && <span style={{ fontSize: 11, fontWeight: 700, color: prot.c, lineHeight: 1.4, wordBreak: "break-word" }}>{prot.txt}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {/* Pointer to the single shared positions panel (above) so this view isn't bare. */}
          <div style={{ fontSize: 12, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>
            {he ? "פוזיציות הלייב הפתוחות מוצגות בפאנל שבראש המסך — שם גם סוגרים פוזיציה (עם אישור ו-PIN)." : "Your open live positions are shown in the panel at the top of this screen — that's also where you close a position (with confirm + PIN)."}
          </div>
          {/* Closed-log access right in the live context (also always on the tab row above). */}
          <button onClick={() => setShowLog((v) => !v)} style={{ ...chip(showLog), alignSelf: "start" }}>🧾 {he ? (showLog ? "סגור יומן סגירות" : "פתח יומן סגירות (דמו + לייב)") : (showLog ? "Close the log" : "Open closed log (demo + live)")}</button>
        </div>
      )}

      {tab === "dashboard" && !live && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {(autoCfg.enabled || activeAuto > 0) && (
            <div style={{ order: -2, background: "rgba(247,147,26,0.1)", border: `1px solid ${C.goldDim}`, borderRadius: 11, padding: "10px 13px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => setAutoListOpen((v) => !v)} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 800, color: C.gold, flexWrap: "wrap", padding: 0 }}>
                  {autoListOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Repeat size={15} /> {autoCfg.enabled ? (lang === "he" ? "ריצה אוטומטית פעילה" : "Auto-run is ON") : (lang === "he" ? "ריצות אוטומטיות" : "Auto-runs")}
                  <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
                    {autoCfg.enabled && (autoCfg.mode === "count" ? (lang === "he" ? `· נותרו ${autoCfg.count}` : `· ${autoCfg.count} left`) : (lang === "he" ? `· כל ${autoCfg.intervalMinutes} ד׳` : `· every ${autoCfg.intervalMinutes} min`))}
                    {` · ${activeAuto} ${lang === "he" ? "פעילות עכשיו" : "running now"}`}
                  </span>
                </button>
                <button onClick={() => setShowAuto(true)} style={{ ...chip(false), color: C.gold, borderColor: C.goldDim }}><Repeat size={13} /> {lang === "he" ? "הגדרות" : "Settings"}</button>
              </div>
              {autoListOpen && activeAuto > 0 && (
                <div style={{ marginTop: 10, maxHeight: "32svh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {running.filter((s: any) => String(s.label || "").startsWith("Auto ")).map((s: any) => (
                    <button key={s.id} onClick={() => { setPosOpen(posOpen === s.id ? null : s.id); setInfoOpen(null); }} title={lang === "he" ? "הצג פוזיציות" : "Show positions"}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 11px", cursor: "pointer", fontFamily: "inherit", textAlign: "start" }}>
                      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.strategyLabel || s.label}</span>
                        <span style={{ fontSize: 10.5, color: C.faint, fontFamily: MONO }}>#{s.id}</span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 10.5, color: C.muted, fontFamily: MONO }}>{money(s.capital)}</span>
                        <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: Number(s.totalPnl) >= 0 ? C.gain : C.loss }}>{signed(s.totalPnl)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* active stat buttons — press to open the activity calendar */}
          <div data-tour="profit-pnl" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <button onClick={() => { setShowCal(true); setTimeout(() => document.getElementById("pe-activity")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }} style={{ ...statBtn, flex: 1 }}>
              <span style={statLbl}>{t.totalPnl} ›</span>
              <span style={{ ...statVal, color: totalPnl >= 0 ? C.gain : C.loss }}>{signed(totalPnl)} <span style={{ fontSize: 12 }}>({totalPnlPct >= 0 ? "+" : ""}{totalPnlPct.toFixed(2)}%)</span></span>
            </button>
            <button onClick={() => { setShowCal(true); setTimeout(() => document.getElementById("pe-activity")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }} style={{ ...statBtn, flex: 1 }}>
              <span style={statLbl}>{t.totalInv} ›</span>
              <span style={statVal}>{money(totalInv)}</span>
            </button>
          </div>

          {/* top actions: activity calendar toggle + closed-positions log + clean closed runs */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => setShowCal((v) => !v)} style={chip(showCal)}>{showCal ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {t.activity}</button>
            {sessions.some((s) => s.status !== "running") && (
              <button onClick={() => { if (window.confirm(lang === "he" ? "לנקות את כל הריצות שהסתיימו?" : "Clean all closed runs?")) cleanM.mutate(); }} disabled={cleanM.isPending} style={{ ...chip(false), color: C.loss, borderColor: `${C.loss}66` }}><Trash2 size={13} /> {t.cleanClosed}</button>
            )}
          </div>

          <div id="pe-activity">
            <PeriodPnl lang={lang} />
            {showCal && <ActivityCalendar lang={lang} rtl={rtl} onClose={() => setShowCal(false)} />}
          </div>

          {/* Daily target bots — the automated hourly runs, each with its own P&L */}
          {(() => {
            const bots = sessions.filter((s: any) => typeof s.label === "string" && s.label.startsWith("Auto Run"));
            if (bots.length === 0) return null;
            const todayStr = new Date().toDateString();
            const inDay = bots.filter((b: any) => { try { return new Date(b.startedAt).toDateString() === todayStr; } catch (_e) { return true; } });
            const list = inDay.length ? inDay : bots;
            const total = list.reduce((a: number, b: any) => a + Number(b.totalPnl || 0), 0);
            const hit = list.filter((b: any) => Number(b.dailyTarget || 0) > 0 && Number(b.totalPnl || 0) >= Number(b.dailyTarget)).length;
            const avg = list.length ? total / list.length : 0;
            return (
              <div style={{ ...card, marginBottom: 12, padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>🤖 {lang === "he" ? "בוטים ליעד יומי" : "Daily target bots"} <span style={pill(C.blue)}>{list.length}</span></span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, color: total >= 0 ? C.gain : C.loss }}>{signed(total)}</span>
                </div>
                <div style={{ display: "flex", gap: 16, padding: "8px 12px", fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
                  <span>{lang === "he" ? "הגיעו ליעד" : "Hit target"}: <b style={{ color: C.text }}>{hit}/{list.length}</b></span>
                  <span>{lang === "he" ? "ממוצע לבוט" : "Avg/bot"}: <b style={{ color: avg >= 0 ? C.gain : C.loss }}>{signed(avg)}</b></span>
                </div>
                {list.map((b: any) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.line}` }}>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700, fontSize: 13 }}>{b.label}</span>
                    <span style={pill(b.status === "running" ? C.gain : C.faint)}>{b.status === "running" ? t.active : t.stopped}</span>
                    {Number(b.dailyTarget || 0) > 0 && Number(b.totalPnl || 0) >= Number(b.dailyTarget) && <span style={pill(C.gold)}>🎯</span>}
                    <span style={{ fontFamily: MONO, fontWeight: 800, color: Number(b.totalPnl) >= 0 ? C.gain : C.loss, whiteSpace: "nowrap" }}>{signed(b.totalPnl)}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          <div data-tour="profit-runs" style={{ order: -1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
            <button onClick={() => setRunsOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: C.text, fontSize: 13.5, fontWeight: 800, padding: 0, width: "100%", textAlign: "start" }}>
              {runsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {lang === "he" ? "כל הריצות" : "All runs"}
              <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>· {running.length} {lang === "he" ? "פעילות" : "running"} · {sessions.length} {lang === "he" ? "סה״כ" : "total"}</span>
            </button>
            {/* Live controls — always visible at the top of the dashboard. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              <button onClick={() => { if (running.length && window.confirm(lang === "he" ? "לסגור את כל הפוזיציות הרווחיות?" : "Close all in-profit positions?")) closeAllProfitM.mutate(); }}
                disabled={closeAllProfitM.isPending || running.length === 0} style={ctlBtn(C.gain, !closeAllProfitM.isPending && running.length > 0)}>
                {closeAllProfitM.isPending ? <Loader2 size={13} className="spin" /> : <ArrowUp size={13} />} {lang === "he" ? "סגור כל הרווח" : "Close all profit"}
              </button>
              <button onClick={() => { if (running.length && window.confirm(lang === "he" ? "לסגור את כל הפוזיציות הפעילות, כולל בהפסד?" : "Close ALL active positions, including losses?")) closeAllActiveM.mutate(); }}
                disabled={closeAllActiveM.isPending || running.length === 0} style={ctlBtn(C.loss, !closeAllActiveM.isPending && running.length > 0)}>
                {closeAllActiveM.isPending ? <Loader2 size={13} className="spin" /> : <ArrowDown size={13} />} {lang === "he" ? "סגור הכל" : "Close all active"}
              </button>
              <button onClick={onReopen} disabled={reopenM.isPending} style={ctlBtn(C.gold, !reopenM.isPending)}>
                {reopenM.isPending ? <Loader2 size={13} className="spin" /> : <Repeat size={13} />} {lang === "he" ? "פתח ריצה חדשה (הון)" : "Reopen (new capital)"}
              </button>
            </div>
            {runsOpen && (
              <div style={{ marginTop: 10, maxHeight: "62svh", overflowY: "auto" }}>
          {sessions.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: C.muted, fontSize: 13 }}>{sessionsQ.isLoading ? <Loader2 size={16} className="spin" /> : t.noSessions}</div>
          ) : sessions.map((s) => {
            const oInfo = infoOpen === s.id, oPos = posOpen === s.id;
            const win = (s.positions || []).filter((p: any) => p.status === "open" && Number(p.pnl) > 0).length;
            return (
              <div key={s.id} style={{ ...card, marginBottom: 10, padding: 0, overflow: "hidden" }}>
                {/* one tight row: name · status · P&L · info arrow · positions arrow */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                    {/* label shrinks + ellipsises so a long strategy name can never overrun the
                        status pill or the P&L figure (was missing minWidth:0 → text collided) */}
                    <span style={{ flex: "0 1 auto", minWidth: 0, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.strategyLabel || s.label}</span>
                    <span style={{ ...pill(s.status === "running" ? C.gain : C.faint), flexShrink: 0 }}>{s.status === "running" ? t.active : t.stopped}</span>
                  </span>
                  <span style={{ flexShrink: 0, fontFamily: MONO, fontWeight: 800, color: Number(s.totalPnl) >= 0 ? C.gain : C.loss, whiteSpace: "nowrap" }}>{signed(s.totalPnl)} <span style={{ fontSize: 11 }}>({Number(s.totalPnlPct) >= 0 ? "+" : ""}{Number(s.totalPnlPct || 0).toFixed(2)}%)</span></span>
                  <button onClick={() => { setInfoOpen(oInfo ? null : s.id); setPosOpen(null); }} title={t.info} style={arrowBtn(oInfo)}><Info size={14} /></button>
                  <button onClick={() => { setPosOpen(oPos ? null : s.id); setInfoOpen(null); }} title={t.positionsTab} style={arrowBtn(oPos)}>{oPos ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                </div>

                {/* pending target decision */}
                {s.pendingDecision && (
                  <div style={{ background: "rgba(247,147,26,0.1)", borderTop: `1px solid ${C.goldDim}`, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <span style={{ fontSize: 13, color: C.gold, fontWeight: 700 }}>🎯 {t.targetHit}</span>
                    <span style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => decM.mutate({ s: s.id, a: "continue" })} style={chip(false)}>{t.keepGoing}</button>
                      <button onClick={() => decM.mutate({ s: s.id, a: "stop" })} className="gbtn gbtn-loss" style={{ ...chip(true) }}>{t.stop}</button>
                    </span>
                  </div>
                )}

                {/* info (arrow 1): stats + actions */}
                {oInfo && (
                  <div style={{ borderTop: `1px solid ${C.line}`, padding: 12 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 8 }}>
                      <Mini label={t.runningFor} value={fmtDur(s.runtimeSeconds, lang)} />
                      <Mini label="%" value={`${Number(s.totalPnlPct || 0).toFixed(2)}%`} color={Number(s.totalPnlPct) >= 0 ? C.gain : C.loss} />
                      <Mini label={t.curValue} value={money(s.totalValue)} />
                      <Mini label={t.invested} value={money(s.capital)} />
                    </div>
                    <div style={{ fontSize: 11, color: C.faint, margin: "8px 0 12px" }}>{(s.assets || []).join(" · ")}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => exportPositions(s)} style={chip(false)}><DownloadCloud size={13} /> {t.csv}</button>
                      <button onClick={() => closeProfitM.mutate(s.id)} disabled={closeProfitM.isPending} style={{ ...chip(false), color: C.gain, borderColor: `${C.gain}66` }}><TrendingUp size={13} /> {t.closeProfit} {win > 0 ? `(${win})` : ""}</button>
                      <button onClick={() => { const opening = promote !== s.id; setPromote(opening ? s.id : null); if (opening && !promotedRef.current.has(s.id)) { promotedRef.current.add(s.id); api.paperPromoteIntent(s.id).catch(() => {}); } }} style={{ ...chip(false), color: C.gold, borderColor: C.goldDim }}><ArrowUpRight size={13} /> {t.promote}</button>
                      {s.status === "running" && <button onClick={() => closeSessM.mutate(s.id)} disabled={closeSessM.isPending} style={{ ...chip(false), color: C.loss, borderColor: `${C.loss}66` }}><X size={13} /> {t.closeSession}</button>}
                      <button onClick={() => onDelete(s)} disabled={delM.isPending || closeSessM.isPending} style={{ ...chip(false), color: C.loss, borderColor: `${C.loss}66` }}><Trash2 size={13} /> {t.del}</button>
                    </div>
                    {promote === s.id && (
                      <LivePromotePanel session={s} placeOnExchange={placeOnExchange} availUsdt={availUsdt} exLive={exLive} lang={lang} rtl={rtl} promoteNote={t.promoteNote} />
                    )}
                  </div>
                )}

                {/* positions (arrow 2) */}
                {oPos && (
                  <div style={{ borderTop: `1px solid ${C.line}`, padding: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(s.positions || []).map((p: any) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px" }}>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{p.symbol}/USDT</span>
                            <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: C.muted }}>{t.entry} {p.entryPrice} · {t.now} {p.currentPrice ?? "—"}</span>
                          </span>
                          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ textAlign: "end", fontFamily: MONO }}>
                              <span style={{ color: Number(p.pnl) >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{signed(p.pnl)}</span>
                              <span style={{ display: "block", fontSize: 11, color: Number(p.pnlPct) >= 0 ? C.gain : C.loss }}>({Number(p.pnlPct || 0).toFixed(2)}%)</span>
                            </span>
                            {p.status === "open" ? (
                              <button onClick={() => closePosM.mutate({ s: s.id, id: p.id })} title={t.close} className="gbtn" style={{ width: 30, height: 30, borderRadius: "50%", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><X size={15} /></button>
                            ) : <span style={{ fontSize: 11, color: C.faint }}>{t.close}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
              </div>
            )}
          </div>
        </div>
      )}

      {showAuto && <AutoRunModal onClose={() => setShowAuto(false)} lang={lang} />}
    </div>
  );
}

// ── shared bits ──
const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
const inp: React.CSSProperties = { width: "100%", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", color: C.text, fontFamily: "inherit", fontSize: 14 };
const lbl: React.CSSProperties = { fontSize: 12, color: C.muted, marginBottom: 8 };
const optLbl: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: C.text, cursor: "pointer" };
const bigBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none", borderRadius: 11, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" };
const recRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid", borderRadius: 11, padding: "11px 13px", cursor: "pointer", fontFamily: "inherit", color: C.text, textAlign: "start" };
const statBtn: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", minWidth: 130 };
// Modal shell — bounded to the viewport via a fixed inset:0 overlay + a flex-column card whose
// max-height is a PERCENT of that overlay (NO vh/svh — html{zoom:1.15} breaks viewport units on
// large displays). The card's BODY (modalBody) scrolls; the FOOTER (modalFooter) is flex-shrink:0
// so the primary action (scan / approve) is ALWAYS visible and never scrolls away.
const modalOverlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 9990, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "24px 14px", background: "rgba(0,0,0,0.66)", backdropFilter: "blur(4px)" };
const modalCard: React.CSSProperties = { position: "relative", display: "flex", flexDirection: "column", width: "100%", maxWidth: 520, maxHeight: "100%", minHeight: 0, overflow: "hidden", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.6)" };
const modalBody: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: 18 };
const modalFooter: React.CSSProperties = { flexShrink: 0, borderTop: `1px solid ${C.line}`, padding: "12px 16px", background: C.surface, display: "flex", alignItems: "center", gap: 8 };
const modalX: React.CSSProperties = { position: "absolute", top: 10, insetInlineEnd: 10, zIndex: 2, width: 30, height: 30, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer" };
const statLbl: React.CSSProperties = { fontSize: 11, color: C.muted };
const statVal: React.CSSProperties = { fontSize: 22, fontWeight: 800, fontFamily: MONO, color: C.text };
function arrowBtn(active: boolean): React.CSSProperties {
  return { width: 30, height: 30, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", fontFamily: "inherit", background: active ? "var(--btn-bg)" : C.surface2, color: active ? "var(--btn-ink)" : C.muted, border: `1px solid ${active ? C.gold : C.line}` };
}
function tabBtn(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, background: active ? "var(--btn-bg)" : C.surface2, color: active ? "var(--btn-ink)" : C.muted, border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 10, padding: "9px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
}
function chip(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, background: active ? "var(--btn-bg)" : C.surface2, color: active ? "var(--btn-ink)" : C.muted, border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 9, padding: "8px 12px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };
}
function pill(c: string): React.CSSProperties {
  return { fontSize: 10, fontWeight: 700, color: c, background: `${c}22`, border: `1px solid ${c}66`, borderRadius: 999, padding: "1px 7px", marginInlineStart: 6 };
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={{ fontSize: 12, color: C.muted }}>{label}</span>{children}</label>;
}
function Metric({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return <div style={card}><div style={{ fontSize: 11, color: C.muted }}>{label}</div><div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, fontFamily: MONO, color: color || C.text }}>{value}</div></div>;
}
function Mini({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 9px" }}><div style={{ fontSize: 9.5, color: C.faint }}>{label}</div><div style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, color: color || C.text, marginTop: 2 }}>{value}</div></div>;
}

// ── Live promote — pick WHICH recommended positions to open for real, keeping
// capital ↔ allocation ↔ per-position value always reconciled.
// Mirrors the DEMO preview's selection model (a Set of chosen rows, all pre-checked,
// even-split sizing perPos = capital / selected) and adds an optional manual mode
// where the user edits each allocation while a running total guards over-allocation.
// It only feeds the existing Exchange order ticket (a % of free USDT per symbol) —
// it does not change order execution.
function LivePromotePanel({ session, placeOnExchange, availUsdt, exLive, lang, rtl, promoteNote }: {
  session: any;
  placeOnExchange: (sym: string, pct?: number, slOverride?: number, tpOverride?: number) => void;
  availUsdt: number | null;
  exLive: boolean;
  lang: "he" | "en";
  rtl: boolean;
  promoteNote: string;
}) {
  const he = lang === "he";
  const T = (en: string, h: string) => (he ? h : en);
  // Protective levels carried into the live buy: the run's OWN armed stop/take-profit when set,
  // else the always-on defaults (2% / 5%) so a promoted live position is never unprotected. The
  // user still reviews & edits them on the Exchange ticket before placing (PIN-gated).
  const sessSl = (session.stopLossEnabled && session.stopLossMode === "pct" && Number(session.stopLossValue) > 0) ? Number(session.stopLossValue) : 2;
  const sessTp = Number(session.takeProfitPct) > 0 ? Number(session.takeProfitPct) : 5;
  const positions: any[] = (session.positions || []).filter((p: any) => p.status === "open");
  // Real live USDT to deploy when the connected account is LIVE; otherwise anchor on
  // the run's own capital (best-effort, but still internally consistent).
  const avail: number | null = exLive && availUsdt != null && availUsdt > 0 ? availUsdt : null;
  const recTotal = positions.reduce((a, p) => a + Number(p.entryPrice || 0) * Number(p.qty || 0), 0);
  const [capital, setCapital] = useState<number>(() => Math.round((avail ?? (Number(session.capital) || recTotal || 1000)) * 100) / 100);
  const [sel, setSel] = useState<Set<number>>(() => new Set(positions.map((p) => p.id))); // all recommended pre-selected, like DEMO
  const [manual, setManual] = useState(false);
  const [alloc, setAlloc] = useState<Record<number, number>>({});

  const selPositions = positions.filter((p) => sel.has(p.id));
  const n = selPositions.length;
  const autoEach = n > 0 ? capital / n : 0;                       // even split — deselecting redistributes automatically
  const allocOf = (p: any) => (manual ? Number(alloc[p.id] ?? 0) : autoEach);
  const total = selPositions.reduce((a, p) => a + allocOf(p), 0); // running total of the SELECTED allocations
  const over = total > capital + 0.005;
  const remaining = capital - total;
  // Each allocation as a % of the deployable base, so the Exchange ticket (which buys
  // a % of free USDT) opens the matching size. value(per position) === its allocation.
  const base = avail ?? capital;
  const pctOf = (p: any) => (base > 0 ? (allocOf(p) / base) * 100 : 0);

  const toggle = (id: number) => setSel((prev) => { const x = new Set(prev); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const allOn = n === positions.length && positions.length > 0;
  const selectAll = () => setSel(allOn ? new Set() : new Set(positions.map((p) => p.id)));
  // Entering manual seeds every row with the current even-split value, so the running
  // total starts already reconciled to the capital.
  const enterManual = () => { const seed: Record<number, number> = {}; positions.forEach((p) => { seed[p.id] = Math.round(autoEach * 100) / 100; }); setAlloc(seed); setManual(true); };
  const distributeEven = () => { const each = n > 0 ? Math.round((capital / n) * 100) / 100 : 0; setAlloc((prev) => { const next = { ...prev }; selPositions.forEach((p) => { next[p.id] = each; }); return next; }); };
  const setAllocFor = (id: number, v: number) => setAlloc((prev) => ({ ...prev, [id]: Math.max(0, Number.isFinite(v) ? v : 0) }));

  const shell: React.CSSProperties = { background: "rgba(247,147,26,0.08)", border: `1px solid ${C.goldDim}`, borderRadius: 10, padding: 12, marginTop: 12, fontSize: 12.5, color: C.muted, direction: rtl ? "rtl" : "ltr" };
  if (positions.length === 0) {
    return <div style={shell}>⚠️ {promoteNote}<div style={{ marginTop: 8, color: C.faint }}>{T("no open positions", "אין פוזיציות פתוחות")}</div></div>;
  }

  return (
    <div style={shell}>
      ⚠️ {promoteNote}
      <div style={{ marginTop: 8, fontSize: 11.5, color: C.gold, fontWeight: 700, lineHeight: 1.5 }}>
        {he ? `כל פוזיציה תגיע לטיקט הבורסה עם הגנת OCO מוכנה: סטופ ${sessSl}%- וטייק-פרופיט +${sessTp}% (ניתן לערוך לפני הביצוע).` : `Each position arrives at the Exchange ticket pre-armed with an OCO: −${sessSl}% stop and +${sessTp}% take-profit (editable before you place it).`}
      </div>

      {/* Capital to deploy — the anchor everything reconciles to */}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: C.text }}>{T("Capital to deploy", "הון להפעלה")} ($)</span>
        <input type="number" min={0} value={capital} onChange={(e) => setCapital(Math.max(0, Number(e.target.value) || 0))} style={{ ...inp, width: 140 }} />
        {avail != null && (
          <span style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {T("Available", "פנוי")} · LIVE: <b style={{ color: C.gain, fontFamily: MONO }}>{money(avail)}</b>
            <button type="button" onClick={() => setCapital(Math.floor(avail))} style={{ ...chip(false), padding: "3px 9px" }}>{T("Use available", "השתמש בפנוי")}</button>
          </span>
        )}
      </div>

      {/* Select all / none + accept-even-split vs manual allocations */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={selectAll} style={chip(false)}>{allOn ? T("Select none", "נקה הכל") : T("Select all", "בחר הכל")}</button>
        <button onClick={() => (manual ? setManual(false) : enterManual())} style={chip(manual)}>{manual ? T("Even split", "חלוקה שווה") : T("Manual allocations", "חלוקה ידנית")}</button>
        {manual && <button onClick={distributeEven} style={chip(false)}>{T("Distribute evenly", "פזר שווה")}</button>}
      </div>

      {/* One row per recommended position: checkbox · symbol · recommended alloc / editable value · → Exchange */}
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
        {positions.map((p) => {
          const on = sel.has(p.id);
          const a = allocOf(p);
          const pct = pctOf(p);
          const can = on && !over && a > 0;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${on ? C.gold : C.line}`, borderRadius: 9, padding: "8px 10px", flexWrap: "wrap" }}>
              <button onClick={() => toggle(p.id)} aria-label="toggle" style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${on ? C.gold : C.line}`, background: on ? "var(--btn-bg)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>{on && <Check size={13} color="var(--btn-ink)" />}</button>
              <span style={{ fontWeight: 800, color: C.text, minWidth: 60 }}>{p.symbol}</span>
              <span style={{ fontSize: 11, color: C.faint, fontFamily: MONO }}>{Number(p.qty).toPrecision(4)} @ {p.entryPrice}</span>
              <span style={{ flex: 1 }} />
              {/* allocation = per-position value. editable in manual; computed even-split otherwise. */}
              {manual ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, color: C.faint }}>$</span>
                  <input type="number" min={0} disabled={!on} value={on ? (alloc[p.id] ?? 0) : 0} onChange={(e) => setAllocFor(p.id, Number(e.target.value))} style={{ ...inp, width: 96, opacity: on ? 1 : 0.4 }} />
                </span>
              ) : (
                <span style={{ fontFamily: MONO, color: on ? C.text : C.faint, fontWeight: 700 }}>{on ? money(a) : "—"}</span>
              )}
              <button onClick={() => placeOnExchange(p.symbol, pct, sessSl, sessTp)} disabled={!can} title={T("Open on the Exchange screen", "פתח במסך הבורסה")} className="gbtn"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 8, padding: "6px 11px", fontWeight: 800, fontSize: 12, cursor: can ? "pointer" : "not-allowed", opacity: can ? 1 : 0.4, fontFamily: "inherit" }}>
                <ArrowUpRight size={12} /> {T("Exchange", "בורסה")}{base > 0 ? ` ${pct.toFixed(1)}%` : ""}
              </button>
            </div>
          );
        })}
      </div>

      {/* Running total vs capital — always reconciled; over-allocation flagged in red */}
      <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12 }}>
          <b style={{ color: C.text }}>{n}</b> {T("selected", "נבחרו")} · {T("allocated", "הוקצה")} <b style={{ color: over ? C.loss : C.text, fontFamily: MONO }}>{money(total)}</b> / {money(capital)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: over ? C.loss : C.gain }}>
          {over ? T("over by ", "חריגה ") + money(total - capital) : T("remaining ", "נותר ") + money(remaining)}
        </span>
      </div>
      {over && (
        <div style={{ marginTop: 8, background: "rgba(240,97,109,0.12)", border: `1px solid ${C.loss}`, color: "#f3a3a3", borderRadius: 8, padding: "7px 10px", fontSize: 12 }}>
          {T("Allocations exceed your capital — reduce them or raise the capital before opening.", "ההקצאות חורגות מההון — הקטן אותן או הגדל את ההון לפני פתיחה.")}
        </div>
      )}
    </div>
  );
}

// Auto-run — configure the in-app scheduler (interval/count, auto-close on target,
// "only if capital available", and reinvest/compound). Saves to /exchange/paper/autorun.
function AutoRunModal({ onClose, lang }: { onClose: () => void; lang: "he" | "en" }) {
  const qc = useQueryClient();
  const he = lang === "he";
  const T = (en: string, h: string) => (he ? h : en);
  const cfgQ = useQuery({ queryKey: ["autorun"], queryFn: () => api.paperAutorunGet() });
  const loaded = (cfgQ.data as any)?.config;
  const [c, setC] = useState<any | null>(null);
  React.useEffect(() => { if (loaded && !c) setC({ ...loaded }); }, [loaded]); // eslint-disable-line
  const set = (k: string, v: any) => setC((p: any) => ({ ...p, [k]: v }));
  const toggleArr = (k: string, v: string) => setC((p: any) => { const a = new Set(p[k] || []); a.has(v) ? a.delete(v) : a.add(v); return { ...p, [k]: Array.from(a) }; });
  const [msg, setMsg] = useState("");
  const saveM = useMutation({
    mutationFn: () => api.paperAutorunSave(c),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["autorun"] }); setMsg(T("Saved ✓", "נשמר ✓")); setTimeout(() => setMsg(""), 2200); },
    onError: (e: any) => setMsg(e?.message || String(e)),
  });

  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={modalCard}>
        <button onClick={onClose} aria-label="close" style={modalX}><X size={16} /></button>
        <div style={modalBody}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800 }}><Repeat size={16} color={C.gold} /> {T("Auto-run", "ריצה אוטומטית")}</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 16 }}>
            {T("Let the engine open demo runs for you automatically — no external scheduler.", "תנו למנוע לפתוח ריצות דמו עבורכם אוטומטית — בלי מתזמן חיצוני.")}
          </div>
          {!c ? (
            <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={15} className="spin" /> …</div>
          ) : (
            <>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: C.text, cursor: "pointer", marginBottom: 14 }}>
                <input type="checkbox" checked={!!c.enabled} onChange={(e) => set("enabled", e.target.checked)} /> {T("Auto-run enabled", "ריצה אוטומטית פעילה")}
              </label>

              <div style={{ marginTop: 6 }}>
                <div style={lbl}>{T("Schedule", "תזמון")}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => set("mode", "interval")} style={chip(c.mode === "interval")}>{T("Every X minutes", "כל X דקות")}</button>
                  <button onClick={() => set("mode", "count")} style={chip(c.mode === "count")}>{T("N runs then stop", "N ריצות ואז עצור")}</button>
                </div>
                <div style={{ marginTop: 10 }}>
                  {c.mode === "count"
                    ? <Field label={T("How many runs", "כמה ריצות")}><input type="number" min={1} value={c.count} onChange={(e) => set("count", Number(e.target.value))} style={inp} /></Field>
                    : <Field label={T("Every (minutes)", "כל (דקות)")}><input type="number" min={1} value={c.intervalMinutes} onChange={(e) => set("intervalMinutes", Number(e.target.value))} style={inp} /></Field>}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginTop: 14 }}>
                <Field label={T("Capital per run (USDT)", "הון לכל ריצה")}><input type="number" value={c.capital} onChange={(e) => set("capital", Number(e.target.value))} style={inp} /></Field>
                <Field label={T("Profit target (USDT)", "יעד רווח")}><input type="number" value={c.dailyTarget} onChange={(e) => set("dailyTarget", Number(e.target.value))} style={inp} /></Field>
                <Field label={T("Max positions", "מקס׳ פוזיציות")}><input type="number" min={1} max={20} value={c.maxPositions} onChange={(e) => set("maxPositions", Number(e.target.value))} style={inp} /></Field>
              </div>

              {/* Stop-loss — %: per-position (close each position at −X% from entry); $: whole-run */}
              <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
                <label style={optLbl}><input type="checkbox" checked={!!c.stopLossEnabled} onChange={(e) => set("stopLossEnabled", e.target.checked)} /> {T("Stop-loss — auto-close losing positions", "סטופ-לוס — סגירה אוטומטית של פוזיציות מפסידות")}</label>
                {c.stopLossEnabled && (
                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={() => set("stopLossMode", "amount")} style={chip(c.stopLossMode !== "pct")}>{T("Amount ($)", "סכום ($)")}</button>
                    <button onClick={() => set("stopLossMode", "pct")} style={chip(c.stopLossMode === "pct")}>{T("Percent (%)", "אחוז (%)")}</button>
                    <input type="number" min={0} value={c.stopLossValue} onChange={(e) => set("stopLossValue", Number(e.target.value))} style={{ ...inp, width: 130 }} />
                    <span style={{ fontSize: 11.5, color: C.muted }}>{c.stopLossMode === "pct" ? T("% from each position's entry", "% מהכניסה של כל פוזיציה") : T("USDT loss (whole run)", "הפסד USDT (כל הריצה)")}</span>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={lbl}>{T("Strategy", "אסטרטגיה")}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {STRATS.filter((s) => isStrategyVisible(s.k, isOwner())).map((s) => <button key={s.k} onClick={() => set("strategy", s.k)} style={chip(c.strategy === s.k)}>{strategyLabel(s.k, lang)}</button>)}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={lbl}>{T("Scan domain", "תחום סריקה")}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {BUCKETS.map((b) => <button key={b.k} onClick={() => toggleArr("buckets", b.k)} style={chip((c.buckets || []).includes(b.k))}>{he ? b.he : b.en}</button>)}
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={lbl}>{T("Tiers", "דירוגים")}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                  {TIERS.map((x) => { const ti = tierInfo(x); return <button key={x} onClick={() => toggleArr("tiers", x)} style={chip((c.tiers || []).includes(x))}>{(ti as any)[lang] || x}</button>; })}
                </div>
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 11, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
                <label style={optLbl}><input type="checkbox" checked={c.autoCloseOnTarget !== false} onChange={(e) => set("autoCloseOnTarget", e.target.checked)} /> {T("Auto-close the whole run when the target is hit", "סגור את כל הריצה כשהיעד מושג")}</label>
                <label style={optLbl}><input type="checkbox" checked={c.onlyIfCapitalAvailable !== false} onChange={(e) => set("onlyIfCapitalAvailable", e.target.checked)} /> {T("Only open a new run if capital is available", "פתח ריצה חדשה רק אם יש הון פנוי")}</label>
                <label style={optLbl}><input type="checkbox" checked={!!c.reinvest} onChange={(e) => set("reinvest", e.target.checked)} /> {T("Reinvest the full result into the next run (compound)", "השקע מחדש את כל התוצאה בריצה הבאה")}</label>
                {isAdmin() && (
                  <label style={optLbl}><input type="checkbox" checked={!!c.dailyReset} onChange={(e) => set("dailyReset", e.target.checked)} /> {T("Daily reset — close the day's runs and reopen at 00:01 (admin)", "איפוס יומי — סגור את ריצות היום ופתח מחדש ב-00:01 (מנהל)")}</label>
                )}
              </div>

              {msg && <div style={{ marginTop: 12, fontSize: 12.5, color: C.muted, fontFamily: MONO }}>{msg}</div>}
              <button onClick={() => saveM.mutate()} disabled={saveM.isPending} className="gbtn" style={{ ...bigBtn, marginTop: 16 }}>
                {saveM.isPending ? <><Loader2 size={16} className="spin" /> {T("Saving…", "שומר…")}</> : <><Check size={16} /> {T("Save auto-run", "שמור ריצה אוטומטית")}</>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Period P&L — press a chip to switch Today / Month / Year / All-time.
function PeriodPnl({ lang }: { lang: string }) {
  const liveQ = useQuery({ queryKey: ["dashboardLive"], queryFn: () => api.dashboardLive(), refetchInterval: 15000, retry: 0 });
  const demo: any = (liveQ.data as any)?.demo || {};
  const [period, setPeriod] = useState<"today" | "month" | "year" | "total">("month");
  const labels: Record<string, string> = lang === "he"
    ? { today: "היום", month: "החודש", year: "השנה", total: "סה\"כ" }
    : { today: "Today", month: "Month", year: "Year", total: "All-time" };
  const val = Number(demo[period] || 0);
  const pct = demo.pct != null ? Number(demo.pct) : null;  // P&L as % of invested basis
  return (
    <div style={{ ...card, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {(["today", "month", "year", "total"] as const).map((p) => (
          <button key={p} onClick={() => setPeriod(p)} style={chip(period === p)}>{labels[p]}</button>
        ))}
      </div>
      <div style={{ fontSize: 11, color: C.muted }}>{lang === "he" ? "רווח/הפסד דמו" : "Demo P&L"} · {labels[period]}</div>
      <div style={{ fontSize: 28, fontWeight: 800, fontFamily: MONO, color: val >= 0 ? C.gain : C.loss, marginTop: 2 }}>{signed(val)}{pct != null && period === "total" ? <span style={{ fontSize: 15 }}> ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span> : null}</div>
    </div>
  );
}


// Activity calendar — each day tinted green (profit) / red (loss); tap a day to see its trades.
function ActivityCalendar({ lang, rtl, onClose }: { lang: string; rtl: boolean; onClose?: () => void }) {
  const dailyQ = useQuery({ queryKey: ["paperDaily"], queryFn: () => api.paperDailyPnl(), refetchInterval: 30000 });
  const byDay = React.useMemo(() => {
    const m: Record<string, { pnl: number; trades: any[] }> = {};
    ((dailyQ.data as any)?.days || []).forEach((d: any) => { m[d.day] = { pnl: d.pnl, trades: d.trades }; });
    return m;
  }, [dailyQ.data]);
  const today = new Date();
  const [cur, setCur] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startW = new Date(cur.y, cur.m, 1).getDay();
  const daysIn = new Date(cur.y, cur.m + 1, 0).getDate();
  const key = (d: number) => `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`;
  const monthPrefix = `${cur.y}-${pad(cur.m + 1)}`;
  const monthTotal = Object.entries(byDay).filter(([k]) => k.startsWith(monthPrefix)).reduce((a, [, v]) => a + v.pnl, 0);
  const monthName = new Date(cur.y, cur.m, 1).toLocaleDateString(lang === "he" ? "he-IL" : "en-US", { month: "long", year: "numeric" });
  const WD = lang === "he" ? ["א", "ב", "ג", "ד", "ה", "ו", "ש"] : ["S", "M", "T", "W", "T", "F", "S"];
  const cells: (number | null)[] = [];
  for (let i = 0; i < startW; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  const shift = (n: number) => setCur((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const dayData = openDay ? byDay[openDay] : null;
  return (
    <div style={{ ...card, marginBottom: 12 }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <button onClick={onClose} title={lang === "he" ? "סגור יומן" : "Collapse calendar"} style={{ ...chip(false), padding: "4px 8px" }}><ChevronUp size={13} /> {lang === "he" ? "סגור" : "Hide"}</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => shift(-1)} style={chip(false)}>{rtl ? "›" : "‹"}</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13.5, fontWeight: 800 }}>{monthName}</div>
          <div style={{ fontSize: 11, fontFamily: MONO, color: monthTotal >= 0 ? C.gain : C.loss }}>{lang === "he" ? "החודש עד היום" : "Month to date"}: {signed(monthTotal)}</div>
        </div>
        <button onClick={() => shift(1)} style={chip(false)}>{rtl ? "‹" : "›"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
        {WD.map((w, i) => <div key={"wd" + i} style={{ textAlign: "center", fontSize: 9.5, color: C.faint, padding: "2px 0" }}>{w}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={"e" + i} />;
          const k = key(d); const dd = byDay[k]; const pnl = dd?.pnl;
          const bg = pnl == null ? C.surface2 : pnl > 0 ? "rgba(22,199,126,0.18)" : pnl < 0 ? "rgba(240,97,109,0.18)" : C.surface2;
          const bc = openDay === k ? C.gold : (pnl == null ? C.line : pnl > 0 ? `${C.gain}66` : pnl < 0 ? `${C.loss}66` : C.line);
          return (
            <button key={k} onClick={() => dd && setOpenDay(openDay === k ? null : k)} style={{ background: bg, border: `1px solid ${bc}`, borderRadius: 8, padding: "5px 2px", cursor: dd ? "pointer" : "default", fontFamily: "inherit", minHeight: 40 }}>
              <div style={{ fontSize: 10.5, color: C.muted }}>{d}</div>
              {pnl != null && <div style={{ fontSize: 9.5, fontWeight: 800, fontFamily: MONO, color: pnl >= 0 ? C.gain : C.loss }}>{pnl >= 0 ? "+" : ""}{Math.round(pnl)}</div>}
            </button>
          );
        })}
      </div>
      {dayData && (
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{openDay} · <span style={{ fontFamily: MONO, color: dayData.pnl >= 0 ? C.gain : C.loss }}>{signed(dayData.pnl)}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {dayData.trades.map((tr: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px" }}>
                <span><b>{tr.symbol}</b> <span style={{ color: C.faint, fontSize: 10.5 }}>· {tr.session}</span></span>
                <span style={{ fontFamily: MONO, color: tr.pnl >= 0 ? C.gain : C.loss, fontWeight: 700 }}>{signed(tr.pnl)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
