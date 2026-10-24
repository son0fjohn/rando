// The Style screen on the REAL app page, offline (test/appserve.mjs), on a
// phone: open it, try things on in every tab (a sparkle and a reaction on
// each), try on a shop item (it shows a Buy bar and Save waits), buy it,
// preview the walk, randomize, save, leave with unsaved changes (asks).
// Checks as it goes; screenshots + a screen recording.
//
//   node test/style_rec.mjs <dir>        (FFMPEG=/path/to/ffmpeg for style.mp4)
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { serve } from "./appserve.mjs";

const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/style_rec.mjs <dir>"); process.exit(2); }
await mkdir(join(OUT, "frames"), { recursive: true });
const { base, close } = await serve();
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem("rando-hint-v1", "1"); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };
const errors = [];
const LOOK = { skin: "2", eyes: "sharp", iris: "brown", hair: "middle-part", hairColor: "black", top: "tee-white", bottom: "cargo-chain", shoes: "skate-blue" };
const A = await ctx.newPage();
A.on("pageerror", e => errors.push(e.message));
await A.goto(`${base}/app.html?me=tony&coins=200&av=${encodeURIComponent(JSON.stringify(LOOK))}&devlat=37.5347&devlng=126.9945`);
await A.waitForFunction(() => !document.getElementById("auth-status")?.hidden, null, { timeout: 40000 });
await sleep(3000);

// record the screen from here
const cdp = await ctx.newCDPSession(A), frames = [];
cdp.on("Page.screencastFrame", f => { frames.push({ t: f.metadata.timestamp, data: f.data }); cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}); });
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
const shot = async name => { await A.screenshot({ path: join(OUT, `${name}.png`), timeout: 120000 }); };
const state = () => A.evaluate(() => ({
  tab: document.querySelector("#outfit-tabs .active span")?.textContent,
  save: document.getElementById("style-save").textContent, saveOn: !document.getElementById("style-save").disabled,
  buy: !document.getElementById("ss-buy").hidden, coins: document.getElementById("style-coins").textContent.replace(/\D/g, ""),
  canvas: !!document.querySelector("#style-view canvas"),
}));

// host a party first, so we can check the room sees the new look live
await A.click("#nav-host"); await sleep(900);
await A.locator("#pt-name").fill("Tony's party").catch(() => {});
await A.click("#pt-create").catch(() => {}); await sleep(3000);
await A.click("#pt-hide").catch(() => {}); await sleep(1200);

await A.click("#nav-style");
await A.waitForFunction(() => !!document.querySelector("#style-view canvas"), null, { timeout: 60000 }).catch(() => {});
await sleep(2500);
let s = await state();
ok(s.canvas, "the character is on the stage in 3D");
ok(s.tab === "Eyes" && s.save === "Saved" && !s.saveOn, `opens on Eyes, nothing to save ("${s.save}")`);
const tabs = await A.locator("#outfit-tabs button").evaluateAll(bs => bs.map(b => b.textContent.trim()));
ok(tabs.join(",") === "Eyes,Hair,Head,Face,Top,Bottom,Shoes,Neck/back,Shop", `icon tabs, in order: ${tabs.join(" · ")}`);
ok(await A.evaluate(() => getComputedStyle(document.querySelector("#outfit-tabs .active")).color.replace(/\s/g, "")) === "rgb(255,200,61)", "the active tab is gold (#FFC83D)");
await shot("01-open");

// hair: a style, then a color swatch
await A.locator("#outfit-tabs button", { hasText: /^Hair$/ }).click(); await sleep(2500);
await A.locator('#outfit-grid [data-slot="hair"][data-value="bob"]').click(); await sleep(1500);
await A.locator('#outfit-grid [data-slot="hairColor"][data-value="blonde"]').click(); await sleep(1600);
s = await state();
ok(s.save === "Save" && s.saveOn, "trying on a new hair makes Save ready");
const sparks = await A.locator("#style-view .ss-sparks i").count();
await shot("02-hair");
ok(await A.locator('#outfit-grid [data-slot="hairColor"][data-value="blonde"].selected').count() === 1, "the blonde swatch is selected");

// eyes
await A.locator("#outfit-tabs button", { hasText: /^Eyes$/ }).click(); await sleep(500);
await A.locator('#outfit-grid [data-slot="eyes"][data-value="cat"]').click(); await sleep(400);
await A.locator('#outfit-grid [data-slot="iris"][data-value="green"]').click(); await sleep(1400);
await shot("03-eyes");

// top: the denim jacket is a shop item -> try it on, a Buy bar shows, Save waits
await A.locator("#outfit-tabs button", { hasText: /^Top$/ }).click(); await sleep(2500);
await A.locator('#outfit-grid [data-slot="top"][data-value="denim-jacket"]').click(); await sleep(2200);
s = await state();
ok(s.buy && s.save === "Unlock to save" && !s.saveOn, `a locked item is tried on; Save waits ("${s.save}")`);
await shot("04-try-locked");
await A.locator("#ss-buy [data-ss-buy]").click(); await sleep(2500);
s = await state();
ok(!s.buy && +s.coins === 50, `bought it: 200 → ${s.coins} coins (denim jacket 150), Buy bar gone`);
ok(s.save === "Saved ✓" || s.save === "Saved", `buying saves the look ("${s.save}")`);

// bottoms + shoes strips (3D thumbnails)
// (they render one at a time, after the tabs opened before: up to 10 s on swiftshader)
await A.locator("#outfit-tabs button", { hasText: /^Bottom$/ }).click();
for (let i = 0; i < 40 && await A.locator("#outfit-grid .opt-tile.thumb3d").count() < 5; i++) await sleep(250);
const thumbs = await A.locator("#outfit-grid .opt-tile.thumb3d").count();
ok(thumbs >= 5, `bottoms show 3D thumbnails (${thumbs})`);
await A.locator('#outfit-grid [data-slot="bottom"][data-value="wide-jeans"]').click(); await sleep(1500);
await shot("05-bottom");
await A.locator("#outfit-tabs button", { hasText: /^Shoes$/ }).click(); await sleep(3000);
await A.locator('#outfit-grid [data-slot="shoes"][data-value="combat"]').click(); await sleep(1500);
await shot("06-shoes");
await A.locator("#outfit-tabs button", { hasText: /^Head$/ }).click(); await sleep(3000);
await A.locator('#outfit-grid [data-slot="head"][data-value="bucket"]').click(); await sleep(1500);
ok(await A.locator('#outfit-grid [data-slot="head"]').count() >= 10, "Head has the headwear (10 + none)");
await shot("06b-head");
await A.locator("#outfit-tabs button", { hasText: /^Neck\/back$/ }).click(); await sleep(3000);
await A.locator('#outfit-grid .opt-tile[data-slot="neck"][data-value="chain-silver"]').click(); await sleep(1500);
ok(await A.locator('#outfit-grid .ss-variants [data-value="chain-gold"]').count() === 1, "tintable items show colour swatches under them (silver / gold chain)");
await shot("06c-neck");

// walk preview
await A.locator('#style-view [data-preview="walk"]').click(); await sleep(1800);
await shot("07-walk");
await A.locator('#style-view [data-preview="idle"]').click(); await sleep(800);

// randomize, then save
await A.locator("#style-random").click(); await sleep(2000);
await shot("08-random");
s = await state();
if (s.saveOn) { await A.locator("#style-save").click(); await sleep(1500); }
s = await state();
ok(!s.saveOn && /Saved/.test(s.save), `Save keeps the look ("${s.save}")`);
const saved = await A.evaluate(async () => { const B = await import("/web/backend.js"); return B.avatar.mine; });
ok(saved && saved.shoes !== undefined, "the saved look is what the map uses now");
await sleep(800);
const inRoom = await A.evaluate(async () => {
  const { party } = await import("/web/party.js");
  const r = party.current?.room; return r ? r.presence[r.me.id]?.avatar ?? null : "no party";
});
ok(inRoom !== "no party" && JSON.stringify(inRoom) === JSON.stringify(saved), "the party room has the new look live (lobby sprites rebuild from it)");

// leave with a change: it asks
await A.locator("#outfit-tabs button", { hasText: /^Hair$/ }).click(); await sleep(500);
await A.locator('#outfit-grid [data-slot="hairColor"]:not(.selected):not(.locked)').first().click(); await sleep(800);
await A.locator("#style-close").click(); await sleep(500);
ok(await A.locator("#ss-ask:not([hidden])").count() === 1, "leaving with changes asks Save / Discard");
await shot("09-ask");
await A.locator('#ss-ask [data-ask="discard"]').click(); await sleep(800);
ok(await A.evaluate(() => document.getElementById("style-screen").hidden), "Discard closes the screen");
await sleep(500);
await cdp.send("Page.stopScreencast");

// the recording
for (let i = 0; i < frames.length; i++) await writeFile(join(OUT, "frames", `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(frames[i].data, "base64"));
if (process.env.FFMPEG && frames.length) {
  const { execFileSync } = await import("node:child_process");
  const list = frames.map((f, i) => `file 'frames/f${String(i).padStart(4, "0")}.jpg'\nduration ${Math.max(0.01, ((frames[i + 1]?.t ?? f.t + 0.1) - f.t)).toFixed(3)}`).join("\n");
  await writeFile(join(OUT, "frames.txt"), list);
  execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(OUT, "frames.txt"),
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-pix_fmt", "yuv420p", join(OUT, "style.mp4")]);
}
console.log(`  (${frames.length} frames, ${sparks} sparkles mid-burst)`);
if (errors.length) console.log("page errors:\n  " + errors.slice(0, 6).join("\n  "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close(); close();
process.exit(fail || errors.length ? 1 : 0);
