// Screenshots of the REAL app page (web/index.html + backend.js + the 3D map)
// running offline (test/appserve.mjs maps Supabase and the CDN locally), for
// before/after design reviews: the map, going visible, tapping an NPC, the
// style screen, hosting a party, the party room with 4+ players, the TV.
//
//   node test/app_shots.mjs <dir> [--video]
//
// --video screencasts phone 1 through the whole flow (open app -> bottom bar
// -> host a party -> room fills up -> tap the TV) into <dir>/flow/, and with
// FFMPEG=/path/to/ffmpeg also writes <dir>/flow.mp4.
// Works on both the old side-button layout and the bottom bar, so the same
// script makes the "before" and the "after" set.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith("--"));
if (!OUT) { console.error("usage: node test/app_shots.mjs <dir> [--video]"); process.exit(2); }
const VIDEO = args.includes("--video");
await mkdir(OUT, { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const LOOKS = {
  tony: { skin: "3", hair: "m1", hairColor: "black", face: "f3", iris: "brown", top: "hoodie-maroon", bottom: "cargo-black", shoes: "sneaker-hitop-black" },
  mina: { skin: "2", hair: "f1", hairColor: "brown", face: "f1", iris: "blue", top: "tee-baggy-black", bottom: "skirt-pleated-black", shoes: "clog-pink" },
  jae: { skin: "4", hair: "m3", hairColor: "white", face: "f5", iris: "navy", top: "tee-white-graphic", bottom: "jeans-baggy-blue", shoes: "sneaker-white-stripe" },
  sol: { skin: "1", hair: "f2", hairColor: "red", face: "f2", iris: "green", top: "none", bottom: "track-navy", shoes: "boot-work-tan" },
  haru: { skin: "5", hair: "f3", hairColor: "yellow", face: "f6", iris: "blue", top: "tee-white-graphic", bottom: "shorts-green", shoes: "sneaker-white-lowtop" },
};
async function phone(name, qs = "") {
  const pg = await ctx.newPage();
  if (qs.includes("light")) {           // a guest that only needs the party: the lightweight test page
    pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
    await pg.goto(`${base}/test/hpparty.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}${qs}`);
    await pg.waitForFunction(() => window.__ready);
    return pg;
  }
  pg.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  await pg.goto(`${base}/app.html?me=${name}&av=${encodeURIComponent(JSON.stringify(LOOKS[name]))}&devlat=37.5347&devlng=126.9945${qs}`);
  await pg.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 30000 });
  return pg;
}
const shots = [];
async function shot(pg, name, note) {
  await pg.bringToFront(); await sleep(400);
  await pg.screenshot({ path: join(OUT, `${name}.png`), timeout: 120000 });
  shots.push(`${name}.png — ${note}`);
}
// click the first selector that exists and is visible
async function tap(pg, ...sels) {
  for (const s of sels) {
    const el = pg.locator(s).first();
    if (await el.count() && await el.isVisible()) { await el.click({ timeout: 120000 }); return s; } // software GL can stall the page for a while
  }
  throw new Error(`none of ${sels.join(", ")} is visible`);
}
async function screencast(pg) {
  const cdp = await pg.context().newCDPSession(pg), frames = [];
  cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
  return async dir => {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await mkdir(dir, { recursive: true });
    let list = "ffconcat version 1.0\n";
    for (let i = 0; i < frames.length; i++) {
      const n = `f${String(i).padStart(4, "0")}.jpg`;
      await writeFile(join(dir, n), Buffer.from(frames[i].data, "base64"));
      list += `file ${n}\nduration ${Math.max(0.016, (frames[i + 1]?.t ?? frames[i].t + 0.5) - frames[i].t).toFixed(3)}\n`;
    }
    await writeFile(join(dir, "frames.ffconcat"), list);
    if (process.env.FFMPEG) {
      const { execFileSync } = await import("node:child_process");
      execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-i", join(dir, "frames.ffconcat"), "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", `${dir}.mp4`]);
    }
    return frames.length;
  };
}

const A = await phone("tony");
const stop = VIDEO ? await screencast(A) : null;
await sleep(6000);                                   // the world streams in
await shot(A, "01-map", "the map on launch");
const bar = await A.locator("#navbar").count();
// a pull on the bar, as a finger would do it (touch pointer events)
const pullBar = pg => pg.evaluate(() => {
  const nb = document.getElementById("navbar"), r = nb.getBoundingClientRect();
  const ev = (t, y) => new PointerEvent(t, { bubbles: true, clientX: r.left + r.width / 2 - 70, clientY: y, pointerId: 9, pointerType: "touch" });
  nb.dispatchEvent(ev("pointerdown", r.top + 6));
  for (let i = 1; i <= 8; i++) window.dispatchEvent(ev("pointermove", r.top + 6 + i * 7));
  window.dispatchEvent(ev("pointerup", r.top + 62));
});

if (bar) {
  await tap(A, "#nav-explore"); await sleep(2500);
  await shot(A, "02-map-visible", "left button: you're visible on the map (the camera follows you)");
  await tap(A, "#nav-explore"); await sleep(1500);
  // explore: drag the map around, then "back to me"
  const box = await A.locator(".frame canvas").first().boundingBox();
  await A.mouse.move(box.x + 200, box.y + 400); await A.mouse.down();
  for (let i = 0; i < 12; i++) { await A.mouse.move(box.x + 200 - i * 12, box.y + 400 + i * 22); await sleep(30); }
  await A.mouse.up(); await sleep(800);
  await shot(A, "03-map-explore", "hidden + exploring: pan freely (within ~1.5 km), 'back to me' appears");
  await pullBar(A); await sleep(60);
  await A.screenshot({ path: join(OUT, "04-refresh.png"), timeout: 120000 });
  shots.push("04-refresh.png — pull the bar down: nearby parties and people reload (spinner)");
  await tap(A, "#nav-backtome"); await sleep(1500);
} else {
  await tap(A, "#open-toggle"); await sleep(2500);
  await shot(A, "02-map-visible", "after tapping the eye: you're visible on the map");
}

// NPC tap
await A.evaluate(async () => {
  const W = await import("/web/world3d.js");
  W.world3d.onArchNpcTap?.(W.ARCH_NPC_DEFS[0], true);
});
await sleep(2600);
await shot(A, "05-npc", "tapped an NPC");
await A.evaluate(() => { for (const s of ["#npc-dlg .y-dlg-wrap", "#npc-no", "#rooms-close"]) { const b = document.querySelector(s); if (b && b.offsetParent) b.click(); } document.querySelectorAll("#rooms-panel, #room-panel").forEach(e => { e.hidden = true; }); });
await sleep(500);

// style
await tap(A, "#nav-style", "#outfit-btn"); await sleep(3000);
await shot(A, "06-style", "the style screen");
if (await A.locator("#style-screen").count()) {
  await A.locator("#outfit-tabs button", { hasText: /^top$/i }).click().catch(() => {});
  await sleep(600);
  await A.locator("#outfit-grid button").nth(2).click().catch(() => {});
  await sleep(2500);
  await shot(A, "06b-style-top", "style: the Top slot, a new top on, the character updates");
}
await A.evaluate(() => { const x = document.querySelector("#style-close"); if (x) x.click(); else document.getElementById("outfit-sheet").hidden = true; });
await sleep(400);
await A.evaluate(() => document.querySelector('#ss-ask:not([hidden]) [data-ask="discard"]')?.click()); // tried a top on: leave without saving
await sleep(600);

// host a party
await tap(A, "#nav-host", "#party-btn"); await sleep(900);
if (await A.locator('[data-priv="public"]').count()) await A.click('[data-priv="public"]');
await A.locator("#pt-name").fill("Tony's party");
await shot(A, "07-host", "host a party: the create screen");
await tap(A, "#pt-create"); await sleep(4000);
await shot(A, "08-room", "the party room, just the host");
const code = (await A.locator("#pt-code-chip").textContent()).trim();
const guests = [];
for (const n of ["mina", "jae", "sol"]) {
  const g = await phone(n, `&party=${code}&light=1`);
  guests.push(g); await sleep(2500);
}
// everyone wanders off the door spot: a tap on the floor, in room pixels
const walkTo = (pg, x, y) => pg.evaluate(([x, y]) => {
  const st = document.querySelector(".lr-stage"), r = st.getBoundingClientRect(), s = r.width / (window.party?.current?.lobby.R.w ?? 704);
  st.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + x * s, clientY: r.top + y * s, pointerId: 1 }));
}, [x, y]);
await walkTo(guests[0], 250, 640); await walkTo(guests[1], 520, 760); await walkTo(guests[2], 380, 980);
await walkTo(A, 300, 820);
await A.bringToFront(); await sleep(6000);
await shot(A, "09-room-4", "the party room with 4 players (host: chat + Game votes)");
// players vote: one vote each, changeable until the host starts a game
if (await guests[0].locator("#pt-vote").count()) {
  await guests[0].bringToFront(); await guests[0].click("#pt-vote"); await sleep(1200);
  await shot(guests[0], "09b-player-vote", "a player: Vote next game opens the game list");
  await guests[0].locator("[data-vote]").nth(1).click(); await sleep(800);
  await shot(guests[0], "09c-player-voted", "a player: voted (tap another game to change it)");
  await guests[0].evaluate(() => document.getElementById("pt-picker-x")?.click());
  await sleep(600);
  await shot(guests[0], "09d-player-room", "a player's lobby: chat + Vote next game (✓ Voted)");
  for (const g of guests.slice(1)) {
    await g.click("#pt-vote"); await sleep(800);
    await g.locator("[data-vote]").nth(1).click(); await sleep(300);
    await g.evaluate(() => document.getElementById("pt-picker-x")?.click());
  }
  await A.bringToFront(); await sleep(1500);
}
await A.evaluate(() => document.querySelector(".lr-tv")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 })));
await sleep(4500);
await shot(A, "10-tv-picker", "the host: tapped the TV (same as Game votes): live counts, the leader marked, tap any game to start");
if (stop) console.log(`flow: ${await stop(join(OUT, "flow"))} frames`);
await A.evaluate(() => document.getElementById("pt-picker-x")?.click());
await sleep(500);
// back to the map: a public party is a neon house over its area
if (await A.locator("#pt-hide").count()) {
  await A.click("#pt-hide"); await sleep(3000);
  // bring the house to the middle of the screen (it's in your zone, not on you)
  const at = await A.evaluate(() => { const b = document.querySelector(".pbeacon"); if (!b) return null; const m = b.style.transform.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/); return m ? [+m[1], +m[2]] : null; });
  if (at) {
    const fb = await A.locator(".frame canvas").first().boundingBox();
    const dx = fb.width / 2 - at[0], dy = fb.height * 0.42 - at[1];
    await A.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await A.mouse.down();
    for (let i = 1; i <= 12; i++) { await A.mouse.move(fb.x + fb.width / 2 + dx * i / 12, fb.y + fb.height / 2 + dy * i / 12); await sleep(30); }
    await A.mouse.up(); await sleep(1500);
  }
  await shot(A, "11-beacon", "back on the map: the public party floats over its area (zone-snapped)");
  await A.evaluate(() => document.querySelector(".pbeacon")?.click());
  await sleep(1200);
  await shot(A, "12-party-card", "tap the house: the party card");
}

await writeFile(join(OUT, "SHOTS.md"), shots.map(s => `- ${s}`).join("\n") + "\n");
console.log(shots.join("\n"));
if (errors.length) { console.log("page errors:\n" + errors.join("\n")); }
await browser.close(); close();
process.exit(errors.length ? 1 : 0);
