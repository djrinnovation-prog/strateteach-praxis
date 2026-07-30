import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { Send, UserPlus, Check, Hash, Trash2, Gift, ArrowLeft, ArrowRight, SquarePen, Users, Search, Camera, Diamond, ChevronDown, LifeBuoy, BookOpen } from "lucide-react";
import { api, isAdmin } from "../app/api";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { C, SHADOW, onAccent } from "../theme";
import { errBox, premSoft } from "../ui";
import FramedTitle from "../components/FramedTitle";
import HomeTop from "../components/HomeTop";

// Chat reads the ACTIVE skin palette + light/dark mode (the live theme token),
// exactly like the other screens — so it re-themes with the rest of the app.

const L = {
  he: { title: "צ׳אט · תמיכה", sub: "שיחות, חברים, קבוצות ותמיכה", everyone: "כולם", online: "מחובר", offline: "לא מחובר",
        send: "שלח", placeholder: "הקלד הודעה…", you: "את/ה", empty: "אין הודעות עדיין — התחל שיחה",
        chats: "צ'אטים", newChat: "צ'אט חדש", addFriend: "הוסף לפי שם משתמש", requests: "בקשות חברות", accept: "אשר",
        newGroup: "קבוצה חדשה", groupName: "שם הקבוצה", pickMembers: "בחר חברים", create: "צור קבוצה", search: "חיפוש",
        allUsers: "כל המשתמשים", friends: "חברים", noChats: "אין צ'אטים עדיין", sent: "נשלח",
        reward: "שלח חגיגה 🎉", deleteChat: "מחק צ'אט", delConfirm: "למחוק את כל ההודעות בשיחה?", startDM: "פתח צ'אט",
        addToGroup: "הוסף לקבוצה", allInGroup: "כל החברים כבר בקבוצה", back: "חזרה" },
  en: { title: "Chat · Support", sub: "Conversations, friends, groups & support", everyone: "Everyone", online: "online", offline: "offline",
        send: "Send", placeholder: "Type a message…", you: "You", empty: "No messages yet — start the conversation",
        chats: "Chats", newChat: "New chat", addFriend: "Add by username", requests: "Friend requests", accept: "Accept",
        newGroup: "New group", groupName: "Group name", pickMembers: "Pick members", create: "Create group", search: "Search",
        allUsers: "All users", friends: "Friends", noChats: "No chats yet", sent: "sent",
        reward: "Send celebration 🎉", deleteChat: "Delete chat", delConfirm: "Delete all messages in this conversation?", startDM: "Open chat" },
};

type Target = { kind: "all" } | { kind: "dm"; user: string } | { kind: "group"; id: number; name: string };

const AV = ["#F7931A", "#7CC04E", "#36C5F0", "#E8438F", "#FBC02D", "#2DD4BF", "#A78BFA", "#FB7185"];
const colorFor = (s: string) => AV[Math.abs([...(s || "?")].reduce((a, c) => a + c.charCodeAt(0), 0)) % AV.length];

function fmtTime(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts); if (isNaN(+d)) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
               : d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}
// Bare clock (HH:MM) for the per-message footnote — the day is carried by the date
// separators, so bubbles only ever need the time.
function fmtClock(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts); if (isNaN(+d)) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
// A stable per-day key so we can drop a "Today / Yesterday / date" separator when
// the day rolls over between two consecutive messages.
function dayKey(ts?: string) { const d = new Date(ts || ""); return isNaN(+d) ? "" : d.toDateString(); }
function dayLabel(ts: string, lang: "he" | "en") {
  const d = new Date(ts); if (isNaN(+d)) return "";
  const today = new Date(); const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return lang === "he" ? "היום" : "Today";
  if (d.toDateString() === yest.toDateString()) return lang === "he" ? "אתמול" : "Yesterday";
  return d.toLocaleDateString(lang === "he" ? "he-IL" : undefined,
    { day: "numeric", month: "short", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}
// Two messages from the same sender within this window collapse into one visual
// group (repeated avatar/name suppressed, tail only on the last bubble) — the
// Telegram/WhatsApp "stacked" look.
const GROUP_WINDOW_MS = 5 * 60 * 1000;
function withinGroup(a?: string, b?: string) {
  const da = +new Date(a || ""), db = +new Date(b || "");
  return isFinite(da) && isFinite(db) && Math.abs(db - da) < GROUP_WINDOW_MS;
}

// Scoped hover / press affordances for the conversation rows + send button. Colours
// come from CSS vars set on the chat root (see chatVars) so it stays skin-dynamic.
const CHAT_CSS = `
.a770chat-row{transition:background .12s ease;-webkit-tap-highlight-color:transparent;}
.a770chat-row:hover{background:var(--a770-hover)!important;}
.a770chat-row:active{background:var(--a770-active)!important;}
.a770chat-send{transition:transform .08s ease,filter .12s ease;}
.a770chat-send:hover:not(:disabled){filter:brightness(1.06);}
.a770chat-send:active:not(:disabled){transform:scale(.93);}
.a770chat-jump{transition:transform .1s ease,opacity .15s ease;}
.a770chat-jump:active{transform:scale(.9);}
`;

function Avatar({ name, color, online, size = 46, avatar }: { name: string; color: string; online?: boolean; size?: number; avatar?: string | null }) {
  return (
    <div style={{ position: "relative", width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "flex", overflow: "hidden",
      alignItems: "center", justifyContent: "center", background: color, color: onAccent(color), fontWeight: 800, fontSize: size * 0.42 }}>
      {avatar ? <img src={avatar} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : (name || "#")[0].toUpperCase()}
      {online && <span style={{ position: "absolute", bottom: 1, insetInlineEnd: 1, width: size * 0.26, height: size * 0.26,
        borderRadius: "50%", background: C.gain, border: `2px solid ${C.surface}` }} />}
    </div>
  );
}

export default function Chat() {
  const { rtl, lang } = useI18n();
  const t = L[lang];
  const mobile = useIsMobile();
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [target, setTarget] = useState<Target | null>(mobile ? null : { kind: "all" });
  const [panel, setPanel] = useState<"chats" | "new" | "profile">("chats");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [newFriend, setNewFriend] = useState("");
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupSel, setGroupSel] = useState<string[]>([]);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [nickDraft, setNickDraft] = useState("");
  const [notifyOn, setNotifyOn] = useState(() => { try { return localStorage.getItem("algo770_notify") !== "0"; } catch (_e) { return true; } });
  // "chat" = chat-only profile (from the chat header); "account" = full account (from the main menu).
  const [profileMode, setProfileMode] = useState<"chat" | "account">("chat");
  const sinceRef = useRef(0);
  const meRef = useRef<string>("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);   // the messages scroll pane
  const taRef = useRef<HTMLTextAreaElement | null>(null);  // auto-growing composer
  const atBottomRef = useRef(true);                        // is the thread scrolled to newest?
  const [atBottom, setAtBottom] = useState(true);          // …mirrored for the jump-to-latest pill
  // Client-side unread tracking. The chat API has no server read-state, so we remember
  // the highest message id we've *seen at the bottom* of each conversation in
  // localStorage and count anything newer (from others) as unread.
  const [reads, setReads] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem("algo770_chat_reads") || "{}") || {}; } catch (_e) { return {}; }
  });
  const persistReads = (r: Record<string, number>) => { try { localStorage.setItem("algo770_chat_reads", JSON.stringify(r)); } catch (_e) { /* */ } };
  const seededRef = useRef(false);

  const profQ = useQuery({ queryKey: ["myProfile"], queryFn: () => api.myProfile() });
  useEffect(() => { if (profQ.data) { meRef.current = (profQ.data as any).username; setNickDraft((d) => d || ((profQ.data as any).nickname ?? "")); setEmailDraft((d) => d || ((profQ.data as any).email ?? "")); } }, [profQ.data]);
  // Deep links: /chat?profile=1 (legacy, from the main menu) and the promo
  // /chat?tab=profile | /chat?tab=new → jump straight to that panel.
  useEffect(() => {
    try {
      const q = new URLSearchParams(loc.search);
      const tab = q.get("tab");
      if (q.get("profile") || tab === "profile") { setProfileMode("account"); setPanel("profile"); }
      else if (tab === "new") { setPanel("new"); }
    } catch (_e) { /* */ }
  }, [loc.search]);
  const contactsQ = useQuery({ queryKey: ["chatContacts"], queryFn: () => api.chatContacts(), refetchInterval: 15000 });
  const contacts: any[] = (contactsQ.data as any)?.contacts || [];
  const friendsQ = useQuery({ queryKey: ["friends"], queryFn: () => api.friends(), refetchInterval: 15000 });
  const fr: any = friendsQ.data || { friends: [], incoming: [], outgoing: [] };
  const groupsQ = useQuery({ queryKey: ["groups"], queryFn: () => api.groups(), refetchInterval: 20000 });
  const groups: any[] = (groupsQ.data as any)?.groups || [];
  const nickOf = (u: string) => contacts.find((c) => c.username === u)?.nickname || u;
  const onlineOf = (u: string) => !!contacts.find((c) => c.username === u)?.online;
  const avatarOf = (u: string) => contacts.find((c) => c.username === u)?.avatar as string | undefined;
  const myAvatar = (profQ.data as any)?.avatar as string | undefined;
  const myName = ((profQ.data as any)?.nickname as string) || meRef.current;

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.chatPoll(sinceRef.current);
        const incoming = (r as any).messages || [];
        if (alive && incoming.length) { sinceRef.current = incoming[incoming.length - 1].id; setMsgs((p) => [...p, ...incoming]); }
      } catch (_e) { /* keep polling */ }
    };
    tick(); const h = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(h); };
  }, []);

  const inv = (k: string) => qc.invalidateQueries({ queryKey: [k] });
  const reqM = useMutation({ mutationFn: (u: string) => api.friendRequest(u), onSuccess: () => { setNewFriend(""); setErr(""); inv("friends"); }, onError: (e: any) => setErr(e?.message || String(e)) });
  const accM = useMutation({ mutationFn: (u: string) => api.friendAccept(u), onSuccess: () => inv("friends"), onError: (e: any) => setErr(e?.message || String(e)) });
  const grpM = useMutation({ mutationFn: () => api.createGroup(groupName.trim(), groupSel), onSuccess: () => { setGroupName(""); setGroupSel([]); setPanel("chats"); inv("groups"); }, onError: (e: any) => setErr(e?.message || String(e)) });
  const delChatM = useMutation({ mutationFn: () => api.chatDelete(target?.kind === "group" ? { groupId: target.id } : target?.kind === "dm" ? { with: target.user } : {}), onSuccess: () => { setMsgs([]); sinceRef.current = 0; }, onError: (e: any) => setErr(e?.message || String(e)) });
  const rewardM = useMutation({ mutationFn: () => api.sendReward(target?.kind === "dm" ? target.user : null), onSuccess: () => window.dispatchEvent(new Event("algo770-confetti")), onError: (e: any) => setErr(e?.message || String(e)) });
  const addMemberM = useMutation({ mutationFn: (u: string) => api.addGroupMembers(target?.kind === "group" ? target.id : 0, [u]), onSuccess: () => inv("groups"), onError: (e: any) => setErr(e?.message || String(e)) });
  const avatarM = useMutation({ mutationFn: (d: string | null) => api.setAvatar(d), onSuccess: () => { inv("myProfile"); inv("chatContacts"); }, onError: (e: any) => setErr(e?.message || String(e)) });
  const onPickAvatar = async (file?: File | null) => { if (!file) return; try { avatarM.mutate(await fileToAvatar(file)); } catch { setErr(lang === "he" ? "טעינת התמונה נכשלה" : "Couldn't load that image"); } };
  const nickM = useMutation({ mutationFn: (n: string) => api.setNickname(n), onSuccess: () => { inv("myProfile"); inv("chatContacts"); }, onError: (e: any) => setErr(e?.message || String(e)) });
  const toggleNotify = () => {
    const n = !notifyOn; setNotifyOn(n);
    try { localStorage.setItem("algo770_notify", n ? "1" : "0"); } catch (_e) { /* */ }
    if (n && "Notification" in window && Notification.permission === "default") { try { Notification.requestPermission(); } catch (_e) { /* */ } }
  };
  const [emailDraft, setEmailDraft] = useState("");
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [acctMsg, setAcctMsg] = useState("");
  const exConnected = (() => { try { return !!localStorage.getItem("algo770_exchange_creds"); } catch (_e) { return false; } })();
  const emailM = useMutation({ mutationFn: (e2: string) => api.setMyEmail(e2), onSuccess: () => { setErr(""); setAcctMsg(lang === "he" ? "האימייל עודכן ✓" : "Email updated ✓"); inv("myProfile"); }, onError: (e: any) => setErr(e?.message || String(e)) });
  const pwM = useMutation({ mutationFn: () => api.changeMyPassword(pwCur, pwNew), onSuccess: () => { setPwCur(""); setPwNew(""); setErr(""); setAcctMsg(lang === "he" ? "הסיסמה שונתה ✓" : "Password changed ✓"); }, onError: (e: any) => setErr(e?.message || String(e)) });

  // ── derive the conversation list (Everyone + groups + DMs), newest first ──
  const lastFor = (pred: (m: any) => boolean) => { for (let i = msgs.length - 1; i >= 0; i--) if (pred(msgs[i])) return msgs[i]; return undefined; };
  const dmPartners = new Set<string>(fr.friends);
  msgs.forEach((m) => { if (m.group_id == null && m.to_user != null) { const o = m.from_user === meRef.current ? m.to_user : m.from_user; if (o && o !== meRef.current) dmPartners.add(o); } });

  type Convo = { key: string; target: Target; name: string; color: string; online?: boolean; group?: boolean; all?: boolean; last?: any };
  const convos: Convo[] = [
    { key: "all", target: { kind: "all" }, name: t.everyone, color: C.gold, all: true, last: lastFor((m) => m.group_id == null && m.to_user == null) },
    ...groups.map((g) => ({ key: "g" + g.id, target: { kind: "group", id: g.id, name: g.name } as Target, name: g.name, color: colorFor(g.name), group: true, last: lastFor((m) => m.group_id === g.id) })),
    ...[...dmPartners].map((u) => ({ key: "d" + u, target: { kind: "dm", user: u } as Target, name: nickOf(u), color: colorFor(u), online: onlineOf(u), last: lastFor((m) => m.group_id == null && m.to_user != null && (m.from_user === u || m.to_user === u)) })),
  ];
  convos.sort((a, b) => {
    if (a.all) return -1; if (b.all) return 1;
    return (b.last?.ts || "").localeCompare(a.last?.ts || "");
  });

  const preview = (c: Convo) => {
    if (!c.last) return "—";
    const mine = c.last.from_user === meRef.current;
    const who = mine ? `${t.you}: ` : (c.group ? `${nickOf(c.last.from_user)}: ` : "");
    return who + (c.last.body || "");
  };

  const shown = msgs.filter((m) => {
    if (!target) return false;
    if (target.kind === "group") return m.group_id === target.id;
    if (m.group_id != null) return false;
    if (target.kind === "all") return m.to_user == null;
    return (m.from_user === target.user && m.to_user === meRef.current) || (m.from_user === meRef.current && m.to_user === target.user);
  });
  const shownRef = useRef<any[]>(shown);
  shownRef.current = shown;

  // ── unread counts (client-side; see `reads`) ──
  const msgKeyOf = (m: any) => m.group_id != null ? "g" + m.group_id
    : m.to_user == null ? "all"
    : "d" + (m.from_user === meRef.current ? m.to_user : m.from_user);
  const unreadByKey: Record<string, number> = {};
  msgs.forEach((m) => {
    if (m.from_user === meRef.current) return;
    const k = msgKeyOf(m);
    if (m.id > (reads[k] || 0)) unreadByKey[k] = (unreadByKey[k] || 0) + 1;
  });

  // Advance the read-marker for the open conversation up to its newest message — but
  // only while the user is actually parked at the bottom (so scrolling up to read
  // history doesn't silently clear the badge before they reach the new messages).
  const markRead = () => {
    if (!target || !atBottomRef.current) return;
    const k = convoKey(target);
    const maxId = shownRef.current.reduce((mx: number, m: any) => (m.id > mx ? m.id : mx), 0);
    setReads((prev) => { if (maxId <= (prev[k] || 0)) return prev; const next = { ...prev, [k]: maxId }; persistReads(next); return next; });
  };
  useEffect(markRead, [shown, target]); // eslint-disable-line
  // First load with no stored marks: treat all existing history as already read, so
  // only messages that arrive afterwards raise the unread badge (avoids a jarring
  // "everything unread" on first visit). Returning users' stored marks are kept.
  useEffect(() => {
    if (seededRef.current || !msgs.length || !meRef.current) return;
    seededRef.current = true;
    setReads((prev) => {
      const maxByKey: Record<string, number> = {};
      msgs.forEach((m) => { const k = msgKeyOf(m); if (m.id > (maxByKey[k] || 0)) maxByKey[k] = m.id; });
      const next = { ...prev }; let changed = false;
      Object.keys(maxByKey).forEach((k) => { if (!(k in next)) { next[k] = maxByKey[k]; changed = true; } });
      if (!changed) return prev; persistReads(next); return next;
    });
  }, [msgs.length, profQ.data]); // eslint-disable-line

  // Auto-scroll: jump to newest instantly when a conversation opens; on a new
  // message, only follow if the user is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true; setAtBottom(true);
    markRead(); // opening a conversation clears its unread badge
  }, [target]); // eslint-disable-line
  useEffect(() => { if (atBottomRef.current) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [shown.length]); // eslint-disable-line
  const onThreadScroll = () => {
    const el = scrollRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    atBottomRef.current = near; setAtBottom(near);
    if (near) markRead();
  };
  const jumpToLatest = () => { endRef.current?.scrollIntoView({ behavior: "smooth" }); atBottomRef.current = true; setAtBottom(true); markRead(); };

  // Composer auto-grow (1 → ~5 lines) so multi-line messages expand in place.
  const growComposer = () => { const el = taRef.current; if (!el) return; el.style.height = "0px"; el.style.height = Math.min(el.scrollHeight, 128) + "px"; };
  useEffect(growComposer, [text, target]);

  // Build the render rows: inject "Today / date" separators on day change and flag
  // consecutive same-sender bubbles so we can collapse the avatar/name and only
  // draw the tail on the last bubble of each run.
  type Row = { type: "date"; ts: string; key: string } | { type: "msg"; m: any; grouped: boolean; last: boolean; key: string };
  const threadRows: Row[] = [];
  { let lastDay = "";
    shown.forEach((m, i) => {
      const dk = dayKey(m.ts);
      if (dk && dk !== lastDay) { threadRows.push({ type: "date", ts: m.ts, key: "sep" + m.id }); lastDay = dk; }
      const prev = shown[i - 1], next = shown[i + 1];
      const grouped = !!prev && prev.from_user === m.from_user && dayKey(prev.ts) === dk && withinGroup(prev.ts, m.ts);
      const last = !next || next.from_user !== m.from_user || dayKey(next.ts) !== dk || !withinGroup(m.ts, next.ts);
      threadRows.push({ type: "msg", m, grouped, last, key: String(m.id) });
    });
  }

  const send = async () => {
    const body = text.trim(); if (!body || !target) return; setText(""); setErr("");
    atBottomRef.current = true; setAtBottom(true); // sending my own message → stick to newest
    try {
      const res: any = target.kind === "group"
        ? await api.chatSend(null, body, target.id)
        : await api.chatSend(target.kind === "dm" ? target.user : null, body);
      // Show my own message immediately (don't wait for the 4s poll), and bump the
      // poll cursor so it isn't fetched again as a duplicate.
      const m = res?.message;
      if (m && m.id) {
        setMsgs((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
        if (m.id > sinceRef.current) sinceRef.current = m.id;
      }
    } catch (e: any) { setErr(e?.message || String(e)); setText(body); }
  };

  const tgtName = target ? (target.kind === "all" ? t.everyone : target.kind === "group" ? target.name : nickOf(target.user)) : "";
  const tgtColor = target ? (target.kind === "all" ? C.gold : target.kind === "group" ? colorFor(target.name) : colorFor(target.user)) : C.gold;
  const grpMembers = target?.kind === "group" ? (groups.find((g) => g.id === target.id)?.members?.length || 0) : 0;
  const tgtSub = target?.kind === "dm" ? (onlineOf(target.user) ? t.online : t.offline) : target?.kind === "group" && grpMembers ? `${grpMembers} ${t.friends}` : "";

  // A slim, unobtrusive quick-actions row — echoes the other screens' related row
  // WITHOUT forcing a 2-button hero onto the chat. Jumps to the support desk + guides.
  // Rendered under the desktop header, and inside the mobile conversation-list landing.
  const QuickActions = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      <button className="tap44" onClick={() => nav("/requests")} style={quickPill}>
        <LifeBuoy size={15} color={C.gold} /> {lang === "he" ? "פנייה לתמיכה" : "Contact support"}
      </button>
      <button className="tap44" onClick={() => nav("/university")} style={quickPill}>
        <BookOpen size={15} color={C.gold} /> {lang === "he" ? "מדריכים" : "Guides"}
      </button>
    </div>
  );

  // ─────────────────────────────── sub-views ───────────────────────────────
  const ConvoList = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* P&L (תיק) card — collapsed by default, shown ONLY on the conversation list
          (this is the chat's landing). It's intentionally NOT rendered inside an open
          thread, so the messaging UX stays clean. */}
      <HomeTop />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 12px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {mobile && <button onClick={() => nav("/")} className="tap44" style={navBtn} aria-label="back" title={t.back}>{rtl ? <ArrowRight size={20} /> : <ArrowLeft size={20} />}</button>}
          <span style={{ fontSize: 17, fontWeight: 800 }}>{t.chats}</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => { setProfileMode("chat"); setPanel("profile"); }} title={lang === "he" ? "פרופיל" : "Profile"} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: C.muted, fontFamily: "inherit" }}>
            <Avatar name={myName} color={colorFor(meRef.current)} size={32} avatar={myAvatar} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{lang === "he" ? "הפרופיל שלי" : "My profile"}</span>
          </button>
          <button onClick={() => setPanel("new")} title={t.newChat} className="tap44" style={primBtn({ padding: "8px 12px" })}><SquarePen size={15} /> {!mobile && t.newChat}</button>
        </span>
      </div>
      {mobile && QuickActions}
      {fr.incoming.length > 0 && (
        <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{t.requests}</div>
          {fr.incoming.map((u: string) => (
            <div key={u} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}><Avatar name={nickOf(u)} color={colorFor(u)} size={30} /> {nickOf(u)}</span>
              <button onClick={() => accM.mutate(u)} style={primBtn({ padding: "4px 10px", fontSize: 12 })}><Check size={12} /> {t.accept}</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {convos.map((c) => {
          const active = !mobile && target ? convoKey(target) === c.key : false;
          const unread = active ? 0 : (unreadByKey[c.key] || 0);
          return (
            <button key={c.key} className="a770chat-row" onClick={() => { setTarget(c.target); }} style={{
              display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "start", cursor: "pointer",
              background: active ? `${C.gold}1f` : "transparent", border: "none", borderRadius: 12, padding: "9px 10px", fontFamily: "inherit" }}>
              {c.all ? <div style={{ width: 46, height: 46, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--btn-bg)", color: "var(--btn-ink)" }}><Hash size={20} /></div>
                     : c.group ? <div style={{ width: 46, height: 46, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: c.color, color: onAccent(c.color) }}><Users size={20} /></div>
                     : <Avatar name={c.name} color={c.color} online={c.online} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: unread ? 800 : 700, fontSize: 14.5, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                  <span style={{ fontSize: 11, color: unread ? C.gold : C.faint, flexShrink: 0, fontWeight: unread ? 700 : 400 }}>{fmtTime(c.last?.ts)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: unread ? C.text : C.muted, fontWeight: unread ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview(c)}</div>
                  {unread > 0 && (
                    <span style={{ flexShrink: 0, minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-ink)",
                      fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{unread > 99 ? "99+" : unread}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {convos.length <= 1 && !convos[0]?.last && <div style={{ fontSize: 13, color: C.faint, textAlign: "center", marginTop: 30 }}>{t.noChats}</div>}
      </div>
    </div>
  );

  const others = contacts.filter((c) => !c.isMe && nickOf(c.username).toLowerCase().includes(query.toLowerCase()));
  const NewChat = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 12px" }}>
        <button onClick={() => setPanel("chats")} className="tap44" style={navBtn} aria-label="back">{rtl ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}</button>
        <span style={{ fontSize: 16, fontWeight: 800 }}>{t.newChat}</span>
      </div>
      <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 7, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "0 10px" }}>
          <Search size={14} color={C.muted} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontFamily: "inherit", fontSize: 13, padding: "9px 0" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input value={newFriend} onChange={(e) => setNewFriend(e.target.value)} placeholder={t.addFriend}
          style={{ flex: 1, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", color: C.text, fontFamily: "inherit", fontSize: 13 }} />
        <button onClick={() => reqM.mutate(newFriend.trim())} disabled={!newFriend.trim()} style={primBtn()}><UserPlus size={14} /></button>
      </div>

      {/* New group */}
      <details style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: C.gold, display: "flex", alignItems: "center", gap: 7 }}><Users size={14} /> {t.newGroup}</summary>
        <div style={{ marginTop: 10 }}>
          <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t.groupName}
            style={{ width: "100%", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 11px", color: C.text, fontFamily: "inherit", fontSize: 13, marginBottom: 8 }} />
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{t.pickMembers}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {fr.friends.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>—</span>}
            {fr.friends.map((u: string) => { const sel = groupSel.includes(u); return (
              <button key={u} onClick={() => setGroupSel((s) => sel ? s.filter((x) => x !== u) : [...s, u])}
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${sel ? C.gold : C.line}`, background: sel ? "var(--btn-bg)" : "transparent", color: sel ? "var(--btn-ink)" : C.muted }}>{nickOf(u)}</button>
            ); })}
          </div>
          <button onClick={() => grpM.mutate()} disabled={!groupName.trim()} style={primBtn({ width: "100%" })}>{t.create}</button>
        </div>
      </details>

      <div style={{ fontSize: 11, color: C.muted, margin: "2px 4px 6px" }}>{t.allUsers}</div>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {others.map((c) => {
          const pending = fr.outgoing.includes(c.username);
          const isFriend = fr.friends.includes(c.username);
          return (
            <div key={c.username} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button className="a770chat-row" onClick={() => { setTarget({ kind: "dm", user: c.username }); setPanel("chats"); }} style={{
                flex: 1, display: "flex", alignItems: "center", gap: 11, textAlign: "start", cursor: "pointer", background: "transparent", border: "none", borderRadius: 12, padding: "8px 10px", fontFamily: "inherit", minWidth: 0 }}>
                <Avatar name={c.nickname} color={colorFor(c.username)} online={c.online} size={40} avatar={c.avatar} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.nickname}</span>
              </button>
              {isFriend ? <Check size={15} color={C.gain} style={{ flexShrink: 0 }} />
                : pending ? <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{t.sent}</span>
                : <button onClick={() => reqM.mutate(c.username)} title={t.addFriend} style={secBtn({ padding: "6px 8px", flexShrink: 0 })}><UserPlus size={13} /></button>}
            </div>
          );
        })}
        {others.length === 0 && <div style={{ fontSize: 12, color: C.faint, textAlign: "center", marginTop: 20 }}>—</div>}
      </div>
    </div>
  );

  const Profile = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 2px 12px" }}>
        <button onClick={() => setPanel("chats")} className="tap44" style={navBtn} aria-label="back">{rtl ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}</button>
        <span style={{ fontSize: 16, fontWeight: 800 }}>{lang === "he" ? "הפרופיל שלי" : "My profile"}</span>
      </div>

      {/* avatar + name */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, padding: "6px 0 18px" }}>
        <div style={{ position: "relative" }}>
          <Avatar name={myName} color={colorFor(meRef.current)} size={96} avatar={myAvatar} />
          <button onClick={() => fileRef.current?.click()} title={lang === "he" ? "החלף תמונה" : "Change photo"}
            style={{ position: "absolute", bottom: 0, insetInlineEnd: 0, width: 30, height: 30, borderRadius: "50%", background: "var(--btn-bg)", color: "var(--btn-ink)", border: `2px solid ${C.surface}`, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <Camera size={15} />
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        <div style={{ fontWeight: 800, fontSize: 16 }}>{myName}</div>
        {myAvatar && <button onClick={() => avatarM.mutate(null)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer" }}>{lang === "he" ? "הסר תמונה" : "Remove photo"}</button>}
      </div>

      {/* chat nickname */}
      <div style={{ fontSize: 12, color: C.muted, margin: "2px 4px 6px" }}>{lang === "he" ? "כינוי בצ'אט" : "Chat nickname"}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <input value={nickDraft} onChange={(e) => setNickDraft(e.target.value)} placeholder={myName}
          style={{ flex: 1, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", color: C.text, fontFamily: "inherit", fontSize: 13 }} />
        <button onClick={() => nickM.mutate(nickDraft.trim())} disabled={nickM.isPending || !nickDraft.trim()} style={primBtn()}><Check size={14} /></button>
      </div>

      {/* notifications toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 4px 14px" }}>
        <span style={{ fontSize: 13 }}>{lang === "he" ? "התראות" : "Notifications"}</span>
        <button onClick={toggleNotify} aria-label="notifications" style={{ width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", background: notifyOn ? C.gain : C.surface2, position: "relative", flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 3, [notifyOn ? "right" : "left"]: 3, width: 20, height: 20, borderRadius: "50%", background: "#fff" } as React.CSSProperties} />
        </button>
      </div>

      {profileMode === "account" && (<>
      {/* account: username, email, password, connected exchange (main-menu profile only) */}
      <div style={{ fontSize: 12, color: C.muted, margin: "2px 4px 6px" }}>{lang === "he" ? "חשבון" : "Account"}</div>
      <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 14, display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ fontSize: 12.5, color: C.muted }}>{lang === "he" ? "שם משתמש" : "Username"}: <b style={{ color: C.text }}>{meRef.current}</b></div>
        <div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{lang === "he" ? "אימייל" : "Email"}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input type="email" value={emailDraft} onChange={(e) => setEmailDraft(e.target.value)} placeholder={lang === "he" ? "ללא אימייל" : "no email set"}
              style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: "inherit", fontSize: 13 }} />
            <button onClick={() => emailM.mutate(emailDraft.trim())} disabled={emailM.isPending} style={primBtn()}><Check size={14} /></button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{lang === "he" ? "שינוי סיסמה" : "Change password"}</div>
          <input type="password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} placeholder={lang === "he" ? "סיסמה נוכחית" : "Current password"}
            style={{ width: "100%", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: "inherit", fontSize: 13, marginBottom: 6 }} />
          <div style={{ display: "flex", gap: 6 }}>
            <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} placeholder={lang === "he" ? "סיסמה חדשה (6+)" : "New password (6+)"}
              style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", color: C.text, fontFamily: "inherit", fontSize: 13 }} />
            <button onClick={() => pwM.mutate()} disabled={pwM.isPending || !pwCur || pwNew.length < 6} style={primBtn()}><Check size={14} /></button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>{lang === "he" ? "בורסה" : "Exchange"}: <b style={{ color: exConnected ? C.gain : C.loss }}>{exConnected ? (lang === "he" ? "מחוברת ✓" : "Connected ✓") : (lang === "he" ? "לא מחוברת" : "Not connected")}</b></span>
          <button onClick={() => nav("/exchange")} style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "6px 11px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>{lang === "he" ? "נהל" : "Manage"}</button>
        </div>
        {acctMsg && <div style={{ fontSize: 12, color: C.gain }}>{acctMsg}</div>}
      </div>
      </>)}

      {/* send friend request */}
      <div style={{ fontSize: 12, color: C.muted, margin: "2px 4px 6px" }}>{lang === "he" ? "הוסף חבר" : "Add a friend"}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <input value={newFriend} onChange={(e) => setNewFriend(e.target.value)} placeholder={t.addFriend}
          style={{ flex: 1, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", color: C.text, fontFamily: "inherit", fontSize: 13 }} />
        <button onClick={() => reqM.mutate(newFriend.trim())} disabled={!newFriend.trim()} style={primBtn()}><UserPlus size={14} /></button>
      </div>

      {/* friend requests */}
      <div style={{ fontSize: 12, color: C.muted, margin: "2px 4px 6px" }}>{t.requests}</div>
      {fr.incoming.length === 0 && fr.outgoing.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "2px 4px 8px" }}>—</div>}
      {fr.incoming.map((u: string) => (
        <div key={"in" + u} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 4px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}><Avatar name={nickOf(u)} color={colorFor(u)} size={30} avatar={avatarOf(u)} /> {nickOf(u)}</span>
          <button onClick={() => accM.mutate(u)} style={primBtn({ padding: "4px 10px", fontSize: 12 })}><Check size={12} /> {t.accept}</button>
        </div>
      ))}
      {fr.outgoing.map((u: string) => (
        <div key={"out" + u} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 4px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}><Avatar name={nickOf(u)} color={colorFor(u)} size={30} avatar={avatarOf(u)} /> {nickOf(u)}</span>
          <span style={{ fontSize: 11, color: C.muted }}>{t.sent}</span>
        </div>
      ))}

      {/* groups I'm in */}
      <div style={{ fontSize: 12, color: C.muted, margin: "14px 4px 6px" }}>{lang === "he" ? "הקבוצות שלי" : "My groups"}</div>
      {groups.length === 0 && <div style={{ fontSize: 12, color: C.faint, padding: "2px 4px" }}>—</div>}
      {groups.map((g) => (
        <button key={g.id} className="a770chat-row" onClick={() => { setTarget({ kind: "group", id: g.id, name: g.name }); setPanel("chats"); }}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start", cursor: "pointer", background: "transparent", border: "none", borderRadius: 10, padding: "8px 6px", fontFamily: "inherit" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: colorFor(g.name), color: onAccent(colorFor(g.name)) }}><Users size={17} /></div>
          <span style={{ flex: 1, fontSize: 14, color: C.text }}>{g.name}</span>
          <span style={{ fontSize: 11, color: C.muted }}>{g.members?.length || 0} {t.friends}</span>
        </button>
      ))}
    </div>
  );

  const Thread = target ? (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: C.surface, border: mobile ? "none" : `1px solid ${C.line}`, borderRadius: mobile ? 0 : 14, overflow: "hidden", boxShadow: mobile ? "none" : SHADOW }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${C.line}`, background: C.surface }}>
        {mobile && <button onClick={() => setTarget(null)} className="tap44" style={navBtn} aria-label="back">{rtl ? <ArrowRight size={18} /> : <ArrowLeft size={18} />}</button>}
        {target.kind === "all" ? <div style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--btn-bg)", color: "var(--btn-ink)" }}><Hash size={17} /></div>
          : target.kind === "group" ? <div style={{ width: 38, height: 38, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: tgtColor, color: onAccent(tgtColor) }}><Users size={17} /></div>
          : <Avatar name={tgtName} color={tgtColor} online={onlineOf(target.user)} size={38} avatar={avatarOf(target.user)} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tgtName}</div>
          {tgtSub && <div style={{ fontSize: 11, color: target.kind === "dm" && onlineOf(target.user) ? C.gain : C.muted }}>{tgtSub}</div>}
        </div>
        {target.kind === "group" && <button onClick={() => setShowAddMembers((s) => !s)} title={t.addToGroup} className="tap44" style={navBtn}><UserPlus size={16} color={showAddMembers ? C.gold : C.muted} /></button>}
        {isAdmin() && <button onClick={() => rewardM.mutate()} title={t.reward} className="tap44" style={navBtn}><Gift size={16} color={C.gold} /></button>}
        <button onClick={() => { if (window.confirm(t.delConfirm)) delChatM.mutate(); }} title={t.deleteChat} className="tap44" style={navBtn}><Trash2 size={15} color={C.loss} /></button>
      </div>

      {target.kind === "group" && showAddMembers && (
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}`, background: C.surface2 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>{t.addToGroup}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(() => {
              const grp = groups.find((g) => g.id === target.id);
              const inGroup: string[] = grp?.members || [];
              const candidates = (fr.friends as string[]).filter((u) => !inGroup.includes(u));
              if (!candidates.length) return <span style={{ fontSize: 12, color: C.faint }}>{t.allInGroup}</span>;
              return candidates.map((u) => (
                <button key={u} onClick={() => addMemberM.mutate(u)} disabled={addMemberM.isPending}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${C.line}`, background: C.surface, color: C.text }}>
                  <UserPlus size={12} color={C.gold} /> {nickOf(u)}
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        <div ref={scrollRef} onScroll={onThreadScroll} role="log" aria-live="polite" aria-label={lang === "he" ? `שיחה עם ${tgtName}` : `Conversation with ${tgtName}`}
          style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 0, background: C.bg }}>
          {threadRows.length === 0 && <div style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 40 }}>{t.empty}</div>}
          {threadRows.map((row) => {
            if (row.type === "date") return (
              <div key={row.key} style={{ alignSelf: "center", margin: "12px 0 8px" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, background: `${C.surface2}`, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 12px", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>{dayLabel(row.ts, lang)}</span>
              </div>
            );
            const m = row.m;
            const mine = m.from_user === meRef.current;
            const bg = mine ? C.gold : C.surface;
            const showName = !mine && target.kind !== "dm" && !row.grouped;
            const side = rtl ? "left" : "right";       // physical sending side (RTL-aware)
            return (
              <div key={row.key} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", marginTop: row.grouped ? 2 : 9 }}>
                {showName && <div style={{ fontSize: 10.5, color: colorFor(m.from_user), marginBottom: 2, fontWeight: 700, paddingInlineStart: 6 }}>{nickOf(m.from_user)}</div>}
                <div style={{ position: "relative", background: bg, color: mine ? "var(--btn-ink)" : C.text, border: `1px solid ${mine ? C.gold : C.line}`,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.06)", borderRadius: 18,
                  ...(row.last ? (mine ? { borderEndEndRadius: 6 } : { borderEndStartRadius: 6 }) : {}),
                  padding: "7px 12px 6px", fontSize: 13.5, lineHeight: 1.38, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                  {row.last && (
                    <span aria-hidden style={{ position: "absolute", bottom: 0, [mine ? side : (rtl ? "right" : "left")]: -6, width: 11, height: 15, background: bg,
                      clipPath: mine === !rtl ? "polygon(0 0, 0 100%, 100% 100%)" : "polygon(100% 0, 100% 100%, 0 100%)" } as React.CSSProperties} />
                  )}
                  {m.body}
                  <span style={{ display: "inline-block", verticalAlign: "bottom", float: rtl ? "left" : "right", fontSize: 9.5, opacity: 0.6, margin: "6px 0 0", paddingInlineStart: 8, direction: "ltr" }}>{fmtClock(m.ts)}</span>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        {!atBottom && (
          <button className="a770chat-jump" onClick={jumpToLatest} aria-label={lang === "he" ? "להודעות האחרונות" : "Jump to latest"}
            style={{ position: "absolute", bottom: 12, insetInlineEnd: 14, width: 40, height: 40, borderRadius: "50%", background: C.surface, border: `1px solid ${C.line}`,
              color: C.text, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 16px -6px rgba(0,0,0,0.35)" }}>
            <ChevronDown size={20} />
            {(unreadByKey[convoKey(target)] || 0) > 0 && (
              <span style={{ position: "absolute", top: -5, insetInlineEnd: -5, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "var(--btn-bg)", color: "var(--btn-ink)",
                fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{unreadByKey[convoKey(target)]}</span>
            )}
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: 10, borderTop: `1px solid ${C.line}`, background: C.surface }}>
        <textarea ref={taRef} value={text} rows={1} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder}
          aria-label={lang === "he" ? `הודעה ל${tgtName}` : `Message ${tgtName}`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !mobile) { e.preventDefault(); send(); } }}
          style={{ flex: 1, resize: "none", maxHeight: 128, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 22, padding: "11px 16px", color: C.text, fontFamily: "inherit", fontSize: 14, lineHeight: 1.35, direction: rtl ? "rtl" : "ltr", outline: "none" }} />
        <button onClick={send} disabled={!text.trim()} aria-label={t.send} title={t.send} className="a770chat-send tap44" style={primBtn({ borderRadius: "50%", width: 44, height: 44, padding: 0, flexShrink: 0 })}><Send size={16} /></button>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.faint, fontSize: 14, flexDirection: "column", gap: 8 }}>
      <Send size={26} color={C.faint} /> {t.empty}
    </div>
  );

  // ─────────────────────────────── layout ───────────────────────────────
  // Skin-derived hover/press tints for the row/button stylesheet (kept as CSS vars
  // so they re-theme with the palette instead of being locked to one skin).
  const chatVars = { ["--a770-hover" as any]: `${C.gold}14`, ["--a770-active" as any]: `${C.gold}24` } as React.CSSProperties;
  if (mobile) {
    return (
      <div style={{ height: "calc(100svh - 60px)", display: "flex", flexDirection: "column", ...chatVars }}>
        <style>{CHAT_CSS}</style>
        {/* Carved framed title on the list/compose views — matches every other screen. When a
            conversation is open (target) its own thread header takes over (messenger UX), so the
            framed title steps aside to give the thread the full height. */}
        {!target && <div style={{ flexShrink: 0, marginBottom: 10 }}><FramedTitle text={t.title} subtitle={t.sub} /></div>}
        {err && <div style={errBox}>{err}</div>}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {target ? Thread : (panel === "new" ? NewChat : panel === "profile" ? Profile : ConvoList)}
        </div>
      </div>
    );
  }
  return (
    <div style={chatVars}>
      <style>{CHAT_CSS}</style>
      {/* Carved screen name inside Home's frame (finalized model). Chat keeps its live
          split-view (list + thread) intact — its interaction can't be a locked launcher.
          The P&L (תיק) card lives at the top of the conversation LIST (ConvoList). */}
      <div style={{ marginBottom: 16 }}>
        <FramedTitle text={t.title} subtitle={t.sub} />
      </div>
      {QuickActions}
      {err && <div style={errBox}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "330px 1fr", gap: 14, height: "calc(100svh - 225px)", minHeight: 460 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 12, overflow: "hidden", boxShadow: SHADOW }}>
          {panel === "new" ? NewChat : panel === "profile" ? Profile : ConvoList}
        </div>
        {Thread}
      </div>
    </div>
  );
}

function convoKey(t: Target): string {
  return t.kind === "all" ? "all" : t.kind === "group" ? "g" + t.id : "d" + t.user;
}

const navBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: "50%", background: "none", border: "none", cursor: "pointer", color: "inherit", flexShrink: 0 };

// Premium buttons — primary = skin-accent fill with soft depth (kept off the .gbtn
// class so the round send button can take a custom radius/shadow), secondary = the
// shared premSoft finish. whiteSpace:nowrap + centering keep EN/HE labels ("New chat"
// / "צ'אט חדש", "Create group" / "צור קבוצה", "Accept" / "אשר") on one tidy line.
const primBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, whiteSpace: "nowrap",
  background: "var(--btn-bg)", border: "1.5px solid var(--btn-bd)", color: "var(--btn-ink)",
  borderRadius: 14, padding: "9px 14px", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 8px 20px -13px rgba(0,0,0,0.45)", ...extra,
});
const secBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
  ...premSoft(), display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  padding: "8px 12px", fontSize: 13, whiteSpace: "nowrap", ...extra,
});
// Quick-action pill (support / guides) — a calm surface pill matching the app's
// related-row tiles; skin-aware via C.* and a comfortable ≥44px tap target.
const quickPill: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap", cursor: "pointer",
  background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12,
  padding: "9px 14px", fontSize: 12.5, fontWeight: 800, fontFamily: "inherit",
  boxShadow: "0 4px 12px -9px rgba(0,0,0,0.35)",
};

// Read an image file and downscale it to a small square-ish JPEG data URL so the
// avatar stays tiny in the database.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
