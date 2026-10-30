// Leaving a party, every way, on the REAL app page (Supabase faked offline):
// each must land straight on the explore map, on you, with nothing over it
// (no host menu, no start screen, no Home, no sheet, toast or error card),
// the bar back, the camera pulled out of the party's building and settled
// on your character / your spot.
//   1. Leave: the lobby's back button -> "Leave the party?" -> Leave
//   2. the host turns you away (past the party's cap: party.js _enforceCap)
//   3. the party ends after the last game: the set's podium (and the first
//      party's recap) -> the host ends the party -> every guest
//   4. the host closes it: the host's own phone, End the party on the podium
//   5. the phone's / browser's Back in the lobby (history popstate: Android
//      back, iOS swipe-back): the lobby's own back, "Leave the party?", then
//      the same landing; still on the page, the party's history entry gone
// The phone under test is the real app; the other players are light pages
// (test/hpparty.html), relayed between browser contexts like onboard_rec.
// The set's three games are filled in on the host (the podium is what's
// tested here, not the games: test/party_e2e.mjs plays whole sets).
//   node test/leave_rec.mjs <dir> [--only=1,2,3,4,5] [--video]
//   (--video: paths 1 and 3 filmed frame by frame, the transition's clock
//   stepped (this sandbox has no GPU): <dir>/leave-button/, <dir>/leave-party-ended/,
//   and .mp4s of them with FFMPEG=/path/to/ffmpeg)
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/leave_rec.mjs <dir> [--only=1,2,3,4,5] [--video]"); process.exit(2); }
const ONLY = args.find(a => a.startsWith("--only="))?.slice(7).split(",") ?? ["1", "2", "3", "4", "5"];
const VIDEO = args.includes("--video");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = (pg, fn, arg, ms = 30000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 150 }).then(() => true).catch(() => false);
const tap = (pg, sel) => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
const errors = [];
let fails = 0, passes = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (c) passes++; else fails++; };
const LOOKS = {
  jae: { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "chain-gold" },
  mina: { skin: "2", eyes: "sparkly", iris: "lightblue", hairColor: "darkbrown", hair: "bob", head: "none", face: "none", top: "varsity", bottom: "plaid-wide", shoes: "white-chunky", neck: "none" },
  sol: { skin: "1", eyes: "fox", iris: "green", hairColor: "red", hair: "twin-buns", head: "none", face: "none", top: "crop-flannel", bottom: "skirt-pleated", shoes: "platform", neck: "none" },
  tony: { skin: "3", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-hitop-black" },
};
const who = name => `&me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}`;
const appUrl = (name, q = "") => `${base}/app.html?devlat=37.5347&devlng=126.9945${who(name)}${q}`;
const lightUrl = (name, q = "") => `${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}${q}`;
const inLobby = async (pg, ms = 60000) => {
  const r = await until(pg, () => !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !document.querySelector("#onb .onb-screen:not(.out)"), null, ms);
  if (!r) {
    console.log("    (not in the lobby:", await pg.evaluate(() => JSON.stringify({ screen: document.querySelector(".onb-screen:not(.out)")?.dataset.screen, panel: document.querySelector(".st-panel")?.innerText.slice(0, 120), err: document.getElementById("pt-err")?.textContent })).catch(e => e.message), ")");
    await shot(pg, `fail-${pg.label}-${Date.now() % 100000}`).catch(() => {});
  }
  return r;
};

// ---- phones: their own storage each, realtime relayed between them
const contexts = [];
async function phoneContext() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: VIDEO ? 1 : 2, hasTouch: true, isMobile: true, locale: "en-US",
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("rando-lang", "en"); localStorage.setItem("rando-hint-v1", "1"); } catch {}
    Object.assign(globalThis, { __sceneryNoSlow: true });
    const post = BroadcastChannel.prototype.postMessage;
    BroadcastChannel.prototype.postMessage = function (d) {
      post.call(this, d);
      if (!this.__relayed && this.name.startsWith("sbstub:") && window.__relay) window.__relay(this.name, d);
    };
  });
  await ctx.exposeBinding("__relay", async ({ context }, name, d) => {
    for (const other of contexts) {
      if (other === context) continue;
      for (const pg of other.pages().filter(p => !p.isClosed()))
        pg.evaluate(([name, d]) => { const bc = new BroadcastChannel(name); bc.__relayed = true; bc.postMessage(d); setTimeout(() => bc.close(), 50); }, [name, d]).catch(() => {});
    }
  });
  contexts.push(ctx);
  return ctx;
}
async function page(ctx, url, label) {
  const pg = await ctx.newPage();
  pg.label = label;
  pg.on("pageerror", e => errors.push(`${label}: ${e.message}`));
  pg.on("dialog", d => d.accept());
  if (url) await pg.goto(url);
  return pg;
}
// (page.screenshot can wait forever on fonts in this sandbox: straight from CDP)
async function shot(pg, name) {
  const cdp = await pg.context().newCDPSession(pg);
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach().catch(() => {});
  await writeFile(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  console.log(`  shot ${name}`);
}

// a light host's party (test/hpparty.html): its code
async function lightHost(ctx, name) {
  const H = await page(ctx, lightUrl(name), name);
  await until(H, () => window.__ready === true);
  await H.evaluate(() => party.create());
  ok(await until(H, () => !!party.current?.meta.code), `${name} hosts a party`);
  return { H, code: await H.evaluate(() => party.current.meta.code) };
}
// the phone under test opens the app and joins with the code from the start
// screen (Join a party -> the code -> the dive -> the lobby)
async function joinFromStart(ctx, name, code) {
  const S = await page(ctx, appUrl(name), name);
  await until(S, () => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === "start" && !!document.querySelector(".st-panel [data-join]"), null, 90000);
  await sleep(1200);
  await tap(S, ".st-panel [data-join]");
  await until(S, () => !!document.querySelector("#st-code input"), null, 20000);
  await S.evaluate(code => { document.querySelector("#st-code input").value = code; document.querySelector("#st-code").requestSubmit(); }, code);
  ok(await inLobby(S, 120000), `${name}: the start screen, Join a party, the code, the dive, the lobby`);
  return S;
}

// the set's three games, filled in on the host: everyone gets the podium
async function finishSet(H) {
  await H.evaluate(async () => {
    const { addGame } = await import("/web/partyset.js");
    const c = party.current;
    const players = c.room.members.map((m, i) => ({ id: m.id, handle: m.handle, score: 30 - i * 7 }));
    for (const g of ["sidequest", "maskoff", "diary"]) c.set = addGame(c.set, g, { completed: true, players });
    party._sendMeta(); party.render();
  });
}
// Leave, frame by frame: the transition's clock (scenery.js __sceneryClock)
// is stepped 1/24 s per drawn frame, so the pull-out plays out the same on
// this sandbox's software WebGL as on a phone; the camera's height is kept
// each frame. With a name, every frame is shot too, and written as
// <dir>/<name>/ (and <dir>/<name>.mp4 with FFMPEG=...).
const FPS = VIDEO ? 12 : 24;          // (a film: 12 fps at 1x, so a loaded machine still gets through it)
async function stepLeave(pg, trigger, name = null, lead = 0) {
  await pg.evaluate(async () => {
    const { world3d } = await import("/web/world3d.js"), { scenery } = await import("/web/scenery.js"), { party } = await import("/web/party.js");
    window.__P = party; window.__S = scenery;
    const rec = window.__pull = { ys: [] };
    world3d.tickHooks.push(() => { if (rec.ys.length < 600 && scenery.pulling) rec.ys.push(Math.round(world3d.camera.position.y)); });
    window.__ft = 1000; globalThis.__sceneryClock = () => window.__ft;
  });
  const frames = [];
  const step = () => pg.evaluate(fps => new Promise(r => { window.__ft += 1 / fps; requestAnimationFrame(() => requestAnimationFrame(() => r(
    !window.__P.current && !window.__S.pulling && document.getElementById("party-panel").hidden && !document.getElementById("dive-veil")?.classList.contains("on")))); }), FPS);
  const grab = async () => { if (!name) return; const cdp = await pg.context().newCDPSession(pg); const r = await cdp.send("Page.captureScreenshot", { format: "png" }); await cdp.detach().catch(() => {}); frames.push(Buffer.from(r.data, "base64")); };
  for (let i = 0; i < lead; i++) { await step(); await grab(); }
  await trigger();
  let at = -1;
  for (let i = 0; i < 600; i++) {
    const out = await step();
    await grab();
    if (i && i % 40 === 0 && at < 0) console.log("    (step", i, await pg.evaluate(() => JSON.stringify({ party: !!window.__P.current, pulling: window.__S.pulling, panel: !document.getElementById("party-panel").hidden,
      veil: document.getElementById("dive-veil")?.classList.contains("on"), confirm: !!document.querySelector(".pt-confirm"), clock: window.__ft })), ")");
    if (out && at < 0) at = i;
    if (at >= 0 && i - at >= (name ? FPS * 1.2 : 2)) break;
  }
  await pg.evaluate(() => { delete globalThis.__sceneryClock; });
  if (!name) return;
  const dir = join(OUT, name);
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < frames.length; i++) await writeFile(join(dir, `f${String(i).padStart(4, "0")}.png`), frames[i]);
  if (process.env.FFMPEG) {
    execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(dir, "f%04d.png"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "20", join(OUT, `${name}.mp4`)]);
    console.log(`  film ${name}.mp4 (${frames.length} frames)`);
  } else console.log(`  film ${name}/ (${frames.length} frames)`);
}

// what's on screen once out of the party: the explore map, on you, nothing over it
async function landed(pg, tag) {
  await pg.evaluate(async () => { window.__P = (await import("/web/party.js")).party; window.__S = (await import("/web/scenery.js")).scenery; });
  await until(pg, () => !window.__P.current && !window.__S.pulling && !document.body.classList.contains("in-lobby") && document.getElementById("party-panel").hidden, null, 20000);
  await sleep(1500);         // (anything that would pop up after the landing has its moment)
  const r = await pg.evaluate(async () => {
    const { world3d, CHAR_H } = await import("/web/world3d.js"), { party } = await import("/web/party.js");
    const vis = el => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && +getComputedStyle(el).opacity > 0.05 && el.getClientRects().length > 0;
    const over = [...document.querySelectorAll(".onb-screen, .onb-sheet, .onb-perm, .onb-hint, .onb-toast, .glass-toast, .pt-confirm, #pp, #pt-create, #pt-err, .y-card-wrap, #party-card:not([hidden]) > *, #dive-veil.on")]
      .filter(vis).filter(el => !el.classList.contains("out")).map(el => el.id || el.className.split(" ").slice(0, 2).join("."));
    const home = world3d.followPos ?? world3d.homePos;
    let ndc = null;
    if (home) { const v = home.clone(); v.y += CHAR_H / 2; v.project(world3d.camera); ndc = [+v.x.toFixed(3), +v.y.toFixed(3)]; }
    const c = world3d.cam, d = world3d.CAM_DEFAULT;
    return {
      inParty: !!party.current, panel: !document.getElementById("party-panel").hidden, over,
      nav: vis(document.getElementById("navbar")) && !document.body.classList.contains("in-lobby"),
      scenery: document.body.classList.contains("scenery"), paused: !!world3d.paused, onb: document.body.classList.contains("onb-on"),
      host: document.querySelector("#nav-host .nav-lbl")?.textContent,
      on: !!home, who: world3d.followPos ? "character" : world3d.homePos ? "hidden spot" : "none",
      off: home ? +Math.hypot(world3d.target.x - home.x, world3d.target.z - home.z).toFixed(2) : null,
      cam: [+(c.theta - d.theta).toFixed(3), +(c.elev - d.elev).toFixed(3), +(c.dist - d.dist).toFixed(1)], fov: world3d.camera.fov,
      ndc, pull: window.__pull?.ys ?? [],
    };
  });
  ok(!r.inParty && !r.panel, `${tag}: out of the party, the party panel closed`);
  ok(!r.over.length, `${tag}: nothing over the map: no host menu, start screen, Home, sheet, toast or error (${r.over.join(", ") || "none"})`);
  ok(r.nav && !r.scenery && !r.onb && !r.paused, `${tag}: the explore map, drawing, with its bar (nav ${r.nav}, scenery ${r.scenery}, onboarding ${r.onb}, paused ${r.paused})`);
  ok(r.host === "Host", `${tag}: the bar's Host tab is back to "Host" (${r.host})`);
  ok(r.on && r.off < 2 && Math.abs(r.cam[0]) < 0.02 && Math.abs(r.cam[1]) < 0.02 && Math.abs(r.cam[2]) < 1 && r.fov === 50, `${tag}: the camera rests on you (${r.who}: ${r.off} away, θ/elev/dist off ${r.cam.join(" / ")}, fov ${r.fov})`);
  ok(r.ndc && Math.abs(r.ndc[0]) < 0.12 && Math.abs(r.ndc[1]) < 0.5, `${tag}: …in the middle of the screen (${JSON.stringify(r.ndc)})`);
  if (r.pull.length) {
    const top = Math.max(...r.pull), y0 = r.pull[0], y1 = r.pull[r.pull.length - 1];
    ok(r.pull.length > (VIDEO ? 6 : 10) && y0 < y1 - 40 && (VIDEO || top > y1 + 10), `${tag}: the camera pulled out of the building and settled on you (height ${r.pull.filter((_, i, a) => i % Math.ceil(a.length / 8) === 0 || i === a.length - 1).join(" → ")})`);
  } else if (process.env.LEAVE_NEED_PULL !== "0") ok(false, `${tag}: the camera pulled out of the building (no frames recorded)`);
  return r;
}

// ================================================================ 1. Leave
if (ONLY.includes("1")) {
  console.log("\n1. Leave: back -> Leave the party? -> Leave");
  const hctx = await phoneContext();
  const { H, code } = await lightHost(hctx, "jae");
  const sctx = await phoneContext();
  const S = await joinFromStart(sctx, "sol", code);
  ok(await until(H, () => party.current.room.members.length >= 2, null, 20000), "…the host sees sol arrive");
  await sleep(2500);
  await tap(S, "#pt-back");
  ok(await until(S, () => !!document.querySelector(".pt-confirm"), null, 20000), "back -> Leave the party?");
  await sleep(900);
  await shot(S, "leave-1-confirm");
  await stepLeave(S, () => tap(S, ".pt-confirm [data-yes]"), VIDEO ? "leave-button" : null, 8);
  await landed(S, "Leave");
  await shot(S, "leave-1-explore");
  ok(await until(H, () => party.current.room.members.length === 1, null, 15000), "the host sees sol go");
  await sctx.close(); await hctx.close();
  contexts.splice(0);
}

// ================================================================ 2. turned away by the host
if (ONLY.includes("2")) {
  console.log("\n2. The host turns you away (past the party's cap)");
  const hctx = await phoneContext();
  const { H, code } = await lightHost(hctx, "jae");
  const sctx = await phoneContext();
  const S = await joinFromStart(sctx, "mina", code);
  ok(await until(H, () => party.current.room.members.length >= 2, null, 20000), "…the host sees her");
  await sleep(2000);
  await stepLeave(S, () => H.evaluate(() => { party.current.meta.cap = 1; party._enforceCap(); }));
  await landed(S, "Turned away");
  await shot(S, "leave-2-removed-explore");
  await sctx.close(); await hctx.close();
  contexts.splice(0);
}

// ================================================================ 3. the party ends after the last game
if (ONLY.includes("3")) {
  console.log("\n3. After the last game: the podium, the recap, the host ends the party");
  const hctx = await phoneContext();
  const { H, code } = await lightHost(hctx, "jae");
  const fctx = await phoneContext();
  const F = await page(fctx, lightUrl("mina", `&party=${code}`), "mina");
  await until(F, () => !!window.party?.current);
  const sctx = await phoneContext();
  const S = await joinFromStart(sctx, "sol", code);
  ok(await until(H, () => party.current.room.members.length >= 3, null, 20000), "…with jae and mina");
  await sleep(2000);
  // (sol played the set: the first party's recap comes up a few seconds after the podium)
  await S.evaluate(async () => { const { party } = await import("/web/party.js"); party.current.played = [{ game: "sidequest", highlight: null, with: ["jae", "mina"] }, { game: "maskoff", highlight: null, with: ["jae", "mina"] }, { game: "diary", highlight: null, with: ["jae", "mina"] }]; });
  await finishSet(H);
  ok(await until(S, () => document.querySelectorAll("#pp .pp-step:not(.empty)").length === 3, null, 15000), "the set's podium on sol's phone");
  await sleep(1500);
  await shot(S, "leave-3-podium");
  ok(await until(S, () => !!document.querySelector('.onb-sheet[data-sheet="recap"]'), null, 15000), "…then the first party's recap");
  await sleep(1500);
  await shot(S, "leave-3-recap");
  await stepLeave(S, () => H.evaluate(() => document.getElementById("pp-end").click()), VIDEO ? "leave-party-ended" : null, 10);
  await landed(S, "Party ended (guest)");
  await shot(S, "leave-3-ended-explore");
  ok(await until(F, () => !window.party.current && document.getElementById("party-panel").hidden, null, 15000), "the other guest is out too, nothing left open (light page)");
  ok(await until(H, () => !window.party.current, null, 15000), "…and the host");
  await sctx.close(); await fctx.close(); await hctx.close();
  contexts.splice(0);
}

// ================================================================ 4. the host closes the party
if (ONLY.includes("4")) {
  console.log("\n4. The host closes the party: End the party on the podium");
  const sctx = await phoneContext();
  const S = await page(sctx, appUrl("tony"), "tony");
  ok(await until(S, () => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === "start" && !!document.querySelector(".st-panel [data-start]"), null, 90000), "tony opens the app: the start screen");
  await sleep(1500);
  await tap(S, ".st-panel [data-start]");
  ok(await inLobby(S, 120000), "Start a party -> the lobby");
  ok(await until(S, () => !!document.querySelector('.onb-sheet[data-sheet="invite"]'), null, 10000), "…the invite sheet");
  const code = await S.evaluate(async () => (await import("/web/party.js")).party.current.meta.code);
  await tap(S, '.onb-sheet[data-sheet="invite"] [data-close]');
  const gctx = await phoneContext();
  const G = await page(gctx, lightUrl("mina", `&party=${code}`), "mina");
  ok(await until(G, () => !!window.party?.current && window.party.current.room.members.length >= 2, null, 30000), "mina joins");
  await sleep(2000);
  await S.evaluate(async () => {
    const { party } = await import("/web/party.js"), { addGame } = await import("/web/partyset.js");
    const c = party.current, players = c.room.members.map((m, i) => ({ id: m.id, handle: m.handle, score: 30 - i * 7 }));
    for (const g of ["sidequest", "maskoff", "diary"]) c.set = addGame(c.set, g, { completed: true, players });
    party._sendMeta(); party.render();
  });
  ok(await until(S, () => !!document.getElementById("pp-end"), null, 15000), "the podium: End the party (the host's)");
  await sleep(1500);
  await shot(S, "leave-4-host-podium");
  await stepLeave(S, () => tap(S, "#pp-end"));
  await landed(S, "Host closed");
  await shot(S, "leave-4-closed-explore");
  const gOut = await until(G, () => !window.party.current && document.getElementById("party-panel").hidden, null, 15000);
  ok(gOut, "the guest is out too (light page)");
  if (!gOut) console.log("    (guest:", await G.evaluate(() => JSON.stringify({ in: !!party.current, host: party.current?.room.isHost, members: party.current?.room.members.length, panel: !document.getElementById("party-panel").hidden })), ")");
  await gctx.close(); await sctx.close();
  contexts.splice(0);
}

// ================================================================ 5. the phone's Back
if (ONLY.includes("5")) {
  console.log("\n5. The phone's / browser's Back in the lobby");
  const hctx = await phoneContext();
  const { H, code } = await lightHost(hctx, "jae");
  const sctx = await phoneContext();
  const S = await joinFromStart(sctx, "sol", code);
  ok(await until(H, () => party.current.room.members.length >= 2, null, 20000), "…the host sees sol arrive");
  await sleep(2000);
  const url0 = S.url();
  ok(await S.evaluate(() => !!history.state?.randoParty), "the party keeps a history entry of its own");
  await S.evaluate(() => history.back());
  ok(await until(S, () => !!document.querySelector(".pt-confirm"), null, 20000), "Back -> Leave the party? (the lobby's own back)");
  await sleep(900);
  await shot(S, "leave-5-back-confirm");
  ok(S.url() === url0 && await S.evaluate(() => !!document.querySelector("#party-panel:not([hidden]) #pt-floor") && !!history.state?.randoParty), "…still on the page, in the lobby, the entry back on (Stay is one tap)");
  await tap(S, ".pt-confirm [data-no]");
  await sleep(600);
  await S.evaluate(() => history.back());
  ok(await until(S, () => !!document.querySelector(".pt-confirm"), null, 20000), "Stay, then Back again -> asks again");
  await stepLeave(S, () => tap(S, ".pt-confirm [data-yes]"));
  await landed(S, "Back");
  ok(await until(S, () => !history.state?.randoParty, null, 20000) && S.url() === url0, "…the party's history entry gone, the same page");
  await shot(S, "leave-5-back-explore");
  await sctx.close(); await hctx.close();
  contexts.splice(0);
}

await browser.close(); close();
const real = errors.filter(e => !/ResizeObserver|AbortError|Failed to fetch|NetworkError|WebGL|esm\.sh/.test(e));
if (real.length) { console.log("\npage errors:"); for (const e of real.slice(0, 12)) console.log("  " + e); }
console.log(`\n${passes} passed, ${fails} failed · shots in ${OUT}`);
process.exit(fails ? 1 : 0);
