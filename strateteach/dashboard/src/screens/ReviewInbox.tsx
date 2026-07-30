import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Trash2, PlusCircle,
  Download, Mail, FileText, RefreshCw, Camera, Inbox, Save, RotateCcw, Copy, History, X,
} from "lucide-react";
import { api, isReviewer } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, UI } from "../theme";
import { toastSuccess, toastError } from "../lib/toast";
import { mergeReviewNotes } from "../components/ReviewMode";
import type { ReviewSubmission, ReviewSnapshot } from "../lib/client";

// ── REVIEW INBOX — Dan's mini-portal for the multi-user Review board (Phase 2) ─────────────
// Lists every reviewer's submission (owners + Oren), grouped by who sent it, newest first.
// Per submission: expand to read the notes/prompt (+ screenshot flags), "Add to mine" to merge
// its tasks into your own Review Mode working notes, or Delete it. A REPORT section compiles all
// submissions in a date range into one markdown report you can Download or Email. Gated to
// owners + it_editor (server enforces the same via require_it_editor).

function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// `embedded` = rendered inside the Review-button's Management modal (a child screen), NOT the
// /review-inbox route. In that mode the top-left control becomes an ✕ that calls onClose instead
// of navigating back, and the outer padding tightens to sit cleanly inside the modal frame.
export default function ReviewInbox({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void } = {}) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();
  const canView = isReviewer();

  const q = useQuery({ queryKey: ["reviewSubmissions"], queryFn: () => api.reviewSubmissions(), staleTime: 15000, retry: 0, enabled: canView });
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Report state
  const [lightbox, setLightbox] = useState<string | null>(null);   // full-view file URL
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<string | null>(null);
  const [reportMeta, setReportMeta] = useState<{ count: number; taskCount: number } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailTo, setEmailTo] = useState("");

  // ── Working-prompt editor + save/restore snapshots (Dan: checkpoint before executing,
  //    roll back if the result isn't good). Snapshots are owner-scoped + server-persisted so
  //    they survive across devices. Restore = load a snapshot's content back into the editor. ──
  const snapQ = useQuery({ queryKey: ["reviewSnapshots"], queryFn: () => api.reviewSnapshots(), staleTime: 15000, retry: 0, enabled: canView });
  const snaps = useMemo(() => (snapQ.data?.snapshots || []) as ReviewSnapshot[], [snapQ.data]);
  const [working, setWorking] = useState("");
  const [snapName, setSnapName] = useState("");
  const [snapBusy, setSnapBusy] = useState(false);
  const [snapDelId, setSnapDelId] = useState<number | null>(null);
  const [restoreArm, setRestoreArm] = useState<number | null>(null);  // inline "confirm overwrite" for Restore

  const subs = useMemo(() => (q.data?.submissions || []) as ReviewSubmission[], [q.data]);
  // Group by sender (fromName), preserving newest-first order.
  const groups = useMemo(() => {
    const map = new Map<string, ReviewSubmission[]>();
    for (const s of subs) { const k = s.fromName || s.fromUser; if (!map.has(k)) map.set(k, []); map.get(k)!.push(s); }
    return Array.from(map.entries());
  }, [subs]);

  if (!canView) {
    return (
      <div style={{ padding: 24, color: C.text, fontFamily: UI }}>
        <h2>{he ? "אין הרשאה" : "No access"}</h2>
        <p style={{ color: C.muted }}>{he ? "התיבה פתוחה לבעלים ולשותפים (אורן, רז, רפול) בלבד." : "This inbox is for owners + collaborators (Oren, Raz, Raful) only."}</p>
      </div>
    );
  }

  const addToMine = (s: ReviewSubmission) => {
    const n = mergeReviewNotes((s.notes || []).map((x) => ({ screen: x.screen, route: x.route, text: x.text, code: x.code })));
    toastSuccess(he ? `נוספו ${n} משימות לרשימה שלך` : `Added ${n} task(s) to your notes`);
  };
  const del = async (id: number) => {
    setBusyId(id);
    try { await api.reviewDeleteSubmission(id); await q.refetch(); toastSuccess(he ? "נמחק" : "Deleted"); }
    catch (e: any) { toastError(e?.message || (he ? "המחיקה נכשלה" : "Delete failed")); }
    finally { setBusyId(null); }
  };

  const genReport = async () => {
    setGenBusy(true);
    try {
      const r = await api.reviewReport(from || undefined, to || undefined);
      setReport(r.markdown); setReportMeta({ count: r.count, taskCount: r.taskCount });
    } catch (e: any) { toastError(e?.message || (he ? "יצירת הדוח נכשלה" : "Report failed")); }
    finally { setGenBusy(false); }
  };
  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `review-report${from ? `_${from}` : ""}${to ? `_${to}` : ""}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const emailReport = async () => {
    setEmailBusy(true);
    try {
      const r = await api.reviewReportEmail(from || undefined, to || undefined, emailTo.trim() || undefined);
      toastSuccess(he ? `נשלח ל-${r.to}` : `Emailed to ${r.to}`);
    } catch (e: any) { toastError(e?.message || (he ? "שליחת המייל נכשלה" : "Email failed")); }
    finally { setEmailBusy(false); }
  };

  const saveSnap = async () => {
    if (!working.trim()) { toastError(he ? "אין מה לשמור — הפרומפט ריק" : "Nothing to save — the prompt is empty"); return; }
    setSnapBusy(true);
    try {
      await api.reviewSaveSnapshot(snapName.trim(), working);
      setSnapName(""); await snapQ.refetch();
      toastSuccess(he ? "גרסה נשמרה ✓" : "Snapshot saved ✓");
    } catch (e: any) { toastError(e?.message || (he ? "השמירה נכשלה" : "Save failed")); }
    finally { setSnapBusy(false); }
  };
  // Restore is 2-step ONLY when the editor holds unsaved text (guards against clobbering
  // work-in-progress); an empty editor restores immediately.
  const restoreSnap = (s: ReviewSnapshot) => {
    if (working.trim() && restoreArm !== s.id) { setRestoreArm(s.id); setTimeout(() => setRestoreArm(null), 3500); return; }
    setRestoreArm(null);
    setWorking(s.content);
    toastSuccess(he ? "שוחזר לעורך ✓" : "Restored into the editor ✓");
  };
  const delSnap = async (id: number) => {
    setSnapDelId(id);
    try { await api.reviewDeleteSnapshot(id); await snapQ.refetch(); toastSuccess(he ? "נמחק" : "Deleted"); }
    catch (e: any) { toastError(e?.message || (he ? "המחיקה נכשלה" : "Delete failed")); }
    finally { setSnapDelId(null); }
  };
  const copyWorking = async () => {
    if (!working) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(working);
      else { const ta = document.createElement("textarea"); ta.value = working; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      toastSuccess(he ? "הועתק ✓" : "Copied ✓");
    } catch { toastError(he ? "ההעתקה נכשלה" : "Copy failed"); }
  };

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 14 };
  const field: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "8px 10px", fontSize: 13, fontFamily: UI, boxSizing: "border-box" };
  const btn = (primary?: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    borderRadius: 11, padding: "10px 14px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: UI,
    background: primary ? C.accentGrad : C.surface2, color: primary ? "#0b1024" : C.text, border: `1px solid ${primary ? "transparent" : C.line}` });

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: mobile ? (embedded ? "12px 12px 28px" : "14px 12px 48px") : (embedded ? "16px 18px 28px" : "20px 18px 60px"), direction: rtl ? "rtl" : "ltr", fontFamily: UI }}>
      {/* Header — back navigates the route; in the embedded modal it CLOSES the overlay (✕). */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button onClick={() => (embedded ? onClose?.() : nav(-1))} className="tap44" aria-label={embedded ? (he ? "סגור" : "Close") : "back"} title={embedded ? (he ? "סגור" : "Close") : undefined} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer" }}>
          {embedded ? <X size={18} /> : (rtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />)}
        </button>
        <Inbox size={22} color={C.gold} />
        <h1 style={{ margin: 0, fontSize: mobile ? 18 : 22, fontWeight: 900, color: C.text, flex: 1 }}>{he ? "תיבת הסקירות" : "Review inbox"}</h1>
        <button onClick={() => q.refetch()} className="tap44" aria-label="refresh" title={he ? "רענן" : "Refresh"}
          style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, borderRadius: 10, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer" }}>
          <RefreshCw size={16} className={q.isFetching ? "spin" : undefined} />
        </button>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        {he ? "כל מי ששלח תיקונים מ״מצב סקירה״ מופיע כאן. אפשר להוסיף משימות לרשימה שלך, למחוק, ולהפיק דוח לפי טווח תאריכים."
            : "Everyone who sent fixes from Review Mode shows here. Add tasks to your own list, delete, or compile a date-range report."}
      </p>

      {/* Submissions grouped by sender */}
      {q.isLoading ? (
        <div style={{ color: C.muted, padding: 24 }}>{he ? "טוען…" : "Loading…"}</div>
      ) : q.isError ? (
        // Show the ERROR (not a misleading "empty") so a failed fetch is obvious + retryable.
        <div style={{ ...card, textAlign: "center", color: C.loss, padding: "32px 16px" }}>
          <div style={{ marginBottom: 10 }}>{he ? "טעינת ההגשות נכשלה." : "Couldn't load submissions."}</div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>{(q.error as any)?.message || ""}</div>
          <button onClick={() => q.refetch()} style={btn(true)}><RefreshCw size={15} /> {he ? "נסה שוב" : "Retry"}</button>
        </div>
      ) : subs.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: C.muted, padding: "40px 16px" }}>
          <ClipboardList size={22} color={C.gold} style={{ marginBottom: 8 }} />
          <div>{he ? "אין עדיין הגשות. שלחו תיקונים מ״מצב סקירה״." : "No submissions yet. Send fixes from Review Mode."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.map(([who, items]) => (
            <div key={who}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 26, height: 26, borderRadius: "50%", background: C.accentGrad, color: "#0b1024", fontWeight: 900, fontSize: 12, display: "grid", placeItems: "center" }}>{(who || "?").slice(0, 1).toUpperCase()}</span>
                <b style={{ fontSize: 15, color: C.text }}>{who}</b>
                <span style={{ fontSize: 12, color: C.muted }}>· {items.length} {he ? "הגשות" : "submissions"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map((s) => {
                  const open = openId === s.id;
                  const shots = (s.notes || []).reduce((a, n) => a + (n.files || []).length, 0);
                  return (
                    <div key={s.id} style={card}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button onClick={() => setOpenId(open ? null : s.id)} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: UI, textAlign: rtl ? "right" : "left", padding: 0 }}>
                          {open ? <ChevronUp size={16} color={C.muted} /> : <ChevronDown size={16} color={C.muted} />}
                          <span style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>{fmt(s.createdAt)}</span>
                          <span style={{ fontSize: 12, color: C.muted }}>· {(s.notes || []).length} {he ? "משימות" : "tasks"}</span>
                          {shots > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: C.gold }}><Camera size={12} /> {shots}</span>}
                        </button>
                        <button onClick={() => addToMine(s)} className="tap44" title={he ? "הוסף לשלי" : "Add to mine"}
                          style={{ ...btn(false), padding: "7px 10px", fontSize: 12 }}>
                          <PlusCircle size={14} /> {he ? "הוסף לשלי" : "Add to mine"}
                        </button>
                        <button onClick={() => del(s.id)} disabled={busyId === s.id} className="tap44" aria-label="delete" title={he ? "מחק" : "Delete"}
                          style={{ background: "none", border: `1px solid ${C.line}`, color: C.loss, borderRadius: 10, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer", opacity: busyId === s.id ? 0.5 : 1 }}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                      {open && (
                        <div style={{ marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                            {(s.notes || []).map((n, i) => (
                              <div key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                                <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: C.faint, marginBottom: 2 }}>
                                  {n.code && <span style={{ fontWeight: 800, color: C.gold, direction: "ltr" }}>#{n.code}</span>}
                                  {n.ts && <span style={{ direction: "ltr" }}>{fmt(n.ts)}</span>}
                                  <span>· {n.screen || n.route}</span>
                                </div>
                                {n.text}
                                {(n.files || []).length > 0 && (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                                    {(n.files || []).map((tok, k) => {
                                      const url = api.reviewFileUrl(tok);
                                      return <img key={k} src={url} alt="" loading="lazy" onClick={() => setLightbox(url)}
                                        style={{ height: 60, width: 60, borderRadius: 8, cursor: "zoom-in", objectFit: "cover", border: `1px solid ${C.line}` }} />;
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <details>
                            <summary style={{ cursor: "pointer", fontSize: 12, color: C.muted }}>{he ? "פרומפט מלא" : "Full prompt"}</summary>
                            <textarea readOnly value={s.prompt} onFocus={(e) => e.currentTarget.select()}
                              style={{ ...field, width: "100%", minHeight: 140, marginTop: 8, resize: "vertical", direction: "ltr", textAlign: "left",
                                fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12 }} />
                          </details>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Report section */}
      <h2 style={{ fontSize: 16, fontWeight: 900, color: C.text, margin: "26px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <FileText size={18} color={C.gold} /> {he ? "דוח לפי טווח תאריכים" : "Date-range report"}
      </h2>
      <div style={{ ...card }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>
            {he ? "מתאריך" : "From"}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={field} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: C.muted }}>
            {he ? "עד תאריך" : "To"}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={field} />
          </label>
          <button onClick={genReport} disabled={genBusy} style={btn(true)}>
            <FileText size={15} /> {genBusy ? (he ? "מרכיב…" : "Compiling…") : (he ? "הפק דוח" : "Generate")}
          </button>
        </div>
        {report != null && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
              {reportMeta ? (he ? `${reportMeta.count} הגשות · ${reportMeta.taskCount} משימות` : `${reportMeta.count} submissions · ${reportMeta.taskCount} tasks`) : ""}
            </div>
            <textarea readOnly value={report} onFocus={(e) => e.currentTarget.select()}
              style={{ ...field, width: "100%", minHeight: 220, resize: "vertical", direction: "ltr", textAlign: "left",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, lineHeight: 1.5 }} />
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={downloadReport} style={btn(false)}><Download size={15} /> {he ? "הורד .md" : "Download .md"}</button>
              <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={he ? "מייל (ריק = שלך)" : "email (blank = yours)"}
                style={{ ...field, minWidth: 200, direction: "ltr" }} />
              <button onClick={emailReport} disabled={emailBusy} style={btn(false)}>
                <Mail size={15} /> {emailBusy ? (he ? "שולח…" : "Sending…") : (he ? "שלח במייל" : "Send email")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Working-prompt editor + snapshots (save / restore checkpoints) */}
      <h2 style={{ fontSize: 16, fontWeight: 900, color: C.text, margin: "26px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <History size={18} color={C.gold} /> {he ? "עורך הפרומפט · גרסאות" : "Prompt editor · snapshots"}
      </h2>
      <div style={{ ...card }}>
        <p style={{ margin: "0 0 10px", fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
          {he ? "ערכו כאן את הפרומפט לביצוע. שמרו גרסה לפני ריצה — ואם התוצאה לא טובה, שחזרו אליה בלחיצה."
              : "Edit the prompt you'll run here. Save a snapshot before executing — if the result isn't good, restore it in one click."}
        </p>
        <textarea value={working} onChange={(e) => setWorking(e.target.value)}
          placeholder={he ? "הדביקו/כתבו כאן את הפרומפט… (אפשר גם להעביר לכאן דוח שהופק למעלה)" : "Paste/write the prompt here… (or send a generated report down here)"}
          style={{ ...field, width: "100%", minHeight: 200, resize: "vertical", direction: "ltr", textAlign: "left",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, lineHeight: 1.5 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={snapName} onChange={(e) => setSnapName(e.target.value)}
            placeholder={he ? "שם הגרסה (רשות)" : "Snapshot name (optional)"}
            onKeyDown={(e) => { if (e.key === "Enter") void saveSnap(); }}
            style={{ ...field, minWidth: 180, flex: "1 1 180px" }} />
          <button onClick={saveSnap} disabled={snapBusy || !working.trim()} style={{ ...btn(true), opacity: snapBusy || !working.trim() ? 0.5 : 1 }}>
            <Save size={15} /> {snapBusy ? (he ? "שומר…" : "Saving…") : (he ? "שמור גרסה" : "Save snapshot")}
          </button>
          <button onClick={copyWorking} disabled={!working} style={{ ...btn(false), opacity: working ? 1 : 0.5 }}>
            <Copy size={15} /> {he ? "העתק" : "Copy"}
          </button>
          {report != null && (
            <button onClick={() => { setWorking(report); toastSuccess(he ? "הדוח הועבר לעורך" : "Report moved to editor"); }} style={btn(false)}>
              <FileText size={15} /> {he ? "טען מהדוח" : "Load from report"}
            </button>
          )}
        </div>

        {/* Saved snapshots list */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <History size={14} /> {he ? "גרסאות שמורות" : "Saved snapshots"}
            <span style={{ fontWeight: 600 }}>({snaps.length})</span>
            {snapQ.isFetching && <RefreshCw size={12} className="spin" />}
          </div>
          {snaps.length === 0 ? (
            <div style={{ fontSize: 12.5, color: C.faint, padding: "8px 2px" }}>
              {he ? "אין עדיין גרסאות שמורות." : "No snapshots saved yet."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {snaps.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: C.faint, direction: "ltr", textAlign: rtl ? "right" : "left" }}>{fmt(s.createdAt)} · {s.content.length.toLocaleString()} {he ? "תווים" : "chars"}</div>
                  </div>
                  <button onClick={() => restoreSnap(s)} className="tap44" title={he ? "שחזר לעורך" : "Restore into editor"}
                    style={{ ...btn(restoreArm === s.id), padding: "7px 11px", fontSize: 12.5, background: restoreArm === s.id ? C.gold : C.surface, color: restoreArm === s.id ? "var(--btn-ink)" : C.text, border: `1px solid ${restoreArm === s.id ? C.gold : C.line}` }}>
                    <RotateCcw size={14} /> {restoreArm === s.id ? (he ? "להחליף?" : "Replace?") : (he ? "שחזר" : "Restore")}
                  </button>
                  <button onClick={() => delSnap(s.id)} disabled={snapDelId === s.id} className="tap44" aria-label="delete snapshot" title={he ? "מחק" : "Delete"}
                    style={{ background: "none", border: `1px solid ${C.line}`, color: C.loss, borderRadius: 10, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer", opacity: snapDelId === s.id ? 0.5 : 1 }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full-screen file viewer (tap a thumbnail). */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 1300,
          background: "rgba(0,0,0,0.85)", display: "grid", placeItems: "center", padding: 16 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
        </div>
      )}
    </div>
  );
}
