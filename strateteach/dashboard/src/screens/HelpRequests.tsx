import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";

// Admin dashboard of strategy help requests: see the user's code, reply, they get notified.
export default function HelpRequests() {
  const { lang } = useI18n();
  const TT = (en: string, he: string) => (lang === "he" ? he : en);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["helpRequests"], queryFn: () => api.listHelp(), refetchInterval: 20000 });
  const reqs = (q.data || []) as any[];
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const answerM = useMutation({
    mutationFn: (v: { id: number; answer: string }) => api.answerHelp(v.id, v.answer),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["helpRequests"] }),
  });
  const open = reqs.filter((r) => r.status !== "answered").length;
  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 12 };

  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 3 }}>{TT("Strategy help requests", "בקשות עזרה לאסטרטגיות")} {open > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--btn-ink)", background: "var(--btn-bg)", borderRadius: 999, padding: "1px 8px", marginInlineStart: 6 }}>{open} {TT("open", "פתוחות")}</span>}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>{TT("Users send their code here. Reply with the fix and they get notified + see it in their Strategy Lab.", "משתמשים שולחים קוד. ענו עם התיקון והם יקבלו התראה ויראו זאת במעבדה.")}</div>
      {q.isLoading ? <div style={{ color: C.muted }}><Loader2 size={16} className="spin" /></div>
        : reqs.length === 0 ? <div style={{ color: C.muted, fontSize: 13 }}>{TT("No requests yet.", "אין בקשות עדיין.")}</div>
        : reqs.map((r) => (
          <div key={r.id} style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontWeight: 700 }}>{r.username} <span style={{ fontSize: 11, color: C.faint }}>· {r.created_at ? new Date(r.created_at).toLocaleString() : ""}</span></span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: r.status === "answered" ? C.gain : C.gold, border: `1px solid ${r.status === "answered" ? C.gain : C.goldDim}`, borderRadius: 7, padding: "1px 8px" }}>{r.status}</span>
            </div>
            {r.message && <div style={{ fontSize: 13, color: C.text, marginTop: 6 }}>{r.message}</div>}
            {r.source && <pre style={{ marginTop: 8, maxHeight: 200, overflow: "auto", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, fontFamily: MONO, fontSize: 11.5, color: C.muted, whiteSpace: "pre-wrap", direction: "ltr" }}>{r.source}</pre>}
            {r.answer ? (
              <div style={{ marginTop: 8, fontSize: 12.5, color: C.muted, whiteSpace: "pre-wrap", borderTop: `1px solid ${C.line}`, paddingTop: 8 }}><b style={{ color: C.gain }}>{TT("Your answer:", "התשובה שלכם:")}</b> {r.answer}</div>
            ) : (
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                <textarea value={answers[r.id] || ""} onChange={(e) => setAnswers((p) => ({ ...p, [r.id]: e.target.value }))} placeholder={TT("Write the fixed code / answer…", "כתבו את הקוד המתוקן / תשובה…")} style={{ flex: 1, minWidth: 220, minHeight: 72, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.text, fontFamily: MONO, fontSize: 12, padding: 9, resize: "vertical", direction: "ltr" }} />
                <button onClick={() => answerM.mutate({ id: r.id, answer: answers[r.id] || "" })} disabled={!((answers[r.id] || "").trim()) || answerM.isPending} className="gbtn" style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 9, padding: "9px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}>{answerM.isPending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {TT("Send answer", "שלח תשובה")}</button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
