import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Send, Sparkles, Trash2, Check } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI, onAccent } from "../theme";
import { DESTINATIONS, PROMO_GROUP_LABEL, PROMO_GROUP_ORDER } from "../lib/destinations";

export default function PromoteFeature() {
  const { lang } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["featurePromo"], queryFn: () => api.getAnnouncement() });
  const current = (q.data as any)?.promo as { title: string; body: string; route: string; cta: string } | null | undefined;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [route, setRoute] = useState("/strategy");
  const [cta, setCta] = useState("");
  // linkMode = the banner links to a destination (with an "Open" button). When
  // off, it's a text-only announcement: no destination, no CTA, not clickable.
  const [linkMode, setLinkMode] = useState(true);
  const [doSms, setDoSms] = useState(false);
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [flash, setFlash] = useState<string | null>(null);

  // Prefill from whatever is currently live so the admin can tweak it. A live
  // promo with no route is a text-only one → start in text-only mode.
  useEffect(() => {
    if (current) {
      setTitle(current.title || ""); setBody(current.body || "");
      setCta(current.cta || "");
      const hasRoute = !!(current.route && current.route.trim());
      setLinkMode(hasRoute);
      setRoute(hasRoute ? current.route : "/strategy");
    }
  }, [current?.title, current?.body, current?.route]);

  const pubM = useMutation({
    // Text-only mode publishes an empty route + cta so the banner renders as a
    // plain (non-clickable) line. Backward compatible: a route still links.
    mutationFn: () => api.setAnnouncement({ title, body, route: linkMode ? route : "", cta: linkMode ? cta : "", sms: doSms, channel, target: "all" }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["featurePromo"] });
      const s = r?.sms;
      setFlash(s ? TT(`Published. SMS sent to ${s.sent}/${s.total}.`, `פורסם. SMS נשלח ל-${s.sent}/${s.total}.`)
                 : TT("Published to the home page.", "פורסם בעמוד הבית."));
      setTimeout(() => setFlash(null), 4000);
    },
  });
  const clearM = useMutation({
    mutationFn: () => api.clearAnnouncement(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["featurePromo"] }); setFlash(TT("Taken down.", "הוסר.")); setTimeout(() => setFlash(null), 3000); },
  });

  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 5, display: "block" };
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, color: C.text, fontSize: 13.5, padding: "10px 12px", fontFamily: UI };

  return (
    <div style={{ fontFamily: UI, maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Megaphone size={17} color={C.gold} />
        <div style={{ fontSize: 15, fontWeight: 800 }}>{TT("Promote a new feature", "קידום פיצ'ר חדש")}</div>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
        {TT("Publishes a shiny “NEW” banner on everyone's home page. Link it to any screen (or sub-tab) — or make it a text-only announcement. Optionally blast an SMS to all users.",
            "מפרסם באנר \"חדש\" נוצץ בעמוד הבית של כולם. אפשר לקשר אותו לכל מסך (או תת-לשונית) — או להפוך אותו להכרזת טקסט בלבד. אפשר גם לשלוח SMS לכל המשתמשים.")}
      </div>

      {current && (
        <div style={{ background: `${C.gain}1a`, border: `1px solid ${C.gain}55`, borderRadius: 10, padding: "10px 12px", marginBottom: 14, fontSize: 12.5 }}>
          <span style={{ color: C.gain, fontWeight: 800 }}>● {TT("Live now", "פעיל כעת")}:</span>{" "}
          <b>{current.title}</b>{current.body ? ` — ${current.body}` : ""}{" "}
          <span style={{ color: C.faint }}>{current.route && current.route.trim() ? `→ ${current.route}` : TT("(text only)", "(טקסט בלבד)")}</span>
        </div>
      )}

      <label style={lbl}>{TT("Title (bold part)", "כותרת (החלק המודגש)")}</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={TT("New Strategy Lab is here", "מעבדת האסטרטגיות החדשה כאן")} style={{ ...inp, marginBottom: 12 }} />

      <label style={lbl}>{TT("Message", "הודעה")}</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={TT("Build, check and backtest your strategy like TradingView.", "בנו, בדקו והריצו בק-טסט לאסטרטגיה כמו ב-TradingView.")} style={{ ...inp, marginBottom: 12, resize: "vertical" }} />

      {/* Link to a destination vs. text-only announcement */}
      <label style={lbl}>{TT("Banner type", "סוג הבאנר")}</label>
      <div role="radiogroup" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { v: true, en: "Link to a screen", he: "קישור למסך" },
          { v: false, en: "Text only (no button)", he: "טקסט בלבד (בלי כפתור)" },
        ].map((o) => {
          const on = linkMode === o.v;
          return (
            <button key={String(o.v)} type="button" role="radio" aria-checked={on} onClick={() => setLinkMode(o.v)}
              style={{ flex: 1, minWidth: 160, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer",
                background: on ? `${C.gold}1f` : C.surface2, border: `1px solid ${on ? C.gold : C.line}`, color: on ? C.text : C.muted,
                borderRadius: 9, padding: "9px 12px", fontSize: 13, fontWeight: 700, fontFamily: UI }}>
              {on && <Check size={14} color={C.gold} />} {TT(o.en, o.he)}
            </button>
          );
        })}
      </div>

      {linkMode && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={lbl}>{TT("Opens this screen", "פותח את המסך")}</label>
            <select value={route} onChange={(e) => setRoute(e.target.value)} style={{ ...inp, marginBottom: 12 }}>
              {PROMO_GROUP_ORDER.map((g) => (
                <optgroup key={g} label={lang === "he" ? PROMO_GROUP_LABEL[g].he : PROMO_GROUP_LABEL[g].en}>
                  {DESTINATIONS.filter((d) => d.group === g).map((d) => (
                    <option key={d.path} value={d.path}>{lang === "he" ? d.he : d.en} ({d.path})</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={lbl}>{TT("Button text (optional)", "טקסט כפתור (לא חובה)")}</label>
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder={TT("Tap to see", "לחצו לצפייה")} style={{ ...inp, marginBottom: 12 }} />
          </div>
        </div>
      )}

      {/* live preview of the banner */}
      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>{TT("Preview", "תצוגה מקדימה")}</label>
        <div style={{ position: "relative", border: `1.5px solid ${C.gold}`, borderRadius: 14, padding: "10px 12px", overflow: "hidden",
          background: `linear-gradient(110deg, ${C.gold}29, ${C.gain}24 50%, ${C.gold}29)`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", color: onAccent(C.gold), padding: "3px 9px", borderRadius: 999,
            background: C.accentGrad }}>★ {TT("NEW", "חדש")}</span>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 800, fontSize: 13.5 }}>
            {title ? <span style={{ color: C.gold }}>{title}</span> : <span style={{ color: C.faint }}>{TT("Title…", "כותרת…")}</span>}
            {title && body ? " — " : ""}{body}
            {linkMode && <span style={{ color: C.gain, fontWeight: 900 }}> · {cta || TT("Tap to see", "לחצו לצפייה")} ›</span>}
          </span>
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14, cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.text }}>
        <input type="checkbox" checked={doSms} onChange={(e) => setDoSms(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.gold }} />
        <Send size={14} color={C.gold} /> {TT("Also send an SMS blast to all users", "גם שלח SMS לכל המשתמשים")}
        {doSms && (
          <select value={channel} onChange={(e) => setChannel(e.target.value as any)} onClick={(e) => e.preventDefault()} style={{ marginInlineStart: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 7, color: C.text, fontSize: 12, padding: "4px 8px" }}>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        )}
      </label>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => pubM.mutate()} disabled={pubM.isPending || (!title.trim() && !body.trim())}
          className="gbtn" style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10, padding: "11px 18px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: UI, opacity: (!title.trim() && !body.trim()) ? 0.5 : 1 }}>
          {pubM.isPending ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
          {doSms ? TT("Publish + send SMS", "פרסם + שלח SMS") : TT("Publish to home", "פרסם לעמוד הבית")}
        </button>
        {current && (
          <button onClick={() => clearM.mutate()} disabled={clearM.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", color: C.loss, border: `1px solid ${C.loss}66`, borderRadius: 10, padding: "11px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: UI }}>
            {clearM.isPending ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {TT("Take down", "הסר")}
          </button>
        )}
        {flash && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.gain, fontSize: 13, fontWeight: 700 }}><Check size={14} /> {flash}</span>}
        {(pubM.isError || clearM.isError) && <span style={{ color: C.loss, fontSize: 12.5 }}>{String(((pubM.error || clearM.error) as any)?.message || "Error")}</span>}
      </div>
    </div>
  );
}
