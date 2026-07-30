// ── Owners/Portal SHARED tab components ─────────────────────────────────────────
// Extracted from Owners.tsx so /owners AND both collaborator portals (Portal.tsx)
// render the SAME self-contained tabs (Daily/Overview/Team/Board/Vote/Progress + the
// shared primitives). Owners.tsx keeps only its shell; Portal.tsx imports what it needs.
// The FinancePanel import is intentionally NOT here — Finance stays owner-only in Owners.tsx.
import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Diamond, Gem, LayoutDashboard, TrendingUp, ShieldCheck, BarChart3, Rocket,
  Crown, Clapperboard, Code2, Scale, Check, Clock, CircleAlert, Users, Milestone,
  ArrowRight, ArrowLeft, CircleDot, Sparkles, ClipboardList, Target, Pencil, Plus,
  Trash2, Loader2, X, Save, Rocket as RocketIcon, FileSearch,
  Radio, Radar, Wallet, FlaskConical, Beaker, Gauge, MessagesSquare, UserCircle,
  GraduationCap, CreditCard, Palette, ToggleRight, KeyRound, Wrench, MessageCircle,
  Building2, Cpu, Briefcase, Vote as VoteIcon, MessageSquare, ChevronDown, Trophy,
  CheckCircle2, Circle, Ban, Sunrise, Copy, ClipboardCheck, ArrowUpRight,
  BookOpen, ChevronLeft, ChevronRight, Send, Mail, Smartphone, Coins, RotateCcw,
} from "lucide-react";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import { ScreenHeader } from "../components/ScreenHeader";
import { Segmented, input, btn } from "../ui";
import { api, isAdmin, isOwner, isLegalEditor } from "../app/api";
import TeamRolesPanel from "../components/TeamRolesPanel";
import ConfirmModal from "../components/ConfirmModal";
import TaskComments from "../components/TaskComments";
import { PriorityChip, PrioritySelect } from "../components/Priority";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import {
  SHOWCASE, TEAM, GOVERNANCE, PHASES, overallPct, partnerById, phaseById,
  TASK_STATUS, IMPL_STATUS, LAUNCH_MILESTONE,
  VOTE_GROUPS, VOTE_CHOICES, ABSTAIN, voteChoice, voteItemByKey, voteOption, PORTAL_GUIDE,
  type Bi, type PhaseStatus, type TaskTone, type VoteItem, type VoteItemType, type Partner,
} from "../lib/owners";
import type {
  PmTask, PmGoal, PmProgress, VotesData, VoteResults, VoteTally, VoteChoiceKey, VoteKind, VoteMine,
  DailyData, DailyAttention, ReportPreview, ReportRecipient, ReportResult, ReportSendResult,
} from "../lib/client";

const ICON: Record<string, any> = {
  Gem, LayoutDashboard, TrendingUp, ShieldCheck, BarChart3, Rocket,
  Crown, Clapperboard, Code2, Scale, Briefcase, Users, Target,
  // Phase 3 voting-catalog icons (screens + decisions + groups)
  Diamond, Milestone, ClipboardList,
  Radio, Radar, Wallet, FlaskConical, Beaker, Gauge, MessagesSquare, UserCircle,
  GraduationCap, CreditCard, Palette, ToggleRight, KeyRound, Wrench, MessageCircle,
  Building2, Cpu,
  // Phase 4 daily + guide icons
  Sunrise, Sparkles, Trophy, Vote: VoteIcon,
};

type Tab = "daily" | "overview" | "team" | "board" | "vote" | "results" | "progress" | "guide" | "finance";


// ── Shared primitives ─────────────────────────────────────────────────────────
function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", placeItems: "center", padding: "60px 0" }}>{children}</div>;
}
function SectionTitle({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
      <span style={{ width: 3, height: 15, borderRadius: 2, background: C.accentGrad, flexShrink: 0 }} />
      {icon}
      <span style={{ fontSize: 15, fontWeight: 900, color: C.text, letterSpacing: "0.01em" }}>{children}</span>
      {right && <span style={{ marginInlineStart: "auto" }}>{right}</span>}
    </div>
  );
}
function glassCard(extra?: React.CSSProperties): React.CSSProperties {
  return {
    background: C.glass, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
    border: `1px solid ${C.glassBd}`, borderRadius: 18, padding: 18, boxShadow: C.glassHi, ...extra,
  };
}
function Bar({ pct, h = 9 }: { pct: number; h?: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ height: h, borderRadius: 999, background: C.surface2, border: `1px solid ${C.line}`, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${w}%`, background: C.accentGrad, borderRadius: 999, transition: "width .4s ease" }} />
    </div>
  );
}
const toneColor = (t: TaskTone): string => (t === "ok" ? C.gain : t === "warn" ? C.loss : t === "info" ? C.blue : C.faint);
function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800,
      color, background: `${color}1a`, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
function BackRow({ he, rtl, onBack }: { he: boolean; rtl: boolean; onBack: () => void }) {
  const Arrow = rtl ? ArrowRight : ArrowLeft;
  return (
    <button onClick={onBack} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 7,
      background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "8px 13px",
      fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: UI, marginBottom: 14 }}>
      <Arrow size={15} color={C.gold} /> {he ? "חזרה לפורטל" : "Back to portal"}
    </button>
  );
}

// Compact, LEFT-ALIGNED portal header — binds the title, the tagline and the tab bar into
// ONE tight block so they read as a single unit on mobile (no centered wordmark floating
// above a left-aligned tab row, no void between). Title is smaller + less letter-spaced than
// the global ScreenHeader wordmark so it sits on one tidy line and doesn't dominate. Rhythm:
// title→tagline 6px, tagline→children (tabs) 10px. RTL-correct (inherits the container dir).
function PortalHeader({ title, tagline, children }: { title: string; tagline: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: UI }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Diamond size={19} color={C.gold} fill={C.gold} style={{ flexShrink: 0 }} />
        <h1 style={{ margin: 0, fontFamily: UI, fontWeight: 800, fontSize: "clamp(17px, 4.6vw, 22px)",
          letterSpacing: "0.05em", textTransform: "uppercase", color: C.titleInk, lineHeight: 1.15 }}>{title}</h1>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{tagline}</p>
      {children && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

// Portal tab bar — a WRAPPING row of pills (not a fixed-width segmented control), so all
// six tabs stay fully visible + cleanly aligned on mobile (they wrap to a second line
// instead of shifting/clipping the right-hand tabs). Active pill uses the accent gradient.
// No outer margin: the enclosing PortalHeader owns the vertical rhythm so the pills sit
// directly under the tagline (no void).
function PortalTabs<T extends string>({ tabs, value, onChange, he }: {
  tabs: { id: T; he: string; en: string; Icon: any }[]; value: T; onChange: (v: T) => void; he: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999,
              padding: "8px 14px", fontSize: 12.5, fontWeight: 800, fontFamily: UI, cursor: "pointer", whiteSpace: "nowrap",
              color: active ? "#0B0613" : C.muted, background: active ? C.accentGrad : C.surface2,
              border: `1px solid ${active ? "transparent" : C.line}`, boxShadow: active ? C.glassHi : "none",
              transition: "background .2s ease, color .2s ease" }}>
            <t.Icon size={14} /> {he ? t.he : t.en}
          </button>
        );
      })}
    </div>
  );
}

// Multi-partner picker — toggleable chips (a task can be assigned to SEVERAL partners).
// `value` is the list of selected partner ids; clicking a chip toggles membership.
function PartnerChips({ value, onChange, he }: { value: string[]; onChange: (v: string[]) => void; he: boolean }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
      {TEAM.map((p) => {
        const on = value.includes(p.id);
        const PIcon = ICON[p.icon] || Users;
        return (
          <button key={p.id} type="button" onClick={() => toggle(p.id)} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "7px 12px",
              fontSize: 12, fontWeight: 800, fontFamily: UI, cursor: "pointer", whiteSpace: "nowrap",
              color: on ? "#0B0613" : C.muted, background: on ? C.accentGrad : C.surface2,
              border: `1px solid ${on ? "transparent" : C.line}` }}>
            {on ? <Check size={13} /> : <PIcon size={13} />} {p.name}
          </button>
        );
      })}
    </div>
  );
}

// The assigned partners of a task as a normalized list (multi-partner, backward compatible).
const taskPartners = (t: PmTask): string[] =>
  (t.partners && t.partners.length ? t.partners : (t.partner ? [t.partner] : []));

// A compact inline row of a task's assigned partners (shown when a task is shared).
function AssigneeChips({ ids }: { ids: string[] }) {
  if (ids.length < 2) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
      <Users size={12} color={C.faint} />
      {ids.map((id) => (
        <span key={id} style={{ fontSize: 10.5, fontWeight: 800, color: C.gold, background: `${C.gold}1a`,
          border: `1px solid ${C.gold}44`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
          {partnerById(id)?.name || id}
        </span>
      ))}
    </span>
  );
}

// ══ 1) OVERVIEW ══════════════════════════════════════════════════════════════
function Overview({ bi }: { bi: (b: Bi) => string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
      {SHOWCASE.map((s) => {
        const Icon = ICON[s.icon] || Diamond;
        return (
          <div key={s.id} style={glassCard()}>
            <SectionTitle icon={<Icon size={17} color={C.gold} />}>{bi(s.title)}</SectionTitle>
            {s.lead && <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: C.text, fontWeight: 600 }}>{bi(s.lead)}</p>}
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 9 }}>
              {s.points.map((p, i) => (
                <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, lineHeight: 1.55, color: C.muted }}>
                  <Diamond size={11} color={C.gold} fill={C.gold} style={{ flexShrink: 0, marginTop: 4 }} />
                  <span>{bi(p)}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ══ 2) TEAM ══════════════════════════════════════════════════════════════════
function Team({ bi, he, rtl, onOpen }: { bi: (b: Bi) => string; he: boolean; rtl: boolean; onOpen: (id: string) => void }) {
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  // Live goals overlay the seeded emphasis when present.
  const boardQ = useQuery({ queryKey: ["pmBoard"], queryFn: () => api.pmBoard(), staleTime: 20000 });
  const goals = ((boardQ.data as any)?.goals || []) as PmGoal[];
  const goalFor = (id: string) => goals.find((g) => g.partner === id);
  const [teamView, setTeamView] = useViewMode("algo770_ownersteam_view_v1", "cards");
  return (
    <div>
      {/* rows/squares toggle — switches the partner cards between a grid and a rows list. */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <ViewToggle view={teamView} onChange={setTeamView} he={he} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: teamView === "cards" ? "repeat(auto-fill, minmax(min(100%, 168px), 1fr))" : "1fr", gap: 14 }}>
        {TEAM.map((p) => {
          const Icon = ICON[p.icon] || Users;
          const g = goalFor(p.id);
          return (
            <div key={p.id} style={glassCard({ display: "flex", flexDirection: "column", gap: 12 })}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
                  <Icon size={22} color="#0B0613" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.gold }}>{bi(p.role)}</div>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: C.muted }}>
                {g ? (he ? g.goalHe : g.goalEn) || bi(p.emphasis) : bi(p.emphasis)}
              </p>
              <button onClick={() => onOpen(p.id)} className="tap44"
                style={{ marginTop: "auto", display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "9px 13px",
                  fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
                <span>{he ? "המסך האישי שלך" : "Your personal screen"}</span>
                <Arrow size={15} color={C.gold} />
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ ...glassCard(), marginTop: 14, display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ShieldCheck size={16} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: C.muted }}>
          <span style={{ fontWeight: 800, color: C.text }}>{he ? "ממשל: " : "Governance: "}</span>{bi(GOVERNANCE)}
        </p>
      </div>

      <TeamRolesPanel />
    </div>
  );
}

// ══ 3) BOARD — the live project-management task store ═════════════════════════
function Board({ bi, he, rtl, onOpen }: { bi: (b: Bi) => string; he: boolean; rtl: boolean; onOpen: (id: string) => void }) {
  const boardQ = useQuery({ queryKey: ["pmBoard"], queryFn: () => api.pmBoard(), staleTime: 15000 });
  const [adding, setAdding] = useState(false);
  // Shared rows/squares toggle — switches each partner group's task list between rows and a tile grid.
  const [view, setView] = useViewMode("algo770_ownersboard_view_v1", "list");
  if (boardQ.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const tasks = ((boardQ.data as any)?.tasks || []) as PmTask[];
  const partners = ((boardQ.data as any)?.partners || TEAM.map((t) => t.id)) as string[];
  // Only OWNERS manage the whole board (create + edit any task). A collaborator (Raz/Oren)
  // in their portal VIEWS the whole board read-only — they edit only their OWN tasks from
  // their portal's private Tasks tab. So the board is view-only unless the caller is an owner.
  const canManage = isOwner();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: C.muted }}>
          {canManage
            ? (he ? `${tasks.length} משימות · לחצו על משימה לעדכון` : `${tasks.length} tasks · click a task to update`)
            : (he ? `${tasks.length} משימות · תצוגה בלבד (עדכון המשימות שלך בלשונית 'משימות')` : `${tasks.length} tasks · view-only (edit your own in the 'Tasks' tab)`)}
        </span>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginInlineStart: "auto" }}>
          <ViewToggle view={view} onChange={setView} he={he} />
          {canManage && (
            <button onClick={() => setAdding((v) => !v)} style={btn(true)}>
              <Plus size={15} /> {he ? "משימה חדשה" : "New task"}
            </button>
          )}
        </div>
      </div>

      {canManage && adding && <TaskCreate he={he} rtl={rtl} partners={partners} onClose={() => setAdding(false)} />}

      {partners.map((pid) => {
        // A multi-assignee task appears under EACH assigned partner's group.
        const list = tasks.filter((t) => taskPartners(t).includes(pid));
        if (!list.length) return null;
        const partner = partnerById(pid);
        const PIcon = ICON[partner?.icon || "Users"] || Users;
        const avg = Math.round(list.reduce((s, t) => s + (t.progress || 0), 0) / list.length);
        return (
          <div key={pid} style={glassCard()}>
            <SectionTitle icon={<PIcon size={16} color={C.gold} />}
              right={
                <button onClick={() => onOpen(pid)} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 6,
                  background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
                  {he ? "מסך אישי" : "Personal screen"} <ArrowRight size={13} style={{ transform: rtl ? "scaleX(-1)" : "none" }} />
                </button>
              }>
              {partner?.name || pid} · {avg}%
            </SectionTitle>
            <div style={view === "cards"
              ? { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", alignItems: "start" }
              : { display: "flex", flexDirection: "column", gap: 10 }}>
              {list.map((t) => <TaskCard key={t.id} task={t} he={he} rtl={rtl} manager={canManage} self={false} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A single task row with an expandable inline editor.
// Sub-task checklist under a task's editor — add · toggle · rename · delete, with a
// running n/total. Renders straight from task.subtasks; every mutation invalidates the
// board so the count + card chip refresh. Anyone who can edit the task manages its list.
function SubtaskList({ task, canEdit, he, rtl }: { task: PmTask; canEdit: boolean; he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const subs = task.subtasks || [];
  const done = subs.filter((s) => s.done).length;
  const [adding, setAdding] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const inval = () => { ["pmBoard", "pmMine", "pmPartner"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };

  const add = useMutation({ mutationFn: (title: string) => api.pmAddSubtask(task.id, title), onSuccess: () => { setAdding(""); inval(); } });
  const upd = useMutation({ mutationFn: (v: { id: number; body: { title?: string; done?: boolean } }) => api.pmUpdateSubtask(task.id, v.id, v.body), onSuccess: () => { setEditId(null); inval(); } });
  const del = useMutation({ mutationFn: (id: number) => api.pmDeleteSubtask(task.id, id), onSuccess: inval });

  const submitAdd = () => { const t = adding.trim(); if (t) add.mutate(t); };
  const submitEdit = () => { const t = editText.trim(); if (t && editId != null) upd.mutate({ id: editId, body: { title: t } }); else setEditId(null); };

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <ClipboardCheck size={13} color={C.gold} /> {he ? "תת-משימות" : "Sub-tasks"}
        {subs.length > 0 && <span style={{ color: done === subs.length ? C.gain : C.faint, fontVariantNumeric: "tabular-nums" }}>· {done}/{subs.length}</span>}
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {subs.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "7px 10px" }}>
            <button type="button" onClick={() => canEdit && upd.mutate({ id: s.id, body: { done: !s.done } })} disabled={!canEdit || upd.isPending} className="tap44"
              style={{ background: "none", border: "none", cursor: canEdit ? "pointer" : "default", padding: 0, display: "inline-flex", flexShrink: 0, color: s.done ? C.gain : C.faint }}>
              {s.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            </button>
            {editId === s.id ? (
              <input autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitEdit(); if (e.key === "Escape") setEditId(null); }} onBlur={submitEdit}
                dir={rtl ? "rtl" : "ltr"} style={{ ...input, flex: 1, minWidth: 0, fontFamily: UI, padding: "5px 8px" }} />
            ) : (
              <span onClick={() => { if (canEdit) { setEditId(s.id); setEditText(s.title); } }}
                style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4, wordBreak: "break-word", cursor: canEdit ? "text" : "default",
                  color: s.done ? C.faint : C.text, textDecoration: s.done ? "line-through" : "none" }}>{s.title}</span>
            )}
            {canEdit && editId !== s.id && (
              <button type="button" onClick={() => del.mutate(s.id)} disabled={del.isPending} className="tap44"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: C.faint, display: "inline-flex", flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: subs.length ? 8 : 0 }}>
          <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
            placeholder={he ? "הוסף תת-משימה…" : "Add a sub-task…"} dir={rtl ? "rtl" : "ltr"}
            style={{ ...input, flex: 1, minWidth: 0, fontFamily: UI, padding: "8px 10px" }} />
          <button type="button" onClick={submitAdd} disabled={add.isPending || !adding.trim()} style={{ ...btn(), flexShrink: 0, opacity: adding.trim() ? 1 : 0.5 }}>
            {add.isPending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {he ? "הוסף" : "Add"}
          </button>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, he, rtl, manager, self }: { task: PmTask; he: boolean; rtl: boolean; manager: boolean; self: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [titleHe, setTitleHe] = useState(task.titleHe || "");
  const [titleEn, setTitleEn] = useState(task.titleEn || "");
  const [detail, setDetail] = useState(task.detail || "");
  const [status, setStatus] = useState(task.status);
  const [progress, setProgress] = useState(task.progress);
  const [notes, setNotes] = useState(task.notes || "");
  const [implStatus, setImplStatus] = useState(task.implStatus || "");
  const [partners, setPartners] = useState<string[]>(taskPartners(task));
  const [phase, setPhase] = useState(task.phase || "");
  const [priority, setPriority] = useState(task.priority || "none");
  const canEdit = manager || self;
  const subs = task.subtasks || [];
  const subDone = subs.filter((s) => s.done).length;

  const st = TASK_STATUS[task.status] || TASK_STATUS.todo;
  const impl = task.implStatus ? IMPL_STATUS[task.implStatus] : null;
  const assigned = taskPartners(task);

  const save = useMutation({
    mutationFn: () => {
      const body: any = { status, progress, notes };
      // Full task edit — managers may also rewrite the title (HE/EN), description, impl
      // status, assigned partners and phase; a partner self-edit is limited to the above.
      if (manager) { body.titleHe = titleHe; body.titleEn = titleEn; body.detail = detail; body.implStatus = implStatus; body.partners = partners; body.phase = phase || null; body.priority = priority; }
      return api.pmUpdateTask(task.id, body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pmBoard"] }); qc.invalidateQueries({ queryKey: ["pmMine"] }); qc.invalidateQueries({ queryKey: ["pmPartner"] }); setOpen(false); },
  });
  const del = useMutation({
    mutationFn: () => api.pmDeleteTask(task.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pmBoard"] }); qc.invalidateQueries({ queryKey: ["pmMine"] }); qc.invalidateQueries({ queryKey: ["pmPartner"] }); },
  });

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const sel: React.CSSProperties = { ...input, cursor: "pointer", fontFamily: UI, padding: "9px 11px" };

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <button onClick={() => canEdit && setOpen((o) => !o)} disabled={!canEdit}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none",
          cursor: canEdit ? "pointer" : "default", padding: 0, textAlign: rtl ? "right" : "left", fontFamily: UI }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{he ? task.titleHe : task.titleEn}</span>
            <PriorityChip priority={task.priority} he={he} />
            <StatusChip label={he ? st.he : st.en} color={toneColor(st.tone)} />
            {impl && <span style={{ fontSize: 10.5, color: C.faint }}>· {he ? impl.he : impl.en}</span>}
            {subs.length > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, color: subDone === subs.length ? C.gain : C.muted,
                background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 8px", fontVariantNumeric: "tabular-nums" }}>
                <ClipboardCheck size={11} /> {subDone}/{subs.length}
              </span>
            )}
            <AssigneeChips ids={assigned} />
          </div>
          {task.detail && <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{task.detail}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}><Bar pct={task.progress} h={7} /></div>
            <span style={{ fontSize: 12, fontWeight: 800, color: C.muted, fontVariantNumeric: "tabular-nums", minWidth: 34, textAlign: "end" }}>{task.progress}%</span>
          </div>
        </div>
        {canEdit && <Pencil size={14} color={C.muted} style={{ flexShrink: 0 }} />}
      </button>

      {open && canEdit && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 12 }}>
          {manager && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
                <div>
                  <label style={lbl}>{he ? "כותרת (עברית)" : "Title (Hebrew)"}</label>
                  <input value={titleHe} onChange={(e) => setTitleHe(e.target.value)} dir="rtl"
                    style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI }} />
                </div>
                <div>
                  <label style={lbl}>{he ? "כותרת (אנגלית)" : "Title (English)"}</label>
                  <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} dir="ltr"
                    style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI }} />
                </div>
              </div>
              <div>
                <label style={lbl}>{he ? "תיאור" : "Description"}</label>
                <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3}
                  placeholder={he ? "מה המשימה כוללת…" : "What this task involves…"}
                  style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI, lineHeight: 1.5, resize: "vertical" }} dir={rtl ? "rtl" : "ltr"} />
              </div>
            </>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <div>
              <label style={lbl}>{he ? "סטטוס" : "Status"}</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={sel}>
                {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{he ? v.he : v.en}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>{he ? `התקדמות · ${progress}%` : `Progress · ${progress}%`}</label>
              <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))}
                style={{ width: "100%", accentColor: C.gold, marginTop: 8 }} />
            </div>
            {manager && (
              <div>
                <label style={lbl}>{he ? "סטטוס מימוש" : "Impl. status"}</label>
                <select value={implStatus} onChange={(e) => setImplStatus(e.target.value)} style={sel}>
                  <option value="">—</option>
                  {Object.entries(IMPL_STATUS).map(([k, v]) => <option key={k} value={k}>{he ? v.he : v.en}</option>)}
                </select>
              </div>
            )}
            {manager && (
              <div>
                <label style={lbl}>{he ? "עדיפות" : "Priority"}</label>
                <PrioritySelect value={priority} onChange={setPriority} he={he} style={sel} />
              </div>
            )}
            {manager && (
              <div>
                <label style={lbl}>{he ? "שלב" : "Phase"}</label>
                <select value={phase} onChange={(e) => setPhase(e.target.value)} style={sel}>
                  <option value="">—</option>
                  {PHASES.map((p) => <option key={p.id} value={p.id}>{he ? p.label.he : p.label.en}</option>)}
                </select>
              </div>
            )}
          </div>
          {manager && (
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 12px" }}>
              <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Users size={13} color={C.gold} /> {he ? "אנשים במשימה (בחירה מרובה)" : "People on this task (multi-select)"}
              </label>
              <PartnerChips value={partners} onChange={setPartners} he={he} />
            </div>
          )}
          <SubtaskList task={task} canEdit={canEdit} he={he} rtl={rtl} />
          <div>
            <label style={lbl}>{he ? "הערות" : "Notes"}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI, lineHeight: 1.5, resize: "vertical" }} dir={rtl ? "rtl" : "ltr"} />
          </div>
          {/* Threaded comments — owners give direction on ANY task; the assignee replies on
              their own. Owner comments also appear in the Owners Daily Report. */}
          <TaskComments taskId={task.id} he={he} rtl={rtl} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => save.mutate()} disabled={save.isPending} style={btn(true)}>
              {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}
            </button>
            {manager && (
              <button onClick={() => { if (confirm(he ? "למחוק משימה זו?" : "Delete this task?")) del.mutate(); }} disabled={del.isPending}
                style={{ ...btn(), color: C.loss, borderColor: `${C.loss}66`, marginInlineStart: "auto" }}>
                <Trash2 size={14} /> {he ? "מחק" : "Delete"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// New-task form (managers only reach the Board). A task can be assigned to SEVERAL partners.
function TaskCreate({ he, rtl, partners, onClose }: { he: boolean; rtl: boolean; partners: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [titleHe, setTitleHe] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [detail, setDetail] = useState("");
  const [assignees, setAssignees] = useState<string[]>([partners[0] || "dan"]);
  const [phase, setPhase] = useState(PHASES[0]?.id || "");
  const [status, setStatus] = useState<PmTask["status"]>("todo");
  const [priority, setPriority] = useState("none");
  const create = useMutation({
    mutationFn: () => api.pmCreateTask({ titleHe, titleEn, detail, partners: assignees, assignee: assignees[0] || null, phase, status, priority, progress: 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pmBoard"] }); onClose(); },
  });
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const sel: React.CSSProperties = { ...input, cursor: "pointer", fontFamily: UI };
  return (
    <div style={glassCard({ display: "flex", flexDirection: "column", gap: 12 })}>
      <SectionTitle icon={<Plus size={16} color={C.gold} />} right={
        <button onClick={onClose} className="tap44" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
      }>{he ? "משימה חדשה" : "New task"}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div><label style={lbl}>{he ? "כותרת (עברית)" : "Title (Hebrew)"}</label>
          <input value={titleHe} onChange={(e) => setTitleHe(e.target.value)} dir="rtl" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
        <div><label style={lbl}>{he ? "כותרת (אנגלית)" : "Title (English)"}</label>
          <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} dir="ltr" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
        <div><label style={lbl}>{he ? "שלב" : "Phase"}</label>
          <select value={phase} onChange={(e) => setPhase(e.target.value)} style={sel}>
            {PHASES.map((p) => <option key={p.id} value={p.id}>{he ? p.label.he : p.label.en}</option>)}
          </select></div>
        <div><label style={lbl}>{he ? "סטטוס" : "Status"}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={sel}>
            {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{he ? v.he : v.en}</option>)}
          </select></div>
        <div><label style={lbl}>{he ? "עדיפות" : "Priority"}</label>
          <PrioritySelect value={priority} onChange={setPriority} he={he} style={sel} /></div>
      </div>
      <div>
        <label style={lbl}>{he ? "תיאור" : "Description"}</label>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} placeholder={he ? "מה המשימה כוללת…" : "What this task involves…"}
          style={{ ...input, width: "100%", boxSizing: "border-box", fontFamily: UI, lineHeight: 1.5, resize: "vertical" }} dir={rtl ? "rtl" : "ltr"} />
      </div>
      <div>
        <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 6 }}><Users size={13} color={C.gold} /> {he ? "אנשים במשימה (בחירה מרובה)" : "People on this task (multi-select)"}</label>
        <PartnerChips value={assignees} onChange={setAssignees} he={he} />
      </div>
      <button onClick={() => create.mutate()} disabled={create.isPending || !(titleHe || titleEn) || assignees.length === 0} style={{ ...btn(true), alignSelf: "flex-start" }}>
        {create.isPending ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} {he ? "הוסף משימה" : "Add task"}
      </button>
    </div>
  );
}

// ══ 4) PROGRESS — rolled up from the tasks, framed toward launch ═════════════
function Progress({ bi, he }: { bi: (b: Bi) => string; he: boolean }) {
  const boardQ = useQuery({ queryKey: ["pmBoard"], queryFn: () => api.pmBoard(), staleTime: 15000 });
  const [progView, setProgView] = useViewMode("algo770_ownersprog_view_v1", "cards");
  if (boardQ.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const tasks = ((boardQ.data as any)?.tasks || []) as PmTask[];
  const prog = (boardQ.data as any)?.progress as PmProgress | undefined;
  const overall = prog ? prog.overall : overallPct();

  const buckets: { key: string; tone: TaskTone; Icon: any }[] = [
    { key: "done", tone: "ok", Icon: Check },
    { key: "in_progress", tone: "info", Icon: Clock },
    { key: "blocked", tone: "warn", Icon: CircleAlert },
    { key: "todo", tone: "muted", Icon: CircleDot },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Launch headline */}
      <div style={glassCard()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
          <RocketIcon size={18} color={C.gold} />
          <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "אחוז ביצוע עד להשקה / למכירה" : "Percent complete to launch / for-sale"}</span>
          <span style={{ marginInlineStart: "auto", fontSize: 30, fontWeight: 900, color: C.gold, letterSpacing: "-0.02em" }}>{overall}%</span>
        </div>
        <Bar pct={overall} h={11} />
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{bi(LAUNCH_MILESTONE)}</p>
      </div>

      {/* Per-phase, rolled up from tasks (fallback to the static phase pct when a phase has no tasks) */}
      <div style={glassCard()}>
        <SectionTitle icon={<CircleDot size={16} color={C.gold} />}>{he ? "שלבים במפת הדרכים" : "Roadmap phases"}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {PHASES.map((p) => {
            const livePct = prog?.byPhase?.[p.id];
            const pct = typeof livePct === "number" ? livePct : p.pct;
            const meta = STATUS_META[p.status];
            const count = tasks.filter((t) => t.phase === p.id).length;
            return (
              <div key={p.id}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{bi(p.label)}</span>
                    <StatusChip label={he ? meta.he : meta.en} color={meta.color()} />
                    {count > 0 && <span style={{ fontSize: 11, color: C.faint }}>· {count} {he ? "משימות" : "tasks"}</span>}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
                </div>
                <Bar pct={pct} />
                <p style={{ margin: "7px 0 0", fontSize: 12.5, lineHeight: 1.5, color: C.muted }}>{bi(p.blurb)}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status breakdown — driven by the live tasks. rows/squares toggle. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ViewToggle view={progView} onChange={setProgView} he={he} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: progView === "cards" ? "repeat(auto-fill, minmax(min(100%, 150px), 1fr))" : "1fr", gap: 14 }}>
        {buckets.map((b) => {
          const list = tasks.filter((t) => (t.status || "todo") === b.key);
          const label = TASK_STATUS[b.key];
          const col = toneColor(b.tone);
          return (
            <div key={b.key} style={glassCard()}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <b.Icon size={16} color={col} />
                <span style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>{he ? label.he : label.en}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.faint }}>· {list.length}</span>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {list.length === 0 && <li style={{ fontSize: 12, color: C.faint }}>{he ? "— אין —" : "— none —"}</li>}
                {list.map((t) => (
                  <li key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: C.muted }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: col, flexShrink: 0, marginTop: 6 }} />
                    <span>{he ? t.titleHe : t.titleEn}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_META: Record<PhaseStatus, { he: string; en: string; color: () => string }> = {
  current: { he: "נוכחי", en: "Current", color: () => C.gold },
  in_progress: { he: "בתהליך", en: "In progress", color: () => C.blue },
  upcoming: { he: "בהמשך", en: "Upcoming", color: () => C.faint },
};

// ══ PERSONAL SCREEN — a partner's goal + tasks + their piece of the overall ═══
function PersonalScreen({ partner, manager, self, bi, he, rtl }: {
  partner: string; manager: boolean; self: boolean; bi: (b: Bi) => string; he: boolean; rtl: boolean;
}) {
  // Self → the caller's own data (/mine); manager viewing someone → /partner/{id}.
  const q = useQuery({
    queryKey: self ? ["pmMine"] : ["pmPartner", partner],
    queryFn: () => (self ? api.pmMine() : api.pmPartner(partner)),
    staleTime: 15000,
  });
  // Personalized walkthrough — shown on YOUR OWN screen; auto-opens once, remembered in
  // localStorage per partner, and reopenable from the button. (Hooks before any return.)
  const [walk, setWalk] = useState(false);
  const seenKey = `owners_walk_seen_${partner}`;
  React.useEffect(() => {
    try { if (self && !localStorage.getItem(seenKey)) setWalk(true); } catch { /* ignore */ }
  }, [self, seenKey]);
  const closeWalk = () => { setWalk(false); try { localStorage.setItem(seenKey, "1"); } catch { /* ignore */ } };
  if (q.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const data: any = q.data || {};
  const tasks = (data.tasks || []) as PmTask[];
  const goal = (data.goal || null) as PmGoal | null;
  const prog = (data.progress || { overall: 0, total: 0, counts: {} }) as PmProgress;
  const p = partnerById(partner);
  const PIcon = ICON[p?.icon || "Users"] || Users;
  const done = prog.counts?.done || 0;
  const canEditGoal = manager || self;
  const roleText = p ? bi(p.role) : "";
  const goalText = goal ? (he ? goal.goalHe : goal.goalEn) : (p ? bi(p.emphasis) : "");
  const walkSteps = buildWalkSteps({ p, roleText, goalText, tasksLen: tasks.length, overall: prog.overall, manager, he });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {walk && <Walkthrough steps={walkSteps} onClose={closeWalk} he={he} rtl={rtl} />}
      {/* Header + their piece of the overall */}
      <div style={glassCard()}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ width: 52, height: 52, borderRadius: 15, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
            <PIcon size={25} color="#0B0613" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>{p?.name || partner}</div>
            {p && <div style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>{bi(p.role)}</div>}
          </div>
          <div style={{ marginInlineStart: "auto", textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: C.gold, lineHeight: 1 }}>{prog.overall}%</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, marginTop: 3 }}>
              {he ? `${done}/${prog.total} הושלמו` : `${done}/${prog.total} done`}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}><Bar pct={prog.overall} h={10} /></div>
        {self && (
          <button onClick={() => setWalk(true)} className="tap44"
            style={{ marginTop: 12, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "10px 13px",
              fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
            <GraduationCap size={16} color={C.gold} /> {he ? "הדרכה — סייר לי במסך" : "Walk me through my screen"}
          </button>
        )}
      </div>

      {/* Personal SUMMARY — grounded in the audit (fintech-spec + technical/legal gap review),
          shown for the partners whose open items come from it (Raz legal · Oren technical). */}
      {p?.auditSummary && (
        <div style={{ ...glassCard(), display: "flex", alignItems: "flex-start", gap: 10 }}>
          <FileSearch size={16} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, color: C.text, marginBottom: 5, letterSpacing: "0.02em" }}>
              {he ? "סיכום — לפי האודיט" : "Summary — based on the audit"}
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: C.muted }}>{bi(p.auditSummary)}</p>
          </div>
        </div>
      )}

      {/* Personal GOAL — editable by the partner (self) or a manager */}
      <GoalCard partner={partner} goal={goal} fallback={p?.emphasis} canEdit={canEditGoal} he={he} rtl={rtl} bi={bi} />

      {/* Their TASKS */}
      <div style={glassCard()}>
        <SectionTitle icon={<ClipboardList size={16} color={C.gold} />}>
          {he ? "המשימות שלי" : "My tasks"}{!self && ` · ${p?.name || partner}`}
        </SectionTitle>
        {tasks.length === 0 ? (
          <div style={{ fontSize: 13, color: C.faint, padding: "8px 0" }}>{he ? "אין משימות עדיין." : "No tasks yet."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tasks.map((t) => <TaskCard key={t.id} task={t} he={he} rtl={rtl} manager={manager} self={self} />)}
          </div>
        )}
        {self && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: C.faint, lineHeight: 1.5 }}>
            {he ? "אפשר לעדכן סטטוס, אחוז התקדמות והערות במשימות שלך." : "You can update status, progress and notes on your own tasks."}
          </p>
        )}
      </div>
    </div>
  );
}

function GoalCard({ partner, goal, fallback, canEdit, he, rtl, bi }: {
  partner: string; goal: PmGoal | null; fallback?: Bi; canEdit: boolean; he: boolean; rtl: boolean; bi: (b: Bi) => string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [gh, setGh] = useState(goal?.goalHe || "");
  const [ge, setGe] = useState(goal?.goalEn || "");
  React.useEffect(() => { setGh(goal?.goalHe || ""); setGe(goal?.goalEn || ""); }, [goal?.goalHe, goal?.goalEn]);
  const save = useMutation({
    mutationFn: () => api.pmSetGoal(partner, gh, ge),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pmMine"] }); qc.invalidateQueries({ queryKey: ["pmPartner", partner] });
      qc.invalidateQueries({ queryKey: ["pmBoard"] }); setEditing(false);
    },
  });
  const shown = goal ? (he ? goal.goalHe : goal.goalEn) : (fallback ? bi(fallback) : "");
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };

  return (
    <div style={glassCard()}>
      <SectionTitle icon={<Target size={16} color={C.gold} />}
        right={canEdit && !editing ? (
          <button onClick={() => setEditing(true)} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 6,
            background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
            <Pencil size={13} /> {he ? "ערוך" : "Edit"}
          </button>
        ) : undefined}>
        {he ? "היעד האישי" : "Personal goal"}
      </SectionTitle>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label style={lbl}>{he ? "יעד (עברית)" : "Goal (Hebrew)"}</label>
            <input value={gh} onChange={(e) => setGh(e.target.value)} dir="rtl" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={lbl}>{he ? "יעד (אנגלית)" : "Goal (English)"}</label>
            <input value={ge} onChange={(e) => setGe(e.target.value)} dir="ltr" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => save.mutate()} disabled={save.isPending} style={btn(true)}>
              {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}
            </button>
            <button onClick={() => { setEditing(false); setGh(goal?.goalHe || ""); setGe(goal?.goalEn || ""); }} style={btn()}>{he ? "ביטול" : "Cancel"}</button>
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.5 }}>
          {shown || (he ? "טרם הוגדר יעד." : "No goal set yet.")}
        </p>
      )}
    </div>
  );
}

// ══ Phase 4 · DAILY — the morning scan ════════════════════════════════════════
// One aggregated view the owners scan each morning to decide what to execute: the
// headline % to launch, a prioritized "Needs attention today" list (deep-links to
// Board/Vote), a voting pulse, a per-partner snapshot, and the server-composed
// morning-summary paragraph in a copyable card. All from ONE /auth/pm/daily call.
const ATTN_META: Record<DailyAttention["kind"], { he: string; en: string; tone: TaskTone; Icon: any }> = {
  blocked: { he: "חסום", en: "Blocked", tone: "warn", Icon: CircleAlert },
  vote_needswork: { he: "סומן בהצבעה", en: "Flagged in voting", tone: "warn", Icon: VoteIcon },
  near_done: { he: "קרוב לסיום", en: "Near done", tone: "ok", Icon: Clock },
  open_priority: { he: "פתוח · עדיפות", en: "Open · priority", tone: "info", Icon: CircleDot },
};

function CopyCard({ text, he }: { text: string; he: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* no-op */ }
  };
  return (
    <div style={glassCard({ borderColor: `${C.gold}44` })}>
      <SectionTitle icon={<Sunrise size={16} color={C.gold} />}
        right={
          <button onClick={copy} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 6,
            background: C.surface2, border: `1px solid ${C.line}`, color: copied ? C.gain : C.text, borderRadius: 10,
            padding: "6px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
            {copied ? <ClipboardCheck size={14} /> : <Copy size={14} />} {copied ? (he ? "הועתק" : "Copied") : (he ? "העתק" : "Copy")}
          </button>
        }>
        {he ? "סיכום הבוקר" : "Morning summary"}
      </SectionTitle>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: C.text }}>{text}</p>
    </div>
  );
}

function Daily({ bi, he, rtl, goto }: { bi: (b: Bi) => string; he: boolean; rtl: boolean; goto: (t: Tab) => void }) {
  const q = useQuery({ queryKey: ["pmDaily"], queryFn: () => api.daily(), staleTime: 60000 });
  const [snapView, setSnapView] = useViewMode("algo770_ownerssnap_view_v1", "cards");
  if (q.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const d = (q.data || {}) as Partial<DailyData>;
  const today = new Intl.DateTimeFormat(he ? "he-IL" : "en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jerusalem" }).format(new Date());
  const titleOf = (itemKey: string, tHe?: string, tEn?: string) => {
    if (tHe || tEn) return he ? (tHe || tEn) : (tEn || tHe);
    const cat = voteItemByKey(itemKey);
    return cat ? bi(cat.title) : itemKey;
  };
  const counts = d.counts || {};
  const attention = d.attention || [];
  const pulse = d.votingPulse || { decisions: [], contested: [], screensFlagged: [] };
  const partners = d.partners || [];
  const summary = he ? d.summary?.he : d.summary?.en;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Dated header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Sunrise size={18} color={C.gold} />
        <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "היום" : "Today"}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>· {today}</span>
      </div>

      {/* Headline % to launch */}
      <div style={glassCard()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
          <RocketIcon size={18} color={C.gold} />
          <span style={{ fontSize: 14.5, fontWeight: 900, color: C.text }}>{he ? "אחוז ביצוע עד להשקה" : "Percent complete to launch"}</span>
          <span style={{ marginInlineStart: "auto", fontSize: 30, fontWeight: 900, color: C.gold, letterSpacing: "-0.02em" }}>{d.overall ?? 0}%</span>
        </div>
        <Bar pct={d.overall ?? 0} h={11} />
        <div style={{ marginTop: 12, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Metric label={he ? "בתהליך" : "In progress"} value={counts.in_progress || 0} tone="info" />
          <Metric label={he ? "חסום" : "Blocked"} value={counts.blocked || 0} tone={counts.blocked ? "warn" : "ok"} />
          <Metric label={he ? "לביצוע" : "To do"} value={counts.todo || 0} />
          <Metric label={he ? "הושלם" : "Done"} value={counts.done || 0} tone="ok" />
        </div>
      </div>

      {/* Needs attention today */}
      <div style={glassCard()}>
        <SectionTitle icon={<CircleAlert size={16} color={C.gold} />}>
          {he ? "דורש תשומת לב היום" : "Needs attention today"} <span style={{ fontSize: 12, color: C.faint, fontWeight: 700 }}>· {attention.length}</span>
        </SectionTitle>
        {attention.length === 0 ? (
          <div style={{ fontSize: 13, color: C.faint, display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={15} color={C.gain} /> {he ? "אין פריטים דחופים — בוקר רגוע." : "Nothing urgent — a calm morning."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {attention.map((a) => {
              const m = ATTN_META[a.kind];
              const col = toneColor(m.tone);
              return (
                <div key={a.itemKey + a.kind} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 13, padding: "10px 12px",
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <m.Icon size={15} color={col} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 120, fontSize: 13, fontWeight: 800, color: C.text }}>{titleOf(a.itemKey, a.titleHe, a.titleEn)}</span>
                  <StatusChip label={he ? m.he : m.en} color={col} />
                  {typeof a.progress === "number" && a.kind !== "blocked" && (
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{a.progress}%</span>
                  )}
                  {(a.change || a.reject) ? (
                    <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>✎{a.change || 0} 👎{a.reject || 0}</span>
                  ) : null}
                  <button onClick={() => goto(a.target)} className="tap44" title={a.target === "board" ? (he ? "ללוח" : "To Board") : (he ? "להצבעה" : "To Vote")}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.line}`, color: C.gold,
                      borderRadius: 10, padding: "6px 10px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
                    {a.target === "board" ? (he ? "לוח" : "Board") : (he ? "הצבעה" : "Vote")} <ArrowUpRight size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Voting pulse */}
      <div style={glassCard()}>
        <SectionTitle icon={<VoteIcon size={16} color={C.gold} />} right={
          <button onClick={() => goto("results")} className="tap44" style={{ background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: UI, display: "inline-flex", alignItems: "center", gap: 5 }}>
            {he ? "תוצאות מלאות" : "Full results"} <ArrowUpRight size={13} />
          </button>
        }>{he ? "דופק ההצבעה" : "Voting pulse"}</SectionTitle>
        {(pulse.decisions.length === 0 && pulse.screensFlagged.length === 0) ? (
          <div style={{ fontSize: 13, color: C.faint }}>{he ? "טרם הוצבעו החלטות." : "No decisions voted yet."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pulse.decisions.map((dec) => {
              const cat = voteItemByKey(dec.itemKey);
              const win = voteOption(cat, dec.top);
              const isContested = pulse.contested.some((c) => c.itemKey === dec.itemKey);
              return (
                <div key={dec.itemKey} style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text, flex: 1, minWidth: 120 }}>{cat ? bi(cat.title) : dec.itemKey}</span>
                  {win && <StatusChip label={`🏆 ${bi(win.label)} · ${dec.topPct}%`} color={C.gold} />}
                  {isContested && <StatusChip label={he ? "שנוי במחלוקת" : "Contested"} color={C.loss} />}
                </div>
              );
            })}
            {pulse.screensFlagged.map((s) => {
              const cat = voteItemByKey(s.itemKey);
              return (
                <div key={s.itemKey} style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text, flex: 1, minWidth: 120 }}>{cat ? bi(cat.title) : s.itemKey}</span>
                  <StatusChip label={he ? `סומן לשינוי · ✎${s.change}` : `Flagged · ✎${s.change}`} color={voteColor("change")} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Per-partner snapshot */}
      <div style={glassCard()}>
        <SectionTitle icon={<Users size={16} color={C.gold} />} right={<ViewToggle view={snapView} onChange={setSnapView} he={he} />}>{he ? "מבט על השותפים" : "Partner snapshot"}</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: snapView === "cards" ? "repeat(auto-fill, minmax(min(100%, 140px), 1fr))" : "1fr", gap: 10 }}>
          {partners.map((p) => {
            const PIcon = ICON[partnerById(p.partner)?.icon || "Users"] || Users;
            const goal = he ? p.goalHe : p.goalEn;
            return (
              <div key={p.partner} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 13, padding: "11px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: C.accentGrad }}>
                    <PIcon size={14} color={ONACCENT} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{p.name}</span>
                  <span style={{ marginInlineStart: "auto", fontSize: 11.5, fontWeight: 800, color: C.muted }}>{p.openCount} {he ? "פתוחות" : "open"}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}><Bar pct={p.avgProgress} h={6} /></div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{p.avgProgress}%</span>
                </div>
                {goal && <p style={{ margin: "7px 0 0", fontSize: 11, color: C.faint, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{goal}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Morning summary — copyable (reused by the report-sending below) */}
      {summary && <CopyCard text={summary} he={he} />}

      {/* Send report — OWNER-ONLY, safety-gated (compose → preview → confirm → send) */}
      {isOwner() && <ReportsPanel bi={bi} he={he} rtl={rtl} />}
      {/* Branded Owners Daily Report — auto-emailed 09:00 IL; preview + manual test here */}
      {isOwner() && <DailyReportPanel he={he} />}
    </div>
  );
}

// ══ Part C2 · SEND REPORT — team-only, compose → preview → confirm → send ══════
// SAFETY: nothing dispatches without an explicit Send click AND a ConfirmModal naming the
// recipients + channel + message. The flow always PREVIEWS (dryRun) first; the live POST
// (dryRun=false) fires only from the ConfirmModal's onConfirm. Team/partners only — no
// all-users broadcast. Default channel is the in-app DM; external channels gracefully no-op.
const REPORT_CHANNELS: { id: "inapp" | "sms" | "whatsapp" | "email"; he: string; en: string; Icon: any }[] = [
  { id: "inapp", he: "צ'אט באפליקציה", en: "In-app DM", Icon: MessageSquare },
  { id: "sms", he: "SMS", en: "SMS", Icon: Smartphone },
  { id: "whatsapp", he: "וואטסאפ", en: "WhatsApp", Icon: MessageCircle },
  { id: "email", he: "אימייל", en: "Email", Icon: Mail },
];

function ReportMsg({ text }: { text: string }) {
  return (
    <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: UI,
      fontSize: 12, lineHeight: 1.55, color: C.muted, background: C.glass, border: `1px solid ${C.glassBd}`,
      borderRadius: 10, padding: "10px 12px" }}>{text}</pre>
  );
}

// A WRAP-CAPABLE segmented control — same pill styling as <Segmented> (surface2 track,
// skin var(--btn-bg)/var(--btn-ink) selected pill), but the options WRAP to multiple rows
// on a narrow phone instead of overflowing. Used for the report Recipients + Channel
// pickers so a 4-option channel row never clips "Email" on mobile.
function WrapSeg<T extends string>({ value, onChange, options, minWidth = 92 }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; minWidth?: number;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)} className="tap44"
            style={{ flex: `1 1 ${minWidth}px`, minWidth, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
              background: on ? "var(--btn-bg)" : "none", color: on ? "var(--btn-ink)" : C.muted,
              border: "none", borderRadius: 999, padding: "8px 10px", fontSize: 12, fontWeight: 800, fontFamily: UI,
              // No-overflow: a long label (e.g. the Hebrew "צ'אט באפליקציה") WRAPS inside the pill
              // instead of spilling out. `overflow:hidden` is the belt-and-braces clip.
              lineHeight: 1.15, textAlign: "center", overflow: "hidden", cursor: "pointer" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ReportsPanel({ bi, he, rtl }: { bi: (b: Bi) => string; he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"each" | "all" | "specific">("each");
  const [picked, setPicked] = useState<string[]>([]);
  const [channel, setChannel] = useState<"inapp" | "sms" | "whatsapp" | "email">("inapp");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<ReportResult[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lang = he ? "he" : "en";
  const scopeVal = (): string | string[] => (scope === "specific" ? picked : scope);
  const pickedKey = picked.join(",");
  // Any change to scope/channel invalidates the preview + results (must re-preview).
  React.useEffect(() => { setPreview(null); setResults(null); }, [scope, channel, pickedKey]);

  const previewMut = useMutation({
    mutationFn: () => api.reportSend({ scope: scopeVal(), channel, lang, dryRun: true }),
    onSuccess: (d) => { setPreview(d as ReportPreview); setResults(null); },
  });
  // Refresh — re-pull CURRENT PM data before preview/send so the team summary is never stale
  // (the summary is built live server-side; this refreshes the on-screen views + clears the
  // preview so you re-preview fresh). Matches the daily-report Refresh.
  const refresh = async () => {
    setRefreshing(true); setPreview(null); setResults(null);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pmDaily"] }),
        qc.invalidateQueries({ queryKey: ["pmBoard"] }),
        qc.invalidateQueries({ queryKey: ["pmVotes"] }),
        qc.invalidateQueries({ queryKey: ["pmMine"] }),
        qc.invalidateQueries({ queryKey: ["pmPartner"] }),
      ]);
    } finally { setRefreshing(false); }
  };
  const chLabel = (c: string) => { const x = REPORT_CHANNELS.find((k) => k.id === c); return x ? (he ? x.he : x.en) : c; };
  const msgOf = (r: ReportPreview["recipients"][number]) => (he ? r.messageHe : r.messageEn);
  // Per-recipient status on the SELECTED channel — drives the preview chip + confirm rows.
  // Email is precise (needs account + email on file + consent); in-app needs an account;
  // sms/whatsapp are best-effort (attempted, skipped gracefully if unconfigured).
  const recipChip = (r: ReportRecipient): { label: string; color: string } => {
    if (!r.hasAccount) return { label: he ? "אין חשבון · ידולג" : "no account · will skip", color: C.faint };
    if (channel === "email" && !r.emailOk) {
      return { label: r.hasEmail ? (he ? "אין הסכמה למייל · ידולג" : "no email consent · skip") : (he ? "אין אימייל · ידולג" : "no email · will skip"), color: C.faint };
    }
    // SMS / WhatsApp: owners/staff are eligible on a saved number (no consent needed);
    // a missing number skips as "no number", a non-staff without consent as "no consent".
    if (channel === "sms" && !r.smsOk) {
      return { label: r.hasPhone ? (he ? "אין הסכמה ל-SMS · ידולג" : "no SMS consent · skip") : (he ? "אין מספר · ידולג" : "no number · will skip"), color: C.faint };
    }
    if (channel === "whatsapp" && !r.waOk) {
      return { label: r.hasWhatsappNumber ? (he ? "אין הסכמה לוואטסאפ · ידולג" : "no WhatsApp consent · skip") : (he ? "אין מספר · ידולג" : "no number · will skip"), color: C.faint };
    }
    const green = channel === "inapp" || (channel === "email" && !!r.emailOk)
      || (channel === "sms" && !!r.smsOk) || (channel === "whatsapp" && !!r.waOk);
    return { label: `→ ${chLabel(channel)}`, color: green ? C.gain : C.muted };
  };
  const specificEmpty = scope === "specific" && picked.length === 0;

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, margin: "0 0 6px", display: "block" };

  return (
    <div style={glassCard()}>
      <SectionTitle icon={<Send size={16} color={C.gold} />}>{he ? "שליחת דוח לצוות" : "Send report to the team"}</SectionTitle>
      <p style={{ margin: "0 0 14px", fontSize: 11.5, lineHeight: 1.55, color: C.faint }}>
        {he ? "לשותפים בלבד. ברירת המחדל: צ'אט פנימי באפליקציה. ערוצים חיצוניים לא פעילים ללא מפתחות ויתדלגו בעדינות. שום דבר לא נשלח עד שתאשרו." : "Partners only. Default: the in-app chat. External channels no-op without prod keys and are skipped gracefully. Nothing sends until you confirm."}
      </p>

      {/* Recipients */}
      <label style={lbl}>{he ? "נמענים" : "Recipients"}</label>
      <div style={{ maxWidth: 460 }}>
        <WrapSeg<"each" | "all" | "specific"> value={scope} onChange={setScope} minWidth={96}
          options={[
            { value: "each", label: he ? "כל אחד לחוד" : "Each partner" },
            { value: "all", label: he ? "כולם יחד" : "All together" },
            { value: "specific", label: he ? "בחירה" : "Specific" },
          ]} />
      </div>
      {scope === "specific" && <div style={{ marginTop: 10 }}><PartnerChips value={picked} onChange={setPicked} he={he} /></div>}
      <p style={{ margin: "8px 0 0", fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
        {scope === "all"
          ? (he ? "כל שותף יקבל את סיכום הצוות המשותף (סיכום הבוקר)." : "Each partner gets the shared team summary (the morning paragraph).")
          : (he ? "כל שותף יקבל סיכום אישי משלו (יעד, אחוז, המשימות שלו)." : "Each partner gets their own personalized summary (goal, %, their tasks).")}
      </p>

      {/* Channel */}
      <label style={{ ...lbl, marginTop: 16 }}>{he ? "ערוץ" : "Channel"}</label>
      <div style={{ maxWidth: 520 }}>
        <WrapSeg<"inapp" | "sms" | "whatsapp" | "email"> value={channel} onChange={setChannel} minWidth={86}
          options={REPORT_CHANNELS.map((c) => ({ value: c.id, label: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%" }}>
              <c.Icon size={13} style={{ flexShrink: 0 }} />
              <span style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" }}>{he ? c.he : c.en}</span>
            </span>
          ) }))} />
      </div>
      {channel === "email" ? (
        <p style={{ margin: "8px 0 0", fontSize: 11, fontWeight: 700, lineHeight: 1.5,
          color: (preview && preview.emailConfigured === false) ? C.loss : C.muted }}>
          {(preview && preview.emailConfigured === false)
            ? (he ? "אימייל אינו מוגדר בשרת — הנמענים יידולגו." : "Email is not configured on the server — recipients will be skipped.")
            : (he ? "אימייל פעיל — שותפים עם כתובת שמורה והסכמה לערוץ יקבלו את הדוח במייל; אחרים יסומנו \"אין אימייל\"." : "Email is live — partners with an email on file + channel consent are emailed the report; others are marked \"no email\".")}
        </p>
      ) : channel !== "inapp" ? (
        <p style={{ margin: "8px 0 0", fontSize: 11, color: C.muted, fontWeight: 700, lineHeight: 1.5 }}>
          {he ? "יימסר רק אם הערוץ מוגדר בשרת והשותף נתן הסכמה — אחרת ידולג בעדינות." : "Delivered only if that channel is configured on the server and the partner consented — otherwise skipped gracefully."}
        </p>
      ) : null}

      {/* Preview */}
      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={refresh} disabled={refreshing || previewMut.isPending} style={btn()}
          title={he ? "רענון נתוני הסיכום לפני תצוגה/שליחה" : "Refresh the summary data before preview/send"}>
          {refreshing ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} {he ? "רענון" : "Refresh"}
        </button>
        <button onClick={() => previewMut.mutate()} disabled={previewMut.isPending || refreshing || specificEmpty} style={btn()}>
          {previewMut.isPending ? <Loader2 size={15} className="spin" /> : <FileSearch size={15} />} {he ? "תצוגה מקדימה" : "Preview"}
        </button>
        {preview && (
          <button onClick={() => setConfirming(true)} disabled={preview.sendable === 0} style={btn(true)}>
            <Send size={15} /> {he ? `שליחה (${preview.sendable})` : `Send (${preview.sendable})`}
          </button>
        )}
      </div>

      {preview && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.text }}>
            {he ? `${preview.count} נמענים · ${preview.sendable} יישלחו · ${preview.count - preview.sendable} ידולגו` : `${preview.count} recipients · ${preview.sendable} will send · ${preview.count - preview.sendable} skipped`}
          </div>
          {scope === "all" && preview.recipients[0] && (
            <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: C.gold }}>{he ? "סיכום הצוות (לכולם)" : "Team summary (to everyone)"}</div>
              <ReportMsg text={msgOf(preview.recipients[0])} />
            </div>
          )}
          {preview.recipients.map((r) => (
            <div key={r.partner} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{r.name}</span>
                {(() => { const c = recipChip(r); return <StatusChip label={c.label} color={c.color} />; })()}
              </div>
              {scope !== "all" && r.hasAccount && <ReportMsg text={msgOf(r)} />}
            </div>
          ))}
        </div>
      )}

      {results && (
        <div style={{ marginTop: 14, ...glassCard({ background: C.surface2 }) }}>
          <div style={{ fontSize: 12.5, fontWeight: 900, color: C.text, marginBottom: 8 }}>{he ? "תוצאות השליחה" : "Send results"}</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((r) => (
              <li key={r.partner} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                {r.ok ? <CheckCircle2 size={14} color={C.gain} /> : <CircleAlert size={14} color={C.faint} />}
                <span style={{ fontWeight: 800, color: C.text }}>{r.name}</span>
                <span style={{ color: r.ok ? C.gain : C.muted }}>
                  {r.status === "sent" ? (he ? "נשלח (צ'אט)" : "sent (in-app)")
                    : r.status === "sent_email" ? (he ? "נשלח במייל ✉" : "emailed ✉")
                    : r.status === "sent_sms" ? (he ? "נשלח ב-SMS" : "sent by SMS")
                    : r.status === "sent_whatsapp" ? (he ? "נשלח בוואטסאפ" : "sent by WhatsApp")
                    : r.status === "skipped_no_account" ? (he ? "דולג — אין חשבון" : "skipped — no account")
                    : r.status === "skipped_no_email" ? (he ? "דולג — אין אימייל" : "skipped — no email")
                    : r.status === "skipped_email_off" ? (he ? "דולג — הסכמת מייל כבויה" : "skipped — email consent off")
                    : r.status === "skipped_email_not_configured" ? (he ? "דולג — אימייל לא מוגדר בשרת" : "skipped — email not configured")
                    : r.status === "email_failed" ? (he ? "שליחת המייל נכשלה" : "email failed") + (r.error ? ` — ${r.error}` : "")
                    : r.status === "skipped_channel_unavailable" ? (he ? "דולג — ערוץ לא פעיל" : "skipped — channel off")
                    : (r.error || r.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && preview && (
        <ConfirmModal
          title={he ? "לשלוח את הדוח?" : "Send the report?"}
          intro={he
            ? `שליחה ל-${preview.sendable} שותפים דרך ${chLabel(channel)}. ${scope === "all" ? "כולם מקבלים את סיכום הצוות." : "כל אחד מקבל את הסיכום האישי שלו."}`
            : `Sending to ${preview.sendable} partner(s) via ${chLabel(channel)}. ${scope === "all" ? "Everyone gets the team summary." : "Each gets their personalized summary."}`}
          rows={preview.recipients.map((r) => { const c = recipChip(r); return { label: r.name, value: c.label, color: c.color }; })}
          risk={he ? "פעולה זו שולחת הודעות אמת לשותפים המסומנים." : "This sends real messages to the listed partners."}
          confirmLabel={he ? `שלח ל-${preview.sendable}` : `Send to ${preview.sendable}`}
          cancelLabel={he ? "ביטול" : "Cancel"}
          onConfirm={async () => {
            const r = await api.reportSend({ scope: scopeVal(), channel, lang, dryRun: false });
            setResults((r as ReportSendResult).results || []);
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// ══ Owners DAILY REPORT — branded bilingual PDF + HTML web view ═══════════════
// The approved report is auto-emailed to the OWNERS every morning 09:00 Israel time
// (PDF attached + a link to the HTML web view). This panel lets an owner PREVIEW it
// (open the HTML / download the PDF) and MANUALLY trigger the whole email pipeline now.
function DailyReportPanel({ he }: { he: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  // Refresh pulls CURRENT PM data before you open/send a report — so the report is never
  // "stuck on previous data". The report itself always renders live server-side (+ no-store
  // headers, so the browser never serves a cached copy); this refreshes the on-screen views too.
  const refresh = async () => {
    setBusy("refresh"); setMsg(null);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["pmDaily"] }),
        qc.invalidateQueries({ queryKey: ["pmBoard"] }),
        qc.invalidateQueries({ queryKey: ["pmVotes"] }),
        qc.invalidateQueries({ queryKey: ["pmMine"] }),
        qc.invalidateQueries({ queryKey: ["pmPartner"] }),
      ]);
      setMsg({ ok: true, text: he ? "הנתונים רועננו ✓ — עכשיו אפשר לצפות/לשלוח דוח מעודכן" : "Data refreshed ✓ — now view/send an up-to-date report" });
    } finally { setBusy(""); }
  };
  React.useEffect(() => { api.ownersReportStatus().then((r) => setAuto(r.autoEnabled)).catch(() => setAuto(null)); }, []);
  const toggleAuto = async () => {
    const next = !auto;
    if (next && !confirm(he ? "להפעיל שליחה אוטומטית כל בוקר ב-9:00 לכל הבעלים?" : "Enable automatic send every morning at 09:00 to all owners?")) return;
    setBusy("auto"); setMsg(null);
    try {
      const r = await api.ownersReportAutosend(next);
      setAuto(r.autoEnabled);
      setMsg({ ok: true, text: r.autoEnabled ? (he ? "שליחה יומית ב-9:00 הופעלה ✓" : "Daily 09:00 send enabled ✓") : (he ? "שליחה יומית כבויה" : "Daily send disabled") });
    } catch (e: any) { setMsg({ ok: false, text: e?.message || String(e) }); } finally { setBusy(""); }
  };
  const openLink = async (which: "html" | "pdf") => {
    setBusy(which); setMsg(null);
    try {
      const r = await api.ownersReportLink();
      window.open(which === "html" ? r.html : r.pdf, "_blank", "noopener");
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally { setBusy(""); }
  };
  const sendNow = async () => {
    if (!confirm(he ? "לשלוח עכשיו את דוח הבעלים היומי לכל הבעלים במייל (PDF מצורף)?" : "Send the daily owners report to all owners by email now (PDF attached)?")) return;
    setBusy("send"); setMsg(null);
    try {
      const r = await api.ownersReportDailySend();
      const em = `${r.sent ?? 0}/${r.total ?? 0}`;
      const sms = `${r.smsSent ?? 0}/${r.smsTotal ?? 0}`;
      const tg = `${r.tgSent ?? 0}/${r.tgTotal ?? 0}`;
      if (r.error) {
        const pre = (r.sent != null) ? (he ? `מייל ${em} · SMS ${sms} · טלגרם ${tg} · ` : `email ${em} · SMS ${sms} · TG ${tg} · `) : "";
        setMsg({ ok: false, text: (he ? `שגיאה: ${pre}${r.error}` : `Error: ${pre}${r.error}`) });
      } else setMsg({ ok: true, text: he ? `נשלח ✓ · מייל ${em} · SMS ${sms} · טלגרם ${tg}` : `Sent ✓ · email ${em} · SMS ${sms} · TG ${tg}` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || String(e) });
    } finally { setBusy(""); }
  };
  const B = ({ id, label, primary, onClick }: { id: string; label: string; primary?: boolean; onClick: () => void }) => (
    <button onClick={onClick} disabled={!!busy} style={{ ...btn(primary), opacity: busy && busy !== id ? 0.5 : 1 }}>
      {busy === id ? <Loader2 size={15} className="spin" /> : id === "send" ? <Send size={15} /> : id === "pdf" ? <FileSearch size={15} /> : <ArrowUpRight size={15} />}
      {label}
    </button>
  );
  return (
    <div style={glassCard()}>
      <SectionTitle icon={<Mail size={16} color={C.gold} />}>{he ? "דוח בעלים יומי (PDF + מייל)" : "Owners daily report (PDF + email)"}</SectionTitle>
      <p style={{ margin: "0 0 14px", fontSize: 11.5, lineHeight: 1.55, color: C.faint }}>
        {he
          ? "הדוח הממותג נשלח אוטומטית לכל הבעלים בכל בוקר ב-9:00 (שעון ישראל) — PDF מצורף + לינק לצפייה ב-HTML. כאן אפשר לצפות בו עכשיו או לשלוח מיד לבדיקה. לבעלים בלבד."
          : "The branded report is auto-emailed to all owners every morning at 09:00 Israel time — PDF attached + a link to the HTML view. Preview it here, or send it now to test. Owners only."}
      </p>
      {msg && <div style={{ margin: "0 0 12px", fontSize: 12.5, fontWeight: 700, color: msg.ok ? C.gain : C.loss }}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={refresh} disabled={!!busy} style={{ ...btn(false), opacity: busy && busy !== "refresh" ? 0.5 : 1 }}
          title={he ? "רענון הנתונים לפני צפייה/שליחה" : "Refresh the data before viewing/sending"}>
          {busy === "refresh" ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} {he ? "רענון" : "Refresh"}
        </button>
        <B id="html" label={he ? "פתח דוח (HTML)" : "Open web report"} onClick={() => openLink("html")} />
        <B id="pdf" label={he ? "הורד PDF" : "Download PDF"} onClick={() => openLink("pdf")} />
        <B id="send" primary label={he ? "שלח עכשיו לבעלים" : "Send now to owners"} onClick={sendNow} />
      </div>
      {/* Daily 09:00 auto-send flag — OFF until Dan approves the design; flip live here. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0 0", borderTop: `1px solid ${C.line}` }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>
          {he ? "שליחה אוטומטית כל בוקר ב-9:00 (שעון ישראל)" : "Auto-send every morning 09:00 (Israel)"}
          {auto !== null && <span style={{ marginInlineStart: 8, fontSize: 11, fontWeight: 800, color: auto ? C.gain : C.faint }}>{auto ? (he ? "· פעיל" : "· ON") : (he ? "· כבוי" : "· OFF")}</span>}
        </span>
        <button onClick={toggleAuto} disabled={busy === "auto" || auto === null}
          style={{ ...btn(!!auto), opacity: auto === null ? 0.5 : 1 }}>
          {busy === "auto" ? <Loader2 size={14} className="spin" /> : null}
          {auto ? (he ? "כבה" : "Turn off") : (he ? "הפעל" : "Turn on")}
        </button>
      </div>
    </div>
  );
}

// ══ Part C1 · GUIDE — "How this works" mini-deck ══════════════════════════════
// A detailed, honest explanation of the owners interface itself — one card per portal
// area (what it's FOR · what you can DO · who it's for), numbered, with a jump button.
function Guide({ bi, he, rtl, goto }: { bi: (b: Bi) => string; he: boolean; rtl: boolean; goto: (t: Tab) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...glassCard(), display: "flex", alignItems: "flex-start", gap: 10 }}>
        <BookOpen size={16} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text, marginBottom: 4 }}>{he ? "איך זה עובד" : "How this works"}</div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: C.muted }}>
            {he ? "פורטל הבעלים בנוי משבעה אזורים. לכל אחד: מה הוא נועד לו, מה אפשר לעשות בו, ולמי הוא מיועד. לחצו על אזור כדי לפתוח אותו." : "The owners portal has seven areas. For each: what it's for, what you can do there, and who it's for. Tap an area to open it."}
          </p>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        {PORTAL_GUIDE.map((g, i) => {
          const Icon = ICON[g.icon] || Diamond;
          return (
            <div key={g.id} style={glassCard({ display: "flex", flexDirection: "column", gap: 11 })}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, display: "grid", placeItems: "center",
                  background: C.accentGrad, color: ONACCENT, fontSize: 12, fontWeight: 900 }}>{i + 1}</span>
                <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: C.glass, border: `1px solid ${C.glassBd}` }}>
                  <Icon size={16} color={C.gold} />
                </div>
                <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{bi(g.title)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: C.text, fontWeight: 600 }}>{bi(g.forWhat)}</p>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
                {g.canDo.map((c, j) => (
                  <li key={j} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.5, color: C.muted }}>
                    <Check size={13} color={C.gold} style={{ flexShrink: 0, marginTop: 3 }} />
                    <span>{bi(c)}</span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: "auto", paddingTop: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.faint, flex: 1, minWidth: 120 }}>{bi(g.audience)}</span>
                <button onClick={() => goto(g.tab as Tab)} className="tap44"
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`, color: C.gold,
                    borderRadius: 10, padding: "6px 11px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
                  {he ? "פתח" : "Open"} <ArrowUpRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══ Part C1 · WALKTHROUGH — a native, personalized step-card demo ══════════════
// In-app step cards (NOT a browser overlay tour — this app breaks automation). Portaled
// to <body>, dismissible (X · Escape · backdrop), next/back/done, personalized from the
// partner's own data. Reopenable; "seen" remembered in localStorage per partner.
type WalkStep = { Icon: any; title: string; body: string };
function Walkthrough({ steps, onClose, he, rtl }: { steps: WalkStep[]; onClose: () => void; he: boolean; rtl: boolean }) {
  const [i, setI] = useState(0);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!steps.length) return null;
  const step = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  const Back = rtl ? ChevronRight : ChevronLeft;
  const Fwd = rtl ? ChevronLeft : ChevronRight;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)",
      display: "grid", placeItems: "center", padding: 16, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ width: "min(440px, 94vw)", background: C.surface, border: `1px solid ${C.glassBd}`, borderRadius: 18,
          padding: 20, boxShadow: "0 20px 60px rgba(0,0,0,0.5)", fontFamily: UI }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.faint }}>{he ? `שלב ${i + 1} מתוך ${steps.length}` : `Step ${i + 1} of ${steps.length}`}</span>
          <button onClick={onClose} className="tap44" style={{ marginInlineStart: "auto", background: "none", border: "none", color: C.muted, cursor: "pointer", display: "inline-flex" }}>
            <X size={17} />
          </button>
        </div>
        <div style={{ display: "grid", placeItems: "center", marginBottom: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 15, display: "grid", placeItems: "center", background: C.accentGrad, boxShadow: C.glassHi }}>
            <step.Icon size={25} color={ONACCENT} />
          </div>
        </div>
        <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 900, color: C.text, textAlign: "center" }}>{step.title}</h3>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: C.muted, textAlign: "center" }}>{step.body}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, margin: "16px 0" }}>
          {steps.map((_, j) => (
            <span key={j} style={{ width: j === i ? 18 : 7, height: 7, borderRadius: 999, background: j === i ? C.accentGrad : C.line, transition: "width .2s ease" }} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={i === 0} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`,
              color: i === 0 ? C.faint : C.text, borderRadius: 12, padding: "9px 14px", fontSize: 13, fontWeight: 800,
              cursor: i === 0 ? "default" : "pointer", fontFamily: UI, opacity: i === 0 ? 0.5 : 1 }}>
            <Back size={16} /> {he ? "הקודם" : "Back"}
          </button>
          {last ? (
            <button onClick={onClose} className="tap44" style={{ ...btn(true), marginInlineStart: "auto" }}>
              <Check size={16} /> {he ? "סיימתי" : "Done"}
            </button>
          ) : (
            <button onClick={() => setI((v) => Math.min(steps.length - 1, v + 1))} className="tap44"
              style={{ ...btn(true), marginInlineStart: "auto" }}>
              {he ? "הבא" : "Next"} <Fwd size={16} />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Build the personalized walkthrough steps from a partner's OWN data.
function buildWalkSteps(args: { p?: Partner; roleText: string; goalText: string; tasksLen: number;
  overall: number; manager: boolean; he: boolean }): WalkStep[] {
  const { p, roleText, goalText, tasksLen, overall, manager, he } = args;
  const name = p?.name || "";
  const PIcon = ICON[p?.icon || "Users"] || Users;
  const steps: WalkStep[] = [
    { Icon: PIcon,
      title: he ? `שלום ${name} 👋` : `Hi ${name} 👋`,
      body: he ? `${roleText}. זה המסך האישי שלך — היעד, המשימות וההתקדמות שלך במקום אחד. הנה סיור קצר.`
               : `${roleText}. This is your personal screen — your goal, tasks and progress in one place. Here's a quick tour.` },
    { Icon: Target,
      title: he ? "היעד שלך" : "Your goal",
      body: (goalText ? (he ? `היעד שלך: “${goalText}”. ` : `Your goal: “${goalText}”. `) : "")
           + (he ? "אפשר לערוך אותו בכל עת עם כפתור העיפרון." : "You can edit it anytime with the pencil button.") },
    { Icon: ClipboardList,
      title: he ? "המשימות שלך" : "Your tasks",
      body: he ? `יש לך ${tasksLen} משימות. הקישו על משימה כדי לעדכן סטטוס, אחוז התקדמות והערות — השינוי נשמר מיד ומתגלגל ללוח המשימות.`
               : `You have ${tasksLen} task(s). Tap any task to update its status, progress % and notes — it saves instantly and rolls up to the board.` },
    { Icon: Milestone,
      title: he ? "ההתקדמות שלך" : "Your progress",
      body: he ? `ה-${overall}% למעלה הוא החלק שלך בדרך להשקה — הממוצע על פני המשימות שלך. עדכון משימות מזיז אותו.`
               : `The ${overall}% up top is your piece of the road to launch — the average across your tasks. Updating tasks moves it.` },
    { Icon: VoteIcon,
      title: he ? "הצבעה" : "Voting",
      body: manager
        ? (he ? "בלשונית 'הצבעה' מכריעים: מסכים בשיפוט (מאשר/צריך שינוי/דוחה), והחלטות כבחירה אמיתית בין אפשרויות. ההצבעה שלך מעצבת מה נבנה."
              : "In the 'Vote' tab you decide: screens by judgement (approve/change/reject), and decisions as a real pick between options. Your vote shapes what we build.")
        : (he ? "הבעלים מצביעים על המערכת. אפשר לראות היכן הדברים עומדים בתצוגת 'תוצאות' — כולל האפשרות המנצחת בכל החלטה."
              : "The owners vote on the system. You can see where things stand in the 'Results' view — including each decision's winning option.") },
    { Icon: Sunrise,
      title: he ? "סיכום הבוקר" : "The daily scan",
      body: manager
        ? (he ? "לשונית 'עדכון יומי' היא סריקת הבוקר — מה דורש תשומת לב, דופק ההצבעה, וסיכום שדן ורפי קוראים כל בוקר."
              : "The 'Daily update' tab is the morning scan — what needs attention, the voting pulse, and a summary Dan + Rafi read each morning.")
        : (he ? "כל בוקר הבעלים סורקים סיכום יומי כדי להחליט מה מבצעים — המשימות שאתה מעדכן מזינות אותו."
              : "Each morning the owners scan a daily summary to decide what to execute — the tasks you update feed it.") },
    { Icon: Check,
      title: he ? "זהו, מוכן" : "You're all set",
      body: he ? "עדכן את המשימות שלך, השמע את דעתך, ותחזור לבדוק. אפשר לפתוח את ההדרכה שוב בכל עת מהכפתור 'הדרכה'."
               : "Update your tasks, weigh in, and check back. You can reopen this anytime from the 'Walk me through' button." },
  ];
  return steps;
}

// ══ Phase 3 · VOTING ═══════════════════════════════════════════════════════════
// Two ballot styles. SCREENS + board TASKS are a quality judgement — 👍 approve · ✎
// needs-change · 👎 reject (+ Abstain). DECISIONS are a REAL dilemma — the voter picks
// ONE of the competing options (radio-style option cards, skin-accent fill when chosen)
// with live per-option tally bars + the winning option. Both carry an optional comment,
// show who voted, and can be changed or withdrawn. Partners reach Results read-only.
// RESULTS aggregates the winning option per decision + the screen approve/reject tallies,
// plus the prioritized "Needs work" list (screen change/reject) that FEEDS the board.
const VOTE_TONE: Record<VoteChoiceKey, TaskTone> = { approve: "ok", change: "warn", reject: "muted" };
const voteColor = (k: VoteChoiceKey): string => toneColor(VOTE_TONE[k]);
const ONACCENT = "#0B0613";   // dark ink on the skin accent gradient (matches the rest of the portal)

// A slim three-segment tally bar (approve · change · reject) proportional to the vote split.
function TallyBar({ t }: { t?: VoteTally }) {
  const total = t?.total || 0;
  if (!t || total === 0) {
    return <div style={{ height: 8, borderRadius: 999, background: C.surface2, border: `1px solid ${C.line}` }} />;
  }
  return (
    <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: C.surface2, border: `1px solid ${C.line}` }}>
      <span style={{ background: voteColor("approve"), width: `${(100 * t.approve) / total}%` }} />
      <span style={{ background: voteColor("change"), width: `${(100 * t.change) / total}%` }} />
      <span style={{ background: voteColor("reject"), width: `${(100 * t.reject) / total}%` }} />
    </div>
  );
}

// Per-option tally for a DECISION — one labelled bar per option, the winner in accent.
function OptionTally({ item, tally, bi, he }: { item: VoteItem; tally?: VoteTally; bi: (b: Bi) => string; he: boolean }) {
  const picks = tally?.picks || 0;
  const byOption = tally?.byOption || {};
  const abstain = tally?.abstain || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {(item.options || []).map((opt) => {
        const n = byOption[opt.id] || 0;
        const pct = picks ? Math.round((100 * n) / picks) : 0;
        const win = !!picks && tally?.top === opt.id && n > 0;
        return (
          <div key={opt.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: win ? C.gold : C.muted }}>{bi(opt.label)}</span>
              {win && <Trophy size={11} color={C.gold} />}
              <span style={{ marginInlineStart: "auto", fontSize: 11.5, fontWeight: 800, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{n} · {pct}%</span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: C.surface2, border: `1px solid ${C.line}`, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: win ? C.accentGrad : `${C.gold}55`, transition: "width .3s ease" }} />
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}>
        {picks} {he ? "בחרו" : "picked"}{abstain ? ` · ${abstain} ${he ? "נמנעו" : "abstained"}` : ""}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: TaskTone }) {
  const col = tone ? toneColor(tone) : C.text;
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 900, color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ══ VOTE tab — grouped ballot (owners cast; partners read) ═════════════════════
function Vote({ bi, he, rtl }: { bi: (b: Bi) => string; he: boolean; rtl: boolean }) {
  const q = useQuery({ queryKey: ["pmVotes"], queryFn: () => api.votesData(), staleTime: 10000 });
  if (q.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const data = (q.data || {}) as VotesData;
  const canVote = !!data.canVote;
  const tallies = data.tallies || {};
  const mine = data.mine || {};

  // Tasks come from the API (lock-step with the board); screens + decisions from the catalog.
  const taskItems: VoteItem[] = (data.taskItems || []).map((t) => ({
    key: t.key, type: "task", icon: "ClipboardList",
    title: { he: t.titleHe || t.titleEn, en: t.titleEn || t.titleHe }, desc: { he: "", en: "" },
  }));
  const groups: { id: VoteItemType; label: Bi; icon: string; items: VoteItem[] }[] = [
    ...VOTE_GROUPS.map((g) => ({ id: g.id, label: { he: g.he, en: g.en } as Bi, icon: g.icon, items: g.items })),
    { id: "task", label: { he: "משימות מהלוח", en: "Board tasks" }, icon: "ClipboardList", items: taskItems },
  ];
  const votedCount = Object.keys(mine).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...glassCard(), display: "flex", alignItems: "flex-start", gap: 10 }}>
        <VoteIcon size={16} color={C.gold} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: C.text, marginBottom: 4 }}>
            {he ? "הצבעה על המערכת כולה" : "Vote on the whole system"}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: C.muted }}>
            {canVote
              ? (he ? "מסכים ומשימות — שיפוט: 👍 מאשר · ✎ צריך שינוי · 👎 דוחה. החלטות — בחירה אמיתית: בחרו אחת מהאפשרויות המתחרות. הערה לא חובה, אפשר לשנות או להימנע בכל עת."
                    : "Screens + tasks are a judgement: 👍 approve · ✎ needs-change · 👎 reject. Decisions are a real pick: choose ONE of the competing options. Comment optional; change or abstain anytime.")
              : (he ? "תצוגה בלבד — ההצבעה שמורה לבעלים/מנהלים. אפשר לראות היכן עומד כל פריט." : "Read-only — casting is for owners/admins. You can see where each item stands.")}
          </p>
          {canVote && <div style={{ marginTop: 8 }}><StatusChip label={he ? `הצבעת על ${votedCount} פריטים` : `You've voted on ${votedCount}`} color={C.gold} /></div>}
        </div>
      </div>

      {groups.map((g) => g.items.length > 0 && (
        <div key={g.id} style={glassCard()}>
          <SectionTitle icon={(() => { const GI = ICON[g.icon] || Diamond; return <GI size={16} color={C.gold} />; })()}>
            {bi(g.label)} <span style={{ fontSize: 12, color: C.faint, fontWeight: 700 }}>· {g.items.length}</span>
          </SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: g.id === "decision" ? 14 : 10 }}>
            {g.items.map((it) => (
              it.type === "decision"
                ? <DecisionCard key={it.key} item={it} tally={tallies[it.key]} mine={mine[it.key]} canVote={canVote} he={he} rtl={rtl} bi={bi} />
                : <VoteRow key={it.key} item={it} tally={tallies[it.key]} mine={mine[it.key]} canVote={canVote} he={he} rtl={rtl} bi={bi} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// A SCREEN/TASK votable item — title + desc, live approve/change/reject tally + voters,
// and (owners) the cast row with Abstain.
function VoteRow({ item, tally, mine, canVote, he, rtl, bi }: {
  item: VoteItem; tally?: VoteTally; mine?: VoteMine;
  canVote: boolean; he: boolean; rtl: boolean; bi: (b: Bi) => string;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState(mine?.comment || "");
  const [showComment, setShowComment] = useState(false);
  const [showVoters, setShowVoters] = useState(false);
  React.useEffect(() => { setComment(mine?.comment || ""); }, [mine?.comment]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["pmVotes"] }); qc.invalidateQueries({ queryKey: ["pmVoteResults"] }); };
  const cast = useMutation({
    mutationFn: (vote: VoteKind) => api.castVote({ itemKey: item.key, itemType: item.type, vote, comment }),
    onSuccess: invalidate,
  });
  const withdraw = useMutation({ mutationFn: () => api.withdrawVote(item.key), onSuccess: invalidate });

  const Icon = ICON[item.icon] || Diamond;
  const total = tally?.total || 0;
  const voters = tally?.voters || [];
  const desc = bi(item.desc);
  const myChip = mine?.vote === "abstain"
    ? <StatusChip label={`${ABSTAIN.emoji} ${he ? ABSTAIN.he : ABSTAIN.en}`} color={C.faint} />
    : (() => { const c = voteChoice(mine?.vote); return c ? <StatusChip label={`${c.emoji} ${he ? c.he : c.en}`} color={voteColor(c.key)} /> : null; })();

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: C.glass, border: `1px solid ${C.glassBd}` }}>
          <Icon size={15} color={C.gold} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{bi(item.title)}</span>
            {myChip}
          </div>
          {desc && <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.5, color: C.muted }}>{desc}</p>}
        </div>
      </div>

      <div style={{ marginTop: 11, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}><TallyBar t={tally} /></div>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.faint, minWidth: 46, textAlign: "end" }}>
          {total ? `${total} ${he ? "קולות" : "votes"}` : (he ? "אין קולות" : "no votes")}
        </span>
      </div>
      <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {VOTE_CHOICES.map((c) => (
          <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, color: voteColor(c.key) }}>
            {c.emoji} {tally ? tally[c.key] : 0}
          </span>
        ))}
        {!!(tally?.abstain) && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 800, color: C.faint }}>
            {ABSTAIN.emoji} {tally.abstain}
          </span>
        )}
        {voters.length > 0 && (
          <button onClick={() => setShowVoters((v) => !v)} className="tap44" style={{ marginInlineStart: "auto", background: "none", border: "none", color: C.gold, fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: UI, display: "inline-flex", alignItems: "center", gap: 4 }}>
            {he ? "מי הצביע" : "Who voted"} <ChevronDown size={13} style={{ transform: showVoters ? "rotate(180deg)" : "none" }} />
          </button>
        )}
      </div>

      {showVoters && voters.length > 0 && (
        <ul style={{ margin: "9px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {voters.map((v, i) => { const c = voteChoice(v.vote); const ab = v.vote === "abstain"; return (
            <li key={i} style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "flex-start", gap: 7 }}>
              <span style={{ color: ab ? C.faint : (c ? voteColor(c.key) : C.faint) }}>{ab ? ABSTAIN.emoji : c?.emoji}</span>
              <span style={{ fontWeight: 800, color: C.text }}>{v.voter}</span>
              {v.comment && <span style={{ color: C.faint }}>— {v.comment}</span>}
            </li>
          ); })}
        </ul>
      )}

      {canVote && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {VOTE_CHOICES.map((c) => {
              const active = mine?.vote === c.key;
              const col = voteColor(c.key);
              return (
                <button key={c.key} onClick={() => cast.mutate(c.key)} disabled={cast.isPending} className="tap44"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800,
                    color: active ? ONACCENT : col, background: active ? col : `${col}1a`, border: `1px solid ${active ? col : `${col}55`}`,
                    boxShadow: active ? C.glassHi : "none" }}>
                  <span>{c.emoji}</span> {he ? c.he : c.en}
                </button>
              );
            })}
            <button onClick={() => cast.mutate("abstain")} disabled={cast.isPending} className="tap44"
              title={he ? "נמנע" : "Abstain"}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800,
                color: mine?.vote === "abstain" ? C.text : C.muted, background: C.surface2, border: `1px solid ${mine?.vote === "abstain" ? C.faint : C.line}` }}>
              <Ban size={14} /> {he ? "נמנע" : "Abstain"}
            </button>
            <button onClick={() => setShowComment((s) => !s)} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800, color: C.muted, background: C.surface2, border: `1px solid ${C.line}` }}>
              <MessageSquare size={14} /> {he ? "הערה" : "Comment"}
            </button>
            {mine && (
              <button onClick={() => withdraw.mutate()} disabled={withdraw.isPending} className="tap44"
                style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800, color: C.muted, background: "none", border: `1px solid ${C.line}` }}>
                <X size={13} /> {he ? "משוך הצבעה" : "Withdraw"}
              </button>
            )}
          </div>
          {showComment && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} dir={rtl ? "rtl" : "ltr"}
                placeholder={he ? "למה? (לא חובה — יישמר עם ההצבעה)" : "Why? (optional — saved with your vote)"}
                style={{ ...input, flex: 1, minWidth: 200, boxSizing: "border-box", fontFamily: UI, lineHeight: 1.5, resize: "vertical" }} />
              {mine && (
                <button onClick={() => cast.mutate(mine.vote)} disabled={cast.isPending} style={btn(true)}>
                  {cast.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור הערה" : "Save comment"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A DECISION card — the question + competing OPTIONS as radio-style cards (skin-accent
// fill on your pick), live per-option tally bars + winner, comment + abstain + withdraw.
function DecisionCard({ item, tally, mine, canVote, he, rtl, bi }: {
  item: VoteItem; tally?: VoteTally; mine?: VoteMine;
  canVote: boolean; he: boolean; rtl: boolean; bi: (b: Bi) => string;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState(mine?.comment || "");
  const [showComment, setShowComment] = useState(false);
  const [showVoters, setShowVoters] = useState(false);
  React.useEffect(() => { setComment(mine?.comment || ""); }, [mine?.comment]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["pmVotes"] }); qc.invalidateQueries({ queryKey: ["pmVoteResults"] }); };
  const pick = useMutation({
    mutationFn: (choice: string) => api.castVote({ itemKey: item.key, itemType: "decision", vote: "option", choice, comment }),
    onSuccess: invalidate,
  });
  const abstainM = useMutation({
    mutationFn: () => api.castVote({ itemKey: item.key, itemType: "decision", vote: "abstain", comment }),
    onSuccess: invalidate,
  });
  const withdraw = useMutation({ mutationFn: () => api.withdrawVote(item.key), onSuccess: invalidate });

  const Icon = ICON[item.icon] || Diamond;
  const voters = tally?.voters || [];
  const myPick = mine?.vote === "option" ? (mine.choice || null) : null;
  const isAbstain = mine?.vote === "abstain";
  const myOpt = voteOption(item, myPick);
  const busy = pick.isPending || abstainM.isPending;

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 15px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", background: C.glass, border: `1px solid ${C.glassBd}` }}>
          <Icon size={16} color={C.gold} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{bi(item.title)}</span>
            {myOpt && <StatusChip label={`✓ ${bi(myOpt.label)}`} color={C.gold} />}
            {isAbstain && <StatusChip label={`${ABSTAIN.emoji} ${he ? ABSTAIN.he : ABSTAIN.en}`} color={C.faint} />}
          </div>
          <p style={{ margin: "5px 0 0", fontSize: 12.5, fontWeight: 700, color: C.text, lineHeight: 1.45 }}>{bi(item.question || item.title)}</p>
          {bi(item.desc) && <p style={{ margin: "3px 0 0", fontSize: 11.5, color: C.muted, lineHeight: 1.45 }}>{bi(item.desc)}</p>}
        </div>
      </div>

      {/* Option cards — the real pick (owners cast; a partner would see just the tally below) */}
      {canVote && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {(item.options || []).map((opt) => {
            const picked = myPick === opt.id;
            const od = bi(opt.desc);
            return (
              <button key={opt.id} onClick={() => pick.mutate(opt.id)} disabled={busy} className="tap44"
                style={{ width: "100%", textAlign: rtl ? "right" : "left", display: "flex", alignItems: "center", gap: 10,
                  borderRadius: 12, padding: "11px 13px", cursor: "pointer", fontFamily: UI,
                  background: picked ? C.accentGrad : C.glass, color: picked ? ONACCENT : C.text,
                  border: `1.5px solid ${picked ? "transparent" : C.line}`, boxShadow: picked ? C.glassHi : "none",
                  transition: "background .15s ease" }}>
                {picked ? <CheckCircle2 size={18} color={ONACCENT} style={{ flexShrink: 0 }} /> : <Circle size={18} color={C.faint} style={{ flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 800 }}>{bi(opt.label)}</span>
                  {od && <span style={{ display: "block", fontSize: 11.5, marginTop: 2, lineHeight: 1.4, color: picked ? ONACCENT : C.muted, opacity: picked ? 0.82 : 1 }}>{od}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Live per-option tally */}
      <div style={{ marginTop: 13, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
        <OptionTally item={item} tally={tally} bi={bi} he={he} />
      </div>

      {/* Actions + comment (owners) */}
      {canVote && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => abstainM.mutate()} disabled={busy} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800,
                color: isAbstain ? C.text : C.muted, background: C.surface2, border: `1px solid ${isAbstain ? C.faint : C.line}` }}>
              <Ban size={14} /> {he ? "נמנע" : "Abstain"}
            </button>
            <button onClick={() => setShowComment((s) => !s)} className="tap44"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800, color: C.muted, background: C.surface2, border: `1px solid ${C.line}` }}>
              <MessageSquare size={14} /> {he ? "הערה" : "Comment"}
            </button>
            {voters.length > 0 && (
              <button onClick={() => setShowVoters((v) => !v)} className="tap44" style={{ background: "none", border: "none", color: C.gold, fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: UI, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {he ? "מי הצביע" : "Who voted"} <ChevronDown size={13} style={{ transform: showVoters ? "rotate(180deg)" : "none" }} />
              </button>
            )}
            {mine && (
              <button onClick={() => withdraw.mutate()} disabled={withdraw.isPending} className="tap44"
                style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 12, padding: "8px 13px", cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 800, color: C.muted, background: "none", border: `1px solid ${C.line}` }}>
                <X size={13} /> {he ? "משוך הצבעה" : "Withdraw"}
              </button>
            )}
          </div>
          {showComment && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} dir={rtl ? "rtl" : "ltr"}
                placeholder={he ? "למה? (לא חובה — יישמר עם הבחירה)" : "Why? (optional — saved with your pick)"}
                style={{ ...input, flex: 1, minWidth: 200, boxSizing: "border-box", fontFamily: UI, lineHeight: 1.5, resize: "vertical" }} />
              {myPick && (
                <button onClick={() => pick.mutate(myPick)} disabled={busy} style={btn(true)}>
                  {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור הערה" : "Save comment"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {showVoters && voters.length > 0 && (
        <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {voters.map((v, i) => {
            const vo = v.vote === "option" ? voteOption(item, v.choice) : null;
            const label = v.vote === "abstain" ? `${ABSTAIN.emoji} ${he ? ABSTAIN.he : ABSTAIN.en}` : (vo ? `→ ${bi(vo.label)}` : "");
            return (
              <li key={i} style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "flex-start", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 800, color: C.text }}>{v.voter}</span>
                <span style={{ color: C.gold, fontWeight: 700 }}>{label}</span>
                {v.comment && <span style={{ color: C.faint }}>— {v.comment}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ══ RESULTS tab — aggregate tallies + overall consensus + the "needs work" pipeline ═══
function Results({ bi, he, rtl, canPromote }: { bi: (b: Bi) => string; he: boolean; rtl: boolean; canPromote: boolean }) {
  const q = useQuery({ queryKey: ["pmVoteResults"], queryFn: () => api.voteResults(), staleTime: 10000 });
  const vq = useQuery({ queryKey: ["pmVotes"], queryFn: () => api.votesData(), staleTime: 10000 });
  if (q.isLoading) return <Centered><Loader2 size={22} className="spin" color={C.gold} /></Centered>;
  const data = (q.data || { items: [], overall: { approvalPct: 0, totalVotes: 0, itemsVoted: 0, decisionsCount: 0, needsWorkCount: 0 }, decisions: [], needsWork: [], linked: {} }) as VoteResults;

  // Titles: screens/decisions from the catalog; board tasks from the votes API.
  const taskTitles: Record<string, Bi> = {};
  ((vq.data as VotesData | undefined)?.taskItems || []).forEach((t) => { taskTitles[t.key] = { he: t.titleHe || t.titleEn, en: t.titleEn || t.titleHe }; });
  const titleFor = (it: VoteTally): string => {
    const cat = voteItemByKey(it.itemKey);
    if (cat) return bi(cat.title);
    if (taskTitles[it.itemKey]) return bi(taskTitles[it.itemKey]);
    return it.itemKey;
  };
  const o = data.overall;

  if (o.totalVotes === 0) {
    return (
      <div style={{ ...glassCard(), textAlign: "center", padding: "34px 18px" }}>
        <Trophy size={26} color={C.gold} style={{ marginBottom: 10 }} />
        <div style={{ fontSize: 14.5, fontWeight: 900, color: C.text, marginBottom: 6 }}>{he ? "אין עדיין תוצאות" : "No results yet"}</div>
        <p style={{ margin: 0, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
          {he ? "ברגע שהבעלים יצביעו על פריטים, כאן יופיעו התוצאות המצטברות ורשימת \"דורש עבודה\"." : "Once owners vote on items, the aggregated results + \"needs work\" list appear here."}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={glassCard()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <Trophy size={18} color={C.gold} />
          <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "קונצנזוס כולל (אישור)" : "Overall consensus (approval)"}</span>
          <span style={{ marginInlineStart: "auto", fontSize: 30, fontWeight: 900, color: C.gold, letterSpacing: "-0.02em" }}>{o.approvalPct}%</span>
        </div>
        <Bar pct={o.approvalPct} h={11} />
        <div style={{ marginTop: 12, display: "flex", gap: 22, flexWrap: "wrap" }}>
          <Metric label={he ? "פריטים שהוצבעו" : "Items voted"} value={o.itemsVoted} />
          <Metric label={he ? "סה\"כ קולות" : "Total votes"} value={o.totalVotes} />
          <Metric label={he ? "החלטות שהוכרעו" : "Decisions"} value={o.decisionsCount} />
          <Metric label={he ? "דורש עבודה" : "Needs work"} value={o.needsWorkCount} tone={o.needsWorkCount ? "warn" : "ok"} />
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: C.faint, lineHeight: 1.45 }}>
          {he ? "אחוז האישור מחושב על מסכים ומשימות (מאשר מתוך מאשר/צריך שינוי/דוחה). החלטות מוכרעות לפי האפשרות המובילה." : "Approval % is over screens + tasks (approve of approve/change/reject). Decisions are settled by their leading option."}
        </p>
      </div>

      {/* DECISIONS — the winning option per decision + per-option bars */}
      {data.decisions.length > 0 && (
        <div style={glassCard()}>
          <SectionTitle icon={<Milestone size={16} color={C.gold} />}>
            {he ? "הכרעות" : "Decisions"} <span style={{ fontSize: 12, color: C.faint, fontWeight: 700 }}>· {data.decisions.length}</span>
          </SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.decisions.map((it) => {
              const cat = voteItemByKey(it.itemKey);
              const winner = voteOption(cat, it.top);
              return (
                <div key={it.itemKey}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{titleFor(it)}</span>
                    {winner && <StatusChip label={`🏆 ${bi(winner.label)} · ${it.topPct}%`} color={C.gold} />}
                  </div>
                  {cat ? <OptionTally item={cat} tally={it} bi={bi} he={he} />
                    : <div style={{ fontSize: 12, color: C.faint }}>{it.picks} {he ? "בחירות" : "picks"}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={glassCard()}>
        <SectionTitle icon={<CircleAlert size={16} color={C.loss} />}>
          {he ? "דורש עבודה" : "Needs work"} <span style={{ fontSize: 12, color: C.faint, fontWeight: 700 }}>· {data.needsWork.length}</span>
        </SectionTitle>
        {data.needsWork.length === 0 ? (
          <div style={{ fontSize: 13, color: C.faint, display: "flex", alignItems: "center", gap: 8 }}>
            <Check size={15} color={C.gain} /> {he ? "אין פריטים שדורשים עבודה — הכול אושר." : "Nothing flagged — all clear."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.needsWork.map((it) => (
              <NeedsWorkRow key={it.itemKey} it={it} title={titleFor(it)} linkedTaskId={data.linked[it.itemKey]} canPromote={canPromote} he={he} />
            ))}
          </div>
        )}
      </div>

      <div style={glassCard()}>
        <SectionTitle icon={<BarChart3 size={16} color={C.gold} />}>{he ? "מסכים ומשימות" : "Screens + tasks"}</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.items.filter((it) => it.itemType !== "decision").map((it) => {
            const c = it.consensus ? voteChoice(it.consensus) : null;
            return (
              <div key={it.itemKey}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{titleFor(it)}</span>
                  {c && it.consensus && <StatusChip label={`${c.emoji} ${he ? c.he : c.en}`} color={voteColor(it.consensus)} />}
                  <span style={{ marginInlineStart: "auto", fontSize: 12, fontWeight: 800, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{it.approvalPct}%</span>
                </div>
                <TallyBar t={it} />
              </div>
            );
          })}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 11.5, color: C.faint, lineHeight: 1.6, textAlign: "center" }}>
        {he ? "מסך שקיבל \"צריך שינוי/דוחה\" ניתן להפוך למשימה בלוח — כך תוצאות ההצבעה מזינות את ההמשך." : "A change/reject screen can become a board task — so the vote outcomes feed continued work."}
      </p>
    </div>
  );
}

// One prioritized "needs work" row → can be promoted onto the PM board (owners/admin).
function NeedsWorkRow({ it, title, linkedTaskId, canPromote, he }: {
  it: VoteTally; title: string; linkedTaskId?: number; canPromote: boolean; he: boolean;
}) {
  const qc = useQueryClient();
  const onBoard = it.itemType === "task" || typeof linkedTaskId === "number";
  const promote = useMutation({
    mutationFn: () => {
      const cat = voteItemByKey(it.itemKey);
      return api.promoteVote({ itemKey: it.itemKey, itemType: it.itemType, titleHe: cat?.title.he || title, titleEn: cat?.title.en || title });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pmVoteResults"] });
      qc.invalidateQueries({ queryKey: ["pmBoard"] });
      qc.invalidateQueries({ queryKey: ["pmVotes"] });
    },
  });
  const comments = it.voters.filter((v) => v.comment);
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text, flex: 1, minWidth: 140 }}>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: voteColor("change") }}>✎ {it.change}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: voteColor("reject") }}>👎 {it.reject}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: voteColor("approve") }}>👍 {it.approve}</span>
        </span>
      </div>
      <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}><TallyBar t={it} /></div>
        {onBoard ? (
          <StatusChip label={he ? "בלוח" : "On board"} color={C.gain} />
        ) : canPromote ? (
          <button onClick={() => promote.mutate()} disabled={promote.isPending} style={{ ...btn(true), padding: "7px 12px" }}>
            {promote.isPending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {he ? "צור משימה" : "Create task"}
          </button>
        ) : null}
      </div>
      {comments.length > 0 && (
        <ul style={{ margin: "9px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
          {comments.map((v, i) => (
            <li key={i} style={{ fontSize: 11.5, color: C.faint, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 800, color: C.muted }}>{v.voter}</span> — {v.comment}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── shared exports (consumed by Owners.tsx shell + Portal.tsx collaborator portals) ──
export { ICON, Centered, glassCard, PortalHeader, PortalTabs, BackRow, PersonalScreen, Results, Daily, Overview, Team, Board, Vote, Progress, Guide };
export type { Tab };
