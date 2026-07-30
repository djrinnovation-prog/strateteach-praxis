import React, { createContext, useContext, useEffect, useState } from "react";

// Strings ported from dashboard.jsx + extended for the production screens.
export const L = {
  he: {
    app: "Strateteach", scanner: "סריקה יומית", trends: "סורק מגמות", backtests: "בדיקות",
    dashboard: "לוח", strategy: "מעבדת אסטרטגיות", guidedBuilder: "בונה אסטרטגיה", exchange: "חיבור בורסה", profit: "מנוע מסחר",
    paper: "מסחר דמו", telegram: "חיבור טלגרם", activity: "פעילות תיק", settings: "הגדרות", privacy: "פרטיות", university: "הסברים",
    analytics: "ביצועים", chat: "צ'אט", screens: "מסכי משתמשים", reels: "רילים · קורס", admin: "ניהול",
    signOut: "התנתק", username: "שם משתמש", password: "סיסמה", signIn: "התחבר",
    loginHint: "התחבר כדי לגשת לשרת שלך", signingIn: "מתחבר…",
    crypto: "קריפטו", stocks: "מניות", metals: "מתכות", commodities: "סחורות",
    scan: "סרוק איתותים", scanning: "סורק…", refresh: "רענן", noSignals: "לא נמצאו איתותים כרגע",
    asset: "נכס", tier: "דרגה", direction: "כיוון", price: "מחיר", toGreen: "לאזור הירוק",
    long: "לונג", short: "שורט", sendTelegram: "שלח לטלגרם",
    breakingOut: "פורץ", nearBreakout: "קרוב לפריצה", inUptrend: "במגמת עלייה",
    runName: "שם בדיקה", run: "הרץ בדיקה", running: "מריץ", results: "תוצאות",
    ret: "תשואה", cagr: "CAGR", maxdd: "ירידה מקס׳", winrate: "% הצלחה", sharpe: "שארפ",
    trades: "עסקאות", equity: "עקומת הון", pickRun: "בחר בדיקה כדי לראות תוצאות",
    back: "חזרה", del: "מחק", excel: "ייצוא CSV", close: "סגור",
    entry: "כניסה", exit: "יציאה", status: "סטטוס", newBacktest: "בדיקה חדשה",
    noRuns: "אין בדיקות עדיין — הרץ אחת", strat: "אסטרטגיה", viewResults: "תוצאות",
    confirmDelete: "למחוק בדיקה זו?", noResults: "אין תוצאות לבדיקה זו", maxAssets: "מקס׳ נכסים",
    protectionCode: "קוד הגנה", setCode: "הגדר קוד", unlock: "פתח", enterCode: "הזן קוד הגנה",
    pinHint: "קוד קצר (4+ תווים) ששומר על כל הפעולות הכספיות.", connection: "חיבור",
    broker: "בורסה", apiKey: "מפתח API", apiSecret: "סוד API", passphrase: "סיסמת מעבר (אם יש)", defaultPct: "אחוז ברירת מחדל",
    testConn: "בדוק חיבור", save: "שמור", balance: "יתרה", positions: "פוזיציות", load: "טען",
    placeOrder: "בצע הוראה", side: "צד", otype: "סוג", market: "שוק", limitOrder: "לימיט",
    buy: "קנייה / לונג", sell: "מכירה / שורט", closeProfitable: "סגור רווחיות", buildPlan: "בנה תוכנית",
    viewPlan: "הצג תוכנית", liveReal: "חי — כסף אמיתי", testnet: "טסטנט (בטוח)", symbol: "סימבול",
    dailyTarget: "יעד יומי", maxPos: "מקס׳ פוזיציות", enabledW: "מופעל", disabledW: "כבוי",
    lastTest: "בדיקה אחרונה", confirmOrder: "לבצע הוראה זו?", confirmClose: "לסגור את כל הפוזיציות ברווח?", saved: "נשמר",
    virtualMoney: "כסף וירטואלי", startSession: "פתח סשן דמו", capital: "הון ($)", autoTP: "ג׳ני אוטומטי",
    openPositions: "פוזיציות פתוחות", qty: "כמות", now: "עכשיו", pnl: "רווח/הפסד", closeAll: "סגור הכל",
    keepGoing: "המשך", stopClose: "עצור וסגור", targetReached: "היעד הושג — להמשיך או לעצור?",
    noSessions: "אין סשנים — פתח אחד", takeProfitPct: "אחוז ג׳ני",
    uptrend: "מגמת עלייה", neutral: "ניטרלי", downtrend: "מגמת ירידה",
    totalRuns2: "סה״כ בדיקות", completedRuns: "הושלמו", symbolsTested: "נכסים שנבדקו",
    bestPerformer: "המוביל", worstDD: "ירידה גדולה", avgSharpe: "שארפ ממוצע", byCategory: "פילוח לפי קטגוריה",
    pineSource: "קוד Pine", parse: "נתח", preview10: "תצוגה מקדימה (10 מובילים)", savedStrategies: "אסטרטגיות שמורות",
    strategyName: "שם אסטרטגיה", noStrategies: "אין אסטרטגיות שמורות", generated: "נוצר",
    botToken: "טוקן בוט", chatId: "מזהה צ׳אט", detect: "זהה צ׳אטים", send: "שלח", testMsg: "שלח בדיקה",
    demoActivity: "דמו", liveActivity: "חי", liveLocked: "נעול — הזן קוד הגנה בבורסה", kind: "סוג", when: "מתי", noActivity: "אין פעילות",
    enableEngine: "הפעל מנוע", weeklyTarget: "יעד שבועי", deployPct: "אחוז הקצאה", profitSettings: "הגדרות מנוע מסחר",
    loading: "טוען…", noData: "אין עדיין נתונים", comingSoon: "בקרוב — בשלב הבא",
  },
  en: {
    app: "Strateteach", scanner: "Daily scan", trends: "Trend scanner", backtests: "Backtests",
    dashboard: "Dashboard", strategy: "Strategy lab", guidedBuilder: "Strategy builder", exchange: "Exchange connect", profit: "Trading engine",
    paper: "Paper trading", telegram: "Telegram connect", activity: "Activity", settings: "Settings", privacy: "Privacy",
    analytics: "Performance", chat: "Chat", screens: "User screens", university: "Explanations", reels: "Reels · course", admin: "Admin",
    signOut: "Sign out", username: "Username", password: "Password", signIn: "Sign in",
    loginHint: "Sign in to reach your backend", signingIn: "Signing in…",
    crypto: "Crypto", stocks: "Stocks", metals: "Metals", commodities: "Commodities",
    scan: "Scan signals", scanning: "Scanning…", refresh: "Refresh", noSignals: "No signals found right now",
    asset: "Asset", tier: "Tier", direction: "Direction", price: "Price", toGreen: "To green zone",
    long: "Long", short: "Short", sendTelegram: "Send to Telegram",
    breakingOut: "Breaking out", nearBreakout: "Near breakout", inUptrend: "In uptrend",
    runName: "Run name", run: "Run backtest", running: "Running", results: "Results",
    ret: "Return", cagr: "CAGR", maxdd: "Max DD", winrate: "Win %", sharpe: "Sharpe",
    trades: "Trades", equity: "Equity curve", pickRun: "Pick a run to see results",
    back: "Back", del: "Delete", excel: "Export CSV", close: "Close",
    entry: "Entry", exit: "Exit", status: "Status", newBacktest: "New backtest",
    noRuns: "No runs yet — start one", strat: "Strategy", viewResults: "Results",
    confirmDelete: "Delete this run?", noResults: "No results for this run", maxAssets: "Max assets",
    protectionCode: "Protection code", setCode: "Set code", unlock: "Unlock", enterCode: "Enter protection code",
    pinHint: "A short code (4+ chars) that guards every money-moving action.", connection: "Connection",
    broker: "Exchange", apiKey: "API key", apiSecret: "API secret", passphrase: "Passphrase (if any)", defaultPct: "Default size %",
    testConn: "Test connection", save: "Save", balance: "Balance", positions: "Positions", load: "Load",
    placeOrder: "Place order", side: "Side", otype: "Type", market: "Market", limitOrder: "Limit",
    buy: "Buy / long", sell: "Sell / short", closeProfitable: "Close profitable", buildPlan: "Build plan",
    viewPlan: "View plan", liveReal: "LIVE — real money", testnet: "Testnet (safe)", symbol: "Symbol",
    dailyTarget: "Daily target", maxPos: "Max positions", enabledW: "enabled", disabledW: "disabled",
    lastTest: "Last test", confirmOrder: "Place this order?", confirmClose: "Close all positions in profit?", saved: "Saved",
    virtualMoney: "virtual money", startSession: "Start demo session", capital: "Capital ($)", autoTP: "Auto take-profit",
    openPositions: "Open positions", qty: "Qty", now: "Now", pnl: "P&L", closeAll: "Close all",
    keepGoing: "Keep going", stopClose: "Stop & close", targetReached: "Target reached — keep going or stop?",
    noSessions: "No sessions yet — start one", takeProfitPct: "Take-profit %",
    uptrend: "Uptrend", neutral: "Neutral", downtrend: "Downtrend",
    totalRuns2: "Total runs", completedRuns: "Completed", symbolsTested: "Symbols tested",
    bestPerformer: "Best", worstDD: "Worst DD", avgSharpe: "Avg Sharpe", byCategory: "By category",
    pineSource: "Pine source", parse: "Parse", preview10: "Preview top 10", savedStrategies: "Saved strategies",
    strategyName: "Strategy name", noStrategies: "No saved strategies", generated: "Generated",
    botToken: "Bot token", chatId: "Chat ID", detect: "Detect chats", send: "Send", testMsg: "Send test",
    demoActivity: "Demo", liveActivity: "Live", liveLocked: "Locked — set the exchange PIN", kind: "Kind", when: "When", noActivity: "No activity",
    enableEngine: "Enable engine", weeklyTarget: "Weekly target", deployPct: "Deploy %", profitSettings: "Trading engine settings",
    loading: "Loading…", noData: "No data yet", comingSoon: "Coming soon — next stage",
  },
};

export type Lang = "he" | "en";
type Dict = typeof L.en;

interface I18nCtx { lang: Lang; rtl: boolean; t: Dict; setLang: (l: Lang) => void; }
const Ctx = createContext<I18nCtx>(null as unknown as I18nCtx);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(
    (localStorage.getItem("algo770_lang") as Lang) || "he"
  );
  const rtl = lang === "he";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    localStorage.setItem("algo770_lang", lang);
  }, [lang, rtl]);

  return (
    <Ctx.Provider value={{ lang, rtl, t: L[lang] as Dict, setLang }}>
      {children}
    </Ctx.Provider>
  );
}

export const useI18n = () => useContext(Ctx);
