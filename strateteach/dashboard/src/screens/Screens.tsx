import React, { useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, X, Eye } from "lucide-react";
import { api, isAdmin } from "../app/api";
import { useI18n } from "../i18n";
import { C, SHADOW } from "../theme";
import { H1, Card, Empty, errBox, premSoft, ctrlChip } from "../ui";

const L = {
  he: { title: "מסכי משתמשים", sub: "בקש צילום מסך חי מכל משתמש", capture: "צלם מסך",
        users: "משתמשים", captures: "צילומים אחרונים", pending: "ממתין…", view: "צפה",
        none: "אין צילומים עדיין", notAdmin: "אזור מנהל בלבד", at: "ב-", route: "מסך" },
  en: { title: "User screens", sub: "Request a live screenshot from any user", capture: "Capture",
        users: "Users", captures: "Recent captures", pending: "pending…", view: "View",
        none: "No captures yet", notAdmin: "Admins only", at: "at", route: "screen" },
};

export default function Screens() {
  const { lang, rtl } = useI18n();
  const t = L[lang];
  // Rendered both as the standalone /screens route AND inside the Admin hub's panel
  // (which already shows the title). Only show our own H1 on the standalone route,
  // so it doesn't double-title under Admin.
  const embedded = useLocation().pathname !== "/screens";
  const qc = useQueryClient();
  const [err, setErr] = useState("");
  const [viewing, setViewing] = useState<any>(null);
  const admin = isAdmin();

  const contactsQ = useQuery({ queryKey: ["chatContacts"], queryFn: () => api.chatContacts(), enabled: admin });
  const capturesQ = useQuery({ queryKey: ["screenCaptures"], queryFn: () => api.screenCaptures(), refetchInterval: 5000, enabled: admin });
  const contacts: any[] = (contactsQ.data as any)?.contacts || [];
  const captures: any[] = (capturesQ.data as any)?.captures || [];

  const reqM = useMutation({
    mutationFn: (user: string) => api.screenRequest(user),
    onSuccess: () => { setErr(""); qc.invalidateQueries({ queryKey: ["screenCaptures"] }); },
    onError: (e: any) => setErr(e?.message || String(e)),
  });

  const open = async (id: number) => {
    try { const cap = await api.screenCapture(id); setViewing(cap); } catch (e: any) { setErr(e?.message || String(e)); }
  };

  if (!admin) return <Empty>{t.notAdmin}</Empty>;

  return (
    <div>
      {!embedded && <H1 right={<span style={{ fontSize: 12, color: C.muted }}>{t.sub}</span>}>{t.title}</H1>}
      {err && <div style={errBox}>{err}</div>}

      <Card title={t.users}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {contacts.filter((c) => !c.isMe).map((c) => (
            <button key={c.username} onClick={() => reqM.mutate(c.username)} disabled={reqM.isPending}
              style={{ ...premSoft(), color: C.text, display: "inline-flex", alignItems: "center", gap: 7,
                padding: "8px 14px", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap",
                opacity: reqM.isPending ? 0.6 : 1 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: c.online ? C.gain : C.faint }} />
              {c.nickname} <Camera size={13} color={C.gold} />
            </button>
          ))}
          {contacts.filter((c) => !c.isMe).length === 0 && <span style={{ color: C.muted, fontSize: 13 }}>—</span>}
        </div>
      </Card>

      <div style={{ height: 12 }} />
      <Card title={t.captures}>
        {captures.length === 0 ? <Empty>{t.none}</Empty> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 10 }}>
            {captures.map((c) => (
              <button key={c.id} onClick={() => c.status === "captured" && open(c.id)}
                style={{ textAlign: "start", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, cursor: c.status === "captured" ? "pointer" : "default", fontFamily: "inherit", color: C.text, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.22), ${SHADOW}` }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{c.target_user}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.route || "—"}</div>
                <div style={{ fontSize: 10, color: C.faint, marginTop: 4 }}>{(c.captured_at || c.ts || "").slice(0, 19).replace("T", " ")}</div>
                <div style={{ marginTop: 6 }}>
                  {c.status === "captured"
                    ? <span style={{ fontSize: 11, color: C.gain, display: "inline-flex", alignItems: "center", gap: 4 }}><Eye size={12} /> {t.view}</span>
                    : <span style={{ fontSize: 11, color: C.gold, display: "inline-flex", alignItems: "center", gap: 4 }}><Loader2 size={12} className="spin" /> {t.pending}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92vw", maxHeight: "90svh", overflow: "auto", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: C.muted }}>{viewing.target_user} · {viewing.route}</span>
              <button onClick={() => setViewing(null)} style={{ ...ctrlChip({ width: 30, height: 30 }) }}><X size={16} color={C.muted} /></button>
            </div>
            {viewing.image ? <img src={viewing.image} alt="capture" style={{ maxWidth: "100%", borderRadius: 8, display: "block" }} />
              : <div style={{ color: C.muted, padding: 30 }}>—</div>}
          </div>
        </div>
      )}
    </div>
  );
}
