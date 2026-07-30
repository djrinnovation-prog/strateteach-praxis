import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Loader2, Trash2, Crown } from "lucide-react";
import { api } from "../app/api";
import { C } from "../theme";
import { input, btn } from "../ui";
import type { PmTaskComment } from "../lib/client";

// ── TaskComments — a task's comment thread, reused everywhere a task card is editable:
//   • the collaborator portals' Tasks tab (Portal.tsx)
//   • the Owners board + personal screens (ownersShared.tsx)
//   • the owners' embedded portal view (/owners)
// Owners give direction/feedback on ANY task (incl. Raz/Oren's); the task's assignee replies on
// their own. Owner comments are badged (crown) and also surface in the Owners Daily Report.
export default function TaskComments({ taskId, he, rtl }: { taskId: number; he: boolean; rtl: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: ["pmTaskComments", taskId], queryFn: () => api.pmTaskComments(taskId) });
  const comments = (q.data?.comments || []) as PmTaskComment[];
  const inval = () => qc.invalidateQueries({ queryKey: ["pmTaskComments", taskId] });
  const add = useMutation({ mutationFn: () => api.pmTaskAddComment(taskId, text.trim()), onSuccess: () => { setText(""); inval(); } });
  const del = useMutation({ mutationFn: (id: number) => api.pmTaskDeleteComment(taskId, id), onSuccess: inval });
  const fmt = (s: string | null) => (s ? String(s).slice(0, 16).replace("T", " ") : "");
  const submit = () => { if (text.trim() && !add.isPending) add.mutate(); };

  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 800, color: C.muted, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
        <MessageSquare size={13} color={C.gold} /> {he ? "הערות ותגובות" : "Comments & feedback"}
        {comments.length > 0 && <span style={{ color: C.faint }}>· {comments.length}</span>}
      </label>

      {q.isLoading ? (
        <div style={{ color: C.muted, fontSize: 12.5 }}><Loader2 size={13} className="spin" /></div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>{he ? "אין עדיין הערות." : "No comments yet."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 10 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ background: c.isOwner ? `${C.gold}12` : C.surface, border: `1px solid ${c.isOwner ? C.goldDim : C.line}`, borderRadius: 10, padding: "8px 11px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 800, color: c.isOwner ? C.gold : C.text }}>
                  {c.isOwner && <Crown size={12} color={C.gold} />}
                  {c.authorName}
                  {c.isOwner && <span style={{ fontSize: 9.5, fontWeight: 800, color: C.gold, background: `${C.gold}1e`, borderRadius: 6, padding: "1px 6px" }}>{he ? "בעלים" : "Owner"}</span>}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: C.faint }}>{fmt(c.createdAt)}</span>
                  {c.mine && (
                    <button onClick={() => del.mutate(c.id)} disabled={del.isPending} title={he ? "מחק" : "Delete"}
                      style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", padding: 0, display: "inline-flex" }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{c.text}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} dir={rtl ? "rtl" : "ltr"}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          placeholder={he ? "כתוב הערה / תגובה…" : "Write a comment / reply…"}
          style={{ ...input, flex: 1, minHeight: 40, lineHeight: 1.5, resize: "vertical", boxSizing: "border-box", padding: "8px 10px" }} />
        <button onClick={submit} disabled={!text.trim() || add.isPending} style={{ ...btn(true) }}>
          {add.isPending ? <Loader2 size={14} className="spin" /> : <Send size={14} />} {he ? "שלח" : "Send"}
        </button>
      </div>
    </div>
  );
}
