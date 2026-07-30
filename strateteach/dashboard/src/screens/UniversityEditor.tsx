import React, { useEffect, useState } from "react";
import {
  X, Plus, Save, Trash2, Loader2, Eye, EyeOff, Download,
  Search, FlaskConical, Wand2, TrendingUp, ArrowLeftRight, Send, Activity, Layers, BookOpen, Rocket, Info, BarChart3, ShieldAlert,
} from "lucide-react";
import { api } from "../app/api";
import { C, UI } from "../theme";
import { btn } from "../ui";
import type { UniItem, UniItemInput, UniSection } from "../lib/client";

// Shared lucide-key → component map for concept icons (used by the editor picker AND
// the public University render, so keys never drift).
export const UNI_ICONS: Record<string, any> = {
  Search, FlaskConical, Wand2, TrendingUp, ArrowLeftRight, Send, Activity, Layers, BookOpen, Rocket, Info, BarChart3, ShieldAlert,
};
const ICON_KEYS = Object.keys(UNI_ICONS);

const SECTIONS: { id: UniSection; he: string; en: string }[] = [
  { id: "getting_started", he: "צעדים ראשונים", en: "Getting started" },
  { id: "concepts", he: "מושגים", en: "Concepts" },
  { id: "glossary", he: "מילון מונחים", en: "Glossary" },
];

// Content-editor manager for the University / Learn content — overlay panel, mirrors the
// Reels lesson manager. Lists items per section; add / edit / publish / delete; and (when
// the store is empty) a one-click import of the app's built-in content to start from.
export default function UniversityEditor({ onClose, onChanged, builtin, he, rtl }: {
  onClose: () => void; onChanged: () => void; builtin: UniItemInput[]; he: boolean; rtl: boolean;
}) {
  const [items, setItems] = useState<UniItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<number | null>(null);   // item id, or -1 for new
  const [form, setForm] = useState<UniItemInput>({});

  const refresh = async () => {
    setLoading(true);
    try { const r = await api.universityAdmin(); setItems(r.items || []); }
    catch (e: any) { setErr(e?.message || "load failed"); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const startNew = (section: UniSection) => {
    setEditing(-1);
    setForm({ section, icon: section === "concepts" ? "Layers" : "", title_he: "", title_en: "", body_he: "", body_en: "", published: true });
  };
  const startEdit = (it: UniItem) => {
    setEditing(it.id);
    setForm({ section: it.section, icon: it.icon, title_he: it.titleHe, title_en: it.titleEn, body_he: it.bodyHe, body_en: it.bodyEn, published: it.published });
  };
  const cancel = () => { setEditing(null); setForm({}); };

  const save = async () => {
    setBusy(true); setErr("");
    try {
      if (editing === -1) await api.createUniversityItem(form);
      else if (editing != null) await api.updateUniversityItem(editing, form);
      cancel(); await refresh(); onChanged();
    } catch (e: any) { setErr(e?.message || "save failed"); }
    finally { setBusy(false); }
  };
  const togglePub = async (it: UniItem) => {
    try { await api.updateUniversityItem(it.id, { published: !it.published }); await refresh(); onChanged(); } catch (e: any) { setErr(e?.message || "failed"); }
  };
  const remove = async (it: UniItem) => {
    if (!confirm(he ? "למחוק פריט זה?" : "Delete this item?")) return;
    try { await api.deleteUniversityItem(it.id); if (editing === it.id) cancel(); await refresh(); onChanged(); } catch (e: any) { setErr(e?.message || "failed"); }
  };
  const importBuiltin = async () => {
    setBusy(true); setErr("");
    try { await api.importUniversityItems(builtin); await refresh(); onChanged(); }
    catch (e: any) { setErr(e?.message || "import failed"); }
    finally { setBusy(false); }
  };

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 4, display: "block" };
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", color: C.text, fontFamily: UI, fontSize: 13.5 };
  const secLabel = (s: string) => { const x = SECTIONS.find((k) => k.id === s); return x ? (he ? x.he : x.en) : s; };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,0.6)", display: "grid", placeItems: "center", padding: 14, direction: rtl ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(720px, 96vw)", maxHeight: "92vh", overflowY: "auto",
        background: C.surface, border: `1px solid ${C.glassBd || C.line}`, borderRadius: 18, padding: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.5)", fontFamily: UI }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <BookOpen size={17} color={C.gold} />
          <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "עורך תוכן — אוניברסיטה" : "Content editor — University"}</span>
          <button onClick={onClose} className="tap44" style={{ marginInlineStart: "auto", background: "none", border: "none", color: C.muted, cursor: "pointer", display: "inline-flex" }}><X size={18} /></button>
        </div>

        {err && <div style={{ background: `${C.loss}1a`, border: `1px solid ${C.loss}66`, color: C.loss, borderRadius: 9, padding: "8px 11px", fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

        {loading ? (
          <div style={{ display: "grid", placeItems: "center", padding: 30 }}><Loader2 size={20} className="spin" color={C.gold} /></div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 10px" }}>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
              {he ? "העורך ריק. ייבאו את התוכן המובנה של המערכת כדי להתחיל לערוך אותו — עד אז המסך הציבורי מציג את התוכן המובנה כרגיל." : "The editor is empty. Import the app's built-in content to start editing it — until then the public screen shows the built-in content as usual."}
            </p>
            <button onClick={importBuiltin} disabled={busy} style={{ ...btn(true) }}>
              {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} {he ? "ייבא תוכן מובנה" : "Import built-in content"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {SECTIONS.map((sec) => {
              const list = items.filter((it) => it.section === sec.id);
              return (
                <div key={sec.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{he ? sec.he : sec.en}</span>
                    <span style={{ fontSize: 11, color: C.faint }}>· {list.length}</span>
                    <button onClick={() => startNew(sec.id)} className="tap44" style={{ marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`, color: C.gold, borderRadius: 9, padding: "5px 10px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: UI }}>
                      <Plus size={13} /> {he ? "הוסף" : "Add"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {list.map((it) => (
                      <div key={it.id} style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 11px", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(he ? it.titleHe : it.titleEn) || (he ? it.bodyHe : it.bodyEn) || "—"}
                        </span>
                        {!it.published && <span style={{ fontSize: 9, fontWeight: 800, color: C.faint, border: `1px solid ${C.line}`, borderRadius: 4, padding: "1px 5px" }}>{he ? "טיוטה" : "DRAFT"}</span>}
                        <button onClick={() => togglePub(it)} className="tap44" title={it.published ? "unpublish" : "publish"} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", display: "inline-flex" }}>{it.published ? <Eye size={15} /> : <EyeOff size={15} />}</button>
                        <button onClick={() => startEdit(it)} className="tap44" style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", fontSize: 12, fontWeight: 800, fontFamily: UI }}>{he ? "ערוך" : "Edit"}</button>
                        <button onClick={() => remove(it)} className="tap44" style={{ background: "none", border: "none", color: C.loss, cursor: "pointer", display: "inline-flex" }}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {editing != null && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 11 }}>
            <div style={{ fontSize: 12.5, fontWeight: 900, color: C.gold }}>
              {editing === -1 ? (he ? "פריט חדש" : "New item") : (he ? "עריכת פריט" : "Edit item")} · {secLabel(form.section || "")}
            </div>
            {form.section === "concepts" && (
              <div>
                <label style={lbl}>{he ? "אייקון" : "Icon"}</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ICON_KEYS.map((k) => { const IC = UNI_ICONS[k]; const on = form.icon === k; return (
                    <button key={k} onClick={() => setForm((f) => ({ ...f, icon: k }))} className="tap44" title={k}
                      style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", cursor: "pointer",
                        background: on ? C.accentGrad : C.surface2, border: `1px solid ${on ? "transparent" : C.line}` }}>
                      <IC size={16} color={on ? "#0B0613" : C.muted} />
                    </button>
                  ); })}
                </div>
              </div>
            )}
            {form.section !== "getting_started" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <div><label style={lbl}>{he ? "כותרת (עברית)" : "Title (Hebrew)"}</label>
                  <input value={form.title_he || ""} onChange={(e) => setForm((f) => ({ ...f, title_he: e.target.value }))} dir="rtl" style={inp} /></div>
                <div><label style={lbl}>{he ? "כותרת (אנגלית)" : "Title (English)"}</label>
                  <input value={form.title_en || ""} onChange={(e) => setForm((f) => ({ ...f, title_en: e.target.value }))} dir="ltr" style={inp} /></div>
              </div>
            )}
            <div>
              <label style={lbl}>{he ? "תוכן (עברית)" : "Body (Hebrew)"}{form.section === "concepts" ? (he ? " · שורה ריקה = פסקה חדשה" : " · blank line = new paragraph") : ""}</label>
              <textarea value={form.body_he || ""} onChange={(e) => setForm((f) => ({ ...f, body_he: e.target.value }))} dir="rtl" rows={form.section === "concepts" ? 5 : 2} style={{ ...inp, resize: "vertical", lineHeight: 1.55 }} />
            </div>
            <div>
              <label style={lbl}>{he ? "תוכן (אנגלית)" : "Body (English)"}</label>
              <textarea value={form.body_en || ""} onChange={(e) => setForm((f) => ({ ...f, body_en: e.target.value }))} dir="ltr" rows={form.section === "concepts" ? 5 : 2} style={{ ...inp, resize: "vertical", lineHeight: 1.55 }} />
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.text, cursor: "pointer" }}>
              <input type="checkbox" checked={form.published !== false} onChange={(e) => setForm((f) => ({ ...f, published: e.target.checked }))} />
              {he ? "מפורסם (גלוי למשתמשים)" : "Published (visible to users)"}
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={save} disabled={busy} style={btn(true)}>{busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}</button>
              <button onClick={cancel} style={btn(false)}>{he ? "ביטול" : "Cancel"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
