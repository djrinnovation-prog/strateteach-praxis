import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, ChevronUp, ChevronDown, Heart, MessageCircle, Share2, Home as HomeIcon, Lock, Crown, Settings, Plus, Trash2, X, Eye, EyeOff, Film, Diamond } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { type Lang } from "../lib/uni";
import { useEntitlements } from "../lib/entitlements";
import { api, isContentEditor } from "../app/api";
import type { ReelsLesson, ReelsLessonInput } from "../lib/client";
import { C, SHADOW, onAccent } from "../theme";
import { premSoft, ctrlChip } from "../ui";
import TourLauncher from "../components/TourLauncher";
import FramedTitle from "../components/FramedTitle";

// How many clips play free as a preview; the rest unlock with Pro.
const FREE_CLIPS = 3;

// ── Video POSTER (the reliable iOS fix) ───────────────────────────────────────
// iOS Safari renders a <video> BLACK at rest — it won't decode/paint a frame
// without a real user gesture, even with preload=metadata + a seek (that only
// works on desktop). A real `poster` <img> is the one thing iOS shows reliably.
// Known static /media clips get their extracted first frame; everything else
// (base64 / hosted, no matching static poster) falls back to a branded dark
// placeholder so it's NEVER a bare black rectangle. Owners can add real per-lesson
// posters later via an additive poster_url column.
const DEFAULT_VIDEO_POSTER = "/media/default-video-poster.jpg";
const STATIC_POSTERS: Record<string, string> = {
  "770-home-reel.mp4": "/media/770-home-reel-poster.jpg",
};
function posterFor(videoUrl?: string | null): string {
  if (videoUrl) {
    for (const name in STATIC_POSTERS) {
      if (videoUrl.includes(name)) return STATIC_POSTERS[name];
    }
  }
  return DEFAULT_VIDEO_POSTER;
}

// ── Reels: a YouTube-Shorts-style vertical player. Two animated podcast hosts —
// Daniel (the expert) and Yuval (the skeptic) — sit in a neon crypto trading room
// and talk through the course, ~5s per clip, with text-to-speech + captions. ────

type Who = "daniel" | "yuval";
const HOST: Record<Who, { name: Record<Lang, string>; role: Record<Lang, string>; pitch: number; accent: string }> = {
  daniel: { name: { he: "דניאל", en: "Daniel" }, role: { he: "המומחה", en: "The Expert" }, pitch: 0.8, accent: "#36C5F0" },
  yuval: { name: { he: "יובל", en: "Yuval" }, role: { he: "הסקפטי", en: "The Skeptic" }, pitch: 1.04, accent: "#F7931A" },
};

const SCENE_TITLE: Record<Lang, string[]> = {
  he: ["הפתיחה", "מה זה קריפטו", "אלגוטרייד ואסטרטגיה", "פחדים מול מציאות", "מבט קדימה"],
  en: ["The intro", "What is crypto", "Algo-trading & strategy", "Fears vs reality", "Looking ahead"],
};

type Clip = { scene: number; who: Who; he: string; en: string };
const REELS: Clip[] = [
  { scene: 0, who: "daniel", he: "ברוכים הבאים לפודקאסט הקריפטו שלנו — לא ניחושים, אלא טכנולוגיה ואסטרטגיה.", en: "Welcome to our crypto podcast — not guesses, but technology and strategy." },
  { scene: 0, who: "yuval", he: "כל פעם שאני נכנס למסחר אני בסוף מוכר בהפסד. זה מרגיש כמו קזינו.", en: "Every time I trade I end up selling at a loss. It feels like a casino." },
  { scene: 0, who: "yuval", he: "קריפטו זה רכבת הרים. צריך להיות גאון מחשבים כדי להצליח בזה?", en: "Crypto is a rollercoaster. Do you need to be a computer genius to win?" },

  { scene: 1, who: "daniel", he: "קריפטו הוא לא 'כסף באוויר'. הוא בנוי על בלוקצ'יין — יומן דיגיטלי שאי אפשר לזייף.", en: "Crypto isn't 'money in the air'. It's built on blockchain — a digital ledger you can't fake." },
  { scene: 1, who: "daniel", he: "המסחר קורה 24/7 — וזה בדיוק מה שהופך אותו למגרש המשחקים המושלם למכונות.", en: "Trading runs 24/7 — exactly what makes it the perfect playground for machines." },
  { scene: 1, who: "yuval", he: "מטבעות קופצים בעשרות אחוזים בזמן שאני במקלחת. איך עוקבים בלי התקף לב?", en: "Coins jump tens of percent while I'm in the shower. How do you keep up without a heart attack?" },

  { scene: 2, who: "daniel", he: "התנודתיות היא האויב של הסוחר האנושי — אבל היא הדלק של הבוט.", en: "Volatility is the human trader's enemy — but it's the bot's fuel." },
  { scene: 2, who: "daniel", he: "בוט לא מתרגש, לא ישן, ולא עושה פאניק. הוא עובד לפי מתמטיקה טהורה.", en: "A bot has no emotion, never sleeps, never panics. It runs on pure math." },
  { scene: 2, who: "daniel", he: "אם הביטקוין עלה 2% ב-5 דקות והנפח גדל — הבוט פותח עסקה בשבריר שנייה.", en: "If Bitcoin rises 2% in 5 minutes with rising volume — the bot opens a trade in a split second." },

  { scene: 3, who: "yuval", he: "אבל אם השוק מתרסק? הבוט פשוט ימשיך לקנות עד שהחשבון מתאפס?", en: "But if the market crashes? Does the bot just keep buying until the account hits zero?" },
  { scene: 3, who: "daniel", he: "בוט הוא חייל — הוא עושה רק מה שפקדת. לכן אנחנו מלמדים לבנות ולבחון אסטרטגיה.", en: "A bot is a soldier — it only does what you command. So we teach you to build and test the strategy." },
  { scene: 3, who: "daniel", he: "עושים Backtesting — מריצים על 7–8 שנות נתונים לפני שמשקיעים דולר אחד אמיתי.", en: "We backtest — running 7–8 years of data before risking a single real dollar." },

  { scene: 4, who: "yuval", he: "אז זה לא כפתור קסם — אלא כלי עבודה רציני שצריך לדעת לבנות ולתפעל.", en: "So it's not a magic button — it's a serious tool you must learn to build and run." },
  { scene: 4, who: "daniel", he: "בדיוק. בפרקים הבאים: הקוד שמאחורי הבוטים, חיבור לבורסות, וניהול סיכונים.", en: "Exactly. Next up: the code behind the bots, connecting to exchanges, and managing risk." },
  { scene: 4, who: "daniel", he: "אז תחגרו חגורות...", en: "So buckle up..." },
];

function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  try {
    const vs = window.speechSynthesis.getVoices() || [];
    const want = lang === "he" ? "he" : "en";
    let pool = vs.filter((v) => v.lang && v.lang.toLowerCase().startsWith(want));
    if (!pool.length) pool = vs;
    const male = /(male|daniel|alex|fred|david|rishi|tom|george|diego| man)/i;
    return pool.find((v) => male.test(v.name)) || pool.find((v) => v.localService) || pool[0] || null;
  } catch (_e) { return null; }
}

// ── The neon trading-room stage with both seated, talking hosts. ───────────────
function Stage({ speaking }: { speaking: Who }) {
  return (
    <svg viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden>
      <defs>
        <linearGradient id="rk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#141033" /><stop offset="55%" stopColor="#0c0a1e" /><stop offset="100%" stopColor="#06040f" /></linearGradient>
        <radialGradient id="rglowB" cx="50%" cy="22%" r="60%"><stop offset="0%" stopColor="rgba(54,150,240,0.35)" /><stop offset="100%" stopColor="rgba(54,150,240,0)" /></radialGradient>
        <radialGradient id="rglowP" cx="78%" cy="40%" r="55%"><stop offset="0%" stopColor="rgba(160,80,240,0.28)" /><stop offset="100%" stopColor="rgba(160,80,240,0)" /></radialGradient>
        <linearGradient id="rdesk" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#241c44" /><stop offset="100%" stopColor="#120d28" /></linearGradient>
      </defs>
      <rect x="0" y="0" width="360" height="640" fill="url(#rk)" />
      <rect x="0" y="0" width="360" height="640" fill="url(#rglowB)" />
      <rect x="0" y="0" width="360" height="640" fill="url(#rglowP)" />

      {/* back wall — chart monitors */}
      {[{ x: 26, c: "#3FE0A0" }, { x: 138, c: "#36C5F0" }, { x: 250, c: "#F7931A" }].map((m, i) => (
        <g key={i}>
          <rect x={m.x} y={70} width={84} height={56} rx={6} fill="#0e1230" stroke="rgba(255,255,255,0.08)" />
          <polyline points={`${m.x + 6},112 ${m.x + 20},98 ${m.x + 32},104 ${m.x + 46},84 ${m.x + 60},92 ${m.x + 78},78`} fill="none" stroke={m.c} strokeWidth="2" opacity="0.9" />
          <line x1={m.x + 6} y1={120} x2={m.x + 78} y2={120} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        </g>
      ))}
      <text x="180" y="50" textAnchor="middle" fill={`${C.gold}80`} fontSize="20" fontWeight="800" fontFamily="monospace">₿  Ξ  ◎  $</text>

      {/* desk */}
      <rect x="-10" y="486" width="380" height="170" rx="18" fill="url(#rdesk)" stroke="rgba(120,90,200,0.35)" />
      <rect x="-10" y="486" width="380" height="4" fill="rgba(120,160,255,0.5)" />

      <Host cx={108} kind="daniel" speaking={speaking === "daniel"} />
      <Host cx={252} kind="yuval" speaking={speaking === "yuval"} />

      {/* mics */}
      <Mic cx={150} /><Mic cx={300} />
    </svg>
  );
}

function Mic({ cx }: { cx: number }) {
  return (
    <g>
      <rect x={cx - 6} y={470} width={12} height={26} rx={6} fill="#0c0a1e" stroke="rgba(255,255,255,0.25)" />
      <ellipse cx={cx} cy={470} rx={9} ry={13} fill="#1a1730" stroke="rgba(255,255,255,0.3)" />
      <line x1={cx} y1={496} x2={cx} y2={520} stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
    </g>
  );
}

function Host({ cx, kind, speaking }: { cx: number; kind: Who; speaking: boolean }) {
  const expert = kind === "daniel";
  const skin = expert ? "#e7b78d" : "#e0a877";
  const accent = HOST[kind].accent;
  const headY = 300;
  return (
    <g style={{ transformBox: "fill-box", transformOrigin: "center", transform: speaking ? "translateY(-4px)" : "none", transition: "transform .25s", opacity: speaking ? 1 : 0.5 } as any}>
      {/* speaker glow */}
      {speaking && <ellipse cx={cx} cy={headY + 30} rx={70} ry={95} fill={accent} opacity={0.16} />}
      {/* chair */}
      <rect x={cx - 52} y={headY + 30} width={104} height={150} rx={26} fill="#181430" stroke="rgba(255,255,255,0.06)" />
      {/* torso / clothes */}
      <path d={`M${cx - 46} ${headY + 170} Q${cx - 46} ${headY + 78} ${cx} ${headY + 70} Q${cx + 46} ${headY + 78} ${cx + 46} ${headY + 170} Z`} fill={expert ? "#1d2a4a" : "#3a3358"} />
      {expert ? (
        <>
          <path d={`M${cx - 16} ${headY + 80} L${cx} ${headY + 120} L${cx + 16} ${headY + 80} Z`} fill="#f2f4f8" />
          <path d={`M${cx - 6} ${headY + 92} L${cx} ${headY + 134} L${cx + 6} ${headY + 92} Z`} fill={accent} />
        </>
      ) : (
        <path d={`M${cx - 18} ${headY + 82} Q${cx} ${headY + 96} ${cx + 18} ${headY + 82} L${cx + 14} ${headY + 110} L${cx - 14} ${headY + 110} Z`} fill="#2a2542" />
      )}
      {/* neck + head */}
      <rect x={cx - 11} y={headY + 44} width={22} height={26} rx={9} fill={skin} />
      <ellipse cx={cx} cy={headY} rx={34} ry={39} fill={skin} />
      <ellipse cx={cx - 34} cy={headY + 4} rx={5} ry={8} fill={skin} />
      <ellipse cx={cx + 34} cy={headY + 4} rx={5} ry={8} fill={skin} />
      {/* hair / cap */}
      {expert ? (
        <path d={`M${cx - 35} ${headY - 8} Q${cx - 30} ${headY - 44} ${cx} ${headY - 42} Q${cx + 30} ${headY - 44} ${cx + 35} ${headY - 8} Q${cx + 20} ${headY - 24} ${cx} ${headY - 22} Q${cx - 20} ${headY - 24} ${cx - 35} ${headY - 8} Z`} fill="#241f2b" />
      ) : (
        <>
          <path d={`M${cx - 34} ${headY + 2} Q${cx - 30} ${headY - 20} ${cx} ${headY - 18} Q${cx + 30} ${headY - 20} ${cx + 34} ${headY + 2} L${cx + 30} ${headY + 6} Q${cx} ${headY - 6} ${cx - 30} ${headY + 6} Z`} fill="#3a2c1f" />
          <path d={`M${cx - 38} ${headY - 14} Q${cx} ${headY - 50} ${cx + 38} ${headY - 14} Q${cx + 20} ${headY - 22} ${cx} ${headY - 22} Q${cx - 20} ${headY - 22} ${cx - 38} ${headY - 14} Z`} fill={accent} />
          <path d={`M${cx - 6} ${headY - 16} Q${cx + 30} ${headY - 22} ${cx + 44} ${headY - 8} Q${cx + 30} ${headY - 14} ${cx - 6} ${headY - 12} Z`} fill="#d9821a" />
        </>
      )}
      {/* eyebrows (skeptic raised on one side) */}
      {expert ? (
        <>
          <line x1={cx - 22} y1={headY - 8} x2={cx - 8} y2={headY - 9} stroke="#241f2b" strokeWidth="3" strokeLinecap="round" />
          <line x1={cx + 8} y1={headY - 9} x2={cx + 22} y2={headY - 8} stroke="#241f2b" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <line x1={cx - 22} y1={headY - 10} x2={cx - 8} y2={headY - 6} stroke="#3a2c1f" strokeWidth="3" strokeLinecap="round" />
          <line x1={cx + 8} y1={headY - 8} x2={cx + 22} y2={headY - 8} stroke="#3a2c1f" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {/* eyes (blink) */}
      <g className="reEyes" style={{ transformBox: "fill-box", transformOrigin: "center" } as any}>
        <ellipse cx={cx - 14} cy={headY + 2} rx={6} ry={5} fill="#fff" />
        <ellipse cx={cx + 14} cy={headY + 2} rx={6} ry={5} fill="#fff" />
        <circle cx={cx - 13} cy={headY + 3} r={2.6} fill="#1a1320" />
        <circle cx={cx + 15} cy={headY + 3} r={2.6} fill="#1a1320" />
      </g>
      {/* nose */}
      <path d={`M${cx} ${headY + 4} L${cx - 4} ${headY + 14} L${cx + 3} ${headY + 14}`} fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {/* mouth */}
      {speaking ? (
        <ellipse className="reMouth" cx={cx} cy={headY + 24} rx={9} ry={6} fill="#5a2230"
          style={{ transformBox: "fill-box", transformOrigin: "center" } as any} />
      ) : (
        <path d={expert ? `M${cx - 9} ${headY + 23} Q${cx} ${headY + 29} ${cx + 9} ${headY + 23}` : `M${cx - 9} ${headY + 25} Q${cx} ${headY + 21} ${cx + 9} ${headY + 25}`}
          fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="2.6" strokeLinecap="round" />
      )}
    </g>
  );
}

function PodcastDemo() {
  const { lang, rtl } = useI18n();
  const mobile = useIsMobile();
  const nav = useNavigate();
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [liked, setLiked] = useState<Record<number, boolean>>({});
  const [noVid, setNoVid] = useState<Record<number, boolean>>({});
  const [prog, setProg] = useState(0);
  const [, force] = useState(0);
  const [paywall, setPaywall] = useState(false);
  const vidRef = useRef<HTMLVideoElement | null>(null);

  // Free preview vs paid: Pro/admin watch everything; others get FREE_CLIPS, then a paywall.
  const ent = useEntitlements().data;
  const unlocked = !!ent && (ent.isAdmin || ent.plan === "pro");
  const unlockedRef = useRef(unlocked);
  useEffect(() => { unlockedRef.current = unlocked; }, [unlocked]);
  // If they upgraded, drop the paywall.
  useEffect(() => { if (unlocked) setPaywall(false); }, [unlocked]);

  // HeyGen clips drop in as /reels/reel-01.mp4 … reel-15.mp4. If a clip's file is
  // missing, we gracefully fall back to the animated stage + voice for that line.
  const VID = (i: number) => `/reels/reel-${String(i + 1).padStart(2, "0")}.mp4`;

  const idxRef = useRef(0); const playRef = useRef(true); const mutedRef = useRef(false);
  useEffect(() => { idxRef.current = idx; }, [idx]);
  useEffect(() => { playRef.current = playing; }, [playing]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => { if (supported) window.speechSynthesis.onvoiceschanged = () => force((n) => n + 1); }, [supported]);

  const clip = REELS[idx];
  const text = clip[lang];
  const hasVid = !noVid[idx];
  const dur = useMemo(() => Math.min(7000, Math.max(3800, 1400 + text.length * 55)), [text]);

  const gateOk = (target: number) => unlockedRef.current || target < FREE_CLIPS;
  const go = (d: number) => {
    const t = idxRef.current + d;
    if (d > 0 && !gateOk(t)) { setPlaying(false); setPaywall(true); return; }
    setIdx((i) => (i + d + REELS.length) % REELS.length);
  };
  const autoNext = () => {
    const t = idxRef.current + 1;
    if (!gateOk(t)) { setPlaying(false); setPaywall(true); return; }
    setIdx((i) => (i + 1) % REELS.length);
  };

  function stop() { try { window.speechSynthesis.cancel(); } catch (_e) { /* */ } }

  // reset progress on clip change; keep the <video> in sync with play/pause + mute
  useEffect(() => { setProg(0); }, [idx]);
  useEffect(() => {
    const v = vidRef.current; if (!v) return;
    if (playing) v.play().catch(() => { }); else v.pause();
  }, [playing, idx, hasVid]);

  // voice/timer narration — only when this clip has NO real video (videos carry their own audio)
  useEffect(() => {
    if (!playing || hasVid) return;
    let cancelled = false;
    const advance = () => {
      if (cancelled || !playRef.current) return;
      const t = idxRef.current + 1;
      if (!gateOk(t)) { setPlaying(false); setPaywall(true); return; }
      setIdx((i) => (i + 1) % REELS.length);
    };
    if (supported && !mutedRef.current) {
      try {
        const synth = window.speechSynthesis; synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === "he" ? "he-IL" : "en-US";
        const v = pickVoice(lang); if (v) u.voice = v;
        u.pitch = HOST[clip.who].pitch; u.rate = lang === "he" ? 0.97 : 1.0;
        u.onend = advance; u.onerror = advance;
        synth.speak(u);
        const guard = setTimeout(advance, dur + 4000);
        return () => { cancelled = true; clearTimeout(guard); stop(); };
      } catch (_e) { /* fall through */ }
    }
    const id = setTimeout(advance, dur);
    return () => { cancelled = true; clearTimeout(id); };
  }, [idx, playing, muted, lang, supported, hasVid]); // eslint-disable-line

  const frameW = mobile ? "100%" : "min(92vw, 1040px)";
  const frameH = mobile ? "calc(100vh - 90px)" : "min(82vh, 720px)";

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: mobile ? 0 : 8 }}>
      <style>{`
        @keyframes reTalk{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
        @keyframes reBlink{0%,93%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
        @keyframes reFill{from{width:0%}to{width:100%}}
        .reMouth{animation:reTalk .22s ease-in-out infinite}
        .reEyes{animation:reBlink 4.2s ease-in-out infinite}
      `}</style>

      <div style={{ position: "relative", width: frameW, aspectRatio: "16 / 9", maxWidth: 1040, borderRadius: mobile ? 0 : 16, overflow: "hidden",
        background: "#06040f", boxShadow: mobile ? "none" : "0 26px 70px rgba(0,0,0,0.6)", direction: rtl ? "rtl" : "ltr",
        border: mobile ? "none" : "1px solid rgba(120,90,200,0.3)" }}>

        {hasVid ? (
          <video ref={vidRef} key={idx} src={VID(idx)} autoPlay playsInline muted={muted}
            onError={() => setNoVid((v) => ({ ...v, [idx]: true }))}
            onEnded={() => { if (playRef.current) autoNext(); }}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProg(v.currentTime / v.duration); }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Stage speaking={clip.who} />
        )}

        {/* top segmented progress */}
        <div style={{ position: "absolute", top: 10, left: 12, right: 12, display: "flex", gap: 4, zIndex: 5 }}>
          {REELS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 3, background: "rgba(255,255,255,0.25)", overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#fff",
                width: i < idx ? "100%" : i === idx ? (hasVid ? `${prog * 100}%` : "0%") : "0%",
                animation: i === idx && playing && !hasVid ? `reFill ${dur}ms linear forwards` : "none" }} />
            </div>
          ))}
        </div>

        {/* scene chip + exit */}
        <div style={{ position: "absolute", top: 24, left: 12, right: 12, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 999, padding: "5px 11px", backdropFilter: "blur(4px)" }}>
            {lang === "he" ? "סצנה" : "Scene"} {clip.scene + 1} · {SCENE_TITLE[lang][clip.scene]}
          </span>
          <button onClick={() => nav("/")} aria-label="home" style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,0.45)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HomeIcon size={15} />
          </button>
        </div>

        {/* tap layer for play/pause */}
        <div onClick={() => setPlaying((p) => { if (p) stop(); return !p; })} style={{ position: "absolute", inset: 0, zIndex: 2, cursor: "pointer" }} />

        {!playing && (
          <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ width: 70, height: 70, borderRadius: "50%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Play size={30} color="#fff" fill="#fff" />
            </span>
          </div>
        )}

        {/* right action rail */}
        <div style={{ position: "absolute", insetInlineEnd: 10, bottom: 150, zIndex: 6, display: "flex", flexDirection: "column", gap: 18, alignItems: "center" }}>
          <Rail Icon={Heart} active={liked[idx]} color={liked[idx] ? "#ff4d6d" : "#fff"} label={(120 + idx * 7).toString()} onClick={() => setLiked((l) => ({ ...l, [idx]: !l[idx] }))} />
          <Rail Icon={MessageCircle} color="#fff" label={(8 + idx).toString()} onClick={() => { }} />
          <Rail Icon={Share2} color="#fff" label={lang === "he" ? "שתף" : "Share"} onClick={() => { }} />
          <Rail Icon={muted ? VolumeX : Volume2} color={muted ? C.faint : C.gold} onClick={() => setMuted((m) => { if (!m) stop(); return !m; })} />
        </div>

        {/* caption / speaker */}
        <div style={{ position: "absolute", insetInline: 0, bottom: 0, zIndex: 5, padding: "60px 16px 18px", insetInlineEnd: 66,
          background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.72))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", background: HOST[clip.who].accent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: onAccent(HOST[clip.who].accent), fontSize: 14 }}>
              {HOST[clip.who].name[lang][0]}
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{HOST[clip.who].name[lang]}</span>
            <span style={{ fontSize: 11, color: HOST[clip.who].accent, fontWeight: 700 }}>· {HOST[clip.who].role[lang]}</span>
          </div>
          <div style={{ fontSize: mobile ? 17 : 18, lineHeight: 1.45, color: "#fff", fontWeight: 600, textShadow: "0 1px 6px rgba(0,0,0,0.6)" }}>{text}</div>
        </div>

        {/* up / down nav */}
        <div style={{ position: "absolute", insetInlineEnd: 12, top: "42%", zIndex: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => { stop(); go(-1); }} aria-label="prev" style={navBtn}><ChevronUp size={18} /></button>
          <button onClick={() => { stop(); go(1); }} aria-label="next" style={navBtn}><ChevronDown size={18} /></button>
        </div>

        {/* free-preview badge for non-unlocked viewers */}
        {!unlocked && !paywall && (
          <div style={{ position: "absolute", top: 52, insetInlineStart: 12, zIndex: 6, display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 10.5, fontWeight: 800, color: onAccent(C.gold), background: C.accentGrad, borderRadius: 999, padding: "3px 9px" }}>
            {lang === "he" ? `תצוגה חינם · ${idx + 1}/${FREE_CLIPS}` : `Free preview · ${idx + 1}/${FREE_CLIPS}`}
          </div>
        )}

        {/* paywall — shown after the free preview for non-Pro viewers */}
        {paywall && !unlocked && (
          <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            textAlign: "center", padding: 28, background: "rgba(6,4,15,0.92)", backdropFilter: "blur(6px)" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: `${C.gold}26`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
              <Lock size={28} color={C.gold} />
            </span>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", marginBottom: 6 }}>
              {lang === "he" ? "סיימתם את התצוגה החינמית" : "That's the free preview"}
            </div>
            <div style={{ fontSize: 13.5, color: "#a9b2c0", maxWidth: 300, lineHeight: 1.5, marginBottom: 20 }}>
              {lang === "he" ? "פתחו את הקורס המלא וכל שיעורי ההמשך עם Pro." : "Unlock the full course and every follow-up lesson with Pro."}
            </div>
            <button onClick={() => nav("/plans")} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
              background: C.accentGrad, color: onAccent(C.gold), fontWeight: 800, fontSize: 14.5, borderRadius: 12, padding: "12px 26px" }}>
              <Crown size={16} /> {lang === "he" ? "פתחו עם Pro · $99.99/חודש" : "Unlock with Pro · $99.99/mo"}
            </button>
            <button onClick={() => { setPaywall(false); setIdx(0); setPlaying(true); }} style={{ marginTop: 14, background: "none", border: "none", color: "#9aa0a8", fontSize: 12.5, cursor: "pointer" }}>
              {lang === "he" ? "צפו שוב בתצוגה החינמית" : "Replay free preview"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Rail({ Icon, label, color, active, onClick }: { Icon: any; label?: string; color: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: "#fff" }}>
      <span style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.46)", border: "1.5px solid rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.26), 0 8px 18px -10px rgba(0,0,0,0.6)" }}>
        <Icon size={22} color={color} fill={active ? color : "none"} />
      </span>
      {label && <span style={{ fontSize: 10.5, fontWeight: 700 }}>{label}</span>}
    </button>
  );
}

// Player nav controls — premium finish tuned for the dark cinematic frame: a deeper
// translucent fill, a clearer rim, an inner top-highlight + soft drop shadow so the
// chevrons read as their own pressable premium chips (the Home depth language, kept
// dark so it never washes out over the video).
const navBtn: React.CSSProperties = { width: 36, height: 36, borderRadius: "50%", background: "rgba(0,0,0,0.46)", border: "1.5px solid rgba(255,255,255,0.26)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 8px 18px -10px rgba(0,0,0,0.6)" };

// ── Reels v2 ────────────────────────────────────────────────────────────────
// When the admin has published real lessons, they play here as a vertical video
// feed: each lesson plays a short free preview, then the Pro paywall (same gate
// pattern as the demo). With no lessons yet we fall back to the podcast demo so
// the screen is never empty. Admins get an in-screen "Manage lessons" panel.

function LessonsFeed({ lessons, unlocked, lang, rtl, mobile }: {
  lessons: ReelsLesson[]; unlocked: boolean; lang: Lang; rtl: boolean; mobile: boolean;
}) {
  // ── TikTok-style vertical feed of the managed reels_lessons. Full-screen PORTRAIT
  // slides, scroll-snap up/down between lessons; the in-view slide AUTOPLAYS muted
  // (IntersectionObserver), out-of-view pauses; tap to play/pause; a global mute
  // toggle. Bilingual RTL caption overlay; a real poster (posterFor) so iOS never
  // shows a black frame; per-lesson free-preview → Pro paywall. Sized by aspect-ratio
  // (9:16) — NO vh/svh, no fixed box, so the shell height chain + TabBar stay intact. ──
  const nav = useNavigate();
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);                       // TikTok: autoplay MUTED
  const [paused, setPaused] = useState<Record<number, boolean>>({});
  const [paywall, setPaywall] = useState<Record<number, boolean>>({});
  const [prog, setProg] = useState(0);
  const reduce = useMemo(() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  }, []);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  // Which slide is on screen → the one snapped into the scroller viewport. Scroll-
  // position based (rAF-throttled) rather than IntersectionObserver: it's simpler,
  // pairs exactly with scroll-snap (rest position is always a multiple of the slide
  // height), and works across every engine. Drives autoplay of the in-view slide.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const h = root.clientHeight || 1;
        const i = Math.max(0, Math.min(lessons.length - 1, Math.round(root.scrollTop / h)));
        setActive((prev) => (prev === i ? prev : i));
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { root.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [lessons.length]);

  useEffect(() => { setProg(0); }, [active]);

  // Drive playback: play the active slide (muted autoplay is allowed on iOS), pause the
  // rest. Skips when the user paused it, the paywall is up, or reduced-motion is on.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && !paused[i] && !paywall[i] && !reduce) v.play().catch(() => { });
      else { try { v.pause(); } catch { /* */ } }
    });
  }, [active, paused, paywall, reduce, muted, lessons.length]);

  const onTime = (i: number, e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const freeSecs = Math.max(0, lessons[i]?.free_preview_seconds ?? 0);
    if (i === active && v.duration) setProg(v.currentTime / v.duration);
    // Per-lesson free preview → Pro paywall (unchanged gate; Pro/admin skip it).
    if (!unlocked && freeSecs > 0 && v.currentTime >= freeSecs) {
      try { v.pause(); } catch { /* */ }
      setPaused((p) => ({ ...p, [i]: true }));
      setPaywall((p) => ({ ...p, [i]: true }));
    }
  };

  const togglePlay = (i: number) => { if (paywall[i]) return; setPaused((p) => ({ ...p, [i]: !p[i] })); };

  // The scroller IS a 9:16 portrait box (height from width — no vh). Full-bleed on
  // mobile (its wrapper cancels the shell page padding), a centred phone-width portrait
  // on desktop. Each slide is height:100% + scroll-snap-align, so one lesson shows at a
  // time and swipes snap to the next.
  const shell: React.CSSProperties = {
    position: "relative", width: "100%", maxWidth: mobile ? undefined : 460,
    margin: mobile ? undefined : "0 auto",
    aspectRatio: "9 / 16", borderRadius: mobile ? 0 : 20, overflow: "hidden", overflowY: "auto",
    scrollSnapType: "y mandatory", background: "#06040f",
    border: mobile ? "none" : `1.5px solid ${C.gold}55`,
    boxShadow: mobile ? "none" : "0 26px 70px rgba(0,0,0,0.6)",
    direction: rtl ? "rtl" : "ltr", WebkitOverflowScrolling: "touch" as any,
  };

  return (
    <div data-tour="learn-play" ref={scrollerRef} style={shell} aria-label={lang === "he" ? "פיד שיעורים" : "Lessons feed"}>
      {lessons.map((lesson, i) => {
        const title = (lang === "he" ? lesson.title_he : lesson.title_en) || lesson.title_en || lesson.title_he || "";
        const caption = (lang === "he" ? lesson.caption_he : lesson.caption_en) || lesson.caption_en || lesson.caption_he || lesson.description || "";
        const freeSecs = Math.max(0, lesson.free_preview_seconds ?? 0);
        const mount = Math.abs(i - active) <= 1;                   // lazy: only visible ±1 mount a <video>
        const isActive = i === active;
        const locked = !!paywall[i] && !unlocked;
        const showPlay = isActive && !locked && (!!paused[i] || reduce);
        return (
          <div key={lesson.id} data-idx={i} ref={(el) => { itemRefs.current[i] = el; }}
            style={{ position: "relative", width: "100%", height: "100%", scrollSnapAlign: "start", scrollSnapStop: "always" as any, background: "#06040f" }}>

            {lesson.video_url ? (
              mount ? (
                <video ref={(el) => { videoRefs.current[i] = el; }} src={lesson.video_url}
                  playsInline {...({ "webkit-playsinline": "true" } as any)} muted={muted} loop
                  poster={posterFor(lesson.video_url)} preload="metadata"
                  onClick={() => togglePlay(i)}
                  onTimeUpdate={(e) => onTime(i, e)}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }} />
              ) : (
                <img src={posterFor(lesson.video_url)} alt={title} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
              )
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#6b7280", background: "radial-gradient(circle at 50% 30%, #141033, #06040f)" }}>
                <Film size={40} /><span style={{ fontSize: 13 }}>{lang === "he" ? "אין וידאו עדיין" : "No video yet"}</span>
              </div>
            )}

            {/* active-slide progress bar */}
            {isActive && (
              <div style={{ position: "absolute", top: 10, insetInline: 12, height: 3, borderRadius: 3, background: "rgba(255,255,255,0.25)", overflow: "hidden", zIndex: 5 }}>
                <div style={{ height: "100%", background: "#fff", width: `${Math.round(prog * 100)}%` }} />
              </div>
            )}

            {/* lesson counter + home */}
            <div style={{ position: "absolute", top: 22, insetInline: 12, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", background: "rgba(0,0,0,0.45)", borderRadius: 999, padding: "5px 11px", backdropFilter: "blur(4px)" }}>
                {lang === "he" ? "שיעור" : "Lesson"} {i + 1}/{lessons.length}
              </span>
              <button onClick={() => nav("/")} aria-label="home" style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,0.45)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <HomeIcon size={15} />
              </button>
            </div>

            {/* tap-to-play affordance (paused or reduced-motion) */}
            {showPlay && (
              <button onClick={() => togglePlay(i)} aria-label={lang === "he" ? "נגן" : "Play"}
                style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer" }}>
                <span style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Play size={30} color="#fff" fill="#fff" />
                </span>
              </button>
            )}

            {/* mute / unmute (global) */}
            <button onClick={() => setMuted((m) => !m)} aria-label={muted ? (lang === "he" ? "בטל השתקה" : "Unmute") : (lang === "he" ? "השתק" : "Mute")}
              style={{ position: "absolute", insetInlineEnd: 12, bottom: 132, zIndex: 6, width: 46, height: 46, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "1.5px solid rgba(255,255,255,0.24)", color: muted ? "#fff" : C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>

            {/* free-preview badge */}
            {!unlocked && !locked && freeSecs > 0 && (
              <div style={{ position: "absolute", top: 52, insetInlineStart: 12, zIndex: 6, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: onAccent(C.gold), background: C.accentGrad, borderRadius: 999, padding: "3px 9px" }}>
                {lang === "he" ? `תצוגה חינם · ${freeSecs}ש׳` : `Free preview · ${freeSecs}s`}
              </div>
            )}

            {/* caption / title overlay (bilingual, RTL-aware) */}
            {(title || caption) && (
              <div dir="auto" style={{ position: "absolute", insetInline: 0, bottom: 0, zIndex: 5, padding: "56px 16px 22px", insetInlineEnd: 66, textAlign: rtl ? "right" : "left", background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.78))" }}>
                {title && <div style={{ fontSize: mobile ? 17 : 18, lineHeight: 1.35, color: "#fff", fontWeight: 800, textShadow: "0 1px 6px rgba(0,0,0,0.7)" }}>{title}</div>}
                {caption && <div style={{ fontSize: 13.5, lineHeight: 1.45, color: "#e6e8ee", marginTop: 5, textShadow: "0 1px 5px rgba(0,0,0,0.7)" }}>{caption}</div>}
              </div>
            )}

            {/* first-slide swipe hint */}
            {i === 0 && isActive && lessons.length > 1 && (
              <div style={{ position: "absolute", insetInline: 0, bottom: 6, zIndex: 6, textAlign: "center", color: "rgba(255,255,255,0.72)", fontSize: 11, pointerEvents: "none" }}>
                {lang === "he" ? "החליקו למעלה להמשך ↑" : "Swipe up for more ↑"}
              </div>
            )}

            {/* per-lesson paywall */}
            {locked && (
              <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 28, background: "rgba(6,4,15,0.92)", backdropFilter: "blur(6px)" }}>
                <span style={{ width: 64, height: 64, borderRadius: "50%", background: `${C.gold}26`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                  <Lock size={28} color={C.gold} />
                </span>
                <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", marginBottom: 6 }}>{lang === "he" ? "סיימתם את התצוגה החינמית" : "That's the free preview"}</div>
                <div style={{ fontSize: 13.5, color: "#a9b2c0", maxWidth: 300, lineHeight: 1.5, marginBottom: 20 }}>{lang === "he" ? "פתחו את השיעור המלא וכל ההמשך עם Pro." : "Unlock the full lesson and every follow-up with Pro."}</div>
                <button onClick={() => nav("/plans")} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer", background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 14.5, borderRadius: 12, padding: "12px 26px" }}>
                  <Crown size={16} /> {lang === "he" ? "פתחו עם Pro · $99.99/חודש" : "Unlock with Pro · $99.99/mo"}
                </button>
                <button onClick={() => { const v = videoRefs.current[i]; if (v) { try { v.currentTime = 0; } catch { /* */ } } setPaywall((p) => ({ ...p, [i]: false })); setPaused((p) => ({ ...p, [i]: false })); }} style={{ marginTop: 14, background: "none", border: "none", color: "#9aa0a8", fontSize: 12.5, cursor: "pointer" }}>
                  {lang === "he" ? "צפו שוב בתצוגה החינמית" : "Replay free preview"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const lsInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
  background: C.surface2, border: `1px solid ${C.line}`, color: C.text, fontSize: 13.5, outline: "none",
};
const lsLabel: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: C.muted, marginBottom: 4, display: "block" };
const EMPTY_FORM: ReelsLessonInput = { title_he: "", title_en: "", caption_he: "", caption_en: "", description: "", video_url: "", free_preview_seconds: 30, position: 0, published: false };

function LessonsAdmin({ lang, onClose, onChanged }: { lang: Lang; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<ReelsLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ReelsLessonInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Editable in-app "90-second tour" link (embedded on the Reels·course screen).
  const [tour, setTour] = useState("");
  const [tourSaved, setTourSaved] = useState(false);
  const t = (he: string, en: string) => (lang === "he" ? he : en);

  async function refresh() {
    setLoading(true);
    try { const r = await api.reelsLessonsAdmin(); setList(r.lessons || []); }
    catch (e: any) { setErr(e?.message || "Failed to load"); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { api.reelsTour().then((r) => setTour(r.url || "")).catch(() => { }); }, []);
  async function saveTour() {
    try { const r = await api.setReelsTour(tour); setTour(r.url); setTourSaved(true); setTimeout(() => setTourSaved(false), 1800); }
    catch (e: any) { setErr(e?.message || "Failed"); }
  }

  function startNew() { setEditingId(null); setForm({ ...EMPTY_FORM, position: list.length }); setErr(""); }
  function startEdit(l: ReelsLesson) {
    setEditingId(l.id);
    setForm({ title_he: l.title_he, title_en: l.title_en, caption_he: l.caption_he || "", caption_en: l.caption_en || "", description: l.description, video_url: l.video_url || "", free_preview_seconds: l.free_preview_seconds, position: l.position, published: l.published });
    setErr("");
  }
  async function save() {
    setBusy(true); setErr("");
    try {
      if (editingId == null) await api.createReelsLesson(form);
      else await api.updateReelsLesson(editingId, form);
      await refresh(); onChanged(); startNew();
    } catch (e: any) { setErr(e?.message || "Save failed"); }
    finally { setBusy(false); }
  }
  async function togglePublish(l: ReelsLesson) {
    try { await api.updateReelsLesson(l.id, { published: !l.published }); await refresh(); onChanged(); }
    catch (e: any) { setErr(e?.message || "Failed"); }
  }
  async function remove(l: ReelsLesson) {
    if (!window.confirm(t("למחוק את השיעור הזה?", "Delete this lesson?"))) return;
    try { await api.deleteReelsLesson(l.id); await refresh(); onChanged(); if (editingId === l.id) startNew(); }
    catch (e: any) { setErr(e?.message || "Failed"); }
  }
  // Up/down reorder — swap with the neighbour, persist the new order (optimistic).
  async function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const order = list.map((x) => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    setList((prev) => { const c = [...prev]; [c[i], c[j]] = [c[j], c[i]]; return c; });
    try { const r = await api.reorderReelsLessons(order); setList(r.lessons || []); onChanged(); }
    catch (e: any) { setErr(e?.message || "Failed"); refresh(); }
  }
  const set = (k: keyof ReelsLessonInput, v: any) => setForm((f) => ({ ...f, [k]: v }));
  // Upload a video file: read it as a base64 data:video URL and drop it into
  // video_url, which POST /auth/reels/admin already accepts (its _clean_video
  // allows data:video up to ~25MB). ~24MB cap here (base64 inflates ~33%).
  function onPickFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("video/")) { setErr(t("הקובץ חייב להיות וידאו.", "The file must be a video.")); return; }
    if (file.size > 24 * 1024 * 1024) {
      setErr(t("הקובץ גדול מדי — עד ~24MB, או הדביקו קישור מתארח למעלה.", "That file is too large — keep it under ~24MB, or paste a hosted link above."));
      return;
    }
    setErr(""); setBusy(true);
    const reader = new FileReader();
    reader.onerror = () => { setBusy(false); setErr(t("קריאת הקובץ נכשלה.", "Couldn't read the file.")); };
    reader.onload = () => { set("video_url", String(reader.result || "")); setBusy(false); };
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(4,3,10,0.7)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: 16, overflowY: "auto", direction: lang === "he" ? "rtl" : "ltr" }}>
      <div style={{ width: "100%", maxWidth: 560, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18, marginTop: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>{t("ניהול שיעורים", "Manage lessons")}</h2>
          <button onClick={onClose} aria-label="close" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={20} /></button>
        </div>

        {err ? <div style={{ background: "rgba(240,97,109,0.12)", color: "#F0616D", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, marginBottom: 12 }}>{err}</div> : null}

        <div style={{ background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, borderRadius: 14, padding: 14, marginBottom: 16, border: `1px solid ${C.line}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}` }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.gold, marginBottom: 10 }}>
            {editingId == null ? t("שיעור חדש", "New lesson") : t("עריכת שיעור", "Edit lesson")}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lsLabel}>{t("כותרת (עברית)", "Title (Hebrew)")}</label>
              <input style={lsInput} value={form.title_he || ""} onChange={(e) => set("title_he", e.target.value)} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lsLabel}>{t("כותרת (אנגלית)", "Title (English)")}</label>
              <input style={lsInput} value={form.title_en || ""} onChange={(e) => set("title_en", e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lsLabel}>{t("כיתוב (עברית)", "Caption (Hebrew)")}</label>
              <input dir="rtl" style={lsInput} value={form.caption_he || ""} onChange={(e) => set("caption_he", e.target.value)} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lsLabel}>{t("כיתוב (אנגלית)", "Caption (English)")}</label>
              <input dir="ltr" style={lsInput} value={form.caption_en || ""} onChange={(e) => set("caption_en", e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={lsLabel}>{t("תיאור ארוך (אופציונלי)", "Long description (optional)")}</label>
            <textarea style={{ ...lsInput, minHeight: 56, resize: "vertical" }} value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={lsLabel}>{t("וידאו — הדביקו קישור או העלו קובץ", "Video — paste a link or upload a file")}</label>
            <input style={lsInput} placeholder="https://…"
              value={form.video_url?.startsWith("data:") ? "" : (form.video_url || "")}
              disabled={!!form.video_url?.startsWith("data:")}
              onChange={(e) => set("video_url", e.target.value)} />
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ ...premSoft(), display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: C.text, padding: "8px 13px", fontSize: 12.5 }}>
                <Film size={14} /> {t("העלה קובץ", "Upload file")}
                <input type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { onPickFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
              </label>
              {form.video_url?.startsWith("data:") && (
                <span style={{ fontSize: 11.5, color: C.gain, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  ✓ {t("קובץ נטען", "file loaded")}
                  <button onClick={() => set("video_url", "")} aria-label="remove" style={{ background: "none", border: "none", color: C.loss, cursor: "pointer", padding: 0, display: "inline-flex" }}><X size={13} /></button>
                </span>
              )}
              <span style={{ fontSize: 10.5, color: C.faint }}>{t("עד ~24MB · או הדביקו קישור", "up to ~24MB · or paste a link")}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ flex: "1 1 130px" }}>
              <label style={lsLabel}>{t("שניות חינם", "Free seconds")}</label>
              <input type="number" min={0} style={lsInput} value={form.free_preview_seconds ?? 0} onChange={(e) => set("free_preview_seconds", Math.max(0, Number(e.target.value) || 0))} />
            </div>
            <div style={{ flex: "1 1 130px" }}>
              <label style={lsLabel}>{t("סדר", "Order")}</label>
              <input type="number" style={lsInput} value={form.position ?? 0} onChange={(e) => set("position", Number(e.target.value) || 0)} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 7, alignSelf: "flex-end", color: C.text, fontSize: 13, cursor: "pointer", paddingBottom: 8 }}>
              <input type="checkbox" checked={!!form.published} onChange={(e) => set("published", e.target.checked)} />
              {t("פורסם", "Published")}
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button disabled={busy} onClick={save} className="gbtn ptile" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: busy ? "default" : "pointer", fontWeight: 800, fontSize: 13.5, padding: "9px 18px", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>
              <Plus size={15} /> {editingId == null ? t("הוסף שיעור", "Add lesson") : t("שמור שינויים", "Save changes")}
            </button>
            {editingId != null && (
              <button onClick={startNew} style={{ ...premSoft(), color: C.muted, padding: "9px 16px", fontSize: 13, whiteSpace: "nowrap", cursor: "pointer" }}>{t("ביטול", "Cancel")}</button>
            )}
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>
          {loading ? t("טוען…", "Loading…") : `${list.length} ${t("שיעורים", "lessons")}`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((l, i) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, background: `linear-gradient(180deg, ${C.surface} 0%, ${C.surface2} 100%)`, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 11px", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.20), ${SHADOW}` }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("למעלה", "Move up")} style={ctrlChip({ width: 26, height: 20, color: i === 0 ? C.faint : C.text })}><ChevronUp size={13} /></button>
                <button onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={t("למטה", "Move down")} style={ctrlChip({ width: 26, height: 20, color: i === list.length - 1 ? C.faint : C.text })}><ChevronDown size={13} /></button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {(lang === "he" ? l.title_he : l.title_en) || l.title_en || l.title_he || t("(ללא כותרת)", "(untitled)")}
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {l.video_url ? t("וידאו ✓", "video ✓") : t("ללא וידאו", "no video")} · {l.free_preview_seconds}s {t("חינם", "free")}
                </div>
              </div>
              <button onClick={() => togglePublish(l)} title={l.published ? t("פורסם", "Published") : t("טיוטה", "Draft")} style={ctrlChip({ width: 30, height: 28, color: l.published ? C.gain : C.faint })}>
                {l.published ? <Eye size={17} /> : <EyeOff size={17} />}
              </button>
              <button onClick={() => startEdit(l)} style={{ ...premSoft(), color: C.blue, padding: "5px 12px", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>{t("ערוך", "Edit")}</button>
              <button onClick={() => remove(l)} aria-label="delete" style={ctrlChip({ width: 30, height: 28, color: C.loss })}><Trash2 size={16} /></button>
            </div>
          ))}
          {!loading && list.length === 0 && (
            <div style={{ fontSize: 12.5, color: C.muted, textAlign: "center", padding: "12px 0" }}>{t("עדיין אין שיעורים — הוסיפו את הראשון למעלה.", "No lessons yet — add your first above.")}</div>
          )}
        </div>

        {/* In-app "90-second tour" link — the green button on the Reels screen embeds this. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
          <label style={lsLabel}>{t("קישור לסיור באפליקציה (90 שניות)", "In-app tour link (90-second)")}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input dir="ltr" style={{ ...lsInput, flex: "1 1 220px" }} placeholder="/media/home-tour.html" value={tour} onChange={(e) => setTour(e.target.value)} />
            <button onClick={saveTour} style={{ ...premSoft(), color: C.text, padding: "9px 16px", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>
              {tourSaved ? `✓ ${t("נשמר", "Saved")}` : t("שמור קישור", "Save link")}
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: C.faint, marginTop: 5 }}>
            {t("נתיב סטטי (למשל /media/home-tour.html) או קישור http(s).", "A static path (e.g. /media/home-tour.html) or an http(s) link.")}
          </div>
        </div>
      </div>
    </div>
  );
}

// Placeholder shown until real lessons are published — replaces the old
// auto-speaking podcast hosts. Pure inline SVG so there's no asset to host.
function UnderConstruction({ lang, rtl, mobile }: { lang: Lang; rtl: boolean; mobile: boolean }) {
  const nav = useNavigate();
  const frameW = mobile ? "100%" : "min(92vw, 1040px)";
  const frameH = mobile ? "calc(100vh - 90px)" : "min(82vh, 720px)";
  return (
    <div style={{ position: "relative", width: frameW, aspectRatio: "16 / 9", maxWidth: 1040, borderRadius: mobile ? 0 : 16, overflow: "hidden",
      background: "radial-gradient(120% 80% at 50% 20%, #1b1442 0%, #0c0a1e 56%, #06040f 100%)",
      boxShadow: mobile ? "none" : "0 26px 70px rgba(0,0,0,0.6)", direction: rtl ? "rtl" : "ltr",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center",
      border: mobile ? "none" : "1px solid rgba(120,90,200,0.3)" }}>
      <style>{`
        @keyframes ucSpin{to{transform:rotate(360deg)}}
        @keyframes ucSpinR{to{transform:rotate(-360deg)}}
        @keyframes ucBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
      `}</style>

      <button onClick={() => nav("/")} aria-label="home" style={{ position: "absolute", top: 16, insetInlineEnd: 14, width: 30, height: 30, borderRadius: "50%", background: "rgba(0,0,0,0.45)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5 }}>
        <HomeIcon size={15} />
      </button>

      <svg viewBox="0 0 240 180" width={mobile ? 210 : 232} height={mobile ? 158 : 174} style={{ animation: "ucBob 3.8s ease-in-out infinite" }} aria-hidden>
        <defs>
          <linearGradient id="ucGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FBC02D" /><stop offset="100%" stopColor="#F7931A" /></linearGradient>
        </defs>
        <ellipse cx="120" cy="158" rx="96" ry="16" fill="#F7931A" opacity="0.12" />
        <g style={{ transformBox: "fill-box", transformOrigin: "center", animation: "ucSpin 9s linear infinite" } as any}>
          <circle cx="92" cy="92" r="40" fill="none" stroke="url(#ucGold)" strokeWidth="12" strokeDasharray="9 13" />
          <circle cx="92" cy="92" r="24" fill="#14122e" stroke="#F7931A" strokeWidth="2" />
          <circle cx="92" cy="92" r="8" fill="#06040f" />
        </g>
        <g style={{ transformBox: "fill-box", transformOrigin: "center", animation: "ucSpinR 6s linear infinite" } as any}>
          <circle cx="166" cy="64" r="27" fill="none" stroke="url(#ucGold)" strokeWidth="9" strokeDasharray="7 10" />
          <circle cx="166" cy="64" r="15" fill="#14122e" stroke="#F7931A" strokeWidth="2" />
          <circle cx="166" cy="64" r="5" fill="#06040f" />
        </g>
      </svg>

      <div style={{ width: "78%", height: 12, borderRadius: 4, marginTop: 22,
        background: "repeating-linear-gradient(45deg,#F7931A 0 12px,#1a1206 12px 24px)" }} />

      <div style={{ marginTop: 18, fontSize: mobile ? 21 : 23, fontWeight: 900, letterSpacing: "0.4px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <span>🚧</span>
        <span style={{ background: "linear-gradient(135deg,#FBC02D,#F7931A)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
          {lang === "he" ? "בבנייה" : "UNDER CONSTRUCTION"}
        </span>
        <span>🚧</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 14.5, color: "#cbd2dc", fontWeight: 600, maxWidth: 300, lineHeight: 1.5 }}>
        {lang === "he" ? "השיעורים החדשים בדרך." : "New lessons are on the way."}
      </div>
    </div>
  );
}

export default function Reels() {
  const { t, lang, rtl } = useI18n();
  const mobile = useIsMobile();
  const ent = useEntitlements().data;
  // The content editor (Reels manager) opens for full admins AND a granted content_editor
  // (e.g. Yoav) — the backend routes are gated the same way (require_content_editor). A
  // content editor also gets the content unlocked so they can view what they're editing.
  const isAdmin = (!!ent && ent.isAdmin) || isContentEditor();
  const unlocked = (!!ent && (ent.isAdmin || ent.plan === "pro")) || isContentEditor();

  const [lessons, setLessons] = useState<ReelsLesson[] | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  // The in-app tour link is admin-editable (see LessonsAdmin); default until it loads.
  const [tourUrl, setTourUrl] = useState("/media/home-tour.html");

  async function loadLessons() {
    try { const r = await api.reelsLessons(); setLessons(r.lessons || []); }
    catch { setLessons([]); }
  }
  useEffect(() => { loadLessons(); }, []);
  useEffect(() => { api.reelsTour().then((r) => { if (r.url) setTourUrl(r.url); }).catch(() => { }); }, []);

  const hasLessons = !!lessons && lessons.length > 0;

  return (
    <>
      <TourLauncher screen="learn" />
      {/* Home-like clean top: the wordmark ScreenHeader with THIS screen's own name.
          The P&L (תיק) card is intentionally OMITTED here — Reels is a full-bleed,
          immersive vertical-video surface, so a balance card at the top would harm
          the cinematic UX. The header is centered to align with the player frame. */}
      <div style={{ display: "flex", justifyContent: "center", padding: mobile ? "0 12px" : "0 8px" }}>
        <div style={{ width: "100%", maxWidth: 1040, marginBottom: 12 }}>
          {/* Carved screen name inside Home's frame. The P&L/Help footer (ScreenBottom) is
              intentionally omitted on Reels — it's a full-bleed immersive video surface. */}
          <FramedTitle text={t.reels}
            subtitle={lang === "he" ? "קורס וידאו אנכי — תצוגה חינם ואז Pro" : "Vertical video course — free preview, then Pro"} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: mobile ? "10px 12px 2px" : "10px 8px 2px" }}>
        <button onClick={() => setTourOpen(true)} data-tour="learn-tour"
          style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", width: "100%", maxWidth: 560,
            border: "1px solid rgba(255,255,255,0.18)", borderRadius: 16, padding: "12px 16px", fontFamily: "inherit", textAlign: "start",
            background: "linear-gradient(135deg,#9ed773,#6fbf3f)", color: "#13310a",
            boxShadow: "0 10px 26px -8px rgba(95,170,55,0.55)" }}>
          <span style={{ width: 36, height: 36, borderRadius: "50%", flex: "0 0 auto", background: "#13310a", color: "#9ed773",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>▶</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: 15, fontWeight: 900 }}>{lang === "he" ? "צפו בסיור באפליקציה — 90 שניות" : "Watch the 90-second in-app tour"}</span>
            <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.82 }}>{lang === "he" ? "קונספט חדש — לבדיקה" : "New concept — preview"}</span>
          </span>
        </button>
      </div>
      {hasLessons ? (
        <div data-tour="learn-feed" style={mobile
          // Full-bleed on mobile: cancel the shell's page padding so the TikTok feed
          // reaches the screen edges (matches Shell's mobile paddingInline 36/52 + safe-areas).
          ? { marginInlineStart: "calc(-1 * (36px + env(safe-area-inset-left, 0px)))", marginInlineEnd: "calc(-1 * (52px + env(safe-area-inset-right, 0px)))" }
          : { display: "flex", justifyContent: "center", padding: 8 }}>
          <LessonsFeed lessons={lessons as ReelsLesson[]} unlocked={unlocked} lang={lang} rtl={rtl} mobile={mobile} />
        </div>
      ) : (
        <div data-tour="learn-feed" style={{ display: "flex", justifyContent: "center", padding: mobile ? 0 : 8 }}>
          <UnderConstruction lang={lang} rtl={rtl} mobile={mobile} />
        </div>
      )}

      {isAdmin && (
        <button onClick={() => setAdminOpen(true)} title={lang === "he" ? "ניהול שיעורים" : "Manage lessons"} className="gbtn"
          style={{ position: "fixed", insetInlineEnd: 18, bottom: 96, zIndex: 30, width: 50, height: 50, borderRadius: "50%",
            border: "1.5px solid var(--btn-bd)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.30), 0 10px 24px -6px rgba(0,0,0,0.7)" }}>
          <Settings size={22} />
        </button>
      )}

      {adminOpen && <LessonsAdmin lang={lang} onClose={() => setAdminOpen(false)} onChanged={loadLessons} />}

      {tourOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(2,5,2,0.86)", backdropFilter: "blur(4px)",
          display: "flex", flexDirection: "column", padding: mobile ? 0 : 16, direction: "ltr" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px" }}>
            <span style={{ color: "#eaf7df", fontWeight: 800, fontSize: 14 }}>In-app guided tour — concept preview</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <a href={tourUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#bdf0a0", fontWeight: 700, fontSize: 13, textDecoration: "none" }}>Open in new tab ↗</a>
              <button onClick={() => setTourOpen(false)} aria-label="Close"
                style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.16)", border: "none", color: "#fff", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
          </div>
          <iframe title="770 in-app tour" src={tourUrl} allow="autoplay; fullscreen"
            style={{ flex: 1, width: "100%", border: "none", borderRadius: mobile ? 0 : 14, background: "#e8efdf" }} />
        </div>
      )}
    </>
  );
}
