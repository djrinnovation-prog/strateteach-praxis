import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { FontLoader, type Font } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadThemePrefs } from "../theme";
import { useIsMobile } from "../lib/useIsMobile";
import { LOGO_PALETTES, type SkinKey } from "../lib/logoPalettes";
import typefaceJson from "../assets/baloo2-800.typeface.json";

// ── Wordmark3DGL — the PERMANENT Home headline: REAL WebGL 3D "StrateTeach" (Dan-approved). ──
// Look (Dan): SOLID 3D letters, coloured faces + coloured bevel, NO white line/frame, no mosaic —
// the e880200 solid state. Three.js TextGeometry (Baloo 2 800 → typeface JSON), one solid mesh per
// letter in the per-letter palette colour with a per-letter STRONG→SOFT gradient. PBR MeshStandard
// lit by a RoomEnvironment IBL + key/fill/rim. FULLY STATIC — drawn ON DEMAND (once, then on resize
// / skin change), GPU idle.
// VIEW is dead head-on (ORTHOGRAPHIC, zero rotation — no tilt/skew); centred, equal L/R (LTR + RTL).
const SKIN_KEYS: Record<string, SkinKey> = { navy: "navy", peach: "peach", amber: "amber", aurora: "aurora" };

function lum(hex: string): number {
  const h = hex.replace("#", ""); const i = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return 0.2126 * ((i >> 16) & 255) + 0.7152 * ((i >> 8) & 255) + 0.0722 * (i & 255);
}
// Per-letter STRONG→SOFT gradient (Dan): first letter = the BOLDEST/deepest palette tone, then each
// subsequent letter a progressively LIGHTER/softer shade — the palette's tones sorted dark→light.
function letterColors(pal: string[], n: number): string[] {
  const sorted = [...pal].sort((a, b) => lum(a) - lum(b));
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, n); i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    out.push(sorted[Math.round(t * (sorted.length - 1))]);
  }
  return out;
}

export default function Wordmark3DGL({ text = "StrateTeach", height, style }: {
  text?: string;
  height?: number;           // INITIAL/fallback CSS height (px) — the canvas then self-sizes to the word
  style?: React.CSSProperties;
}) {
  const mobile = useIsMobile();
  const hostRef = useRef<HTMLDivElement>(null);
  const cssH = height ?? (mobile ? 66 : 94);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch { return; }                                  // no WebGL → leave the frame empty
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // ORTHOGRAPHIC, dead head-on (Dan: no angle) — no perspective foreshortening, every letter the
    // same size; frustum set in fit(). Camera straight down -Z.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.set(0, 0, 6);
    camera.lookAt(0, 0, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(3, 5, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-5, -1, 3); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 1.1); rim.position.set(-2, 3, -6); scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    const font: Font = new FontLoader().parse(typefaceJson as any);
    const SIZE = 1;
    // Smooth rounded bevel (no white frame — Dan reversed on the white line) so each letter reads as
    // a clean solid 3D glyph with a soft coloured edge, like the e880200 solid state.
    const geoOpts = { font, size: SIZE, depth: SIZE * 0.34, curveSegments: mobile ? 5 : 7,
      bevelEnabled: true, bevelThickness: SIZE * 0.06, bevelSize: SIZE * 0.055, bevelSegments: mobile ? 3 : 5 } as any;
    const RES = (typefaceJson as any).resolution || 1000;
    const glyphs = (typefaceJson as any).glyphs || {};
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const letters: { idx: number; mat: THREE.MeshStandardMaterial }[] = [];   // for skin recolour

    const palOf = (skin: string) => LOGO_PALETTES[SKIN_KEYS[skin] || "navy"] || LOGO_PALETTES.navy;
    let PAL = palOf(loadThemePrefs().skin as string);

    const chars = Array.from(text);
    let penX = 0, ci = 0;
    const LS = SIZE * 0.09;                              // per-letter tracking (Dan: more space between letters)
    let gradColors = letterColors(PAL, chars.filter((c) => c !== " ").length);   // strong→soft across the word
    for (const ch of chars) {
      const adv = ((glyphs[ch]?.ha ?? 520) / RES) * SIZE + LS;
      if (ch === " ") { penX += adv; continue; }
      const color = gradColors[ci];
      const geo = new TextGeometry(ch, geoOpts);
      // SOLID single-colour 3D glyph — the whole letter (face + bevel + sides) in the per-letter
      // colour, NO white frame (Dan reversed on the white line).
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), metalness: 0.25, roughness: 0.34, envMapIntensity: 1.1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.x = penX;
      group.add(mesh);
      disposables.push(geo, mat);
      letters.push({ idx: ci, mat });
      penX += adv; ci++;
    }

    const gb = new THREE.Box3().setFromObject(group);
    const gs = new THREE.Vector3(); gb.getSize(gs);
    const gc = new THREE.Vector3(); gb.getCenter(gc);
    group.position.set(-gc.x, -gc.y, -gc.z);
    const pivot = new THREE.Group(); pivot.add(group); scene.add(pivot);
    pivot.rotation.set(0, 0, 0);                         // DEAD STRAIGHT — zero rotation (Dan: no angle)

    const wordW = gs.x, wordH = Math.max(1e-4, gs.y);
    const ASPECT = wordW / wordH;                        // fit to the word's own width

    const recolour = () => {
      PAL = palOf(loadThemePrefs().skin as string);
      gradColors = letterColors(PAL, letters.length);
      for (const L of letters) L.mat.color.set(gradColors[L.idx]);
    };

    const FIT = mobile ? 1.10 : 1.09;                    // LARGER word (Dan) — less side margin, still clip-safe (≥~12px)
    // ORTHOGRAPHIC fit — no perspective, so the word projects at EXACTLY its geometric size: framing
    // wordW*FIT contains it with FIT margin (clip-safe). Frustum matched to the canvas aspect so
    // nothing distorts; fits BOTH width and height with margin.
    const fit = (aspect: number) => {
      let halfW = (wordW * FIT) / 2;
      let halfH = halfW / aspect;
      const needH = (wordH * FIT) / 2;
      if (halfH < needH) { halfH = needH; halfW = halfH * aspect; }
      camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    };

    // SELF-SIZE the canvas height to the word aspect (+ a little vertical room) so the frame hugs it.
    const VMARGIN = 1.16;
    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const w = host.clientWidth || 320;
      const hc = Math.max(28, Math.round(w / ASPECT * VMARGIN));
      host.style.height = hc + "px";
      renderer.setSize(w, hc, false);
      fit(w / hc);                                       // ortho frustum from the canvas aspect (also updates the projection)
      render();                                          // render ON DEMAND (no animation loop)
    };
    resize();

    // Re-draw only when the layout changes or the skin changes — no rAF loop, so the GPU is idle.
    const ro = new ResizeObserver(() => resize());
    ro.observe(host);
    const onTheme = () => { recolour(); render(); };
    window.addEventListener("algo770-theme", onTheme);

    return () => {
      ro.disconnect();
      window.removeEventListener("algo770-theme", onTheme);
      disposables.forEach((d) => d.dispose());
      envRT.texture.dispose(); pmrem.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [text, mobile, cssH]);

  return <div ref={hostRef} aria-label={text} role="img"
    style={{ width: "100%", height: cssH, maxWidth: "100%", ...style }} />;
}
