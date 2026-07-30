import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Play, Check, RotateCcw, Loader2, ChevronDown, ChevronRight, Copy, ListChecks, FlaskConical, ArrowLeft, AlertTriangle, Plus, X } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, MONO } from "../theme";
import type { AuditItem, AuditRun } from "../lib/client";

// ── Daily AUDIT portal (Oren/Raz/Dan) — two screens in one surface ────────────────
// Screen 1 "לוח ביקורת / Audit board": items grouped by section, each with an editable
// prompt + done-note + status workflow + a "generate today's audit prompt" bundler.
// Screen 2 "הרצת ביקורת / Audit run": pick an item → run → paste result → approve.
// Modelled on the legal-copy editor: DB store, runtime read, per-item Save/Approve.
// `domain` restricts to one domain (portal embed); undefined = all (admin, Dan).

const DOMAIN_LABEL: Record<string, { he: string; en: string; color: string }> = {
  it: { he: "IT", en: "IT", color: "#2E7BFF" },
  legal: { he: "משפטי", en: "Legal", color: "#B4571A" },
  product: { he: "מוצר", en: "Product", color: "#5EAF73" },
};
const BASELINE: Record<string, { icon: string; he: string; en: string; color: string }> = {
  done: { icon: "✓", he: "בוצע", en: "Done", color: "#2e9b57" },
  partial: { icon: "⚠", he: "חלקי", en: "Partial", color: "#c98a1a" },
  missing: { icon: "✗", he: "חסר", en: "Missing", color: "#c0392b" },
};
const STATUS_META: Record<string, { he: string; en: string; color: string }> = {
  todo: { he: "לביצוע", en: "To do", color: "#8aa0c8" },
  in_process: { he: "בעבודה", en: "In process", color: "#2E7BFF" },
  redo: { he: "לחזור", en: "Redo", color: "#c0392b" },
  approved: { he: "מאושר", en: "Approved", color: "#2e9b57" },
};

const chip = (label: string, color: string, bg?: string): React.CSSProperties => ({
  fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 999, color,
  background: bg || `${color}1e`, border: `1px solid ${color}66`, whiteSpace: "nowrap",
});

export default function AuditPortal({ domains, master = false, initialView = "home" }: { domains?: string[]; master?: boolean; initialView?: "home" | "board" | "tasks" }) {
  const { lang } = useI18n();
  const he = lang === "he";
  // The audit front-door is JUST the two Home-style buttons; each opens a full screen.
  // `initialView` lets a parent launcher (the Staff Audit landing) open the board or the
  // tasks queue directly, since that launcher already IS the two-tile front door.
  const [view, setView] = useState<"home" | "board" | "tasks" | "run">(initialView);
  const [runItemId, setRunItemId] = useState<number | null>(null);
  const [runFrom, setRunFrom] = useState<"board" | "tasks">("tasks");
  const q = useQuery({ queryKey: ["auditItems"], queryFn: () => api.auditItems(), retry: false });

  const openRun = (id: number, from: "board" | "tasks") => { setRunItemId(id); setRunFrom(from); setView("run"); };
  const openCount = (q.data?.sections || [])
    .flatMap((s) => s.items)
    .filter((it) => (!domains || domains.includes(it.domain)) && it.status !== "approved").length;

  const back = (
    <button onClick={() => setView("home")} className="tap44" style={{ ...miniBtn, display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start" }}>
      <ArrowLeft size={13} /> {he ? "חזרה" : "Back"}
    </button>
  );

  return (
    <div style={{ fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 14 }}>
      {view === "home" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <BigTile Icon={ClipboardCheck} he={he}
              titleHe="מנהל ביקורת עצמית" titleEn="Self Audit Manager"
              subHe="לוח הביקורת — סעיפים, פרומפט, סטטוס ואישור" subEn="The audit board — sections, prompts, status & approval"
              onClick={() => setView("board")} />
            <BigTile Icon={ListChecks} he={he} badge={openCount}
              titleHe="מנהל משימות" titleEn="Tasks Manager"
              subHe="תור המשימות הפתוחות — הרצה ואישור עד לסגירה" subEn="The open-tasks queue — run & approve to completion"
              onClick={() => setView("tasks")} />
          </div>
          {master && (
            <div style={{ fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
              {he ? "תצוגת-על לכל התחומים (IT · משפטי · מוצר) — לבעלים ניהול מלא." : "Master oversight across ALL domains (IT · Legal · Product) — owners have full manage."}
            </div>
          )}
        </>
      )}
      {view === "board" && <>{back}<AuditBoard domains={domains} master={master} he={he} onRun={(id) => openRun(id, "board")} /></>}
      {view === "tasks" && <>{back}<TasksManager domains={domains} master={master} he={he} onOpen={(id) => openRun(id, "tasks")} /></>}
      {view === "run" && <AuditRunView domains={domains} he={he} itemId={runItemId} setItemId={setRunItemId} onBack={() => setView(runFrom)} />}
    </div>
  );
}

// A big Home-style tile (icon chip over title + subtitle, skin-adaptive, glossy sheen).
function BigTile({ Icon, titleHe, titleEn, subHe, subEn, he, badge, onClick }: {
  Icon: React.FC<any>; titleHe: string; titleEn: string; subHe: string; subEn: string; he: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="tap44" style={{ position: "relative", overflow: "hidden", textAlign: he ? "right" : "left",
      display: "flex", flexDirection: "column", gap: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18,
      padding: "16px 16px", cursor: "pointer", fontFamily: UI, color: C.text, minHeight: 128,
      boxShadow: `0 12px 28px -18px rgba(0,0,0,0.5), inset 0 1px 0 ${C.gold}18`, transition: "transform .14s ease" }}
      onPointerDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)"; }}
      onPointerUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}
      onPointerLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}>
      <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: "48%", background: `linear-gradient(180deg, ${C.gold}12 0%, rgba(255,255,255,0) 100%)`, pointerEvents: "none" }} />
      <span style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 13, display: "grid", placeItems: "center", background: `${C.gold}18`, border: `1px solid ${C.gold}44` }}>
          <Icon size={22} color={C.gold} strokeWidth={2.1} />
        </span>
        {typeof badge === "number" && badge > 0 && (
          <span style={{ marginInlineStart: "auto", fontFamily: MONO, fontSize: 12, fontWeight: 900, color: "#fff", background: C.loss, borderRadius: 999, padding: "2px 9px" }}>{badge}</span>
        )}
      </span>
      <span style={{ position: "relative", zIndex: 2, fontSize: 16, fontWeight: 900 }}>{he ? titleHe : titleEn}</span>
      <span style={{ position: "relative", zIndex: 2, fontSize: 11.5, color: C.muted, lineHeight: 1.5 }}>{he ? subHe : subEn}</span>
    </button>
  );
}

function domLabel(dom: string, he: boolean): string {
  const d = DOMAIN_LABEL[dom];
  return d ? (he ? d.he : d.en) : dom;
}

// ── Inline "+ New" create form — a staff editor / owner adds a custom task or audit item ──
// Available domains = the caller's writeDomains, intersected with the portal's domain scope
// (so a legal editor can't create a product item they'd then be unable to see). The new item
// comes back canWrite=true, so the creator can immediately edit / respond / run / approve it.
function CreateItemForm({ writeDomains, scopeDomains, sections, kind, he, onCreated, onClose }: {
  writeDomains: string[]; scopeDomains?: string[]; sections: string[]; kind: "task" | "audit"; he: boolean; onCreated: () => void; onClose: () => void;
}) {
  const avail = scopeDomains ? writeDomains.filter((d) => scopeDomains.includes(d)) : writeDomains;
  const [title, setTitle] = useState("");
  const [section, setSection] = useState("");
  const [domain, setDomain] = useState(avail[0] || "product");
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState("");
  const listId = `audit-sections-${kind}`;
  const m = useMutation({
    mutationFn: () => api.auditCreateItem({ title: title.trim(), prompt: prompt.trim(), domain, section: section.trim() }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: any) => setErr(e?.message || (he ? "יצירה נכשלה" : "Create failed")),
  });
  const submit = () => {
    if (!title.trim()) { setErr(he ? "נא להזין כותרת" : "A title is required"); return; }
    setErr(""); m.mutate();
  };
  const fieldLbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, color: C.muted, marginBottom: 3 };
  const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", color: C.text, fontFamily: UI, fontSize: 12.5 };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.gold}66`, borderRadius: 12, padding: 13, display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 900 }}>{kind === "task" ? (he ? "משימה חדשה" : "New task") : (he ? "פריט ביקורת חדש" : "New audit item")}</span>
        <button onClick={onClose} className="tap44" aria-label={he ? "סגור" : "Close"} style={{ ...miniBtn, marginInlineStart: "auto", padding: "5px 8px" }}><X size={13} /></button>
      </div>
      <div>
        <div style={fieldLbl}>{he ? "כותרת" : "Title"}</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} dir={he ? "rtl" : "ltr"} placeholder={he ? "מה צריך לבדוק / לעשות" : "What to check / do"} style={inputStyle} autoFocus />
      </div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        {avail.length > 1 && (
          <div style={{ flex: "1 1 140px", minWidth: 120 }}>
            <div style={fieldLbl}>{he ? "תחום" : "Domain"}</div>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} style={inputStyle}>
              {avail.map((d) => <option key={d} value={d}>{domLabel(d, he)}</option>)}
            </select>
          </div>
        )}
        <div style={{ flex: "2 1 180px", minWidth: 140 }}>
          <div style={fieldLbl}>{he ? "סעיף" : "Section"}</div>
          <input value={section} onChange={(e) => setSection(e.target.value)} list={listId} dir={he ? "rtl" : "ltr"} placeholder={he ? "אופציונלי — בחר קיים או צור חדש" : "Optional — pick existing or type new"} style={inputStyle} />
          <datalist id={listId}>{sections.map((s) => <option key={s} value={s} />)}</datalist>
        </div>
      </div>
      <div>
        <div style={fieldLbl}>{he ? "פרומפט (הבדיקה / התיאור)" : "Prompt (the check / description)"}</div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} dir={he ? "rtl" : "ltr"} placeholder={he ? "אופציונלי" : "Optional"} style={{ ...inputStyle, minHeight: 54, lineHeight: 1.5, resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={submit} disabled={m.isPending} className="tap44" style={{ ...actBtn, background: "#2e9b57", color: "#fff", border: "none" }}>
          {m.isPending ? <Loader2 size={13} className="spin" /> : <Plus size={14} />} {he ? "הוסף" : "Add"}
        </button>
        {err && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.loss }}>{err}</span>}
      </div>
    </div>
  );
}

// ── Screen 1 · Board ──────────────────────────────────────────────────────────────
function AuditBoard({ domains, master = false, he, onRun }: { domains?: string[]; master?: boolean; he: boolean; onRun: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auditItems"], queryFn: () => api.auditItems(), retry: false });
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [domFilter, setDomFilter] = useState<string>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState<{ text: string; count: number } | null>(null);
  const [creating, setCreating] = useState(false);

  const dailyM = useMutation({
    // Portal embed → one domain scopes to it; multi-domain (IT: it+product) or admin →
    // no domain, so the server bundles all the caller's writable domains.
    mutationFn: () => api.auditDailyPrompt(domains && domains.length === 1 ? domains[0] : (!domains && domFilter !== "all" ? domFilter : undefined)),
    onSuccess: (r) => { setPrompt({ text: r.text, count: r.count }); qc.invalidateQueries({ queryKey: ["auditItems"] }); },
  });

  const writeDomains = q.data?.writeDomains || [];
  const sections = useMemo(() => {
    const secs = q.data?.sections || [];
    return secs
      .map((s) => ({
        section: s.section,
        items: s.items.filter((it) =>
          (domains ? domains.includes(it.domain) : (domFilter === "all" || it.domain === domFilter)) &&
          (statusFilter === "all" || it.status === statusFilter)),
      }))
      .filter((s) => s.items.length > 0);
  }, [q.data, statusFilter, domFilter, domains]);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const canGenerate = (domains ? domains.some((d) => writeDomains.includes(d)) : writeDomains.length > 0);
  const allSections = (q.data?.sections || []).map((s) => s.section);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Select value={statusFilter} onChange={setStatusFilter} opts={[["all", he ? "כל הסטטוסים" : "All statuses"], ["todo", he ? "לביצוע" : "To do"], ["in_process", he ? "בעבודה" : "In process"], ["redo", he ? "לחזור" : "Redo"], ["approved", he ? "מאושר" : "Approved"]]} />
        {!domains && <Select value={domFilter} onChange={setDomFilter} opts={[["all", he ? "כל התחומים" : "All domains"], ["it", "IT"], ["legal", he ? "משפטי" : "Legal"], ["product", he ? "מוצר" : "Product"]]} />}
        <span style={{ fontSize: 11.5, color: C.faint, fontFamily: MONO }}>{total} {he ? "פריטים" : "items"}</span>
        {canGenerate && (
          <button onClick={() => setCreating((v) => !v)} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px", fontFamily: UI, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
            <Plus size={14} /> {he ? "פריט ביקורת חדש" : "New audit item"}
          </button>
        )}
        {canGenerate && (
          <button onClick={() => dailyM.mutate()} disabled={dailyM.isPending} className="tap44" style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 7, background: C.gain, color: "#fff", border: "none", borderRadius: 10, padding: "8px 14px", fontFamily: UI, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
            {dailyM.isPending ? <Loader2 size={14} className="spin" /> : <ClipboardCheck size={14} />} {master ? (he ? "צור פרומפט ראשי" : "Generate master prompt") : (he ? "צור פרומפט יומי" : "Generate today's audit prompt")}
          </button>
        )}
      </div>

      {creating && (
        <CreateItemForm writeDomains={writeDomains} scopeDomains={domains} sections={allSections} kind="audit" he={he}
          onCreated={() => qc.invalidateQueries({ queryKey: ["auditItems"] })} onClose={() => setCreating(false)} />
      )}

      {/* Bundled prompt box */}
      {prompt && (
        <div style={{ background: C.surface2, border: `1px solid ${C.gold}66`, borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 800 }}>{he ? `פרומפט יומי · ${prompt.count} פריטים פתוחים` : `Today's prompt · ${prompt.count} open items`}</span>
            <button onClick={() => { try { navigator.clipboard?.writeText(prompt.text); } catch { /* */ } }} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 10px", fontFamily: UI, fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>
              <Copy size={12} /> {he ? "העתק" : "Copy"}
            </button>
          </div>
          <textarea readOnly value={prompt.text} dir={he ? "rtl" : "ltr"} style={{ width: "100%", boxSizing: "border-box", minHeight: 160, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", color: C.text, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.55, resize: "vertical" }} />
        </div>
      )}

      {q.isLoading ? (
        <Loading he={he} />
      ) : q.isError ? (
        <ErrLine he={he} onRetry={() => q.refetch()} />
      ) : total === 0 ? (
        <div style={{ color: C.faint, fontSize: 13, padding: "18px 0" }}>{he ? "אין פריטים בפילטר הנוכחי." : "No items match the current filter."}</div>
      ) : (
        sections.map((s) => {
          const open = !collapsed[s.section];
          return (
            <div key={s.section} style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
              <button onClick={() => setCollapsed((c) => ({ ...c, [s.section]: open }))} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: "none", padding: "10px 13px", cursor: "pointer", fontFamily: UI, color: C.text }}>
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span style={{ fontSize: 13, fontWeight: 800 }}>{s.section}</span>
                <span style={{ fontSize: 11, color: C.faint, fontFamily: MONO, marginInlineStart: "auto" }}>{s.items.length}</span>
              </button>
              {open && s.items.map((it) => <AuditRow key={it.id} item={it} he={he} onRun={onRun} onChanged={() => qc.invalidateQueries({ queryKey: ["auditItems"] })} />)}
            </div>
          );
        })
      )}
    </div>
  );
}

function AuditRow({ item, he, onRun, onChanged }: { item: AuditItem; he: boolean; onRun: (id: number) => void; onChanged: () => void }) {
  const [prompt, setPrompt] = useState(item.prompt);
  const [note, setNote] = useState(item.doneNote);
  const [msg, setMsg] = useState("");
  const cw = !!item.canWrite;
  React.useEffect(() => { setPrompt(item.prompt); setNote(item.doneNote); }, [item.prompt, item.doneNote]);

  const saveM = useMutation({ mutationFn: (b: { prompt?: string; doneNote?: string }) => api.auditSaveItem(item.id, b), onSuccess: () => { setMsg(he ? "נשמר ✓" : "Saved ✓"); onChanged(); setTimeout(() => setMsg(""), 2000); }, onError: (e: any) => setMsg(e?.message || "Save failed") });
  const statusM = useMutation({ mutationFn: (s: string) => api.auditSetStatus(item.id, s), onSuccess: onChanged });

  const bl = BASELINE[item.baseline] || BASELINE.missing;
  const st = STATUS_META[item.status] || STATUS_META.todo;
  const dom = DOMAIN_LABEL[item.domain];
  const promptDirty = prompt !== item.prompt;
  const noteDirty = note !== item.doneNote;

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 13px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {dom && <span style={chip(he ? dom.he : dom.en, dom.color)}>{he ? dom.he : dom.en}</span>}
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 120 }}>{item.title}</span>
        <span style={chip(`${bl.icon} ${he ? bl.he : bl.en}`, bl.color)}>{bl.icon} {he ? bl.he : bl.en}</span>
        <span style={chip(he ? st.he : st.en, st.color)}>{he ? st.he : st.en}</span>
      </div>

      {/* sent + done-note */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11.5 }}>
        <span style={{ color: C.faint }}>{he ? "נשלח:" : "Sent:"} {item.sentAt ? item.sentAt.slice(0, 16).replace("T", " ") : "—"}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 180 }}>
          <span style={{ color: C.muted, whiteSpace: "nowrap" }}>{he ? "מה בוצע:" : "Done:"}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} readOnly={!cw} placeholder={he ? "—" : "—"} style={{ flex: 1, minWidth: 120, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 9px", color: C.text, fontFamily: UI, fontSize: 12 }} />
          {cw && noteDirty && <button onClick={() => saveM.mutate({ doneNote: note })} className="tap44" style={miniBtn}>{he ? "שמור" : "Save"}</button>}
        </div>
      </div>

      {/* prompt */}
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, marginBottom: 3 }}>{he ? "פרומפט (הבדיקה)" : "Prompt (the check)"}</div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} readOnly={!cw} dir={he ? "rtl" : "ltr"} style={{ width: "100%", boxSizing: "border-box", minHeight: 54, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: UI, fontSize: 12, lineHeight: 1.5, resize: "vertical", opacity: cw ? 1 : 0.8 }} />
      </div>

      {/* actions */}
      {cw && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {promptDirty && <button onClick={() => saveM.mutate({ prompt })} disabled={saveM.isPending} className="tap44" style={{ ...actBtn, background: C.surface2, color: C.text, borderColor: C.line }}>{saveM.isPending ? <Loader2 size={13} className="spin" /> : <Check size={13} />} {he ? "שמור פרומפט" : "Save prompt"}</button>}
          <button onClick={() => onRun(item.id)} className="tap44" style={{ ...actBtn, background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none" }}><Play size={13} /> {he ? "הרץ" : "Run"}</button>
          <button onClick={() => statusM.mutate("approved")} disabled={statusM.isPending} className="tap44" style={{ ...actBtn, background: "#2e9b57", color: "#fff", border: "none" }}><Check size={13} /> {he ? "אשר" : "Approve"}</button>
          <button onClick={() => statusM.mutate("in_process")} disabled={statusM.isPending} className="tap44" style={{ ...actBtn, background: C.surface2, color: C.text, borderColor: C.line }}>{he ? "בעבודה" : "In process"}</button>
          <button onClick={() => statusM.mutate("redo")} disabled={statusM.isPending} className="tap44" style={{ ...actBtn, background: C.surface2, color: "#c0392b", borderColor: "#c0392b66" }}><RotateCcw size={13} /> {he ? "לחזור" : "Redo"}</button>
          {msg && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.gain }}>{msg}</span>}
        </div>
      )}
    </div>
  );
}

// ── Tasks Manager · the OPEN audit items as a live task queue (drives Run→Approve) ──
function TasksManager({ domains, master, he, onOpen }: { domains?: string[]; master?: boolean; he: boolean; onOpen: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auditItems"], queryFn: () => api.auditItems(), retry: false });
  const [creating, setCreating] = useState(false);
  const order: Record<string, number> = { redo: 0, in_process: 1, todo: 2 };
  const tasks = ((q.data?.sections || []).flatMap((s) => s.items)
    .filter((it) => (!domains || domains.includes(it.domain)) && it.status !== "approved"))
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  const writeDomains = q.data?.writeDomains || [];
  const allSections = (q.data?.sections || []).map((s) => s.section);
  const canCreate = (domains ? domains.some((d) => writeDomains.includes(d)) : writeDomains.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, flex: 1, minWidth: 180 }}>
          {he ? `${tasks.length} משימות פתוחות — כל פריט שאינו מאושר. פתחו משימה כדי להריץ, לתעד תוצאה ולאשר עד לסגירה.`
              : `${tasks.length} open tasks — every non-approved item. Open a task to run it, record the result, and approve to completion.`}
        </div>
        {canCreate && (
          <button onClick={() => setCreating((v) => !v)} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none", borderRadius: 10, padding: "8px 13px", fontFamily: UI, fontSize: 12.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
            <Plus size={14} /> {he ? "משימה חדשה" : "New task"}
          </button>
        )}
      </div>
      {creating && (
        <CreateItemForm writeDomains={writeDomains} scopeDomains={domains} sections={allSections} kind="task" he={he}
          onCreated={() => qc.invalidateQueries({ queryKey: ["auditItems"] })} onClose={() => setCreating(false)} />
      )}
      {q.isLoading ? <Loading he={he} /> : q.isError ? <ErrLine he={he} onRetry={() => q.refetch()} /> : tasks.length === 0 ? (
        <div style={{ color: C.gain, fontSize: 13, padding: "18px 0", fontWeight: 700 }}>{he ? "✓ אין משימות פתוחות — הכל אושר." : "✓ No open tasks — everything is approved."}</div>
      ) : (
        tasks.map((it) => {
          const st = STATUS_META[it.status] || STATUS_META.todo;
          const dom = DOMAIN_LABEL[it.domain];
          return (
            <div key={it.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderInlineStart: `4px solid ${st.color}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                {master && dom && <span style={chip(he ? dom.he : dom.en, dom.color)}>{he ? dom.he : dom.en}</span>}
                <span style={{ fontSize: 10.5, color: C.faint }}>{it.section}</span>
                <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 120 }}>{it.title}</span>
                <span style={chip(he ? st.he : st.en, st.color)}>{he ? st.he : st.en}</span>
              </div>
              {it.doneNote && <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>{it.doneNote}</div>}
              <button onClick={() => onOpen(it.id)} className="tap44" style={{ ...actBtn, background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none" }}>
                <Play size={13} /> {he ? "פתח משימה" : "Open task"}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── Screen 2 · Run ──────────────────────────────────────────────────────────────
function AuditRunView({ domains, he, itemId, setItemId, onBack }: { domains?: string[]; he: boolean; itemId: number | null; setItemId: (id: number | null) => void; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["auditItems"], queryFn: () => api.auditItems(), retry: false });
  const allItems = useMemo(() => (q.data?.sections || []).flatMap((s) => s.items).filter((it) => !domains || domains.includes(it.domain)), [q.data, domains]);
  const item = allItems.find((it) => it.id === itemId) || null;
  const runsQ = useQuery({ queryKey: ["auditRuns", itemId], queryFn: () => api.auditRuns(itemId!), enabled: !!itemId, retry: false });
  const [result, setResult] = useState("");
  const [activeRun, setActiveRun] = useState<number | null>(null);

  const runM = useMutation({ mutationFn: () => api.auditRun(item!.id), onSuccess: (r) => { setActiveRun(r.run.id); setResult(r.run.resultText || ""); qc.invalidateQueries({ queryKey: ["auditRuns", itemId] }); qc.invalidateQueries({ queryKey: ["auditItems"] }); } });
  const saveRunM = useMutation({ mutationFn: () => api.auditSaveRun(activeRun!, result), onSuccess: () => qc.invalidateQueries({ queryKey: ["auditRuns", itemId] }) });
  const approveM = useMutation({ mutationFn: (runId: number) => api.auditApproveRun(runId), onSuccess: () => { qc.invalidateQueries({ queryKey: ["auditRuns", itemId] }); qc.invalidateQueries({ queryKey: ["auditItems"] }); } });

  const cw = !!item?.canWrite;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onBack} className="tap44" style={{ ...miniBtn, display: "inline-flex", alignItems: "center", gap: 5 }}><ArrowLeft size={13} /> {he ? "ללוח" : "Board"}</button>
        <select value={itemId ?? ""} onChange={(e) => { setItemId(e.target.value ? Number(e.target.value) : null); setActiveRun(null); setResult(""); }} style={{ flex: 1, minWidth: 200, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", color: C.text, fontFamily: UI, fontSize: 12.5 }}>
          <option value="">{he ? "בחר פריט לביקורת…" : "Pick an audit item…"}</option>
          {allItems.map((it) => <option key={it.id} value={it.id}>{`[${it.domain}] ${it.section} · ${it.title}`}</option>)}
        </select>
      </div>

      {!item ? (
        <div style={{ color: C.faint, fontSize: 13, padding: "18px 0" }}>{he ? "בחר פריט כדי להריץ בדיקה." : "Pick an item to run a check."}</div>
      ) : (
        <>
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 13 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 6 }}>{item.title}</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, marginBottom: 3 }}>{he ? "פרומפט" : "Prompt"}</div>
            <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px" }}>{item.prompt}</div>
            {cw && (
              <button onClick={() => runM.mutate()} disabled={runM.isPending} className="tap44" style={{ ...actBtn, marginTop: 10, background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none" }}>
                {runM.isPending ? <Loader2 size={13} className="spin" /> : <Play size={13} />} {he ? "הרץ בדיקה" : "Run check"}
              </button>
            )}
          </div>

          {/* Active run result editor */}
          {activeRun && (
            <div style={{ background: C.surface, border: `1px solid ${C.gold}66`, borderRadius: 12, padding: 13 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 6 }}>{he ? "תוצאת ההרצה — הדביקו את הפלט" : "Run result — paste the output"}</div>
              <textarea value={result} onChange={(e) => setResult(e.target.value)} dir={he ? "rtl" : "ltr"} style={{ width: "100%", boxSizing: "border-box", minHeight: 120, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 11px", color: C.text, fontFamily: UI, fontSize: 12.5, lineHeight: 1.55, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button onClick={() => saveRunM.mutate()} disabled={saveRunM.isPending} className="tap44" style={{ ...actBtn, background: C.surface2, color: C.text, borderColor: C.line }}>{saveRunM.isPending ? <Loader2 size={13} className="spin" /> : <Check size={13} />} {he ? "שמור תוצאה" : "Save result"}</button>
                <button onClick={() => approveM.mutate(activeRun)} disabled={approveM.isPending} className="tap44" style={{ ...actBtn, background: "#2e9b57", color: "#fff", border: "none" }}>{approveM.isPending ? <Loader2 size={13} className="spin" /> : <Check size={13} />} {he ? "אשר תוצאה" : "Approve result"}</button>
              </div>
            </div>
          )}

          {/* Run history */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 6 }}>{he ? "היסטוריית הרצות" : "Run history"}</div>
            {runsQ.isLoading ? <Loading he={he} /> : (runsQ.data?.runs || []).length === 0 ? (
              <div style={{ fontSize: 12, color: C.faint }}>{he ? "אין הרצות עדיין." : "No runs yet."}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(runsQ.data?.runs || []).map((r: AuditRun) => (
                  <div key={r.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: C.faint, fontFamily: MONO }}>{r.runAt ? r.runAt.slice(0, 16).replace("T", " ") : ""}</span>
                      <span style={chip(r.status === "approved" ? (he ? "מאושר" : "Approved") : (he ? "ממתין" : "Pending"), r.status === "approved" ? "#2e9b57" : "#c98a1a")} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: r.status === "approved" ? "#2e9b57" : "#c98a1a" }}>{r.status === "approved" ? (he ? "מאושר" : "Approved") : (he ? "ממתין" : "Pending")}</span>
                      {cw && r.status !== "approved" && <button onClick={() => approveM.mutate(r.id)} disabled={approveM.isPending} className="tap44" style={{ ...miniBtn, marginInlineStart: "auto" }}>{he ? "אשר" : "Approve"}</button>}
                    </div>
                    {r.resultText && <div style={{ fontSize: 12, color: C.muted, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{r.resultText}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = { background: C.surface2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 10px", fontFamily: UI, fontSize: 11.5, fontWeight: 800, cursor: "pointer" };
const actBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9, padding: "7px 12px", fontFamily: UI, fontSize: 12, fontWeight: 800, cursor: "pointer", border: `1px solid ${C.line}` };

function Select({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", color: C.text, fontFamily: UI, fontSize: 12 }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Loading({ he }: { he: boolean }) {
  return <div style={{ color: C.muted, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 0" }}><Loader2 size={15} className="spin" /> {he ? "טוען…" : "Loading…"}</div>;
}
function ErrLine({ he, onRetry }: { he: boolean; onRetry: () => void }) {
  return <div style={{ color: C.loss, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 0" }}><AlertTriangle size={15} /> {he ? "טעינה נכשלה." : "Couldn't load."} <button onClick={onRetry} style={{ ...miniBtn }}>{he ? "נסה שוב" : "Retry"}</button></div>;
}
