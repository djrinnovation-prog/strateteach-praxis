// Central registry of everywhere a home-page promo (and any deep-link) can point.
//
// This mirrors the app router — see components/Shell.tsx (`SCREENS` / `NAV`) for
// the top-level screens, plus the extra `/me`, `/plans`, `/activity` routes — so
// the promo target picker can list EVERY navigable destination, not just the
// main hub screens. Beyond the top level it also enumerates the sub-tabs that
// live inside the hubs (Strategy, Daily scan, Backtests, Chat). A sub-tab is
// addressed with a `?tab=<key>` query param; the target screen reads it on mount
// via `useDeepLinkTab` and opens that section. A bare path (no query) is a
// top-level screen.
//
// Admin-only screens (/admin, /screens) are intentionally excluded: a promo is
// broadcast to every user, and those routes redirect non-admins home.

export type PromoGroup = "trade" | "learn" | "connect" | "account";

export type Destination = { path: string; en: string; he: string; group: PromoGroup };

// Hub labels — kept in step with Shell's GROUP_LABEL (the side-nav groups).
export const PROMO_GROUP_LABEL: Record<PromoGroup, { en: string; he: string }> = {
  trade: { en: "Trading & analysis", he: "מסחר וניתוח" },
  learn: { en: "Learn", he: "למידה" },
  connect: { en: "Connect", he: "חיבורים ותקשורת" },
  account: { en: "Account & profile", he: "ניהול ופרופיל" },
};

// Order the optgroups appear in the picker.
export const PROMO_GROUP_ORDER: PromoGroup[] = ["trade", "learn", "connect", "account"];

export const DESTINATIONS: Destination[] = [
  // ── Trading & analysis ──────────────────────────────────────────────────
  { path: "/overview", en: "Dashboard", he: "דאשבורד", group: "trade" },
  { path: "/scanner", en: "Daily scan", he: "סריקה יומית", group: "trade" },
  { path: "/scanner?tab=crypto", en: "Daily scan · Crypto", he: "סריקה יומית · קריפטו", group: "trade" },
  { path: "/scanner?tab=stocks", en: "Daily scan · Stocks", he: "סריקה יומית · מניות", group: "trade" },
  { path: "/scanner?tab=metals", en: "Daily scan · Metals", he: "סריקה יומית · מתכות", group: "trade" },
  { path: "/scanner?tab=commodities", en: "Daily scan · Commodities", he: "סריקה יומית · סחורות", group: "trade" },
  { path: "/profit", en: "Trading engine", he: "מנוע מסחר", group: "trade" },
  { path: "/strategy", en: "Strategy Lab", he: "מעבדת אסטרטגיות", group: "trade" },
  { path: "/strategy?tab=strategies", en: "Strategy Lab · Strategies", he: "מעבדת אסטרטגיות · אסטרטגיות", group: "trade" },
  { path: "/strategy?tab=editor", en: "Strategy Lab · Editor", he: "מעבדת אסטרטגיות · עורך", group: "trade" },
  { path: "/strategy?tab=props", en: "Strategy Lab · Properties", he: "מעבדת אסטרטגיות · מאפיינים", group: "trade" },
  { path: "/strategy?tab=run", en: "Strategy Lab · Run & results", he: "מעבדת אסטרטגיות · הרצה ותוצאות", group: "trade" },
  { path: "/exchange", en: "Exchange", he: "בורסה", group: "trade" },
  { path: "/analytics", en: "Analytics", he: "אנליטיקה", group: "trade" },
  { path: "/backtests", en: "Backtests", he: "בדיקות עבר", group: "trade" },
  { path: "/backtests?tab=new", en: "Backtests · New backtest", he: "בדיקות עבר · בדיקה חדשה", group: "trade" },
  { path: "/backtests?tab=runs", en: "Backtests · Runs", he: "בדיקות עבר · ריצות", group: "trade" },
  { path: "/activity", en: "Activity log", he: "יומן פעילות", group: "trade" },

  // ── Learn ───────────────────────────────────────────────────────────────
  { path: "/university", en: "University", he: "אוניברסיטה", group: "learn" },
  { path: "/reels", en: "Reels (video course)", he: "רילים (קורס וידאו)", group: "learn" },

  // ── Connect ─────────────────────────────────────────────────────────────
  { path: "/telegram", en: "Telegram", he: "טלגרם", group: "connect" },
  { path: "/chat", en: "Chat", he: "צ'אט", group: "connect" },
  { path: "/chat?tab=new", en: "Chat · New chat", he: "צ'אט · שיחה חדשה", group: "connect" },
  { path: "/chat?tab=profile", en: "Chat · Profile", he: "צ'אט · פרופיל", group: "connect" },

  // ── Account & profile ───────────────────────────────────────────────────
  { path: "/me", en: "My profile", he: "הפרופיל שלי", group: "account" },
  { path: "/plans", en: "Plans & upgrade", he: "מסלולים ושדרוג", group: "account" },
  { path: "/privacy", en: "Privacy", he: "פרטיות", group: "account" },
  { path: "/settings", en: "Settings", he: "הגדרות", group: "account" },
];
