import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Wallet, Pencil, ChevronDown, ChevronRight } from "lucide-react";
import { api, loadExchangeCreds } from "../app/api";
import { useDeferred } from "../lib/useDeferred";
import { useI18n } from "../i18n";
import { C, MONO } from "../theme";
import { SimBadge, RiskDisclaimer } from "../ui";
import { validateAmount } from "../lib/money";
import FieldError from "./FieldError";

// Top-of-home money widget — visible on every device. Shows the exchange
// connection, real-money balance + today's P&L, demo P&L and open positions,
// plus the admin "NEW" promo. Keys are per-browser (non-custodial), so the
// real $ appears wherever the user has connected on that device.
export default function HomeTop() {
  const { lang, rtl } = useI18n();
  const nav = useNavigate();
  const creds = loadExchangeCreds() as any;
  const connected = !!(creds && creds.key && creds.secret);
  const exName = creds?.name ? String(creds.name) : "exchange";
  const isLive = creds?.env === "live";
  const [hide, setHide] = useState(false);
  // The money card mirrors the "Live open positions" collapsible right below it: a
  // slim header that toggles the full card open. DEFAULT COLLAPSED (auto-minimized)
  // so Home opens calm & uncluttered — plain component state, no persistence, so it
  // always starts collapsed on every load.
  const [open, setOpen] = useState(false);
  const toggleOpen = () => setOpen((v) => !v);

  // "Deposited capital" (cost basis) editor — a tiny inline numeric input opened
  // by the pencil on the REAL / DEMO lines. Setting it makes the card's % reflect
  // the user's real gain on their deposited capital immediately. Per (user, env).
  const [editEnv, setEditEnv] = useState<null | "live" | "demo">(null);
  const [cbInput, setCbInput] = useState("");
  const [cbSaving, setCbSaving] = useState(false);
  const openCbEdit = async (env: "live" | "demo") => {
    setEditEnv(env);
    setCbInput("");
    try {
      const r = await api.getCostBasis(env);
      if (r?.costBasis != null) setCbInput(String(r.costBasis));
    } catch { /* leave blank on failure */ }
  };
  // Client-side guard: deposited capital must be a valid, non-negative number (empty
  // = clear/0). The server stays authoritative; this just blocks obvious bad input.
  const cbCheck = validateAmount(cbInput, { lang, allowEmpty: true, max: 1e12 });
  const saveCb = async () => {
    if (!editEnv || !cbCheck.ok) return;
    const v = parseFloat(cbInput);
    setCbSaving(true);
    try {
      await api.setCostBasis(editEnv, isNaN(v) ? 0 : v);
      setEditEnv(null);
      // Refresh both cards so the new baseline / % shows right away.
      liveQ.refetch(); pnlQ.refetch();
    } catch { /* keep the editor open on failure */ }
    finally { setCbSaving(false); }
  };

  const liveQ = useQuery({ queryKey: ["dashboardLive"], queryFn: () => api.dashboardLive(), refetchInterval: 15000, retry: 0 });
  const pnlQ = useQuery({ queryKey: ["livePnl"], queryFn: () => api.livePnl(), enabled: connected, retry: false, refetchInterval: 30000 });
  // The promo is non-critical: defer it until after first paint (shares the same
  // ["featurePromo"] query as Home, so it's still one fetch), and pause its poll
  // while the tab is hidden.
  const promoReady = useDeferred();
  const promoQ = useQuery({ queryKey: ["featurePromo"], queryFn: () => api.getAnnouncement(), enabled: promoReady, refetchInterval: 60000, refetchIntervalInBackground: false, staleTime: 30000 });
  const promo = (promoQ.data as any)?.promo as { title: string; body: string; route: string; cta: string } | null | undefined;
  // Constant-speed promo marquee: measure the running track and derive the duration
  // so the announcement always scrolls at the same px/sec regardless of its length.
  // (A fixed 18s made anything but a very long promo crawl so slowly it looked
  // frozen — that's why Dan saw "the promo doesn't run".) ~55px per second.
  const promoRef = useRef<HTMLSpanElement>(null);   // the animated track (two equal halves)
  const [promoDur, setPromoDur] = useState(16);     // non-zero default → it RUNS before any measurement
  // The marquee renders a FIXED, generous number of copies (REPS, below) and the
  // CSS animation always runs — rendering and looping never depend on a measurement.
  // Measurement here is OPTIONAL and only tunes the speed to a constant ~55px/sec;
  // if it never runs (or returns 0), the marquee still shows and scrolls at the
  // default duration. (Regression fix: the previous version gated the copy count on
  // a clientWidth measurement, which could leave the banner empty on first paint.)
  useEffect(() => {
    const el = promoRef.current;
    if (!el) return;
    const halfW = el.scrollWidth / 2;               // one of the two identical halves
    if (halfW > 0) setPromoDur((prev) => { const d = Math.min(70, Math.max(10, halfW / 55)); return Math.abs(prev - d) < 0.2 ? prev : d; });
  }, [promo?.title, promo?.body, promo?.cta, rtl, lang]);

  // DEMO line — today vs the 00:01 baseline (per signed-in user). The change is
  // the day's move in the user's own demo equity; the % is that change over the
  // day-start baseline. First day (no baseline yet) → 0 change / no %.
  const demo = Number((liveQ.data as any)?.demo?.todayChange || 0);
  const demoPct = (liveQ.data as any)?.demo?.todayPct != null ? Number((liveQ.data as any).demo.todayPct) : null;
  const pnl: any = pnlQ.data;
  const realTotal: number | null = pnl?.ok ? Number(pnl.totalValue) : null;
  // REAL line — change is current value − the deposit-aware baseline (period.today).
  // The % is today's change over the BALANCE SHOWN on this line (totalValue), so the
  // two visible figures reconcile ( +$Y on $X reads Y/X% ) instead of dividing by an
  // invisible day-start base. Same-day deposits/withdrawals are already netted out of
  // period.today by the backend, so moving cash never shows as profit. Guard 0 base.
  const realToday: number | null = pnl?.ok && pnl.period?.today != null ? Number(pnl.period.today) : null;
  const realTodayPct: number | null = realToday != null && realTotal != null && realTotal > 0 ? (realToday / realTotal) * 100 : null;
  // HEADLINE — portfolio GROWTH vs. deposited capital (current value − deposit base).
  const realGrowth: number | null = pnl?.ok && (pnl as any).growthPnl != null ? Number((pnl as any).growthPnl) : null;
  const realGrowthPct: number | null = pnl?.ok && (pnl as any).growthPct != null ? Number((pnl as any).growthPct) : null;
  const positions: number | null = pnl?.ok && pnl.count != null ? Number(pnl.count) : null;

  const usd = (v: number | null) => v == null || isNaN(v) ? "—" : "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const signed = (v: number | null) => v == null || isNaN(v) ? "—" : `${v >= 0 ? "+" : "-"}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const col = (v: number | null) => (v == null ? C.muted : v >= 0 ? C.gain : C.loss);
  const pctTxt = (p: number | null) => p == null || isNaN(p) ? "" : ` (${p >= 0 ? "+" : ""}${p.toFixed(2)}%)`;
  const cell = (extra?: React.CSSProperties): React.CSSProperties => ({ background: "none", border: "none", textAlign: rtl ? "right" : "left", cursor: "pointer", fontFamily: "inherit", padding: 0, minWidth: 0, ...extra });
  // small skin-accent chip for the REAL / DEMO / NEW tags — colour follows the skin
  const tag: React.CSSProperties = { fontSize: 8, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--btn-ink)", background: "var(--btn-bg)", borderRadius: 999, padding: "2px 6px", flexShrink: 0 };
  // Premium tile-family CHIP for the card's small icon controls (pencil · eye) — a
  // bordered surface square with a soft inner top highlight, so the controls read as
  // their own pressable chips (the same finish family as the springboard tiles) and
  // sit clearly APART from the numbers instead of crowding them. Skin-aware via C.*.
  const ctrlChip: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, color: C.muted, cursor: "pointer", flexShrink: 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)" };

  // Small discoverable pencil to set/edit the deposited capital for a line.
  const cbBtn = (env: "live" | "demo") => (
    <button onClick={() => openCbEdit(env)} aria-label={lang === "he" ? "הגדר הון שהופקד" : "Set deposited capital"}
      title={lang === "he" ? "הגדר הון שהופקד" : "Set deposited capital"}
      className="tap44" style={ctrlChip}>
      <Pencil size={12} />
    </button>
  );
  // Tiny inline numeric editor that POSTs the value, then refreshes the card.
  const cbEditor = (env: "live" | "demo") => editEnv !== env ? null : (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap", direction: rtl ? "rtl" : "ltr" }}>
      <span style={{ fontSize: 10, color: C.muted, fontWeight: 700 }}>{lang === "he" ? "הון שהופקד ($)" : "Deposited capital ($)"}</span>
      <input type="number" inputMode="decimal" autoFocus value={cbInput}
        onChange={(e) => setCbInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") saveCb(); if (e.key === "Escape") setEditEnv(null); }}
        placeholder="0" aria-invalid={!cbCheck.ok} aria-describedby={cbCheck.ok ? undefined : "cb-cap-err"}
        style={{ width: 92, fontFamily: MONO, fontSize: 12, fontWeight: 700, padding: "3px 7px", borderRadius: 6, border: `1px solid ${cbCheck.ok ? C.gold : C.loss}`, background: C.surface, color: C.text, textAlign: rtl ? "right" : "left" }} />
      <button onClick={saveCb} disabled={cbSaving || !cbCheck.ok}
        style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.03em", padding: "4px 10px", borderRadius: 6, border: "none", background: "var(--btn-bg)", color: "var(--btn-ink)", cursor: (cbSaving || !cbCheck.ok) ? "default" : "pointer", opacity: (cbSaving || !cbCheck.ok) ? 0.6 : 1 }}>
        {cbSaving ? "…" : (lang === "he" ? "שמור" : "Save")}
      </button>
      <button onClick={() => setEditEnv(null)} aria-label={lang === "he" ? "בטל" : "Cancel"}
        className="tap44" style={{ fontSize: 12, fontWeight: 700, padding: "3px 6px", borderRadius: 6, border: "none", background: "none", color: C.muted, cursor: "pointer" }}>✕</button>
      <div style={{ width: "100%" }}><FieldError id="cb-cap-err" message={cbCheck.ok ? undefined : cbCheck.message} /></div>
    </div>
  );

  return (
    <div style={{ background: `linear-gradient(135deg, ${C.gold}3d, ${C.gold}1f), ${C.surface}`, border: `1.5px solid ${C.gold}`, borderRadius: 13, padding: "9px 11px", marginBottom: 9, boxShadow: "0 10px 24px -16px rgba(0,0,0,0.3)", direction: rtl ? "rtl" : "ltr" }}>
      {/* Slim header — mirrors the "Live open positions (N)" collapsible below: a
          compact toggle row (chevron + wallet + label + the key REAL number, small).
          Tapping it expands the full card. DEFAULT collapsed; chevron flips in RTL. */}
      <button onClick={toggleOpen} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0, color: C.text, direction: rtl ? "rtl" : "ltr" }}>
        {open ? <ChevronDown size={15} color={C.muted} /> : <ChevronRight size={15} color={C.muted} style={{ transform: rtl ? "scaleX(-1)" : "none" }} />}
        <Wallet size={13} color={C.gold} />
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.text }}>{lang === "he" ? "תיק" : "P&L"}</span>
        {!open && (connected
          ? <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 800, color: C.text, marginInlineStart: "auto" }}>{hide ? "••••" : (pnlQ.isLoading ? "…" : usd(realTotal))}</span>
          : <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: C.titleInk, fontWeight: 800, marginInlineStart: "auto" }}><Wallet size={11} /> {lang === "he" ? "חבר ←" : "connect →"}</span>)}
      </button>

      {open && (<>
      {/* Line 1 — REAL money: balance + today's P&L · LIVE/TEST · hide (minimal text) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 9 }}>
        <button onClick={() => nav(connected ? "/overview" : "/exchange")} style={cell({ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" })}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? C.gain : C.muted, alignSelf: "center", flexShrink: 0 }} />
          <span style={tag}>{lang === "he" ? "אמיתי" : "REAL"}</span>
          <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: C.text }}>{hide ? "••••" : connected ? (pnlQ.isLoading ? "…" : usd(realTotal)) : "—"}</span>
          {/* PRIMARY — growth vs. deposited capital; else today's change; small "today" tail. */}
          {connected && !hide && realGrowth != null && (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, fontFamily: MONO, fontSize: 12, fontWeight: 900, color: col(realGrowth) }}>
              {signed(realGrowth)}{pctTxt(realGrowthPct)}<span style={{ fontSize: 8.5, fontWeight: 800, color: C.muted }}>{lang === "he" ? "מהפקדה" : "vs dep."}</span>
            </span>
          )}
          {connected && !hide && realGrowth == null && realToday != null && <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 800, color: col(realToday) }}>{signed(realToday)}{pctTxt(realTodayPct)}</span>}
          {connected && !hide && realGrowth != null && realToday != null && <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: C.muted }}>· {signed(realToday)} {lang === "he" ? "היום" : "today"}</span>}
          {!connected && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: C.titleInk, fontWeight: 800 }}><Wallet size={11} /> {lang === "he" ? "חבר ←" : "connect →"}</span>}
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {connected && <span style={{ fontSize: 8.5, fontWeight: 900, padding: "3px 7px", borderRadius: 8, letterSpacing: "0.03em", background: isLive ? "rgba(240,97,109,0.18)" : `${C.gold}2e`, color: isLive ? C.loss : C.titleInk, border: `1px solid ${isLive ? "rgba(240,97,109,0.5)" : `${C.gold}66`}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)" }}>{isLive ? "LIVE" : "TEST"}</span>}
          {cbBtn("live")}
          <button onClick={() => setHide((v) => !v)} aria-label="toggle amounts" className="tap44" style={ctrlChip}>
            {hide ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        </div>
      </div>
      {cbEditor("live")}

      {/* Line 2 — DEMO P&L (one line, semantic green/red number) + edit pencil. The
          SimBadge marks this figure as simulated money so it's never mistaken for real. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
        <button onClick={() => nav("/profit")} style={cell({ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" })}>
          <span style={tag}>{lang === "he" ? "דמו" : "DEMO"}</span>
          <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: col(demo) }}>{hide ? "••••" : (liveQ.isLoading ? "…" : signed(demo) + pctTxt(demoPct))}</span>
          <span style={{ fontSize: 8.5, color: C.muted, fontWeight: 700, letterSpacing: "0.04em" }}>P&L</span>
        </button>
        <SimBadge />
        {cbBtn("demo")}
      </div>
      {cbEditor("demo")}

      {/* Persistent trading-risk note, right by the P&L/balance figures. */}
      <RiskDisclaimer style={{ marginTop: 9 }} />

      {/* NEW promo — ONE compact skin-accent line; the text RUNS (marquee) so the whole
          announcement is readable, no ellipsis. ★NEW chip stays fixed at the edge.
          Opaque skin-tinted surface (no background-symbol bleed); clickable if routed. */}
      {promo && (promo.title || promo.body) && (() => {
        const hasLink = !!(promo.route && promo.route.trim());
        // Two identical copies → seamless loop (translateX -50%). RTL reverses direction.
        // Track layout is forced LTR so the two-copy seamless loop is reliable in every
        // skin/locale; each text piece keeps the language's reading direction so Hebrew
        // still reads correctly. The scroll direction reverses for RTL.
        // One announcement copy: text + a uniform trailing gap that doubles as the
        // separator between repeats, so the stream reads as one continuous line.
        const piece = (key: string, hidden: boolean) => (
          <span key={key} aria-hidden={hidden || undefined} dir={rtl ? "rtl" : "ltr"} style={{ flexShrink: 0, paddingInlineEnd: 38 }}>
            {promo.title && <span style={{ color: C.titleInk }}>{promo.title}</span>}{promo.title && promo.body ? " — " : ""}{promo.body}
            {hasLink && <span style={{ color: C.titleInk, fontWeight: 900 }}> · {promo.cta || (lang === "he" ? "פתח" : "Open")} ›</span>}
          </span>
        );
        // One HALF of the track = a FIXED, generous number of copies (8). The track
        // holds two identical halves and slides exactly one half (translateX -50%)
        // per loop, so the next half lands precisely where the last one was — no jump.
        // 8 copies make each half far wider than the pill on any screen, so a copy is
        // always filling the window (no gap/pause) — and it's all rendered up front,
        // never waiting on a measurement.
        const REPS = 8;
        const half = (g: number) => (
          <span key={`g${g}`} aria-hidden={g > 0 || undefined} style={{ display: "flex", flexShrink: 0 }}>
            {Array.from({ length: REPS }, (_, i) => piece(`${g}-${i}`, !(g === 0 && i === 0)))}
          </span>
        );
        const inner = (
          <>
            <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase", color: "#1a1206", background: `linear-gradient(90deg, ${C.gold}, ${C.accent} 55%, ${C.gain})`, borderRadius: 8, padding: "3px 8px", flexShrink: 0, whiteSpace: "nowrap", border: "1px solid rgba(255,255,255,0.5)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 10px -6px rgba(0,0,0,0.4)" }}>★ {lang === "he" ? "חדש" : "NEW"}</span>
            {/* No CSS mask here: on iOS Safari a `-webkit-mask-image` container whose
                descendant runs a transform animation gets a compositing bug and
                renders BLANK (Android composites it fine — that's why it only broke on
                iPhone). overflow:hidden alone clips the scroll to the pill. */}
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              <span ref={promoRef} style={{ display: "flex", width: "max-content", flexShrink: 0, direction: "ltr", whiteSpace: "nowrap",
                willChange: "transform", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden",
                animation: `htPromoRun ${promoDur}s linear infinite${rtl ? " reverse" : ""}`,
                WebkitAnimation: `htPromoRun ${promoDur}s linear infinite${rtl ? " reverse" : ""}`,
                animationPlayState: "running", fontWeight: 800, fontSize: 11.5, color: C.text } as React.CSSProperties}>
                {half(0)}{half(1)}
              </span>
            </span>
          </>
        );
        // Colourful, skin-aware bar: a tri-colour wash across the skin's three
        // accents (gold → accent → blue) over the opaque surface, with an accent
        // border — clearly colourful on every skin while keeping the text readable.
        const boxStyle: React.CSSProperties = { width: "100%", marginTop: 8, display: "flex", alignItems: "center", gap: 7, boxSizing: "border-box", padding: "5px 8px", borderRadius: 999, fontFamily: "inherit", overflow: "hidden", border: `1px solid ${C.accent}`, background: `linear-gradient(100deg, ${C.gold}40, ${C.accent}3a 48%, ${C.blue}40), ${C.surface}`, direction: rtl ? "rtl" : "ltr" };
        return hasLink ? (
          <button onClick={() => nav(promo.route)} aria-label={promo.title || "New feature"} style={{ ...boxStyle, cursor: "pointer" }}>{inner}</button>
        ) : (
          <div role="status" aria-label={promo.title || "Announcement"} style={{ ...boxStyle, cursor: "default" }}>{inner}</div>
        );
      })()}
      </>)}
      {/* translate3d forces GPU compositing (more reliable on iOS than translateX),
          and the -webkit- keyframes cover older iOS Safari. The name is HomeTop-unique
          (`htPromoRun`): Home.tsx also defines a global `@keyframes promoRun`, and two
          same-named @keyframes in one document collide — whichever the renderer inserts
          last wins, which is not stable across re-renders. A unique name guarantees this
          marquee always binds to ITS keyframes and actually scrolls. */}
      <style>{"@keyframes htPromoRun{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}@-webkit-keyframes htPromoRun{from{-webkit-transform:translate3d(0,0,0);transform:translate3d(0,0,0)}to{-webkit-transform:translate3d(-50%,0,0);transform:translate3d(-50%,0,0)}}"}</style>
    </div>
  );
}
