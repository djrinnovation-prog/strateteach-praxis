import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Link2, Plus, Save, Trash2, Loader2, X, ExternalLink, Pencil, Check,
  Paperclip, Download, File as FileIcon,
} from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, SHADOW } from "../theme";
import { input, btn } from "../ui";
import type { BizDoc, ItDoc, ItLink } from "../lib/client";

// ── BizEditor — the Business Development portal's content tab (domain='biz'). Two areas:
//   1. מסמכים וחומרים — documents & materials: title + long-form rich description + an OPTIONAL
//      uploaded FILE (PDF / image / deck), stored server-side (base64-in-TEXT, like avatars).
//   2. קישורים ומקורות — links & sources: label + URL + note references for the owners.
// Mirrors ItEditor's structure but relabeled for biz-dev content (NOT "link your systems to us").
const DOMAIN = "biz" as const;
const MAX_FILE_MB = 12;

const humanSize = (n?: number) => {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export default function BizEditor() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, direction: rtl ? "rtl" : "ltr" }}>
      <DocsSection he={he} rtl={rtl} />
      <LinksSection he={he} rtl={rtl} />
    </div>
  );
}

// ── Documents & materials (with file upload) ──────────────────────────────────
function DocsSection({ he, rtl }: { he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["portalDocs", DOMAIN], queryFn: () => api.portalDocs(DOMAIN) });
  const docs = (q.data?.docs || []) as BizDoc[];
  const inval = () => qc.invalidateQueries({ queryKey: ["portalDocs", DOMAIN] });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, color: C.text }}>
          <FileText size={17} color={C.gold} /> {he ? "מסמכים וחומרים" : "Documents & Materials"}
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ ...btn(true) }}>
            <Plus size={15} /> {he ? "מסמך חדש" : "New document"}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        {he
          ? `מסמכים, מצגות וחומרים — כותרת, תיאור מלא, וקובץ מצורף (PDF / תמונה / מצגת, עד ${MAX_FILE_MB}MB). נערך על ידך ונראה לבעלים.`
          : `Documents, decks & materials — a title, a full description, and an attached file (PDF / image / deck, up to ${MAX_FILE_MB}MB). Edited by you, visible to the owners.`}
      </div>

      {adding && <DocCard he={he} rtl={rtl} doc={null} onDone={() => { setAdding(false); inval(); }} onCancel={() => setAdding(false)} />}

      {q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div>
      ) : docs.length === 0 && !adding ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>{he ? "אין עדיין מסמכים — צור אחד." : "No documents yet — create one."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: adding ? 10 : 0 }}>
          {docs.map((d) => <DocCard key={d.id} he={he} rtl={rtl} doc={d} onDone={inval} onCancel={() => {}} />)}
        </div>
      )}
    </div>
  );
}

function DocCard({ he, rtl, doc, onDone, onCancel }: { he: boolean; rtl: boolean; doc: BizDoc | null; onDone: () => void; onCancel: () => void }) {
  const isNew = !doc;
  const [open, setOpen] = useState(isNew);
  const [title, setTitle] = useState(doc?.title || "");
  const [body, setBody] = useState(doc?.body || "");
  // File staged for upload (base64 data-URL) — undefined means "leave the existing file as-is".
  const [fileData, setFileData] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string>(doc?.file_name || "");
  const [fileType, setFileType] = useState<string>(doc?.file_type || "");
  const [fileErr, setFileErr] = useState("");
  const [removeFile, setRemoveFile] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const hasStoredFile = !!doc?.has_file && !removeFile && fileData === undefined;
  const hasStagedFile = fileData !== undefined && !!fileData;

  const pickFile = (f: File | null) => {
    setFileErr("");
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) { setFileErr(he ? `הקובץ גדול מדי — עד ${MAX_FILE_MB}MB.` : `File too large — max ${MAX_FILE_MB}MB.`); return; }
    const reader = new FileReader();
    reader.onload = () => { setFileData(String(reader.result || "")); setFileName(f.name); setFileType(f.type || ""); setRemoveFile(false); };
    reader.readAsDataURL(f);
  };

  const save = useMutation({
    mutationFn: () => api.portalDocUpsert(DOMAIN, {
      id: doc?.id, title: title.trim(), body,
      // undefined → leave file untouched; "" → clear; data-URL → set/replace
      ...(hasStagedFile ? { fileData, fileName, fileType } : removeFile ? { fileData: "" } : {}),
    }),
    onSuccess: () => { if (isNew) { setTitle(""); setBody(""); setFileData(undefined); setFileName(""); setFileType(""); } setRemoveFile(false); onDone(); if (isNew) onCancel(); },
  });
  const del = useMutation({ mutationFn: () => api.portalDocDelete(DOMAIN, doc!.id), onSuccess: onDone });

  const download = async () => {
    if (!doc) return;
    setDownloading(true);
    try {
      const { blob, filename } = await api.portalDocFile(DOMAIN, doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    } catch { setFileErr(he ? "ההורדה נכשלה." : "Download failed."); }
    finally { setDownloading(false); }
  };

  if (!isNew && !open) {
    return (
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc!.title || (he ? "(ללא כותרת)" : "(untitled)")}</span>
        {doc!.has_file && (
          <button onClick={download} disabled={downloading} title={he ? "הורדת הקובץ" : "Download file"}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px", color: C.gold, cursor: "pointer", fontSize: 11.5, fontWeight: 800 }}>
            {downloading ? <Loader2 size={13} className="spin" /> : <Download size={13} />} {doc!.file_name ? doc!.file_name.slice(0, 22) : (he ? "קובץ" : "File")}
          </button>
        )}
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
          placeholder={he ? "לדוגמה: מצגת שותפות אסטרטגית" : "e.g. Strategic partnership deck"} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div>
        <label style={lbl}>{he ? "תיאור / תוכן" : "Description / content"}</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} dir={rtl ? "rtl" : "ltr"}
          placeholder={he ? "פירוט מלא — רקע, מטרות, פרטים…" : "Full write-up — background, goals, details…"}
          style={{ ...input, width: "100%", boxSizing: "border-box", minHeight: 140, lineHeight: 1.6, resize: "vertical" }} />
      </div>

      {/* file attach */}
      <div>
        <label style={lbl}>{he ? "קובץ מצורף (אופציונלי)" : "Attached file (optional)"}</label>
        <input ref={fileRef} type="file" style={{ display: "none" }}
          onChange={(e) => pickFile(e.target.files?.[0] || null)} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => fileRef.current?.click()} style={{ ...btn(false) }}>
            <Paperclip size={15} /> {he ? "בחר קובץ" : "Choose file"}
          </button>
          {hasStagedFile ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 10px" }}>
              <FileIcon size={14} color={C.gold} /> {fileName || (he ? "קובץ נבחר" : "Selected file")}
              <button type="button" onClick={() => { setFileData(undefined); setFileName(doc?.file_name || ""); setFileType(doc?.file_type || ""); if (fileRef.current) fileRef.current.value = ""; }}
                title={he ? "בטל" : "Clear"} style={{ background: "none", border: "none", color: C.loss, cursor: "pointer", display: "inline-flex" }}><X size={13} /></button>
            </span>
          ) : hasStoredFile ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: C.text, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 10px" }}>
              <FileIcon size={14} color={C.gold} /> {doc?.file_name || (he ? "קובץ" : "File")}
              {!!doc?.file_size && <span style={{ color: C.faint, fontWeight: 600 }}>· {humanSize(doc.file_size)}</span>}
              <button type="button" onClick={download} disabled={downloading} title={he ? "הורד" : "Download"} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", display: "inline-flex" }}>
                {downloading ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
              </button>
              <button type="button" onClick={() => setRemoveFile(true)} title={he ? "הסר קובץ" : "Remove file"} style={{ background: "none", border: "none", color: C.loss, cursor: "pointer", display: "inline-flex" }}><Trash2 size={13} /></button>
            </span>
          ) : removeFile ? (
            <span style={{ fontSize: 12, color: C.loss, fontWeight: 700 }}>{he ? "הקובץ יוסר בשמירה" : "File will be removed on save"}
              <button type="button" onClick={() => setRemoveFile(false)} style={{ marginInlineStart: 8, background: "none", border: "none", color: C.gold, cursor: "pointer", fontWeight: 800, fontSize: 11.5 }}>{he ? "בטל" : "undo"}</button>
            </span>
          ) : (
            <span style={{ fontSize: 12, color: C.faint }}>{he ? "אין קובץ" : "No file"}</span>
          )}
        </div>
        {fileErr && <div style={{ marginTop: 6, fontSize: 12, color: C.loss }}>{fileErr}</div>}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => save.mutate()} disabled={save.isPending || !(title.trim() || body.trim() || hasStagedFile)} style={{ ...btn(true) }}>
          {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור" : "Save"}
        </button>
        {isNew ? (
          <button onClick={onCancel} style={{ ...btn(false) }}><X size={15} /> {he ? "ביטול" : "Cancel"}</button>
        ) : (
          <>
            <button onClick={() => setOpen(false)} style={{ ...btn(false) }}>{he ? "סגור" : "Close"}</button>
            <button onClick={() => { if (confirm(he ? "למחוק את המסמך?" : "Delete this document?")) del.mutate(); }} disabled={del.isPending}
              style={{ ...btn(false), color: C.loss, marginInlineStart: "auto" }}><Trash2 size={15} /> {he ? "מחק" : "Delete"}</button>
          </>
        )}
      </div>
      {save.isError && <div style={{ fontSize: 12, color: C.loss }}>{String((save.error as any)?.message || save.error)}</div>}
    </div>
  );
}

// ── Links & sources ───────────────────────────────────────────────────────────
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
          <Link2 size={17} color={C.gold} /> {he ? "קישורים ומקורות" : "Links & Sources"}
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ ...btn(true) }}>
            <Plus size={15} /> {he ? "קישור חדש" : "New link"}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        {he ? "קישורים, מקורות והפניות — מצגות, מסמכים חיצוניים, אתרים וחומרי רקע לבעלים." : "Links, sources & references — decks, external docs, sites & background material for the owners."}
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
            placeholder={he ? "לדוגמה: מצגת המשקיעים" : "e.g. Investor deck"} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
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
          placeholder={he ? "מה זה / הקשר" : "What it is / context"} style={{ ...input, width: "100%", boxSizing: "border-box" }} />
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
