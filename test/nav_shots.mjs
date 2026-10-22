// The world screen's bottom bar on the REAL app page (offline, see
// test/appserve.mjs): the map meets it with a straight edge, the Host tab's
// gold ring (inside the bar, labels in line, the slow glow), a tap (fill +
// sparkle -> the host flow), "My party" once you're in one (tap -> back to the
// room), and reduced motion (no pulse, no blink, no sparkle). Screenshots in
// <dir>; the bar is filmed frame by frame through two pulses and the tap into
// <dir>/ring/ (and <dir>/ring.mp4 with FFMPEG=/path/to/ffmpeg).
//
//   node test/nav_shots.mjs <dir>
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/nav_shots.mjs <dir>"); process.exit(2); }
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const LOOK = { skin: "3", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-hitop-black" };

async function phone(ctx) {
  const pg = await ctx.newPage();
  await pg.goto(`${base}/app.html?me=tony&av=${encodeURIComponent(JSON.stringify(LOOK))}&devlat=37.5347&devlng=126.9945`);
  await pg.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 30000 });
  await pg.waitForFunction(() => !document.getElementById("navbar")?.hidden, null, { timeout: 30000 });
  return pg;
}
const barClip = async pg => { const b = await pg.locator("#navbar").boundingBox(); return { x: 0, y: b.y - 60, width: b.width, height: b.height + 60 }; };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
const A = await phone(ctx);
await sleep(5000);                                       // the world streams in

console.log("\nThe bar");
const geo = await A.evaluate(() => {
  const bar = document.getElementById("navbar"), r = bar.getBoundingClientRect();
  const ring = document.querySelector("#nav-host .nav-ring").getBoundingClientRect();
  const lbls = [...bar.querySelectorAll(".nav-lbl")].map(l => Math.round(l.getBoundingClientRect().bottom));
  const pseudo = side => getComputedStyle(bar, side).content;
  const st = getComputedStyle(document.querySelector("#nav-host .nav-ring"));
  return { bar: [r.top, r.bottom], ring: [ring.top, ring.bottom], lbls, before: pseudo("::before"), after: pseudo("::after"),
    border: st.borderTopWidth, color: st.borderTopColor, anim: st.animationName, dur: st.animationDuration, label: document.querySelector("#nav-host .nav-lbl").textContent };
});
ok(geo.before === "none" && geo.after === "none", "straight edge: no corner pieces over the map");
ok(geo.ring[0] >= geo.bar[0] && geo.ring[1] <= geo.bar[1], `the gold ring stays inside the bar (ring ${geo.ring.map(Math.round)} in ${geo.bar.map(Math.round)})`);
ok(new Set(geo.lbls).size === 1, `all three labels on one line (${geo.lbls.join(", ")})`);
ok(geo.border === "2px" && geo.color === "rgb(255, 200, 61)", `2px #FFC83D ring (${geo.border} ${geo.color})`);
ok(geo.anim === "nav-glow" && geo.dur === "3s", `the glow pulses on a 3 s loop (${geo.anim} ${geo.dur})`);
ok(geo.label === "Host", "label: Host");
await A.screenshot({ path: join(OUT, "01-world.png"), timeout: 120000 });
await A.screenshot({ path: join(OUT, "02-bar.png"), clip: await barClip(A), timeout: 120000 });

// film the bar frame by frame (the software renderer can't keep up live):
// pause the CSS animations and step their clock, 12 fps, 3 s per pulse. The
// 3D map is paused meanwhile (only the bar is filmed) so each frame is quick.
await A.evaluate(() => import("/web/world3d.js").then(W => W.world3d.setPaused?.(true)));
const FPS = 12, step = 1000 / FPS, frames = [];
const frame = async () => { frames.push(await A.screenshot({ clip: await barClip(A), timeout: 120000 })); };
const at = ms => A.evaluate(ms => document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; }), ms);
for (let i = 0; i < 3 * FPS; i++) { await at(i * step); await frame(); }
const pulse = frames.slice(); frames.push(...pulse);                  // two loops
// the tap: hold the page's timers so the fill + sparkle can be stepped
// through before the host flow opens (the recording only; the app is as is)
await A.evaluate(() => { const st = window.setTimeout; window.__held = [];
  window.setTimeout = (f, ms, ...a) => { window.__held.push(() => f(...a)); return 0; };
  window.__release = () => { window.setTimeout = st; window.__held.splice(0).forEach(f => f()); }; });
await A.click("#nav-host");
const mid = await A.evaluate(() => ({ tap: document.getElementById("nav-host").classList.contains("tap"), sparks: document.querySelectorAll("#nav-host .nav-spark").length,
  fill: getComputedStyle(document.querySelector("#nav-host .nav-ring")).backgroundColor }));
ok(mid.tap && mid.fill === "rgb(255, 200, 61)", `tap: the ring fills gold (${mid.fill})`);
ok(mid.sparks === 8, `…with a sparkle burst (${mid.sparks} sparks)`);
for (let i = 0; i <= 9; i++) { await A.evaluate(ms => document.querySelectorAll("#nav-host .nav-spark").forEach(s => s.getAnimations().forEach(a => { a.pause(); a.currentTime = ms; })), i * 60); await frame(); if (i === 3) await A.screenshot({ path: join(OUT, "03-tap.png"), clip: await barClip(A), timeout: 120000 }); }
await A.evaluate(() => { document.getAnimations().forEach(a => a.play()); window.__release(); });
for (let i = 0; i < 12; i++) { await sleep(120); await frame(); }
let opened = false;
for (let i = 0; i < 20 && !opened; i++) { opened = await A.locator("#pt-create").isVisible(); if (!opened) await sleep(300); }
ok(opened, "…then the host flow opens");
await A.evaluate(() => import("/web/world3d.js").then(W => W.world3d.setPaused?.(false)));
await A.screenshot({ path: join(OUT, "04-host-flow.png"), timeout: 120000 });

// host a party, go back to the map: "My party"
await A.locator("#pt-name").fill("Tony's party");
await A.click("#pt-create"); await sleep(3000);
await A.click("#pt-hide"); await sleep(1500);
const mine = await A.evaluate(() => { const h = document.getElementById("nav-host"); return { hosting: h.classList.contains("hosting"), label: h.querySelector(".nav-lbl").textContent,
  fill: getComputedStyle(h.querySelector(".nav-ring")).backgroundColor }; });
ok(mine.hosting && mine.fill === "rgb(255, 200, 61)", "while hosting, the ring stays filled gold");
ok(mine.label === "My party", `…and the label reads "${mine.label}"`);
await A.screenshot({ path: join(OUT, "05-my-party.png"), clip: await barClip(A), timeout: 120000 });
await A.click("#nav-host");
let back = false;
for (let i = 0; i < 30 && !back; i++) { await sleep(500); back = await A.evaluate(() => !document.getElementById("party-panel").hidden && document.body.classList.contains("in-lobby")); }
ok(back, "tapping My party goes back to the room");
if (!back) console.log("    state:", await A.evaluate(() => JSON.stringify({ panel: document.getElementById("party-panel").hidden, lobby: document.body.className, host: document.getElementById("nav-host").className })));

// write the ring clip
const dir = join(OUT, "ring");
await mkdir(dir, { recursive: true });
for (let i = 0; i < frames.length; i++) await writeFile(join(dir, `f${String(i).padStart(4, "0")}.png`), frames[i]);
if (process.env.FFMPEG && frames.length) {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"),
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", join(OUT, "ring.mp4")]);
}
console.log(`  (${frames.length} frames of the ring at ${FPS} fps)`);
await ctx.close();

console.log("\nReduced motion");
const calm = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce" });
await calm.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
const B = await phone(calm);
await sleep(2500);
const still = await B.evaluate(() => ({ ring: getComputedStyle(document.querySelector("#nav-host .nav-ring")).animationName,
  lights: [...document.querySelectorAll("#nav-host .nav-ring i")].map(i => getComputedStyle(i).animationName) }));
ok(still.ring === "none" && still.lights.every(a => a === "none"), "no pulse and no blinking lights, just the static ring");
await B.click("#nav-host"); await sleep(60);
ok(await B.evaluate(() => document.querySelectorAll("#nav-host .nav-spark").length === 0), "a tap fills the ring without the sparkle");
await sleep(400);
ok(await B.locator("#pt-create").isVisible(), "…and still opens the host flow");
await calm.close();

await browser.close(); close();
console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
process.exit(fail ? 1 : 0);
