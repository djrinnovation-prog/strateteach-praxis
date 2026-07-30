import React from "react";
import { isChunkLoadError, reloadOnceForChunkError } from "../lib/chunkReload";

// App-wide error boundary. Two jobs:
//   1) SELF-HEAL a chunk-load error (stale cache after a deploy) — force one hard reload to
//      the fresh build instead of white-screening. This is the safety net that makes a
//      lazy-import-heavy change (like the Settings hub) safe to ship.
//   2) For any OTHER render crash, show a small "something went wrong · refresh" card
//      instead of a blank white screen.
// Placed ABOVE the app's Suspense/Routes so a failed lazy() route load is caught here.

type State = { crashed: boolean; chunk: boolean };

export default class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { crashed: false, chunk: false };

  static getDerivedStateFromError(err: unknown): State {
    return { crashed: true, chunk: isChunkLoadError(err) };
  }

  componentDidCatch(err: unknown): void {
    // Side effects (the reload) belong here, not in getDerivedStateFromError.
    if (isChunkLoadError(err)) reloadOnceForChunkError();
    else { try { console.error("App crash:", err); } catch { /* */ } }
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    const he = (() => { try { return (localStorage.getItem("algo770_lang") || document.documentElement.lang) === "he"; } catch { return true; } })();
    const chunk = this.state.chunk;
    const title = chunk ? (he ? "טוען גרסה חדשה…" : "Loading the new version…") : (he ? "משהו השתבש" : "Something went wrong");
    const sub = chunk
      ? (he ? "מתעדכנים לגרסה האחרונה. אם זה נתקע, רעננו." : "Updating to the latest version. If it hangs, refresh.")
      : (he ? "רעננו את הדף כדי להמשיך." : "Refresh the page to continue.");
    return (
      <div dir={he ? "rtl" : "ltr"} style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        fontFamily: "Rubik, system-ui, sans-serif", background: "#FDF1E8", color: "#3A1D10" }}>
        <div style={{ maxWidth: 380, textAlign: "center", background: "#FFFFFF", border: "1px solid #EDC7B0", borderRadius: 18, padding: "26px 22px", boxShadow: "0 16px 40px -26px rgba(120,60,30,0.4)" }}>
          <div style={{ fontSize: 17, fontWeight: 900, marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: "#8B5942", lineHeight: 1.6, marginBottom: 18 }}>{sub}</div>
          <button onClick={() => { try { window.location.reload(); } catch { /* */ } }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#CB6E54", color: "#fff", border: "none",
              borderRadius: 12, padding: "10px 22px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
            {he ? "רענון" : "Refresh"}
          </button>
        </div>
      </div>
    );
  }
}
