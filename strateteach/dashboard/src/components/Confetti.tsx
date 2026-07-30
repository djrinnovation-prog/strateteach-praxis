import { useEffect, useRef } from "react";

// Fullscreen confetti burst, fired by dispatching `window` event "algo770-confetti".
// Canvas-based, no dependency. Mounted once globally.
export default function Confetti() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    let raf = 0;
    let parts: any[] = [];
    const colors = ["#F7931A", "#7CC04E", "#36C5F0", "#E8438F", "#FBC02D", "#ffffff"];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of parts) {
        p.vy += 0.08; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      }
      parts = parts.filter((p) => p.y < canvas.height + 40);
      if (parts.length) { raf = requestAnimationFrame(loop); }
      else { raf = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
    };
    const fire = () => {
      for (let i = 0; i < 180; i++) {
        parts.push({
          x: canvas.width / 2 + (Math.random() - 0.5) * 240,
          y: -20 - Math.random() * canvas.height * 0.25,
          vx: (Math.random() - 0.5) * 7, vy: 2 + Math.random() * 5,
          r: 5 + Math.random() * 7, c: colors[(Math.random() * colors.length) | 0],
          rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        });
      }
      if (!raf) loop();
    };
    window.addEventListener("algo770-confetti", fire);
    return () => { window.removeEventListener("algo770-confetti", fire); window.removeEventListener("resize", resize); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, zIndex: 9999, pointerEvents: "none" }} aria-hidden />;
}
