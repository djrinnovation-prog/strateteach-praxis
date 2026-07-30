import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HelpCircle, X, Send, Paperclip, Film, Image as ImageIcon, CheckCircle2,
  ChevronDown, CornerDownRight, Inbox,
} from "lucide-react";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";
import { useEntitlements } from "../lib/entitlements";
import { api } from "../app/api";
import { C, UI } from "../theme";
import { track } from "../lib/analytics";
import type { RequestRow, RequestDetail, RequestStatus } from "../lib/client";

// ── Help Portal ───────────────────────────────────────────────────────────────
// A round launcher (placed inside the Home springboard orb, top-inline-end of the
// four squares) that opens the user's Requests-portal ON SCREEN as an overlay/sheet
// — no navigation-away. The overlay lets the user (1) open a NEW request and
// (2) read their PAST requests with the team's replies, all in one place.
//
// Wiring: a new request is created via the feedback path (api.submitFeedback), which
// the backend mirrors into a user_request row (auth.py). The list + threads use the
// real portal endpoints (api.listRequests/getRequest/replyRequest), which the server
// scopes to the caller's OWN inbox for a non-owner. So this is exactly the /requests
// portal (user view) surfaced as an overlay.
//
// Gating: available to EVERY signed-in user — it's their own support inbox (the old
// "Send us feedback" button was demo/admin-only; that restriction is dropped here).
// Owners/admins keep the full-screen /requests portal for management.

const MAX_BYTES = 20 * 1024 * 1024; // ~20MB cap on the single attachment

const STATUS_META: Record<RequestStatus, { he: string; en: string; color: string; bg: string }> = {
  new:         { he: "חדש",    en: "New",         color: "#F7931A", bg: "rgba(247,147,26,0.15)" },
  in_progress: { he: "בטיפול", en: "In progress", color: "#3B9EFF", bg: "rgba(59,158,255,0.15)" },
  answered:    { he: "נענה",   en: "Answered",    color: "#7CC04E", bg: "rgba(124,192,78,0.16)" },
  resolved:    { he: "נסגר",   en: "Resolved",    color: C.muted,   bg: C.surface2 },
};

export default function HelpPortalButton({ cta = false, square = false }: { cta?: boolean; square?: boolean }) {
  const { lang } = useI18n();
  const he = lang === "he";
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const label = he ? "פורטל עזרה" : "Help Portal";
  // `square` = the bordered rounded-SQUARE variant used in Home's help row (matches the
  // Learn/Reels/About/shortcut tiles, sqTile SQ_RADIUS=13). Default stays the 999 pill.
  const RAD = square ? 13 : 999;
  // `cta` = the BOLD, high-contrast call-to-action variant (owner: the Help Portal must
  // stand out so a lost user spots + reaches it instantly): accent FILL (skin --btn-*),
  // heavier weight, a stronger glow, and a comfortable ≥44px tap target. Default stays
  // the lighter accent-bordered pill used elsewhere.
  const H = cta ? (mobile ? 44 : 48) : (mobile ? 40 : 46);

  return (
    <>
      {/* A labelled PILL (help icon + "Help Portal" text). Default = accent frame on the
          surface; `cta` = accent FILLED bold button. RTL-safe (inline-flex), one line. */}
      <button onClick={() => { track("help_portal_opened"); setOpen(true); }} aria-label={label} title={label} className="tap44"
        style={{
          height: H, borderRadius: RAD, flexShrink: 0, padding: cta ? (mobile ? "0 16px" : "0 20px") : (mobile ? "0 13px" : "0 16px"),
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          gap: mobile ? 6 : 8, whiteSpace: "nowrap",
          cursor: "pointer", fontFamily: UI, fontSize: cta ? (mobile ? 13.5 : 15) : (mobile ? 13 : 14.5), fontWeight: cta ? 900 : 800,
          letterSpacing: cta ? "0.01em" : undefined,
          color: cta ? "var(--btn-ink)" : C.gold,
          background: cta ? "var(--btn-bg)" : C.surface,
          border: `1.5px solid ${cta ? "var(--btn-bd)" : C.gold}`,
          boxShadow: cta
            ? `0 8px 22px -8px ${C.gold}99, 0 0 18px -3px ${C.gold}88, inset 0 1px 0 rgba(255,255,255,0.28)`
            : `0 4px 14px -6px rgba(0,0,0,0.5), 0 0 12px -3px ${C.gold}66, inset 0 1px 0 rgba(255,255,255,0.14)`,
        }}>
        <HelpCircle size={mobile ? 18 : 20} color={cta ? "currentColor" : C.gold} strokeWidth={2.4} />
        <span>{label}</span>
      </button>
      {open && <HelpPortalOverlay onClose={() => setOpen(false)} />}
    </>
  );
}

// ── The overlay: new-request composer + the user's requests & replies ───────────
function HelpPortalOverlay({ onClose }: { onClose: () => void }) {
  const { lang, rtl } = useI18n();
  const he = lang === "he";
  const mobile = useIsMobile();
  const qc = useQueryClient();

  // The user's own support inbox (server scopes a non-owner to their own rows).
  const listQ = useQuery({
    queryKey: ["helpRequests"],
    queryFn: () => api.listRequests({ category: "user_request" }),
    refetchInterval: 30000,
  });
  const rows: RequestRow[] = (listQ.data as any)?.requests || [];

  const fmt = (iso: string | null) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(rtl ? "he-IL" : "en-US", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  // Portal to document.body: the launcher lives inside the SectionHub orb, whose
  // orbital-animation `transform` makes it the containing block for any
  // `position:fixed` descendant (CSS spec) — so an in-place fixed backdrop would be
  // sized to the tiny orb-corner wrapper (~62px), not the viewport, collapsing the
  // card to a thin strip. Rendering into <body> lifts the `inset:0` backdrop out of
  // the transformed ancestor so it covers the real viewport.
  return createPortal(
    // Mobile: a bottom-SHEET (flush, rounded top, slides up), full width, capped at
    // 88dvh with the header pinned + the body scrolling internally + safe-area padding
    // — comfortable + reachable on a phone. Desktop: a centred card.
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: mobile ? "flex-end" : "center", justifyContent: "center", padding: mobile ? 0 : 16, direction: rtl ? "rtl" : "ltr" }}>
      <style>{`@keyframes hpSheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
      <div onClick={(e) => e.stopPropagation()} dir={rtl ? "rtl" : "ltr"}
        style={{ width: mobile ? "100%" : "min(520px, 92vw)", maxWidth: "100%", flexShrink: 0, maxHeight: mobile ? "88dvh" : "calc(100dvh - 32px)", display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.line}`, borderRadius: mobile ? "18px 18px 0 0" : 18, boxShadow: mobile ? "0 -12px 40px rgba(0,0,0,0.5)" : "0 24px 70px rgba(0,0,0,0.55)", overflow: "hidden", fontFamily: UI, paddingBottom: mobile ? "env(safe-area-inset-bottom, 0px)" : undefined, animation: mobile ? "hpSheetUp .26s cubic-bezier(.22,.61,.36,1) both" : undefined }}>
        {/* grab handle (mobile) */}
        {mobile && (
          <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "8px 0 2px" }}>
            <span aria-hidden style={{ width: 38, height: 4, borderRadius: 999, background: C.line }} />
          </div>
        )}
        {/* header — pinned */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${C.line}`, background: `linear-gradient(135deg, ${C.gold}26, ${C.gold}0f), ${C.surface}` }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 16, fontWeight: 900, color: C.text }}>
              <HelpCircle size={18} color={C.gold} /> {he ? "פורטל עזרה" : "Help Portal"}
            </span>
            <span style={{ display: "block", fontSize: 11.5, color: C.muted, marginTop: 2 }}>
              {he ? "פתחו פנייה חדשה או צפו בפניות ובתשובות שלכם" : "Open a new request or view your requests & replies"}
            </span>
          </span>
          <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44" style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={18} /></button>
        </div>

        {/* body — scrolls internally; header above stays pinned */}
        <div style={{ overflowY: "auto", minHeight: 0, WebkitOverflowScrolling: "touch" as any, padding: mobile ? 14 : 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <NewRequestComposer he={he} rtl={rtl} mobile={mobile}
            onSent={() => { qc.invalidateQueries({ queryKey: ["helpRequests"] }); }} />

          {/* the user's past requests + replies */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0 10px" }}>
              <Inbox size={15} color={C.gold} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{he ? "הפניות שלי" : "My requests"}</span>
            </div>
            {listQ.isLoading ? (
              <div style={{ color: C.muted, fontSize: 13, padding: "14px 0", textAlign: "center" }}>{he ? "טוען…" : "Loading…"}</div>
            ) : rows.length === 0 ? (
              <div style={{ background: C.surface2, border: `1px dashed ${C.line}`, borderRadius: 12, padding: "22px 14px", textAlign: "center", color: C.muted, fontSize: 13 }}>
                {he ? "אין עדיין פניות. פתחו פנייה חדשה למעלה." : "No requests yet — open a new one above."}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {rows.map((r) => <RequestItem key={r.id} row={r} he={he} fmt={fmt} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── New-request composer (posts via the feedback path → a user_request row) ──────
// Exported so the full-screen /requests portal can reuse the SAME contact-support
// composer (identical submitFeedback → user_request wiring) behind its hero button.
export function NewRequestComposer({ he, rtl, mobile, onSent }: { he: boolean; rtl: boolean; mobile: boolean; onSent: () => void }) {
  const ent = useEntitlements().data;
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  // Telegram-delivery status — surfaced to ADMINS only (so Dan sees "not connected"
  // instead of a silent no-op). Regular users never see it; their request is saved
  // + threaded here regardless.
  const [tgWarn, setTgWarn] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    setErr("");
    if (!f) { setFile(null); setDataUrl(null); return; }
    if (f.size > MAX_BYTES) {
      setErr(he ? "הקובץ גדול מדי — עד 20MB." : "File too large — up to 20MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(f);
    setIsVideo(f.type.startsWith("video"));
    const reader = new FileReader();
    reader.onload = () => setDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setErr(he ? "קריאת הקובץ נכשלה." : "Could not read the file.");
    reader.readAsDataURL(f);
  };

  const canSend = (note.trim().length > 0 || !!dataUrl) && !busy;

  const send = async () => {
    if (!canSend) return;
    setBusy(true); setErr(""); setTgWarn(null);
    try {
      const res = await api.submitFeedback(note.trim(), "/", null, dataUrl, file?.name || null);
      if (ent?.isAdmin && res?.telegram && !res.telegram.ok) {
        setTgWarn(res.telegram.reason === "not_configured"
          ? (he ? "התראת טלגרם לא נשלחה: הטלגרם של המנהל לא מחובר (חברו בוט + צ'אט במסך טלגרם)."
                : "Telegram alert not sent: admin Telegram isn't connected (connect a bot + chat in the Telegram screen).")
          : (he ? `התראת טלגרם נכשלה: ${res.telegram.message || res.telegram.reason || ""}`
                : `Telegram alert failed: ${res.telegram.message || res.telegram.reason || ""}`));
      }
      setNote(""); setFile(null); setDataUrl(null); setIsVideo(false);
      if (fileRef.current) fileRef.current.value = "";
      setDone(true);
      track("support_request_submitted");
      onSent(); // refresh the list so the new request appears below
    } catch (e: any) {
      setErr(e?.message || (he ? "השליחה נכשלה — נסו שוב." : "Send failed — please try again."));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 14, padding: mobile ? 12 : 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Send size={15} color={C.gold} />
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{he ? "פנייה חדשה" : "New request"}</span>
      </div>

      {err && <div style={{ background: "rgba(240,97,109,0.12)", border: `1px solid ${C.loss}`, color: C.loss, borderRadius: 9, padding: "8px 12px", fontSize: 13, marginBottom: 10 }}>{err}</div>}
      {done && !err && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "rgba(124,192,78,0.12)", border: `1px solid ${C.gain}55`, color: C.text, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, lineHeight: 1.45, marginBottom: 10 }}>
          <CheckCircle2 size={16} color={C.gain} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{he ? "הפנייה נשלחה! נחזור אליכם כאן — היא מופיעה בפניות שלכם למטה." : "Request sent! We'll reply here — it now appears in your requests below."}</span>
        </div>
      )}
      {tgWarn && (
        <div style={{ background: "rgba(247,147,26,0.12)", border: `1px solid ${C.gold}`, color: C.text, borderRadius: 9, padding: "8px 12px", fontSize: 12, lineHeight: 1.45, marginBottom: 10 }}>⚠️ {tgWarn}</div>
      )}

      <textarea value={note} onChange={(e) => { setNote(e.target.value); if (done) setDone(false); }} rows={mobile ? 3 : 4}
        placeholder={he ? "במה נוכל לעזור? כתבו את הפנייה, שאלה או תקלה…" : "How can we help? Write your request, question or issue…"}
        style={{ width: "100%", boxSizing: "border-box", minHeight: mobile ? 78 : 96, resize: "vertical", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 11, padding: "10px 12px", color: C.text, fontFamily: UI, fontSize: 14, lineHeight: 1.5, textAlign: rtl ? "right" : "left" }} />

      {/* single optional attachment */}
      <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files?.[0] || null)} />
      {!file ? (
        <button onClick={() => fileRef.current?.click()} className="tap44"
          style={{ marginTop: 10, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: mobile ? 42 : 46, padding: "9px 14px", borderRadius: 12, border: `1.5px dashed ${C.gold}`, background: C.surface, color: C.text, cursor: "pointer", fontFamily: UI, fontSize: 13, fontWeight: 800 }}>
          <Paperclip size={16} color={C.gold} /> {he ? "צרפו תמונה או וידאו (אופציונלי)" : "Attach a photo or video (optional)"}
        </button>
      ) : (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 11, padding: 10, borderRadius: 12, border: `1px solid ${C.line}`, background: C.surface }}>
          <span style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 9, overflow: "hidden", display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.surface2, border: `1px solid ${C.line}` }}>
            {isVideo
              ? <Film size={20} color={C.gold} />
              : (dataUrl ? <img src={dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImageIcon size={20} color={C.gold} />)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</span>
            <span style={{ display: "block", fontSize: 11, color: C.muted, marginTop: 2 }}>
              {(isVideo ? (he ? "וידאו" : "Video") : (he ? "תמונה" : "Photo")) + " · " + (file.size / (1024 * 1024)).toFixed(1) + "MB"}
            </span>
          </span>
          <button onClick={() => pickFile(null)} aria-label={he ? "הסר קובץ" : "Remove file"} className="tap44"
            style={{ flexShrink: 0, background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={16} /></button>
        </div>
      )}

      <button onClick={send} disabled={!canSend} className="gbtn tap44"
        style={{ marginTop: 12, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: mobile ? 46 : 48, padding: "12px 16px", borderRadius: 12, border: "none", cursor: canSend ? "pointer" : "default", fontFamily: UI, fontSize: 15, fontWeight: 900, opacity: canSend ? 1 : 0.5 }}>
        <Send size={17} /> {busy ? (he ? "שולח…" : "Sending…") : (he ? "שליחת פנייה" : "Send request")}
      </button>
    </div>
  );
}

// ── One expandable request row (user view: body + media + reply thread + follow-up) ─
// Typed as React.FC so JSX key-attribute handling is applied cleanly (this component
// is rendered in a .map with a `key`).
const RequestItem: React.FC<{ row: RequestRow; he: boolean; fmt: (s: string | null) => string }> = ({ row, he, fmt }) => {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const detailQ = useQuery({
    queryKey: ["helpRequest", row.id],
    queryFn: () => api.getRequest(row.id),
    enabled: open,
  });
  const detail: RequestDetail | undefined = (detailQ.data as any)?.request;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["helpRequest", row.id] });
    qc.invalidateQueries({ queryKey: ["helpRequests"] });
  };

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    try { await api.replyRequest(row.id, text); setReply(""); refresh(); }
    catch (e: any) { alert(e?.message || (he ? "שליחה נכשלה" : "Failed to send")); }
    finally { setBusy(false); }
  };

  const m = STATUS_META[row.status];

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
      <button onClick={() => setOpen((o) => !o)} className="tap44"
        style={{ width: "100%", boxSizing: "border-box", minHeight: 44, display: "flex", alignItems: "center", gap: 10, textAlign: "start", cursor: "pointer", background: "transparent", border: "none", padding: "11px 13px", fontFamily: UI, color: C.text }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.subject || (he ? "(ללא נושא)" : "(no subject)")}
          </span>
          <span style={{ display: "block", fontSize: 11.5, color: C.faint, marginTop: 3 }}>
            {fmt(row.createdAt)}{row.replyCount > 0 ? ` · ${row.replyCount} ${he ? "תגובות" : "replies"}` : ""}
          </span>
        </span>
        <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "3px 9px", borderRadius: 999, color: m.color, background: m.bg, border: `1px solid ${m.color}55`, whiteSpace: "nowrap" }}>
          {he ? m.he : m.en}
        </span>
        <ChevronDown size={16} color={C.muted} style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>

      {open && (
        <div style={{ padding: "0 13px 13px", borderTop: `1px solid ${C.line}` }}>
          {detailQ.isLoading || !detail ? (
            <div style={{ color: C.muted, fontSize: 13, padding: "14px 0" }}>{he ? "טוען…" : "Loading…"}</div>
          ) : (
            <>
              {detail.body && (
                <p style={{ fontSize: 14, color: C.text, lineHeight: 1.55, margin: "13px 0 0", whiteSpace: "pre-wrap" }}>{detail.body}</p>
              )}
              {detail.media && detail.media.startsWith("data:image/") && (
                <img src={detail.media} alt="attachment" style={{ maxWidth: "100%", borderRadius: 10, marginTop: 12, border: `1px solid ${C.line}` }} />
              )}

              {/* reply thread */}
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                {detail.replies.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: C.faint }}>{he ? "אין תשובות עדיין." : "No replies yet."}</div>
                ) : detail.replies.map((rp) => {
                  const mine = rp.authorId === detail.userId; // the user's own follow-ups vs the team's replies
                  return (
                    <div key={rp.id} style={{ background: mine ? C.surface2 : "rgba(247,147,26,0.07)", border: `1px solid ${mine ? C.line : "rgba(247,147,26,0.25)"}`, borderRadius: 10, padding: "9px 12px" }}>
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

              {/* follow-up composer — appends to the user's own request (re-opens it) */}
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
                  placeholder={he ? "הוסיפו פנייה נוספת…" : "Add a follow-up…"}
                  style={{ flex: 1, minWidth: 0, resize: "vertical", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13.5, color: C.text, fontFamily: UI, lineHeight: 1.45 }} />
                <button onClick={sendReply} disabled={busy || !reply.trim()} className="gbtn tap44"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "10px 14px", fontWeight: 800, fontSize: 13, cursor: busy || !reply.trim() ? "default" : "pointer", fontFamily: UI, opacity: busy || !reply.trim() ? 0.55 : 1, whiteSpace: "nowrap" }}>
                  <Send size={15} /> {he ? "שלח" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
