import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Diamond, Scale, Wrench, TrendingUp, MessageSquare, FileEdit, ListChecks, FileText,
  Plus, Send, Loader2, Trash2, CheckCircle2, RotateCcw, ChevronRight,
  Download, ExternalLink, Mail, Circle, ChevronDown, Check, X,
  Sunrise, Sparkles, Users, ClipboardList, Milestone, Vote as VoteIcon, GraduationCap,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api, isLegalEditor, isItEditor, isBizEditor, isOwner } from "../app/api";
import { useI18n } from "../i18n";
import { C, SHADOW } from "../theme";
import FramedTitle from "../components/FramedTitle";
import ScreenBottom from "../components/ScreenBottom";
import { input, btn } from "../ui";
import LegalEditor from "../components/LegalEditor";
import LegalCopyEditor from "../components/LegalCopyEditor";
import AuditPortal from "../components/AuditPortal";
import ItEditor from "../components/ItEditor";
import BizEditor from "../components/BizEditor";
import TaskComments from "../components/TaskComments";
import { PriorityChip, PrioritySelect, priorityWeight } from "../components/Priority";
import { TEAM, type Bi } from "../lib/owners";
import type { LegalSection, LegalNote, LegalChatMsg, PmTask, PmStatus, PortalDomain } from "../lib/client";
// Shared owner-portal tabs — the SAME self-contained components /owners renders. Collaborators
// participate in the whole-project view: daily update, what we built, team, board, voting
// (they CAST — not read-only), and progress. Finance is excluded (stays owner-only in Owners).
import {
  Daily, Overview, Team, Board, Vote, Progress, PersonalScreen, BackRow, type Tab as OwnerTab,
} from "./ownersShared";

// ── Portal — ONE generic, domain-parameterised PRIVATE workspace between a collaborator and
// the three owners (Dan / Rafi / Yoav). Two domains render from this same component:
//   • domain="legal" → /legal-portal — the legal counsel (Raz), tabs צ'אט·סקשנים·עריכה·משימות·דוח
//   • domain="it"    → /it-portal    — the IT lead (Oren),      tabs צ'אט·סקשנים·משימות
// The legal domain behaves exactly as the former LegalPortal. Gating + storage are per-domain
// server-side (require_legal_editor / require_it_editor; a `domain` partition on the store).
// Private (per-domain) tabs + the SHARED owner-portal tabs both collaborators also get.
type PrivateTab = "home" | "chat" | "sections" | "editing" | "audit" | "tasks" | "report";
type SharedTab = "daily" | "overview" | "team" | "board" | "vote" | "progress";
type TabKey = PrivateTab | SharedTab;
const SHARED_TABS: SharedTab[] = ["daily", "overview", "team", "board", "vote", "progress"];
const isShared = (t: TabKey): t is SharedTab => (SHARED_TABS as string[]).includes(t);
type Pair = readonly [string, string];
const T = (p: Pair, he: boolean) => (he ? p[0] : p[1]);

interface DomainCfg {
  partner: string;                 // PM partner id the Tasks tab is pinned to (raz | oren)
  canView: () => boolean;          // frontend gate (owner OR the matching editor flag)
  tabs: TabKey[];
  Icon: any;                       // tab-bar icon for the "sections" list header
  editing?: () => React.ReactNode; // node for the "עריכה" tab (legal → LegalEditor)
  editingLabel?: Pair;             // per-domain tab-bar label override for the "editing" tab
  audit?: () => React.ReactNode;   // node for the "ביקורת" tab (legal/it → AuditPortal)
  title: Pair; subtitle: Pair; chatTitle: Pair; chatEmpty: Pair;
  sectionsEmpty: Pair; sectionSelectHint: Pair;
  newSectionTitlePh: Pair; newSectionBodyPh: Pair;
  tasksHeader: Pair; goalFallback: Pair; newTaskTitle: Pair; tasksEmpty: Pair;
  reportTitle: Pair; reportCopy: Pair;
}

const DOMAINS: Record<PortalDomain, DomainCfg> = {
  legal: {
    // "home" is Raz's landing: what needs her review, the open dilemmas, progress and
    // updates — all in one place. Chat is one click away rather than the centrepiece.
    partner: "raz", canView: isLegalEditor, tabs: ["home", "chat", "sections", "editing", "audit", "tasks", "report", ...SHARED_TABS],
    // The "editing" tab hosts BOTH the 4 approval-gated legal BLOCKS (analytics/safety plan)
    // and the full Legal Console (all legal texts). The "audit" tab shows the legal audit rows.
    Icon: Scale, editing: () => (<div style={{ display: "flex", flexDirection: "column", gap: 22 }}><LegalCopyEditor /><LegalEditor /></div>),
    audit: () => <AuditPortal domains={["legal"]} />,
    title: ["פורטל משפטי", "Legal Portal"],
    subtitle: ["מרחב פרטי בין רז לבעלים — צ'אט, סקשנים, עריכה, משימות ודוח",
      "A private space between Raz and the owners — chat, sections, editing, tasks & report"],
    chatTitle: ["צ'אט פרטי — רז והבעלים", "Private chat — Raz & the owners"],
    chatEmpty: ["התחילו את השיחה — הודעות כאן נראות רק לרז ולשלושת הבעלים.",
      "Start the conversation — messages here are visible only to Raz and the three owners."],
    sectionsEmpty: ["אין עדיין סקשנים. פתחי אחד לרישום תיקון, בעיה או שאלה עבור הבעלים.",
      "No sections yet. Open one to log a correction, issue or question for the owners."],
    sectionSelectHint: ["בחרי סקשן, או פתחי חדש.", "Select a section, or open a new one."],
    newSectionTitlePh: ["לדוגמה: תיקון בסעיף אחריות", "e.g. Correction in the liability clause"],
    newSectionBodyPh: ["פרטי את התיקון / הבעיה / השאלה…", "Describe the correction / issue / question…"],
    tasksHeader: ["משימות משפטיות", "Legal tasks"], goalFallback: ["יעד משפטי", "Legal goal"],
    newTaskTitle: ["משימה משפטית חדשה", "New legal task"],
    tasksEmpty: ["אין עדיין משימות משפטיות — צרי אחת.", "No legal tasks yet — create one."],
    reportTitle: ["דוח סיכום משפטי", "Legal summary report"],
    reportCopy: ["סיכום הצד המשפטי שלך מול הבעלים — המשימות המשפטיות וההתקדמות, ופעילות הפורטל (סקשנים, הערות וצ'אט). באותו עיצוב כמו הדוח היומי. השליחה מגיעה רק ל-3 הבעלים (דן/רפי/יואב) — במייל ובנוסף SMS עם לינק לעמוד.",
      "A summary of your legal side with the owners — the legal tasks & progress, plus portal activity (sections, notes & chat). Same design as the daily report. Sending goes to the 3 owners only (Dan/Rafi/Yoav) — by email plus an SMS with a link to the page."],
  },
  it: {
    partner: "oren", canView: isItEditor, tabs: ["chat", "sections", "editing", "audit", "tasks", "report", ...SHARED_TABS],
    Icon: Wrench, editing: () => <ItEditor />,
    audit: () => <AuditPortal domains={["it", "product"]} />,
    title: ["פורטל IT", "IT Portal"],
    subtitle: ["מרחב פרטי בין אורן לבעלים — צ'אט, סקשנים, ניהול ועריכה, משימות ודוח",
      "A private space between Oren and the owners — chat, sections, editing, tasks & report"],
    chatTitle: ["צ'אט פרטי — אורן והבעלים", "Private chat — Oren & the owners"],
    chatEmpty: ["התחילו את השיחה — הודעות כאן נראות רק לאורן ולשלושת הבעלים.",
      "Start the conversation — messages here are visible only to Oren and the three owners."],
    sectionsEmpty: ["אין עדיין סקשנים. פתחו אחד לרישום נושא, בעיה או שאלה עבור הבעלים.",
      "No sections yet. Open one to log a topic, issue or question for the owners."],
    sectionSelectHint: ["בחרו סקשן, או פתחו חדש.", "Select a section, or open a new one."],
    newSectionTitlePh: ["לדוגמה: שדרוג תשתית שרתים", "e.g. Server infrastructure upgrade"],
    newSectionBodyPh: ["פרטו את הנושא / הבעיה / השאלה…", "Describe the topic / issue / question…"],
    tasksHeader: ["משימות IT", "IT tasks"], goalFallback: ["יעד IT", "IT goal"],
    newTaskTitle: ["משימת IT חדשה", "New IT task"],
    tasksEmpty: ["אין עדיין משימות IT — צרו אחת.", "No IT tasks yet — create one."],
    reportTitle: ["דוח סיכום IT", "IT summary report"],
    reportCopy: ["סיכום הצד הטכני שלך מול הבעלים — משימות ה-IT וההתקדמות, ופעילות הפורטל (סקשנים, מסמכים וקישורי מערכת). באותו עיצוב כמו הדוח היומי. השליחה מגיעה רק ל-3 הבעלים (דן/רפי/יואב) — במייל ובנוסף SMS עם לינק לעמוד.",
      "A summary of your IT side with the owners — the IT tasks & progress, plus portal activity (sections, docs & system links). Same design as the daily report. Sending goes to the 3 owners only (Dan/Rafi/Yoav) — by email plus an SMS with a link to the page."],
  },
  biz: {
    // Content-heavy: the "editing" tab is Raful's DOCUMENTS & MATERIALS store (files + rich text)
    // + links & sources — relabeled from IT's "link your systems to us". Everything EXCEPT finances.
    partner: "raful", canView: isBizEditor, tabs: ["chat", "sections", "editing", "tasks", "report", ...SHARED_TABS],
    Icon: TrendingUp, editing: () => <BizEditor />,
    editingLabel: ["מסמכים וחומרים", "Documents & Materials"],
    title: ["פורטל פיתוח עסקי", "Business Development Portal"],
    subtitle: ["מרחב פרטי בין רפול לבעלים — צ'אט, סקשנים, מסמכים וחומרים, משימות ודוח",
      "A private space between Raful and the owners — chat, sections, documents & materials, tasks & report"],
    chatTitle: ["צ'אט פרטי — רפול והבעלים", "Private chat — Raful & the owners"],
    chatEmpty: ["התחילו את השיחה — הודעות כאן נראות רק לרפול ולשלושת הבעלים.",
      "Start the conversation — messages here are visible only to Raful and the three owners."],
    sectionsEmpty: ["אין עדיין סקשנים. פתחו אחד לרישום הזדמנות, שותפות, נושא או שאלה עבור הבעלים.",
      "No sections yet. Open one to log an opportunity, partnership, topic or question for the owners."],
    sectionSelectHint: ["בחרו סקשן, או פתחו חדש.", "Select a section, or open a new one."],
    newSectionTitlePh: ["לדוגמה: שותפות אסטרטגית חדשה", "e.g. New strategic partnership"],
    newSectionBodyPh: ["פרטו את ההזדמנות / הנושא / השאלה…", "Describe the opportunity / topic / question…"],
    tasksHeader: ["משימות פיתוח עסקי", "Business development tasks"], goalFallback: ["יעד פיתוח עסקי", "Biz-dev goal"],
    newTaskTitle: ["משימת פיתוח עסקי חדשה", "New business development task"],
    tasksEmpty: ["אין עדיין משימות פיתוח עסקי — צרו אחת.", "No business-development tasks yet — create one."],
    reportTitle: ["דוח סיכום פיתוח עסקי", "Business Development summary report"],
    reportCopy: ["סיכום צד הפיתוח העסקי שלך מול הבעלים — המשימות וההתקדמות, ופעילות הפורטל (סקשנים, הערות וצ'אט). באותו עיצוב כמו הדוח היומי. השליחה מגיעה רק ל-3 הבעלים (דן/רפי/יואב) — במייל ובנוסף SMS עם לינק לעמוד.",
      "A summary of your business-development side with the owners — the tasks & progress, plus portal activity (sections, notes & chat). Same design as the daily report. Sending goes to the 3 owners only (Dan/Rafi/Yoav) — by email plus an SMS with a link to the page."],
  },
};

// Context threads the active domain + its config to every tab without prop drilling.
const PortalCtx = createContext<{ domain: PortalDomain; cfg: DomainCfg }>({ domain: "legal", cfg: DOMAINS.legal });
const usePortal = () => useContext(PortalCtx);

// `embedded` renders the portal INSIDE the Owners Portal (Phase 5): owners view/manage each
// collaborator's portal as a sub-section, so only the domain-PRIVATE tabs show (the shared
// owner tabs already live in /owners) and the outer screen header is dropped.
export default function Portal({ domain, embedded = false }: { domain: PortalDomain; embedded?: boolean }) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const bi = (b: Bi) => (he ? b.he : b.en);
  const cfg = DOMAINS[domain];
  const canView = cfg.canView(); // owner OR the domain editor flag (same gate as the backend)
  const visibleTabs = embedded ? cfg.tabs.filter((t) => !isShared(t)) : cfg.tabs;
  const [params] = useSearchParams();
  const initialTab = ((!embedded && visibleTabs.includes((params.get("tab") || "") as TabKey))
    ? (params.get("tab") as TabKey) : visibleTabs[0]);
  const [tab, setTab] = useState<TabKey>(initialTab);
  // A shared-tab drill-down into a partner's personal screen (Team/Board "personal screen").
  const [personal, setPersonal] = useState<string | null>(null);

  const TAB_META: Record<TabKey, { label: Pair; icon: React.ReactNode }> = {
    home:     { label: ["בית", "Home"],                   icon: <Sparkles size={15} /> },
    chat:     { label: ["צ'אט", "Chat"],                 icon: <MessageSquare size={15} /> },
    sections: { label: ["סקשנים והערות", "Sections & notes"], icon: <cfg.Icon size={15} /> },
    editing:  { label: cfg.editingLabel || ["עריכה", "Editing"], icon: <FileEdit size={15} /> },
    audit:    { label: ["ביקורת", "Audit"],               icon: <ClipboardList size={15} /> },
    tasks:    { label: ["משימות", "Tasks"],               icon: <ListChecks size={15} /> },
    report:   { label: ["דוח סיכום", "Summary report"],   icon: <FileText size={15} /> },
    // Shared owner-portal tabs (same components /owners uses). "עדכון יומי" is the renamed daily.
    daily:    { label: ["עדכון יומי", "Daily update"],    icon: <Sunrise size={15} /> },
    overview: { label: ["מה בנינו", "Overview"],          icon: <Sparkles size={15} /> },
    team:     { label: ["צוות", "Team"],                  icon: <Users size={15} /> },
    board:    { label: ["לוח משימות", "Board"],           icon: <ClipboardList size={15} /> },
    vote:     { label: ["הצבעה", "Vote"],                 icon: <VoteIcon size={15} /> },
    progress: { label: ["התקדמות", "Progress"],           icon: <Milestone size={15} /> },
  };

  if (!canView) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <FramedTitle text={T(cfg.title, he)} />
        <div style={{ marginTop: 20, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, color: C.muted, fontSize: 14 }}>
          {domain === "legal"
            ? (he ? "הפורטל המשפטי פתוח לרז ולבעלים בלבד." : "The Legal Portal is available to Raz and the owners only.")
            : domain === "it"
            ? (he ? "פורטל ה-IT פתוח לאורן ולבעלים בלבד." : "The IT Portal is available to Oren and the owners only.")
            : (he ? "פורטל הפיתוח העסקי פתוח לרפול ולבעלים בלבד." : "The Business Development Portal is available to Raful and the owners only.")}
        </div>
      </div>
    );
  }

  return (
    <PortalCtx.Provider value={{ domain, cfg }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        {!embedded && (
          <FramedTitle text={T(cfg.title, he)} subtitle={T(cfg.subtitle, he)} />
        )}

        {/* ── tab bar ── */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: embedded ? 0 : 16, marginBottom: 18 }}>
          {visibleTabs.map((k) => {
            const on = tab === k;
            return (
              <button key={k} onClick={() => { setTab(k); setPersonal(null); }} className="tap44"
                style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 14px", borderRadius: 999,
                  border: `1px solid ${on ? C.gold : C.line}`, background: on ? `${C.gold}1a` : C.surface,
                  color: on ? C.gold : C.muted, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                {TAB_META[k].icon} {T(TAB_META[k].label, he)}
              </button>
            );
          })}
        </div>

        {/* private (per-domain) tabs */}
        {tab === "home" && <LegalHome he={he} rtl={rtl} go={(t: TabKey) => setTab(t)} />}
        {tab === "chat" && <ChatTab he={he} />}
        {tab === "sections" && <SectionsTab he={he} />}
        {tab === "editing" && (cfg.editing ? cfg.editing() : null)}
        {tab === "audit" && (cfg.audit ? cfg.audit() : null)}
        {tab === "tasks" && <TasksTab he={he} />}
        {tab === "report" && <ReportTab he={he} />}

        {/* shared owner-portal tabs — the collaborator participates in the whole-project view.
            Team/Board can drill into a partner's (read-only) personal screen. */}
        {isShared(tab) && (personal ? (
          <>
            <BackRow he={he} rtl={rtl} onBack={() => setPersonal(null)} />
            <PersonalScreen partner={personal} manager={false} self={false} bi={bi} he={he} rtl={rtl} />
          </>
        ) : (
          <>
            {tab === "daily" && <Daily bi={bi} he={he} rtl={rtl} goto={(t: OwnerTab) => { if ((cfg.tabs as string[]).includes(t)) setTab(t as TabKey); }} />}
            {tab === "overview" && <Overview bi={bi} />}
            {tab === "team" && <Team bi={bi} he={he} rtl={rtl} onOpen={setPersonal} />}
            {tab === "board" && <Board bi={bi} he={he} rtl={rtl} onOpen={setPersonal} />}
            {tab === "vote" && <Vote bi={bi} he={he} rtl={rtl} />}
            {tab === "progress" && <Progress bi={bi} he={he} />}
          </>
        ))}
        {/* Persistent bottom cluster (like Home) — standalone portal only; the embedded
            portal lives inside Owners, which renders its own footer. */}
        {!embedded && <ScreenBottom />}
      </div>
    </PortalCtx.Provider>
  );
}

// ── Summary report tab — the domain-scoped report (owners-report style) ────────
function ReportTab({ he }: { he: boolean }) {
  const { domain, cfg } = usePortal();
  const [sent, setSent] = useState<null | { ok: number; total: number; smsOk: number; smsTotal: number; error?: string }>(null);
  // `nonce` cache-busts the preview iframe so a Refresh forces it to RE-FETCH a fresh render
  // (the server renders live from current PM data; the stale copy is the browser/iframe cache).
  const [nonce, setNonce] = useState(0);
  const linkQ = useQuery({ queryKey: ["portalReportLink", domain], queryFn: () => api.portalReportLink(domain) });
  const html = linkQ.data?.html;
  const pdf = linkQ.data?.pdf;
  const bust = (u?: string) => (u ? u + (u.includes("?") ? "&" : "?") + "_r=" + nonce : u);

  const sendM = useMutation({
    mutationFn: () => api.portalReportSend(domain),
    onSuccess: (r) => setSent({ ok: r.sent, total: r.total, smsOk: r.smsSent, smsTotal: r.smsTotal, error: r.error }),
    onError: (e: any) => setSent({ ok: 0, total: 0, smsOk: 0, smsTotal: 0, error: String(e?.message || e) }),
  });
  // Refresh → re-mint a fresh link (new token) + bust the iframe → the preview re-renders from
  // CURRENT data. Flow: Refresh → View → Send. (Send always renders fresh server-side too.)
  const refresh = () => { setSent(null); setNonce((n) => n + 1); linkQ.refetch(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* header + actions */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, color: C.text }}>
          <FileText size={17} color={C.gold} /> {T(cfg.reportTitle, he)}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: "8px 0 14px" }}>
          {T(cfg.reportCopy, he)}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={refresh} disabled={linkQ.isFetching} style={{ ...btn(false) }}
            title={he ? "רענון הנתונים לפני צפייה/שליחה" : "Refresh the data before viewing/sending"}>
            {linkQ.isFetching ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} {he ? "רענון" : "Refresh"}
          </button>
          <a href={bust(html) || "#"} target="_blank" rel="noreferrer"
            style={{ ...btn(false), textDecoration: "none", opacity: html ? 1 : 0.5, pointerEvents: html ? "auto" : "none" }}>
            <ExternalLink size={15} /> {he ? "צפייה בדוח" : "View report"}
          </a>
          <a href={bust(pdf) || "#"} target="_blank" rel="noreferrer"
            style={{ ...btn(false), textDecoration: "none", opacity: pdf ? 1 : 0.5, pointerEvents: pdf ? "auto" : "none" }}>
            <Download size={15} /> {he ? "הורדת PDF" : "Download PDF"}
          </a>
          <button onClick={() => { setSent(null); sendM.mutate(); }} disabled={sendM.isPending} style={{ ...btn(true), marginInlineStart: "auto" }}>
            {sendM.isPending ? <Loader2 size={15} className="spin" /> : <Mail size={15} />} {he ? "שליחה לבעלים" : "Send to owners"}
          </button>
        </div>
        {sent && (
          <div style={{ marginTop: 12, fontSize: 13, borderRadius: 10, padding: "9px 12px",
            background: sent.error ? `${C.loss}14` : `${C.gain}14`, border: `1px solid ${sent.error ? C.loss : C.gain}55`,
            color: sent.error ? C.loss : C.gain, display: "flex", alignItems: "center", gap: 7 }}>
            {sent.error ? null : <CheckCircle2 size={15} />}
            {sent.error
              ? (he ? "שגיאה בשליחה: " : "Send error: ") + sent.error
              : (he ? `נשלח ל-${sent.ok}/${sent.total} בעלים · SMS ${sent.smsOk}/${sent.smsTotal} ✓` : `Sent to ${sent.ok}/${sent.total} owners · SMS ${sent.smsOk}/${sent.smsTotal} ✓`)}
          </div>
        )}
      </div>

      {/* live preview (same visual style as the owners daily report) */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 8, boxShadow: SHADOW }}>
        {linkQ.isLoading ? (
          <div style={{ padding: 24, color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
        ) : html ? (
          <iframe key={nonce} title="portal-report" src={bust(html)} style={{ width: "100%", height: "min(70vh, 720px)", border: "none", borderRadius: 10, background: "#fff" }} />
        ) : (
          <div style={{ padding: 24, color: C.muted, fontSize: 13 }}>{he ? "לא ניתן לטעון תצוגה מקדימה." : "Preview unavailable."}</div>
        )}
      </div>
    </div>
  );
}

// ── Chat tab — the private room shared by the collaborator + the 3 owners ──────
function ChatTab({ he }: { he: boolean }) {
  const { domain, cfg } = usePortal();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const q = useQuery({
    queryKey: ["portalChat", domain],
    queryFn: () => api.portalChat(domain, 0),
    refetchInterval: 5000,   // low-volume 4-person room — a full poll every 5s is plenty
  });
  const msgs = (q.data?.messages || []) as LegalChatMsg[];

  const sendM = useMutation({
    mutationFn: () => api.portalChatSend(domain, draft.trim()),
    onSuccess: () => { setDraft(""); q.refetch(); },
  });

  // stick to the bottom as new messages arrive
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);

  const fmt = (s: string | null) => (s ? String(s).slice(0, 16).replace("T", " ") : "");
  const submit = () => { if (draft.trim() && !sendM.isPending) sendM.mutate(); };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: SHADOW, display: "flex", flexDirection: "column", height: "min(66vh, 640px)" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
        <MessageSquare size={16} color={C.gold} />
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{T(cfg.chatTitle, he)}</span>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {q.isLoading ? (
          <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
        ) : msgs.length === 0 ? (
          <div style={{ margin: "auto", color: C.muted, fontSize: 13, textAlign: "center", maxWidth: 340, lineHeight: 1.5 }}>
            {T(cfg.chatEmpty, he)}
          </div>
        ) : msgs.map((m) => (
          <div key={m.id} style={{ alignSelf: m.mine ? "flex-end" : "flex-start", maxWidth: "78%" }}>
            {!m.mine && <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, margin: "0 4px 2px" }}>{m.authorName}</div>}
            <div style={{ background: m.mine ? C.gold : C.surface2, color: m.mine ? "#0b0b0b" : C.text,
              border: `1px solid ${m.mine ? C.gold : C.line}`, borderRadius: 14, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {m.body}
            </div>
            <div style={{ fontSize: 10, color: C.faint, margin: "2px 6px", textAlign: m.mine ? "end" : "start" }}>{fmt(m.createdAt)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${C.line}`, display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea style={{ ...input, flex: 1, minHeight: 44, maxHeight: 140, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          placeholder={he ? "כתבו הודעה…  (⌘/Ctrl + Enter לשליחה)" : "Write a message…  (⌘/Ctrl + Enter to send)"} />
        <button onClick={submit} disabled={!draft.trim() || sendM.isPending} style={{ ...btn(true) }}>
          {sendM.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {he ? "שלח" : "Send"}
        </button>
      </div>
    </div>
  );
}

// ── Tasks tab — the collaborator's tasks, FULLY EDITABLE (same pm_tasks system) ─
const PM_STATUS: Record<PmStatus, { he: string; en: string; c: () => string }> = {
  todo:        { he: "לביצוע", en: "To do",       c: () => C.faint },
  in_progress: { he: "בתהליך", en: "In progress", c: () => C.gold },
  blocked:     { he: "חסום",   en: "Blocked",     c: () => C.loss },
  done:        { he: "הושלם",  en: "Done",        c: () => C.gain },
};
const PM_STATUS_KEYS: PmStatus[] = ["todo", "in_progress", "blocked", "done"];
const taskPartners = (t: PmTask): string[] => (t.partners && t.partners.length ? t.partners : (t.partner ? [t.partner] : []));

// People picker — assign a task to team members. The domain partner (raz/oren) is always
// assigned (the task stays this portal's task), so its chip is locked on.
function AssignChips({ value, onChange, he }: { value: string[]; onChange: (v: string[]) => void; he: boolean }) {
  const { cfg } = usePortal();
  const toggle = (id: string) => { if (id === cfg.partner) return; onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]); };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {TEAM.map((p) => {
        const on = value.includes(p.id) || p.id === cfg.partner;
        const locked = p.id === cfg.partner;
        return (
          <button key={p.id} type="button" onClick={() => toggle(p.id)} disabled={locked} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 800,
              cursor: locked ? "default" : "pointer", whiteSpace: "nowrap", color: on ? "#0B0613" : C.muted,
              background: on ? C.gold : C.surface2, border: `1px solid ${on ? "transparent" : C.line}`, opacity: locked ? 0.9 : 1 }}>
            {on ? <Check size={13} /> : <Plus size={13} />} {p.name}
          </button>
        );
      })}
    </div>
  );
}

function PortalSubtaskList({ task, he, rtl }: { task: PmTask; he: boolean; rtl: boolean }) {
  const { domain } = usePortal();
  const qc = useQueryClient();
  const subs = task.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const [adding, setAdding] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const inval = () => qc.invalidateQueries({ queryKey: ["portalTasks", domain] });
  const add = useMutation({ mutationFn: (title: string) => api.portalAddSubtask(domain, task.id, title), onSuccess: () => { setAdding(""); inval(); } });
  const upd = useMutation({ mutationFn: (v: { id: number; body: { title?: string; done?: boolean } }) => api.portalUpdateSubtask(domain, task.id, v.id, v.body), onSuccess: () => { setEditId(null); inval(); } });
  const del = useMutation({ mutationFn: (id: number) => api.portalDeleteSubtask(domain, task.id, id), onSuccess: inval });
  const submitAdd = () => { const t = adding.trim(); if (t) add.mutate(t); };
  const submitEdit = () => { const t = editText.trim(); if (t && editId != null) upd.mutate({ id: editId, body: { title: t } }); else setEditId(null); };
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <ListChecks size={13} color={C.gold} /> {he ? "תת-נושאים / תת-משימות" : "Sub-topics / sub-tasks"}
        {subs.length > 0 && <span style={{ color: done === subs.length ? C.gain : C.faint }}>· {done}/{subs.length}</span>}
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subs.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "7px 10px" }}>
            <button type="button" onClick={() => upd.mutate({ id: s.id, body: { done: !s.done } })} disabled={upd.isPending}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "inline-flex", flexShrink: 0, color: s.done ? C.gain : C.faint }}>
              {s.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </button>
            {editId === s.id ? (
              <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitEdit(); if (e.key === "Escape") setEditId(null); }} onBlur={submitEdit}
                dir={rtl ? "rtl" : "ltr"} style={{ ...input, flex: 1, minWidth: 0, padding: "5px 8px" }} />
            ) : (
              <span onClick={() => { setEditId(s.id); setEditText(s.title); }}
                style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4, wordBreak: "break-word", cursor: "text",
                  color: s.done ? C.faint : C.text, textDecoration: s.done ? "line-through" : "none" }}>{s.title}</span>
            )}
            {editId !== s.id && (
              <button type="button" onClick={() => del.mutate(s.id)} disabled={del.isPending}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: C.faint, display: "inline-flex", flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: subs.length ? 8 : 0 }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
          placeholder={he ? "הוסף תת-נושא…" : "Add a sub-topic…"} dir={rtl ? "rtl" : "ltr"} style={{ ...input, flex: 1, minWidth: 0, padding: "8px 10px" }} />
        <button type="button" onClick={submitAdd} disabled={add.isPending || !adding.trim()} style={{ ...btn(), flexShrink: 0, opacity: adding.trim() ? 1 : 0.5 }}>
          {add.isPending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {he ? "הוסף" : "Add"}
        </button>
      </div>
    </div>
  );
}

function PortalTaskCard({ task, he, rtl }: { task: PmTask; he: boolean; rtl: boolean }) {
  const { domain } = usePortal();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [titleHe, setTitleHe] = useState(task.titleHe || "");
  const [titleEn, setTitleEn] = useState(task.titleEn || "");
  const [detail, setDetail] = useState(task.detail || "");
  const [status, setStatus] = useState<PmStatus>(task.status);
  const [progress, setProgress] = useState(task.progress);
  const [partners, setPartners] = useState<string[]>(taskPartners(task));
  const [priority, setPriority] = useState(task.priority || "none");
  const inval = () => qc.invalidateQueries({ queryKey: ["portalTasks", domain] });
  const save = useMutation({
    mutationFn: () => api.portalUpdateTask(domain, task.id, { titleHe, titleEn, detail, status, progress, partners, priority }),
    onSuccess: () => { inval(); setOpen(false); },
  });
  const del = useMutation({ mutationFn: () => api.portalDeleteTask(domain, task.id), onSuccess: inval });
  const st = PM_STATUS[task.status];
  const subs = task.subtasks || [];
  const subDone = subs.filter((s) => s.done).length;
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const sel: React.CSSProperties = { ...input, cursor: "pointer", padding: "9px 11px" };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: SHADOW, overflow: "hidden" }}>
      {/* collapsed summary row */}
      <button onClick={() => setOpen((o) => !o)} className="tap44"
        style={{ width: "100%", textAlign: "start", background: "transparent", border: "none", cursor: "pointer", padding: "14px 16px", fontFamily: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1 }}>
            <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 800, color: st.c(),
              background: `${st.c()}1a`, border: `1px solid ${st.c()}55`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>{he ? st.he : st.en}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{(he ? task.titleHe : task.titleEn) || task.titleHe || task.titleEn}</span>
            <PriorityChip priority={task.priority} he={he} />
            {subs.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.faint }}>· {subDone}/{subs.length}</span>}
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>{task.progress}%</span>
            <ChevronDown size={16} color={C.muted} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          </span>
        </div>
        <div style={{ height: 6, background: C.surface2, borderRadius: 999, overflow: "hidden", marginTop: 10 }}>
          <div style={{ width: `${task.progress}%`, height: "100%", background: st.c(), borderRadius: 999 }} />
        </div>
      </button>

      {/* expanded editor */}
      {open && (
        <div style={{ padding: "4px 16px 16px", borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
            <div>
              <label style={lbl}>{he ? "כותרת (עברית)" : "Title (Hebrew)"}</label>
              <input dir="rtl" value={titleHe} onChange={(e) => setTitleHe(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={lbl}>{he ? "כותרת (אנגלית)" : "Title (English)"}</label>
              <input dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
            </div>
          </div>
          <div>
            <label style={lbl}>{he ? "פירוט" : "Detail"}</label>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} dir={rtl ? "rtl" : "ltr"}
              style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 70, lineHeight: 1.55, resize: "vertical" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
            <div>
              <label style={lbl}>{he ? "סטטוס" : "Status"}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as PmStatus)} style={sel}>
                {PM_STATUS_KEYS.map((k) => <option key={k} value={k}>{he ? PM_STATUS[k].he : PM_STATUS[k].en}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>{he ? `התקדמות · ${progress}%` : `Progress · ${progress}%`}</label>
              <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} style={{ width: "100%", accentColor: C.gold }} />
            </div>
            <div>
              <label style={lbl}>{he ? "עדיפות" : "Priority"}</label>
              <PrioritySelect value={priority} onChange={setPriority} he={he} style={sel} />
            </div>
          </div>
          <div>
            <label style={lbl}>{he ? "משתמשים משויכים" : "Assigned people"}</label>
            <AssignChips value={partners} onChange={setPartners} he={he} />
          </div>
          <PortalSubtaskList task={task} he={he} rtl={rtl} />
          <TaskComments taskId={task.id} he={he} rtl={rtl} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => save.mutate()} disabled={save.isPending} style={{ ...btn(true) }}>
              {save.isPending ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {he ? "שמור" : "Save"}
            </button>
            <button onClick={() => { if (confirm(he ? "למחוק את המשימה?" : "Delete this task?")) del.mutate(); }} disabled={del.isPending}
              style={{ ...btn(false), color: C.loss, marginInlineStart: "auto" }}>
              <Trash2 size={15} /> {he ? "מחק" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PortalTaskCreate({ he, rtl, onClose }: { he: boolean; rtl: boolean; onClose: () => void }) {
  const { domain, cfg } = usePortal();
  const qc = useQueryClient();
  const [titleHe, setTitleHe] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [detail, setDetail] = useState("");
  const [status, setStatus] = useState<PmStatus>("todo");
  const [partners, setPartners] = useState<string[]>([cfg.partner]);
  const [priority, setPriority] = useState("none");
  const create = useMutation({
    mutationFn: () => api.portalCreateTask(domain, { titleHe, titleEn, detail, status, progress: 0, partners, priority }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portalTasks", domain] }); onClose(); },
  });
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.gold}`, borderRadius: 14, padding: 16, boxShadow: SHADOW, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Plus size={16} color={C.gold} /> {T(cfg.newTaskTitle, he)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <label style={lbl}>{he ? "כותרת (עברית)" : "Title (Hebrew)"}</label>
          <input dir="rtl" autoFocus value={titleHe} onChange={(e) => setTitleHe(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={lbl}>{he ? "כותרת (אנגלית)" : "Title (English)"}</label>
          <input dir="ltr" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
      <div>
        <label style={lbl}>{he ? "פירוט" : "Detail"}</label>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} dir={rtl ? "rtl" : "ltr"}
          style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 60, lineHeight: 1.55, resize: "vertical" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <div>
          <label style={lbl}>{he ? "סטטוס" : "Status"}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as PmStatus)} style={{ ...input, cursor: "pointer", padding: "9px 11px" }}>
            {PM_STATUS_KEYS.map((k) => <option key={k} value={k}>{he ? PM_STATUS[k].he : PM_STATUS[k].en}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>{he ? "עדיפות" : "Priority"}</label>
          <PrioritySelect value={priority} onChange={setPriority} he={he} style={{ ...input, cursor: "pointer", padding: "9px 11px" }} />
        </div>
        <div>
          <label style={lbl}>{he ? "משתמשים משויכים" : "Assigned people"}</label>
          <AssignChips value={partners} onChange={setPartners} he={he} />
        </div>
      </div>
      {create.isError && <div style={{ color: C.loss, fontSize: 12.5 }}>{String((create.error as any)?.message || create.error)}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => create.mutate()} disabled={create.isPending || !(titleHe || titleEn)} style={{ ...btn(true) }}>
          {create.isPending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} {he ? "צור משימה" : "Create task"}
        </button>
        <button onClick={onClose} style={{ ...btn(false) }}><X size={15} /> {he ? "ביטול" : "Cancel"}</button>
      </div>
    </div>
  );
}

// OWNER-ONLY one-click import: copy Oren's control-panel / audit-board items (audit_items in
// {it,product} he last edited) into his IT pm_tasks. COPY ONLY — sources are kept and marked
// "approved"; idempotent (re-runs skip already-imported) and fully reversible. Shown only in the
// IT portal, only to a product owner. Function declaration → hoisted (TDZ-safe).
function ImportAuditTasksButton({ he }: { he: boolean }) {
  const { domain } = usePortal();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (!isOwner() || domain !== "it") return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const pre = await api.auditMoveToPm(true);            // dry-run → candidate count for the confirm
      const n = pre.candidates || 0;
      if (n === 0) {
        window.alert(he ? "אין פריטי ביקורת של אורן (it/product) לייבוא." : "No Oren audit items (it/product) to import.");
        return;
      }
      const ok = window.confirm(he
        ? `להעתיק ${n} פריטי ביקורת (it/product שאורן ערך לאחרונה) למשימות ה-IT שלו?\n\nהעתקה בלבד — המקור נשמר ומסומן "אושר". הפעולה הפיכה, בלי מחיקות.`
        : `Copy ${n} candidate audit item(s) (it/product last edited by Oren) into his IT tasks?\n\nCopy only — sources are kept and marked "approved". Reversible, no deletes.`);
      if (!ok) return;
      const res = await api.auditMoveToPm(false);
      qc.invalidateQueries({ queryKey: ["portalTasks", domain] });
      const extra = (res.skipped || 0) ? (he ? ` · דילג על ${res.skipped}` : ` · skipped ${res.skipped}`) : "";
      window.alert(he ? `הועתקו ${res.copied ?? 0} משימות${extra}.` : `Copied ${res.copied ?? 0} task(s)${extra}.`);
    } catch (e: any) {
      window.alert(he ? `הייבוא נכשל: ${e?.message || e}` : `Import failed: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={run} disabled={busy} className="tap44"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999,
        border: `1px solid ${C.line}`, background: C.surface2, color: C.text, fontFamily: "inherit",
        fontSize: 12, fontWeight: 800, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
      {busy ? <Loader2 size={13} className="spin" /> : <Download size={13} color={C.gold} />}
      {he ? "ייבא משימות ביקורת של אורן → IT" : "Import Oren's audit tasks → IT"}
    </button>
  );
}

// ── LEGAL HOME (Raz's landing) ───────────────────────────────────────────────
// Everything she needs on arrival: what awaits her review, the open dilemmas the
// owners raised, where the work stands, and the latest updates. Chat is a button,
// not the centrepiece — she opens it when she wants to talk, not before.
function LegalHome({ he, rtl, go }: { he: boolean; rtl: boolean; go: (t: TabKey) => void }) {
  const q = useQuery({ queryKey: ["portalTasks", "legal"], queryFn: () => api.portalTasks("legal") });
  const tasks = (q.data?.tasks || []) as PmTask[];
  const prog = q.data?.progress;
  const open = [...tasks].filter((t) => t.status !== "done")
    .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority) || b.progress - a.progress);
  const recent = [...tasks].filter((t) => t.updatedAt)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);
  const overall = Math.round(Number(prog?.overall ?? 0));

  const cardBox: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`,
    borderRadius: 16, padding: 18, boxShadow: SHADOW };
  const H = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800,
      color: C.muted, marginBottom: 10 }}>{icon} {text}</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, direction: rtl ? "rtl" : "ltr" }}>

      {/* WELCOME + the chat as a button */}
      <div style={{ ...cardBox, background: `${C.gold}0d`, border: `1px solid ${C.gold}44` }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: C.text, marginBottom: 4 }}>
          {he ? "שלום רז 👋" : "Hello Raz 👋"}
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 13 }}>
          {he ? "כאן מרוכז כל מה שצריך את חוות הדעת שלך — מה שבנינו לבדיקתך, הדילמות הפתוחות, ואיפה הדברים עומדים."
              : "Everything that needs your opinion in one place — what we built for your review, the open dilemmas, and where things stand."}
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <button onClick={() => go("chat")} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.gold, color: "#16110a",
              border: "none", borderRadius: 11, padding: "10px 16px", fontSize: 13.5, fontWeight: 900,
              cursor: "pointer", fontFamily: "inherit" }}>
            <MessageSquare size={15} /> {he ? "פתחי צ'אט עם הבעלים" : "Open chat with the owners"}
          </button>
          <button onClick={() => go("sections")} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface, color: C.gold,
              border: `1px solid ${C.gold}66`, borderRadius: 11, padding: "10px 16px", fontSize: 13.5, fontWeight: 900,
              cursor: "pointer", fontFamily: "inherit" }}>
            <FileEdit size={15} /> {he ? "רשמי הערה / חוות דעת" : "Write a note / opinion"}
          </button>
        </div>
      </div>

      {/* WHAT AWAITS HER REVIEW — the centrepiece */}
      <div style={cardBox}>
        <H icon={<Sparkles size={14} color={C.gold} />} text={he ? "לבדיקתך עכשיו" : "Awaiting your review"} />
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, marginBottom: 12 }}>
          {he ? "בנינו מסך שבו המשתמש לומד ובוחר בעצמו כל מרכיב באסטרטגיה ומאשר כל צעד — המערכת מנגישה ומלמדת, לא מחליטה. נשמח שתעברי עליו ותאמרי אם הוא עומד במבחן."
              : "We built a screen where the user learns and chooses each part of the strategy and approves each step — the system teaches and enables, it doesn't decide. Please review it and tell us whether it passes."}
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <a href="/guided-builder" style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none",
            background: C.gold, color: "#16110a", borderRadius: 11, padding: "10px 15px", fontSize: 13.5, fontWeight: 900 }}>
            <GraduationCap size={15} /> {he ? "בונה האסטרטגיה" : "The strategy builder"}
          </a>
          <a href="/reg-2k0w2vm73pt3q0yf/" target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none",
            background: C.surface, color: C.gold, border: `1px solid ${C.gold}66`, borderRadius: 11, padding: "10px 15px", fontSize: 13.5, fontWeight: 900 }}>
            <FileText size={15} /> {he ? "דף רגולטורי + פסיקה" : "Regulatory page + case law"}
          </a>
          <a href="/share-bpvf2c6anby5wm0m/" target="_blank" rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none",
            background: C.surface, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 11, padding: "10px 15px", fontSize: 13.5, fontWeight: 900 }}>
            <FileText size={15} /> {he ? "סיכום השינויים" : "Summary of changes"}
          </a>
        </div>
      </div>

      {/* OPEN DILEMMAS — what the owners are asking her to decide */}
      <div style={cardBox}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <H icon={<Scale size={14} color={C.gold} />} text={he ? "דילמות פתוחות להכרעתך" : "Open dilemmas for your call"} />
          <button onClick={() => go("tasks")} className="tap44"
            style={{ background: "none", border: "none", color: C.gold, fontSize: 12.5, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit", padding: "4px 2px" }}>
            {he ? "לכל הדילמות ←" : "All dilemmas →"}
          </button>
        </div>
        {q.isLoading ? (
          <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
        ) : open.length === 0 ? (
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            {he ? "אין כרגע דילמות פתוחות. כשנעלה שאלה שדורשת הכרעה משפטית — היא תופיע כאן."
                : "No open dilemmas right now. When we raise a question that needs a legal call, it will appear here."}
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
            {open.slice(0, 6).map((t) => (
              <button key={t.id} onClick={() => go("tasks")} className="tap44"
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 13px",
                  borderBottom: `1px solid ${C.line}`, background: "none", border: "none", cursor: "pointer",
                  fontFamily: "inherit", textAlign: rtl ? "right" : "left" }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                  background: t.status === "blocked" ? C.loss : t.status === "in_progress" ? C.gold : C.muted }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: C.text }}>
                    {he ? t.titleHe : t.titleEn}
                  </span>
                  {t.notes && (
                    <span style={{ display: "block", fontSize: 12, color: C.muted, marginTop: 2,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.notes}</span>
                  )}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, flexShrink: 0 }}>
                  {t.status === "blocked" ? (he ? "חסום" : "Blocked")
                    : t.status === "in_progress" ? (he ? "בעבודה" : "In progress")
                    : (he ? "ממתין" : "Waiting")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PROGRESS */}
      <div style={cardBox}>
        <H icon={<Milestone size={14} color={C.gold} />} text={he ? "איפה אנחנו עומדים" : "Where things stand"} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 26, fontWeight: 900, color: C.text }}>{overall}%</span>
          <span style={{ fontSize: 12.5, color: C.muted }}>
            {he ? `${tasks.filter((t) => t.status === "done").length} מתוך ${tasks.length} סגורים`
                : `${tasks.filter((t) => t.status === "done").length} of ${tasks.length} closed`}
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: C.line, overflow: "hidden" }}>
          <div style={{ width: `${Math.max(0, Math.min(100, overall))}%`, height: "100%", background: C.gold }} />
        </div>
      </div>

      {/* LATEST UPDATES */}
      <div style={cardBox}>
        <H icon={<ListChecks size={14} color={C.gold} />} text={he ? "עדכונים אחרונים" : "Latest updates"} />
        {recent.length === 0 ? (
          <div style={{ fontSize: 13, color: C.muted }}>
            {he ? "אין עדיין עדכונים." : "No updates yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {recent.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: C.gold, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{he ? t.titleHe : t.titleEn}</div>
                  <div style={{ fontSize: 11.5, color: C.muted }}>
                    {String(t.updatedAt || "").slice(0, 10)}
                    {t.updatedBy ? ` · ${t.updatedBy}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksTab({ he }: { he: boolean }) {
  const { domain, cfg } = usePortal();
  const { rtl } = useI18n();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["portalTasks", domain], queryFn: () => api.portalTasks(domain) });
  const tasks = (q.data?.tasks || []) as PmTask[];
  const goal = q.data?.goal || null;
  const prog = q.data?.progress;

  if (q.isLoading) {
    return <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 24, color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>;
  }

  const weight: Record<PmStatus, number> = { blocked: 0, in_progress: 1, todo: 2, done: 3 };
  // Priority first (red→orange→green→none raises a chosen priority to the top), then the
  // existing status/progress order — mirrors the board's server-side priority-first sort.
  const ordered = [...tasks].sort((a, b) =>
    (priorityWeight(a.priority) - priorityWeight(b.priority)) ||
    (weight[a.status] - weight[b.status]) || (b.progress - a.progress));
  const counts = prog?.counts || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* headline: goal + overall progress + add */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 4 }}>
              <ListChecks size={14} color={C.gold} /> {T(cfg.tasksHeader, he)}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{goal ? (he ? goal.goalHe : goal.goalEn) || T(cfg.goalFallback, he) : T(cfg.goalFallback, he)}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: C.gold, lineHeight: 1 }}>{prog?.overall ?? 0}%</div>
            <div style={{ fontSize: 10.5, color: C.faint, marginTop: 2 }}>{he ? "התקדמות" : "Progress"}</div>
          </div>
        </div>
        <div style={{ height: 8, background: C.surface2, borderRadius: 999, overflow: "hidden", marginTop: 12 }}>
          <div style={{ width: `${prog?.overall ?? 0}%`, height: "100%", background: C.gold, borderRadius: 999 }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          {PM_STATUS_KEYS.map((s) => (
            <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: C.text,
              background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 10px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: PM_STATUS[s].c() }} />
              {he ? PM_STATUS[s].he : PM_STATUS[s].en} · {counts[s] || 0}
            </span>
          ))}
          {!adding && (
            <button onClick={() => setAdding(true)} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, marginInlineStart: "auto", padding: "6px 12px", borderRadius: 999,
                border: `1px solid ${C.gold}`, background: `${C.gold}1a`, color: C.gold, fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
              <Plus size={14} /> {he ? "משימה חדשה" : "New task"}
            </button>
          )}
          {/* OWNER-ONLY (IT portal): one-click import of Oren's audit-board tasks into IT tasks. */}
          <ImportAuditTasksButton he={he} />
        </div>
      </div>

      {adding && <PortalTaskCreate he={he} rtl={rtl} onClose={() => setAdding(false)} />}

      {ordered.length === 0 && !adding ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 16, padding: 40, textAlign: "center", color: C.muted, fontSize: 14 }}>
          {T(cfg.tasksEmpty, he)}
        </div>
      ) : ordered.map((t) => <PortalTaskCard key={t.id} task={t} he={he} rtl={rtl} />)}
    </div>
  );
}

// ── Sections & notes tab ─────────────────────────────────────────────────────
function SectionsTab({ he }: { he: boolean }) {
  const { domain, cfg } = usePortal();
  const qc = useQueryClient();
  const [sel, setSel] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const q = useQuery({ queryKey: ["portalSections", domain], queryFn: () => api.portalSections(domain) });
  const sections = (q.data?.sections || []) as LegalSection[];

  // keep a valid selection
  const selected = useMemo(() => sections.find((s) => s.id === sel) || null, [sections, sel]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["portalSections", domain] });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      {/* ── section list ── */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 10, boxShadow: SHADOW }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 8px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, color: C.text }}>
            <cfg.Icon size={15} color={C.gold} /> {he ? "סקשנים" : "Sections"}
          </span>
          <button onClick={() => { setCreating(true); setSel(null); }} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, border: `1px solid ${C.gold}`,
              background: `${C.gold}1a`, color: C.gold, fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            <Plus size={13} /> {he ? "חדש" : "New"}
          </button>
        </div>
        {q.isLoading ? (
          <div style={{ padding: 12, color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
        ) : sections.length === 0 ? (
          <div style={{ padding: 14, color: C.muted, fontSize: 12.5, lineHeight: 1.5 }}>
            {T(cfg.sectionsEmpty, he)}
          </div>
        ) : sections.map((s) => {
          const on = !creating && sel === s.id;
          return (
            <button key={s.id} onClick={() => { setSel(s.id); setCreating(false); }} className="tap44"
              style={{ width: "100%", textAlign: "start", display: "flex", flexDirection: "column", gap: 3,
                background: on ? `${C.gold}1a` : "transparent", border: `1px solid ${on ? C.gold : "transparent"}`,
                borderRadius: 10, padding: "9px 10px", cursor: "pointer", fontFamily: "inherit", marginBottom: 2 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                {s.status === "resolved" && <CheckCircle2 size={14} color={C.gain} />}
              </span>
              <span style={{ fontSize: 11, color: C.faint }}>
                {s.createdName}{s.noteCount ? ` · ${s.noteCount} ${he ? "הערות" : "notes"}` : ""}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── detail / composer ── */}
      {creating ? (
        <NewSection he={he} onDone={(id) => { setCreating(false); setSel(id); invalidate(); }} onCancel={() => setCreating(false)} />
      ) : selected ? (
        <SectionDetail he={he} section={selected} onChanged={invalidate} onDeleted={() => { setSel(null); invalidate(); }} />
      ) : (
        <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 16, padding: 40, textAlign: "center", color: C.muted, fontSize: 14 }}>
          {T(cfg.sectionSelectHint, he)}
        </div>
      )}
    </div>
  );
}

function NewSection({ he, onDone, onCancel }: { he: boolean; onDone: (id: number) => void; onCancel: () => void }) {
  const { domain, cfg } = usePortal();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () => api.portalCreateSection(domain, { title: title.trim(), body: body.trim() }),
    onSuccess: (r) => onDone(r.section?.id),
  });
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 14, display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Plus size={16} color={C.gold} /> {he ? "סקשן חדש" : "New section"}
      </div>
      <label style={lbl}>{he ? "כותרת" : "Title"}</label>
      <input style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 12 }} value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder={T(cfg.newSectionTitlePh, he)} autoFocus />
      <label style={lbl}>{he ? "תיאור פותח (אופציונלי)" : "Opening description (optional)"}</label>
      <textarea style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 120, lineHeight: 1.6, resize: "vertical" }}
        value={body} onChange={(e) => setBody(e.target.value)} placeholder={T(cfg.newSectionBodyPh, he)} />
      {m.isError && <div style={{ marginTop: 10, color: C.loss, fontSize: 12.5 }}>{String((m.error as any)?.message || m.error)}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={() => m.mutate()} disabled={!title.trim() || m.isPending} style={{ ...btn(true) }}>
          {m.isPending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} {he ? "פתח סקשן" : "Open section"}
        </button>
        <button onClick={onCancel} style={{ ...btn(false) }}>{he ? "ביטול" : "Cancel"}</button>
      </div>
    </div>
  );
}

function SectionDetail({ he, section, onChanged, onDeleted }: { he: boolean; section: LegalSection; onChanged: () => void; onDeleted: () => void }) {
  const { domain } = usePortal();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const q = useQuery({ queryKey: ["portalSection", domain, section.id], queryFn: () => api.portalSection(domain, section.id) });
  const notes = (q.data?.notes || []) as LegalNote[];
  const detail = q.data?.section || section;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["portalSection", domain, section.id] }); onChanged(); };

  const addM = useMutation({
    mutationFn: () => api.portalAddNote(domain, section.id, reply.trim()),
    onSuccess: () => { setReply(""); refresh(); },
  });
  const statusM = useMutation({
    mutationFn: (status: "open" | "resolved") => api.portalUpdateSection(domain, section.id, { status }),
    onSuccess: refresh,
  });
  const delM = useMutation({ mutationFn: () => api.portalDeleteSection(domain, section.id), onSuccess: onDeleted });
  const delNoteM = useMutation({ mutationFn: (id: number) => api.portalDeleteNote(domain, id), onSuccess: refresh });

  const fmt = (s: string | null) => (s ? String(s).slice(0, 16).replace("T", " ") : "");
  const resolved = detail.status === "resolved";

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{detail.title}</span>
            {resolved && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 800, color: C.gain, background: `${C.gain}1a`, border: `1px solid ${C.gain}55`, borderRadius: 999, padding: "2px 9px" }}>
                <CheckCircle2 size={12} /> {he ? "טופל" : "Resolved"}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>
            {he ? "נפתח ע\"י " : "Opened by "}{detail.createdName} · {fmt(detail.createdAt)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isOwner() && (
            <button onClick={() => statusM.mutate(resolved ? "open" : "resolved")} disabled={statusM.isPending} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 999, border: `1px solid ${C.line}`,
                background: C.surface2, color: C.text, fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              {resolved ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />} {resolved ? (he ? "פתח מחדש" : "Reopen") : (he ? "סמן כטופל" : "Resolve")}
            </button>
          )}
          <button onClick={() => { if (confirm(he ? "למחוק את הסקשן והשרשור?" : "Delete this section and its thread?")) delM.mutate(); }}
            disabled={delM.isPending} className="tap44" title={he ? "מחק" : "Delete"}
            style={{ display: "inline-flex", alignItems: "center", padding: "6px 9px", borderRadius: 999, border: `1px solid ${C.line}`,
              background: C.surface2, color: C.loss, cursor: "pointer" }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* opening body */}
      {detail.body && (
        <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, color: C.text, fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 16 }}>
          {detail.body}
        </div>
      )}

      {/* thread */}
      <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, margin: "4px 0 10px", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <ChevronRight size={14} color={C.gold} /> {he ? "שרשור הערות" : "Note thread"}
      </div>
      {q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
      ) : notes.length === 0 ? (
        <div style={{ color: C.muted, fontSize: 12.5, padding: "4px 0 12px" }}>{he ? "אין עדיין הערות בשרשור." : "No notes in this thread yet."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gold }}>{n.authorName}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10.5, color: C.faint }}>{fmt(n.createdAt)}</span>
                  <button onClick={() => delNoteM.mutate(n.id)} title={he ? "מחק" : "Delete"}
                    style={{ background: "transparent", border: "none", color: C.faint, cursor: "pointer", padding: 0, display: "inline-flex" }}>
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
              <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{n.body}</div>
            </div>
          ))}
        </div>
      )}

      {/* reply composer */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 6 }}>
        <textarea style={{ ...input, flex: 1, minHeight: 46, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box" }}
          value={reply} onChange={(e) => setReply(e.target.value)}
          placeholder={he ? "כתבו הערה / תגובה…" : "Write a note / reply…"} />
        <button onClick={() => addM.mutate()} disabled={!reply.trim() || addM.isPending} style={{ ...btn(true) }}>
          {addM.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {he ? "שלח" : "Send"}
        </button>
      </div>
    </div>
  );
}
