import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  TrendingUp, LayoutDashboard, Search, FlaskConical, BarChart3, Wand2, BookOpen,
  Clapperboard, ArrowLeftRight, Send, Crown, UserRound, ShieldCheck, HelpCircle,
  GraduationCap, MessageCircle, Bot, MessagesSquare, X,
} from "lucide-react";
import { useI18n } from "../i18n";
import { isAdminOrOwner } from "../app/api";
import { C, activeTiles, onAccent, type TileSkin } from "../theme";
import EarthGlobe, { MetalRing, OrbitSymbols } from "./EarthGlobe";
import FitLabel from "./FitLabel";

type Lbl = { he: string; en: string };
type Item = { p: string; l: Lbl; Icon: React.FC<any>; admin?: boolean; premium?: boolean; soon?: boolean };
type Section = { key: string; l: Lbl; d: Lbl; Icon: React.FC<any>; items: Item[] };

// The four top-level "apps" — a phone-style springboard. Each opens a mini-menu
// of its features (same screens, grouped behind one icon).
const SECTIONS: Section[] = [
  {
    key: "trade", l: { he: "מסחר וניתוח", en: "Trading & Analysis" },
    d: { he: "דאשבורד, מנוע מסחר, סריקה יומית, בדיקות וביצועים — הכול במקום אחד.", en: "Dashboard, trading engine, daily scan, backtests & performance — all in one place." }, Icon: TrendingUp,
    items: [
      { p: "/overview", l: { he: "דאשבורד", en: "Dashboard" }, Icon: LayoutDashboard },
      { p: "/profit", l: { he: "מנוע מסחר", en: "Trading engine" }, Icon: TrendingUp },
      { p: "/scanner", l: { he: "סריקה יומית", en: "Daily scan" }, Icon: Search },
      { p: "/backtests", l: { he: "בדיקות", en: "Backtest" }, Icon: FlaskConical },
      { p: "/analytics", l: { he: "ביצועים", en: "Performance" }, Icon: BarChart3 },
    ],
  },
  {
    key: "learn", l: { he: "למידה", en: "Learn" },
    d: { he: "מעבדת אסטרטגיות, הסברים ורילים קצרים שמלמדים אותך את המערכת.", en: "Strategy lab, explanations and short reels that teach you the system." }, Icon: GraduationCap,
    items: [
      { p: "/strategy", l: { he: "מעבדת אסטרטגיות", en: "Strategy lab" }, Icon: Wand2 },
      { p: "/university", l: { he: "הסברים", en: "Explanation" }, Icon: BookOpen },
      { p: "/reels", l: { he: "רילים", en: "Reels" }, Icon: Clapperboard },
    ],
  },
  {
    key: "connect", l: { he: "חיבורים", en: "Connect" },
    d: { he: "חיבור הבורסה שלך, התראות טלגרם וצ'אט תמיכה.", en: "Link your exchange, Telegram alerts and support chat." }, Icon: ArrowLeftRight,
    items: [
      // Order per spec: Exchange · Chat · Telegram · WhatsApp. All connection options
      // live behind this one Connect tile → a mini-menu, each routing to its screen.
      { p: "/exchange", l: { he: "בורסה", en: "Exchange" }, Icon: ArrowLeftRight },
      { p: "/chat", l: { he: "צ'אט", en: "Chat" }, Icon: MessageCircle },
      { p: "/telegram", l: { he: "טלגרם", en: "Telegram" }, Icon: Send },
      // WhatsApp — NEW. No support wa.me number / integration exists in the codebase
      // yet, so it ships as a "בקרוב / Soon" placeholder (no invented phone number).
      // When a real support line/integration lands, swap `p` to the wa.me link/route
      // and drop `soon`.
      { p: "__wa_soon", l: { he: "וואטסאפ", en: "WhatsApp" }, Icon: MessagesSquare, soon: true },
      // Signal Bot keeps its premium glossy-black + gold-star identity (see the Home
      // shortcuts row) at the EXACT same MINI dimensions as its siblings so the panel
      // stays tidy. Routes to /bots, which is itself entitlement-gated — no extra lock
      // logic here (matches the other Connect children, which also don't gate here).
      { p: "/bots", l: { he: "סיגנל בוט", en: "Signal Bot" }, Icon: Bot, premium: true },
    ],
  },
  {
    key: "account", l: { he: "חשבון ופרופיל", en: "Account & Profile" },
    d: { he: "ניהול, הפרופיל שלי, עזרה והגדרות פרטיות.", en: "Admin, my profile, help and privacy settings." }, Icon: UserRound,
    items: [
      { p: "/admin", l: { he: "ניהול", en: "Admin" }, Icon: Crown, admin: true },
      { p: "/me", l: { he: "הפרופיל שלי", en: "My profile" }, Icon: UserRound },
      { p: "__help", l: { he: "עזרה", en: "Help" }, Icon: HelpCircle },
      { p: "/privacy", l: { he: "פרטיות", en: "Privacy" }, Icon: ShieldCheck },
    ],
  },
];

export default function SectionHub({ mobile, compact, helpSlot }: { mobile?: boolean; compact?: boolean; helpSlot?: React.ReactNode }) {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const admin = isAdminOrOwner();
  const miniRef = useRef<HTMLDivElement>(null);

  // Re-render when the skin/mode changes so the PER-SKIN tile palette re-colours
  // live (the rest of the app re-reads C.* the same way on this event).
  const [, themeTick] = useState(0);
  useEffect(() => {
    const on = () => themeTick((n) => n + 1);
    window.addEventListener("algo770-theme", on);
    return () => window.removeEventListener("algo770-theme", on);
  }, []);
  // Per-skin × mode tile colours (single source of truth in theme.ts). Each section
  // keeps its identity + illustration; its hue is drawn from the active palette so a
  // user on any skin "finds themselves" among the four tiles.
  const TILE = activeTiles();
  // Gradients reused by the mini-menu squircles + info popover so a section's
  // sub-screens carry the SAME brand identity as its tile (Instagram's multi-stop
  // `bg` is used verbatim; the others fall back to their from→to gradient).
  const grad = (k: string) => (TILE as any)[k].bg || `linear-gradient(140deg, ${(TILE as any)[k].from}, ${(TILE as any)[k].to})`;
  const GRADS: Record<string, string> = { trade: grad("trade"), learn: grad("learn"), connect: grad("connect"), account: grad("account") };

  // Open the mini-menu smoothly and scroll it into focus.
  useEffect(() => {
    if (open && miniRef.current) {
      const id = setTimeout(() => miniRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      return () => clearTimeout(id);
    }
  }, [open]);

  const sm = !!compact; // compact = used as the in-screen header hub on every page
  // Home (non-compact) mobile sizes are ~10% smaller so the 4 tiles + the rest of
  // the core fit one locked screen without scrolling.
  const GAP = sm ? 10 : (mobile ? 10 : 14);
  const GRIDW = sm ? (mobile ? 250 : 300) : (mobile ? 250 : 335);
  const MINI = sm ? (mobile ? 56 : 62) : (mobile ? 64 : 72);      // small squircle in the mini-menu
  const BIGICON = sm ? (mobile ? 78 : 92) : (mobile ? 90 : 124);
  const CHIP = sm ? (mobile ? 28 : 34) : (mobile ? 28 : 42);
  const CHIPI = sm ? (mobile ? 16 : 18) : (mobile ? 16 : 23);
  // Tile label sizes — a notch SMALLER than before (desktop 15→14, mobile 10.5→10,
  // compact 12→11) so the label reads neat & precise in BOTH en + he/RTL while the
  // longest words ("Analysis"/"Profile" · "וניתוח") still fit one line inside the
  // smaller inscribed tiles, and the slightly smaller label keeps Home one-page on mobile.
  const LBL = sm ? (mobile ? 10 : 11) : (mobile ? 10 : 14);
  // Home mobile tile padding trimmed so the chip + 2-line label fit the 1:1 tile.
  const PAD = sm ? (mobile ? 9 : 11) : (mobile ? 5 : 16);
  const RAD = sm ? 18 : (mobile ? 20 : 24);
  const TGAP = sm ? (mobile ? 7 : 9) : (mobile ? 6 : 12);
  // Home springboard geometry: the 4 tiles sit INSCRIBED inside the circular orbit
  // ring. STAGE is the square stage width === the ring diameter D; the 2×2 grid is
  // centred at GRIDPCT% of D. A square of side s inscribes in a circle of diameter
  // s·√2 ≈ 1.41s, so a 0.59·D block leaves ~8% of D as clear margin to the ring —
  // tiles never touch/cross it. The circle is sized so tiles keep their size + label
  // font while fitting comfortably inside.
  // Mobile diameter kept at 280 so the whole Home (header + my-money + positions
  // + springboard + quick-helper) still fits ONE mobile viewport (100svh) with no scroll.
  const STAGE = mobile ? 280 : 500;  // ring/stage diameter on Home (scales via width:100%)
  // Inscribe ratio at 59%: the 2×2 block is a touch larger and sits CLOSER to the ring
  // (a tighter, still-even margin) than before — while keeping the metallic ring + the
  // orbiting market symbols visible in the annular gap around the tiles.
  const GRIDPCT = 59;                // 2×2 block width as a % of the ring diameter

  const go = (p: string) => {
    if (p === "__help") { window.dispatchEvent(new Event("algo770-onboarding-quiz")); return; }
    if (p === "__wa_soon") return;   // WhatsApp placeholder — no destination yet ("Soon")
    if (p) nav(p);
  };
  const sec = SECTIONS.find((s) => s.key === open) || null;

  // One springboard tile — shared by the compact (sm) grid and the inscribed
  // Home grid so both stay identical in style.
  const renderTile = (s: Section, i: number) => {
    const th = (TILE as Record<string, TileSkin>)[s.key];
    const isOpen = open === s.key;
    return (
    <button key={s.key} className="hubTile" data-tour={sm ? undefined : `hub-${s.key}`} onClick={() => setOpen(isOpen ? null : s.key)}
      style={{ position: "relative", overflow: "hidden", aspectRatio: "1 / 1",
        // Brand-inspired fill: Instagram's multi-stop gradient verbatim, else the
        // app's from→to. These fills are dark/saturated → WHITE ink + light icon.
        background: th.bg || `linear-gradient(160deg, ${th.from} 0%, ${th.to} 100%)`,
        // Selected → a ring in the tile's OWN ink (dark on a light skin tile, white on a
        // dark one) so the selection reads on every skin, not just dark brand fills.
        border: `1.5px solid ${isOpen ? th.ink : th.edge}`, borderRadius: RAD, padding: PAD,
        cursor: "pointer", fontFamily: "inherit", color: th.ink, textAlign: "center", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: TGAP,
        // Depth: coloured drop glow + a top inner highlight + a bottom inner shade.
        boxShadow: isOpen
          ? `0 0 0 2px ${th.ink}, 0 16px 32px -10px ${th.glow}`
          : `0 10px 26px -12px ${th.glow}, inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -12px 26px -14px rgba(0,0,0,0.34)`,
        animation: `hubPop .45s ease ${i * 0.05}s both` }}>
      {/* glossy top sheen — the Apple-style light catch */}
      <span aria-hidden style={{ position: "absolute", insetInline: 0, top: 0, height: "52%", borderRadius: `${RAD}px ${RAD}px 0 0`,
        background: "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 100%)", pointerEvents: "none", zIndex: 1 }} />
      {/* per-section illustration behind the icon (LIGHT ink on the dark brand fill, low-alpha) */}
      <TileArt kind={s.key} ink={th.ink} />
      {/* large faint section glyph in the corner for extra depth */}
      <s.Icon aria-hidden size={BIGICON} color={th.ink} strokeWidth={1.2} style={{ position: "absolute", insetInlineEnd: -16, bottom: -14, opacity: 0.12, pointerEvents: "none", zIndex: 1 }} />
      {/* app-icon chip — frosted DARK-glass plate so the LIGHT icon reads on the brand fill */}
      <span style={{ position: "relative", zIndex: 2, width: CHIP, height: CHIP, flexShrink: 0, borderRadius: 13, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.34)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px -5px rgba(0,0,0,0.5)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <s.Icon size={CHIPI} color={th.ink} strokeWidth={2.3} />
      </span>
      {/* label — WHITE brand ink in the app's typographic spirit (font + weight + tracking
          + case per brand), with a per-brand shadow for legibility (incl. TikTok's neon glow). */}
      <span style={{ position: "relative", zIndex: 2, display: "block", maxWidth: "100%", padding: sm ? (mobile ? "2px 6px" : "4px 8px") : (mobile ? "2px 6px" : "5px 9px") }}>
        {/* FitLabel wraps ONLY at word boundaries ("TRADING &" / "ANALYSIS"), keeps whole
            words atomic (never a mid-word break that orphans a lone "ת"/"ם"/"s"), and
            auto-shrinks a too-long label so it fits the tile in both he + en. */}
        <FitLabel text={s.l[lang]} size={LBL} maxLines={2}
          style={{ fontFamily: th.font, fontWeight: th.weight, textTransform: th.upper ? "uppercase" : "none", letterSpacing: th.tracking, color: th.ink, textShadow: th.shadow }} />
      </span>
    </button>
    );
  };

  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 560, margin: "0 auto", direction: rtl ? "rtl" : "ltr" }}>
      <style>{`@keyframes hubPop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes hubDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}@keyframes hubSpin{to{transform:rotate(360deg)}}.hubSpinSlow{transform-origin:center;animation:hubSpin 60s linear infinite}.hubSpinRev{transform-origin:center;animation:hubSpin 26s linear infinite reverse}.hubTile{transition:transform .16s ease, box-shadow .18s ease}.hubTile:hover{transform:translateY(-2px)}.hubTile:active{transform:translateY(0) scale(.99)}`}</style>

      {/* tiles + the live roundabout that encircles them */}
      {sm ? (
        // Compact in-page header hub: plain 2×2 grid, no globe.
        <div style={{ position: "relative", width: "100%", maxWidth: GRIDW, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: GAP }}>
            {SECTIONS.map(renderTile)}
          </div>
        </div>
      ) : (
        // Home springboard: a square stage whose width === the orbit-ring diameter,
        // with the 2×2 grid INSCRIBED dead-centre at GRIDPCT% of the diameter so the
        // four tiles sit neatly inside the circle with an even margin from the ring.
        <div style={{ position: "relative", width: "100%", maxWidth: STAGE, aspectRatio: "1 / 1", margin: "0 auto" }}>
          {/* Earth + the dashed orbit ring both fill the square → a perfect circle
              concentric with the grid, framing the tiles symmetrically. */}
          <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
            {/* colourful turning Earth behind the tiles */}
            <div style={{ position: "absolute", inset: "3.5%" }}><EarthGlobe spin={58} /></div>
            {/* metallic dark-silver orbit ring (shared) — frames the inscribed tiles */}
            <MetalRing />
            {/* vivid asset/currency glyphs slowly orbiting the ring (replaces the old
                satellite bead + faint running lines) — lightweight SMIL, not distracting */}
            <OrbitSymbols />
          </div>
          {/* the inscribed 2×2 grid — centred on the circle, sized to fit inside it.
              (position:relative so the Help-Portal slot can anchor to its corner.) */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: `${GRIDPCT}%`, zIndex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: GAP }}>
            {SECTIONS.map(renderTile)}
          </div>
        </div>
      )}
      {/* Help Portal launcher — a LABELLED pill. Anchored to the SectionHub ROOT's
          top-right corner (NOT the inset orbit square), so on Home its RIGHT edge lines
          up with the CARD's right edge — the same edge as the P&L / "Live open positions"
          bars directly above it. Nudged right by the card's own horizontal padding
          (6px mobile / 14px desktop) to meet that edge exactly, and lifted up into the
          clear gap just BELOW the positions bar (the orb ring's open top-right corner —
          not over a tile or the ring). Physical top/right so it stays right-aligned in
          both RTL (he, primary) + LTR. The overlay it opens is portaled to <body>, so the
          transformed orb no longer traps it. */}
      {!sm && helpSlot && (
        <div style={{ position: "absolute", top: 0, right: 0, transform: `translate(${mobile ? 6 : 14}px, ${mobile ? -20 : -22}px)`, zIndex: 4 }}>
          {helpSlot}
        </div>
      )}

      {/* mini-menu: smaller squircle tiles in the SAME style as the big ones */}
      {sec && (
        <div ref={miniRef} style={{ marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: 14, boxShadow: "0 16px 40px -24px rgba(0,0,0,0.5)", animation: "hubDown .3s cubic-bezier(.22,.61,.36,1) both" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 800, color: C.text }}>
              {/* Icon ink = the section tile's OWN ink (onAccent per skin), so it reads on the
                  now skin-toned section gradient (was a fixed white that vanished on light skins). */}
              <span style={{ width: 22, height: 22, borderRadius: 7, background: GRADS[sec.key], display: "inline-flex", alignItems: "center", justifyContent: "center" }}><sec.Icon size={13} color={(TILE as Record<string, TileSkin>)[sec.key].ink} /></span>
              {sec.l[lang]}
            </span>
            <button onClick={() => setOpen(null)} aria-label="close" style={{ width: 26, height: 26, borderRadius: "50%", background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><X size={14} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${MINI + 6}px, 1fr))`, gap: 12, justifyItems: "center" }}>
            {sec.items.filter((it) => !it.admin || admin).map((it, k) => (
              <button key={it.p} className={it.soon ? undefined : "hubTile"} onClick={() => go(it.p)}
                title={it.soon ? (lang === "he" ? "בקרוב" : "Coming soon") : undefined}
                style={{ background: "none", border: "none", cursor: it.soon ? "default" : "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                  animation: `hubPop .4s cubic-bezier(.22,.61,.36,1) ${k * 0.05}s both` }}>
                <span style={{ position: "relative", width: MINI, height: MINI, borderRadius: MINI * 0.28,
                  // Premium (Signal Bot): glossy-black fill + faint gold edge — the same
                  // identity as the Home shortcuts row. "Soon" (WhatsApp placeholder):
                  // muted surface + dashed gold edge. Others keep the section gradient.
                  background: it.soon ? C.surface2 : it.premium ? "linear-gradient(160deg, #2a2a2e 0%, #050506 100%)" : GRADS[sec.key],
                  border: it.soon ? `1px dashed ${C.gold}66` : it.premium ? `1px solid ${C.gold}55` : "none",
                  opacity: it.soon ? 0.9 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: it.premium ? "0 6px 16px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)" : "none" }}>
                  <it.Icon size={mobile ? 26 : 30} color={it.soon ? C.muted : it.premium ? C.gold : (TILE as Record<string, TileSkin>)[sec.key].ink} strokeWidth={2.1} />
                  {it.premium && (
                    // small gold star accent — subtle, in the corner (matches the brand mark)
                    <span aria-hidden style={{ position: "absolute", top: -3, insetInlineEnd: -3, color: C.gold,
                      fontSize: 12, lineHeight: 1, textShadow: `0 0 5px ${C.gold}, 0 0 10px ${C.gold}aa` }}>★</span>
                  )}
                  {it.soon && (
                    // "Soon" pill — marks WhatsApp as not-yet-wired without a fake number
                    <span style={{ position: "absolute", top: -7, insetInlineEnd: -7, fontSize: 8, fontWeight: 800, letterSpacing: "0.04em",
                      color: onAccent(C.gold), background: C.gold, borderRadius: 999, padding: "2px 6px", lineHeight: 1, whiteSpace: "nowrap" }}>
                      {lang === "he" ? "בקרוב" : "Soon"}
                    </span>
                  )}
                </span>
                <FitLabel text={it.l[lang]} size={11} maxLines={2} lineHeight={1.1}
                  style={{ fontWeight: 700, color: it.soon ? C.muted : C.text, textAlign: "center", maxWidth: MINI + 22 }} />
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// Per-tile illustration — a subtle, Apple-restrained graphic that sits BEHIND the
// icon/label to give each section its own visual identity & depth. Drawn in the
// brand's LIGHT ink at a low master opacity so it reads as a soft light shade on
// the dark/saturated brand fill without fighting the label/icon above it.
function TileArt({ kind, ink }: { kind: string; ink: string }) {
  const TILE_INK = ink; // local alias keeps the SVG drawing code below unchanged
  const s: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1, opacity: 0.26 };
  if (kind === "trade") {
    // markets: faint grid + rising candlesticks + an uptrend arrow
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={s} aria-hidden>
        <g stroke={TILE_INK} strokeWidth="0.7" opacity="0.3"><line x1="0" y1="76" x2="100" y2="76" /><line x1="0" y1="56" x2="100" y2="56" /></g>
        <g opacity="0.7">
          {([[18, 62, 16], [36, 52, 24], [54, 46, 18], [72, 36, 28]] as [number, number, number][]).map(([x, y, h], i) => (
            <g key={i}><line x1={x} y1={y - 5} x2={x} y2={y + h + 5} stroke={TILE_INK} strokeWidth="1.2" /><rect x={x - 3.6} y={y} width="7.2" height={h} rx="2" fill={TILE_INK} opacity="0.6" /></g>
          ))}
        </g>
        <path d="M10 72 L34 60 L52 64 L86 30" fill="none" stroke={TILE_INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
        <path d="M77 30 L86 30 L86 39" fill="none" stroke={TILE_INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
      </svg>
    );
  }
  if (kind === "learn") {
    // education: an open book at the foot + sparkles
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={s} aria-hidden>
        <g opacity="0.8" stroke={TILE_INK} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d="M18 76 Q34 68 50 74 Q66 68 82 76" />
          <path d="M18 76 L18 60 Q34 52 50 58 L50 74" />
          <path d="M82 76 L82 60 Q66 52 50 58" />
        </g>
        <g fill={TILE_INK}>
          <path d="M72 22 l1.4 3.4 3.4 1.4 -3.4 1.4 -1.4 3.4 -1.4 -3.4 -3.4 -1.4 3.4 -1.4 z" opacity="0.9" />
          <path d="M28 30 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 z" opacity="0.7" />
        </g>
      </svg>
    );
  }
  if (kind === "connect") {
    // network: nodes linked to a hub
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={s} aria-hidden>
        <g stroke={TILE_INK} strokeWidth="1.4" opacity="0.6">
          <line x1="24" y1="34" x2="50" y2="58" /><line x1="76" y1="30" x2="50" y2="58" />
          <line x1="22" y1="72" x2="50" y2="58" /><line x1="78" y1="70" x2="50" y2="58" />
        </g>
        <g fill={TILE_INK} opacity="0.85">
          <circle cx="24" cy="34" r="4" /><circle cx="76" cy="30" r="4" />
          <circle cx="22" cy="72" r="4" /><circle cx="78" cy="70" r="4" />
        </g>
        <circle cx="50" cy="58" r="5.5" fill={TILE_INK} opacity="0.95" />
      </svg>
    );
  }
  // account — a shield with a check mark
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" style={s} aria-hidden>
      <g opacity="0.8" stroke={TILE_INK} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M50 26 L72 34 L72 52 Q72 70 50 80 Q28 70 28 52 L28 34 Z" />
        <path d="M41 52 L48 59 L60 44" />
      </g>
    </svg>
  );
}
