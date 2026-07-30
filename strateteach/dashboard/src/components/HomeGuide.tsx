import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, X, Gem } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { useDeferred } from "../lib/useDeferred";
import { C } from "../theme";
import type { GuideConfig, GuideStep } from "../lib/client";

// ── HomeGuide — the animated "770" diamond mascot that walks the Home screen ──────────────
// A faithful React/TS port of Yoav's vanilla-JS reference reel (Home-Guide-REFERENCE.html):
// a position:fixed, full-viewport overlay (pointer-events:none EXCEPT the control bar) that
// anchors to the LIVE DOM via data-guide="…" hooks, spotlights each section, and narrates it
// in an ElevenLabs voice with mouth-moving lip-sync. Character = talk base + mouth-ah/oo
// overlays (~9 fps while audio plays) + a brief blink; gesture poses (wave/point/cheer) swap
// the base image behind a quick "squash" dip; a CSS breathe idles. Timing/logic mirror the
// reference exactly. Config (steps, captions HE/EN, audio, poses, on/off, launch behaviour)
// is server-backed (/auth/guide/config) so non-devs edit it from the Guide manager with no
// deploy. Assets are lazy — nothing loads until the guide is opened, so first paint/TTI are
// untouched. Honors prefers-reduced-motion (kills breathe/dip/lip-sync + shortens transitions).

const REF_ASPECT = 254 / 172;      // reference visible char box aspect (h/w)
// Character base width per breakpoint (× the config's characterScale). Sized DOWN from the
// reference per Dan's review — the mascot was still oversized and clipped the screen edge on
// mobile. These are the ~60-70%-smaller sizes; the manager's characterScale tunes from here.
const CHAR_W_MOBILE = 96;
const CHAR_W_DESKTOP = 130;
const EDGE = 12;                   // hard min gap from EVERY viewport edge (never clip)
const LIP_MS = 105;                // ~9.5 fps mouth cycle while talking (reference)
const BLINK_EVERY = 2800;          // blink poll cadence (reference)
const GESTURE_MS = 1250;           // gesture beat before the character starts talking (reference)
const SEEN_KEY = "algo770_guide_seen";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Open the guide from anywhere (the launch button lives in the Home bottom layer, so it
// dispatches this instead of prop-threading into HomeGuide).
export const GUIDE_OPEN_EVENT = "algo770-guide-launch";
export function openHomeGuide() { window.dispatchEvent(new Event(GUIDE_OPEN_EVENT)); }

function useGuideConfig() {
  const ready = useDeferred(600);   // hold the fetch until after first paint (non-critical)
  return useQuery({ queryKey: ["guideConfig"], queryFn: () => api.guideConfigGet(), enabled: ready, staleTime: 60000, retry: 0 });
}

// The small "Guide" launch pill for the Home bottom help layer. Only renders once the config
// has loaded AND the guide is enabled (an owner can switch the whole thing off server-side).
export function GuideLaunchButton({ square, compact }: { square?: boolean; compact?: boolean }) {
  const { lang } = useI18n();
  const q = useGuideConfig();
  const cfg = q.data?.config;
  if (!cfg || !cfg.enabled || !(cfg.steps || []).some((s) => s.enabled)) return null;
  const label = lang === "he" ? "מדריך" : "Guide";
  // `compact` = ICON-ONLY (no text) — used in the Home mobile help row so all five items fit one
  // line without wrapping (a wrapped 2nd line added height that made Home scroll).
  return (
    <button onClick={() => openHomeGuide()} className="tap44"
      aria-label={lang === "he" ? "פתח את המדריך" : "Open the guide"} title={label}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        background: C.glassTint, backdropFilter: C.glassBlur, WebkitBackdropFilter: C.glassBlur as any,
        border: `1.5px solid ${C.frameAccent}`, color: C.text, borderRadius: square ? 13 : 999,
        padding: compact ? "6px 9px" : (square ? "8px 12px" : "7px 13px"), fontSize: 12, fontWeight: 800, cursor: "pointer",
        fontFamily: "inherit", boxShadow: C.glassHi, flexShrink: 0 }}>
      <Gem size={14} color={C.gold} /> {!compact && label}
    </button>
  );
}

// The overlay itself. Mount ONCE on Home; it stays dormant (just the config fetch + the
// first-visit auto-offer) until opened via the GUIDE_OPEN_EVENT.
export default function HomeGuide() {
  const { lang, rtl } = useI18n();
  const q = useGuideConfig();
  const cfg = q.data?.config;

  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);   // user tapped Start (the audio gesture)
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const [autoOffer, setAutoOffer] = useState(false);
  const [charReady, setCharReady] = useState(false);   // hide the sprite until it's placed on-screen

  const reduced = useMemo(() => {
    try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false; } catch { return false; }
  }, []);

  // Enabled steps only, in order, resolved for the active language.
  const steps: GuideStep[] = useMemo(() => (cfg?.steps || []).filter((s) => s.enabled), [cfg]);
  const scale = clamp(cfg?.characterScale || 1, 0.4, 2);

  // Listen for the launch event (from the bottom-layer button). Also honor a one-shot
  // sessionStorage flag the Guide manager sets before navigating Home for a live preview.
  useEffect(() => {
    const onOpen = () => { setOpen(true); setAutoOffer(false); };
    window.addEventListener(GUIDE_OPEN_EVENT, onOpen);
    try {
      if (sessionStorage.getItem("algo770_guide_open") === "1") {
        sessionStorage.removeItem("algo770_guide_open");
        setTimeout(onOpen, 400);   // let Home mount + anchors settle first
      }
    } catch { /* */ }
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, onOpen);
  }, []);

  // First-visit auto-offer (dismissible) — only if enabled server-side, there are steps, and
  // this browser hasn't seen it. Deferred a beat so it never competes with first paint.
  useEffect(() => {
    if (!cfg || !cfg.enabled || !cfg.autoOfferFirstVisit || !steps.length) return;
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* */ }
    if (seen) return;
    const t = setTimeout(() => setAutoOffer(true), 1400);
    return () => clearTimeout(t);
  }, [cfg, steps.length]);

  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* */ } };

  // ── imperative controller (mirrors the reference's DOM engine) ──────────────────────────
  const overlayRef = useRef<HTMLDivElement>(null);   // fixed inset:0 layer — the drawable box
  const wrapRef = useRef<HTMLDivElement>(null);      // charwrap — positioned (transform)
  const charRef = useRef<HTMLDivElement>(null);      // char — dip target
  const bodyRef = useRef<HTMLImageElement>(null);    // base pose img
  const ahRef = useRef<HTMLImageElement>(null);
  const ooRef = useRef<HTMLImageElement>(null);
  const blinkRef = useRef<HTMLImageElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  const auRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);   // set once the element is unlocked by a user gesture
  const guardRef = useRef(0);
  const talkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const blinkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poseRef = useRef<string>("talk");
  const playingRef = useRef(false);
  const idxRef = useRef(0);

  const poseSrc = (name: string): string => {
    const p = cfg?.poses;
    if (!p) return "";
    if (name === "wave") return p.wave;
    if (name === "point") return p.point;
    if (name === "cheer") return p.cheer;
    return p.talk;
  };

  // ── audio (mobile-safe) ─────────────────────────────────────────────────────────────────
  // ROOT CAUSE of the mobile "no audio" bug: the old code did `new Audio(url)` per step and
  // called play() inside a 1.25s setTimeout — i.e. OUTSIDE the tap handler. Mobile browsers
  // (iOS Safari especially) only allow playback that starts from a user gesture, and each fresh
  // Audio element needs its OWN unlock, so every step was blocked. Fix: ONE reused element,
  // unlocked synchronously on the Start/next/prev tap; every later play() reuses that unlocked
  // element (allowed once the element has sticky user-activation).
  const stepAudioUrl = (st: GuideStep): string | null => (lang === "he" && st.audioHe ? st.audioHe : st.audio);
  const ensureAudio = (): HTMLAudioElement => {
    if (!auRef.current) {
      const au = new Audio();
      au.preload = "auto";
      (au as any).playsInline = true;   // iOS: don't hijack into the fullscreen player
      auRef.current = au;
    }
    return auRef.current;
  };
  // Called from a REAL user gesture (Start / play / next / prev). Kicks a silent, in-gesture
  // play() so the element gains user-activation; later programmatic play() calls then work.
  const unlockAudio = () => {
    const au = ensureAudio();
    if (audioUnlockedRef.current) return;
    const first = steps[0] ? stepAudioUrl(steps[0]) : null;
    if (!first) return;
    try {
      au.src = first;            // a real, same-origin /media/guide mp3
      au.volume = 0;             // silent unlock — no audible blip
      const p = au.play();
      Promise.resolve(p).then(() => { try { au.pause(); au.currentTime = 0; } catch { /* */ } au.volume = 1; audioUnlockedRef.current = true; })
                        .catch(() => { au.volume = 1; });
    } catch { au.volume = 1; }
  };

  const setMouth = (k: "oh" | "ah" | "oo") => {
    const talk = poseRef.current === "talk";
    if (ahRef.current) ahRef.current.style.opacity = k === "ah" && talk ? "1" : "0";
    if (ooRef.current) ooRef.current.style.opacity = k === "oo" && talk ? "1" : "0";
  };
  const startTalk = () => {
    if (talkTimer.current || reduced) return;   // reduced motion: keep a still mouth
    talkTimer.current = setInterval(() => {
      if (poseRef.current !== "talk") { setMouth("oh"); return; }
      const r = Math.random();
      setMouth(r < 0.42 ? "ah" : r < 0.78 ? "oo" : "oh");
    }, LIP_MS);
  };
  const stopTalk = () => {
    if (talkTimer.current) { clearInterval(talkTimer.current); talkTimer.current = null; }
    setMouth("oh");
  };
  const setPose = (name: string) => {
    const el = charRef.current;
    const apply = () => {
      poseRef.current = name;
      if (bodyRef.current) bodyRef.current.src = poseSrc(name);
      if (name !== "talk") {
        if (ahRef.current) ahRef.current.style.opacity = "0";
        if (ooRef.current) ooRef.current.style.opacity = "0";
        if (blinkRef.current) blinkRef.current.style.opacity = "0";
      }
    };
    if (reduced || !el) { apply(); return; }
    el.classList.remove("hg-dip"); void el.offsetWidth; el.classList.add("hg-dip");
    setTimeout(apply, 150);
  };
  const doBlink = () => {
    if (poseRef.current !== "talk" || reduced || !blinkRef.current) return;
    blinkRef.current.style.opacity = "1";
    setTimeout(() => { if (blinkRef.current) blinkRef.current.style.opacity = "0"; }, 130);
  };

  const anchorRect = (anchor: string | null): DOMRect | null => {
    if (!anchor) return null;
    const el = document.querySelector(`[data-guide="${anchor}"]`) as HTMLElement | null;
    return el ? el.getBoundingClientRect() : null;
  };

  // Measure the overlay (the fixed inset:0 layer) in LAYOUT pixels — the SAME space the
  // character's translate()/the caption's left-top live in — and derive the active zoom factor.
  // ROOT CAUSE of the desktop "no character" bug: the app runs html{zoom:1.15} on desktop, so
  // getBoundingClientRect() reports VISUAL (zoom-scaled) px while clientWidth/Height report
  // LAYOUT px. The old code sized the viewport from the VISUAL width, which made cx ~15% too big
  // → the sprite was translated clean off the right edge (invisible) even though the audio ran.
  // We now work entirely in layout space and convert anchor rects (getBoundingClientRect =
  // visual) by the measured zoom. On mobile there is no html zoom, so zoom===1 and nothing
  // changes there (the mobile positioning Dan confirmed as visible is preserved exactly).
  const boxDims = () => {
    const el = overlayRef.current;
    const rect = el?.getBoundingClientRect();
    const vw = el?.clientWidth || Math.round(rect?.width || window.innerWidth);
    const vh = el?.clientHeight || Math.round(rect?.height || window.innerHeight);
    const zoom = rect && vw ? rect.width / vw : 1;     // ~1.15 under desktop html zoom, 1 otherwise
    return { vw, vh, zoom, ox: rect?.left || 0, oy: rect?.top || 0 };
  };
  // A VISUAL anchor rect (from getBoundingClientRect) → LAYOUT coords relative to the overlay.
  const toLayout = (r: DOMRect, ox: number, oy: number, zoom: number) => ({
    top: (r.top - oy) / zoom, left: (r.left - ox) / zoom, width: r.width / zoom, height: r.height / zoom,
  });

  // Position ONLY the character, fully on-screen, next to `rect` (or centred-idle when null).
  // Clamps x AND y to keep the whole sprite inside the viewport with an EDGE gap on every side,
  // and shrinks the sprite if a very short screen can't fit it above the control bar.
  const positionChar = (rect: DOMRect | null) => {
    const { vw, vh, zoom, ox, oy } = boxDims();
    const a = rect ? toLayout(rect, ox, oy, zoom) : null;
    const narrow = vw < 560;
    let cw = (narrow ? CHAR_W_MOBILE : CHAR_W_DESKTOP) * scale;
    let ch = cw * REF_ASPECT;
    const bottomReserve = narrow ? 92 : 84;   // clear the bottom control bar
    // Shrink-to-fit: never let the sprite be taller than the space above the control bar.
    const maxCh = vh - bottomReserve - EDGE;
    if (ch > maxCh && maxCh > 40) { const f = maxCh / ch; cw *= f; ch *= f; }
    const ey = a ? a.top + a.height / 2 : vh * 0.46;
    // Rides the inline-end edge (right in LTR, left in RTL), tracking the anchor vertically —
    // then HARD-clamped so it can never clip the left/right/bottom edges.
    const cxWant = rtl ? EDGE : vw - cw - EDGE;
    const cx = clamp(cxWant, EDGE, Math.max(EDGE, vw - cw - EDGE));
    const cy = clamp(ey - ch * 0.52, EDGE, Math.max(EDGE, vh - ch - bottomReserve));
    if (wrapRef.current) { wrapRef.current.style.width = `${cw}px`; wrapRef.current.style.transform = `translate(${cx}px, ${cy}px)`; }
    if (charRef.current) charRef.current.style.width = `${cw}px`;
    return { vw, vh, cw, zoom, ox, oy };
  };

  // Place character + caption + spotlight for step i, measuring the LIVE anchor each time.
  const place = (i: number) => {
    const st = steps[i];
    if (!st) return;
    const r = anchorRect(st.anchor);
    const { vw, vh, cw, zoom, ox, oy } = positionChar(r);
    const a = r ? toLayout(r, ox, oy, zoom) : null;   // anchor in layout space (zoom-corrected)

    // Caption on the opposite side from the character (all layout space).
    if (capRef.current) {
      const capW = clamp(vw - cw - 34, 168, 340);
      const capX = rtl ? clamp(vw - capW - 12, 8, vw) : 12;
      const capY = a ? clamp(a.top + a.height / 2 - 40, 58, vh - 150) : vh * 0.32;
      capRef.current.style.width = `${capW}px`;
      capRef.current.style.left = `${capX}px`;
      capRef.current.style.top = `${capY}px`;
    }

    // Spotlight — a hole punched in the dim, around the anchor. It's position:fixed so its px
    // are ALSO layout-space (rendered ×zoom), so the layout-space anchor coords line up.
    if (spotRef.current) {
      if (a) {
        spotRef.current.style.top = `${a.top - 8}px`;
        spotRef.current.style.left = `${a.left - 8}px`;
        spotRef.current.style.width = `${a.width + 16}px`;
        spotRef.current.style.height = `${a.height + 16}px`;
        spotRef.current.classList.add("on");
      } else {
        spotRef.current.classList.remove("on");
      }
    }
  };

  const clearTimers = () => {
    if (fallbackTimer.current) { clearTimeout(fallbackTimer.current); fallbackTimer.current = null; }
    if (gestureTimer.current) { clearTimeout(gestureTimer.current); gestureTimer.current = null; }
  };

  const render = (i: number) => {
    if (!steps[i]) return;
    idxRef.current = i; setIdx(i);
    const st = steps[i];
    const my = ++guardRef.current;
    if (capRef.current) { capRef.current.textContent = lang === "he" ? (st.captionHe || st.captionEn) : (st.captionEn || st.captionHe); capRef.current.classList.add("on"); }
    place(i);
    setPose(st.gesture);   // gesture beat (wave / point / cheer)
    clearTimers();
    gestureTimer.current = setTimeout(() => {   // then talk + lip-sync the line
      if (my !== guardRef.current) return;
      setPose("talk"); startTalk();
      const url = stepAudioUrl(st);
      const au = ensureAudio();               // REUSE the one gesture-unlocked element
      try { au.pause(); } catch { /* */ }
      const done = () => { if (my === guardRef.current) { stopTalk(); if (playingRef.current) next(); } };
      au.onended = done; au.onerror = done;
      au.volume = 1;
      if (url) { au.src = url; try { au.currentTime = 0; } catch { /* */ } }
      au.play().catch(() => { /* no audio (blocked/missing) — the fallback timer still advances */ });
      fallbackTimer.current = setTimeout(() => { if (my === guardRef.current && playingRef.current) { stopTalk(); next(); } }, ((st.dur || 10) + 2.4) * 1000);
    }, reduced ? 350 : GESTURE_MS);
  };

  const next = () => {
    if (idxRef.current < steps.length - 1) render(idxRef.current + 1);
    else { setPlayingBoth(false); stopTalk(); }
  };
  const prev = () => { if (idxRef.current > 0) render(idxRef.current - 1); };
  const setPlayingBoth = (v: boolean) => { playingRef.current = v; setPlaying(v); };

  // NOTE: startTour / toggle-resume / replay / next / prev all run from a real user tap, so
  // they unlockAudio() synchronously first — that's what makes playback work on mobile.
  const startTour = () => { unlockAudio(); markSeen(); setStarted(true); setPlayingBoth(true); render(0); };
  const toggle = () => {
    if (playingRef.current) { try { auRef.current?.pause(); } catch { /* */ } guardRef.current++; clearTimers(); stopTalk(); setPlayingBoth(false); }
    else { unlockAudio(); setPlayingBoth(true); render(idxRef.current); }
  };
  const replay = () => { unlockAudio(); guardRef.current++; setPlayingBoth(true); render(0); };
  const closeTour = () => {
    try { auRef.current?.pause(); } catch { /* */ }
    guardRef.current++; clearTimers(); stopTalk(); setPlayingBoth(false); setStarted(false); setOpen(false);
    if (capRef.current) capRef.current.classList.remove("on");
    if (spotRef.current) spotRef.current.classList.remove("on");
  };

  // Blink poll while the tour is on.
  useEffect(() => {
    if (!started) return;
    blinkTimer.current = setInterval(() => { if (playingRef.current && Math.random() < 0.5) doBlink(); }, BLINK_EVERY);
    return () => { if (blinkTimer.current) { clearInterval(blinkTimer.current); blinkTimer.current = null; } };
  }, [started]);

  // Place the character on-screen the MOMENT the overlay opens (BEFORE the Start card is even
  // tapped) so it's never stranded at 0,0 or clipped in a corner during the intro. Runs pre-
  // paint (useLayoutEffect) so there's no unplaced flash; reveals the sprite once placed.
  useLayoutEffect(() => {
    if (!open) { setCharReady(false); return; }
    const put = () => { positionChar(started ? anchorRect(steps[idxRef.current]?.anchor ?? null) : null); setCharReady(true); };
    put();
    // Re-run after fonts/anchors settle so the very first frame is correct on slow mounts.
    const t = setTimeout(put, 120);
    return () => clearTimeout(t);
  }, [open, started, rtl, scale, steps.length]);

  // Re-measure on scroll / resize / orientation (the DOM + viewport move). Works in BOTH states:
  // the anchored current step while playing, or the idle corner position before Start.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      if (started) place(idxRef.current); else positionChar(null);
    }); };
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.addEventListener("scroll", schedule, true);   // capture → catches the inner scroll region too
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", schedule); window.removeEventListener("orientationchange", schedule); window.removeEventListener("scroll", schedule, true); };
  }, [open, started, rtl, lang, scale]);

  // Teardown on unmount.
  useEffect(() => () => { try { auRef.current?.pause(); } catch { /* */ } clearTimers(); if (talkTimer.current) clearInterval(talkTimer.current); if (blinkTimer.current) clearInterval(blinkTimer.current); }, []);

  // ── render ──────────────────────────────────────────────────────────────────────────────
  // Auto-offer card (before anything opens) — a tiny dismissible invite.
  const offer = autoOffer && !open && cfg?.enabled && steps.length > 0 ? (
    <div style={{ position: "fixed", insetInlineEnd: 14, bottom: 92, zIndex: 1350, maxWidth: 260,
      background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 14,
      boxShadow: "0 18px 44px rgba(0,0,0,0.4)", direction: rtl ? "rtl" : "ltr" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Gem size={18} color={C.gold} />
        <b style={{ fontSize: 14, color: C.text }}>{lang === "he" ? "היי, יש לכם מדריך!" : "Meet your guide"}</b>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 12.5, lineHeight: 1.5, color: C.muted }}>
        {lang === "he" ? "סיור קצר קולי על מסך הבית — רוצים?" : "A short voice tour of your home screen — want it?"}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { setOpen(true); setAutoOffer(false); }} className="gbtn"
          style={{ flex: 1, borderRadius: 10, padding: "9px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
          {lang === "he" ? "בואו נתחיל" : "Start"}
        </button>
        <button onClick={() => { setAutoOffer(false); markSeen(); }} className="tap44"
          style={{ background: "none", border: `1px solid ${C.line}`, color: C.muted, borderRadius: 10, padding: "9px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
          {lang === "he" ? "לא עכשיו" : "Later"}
        </button>
      </div>
    </div>
  ) : null;

  const overlay = open && cfg ? (
    <div ref={overlayRef} aria-live="polite" style={{ position: "fixed", inset: 0, zIndex: 1300, pointerEvents: "none", direction: rtl ? "rtl" : "ltr" }}>
      <style>{`
        @keyframes hgBreathe{0%,100%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-5px) scale(1.004,1.012)}}
        @keyframes hgDip{0%{transform:translateY(0) scaleY(1)}45%{transform:translateY(9px) scaleY(.93)}100%{transform:translateY(0) scaleY(1)}}
        @keyframes hgPulse{0%,100%{opacity:.4}50%{opacity:1}}
        .hg-breathe{animation:hgBreathe 3.8s ease-in-out infinite;transform-origin:50% 100%}
        .hg-dip{animation:hgDip .34s ease-in-out}
        .hg-reduced .hg-breathe{animation:none}
        .hg-reduced .hg-dip{animation:none}
        .hg-spot{position:fixed;border-radius:14px;box-shadow:0 0 0 3000px rgba(4,8,22,.62);outline:2px solid rgba(120,170,255,.95);opacity:0;transition:all .55s cubic-bezier(.3,.9,.25,1);pointer-events:none}
        .hg-reduced .hg-spot{transition:none}
        .hg-spot.on{opacity:1}
        .hg-spot::after{content:"";position:absolute;inset:-3px;border-radius:16px;box-shadow:0 0 22px 4px rgba(110,160,255,.5);animation:hgPulse 1.8s ease-in-out infinite}
        .hg-reduced .hg-spot::after{animation:none}
        .hg-cap.on{opacity:1}
      `}</style>

      <div className={reduced ? "hg-reduced" : ""} style={{ position: "absolute", inset: 0 }}>
        {/* Spotlight (dims the whole viewport except the anchored hole). */}
        <div ref={spotRef} className="hg-spot" />

        {/* Character — charwrap positions, breathe idles, char dips on a pose swap; body +
            mouth-ah/oo + blink stack at 0,0 so only the mouth/eyes change. */}
        <div ref={wrapRef} style={{ position: "absolute", left: 0, top: 0, width: CHAR_W_MOBILE, zIndex: 25, pointerEvents: "none", opacity: charReady ? 1 : 0, transition: reduced ? "opacity .2s" : "transform .85s cubic-bezier(.25,.9,.25,1), opacity .2s" }}>
          <div className="hg-breathe">
            <div ref={charRef} style={{ position: "relative", width: CHAR_W_MOBILE, transformOrigin: "50% 100%", filter: "drop-shadow(0 14px 18px rgba(0,0,0,.5))", transform: rtl ? "scaleX(-1)" : undefined }}>
              <img ref={bodyRef} src={cfg.poses.talk} alt="" draggable={false} style={{ position: "relative", width: "100%", height: "auto", display: "block" }} />
              <img ref={ahRef} src={cfg.poses.mouthAh} alt="" draggable={false} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "auto", display: "block", opacity: 0 }} />
              <img ref={ooRef} src={cfg.poses.mouthOo} alt="" draggable={false} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "auto", display: "block", opacity: 0 }} />
              <img ref={blinkRef} src={cfg.poses.blink} alt="" draggable={false} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "auto", display: "block", opacity: 0 }} />
            </div>
          </div>
        </div>

        {/* Caption bubble — text set imperatively; positioned beside the character. */}
        <div ref={capRef} className="hg-cap" style={{ position: "absolute", zIndex: 26, maxWidth: 340,
          background: "#fff", color: "#0b1024", borderRadius: 16, padding: "13px 15px", fontSize: 13.5,
          lineHeight: 1.5, fontWeight: 600, boxShadow: "0 16px 40px rgba(0,0,0,.45)", opacity: 0,
          transition: reduced ? "none" : "opacity .35s ease", pointerEvents: "none" }} />

        {/* Start card — the audio user-gesture. Shown until the user taps Start. */}
        {!started && (
          <div style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 14, padding: 24, pointerEvents: "auto",
            background: "rgba(6,10,26,.62)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) closeTour(); }}>
            <Gem size={44} color={C.gold} />
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 900, color: "#eaf1ff", textAlign: "center" }}>
              {lang === "he" ? "הכירו את המדריך שלכם" : "Meet your StrateTeach guide"}
            </h1>
            <p style={{ margin: 0, color: "#aebbe6", fontSize: 13.5, textAlign: "center", maxWidth: 320 }}>
              {lang === "he" ? "סיור קצר על מסך הבית. הקישו כדי להתחיל (עם קול)." : "A quick tour of your home screen. Tap to start (sound on)."}
            </p>
            <button onClick={startTour} className="tap44"
              style={{ border: "none", borderRadius: 999, padding: "15px 26px", fontSize: 15, fontWeight: 900,
                cursor: "pointer", color: "#04122e", background: "linear-gradient(135deg,#7ab0ff,#4f8cff)",
                boxShadow: "0 14px 34px rgba(80,140,255,.5)", display: "inline-flex", alignItems: "center", gap: 9 }}>
              <Play size={17} fill="#04122e" /> {lang === "he" ? "התחילו את הסיור" : "Start the tour"}
            </button>
            <button onClick={closeTour} className="tap44" style={{ background: "none", border: "none", color: "#8fa2d8", fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
              {lang === "he" ? "אולי אחר כך" : "Maybe later"}
            </button>
          </div>
        )}

        {/* Control bar — the ONLY pointer-events:auto region so the guide never blocks the app. */}
        {started && (
          <div style={{ position: "fixed", left: "50%", bottom: 18, transform: "translateX(-50%)", zIndex: 42,
            display: "flex", alignItems: "center", gap: 8, pointerEvents: "auto", direction: "ltr",
            background: "rgba(10,18,44,.92)", border: "1px solid #3a5fc0", borderRadius: 999, padding: "8px 11px",
            boxShadow: "0 14px 34px rgba(0,0,0,.5)" }}>
            <HudBtn onClick={() => { guardRef.current++; prev(); }} label="Previous"><SkipBack size={15} /></HudBtn>
            <HudBtn main onClick={toggle} label={playing ? "Pause" : "Play"}>{playing ? <Pause size={17} /> : <Play size={17} fill="#04122e" />}</HudBtn>
            <HudBtn onClick={() => { guardRef.current++; next(); }} label="Next"><SkipForward size={15} /></HudBtn>
            <div style={{ display: "flex", gap: 5, margin: "0 5px" }}>
              {steps.map((_, k) => (
                <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", transition: "all .3s",
                  background: k === idx ? "#6aa0ff" : "#2b3f7a", transform: k === idx ? "scale(1.3)" : "none" }} />
              ))}
            </div>
            <HudBtn onClick={replay} label="Replay"><RotateCcw size={15} /></HudBtn>
            <HudBtn onClick={closeTour} label="Close"><X size={15} /></HudBtn>
          </div>
        )}
      </div>
    </div>
  ) : null;

  if (typeof document === "undefined") return null;
  return createPortal(<>{offer}{overlay}</>, document.body);
}

function HudBtn({ children, onClick, main, label }: { children: React.ReactNode; onClick: () => void; main?: boolean; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="tap44"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        width: main ? 46 : 38, height: main ? 46 : 38, borderRadius: "50%",
        border: main ? "none" : "1px solid #3a5fc0",
        background: main ? "linear-gradient(135deg,#6aa0ff,#3b6fe0)" : "#152356",
        color: main ? "#04122e" : "#dbe4ff" }}>
      {children}
    </button>
  );
}
