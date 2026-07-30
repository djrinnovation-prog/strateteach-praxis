import React from "react";
import { C } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import EarthGlobe from "./EarthGlobe";

// Deterministic starfield so positions are stable between renders.
const STARS = Array.from({ length: 64 }, (_, i) => {
  const rnd = (n: number) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
  return { x: +(rnd(1) * 100).toFixed(2), y: +(rnd(2) * 100).toFixed(2), s: +(1 + rnd(3) * 2.3).toFixed(2), o: +(0.2 + rnd(4) * 0.5).toFixed(2), d: +(rnd(5) * 4).toFixed(2), t: +(2.2 + rnd(6) * 3).toFixed(2) };
});

// Shared ambient backdrop rendered behind every (non-home) screen: a twinkling
// starfield plus a colourful turning Earth in the trailing corner. Skin-aware.
export default function SpaceBackdrop() {
  const mobile = useIsMobile();
  const stars = mobile ? STARS.slice(0, 36) : STARS;
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <style>{"@keyframes sbTw{0%,100%{opacity:.12}50%{opacity:.8}}"}</style>
      {stars.map((st, i) => (
        <span key={i} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, borderRadius: "50%",
          background: i % 6 === 0 ? C.gold : "#fff", opacity: st.o, boxShadow: i % 6 === 0 ? `0 0 6px ${C.gold}` : "none",
          animation: mobile ? "none" : `sbTw ${st.t}s ease-in-out ${st.d}s infinite` }} />
      ))}
      <div style={{ position: "absolute", insetInlineEnd: "-16%", bottom: "-26%", width: "min(80vw, 620px)", aspectRatio: "1 / 1", opacity: 0.5 }}>
        <EarthGlobe spin={mobile ? 120 : 95} />
      </div>
    </div>
  );
}
