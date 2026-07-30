import React, { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { api } from "../app/api";
import { useI18n } from "../i18n";
import { C } from "../theme";

// User-side agent for the admin screen-capture feature.
// • Polls /auth/screen/pending; when the admin has requested a capture, it loads
//   html2canvas from a CDN (no build dependency), snapshots the page, and uploads.
// • Polls /auth/screen/active to show a clear "an admin is viewing your screen"
//   banner — capture is never silent.

let _h2cPromise: Promise<any> | null = null;
function loadHtml2Canvas(): Promise<any> {
  if ((window as any).html2canvas) return Promise.resolve((window as any).html2canvas);
  if (_h2cPromise) return _h2cPromise;
  _h2cPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => resolve((window as any).html2canvas);
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return _h2cPromise;
}

const L = {
  he: "מנהל צופה במסך שלך כעת",
  en: "An admin is viewing your screen",
};

export default function ScreenAgent() {
  const { lang } = useI18n();
  const [watched, setWatched] = useState(false);
  const handled = useRef<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;

    const captureIfRequested = async () => {
      try {
        const p = await api.screenPending();
        if (!alive || !p?.capture || !p.requestId || handled.current.has(p.requestId)) return;
        handled.current.add(p.requestId);
        const h2c = await loadHtml2Canvas();
        const canvas = await h2c(document.body, { scale: 0.5, logging: false, useCORS: true, backgroundColor: "#0C0E13" });
        const img = canvas.toDataURL("image/jpeg", 0.6);
        await api.screenUpload(p.requestId, img, location.pathname);
      } catch (_e) { /* retry next tick */ }
    };

    const checkWatched = async () => {
      try { const r = await api.screenActive(); if (alive) setWatched(!!r?.watched); } catch (_e) { /* ignore */ }
    };

    captureIfRequested(); checkWatched();
    const h1 = setInterval(captureIfRequested, 7000);
    const h2 = setInterval(checkWatched, 9000);
    return () => { alive = false; clearInterval(h1); clearInterval(h2); };
  }, []);

  if (!watched) return null;
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, pointerEvents: "none",
      display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(240,97,109,0.95)", color: "#fff",
        padding: "6px 16px", borderRadius: "0 0 12px 12px", fontSize: 13, fontWeight: 700, boxShadow: "0 4px 18px rgba(0,0,0,0.4)" }}>
        <Eye size={14} /> {L[lang]}
      </div>
    </div>
  );
}
