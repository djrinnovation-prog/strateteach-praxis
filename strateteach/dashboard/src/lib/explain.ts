// Short per-screen explanations shown behind an "i" button on each screen.
import type { Lang } from "../i18n";

type LL = Record<Lang, string>;

export const EXPLAIN: Record<string, LL> = {
  scanner: {
    he: "סורק את כל הנכסים ומציג לכל אחד צבע מגמה: ירוק = מגמת עלייה (אפשר לפתוח עסקה), אפור = ניטרלי (החזקה), אדום = מגמת ירידה (סגירה). כולל גרף היסטוריית מגמות ו-10 הפריצות המובילות שמזינות את מנוע המסחר.",
    en: "Scans every asset and shows each one's trend color: Green = uptrend (open a trade), Grey = neutral (hold), Red = downtrend (close). Includes a trend-history chart and today's top-10 breakouts that feed the trading engine.",
  },
  backtests: {
    he: "בודק אסטרטגיות על נתוני עבר כדי לראות איך היו מתפקדות — תשואה, אחוז הצלחה, שארפ ומספר עסקאות. קריפטו מהיר; מניות/מתכות/סחורות איטיים יותר בגלל הגבלות ספק הנתונים.",
    en: "Tests strategies on historical data to see how they'd have performed — return, win rate, Sharpe and trade count. Crypto is fast; stocks/metals/commodities are slower due to data-provider rate limits.",
  },
  dashboard: {
    he: "מבט-על על כל הבדיקות: סה״כ ריצות, נכסים שנבדקו, שארפ ממוצע, המוביל והירידה הגדולה, ופילוח לפי קטגוריה.",
    en: "An overview across all your runs: total runs, symbols tested, average Sharpe, best performer and worst drawdown, plus a per-category breakdown.",
  },
  strategy: {
    he: "מקום לכוונן אסטרטגיות. אנחנו משתמשים באלגוריתם שלנו שפותח על בסיס למידה. אפשר לערוך, לנעול שדות (כמו ב-TradingView), לראות תצוגה מקדימה על המטבעות המובילים ולשמור.",
    en: "Where you tune strategies. We use our own algorithm, developed with machine learning. Edit and lock fields (TradingView-style), preview on the top coins, and save.",
  },
  exchange: {
    he: "חיבור לבורסה שלכם. המפתחות נשמרים רק בדפדפן הזה (לא-משמורתי) ולעולם לא בשרת. מכאן בודקים חיבור, רואים יתרה/פוזיציות, מבצעים הוראות, ומושכים לארנק חיצוני מאושר.",
    en: "Connect your exchange. Keys are stored only in this browser (non-custodial) and never on the server. Test the connection, view balance/positions, place orders, and withdraw to a whitelisted external wallet.",
  },
  profit: {
    he: "בונה תוכנית קנייה יומית מהסיגנלים החמים. בוחרים יעד ב-$ או ב-%, כמה נכסים מובילים, ואחוז מהיתרה להקצאה — והמערכת מחשבת יעד רווח לכל פוזיציה. אתם מאשרים כל פקודה.",
    en: "Builds a daily buy plan from the hottest signals. Choose a target in $ or %, how many top picks, and what % of your balance to deploy — and it computes a take-profit per position. You approve every order.",
  },
  telegram: {
    he: "חיבור בוט טלגרם לקבלת התראות (סיגנלים, סיום בדיקות, מנוע מסחר). מדריך 3 צעדים בראש המסך.",
    en: "Connect a Telegram bot to receive alerts (signals, finished runs, trading engine). A 3-step guide is at the top of the screen.",
  },
  activity: {
    he: "יומן הפעולות בתיק — דמו וגם חי. הפעילות החיה נפתחת לאחר הגדרת קוד הגנה בבורסה.",
    en: "Your portfolio's activity log — both demo and live. Live activity unlocks once you set the exchange protection code.",
  },
  settings: {
    he: "ניהול: שינוי סיסמה, ניהול משתמשים (מנהל בלבד), קישורי איפוס, יומן ביקורת, והנתונים שלכם (ייצוא/מחיקה).",
    en: "Management: change password, user management (admin only), reset links, the audit log, and your data (export/delete).",
  },
};
