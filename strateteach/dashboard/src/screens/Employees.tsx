import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users, ArrowRight, ArrowLeft, Loader2, Plus, Pencil, Trash2, Check, X, Save,
  Wallet, ListChecks, ExternalLink, UserPlus, Copy, Link2, Gift, TrendingUp, Coins, KeyRound,
} from "lucide-react";
import { api } from "../app/api";
import { C, SHADOW, MONO } from "../theme";
import { input, btn } from "../ui";
import { PriorityChip } from "../components/Priority";
import BonusProgramDefEditor from "../components/BonusProgramDefEditor";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import type { Employee, EmployeePayment, PmTask } from "../lib/client";

// ── Employee Management — owner-only "ניהול עובדים" tab in /owners (Phase 1, piece 2).
// A grid of employee cards → a clean edit panel per employee (role / domains / status / salary /
// bonus / portal, the payments ledger, and a read-only view of their PM tasks). Peach design.

const STATUS: Record<string, { he: string; en: string; c: () => string }> = {
  active:     { he: "פעיל",   en: "Active",     c: () => C.gain },
  onboarding: { he: "בקליטה", en: "Onboarding", c: () => C.gold },
  paused:     { he: "מושהה",  en: "Paused",     c: () => C.faint },
};
const STATUS_KEYS = ["active", "onboarding", "paused"];
const PTYPE: Record<string, { he: string; en: string }> = {
  salary:   { he: "משכורת", en: "Salary" },
  bonus:    { he: "בונוס",  en: "Bonus" },
  expense:  { he: "הוצאה",  en: "Expense" },
  addition: { he: "תוספת",  en: "Addition" },
};
const PTYPE_KEYS = ["salary", "bonus", "expense", "addition"];
const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function StatusBadge({ status, he }: { status: string; he: boolean }) {
  const s = STATUS[status] || STATUS.active; const col = s.c();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: col,
      background: `${col}1a`, border: `1px solid ${col}55`, borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: col }} /> {he ? s.he : s.en}
    </span>
  );
}

function Ava({ name, avatar, size = 44 }: { name: string; avatar?: string; size?: number }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return avatar
    ? <img src={avatar} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: `1px solid ${C.line}` }} />
    : <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
        background: C.accentGrad, color: "#0B0613", fontSize: size * 0.42, fontWeight: 900 }}>{initial}</span>;
}

function DomainChips({ domains }: { domains: string[] }) {
  if (!domains || domains.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {domains.map((d) => (
        <span key={d} style={{ fontSize: 10, fontWeight: 700, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "1px 6px" }}>{d}</span>
      ))}
    </span>
  );
}

export default function Employees({ he, rtl }: { he: boolean; rtl: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  return sel
    ? <EmployeeDetail username={sel} he={he} rtl={rtl} onBack={() => setSel(null)} />
    : <EmployeeGrid he={he} rtl={rtl} onOpen={setSel} />;
}

// ── the card grid ───────────────────────────────────────────────────────────────
function EmployeeGrid({ he, rtl, onOpen }: { he: boolean; rtl: boolean; onOpen: (u: string) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Shared rows/squares view toggle (default cards — the roster was a card grid before).
  const [view, setView] = useViewMode("algo770_employees_view_v1", "cards");
  const q = useQuery({ queryKey: ["employees"], queryFn: () => api.employees(), staleTime: 20000 });
  const emps = (q.data?.employees || []) as Employee[];
  if (q.isLoading) return <div style={{ padding: 30, textAlign: "center" }}><Loader2 size={22} className="spin" color={C.gold} /></div>;

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Users size={17} color={C.gold} />
        <span style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{he ? "ניהול עובדים" : "Employee management"}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.faint }}>· {emps.length}</span>
        <ViewToggle view={view} onChange={setView} he={he} style={{ marginInlineStart: adding ? "auto" : 0 }} />
        {!adding && (
          <button onClick={() => setAdding(true)} style={btn(true)}>
            <UserPlus size={15} /> {he ? "עובד חדש" : "Add employee"}
          </button>
        )}
      </div>
      {adding && <AddEmployeeForm he={he} rtl={rtl} onClose={() => setAdding(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["employees"] })} />}

      {/* Bonus-program definition — owner preview + edit of what employees see on the join screen */}
      <div style={{ marginBottom: 14 }}><BonusProgramDefEditor he={he} rtl={rtl} /></div>

      <div style={{ display: "grid", gridTemplateColumns: view === "cards" ? "repeat(auto-fill, minmax(280px, 1fr))" : "1fr", gap: 14 }}>
        {emps.map((e) => (
          <button key={e.username} onClick={() => onOpen(e.username)} className="tap44"
            style={{ textAlign: "start", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16,
              boxShadow: SHADOW, cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <Ava name={e.name} avatar={e.avatar} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{e.name}</span>
                  <StatusBadge status={e.status} he={he} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, marginTop: 1 }}>{e.role || (he ? "— ללא תפקיד —" : "— no role —")}</div>
              </div>
            </div>
            <DomainChips domains={e.workDomains} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11.5, color: C.muted, marginTop: 2 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Wallet size={12} color={C.gold} /> {money(e.monthlySalary)}/{he ? "חודש" : "mo"}{e.bonusAccount ? (he ? " · בונוס" : " · bonus") : ""}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><ListChecks size={12} color={C.gold} /> {e.taskCount} {he ? "משימות" : "tasks"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 9 }}>
              <span style={{ fontSize: 11, color: C.faint }}>
                {he ? "שולם" : "Paid"} <b style={{ color: C.gain }}>{money(e.payments.paid)}</b>
                {e.payments.pending ? <> · {he ? "ממתין" : "Pending"} <b style={{ color: C.gold }}>{money(e.payments.pending)}</b></> : null}
              </span>
              {e.bonusProgramStatus === "requested"
                ? <span style={{ fontSize: 10.5, fontWeight: 800, color: C.gold, display: "inline-flex", alignItems: "center", gap: 3 }}><Gift size={11} /> {he ? "בקשה לבונוס" : "Bonus request"}</span>
                : e.bonusProgramStatus === "active"
                ? <span style={{ fontSize: 10.5, fontWeight: 800, color: C.gain, display: "inline-flex", alignItems: "center", gap: 3 }}><Gift size={11} /> {he ? "בונוס פעיל" : "Bonus active"}</span>
                : e.portalDomain
                ? <span style={{ fontSize: 10.5, fontWeight: 800, color: C.gold, display: "inline-flex", alignItems: "center", gap: 3 }}><ExternalLink size={11} /> {e.portalDomain === "legal" ? (he ? "פורטל משפטי" : "Legal") : e.portalDomain === "it" ? (he ? "פורטל IT" : "IT") : (he ? "פיתוח עסקי" : "Biz Dev")}</span>
                : e.hasPortal ? <span style={{ fontSize: 10.5, fontWeight: 800, color: C.muted }}>{he ? "יש פורטל" : "Portal"}</span> : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── the per-employee edit panel ──────────────────────────────────────────────────
function EmployeeDetail({ username, he, rtl, onBack }: { username: string; he: boolean; rtl: boolean; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["employee", username], queryFn: () => api.employee(username) });
  const emp = q.data?.employee;
  const payments = (q.data?.payments || []) as EmployeePayment[];
  const tasks = (q.data?.tasks || []) as PmTask[];

  // editable owner fields (initialised once loaded)
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [domains, setDomains] = useState("");
  const [status, setStatus] = useState("active");
  const [salary, setSalary] = useState("0");
  const [bonus, setBonus] = useState(false);
  const [hasPortal, setHasPortal] = useState(false);
  const [joinDate, setJoinDate] = useState("");
  const [loaded, setLoaded] = useState(false);
  React.useEffect(() => {
    if (emp && !loaded) {
      setFullName(emp.fullName || (emp.name !== emp.username ? emp.name : ""));
      setRole(emp.role); setDomains((emp.workDomains || []).join(", ")); setStatus(emp.status);
      setSalary(String(emp.monthlySalary || 0)); setBonus(emp.bonusAccount); setHasPortal(emp.hasPortal);
      setJoinDate(emp.joinDate || ""); setLoaded(true);
    }
  }, [emp, loaded]);

  const inval = () => { qc.invalidateQueries({ queryKey: ["employee", username] }); qc.invalidateQueries({ queryKey: ["employees"] }); };
  const save = useMutation({
    mutationFn: () => api.employeeUpdate(username, {
      fullName, role, workDomains: domains.split(",").map((d) => d.trim()).filter(Boolean) as any,
      status: status as any, monthlySalary: Number(salary) || 0, bonusAccount: bonus, hasPortal, joinDate,
    }),
    onSuccess: inval,
  });
  const [delErr, setDelErr] = useState("");
  const del = useMutation({
    mutationFn: () => api.employeeDelete(username),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); onBack(); },
    onError: (e: any) => setDelErr(e?.message || String(e)),
  });
  const canDelete = username !== "admin"; // founder/main admin guarded (backend enforces too)

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const sel: React.CSSProperties = { ...input, cursor: "pointer", padding: "9px 11px" };

  if (q.isLoading || !emp) return <div style={{ padding: 30, textAlign: "center" }}><Loader2 size={22} className="spin" color={C.gold} /></div>;

  return (
    <div style={{ direction: rtl ? "rtl" : "ltr", display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={onBack} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", color: C.gold, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
        {rtl ? <ArrowRight size={15} /> : <ArrowLeft size={15} />} {he ? "לכל העובדים" : "All employees"}
      </button>

      {/* header + owner-editable fields */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <Ava name={emp.name} avatar={emp.avatar} size={52} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{emp.name}</span>
              <StatusBadge status={emp.status} he={he} />
            </div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>@{emp.username}</div>
          </div>
          {emp.portalDomain && (
            <a href={emp.portalDomain === "legal" ? "/legal-portal" : emp.portalDomain === "it" ? "/it-portal" : "/biz-portal"} style={{ ...btn(false), textDecoration: "none" }}>
              <ExternalLink size={14} /> {emp.portalDomain === "legal" ? (he ? "פורטל משפטי" : "Legal portal") : emp.portalDomain === "it" ? (he ? "פורטל IT" : "IT portal") : (he ? "פורטל פיתוח עסקי" : "Business Dev portal")}
            </a>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <div><label style={lbl}>{he ? "שם מלא" : "Full name"}</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} dir={rtl ? "rtl" : "ltr"} placeholder={emp.name} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={lbl}>{he ? "תפקיד" : "Role"}</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} dir={rtl ? "rtl" : "ltr"} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={lbl}>{he ? "תחומי עבודה (מופרד בפסיק)" : "Work domains (comma-separated)"}</label>
            <input value={domains} onChange={(e) => setDomains(e.target.value)} dir={rtl ? "rtl" : "ltr"} placeholder="development, infra…" style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={lbl}>{he ? "סטטוס" : "Status"}</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...sel, width: "100%" }}>
              {STATUS_KEYS.map((k) => <option key={k} value={k}>{he ? STATUS[k].he : STATUS[k].en}</option>)}
            </select></div>
          <div><label style={lbl}>{he ? "משכורת חודשית ($)" : "Monthly salary ($)"}</label>
            <input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
          <div><label style={lbl}>{he ? "תאריך הצטרפות" : "Join date"}</label>
            <input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} style={{ ...input, width: "100%", boxSizing: "border-box" }} /></div>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
          <Toggle on={bonus} onToggle={() => setBonus((v) => !v)} label={he ? "חשבון בונוס" : "Bonus account"} he={he} />
          <Toggle on={hasPortal} onToggle={() => setHasPortal((v) => !v)} label={he ? "יש פורטל" : "Has portal"} he={he} />
          <button onClick={() => save.mutate()} disabled={save.isPending} style={{ ...btn(true), marginInlineStart: "auto" }}>
            {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}
          </button>
        </div>
        {save.isSuccess && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: C.gain }}>{he ? "נשמר ✓" : "Saved ✓"}</div>}
        {canDelete && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => { setDelErr(""); if (confirm(he ? `למחוק את ${emp.name} לצמיתות? כולל פנקס התשלומים. (רשומת הלוואת הבעלים בכספים תישאר)` : `Delete ${emp.name} permanently? This removes their payments ledger. (Any owners'-loan record in Finance stays.)`)) del.mutate(); }}
              disabled={del.isPending} style={{ ...btn(false), color: C.loss, borderColor: `${C.loss}66` }}>
              {del.isPending ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />} {he ? "מחק עובד" : "Delete employee"}
            </button>
            {delErr && <span style={{ fontSize: 12, fontWeight: 700, color: C.loss }}>{delErr}</span>}
          </div>
        )}
      </div>

      <BonusProgramCard emp={emp} he={he} rtl={rtl} onChanged={inval} />

      <PaymentsSection username={username} payments={payments} he={he} rtl={rtl} onChanged={inval} />

      {/* tasks (read-only) */}
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 12 }}>
          <ListChecks size={16} color={C.gold} /> {he ? "המשימות שלו" : "Their tasks"} <span style={{ color: C.faint, fontWeight: 700 }}>· {tasks.length}</span>
        </div>
        {tasks.length === 0 ? <div style={{ fontSize: 12.5, color: C.faint }}>{he ? "אין משימות משויכות." : "No assigned tasks."}</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {tasks.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 11px", flexWrap: "wrap" }}>
                <PriorityChip priority={t.priority} he={he} />
                <span style={{ flex: 1, minWidth: 120, fontSize: 12.5, fontWeight: 700, color: C.text }}>{he ? t.titleHe : t.titleEn}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{t.progress}%</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: C.faint }}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onToggle, label, he }: { on: boolean; onToggle: () => void; label: string; he: boolean }) {
  return (
    <button onClick={onToggle} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
      <span style={{ width: 40, height: 22, borderRadius: 999, background: on ? C.gain : C.surface2, border: `1px solid ${on ? C.gain : C.line}`, position: "relative", transition: "all .15s" }}>
        <span style={{ position: "absolute", top: 2, [on ? "insetInlineEnd" : "insetInlineStart"]: 2 as any, width: 16, height: 16, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: on ? C.text : C.muted }}>{label}</span>
    </button>
  );
}

// ── the payments ledger (add / edit / delete + summary) ──────────────────────────
function PaymentsSection({ username, payments, he, rtl, onChanged }: { username: string; payments: EmployeePayment[]; he: boolean; rtl: boolean; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const paid = payments.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const pending = payments.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0);
  const del = useMutation({ mutationFn: (id: number) => api.employeeDeletePayment(id), onSuccess: onChanged });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: C.text }}>
          <Wallet size={16} color={C.gold} /> {he ? "תשלומים" : "Payments"}
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.faint }}>· {he ? "שולם" : "paid"} <b style={{ color: C.gain }}>{money(paid)}</b> · {he ? "ממתין" : "pending"} <b style={{ color: C.gold }}>{money(pending)}</b></span>
        </div>
        {!adding && <button onClick={() => { setAdding(true); setEditId(null); }} style={{ ...btn(true) }}><Plus size={15} /> {he ? "תשלום חדש" : "New payment"}</button>}
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 12 }}>{he ? "רישום בלבד — באישור הבעלים. אין העברת כסף אמיתי." : "Records only — owner approval. No real money movement."}</div>

      {adding && <PaymentForm username={username} he={he} rtl={rtl} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}

      {payments.length === 0 && !adding ? <div style={{ fontSize: 12.5, color: C.faint }}>{he ? "אין עדיין תשלומים." : "No payments yet."}</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: adding ? 10 : 0 }}>
          {payments.map((p) => editId === p.id ? (
            <PaymentForm key={p.id} username={username} payment={p} he={he} rtl={rtl} onDone={() => { setEditId(null); onChanged(); }} onCancel={() => setEditId(null)} />
          ) : (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: C.text, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 9px" }}>{he ? (PTYPE[p.type]?.he || p.type) : (PTYPE[p.type]?.en || p.type)}</span>
              <span style={{ fontSize: 13.5, fontWeight: 900, color: C.gold, fontVariantNumeric: "tabular-nums" }}>{money(p.amount)}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: p.status === "paid" ? C.gain : C.gold }}>{p.status === "paid" ? (he ? "שולם" : "Paid") : (he ? "ממתין" : "Pending")}</span>
              <span style={{ fontSize: 11, color: C.faint }}>{p.date || "—"}</span>
              {p.note && <span style={{ flex: 1, minWidth: 80, fontSize: 11.5, color: C.muted }}>{p.note}</span>}
              <span style={{ display: "inline-flex", gap: 6, marginInlineStart: "auto" }}>
                <button onClick={() => { setEditId(p.id); setAdding(false); }} title={he ? "עריכה" : "Edit"} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer" }}><Pencil size={13} /></button>
                <button onClick={() => del.mutate(p.id)} disabled={del.isPending} title={he ? "מחק" : "Delete"} style={{ background: "none", border: "none", color: C.loss, cursor: "pointer" }}><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PaymentForm({ username, payment, he, rtl, onDone, onCancel }: { username: string; payment?: EmployeePayment; he: boolean; rtl: boolean; onDone: () => void; onCancel: () => void }) {
  const isNew = !payment;
  const [type, setType] = useState(payment?.type || "salary");
  const [amount, setAmount] = useState(String(payment?.amount ?? ""));
  const [date, setDate] = useState(payment?.date || "");
  const [status, setStatus] = useState(payment?.status || "pending");
  const [note, setNote] = useState(payment?.note || "");
  const m = useMutation({
    mutationFn: () => {
      const body = { type, amount: Number(amount) || 0, date, status, note };
      return isNew ? api.employeeAddPayment(username, body) : api.employeeUpdatePayment(payment!.id, body as any);
    },
    onSuccess: onDone,
  });
  const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: C.muted, marginBottom: 4, display: "block" };
  const f: React.CSSProperties = { ...input, width: "100%", boxSizing: "border-box", padding: "8px 10px" };
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.gold}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        <div><label style={lbl}>{he ? "סוג" : "Type"}</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)} style={{ ...f, cursor: "pointer" }}>{PTYPE_KEYS.map((k) => <option key={k} value={k}>{he ? PTYPE[k].he : PTYPE[k].en}</option>)}</select></div>
        <div><label style={lbl}>{he ? "סכום ($)" : "Amount ($)"}</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={f} /></div>
        <div><label style={lbl}>{he ? "תאריך" : "Date"}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={f} /></div>
        <div><label style={lbl}>{he ? "סטטוס" : "Status"}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ ...f, cursor: "pointer" }}>
            <option value="pending">{he ? "ממתין" : "Pending"}</option><option value="paid">{he ? "שולם" : "Paid"}</option>
          </select></div>
      </div>
      <div><label style={lbl}>{he ? "הערה" : "Note"}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} dir={rtl ? "rtl" : "ltr"} style={f} /></div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => m.mutate()} disabled={m.isPending} style={{ ...btn(true) }}>{m.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {he ? "שמור" : "Save"}</button>
        <button onClick={onCancel} style={{ ...btn(false) }}><X size={14} /> {he ? "ביטול" : "Cancel"}</button>
      </div>
    </div>
  );
}

// ── Bonus / sub-account trading program (owner side, Phase 3) ──────────────────────
const BONUS_STATUS: Record<string, { he: string; en: string; c: () => string }> = {
  none:      { he: "לא הצטרף",       en: "Not joined",       c: () => C.faint },
  requested: { he: "ממתין לאישור",   en: "Pending approval", c: () => C.gold },
  active:    { he: "פעיל",           en: "Active",           c: () => C.gain },
  paused:    { he: "מושהה",          en: "Paused",           c: () => C.muted },
};
const BONUS_STATUS_KEYS = ["none", "requested", "active", "paused"];

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 96 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: C.faint }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color: color || C.text, fontFamily: MONO }}>{value}</div>
    </div>
  );
}

function BonusProgramCard({ emp, he, rtl, onChanged }: { emp: Employee; he: boolean; rtl: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState(emp.bonusProgramStatus || "none");
  const [copied, setCopied] = useState(false);
  const save = useMutation({ mutationFn: () => api.employeeUpdate(emp.username, { bonusProgramStatus: status as any }), onSuccess: onChanged });
  const pr = emp.program;
  const savedSt = BONUS_STATUS[emp.bonusProgramStatus] || BONUS_STATUS.none;
  const copyWallet = () => { if (emp.walletAddress) { navigator.clipboard?.writeText(emp.walletAddress); setCopied(true); setTimeout(() => setCopied(false), 1800); } };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };

  return (
    <div style={{ background: `linear-gradient(165deg, ${C.surface} 0%, ${C.gold}0d 100%)`, border: `1px solid ${C.gold}55`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Gift size={17} color={C.gold} />
        <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "תוכנית בונוס / תת-חשבון" : "Bonus / sub-account program"}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: savedSt.c(), background: `${savedSt.c()}1a`, border: `1px solid ${savedSt.c()}55`, borderRadius: 999, padding: "2px 9px" }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: savedSt.c() }} /> {he ? savedSt.he : savedSt.en}
        </span>
      </div>

      {/* the submitted sub-account details + wallet (Phase-1 self-service) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
        <div>
          <label style={lbl}><KeyRound size={12} /> {he ? "פרטי תת-חשבון (שהעובד מסר)" : "Sub-account details (submitted)"}</label>
          <div style={{ fontSize: 12.5, color: emp.subaccountDetails ? C.text : C.faint, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", minHeight: 38, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{emp.subaccountDetails || (he ? "— טרם נמסר —" : "— not submitted —")}</div>
        </div>
        <div>
          <label style={lbl}><Wallet size={12} /> {he ? "כתובת ארנק (שהעובד שלח)" : "Wallet address (submitted)"}</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 8px 6px 11px", minHeight: 38 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: emp.walletAddress ? C.gold : C.faint, fontFamily: MONO, wordBreak: "break-all" }}>{emp.walletAddress || (he ? "— טרם נשלח —" : "— not sent —")}</span>
            {emp.walletAddress && <button onClick={copyWallet} title={he ? "העתק" : "Copy"} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", flexShrink: 0 }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>}
          </div>
        </div>
      </div>

      {/* program capital / P&L readout (populated by pieces 2-4) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 18, padding: "12px 0", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, marginBottom: 14 }}>
        <Stat label={he ? "הפקדה ראשונית (הלוואה)" : "Initial deposit (loan)"} value={money(pr.initialDeposit)} color={C.gold} />
        <Stat label={he ? "בונוסים שנצברו" : "Bonuses accrued"} value={money(pr.bonusAccrued)} color={C.gain} />
        <Stat label={he ? "הון מצטבר" : "Accrued capital"} value={money(pr.capital)} />
        <Stat label={he ? "רווח מסחר (P&L)" : "Trading P&L"} value={money(pr.tradingPnl)} color={pr.tradingPnl >= 0 ? C.gain : C.loss} />
        <Stat label={he ? "שווי כולל" : "Total value"} value={money(pr.totalValue)} color={C.gold} />
      </div>

      {/* record deposit (owners' loan) · manual P&L · monthly bonus */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginBottom: 14 }}>
        <DepositAction emp={emp} he={he} onChanged={onChanged} />
        <PnlAction emp={emp} he={he} onChanged={onChanged} />
        <BonusAction emp={emp} he={he} onChanged={onChanged} />
      </div>
      {pr.bonusHistory.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 6 }}>{he ? "היסטוריית בונוסים" : "Bonus history"} · {money(pr.bonusAccrued)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pr.bonusHistory.map((b) => (
              <span key={b.id} style={{ fontSize: 11, fontWeight: 700, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "3px 9px" }}>
                <b style={{ color: C.gain }}>{money(b.amount)}</b> <span style={{ color: C.faint }}>{b.date || "—"}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* activate / change program status */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 180 }}>
          <label style={lbl}>{he ? "סטטוס התוכנית" : "Program status"}</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ ...input, cursor: "pointer", padding: "9px 11px", width: "100%" }}>
            {BONUS_STATUS_KEYS.map((k) => <option key={k} value={k}>{he ? BONUS_STATUS[k].he : BONUS_STATUS[k].en}</option>)}
          </select>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending || status === emp.bonusProgramStatus} style={{ ...btn(true) }}>
          {save.isPending ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {he ? "עדכן סטטוס" : "Update status"}
        </button>
        {save.isSuccess && <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gain }}>{he ? "עודכן ✓" : "Updated ✓"}</span>}
      </div>
      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 10 }}>{he ? "רישום ומעקב בלבד — המימון בפועל מתבצע ידנית מול הבורסה. אין העברת כספים מהאפליקציה." : "Records & tracking only — actual funding is done manually on the exchange. No money moves from the app."}</div>
    </div>
  );
}

// action-box shared styles
const actBox: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 12px", display: "flex", flexDirection: "column", gap: 7 };
const actLbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.text, display: "inline-flex", alignItems: "center", gap: 6 };
const actNote: React.CSSProperties = { fontSize: 10, color: C.faint, lineHeight: 1.4 };
const actInput: React.CSSProperties = { ...input, flex: 1, minWidth: 0, padding: "7px 9px" };

function DepositAction({ emp, he, onChanged }: { emp: Employee; he: boolean; onChanged: () => void }) {
  const [amount, setAmount] = useState(emp.initialDeposit ? String(emp.initialDeposit) : "");
  const m = useMutation({ mutationFn: () => api.employeeRecordDeposit(emp.username, { amount: Number(amount) || 0 }), onSuccess: onChanged });
  return (
    <div style={actBox}>
      <span style={actLbl}><Coins size={13} color={C.gold} /> {he ? "הפקדה ראשונית (הלוואת בעלים)" : "Initial deposit (owners' loan)"}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" style={actInput} />
        <button onClick={() => m.mutate()} disabled={m.isPending || !(Number(amount) > 0)} style={{ ...btn(true), padding: "7px 12px" }}>
          {m.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {he ? "רשום" : "Record"}
        </button>
      </div>
      <span style={actNote}>{emp.depositInvestmentId
        ? (he ? "נרשם כהלוואת בעלים בכספים ↗" : "Recorded as an owners' loan in Finance ↗")
        : (he ? "יירשם כ'הלוואת בעלים' ויזרום לתקציב." : "Records as 'owners' loan' → flows into the budget.")}</span>
    </div>
  );
}

function PnlAction({ emp, he, onChanged }: { emp: Employee; he: boolean; onChanged: () => void }) {
  const [pnl, setPnl] = useState(String(emp.tradingPnl || 0));
  const m = useMutation({ mutationFn: () => api.employeeUpdate(emp.username, { tradingPnl: Number(pnl) || 0 }), onSuccess: onChanged });
  return (
    <div style={actBox}>
      <span style={actLbl}><TrendingUp size={13} color={C.gold} /> {he ? "רווח מסחר (P&L)" : "Trading P&L"}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="$" style={actInput} />
        <button onClick={() => m.mutate()} disabled={m.isPending} style={{ ...btn(false), padding: "7px 12px" }}>
          {m.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {he ? "שמור" : "Save"}
        </button>
      </div>
      <span style={actNote}>{he ? "נמסר ידנית — תת-החשבון אינו מחובר ב-API." : "Entered manually — the sub-account isn't API-connected."}</span>
    </div>
  );
}

function BonusAction({ emp, he, onChanged }: { emp: Employee; he: boolean; onChanged: () => void }) {
  const [amount, setAmount] = useState("");
  const m = useMutation({
    mutationFn: () => api.employeeAddPayment(emp.username, { type: "bonus", amount: Number(amount) || 0, status: "paid", date: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => { setAmount(""); onChanged(); },
  });
  return (
    <div style={actBox}>
      <span style={actLbl}><Gift size={13} color={C.gold} /> {he ? "בונוס חודשי" : "Monthly bonus"}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" style={actInput} />
        <button onClick={() => m.mutate()} disabled={m.isPending || !(Number(amount) > 0)} style={{ ...btn(true), padding: "7px 12px" }}>
          {m.isPending ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {he ? "צבור" : "Accrue"}
        </button>
      </div>
      <span style={actNote}>{he ? "נכנס לפנקס כ'בונוס' → מצטבר להון (וזורם לשכר)." : "Added as a 'bonus' ledger entry → accrues to capital (+ payroll)."}</span>
    </div>
  );
}

// ── add-employee onboarding form → creates the employee + shows the onboarding LINK ──
function AddEmployeeForm({ he, rtl, onClose, onCreated }: { he: boolean; rtl: boolean; onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [domains, setDomains] = useState("");
  const [salary, setSalary] = useState("");
  const [createPortal, setCreatePortal] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => api.employeeCreate({
      username: username.trim().toLowerCase(), fullName: fullName.trim(), role: role.trim(),
      workDomains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      monthlySalary: Number(salary) || 0, createPortal,
    }),
    onSuccess: (r) => { setLink(r.onboardUrl); onCreated(); },
  });
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const f: React.CSSProperties = { ...input, width: "100%", boxSizing: "border-box" };
  const copy = () => { if (link) { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } };

  if (link) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.gain}`, borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: SHADOW }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 900, color: C.gain, marginBottom: 8 }}>
          <Check size={17} /> {he ? "העובד נוצר ✓" : "Employee created ✓"}
        </div>
        <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>{he ? "שלח לו את קישור ההצטרפות (נפתח ללא התחברות):" : "Send them the onboarding link (opens without login):"}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input readOnly value={link} onFocus={(e) => e.target.select()} style={{ ...f, flex: 1, minWidth: 200, fontSize: 12, color: C.gold }} />
          <button onClick={copy} style={{ ...btn(true) }}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? (he ? "הועתק" : "Copied") : (he ? "העתק" : "Copy")}</button>
          <a href={link} target="_blank" rel="noreferrer" style={{ ...btn(false), textDecoration: "none" }}><ExternalLink size={15} /> {he ? "פתח" : "Open"}</a>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={() => { setLink(null); setFullName(""); setUsername(""); setRole(""); setDomains(""); setSalary(""); setCreatePortal(false); }} style={{ ...btn(false) }}><UserPlus size={15} /> {he ? "עוד עובד" : "Add another"}</button>
          <button onClick={onClose} style={{ ...btn(false) }}><X size={15} /> {he ? "סגור" : "Close"}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.gold}`, borderRadius: 14, padding: 18, marginBottom: 16, boxShadow: SHADOW }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 900, color: C.text, marginBottom: 14 }}>
        <UserPlus size={17} color={C.gold} /> {he ? "עובד חדש" : "New employee"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div><label style={lbl}>{he ? "שם מלא" : "Full name"}</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} dir={rtl ? "rtl" : "ltr"} autoFocus style={f} /></div>
        <div><label style={lbl}>{he ? "שם משתמש" : "Username"}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" placeholder="e.g. tzahi" style={f} /></div>
        <div><label style={lbl}>{he ? "תפקיד" : "Role"}</label>
          <input value={role} onChange={(e) => setRole(e.target.value)} dir={rtl ? "rtl" : "ltr"} style={f} /></div>
        <div><label style={lbl}>{he ? "תחומי עבודה (מופרד בפסיק)" : "Work domains (comma-separated)"}</label>
          <input value={domains} onChange={(e) => setDomains(e.target.value)} dir={rtl ? "rtl" : "ltr"} style={f} /></div>
        <div><label style={lbl}>{he ? "משכורת חודשית ($)" : "Monthly salary ($)"}</label>
          <input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} style={f} /></div>
      </div>
      <div style={{ marginTop: 14 }}>
        <Toggle on={createPortal} onToggle={() => setCreatePortal((v) => !v)} label={he ? "ליצור לו פורטל?" : "Create a portal for them?"} he={he} />
      </div>
      {create.isError && <div style={{ color: C.loss, fontSize: 12.5, marginTop: 10 }}>{String((create.error as any)?.message || create.error)}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={() => create.mutate()} disabled={create.isPending || !username.trim()} style={{ ...btn(true) }}>
          {create.isPending ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} {he ? "צור וקבל קישור" : "Create + get link"}
        </button>
        <button onClick={onClose} style={{ ...btn(false) }}><X size={15} /> {he ? "ביטול" : "Cancel"}</button>
      </div>
    </div>
  );
}
