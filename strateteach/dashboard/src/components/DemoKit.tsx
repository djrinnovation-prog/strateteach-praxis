import React, { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lightbulb, X, Check, Clock, LogOut, Loader2, ImagePlus, MessageCircle, ArrowLeft } from "lucide-react";
import { api, saveToken } from "../app/api";
import { useEntitlements } from "../lib/entitlements";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";

const BRAND = "linear-gradient(135deg,#FBC02D,#F7931A 55%,#7CC04E)";

// The floating left "side rail" (Improve / Learn / Music slide-out tabs + the
// show/hide handle) has been retired — no pull-out tabs dock on the screen edge
// any more. This hook is kept (returning `true`) so its consumers — FeedbackButton,
// Avatar's Learn tab, MusicPlayer — simply render nothing, with no per-component
// change needed. RailToggle was removed for the same reason.
export function useRailHidden() {
  return true;
}

// Demo countdown banner + "time's up" lockout for timed demo testers.
export function DemoBanner() {
  const { lang } = useI18n();
  const ent = useEntitlements().data;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  if (!ent?.isDemo || !ent.demoExpires) return null;
  const left = Math.max(0, Math.floor((new Date(ent.demoExpires).getTime() - now) / 1000));
  const tr = (en: string, he: string) => (lang === "he" ? he : en);
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m2 = Math.floor((left % 3600) / 60), s2 = left % 60;
  const timeStr = d > 0
    ? `${d}${tr("d", " ימ׳")} ${h}${tr("h", " ש׳")}`
    : h > 0
      ? `${h}${tr("h", " ש׳")} ${String(m2).padStart(2, "0")}${tr("m", " דק׳")}`
      : `${String(m2).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;

  if (left <= 0) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: `radial-gradient(1000px 700px at 50% -10%, ${C.surface}, ${C.bg} 60%)`, color: C.text,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: UI, textAlign: "center", padding: 24 }}>
        <div style={{ width: 70, height: 70, borderRadius: "50%", background: "rgba(247,147,26,0.14)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
          <Clock size={32} color={C.gold} />
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 6px" }}>{tr("Your demo time is up", "זמן הדמו הסתיים")}</h1>
        {(() => { let s = null; try { s = localStorage.getItem("algo770_last_score"); } catch (_e) { /* */ } return s != null ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 999, background: "rgba(247,147,26,0.14)", border: `1px solid ${C.gold}55`, color: C.gold, fontWeight: 800, fontSize: 16, marginBottom: 14 }}>
            ⭐ {tr("Your tester score", "הציון שלך")}: {s}/100
          </div>
        ) : null; })()}
        <p style={{ color: C.muted, fontSize: 14, maxWidth: 360, lineHeight: 1.6, margin: "0 0 20px" }}>
          {tr("Thanks for testing ALGO770! Ask the admin for a fresh demo link, or get full access.", "תודה שניסיתם את ALGO770! בקשו מהמנהל קישור דמו חדש, או קבלו גישה מלאה.")}
        </p>
        <button onClick={() => { saveToken(null); window.location.href = "/"; }} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer", background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 14, borderRadius: 12, padding: "12px 26px", fontFamily: UI }}>
          <LogOut size={16} /> {tr("Exit demo", "יציאה")}
        </button>
      </div>
    );
  }
  // While time remains we DON'T render a top bar (it overlapped the ticker on
  // desktop and the header on mobile). The live countdown is shown inside the
  // Home P&L card instead — see <DemoCountdown/>. Only the lockout is global.
  return null;
}

// Live "time left" formatter for a demo user — reused by the Home P&L card.
export function useDemoLeft(): { isDemo: boolean; timeStr: string; low: boolean } | null {
  const ent = useEntitlements().data;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  if (!ent?.isDemo || !ent.demoExpires) return null;
  const left = Math.max(0, Math.floor((new Date(ent.demoExpires).getTime() - now) / 1000));
  const d = Math.floor(left / 86400), h = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60);
  const timeStr = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return { isDemo: true, timeStr, low: left <= 24 * 3600 };
}

// One-time explainer shown to a demo user on first login: how to suggest, where
// the slide tab is, and that feedback lives in the Chat section.
export function DemoIntro() {
  const { lang } = useI18n();
  const ent = useEntitlements().data;
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem("algo770_demo_intro") === "1"; } catch { return false; } });
  const tr = (en: string, he: string) => (lang === "he" ? he : en);
  if (!ent?.isDemo || seen) return null;
  const close = () => { try { localStorage.setItem("algo770_demo_intro", "1"); } catch (_e) { /* */ } setSeen(true); };
  const steps = [
    { Icon: Lightbulb, t: tr("Tap the “Improve” tab on the side edge to send a suggestion — you can attach a screenshot (up to 3MB).", "לחצו על לשונית ‘שיפור’ בצד המסך כדי לשלוח הצעה — אפשר לצרף צילום מסך (עד 3MB).") },
    { Icon: ArrowLeft, t: tr("It’s a slide-out tab on the side, stacked with Learn and Music.", "זו לשונית נשלפת בצד המסך, יחד עם ‘למידה’ ו‘מוזיקה’.") },
    { Icon: MessageCircle, t: tr("Your suggestions appear in the Chat section, where you and the admin can discuss them.", "ההצעות שלכם מופיעות במסך הצ׳אט, שם אתם והמנהל יכולים לדון בהן.") },
    { Icon: Clock, t: tr("The bar at the top shows how much demo time you have left.", "הסרגל למעלה מראה כמה זמן דמו נותר לכם.") },
  ];
  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 4500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(5px)", fontFamily: UI, direction: lang === "he" ? "rtl" : "ltr" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px,94vw)", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", color: C.text }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 6 }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--btn-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}><Lightbulb size={18} color="#1a1206" /></span>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{tr("Welcome, tester!", "ברוכים הבאים, בודקים!")}</h2>
        </div>
        <p style={{ fontSize: 13, color: C.muted, margin: "0 0 14px", lineHeight: 1.5 }}>{tr("You have full access for a week. Here’s how to help us improve:", "יש לכם גישה מלאה לשבוע. כך תוכלו לעזור לנו להשתפר:")}</p>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "9px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
            <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, background: C.surface2, border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center" }}><s.Icon size={15} color={C.gold} /></span>
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>{s.t}</span>
          </div>
        ))}
        <button onClick={close} style={{ marginTop: 16, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, border: "none", cursor: "pointer", background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 14, borderRadius: 12, padding: "12px", fontFamily: UI }}>
          <Check size={16} /> {tr("Got it — let’s go", "הבנתי — קדימה")}
        </button>
      </div>
    </div>
  );
}

// Floating "Send a suggestion" button — feedback from testers, tagged with the screen.
export function FeedbackButton() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tr = (en: string, he: string) => (lang === "he" ? he : en);
  const m = useMutation({
    mutationFn: () => api.submitFeedback(text.trim(), window.location.pathname, img),
    onSuccess: () => { setText(""); setImg(null); setOpen(false); },
  });
  async function pickImg(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (!/image\//.test(f.type)) { alert(tr("Pick an image", "בחרו תמונה")); return; }
    if (f.size > 3 * 1024 * 1024) { alert(tr("Image must be under 3MB", "התמונה חייבת להיות עד 3MB")); return; }
    const url: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
    setImg(url);
  }
  const railHidden = useRailHidden();
  if (railHidden) return null;
  return (
    <>
      {/* Docked on the inline-start edge as a vertical slide tab, stacked above Learn
          (120) and Music (16) so nothing floats over the page or overlaps. */}
      <button onClick={() => setOpen((o) => !o)} title={tr("Send a suggestion", "שלחו הצעה")}
        style={{ position: "fixed", insetInlineStart: 0, bottom: 224, zIndex: 60, display: "flex", alignItems: "center", gap: 6,
          background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none", borderStartEndRadius: 10, borderEndEndRadius: 10, padding: "10px 8px", fontWeight: 800, fontSize: 12,
          cursor: "pointer", fontFamily: UI, boxShadow: "0 6px 20px rgba(0,0,0,0.4)", writingMode: "vertical-rl" } as React.CSSProperties}>
        <Lightbulb size={15} /> {tr("Improve", "שיפור")}
      </button>
      {open && (
        <div style={{ position: "fixed", bottom: 224, insetInlineStart: 44, zIndex: 66, width: "min(320px,86vw)",
          background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, boxShadow: "0 16px 40px rgba(0,0,0,0.5)", fontFamily: UI }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Lightbulb size={14} color={C.gold} /> {tr("Your suggestion", "ההצעה שלכם")}</span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={15} /></button>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={tr("What can we improve?", "מה אפשר לשפר?")}
            style={{ width: "100%", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 11px", color: C.text, fontFamily: UI, fontSize: 13, resize: "vertical" }} />
          {img ? (
            <div style={{ position: "relative", marginTop: 8 }}>
              <img src={img} alt="" style={{ width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 9, border: `1px solid ${C.line}` }} />
              <button onClick={() => setImg(null)} style={{ position: "absolute", top: 6, insetInlineEnd: 6, width: 24, height: 24, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} style={{ marginTop: 8, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, background: C.surface2, border: `1px dashed ${C.line}`, color: C.muted, borderRadius: 9, padding: "8px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: UI }}>
              <ImagePlus size={14} /> {tr("Attach a screenshot (≤3MB)", "צרפו צילום מסך (עד 3MB)")}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={pickImg} style={{ display: "none" }} />
          <button onClick={() => (text.trim() || img) && m.mutate()} disabled={m.isPending || (!text.trim() && !img)}
            style={{ marginTop: 8, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", cursor: "pointer", background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 13, borderRadius: 10, padding: "9px", fontFamily: UI, opacity: (text.trim() || img) ? 1 : 0.5 }}>
            {m.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {tr("Send", "שליחה")}
          </button>
        </div>
      )}
    </>
  );
}
