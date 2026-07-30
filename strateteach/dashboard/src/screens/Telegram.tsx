import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Send, Radar, Link2Off, ShieldCheck, BellRing, Check, Diamond } from "lucide-react";
import { api, isAdmin } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { Card, Field, input, premSoft, errBox, okBox, Spin } from "../ui";
import { EXPLAIN } from "../lib/explain";
import TourLauncher from "../components/TourLauncher";
import { ScreenHeader } from "../components/ScreenHeader";
import HomeTop from "../components/HomeTop";

// Telegram bot wiring: token + chat, notify toggles, detect chats, send a test push.
const GUIDE = {
  he: { title: "איך מחברים — 3 צעדים", steps: [
    "פתחו צ׳אט עם @BotFather בטלגרם, שלחו /newbot ובחרו שם — תקבלו טוקן בוט. הדביקו אותו למטה.",
    "פתחו צ׳אט עם הבוט שלכם ולחצו Start (או הוסיפו אותו לקבוצה), ואז לחצו ‚זהה צ׳אטים’ כדי למלא את מזהה הצ׳אט אוטומטית.",
    "לחצו ‚שמור’ ואז ‚שלח בדיקה’ — אם הגיעה הודעה, אתם מחוברים.",
  ] },
  en: { title: "How to connect — 3 steps", steps: [
    "In Telegram open a chat with @BotFather, send /newbot and pick a name — you'll get a bot token. Paste it below.",
    "Open a chat with your bot and tap Start (or add it to a group), then click 'Detect chats' to fill the Chat ID automatically.",
    "Click 'Save', then 'Send test' — if a message arrives, you're connected.",
  ] },
};

const ADMIN = {
  he: {
    adminTitle: "ניהול מנהל",
    connected: "מחובר",
    notConnected: "לא מחובר",
    approvalsOn: "אישורי מנהל פעילים",
    approvalsOff: "אישורי מנהל כבויים",
    disconnect: "נתק בוט",
    confirmDisc: "לנתק את הבוט? הטוקן והצ׳אט יימחקו ותצטרכו לחבר מחדש.",
    enableApprovals: "הפעל אישורי מנהל",
    disableApprovals: "כבה אישורים (נתק)",
    approvalsHelp: "כשפעיל — כל בקשת גישה חדשה מגיעה לטלגרם עם כפתורי אישור/דחייה, כך שתוכלו לנהל מהנייד בזמן שאתם בחוץ.",
    reconnect: "כדי לחבר בוט אחר — נתקו ואז הדביקו טוקן חדש למעלה.",
  },
  en: {
    adminTitle: "Admin controls",
    connected: "Connected",
    notConnected: "Not connected",
    approvalsOn: "Admin approvals active",
    approvalsOff: "Admin approvals off",
    disconnect: "Disconnect bot",
    confirmDisc: "Disconnect the bot? The token and chat will be cleared and you'll need to reconnect.",
    enableApprovals: "Enable admin approvals",
    disableApprovals: "Turn off approvals (disconnect)",
    approvalsHelp: "When on, every new access request arrives in Telegram with Approve/Deny buttons, so you can manage them from your phone while you're out.",
    reconnect: "To connect a different bot — disconnect, then paste a new token above.",
  },
};

export default function Telegram() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const admin = isAdmin();
  const A = ADMIN[lang];
  const cfgQ = useQuery({ queryKey: ["telegram"], queryFn: () => api.telegramConfig() });

  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [notify, setNotify] = useState({ notifySignals: true, notifyRunFinished: true, notifyProfitEngine: true, notifyExcelDaily: false, notifyAssistant: true });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [showGuide, setShowGuide] = useState(false); // "how to connect" guide — collapsed once connected

  useEffect(() => {
    const c: any = cfgQ.data;
    if (!c) return;
    setChatId(c.chatId || "");
    setScheduleTime(c.scheduleTime || "09:00");
    setScheduleEnabled(!!c.scheduleEnabled);
    setNotify({ notifySignals: !!c.notifySignals, notifyRunFinished: !!c.notifyRunFinished, notifyProfitEngine: !!c.notifyProfitEngine, notifyExcelDaily: !!c.notifyExcelDaily, notifyAssistant: c.notifyAssistant !== false });
  }, [cfgQ.data]);

  const c: any = cfgQ.data;
  const fail = (e: any) => { setOk(""); setErr(e?.message || String(e)); };
  const done = (m: string) => { setErr(""); setOk(m); qc.invalidateQueries({ queryKey: ["telegram"] }); };

  const saveM = useMutation({
    mutationFn: () => api.saveTelegramConfig({ ...(botToken ? { botToken } : {}), chatId, scheduleTime, scheduleEnabled, ...notify }),
    onSuccess: () => { setBotToken(""); done(t.saved); }, onError: fail,
  });
  const detectM = useMutation({ mutationFn: () => api.telegramDetect(botToken), onError: fail });
  const testM = useMutation({ mutationFn: () => api.telegramTest(chatId), onSuccess: (r: any) => (r?.ok ? done(r?.message || t.saved) : fail({ message: r?.message })), onError: fail });
  const disconnectM = useMutation({ mutationFn: () => api.telegramDisconnect(), onSuccess: () => { setChatId(""); setBotToken(""); done(A.notConnected); }, onError: fail });
  const approvalsM = useMutation({ mutationFn: () => api.enableTelegramApprovals(), onSuccess: () => done(A.approvalsOn), onError: fail });

  const detected = (detectM.data as any)?.chats || (detectM.data as any)?.results || [];
  const connected = !!c?.configured;
  const approvalsOn = !!c?.approvalsEnabled;

  // The "how to connect — 3 steps" guide (for first-time setup).
  const guideEl = (
    <div style={{ background: `${C.blue}14`, border: `1px solid ${C.blue}40`, borderRadius: 12, padding: "12px 16px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.blue, marginBottom: 8 }}>{GUIDE[lang].title}</div>
      <ol style={{ margin: 0, paddingInlineStart: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {GUIDE[lang].steps.map((s, i) => <li key={i} style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6 }}>{s}</li>)}
      </ol>
    </div>
  );

  return (
    <div>
      <TourLauncher screen="telegram" />
      {/* Home-like clean top: wordmark title (this screen's name) + ONE compact
          subtitle, the SAME ScreenHeader template the other inner screens adopted. */}
      <div style={{ marginBottom: 16 }}>
        <ScreenHeader
          icon={<Diamond size={20} color={C.gold} fill={C.gold} />}
          title={t.telegram}
          info={EXPLAIN.telegram[lang]}
          subtitle={connected ? (lang === "he" ? "התראות מסחר לטלגרם · מחובר" : "Trade alerts to Telegram · connected") : (lang === "he" ? "התראות מסחר לטלגרם" : "Trade alerts to Telegram")}
        />
      </div>
      {/* P&L (תיק) card at the top — the SAME home balance card, collapsed by default. */}
      <HomeTop />
      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={okBox}>{ok}</div>}

      {/* Connection status — prominent so a connected account reads at a glance.
          Stays pinned above the scrollable config so it's never buried. */}
      <div data-tour="tg-status" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 800, maxWidth: "100%",
          padding: "8px 15px", borderRadius: 999,
          background: connected ? "var(--btn-gain-bg)" : C.surface2,
          color: connected ? "var(--btn-gain-ink)" : C.muted,
          border: connected ? "none" : `1px solid ${C.line}` }}>
          {connected ? <Check size={16} /> : <Link2Off size={15} />} {connected ? A.connected : A.notConnected}
          {connected && c?.botTokenMasked ? <span style={{ fontFamily: MONO, fontWeight: 700, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>· {c.botTokenMasked}</span> : null}
        </span>
        {admin && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700,
            padding: "6px 12px", borderRadius: 999, background: approvalsOn ? `${C.blue}1a` : C.surface2,
            color: approvalsOn ? C.blue : C.muted, border: `1px solid ${approvalsOn ? `${C.blue}55` : C.line}` }}>
            <ShieldCheck size={13} /> {approvalsOn ? A.approvalsOn : A.approvalsOff}
          </span>
        )}
      </div>

      {/* Scrollable config area — internal svh scroll so the long screen never runs
          under the mobile browser chrome (same pattern as University/Privacy). */}
      <div style={{ maxHeight: "calc(100svh - 248px)", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", paddingInlineEnd: 2, paddingBottom: 8 }}>

      {/* "How to connect" guide — shown for first-time setup; once connected it
          collapses behind a toggle (closed by default) so it doesn't bury the status. */}
      {!connected ? (
        <div style={{ marginBottom: 14 }}>{guideEl}</div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <button onClick={() => setShowGuide((v) => !v)} style={secBtn({ fontSize: 12.5, whiteSpace: "normal", textAlign: "center" })}>
            {GUIDE[lang].title} {showGuide ? "▴" : "▾"}
          </button>
          {showGuide && <div style={{ marginTop: 10 }}>{guideEl}</div>}
        </div>
      )}

      <Card title={t.connection} tour="tg-connect">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label={t.botToken}><input value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder={c?.botTokenMasked || "123456:ABC…"} style={{ ...input, fontFamily: MONO }} /></Field>
          <Field label={t.chatId}><input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-100…" style={{ ...input, fontFamily: MONO }} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={() => { setErr(""); detectM.mutate(); }} disabled={!botToken || detectM.isPending} style={secBtn()}>
            {detectM.isPending ? <Loader2 size={14} className="spin" /> : <Radar size={14} />} {t.detect}
          </button>
          {admin && connected && (
            <button onClick={() => { if (window.confirm(A.confirmDisc)) { setErr(""); disconnectM.mutate(); } }} disabled={disconnectM.isPending}
              style={secBtn({ color: C.loss, border: `1.5px solid ${C.loss}66` })}>
              {disconnectM.isPending ? <Loader2 size={14} className="spin" /> : <Link2Off size={14} />} {A.disconnect}
            </button>
          )}
        </div>
        {detected.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {detected.map((d: any, i: number) => (
              <button key={i} onClick={() => setChatId(String(d.id ?? d.chatId ?? d))} style={secBtn({ justifyContent: "space-between", fontFamily: MONO, width: "100%", whiteSpace: "normal", textAlign: "start", gap: 10 })}>
                <span>{d.title || d.name || d.username || "chat"}</span><span style={{ color: C.muted }}>{d.id ?? d.chatId ?? ""}</span>
              </button>
            ))}
          </div>
        )}
        {admin && connected && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>{A.reconnect}</div>}
      </Card>

      {admin && (
        <Card title={A.adminTitle}>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>{A.approvalsHelp}</div>
          <button onClick={() => { setErr(""); approvalsM.mutate(); }} disabled={!connected || approvalsM.isPending}
            style={secBtn()}>
            {approvalsM.isPending ? <Loader2 size={14} className="spin" /> : <BellRing size={14} />} {approvalsOn ? t.save : A.enableApprovals}
          </button>
        </Card>
      )}

      <Card title={t.settings} tour="tg-settings">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14 }}>
          {([
            ["notifySignals", t.scan], ["notifyRunFinished", t.backtests],
            ["notifyProfitEngine", t.profit], ["notifyExcelDaily", t.excel],
            ["notifyAssistant", lang === "he" ? "צ'אט והצעות (דו-כיווני)" : "Chat & suggestions (2-way)"],
          ] as const).map(([k, label]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted }}>
              <input type="checkbox" checked={(notify as any)[k]} onChange={(e) => setNotify((n) => ({ ...n, [k]: e.target.checked }))} /> {label}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.muted }}>
            <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} /> {t.scheduleTime ?? "schedule"}
          </label>
          <Field label={t.dailyTarget}><input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} style={{ ...input, width: 140 }} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={() => saveM.mutate()} disabled={saveM.isPending} className="gbtn ptile" style={primBtn}>
            {saveM.isPending ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t.save}
          </button>
          <button onClick={() => { setErr(""); testM.mutate(); }} disabled={!chatId || testM.isPending} style={secBtn()}>
            {testM.isPending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {t.testMsg}
          </button>
        </div>
        {c?.lastSentAt && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>{t.lastTest}: {new Date(c.lastSentAt).toLocaleString()} · {c.lastSendStatus}</div>}
      </Card>
      </div>
      <Spin />
    </div>
  );
}

// Premium buttons for this screen — primary = skin-accent tile (className "gbtn ptile"
// supplies fill/border/depth), secondary = the soft premium finish (premSoft).
// whiteSpace:nowrap + inline-flex centering keep EN/HE labels ("Enable admin approvals"
// / "הפעל אישורי מנהל", "Detect chats" / "זהה צ׳אטים") on one comfortably-padded line.
const primBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 16px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const secBtn = (extra?: React.CSSProperties): React.CSSProperties => ({ ...premSoft(), display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 15px", fontSize: 13, whiteSpace: "nowrap", ...extra });
