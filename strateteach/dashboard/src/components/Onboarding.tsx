import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Diamond, Sparkles, ArrowRight, Crown, Check, ChevronLeft, ChevronRight, Award, Lock, Link2, Globe, X } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import type { OnboardingProfile } from "../lib/client";

const BRAND = "linear-gradient(135deg,#FBC02D,#F7931A 55%,#7CC04E)";
const tr = (lang: string, en: string, he: string) => (lang === "he" ? he : en);

// Stage badges. Highest is "pro" (auto for Pro/admin — they pay).
const BADGES: Record<string, { en: string; he: string; color: string }> = {
  starter: { en: "Starter", he: "מתחיל", color: "#5AA6FF" },
  trader: { en: "Trader", he: "סוחר", color: "#36E0A0" },
  strategist: { en: "Strategist", he: "אסטרטג", color: "#C792FF" },
  pro: { en: "Pro", he: "Pro", color: "#F7931A" },
};
const tierForLevel = (level: string) =>
  ({ beginner: "starter", intermediate: "trader", advanced: "strategist" } as Record<string, string>)[level] || "starter";

type Opt = { id: string; en: string; he: string };
const YSN: Opt[] = [
  { id: "yes", en: "Yes", he: "כן" },
  { id: "some", en: "A little", he: "קצת" },
  { id: "no", en: "Not really", he: "לא ממש" },
];
const YN: Opt[] = [
  { id: "yes", en: "Yes", he: "כן" },
  { id: "no", en: "No", he: "לא" },
];

const QUESTIONS: { id: string; en: string; he: string; opts: Opt[] }[] = [
  { id: "q1", en: "Are you familiar with trading?", he: "אתם מכירים מסחר?", opts: YSN },
  { id: "q2", en: "Have you opened a wallet on an exchange?", he: "פתחתם ארנק בבורסה?", opts: YN },
  { id: "q3", en: "Are you familiar with algo trading?", he: "אתם מכירים מסחר אלגוריתמי?", opts: YSN },
  { id: "q4", en: "Have you lost money trading and weren't sure why?", he: "הפסדתם כסף במסחר ולא ידעתם למה?", opts: YN },
  { id: "q5", en: "Are you familiar with strategy trading?", he: "אתם מכירים מסחר לפי אסטרטגיה?", opts: YSN },
];

export default function Onboarding() {
  const { lang, rtl, setLang } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const entQ = useQuery({ queryKey: ["entitlements"], queryFn: () => api.entitlements() });

  const [forced, setForced] = useState(false);
  // Real dismiss flags so closing ALWAYS triggers a re-render that unmounts the
  // overlay (setForced(false) alone is a no-op when forced is already false →
  // the invisible overlay would otherwise stay on top and eat every tap).
  const [greeted, setGreeted] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const open = () => { setClosed(false); setForced(true); };
    window.addEventListener("algo770-onboarding-open", open);
    return () => window.removeEventListener("algo770-onboarding-open", open);
  }, []);

  const ent = entQ.data;
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: 60000 });
  const myName = ((meQ.data as any)?.username as string) || "";
  const isPro = !!ent && (ent.isAdmin || ent.plan === "pro");
  const completed = !!ent && (isPro || ent.onboarded === true);
  // Welcome slide-in for EVERY user, once per app open (each fresh load). Greets
  // by name; finished users can Skip straight in, new users can start the guide.
  const greetSeen = (() => { try { return sessionStorage.getItem("algo770_greeted") === "1"; } catch { return false; } })();
  // Persistent "Don't show this again" — suppresses the auto greeting/quiz on sign-in
  // (an explicit open via the AI-guide button still forces it).
  const hideForever = (() => { try { return localStorage.getItem("algo770_hide_onboarding") === "1"; } catch { return false; } })();
  const showGreeting = !!ent && !greeted && ((!greetSeen && !hideForever) || forced);
  const visible = showGreeting;

  const [phase, setPhase] = useState<"reel" | "quiz" | "result" | "badge">("reel");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [fly, setFly] = useState<string | null>(null);
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [saving, setSaving] = useState(false);
  // Result wizard state (Start-button style stepper).
  const [rstep, setRstep] = useState(0);
  const [rdone, setRdone] = useState<boolean[]>([]);
  const [forcedQuiz, setForcedQuiz] = useState(false);
  const [badgeRes, setBadgeRes] = useState<{ earned: boolean; tier: string; connected: boolean } | null>(null);

  // The home "Start now" button replays the AI agent for ANY user (incl. pro/admin).
  useEffect(() => {
    const openQuiz = () => {
      setClosed(false); setGreeted(true); // replaying the guide: show quiz, not the greeting
      setForcedQuiz(true); setPhase("quiz"); setIdx(0); setAnswers({});
      setProfile(null); setRstep(0); setRdone([]);
    };
    window.addEventListener("algo770-onboarding-quiz", openQuiz);
    return () => window.removeEventListener("algo770-onboarding-quiz", openQuiz);
  }, []);

  if (closed || (!visible && !forcedQuiz)) return null;

  if (showGreeting && !forcedQuiz) return <ProGreeting name={myName} completed={completed} planLabel={ent!.planLabel} admin={ent!.isAdmin}
    onEnter={() => { try { sessionStorage.setItem("algo770_greeted", "1"); } catch (_e) { /* */ } setGreeted(true); setForced(false); }}
    onStart={() => { try { sessionStorage.setItem("algo770_greeted", "1"); } catch (_e) { /* */ } setGreeted(true); setForcedQuiz(true); setPhase("quiz"); setIdx(0); setAnswers({}); setProfile(null); setRstep(0); setRdone([]); }} />;

  const total = QUESTIONS.length;
  const answered = Object.keys(answers).length;
  const ringPct = phase === "result" ? (profile?.stratScore ?? 100) : Math.round((answered / total) * 100);

  function pick(qid: string, optId: string) {
    setFly(optId);
    const next = { ...answers, [qid]: optId };
    setAnswers(next);
    setTimeout(async () => {
      setFly(null);
      if (idx + 1 < total) {
        setIdx(idx + 1);
      } else {
        setSaving(true);
        try {
          const p = await api.submitOnboarding(next);
          setProfile(p as OnboardingProfile);
          setPhase("result");
          qc.invalidateQueries({ queryKey: ["entitlements"] });
        } catch {
          // best-effort: still let them in
          setPhase("result");
        } finally { setSaving(false); }
      }
    }, 520);
  }

  function finish(goPath?: string) {
    setClosed(true); setGreeted(true); setForced(false); setForcedQuiz(false);
    qc.invalidateQueries({ queryKey: ["entitlements"] });
    if (goPath) nav(goPath); else nav("/");
  }

  function skipReel() { setPhase("quiz"); }

  // Presentation controls for the AI agent: stop (close, stay), back (a step), exit (close + home).
  function stopAgent() {
    setClosed(true); setGreeted(true); setForced(false); setForcedQuiz(false);
    qc.invalidateQueries({ queryKey: ["entitlements"] });
  }
  function backStep() {
    if (phase === "quiz") { if (idx > 0) setIdx(idx - 1); else setPhase("reel"); }
    else if (phase === "result") { setPhase("quiz"); setIdx(Math.max(0, total - 1)); }
    else if (phase === "badge") { setPhase("result"); }
  }

  // Decorative animated circle (the "strat score" builder).
  const Circle = (
    <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto" }}>
      <svg viewBox="0 0 200 200" width="200" height="200" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="100" cy="100" r="86" fill="none" stroke={C.line} strokeWidth="10" />
        <circle cx="100" cy="100" r="86" fill="none" stroke="url(#og)" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 86}
          strokeDashoffset={(2 * Math.PI * 86) * (1 - ringPct / 100)}
          style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,0.61,0.36,1)" }} />
        <defs>
          <linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FBC02D" /><stop offset="0.55" stopColor="#F7931A" /><stop offset="1" stopColor="#7CC04E" />
          </linearGradient>
        </defs>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Diamond size={26} color={C.gold} fill={C.gold} style={{ filter: "drop-shadow(0 0 10px rgba(247,147,26,.6))", animation: "obFloat 2.4s ease-in-out infinite" }} />
        <div style={{ fontSize: 34, fontWeight: 800, color: C.text, lineHeight: 1, marginTop: 8 }}>{ringPct}</div>
        <div style={{ fontSize: 10, letterSpacing: "0.16em", color: C.muted }}>STRAT SCORE</div>
      </div>
      {fly && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", animation: "obFly 0.5s ease-out forwards",
          fontSize: 12, fontWeight: 800, color: "var(--btn-ink)", background: "var(--btn-bg)", borderRadius: 999, padding: "4px 10px" }}>+</div>
      )}
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, direction: rtl ? "rtl" : "ltr", fontFamily: UI,
      background: `radial-gradient(1200px 800px at 50% -10%, ${C.surface}, ${C.bg} 60%)`, color: C.text,
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
      <style>{`
        @keyframes obFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
        @keyframes obFly{0%{transform:translate(-50%,40px) scale(.6);opacity:0}40%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:0}}
        @keyframes obIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes obPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}
        @keyframes obDash{to{stroke-dashoffset:0}}
      `}</style>

      {/* AI-agent presentation controls: Back · Language · Stop · Exit */}
      <div style={{ position: "absolute", top: 0, insetInlineStart: 0, insetInlineEnd: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", zIndex: 2 }}>
        <button onClick={backStep} style={ctrlBtn}><ChevronLeft size={15} /> {tr(lang, "Back", "חזרה")}</button>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setLang(lang === "he" ? "en" : "he")} style={ctrlBtn}><Globe size={14} /> {lang === "he" ? "EN" : "עב"}</button>
          <button onClick={stopAgent} style={ctrlBtn}>■ {tr(lang, "Stop", "עצור")}</button>
          <button onClick={() => finish()} style={ctrlBtn}><X size={15} /> {tr(lang, "Exit", "יציאה")}</button>
        </div>
      </div>

      <div style={{ width: "min(560px, 92vw)", padding: "48px 24px 24px", animation: "obIn .5s ease" }}>
        {phase === "reel" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ position: "relative", height: 220, marginBottom: 8 }}>
              <svg viewBox="0 0 560 220" width="100%" height="220">
                <polyline points="10,170 80,150 140,165 210,120 280,135 350,80 420,95 500,40 550,55"
                  fill="none" stroke="url(#eg)" strokeWidth="3" strokeDasharray="1400" strokeDashoffset="1400"
                  style={{ animation: "obDash 2.2s ease forwards" }} />
                <defs><linearGradient id="eg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#F7931A" /><stop offset="1" stopColor="#7CC04E" /></linearGradient></defs>
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Diamond size={56} color={C.gold} fill={C.gold} style={{ filter: "drop-shadow(0 0 20px rgba(247,147,26,.7))", animation: "obFloat 2.6s ease-in-out infinite" }} />
              </div>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0", letterSpacing: "0.04em" }}>ALGO770</h1>
            <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>
              {tr(lang, "Your AI guide will tune the app to you in 5 quick questions.",
                  "המדריך החכם יתאים את האפליקציה אליכם ב-5 שאלות קצרות.")}
            </p>
            <button onClick={skipReel} style={primaryBtn}>
              {tr(lang, "Let's go", "יאללה נתחיל")} <ArrowRight size={16} />
            </button>
            <div><button onClick={skipReel} style={linkBtn}>{tr(lang, "Skip intro", "דלגו על הפתיח")}</button></div>
          </div>
        )}

        {phase === "quiz" && (
          <div style={{ textAlign: "center" }}>
            {Circle}
            <div style={{ marginTop: 18, fontSize: 11, color: C.muted }}>
              {tr(lang, `Question ${idx + 1} of ${total}`, `שאלה ${idx + 1} מתוך ${total}`)}
            </div>
            <h2 key={idx} style={{ fontSize: 20, fontWeight: 800, margin: "8px 0 18px", animation: "obIn .35s ease" }}>
              {tr(lang, QUESTIONS[idx].en, QUESTIONS[idx].he)}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360, margin: "0 auto" }}>
              {QUESTIONS[idx].opts.map((o) => (
                <button key={o.id} disabled={!!fly || saving} onClick={() => pick(QUESTIONS[idx].id, o.id)} style={optBtn}>
                  {tr(lang, o.en, o.he)}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "result" && profile && (() => {
          const steps = profile.steps || [];
          const cur = steps[rstep];
          const isLast = rstep >= steps.length - 1;
          const Fwd = rtl ? ChevronLeft : ChevronRight;
          const Bwd = rtl ? ChevronRight : ChevronLeft;
          return (
          <div style={{ textAlign: "center" }}>
            {Circle}
            <div style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 13 }}>
              <Sparkles size={14} /> {tr(lang, profile.levelLabelEn, profile.levelLabelHe)}
            </div>
            <p style={{ color: C.text, fontSize: 15, fontWeight: 600, margin: "12px 0 4px" }}>
              {tr(lang, profile.headlineEn, profile.headlineHe)}
            </p>
            <p style={{ color: C.muted, fontSize: 12, margin: "0 0 16px" }}>
              {tr(lang, "Your AI guide built this plan to get you to Pro:", "המדריך החכם בנה לכם תוכנית עד Pro:")}
            </p>

            {steps.length === 0 ? (
              <div><button onClick={() => finish()} style={primaryBtn}><Check size={16} /> {tr(lang, "Start", "התחל")}</button></div>
            ) : (
              <div style={{ maxWidth: 380, margin: "0 auto", borderRadius: 18, border: `1px solid ${C.line}`, background: C.surface, padding: 18 }}>
                {/* progress chips with green checks */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  {steps.map((_, i) => {
                    const done = rdone[i]; const active = i === rstep;
                    return (
                      <React.Fragment key={i}>
                        <button onClick={() => setRstep(i)} style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800,
                          background: done ? "#1f9d57" : active ? C.gold : "rgba(255,255,255,0.08)",
                          color: done ? "#fff" : active ? "#1a1206" : "#cbd5e1", border: active && !done ? "none" : `1px solid ${C.line}` }}>
                          {done ? <Check size={15} /> : i + 1}
                        </button>
                        {i < steps.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, background: rdone[i] ? "#1f9d57" : "rgba(255,255,255,0.12)" }} />}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* current step */}
                <div key={rstep} style={{ textAlign: rtl ? "right" : "left", marginBottom: 16, animation: "obIn .3s ease" }}>
                  <div style={{ fontSize: 11, color: C.gold, fontWeight: 700, marginBottom: 3 }}>
                    {tr(lang, `Step ${rstep + 1} of ${steps.length}`, `שלב ${rstep + 1} מתוך ${steps.length}`)}
                  </div>
                  <b style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{tr(lang, cur.titleEn, cur.titleHe)}</b>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>{tr(lang, cur.descEn, cur.descHe)}</div>
                </div>

                {/* open-this-screen link */}
                <button onClick={() => finish(cur.path)} style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
                  background: "rgba(255,255,255,0.05)", border: `1px solid ${C.line}`, color: C.text, borderRadius: 11, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 12, fontFamily: UI }}>
                  {cur.key === "go_pro" ? <Crown size={14} color={C.gold} /> : <ArrowRight size={14} color={C.gold} style={{ transform: rtl ? "rotate(180deg)" : "none" }} />}
                  {cur.key === "go_pro" ? tr(lang, "See plans", "צפו במסלולים") : tr(lang, "Open this", "פתחו את זה")}
                </button>

                {/* back + next/finish */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setRstep((s) => Math.max(0, s - 1))} disabled={rstep === 0}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: `1px solid ${C.line}`,
                      color: rstep === 0 ? C.faint : C.muted, borderRadius: 11, padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: rstep === 0 ? "default" : "pointer", fontFamily: UI }}>
                    <Bwd size={15} /> {tr(lang, "Back", "חזרה")}
                  </button>
                  <button onClick={() => {
                      setRdone((d) => { const n = [...d]; n[rstep] = true; return n; });
                      if (isLast) {
                        const connected = !!loadExchangeCreds();
                        const isProUser = !!ent && (ent.isAdmin || ent.plan === "pro");
                        const tier = isProUser ? "pro" : tierForLevel(profile.level);
                        const earned = isProUser || connected;
                        setBadgeRes({ earned, tier, connected });
                        if (earned) api.setBadge(tier).then(() => qc.invalidateQueries({ queryKey: ["entitlements"] })).catch(() => {});
                        setPhase("badge");
                      } else setRstep((s) => s + 1);
                    }}
                    style={{ ...primaryBtn, flex: 1, margin: 0, justifyContent: "center" }}>
                    {isLast ? <><Award size={16} /> {tr(lang, "Finish & get badge", "סיום וקבלת תג")}</> : <>{tr(lang, "Next", "הבא")} <Fwd size={16} /></>}
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {phase === "badge" && badgeRes && (() => {
          const b = BADGES[badgeRes.tier] || BADGES.starter;
          if (badgeRes.earned) {
            return (
              <div style={{ textAlign: "center" }}>
                <div style={{ position: "relative", width: 150, height: 150, margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 50% 40%, ${b.color}44, transparent 70%)` }} />
                  <span style={{ width: 116, height: 116, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: `conic-gradient(${b.color}, #FBC02D, ${b.color})`, boxShadow: `0 0 30px ${b.color}66` }}>
                    <span style={{ width: 100, height: 100, borderRadius: "50%", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                      <Award size={40} color={b.color} />
                    </span>
                  </span>
                </div>
                <div style={{ fontSize: 11, letterSpacing: "0.18em", color: C.muted }}>{tr(lang, "CERTIFIED", "הוסמך")}</div>
                <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0 2px", color: b.color }}>{tr(lang, b.en, b.he)}</h1>
                <p style={{ color: C.text, fontSize: 14, fontWeight: 600, margin: "6px 0 2px" }}>
                  {tr(lang, "Badge unlocked — nice work! 🏆", "התג נפתח — כל הכבוד! 🏆")}
                </p>
                <p style={{ color: C.muted, fontSize: 12, margin: "0 0 18px" }}>
                  {badgeRes.tier === "pro"
                    ? tr(lang, "You're at the top tier with full access.", "אתם בדרגה הגבוהה ביותר עם גישה מלאה.")
                    : tr(lang, "Reach the Pro badge by upgrading to Pro.", "הגיעו לתג Pro על ידי שדרוג ל-Pro.")}
                </p>
                {badgeRes.tier !== "pro" && (
                  <button onClick={() => finish("/plans")} style={{ ...linkBtn, color: C.gold, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Crown size={14} /> {tr(lang, "Go Pro for the top badge", "שדרגו ל-Pro לתג העליון")}
                  </button>
                )}
                <div><button onClick={() => finish()} style={primaryBtn}><Check size={16} /> {tr(lang, "Enter the app", "כניסה לאפליקציה")}</button></div>
              </div>
            );
          }
          // Not earned — tell them exactly what's missing (no connection = no badge).
          return (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 96, height: 96, borderRadius: "50%", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(247,147,26,0.12)" }}>
                <Lock size={40} color={C.gold} />
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 6px" }}>{tr(lang, "Almost there", "כמעט שם")}</h1>
              <p style={{ color: C.muted, fontSize: 13.5, margin: "0 0 18px", lineHeight: 1.55, maxWidth: 360, marginInline: "auto" }}>
                {tr(lang, "Connect an exchange to earn your badge. No badge is issued until every step is done and an exchange is connected.",
                       "חברו בורסה כדי לקבל את התג. לא מונפק תג עד שכל השלבים הושלמו ובורסה מחוברת.")}
              </p>
              <button onClick={() => finish("/exchange")} style={primaryBtn}>
                <Link2 size={16} /> {tr(lang, "Connect an exchange", "חברו בורסה")}
              </button>
              <div><button onClick={() => finish()} style={linkBtn}>{tr(lang, "Maybe later", "אולי אחר כך")}</button></div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ProGreeting({ name, completed, planLabel, admin, onEnter, onStart }: { name: string; completed: boolean; planLabel: string; admin: boolean; onEnter: () => void; onStart: () => void }) {
  const { lang, rtl, setLang } = useI18n();
  const [leaving, setLeaving] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const persist = () => { if (dontShow) { try { localStorage.setItem("algo770_hide_onboarding", "1"); } catch (_e) { /* */ } } };
  const doEnter = () => { persist(); onEnter(); };
  const doStart = () => { persist(); onStart(); };
  const go = (fn: () => void) => { setLeaving(true); setTimeout(fn, 420); };
  // Finished users auto-dismiss after 7s so it can never block; new users choose.
  useEffect(() => { if (!completed) return; const t = setTimeout(() => go(doEnter), 7000); return () => clearTimeout(t); }, [completed]);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const badge = admin ? tr(lang, "Administrator", "מנהל מערכת") : (completed ? planLabel : tr(lang, "Get started", "בואו נתחיל"));
  const hi = name ? (lang === "he" ? `שלום, ${name}` : `Hi, ${name}`) : tr(lang, "Welcome", "ברוכים הבאים");
  const sub = completed
    ? tr(lang, "Everything's ready — jump back in. 💎", "הכול מוכן — בחזרה לעבודה. 💎")
    : tr(lang, "Let's tune the app to you in 5 quick questions.", "נתאים את האפליקציה אליכם ב-5 שאלות קצרות.");
  const R = 86, CIRC = 2 * Math.PI * R;
  return (
    <div onClick={() => go(doEnter)} style={{ position: "fixed", inset: 0, zIndex: 1000, direction: rtl ? "rtl" : "ltr", fontFamily: UI, cursor: "pointer",
      background: `radial-gradient(1100px 700px at 50% -10%, ${C.surface}, ${C.bg} 62%)`, color: C.text,
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: leaving ? "obOut .45s ease forwards" : "obIn .45s ease" }}>
      <style>{`
        @keyframes obIn{from{opacity:0}to{opacity:1}}
        @keyframes obOut{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-26px)}}
        @keyframes obFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
        @keyframes obRise{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes obSpin{to{transform:rotate(360deg)}}
        @keyframes obSweep{0%{stroke-dashoffset:${CIRC}}50%{stroke-dashoffset:${CIRC * 0.12}}100%{stroke-dashoffset:${CIRC}}}
        @keyframes obPulse{0%,100%{opacity:.55}50%{opacity:1}}
      `}</style>

      {/* language + exit */}
      <button onClick={(e) => { stop(e); setLang(lang === "he" ? "en" : "he"); }} aria-label="lang"
        style={{ position: "fixed", top: 16, insetInlineStart: 16, zIndex: 2, display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2, border: `1px solid ${C.line}`, color: C.gold, borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: UI }}>
        <Globe size={13} /> {lang === "he" ? "EN" : "עברית"}
      </button>
      <button onClick={(e) => { stop(e); go(doEnter); }} aria-label="close"
        style={{ position: "fixed", top: 16, insetInlineEnd: 16, zIndex: 2, width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer" }}>
        <X size={16} />
      </button>

      <div onClick={stop} style={{ textAlign: "center", cursor: "default", animation: "obRise .55s cubic-bezier(0.22,0.61,0.36,1)" }}>
        <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto 10px" }}>
          <svg viewBox="0 0 200 200" width="200" height="200" style={{ transform: "rotate(-90deg)", animation: "obSpin 9s linear infinite" }}>
            <circle cx="100" cy="100" r={R} fill="none" stroke={C.line} strokeWidth="10" />
            <circle cx="100" cy="100" r={R} fill="none" stroke="url(#pg)" strokeWidth="12" strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC} style={{ animation: "obSweep 2.4s ease-in-out infinite" }} />
            <defs>
              <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#FBC02D" /><stop offset="0.55" stopColor="#F7931A" /><stop offset="1" stopColor="#7CC04E" />
              </linearGradient>
            </defs>
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <Diamond size={48} color={C.gold} fill={C.gold} style={{ filter: "drop-shadow(0 0 18px rgba(247,147,26,.7))", animation: "obFloat 2.6s ease-in-out infinite" }} />
            <div style={{ fontSize: 9.5, letterSpacing: "0.18em", color: C.muted, marginTop: 8, animation: "obPulse 1.8s ease-in-out infinite" }}>
              {tr(lang, "ALGO770", "ALGO770")}
            </div>
          </div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 12.5, marginBottom: 10 }}>
          <Sparkles size={14} /> {badge}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 4px", letterSpacing: "0.02em", color: C.text }}>{hi}</h1>
        <p style={{ color: C.muted, fontSize: 14, margin: "0 0 22px" }}>{sub}</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {completed ? (
            <button onClick={() => go(doEnter)} style={primaryBtn}>
              {tr(lang, "Enter", "כניסה")} <ArrowRight size={16} style={{ transform: rtl ? "rotate(180deg)" : "none" }} />
            </button>
          ) : (
            <>
              <button onClick={() => go(doStart)} style={primaryBtn}><Sparkles size={15} /> {tr(lang, "Let's start", "יאללה נתחיל")}</button>
              <button onClick={() => go(doEnter)} style={{ ...primaryBtn, background: "transparent", color: C.muted, border: `1px solid ${C.line}` }}>{tr(lang, "Skip", "דלג")}</button>
            </>
          )}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 18, color: C.muted, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} style={{ cursor: "pointer" }} />
          {tr(lang, "Don't show this again", "אל תציגו שוב")}
        </label>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8, margin: "8px 0", border: "none", cursor: "pointer",
  background: "var(--btn-bg)", color: "var(--btn-ink)", fontWeight: 800, fontSize: 15, borderRadius: 12, padding: "12px 28px", fontFamily: UI,
};
const optBtn: React.CSSProperties = {
  padding: "13px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface, color: C.text,
  fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: UI, transition: "transform .12s, border-color .12s",
};
const stepBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 12, border: `1px solid ${C.line}`,
  background: C.surface, cursor: "pointer", fontFamily: UI, width: "100%", textAlign: "inherit" as any,
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: C.muted, fontSize: 12.5, cursor: "pointer", fontFamily: UI, marginTop: 10,
};
const ctrlBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, background: C.surface2,
  border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "6px 11px",
  fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: UI,
};
