import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale, Check, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";
import { api, isLegalCopyWriter } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import type { LegalCopyBlock } from "../lib/client";

// ── LegalCopyEditor — Raz's self-service editor for the 4 analytics/safety legal blocks.
// Lives inside her /legal-portal "editing" tab. Each block = editable HE + EN textareas,
// the guidance / open-questions she must verify, a Save (stores copy, reverts to DRAFT),
// and Confirm & Approve (clears the DRAFT badge app-wide). The app reads the same rows via
// useLegalCopy(), so an approval here removes the amber badge everywhere immediately.
// Gated server-side by require_legal_editor (owner OR Raz); this tab only renders for them.

type Guide = { he: string; en: string };
// `task` links each card to its /legal-portal Tasks-tab task (shown as a chip on the card).
const BLOCKS: { block: string; titleHe: string; titleEn: string; task: Guide; guide: Guide }[] = [
  {
    block: "disclaimer",
    titleHe: "Block A · הצהרה רגולטורית", titleEn: "Block A · Regulatory disclaimer",
    task: { he: "משימה: עיון ועריכת טיוטת זהות הישות והסטטוס הרגולטורי", en: "Task: Review & edit the legal-entity + regulatory-status draft" },
    guide: {
      he: "מוצג בכותרת התחתונה ולפני פעולות בכסף. לאשר: (1) שם הישות הרשומה + ח.פ.; (2) האם הסורק/הסיגנל/הטייס מחייבים רישוי לפי חוק הסדרת העיסוק… התשנ״ה-1995 או נכנסים לפטור (מידע כללי/חינוכי/לקוחות כשירים) — לאור טיוטת רשות ני״ע מינואר 2026 בדבר שירות באמצעים טכנולוגיים; (3) שהמודל הלא-משמורתי מחוץ לרישוי לפי חוק הפיקוח על שירותים פיננסיים (מוסדרים), התשע״ו-2016; (4) נוסח מחייב מרשות ני״ע/שוק ההון.",
      en: "Shown in the footer + before money actions. Confirm: (1) registered entity name + company no.; (2) whether the scanner/signal/AutoPilot trigger licensing under the 1995 Advice Law or fit an exemption (generic/educational/qualified-clients) — given the ISA Jan-2026 draft on technological-means service; (3) that the non-custodial model stays outside the 2016 Regulated Financial Services licensing; (4) any ISA/CMA-mandated wording.",
    },
  },
  {
    block: "risk",
    titleHe: "Block B · גילוי סיכונים", titleEn: "Block B · Risk disclosure",
    task: { he: "משימה: עיון ועריכת טיוטת גילוי הסיכונים", en: "Task: Review & edit the risk-disclosure draft" },
    guide: {
      he: "מוצג לפני כל התחייבות (מסלול / פתיחת מנוע / מעבר-ללייב). לאשר/להתאים את הנוסח ושהוא עומד בציפיות רשות ני״ע/שוק ההון לפעילותנו.",
      en: "Shown before every commitment (plan / unlock / go-live). Approve/adjust the wording and confirm it meets ISA/CMA risk-disclosure expectations for our activity.",
    },
  },
  {
    block: "privacy",
    titleHe: "Block C · פרטיות + שמירה + זכויות", titleEn: "Block C · Privacy + retention + rights",
    task: { he: "משימה: עיון ועריכת טיוטת הפרטיות + שמירה + מחיקה/ייצוא", en: "Task: Review & edit the privacy + retention + deletion/export draft" },
    guide: {
      he: "מוצג ב'המידע שלי'. לאשר: תקופות שמירה (ברירות מחדל מוצעות בנוסח); תמצית אבטחה; פרטי קשר; האם תיקון 13 מחייב מינוי ממונה הגנת פרטיות (DPO) — מעבדים מידע פיננסי = רגיש במיוחד; והאם חלה חובת רישום/הודעה על מאגר (ספים: 10,000 / 100,000). לשמור את סמני [PLACEHOLDER] עד להחלטה.",
      en: "Shown in My Data. Confirm: retention periods (suggested defaults are in the text); security summary; data contact; whether Amendment 13 requires a DPO (we process financial = especially-sensitive data); and whether database registration/notification applies (thresholds 10,000 / 100,000). Keep [PLACEHOLDER] markers until decided.",
    },
  },
  {
    block: "consent",
    titleHe: "Block D · הסכמת אנליטיקס", titleEn: "Block D · Analytics consent",
    task: { he: "משימה: עיון ועריכת טיוטת נוסח ההסכמה לאנליטיקס", en: "Task: Review & edit the analytics-consent draft" },
    guide: {
      he: "מוצג במסך ההסכמה. לאשר שהנוסח עומד בסטנדרט תיקון 13 — הסכמה מפורשת, מפורטת (גרנולרית) ומתועדת.",
      en: "Shown in the consent modal. Confirm the wording satisfies Amendment 13's explicit + granular + documented consent standard.",
    },
  },
];

export default function LegalCopyEditor() {
  const { lang } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const canWrite = isLegalCopyWriter();   // Raz / main admin edit+approve; other owners read-only
  const q = useQuery({ queryKey: ["legalCopyAdmin"], queryFn: () => api.legalCopyList(), retry: false });

  return (
    <div style={{ fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Scale size={17} color={C.gold} />
        <span style={{ fontSize: 15, fontWeight: 900 }}>{he ? "נוסח משפטי — עריכה ואישור" : "Legal copy — edit & approve"}</span>
      </div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        {canWrite
          ? (he ? "ערכי את הנוסח בעברית ובאנגלית, שמרי, ואז «אישור סופי» כדי להסיר את תווית הטיוטה בכל האפליקציה. עריכה מחזירה את הבלוק למצב טיוטה עד לאישור מחדש. כל בלוק מקושר למשימה שלו."
                : "Edit the HE + EN copy, Save, then Confirm & Approve to clear the DRAFT badge across the app. Editing reverts a block to draft until re-approved. Each block is linked to its task.")
          : (he ? "תצוגה בלבד — עריכה ואישור הנוסח המשפטי שמורים לרז (עורכת משפטית)."
                : "Read-only — editing and approving the legal copy is reserved for Raz (legal editor).")}
      </div>
      {q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}><Loader2 size={15} className="spin" /> {he ? "טוען…" : "Loading…"}</div>
      ) : q.isError ? (
        <div style={{ color: C.loss, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}><AlertTriangle size={15} /> {he ? "טעינה נכשלה." : "Couldn't load."} <button onClick={() => q.refetch()} style={linkBtn}>{he ? "נסי שוב" : "Retry"}</button></div>
      ) : (
        BLOCKS.map((b) => {
          const row = (q.data?.blocks || []).find((x) => x.block === b.block);
          return <BlockCard key={b.block} meta={b} row={row} he={he} canWrite={canWrite} onChanged={() => { qc.invalidateQueries({ queryKey: ["legalCopyAdmin"] }); qc.invalidateQueries({ queryKey: ["legalCopy"] }); }} />;
        })
      )}
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: C.blue, cursor: "pointer", fontFamily: UI, fontSize: 12.5, fontWeight: 700, textDecoration: "underline", padding: 0 };

function BlockCard({ meta, row, he, canWrite, onChanged }: {
  meta: { block: string; titleHe: string; titleEn: string; task: Guide; guide: Guide };
  row?: LegalCopyBlock; he: boolean; canWrite: boolean; onChanged: () => void;
}) {
  const [heTxt, setHeTxt] = useState(row?.he || "");
  const [enTxt, setEnTxt] = useState(row?.en || "");
  const [msg, setMsg] = useState("");
  // Keep local state in sync if the row loads/refreshes and the user hasn't typed yet.
  useEffect(() => { setHeTxt(row?.he || ""); setEnTxt(row?.en || ""); }, [row?.he, row?.en]);
  const approved = !!row?.approved;
  const dirty = heTxt !== (row?.he || "") || enTxt !== (row?.en || "");

  const saveM = useMutation({
    mutationFn: () => api.legalCopySave(meta.block, heTxt, enTxt),
    onSuccess: () => { setMsg(he ? "נשמר ✓ (טיוטה — יש לאשר)" : "Saved ✓ (draft — approve to publish)"); onChanged(); setTimeout(() => setMsg(""), 3000); },
    onError: (e: any) => setMsg(e?.message || "Save failed"),
  });
  const approveM = useMutation({
    mutationFn: (v: boolean) => (v ? api.legalCopyApprove(meta.block) : api.legalCopyUnapprove(meta.block)),
    onSuccess: (_r, v) => { setMsg(v ? (he ? "אושר ✓ — תווית הטיוטה הוסרה" : "Approved ✓ — DRAFT badge cleared") : (he ? "בוטל אישור" : "Un-approved")); onChanged(); setTimeout(() => setMsg(""), 3000); },
    onError: (e: any) => setMsg(e?.message || "Approve failed"),
  });

  const ta: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 120, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontFamily: UI, fontSize: 12.5, lineHeight: 1.55, resize: "vertical" };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 4, display: "block" };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderInlineStart: `4px solid ${approved ? C.gain : "#e6b84d"}`, borderRadius: 14, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>{he ? meta.titleHe : meta.titleEn}</span>
        <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
          color: approved ? C.gain : "#8a5a00", background: approved ? `${C.gain}1e` : "#ffe6a8", border: `1px solid ${approved ? C.gain : "#e6b84d"}` }}>
          {approved ? (he ? "✓ מאושר" : "✓ Approved") : (he ? "⚖︎ טיוטה" : "⚖︎ Draft")}
        </span>
      </div>
      {/* Linked task chip (card ↔ /legal-portal Tasks tab) */}
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.blue, marginBottom: 8 }}>🔗 {he ? meta.task.he : meta.task.en}</div>
      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.5, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", marginBottom: 10 }}>
        {he ? meta.guide.he : meta.guide.en}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><label style={lbl}>{he ? "עברית" : "Hebrew"}</label>
          <textarea dir="rtl" value={heTxt} onChange={(e) => setHeTxt(e.target.value)} readOnly={!canWrite} style={{ ...ta, opacity: canWrite ? 1 : 0.75 }} /></div>
        <div><label style={lbl}>{he ? "אנגלית" : "English"}</label>
          <textarea dir="ltr" value={enTxt} onChange={(e) => setEnTxt(e.target.value)} readOnly={!canWrite} style={{ ...ta, opacity: canWrite ? 1 : 0.75 }} /></div>
      </div>

      {canWrite && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button onClick={() => saveM.mutate()} disabled={saveM.isPending || !dirty} className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface2, color: C.text, border: `1px solid ${C.line}`,
            borderRadius: 10, padding: "9px 14px", fontFamily: UI, fontSize: 13, fontWeight: 800, cursor: (saveM.isPending || !dirty) ? "default" : "pointer", opacity: (saveM.isPending || !dirty) ? 0.6 : 1 }}>
          {saveM.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {he ? "שמירה" : "Save"}
        </button>
        {approved ? (
          <button onClick={() => approveM.mutate(false)} disabled={approveM.isPending} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", color: C.muted, border: `1px solid ${C.line}`,
              borderRadius: 10, padding: "9px 14px", fontFamily: UI, fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            {approveM.isPending ? <Loader2 size={14} className="spin" /> : null} {he ? "ביטול אישור" : "Un-approve"}
          </button>
        ) : (
          <button onClick={() => approveM.mutate(true)} disabled={approveM.isPending || dirty} title={dirty ? (he ? "שמרי קודם" : "Save first") : ""} className="tap44"
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.gain, color: "#fff", border: "none",
              borderRadius: 10, padding: "9px 14px", fontFamily: UI, fontSize: 13, fontWeight: 800, cursor: (approveM.isPending || dirty) ? "default" : "pointer", opacity: (approveM.isPending || dirty) ? 0.6 : 1 }}>
            {approveM.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} {he ? "אישור סופי" : "Confirm & Approve"}
          </button>
        )}
        {msg && <span style={{ fontSize: 12, fontWeight: 700, color: C.gain }}>{msg}</span>}
      </div>}
      {/* Per-block status line — visible to everyone (incl. read-only owners). */}
      {row?.updatedBy && (
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: canWrite ? 8 : 10 }}>
          {he ? "סטטוס:" : "Status:"} {approved ? (he ? "מאושר" : "Approved") : (he ? "טיוטה" : "Draft")} · {he ? "עודכן ע״י" : "edited by"} {row.updatedBy}{row.updatedAt ? ` · ${row.updatedAt.slice(0, 10)}` : ""}
        </div>
      )}
    </div>
  );
}
