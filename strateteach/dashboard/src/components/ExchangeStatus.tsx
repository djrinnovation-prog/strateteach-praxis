import React from "react";
import { useNavigate } from "react-router-dom";
import { loadExchangeCreds } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";

// Small reusable "is my exchange connected?" pill, shown on the trading screens
// (Trading Engine, Daily Scan, Backtests) so the user always knows whether live
// trading is wired up. Tap it to jump to the Exchange screen. Reads the
// non-custodial creds from the browser (same source the Exchange screen uses).
export default function ExchangeStatus() {
  const nav = useNavigate();
  const { lang } = useI18n();
  const he = lang === "he";
  const creds = loadExchangeCreds();
  const connected = !!(creds && creds.key && creds.secret);
  const live = creds?.env === "live";

  return (
    <button
      onClick={() => nav("/exchange")}
      title={he ? "פתח את מסך הבורסה" : "Open the Exchange screen"}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontFamily: "inherit",
        background: connected ? `${C.gain}14` : C.surface2,
        border: `1px solid ${connected ? `${C.gain}66` : C.line}`,
        color: connected ? C.gain : C.muted,
        borderRadius: 999, padding: "5px 11px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: connected ? C.gain : C.faint,
        animation: connected ? "xstatpulse 1.8s infinite" : undefined,
      }} />
      {connected
        ? <>{he ? "בורסה מחוברת" : "Exchange connected"}{live ? " · LIVE" : " · TESTNET"}</>
        : <>{he ? "בורסה לא מחוברת — חברו" : "Exchange not connected — connect"}</>}
      <style>{"@keyframes xstatpulse{0%{box-shadow:0 0 0 0 rgba(14,158,99,.5)}70%{box-shadow:0 0 0 6px rgba(14,158,99,0)}100%{box-shadow:0 0 0 0 rgba(14,158,99,0)}}"}</style>
    </button>
  );
}
