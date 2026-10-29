// The procedural city next to the hand-made Itaewon, for a style-match
// review: the same shots of both, at the same camera, by day and at night.
// For each spot (scripts/city_areas.json) and once for Itaewon itself, the
// reference: the street where the player stands, the camera pulled back
// wide, and by day a top-down of the square with a plain plan of the real
// layout beside it (scripts/plan_map.py, north up). scripts/style_sheet.py
// lays the shots out side by side, a sheet per spot.
//   node test/style_shots.mjs <dir> [gangnam,hongdae,...]
//   python3 scripts/style_sheet.py <dir> <dir>        (then the sheets)
// SwiftShader (software GL) here: compare shapes, colours and light, not
// frame rates.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/style_shots.mjs <dir> [spots]"); process.exit(2); }
const ONLY = process.argv[3]?.split(",");
await mkdir(OUT, { recursive: true });
const REF = { id: "itaewon", label: "Itaewon (the hand-made map: the reference)", area: "itaewon", lat: 37.5346, lng: 126.9946, half: 500 };
const SPOTS = [
  { id: "itaewon-edge", label: "Itaewon's edge: the hand-made map into the procedural city", area: "itaewon,namsan", lat: 37.5440, lng: 126.9912, half: 650, at: [37.5346, 126.9946] },
  { id: "gangnam", label: "Gangnam Station", area: "gangnam", lat: 37.4979, lng: 127.0276, half: 500 },
  { id: "hongdae", label: "Hongdae", area: "hongdae", lat: 37.5563, lng: 126.9236, half: 500 },
  { id: "calgary", label: "Downtown Calgary", area: "calgary", lat: 51.0447, lng: -114.0631, half: 500 },
  { id: "edmonton", label: "Downtown Edmonton", area: "edmonton", lat: 53.5430, lng: -113.4900, half: 650 },
].filter(p => !ONLY || ONLY.includes(p.id));
// the reference is shot once: always without a spot list; with one, when it's
// named or its shots aren't in <dir> yet
const VIEWS = ["day-street", "day-wide", "night-street", "night-wide", "day-top"];
const refDone = VIEWS.every(v => existsSync(join(OUT, `${REF.id}-${v}.png`)));
const PLACES = [...(!ONLY || ONLY.includes(REF.id) || !refDone ? [REF] : []), ...SPOTS];
const PLAN = fileURLToPath(new URL("../scripts/plan_map.py", import.meta.url));
const { base, close } = await serve();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const snap = async (pg, path) => { const c = await pg.context().newCDPSession(pg); const r = await c.send("Page.captureScreenshot", { format: "png" }); await writeFile(path, Buffer.from(r.data, "base64")); await c.detach(); };
// everything round the camera is in (and where the hand-made map shows, its buildings are up)
const settled = pg => pg.waitForFunction(() => { const w = window.__w, s = w?.city?.stats(); return s && s.firstRingMs && !s.inflight && !s.queued && (!w.blending || w.built); }, null, { timeout: 300000, polling: 400 }).then(() => true, () => false);
const errs = pg => `no page errors${pg.errs.length ? ": " + pg.errs.slice(0, 2).join(" | ") : ""}`;
const rows = [];

async function open(url, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.errs = [];
  pg.on("pageerror", e => pg.errs.push(e.message));
  const t0 = Date.now();
  await pg.goto(url);
  await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 60000 }).catch(() => {});
  const failed = await pg.evaluate(() => window.__failed ?? null).catch(() => null);
  if (failed) { pg.errs.push(failed); return { pg, ctx, ring: null, wall: Date.now() - t0 }; }
  const ring = await pg.waitForFunction(() => window.__w?.city?.stats().firstRingMs, null, { timeout: 300000, polling: 300 }).then(h => h.jsonValue(), () => null);
  return { pg, ctx, ring, wall: Date.now() - t0 };
}

async function shoot(p) {
  const row = { id: p.id, label: p.label, phoneRingMs: {} };
  // 1. the phone's own view, by day and at night: the street where the
  //    player stands, then the camera pulled back wide
  for (const mode of ["day", "night"]) {
    const S = await open(`${base}/test/city.html?at=${p.lat},${p.lng}&mode=${mode}`, { width: 390, height: 844 });
    row.phoneRingMs[mode] = Math.round(S.ring ?? -1);
    const world = await S.pg.evaluate(() => window.__w?.blending ? "Itaewon + city" : window.__w?.cityOn ? "city" : "Itaewon").catch(() => "?");
    ok(S.ring != null, `${mode}: page opened (${world}), the first ring of chunks in ${row.phoneRingMs[mode]} ms`);
    if (S.ring != null) {
      ok(await settled(S.pg), `${mode} street: every chunk round the player is in`);
      await sleep(3500);
      await snap(S.pg, join(OUT, `${p.id}-${mode}-street.png`));
      await S.pg.evaluate(() => { const w = window.__w; w.observing = true; w.cam.dist = 420; w.cam.elev = 0.62; w.cam.theta = 2.4; w.applyCamera(); });
      ok(await settled(S.pg), `${mode} wide: every chunk round the camera is in`);
      await sleep(2500);
      await snap(S.pg, join(OUT, `${p.id}-${mode}-wide.png`));
    }
    ok(!S.pg.errs.length, `${mode}: ${errs(S.pg)}`);
    await S.ctx.close();
  }
  // 2. top-down by day, no fog, nobody standing there: the layout, north up,
  //    the same square as the plan
  const at = p.at ?? [p.lat, p.lng];
  const A = await open(`${base}/test/city.html?at=${at[0]},${at[1]}&mode=day&me=0`, { width: 800, height: 800 });
  row.firstRingMs = Math.round(A.ring ?? -1);
  ok(A.ring != null, `top-down: page opened, the first ring of chunks in ${row.firstRingMs} ms (page open to ring: ${A.wall} ms)`);
  if (A.ring != null) {
    await A.pg.evaluate(({ lat, lng, half }) => {
      const w = window.__w, c = w.geo(lat, lng);
      w.scene.fog = null; w.observing = true; w.camGoal = null;
      w.target.set(c.x, 0, c.z);
      Object.assign(w.cam, { theta: 0, elev: 1.47, dist: (half * 0.55 * 2) / (2 * Math.tan(25 * Math.PI / 180)) });
      w.camera.far = 6000; w.camera.updateProjectionMatrix(); w.applyCamera();
    }, p);
    ok(await settled(A.pg), "top-down: every chunk round the square is in");
    await sleep(1800);
    await snap(A.pg, join(OUT, `${p.id}-day-top.png`));
    // the city's chunks (the hand-made map isn't in these), and the whole frame
    const st = await A.pg.evaluate(() => { const w = window.__w, s = w.city.stats(), c = s.log.filter(l => !l.empty), f = w.renderer.info.render;
      return { chunks: s.chunks, buildings: c.reduce((n, l) => n + l.buildings, 0), tris: s.tris, draws: s.draws, frameTris: f.triangles, frameDraws: f.calls,
        chunkMs: c.map(l => l.ms).sort((a, b) => a - b), fetch: c.map(l => l.fetch).sort((a, b) => a - b), build: c.map(l => l.build).sort((a, b) => a - b) }; });
    const med = a => a.length ? Math.round(a[a.length >> 1]) : null;
    Object.assign(row, { chunks: st.chunks, buildings: st.buildings, tris: st.tris, draws: st.draws, frameTris: st.frameTris, frameDraws: st.frameDraws, chunkP50: med(st.chunkMs), fetchP50: med(st.fetch), buildP50: med(st.build) });
    console.log(`    ${st.chunks} chunks, ${st.buildings} buildings, ${(st.tris / 1000).toFixed(0)}k triangles, ${st.draws} draws · per chunk p50 ${row.chunkP50} ms (fetch ${row.fetchP50}, build ${row.buildP50}) · the frame: ${(st.frameTris / 1000).toFixed(0)}k triangles, ${st.frameDraws} draws`);
  }
  ok(!A.pg.errs.length, `top-down: ${errs(A.pg)}`);
  await A.ctx.close();
  // the plan of the same square from the raw data
  try { execFileSync("python3", [PLAN, p.area, String(p.lat), String(p.lng), String(p.half), join(OUT, `${p.id}-plan.png`)], { stdio: "ignore" }); }
  catch (e) { console.log("    (no plan: " + e.message.split("\n")[0] + ")"); }
  rows.push(row);
}

for (const p of PLACES) {
  console.log(`\n${p.label}`);
  try { await shoot(p); }
  catch (e) {
    ok(false, `${p.id}: ${String(e?.message ?? e).split("\n")[0]}`);
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
}

await writeFile(join(OUT, "style_stats.json"), JSON.stringify(rows, null, 1));
console.log(`\n${fails ? "✗" : "✓"} ${fails} failures · ${join(OUT, "style_stats.json")}`);
const spots = ONLY?.filter(s => s !== REF.id).join(",");
console.log(`  the sheets: python3 scripts/style_sheet.py ${OUT} ${OUT}${spots ? " " + spots : ""}`);
await browser.close(); close();
process.exit(fails ? 1 : 0);
