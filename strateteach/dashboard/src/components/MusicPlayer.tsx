import React, { useEffect, useRef, useState } from "react";
import { Music, VolumeX, Headphones, AudioLines, Zap, Check, Upload, Loader2, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { api } from "../app/api";
import { useRailHidden } from "./DemoKit";

// Three young, fresh background tracks synthesised with the Web Audio API (no files):
//   • lofi  — chill lo-fi hip-hop: mellow 7th chords, soft beat, vinyl crackle
//   • house — bright four-on-the-floor with off-beat bass + plucky stabs
//   • trap  — half-time 808 sub, snappy snare, fast hi-hat rolls
// Floating button opens a picker (+ Off). Autostarts on first interaction.

type Style = "lofi" | "house" | "trap";
type Store = { ctx?: AudioContext; master?: GainNode; timers: number[]; style?: Style | null };

function helpers(ctx: AudioContext, master: GainNode) {
  const tone = (freq: number, t: number, dur: number, type: OscillatorType, vol: number) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
  };
  const noise = (t: number, dur: number, hp: number, vol: number) => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur)); const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const s = ctx.createBufferSource(); s.buffer = buf; const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
    const g = ctx.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(t);
  };
  const kick = (t: number, vol = 0.5) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
  };
  const sub = (freq: number, t: number, dur: number, vol: number) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.09);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  };
  return { tone, noise, kick, sub };
}

function scheduleLofi(R: Store) {
  const ctx = R.ctx!, master = R.master!; const { tone, noise, kick } = helpers(ctx, master);
  const CH = [
    { pad: [261.63, 329.63, 392, 493.88], bass: 130.81 }, { pad: [220, 261.63, 329.63, 392], bass: 110 },
    { pad: [293.66, 349.23, 440, 523.25], bass: 146.83 }, { pad: [196, 246.94, 293.66, 392], bass: 98 },
  ];
  const e = 60 / 78 / 2; const swing = e * 0.32; let step = 0;
  const tick = () => {
    if (!R.ctx) return; const ib = step % 8; const ch = CH[((step / 8) | 0) % 4];
    const t = ctx.currentTime + 0.06 + (ib % 2 ? swing : 0);
    if (ib === 0) ch.pad.forEach((f) => tone(f, t, e * 7.2, "sine", 0.034));
    if (ib === 0 || ib === 4) kick(t, 0.22);
    if (ib === 2 || ib === 6) noise(t, 0.13, 2000, 0.06);           // soft snare 2 & 4
    if (ib % 2 === 1) noise(t, 0.06, 7000, 0.03);                   // soft offbeat hat
    if (ib % 2 === 0) tone(ch.bass, t, e * 1.5, "triangle", 0.13);  // bass
    if (Math.random() < 0.6) noise(ctx.currentTime, 0.02, 3500, 0.012); // vinyl crackle
    step++;
  };
  tick(); R.timers.push(window.setInterval(tick, e * 1000));
}

function scheduleHouse(R: Store) {
  const ctx = R.ctx!, master = R.master!; const { tone, noise, kick } = helpers(ctx, master);
  const CH = [
    { stab: [261.63, 329.63, 392], bass: 130.81 }, { stab: [246.94, 311.13, 392], bass: 98 },
    { stab: [220, 277.18, 329.63], bass: 110 }, { stab: [233.08, 293.66, 349.23], bass: 116.54 },
  ];
  const e = 60 / 124 / 2; let step = 0;
  const tick = () => {
    if (!R.ctx) return; const ib = step % 8; const ch = CH[((step / 8) | 0) % 4]; const t = ctx.currentTime + 0.05;
    if (ib % 2 === 0) kick(t, 0.5);                                  // four-on-the-floor
    if (ib % 2 === 1) noise(t, 0.06, 9000, 0.06);                   // open hat offbeat
    if (ib % 2 === 1) tone(ch.bass, t, e * 0.85, "triangle", 0.16); // off-beat bass
    if (ib === 3 || ib === 7) ch.stab.forEach((f) => tone(f, t, e * 0.7, "triangle", 0.05)); // plucky stabs
    if (ib === 2 || ib === 6) noise(t, 0.12, 1600, 0.13);          // clap on 2 & 4
    step++;
  };
  tick(); R.timers.push(window.setInterval(tick, e * 1000));
}

function scheduleTrap(R: Store) {
  const ctx = R.ctx!, master = R.master!; const { tone, noise, kick, sub } = helpers(ctx, master);
  const ROOT = [65.41, 61.74, 55.0, 58.27]; // C2, B1, A1, Bb1
  const s16 = 60 / 140 / 4; let step = 0;
  const tick = () => {
    if (!R.ctx) return; const ib = step % 16; const bar = (step / 16) | 0; const root = ROOT[bar % 4]; const t = ctx.currentTime + 0.05;
    if (ib === 0) sub(root, t, s16 * 10, 0.5);
    if (ib === 10) sub(root * 1.5, t, s16 * 5, 0.3);
    if (ib === 0 || ib === 6) kick(t, 0.5);
    if (ib === 8) noise(t, 0.16, 1800, 0.18);                       // half-time snare
    noise(t, 0.03, 9000, ib % 2 ? 0.05 : 0.04);                     // hats
    if (ib === 14) for (let k = 1; k < 4; k++) noise(t + (k * s16) / 3, 0.025, 9000, 0.045); // roll
    if (ib === 0 && bar % 2 === 0) [root * 4, root * 4 * 1.19, root * 4 * 1.5].forEach((f) => tone(f, t, s16 * 14, "sine", 0.03));
    step++;
  };
  tick(); R.timers.push(window.setInterval(tick, s16 * 1000));
}

export default function MusicPlayer() {
  const { lang } = useI18n();
  const railHidden = useRailHidden();
  const [style, setStyle] = useState<Style | "mine" | null>(null);
  const [open, setOpen] = useState(false);
  const [myMusic, setMyMusic] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [upErr, setUpErr] = useState("");
  const R = useRef<Store>({ timers: [] });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Load the user's uploaded track (if any) so "My track" appears in the picker.
  useEffect(() => { api.getMusic().then((d) => setMyMusic(d.music || null)).catch(() => {}); }, []);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setUpErr("");
    if (!/audio\/(mpeg|mp3)/.test(file.type) && !/\.mp3$/i.test(file.name)) { setUpErr(lang === "he" ? "בחרו קובץ MP3" : "Pick an MP3 file"); return; }
    if (file.size > 7 * 1024 * 1024) { setUpErr(lang === "he" ? "הקובץ גדול מדי (עד 7MB)" : "File too large (max 7MB)"); return; }
    setBusy(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
      // Enforce ≤5 minutes via the audio metadata.
      const dur: number = await new Promise((res) => { const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => res(a.duration || 0); a.onerror = () => res(0); a.src = dataUrl; });
      if (dur > 300 + 2) { setUpErr(lang === "he" ? "האורך עד 5 דקות" : "Max length is 5 minutes"); setBusy(false); return; }
      await api.setMusic(dataUrl);
      setMyMusic(dataUrl);
      choose("mine");
    } catch {
      setUpErr(lang === "he" ? "ההעלאה נכשלה" : "Upload failed");
    } finally { setBusy(false); }
  }

  async function removeMusic() {
    setBusy(true);
    try { await api.setMusic(null); setMyMusic(null); if (style === "mine") choose(null); } catch {} finally { setBusy(false); }
  }

  const ensure = () => {
    if (R.current.ctx) return;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext); if (!Ctx) return;
    const ctx: AudioContext = new Ctx(); const master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    R.current.ctx = ctx; R.current.master = master;
  };
  const fade = (v: number) => {
    const { ctx, master } = R.current; if (!ctx || !master) return;
    ctx.resume(); master.gain.cancelScheduledValues(ctx.currentTime); master.gain.linearRampToValueAtTime(v, ctx.currentTime + 0.6);
  };
  const clear = () => { R.current.timers.forEach((id) => clearInterval(id)); R.current.timers = []; };

  const choose = (s: Style | "mine" | null) => {
    setStyle(s); setOpen(false); R.current.style = (s === "mine" ? null : s) as any;
    const a = audioRef.current;
    if (s !== "mine" && a) { try { a.pause(); } catch (_e) { /* */ } }
    if (s === null) { fade(0); clear(); return; }
    if (s === "mine") {
      fade(0); clear();  // stop the synth engine; play the uploaded MP3 instead
      if (a) { a.currentTime = 0; a.volume = 0.5; a.play().catch(() => {}); }
      return;
    }
    ensure(); clear();
    if (s === "lofi") scheduleLofi(R.current);
    else if (s === "house") scheduleHouse(R.current);
    else scheduleTrap(R.current);
    fade(s === "trap" ? 0.15 : 0.16);
  };

  // Music is OFF by default — users opt in via the floating music button below.
  useEffect(() => () => { clear(); try { R.current.ctx?.close(); } catch (_e) { /* */ } }, []);

  const opts: { key: Style; Icon: any; label: string }[] = [
    { key: "lofi", Icon: Headphones, label: lang === "he" ? "לואו-פיי צ'יל" : "Lo-fi chill" },
    { key: "house", Icon: AudioLines, label: lang === "he" ? "האוס" : "House" },
    { key: "trap", Icon: Zap, label: lang === "he" ? "טראפ" : "Trap" },
  ];
  const row: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 9, border: "none",
    borderRadius: 8, padding: "8px 10px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", textAlign: lang === "he" ? "right" : "left" };

  return (
    <>
      {/* Docked at the inline-start bottom corner (below the Learn tab). Music stays
          OFF until a style is picked; colour signals on (gold) / off (grey). */}
      {!railHidden && (
      <button onClick={() => setOpen((o) => !o)} aria-label="music" title={lang === "he" ? "מוזיקה" : "Music"}
        style={{ position: "fixed", insetInlineStart: 0, bottom: 16, zIndex: 60, display: "flex", alignItems: "center", gap: 6,
          background: "#F7931A", color: "#0B0613",
          border: "none", cursor: "pointer", padding: "10px 8px",
          borderStartEndRadius: 10, borderEndEndRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
          writingMode: "vertical-rl", fontFamily: "inherit", opacity: style ? 1 : 0.92 } as React.CSSProperties}>
        <Music size={15} /> <span style={{ fontSize: 12, fontWeight: 800 }}>{lang === "he" ? "מוזיקה" : "Music"}</span>
      </button>
      )}
      {open && (
        <div style={{ position: "fixed", insetInlineStart: 44, bottom: 16, zIndex: 61, minWidth: 186, background: "rgba(11,6,19,0.96)",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 6, boxShadow: "0 14px 34px rgba(0,0,0,0.55)" } as React.CSSProperties}>
          {opts.map((o) => (
            <button key={o.key} onClick={() => choose(o.key)} style={{ ...row, color: "#e8edf4", background: style === o.key ? "rgba(247,147,26,0.14)" : "none" }}>
              <o.Icon size={16} color={style === o.key ? "#F7931A" : "#9aa0a8"} />
              <span style={{ flex: 1 }}>{o.label}</span>
              {style === o.key && <Check size={14} color="#F7931A" />}
            </button>
          ))}
          {/* user-uploaded track */}
          {myMusic && (
            <button onClick={() => choose("mine")} style={{ ...row, color: "#e8edf4", background: style === "mine" ? "rgba(247,147,26,0.14)" : "none" }}>
              <Music size={16} color={style === "mine" ? "#F7931A" : "#9aa0a8"} />
              <span style={{ flex: 1 }}>{lang === "he" ? "הטראק שלי" : "My track"}</span>
              {style === "mine" ? <Check size={14} color="#F7931A" /> : (
                <span role="button" onClick={(e) => { e.stopPropagation(); removeMusic(); }} title={lang === "he" ? "הסר" : "Remove"} style={{ display: "inline-flex" }}><Trash2 size={13} color="#9aa0a8" /></span>
              )}
            </button>
          )}
          <button onClick={() => choose(null)} style={{ ...row, color: "#9aa0a8", background: style === null ? "rgba(255,255,255,0.06)" : "none" }}>
            <VolumeX size={16} /> <span style={{ flex: 1 }}>{lang === "he" ? "כבוי" : "Off"}</span>
            {style === null && <Check size={14} color="#9aa0a8" />}
          </button>
          {/* upload your own MP3 (≤5 min) */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 4, paddingTop: 4 }}>
            <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ ...row, color: "#F7931A" }}>
              {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
              <span style={{ flex: 1 }}>{lang === "he" ? "העלו MP3 (עד 5 דק')" : "Upload MP3 (≤5 min)"}</span>
            </button>
            {upErr && <div style={{ fontSize: 11, color: "#f3a3a3", padding: "2px 10px 4px" }}>{upErr}</div>}
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept="audio/mpeg,audio/mp3,.mp3" onChange={onPickFile} style={{ display: "none" }} />
      <audio ref={audioRef} src={myMusic || undefined} loop />
    </>
  );
}
