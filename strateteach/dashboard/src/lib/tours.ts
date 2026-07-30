import { CoachStep, CoachLabels } from "../components/CoachMarks";

// ── Per-screen guided-tour REGISTRY ─────────────────────────────────────────
// One module mapping a screen key → an ordered list of coach-marks steps. Each
// step points at a real on-screen element by `data-tour="<target>"`, with a
// short bilingual title + body. Adding a new screen's tour later is trivial:
//   1) tag the screen's key elements with data-tour="<id>"
//   2) add a `<key>: [...]` entry below
//   3) drop a <TourLauncher screen="<key>" /> on that screen
// The shared CoachMarks component renders them — nothing here forks it.
//
// Targets that aren't on screen for the current state (a collapsed panel, the
// other Demo/Live mode, an admin-only tile) are handled gracefully by CoachMarks:
// it centres the bubble and still shows the explanation. Where the same concept
// exists in two render states (e.g. Profit's demo vs live equivalents) we give
// BOTH elements the same data-tour id and CoachMarks spotlights whichever is
// actually visible.

type Loc = { he: string; en: string };
export type TourStepDef = { target: string; title: Loc; body: Loc };

export const TOURS: Record<string, TourStepDef[]> = {
  // Home — the springboard. (Mirrors the original hard-coded Home tour.)
  home: [
    { target: "home-positions",
      title: { he: "הפוזיציות החיות שלך", en: "Your live positions" },
      body: { he: "מספר הפוזיציות הפתוחות, רווח/הפסד פתוח, וכפתור לסגירת הכל בלחיצה אחת.", en: "How many positions are open, your open P&L, and a one-press Close all." } },
    { target: "hub-trade",
      title: { he: "מסחר וניתוח", en: "Trading & Analysis" },
      body: { he: "כאן רץ המסחר: מנוע המסחר, בקטסטים, סורק האותות וניתוח השוק.", en: "Where trading lives: the trading engine, backtests, the signal scanner and market analysis." } },
    { target: "hub-learn",
      title: { he: "למידה", en: "Learn" },
      body: { he: "האוניברסיטה והמדריכים — ללמוד את האפליקציה ואת השווקים צעד-צעד.", en: "The university and how-to guides — learn the app and the markets step by step." } },
    { target: "hub-connect",
      title: { he: "חיבורים", en: "Connect" },
      body: { he: "חיבור הבורסה, צ'אט ותמיכה — כל מה שמקשר אותך החוצה.", en: "Link your exchange, chat and support — everything that connects you out." } },
    { target: "hub-account",
      title: { he: "חשבון ופרופיל", en: "Account & Profile" },
      body: { he: "ההגדרות, התוכנית והפרופיל שלך.", en: "Your settings, plan and profile." } },
  ],

  // Profit / Trading Engine — the Trade screen (works in both Demo and Live mode;
  // the demo ProfitEngine and the live sections share these data-tour ids).
  profit: [
    { target: "profit-mode",
      title: { he: "דמו או לייב", en: "Demo or Live" },
      body: { he: "החליפו בין תרגול בכסף וירטואלי (דמו) למסחר בכסף אמיתי (לייב). הצד הפעיל נצבע — אי אפשר להתבלבל.", en: "Switch between practising with virtual money (Demo) and trading real money (Live). The active half is filled — impossible to miss." } },
    { target: "profit-pnl",
      title: { he: "רווח והפסד", en: "Your P&L" },
      body: { he: "סיכום הרווח/הפסד שלכם — היום, החודש והשנה. לחצו כדי לפתוח את לוח הפעילות.", en: "Your running profit/loss — today, this month and this year. Tap to open the activity calendar." } },
    { target: "profit-positions",
      title: { he: "פוזיציות פתוחות", en: "Open positions" },
      body: { he: "כל הפוזיציות הפתוחות שלכם והרווח החי שלהן — וסגירת הכל בלחיצה. מופיע כשבורסה מחוברת.", en: "Every open position and its live P&L — plus one-tap Close all. Shows once an exchange is connected." } },
    { target: "profit-newrun",
      title: { he: "ריצה חדשה", en: "Start a new run" },
      body: { he: "בונים תוכנית יומית מהסיגנלים החמים — בוחרים תקציב ומספר נכסים, ומאשרים כל פקודה.", en: "Build a daily plan from the hot signals — pick a budget and how many assets, then approve each order." } },
    { target: "profit-runs",
      title: { he: "הריצות שלכם", en: "Your runs" },
      body: { he: "כל הריצות — פעילות וסגורות — עם הרווח של כל אחת. פתחו ריצה כדי לראות את הפוזיציות שלה.", en: "All your runs — active and closed — each with its own P&L. Open one to see its positions." } },
  ],

  // Exchange — connect your exchange + manage funds (Connect & Funds tiles).
  exchange: [
    { target: "ex-connect",
      title: { he: "חיבור הבורסה", en: "Connect your exchange" },
      body: { he: "מחברים בורסה עם מפתחות API — אפשר כמה חשבונות. המפתחות נשמרים מוצפנים ובדפדפן שלכם.", en: "Link an exchange with API keys — you can add several accounts. Keys are stored encrypted and in your browser." } },
    { target: "ex-status",
      title: { he: "סטטוס החיבור", en: "Connection status" },
      body: { he: "תג מצב מראה אם אתם על Testnet (לתרגול) או Live (כסף אמיתי) — תמיד נראה במבט אחד.", en: "A status badge shows whether you're on Testnet (practice) or Live (real money) — always visible at a glance." } },
    { target: "ex-funds",
      title: { he: "כספים", en: "Funds" },
      body: { he: "כל היתרות שלכם והפוזיציות הפתוחות בבורסה — במקום אחד.", en: "All your balances and open positions on the exchange — in one place." } },
    { target: "ex-dust",
      title: { he: "ניקוי אבק → USDT", en: "Clean dust → USDT" },
      body: { he: "ממיר יתרות קטנות (< $5) שנשארו אחרי סגירת פוזיציות בחזרה ל-USDT. כסף אמיתי — תמיד מאשרים.", en: "Converts the tiny sub-$5 leftovers left after closing positions back into USDT. Real money — you always confirm." } },
    { target: "ex-withdraw",
      title: { he: "משיכה", en: "Withdraw" },
      body: { he: "מושכים כספים מהבורסה לכתובת חיצונית — מוגן בקוד ההגנה האישי שלכם.", en: "Withdraw funds from the exchange to an external address — guarded by your personal protection code." } },
  ],

  // Telegram — connect a bot and tune which alerts you receive.
  telegram: [
    { target: "tg-status",
      title: { he: "סטטוס טלגרם", en: "Telegram status" },
      body: { he: "מראה אם הטלגרם מחובר — וכך תדעו שההתראות יגיעו.", en: "Shows whether Telegram is connected — so you know alerts will arrive." } },
    { target: "tg-connect",
      title: { he: "חיבור הבוט", en: "Connect the bot" },
      body: { he: "מדביקים את ה-Bot token, לוחצים 'זהה' כדי למצוא את ה-Chat ID, ושומרים — וזהו, מחוברים.", en: "Paste your Bot token, hit Detect to find the Chat ID, and save — that's it, you're connected." } },
    { target: "tg-settings",
      title: { he: "אילו התראות לקבל", en: "Which alerts to get" },
      body: { he: "בוחרים אילו עדכונים יישלחו לטלגרם — סריקות, ריצות, מנוע המסחר ועוד.", en: "Choose which updates go to Telegram — scans, runs, the trading engine and more." } },
  ],

  // Learn — the lessons / reels feed.
  learn: [
    { target: "learn-tour",
      title: { he: "סיור וידאו מהיר", en: "Quick video tour" },
      body: { he: "תצוגה של 90 שניות שמסבירה את האפליקציה — נקודת התחלה מצוינת.", en: "A 90-second walkthrough of the app — a great place to start." } },
    { target: "learn-feed",
      title: { he: "השיעורים שלכם", en: "Your lessons" },
      body: { he: "פיד השיעורים — מחליקים מעלה/מטה כדי לעבור בין השיעורים, כמו רילס.", en: "The lessons feed — swipe up/down to move between lessons, just like reels." } },
    { target: "learn-play",
      title: { he: "איך מנגנים שיעור", en: "How to play a lesson" },
      body: { he: "מקישים על הסרטון כדי לנגן/לעצור, ובחיצים ▲▼ עוברים לשיעור הבא או הקודם.", en: "Tap the video to play/pause, and use the ▲▼ arrows to jump to the next or previous lesson." } },
  ],

  // Account / Profile — the profile hub (tiles for profile, account & settings, social).
  account: [
    { target: "account-profile",
      title: { he: "הפרופיל שלכם", en: "Your profile" },
      body: { he: "תמונה וכינוי — איך שתופיעו לחברים ובצ'אט.", en: "Photo and nickname — how you appear to friends and in chat." } },
    { target: "account-settings",
      title: { he: "חשבון והגדרות", en: "Account & settings" },
      body: { he: "אימייל, טלפון להתראות SMS, שינוי סיסמה, סטטוס הבורסה וכפתור ההתראות.", en: "Email, phone for SMS alerts, password change, exchange status and the notifications toggle." } },
    { target: "account-social",
      title: { he: "חברים וקבוצות", en: "Friends & groups" },
      body: { he: "הוספת חברים, אישור בקשות והקבוצות שלכם. (ערכת הנושא והשפה נמצאות למעלה בדף הבית.)", en: "Add friends, accept requests and your groups. (Theme & language live up on the Home header.)" } },
  ],

  // Admin — the admin springboard (four father tiles). Only rendered for admins.
  admin: [
    { target: "admin-users",
      title: { he: "משתמשים וגישה", en: "Users & access" },
      body: { he: "הענקת גישה והזמנות, פירוט משתמש (חיפוש), לוח התוצאות ובקשות עזרה — הכל תחת האריח הזה.", en: "Grant access & invites, User lookup, the Leaderboard and support requests — all under this tile." } },
    { target: "admin-trading",
      title: { he: "מסחר ורווח", en: "Trading & P&L" },
      body: { he: "מסחר עצמי (לייב), מנוע המסחר ודוח הריצות.", en: "Self-trading (live), the trading engine and the runs report." } },
    { target: "admin-system",
      title: { he: "מערכת ובוטים", en: "System & bots" },
      body: { he: "ניהול הבוטים וניטור המסכים של המשתמשים.", en: "The bot manager and live screen monitoring of users." } },
    { target: "admin-comms",
      title: { he: "תקשורת וקידום", en: "Comms & promo" },
      body: { he: "דיונים בצ'אט וקידום פיצ'ר חדש למשתמשים.", en: "Chat discussions and promoting a new feature to users." } },
  ],
};

// Build the localized step list for a screen (CoachMarks shape).
export function tourSteps(screen: string, he: boolean): CoachStep[] {
  return (TOURS[screen] || []).map((s) => ({
    target: s.target,
    title: he ? s.title.he : s.title.en,
    body: he ? s.body.he : s.body.en,
  }));
}

// Does this screen have a tour? (so the launcher never shows a dead button)
export function hasTour(screen: string): boolean {
  return (TOURS[screen]?.length || 0) > 0;
}

// Shared Next/Back/Skip/Done labels.
export function tourLabels(he: boolean): CoachLabels {
  return he
    ? { next: "הבא", back: "הקודם", skip: "דלג", done: "סיום" }
    : { next: "Next", back: "Back", skip: "Skip", done: "Done" };
}
