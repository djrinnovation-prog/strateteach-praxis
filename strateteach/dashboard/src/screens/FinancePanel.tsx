import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Pencil, Trash2, Check, X, Wallet, Receipt, TrendingUp, PiggyBank, Landmark, Banknote, FileSpreadsheet, Printer } from "lucide-react";
import { api } from "../app/api";
import type { FinKind, FinanceOverview, FinExpense } from "../lib/client";
import { downloadReportCsv, printReportPdf, type ReportSection } from "../lib/export";
import { PriorityChip, PRIORITY_OPTS } from "../components/Priority";
import { C, MONO } from "../theme";

// ── Owners Portal · FINANCE tab — owner-only business finance management.
// Summary tiles + four managed stores (budget · expenses · wallets · revenue) with inline
// add/edit/delete + expense status changes, and a derived monthly cash-flow. Bilingual,
// skin + glass. All reads/writes go to /auth/finance/* (require_owner on the backend).

type Bi = { he: string; en: string };
type FieldType = "text" | "number" | "select" | "month" | "date";
type FieldSpec = { key: string; label: Bi; type?: FieldType; options?: { v: string; he: string; en: string }[]; w?: number; ph?: Bi };

const money = (n: number | undefined) =>
  "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const EXP_STATUS: Record<string, { he: string; en: string; c: string }> = {
  planned: { he: "מתוכנן", en: "planned", c: C.muted },
  pending: { he: "ממתין", en: "pending", c: C.gold },
  paid: { he: "שולם", en: "paid", c: C.gain },
  overdue: { he: "באיחור", en: "overdue", c: C.loss },
  cancelled: { he: "בוטל", en: "cancelled", c: C.faint },
};
const STATUS_ORDER = ["planned", "pending", "paid", "overdue", "cancelled"];

const card: React.CSSProperties = { background: "var(--glass, rgba(255,255,255,0.6))", backdropFilter: "blur(10px)", border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, boxShadow: "0 16px 40px -26px rgba(0,0,0,0.3)", marginBottom: 14 };
const inp: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: "inherit", fontSize: 13 };
const th: React.CSSProperties = { textAlign: "start", fontSize: 11, fontWeight: 800, color: C.muted, padding: "6px 8px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" };
const tdc: React.CSSProperties = { fontSize: 13, padding: "8px 8px", borderBottom: `1px solid ${C.line}`, verticalAlign: "middle" };
const iconBtn = (color?: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, color: color || C.muted, cursor: "pointer" });
const addBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--btn-bg, " + C.gold + ")", color: "var(--btn-ink, #fff)", border: "none", borderRadius: 9, padding: "7px 13px", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };

function RowForm({ fields, initial, he, saving, onSave, onCancel }: {
  fields: FieldSpec[]; initial: Record<string, any>; he: boolean; saving: boolean;
  onSave: (v: Record<string, any>) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 10 }}>
      {fields.map((fd) => (
        <label key={fd.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted }}>{he ? fd.label.he : fd.label.en}</span>
          {fd.type === "select" ? (
            <select value={f[fd.key] ?? ""} onChange={(e) => set(fd.key, e.target.value)} style={{ ...inp, width: fd.w || 130 }}>
              {(fd.options || []).map((o) => <option key={o.v} value={o.v}>{he ? o.he : o.en}</option>)}
            </select>
          ) : (
            <input type={fd.type === "number" ? "number" : fd.type === "date" ? "date" : "text"}
              value={f[fd.key] ?? ""} placeholder={fd.ph ? (he ? fd.ph.he : fd.ph.en) : (fd.type === "month" ? "2026-07" : "")}
              onChange={(e) => set(fd.key, fd.type === "number" ? e.target.value : e.target.value)}
              style={{ ...inp, width: fd.w || (fd.type === "number" ? 100 : 130), fontFamily: fd.type === "number" ? MONO : "inherit" }} />
          )}
        </label>
      ))}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onSave(f)} disabled={saving} style={{ ...iconBtn(C.gain), borderColor: `${C.gain}66` }} title={he ? "שמור" : "Save"}>
          {saving ? <Loader2 size={14} className="spin" /> : <Check size={15} />}
        </button>
        <button onClick={onCancel} style={iconBtn()} title={he ? "בטל" : "Cancel"}><X size={15} /></button>
      </div>
    </div>
  );
}

function Section({ icon, title, sub, onAdd, adding, addLabel, children, he }: {
  icon: React.ReactNode; title: string; sub?: string; onAdd?: () => void; adding?: boolean; addLabel: string; children: React.ReactNode; he: boolean;
}) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, background: `${C.gold}1e`, display: "grid", placeItems: "center", color: C.gold, flexShrink: 0 }}>{icon}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15.5, fontWeight: 900, color: C.text }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: C.muted }}>{sub}</div>}
        </div>
        {onAdd && <button onClick={onAdd} style={addBtn}><Plus size={14} /> {addLabel}</button>}
      </div>
      {children}
    </div>
  );
}

export default function FinancePanel({ he }: { he: boolean; rtl?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["financeOverview"], queryFn: () => api.financeOverview(), retry: false });
  const data = q.data as FinanceOverview | undefined;
  const [err, setErr] = useState("");
  const inval = () => qc.invalidateQueries({ queryKey: ["financeOverview"] });
  const save = useMutation({
    mutationFn: (v: { kind: FinKind; id?: number; body: Record<string, unknown> }) =>
      v.id ? api.financeUpdate(v.kind, v.id, v.body) : api.financeCreate(v.kind, v.body),
    onSuccess: () => { setErr(""); inval(); }, onError: (e: any) => setErr(e?.message || "Failed"),
  });
  const del = useMutation({ mutationFn: (v: { kind: FinKind; id: number }) => api.financeDelete(v.kind, v.id), onSuccess: inval, onError: (e: any) => setErr(e?.message || "Failed") });

  // which row/section is being added or edited: `${kind}:${id||'new'}`
  const [editing, setEditing] = useState<string>("");
  const open = (kind: FinKind, id?: number) => setEditing(`${kind}:${id ?? "new"}`);
  const close = () => setEditing("");
  const isNew = (kind: FinKind) => editing === `${kind}:new`;
  const isEdit = (kind: FinKind, id: number) => editing === `${kind}:${id}`;
  const num = (v: any) => Number(v) || 0;
  const submit = (kind: FinKind, id: number | undefined, body: Record<string, any>) =>
    save.mutate({ kind, id, body }, { onSuccess: close });

  if (q.isLoading) return <div style={{ ...card, textAlign: "center", color: C.muted }}><Loader2 size={18} className="spin" /></div>;
  if (q.isError || !data) return <div style={{ ...card, color: C.loss }}>{he ? "טעינת הנתונים הכספיים נכשלה." : "Couldn't load the finance data."}</div>;

  const s = data.summary;
  const T = (o: Bi) => (he ? o.he : o.en);
  // SERVER-decided edit right (P2.3 Oren boundary): owners edit; the execution operator
  // gets a read-only STRUCTURE view (the backend already filtered owner-investments and
  // per-person payroll out of `data`, so nothing sensitive exists here to hide).
  const canEdit = data.canEdit !== false;

  // ── summary tiles ──
  // Per-owner invested breakdown (name → amount) for the tile subtitle.
  const ownerName = (id: string) => (id === "company" || id === "" ? T({ he: "חברה", en: "Company" }) : (data.owners.find((o) => o.id === id)?.name || id));
  const investedBreakdown = Object.entries(s.investedByOwner || {}).map(([k, v]) => `${ownerName(k)} ${money(v)}`).join(" · ");

  const tiles: { label: Bi; value: string; sub?: string; color?: string }[] = [
    { label: { he: "סה\"כ הושקע", en: "Total invested" }, value: money(s.investedTotal), sub: investedBreakdown || T({ he: "הון ראשוני ונוסף", en: "initial + additional capital" }), color: C.gold },
    { label: { he: "תקציב: מתוכנן / בפועל", en: "Budget: planned / actual" }, value: `${money(s.budgetPlannedTotal)} / ${money(s.budgetActualTotal)}`, sub: T({ he: `נותר ${money(s.budgetRemaining)}`, en: `${money(s.budgetRemaining)} left` }), color: s.budgetRemaining >= 0 ? C.gain : C.loss },
    { label: { he: "סך ארנקים", en: "Wallet total" }, value: money(s.walletTotal), sub: T({ he: "יתרות כל הארנקים", en: "all wallet balances" }), color: C.text },
    { label: { he: "צפי מחזור החודש", en: "Revenue this month" }, value: money(s.revenueThisMonth), sub: `${s.thisMonth} · ${T({ he: "נטו", en: "net" })} ${money(s.netThisMonth)}`, color: s.netThisMonth >= 0 ? C.gain : C.loss },
    { label: { he: "תזרים נטו צפוי", en: "Projected net cash flow" }, value: money(s.projectedNet), sub: T({ he: `מסלול (ארנקים+נטו) ${money(s.runwayNet)}`, en: `runway ${money(s.runwayNet)}` }), color: s.projectedNet >= 0 ? C.gain : C.loss },
    { label: { he: "שכר ובונוסים", en: "Payroll" }, value: money(s.payroll?.paid || 0), sub: T({ he: `ממתין ${money(s.payroll?.pending || 0)} · חודשי ${money(s.payroll?.monthly || 0)}`, en: `pending ${money(s.payroll?.pending || 0)} · monthly ${money(s.payroll?.monthly || 0)}` }), color: C.gold },
  ];

  // ── field specs ──
  const scopeOpts = [{ v: "month", he: "חודשי", en: "Monthly" }, { v: "forward", he: "קדימה (פרויקט)", en: "Forward (project)" }];
  const statusOpts = STATUS_ORDER.map((v) => ({ v, he: EXP_STATUS[v].he, en: EXP_STATUS[v].en }));
  const recurOpts = [{ v: "", he: "חד-פעמי", en: "One-off" }, { v: "monthly", he: "חודשי", en: "Monthly" }, { v: "quarterly", he: "רבעוני", en: "Quarterly" }, { v: "yearly", he: "שנתי", en: "Yearly" }];
  const kindOpts = [{ v: "bank", he: "בנק", en: "Bank" }, { v: "crypto", he: "קריפטו", en: "Crypto" }, { v: "cash", he: "מזומן", en: "Cash" }, { v: "card", he: "כרטיס", en: "Card" }, { v: "other", he: "אחר", en: "Other" }];

  const budgetFields: FieldSpec[] = [
    { key: "scope", label: { he: "סוג", en: "Scope" }, type: "select", options: scopeOpts, w: 130 },
    { key: "period", label: { he: "תקופה", en: "Period" }, w: 100, ph: { he: "2026-07 / Q4", en: "2026-07 / Q4" } },
    { key: "category", label: { he: "קטגוריה", en: "Category" }, w: 120 },
    { key: "label", label: { he: "תיאור", en: "Label" }, w: 150 },
    { key: "planned", label: { he: "מתוכנן $", en: "Planned $" }, type: "number", w: 100 },
    { key: "actual", label: { he: "בפועל $", en: "Actual $" }, type: "number", w: 100 },
  ];
  const expenseFields: FieldSpec[] = [
    { key: "name", label: { he: "שם", en: "Name" }, w: 150 },
    { key: "amount", label: { he: "סכום $", en: "Amount $" }, type: "number", w: 100 },
    { key: "category", label: { he: "קטגוריה", en: "Category" }, w: 120 },
    { key: "dueDate", label: { he: "תאריך", en: "Due date" }, type: "date", w: 140 },
    { key: "status", label: { he: "סטטוס", en: "Status" }, type: "select", options: statusOpts, w: 120 },
    { key: "recurring", label: { he: "תדירות", en: "Recurring" }, type: "select", options: recurOpts, w: 120 },
  ];
  const walletFields: FieldSpec[] = [
    { key: "name", label: { he: "שם", en: "Name" }, w: 150 },
    { key: "kind", label: { he: "סוג", en: "Kind" }, type: "select", options: kindOpts, w: 110 },
    { key: "balance", label: { he: "יתרה $", en: "Balance $" }, type: "number", w: 120 },
    { key: "notes", label: { he: "הערה", en: "Notes" }, w: 150 },
  ];
  const revenueFields: FieldSpec[] = [
    { key: "period", label: { he: "חודש", en: "Month" }, type: "month", w: 110 },
    { key: "label", label: { he: "מקור", en: "Source" }, w: 160 },
    { key: "amount", label: { he: "סכום $", en: "Amount $" }, type: "number", w: 120 },
  ];
  // Owner picker options: "company / none" + the OWNER users (Dan/Rafi/Yoav) from the backend.
  const ownerOpts = [{ v: "", he: "חברה / ללא", en: "Company / none" }, ...data.owners.map((o) => ({ v: o.id, he: o.name, en: o.name }))];
  const invKindOpts = [{ v: "initial", he: "ראשונית", en: "Initial" }, { v: "additional", he: "נוספת", en: "Additional" }];
  // What the investment money is FOR (classification). Keys mirror the backend.
  // Where the money went (classification, per Dan) — company operating capital · owners' loan ·
  // initial share purchase · then the general buckets. Keys mirror the backend exactly.
  const purposeOpts = [
    { v: "working_capital", he: "הון שוטף של החברה", en: "Company operating capital" },
    { v: "owner_loan", he: "הלוואת בעלים", en: "Owners' loan" },
    { v: "initial_shares", he: "רכישת מניות ראשונית", en: "Initial share purchase" },
    { v: "equity", he: "קניית מניות/הון", en: "Share/equity purchase" },
    { v: "company", he: "השקעת החברה", en: "Company investment" },
    { v: "ongoing", he: "הוצאות שוטפות", en: "Ongoing expenses" },
    { v: "other", he: "אחר", en: "Other" },
  ];
  const purposeLbl = (k: string) => { const o = purposeOpts.find((p) => p.v === k); return o ? T({ he: o.he, en: o.en }) : (k || "—"); };
  const priorityLbl = (k?: string) => { const o = PRIORITY_OPTS.find((p) => p.v === (k || "none")); return o && o.v !== "none" ? T({ he: o.he, en: o.en }) : "—"; };
  const ptypeLbl = (k: string) => T(({ salary: { he: "משכורת", en: "Salary" }, bonus: { he: "בונוס", en: "Bonus" }, expense: { he: "הוצאה", en: "Expense" }, addition: { he: "תוספת", en: "Addition" } } as Record<string, Bi>)[k] || { he: k, en: k });
  const investmentFields: FieldSpec[] = [
    { key: "amount", label: { he: "סכום $", en: "Amount $" }, type: "number", w: 110 },
    { key: "kind", label: { he: "סוג", en: "Kind" }, type: "select", options: invKindOpts, w: 120 },
    { key: "purpose", label: { he: "סיווג / למה מיועד", en: "Classification / purpose" }, type: "select", options: purposeOpts, w: 175 },
    { key: "priority", label: { he: "עדיפות", en: "Priority" }, type: "select", options: PRIORITY_OPTS, w: 140 },
    { key: "source", label: { he: "מקור הכספים", en: "Source of funds" }, w: 170 },
    { key: "date", label: { he: "תאריך", en: "Date" }, type: "date", w: 140 },
    { key: "owner", label: { he: "משויך לבעלים", en: "Linked owner" }, type: "select", options: ownerOpts, w: 140 },
    { key: "notes", label: { he: "הערה", en: "Notes" }, w: 150 },
  ];
  // By-classification invested breakdown (largest first) for a small summary line.
  const purposeBreakdown = Object.entries(s.investedByPurpose || {}).sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([k, v]) => `${purposeLbl(k)} ${money(v as number)}`).join(" · ");

  const norm = (body: Record<string, any>, numeric: string[]) => {
    const out = { ...body };
    numeric.forEach((k) => { if (out[k] !== undefined && out[k] !== "") out[k] = num(out[k]); });
    return out;
  };

  // cycle an expense status on chip click
  const cycleStatus = (e: FinExpense) => {
    const i = STATUS_ORDER.indexOf(e.status);
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
    save.mutate({ kind: "expenses", id: e.id, body: { status: next } });
  };

  const monthBudget = data.budget.filter((b) => b.scope === "month");
  const forwardBudget = data.budget.filter((b) => b.scope === "forward");

  // ── Export: build the full report (summary + every section) as titled tables, then
  // hand off to the app's dependency-free export lib (Excel-CSV + branded print→PDF). ──
  const kindLbl = (k: string) => T(k === "initial" ? { he: "ראשונית", en: "Initial" } : { he: "נוספת", en: "Additional" });
  const buildSections = (): ReportSection[] => [
    { title: T({ he: "סיכום", en: "Summary" }), rows: [
      [T({ he: "תקציב מתוכנן (סה\"כ)", en: "Budget planned (total)" }), s.budgetPlannedTotal],
      [T({ he: "תקציב בפועל (סה\"כ)", en: "Budget actual (total)" }), s.budgetActualTotal],
      [T({ he: "תקציב שנותר", en: "Budget remaining" }), s.budgetRemaining],
      [T({ he: "תקציב חודשי מתוכנן / בפועל", en: "Monthly budget planned / actual" }), `${s.budgetPlannedMonth} / ${s.budgetActualMonth}`],
      [T({ he: "תקציב קדימה (פרויקט)", en: "Forward budget (project)" }), s.budgetPlannedForward],
      [T({ he: "סך ארנקים", en: "Wallet total" }), s.walletTotal],
      [T({ he: "צפי מחזור החודש", en: "Revenue this month" }), s.revenueThisMonth],
      [T({ he: "נטו החודש", en: "Net this month" }), s.netThisMonth],
      [T({ he: "תזרים נטו צפוי", en: "Projected net cash flow" }), s.projectedNet],
      [T({ he: "מסלול (ארנקים + נטו)", en: "Runway (wallets + net)" }), s.runwayNet],
      [T({ he: "שכר ובונוסים — שולם / ממתין", en: "Payroll — paid / pending" }), `${s.payroll?.paid || 0} / ${s.payroll?.pending || 0}`],
      [T({ he: "שכר חודשי (עובדים פעילים)", en: "Monthly payroll (active)" }), s.payroll?.monthly || 0],
      [T({ he: "סה\"כ הושקע", en: "Total invested" }), s.investedTotal],
      ...Object.entries(s.investedByOwner || {}).map(([k, v]) => [T({ he: "הושקע · ", en: "Invested · " }) + ownerName(k), v as number]),
      ...Object.entries(s.investedByPurpose || {}).map(([k, v]) => [T({ he: "סיווג · ", en: "Classification · " }) + purposeLbl(k), v as number]),
    ] },
    { title: T({ he: "תקציב", en: "Budget" }), headers: [T({ he: "סוג", en: "Scope" }), T({ he: "תקופה", en: "Period" }), T({ he: "קטגוריה", en: "Category" }), T({ he: "תיאור", en: "Label" }), T({ he: "מתוכנן (USD)", en: "Planned (USD)" }), T({ he: "בפועל (USD)", en: "Actual (USD)" })],
      rows: data.budget.map((b) => [b.scope, b.period, b.category, b.label, b.planned, b.actual]) },
    { title: T({ he: "הוצאות שוטפות", en: "Ongoing expenses" }), headers: [T({ he: "שם", en: "Name" }), T({ he: "סכום (USD)", en: "Amount (USD)" }), T({ he: "קטגוריה", en: "Category" }), T({ he: "תאריך", en: "Due date" }), T({ he: "סטטוס", en: "Status" }), T({ he: "תדירות", en: "Recurring" })],
      rows: data.expenses.map((e) => [e.name, e.amount, e.category, e.dueDate, T(EXP_STATUS[e.status] || { he: e.status, en: e.status }), e.recurring]) },
    { title: T({ he: "שכר ובונוסים", en: "Payroll" }), headers: [T({ he: "עובד", en: "Employee" }), T({ he: "סוג", en: "Type" }), T({ he: "סכום (USD)", en: "Amount (USD)" }), T({ he: "תאריך", en: "Date" }), T({ he: "סטטוס", en: "Status" })],
      rows: (data.payroll || []).map((p) => [p.employeeName, ptypeLbl(p.ptype), p.amount, p.dueDate, p.status === "paid" ? T({ he: "שולם", en: "Paid" }) : T({ he: "ממתין", en: "Pending" })]) },
    { title: T({ he: "יתרות ארנקים", en: "Wallet balances" }), headers: [T({ he: "שם", en: "Name" }), T({ he: "סוג", en: "Kind" }), T({ he: "יתרה (USD)", en: "Balance (USD)" }), T({ he: "מטבע", en: "Currency" }), T({ he: "הערה", en: "Notes" })],
      rows: data.wallets.map((w) => [w.name, w.kind, w.balance, w.currency, w.notes]) },
    { title: T({ he: "צפי מחזור חודשי", en: "Monthly revenue forecast" }), headers: [T({ he: "חודש", en: "Month" }), T({ he: "מקור", en: "Source" }), T({ he: "סכום (USD)", en: "Amount (USD)" })],
      rows: data.revenue.map((r) => [r.period, r.label, r.amount]) },
    { title: T({ he: "תזרים מזומנים", en: "Cash flow" }), headers: [T({ he: "חודש", en: "Month" }), T({ he: "נכנס (USD)", en: "In (USD)" }), T({ he: "יוצא (USD)", en: "Out (USD)" }), T({ he: "נטו (USD)", en: "Net (USD)" }), T({ he: "מצטבר (USD)", en: "Cumulative (USD)" })],
      rows: data.cashflow.map((c) => [c.month, c.in, c.out, c.net, c.cumulative]) },
    { title: T({ he: "השקעות", en: "Investments" }), headers: [T({ he: "סכום (USD)", en: "Amount (USD)" }), T({ he: "סוג", en: "Kind" }), T({ he: "סיווג", en: "Classification" }), T({ he: "עדיפות", en: "Priority" }), T({ he: "מקור", en: "Source" }), T({ he: "בעלים", en: "Owner" }), T({ he: "תאריך", en: "Date" }), T({ he: "הערה", en: "Notes" })],
      rows: data.investments.map((v) => [v.amount, kindLbl(v.kind), purposeLbl(v.purpose), priorityLbl(v.priority), v.source, v.owner ? ownerName(v.owner) : T({ he: "חברה", en: "Company" }), v.date, v.notes]) },
  ];
  const reportTitle = () => `${T({ he: "דוח כספים · פורטל הבעלים", en: "Finance report · Owners Portal" })} — ${new Date().toLocaleDateString()}`;
  const onExcel = () => downloadReportCsv("finance_report", buildSections());
  const onPdf = () => printReportPdf(reportTitle(), buildSections(), he);
  const exportBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: C.surface, border: `1px solid ${C.gold}66`, color: C.gold, borderRadius: 9, padding: "7px 13px", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" };

  return (
    <div>
      {err && <div style={{ ...card, marginBottom: 12, color: C.loss, background: `${C.loss}12`, borderColor: `${C.loss}55` }}>{err}</div>}

      {/* Read-only STRUCTURE view (execution operator): say so honestly, once, up top. */}
      {!canEdit && (
        <div style={{ ...card, marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: C.muted }}>
          {T({ he: "תצוגת מבנה פיננסי (קריאה בלבד) — ללא השקעות-בעלים וללא פירוט שכר אישי; עריכה לבעלים בלבד.",
               en: "Financial-structure view (read-only) — owners' investments and per-person payroll excluded; editing is owners-only." })}
        </div>
      )}

      {/* Export the full finance report — Excel (.csv, opens in Excel) + branded PDF. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginInlineEnd: "auto" }}>{T({ he: "ייצוא דוח כספים מלא", en: "Export the full finance report" })}</span>
        <button onClick={onExcel} style={exportBtn}><FileSpreadsheet size={14} /> {T({ he: "ייצוא אקסל", en: "Export Excel" })}</button>
        <button onClick={onPdf} style={exportBtn}><Printer size={14} /> {T({ he: "ייצוא PDF", en: "Export PDF" })}</button>
      </div>

      {/* summary tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12, marginBottom: 16 }}>
        {tiles.map((t, i) => (
          <div key={i} style={{ ...card, margin: 0, padding: "14px 15px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{T(t.label)}</div>
            <div style={{ fontSize: 21, fontWeight: 900, fontFamily: MONO, marginTop: 5, color: t.color || C.text }}>{t.value}</div>
            {t.sub && <div style={{ fontSize: 11, color: C.faint, marginTop: 3 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── INVESTMENTS ── */}
      <Section he={he} icon={<Banknote size={17} />} title={T({ he: "השקעות", en: "Investments" })}
        sub={T({ he: "הון ראשוני או נוסף · מקור הכספים · משויך לבעלים (אופציונלי)", en: "Initial or additional capital · source of funds · linked owner (optional)" })}
        onAdd={canEdit ? () => open("investments") : undefined} addLabel={T({ he: "הוסף השקעה", en: "Add investment" })}>
        {/* small by-classification breakdown of the invested total */}
        {purposeBreakdown && !isNew("investments") && (
          <div style={{ fontSize: 11.5, color: C.faint, margin: "0 2px 10px", lineHeight: 1.6 }}>
            <span style={{ fontWeight: 800, color: C.muted }}>{T({ he: "לפי סיווג: ", en: "By classification: " })}</span>{purposeBreakdown}
          </div>
        )}
        {isNew("investments") && <RowForm he={he} fields={investmentFields} saving={save.isPending} onCancel={close}
          initial={{ kind: "initial", currency: "USD", owner: "", purpose: "company", priority: "none", date: s.thisMonth + "-01" }} onSave={(v) => submit("investments", undefined, norm(v, ["amount"]))} />}
        {data.investments.length === 0 && !isNew("investments") ? <Empty he={he} /> : (
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[{ he: "סכום", en: "Amount" }, { he: "סוג", en: "Kind" }, { he: "סיווג", en: "Classification" }, { he: "עדיפות", en: "Priority" }, { he: "מקור", en: "Source" }, { he: "תאריך", en: "Date" }, { he: "בעלים", en: "Owner" }, { he: "", en: "" }].map((h, i) => <th key={i} style={th}>{T(h)}</th>)}</tr></thead>
            <tbody>{data.investments.map((v) => isEdit("investments", v.id) ? (
              <tr key={v.id}><td colSpan={8} style={tdc}><RowForm he={he} fields={investmentFields} saving={save.isPending} onCancel={close}
                initial={{ amount: v.amount, kind: v.kind, purpose: v.purpose, priority: v.priority || "none", source: v.source, date: v.date, owner: v.owner, notes: v.notes }}
                onSave={(val) => submit("investments", v.id, norm(val, ["amount"]))} /></td></tr>
            ) : (
              <tr key={v.id}>
                <td style={{ ...tdc, fontFamily: MONO, fontWeight: 800, color: C.gold }}>{money(v.amount)}</td>
                <td style={tdc}><span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "2px 9px", border: `1px solid ${C.line}`, color: v.kind === "initial" ? C.gain : C.text, background: C.surface2 }}>{T(v.kind === "initial" ? { he: "ראשונית", en: "Initial" } : { he: "נוספת", en: "Additional" })}</span></td>
                <td style={tdc}><span style={{ fontSize: 11, fontWeight: 700, color: C.muted }}>{purposeLbl(v.purpose)}</span></td>
                <td style={tdc}>{v.priority && v.priority !== "none" ? <PriorityChip priority={v.priority} he={he} /> : <span style={{ color: C.faint }}>—</span>}</td>
                <td style={tdc}>{v.source || "—"}</td>
                <td style={{ ...tdc, fontFamily: MONO, color: C.muted }}>{v.date || "—"}</td>
                <td style={tdc}>{v.owner ? <span style={{ fontWeight: 700 }}>{ownerName(v.owner)}</span> : <span style={{ color: C.faint }}>{T({ he: "חברה", en: "Company" })}</span>}</td>
                <td style={{ ...tdc, whiteSpace: "nowrap" }}>{canEdit && <span style={{ display: "inline-flex", gap: 5 }}>
                  <button onClick={() => open("investments", v.id)} style={iconBtn()} title="edit"><Pencil size={13} /></button>
                  <button onClick={() => del.mutate({ kind: "investments", id: v.id })} style={iconBtn(C.loss)} title="delete"><Trash2 size={13} /></button>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>

      {/* ── BUDGET ── */}
      <Section he={he} icon={<PiggyBank size={17} />} title={T({ he: "תקציב — חודשי וקדימה", en: "Budget — monthly & forward" })}
        sub={T({ he: "מתוכנן מול בפועל, לפי חודש או לפי ציר-זמן הפרויקט", en: "Planned vs actual, by month or the project timeline" })}
        onAdd={canEdit ? () => open("budget") : undefined} addLabel={T({ he: "הוסף שורה", en: "Add line" })}>
        {isNew("budget") && <RowForm he={he} fields={budgetFields} saving={save.isPending} onCancel={close}
          initial={{ scope: "month", currency: "USD" }} onSave={(v) => submit("budget", undefined, norm(v, ["planned", "actual"]))} />}
        {[{ k: "month", rows: monthBudget, lbl: { he: "חודשי", en: "Monthly" } }, { k: "forward", rows: forwardBudget, lbl: { he: "קדימה — ציר זמן הפרויקט", en: "Forward — project timeline" } }].map((grp) => grp.rows.length > 0 && (
          <div key={grp.k} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, margin: "6px 2px" }}>{T(grp.lbl)}</div>
            <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{[{ he: "תקופה", en: "Period" }, { he: "קטגוריה", en: "Category" }, { he: "תיאור", en: "Label" }, { he: "מתוכנן", en: "Planned" }, { he: "בפועל", en: "Actual" }, { he: "", en: "" }].map((h, i) => <th key={i} style={th}>{T(h)}</th>)}</tr></thead>
              <tbody>{grp.rows.map((b) => isEdit("budget", b.id) ? (
                <tr key={b.id}><td colSpan={6} style={tdc}><RowForm he={he} fields={budgetFields} saving={save.isPending} onCancel={close}
                  initial={{ scope: b.scope, period: b.period, category: b.category, label: b.label, planned: b.planned, actual: b.actual }}
                  onSave={(v) => submit("budget", b.id, norm(v, ["planned", "actual"]))} /></td></tr>
              ) : (
                <tr key={b.id}>
                  <td style={{ ...tdc, fontFamily: MONO }}>{b.period || "—"}</td>
                  <td style={tdc}>{b.category || "—"}</td>
                  <td style={tdc}>{b.label || "—"}</td>
                  <td style={{ ...tdc, fontFamily: MONO }}>{money(b.planned)}</td>
                  <td style={{ ...tdc, fontFamily: MONO, color: b.actual > b.planned ? C.loss : C.text }}>{money(b.actual)}</td>
                  <td style={{ ...tdc, whiteSpace: "nowrap" }}>{canEdit && <span style={{ display: "inline-flex", gap: 5 }}>
                    <button onClick={() => open("budget", b.id)} style={iconBtn()} title="edit"><Pencil size={13} /></button>
                    <button onClick={() => del.mutate({ kind: "budget", id: b.id })} style={iconBtn(C.loss)} title="delete"><Trash2 size={13} /></button>
                  </span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        ))}
        {data.budget.length === 0 && !isNew("budget") && <Empty he={he} />}
      </Section>

      {/* ── EXPENSES ── */}
      <Section he={he} icon={<Receipt size={17} />} title={T({ he: "הוצאות שוטפות", en: "Ongoing expenses" })}
        sub={T({ he: "הוסף, ערוך, ושנה סטטוס (לחיצה על התג מחליפה סטטוס)", en: "Add, edit, and change status (tap the chip to cycle status)" })}
        onAdd={canEdit ? () => open("expenses") : undefined} addLabel={T({ he: "הוסף הוצאה", en: "Add expense" })}>
        {isNew("expenses") && <RowForm he={he} fields={expenseFields} saving={save.isPending} onCancel={close}
          initial={{ status: "planned", currency: "USD", recurring: "" }} onSave={(v) => submit("expenses", undefined, norm(v, ["amount"]))} />}
        {data.expenses.length === 0 && !isNew("expenses") ? <Empty he={he} /> : (
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[{ he: "שם", en: "Name" }, { he: "קטגוריה", en: "Category" }, { he: "תאריך", en: "Due" }, { he: "סכום", en: "Amount" }, { he: "סטטוס", en: "Status" }, { he: "", en: "" }].map((h, i) => <th key={i} style={th}>{T(h)}</th>)}</tr></thead>
            <tbody>{data.expenses.map((e) => isEdit("expenses", e.id) ? (
              <tr key={e.id}><td colSpan={6} style={tdc}><RowForm he={he} fields={expenseFields} saving={save.isPending} onCancel={close}
                initial={{ name: e.name, amount: e.amount, category: e.category, dueDate: e.dueDate, status: e.status, recurring: e.recurring }}
                onSave={(v) => submit("expenses", e.id, norm(v, ["amount"]))} /></td></tr>
            ) : (
              <tr key={e.id} style={{ opacity: e.status === "cancelled" ? 0.5 : 1 }}>
                <td style={tdc}><b>{e.name}</b>{e.recurring ? <span style={{ fontSize: 10, color: C.faint }}> · {e.recurring}</span> : null}</td>
                <td style={tdc}>{e.category || "—"}</td>
                <td style={{ ...tdc, fontFamily: MONO, color: C.muted }}>{e.dueDate || "—"}</td>
                <td style={{ ...tdc, fontFamily: MONO }}>{money(e.amount)}</td>
                <td style={tdc}><button onClick={canEdit ? () => cycleStatus(e) : undefined} title={canEdit ? (he ? "לחץ לשינוי" : "click to change") : undefined}
                  style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 10px", cursor: canEdit ? "pointer" : "default", border: `1px solid ${EXP_STATUS[e.status].c}66`, color: EXP_STATUS[e.status].c, background: `${EXP_STATUS[e.status].c}18`, fontFamily: "inherit" }}>
                  {T(EXP_STATUS[e.status])}</button></td>
                <td style={{ ...tdc, whiteSpace: "nowrap" }}>{canEdit && <span style={{ display: "inline-flex", gap: 5 }}>
                  <button onClick={() => open("expenses", e.id)} style={iconBtn()} title="edit"><Pencil size={13} /></button>
                  <button onClick={() => del.mutate({ kind: "expenses", id: e.id })} style={iconBtn(C.loss)} title="delete"><Trash2 size={13} /></button>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>

      {/* ── PAYROLL (from the employee ledger — read-only here; managed in ניהול עובדים) ── */}
      <Section he={he} icon={<Wallet size={17} />} title={T({ he: "שכר ובונוסים", en: "Payroll" })}
        sub={T({ he: "מתוך רישום העובדים — 'שולם' = הוצאה בפועל · 'ממתין' = התחייבות. מתגלגל לתקציב ולתזרים.", en: "From the employee ledger — 'paid' = actual expense · 'pending' = obligation. Rolls into the budget + cash flow." })}
        addLabel="">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 12, fontSize: 12 }}>
          <span>{T({ he: "שולם", en: "Paid" })} <b style={{ color: C.gain, fontFamily: MONO }}>{money(s.payroll?.paid || 0)}</b></span>
          <span>{T({ he: "ממתין", en: "Pending" })} <b style={{ color: C.gold, fontFamily: MONO }}>{money(s.payroll?.pending || 0)}</b></span>
          <span>{T({ he: "חודשי (פעילים)", en: "Monthly (active)" })} <b style={{ color: C.text, fontFamily: MONO }}>{money(s.payroll?.monthly || 0)}</b></span>
          {canEdit && <a href="/owners?tab=employees" style={{ marginInlineStart: "auto", color: C.gold, fontWeight: 800, textDecoration: "none" }}>{T({ he: "ניהול עובדים →", en: "Manage in Employees →" })}</a>}
        </div>
        {(data.payroll || []).length === 0 ? (
          canEdit ? <Empty he={he} /> : (
            <div style={{ textAlign: "center", color: C.faint, fontSize: 12.5, padding: "10px 0" }}>
              {T({ he: "פירוט שכר אישי — לבעלים בלבד. הסיכומים למעלה כלולים בתקציב ובתזרים.", en: "Per-person payroll is owners-only. The aggregates above roll into budget + cash flow." })}
            </div>
          )
        ) : (
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[{ he: "עובד", en: "Employee" }, { he: "סוג", en: "Type" }, { he: "תאריך", en: "Date" }, { he: "סכום", en: "Amount" }, { he: "סטטוס", en: "Status" }].map((h, i) => <th key={i} style={th}>{T(h)}</th>)}</tr></thead>
            <tbody>{data.payroll.map((p) => {
              const col = p.status === "paid" ? C.gain : C.gold;
              return (
                <tr key={p.id}>
                  <td style={tdc}><b>{p.employeeName}</b></td>
                  <td style={tdc}>{ptypeLbl(p.ptype)}</td>
                  <td style={{ ...tdc, fontFamily: MONO, color: C.muted }}>{p.dueDate || "—"}</td>
                  <td style={{ ...tdc, fontFamily: MONO }}>{money(p.amount)}</td>
                  <td style={tdc}><span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 10px", color: col, background: `${col}18`, border: `1px solid ${col}66` }}>{p.status === "paid" ? T({ he: "שולם", en: "Paid" }) : T({ he: "ממתין", en: "Pending" })}</span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Section>

      {/* ── WALLETS ── */}
      <Section he={he} icon={<Wallet size={17} />} title={T({ he: "יתרות ארנקים", en: "Wallet balances" })}
        sub={T({ he: "ארנקים ויתרות — ניתן לעריכה", en: "Wallets and balances — editable" })}
        onAdd={canEdit ? () => open("wallets") : undefined} addLabel={T({ he: "הוסף ארנק", en: "Add wallet" })}>
        {isNew("wallets") && <RowForm he={he} fields={walletFields} saving={save.isPending} onCancel={close}
          initial={{ kind: "bank", currency: "USD" }} onSave={(v) => submit("wallets", undefined, norm(v, ["balance"]))} />}
        {data.wallets.length === 0 && !isNew("wallets") ? <Empty he={he} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {data.wallets.map((w) => isEdit("wallets", w.id) ? (
              <div key={w.id} style={{ gridColumn: "1 / -1" }}><RowForm he={he} fields={walletFields} saving={save.isPending} onCancel={close}
                initial={{ name: w.name, kind: w.kind, balance: w.balance, notes: w.notes }} onSave={(v) => submit("wallets", w.id, norm(v, ["balance"]))} /></div>
            ) : (
              <div key={w.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Landmark size={14} color={C.gold} />
                  <b style={{ fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</b>
                  <span style={{ fontSize: 10, color: C.faint }}>{w.kind}</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: MONO, marginTop: 6 }}>{money(w.balance)} <span style={{ fontSize: 11, color: C.faint }}>{w.currency}</span></div>
                {w.notes && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{w.notes}</div>}
                {canEdit && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onClick={() => open("wallets", w.id)} style={iconBtn()} title="edit"><Pencil size={13} /></button>
                  <button onClick={() => del.mutate({ kind: "wallets", id: w.id })} style={iconBtn(C.loss)} title="delete"><Trash2 size={13} /></button>
                </div>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── REVENUE + CASH FLOW ── */}
      <Section he={he} icon={<TrendingUp size={17} />} title={T({ he: "צפי מחזור חודשי + תזרים", en: "Monthly revenue forecast + cash flow" })}
        sub={T({ he: "צפי הכנסות לכל חודש; התזרים מחושב (הכנסות מול הוצאות)", en: "Revenue forecast per month; cash flow is derived (revenue vs expenses)" })}
        onAdd={canEdit ? () => open("revenue") : undefined} addLabel={T({ he: "הוסף צפי", en: "Add forecast" })}>
        {isNew("revenue") && <RowForm he={he} fields={revenueFields} saving={save.isPending} onCancel={close}
          initial={{ currency: "USD", period: s.thisMonth }} onSave={(v) => submit("revenue", undefined, norm(v, ["amount"]))} />}
        {data.revenue.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: 14 }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[{ he: "חודש", en: "Month" }, { he: "מקור", en: "Source" }, { he: "סכום", en: "Amount" }, { he: "", en: "" }].map((h, i) => <th key={i} style={th}>{T(h)}</th>)}</tr></thead>
            <tbody>{data.revenue.map((r) => isEdit("revenue", r.id) ? (
              <tr key={r.id}><td colSpan={4} style={tdc}><RowForm he={he} fields={revenueFields} saving={save.isPending} onCancel={close}
                initial={{ period: r.period, label: r.label, amount: r.amount }} onSave={(v) => submit("revenue", r.id, norm(v, ["amount"]))} /></td></tr>
            ) : (
              <tr key={r.id}>
                <td style={{ ...tdc, fontFamily: MONO }}>{r.period || "—"}</td>
                <td style={tdc}>{r.label || "—"}</td>
                <td style={{ ...tdc, fontFamily: MONO, color: C.gain }}>{money(r.amount)}</td>
                <td style={{ ...tdc, whiteSpace: "nowrap" }}>{canEdit && <span style={{ display: "inline-flex", gap: 5 }}>
                  <button onClick={() => open("revenue", r.id)} style={iconBtn()} title="edit"><Pencil size={13} /></button>
                  <button onClick={() => del.mutate({ kind: "revenue", id: r.id })} style={iconBtn(C.loss)} title="delete"><Trash2 size={13} /></button>
                </span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {/* derived cash flow */}
        <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, margin: "2px 2px 6px" }}>{T({ he: "תזרים מזומנים (מחושב)", en: "Cash flow (derived)" })}</div>
        {data.cashflow.length === 0 ? <Empty he={he} /> : (
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{[{ he: "חודש", en: "Month" }, { he: "נכנס", en: "In" }, { he: "יוצא", en: "Out" }, { he: "נטו", en: "Net" }, { he: "מצטבר", en: "Cumulative" }].map((h, i) => <th key={i} style={{ ...th, textAlign: i === 0 ? "start" : "end" }}>{T(h)}</th>)}</tr></thead>
            <tbody>{data.cashflow.map((c) => (
              <tr key={c.month}>
                <td style={{ ...tdc, fontFamily: MONO }}>{c.month}</td>
                <td style={{ ...tdc, fontFamily: MONO, textAlign: "end", color: C.gain }}>{money(c.in)}</td>
                <td style={{ ...tdc, fontFamily: MONO, textAlign: "end", color: C.loss }}>{money(c.out)}</td>
                <td style={{ ...tdc, fontFamily: MONO, textAlign: "end", fontWeight: 800, color: c.net >= 0 ? C.gain : C.loss }}>{money(c.net)}</td>
                <td style={{ ...tdc, fontFamily: MONO, textAlign: "end", color: c.cumulative >= 0 ? C.text : C.loss }}>{money(c.cumulative)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Section>
    </div>
  );
}

function Empty({ he }: { he: boolean }) {
  return <div style={{ textAlign: "center", color: C.faint, fontSize: 13, padding: "14px 0" }}>{he ? "אין רשומות עדיין — הוסף אחת." : "No entries yet — add one."}</div>;
}
