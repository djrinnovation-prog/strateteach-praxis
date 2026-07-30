import React, { useEffect, useState } from "react";
import {
  ShieldCheck, TrendingUp, MessageCircle, UserCog, Megaphone, Minus, Maximize2,
  Users, Cpu, ArrowLeftRight, MonitorPlay, LifeBuoy, X, Trophy, Activity, UserSearch,
  Construction, Diamond, Mail, BarChart3, Inbox, ScrollText, ClipboardList,
} from "lucide-react";
import { api, isAdmin, isMainAdmin, isAdminOrOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import { premSoft } from "../ui";
import TileNav from "../components/TileNav";
import TourLauncher from "../components/TourLauncher";
import { ScreenHeader } from "../components/ScreenHeader";
import AdminAccess from "./AdminAccess";
import BotManager from "./BotManager";
import Chat from "./Chat";
import Exchange from "./Exchange";
import Profit from "./Profit";
import Screens from "./Screens";
import HelpRequests from "./HelpRequests";
import PromoteFeature from "./PromoteFeature";
import DemoLeaderboard from "./DemoLeaderboard";
import RunsReport from "./RunsReport";
import UserDetail from "./UserDetail";
import AdminMessage from "./AdminMessage";
import AdminInbox from "./AdminInbox";
import MeasurementDashboard from "../components/MeasurementDashboard";
import SafetyDashboard from "../components/SafetyDashboard";
import AuditPortal from "../components/AuditPortal";
import AdminExtras from "../components/AdminExtras";
import GuideManager from "./GuideManager";

// Admin springboard — follows the app's design language (Home/Profit):
//   top = Back + Home (provided by Shell) · middle = up to 4 square FATHER tiles ·
//   each father pulls a sub-menu DOWN to its child screens (grandchild = the screen
//   itself). Locked to one mobile screen — only the open child's data list scrolls.
// The four fathers group every existing admin action (nothing was removed):
//   1) Users & access   → access grants/coupons · strategy-help requests
//   2) Trading & P&L     → self-trading (live) · trading engine
//   3) System & bots     → bot manager · screen monitoring
//   4) Comms & promotion → discussions (chat) · promote a feature

type Lbl = { he: string; en: string };
type Child = { key: string; l: Lbl; Icon: React.FC<any>; Comp: React.FC<any>; mainAdmin?: boolean };
type Father = { key: string; l: Lbl; Icon: React.FC<any>; children: Child[] };

const FATHERS: Father[] = [
  {
    key: "users", l: { he: "משתמשים וגישה", en: "Users & access" }, Icon: Users,
    children: [
      { key: "access", l: { he: "גישה ותמיכה", en: "Access & support" }, Icon: UserCog, Comp: AdminAccess },
      { key: "management", l: { he: "ניהול משתמשים ומערכת", en: "User & system mgmt" }, Icon: ScrollText, Comp: AdminExtras, mainAdmin: true },
      { key: "userdetail", l: { he: "פירוט משתמש", en: "User lookup" }, Icon: UserSearch, Comp: UserDetail },
      { key: "leaderboard", l: { he: "לוח תוצאות", en: "Leaderboard" }, Icon: Trophy, Comp: DemoLeaderboard },
      { key: "help", l: { he: "עזרה לאסטרטגיות", en: "Strategy help" }, Icon: LifeBuoy, Comp: HelpRequests },
    ],
  },
  {
    key: "trading", l: { he: "מסחר ורווח", en: "Trading & P&L" }, Icon: TrendingUp,
    children: [
      { key: "trade", l: { he: "מסחר עצמי (לייב)", en: "Self-trading (live)" }, Icon: ArrowLeftRight, Comp: Exchange },
      { key: "profit", l: { he: "מנוע מסחר", en: "Trading engine" }, Icon: TrendingUp, Comp: Profit },
      { key: "runs", l: { he: "דוח ריצות", en: "Runs report" }, Icon: Activity, Comp: RunsReport },
    ],
  },
  {
    key: "system", l: { he: "מערכת ובוטים", en: "System & bots" }, Icon: Cpu,
    children: [
      { key: "bots", l: { he: "ניהול בוטים", en: "Bot manager" }, Icon: Cpu, Comp: BotManager },
      { key: "measure", l: { he: "מדידה (KPI)", en: "Measurement (KPI)" }, Icon: BarChart3, Comp: MeasurementDashboard },
      { key: "safety", l: { he: "בטיחות (M4)", en: "Safety (M4)" }, Icon: ShieldCheck, Comp: SafetyDashboard },
      { key: "audit", l: { he: "ביקורת יומית", en: "Daily audit" }, Icon: ClipboardList, Comp: () => <AuditPortal /> },
      { key: "guide", l: { he: "מדריך הבית", en: "Home guide" }, Icon: Diamond, Comp: GuideManager },
      { key: "monitor", l: { he: "ניטור מסכים", en: "Screen monitoring" }, Icon: MonitorPlay, Comp: Screens },
    ],
  },
  {
    key: "comms", l: { he: "תקשורת וקידום", en: "Comms & promo" }, Icon: MessageCircle,
    children: [
      { key: "inbox", l: { he: "מענה למשתמשים", en: "Reply to users" }, Icon: Inbox, Comp: AdminInbox },
      { key: "discuss", l: { he: "דיונים (צ'אט)", en: "Discussions (chat)" }, Icon: MessageCircle, Comp: Chat },
      { key: "reply", l: { he: "הודעה מותגת", en: "Branded message" }, Icon: Mail, Comp: AdminMessage },
      { key: "promote", l: { he: "קידום פיצ'ר", en: "Promote feature" }, Icon: Megaphone, Comp: PromoteFeature },
    ],
  },
];

export default function Admin() {
  const { lang } = useI18n();
  // Which father tile is open (""=none) and which child is selected inside it.
  const [father, setFather] = useState<string>("");
  const [child, setChild] = useState<string>("");

  // Any admin (role==="admin") reaches the panel — secondary admins operate it too.
  // Admin-MANAGEMENT (user CRUD, admin grants) stays super-admin-only, enforced in
  // the backend (require_main_admin + assert_can_manage_user) and hidden in Settings.
  if (!isAdmin()) {
    return (
      <div style={{ ...card, textAlign: "center", color: C.muted, fontSize: 14, marginTop: 24 }}>
        <ShieldCheck size={20} color={C.gold} style={{ marginBottom: 8 }} />
        <div>{lang === "he" ? "אזור מנהל בלבד." : "Admins only."}</div>
      </div>
    );
  }

  // Open a father tile → default to its first child screen (toggle closed if re-tapped).
  const openFather = (k: string) => {
    if (father === k) { setFather(""); setChild(""); return; }
    const f = FATHERS.find((x) => x.key === k);
    setFather(k);
    setChild(f?.children[0]?.key || "");
  };

  const fa = FATHERS.find((f) => f.key === father) || null;
  // Main-admin-only children (e.g. user/system management) are hidden from secondary
  // admins — same gating they had when these panels lived in Settings.
  const visKids = (f: Father | null) => (f ? f.children.filter((c) => !c.mainAdmin || isAdminOrOwner()) : []);
  const ch = visKids(fa).find((c) => c.key === child) || null;

  return (
    <div style={{ fontFamily: UI }}>
      <TourLauncher screen="admin" />
      <style>{"@keyframes admDrop{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}"}</style>

      {/* Home-like clean top: the wordmark ScreenHeader with THIS screen's own name.
          The P&L (תיק) balance card is intentionally OMITTED here — Admin is an
          operations control panel (not a personal trading surface), and its
          springboard is locked to one mobile screen, so a balance card would only
          push the four father tiles down without adding admin value. */}
      <div style={{ marginBottom: 16 }}>
        <ScreenHeader
          hub
          icon={<Diamond size={20} color={C.gold} fill={C.gold} />}
          title={lang === "he" ? "ניהול" : "Admin"}
          subtitle={lang === "he" ? "בקרת ניהול — משתמשים, מסחר, מערכת ותקשורת" : "Admin controls — users, trading, system & comms"}
        />
      </div>

      {/* Global maintenance / "under development" gate toggle */}
      <MaintenanceToggle />

      {/* the four FATHER tiles (springboard) */}
      <TileNav
        hub
        active={father}
        onSelect={openFather}
        items={FATHERS.map((f) => ({
          key: f.key,
          label: f.l[lang],
          Icon: f.Icon,
          grad: `linear-gradient(140deg, ${C.gold}, ${C.accent} 52%, ${C.blue})`,
          tour: `admin-${f.key}`,
        }))}
      />

      {/* pull-down: the open father's child screens (sub-menu) + the active child panel */}
      {fa && (
        <div style={{ animation: "admDrop .3s cubic-bezier(.22,.61,.36,1) both" }}>
          <div style={subRow}>
            {visKids(fa).map((c) => (
              <button key={c.key} onClick={() => setChild(c.key)} style={chip(child === c.key)}>
                <c.Icon size={13} /> {c.l[lang]}
              </button>
            ))}
            <button onClick={() => { setFather(""); setChild(""); }} style={{ ...chip(false), marginInlineStart: "auto" }}
              title={lang === "he" ? "סגור" : "Close"}>
              <X size={13} /> {lang === "he" ? "סגור" : "Close"}
            </button>
          </div>
          {ch && (
            <Panel key={`${fa.key}:${ch.key}`} id={`${fa.key}_${ch.key}`} title={ch.l[lang]} icon={<ch.Icon size={14} />}>
              <ch.Comp />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

// A minimize / maximize wrapper around each admin child screen. Loads expanded; the
// admin can collapse it to a slim title bar and the choice is remembered.
function Panel({ id, title, icon, children }: { id: string; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const { lang } = useI18n();
  const key = `algo770_adminpanel_${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "0"; } catch { return true; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(key, v ? "1" : "0"); } catch (_e) { /* */ } };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 14,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}` }}>
      <button onClick={toggle} style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, padding: "11px 14px", background: open ? C.surface2 : "transparent", border: "none", borderBottom: open ? `1px solid ${C.line}` : "none",
        cursor: "pointer", fontFamily: UI, color: C.text }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13.5 }}>
          <span style={{ color: C.gold, display: "inline-flex" }}>{icon}</span> {title}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 11.5, fontWeight: 700 }}>
          {open ? (lang === "he" ? "מזער" : "Minimize") : (lang === "he" ? "הצג" : "Maximize")}
          {open ? <Minus size={15} /> : <Maximize2 size={14} />}
        </span>
      </button>
      {open && <div style={{ padding: 16 }}>{children}</div>}
    </div>
  );
}

// Global "under development" gate: when ON, every non-admin sees the maintenance
// splash instead of the app; admins always keep full access. The owner flips it
// here once the new version is ready (and can re-enable it anytime).
function MaintenanceToggle() {
  const { lang } = useI18n();
  const rtl = lang === "he";
  // Only the MAIN admin may turn maintenance OFF (lift the lock). Any admin may turn
  // it ON. So when it's currently ON, a non-main admin sees the status but no OFF
  // switch — mirroring the backend, which 403s a non-main admin's OFF request.
  const canOff = isMainAdmin();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api.maintenanceStatus()
      .then((m) => { if (alive) setOn(!!m.maintenance); })
      .catch(() => { if (alive) setOn(null); });
    return () => { alive = false; };
  }, []);
  const active = on === true;
  const offBlocked = active && !canOff;  // can't lift maintenance unless main admin
  const toggle = async () => {
    if (on === null || busy || offBlocked) return;
    setBusy(true);
    try { const r = await api.setMaintenance(!on); setOn(!!r.maintenance); }
    catch (_e) { /* keep current state on failure */ }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...card, padding: 14, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 13.5, color: C.text }}>
        <Construction size={16} color={active ? C.gold : C.muted} />
        {rtl ? "מצב תחזוקה" : "Maintenance mode"}
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
        background: active ? `${C.gold}22` : `${C.gain}22`,
        color: active ? C.gold : C.gain, border: `1px solid ${active ? C.gold : C.gain}55` }}>
        {on === null ? "…" : active ? (rtl ? "פעיל" : "ON") : (rtl ? "כבוי" : "OFF")}
      </span>
      <span style={{ fontSize: 11.5, color: C.muted, flex: "1 1 160px", minWidth: 140 }}>
        {rtl ? "כשפעיל — משתמשים רואים מסך \"בפיתוח\". מנהלים תמיד עם גישה מלאה."
             : "When ON, users see an \"under development\" screen. Admins always keep full access."}
      </span>
      {/* Premium finish: when OFF, a primary skin-accent tile (turn ON); when active,
          a quiet soft-secondary (turn OFF). whiteSpace:nowrap keeps the long HE labels
          ("הפעל מצב תחזוקה" / "כבה מצב תחזוקה") on one line — the card flex-wraps it.
          A non-main admin can't lift maintenance: the OFF switch is replaced by a note. */}
      {offBlocked ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800,
          color: C.muted, whiteSpace: "nowrap" }}>
          {rtl ? "רק מנהל ראשי יכול לכבות" : "Only the main admin can turn this off"}
        </span>
      ) : (
        <button onClick={toggle} disabled={on === null || busy}
          className={active ? undefined : "gbtn ptile"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 14, padding: "9px 16px",
            fontWeight: 800, fontSize: 12.5, fontFamily: UI, whiteSpace: "nowrap",
            cursor: (on === null || busy) ? "default" : "pointer",
            ...(active ? { ...premSoft(), color: C.text } : {}),
            opacity: (on === null || busy) ? 0.6 : 1 }}>
          {busy ? (rtl ? "מעדכן…" : "Saving…") : active ? (rtl ? "כבה מצב תחזוקה" : "Turn OFF") : (rtl ? "הפעל מצב תחזוקה" : "Turn ON")}
        </button>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18,
  boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}` };
const subRow: React.CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${C.line}` };

// Child-selector chip — a small premium control: skin-accent fill when active, a
// soft inner top-highlight so it reads as its own pressable chip, and whiteSpace
// nowrap so multi-word labels (EN "Self-trading (live)" / HE "מסחר עצמי (לייב)")
// never break mid-word — the flex row wraps whole chips instead.
function chip(active: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, background: active ? "var(--btn-bg)" : C.surface2,
    color: active ? "var(--btn-ink)" : C.muted, border: `1px solid ${active ? C.gold : C.line}`, borderRadius: 10,
    padding: "8px 13px", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: UI, whiteSpace: "nowrap",
    boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,0.25)" : "inset 0 1px 0 rgba(255,255,255,0.18)" };
}
