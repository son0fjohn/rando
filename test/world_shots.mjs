// The map anywhere (scripts/city_areas.json, web/citytiles.js, the Itaewon
// blend): for each test place a top-down shot of the 3D city next to a plain
// plan of the same square drawn straight from the source data
// (scripts/plan_map.py, north up), a street-level shot at night, the
// landmarks, and how long a new area takes to load (cold, then from the
// device cache). Plus the worldwide fallback on its own: Calgary with the
// archive switched off, from OpenMapTiles-style tiles (scripts/
// omt_fixture.py calgary; the live OpenFreeMap needs a network that reaches it).
//   node test/world_shots.mjs <dir> [gangnam,itaewon,...]
// Frame rates here are SwiftShader (software GL), not a phone's: open the
// map with ?fps=1 on a phone for those.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/world_shots.mjs <dir> [places]"); process.exit(2); }
const ONLY = process.argv[3]?.split(",");
await mkdir(OUT, { recursive: true });
const PLACES = [
  { id: "gangnam", label: "Gangnam Station", area: "gangnam", lat: 37.4979, lng: 127.0276, half: 500 },
  { id: "itaewon", label: "Itaewon (hand-made, unchanged)", area: "itaewon", lat: 37.5346, lng: 126.9946, half: 500 },
  { id: "itaewon-edge", label: "Itaewon's edge: the hand-made map into the procedural city, up to N Seoul Tower", area: "itaewon,namsan", lat: 37.5440, lng: 126.9912, half: 650, at: [37.5346, 126.9946] },
  { id: "hongdae", label: "Hongdae", area: "hongdae", lat: 37.5563, lng: 126.9236, half: 500 },
  { id: "calgary", label: "Downtown Calgary", area: "calgary", lat: 51.0447, lng: -114.0631, half: 500 },
  { id: "edmonton", label: "Downtown Edmonton", area: "edmonton", lat: 53.5430, lng: -113.4900, half: 650 },
  { id: "jamsil", label: "Lotte World Tower", area: "jamsil", lat: 37.5126, lng: 127.1025, half: 450 },
].filter(p => !ONLY || ONLY.includes(p.id));
const { base, close } = await serve();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const snap = async (pg, path) => { const c = await pg.context().newCDPSession(pg); const r = await c.send("Page.captureScreenshot", { format: "png" }); await writeFile(path, Buffer.from(r.data, "base64")); await c.detach(); };
// everything round the camera is in
const settled = pg => pg.waitForFunction(() => { const s = window.__w?.city?.stats(); return s && s.firstRingMs && !s.inflight && !s.queued; }, null, { timeout: 300000, polling: 400 }).then(() => true, () => false);
const rows = [];

async function open(url, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.errs = [];
  pg.on("pageerror", e => pg.errs.push(e.message));
  const t0 = Date.now();
  await pg.goto(url);
  const ring = await pg.waitForFunction(() => window.__w?.city?.stats().firstRingMs, null, { timeout: 300000, polling: 300 }).then(h => h.jsonValue(), () => null);
  return { pg, ctx, ring, wall: Date.now() - t0 };
}

for (const p of PLACES) {
  console.log(`\n${p.label}`);
  const row = { id: p.id, label: p.label };
  const at = p.at ?? [p.lat, p.lng];
  // 1. top-down, day, no fog: the layout, north up, the same square as the plan
  const A = await open(`${base}/test/city.html?at=${at[0]},${at[1]}&mode=day&me=0`, { width: 800, height: 800 });
  row.firstRingMs = Math.round(A.ring ?? -1);
  const mode = await A.pg.evaluate(() => window.__w.blending ? "Itaewon + city" : window.__w.cityOn ? "city" : "Itaewon");
  ok(A.ring != null, `${mode}: the first ring of chunks in ${row.firstRingMs} ms (page open to ring: ${A.wall} ms)`);
  await A.pg.evaluate(({ lat, lng, half }) => {
    const w = window.__w, c = w.geo(lat, lng);
    w.scene.fog = null; w.observing = true; w.camGoal = null;
    w.target.set(c.x, 0, c.z);
    Object.assign(w.cam, { theta: 0, elev: 1.47, dist: (half * 0.55 * 2) / (2 * Math.tan(25 * Math.PI / 180)) });
    w.camera.far = 6000; w.camera.updateProjectionMatrix(); w.applyCamera();
  }, p);
  ok(await settled(A.pg), "every chunk round the square is in");
  await sleep(1800);
  await snap(A.pg, join(OUT, `${p.id}-top.png`));
  const dup = await A.pg.evaluate(() => { const n = {}; for (const L of window.__w.labels) if (!L.hidden) n[L.el.textContent] = (n[L.el.textContent] ?? 0) + 1; return Object.entries(n).filter(([, v]) => v > 1 && v < 99).map(([k, v]) => `${k} ×${v}`); });
  if (dup.length) console.log(`    (labels more than once: ${dup.slice(0, 6).join(", ")})`);
  const st = await A.pg.evaluate(() => { const s = window.__w.city.stats(); const c = s.log.filter(l => !l.empty);
    return { chunks: s.chunks, buildings: c.reduce((n, l) => n + l.buildings, 0), tris: s.tris, draws: s.draws,
      chunkMs: c.map(l => l.ms).sort((a, b) => a - b), fetch: c.map(l => l.fetch).sort((a, b) => a - b), build: c.map(l => l.build).sort((a, b) => a - b) }; });
  const med = a => a.length ? Math.round(a[a.length >> 1]) : null;
  Object.assign(row, { chunks: st.chunks, buildings: st.buildings, tris: st.tris, draws: st.draws, chunkP50: med(st.chunkMs), fetchP50: med(st.fetch), buildP50: med(st.build) });
  console.log(`    ${st.chunks} chunks, ${st.buildings} buildings, ${(st.tris / 1000).toFixed(0)}k triangles, ${st.draws} draws · per chunk p50 ${row.chunkP50} ms (fetch ${row.fetchP50}, build ${row.buildP50})`);
  // again, from this phone's cache
  await A.pg.reload();
  const warm = await A.pg.waitForFunction(() => window.__w?.city?.stats().firstRingMs, null, { timeout: 300000, polling: 300 }).then(h => h.jsonValue(), () => null);
  row.cachedRingMs = Math.round(warm ?? -1);
  console.log(`    from the device cache: first ring ${row.cachedRingMs} ms`);
  ok(!A.pg.errs.length, `no page errors${A.pg.errs.length ? ": " + A.pg.errs.slice(0, 2).join(" | ") : ""}`);
  await A.ctx.close();
  // the plan of the same square from the raw data
  try { execFileSync("python3", ["scripts/plan_map.py", p.area, String(p.lat), String(p.lng), String(p.half), join(OUT, `${p.id}-plan.png`)], { stdio: "ignore" }); }
  catch (e) { console.log("    (no plan: " + e.message.split("\n")[0] + ")"); }
  // 2. street level, at night (the app's own camera)
  const S = await open(`${base}/test/city.html?at=${p.lat},${p.lng}&mode=night`, { width: 390, height: 844 });
  await settled(S.pg);
  await sleep(2500);
  await snap(S.pg, join(OUT, `${p.id}-street.png`));
  await S.pg.evaluate(() => { const w = window.__w; w.observing = true; w.cam.dist = 420; w.cam.elev = 0.62; w.cam.theta = 2.4; w.applyCamera(); });
  await settled(S.pg); await sleep(1800);
  await snap(S.pg, join(OUT, `${p.id}-wide.png`));
  await S.ctx.close();
  rows.push(row);
}

// the worldwide fallback on its own (Calgary, the archive switched off)
if (!ONLY || ONLY.includes("omt")) {
  console.log("\nThe worldwide fallback alone: Calgary from OpenMapTiles-style tiles");
  if (!existsSync(new URL("./.omt/tiles.json", import.meta.url))) execFileSync("python3", ["scripts/omt_fixture.py", "calgary"], { stdio: "inherit" });
  const F = await open(`${base}/test/city.html?at=51.0447,-114.0631&mode=day&me=0&tiles=/none.pmtiles&omt=/test/.omt/tiles.json`, { width: 800, height: 800 });
  ok(F.ring != null, `first ring in ${Math.round(F.ring ?? -1)} ms with no archive at all`);
  await F.pg.evaluate(() => { const w = window.__w; w.scene.fog = null; w.observing = true; w.target.set(0, 0, 0); Object.assign(w.cam, { theta: 0, elev: 1.47, dist: 590 }); w.camera.far = 6000; w.camera.updateProjectionMatrix(); w.applyCamera(); });
  await settled(F.pg); await sleep(1800);
  await snap(F.pg, join(OUT, "calgary-fallback-top.png"));
  const fs = await F.pg.evaluate(() => { const s = window.__w.city.stats(); return { chunks: s.chunks, buildings: s.log.reduce((n, l) => n + l.buildings, 0) }; });
  ok(fs.buildings > 500, `${fs.buildings} buildings in ${fs.chunks} chunks, all from the fallback`);
  rows.push({ id: "calgary-fallback", firstRingMs: Math.round(F.ring ?? -1), ...fs });
  await F.ctx.close();
}

await writeFile(join(OUT, "world_stats.json"), JSON.stringify(rows, null, 1));
console.log(`\n${fails ? "✗" : "✓"} ${fails} failures · ${join(OUT, "world_stats.json")}`);
await browser.close(); close();
process.exit(fails ? 1 : 0);
