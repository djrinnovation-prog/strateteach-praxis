import {
  Rocket, Cpu, Bot, Radio, Search, FlaskConical, Wand2, ArrowLeftRight,
  LayoutDashboard, MessageCircle, Crown, GraduationCap, Play, BarChart3,
  Activity, UserRound, LifeBuoy, Send, Info,
} from "lucide-react";
import { isOwner } from "../app/api";
import type { SquareDef } from "../components/SquareRow";

// ── Shared "add more" pool for the editable central buttons ────────────────────
// Task 2b: every screen's central-button editor should offer a RICH set of real app
// destinations to ADD (not just the screen's own two). This is that pool — a catalog of
// common, real routes rendered as `secondary` GlassTile squares. A screen appends the
// pool to its own screen-specific squares and passes the combined list to <SquareRow>;
// the two screen-specific ones are `defaultShown`, everything here starts HIDDEN but is
// addable from the ✎ editor. Server-backed selection/order/reset come for free via SquareRow.
//
// Role-gating: owner-only destinations (Auto Pilots, Owners Portal) are dropped for
// non-owners. `locked` (the sectionAccess list) drops any section the user can't open,
// and `exclude` drops ids the screen already provides so there's never a duplicate id
// (which would break React keys + the layout arrangement).

type ExtraDef = SquareDef & { lock?: string; ownerOnly?: boolean };

export function centralExtras(
  he: boolean,
  nav: (p: string) => void,
  opts?: { exclude?: string[]; locked?: string[]; extraActions?: Record<string, () => void> },
): SquareDef[] {
  const exclude = new Set(opts?.exclude ?? []);
  const locked = new Set(opts?.locked ?? []);
  const owner = isOwner();

  // The full pool — order here is the order they appear in the editor's add-list.
  const pool: ExtraDef[] = [
    { id: "trading",   variant: "secondary", Icon: Rocket,          lock: "/trading",    label: he ? "מסחר" : "Trading",            sub: he ? "התחל לסחור" : "Start trading",   onClick: () => nav("/trading") },
    { id: "engine",    variant: "secondary", Icon: Cpu,             lock: "/profit",     label: he ? "מנוע מסחר" : "Trading Engine", sub: he ? "דמו ולייב" : "Demo & live",       onClick: () => nav("/profit") },
    { id: "signalbot", variant: "secondary", Icon: Bot,             lock: "/bots",       label: he ? "סיגנל בוט" : "Signal Bot",    sub: "TradingView",                          onClick: () => nav("/bots") },
    { id: "scanner",   variant: "secondary", Icon: Search,          lock: "/scanner",    label: he ? "סריקה יומית" : "Daily scan",  sub: he ? "פריצות בזמן אמת" : "Live breakouts", onClick: () => nav("/scanner") },
    { id: "backtests", variant: "secondary", Icon: FlaskConical,    lock: "/backtests",  label: he ? "בדיקות" : "Backtest",         sub: he ? "תוצאות אסטרטגיה" : "Strategy results", onClick: () => nav("/backtests") },
    { id: "strategy",  variant: "secondary", Icon: Wand2,           lock: "/strategy",   label: he ? "מעבדת אסטרטגיות" : "Strategy", sub: he ? "בנייה וכוונון" : "Build & tune",  onClick: () => nav("/strategy") },
    { id: "exchange",  variant: "secondary", Icon: ArrowLeftRight,  lock: "/exchange",   label: he ? "בורסה" : "Exchange",          sub: he ? "חשבונות ומפתחות" : "Accounts & keys", onClick: () => nav("/exchange") },
    { id: "dashboard", variant: "secondary", Icon: LayoutDashboard, lock: "/overview",   label: he ? "לוח בקרה" : "Dashboard",      sub: he ? "סיכומים חיים" : "Live totals",    onClick: () => nav("/overview") },
    { id: "analytics", variant: "secondary", Icon: BarChart3,       lock: "/analytics",  label: he ? "ביצועים" : "Performance",     sub: he ? "מדדים ותשואות" : "Metrics & returns", onClick: () => nav("/analytics") },
    { id: "chat",      variant: "secondary", Icon: MessageCircle,   lock: "/chat",       label: he ? "צ'אט" : "Chat",               sub: he ? "חברים וקבוצות" : "Friends & groups", onClick: () => nav("/chat") },
    { id: "telegram",  variant: "secondary", Icon: Send,            lock: "/telegram",   label: he ? "טלגרם" : "Telegram",          sub: he ? "התראות" : "Alerts",               onClick: () => nav("/telegram") },
    { id: "learn",     variant: "secondary", Icon: GraduationCap,   lock: "/university", label: he ? "למידה" : "Learn",             sub: he ? "אקדמיה והסברים" : "Academy & terms", onClick: () => nav("/university") },
    { id: "reels",     variant: "secondary", Icon: Play,            lock: "/reels",      label: he ? "רילים" : "Reels",             sub: he ? "קורס וידאו" : "Video course",     onClick: () => nav("/reels") },
    { id: "plans",     variant: "secondary", Icon: Crown,           lock: "/plans",      label: he ? "מסלולים" : "Plans",           sub: he ? "שדרוג" : "Upgrade",               onClick: () => nav("/plans") },
    { id: "activity",  variant: "secondary", Icon: Activity,        lock: "/activity",   label: he ? "פעילות" : "Activity",         sub: he ? "יומן פעולות" : "Activity log",    onClick: () => nav("/activity") },
    { id: "account",   variant: "secondary", Icon: UserRound,       lock: "/me",         label: he ? "החשבון שלי" : "Account",      sub: he ? "פרטים והגדרות" : "Details & settings", onClick: () => nav("/me") },
    { id: "help",      variant: "secondary", Icon: LifeBuoy,        lock: "/requests",   label: he ? "עזרה" : "Help",               sub: he ? "בקשות ותמיכה" : "Requests & support", onClick: () => nav("/requests") },
    // Owner-only destinations.
    { id: "pilots",    variant: "secondary", Icon: Radio,           ownerOnly: true,     label: he ? "טייסים אוטומטיים" : "Auto Pilots", sub: he ? "סימולציה" : "simulation",    onClick: () => nav("/owners?tab=autopilots") },
    { id: "owners",    variant: "secondary", Icon: Crown,           lock: "/owners", ownerOnly: true, label: he ? "פורטל בעלים" : "Owners Portal", sub: he ? "ניהול" : "Management",       onClick: () => nav("/owners") },
    { id: "about",     variant: "secondary", Icon: Info,            label: he ? "מי אנחנו" : "About",          sub: he ? "על המערכת" : "About the app",   onClick: () => (opts?.extraActions?.about ? opts.extraActions.about() : nav("/me?sec=about")) },
  ];

  return pool
    .filter((s) => !exclude.has(s.id))
    .filter((s) => !(s.ownerOnly && !owner))
    .filter((s) => !(s.lock && locked.has(s.lock)))
    .map(({ lock: _l, ownerOnly: _o, ...sq }) => sq);
}
