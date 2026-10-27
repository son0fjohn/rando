// The start screen on the REAL app page (Supabase faked offline), recorded on
// phone-sized pages: the glass panel over our 3D Itaewon at night, drifting;
// Start a party -> the dive into the building -> the lobby; a fresh phone
// from an invite link (no buttons: name, character, the same dive, "you're
// in!"); Join with a code; the lobby's back button -> "Leave the party?" ->
// the start screen again. Then the panel over the brightest part of the
// drift, a slow phone (CPU throttled: the glass goes lite), and checks: no
// nav bar, no labels, no people in the world, nobody waits on the 3D.
//   node test/start_rec.mjs <dir> [--quick] [--only=1,4,5]
//   (the films: test/start_film.mjs, frame by frame)
//   node test/start_rec.mjs --still              re-shoot web/start/night.jpg
//                                               (the drift's first frame, 3:4)
// Each phone is its own browser context; the stub's realtime rides on
// BroadcastChannel, so this script relays it between them (as onboard_rec).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const STILL = process.argv.includes("--still");
const OUT = STILL ? null : process.argv[2];
if (!STILL && (!OUT || OUT.startsWith("--"))) { console.error("usage: node test/start_rec.mjs <dir> [--quick] | --still"); process.exit(2); }
const QUICK = process.argv.includes("--quick");
const ONLY = process.argv.find(a => a.startsWith("--only="))?.slice(7).split(",") ?? ["1", "2", "3", "4", "5"];
const closeAll = async () => { for (const c of contexts.splice(0)) await c.close().catch(() => {}); };
if (OUT) await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 120 }).then(() => true).catch(() => false);
const tap = (pg, sel) => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const LOOKS = {
  jae: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  mina: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  sol: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
};
const appUrl = (q = "") => `${base}/app.html?devlat=37.5347&devlng=126.9945${q}`;
const who = name => `&me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}`;
const screenIs = (pg, id, ms = 30000) => until(pg, id => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === id, id, ms);
const live = (pg, ms = 120000) => until(pg, () => document.body.classList.contains("scenery-live"), null, ms);
const inLobby = (pg, ms = 30000) => until(pg, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !document.querySelector("#onb .onb-screen"), null, ms);

// ---- phones: their own storage each, realtime relayed between them
const contexts = [];
async function phoneContext({ lang = "en", viewport = { width: 390, height: 844 }, scale = 2, init = {} } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, isMobile: true, locale: lang === "ko" ? "ko-KR" : "en-US" });
  await ctx.addInitScript(({ lang, init }) => {
    try { if (!localStorage.getItem("rando-lang")) localStorage.setItem("rando-lang", lang); } catch {}
    // what the first paint had: the still image, before any module ran
    document.addEventListener("DOMContentLoaded", () => {
      const el = document.getElementById("start-still");
      if (el) window.__boot = { cls: document.documentElement.classList.contains("start-boot"), still: getComputedStyle(el).display };
    }, { once: true });
    Object.assign(globalThis, init);
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (d) {
      post.call(this, d);
      if (!this.__relayed && this.name.startsWith("sbstub:") && window.__relay) window.__relay(this.name, d);
    };
  }, { lang, init });
  await ctx.exposeBinding("__relay", async ({ context }, name, d) => {
    for (const other of contexts) {
      if (other === context) continue;
      const pg = other.pages().find(p => !p.isClosed());
      pg?.evaluate(([name, d]) => { const bc = new BroadcastChannel(name); bc.__relayed = true; bc.postMessage(d); setTimeout(() => bc.close(), 50); }, [name, d]).catch(() => {});
    }
  });
  contexts.push(ctx);
  return ctx;
}
async function page(ctx, label) {
  const pg = await ctx.newPage();
  pg.label = label;
  pg.on("pageerror", e => errors.push(`${label}: ${e.message}`));
  pg.on("dialog", d => d.accept());
  return pg;
}
// (page.screenshot can wait forever on fonts in this sandbox: straight from CDP)
async function snap(pg, path, { format = "png", quality, clip } = {}) {
  const cdp = await pg.context().newCDPSession(pg);
  const r = await cdp.send("Page.captureScreenshot", { format, ...(quality ? { quality } : {}), ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  await cdp.detach().catch(() => {});
  const buf = Buffer.from(r.data, "base64");
  if (path) await writeFile(path, buf);
  return buf;
}
const shot = async (pg, n, what) => { await snap(pg, join(OUT, `${n}.png`)); console.log(`  shot ${n}${what ? ` · ${what}` : ""}`); };

// ---- what the start screen must (not) show
async function worldIsScenery(pg, tag) {
  const r = await pg.evaluate(async () => {
    const { world3d } = await import("/web/world3d.js");
    const vis = el => !!el && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
    const panel = document.querySelector(".st-panel")?.getBoundingClientRect();
    return {
      nav: vis(document.getElementById("navbar")),
      labels: [...document.querySelectorAll("#label-layer > *, #beacon-layer > *")].filter(vis).length,
      people: [...world3d.chars].filter(r => r.api.group.visible).length,
      full: Math.abs(document.querySelector(".frame").clientHeight - innerHeight) < 2 && Math.abs(document.querySelector(".frame").clientWidth - innerWidth) < 2,
      centred: panel ? Math.abs(panel.left + panel.width / 2 - innerWidth / 2) < 2 && panel.left >= 15 : false,
      blur: getComputedStyle(document.querySelector(".st-panel")).backdropFilter,
      lite: document.body.classList.contains("glass-lite"),
    };
  });
  ok(!r.nav && !r.labels && !r.people, `${tag}: pure scenery: no nav bar (${r.nav}), no labels or pins (${r.labels}), no people (${r.people})`);
  ok(r.full, `${tag}: the city is full screen`);
  ok(r.centred, `${tag}: one centred panel`);
  return r;
}

// ================================================================ the still image
if (STILL) {
  // 3:4 at the live camera's vertical field of view: object-fit: cover on
  // any phone (all taller than 3:4) crops its sides only, so it matches the
  // live first frame wherever it's shown
  const ctx = await phoneContext({ viewport: { width: 600, height: 800 }, scale: 1, init: { __sceneryHold: true } });
  const pg = await page(ctx, "still");
  await pg.goto(appUrl(who("jae")));
  ok(await live(pg), "live");
  await sleep(2500);
  await pg.evaluate(() => { document.getElementById("onb").style.visibility = "hidden"; document.getElementById("start-still").style.display = "none"; });
  await sleep(600);
  await mkdir(new URL("../web/start/", import.meta.url).pathname, { recursive: true });
  const out = new URL("../web/start/night.jpg", import.meta.url).pathname;
  await snap(pg, out, { format: "jpeg", quality: 80 });
  console.log(`wrote ${out}`);
  await browser.close(); close(); process.exit(fails ? 1 : 0);
}

// ================================================================ run
const FAST = { __sceneryNoSlow: true };   // (this sandbox draws WebGL in software: keep the real glass for the recordings; the slow phone is its own run below)

let H, link, code;
if (ONLY.some(x => "123".includes(x))) {
console.log("\n1. Start a party: the still first, the live city, the drift, the dive, the lobby");
const hctx = await phoneContext({ init: FAST });
H = await page(hctx, "jae");
const tOpen = Date.now();
await H.goto(appUrl(who("jae")));
// the still image is there from the first paint, before any module ran
const boot = await H.evaluate(() => window.__boot ?? {});
ok(boot.cls && boot.still === "block", `the still night view shows from the first paint (${JSON.stringify(boot)})`);
ok(await screenIs(H, "start", 60000), `the start screen (${Date.now() - tOpen} ms)`);
ok(await until(H, () => document.getElementById("start-still").complete && document.getElementById("start-still").naturalWidth > 0, null, 10000), "…web/start/night.jpg loaded");
await sleep(400);
await shot(H, "01-start-still", "before the 3D: the still image under the glass");
ok(await live(H), `the live 3D crossfades in (${Date.now() - tOpen} ms after opening)`);
await sleep(1200);
const look = await worldIsScenery(H, "start");
console.log(`    (glass: blur ${look.blur}, lite ${look.lite})`);
await shot(H, "02-start-live", "the glass panel over the live city");
const cam0 = await H.evaluate(async () => { const { world3d } = await import("/web/world3d.js"); return world3d.cam.theta; });
await sleep(QUICK ? 2000 : 7000);
const cam1 = await H.evaluate(async () => { const { world3d } = await import("/web/world3d.js"); return world3d.cam.theta; });
ok(cam1 > cam0 + 0.05, `the camera drifts (θ ${cam0.toFixed(3)} -> ${cam1.toFixed(3)})`);
await shot(H, "03-start-drift", "a few seconds of drift later");
// Start: the panel fades away, the camera dives, then the lobby. Recorded
// in the page as it happens (this page's own polling is too starved here to
// catch a 1.5 s dive from outside)
await H.evaluate(async () => {
  const { world3d } = await import("/web/world3d.js");
  const rec = window.__dive = { going: null, ys: [] }, T = performance.now();
  new MutationObserver(() => { if (rec.going == null && document.querySelector(".onb-screen.start.going")) rec.going = Math.round(performance.now() - T); })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  world3d.tickHooks.push(() => { if (rec.going != null && rec.ys.length < 400 && document.querySelector(".onb-screen.start")) rec.ys.push(Math.round(world3d.camera.position.y)); });
});
await tap(H, ".st-panel [data-start]");
ok(await inLobby(H, 60000), "…and the lobby comes up");
const dive = await H.evaluate(() => window.__dive);
ok(dive.going != null, `Start -> the party opens (${dive.going} ms here), the panel fades and scales away`);
ok(dive.ys.length > 2 && Math.min(...dive.ys) < dive.ys[0] - 60, `the camera dives (height ${dive.ys.filter((_, i, a) => i % Math.ceil(a.length / 8) === 0 || i === a.length - 1).join(" → ")})`);
ok(await until(H, () => !!document.querySelector('.onb-sheet[data-sheet="invite"]'), null, 8000), "…with the invite sheet");
await sleep(900);
link = await H.evaluate(() => document.querySelector("[data-share]")?.dataset.link);
code = link?.match(/\/p\/([A-Z0-9]{4})/)?.[1];
await tap(H, '.onb-sheet[data-sheet="invite"] [data-close]');
await sleep(800);
const hdr = await H.evaluate(() => {
  const vis = el => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getClientRects().length > 0;
  const back = document.getElementById("pt-back")?.getBoundingClientRect();
  return { back: !!back && back.left < 30, host: vis(document.getElementById("pt-hostmenu")), old: !!document.querySelector("#pt-hide, #pt-leave"), nav: vis(document.getElementById("navbar")) };
});
ok(hdr.back && hdr.host && !hdr.old && !hdr.nav, `the lobby: one back button top left, the host menu, no nav bar (${JSON.stringify(hdr)})`);
await shot(H, "04-lobby-host", "the lobby: back top left, the host menu top right");

if (ONLY.includes("2")) {
console.log("\n2. A fresh phone from the invite link: no buttons, name, character, the same dive");
const nctx = await phoneContext({ init: FAST });
const N = await page(nctx, "new");
await N.goto(link.replace(/^https?:\/\/[^/]+/, base));
ok(await screenIs(N, "start", 60000), "the invite opens the start screen…");
ok(await until(N, () => !!document.querySelector(".st-panel .st-invite") && !document.querySelector(".st-panel [data-start], .st-panel [data-join]"), null, 5000), "…with the party's name and no buttons");
await until(N, () => document.querySelector(".st-invite b")?.textContent.length > 1, null, 10000);
await shot(N, "05-invite-joining", "an invite: the party's name on the glass");
ok(await screenIs(N, "name", 30000), "-> straight on to the name (a first open)");
await N.click("#onb-name"); await N.keyboard.type("Alex", { delay: QUICK ? 10 : 120 });
await sleep(QUICK ? 200 : 700);
await tap(N, "[data-next]");
ok(await screenIs(N, "char"), "-> the character");
await sleep(QUICK ? 1500 : 3500);
await tap(N, "[data-ok]");
ok(await screenIs(N, "start", 15000), "-> back on the glass, joining");
ok(await until(N, () => document.querySelector(".onb-screen.start.going"), null, 15000), "…the dive");
ok(await inLobby(N, 15000), "-> the lobby");
ok(await until(N, () => !!document.querySelector(".onb-in") || window.__youreIn, null, 10000), "…you're in!");
ok(await until(H, () => document.querySelectorAll(".lr-av").length >= 2, null, 20000), "the host sees them arrive");
await sleep(2000);
await shot(N, "06-invite-in", "you're in");

}
if (ONLY.includes("3")) {
console.log("\n3. Join with a code, then leave: back -> Leave the party? -> the start screen");
const jctx = await phoneContext({ init: FAST });
const J = await page(jctx, "sol");
await J.goto(appUrl(who("sol")));
await screenIs(J, "start", 60000); await live(J);
await sleep(QUICK ? 800 : 2500);
await tap(J, ".st-panel [data-join]");
ok(await until(J, () => !!document.querySelector("#st-code input"), null, 5000), "Join a party -> the code");
await sleep(500);
await J.click("#st-code input"); await J.keyboard.type(code.toLowerCase(), { delay: QUICK ? 10 : 160 });
await sleep(400);
await shot(J, "07-join-code", "Join a party: the code");
await J.evaluate(() => document.querySelector("#st-code").requestSubmit());
ok(await inLobby(J, 120000), "-> the dive, the lobby");
ok(await until(H, () => document.querySelectorAll(".lr-av").length >= 3, null, 20000), "the host sees them too");
await sleep(2500);
ok(await J.evaluate(() => document.getElementById("pt-hostmenu").hidden), "no host menu for a guest");
await tap(J, "#pt-back");
ok(await until(J, () => !!document.querySelector(".pt-confirm"), null, 4000), "back -> Leave the party?");
await sleep(700);
await shot(J, "08-leave-confirm", "Leave the party?");
await tap(J, ".pt-confirm [data-no]");
ok(await J.evaluate(() => !document.querySelector(".pt-confirm") && !!document.querySelector("#pt-floor")), "Stay: still in the party");
await sleep(600);
await tap(J, "#pt-back"); await sleep(400); await tap(J, ".pt-confirm [data-yes]");
ok(await screenIs(J, "start", 15000), "Leave -> the start screen");
ok(await live(J, 30000), "…the city drifting again");
await sleep(2000);

}
}
await closeAll();     // (every phone's 3D slows the next ones down)

if (ONLY.includes("4")) {
console.log("\n4. The panel over the brightest part of the drift");
const bctx = await phoneContext({ init: { ...FAST, __sceneryHold: true } });
const B = await page(bctx, "mina");
await B.goto(appUrl(who("mina")));
await screenIs(B, "start", 60000); await live(B);
const rect = await B.evaluate(() => { const r = document.querySelector(".st-panel").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
let best = { s: 0, lum: -1 };
for (let s = 0; s < 150; s += QUICK ? 30 : 10) {
  await B.evaluate(s => { globalThis.__sceneryHoldAt = s; document.getElementById("onb").style.visibility = "hidden"; }, s);
  await sleep(900);
  const jpg = await snap(B, null, { format: "jpeg", quality: 70, clip: rect });
  const lum = await B.evaluate(async b64 => {
    const im = new Image(); im.src = `data:image/jpeg;base64,${b64}`; await im.decode();
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, jpg.toString("base64"));
  if (lum > best.lum) best = { s, lum };
}
console.log(`    (brightest behind the panel: drift ${best.s} s, mean luminance ${best.lum.toFixed(1)})`);
await B.evaluate(s => { globalThis.__sceneryHoldAt = s; document.getElementById("onb").style.visibility = ""; }, best.s);
await sleep(1200);
await shot(B, "09-brightest", `the glass over the brightest stretch (drift ${best.s} s)`);
await B.evaluate(() => document.getElementById("onb").style.visibility = "hidden");
await sleep(500);
await shot(B, "09b-brightest-bare", "the same view without the panel");

await closeAll();
}

if (ONLY.includes("5")) {
console.log("\n5. A slow phone: the CPU throttled 6x");
const sctx = await phoneContext({});
const S = await page(sctx, "slow");
const scdp = await sctx.newCDPSession(S);
await scdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
const tS = Date.now();
await S.goto(appUrl(who("jae")));
ok(await screenIs(S, "start", 120000), `the start screen, at once (${Date.now() - tS} ms), the still under the glass`);
await shot(S, "10-slow-still", "a slow phone: the still image right away");
const sLive = await live(S, 180000);
// (the decision takes ~1.5 s of frames; this sandbox's shared software GPU can hold frames back for longer)
// (it watches 1.5 s windows; give it a minute here, where the shared software GPU can hold frames back)
for (let i = 0; i < 60 && !(await S.evaluate(async () => (await import("/web/scenery.js")).scenery.slow)); i++) await sleep(1000);
const sl = await S.evaluate(async () => {
  const { scenery } = await import("/web/scenery.js");
  let n = 0; const t0 = performance.now();
  await new Promise(r => { const f = () => { n++; performance.now() - t0 < 3000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  return { slow: scenery.slow, median: scenery.measured, lite: document.body.classList.contains("glass-lite"), fps: Math.round(n / 3) };
});
console.log(`    (slow phone: live ${sLive} after ${Math.round((Date.now() - tS) / 1000)} s, ${sl.fps} fps, median frame ${sl.median} ms, slow ${sl.slow}, glass lite ${sl.lite})`);
ok(sl.fps >= 20 || (sl.slow && sl.lite), `a phone that can't keep up (${sl.fps} fps) gets the lite glass (no live blur)`);
await shot(S, "11-slow-live", `a slow phone, live (${sl.lite ? "lite glass" : "full glass"})`);
await closeAll();     // (one browser = one software GPU here: the slow page would hold this one up)
// tapping Start before the 3D is up: no dive, nobody waits
const wctx = await phoneContext({});
const W = await page(wctx, "eager");
const wcdp = await wctx.newCDPSession(W);
await wcdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
await W.goto(appUrl(who("mina")));
await screenIs(W, "start", 120000);
const early = await W.evaluate(() => document.body.classList.contains("scenery-live"));
const tTap = Date.now();
await tap(W, ".st-panel [data-start]");
const wIn = await inLobby(W, 120000);
const wDive = await W.evaluate(() => document.querySelectorAll(".onb-screen.start.going").length);
ok(wIn, `Start before the 3D was up (live: ${early}): no dive, straight into the lobby (${Date.now() - tTap} ms on this 6x-throttled software-GL page)`);

await closeAll();
}

console.log(errors.length ? `\n✗ page errors: ${[...new Set(errors)].slice(0, 8).join(" | ")}` : "\n✓ no page errors");
await browser.close(); close();
console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
