import React, { useEffect, useRef, useState } from "react";

// ── QaWidget — self-contained, dependency-free QA / Review widget (React only) ──────────────
// A floating "QA" button (gated by localStorage.qa === "1") that lets a reviewer file per-screen
// "fixes" on their phone: each note stamps the screen name + route + a short #ID hash and can carry
// up to 10 client-downscaled JPEG screenshots. Notes persist in localStorage["qa_notes"]. "Copy
// prompt" compiles every note into a paste-ready Markdown task list (a scan-first header, grouped by
// screen) that you hand to Cowork/Claude. The Markdown IS the bridge — no backend, no magic pipe.
//
// Drop-in: render <QaWidget/> once near your app root. It renders nothing unless the gate is set:
//   localStorage.setItem("qa","1")   // enable    ·    localStorage.removeItem("qa")  // disable

type Shot = { name: string; dataUrl: string };
type Note = { id: string; code: string; screen: string; route: string; text: string; shots: Shot[]; ts: number };

const LS_KEY = "qa_notes";

// Scan-first instruction prepended to the compiled task list so the fixer verifies the exact
// element before editing. The Markdown task list is the whole hand-off.
const PROMPT_HEADER = `You are fixing UI/UX issues in this app. FIRST scan the relevant screen/route and the
component that renders it before changing anything — confirm you found the exact element each note
refers to. Then apply the SMALLEST change that resolves the note. Work screen by screen, and after
each screen say what you changed. Ask before any risky or irreversible change.

Tasks:`;

let _counter = 0;
const newId = () => Date.now().toString(36) + "-" + ++_counter;

// 4-char base36 hash → a short, stable #CODE for traceability (not security; just a reference tag).
function shortCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 4).padStart(4, "0").toUpperCase();
}

// Downscale an image File to a JPEG data URL: max 900px on the long edge, then step quality down
// until it's under ~180KB. Entirely client-side so nothing large is ever kept or transmitted.
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 900;
      let w = img.width, h = img.height;
      if (w >= h && w > max) { h = Math.round((h * max) / w); w = max; }
      else if (h > w && h > max) { w = Math.round((w * max) / h); h = max; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no canvas ctx"));
      ctx.drawImage(img, 0, 0, w, h);
      let q = 0.82, out = c.toDataURL("image/jpeg", q);
      while (out.length > 180 * 1024 && q > 0.3) { q -= 0.12; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// Compile notes → a Markdown task list, grouped by screen, each line `- [#CODE · date] text [N img]`.
function buildPrompt(notes: Note[]): string {
  const byScreen = new Map<string, Note[]>();
  for (const n of notes) {
    const key = n.screen || n.route || "(unspecified)";
    (byScreen.get(key) || byScreen.set(key, []).get(key)!).push(n);
  }
  let out = PROMPT_HEADER + "\n";
  for (const [screen, list] of byScreen) {
    out += `\n### ${screen}\n`;
    for (const n of list) {
      const date = new Date(n.ts).toISOString().slice(0, 10);
      const imgs = n.shots.length ? ` [${n.shots.length} img]` : "";
      out += `- [#${n.code} · ${date}] ${n.text}${imgs}\n`;
    }
  }
  return out;
}

function loadNotes(): Note[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}

export default function QaWidget() {
  // Hooks run BEFORE the gate (rules of hooks) — we return null after them, never before.
  const [enabled] = useState(() => { try { return localStorage.getItem("qa") === "1"; } catch { return false; } });
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [screen, setScreen] = useState("");
  const [text, setText] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(notes)); } catch {} }, [notes]);
  useEffect(() => { setScreen((s) => s || document.title || location.pathname); }, []);

  if (!enabled) return null;

  const route = location.pathname + location.search;

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const room = Math.max(0, 10 - shots.length);
    const add: Shot[] = [];
    for (const f of Array.from(files).slice(0, room)) {
      try { add.push({ name: f.name, dataUrl: await downscaleImage(f) }); } catch {}
    }
    setShots((s) => [...s, ...add].slice(0, 10));
    if (fileRef.current) fileRef.current.value = "";
  }

  function addNote() {
    const t = text.trim();
    if (!t) return;
    const sc = (screen.trim() || document.title || location.pathname);
    const code = shortCode(sc + "|" + t + "|" + route);
    setNotes((ns) => [{ id: newId(), code, screen: sc, route, text: t, shots, ts: Date.now() }, ...ns]);
    setText(""); setShots([]);
  }

  function del(id: string) { setNotes((ns) => ns.filter((n) => n.id !== id)); }

  async function copyPrompt() {
    const md = buildPrompt(notes);
    try { await navigator.clipboard.writeText(md); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = md; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const S: Record<string, React.CSSProperties> = {
    wrap: { position: "fixed", right: 14, bottom: 14, zIndex: 999999, fontFamily: "system-ui, sans-serif", direction: "ltr" },
    pill: { display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 999, border: "none",
      background: "#5b6cff", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,.35)" },
    panel: { width: 320, maxWidth: "92vw", maxHeight: "78vh", overflowY: "auto", background: "#14161d", color: "#eef",
      border: "1px solid #2b2f3a", borderRadius: 16, padding: 12, boxShadow: "0 20px 60px rgba(0,0,0,.5)" },
    input: { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 9, border: "1px solid #333a49",
      background: "#0e1015", color: "#eef", fontSize: 13, marginBottom: 8 },
    btn: { padding: "8px 12px", borderRadius: 9, border: "none", background: "#5b6cff", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 },
    ghost: { padding: "8px 12px", borderRadius: 9, border: "1px solid #333a49", background: "transparent", color: "#aeb6c8", cursor: "pointer", fontSize: 13 },
    note: { border: "1px solid #262b36", borderRadius: 10, padding: "8px 10px", marginTop: 8, background: "#0e1015" },
  };

  if (!open) {
    return (
      <div style={S.wrap}>
        <button style={S.pill} onClick={() => setOpen(true)}>QA{notes.length ? ` · ${notes.length}` : ""}</button>
      </div>
    );
  }

  return (
    <div style={S.wrap}>
      <div style={S.panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <b style={{ fontSize: 15 }}>QA · Add fix</b>
          <button style={{ ...S.ghost, padding: "2px 8px" }} onClick={() => setOpen(false)}>×</button>
        </div>

        <input style={S.input} placeholder="Screen name" value={screen} onChange={(e) => setScreen(e.target.value)} />
        <div style={{ fontSize: 11, color: "#7d879b", marginTop: -4, marginBottom: 8 }}>route: {route}</div>
        <textarea style={{ ...S.input, minHeight: 64, resize: "vertical" }} placeholder="Describe the fix…" value={text} onChange={(e) => setText(e.target.value)} />

        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <button style={S.ghost} onClick={() => fileRef.current?.click()} disabled={shots.length >= 10}>📷 Add shot ({shots.length}/10)</button>
          {shots.map((s, i) => (
            <span key={i} style={{ position: "relative" }}>
              <img src={s.dataUrl} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid #333a49" }} />
              <button onClick={() => setShots((x) => x.filter((_, j) => j !== i))}
                style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, borderRadius: 999, border: "none", background: "#e0405a", color: "#fff", fontSize: 10, cursor: "pointer", lineHeight: "16px", padding: 0 }}>×</button>
            </span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button style={S.btn} onClick={addNote}>Add fix</button>
          <button style={S.ghost} onClick={copyPrompt}>{copied ? "Copied ✓" : "Copy prompt"}</button>
        </div>

        {notes.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 11, color: "#7d879b" }}>{notes.length} note(s)</div>
        )}
        {notes.map((n) => (
          <div key={n.id} style={S.note}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <b style={{ fontSize: 11, color: "#8ea0ff" }}>#{n.code} · {n.screen}</b>
              <button style={{ ...S.ghost, padding: "1px 7px" }} onClick={() => del(n.id)}>del</button>
            </div>
            <div style={{ fontSize: 13, marginTop: 3 }}>{n.text}</div>
            {n.shots.length > 0 && <div style={{ fontSize: 11, color: "#7d879b", marginTop: 3 }}>{n.shots.length} img</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
