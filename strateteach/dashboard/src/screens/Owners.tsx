import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Diamond, Loader2, UserCircle, Trophy, Sunrise, Sparkles, Users,
  ClipboardList, ClipboardCheck, Milestone, BookOpen, Coins, Vote as VoteIcon, Scale, Wrench, Briefcase, UserCog, Rocket,
  ChevronRight, ChevronLeft, Zap, FileText, Plus, CircleAlert, Bell, Check, ArrowUpRight, LayoutGrid, Building2, Landmark,
} from "lucide-react";
import MgmtConsole from "./MgmtConsole";
import SharedFund from "./SharedFund";
import FinancePanel from "./FinancePanel";
import Employees from "./Employees";
import Portal from "./Portal";
import AuditPortal from "../components/AuditPortal";
import AutoPilots, { AutoPilotsEntryTile } from "../components/AutoPilots";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import AppTile from "../components/AppTile";
import { ScreenHeader } from "../components/ScreenHeader";
import FramedTitle from "../components/FramedTitle";
import ScreenBottom from "../components/ScreenBottom";
import { Segmented } from "../ui";
import { api, isAdmin, isOwner, isLegalEditor, isItEditor, isBizEditor, isFullViewer } from "../app/api";
import { TEAM, partnerById, voteItemByKey, type Bi } from "../lib/owners";
import {
  Centered, glassCard, PortalHeader, PortalTabs, BackRow, PersonalScreen,
  Results, Daily, Overview, Team, Board, Vote, Progress, Guide, type Tab,
} from "./ownersShared";

// ── OWNERS PORTAL — the owners' shell. The tab components (Daily/Overview/Team/Board/Vote/
// Progress/Results/Guide) + shared primitives live in ownersShared.tsx so the collaborator
// portals (Portal.tsx) reuse the SAME components. Finance stays owner-only, rendered here.
// Phase 5: the two collaborator portals (Legal=Raz, IT=Oren) are embedded as owner sub-tabs
// (owners satisfy isLegalEditor/isItEditor = "owner OR flag"), so all 3 owners view/manage them.
type ShellTab = Tab | "legalPortal" | "itPortal" | "bizPortal" | "employees" | "autopilots" | "audit" | "console" | "fund" | "menu" | "all";

// ── Grouped launcher (Apple iOS-Settings style) — replaces the old flat pill-wrap nav.
// Clean, uniform icon+label buttons in labeled sections. Only items the caller may access
// are passed in (already role-filtered), so empty sections auto-hide.
function PortalMenu({ items, he, rtl, onPick }: {
  items: { id: ShellTab; he: string; en: string; Icon: any }[]; he: boolean; rtl: boolean; onPick: (id: ShellTab) => void;
}) {
  const byId: Record<string, { id: ShellTab; he: string; en: string; Icon: any }> = {};
  for (const it of items) byId[it.id as string] = it;
  const Fwd = rtl ? ChevronLeft : ChevronRight;
  // rows/squares toggle for the launcher — 'cards' = the multi-column tile grid; 'list' =
  // one full-width tile per row. Persisted like the other screens' view mode.
  const [menuView, setMenuView] = useViewMode("algo770_ownersmenu_view_v1", "cards");
  const SECTIONS: { he: string; en: string; ids: ShellTab[] }[] = [
    { he: "סקירה", en: "Overview", ids: ["daily", "overview", "progress", "results"] as ShellTab[] },
    { he: "ניהול", en: "Manage", ids: ["console", "fund", "board", "vote", "team", "employees", "audit"] as ShellTab[] },
    { he: "פורטלים", en: "Portals", ids: ["legalPortal", "itPortal", "bizPortal", "finance"] as ShellTab[] },
    { he: "כלים", en: "Tools", ids: ["autopilots", "guide"] as ShellTab[] },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ViewToggle view={menuView} onChange={setMenuView} he={he} />
      </div>
      {SECTIONS.map((sec) => {
        const secItems = sec.ids.map((id) => byId[id as string]).filter(Boolean);
        if (!secItems.length) return null;
        return (
          <div key={sec.en}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, letterSpacing: "0.04em", textTransform: "uppercase",
              marginBottom: 9, paddingInlineStart: 4 }}>{he ? sec.he : sec.en}</div>
            {menuView === "cards" ? (
              // CARDS = genuine SQUARE tiles matching the Home springboard/shortcut tiles
              // (shared AppTile: 1:1 square, icon-on-top, FitLabel label under, skin-adaptive).
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 108px), 1fr))" }}>
                {secItems.map((it) => (
                  <AppTile key={it.id as string} label={he ? it.he : it.en} Icon={it.Icon} onClick={() => onPick(it.id)} />
                ))}
              </div>
            ) : (
              // LIST = the horizontal rows (icon · label · chevron), unchanged.
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr" }}>
                {secItems.map((it) => (
                  <button key={it.id as string} onClick={() => onPick(it.id)} className="tap44"
                    style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", minHeight: 56, textAlign: rtl ? "right" : "left",
                      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 12px", cursor: "pointer",
                      boxShadow: "0 6px 16px -13px rgba(0,0,0,0.4)", fontFamily: "inherit" }}>
                    <span style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center",
                      background: `${C.gold}18`, border: `1px solid ${C.gold}44` }}>
                      <it.Icon size={18} color={C.gold} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{he ? it.he : it.en}</span>
                    <Fwd size={16} color={C.faint} style={{ flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── MANAGEMENT CENTER landing ────────────────────────────────────────────────
// The /owners landing VIEW, restyled after a clean light "Management Center" mobile
// dashboard (greeting → stat tiles → attention banner → team member-cards → action bar).
// Pure DISPLAY over real owners-portal data (api.daily() — overall %, status counts,
// attention items, per-partner open-task counts + morning summary). Every tile/card/button
// routes into an EXISTING tab/section (onPick) or a partner's personal screen (onOpenPartner)
// — no functionality is removed, and every role gate stays enforced by the caller (the tiles
// array is already role-filtered here; the tab render in Owners re-checks each gate).
// Skin-adaptive via C.* — reads as a clean light board on the light skins (like /overview).

// Colored-initials avatars (we have no photos) — a small fixed palette hashed by name so a
// person keeps a stable, distinct colour; ink is chosen for contrast on that colour.
const AVATAR_COLORS = ["#2E9E7B", "#E0A93B", "#3F79C4", "#B4577D", "#4FA5A0", "#C9683F", "#7A6BC4"];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
  return s.toUpperCase() || "?";
}
// A clean flat card (white on the light skins) with a soft shadow — the reference look,
// skin-adaptive rather than the app's frosted glass, so the board reads light + airy.
function mgmtCard(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 16,
    boxShadow: "0 12px 30px -24px rgba(0,0,0,0.55)", ...extra,
  };
}

function ManagementLanding({ he, rtl, bi, myPartner, onPick, onOpenPartner }: {
  he: boolean; rtl: boolean; bi: (b: Bi) => string;
  myPartner: string | null | undefined;
  onPick: (id: ShellTab) => void; onOpenPartner: (id: string) => void;
}) {
  // Shares the ["pmDaily"] cache with the Daily tab, so opening the landing warms it + vice-versa.
  const dailyQ = useQuery({ queryKey: ["pmDaily"], queryFn: () => api.daily(), staleTime: 60000 });
  const profileQ = useQuery({ queryKey: ["myProfile"], queryFn: () => api.myProfile(), staleTime: 60000 });
  const [teamView, setTeamView] = useViewMode("algo770_ownersmgmt_team_v1", "cards");

  if (dailyQ.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;

  const d = (dailyQ.data || {}) as Partial<import("../lib/client").DailyData>;
  const counts = d.counts || {};
  const attention = d.attention || [];
  const overall = d.overall ?? 0;
  const summary = (he ? d.summary?.he : d.summary?.en) || "";
  const openTasks = (counts.todo || 0) + (counts.in_progress || 0) + (counts.blocked || 0);

  // Greeting name: the resolved owner/partner (Dan/Rafi/Yoav) → else the profile nickname/handle.
  const prof = profileQ.data as any;
  const name = partnerById(myPartner)?.name || prof?.nickname || prof?.username || (he ? "בעלים" : "Owner");

  // Attention title (mirrors Daily) — resolve a vote-catalog item, else its stored title.
  const attnTitle = (itemKey: string, tHe?: string, tEn?: string) => {
    if (tHe || tEn) return he ? (tHe || tEn) : (tEn || tHe);
    const cat = voteItemByKey(itemKey);
    return cat ? bi(cat.title) : itemKey;
  };

  // Live per-partner open counts, keyed by partner id (from the daily rollup).
  const liveById: Record<string, any> = {};
  for (const p of (d.partners || [])) liveById[p.partner] = p;
  // The team roster is the canonical TEAM (owners + collaborators) so everyone shows even when
  // the live rollup omits a collaborator; open counts come from the live rollup (0 otherwise).
  const members = TEAM.map((t) => ({ id: t.id, name: t.name, open: (liveById[t.id]?.openCount ?? 0) as number }));

  // STAT TILES — role-filtered here (the tab render re-checks each gate). Each routes into a tab.
  const tiles: { id: ShellTab; he: string; en: string; Icon: any; tint: string; count?: number; badge?: string }[] = [
    { id: "daily", he: "עדכון יומי", en: "Daily", Icon: Sunrise, tint: C.gold },
    { id: "board", he: "לוח משימות", en: "Board", Icon: ClipboardList, tint: C.blue, count: openTasks },
    { id: "vote", he: "הצבעה", en: "Vote", Icon: VoteIcon, tint: C.accent },
    { id: "team", he: "צוות", en: "Team", Icon: Users, tint: C.gain, count: TEAM.length },
    { id: "progress", he: "התקדמות", en: "Progress", Icon: Milestone, tint: C.gold, badge: `${overall}%` },
    // Console + Audit MASTER + Finance are OWNER-ONLY; AutoPilots is full-viewer (owners + IT editor).
    ...(isOwner() ? [{ id: "console" as ShellTab, he: "קונסולה", en: "Console", Icon: Building2, tint: C.blue }] : []),
    ...(isOwner() ? [{ id: "audit" as ShellTab, he: "ביקורת", en: "Audit", Icon: ClipboardCheck, tint: C.loss }] : []),
    ...(isFullViewer() ? [{ id: "autopilots" as ShellTab, he: "טייסים", en: "AutoPilots", Icon: Rocket, tint: C.blue }] : []),
    ...(isFullViewer() ? [{ id: "finance" as ShellTab, he: "כספים", en: "Finance", Icon: Coins, tint: C.gold }] : []),
    // "More" → the full grouped launcher child (?tab=all) with every section + portals.
    { id: "all", he: "עוד", en: "More", Icon: LayoutGrid, tint: C.faint },
  ];

  // ACTION BAR — report + new-task always; the audit/requirement action is OWNER-ONLY.
  const actions: { key: string; he: string; en: string; Icon: any; tone: string; onClick: () => void }[] = [
    { key: "report", he: "דוח", en: "Report", Icon: FileText, tone: C.blue, onClick: () => onPick("daily") },
    { key: "task", he: "משימה", en: "Task", Icon: Plus, tone: C.gain, onClick: () => onPick("board") },
    ...(isOwner() ? [{ key: "req", he: "דרישה", en: "Requirement", Icon: ClipboardCheck, tone: C.gold, onClick: () => onPick("audit") as any }] : []),
  ];

  const today = new Intl.DateTimeFormat(he ? "he-IL" : "en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date());
  const attnTone = attention.length ? C.gold : C.gain;
  const attnSub = attention.slice(0, 2).map((a) => attnTitle(a.itemKey, a.titleHe, a.titleEn)).join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: UI }}>
      {/* Date + a live "attention" bell chip (real count) — echoes the reference's utility row
          without duplicating the app's global settings/language chrome. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted }}>{today}</span>
        <button onClick={() => onPick("daily")} className="tap44" title={he ? "דורש טיפול" : "Needs attention"}
          style={{ marginInlineStart: "auto", position: "relative", display: "grid", placeItems: "center", width: 38, height: 38,
            borderRadius: 12, background: C.surface, border: `1px solid ${C.line}`, cursor: "pointer" }}>
          <Bell size={17} color={C.muted} />
          {attention.length > 0 && (
            <span style={{ position: "absolute", top: -5, insetInlineEnd: -5, minWidth: 18, height: 18, padding: "0 5px",
              borderRadius: 999, background: C.loss, color: "#fff", fontSize: 10.5, fontWeight: 900, display: "grid", placeItems: "center" }}>
              {attention.length}
            </span>
          )}
        </button>
      </div>

      {/* GREETING */}
      <div style={mgmtCard()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{he ? `שלום ${name}` : `Hi ${name}`} 👋</span>
          <span style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 900,
            color: C.gold, background: `${C.gold}18`, border: `1px solid ${C.gold}44`, borderRadius: 999, padding: "3px 10px" }}>
            <Zap size={13} /> {overall}%
          </span>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 13, lineHeight: 1.55, color: C.muted,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {summary || (he ? "ברוך הבא לחדר הבקרה — כאן מרוכזים המשימות, הצוות, ההתקדמות וההחלטות." : "Welcome to the control room — tasks, team, progress + decisions in one place.")}
        </p>
      </div>

      {/* STAT TILES — horizontally-scrollable row of square tiles (icon + label + optional count). */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" as any }}>
        {tiles.map((t) => (
          <button key={t.id as string} onClick={() => onPick(t.id)} className="tap44"
            style={{ flex: "0 0 auto", width: 92, minWidth: 92, position: "relative", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "13px 8px",
              cursor: "pointer", fontFamily: UI, boxShadow: "0 10px 24px -22px rgba(0,0,0,0.5)" }}>
            {(typeof t.count === "number" && t.count > 0) && (
              <span style={{ position: "absolute", top: -6, insetInlineEnd: -6, minWidth: 20, height: 20, padding: "0 5px", borderRadius: 999,
                background: t.tint, color: onAccentInk(t.tint), fontSize: 11, fontWeight: 900, display: "grid", placeItems: "center" }}>{t.count}</span>
            )}
            <span style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center",
              background: `${t.tint}1e`, border: `1px solid ${t.tint}44` }}>
              <t.Icon size={20} color={t.tint} />
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text, textAlign: "center", lineHeight: 1.2 }}>{he ? t.he : t.en}</span>
            {t.badge && <span style={{ fontSize: 10.5, fontWeight: 900, color: C.gold }}>{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* ATTENTION BANNER — soft-tinted; gold when there are items, calm green when all clear. */}
      <button onClick={() => onPick("daily")} className="tap44"
        style={{ display: "flex", alignItems: "center", gap: 13, textAlign: rtl ? "right" : "left", cursor: "pointer", fontFamily: UI,
          background: `${attnTone}14`, border: `1px solid ${attnTone}55`, borderRadius: 18, padding: "14px 16px", width: "100%" }}>
        <span style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center",
          background: `${attnTone}22`, border: `1px solid ${attnTone}55` }}>
          {attention.length ? <span style={{ fontSize: 22, fontWeight: 900, color: attnTone }}>{attention.length}</span>
            : <Check size={22} color={attnTone} />}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: C.text }}>
            {attention.length ? (he ? "ממתין לטיפולך" : "Waiting for you") : (he ? "הכול מטופל" : "All handled")}
          </span>
          <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {attention.length ? (attnSub || (he ? "פריטים הדורשים החלטה או ביצוע היום" : "items needing a decision or action today"))
              : (he ? "אין פריטים דחופים — בוקר רגוע" : "nothing urgent — a calm morning")}
          </span>
        </span>
        {rtl ? <ChevronLeft size={20} color={C.faint} style={{ flexShrink: 0 }} /> : <ChevronRight size={20} color={C.faint} style={{ flexShrink: 0 }} />}
      </button>

      {/* TEAM — member cards (avatar + name + open-task count), with a cards/rows toggle. */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
          <Users size={16} color={C.gold} />
          <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "השותפים והצוות" : "Partners & team"}</span>
          <span style={{ marginInlineStart: "auto" }}><ViewToggle view={teamView} onChange={setTeamView} he={he} /></span>
        </div>
        {teamView === "cards" ? (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 108px), 1fr))" }}>
            {members.map((m) => {
              const col = avatarColor(m.name);
              const status = m.open === 0 ? (he ? "פנוי ✓" : "available ✓")
                : m.open === 1 ? (he ? "פתוחה אחת" : "1 open") : (he ? `${m.open} פתוחות` : `${m.open} open`);
              return (
                <button key={m.id} onClick={() => onOpenPartner(m.id)} className="tap44"
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: C.surface, border: `1px solid ${C.line}`,
                    borderRadius: 18, padding: "14px 8px", cursor: "pointer", fontFamily: UI, boxShadow: "0 10px 24px -22px rgba(0,0,0,0.5)" }}>
                  <span style={{ position: "relative" }}>
                    <span style={{ width: 46, height: 46, borderRadius: 999, display: "grid", placeItems: "center",
                      background: col, color: onAccentInk(col), fontSize: 16, fontWeight: 900 }}>{initials(m.name)}</span>
                    {m.open > 0 && (
                      <span style={{ position: "absolute", top: -4, insetInlineEnd: -4, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 999,
                        background: C.loss, color: "#fff", fontSize: 10.5, fontWeight: 900, display: "grid", placeItems: "center" }}>{m.open}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{m.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: m.open === 0 ? C.gain : C.muted }}>{status}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr" }}>
            {members.map((m) => {
              const col = avatarColor(m.name);
              const status = m.open === 0 ? (he ? "פנוי ✓" : "available ✓")
                : m.open === 1 ? (he ? "פתוחה אחת" : "1 open") : (he ? `${m.open} פתוחות` : `${m.open} open`);
              return (
                <button key={m.id} onClick={() => onOpenPartner(m.id)} className="tap44"
                  style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: rtl ? "right" : "left", background: C.surface,
                    border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 12px", cursor: "pointer", fontFamily: UI,
                    boxShadow: "0 8px 20px -20px rgba(0,0,0,0.5)" }}>
                  <span style={{ width: 38, height: 38, borderRadius: 999, flexShrink: 0, display: "grid", placeItems: "center",
                    background: col, color: onAccentInk(col), fontSize: 14, fontWeight: 900 }}>{initials(m.name)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: C.text }}>{m.name}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: m.open === 0 ? C.gain : C.muted }}>{status}</span>
                  {rtl ? <ChevronLeft size={16} color={C.faint} /> : <ChevronRight size={16} color={C.faint} />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ACTION BAR — rounded pills wired to the existing report/create surfaces. */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {actions.map((a) => (
          <button key={a.key} onClick={a.onClick} className="tap44"
            style={{ flex: 1, minWidth: 100, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
              background: `${a.tone}16`, border: `1px solid ${a.tone}55`, color: a.tone, borderRadius: 999, padding: "12px 14px",
              fontSize: 13.5, fontWeight: 900, cursor: "pointer", fontFamily: UI }}>
            <a.Icon size={16} /> {he ? a.he : a.en}
          </button>
        ))}
      </div>
    </div>
  );
}

// Readable ink on a solid avatar/badge colour (mirror of theme's onAccent, kept local so this
// file needn't import the internal helper): dark text on a light fill, white on a dark fill.
function onAccentInk(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? "#16110a" : "#ffffff";
}

export default function Owners() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const bi = (b: Bi) => (he ? b.he : b.en);
  // Deep-link support: /owners?tab=<tab> opens straight to that tab (used by the
  // unified /me → ניהול → בעלים "Finance" entry). Finance is honoured only for an
  // owner; any other requester falls back to the default so it can never leak.
  // URL-driven tab (kept on the legacy ?tab= param so external deep-links — Trading →
  // ?tab=autopilots, Account → ?tab=finance — keep working), so browser Back returns to
  // the launcher menu (not just the in-screen BackRow). Finance/employees/autopilots stay
  // owner-only so they can never leak via a crafted URL.
  const [sp, setSp] = useSearchParams();
  const tab: ShellTab = (() => {
    const q = sp.get("tab") || "";
    const valid: ShellTab[] = ["daily", "overview", "team", "board", "vote", "results", "progress", "guide", "audit", "console", "fund", "finance", "legalPortal", "itPortal", "bizPortal", "employees", "autopilots", "all"];
    if (q && (valid as string[]).includes(q)) {
      // Employees + the management CONSOLE + the SHARED FUND stay owner-only. FINANCE
      // opens to the full-viewer (owner + IT editor / Oren) per the approved P2.3
      // boundary — the BACKEND serves the operator a filtered STRUCTURE view (no owner
      // investments, no per-person payroll) and every write stays require_owner.
      if ((q === "employees" || q === "console" || q === "fund") && !isOwner()) return "menu";
      if ((q === "finance" || q === "autopilots") && !isFullViewer()) return "menu";
      return q as ShellTab;
    }
    // DEFAULT LANDING: owners now land straight on the management CONSOLE (the central
    // hub, owner-approved 2026-07-18). Non-owner managers (Oren/Raz) keep the launcher.
    return isOwner() ? "console" : "menu";
  })();
  const setTab = (t: ShellTab) => setSp(t && t !== "menu" ? { tab: t } : {});
  // When set, a per-partner PERSONAL screen replaces the tab content.
  const [personal, setPersonal] = useState<string | null>(null);
  // A non-manager partner toggles between their personal screen and the (read-only) vote results.
  const [partnerView, setPartnerView] = useState<"me" | "results">("me");

  // Managers = the set that reaches the portal fully. They see the board + can manage the
  // shared PM surfaces + view any partner's personal screen. Portal MANAGER surface (all tabs
  // EXCEPT the owner-only ones) — a product owner, a role=='admin' user, a legal editor (Raz),
  // OR the IT editor (Oren, Dan's full-viewer). The owner-only tabs below (Finance, Employees,
  // AutoPilots, Audit master) stay isOwner(), so a non-owner manager sees the VIEWS, never money.
  const manager = isAdmin() || isOwner() || isLegalEditor() || isItEditor();
  // Resolve the caller to a partner id (dan/rafi/yoav/oren/raz) — a NON-manager
  // partner (e.g. Oren/Raz) reaches ONLY their own personal screen.
  const mineQ = useQuery({ queryKey: ["pmMine"], queryFn: () => api.pmMine(), staleTime: 30000 });
  const myPartner = (mineQ.data as any)?.partner as string | null | undefined;

  // Access gate — a manager, or a resolved partner. Others get an honest notice.
  if (!manager && mineQ.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  if (!manager && !myPartner) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <ScreenHeader icon={<Diamond size={20} color={C.gold} fill={C.gold} />}
          title={he ? "פורטל בעלים" : "Owners Portal"} subtitle={he ? "אזור הבעלים" : "Owners area"} />
        <div style={{ marginTop: 20, ...glassCard(), color: C.muted, fontSize: 14 }}>
          {he ? "אין לך גישה לפורטל הבעלים. פנה למנהל הראשי." : "You don't have Owners Portal access. Ask the main admin."}
        </div>
      </div>
    );
  }

  // A non-manager partner: their portal is their personal screen + a READ-ONLY view of
  // the vote results (they can't cast, but they see where the system stands + their items).
  if (!manager && myPartner) {
    return (
      <div style={{ maxWidth: 1040, margin: "0 auto", direction: rtl ? "rtl" : "ltr" }}>
        <PortalHeader title={he ? "פורטל בעלים" : "Owners Portal"}
          tagline={he ? "המרחב שלך בפרויקט — היעד, המשימות והתוצאות" : "Your space in the project — goal, tasks + results"}>
          <div style={{ maxWidth: 420 }}>
            <Segmented<"me" | "results"> value={partnerView} onChange={setPartnerView}
              options={[
                { value: "me", label: (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><UserCircle size={14} /> {he ? "המסך שלי" : "My screen"}</span>) },
                { value: "results", label: (<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Trophy size={14} /> {he ? "תוצאות" : "Results"}</span>) },
              ]} />
          </div>
        </PortalHeader>
        <div style={{ marginTop: 18 }}>
          {partnerView === "me"
            ? <PersonalScreen partner={myPartner} manager={false} self bi={bi} he={he} rtl={rtl} />
            : <Results he={he} rtl={rtl} bi={bi} canPromote={false} />}
        </div>
      </div>
    );
  }

  const TABS: { id: ShellTab; he: string; en: string; Icon: any }[] = [
    { id: "daily", he: "עדכון יומי", en: "Daily update", Icon: Sunrise },
    { id: "overview", he: "מה בנינו", en: "Overview", Icon: Sparkles },
    { id: "team", he: "צוות", en: "Team", Icon: Users },
    { id: "board", he: "לוח משימות", en: "Board", Icon: ClipboardList },
    { id: "vote", he: "הצבעה", en: "Vote", Icon: VoteIcon },
    { id: "results", he: "תוצאות", en: "Results", Icon: Trophy },
    { id: "progress", he: "התקדמות", en: "Progress", Icon: Milestone },
    { id: "guide", he: "איך זה עובד", en: "Guide", Icon: BookOpen },
    // Management CONSOLE (SheraCore pattern, P2.2) — OWNER-ONLY: projects, team layers,
    // approvals placeholder, reports + budget links. READ-ONLY shell in this slice.
    ...(isOwner() ? [{ id: "console" as ShellTab, he: "קונסולת ניהול", en: "Console", Icon: Building2 }] : []),
    // Shared FUND (P3) — OWNER-ONLY: the owners' proportional stake + NAV, separate
    // from company + client money. Read-only; trading the fund is a gated 3-of-3 act.
    ...(isOwner() ? [{ id: "fund" as ShellTab, he: "הקרן המשותפת", en: "Shared fund", Icon: Landmark }] : []),
    // Audit MASTER view — OWNER-ONLY (Dan/Rafi/Yoav + main admin): ALL domains, global
    // oversight (the collaborators' portals show only their own domain).
    ...(isOwner() ? [{ id: "audit" as ShellTab, he: "ביקורת", en: "Audit", Icon: ClipboardCheck }] : []),
    // Employee management — OWNER-ONLY (Dan/Rafi/Yoav).
    ...(isOwner() ? [{ id: "employees" as ShellTab, he: "ניהול עובדים", en: "Employees", Icon: UserCog }] : []),
    // AutoPilots — trading/sim data, visible to the full-viewer (owners + the IT editor / Oren).
    // MANAGING pilots (arm/run/keys/go-live) stays owner-only, enforced inside the component + backend.
    ...(isFullViewer() ? [{ id: "autopilots" as ShellTab, he: "טייסים אוטומטיים", en: "AutoPilots", Icon: Rocket }] : []),
    // Phase 5: embed each collaborator portal as an owner sub-tab. Owners satisfy
    // isLegalEditor/isItEditor (= "owner OR flag"), so all 3 owners view/manage both.
    ...(isLegalEditor() ? [{ id: "legalPortal" as ShellTab, he: "פורטל משפטי (רז)", en: "Legal (Raz)", Icon: Scale }] : []),
    ...(isItEditor() ? [{ id: "itPortal" as ShellTab, he: "פורטל IT (אורן)", en: "IT (Oren)", Icon: Wrench }] : []),
    ...(isBizEditor() ? [{ id: "bizPortal" as ShellTab, he: "פיתוח עסקי (רפול)", en: "Biz Dev (Raful)", Icon: Briefcase }] : []),
    // Finance opens to the FULL-VIEWER (owners + IT editor / Oren) per the approved P2.3
    // boundary: the backend serves the operator a filtered, read-only STRUCTURE view
    // (no owner investments/movements, no per-person payroll); writes stay owner-only.
    ...(isFullViewer() ? [{ id: "finance" as ShellTab, he: "כספים", en: "Finance", Icon: Coins }] : []),
  ];

  const portalTagline = he ? "חדר הבקרה של השותפים — ממה שבנינו ועד ההשקה" : "The partners' cockpit — from what we built to launch";

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", direction: rtl ? "rtl" : "ltr" }}>
      {personal ? (
        <>
          <FramedTitle text={he ? "פורטל בעלים" : "Owners Portal"} subtitle={portalTagline} />
          <div style={{ marginTop: 16 }}>
            <BackRow he={he} rtl={rtl} onBack={() => setPersonal(null)} />
            <PersonalScreen partner={personal} manager={manager} self={personal === myPartner} bi={bi} he={he} rtl={rtl} />
          </div>
        </>
      ) : (
        <>
          <FramedTitle text={he ? "פורטל בעלים" : "Owners Portal"} subtitle={portalTagline} />
          <div style={{ marginTop: 18 }}>
            {tab === "menu" ? (
              // MANAGEMENT CENTER landing (redesign) — greeting → stat tiles → attention banner
              // → team member-cards → action bar, over real owners-portal data. Every tile/card/
              // button routes into an EXISTING tab/section or a partner's personal screen; the
              // tiles array is role-filtered and each tab render re-checks its gate. The full
              // grouped launcher (tile grid + List/Cards) still lives behind the "עוד" tile (?tab=all).
              <ManagementLanding he={he} rtl={rtl} bi={bi} myPartner={myPartner}
                onPick={setTab} onOpenPartner={setPersonal} />
            ) : tab === "all" ? (
              // "עוד במערכת" CHILD — the full grouped launcher (tile grid + List/Cards toggle)
              // lives HERE, off the home-style launcher, reached from the "עוד במערכת" chip.
              <>
                <BackRow he={he} rtl={rtl} onBack={() => setTab(isOwner() ? "console" : "menu")} />
                <div style={{ marginTop: 12 }}>
                  {isFullViewer() && (
                    <div style={{ marginBottom: 18 }}>
                      <AutoPilotsEntryTile he={he} rtl={rtl} onOpen={() => setTab("autopilots")} />
                    </div>
                  )}
                  <PortalMenu items={TABS} he={he} rtl={rtl} onPick={setTab} />
                </div>
              </>
            ) : (
              <>
                <BackRow he={he} rtl={rtl} onBack={() => setTab(isOwner() ? "console" : "menu")} />
                <div style={{ marginTop: 12 }}>
                  {tab === "daily" && <Daily bi={bi} he={he} rtl={rtl} goto={setTab} />}
                  {tab === "overview" && <Overview bi={bi} />}
                  {tab === "team" && <Team bi={bi} he={he} rtl={rtl} onOpen={setPersonal} />}
                  {tab === "board" && <Board bi={bi} he={he} rtl={rtl} onOpen={setPersonal} />}
                  {tab === "vote" && <Vote bi={bi} he={he} rtl={rtl} />}
                  {/* Promote (vote → board) is OWNER-ONLY (backend require_owner), so a non-owner
                      manager (Oren/Raz) reads Results but never gets a dead promote button. */}
                  {tab === "results" && <Results bi={bi} he={he} rtl={rtl} canPromote={isOwner()} />}
                  {tab === "progress" && <Progress bi={bi} he={he} />}
                  {tab === "guide" && <Guide bi={bi} he={he} rtl={rtl} goto={setTab} />}
                  {/* Owner-only management CONSOLE (P2.2) — read-only shell over projects/scopes. */}
                  {tab === "console" && isOwner() && <MgmtConsole he={he} rtl={rtl} goto={(t) => setTab(t as ShellTab)} />}
                  {/* Owner-only SHARED FUND (P3) — ownership %/NAV, separated, read-only. */}
                  {tab === "fund" && isOwner() && <SharedFund he={he} rtl={rtl} />}
                  {/* Owner-only AUDIT master view — ALL domains (it/legal/product), full manage. */}
                  {tab === "audit" && isOwner() && <AuditPortal master />}
                  {/* Owner-only employee management. */}
                  {tab === "employees" && isOwner() && <Employees he={he} rtl={rtl} />}
                  {/* AutoPilots — visible to the full-viewer (owners + IT editor / Oren); the
                      component itself makes the view read-only for a non-owner (no arm/keys/go-live). */}
                  {tab === "autopilots" && isFullViewer() && <AutoPilots he={he} rtl={rtl} initialPilotId={sp.get("pilot")} />}
                  {/* Embedded collaborator portals — private tabs only (shared owner tabs live here in /owners). */}
                  {tab === "legalPortal" && isLegalEditor() && <Portal domain="legal" embedded />}
                  {tab === "itPortal" && isItEditor() && <Portal domain="it" embedded />}
                  {tab === "bizPortal" && isBizEditor() && <Portal domain="biz" embedded />}
                  {/* Finance: full-viewer sees it; the backend decides the shape (owner=full,
                      operator=filtered structure) and the panel renders read-only accordingly. */}
                  {tab === "finance" && isFullViewer() && <FinancePanel he={he} rtl={rtl} />}
                </div>
              </>
            )}
          </div>
        </>
      )}
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}
