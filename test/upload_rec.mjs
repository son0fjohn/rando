// Art Gallery photos on the REAL app page (onboarding and all, Supabase
// faked): a host with two bots starts the gallery, taps an empty frame, the
// camera card comes up ON TOP of the game, yes opens the phone's photo
// picker (from that tap), three photos picked at once go in one by one
// ("Uploading 2/3…"), and the three frames fill. Recorded per engine.
//
//   node test/upload_rec.mjs <dir> [chromium|webkit|both|iphone-profile]   (FFMPEG=... for mp4s)
import { chromium, webkit, devices } from "playwright";
import { mkdir, readdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./appserve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2];
if (!OUT) { console.error("usage: node test/upload_rec.mjs <dir> [chromium|webkit|both]"); process.exit(2); }
const pick = process.argv[3] ?? "both";
await mkdir(OUT, { recursive: true });
const { base, close } = await serve({ realAvatars: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const LOOK = { skin: "3", eyes: "cool", iris: "brown", hairColor: "black", hair: "twists", head: "none", face: "none", top: "bomber-olive", bottom: "wide-jeans", shoes: "hightop", neck: "none" };
const PHOTOS = [0, 3, 6].map(i => join(ROOT, `web/games/captions/c${i}.jpg`));

async function run(name, type, device) {
  console.log(`\n${name}`);
  const browser = await type.launch(type === chromium ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } : {});
  const ctx = await browser.newContext({ ...device, recordVideo: { dir: join(OUT, `${name}-raw`), size: { width: 390, height: 844 } } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", e => errors.push(e.message));
  const until = (fn, arg, ms = 60000) => pg.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true).catch(() => false);
  const tap = sel => pg.evaluate(sel => { const el = document.querySelector(sel); el?.click(); return !!el; }, sel);
  await pg.goto(`${base}/app.html?devlat=37.5347&devlng=126.9945&bots=2&me=jae&av=${encodeURIComponent(JSON.stringify(LOOK))}`);
  ok(await until(() => document.querySelector(".onb-screen:not(.out)")?.dataset.screen === "home", null, 120000), "Home");
  await sleep(1500);
  await tap("[data-throw]");
  await until(() => !!document.querySelector('.onb-sheet[data-sheet="invite"]:not(.out)'));
  await tap('.onb-sheet[data-sheet="invite"] [data-close]');
  await sleep(1200);
  await tap("#pt-vote"); await sleep(800);
  await pg.evaluate(() => document.querySelector('[data-game="artgallery"] .pv-t > b')?.click());
  // the first game: the safety card, then the gallery
  if (await until(() => !!document.querySelector(".onb-safety"), null, 30000)) { await sleep(600); await tap(".onb-safety button"); }
  // Bunny explains it first (howto.js): a first game, so in full; then the frames
  if (await until(() => !!document.querySelector("[data-how]"), null, 60000)) { await sleep(2500); await tap('[data-how="skip"], [data-how="go"]'); }
  ok(await until(() => window.__game?.s?.phase === "photos" && document.querySelectorAll("#ag-ui .ag-frame").length === 3, null, 60000), "the gallery: fill your 3 frames");
  await sleep(1500);
  await pg.screenshot({ path: join(OUT, `${name}-1-frames.png`) });

  // tap an empty frame: the camera card must be the thing on top
  const frame = pg.locator(".ag-empty").first();
  await frame.click();
  ok(await until(() => !!document.querySelector(".onb-perm:not(.out)"), null, 10000), "tap a frame: the camera card");
  const onTop = await pg.evaluate(() => { const b = document.querySelector(".onb-perm [data-yes]"); if (!b) return false; const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
  ok(onTop, "…on top of the game (its Yes is what a finger would hit)");
  await sleep(500);
  await pg.screenshot({ path: join(OUT, `${name}-2-camera-card.png`) });
  // yes: the photo picker opens from that tap
  const chooser = pg.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
  await pg.locator(".onb-perm [data-yes]").click().catch(() => {});
  const fc = await chooser;
  ok(!!fc, "Yes opens the photo picker");
  ok(!!fc?.isMultiple(), "…for several photos at once");
  if (fc) {
    // what the screen says while they go in
    const seen = new Set();
    const watch = setInterval(() => pg.evaluate(() => document.querySelector(".ag-upl")?.textContent ?? "").then(t => t && seen.add(t)).catch(() => {}), 120);
    await fc.setFiles(fc.isMultiple() ? PHOTOS : PHOTOS[0]);
    let shot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !(await pg.evaluate(() => document.querySelectorAll(".ag-frame:not(.ag-empty) img:not(.ag-frameimg)").length >= 3))) {
      if (!shot && await pg.evaluate(() => !!document.querySelector(".ag-upl"))) { shot = true; await pg.screenshot({ path: join(OUT, `${name}-3-uploading.png`) }); }
      await sleep(150);
    }
    clearInterval(watch);
    ok([...seen].some(t => /Uploading \d\/3/.test(t)), `progress on screen: ${[...seen].join(", ") || "(none caught)"}`);
    ok(await pg.evaluate(() => document.querySelectorAll(".ag-frame:not(.ag-empty) img:not(.ag-frameimg)").length === 3), "all three frames filled");
    ok(await pg.evaluate(() => (window.__game?.s?.players?.[Object.keys(window.__game.s.players).find(id => !/^bot-/.test(id))]?.photos?.length ?? 0) === 3), "…and the host has all three");
    await sleep(1200);
    await pg.screenshot({ path: join(OUT, `${name}-4-filled.png`) });
  }
  ok(!errors.length, errors.length ? `page errors: ${errors.slice(0, 3).join(" | ")}` : "no page errors");
  await sleep(800);
  await ctx.close(); await browser.close();
  // the video: webm -> mp4 if there's an ffmpeg
  const raw = join(OUT, `${name}-raw`), vids = (await readdir(raw).catch(() => [])).filter(f => f.endsWith(".webm"));
  if (vids[0]) {
    await rename(join(raw, vids[0]), join(OUT, `${name}.webm`));
    if (process.env.FFMPEG) { execFileSync(process.env.FFMPEG, ["-y", "-loglevel", "error", "-i", join(OUT, `${name}.webm`), "-pix_fmt", "yuv420p", "-crf", "26", join(OUT, `${name}.mp4`)]); console.log(`  wrote ${name}.mp4`); }
  }
}

if (pick === "both" || pick === "chromium") await run("android-chrome", chromium, { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } });
if (pick === "both" || pick === "webkit") await run("iphone-safari", webkit, { ...devices["iPhone 14"] });
// no WebKit installed here: the iPhone's screen, touch and user agent on Chromium (not Safari's engine)
if (pick === "iphone-profile") await run("iphone-profile", chromium, { ...devices["iPhone 14"], defaultBrowserType: undefined });
close();
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
