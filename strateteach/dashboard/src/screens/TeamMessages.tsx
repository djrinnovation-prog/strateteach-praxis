import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, ChevronDown } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C, UI } from "../theme";
import FramedTitle from "../components/FramedTitle";
import ScreenBottom from "../components/ScreenBottom";
import TeamMessage from "../components/TeamMessage";

type Msg = { id: number; sender: string; title: string | null; body: string; createdAt: string; read: boolean };

// User inbox: lists messages from the team (newest first), an unread dot per row.
// Tapping a row expands the full branded document (same <TeamMessage /> the admin
// previewed) and marks it read.
export default function TeamMessages() {
  const { lang } = useI18n();
  const rtl = lang === "he";
  const qc = useQueryClient();
  const msgsQ = useQuery({ queryKey: ["myMessages"], queryFn: () => api.myMessages(), refetchInterval: 30000 });
  const messages: Msg[] = (msgsQ.data as any)?.messages || [];
  const [openId, setOpenId] = useState<number | null>(null);

  const open = async (m: Msg) => {
    const next = openId === m.id ? null : m.id;
    setOpenId(next);
    if (next != null && !m.read) {
      try {
        await api.markMessageRead(m.id);
        qc.invalidateQueries({ queryKey: ["myMessages"] });
        qc.invalidateQueries({ queryKey: ["myMessagesUnread"] });
      } catch { /* keep it open even if the read-mark fails */ }
    }
  };

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleString(rtl ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <FramedTitle text={rtl ? "הודעות מהצוות" : "Messages from the team"}
        subtitle={rtl ? "תשובות והודעות אישיות מצוות Strateteach" : "Replies & personal notes from the Strateteach team"} />

      {msgsQ.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "24px 0", textAlign: "center" }}>{rtl ? "טוען…" : "Loading…"}</div>
      ) : messages.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 32, textAlign: "center", color: C.muted }}>
          <Mail size={20} style={{ marginBottom: 8, opacity: 0.7 }} />
          <div style={{ fontSize: 14 }}>{rtl ? "אין הודעות עדיין." : "No messages yet."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m) => {
            const isOpen = openId === m.id;
            return (
              <div key={m.id} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                <button onClick={() => open(m)} className="tap44"
                  style={{ width: "100%", boxSizing: "border-box", minHeight: 44, display: "flex", alignItems: "center", gap: 10,
                    textAlign: "start", cursor: "pointer", background: "transparent", border: "none", padding: "12px 14px", fontFamily: "inherit", color: C.text }}>
                  {!m.read && <span aria-label="unread" style={{ width: 9, height: 9, borderRadius: "50%", background: C.gold, flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: m.read ? 600 : 800, color: C.text,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {m.title || (rtl ? "(ללא כותרת)" : "(no title)")}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 2 }}>{fmtDate(m.createdAt)}</span>
                  </span>
                  <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                </button>
                {isOpen && (
                  <div style={{ padding: "0 12px 12px" }}>
                    <TeamMessage title={m.title} body={m.body} sender={m.sender} date={m.createdAt} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}
