// Humiliation Ritual's 3D clown on its own (test/clown3d.html): it loads,
// and every beat drawn at set moments (frozen clock), as a contact sheet.
//   node test/clown3d_shots.mjs <dir> [--only=juggle,toss]
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/clown3d_shots.mjs <dir> [--only=beat,...]"); process.exit(2); }
const ONLY = (process.argv.find(a => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean);
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const pg = await browser.newPage({ viewport: { width: 316, height: 760 }, deviceScaleFactor: 2 });
const errors = [];
pg.on("pageerror", e => errors.push(e.message));
pg.on("console", m => { if (/clown3d/.test(m.text())) console.log("  [page]", m.text()); });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else fail++; console.log(`  ${c ? "✓" : "✗"} ${m}`); };
await pg.goto(`${base}/test/clown3d.html`);
await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 120000 });
ok(await pg.evaluate(() => window.__ready), "the clown loads (model + rig)");
if (fail) { console.log(`\n${pass} passed, ${fail} failed`); await browser.close(); close(); process.exit(1); }
const info = await pg.evaluate(() => { const k = window.__kit; let tris = 0; k.scene.traverse(o => { if (o.isSkinnedMesh) tris += o.geometry.index.count / 3; }); return { tris, bones: Object.entries(k.bones).filter(([, b]) => !b).map(([n]) => n), wink: !!k.winkMap }; });
ok(info.tris > 1000 && info.tris <= 20000, `one skinned mesh, ${info.tris} triangles`);
ok(info.bones.length === 0, `every bone the motion uses is there${info.bones.length ? ` (missing: ${info.bones})` : ""}`);
ok(info.wink, "the wink texture is built (the left eye repainted closed)");
const BEATS = {
  juggle: [0.1, 0.35, 0.6, 1.0, 1.5, 2.2],
  toss: [0.2, 0.55, 0.9, 1.15, 1.5, 2.1, 2.4, 3.2],
  open: [0.3, 0.6, 0.8, 1.0, 1.4, 2.5],
  peek: [0.3, 0.8, 1.4, 1.7, 2.2, 3.0],
  bow: [0.2, 0.7, 1.2, 2.2],
};
for (const [beat, ts] of Object.entries(BEATS)) {
  if (ONLY.length && !ONLY.includes(beat)) continue;
  for (const t of ts) {
    await pg.evaluate(([b, t]) => window.__frame(b, t), [beat, t]);
    await pg.locator(".cell").screenshot({ path: join(OUT, `${beat}-${t.toFixed(2)}.png`) });
  }
  console.log(`  · ${beat}: ${ts.length} frames`);
}
ok(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ""}`);
console.log(`\n${pass} passed, ${fail} failed · frames in ${OUT}`);
await browser.close(); close();
process.exit(fail ? 1 : 0);
