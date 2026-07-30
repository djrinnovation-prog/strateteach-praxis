import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, ListChecks, LifeBuoy, Activity, UserRound, Scale, Wrench, Briefcase, Inbox } from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { isLegalEditor, isItEditor, isBizEditor, isAdmin } from "../app/api";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenShortcuts from "../components/ScreenShortcuts";
import ScreenBottom from "../components/ScreenBottom";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import { HubPanel } from "../components/HubScreen";
import AuditPortal from "../components/AuditPortal";
import { useIsMobile } from "../lib/useIsMobile";

// ── STAFF AUDIT LANDING ────────────────────────────────────────────────────────
// The role-aware landing for STAFF collaborators (Raz · Oren · Raful — legal / IT / biz
// editors — and any residual role=='admin'), gated in Shell to
//   (isLegalEditor() || isItEditor() || isBizEditor() || isAdmin()) && !isOwner().
// Owners keep the owners portal; regular users keep Home. This is a LOCKED launcher in the
// finalized model: carved FramedTitle + editable shortcuts + the fixed "עוד במערכת" chip +
// two central glass buttons — "ביקורת ויישום" (Self-Audit Manager) and "לוח משימות" (Tasks
// Manager) — both drawn from the existing AuditPortal. Each opens a real ?sec= CHILD screen
// (browser Back returns to the launcher). Audit is domain-scoped to the staffer's domain.
export default function StaffAudit() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_staffaudit_more_view_v1", "cards");

  // Domain-scope the audit board/tasks to the staffer's own domain(s). Legal → legal;
  // IT → it + product; Biz → biz; a residual admin (no editor grant) → all domains.
  const dom: string[] = [];
  if (isLegalEditor()) dom.push("legal");
  if (isItEditor()) dom.push("it", "product");
  if (isBizEditor()) dom.push("biz");
  const domains = dom.length ? Array.from(new Set(dom)) : undefined;

  // The staffer's OWN collaborator portal (for the top shortcut).
  const portal = isLegalEditor()
    ? { path: "/legal-portal", label: he ? "פורטל משפטי" : "Legal Portal", Icon: Scale }
    : isItEditor()
      ? { path: "/it-portal", label: he ? "פורטל IT" : "IT Portal", Icon: Wrench }
      : isBizEditor()
        ? { path: "/biz-portal", label: he ? "פורטל פיתוח עסקי" : "Business Dev", Icon: Briefcase }
        : { path: "/requests", label: he ? "פניות" : "Requests", Icon: Inbox };

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", fontFamily: UI, color: C.text,
      display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {sec === "" && (
        <>
          <FramedTitle text={he ? "ביקורת ויישום" : "Audit"}
            subtitle={he ? "ביקורת עצמית · תור משימות — הרצה ואישור עד לסגירה" : "Self-audit · task queue — run & approve to completion"} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="staffaudit"
            defaultKeys={["portal", "requests", "activity", "account"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "portal", label: portal.label, Icon: portal.Icon, onClick: () => nav(portal.path) },
              { key: "requests", label: he ? "פניות" : "Requests", Icon: Inbox, onClick: () => nav("/requests") },
              { key: "help", label: he ? "עזרה" : "Help", Icon: LifeBuoy, onClick: () => nav("/requests") },
              { key: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
              { key: "account", label: he ? "החשבון שלי" : "Account", Icon: UserRound, onClick: () => nav("/me") },
            ]}
          />

          {/* TWO central glass buttons — now EDITABLE via SquareRow (choose which appear + order +
              APPROVE + reset). The screen's own 2 are shown by default; the shared app-destinations
              pool is addable from the ✎ editor. Each NAVIGATES to its own child screen. */}
          <SquareRow screenKey="staffaudit-central" mobile={mobile} defaultShown={["audit", "tasks"]}
            squares={[
              { id: "audit", variant: "primary", Icon: ClipboardCheck, label: he ? "ביקורת ויישום" : "Self-Audit", sub: he ? "לוח הביקורת" : "the audit board", onClick: () => setSec("audit") },
              { id: "tasks", variant: "secondary", Icon: ListChecks, label: he ? "לוח משימות" : "Tasks", sub: he ? "תור פתוח" : "open queue", onClick: () => setSec("tasks") },
              ...centralExtras(he, nav, { exclude: [] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the staff areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={he ? "עוד במערכת" : "More"} subtitle={he ? "כל אזורי הצוות" : "All staff areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={he} />
          </div>
          <TileGrid screenKey="staffaudit-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "audit", label: he ? "ביקורת ויישום" : "Self-Audit", Icon: ClipboardCheck, onClick: () => setSec("audit") },
            { id: "tasks", label: he ? "לוח משימות" : "Tasks", Icon: ListChecks, onClick: () => setSec("tasks") },
            { id: "portal", label: portal.label, Icon: portal.Icon, onClick: () => nav(portal.path) },
            { id: "requests", label: he ? "פניות" : "Requests", Icon: Inbox, onClick: () => nav("/requests") },
            { id: "help", label: he ? "עזרה" : "Help", Icon: LifeBuoy, onClick: () => nav("/requests") },
            { id: "activity", label: he ? "יומן פעילות" : "Activity", Icon: Activity, onClick: () => nav("/activity") },
            { id: "account", label: he ? "החשבון שלי" : "Account", Icon: UserRound, onClick: () => nav("/me") },
          ]} />
        </div>
      )}

      {/* ── "ביקורת עצמית" CHILD — the audit board (Self-Audit Manager), domain-scoped. ── */}
      {sec === "audit" && (
        <HubPanel alwaysOpen ns="staffaudit" id="audit" title={he ? "מנהל ביקורת עצמית" : "Self-Audit Manager"} icon={<ClipboardCheck size={15} />} onClose={() => setSec("")}>
          <AuditPortal domains={domains} initialView="board" />
        </HubPanel>
      )}

      {/* ── "לוח משימות" CHILD — the open-tasks queue (Tasks Manager), domain-scoped. ── */}
      {sec === "tasks" && (
        <HubPanel alwaysOpen ns="staffaudit" id="tasks" title={he ? "מנהל משימות" : "Tasks Manager"} icon={<ListChecks size={15} />} onClose={() => setSec("")}>
          <AuditPortal domains={domains} initialView="tasks" />
        </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}
