import React, { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Trophy, RefreshCw, Send, Loader2, Check, Info } from "lucide-react";
import { api } from "../app/api";
import { type LeaderRow } from "../lib/client";
import { useI18n } from "../i18n";
import { C, UI, MONO, SHADOW } from "../theme";
import { premSoft, SimBadge } from "../ui";

// Admin "Demo leaderboard" — ranks demo testers by their demo P&L and lets the
// admin blast it to everyone (to spark usage + feedback) through the EXISTING
// broadcast plumbing: in-app chat broadcast (chatSend → to:null) and the optional
// SMS/WhatsApp blast (api.broadcast). Nothing auto-sends; the admin reviews the
// message and taps Send. Rendered as a child inside the Admin hub's panel.
export default function DemoLeaderboard() {
  const { lang } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const q = useQuery({ queryKey: ["demoLeaderboard"], queryFn: () => api.demoLeaderboard() });
  const rows: LeaderRow[] = (q.data as any)?.rows || [];
  // The exact text the broadcast will send (built on the server: rank + score for
  // everyone, profit $ for the top 10, + the incentive note). Used to prefill the
  // editor so the manual send matches the daily 18:00 auto-send and the score
  // always appears in the message.
  const msgQ = useQuery({ queryKey: ["demoLeaderboardMessage"], queryFn: () => api.leaderboardMessage() });

  // Broadcast composer
  const [msg, setMsg] = useState("");
  const [touched, setTouched] = useState(false);   // don't clobber the admin's edits on refetch
  const [inApp, setInApp] = useState(true);
  const [doSms, setDoSms] = useState(false);
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [flash, setFlash] = useState<string | null>(null);

  // Refresh: explicitly refetch BOTH the leaderboard and its broadcast message and
  // drive a visible busy state. (The old handler fired invalidateQueries with no
  // visual feedback — and on this screen the spinner couldn't even animate, since
  // the `.spin` keyframe is injected per-screen and isn't present here — so clicks
  // looked like no-ops.)
  const [refreshing, setRefreshing] = useState(false);
  const busy = refreshing || q.isFetching || msgQ.isFetching;
  const onRefresh = async () => {
    setRefreshing(true);
    try { await Promise.all([q.refetch(), msgQ.refetch()]); }
    finally { setRefreshing(false); }
  };

  // Pretty tenure: "today" / "3 days" / "2 weeks" / "5 months" / "1 year".
  const tenure = (d: number | null): string => {
    if (d == null) return "—";
    if (d <= 0) return TT("today", "היום");
    if (d < 7) return d === 1 ? TT("1 day", "יום") : TT(`${d} days`, `${d} ימים`);
    if (d < 30) { const w = Math.round(d / 7); return w === 1 ? TT("1 week", "שבוע") : TT(`${w} weeks`, `${w} שבועות`); }
    if (d < 365) { const m = Math.round(d / 30); return m === 1 ? TT("1 month", "חודש") : TT(`${m} months`, `${m} חודשים`); }
    const y = Math.round(d / 365); return y === 1 ? TT("1 year", "שנה") : TT(`${y} years`, `${y} שנים`);
  };
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`);
  const pct = (p: number) => `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
  const usd = (v: number) => `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const col = (v: number) => (v > 0 ? C.gain : v < 0 ? C.loss : C.muted);

  // Prefill the editor from the server-built message (until the admin edits it).
  useEffect(() => {
    const text = (msgQ.data as any)?.text;
    if (!touched && text) setMsg(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgQ.data]);

  const sendM = useMutation({
    mutationFn: async () => {
      const out: string[] = [];
      if (inApp) { await api.chatSend(null, msg); out.push(TT("in-app (all users)", "באפליקציה (כל המשתמשים)")); }
      if (doSms) { const r = await api.broadcast(msg, channel, "all"); out.push(`${channel.toUpperCase()} ${r.sent}/${r.total}`); }
      return out;
    },
    onSuccess: (out) => { setFlash(TT(`Sent → ${out.join(" · ")}`, `נשלח → ${out.join(" · ")}`)); setTimeout(() => setFlash(null), 6000); },
  });

  const canSend = msg.trim().length > 0 && (inApp || doSms) && !sendM.isPending;

  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 5, display: "block" };
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 9, color: C.text, fontSize: 13.5, padding: "10px 12px", fontFamily: UI };

  return (
    <div style={{ fontFamily: UI, maxWidth: 680 }}>
      <style>{".spin{animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Trophy size={17} color={C.gold} />
        <div style={{ fontSize: 15, fontWeight: 800 }}>{TT("Demo leaderboard", "לוח תוצאות דמו")}</div>
        <SimBadge />
        <button onClick={onRefresh} disabled={busy}
          title={TT("Refresh", "רענן")} style={{ ...premSoft(), marginInlineStart: "auto", display: "inline-flex", alignItems: "center", gap: 6, color: C.text, padding: "7px 13px", fontSize: 12, fontFamily: UI, whiteSpace: "nowrap", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          <RefreshCw size={13} className={busy ? "spin" : undefined} /> {busy ? TT("Refreshing…", "מרענן…") : TT("Refresh", "רענן")}
        </button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
        {TT("Every demo tester, ranked by a gamified score (0–1000, always positive) from their demo activity, win-rate and profit. Sent in-app to everyone daily at 18:00 (Israel); you can also send it now.",
            "כל בודקי הדמו, מדורגים לפי ניקוד מגיים-פייד (0–1000, תמיד חיובי) שנגזר מהפעילות, אחוז ההצלחות והרווח בדמו. נשלח באפליקציה לכולם כל יום ב-18:00 (שעון ישראל); אפשר גם לשלוח עכשיו.")}
      </div>

      {/* the leaderboard */}
      {q.isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 13, padding: "20px 0" }}>
          <Loader2 size={15} className="spin" /> {TT("Loading…", "טוען…")}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: C.surface2, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 22, textAlign: "center", color: C.muted, fontSize: 13 }}>
          {TT("No demo testers yet.", "אין עדיין בודקי דמו.")}
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 16, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.16), ${SHADOW}` }}>
          {rows.map((r, i) => (
            <div key={r.username} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderBottom: i < rows.length - 1 ? `1px solid ${C.line}` : "none",
              background: i % 2 ? "transparent" : C.surface2,
              ...(i < 3 ? { boxShadow: `inset 3px 0 0 ${C.gold}` } : null) }}>
              {/* rank */}
              <div style={{ width: 30, flexShrink: 0, textAlign: "center", fontSize: i < 3 ? 18 : 12.5, fontWeight: 800, color: i < 3 ? C.text : C.muted, fontFamily: i < 3 ? UI : MONO }}>
                {medal(i)}
              </div>
              {/* name + tenure */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                <div style={{ fontSize: 11, color: C.faint, fontWeight: 600 }}>{TT("registered", "רשום")} {tenure(r.tenureDays)}</div>
              </div>
              {/* score — the headline metric the ranking is based on */}
              <div style={{ flexShrink: 0, textAlign: "center", minWidth: 52 }}>
                <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 900, color: C.gold, lineHeight: 1 }}>{r.score}</div>
                <div style={{ fontSize: 8.5, color: C.faint, fontWeight: 700, letterSpacing: "0.04em" }}>{TT("PTS", "נק׳")}</div>
              </div>
              {/* result (admin sees everything, incl. P&L) */}
              <div style={{ textAlign: lang === "he" ? "left" : "right", flexShrink: 0, minWidth: 70 }}>
                <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: col(r.pnlPct) }}>{pct(r.pnlPct)}</div>
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted }}>
                  {usd(r.pnl)} · {r.trades}{TT("t", "ע")}{r.winRate != null ? ` · ${r.winRate}%` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* privacy note */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: `${C.gold}14`, border: `1px solid ${C.gold}55`, borderRadius: 10, padding: "9px 11px", marginBottom: 16, fontSize: 11.5, color: C.text }}>
        <Info size={14} color={C.gold} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{TT("Privacy: sending exposes each tester's username + results to all users. Decide if you want it anonymised before sending.",
                   "פרטיות: השליחה חושפת לכל המשתמשים את שם המשתמש והתוצאות של כל בודק. החליטו אם לאנונימיזציה לפני השליחה.")}</span>
      </div>

      {/* ── Send to all users ─────────────────────────────────────────── */}
      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, marginBottom: 8 }}>{TT("Send to all users", "שלח לכל המשתמשים")}</div>

      <label style={lbl}>{TT("Message (review & edit before sending)", "הודעה (סקור וערוך לפני שליחה)")}</label>
      <textarea value={msg} onChange={(e) => { setMsg(e.target.value); setTouched(true); }} rows={8}
        style={{ ...inp, marginBottom: 12, resize: "vertical", whiteSpace: "pre-wrap", lineHeight: 1.5 }} />

      {/* channels */}
      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9, cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.text }}>
        <input type="checkbox" checked={inApp} onChange={(e) => setInApp(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.gold }} />
        {TT("In-app broadcast (every user sees it in chat)", "שידור באפליקציה (כל משתמש רואה בצ'אט)")}
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14, cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.text }}>
        <input type="checkbox" checked={doSms} onChange={(e) => setDoSms(e.target.checked)} style={{ width: 17, height: 17, accentColor: C.gold }} />
        <Send size={14} color={C.gold} /> {TT("Also blast SMS / WhatsApp to all users", "גם שלח SMS / וואטסאפ לכל המשתמשים")}
        {doSms && (
          <select value={channel} onChange={(e) => setChannel(e.target.value as any)} style={{ marginInlineStart: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 7, color: C.text, fontSize: 12, padding: "4px 8px" }}>
            <option value="sms">SMS</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        )}
      </label>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => sendM.mutate()} disabled={!canSend}
          className="gbtn ptile" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 18px", fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", cursor: canSend ? "pointer" : "default", fontFamily: UI, opacity: canSend ? 1 : 0.5 }}>
          {sendM.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
          {TT("Send to all users", "שלח לכל המשתמשים")}
        </button>
        {flash && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: C.gain, fontSize: 13, fontWeight: 700 }}><Check size={14} /> {flash}</span>}
        {sendM.isError && <span style={{ color: C.loss, fontSize: 12.5 }}>{String((sendM.error as any)?.message || "Error")}</span>}
      </div>
    </div>
  );
}
