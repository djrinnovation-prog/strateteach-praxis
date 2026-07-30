import React, { useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox, MessageSquare, ChevronDown, Send, StickyNote, Plus, CornerDownRight,
  HelpCircle, MessageCircle, Search, BookOpen, X,
} from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, UI } from "../theme";
import ScreenShortcuts from "../components/ScreenShortcuts";
import FramedTitle from "../components/FramedTitle";
import { GlassTile, TileGrid, homeDim } from "../components/GlassTile";
import SquareRow from "../components/SquareRow";
import { centralExtras } from "../lib/centralExtras";
import ScreenBottom from "../components/ScreenBottom";
import { HubPanel } from "../components/HubScreen";
import { NewRequestComposer } from "../components/HelpPortal";
import { ErrorState } from "../components/StateBlock";
import { useViewMode, ViewToggle } from "../components/ViewToggle";
import type {
  RequestRow, RequestDetail, RequestStatus, RequestCategory,
} from "../lib/client";

// ── Owner / Requests portal — a single mini help-desk surface ─────────────────
// ADMIN/OWNER: two tabs (User requests / Owner notes) + a status filter; each
// request is an expandable row → full body + media + reply thread + status
// buttons + a reply composer. The Owner-notes tab adds an internal-note composer.
// USER (role-gated): the SAME screen shows only their OWN user_requests as the
// same expandable rows (owners' replies read-only) + a follow-up composer.

const STATUSES: RequestStatus[] = ["new", "in_progress", "answered", "resolved"];

// Status colours route through THEME tokens via getters (new = attention gold, in-progress
// = blue, answered = positive green, resolved = muted) so they stay live on skin-switch —
// the old fixed orange/blue/green literals clashed on the new Peach/Sea/Yellow skins.
const STATUS_META: Record<RequestStatus, { he: string; en: string; color: string; bg: string }> = {
  new:         { he: "חדש",   en: "New",         get color() { return C.gold; }, get bg() { return `${C.gold}26`; } },
  in_progress: { he: "בטיפול", en: "In progress", get color() { return C.blue; }, get bg() { return `${C.blue}26`; } },
  answered:    { he: "נענה",   en: "Answered",    get color() { return C.gain; }, get bg() { return `${C.gain}29`; } },
  resolved:    { he: "נסגר",   en: "Resolved",    get color() { return C.muted; }, get bg() { return C.surface2; } },
};

export default function Requests() {
  const { lang } = useI18n();
  const rtl = lang === "he";
  const nav = useNavigate();
  const mobile = useIsMobile();

  const [tab, setTab] = useState<RequestCategory>("user_request");
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  // Shared rows/squares view toggle (default rows — the inbox was row-only before).
  const [view, setView] = useViewMode("algo770_requests_view_v1", "list");
  // Hero-driven affordances (re-layout): an inline Contact-support composer + a
  // client-side inbox search. Both are real actions surfaced by the ScreenHero.
  const [showSearch, setShowSearch] = useState(false);
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const sec = sp.get("sec") || "";
  const setSec = (v: string) => setSp(v ? { sec: v } : {});
  const [moreView, setMoreView] = useViewMode("algo770_requests_more_view_v1", "cards");

  // The backend ignores `category` for non-owners (it always scopes them to their
  // own user_requests), so we can always pass the active tab.
  const listQ = useQuery({
    queryKey: ["requests", tab, filter],
    queryFn: () => api.listRequests({
      category: tab,
      status: filter === "all" ? undefined : filter,
    }),
    refetchInterval: 30000,
  });
  // FULL portal (tabs + see-all + manage) is OWNERS only (Dan/Rafi/Yoav), driven by
  // the server's authoritative isOwner flag — correct even right after login. A
  // non-owner admin + regular users get only their own support inbox.
  const isAdmin = !!(listQ.data as any)?.isOwner;
  const rows: RequestRow[] = (listQ.data as any)?.requests || [];
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => (r.subject || "").toLowerCase().includes(needle) || ((r as any).displayName || "").toLowerCase().includes(needle))
    : rows;

  const openContact = () => setSec("contact");
  const openSearch = () => { setSec("list"); setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 80); };

  const fmt = (iso: string | null) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(rtl ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ fontFamily: UI, color: C.text, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>

      {sec === "" && (
        <>
          <FramedTitle
            text={isAdmin ? (rtl ? "פורטל פניות" : "Requests portal") : (rtl ? "עזרה" : "Help")}
            subtitle={isAdmin
              ? (rtl ? "ניהול פניות משתמשים והערות פנימיות במקום אחד" : "Manage user requests & internal notes in one place")
              : (rtl ? "תיבת הפניות שלך — ההתכתבות שלך עם הצוות" : "Your support inbox — your correspondence with the team")} />

          {/* Editable top shortcuts — the "עוד במערכת" chip opens the More CHILD (not a modal). */}
          <ScreenShortcuts
            screenKey="requests"
            defaultKeys={["inbox", "contact", "guides", "chat"]}
            onMore={() => setSec("more")}
            catalog={[
              { key: "inbox", label: rtl ? "הפניות שלי" : "My requests", Icon: Inbox, onClick: () => setSec("list") },
              { key: "search", label: rtl ? "חיפוש" : "Search", Icon: Search, onClick: openSearch },
              { key: "guides", label: rtl ? "מדריכים" : "Guides", Icon: BookOpen, onClick: () => nav("/university") },
              { key: "chat", label: rtl ? "צ׳אט" : "Chat", Icon: MessageCircle, onClick: () => nav("/chat") },
              { key: "contact", label: rtl ? "פנייה לתמיכה" : "Contact", Icon: Send, onClick: openContact },
              { key: "faq", label: rtl ? "שאלות נפוצות" : "FAQ", Icon: HelpCircle, onClick: () => nav("/university") },
            ]}
          />

          {/* 3 central glass buttons — now EDITABLE via SquareRow (choose which appear + order +
              APPROVE + reset). The screen's own 3 are shown by default; the shared app-destinations
              pool is addable from the ✎ editor. */}
          <SquareRow screenKey="requests-central" mobile={mobile} defaultShown={["inbox", "contact", "faq"]}
            squares={[
              { id: "inbox", variant: "primary", Icon: Inbox, label: isAdmin ? (rtl ? "פניות" : "Requests") : (rtl ? "הפניות שלי" : "My requests"), sub: rtl ? "תיבת פניות" : "inbox", onClick: () => setSec("list") },
              { id: "contact", variant: "secondary", Icon: Send, label: rtl ? "פנייה חדשה" : "Contact", sub: rtl ? "פתחו פנייה" : "new request", onClick: openContact },
              { id: "faq", variant: "secondary", Icon: HelpCircle, label: rtl ? "שאלות נפוצות" : "FAQ", sub: rtl ? "מדריכים" : "guides", onClick: () => nav("/university") },
              ...centralExtras(rtl, nav, { exclude: ["help"] }),
            ]} />
        </>
      )}

      {/* ── "עוד במערכת" CHILD — the help areas as a tile grid with a rows/tiles toggle. ── */}
      {sec === "more" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <FramedTitle text={rtl ? "עוד במערכת" : "More"} subtitle={rtl ? "כל אזורי העזרה" : "All help areas"} />
          <div style={{ display: "flex", justifyContent: "flex-end", margin: "2px 2px 0" }}>
            <ViewToggle view={moreView} onChange={setMoreView} he={rtl} />
          </div>
          <TileGrid screenKey="requests-more" view={moreView} columns={3} aspect={1.08} tiles={[
            { id: "list", label: rtl ? "הפניות שלי" : "My requests", Icon: Inbox, onClick: () => setSec("list") },
            { id: "contact", label: rtl ? "פנייה חדשה" : "Contact", Icon: Send, onClick: openContact },
            { id: "faq", label: rtl ? "שאלות נפוצות" : "FAQ", Icon: HelpCircle, onClick: () => nav("/university") },
            { id: "guides", label: rtl ? "מדריכים" : "Guides", Icon: BookOpen, onClick: () => nav("/university") },
            { id: "chat", label: rtl ? "צ׳אט" : "Chat", Icon: MessageCircle, onClick: () => nav("/chat") },
          ]} />
        </div>
      )}

      {/* ── CONTACT CHILD — the new-request composer. ── */}
      {sec === "contact" && (
        <HubPanel alwaysOpen ns="requests" id="contact" title={rtl ? "פנייה לתמיכה" : "Contact support"} icon={<Send size={15} />} onClose={() => setSec("")}>
          <NewRequestComposer he={rtl} rtl={rtl} mobile={mobile}
            onSent={() => { qc.invalidateQueries({ queryKey: ["requests", tab, filter] }); setSec("list"); }} />
        </HubPanel>
      )}

      {/* ── INBOX CHILD — tabs + filters + search + the requests list. ── */}
      {sec === "list" && (
      <HubPanel alwaysOpen ns="requests" id="list" title={isAdmin ? (rtl ? "פורטל פניות" : "Requests portal") : (rtl ? "הפניות שלי" : "My requests")} icon={<Inbox size={15} />} onClose={() => setSec("")}>
      {/* ADMIN: tabs (User requests / Owner notes) */}
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <TabButton active={tab === "user_request"} onClick={() => setTab("user_request")}
            icon={<MessageSquare size={15} />} label={rtl ? "פניות משתמשים" : "User requests"} />
          <TabButton active={tab === "owner_note"} onClick={() => setTab("owner_note")}
            icon={<StickyNote size={15} />} label={rtl ? "הערות בעלים (פנימי)" : "Owner notes"} />
        </div>
      )}

      {/* Status filter (admins on both tabs; users on their own list) + rows/squares toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}
          label={rtl ? "הכל" : "All"} color={C.gold} />
        {STATUSES.map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}
            label={rtl ? STATUS_META[s].he : STATUS_META[s].en} color={STATUS_META[s].color} />
        ))}
        <ViewToggle view={view} onChange={setView} he={rtl} style={{ marginInlineStart: "auto" }} />
      </div>

      {/* Owner-note composer (admin, Owner-notes tab only) */}
      {isAdmin && tab === "owner_note" && <OwnerNoteComposer rtl={rtl} />}

      {/* Inbox search — client-side filter over the loaded rows (revealed by the hero). */}
      {showSearch && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10, padding: "4px 10px" }}>
          <Search size={16} color={C.gold} style={{ flexShrink: 0 }} />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={rtl ? "חיפוש בפניות…" : "Search requests…"}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: C.text, fontFamily: UI, fontSize: 13.5, padding: "8px 0" }} />
          <button onClick={() => { setQ(""); setShowSearch(false); }} aria-label={rtl ? "סגור חיפוש" : "Close search"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={15} /></button>
        </div>
      )}

      {/* List */}
      {listQ.isError ? (
        <ErrorState onRetry={() => listQ.refetch()} retrying={listQ.isFetching}  screen="requests" />
      ) : listQ.isLoading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: "24px 0", textAlign: "center" }}>{rtl ? "טוען…" : "Loading…"}</div>
      ) : shown.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 32, textAlign: "center", color: C.muted }}>
          <Inbox size={20} style={{ marginBottom: 8, opacity: 0.7 }} />
          <div style={{ fontSize: 14 }}>{rtl ? "אין פניות להצגה." : "No requests to show."}</div>
        </div>
      ) : (
        <div style={view === "cards"
          ? { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", alignItems: "start" }
          : { display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((r) => <Row key={r.id} row={r} isAdmin={isAdmin} rtl={rtl} fmt={fmt} listKey={["requests", tab, filter]} />)}
        </div>
      )}
      </HubPanel>
      )}

      {/* Persistent bottom cluster (like Home): live/demo P&L + Help-Portal, above the tab bar. */}
      <ScreenBottom />
    </div>
  );
}

// ── Expandable request row ────────────────────────────────────────────────────
function Row({ row, isAdmin, rtl, fmt, listKey }: {
  row: RequestRow; isAdmin: boolean; rtl: boolean; fmt: (s: string | null) => string; listKey: any[];
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const detailQ = useQuery({
    queryKey: ["request", row.id],
    queryFn: () => api.getRequest(row.id),
    enabled: open,
  });
  const detail: RequestDetail | undefined = (detailQ.data as any)?.request;
  const sm = STATUS_META[row.status];

  const refresh = () => { qc.invalidateQueries({ queryKey: ["request", row.id] }); qc.invalidateQueries({ queryKey: listKey }); };

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    try { await api.replyRequest(row.id, text); setReply(""); refresh(); }
    catch (e: any) { alert(e?.message || (rtl ? "שליחה נכשלה" : "Failed to send")); }
    finally { setBusy(false); }
  };

  const changeStatus = async (s: RequestStatus) => {
    setBusy(true);
    try { await api.setRequestStatus(row.id, s); refresh(); }
    catch (e: any) { alert(e?.message || (rtl ? "עדכון נכשל" : "Update failed")); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} className="tap44"
        style={{ width: "100%", boxSizing: "border-box", minHeight: 44, display: "flex", alignItems: "center", gap: 10,
          textAlign: "start", cursor: "pointer", background: "transparent", border: "none", padding: "12px 14px", fontFamily: "inherit", color: C.text }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {isAdmin && row.category === "user_request" && (
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.gold }}>{row.displayName || row.userId || "—"}</span>
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
              {row.subject || (rtl ? "(ללא נושא)" : "(no subject)")}
            </span>
          </span>
          <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 3 }}>
            {fmt(row.createdAt)}{row.replyCount > 0 ? ` · ${row.replyCount} ${rtl ? "תגובות" : "replies"}` : ""}
          </span>
        </span>
        <StatusPill status={row.status} rtl={rtl} />
        <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.line}` }}>
          {detailQ.isLoading || !detail ? (
            <div style={{ color: C.muted, fontSize: 13, padding: "14px 0" }}>{rtl ? "טוען…" : "Loading…"}</div>
          ) : (
            <>
              {/* Full body */}
              {detail.body && (
                <p style={{ fontSize: 14, color: C.text, lineHeight: 1.55, margin: "14px 0 0", whiteSpace: "pre-wrap" }}>{detail.body}</p>
              )}
              {detail.route && (
                <div style={{ fontSize: 11.5, color: C.faint, marginTop: 6 }}>{rtl ? "מסך" : "Screen"}: {detail.route}</div>
              )}
              {/* Media */}
              {detail.media && detail.media.startsWith("data:image/") && (
                <img src={detail.media} alt="attachment" style={{ maxWidth: "100%", borderRadius: 10, marginTop: 12, border: `1px solid ${C.line}` }} />
              )}

              {/* Status buttons (admin/owner only) */}
              {isAdmin && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                  <span style={{ fontSize: 11.5, color: C.faint, alignSelf: "center" }}>{rtl ? "סטטוס:" : "Status:"}</span>
                  {STATUSES.map((s) => (
                    <button key={s} disabled={busy || detail.status === s} onClick={() => changeStatus(s)} className="tap44"
                      style={{ fontSize: 12, fontWeight: 700, padding: "6px 11px", borderRadius: 999, cursor: detail.status === s ? "default" : "pointer",
                        fontFamily: UI, border: `1px solid ${detail.status === s ? STATUS_META[s].color : C.line}`,
                        background: detail.status === s ? STATUS_META[s].bg : "transparent",
                        color: detail.status === s ? STATUS_META[s].color : C.muted, opacity: busy ? 0.6 : 1 }}>
                      {rtl ? STATUS_META[s].he : STATUS_META[s].en}
                    </button>
                  ))}
                </div>
              )}

              {/* Reply thread */}
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {detail.replies.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: C.faint }}>{rtl ? "אין תגובות עדיין." : "No replies yet."}</div>
                ) : detail.replies.map((rp) => {
                  const mine = rp.authorId === detail.userId && detail.category === "user_request";
                  return (
                    <div key={rp.id} style={{ background: mine ? C.surface2 : `${C.gold}12`,
                      border: `1px solid ${mine ? C.line : `${C.gold}40`}`, borderRadius: 10, padding: "9px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <CornerDownRight size={12} color={mine ? C.muted : C.gold} />
                        <span style={{ fontSize: 12, fontWeight: 800, color: mine ? C.muted : C.gold }}>{rp.authorName || rp.authorId || "—"}</span>
                        <span style={{ fontSize: 10.5, color: C.faint, marginInlineStart: "auto" }}>{fmt(rp.createdAt)}</span>
                      </div>
                      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{rp.text}</div>
                    </div>
                  );
                })}
              </div>

              {/* Reply composer — admin answers any; user appends a follow-up to their own.
                  An owner_note is internal: only admins thread on it. */}
              {(isAdmin || detail.category === "user_request") && (
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)}
                    placeholder={isAdmin
                      ? (detail.category === "owner_note" ? (rtl ? "הוסף הערה לשרשור…" : "Add a note to the thread…") : (rtl ? "כתוב תשובה למשתמש…" : "Write a reply to the user…"))
                      : (rtl ? "הוסף פנייה נוספת…" : "Add a follow-up…")}
                    rows={2}
                    style={{ flex: 1, minWidth: 0, resize: "vertical", background: C.surface2, border: `1px solid ${C.line}`,
                      borderRadius: 10, padding: "9px 12px", fontSize: 13.5, color: C.text, fontFamily: UI, lineHeight: 1.45 }} />
                  <button onClick={sendReply} disabled={busy || !reply.trim()} className="gbtn tap44"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "10px 14px",
                      fontWeight: 800, fontSize: 13, cursor: busy || !reply.trim() ? "default" : "pointer", fontFamily: UI,
                      opacity: busy || !reply.trim() ? 0.55 : 1, whiteSpace: "nowrap" }}>
                    <Send size={15} /> {rtl ? "שלח" : "Send"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Owner-note composer (admin, internal site-structure / "what's stuck" notes) ─
function OwnerNoteComposer({ rtl }: { rtl: boolean }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if ((!subject.trim() && !body.trim()) || busy) return;
    setBusy(true);
    try {
      await api.createOwnerNote(subject.trim(), body.trim());
      setSubject(""); setBody("");
      qc.invalidateQueries({ queryKey: ["requests", "owner_note"] });
    } catch (e: any) { alert(e?.message || (rtl ? "שמירה נכשלה" : "Save failed")); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <StickyNote size={16} color={C.gold} />
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{rtl ? "הערת בעלים חדשה" : "New owner note"}</span>
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)}
        placeholder={rtl ? "נושא (לדוגמה: מבנה האתר / מה תקוע)" : "Subject (e.g. site structure / what's stuck)"}
        style={{ width: "100%", boxSizing: "border-box", background: C.surface2, border: `1px solid ${C.line}`,
          borderRadius: 10, padding: "9px 12px", fontSize: 13.5, color: C.text, fontFamily: UI, marginBottom: 8 }} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
        placeholder={rtl ? "כתוב את ההערה הפנימית…" : "Write the internal note…"}
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: C.surface2, border: `1px solid ${C.line}`,
          borderRadius: 10, padding: "9px 12px", fontSize: 13.5, color: C.text, fontFamily: UI, lineHeight: 1.45 }} />
      <button onClick={save} disabled={busy || (!subject.trim() && !body.trim())} className="gbtn tap44"
        style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "10px 16px",
          fontWeight: 800, fontSize: 13, cursor: busy ? "default" : "pointer", fontFamily: UI,
          opacity: busy || (!subject.trim() && !body.trim()) ? 0.55 : 1 }}>
        <Plus size={15} /> {rtl ? "הוסף הערה" : "Add note"}
      </button>
    </div>
  );
}

// ── Small UI atoms ────────────────────────────────────────────────────────────
function StatusPill({ status, rtl }: { status: RequestStatus; rtl: boolean }) {
  const m = STATUS_META[status];
  return (
    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999,
      color: m.color, background: m.bg, border: `1px solid ${m.color}55`, whiteSpace: "nowrap" }}>
      {rtl ? m.he : m.en}
    </span>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="tap44"
      style={{ display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 12, padding: "9px 14px",
        fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: UI,
        border: `1.5px solid ${active ? C.gold : C.line}`, background: active ? `${C.gold}1f` : C.surface,
        color: active ? C.gold : C.muted }}>
      {icon} {label}
    </button>
  );
}

function FilterChip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button onClick={onClick} className="tap44"
      style={{ fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontFamily: UI,
        border: `1px solid ${active ? color : C.line}`, background: active ? `${color}1f` : "transparent",
        color: active ? color : C.muted }}>
      {label}
    </button>
  );
}
