import React, { useState, Suspense, lazy } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import {
  Diamond, Search, Gauge, FlaskConical, LayoutDashboard, Wand2, ArrowLeftRight,
  TrendingUp, Send, Activity, Settings as SettingsIcon, Languages, LogOut, X, Home as HomeIcon, GraduationCap,
  BarChart3, MessageCircle, MonitorPlay, Menu as MenuIcon, Clapperboard, ChevronDown, UserRound, Crown, Sparkles,
  ShieldCheck, ChevronLeft, ChevronRight, Mail, Pencil, Check, Lock, Inbox, Bot, HelpCircle, LifeBuoy, Bell, Palette, Rocket, Scale, Gem, Wrench, Briefcase, ClipboardCheck, ClipboardList, ListChecks,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { api, isOwner, isLegalEditor, isItEditor, isBizEditor, isContentEditor, isReviewer, isFullViewer } from "../app/api";
import { C, UI } from "../theme";
import type { User } from "../App";
import Home from "../screens/Home";            // landing — keep eager so first paint is instant
import Placeholder from "../screens/Placeholder";
import HomeBackdrop from "./HomeBackdrop";
import TabBar from "./TabBar";
import ThemeControl from "./ThemeControl";
import AccessibilityControl from "./AccessibilityControl";
import { BUILD_STAMP } from "../lib/build";

// Every other screen is code-split: it downloads only when the user opens it,
// so the initial mobile bundle stays small (big win on iOS Safari over cellular).
const Scanner = lazy(() => import("../screens/Scanner"));
const Backtests = lazy(() => import("../screens/Backtests"));
const Dashboard = lazy(() => import("../screens/Dashboard"));
const Strategy = lazy(() => import("../screens/Strategy"));
// Client-facing GUIDED strategy builder (learn-and-approve, transparent, demo-only) —
// the regulatory-safe path: the USER learns each concept + approves each choice.
const GuidedBuilder = lazy(() => import("../screens/GuidedBuilder"));
const Exchange = lazy(() => import("../screens/Exchange"));
const Profit = lazy(() => import("../screens/Profit"));
// Trading PARENT hub (Dan's option A) — Home's Trading tile opens this; 3 central
// buttons drill into Daily Engine (/profit) · Auto Pilots · Signal Bot (/bots).
const Trading = lazy(() => import("../screens/Trading"));
// Personal Portal PARENT — Home's second square opens this; 2 central buttons drill into
// Account (/me) + Exchange connect (/exchange?sec=connect).
const PersonalPortal = lazy(() => import("../screens/PersonalPortal"));
const Telegram = lazy(() => import("../screens/Telegram"));
const Activity_ = lazy(() => import("../screens/Activity"));
const University = lazy(() => import("../screens/University"));
const BeginnerGuide = lazy(() => import("../screens/BeginnerGuide"));
const Reels = lazy(() => import("../screens/Reels"));
const Analytics = lazy(() => import("../screens/Analytics"));
const Chat = lazy(() => import("../screens/Chat"));
const Screens = lazy(() => import("../screens/Screens"));
// Admin is no longer routed here — it's folded into /me (ניהול). The /admin path
// redirects into the unified view (see the Routes block). Account owns the single
// lazy(() => import("../screens/Admin")) that reuses Admin's existing chunk.
const Account = lazy(() => import("../screens/Account"));
const Plans = lazy(() => import("../screens/Plans"));
const Privacy = lazy(() => import("../screens/Privacy"));
const TeamMessages = lazy(() => import("../screens/TeamMessages"));
const SignalBots = lazy(() => import("../screens/SignalBots"));
// Service Hub — admin "Reply to users" composer reached from a sidebar shortcut.
// Reuses the existing AdminMessage screen (the Admin → Comms → "Reply to user" tool).
const ReplyUsers = lazy(() => import("../screens/AdminMessage"));
// Owner / Requests portal — mini help-desk (user requests + internal owner notes).
// Same screen, role-gated: owners manage everything; a user sees only their own.
const Requests = lazy(() => import("../screens/Requests"));
// Legal Portal — the private Raz ↔ owners workspace (chat / sections / editing / tasks /
// report). Gated to legal_editor + owners only. The old standalone Legal Console is merged
// in as the portal's "עריכה" (Editing) tab; /legal-admin now redirects here.
const LegalPortal = lazy(() => import("../screens/LegalPortal"));
// IT Portal — the private Oren ↔ owners workspace (mirrors the Legal Portal). Gated to
// it_editor + owners only. Phase 1 is a placeholder; the full portal lands in later phases.
const ItPortal = lazy(() => import("../screens/ItPortal"));
// Business Development Portal — the private Raful ↔ owners workspace (mirrors the IT Portal).
// Gated to biz_editor + owners only.
const BizPortal = lazy(() => import("../screens/BizPortal"));
// Owners Portal (Phase 1) — the owners' showcase + team + progress view; the entry point
// to the bigger owners/PM system. Gated to full admins OR the `owner` grant (see route).
const Owners = lazy(() => import("../screens/Owners"));
// Staff Audit landing — the role-aware landing for STAFF collaborators (Raz/Oren/Raful legal/
// IT/biz editors, or a residual role=='admin'), gated (editor||admin) && !owner. A locked
// launcher (FramedTitle + shortcuts + 2 central buttons) drawn from the existing AuditPortal.
const StaffAudit = lazy(() => import("../screens/StaffAudit"));
// Guide Manager — owner/admin console for Yoav's animated Home guide (captions, order,
// voice + character assets, on/off, launch behaviour). Gated to owner OR role==admin.
const GuideManager = lazy(() => import("../screens/GuideManager"));
// Review inbox — Dan's mini-portal for the multi-user Review board (owners + it_editor).
const ReviewInbox = lazy(() => import("../screens/ReviewInbox"));

const SCREENS: Record<string, React.FC<any>> = {
  "/scanner": Scanner,
  "/backtests": Backtests,
  "/overview": Dashboard,
  "/strategy": Strategy,
  "/guided-builder": GuidedBuilder,
  "/exchange": Exchange,
  "/profit": Profit,
  "/telegram": Telegram,
  "/activity": Activity_,
  "/privacy": Privacy,
  "/university": University,
  "/reels": Reels,
  "/analytics": Analytics,
  "/chat": Chat,
  "/screens": Screens,
};

const NAV = [
  { path: "/university", key: "university", Icon: GraduationCap, group: "learn" },
  { path: "/reels", key: "reels", Icon: Clapperboard, group: "learn", badge: "BETA" },
  { path: "/overview", key: "dashboard", Icon: LayoutDashboard, group: "trade" },
  { path: "/scanner", key: "scanner", Icon: Search, group: "trade" },
  { path: "/profit", key: "profit", Icon: TrendingUp, group: "trade" },
  { path: "/strategy", key: "strategy", Icon: Wand2, group: "trade" },
  // Exchange lives ONCE in the sidebar — as the "Exchange" Quick-option under Home.
  // This older "Exchange connect" trade-group duplicate is hidden from the nav list
  // (hidden:true) but KEPT in NAV so its /exchange route + mobile header title still work.
  { path: "/exchange", key: "exchange", Icon: ArrowLeftRight, group: "trade", hidden: true },
  { path: "/analytics", key: "analytics", Icon: BarChart3, group: "trade" },
  { path: "/backtests", key: "backtests", Icon: FlaskConical, group: "trade" },
  { path: "/telegram", key: "telegram", Icon: Send, group: "connect" },
  { path: "/chat", key: "chat", Icon: MessageCircle, group: "connect" },
  { path: "/screens", key: "screens", Icon: MonitorPlay, admin: true, group: "account" },
  { path: "/privacy", key: "privacy", Icon: ShieldCheck, group: "account" },
] as const;

const GROUP_LABEL: Record<string, { he: string; en: string }> = {
  learn: { he: "למידה", en: "Learn" },
  trade: { he: "מסחר וניתוח", en: "Trading & analysis" },
  connect: { he: "חיבורים ותקשורת", en: "Connect" },
  account: { he: "ניהול", en: "Account" },
};

// ── Sidebar "Quick options" (under Home) ──────────────────────────────────────
// A customizable shortcut list shown directly beneath the Home item. It REUSES the
// SAME customization MECHANISM as the Home "shortcuts" row (a localStorage-persisted
// id selection + an add/remove edit sheet + reset-to-default), but as its OWN
// instance: separate storage key, separate catalog and default ORDER, so the two
// lists stay independent (sharing one key would wrongly couple the menu list to the
// Home row). `lock` is the bare route checked against the same `locked` list the NAV
// items use, so a plan-locked section is hidden/disabled here too.
// A quick option is either a navigation target (`path` + `lock`) OR an action
// (`action`) for things that aren't routes (Help/Search modal, AI guide quiz).
type QuickOpt = { id: string; path?: string; action?: "help" | "aiguide"; lock?: string; he: string; en: string; Icon: any };
// Quick shortcuts = a customizable FAVORITES row. It's de-duped against the priority
// groups below: its DEFAULT is the destinations that DON'T live in a group (Dashboard,
// Performance, Chat, Telegram), so a fresh menu never repeats a group item. The full
// catalog stays available in the edit sheet for power users. No pinned item.
const QUICK_PINNED = "";
const QUICK_CATALOG: QuickOpt[] = [
  { id: "dashboard",   path: "/overview",   lock: "/overview",   he: "לוח",              en: "Dashboard",       Icon: LayoutDashboard },
  { id: "performance", path: "/analytics",  lock: "/analytics",  he: "ביצועים",          en: "Performance",     Icon: BarChart3 },
  { id: "chat",        path: "/chat",       lock: "/chat",       he: "צ'אט",             en: "Chat",            Icon: MessageCircle },
  { id: "telegram",    path: "/telegram",   lock: "/telegram",   he: "טלגרם",            en: "Telegram",        Icon: Send },
  { id: "exchange",    path: "/exchange",   lock: "/exchange",   he: "בורסה",            en: "Exchange",        Icon: ArrowLeftRight },
  { id: "learn",       path: "/university", lock: "/university", he: "למידה",            en: "Learn",           Icon: GraduationCap },
  { id: "account",     path: "/me",         lock: "/me",         he: "החשבון שלי",       en: "Account",         Icon: UserRound },
  { id: "profit",      path: "/profit",     lock: "/profit",     he: "מנוע מסחר",        en: "Trading engine",   Icon: TrendingUp },
  { id: "scan",        path: "/scanner",    lock: "/scanner",    he: "סריקה יומית",      en: "Daily scan",      Icon: Search },
  { id: "backtest",    path: "/backtests",  lock: "/backtests",  he: "בדיקות",           en: "Backtest",        Icon: FlaskConical },
  { id: "strategylab", path: "/strategy",   lock: "/strategy",   he: "מעבדת אסטרטגיות",  en: "Strategy lab",    Icon: Wand2 },
  { id: "signalbot",   path: "/bots",       lock: "/bots",       he: "סיגנל בוט",        en: "Signal Bot",      Icon: Bot },
];
// Default = the destinations NOT in the priority groups (no repetition of group items).
const QUICK_DEFAULT = ["dashboard", "performance", "chat", "telegram"];
const QUICK_KEY = "algo770_sidebar_quickopts";
// Persisted expand/collapse state of the side-menu accordion groups (per group key).
const MENU_GROUPS_KEY = "algo770_sidebar_groups";
function loadQuick(): string[] {
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    if (!raw) return [...QUICK_DEFAULT];
    const arr = JSON.parse(raw);
    const valid = Array.isArray(arr)
      ? arr.filter((id) => typeof id === "string" && QUICK_CATALOG.some((q) => q.id === id))
      : [];
    return valid.length ? valid : [...QUICK_DEFAULT];
  } catch { return [...QUICK_DEFAULT]; }
}

export default function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { t, rtl, lang, setLang } = useI18n();
  const loc = useLocation();
  const nav = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const mobile = useIsMobile();
  const accessQ = useQuery({ queryKey: ["sectionAccess"], queryFn: () => api.sectionAccess(), staleTime: 30000 });
  // Owners (Dan/Rafi/Yoav — may be role=='user') and role=='admin' users both see everything
  // unlocked; a plain user is subject to section locking. NOTE isAdmin ALSO gates admin-only
  // TOOLS below (reply-users / guide-manager, whose backends are require_admin) — so it must
  // stay owner/admin only, never widened to a collaborator flag.
  const isAdmin = user.role === "admin" || isOwner() || !!(accessQ.data as any)?.isAdmin;
  // SCREEN visibility only: a full-viewer (owner or IT editor / Oren) sees every app screen
  // unlocked — WITHOUT admin tools. Finance is a separate isOwner() gate, so this never money.
  const unlockAll = isAdmin || isFullViewer();
  const locked: string[] = unlockAll ? [] : ((accessQ.data as any)?.locked || []);

  // ROLE-AWARE landing. Regular users get the Home springboard (untouched). PURE STAFF
  // collaborators (Raz/Raful — legal/biz editors) land on their Staff Audit launcher instead.
  // The IT editor (Oren) and any ADMIN are FULL VIEWERS (Dan's rule: see everything except
  // money), so they are NOT staff — they keep the normal Home layout and see every screen,
  // with no portal-only restriction. (Owners keep Home for now.)
  const isStaff = (isLegalEditor() || isBizEditor()) && !isOwner() && !isItEditor() && user.role !== "admin";
  if (loc.pathname === "/" && isStaff) return <Navigate to="/staff-audit" replace />;
  // The springboard owns the whole viewport; the nav appears as an overlay drawer.
  if (loc.pathname === "/") {
    return (
      <>
        <Home onMenu={() => setDrawer(true)} />
        <NavPanel as="overlay" open={drawer} onClose={() => setDrawer(false)} user={user} onLogout={onLogout} locked={locked} />
      </>
    );
  }

  return (
    <>
    {/* Same ambient backdrop the Home springboard uses (skin-aware radial glow +
        glows + starfield), so every inner screen matches home. The app-wide
        BitcoinBackground (drifting market symbols) still layers behind too. The
        content wrapper stays transparent so this fixed backdrop shows through.
        On the OWNERS portal it renders in `quiet` mode (static, no starfield) so
        that screen feels clean + fast (Dan: "very loaded" + slow). */}
    <HomeBackdrop quiet={loc.pathname.startsWith("/owners")} />
    {/* APP SHELL — a PERCENTAGE height chain (height:100% of #root, which is height:100%
        of body → html → the viewport). This is deliberately NOT viewport units and NOT
        position:fixed: a % chain is the ONLY sizing that cascades correctly through
        `html { zoom }` (the large-text a11y mode sets zoom:1.15 in theme.ts). Viewport
        units (100dvh/svh) do NOT scale with zoom → they render ~15% too tall, so the
        bottom is pushed off-screen (Dan's "content cut off, can't reach the bottom") and
        the outer page scrolls into an empty area on mobile. With this chain the shell is
        EXACTLY the rendered viewport at any zoom.
        It's a flex box: the top header (mobile) / left sidebar (desktop) are NON-scrolling
        flex children (flex-shrink:0), and the <main> between them is the ONE scroll region
        (flex:1 + min-height:0 + overflow-y:auto), so only the middle scrolls to the true
        content bottom — the header and the fixed bottom tab bar stay put. `overflow:hidden`
        contains everything so nothing leaks a body scroll; screen modals are `position:fixed`
        (no transformed ancestor here) so they still cover it.
        `position:relative` is REQUIRED: it makes the `zIndex:1` active so the shell forms a
        stacking context ABOVE the fixed z-index:0 backdrops (HomeBackdrop + BitcoinBackground)
        — exactly what the old `position:fixed` did. Without it the shell is static, zIndex:1 is
        inert, and the shell's non-positioned content (top toolbar / tabs / section headers)
        paints BEHIND those backdrops (they wash it out → "tabs gone / faint unstyled buttons").
        relative does NOT create a containing block for position:fixed (only transform/filter/
        will-change do), so the tab bar + screen modals still anchor to the viewport. */}
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column",
      overflow: "hidden", fontFamily: UI, color: C.text, direction: rtl ? "rtl" : "ltr", background: "transparent", zIndex: 1 }}>
      {/* DESKTOP now matches HOME: NO left sidebar — a single CENTERED content column + the
          ☰ drawer (overlay) for nav (plus the 5-tab bar + the on-screen shortcuts row). This
          keeps the title + content at the EXACT same size + horizontal centre on Home and on
          every inner screen, so nothing shifts when navigating. The ☰ trigger + Home live in
          the per-screen top row below. */}
      <NavPanel as="overlay" open={drawer} onClose={() => setDrawer(false)} user={user} onLogout={onLogout} locked={locked} />
      {/* THE single scroll region — fills the space between the header/sidebar and the fixed
          bottom tab bar, and scrolls INTERNALLY when the content is tall, so LONG screens
          (positions, backtests) reach their bottom on BOTH mobile and desktop.
          Sizing is pure flex — NO viewport units (100dvh/svh), so it's zoom-robust: the
          shell has a definite height (height:100% of #root), and flex:1 + min-height:0
          make <main> fill EXACTLY the remaining space and scroll there.
          • DESKTOP (row flex): the shell's default align-items:stretch already gives <main>
            the full shell height (the sidebar sits beside it); flex:1 governs its width.
          • MOBILE (column flex): flex:1 + minHeight:0 bound it to the space under the fixed
            header, and it scrolls there.
          overscroll-behavior:contain keeps a bounce from chaining to the (non-scrolling) body;
          the content's own paddingBottom reserves room so the last card clears the tab bar. */}
      <main style={{ flex: 1, minWidth: 0, minHeight: 0,
        overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" as any, overscrollBehavior: "contain" }}>
        <style>{"@keyframes pageSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}"}</style>
        {/* Reserve a safe gutter on BOTH inline edges for the edge-docked widgets.
            Two groups live on the viewport edges (all `position: fixed`):
              • inline-END   → Activity / Profit drawer tabs  (left in RTL, right in LTR)
              • inline-START → rail: Improve / Learn / Music / rail-toggle
            Because the page is full-bleed on mobile, without these gutters the tabs
            sit ON TOP of the content (cards, action buttons). Reserving both sides
            keeps content clear of either group in either direction; the
            safe-area-insets handle the iOS notch / rounded-corner zone. */}
        {/* paddingTop gives the top toolbar/tab row (Back/Home + chrome cluster, and each
            screen's own tabs — e.g. the Owners portal / Dashboard) clear breathing room from
            the very top edge (Dan: the top tabs were crammed at the top / hard to see). It's
            a real gap, NOT a viewport unit, so it survives the % height chain. paddingBottom
            (explicit so it wins the bottom edge) reserves room for the persistent bottom tab
            bar so it never covers the page content. */}
        {/* Desktop: SYMMETRIC inline padding so the centered column is truly page-centred
            (matches Home — no rightward shift from the old sidebar/asymmetric gutter). Mobile
            keeps the wider start/end gutter for the edge-docked drawer tabs. */}
        {/* Bottom pad is just breathing room now — the TabBar is a REAL flex child BELOW <main>
            (not a fixed overlay), so the content no longer has to reserve TABBAR_H + safe-area
            to clear it (the bar occupies its own space in the column). */}
        <div key={loc.pathname} style={{ maxWidth: mobile ? 1080 : 900, margin: "0 auto", paddingTop: mobile ? 20 : 34, paddingInlineStart: `calc(${mobile ? 36 : 20}px + env(safe-area-inset-left, 0px))`, paddingInlineEnd: `calc(${mobile ? 52 : 20}px + env(safe-area-inset-right, 0px))`, paddingBottom: mobile ? 20 : 24, animation: "pageSlide 0.28s cubic-bezier(0.22,0.61,0.36,1)" }}>
          {/* per-screen top — MINIMAL (Dan): ☰ menu + Back + a small LOCATION indicator +
              Home. Desktop has NO sidebar now, so the ☰ opens the nav drawer (like Home);
              global controls (skin · accessibility · help · settings) live in that drawer. */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <button onClick={() => setDrawer(true)} aria-label={lang === "he" ? "תפריט" : "Menu"} title={lang === "he" ? "תפריט" : "Menu"} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, color: C.text, borderRadius: 14, padding: "7px 12px", cursor: "pointer", fontFamily: UI, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.24), 0 6px 16px -12px rgba(0,0,0,0.35)" }}>
              <MenuIcon size={17} color={C.gold} />
            </button>
            <button onClick={() => nav(-1)} title={lang === "he" ? "חזרה" : "Back"} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, color: C.text, borderRadius: 14, padding: "7px 14px", fontSize: 12.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer", fontFamily: UI, whiteSpace: "nowrap", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.24), 0 6px 16px -12px rgba(0,0,0,0.35)" }}>
              {rtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />} {lang === "he" ? "חזרה" : "Back"}
            </button>
            {(() => {
              const nk = NAV.find((n) => n.path === loc.pathname)?.key;
              const extra: Record<string, string> = {
                "/trading": lang === "he" ? "מסחר" : "Trading", "/personal": lang === "he" ? "פורטל אישי" : "Personal Portal",
                // /exchange launcher = "בורסה" (NOT the nav-key label "חיבור בורסה / Exchange
                // connect" — connect is a child, not the launcher).
                "/exchange": lang === "he" ? "בורסה" : "Exchange",
                "/me": lang === "he" ? "החשבון שלי" : "Account", "/activity": lang === "he" ? "פעילות" : "Activity",
                "/plans": lang === "he" ? "מסלולים" : "Plans", "/requests": lang === "he" ? "עזרה" : "Help",
                "/team-messages": lang === "he" ? "הודעות מהצוות" : "Team messages",
              };
              // extra map takes PRECEDENCE over the nav-key i18n label (which can be a
              // connect-flow name like "Exchange connect").
              const locName = extra[loc.pathname] || (nk && (t as any)[nk]) || "";
              return locName ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0, fontSize: 13, fontWeight: 800, color: C.text }}>
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: C.gold, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{locName}</span>
                </span>
              ) : null;
            })()}
            <span style={{ flex: 1 }} />
            <button onClick={() => nav("/")} aria-label={lang === "he" ? "בית" : "Home"} title={lang === "he" ? "לדף הבית" : "Home"} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, color: C.gold, borderRadius: 14, padding: "7px 12px", fontSize: 12, fontWeight: 900, letterSpacing: "0.1em", cursor: "pointer", fontFamily: UI, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.24), 0 6px 16px -12px rgba(0,0,0,0.35)" }}>
              <HomeIcon size={15} /> ALGO770
            </button>
          </div>
          <Suspense fallback={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "60px 0", color: C.muted }}>
              <div style={{ width: 28, height: 28, border: `3px solid ${C.line}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
            </div>
          }>
            <Routes>
              {NAV.map(({ path, key }) => {
                const Screen = SCREENS[path];
                const el = locked.includes(path) ? <Navigate to="/" replace /> : (Screen ? <Screen /> : <Placeholder title={key} />);
                return <Route key={path} path={path} element={el} />;
              })}
              <Route path="/activity" element={<Activity_ />} />
              {/* Trading PARENT hub — reached from Home's Trading tile + the Trading tab. */}
              <Route path="/trading" element={<Trading />} />
              {/* Personal Portal PARENT — reached from Home's second square. */}
              <Route path="/personal" element={<PersonalPortal />} />
              {/* Settings/Account merge — Step 1: /settings is retired into the unified
                  "החשבון שלי" hub at /me. Redirect keeps every old link/deep-tour working. */}
              <Route path="/settings" element={<Navigate to="/me" replace />} />
              {/* Step 4: /admin is folded into /me → ניהול. Redirect deep-links to that
                  section (role-gated inside Account; a non-manager just lands on /me). */}
              <Route path="/admin" element={<Navigate to="/me?sec=management" replace />} />
              <Route path="/me" element={<Account />} />
              <Route path="/team-messages" element={<TeamMessages />} />
              <Route path="/reply-users" element={isAdmin ? (
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 900, color: C.text, margin: "0 0 4px" }}>{lang === "he" ? "מענה למשתמשים" : "Reply to users"}</h2>
                  <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 16px", lineHeight: 1.5 }}>{lang === "he" ? "שלחו מענה אישי וממותג לכל משתמש — נשמר ומופיע אצלו ב\"הודעות מהצוות\"." : "Send a personal, branded reply to any user — stored in their \"Messages from the team\" inbox."}</p>
                  <ReplyUsers />
                </div>
              ) : <Navigate to="/" replace />} />
              <Route path="/guide" element={<BeginnerGuide />} />
              {/* Guided strategy builder — an OPEN educational/demo feature (never plan-locked):
                  explicit route so it renders for every user, reached from the Home tile. */}
              <Route path="/guided-builder" element={<GuidedBuilder />} />
              <Route path="/requests" element={<Requests />} />
              {/* The old standalone Legal Console is merged into the portal — its editor is
                  now the portal's "עריכה" tab. Keep the route as a redirect so old links work. */}
              <Route path="/legal-admin" element={<Navigate to="/legal-portal?tab=editing" replace />} />
              <Route path="/legal-portal" element={<LegalPortal />} />
              {/* Oren's private IT portal — mirrors the Legal Portal (it_editor + owners only). */}
              <Route path="/it-portal" element={<ItPortal />} />
              {/* Raful's private Business Development portal — mirrors the IT Portal (biz_editor + owners only). */}
              <Route path="/biz-portal" element={<BizPortal />} />
              {/* /owners: a FULL VIEWER (owner OR the IT editor / Oren) loads the Owners Portal —
                  the Portal itself keeps Finance/Employees/AutoPilots/Audit strictly isOwner(),
                  so a non-owner full-viewer sees the VIEWS but never the money. The remaining
                  collaborators (legal_editor → /legal-portal, biz_editor → /biz-portal) are
                  redirected to their OWN portal; anyone else falls through to Owners' own gate. */}
              <Route path="/owners" element={
                isFullViewer() ? <Owners />
                : isLegalEditor() ? <Navigate to="/legal-portal" replace />
                : isBizEditor() ? <Navigate to="/biz-portal" replace />
                : <Owners />
              } />
              <Route path="/bots" element={<SignalBots />} />
              {/* Staff Audit landing — reachable directly, and where the "/" role-aware
                  redirect sends staff collaborators (non-owner legal/IT/biz editors / admin). */}
              <Route path="/staff-audit" element={<StaffAudit />} />
              <Route path="/plans" element={<Plans />} />
              {/* Guide Manager — owner/admin only (owners + role==admin). A non-privileged
                  user is bounced Home. The server also enforces this (require_admin). */}
              <Route path="/guide-manager" element={isAdmin ? <GuideManager /> : <Navigate to="/" replace />} />
              {/* Review inbox — owners + collaborators (Oren/Raz/Raful); the server enforces the same. */}
              <Route path="/review-inbox" element={isReviewer() ? <ReviewInbox /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      {/* Persistent bottom tab bar — mounted INSIDE this app-layout div (its stacking
          context) so screen modals (z >= 1000) and the side drawer (z 49) layer above
          it correctly. Additive: the header, circle hub and back/home buttons are
          untouched. (On the "/" springboard the bar is rendered by Home itself.) */}
      <TabBar />
    </div>
    </>
  );
}

function NavPanel({ as, open, onClose, user, onLogout, locked = [] }: {
  as: "fixed" | "overlay"; open?: boolean; onClose?: () => void; user: User; onLogout: () => void; locked?: string[];
}) {
  const { t, rtl, lang, setLang } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const overlay = as === "overlay";
  // Collaborators (Oren/Raz) reach their OWN portal via the dedicated Legal/IT nav groups
  // below — the Owners nav is owners-only — so Shell no longer resolves a PM partner id here.
  // Collapsible menu groups (accordion). Every group is COLLAPSED by default so the menu
  // stays compact (no long scroll) — EXCEPT the group that holds the CURRENT ROUTE, which
  // auto-expands so the active item is visible. The user's own expand/collapse choices are
  // persisted (localStorage) and stick across opens. Home stays pinned ABOVE the groups
  // (never collapsible). Multiple groups may be open — tapping a header toggles just it.
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(MENU_GROUPS_KEY) || "{}") || {}; } catch { return {}; }
  });
  // Effective open state: an explicit stored choice wins; otherwise default = "holds the
  // active route" (so the active group opens, everything else stays collapsed).
  const grpOpen = (key: string, containsActive: boolean) => (key in groupsOpen ? groupsOpen[key] : containsActive);
  const toggleGrp = (key: string, containsActive: boolean) => {
    const next = { ...groupsOpen, [key]: !grpOpen(key, containsActive) };
    setGroupsOpen(next);
    try { localStorage.setItem(MENU_GROUPS_KEY, JSON.stringify(next)); } catch { /* */ }
  };

  // Quick options (under Home) — customizable, same mechanism as the Home shortcuts row.
  const [quick, setQuick] = useState<string[]>(() => loadQuick());
  const [editQuick, setEditQuick] = useState(false);
  const saveQuick = (ids: string[]) => { setQuick(ids); try { localStorage.setItem(QUICK_KEY, JSON.stringify(ids)); } catch (_e) { /* */ } };
  // The pinned "support" portal can't be toggled off — it's always the first quick option.
  const toggleQuick = (id: string) => { if (id === QUICK_PINNED) return; saveQuick(quick.includes(id) ? quick.filter((x) => x !== id) : [...quick, id]); };

  if (overlay && !open) return null;

  const go = (path: string) => { nav(path); onClose?.(); };
  // Run a quick option: navigate for path items, or trigger the right action for
  // the route-less ones (Help/Search modal, AI-guide quiz). The help action keeps
  // the drawer open so HelpSearch (rendered in this panel) catches the event.
  const runQuick = (q: QuickOpt) => {
    if (q.action === "aiguide") { window.dispatchEvent(new Event("algo770-onboarding-quiz")); onClose?.(); return; }
    if (q.action === "help") { window.dispatchEvent(new Event("algo770-help-open")); return; }
    if (q.path) go(q.path);
  };

  // Frosted icon button (X close / home) — defined HERE (not module scope) so the C.glass
  // getters are read per-render and follow live skin/mode changes.
  const iconBtn: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any, border: `1px solid ${C.glassBd}`, cursor: "pointer", boxShadow: C.glassHi };

  // One collapsible menu SECTION — a tappable header (accent tick + small-caps label +
  // chevron) that expands/collapses its rows. A render helper (not a component) so React
  // never remounts the rows. `headerExtra` slots an inline control into the header (the
  // Quick-options ✎ Edit); it stops propagation so it doesn't toggle the section.
  const groupSection = (gkey: string, label: string, containsActive: boolean, rows: React.ReactNode, headerExtra?: React.ReactNode) => {
    const open = grpOpen(gkey, containsActive);
    return (
      <div style={{ marginTop: 6 }}>
        <button onClick={() => toggleGrp(gkey, containsActive)}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "10px 11px 6px", marginBottom: 3,
            border: "none", borderBottom: `1px solid ${C.glassBd}`, background: "none", cursor: "pointer", fontFamily: UI, textAlign: rtl ? "right" : "left" }}>
          <span style={{ width: 3, height: 11, borderRadius: 2, background: C.accentGrad, flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: C.muted, fontFamily: UI }}>{label}</span>
          {headerExtra}
          <span style={{ marginInlineStart: headerExtra ? 0 : "auto", display: "inline-flex", opacity: 0.8 }}>
            {open ? <ChevronDown size={14} color={C.muted} /> : (rtl ? <ChevronLeft size={14} color={C.muted} /> : <ChevronRight size={14} color={C.muted} />)}
          </span>
        </button>
        {open && rows}
      </div>
    );
  };

  const panel = (
    <aside style={{
      // Frosted-glass drawer — same design language as the Home glass pass: a high-opacity
      // tonal frost (legible) over a backdrop blur, with a hairline edge + soft top highlight.
      width: 248, flexShrink: 0, background: C.glassPanel,
      backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
      borderInlineEnd: `1px solid ${C.glassBd}`, boxShadow: C.glassHi,
      display: "flex", flexDirection: "column", boxSizing: "border-box", overflow: "hidden",
      // Bottom padding respects the mobile home-indicator safe area so the footer + last
      // rows never sit under it. `overflow:hidden` here + the nav's own scroll below keep
      // the panel exactly one viewport tall (content can't spill past the bottom).
      padding: "16px 12px calc(14px + env(safe-area-inset-bottom, 0px))",
      // Overlay (mobile): size the panel by the top:0/bottom:0 INSETS rather than an explicit
      // height, so it is exactly the viewport tall by construction — bulletproof against any
      // context where 100dvh is mis-measured (PWA / dynamic toolbar). The flex column + the
      // nav's own scroll then fill that exact height. Desktop (sticky): pin to full height.
      // Desktop (sticky): height:100% of the shell (itself a % chain from #root) — a
      // percentage, NOT 100dvh, so the sidebar is exactly viewport-tall at any html zoom
      // (100dvh would render ~15% too tall under the large-text zoom and cut off the footer).
      ...(overlay ? { position: "fixed", top: 0, bottom: 0, [rtl ? "right" : "left"]: 0, zIndex: 50 }
        : { position: "sticky", top: 0, height: "100%", maxHeight: "100%" }),
    } as React.CSSProperties}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 18px" }}>
        <button onClick={() => go("/")} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: C.text }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg,#FBC02D,#F7931A 50%,#7CC04E)" }}>
            <Diamond size={17} color="#0B0613" fill="#0B0613" />
          </div>
          <div style={{ textAlign: rtl ? "right" : "left" }}>
            <div style={{ fontSize: 15, fontWeight: 900, lineHeight: 1, letterSpacing: "0.02em" }}>ALGO770</div>
            <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.26em", color: C.titleInk }}>STRATETEACH</div>
          </div>
        </button>
        {overlay
          ? <button onClick={onClose} className="tap44" style={iconBtn}><X size={16} color={C.muted} /></button>
          : <button onClick={() => go("/")} title="home" className="tap44" style={iconBtn}><HomeIcon size={15} color={C.muted} /></button>}
      </div>

      {/* Nav area scrolls WITHIN the drawer (own overflow-y, min-height:0 so it can
          actually shrink inside the flex column) — the aside is pinned to the viewport
          height above, so no matter how many rows a section has the list scrolls here
          instead of pushing the drawer off the bottom of the screen. */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 0%", minHeight: 0, overflowY: "auto", overflowX: "hidden", paddingBottom: 8 }}>
        <button onClick={() => go("/")} style={{
          width: "100%", display: "flex", alignItems: "center", gap: 11, textAlign: rtl ? "right" : "left",
          background: loc.pathname === "/" ? C.glassTint : "transparent",
          border: `1px solid ${loc.pathname === "/" ? C.glassBd : "transparent"}`,
          color: loc.pathname === "/" ? C.text : C.muted, padding: "9px 11px", borderRadius: 9,
          fontSize: 14, fontWeight: 700, fontFamily: UI, cursor: "pointer",
          boxShadow: loc.pathname === "/" ? `inset ${rtl ? "-3px" : "3px"} 0 0 ${C.gold}, ${C.glassHi}` : "none",
        }}>
          <HomeIcon size={17} color={loc.pathname === "/" ? C.gold : C.muted} /> {lang === "he" ? "דף הבית" : "Home"}
        </button>

        {/* Quick options — customizable shortcut list directly UNDER Home. Collapsible like
            every other group; its header carries the ✎ Edit control (add/remove sheet). */}
        {(() => {
          const active = quick
            .map((id) => QUICK_CATALOG.find((q) => q.id === id))
            .filter((q): q is QuickOpt => !!q && (!q.lock || !locked.includes(q.lock)));
          const containsActive = active.some((q) => !!q.path && loc.pathname === q.path!.split("?")[0]);
          const editBtn = (
            <button onClick={(e) => { e.stopPropagation(); setEditQuick(true); }} className="tap44"
              aria-label={lang === "he" ? "ערוך אפשרויות מהירות" : "Edit quick options"}
              title={lang === "he" ? "ערוך" : "Edit"}
              style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any, border: `1px dashed ${C.gold}`, color: C.gold, cursor: "pointer" }}>
              <Pencil size={12} color={C.gold} />
            </button>
          );
          const rows = active.map((q) => {
            const isActive = !!q.path && loc.pathname === q.path.split("?")[0];
            return (
              <button key={q.id} onClick={() => runQuick(q)} style={menuRow(isActive, rtl)}>
                <q.Icon size={16} color={isActive ? C.gold : C.muted} /> {lang === "he" ? q.he : q.en}
              </button>
            );
          });
          return groupSection("quick", lang === "he" ? "אפשרויות מהירות" : "Quick options", containsActive, rows, editBtn);
        })()}

        {/* PRIORITY GROUPS — one visual language (menuRow), clear section headers, no
            duplicates. Order by priority: Trade → Learn & Help → Account & Settings →
            Admin (admin-only). Every destination is also reachable from the Home tiles;
            the orphan views (Dashboard/Performance/Chat/Telegram) live in Quick shortcuts. */}
        {(() => {
          const he = lang === "he";
          const badgeEl = (badge?: string) => badge
            ? <span style={{ marginInlineStart: "auto", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.06em", color: "#1a1206", background: "linear-gradient(135deg,#FBC02D,#F7931A)", borderRadius: 999, padding: "2px 7px" }}>{badge}</span>
            : null;
          const actionRow = (label: string, Icon: any, onRun: () => void) => (
            <button key={label} onClick={onRun} style={menuRow(false, rtl)}>
              <Icon size={16} color={C.muted} /> {label}
            </button>
          );
          const navRow = (path: string, label: string, Icon: any, badge?: string) => {
            if (locked.includes(path)) return null;
            const active = loc.pathname === path.split("?")[0];
            return (
              <button key={path} onClick={() => go(path)} style={menuRow(active, rtl)}>
                <Icon size={16} color={active ? C.gold : C.muted} /> {label}{badgeEl(badge)}
              </button>
            );
          };
          // STAFF nav group = a non-owner collaborator (legal / biz / IT editor). They get a
          // dedicated "Staff" group so the audit board + task manager (their actual job) and
          // their own portal are one tap away — reachable ON DEMAND. NOTE this is the NAV group
          // ONLY: the IT editor (Oren) is INTENTIONALLY still here (so he keeps a nav link to the
          // audit/review board) even though he is NO LONGER force-landed on /staff-audit — the
          // landing redirect up top (its own isStaff) excludes it_editor, so Oren's home is the
          // normal springboard. Owners are excluded (!isOwner) — they use the owner "Admin" group.
          const isStaffNav = (isLegalEditor() || isBizEditor() || isItEditor()) && !isOwner() && user.role !== "admin";
          // `paths` per group → which one holds the current route (auto-expands it).
          const groups: { key: string; label: string; paths: string[]; rows: React.ReactNode[] }[] = [
            ...(isStaffNav ? [{ key: "staff", label: he ? "צוות" : "Staff", paths: ["/staff-audit"], rows: [
              navRow("/staff-audit?sec=audit", he ? "לוח ביקורת" : "Audit board", ClipboardCheck),
              navRow("/staff-audit?sec=tasks", he ? "מנהל משימות" : "Task manager", ListChecks),
              // Their own collaborator portal (folded in from the old standalone groups). For the
              // IT editor this is the single place his IT portal is listed (the owner "Admin"
              // group's collaborator-portal rows are owner-only), so there's no duplicate row.
              isLegalEditor() ? navRow("/legal-portal", he ? "פורטל משפטי" : "Legal Portal", Scale) : null,
              isItEditor() ? navRow("/it-portal", he ? "פורטל IT" : "IT Portal", Wrench) : null,
              isBizEditor() ? navRow("/biz-portal", he ? "פורטל פיתוח עסקי" : "Business Dev Portal", Briefcase) : null,
            ] }] : []),
            { key: "trade", label: he ? "מסחר" : "Trade", paths: ["/profit", "/bots", "/exchange", "/scanner", "/backtests", "/strategy"], rows: [
              navRow("/profit", he ? "מנוע מסחר" : "Trading Engine", TrendingUp),
              navRow("/bots", he ? "סיגנל בוט" : "Signal Bot", Bot),
              navRow("/exchange", he ? "בורסה" : "Exchange", ArrowLeftRight),
              navRow("/scanner", he ? "סריקה יומית" : "Daily Scan", Search),
              navRow("/backtests", he ? "בדיקות" : "Backtest", FlaskConical),
              navRow("/strategy", he ? "מעבדת אסטרטגיות" : "Strategy Lab", Wand2),
            ] },
            { key: "learn", label: he ? "למידה ועזרה" : "Learn & Help", paths: ["/guide", "/university", "/reels", "/requests"], rows: [
              navRow("/guide", he ? "חדש כאן? (מדריך למתחילים)" : "New here? (beginner guide)", Rocket),
              navRow("/university", he ? "למידה" : "Learn", GraduationCap),
              navRow("/reels", he ? "רילים" : "Reels", Clapperboard, "BETA"),
              // Help Portal for regular users; admins reach it as "Requests portal" below.
              user.role !== "admin" ? navRow("/requests", he ? "פורטל עזרה" : "Help Portal", LifeBuoy) : null,
              actionRow(he ? "המדריך החכם (AI)" : "AI guide", Sparkles, () => { window.dispatchEvent(new Event("algo770-onboarding-quiz")); onClose?.(); }),
            ] },
            { key: "account", label: he ? "חשבון והגדרות" : "Account & Settings", paths: ["/me", "/plans"], rows: [
              navRow("/me", he ? "החשבון שלי" : "Account", UserRound),
              navRow("/plans", he ? "מסלולים ושדרוג" : "Plans & upgrade", Crown),
              actionRow((he ? "שפה" : "Language") + " — " + (lang === "he" ? "English" : "עברית"), Languages, () => setLang(lang === "he" ? "en" : "he")),
              // Dispatches open-skin; the ThemeControl mounted in this menu's footer catches it.
              // (Do NOT onClose here — closing would unmount that ThemeControl before its sheet opens.)
              actionRow(he ? "סקין (עיצוב)" : "Skin", Palette, () => { window.dispatchEvent(new Event("algo770-open-skin")); }),
            ] },
            // ADMIN group — a FULL VIEWER: an OWNER (Dan/Rafi/Yoav) OR the IT editor (Oren).
            // Owners see the whole operational surface; a non-owner full-viewer (Oren) sees the
            // OWNERS PORTAL entry (its own Finance/Employees/AutoPilots tabs stay isOwner()) +
            // his IT portal, but NOT the owner-only support tools (Requests / Reply-to-users /
            // Admin dashboard) — those stay isOwner() (their backends are require_owner/admin).
            ...(isFullViewer() ? [{ key: "admin", label: he ? "ניהול" : "Admin", paths: ["/owners", "/requests", "/reply-users", "/me", "/legal-portal", "/it-portal", "/biz-portal"], rows: [
              navRow("/owners", he ? "פורטל בעלים" : "Owners Portal", Gem),
              isOwner() ? navRow("/requests", he ? "פורטל פניות" : "Requests portal", Inbox) : null,
              isOwner() ? navRow("/reply-users", he ? "מענה למשתמשים" : "Reply to users", Mail) : null,
              // Step 4: the Admin dashboard now lives inside /me → ניהול (deep-linked). Owner-only.
              isOwner() ? navRow("/me?sec=management", he ? "לוח ניהול" : "Admin dashboard", Gauge) : null,
              // Collaborator workspaces — OWNER-ONLY here (owners reach all three from the Admin
              // group). A non-owner collaborator (Oren / Raz / Raful) reaches their OWN portal
              // from the "Staff" group above instead, so it's never listed twice.
              isOwner() ? navRow("/legal-portal", he ? "פורטל משפטי" : "Legal Portal", Scale) : null,
              isOwner() ? navRow("/it-portal", he ? "פורטל IT" : "IT Portal", Wrench) : null,
              isOwner() ? navRow("/biz-portal", he ? "פורטל פיתוח עסקי" : "Business Dev Portal", Briefcase) : null,
            ] }] : []),
            // Content editors (Yoav's content_editor grant, OR any full admin like Dan) → a
            // discoverable "Content" group pointing at the in-screen editors (Reels + University).
            // This is the single named place both Dan and a granted content_editor reach the
            // content-editing tools (each screen still gates its own editor button).
            ...((isContentEditor() || user.role === "admin") ? [{ key: "content", label: he ? "תוכן (עריכה)" : "Content (editing)", paths: ["/reels", "/university"], rows: [
              navRow("/reels", he ? "עריכת רילים" : "Reels editor", Clapperboard, "BETA"),
              navRow("/university", he ? "עריכת אוניברסיטה" : "University editor", GraduationCap),
            ] }] : []),
            // (The old standalone Legal / IT / Biz collaborator groups are folded into the
            // "Staff" group at the TOP — one coherent staff area with audit + tasks + portal.)
            // REVIEW TOOL — the in-app per-screen feedback collector (ReviewMode). Reachable
            // from the ☰ menu across the WHOLE app, for the OWNERS (Dan/Rafi/Yoav) + the portal
            // collaborators Oren (it), Raz (legal) & Raful (biz). Dispatches the open event.
            ...(isReviewer() ? [{ key: "review", label: he ? "כלי סקירה" : "Review tool", paths: ["/review-inbox"], rows: [
              actionRow(he ? "מצב סקירה — אסוף תיקונים" : "Review mode — collect fixes", ClipboardList,
                () => { window.dispatchEvent(new Event("algo770-review-open")); onClose?.(); }),
              // Dan's mini-portal: everyone's submissions + merge/report/email.
              navRow("/review-inbox", he ? "תיבת הסקירות" : "Review inbox", Inbox),
            ] }] : []),
          ];
          return groups.map((grp) => {
            const rows = grp.rows.filter(Boolean);
            if (!rows.length) return null;
            const containsActive = grp.paths.some((p) => loc.pathname === p);
            return <React.Fragment key={grp.key}>{groupSection(grp.key, grp.label, containsActive, rows)}</React.Fragment>;
          });
        })()}
      </nav>

      {/* Footer — identity + sign out + which build is live. Everything else moved into
          the priority groups above so there's one clean visual language, no repeats. */}
      <div style={{ borderTop: `1px solid ${C.glassBd}`, paddingTop: 12, marginTop: overlay ? 14 : 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <UserRound size={14} color={C.gold} />
            <span style={{ fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</span>
            {user.role === "admin" ? <span style={{ color: C.faint }}>· admin</span> : null}
          </span>
          {/* Global controls moved OFF the inner-screen top → here in the ☰ side menu:
              skin (🎨 ThemeControl) + accessibility (♿). Help = the Learn&Help group,
              Settings = Account (/me) above. */}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <ThemeControl compact />
            <AccessibilityControl compact />
            <button onClick={onLogout} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any, border: `1px solid ${C.glassBd}`, color: C.muted, borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: UI, boxShadow: C.glassHi }}>
              <LogOut size={14} /> {t.signOut}
            </button>
          </span>
        </div>
        {/* Build marker — which deploy is live (vs a stale cache). Tiny + muted.
            (The "update to latest" control now lives at the TOP of Home, as a round ↻
            icon beside the build stamp under the wordmark — where the version reads.) */}
        <div style={{ fontSize: 10, color: C.faint, textAlign: "center", marginTop: 2, letterSpacing: "0.02em" }} title={lang === "he" ? "מזהה גרסה · שעון ישראל" : "Build version · Israel time"}>
          {lang === "he" ? "גרסה" : "build"} {BUILD_STAMP}
        </div>
      </div>

      {/* Customize-quick-options sheet — add/remove which shortcuts show under Home.
          Mirrors the Home shortcuts edit sheet (C.* tokens, RTL-aware, 44px taps);
          persists to localStorage (QUICK_KEY). Plan-locked sections are disabled. */}
      {editQuick && (
        <div onClick={() => setEditQuick(false)} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto", direction: rtl ? "rtl" : "ltr" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 18, boxShadow: "0 24px 70px rgba(0,0,0,0.55)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, color: C.text }}>
                <Pencil size={16} color={C.gold} /> {lang === "he" ? "התאמת אפשרויות מהירות" : "Customize quick options"}
              </span>
              <button onClick={() => setEditQuick(false)} aria-label="close" className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 12, color: C.muted, textAlign: rtl ? "right" : "left" }}>
              {lang === "he" ? "בחרו אילו קיצורים יופיעו תחת \"דף הבית\" בתפריט." : "Choose which shortcuts appear under \"Home\" in the menu."}
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {QUICK_CATALOG.map((q) => {
                const pinned = q.id === QUICK_PINNED;          // Help & support — always on
                const on = pinned || quick.includes(q.id);
                const isLocked = !!q.lock && locked.includes(q.lock);
                const disabled = isLocked || pinned;
                return (
                  <button key={q.id} onClick={() => { if (!disabled) toggleQuick(q.id); }} disabled={disabled} className="tap44"
                    title={pinned ? (lang === "he" ? "תמיד מוצג" : "Always shown") : undefined}
                    style={{ flex: "1 1 44%", minWidth: 0, minHeight: 44, display: "inline-flex", alignItems: "center", gap: 9, textAlign: rtl ? "right" : "left",
                      background: on ? `${C.gold}14` : C.surface2, border: `1.5px solid ${on ? C.gold : C.line}`,
                      color: isLocked ? C.faint : C.text, borderRadius: 12, padding: "9px 12px",
                      fontSize: 13, fontWeight: 700, cursor: disabled ? "default" : "pointer", fontFamily: UI, opacity: isLocked ? 0.55 : 1 }}>
                    <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: on ? C.gold : "transparent", border: `1.5px solid ${isLocked ? C.line : on ? C.gold : C.muted}` }}>
                      {isLocked ? <Lock size={12} color={C.faint} /> : on ? <Check size={14} color="#0B0613" /> : null}
                    </span>
                    <q.Icon size={15} color={isLocked ? C.faint : C.gold} />
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lang === "he" ? q.he : q.en}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => saveQuick(QUICK_DEFAULT)} style={{ marginTop: 12, width: "100%", background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 10, padding: "10px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: UI }}>
              {lang === "he" ? "איפוס לברירת המחדל" : "Reset to default"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );

  if (!overlay) return panel;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 49 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" as any }} />
      {panel}
    </div>
  );
}

// ONE consistent side-menu row: icon + label, muted by default, gold accent + inset
// bar when active. Shared by the Quick shortcuts AND every priority-group row so the
// whole menu speaks one visual language (no mixed pills / colored styling).
const menuRow = (active: boolean, rtl: boolean): React.CSSProperties => ({
  width: "100%", display: "flex", alignItems: "center", gap: 11, textAlign: rtl ? "right" : "left",
  // Active row = a frosted, accent-tinted glass tile (skin-aware — no hardcoded orange) with
  // a hairline + a skin-accent inset bar + soft top highlight; inactive rows are transparent
  // so the frosted panel reads through them (clean, Apple-like). 1px border on both keeps the
  // row height identical whether active or not (no layout shift on selection).
  background: active ? C.glassTint : "transparent",
  border: `1px solid ${active ? C.glassBd : "transparent"}`,
  color: active ? C.text : C.muted, padding: "8px 11px", borderRadius: 9,
  fontSize: 13.5, fontWeight: active ? 700 : 500, fontFamily: UI, cursor: "pointer",
  boxShadow: active ? `inset ${rtl ? "-3px" : "3px"} 0 0 ${C.gold}, ${C.glassHi}` : "none",
});
