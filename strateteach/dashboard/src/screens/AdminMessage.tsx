import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Eye, EyeOff, Check } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { btn, errBox } from "../ui";
import TeamMessage from "../components/TeamMessage";

// Admin composer: pick a user, write a title + body, PREVIEW the exact branded
// document the user will receive, then Send. Available to ALL admins. The preview
// uses the SAME <TeamMessage /> the inbox renders, so the preview is faithful.
export default function AdminMessage() {
  const { lang } = useI18n();
  const rtl = lang === "he";
  // Reuse the admin users list the app already loads (no new endpoint invented).
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.listUsers() });
  const users: { username: string; role: string }[] = (usersQ.data as any[]) || [];

  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const canSend = !!to && body.trim().length > 0 && !busy;

  const send = async () => {
    if (!canSend) return;
    setBusy(true); setErr(""); setOk("");
    try {
      await api.sendAdminMessage(to, title.trim(), body);
      setOk(lang === "he" ? "נשלח ✓" : "Sent ✓");
      setTitle(""); setBody(""); setPreview(false);
    } catch (e: any) {
      setErr(e?.message || (lang === "he" ? "השליחה נכשלה" : "Send failed"));
    } finally { setBusy(false); }
  };

  const lbl = { fontSize: 11, color: C.muted, marginBottom: 4 } as React.CSSProperties;
  const inp = { width: "100%", boxSizing: "border-box", minHeight: 44, background: C.surface2, border: `1px solid ${C.line}`,
    borderRadius: 9, padding: "10px 12px", color: C.text, fontFamily: "inherit", fontSize: 14 } as React.CSSProperties;

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ fontFamily: "inherit" }}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14, lineHeight: 1.5 }}>
        {rtl ? "כתוב מענה אישי למשתמש. ההודעה נשמרת ומופיעה אצלו ב\"הודעות מהצוות\"."
             : "Write a personal reply to a user. The message is stored and appears in their \"Messages from the team\" inbox."}
      </div>

      {err && <div style={errBox}>{err}</div>}
      {ok && <div style={{ background: "rgba(22,199,126,0.12)", border: `1px solid ${C.gain}`, color: C.gain, borderRadius: 9, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}>{ok}</div>}

      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>{rtl ? "נמען" : "Recipient"}</div>
        <select value={to} onChange={(e) => setTo(e.target.value)} style={inp}>
          <option value="">{usersQ.isLoading ? (rtl ? "טוען משתמשים…" : "Loading users…") : (rtl ? "בחר משתמש…" : "Choose a user…")}</option>
          {users.map((u) => (
            <option key={u.username} value={u.username}>{u.username}{u.role === "admin" ? " · admin" : ""}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={lbl}>{rtl ? "כותרת (אופציונלי)" : "Title (optional)"}</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={rtl ? "נושא ההודעה" : "Message subject"} style={inp} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={lbl}>{rtl ? "תוכן ההודעה" : "Message body"}</div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6}
          placeholder={rtl ? "כתוב את ההודעה כאן…" : "Write your message here…"}
          style={{ ...inp, minHeight: 120, resize: "vertical", lineHeight: 1.5 }} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: preview ? 14 : 0 }}>
        <button onClick={() => setPreview((p) => !p)} className="tap44" style={{ ...btn(false), minHeight: 44 }}>
          {preview ? <EyeOff size={15} /> : <Eye size={15} />} {preview ? (rtl ? "הסתר תצוגה" : "Hide preview") : (rtl ? "תצוגה מקדימה" : "Preview")}
        </button>
        <button onClick={send} disabled={!canSend} className="gbtn ptile tap44"
          style={{ ...btn(true), minHeight: 44, opacity: canSend ? 1 : 0.5, cursor: canSend ? "pointer" : "default" }}>
          {busy ? <Check size={15} /> : <Send size={15} />} {busy ? (rtl ? "שולח…" : "Sending…") : (rtl ? "שלח" : "Send")}
        </button>
      </div>

      {preview && (
        <div>
          <div style={{ ...lbl, marginBottom: 8 }}>{rtl ? "כך זה ייראה אצל המשתמש:" : "This is what the user will see:"}</div>
          <TeamMessage title={title.trim()} body={body} />
        </div>
      )}
    </div>
  );
}
