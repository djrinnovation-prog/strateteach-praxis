import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale, Save, Eye, Loader2 } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, SHADOW } from "../theme";
import { input, btn } from "../ui";
import LegalMarkdown from "./LegalMarkdown";
import type { LegalText } from "../lib/client";

// ── Legal-text editor — the in-app editor for the app's legal texts (privacy / terms /
// risk / demo / exchange-keys). Extracted from the old standalone Legal Console so it can
// live INSIDE the Legal Portal's "עריכה" (Editing) tab. Access is gated by the portal
// (legal_editor + owners), so this component renders the editor only — no header/gate.
// The counsel edits HE + EN with a live preview; Save publishes live.
export default function LegalEditor() {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<LegalText | null>(null);
  const [prev, setPrev] = useState<"he" | "en">(he ? "he" : "en");
  const [msg, setMsg] = useState("");
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg((c) => (c === m ? "" : c)), 2600); };

  const q = useQuery({ queryKey: ["legalAdmin"], queryFn: () => api.legalAdminList() });
  const texts = (q.data?.texts || []) as LegalText[];

  const open = (t: LegalText) => { setSel(t.key); setDraft({ ...t }); };
  const setF = (k: keyof LegalText, v: any) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const saveM = useMutation({
    mutationFn: () => api.legalSave(draft!.key, {
      titleHe: draft!.titleHe, titleEn: draft!.titleEn, bodyHe: draft!.bodyHe, bodyEn: draft!.bodyEn,
      published: draft!.published !== false, sort: draft!.sort,
    }),
    onSuccess: (r) => { flash(he ? "נשמר ופורסם ✓" : "Saved & published ✓"); setDraft({ ...r.text }); qc.invalidateQueries({ queryKey: ["legalAdmin"] }); qc.invalidateQueries({ queryKey: ["legalPublic"] }); },
    onError: (e: any) => flash((he ? "שגיאה: " : "Error: ") + String(e?.message || e)),
  });

  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const area: React.CSSProperties = { ...input, minHeight: 220, fontFamily: UI, lineHeight: 1.6, resize: "vertical", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      {msg && <div style={{ margin: "0 0 12px", background: `${C.gold}1a`, border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 9, padding: "9px 12px", fontSize: 13 }}>{msg}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 240px) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        {/* ── list of legal texts ── */}
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 10, boxShadow: SHADOW }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 800, color: C.text, padding: "4px 6px 8px" }}>
            <Scale size={15} color={C.gold} /> {he ? "מסמכים" : "Documents"}
          </div>
          {q.isLoading ? <div style={{ padding: 12, color: C.muted, fontSize: 13 }}><Loader2 size={14} className="spin" /></div> : texts.map((t) => {
            const on = sel === t.key;
            return (
              <button key={t.key} onClick={() => open(t)} className="tap44"
                style={{ width: "100%", textAlign: rtl ? "right" : "left", display: "flex", flexDirection: "column", gap: 2,
                  background: on ? `${C.gold}1a` : "transparent", border: `1px solid ${on ? C.gold : "transparent"}`,
                  borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontFamily: "inherit", marginBottom: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{he ? t.titleHe : t.titleEn}</span>
                <span style={{ fontSize: 10.5, color: C.faint, fontFamily: "monospace" }}>
                  {t.key}{t.published === false ? (he ? " · טיוטה" : " · draft") : ""}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── editor + live preview ── */}
        {draft ? (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, boxShadow: SHADOW }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Scale size={16} color={C.gold} /> <span style={{ fontFamily: "monospace" }}>{draft.key}</span>
              </div>
              <div style={{ fontSize: 11, color: C.faint }}>
                {draft.updatedAt ? (he ? "עודכן: " : "Updated: ") + String(draft.updatedAt).slice(0, 16).replace("T", " ") : ""}
                {draft.updatedBy ? ` · ${draft.updatedBy}` : ""}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              {/* Hebrew */}
              <div>
                <label style={lbl}>{he ? "כותרת (עברית)" : "Title (Hebrew)"}</label>
                <input style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 10 }} dir="rtl" value={draft.titleHe} onChange={(e) => setF("titleHe", e.target.value)} />
                <label style={lbl}>{he ? "תוכן (עברית · Markdown)" : "Body (Hebrew · Markdown)"}</label>
                <textarea style={{ ...area, direction: "rtl" }} value={draft.bodyHe} onChange={(e) => setF("bodyHe", e.target.value)} />
              </div>
              {/* English */}
              <div>
                <label style={lbl}>{he ? "כותרת (אנגלית)" : "Title (English)"}</label>
                <input style={{ ...input, width: "100%", boxSizing: "border-box", marginBottom: 10 }} dir="ltr" value={draft.titleEn} onChange={(e) => setF("titleEn", e.target.value)} />
                <label style={lbl}>{he ? "תוכן (אנגלית · Markdown)" : "Body (English · Markdown)"}</label>
                <textarea style={{ ...area, direction: "ltr" }} value={draft.bodyEn} onChange={(e) => setF("bodyEn", e.target.value)} />
              </div>
            </div>

            {/* live preview */}
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Eye size={14} color={C.gold} />
                <span style={{ fontSize: 12, fontWeight: 800, color: C.muted }}>{he ? "תצוגה מקדימה" : "Live preview"}</span>
                <div style={{ display: "inline-flex", gap: 2, marginInlineStart: "auto", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: 2 }}>
                  {(["he", "en"] as const).map((l) => (
                    <button key={l} onClick={() => setPrev(l)} style={{ padding: "3px 11px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 800,
                      background: prev === l ? C.gold : "transparent", color: prev === l ? "#0b0b0b" : C.muted }}>{l.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18, maxHeight: 340, overflowY: "auto" }}>
                <h1 style={{ fontSize: 20, fontWeight: 800, margin: "0 0 12px", color: C.text, direction: prev === "he" ? "rtl" : "ltr" }}>
                  {prev === "he" ? draft.titleHe : draft.titleEn}
                </h1>
                <LegalMarkdown body={prev === "he" ? draft.bodyHe : draft.bodyEn} rtl={prev === "he"} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, color: C.text, cursor: "pointer" }}>
                <input type="checkbox" checked={draft.published !== false} onChange={(e) => setF("published", e.target.checked)} />
                {he ? "מפורסם (גלוי באפליקציה)" : "Published (live in the app)"}
              </label>
              <button onClick={() => saveM.mutate()} disabled={saveM.isPending} style={{ ...btn(true), marginInlineStart: "auto" }}>
                {saveM.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור ופרסם" : "Save & publish"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 16, padding: 40, textAlign: "center", color: C.muted, fontSize: 14 }}>
            {he ? "בחר מסמך לעריכה" : "Select a document to edit"}
          </div>
        )}
      </div>
    </div>
  );
}
