import { Search, FlaskConical, Wand2, TrendingUp, ArrowLeftRight, Send, Activity } from "lucide-react";

// Shared ALGO770 University + per-page content. Used by both the University
// screen and the floating Avatar helper so they never drift apart.

export type Lang = "he" | "en";

export const STEPS: Record<Lang, string[]> = {
  he: [
    "התחברו והגדירו סיסמה חזקה (מנהל יכול לנהל משתמשים בהגדרות).",
    "פתחו את הסורק — ראו לכל נכס צבע מגמה (ירוק/אפור/אדום) ואת 10 הפריצות המובילות.",
    "במעבדת האסטרטגיות בחרו בוט (BOT8C/4/1), כווננו פרמטרים, ונעלו שדות שתרצו לשמר.",
    "הריצו בקטסט כדי לבדוק איך האסטרטגיה התנהגה בעבר (קריפטו מהיר).",
    "חברו בורסה (אופציונלי) — המפתחות נשמרים רק בדפדפן שלכם.",
    "במנוע המסחר בחרו יעד ב-$ או ב-%, כמה נכסים מובילים, ואחוז הקצאה — ואשרו כל פקודה.",
  ],
  en: [
    "Sign in and set a strong password (admins manage users in Settings).",
    "Open the Scanner — see each asset's trend color (Green/Grey/Red) and today's top-10 breakouts.",
    "In the Strategy Lab pick a bot (BOT8C/4/1), tune parameters, and lock any field you want to keep.",
    "Run a Backtest to see how the strategy behaved historically (crypto is fast).",
    "Connect an exchange (optional) — keys are stored only in your browser.",
    "In the Trading Engine choose a $ or % target, how many top picks, and a deploy %, then approve each order.",
  ],
};

export type Sec = { id: string; Icon: any; title: Record<Lang, string>; body: Record<Lang, string[]> };

export const SECTIONS: Sec[] = [
  { id: "scanner", Icon: Search, title: { he: "הסורק (מגמות יומיות)", en: "The Scanner (daily trends)" },
    body: {
      he: ["הסורק עובר על כל הנכסים ומסווג כל אחד לצבע מגמה לפי מודל ערוץ גאוס 770: ירוק = מגמת עלייה (אפשר לפתוח עסקה), אפור = ניטרלי (החזקה), אדום = מגמת ירידה (סגירה).",
        "גרף היסטוריית המגמות מראה כמה נכסים היו ירוק/אפור/אדום בכל יום. טבלת המעברים מראה אילו נכסים שינו מגמה ומתי, כולל רווח/הפסד נטו מאז הפתיחה.",
        "10 הפריצות המובילות הן הקלט למנוע המסחר."],
      en: ["The Scanner sweeps every asset and labels each with a trend color from the 770 Gaussian-channel model: Green = uptrend (you may open a trade), Grey = neutral (hold), Red = downtrend (close).",
        "The trend-history chart shows how many assets were Green/Grey/Red each day. The transitions table shows which assets changed trend and when, with net P&L since they opened.",
        "The top-10 breakouts are the input to the Trading Engine."] } },
  { id: "backtest", Icon: FlaskConical, title: { he: "בקטסטינג", en: "Backtesting" },
    body: {
      he: ["בקטסט מריץ אסטרטגיה על נתוני עבר ומדווח: תשואה כוללת, CAGR, ירידה מקסימלית, אחוז הצלחה, שארפ ומספר עסקאות.",
        "התוצאות היפותטיות — הן לא מבטיחות רווח עתידי. קריפטו נטען מהר; מניות/מתכות/סחורות איטיים יותר בגלל הגבלות ספק הנתונים, אז להרצה מהירה בחרו קריפטו בלבד."],
      en: ["A backtest runs a strategy over historical data and reports: total return, CAGR, max drawdown, win rate, Sharpe and trade count.",
        "Results are hypothetical — they don't guarantee future profit. Crypto loads fast; stocks/metals/commodities are slower due to data-provider limits, so for a quick run choose crypto only."] } },
  { id: "lab", Icon: Wand2, title: { he: "איך נבנות אסטרטגיות (מעבדה)", en: "How strategies are built (the Lab)" },
    body: {
      he: ["כל האסטרטגיות מבוססות על ערוץ גאוס 770 — קו מגמה מוחלק עם פס סטיות מעליו ומתחתיו. כשהמחיר פורץ את הפס העליון נוצרת מגמת עלייה; שבירה של הפס התחתון = מגמת ירידה.",
        "הפרמטרים שאתם מכווננים: קטבים (poles) = כמה חלק הקו (1–8), תקופה (period) = כמה נרות בחישוב, מכפיל (multiplier) = רוחב הפס בסטיות תקן. בנוסף: בוט בסיס (BOT8C/4/1), טווח זמן, תאריכי התחלה/סיום, אחוז פוזיציה, ואפשרות שורט.",
        "אפשר להדביק קוד Pine והמנוע יזהה את הפרמטרים הנתמכים. נעילת שדה (כמו ב-TradingView) שומרת על ערך גם בעת ניתוח מחדש. שמרו אסטרטגיה כדי להשתמש בה בסורק ובבקטסט."],
      en: ["Every strategy is based on the 770 Gaussian channel — a smoothed trend line with a band of deviations above and below. When price breaks the upper band an uptrend forms; breaking the lower band = downtrend.",
        "The parameters you tune: poles = how smooth the line is (1–8), period = how many candles in the calc, multiplier = band width in standard deviations. Plus: base bot (BOT8C/4/1), timeframe, start/end dates, position %, and an allow-shorts option.",
        "You can paste Pine code and the engine recognizes the supported parameters. Locking a field (TradingView-style) keeps its value even when you re-parse. Save a strategy to use it in the Scanner and Backtests."] } },
  { id: "profit", Icon: TrendingUp, title: { he: "מנוע המסחר", en: "The Trading Engine" },
    body: {
      he: ["מנוע המסחר בונה תוכנית קנייה יומית מהסיגנלים החמים. אתם בוחרים: יעד ב-$ (סכום שמתחלק בין הפוזיציות) או ב-% (כל פוזיציה מכוונת לאותו אחוז), כמה נכסים מובילים לקחת, ואיזה אחוז מהיתרה להקצות.",
        "המנוע מחשב לכל בחירה כמות, מחיר כניסה ומחיר יעד (Take-Profit). אתם מאשרים כל פקודה ידנית — שום דבר לא נשלח אוטומטית. כפתור ‚מימוש רווחים’ סוגר פוזיציות שנמצאות ברווח."],
      en: ["The Trading Engine builds a daily buy plan from the hottest signals. You choose: a $ target (split across positions) or a % target (each position aims for the same %), how many top picks to take, and what % of your balance to deploy.",
        "For each pick it computes a quantity, entry price and take-profit price. You approve every order manually — nothing is sent automatically. The 'Harvest profits' button closes positions that are in profit."] } },
  { id: "exchange", Icon: ArrowLeftRight, title: { he: "חיבור בורסה (לא-משמורתי)", en: "Connecting an exchange (non-custodial)" },
    body: {
      he: ["מפתחות ה-API נשמרים רק בדפדפן שלכם ונשלחים לשרת רק לרגע הפעולה — לעולם לא נשמרים אצלנו. כך אתם מחזיקים את המפתחות והכספים.",
        "מומלץ להתחיל ב-Testnet. למשיכה לארנק חיצוני: הגדירו כתובת מאושרת באפליקציה והפעילו הרשאת משיכה + רשימת כתובות מאושרות בבורסה עצמה."],
      en: ["Your API keys live only in your browser and are sent to the server only for the moment of a call — never stored on our side. That way you hold your keys and funds.",
        "Start on Testnet. For external withdrawals: set a whitelisted address in the app and enable withdrawal permission + an address whitelist on the exchange itself."] } },
  { id: "telegram", Icon: Send, title: { he: "התראות טלגרם", en: "Telegram alerts" },
    body: { he: ["חברו בוט טלגרם (מדריך 3 צעדים במסך) כדי לקבל התראות על סיגנלים, סיום בדיקות ומנוע המסחר."],
      en: ["Connect a Telegram bot (3-step guide on the screen) to get alerts for signals, finished runs, and the trading engine."] } },
  { id: "activity", Icon: Activity, title: { he: "פעילות והיסטוריה", en: "Activity & history" },
    body: { he: ["יומן הפעילות מתעד כל פעולה — דמו וגם חי. פותחים אותו מהחץ בקצה המסך."],
      en: ["The activity log records every action — demo and live. Open it from the arrow at the edge of the screen."] } },
];

export const GLOSSARY: { term: Record<Lang, string>; def: Record<Lang, string> }[] = [
  { term: { he: "דרגה / יהלום", en: "Tier / Diamond" }, def: { he: "עוצמת הסיגנל. יהלום מלא = חזק (פורץ), חלול = מתפתח.", en: "Signal strength. Filled diamond = strong (breaking out), hollow = developing." } },
  { term: { he: "פריצה (Breakout)", en: "Breakout" }, def: { he: "המחיר חוצה את הפס העליון של הערוץ — תחילת מגמת עלייה.", en: "Price crosses the channel's upper band — the start of an uptrend." } },
  { term: { he: "שארפ (Sharpe)", en: "Sharpe" }, def: { he: "תשואה ביחס לסיכון. גבוה יותר = תשואה חלקה יותר.", en: "Return relative to risk. Higher = smoother returns." } },
  { term: { he: "ירידה מקסימלית (Drawdown)", en: "Max drawdown" }, def: { he: "הנפילה הגדולה ביותר מפסגה לשפל. כמה כאב הייתם סופגים.", en: "The largest peak-to-trough drop — how much pain you'd have endured." } },
  { term: { he: "אחוז הצלחה (Win rate)", en: "Win rate" }, def: { he: "אחוז העסקאות שהסתיימו ברווח.", en: "The percentage of trades that ended in profit." } },
  { term: { he: "CAGR", en: "CAGR" }, def: { he: "תשואה שנתית ממוצעת מצרפית.", en: "Compound average annual growth rate." } },
  { term: { he: "Take-Profit", en: "Take-profit" }, def: { he: "מחיר יעד שבו סוגרים פוזיציה ברווח.", en: "A target price at which a position is closed in profit." } },
  { term: { he: "אחוז הקצאה (Deploy %)", en: "Deploy %" }, def: { he: "איזה חלק מהיתרה הפנויה מנוע המסחר ישתמש בו.", en: "What share of your free balance the engine will use." } },
  { term: { he: "Testnet מול Live", en: "Testnet vs Live" }, def: { he: "Testnet = כסף מדומה לבדיקה. Live = כסף אמיתי.", en: "Testnet = play money for testing. Live = real money." } },
  { term: { he: "לא-משמורתי", en: "Non-custodial" }, def: { he: "אתם מחזיקים את המפתחות והכספים; אנחנו לא.", en: "You hold the keys and funds; we never do." } },
];

// Per-route spoken explanation the Avatar reads for "this page".
export const PAGES: Record<string, Record<Lang, string>> = {
  "/": {
    he: "ברוכים הבאים ל-ALGO770. זהו מסך הבית — לחצו על אחת מהמטבעות הצפים כדי להיכנס: מגמה יומית, הרצת בקטסט, מעבדת אסטרטגיות, מנוע מסחר, צ'אט או ההסברים. אני כאן בכל מסך — לחצו עליי ואסביר לכם מה רואים.",
    en: "Welcome to ALGO770. This is the home screen — tap one of the floating orbs to enter: Daily Trend, Run Backtest, Strategy Lab, Trading Engine, Chat or the Explanations. I'm on every screen — tap me and I'll explain what you're looking at.",
  },
  "/scanner": {
    he: "זהו הסורק היומי. הוא עובר על כל הנכסים ונותן לכל אחד צבע מגמה: ירוק לפתיחת עסקה, אפור להחזקה, ואדום לסגירה. למטה תראו את עשר הפריצות החזקות של היום, שמזינות את מנוע המסחר.",
    en: "This is the Daily Scanner. It sweeps every asset and gives each one a trend color: green to open a trade, grey to hold, and red to close. Below you'll see today's ten strongest breakouts, which feed the Trading Engine.",
  },
  "/backtests": {
    he: "זהו מסך הבקטסט. הוא מריץ אסטרטגיה על נתוני העבר ומראה איך הייתה מתפקדת: תשואה כוללת, אחוז הצלחה, ירידה מקסימלית ומספר עסקאות. קריפטו נטען מהר, אז להרצה מהירה בחרו קריפטו.",
    en: "This is the Backtest screen. It runs a strategy over historical data and shows how it would have performed: total return, win rate, max drawdown and trade count. Crypto loads fast, so for a quick run pick crypto.",
  },
  "/overview": {
    he: "זהו הלוח. כאן רואים סיכום חי: הרצות פעילות, סשנים שרצים, והרווח של הדמו להיום, החודש, השנה והכול. זו תמונת המצב המהירה של המערכת שלכם.",
    en: "This is the Dashboard. Here you see a live summary: active runs, running sessions, and your demo profit for today, this month, this year and all-time. It's the quick health snapshot of your system.",
  },
  "/strategy": {
    he: "זוהי מעבדת האסטרטגיות. בחרו בוט בסיס, כווננו פרמטרים כמו קטבים, תקופה ומכפיל, ונעלו שדות שתרצו לשמר. אפשר גם להדביק קוד פיין. שמרו אסטרטגיה כדי להשתמש בה בסורק ובבקטסט.",
    en: "This is the Strategy Lab. Pick a base bot, tune parameters like poles, period and multiplier, and lock any field you want to keep. You can also paste Pine code. Save a strategy to use it in the Scanner and Backtests.",
  },
  "/exchange": {
    he: "זהו מסך הבורסה. החיבור לא-משמורתי — מפתחות ה-API נשמרים רק בדפדפן שלכם ולעולם לא אצלנו. מומלץ להתחיל ב-Testnet עם כסף מדומה לפני מסחר אמיתי.",
    en: "This is the Exchange screen. The connection is non-custodial — your API keys stay only in your browser and never with us. Start on Testnet with play money before any real trading.",
  },
  "/profit": {
    he: "זהו מנוע המסחר. הוא בונה תוכנית קנייה יומית מהסיגנלים החמים. בחרו יעד בדולר או באחוז, כמה נכסים מובילים, ואיזה אחוז מהיתרה להקצות. אתם מאשרים כל פקודה ידנית — שום דבר לא נשלח אוטומטית.",
    en: "This is the Trading Engine. It builds a daily buy plan from the hottest signals. Choose a dollar or percent target, how many top picks, and what share of your balance to deploy. You approve every order manually — nothing is sent automatically.",
  },
  "/analytics": {
    he: "זהו מסך הביצועים. המד מראה את אחוז ההצלחה שלכם מול היעד שהגדרתם, וכל המספרים — רווח נטו, פקטור רווח, ממוצע רווח והפסד. הכפתורים למעלה מקפיצים למסכים שמהם הנתונים נבנים.",
    en: "This is the Performance screen. The gauge shows your win rate against the target you set, plus all the numbers — net profit, profit factor, average win and loss. The buttons up top jump to the screens the data is built from.",
  },
  "/chat": {
    he: "זהו הצ'אט. הוסיפו חברים, פתחו קבוצות, ושלחו הודעות ישירות. תקבלו צליל כשמגיעה הודעה, ועדכוני רווח בזמן אמת. מנהל יכול לשלוח פרסים חגיגיים עם קונפטי.",
    en: "This is Chat. Add friends, create groups, and send direct messages. You'll hear a sound when a message arrives, plus live profit updates. An admin can send celebratory confetti rewards.",
  },
  "/telegram": {
    he: "זהו מסך הטלגרם. חברו בוט בשלושה צעדים פשוטים כדי לקבל התראות בטלגרם על סיגנלים, סיום בדיקות ומנוע המסחר — גם כשהאפליקציה סגורה.",
    en: "This is the Telegram screen. Connect a bot in three simple steps to get Telegram alerts for signals, finished runs and the trading engine — even when the app is closed.",
  },
  "/university": {
    he: "זוהי האוניברסיטה — המדריך המלא. כאן מוסבר הכל מאפס: צעדים ראשונים, איך כל חלק עובד, ומילון מונחים. לחצו על נושא ואקריא לכם אותו בקול.",
    en: "This is the University — the full guide. Everything is explained from scratch: getting started, how each part works, and a glossary. Tap a topic and I'll read it aloud for you.",
  },
  "/settings": {
    he: "זהו מסך ההגדרות. ערכו את הפרופיל, האימייל והשפה. מנהל יכול לנהל משתמשים — לאפס סיסמאות ולהגדיר לכל משתמש לאילו מסכים יש גישה.",
    en: "This is the Settings screen. Edit your profile, email and language. An admin can manage users — reset passwords and define which screens each user can access.",
  },
  "/screens": {
    he: "זהו מסך המנהל לצפייה במסכים. מנהל יכול לבקש צילום מסך ממשתמש כדי לעזור לו — תמיד עם באנר גלוי שמודיע למשתמש.",
    en: "This is the admin Screens view. An admin can request a screenshot from a user to help them — always with a visible banner that tells the user.",
  },
  "/activity": {
    he: "זהו יומן הפעילות. הוא מתעד כל פעולה במערכת — גם דמו וגם חי — כדי שתוכלו לעקוב אחרי מה שקרה ומתי.",
    en: "This is the Activity log. It records every action in the system — demo and live — so you can track what happened and when.",
  },
};

export function pageExplain(path: string, lang: Lang): string {
  const p = PAGES[path] || PAGES["/"];
  return p[lang];
}
