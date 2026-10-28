// The map's city mode (web/citytiles.js) in the six test places
// (scripts/city_areas.json): a day and a night shot from the player's spot
// and one pulled back, the time until the first ring of chunks is on
// screen, per-chunk fetch / build / mount times (cold, then again from the
// device cache), what one frame at the map's own zoom draws (draw calls and
// triangles, renderer.info: the phone budget is 150 and 300k), and the frame
// rate while the camera orbits.
//   node test/city_shots.mjs <dir> [itaewon,hongdae,...] [--phone]
// --phone: the CPU slowed 4× (a mid-range phone's main thread; the chunk
// worker isn't slowed). Frame rates here are SwiftShader (software GL):
// compare places with each other, not with a phone; draw calls and
// triangles are the phone numbers.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const argv = process.argv.slice(2);
const OUT = argv.find(a => !a.startsWith("--") && !/^[a-z,]+$/.test(a)) ?? argv[0];
if (!OUT) { console.error("usage: node test/city_shots.mjs <dir> [areas]"); process.exit(2); }
const ONLY = argv.find(a => a !== OUT && /^[a-z,]+$/.test(a))?.split(",");
const PHONE = argv.includes("--phone");
await mkdir(OUT, { recursive: true });
const areas = JSON.parse(await readFile(new URL("../scripts/city_areas.json", import.meta.url))).areas
  .filter(a => !ONLY || ONLY.includes(a.id));
const { base, close } = await serve();
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const results = [];
const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(0); };

for (const a of areas) {
  console.log(`\n${a.label}`);
  const row = { id: a.id, label: a.label };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  for (const mode of ["day", "night"]) {
    const pg = await ctx.newPage();
    if (PHONE) await (await ctx.newCDPSession(pg)).send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const errs = [];
    pg.on("pageerror", e => errs.push(e.message));
    pg.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
    const url = `${base}/test/city.html?city=tiles&at=${a.lat},${a.lng}&mode=${mode}`;
    await pg.goto(url, { timeout: 120000 });
    await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 30000 });
    const ring = await pg.waitForFunction(() => window.__w?.city?.stats().firstRingMs, null, { timeout: 180000, polling: 200 }).then(h => h.jsonValue(), () => null);
    ok(ring != null, `${mode}: the first ring of chunks is in (${ring?.toFixed(0)} ms)`);
    await pg.waitForTimeout(1500);
    // one frame at the map's own zoom, the worst of eight headings
    const frame = await pg.evaluate(() => {
      const w = window.__w, out = { calls: 0, tris: 0 };
      for (let i = 0; i < 8; i++) {
        Object.assign(w.cam, w.CAM_DEFAULT, { theta: i * Math.PI / 4 }); w.applyCamera(); w.city.update(w.target);
        w.renderer.render(w.scene, w.camera);
        out.calls = Math.max(out.calls, w.renderer.info.render.calls); out.tris = Math.max(out.tris, w.renderer.info.render.triangles);
      }
      Object.assign(w.cam, w.CAM_DEFAULT); w.applyCamera();
      return out;
    });
    ok(frame.calls <= 150 && frame.tris <= 300000, `${mode}: a frame at the map's zoom draws ${frame.calls} calls, ${(frame.tris / 1000).toFixed(0)}k triangles (budget 150, 300k)`);
    await pg.screenshot({ path: join(OUT, `${a.id}-${mode}.png`) });
    // pulled back and turned: the wider street grid
    await pg.evaluate(() => { const w = window.__w; w.cam.dist = 360; w.cam.elev = 0.82; w.cam.theta = 0.9; w.applyCamera(); w.needsRender = true; });
    await pg.waitForTimeout(1200);
    await pg.screenshot({ path: join(OUT, `${a.id}-${mode}-wide.png`) });
    const st = await pg.evaluate(() => window.__w.city.stats());
    const cold = st.log.filter(l => !l.empty);
    // the frame rate while orbiting (render every frame)
    const fps = await pg.evaluate(() => new Promise(res => {
      const w = window.__w; let n = 0; const t0 = performance.now();
      w.cam.dist = 175; w.cam.elev = 0.58;
      const step = () => {
        w.cam.theta += 0.02; w.applyCamera(); w.needsRender = true; n++;
        if (performance.now() - t0 < 4000) requestAnimationFrame(step); else res(n / ((performance.now() - t0) / 1000));
      };
      requestAnimationFrame(step);
    }));
    const r = row[mode] = {
      firstRingMs: Math.round(ring ?? -1), nearRingMs: Math.round(st.nearRingMs ?? -1), chunks: st.chunks, draws: st.draws, tris: st.tris, fps: +fps.toFixed(1),
      frame,
      chunkMs: { p50: pct(cold.map(l => l.ms), 0.5), p90: pct(cold.map(l => l.ms), 0.9) },
      fetchMs: { p50: pct(cold.map(l => l.fetch), 0.5), p90: pct(cold.map(l => l.fetch), 0.9) },
      buildMs: { p50: pct(cold.map(l => l.build), 0.5), p90: pct(cold.map(l => l.build), 0.9) },
      mountMs: { p50: pct(cold.map(l => l.mount), 0.5), p90: pct(cold.map(l => l.mount), 0.9) },
      buildings: cold.reduce((s, l) => s + l.buildings, 0),
    };
    console.log(`  ${mode}: near ring ${r.nearRingMs} ms, ring ${r.firstRingMs} ms · chunk p50 ${r.chunkMs.p50} ms (fetch ${r.fetchMs.p50}, build ${r.buildMs.p50}, mount ${r.mountMs.p50}) · ${r.draws} draws · ${(r.tris / 1000).toFixed(0)}k tris · ${r.fps} fps (SwiftShader)`);
    ok(st.chunks >= 9 && st.tris > 1000, `${mode}: ${st.chunks} chunks on screen, ${r.buildings} buildings`);
    // again, from the device cache
    if (mode === "night") {
      await pg.reload({ timeout: 120000 });
      await pg.waitForFunction(() => window.__ready, null, { timeout: 30000 });
      const warm = await pg.waitForFunction(() => window.__w?.city?.stats().firstRingMs, null, { timeout: 180000, polling: 200 }).then(h => h.jsonValue(), () => null);
      const st2 = await pg.evaluate(() => window.__w.city.stats());
      const hits = st2.log.filter(l => l.cached === "device").length;
      row.cached = { firstRingMs: Math.round(warm ?? -1), fromDevice: hits, of: st2.log.filter(l => !l.empty).length,
        fetchMs: { p50: pct(st2.log.filter(l => !l.empty).map(l => l.fetch), 0.5) } };
      console.log(`  reload: ring ${row.cached.firstRingMs} ms, ${hits}/${row.cached.of} chunks from the device cache (fetch p50 ${row.cached.fetchMs.p50} ms)`);
      ok(hits > 0, "a reload reads chunks from the device cache");
    }
    ok(!errs.length, `${mode}: no page errors${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}`);
    await pg.close();
  }
  results.push(row);
  await ctx.close();
}
await writeFile(join(OUT, "city_stats.json"), JSON.stringify(results, null, 1));
console.log(`\n${fails ? "✗" : "✓"} ${fails} failures · ${join(OUT, "city_stats.json")}`);
await browser.close(); close();
process.exit(fails ? 1 : 0);
