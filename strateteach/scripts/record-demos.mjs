// Auto-records the per-feature "how it works" demos as clean MP4s — no Chrome
// chrome/toolbar, no manual screen recording. It drives the REAL app with the
// same green numbered-arrow overlay we use live, then saves one video per
// feature into ./demo-videos/.
//
// SETUP (run once, on your Mac or Joe's):
//   cd scripts
//   npm init -y
//   npm i -D playwright
//   npx playwright install chromium
//   # ffmpeg is needed to convert webm -> mp4 (brew install ffmpeg)
//
// RUN:
//   1. In the app (as admin) create a 30-min demo link: Plans/Admin -> Demo testers -> Create.
//   2. DEMO_URL="https://app.strateteach.com/?demo=PASTE_TOKEN" node record-demos.mjs
//
// Output: scripts/demo-videos/<feature>.mp4  → upload each in the app via
//   the feature screen -> "How it works" / reel -> "Upload real video".

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

const DEMO_URL = process.env.DEMO_URL;
if (!DEMO_URL) { console.error("Set DEMO_URL=https://app.strateteach.com/?demo=TOKEN"); process.exit(1); }
const ORIGIN = new URL(DEMO_URL).origin;
const OUT = path.resolve("demo-videos");
const VIEWPORT = { width: 414, height: 896 }; // phone-ish portrait

// Each feature: the route and the ordered buttons to point the green arrow at + click.
const FEATURES = [
  { key: "backtest",  route: "/backtests", steps: ["Crypto", "Run backtest", "Results"] },
  { key: "scanner",   route: "/scanner",   steps: ["New scan"] },
  { key: "profit",    route: "/profit",    steps: ["New run", "Scan the market", "Approve"] },
  { key: "strategy",  route: "/strategy",  steps: ["Parse", "Preview top 10"] },
  { key: "dashboard", route: "/dashboard", steps: [] },
  { key: "performance", route: "/analytics", steps: [] },
];

// Injected into the page: green numbered arrow that points at text + a click helper.
const COACH = `
window.__coach = function(txt, num){
  document.getElementById('__c')?.remove();
  var els=[...document.querySelectorAll('button,a,div,span,h1,h2,h3,p,li')];
  var el=els.find(e=>e.children.length===0&&e.textContent.trim()===txt)||els.find(e=>e.textContent.includes(txt));
  if(!el) return false;
  var r=el.getBoundingClientRect();
  var d=document.createElement('div'); d.id='__c';
  d.style.cssText='position:fixed;z-index:99999;pointer-events:none;left:'+(r.left+r.width/2)+'px;top:'+Math.max(6,r.top-58)+'px;transform:translateX(-50%);text-align:center';
  d.innerHTML='<div style="background:#19c37d;color:#fff;font:700 16px sans-serif;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 3px 10px rgba(0,0,0,.4)">'+num+'</div><div style="color:#19c37d;font-size:34px;line-height:1">&#8595;</div>';
  el.style.outline='3px solid #19c37d'; el.style.outlineOffset='2px'; el.style.borderRadius='10px'; window.__t=el;
  document.body.appendChild(d); return true;
};
window.__do = function(){ var el=window.__t; if(el){ el.click(); } document.getElementById('__c')?.remove(); if(el) el.style.outline=''; };
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const f of FEATURES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: OUT, size: VIEWPORT } });
    const page = await ctx.newPage();
    try {
      // First hit the demo URL so the token logs us in, then go to the feature.
      await page.goto(DEMO_URL, { waitUntil: "networkidle" });
      await sleep(1500);
      await page.goto(ORIGIN + f.route, { waitUntil: "networkidle" });
      await sleep(2500);
      await page.addScriptTag({ content: COACH });
      let n = 1;
      for (const label of f.steps) {
        const ok = await page.evaluate(([t, i]) => window.__coach(t, i), [label, n]);
        await sleep(1800);
        if (ok) { await page.evaluate(() => window.__do()); await sleep(2200); }
        n++;
      }
      await sleep(1500);
    } catch (e) {
      console.error("  !", f.key, e.message);
    }
    await ctx.close(); // finalizes the .webm
    // rename newest webm -> <feature>.webm then convert to mp4
    const files = (await readdir(OUT)).filter((x) => x.endsWith(".webm"));
    const newest = files.map((x) => path.join(OUT, x)).sort()[files.length - 1];
    const webm = path.join(OUT, f.key + ".webm");
    await rename(newest, webm);
    await new Promise((res) => execFile("ffmpeg", ["-y", "-i", webm, "-movflags", "faststart", "-pix_fmt", "yuv420p", path.join(OUT, f.key + ".mp4")], () => res()));
    console.log("✓ recorded", f.key);
  }
  await browser.close();
  console.log("\nDone → scripts/demo-videos/*.mp4. Upload each via its feature's reel → Upload real video.");
}
run();
