import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { X, Volume2, VolumeX, RotateCcw, GraduationCap, BookOpen, Sparkles, ChevronRight } from "lucide-react";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { STEPS, SECTIONS, GLOSSARY, pageExplain, type Lang } from "../lib/uni";
import { useRailHidden } from "./DemoKit";

// "Algo" — a friendly floating ALGO770 diamond mascot. Tap it and it both shows
// and speaks an explanation of the current page, plus the whole University guide.
// Bilingual (he/en) following the app language, using the Web Speech API.

const BRAND = "linear-gradient(135deg, #FBC02D 0%, #F7931A 48%, #7CC04E 100%)";

const UI = {
  he: { name: "אלגו · עוזר קולי", greet: "היי! אני אלגו 👋", thisPage: "על המסך הזה", uni: "האוניברסיטה",
    steps: "צעדים ראשונים", glossary: "מילון מונחים", tapTopic: "בחרו נושו ואקריא לו בקול:", listen: "השמע", stop: "עצור", replay: "השמע שוב",
    hint: "לחצו עליי בכל מסך לקבל הסבר", pressToLearn: "לחצו ללמוד", voice: "קול", autoVoice: "אוטומטי (גברי)", howMale: "איך לקבל קול גברי?",
    voiceHelp: "בטלפון: הגדרות ← ניהול כללי ← טקסט לדיבור (TTS) ← בחרו מנוע/קול גברי או התקינו קול נוסף. אחר כך חזרו לכאן ובחרו אותו ברשימה." },
  en: { name: "Algo · Voice helper", greet: "Hi! I'm Algo 👋", thisPage: "About this page", uni: "University",
    steps: "Getting started", glossary: "Glossary", tapTopic: "Pick a topic and I'll read it aloud:", listen: "Play", stop: "Stop", replay: "Replay",
    hint: "Tap me on any screen for an explanation", pressToLearn: "Press to learn", voice: "Voice", autoVoice: "Auto (male)", howMale: "How to get a male voice?",
    voiceHelp: "On your phone: Settings → General management → Text-to-speech (TTS) → pick a male engine/voice or install one. Then come back and select it from the list." },
};

// Prefer a natural-sounding MALE voice in the requested language.
const MALE_HINTS = ["male", " man", "daniel", "alex", "aaron", "fred", "rishi", "arthur", "oliver", "tom", "david", "mark", "george", "james", "reed", "eddy", "rocko", "diego", "jorge", "yannick", "thomas", "guy", "ravi", "lee"];
const FEMALE_HINTS = ["female", "woman", "carmit", "samantha", "victoria", "karen", "moira", "tessa", "fiona", "serena", "zira", "susan", "zoe", "ava", "allison"];

function isMaleVoice(v?: SpeechSynthesisVoice | null) {
  if (!v) return false;
  const n = ((v.name || "") + " " + ((v as any).voiceURI || "")).toLowerCase();
  return MALE_HINTS.some((h) => n.includes(h));
}

function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  try {
    const vs = window.speechSynthesis.getVoices() || [];
    const want = lang === "he" ? "he" : "en";
    let pool = vs.filter((v) => v.lang && v.lang.toLowerCase().startsWith(want));
    if (!pool.length) pool = vs.filter((v) => v.lang && v.lang.toLowerCase().includes(want));
    if (!pool.length) return null;
    const score = (v: SpeechSynthesisVoice) => {
      const n = ((v.name || "") + " " + ((v as any).voiceURI || "")).toLowerCase();
      let s = 0;
      if (MALE_HINTS.some((h) => n.includes(h))) s += 8;
      if (FEMALE_HINTS.some((h) => n.includes(h))) s -= 6;
      // Offline (local) voices honor pitch/rate — needed to deepen toward male.
      if (v.localService) s += 2;
      if (n.includes("compact")) s -= 1;
      return s;
    };
    return pool.slice().sort((a, b) => score(b) - score(a))[0] || null;
  } catch (_e) { return null; }
}

export default function Avatar() {
  const loc = useLocation();
  const { lang, rtl } = useI18n();
  const railHidden = useRailHidden();
  const t = UI[lang];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"page" | "uni">("page");
  const [topic, setTopic] = useState<string | null>(null); // section id | "steps" | "glossary"
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [, force] = useState(0);
  const mutedRef = useRef(false);
  const [voiceURI, setVoiceURI] = useState<string>(() => { try { return localStorage.getItem("algo770_voice") || ""; } catch (_e) { return ""; } });
  const voiceRef = useRef(voiceURI);
  useEffect(() => { voiceRef.current = voiceURI; }, [voiceURI]);
  const [showVoiceHelp, setShowVoiceHelp] = useState(false);

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Voices load asynchronously in some browsers.
  useEffect(() => {
    if (!supported) return;
    const onv = () => force((n) => n + 1);
    window.speechSynthesis.onvoiceschanged = onv;
    return () => { try { window.speechSynthesis.onvoiceschanged = null as any; } catch (_e) { /* */ } };
  }, [supported]);

  function stopSpeak() {
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch (_e) { /* */ }
    setSpeaking(false);
  }

  function speak(text: string) {
    if (!supported || mutedRef.current || !text) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang === "he" ? "he-IL" : "en-US";
      // Use the voice the user explicitly chose, else auto-pick a male-leaning one.
      let v: SpeechSynthesisVoice | null = null;
      if (voiceRef.current) v = (window.speechSynthesis.getVoices() || []).find((x) => x.voiceURI === voiceRef.current) || null;
      if (!v) v = pickVoice(lang);
      if (v) u.voice = v;
      // Male delivery. If we found a real male voice, use a natural pitch. Otherwise
      // the only available voice is female, so deepen the pitch hard to read as male.
      const male = isMaleVoice(v);
      u.rate = lang === "he" ? 0.92 : 0.95;
      u.pitch = male ? 0.92 : 0.52;
      u.volume = 1;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(u);
    } catch (_e) { setSpeaking(false); }
  }

  const pageText = pageExplain(loc.pathname, lang);

  function topicText(id: string): string {
    if (id === "steps") return `${t.steps}. ` + STEPS[lang].join(" ");
    if (id === "glossary") return `${t.glossary}. ` + GLOSSARY.map((g) => `${g.term[lang]}: ${g.def[lang]}`).join(" ");
    const s = SECTIONS.find((x) => x.id === id);
    return s ? `${s.title[lang]}. ` + s.body[lang].join(" ") : "";
  }

  function openHelper() {
    setOpen(true);
    setView("page");
    setTopic(null);
    if (!muted) setTimeout(() => speak(pageText), 120);
  }
  function closeHelper() { stopSpeak(); setOpen(false); }

  function selectTopic(id: string) {
    setTopic(id);
    speak(topicText(id));
  }

  // Stop talking if the user navigates away.
  useEffect(() => { if (open) { setView("page"); setTopic(null); stopSpeak(); } /* eslint-disable-next-line */ }, [loc.pathname]);

  // Helper panel opens on the same (inline-start) side as the Learn tab.
  const side = rtl ? { right: 18 } : { left: 18 };

  return (
    <>
      <style>{`
        @keyframes algoBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes algoRing{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.7);opacity:0}}
        @keyframes algoIn{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
        @keyframes algoTalk{0%,100%{transform:scaleY(0.32)}50%{transform:scaleY(1)}}
      `}</style>

      {/* Edge tab — docked on the inline-start edge (opposite the Activity/Profit
          drawers) so it never floats over page buttons/text. Opens the voice helper. */}
      {!open && !railHidden && (
        <button onClick={openHelper} aria-label={t.name} title={t.hint}
          style={{ position: "fixed", insetInlineStart: 0, bottom: 120, zIndex: 60, display: "flex", alignItems: "center", gap: 6,
            background: "var(--btn-bg)", color: "var(--btn-ink)", border: "none", cursor: "pointer", padding: "10px 8px",
            borderStartEndRadius: 10, borderEndEndRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
            writingMode: "vertical-rl" } as React.CSSProperties}>
          <GraduationCap size={15} /> <span style={{ fontSize: 12, fontWeight: 800 }}>{lang === "he" ? "למידה" : "Learn"}</span>
        </button>
      )}

      {/* Helper panel */}
      {open && (
        <div style={{ position: "fixed", bottom: 20, ...side, zIndex: 9998, width: "min(360px, calc(100vw - 28px))",
          background: "linear-gradient(170deg,#15101f 0%,#0B0613 100%)", border: `1px solid ${C.line}`, borderRadius: 18,
          boxShadow: "0 22px 60px rgba(0,0,0,0.55)", animation: "algoIn .22s ease", direction: rtl ? "rtl" : "ltr",
          overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(560px, calc(100vh - 40px))" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
            <Face size={38} speaking={speaking} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>{t.greet}</div>
              <div style={{ fontSize: 11, color: C.gold }}>{t.name}</div>
            </div>
            {supported && (
              <button onClick={() => { const m = !muted; setMuted(m); if (m) stopSpeak(); }} title={muted ? t.listen : t.stop}
                style={iconBtn}>{muted ? <VolumeX size={15} color={C.muted} /> : <Volume2 size={15} color={C.gold} />}</button>
            )}
            <button onClick={closeHelper} aria-label="close" style={iconBtn}><X size={15} color={C.muted} /></button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, padding: "10px 12px 0" }}>
            <Tab active={view === "page"} onClick={() => { setView("page"); setTopic(null); }} icon={<Sparkles size={13} />} label={t.thisPage} />
            <Tab active={view === "uni"} onClick={() => { setView("uni"); setTopic(null); }} icon={<GraduationCap size={13} />} label={t.uni} />
          </div>

          {/* Voice picker */}
          {supported && (
            <div style={{ padding: "8px 12px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Volume2 size={13} color={C.muted} style={{ flexShrink: 0 }} />
                <select value={voiceURI} onChange={(e) => { setVoiceURI(e.target.value); try { localStorage.setItem("algo770_voice", e.target.value); } catch (_e) { /* */ } stopSpeak(); }}
                  style={{ flex: 1, minWidth: 0, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "6px 8px", fontSize: 12, fontFamily: "inherit" }}>
                  <option value="">{t.autoVoice}</option>
                  {(window.speechSynthesis.getVoices() || [])
                    .filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang === "he" ? "he" : "en"))
                    .map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}{isMaleVoice(v) ? " ♂" : ""}</option>)}
                </select>
                <button onClick={() => setShowVoiceHelp((s) => !s)} title={t.howMale} style={iconBtn}><span style={{ fontSize: 13, color: C.gold, fontWeight: 800 }}>?</span></button>
              </div>
              {showVoiceHelp && <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.55, marginTop: 7, background: C.surface2, borderRadius: 8, padding: "8px 10px" }}>{t.voiceHelp}</div>}
            </div>
          )}

          {/* Body */}
          <div style={{ padding: "12px 14px 16px", overflowY: "auto" }}>
            {view === "page" && (
              <div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: "#d4dbe6" }}>{pageText}</p>
                {supported && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button onClick={() => (speaking ? stopSpeak() : speak(pageText))} style={playBtn}>
                      {speaking ? <><VolumeX size={14} /> {t.stop}</> : <><RotateCcw size={14} /> {t.replay}</>}
                    </button>
                  </div>
                )}
              </div>
            )}

            {view === "uni" && (
              <div>
                {!topic && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{t.tapTopic}</div>}
                {topic ? (
                  <div>
                    <button onClick={() => { setTopic(null); stopSpeak(); }} style={{ ...iconRow, marginBottom: 10, color: C.gold }}>
                      <ChevronRight size={14} style={{ transform: rtl ? "none" : "rotate(180deg)" }} /> {t.uni}
                    </button>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{topicTitle(topic, lang, t)}</div>
                    {topicParas(topic, lang).map((p, i) => (
                      <p key={i} style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.6, color: "#cbd5e1" }}>{p}</p>
                    ))}
                    {supported && (
                      <button onClick={() => (speaking ? stopSpeak() : speak(topicText(topic))) } style={{ ...playBtn, marginTop: 4 }}>
                        {speaking ? <><VolumeX size={14} /> {t.stop}</> : <><Volume2 size={14} /> {t.listen}</>}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <TopicRow onClick={() => selectTopic("steps")} icon={<Sparkles size={15} color={C.gold} />} label={t.steps} rtl={rtl} />
                    {SECTIONS.map((s) => (
                      <TopicRow key={s.id} onClick={() => selectTopic(s.id)} icon={<s.Icon size={15} color={C.gold} />} label={s.title[lang]} rtl={rtl} />
                    ))}
                    <TopicRow onClick={() => selectTopic("glossary")} icon={<BookOpen size={15} color={C.gold} />} label={t.glossary} rtl={rtl} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function topicTitle(id: string, lang: Lang, t: typeof UI["en"]): string {
  if (id === "steps") return t.steps;
  if (id === "glossary") return t.glossary;
  return SECTIONS.find((s) => s.id === id)?.title[lang] || "";
}
function topicParas(id: string, lang: Lang): string[] {
  if (id === "steps") return STEPS[lang].map((s, i) => `${i + 1}. ${s}`);
  if (id === "glossary") return GLOSSARY.map((g) => `${g.term[lang]} — ${g.def[lang]}`);
  return SECTIONS.find((s) => s.id === id)?.body[lang] || [];
}

function Face({ size, speaking }: { size: number; speaking?: boolean }) {
  // A friendly Bitcoin-style coin mascot: gold coin, the ₿ symbol, eyes + smile.
  const s = size;
  return (
    <span style={{ position: "relative", width: s, height: s, borderRadius: "50%", display: "inline-flex", flexShrink: 0,
      alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#FBC02D 0%,#F7931A 55%,#E07B0E 100%)",
      boxShadow: "0 8px 22px rgba(247,147,26,0.5)", border: "2px solid rgba(255,255,255,0.25)" }}>
      <svg viewBox="0 0 100 100" width={s * 0.92} height={s * 0.92} aria-hidden>
        {/* coin ridged rim */}
        <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(11,6,19,0.28)" strokeWidth="3" strokeDasharray="2.4 3.2" />
        <circle cx="50" cy="50" r="38" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.6" />
        {/* Bitcoin ₿ body */}
        <text x="50" y="66" textAnchor="middle" fontSize="46" fontWeight="900" fill="#0B0613"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>₿</text>
        {/* friendly eyes */}
        <circle cx="38" cy="34" r="4.6" fill="#0B0613" />
        <circle cx="62" cy="34" r="4.6" fill="#0B0613" />
        <circle cx="39.4" cy="32.6" r="1.5" fill="#fff" />
        <circle cx="63.4" cy="32.6" r="1.5" fill="#fff" />
        {/* idle smile (the talking mouth is an HTML overlay below for reliability) */}
        {!speaking && <path d="M37 81 Q50 88 63 81" fill="none" stroke="#0B0613" strokeWidth="3.2" strokeLinecap="round" />}
      </svg>
      {/* Talking mouth — HTML overlay that opens/closes; rock-solid across browsers */}
      {speaking && (
        <span style={{ position: "absolute", left: "50%", top: "78%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
          <span style={{ display: "block", width: s * 0.3, height: s * 0.2, background: "#0B0613", borderRadius: "0 0 999px 999px / 0 0 60% 60%",
            transformOrigin: "center top", animation: "algoTalk 0.22s ease-in-out infinite" }}>
            <span style={{ display: "block", width: "46%", height: "34%", margin: "8% auto 0", background: "#E0556B", borderRadius: "999px" }} />
          </span>
        </span>
      )}
    </span>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer",
      background: active ? "rgba(247,147,26,0.14)" : "transparent", border: `1px solid ${active ? C.goldDim : C.line}`,
      color: active ? C.gold : C.muted, borderRadius: 9, padding: "7px 8px", fontSize: 12.5, fontWeight: 600,
    }}>{icon} {label}</button>
  );
}

function TopicRow({ onClick, icon, label, rtl }: { onClick: () => void; icon: React.ReactNode; label: string; rtl: boolean }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: rtl ? "right" : "left", cursor: "pointer",
      background: C.surface, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 13,
    }}>
      <span style={{ flexShrink: 0, display: "inline-flex" }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      <ChevronRight size={15} color={C.muted} style={{ transform: rtl ? "rotate(180deg)" : "none" }} />
    </button>
  );
}

const iconBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: "none", border: `1px solid ${C.line}`, cursor: "pointer", flexShrink: 0 };
const iconRow: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0 };
const playBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(247,147,26,0.14)", border: `1px solid ${C.goldDim}`, color: C.gold, borderRadius: 9, padding: "8px 13px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
