// The map's view range (Pokémon GO style) and its light from the place on
// screen. For Itaewon (the hand-made map + the city round it) and a
// procedural-city spot, by day and by night, at the closest and the
// furthest zoom: a shot each at phone width, and the numbers — how far you
// can see (the screen's ground cast onto the street, cut where the fog is
// total), where your character sits on the screen, the camera's angle, what
// one frame draws (draw calls, triangles), the chunks loaded, and the frame
// rate (SwiftShader here: compare runs with each other, not with a phone).
// Then the same moment in Seoul and in Calgary side by side (the sun over
// the place shown, not the phone's clock), and a sunset sped up as frames.
//   node test/view_shots.mjs <dir> [range,sun,sunset] [--prefix=before]
// Works on older builds too (no ?sunat hook: the sun part is skipped).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const argv = process.argv.slice(2);
const OUT = argv.find(a => !a.startsWith("--") && !/^[a-z,]+$/.test(a));
if (!OUT) { console.error("usage: node test/view_shots.mjs <dir> [range,sun,sunset] [--prefix=before]"); process.exit(2); }
const PARTS = (argv.find(a => a !== OUT && /^[a-z,]+$/.test(a)) ?? "range,sun,sunset").split(",");
const PREFIX = (argv.find(a => a.startsWith("--prefix="))?.slice(9) ?? "").replace(/(.)$/, "$1-");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const snap = async (pg, path) => { const c = await pg.context().newCDPSession(pg); const r = await c.send("Page.captureScreenshot", { format: "png" }); await writeFile(path, Buffer.from(r.data, "base64")); await c.detach(); };
const settled = pg => pg.waitForFunction(() => { const s = window.__w?.city?.stats(); return !window.__w?.city || (s && s.firstRingMs && !s.inflight && !s.queued); }, null, { timeout: 240000, polling: 400 }).then(() => true, () => false);
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const SPOTS = [
  { id: "itaewon", label: "Itaewon (hand-made + the city round it)", lat: 37.5346, lng: 126.9946 },
  { id: "gangnam", label: "Gangnam (procedural city)", lat: 37.4979, lng: 127.0276 },
];
const out = { range: [], sun: [] };

// in the page: what the camera sees, in metres
function measure() {
  const w = window.__w, cam = w.camera, T = w.target, V = cam.position.constructor;
  w.renderer.render(w.scene, w.camera);
  const info = { calls: w.renderer.info.render.calls, tris: w.renderer.info.render.triangles };
  cam.updateMatrixWorld();
  const f = w.scene.fog, radial = !!f && f.near < 0;
  const fwd = new V(); cam.getWorldDirection(fwd);
  const fl = Math.hypot(fwd.x, fwd.z) || 1, fx = fwd.x / fl, fz = fwd.z / fl;
  const cx = radial ? cam.position.x - fx * f.near : 0, cz = radial ? cam.position.z - fz * f.near : 0;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const fogAt = (p, depth) => !f ? 0 : radial ? ss(f.far * (w.FOG_START ?? 0.5), f.far, Math.hypot(p.x - cx, p.z - cz)) : ss(f.near, f.far, depth);
  let maxR = 0, top = null, N = 32, sky = 0;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const sx = i / N * 2 - 1, sy = j / N * 2 - 1;
    const d = new V(sx, sy, 0.5).unproject(cam).sub(cam.position).normalize();
    if (d.y >= -1e-4) { sky++; continue; }
    const k = (T.y - cam.position.y) / d.y;
    if (k > cam.far) { sky++; continue; }
    const p = cam.position.clone().add(d.clone().multiplyScalar(k));
    const fog = fogAt(p, k * d.dot(fwd));
    if (fog >= 0.98) continue;
    const r = Math.hypot(p.x - T.x, p.z - T.z);
    maxR = Math.max(maxR, r);
    if (i === N / 2 && j === N) top = r;
  }
  // where the ground stops being visible straight ahead (fog total), from the character
  let ahead = 0;
  for (let r = 0; r < 4000; r += 2) {
    const p = new V(T.x + fx * r, T.y, T.z + fz * r), depth = p.clone().sub(cam.position).dot(fwd);
    const v = p.clone().project(cam);
    if (v.y > 1 || fogAt(p, depth) >= 0.98) break;
    ahead = r;
  }
  const ch = new V(T.x, T.y + 7, T.z).project(cam);
  const elevDeg = Math.asin((cam.position.y - T.y) / cam.position.distanceTo(T)) * 180 / Math.PI;
  const pitchDeg = -Math.asin(fwd.y) * 180 / Math.PI;
  const st = w.city?.stats();
  return { ...info, chunks: st?.chunks ?? 0, cityTris: st?.tris ?? 0, maxR_m: Math.round(maxR / 0.55), ahead_m: Math.round(ahead / 0.55), top_m: top == null ? null : Math.round(top / 0.55),
    skyPct: Math.round(sky / ((N + 1) * (N + 1)) * 100), charFromTopPct: Math.round((-ch.y * 0.5 + 0.5) * 100), dist: Math.round(w.cam.dist), camElevDeg: +elevDeg.toFixed(1), pitchDeg: +pitchDeg.toFixed(1),
    fog: f ? { near: Math.round(f.near), far: Math.round(f.far), radial } : null, viewR_m: w.viewR ? Math.round(w.viewR / 0.55) : null };
}
async function fps(pg, ms = 3000) {
  return pg.evaluate(ms => new Promise(res => { const w = window.__w; let n = 0; const t0 = performance.now(); const loop = () => { w.needsRender = true; n++; if (performance.now() - t0 < ms) requestAnimationFrame(loop); else res(+(n * 1000 / (performance.now() - t0)).toFixed(1)); }; requestAnimationFrame(loop); }), ms);
}
// the furthest / closest zoom the player can pinch to (older builds: 420 / 70 at the home tilt)
const zoom = (pg, which) => pg.evaluate(which => {
  const w = window.__w, Z = w.ZOOM ?? { min: 70, max: 420 };
  const dist = which === "max" ? Z.max : Z.min;
  w.camGoal = null;
  Object.assign(w.cam, { dist, elev: w.elevFor ? w.elevFor(dist) : w.CAM_DEFAULT.elev });
  w.applyCamera();
}, which);

if (PARTS.includes("range")) for (const s of SPOTS) for (const mode of ["day", "night"]) {
  console.log(`\n${s.label}, ${mode}`);
  const ctx = await browser.newContext(PHONE);
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto(`${base}/test/city.html?at=${s.lat},${s.lng}&mode=${mode}`);
  await pg.waitForFunction(() => window.__ready || window.__failed, null, { timeout: 60000 });
  await pg.waitForFunction(() => window.__w?.city?.stats().firstRingMs, null, { timeout: 240000, polling: 300 }).catch(() => {});
  for (const which of ["max", "min"]) {
    await zoom(pg, which);
    await settled(pg); await sleep(2500);
    const m = await pg.evaluate(measure);
    m.fps = await fps(pg);
    const row = { spot: s.id, mode, zoom: which, ...m };
    out.range.push(row);
    console.log(`    zoom ${which}: you see ${m.maxR_m} m round you at most, ${m.ahead_m} m straight ahead; character ${m.charFromTopPct}% down; camera ${m.camElevDeg}° up, looking ${m.pitchDeg}° down (dist ${m.dist}); ${m.calls} draws, ${(m.tris / 1000).toFixed(0)}k tris, ${m.chunks} chunks, ${m.fps} fps`);
    await snap(pg, join(OUT, `${PREFIX}range-${s.id}-${mode}-${which}.png`));
  }
  ok(!errs.length, `no page errors${errs.length ? ": " + errs.slice(0, 2).join(" | ") : ""}`);
  await ctx.close();
}

// Seoul vs Calgary at the same UTC moment, on the real app page (the glass follows too)
const LOOK = encodeURIComponent(JSON.stringify({ skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" }));
const PLACES = { seoul: [37.5347, 126.9945], calgary: [51.0447, -114.0631] };
const MOMENTS = [
  { id: "seoul-noon", iso: "2026-10-29T03:00:00Z", note: "12:00 KST in Seoul = 21:00 MDT the evening before in Calgary" },
  { id: "calgary-noon", iso: "2026-10-29T18:00:00Z", note: "12:00 MDT in Calgary = 03:00 KST the next night in Seoul" },
];
async function appAt(place, iso, extra = "") {
  const ctx = await browser.newContext({ ...PHONE, locale: "en-US" });
  await ctx.addInitScript(() => { try { localStorage.setItem("rando-lang", "en"); localStorage.setItem("rando-hint-v1", "1"); } catch {} });
  const pg = await ctx.newPage();
  pg.errs = []; pg.on("pageerror", e => pg.errs.push(e.message));
  const [lat, lng] = PLACES[place];
  await pg.goto(`${base}/app.html?onb=0&me=mina&av=${LOOK}&devlat=${lat}&devlng=${lng}&sunat=${iso}&dev=1${extra}`);
  await pg.waitForFunction(() => !!document.querySelector("#navbar:not([hidden])"), null, { timeout: 180000, polling: 300 }).catch(() => {});
  await pg.evaluate(() => import("/web/world3d.js").then(W => { window.__w = W.world3d; }));
  return { ctx, pg };
}
if (PARTS.includes("sun")) {
  for (const M of MOMENTS) {
    console.log(`\n${M.iso}: ${M.note}`);
    for (const place of ["seoul", "calgary"]) {
      const { ctx, pg } = await appAt(place, M.iso);
      // the map moves to the place (Itaewon's map loads first, then the city there) and the light with it
      await pg.waitForFunction(lat => { const i = window.__w?.sunInfo?.(); return !i || Math.abs(i.lat - lat) < 0.3; }, PLACES[place][0], { timeout: 120000, polling: 500 }).catch(() => {});
      await settled(pg); await sleep(4000);
      const st = await pg.evaluate(() => {
        const w = window.__w;
        return { day: getComputedStyle(document.documentElement).getPropertyValue("--day").trim(), light: w?.light, sun: w?.sunInfo?.(), chip: document.getElementById("dev-light")?.textContent };
      });
      out.sun.push({ moment: M.iso, place, ...st });
      console.log(`    ${place}: --day ${st.day} · light ${st.light} · ${st.chip ?? ""} · sun ${st.sun ? `${st.sun.alt.toFixed(1)}° up, bearing ${st.sun.bearing.toFixed(0)}°` : "?"}`);
      await snap(pg, join(OUT, `${PREFIX}sun-${M.id}-${place}.png`));
      ok(!pg.errs.length, `no page errors${pg.errs.length ? ": " + pg.errs.slice(0, 2).join(" | ") : ""}`);
      await ctx.close();
    }
  }
  const at = (m, p) => out.sun.find(r => r.moment === m && r.place === p);
  if (at(MOMENTS[0].iso, "seoul")?.sun) {
    ok(+at(MOMENTS[0].iso, "seoul").day === 1 && +at(MOMENTS[0].iso, "calgary").day === 0, "noon in Seoul: Seoul is lit by day, Calgary (same moment) is night");
    ok(+at(MOMENTS[1].iso, "seoul").day === 0 && +at(MOMENTS[1].iso, "calgary").day === 1, "noon in Calgary: Calgary by day, Seoul at night");
  }
}

// a sunset in Seoul, sped up: 16:40 to 18:20 KST in frames
if (PARTS.includes("sunset")) {
  console.log("\nSeoul's sunset, sped up (frames)");
  const { ctx, pg } = await appAt("seoul", "2026-10-29T07:40:00Z");
  await settled(pg); await sleep(6000);
  const has = await pg.evaluate(() => typeof globalThis.__sunClock !== "undefined" || !!window.__w?.sunInfo);
  if (has) {
    const frames = [];
    for (let k = 0; k <= 10; k++) {
      const t = Date.parse("2026-10-29T07:40:00Z") + k * 10 * 60000;
      await pg.evaluate(t => { globalThis.__sunClock = () => t; }, t);
      await sleep(1600);
      const st = await pg.evaluate(() => { const w = window.__w; return { day: getComputedStyle(document.documentElement).getPropertyValue("--day").trim(), sun: w.sunInfo?.() }; });
      frames.push({ t: new Date(t).toISOString(), ...st });
      console.log(`    ${new Date(t + 9 * 3600000).toISOString().slice(11, 16)} KST: --day ${st.day} · sun ${st.sun?.alt.toFixed(1)}°`);
      await snap(pg, join(OUT, `${PREFIX}sunset-${String(k).padStart(2, "0")}.png`));
    }
    out.sunset = frames;
    ok(frames.every((f, i) => !i || +f.day <= +frames[i - 1].day) && +frames[0].day === 1 && +frames.at(-1).day === 0, "the light goes down step by step, day to night");
  } else console.log("    (no sun clock hook in this build)");
  await ctx.close();
}

await writeFile(join(OUT, `${PREFIX}view_stats.json`), JSON.stringify(out, null, 1));
await browser.close(); await close();
console.log(fails ? `\n${fails} check(s) failed` : "\nall good");
process.exit(fails ? 1 : 0);
