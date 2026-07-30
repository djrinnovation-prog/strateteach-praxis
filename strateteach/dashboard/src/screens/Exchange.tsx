import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, AlertTriangle, ShieldCheck, Trash2, Save, Banknote, ArrowUp, ArrowDown, ArrowRight, ArrowLeft, Wallet, TrendingUp, Plus, Diamond, KeyRound, X, Info, ExternalLink, Repeat, Layers, Cpu, Radio, Bot } from "lucide-react";
import { api, saveExchangeCreds, loadExchangeCreds, loadAccounts, addAccount, removeAccount, setActiveAccount, activeAccountId, saveAccounts, isAdmin, ACCOUNT_LIMIT } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW, onAccent } from "../theme";
import { PasswordInput } from "../ui";
import { EXPLAIN } from "../lib/explain";
import LivePositions from "../components/LivePositions";
import LiveBalances from "../components/LiveBalances";
import ConfirmModal from "../components/ConfirmModal";
import { usePinGate } from "../components/PinModal";
import TourLauncher from "../components/TourLauncher";
import { HubPanel } from "../components/HubScreen";
import { ScreenHeader } from "../components/ScreenHeader";
import ScreenHero from "../components/ScreenHero";
import ScreenShortcuts from "../components/ScreenShortcuts";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import { useIsMobile } from "../lib/useIsMobile";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import ScreenBottom from "../components/ScreenBottom";
import { toastError, toastSuccess, toastPending, dismissToast } from "../lib/toast";
import { raceTimeout, honestMoneyError, validateAmount } from "../lib/money";
import { mapExchangeError } from "../lib/exchangeErrors";
import ExchangeErrorText from "../components/ExchangeError";
import { track, ev } from "../lib/analytics";
import FieldError from "../components/FieldError";

// Exchange-keys disclosure. Kept accurate to the encrypted server-side backup (see the
// full editable version under "exchange_keys" in the Legal Console). We never take custody
// of funds; the backup is encrypted at rest and decrypted back only to you.
const NOTE = {
  he: "המפתחות נשמרים בדפדפן זה כדרך המהירה, ובנוסף נשמר עבורך גיבוי מוצפן בשרת כדי שהחיבור יעבור בין מכשירים וישרוד ניקוי דפדפן. הגיבוי מוצפן במנוחה ומפוענח רק אליך. מומלץ מפתחות למסחר בלבד (ללא משיכה).",
  en: "Keys are kept in this browser as the fast path, plus an encrypted backup on our server so your connection follows you across devices and survives clearing your browser. The backup is encrypted at rest and decrypted only back to you. Trade-only keys (no withdrawal) recommended.",
};

// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY US-connectivity notice — rendered INLINE inside the Exchange connect
// area only (no longer a global top banner). Informational written text; never
// gates anything. ADMIN: flip this single flag to `false` and redeploy once US
// connectivity is restored — nothing else to change.
// ─────────────────────────────────────────────────────────────────────────────
export const SHOW_US_CONNECT_NOTICE = true;
const US_NOTICE = {
  he: "כרגע לא ניתן להתחבר דרך ארה״ב (US). אנחנו עובדים על זה ונעדכן בהקדם.",
  en: "Connecting from the US is currently unavailable. We're working on it and will update soon.",
};

/** Small inline notice line shown in the connect area while US connectivity is
 * unavailable. Skin-dynamic + RTL-aware; plain written text, not a popup/banner. */
function UsConnectInline({ rtl }: { rtl: boolean }) {
  if (!SHOW_US_CONNECT_NOTICE) return null;
  return (
    <div
      role="status"
      dir={rtl ? "rtl" : "ltr"}
      style={{
        display: "flex", alignItems: "flex-start", gap: 9,
        margin: "0 0 12px", padding: "10px 12px", boxSizing: "border-box",
        borderRadius: 12, background: C.surface2,
        border: `1px solid ${C.line}`, borderInlineStart: `3px solid ${C.gold}`,
        fontFamily: UI, lineHeight: 1.45,
      }}
    >
      <span style={{ flexShrink: 0, color: C.gold, marginTop: 1 }}>
        <Info size={15} />
      </span>
      <div style={{ minWidth: 0 }}>
        <span dir="rtl" style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: C.text }}>{US_NOTICE.he}</span>
        <span dir="ltr" style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 600, color: C.muted }}>{US_NOTICE.en}</span>
      </div>
    </div>
  );
}
const CLEAR = { he: "מחק מפתחות מהדפדפן", en: "Clear keys from this browser" };
const SAVEDH = { he: "מחובר בדפדפן זה ✓", en: "Connected in this browser ✓" };
const WADDR_KEY = "algo770_withdraw_addr";
const WSTR = {
  he: { title: "משיכה לארנק חיצוני", whitelist: "כתובת מאושרת (whitelist)", setAddr: "שמור כתובת", change: "שנה", clear: "מחק", currency: "מטבע", amount: "כמות", tag: "תג/ממו (אם נדרש)", to: "אל", typeConfirm: "הקלד WITHDRAW לאישור", withdraw: "בצע משיכה", warnLive: "מצב חי — כסף אמיתי. לא ניתן לבטל.", note: "ודאו שהפעלתם הרשאת משיכה ורשימת כתובות מאושרות בבורסה עצמה. הכתובת נשמרת רק בדפדפן הזה.", needAddr: "הגדירו תחילה כתובת מאושרת." },
  en: { title: "Withdraw to external wallet", whitelist: "Whitelisted address", setAddr: "Save address", change: "Change", clear: "Clear", currency: "Currency", amount: "Amount", tag: "Tag/Memo (if required)", to: "To", typeConfirm: "Type WITHDRAW to confirm", withdraw: "Withdraw", warnLive: "LIVE mode — real money. Cannot be undone.", note: "Make sure you've enabled withdrawal permission and an address whitelist on the exchange itself. The address is stored only in this browser.", needAddr: "Set a whitelisted address first." },
};

// Non-custodial exchange screen: the user's API keys live only in their browser and
// travel as transient headers; the backend never persists them. (PRR §0)
export default function Exchange() {
  const { t, rtl, lang } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  // Rows ⇄ tiles view for the "More" child grid (persisted per user).
  const [moreView, setMoreView] = useViewMode("algo770_exmore_view_v1", "cards");
  const stored = loadExchangeCreds() || {};
  const cfgQ = useQuery({ queryKey: ["exchangeConfig"], queryFn: () => api.exchangeConfig() });
  const supported: string[] = (cfgQ.data as any)?.supportedExchanges || ["binance", "bybit", "okx", "kraken", "kucoin", "bitget", "gate", "coinbase"];

  const [exchange, setExchange] = useState(stored.name || "binance");
  const [environment, setEnvironment] = useState(stored.env || "testnet");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [apiPassphrase, setApiPassphrase] = useState("");
  const [saved, setSaved] = useState(!!(stored.key && stored.secret));
  const [balance, setBalance] = useState<any>(null);
  const [order, setOrder] = useState({ symbol: "", side: "buy", pct: 10, orderType: "market", slPct: 0, tpPct: 0 });
  const symQ = useQuery({ queryKey: ["symList", "crypto"], queryFn: () => api.symbols("crypto") });
  const appSyms: any[] = (symQ.data as any) || [];
  // Live tradeable symbols imported straight from the connected exchange (Binance),
  // so the picker only offers coins you can actually trade. Falls back to app list.
  const exSymQ = useQuery({ queryKey: ["exMarketSymbols"], queryFn: () => api.exchangeSymbols(), enabled: !!(stored.key && stored.secret), retry: false, staleTime: 3600000 });
  const liveSyms: any[] = (exSymQ.data as any)?.symbols || [];
  const symList: any[] = liveSyms.length ? liveSyms : appSyms;
  const [waddr, setWaddr] = useState(() => localStorage.getItem(WADDR_KEY) || "");
  const [wEditAddr, setWEditAddr] = useState("");
  const [wcur, setWcur] = useState("USDT"); const [wamt, setWamt] = useState(""); const [wtag, setWtag] = useState(""); const [wconfirm, setWconfirm] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const w = WSTR[lang];
  const flash = (m: string) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 4000); };
  const fail = (e: any) => { setErr(e?.message || String(e)); setMsg(""); };
  const isLive = environment === "live";
  // Which exchange tile (if any) has its connect-guidance modal open. Tapping a tile
  // in the grid opens the guidance; "Continue" then reveals the EXISTING connect form
  // pre-pointed at that exchange — we never build a second key-entry path.
  const [guideEx, setGuideEx] = useState<string | null>(null);
  // Home-methodology hero wiring (re-layout; every target is a REAL existing action).
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollTo = (r: React.RefObject<HTMLDivElement>) => setTimeout(() => r.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  // Which exchange's "i" info card is open — a short blurb + a one-tap signup link
  // to that exchange's official register page (opens in a new tab). Separate from the
  // connect guide; lets a brand-new user create an exchange account first.
  const [infoEx, setInfoEx] = useState<string | null>(null);
  // LOCKED-LAUNCHER model: the active child section is DRIVEN BY THE URL (?sec=…), so each
  // function opens as its own child SCREEN via real navigation — the browser Back button
  // returns to the launcher, and nothing expands in place. `/exchange` (no sec) = the clean
  // launcher; ?sec=connect/funds/trade/withdraw/new/more = that child.
  const [sp, setSp] = useSearchParams();
  const xsec = sp.get("sec") || "";
  const setXsec = (v: string) => setSp(v ? { sec: v } : {});
  // ── Multi-account (sub-accounts) ──
  const [accts, setAccts] = useState(() => loadAccounts());
  const [editingId, setEditingId] = useState<string | null>(activeAccountId());
  const [label, setLabel] = useState(() => loadAccounts().find((a) => a.id === activeAccountId())?.label || "");
  const reloadAccts = () => setAccts(loadAccounts());
  // Live funds + P&L per saved account (for the connected-accounts dashboard list).
  const acctPnlQ = useQuery({
    queryKey: ["acctPnlList", accts.map((a) => a.id).join(",")],
    enabled: accts.length > 0, retry: false, refetchInterval: 30000,
    queryFn: async () => Promise.all(accts.map(async (a) => {
      try { const p: any = await api.livePnl({ key: a.key, secret: a.secret, passphrase: a.passphrase, name: a.name, env: a.env }); return { id: a.id, ok: p?.ok !== false, value: Number(p?.totalValue) || 0, pnl: Number(p?.totalPnl) || 0, pct: p?.totalPnlPct != null ? Number(p.totalPnlPct) : null }; }
      catch { return { id: a.id, ok: false, value: 0, pnl: 0, pct: null }; }
    })),
  });
  const acctData: any[] = (acctPnlQ.data as any[]) || [];
  const dataFor = (id: string) => acctData.find((d) => d.id === id);

  function selectAccount(a: any) {
    setActiveAccount(a.id); setEditingId(a.id);
    setExchange(a.name || "binance"); setEnvironment(a.env || "testnet"); setLabel(a.label || "");
    setApiKey(""); setApiSecret(""); setApiPassphrase(""); setSaved(!!(a.key && a.secret));
    ["exBalanceOv", "exPositionsOv", "livePnl", "exMarketSymbols", "tkPrices", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    flash(lang === "he" ? "חשבון נבחר" : "Account selected");
  }
  function addNew() {
    setEditingId(null); setLabel(""); setApiKey(""); setApiSecret(""); setApiPassphrase(""); setExchange("binance"); setEnvironment("testnet"); setSaved(false);
  }
  // From the exchange grid → guidance → "Continue": start a fresh new-account entry
  // pre-pointed at the chosen exchange and open the EXISTING connect form (no new key
  // path). Same field-resetting moves as addNew(), so Binance connect/persistence is
  // untouched — we only steer the form's exchange select.
  function connectExchange(k: string) {
    setGuideEx(null);
    setEditingId(null); setLabel(""); setApiKey(""); setApiSecret(""); setApiPassphrase("");
    setExchange(k); setEnvironment("testnet"); setSaved(false);
    setXsec("connect");
    setTimeout(() => document.getElementById("algo770-ex-connect-top")?.scrollIntoView({ behavior: "smooth", block: "start" }), 90);
  }
  function saveKeys() {
    const list = loadAccounts();
    const existing = editingId ? list.find((a) => a.id === editingId) : null;
    if (!existing && (!apiKey || !apiSecret)) return fail(new Error("API key + secret required"));
    const base = { label: label.trim() || `${exchange.toUpperCase()} · ${environment === "live" ? "LIVE" : "TEST"}`, name: exchange, env: environment };
    if (existing) {
      const keys = (apiKey && apiSecret) ? { key: apiKey, secret: apiSecret, passphrase: apiPassphrase } : {};
      saveAccounts(list.map((a) => (a.id === editingId ? { ...a, ...base, ...keys } : a)));
      setActiveAccount(editingId);
    } else {
      const cap = isAdmin() ? Infinity : ACCOUNT_LIMIT;
      if (list.length >= cap) { ev.blockedActionSeen("exchange_connect", "account_limit"); return fail(new Error(lang === "he" ? `מקסימום ${ACCOUNT_LIMIT} חשבונות` : `Max ${ACCOUNT_LIMIT} accounts`)); }
      const a = addAccount({ ...base, key: apiKey, secret: apiSecret, passphrase: apiPassphrase });
      setEditingId(a.id);
    }
    track("exchange_connect_attempt", { result: existing ? "update" : "new" });
    reloadAccts(); setSaved(true); setApiKey(""); setApiSecret(""); setApiPassphrase(""); flash(t.saved);
    ["exBalanceOv", "exPositionsOv", "livePnl", "exMarketSymbols", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }
  function clearKeys() {
    if (editingId) { removeAccount(editingId); reloadAccts(); setEditingId(activeAccountId()); }
    else saveExchangeCreds(null);
    setSaved(!!loadExchangeCreds()); setBalance(null); flash(t.saved);
    ["exBalanceOv", "exPositionsOv", "livePnl", "allAccountsPnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  }

  // Order-ticket handoff: Promote-to-live / the live plan / a position's "Close"
  // drop a symbol here, then send the user to this screen to review & place it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("algo770_order_prefill");
      if (!raw) return;
      const p = JSON.parse(raw);
      setOrder((o) => ({ ...o, symbol: p.symbol || o.symbol, side: p.side || o.side, pct: p.pct ?? o.pct, slPct: p.slPct ?? o.slPct, tpPct: p.tpPct ?? o.tpPct }));
      setXsec("trade");
      localStorage.removeItem("algo770_order_prefill");
      flash(lang === "he" ? "הוזן מהמנוע — בדקו ובצעו" : "Prefilled from the engine — review & place");
      setTimeout(() => document.getElementById("algo770-order-ticket")?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
    } catch { /* ignore */ }
  }, []); // eslint-disable-line

  const test = useMutation({
    onMutate: () => { toastPending(lang === "he" ? "בודק חיבור לבורסה…" : "Testing exchange connection…", "ex-test"); },
    mutationFn: () => raceTimeout(api.testExchange(), 20000),
    onSuccess: (r: any) => { dismissToast("ex-test"); if (r?.ok === false) { fail(new Error(r?.message || "Connection failed.")); toastError(lang === "he" ? "החיבור לבורסה נכשל" : "Exchange connection failed", { fundsSafe: false, body: (lang === "he" ? "בדקו את מפתחות ה-API וההרשאות. " : "Check your API keys & permissions. ") + String(r?.message || "") }); track("exchange_connect_result", { ok: false }); track("connection_test_failed", { code: "rejected" }); ev.blockedActionSeen("exchange_connect", "test_rejected"); return; } flash(r?.message || "OK"); toastSuccess(lang === "he" ? "החיבור לבורסה תקין ✓" : "Exchange connection OK ✓"); track("exchange_connect_result", { ok: true }); },
    onError: (e: any) => { dismissToast("ex-test"); fail(e); track("exchange_connect_result", { ok: false }); track("connection_test_failed", { code: e?.timeout ? "timeout" : "error" }); honestMoneyError(e, lang === "he" ? "בדיקת החיבור נכשלה" : "Connection test failed", lang, lang === "he" ? "בדקו את מפתחות ה-API והחיבור לרשת." : "Check your API keys and network.", "connection_test"); },
  });
  const closeP = useMutation({ mutationFn: () => raceTimeout(api.closeProfitable()), onSuccess: (r: any) => { flash(r?.message || "Done."); toastSuccess(lang === "he" ? "הרווחים נסגרו" : "In-profit positions closed"); track("position_close", { op: "close_profit" }); }, onError: (e: any) => { fail(e); honestMoneyError(e, lang === "he" ? "סגירת הרווחים נכשלה" : "Couldn't close in-profit positions", lang, undefined, "close_profit"); } });
  const closeSpotM = useMutation({ mutationFn: () => raceTimeout(api.closeSpot()), onSuccess: (r: any) => { flash(r?.message || "Done."); if (r?.errors?.length) toastError(lang === "he" ? "חלק מהאחזקות לא נמכרו" : "Some holdings didn't sell", { body: lang === "he" ? `${r.errors.length} נכשלו. בדקו ונסו שוב.` : `${r.errors.length} failed. Check and try again.` }); else toastSuccess(lang === "he" ? "כל האחזקות נמכרו ל-USDT" : "All holdings closed to USDT"); track("position_close", { op: "close_all" }); ["exBalanceOv", "exPositionsOv", "tkPrices"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }, onError: (e: any) => { fail(e); honestMoneyError(e, lang === "he" ? "הסגירה ל-USDT נכשלה" : "Couldn't close to USDT", lang, undefined, "close_all"); } });
  const cleanDustM = useMutation({
    mutationFn: () => api.cleanDust(),
    onSuccess: (r: any) => {
      // Always refresh the balance/P&L views so the wallet reflects what moved.
      ["exBalanceOv", "exPositionsOv", "tkPrices", "livePnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      const he = lang === "he";
      // USDT = market-sold + Binance-Convert'd; BNB = native dust sweep. Count each
      // path separately so we tell the user EXACTLY what happened, never a vague "done".
      const toUsdt = (r?.closed || []).length + (r?.convertedUsdt || []).length;
      const toBnb = (r?.convertedBnb || []).length;
      const errs: any[] = r?.errors || [];
      const did = toUsdt + toBnb;
      if (did > 0) {
        // Real success → green. Spell out exactly what was cleared and how (USDT / BNB),
        // plus how many are left below the exchange minimum (with the manual fallback).
        const parts: string[] = [];
        if (toUsdt) parts.push(he ? `${toUsdt} הומרו ל-USDT` : `${toUsdt} converted to USDT`);
        if (toBnb) parts.push(he ? `${toBnb} נכבדו ל-BNB` : `${toBnb} swept to BNB`);
        let m = (he ? "אבק נוקה: " : "Dust cleaned: ") + parts.join(he ? " · " : ", ");
        if (errs.length) m += he
          ? ` · ${errs.length} נותרו (מתחת למינימום של הבורסה — המירו ידנית ב-Binance)`
          : ` · ${errs.length} left (below the exchange minimum — convert manually in Binance)`;
        flash(m);
      } else if (errs.length) {
        // Nothing moved but dust remains → LOUD & HONEST: name the reason the exchange
        // gave + the exact manual path, so it never reads as a dead button.
        const why = errs[0]?.message || errs[0]?.reason || "";
        fail(new Error(he
          ? `לא ניתן להמיר ${errs.length} יתרות זעירות — הן מתחת למינימום המסחר של Binance ולא זכאיות להמרה אוטומטית דרך ה-API${why ? ` (${why})` : ""}. המירו אותן ידנית באפליקציית Binance: ארנק → המרת יתרות קטנות (Convert Small Balances).`
          : `Couldn't convert ${errs.length} tiny balances — they're below Binance's minimum trade size and not eligible for automatic API conversion${why ? ` (${why})` : ""}. Convert them manually in the Binance app: Wallet → Convert Small Balances.`));
      } else {
        // Genuinely nothing to do.
        flash(r?.message || (he ? "לא נמצא אבק." : "No dust found."));
      }
    },
    onError: fail,
  });

  // ── Spot order placement (Long = buy · Sell = sell) ────────────────────────
  const qc = useQueryClient();
  const [pendingSide, setPendingSide] = useState<"" | "buy" | "sell">("");
  const [confirm, setConfirm] = useState<Omit<React.ComponentProps<typeof ConfirmModal>, "onClose"> | null>(null);
  // Branded PIN entry (replaces window.prompt) for the withdrawal PIN gate. Same
  // api.setPin → withdraw logic after; only the PIN UI changes.
  const { pinModal, requestPin } = usePinGate();
  const spotBalQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: saved, retry: false, refetchInterval: 30000 });
  const usdtFree = (b: any) => { const u = (b?.balances || []).find((x: any) => String(x.asset || "").toUpperCase() === "USDT"); return u ? Number(u.free) : 0; };
  const spotFree = usdtFree(spotBalQ.data);
  // Free balance of an arbitrary asset (for the withdraw amount cap). null = unknown.
  const freeOf = (asset: string): number | null => {
    const x = ((spotBalQ.data as any)?.balances || []).find((y: any) => String(y.asset || "").toUpperCase() === asset.toUpperCase());
    return x ? Number(x.free) : null;
  };
  // Withdraw amount guard: positive number, ≤ the free balance of the chosen asset
  // (when known). Server-side withdraw checks stay authoritative.
  const wAvail = freeOf(wcur);
  const wCheck = validateAmount(wamt, { lang, requirePositive: true, max: wAvail, maxKind: "balance" });
  const orderM = useMutation({
    onMutate: () => { toastPending(lang === "he" ? "פקודה ממתינה — נשלחת לבורסה…" : "Order pending — sending to the exchange…", "ex-order"); },
    mutationFn: (v: any) => raceTimeout(api.placeOrder(v)),
    onSuccess: (r: any) => {
      setPendingSide(""); dismissToast("ex-order");
      const ok = (r as any)?.ok !== false;
      if (ok) {
        flash((r as any)?.message || "Order placed — see your position below.");
        toastSuccess(lang === "he" ? "הפקודה בוצעה" : "Order placed");
        ["exBalanceOv", "exPositionsOv", "tkPrices"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        setTimeout(() => document.getElementById("algo770-order-ticket")?.scrollIntoView({ behavior: "smooth", block: "end" }), 350);
      } else { const raw = String((r as any)?.message || "Order failed."); fail(new Error(raw)); toastError(lang === "he" ? "הפקודה נדחתה" : "Order rejected", { body: mapExchangeError(raw, lang === "he").friendly }); }
    },
    onError: (e: any) => { setPendingSide(""); dismissToast("ex-order"); fail(e); honestMoneyError(e, lang === "he" ? "הפקודה נכשלה" : "The order failed", lang, undefined, "order"); },
  });
  const place = (side: "buy" | "sell") => {
    if (!order.symbol) return fail(new Error("Symbol required"));
    const he = lang === "he";
    const env = isLive ? t.liveReal : t.testnet;
    const baseC = String(order.symbol).split("/")[0];
    const pct = Number(order.pct) || 0;
    const slp = side === "buy" ? (Number(order.slPct) || 0) : 0;
    const tpp = side === "buy" ? (Number(order.tpPct) || 0) : 0;
    // est. USDT for a BUY = pct% of free USDT (when a live balance is known); a SELL
    // sells pct% of the held position, so no simple quote figure — show the percent.
    const estCost = side === "buy" && spotFree > 0 ? spotFree * (pct / 100) : 0;
    // Branded confirm gate (asset · side · amount · est. cost · SL) — replaces the plain
    // browser confirm. Same api.placeOrder call via orderM (PIN-gated) — ONLY the dialog changed.
    setConfirm({
      title: he ? `${side === "buy" ? "קנייה" : "מכירה"} — ${isLive ? "כסף אמיתי" : "טסטנט"}` : `${side === "buy" ? "Buy" : "Sell"} — ${isLive ? "real money" : "testnet"}`,
      intro: he ? `פקודת ${side === "buy" ? "קנייה" : "מכירה"} בשוק (Spot) בבורסה המחוברת.` : `Places a market ${side === "buy" ? "BUY" : "SELL"} order (spot) on your connected exchange.`,
      rows: [
        { label: he ? "נכס" : "Asset", value: order.symbol },
        { label: he ? "פעולה" : "Side", value: side === "buy" ? (he ? "קנייה (לונג)" : "Buy (long)") : (he ? "מכירה" : "Sell"), color: side === "buy" ? C.gain : C.loss },
        { label: he ? "כמות" : "Amount", value: `${pct}%`, color: C.gold },
        ...(estCost > 0 ? [{ label: he ? "עלות משוערת" : "Est. cost", value: `$${estCost.toFixed(2)}` }] : []),
        ...(slp ? [{ label: he ? "סטופ-לוס" : "Stop-loss", value: `−${slp}%`, color: C.loss }] : []),
        ...(tpp ? [{ label: he ? "טייק-פרופיט" : "Take-profit", value: `+${tpp}%`, color: C.gain }] : []),
        ...((slp && tpp) ? [{ label: he ? "הגנה" : "Protection", value: "OCO", color: C.gold }] : []),
        { label: he ? "סביבה" : "Environment", value: env },
      ],
      risk: isLive ? (he ? "כסף אמיתי — לא ניתן לבטל." : "Real money — cannot be undone.") : (he ? "סביבת בדיקות (טסטנט)." : "Testnet — practice environment."),
      confirmLabel: side === "buy" ? (he ? `קנה ${baseC}` : `Buy ${baseC}`) : (he ? `מכור ${baseC}` : `Sell ${baseC}`),
      tone: side === "buy" ? "gain" : "loss",
      onConfirm: async () => {
        setPendingSide(side);
        const r: any = await orderM.mutateAsync({ symbol: order.symbol, side, pct, orderType: "market", market: "spot", leverage: 1, stopLossPct: slp, takeProfitPct: tpp });
        if (r?.ok === false) throw new Error(r?.message || "");
      },
    });
  };
  const withdrawM = useMutation({
    onMutate: () => { toastPending(lang === "he" ? "משיכה ממתינה — נשלחת לבורסה…" : "Withdrawal pending — submitting…", "ex-withdraw"); },
    mutationFn: () => raceTimeout(api.withdraw({ currency: wcur.trim().toUpperCase(), amount: Number(wamt), address: waddr, tag: wtag.trim() || undefined, confirm: true })),
    onSuccess: (r: any) => { dismissToast("ex-withdraw"); if (r?.ok === false) { fail(new Error(r?.message || "Withdrawal failed.")); toastError(lang === "he" ? "המשיכה נדחתה" : "Withdrawal rejected", { body: (lang === "he" ? "הבורסה דחתה את המשיכה. " : "The exchange rejected the withdrawal. ") + String(r?.message || "") }); return; } flash(r?.message || "Withdrawal submitted."); toastSuccess(lang === "he" ? "בקשת המשיכה נשלחה" : "Withdrawal submitted"); setWamt(""); setWconfirm(""); },
    onError: (e: any) => { dismissToast("ex-withdraw"); fail(e); honestMoneyError(e, lang === "he" ? "המשיכה נכשלה" : "The withdrawal failed", lang, undefined, "withdraw"); },
  });

  function saveWhitelist() { const a = wEditAddr.trim(); if (!a) return; localStorage.setItem(WADDR_KEY, a); setWaddr(a); setWEditAddr(""); flash(t.saved); }
  function clearWhitelist() { localStorage.removeItem(WADDR_KEY); setWaddr(""); flash(t.saved); }
  async function submitWithdraw() {
    if (!waddr) return fail(new Error(w.needAddr));
    if (!(Number(wamt) > 0)) return fail(new Error("Enter an amount."));
    if (wconfirm !== "WITHDRAW") return;
    const envLabel = isLive ? t.liveReal : t.testnet;
    // NOTE: `confirm` is shadowed by the ConfirmModal state var above — call
    // window.confirm explicitly so this browser prompt actually fires.
    if (!window.confirm(`${w.withdraw}: ${wamt} ${wcur.toUpperCase()}\n${w.to}: ${waddr}\n(${envLabel})\n\n${isLive ? w.warnLive : ""}`)) return;
    if ((cfgQ.data as any)?.pinSet) {
      // Branded PIN modal (was window.prompt). Cancel = abort (no withdrawal).
      const pin = await requestPin({
        title: lang === "he" ? "הזן קוד אישור למשיכה" : "Enter your PIN to withdraw",
        intro: lang === "he" ? "הקוד מאבטח משיכת כספים אמיתיים מהבורסה המחוברת." : "Your PIN secures a real-money withdrawal from your connected exchange.",
        confirmLabel: lang === "he" ? "אשר משיכה" : "Confirm withdrawal",
      });
      if (!pin) return;
      api.setPin(pin);
    }
    withdrawM.mutate();
  }
  const loadBalance = async () => { try { setBalance(await api.balance()); } catch (e) { fail(e); } };


  return (
    <div className="ex-screen">
      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
      {pinModal}
      <TourLauncher screen="exchange" />
      {/* ── NON-SCROLL LAUNCHER (functions-as-buttons) ──────────────────────────────
          Top level fits ONE viewport: carved wordmark title + subtitle + editable
          shortcuts + 2 central glass buttons + the square-glass function grid. Every
          Exchange feature is a button that DRILLS INTO its own detail section (the
          existing xsec panels below) — no more sprawling scroll. ── */}
      {xsec === "" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Carved screen name inside Home's logo FRAME + the subtitle inside it. */}
          <FramedTitle text={he ? "בורסה" : "Exchange"} subtitle={accts.length
            ? (he ? `${accts.length} חשבונות מחוברים — לא-משמורתי` : `${accts.length} connected accounts — non-custodial`)
            : (he ? "חיבור בורסה — לא-משמורתי" : "Connect your exchange — non-custodial")} />
          {saved && (
            <div style={{ textAlign: "center" }}>
              <span data-tour="ex-status" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 12px", borderRadius: 999, background: isLive ? `${C.loss}29` : `${C.gold}24`, color: isLive ? C.loss : C.gold }}>
                {isLive && <AlertTriangle size={13} />} {isLive ? t.liveReal : t.testnet}
              </span>
            </div>
          )}

          {/* editable top shortcuts */}
          <ScreenShortcuts
            screenKey="exchange"
            defaultKeys={["funds", "trade", "withdraw", "connect"]}
            catalog={[
              { key: "funds", label: he ? "כספים" : "Funds", Icon: Wallet, onClick: () => setXsec("funds") },
              { key: "trade", label: he ? "מסחר" : "Trade", Icon: TrendingUp, onClick: () => setXsec("trade") },
              { key: "withdraw", label: he ? "משיכה" : "Withdraw", Icon: Banknote, onClick: () => setXsec("withdraw") },
              { key: "swap", label: he ? "החלף מפתחות" : "Swap keys", Icon: Repeat, onClick: () => setXsec("connect") },
              { key: "connect", label: he ? "חבר בורסה" : "Connect", Icon: KeyRound, onClick: () => setXsec("connect") },
              { key: "add", label: he ? "הוסף חשבון" : "Add account", Icon: Plus, onClick: () => { addNew(); setXsec("connect"); } },
            ]}
            onMore={() => setXsec("more")}
          />

          {/* 2 central glass buttons — Home's exact SQUARES (centered, primary bigger). Each
              NAVIGATES to its own child screen (never expands in place). */}
          <SquareRow screenKey="exchange-central" mobile={mobile} defaultShown={["connect", "new"]}
            squares={[
              { id: "connect", variant: "primary", Icon: KeyRound, tour: "ex-connect", label: he ? "חבר קיים" : "Connect existing", sub: he ? "מפתחות API" : "API keys", onClick: () => setXsec("connect") },
              { id: "new", variant: "secondary", Icon: Plus, label: he ? "פתח חדש" : "Open new", sub: he ? "חשבון בורסה" : "exchange", onClick: () => setXsec("new") },
              ...centralExtras(he, nav, { exclude: ["exchange"] }),
            ]} />
          {/* NOTE: the function grid is NOT crammed here (that caused the scroll) — every
              function opens as a CHILD screen, reached from the shortcuts row + the "עוד
              במערכת" chip (→ the "more" child below). The launcher stays one locked viewport. */}
        </div>
      )}

      {/* ── "עוד במערכת" CHILD — the full function grid as its own locked screen, with a
          ROWS ⇄ TILES view toggle (both layouts work; choice persists). ── */}
      {xsec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל פעולות הבורסה" : "All exchange functions"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="exchange-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "funds", label: he ? "כספים" : "Funds", Icon: Wallet, onClick: () => setXsec("funds") },
            { id: "table", label: he ? "טבלת מסחר" : "Trade table", Icon: TrendingUp, onClick: () => setXsec("trade") },
            { id: "withdraw", label: he ? "משיכה" : "Withdraw", Icon: Banknote, onClick: () => setXsec("withdraw") },
            { id: "accounts", label: he ? "חשבונות" : "Accounts", Icon: Layers, onClick: () => setXsec("connect") },
            { id: "exchanges", label: he ? "בורסות" : "Exchanges", Icon: Repeat, onClick: () => setXsec("new") },
            { id: "dust", label: he ? "נקה אבק" : "Clean dust", Icon: Wallet, onClick: () => setXsec("funds") },
            { id: "test", label: he ? "בדיקת חיבור" : "Test connection", Icon: RefreshCw, onClick: () => setXsec("connect") },
            { id: "balances", label: he ? "יתרות ופוזיציות" : "Balances & positions", Icon: Layers, onClick: () => setXsec("funds") },
            { id: "swap", label: he ? "החלף מפתחות" : "Swap keys", Icon: Repeat, onClick: () => setXsec("connect") },
          ]} />
        </div>
      )}

      {/* ── "Open new" drill-in — the exchange picker grid (pick → guide → connect form) ── */}
      {xsec === "new" && (
        <HubPanel alwaysOpen ns="exchange" id="new" title={he ? "פתח חשבון בורסה" : "Open an exchange account"} icon={<Plus size={15} />} onClose={() => setXsec("")}>
          <UsConnectInline rtl={rtl} />
          <ExchangeGrid accts={accts} lang={lang} onPick={(k) => setGuideEx(k)} onInfo={(k) => setInfoEx(k)} />
        </HubPanel>
      )}

      {err && <div style={errBox(C)}><ExchangeErrorText raw={err} color={C.loss} /></div>}
      {msg && <div style={okBox(C)}>{msg}</div>}

      {xsec === "connect" && (
      <HubPanel alwaysOpen ns="exchange" id="connect" title={t.connection} icon={<ShieldCheck size={15} />} onClose={() => setXsec("")}>
        <div id="algo770-ex-connect-top" />
        {/* Inline US-connectivity notice — top of the connect flow (written text, flag-gated). */}
        <UsConnectInline rtl={rtl} />
        <p style={{ display: "flex", alignItems: "center", gap: 7, color: C.muted, fontSize: 12.5, margin: "0 0 14px", lineHeight: 1.5 }}>
          <ShieldCheck size={14} color={C.gain} style={{ flexShrink: 0 }} /> {NOTE[lang]}
        </p>
        {/* connected accounts — one tidy line each (name · exchange · start date · funds · P&L); + to add more */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {accts.map((a, idx) => {
            const on = editingId === a.id; const d = dataFor(a.id); const pnl = d?.pnl ?? 0; const pnlPct = d?.pct ?? null;
            return (
              <button key={a.id} onClick={() => selectAccount(a)} title={a.label}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start", cursor: "pointer", fontFamily: "inherit",
                  background: on ? `${C.gold}1f` : C.surface2, border: `1px solid ${on ? C.gold : C.line}`, borderRadius: 12, padding: "10px 12px", color: C.text }}>
                <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 8, background: `linear-gradient(140deg, ${C.gold}, ${a.env === "live" ? C.loss : C.blue})`, color: "#fff", fontWeight: 900, fontSize: 11.5, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: C.muted }}>{String(a.name || "exchange").toUpperCase()} · {a.env === "live" ? "LIVE" : "TEST"} · {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</span>
                </span>
                <span style={{ textAlign: "end", flexShrink: 0 }}>
                  <span style={{ display: "block", fontFamily: MONO, fontWeight: 800, fontSize: 13 }}>{d?.ok ? fmtUSD(d.value) : (acctPnlQ.isLoading ? "…" : "—")}</span>
                  <span style={{ display: "block", fontFamily: MONO, fontSize: 11, color: pnl >= 0 ? C.gain : C.loss }}>{d?.ok ? `${pnl >= 0 ? "+" : "-"}$${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}${pnlPct != null ? ` (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)` : ""}` : ""}</span>
                </span>
              </button>
            );
          })}
          <button onClick={addNew} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: `${C.gold}14`, border: `1px dashed ${C.gold}80`, color: C.gold, borderRadius: 12, padding: "11px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            <Plus size={16} /> {lang === "he" ? "הוסף חשבון" : "Add account"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.faint, margin: "0 0 12px" }}>{editingId ? (lang === "he" ? "עורך חשבון שמור — השאירו מפתחות ריקים כדי לשמור אותם." : "Editing a saved account — leave keys blank to keep them.") : (lang === "he" ? `הוספת חשבון חדש · עד ${ACCOUNT_LIMIT}${isAdmin() ? " (מנהל: ללא הגבלה)" : ""}` : `Adding a new account · up to ${ACCOUNT_LIMIT}${isAdmin() ? " (admin: unlimited)" : ""}`)}</div>
        <div style={grid()}>
          <Field label={lang === "he" ? "שם החשבון" : "Account name"}><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={lang === "he" ? "למשל: ראשי / חיסכון" : "e.g. Main / Savings"} style={input(C)} /></Field>
          <Field label={t.broker}><select value={exchange} onChange={(e) => setExchange(e.target.value)} style={input(C)}>{supported.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
          <Field label={lang === "he" ? "סביבה" : "Environment"}><select value={environment} onChange={(e) => setEnvironment(e.target.value)} style={{ ...input(C), borderColor: environment === "live" ? C.loss : undefined }}><option value="testnet">{t.testnet}</option><option value="live">{t.liveReal}</option></select></Field>
          <Field label={`${t.apiKey} ${saved ? "✓" : ""}`}><input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={saved ? "••••••••" : ""} style={input(C)} /></Field>
          <Field label={`${t.apiSecret} ${saved ? "✓" : ""}`}><PasswordInput value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder={saved ? "••••••••" : ""} style={input(C)} /></Field>
          <Field label={t.passphrase}><PasswordInput value={apiPassphrase} onChange={(e) => setApiPassphrase(e.target.value)} style={input(C)} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button onClick={saveKeys} className="gbtn ptile" style={btn(C, true)}><Save size={15} /> {t.save}</button>
          <button onClick={() => test.mutate()} disabled={test.isPending || !saved} style={btn(C)}>{test.isPending ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {t.testConn}</button>
          {saved && <button onClick={clearKeys} style={{ ...btn(C), color: C.loss, borderColor: "rgba(240,97,109,0.4)" }}><Trash2 size={14} /> {editingId ? (lang === "he" ? "מחק חשבון" : "Remove account") : CLEAR[lang]}</button>}
        </div>
        {environment === "live" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, background: `${C.loss}1f`, border: `1px solid ${C.loss}73`, color: C.loss, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, fontWeight: 600 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            {lang === "he" ? "מצב חי — פקודות יתבצעו על הכסף האמיתי שלך בבורסה. מומלץ להתחיל ב-Testnet." : "Live mode — orders execute against your real funds on the exchange. Start on Testnet first."}
          </div>
        )}
        {/* Feature-enablement toggles — mark which tools use this account (per the mockup).
            Real LIVE activation stays in each feature's own screen; this is a per-account
            preference only (no money/order logic). */}
        <AccountFeatureToggles accountId={editingId} lang={lang} />
      </HubPanel>
      )}

      {xsec === "funds" && (
      <HubPanel alwaysOpen ns="exchange" id="funds" title={lang === "he" ? "כספים" : "Funds"} icon={<Wallet size={15} />} onClose={() => setXsec("")}>
        <FundsOverview saved={saved} isLive={isLive} exchange={exchange} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          <Card C={C} title={t.balance} action={<button onClick={() => ["exBalanceOv", "livePnl"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))} disabled={!saved} style={btn(C)}><RefreshCw size={15} /> {t.load}</button>}>
            <LiveBalances saved={saved} />
          </Card>
          <div id="algo770-ex-positions" />
          <Card C={C} title={t.positions}>
            <LivePositions saved={saved} onPlace={(sym, side) => {
              setOrder((o) => ({ ...o, symbol: sym, side, pct: 100 })); setXsec("trade");
              setTimeout(() => document.getElementById("algo770-order-ticket")?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
            }} />
          </Card>
        </div>
        {/* Clean dust: clear sub-$5 leftovers. What can be sold goes to USDT; the rest
            (below the exchange minimum) is swept to BNB via Binance's native dust
            convert. Real money — confirm first; we build the call, the user fires it. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14, alignItems: "center" }}>
          <button data-tour="ex-dust"
            onClick={() => { if (window.confirm(lang === "he" ? "לנקות יתרות אבק (< $5)? מה שניתן יימכר ל-USDT, והשאר (מתחת למינימום הבורסה) יומר ל-BNB. כסף אמיתי." : "Clean dust (< $5)? What can be sold goes to USDT; the rest (below the exchange minimum) is converted to BNB. Real money.")) cleanDustM.mutate(); }}
            disabled={cleanDustM.isPending || !saved}
            title={lang === "he" ? "מנקה רק יתרות קטנות מתחת ל-$5 שאינן USDT — מכירה ל-USDT או המרה ל-BNB" : "Clears only sub-$5 non-USDT leftovers — sells to USDT or converts to BNB"}
            style={{ ...btn(C), color: C.gold, borderColor: "rgba(240,179,71,0.4)" }}>
            {cleanDustM.isPending ? <Loader2 size={14} className="spin" /> : <Wallet size={14} />} {lang === "he" ? "נקה אבק" : "Clean dust"}
          </button>
          <span style={{ fontSize: 11.5, color: C.faint }}>{lang === "he" ? "יתרות קטנות (< $5) → USDT, או המרה ל-BNB אם מתחת למינימום" : "small leftovers (< $5) → USDT, or converted to BNB if below the minimum"}</span>
        </div>
      </HubPanel>
      )}

      {xsec === "trade" && (
      <HubPanel alwaysOpen ns="exchange" id="trade" title={t.placeOrder} icon={<TrendingUp size={15} />} onClose={() => setXsec("")}>
      <div id="algo770-order-ticket">
        {/* symbol picker — choose from app symbols or type your own */}
        <Field label={t.symbol}>
          <input list="algo770-symlist" value={order.symbol} onChange={(e) => setOrder({ ...order, symbol: e.target.value })} placeholder="BTC/USDT" style={input(C)} />
          <datalist id="algo770-symlist">{symList.map((s: any) => <option key={s.symbol} value={s.symbol}>{s.name}</option>)}</datalist>
        </Field>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>{liveSyms.length ? (lang === "he" ? `בחרו מתוך ${liveSyms.length} סמלים מהבורסה שלכם` : `Pick from ${liveSyms.length} live symbols on your exchange`) : (lang === "he" ? "בחרו מהרשימה או הקלידו סמל" : "Pick from the list or type a symbol")}</div>

        {/* available to trade (spot) */}
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>{lang === "he" ? "זמין למסחר (ספוט)" : "Available to trade (spot)"}: {fmtUSD(spotFree)}</div>

        {/* size slider — drag left/right */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: C.muted }}>{lang === "he" ? "גודל (% מהזמין)" : "Size (% of available)"}</span>
            <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 22, color: C.gold }}>{Number(order.pct) || 0}%</span>
          </div>
          <input type="range" min={1} max={100} value={Number(order.pct) || 0} onChange={(e) => setOrder({ ...order, pct: Number(e.target.value) as any })} style={{ width: "100%", marginTop: 10, accentColor: C.gold }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {[10, 25, 50, 75, 100].map((v) => <button key={v} onClick={() => setOrder({ ...order, pct: v as any })} style={chipBtn(Number(order.pct) === v)}>{v === 100 ? (lang === "he" ? "הכל 100%" : "Max 100%") : v + "%"}</button>)}
          </div>
        </div>

        {/* Stop-loss % — on a LONG (buy) we also place a native protective stop on the exchange */}
        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.muted }}>{lang === "he" ? "סטופ-לוס (% מתחת לכניסה, ללונג)" : "Stop-loss (% below entry, for Long)"}</span>
          <input type="number" min={0} max={90} value={order.slPct || ""} onChange={(e) => setOrder({ ...order, slPct: Number(e.target.value) || 0 })} placeholder="0" style={{ ...input(C), width: 90 }} />
          <span style={{ fontSize: 11.5, color: C.faint }}>{lang === "he" ? "0 = ללא · מציב פקודת סטופ אמיתית בבורסה" : "0 = none · places a real stop order on the exchange"}</span>
        </div>

        {/* Take-profit % — on a LONG (buy) it pairs with the stop as a native OCO on the exchange */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: C.muted }}>{lang === "he" ? "טייק-פרופיט (% מעל הכניסה, ללונג)" : "Take-profit (% above entry, for Long)"}</span>
          <input type="number" min={0} max={500} value={order.tpPct || ""} onChange={(e) => setOrder({ ...order, tpPct: Number(e.target.value) || 0 })} placeholder="0" style={{ ...input(C), width: 90 }} />
          <span style={{ fontSize: 11.5, color: C.faint }}>{lang === "he" ? "0 = ללא · עם סטופ יחד = OCO אמיתי בבורסה" : "0 = none · together with a stop = a real exchange OCO"}</span>
        </div>

        {/* Long (buy) / Sell — spot, place immediately */}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={() => place("buy")} disabled={!saved || orderM.isPending} className="gbtn gbtn-gain ptile" style={{ ...sideBtn(true, C.gain), opacity: !saved || (orderM.isPending && pendingSide !== "buy") ? 0.5 : 1 }}>
            {pendingSide === "buy" ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />} {lang === "he" ? "לונג (קנייה)" : "Long (buy)"} {Number(order.pct) || 0}%
          </button>
          <button onClick={() => place("sell")} disabled={!saved || orderM.isPending} className="gbtn gbtn-loss ptile" style={{ ...sideBtn(true, C.loss), opacity: !saved || (orderM.isPending && pendingSide !== "sell") ? 0.5 : 1 }}>
            {pendingSide === "sell" ? <Loader2 size={16} className="spin" /> : <ArrowDown size={16} />} {lang === "he" ? "מכירה" : "Sell"} {Number(order.pct) || 0}%
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>{lang === "he" ? "לחיצה מבצעת פקודת ספוט מיד (אחרי אישור). לונג = קנייה · מכירה = מכירת האחזקה." : "Tapping places a spot order immediately (after you confirm). Long = buy · Sell = sell your holding."}</div>

        {/* opened position(s) + live P&L, right below the buttons */}
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted, marginBottom: 8 }}>
            {lang === "he" ? "הפוזיציות שלך · רווח/הפסד חי" : "Your positions · live P&L"} {orderM.isPending && <Loader2 size={12} className="spin" />}
          </div>
          <LivePositions saved={saved} onPlace={(sym) => setOrder((o) => ({ ...o, symbol: sym, pct: 100 }))} />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={() => { if (window.confirm(lang === "he" ? "למכור את כל האחזקות חזרה ל-USDT? סוגר את כל הפוזיציות." : "Sell all holdings back to USDT? This fully closes every spot position.")) closeSpotM.mutate(); }} disabled={closeSpotM.isPending || !saved} style={{ ...btn(C), color: C.loss, borderColor: "rgba(240,97,109,0.4)" }}>{closeSpotM.isPending ? <Loader2 size={14} className="spin" /> : null} {lang === "he" ? "סגור הכל → USDT" : "Close all → USDT"}</button>
        </div>
        {!saved && <div style={{ fontSize: 12, color: C.gold, marginTop: 10 }}>{lang === "he" ? "חברו בורסה למעלה כדי לסחור" : "Connect an exchange above to trade"}</div>}
      </div>
      </HubPanel>
      )}

      {xsec === "withdraw" && (
      <HubPanel alwaysOpen ns="exchange" id="withdraw" title={w.title} icon={<Banknote size={15} />} onClose={() => setXsec("")}>
        <p style={{ display: "flex", alignItems: "flex-start", gap: 7, color: C.muted, fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>
          <ShieldCheck size={14} color={C.gain} style={{ flexShrink: 0, marginTop: 2 }} /> {w.note}
        </p>
        {isLive && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, background: `${C.loss}1f`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "8px 11px", fontSize: 12.5, marginBottom: 12 }}>
            <AlertTriangle size={14} /> {w.warnLive}
          </div>
        )}

        {/* whitelisted address */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>{w.whitelist}</div>
          {waddr ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <code style={{ flex: 1, minWidth: 200, fontFamily: MONO, fontSize: 12.5, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", overflowX: "auto", whiteSpace: "nowrap" }}>{waddr}</code>
              <button onClick={clearWhitelist} style={{ ...btn(C), color: C.loss, borderColor: "rgba(240,97,109,0.4)" }}><Trash2 size={14} /> {w.clear}</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={wEditAddr} onChange={(e) => setWEditAddr(e.target.value)} placeholder="0x… / bc1… / T…" style={{ ...input(C), fontFamily: MONO, flex: 1, minWidth: 220 }} />
              <button onClick={saveWhitelist} disabled={!wEditAddr.trim()} style={btn(C)}><Save size={14} /> {w.setAddr}</button>
            </div>
          )}
        </div>

        <div style={grid()}>
          <Field label={w.currency}><input value={wcur} onChange={(e) => setWcur(e.target.value)} placeholder="USDT" style={input(C)} /></Field>
          <Field label={w.amount}>
            <input type="number" value={wamt} onChange={(e) => setWamt(e.target.value)}
              aria-invalid={wamt.trim() !== "" && !wCheck.ok} aria-describedby={wamt.trim() !== "" && !wCheck.ok ? "wd-amt-err" : undefined}
              style={{ ...input(C), borderColor: (wamt.trim() !== "" && !wCheck.ok) ? C.loss : undefined }} />
            {wamt.trim() !== "" && !wCheck.ok && <FieldError id="wd-amt-err" message={wCheck.message} />}
            {wAvail != null && <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4 }}>{lang === "he" ? "זמין" : "Available"}: {wAvail} {wcur.toUpperCase()}</div>}
          </Field>
          <Field label={w.tag}><input value={wtag} onChange={(e) => setWtag(e.target.value)} style={input(C)} /></Field>
          <Field label={w.typeConfirm}><input value={wconfirm} onChange={(e) => setWconfirm(e.target.value)} placeholder="WITHDRAW" style={{ ...input(C), fontFamily: MONO }} /></Field>
        </div>
        <button onClick={submitWithdraw}
          disabled={withdrawM.isPending || !saved || !waddr || !wCheck.ok || wconfirm !== "WITHDRAW"}
          className={isLive ? "gbtn gbtn-loss ptile" : "gbtn ptile"} style={{ ...btn(C, true), marginTop: 12, opacity: (withdrawM.isPending || !saved || !waddr || !wCheck.ok || wconfirm !== "WITHDRAW") ? 0.6 : 1 }}>
          {withdrawM.isPending ? <Loader2 size={15} className="spin" /> : <Banknote size={15} />} {w.withdraw}
        </button>
      </HubPanel>
      )}
      {guideEx && (
        <ExchangeConnectGuide
          exKey={guideEx}
          lang={lang}
          rtl={rtl}
          onClose={() => setGuideEx(null)}
          onConnect={() => connectExchange(guideEx)}
        />
      )}
      {infoEx && (
        <ExchangeInfo
          exKey={infoEx}
          lang={lang}
          rtl={rtl}
          onClose={() => setInfoEx(null)}
          onConnect={() => { const k = infoEx; setInfoEx(null); setGuideEx(k); }}
        />
      )}
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
      <Spin />
    </div>
  );
}

/* ── Funds overview: visual dashboard of where the money is ── */
const fmtUSD = (n: number | null) =>
  (n == null || isNaN(n as number)) ? "—" : "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

function FundsOverview({ saved, isLive, exchange }: { saved: boolean; isLive: boolean; exchange: string }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const balQ = useQuery({ queryKey: ["exBalanceOv"], queryFn: () => api.balance(), enabled: saved, retry: false, refetchInterval: 30000 });
  const posQ = useQuery({ queryKey: ["exPositionsOv"], queryFn: () => api.positions(), enabled: saved, retry: false, refetchInterval: 30000 });
  const ovPnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: saved, retry: false, refetchInterval: 30000 });
  const liveCount = (ovPnlQ.data as any)?.ok && (ovPnlQ.data as any).count != null ? Number((ovPnlQ.data as any).count) : null;  // non-dust
  const sessQ = useQuery({ queryKey: ["paperSessions"], queryFn: () => api.paperSessions(), refetchInterval: 30000 });

  if (!saved) {
    return (
      <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 16, textAlign: "center", color: C.muted, fontSize: 13 }}>
        {he ? "חברו את הבורסה למטה כדי לראות את הכספים שלכם." : "Connect your exchange below to see your funds at a glance."}
      </div>
    );
  }

  const bal: any = balQ.data;
  const usdt = (bal?.balances || []).find((b: any) => String(b.asset || "").toUpperCase() === "USDT");
  const totalFunds = usdt ? Number(usdt.total) : (bal?.ok ? 0 : null);
  const available = usdt ? Number(usdt.free) : null;
  const otherAssets = (bal?.balances || []).filter((b: any) => String(b.asset || "").toUpperCase() !== "USDT" && Number(b.total) > 0).length;

  const pos: any = posQ.data;
  const posOk = !!pos?.ok;
  const posCount = posOk ? (pos.positions || []).length : null;
  const posUnreal = posOk ? Number(pos.totalUnrealized || 0) : null;

  const sessions: any[] = (sessQ.data as any)?.sessions || [];
  const running = sessions.filter((s) => s.status === "running");
  const botCapital = running.reduce((a, s) => a + Number(s.capital || 0), 0);

  const ok = C.gain;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
        background: `${ok}14`, border: `1px solid ${ok}55`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 800, color: ok, fontSize: 14 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: ok, animation: "fundpulse 1.8s infinite" }} />
          {he ? "מחובר" : "Connected"} · {String(exchange).toUpperCase()}
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 8,
          background: isLive ? `${C.loss}29` : `${C.gold}29`, color: isLive ? C.loss : C.gold }}>
          {isLive ? (he ? "חי · כסף אמיתי" : "LIVE · real money") : "TESTNET"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Metric label={he ? "סך הכספים (USDT)" : "Total funds (USDT)"} value={fmtUSD(totalFunds)} sub={otherAssets ? `+${otherAssets} ${he ? "נכסים" : "more assets"}` : undefined} loading={balQ.isLoading} />
        <Metric label={he ? "זמין למסחר" : "Available"} value={fmtUSD(available)} loading={balQ.isLoading} color={ok} />
        <Metric label={he ? "בפוזיציות" : "In positions"}
          value={posOk && posCount ? String(posCount) : (liveCount != null ? String(liveCount) : (otherAssets ? `${otherAssets} ${he ? "אחזקות" : "holdings"}` : (he ? "אין" : "none")))}
          sub={posOk && posCount ? `${he ? "לא ממומש" : "uPnL"} ${fmtUSD(posUnreal)}` : ((liveCount != null ? liveCount : otherAssets) ? (he ? "אחזקות ספוט" : "spot assets") : (he ? "אין פוזיציות פתוחות" : "no open positions"))}
          loading={posQ.isLoading || balQ.isLoading} color={posOk && posUnreal != null && posUnreal < 0 ? C.loss : undefined} />
        <Metric label={he ? "בריצות בוט (דמו)" : "In bot runs (demo)"} value={running.length ? fmtUSD(botCapital) : "0"} sub={running.length ? `${running.length} ${he ? "פעילות" : "running"}` : undefined} loading={sessQ.isLoading} />
      </div>
      <style>{"@keyframes fundpulse{0%{box-shadow:0 0 0 0 rgba(14,158,99,.5)}70%{box-shadow:0 0 0 8px rgba(14,158,99,0)}100%{box-shadow:0 0 0 0 rgba(14,158,99,0)}}"}</style>
    </div>
  );
}

// Per-account feature-enablement toggles (mockup's connect-flow feature group). Marks
// which tools use this connected account; persisted per (account, feature) in localStorage
// so a feature's own screen / settings can read it. This is a PREFERENCE layer only —
// the real LIVE-enable gate + money/order logic live untouched in each feature's screen.
function AccountFeatureToggles({ accountId, lang }: { accountId: string | null; lang: string }) {
  const he = lang === "he";
  const FEATS = [
    { key: "profit", label: he ? "מנוע רווח" : "Profit Engine", Icon: Cpu },
    { key: "signal", label: he ? "סיגנל בוט" : "Signal Bot", Icon: Radio },
    { key: "pilots", label: he ? "טייסים אוטומטיים" : "Auto Pilots", Icon: Bot },
  ];
  const skey = (f: string) => `algo770_acctfeature_${accountId || "default"}_${f}`;
  const [on, setOn] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const f of FEATS) { try { o[f.key] = localStorage.getItem(skey(f.key)) === "1"; } catch { o[f.key] = false; } }
    return o;
  });
  const toggle = (f: string) => setOn((p) => { const v = !p[f]; try { localStorage.setItem(skey(f), v ? "1" : "0"); } catch { /* */ } return { ...p, [f]: v }; });
  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 4 }}>{he ? "הפעלת החשבון על פיצ'רים" : "Enable this account on features"}</div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.4 }}>{he ? "בחרו היכן ישמש החשבון. הפעלת LIVE אמיתית נעשית במסך הפיצ'ר עצמו." : "Choose where this account is used. Real LIVE activation is done in the feature's own screen."}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {FEATS.map((f) => (
          <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface2, border: `1px solid ${on[f.key] ? C.gold : C.line}`, borderRadius: 12, padding: "10px 12px" }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: C.surface, color: C.gold, flexShrink: 0 }}><f.Icon size={16} /></span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{f.label}</span>
            <button onClick={() => toggle(f.key)} role="switch" aria-checked={on[f.key]} aria-label={f.label} className="tap44"
              style={{ width: 44, height: 26, borderRadius: 999, border: "none", cursor: "pointer", position: "relative", flexShrink: 0, background: on[f.key] ? C.gold : C.line, transition: "background .2s" }}>
              <span style={{ position: "absolute", top: 3, insetInlineStart: on[f.key] ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "inset-inline-start .2s" }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, loading, color }: { label: string; value: string; sub?: string; loading?: boolean; color?: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), " + SHADOW }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: color || C.text, fontFamily: MONO }}>{loading ? "…" : value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ── shared bits ── */
const pretty = (o: any) => { try { return JSON.stringify(o, null, 2); } catch { return String(o); } };
const grid = (): React.CSSProperties => ({ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 });
const input = (C: any): React.CSSProperties => ({ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", color: C.text, fontSize: 14, fontFamily: UI, outline: "none", width: "100%" });
// Premium button — primary = skin-accent fill, secondary = a soft surface gradient,
// both with the tile-family radius (14), a 1.5px border and gentle depth (inner top
// highlight + soft drop). Destructive callers spread `{ color, borderColor }` after,
// which still wins. whiteSpace:nowrap keeps EN/HE labels ("Clear keys from this
// browser" / "מחק מפתחות מהדפדפן", "Close all → USDT") on one centered line.
const btn = (C: any, primary = false): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap",
  background: primary ? "var(--btn-bg)" : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
  border: `1.5px solid ${primary ? "var(--btn-bd)" : C.line}`, color: primary ? "var(--btn-ink)" : C.text,
  borderRadius: 14, padding: "9px 15px", fontSize: 13, fontFamily: UI, fontWeight: primary ? 800 : 700, cursor: "pointer",
  boxShadow: primary
    ? "inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -10px 20px -14px rgba(0,0,0,0.32), 0 9px 22px -13px rgba(0,0,0,0.32)"
    : "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -12px rgba(0,0,0,0.32)",
});
const sideBtn = (on: boolean, accent: string): React.CSSProperties => ({ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap", background: on ? accent : C.surface2, border: `1.5px solid ${on ? accent : C.line}`, color: on ? onAccent(accent) : C.text, borderRadius: 14, padding: "11px 12px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: UI });
const chipBtn = (on: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap",
  background: on ? "var(--btn-bg)" : `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
  border: `1.5px solid ${on ? C.gold : C.line}`, color: on ? "var(--btn-ink)" : C.muted,
  borderRadius: 10, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: UI,
  boxShadow: on ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px -12px rgba(0,0,0,0.35)" : "inset 0 1px 0 rgba(255,255,255,0.22)",
});
const raw = (C: any): React.CSSProperties => ({ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 9, padding: 12, fontSize: 12, color: C.muted, overflowX: "auto", maxHeight: 240, marginTop: 10, fontFamily: MONO });
const errBox = (C: any): React.CSSProperties => ({ background: `${C.loss}1f`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 12, fontFamily: MONO });
const okBox = (C: any): React.CSSProperties => ({ background: `${C.gold}1a`, border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 9, padding: "9px 12px", fontSize: 13, marginBottom: 12 });
function Field({ label, children }: any) { return <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={{ fontSize: 12, color: C.muted }}>{label}</span>{children}</label>; }
function Card({ C, title, icon, action, children }: any) {
  return <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), " + SHADOW }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 600 }}>{icon}{title}</div>{action}
    </div>{children}</div>;
}
const Spin = () => <style>{".spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"}</style>;

/* ── Exchange connect grid ──────────────────────────────────────────────────────
   The supported set MIRRORS the Signal Bot create flow (binance · bybit · coinbase)
   — the exchanges we can ACTUALLY connect & trade. Crypto.com isn't wired yet, so it
   shows a non-clickable "Soon" tile (no dead connect button). Tapping a supported
   tile opens short sub-account / trade-only-key guidance, which then reveals the
   EXISTING connect form below — we never build a second key-entry path. Skinned via
   C.*, bilingual HE/EN, RTL-safe (logical props + direction-agnostic grid), 44px taps,
   wraps to 2-up on narrow screens and stays centered. */
type ExTile = { key: string; name: string; mark: string; from: string; to: string; ink: string; signup: string; blurb: { he: string; en: string } };
const EX_SUPPORTED: ExTile[] = [
  { key: "binance", name: "Binance", mark: "B", from: "#F8D12F", to: "#E0A406", ink: "#1c1500",
    signup: "https://www.binance.com/en/register",
    blurb: { he: "בורסת הקריפטו הגדולה בעולם לפי נפח מסחר — מבחר עצום של מטבעות ונזילות גבוהה.", en: "The world's largest crypto exchange by volume — a huge selection of coins and deep liquidity." } },
  { key: "bybit", name: "Bybit", mark: "BY", from: "#FFCB45", to: "#F7A600", ink: "#1c1300",
    signup: "https://www.bybit.com/register",
    blurb: { he: "בורסה פופולרית לספוט ולנגזרים, עם עמלות נמוכות וממשק מהיר.", en: "A popular spot & derivatives exchange with low fees and a fast interface." } },
  { key: "coinbase", name: "Coinbase", mark: "C", from: "#4C84FF", to: "#0052FF", ink: "#ffffff",
    signup: "https://www.coinbase.com/signup",
    blurb: { he: "בורסה אמריקאית מוסדרת וידידותית למתחילים — קלה לפתיחת חשבון ולרכישה ראשונה.", en: "A regulated, beginner-friendly US exchange — easy to open an account and make your first buy." } },
];
const EX_SOON: ExTile[] = [
  { key: "cryptocom", name: "Crypto.com", mark: "C", from: "#1b3f73", to: "#0a2540", ink: "#ffffff",
    signup: "https://crypto.com/exchange",
    blurb: { he: "בורסה גלובלית עם אפליקציה פופולרית — חיבור כאן יתווסף בקרוב.", en: "A global exchange with a popular app — connecting here is coming soon." } },
];
const EX_ALL = [...EX_SUPPORTED, ...EX_SOON];

/* Per-exchange action buttons in the connect grid — matched to the app's button
   language: primary = skin-accent fill (var(--btn-*)), secondary = soft surface
   gradient. Full-width, ~44px tap targets, bilingual (Hebrew label + small LTR
   English line). These replace the old inert "Connect" status pill (a <span> that
   only worked because the whole tile was a button that merely opened a modal). */
const exTileBtnPrimary: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", boxSizing: "border-box",
  minHeight: 44, padding: "7px 12px", borderRadius: 12, cursor: "pointer",
  background: "var(--btn-bg)", color: "var(--btn-ink)", border: "1.5px solid var(--btn-bd)",
  fontFamily: UI, fontWeight: 800, fontSize: 13,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 8px 20px -14px rgba(0,0,0,0.42)",
};
const exTileBtnSecondary: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", boxSizing: "border-box",
  minHeight: 44, padding: "7px 12px", borderRadius: 12, cursor: "pointer", textDecoration: "none",
  background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, color: C.text,
  border: `1.5px solid ${C.line}`, fontFamily: UI, fontWeight: 700, fontSize: 13,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)",
};
const exTileBtnCol: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.12, minWidth: 0 };
const exTileBtnSub: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, opacity: 0.7, marginTop: 1 };
const exTileGhostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  minHeight: 34, padding: "5px 12px", borderRadius: 10, cursor: "pointer",
  background: C.surface2, border: `1px solid ${C.line}`, color: C.muted,
  fontFamily: UI, fontWeight: 700, fontSize: 11.5,
};

function ExchangeGrid({ accts, lang, onPick, onInfo }: { accts: any[]; lang: string; onPick: (key: string) => void; onInfo: (key: string) => void }) {
  const he = lang === "he";
  const connected = new Set(accts.map((a) => String(a.name || "").toLowerCase()));

  // Small "i" in each tile's top corner — opens a short blurb + that exchange's signup
  // link. role=button (not a real <button>) so it can live inside the supported tile's
  // <button> without nesting interactive elements; stopPropagation keeps the tile's own
  // connect tap from firing. RTL-safe via insetInlineEnd.
  const infoChip = (x: ExTile) => (
    <span role="button" tabIndex={0}
      aria-label={he ? `מידע והרשמה — ${x.name}` : `Info & signup — ${x.name}`}
      title={he ? `מידע ולינק הרשמה — ${x.name}` : `Info & signup link — ${x.name}`}
      onClick={(e) => { e.stopPropagation(); onInfo(x.key); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onInfo(x.key); } }}
      style={{ position: "absolute", top: 8, insetInlineEnd: 8, width: 26, height: 26, borderRadius: 999, zIndex: 2,
        display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        background: C.surface2, border: `1px solid ${C.line}`, color: C.muted }}>
      <Info size={14} />
    </span>
  );

  const tile = (x: ExTile, soon: boolean) => {
    const isOn = connected.has(x.key);
    // The tile is a plain container (NOT a button) so the real, individually-wired
    // action buttons below can live inside it without nesting interactive elements.
    const base: React.CSSProperties = {
      position: "relative",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
      minHeight: 126, padding: "16px 12px 14px", borderRadius: 16, fontFamily: UI, width: "100%", boxSizing: "border-box",
      background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`,
      border: `1px solid ${soon ? C.line : isOn ? `${C.gain}55` : C.goldDim}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), " + SHADOW,
      opacity: soon ? 0.72 : 1,
    };
    return (
      <div key={x.key} className="ex-tile" style={base}
        {...(soon ? { "aria-disabled": true, title: he ? "בקרוב — עדיין לא נתמך לחיבור" : "Coming soon — not yet supported for connecting" } : {})}>
        {infoChip(x)}
        <span className="ex-tile-mark" style={{ width: 46, height: 46, flexShrink: 0, borderRadius: 14, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: `linear-gradient(150deg, ${x.from}, ${x.to})`, color: x.ink, fontWeight: 900, fontSize: x.mark.length > 1 ? 15 : 19,
          letterSpacing: x.mark.length > 1 ? "0.02em" : 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), 0 6px 16px -10px rgba(0,0,0,0.55)",
          filter: soon ? "grayscale(0.4)" : undefined }}>{x.mark}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, textAlign: "center" }}>{x.name}</span>

        {soon ? (
          /* Not wired yet — a plain disabled "Soon" badge, no action buttons. */
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap",
            color: C.muted, background: C.surface2, border: `1px solid ${C.line}` }}>{he ? "בקרוב" : "Soon"}</span>
        ) : isOn ? (
          /* Connected — keep the ✓ badge; offer a subtle "replace keys" (reuses the
             existing connect flow), but NOT the two connect buttons. */
          <>
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, whiteSpace: "nowrap",
              color: C.gain, background: `${C.gain}1c`, border: `1px solid ${C.gain}55` }}>{he ? "מחובר ✓" : "Connected ✓"}</span>
            <button type="button" onClick={() => onPick(x.key)} className="tap44"
              aria-label={he ? `החלף מפתחות — ${x.name}` : `Manage keys — ${x.name}`} style={exTileGhostBtn}>
              <KeyRound size={13} style={{ flexShrink: 0 }} /> {he ? "החלף מפתחות" : "Manage keys"}
            </button>
          </>
        ) : (
          /* Available — two clear, individually-wired tap targets:
             חבר קיים      → the existing connect / API-key flow (onPick → guide → form)
             פתח חשבון חדש → the exchange's official signup page (new tab, noopener). */
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", marginTop: 2 }}>
            <button type="button" onClick={() => onPick(x.key)} className="gbtn ptile tap44"
              aria-label={he ? `חבר חשבון קיים ב-${x.name} דרך מפתחות API` : `Connect an existing ${x.name} account via API keys`}
              style={exTileBtnPrimary}>
              <KeyRound size={14} style={{ flexShrink: 0 }} />
              <span style={exTileBtnCol}>
                <span>{he ? "חבר קיים" : "Connect existing"}</span>
                {he && <span dir="ltr" style={exTileBtnSub}>Connect existing</span>}
              </span>
            </button>
            <a href={x.signup} target="_blank" rel="noopener noreferrer" className="tap44"
              aria-label={he ? `פתח חשבון חדש ב-${x.name}` : `Open a new ${x.name} account`}
              style={exTileBtnSecondary}>
              <ExternalLink size={14} style={{ flexShrink: 0 }} />
              <span style={exTileBtnCol}>
                <span>{he ? "פתח חשבון חדש" : "Open new account"}</span>
                {he && <span dir="ltr" style={exTileBtnSub}>Open new account</span>}
              </span>
            </a>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "18px 16px 20px", marginBottom: 16, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16), " + SHADOW }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 15.5, fontWeight: 900, color: C.text, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <ShieldCheck size={16} color={C.gold} /> {he ? "התחברו לבורסה" : "Connect an exchange"}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 5, lineHeight: 1.5, maxWidth: 430, marginInline: "auto" }}>
          {he
            ? "בחרו בורסה כדי לראות איך פותחים תת-חשבון, יוצרים מפתח למסחר-בלבד ומחברים — לא-משמורתי."
            : "Pick an exchange for quick steps to open a sub-account, make a trade-only key, and connect — non-custodial."}
        </div>
      </div>
      <div className="ex-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, maxWidth: 640, margin: "0 auto" }}>
        {EX_SUPPORTED.map((x) => tile(x, false))}
        {EX_SOON.map((x) => tile(x, true))}
      </div>
    </div>
  );
}

/* ── Connect-an-exchange guidance modal ─────────────────────────────────────────
   Three honest steps (dedicated sub-account → trade-only key w/ optional IP allowlist
   → connect here), then "Continue" reveals the EXISTING connect form pre-pointed at
   this exchange. Brand-tinted hero, gold numbered steps (matches SignalBotGuide),
   RTL-correct, Escape-to-close, 44px taps. */
function ExchangeConnectGuide({ exKey, lang, rtl, onClose, onConnect }: {
  exKey: string; lang: string; rtl: boolean; onClose: () => void; onConnect: () => void;
}) {
  const he = lang === "he";
  const meta = EX_ALL.find((x) => x.key === exKey) || EX_SUPPORTED[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps: { icon: React.ReactNode; title: string; body: string }[] = [
    {
      icon: <Wallet size={15} color="#fff" />,
      title: he ? "פתחו תת-חשבון ייעודי" : "Open a dedicated sub-account",
      body: he
        ? `ב-${meta.name} צרו תת-חשבון נפרד והעבירו אליו רק את ההון שמיועד למסחר — כך שאר הכספים שלכם מבודדים.`
        : `In ${meta.name}, create a separate sub-account and move only the capital you want to trade into it — keeping the rest of your funds isolated.`,
    },
    {
      icon: <ShieldCheck size={15} color="#fff" />,
      title: he ? "מפתח למסחר-בלבד (ללא משיכות)" : "Trade-only API key (no withdrawals)",
      body: he
        ? "צרו מפתח API עם הרשאת מסחר בלבד — משיכות והעברות מושבתות. רצוי להגביל אותו לכתובת ה-IP שלכם (allowlist)."
        : "Create an API key with trading permission only — withdrawals and transfers disabled. Ideally restrict it to your IP (allowlist).",
    },
    {
      icon: <KeyRound size={15} color="#fff" />,
      title: he ? "חברו כאן" : "Connect it here",
      body: he
        ? "הדביקו את מפתח ה-API והסוד בטופס החיבור — הם נשמרים רק בדפדפן הזה, לעולם לא בשרת שלנו."
        : "Paste the API key & secret into the connect form — they're stored only in this browser, never on our server.",
    },
  ];

  return (
    <div onClick={onClose} role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 60, direction: rtl ? "rtl" : "ltr",
        background: "rgba(4,4,6,0.62)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: UI }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto", borderRadius: 20,
          background: C.surface, border: `1px solid ${C.gold}55`, color: C.text,
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)" }}>
        {/* Brand-tinted hero */}
        <div style={{ position: "relative", overflow: "hidden", padding: "20px 20px 22px",
          background: `linear-gradient(150deg, ${meta.from} -12%, ${meta.to} 58%, ${C.surface2} 145%)`,
          borderBottom: `1px solid ${C.gold}44` }}>
          <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0, height: "46%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)", pointerEvents: "none" }} />
          <button onClick={onClose} className="tap44" aria-label={he ? "סגור" : "Close"}
            style={{ position: "absolute", top: 12, insetInlineEnd: 12, display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 10, background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.24)", cursor: "pointer" }}>
            <X size={16} color="#fff" />
          </button>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 44, height: 44, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.20)", border: "1px solid rgba(255,255,255,0.42)", color: "#fff", fontWeight: 900,
              fontSize: meta.mark.length > 1 ? 15 : 20 }}>{meta.mark}</span>
            <div>
              <div style={{ color: "#fff", fontSize: 19, fontWeight: 900 }}>{meta.name}</div>
              <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 12.5, fontWeight: 600 }}>
                {he ? "חיבור בורסה · 3 שלבים" : "Connect exchange · 3 steps"}
              </div>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div style={{ padding: "18px 18px 6px", display: "flex", flexDirection: "column", gap: 14 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
              <div style={{ position: "relative", flexShrink: 0, width: 38, height: 38, borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(180deg, #2c2c31 0%, #0c0c0e 100%)",
                border: `1px solid ${C.gold}66`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), 0 0 14px -4px ${C.gold}66` }}>
                {s.icon}
                <span style={{ position: "absolute", top: -7, insetInlineEnd: -7, minWidth: 19, height: 19, padding: "0 4px",
                  borderRadius: 999, background: C.gold, color: onAccent(C.gold), fontSize: 11, fontWeight: 900,
                  display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.4)" }}>{i + 1}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 3 }}>{s.title}</div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Non-custodial reminder (reuses the screen's NOTE copy) */}
        <div style={{ margin: "8px 18px 0", display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 13px", borderRadius: 12,
          background: `${C.gain}12`, border: `1px solid ${C.gain}44` }}>
          <ShieldCheck size={16} style={{ color: C.gain, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.text }}>{NOTE[lang]}</div>
        </div>

        {/* Footer — Continue reveals the existing connect form for this exchange */}
        <div style={{ padding: 18, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button onClick={onConnect} className="gbtn ptile tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 22px", border: "none",
              background: "var(--btn-bg)", color: "var(--btn-ink)", borderRadius: 999, fontWeight: 800, fontSize: 13.5, fontFamily: UI, cursor: "pointer" }}>
            <ShieldCheck size={15} /> {he ? `המשיכו לחיבור ${meta.name}` : `Continue to ${meta.name}`}
          </button>
          <button onClick={onClose} className="tap44"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 999, padding: "11px 20px",
              fontSize: 13, fontWeight: 800, fontFamily: UI, cursor: "pointer" }}>
            {he ? "סגור" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Exchange "i" info card ──────────────────────────────────────────────────────
   Opened by the small "i" on a logo tile: a short, honest blurb about the exchange +
   a one-tap link to its OFFICIAL signup page (new tab, rel=noopener) so a brand-new
   user can register before connecting. Supported exchanges also get a "Connect" button
   that hands off to the existing connect guide; Crypto.com is signup-only ("Soon").
   Brand-tinted hero matching ExchangeConnectGuide, RTL-correct, Escape-to-close. */
function ExchangeInfo({ exKey, lang, rtl, onClose, onConnect }: {
  exKey: string; lang: string; rtl: boolean; onClose: () => void; onConnect: () => void;
}) {
  const he = lang === "he";
  const meta = EX_ALL.find((x) => x.key === exKey) || EX_SUPPORTED[0];
  const soon = EX_SOON.some((x) => x.key === exKey);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, zIndex: 60, direction: rtl ? "rtl" : "ltr",
        background: "rgba(4,4,6,0.62)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: UI }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto", borderRadius: 20,
          background: C.surface, border: `1px solid ${C.gold}55`, color: C.text,
          boxShadow: "0 24px 64px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)" }}>
        {/* Brand-tinted hero */}
        <div style={{ position: "relative", overflow: "hidden", padding: "20px 20px 22px",
          background: `linear-gradient(150deg, ${meta.from} -12%, ${meta.to} 58%, ${C.surface2} 145%)`,
          borderBottom: `1px solid ${C.gold}44` }}>
          <span aria-hidden style={{ position: "absolute", insetInlineStart: 0, insetInlineEnd: 0, top: 0, height: "46%",
            background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)", pointerEvents: "none" }} />
          <button onClick={onClose} className="tap44" aria-label={he ? "סגור" : "Close"}
            style={{ position: "absolute", top: 12, insetInlineEnd: 12, display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 10, background: "rgba(0,0,0,0.20)", border: "1px solid rgba(255,255,255,0.24)", cursor: "pointer" }}>
            <X size={16} color="#fff" />
          </button>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 11 }}>
            <span style={{ width: 44, height: 44, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "rgba(255,255,255,0.20)", border: "1px solid rgba(255,255,255,0.42)", color: "#fff", fontWeight: 900,
              fontSize: meta.mark.length > 1 ? 15 : 20 }}>{meta.mark}</span>
            <div>
              <div style={{ color: "#fff", fontSize: 19, fontWeight: 900 }}>{meta.name}</div>
              <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 12.5, fontWeight: 600 }}>
                {soon ? (he ? "בקרוב · חיבור יתווסף" : "Soon · connect later") : (he ? "מידע על הבורסה" : "About this exchange")}
              </div>
            </div>
          </div>
        </div>

        {/* Blurb */}
        <div style={{ padding: "18px 18px 4px", fontSize: 13.5, lineHeight: 1.65, color: C.text }}>{meta.blurb[lang]}</div>

        {/* Signup helper */}
        <div style={{ margin: "12px 18px 0", display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 13px", borderRadius: 12,
          background: `${C.gold}12`, border: `1px solid ${C.goldDim}` }}>
          <Info size={16} style={{ color: C.gold, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11.5, lineHeight: 1.5, color: C.muted }}>
            {he ? "אין לכם עדיין חשבון? פתחו אחד בדף ההרשמה הרשמי של הבורסה (נפתח בכרטיסייה חדשה)." : "No account yet? Open one on the exchange's official signup page (opens in a new tab)."}
          </div>
        </div>

        {/* Footer — signup link (new tab) + optional Connect handoff */}
        <div style={{ padding: 18, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <a href={meta.signup} target="_blank" rel="noopener noreferrer" className="gbtn ptile tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 20px", border: "none", textDecoration: "none",
              background: "var(--btn-bg)", color: "var(--btn-ink)", borderRadius: 999, fontWeight: 800, fontSize: 13.5, fontFamily: UI, cursor: "pointer" }}>
            <ExternalLink size={15} /> {he ? `הרשמה ל-${meta.name}` : `Sign up for ${meta.name}`}
          </a>
          {!soon && (
            <button onClick={onConnect} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface2, border: `1px solid ${C.goldDim}`, color: C.gold,
                borderRadius: 999, padding: "11px 20px", fontSize: 13, fontWeight: 800, fontFamily: UI, cursor: "pointer" }}>
              <ShieldCheck size={15} /> {he ? "חברו עכשיו" : "Connect now"}
            </button>
          )}
          <button onClick={onClose} className="tap44"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 999, padding: "11px 20px",
              fontSize: 13, fontWeight: 800, fontFamily: UI, cursor: "pointer" }}>
            {he ? "סגור" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
