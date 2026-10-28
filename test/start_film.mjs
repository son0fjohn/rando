// Films of the start screen, frame by frame, for machines without a GPU
// (this sandbox puts a WebGL frame on screen every few seconds, so a live
// screen recording of the drift and the dive is a slideshow). Each frame:
// the test steps the scenery's clock (scenery.js __sceneryClock) by 1/30 s,
// draws the city once and reads it straight out of WebGL; the page's own
// UI (the glass panel, the corners, the spinner…) is captured from the real
// page with a transparent background; a canvas page puts them together the
// way the browser does: the city, the glass's blur(26px) saturate(150%)
// under each glass shape, the UI on top, the panel fading and scaling away
// as in theme.css, the navy veil, then the real lobby. DOM-only screens
// (name, character, the lobby) are real screenshots.
//   node test/start_film.mjs <dir> [start|invite]     (FFMPEG=... for the mp4s)
//     start   a returning player: the still, the live city drifting, Start
//             a party, the dive, the lobby and its invite sheet
//     invite  a fresh phone from that party's invite link: the party's name
//             on the glass, name, character, the same dive, "you're in!"
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/start_film.mjs <dir> [start|invite]"); process.exit(2); }
const ONLY = process.argv[3] ?? "start,invite";
await mkdir(OUT, { recursive: true });
const FPS = 30, W = 390, H = 844, DSF = 2;
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOOKS = {
  jae: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
};
const appUrl = q => `${base}/app.html?devlat=37.5347&devlng=126.9945${q}`;

// ---- phones, realtime relayed between them (as onboard_rec)
const contexts = [];
async function phone(label) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, hasTouch: true, isMobile: true, locale: "en-US" });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("rando-lang", "en"); } catch {}
    globalThis.__sceneryNoSlow = true;
    window.__vt = 0; globalThis.__sceneryClock = () => window.__vt;
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (d) {
      post.call(this, d);
      if (!this.__relayed && this.name.startsWith("sbstub:") && window.__relay) window.__relay(this.name, d);
    };
  });
  await ctx.exposeBinding("__relay", async ({ context }, name, d) => {
    for (const other of contexts) {
      if (other === context) continue;
      const pg = other.pages().find(p => !p.isClosed());
      pg?.evaluate(([name, d]) => { const bc = new BroadcastChannel(name); bc.__relayed = true; bc.postMessage(d); setTimeout(() => bc.close(), 50); }, [name, d]).catch(() => {});
    }
  });
  contexts.push(ctx);
  const pg = await ctx.newPage();
  pg.on("pageerror", e => console.log(`  (${label} page error: ${e.message})`));
  pg.cdp = await ctx.newCDPSession(pg);
  return pg;
}
const until = (pg, fn, arg, ms = 60000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true).catch(() => false);

// ---- the compositor: a plain page with one canvas
const comp = await (await browser.newContext({ viewport: { width: 200, height: 200 } })).newPage();
await comp.setContent(`<canvas id="c" width="${W * DSF}" height="${H * DSF}"></canvas>`);
await comp.evaluate(({ W, H, DSF }) => {
  const c = document.getElementById("c"), g = c.getContext("2d");
  const imgs = new Map();
  const load = async (id, url) => { if (imgs.has(id)) return imgs.get(id); const im = new Image(); im.src = url; await im.decode(); imgs.set(id, im); return im; };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); };
  // one frame: f = { bg, still, stillK, rest, restK, panel, panelK, panelBox, glass[], opaque, veil }
  window.frame = async f => {
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.filter = "none";
    g.fillStyle = "#0b0d24"; g.fillRect(0, 0, c.width, c.height);
    const S = DSF;
    // the city (or the still, object-fit: cover), pixelated
    const city = document.createElement("canvas"); city.width = c.width; city.height = c.height;
    const cg = city.getContext("2d"); cg.imageSmoothingEnabled = false;
    if (f.bg) cg.drawImage(await load(f.bg, f.bgUrl), 0, 0, c.width, c.height);
    if (f.still && f.stillK > 0) {
      const im = await load("still", f.still), k = c.height / im.height, w = im.width * k;
      cg.globalAlpha = f.stillK; cg.drawImage(im, (c.width - w) / 2, 0, w, c.height); cg.globalAlpha = 1;
    }
    g.drawImage(city, 0, 0);
    if (f.opaque) { g.drawImage(await load(f.opaque, f.opaqueUrl), 0, 0, c.width, c.height); }
    else {
      // the glass shapes: the city behind them blurred and saturated, then the UI on top
      const blurred = document.createElement("canvas"); blurred.width = c.width; blurred.height = c.height;
      const bg = blurred.getContext("2d"); bg.filter = `blur(${26 * S}px) saturate(150%)`; bg.drawImage(city, 0, 0);
      const pb = f.panelBox, sc = 1 - 0.14 * (f.panelScaleK ?? 0);
      for (const r of f.glass ?? []) {
        g.save();
        let a = r.inPanel ? 1 - (f.panelK ?? 0) : f.restK ?? 1;
        if (r.inPanel && pb) { const cx = (pb.x + pb.w / 2) * S, cy = (pb.y + pb.h / 2) * S; g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy); }
        g.globalAlpha = a;
        rr(r.x * S, r.y * S, r.w * S, r.h * S, r.r * S); g.clip(); g.drawImage(blurred, 0, 0);
        g.restore();
      }
      if (f.rest) { g.globalAlpha = f.restK ?? 1; g.drawImage(await load(f.rest, f.restUrl), 0, 0, c.width, c.height); g.globalAlpha = 1; }
      if (f.panel && (f.panelK ?? 0) < 1) {
        g.save();
        if (pb) { const cx = (pb.x + pb.w / 2) * S, cy = (pb.y + pb.h / 2) * S; g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy); }
        g.globalAlpha = 1 - (f.panelK ?? 0);
        g.drawImage(await load(f.panel, f.panelUrl), 0, 0, c.width, c.height);
        g.restore();
      }
    }
    if (f.veil > 0) { g.globalAlpha = f.veil; g.fillStyle = "#0F1A3A"; g.fillRect(0, 0, c.width, c.height); }
    g.restore();
    return c.toDataURL("image/jpeg", 0.88);
  };
  window.forget = id => imgs.delete(id);
}, { W, H, DSF });

// ---- the phone's side
const CAPTURE_CSS = `
  html, body, .frame { background: transparent !important; }
  .frame canvas, #start-still, .frame::after, #dive-veil { visibility: hidden !important; }
  .glass, .glass-icon, .st-corner .onb-lang { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
  .onb-screen.start .st-panel, .onb-screen.start.going .st-panel { transform: none !important; opacity: 1 !important; transition: none !important; animation: none !important; }
  .onb-screen.start .st-corner, .onb-screen.start .st-credit { opacity: 1 !important; transition: none !important; }`;
async function shotB64(pg, transparent) {
  if (transparent) await pg.cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  // (a full screen over the map: the city canvas under it and the veil, which the film draws itself, out of the shot)
  else await pg.evaluate(() => { const st = document.createElement("style"); st.id = "__shot"; st.textContent = ".frame canvas, #dive-veil { visibility: hidden !important; }"; document.head.appendChild(st); });
  const r = await pg.cdp.send("Page.captureScreenshot", { format: "png" });
  if (transparent) await pg.cdp.send("Emulation.setDefaultBackgroundColorOverride", {});
  else await pg.evaluate(() => document.getElementById("__shot")?.remove());
  return `data:image/png;base64,${r.data}`;
}
// the start screen's UI in two layers (the panel / everything else), with
// the glass shapes and where the panel is
async function captureUi(pg) {
  const meta = await pg.evaluate(css => {
    let st = document.getElementById("__film"); if (!st) { st = document.createElement("style"); st.id = "__film"; document.head.appendChild(st); }
    st.textContent = css;
    const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    const p = document.querySelector(".onb-screen.start .st-panel");
    return {
      panelBox: p ? box(p) : null,
      glass: [...document.querySelectorAll(".onb-screen.start .glass, .onb-screen.start .glass-icon, .onb-screen.start .st-corner .onb-lang")]
        .map(el => ({ ...box(el), r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, inPanel: !!el.closest(".st-panel") })),
    };
  }, CAPTURE_CSS);
  const extra = which => pg.evaluate(([css, which]) => { document.getElementById("__film").textContent = css + (which === "panel"
    ? `.onb-screen.start > :not(.st-panel) { visibility: hidden !important; } .onb-screen.start { background: none !important; }`
    : which === "rest" ? `.onb-screen.start .st-panel { visibility: hidden !important; }` : ""); }, [CAPTURE_CSS, which]);
  await extra("panel"); const panel = await shotB64(pg, true);
  await extra("rest"); const rest = await shotB64(pg, true);
  await pg.evaluate(() => document.getElementById("__film")?.remove());
  return { ...meta, panel, rest };
}
// one draw of the city at the current clock, read straight back
async function city(pg, vt) {
  return pg.evaluate(async vt => {
    window.__vt = vt;
    const { world3d } = await import("/web/world3d.js");
    world3d.paused = false; world3d.needsRender = true; world3d._lastDraw = 0;
    world3d.tick();
    world3d.paused = true;
    return world3d.renderer.domElement.toDataURL("image/png");
  }, vt);
}
const state = pg => pg.evaluate(() => ({
  screen: document.querySelector("#onb .onb-screen:not(.out)")?.dataset.screen ?? null,
  setup: !!document.querySelector(".st-panel [data-setup]"),
  panelSig: (() => { const p = document.querySelector(".onb-screen.start .st-panel"); return p ? `${p.dataset.view}|${p.textContent.trim().slice(0, 80)}` : ""; })(),
  going: !!document.querySelector(".onb-screen.start.going"),
  veil: !!document.querySelector("#dive-veil.on"),
  lobby: !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !document.querySelector("#onb .onb-screen"),
  live: document.body.classList.contains("scenery-live"),
}));

// ---- the film: frames written as they're made
const ease = k => k <= 0 ? 0 : k >= 1 ? 1 : (() => { // CSS "ease"
  let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, x = 3 * .25 * m * (1 - m) ** 2 + 3 * 1 * m * m * (1 - m) + m ** 3; x < k ? lo = m : hi = m; }
  const t = (lo + hi) / 2; return 3 * .1 * t * (1 - t) ** 2 + 3 * 1 * t * t * (1 - t) + t ** 3; })();
function film(name) {
  let n = 0, uiN = 0;
  const dir = join(OUT, name);
  return {
    dir,
    async frame(f) {
      for (const k of ["bg", "rest", "panel", "opaque"]) if (f[`${k}Url`] && !f[k]) f[k] = `${k}${uiN++}`;
      const url = await comp.evaluate(f => window.frame(f), f);
      await writeFile(join(dir, `f${String(n++).padStart(5, "0")}.jpg`), Buffer.from(url.split(",")[1], "base64"));
      if (f.bg) await comp.evaluate(id => window.forget(id), f.bg);
    },
    get frames() { return n; },
    async mp4() {
      if (!process.env.FFMPEG) return;
      execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%05d.jpg"), "-vf", `scale=${W}:${H}:flags=lanczos`, "-pix_fmt", "yuv420p", "-crf", "20", join(OUT, `${name}.mp4`)]);
      console.log(`  wrote ${name}.mp4 (${(n / FPS).toFixed(1)} s, ${n} frames)`);
    },
  };
}

// steps the start screen: the city on the clock, the UI re-captured when it
// changes, the panel's fade and the veil timed off the clock, until done()
async function stepStart(pg, F, { vt, from = null, frames = Infinity, done = null, onFrame = null, still = null, stillFor = 0 }) {
  let ui = null, sig = "", goingAt = null, veilOn = null, veilOff = null, lobbyUrl = null, i = 0;
  const stillUrl = still;
  for (; i < frames; i++) {
    const s = await state(pg);
    if (s.screen === "start" && s.panelSig !== sig && !s.going) { ui = await captureUi(pg); sig = s.panelSig; }
    if (s.going && goingAt == null) goingAt = vt;
    if (s.veil && veilOn == null) veilOn = vt;
    if (!s.veil && veilOn != null && veilOff == null) veilOff = vt;
    if (s.lobby && !lobbyUrl) lobbyUrl = await shotB64(pg, false);
    const f = { veil: 0 };
    if (!s.lobby || veilOff == null) {
      f.bgUrl = await city(pg, vt);
      if (stillUrl && vt - from < stillFor + 0.8) { f.still = stillUrl; f.stillK = vt - from < stillFor ? 1 : 1 - ease((vt - from - stillFor) / 0.8); }
      if (ui && s.screen === "start") Object.assign(f, {
        restUrl: ui.rest, rest: `rest:${sig}`, panelUrl: ui.panel, panel: `panel:${sig}`, panelBox: ui.panelBox, glass: ui.glass,
        panelK: goingAt == null ? 0 : ease((vt - goingAt) / 0.45),
        panelScaleK: goingAt == null ? 0 : (k => 1 - (1 - k) ** 3)(Math.min(1, (vt - goingAt) / 0.5)),
        restK: goingAt == null ? 1 : 1 - ease((vt - goingAt) / 0.3),
      });
    }
    if (lobbyUrl && (veilOff != null || !s.screen)) { f.opaqueUrl = lobbyUrl; f.opaque = `lobby:${lobbyUrl.length}`; delete f.bgUrl; f.glass = []; }
    if (veilOn != null) f.veil = veilOff == null ? ease((vt - veilOn) / 0.35) : 1 - ease((vt - veilOff) / 0.35);
    await F.frame(f);
    await onFrame?.(i, vt, s);
    vt += 1 / FPS;
    if (done && await done(s, vt, { veilOff })) break;
  }
  return { vt, lobbyUrl };
}
async function hold(F, url, secs, id) { for (let k = 0; k < secs * FPS; k++) await F.frame({ opaqueUrl: url, opaque: id, veil: 0 }); }

// ================================================================ run
const still = `data:image/jpeg;base64,${(await (await fetch(`${base}/web/start/night.jpg`)).arrayBuffer().then(b => Buffer.from(b))).toString("base64")}`;
let link = null;

{
  console.log("start: a returning player opens the app, drifts, Start a party, dives");
  const F = film("film-start"); await mkdir(F.dir, { recursive: true });
  const P = await phone("jae");
  await P.goto(appUrl(`&me=jae&av=${encodeURIComponent(JSON.stringify(LOOKS.jae))}`));
  await until(P, () => document.body.classList.contains("scenery-live"), null, 180000);
  await P.evaluate(async () => { (await import("/web/world3d.js")).world3d.setPaused(true); });
  await sleep(800);
  const T0 = Date.now();
  // 0.8 s on the still, crossfade, ~5 s of drift, Start, the dive, the lobby
  let tapped = false;
  const r = await stepStart(P, F, {
    vt: 0, from: 0, still, stillFor: 0.8,
    onFrame: async (i, vt) => { if (!tapped && vt >= 6.2) { tapped = true; await P.evaluate(() => document.querySelector(".st-panel [data-start]").click()); } },
    done: async (s, vt, { veilOff }) => veilOff != null && vt - veilOff > 0.4,
  });
  console.log(`  ${F.frames} frames in ${Math.round((Date.now() - T0) / 1000)} s`);
  // the lobby, then its invite sheet
  await until(P, () => !!document.querySelector('.onb-sheet[data-sheet="invite"]'), null, 20000);
  await sleep(900);
  link = await P.evaluate(() => document.querySelector("[data-share]")?.dataset.link);
  await hold(F, await shotB64(P, false), 2.2, "sheet");
  await F.mp4();
  if (!ONLY.includes("invite")) process.exit(0);
}

if (ONLY.includes("invite") && link) {
  console.log("invite: a fresh phone from the invite link");
  const F = film("film-invite"); await mkdir(F.dir, { recursive: true });
  const N = await phone("new");
  await N.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await until(N, () => document.body.classList.contains("scenery-live") && !!document.querySelector(".st-invite"), null, 180000);
  await N.evaluate(async () => { (await import("/web/world3d.js")).world3d.setPaused(true); });
  // the party's name on the glass, drifting, until the setup card takes the panel over
  let r = await stepStart(N, F, { vt: 0, from: 0, still, stillFor: 0.5, done: async s => s.setup });
  // the setup card (a name and the character on the same glass): real screenshots, typed a letter at a time
  await until(N, () => !!document.querySelector("#su-stage canvas"), null, 30000);
  await sleep(1200);
  await hold(F, await shotB64(N, false), 0.8, "card0");
  await N.evaluate(() => { const i = document.querySelector("#su-name"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); });
  for (const [k, ch] of [..."Alex"].entries()) { await N.keyboard.type(ch); await sleep(120); await hold(F, await shotB64(N, false), 0.22, `name${k + 1}`); }
  await N.evaluate(() => document.querySelector("[data-random]").click());
  await sleep(1800);
  await hold(F, await shotB64(N, false), 1.2, "card1");
  await N.evaluate(() => document.querySelector("[data-go]").click());
  await until(N, () => !document.querySelector(".st-panel [data-setup]"), null, 20000);
  await N.evaluate(async () => { (await import("/web/world3d.js")).world3d.setPaused(true); });
  // back on the glass, joining: the dive, the lobby, you're in
  r = await stepStart(N, F, { vt: r.vt, done: async (s, vt, { veilOff }) => veilOff != null && vt - veilOff > 0.4 });
  await sleep(300);
  for (let k = 0; k < 8; k++) { await hold(F, await shotB64(N, false), 0.25, `in${k}`); }
  await F.mp4();
}
await browser.close(); close();
