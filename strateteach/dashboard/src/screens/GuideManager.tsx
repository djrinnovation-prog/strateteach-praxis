import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Gem, ArrowUp, ArrowDown, Upload, RotateCcw, Save, Play, Check, ChevronLeft, ChevronRight, Volume2, ImageIcon,
} from "lucide-react";
import { api, isOwner, isAdminOrOwner } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C } from "../theme";
import { toastSuccess, toastError } from "../lib/toast";
import type { GuideConfig, GuideStep, GuideGesture, GuideAnchor, GuidePoses } from "../lib/client";

// ── Guide manager — owner/admin console for Yoav's animated Home Guide ─────────────────────
// Server-backed (config singleton + binary asset store), so non-devs update the guide with NO
// deploy: master on/off, first-visit auto-offer, character size, and per-step editing —
// bilingual captions (HE + EN), reorder, enable, gesture + anchor, and replacing the per-step
// voice mp3 or any character pose png. Role-gated to owner OR role==admin (require_admin on the
// server; the UI mirrors the gate). MONEY-SAFETY: onboarding narration only — no money surface.

const GESTURES: GuideGesture[] = ["wave", "point", "cheer", "talk"];
const ANCHORS: Exclude<GuideAnchor, null>[] = ["ticker", "tools", "engine", "signal", "portfolio", "bottom"];
// The 7 poses + their shipped-default static file, for "reset to default".
const POSE_ROWS: { key: keyof GuidePoses; label: string; file: string }[] = [
  { key: "talk", label: "Talk (base)", file: "talk.png" },
  { key: "mouthAh", label: "Mouth · ah", file: "mouth-ah.png" },
  { key: "mouthOo", label: "Mouth · oo", file: "mouth-oo.png" },
  { key: "blink", label: "Blink", file: "blink.png" },
  { key: "point", label: "Point", file: "point.png" },
  { key: "wave", label: "Wave", file: "wave.png" },
  { key: "cheer", label: "Cheer", file: "cheer.png" },
];
// Default voice line per shipped step id (for reset).
const DEFAULT_VOICE: Record<string, string> = {
  intro: "/media/guide/voice/line-1.mp3", ticker: "/media/guide/voice/line-2.mp3",
  tools: "/media/guide/voice/line-3.mp3", engine: "/media/guide/voice/line-4.mp3",
  signal: "/media/guide/voice/line-5.mp3", portfolio: "/media/guide/voice/line-6.mp3",
  bottom: "/media/guide/voice/line-7.mp3", outro: "/media/guide/voice/line-8.mp3",
};

const slug = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 34) || "x";
const voiceKey = (stepId: string) => `voice-${slug(stepId)}`;
const poseKey = (k: keyof GuidePoses) => `pose-${slug(String(k))}`;

export default function GuideManager() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const he = lang === "he";
  const canManage = isAdminOrOwner();

  const q = useQuery({ queryKey: ["guideConfig"], queryFn: () => api.guideConfigGet(), staleTime: 30000, retry: 0 });
  const [draft, setDraft] = useState<GuideConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => { if (q.data?.config && !draft) setDraft(q.data.config); }, [q.data]);

  if (!canManage) {
    return (
      <div style={{ padding: 24, color: C.text }}>
        <h2>{he ? "אין הרשאה" : "No access"}</h2>
        <p style={{ color: C.muted }}>{he ? "מסך זה פתוח לבעלים ולמנהלים בלבד." : "This screen is for owners and admins only."}</p>
      </div>
    );
  }
  if (!draft) return <div style={{ padding: 24, color: C.muted }}>{he ? "טוען…" : "Loading…"}</div>;

  const mut = (fn: (d: GuideConfig) => void) => { setDraft((prev) => { if (!prev) return prev; const n: GuideConfig = JSON.parse(JSON.stringify(prev)); fn(n); return n; }); setDirty(true); };
  const mutStep = (i: number, fn: (s: GuideStep) => void) => mut((d) => fn(d.steps[i]));
  const move = (i: number, dir: -1 | 1) => mut((d) => { const j = i + dir; if (j < 0 || j >= d.steps.length) return; const [s] = d.steps.splice(i, 1); d.steps.splice(j, 0, s); });

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const res = await api.guideConfigSave(draft);
      setDraft(res.config); setDirty(false);
      q.refetch();
      toastSuccess(he ? "המדריך נשמר" : "Guide saved");
    } catch (e: any) {
      toastError(e?.message || (he ? "השמירה נכשלה" : "Save failed"));
    } finally { setSaving(false); }
  };

  const previewOnHome = () => { try { sessionStorage.setItem("algo770_guide_open", "1"); } catch { /* */ } nav("/"); };

  // Upload a file to a slot; on success point the field at the served override URL (cache-busted).
  const uploadTo = async (slot: string, file: File, apply: (url: string) => void) => {
    setBusyKey(slot);
    try {
      await api.guideAssetUpload(slot, file);
      apply(api.guideAssetUrl(slot, Date.now()));
      toastSuccess(he ? "הקובץ הוחלף" : "Asset replaced");
    } catch (e: any) {
      toastError(e?.message || (he ? "ההעלאה נכשלה" : "Upload failed"));
    } finally { setBusyKey(null); }
  };
  const resetAsset = async (slot: string, apply: () => void) => {
    setBusyKey(slot);
    try { await api.guideAssetDelete(slot); apply(); toastSuccess(he ? "שוחזר לברירת מחדל" : "Reset to default"); }
    catch (e: any) { toastError(e?.message || (he ? "האיפוס נכשל" : "Reset failed")); }
    finally { setBusyKey(null); }
  };

  const overridden = new Set(q.data?.assetKeys || []);
  const Fwd = rtl ? ChevronLeft : ChevronRight;

  const label: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: C.muted, letterSpacing: "0.02em" };
  const field: React.CSSProperties = { width: "100%", background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 14 };
  const chipBtn = (active?: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 5, background: active ? C.accentGrad : C.surface2, color: active ? "#0b1024" : C.text, border: `1px solid ${active ? "transparent" : C.line}`, borderRadius: 8, padding: "6px 9px", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" });

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: mobile ? "14px 12px 40px" : "20px 18px 60px", direction: rtl ? "rtl" : "ltr" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <button onClick={() => nav(-1)} className="tap44" aria-label="back" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer" }}>
          {rtl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <Gem size={22} color={C.gold} />
        <h1 style={{ margin: 0, fontSize: mobile ? 18 : 22, fontWeight: 900, color: C.text, flex: 1 }}>{he ? "מנהל המדריך" : "Guide Manager"}</h1>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        {he ? "עריכת המדריך המונפש של מסך הבית — טקסטים, סדר, קול ודמות. השינויים חלים לכולם ללא פריסה."
            : "Edit the animated Home guide — captions, order, voice and character. Changes apply to everyone with no deploy."}
      </p>

      {/* Master controls */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <Toggle on={draft.enabled} onChange={(v) => mut((d) => { d.enabled = v; })} label={he ? "המדריך פעיל" : "Guide enabled"} />
          <Toggle on={draft.autoOfferFirstVisit} onChange={(v) => mut((d) => { d.autoOfferFirstVisit = v; })} label={he ? "הצעה אוטומטית בביקור ראשון" : "Auto-offer on first visit"} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={label}>{he ? "גודל דמות" : "Character size"}</span>
            <input type="range" min={0.5} max={1.6} step={0.05} value={draft.characterScale}
              onChange={(e) => mut((d) => { d.characterScale = Number(e.target.value); })} style={{ width: 120 }} />
            <span style={{ ...label, minWidth: 34 }}>{Math.round(draft.characterScale * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {draft.steps.map((s, i) => (
          <div key={i} style={{ ...card, opacity: s.enabled ? 1 : 0.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: C.accentGrad, color: "#0b1024", fontWeight: 900, fontSize: 13, display: "grid", placeItems: "center" }}>{i + 1}</span>
              <b style={{ fontSize: 14, color: C.text, flex: 1, minWidth: 80 }}>{s.id}</b>
              <Toggle on={s.enabled} onChange={(v) => mutStep(i, (st) => { st.enabled = v; })} label={he ? "פעיל" : "On"} small />
              <div style={{ display: "flex", gap: 4 }}>
                <IconBtn onClick={() => move(i, -1)} disabled={i === 0} aria-label="up"><ArrowUp size={15} /></IconBtn>
                <IconBtn onClick={() => move(i, 1)} disabled={i === draft.steps.length - 1} aria-label="down"><ArrowDown size={15} /></IconBtn>
              </div>
            </div>

            {/* gesture + anchor */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>{he ? "מחווה" : "Gesture"}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {GESTURES.map((g) => <button key={g} onClick={() => mutStep(i, (st) => { st.gesture = g; })} style={chipBtn(s.gesture === g)}>{g}</button>)}
                </div>
              </div>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>{he ? "עוגן (מדגיש חלק במסך)" : "Anchor (spotlights a section)"}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  <button onClick={() => mutStep(i, (st) => { st.anchor = null; })} style={chipBtn(s.anchor === null)}>{he ? "ללא" : "none"}</button>
                  {ANCHORS.map((a) => <button key={a} onClick={() => mutStep(i, (st) => { st.anchor = a; })} style={chipBtn(s.anchor === a)}>{a}</button>)}
                </div>
              </div>
            </div>

            {/* captions */}
            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>{he ? "כיתוב · עברית" : "Caption · Hebrew"}</div>
                <textarea value={s.captionHe} dir="rtl" onChange={(e) => mutStep(i, (st) => { st.captionHe = e.target.value; })} rows={4} style={{ ...field, resize: "vertical" }} />
              </div>
              <div>
                <div style={{ ...label, marginBottom: 4 }}>{he ? "כיתוב · אנגלית" : "Caption · English"}</div>
                <textarea value={s.captionEn} dir="ltr" onChange={(e) => mutStep(i, (st) => { st.captionEn = e.target.value; })} rows={4} style={{ ...field, resize: "vertical" }} />
              </div>
            </div>

            {/* voice + duration */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <AssetControl
                icon={<Volume2 size={14} color={C.gold} />}
                title={he ? "קול (EN)" : "Voice (EN)"}
                url={s.audio} accept="audio/*"
                overridden={overridden.has(voiceKey(s.id))}
                busy={busyKey === voiceKey(s.id)}
                onUpload={(f) => uploadTo(voiceKey(s.id), f, (url) => mutStep(i, (st) => { st.audio = url; }))}
                onReset={DEFAULT_VOICE[s.id] ? () => resetAsset(voiceKey(s.id), () => mutStep(i, (st) => { st.audio = DEFAULT_VOICE[s.id]; })) : undefined}
                preview="audio" he={he}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={label}>{he ? "משך גיבוי (שנ')" : "Fallback (s)"}</span>
                <input type="number" min={1} max={120} step={0.1} value={s.dur} onChange={(e) => mutStep(i, (st) => { st.dur = Number(e.target.value); })} style={{ ...field, width: 74 }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Character poses */}
      <h2 style={{ fontSize: 15, fontWeight: 900, color: C.text, margin: "22px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <ImageIcon size={17} color={C.gold} /> {he ? "דמות (7 תנוחות)" : "Character (7 poses)"}
      </h2>
      <div style={{ ...card, display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {POSE_ROWS.map((p) => (
          <AssetControl key={p.key}
            icon={<span style={{ fontSize: 11, fontWeight: 800, color: C.muted }}>{p.label}</span>}
            title="" url={draft.poses[p.key]} accept="image/*"
            overridden={overridden.has(poseKey(p.key))}
            busy={busyKey === poseKey(p.key)}
            onUpload={(f) => uploadTo(poseKey(p.key), f, (url) => mut((d) => { d.poses[p.key] = url; }))}
            onReset={() => resetAsset(poseKey(p.key), () => mut((d) => { d.poses[p.key] = `/media/guide/character/${p.file}`; }))}
            preview="image" he={he} wide
          />
        ))}
      </div>

      {/* Sticky action bar */}
      <div style={{ position: "sticky", bottom: 0, marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end",
        background: `linear-gradient(180deg, transparent, ${C.bg} 40%)`, padding: "14px 0 4px" }}>
        <button onClick={previewOnHome} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "11px 16px", fontSize: 13.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          <Play size={15} /> {he ? "תצוגה במסך הבית" : "Preview on Home"}
        </button>
        <button onClick={save} disabled={!dirty || saving} className="gbtn" style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 12, padding: "11px 20px", fontSize: 14, fontWeight: 900, cursor: dirty && !saving ? "pointer" : "default", opacity: dirty && !saving ? 1 : 0.55, fontFamily: "inherit" }}>
          {saving ? <RotateCcw size={15} className="spin" /> : dirty ? <Save size={15} /> : <Check size={15} />}
          {saving ? (he ? "שומר…" : "Saving…") : dirty ? (he ? "שמור" : "Save") : (he ? "נשמר" : "Saved")}
        </button>
      </div>
      {draft.updatedAt && (
        <div style={{ textAlign: rtl ? "right" : "left", fontSize: 11, color: C.faint, marginTop: 8 }}>
          {he ? "עודכן לאחרונה" : "Last updated"}: {draft.updatedAt}{draft.updatedBy ? ` · ${draft.updatedBy}` : ""}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange, label, small }: { on: boolean; onChange: (v: boolean) => void; label: string; small?: boolean }) {
  return (
    <button onClick={() => onChange(!on)} className="tap44" style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
      <span style={{ width: small ? 34 : 40, height: small ? 20 : 24, borderRadius: 999, background: on ? C.accentGrad : C.surface2, border: `1px solid ${on ? "transparent" : C.line}`, position: "relative", transition: "background .2s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: small ? 2 : 2, insetInlineStart: on ? (small ? 16 : 18) : 2, width: small ? 14 : 18, height: small ? 14 : 18, borderRadius: "50%", background: "#fff", transition: "inset-inline-start .2s", boxShadow: "0 1px 3px rgba(0,0,0,.4)" }} />
      </span>
      <span style={{ fontSize: small ? 12 : 13, fontWeight: 800, color: C.text }}>{label}</span>
    </button>
  );
}

function IconBtn({ children, onClick, disabled, ...rest }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; "aria-label"?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="tap44" {...rest}
      style={{ width: 30, height: 30, display: "grid", placeItems: "center", background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}>
      {children}
    </button>
  );
}

// One asset slot — current preview + replace + (optional) reset-to-default.
function AssetControl({ icon, title, url, accept, overridden, busy, onUpload, onReset, preview, he, wide }: {
  icon: React.ReactNode; title: string; url: string | null; accept: string; overridden: boolean; busy?: boolean;
  onUpload: (f: File) => void; onReset?: () => void; preview: "audio" | "image"; he: boolean; wide?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: wide ? "1 1 100%" : undefined,
      background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 74 }}>{icon}{title && <span style={{ fontSize: 12, fontWeight: 800, color: C.text }}>{title}</span>}</span>
      {preview === "image" && url ? (
        <img src={url} alt="" style={{ height: 46, width: "auto", borderRadius: 6, background: "rgba(0,0,0,0.2)" }} />
      ) : preview === "audio" && url ? (
        <audio src={url} controls preload="none" style={{ height: 30, maxWidth: 190 }} />
      ) : (
        <span style={{ fontSize: 11, color: C.faint }}>{he ? "אין" : "none"}</span>
      )}
      {overridden && <span style={{ fontSize: 10, fontWeight: 800, color: "#0b1024", background: C.gold, borderRadius: 5, padding: "1px 6px" }}>{he ? "מותאם" : "custom"}</span>}
      <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }} />
      <button onClick={() => inputRef.current?.click()} disabled={busy} className="tap44"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, background: C.surface, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "6px 9px", fontSize: 11.5, fontWeight: 800, cursor: busy ? "default" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
        <Upload size={13} /> {busy ? (he ? "מעלה…" : "…") : (he ? "החלף" : "Replace")}
      </button>
      {onReset && overridden && (
        <button onClick={onReset} disabled={busy} className="tap44" aria-label="reset"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 8, padding: "6px 8px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}
