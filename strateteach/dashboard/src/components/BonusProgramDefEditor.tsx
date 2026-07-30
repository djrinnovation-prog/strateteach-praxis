import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gift, Eye, Pencil, Plus, Trash2, Save, Loader2, ChevronDown, ChevronUp, Check,
} from "lucide-react";
import { api } from "../app/api";
import { C, SHADOW } from "../theme";
import { input, btn } from "../ui";
import type { BonusProgramDef, BonusProgramStep } from "../lib/client";
import BonusProgramShowcase, { BONUS_STEP_ICON_KEYS } from "./BonusProgramShowcase";

// ── BonusProgramDefEditor — owner-only: preview + EDIT the bilingual bonus-program definition
// (title / intro / how-it-works steps / benefit / terms). Owners see the SAME stunning showcase
// employees see (preview tab) PLUS the edit form. Lives at the top of the Employees ("ניהול
// עובדים") tab. Content only — no money, no per-employee data. Collapsible to stay out of the way.
const emptyStep = (): BonusProgramStep => ({ icon: "Sparkles", titleHe: "", titleEn: "", bodyHe: "", bodyEn: "" });

export default function BonusProgramDefEditor({ he, rtl }: { he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const q = useQuery({ queryKey: ["bonusProgramDef"], queryFn: () => api.bonusProgramDef() });
  const def = q.data?.definition;

  return (
    <div style={{ background: `linear-gradient(165deg, ${C.surface} 0%, ${C.gold}0d 100%)`, border: `1px solid ${C.gold}55`, borderRadius: 16, boxShadow: SHADOW, overflow: "hidden", direction: rtl ? "rtl" : "ltr" }}>
      <button onClick={() => setOpen((o) => !o)} className="tap44"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "none", cursor: "pointer", padding: "15px 18px", fontFamily: "inherit", textAlign: "start" }}>
        <Gift size={18} color={C.gold} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 900, color: C.text }}>{he ? "תוכנית הבונוס — הגדרה ותצוגה" : "Bonus Program — definition & preview"}</span>
          <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 1 }}>{he ? "מה שהעובדים רואים במסך ההצטרפות — ניתן לעריכה על ידי הבעלים." : "What employees see on the join screen — editable by the owners."}</span>
        </span>
        {open ? <ChevronUp size={18} color={C.muted} /> : <ChevronDown size={18} color={C.muted} />}
      </button>

      {open && (
        <div style={{ padding: "0 18px 18px", borderTop: `1px solid ${C.line}` }}>
          {/* preview / edit toggle */}
          <div style={{ display: "flex", gap: 8, margin: "14px 0 16px" }}>
            <ModeTab on={mode === "preview"} onClick={() => setMode("preview")} icon={<Eye size={14} />} label={he ? "תצוגה מקדימה" : "Preview"} />
            <ModeTab on={mode === "edit"} onClick={() => setMode("edit")} icon={<Pencil size={14} />} label={he ? "עריכה" : "Edit"} />
          </div>

          {q.isLoading || !def ? (
            <div style={{ padding: 24, color: C.muted, fontSize: 13 }}><Loader2 size={16} className="spin" /></div>
          ) : mode === "preview" ? (
            <BonusProgramShowcase def={def} he={he} rtl={rtl} />
          ) : (
            <EditForm def={def} he={he} rtl={rtl} onSaved={() => { qc.invalidateQueries({ queryKey: ["bonusProgramDef"] }); setMode("preview"); }} />
          )}
        </div>
      )}
    </div>
  );
}

function ModeTab({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="tap44"
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 999,
        border: `1px solid ${on ? C.gold : C.line}`, background: on ? `${C.gold}1a` : C.surface,
        color: on ? C.gold : C.muted, fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
      {icon} {label}
    </button>
  );
}

function EditForm({ def, he, rtl, onSaved }: { def: BonusProgramDef; he: boolean; rtl: boolean; onSaved: () => void }) {
  const [titleHe, setTitleHe] = useState(def.titleHe || "");
  const [titleEn, setTitleEn] = useState(def.titleEn || "");
  const [introHe, setIntroHe] = useState(def.introHe || "");
  const [introEn, setIntroEn] = useState(def.introEn || "");
  const [benefitHe, setBenefitHe] = useState(def.benefitHe || "");
  const [benefitEn, setBenefitEn] = useState(def.benefitEn || "");
  const [termsHe, setTermsHe] = useState(def.termsHe || "");
  const [termsEn, setTermsEn] = useState(def.termsEn || "");
  const [steps, setSteps] = useState<BonusProgramStep[]>(def.steps?.length ? def.steps.map((s) => ({ ...s })) : []);

  const save = useMutation({
    mutationFn: () => api.bonusProgramDefSave({ titleHe, titleEn, introHe, introEn, benefitHe, benefitEn, termsHe, termsEn, steps }),
    onSuccess: onSaved,
  });

  const setStep = (i: number, patch: Partial<BonusProgramStep>) => setSteps((ss) => ss.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const rmStep = (i: number) => setSteps((ss) => ss.filter((_, j) => j !== i));
  const addStep = () => setSteps((ss) => [...ss, emptyStep()]);
  const moveStep = (i: number, dir: -1 | 1) => setSteps((ss) => {
    const j = i + dir; if (j < 0 || j >= ss.length) return ss;
    const c = [...ss]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 5, display: "block" };
  const ta: React.CSSProperties = { ...input, width: "100%", boxSizing: "border-box", minHeight: 64, lineHeight: 1.6, resize: "vertical" };
  const bipair = (labelHe: string, labelEn: string, vHe: string, sHe: (s: string) => void, vEn: string, sEn: (s: string) => void, multiline = true) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
      <div><label style={lbl}>{he ? labelHe : labelEn} · עברית</label>
        {multiline
          ? <textarea value={vHe} onChange={(e) => sHe(e.target.value)} dir="rtl" style={ta} />
          : <input value={vHe} onChange={(e) => sHe(e.target.value)} dir="rtl" style={{ ...input, width: "100%", boxSizing: "border-box" }} />}</div>
      <div><label style={lbl}>{he ? labelHe : labelEn} · English</label>
        {multiline
          ? <textarea value={vEn} onChange={(e) => sEn(e.target.value)} dir="ltr" style={ta} />
          : <input value={vEn} onChange={(e) => sEn(e.target.value)} dir="ltr" style={{ ...input, width: "100%", boxSizing: "border-box" }} />}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {bipair("כותרת", "Title", titleHe, setTitleHe, titleEn, setTitleEn, false)}
      {bipair("מבוא / הסבר", "Intro / explanation", introHe, setIntroHe, introEn, setIntroEn)}

      {/* steps */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>{he ? "שלבים — איך זה עובד" : "Steps — how it works"}</span>
          <button onClick={addStep} style={{ ...btn(false) }}><Plus size={14} /> {he ? "הוסף שלב" : "Add step"}</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: C.gold }}>{he ? `שלב ${i + 1}` : `Step ${i + 1}`}</span>
                <div style={{ minWidth: 150 }}>
                  <select value={s.icon || "Sparkles"} onChange={(e) => setStep(i, { icon: e.target.value })} style={{ ...input, cursor: "pointer", padding: "6px 9px" }}>
                    {BONUS_STEP_ICON_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
                <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 4 }}>
                  <button onClick={() => moveStep(i, -1)} disabled={i === 0} title={he ? "למעלה" : "Up"} style={iconBtn(i === 0)}><ChevronUp size={15} /></button>
                  <button onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} title={he ? "למטה" : "Down"} style={iconBtn(i === steps.length - 1)}><ChevronDown size={15} /></button>
                  <button onClick={() => rmStep(i)} title={he ? "מחק" : "Delete"} style={{ ...iconBtn(false), color: C.loss }}><Trash2 size={15} /></button>
                </span>
              </div>
              {bipair("כותרת השלב", "Step title", s.titleHe, (v) => setStep(i, { titleHe: v }), s.titleEn, (v) => setStep(i, { titleEn: v }), false)}
              <div style={{ height: 10 }} />
              {bipair("תיאור השלב", "Step body", s.bodyHe, (v) => setStep(i, { bodyHe: v }), s.bodyEn, (v) => setStep(i, { bodyEn: v }))}
            </div>
          ))}
          {steps.length === 0 && <div style={{ fontSize: 12.5, color: C.faint, padding: "6px 0" }}>{he ? "אין שלבים — הוסף שלב." : "No steps — add one."}</div>}
        </div>
      </div>

      {bipair("הערך / התועלת", "Benefit / upside", benefitHe, setBenefitHe, benefitEn, setBenefitEn)}
      {bipair("תנאים", "Terms", termsHe, setTermsHe, termsEn, setTermsEn)}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => save.mutate()} disabled={save.isPending} style={{ ...btn(true) }}>
          {save.isPending ? <Loader2 size={15} className="spin" /> : <Save size={15} />} {he ? "שמור הגדרה" : "Save definition"}
        </button>
        {save.isSuccess && <span style={{ fontSize: 12.5, fontWeight: 700, color: C.gain, display: "inline-flex", alignItems: "center", gap: 5 }}><Check size={14} /> {he ? "נשמר ✓" : "Saved ✓"}</span>}
        {save.isError && <span style={{ fontSize: 12, color: C.loss }}>{String((save.error as any)?.message || save.error)}</span>}
        {def.updatedBy && <span style={{ fontSize: 11, color: C.faint, marginInlineStart: "auto" }}>{he ? "עודכן ע\"י" : "Updated by"} {def.updatedBy}</span>}
      </div>
    </div>
  );
}

const iconBtn = (disabled: boolean): React.CSSProperties => ({
  display: "inline-grid", placeItems: "center", width: 30, height: 30, borderRadius: 8,
  background: C.surface2, border: `1px solid ${C.line}`, color: C.muted,
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
});
