import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { ClipboardList, Plus, X, Copy, Trash2, Pencil, Check, ClipboardCheck, Power, ImageIcon, Camera, Upload, Scissors, Send, Inbox } from "lucide-react";
import { C, UI, RADIUS, SHADOW } from "../theme";
import { useI18n } from "../i18n";
import { isReviewer, api } from "../app/api";
import { toastSuccess, toastError } from "../lib/toast";
import { useIsMobile } from "../lib/useIsMobile";

// The Review-inbox (management mini-portal) is lazy-loaded so opening it from the button's
// popover doesn't bloat the main bundle — and dynamic import breaks the ReviewMode ↔ ReviewInbox
// import cycle (ReviewInbox imports mergeReviewNotes from here) at module-eval time.
const ReviewInboxModal = React.lazy(() => import("../screens/ReviewInbox"));

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW MODE — owner/admin-only in-app feedback collector.
//
// Dan's ask: walk the app page by page, and ON EACH screen jot down "what to fix"
// as a task. Every per-screen note is collected (persisted client-side) across
// navigation, then ONE button compiles them all into a single structured markdown
// prompt he copies and hands to the developer.
//
// 100% client-side — notes live in localStorage, no backend/DB. Visible to the OWNERS
// (Dan/Rafi/Yoav) + Oren (it_editor). Bilingual HE/EN, RTL-aware (the document `dir` drives
// insetInline*), skin-adaptive via C.* tokens. Rendered through a portal on <body>
// so no ancestor transform can trap the floating controls. A note may carry an optional
// screenshot (downscaled JPEG data-URL) attached from the add-fix form.
// ─────────────────────────────────────────────────────────────────────────────

// A note may carry a short human CODE (#A1B2) + up to 10 downscaled image data-URLs.
interface Note { id: string; code: string; screen: string; route: string; text: string; timestamp: number; images?: string[]; }

const ON_KEY = "algo770_review_on";
const NOTES_KEY = "algo770_review_notes";
const MAX_FILES = 10;                    // per task
const MAX_NOTE_BYTES = 3_000_000;        // ~3 MB of image chars per task (warn + attach what fits)

// Fixed scan-first instruction block prepended to EVERY generated prompt (and the backend report
// mirrors it verbatim — keep in sync with review.py PROMPT_HEADER).
const PROMPT_HEADER =
  "# Agent — read first\n" +
  "Before executing anything below: for EACH task, FIRST scan the codebase + recent git history " +
  "to check whether this change was ALREADY made (note when). Skip anything already done. Then " +
  "produce an APPROVED LIST of only the not-yet-done tasks, and execute those.\n";

// Short, human, uniqueish task code (#A1B2). Derived from the note id (ts+seq, already unique).
function shortCode(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const s = h.toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (s + "0000").slice(0, 4);
}
function fmtTs(ts: number): string {
  try { const d = new Date(ts); const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ""; }
}

// Human screen names per route (HE/EN). Mirrors the app's NAV keys + the mobile-header
// `extra` map in Shell.tsx. Unknown routes fall back to a prettified path segment.
const SCREEN_NAMES: Record<string, { he: string; en: string }> = {
  "/": { he: "בית", en: "Home" },
  "/university": { he: "הסברים", en: "Explanations" },
  "/reels": { he: "רילים · קורס", en: "Reels · course" },
  "/overview": { he: "לוח", en: "Dashboard" },
  "/scanner": { he: "סריקה יומית", en: "Daily scan" },
  "/profit": { he: "מנוע מסחר", en: "Trading engine" },
  "/strategy": { he: "מעבדת אסטרטגיות", en: "Strategy lab" },
  "/exchange": { he: "בורסה", en: "Exchange" },
  "/analytics": { he: "ביצועים", en: "Performance" },
  "/backtests": { he: "בדיקות", en: "Backtests" },
  "/telegram": { he: "חיבור טלגרם", en: "Telegram connect" },
  "/chat": { he: "צ'אט", en: "Chat" },
  "/screens": { he: "מסכי משתמשים", en: "User screens" },
  "/privacy": { he: "פרטיות", en: "Privacy" },
  "/trading": { he: "מסחר", en: "Trading" },
  "/personal": { he: "פורטל אישי", en: "Personal Portal" },
  "/me": { he: "החשבון שלי", en: "Account" },
  "/activity": { he: "פעילות", en: "Activity" },
  "/plans": { he: "מסלולים", en: "Plans" },
  "/requests": { he: "עזרה", en: "Help / Requests" },
  "/team-messages": { he: "הודעות מהצוות", en: "Team messages" },
  "/reply-users": { he: "מענה למשתמשים", en: "Reply to users" },
  "/owners": { he: "פורטל הבעלים", en: "Owners portal" },
  "/bots": { he: "בוטים לאיתותים", en: "Signal bots" },
  "/staff-audit": { he: "ביקורת צוות", en: "Staff audit" },
  "/legal-portal": { he: "פורטל משפטי", en: "Legal portal" },
  "/it-portal": { he: "פורטל IT", en: "IT portal" },
  "/biz-portal": { he: "פורטל עסקי", en: "Biz-Dev portal" },
  "/guide": { he: "מדריך למתחילים", en: "Beginner guide" },
  "/guide-manager": { he: "ניהול מדריך הבית", en: "Home guide manager" },
  "/review-inbox": { he: "תיבת הסקירות", en: "Review inbox" },
};

function screenName(route: string, he: boolean): string {
  const hit = SCREEN_NAMES[route];
  if (hit) return he ? hit.he : hit.en;
  // Fallback: prettify the last path segment ("/some-page" → "Some page").
  const seg = route.split("/").filter(Boolean).pop() || (he ? "בית" : "Home");
  return seg.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function loadNotes(): Note[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTES_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    // DELETE-BUG FIX: guarantee every note has a UNIQUE id. Older/partial data could have a
    // missing OR duplicate `id`; duplicate React keys make delete-by-id remove the wrong node
    // (or fail to remove — "the note stays"). Backfilling unique ids here makes per-note delete
    // and the React keys reliable. (Also keep `_seq` ahead of any numeric legacy ids.)
    const seen = new Set<string>();
    return raw
      .filter((n) => n && typeof n.text === "string")
      .map((n, i) => {
        let id = typeof n.id === "string" && n.id ? n.id : `legacy-${i}`;
        while (seen.has(id)) id = `${id}.${i}`;
        seen.add(id);
        // Migrate the old single `image` → `images[]`, and backfill a short code + timestamp.
        const images: string[] = Array.isArray(n.images) ? n.images.filter((x: any) => typeof x === "string")
          : (typeof n.image === "string" && n.image ? [n.image] : []);
        return { ...n, id, images, code: n.code || shortCode(id), timestamp: n.timestamp || Date.now() } as Note;
      });
  } catch { return []; }
}
function saveNotes(notes: Note[]) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
  catch { /* quota (images can be large) / private mode — note text was already in state */ }
}

// Stable-ish id without Date.now()/Math.random() collisions across a fast burst:
// timestamp (passed in) + a monotonic counter.
let _seq = 0;
function newId(ts: number): string { _seq += 1; return `${ts.toString(36)}-${_seq.toString(36)}`; }

// Merge tasks INTO the current user's local Review-Mode notes (used by the mini-portal's "Add to
// mine"). Appends, persists, and notifies a mounted ReviewMode to reload. The original task's code
// is kept so it stays traceable; attached files remain on the server with the original submission
// (they're viewable there), so merged notes carry no local images.
export function mergeReviewNotes(items: { screen: string; route: string; text: string; code?: string }[]): number {
  if (!Array.isArray(items) || !items.length) return 0;
  const ts = Date.now();
  const added: Note[] = items
    .filter((it) => it && typeof it.text === "string" && it.text.trim())
    .map((it) => { const id = newId(ts); return { id, code: it.code || shortCode(id), screen: it.screen || "", route: it.route || "/", text: it.text, timestamp: ts, images: [] }; });
  if (!added.length) return 0;
  saveNotes([...loadNotes(), ...added]);
  window.dispatchEvent(new Event("algo770-review-notes-changed"));
  return added.length;
}

// Downscale a picked image to a compact JPEG data-URL so localStorage stays sane. Caps the
// longest edge at ~1000px and steps the quality DOWN until the base64 string is under the byte
// budget; returns null if it still can't fit (caller warns + skips the image, keeps the note).
function downscaleImage(file: File, maxEdge = 900, maxChars = 500_000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, w, h);
        let q = 0.72;
        let data = canvas.toDataURL("image/jpeg", q);
        while (data.length > maxChars && q > 0.35) { q -= 0.12; data = canvas.toDataURL("image/jpeg", q); }
        resolve(data.length > maxChars ? null : data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch { resolve(null); }
  });
}

// Real screen-region capture (the Cmd+Shift+4 equivalent). getDisplayMedia prompts the user to pick a
// screen/window/tab, we grab ONE frame into a canvas and stop the track immediately. Uses a <video>
// element (works in Chrome AND Safari — unlike ImageCapture, which Safari lacks). Throws on
// cancel/deny (NotAllowedError/AbortError) so the caller can show a clean "use Upload" message.
async function grabDisplayFrame(): Promise<HTMLCanvasElement | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false } as any);
  try {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    (video as any).playsInline = true;
    try { await video.play(); } catch { /* autoplay quirks — the frame may still be drawable */ }
    // Wait until a real frame is available (videoWidth>0), with a short safety timeout.
    await new Promise<void>((res) => {
      if (video.videoWidth > 0) { res(); return; }
      const done = () => { video.removeEventListener("loadeddata", done); res(); };
      video.addEventListener("loadeddata", done);
      setTimeout(done, 800);
    });
    const s = (track && track.getSettings && track.getSettings()) || {};
    const w = video.videoWidth || (s as any).width || window.innerWidth;
    const h = video.videoHeight || (s as any).height || window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    // Stop capture immediately — we only needed one frame, no persistent screen-share.
    stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* */ } });
  }
}

// Same downscale contract as downscaleImage(), but from an already-rendered <canvas> — used by the
// region-screenshot ("צילום חתיכת מסך") flow, which crops a rectangle out of a captured frame.
// Feeds the SAME compact-JPEG data-URL into the attachment pipeline; null if it can't fit the budget.
function downscaleCanvasToDataUrl(src: HTMLCanvasElement, maxEdge = 900, maxChars = 500_000): string | null {
  try {
    const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, w, h);
    let q = 0.72;
    let data = canvas.toDataURL("image/jpeg", q);
    while (data.length > maxChars && q > 0.35) { q -= 0.12; data = canvas.toDataURL("image/jpeg", q); }
    return data.length > maxChars ? null : data;
  } catch { return null; }
}

export default function ReviewMode() {
  const { lang } = useI18n();
  const he = lang === "he";
  const loc = useLocation();
  const mobile = useIsMobile();

  const [on, setOn] = useState<boolean>(() => { try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; } });
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [draftImages, setDraftImages] = useState<string[]>([]);        // pending files (data-URLs) for the add form
  const [imgBusy, setImgBusy] = useState(false);                       // downscaling in progress
  const [imgWarn, setImgWarn] = useState("");                          // "too large / cap reached" notice
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);        // "+" attach chooser (camera · upload · region)
  const [capturing, setCapturing] = useState(false);                  // html2canvas render in progress (region shot)
  const [snapCanvas, setSnapCanvas] = useState<HTMLCanvasElement | null>(null); // rendered page → drag-to-crop overlay
  const [lightbox, setLightbox] = useState<string | null>(null);       // full-view screenshot data-URL
  const [confirmClear, setConfirmClear] = useState(false);            // inline 2-step "Clear all" (no native confirm)
  const [submitting, setSubmitting] = useState(false);                // POSTing "Send to Dan"
  const [menuOpen, setMenuOpen] = useState(false);                    // the collapsed FAB's expand popover
  const [mgmtOpen, setMgmtOpen] = useState(false);                    // Management shortcut → inbox as a modal child screen

  useEffect(() => { try { localStorage.setItem(ON_KEY, on ? "1" : "0"); } catch { /* */ } }, [on]);
  useEffect(() => { saveNotes(notes); }, [notes]);
  // Opened from the side-menu "Review mode" entry (Shell) — turn the tool ON and show the notes
  // panel so it's reachable app-wide, not only via the floating pill (which Dan could miss).
  useEffect(() => {
    const open = () => { setOn(true); setPanelOpen(true); };
    window.addEventListener("algo770-review-open", open);
    return () => window.removeEventListener("algo770-review-open", open);
  }, []);
  // The mini-portal's "Add to mine" appends to localStorage + fires this — reload so the merged
  // tasks appear here immediately.
  useEffect(() => {
    const reload = () => setNotes(loadNotes());
    window.addEventListener("algo770-review-notes-changed", reload);
    return () => window.removeEventListener("algo770-review-notes-changed", reload);
  }, []);
  // Grouped view (screen route → its notes). Computed here — BEFORE the gate — so
  // every hook runs on every render regardless of role (rules-of-hooks).
  const grouped = useMemoGroups(notes);

  // Visibility gate — the OWNERS (Dan/Rafi/Yoav) + the portal collaborators Oren (it_editor),
  // Raz (legal_editor) and Raful (biz_editor). Everyone else never sees any of this. Mirrors the
  // backend require_owner_or_admin. Checked AFTER hooks so hook order stays stable.
  if (!isReviewer()) return null;

  const route = loc.pathname || "/";
  const here = screenName(route, he);
  const countHere = notes.filter((n) => n.route === route).length;

  function resetForm() { setDraft(""); setDraftImages([]); setImgWarn(""); setImgBusy(false); setAdding(false); setAttachMenuOpen(false); }
  function addNote() {
    const text = draft.trim();
    if (!text) return;
    const ts = Date.now();
    const id = newId(ts);
    setNotes((prev) => [...prev, { id, code: shortCode(id), screen: here, route, text, timestamp: ts, images: draftImages }]);
    resetForm();
  }

  // Pick UP TO 10 files (images; camera on mobile). Each is downscaled; enforces the count cap and
  // a per-task total-size budget (warn + attach what fits when over).
  async function pickImages(files: FileList | null) {
    if (!files || !files.length) return;
    setImgWarn(""); setImgBusy(true);
    const cur = [...draftImages];
    let curBytes = cur.reduce((a, s) => a + s.length, 0);
    let hitCount = false, hitSize = false, failed = false;
    for (const file of Array.from(files)) {
      if (cur.length >= MAX_FILES) { hitCount = true; break; }
      const data = await downscaleImage(file);
      if (!data) { failed = true; continue; }
      if (curBytes + data.length > MAX_NOTE_BYTES) { hitSize = true; continue; }
      cur.push(data); curBytes += data.length;
    }
    setDraftImages(cur);
    setImgBusy(false);
    setImgWarn(
      hitCount ? (he ? `מקסימום ${MAX_FILES} קבצים למשימה.` : `Max ${MAX_FILES} files per task.`)
      : hitSize ? (he ? "חלק מהקבצים גדולים מדי וצורפו רק אלה שנכנסו." : "Some files were too large — attached what fits.")
      : failed ? (he ? "חלק מהקבצים לא נתמכו." : "Some files couldn't be added.")
      : "");
  }
  const removeDraftImage = (i: number) => setDraftImages((p) => p.filter((_, k) => k !== i));

  // REGION SCREENSHOT ("צילום חתיכת מסך") — snip a piece of the screen and attach it.
  // PRIMARY = the real Screen Capture API (getDisplayMedia): the browser prompts the reviewer to pick
  // a screen/window/tab, we grab ONE frame, then show the drag-to-crop overlay → crop → attach. This is
  // the Cmd+Shift+4 equivalent Dan asked for (Mac desktop); the picker prompt is expected — browsers
  // don't allow silent screen capture. It captures the REAL pixels, so a heavy/animated page that broke
  // the old html2canvas DOM-render works fine here. Cancel/deny → clean "use Upload" message, never a
  // broken state. SECONDARY (only when getDisplayMedia is absent, e.g. some mobile browsers) = the old
  // html2canvas DOM render, with the QA widget excluded via [data-qa-root].
  async function startRegionCapture() {
    setAttachMenuOpen(false);
    setMenuOpen(false);
    setImgWarn("");
    const md: any = typeof navigator !== "undefined" ? navigator.mediaDevices : null;
    if (md && typeof md.getDisplayMedia === "function") {
      try {
        const canvas = await grabDisplayFrame();
        if (canvas) { setSnapCanvas(canvas); return; }
        setImgWarn(he ? "לא הצלחנו לצלם את המסך — נסה „העלה תמונה”." : "Couldn't capture the screen — try “Upload image”.");
        return;
      } catch (e: any) {
        const name = e?.name || "";
        // User dismissed the picker / denied permission — expected, not an error state.
        if (name === "NotAllowedError" || name === "AbortError" || name === "NotFoundError") {
          setImgWarn(he ? "הצילום בוטל. אפשר במקום זאת „העלה תמונה”." : "Capture cancelled — you can “Upload image” instead.");
          return;
        }
        // Any other failure → fall through to the html2canvas secondary path below.
      }
    }
    // SECONDARY fallback: html2canvas DOM render (lazy-imported so it never touches the main bundle).
    setCapturing(true);
    try {
      const mod: any = await import("html2canvas");
      const h2c = mod.default || mod;
      const bg = (() => { try { return getComputedStyle(document.body).backgroundColor || "#0b0d10"; } catch { return "#0b0d10"; } })();
      const canvas: HTMLCanvasElement = await h2c(document.body, {
        ignoreElements: (el: Element) => !!(el as HTMLElement)?.getAttribute?.("data-qa-root"),
        backgroundColor: bg,
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        logging: false,
      });
      setSnapCanvas(canvas);
    } catch {
      setImgWarn(he ? "צילום המסך נכשל — נסה „העלה תמונה”." : "Screen capture failed — try “Upload image”.");
    } finally {
      setCapturing(false);
    }
  }
  // Attach the cropped region (a <canvas>) through the SAME downscale + count/size budget as picked
  // files, then close the crop overlay.
  function addCanvasImage(src: HTMLCanvasElement) {
    const data = downscaleCanvasToDataUrl(src);
    setSnapCanvas(null);
    if (!data) { setImgWarn(he ? "התמונה גדולה מדי לצירוף." : "Image too large to attach."); return; }
    setDraftImages((cur) => {
      if (cur.length >= MAX_FILES) { setImgWarn(he ? `מקסימום ${MAX_FILES} קבצים למשימה.` : `Max ${MAX_FILES} files per task.`); return cur; }
      const bytes = cur.reduce((a, s) => a + s.length, 0);
      if (bytes + data.length > MAX_NOTE_BYTES) { setImgWarn(he ? "אין מספיק מקום — הקובץ גדול מדי." : "Not enough room — file too large."); return cur; }
      return [...cur, data];
    });
  }

  function removeNote(id: string) { setNotes((prev) => prev.filter((n) => n.id !== id)); }
  function commitEdit() {
    if (editingId == null) return;
    const text = editText.trim();
    setNotes((prev) => text
      ? prev.map((n) => (n.id === editingId ? { ...n, text } : n))
      : prev.filter((n) => n.id !== editingId));
    setEditingId(null);
    setEditText("");
  }
  // Inline 2-step clear (no native confirm() — it can be silently blocked in a mobile PWA,
  // which was one way "delete" appeared to do nothing). First tap arms; second tap clears.
  function clearAll() {
    if (!notes.length) return;
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3500); return; }
    setConfirmClear(false);
    setNotes([]);
  }
  // Send this reviewer's collected notes to the shared board (Dan's mini-portal). Submits each
  // task with its code + timestamp + files (data-URLs, which travel to the inbox) + the compiled
  // prompt. Local notes are KEPT (no auto-clear) so a mid-review send is a safe checkpoint.
  async function submitToDan() {
    if (!notes.length || submitting) return;
    setSubmitting(true);
    try {
      const payload = notes.map((n) => ({
        screen: n.screen, route: n.route, text: n.text, code: n.code,
        ts: n.timestamp ? new Date(n.timestamp).toISOString() : "",
        files: n.images || [],
      }));
      await api.reviewSubmit(payload, buildPrompt(grouped));
      toastSuccess(he ? "נשלח לדן ✓" : "Sent to Dan ✓");
    } catch (e: any) {
      toastError(e?.message || (he ? "השליחה נכשלה" : "Send failed"));
    } finally { setSubmitting(false); }
  }

  const btnFont: React.CSSProperties = { fontFamily: UI, cursor: "pointer" };
  // One row of the "+" attach chooser (upload · camera · region screenshot).
  const attachItemStyle: React.CSSProperties = { ...btnFont, display: "flex", alignItems: "center", gap: 9,
    width: "100%", boxSizing: "border-box", borderRadius: 10, padding: "9px 11px", fontWeight: 800,
    fontSize: 13, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, textAlign: "start" };

  // ── COLLAPSED FAB (top inline-end edge gutter — clear of the top header buttons AND the
  //    bottom content/tab-bar, on both desktop & mobile). ONE small pill that EXPANDS into a
  //    popover with the on/off toggle + Add-fix + Notes. Dan: "move it up top so it doesn't
  //    interfere." The edge gutter is already reserved (never holds page content), so this
  //    never covers anything. Menu items each also close the menu. ──
  const openAdd = () => { setAdding(true); setPanelOpen(false); setMenuOpen(false); };
  const openNotes = () => { setPanelOpen(true); setAdding(false); setMenuOpen(false); };
  const menuItem: React.CSSProperties = { ...btnFont, display: "flex", alignItems: "center", gap: 9,
    width: "100%", boxSizing: "border-box", borderRadius: 12, padding: "10px 13px", fontWeight: 800,
    fontSize: 13.5, background: C.surface2, color: C.text, border: `1px solid ${C.line}`, textAlign: "start" };
  const fab = (
    // Docked to the inline-END edge (Dan #1738: left in the RTL default). RAISED into the band
    // BESIDE the two centred big buttons (Dan #5164), so it never sits over the full-width
    // Portfolio card / "Personal Portal" button in EITHER language:
    //   • MOBILE — a fixed PIXEL top (~345px) anchored to the content stack (which is top-pinned
    //     and no-scroll), so it lands beside the centred, narrow big-buttons row — whose wide side
    //     margins are the one mid-page band clear of content on BOTH edges (RTL left · LTR right).
    //     A % drifts with viewport height (on a tall iPhone 55% fell onto the Portfolio card).
    //   • DESKTOP — ONE global button, but screens differ: Home is a centred 600px column (wide
    //     margins) while inner screens (e.g. /activity's closed-log TABLE) use a ~900px column that
    //     nearly fills wide monitors. Anchoring to the 600 column (Dan #5164b) put the pill OUTSIDE
    //     the 600 edge but ON the wider 900 table (Dan #5164c). The only spot clear of the WIDEST
    //     content on a wide monitor is the FAR inline-end margin, so pin it at a modest fixed inset
    //     (30px) from the raw viewport edge — off the 900 table, and a small (non-glued) gap on
    //     Home. Clearing content everywhere wins over hugging Home's narrow column. px only (NO vh).
    <div style={{ position: "fixed", insetInlineEnd: mobile ? 10 : 30, top: mobile ? 345 : "44%",
      zIndex: 46, fontFamily: UI }}>
      {/* "QA" pill trigger (Dan #5164) — reads "QA" in BOTH languages (dir:ltr guards the RTL
          layout so it never mis-orders); a small count badge shows when notes exist. */}
      <button onClick={() => setMenuOpen((o) => !o)}
        title={on ? "QA — open menu" : "QA"}
        aria-label="QA" aria-expanded={menuOpen}
        style={{ ...btnFont, position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
          height: 38, minWidth: 44, padding: "0 15px", borderRadius: 999,
          background: on ? C.gold : C.surface, color: on ? "var(--btn-ink)" : C.muted,
          border: `1.5px solid ${on ? C.gold : C.line}`, boxShadow: SHADOW }}>
        <span dir="ltr" style={{ fontWeight: 900, fontSize: 14.5, letterSpacing: "0.06em" }}>QA</span>
        {on && notes.length > 0 && (
          <span style={{ position: "absolute", top: -6, insetInlineEnd: -6, minWidth: 18, height: 18,
            padding: "0 4px", borderRadius: 999, fontSize: 10.5, fontWeight: 900, display: "inline-flex",
            alignItems: "center", justifyContent: "center", background: C.surface, color: C.gold,
            border: `1.5px solid ${C.gold}` }}>{notes.length}</span>
        )}
      </button>
      {menuOpen && (
        <>
          {/* Outside-tap catcher (transparent, full-viewport) — closes the popover. */}
          <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 45, background: "transparent" }} />
          <div style={{ position: "absolute", top: "calc(100% + 8px)", insetInlineEnd: 0, zIndex: 47,
            width: 210, display: "flex", flexDirection: "column", gap: 8,
            background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 10,
            boxShadow: "0 18px 44px rgba(0,0,0,0.4)" }}>
            {/* On/off toggle row */}
            <button onClick={() => setOn((v) => !v)} style={{ ...menuItem, justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                <Power size={16} color={on ? C.gain : C.muted} />
                {he ? "מצב סקירה" : "Review mode"}
              </span>
              <span aria-hidden style={{ position: "relative", width: 38, height: 22, borderRadius: 999,
                background: on ? C.gold : C.line, transition: "background .15s", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 2, insetInlineStart: on ? 18 : 2, width: 18, height: 18,
                  borderRadius: "50%", background: "#fff", transition: "inset-inline-start .15s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.35)" }} />
              </span>
            </button>
            {on && (
              <>
                <button onClick={openAdd} className="gbtn" style={{ ...btnFont, display: "flex", alignItems: "center",
                  gap: 9, width: "100%", boxSizing: "border-box", borderRadius: 12, padding: "11px 13px",
                  fontWeight: 800, fontSize: 13.5, justifyContent: "flex-start" }}>
                  <Plus size={17} /> {he ? "הוסף תיקון" : "Add fix"}
                </button>
                <button onClick={openNotes} style={menuItem}>
                  <ClipboardList size={16} color={C.gold} />
                  <span style={{ flex: 1 }}>{he ? "הערות" : "Notes"}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, fontSize: 12, fontWeight: 900,
                    background: C.gold, color: "var(--btn-ink)" }}>{notes.length}</span>
                </button>
              </>
            )}
            {/* Management shortcut — opens the review inbox / mini-portal as a mobile-friendly modal
                child screen (not a route), so it's quick to open & close from anywhere. Always shown. */}
            <button onClick={() => { setMgmtOpen(true); setMenuOpen(false); }} style={menuItem}>
              <Inbox size={16} color={C.gold} />
              <span style={{ flex: 1 }}>{he ? "ניהול" : "Management"}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );

  // ── Add-fix mini form (centered card over a scrim) ──
  const addForm = adding && (
    <Scrim onClose={resetForm}>
      <div onClick={(e) => e.stopPropagation()} style={cardStyle()}>
        <Header he={he} onClose={resetForm}
          title={he ? "הוסף תיקון למסך זה" : "Add a fix for this screen"} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
          fontSize: 12.5, color: C.muted, background: C.surface2, border: `1px solid ${C.line}`,
          borderRadius: RADIUS.md, padding: "8px 11px" }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: C.gold, flexShrink: 0 }} />
          <strong style={{ color: C.text }}>{here}</strong>
          <code style={{ fontSize: 11.5, color: C.faint, direction: "ltr" }}>{route}</code>
        </div>
        <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addNote(); }}
          placeholder={he ? "מה לתקן במסך הזה?" : "What should be fixed on this screen?"}
          style={{ width: "100%", boxSizing: "border-box", minHeight: 96, resize: "vertical",
            background: C.surface2, border: `1px solid ${C.line}`, borderRadius: RADIUS.md,
            padding: "11px 13px", color: C.text, fontSize: 14, fontFamily: UI, outline: "none" }} />

        {/* Attach UP TO 10 files (images; camera on mobile). Each is downscaled compactly. Shows a
            thumbnail grid with per-file remove; the whole set travels to Dan's inbox on submit. */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {draftImages.map((src, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={src} alt="" onClick={() => setLightbox(src)}
                  style={{ height: 56, width: 56, borderRadius: 8, cursor: "zoom-in", objectFit: "cover", border: `1px solid ${C.line}` }} />
                <button onClick={() => removeDraftImage(i)} aria-label={he ? "הסר" : "Remove"}
                  style={{ ...btnFont, position: "absolute", top: -6, insetInlineEnd: -6, width: 20, height: 20, borderRadius: "50%",
                    background: C.loss, color: "#fff", border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {draftImages.length < MAX_FILES && (
              <div style={{ position: "relative" }}>
                {/* "+" tile → opens a 3-way chooser: camera · upload-from-device · region screenshot. */}
                <button type="button" onClick={() => setAttachMenuOpen((o) => !o)}
                  aria-label={he ? "צרף" : "Attach"} aria-expanded={attachMenuOpen}
                  style={{ ...btnFont, display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                    width: 56, height: 56, borderRadius: 8, background: C.surface2, color: C.gold, border: `1px dashed ${C.gold}` }}>
                  {imgBusy || capturing ? <ImageIcon size={18} /> : <Plus size={18} color={C.gold} />}
                  <span style={{ fontSize: 9, color: C.muted }}>{draftImages.length}/{MAX_FILES}</span>
                </button>
                {attachMenuOpen && (
                  <>
                    {/* Outside-tap catcher — closes the chooser. */}
                    <div onClick={() => setAttachMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 57, background: "transparent" }} />
                    <div style={{ position: "absolute", bottom: "calc(100% + 8px)", insetInlineStart: 0, zIndex: 58,
                      width: 224, display: "flex", flexDirection: "column", gap: 6,
                      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: 8,
                      boxShadow: "0 18px 44px rgba(0,0,0,0.4)" }}>
                      {/* UPLOAD FROM DEVICE — file picker with NO capture attr, so mobile offers gallery/files. */}
                      <label style={attachItemStyle}>
                        <Upload size={17} color={C.gold} />
                        <span style={{ flex: 1 }}>{he ? "העלה תמונה" : "Upload image"}</span>
                        <input type="file" accept="image/*" multiple style={{ display: "none" }}
                          onChange={(e) => { void pickImages(e.target.files); e.currentTarget.value = ""; setAttachMenuOpen(false); }} />
                      </label>
                      {/* CAMERA — capture="environment" forces the rear camera on mobile. */}
                      <label style={attachItemStyle}>
                        <Camera size={17} color={C.gold} />
                        <span style={{ flex: 1 }}>{he ? "מצלמה" : "Camera"}</span>
                        <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                          onChange={(e) => { void pickImages(e.target.files); e.currentTarget.value = ""; setAttachMenuOpen(false); }} />
                      </label>
                      {/* REGION SCREENSHOT — snip a piece of the current screen (html2canvas + drag-crop). */}
                      <button type="button" onClick={() => { void startRegionCapture(); }} style={{ ...attachItemStyle, cursor: "pointer" }}>
                        <Scissors size={17} color={C.gold} />
                        <span style={{ flex: 1, textAlign: "start" }}>{he ? "צילום חתיכת מסך" : "Region screenshot"}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {imgWarn && <div style={{ marginTop: 8, fontSize: 12, color: C.loss }}>{imgWarn}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={addNote} disabled={!draft.trim()} className="gbtn" style={{ ...btnFont,
            flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            borderRadius: RADIUS.md, padding: "12px 16px", fontWeight: 800, fontSize: 14,
            opacity: draft.trim() ? 1 : 0.5 }}>
            <Check size={17} /> {he ? "שמור" : "Save"}
          </button>
          <button onClick={resetForm} style={{ ...btnFont,
            borderRadius: RADIUS.md, padding: "12px 18px", fontWeight: 700, fontSize: 14,
            background: C.surface2, color: C.text, border: `1px solid ${C.line}` }}>
            {he ? "ביטול" : "Cancel"}
          </button>
        </div>
      </div>
    </Scrim>
  );

  // ── Notes panel (slide-in from inline-end), grouped by screen ──
  const panel = panelOpen && (
    <Scrim onClose={() => setPanelOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "fixed", insetBlock: 0, insetInlineEnd: 0, width: "min(440px, 92vw)",
        background: C.surface, borderInlineStart: `1px solid ${C.line}`,
        boxShadow: "0 0 40px rgba(0,0,0,0.45)", display: "flex", flexDirection: "column",
        fontFamily: UI, animation: "revSlide .22s ease" }}>
        <style>{"@keyframes revSlide{from{transform:translateX(var(--rev-x,100%))}to{transform:translateX(0)}}"}</style>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          padding: "16px 18px", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontSize: 17, fontWeight: 800, color: C.text }}>
            <ClipboardList size={19} style={{ color: C.gold }} />
            {he ? "הערות סקירה" : "Review notes"}
            <span style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>({notes.length})</span>
          </span>
          <button onClick={() => setPanelOpen(false)} aria-label={he ? "סגור" : "Close"} className="tap44"
            style={{ ...btnFont, background: C.surface2, border: `1px solid ${C.line}`, color: C.muted,
              borderRadius: 10, width: 34, height: 34, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px" }}>
          {notes.length === 0 ? (
            <div style={{ textAlign: "center", color: C.muted, padding: "48px 16px", fontSize: 14, lineHeight: 1.6 }}>
              {he ? "אין הערות עדיין. עבור מסך-מסך ולחץ „הוסף תיקון”." : "No notes yet. Move screen to screen and tap “Add fix”."}
            </div>
          ) : grouped.map((g) => (
            <div key={g.route} style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{g.screen}</span>
                <code style={{ fontSize: 11, color: C.faint, direction: "ltr" }}>{g.route}</code>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((n) => (
                  <div key={n.id} style={{ background: C.surface2, border: `1px solid ${C.line}`,
                    borderRadius: RADIUS.md, padding: "10px 12px" }}>
                    {editingId === n.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <textarea autoFocus value={editText} onChange={(e) => setEditText(e.target.value)}
                          style={{ width: "100%", boxSizing: "border-box", minHeight: 64, resize: "vertical",
                            background: C.surface, border: `1px solid ${C.line}`, borderRadius: 10,
                            padding: "8px 10px", color: C.text, fontSize: 13.5, fontFamily: UI, outline: "none" }} />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={commitEdit} className="gbtn" style={{ ...btnFont, display: "inline-flex",
                            alignItems: "center", gap: 6, borderRadius: 9, padding: "7px 12px", fontWeight: 700, fontSize: 12.5 }}>
                            <Check size={14} /> {he ? "עדכן" : "Save"}
                          </button>
                          <button onClick={() => { setEditingId(null); setEditText(""); }} style={{ ...btnFont,
                            borderRadius: 9, padding: "7px 12px", fontWeight: 600, fontSize: 12.5,
                            background: C.surface, color: C.text, border: `1px solid ${C.line}` }}>
                            {he ? "ביטול" : "Cancel"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* short code + created date/time — so a similar fix can be traced to when. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.faint }}>
                          <span style={{ fontWeight: 800, color: C.gold, direction: "ltr" }}>#{n.code}</span>
                          <span style={{ direction: "ltr" }}>{fmtTs(n.timestamp)}</span>
                          {(n.images || []).length > 0 && <span>· {(n.images || []).length} {he ? "קבצים" : "files"}</span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5, color: C.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.text}</span>
                          <button onClick={() => { setEditingId(n.id); setEditText(n.text); }} aria-label={he ? "עריכה" : "Edit"} className="tap44"
                            style={{ ...btnFont, background: "none", border: "none", color: C.muted, padding: 6, flexShrink: 0, display: "inline-flex" }}>
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => removeNote(n.id)} aria-label={he ? "מחיקה" : "Delete"} className="tap44"
                            style={{ ...btnFont, background: "none", border: "none", color: C.loss, padding: 6, flexShrink: 0, display: "inline-flex" }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {(n.images || []).length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {(n.images || []).map((src, k) => (
                              <img key={k} src={src} alt="" onClick={() => setLightbox(src)}
                                style={{ height: 56, width: 56, borderRadius: 8, cursor: "zoom-in", objectFit: "cover", border: `1px solid ${C.line}` }} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderTop: `1px solid ${C.line}` }}>
          {/* PRIMARY: send this reviewer's collected notes to the shared board (Dan's inbox). */}
          <button onClick={submitToDan} disabled={!notes.length || submitting} className="gbtn" style={{ ...btnFont,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            borderRadius: RADIUS.md, padding: "13px 14px", fontWeight: 800, fontSize: 14.5, opacity: (notes.length && !submitting) ? 1 : 0.5 }}>
            <Send size={17} /> {submitting ? (he ? "שולח…" : "Sending…") : (he ? "שלח לדן" : "Send to Dan")}
          </button>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setPromptOpen(true); }} disabled={!notes.length} style={{ ...btnFont,
              flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              borderRadius: RADIUS.md, padding: "11px 14px", fontWeight: 700, fontSize: 13.5,
              background: C.surface2, color: C.text, border: `1px solid ${C.line}`, opacity: notes.length ? 1 : 0.5 }}>
              <ClipboardCheck size={16} /> {he ? "פרומפט" : "Prompt"}
            </button>
            <button onClick={clearAll} disabled={!notes.length} style={{ ...btnFont,
              display: "inline-flex", alignItems: "center", gap: 7, borderRadius: RADIUS.md, padding: "11px 14px",
              fontWeight: 700, fontSize: 13.5, background: confirmClear ? C.loss : C.surface2, color: confirmClear ? "#fff" : C.loss,
              border: `1px solid ${confirmClear ? C.loss : C.line}`, opacity: notes.length ? 1 : 0.5 }}>
              <Trash2 size={15} /> {confirmClear ? (he ? "בטוח?" : "Sure?") : (he ? "נקה" : "Clear")}
            </button>
          </div>
        </div>
      </div>
    </Scrim>
  );

  const promptModal = promptOpen && (
    <PromptModal he={he} groups={grouped} onClose={() => setPromptOpen(false)}
      onClearAfter={() => { setNotes([]); setPromptOpen(false); setPanelOpen(false); }} />
  );

  // Full-screen screenshot viewer (tap a thumbnail).
  const lightboxModal = lightbox && (
    <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 60,
      background: "rgba(0,0,0,0.85)", display: "grid", placeItems: "center", padding: 16 }}>
      <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }} />
      <button onClick={() => setLightbox(null)} aria-label={he ? "סגור" : "Close"} className="tap44"
        style={{ ...btnFont, position: "fixed", top: 14, insetInlineEnd: 14, background: "rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 999, width: 40, height: 40,
          display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <X size={20} />
      </button>
    </div>
  );

  // ── MANAGEMENT modal — the review inbox / mini-portal as a small CHILD SCREEN (overlay), not a
  //    route. Mobile: a full-screen sheet that fits the viewport and scrolls INTERNALLY (no page
  //    overflow); desktop: a large centred panel. The embedded ReviewInbox renders its own header
  //    whose back control becomes an ✕ that calls onClose. ──
  const closeMgmt = () => setMgmtOpen(false);
  const mgmtModal = mgmtOpen && (
    <div onClick={closeMgmt} style={{ position: "fixed", inset: 0, zIndex: 56, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: mobile ? "stretch" : "center", justifyContent: "center",
      padding: mobile ? 0 : 20, fontFamily: UI }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        display: "flex", flexDirection: "column", overflow: "hidden", background: C.bg,
        width: mobile ? "100%" : "min(920px, 96vw)",
        height: mobile ? "100%" : "auto",
        maxHeight: mobile ? "100%" : "88vh",
        border: mobile ? "none" : `1px solid ${C.line}`,
        borderRadius: mobile ? 0 : 18,
        boxShadow: mobile ? "none" : "0 24px 60px rgba(0,0,0,0.5)",
        // iOS: respect the notch/home-indicator safe areas on the full-screen sheet.
        paddingTop: mobile ? "env(safe-area-inset-top, 0px)" : 0,
        paddingBottom: mobile ? "env(safe-area-inset-bottom, 0px)" : 0,
      }}>
        {/* The scroll region — content scrolls here, the sheet itself never overflows the viewport. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          <Suspense fallback={
            <div style={{ display: "grid", placeItems: "center", padding: "80px 0", color: C.muted }}>
              <div style={{ width: 26, height: 26, border: `3px solid ${C.line}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
            </div>
          }>
            <ReviewInboxModal embedded onClose={closeMgmt} />
          </Suspense>
        </div>
      </div>
    </div>
  );

  // Brief "rendering the screen…" veil while html2canvas works (can take a few hundred ms).
  const capturingOverlay = capturing && (
    <div style={{ position: "fixed", inset: 0, zIndex: 62, background: "rgba(0,0,0,0.35)",
      display: "grid", placeItems: "center", fontFamily: UI }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.surface,
        border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 18px", color: C.text, fontWeight: 800, fontSize: 13.5 }}>
        <div style={{ width: 18, height: 18, border: `3px solid ${C.line}`, borderTopColor: C.gold, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        {he ? "מצלם את המסך…" : "Capturing screen…"}
      </div>
    </div>
  );

  // Drag-to-select crop overlay over the rendered page (region screenshot).
  const cropper = snapCanvas && (
    <RegionCropper he={he} canvas={snapCanvas} onCrop={addCanvasImage} onCancel={() => setSnapCanvas(null)} />
  );

  // Everything is wrapped in a single [data-qa-root] node so the region-screenshot render can EXCLUDE
  // the entire QA widget (and its overlays) from the captured page. The wrapper is a static block with
  // no transform, so its position:fixed children still anchor to the viewport.
  return createPortal(
    <div data-qa-root="">{fab}{addForm}{panel}{promptModal}{lightboxModal}{mgmtModal}{capturingOverlay}{cropper}</div>,
    document.body,
  );
}

// ── Region cropper — drag a rectangle over the rendered page to snip a piece of it ──
// Shows the html2canvas render fit-to-viewport; the user drags a box; on release the box is mapped
// back to source-canvas pixels and cropped into a fresh <canvas> handed to onCrop (→ downscale →
// attach). Pointer events cover mouse + touch, so it works on mobile with no OS permission.
function RegionCropper({ he, canvas, onCrop, onCancel }: {
  he: boolean; canvas: HTMLCanvasElement; onCrop: (c: HTMLCanvasElement) => void; onCancel: () => void;
}) {
  const bg = useMemo(() => { try { return canvas.toDataURL("image/png"); } catch { return ""; } }, [canvas]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onCancel]);

  const rectOf = (d: { sx: number; sy: number; cx: number; cy: number } | null) =>
    d ? { left: Math.min(d.sx, d.cx), top: Math.min(d.sy, d.cy), w: Math.abs(d.cx - d.sx), h: Math.abs(d.cy - d.sy) } : null;

  // Pointer position relative to the displayed image (clamped inside it).
  function rel(e: React.PointerEvent) {
    const el = imgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
  }
  function down(e: React.PointerEvent) {
    const p = rel(e);
    setDrag({ sx: p.x, sy: p.y, cx: p.x, cy: p.y });
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* */ }
    e.preventDefault();
  }
  function move(e: React.PointerEvent) { if (drag) { const p = rel(e); setDrag((d) => (d ? { ...d, cx: p.x, cy: p.y } : d)); } }
  function up() {
    const rc = rectOf(drag);
    const el = imgRef.current;
    if (rc && el && rc.w > 8 && rc.h > 8) {
      const r = el.getBoundingClientRect();
      const rx = canvas.width / r.width, ry = canvas.height / r.height;   // displayed → source pixels
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(rc.w * rx));
      out.height = Math.max(1, Math.round(rc.h * ry));
      const ctx = out.getContext("2d");
      if (ctx) { ctx.drawImage(canvas, rc.left * rx, rc.top * ry, rc.w * rx, rc.h * ry, 0, 0, out.width, out.height); onCrop(out); return; }
    }
    setDrag(null);
  }

  const sel = rectOf(drag);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 61, background: "rgba(0,0,0,0.55)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 16, fontFamily: UI, touchAction: "none" }}>
      <div style={{ position: "relative", maxWidth: "96vw", maxHeight: "82vh" }}>
        <img ref={imgRef} src={bg} alt="" draggable={false}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ display: "block", maxWidth: "96vw", maxHeight: "82vh", borderRadius: 8,
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)", cursor: "crosshair", touchAction: "none", userSelect: "none" }} />
        {sel && sel.w > 1 && sel.h > 1 && (
          <div style={{ position: "absolute", left: sel.left, top: sel.top, width: sel.w, height: sel.h,
            border: `2px solid ${C.gold}`, background: "rgba(255,255,255,0.12)", boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
            pointerEvents: "none", borderRadius: 2 }} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, opacity: 0.92 }}>
          {he ? "גרור לבחירת אזור לצילום" : "Drag to select an area"}
        </span>
        <button type="button" onClick={onCancel} style={{ fontFamily: UI, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 7, borderRadius: 10, padding: "9px 16px",
          fontWeight: 800, fontSize: 13.5, background: C.surface, color: C.text, border: `1px solid ${C.line}` }}>
          <X size={15} /> {he ? "ביטול" : "Cancel"}
        </button>
      </div>
    </div>
  );
}

// ── Grouping (screen route → its notes), memoized ──
type Group = { route: string; screen: string; items: Note[] };
function useMemoGroups(notes: Note[]): Group[] {
  return useMemo(() => {
    const map = new Map<string, Group>();
    for (const n of notes) {
      let g = map.get(n.route);
      if (!g) { g = { route: n.route, screen: n.screen, items: [] }; map.set(n.route, g); }
      g.items.push(n);
    }
    return Array.from(map.values());
  }, [notes]);
}

function buildPrompt(groups: Group[]): string {
  // ALWAYS open with the scan-first header, then the task list. Each task line carries its
  // [#code · date] tag + a [N files] flag.
  let out = PROMPT_HEADER + "\n# Fix requests (by screen)\n";
  for (const g of groups) {
    out += `\n## ${g.screen} (${g.route})\n`;
    for (const n of g.items) {
      const nf = (n.images || []).length;
      const tag = `[#${n.code}${n.timestamp ? ` · ${fmtTs(n.timestamp)}` : ""}] `;
      const files = nf ? `  [${nf} file${nf !== 1 ? "s" : ""}]` : "";
      out += `- ${tag}${n.text.replace(/\r?\n/g, " ").trim()}${files}\n`;
    }
  }
  return out;
}

// ── Shared scrim (click-outside to close) ──
function Scrim({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 55,
      background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", padding: 20 }}>
      {children}
    </div>
  );
}

function cardStyle(): React.CSSProperties {
  return { width: "100%", maxWidth: 440, boxSizing: "border-box", background: C.surface,
    border: `1px solid ${C.line}`, borderRadius: RADIUS.lg, padding: "20px 22px",
    boxShadow: "0 24px 60px rgba(0,0,0,0.5)", fontFamily: UI };
}

function Header({ he, title, onClose }: { he: boolean; title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.text }}>{title}</h3>
      <button onClick={onClose} aria-label={he ? "סגור" : "Close"} className="tap44"
        style={{ fontFamily: UI, cursor: "pointer", background: C.surface2, border: `1px solid ${C.line}`,
          color: C.muted, borderRadius: 10, width: 34, height: 34, display: "inline-flex",
          alignItems: "center", justifyContent: "center" }}>
        <X size={18} />
      </button>
    </div>
  );
}

// ── Generate-prompt modal: the compiled markdown in a textarea + big Copy ──
function PromptModal({ he, groups, onClose, onClearAfter }: {
  he: boolean; groups: Group[]; onClose: () => void; onClearAfter: () => void;
}) {
  const text = useMemo(() => buildPrompt(groups), [groups]);
  const [copied, setCopied] = useState(false);
  const [clearAfter, setClearAfter] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      if (clearAfter) setTimeout(onClearAfter, 400);
    } catch { setCopied(false); }
  }

  const count = groups.reduce((a, g) => a + g.items.length, 0);
  return (
    <Scrim onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...cardStyle(), maxWidth: 640, display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
        <Header he={he} onClose={onClose} title={he ? "הפרומפט המוכן" : "Generated prompt"} />
        <p style={{ margin: "0 0 12px", fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
          {he
            ? `${count} הערות מ-${groups.length} מסכים. העתק והדבק לי את כל הטקסט.`
            : `${count} notes across ${groups.length} screens. Copy and paste the whole thing to me.`}
        </p>
        <textarea readOnly value={text} onFocus={(e) => e.currentTarget.select()}
          style={{ flex: 1, minHeight: 220, width: "100%", boxSizing: "border-box", resize: "vertical",
            background: C.surface2, border: `1px solid ${C.line}`, borderRadius: RADIUS.md,
            padding: "12px 14px", color: C.text, fontSize: 13, lineHeight: 1.5,
            fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", direction: "ltr", textAlign: "left", outline: "none" }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 2px 0", fontSize: 13, color: C.muted, cursor: "pointer" }}>
          <input type="checkbox" checked={clearAfter} onChange={(e) => setClearAfter(e.target.checked)} />
          {he ? "נקה את כל ההערות אחרי ההעתקה" : "Clear all notes after copying"}
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button onClick={copy} className="gbtn" style={{ fontFamily: UI, cursor: "pointer",
            flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            borderRadius: RADIUS.md, padding: "13px 16px", fontWeight: 800, fontSize: 15 }}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? (he ? "הועתק!" : "Copied!") : (he ? "העתק הכל" : "Copy all")}
          </button>
          <button onClick={onClose} style={{ fontFamily: UI, cursor: "pointer",
            borderRadius: RADIUS.md, padding: "13px 18px", fontWeight: 700, fontSize: 15,
            background: C.surface2, color: C.text, border: `1px solid ${C.line}` }}>
            {he ? "סגור" : "Close"}
          </button>
        </div>
      </div>
    </Scrim>
  );
}
