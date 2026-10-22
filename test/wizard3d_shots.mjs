// Side Quest's 3D wizard (web/wizard3d.js) on its own: loads, hides the pixel
// wizard once drawn, and every mode + the nod, as screenshots (and a short
// clip with --video: frames, and <dir>/wizard.mp4 when FFMPEG=/path/to/ffmpeg).
// Runs on the dealer's rig unless --model=3d.
//   node test/wizard3d_shots.mjs <dir> [--model=dealer|3d] [--video]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--")) ?? "wizard-shots";
const MODEL = (args.find(a => a.startsWith("--model=")) ?? "--model=dealer").slice(8);
const VIDEO = args.includes("--video");
await mkdir(OUT, { recursive: true });
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { base, close } = await serve();
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 260, height: 340 }, deviceScaleFactor: 2 });
const pg = await ctx.newPage();
const warn = []; pg.on("console", m => { if (/wizard3d/.test(m.text())) warn.push(m.text()); });
pg.on("pageerror", e => warn.push(e.message));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

await pg.goto(`${base}/test/wizard3d.html?wizard=${MODEL}`);
await pg.waitForFunction(() => window.__ready, null, { timeout: 120000 });
ok(await pg.evaluate(() => !!window.__wiz), `the ${MODEL} model loads (${warn.join("; ") || "no warnings"})`);
await sleep(1500);
ok(await pg.evaluate(() => document.getElementById("w").classList.contains("w3d-on")), "a 3D frame is up, the pixel wizard hides");
const fit = await pg.evaluate(() => {
  const k = window.__wiz, T = k.THREE, b = new T.Box3().setFromObject(k.root, true);
  const p = [new T.Vector3(b.min.x, b.min.y, 0), new T.Vector3(b.max.x, b.max.y, 0)].map(v => v.project(k.camera));
  return { x0: p[0].x, y0: p[0].y, x1: p[1].x, y1: p[1].y };
});
ok(fit.y0 > -1 && fit.y1 < 1 && fit.x0 > -1 && fit.x1 < 1, `the whole body is in frame (ndc ${Object.values(fit).map(v => v.toFixed(2)).join(", ")})`);
let frame = 0, filmed = 0;
const film = async ms => {    // as many frames as the page gives; the clip plays at the real rate
  if (!VIDEO) return sleep(ms);
  await mkdir(join(OUT, "frames"), { recursive: true });
  const t0 = Date.now();
  for (const end = t0 + ms; Date.now() < end;) { await pg.screenshot({ path: join(OUT, "frames", `${String(frame++).padStart(4, "0")}.png`) }); await sleep(40); }
  filmed += Date.now() - t0;
};
for (const m of ["idle", "glow", "swirl", "spin", "landed"]) {
  await pg.evaluate(m => window.__mode(m), m); await film(m === "idle" ? 800 : 1400);
  if (m === "landed") { await pg.evaluate(() => window.__wiz.nod()); await film(320); }
  await pg.screenshot({ path: join(OUT, `wizard-${m}.png`) });
  if (VIDEO) await film(m === "landed" ? 900 : 1200);
}
if (VIDEO && process.env.FFMPEG) execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-framerate", (frame / (filmed / 1000)).toFixed(2), "-i", join(OUT, "frames", "%04d.png"), "-vf", "scale=520:-2", "-pix_fmt", "yuv420p", join(OUT, "wizard.mp4")]);
ok(await pg.evaluate(() => { const c = document.querySelector(".sq-w3d"); return c && c.width > 0 && document.querySelectorAll(".sq-w3d").length === 1; }), "one canvas, reused");
await pg.evaluate(() => window.__wiz.detach());
ok(await pg.evaluate(() => !document.querySelector(".sq-w3d") && !document.getElementById("w").classList.contains("w3d-on")), "detach removes the canvas and brings the pixel wizard back");
await ctx.close(); await browser.close(); close();
console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
process.exit(fail ? 1 : 0);
