import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronLeft, CandlestickChart } from "lucide-react";
import { C, SHADOW, RADIUS, UI, loadThemePrefs } from "../theme";
import { useI18n } from "../i18n";
import { useIsMobile } from "../lib/useIsMobile";

// Embedded TradingView "Advanced Real-Time Chart" widget — the official, free
// embeddable widget (NOT an API). It is a SEPARATE visual "trading screen": it
// does NOT feed our engine; all of our scan / backtest / profit results still
// come from our own engine. The widget loads its own iframe from tradingview.com
// (allow-listed in the CSP in index.html — script-src / frame-src / connect-src /
// img-src). The theme is matched to the app's active skin MODE (dark / light).
type Props = {
  symbol?: string;   // TradingView symbol, e.g. "BINANCE:BTCUSDT"
  height?: number;   // chart body height in px (header sits above it) — default is responsive
  interval?: string; // default daily candles
};

export default function TradingViewChart({ symbol = "BINANCE:BTCUSDT", height, interval = "D" }: Props) {
  const { lang, rtl } = useI18n();
  const mobile = useIsMobile();
  // The chart is the PROMINENT element on inner screens (Dan), so it defaults BIG:
  // ~460px on desktop, ~360px on mobile — the room freed by the now-compact TileNav
  // tiles goes here. An explicit `height` prop still overrides for any caller.
  const chartH = height ?? (mobile ? 360 : 460);
  // Collapsible: default EXPANDED so it never blocks the controls below — a slim
  // header with a chevron hides/shows the chart. Plain state (no persistence).
  const [open, setOpen] = useState(true);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Match the active skin: "dark" or "light" (read the same theme pref the app
  // persists — switching skin re-themes the chrome; the chart picks up the mode
  // it was mounted under, and re-injects if the mode changes).
  const mode = loadThemePrefs().mode; // "dark" | "light"
  const Chevron = open ? ChevronDown : (rtl ? ChevronLeft : ChevronRight);

  // Lazy / once init: the widget script is injected ONLY when expanded, and the
  // effect re-runs ONLY when its inputs actually change (open / symbol / interval
  // / mode / locale) — never on every render. Cleaned up on unmount or collapse.
  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = ""; // start clean (guards against a double-inject)
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    container.style.width = "100%";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    container.appendChild(widget);
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: mode,                 // ← app skin mode (dark / light)
      style: "1",                  // candles
      locale: lang === "he" ? "he_IL" : "en",
      hide_side_toolbar: true,
      allow_symbol_change: true,
      save_image: false,
      support_host: "https://www.tradingview.com",
    });
    container.appendChild(script);
    host.appendChild(container);
    return () => { host.innerHTML = ""; };
  }, [open, symbol, interval, mode, lang]);

  const title = lang === "he" ? "מסך מסחר חי" : "Live trading screen";

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: RADIUS.md, boxShadow: SHADOW, overflow: "hidden", marginBottom: 14, fontFamily: UI }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "transparent", border: "none", cursor: "pointer",
          padding: "11px 14px", minHeight: 44, color: C.text, fontFamily: "inherit",
          textAlign: rtl ? "right" : "left",
        }}
      >
        <CandlestickChart size={16} color={C.gold} />
        <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{title}</span>
        <span style={{ fontSize: 11, color: C.faint }}>TradingView</span>
        <Chevron size={18} color={C.muted} />
      </button>
      {open && (
        <div ref={hostRef} style={{ height: chartH, width: "100%", borderTop: `1px solid ${C.line}` }} />
      )}
    </div>
  );
}
