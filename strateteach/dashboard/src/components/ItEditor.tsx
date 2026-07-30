import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Link2, Plus, Save, Trash2, Loader2, X, ExternalLink, Pencil, Check,
} from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, SHADOW } from "../theme";
import { input, btn } from "../ui";
import type { ItDoc, ItLink } from "../lib/client";

// ── ItEditor — the IT portal's "ניהול ועריכה" tab (domain='it'). Two areas:
//   1. תיעוד ומסמכים — editable IT notes / documentation entries (it_docs).
//   2. קישור המערכות שלך אלינו — the "link your system to us" area: Oren records links /
//      connections / references (it_links) for the owners to see.
// The legal domain's equivalent editing tab is the legal-text editor; IT gets this store.
const DOMAIN = "it" as const;

export default function ItEditor() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, direction: rtl ? "rtl" : "ltr" }}>
      <DocsSection he={he} rtl={rtl} />
      <LinksSection he={he} rtl={rtl} />
    </div>
  );
}

// ── Docs / documentation ──────────────────────────────────────────────────────
function DocsSection({ he, rtl }: { he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["portalDocs", DOMAIN], queryFn: () => api.portalDocs(DOMAIN) });
  const docs = (q.data?.docs || []) as ItDoc[];
  const inval = () => qc.invalidateQueries({ queryKey: ["portalDocs", DOMAIN] });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, color: C.text }}>
          <FileText size={17} color={C.gold} /> {he ? "תיעוד ומסמכים" : "Notes & documentation"}
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ ...btn(true) }}>
            <Plus size={15} /> {he ? "מסמך חדש" : "New doc"}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        {he ? "תיעוד טכני, הערות והחלטות — נערך על ידך ונראה לבעלים." : "Technical documentation, notes & decisions — edited by you, visible to the owners."}
      </div>

      {adding && <DocCard he={he} rtl={rtl} doc={null} onDone={() => { setAdding(false); inval(); }} onCancel={() => setAdding(false)} />}

      {q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
      ) : docs.length === 0 && !adding ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>{he ? "אין עדיין מסמכים — צור אחד." : "No docs yet — create one."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: adding ? 10 : 0 }}>
          {docs.map((d) => <DocCard key={d.id} he={he} rtl={rtl} doc={d} onDone={inval} onCancel={() => {}} />)}
        </div>
      )}
    </div>
  );
}

function DocCard({ he, rtl, doc, onDone, onCancel }: { he: boolean; rtl: boolean; doc: ItDoc | null; onDone: () => void; onCancel: () => void }) {
  const isNew = !doc;
  const [open, setOpen] = useState(isNew);
  const [title, setTitle] = useState(doc?.title || "");
  const [body, setBody] = useState(doc?.body || "");
  const save = useMutation({
    mutationFn: () => api.portalDocUpsert(DOMAIN, { id: doc?.id, title: title.trim(), body }),
    onSuccess: () => { if (isNew) { setTitle(""); setBody(""); } onDone(); if (isNew) onCancel(); },
  });
  const del = useMutation({ mutationFn: () => api.portalDocDelete(DOMAIN, doc!.id), onSuccess: onDone });

  if (!isNew && !open) {
    return (
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc!.title || (he ? "(ללא כותרת)" : "(untitled)")}</span>
        <button onClick={() => setOpen(true)} title={he ? "עריכה" : "Edit"} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", display: "inline-flex" }}><Pencil size={15} /></button>
      </div>
    );
  }

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  return (
    <div style={{ background: C.surface, border: `1px solid ${isNew ? C.gold : C.line}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <label style={lbl}>{he ? "כותרת" : "Title"}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} dir={rtl ? "rtl" : "ltr"} autoFocus={isNew}
          placeholder={he ? "לדוגמה: ארכיטקטורת השרתים" : "e.g. Server architecture"} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div>
        <label style={lbl}>{he ? "תוכן" : "Content"}</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} dir={rtl ? "rtl" : "ltr"}
          style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 120, lineHeight: 1.6, resize: "vertical" }} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => save.mutate()} disabled={save.isPending || !(title.trim() || body.trim())} style={{ ...btn(true) }}>
          {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}
        </button>
        {isNew ? (
          <button onClick={onCancel} style={{ ...btn(false) }}><X size={15} /> {he ? "ביטול" : "Cancel"}</button>
        ) : (
          <>
            <button onClick={() => setOpen(false)} style={{ ...btn(false) }}>{he ? "סגור" : "Close"}</button>
            <button onClick={() => { if (confirm(he ? "למחוק את המסמך?" : "Delete this doc?")) del.mutate(); }} disabled={del.isPending}
              style={{ ...btn(false), color: C.loss, marginInlineStart: "auto" }}><Trash2 size={15} /> {he ? "מחק" : "Delete"}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── System links — "link your system to us" ───────────────────────────────────
function LinksSection({ he, rtl }: { he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["portalLinks", DOMAIN], queryFn: () => api.portalLinks(DOMAIN) });
  const links = (q.data?.links || []) as ItLink[];
  const inval = () => qc.invalidateQueries({ queryKey: ["portalLinks", DOMAIN] });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, color: C.text }}>
          <Link2 size={17} color={C.gold} /> {he ? "קישור המערכות שלך אלינו" : "Link your systems to us"}
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ ...btn(true) }}>
            <Plus size={15} /> {he ? "קישור חדש" : "New link"}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        {he ? "הוסף קישורים, חיבורים והפניות למערכות שלך — כדי שהבעלים יראו את מה שמחובר." : "Add links, connections & references to your systems — so the owners can see what's wired up."}
      </div>

      {adding && <LinkCard he={he} rtl={rtl} link={null} onDone={() => { setAdding(false); inval(); }} onCancel={() => setAdding(false)} />}

      {q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
      ) : links.length === 0 && !adding ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>{he ? "אין עדיין קישורים — הוסף אחד." : "No links yet — add one."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: adding ? 10 : 0 }}>
          {links.map((l) => <LinkCard key={l.id} he={he} rtl={rtl} link={l} onDone={inval} onCancel={() => {}} />)}
        </div>
      )}
    </div>
  );
}

function LinkCard({ he, rtl, link, onDone, onCancel }: { he: boolean; rtl: boolean; link: ItLink | null; onDone: () => void; onCancel: () => void }) {
  const isNew = !link;
  const [editing, setEditing] = useState(isNew);
  const [label, setLabel] = useState(link?.label || "");
  const [url, setUrl] = useState(link?.url || "");
  const [note, setNote] = useState(link?.note || "");
  const save = useMutation({
    mutationFn: () => api.portalLinkUpsert(DOMAIN, { id: link?.id, label: label.trim(), url: url.trim(), note: note.trim() }),
    onSuccess: () => { if (isNew) { setLabel(""); setUrl(""); setNote(""); } onDone(); if (isNew) onCancel(); else setEditing(false); },
  });
  const del = useMutation({ mutationFn: () => api.portalLinkDelete(DOMAIN, link!.id), onSuccess: onDone });

  if (!isNew && !editing) {
    const href = /^https?:\/\//i.test(link!.url) ? link!.url : `https://${link!.url}`;
    return (
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{link!.label || link!.url}</div>
          {link!.url && <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: C.gold, textDecoration: "none", wordBreak: "break-all" }}>{link!.url}</a>}
          {link!.note && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{link!.note}</div>}
        </div>
        {link!.url && <a href={href} target="_blank" rel="noreferrer" title={he ? "פתח" : "Open"} style={{ color: C.gold, display: "inline-flex" }}><ExternalLink size={15} /></a>}
        <button onClick={() => setEditing(true)} title={he ? "עריכה" : "Edit"} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", display: "inline-flex" }}><Pencil size={14} /></button>
        <button onClick={() => { if (confirm(he ? "למחוק את הקישור?" : "Delete this link?")) del.mutate(); }} disabled={del.isPending} title={he ? "מחק" : "Delete"} style={{ background: "none", border: "none", color: C.loss, cursor: "pointer", display: "inline-flex" }}><Trash2 size={14} /></button>
      </div>
    );
  }

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  return (
    <div style={{ background: C.surface, border: `1px solid ${isNew ? C.gold : C.line}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <div>
          <label style={lbl}>{he ? "שם" : "Label"}</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} dir={rtl ? "rtl" : "ltr"} autoFocus={isNew}
            placeholder={he ? "לדוגמה: לוח בקרה של השרתים" : "e.g. Server dashboard"} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </div>
        <div>
          <label style={lbl}>{he ? "קישור (URL)" : "Link (URL)"}</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr"
            placeholder="https://…" style={{ ...input, width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
      <div>
        <label style={lbl}>{he ? "הערה (אופציונלי)" : "Note (optional)"}</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} dir={rtl ? "rtl" : "ltr"}
          placeholder={he ? "מה זה / איך זה מחובר" : "What it is / how it connects"} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => save.mutate()} disabled={save.isPending || !(label.trim() || url.trim())} style={{ ...btn(true) }}>
          {save.isPending ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {he ? "שמור" : "Save"}
        </button>
        <button onClick={() => { if (isNew) onCancel(); else setEditing(false); }} style={{ ...btn(false) }}><X size={15} /> {he ? "ביטול" : "Cancel"}</button>
      </div>
    </div>
  );
}
