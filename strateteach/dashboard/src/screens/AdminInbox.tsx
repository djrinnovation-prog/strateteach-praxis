import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, ArrowLeft, ArrowRight, Loader2, MessageCircle, Mail, RefreshCw, Inbox } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";
import { btn, errBox } from "../ui";
import type { AdminInboxThread, AdminInboxItem } from "../lib/client";

// Admin "Reply to users" inbox — aggregates inbound user DMs + Service-Hub feedback,
// grouped by user (needs-reply first). Open a thread → see the merged conversation →
// reply inline (reuses chat_send: admin → user). Bilingual, skin + glass.
export default function AdminInbox() {
  const { lang } = useI18n();
  const he = lang === "he";
  const rtl = he;
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");

  const inboxQ = useQuery({ queryKey: ["adminInbox"], queryFn: () => api.adminInbox(), refetchInterval: 30000 });
  const threadQ = useQuery({ queryKey: ["adminInboxThread", sel], queryFn: () => api.adminInboxThread(sel as string), enabled: !!sel });

  const reply = useMutation({
    mutationFn: () => api.adminInboxReply(sel as string, text.trim()),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: ["adminInboxThread", sel] }); qc.invalidateQueries({ queryKey: ["adminInbox"] }); },
  });

  const fmt = (ts?: string | null) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(he ? "he-IL" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  };

  const lbl: React.CSSProperties = { fontSize: 11, color: C.muted, marginBottom: 4 };
  const card: React.CSSProperties = { background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px" };

  // ── Thread view (a user selected) ──
  if (sel) {
    const data = threadQ.data;
    const items = (data?.items || []) as AdminInboxItem[];
    const Back = rtl ? ArrowRight : ArrowLeft;
    return (
      <div dir={rtl ? "rtl" : "ltr"} style={{ fontFamily: "inherit" }}>
        <button onClick={() => { setSel(null); setText(""); }} className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, background: C.surface2, border: `1px solid ${C.line}`,
            color: C.text, borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", marginBottom: 12 }}>
          <Back size={15} color={C.gold} /> {he ? "חזרה לרשימה" : "Back to inbox"}
        </button>

        <div style={{ fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 12 }}>
          {data?.displayName || sel}
        </div>

        {threadQ.isLoading ? (
          <div style={{ display: "grid", placeItems: "center", padding: 30 }}><Loader2 size={20} className="spin" color={C.gold} /></div>
        ) : items.length === 0 ? (
          <div style={{ ...card, color: C.muted, fontSize: 13 }}>{he ? "אין הודעות עדיין." : "No messages yet."}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {items.map((m, i) => {
              const mine = !m.fromUser;                         // admin/support side
              const bg = mine ? C.glassTint : C.surface2;
              const border = mine ? `1px solid ${C.gold}66` : `1px solid ${C.line}`;
              return (
                <div key={i} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                  <div style={{ maxWidth: "82%", background: bg, border, borderRadius: 12, padding: "9px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: mine ? C.gold : C.muted }}>{m.author || (m.fromUser ? (data?.displayName || sel) : (he ? "צוות" : "Team"))}</span>
                      {m.source === "feedback" && <span style={{ fontSize: 8.5, fontWeight: 800, color: C.blue, border: `1px solid ${C.blue}66`, borderRadius: 4, padding: "0 4px" }}>{he ? "פידבק" : "FEEDBACK"}</span>}
                      <span style={{ marginInlineStart: "auto", fontSize: 9.5, color: C.faint }}>{fmt(m.ts)}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {reply.isError && <div style={errBox}>{(reply.error as any)?.message || (he ? "השליחה נכשלה" : "Reply failed")}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} dir={rtl ? "rtl" : "ltr"}
            placeholder={he ? "כתוב תשובה למשתמש…" : "Write a reply to the user…"}
            style={{ flex: 1, minWidth: 200, boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`,
              borderRadius: 10, padding: "10px 12px", color: C.text, fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, resize: "vertical" }} />
          <button onClick={() => reply.mutate()} disabled={!text.trim() || reply.isPending} className="tap44"
            style={{ ...btn(true), minHeight: 44, opacity: !text.trim() || reply.isPending ? 0.5 : 1, cursor: !text.trim() || reply.isPending ? "default" : "pointer" }}>
            {reply.isPending ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {he ? "שלח" : "Send"}
          </button>
        </div>
        <div style={{ fontSize: 11, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
          {he ? "התשובה נשלחת כהודעה ישירה (DM) ומגיעה למשתמש באפליקציה ובערוצי ההתראה שלו." : "The reply is sent as a direct message (DM) — the user gets it in-app and on their notification channels."}
        </div>
      </div>
    );
  }

  // ── Inbox list ──
  const threads = (inboxQ.data?.threads || []) as AdminInboxThread[];
  const needs = inboxQ.data?.needsReplyCount || 0;
  const Fwd = rtl ? ArrowLeft : ArrowRight;
  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, flex: 1, minWidth: 160 }}>
          {he ? "הודעות ופניות שהגיעו ממשתמשים — הודעות ישירות ופידבק מ-Service Hub. לחצו על משתמש כדי להשיב." : "Messages + feedback that came in from users — direct messages and Service-Hub feedback. Tap a user to reply."}
        </div>
        <button onClick={() => inboxQ.refetch()} className="tap44"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.surface2, border: `1px solid ${C.line}`,
            color: C.text, borderRadius: 10, padding: "7px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          <RefreshCw size={13} color={C.gold} /> {he ? "רענן" : "Refresh"}
        </button>
      </div>

      {needs > 0 && (
        <div style={{ ...card, background: `${C.gold}14`, border: `1px solid ${C.gold}66`, color: C.text, fontSize: 12.5, fontWeight: 800, marginBottom: 12 }}>
          {he ? `${needs} ממתינים לתשובה` : `${needs} awaiting your reply`}
        </div>
      )}

      {inboxQ.isLoading ? (
        <div style={{ display: "grid", placeItems: "center", padding: 30 }}><Loader2 size={20} className="spin" color={C.gold} /></div>
      ) : threads.length === 0 ? (
        <div style={{ ...card, color: C.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 9 }}>
          <Inbox size={16} color={C.gold} /> {he ? "אין פניות פתוחות — התיבה ריקה." : "No inbound messages — the inbox is empty."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {threads.map((t) => (
            <button key={t.userId} onClick={() => setSel(t.userId)} className="tap44"
              style={{ ...card, cursor: "pointer", textAlign: rtl ? "right" : "left", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                borderColor: t.needsReply ? `${C.gold}66` : C.line }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 900, color: C.text }}>{t.displayName || t.userId}</span>
                  {t.sources.includes("chat") && <MessageCircle size={12} color={C.muted} />}
                  {t.sources.includes("feedback") && <Mail size={12} color={C.blue} />}
                  {t.needsReply && <span style={{ fontSize: 9.5, fontWeight: 800, color: C.gold, background: `${C.gold}1f`, border: `1px solid ${C.gold}66`, borderRadius: 999, padding: "1px 7px" }}>{he ? "צריך תשובה" : "needs reply"}</span>}
                  <span style={{ marginInlineStart: "auto", fontSize: 10, color: C.faint }}>{fmt(t.latestTs)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.snippet}</div>
              </div>
              <Fwd size={15} color={C.gold} style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
